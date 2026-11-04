// deep4/learn/register.mjs — registers every pre-declared test of spec.json with lib4 BEFORE any result is computed.
// Idempotent (lib4 skips ids already registered).
//   node scripts/research/deep4/learn/register.mjs
import { readOut, register, registeredIds, checkpoint, sha256File, outPath } from "./common.mjs";

const spec = readOut("spec.json");
const specHash = sha256File(outPath("spec.json"));
const RATIONALE = {
  "learn.wf30": "Phase 4.3-4.7/5: do learned combinations of insider, person-history, cluster, track-record, technical and regime features predict 30-day net excess / +10% touch out of sample (monthly walk-forward with a 30-day maturity embargo), and is any predictability insider-specific (vs models trained on matched non-insider controls and pooled insider x feature interactions)?",
  "learn.wfsec": "Secondary horizons/targets with more usable walk-forward months (5/10 days) and downside (MAE) / touch speed.",
  "learn.int": "Phase 4.2: pre-declared interaction pairs on matched-control-adjusted outcomes (tercile cells from design quantiles).",
  "learn.famB": "Family B: insider purchase + technical price confirmation using only completed bars; the same rule on matched controls shows what insider presence adds.",
};
let added = 0;
for (const t of spec.tests) {
  const ok = register({ id: t.id, family: t.family, familySize: t.familySize, statement: t.statement, rationale: RATIONALE[t.family], specSha256: specHash });
  if (ok) added++;
}
const ids = registeredIds();
checkpoint("register", { added, registeredLearn: ids.size, specSha256: specHash });
console.log(JSON.stringify({ added, registeredLearn: ids.size, expected: spec.tests.length }, null, 1));
