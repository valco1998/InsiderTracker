// deep4/audit/common.mjs — shared helpers for the deep-4 adversarial auditor (agent id "audit4"; lib4 folder "audit").
// Research only: cache-only, no network, no Alpaca / SEC / Mongo / server / git writes. Writes ONLY under
//   server/scripts/research/deep4/audit/  and  server/.cache/research/deep4/audit/.
// Phase A scripts refuse to run with DEEP4_EXPOSED set (the exposed period is touched only by the single Phase B run).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import * as L4 from "../lib4.mjs";
import * as V from "../../deep3/dataquality/validate.mjs";
import { loadPanel, loadControls } from "../panel/data.mjs";

export { L4, V };
export const AGENT = "audit"; // lib4 folder name (agentFrozenFile("audit") = .cache/research/deep4/audit/frozen.json)
export const AGENT_ID = "audit4"; // registry agent id / test-id prefix
export const OUT = path.join(L4.DEEP4, AGENT);
export const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));
fs.mkdirSync(OUT, { recursive: true });

export function phaseA() {
  for (const k of ["DEEP4_EXPOSED", "DEEP2_HOLDOUT", "DEEP3_HOLDOUT"]) if (process.env[k] != null && process.env[k] !== "" && process.env[k] !== "0") throw new Error(`audit phase A: refusing to run with ${k} set`);
  if (L4.exposedUnlocked()) throw new Error("audit phase A: exposed segment unlocked — refusing");
}

// ---------------- io ----------------
export const outPath = (name) => path.join(OUT, name);
export function writeOut(name, data, pretty = true) { const f = outPath(name); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof data === "string" ? data : pretty ? JSON.stringify(data, null, 1) : JSON.stringify(data)); return f; }
export const readOut = (name) => JSON.parse(fs.readFileSync(outPath(name), "utf8"));
export const existsOut = (name) => fs.existsSync(outPath(name));
export const sha256File = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
export const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
export function toCsv(rows, cols = null) {
  const cs = cols || [...rows.reduce((s, r) => { for (const k of Object.keys(r)) s.add(k); return s; }, new Set())];
  const esc = (v) => (v == null ? "" : typeof v === "number" ? (Number.isFinite(v) ? String(Number.isInteger(v) ? v : Math.round(v * 1e6) / 1e6) : "") : typeof v === "boolean" ? (v ? "1" : "0") : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [cs.join(","), ...rows.map((r) => cs.map((c) => esc(r[c])).join(","))].join("\n");
}
export function checkpoint(step, info = {}) {
  const f = outPath("progress.json");
  let p = { agent: AGENT_ID, steps: [] }; try { p = JSON.parse(fs.readFileSync(f, "utf8")); } catch { /* new */ }
  p.updatedAt = new Date().toISOString();
  p.done = p.done || [];
  p.steps = (p.steps || []).filter((s) => s.step !== step); p.steps.push({ step, status: "done", at: p.updatedAt, ...info });
  fs.writeFileSync(f, JSON.stringify(p, null, 1));
}

// ---------------- numerics ----------------
export const fin = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);
export const mean = (xs) => { const v = xs.filter((x) => fin(x) != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
export const median = (xs) => { const v = xs.filter((x) => fin(x) != null).sort((a, b) => a - b); if (!v.length) return null; const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
export const sd = (xs) => { const v = xs.filter((x) => fin(x) != null); if (v.length < 2) return null; const m = mean(v); return Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / (v.length - 1)); };
export const quantile = (xs, p) => { const s = xs.filter((x) => fin(x) != null).sort((a, b) => a - b); if (!s.length) return null; const i = p * (s.length - 1), lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
export const r4 = (x) => (fin(x) == null ? null : Math.round(x * 1e4) / 1e4);
export const r6 = (x) => (fin(x) == null ? null : Math.round(x * 1e6) / 1e6);
export const group = (arr, f) => { const m = new Map(); for (const x of arr) { const k = f(x); (m.get(k) || m.set(k, []).get(k)).push(x); } return m; };
export const countBy = (arr, f) => arr.reduce((m, x) => { const k = String(f(x)); m[k] = (m[k] || 0) + 1; return m; }, {});
export function rng(seed = 7) { let s = seed >>> 0 || 7; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
export function spearman(a, b) {
  const n = a.length; if (n < 5) return null;
  const rank = (xs) => { const idx = xs.map((x, i) => [x, i]).sort((p, q) => p[0] - q[0]); const r = new Array(n); let i = 0; while (i < n) { let j = i; while (j + 1 < n && idx[j + 1][0] === idx[i][0]) j++; for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2; i = j + 1; } return r; };
  return pearson(rank(a), rank(b));
}
export function pearson(a, b) {
  const n = a.length; if (n < 3) return null; let ma = 0, mb = 0; for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; } ma /= n; mb /= n;
  let s = 0, da = 0, db = 0; for (let i = 0; i < n; i++) { s += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; } return da > 0 && db > 0 ? s / Math.sqrt(da * db) : null;
}
// issuer-clustered mean (lib4.companyStats) + month-level Fama-MacBeth t (month means; df = months-1)
export function cstats(items) { // items: [{ issuer, x, month }]
  const it = items.filter((r) => fin(r.x) != null);
  if (!it.length) return { n: 0 };
  const cs = L4.companyStats(it.map((r) => ({ issuer: r.issuer, x: r.x })));
  const byM = group(it, (r) => r.month); const mm = [...byM.entries()].sort().map(([m, xs]) => ({ month: m, n: xs.length, mean: r6(mean(xs.map((r) => r.x))) }));
  const ms = mm.map((m) => m.mean); const fmT = mm.length >= 2 && sd(ms) > 0 ? mean(ms) / (sd(ms) / Math.sqrt(mm.length)) : null;
  return { ...cs, months: mm, monthsPositive: mm.filter((m) => m.mean > 0).length, fmT: r4(fmT) };
}

// ---------------- registry (lib4; ids "audit4.") ----------------
export function register(h) {
  if (!String(h.id).startsWith("audit4.")) throw new Error(`register: id must start with audit4. (${h.id})`);
  return L4.registerHypothesis({ agent: AGENT_ID, ...h });
}
export const record = (id, result) => L4.recordResult(id, AGENT_ID, result);
export function recordedIds() { return new Set(readJsonl(path.join(L4.DEEP4, "registry-results.jsonl")).filter((r) => r.agent === AGENT_ID).map((r) => r.id)); }
export function recordOnce(id, result) { if (recordedIds().has(id)) return false; record(id, result); return true; }

// ---------------- data (lib4-guarded; design + confirm in phase A) ----------------
export const loadP = (segments = ["design", "confirm"]) => loadPanel({ agent: AGENT, segments });
export const loadC = (segments = ["design", "confirm"]) => loadControls({ agent: AGENT, segments });
export const isPrimaryPurchase = (r) => r.primary === 1 && r.isPrimary === 1;
export const inUniverse = (r) => r.primary === 1 && r.isPrimary === 1 && r.featOk === 1;
