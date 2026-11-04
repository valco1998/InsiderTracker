// deep2/audit/auditLib.mjs — small, self-contained helpers for the statistical auditor (agent "audit").
// Research only, read-only inputs, no network. Writes only under .cache/research/deep2/audit/.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DEEP2 } from "../lib2.mjs";

export const AGENT = "audit";
export const OUT = path.join(DEEP2, "audit");
fs.mkdirSync(OUT, { recursive: true });
export const writeOut = (name, data) => { const f = path.join(OUT, name); fs.writeFileSync(f, typeof data === "string" ? data : JSON.stringify(data, null, 1)); return f; };
export const readOut = (name) => JSON.parse(fs.readFileSync(path.join(OUT, name), "utf8"));
export const sha256File = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
export const FROZEN_SHA = "4b1ac11d82a7e0380dee29d396e5c9abb79977911aa5be2c250d33b2422a1a0f";
export const r4 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1e4) / 1e4);
export const r6 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1e6) / 1e6);
export const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
export const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export const sd = (xs) => { if (xs.length < 2) return null; const m = mean(xs); return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1)); };
export const pct = (v, d = 2) => (v == null || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(d)}%`);

// Minimal RFC-4180 CSV parser (quoted fields, doubled quotes). Returns array of objects keyed by the header.
export function readCsv(file) {
  const txt = fs.readFileSync(file, "utf8");
  const rows = []; let row = [], field = "", q = false;
  for (let i = 0; i < txt.length; i++) {
    const ch = txt[i];
    if (q) { if (ch === '"') { if (txt[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += ch; continue; }
    if (ch === '"') q = true; else if (ch === ",") { row.push(field); field = ""; } else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; } else if (ch !== "\r") field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift();
  return rows.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, k) => [h, r[k] ?? ""])));
}
export const num = (v) => (v === "" || v == null ? null : Number(v));

// ---- distributions ----
function lgamma(x) { const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5]; let y = x, t = x + 5.5; t -= (x + 0.5) * Math.log(t); let s = 1.000000000190015; for (const k of c) s += k / ++y; return -t + Math.log((2.5066282746310005 * s) / x); }
function betacf(a, b, x) { const MAXIT = 300, EPS = 3e-14, FPMIN = 1e-300; let qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - (qab * x) / qap; if (Math.abs(d) < FPMIN) d = FPMIN; d = 1 / d; let h = d;
  for (let m = 1; m <= MAXIT; m++) { const m2 = 2 * m; let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2)); d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN; c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN; d = 1 / d; h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2)); d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN; c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN; d = 1 / d; const del = d * c; h *= del; if (Math.abs(del - 1) < EPS) break; }
  return h; }
export function ibeta(x, a, b) { if (x <= 0) return 0; if (x >= 1) return 1; const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x)); return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b; }
// Two-sided Student-t p-value with df degrees of freedom.
export const pT = (t, df) => (t == null || !Number.isFinite(t) || !(df > 0) ? null : ibeta(df / (df + t * t), df / 2, 0.5));
// Two-sided normal p-value.
export function pNorm(t) { if (t == null) return null; return pT(t, 1e7); }
export function normInv(p) { // Acklam's approximation
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239], b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1], c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783], d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425; let q, r;
  if (p < pl) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p <= 1 - pl) { q = p - 0.5; r = q * q; return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1); }
  q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}
// Exact two-sided binomial (sign) test p-value for k successes in n trials at p = 0.5.
export function binom2(k, n) {
  if (!n) return null; const lc = (n2, k2) => lgamma(n2 + 1) - lgamma(k2 + 1) - lgamma(n2 - k2 + 1);
  const pk = (j) => Math.exp(lc(n, j) - n * Math.LN2); const p0 = pk(k); let s = 0;
  for (let j = 0; j <= n; j++) { const pj = pk(j); if (pj <= p0 * (1 + 1e-9)) s += pj; }
  return Math.min(1, s);
}
// Issuer-clustered t (CR1, same formula as lib.mjs clusteredT) — reimplemented independently.
export function clusterT(rows) {
  const n = rows.length; if (n < 5) return { t: null, G: null };
  const m = mean(rows.map((r) => r.x)); const g = new Map();
  for (const r of rows) g.set(r.issuer, (g.get(r.issuer) || 0) + (r.x - m));
  const G = g.size; if (G < 5) return { t: null, G };
  const v = ([...g.values()].reduce((a, s) => a + s * s, 0) / (n * n)) * (G / (G - 1));
  return { t: v > 0 ? m / Math.sqrt(v) : null, G, se: Math.sqrt(v) };
}
// Benjamini–Hochberg q-values (independent reimplementation).
export function bh(ps) {
  const idx = ps.map((p, i) => [p, i]).filter(([p]) => p != null && Number.isFinite(p)).sort((a, b) => a[0] - b[0]);
  const m = idx.length, q = new Array(ps.length).fill(null); let run = 1;
  for (let k = m - 1; k >= 0; k--) { run = Math.min(run, (idx[k][0] * m) / (k + 1)); q[idx[k][1]] = run; }
  return q;
}
export const groupBy = (arr, f) => { const m = new Map(); for (const x of arr) { const k = f(x); (m.get(k) || m.set(k, []).get(k)).push(x); } return m; };
export const countBy = (arr, f) => arr.reduce((m, x) => { const k = String(f(x)); m[k] = (m[k] || 0) + 1; return m; }, {});
