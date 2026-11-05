// deep4/learn/finalize.mjs — applies the pre-declared verdict rules (spec.strategies.verdicts) mechanically to each converted
// strategy and merges the one-shot confirmation results into candidates.json. Reads outputs only (written after confirm).
//   node scripts/research/deep4/learn/finalize.mjs
import { readOut, writeOut, existsOut, checkpoint } from "./common.mjs";

if (!existsOut("confirm-done.json")) throw new Error("run the confirmation first");
const cand = readOut("candidates.json"), SD = readOut("strategies-design.json"), SC = readOut("strategies-confirm.json"), CT = readOut("confirm-tests.json"), BH = readOut("bh.json"), F = readOut("frozen.json");
const ct = (id) => CT.find((t) => t.id === id) || {};
const out = cand.map((c) => {
  const d = SD.strategies[c.id], k = SC.strategies[c.id], g = d.gates || {};
  const net = ct(`learn.confirm.strat.${c.id}.net`), vs0 = ct(`learn.confirm.strat.${c.id}.vsS0`), vsc = ct(`learn.confirm.strat.${c.id}.vsCtl`);
  const key = F.designKeyTests?.[c.id] ? BH.learn.find((x) => x.id === F.designKeyTests[c.id].id) : null;
  const sigNeg = (x) => x.estimate != null && x.estimate < 0 && x.p != null && x.p < 0.05;
  let verdict, why;
  if ((d.metrics.n ?? 0) < 50 || (k?.metrics?.n ?? 0) < 20) { verdict = "INSUFFICIENT DATA"; why = "fewer than 50 design or 20 confirmation independent trades"; }
  else if (!g.g1 || !g.g2) { verdict = "REJECTED"; why = `design gate failed: g1 ${g.g1}, g2 ${g.g2}`; }
  else if (sigNeg(net) || sigNeg(vs0)) { verdict = "REJECTED"; why = `confirmation significantly negative (net ${net.estimate?.toFixed(4)} p ${net.p?.toFixed(3)}; vs S0 ${vs0.estimate?.toFixed(4)} p ${vs0.p?.toFixed(3)})`; }
  else if (Object.values(g).every(Boolean) && key?.qGlobal <= 0.1 && net.estimate > 0 && vs0.estimate > 0 && vsc.estimate > 0 && k.metrics.n >= 30) { verdict = "VALIDATED FOR FURTHER PAPER TESTING"; why = "all design gates, key test global q <= 0.10, confirmation consistent"; }
  else if (d.gatesPassed >= 4) { verdict = "PROMISING BUT UNVALIDATED"; why = "g1+g2 and >= 2 more gates in design; confirmation not significantly negative"; }
  else { verdict = "REJECTED"; why = "fewer than 4 design gates"; }
  return { ...c, confirm: { metrics: k?.metrics ? { n: k.metrics.n, nAll: k.metrics.nAll, issuers: k.metrics.issuers, meanXsNet: k.metrics.meanXsNet, medianXsNet: k.metrics.medianXsNet, meanNet: k.metrics.meanNet, meanSpy: k.metrics.meanSpy, winRateNet: k.metrics.winRateNet, profitFactorNet: k.metrics.profitFactorNet, companyStats: k.metrics.companyStats, vsControls: k.metrics.vsControls, costSensitivity: k.metrics.costSensitivity, monthTable: k.metrics.monthTable, portfolio: k.metrics.portfolio?.cash, worstTrade: k.metrics.worstTrade } : null, tests: { net, vsS0: vs0, vsCtl: vsc } },
    keyDesignTest: key ? { id: key.id, p: key.p, qLearn: key.qLearn, qGlobal: key.qGlobal } : null, verdict, verdictReason: why };
});
writeOut("candidates.json", out);
writeOut("final-summary.json", { at: new Date().toISOString(), verdicts: out.map((c) => ({ id: c.id, label: c.label, verdict: c.verdict, reason: c.verdictReason })), eligibleCandidates: out.filter((c) => /VALIDATED|PROMISING/.test(c.verdict)).map((c) => c.id) });
checkpoint("finalize", { verdicts: out.map((c) => `${c.id}:${c.verdict}`) });
for (const c of out) console.log(c.id, c.label, "->", c.verdict, "|", c.verdictReason);
