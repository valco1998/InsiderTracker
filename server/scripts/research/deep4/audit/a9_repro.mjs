// deep4/audit/a9_repro.mjs — Phase A item 9: reproducibility. Runs the audit COPIES (exposed still locked) and compares their outputs
// with the agents' original outputs (volatile keys ignored; numbers compared exactly, then with a 1e-9 tolerance).
//   node scripts/research/deep4/audit/a9_repro.mjs
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { phaseA, L4, SCRIPTS, writeOut, checkpoint } from "./common.mjs";

phaseA();
const X = path.join(SCRIPTS, "exposed"), D4 = L4.DEEP4, A = path.join(D4, "audit");
const env = { ...process.env }; delete env.DEEP4_EXPOSED; delete env.DEEP2_HOLDOUT; delete env.DEEP3_HOLDOUT;
const run = (script, args = [], extraEnv = {}) => { const t = Date.now(); execFileSync(process.execPath, ["--max-old-space-size=12288", path.join(X, script), ...args], { stdio: ["ignore", "ignore", "inherit"], env: { ...env, ...extraEnv }, cwd: process.cwd() }); return (Date.now() - t) / 1000; };
const VOL = new Set(["builtAt", "at", "elapsedSec", "secs", "updatedAt", "generatedAt", "startedAt"]);
function cmp(a, b, p = "", acc = { leaves: 0, exact: 0, tol: 0, diff: [] }) {
  if (a && b && typeof a === "object" && typeof b === "object") { const ks = new Set([...Object.keys(a), ...Object.keys(b)]); for (const k of ks) { if (VOL.has(k)) continue; cmp(a[k], b[k], `${p}.${k}`, acc); } return acc; }
  acc.leaves++;
  if (a === b || (Number.isNaN(a) && Number.isNaN(b))) { acc.exact++; return acc; }
  if (typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))) { acc.tol++; return acc; }
  if (acc.diff.length < 12) acc.diff.push({ path: p, original: a, copy: b }); else acc.more = (acc.more || 0) + 1;
  return acc;
}
const J = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const res = {};
const compareFile = (name, orig, copy) => { if (!fs.existsSync(copy)) { res[name] = { missing: copy }; return; } const isCsv = orig.endsWith(".csv");
  if (isCsv) { const a = fs.readFileSync(orig, "utf8"), b = fs.readFileSync(copy, "utf8"); res[name] = { identicalBytes: a === b, lines: a.split("\n").length }; return; }
  const c = cmp(J(orig), J(copy)); res[name] = { leaves: c.leaves, exact: c.exact, withinTol: c.tol, differing: c.leaves - c.exact - c.tol, examples: c.diff, more: c.more || 0 }; };
// 1. panel build (design + confirmation; the lead's post-unlock build) into audit/repro/panel
const RP = path.join(A, "repro", "panel");
res.timing = { buildPanel: run("panel/buildPanel.mjs", [], { AUDIT_PANEL_OUT: RP }) };
for (const f of ["panel.json", "panel-confirm.json", "controls.json", "controls-confirm.json"]) compareFile(`panel/${f}`, path.join(D4, "panel", f), path.join(RP, f));
for (const f of ["panel.csv", "panel-confirm.csv"]) compareFile(`panel/${f}`, path.join(D4, "panel", f), path.join(RP, f));
// 2. panel describe (design) -> monthly tables
res.timing.describe = run("panel/describe.mjs", [], { AUDIT_PANEL_OUT: RP });
for (const f of ["describe-A-by-month.csv", "describe-B-by-month.csv"]) compareFile(`panel/${f}`, path.join(D4, "panel", f), path.join(RP, f));
// 3. learn family B (design) and walk-forward (design, primary targets)
res.timing.familyB = run("learn/familyB.mjs", ["--segment=design"]);
compareFile("learn/famB-design.json", path.join(D4, "learn", "famB-design.json"), path.join(A, "exposed", "learn", "famB-design.json"));
res.timing.wf = run("learn/wf.mjs", ["--segment=design", "--targets=xs30,hit30"]);
for (const t of ["xs30", "hit30"]) for (const m of ["M0", "M1", "M2", "M3", "M4", "M3c", "M3p", "M5", "TREE", "D1", "D2", ...(t === "xs30" ? ["EN"] : [])]) {
  compareFile(`learn/wf-design/run-${t}-${m}.json`, path.join(D4, "learn", "wf-design", `run-${t}-${m}.json`), path.join(A, "exposed", "learn", "wf-design", `run-${t}-${m}.json`));
  compareFile(`learn/wf-design/recs-${t}-${m}.json`, path.join(D4, "learn", "wf-design", `recs-${t}-${m}.json`), path.join(A, "exposed", "learn", "wf-design", `recs-${t}-${m}.json`));
}
// 4. behavior confirmation code path, design dry run
res.timing.behaviorDry = run("behavior/10_confirm.mjs", ["--dry-design"]);
compareFile("behavior/confirm-dryrun-design.json", path.join(D4, "behavior", "confirm-dryrun-design.json"), path.join(A, "exposed", "behavior", "confirm-dryrun-design.json"));
compareFile("behavior/confirm-dryrun-trades.csv", path.join(D4, "behavior", "confirm-dryrun-trades.csv"), path.join(A, "exposed", "behavior", "confirm-dryrun-trades.csv"));
writeOut("repro.json", res);
checkpoint("a9_repro", { files: Object.keys(res).length - 1 });
for (const [k, v] of Object.entries(res)) console.log(k.padEnd(40), JSON.stringify(v).slice(0, 400));
