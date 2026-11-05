// deep4/behavior/11_summary.mjs — post-confirmation summary (written AFTER the frozen run started; reads saved outputs only):
// frozen pass criteria, agent-wide BH over all design p-values of agent behavior, candidates.json, winners / losers files.
//   node scripts/research/deep4/behavior/11_summary.mjs
import fs from "node:fs";
import path from "node:path";
import { L4, AGENT, readJson, writeJson, checkpoint, r4, bh } from "./common.mjs";

const fz = JSON.parse(fs.readFileSync(L4.agentFrozenFile(AGENT), "utf8"));
const conf = readJson("confirm-results.json"), des = readJson("strategies-design.json");
const famA = readJson("familyA.json"), famC = readJson("familyC.json"), cons = readJson("consistency.json");
// ---------------- agent-wide BH over every DESIGN p-value of this agent (families P, A, A.sec, C) ----------------
const res = fs.readFileSync(path.join(L4.DEEP4, "registry-results.jsonl"), "utf8").trim().split("\n").map(JSON.parse).filter((r) => r.agent === AGENT && r.result && r.result.segment !== "confirm");
const tests = [];
for (const r of res) { const p = r.result.p ?? null; if (typeof p === "number" && Number.isFinite(p)) tests.push({ id: r.id, p, est: r.result.mean ?? r.result.rho ?? r.result.r ?? r.result.est ?? null }); }
const q = bh(tests.map((t) => t.p)); tests.forEach((t, i) => { t.qAgent = r4(q[i]); });
const agentBH = { tests: tests.length, qBelow10: tests.filter((t) => t.qAgent < 0.1).map((t) => ({ id: t.id, est: t.est, p: t.p, q: t.qAgent })) };
// ---------------- frozen pass criteria ----------------
const S = conf.strategies, s1 = S["behavior.S1x.firstObserved"]?.headline, s0 = S["behavior.S0.all"]?.headline;
const x2 = (h) => { const m = /2x:(-?[\d.e-]+)/.exec(h?.costs || ""); return m ? Number(m[1]) : null; };
const crit = s1 ? { meanPos: s1.meanXsNet > 0, tGe165: (s1.t ?? -9) >= 1.65, vsCtlPos: (s1.vsControls?.diff ?? -9) > 0, x2Pos: (x2(s1) ?? -9) > 0, beatsBaseline: s1.meanXsNet > (s0?.meanXsNet ?? Infinity) } : null;
const s1Pass = crit ? Object.values(crit).every(Boolean) : false;
const c04 = conf.familyC.results.find((x) => x.id === "behavior.C04");
const c04Pass = c04 ? c04.rho > 0 && c04.pPerm < 0.05 : false;
const verdicts = {
  "behavior.S1x.firstObserved": { criteria: crit, pass: s1Pass, verdict: s1Pass ? "PROMISING BUT UNVALIDATED (post-hoc exploratory; confirmation alone cannot validate)" : "REJECTED" },
  "behavior.C04 (persistence of own unrealised record; ranking only)": { confirm: c04, replicated: c04Pass, verdict: c04Pass ? "ranking replicated (not a strategy: quintiles negative in design)" : "not replicated" },
};
// ---------------- candidates.json ----------------
const pick = (h) => h && { n: h.n, issuers: h.issuers, months: h.months, meanXsNet: h.meanXsNet, medianXsNet: h.medianXsNet, winRateVsSpy: h.winRateVsSpy, profitFactorVsSpy: h.profitFactorVsSpy, t: h.t, p: h.p, exTop5: h.exTop5, vsControls: h.vsControls, costs: h.costs, pfReturn: h.pfReturn, pfSpy: h.pfSpy, pfMaxDD: h.pfMaxDD };
writeJson("candidates.json", {
  agent: AGENT, builtAt: new Date().toISOString(), candidates: [], note: fz.candidatesNote,
  exploratoryReference: fz.exploratory.map((e) => ({ ...e, execution: fz.execution, design: pick(des.rules[e.id]?.headline), confirm: pick(S[e.id]?.headline), verdict: verdicts[e.id]?.verdict ?? null })),
  baselines: fz.baselines.map((b) => ({ ...b, execution: fz.execution, design: pick(des.rules[b.id]?.headline), confirm: pick(S[b.id]?.headline), designNoInsiderControl: pick(des.rules[b.id]?.controlHeadline), confirmNoInsiderControl: pick(S[b.id]?.controlHeadline) })),
});
// ---------------- winners / losers (design + confirm) ----------------
const wl = {};
for (const id of Object.keys(S)) wl[id] = { design: des.rules[id]?.winnersLosers ?? null, confirm: S[id].winnersLosers };
writeJson("winners-losers.json", wl);
const summary = { builtAt: new Date().toISOString(), frozenAt: fz.frozenAt, agentBH, verdicts, confirmCounts: conf.counts,
  confirmFamilyC: conf.familyC.results, confirmWF30: conf.familyC.walkForward30.selected, confirmWF5: conf.familyC.walkForward5rec.selected, confirmCoverage: conf.familyC.coverage,
  confirmFamilyA: conf.familyA.map((a) => ({ id: a.id, n30: a.n30, mean: a.mean, t: a.t, vsCtl: a.vsControls30.diff })), confirmContrasts: conf.contrasts, confirmStyle: conf.styleConsistencyAcrossPeriods };
writeJson("summary.json", summary);
checkpoint("11_summary", { agentBHtests: tests.length, s1Pass, c04Pass });
console.log(JSON.stringify({ agentBH: { tests: agentBH.tests, nQ10: agentBH.qBelow10.length, list: agentBH.qBelow10 }, verdicts }, null, 1));
