// deep4/learn/profileFeatures.mjs — FEATURE-ONLY profile of the design modelling universe (no outcome is read).
// Produces the design-period quantile cut points that spec.json pre-declares (interaction terciles, gap threshold).
//   node --max-old-space-size=6144 scripts/research/deep4/learn/profileFeatures.mjs
import { loadEvents, loadCtl, inUniverse, writeOut, quantile, mean, checkpoint } from "./common.mjs";
import { FEATURES, trackRecords, eventFeatures, controlFeatures } from "./features.mjs";

const P = loadEvents();
const U = P.rows.filter(inUniverse);
const TR = trackRecords(U, P.rows);
const X = U.map((r) => eventFeatures(r, TR.get(r.key)));
const C = loadCtl();
const ctlKeys = new Set(); for (const r of U) for (const [k] of C.byEvent[r.key] || []) ctlKeys.add(k);
const CX = [...ctlKeys].map((k) => controlFeatures(C.rows.get(k)));

const prof = {};
for (const d of FEATURES) {
  const v = X.map((o) => o[d.name]).filter((x) => x != null && Number.isFinite(x));
  const cv = CX.map((o) => o[d.name]).filter((x) => x != null && Number.isFinite(x));
  prof[d.name] = { group: d.group, n: v.length, missing: X.length - v.length, mean: mean(v), q01: quantile(v, 0.01), q33: quantile(v, 1 / 3), q50: quantile(v, 0.5), q67: quantile(v, 2 / 3), q99: quantile(v, 0.99),
    distinct: new Set(v).size, ...(cv.length ? { ctlN: cv.length, ctlMean: mean(cv), ctlQ50: quantile(cv, 0.5) } : {}) };
}
const gap = U.map((r) => r.gapEntry).filter((x) => x != null && Number.isFinite(x));
const terc = (name) => [quantile(X.map((o) => o[name]).filter((x) => x != null), 1 / 3), quantile(X.map((o) => o[name]).filter((x) => x != null), 2 / 3)];
const out = {
  note: "features only (no outcome read); design universe = primary & isPrimary & featOk; controls = unique control stock-days matched to the universe",
  universe: U.length, controls: CX.length,
  trackRecordCoverage: { personWithMatured: [...TR.values()].filter((t) => t.trPersonN > 0).length, issuerWithMatured: [...TR.values()].filter((t) => t.trIssuerN > 0).length, poolMissing: [...TR.values()].filter((t) => t.poolN == null).length },
  features: prof,
  tercileCuts: Object.fromEntries(["lusd", "dHi60", "lpct", "lvol20", "r20", "spyR20", "ldv20", "llag", "retTd"].map((k) => [k, terc(k)])),
  gapEntry: { n: gap.length, q50: quantile(gap, 0.5), q80: quantile(gap, 0.8), q90: quantile(gap, 0.9), mean: mean(gap) },
};
writeOut("feature-profile.json", out);
writeOut("tr-design.json", Object.fromEntries([...TR.entries()]));
checkpoint("profileFeatures", { universe: U.length, controls: CX.length });
console.log(JSON.stringify({ ...out, features: undefined }, null, 1));
for (const [k, v] of Object.entries(prof)) console.log(k.padEnd(14), v.group.padEnd(3), String(v.missing).padStart(5), "mean", v.mean?.toFixed(4), "q33/50/67", [v.q33, v.q50, v.q67].map((x) => x?.toFixed(4)).join(" / "), "distinct", v.distinct, v.ctlN ? `ctl mean ${v.ctlMean?.toFixed(4)}` : "");
