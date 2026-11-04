// deep3/audit/common.mjs — helpers for the deep-3 independent auditor (agent "audit3", role G). RESEARCH ONLY.
// - Cache only, no network, no DB, no servers, no git. Reads the deep-3 specialists' outputs read-only.
// - Writes only under .cache/research/deep3/audit/ and appends audit3-* ids to the deep-3 registry.
// - Registry functions copied from deep2/lib2.mjs (registerHypothesis / recordResult), pointed at the deep-3 registry.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import * as L from "../../deep2/lib2.mjs";

export { L };
export const AGENT = "audit3";
export const DEEP3 = path.join(path.dirname(L.DEEP2), "deep3");
export const OUT = path.join(DEEP3, "audit");
export const SEQ = path.join(DEEP3, "sequence");
export const TGT = path.join(DEEP3, "targets");
export const DQ = path.join(DEEP3, "dataquality");
fs.mkdirSync(OUT, { recursive: true });
export const FROZEN3 = path.join(DEEP3, "frozen-rules.json");
export const FROZEN3_SHA = "3ca2c3c4f4d99eac406e46b3efcfb2ebf5cbd501bde5971aa9803e05b6f72d21";
export const sha256File = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
export const { mean, median, r4, bhQ, pValue, companyStats } = L;

// ---------------- registry (copied from lib2.registerHypothesis / recordResult; deep-3 files; ids "audit3-") ----------------
export const REG = path.join(DEEP3, "registry.jsonl");
export const RES = path.join(DEEP3, "registry-results.jsonl");
export const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : []);
export function registerHypothesis(h) {
  const need = ["agent", "id", "family", "familySize", "statement", "rationale"];
  for (const k of need) if (h[k] == null) throw new Error(`registerHypothesis: missing ${k}`);
  fs.appendFileSync(REG, JSON.stringify({ ...h, registeredAt: new Date().toISOString() }) + "\n");
}
export function recordResult(id, agent, result) {
  const reg = fs.existsSync(REG) ? fs.readFileSync(REG, "utf8") : "";
  if (!reg.includes(`"id":${JSON.stringify(id)}`)) throw new Error(`recordResult: ${id} was not registered first`);
  fs.appendFileSync(RES, JSON.stringify({ id, agent, result, at: new Date().toISOString() }) + "\n");
}
// Idempotent registration (first registration counts); ids must start with "audit3-".
export function reg(h) {
  if (!String(h.id).startsWith(`${AGENT}-`)) throw new Error(`id must start with ${AGENT}-`);
  if (readJsonl(REG).some((x) => x.id === h.id)) return false;
  registerHypothesis({ agent: AGENT, ...h });
  return true;
}
// Record once: a re-run that reproduces the latest result exactly is not appended again.
export function rec(id, result) {
  const js = JSON.stringify(result);
  const last = readJsonl(RES).filter((x) => x.id === id).at(-1);
  if (last && JSON.stringify(last.result) === js) return false;
  recordResult(id, AGENT, result);
  return true;
}

// ---------------- io ----------------
export const writeOut = (name, data) => { const f = path.join(OUT, name); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof data === "string" ? data : JSON.stringify(data, null, 1)); return f; };
export const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
export const readSeq = (name) => readJson(path.join(SEQ, name));
export const readTgt = (name) => readJson(path.join(TGT, name));
export const existsOut = (name) => fs.existsSync(path.join(OUT, name));
export const group = (arr, f) => { const m = new Map(); for (const x of arr) { const k = f(x); (m.get(k) || m.set(k, []).get(k)).push(x); } return m; };
export const countBy = (arr, f) => arr.reduce((m, x) => { const k = String(f(x)); m[k] = (m[k] || 0) + 1; return m; }, {});
export const quantile = (xs, p) => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); if (!s.length) return null; const i = p * (s.length - 1), lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
export function toCsv(rows, cols) {
  const esc = (v) => (v == null ? "" : typeof v === "number" ? (Number.isFinite(v) ? String(Number.isInteger(v) ? v : Math.round(v * 1e6) / 1e6) : "") : typeof v === "boolean" ? (v ? "1" : "0") : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

// ---------------- sequence-agent conventions (read-only re-use of its outputs) ----------------
// touch: sequence convention = sessions 1..W with the entry session counted as session 1 (o.first is 1-based).
export const TK = (X) => `t${Math.round(X * 100)}`;
export function seqTouch(o, X, W) { if (!o || o.availTouchW < W) return null; const f = o.first[TK(X)]; return f != null && f <= W ? 1 : 0; }
export const seqNet = (o, N, mult = 1) => { const x = o?.x?.[N]; return x ? x[mult - 1] : null; };
export const tbucket = (k) => (k >= 6 ? "6+" : String(k));
export const BUCKETS = ["1", "2", "3", "4", "5", "6+"];
// Join of sequence signals with outcomes and controls (as analyze.mjs `join`).
export function loadSequence({ withControls = true } = {}) {
  const signals = readSeq("signals.json"), outc = readSeq("outcomes.json"), ctl = withControls ? readSeq("controls.json") : {};
  const J = signals.map((s) => { const o = outc[s.acc]; return { ...s, out: o?.status === "ok" ? o : null, ctl: ctl[s.acc] || null }; });
  return { signals, outc, ctl, J };
}
// Issuer-clustered mean (CR1) with a normal 95% CI (same as the sequence agent's clusteredMean).
export function cm(rows) {
  const xs = rows.filter((r) => Number.isFinite(r.x)); const n = xs.length; if (!n) return { n: 0 };
  const m = xs.reduce((a, r) => a + r.x, 0) / n;
  const g = new Map(); for (const r of xs) g.set(r.issuer, (g.get(r.issuer) || 0) + (r.x - m));
  const G = g.size; const v = G > 1 ? ([...g.values()].reduce((a, s) => a + s * s, 0) / (n * n)) * (G / (G - 1)) : null;
  const se = v > 0 ? Math.sqrt(v) : null, t = se ? m / se : null;
  return { n, issuers: G, mean: r4(m), se: r4(se), t: t == null ? null : Math.round(t * 100) / 100, p: t == null ? null : r4(pValue(t)), ci95: se ? [r4(m - 1.96 * se), r4(m + 1.96 * se)] : null };
}
export const pct = (v, d = 1) => (v == null || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(d)}%`);
