// Insider Tracker — Backtesting page helpers (pure; no React).
// The UI form uses human units (percent, U.S. dollars); toRunRequest() converts to
// the API's units (fractions) for POST /api/insider/backtest/run.

export const ROLE_OPTIONS = ["CEO", "CFO", "COO", "CTO", "VP", "Director", "10% Owner", "Other officer", "Other"];
export const HORIZON_KEYS = ["7d", "30d", "90d", "180d"];

const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

export function defaultForm(nowMs = Date.now()) {
  return {
    from: iso(nowMs - 3 * 365 * 86_400_000), to: iso(nowMs),
    minBuyers: "2", minValueUsd: "250000", windowDays: "30", maxSignalLagDays: "30",
    roles: [], openMarketOnly: false, minTransactionUsd: "",
    priorDeclinePct: "", priorLookbackSessions: "63",
    minMarketCapM: "", maxMarketCapM: "",
    commissionBps: "0", slippageBps: "0",
    delistingPolicy: "exclude", equityHorizon: "90d",
  };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const n = (v) => (v === "" || v == null ? null : Number(v));

// → { body } or { error } (client-side check; the server validates again).
export function toRunRequest(f) {
  if (!DATE_RE.test(f.from) || !DATE_RE.test(f.to) || f.from > f.to) return { error: "Choose a valid date range (start on or before end)." };
  const ints = [["minBuyers", 1, 50, "Minimum buyers"], ["windowDays", 1, 365, "Window"], ["maxSignalLagDays", 0, 3650, "Maximum signal lag"]];
  for (const [k, lo, hi, label] of ints) {
    const v = n(f[k]);
    if (!Number.isInteger(v) || v < lo || v > hi) return { error: `${label} must be a whole number from ${lo} to ${hi}.` };
  }
  const usd = n(f.minValueUsd);
  if (!(usd >= 0)) return { error: "Minimum combined value (USD) must be 0 or more." };
  const decline = n(f.priorDeclinePct);
  if (decline != null && !(decline > 0 && decline <= 95)) return { error: "Prior price decline must be between 0 and 95 %." };
  const lo = n(f.minMarketCapM), hi = n(f.maxMarketCapM);
  if ((lo != null && !(lo >= 0)) || (hi != null && !(hi >= 0)) || (lo != null && hi != null && lo > hi)) return { error: "Check the market-cap range." };
  const body = {
    from: f.from, to: f.to,
    minBuyers: n(f.minBuyers), minValueUsd: usd, windowDays: n(f.windowDays), maxSignalLagDays: n(f.maxSignalLagDays),
    roles: f.roles, openMarketOnly: !!f.openMarketOnly,
    commissionBps: n(f.commissionBps) ?? 0, slippageBps: n(f.slippageBps) ?? 0,
    delistingPolicy: f.delistingPolicy, equityHorizon: f.equityHorizon,
  };
  if (n(f.minTransactionUsd) != null) body.minTransactionUsd = n(f.minTransactionUsd);
  if (decline != null) { body.minPriorDecline = decline / 100; body.priorLookbackSessions = n(f.priorLookbackSessions) ?? 63; }
  if (lo != null) body.minMarketCap = lo * 1e6;
  if (hi != null) body.maxMarketCap = hi * 1e6;
  return { body };
}

// Return as "+12.3 %" / "−4.0 %" (fraction in).
export function pct(v, digits = 1) {
  if (v == null || !Number.isFinite(v)) return "—";
  const s = (Math.abs(v) * 100).toFixed(digits);
  if (Number(s) === 0) return `${s} %`; // no sign on a value that rounds to zero
  return `${v > 0 ? "+" : "−"}${s} %`;
}
export const plainPct = (v, digits = 0) => (v == null ? "—" : `${(v * 100).toFixed(digits)} %`);


// Histogram of complete net returns for one horizon. Fixed-width bins (pct points);
// bin edges are multiples of `width` so the zero line is always a bin edge.
export function returnHistogram(signals, horizon, width = 0.05) {
  const xs = signals.map((s) => s.horizons?.[horizon]).filter((h) => h?.status === "complete" && Number.isFinite(h.net)).map((h) => h.net);
  if (!xs.length) return [];
  const lo = Math.floor(Math.min(...xs) / width), hi = Math.floor(Math.max(...xs) / width);
  const bins = [];
  for (let k = lo; k <= hi; k++) bins.push({ from: k * width, to: (k + 1) * width, count: 0 });
  for (const x of xs) bins[Math.min(Math.floor(x / width) - lo, bins.length - 1)].count++;
  return bins;
}

export const STATUS_TEXT = {
  complete: "Historical results computed from SEC filings and the configured price data.",
  price_data_required: "The signals below are real (SEC filings), but no licensed price provider is configured, so no returns are calculated.",
  price_data_restricted: "Price data is licensed for internal use only (STOCK_DATA_LICENSE=internal), so returns are shown only on the machine running the server. The SEC signals below are complete.",
};

export const REASON_TEXT = {
  no_price_symbol: "No price symbol", no_price_data: "No price history", no_entry_price: "No price on entry session",
  delisted_before_entry: "Delisted before entry", entry_after_price_data: "Entry after latest price data",
  delisted_or_data_ended: "Delisted / data ended", missing_exit_price: "Missing exit price", no_acceptance_time: "No SEC acceptance time",
  prior_decline: "Prior-decline filter", market_cap: "Market-cap filter",
  "filter_data_missing:prior_decline": "No prices for prior-decline filter", "filter_data_missing:market_cap": "No market cap for filter",
};

// What is incomplete in a run result — kept separate: SEC history coverage,
// signals without usable prices, forward windows not yet elapsed.
export function dataStatus(result) {
  const missingReasons = new Set(["no_price_symbol", "no_price_data", "no_entry_price", "delisted_before_entry"]);
  const signals = result?.signals || [];
  const pricesAvailable = result?.status === "complete";
  let pendingWindows = 0;
  for (const s of signals) for (const h of Object.values(s.horizons || {})) if (h?.status === "pending") pendingWindows++;
  return {
    secComplete: !!result?.coverage?.complete,
    secCovered: result?.coverage ? `${result.coverage.coveredDays}/${result.coverage.businessDays} days` : "—",
    pricesAvailable,
    pricesMissing: pricesAvailable ? signals.filter((s) => s.status === "excluded" && missingReasons.has(s.reason)).length : signals.length,
    pendingWindows: pendingWindows + signals.filter((s) => s.status === "pending").length,
  };
}
