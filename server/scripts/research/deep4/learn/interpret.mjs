// deep4/learn/interpret.mjs — interpretability (descriptive, design only): standardised coefficients and their sign stability
// across walk-forward months; FULL-DESIGN IN-SAMPLE fits (labelled in-sample) with issuer-bootstrap CIs; full-design trees
// (M4 events; M3 events vs M3 controls); permutation importance tables; time to +10% by predicted quintile; IC by regime.
//   node --max-old-space-size=8192 scripts/research/deep4/learn/interpret.mjs
import { loadEvents, loadCtl, inUniverse, readOut, writeOut, existsOut, checkpoint, mean, median, quantile } from "./common.mjs";
import { FEATURE_NAMES, SETS, trackRecords, eventFeatures, controlFeatures } from "./features.mjs";
import { learnLinear, colsIdx } from "./wfLib.mjs";
import * as Mo from "./models.mjs";
import * as E from "./evalLib.mjs";

const spec = readOut("spec.json"), hp = spec.hyperparameters;
const P = loadEvents(), C = loadCtl();
const U = P.rows.filter(inUniverse);
const TR = trackRecords(U, P.rows);
const raw = new Map(U.map((r) => { const o = eventFeatures(r, TR.get(r.key)); return [r.key, FEATURE_NAMES.map((n) => o[n])]; }));
const out = {};

// ---- 1. coefficient sign stability across walk-forward months ----
const stab = {};
for (const run of ["xs30-M4", "hit30-M4", "xs30-M2", "xs30-M3", "xs30-EN", "xs30-M5", "hit30-M5", "xs30-M3c"]) {
  if (!existsOut(`wf-design/run-${run}.json`)) continue;
  const R = readOut(`wf-design/run-${run}.json`), cs = R.coefficients.filter((c) => c.b);
  const names = cs[0].names;
  stab[run] = names.map((n, j) => { const v = cs.map((c) => c.b[j]); return { feature: n, perMonth: v.map((x) => +x.toFixed(4)), mean: mean(v), signStable: v.every((x) => x > 0) || v.every((x) => x < 0), positiveMonths: v.filter((x) => x > 0).length, months: v.length }; })
    .sort((a, b) => Math.abs(b.mean) - Math.abs(a.mean));
}
out.coefficientStability = stab;

// ---- 2. full-design in-sample fits (all design universe events with the 30-day outcome) + issuer bootstrap CIs ----
const fitFull = (cols, field, cont) => {
  const rs = U.filter((r) => r[field] != null), idx = colsIdx(cols);
  const X = rs.map((r) => idx.map((i) => raw.get(r.key)[i])), y = rs.map((r) => r[field]);
  const L = learnLinear(X, y, rs.map((r) => ({ month: r.month, end: r.B_end30 })), { cont, method: cont ? "ridge" : "logistic", hp });
  // issuer bootstrap at the chosen lambda (B = 200)
  const G = new Map(); rs.forEach((r, i) => (G.get(r.cik) || G.set(r.cik, []).get(r.cik)).push(i));
  const blocks = [...G.values()], rnd = E.rng(5), draws = [];
  for (let b = 0; b < 200; b++) {
    const ii = []; for (let j = 0; j < blocks.length; j++) ii.push(...blocks[(rnd() * blocks.length) | 0]);
    const Xb = ii.map((i) => X[i]), yb = ii.map((i) => y[i]), Pb = Mo.prepFit(Xb), Zb = Xb.map((x) => Mo.prepApply(Pb, x));
    const m = cont ? Mo.ridgeFit(Zb, Mo.winsorY(yb).y, L.lambda) : Mo.logisticFit(Zb, yb, L.lambda); draws.push(m.b);
  }
  return { n: rs.length, lambda: L.lambda, cvFolds: L.cv.folds, cvScores: L.cv.scores, coefficients: cols.map((n, j) => { const d = draws.map((b) => b[j]).sort((a, b) => a - b); return { feature: n, b: L.coef.b[j], lo: d[5], hi: d[194], sign: d[5] > 0 ? "+" : d[194] < 0 ? "-" : "0" }; }).sort((a, b) => Math.abs(b.b) - Math.abs(a.b)) };
};
out.fullDesignInSample = { note: "IN-SAMPLE (all design events with matured 30-day outcomes); descriptive only", xs30_M4_ridge: fitFull(SETS.M4, "B_xsNet30", true), hit30_M4_logistic: fitFull(SETS.M4, "B_hit10_30", false), xs30_M2_ridge: fitFull(SETS.M2, "B_xsNet30", true) };

// ---- 3. full-design trees (in-sample): M4 on events; M3 on events vs M3 on matched controls ----
const ctlKeys = new Set(); for (const r of U) for (const [k] of C.byEvent[r.key] || []) ctlKeys.add(k);
const ctl = [...ctlKeys].map((k) => C.rows.get(k));
const craw = new Map(ctl.map((c) => { const o = controlFeatures(c); return [c.ctlKey, FEATURE_NAMES.map((n) => o[n])]; }));
const treeOn = (items, cols, field, cont, issuerOf, rawOf) => {
  const rs = items.filter((r) => r[field] != null), idx = colsIdx(cols);
  const Xr = rs.map((r) => idx.map((i) => rawOf(r)[i])), Pp = Mo.prepFit(Xr), X = Xr.map((x) => Mo.prepApplyRaw(Pp, x));
  const y0 = rs.map((r) => r[field]), y = cont ? Mo.winsorY(y0).y : y0;
  const T = Mo.treeFit(X, y, rs.map(issuerOf), { maxDepth: 3, minLeaf: 100, minIssuers: 40, cuts: Mo.decileCuts(X), names: cols });
  return { n: rs.length, overall: mean(y0), leaves: Mo.treeLeaves(T) };
};
out.fullDesignTrees = {
  note: "IN-SAMPLE trees (depth <= 3, leaves >= 100 events and >= 40 issuers, decile thresholds); winsorised target for xs30",
  xs30_M4_events: treeOn(U, SETS.M4, "B_xsNet30", true, (r) => r.cik, (r) => raw.get(r.key)),
  hit30_M4_events: treeOn(U, SETS.M4, "B_hit10_30", false, (r) => r.cik, (r) => raw.get(r.key)),
  xs30_M3_events: treeOn(U, SETS.M3, "B_xsNet30", true, (r) => r.cik, (r) => raw.get(r.key)),
  xs30_M3_controls: treeOn(ctl, SETS.M3, "B_xsNet30", true, (c) => c.sym, (c) => craw.get(c.ctlKey)),
  hit30_M3_events: treeOn(U, SETS.M3, "B_hit10_30", false, (r) => r.cik, (r) => raw.get(r.key)),
  hit30_M3_controls: treeOn(ctl, SETS.M3, "B_hit10_30", false, (c) => c.sym, (c) => craw.get(c.ctlKey)),
};

// ---- 4. permutation importance (computed in wf.mjs on walk-forward predictions) ----
out.permutation = {}; for (const k of ["xs30-M4", "hit30-M4", "xs30-M5", "hit30-M5"]) if (existsOut(`wf-design/permutation-${k}.json`)) out.permutation[k] = readOut(`wf-design/permutation-${k}.json`).map((x) => ({ unit: x.unit, meanDrop: x.meanDrop, months: x.perMonth.map((m) => +m.drop.toFixed(4)) }));

// ---- 5. time to +10% by within-month predicted quintile (M4 logistic, hit30) and 6. IC by regime (M4 ridge, xs30) ----
const byKey = new Map(U.map((r) => [r.key, r]));
const recsH = readOut("wf-design/recs-hit30-M4.json").recs;
const qOf = (recs) => { const by = new Map(); for (const r of recs) (by.get(r.month) || by.set(r.month, []).get(r.month)).push(r); const q = new Map(); for (const xs of by.values()) { const s = [...xs].sort((a, b) => a.p - b.p); s.forEach((r, i) => q.set(r.key, 1 + Math.floor((5 * i) / s.length))); } return q; };
const qH = qOf(recsH);
out.timeToTarget = [1, 2, 3, 4, 5].map((q) => { const xs = recsH.filter((r) => qH.get(r.key) === q).map((r) => byKey.get(r.key)); const hits = xs.filter((r) => r.B_hit10_30 === 1);
  return { quintile: q, n: xs.length, hit30: mean(xs.map((r) => r.B_hit10_30)), hit10d: mean(xs.filter((r) => r.B_hit10_10 != null).map((r) => r.B_hit10_10)), medianDaysToTouchAmongHits: median(hits.map((r) => r.B_tt10d).filter((v) => v != null)), xs30: mean(xs.map((r) => r.B_xsNet30).filter((v) => v != null)), lim10_30: mean(xs.map((r) => r.B_lim10_30).filter((v) => v != null)), mae30: median(xs.map((r) => r.B_mae30).filter((v) => v != null)), vol20: median(xs.map((r) => r.vol20)) }; });
const recsX = readOut("wf-design/recs-xs30-M4.json").recs;
const spyCut = spec.interactions.tercileCuts.spyR20, volCut = spec.interactions.tercileCuts.lvol20;
const regimeIC = (label, f) => [1, 2, 3].map((t) => { const xs = recsX.filter((r) => f(byKey.get(r.key)) === t); return { [label]: t, n: xs.length, ic: E.withinMonth(xs, "ic").value, meanY: mean(xs.map((r) => r.y)) }; });
out.icByRegime = {
  spyR20: regimeIC("tercile", (r) => (r.spyR20 <= spyCut[0] ? 1 : r.spyR20 <= spyCut[1] ? 2 : 3)),
  vol20: regimeIC("tercile", (r) => { const v = Math.log(r.vol20); return v <= volCut[0] ? 1 : v <= volCut[1] ? 2 : 3; }),
  regime: ["down", "mixed", "up"].map((g) => { const xs = recsX.filter((r) => byKey.get(r.key).regime === g); return { regime: g, n: xs.length, ic: E.withinMonth(xs, "ic").value, meanY: mean(xs.map((r) => r.y)) }; }),
};
writeOut("interpret.json", out);
checkpoint("interpret");
// ---- console summary ----
const f4 = (x) => (x == null ? "-" : x.toFixed(4));
for (const k of ["xs30_M4_ridge", "hit30_M4_logistic", "xs30_M2_ridge"]) { const F = out.fullDesignInSample[k]; console.log(`\nIN-SAMPLE ${k} n ${F.n} lambda ${F.lambda}`); for (const c of F.coefficients.slice(0, 14)) console.log(`  ${c.feature.padEnd(14)} ${f4(c.b)} [${f4(c.lo)}, ${f4(c.hi)}] ${c.sign}`); }
for (const k of ["xs30-M4", "hit30-M4", "xs30-M5"]) { console.log(`\nsign stability ${k}`); for (const c of (stab[k] || []).slice(0, 12)) console.log(`  ${c.feature.padEnd(16)} mean ${f4(c.mean)} months ${c.perMonth.join(" ")} stable ${c.signStable}`); }
for (const [k, T] of Object.entries(out.fullDesignTrees)) { if (k === "note") continue; console.log(`\nTREE ${k} n ${T.n} overall ${f4(T.overall)}`); for (const l of T.leaves) console.log(`  ${l.path.join(" & ").padEnd(70)} n ${l.n} iss ${l.issuers} value ${f4(l.value)}`); }
for (const [k, imp] of Object.entries(out.permutation)) console.log(`\nPERM ${k}: ` + imp.slice(0, 10).map((x) => `${x.unit} ${f4(x.meanDrop)}`).join(" | "));
console.log("\ntime to target by M4 P(touch) quintile", JSON.stringify(out.timeToTarget, null, 0));
console.log("\nIC by regime", JSON.stringify(out.icByRegime, null, 0));
