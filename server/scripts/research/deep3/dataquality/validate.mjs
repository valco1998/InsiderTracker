// server/scripts/research/deep3/dataquality/validate.mjs
// Deep study 3: reusable statistical-validation helpers (owner: agent "dataquality").
//
// PURE FUNCTIONS ONLY: no I/O, no network, no imports, no global state. Deterministic: every random
// procedure takes a `seed`. Safe to import from any deep-3 script:
//     import * as V from "../dataquality/validate.mjs";
// Synthetic-data tests: validate.test.mjs (same folder) → .cache/research/deep3/dataquality/validate-test.json
//
// CONVENTIONS
// • rows: arrays of plain objects. Accessor options (value, hit, issuer, insider, date, controls, ...) take a
//   property name ("x") or a function (r) => .... Non-finite values are skipped (reported as `skipped`).
//   Booleans count as 1/0, so hit rates (proportions) use the same code paths as means.
// • A missing cluster key (null / undefined / "") makes that row its own cluster (no dependence assumed).
// • Clustered variance of a mean: CR1 factor G/(G-1) on cluster sums of residuals (identical to lib.mjs
//   clusteredT). p-values use Student t with G-1 df (`p`); `pNormal` is the normal approximation that
//   lib2.companyStats uses (audit E1: anti-conservative when clusters are few).
// • Bootstrap CIs are percentile intervals over B replicates that resample WHOLE clusters (issuers by
//   default) with replacement. Defaults: B = 2000, level = 0.95.
// • Proportions: report the Wilson interval (iid) AND a cluster-aware interval. When they differ, the iid
//   one is wrong for this data (repeat filings of one company or one insider are not independent).
// • KNOWN LIMITATION (validate.test.mjs, synthetic): issuer-bootstrap / clustered-t intervals cover ≈95% when
//   no handful of issuers dominates, but only ≈91% when ~5% of issuers hold ~40% of the rows (250 issuers;
//   the real data has such issuers, e.g. SSP with 32 filings). Naive Wilson covers ≈63% there. In that case
//   also report the one-per-issuer-month version (thinnedStat), which restores ≈93–95% coverage.
//
// CONTENTS
//   basics ............ rng, sum, mean, median, quantile, sd, monthKey
//   distributions ..... normCdf, normInv, lgamma, betaInc, tPValue, tCrit, binomTest
//   proportions ....... wilson, wilsonDeff
//   multiple testing .. bh, bhReject, by, holm
//   clustering ........ clusteredMean, twoWayClusteredMean, clusterSummary, icc, designEffect, concentration
//   bootstrap ......... bootstrapMean, bootstrapProportion, blockBootstrap, matchedDiff (+ matchedDiffProportion),
//                       twoSampleDiff
//   sampling .......... onePerIssuerMonth, thinnedStat
//   power / MDE ....... powerMean, mdeMean, nForMean, powerProportionDiff, mdeProportionDiff, nForProportionDiff,
//                       mdeFromData
//   stability ......... monthStability
//   trading ........... profitFactor, tradeStats, drawdown, tradeEquity
//   one-call .......... eventStats (returns), hitRateStats (hit rates)

// =====================================================================================================
// basics
// =====================================================================================================
const acc = (f, def = null) => (typeof f === "function" ? f : typeof f === "string" ? (r) => r?.[f] : def);
const fin = (x) => (typeof x === "boolean" ? (x ? 1 : 0) : typeof x === "number" && Number.isFinite(x) ? x : null);
const keyOf = (k, i) => (k == null || k === "" ? `\u0000row${i}` : k);

// Deterministic PRNG (mulberry32) → () => [0, 1).
export function rng(seed = 7) {
  let a = (Number(seed) >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Standard normal draw from a uniform source (Box-Muller).
export function normal(rnd) { let u = 0; while (u <= 1e-300) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); }

export const sum = (xs) => { let s = 0; for (const x of xs) s += x; return s; };
export const mean = (xs) => (xs.length ? sum(xs) / xs.length : null);
// Type-7 quantile (linear interpolation, as R's default) of an UNSORTED or sorted array.
export function quantile(xs, q, { sorted = false } = {}) {
  if (!xs.length) return null;
  const s = sorted ? xs : Float64Array.from(xs).sort();
  const h = (s.length - 1) * Math.min(1, Math.max(0, q)), lo = Math.floor(h), hi = Math.ceil(h);
  return s[lo] + (h - lo) * (s[hi] - s[lo]);
}
export const median = (xs) => quantile(xs, 0.5);
export function sd(xs) {
  const n = xs.length; if (n < 2) return null;
  let m = 0; for (const x of xs) m += x; m /= n;
  let v = 0; for (const x of xs) v += (x - m) ** 2;
  return Math.sqrt(v / (n - 1));
}
// "YYYY-MM" from "YYYY-MM-DD…", an ISO string, a Date or epoch ms.
export function monthKey(d) {
  if (d instanceof Date) return d.toISOString().slice(0, 7);
  if (typeof d === "number") return new Date(d).toISOString().slice(0, 7);
  const s = String(d ?? "");
  return /^\d{4}-\d{2}/.test(s) ? s.slice(0, 7) : null;
}
// Extract [x] (finite) and parallel [cluster keys] from rows.
function columns(rows, value, cluster = null) {
  const v = acc(value), g = cluster == null ? null : acc(cluster);
  const xs = [], ks = []; let skipped = 0;
  rows.forEach((r, i) => { const x = fin(v(r)); if (x == null) { skipped++; return; } xs.push(x); if (g) ks.push(keyOf(g(r), i)); });
  return { xs, ks, skipped };
}

// =====================================================================================================
// distributions
// =====================================================================================================
// Φ(z). erfc rational approximation (Numerical Recipes erfcc), relative error < 1.2e-7.
export function normCdf(z) {
  const x = Math.abs(z) / Math.SQRT2, t = 1 / (1 + 0.5 * x);
  const r = t * Math.exp(-x * x - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 +
    t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return z >= 0 ? 1 - r / 2 : r / 2;
}
// Φ⁻¹(p), Acklam's algorithm (relative error < 1.2e-9).
export function normInv(p) {
  if (!(p > 0 && p < 1)) return p === 0 ? -Infinity : p === 1 ? Infinity : NaN;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (p < lo) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - lo) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  const q = p - 0.5, r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
// log Γ(x), Lanczos (g = 7).
export function lgamma(x) {
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
  x -= 1; let a = c[0]; const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}
function betacf(a, b, x) {
  const FPMIN = 1e-300, EPS = 3e-14;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - (qab * x) / qap; if (Math.abs(d) < FPMIN) d = FPMIN; d = 1 / d; let h = d;
  for (let m = 1; m <= 400; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN; c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN; d = 1 / d; h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN; c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN; d = 1 / d;
    const del = d * c; h *= del; if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}
// Regularized incomplete beta I_x(a, b).
export function betaInc(x, a, b) {
  if (x <= 0) return 0; if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}
// Two-sided p-value of a t statistic with df degrees of freedom (df null/∞ → normal).
export function tPValue(t, df = null) {
  if (t == null || !Number.isFinite(t)) return null;
  if (df == null || !Number.isFinite(df)) return 2 * (1 - normCdf(Math.abs(t)));
  if (!(df > 0)) return null;
  return betaInc(df / (df + t * t), df / 2, 0.5);
}
// Two-sided critical value: c with P(|T_df| > c) = 1 - level.
export function tCrit(level = 0.95, df = null) {
  if (df == null || !Number.isFinite(df)) return normInv(1 - (1 - level) / 2);
  let lo = 0, hi = 1e4;
  for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; if (tPValue(m, df) > 1 - level) lo = m; else hi = m; }
  return (lo + hi) / 2;
}
// Exact two-sided binomial test of k successes in n trials vs p (sum of outcomes no more likely than k).
export function binomTest(k, n, p = 0.5) {
  if (!(n > 0) || !(p > 0 && p < 1)) return null;
  const lp = (i) => lgamma(n + 1) - lgamma(i + 1) - lgamma(n - i + 1) + i * Math.log(p) + (n - i) * Math.log(1 - p);
  const pk = lp(k); let s = 0;
  for (let i = 0; i <= n; i++) { const li = lp(i); if (li <= pk + 1e-7) s += Math.exp(li); }
  return Math.min(1, s);
}

// =====================================================================================================
// proportions
// =====================================================================================================
// Wilson score interval for k successes out of n (iid assumption).
export function wilson(k, n, { level = 0.95 } = {}) {
  if (!(n > 0)) return { k, n, p: null, lo: null, hi: null };
  const z = normInv(1 - (1 - level) / 2), p = k / n, z2 = z * z;
  const den = 1 + z2 / n, center = (p + z2 / (2 * n)) / den;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / den;
  return { k, n, p, lo: Math.max(0, center - half), hi: Math.min(1, center + half) };
}
// Wilson interval on the effective sample size n / deff (quick cluster adjustment; deff from clusterSummary).
export function wilsonDeff(k, n, deff = 1, { level = 0.95 } = {}) {
  const d = Math.max(1, deff || 1), ne = n / d;
  const w = wilson((k / n) * ne, ne, { level });
  return { ...w, k, n, nEff: ne, deff: d };
}

// =====================================================================================================
// multiple testing
// =====================================================================================================
// Benjamini-Hochberg q-values (step-up). Nulls stay null and are not counted in m.
export function bh(ps) {
  const idx = ps.map((p, i) => [p, i]).filter(([p]) => p != null && Number.isFinite(p)).sort((a, b) => a[0] - b[0]);
  const m = idx.length, q = new Array(ps.length).fill(null);
  let min = 1;
  for (let k = m - 1; k >= 0; k--) { const [p, i] = idx[k]; min = Math.min(min, (p * m) / (k + 1)); q[i] = min; }
  return q;
}
export const bhReject = (ps, alpha = 0.1) => bh(ps).map((q) => q != null && q <= alpha);
// Benjamini-Yekutieli (valid under arbitrary dependence): BH × c(m), c(m) = Σ 1/i.
export function by(ps) {
  const m = ps.filter((p) => p != null && Number.isFinite(p)).length; let c = 0; for (let i = 1; i <= m; i++) c += 1 / i;
  return bh(ps).map((q) => (q == null ? null : Math.min(1, q * c)));
}
// Holm step-down adjusted p-values (family-wise error).
export function holm(ps) {
  const idx = ps.map((p, i) => [p, i]).filter(([p]) => p != null && Number.isFinite(p)).sort((a, b) => a[0] - b[0]);
  const m = idx.length, out = new Array(ps.length).fill(null); let run = 0;
  idx.forEach(([p, i], k) => { run = Math.max(run, Math.min(1, (m - k) * p)); out[i] = run; });
  return out;
}

// =====================================================================================================
// clustering
// =====================================================================================================
function clVar(xs, ks, m) {
  const S = new Map();
  for (let i = 0; i < xs.length; i++) S.set(ks[i], (S.get(ks[i]) || 0) + (xs[i] - m));
  const G = S.size; if (G < 2) return { v: null, G };
  let ss = 0; for (const s of S.values()) ss += s * s;
  return { v: (ss / (xs.length * xs.length)) * (G / (G - 1)), G };
}
// Mean with one-way cluster-robust SE. Returns iid SE and the design effect deff = var_clustered / var_iid.
export function clusteredMean(rows, { value = "x", cluster = "issuer" } = {}) {
  const { xs, ks, skipped } = columns(rows, value, cluster);
  const n = xs.length; if (!n) return { n: 0, skipped };
  const m = sum(xs) / n, { v, G } = clVar(xs, ks, m), s = sd(xs);
  const seIid = s == null ? null : s / Math.sqrt(n), se = v == null ? null : Math.sqrt(v);
  const t = se > 0 ? m / se : null;
  return { n, skipped, clusters: G, mean: m, sd: s, seIid, se, t, df: G - 1, p: tPValue(t, G - 1), pNormal: tPValue(t, null),
    deff: se != null && seIid > 0 ? (se * se) / (seIid * seIid) : null };
}
// Two-way cluster-robust SE (Cameron-Gelbach-Miller): V = V1 + V2 - V12 (V12 clustered on the intersection).
// Typical use: cluster1 = issuer, cluster2 = insider (the same person buying at several companies, or
// repeatedly at one). If V ≤ 0, falls back to max(V1, V2) (flag `fallback`). df = min(G1, G2) - 1.
export function twoWayClusteredMean(rows, { value = "x", cluster1 = "issuer", cluster2 = "insider" } = {}) {
  const v = acc(value), g1 = acc(cluster1), g2 = acc(cluster2);
  const xs = [], k1 = [], k2 = [], k12 = []; let skipped = 0;
  rows.forEach((r, i) => {
    const x = fin(v(r)); if (x == null) { skipped++; return; }
    const a = keyOf(g1(r), i), b = keyOf(g2(r), i);
    xs.push(x); k1.push(a); k2.push(b); k12.push(`${a}\u0001${b}`);
  });
  const n = xs.length; if (!n) return { n: 0, skipped };
  const m = sum(xs) / n;
  const A = clVar(xs, k1, m), Bv = clVar(xs, k2, m), C = clVar(xs, k12, m);
  if (A.v == null || Bv.v == null || C.v == null) return { n, skipped, mean: m, se: null };
  let V = A.v + Bv.v - C.v, fallback = false;
  if (!(V > 0)) { V = Math.max(A.v, Bv.v); fallback = true; }
  const se = Math.sqrt(V), t = se > 0 ? m / se : null, df = Math.min(A.G, Bv.G) - 1;
  return { n, skipped, mean: m, se, t, df, p: tPValue(t, df), pNormal: tPValue(t, null), clusters1: A.G, clusters2: Bv.G, fallback,
    se1: Math.sqrt(A.v), se2: Math.sqrt(Bv.v), se12: Math.sqrt(C.v) };
}
// One-way ANOVA estimator of the intraclass correlation (unbalanced clusters).
export function icc(rows, { value = "x", cluster = "issuer" } = {}) {
  const { xs, ks } = columns(rows, value, cluster);
  const N = xs.length; if (N < 3) return null;
  const g = new Map(); xs.forEach((x, i) => { const a = g.get(ks[i]) || g.set(ks[i], [0, 0]).get(ks[i]); a[0] += x; a[1]++; });
  const G = g.size; if (G < 2 || G >= N) return null;
  const m = sum(xs) / N;
  let ssb = 0, ssw = 0, sn2 = 0;
  for (const [s, c] of g.values()) { ssb += c * (s / c - m) ** 2; sn2 += c * c; }
  for (let i = 0; i < N; i++) { const [s, c] = g.get(ks[i]); ssw += (xs[i] - s / c) ** 2; }
  const msb = ssb / (G - 1), msw = ssw / (N - G), n0 = (N - sn2 / N) / (G - 1);
  const den = msb + (n0 - 1) * msw;
  return den > 0 ? (msb - msw) / den : null;
}
// Design effect for unequal cluster sizes: 1 + (Σm²/Σm - 1)·ICC.
export function designEffect({ sizes, icc: rho }) {
  const s = sum(sizes), s2 = sizes.reduce((a, m) => a + m * m, 0);
  return s > 0 ? 1 + (s2 / s - 1) * (rho || 0) : null;
}
// Concentration of rows and of the summed value across clusters (top-1 / top-5 share, HHI of row counts).
export function concentration(rows, { value = "x", cluster = "issuer", k = 5 } = {}) {
  const { xs, ks } = columns(rows, value, cluster);
  if (!xs.length) return { n: 0 };
  const g = new Map(); xs.forEach((x, i) => { const a = g.get(ks[i]) || g.set(ks[i], [0, 0]).get(ks[i]); a[0] += x; a[1]++; });
  const arr = [...g.entries()].map(([key, [s, c]]) => ({ key, s, c }));
  const n = xs.length, total = sum(xs), absTotal = arr.reduce((a, x) => a + Math.abs(x.s), 0);
  const byCount = [...arr].sort((a, b) => b.c - a.c), byContrib = [...arr].sort((a, b) => b.s - a.s);
  const top = new Set(byContrib.slice(0, k).map((x) => x.key));
  const rest = []; xs.forEach((x, i) => { if (!top.has(ks[i])) rest.push(x); });
  return {
    n, clusters: arr.length, largestClusterRows: byCount[0].c, largestClusterShare: byCount[0].c / n,
    topKRowShare: byCount.slice(0, k).reduce((a, x) => a + x.c, 0) / n,
    hhiRows: arr.reduce((a, x) => a + (x.c / n) ** 2, 0),
    topKContributionShare: total !== 0 ? byContrib.slice(0, k).reduce((a, x) => a + x.s, 0) / total : null,
    topKAbsShare: absTotal > 0 ? byContrib.slice(0, k).reduce((a, x) => a + Math.abs(x.s), 0) / absTotal : null,
    meanExTopK: rest.length ? mean(rest) : null, topK: byContrib.slice(0, k).map((x) => ({ cluster: x.key, rows: x.c, sum: x.s })),
  };
}
// Mean with iid, issuer-clustered, insider-clustered and two-way SEs, design effects and effective n.
// Repeated-insider dependence shows up as deffInsider > 1 (the same person's buys move together).
export function clusterSummary(rows, { value = "x", issuer = "issuer", insider = "insider" } = {}) {
  const a = clusteredMean(rows, { value, cluster: issuer });
  if (!a.n) return { n: 0 };
  const b = clusteredMean(rows, { value, cluster: insider });
  const w = twoWayClusteredMean(rows, { value, cluster1: issuer, cluster2: insider });
  const deffTwoWay = w.se != null && a.seIid > 0 ? (w.se * w.se) / (a.seIid * a.seIid) : null;
  const worst = Math.max(1, a.deff || 1, b.deff || 1, deffTwoWay || 1);
  return {
    n: a.n, mean: a.mean, sd: a.sd, issuers: a.clusters, insiders: b.clusters,
    iid: { se: a.seIid, t: a.seIid > 0 ? a.mean / a.seIid : null, p: a.seIid > 0 ? tPValue(a.mean / a.seIid, a.n - 1) : null },
    issuer: { se: a.se, t: a.t, df: a.df, p: a.p, pNormal: a.pNormal, deff: a.deff },
    insider: { se: b.se, t: b.t, df: b.df, p: b.p, pNormal: b.pNormal, deff: b.deff },
    twoWay: { se: w.se, t: w.t, df: w.df, p: w.p, pNormal: w.pNormal, deff: deffTwoWay, fallback: w.fallback },
    maxDeff: worst, effectiveN: a.n / worst,
  };
}

// =====================================================================================================
// bootstrap (cluster blocks)
// =====================================================================================================
function pctCI(draws, level) { const s = Float64Array.from(draws).sort(), a = (1 - level) / 2; return [quantile(s, a, { sorted: true }), quantile(s, 1 - a, { sorted: true })]; }
// Issuer-block bootstrap of a mean (fast path: per-cluster sums). lo/hi = percentile interval; ciT = bootstrap-t
// (studentized with the replicate's CR1 clustered SE), slightly better when a few clusters dominate.
export function bootstrapMean(rows, { value = "x", cluster = "issuer", B = 2000, seed = 7, level = 0.95 } = {}) {
  const { xs, ks, skipped } = columns(rows, value, cluster);
  if (!xs.length) return { n: 0, skipped };
  const g = new Map(); xs.forEach((x, i) => { const a = g.get(ks[i]) || g.set(ks[i], [0, 0]).get(ks[i]); a[0] += x; a[1]++; });
  const S = [...g.values()].map((a) => a[0]), C = [...g.values()].map((a) => a[1]), G = S.length, rnd = rng(seed);
  const n = xs.length, m = sum(xs) / n, f = G > 1 ? G / (G - 1) : null;
  const seOf = (idx, mm, cc) => { let ss = 0; for (const u of idx) ss += (S[u] - mm * C[u]) ** 2; return f ? Math.sqrt((ss / (cc * cc)) * f) : null; };
  const se0 = seOf([...Array(G).keys()], m, n);
  const draws = new Float64Array(B), ts = [], idx = new Int32Array(G);
  for (let b = 0; b < B; b++) {
    let s = 0, c = 0; for (let j = 0; j < G; j++) { const u = (rnd() * G) | 0; idx[j] = u; s += S[u]; c += C[u]; }
    draws[b] = s / c; const sb = seOf(idx, s / c, c); if (sb > 0) ts.push((s / c - m) / sb);
  }
  const [lo, hi] = pctCI(draws, level), a = (1 - level) / 2;
  const ciT = se0 > 0 && ts.length > 10 ? (() => { const t = Float64Array.from(ts).sort(); return [m - quantile(t, 1 - a, { sorted: true }) * se0, m - quantile(t, a, { sorted: true }) * se0]; })() : [null, null];
  return { n, skipped, clusters: G, estimate: m, lo, hi, ciT, se: sd(draws), seClustered: se0, B, level };
}
// Hit rate with Wilson (iid), issuer-block bootstrap CI, clustered SE and a deff-adjusted Wilson interval.
export function bootstrapProportion(rows, { hit = "hit", cluster = "issuer", B = 2000, seed = 7, level = 0.95 } = {}) {
  const bm = bootstrapMean(rows, { value: hit, cluster, B, seed, level });
  if (!bm.n) return { n: 0 };
  const cm = clusteredMean(rows, { value: hit, cluster });
  const k = Math.round(bm.estimate * bm.n), w = wilson(k, bm.n, { level });
  return { n: bm.n, k, clusters: bm.clusters, p: bm.estimate, ci: [bm.lo, bm.hi], wilson: [w.lo, w.hi],
    wilsonDeff: (({ lo, hi }) => [lo, hi])(wilsonDeff(k, bm.n, cm.deff, { level })), seClustered: cm.se, deff: cm.deff, B, level };
}
// Generic issuer-block bootstrap: stat(rowsOfReplicate) → number. Slower; use for medians, ratios, etc.
export function blockBootstrap(rows, { stat, cluster = "issuer", B = 1000, seed = 7, level = 0.95 } = {}) {
  const g = acc(cluster), groups = new Map();
  rows.forEach((r, i) => { const k = keyOf(g(r), i); (groups.get(k) || groups.set(k, []).get(k)).push(r); });
  const blocks = [...groups.values()], G = blocks.length, rnd = rng(seed), draws = [];
  let failed = 0;
  for (let b = 0; b < B; b++) {
    const rep = []; for (let j = 0; j < G; j++) for (const r of blocks[(rnd() * G) | 0]) rep.push(r);
    const x = fin(stat(rep)); if (x == null) failed++; else draws.push(x);
  }
  const [lo, hi] = draws.length ? pctCI(draws, level) : [null, null];
  return { n: rows.length, clusters: G, estimate: fin(stat(rows)), lo, hi, se: sd(draws), B, failed, level };
}
// Event vs MATCHED controls (paired design). Each row = one event: value (0/1 hit or a return) and
// `controls` = array of the matched controls' values (or a function returning it). Per-event difference
// d = value - mean(controls); estimate = mean(d) (each event weighted once, whatever its control count).
// Uncertainty: issuer-block bootstrap of d and a clustered t on d. Events without a valid control are dropped.
export function matchedDiff(rows, { value = "x", controls = "controls", cluster = "issuer", B = 2000, seed = 7, level = 0.95 } = {}) {
  const v = acc(value), c = acc(controls), g = acc(cluster);
  const d = [], ev = [], ct = []; let dropped = 0, pooledS = 0, pooledN = 0;
  rows.forEach((r, i) => {
    const x = fin(v(r)), cs = (c(r) || []).map(fin).filter((y) => y != null);
    if (x == null || !cs.length) { dropped++; return; }
    const cm = sum(cs) / cs.length; pooledS += sum(cs); pooledN += cs.length;
    d.push({ k: keyOf(g(r), i), d: x - cm }); ev.push(x); ct.push(cm);
  });
  if (!d.length) return { n: 0, dropped };
  const bm = bootstrapMean(d, { value: "d", cluster: "k", B, seed, level }), cm = clusteredMean(d, { value: "d", cluster: "k" });
  const k1 = Math.round(sum(ev)), w1 = wilson(k1, ev.length, { level }), allBinary = ev.every((x) => x === 0 || x === 1);
  return {
    n: d.length, dropped, clusters: bm.clusters, eventMean: mean(ev), controlMean: mean(ct), pooledControlMean: pooledS / pooledN, controls: pooledN,
    diff: bm.estimate, ci: [bm.lo, bm.hi], seBoot: bm.se, seClustered: cm.se, t: cm.t, df: cm.df, p: cm.p, pNormal: cm.pNormal, deff: cm.deff,
    wilsonEvent: allBinary ? [w1.lo, w1.hi] : null, B, level,
  };
}
export const matchedDiffProportion = (rows, opts = {}) => matchedDiff(rows, { value: "hit", ...opts });
// Two independent samples (e.g. insider events vs the all-insider-purchase baseline). Joint cluster
// resampling (default): draw clusters from the UNION of both samples' clusters, so an issuer present in
// both samples keeps its dependence. joint=false resamples each sample's clusters separately.
export function twoSampleDiff(a, b, { value = "x", cluster = "issuer", B = 2000, seed = 7, level = 0.95, joint = true } = {}) {
  const A = columns(a, value, cluster), Bc = columns(b, value, cluster);
  if (!A.xs.length || !Bc.xs.length) return { nA: A.xs.length, nB: Bc.xs.length };
  const agg = (cols) => { const g = new Map(); cols.xs.forEach((x, i) => { const t = g.get(cols.ks[i]) || g.set(cols.ks[i], [0, 0]).get(cols.ks[i]); t[0] += x; t[1]++; }); return g; };
  const ga = agg(A), gb = agg(Bc), rnd = rng(seed), draws = [];
  const est = mean(A.xs) - mean(Bc.xs);
  if (joint) {
    const keys = [...new Set([...ga.keys(), ...gb.keys()])], G = keys.length;
    const SA = keys.map((k) => ga.get(k) || [0, 0]), SB = keys.map((k) => gb.get(k) || [0, 0]);
    for (let r = 0; r < B; r++) {
      let sa = 0, na = 0, sb = 0, nb = 0;
      for (let j = 0; j < G; j++) { const u = (rnd() * G) | 0; sa += SA[u][0]; na += SA[u][1]; sb += SB[u][0]; nb += SB[u][1]; }
      if (na && nb) draws.push(sa / na - sb / nb);
    }
  } else {
    const SA = [...ga.values()], SB = [...gb.values()];
    for (let r = 0; r < B; r++) {
      let sa = 0, na = 0, sb = 0, nb = 0;
      for (let j = 0; j < SA.length; j++) { const t = SA[(rnd() * SA.length) | 0]; sa += t[0]; na += t[1]; }
      for (let j = 0; j < SB.length; j++) { const t = SB[(rnd() * SB.length) | 0]; sb += t[0]; nb += t[1]; }
      draws.push(sa / na - sb / nb);
    }
  }
  const [lo, hi] = pctCI(draws, level), se = sd(draws);
  const z = se > 0 ? est / se : null;
  return { nA: A.xs.length, nB: Bc.xs.length, clustersA: ga.size, clustersB: gb.size, meanA: mean(A.xs), meanB: mean(Bc.xs), diff: est,
    ci: [lo, hi], se, z, p: tPValue(z, null), B: draws.length, joint, level };
}

// =====================================================================================================
// sampling
// =====================================================================================================
// Keep ONE event per (issuer, calendar month). pick: "first" (earliest date; ties → input order), "last",
// "random" (seeded), or a function (groupRows) => row. Output keeps the input order.
export function onePerIssuerMonth(rows, { issuer = "issuer", date = "date", pick = "first", seed = 7 } = {}) {
  const gi = acc(issuer), gd = acc(date), groups = new Map(), rnd = rng(seed);
  rows.forEach((r, i) => {
    const d = String(gd(r) ?? ""), key = `${keyOf(gi(r), i)}|${monthKey(d)}`;
    (groups.get(key) || groups.set(key, []).get(key)).push({ r, i, d });
  });
  const chosen = [];
  for (const g of groups.values()) {
    let x;
    if (typeof pick === "function") { const r = pick(g.map((y) => y.r)); x = g.find((y) => y.r === r) || g[0]; }
    else if (pick === "random") x = g[(rnd() * g.length) | 0];
    else { const s = [...g].sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : a.i - b.i)); x = pick === "last" ? s.at(-1) : s[0]; }
    chosen.push(x);
  }
  return chosen.sort((a, b) => a.i - b.i).map((x) => x.r);
}
// Distribution of stat(sample) over `reps` random one-per-issuer-month draws (robustness to clustering in
// time and company). Also reports the deterministic "first event" version.
export function thinnedStat(rows, stat, { reps = 200, seed = 7, issuer = "issuer", date = "date", level = 0.95 } = {}) {
  const vals = [];
  for (let k = 0; k < reps; k++) { const x = fin(stat(onePerIssuerMonth(rows, { issuer, date, pick: "random", seed: seed + 7919 * k }))); if (x != null) vals.push(x); }
  const first = onePerIssuerMonth(rows, { issuer, date, pick: "first" });
  const [lo, hi] = vals.length ? pctCI(vals, level) : [null, null];
  return { reps: vals.length, nKept: first.length, nAll: rows.length, first: fin(stat(first)), mean: mean(vals), median: median(vals), lo, hi };
}

// =====================================================================================================
// power / minimum detectable effect
// =====================================================================================================
const zA = (alpha, twoSided) => normInv(1 - (twoSided ? alpha / 2 : alpha));
// Power of a test of a mean = 0 (or a difference with sd of the difference) with n events and design effect deff.
export function powerMean({ delta, sd: s, n, alpha = 0.05, twoSided = true, deff = 1 }) {
  const se = s * Math.sqrt(Math.max(deff, 1e-9) / n), z = zA(alpha, twoSided), d = Math.abs(delta) / se;
  return normCdf(d - z) + (twoSided ? normCdf(-d - z) : 0);
}
// Smallest |mean| detectable with the given power: (z_α + z_β)·sd·√(deff/n).
export const mdeMean = ({ n, sd: s, alpha = 0.05, power = 0.8, twoSided = true, deff = 1 }) => (zA(alpha, twoSided) + normInv(power)) * s * Math.sqrt(deff / n);
export const nForMean = ({ delta, sd: s, alpha = 0.05, power = 0.8, twoSided = true, deff = 1 }) => Math.ceil(((zA(alpha, twoSided) + normInv(power)) * s / Math.abs(delta)) ** 2 * deff);
// Power to detect p1 vs p0 with n1 events and n2 controls (n2 = Infinity → p0 is a known baseline).
// deff1/deff2: design effects of each sample (clustering by issuer/insider/date).
export function powerProportionDiff({ p0, p1, n1, n2 = Infinity, alpha = 0.05, twoSided = true, deff1 = 1, deff2 = 1 }) {
  const e1 = n1 / Math.max(deff1, 1e-9), e2 = n2 === Infinity ? Infinity : n2 / Math.max(deff2, 1e-9), q = (p) => p * (1 - p);
  let seNull, seAlt;
  if (e2 === Infinity) { seNull = Math.sqrt(q(p0) / e1); seAlt = Math.sqrt(q(p1) / e1); }
  else { const pb = (e1 * p1 + e2 * p0) / (e1 + e2); seNull = Math.sqrt(q(pb) * (1 / e1 + 1 / e2)); seAlt = Math.sqrt(q(p1) / e1 + q(p0) / e2); }
  if (!(seAlt > 0)) return p1 === p0 ? alpha : 1;
  const z = zA(alpha, twoSided), d = Math.abs(p1 - p0);
  return normCdf((d - z * seNull) / seAlt) + (twoSided ? normCdf((-d - z * seNull) / seAlt) : 0);
}
// Minimum detectable difference of hit rates (direction +1: p1 > p0). → { delta, p1 } or null if not reachable.
export function mdeProportionDiff({ p0, n1, n2 = Infinity, alpha = 0.05, power = 0.8, twoSided = true, deff1 = 1, deff2 = 1, direction = 1 }) {
  const max = direction > 0 ? 1 - p0 - 1e-9 : p0 - 1e-9;
  const pw = (dl) => powerProportionDiff({ p0, p1: p0 + direction * dl, n1, n2, alpha, twoSided, deff1, deff2 });
  if (!(max > 0) || pw(max) < power) return null;
  let lo = 0, hi = max;
  for (let i = 0; i < 100; i++) { const m = (lo + hi) / 2; if (pw(m) >= power) hi = m; else lo = m; }
  return { delta: hi, p1: p0 + direction * hi };
}
// Events needed (n1; controls n2 = ratio·n1, ratio = Infinity → known baseline) to detect p1 vs p0.
export function nForProportionDiff({ p0, p1, ratio = 1, alpha = 0.05, power = 0.8, twoSided = true, deff1 = 1, deff2 = 1 }) {
  const pw = (n) => powerProportionDiff({ p0, p1, n1: n, n2: ratio === Infinity ? Infinity : ratio * n, alpha, twoSided, deff1, deff2 });
  let hi = 2; while (pw(hi) < power) { hi *= 2; if (hi > 1e9) return null; }
  let lo = 1; while (hi - lo > 1) { const m = Math.floor((lo + hi) / 2); if (pw(m) >= power) hi = m; else lo = m; }
  return hi;
}
// MDE implied by YOUR data: observed sd and observed issuer design effect (floored at 1).
export function mdeFromData(rows, { value = "x", cluster = "issuer", alpha = 0.05, power = 0.8, twoSided = true } = {}) {
  const c = clusteredMean(rows, { value, cluster });
  if (!(c.n > 2)) return { n: c.n || 0 };
  const deff = Math.max(1, c.deff || 1);
  return { n: c.n, clusters: c.clusters, sd: c.sd, deff, effectiveN: c.n / deff, mde: mdeMean({ n: c.n, sd: c.sd, alpha, power, twoSided, deff }), mdeIid: mdeMean({ n: c.n, sd: c.sd, alpha, power, twoSided, deff: 1 }) };
}

// =====================================================================================================
// month stability
// =====================================================================================================
// Per-calendar-month summary of a per-event value (a return, or a hit 0/1, or a hit minus its control
// rate). `baseline` (number or month => number) defines a "good" month: mean > baseline (default 0).
// Fama-MacBeth style t: mean of monthly means / (sd / √M), df = M - 1 (robust to same-month correlation).
export function monthStability(rows, { value = "x", date = "date", issuer = "issuer", baseline = 0, minN = 1 } = {}) {
  const v = acc(value), gd = acc(date), gi = acc(issuer), by = new Map();
  rows.forEach((r, i) => { const x = fin(v(r)), m = monthKey(gd(r)); if (x == null || !m) return; const a = by.get(m) || by.set(m, { xs: [], iss: new Set() }).get(m); a.xs.push(x); a.iss.add(keyOf(gi(r), i)); });
  const base = typeof baseline === "function" ? baseline : () => baseline;
  const months = [...by.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).filter(([, a]) => a.xs.length >= minN).map(([m, a]) => ({
    month: m, n: a.xs.length, issuers: a.iss.size, mean: mean(a.xs), median: median(a.xs), positive: a.xs.filter((x) => x > 0).length / a.xs.length,
    sum: sum(a.xs), baseline: base(m), beats: mean(a.xs) > base(m),
  }));
  const M = months.length; if (!M) return { months: [], M: 0 };
  const mm = months.map((x) => x.mean - x.baseline), good = months.filter((x) => x.beats).length;
  const s = sd(mm), fmT = s > 0 ? mean(mm) / (s / Math.sqrt(M)) : null;
  const total = sum(months.map((x) => x.sum)), allN = sum(months.map((x) => x.n));
  const topPos = [...months].sort((a, b) => b.sum - a.sum)[0];
  const half = Math.floor(M / 2), m1 = months.slice(0, half), m2 = months.slice(half);
  const wmean = (ms) => { const n = sum(ms.map((x) => x.n)); return n ? sum(ms.map((x) => x.sum)) / n : null; };
  return {
    months, M, monthsBeating: good, shareBeating: good / M, signTestP: binomTest(good, M, 0.5),
    meanOfMonthlyExcess: mean(mm), sdOfMonthlyExcess: s, fmT, fmP: tPValue(fmT, M - 1),
    worst: [...months].sort((a, b) => a.mean - b.mean)[0], best: [...months].sort((a, b) => b.mean - a.mean)[0],
    topMonthShareOfSum: total !== 0 ? topPos.sum / total : null, meanExTopMonth: allN - topPos.n > 0 ? (total - topPos.sum) / (allN - topPos.n) : null,
    firstHalf: { months: m1.length, mean: wmean(m1) }, secondHalf: { months: m2.length, mean: wmean(m2) },
  };
}

// =====================================================================================================
// trading summaries
// =====================================================================================================
// Profit factor = Σ gains / |Σ losses| over per-trade returns (Infinity if no losing trade).
export function profitFactor(xs) {
  const v = xs.map(fin).filter((x) => x != null); let w = 0, l = 0, nw = 0, nl = 0;
  for (const x of v) { if (x > 0) { w += x; nw++; } else if (x < 0) { l -= x; nl++; } }
  return { n: v.length, wins: nw, losses: nl, grossWin: w, grossLoss: l, pf: l > 0 ? w / l : w > 0 ? Infinity : null };
}
// Per-trade distribution: hit rate, payoff, expectancy, tails (5% CVaR = mean of the worst 5%).
export function tradeStats(xs) {
  const v = xs.map(fin).filter((x) => x != null); if (!v.length) return { n: 0 };
  const s = Float64Array.from(v).sort(), pf = profitFactor(v), wins = v.filter((x) => x > 0), losses = v.filter((x) => x < 0);
  const k5 = Math.max(1, Math.floor(0.05 * s.length)), geo = v.every((x) => x > -1) ? Math.exp(mean(v.map((x) => Math.log1p(x)))) - 1 : null;
  return { n: v.length, mean: mean(v), median: median(v), hitRate: wins.length / v.length, avgWin: mean(wins), avgLoss: mean(losses),
    payoff: wins.length && losses.length ? mean(wins) / Math.abs(mean(losses)) : null, profitFactor: pf.pf, best: s[s.length - 1], worst: s[0],
    p5: quantile(s, 0.05, { sorted: true }), p95: quantile(s, 0.95, { sorted: true }), cvar5: mean(Array.from(s.slice(0, k5))), geoMean: geo };
}
// Drawdown of an ORDERED series of period returns (daily portfolio returns, or per-trade returns × fraction).
// compound=true: equity *= 1 + r and drawdowns are fractions of the peak; false: equity += r (points).
// dates (optional) label peak / trough / recovery. Duration = periods from the peak to recovery (or the end).
export function drawdown(returns, { compound = true, start = 1, dates = null } = {}) {
  let eq = compound ? start : 0, peak = eq, peakI = -1, maxDD = 0, ddPeak = -1, ddTrough = -1, under = 0, longest = 0, underCount = 0;
  const curve = [];
  returns.forEach((r0, i) => {
    const r = fin(r0) ?? 0; eq = compound ? eq * (1 + r) : eq + r; curve.push(eq);
    if (eq >= peak) { peak = eq; peakI = i; under = 0; } else { under++; underCount++; longest = Math.max(longest, under); }
    const dd = compound ? eq / peak - 1 : eq - peak;
    if (dd < maxDD) { maxDD = dd; ddPeak = peakI; ddTrough = i; }
  });
  let recovery = null;
  if (ddTrough >= 0) { const pk = ddPeak >= 0 ? curve[ddPeak] : (compound ? start : 0); for (let i = ddTrough + 1; i < curve.length; i++) if (curve[i] >= pk) { recovery = i; break; } }
  const lab = (i) => (i == null || i < 0 ? null : dates ? dates[i] ?? i : i);
  const total = compound ? eq / start - 1 : eq;
  return { periods: returns.length, final: eq, totalReturn: total, maxDrawdown: maxDD, peakAt: lab(ddPeak), troughAt: lab(ddTrough), recoveredAt: lab(recovery),
    ddDurationPeriods: ddTrough >= 0 ? (recovery ?? returns.length - 1) - Math.max(ddPeak, -1) : 0, longestUnderwater: longest,
    underwaterShare: returns.length ? underCount / returns.length : null, calmar: maxDD < 0 ? total / Math.abs(maxDD) : null, curve };
}
// Equity of a trade list compounded in EXIT-date order, each trade risking `fraction` of equity.
// APPROXIMATION (no overlap / cash accounting); for portfolio realism use execLib.simulatePortfolio2.
export function tradeEquity(trades, { ret = "x", exitDate = "exitDate", fraction = 0.1 } = {}) {
  const v = acc(ret), d = acc(exitDate);
  const ts = trades.map((t, i) => ({ x: fin(v(t)), d: String(d(t) ?? ""), i })).filter((t) => t.x != null).sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : a.i - b.i));
  const dd = drawdown(ts.map((t) => t.x * fraction), { dates: ts.map((t) => t.d) });
  const byMonth = new Map(); for (const t of ts) { const m = monthKey(t.d) || "?"; byMonth.set(m, (byMonth.get(m) || 0) + t.x * fraction); }
  const months = [...byMonth.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([month, r]) => ({ month, r }));
  const { curve, ...rest } = dd;
  return { ...rest, fraction, trades: ts.length, profitFactor: profitFactor(ts.map((t) => t.x)).pf, months,
    worstMonth: months.length ? months.reduce((a, b) => (b.r < a.r ? b : a)) : null, monthsPositive: months.filter((m) => m.r > 0).length };
}

// =====================================================================================================
// one-call summaries
// =====================================================================================================
// Returns per event (x = net excess, etc.): a superset of lib2.companyStats with insider and two-way
// clustering, t-distribution p-values, month stability, a one-per-issuer-month robustness check,
// concentration, profit factor and the data-implied MDE.
export function eventStats(rows, { value = "x", issuer = "issuer", insider = "insider", date = "date", B = 2000, seed = 7, level = 0.95, thinReps = 100 } = {}) {
  const v = acc(value), use = rows.filter((r) => fin(v(r)) != null);
  if (!use.length) return { n: 0 };
  const xs = use.map((r) => fin(v(r))), gi = acc(issuer);
  const cs = clusterSummary(use, { value, issuer, insider }), bm = bootstrapMean(use, { value, cluster: issuer, B, seed, level });
  const byI = new Map(); use.forEach((r, i) => { const k = keyOf(gi(r), i); (byI.get(k) || byI.set(k, []).get(k)).push(fin(v(r))); });
  const im = [...byI.values()].map(mean), conc = concentration(use, { value, cluster: issuer, k: 5 });
  const hasDate = use.some((r) => monthKey(acc(date)(r)));
  return {
    n: cs.n, issuers: cs.issuers, insiders: cs.insiders, mean: cs.mean, median: median(xs), positive: xs.filter((x) => x > 0).length / xs.length,
    issuerMedianOfMeans: median(im), issuersPositive: im.filter((x) => x > 0).length / im.length,
    t: cs.issuer.t, p: cs.issuer.p, pNormal: cs.issuer.pNormal, tInsider: cs.insider.t, pInsider: cs.insider.p, tTwoWay: cs.twoWay.t, pTwoWay: cs.twoWay.p,
    deffIssuer: cs.issuer.deff, deffInsider: cs.insider.deff, deffTwoWay: cs.twoWay.deff, effectiveN: cs.effectiveN,
    ci: [bm.lo, bm.hi], meanExTop5Issuers: conc.meanExTopK, top5ContributionShare: conc.topKContributionShare, largestIssuerShare: conc.largestClusterShare,
    profitFactor: profitFactor(xs).pf,
    months: hasDate ? monthStability(use, { value, date, issuer }) : null,
    onePerIssuerMonth: hasDate ? thinnedStat(use, (s) => mean(s.map((r) => fin(v(r)))), { reps: thinReps, seed, issuer, date }) : null,
    mde80: mdeFromData(use, { value, cluster: issuer }).mde,
  };
}
// Hit rates (hit = 0/1): Wilson, issuer-block bootstrap, issuer/insider/two-way clustered SEs, deff-adjusted
// Wilson, month stability and the one-per-issuer-month version. Pass `baseline` (the control or all-purchase
// hit rate: a number or month => rate) so that "months beating" is meaningful; without it the pooled rate is
// used and the month table only shows dispersion.
export function hitRateStats(rows, { hit = "hit", issuer = "issuer", insider = "insider", date = "date", B = 2000, seed = 7, level = 0.95, thinReps = 100, baseline = null } = {}) {
  const h = acc(hit), use = rows.filter((r) => fin(h(r)) != null);
  if (!use.length) return { n: 0 };
  const bp = bootstrapProportion(use, { hit, cluster: issuer, B, seed, level }), cs = clusterSummary(use, { value: hit, issuer, insider });
  const hasDate = use.some((r) => monthKey(acc(date)(r)));
  return {
    n: bp.n, k: bp.k, issuers: cs.issuers, insiders: cs.insiders, rate: bp.p, wilson: bp.wilson, issuerBootstrap: bp.ci,
    wilsonMaxDeff: (({ lo, hi }) => [lo, hi])(wilsonDeff(bp.k, bp.n, cs.maxDeff, { level })),
    seIid: cs.iid.se, seIssuer: cs.issuer.se, seInsider: cs.insider.se, seTwoWay: cs.twoWay.se, deffIssuer: cs.issuer.deff, deffInsider: cs.insider.deff,
    deffTwoWay: cs.twoWay.deff, effectiveN: cs.effectiveN,
    monthsBaseline: baseline == null ? "pooled rate (dispersion only)" : "supplied",
    months: hasDate ? monthStability(use, { value: hit, date, issuer, baseline: baseline ?? bp.p }) : null,
    onePerIssuerMonth: hasDate ? thinnedStat(use, (s) => mean(s.map((r) => fin(h(r)))), { reps: thinReps, seed, issuer, date }) : null,
  };
}
