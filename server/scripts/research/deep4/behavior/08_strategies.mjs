// deep4/behavior/08_strategies.mjs — phase 6/7 on the DESIGN segment: baselines, no-insider controls and the candidates of
// candDefs.mjs (exact rules), each with the full strategyLib metric set, cost sensitivity, winners and losers.
//   node --max-old-space-size=6144 scripts/research/deep4/behavior/08_strategies.mjs
import { loadDesign, writeJson, writeCsv, checkpoint, r4, L4, AGENT } from "./common.mjs";
import * as SL from "../panel/strategyLib.mjs";
import { runRule, headline, winnersLosersDetailed } from "./stratLib.mjs";
import { ALL_RULES, prepareContext } from "./candDefs.mjs";

const { rows, C } = loadDesign({ controls: true });
const M = SL.marketFor(L4.DESIGN_END);
const ctx = prepareContext(rows, { segment: "design" });
const byKey = new Map(rows.map((r) => [r.key, r]));
const out = { builtAt: new Date().toISOString(), segment: "design", market: "strategyLib.marketFor(2026-06-15): no bar on/after the cutoff is read", rules: {} };
const tradeRows = [];
for (const rule of ALL_RULES()) {
  L4.registerHypothesis({ agent: AGENT, id: rule.id, family: "behavior.S strategies (design metrics; confirmation once)", familySize: ALL_RULES().length, preRegistered: rule.kind !== "exploratory", statement: rule.text, rationale: rule.kind === "baseline" ? "simple baseline required by the brief" : rule.kind === "exploratory" ? "POST-HOC exploratory reference (design reference row seen first); verdict capped at PROMISING BUT UNVALIDATED" : "candidate", test: "strategyLib.strategyMetrics on independent trades" });
  const res = runRule({ M, rows, controls: C, select: (e) => rule.select(e, ctx), label: rule.id });
  const wl = winnersLosersDetailed(res.trades, byKey, 12);
  const ind = new Set(SL.independentTrades(res.trades).map((t) => t.key));
  out.rules[rule.id] = { id: rule.id, kind: rule.kind, text: rule.text, events: res.events, skipped: res.skipped, headline: headline(res.metrics), controlHeadline: headline(res.ctlMetrics), metrics: res.metrics, controlMetrics: res.ctlMetrics, winnersLosers: wl };
  for (const t of res.trades) tradeRows.push({ rule: rule.id, key: t.key, person: t.person, ticker: t.sym, issuer: t.issuer, publishedAt: t.publishedAt, entryDate: t.entryDate, exitDate: t.exitDate, entryPrice: t.entryPrice, exitPrice: t.exitPrice,
    costBps: t.costBps, gross: t.gross, net: t.net, spyRet: t.spyRet, xsNet: t.xsNet, independent: ind.has(t.key) ? 1 : 0, ctlMeanXsNet: (() => { const cs = res.ctl.get(t.key) || []; return cs.length ? cs.reduce((a, c) => a + c.xsNet, 0) / cs.length : null; })() });
}
writeJson("strategies-design.json", out);
writeCsv("strategy-trades-design.csv", tradeRows);
checkpoint("08_strategies", { rules: Object.keys(out.rules) });
for (const [id, r] of Object.entries(out.rules)) { console.log(`\n=== ${id} (${r.kind}) events ${r.events}`); console.log(JSON.stringify(r.headline)); console.log("control:", JSON.stringify({ n: r.controlHeadline.n, meanXsNet: r.controlHeadline.meanXsNet, medianXsNet: r.controlHeadline.medianXsNet, pf: r.controlHeadline.profitFactorVsSpy, pfReturn: r.controlHeadline.pfReturn })); }
