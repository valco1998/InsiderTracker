// Insider purchase tracking timeline — client helpers (pure; no React).
// All numbers come from GET /api/insider/backtest/run/:id/track/:signalId.

export const TRACK_STATUS_TEXT = {
  ok: null,
  price_data_required: "Price data required — no licensed price source is configured, so only the SEC purchase events are shown. Run npm run backtest:prices (needs TIINGO_API_KEY) and set STOCK_DATA_PROVIDER=csv.",
  price_data_restricted: "Price data is licensed for internal use only — the price timeline is shown only on the machine running the server.",
  no_price_symbol: "No price file for this company's ticker (not fetched, ticker missing, or the vendor's company name did not match SEC's).",
  no_price_data: "The price file for this ticker has no usable bars.",
  no_baseline_price: "The price history does not reach back to the first purchase date, so no baseline can be set.",
};

export const FLAG_TEXT = {
  baseline_previous_session: "No bar on the first purchase date — baseline is the closest earlier session.",
  price_history_ended: "Price history ends before the market's latest session (delisting, ticker change or vendor gap) — the timeline stops there.",
  history_starts_after_first_purchase: "Price history starts after the first purchase.",
  no_bar_near_first_purchase: "No price bar within 5 sessions of the first purchase.",
  missing_sessions: "Some trading sessions have no price bar in the data — they are shown as gaps, never filled in.",
};

// Which close a purchase is compared with (from the server's placeEvents).
export const PRICE_BASIS_TEXT = {
  same_day: null,
  non_trading_day: "weekend/holiday — vs previous close",
  missing_bar: "no price bar that day — vs previous close",
  before_baseline: "before the baseline",
};

export const DAY_WINDOWS = [1, 2, 3, 7, 30];
const DAY = 86_400_000;
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

// Purchases within the first `days` calendar days of the timeline (start day = day 1).
// days = null → all purchases.
export function eventsWithinDays(events = [], startDate, days) {
  if (!days) return events;
  const end = addDays(startDate, days - 1);
  return events.filter((e) => e.date >= startDate && e.date <= end);
}

// One entry per transaction DATE (daily grouping, never weekly).
export function groupEventsByDay(events = []) {
  const map = new Map();
  for (const e of events) {
    let g = map.get(e.date);
    if (!g) { g = { date: e.date, purchases: 0, insiders: [], valueUsd: 0, valueMissing: 0, pctAtEvent: e.pctAtEvent ?? null, priceDate: e.priceDate ?? null, priceBasis: e.priceBasis ?? null, clusters: new Set(), firstPublishedAt: e.publishedAt }; map.set(e.date, g); }
    g.purchases++;
    if (!g.insiders.includes(e.insider)) g.insiders.push(e.insider);
    if (e.valueUsd != null) g.valueUsd += e.valueUsd; else g.valueMissing++;
    if (e.cluster != null) g.clusters.add(e.cluster);
    if (e.publishedAt && e.publishedAt < g.firstPublishedAt) g.firstPublishedAt = e.publishedAt;
  }
  return [...map.values()].map((g) => ({ ...g, clusters: [...g.clusters].sort() })).sort((a, b) => a.date.localeCompare(b.date));
}

// Line data on a CALENDAR time axis: [date, pct] per bar; a null point at each
// trading session without a bar so the line visibly breaks there (no filling).
export function lineData(series = [], missingSessions = [], key = "pct") {
  const pts = series.map((p) => [p.date, p[key] ?? null]);
  for (const d of missingSessions) pts.push([d, null]);
  return pts.sort((a, b) => a[0].localeCompare(b[0]));
}

// Purchase markers at their EXACT transaction date (one per day; daily grouping),
// y = change vs the fixed baseline at the close used (see priceBasis).
export function eventPoints(events = []) {
  return groupEventsByDay(events).filter((g) => Number.isFinite(g.pctAtEvent)).map((g) => ({ ...g, x: g.date, y: g.pctAtEvent }));
}

// Cluster spans on exact calendar dates, clipped to the plotted range.
export function clusterSpans(clusters = [], series = []) {
  if (!series.length) return [];
  const first = series[0].date, last = series[series.length - 1].date;
  return clusters.filter((c) => c.clusterTo >= first && c.windowFrom <= last)
    .map((c) => ({ ...c, from: c.windowFrom < first ? first : c.windowFrom, to: c.clusterTo > last ? last : c.clusterTo }));
}

// Vertical markers on exact calendar dates: the SEC acceptance date of each
// cluster's signal and its tradable entry session (within the plotted range).
export function signalMarkers(clusters = [], series = []) {
  if (!series.length) return [];
  const first = series[0].date, last = series[series.length - 1].date;
  const inRange = (d) => d && d >= first && d <= last;
  const out = [];
  for (const c of clusters) {
    const pub = c.publishedAt?.slice(0, 10);
    if (inRange(pub)) out.push({ kind: "published", date: pub, label: `Signal ${c.index + 1} public (SEC)`, cluster: c.index });
    if (inRange(c.entryDate)) out.push({ kind: "entry", date: c.entryDate, label: `Backtest entry ${c.index + 1}`, cluster: c.index });
  }
  return out;
}

// SEC PUBLICATION markers: one point per (publication session, kind) — plotted at the close
// of the first session that opened at/after the SEC acceptance (server: publicationSession),
// so a publication is never drawn before it was public. kind: "signal" (purchases in the
// frozen signal snapshot) or "later" (SEC publications after the signal). Daily closes only.
export function publicationPoints(events = []) {
  const groups = new Map();
  for (const e of events) {
    if (!Number.isFinite(e.pctAtPublication) || !e.publicationPriceDate) continue;
    const kind = e.signalRole === "signal_snapshot" ? "signal" : e.signalRole === "subsequent_publication" || e.signalRole === "amendment_of_signal_purchase" ? "later" : null;
    if (!kind) continue;
    const k = `${e.publicationPriceDate}|${kind}`;
    const g = groups.get(k) || groups.set(k, { x: e.publicationPriceDate, y: e.pctAtPublication, kind, purchases: 0, corrections: 0, insiders: [], publishedAt: [] }).get(k);
    if (e.signalRole === "amendment_of_signal_purchase") g.corrections++; else g.purchases++;
    if (!g.insiders.includes(e.insider)) g.insiders.push(e.insider);
    if (!g.publishedAt.includes(e.publishedAt)) g.publishedAt.push(e.publishedAt);
  }
  return [...groups.values()].sort((a, b) => a.x.localeCompare(b.x));
}

// ---------- company timeline KPIs (Companies page) ----------
// All % values are relative to the FIXED baseline (first purchase's trade-date close), so a
// return from any later point P to the last close is (1 + last) / (1 + P) − 1 — the same
// split-adjusted closes, nothing re-fetched or estimated. null when an input is missing.
export function sinceMark(track, pctAtMark) {
  const last = track?.stats?.changePct;
  if (!Number.isFinite(last) || !Number.isFinite(pctAtMark) || 1 + pctAtMark <= 0) return null;
  return (1 + last) / (1 + pctAtMark) - 1;
}

export function companyReturns(track) {
  const s = track?.stats;
  if (track?.status !== "ok" || !s || !Number.isFinite(s.changePct)) return null;
  const ev = track.events || [];
  const priced = ev.filter((e) => Number.isFinite(e.pctAtEvent));
  const latest = priced.reduce((m, e) => (!m || e.date > m.date ? e : m), null);
  const pubs = ev.filter((e) => Number.isFinite(e.pctAtPublication) && e.publicationPriceDate);
  const firstPub = pubs.reduce((m, e) => (!m || e.publishedAt < m.publishedAt ? e : m), null);
  const base = track.baseline?.date || track.series?.[0]?.date || null;
  return {
    // Hindsight: the trade date is known only once the Form 4 is published.
    sinceFirst: { pct: s.changePct, from: base, fromClose: track.series?.[0]?.close ?? null, to: s.lastDate, toClose: s.lastClose ?? null },
    // First close after the first SEC acceptance — the earliest point the public could act.
    sinceFirstPublication: firstPub ? { pct: sinceMark(track, firstPub.pctAtPublication), from: firstPub.publicationPriceDate, publishedAt: firstPub.publishedAt } : null,
    sinceLatest: latest && base && latest.date > base ? { pct: sinceMark(track, latest.pctAtEvent), from: latest.priceDate || latest.date, date: latest.date, insider: latest.insider } : null,
    benchmark: Number.isFinite(s.benchmarkChangePct) ? { pct: s.benchmarkChangePct, symbol: track.benchmarkSymbol || "SPY" } : null,
    peak: Number.isFinite(s.peakPct) ? { pct: s.peakPct, date: s.peakDate } : null,
    trough: Number.isFinite(s.troughPct) ? { pct: s.troughPct, date: s.troughDate } : null,
  };
}

// Messages for a company timeline without prices (never simulated).
export const COMPANY_TRACK_STATUS_TEXT = {
  price_data_required: "Historical prices are not available for this company on this server, so only the SEC Form 4 purchases are listed. No prices are simulated.",
  price_data_restricted: "Price data is licensed for internal use only — the price chart is shown only on the machine running the server. The SEC purchases are listed below.",
  no_price_symbol: "No historical price series was found for this ticker (missing ticker, delisted or renamed). The SEC purchases are listed below; no prices are simulated.",
  no_price_data: "The price series for this ticker has no usable daily closes. No prices are simulated.",
  no_baseline_price: "The price history does not reach back to the first purchase's trade date, so no baseline can be set. No prices are simulated.",
};
