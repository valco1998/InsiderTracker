// deep4/learn/strategies.mjs — phase 6/7: the pre-declared strategy conversion (spec.strategies) with exact rules, full
// strategyMetrics, gates, no-floor and cost sensitivity, matched-control comparison, winners/losers with chart descriptions.
//   node --max-old-space-size=8192 scripts/research/deep4/learn/strategies.mjs [--segment=design]
import fs from "node:fs";
import { loadEvents, loadCtl, inUniverse, readOut, writeOut, outPath, checkpoint, toCsv, mean, median, L4 } from "./common.mjs";
import * as SL from "../panel/strategyLib.mjs";
import * as E from "./evalLib.mjs";
import { decide, ruleTrade } from "./famBLib.mjs";

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split("=")[1] : d; };
const SEGMENT = arg("segment", "design");
if (SEGMENT === "confirm" && !fs.existsSync(L4.agentFrozenFile("learn"))) throw new Error("confirm needs learn/frozen.json first");
const spec = readOut("spec.json");
const segs = SEGMENT === "design" ? ["design"] : SEGMENT === "confirm" ? ["design", "confirm"] : ["design", "confirm", "exposed"]; // AUDIT COPY (T3): exposed segment
const P = loadEvents({ segments: segs }), C = loadCtl({ segments: segs });
const U = P.rows.filter((r) => inUniverse(r) && r.segment === SEGMENT);
const M = SL.marketFor(SEGMENT === "design" ? L4.DESIGN_END : null);
const FLOOR = 1e6, SLOTS = 20, CAP = 1, EXIT = SL.exits.calendar(30);
const floorOk = (r) => r.dv20 >= FLOOR;

// ---- pre-declared conversion (design top-base t / family-B evc30 t) ----
const conv = (() => {
  if (SEGMENT !== "design") return readOut("strategies-design.json").conversion;
  const T = readOut("wf-design/tests.json");
  const pool = T.filter((t) => t.type === "topBase" && /\.(M1|M2|M4|TREE|D1|D2|EN)\.top-base$/.test(t.id)).map((t) => ({ id: t.id, target: t.id.split(".")[2], model: t.id.split(".")[3], z: t.z, estimate: t.estimate }));
  pool.sort((a, b) => b.z - a.z);
  const models = pool.filter((p) => p.z > 0).slice(0, 2);
  const fb = readOut("famB-design.json").tests.filter((t) => t.id.endsWith(".evc30")).map((t) => ({ id: t.id, rule: t.id.split(".")[2], t: t.t, estimate: t.estimate })).sort((a, b) => b.t - a.t);
  return { modelPool: pool, chosenModels: models, famBPool: fb, chosenRule: fb[0] && fb[0].t > 0 ? fb[0] : null };
})();
console.log("conversion:", JSON.stringify({ models: conv.chosenModels.map((m) => `${m.target}.${m.model} z ${m.z.toFixed(2)}`), rule: conv.chosenRule ? `${conv.chosenRule.rule} t ${conv.chosenRule.t}` : null }));

// ---- selections ----
const recsOf = (t, m) => readOut(`wf-${SEGMENT}/recs-${t}-${m}.json`).recs;
const wfMonths = readOut(`wf-${SEGMENT}/run-xs30-M4.json`).months;
const byKey = new Map(U.map((r) => [r.key, r]));
const strategies = [];
const S0wf = U.filter((r) => wfMonths.includes(r.month) && floorOk(r));
const S0all = U.filter(floorOk);
strategies.push({ id: "S0", label: "baseline: all universe events (walk-forward months)", rows: S0wf });
strategies.push({ id: "S0all", label: "baseline: all universe events (all segment months)", rows: S0all });
conv.chosenModels.forEach((m, i) => {
  const sel = new Set(recsOf(m.target, m.model).filter((r) => r.sel).map((r) => r.key));
  strategies.push({ id: `S${i + 1}`, label: `model ${m.model} (${m.target}) executable top quintile`, model: m, rows: S0wf.filter((r) => sel.has(r.key)), rowsNoFloor: U.filter((r) => wfMonths.includes(r.month) && sel.has(r.key)) });
});
if (conv.chosenRule) {
  const G80 = spec.familyB.G80, rule = conv.chosenRule.rule;
  const pass = (r) => decide(M, rule, r.sym, r.entryDate, G80).pass;
  strategies.push({ id: "S3", label: `family-B ${rule}`, rule, rows: S0all.filter(pass), rowsNoFloor: U.filter(pass), compareTo: "S0all" });
}

// ---- trades, controls, metrics ----
function controlTrades(rows, rule = null) {
  const out = new Map();
  for (const r of rows) {
    const ts = [];
    for (const c of C.of(r.key)) {
      let t;
      if (!rule) { const j0 = M.idx.get(c.entryDate); if (j0 == null || c.costBps == null) continue; t = SL.tradeAt(M, M.aligned(c.sym), j0, EXIT, { costPerSide: c.costBps / 1e4 }); }
      else t = ruleTrade(M, c.sym, decide(M, rule, c.sym, c.entryDate, spec.familyB.G80), 30, c.costBps);
      if (t.status === "ok") ts.push({ key: c.ctlKey, issuer: c.sym, sym: c.sym, ticker: c.sym, costBps: c.costBps, costMult: 1, costPerSide: c.costBps / 1e4, ...t });
    }
    out.set(r.key, ts);
  }
  return out;
}
const tradesOf = (rows, rule = null) => {
  if (!rule) return SL.tradesForEvents(M, rows, EXIT);
  const trades = [], skipped = {};
  for (const r of rows) { const d = decide(M, rule, r.sym, r.entryDate, spec.familyB.G80); const t = ruleTrade(M, r.sym, d, 30, r.costBps); if (t.status !== "ok") { skipped[t.status] = (skipped[t.status] || 0) + 1; continue; } trades.push({ key: r.key, issuer: r.cik, ticker: r.sym, sym: r.sym, segment: r.segment, month: r.month, publishedAt: r.publishedAt, person: r.person, costBps: r.costBps, costMult: 1, costPerSide: r.costBps / 1e4, spec: `${rule}+close@30d`, ...t }); }
  return { trades, skipped };
};
const describe = (t) => { const r = byKey.get(t.key); if (!r) return {};
  return { ticker: r.sym, issuer: r.issuer, role: r.primaryRole, usd: r.usd, prior60: `r5 ${(r.r5 * 100).toFixed(1)}% r20 ${(r.r20 * 100).toFixed(1)}% from60dHigh ${(r.dHi60 * 100).toFixed(1)}% vol20 ${(r.vol20 * 100).toFixed(1)}% volSurge ${r.volSurge?.toFixed(2)}`,
    gapAtEntry: r.gapEntry, pathAfter: `MFE30 ${(r.B_mfe30 * 100).toFixed(1)}% MAE30 ${(r.B_mae30 * 100).toFixed(1)}% touch10 ${r.B_hit10_30}`, priorBuysPerson: r.pPriorOm, priorBuysIssuer: r.iBuysPrior, window: r.window }; };
const result = { segment: SEGMENT, conversion: conv, template: spec.strategies.template, months: wfMonths, strategies: {} };
const s0Trades = new Map();
for (const S of strategies) {
  const { trades, skipped } = tradesOf(S.rows, S.rule ? S.rule : null);
  const ctl = controlTrades(S.rows, S.rule ?? null);
  const met = SL.strategyMetrics(trades, { controlTrades: ctl, slots: SLOTS, perCompanyCap: CAP, costMults: [0, 1, 2, 3], B: 2000, market: M, label: `${S.id} ${S.label}` });
  if (S.id === "S0" || S.id === "S0all") s0Trades.set(S.id, trades);
  // no-floor sensitivity
  let noFloor = null;
  if (S.rowsNoFloor) { const nf = tradesOf(S.rowsNoFloor, S.rule ?? null); const m2 = nf.trades.length ? SL.strategyMetrics(nf.trades, { slots: SLOTS, perCompanyCap: CAP, B: 200, market: M }) : { n: 0 }; noFloor = { n: m2.n, nAll: m2.nAll ?? 0, meanXsNet: m2.meanXsNet ?? null, medianXsNet: m2.medianXsNet ?? null, companyStats: m2.companyStats ?? null }; }
  // gates (design + confirm): g2 = month-adjusted difference vs the baseline's trades (joint issuer bootstrap)
  let g2 = null;
  if (S.id.startsWith("S") && !S.id.startsWith("S0")) {
    const base = s0Trades.get(S.compareTo ?? "S0"), mine = new Set(SL.independentTrades(trades).map((t) => t.key));
    const items = base.map((t) => ({ issuer: t.issuer, month: t.entryDate.slice(0, 7), sel: mine.has(t.key), y: t.xsNet }));
    g2 = E.bootTopBase(items, { B: 2000 });
  }
  const months = met.monthTable || [];
  const gates = S.id.startsWith("S0") || !met.n ? null : {
    g1: met.meanXsNet > 0, g2: g2 ? g2.estimate > 0 && g2.p < 0.10 : null, g3: met.vsControls?.diff?.mean > 0, g4: met.companyStats?.meanExTop5Issuers > 0,
    g5: (met.costSensitivity.find((c) => c.mult === 2)?.meanXsNet ?? -1) > 0, g6: months.length ? months.filter((m) => m.mean > 0).length / months.length >= 0.6 : false,
  };
  const wl = trades.length ? SL.winnersLosers(SL.independentTrades(trades), 12) : { winners: [], losers: [] };
  const wlDesc = { winners: wl.winners.map((w) => ({ ...w, ...describe(w) })), losers: wl.losers.map((w) => ({ ...w, ...describe(w) })) };
  result.strategies[S.id] = { id: S.id, label: S.label, model: S.model ?? null, rule: S.rule ?? null, nRows: S.rows.length, skipped, metrics: met, vsBaseline: g2, gates, gatesPassed: gates ? Object.values(gates).filter(Boolean).length : null, noFloor, winnersLosers: wlDesc };
  fs.writeFileSync(outPath(`strategy-${SEGMENT}-${S.id}-trades.csv`), toCsv(trades.map((t) => ({ key: t.key, ticker: t.sym, issuer: t.issuer, month: t.month, entryDate: t.entryDate, entryPrice: t.entryPrice, exitDate: t.exitDate, exitPrice: t.exitPrice, costPerSide: t.costPerSide, gross: t.gross, net: t.net, spyRet: t.spyRet, xsNet: t.xsNet })), ["key", "ticker", "issuer", "month", "entryDate", "entryPrice", "exitDate", "exitPrice", "costPerSide", "gross", "net", "spyRet", "xsNet"]));
}
// the no-insider control strategy SC: unique matched-control stock-days of S0's events, same entry/exit
{
  const ctl = controlTrades(S0wf); const uniq = new Map(); for (const ts of ctl.values()) for (const t of ts) if (!uniq.has(t.key)) uniq.set(t.key, { ...t, month: t.entryDate.slice(0, 7), segment: SEGMENT });
  const met = SL.strategyMetrics([...uniq.values()], { slots: SLOTS, perCompanyCap: CAP, costMults: [0, 1, 2, 3], B: 500, market: M, label: "SC matched non-insider control stock-days of S0" });
  result.strategies.SC = { id: "SC", label: "no-insider control (matched stock-days of S0's events)", metrics: met };
}
writeOut(`strategies-${SEGMENT}.json`, result);
checkpoint(`strategies-${SEGMENT}`, { ids: Object.keys(result.strategies) });
const pc = (x) => (x == null ? "-" : `${(x * 100).toFixed(2)}%`);
for (const [id, S] of Object.entries(result.strategies)) {
  const m = S.metrics;
  if (!m || !m.n) { console.log(`
${id} ${S.label}: no trades`); continue; }
  console.log(`\n${id} ${S.label}: nAll ${m.nAll} independent ${m.n} issuers ${m.issuers} months ${m.months} | win ${pc(m.winRateNet)} vsSPY ${pc(m.winRateVsSpy)} | meanNet ${pc(m.meanNet)} medNet ${pc(m.medianNet)} meanSPY ${pc(m.meanSpy)} | meanXsNet ${pc(m.meanXsNet)} med ${pc(m.medianXsNet)} | PF ${m.profitFactorNet?.toFixed(2)} PFvsSPY ${m.profitFactorVsSpy?.toFixed(2)}`);
  console.log(`   companyStats t ${m.companyStats?.t} p ${m.companyStats?.p?.toFixed(3)} exTop5 ${pc(m.companyStats?.meanExTop5Issuers)} ci ${JSON.stringify(m.companyStats?.ci95)} | vsControls ${m.vsControls ? `${pc(m.vsControls.diff?.mean)} t ${m.vsControls.diff?.t} (ctl ${pc(m.vsControls.controlMean)})` : "-"} | costs ${m.costSensitivity.map((c) => `x${c.mult} ${pc(c.meanXsNet)}`).join(" ")}`);
  console.log(`   portfolio simple ${JSON.stringify(m.portfolio?.simple)} | cash ret ${m.portfolio?.cash?.totalReturn ?? m.portfolio?.cash?.ret} maxDD ${m.portfolio?.cash?.maxDrawdown} exposure ${m.portfolio?.exposureMean} timeInMkt ${m.portfolio?.timeInMarket} | worst ${JSON.stringify(m.worstTrade)}`);
  console.log(`   months ${m.monthTable.map((x) => `${x.month.slice(2)} n${x.n} ${pc(x.mean)}`).join(" | ")}`);
  if (S.vsBaseline) console.log(`   vs baseline (month-adjusted, joint bootstrap): ${pc(S.vsBaseline.estimate)} z ${S.vsBaseline.z?.toFixed(2)} p ${S.vsBaseline.p?.toFixed(3)}`);
  if (S.gates) console.log(`   gates ${JSON.stringify(S.gates)} passed ${S.gatesPassed}/6 | noFloor ${S.noFloor ? `${S.noFloor.n} ${pc(S.noFloor.meanXsNet)}` : "-"}`);
}
