// deep4/learn/evalLib.mjs — walk-forward evaluation statistics: within-month IC / AUC, issuer-block bootstrap (paired and
// two-sample), executable top-quintile tests, calibration. Pure functions; no I/O.
import * as Mo from "./models.mjs";

const mean = (xs) => { let s = 0; for (const x of xs) s += x; return xs.length ? s / xs.length : null; };
export function normP(z) { // two-sided normal p
  if (z == null || !Number.isFinite(z)) return null;
  const x = Math.abs(z) / Math.SQRT2, t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return Math.max(0, Math.min(1, 1 - erf));
}
export function rng(seed = 7) { let s = seed >>> 0 || 7; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
const sdOf = (xs) => { const m = mean(xs); return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, xs.length - 1)); };

// items: [{ month, p, y }] -> { value (n-weighted mean of within-month metric), months: [{ month, n, value }] }
export function withinMonth(items, kind) {
  const by = new Map(); for (const it of items) (by.get(it.month) || by.set(it.month, []).get(it.month)).push(it);
  const months = []; let sw = 0, s = 0;
  for (const [m, xs] of [...by.entries()].sort()) {
    const p = xs.map((x) => x.p), y = xs.map((x) => x.y);
    const v = kind === "auc" ? Mo.auc(p, y) : Mo.spearman(p, y);
    months.push({ month: m, n: xs.length, value: v });
    if (v != null && Number.isFinite(v)) { s += v * xs.length; sw += xs.length; }
  }
  return { value: sw ? s / sw : null, months };
}
// Group items by cluster for resampling.
function clusters(items, key = "issuer") { const g = new Map(); for (const it of items) (g.get(it[key]) || g.set(it[key], []).get(it[key])).push(it); return [...g.values()]; }

// Issuer-block bootstrap of the within-month skill. null0 = value under H0 (0 for IC, 0.5 for AUC).
export function bootSkill(items, kind, { B = 1000, seed = 7, null0 = kind === "auc" ? 0.5 : 0, key = "issuer" } = {}) {
  const est = withinMonth(items, kind); if (est.value == null) return { n: items.length, estimate: null };
  const G = clusters(items, key), rnd = rng(seed), draws = [];
  for (let b = 0; b < B; b++) { const rep = []; for (let j = 0; j < G.length; j++) for (const it of G[(rnd() * G.length) | 0]) rep.push(it); const v = withinMonth(rep, kind).value; if (v != null) draws.push(v); }
  draws.sort((a, b) => a - b);
  const se = sdOf(draws), z = se > 0 ? (est.value - null0) / se : null;
  return { n: items.length, clusters: G.length, estimate: est.value, se, z, p: normP(z), ci95: [draws[Math.floor(0.025 * draws.length)], draws[Math.floor(0.975 * draws.length)]], months: est.months, B: draws.length };
}
// Paired difference A - B on the same events (items joined by key; resampling issuers once for both).
export function bootSkillDiff(itemsA, itemsB, kind, { B = 1000, seed = 7, key = "issuer" } = {}) {
  const mb = new Map(itemsB.map((it) => [it.key, it]));
  const pairs = itemsA.filter((it) => mb.has(it.key)).map((it) => ({ key: it.key, issuer: it[key], month: it.month, a: it, b: mb.get(it.key) }));
  const val = (ps) => { const a = withinMonth(ps.map((x) => x.a), kind).value, b = withinMonth(ps.map((x) => x.b), kind).value; return a == null || b == null ? null : { a, b, d: a - b }; };
  const est = val(pairs); if (!est) return { n: pairs.length, estimate: null };
  const G = clusters(pairs, "issuer"), rnd = rng(seed), draws = [];
  for (let b = 0; b < B; b++) { const rep = []; for (let j = 0; j < G.length; j++) for (const it of G[(rnd() * G.length) | 0]) rep.push(it); const v = val(rep); if (v) draws.push(v.d); }
  draws.sort((a, b) => a - b);
  const se = sdOf(draws), z = se > 0 ? est.d / se : null;
  return { n: pairs.length, clusters: G.length, a: est.a, b: est.b, estimate: est.d, se, z, p: normP(z), ci95: [draws[Math.floor(0.025 * draws.length)], draws[Math.floor(0.975 * draws.length)]], B: draws.length };
}
// Two independent samples (e.g. events vs controls): difference of skills, independent bootstraps.
export function bootSkillTwoSample(itemsA, itemsB, kind, { B = 1000, seed = 7 } = {}) {
  const a = bootSkill(itemsA, kind, { B, seed }), b = bootSkill(itemsB, kind, { B, seed: seed + 1 });
  if (a.estimate == null || b.estimate == null) return { a, b, estimate: null };
  const se = Math.sqrt(a.se ** 2 + b.se ** 2), d = a.estimate - b.estimate, z = se > 0 ? d / se : null;
  return { a: a.estimate, aSe: a.se, nA: a.n, b: b.estimate, bSe: b.se, nB: b.n, estimate: d, se, z, p: normP(z) };
}
// Executable selection vs the same-month universe: d_i = y_i - mean(y | month) for selected i. Joint issuer resampling
// (month means recomputed in each draw). items: [{ issuer, month, sel, y }]
export function bootTopBase(items, { B = 1000, seed = 7 } = {}) {
  const val = (xs) => {
    const mm = new Map(); for (const it of xs) { const a = mm.get(it.month) || mm.set(it.month, [0, 0]).get(it.month); a[0] += it.y; a[1]++; }
    let s = 0, n = 0, sy = 0; for (const it of xs) if (it.sel) { const a = mm.get(it.month); s += it.y - a[0] / a[1]; sy += it.y; n++; }
    return n ? { d: s / n, sel: sy / n, n } : null;
  };
  const est = val(items); if (!est) return { n: 0, estimate: null };
  const G = clusters(items, "issuer"), rnd = rng(seed), draws = [];
  for (let b = 0; b < B; b++) { const rep = []; for (let j = 0; j < G.length; j++) for (const it of G[(rnd() * G.length) | 0]) rep.push(it); const v = val(rep); if (v) draws.push(v.d); }
  draws.sort((a, b) => a - b);
  const se = sdOf(draws), z = se > 0 ? est.d / se : null;
  return { nSelected: est.n, nAll: items.length, selectedMean: est.sel, allMean: mean(items.map((x) => x.y)), estimate: est.d, se, z, p: normP(z), ci95: [draws[Math.floor(0.025 * draws.length)], draws[Math.floor(0.975 * draws.length)]] };
}
// Mean of selected values with an issuer bootstrap (the 'top.net' test).
export function bootMean(items, { B = 1000, seed = 7 } = {}) {
  if (!items.length) return { n: 0, estimate: null };
  const est = mean(items.map((x) => x.y)), G = clusters(items, "issuer"), rnd = rng(seed), draws = [];
  for (let b = 0; b < B; b++) { let s = 0, n = 0; for (let j = 0; j < G.length; j++) for (const it of G[(rnd() * G.length) | 0]) { s += it.y; n++; } if (n) draws.push(s / n); }
  draws.sort((a, b) => a - b);
  const se = sdOf(draws), z = se > 0 ? est / se : null;
  return { n: items.length, clusters: G.length, estimate: est, se, z, p: normP(z), ci95: [draws[Math.floor(0.025 * draws.length)], draws[Math.floor(0.975 * draws.length)]] };
}
// Per-month descriptive table for one model run (events only). recs: [{ key, month, issuer, p, y, sel, xs30, hit30, ... }]
export function monthTable(recs, kind, { baseRateByMonth = null } = {}) {
  const by = new Map(); for (const r of recs) (by.get(r.month) || by.set(r.month, []).get(r.month)).push(r);
  const out = [];
  for (const [m, xs] of [...by.entries()].sort()) {
    const p = xs.map((x) => x.p), y = xs.map((x) => x.y);
    const sorted = [...xs].sort((a, b) => b.p - a.p), k = Math.max(1, Math.round(xs.length / 5));
    const top = sorted.slice(0, k), rest = sorted.slice(k), sel = xs.filter((x) => x.sel);
    const avg = (arr, f) => { const v = arr.map(f).filter((z) => z != null && Number.isFinite(z)); return v.length ? mean(v) : null; };
    const row = { month: m, n: xs.length, issuers: new Set(xs.map((x) => x.issuer)).size, meanPred: mean(p), meanY: mean(y) };
    if (kind === "auc") {
      row.auc = Mo.auc(p, y); row.brier = Mo.brier(p, y);
      const br = baseRateByMonth?.get(m); if (br != null) { const ref = mean(y.map((v) => (br - v) ** 2)); row.brierRef = ref; row.bss = ref > 0 ? 1 - row.brier / ref : null; }
      row.calInLarge = mean(p) - mean(y); row.calSlope = Mo.olsLine(p, y).slope;
    } else { row.ic = Mo.spearman(p, y); row.calSlope = Mo.olsLine(p, y).slope; }
    Object.assign(row, {
      topN: top.length, topXs30: avg(top, (x) => x.xs30), restXs30: avg(rest, (x) => x.xs30), topHit30: avg(top, (x) => x.hit30), restHit30: avg(rest, (x) => x.hit30),
      topY: avg(top, (x) => x.y), restY: avg(rest, (x) => x.y),
      selN: sel.length, selXs30: avg(sel, (x) => x.xs30), selHit30: avg(sel, (x) => x.hit30), allXs30: avg(xs, (x) => x.xs30), allHit30: avg(xs, (x) => x.hit30),
    });
    out.push(row);
  }
  return out;
}
export { mean };
