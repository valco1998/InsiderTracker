// deep4/audit/a0b_register.mjs — FOLLOW-UP tests registered after a3_disproof.mjs showed that control returns depend on the control
// day's position relative to FUTURE insider purchases (hindsight). Registered before computing; labelled post-hoc follow-ups.
//   node scripts/research/deep4/audit/a0b_register.mjs
import { phaseA, register } from "./common.mjs";
phaseA();
const FAM = "audit4.disproof.followup (post-hoc follow-up of audit4.ctl.pitUniverse; control-construction artefact)";
const T = [];
for (const seg of ["design", "confirm"]) {
  T.push({ id: `audit4.ctl.rebuildBackOnly.${seg}`, statement: `Primary purchases minus REBUILT matched controls (deep-2 matching unchanged, but the purchase exclusion only looks BACKWARD: no visible code-P mark in [j-20, j]) > 0 (${seg}).`,
    rationale: "The +-20-session exclusion uses future filings: it removes control days in the decline before a later insider purchase.", test: "V.matchedDiff, issuer-clustered bootstrap B=1000" });
  T.push({ id: `audit4.ctl.rebuildPIT.${seg}`, statement: `Primary purchases minus REBUILT point-in-time controls (backward-only exclusion AND the control symbol had a visible insider purchase before the control day) > 0 (${seg}).`,
    rationale: "Fully point-in-time control universe: no condition on future filings at all (neither the exclusion window nor the cache universe).", test: "V.matchedDiff, issuer-clustered bootstrap B=1000" });
  T.push({ id: `audit4.ctl.lateWindow.${seg}`, statement: `Event-minus-control difference of the LATE part of the window (B_xsNet30 - B_xsNet20, original panel controls) > 0 (${seg}).`,
    rationale: "The +1 point appears only at 30 days; original controls are >= 21 sessions before their next insider purchase, so a pre-purchase decline would fall in days 20-30.", test: "V.matchedDiff, issuer-clustered bootstrap B=1000" });
}
let n = 0; for (const t of T) n += register({ ...t, family: FAM, familySize: T.length, preRegistered: false, posthoc: true, segment: t.id.endsWith("design") ? "design" : "confirm" }) ? 1 : 0;
console.log(`registered ${n} new audit4 ids (family size ${T.length})`);
