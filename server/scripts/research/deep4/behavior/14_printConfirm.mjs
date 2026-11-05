// deep4/behavior/14_printConfirm.mjs — print compact confirmation tables from confirm-results.json (read-only).
//   node scripts/research/deep4/behavior/14_printConfirm.mjs
import { readJson, checkpoint } from "./common.mjs";
const c = readJson("confirm-results.json"), d = readJson("strategies-design.json");
const p = (x) => (x == null ? "-" : (x * 100).toFixed(2));
for (const [id, s] of Object.entries(c.strategies)) {
  for (const [seg, h, ch] of [["design", d.rules[id].headline, d.rules[id].controlHeadline], ["confirm", s.headline, s.controlHeadline]])
    console.log(`${id.padEnd(28)} ${seg.padEnd(7)} n ${h.n} iss ${h.issuers} mean ${p(h.meanXsNet)} med ${p(h.medianXsNet)} win ${p(h.winRateVsSpy)} PF ${h.profitFactorVsSpy} t ${h.t} exTop5 ${p(h.exTop5)} vsCtl ${p(h.vsControls?.diff)} (p ${h.vsControls?.p?.toFixed?.(3)}) costs ${h.costs} | pf ${p(h.pfReturn)} vs SPY ${p(h.pfSpy)} maxDD ${p(h.pfMaxDD)} expo ${h.exposure} tim ${h.timeInMarket} | months+ ${h.monthsPositive}/${h.months} | CONTROL n ${ch.n} mean ${p(ch.meanXsNet)} med ${p(ch.medianXsNet)} pf ${p(ch.pfReturn)} maxDD ${p(ch.pfMaxDD)}`);
}
for (const k of ["walkForward30", "walkForward5rec"]) { const w = c.familyC[k]; console.log(k, "selected", JSON.stringify(w.selected), "notSelected", JSON.stringify(w.notSelected)); console.log("  months", JSON.stringify(w.months.map((m) => [m.month, m.trainN, m.selectedN, m.selectedMean, m.notSelectedMean]))); console.log("  numeric", JSON.stringify(w.numeric)); }
console.log("C08/C09 confirm", JSON.stringify(c.familyC.results.filter((x) => x.kind === "select").map((x) => ({ id: x.id, n: x.n, mean: x.mean, t: x.t, unsel: x.unselMean, vsCtl: x.vsControls30.diff, vsCtlP: x.vsControls30.p }))));
console.log("rank confirm", JSON.stringify(c.contrasts.rank));
checkpoint("final", { status: "COMPLETE: design families P/A/C, strategies, freeze, single confirmation run, summary" });
