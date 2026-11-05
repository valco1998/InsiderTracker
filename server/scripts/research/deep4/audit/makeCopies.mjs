// deep4/audit/makeCopies.mjs — copies the frozen panel / behavior / learn scripts into scripts/research/deep4/audit/exposed/<area>/
// so they can run with redirected outputs (never touching the agents' folders). Allowed transformations ONLY:
//   T1 import-depth: relative specifiers that leave the area folder gain two "../" (the copy sits two folders deeper: audit/exposed);
//      "../panel/", "../behavior/", "../learn/" keep pointing at the sibling COPIES;
//   T2 outputs: panel OUT, behavior OUT, learn OUT -> .cache/research/deep4/audit/exposed/<area>; data.mjs reads design/confirm
//      files from the ORIGINAL panel folder and exposed files from the audit folder;
//   T3 exposed plumbing: segment lists gain "exposed"; behavior 10_confirm gets an --exposed mode (frozen-hash guard checks the
//      ORIGINAL scripts; registry writes disabled); learn's refuse-if-exposed guards disabled; panel describe.mjs segment via env.
// Writes copy-manifest.json (sha256 of original and copy + every changed line) to .cache/research/deep4/audit/.
//   node scripts/research/deep4/audit/makeCopies.mjs
import fs from "node:fs";
import path from "node:path";
import { SCRIPTS, writeOut, sha256File } from "./common.mjs";

const SRC = path.join(SCRIPTS, ".."), DST = path.join(SCRIPTS, "exposed");
const FILES = {
  panel: ["panelLib.mjs", "buildPanel.mjs", "data.mjs", "history.mjs", "strategyLib.mjs", "walkforward.mjs", "describe.mjs"],
  behavior: ["10_confirm.mjs", "common.mjs", "candDefs.mjs", "defs.mjs", "styles.mjs", "trackLib.mjs", "stratLib.mjs"],
  learn: ["common.mjs", "features.mjs", "models.mjs", "wfLib.mjs", "evalLib.mjs", "wf.mjs", "famBLib.mjs", "familyB.mjs", "strategies.mjs"],
};
const AREAS = new Set(["panel", "behavior", "learn"]);
const SEGS_OLD = 'const segs = SEGMENT === "design" ? ["design"] : ["design", "confirm"];';
const SEGS_NEW = 'const segs = SEGMENT === "design" ? ["design"] : SEGMENT === "confirm" ? ["design", "confirm"] : ["design", "confirm", "exposed"]; // AUDIT COPY (T3): exposed segment';
const REPL = {
  "panel/panelLib.mjs": [['export const OUT = path.join(L4.DEEP4, "panel");', 'export const OUT = process.env.AUDIT_PANEL_OUT ? path.resolve(process.env.AUDIT_PANEL_OUT) : path.join(L4.DEEP4, "audit", "exposed", "panel"); // AUDIT COPY (T2)']],
  "panel/data.mjs": [
    ['export const PANEL_DIR = path.join(L4.DEEP4, "panel");', 'export const PANEL_DIR = path.join(L4.DEEP4, "panel");\nconst AUDIT_PANEL_DIR = path.join(L4.DEEP4, "audit", "exposed", "panel"); // AUDIT COPY (T2): exposed files come from the audit folder\nconst dirOf = (f) => (/exposed/.test(f) ? AUDIT_PANEL_DIR : PANEL_DIR);'],
    ['const readJson = (f) => JSON.parse(fs.readFileSync(path.join(PANEL_DIR, f), "utf8"));', 'const readJson = (f) => JSON.parse(fs.readFileSync(path.join(dirOf(f), f), "utf8"));'],
    ['.filter((s) => fs.existsSync(path.join(PANEL_DIR, FILES[s][0])));', '.filter((s) => fs.existsSync(path.join(dirOf(FILES[s][0]), FILES[s][0])));'],
    ['const f = FILES[s][1]; if (!fs.existsSync(path.join(PANEL_DIR, f))) continue;', 'const f = FILES[s][1]; if (!fs.existsSync(path.join(dirOf(f), f))) continue;'],
  ],
  "panel/describe.mjs": [
    ['const P = loadPanel({ agent: "panel", segments: ["design"] });', 'const P = loadPanel({ agent: "panel", segments: [process.env.AUDIT_DESCRIBE_SEGMENT || "design"] }); // AUDIT COPY (T3)'],
    ['const C = loadControls({ agent: "panel", segments: ["design"] });', 'const C = loadControls({ agent: "panel", segments: [process.env.AUDIT_DESCRIBE_SEGMENT || "design"] }); // AUDIT COPY (T3)'],
  ],
  "behavior/common.mjs": [['export const OUT = path.join(L4.DEEP4, AGENT);', 'export const OUT = path.join(L4.DEEP4, "audit", "exposed", AGENT); // AUDIT COPY (T2)']],
  "behavior/10_confirm.mjs": [
    ['const DRY = process.argv.includes("--dry-design");', 'const DRY = process.argv.includes("--dry-design");\nconst EXPOSED = process.argv.includes("--exposed"); // AUDIT COPY (T3)\nconst STARTED = EXPOSED ? "exposed-started.json" : "confirm-started.json"; // AUDIT COPY (T3)'],
    ['const SEG = DRY ? "design" : "confirm";', 'const SEG = DRY ? "design" : EXPOSED ? "exposed" : "confirm"; // AUDIT COPY (T3)'],
    ['const RESULT = DRY ? "confirm-dryrun-design.json" : "confirm-results.json";', 'const RESULT = DRY ? "confirm-dryrun-design.json" : EXPOSED ? "exposed-results.json" : "confirm-results.json"; // AUDIT COPY (T3)'],
    ['if (fs.existsSync(path.join(OUT, RESULT)) || fs.existsSync(path.join(OUT, "confirm-started.json"))) throw', 'if (fs.existsSync(path.join(OUT, RESULT)) || fs.existsSync(path.join(OUT, STARTED))) throw'],
    ['for (const [f, h] of Object.entries(fz.files)) if (sha256File(path.join(SCRIPTS, f)) !== h) bad.push(f);', 'for (const [f, h] of Object.entries(fz.files)) if (sha256File(path.join(SCRIPTS, "..", "..", "..", "behavior", f)) !== h) bad.push(f); // AUDIT COPY (T3): checks the ORIGINAL frozen scripts'],
    ['for (const [f, h] of Object.entries(fz.deps)) if (sha256File(path.join(SCRIPTS, "..", f)) !== h) bad.push(f);', 'for (const [f, h] of Object.entries(fz.deps)) if (sha256File(path.join(SCRIPTS, "..", "..", "..", f)) !== h) bad.push(f); // AUDIT COPY (T3): ORIGINAL deps'],
    ['writeJson("confirm-started.json", {', 'writeJson(STARTED, {'],
    ['const segs = DRY ? ["design"] : ["design", "confirm"];', 'const segs = DRY ? ["design"] : EXPOSED ? ["design", "confirm", "exposed"] : ["design", "confirm"]; // AUDIT COPY (T3)'],
    ['mode: DRY ? "DRY RUN on the design segment (code check; not a confirmation)" : "CONFIRMATION (single run of frozen rules)"', 'mode: DRY ? "DRY RUN on the design segment (code check; not a confirmation)" : EXPOSED ? "EXPOSED-PERIOD AUDIT RUN (auditor; frozen rules unchanged)" : "CONFIRMATION (single run of frozen rules)"'],
    ['const segStart = DRY ? "2026-03-16" : L4.DESIGN_END;', 'const segStart = DRY ? "2026-03-16" : EXPOSED ? L4.EXPOSED_START : L4.DESIGN_END; // AUDIT COPY (T3)'],
    ['writeCsv(DRY ? "confirm-dryrun-trades.csv" : "confirm-trades.csv", tradeRows);', 'writeCsv(DRY ? "confirm-dryrun-trades.csv" : EXPOSED ? "exposed-trades.csv" : "confirm-trades.csv", tradeRows); // AUDIT COPY (T3)'],
    ['if (!DRY) {\n  for (const x of famC)', 'if (!DRY && !EXPOSED) { // AUDIT COPY (T3): no registry writes from the copy\n  for (const x of famC)'],
  ],
  "learn/common.mjs": [
    ['export const OUT = path.join(L4.DEEP4, AGENT);', 'export const OUT = path.join(L4.DEEP4, "audit", "exposed", AGENT); // AUDIT COPY (T2)'],
    ['\nassertSafeEnv();\n', '\n// AUDIT COPY (T3): assertSafeEnv() not called — this copy is the auditor\'s single exposed run\n'],
    ['export function loadEvents({ segments = ["design"] } = {}) {\n  for (const s of segments) if (s === "exposed") throw new Error("learn: the exposed segment is never loaded");', 'export function loadEvents({ segments = ["design"] } = {}) {\n  // AUDIT COPY (T3): exposed refusal removed'],
    ['export function loadCtl({ segments = ["design"] } = {}) {\n  for (const s of segments) if (s === "exposed") throw new Error("learn: the exposed segment is never loaded");', 'export function loadCtl({ segments = ["design"] } = {}) {\n  // AUDIT COPY (T3): exposed refusal removed'],
  ],
  "learn/wf.mjs": [[SEGS_OLD, SEGS_NEW]],
  "learn/familyB.mjs": [[SEGS_OLD, SEGS_NEW]],
  "learn/strategies.mjs": [[SEGS_OLD, SEGS_NEW]],
};
// T1: import depth
const fixImports = (src) => src.replace(/(from\s+"|import\(\s*")(\.\.\/[^"]+)"/g, (m, pre, spec) => { const seg = spec.split("/")[1]; return AREAS.has(seg) ? m : `${pre}../../${spec}"`; });
const manifest = { at: new Date().toISOString(), rules: ["T1 import depth", "T2 output folders", "T3 exposed-segment plumbing / guards"], files: [] };
for (const [area, list] of Object.entries(FILES)) {
  fs.mkdirSync(path.join(DST, area), { recursive: true });
  for (const f of list) {
    const from = path.join(SRC, area, f), to = path.join(DST, area, f);
    const orig = fs.readFileSync(from, "utf8");
    let s = fixImports(orig);
    for (const [a, b] of REPL[`${area}/${f}`] || []) { const n = s.split(a).length - 1; if (n !== 1) throw new Error(`${area}/${f}: pattern found ${n} times: ${a.slice(0, 80)}`); s = s.replace(a, () => b); }
    fs.writeFileSync(to, s);
    // line diff (original vs copy)
    const A = orig.split("\n"), Bl = s.split("\n"); const changes = [];
    let i = 0, j = 0; while (i < A.length || j < Bl.length) { if (A[i] === Bl[j]) { i++; j++; continue; }
      // find resync point
      let found = false; for (let k = 1; k <= 3 && !found; k++) { if (A[i] === Bl[j + k]) { for (let q = 0; q < k; q++) changes.push({ line: j + q + 1, removed: null, added: Bl[j + q] }); j += k; found = true; } }
      if (!found) { changes.push({ line: j + 1, removed: A[i] ?? null, added: Bl[j] ?? null }); i++; j++; } }
    manifest.files.push({ file: `${area}/${f}`, originalSha256: sha256File(from), copySha256: sha256File(to), changedLines: changes.length, changes });
  }
}
writeOut("copy-manifest.json", manifest);
for (const m of manifest.files) console.log(`${m.file.padEnd(26)} changed lines ${String(m.changedLines).padStart(2)}  ${m.changes.map((c) => (c.added || "").trim().slice(0, 70)).join(" | ").slice(0, 150)}`);
