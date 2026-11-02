// server/services/backtest/backtestEngine.js
//
// Orchestrates one historical backtest run:
//   historical Form 4 store + live ingest → snapshot pipeline (price checks,
//   Form 4/A links, duplicate grouping) → point-in-time signals (signals.js, with
//   U.S.-dollar Form 4 values) → forward returns (returns.js) from the
//   configured price provider.
// Never fabricates: without a licensed
// price provider → "price_data_required" (signals and planned entry dates only,
// no performance numbers).

import { buildSnapshot } from "../edgar/insiderSnapshot.js";
import { getBacktestPriceProvider, describePriceProvider, DEFAULT_PRICE_DIR } from "../stockData/stockDataProvider.js";
import { readFetchManifest } from "./priceFetch.js";
import { DEFAULT_STORE_DIR, loadHistoryStore, buildHistoryDataset, historyCoverage, readProgress } from "./form4History.js";
import { detectSignals, normalizeSignalConfig, BACKTEST_ROLES, DEFAULTS } from "./signals.js";
import { evaluateSignals, planWithoutPrices, HORIZONS } from "./returns.js";
import { trackSignalsFor, purchaseEvents, priceTimeline, placeEvents, currentChange } from "./tracking.js";
import { createQuoteService } from "./liveQuote.js";
import { entrySessionFor } from "./sessionCalendar.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86_400_000;
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const easternToday = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(ms));

export const METHODOLOGY = {
  signal: `A signal exists when at least N (default ${DEFAULTS.minBuyers}) DISTINCT reporting owners — identified by SEC CIK, joint filers on one Form 4 counted once — reported Form 4 code P purchases with trade dates inside one rolling ${DEFAULTS.windowDays}-calendar-day window, and the combined reliable purchase value of all buyers is strictly greater than the U.S.-dollar threshold (default $${DEFAULTS.minValueUsd.toLocaleString("en-US")}). Values are the Form 4 amounts in U.S. dollars (shares × reported price); a price whose currency cannot be verified as USD, a price anomaly or a missing price counts as a buyer but adds nothing to the value.`,
  publication: "A signal is dated at the SEC acceptance time of the filing that first made the condition true. Only filings accepted at or before that moment are used; Form 4/A amendments replace an original only from the amendment's acceptance time; duplicate reports by related filers are counted once, known from their first report; identities and price-outlier checks use only filings public at that time.",
  staleness: `The cluster's latest trade date must be within ${DEFAULTS.maxSignalLagDays} calendar days of the publication date (configurable) — very late filings do not create signals.`,
  overlap: `One cluster = one signal. After a signal, purchases dated within ${DEFAULTS.windowDays} days after the cluster's latest purchase extend the same cluster. A new independent signal for the same company needs a qualifying window made only of purchases dated after that.`,
  entry: "Entry at the OPEN of the first U.S. regular session that opens at or after the SEC acceptance time: before 09:30 ET on a trading day → that day; during the session, after the close, on weekends and holidays → next session. Adjusted open = open × adjusted close ÷ close.",
  exit: `Exit at the CLOSE of the last session of each horizon, counted in trading sessions from the entry session: ${HORIZONS.map((h) => `${h.label} = ${h.sessions} sessions`).join(", ")}. Split- and dividend-adjusted prices.`,
  benchmark: "Benchmark: the provider's S&P 500 proxy (default SPY) bought at the same session open and sold at the same session close, without costs. Excess return = strategy net return − benchmark return.",
  missing: "No price on the entry session → excluded. Exit after the latest available price → pending (window not complete). Price history ending before the exit while the market continues → excluded as delisted/data ended (or valued at the last close if selected). Results depend on the price provider's coverage of delisted securities (survivorship bias otherwise).",
  equity: "Equity curve: equal-weight, daily-rebalanced portfolio of all positions open for the selected horizon; cash (0 %) when none; commissions and slippage charged per side on entry and exit days. Benchmark curve: buy-and-hold over the same sessions.",
};

export const TRACK_METHODOLOGY = {
  start: "The timeline starts on the TRADE DATE (Form 4 transaction date) of the first purchase of the company's earliest qualifying cluster in this run — not on the SEC filing date.",
  baseline: "Start = the split-adjusted market close on the first purchase's transaction date (the actual close divided by any later stock splits; dividends are not folded in). If the stock has no bar that day, the closest earlier session within 5 sessions is used (flagged). Insider Form 4 prices are shown for reference only and never used for performance.",
  end: "End = the current price when one is available — Tiingo's IEX reference price (derived from IEX trading only, not the consolidated last sale), shown with its timestamp and refreshed about every minute — otherwise the latest end-of-day close, labelled with its date and never presented as live. Change = (end − start) ÷ start.",
  noReset: "Additional purchases — by the same cluster or by later independent clusters — are events on the same timeline. The baseline is never reset.",
  change: "Change = adjusted close ÷ baseline adjusted close − 1, for every session through the latest available one.",
  hindsight: "Retrospective view: on the first purchase date the public could not know a cluster would form. The SEC publication of the signal and the tradable entry (the backtest) are marked separately; the backtest's publication-based returns are unchanged.",
  dataEnd: "If the stock's price history stops more than 5 sessions before the market's latest session (delisting, ticker change, vendor gap), the timeline ends there and is flagged — nothing is extrapolated.",
};

export function normalizeRunConfig(body = {}, nowMs = Date.now()) {
  const today = easternToday(nowMs);
  const from = String(body.from || ""), to = String(body.to || today);
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) return { error: "from/to must be YYYY-MM-DD with from <= to" };
  if (Date.parse(to) - Date.parse(from) > 15 * 366 * DAY) return { error: "date range is limited to 15 years" };
  const sig = normalizeSignalConfig(body);
  if (sig.error) return sig;
  const num = (v, lo, hi, name, def = null) => {
    if (v === undefined || v === null || v === "") return { v: def };
    const n = Number(v);
    return Number.isFinite(n) && n >= lo && n <= hi ? { v: n } : { error: `${name} must be a number from ${lo} to ${hi}` };
  };
  const fields = {
    commissionBps: num(body.commissionBps, 0, 200, "commissionBps", 0),
    slippageBps: num(body.slippageBps, 0, 500, "slippageBps", 0),
    minPriorDecline: num(body.minPriorDecline, 0, 0.95, "minPriorDecline (fraction, e.g. 0.2 = 20 %)"),
    priorLookbackSessions: num(body.priorLookbackSessions, 5, 252, "priorLookbackSessions", 63),
    minMarketCap: num(body.minMarketCap, 0, 1e13, "minMarketCap"),
    maxMarketCap: num(body.maxMarketCap, 0, 1e13, "maxMarketCap"),
  };
  for (const f of Object.values(fields)) if (f.error) return f;
  const out = Object.fromEntries(Object.entries(fields).map(([k, f]) => [k, f.v]));
  if (out.minMarketCap != null && out.maxMarketCap != null && out.minMarketCap > out.maxMarketCap) return { error: "minMarketCap must be <= maxMarketCap" };
  const delistingPolicy = body.delistingPolicy === "last_close" ? "last_close" : "exclude";
  const equityHorizon = HORIZONS.some((h) => h.key === body.equityHorizon) ? body.equityHorizon : "90d";
  return { config: { from, to: to > today ? today : to, ...sig.config, ...out, delistingPolicy, equityHorizon } };
}

export function createBacktestService({
  storeDir = DEFAULT_STORE_DIR,
  loadStore = () => loadHistoryStore(storeDir),
  live = () => null, // → { transactions, amendmentFilings, coverage, noIndexDays, dataVersion }
  getProvider = () => getBacktestPriceProvider(),
  quotes = createQuoteService(),
  now = () => Date.now(),
} = {}) {
  let snapCache = { key: null, snap: null, dataset: null };

  function dataset() {
    const store = loadStore();
    const l = live();
    const key = `${store.sig}|${l?.dataVersion ?? "none"}`;
    if (snapCache.key !== key) {
      const ds = buildHistoryDataset({ store, live: l });
      const snap = buildSnapshot({ transactions: ds.transactions, amendmentFilings: ds.amendmentFilings, now: now() });
      snapCache = { key, snap, dataset: ds, store, live: l };
    }
    return snapCache;
  }

  function status({ from, to } = {}) {
    const today = easternToday(now());
    const store = loadStore();
    const l = live();
    const provider = getProvider();
    const days = [...store.days.keys()].sort();
    const liveDays = (l?.coverage || []).map((c) => c.day).sort();
    const range = from && to ? historyCoverage({ from, to, store, live: l, today }) : null;
    return {
      today,
      form4: {
        historicalDays: store.days.size,
        historicalFrom: days[0] || null, historicalTo: days[days.length - 1] || null,
        historicalFilings: store.records.size,
        liveFrom: liveDays[0] || null, liveTo: liveDays[liveDays.length - 1] || null,
        backfill: readProgress(storeDir),
        range,
      },
      prices: describePriceProvider(provider),
      priceFetch: readFetchManifest(process.env.STOCK_DATA_DIR || DEFAULT_PRICE_DIR),
      roles: BACKTEST_ROLES,
      horizons: HORIZONS,
      defaults: DEFAULTS,
      methodology: METHODOLOGY,
    };
  }

  // One continuous purchase-date timeline for the company of `signalId` (from a
  // finished run's result). withSeries=false → summary only.
  async function track({ result, signalId, withSeries = true, barsCache = new Map() }) {
    const sig = result.signals.find((s) => s.id === signalId);
    if (!sig) return null;
    const today = easternToday(now());
    const { anchor, clusters } = trackSignalsFor(result.signals, sig.issuerCik);
    const ctx = dataset();
    const events = purchaseEvents({
      rows: ctx.snap.economic, issuerCik: sig.issuerCik, from: anchor.windowFrom, to: today, clusters,
      acceptedAtByAccession: ctx.dataset.acceptedAtByAccession, config: result.config,
    });
    const provider = getProvider();
    const out = {
      issuerCik: sig.issuerCik, ticker: anchor.ticker, issuerName: anchor.issuerName, anchorSignalId: anchor.id,
      startDate: anchor.windowFrom, today,
      clusters: clusters.map((c, i) => ({
        index: i, signalId: c.id, windowFrom: c.windowFrom, clusterTo: c.clusterTo || c.windowTo, publishedAt: c.publishedAt,
        entryDate: c.entryDate || entrySessionFor(c.publishedAt), uniqueBuyers: c.uniqueBuyers, valueUsd: c.valueUsd,
      })),
      prices: describePriceProvider(provider),
      methodology: TRACK_METHODOLOGY,
    };
    if (!provider.available) return { ...out, status: "price_data_required", events: withSeries ? placeEvents(events, []) : undefined, eventCount: events.length };
    let symbol = null;
    try { symbol = await provider.resolveSymbol({ cik: sig.issuerCik, ticker: anchor.ticker, asOf: anchor.publishedDate }); } catch { symbol = null; }
    if (!symbol) return { ...out, status: "no_price_symbol", events: withSeries ? placeEvents(events, []) : undefined, eventCount: events.length };
    const from = addDays(anchor.windowFrom, -14);
    // Full history per symbol once per call chain, then sliced (CSV files are read once).
    const getBars = async (sym) => {
      if (!barsCache.has(sym)) barsCache.set(sym, await provider.getDailyBars(sym, { from: "0000-01-01", to: today }).catch(() => []));
      return barsCache.get(sym).filter((b) => b.date >= from);
    };
    const bars = await getBars(symbol);
    const benchmarkSymbol = provider.benchmarkSymbol || "SPY";
    const benchBars = await getBars(benchmarkSymbol);
    const t = priceTimeline({ startDate: anchor.windowFrom, bars, benchBars, today });
    return {
      ...out, symbol, benchmarkSymbol, status: t.status, baseline: t.baseline, adjustment: t.adjustment || null, stats: t.stats, flags: t.flags,
      corporateActions: t.corporateActions || [], firstPriceDate: t.firstPriceDate || null,
      missingSessions: t.missingSessions || [],
      series: withSeries ? t.series : undefined,
      events: withSeries ? placeEvents(events, t.series) : undefined,
      eventCount: events.length,
      // Headline (panel only — never for table summaries, to respect the quote budget).
      current: withSeries && t.status === "ok" ? currentChange({ baseline: t.baseline, stats: t.stats, quote: await quotes.getQuote(symbol), nowMs: now() }) : undefined,
    };
  }

  // Lightweight refresh of the headline for an open panel (polled by the client).
  async function current({ result, signalId }) {
    const t = await track({ result, signalId, withSeries: false });
    if (!t) return null;
    const base = { issuerCik: t.issuerCik, ticker: t.ticker, symbol: t.symbol || null, startDate: t.startDate, status: t.status, prices: t.prices };
    if (t.status !== "ok") return { ...base, current: null };
    return { ...base, current: currentChange({ baseline: t.baseline, stats: t.stats, quote: await quotes.getQuote(t.symbol), nowMs: now() }) };
  }

  // Summary per company (anchor = earliest cluster), keyed by issuer CIK.
  async function trackSummaries(result) {
    const out = {};
    const seen = new Set();
    const barsCache = new Map();
    for (const s of result.signals) {
      if (seen.has(s.issuerCik)) continue;
      seen.add(s.issuerCik);
      const t = await track({ result, signalId: s.id, withSeries: false, barsCache });
      out[s.issuerCik] = {
        anchorSignalId: t.anchorSignalId, startDate: t.startDate, status: t.status, changePct: t.stats?.changePct ?? null,
        startPrice: t.baseline?.splitAdjClose ?? null, priceDate: t.baseline?.date ?? null, lastPrice: t.stats?.lastClose ?? null,
        lastDate: t.stats?.lastDate ?? null, flags: t.flags || [], eventCount: t.eventCount,
      };
    }
    return out;
  }

  async function run(config, { onProgress = () => {} } = {}) {
    const started = now();
    const today = easternToday(started);
    onProgress({ stage: "loading", done: 0, total: 0 });
    const ctx = dataset();
    const warmupFrom = addDays(config.from, -(config.windowDays + 5));
    const coverage = historyCoverage({ from: warmupFrom, to: config.to, store: ctx.store, live: ctx.live, today });
    const base = {
      generatedAt: new Date(started).toISOString(), config, coverage,
      prices: describePriceProvider(getProvider()),
      methodology: METHODOLOGY, horizons: HORIZONS,
      dataset: { economicRows: ctx.snap.economic.length, filings: ctx.dataset.acceptedAtByAccession.size },
    };

    onProgress({ stage: "signals", done: 0, total: 0 });
    const { signals, stats: signalStats } = detectSignals({
      rows: ctx.snap.economic, acceptedAtByAccession: ctx.dataset.acceptedAtByAccession, config, range: { from: config.from, to: config.to },
    });
    const provider = getProvider();
    if (!provider.available) {
      const r = { ...base, status: "price_data_required", signals: planWithoutPrices(signals), signalStats, stats: null, equity: null };
      return { ...r, tracks: await trackSummaries(r), runMs: now() - started };
    }
    const ev = await evaluateSignals({ signals, provider, benchmarkSymbol: provider.benchmarkSymbol || "SPY", config, onProgress });
    const r = { ...base, status: "complete", signals: ev.results, signalStats, stats: ev.stats, equity: ev.equity, benchmark: ev.benchmark };
    onProgress({ stage: "tracking", done: 0, total: 0 });
    return { ...r, tracks: await trackSummaries(r), runMs: now() - started };
  }

  return { status, run, track, current, normalize: (b) => normalizeRunConfig(b, now()) };
}
