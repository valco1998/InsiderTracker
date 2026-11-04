// deep4/learn/probe.mjs — structure probe (FEATURES and IDs only; no outcome value is read or printed).
//   node --max-old-space-size=6144 scripts/research/deep4/learn/probe.mjs
import { loadEvents, loadCtl, inUniverse, writeOut } from "./common.mjs";

const P = loadEvents();
const meta = P.meta.design;
const feats = meta.featureFields;
const rows = P.rows;
const U = rows.filter(inUniverse);
const cnt = (arr, f) => arr.reduce((m, x) => { const k = String(f(x)); m[k] = (m[k] || 0) + 1; return m; }, {});
const out = {
  rows: rows.length, primary: rows.filter((r) => r.primary === 1).length, primaryIsPrimary: rows.filter((r) => r.primary === 1 && r.isPrimary === 1).length,
  universe: U.length, universeIssuers: new Set(U.map((r) => r.cik)).size, universePersons: new Set(U.map((r) => r.person)).size,
  universeByMonth: cnt(U, (r) => r.month), universeWindow: cnt(U, (r) => r.window), universeRole: cnt(U, (r) => r.primaryRole), universeRegime: cnt(U, (r) => r.regime),
  featOkMissingAmongPrimary: rows.filter((r) => r.primary === 1 && r.isPrimary === 1 && r.featOk !== 1).length,
  metaKeys: Object.keys(meta),
  types: Object.fromEntries(feats.map((k) => [k, cnt(U, (r) => (r[k] == null ? "null" : typeof r[k]))])),
  sample: Object.fromEntries(["key", "cik", "sym", "person", "segment", "month", "publishedAt", "decisionAt", "entryDate", "window", "dupKey", ...feats].map((k) => [k, U[100][k]])),
};
const C = loadCtl();
const ctl = [...C.rows.values()];
out.controls = { rows: ctl.length, fields: Object.keys(ctl[0]).filter((k) => !k.startsWith("B_")), segments: cnt(ctl, (c) => c.segment), months: cnt(ctl, (c) => c.entryMonth) };
const uKeys = new Set(U.map((r) => r.key));
const ctlOfU = new Set(); for (const r of U) for (const [k] of C.byEvent[r.key] || []) ctlOfU.add(k);
out.controls.matchedToUniverse = ctlOfU.size; out.controls.universeEventsWithControls = U.filter((r) => (C.byEvent[r.key] || []).length > 0).length;
out.controls.sample = Object.fromEntries(Object.entries(ctl[5]).filter(([k]) => !k.startsWith("B_")));
writeOut("probe.json", out);
console.log(JSON.stringify({ ...out, types: undefined, sample: undefined }, null, 1));
console.log("sample", JSON.stringify(out.sample));
