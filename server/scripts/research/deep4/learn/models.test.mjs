// deep4/learn/models.test.mjs — synthetic-data tests of models.mjs (no panel data, no outcome).
//   node scripts/research/deep4/learn/models.test.mjs
import assert from "node:assert/strict";
import * as Mo from "./models.mjs";
import { writeOut } from "./common.mjs";

const results = []; let failed = 0;
const test = (name, fn) => { try { const info = fn(); results.push({ name, ok: true, ...(info ? { info } : {}) }); } catch (e) { failed++; results.push({ name, ok: false, error: String(e.stack || e.message).slice(0, 500) }); } };
let s = 12345; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const gauss = () => { let u = 0; while (u <= 1e-12) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };
const near = (a, b, eps) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b} (eps ${eps})`);

test("prep: winsorises, imputes the median and z-scores with training statistics", () => {
  const X = [[1, null], [2, 5], [3, 5], [4, 5], [100, 7]];
  const P = Mo.prepFit(X, { winsor: [0, 0.75] });
  const z = X.map((r) => Mo.prepApply(P, r));
  near(Mo.mean(z.map((r) => r[0])), 0, 1e-12); near(Mo.mean(z.map((r) => r[1])), 0, 1e-12);
  assert.equal(P.cols[0].hi, 4); // 75th percentile of [1,2,3,4,100] = 4
  assert.equal(P.cols[1].med, 5);
  return { cols: P.cols };
});
test("ridge: small lambda recovers OLS coefficients; large lambda shrinks toward 0", () => {
  const n = 4000, Z = [], y = [];
  for (let i = 0; i < n; i++) { const a = gauss(), b = gauss(), c = gauss(); Z.push([a, b, c]); y.push(1 + 2 * a - b + 0.5 * gauss()); }
  const m = Mo.ridgeFit(Z, y, 1e-6); near(m.b0, 1, 0.05); near(m.b[0], 2, 0.05); near(m.b[1], -1, 0.05); near(m.b[2], 0, 0.05);
  const m2 = Mo.ridgeFit(Z, y, 1); near(m2.b[0], 1, 0.08); // b/(1+lambda) for standardised orthogonal columns
  return { b: m.b, bShrunk: m2.b };
});
test("logistic: recovers coefficients with tiny penalty; penalty shrinks", () => {
  const n = 20000, Z = [], y = [];
  for (let i = 0; i < n; i++) { const a = gauss(), b = gauss(); Z.push([a, b]); const p = 1 / (1 + Math.exp(-(-0.5 + 1.5 * a - b))); y.push(rnd() < p ? 1 : 0); }
  const m = Mo.logisticFit(Z, y, 1e-8); near(m.b0, -0.5, 0.06); near(m.b[0], 1.5, 0.08); near(m.b[1], -1, 0.06);
  const m2 = Mo.logisticFit(Z, y, 0.5); assert.ok(Math.abs(m2.b[0]) < Math.abs(m.b[0]));
  const p = Z.map((z) => Mo.logitPredict(m, z)); const a = Mo.auc(p, y); assert.ok(a > 0.75);
  return { b0: m.b0, b: m.b, auc: a };
});
test("elastic net zeroes pure-noise columns and keeps the signal", () => {
  const n = 3000, Z = [], y = [];
  for (let i = 0; i < n; i++) { const r = Array.from({ length: 10 }, gauss); Z.push(r); y.push(0.3 * r[0] + gauss()); }
  const m = Mo.enetFit(Z, y, 0.1, 0.5); assert.ok(m.b[0] > 0.1); assert.ok(m.b.slice(1).filter((v) => v !== 0).length <= 2, JSON.stringify(m.b));
  return { b: m.b.map((v) => +v.toFixed(4)), nonZero: m.nonZero };
});
test("tree: finds a planted split and respects leaf / issuer minima", () => {
  const n = 3000, X = [], y = [], iss = [];
  for (let i = 0; i < n; i++) { const a = rnd(), b = rnd(); X.push(Float64Array.from([a, b])); y.push((a > 0.6 ? 1 : 0) + 0.1 * gauss()); iss.push(i % 300); }
  const cuts = Mo.decileCuts(X);
  const t = Mo.treeFit(X, y, iss, { maxDepth: 3, minLeaf: 100, minIssuers: 40, cuts, names: ["a", "b"] });
  assert.equal(t.root.feature, 0); near(t.root.cut, 0.6, 0.06);
  const leaves = Mo.treeLeaves(t); assert.ok(leaves.every((l) => l.n >= 100 && l.issuers >= 40));
  // only 2 issuers in total -> no split allowed
  const t2 = Mo.treeFit(X, y, X.map((_, i) => i % 2), { maxDepth: 3, minLeaf: 100, minIssuers: 40, cuts });
  assert.equal(t2.root.leaf, true);
  return { root: { f: t.root.name, cut: t.root.cut }, leaves: leaves.length };
});
test("metrics: AUC with ties = 1/2, Spearman of a monotone map = 1", () => {
  near(Mo.auc([0.1, 0.4, 0.35, 0.8], [0, 0, 1, 1]), 0.75, 1e-12);
  near(Mo.auc([0.5, 0.5, 0.5, 0.5], [0, 1, 0, 1]), 0.5, 1e-12);
  near(Mo.spearman([1, 2, 3, 4, 5, 6], [10, 20, 30, 40, 50, 1000]), 1, 1e-12);
  near(Mo.brier([1, 0], [1, 1]), 0.5, 1e-12);
});
test("inner CV: folds use only rows that matured before the fold month start", () => {
  const rows = [];
  for (const m of ["2026-01", "2026-02", "2026-03"]) for (let i = 0; i < 300; i++) rows.push({ month: m, end: m === "2026-01" ? "2026-01-30" : m === "2026-02" ? `2026-03-0${1 + (i % 5)}` : "2026-04-02" });
  const seen = [];
  const r = Mo.chooseLambda(rows, [1, 2, 3], (tr, va, lam) => { seen.push({ tr: tr.length, va: va.length, maxEnd: tr.map((i) => rows[i].end).sort().at(-1), vaMonth: rows[va[0]].month }); return -Math.abs(lam - 2); }, { defaultLambda: 9, minInnerTrain: 200, minInnerVal: 100 });
  assert.equal(r.lambda, 2); assert.equal(r.defaulted, false);
  for (const f of seen) assert.ok(f.maxEnd < `${f.vaMonth}-01`, JSON.stringify(f));
  const r2 = Mo.chooseLambda(rows.slice(0, 250), [1, 2, 3], () => 0, { defaultLambda: 9 });
  assert.equal(r2.lambda, 9); assert.equal(r2.defaulted, true);
  return { folds: r.folds };
});
test("lambda tie-break prefers the larger lambda", () => {
  const rows = []; for (const m of ["2026-01", "2026-02"]) for (let i = 0; i < 300; i++) rows.push({ month: m, end: m === "2026-01" ? "2026-01-20" : "2026-03-01" });
  const r = Mo.chooseLambda(rows, [1, 2, 3], () => 0.5, { defaultLambda: 9 });
  assert.equal(r.lambda, 3);
});

const out = { ranAt: new Date().toISOString(), passed: results.filter((r) => r.ok).length, failed, results };
writeOut("models-test.json", out);
console.log(JSON.stringify({ passed: out.passed, failed, failures: results.filter((r) => !r.ok) }, null, 1));
if (failed) process.exitCode = 1;
