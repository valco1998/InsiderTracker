// deep4/learn/freeze.mjs — freezes agent learn's rules and procedure BEFORE any confirmation row is loaded:
// registers the confirmation tests (family learn.confirm), writes candidates.json (design) and then frozen.json (exact rules,
// model-fitting procedure + hyperparameter grids, confirm plan, sha256 of every learn script, spec.json and dependencies).
// Refuses to run if frozen.json exists.
//   node scripts/research/deep4/learn/freeze.mjs
import fs from "node:fs";
import path from "node:path";
import { readOut, writeOut, outPath, existsOut, sha256File, SCRIPTS, register, checkpoint, L4 } from "./common.mjs";

if (existsOut("frozen.json")) { console.log("frozen.json exists — nothing to do"); process.exit(0); }
const spec = readOut("spec.json"), SD = readOut("strategies-design.json"), FB = readOut("famB-design.json"), WT = readOut("wf-design/tests.json");
const T = spec.strategies.template;
const commonRule = {
  qualifyingEvents: "SEC Form 4 code-P filing, classification v2 open-market, >= 1 valued row without price anomaly; one per person/issuer/entry session (first accepted filing of the dupKey group); the symbol has >= 26 daily bars before the entry session and an official open on it (panel: primary==1 && isPrimary==1 && featOk==1)",
  decisionTime: "SEC acceptance (ET) + 60 s",
  liquidityFloor: T.liquidityFloor, publicationTime: T.publicationTime,
  sizing: T.sizing, perCompanyCap: T.perCompanyCap, exit: T.exit, holding: T.holding, risk: T.risk, costs: T.costs,
};
const modelProc = (m) => ({
  model: m.model, target: m.target === "xs30" ? "B_xsNet30 (30-calendar-day net excess vs SPY, tier x1)" : m.target,
  features: spec.features.map((f) => `${f.name}: ${f.def}`), preprocessing: spec.preprocessing, hyperparameters: m.model === "EN" ? spec.hyperparameters.enet : spec.hyperparameters.ridge, innerCV: spec.hyperparameters.innerCV,
  monthlyRefit: "on the first calendar day of each month: training = every qualifying event (no liquidity floor) whose 30-day outcome window ended before that day (lib4.maturedBy), >= 300 events; fit once and freeze for the month",
  threshold: spec.metrics.executableSelection, signal: "buy a qualifying event (that also passes the liquidity floor) iff its prediction >= the month's frozen threshold", entry: T.entry,
});
const rules = { S0: { ...commonRule, signal: "every qualifying event that passes the liquidity floor", entry: T.entry }, SC: { description: spec.strategies.control, entry: "official open of the control stock-day's entry session", exit: T.exit, costs: T.costs } };
SD.conversion.chosenModels.forEach((m, i) => { rules[`S${i + 1}`] = { ...commonRule, ...modelProc(m), designSelection: m }; });
if (SD.conversion.chosenRule) { const r = spec.familyB.rules.find((x) => x.id === SD.conversion.chosenRule.rule); rules.S3 = { ...commonRule, familyB: r, G80: spec.familyB.G80, entry: r.entry, condition: r.condition, executionAssumption: spec.familyB.executionAssumption, designSelection: SD.conversion.chosenRule }; }

// ---- confirmation tests (registered now, before any confirmation row is read) ----
const ct = [];
for (const t of ["xs30", "hit30"]) for (const a of ["M4.skill", "M3.skill", "M2.skill", "M4-M3", "M3-M3c", "M3c.ctlSkill", "M5-M3p"]) ct.push({ id: `learn.confirm.wf.${t}.${a}`, statement: `confirm months (2026-06 confirm rows, 07, 08), frozen monthly refits: ${t} ${a} (same statistic as the design test learn.wf30.${t}.${a})` });
for (const t of ["xs5", "xs10"]) for (const a of ["M4.skill", "M4-M3"]) ct.push({ id: `learn.confirm.wf.${t}.${a}`, statement: `confirm months: ${t} ${a}` });
for (const s of ["S1", "S2", "S3"].filter((s) => rules[s])) for (const w of ["net", "vsS0", "vsCtl"]) ct.push({ id: `learn.confirm.strat.${s}.${w}`, statement: `frozen strategy ${s} on the confirmation segment: ${w === "net" ? "mean net excess (30d, independent trades) != 0" : w === "vsS0" ? "month-adjusted difference vs S0 != 0" : "minus its matched controls != 0"}` });
for (const w of ["net", "vsCtl"]) ct.push({ id: `learn.confirm.strat.S0.${w}`, statement: `baseline S0 on the confirmation segment: ${w}` });
for (const r of spec.familyB.rules) ct.push({ id: `learn.confirm.famB.${r.id}.evc30`, statement: `family-B ${r.id} on confirmation: events minus matched controls passing the same rule (30d)` });
for (const i of ["I4.hit30", "I5.xs30"]) ct.push({ id: `learn.confirm.int.${i}`, statement: `interaction ${i} on confirmation events (design cut points)` });
for (const t of ct) register({ id: t.id, family: "learn.confirm", familySize: ct.length, statement: t.statement, rationale: "One-shot confirmation of the frozen learn procedure and rules (published 2026-06-15 -> 2026-08-31).", segment: "confirm" });

// ---- candidates.json (design) ----
const cand = Object.entries(SD.strategies).filter(([id]) => /^S[123]$/.test(id)).map(([id, S]) => ({
  id, label: S.label, rule: rules[id], design: { months: SD.months, metrics: { n: S.metrics.n, nAll: S.metrics.nAll, issuers: S.metrics.issuers, meanXsNet: S.metrics.meanXsNet, medianXsNet: S.metrics.medianXsNet, meanNet: S.metrics.meanNet, meanSpy: S.metrics.meanSpy,
    winRateNet: S.metrics.winRateNet, winRateVsSpy: S.metrics.winRateVsSpy, profitFactorNet: S.metrics.profitFactorNet, companyStats: S.metrics.companyStats, vsControls: S.metrics.vsControls, costSensitivity: S.metrics.costSensitivity, monthTable: S.metrics.monthTable, portfolio: S.metrics.portfolio?.cash, worstTrade: S.metrics.worstTrade },
    vsBaseline: S.vsBaseline, gates: S.gates, gatesPassed: S.gatesPassed, noFloor: S.noFloor },
  designStage: S.gates && S.gates.g1 && S.gates.g2 && S.gatesPassed >= 4 ? "meets the PROMISING design criteria (pending confirmation)" : "fails the design gates (REJECTED at design stage)",
}));
writeOut("candidates.json", cand);

// ---- hashes and frozen.json (written last) ----
const scripts = Object.fromEntries(fs.readdirSync(SCRIPTS).filter((f) => f.endsWith(".mjs")).sort().map((f) => [f, sha256File(path.join(SCRIPTS, f))]));
const dep = (rel) => path.join(SCRIPTS, "..", rel);
const deps = Object.fromEntries(["lib4.mjs", "panel/data.mjs", "panel/walkforward.mjs", "panel/history.mjs", "panel/strategyLib.mjs", "panel/panelLib.mjs"].map((r) => [r, sha256File(dep(r))]));
const frozen = {
  frozenAt: new Date().toISOString(), agent: "learn",
  statement: "Frozen before any confirmation-segment row was loaded by agent learn. The confirmation run (confirm.mjs) executes once.",
  specSha256: sha256File(outPath("spec.json")), scripts, deps,
  rules, conversion: SD.conversion,
  procedure: { features: spec.features, featureSets: spec.featureSets, preprocessing: spec.preprocessing, models: spec.models, hyperparameters: spec.hyperparameters, walkForward: spec.walkForward, metrics: spec.metrics, familyB: spec.familyB, interactions: { pairs: spec.interactions.pairs, tercileCuts: spec.interactions.tercileCuts } },
  confirmPlan: ["wf.mjs --segment=confirm (all targets/models; monthly refits exactly as in design; months 2026-06 (confirm rows), 2026-07, 2026-08)", "familyB.mjs --segment=confirm", "strategies.mjs --segment=confirm (S0, S0all, S1-S3, SC; selections from the confirm walk-forward)", "interactions.mjs --segment=confirm", "confirmTests.mjs", "report.mjs --segment=confirm"],
  confirmTests: ct.map((t) => ({ id: t.id, family: "learn.confirm", familySize: ct.length })),
  verdictRules: spec.strategies.verdicts, gates: spec.strategies.gates,
  designKeyTests: Object.fromEntries(["S1", "S2"].filter((s) => rules[s]).map((s) => { const m = rules[s].designSelection; const t = WT.find((x) => x.id === `learn.wf30.${m.target}.${m.model}.top-base`); return [s, { id: t.id, estimate: t.estimate, z: t.z, p: t.p }]; })),
};
writeOut("frozen.json", frozen);
checkpoint("freeze", { frozenSha256: sha256File(outPath("frozen.json")), confirmTests: ct.length });
console.log(JSON.stringify({ frozen: outPath("frozen.json"), sha256: sha256File(outPath("frozen.json")), scripts: Object.keys(scripts).length, confirmTests: ct.length, strategies: Object.keys(rules) }, null, 1));
