// deep4/audit/b3_compareRebuild.mjs — after the exposed build: are the design / confirmation files that the build re-emitted (into the
// audit folder) identical to the originals? Reads design + confirmation rows only (runs with the exposed period LOCKED).
//   node --max-old-space-size=12288 scripts/research/deep4/audit/b3_compareRebuild.mjs
import fs from "node:fs";
import path from "node:path";
import { phaseA, L4, writeOut } from "./common.mjs";
phaseA();
const O = path.join(L4.DEEP4, "panel"), X = path.join(L4.DEEP4, "audit", "exposed", "panel");
const J = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const res = {};
for (const [pf, cf] of [["panel.json", "controls.json"], ["panel-confirm.json", "controls-confirm.json"]]) {
  const a = J(path.join(O, pf)), b = J(path.join(X, pf));
  const bm = new Map(b.rows.map((r) => [r.key, r]));
  let rowsDiffNonC = 0, rowsDiffC = 0, missing = 0; const fieldsDiff = {};
  for (const r of a.rows) { const s = bm.get(r.key); if (!s) { missing++; continue; } let nc = false, c = false;
    for (const k of Object.keys(r)) { const same = r[k] === s[k] || (r[k] == null && s[k] == null); if (same) continue; if (k.startsWith("C_")) c = true; else { nc = true; fieldsDiff[k] = (fieldsDiff[k] || 0) + 1; } }
    if (nc) rowsDiffNonC++; if (c) rowsDiffC++; }
  const ca = J(path.join(O, cf)), cb = J(path.join(X, cf));
  let setsChanged = 0; for (const [k, v] of Object.entries(ca.byEvent)) { const w = cb.byEvent[k] || []; if (v.length !== w.length || v.some(([x], i) => w[i]?.[0] !== x)) setsChanged++; }
  res[pf] = { rows: a.rows.length, rebuiltRows: b.rows.length, missing, rowsWithNonControlFieldDiff: rowsDiffNonC, nonControlFieldsDiff: fieldsDiff, rowsWithControlSummaryDiff: rowsDiffC, controlSetsChanged: setsChanged, controlRowsOriginal: ca.rows.length, controlRowsRebuilt: cb.rows.length };
}
writeOut("exposed-rebuild-compare.json", res);
console.log(JSON.stringify(res, null, 1));
