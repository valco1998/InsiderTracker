// deep3/targets/exec.mjs — executability of the PROMISING pattern rules through deep2/execution/execLib.evaluate()
// (nextOpen entry with the 09:28 MOO cut-off, close of session 5, requireVolume, excludeSuspects, tier x1/x2, 20-slot
// one-per-issuer portfolio), discovery and confirmation, plus the limit-fill APPROXIMATION portfolio (custom trades
// through execLib.simulatePortfolio2; clearly labelled). Registered before computing.
//   node scripts/research/deep3/targets/exec.mjs
import * as X from "../../deep2/execution/execLib.mjs";
import { reg, rec, isRegistered, readOut, writeOut, checkpoint, r4, mean, median, toCsv, quant } from "./common.mjs";
import { patternList } from "./defs.mjs";
import { loadRows } from "./stats.mjs";

const prom = readOut("promising.json").promising.filter((x) => x.promising);
const TH = readOut("thresholds.json");
const PL = new Map(patternList(TH).map((p) => [p.id, p]));
const pats = [...new Set(prom.map((x) => x.pattern))];
const fam = "targets-EX executability of promising pattern rules (execLib)";
for (const pid of pats) {
  for (const per of ["discover", "confirm"]) for (const m of [1, 2]) reg({ id: `targets-EX-${pid}-${per}-x${m}`, family: fam, familySize: pats.length * 6,
    statement: `${per}: rule ${pid}, execLib nextOpen (MOO cut-off 09:28) -> close of session 5, requireVolume, excludeSuspects, tier cost x${m}: mean net excess vs SPY > 0 (and 20-slot one-per-issuer portfolio).`,
    rationale: "Executable version of the pattern (official auction prices only)." });
  for (const per of ["discover", "confirm"]) reg({ id: `targets-EX-${pid}-${per}-tpApprox`, family: fam, familySize: pats.length * 6,
    statement: `${per}: rule ${pid}, LIMIT-FILL APPROXIMATION (+10% target, -10% stop, else close of session 5; worst-case ordering; 0.5% fill buffer) in a 20-slot one-per-issuer portfolio: mean net excess vs SPY > 0.`,
    rationale: "Upper bound on what a resting limit order could add; not executable from daily bars with certainty." });
}

const rows = loadRows();
const E = X.L.loadEvents();
const byId = new Map(E.map((e) => [e.id, e]));
const streak = (vals) => { let best = 0, cur = 0; for (const v of vals) { if (v < 0) { cur++; best = Math.max(best, cur); } else cur = 0; } return best; };
function ddDuration(curve) { let peak = -Infinity, peakI = 0, longest = 0; curve.forEach(([d, eq], i) => { if (eq >= peak) { peak = eq; peakI = i; } else longest = Math.max(longest, i - peakI); }); return longest; }
function metrics(ok, portfolio, holdingSessions) {
  const net = ok.map((x) => x.net), xs = ok.map((x) => x.excessNet);
  const pos = net.filter((v) => v > 0).reduce((a, b) => a + b, 0), neg = -net.filter((v) => v < 0).reduce((a, b) => a + b, 0);
  const byDate = [...ok].sort((a, b) => (a.entryDate < b.entryDate ? -1 : a.entryDate > b.entryDate ? 1 : 0));
  const worst = [...ok].sort((a, b) => a.net - b.net).slice(0, 5).map((x) => ({ sym: x.sym, entryDate: x.entryDate, exitDate: x.exitDate, net: r4(x.net), excessNet: r4(x.excessNet) }));
  const best = [...ok].sort((a, b) => b.net - a.net).slice(0, 5).map((x) => ({ sym: x.sym, entryDate: x.entryDate, net: r4(x.net), excessNet: r4(x.excessNet) }));
  const cap = (usd) => r4(ok.filter((x) => (x.capacityUsd ?? 0) >= usd).length / Math.max(1, ok.length));
  return {
    trades: ok.length, issuers: new Set(ok.map((x) => x.issuerCik)).size, winRateNet: r4(net.filter((v) => v > 0).length / Math.max(1, net.length)), winRateVsSpy: r4(xs.filter((v) => v > 0).length / Math.max(1, xs.length)),
    meanNet: r4(mean(net)), medianNet: r4(median(net)), meanNetVsSpy: r4(mean(xs)), medianNetVsSpy: r4(median(xs)), profitFactor: neg > 0 ? r4(pos / neg) : null,
    worstTrades: worst, bestTrades: best, longestLosingStreakTrades: streak(byDate.map((x) => x.net)), holdingSessions,
    meanRoundTripCostBps: Math.round(mean(ok.map((x) => (x.costIn + x.costOut) * 1e4)) || 0),
    liquidity: { medianCapacityUsdAt1pctADV: Math.round(median(ok.map((x) => x.capacityUsd ?? 0)) || 0), shareSupporting10k: cap(1e4), shareSupporting50k: cap(5e4), shareSupporting250k: cap(2.5e5) },
    portfolio: portfolio ? { totalReturn: portfolio.totalReturn, maxDrawdown: portfolio.maxDrawdown, drawdownDurationSessions: portfolio.curve ? ddDuration(portfolio.curve.map((c) => [c[0], c[1]])) : null, worstMonth: portfolio.worstMonth, worstDay: portfolio.worstDay,
      meanExposure: portfolio.meanExposure, meanConcurrency: portfolio.meanConcurrency, maxConcurrency: portfolio.maxConcurrency, tradesTaken: portfolio.trades, skipped: portfolio.skipped, tradeWinRate: portfolio.tradeWinRate,
      meanTradePnl: portfolio.meanTradePnl, spyTotal: portfolio.spy?.totalReturn, excessVsSpy: portfolio.excessVsSpy, start: portfolio.start, end: portfolio.end, sessions: portfolio.sessions, months: portfolio.months } : null,
  };
}
const out = {}; const curves = [];
for (const pid of pats) {
  const p = PL.get(pid);
  out[pid] = {};
  for (const per of ["discover", "confirm"]) {
    const ids = new Set(rows.filter((r) => r.per === per && (p.universe === "om" ? r.cls === "om" : true) && p.f(r)).map((r) => r.id));
    const base = { entry: "nextOpen", exitSessions: 5, mooCutoff: "09:28:00", requireVolume: true, excludeSuspects: true, costModel: "tier", period: per, filter: (e) => ids.has(e.id), slots: 20, onePerIssuer: true };
    const res = {};
    for (const [lab, o] of [["x1", { costMultiplier: 1 }], ["x2", { costMultiplier: 2 }], ["x3", { costMultiplier: 3 }], ["spread", { costModel: "spread", costMultiplier: 1 }], ["delay1_x1", { delaySessions: 1, costMultiplier: 1 }]]) {
      const r = X.evaluate(E, { ...base, ...o });
      res[lab] = { stats: { n: r.stats.n, issuers: r.stats.issuers, mean: r.stats.mean, median: r.stats.median, t: r.stats.t, p: r.stats.p, meanExTop5Issuers: r.stats.meanExTop5Issuers, issuerMedianOfMeans: r.stats.issuerMedianOfMeans, ci95: r.stats.ci95, meanGross: r.stats.meanGross, meanSpy: r.stats.meanSpy }, statusCounts: r.statusCounts, metrics: metrics(r.ok, r.portfolio, 5) };
      if (lab === "x1" || lab === "x2") { const id = `targets-EX-${pid}-${per}-${lab}`; if (!isRegistered(id)) throw new Error(id); rec(id, { ...res[lab].stats, portfolio: res[lab].metrics.portfolio && { totalReturn: res[lab].metrics.portfolio.totalReturn, maxDrawdown: res[lab].metrics.portfolio.maxDrawdown, excessVsSpy: res[lab].metrics.portfolio.excessVsSpy } }); }
      if (lab === "x1" && r.portfolio?.curve) for (const c of r.portfolio.curve) curves.push({ pattern: pid, period: per, rule: "close5_tier_x1", date: c[0], equity: c[1], positions: c[2], spy: c[3] });
      if (lab === "x1") writeOut(`exec-trades-${pid}-${per}.csv`, toCsv(r.ok.map((x) => ({ id: x.id, sym: x.sym, issuerCik: x.issuerCik, publishedAt: x.publishedAt, entryDate: x.entryDate, entryPrice: x.entryPrice, exitDate: x.exitDate, exitPrice: x.exitPrice, gross: x.gross, spyRet: x.spyRet, costIn: x.costIn, costOut: x.costOut, net: x.net, excessNet: x.excessNet, capacityUsd: x.capacityUsd, asTradedEntry: x.asTradedEntry })),
        ["id", "sym", "issuerCik", "publishedAt", "entryDate", "entryPrice", "exitDate", "exitPrice", "gross", "spyRet", "costIn", "costOut", "net", "excessNet", "capacityUsd", "asTradedEntry"]));
    }
    // limit-fill approximation portfolio (from the same entry; trades built from events.json path outcomes)
    const tpRows = rows.filter((r) => ids.has(r.id) && r.o?.tp10s10n5 != null && !X.SUSPECT_SYMBOLS.has(r.s));
    const trades = tpRows.map((r) => { const t = r.o.tp10s10n5_t; const exitDate = X.L.loadBars().get("SPY").arr[r.j + t].d; const px = r.entryPrice * (1 + r.o.tp10s10n5_ret) * (1 + r.cost / 1e4) / (1 - r.cost / 1e4);
      return { id: r.id, issuer: r.issuer, sym: r.s, publishedAt: r.publishedAt, entryDate: r.entryDate, entryWhen: "open", entryPrice: r.entryPrice, exitDate, exitWhen: "close", exitPrice: px, costIn: r.cost / 1e4, costOut: r.cost / 1e4, capacityUsd: 0, why: r.o.tp10s10n5_why, x: r.o.tp10s10n5, net: r.o.tp10s10n5_ret }; });
    const port = X.simulatePortfolio2(trades, { slots: 20, onePerIssuer: true });
    const okLike = trades.map((t) => ({ ...t, net: t.net, excessNet: t.x, issuerCik: t.issuer, costIn: t.costIn, costOut: t.costOut, capacityUsd: null }));
    res.tpApprox = { note: "APPROXIMATION: limit +10% / stop -10% / close of session 5 on daily bars (worst-case ordering, 0.5% fill buffer); exits on the fill session are booked at the fill price", n: trades.length,
      fills: trades.filter((t) => t.why === "tp").length, stops: trades.filter((t) => t.why === "stop").length, timeExits: trades.filter((t) => t.why === "time").length, metrics: metrics(okLike, port, r4(mean(tpRows.map((r) => r.o.tp10s10n5_t)))) };
    { const id = `targets-EX-${pid}-${per}-tpApprox`; if (!isRegistered(id)) throw new Error(id); const xs = trades.map((t) => ({ issuer: t.issuer, x: t.x })); const cs = X.L.companyStats(xs); rec(id, { n: cs.n, issuers: cs.issuers, mean: cs.mean, median: cs.median, t: cs.t, p: cs.p, meanExTop5Issuers: cs.meanExTop5Issuers, portfolio: { totalReturn: port.totalReturn, maxDrawdown: port.maxDrawdown, excessVsSpy: port.excessVsSpy } }); res.tpApprox.stats = cs; }
    out[pid][per] = res;
  }
}
writeOut("exec-results.json", { generatedAt: new Date().toISOString(), note: "execLib.evaluate on stage-C events filtered to the pattern; tier costs unless noted; 20 slots, one position per issuer, equal weight; SPY over the same days", results: out });
writeOut("exec-equity-curves.csv", toCsv(curves, ["pattern", "period", "rule", "date", "equity", "positions", "spy"]));
checkpoint("executability (execLib) of promising rules", { patterns: pats, file: "exec-results.json" });
const f = (v) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(2)}%`);
for (const pid of pats) for (const per of ["discover", "confirm"]) {
  const R = out[pid][per];
  for (const lab of ["x1", "x2", "x3", "spread", "delay1_x1"]) { const s = R[lab].stats, m = R[lab].metrics; console.log(`${pid} ${per} ${lab.padEnd(9)} n ${s.n} mean ${f(s.mean)} med ${f(s.median)} t ${s.t} exTop5 ${f(s.meanExTop5Issuers)} | win ${m.winRateVsSpy} PF ${m.profitFactor} worst ${m.worstTrades[0]?.sym} ${f(m.worstTrades[0]?.net)} | port ${f(m.portfolio?.totalReturn)} DD ${f(m.portfolio?.maxDrawdown)} SPY ${f(m.portfolio?.spyTotal)} exp ${m.portfolio?.meanExposure} streak ${m.longestLosingStreakTrades} cap10k ${m.liquidity.shareSupporting10k}`); }
  const T = R.tpApprox, m = T.metrics; console.log(`${pid} ${per} tpApprox  n ${T.n} fills ${T.fills} stops ${T.stops} time ${T.timeExits} mean ${f(T.stats.mean)} med ${f(T.stats.median)} t ${T.stats.t} | PF ${m.profitFactor} port ${f(m.portfolio?.totalReturn)} DD ${f(m.portfolio?.maxDrawdown)} SPY ${f(m.portfolio?.spyTotal)} hold ${m.holdingSessions}`);
}
