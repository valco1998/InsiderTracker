// deep4/audit/b1_registerExposed.mjs — registers the single exposed-period evaluation of every frozen item (frozen-rules.json
// "evaluate") as audit4.exp.* BEFORE the exposed panel is built. Run with the exposed period still locked.
//   node scripts/research/deep4/audit/b1_registerExposed.mjs
import fs from "node:fs";
import { phaseA, register, outPath } from "./common.mjs";
phaseA(); // must run BEFORE unlocking
if (!fs.existsSync(outPath("exposed-criteria.json"))) throw new Error("write exposed-criteria.json first");
const FAM = "audit4.exp (single run of the frozen deep-4 procedures on the PREVIOUSLY EXPOSED period, published >= 2026-09-01; matured 30-day outcomes only)";
const T = [];
const strat = (id, text) => T.push({ id: `audit4.exp.${id}`, statement: `Exposed period: ${text} — mean independent-trade 30-day net excess vs SPY > 0 (pass = p < 0.05, ex-top-5 > 0, x2 costs > 0, beats matched controls).`, test: "strategyLib.strategyMetrics: issuer-clustered t (companyStats)" });
strat("behavior.S0.all", "behavior.S0.all baseline (every primary purchase)");
strat("behavior.S0.liq", "behavior.S0.liq baseline (cost tier <= 35 bps)");
strat("behavior.S1x.firstObserved", "behavior.S1x.firstObserved (post-hoc exploratory reference)");
for (let i = 1; i <= 11; i++) strat(`behavior.A${String(i).padStart(2, "0")}`, `family-A rule behavior.A${String(i).padStart(2, "0")} (frozen selection, S0.all execution)`);
strat("behavior.C08", "family-C selection C08 (person EB30 > 0, >= 1 matured 30d outcome)");
strat("behavior.C09", "family-C selection C09 (person EB5 > 0, >= 1 matured 5d outcome)");
strat("behavior.C10", "family-C walk-forward selection C10 (monthly pool prior; person EB30 > 0)");
for (const s of ["S0", "S0all", "S1", "S2", "S3", "SC"]) strat(`learn.${s}`, `learn strategy ${s} (frozen rules in learn/frozen.json; conversion from strategies-design.json)`);
const MODELS = { xs30: ["M1", "M2", "M3", "M4", "M3c", "M3p", "M5", "TREE", "EN", "D1", "D2"], hit30: ["M1", "M2", "M3", "M4", "M3c", "M3p", "M5", "TREE", "D1", "D2"] };
for (const [t, ms] of Object.entries(MODELS)) for (const m of ms) T.push({ id: `audit4.exp.wf.${t}.${m}.skill`, statement: `Exposed period walk-forward ${t === "xs30" ? "IC" : "AUC"} of ${m} on events ${t === "xs30" ? "> 0" : "> 0.5"} (monthly refits on matured outcomes, frozen spec).`, test: "learn evalLib.bootSkill, issuer-block bootstrap B=1000" });
for (const t of ["xs30", "hit30"]) for (const d of ["M4-M3", "M5-M3p"]) T.push({ id: `audit4.exp.wf.${t}.${d}`, statement: `Exposed period paired skill difference ${d} (${t}) > 0: insider information adds to price features.`, test: "learn evalLib.bootSkillDiff B=1000" });
T.push({ id: "audit4.exp.wf.xs30.M3-M3c", statement: "Exposed period paired IC difference M3 (event-trained technical) minus M3c (controls-trained) on events (xs30).", test: "learn evalLib.bootSkillDiff B=1000" });
T.push({ id: "audit4.exp.gen.M3c.topRest.events", statement: "Exposed period: controls-trained M3c within-month top quintile minus rest (realised B_xsNet30) on insider events > 0.", test: "issuer-block bootstrap B=1000" });
T.push({ id: "audit4.exp.gen.M3c.topRest.controls", statement: "Exposed period: M3c within-month top quintile minus rest on matched-control stock-days > 0.", test: "symbol-block bootstrap B=1000" });
T.push({ id: "audit4.exp.gen.M3c.topRest.evMinusCtl", statement: "Exposed period: M3c top-minus-rest on events minus the same on controls != 0 (insider-specific component of the generic model).", test: "two-sample bootstrap B=1000" });
T.push({ id: "audit4.exp.ctl.base", statement: "Exposed period: primary purchases minus their frozen-panel matched controls (30-day net excess) > 0.", test: "V.matchedDiff issuer bootstrap B=1000" });
T.push({ id: "audit4.exp.ctl.rebuildPIT", statement: "Exposed period (diagnostic): primary purchases minus REBUILT point-in-time controls (backward-only exclusion, symbol already insider-bought) > 0.", test: "V.matchedDiff issuer bootstrap B=1000" });
let n = 0; for (const t of T) n += register({ ...t, family: FAM, familySize: T.length, preRegistered: true, posthoc: false, segment: "exposed", rationale: "frozen-rules.json evaluate list; criteria in audit/exposed-criteria.json" }) ? 1 : 0;
console.log(`registered ${n} new audit4.exp ids (family size ${T.length})`);
