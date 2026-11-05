// deep4/behavior/09_freeze.mjs — write .cache/research/deep4/behavior/frozen.json (exact rules, parameters, sha256 of every
// behavior script and of the panel / lib4 dependencies) BEFORE any confirmation row is loaded. Refuses to overwrite.
//   node scripts/research/deep4/behavior/09_freeze.mjs
import fs from "node:fs";
import path from "node:path";
import { L4, AGENT, OUT, SCRIPTS, sha256File, readJson, checkpoint } from "./common.mjs";
import { BASELINES, CANDIDATES, EXPLORATORY, CONFIRM_PLAN } from "./candDefs.mjs";
import { EXIT, SLOTS, PER_COMPANY_CAP } from "./stratLib.mjs";
import { A_HYPS, C_HYPS, C_TEXT, PRIMARY_OUTCOME } from "./defs.mjs";

const frozenFile = L4.agentFrozenFile(AGENT);
if (fs.existsSync(frozenFile)) { console.log(`frozen.json already exists (${frozenFile}); not overwritten`); process.exit(0); }
const files = {};
for (const f of fs.readdirSync(SCRIPTS).filter((f) => f.endsWith(".mjs")).sort()) files[f] = sha256File(path.join(SCRIPTS, f));
const panelDir = path.join(SCRIPTS, "..", "panel");
const deps = { "lib4.mjs": sha256File(path.join(SCRIPTS, "..", "lib4.mjs")) };
for (const f of ["data.mjs", "history.mjs", "strategyLib.mjs", "walkforward.mjs", "panelLib.mjs"]) deps[`panel/${f}`] = sha256File(path.join(panelDir, f));
const outputs = { "style-rules.json": sha256File(path.join(OUT, "style-rules.json")) };
const sr = readJson("style-rules.json");
const frozen = {
  frozenAt: new Date().toISOString(), agent: AGENT,
  statement: "Frozen BEFORE any confirmation-segment row was loaded by agent behavior. 10_confirm.mjs runs each rule below once, unchanged, on the confirmation segment (published 2026-06-15 → 2026-08-31).",
  execution: { entry: "official open of the first MOO-eligible session after acceptance + 60 s (panel entryDate; delay 0)", exit: `strategyLib exits ${JSON.stringify(EXIT)}: official close of the last session <= entry + 30 calendar days`,
    costs: "liquidity tier per side (panel costBps 5/15/35/75/100 bps) x1; sensitivity x0, x1, x2, x3", sizing: `equal slots: ${SLOTS}`, perCompanyCap: PER_COMPANY_CAP, riskLimits: "max 20 concurrent positions, 1 per issuer; no stop; no leverage",
    universe: "primary purchases: open-market class v2, valued, priced, isPrimary", market: "confirm: strategyLib.marketFor(null) (bars through 2026-11-03; exits after 2026-09-01 use prices only)" },
  styleThresholds: sr.thresholds, baselines: BASELINES.map((b) => ({ id: b.id, kind: b.kind, text: b.text })), candidates: CANDIDATES.map((c) => ({ id: c.id, kind: c.kind, text: c.text, params: c.params ?? null })),
  exploratory: EXPLORATORY.map((c) => ({ id: c.id, kind: c.kind, text: c.text, params: c.params ?? null })),
  candidatesNote: "NONE justified on design: no family-A rule positive with q < 0.10; family C only ranks repeat buyers (C04) with every quintile negative; selections C08/C09/C10 negative. S1x is a POST-HOC exploratory reference, not a candidate.",
  familyA: { primaryOutcome: PRIMARY_OUTCOME, rules: A_HYPS.map((h) => ({ id: h.id, name: h.name, rule: h.rule })) }, familyC: { tests: C_HYPS.map((h) => ({ id: h.id, name: h.name, kind: h.kind, source: h.src, target: h.target })), procedures: C_TEXT },
  confirmPlan: CONFIRM_PLAN, files, deps, outputs,
};
fs.mkdirSync(path.dirname(frozenFile), { recursive: true });
fs.writeFileSync(frozenFile, JSON.stringify(frozen, null, 1));
checkpoint("09_freeze", { frozenFile, candidates: CANDIDATES.map((c) => c.id), nFiles: Object.keys(files).length });
console.log(JSON.stringify({ frozenFile, candidates: frozen.candidates, baselines: frozen.baselines, files: Object.keys(files).length }, null, 1));
