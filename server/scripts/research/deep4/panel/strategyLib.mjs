// deep4/panel/strategyLib.mjs — shared trade construction + the user's full strategy metric set (agent "panel").
//
//   import * as SL from "../panel/strategyLib.mjs";
//   const M = SL.marketFor(L4.DESIGN_END);                         // price cutoff: never reads a bar on/after it
//   const spec = SL.exits.limit({ target: 0.10, stop: 0.10, maxDays: 30 });   // or exits.calendar(20) / exits.sessions(5)
//   const { trades, skipped } = SL.tradesForEvents(M, rows, spec);  // rows: panel rows (or any {key, cik, sym, entryDate, costBps, ...})
//   const ctl = SL.controlTradesFor(M, rows, controls, spec);       // same rule on each event's matched controls (data.mjs loadControls)
//   const report = SL.strategyMetrics(trades, { controlTrades: ctl, slots: 10, perCompanyCap: 1 });
//
// Fills (deep-2/3 rules; daily bars only): entry at the official OPEN of the entry session (or its official CLOSE with
// entryWhen "close"), optionally delayed by k sessions ("wait for confirmation": only bars completed before that open may be
// used by the rule that chose the trade); exits at an official CLOSE, or a limit / stop approximation:
//   target: first session whose high >= target*(1.005) → fill max(open, target); stop: first session whose low <= stop → fill
//   min(open, stop); if both in one session the STOP is assumed first (worst case). Time exit = close of the horizon session.
// Costs: per-side fraction c (tier bps / 1e4 × multiplier); net = exit*(1-c)/(entry*(1+c)) - 1; SPY over the same fills, never charged.
import * as L4 from "../lib4.mjs";
import * as PL from "./panelLib.mjs";
import * as V from "../../deep3/dataquality/validate.mjs";
import { simulatePortfolio2 } from "../../deep2/execution/execLib.mjs";

const { addDays, sessionOnOrBefore, sessionAfter, mean, median, r6 } = PL;
const markets = new Map();
export const marketFor = (cutoff = L4.DESIGN_END) => { const k = cutoff ?? "none"; if (!markets.has(k)) markets.set(k, PL.createMarket({ cutoff })); return markets.get(k); };

// ---------------- exit specifications ----------------
export const exits = {
  calendar: (days) => ({ type: "calendar", days }),                     // close of the last session <= entry date + days
  sessions: (n) => ({ type: "sessions", n }),                           // close of the n-th session after the entry session
  limit: ({ target = null, stop = null, maxDays = null, maxSessions = null } = {}) => {
    if (maxDays == null && maxSessions == null) throw new Error("exits.limit: give maxDays or maxSessions (time exit)");
    return { type: "limit", target, stop, maxDays, maxSessions };
  },
};
const specLabel = (s) => (s.type === "calendar" ? `close@${s.days}d` : s.type === "sessions" ? `close@${s.n}s` : `limit(tp ${s.target ?? "-"}, sl ${s.stop ?? "-"}, time ${s.maxDays != null ? `${s.maxDays}d` : `${s.maxSessions}s`})`);

// One position: entry on session index jE (open or close), exit by `spec`. Returns { status, ... }.
export function tradeAt(M, A, jE, spec, { entryWhen = "open", costPerSide = 0 } = {}) {
  if (!A) return { status: "no_bars" };
  if (jE == null || jE < 0 || jE >= M.nS) return { status: "entry_after_cache" };
  const entryDate = M.days[jE];
  if (M.cutoff && entryDate >= M.cutoff) return { status: "embargo", entryDate };
  if (entryDate > PL.COMPLETE_THROUGH) return { status: "censored", entryDate };
  const k0 = PL.barOn(A, jE);
  if (k0 < 0) return { status: "no_entry_bar", entryDate };
  const eb = A.arr[k0], entryPrice = entryWhen === "close" ? eb.c : eb.o;
  if (!(entryPrice > 0)) return { status: "no_entry_price", entryDate };
  const S = M.spy.arr, spyEntry = entryWhen === "close" ? S[jE].c : S[jE].o;
  // scheduled time-exit session
  let exitDate;
  if (spec.type === "calendar" || (spec.type === "limit" && spec.maxDays != null)) exitDate = sessionOnOrBefore(addDays(entryDate, spec.type === "calendar" ? spec.days : spec.maxDays));
  else exitDate = sessionAfter(entryDate, spec.type === "sessions" ? spec.n : spec.maxSessions);
  if (entryWhen === "close" && exitDate <= entryDate) exitDate = sessionAfter(entryDate, 1);
  const base = { entryDate, entryWhen, entryPrice, spyEntry, scheduledExit: exitDate };
  if (M.cutoff && exitDate >= M.cutoff) return { status: "embargo", ...base };
  if (exitDate > PL.COMPLETE_THROUGH) return { status: "censored", ...base };
  const jX = M.idx.get(exitDate);
  let ex;
  if (spec.type === "limit") {
    const jFrom = entryWhen === "close" ? jE + 1 : jE; // a close entry is exposed to the path from the next session
    ex = PL.limitExit(A, jFrom, jX, entryPrice, spec.target, spec.stop);
  } else {
    const kX = PL.barOn(A, jX);
    ex = { j: jX, px: kX >= 0 && A.arr[kX].c > 0 ? A.arr[kX].c : null, why: "time" };
  }
  if (!ex || !(ex.px > 0)) return { status: "no_exit_bar", ...base };
  const spyExit = S[ex.j].c, c = costPerSide;
  const gross = ex.px / entryPrice - 1, net = PL.netOf(entryPrice, ex.px, c, c), spyRet = spyExit / spyEntry - 1;
  return { status: "ok", ...base, exitDate: M.days[ex.j], exitWhen: "close", exitPrice: ex.px, exitWhy: ex.why, sessionsHeld: ex.j - jE, spyExit, gross, net, spyRet, xs: gross - spyRet, xsNet: net - spyRet };
}

// Trades for panel rows (or any objects with key, cik, sym, entryDate, costBps; optional segment / month / publishedAt).
// opts: entryWhen "open"|"close", delaySessions (k ≥ 0), costMult (×tier). Rows without a priced entry are counted in skipped.
export function tradesForEvents(M, rows, spec, { entryWhen = "open", delaySessions = 0, costMult = 1 } = {}) {
  const trades = [], skipped = {};
  for (const r of rows) {
    const A = r.sym ? M.aligned(r.sym) : null;
    const j0 = M.idx.get(r.entryDate);
    const costBps = r.costBps ?? r.B_costBps;
    if (j0 == null || costBps == null) { skipped.unpriced = (skipped.unpriced || 0) + 1; continue; }
    const t = tradeAt(M, A, j0 + delaySessions, spec, { entryWhen, costPerSide: (costBps * costMult) / 1e4 });
    if (t.status !== "ok") { skipped[t.status] = (skipped[t.status] || 0) + 1; continue; }
    trades.push({ key: r.key, issuer: r.cik, ticker: r.sym, sym: r.sym, segment: r.segment ?? null, month: r.month ?? r.entryDate.slice(0, 7), publishedAt: r.publishedAt ?? null,
      person: r.person ?? null, costBps, costMult, costPerSide: (costBps * costMult) / 1e4, spec: specLabel(spec), ...t });
  }
  return { trades, skipped };
}
// The same rule on each event's matched controls. controls = data.mjs loadControls(...) result. → Map(eventKey → [trades])
export function controlTradesFor(M, rows, controls, spec, { entryWhen = "open", delaySessions = 0, costMult = 1 } = {}) {
  const out = new Map();
  for (const r of rows) {
    const cs = controls.of(r.key);
    const ts = [];
    for (const c of cs) {
      const A = M.aligned(c.sym), j0 = M.idx.get(c.entryDate);
      if (j0 == null || c.costBps == null) continue;
      const t = tradeAt(M, A, j0 + delaySessions, spec, { entryWhen, costPerSide: (c.costBps * costMult) / 1e4 });
      if (t.status === "ok") ts.push({ key: c.ctlKey, issuer: c.sym, sym: c.sym, costBps: c.costBps, ...t });
    }
    out.set(r.key, ts);
  }
  return out;
}

// ---------------- metrics ----------------
// Independent trades: per issuer, a trade is kept only if it enters after the exit of the last kept trade of that issuer
// (overlapping same-issuer positions are one bet). Order: entry date, publication time, key.
export function independentTrades(trades) {
  const ts = [...trades].sort((a, b) => (a.entryDate < b.entryDate ? -1 : a.entryDate > b.entryDate ? 1 : String(a.publishedAt ?? "") < String(b.publishedAt ?? "") ? -1 : String(a.publishedAt ?? "") > String(b.publishedAt ?? "") ? 1 : String(a.key) < String(b.key) ? -1 : 1));
  const lastExit = new Map(), kept = [];
  for (const t of ts) { const le = lastExit.get(t.issuer); if (le != null && t.entryDate <= le) continue; kept.push(t); lastExit.set(t.issuer, t.exitDate); }
  return kept;
}
// Per-company cap for portfolio simulation: skip a trade when its issuer already has `cap` open positions at its entry date.
export function capPerCompany(trades, cap = 1) {
  const ts = [...trades].sort((a, b) => (a.entryDate < b.entryDate ? -1 : a.entryDate > b.entryDate ? 1 : 0));
  const open = new Map(), kept = [];
  for (const t of ts) { const xs = (open.get(t.issuer) || []).filter((e) => e >= t.entryDate); if (xs.length >= cap) { open.set(t.issuer, xs); continue; } xs.push(t.exitDate); open.set(t.issuer, xs); kept.push(t); }
  return kept;
}
const netAt = (t, m) => PL.netOf(t.entryPrice, t.exitPrice, t.costPerSide * (m / (t.costMult || 1)), t.costPerSide * (m / (t.costMult || 1)));
function ensureDerived(M, t) {
  if (t.gross != null && t.spyRet != null && t.net != null) return t;
  const S = M.spy.arr, jE = M.idx.get(t.entryDate), jX = M.idx.get(t.exitDate);
  const spyEntry = (t.entryWhen || "open") === "close" ? S[jE].c : S[jE].o, spyExit = S[jX].c;
  const gross = t.exitPrice / t.entryPrice - 1, net = PL.netOf(t.entryPrice, t.exitPrice, t.costPerSide, t.costPerSide), spyRet = spyExit / spyEntry - 1;
  return { costMult: 1, ...t, gross, net, spyRet, xs: gross - spyRet, xsNet: net - spyRet };
}
// Full metric set. trades: [{ key, issuer, ticker|sym, entryDate, entryPrice, exitDate, exitPrice, costPerSide, segment, month, … }]
// opts: controlTrades (Map eventKey → [trades]), slots, perCompanyCap, costMults, independent (primary set = independent trades),
//       B (bootstrap reps), market (for SPY / portfolio marks; default the design market).
export function strategyMetrics(tradesIn, { controlTrades = null, slots = 10, perCompanyCap = 1, costMults = [0, 1, 2, 3], independent = true, B = 2000, market = null, label = null } = {}) {
  const M = market || marketFor(L4.DESIGN_END);
  const all = tradesIn.map((t) => ensureDerived(M, { ...t, sym: t.sym || t.ticker, ticker: t.ticker || t.sym }));
  if (!all.length) return { label, n: 0 };
  const ind = independentTrades(all);
  const T = independent ? ind : all;
  const rowsX = T.map((t) => ({ issuer: t.issuer, x: t.xsNet, date: t.entryDate, insider: t.person ?? t.issuer }));
  const xs = T.map((t) => t.xsNet), nets = T.map((t) => t.net);
  // vs matched controls: per trade, trade xsNet − mean xsNet of the same rule on its controls
  let vsControls = null;
  if (controlTrades) {
    const diffs = [];
    for (const t of T) { const cs = controlTrades.get(t.key) || []; if (!cs.length) continue; diffs.push({ issuer: t.issuer, x: t.xsNet - mean(cs.map((c) => c.xsNet)), ctl: mean(cs.map((c) => c.xsNet)), ev: t.xsNet, date: t.entryDate }); }
    vsControls = diffs.length ? { n: diffs.length, eventMean: r6(mean(diffs.map((d) => d.ev))), controlMean: r6(mean(diffs.map((d) => d.ctl))), diff: L4.companyStats(diffs), diffMedian: r6(median(diffs.map((d) => d.x))),
      controlTradesPerEvent: r6(mean(T.map((t) => (controlTrades.get(t.key) || []).length))) } : { n: 0 };
  }
  // portfolio (lib4 simulatePortfolio: equal slots, daily close marks) after the per-company cap; plus the cash-accounted execLib variant
  const capped = capPerCompany(all, perCompanyCap);
  const pf1 = L4.simulatePortfolio(capped.map((t) => ({ issuer: t.issuer, ticker: t.sym, entryDate: t.entryDate, entryPrice: t.entryPrice, exitDate: t.exitDate, exitPrice: t.exitPrice, costPerSide: t.costPerSide })), { slots, bars: M.bars });
  const pf2 = simulatePortfolio2(capped.map((t) => ({ id: t.key, issuer: t.issuer, sym: t.sym, publishedAt: t.publishedAt || t.entryDate, entryDate: t.entryDate, entryWhen: t.entryWhen || "open", entryPrice: t.entryPrice,
    exitDate: t.exitDate, exitWhen: "close", exitPrice: t.exitPrice, costIn: t.costPerSide, costOut: t.costPerSide, capacityUsd: 0 })), { slots, onePerIssuer: perCompanyCap === 1, keepCurve: true });
  // time in market: share of sessions in [first entry, last exit] with at least one open position (pf2 curve, column n)
  const inMkt = pf2.curve ? pf2.curve.filter((c) => c[2] > 0).length / pf2.curve.length : null;
  const { curve: _c1, ...pf1s } = pf1; const { curve: _c2, ...pf2s } = pf2;
  // month-by-month (entry month)
  const ms = V.monthStability(rowsX, { value: "x", date: "date", issuer: "issuer" });
  const months = ms.months.map((m) => ({ month: m.month, n: m.n, issuers: m.issuers, mean: r6(m.mean), median: r6(m.median), positive: r6(m.positive), sum: r6(m.sum) }));
  // cost sensitivity on the primary set
  const costs = costMults.map((m) => { const v = T.map((t) => netAt(t, m) - t.spyRet); return { mult: m, meanXsNet: r6(mean(v)), medianXsNet: r6(median(v)), winVsSpy: r6(v.filter((x) => x > 0).length / v.length), profitFactor: r6(V.profitFactor(v).pf) }; });
  const ts = V.tradeStats(xs), es = V.eventStats(rowsX, { value: "x", issuer: "issuer", insider: "insider", date: "date", B, thinReps: 100 });
  const worst = [...T].sort((a, b) => a.xsNet - b.xsNet)[0], best = [...T].sort((a, b) => b.xsNet - a.xsNet)[0];
  const exitWhy = T.reduce((m, t) => ((m[t.exitWhy] = (m[t.exitWhy] || 0) + 1), m), {});
  return {
    label, spec: T[0]?.spec ?? null, nAll: all.length, nIndependent: ind.length, primarySet: independent ? "independent" : "all", n: T.length, issuers: new Set(T.map((t) => t.issuer)).size,
    months: new Set(T.map((t) => t.entryDate.slice(0, 7))).size, segments: [...new Set(T.map((t) => t.segment))],
    winRateNet: r6(nets.filter((x) => x > 0).length / nets.length), winRateVsSpy: r6(xs.filter((x) => x > 0).length / xs.length),
    meanNet: r6(mean(nets)), medianNet: r6(median(nets)), meanGross: r6(mean(T.map((t) => t.gross))), meanSpy: r6(mean(T.map((t) => t.spyRet))),
    meanXsNet: r6(mean(xs)), medianXsNet: r6(median(xs)), profitFactorNet: r6(V.profitFactor(nets).pf), profitFactorVsSpy: r6(V.profitFactor(xs).pf),
    worstTrade: worst && { key: worst.key, ticker: worst.sym, entryDate: worst.entryDate, xsNet: r6(worst.xsNet), net: r6(worst.net) }, bestTrade: best && { key: best.key, ticker: best.sym, entryDate: best.entryDate, xsNet: r6(best.xsNet), net: r6(best.net) },
    exitWhy, meanSessionsHeld: r6(mean(T.map((t) => t.sessionsHeld ?? 0))), tradeStats: roundObj(ts),
    companyStats: L4.companyStats(rowsX), eventStats: roundObj({ ...es, months: undefined }), monthStability: roundObj({ ...ms, months: undefined }), monthTable: months,
    vsControls, costSensitivity: costs,
    portfolio: { slots, perCompanyCap, tradesAfterCap: capped.length, simple: pf1s, cash: pf2s, exposureMean: pf2s.meanExposure ?? null, timeInMarket: r6(inMkt) },
  };
}
function roundObj(o) { if (o == null || typeof o !== "object") return typeof o === "number" ? r6(o) : o; if (Array.isArray(o)) return o.map(roundObj); return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => [k, roundObj(v)])); }

// Winners / losers listing (≥ 10 each, as the brief requires for anything promising).
export function winnersLosers(trades, k = 10) {
  const s = [...trades].sort((a, b) => b.xsNet - a.xsNet);
  const pick = (t) => ({ key: t.key, ticker: t.sym, entryDate: t.entryDate, exitDate: t.exitDate, exitWhy: t.exitWhy, xsNet: r6(t.xsNet), net: r6(t.net), gross: r6(t.gross) });
  return { winners: s.slice(0, k).map(pick), losers: s.slice(-k).reverse().map(pick) };
}
