// deep4/audit/a9b_reproConfirm.mjs — compares the audit copies' learn CONFIRMATION outputs (wf-confirm, famB-confirm,
// strategies-confirm; produced by running the copies with --segment=confirm) with learn's original one-shot outputs.
//   node scripts/research/deep4/audit/a9b_reproConfirm.mjs
import fs from "node:fs";
import path from "node:path";
import { phaseA, L4, writeOut, readOut, existsOut } from "./common.mjs";
phaseA();
const VOL = new Set(["builtAt", "at", "elapsedSec", "secs", "updatedAt", "generatedAt", "startedAt"]);
function cmp(a, b, p = "", acc = { leaves: 0, exact: 0, tol: 0, diff: [] }) {
  if (a && b && typeof a === "object" && typeof b === "object") { for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { if (VOL.has(k)) continue; cmp(a[k], b[k], `${p}.${k}`, acc); } return acc; }
  acc.leaves++; if (a === b) { acc.exact++; return acc; }
  if (typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))) { acc.tol++; return acc; }
  if (acc.diff.length < 10) acc.diff.push({ path: p, original: a, copy: b }); return acc;
}
const O = path.join(L4.DEEP4, "learn"), Cp = path.join(L4.DEEP4, "audit", "exposed", "learn");
const res = {};
const files = ["famB-confirm.json", "strategies-confirm.json", ...fs.readdirSync(path.join(O, "wf-confirm")).filter((f) => /^(run|recs|permutation)-.*.json$/.test(f)).map((f) => `wf-confirm/${f}`)];
for (const f of files) { const a = path.join(O, f), b = path.join(Cp, f); if (!fs.existsSync(b)) { res[f] = { missing: true }; continue; }
  const c = cmp(JSON.parse(fs.readFileSync(a, "utf8")), JSON.parse(fs.readFileSync(b, "utf8"))); res[f] = { leaves: c.leaves, exact: c.exact, tol: c.tol, differing: c.leaves - c.exact - c.tol, examples: c.diff }; }
for (const f of fs.readdirSync(path.join(O, "wf-confirm")).filter((x) => /^predictions-.*.csv$/.test(x))) res[`wf-confirm/${f}`] = { identicalBytes: fs.readFileSync(path.join(O, "wf-confirm", f), "utf8") === fs.readFileSync(path.join(Cp, "wf-confirm", f), "utf8") };
const tot = Object.values(res).reduce((a, r) => ({ files: a.files + 1, differing: a.differing + (r.differing || 0) + (r.identicalBytes === false ? 1 : 0) + (r.missing ? 1 : 0) }), { files: 0, differing: 0 });
const prev = existsOut("repro.json") ? readOut("repro.json") : {};
writeOut("repro.json", { ...prev, learnConfirmRun: { summary: tot, files: res } });
console.log(JSON.stringify(tot), "\n", Object.entries(res).filter(([, r]) => r.differing || r.identicalBytes === false || r.missing).map(([k, r]) => `${k}: ${JSON.stringify(r).slice(0, 300)}`).join("\n"));
