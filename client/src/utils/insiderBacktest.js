// Insider Tracker — Backtesting page helpers (pure; no React).
// The UI form uses human units (percent, U.S. dollars); toRunRequest() converts to
// the API's units (fractions) for POST /api/insider/backtest/run.

export const ROLE_OPTIONS = ["CEO", "CFO", "COO", "CTO", "VP", "Director", "10% Owner", "Other officer", "Other"];
export const HORIZON_KEYS = ["7d", "30d", "90d", "180d"];

const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

// Starting values only — every one is the user's choice (none is a fixed strategy rule).
// The filing-delay and signal-lag filters are OFF (empty) by default: late filings count.
export function defaultForm(nowMs = Date.now()) {
  return {
    from: iso(nowMs - 3 * 365 * 86_400_000), to: iso(nowMs),
    minBuyers: "2", minValueUsd: "250000", windowDays: "30", maxSignalLagDays: "", maxFilingDelayDays: "",
    horizonSessions: "20", executionLatencySeconds: "60", entrySession: "regular",
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
  // Same bounds as the server (input sanity only). Optional fields: empty = off.
  const ints = [["minBuyers", 1, 100_000, "Minimum buyers"], ["windowDays", 1, 3650, "Window"], ["horizonSessions", 1, 756, "Return horizon (trading sessions)"],
    ["executionLatencySeconds", 0, 86_400, "Execution latency (seconds)"],
    ["maxSignalLagDays", 0, 3650, "Maximum signal lag", true], ["maxFilingDelayDays", 0, 3650, "Maximum filing delay", true]];
  for (const [k, lo, hi, label, optional] of ints) {
    const v = n(f[k]);
    if (optional && v == null) continue;
    if (!Number.isInteger(v) || v < lo || v > hi) return { error: `${label} must be a whole number from ${lo} to ${hi}.` };
  }
  if (!["regular", "extended"].includes(f.entrySession)) return { error: "Choose an entry session rule." };
  const usd = n(f.minValueUsd);
  if (!(usd >= 0)) return { error: "Minimum combined value (USD) must be 0 or more." };
  const decline = n(f.priorDeclinePct);
  if (decline != null && !(decline > 0 && decline <= 95)) return { error: "Prior price decline must be between 0 and 95 %." };
  const lo = n(f.minMarketCapM), hi = n(f.maxMarketCapM);
  if ((lo != null && !(lo >= 0)) || (hi != null && !(hi >= 0)) || (lo != null && hi != null && lo > hi)) return { error: "Check the market-cap range." };
  const body = {
    from: f.from, to: f.to,
    minBuyers: n(f.minBuyers), minValueUsd: usd, windowDays: n(f.windowDays),
    horizonSessions: n(f.horizonSessions), executionLatencySeconds: n(f.executionLatencySeconds), entrySession: f.entrySession,
    roles: f.roles, openMarketOnly: !!f.openMarketOnly,
    commissionBps: n(f.commissionBps) ?? 0, slippageBps: n(f.slippageBps) ?? 0,
    delistingPolicy: f.delistingPolicy, equityHorizon: f.equityHorizon,
  };
  if (n(f.minTransactionUsd) != null) body.minTransactionUsd = n(f.minTransactionUsd);
  if (n(f.maxSignalLagDays) != null) body.maxSignalLagDays = n(f.maxSignalLagDays);
  if (n(f.maxFilingDelayDays) != null) body.maxFilingDelayDays = n(f.maxFilingDelayDays);
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

// ---- PRIMARY METRIC: SEC signal published → NOW ---------------------------------
// Rows come from GET /insider/backtest/run/:id/publication-now (server computes).

// "5 h 12 min" / "3 d 4 h" / "12 min" — time since SEC publication.
export function elapsedText(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const min = Math.floor(ms / 60_000), h = Math.floor(min / 60), d = Math.floor(h / 24);
  if (d >= 1) return `${d} d ${h % 24} h`;
  if (h >= 1) return `${h} h ${min % 60} min`;
  return `${min} min`;
}

// Why there is no number — shown instead of a result, never a guess.
export const PUB_STATUS_TEXT = {
  awaiting_sip: "Awaiting SIP data (consolidated trades of the last 15 minutes are not available yet — retries automatically)",
  awaiting_first_trade: "No eligible trade yet since publication",
  awaiting_regular_session: "Awaiting regular-session trade (market not open yet)",
  awaiting_regular_session_trade: "Awaiting regular-session trade",
  awaiting_newer_price: "Awaiting a latest price newer than the entry trade",
  no_eligible_trade_in_scan: "Price data unavailable (no eligible trade in the scanned range)",
  no_latest_price: "Price data unavailable (no latest price)",
  no_quote: "Price data unavailable (no current quote)",
  quota: "Price data unavailable (request limit — retries automatically)",
  no_key: "Price data unavailable (no market-data key on the server)",
  invalid_key: "Price data unavailable (market-data key rejected)",
  rate_limited: "Price data unavailable (provider rate limit — retries automatically)",
  unknown_ticker: "Price data unavailable (ticker not covered)",
  no_ticker: "Price data unavailable (no ticker on the Form 4)",
  invalid_publication_time: "Price data unavailable (invalid publication time)",
  price_data_restricted: "Internal use only (licence)",
  error: "Price data unavailable (request failed)",
};
export const pubStatusText = (s) => PUB_STATUS_TEXT[s] || "Price data unavailable";
// Short label for a table cell (full text in the tooltip).
export function pubStatusShort(s) {
  if (s === "awaiting_sip") return "Awaiting SIP data";
  if (s === "awaiting_regular_session" || s === "awaiting_regular_session_trade") return "Awaiting regular-session trade";
  if (s === "awaiting_first_trade") return "No trade yet";
  if (s === "awaiting_newer_price") return "Awaiting newer price";
  if (s === "price_data_restricted") return "Internal only";
  if (s === "lookup_queued") return "Loading price…";
  return "Price data unavailable";
}
export const SESSION_LABEL = { pre: "Pre-market", regular: "Regular market", post: "After-hours" };
export const PROVIDER_LABEL = { alpaca: "Alpaca", tiingo: "Tiingo", none: "—" };
// Entry basis: an exact trade, or a minute-bar approximation (fallback only).
export const ENTRY_BASIS_LABEL = { sip_trade: "SIP trade", iex_minute_bar: "IEX 1-min bar open (approx.)" };
export const LATEST_SOURCE_LABEL = { iex_last_trade: "IEX last trade", tiingo_iex_reference: "Tiingo IEX reference" };

// Summary over signals with a result for one metric ("primary" | "regular").
export function publicationSummary(rows = {}, kind = "primary") {
  const all = Object.values(rows || {});
  const xs = all.map((r) => r?.[kind]).filter((m) => m?.status === "ok" && Number.isFinite(m.changePct)).map((m) => m.changePct).sort((a, b) => a - b);
  const n = xs.length;
  return {
    withData: n, total: all.length,
    average: n ? xs.reduce((a, b) => a + b, 0) / n : null,
    median: n ? (n % 2 ? xs[(n - 1) >> 1] : (xs[n / 2 - 1] + xs[n / 2]) / 2) : null,
    positiveShare: n ? xs.filter((x) => x > 0).length / n : null,
  };
}

// ---------- Plain-English presentation helpers (display only — no calculations) ----------
export const METRIC_HELP = {
  signal: "The moment the insider-buying criteria were publicly met: the SEC accepted the Form 4 filing that completed the cluster (not the company's first-ever filing).",
  returnSinceSignal: "Percentage change from the first eligible recorded trade after the insider-buying signal became public to the latest available stock price. Includes pre-market and after-hours trading.",
  regularMarketReturn: "Percentage change from the first eligible trade during regular US market hours (9:30 AM–4:00 PM ET) after the signal to the latest available stock price.",
  firstPrice: "The price of the first eligible recorded trade at or after the moment the signal became public — in any session (pre-market, regular market or after-hours).",
  regularEntry: "The price of the first eligible trade during regular US market hours at or after the signal. Signals published outside market hours use the next session's opening trades.",
  latestPrice: "The most recent trade on the IEX exchange (via Alpaca). IEX is one U.S. exchange, not the full consolidated market, so this can differ slightly from other quotes. The age shows when that trade happened.",
  sinceFirstBuy: "A separate measure: change from the closing price on the date of the first insider purchase in this cluster to the latest close.",
  disclaimer: "These are historical price comparisons, not guaranteed or achievable investment returns. They ignore fees, taxes, slippage and dividends.",
};

const ET_WALL = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?/;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const clock12 = (h, m, s) => `${((Number(h) + 11) % 12) + 1}:${m}${s != null ? `:${s}` : ""} ${Number(h) < 12 ? "AM" : "PM"}`;

// SEC acceptance time ("2026-10-19 07:11:41 ET", already New York wall time) → readable parts.
export function publishedParts(et, { seconds = false } = {}) {
  const m = ET_WALL.exec(et || "");
  if (!m) return { date: "—", time: "", short: "—" };
  return { date: `${MON[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`, short: `${MON[Number(m[2]) - 1]} ${Number(m[3])}`, time: `${clock12(m[4], m[5], seconds ? m[6] || "00" : null)} ET` };
}

// ISO instant → New York date / time text ("Oct 22, 2026", "4:57:20 PM ET").
export function etParts(iso, { seconds = false, year = true } = {}) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return { date: "—", time: "" };
  const d = new Date(t);
  const date = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", ...(year ? { year: "numeric" } : {}) }).format(d);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}), hour12: true }).format(d);
  return { date, time: `${time} ET` };
}

// How old the latest trade is — never presented as live.
export const RECENT_TRADE_MS = 15 * 60_000;
// marketSession (server, NYSE calendar): pre | regular | post | closed. Levels:
//   recent       trade ≤ 15 min old
//   closed       older, but the regular session is not open (expected — not live)
//   old          older DURING regular hours: stale (no newer IEX trade)
//   unavailable  no price
const SESSION_NOW = { closed: "Market closed", pre: "Pre-market", post: "After-hours" };
export function freshness(latest, marketSession) {
  if (!latest || latest.status !== "ok" || !Number.isFinite(latest.ageMs)) return { level: "unavailable", label: "Price unavailable" };
  const age = elapsedText(latest.ageMs);
  if (latest.ageMs <= RECENT_TRADE_MS) return { level: "recent", label: `Last trade ${age} ago`, note: "Recent trade on IEX" };
  if (SESSION_NOW[marketSession]) return { level: "closed", label: `${SESSION_NOW[marketSession]} · last trade ${age} ago`, note: `${SESSION_NOW[marketSession]} — this is the last IEX trade, not a live price` };
  if (marketSession === "regular") return { level: "old", label: `Stale · last trade ${age} ago`, note: "No newer IEX trade during market hours — not a live price" };
  return { level: "old", label: `Last trade ${age} ago`, note: "Not a live price — no newer IEX trade yet" };
}

// "2 buyers · 3 purchases" — two clearly separate counts.
export const buyersText = (buyers, purchases) => `${buyers} buyer${buyers === 1 ? "" : "s"} · ${purchases} purchase${purchases === 1 ? "" : "s"}`;

// INFORMATIONAL IPO-allocation labels (server: ipoContext.js). Never excludes anything.
export const IPO_LABEL = { verified: "IPO allocation", possible: "Possible IPO allocation" };
export const IPO_HELP = {
  verified: "Bought in the company's initial public offering at the offering price — confirmed by an explicit statement in the Form 4 or the prospectus.",
  possible: "Bought at exactly the IPO offering price, around the IPO closing date — but no filing states that it was an IPO allocation. Unverified.",
  note: "Informational only: the purchase is still a Form 4 code-P purchase and stays in the backtest.",
};
export const ipoLabel = (c) => (c && IPO_LABEL[c.status]) || null;

// Full-precision price for the calculation walkthrough (up to 4 decimals, never rounded away).
export function preciseUsd(v) {
  if (!Number.isFinite(v)) return "—";
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

// ---------- Historical evaluation (display only; values computed by the server) ----------
export const FIXED_HORIZONS = [1, 5, 10, 20, 60];
PUB_STATUS_TEXT.lookup_queued = "Loading the entry price from Alpaca in the background — fills in automatically";
export const HORIZON_STATUS_TEXT = {
  immature: "Not yet available — the exit session has not closed",
  no_bar: "No daily bar for the exit session (halt or delisting) — not estimated",
  no_entry: "No entry trade",
  bars_unavailable: "Daily prices could not be loaded — retried automatically",
};

// One horizon over many rows: only signals whose exit has closed (status ok) are included.
export function horizonSummary(rows = {}, n) {
  const all = Object.values(rows || {}).map((r) => r?.primary?.horizons?.[n]).filter(Boolean);
  const xs = all.filter((h) => h.status === "ok" && Number.isFinite(h.changePct)).map((h) => h.changePct).sort((a, b) => a - b);
  const k = xs.length;
  const count = (s) => all.filter((h) => h.status === s).length;
  return {
    horizon: n, n: k,
    average: k ? xs.reduce((a, b) => a + b, 0) / k : null,
    median: k ? (k % 2 ? xs[(k - 1) >> 1] : (xs[k / 2 - 1] + xs[k / 2]) / 2) : null,
    winRate: k ? xs.filter((x) => x > 0).length / k : null,
    immature: count("immature"), noBar: count("no_bar"), unavailable: count("bars_unavailable") + count("no_entry"),
  };
}

// Signals per publication month, and how many have a priced Return Since Signal.
export function signalsByMonth(signals = [], rows = {}) {
  const m = {};
  for (const s of signals) {
    const k = String(s.publishedDate || s.publishedAt || "").slice(0, 7);
    if (!k) continue;
    m[k] ||= { signals: 0, priced: 0 };
    m[k].signals++;
    if (rows?.[s.id]?.primary?.status === "ok") m[k].priced++;
  }
  return m;
}

// HINDSIGHT (server: signal.hindsight) — the cluster by its end, as reported by all filings
// held now. Display only: the signal's own figures are what was public at publication.
export const HINDSIGHT_HELP = "Hindsight — not known when the signal was published. The same cluster (same filters) as reported by every filing held now, including buyers and purchases filed after the signal. Returns always use the signal-time entry.";
export function hindsightDelta(s) {
  const h = s?.hindsight;
  if (!h) return null;
  const grew = h.buyers !== s.uniqueBuyers || h.purchases !== s.purchases || Math.abs((h.valueUsd || 0) - (s.valueUsd || 0)) >= 0.5;
  return grew ? h : null;
}

// ---------- User strategy (actionable returns over the selected horizon) ----------
export const HORIZON_PRESETS = [1, 3, 5, 10, 20, 60];
export const LATENCY_PRESETS = [0, 60, 300, 900];
export const ENTRY_SESSION_LABEL = { regular: "Regular hours only", extended: "Extended hours allowed" };

// Saved strategy params (API units, as sent by toRunRequest) → form (human units). Exact
// inverse of toRunRequest: a field missing from params keeps the form's empty / default value.
export function formFromParams(p = {}, nowMs = Date.now()) {
  const d = defaultForm(nowMs);
  const s = (v) => (v == null ? "" : String(v));
  return {
    ...d,
    from: p.from || d.from, to: p.to || d.to,
    minBuyers: s(p.minBuyers ?? d.minBuyers), minValueUsd: s(p.minValueUsd ?? d.minValueUsd), windowDays: s(p.windowDays ?? d.windowDays),
    maxSignalLagDays: s(p.maxSignalLagDays), maxFilingDelayDays: s(p.maxFilingDelayDays),
    horizonSessions: s(p.horizonSessions ?? d.horizonSessions), executionLatencySeconds: s(p.executionLatencySeconds ?? d.executionLatencySeconds),
    entrySession: p.entrySession || d.entrySession,
    roles: Array.isArray(p.roles) ? p.roles.filter((r) => ROLE_OPTIONS.includes(r)) : [],
    openMarketOnly: p.openMarketOnly === true, minTransactionUsd: s(p.minTransactionUsd),
    priorDeclinePct: p.minPriorDecline != null ? s(Math.round(p.minPriorDecline * 10000) / 100) : "",
    priorLookbackSessions: s(p.priorLookbackSessions ?? d.priorLookbackSessions),
    minMarketCapM: p.minMarketCap != null ? s(p.minMarketCap / 1e6) : "", maxMarketCapM: p.maxMarketCap != null ? s(p.maxMarketCap / 1e6) : "",
    commissionBps: s(p.commissionBps ?? d.commissionBps), slippageBps: s(p.slippageBps ?? d.slippageBps),
    delistingPolicy: p.delistingPolicy || d.delistingPolicy, equityHorizon: p.equityHorizon || d.equityHorizon,
  };
}

export const STRATEGY_STATUS_TEXT = {
  ok: "Complete",
  immature: "Horizon not complete yet: the exit session has not closed (not counted as 0 %)",
  no_bar: "Missing exit price: no daily bar for the exit session (halt, delisting or symbol change); not estimated",
  bars_unavailable: "Daily prices could not be loaded; retried automatically",
  no_entry: "Missing entry price: no eligible trade after publication",
  no_ticker: "No ticker on the Form 4, so it cannot be priced",
  lookup_queued: "Loading the entry price in the background",
  price_data_restricted: "Internal use only (licence)",
};
export const strategyStatusText = (s) => STRATEGY_STATUS_TEXT[s] || PUB_STATUS_TEXT[s] || "Price data unavailable";
export function strategyStatusShort(s) {
  if (s === "immature") return "Not mature";
  if (s === "no_bar") return "No exit price";
  if (s === "no_entry" || s === "awaiting_first_trade" || s === "no_eligible_trade_in_scan") return "No entry price";
  if (s === "no_ticker") return "No ticker";
  return pubStatusShort(s);
}
// Groups the server's missing-reason counts into the data-quality buckets shown to users.
export function missingBreakdown(missing = {}) {
  const out = { missingEntry: 0, missingExit: 0, immature: 0, excluded: 0, loading: 0 };
  for (const [k, v] of Object.entries(missing || {})) {
    if (k === "immature") out.immature += v;
    else if (k === "no_bar" || k === "bars_unavailable") out.missingExit += v;
    // Only states that resolve by themselves count as loading. "awaiting_first_trade" /
    // "awaiting_regular_session_trade" mean no eligible trade was found: a missing entry price.
    else if (k === "lookup_queued" || k === "awaiting_sip" || k === "awaiting_regular_session" || k === "rate_limited" || k === "quota") out.loading += v;
    else if (k === "no_ticker" || k === "invalid_publication_time" || k === "unknown_ticker" || k === "unsupported_symbol") out.excluded += v;
    else out.missingEntry += v;
  }
  return out;
}

export const RELIABILITY_TEXT = {
  sec_coverage_incomplete: "SEC Form 4 history is incomplete for this period; signals from missing days are absent",
  small_sample: "Fewer than 30 completed signals",
  many_missing_prices: "More than 20 % of signals have no entry or exit price",
  most_horizons_immature: "Most signals have not reached the selected horizon yet",
  benchmark_incomplete: "SPY comparison missing for some signals",
};

// Timeline event relation to the frozen signal snapshot (server: tracking.js).
export const EVENT_ROLE_LABEL = {
  signal_snapshot: "In signal",
  subsequent_publication: "Later SEC publication",
  amendment_of_signal_purchase: "Form 4/A — corrects a signal purchase (not a new purchase)",
  in_window_not_in_signal: "Not in signal (filtered, or public after the window)",
  outside_signal_clusters: "Outside signal clusters",
};

// ---------- Strategy comparison (client-side; same historical date range only) ----------
// A comparable snapshot of one finished run: configuration + its server-computed summary.
export function comparisonEntry({ jobId, result, pub, label }) {
  const c = result?.config || {};
  const sc = pub?.strategy?.config || {};
  return {
    jobId, label: label || null, at: Date.now(),
    from: c.from, to: c.to,
    config: {
      minBuyers: c.minBuyers, minValueUsd: c.minValueUsd, windowDays: c.windowDays, maxFilingDelayDays: c.maxFilingDelayDays ?? null, maxSignalLagDays: c.maxSignalLagDays ?? null,
      roles: c.roles || [], openMarketOnly: !!c.openMarketOnly, horizonSessions: sc.horizonSessions ?? c.horizonSessions,
      executionLatencySeconds: sc.executionLatencySeconds ?? c.executionLatencySeconds, entrySession: sc.entrySession ?? c.entrySession,
      costPerSideBps: sc.costPerSideBps ?? ((c.commissionBps || 0) + (c.slippageBps || 0)),
    },
    signals: result?.signals?.length ?? 0,
    summary: pub?.strategy?.summary || null,
    reliability: pub?.strategy?.reliability || null,
    secCoverage: result?.coverage ? { ratio: result.coverage.ratio, complete: !!result.coverage.complete, coveredDays: result.coverage.coveredDays, businessDays: result.coverage.businessDays } : null,
  };
}
// Adds or replaces (same job); keeps the newest `max`.
export function upsertComparison(list = [], entry, max = 6) {
  return [entry, ...list.filter((x) => x.jobId !== entry.jobId)].slice(0, max);
}
// Comparable only on the SAME date range; the others are listed as not comparable.
export function comparableRuns(list = [], range) {
  const same = list.filter((x) => range && x.from === range.from && x.to === range.to);
  return { same, other: list.filter((x) => !same.includes(x)) };
}
export const OVERFITTING_WARNING = "Comparing many settings on the same historical data and keeping the best one overfits: the winner usually looks better than it will perform. Treat differences as hypotheses, prefer simple settings, and confirm on a period you did not use for choosing.";
