// deep4/learn/common.mjs — shared helpers for agent "learn" (deep study 4, stage S2b).
// Research only: cache-only, no network, no Mongo/server/git. Writes only to scripts/research/deep4/learn and
// .cache/research/deep4/learn. Panel data is loaded ONLY through panel/data.mjs (lib4-guarded).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import * as L4 from "../../../lib4.mjs";
import { loadPanel, loadControls } from "../panel/data.mjs";

export { L4 };
export const AGENT = "learn";
export const OUT = path.join(L4.DEEP4, "audit", "exposed", AGENT); // AUDIT COPY (T2)
export const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));
fs.mkdirSync(OUT, { recursive: true });

// ---- safety: never run with any holdout / exposed switch set (this code never sets them) ----
export function assertSafeEnv() {
  for (const k of ["DEEP4_EXPOSED", "DEEP2_HOLDOUT", "DEEP3_HOLDOUT"]) {
    if (process.env[k] != null && process.env[k] !== "" && process.env[k] !== "0") throw new Error(`learn: refusing to run with ${k} set`);
  }
  if (L4.exposedUnlocked()) throw new Error("learn: exposed segment unlocked — refusing to run");
}
// AUDIT COPY (T3): assertSafeEnv() not called — this copy is the auditor's single exposed run

// ---- io ----
export const outPath = (name) => path.join(OUT, name);
export function writeOut(name, data) { const f = outPath(name); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof data === "string" ? data : JSON.stringify(data, null, 1)); return f; }
export const readOut = (name) => JSON.parse(fs.readFileSync(outPath(name), "utf8"));
export const existsOut = (name) => fs.existsSync(outPath(name));
export const sha256File = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
export function checkpoint(step, info = {}) {
  const f = outPath("progress.json");
  let p = { agent: AGENT, steps: [] }; try { p = JSON.parse(fs.readFileSync(f, "utf8")); } catch { /* new */ }
  p.updatedAt = new Date().toISOString();
  p.steps = (p.steps || []).filter((s) => s.step !== step); p.steps.push({ step, status: "done", at: p.updatedAt, ...info });
  fs.writeFileSync(f, JSON.stringify(p, null, 1));
}
export function toCsv(rows, cols) {
  const esc = (v) => (v == null ? "" : typeof v === "number" ? (Number.isFinite(v) ? String(Number.isInteger(v) ? v : Math.round(v * 1e6) / 1e6) : "") : typeof v === "boolean" ? (v ? "1" : "0") : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

// ---- data (design only unless a segment list is passed explicitly) ----
export function loadEvents({ segments = ["design"] } = {}) {
  // AUDIT COPY (T3): exposed refusal removed
  return loadPanel({ agent: AGENT, segments });
}
export function loadCtl({ segments = ["design"] } = {}) {
  // AUDIT COPY (T3): exposed refusal removed
  return loadControls({ agent: AGENT, segments });
}
// Modelling universe U: open-market, valued, priced (primary), one row per economic event (isPrimary), >= 26 bars (featOk).
export const inUniverse = (r) => r.primary === 1 && r.isPrimary === 1 && r.featOk === 1;

// ---- small math ----
export const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
export const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export const quantile = (xs, p) => { const s = xs.filter((v) => v != null && Number.isFinite(v)).sort((a, b) => a - b); if (!s.length) return null; const i = p * (s.length - 1), lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
export const sd = (xs) => { if (xs.length < 2) return null; const m = mean(xs); return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1)); };
export const clip = (x, lo, hi) => (x == null || !Number.isFinite(x) ? x : Math.min(hi, Math.max(lo, x)));
export const r4 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1e4) / 1e4);
export const r6 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1e6) / 1e6);
export const fin = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);
export const group = (arr, f) => { const m = new Map(); for (const x of arr) { const k = f(x); (m.get(k) || m.set(k, []).get(k)).push(x); } return m; };

// ---- registry (lib4; ids prefixed "learn.") ----
export function register(h) {
  if (!String(h.id).startsWith("learn.")) throw new Error(`register: id must start with learn. (${h.id})`);
  return L4.registerHypothesis({ agent: AGENT, preRegistered: true, ...h });
}
export const record = (id, result) => L4.recordResult(id, AGENT, result);
export function registeredIds() {
  const f = path.join(L4.DEEP4, "registry.jsonl");
  if (!fs.existsSync(f)) return new Set();
  return new Set(fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((h) => h.agent === AGENT).map((h) => h.id));
}
export function recordedIds() {
  const f = path.join(L4.DEEP4, "registry-results.jsonl");
  if (!fs.existsSync(f)) return new Set();
  return new Set(fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((h) => h.agent === AGENT).map((h) => h.id));
}
