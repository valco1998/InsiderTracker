// deep4/audit/a0_register.mjs — registers the auditor's Phase A tests (ids audit4.*) BEFORE any of them is computed.
// All are post-hoc audit tests on data the specialists already used (design) or consumed once (confirmation).
//   node scripts/research/deep4/audit/a0_register.mjs
import { phaseA, register } from "./common.mjs";
phaseA();
const FAM = "audit4.disproof (phase A; post-hoc audit of the agents' strongest findings; design + confirmation)";
const T = [];
const add = (id, statement, rationale, test) => T.push({ id, statement, rationale, test });
for (const seg of ["design", "confirm"]) {
  add(`audit4.ctl.base.${seg}`, `Primary purchases (open-market, valued, priced, isPrimary) B_xsNet30 minus the mean of their matched controls > 0 (${seg}).`, "Reproduce the '+1 point vs matched controls' finding (panel, behavior, learn).", "V.matchedDiff, issuer-clustered bootstrap B=1000, two-sided");
  add(`audit4.ctl.regadj.${seg}`, `Event-minus-control 30-day difference remains > 0 after bias-correcting for covariate imbalance (r5, r20, r60, dHi60, dLo60, mdd60, vol20, vol60, log dv20, gapPrev, sma50r) (${seg}).`, "Disproof (a): r60 SMD -0.12/-0.22, vol60 and sma50r imbalanced after matching; reversal could create the difference.", "OLS of d_i on covariate differences, intercept = adjusted effect; issuer-cluster bootstrap B=500 refitting the slope");
  add(`audit4.ctl.pitUniverse.${seg}`, `Event-minus-control difference remains > 0 when only controls whose symbol had a visible insider purchase BEFORE the control day are used (point-in-time-known universe) (${seg}).`, "Disproof (a): the bar cache holds only symbols with insider filings somewhere in the store (hindsight); controls from symbols bought only LATER are selected on a future decline.", "V.matchedDiff over events with >= 1 such control, issuer-clustered bootstrap B=1000");
  add(`audit4.ctl.fromClose.${seg}`, `Event-minus-control 30-day GROSS excess measured from the decision close (entry gap included) > 0 (${seg}).`, "Decomposition: how much of the insider-vs-control difference sits in the unmatched entry gap.", "V.matchedDiff on gross excess from the decision close, issuer-clustered B=1000");
  add(`audit4.gen.rev5.events.${seg}`, `Within-month Spearman IC of -r5 (5-session reversal) with B_xsNet30 on primary events != 0 (${seg}).`, "Disproof (b): is the only predictability a generic short-term reversal? A one-feature reversal score needs no training (no leakage possible).", "n-weighted within-month IC, issuer-block bootstrap B=1000");
  add(`audit4.gen.rev5.controls.${seg}`, `Within-month Spearman IC of -r5 with B_xsNet30 on matched-control stock-days != 0 (${seg}).`, "Disproof (b): the same reversal on non-insider stock-days.", "n-weighted within-entry-month IC, symbol-block bootstrap B=1000");
  add(`audit4.gen.m3c.evMinusCtl.${seg}`, `Learn's controls-trained M3c walk-forward IC on events minus its IC on controls != 0 (${seg}), recomputed from learn's saved predictions.`, "Disproof (b): independent recomputation of the generic-predictability claim from the saved walk-forward records.", "two-sample issuer/symbol bootstrap B=1000");
  add(`audit4.edge.lag01.${seg}`, `Primary purchases filed within 1 calendar day of the trade (lagDays <= 1): mean B_xsNet30 > 0 (${seg}).`, "Disproof (c), POST-HOC EXPLORATORY: fast filers leave less time for information to leak before the public entry.", "issuer-clustered t (companyStats)");
  add(`audit4.edge.gapNonPos.${seg}`, `Primary purchases whose entry open is at or below the decision close (gapEntry <= 0; executable as a limit-on-open at the prior close): mean B_xsNet30 > 0 (${seg}).`, "Disproof (c), POST-HOC EXPLORATORY: events where nothing was priced in the opening gap.", "issuer-clustered t (companyStats)");
  add(`audit4.edge.unknownCls.${seg}`, `Valued, priced, isPrimary purchases of classification-v2 class 'unknown' (excluded from every primary universe): mean B_xsNet30 > 0 (${seg}).`, "Disproof (c), POST-HOC EXPLORATORY: could the v2 classifier have excluded the informative purchases?", "issuer-clustered t (companyStats)");
}
let n = 0; for (const t of T) n += register({ ...t, family: FAM, familySize: T.length, preRegistered: false, posthoc: true, segment: t.id.endsWith("design") ? "design" : "confirm" }) ? 1 : 0;
console.log(`registered ${n} new audit4 ids (family size ${T.length})`);
