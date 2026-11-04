// server/scripts/research/deep3/dataquality/validate.test.mjs
// Synthetic-data tests for validate.mjs (no real data, no network). Run from server/:
//   node scripts/research/deep3/dataquality/validate.test.mjs
// Writes .cache/research/deep3/dataquality/validate-test.json; exits 1 if any check fails.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as V from "../../deep3/dataquality/validate.mjs";

const OUT = "C:\\Users\\akiva\\insider-tracker\\server\\.cache\\research\\deep4\\panel";
fs.mkdirSync(OUT, { recursive: true });
const checks = [];
const near = (a, b, tol) => a != null && b != null && Math.abs(a - b) <= tol;
function check(name, ok, detail = {}) { checks.push({ name, ok: !!ok, ...detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${JSON.stringify(detail)}`); }
const t0 = Date.now();

// ---------------- 1. distributions (known values) ----------------
check("normInv(0.975) = 1.959964", near(V.normInv(0.975), 1.959964, 1e-6), { got: V.normInv(0.975) });
check("normCdf(1.959964) = 0.975", near(V.normCdf(1.959964), 0.975, 1e-6), { got: V.normCdf(1.959964) });
check("t p-value t=2.228, df=10 ≈ 0.05", near(V.tPValue(2.228, 10), 0.05, 3e-4), { got: V.tPValue(2.228, 10) });
check("t p-value t=2.0, df=10 ≈ 0.0734", near(V.tPValue(2.0, 10), 0.0734, 3e-4), { got: V.tPValue(2.0, 10) });
check("tCrit(0.95, 29) ≈ 2.045", near(V.tCrit(0.95, 29), 2.0452, 1e-3), { got: V.tCrit(0.95, 29) });
check("binomTest(8,10) = 0.1094", near(V.binomTest(8, 10), 0.109375, 1e-6), { got: V.binomTest(8, 10) });
check("binomTest(10,10) = 0.001953", near(V.binomTest(10, 10), 0.001953125, 1e-7), { got: V.binomTest(10, 10) });

// ---------------- 2. Wilson ----------------
const w0 = V.wilson(0, 10), w5 = V.wilson(5, 10);
check("wilson 0/10 = [0, 0.2775]", near(w0.lo, 0, 1e-9) && near(w0.hi, 0.2775, 1e-4), w0);
check("wilson 5/10 = [0.2366, 0.7634]", near(w5.lo, 0.2366, 1e-4) && near(w5.hi, 0.7634, 1e-4), w5);
const ws = V.wilson(13, 57), wm = V.wilson(44, 57);
check("wilson symmetry lo(k) = 1 - hi(n-k)", near(ws.lo, 1 - wm.hi, 1e-12));

// ---------------- 3. multiple testing ----------------
const ps = [0.01, 0.04, 0.03, 0.005, null];
const q = V.bh(ps);
check("BH hand example", near(q[0], 0.02, 1e-12) && near(q[1], 0.04, 1e-12) && near(q[2], 0.04, 1e-12) && near(q[3], 0.02, 1e-12) && q[4] === null, { q });
{ // brute-force reference on random p-values
  const r = V.rng(11), P = Array.from({ length: 200 }, () => r() ** 2);
  const sorted = [...P].map((p, i) => [p, i]).sort((a, b) => a[0] - b[0]), m = P.length, ref = new Array(m);
  sorted.forEach(([, i], k) => { let mn = 1; for (let j = k; j < m; j++) mn = Math.min(mn, (sorted[j][0] * m) / (j + 1)); ref[i] = mn; });
  const got = V.bh(P);
  check("BH equals brute-force step-up definition (200 random p)", got.every((x, i) => near(x, ref[i], 1e-12)));
  const h = V.holm(P), byq = V.by(P);
  check("Holm ≥ BH and BY ≥ BH", h.every((x, i) => x >= got[i] - 1e-12) && byq.every((x, i) => x >= got[i] - 1e-12));
}

// ---------------- synthetic generators ----------------
// Binary outcomes with an issuer random effect (latent-normal threshold model) and skewed cluster sizes,
// as in the real data (many issuers with 1-2 filings, a few with dozens).
function simBinary({ G, p, sdU, seed, sdInsider = 0, big = 0.05 }) {
  const r = V.rng(seed), rows = [];
  const c = V.normInv(1 - p) * Math.sqrt(1 + sdU * sdU + sdInsider * sdInsider);
  for (let g = 0; g < G; g++) {
    const u = sdU * V.normal(r);
    const size = r() < big ? 15 + Math.floor(r() * 25) : 1 + Math.floor(-Math.log(1 - r()) * 1.5);
    const nIns = 1 + Math.floor(r() * Math.min(size, 3)), ins = Array.from({ length: nIns }, () => sdInsider * V.normal(r));
    for (let i = 0; i < size; i++) {
      const k = i % nIns, month = `2026-${String(1 + Math.floor(r() * 6)).padStart(2, "0")}`;
      rows.push({ issuer: `I${g}`, insider: `I${g}P${k}`, date: `${month}-1${Math.floor(r() * 9)}`, hit: u + ins[k] + V.normal(r) > c ? 1 : 0 });
    }
  }
  return rows;
}

// ---------------- 4. coverage of the issuer-block bootstrap vs naive Wilson ----------------
// (a) clustered, no dominant issuers; (b) concentrated: ~5% of issuers hold ~40% of rows (known limitation).
function coverage({ big, R = 300, p = 0.3, G = 250, seed0 = 1000 }) {
  let covB = 0, covT = 0, covW = 0, covWD = 0, covThin = 0, rows0 = 0; const deffs = [];
  for (let k = 0; k < R; k++) {
    const rows = simBinary({ G, p, sdU: 0.9, seed: seed0 + k, big });
    rows0 += rows.length;
    const b = V.bootstrapProportion(rows, { hit: "hit", cluster: "issuer", B: 400, seed: k });
    const bt = V.bootstrapMean(rows, { value: "hit", cluster: "issuer", B: 400, seed: k });
    if (b.ci[0] <= p && p <= b.ci[1]) covB++;
    if (bt.ciT[0] <= p && p <= bt.ciT[1]) covT++;
    if (b.wilson[0] <= p && p <= b.wilson[1]) covW++;
    if (b.wilsonDeff[0] <= p && p <= b.wilsonDeff[1]) covWD++;
    const th = V.bootstrapProportion(V.onePerIssuerMonth(rows, { pick: "random", seed: k }), { B: 300, seed: k });
    if (th.ci[0] <= p && p <= th.ci[1]) covThin++;
    deffs.push(b.deff);
  }
  return { reps: R, avgRows: rows0 / R, medianDeff: V.median(deffs), percentile: covB / R, bootstrapT: covT / R, wilson: covW / R, wilsonDeff: covWD / R, thinned: covThin / R };
}
{
  const a = coverage({ big: 0 });
  check("(a) no dominant issuers: issuer-bootstrap coverage ≈ 95%", a.percentile >= 0.925 && a.percentile <= 0.975 && a.bootstrapT >= 0.925, a);
  check("(a) naive Wilson under-covers on clustered data", a.wilson < a.percentile - 0.05, { wilson: a.wilson, bootstrap: a.percentile });
  const b = coverage({ big: 0.05 });
  check("(b) dominant issuers: cluster intervals ≈ 0.90-0.93 (known limitation, documented), far above Wilson", b.percentile >= 0.88 && b.wilson < 0.75, b);
  check("(b) one-per-issuer-month thinning restores coverage ≥ 0.92", b.thinned >= 0.92, { thinned: b.thinned });
}

// ---------------- 5. matched difference: type-I error and power ----------------
function simMatched({ G, p0, delta, sdU, k, seed }) {
  const rows = simBinary({ G, p: p0 + delta, sdU, seed });
  const r = V.rng(seed + 99);
  for (const row of rows) row.controls = Array.from({ length: k }, () => (r() < p0 ? 1 : 0));
  return rows;
}
{
  const R = 300; let rejB = 0, rejT = 0, rejNaive = 0;
  for (let i = 0; i < R; i++) {
    const rows = simMatched({ G: 250, p0: 0.3, delta: 0, sdU: 0.9, k: 5, seed: 5000 + i });
    const m = V.matchedDiffProportion(rows, { B: 400, seed: i });
    if (m.ci[0] > 0 || m.ci[1] < 0) rejB++;
    if (m.p < 0.05) rejT++;
    // naive two-proportion z-test ignoring clustering
    const n1 = rows.length, k1 = rows.reduce((a, x) => a + x.hit, 0), n2 = rows.length * 5, k2 = rows.reduce((a, x) => a + V.sum(x.controls), 0);
    const p1 = k1 / n1, p2 = k2 / n2, pb = (k1 + k2) / (n1 + n2), z = (p1 - p2) / Math.sqrt(pb * (1 - pb) * (1 / n1 + 1 / n2));
    if (Math.abs(z) > 1.96) rejNaive++;
  }
  check("matched diff: bootstrap type-I error ≈ 5% under H0", rejB / R <= 0.085, { rate: rejB / R });
  check("matched diff: clustered-t type-I error ≈ 5% under H0", rejT / R <= 0.085, { rate: rejT / R });
  check("naive pooled z-test over-rejects under clustering (documents the trap)", rejNaive / R > rejT / R + 0.03, { naive: rejNaive / R, clustered: rejT / R });

  // Power at delta = +0.06 vs the analytic prediction using the observed design effect.
  let rej = 0; const deffs = [], ns = [];
  for (let i = 0; i < R; i++) {
    const rows = simMatched({ G: 250, p0: 0.3, delta: 0.06, sdU: 0.9, k: 5, seed: 9000 + i });
    const m = V.matchedDiffProportion(rows, { B: 300, seed: i });
    if (m.p < 0.05 && m.diff > 0) rej++;
    deffs.push(V.clusteredMean(rows, { value: "hit", cluster: "issuer" }).deff); ns.push(rows.length);
  }
  const deff = V.mean(deffs), n = V.mean(ns);
  const pred = V.powerProportionDiff({ p0: 0.3, p1: 0.36, n1: n, n2: 5 * n, deff1: deff, deff2: 1 });
  check("matched diff: empirical power ≈ analytic power (design effect)", Math.abs(rej / R - pred) < 0.1, { empirical: rej / R, predicted: pred, deff, n });
}

// ---------------- 6. power / MDE helpers ----------------
check("mdeMean n=100 sd=1 = 0.2802", near(V.mdeMean({ n: 100, sd: 1 }), 0.2802, 1e-4), { got: V.mdeMean({ n: 100, sd: 1 }) });
check("nForMean inverts mdeMean", V.nForMean({ delta: V.mdeMean({ n: 400, sd: 2, deff: 1.7 }), sd: 2, deff: 1.7 }) === 400);
check("powerMean at the MDE = 0.80", near(V.powerMean({ delta: V.mdeMean({ n: 250, sd: 0.05, deff: 2 }), sd: 0.05, n: 250, deff: 2 }), 0.8, 1e-3));
{
  const mde = V.mdeProportionDiff({ p0: 0.3, n1: 500, n2: 5000 });
  const pw = V.powerProportionDiff({ p0: 0.3, p1: mde.p1, n1: 500, n2: 5000 });
  check("mdeProportionDiff gives power 0.80", near(pw, 0.8, 1e-3), mde);
  const nn = V.nForProportionDiff({ p0: 0.3, p1: 0.35, ratio: 10 });
  check("nForProportionDiff: power(n) ≥ 0.8 > power(n-1)", V.powerProportionDiff({ p0: 0.3, p1: 0.35, n1: nn, n2: 10 * nn }) >= 0.8 && V.powerProportionDiff({ p0: 0.3, p1: 0.35, n1: nn - 1, n2: 10 * (nn - 1) }) < 0.8, { n: nn });
  check("MDE grows with the design effect", V.mdeProportionDiff({ p0: 0.3, n1: 500, deff1: 3 }).delta > V.mdeProportionDiff({ p0: 0.3, n1: 500 }).delta);
}
{ // Monte Carlo: clustered normal means, equal clusters m = 4, ICC 0.25 → deff 1.75; power at the MDE ≈ 0.80
  const G = 150, m = 4, rho = 0.25, deff = 1 + (m - 1) * rho, n = G * m, mde = V.mdeMean({ n, sd: 1, deff });
  let rej = 0; const R = 400, iccs = [];
  for (let k = 0; k < R; k++) {
    const r = V.rng(20000 + k), rows = [];
    for (let g = 0; g < G; g++) { const u = Math.sqrt(rho) * V.normal(r); for (let i = 0; i < m; i++) rows.push({ issuer: g, x: mde + u + Math.sqrt(1 - rho) * V.normal(r) }); }
    const c = V.clusteredMean(rows, { value: "x", cluster: "issuer" });
    if (c.p < 0.05) rej++;
    if (k < 50) iccs.push(V.icc(rows, { value: "x", cluster: "issuer" }));
  }
  check("clustered mean test: power at mdeMean(deff) ≈ 0.80", Math.abs(rej / R - 0.8) < 0.06, { power: rej / R, mde, deff });
  check("icc() recovers ICC 0.25", near(V.mean(iccs), 0.25, 0.04), { mean: V.mean(iccs) });
  check("designEffect equal clusters = 1+(m-1)ρ", near(V.designEffect({ sizes: Array(10).fill(4), icc: 0.25 }), 1.75, 1e-12));
}

// ---------------- 7. clustering ----------------
{
  const rows = simBinary({ G: 300, p: 0.3, sdU: 0.6, sdInsider: 0.8, seed: 77 });
  const cs = V.clusterSummary(rows, { value: "hit", issuer: "issuer", insider: "insider" });
  check("two-way SE ≥ each one-way SE (approximately)", cs.twoWay.se >= 0.97 * Math.max(cs.issuer.se, cs.insider.se), { iid: cs.iid.se, issuer: cs.issuer.se, insider: cs.insider.se, twoWay: cs.twoWay.se });
  const same = V.twoWayClusteredMean(rows, { value: "hit", cluster1: "issuer", cluster2: "issuer" });
  check("two-way with identical clusterings = one-way", near(same.se, cs.issuer.se, 1e-12));
  const unique = V.twoWayClusteredMean(rows.map((r, i) => ({ ...r, id: i })), { value: "hit", cluster1: "issuer", cluster2: "id" });
  check("two-way with a row-unique second clustering = one-way issuer", near(unique.se, cs.issuer.se, 1e-12));
  const nul = V.clusteredMean(rows.map((r) => ({ ...r, issuer: null })), { value: "hit", cluster: "issuer" });
  check("null cluster keys behave as iid (deff ≈ 1)", near(nul.deff, rows.length / (rows.length - 1), 1e-9) || near(nul.deff, 1, 0.01), { deff: nul.deff });
  const conc = V.concentration([{ issuer: "a", x: 5 }, { issuer: "a", x: 5 }, { issuer: "b", x: -1 }, { issuer: "c", x: 1 }], { value: "x", cluster: "issuer", k: 1 });
  check("concentration: top-1 contribution and ex-top mean", near(conc.topKContributionShare, 10 / 10, 1e-12) && near(conc.meanExTopK, 0, 1e-12), conc);
}

// ---------------- 8. one event per issuer per month ----------------
{
  const rows = simBinary({ G: 120, p: 0.4, sdU: 0.5, seed: 3 });
  const a = V.onePerIssuerMonth(rows, { issuer: "issuer", date: "date", pick: "first" });
  const keys = a.map((r) => `${r.issuer}|${r.date.slice(0, 7)}`);
  check("onePerIssuerMonth: unique (issuer, month)", new Set(keys).size === a.length && a.length === new Set(rows.map((r) => `${r.issuer}|${r.date.slice(0, 7)}`)).size, { kept: a.length, all: rows.length });
  const firstOk = a.every((r) => rows.filter((x) => x.issuer === r.issuer && x.date.slice(0, 7) === r.date.slice(0, 7)).every((x) => x.date >= r.date));
  check("onePerIssuerMonth: 'first' keeps the earliest date", firstOk);
  const r1 = V.onePerIssuerMonth(rows, { pick: "random", seed: 5 }), r2 = V.onePerIssuerMonth(rows, { pick: "random", seed: 5 });
  check("onePerIssuerMonth: random pick is deterministic per seed", JSON.stringify(r1) === JSON.stringify(r2));
  const th = V.thinnedStat(rows, (s) => V.mean(s.map((r) => r.hit)), { reps: 50 });
  check("thinnedStat returns a distribution", th.reps === 50 && th.lo <= th.hi && th.nKept === a.length, th);
}

// ---------------- 9. month stability ----------------
{
  const rows = [];
  const means = { "2026-01": 0.02, "2026-02": 0.01, "2026-03": -0.005, "2026-04": 0.015, "2026-05": 0.02, "2026-06": 0.01 };
  for (const [m, mu] of Object.entries(means)) for (let i = 0; i < 20; i++) rows.push({ issuer: `${m}-${i % 7}`, date: `${m}-15`, x: mu + (i % 2 ? 0.01 : -0.01) });
  const ms = V.monthStability(rows, { value: "x", date: "date" });
  check("monthStability: 5 of 6 months positive", ms.M === 6 && ms.monthsBeating === 5, { M: ms.M, beating: ms.monthsBeating, signP: ms.signTestP });
  check("monthStability: worst month = 2026-03", ms.worst.month === "2026-03");
  check("monthStability: Fama-MacBeth t", near(ms.fmT, V.mean(Object.values(means)) / (V.sd(Object.values(means)) / Math.sqrt(6)), 1e-9), { fmT: ms.fmT });
}

// ---------------- 10. profit factor and drawdown ----------------
{
  const xs = [0.1, -0.05, -0.1, 0.2];
  const pf = V.profitFactor(xs), dd = V.drawdown(xs, { dates: ["d1", "d2", "d3", "d4"] });
  check("profit factor = 0.3/0.15 = 2", near(pf.pf, 2, 1e-12), pf);
  check("max drawdown = 0.9405/1.1 - 1", near(dd.maxDrawdown, 0.9405 / 1.1 - 1, 1e-12) && dd.peakAt === "d1" && dd.troughAt === "d3" && dd.recoveredAt === "d4", { maxDD: dd.maxDrawdown, peak: dd.peakAt, trough: dd.troughAt, rec: dd.recoveredAt });
  check("total return", near(dd.totalReturn, 1.1 * 0.95 * 0.9 * 1.2 - 1, 1e-12));
  const add = V.drawdown(xs, { compound: false });
  check("additive drawdown = -0.15 points", near(add.maxDrawdown, -0.15, 1e-12));
  const te = V.tradeEquity([{ x: 0.1, exitDate: "2026-01-05" }, { x: -0.2, exitDate: "2026-01-03" }, { x: 0.05, exitDate: "2026-02-01" }], { fraction: 0.5 });
  check("tradeEquity orders by exit date", near(te.totalReturn, 0.9 * 1.05 * 1.025 - 1, 1e-12) && te.months.length === 2, { total: te.totalReturn, months: te.months });
  const ts = V.tradeStats([0.02, -0.01, 0.03, -0.02, 0.01]);
  check("tradeStats hit rate and payoff", near(ts.hitRate, 0.6, 1e-12) && near(ts.payoff, 0.02 / 0.015, 1e-12), ts);
}

// ---------------- 11. one-call summaries run end-to-end ----------------
{
  const rows = simBinary({ G: 200, p: 0.35, sdU: 0.7, sdInsider: 0.5, seed: 8 }).map((r, i) => ({ ...r, x: (r.hit ? 0.03 : -0.015) + ((i % 7) - 3) * 0.001 }));
  const es = V.eventStats(rows, { value: "x", B: 300, thinReps: 20 });
  check("eventStats: fields present", es.n === rows.length && es.ci[0] <= es.mean && es.mean <= es.ci[1] && es.months?.M > 0 && es.onePerIssuerMonth?.reps === 20, { n: es.n, mean: es.mean, ci: es.ci, deffIssuer: es.deffIssuer, deffInsider: es.deffInsider, mde80: es.mde80 });
  const hs = V.hitRateStats(rows, { hit: "hit", B: 300, thinReps: 20, baseline: 0.3 });
  check("hitRateStats: fields present", hs.n === rows.length && hs.issuerBootstrap[0] <= hs.rate && hs.rate <= hs.issuerBootstrap[1] && hs.months?.M > 0, { rate: hs.rate, wilson: hs.wilson, boot: hs.issuerBootstrap, deff: hs.deffIssuer });
  const bb = V.blockBootstrap(rows, { stat: (s) => V.median(s.map((r) => r.x)), B: 200 });
  check("blockBootstrap generic statistic (median)", bb.lo <= bb.estimate && bb.estimate <= bb.hi && bb.failed === 0, bb);
  const a = rows.filter((_, i) => i % 2), b = rows.filter((_, i) => !(i % 2));
  const td = V.twoSampleDiff(a, b, { value: "x", B: 300 });
  check("twoSampleDiff joint resampling runs; CI contains ~0 for random split", td.ci[0] < 0 && td.ci[1] > 0, td);
}

const failed = checks.filter((c) => !c.ok);
const out = { ranAt: new Date().toISOString(), seconds: (Date.now() - t0) / 1000, total: checks.length, passed: checks.length - failed.length, failed: failed.map((c) => c.name), checks };
fs.writeFileSync(path.join(OUT, "validate-test-copy.json"), JSON.stringify(out, null, 1));
console.log(`\n${out.passed}/${out.total} passed in ${out.seconds}s → ${path.join(OUT, "validate-test.json")}`);
process.exit(failed.length ? 1 : 0);
