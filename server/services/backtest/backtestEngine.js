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
import { DEFAULT_STORE_DIR, loadHistoryStore, buildHistoryDataset, historyCoverage, monthlyCoverage, readProgress } from "./form4History.js";
import { detectSignals, normalizeSignalConfig, knownAtOf, rowBacktestRoles, filingDelayDays, BACKTEST_ROLES, DEFAULTS } from "./signals.js";
import { evaluateSignals, planWithoutPrices, HORIZONS } from "./returns.js";
import { trackSignalsFor, purchaseEvents, priceTimeline, placeEvents, currentChange } from "./tracking.js";
import { createQuoteService } from "./liveQuote.js";
import { etToUtcIso } from "./publicationStart.js";
import { createBacktestPriceService } from "./backtestPrices.js";
import { sessionOf, etParts } from "./entrySelection.js";
import { createIpoContextService } from "./ipoContext.js";
import { horizonReturns, FIXED_HORIZONS } from "./horizonReturns.js";
import { entrySessionFor, isSession, previousSession } from "./sessionCalendar.js";
import { detectMonthlySignals, fxNeeds, STUDY_DEFAULTS, PURCHASE_TYPES, PURCHASE_TYPE_LABELS } from "./monthlyStudy.js";
import { evaluateSignal, gridSummary, ruleLabel, TP_GRID, HOLD_DAYS, FOCUS_TARGETS, COST_SCENARIOS_BPS, MOO_CUTOFF, PRICE_SCALE_BAND } from "./exitRules.js";
import { ownerProfile as buildOwnerProfile, ownersList, pointInTimeSelection, DEFAULT_TRACK_RULE, RANK_MIN } from "./ownerProfile.js";
import { createFxReferenceService } from "./fxReference.js";
import { createPriorDisclosureService } from "./priorDisclosure.js";
import { STRATEGY_EXECUTION_DEFAULTS, ENTRY_SESSIONS, availableAtIso, entrySearchStart, strategyReturn, strategySummary, assessReliability } from "./strategyReturns.js";

const STRATEGY_BENCHMARK = "SPY";

// The execution settings of one run (horizon, latency, session rule, costs).
export function strategyConfigOf(cfg = {}) {
  return {
    horizonSessions: cfg.horizonSessions || STRATEGY_EXECUTION_DEFAULTS.horizonSessions,
    executionLatencySeconds: cfg.executionLatencySeconds ?? STRATEGY_EXECUTION_DEFAULTS.executionLatencySeconds,
    entrySession: cfg.entrySession || STRATEGY_EXECUTION_DEFAULTS.entrySession,
    costPerSideBps: (Number(cfg.commissionBps) || 0) + (Number(cfg.slippageBps) || 0),
    benchmarkSymbol: STRATEGY_BENCHMARK,
  };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86_400_000;
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const easternToday = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(ms));

export const METHODOLOGY = {
  signal: "Every parameter is chosen by the user — nothing is a fixed rule. A signal exists when at least the selected number of DISTINCT reporting owners — identified by SEC CIK, joint filers and confirmed duplicate reports by related entities counted once — reported Form 4 code P purchases (open-market or private) with trade dates inside one rolling window of the selected number of calendar days, and the combined reliable purchase value of all their purchases is AT LEAST the selected U.S.-dollar minimum. Every purchase transaction is counted and summed; an insider buying again adds purchases and value but not another buyer. Values are the Form 4 amounts (shares × reported price); a price whose currency cannot be verified as USD, a price anomaly or a missing price counts as a buyer but adds nothing to the value.",
  publication: "Purchase dates only group purchases into the window — they are never an entry date. A signal is dated at the SEC acceptance time of the filing that first made the conditions true, reconstructed from only the filings accepted at or before that moment: Form 4/A amendments replace an original only from the amendment's acceptance; duplicate reports by related filers are counted once, known from their first report; identities and price-outlier checks use only filings public then. The signal's snapshot of purchases is frozen at that time; later filings never modify it and are shown separately as later purchases (hindsight).",
  filters: "Late filings count by default. Optional, off unless set: maximum filing delay per purchase (calendar days from its trade date to its SEC acceptance — later-filed purchases are ignored) and maximum signal lag per cluster (latest trade date → publication). Optional role and open-market filters.",
  overlap: "One cluster = one signal. After a signal, purchases dated within the selected window after the cluster's latest purchase extend the same cluster and never create a duplicate signal. A new independent signal for the same company needs a qualifying window made only of purchases dated after that.",
  strategyTiming: "Timestamps kept apart: insider trade dates → SEC acceptance (signal publication) → estimated public availability = acceptance + the selected execution latency (default 60 s; SEC acceptance is not assumed to equal public availability — the latency covers EDGAR dissemination, feed polling, detection and order routing) → entry → exit.",
  strategyEntry: "Strategy entry = the first eligible recorded trade (Alpaca SIP trades, exact timestamps; report-only, average-price, out-of-sequence and odd-lot prints excluded) at or after the estimated availability. Regular-hours rule (default): inside 09:30–16:00 ET only — a filing published after the close, on a weekend or a holiday enters at the next session's opening trades. Extended-hours rule: pre-market and after-hours prints allowed. Entry prices are split-adjusted to today's share terms.",
  strategyExit: "Strategy exit = the official close of the N-th NYSE trading session after the entry trade's date (N = the selected horizon in trading sessions, not calendar days; weekends, holidays and early closes per the NYSE calendar), split-adjusted SIP daily close. Price return only — dividends are not included. Gross = exit ÷ entry − 1. Net = after the selected commission + slippage per side.",
  strategyBenchmark: "SPY over the equivalent period: bought at its first eligible trade at or after the stock's entry time (same session rule), sold at its close on the same exit session, no costs. Excess = net − SPY. Missing prices are counted by reason and never filled; exits whose session has not closed are 'immature'.",
  legacyDailyEntry: "Legacy daily-bar evaluation (only with a daily CSV price provider; not the strategy return above): Entry at the OPEN of the first U.S. regular session that opens at or after the SEC acceptance time: before 09:30 ET on a trading day → that day; during the session, after the close, on weekends and holidays → next session. Adjusted open = open × adjusted close ÷ close.",
  legacyDailyExit: `Legacy daily-bar evaluation (only with a daily CSV price provider; not the strategy return above): Exit at the CLOSE of the last session of each horizon, counted in trading sessions from the entry session: ${HORIZONS.map((h) => `${h.label} = ${h.sessions} sessions`).join(", ")}. Split- and dividend-adjusted prices.`,
  legacyDailyBenchmark: "Legacy daily-bar evaluation (only with a daily CSV price provider; not the strategy return above): Benchmark: the provider's S&P 500 proxy (default SPY) bought at the same session open and sold at the same session close, without costs. Excess return = strategy net return − benchmark return.",
  legacyDailyMissing: "Legacy daily-bar evaluation (only with a daily CSV price provider; not the strategy return above): No price on the entry session → excluded. Exit after the latest available price → pending (window not complete). Price history ending before the exit while the market continues → excluded as delisted/data ended (or valued at the last close if selected). Results depend on the price provider's coverage of delisted securities (survivorship bias otherwise).",
  legacyDailyEquity: "Legacy daily-bar evaluation (only with a daily CSV price provider; not the strategy return above): Equity curve: equal-weight, daily-rebalanced portfolio of all positions open for the selected horizon; cash (0 %) when none; commissions and slippage charged per side on entry and exit days. Benchmark curve: buy-and-hold over the same sessions.",
};

export const TRACK_METHODOLOGY = {
  start: "The timeline starts on the TRADE DATE (Form 4 transaction date) of the first purchase of the company's earliest qualifying cluster in this run — not on the SEC filing date.",
  baseline: "Start = the split-adjusted market close on the first purchase's transaction date (the actual close divided by any later stock splits; dividends are not folded in). If the stock has no bar that day, the closest earlier session within 5 sessions is used (flagged). Insider Form 4 prices are shown for reference only and never used for performance.",
  end: "End = the current price when one is available — Tiingo's IEX reference price (derived from IEX trading only, not the consolidated last sale), shown with its timestamp and refreshed about every minute — otherwise the latest end-of-day close, labelled with its date and never presented as live. Change = (end − start) ÷ start.",
  noReset: "Additional purchases — by the same cluster or by later independent clusters — are events on the same timeline. The baseline is never reset.",
  change: "Change = adjusted close ÷ baseline adjusted close − 1, for every session through the latest available one.",
  publicationToNowPrimary: "SEC Publication → NOW: entry = the first eligible trade (Alpaca SIP trade data, exact nanosecond timestamps) at or after the SEC acceptance time of the qualifying signal, in any session — pre-market, regular or after-hours. Excluded: report-only/non-representative prints (official open/close reports, average-price, out-of-sequence, prior-reference, derivatively priced, qualified contingent, cash/next-day) and odd lots. Latest = the latest available price: Alpaca IEX last trade on the free plan — IEX trades only, not the consolidated tape — shown with its timestamp and age. Change = latest ÷ split-adjusted entry − 1.",
  publicationToNowRegular: "Regular Hours → NOW: entry = the first eligible trade inside the regular session (09:30–16:00 ET; holidays, early closes and daylight saving handled) at or after publication — the next session's opening trades when published outside regular hours.",
  publicationToNowFallback: "Fallback (Alpaca unavailable): Tiingo IEX 1-minute bars, regular session only — the first minute that starts at or after publication and contains trades (volume > 0). That is a minute-bar approximation, not an exact executable trade, and is labelled as such.",
  publicationToNow: "Superseded description — start = the opening price of the first IEX intraday minute that begins at or after the SEC acceptance time of the qualifying signal (signals published pre-market, after hours, on weekends or holidays start at the first regular-session minute afterwards — the feed has no extended-hours data); end = the latest quote (Tiingo IEX reference price or IEX last trade, with its timestamp). Change = (end − start) ÷ start. Split-adjusted with daily split factors when available. Not a fixed-horizon return; refreshed continuously.",
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
    executionLatencySeconds: num(body.executionLatencySeconds, 0, 86_400, "executionLatencySeconds", STRATEGY_EXECUTION_DEFAULTS.executionLatencySeconds),
    horizonSessions: num(body.horizonSessions, 1, 756, "horizonSessions (trading sessions)", STRATEGY_EXECUTION_DEFAULTS.horizonSessions),
  };
  for (const f of Object.values(fields)) if (f.error) return f;
  if (!Number.isInteger(fields.horizonSessions.v)) return { error: "horizonSessions must be a whole number of trading sessions" };
  if (body.entrySession !== undefined && body.entrySession !== null && body.entrySession !== "" && !ENTRY_SESSIONS.includes(body.entrySession)) return { error: `entrySession must be one of: ${ENTRY_SESSIONS.join(", ")}` };
  const out = Object.fromEntries(Object.entries(fields).map(([k, f]) => [k, f.v]));
  if (out.minMarketCap != null && out.maxMarketCap != null && out.minMarketCap > out.maxMarketCap) return { error: "minMarketCap must be <= maxMarketCap" };
  const delistingPolicy = body.delistingPolicy === "last_close" ? "last_close" : "exclude";
  const equityHorizon = HORIZONS.some((h) => h.key === body.equityHorizon) ? body.equityHorizon : "90d";
  const entrySession = ENTRY_SESSIONS.includes(body.entrySession) ? body.entrySession : STRATEGY_EXECUTION_DEFAULTS.entrySession;
  return { config: { from, to: to > today ? today : to, ...sig.config, ...out, entrySession, delistingPolicy, equityHorizon } };
}

// ---------------- Monthly per-buyer purchase study ----------------
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const STUDY_METHODOLOGY = {
  signal: "One signal per economic buyer, issuer and calendar month: the first SEC acceptance time (ET) at which the buyer's cumulative Form 4 code-P purchase value at that issuer — counted only from filings accepted in that month and only from what was public at that moment — exceeds the threshold (default USD 1,000,000). Purchases traded before the month count when their filing was published in it. Joint filers and confirmed duplicate reports by related filers are one buyer (economic layer); every legal reporting owner (CIK) is kept. Form 4/A supersedes an original only from its acceptance; a Form 4/A correcting a purchase published in an earlier month is not a new purchase.",
  value: "Value = shares × reported price. Not counted (kept and shown with the reason): missing price, price anomaly, unidentifiable foreign currency, foreign currency without a reference rate, corrections of earlier months. A price stated in a foreign currency is converted to USD with the ECB reference rate of the trade date (api.frankfurter.app; the rate date used is stored). A footnote stating that the price column holds the aggregate price is honoured.",
  types: "No purchase is excluded for its buyer or purchase type. Each purchase is classified from the filing text (open market, 10b5-1 plan, offering, private placement, exchange of assets between trusts/entities, transfer, not stated). Code P alone does not prove an open-market purchase; exchanges and transfers are labelled as not necessarily new money.",
  entry: `Entry = the official open of the first NYSE session whose opening auction can still be joined after publication: SEC acceptance + latency (default 60 s) must be at or before ${MOO_CUTOFF} ET on a session day, otherwise the next session. Weekends, holidays and daylight-saving time are handled by the NYSE calendar. The entry session is day 1 for fixed exits and day 0 for days-to-peak / days-to-target.`,
  exits: `Fixed exits: close of day 1–5. Take profit: ${TP_GRID.length} targets from 1 % to 20 % in 0.5 % steps × horizons 1–5 (${TP_GRID.length * HOLD_DAYS.length} combinations), no stop. With daily bars a target is a theoretical touch: the day's high reaching the target sells at the target; an open above the target (day 2+) sells at that open; otherwise the close of the last day. A 0.5 % touch buffer is reported as a sensitivity. A stop is never part of these results.`,
  samples: "Every rule of horizon H is compared on the same sample: priced signals whose first H sessions closed by the cutoff. Signals still inside their window are 'pending' and excluded from every rule of that horizon (counted). Equal weight per signal; a consolidated view keeps one row per stock and entry date. An average return per trade is not a monthly portfolio return.",
  security: "Returns are computed only when the listed series matches the reported security: a security title naming another class/local series/non-common security, or an insider price outside 0.5×–2× the series' raw close on the trade date, is 'security uncertain' (N/A with reason). Missing tickers or price series are N/A with reason — never zero.",
  returns: "Four separate measures: (a) insider mark-to-market from the reported price (split-adjusted; not realised); (b) return from the post-publication entry (the strategy basis); (c) maximum run-up in hindsight (not a strategy); (d) fixed-rule returns. All before costs ('gross'); cost scenarios of 10/25/50 bps per side are shown separately. No taxes. Dividends not included. Benchmark: SPY over the same sessions.",
  disclosure: "Possible earlier public disclosure: the issuer's 8-K/6-K/424B/13D/13G/S-1/F-1/S-3/F-3/425 filings accepted between the first trade date and the Form 4 (SEC submissions index; content not read). Press releases outside EDGAR are not detected.",
  prices: "Alpaca SIP daily bars (split-adjusted; raw bars for the split factor), cached separately for this study. Licence: internal use only.",
};

// Last session whose close is final at `nowMs` (16:20 ET margin).
function lastFinalSession(nowMs) {
  const p = etParts(new Date(nowMs).toISOString());
  return isSession(p.date) && p.time >= "16:20:00" ? p.date : previousSession(p.date);
}

export function normalizeStudyConfig(body = {}, nowMs = Date.now()) {
  const today = easternToday(nowMs);
  const lastFinal = lastFinalSession(nowMs);
  let months = body.months;
  if (typeof months === "string") months = months.split(",").map((s) => s.trim()).filter(Boolean);
  if (months === undefined || months === null || (Array.isArray(months) && !months.length)) {
    const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1);
    months = [d.toISOString().slice(0, 7)];
  }
  if (!Array.isArray(months) || months.length > 36 || months.some((m) => !MONTH_RE.test(String(m)))) return { error: "months must be a list of up to 36 YYYY-MM values" };
  months = [...new Set(months.map(String))].sort();
  if (months.at(-1) > today.slice(0, 7)) return { error: "months cannot be in the future" };
  const num = (v, lo, hi, def, name) => {
    if (v === undefined || v === null || v === "") return { v: def };
    const n = Number(v);
    return Number.isFinite(n) && n >= lo && n <= hi ? { v: n } : { error: `${name} must be a number from ${lo} to ${hi}` };
  };
  const th = num(body.thresholdUsd, 1, 1e12, STUDY_DEFAULTS.thresholdUsd, "thresholdUsd"); if (th.error) return th;
  const lat = num(body.latencySeconds, 0, 3600, 60, "latencySeconds"); if (lat.error) return lat;
  const cutoff = body.cutoff ? String(body.cutoff) : lastFinal;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoff)) return { error: "cutoff must be YYYY-MM-DD" };
  let types = body.types;
  if (typeof types === "string") types = types.split(",").map((s) => s.trim()).filter(Boolean);
  if (types !== undefined && types !== null && (!Array.isArray(types) || types.some((t) => !PURCHASE_TYPES.includes(t)))) return { error: `types must be a list of: ${PURCHASE_TYPES.join(", ")}` };
  const bool = (v, def) => (v === undefined || v === null || v === "" ? def : v === true || v === "true" || v === 1 || v === "1");
  return {
    config: {
      months, thresholdUsd: th.v, latencySeconds: lat.v,
      cutoff: cutoff > lastFinal ? lastFinal : cutoff,
      types: types?.length ? [...new Set(types)].sort() : null,
      newCapitalOnly: bool(body.newCapitalOnly, false),
      priorDisclosure: bool(body.priorDisclosure, true),
    },
  };
}

const symbolOf = (t) => { const s = String(t || "").trim().toUpperCase().replace(/-/g, "."); return /^[A-Z][A-Z0-9.]{0,9}$/.test(s) ? s : null; };
const addDaysIso = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
// Signal → API row (the full 195-rule grid stays server-side unless full = true).
function studyRow({ sig, ev, disclosure }, { full = false } = {}) {
  const { purchases, ...s } = sig;
  const e = ev ? (full ? ev : (({ tp, tpBuffered, ...rest }) => rest)(ev)) : null;
  return { ...s, purchases, evaluation: e, priorDisclosure: disclosure || null };
}
const passesTypes = (sig, cfg) => {
  if (cfg.newCapitalOnly && !(sig.newCapitalShare > 0.5)) return false;
  if (cfg.types && !sig.purchaseTypes.some((t) => cfg.types.includes(t))) return false;
  return true;
};

export function createBacktestService({
  storeDir = DEFAULT_STORE_DIR,
  loadStore = () => loadHistoryStore(storeDir),
  live = () => null, // → { transactions, amendmentFilings, coverage, noIndexDays, dataVersion }
  getProvider = () => getBacktestPriceProvider(),
  quotes = createQuoteService(),
  prices = createBacktestPriceService({ tiingo: quotes }),
  ipo = createIpoContextService(),
  fxRates = createFxReferenceService(),
  disclosures = createPriorDisclosureService(),
  snapshotMinRebuildMs = Number(process.env.BACKTEST_SNAPSHOT_MIN_REBUILD_MS ?? 30_000),
  now = () => Date.now(),
} = {}) {
  let snapCache = { key: null, snap: null, dataset: null };

  // The point-in-time snapshot of all SEC data (history shards + live ingest). Rebuilt
  // when the data changes — but while ONLY the historical store is changing (a running
  // backfill writes a shard every few seconds) at most once per snapshotMinRebuildMs, so
  // runs are not rebuilt from scratch continuously. A live-ingest change rebuilds at once.
  function dataset() {
    const store = loadStore();
    const l = live();
    const liveKey = String(l?.dataVersion ?? "none");
    const key = `${store.sig}|${liveKey}`;
    if (snapCache.key !== key) {
      const historyOnly = snapCache.snap && snapCache.liveKey === liveKey;
      if (historyOnly && Date.now() - snapCache.builtAt < snapshotMinRebuildMs) return snapCache;
      const ds = buildHistoryDataset({ store, live: l });
      const snap = buildSnapshot({ transactions: ds.transactions, amendmentFilings: ds.amendmentFilings, now: now() });
      snapCache = { key, liveKey, builtAt: Date.now(), snap, dataset: ds, store, live: l };
    }
    return snapCache;
  }
  const runCache = new Map(); // settings + data version + day → result (identical runs are not recomputed)

  // Historical SEC coverage by month (history shards + live ingest) — what is held,
  // what failed and why, what is missing. Missing days are reported, never zero.
  function coverageByMonth({ from, to }) {
    const today = easternToday(now());
    return monthlyCoverage({ from, to, store: loadStore(), live: live(), today });
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
  // Daily timeline from Alpaca split-adjusted SIP closes (fallback for the company panel).
  // Bars carry the close only; open is set equal to the close solely to pass bar validation
  // and is never used (priceTimeline reads closes only).
  async function alpacaDailyTimeline(anchor, today) {
    const symbol = String(anchor.ticker || "").trim().toUpperCase().replace(/-/g, ".");
    if (!symbol || !prices.getDailyCloses) return null;
    const from = addDays(anchor.windowFrom, -14);
    let c;
    try { c = await prices.getDailyCloses([symbol, STRATEGY_BENCHMARK], { from }); } catch { return null; }
    if (!(c?.[symbol]?.size > 0)) return null;
    const toBars = (m) => [...(m || new Map())].filter(([d]) => d >= from).sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, close]) => ({ date, open: close, close, adjClose: close, splitFactor: 1 }));
    return { symbol, t: priceTimeline({ startDate: anchor.windowFrom, bars: toBars(c[symbol]), benchBars: toBars(c[STRATEGY_BENCHMARK]), today }) };
  }

  async function track({ result, signalId, withSeries = true, barsCache = new Map() }) {
    const sig = result.signals.find((s) => s.id === signalId);
    if (!sig) return null;
    const { anchor, clusters } = trackSignalsFor(result.signals, sig.issuerCik);
    return buildTrack({ issuerCik: sig.issuerCik, anchor, clusters, config: result.config, withSeries, barsCache });
  }

  // Company timeline for the Companies page (no backtest run): the same pipeline as track() —
  // purchaseEvents → price source → priceTimeline → placeEvents — anchored at the TRADE DATE of the
  // first purchase on/after `from`. The single "cluster" is the company's purchases in [from, to]
  // (the screener window); it has no frozen snapshot, so later events are labelled relative to its
  // first SEC acceptance. Retrospective by design (trade-date baseline = hindsight); the SEC
  // publication of each purchase is placed on the first session after acceptance (pctAtPublication).
  async function companyTrack({ cik, from, to = null, withSeries = true }) {
    const cikNum = Number(String(cik || "").replace(/\D/g, ""));
    if (!cikNum) return null;
    const today = easternToday(now());
    const end = to && to < today ? to : today;
    const ctx = dataset();
    const own = ctx.snap.economic.filter((r) => r.code === "P" && Number(r.issuerCik) === cikNum && r.amendment?.status !== "superseded"
      && r.transactionDate >= from && r.transactionDate <= end);
    if (!own.length) return null;
    const byDate = [...own].sort((a, b) => a.transactionDate.localeCompare(b.transactionDate));
    const accepted = own.map((r) => String(knownAtOf(r, ctx.dataset.acceptedAtByAccession) || r.acceptedAtET || "").replace(/\s*ET$/, "")).filter(Boolean).sort();
    const newest = [...own].sort((a, b) => String(b.acceptedAtET || "").localeCompare(String(a.acceptedAtET || "")))[0];
    const windowFrom = byDate[0].transactionDate, clusterTo = byDate[byDate.length - 1].transactionDate;
    const publishedAt = accepted[0] ? `${accepted[0]} ET` : null;
    const anchor = {
      id: `company:${cikNum}:${windowFrom}`, windowFrom, windowTo: end, ticker: newest.ticker || byDate[0].ticker || null,
      issuerName: newest.issuerName || byDate[0].issuerName || null, publishedAt, publishedDate: accepted[0] ? accepted[0].slice(0, 10) : windowFrom,
    };
    const cluster = { ...anchor, clusterTo, entryDate: publishedAt ? entrySessionFor(publishedAt) : null, uniqueBuyers: new Set(own.map((r) => r.insiderCik || r.insiderName)).size, valueUsd: own.reduce((s, r) => s + (r.priceCheck?.status === "anomaly" ? 0 : r.value || 0), 0) };
    const t = await buildTrack({ issuerCik: own[0].issuerCik, anchor, clusters: [cluster], config: {}, withSeries });
    return { ...t, scope: "company", window: { from, to: end } };
  }

  async function buildTrack({ issuerCik, anchor, clusters, config = {}, withSeries = true, barsCache = new Map() }) {
    const sig = { issuerCik };
    const today = easternToday(now());
    const ctx = dataset();
    const events = purchaseEvents({
      rows: ctx.snap.economic, issuerCik: sig.issuerCik, from: anchor.windowFrom, to: today, clusters,
      acceptedAtByAccession: ctx.dataset.acceptedAtByAccession, config,
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
    let symbol = null;
    if (provider.available) { try { symbol = await provider.resolveSymbol({ cik: sig.issuerCik, ticker: anchor.ticker, asOf: anchor.publishedDate }); } catch { symbol = null; } }
    if (!provider.available || !symbol) {
      // Panel only (withSeries): split-adjusted SIP DAILY CLOSES from Alpaca — the same
      // closes used for strategy exits. Closes only: no intraday reaction is drawn or implied.
      // Licence treated as internal (redistribution not verified).
      const fb = withSeries ? await alpacaDailyTimeline(anchor, today) : null;
      if (fb) {
        return {
          ...out, prices: { ...out.prices, provider: "alpaca_sip_daily_closes", licence: "internal", available: true }, symbol: fb.symbol, benchmarkSymbol: STRATEGY_BENCHMARK,
          status: fb.t.status, baseline: fb.t.baseline, adjustment: "split", priceBasis: "daily_close_only", stats: fb.t.stats, flags: fb.t.flags,
          corporateActions: [], firstPriceDate: fb.t.firstPriceDate || null, missingSessions: fb.t.missingSessions || [],
          series: fb.t.series, events: placeEvents(events, fb.t.series), eventCount: events.length, current: undefined,
        };
      }
      return { ...out, status: provider.available ? "no_price_symbol" : "price_data_required", events: withSeries ? placeEvents(events, []) : undefined, eventCount: events.length };
    }
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

  // "SEC Publication → NOW" for every signal of a run — two independent metrics:
  //   primary  first eligible trade at/after the SEC acceptance time (any session)
  //   regular  first eligible regular-session trade at/after publication
  // each compared with the latest available price (IEX on Alpaca Basic). Entry prices
  // are split-adjusted to today's share terms; a latest price older than the entry is
  // never used. Missing data is a status, never a number.
  // Page polls (background = true, default): answer from cached prices immediately; entries
  // that still need an Alpaca lookup are "lookup_queued" and handed to the deduplicated
  // background pricing queue (backtestPrices.enqueueEntries) — no request waits on Alpaca
  // trade lookups. Concurrent identical calls for one run share a single computation.
  // The precompute CLI passes background: false (+ lookupBudget: Infinity) to price inline.
  const pubInflight = new WeakMap();
  function publicationNow(args) {
    const key = args.result;
    if (args.background !== false && key && pubInflight.has(key)) return pubInflight.get(key);
    const p = publicationNowOnce(args);
    if (args.background !== false && key) { pubInflight.set(key, p); p.finally(() => pubInflight.delete(key)).catch(() => {}); }
    return p;
  }
  async function publicationNowOnce({ result, lookupBudget = 40, background = true }) {
    const nowMs = now();
    const rows = {}, pending = [];
    const budget = !background && Number.isFinite(lookupBudget) ? { left: lookupBudget } : null;
    let queuedNow = 0;
    for (const s of result.signals) {
      const symbol = String(s.ticker || "").trim().toUpperCase().replace(/-/g, ".");
      const publishedIso = etToUtcIso(s.publishedAt);
      const base = { symbol: symbol || null, publishedAt: s.publishedAt, publishedIso, elapsedMs: nowMs - Date.parse(publishedIso) };
      if (!symbol) { rows[s.id] = { ...base, status: "no_ticker", primary: { status: "no_ticker" }, regular: { status: "no_ticker" }, strategy: { status: "no_ticker" } }; continue; }
      const e = await prices.getEntries(symbol, s.publishedAt, background && prices.enqueueEntries ? { cachedOnly: true } : { budget });
      if (background && prices.enqueueEntries && (e.primary?.status === "lookup_queued" || e.regular?.status === "lookup_queued" || isRecheckDue(e))) {
        if (prices.enqueueEntries(symbol, s.publishedAt)) queuedNow++;
      }
      pending.push({ s, base, e });
    }

    // ---- USER STRATEGY (actionable): entry ≥ SEC acceptance + execution latency (session
    // rule applied), exit at the close of the N-th trading session, SPY over the same period.
    // Uses the run's own settings. The acceptance-based entries above are reused when they
    // are already at/after the strategy's start (getEntryAt), so no extra requests then.
    const strategyCfg = strategyConfigOf(result.config);
    const regularOnly = strategyCfg.entrySession !== "extended";
    const useQueue = background && !!prices.enqueueEntryAt;
    const lookupOpts = useQueue ? { regularOnly, cachedOnly: true } : { regularOnly, budget };
    const queueIfNeeded = (m, ...args) => {
      if (useQueue && (m?.status === "lookup_queued" || isRecheckDueOne(m)) && prices.enqueueEntryAt(...args, { regularOnly })) queuedNow++;
    };
    for (const x of pending) {
      const availableIso = availableAtIso(x.s.publishedAt, strategyCfg.executionLatencySeconds);
      const startIso = entrySearchStart(availableIso, strategyCfg.entrySession);
      x.timing = { secAcceptedAt: x.s.publishedAt, availableAt: availableIso, detectedAt: availableIso, entrySearchStart: startIso };
      if (!prices.getEntryAt || !startIso) { x.st = { status: startIso ? "unavailable" : "invalid_publication_time" }; continue; }
      // Reuse decided on this poll's snapshot of the acceptance-based entry (x.e).
      x.st = await prices.getEntryAt(x.base.symbol, x.s.publishedAt, startIso, { ...lookupOpts, prior: x.e?.[regularOnly ? "regular" : "primary"] ?? null });
      queueIfNeeded(x.st, x.base.symbol, x.s.publishedAt, startIso);
      if (x.st?.status === "ok") {
        x.bt = await prices.getEntryAt(STRATEGY_BENCHMARK, null, x.st.time, lookupOpts);
        queueIfNeeded(x.bt, STRATEGY_BENCHMARK, null, x.st.time);
      }
    }
    // Latest price for EVERY ticker row (one batched request) — also rows still waiting for
    // their first eligible trade, so the page can show the current price with its age.
    // Returns still require a valid entry (metric() below).
    const latest = await prices.getLatest(pending.map((x) => x.base.symbol));
    const provider = getProvider();
    const tiingoSplits = new Map();
    // Split factor from Alpaca; else from the Tiingo daily files (split factors), else unknown.
    // Split factor = raw ÷ split-adjusted SIP daily close on the entry day (same formula as
    // prices.getSplitFactor) — read from the batched daily-close caches (100 symbols per
    // request) instead of 2 requests per signal; per-signal lookup only if a bar is missing.
    const todayEt = etParts(new Date(nowMs).toISOString()).date;
    async function splitFor(symbol, entryIso) {
      const entryDay = etParts(entryIso).date;
      if (entryDay === todayEt) return { factor: 1, source: "same_day" };
      const raw = rawCloses[symbol]?.get(entryDay), adj = closes[symbol]?.get(entryDay);
      if (raw > 0 && adj > 0) {
        let factor = Math.round((raw / adj) * 1e4) / 1e4;
        if (Math.abs(factor - 1) < 1e-3) factor = 1;
        return { factor, source: "alpaca_daily_raw_vs_split" };
      }
      const a = await prices.getSplitFactor(symbol, entryIso);
      if (a) return a;
      if (!tiingoSplits.has(symbol)) {
        let bars = [];
        if (provider.available) { try { bars = await provider.getDailyBars(symbol, { from: "0000-01-01", to: "9999-12-31" }); } catch { bars = []; } }
        tiingoSplits.set(symbol, bars);
      }
      const bars = tiingoSplits.get(symbol);
      if (!bars.some((b) => Number.isFinite(b.splitFactor))) return { factor: 1, source: "not_checked" };
      const day = entryIso.slice(0, 10);
      return { factor: bars.filter((b) => b.date > day && b.splitFactor > 0 && b.splitFactor !== 1).reduce((f, b) => f * b.splitFactor, 1), source: "tiingo_daily_split_factors" };
    }
    async function metric(entry, last) {
      if (!entry || entry.status !== "ok") return { status: entry?.status || "unavailable", entry: null };
      const split = await splitFor(entry.symbol || "", entry.time);
      const factor = split?.factor || 1;
      const adj = Math.round((entry.price / factor) * 1e6) / 1e6;
      const ent = { ...entry, splitFactor: factor, splitSource: split?.source || "not_checked", splitAdjustedPrice: adj };
      if (!last || last.status !== "ok") return { status: last?.status === "quota" ? "quota" : "no_latest_price", entry: ent };
      if (Date.parse(last.time) < Date.parse(entry.time)) return { status: "awaiting_newer_price", entry: ent };
      return { status: "ok", entry: ent, changePct: Math.round((last.price / adj - 1) * 1e6) / 1e6 };
    }
    // Fixed-horizon exits: split-adjusted SIP daily closes for every symbol with an entry.
    const withEntry = pending.filter((x) => x.e.primary?.status === "ok");
    const fromDay = withEntry.map((x) => String(x.e.primary.time).slice(0, 10)).sort()[0];
    const entrySyms = withEntry.map((x) => x.base.symbol);
    const regFrom = pending.filter((x) => x.e.regular?.status === "ok").map((x) => String(x.e.regular.time).slice(0, 10)).sort()[0];
    const splitFrom = [fromDay, regFrom].filter(Boolean).sort()[0];
    const closes = withEntry.length && prices.getDailyCloses ? await prices.getDailyCloses(entrySyms, { from: fromDay }) : {};
    const regSyms = pending.filter((x) => x.e.regular?.status === "ok").map((x) => x.base.symbol);
    const rawCloses = (withEntry.length || regSyms.length) && prices.getDailyCloses ? await prices.getDailyCloses([...new Set([...entrySyms, ...regSyms])], { from: splitFrom, adjustment: "raw" }) : {};
    // Regular entries can predate fromDay only if no primary exists; make sure split-adjusted closes cover them too.
    if (regSyms.some((sym) => !closes[sym]) && prices.getDailyCloses) Object.assign(closes, await prices.getDailyCloses(regSyms.filter((sym) => !closes[sym]), { from: splitFrom }));
    // Strategy entries are never earlier than the acceptance-based ones; add closes (split and
    // raw, for split factors) only for symbols not loaded yet, plus the SPY benchmark.
    const stratOk = pending.filter((x) => x.st?.status === "ok");
    if (stratOk.length && prices.getDailyCloses) {
      const stFrom = stratOk.map((x) => etParts(x.st.time).date).sort()[0];
      const need = [...new Set([...stratOk.map((x) => x.base.symbol), STRATEGY_BENCHMARK])];
      const missSplit = need.filter((sym) => !closes[sym]);
      if (missSplit.length) Object.assign(closes, await prices.getDailyCloses(missSplit, { from: stFrom }));
      const missRaw = need.filter((sym) => !rawCloses[sym]);
      if (missRaw.length) Object.assign(rawCloses, await prices.getDailyCloses(missRaw, { from: stFrom, adjustment: "raw" }));
    }
    const splitAdjusted = async (symbol, m) => {
      const split = await splitFor(symbol, m.time);
      const factor = split?.factor || 1;
      return { ...m, splitFactor: factor, splitSource: split?.source || "not_checked", splitAdjustedPrice: Math.round((m.price / factor) * 1e6) / 1e6 };
    };
    for (const x of pending) {
      const { s, base, e } = x;
      const last = latest[base.symbol];
      const lastOut = last?.status === "ok" ? { ...last, ageMs: Math.max(0, nowMs - Date.parse(last.time)), session: sessionOf(last.time) } : last || { status: "unavailable" };
      const primary = await metric(e.primary && { ...e.primary, symbol: base.symbol }, last);
      const regular = await metric(e.regular && { ...e.regular, symbol: base.symbol }, last);
      if (primary.entry) {
        const c = closes[base.symbol];
        primary.horizons = c ? horizonReturns({ entry: primary.entry, closes: c, nowMs }) : Object.fromEntries(FIXED_HORIZONS.map((n) => [n, { status: "bars_unavailable" }]));
      } else primary.horizons = Object.fromEntries(FIXED_HORIZONS.map((n) => [n, { status: "no_entry" }]));
      let strategy;
      if (x.st?.status === "ok") {
        const entry = await splitAdjusted(base.symbol, x.st);
        const benchEntry = x.bt?.status === "ok" ? await splitAdjusted(STRATEGY_BENCHMARK, x.bt) : x.bt;
        strategy = strategyReturn({ entry, closes: closes[base.symbol] || null, benchEntry, benchCloses: closes[STRATEGY_BENCHMARK] || null, n: strategyCfg.horizonSessions, costBps: strategyCfg.costPerSideBps, nowMs });
      } else strategy = { status: x.st?.status || "unavailable", horizonSessions: strategyCfg.horizonSessions };
      rows[s.id] = { ...base, status: primary.status, latest: lastOut, primary, regular, strategy: { ...x.timing, ...strategy } };
    }
    // market.session: the U.S. equity session right now (pre | regular | post | closed, NYSE calendar).
    if (!background) prices.flushEntries?.(); // inline (CLI) runs persist their lookups before returning
    const pendingRows = Object.values(rows).filter((r) => r.primary?.status === "lookup_queued" || r.regular?.status === "lookup_queued" || r.strategy?.status === "lookup_queued" || r.strategy?.benchmarkStatus === "lookup_queued").length;
    return {
      generatedAt: new Date(nowMs).toISOString(), market: { session: sessionOf(new Date(nowMs).toISOString()) }, rows, providers: prices.stats(),
      // The run's user strategy over its selected horizon (actionable returns, gross / net / SPY).
      strategy: (() => {
        const summary = strategySummary(Object.values(rows).map((r) => r.strategy));
        return { config: strategyCfg, summary, reliability: assessReliability({ coverage: result.coverage, summary }) };
      })(),
      // Background pricing progress (rows still waiting for an entry lookup).
      pricing: { pendingRows, totalRows: Object.keys(rows).length, queuedNow, ...(prices.pricingStats ? prices.pricingStats() : {}) },
    };
  }

  function isRecheckDueOne(m) {
    return !!(m && m.status !== "ok" && m.status !== "lookup_queued" && m.checkedAt
      && now() - Date.parse(m.checkedAt) >= (String(m.status).startsWith("awaiting") ? 5 * 60_000 : 15 * 60_000));
  }
  function isRecheckDue(e) {
    return isRecheckDueOne(e.primary) || isRecheckDueOne(e.regular);
  }

  // INFORMATIONAL: possible IPO allocations among each signal's purchases (ipoContext.js).
  // Never changes signals, values or returns.
  // EVENT STUDY of the SEC publications that came AFTER a signal, for that company: each
  // later Form 4 code-P publication (one event per SEC acceptance time) measured from its
  // OWN acceptance with the run's execution rules (latency, session rule, N sessions, costs,
  // SPY). Separate from — and never mixed into — the signal's strategy returns; the signal
  // and its entry are never rewritten. Each event uses only its own, then-public filing.
  // Lookups are budgeted per request; the rest is queued ("lookup_queued").
  async function eventStudy({ result, signalId, lookupBudget = 30 }) {
    const sg = result.signals.find((s) => s.id === signalId);
    if (!sg) return null;
    const ctx = dataset();
    const accepted = ctx.dataset.acceptedAtByAccession;
    const cfg = result.config || {};
    const T = String(sg.publishedAt).replace(/\s*ET$/, "");
    const byPub = new Map();
    for (const r of ctx.snap.economic) {
      if (r.code !== "P" || r.amendment?.status === "superseded" || Number(r.issuerCik) !== Number(sg.issuerCik)) continue;
      const at = knownAtOf(r, accepted);
      if (!at || at <= T) continue; // only publications AFTER the signal
      const roles = rowBacktestRoles(r);
      if (cfg.openMarketOnly && r.purchaseContext !== "open_market") continue;
      if (cfg.roles?.length && !roles.some((g) => cfg.roles.includes(g))) continue;
      if (cfg.maxFilingDelayDays != null && filingDelayDays(r, at) > cfg.maxFilingDelayDays) continue;
      const e = byPub.get(at) || byPub.set(at, { publishedAt: `${at} ET`, purchases: [] }).get(at);
      e.purchases.push({
        insider: r.owners?.[0]?.name || r.insiderName || "Unknown", roles, transactionDate: r.transactionDate, shares: r.shares ?? null,
        valueUsd: r.priceCheck?.status === "anomaly" ? null : r.value ?? null, accessionNo: r.accessionNo || null, url: r.filingUrl || null,
      });
    }
    const events = [...byPub.values()].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt)).slice(0, 60);
    const sc = strategyConfigOf(cfg);
    const regularOnly = sc.entrySession !== "extended";
    const symbol = String(sg.ticker || "").trim().toUpperCase().replace(/-/g, ".");
    const budget = { left: lookupBudget };
    const nowMs = now();
    const out = [];
    for (const ev of events) {
      const availableIso = availableAtIso(ev.publishedAt, sc.executionLatencySeconds);
      const startIso = entrySearchStart(availableIso, sc.entrySession);
      const base = { ...ev, insiders: new Set(ev.purchases.map((p) => p.insider)).size, valueUsd: Math.round(ev.purchases.reduce((a, p) => a + (p.valueUsd || 0), 0) * 100) / 100, availableAt: availableIso, entrySearchStart: startIso };
      if (!symbol || !startIso || !prices.getEntryAt) { out.push({ ...base, strategy: { status: symbol ? "invalid_publication_time" : "no_ticker" } }); continue; }
      let st = await prices.getEntryAt(symbol, ev.publishedAt, startIso, { regularOnly, budget });
      if (st?.status === "lookup_queued" && prices.enqueueEntryAt) prices.enqueueEntryAt(symbol, ev.publishedAt, startIso, { regularOnly });
      let bt = null;
      if (st?.status === "ok") {
        bt = await prices.getEntryAt(STRATEGY_BENCHMARK, null, st.time, { regularOnly, budget });
        if (bt?.status === "lookup_queued" && prices.enqueueEntryAt) prices.enqueueEntryAt(STRATEGY_BENCHMARK, null, st.time, { regularOnly });
      }
      out.push({ ...base, st, bt });
    }
    const okRows = out.filter((x) => x.st?.status === "ok");
    let closes = {};
    if (okRows.length && prices.getDailyCloses) {
      const from = okRows.map((x) => etParts(x.st.time).date).sort()[0];
      closes = await prices.getDailyCloses([symbol, STRATEGY_BENCHMARK], { from });
    }
    const adj = async (sym, m) => {
      const f = (await prices.getSplitFactor?.(sym, m.time))?.factor || 1;
      return { ...m, splitFactor: f, splitAdjustedPrice: Math.round((m.price / f) * 1e6) / 1e6 };
    };
    const rowsOut = [];
    for (const x of out) {
      const { st, bt, ...rest } = x;
      if (x.strategy) { rowsOut.push(x); continue; }
      const strategy = st?.status === "ok"
        ? strategyReturn({ entry: await adj(symbol, st), closes: closes[symbol] || null, benchEntry: bt?.status === "ok" ? await adj(STRATEGY_BENCHMARK, bt) : bt, benchCloses: closes[STRATEGY_BENCHMARK] || null, n: sc.horizonSessions, costBps: sc.costPerSideBps, nowMs })
        : { status: st?.status || "unavailable", horizonSessions: sc.horizonSessions };
      rowsOut.push({ ...rest, strategy });
    }
    const summary = strategySummary(rowsOut.map((r) => r.strategy));
    return {
      generatedAt: new Date(nowMs).toISOString(), signalId, issuerCik: sg.issuerCik, ticker: sg.ticker, signalPublishedAt: sg.publishedAt,
      basis: "subsequent_sec_publications", note: "Each later SEC publication is measured from its own acceptance time with the run's execution rules. Separate from the signal's returns; the signal snapshot and entry are unchanged.",
      config: sc, events: rowsOut, eventsTotal: byPub.size, eventsShown: rowsOut.length, summary,
      reliability: assessReliability({ coverage: result.coverage, summary }),
    };
  }

  async function ipoContext({ result }) {
    const ctx = dataset();
    const accepted = ctx.dataset.acceptedAtByAccession;
    const items = result.signals.map((s) => {
      // The purchases behind this signal: same issuer, inside its window, and already public
      // at its publication time (the point-in-time rule of signals.js). Never rows that only
      // became public later, even when one of their reports shares a filing with the signal.
      const T = String(s.publishedAt).replace(/\s*ET$/, "");
      const rows = ctx.snap.economic.filter((r) => r.code === "P" && Number(r.issuerCik) === Number(s.issuerCik)
        && r.transactionDate >= s.windowFrom && r.transactionDate <= s.windowTo
        && (knownAtOf(r, accepted) || "9999") <= T)
        .map((r) => ({ ...r, identityOwners: [...(r.owners || []), ...(r.reportedBy || []).flatMap((rep) => (rep.rowId === r.id ? [] : ctx.snap.rawById.get(rep.rowId)?.owners || []))] }));
      return { id: s.id, issuerCik: s.issuerCik, rows };
    });
    return { generatedAt: new Date(now()).toISOString(), signals: await ipo.classify(items) };
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

  async function run(config, opts = {}) {
    const ctx = dataset();
    const provider0 = getProvider();
    const cacheKey = JSON.stringify([config, ctx.key, easternToday(now()), describePriceProvider(provider0)]);
    const hit = runCache.get(cacheKey);
    if (hit) return hit;
    const result = await runUncached(config, opts, ctx);
    runCache.set(cacheKey, result);
    while (runCache.size > 8) runCache.delete(runCache.keys().next().value);
    return result;
  }

  async function runUncached(config, { onProgress = () => {} } = {}, ctx) {
    const started = now();
    const today = easternToday(started);
    onProgress({ stage: "loading", done: 0, total: 0 });
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
      reportOwners: (rowId) => ctx.snap.rawById.get(rowId)?.owners,
      reportRow: (rowId) => ctx.snap.rawById.get(rowId), // point-in-time versions of duplicate groups
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

  // ---- Monthly per-buyer study (monthlyStudy.js + exitRules.js) ----
  const studyCache = new Map(); // config + data version + cutoff → evaluated study (core, all types)
  async function studyCore(cfg, { onProgress = () => {} } = {}) {
    const ctx = dataset();
    const key = JSON.stringify([cfg.months, cfg.thresholdUsd, cfg.latencySeconds, cfg.cutoff, cfg.priorDisclosure, ctx.key]);
    if (studyCache.has(key)) return studyCache.get(key);
    const t0 = now();
    onProgress({ stage: "signals" });
    const rows = ctx.snap.economic;
    const fxTable = await fxRates.getRates(fxNeeds(rows, cfg.months));
    const det = detectMonthlySignals({
      rows, acceptedAtByAccession: ctx.dataset.acceptedAtByAccession, months: cfg.months, thresholdUsd: cfg.thresholdUsd,
      reportOwners: (rowId) => ctx.snap.rawById.get(rowId)?.owners, reportRow: (rowId) => ctx.snap.rawById.get(rowId),
      fx: fxRates.lookupFrom(fxTable),
    });
    for (const s of det.signals) s.symbol = symbolOf(s.ticker);
    onProgress({ stage: "prices", signals: det.signals.length });
    const syms = [...new Set(det.signals.map((s) => s.symbol).filter(Boolean))];
    const firstTrade = det.signals.reduce((m, s) => (s.tradeDateFrom < m ? s.tradeDateFrom : m), `${cfg.months[0]}-01`);
    const from = addDaysIso(firstTrade, -10);
    let split = {}, raw = {}, priceError = null;
    try {
      split = await prices.getDailyBars([...syms, STRATEGY_BENCHMARK], { from, adjustment: "split", through: cfg.cutoff });
      raw = await prices.getDailyBars(syms, { from, adjustment: "raw", through: cfg.cutoff });
    } catch (err) { priceError = "price_source_failed"; console.warn(`[MONTHLY_STUDY_PRICES] error=${String(err?.message || err).slice(0, 160)}`); }
    const items = det.signals.map((sig) => ({
      sig,
      ev: evaluateSignal(sig, { bars: sig.symbol ? split[sig.symbol] : null, rawBars: sig.symbol ? raw[sig.symbol] : null, spyBars: split[STRATEGY_BENCHMARK] || null, cutoff: cfg.cutoff, latencySeconds: cfg.latencySeconds }),
    }));
    for (const it of items) if (it.ev.status === "na" && it.ev.naReason === "no_price_series" && priceError) it.ev.naReason = priceError;
    if (cfg.priorDisclosure) {
      onProgress({ stage: "disclosures" });
      // Window: from the earliest trade date of the purchases in the filing(s) that crossed the
      // threshold (not of every purchase in the month — a late filing can reach back years).
      const fromDayOf = (sig) => sig.purchases.filter((p) => sig.crossingAccessions.includes(p.accessionNo)).map((p) => p.transactionDate).sort()[0] || sig.tradeDateFrom;
      const res = await disclosures.check(items.map((it) => ({ id: it.sig.id, issuerCik: it.sig.issuerCik, fromDay: fromDayOf(it.sig), publishedAt: it.sig.publishedAt, accessionNo: it.sig.crossingAccessions[0] })));
      for (const it of items) it.disclosure = res[it.sig.id] || null;
    }
    const first = `${cfg.months[0]}-01`, lastM = cfg.months.at(-1);
    const end = new Date(Date.parse(`${lastM}-01T00:00:00Z`)); end.setUTCMonth(end.getUTCMonth() + 1); end.setUTCDate(0);
    const core = {
      generatedAt: new Date(now()).toISOString(), items, examined: det.examined, stats: det.stats,
      coverage: monthlyCoverage({ from: first, to: end.toISOString().slice(0, 10), store: ctx.store, live: ctx.live, today: easternToday(now()) }),
      prices: { provider: "alpaca_sip_daily_ohlc", adjustment: "split (raw for split factors)", licence: "internal", benchmark: STRATEGY_BENCHMARK, benchmarkAvailable: !!split[STRATEGY_BENCHMARK], error: priceError, symbolsRequested: syms.length, symbolsWithBars: syms.filter((s) => split[s]?.size).length },
      fx: [...fxTable].map(([k, v]) => ({ key: k, ...(v || { rate: null }) })),
      runMs: now() - t0,
    };
    studyCache.set(key, core);
    while (studyCache.size > 6) studyCache.delete(studyCache.keys().next().value);
    console.log(`[MONTHLY_STUDY] months=${cfg.months.join(",")} threshold=${cfg.thresholdUsd} signals=${items.length} priced=${items.filter((i) => i.ev.status === "ok").length} cutoff=${cfg.cutoff} durationMs=${core.runMs}`);
    return core;
  }

  // Public study result (config from normalizeStudyConfig). full = include every signal's
  // 195-rule grid and the examined-purchases audit list (CLI report).
  async function monthlyStudy(cfg, { full = false, onProgress } = {}) {
    const core = await studyCore(cfg, { onProgress });
    const items = core.items.map((it) => ({ ...it, filtered: passesTypes(it.sig, cfg) }));
    const inScope = items.filter((it) => it.filtered);
    const perMonth = Object.fromEntries(cfg.months.map((m) => [m, gridSummary(inScope.filter((it) => it.sig.month === m), { view: "signal" })]));
    return {
      generatedAt: core.generatedAt, config: cfg, methodology: STUDY_METHODOLOGY,
      purchaseTypes: PURCHASE_TYPES.map((t) => ({ key: t, label: PURCHASE_TYPE_LABELS[t] })),
      grid: { targets: TP_GRID, horizons: HOLD_DAYS, focusTargets: FOCUS_TARGETS, costScenariosBps: COST_SCENARIOS_BPS, priceScaleBand: PRICE_SCALE_BAND },
      coverage: core.coverage, prices: core.prices, fx: core.fx, stats: core.stats,
      counts: { signals: items.length, inFilter: inScope.length },
      summary: { signal: gridSummary(inScope, { view: "signal" }), consolidated: gridSummary(inScope, { view: "consolidated" }) },
      perMonth,
      selection: pointInTimeSelection(inScope, { rule: DEFAULT_TRACK_RULE }),
      signals: inScope.map((it) => studyRow(it, { full })),
      examined: full ? core.examined : undefined,
      runMs: core.runMs,
    };
  }

  // Owners: track records over every month held (default rule, threshold and latency).
  function allMonthsConfig(body = {}) {
    const store = loadStore();
    const days = [...store.days.keys()].sort();
    const months = [];
    if (days.length) { let m = days[0].slice(0, 7); const last = easternToday(now()).slice(0, 7); while (m <= last) { months.push(m); const d = new Date(`${m}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1); m = d.toISOString().slice(0, 7); } }
    return normalizeStudyConfig({ ...body, months, priorDisclosure: false }, now());
  }
  async function owners(filters = {}, body = {}) {
    const n = allMonthsConfig(body);
    if (n.error) return n;
    const core = await studyCore(n.config);
    return { config: n.config, rankMin: RANK_MIN, rule: { ...DEFAULT_TRACK_RULE, label: ruleLabel(DEFAULT_TRACK_RULE) }, owners: ownersList(core.items, filters), generatedAt: core.generatedAt };
  }
  async function ownerProfile(cik, body = {}) {
    const n = allMonthsConfig(body);
    if (n.error) return n;
    const core = await studyCore(n.config);
    const ctx = dataset();
    const p = buildOwnerProfile({ cik, rawRows: [...ctx.snap.rawById.values()], items: core.items });
    return p ? { config: n.config, rankMin: RANK_MIN, rule: { ...DEFAULT_TRACK_RULE, label: ruleLabel(DEFAULT_TRACK_RULE) }, methodology: STUDY_METHODOLOGY, ...p } : null;
  }

  return {
    status, run, track, companyTrack, current, publicationNow, eventStudy, ipoContext, coverageByMonth, normalize: (b) => normalizeRunConfig(b, now()),
    monthlyStudy, normalizeStudy: (b) => normalizeStudyConfig(b, now()), owners, ownerProfile,
  };
}
