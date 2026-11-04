// deep4/behavior/04_register.mjs — register families A (primary + secondary) and C BEFORE any outcome is computed.
// Idempotent (lib4.registerHypothesis skips known ids). Writes registration-snapshot.json with the sha256 of defs.mjs.
//   node scripts/research/deep4/behavior/04_register.mjs
import path from "node:path";
import { L4, AGENT, writeJson, checkpoint, sha256File, SCRIPTS } from "./common.mjs";
import { A_HYPS, A_SECONDARY, FAMILY_A, FAMILY_A_SEC, C_HYPS, FAMILY_C, C_TEXT, PRIMARY_OUTCOME } from "./defs.mjs";

const common = { agent: AGENT, preRegistered: true, segment: "design (published < 2026-06-15; outcomes end < 2026-06-15)", universe: "primary purchases: open-market class v2, valued, priced, isPrimary (one per person|issuer|entry open)" };
let added = 0;
for (const h of A_HYPS) {
  added += L4.registerHypothesis({ ...common, id: h.id, family: FAMILY_A, familySize: A_HYPS.length, statement: `${h.name}: ${h.rule}. Selected events' mean ${PRIMARY_OUTCOME} > 0.`, rationale: h.rationale,
    test: "issuer-clustered mean of B_xsNet30 (validate.clusteredMean, t with G-1 df), two-sided vs 0; BH within family A", outcome: PRIMARY_OUTCOME }) ? 1 : 0;
  for (const s of A_SECONDARY) added += L4.registerHypothesis({ ...common, id: `${h.id}.${s.key}`, family: FAMILY_A_SEC, familySize: A_HYPS.length * A_SECONDARY.length, statement: `${h.name}: ${s.label}`, rationale: "secondary outcome of the family-A hypothesis (horizons 5/10/20; vs matched controls; +10% touch; MAE)",
    test: s.key.endsWith("ctl") || s.key === "ctl30" ? "matched difference event - mean(controls), issuer-clustered t" : "issuer-clustered mean vs 0", outcome: s.key }) ? 1 : 0;
}
for (const h of C_HYPS) added += L4.registerHypothesis({ ...common, id: h.id, family: FAMILY_C, familySize: C_HYPS.length, statement: h.name, rationale: "Adaptive track-record selection: do matured past public-trader outcomes of the same person / issuer / role predict the next purchase? (history.mjs; left-censored before 2025-12-01; thin coverage)",
  test: C_TEXT[h.kind], source: h.src, target: h.target, outcome: h.target }) ? 1 : 0;
writeJson("registration-snapshot.json", { at: new Date().toISOString(), added, defsSha256: sha256File(path.join(SCRIPTS, "defs.mjs")), stylesSha256: sha256File(path.join(SCRIPTS, "styles.mjs")),
  familyA: { name: FAMILY_A, size: A_HYPS.length, ids: A_HYPS.map((h) => h.id) }, familyASec: { name: FAMILY_A_SEC, size: A_HYPS.length * A_SECONDARY.length }, familyC: { name: FAMILY_C, size: C_HYPS.length, ids: C_HYPS.map((h) => h.id) } });
checkpoint("04_register", { added });
console.log(`registered ${added} new ids (family A ${A_HYPS.length}, A.sec ${A_HYPS.length * A_SECONDARY.length}, C ${C_HYPS.length})`);
