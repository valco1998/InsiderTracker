// server/services/backtest/tracking.js
//
// Insider purchase tracking — a continuous stock-price timeline that starts on the
// TRADE DATE of the first qualifying insider purchase of a cluster and runs to the
// latest available session. Additional view; the publication-based backtest
// (returns.js) is unchanged.
//
// Rules
//   Anchor     For one company, the timeline starts at the first purchase
//              (signal.windowFrom = earliest trade date in the qualifying 30-day
//              window) of its EARLIEST qualifying cluster in the analysis. Later
//              purchases — of the same cluster or of later independent clusters —
//              are EVENTS on the same timeline. The baseline is never reset.
//   Baseline   SPLIT-ADJUSTED CLOSE of the baseline trade date (market price —
//              never the insider's Form 4 price). Split-adjusted = the day's actual
//              close divided by the splits that happened after it (vendor
//              splitFactor); dividends are NOT folded in, so with no split the
//              start price is the actual close of that day. If the price data has no
//              split factors, the vendor's split+dividend-adjusted close is used and
//              reported (adjustment: "split_and_dividend"). If the stock has no bar
//              that day, the latest bar within 5 sessions before it is used and
//              flagged; otherwise there is no baseline (no_baseline_price).
//   Change     pct(t) = splitAdjustedClose(t) / splitAdjustedClose(baseline) − 1;
//              the headline is baseline → latest available end-of-day close.
//   Splits     Adjusted closes already account for splits; a jump of the
//              adjustment factor (adjClose/close) is reported as a corporate action.
//   Data end   If the stock's last bar is more than 5 sessions older than the
//              benchmark's (or the calendar's) last session, the history ended
//              (delisting, ticker change or vendor gap) and is flagged — never
//              extrapolated.
//   Daily      One-day resolution throughout: every purchase keeps its exact Form 4
//              transaction date (never moved, never aggregated by week); prices are
//              daily adjusted closes. A purchase on a weekend/holiday, or on a session
//              whose bar is missing, is compared with the latest earlier close and
//              labelled so (priceBasis). Sessions without a bar are listed
//              (missingSessions) — never filled in.
//   Hindsight  This view is retrospective: on the first purchase date the public
//              could not know a cluster would form. The signal publication and
//              the tradable entry (backtest) are shown as separate markers.

import { cleanBars, maxDrawdown } from "./returns.js";
import { rowBacktestRoles, knownAtOf } from "./signals.js";
import { isSession, lastClosedSession, sessionsBetween, closeTime, entrySessionFor } from "./sessionCalendar.js";

const BASELINE_FALLBACK_SESSIONS = 5;
const DATA_END_TOLERANCE_SESSIONS = 5;
const SPLIT_FACTOR_JUMP = 0.2; // ≥ 20 % change of adjClose/close between consecutive bars
const round6 = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 1e6) / 1e6);
const isSuperseded = (r) => r.amendment?.status === "superseded";

function floorIdx(bars, d) {
  let lo = 0, hi = bars.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (bars[m].date <= d) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans;
}

// Which signals of one company does a timeline cover? anchor = earliest cluster.
export function trackSignalsFor(signals, issuerCik) {
  const own = signals.filter((s) => s.issuerCik === issuerCik).sort((a, b) => a.windowFrom.localeCompare(b.windowFrom) || a.publishedAt.localeCompare(b.publishedAt));
  return { anchor: own[0] || null, clusters: own };
}

// Purchase events (code P, current — not superseded) of the company from the
// first purchase date to `to`. rows: economic rows (snapshot).
export function purchaseEvents({ rows, issuerCik, from, to, clusters = [], acceptedAtByAccession = new Map(), config = {} }) {
  const cik = Number(issuerCik);
  const out = [];
  for (const r of rows) {
    if (r.code !== "P" || isSuperseded(r) || Number(r.issuerCik) !== cik) continue;
    const d = r.transactionDate;
    if (!d || d < from || d > to) continue;
    const roles = rowBacktestRoles(r);
    const cluster = clusters.findIndex((c) => d >= c.windowFrom && d <= (c.clusterTo || c.windowTo));
    const publishedAt = (knownAtOf(r, acceptedAtByAccession) || "").replace(/ ET$/, "") + " ET";
    // Relation to the FROZEN signal snapshots (signals.js): in a signal, published after
    // a signal of its cluster (subsequent SEC publication), or neither.
    const inSnapshot = clusters.findIndex((c) => (c.snapshot?.purchases || []).some((p) => p.rowId === r.id));
    const c = cluster >= 0 ? clusters[cluster] : null;
    const signalRole = inSnapshot >= 0 ? "signal_snapshot"
      : c && publishedAt > c.publishedAt ? "subsequent_publication"
        : c ? "in_window_not_in_signal" : "outside_signal_clusters";
    out.push({
      date: d,
      rowId: r.id,
      publishedAt,
      // First session whose open is at/after the SEC publication — where the event is plotted.
      publicationSession: entrySessionFor(publishedAt),
      signalRole,
      signalCluster: inSnapshot >= 0 ? inSnapshot : null,
      insider: r.owners?.[0]?.name || r.insiderName || "Unknown",
      jointFilers: (r.owners?.length || 1) - 1,
      roles,
      shares: r.shares ?? null,
      form4Price: r.price ?? null,
      valueUsd: r.priceCheck?.status === "anomaly" ? null : r.value ?? null,
      priceFlag: r.priceCheck?.status === "anomaly" ? "price_anomaly" : r.price == null ? "no_price" : null,
      openMarket: r.purchaseContext === "open_market",
      purchaseContext: r.purchaseContext || "unspecified",
      cluster: cluster >= 0 ? cluster : null,
      matchesFilters: (!config.openMarketOnly || r.purchaseContext === "open_market") && (!config.roles?.length || roles.some((g) => config.roles.includes(g))),
      filingUrl: r.reportedBy?.[0]?.filingUrl || r.filingUrl || null,
      accessionNo: r.accessionNo,
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.publishedAt.localeCompare(b.publishedAt));
}

// Corporate actions visible as jumps of the adjustment factor (adjClose / close).
export function adjustmentJumps(bars) {
  const out = [];
  for (let i = 1; i < bars.length; i++) {
    const f0 = bars[i - 1].adjClose / bars[i - 1].close, f1 = bars[i].adjClose / bars[i].close;
    if (Math.abs(f1 / f0 - 1) >= SPLIT_FACTOR_JUMP) out.push({ date: bars[i].date, ratio: round6(f0 / f1) });
  }
  return out;
}

// Price part of a timeline. bars/benchBars: raw provider bars (cleaned here).
// → { status, baseline, series, stats, flags }
export function priceTimeline({ startDate, bars, benchBars = [], today }) {
  const stock = cleanBars(bars).bars;
  const bench = cleanBars(benchBars).bars;
  if (!stock.length) return { status: "no_price_data", baseline: null, series: [], stats: null, flags: [] };
  const flags = [];
  let bi = floorIdx(stock, startDate);
  if (bi < 0) return { status: "no_baseline_price", baseline: null, series: [], stats: null, flags: ["history_starts_after_first_purchase"], firstPriceDate: stock[0].date };
  if (stock[bi].date !== startDate) {
    const gap = sessionsBetween(stock[bi].date, startDate).length - 1;
    if (gap > BASELINE_FALLBACK_SESSIONS) return { status: "no_baseline_price", baseline: null, series: [], stats: null, flags: ["no_bar_near_first_purchase"] };
    flags.push("baseline_previous_session");
  }
  // Split-adjusted closes (price change, dividends excluded) when every bar carries a
  // split factor; otherwise the vendor's split+dividend-adjusted close.
  const adjustment = stock.every((b) => Number.isFinite(b.splitFactor) && b.splitFactor > 0) ? "split" : "split_and_dividend";
  if (adjustment === "split") {
    let cum = 1;
    for (let i = stock.length - 1; i >= 0; i--) { stock[i] = { ...stock[i], splitAdjClose: stock[i].close / cum }; cum *= stock[i].splitFactor; }
  } else {
    for (let i = 0; i < stock.length; i++) stock[i] = { ...stock[i], splitAdjClose: stock[i].adjClose };
  }
  const base = stock[bi];
  const benchBaseIdx = bench.length ? floorIdx(bench, base.date) : -1;
  const benchBase = benchBaseIdx >= 0 ? bench[benchBaseIdx] : null;
  const benchByDate = new Map(bench.map((b) => [b.date, b]));
  const series = [];
  for (let i = bi; i < stock.length; i++) {
    const b = stock[i];
    const bb = benchByDate.get(b.date);
    series.push({
      date: b.date, close: b.close, adjClose: round6(b.adjClose), splitAdjClose: round6(b.splitAdjClose), pct: round6(b.splitAdjClose / base.splitAdjClose - 1),
      benchmarkPct: benchBase && bb ? round6(bb.adjClose / benchBase.adjClose - 1) : null,
    });
  }
  const last = series[series.length - 1];
  let peak = series[0], trough = series[0];
  for (const p of series) { if (p.pct > peak.pct) peak = p; if (p.pct < trough.pct) trough = p; }
  // Data end: compare with the benchmark's last bar, else with the last closed session.
  const reference = bench.length ? bench[bench.length - 1].date : lastClosedSession(`${today} 23:59:59 ET`);
  const behind = last.date < reference ? sessionsBetween(last.date, reference).length - 1 : 0;
  if (behind > DATA_END_TOLERANCE_SESSIONS) flags.push("price_history_ended");
  // Trading sessions inside the plotted range that have no price bar (vendor gap / halt).
  const have = new Set(series.map((p) => p.date));
  const missingSessions = sessionsBetween(base.date, last.date).filter((d) => !have.has(d));
  if (missingSessions.length) flags.push("missing_sessions");
  const actions = adjustment === "split"
    ? stock.slice(bi + 1).filter((b) => b.splitFactor !== 1).map((b) => ({ date: b.date, ratio: round6(b.splitFactor) }))
    : adjustmentJumps(stock.slice(bi));
  const benchLast = bench.length ? bench[bench.length - 1] : null;
  return {
    status: "ok",
    baseline: { date: base.date, close: base.close, adjClose: round6(base.adjClose), splitAdjClose: round6(base.splitAdjClose), requestedDate: startDate },
    adjustment,
    series,
    missingSessions,
    corporateActions: actions,
    stats: {
      lastDate: last.date, lastClose: last.close, changePct: last.pct, sessions: series.length - 1,
      peakPct: peak.pct, peakDate: peak.date, troughPct: trough.pct, troughDate: trough.date,
      maxDrawdown: round6(maxDrawdown(series.map((p) => 1 + p.pct))),
      benchmarkChangePct: benchBase && benchLast ? round6(benchLast.adjClose / benchBase.adjClose - 1) : null,
      benchmarkLastDate: benchLast?.date || null,
      sessionsBehindReference: behind,
    },
    flags,
  };
}

// Places events on the price path (change vs the fixed baseline). The event keeps
// its exact transaction date; priceDate/priceBasis say which close was used:
//   same_day          a bar exists on the transaction date
//   non_trading_day   weekend or market holiday → latest earlier close
//   missing_bar       a trading session without a price bar → latest earlier close
//   before_baseline   no close on or before the date (cannot happen for cluster events)
// The publication marker uses the close of the first session that opened at/after the
// SEC publication (exact date only — a missing bar leaves it unplaced, never shifted).
export function placeEvents(events, series) {
  if (!series.length) return events.map((e) => ({ ...e, pctAtEvent: null, priceDate: null, priceBasis: null, pctAtPublication: null, publicationPriceDate: null }));
  const byDate = new Map(series.map((p) => [p.date, p]));
  return events.map((e) => {
    const pub = e.publicationSession ? byDate.get(e.publicationSession) : null;
    const pubPart = { pctAtPublication: pub ? pub.pct : null, publicationPriceDate: pub ? pub.date : null };
    const i = floorIdx(series, e.date);
    if (i < 0) return { ...e, pctAtEvent: null, priceDate: null, priceBasis: "before_baseline", ...pubPart };
    const basis = series[i].date === e.date ? "same_day" : isSession(e.date) ? "missing_bar" : "non_trading_day";
    return { ...e, pctAtEvent: series[i].pct, priceDate: series[i].date, priceBasis: basis, ...pubPart };
  });
}

// END price for the headline: the current quote when it is newer than the latest
// daily close, else that daily close — labelled, never presented as live.
// change = (end price − first-purchase-date split-adjusted close) / that close.
// quote: liveQuote.getQuote() result. nowMs: viewing time.
export function currentChange({ baseline, stats, quote, nowMs = Date.now() }) {
  if (!baseline || !stats) return null;
  const etNow = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
    .format(new Date(nowMs)).replace(", ", " ");
  const [today, time] = etNow.split(" ");
  const marketOpen = isSession(today) && time >= "09:30:00" && time < closeTime(today);
  const base = baseline.splitAdjClose ?? baseline.adjClose;
  const quoteDay = quote?.status === "ok" ? etDate(quote.timestamp) : null;
  if (quote?.status === "ok" && quoteDay >= stats.lastDate) {
    return {
      basis: "live_quote", price: quote.price, timestamp: quote.timestamp, source: quote.source, marketOpen,
      changePct: round6(quote.price / base - 1), startPrice: round6(base), startDate: baseline.date,
      quoteStatus: quote.stale ? "stale_cache" : "ok", fetchedAt: quote.fetchedAt || null,
    };
  }
  return {
    basis: "eod_close", price: stats.lastClose, timestamp: null, closeDate: stats.lastDate, source: "daily_close", marketOpen,
    changePct: stats.changePct, startPrice: round6(base), startDate: baseline.date,
    quoteStatus: quote?.status === "ok" ? "older_than_close" : quote?.status || "not_requested",
  };
}
const etDate = (iso) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(iso));
