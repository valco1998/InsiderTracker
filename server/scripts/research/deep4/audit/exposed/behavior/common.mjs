// deep4/behavior/common.mjs — shared helpers for agent "behavior" (deep study 4, stage S2a).
// Research only: cache-only, no network, no Alpaca / SEC / Mongo, no server, no git. Writes only to
//   server/scripts/research/deep4/behavior/ (scripts) and server/.cache/research/deep4/behavior/ (outputs).
// Data are loaded ONLY through ../panel/data.mjs (lib4 guards). Design scripts always pass segments: ["design"] so that
// re-running them after the freeze can never mix confirmation rows into design results.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import * as L4 from "../../../lib4.mjs";
import * as V from "../../../../deep3/dataquality/validate.mjs";
import { loadPanel, loadControls } from "../panel/data.mjs";

export { L4, V, loadPanel, loadControls };
export const AGENT = "behavior";
export const OUT = path.join(L4.DEEP4, "audit", "exposed", AGENT); // AUDIT COPY (T2)
export const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));
fs.mkdirSync(OUT, { recursive: true });

// ---------------- io ----------------
export const outPath = (name) => path.join(OUT, name);
export function writeJson(name, data, pretty = true) { const f = outPath(name); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, pretty ? JSON.stringify(data, null, 1) : JSON.stringify(data)); return f; }
export const readJson = (name) => JSON.parse(fs.readFileSync(outPath(name), "utf8"));
export const exists = (name) => fs.existsSync(outPath(name));
export function writeCsv(name, rows, cols = null) {
  const cs = cols || [...rows.reduce((s, r) => { for (const k of Object.keys(r)) s.add(k); return s; }, new Set())];
  const esc = (v) => (v == null ? "" : typeof v === "number" ? (Number.isFinite(v) ? String(Number.isInteger(v) ? v : Math.round(v * 1e6) / 1e6) : "") : typeof v === "boolean" ? (v ? "1" : "0") : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const f = outPath(name); fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, [cs.join(","), ...rows.map((r) => cs.map((c) => esc(r[c])).join(","))].join("\n"));
  return f;
}
export function checkpoint(step, info = {}) {
  const f = outPath("progress.json");
  let p = { agent: AGENT, steps: [] }; try { p = JSON.parse(fs.readFileSync(f, "utf8")); } catch { /* new */ }
  p.updatedAt = new Date().toISOString();
  p.steps = (p.steps || []).filter((s) => s.step !== step); p.steps.push({ step, status: "done", at: p.updatedAt, ...info });
  fs.writeFileSync(f, JSON.stringify(p, null, 1));
}
export const sha256File = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");

// ---------------- small numerics ----------------
export const fin = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);
export const num = (xs) => xs.filter((x) => typeof x === "number" && Number.isFinite(x));
export const mean = (xs) => { const v = num(xs); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
export const median = (xs) => { const v = num(xs).sort((a, b) => a - b); if (!v.length) return null; const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
export const quantile = (xs, p) => { const s = num(xs).sort((a, b) => a - b); if (!s.length) return null; const i = p * (s.length - 1), lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
export const r4 = (x) => (fin(x) == null ? null : Math.round(x * 1e4) / 1e4);
export const r6 = (x) => (fin(x) == null ? null : Math.abs(x) >= 1 ? Math.round(x * 1e6) / 1e6 : Number(x.toPrecision(7)));
export const pct = (x, d = 2) => (fin(x) == null ? "—" : `${(x * 100).toFixed(d)}`);
export const group = (arr, f) => { const m = new Map(); for (const x of arr) { const k = f(x); (m.get(k) || m.set(k, []).get(k)).push(x); } return m; };
export function rng(seed = 7) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
export function shuffleInPlace(a, rnd) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
export function spearman(a, b) {
  const n = a.length; if (n < 5) return null;
  const rank = (xs) => { const idx = xs.map((x, i) => [x, i]).sort((p, q) => p[0] - q[0]); const r = new Array(n); let i = 0; while (i < n) { let j = i; while (j + 1 < n && idx[j + 1][0] === idx[i][0]) j++; for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2; i = j + 1; } return r; };
  const ra = rank(a), rb = rank(b); return pearson(ra, rb);
}
export function pearson(a, b) {
  const n = a.length; if (n < 3) return null;
  let ma = 0, mb = 0; for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; } ma /= n; mb /= n;
  let num_ = 0, da = 0, db = 0; for (let i = 0; i < n; i++) { num_ += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return da > 0 && db > 0 ? num_ / Math.sqrt(da * db) : null;
}

// ---------------- universes ----------------
// Primary purchase = open-market (class v2) AND valued AND priced, one row per economic event (isPrimary = first-accepted
// filing of its person|issuer|entry-open group). This is the deep-4 primary universe (panel findings).
export const isPrimaryPurchase = (r) => r.primary === 1 && r.isPrimary === 1;
export function loadDesign({ controls = false } = {}) {
  const P = loadPanel({ agent: AGENT, segments: ["design"] });
  for (const r of P.rows) if (r.segment !== "design") throw new Error(`design loader returned a ${r.segment} row`);
  const C = controls ? loadControls({ agent: AGENT, segments: ["design"] }) : null;
  return { P, C, rows: P.rows };
}

// ---------------- statistics wrappers ----------------
// Issuer-clustered summary of per-event values x (lib4.companyStats = deep-2 convention) + validate.eventStats extras.
export function stats(rows, { value = (r) => r.x, issuer = (r) => r.cik, insider = (r) => r.person, date = (r) => r.entryDate, B = 1000 } = {}) {
  const rs = rows.map((r) => ({ issuer: issuer(r), x: value(r), insider: insider(r), date: date(r) })).filter((r) => fin(r.x) != null);
  if (!rs.length) return { n: 0 };
  const cs = L4.companyStats(rs);
  const cm = V.clusteredMean(rs, { value: "x", cluster: "issuer" });
  const tw = V.twoWayClusteredMean(rs, { value: "x", cluster1: "issuer", cluster2: "insider" });
  const ms = V.monthStability(rs, { value: "x", date: "date", issuer: "issuer" });
  return { ...cs, tT: cm.t == null ? null : r4(cm.t), pT: cm.p == null ? null : r4(cm.p), df: cm.df, tTwoWay: tw.t == null ? null : r4(tw.t), pTwoWay: tw.p == null ? null : r4(tw.p),
    persons: new Set(rs.map((r) => r.insider)).size, months: ms.M, monthsPositive: ms.months.filter((m) => m.mean > 0).length, fmT: ms.fmT == null ? null : r4(ms.fmT),
    monthMeans: Object.fromEntries(ms.months.map((m) => [m.month, r4(m.mean)])) };
}
// hit-rate summary (0/1 values)
export function hitStats(rows, { value, issuer = (r) => r.cik }) {
  const rs = rows.map((r) => ({ issuer: issuer(r), x: value(r) })).filter((r) => fin(r.x) != null);
  if (!rs.length) return { n: 0 };
  const cm = V.clusteredMean(rs, { value: "x", cluster: "issuer" });
  return { n: rs.length, issuers: new Set(rs.map((r) => r.issuer)).size, rate: r4(cm.mean), se: r4(cm.se) };
}
// event minus matched-control difference with issuer clustering (controls = array of control values per event)
export function vsControls(rows, { value, ctlValues, issuer = (r) => r.cik, B = 1000 }) {
  const rs = rows.map((r) => ({ k: issuer(r), x: value(r), controls: ctlValues(r) }));
  const m = V.matchedDiff(rs, { value: "x", controls: "controls", cluster: "k", B, seed: 7 });
  return m.n ? { n: m.n, clusters: m.clusters, eventMean: r6(m.eventMean), controlMean: r6(m.controlMean), diff: r6(m.diff), ci: m.ci.map(r6), t: r4(m.t), p: r4(m.p) } : { n: 0 };
}
// selected vs complement (joint issuer bootstrap)
export function vsComplement(sel, rest, { value, issuer = (r) => r.cik, B = 1000 }) {
  const a = sel.map((r) => ({ issuer: issuer(r), x: value(r) })), b = rest.map((r) => ({ issuer: issuer(r), x: value(r) }));
  const d = V.twoSampleDiff(a, b, { value: "x", cluster: "issuer", B, seed: 7 });
  return d.diff == null ? { nA: d.nA, nB: d.nB } : { nA: d.nA, nB: d.nB, meanA: r6(d.meanA), meanB: r6(d.meanB), diff: r6(d.diff), ci: d.ci.map(r6), z: r4(d.z), p: r4(d.p) };
}
export const bh = V.bh;
