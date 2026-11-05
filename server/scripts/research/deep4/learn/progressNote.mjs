// deep4/learn/progressNote.mjs — writes the final status and the re-run order into progress.json (bookkeeping only).
//   node scripts/research/deep4/learn/progressNote.mjs
import { readOut, writeOut } from "./common.mjs";

const p = readOut("progress.json");
p.status = "COMPLETE: design analysis, freeze (frozen.json sha256 889b360f...), one-shot confirmation and verdicts done. Do NOT re-run confirm.mjs (it refuses: confirm-done.json).";
p.rerunOrder = [
  "node --max-old-space-size=6144 scripts/research/deep4/learn/profileFeatures.mjs",
  "node scripts/research/deep4/learn/writeSpec.mjs   (refuses to overwrite spec.json)",
  "node scripts/research/deep4/learn/register.mjs    (idempotent)",
  "node scripts/research/deep4/learn/models.test.mjs",
  "node --max-old-space-size=8192 scripts/research/deep4/learn/wf.mjs",
  "node --max-old-space-size=8192 scripts/research/deep4/learn/wfTests.mjs [--record]",
  "node --max-old-space-size=8192 scripts/research/deep4/learn/interactions.mjs [--record]",
  "node --max-old-space-size=8192 scripts/research/deep4/learn/familyB.mjs [--record]",
  "node --max-old-space-size=8192 scripts/research/deep4/learn/interpret.mjs",
  "node --max-old-space-size=8192 scripts/research/deep4/learn/strategies.mjs",
  "node scripts/research/deep4/learn/report.mjs",
  "node scripts/research/deep4/learn/bh.mjs",
  "node scripts/research/deep4/learn/freeze.mjs      (refuses if frozen.json exists)",
  "node --max-old-space-size=8192 scripts/research/deep4/learn/confirm.mjs   (ONE SHOT; already done)",
  "node scripts/research/deep4/learn/finalize.mjs",
];
writeOut("progress.json", p);
console.log("progress.json updated");
