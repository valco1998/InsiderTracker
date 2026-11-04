// deep3/sequence/common.mjs — helpers for the buyer-sequence specialist (agent "sequence"). RESEARCH ONLY.
// - Cache only, no network: lib2.loadSecRows / loadBars / loadEvents (holdout hidden by lib2) and the deep-2
//   classification v2 file. Never calls loadDailyBars / fetchTrades / Alpaca / SEC.
// - Writes only under .cache/research/deep3/sequence/ and appends to the deep-3 registry (ids "sequence-…").
// - Copied helpers (with attribution): registry (lib2), roles / names / holdings (deep2/behavior/common.mjs),
//   chart features + matched controls (deep2/chart/common.mjs), clustered OLS (deep2/behavior/common.mjs),
//   portfolio simulator and adjFactor (deep2/execution/execLib.mjs).
import fs from "node:fs";
import path from "node:path";
import * as L from "../../deep2/lib2.mjs";
import { entrySessionAfter, sessionAfter, nextSession, previousSession, isSession } from "../../lib.mjs";
import { closeTime } from "../../../../services/backtest/sessionCalendar.js";

export { L, entrySessionAfter, sessionAfter, nextSession, previousSession, isSession, closeTime };
export const AGENT = "sequence";
export const DEEP3 = path.join(path.dirname(L.DEEP2), "deep3");
export const OUT = path.join(DEEP3, "sequence");
fs.mkdirSync(OUT, { recursive: true });
export const DISCOVER_END = L.DISCOVER_END; // "2026-06-15"
export const HOLDOUT_START = L.HOLDOUT_START; // "2026-09-01" — nothing at/after this date is evaluated here
export const STORE_START = "2025-12-01";
export const periodOfDate = (d) => (String(d).slice(0, 10) < DISCOVER_END ? "discover" : String(d).slice(0, 10) < HOLDOUT_START ? "confirm" : "holdout");
export const periodEnd = (p) => (p === "discover" ? DISCOVER_END : HOLDOUT_START);
export const { mean, median, r4, bhQ, pValue, companyStats, wmean } = L;
export const writeOut = (name, data) => { const f = path.join(OUT, name); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof data === "string" ? data : JSON.stringify(data)); return f; };
export const writePretty = (name, data) => writeOut(name, JSON.stringify(data, null, 1));
export const readOut = (name) => JSON.parse(fs.readFileSync(path.join(OUT, name), "utf8"));
export const existsOut = (name) => fs.existsSync(path.join(OUT, name));

// SEC store coverage defects (deep-1 stageA.json): whole days missing and partially fetched days.
// Filings accepted on these days may be absent, so a later buyer's position can be under-counted.
export const MISSING_DAYS = ["2025-12-24", "2025-12-26", "2025-12-29", "2025-12-30", "2025-12-31"];
export const PARTIAL_DAYS = ["2025-12-19", "2026-01-05", "2026-03-10", "2026-03-30", "2026-03-31", "2026-04-16", "2026-04-17", "2026-04-30", "2026-05-05", "2026-05-18"]; // first 10 of 14 listed by stageA
export const GAP_DAYS = [...MISSING_DAYS, ...PARTIAL_DAYS].sort();

// ---------------- registry (copied from lib2.registerHypothesis / recordResult, pointed at deep 3) ----------------
export const REG = path.join(DEEP3, "registry.jsonl");
export const RES = path.join(DEEP3, "registry-results.jsonl");
const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : []);
export function registerHypothesis(h) {
  const need = ["agent", "id", "family", "familySize", "statement", "rationale"];
  for (const k of need) if (h[k] == null) throw new Error(`registerHypothesis: missing ${k}`);
  fs.appendFileSync(REG, JSON.stringify({ ...h, registeredAt: new Date().toISOString() }) + "\n");
}
export function recordResult(id, agent, result) {
  if (!readJsonl(REG).some((x) => x.id === id)) throw new Error(`recordResult: ${id} was not registered first`);
  fs.appendFileSync(RES, JSON.stringify({ id, agent, result, at: new Date().toISOString() }) + "\n");
}
export const myRegistry = () => readJsonl(REG).filter((h) => h.agent === AGENT);
export const myResults = () => readJsonl(RES).filter((h) => h.agent === AGENT);
// Idempotent: the first registration of an id is the one that counts.
export function reg(h) {
  if (!h.id.startsWith(`${AGENT}-`)) throw new Error(`id must start with ${AGENT}-`);
  if (myRegistry().some((x) => x.id === h.id)) return false;
  registerHypothesis({ agent: AGENT, preRegistered: true, ...h });
  return true;
}
// Bulk registration (one file read): returns the number of new ids.
export function regMany(hs) {
  const have = new Set(myRegistry().map((x) => x.id)); let n = 0;
  const lines = [];
  for (const h of hs) {
    if (!h.id.startsWith(`${AGENT}-`)) throw new Error(`id must start with ${AGENT}-`);
    for (const k of ["id", "family", "familySize", "statement", "rationale"]) if (h[k] == null) throw new Error(`regMany: ${h.id} missing ${k}`);
    if (have.has(h.id)) continue;
    have.add(h.id); n++;
    lines.push(JSON.stringify({ agent: AGENT, preRegistered: true, ...h, registeredAt: new Date().toISOString() }));
  }
  if (lines.length) fs.appendFileSync(REG, lines.join("\n") + "\n");
  return n;
}
// Bulk results: only ids registered first; a re-run that reproduces the latest result exactly is not appended.
export function recMany(results) {
  const regIds = new Set(myRegistry().map((x) => x.id));
  const last = new Map(); for (const r of myResults()) last.set(r.id, JSON.stringify(r.result));
  const lines = []; let n = 0;
  for (const [id, result] of results) {
    if (!regIds.has(id)) throw new Error(`recMany: ${id} was not registered first`);
    const js = JSON.stringify(result);
    if (last.get(id) === js) continue;
    lines.push(JSON.stringify({ id, agent: AGENT, result, at: new Date().toISOString() })); n++;
  }
  if (lines.length) fs.appendFileSync(RES, lines.join("\n") + "\n");
  return n;
}

// ---------------- small utils ----------------
export const sym = (t) => String(t || "").trim().toUpperCase().replace(/-/g, ".");
const DAY = 86_400_000;
export const dnum = (d) => Math.floor(Date.parse(`${String(d).slice(0, 10)}T00:00:00Z`) / DAY);
export const tsMs = (s) => Date.parse(`${String(s).slice(0, 10)}T${String(s).slice(11, 19) || "00:00:00"}Z`); // ET wall clock as pseudo-UTC
export const msToTs = (ms) => new Date(ms).toISOString().replace("T", " ").slice(0, 19);
export const group = (arr, f) => { const m = new Map(); for (const x of arr) { const k = f(x); (m.get(k) || m.set(k, []).get(k)).push(x); } return m; };
export const quantile = (xs, p) => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); if (!s.length) return null; const i = p * (s.length - 1), lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
export const pct = (v, d = 1) => (v == null || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(d)}%`);
export function toCsv(rows, cols) {
  const esc = (v) => (v == null ? "" : typeof v === "number" ? (Number.isFinite(v) ? String(Number.isInteger(v) ? v : Math.round(v * 1e6) / 1e6) : "") : typeof v === "boolean" ? (v ? "1" : "0") : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

// ---------------- statistics ----------------
// Issuer-clustered mean (CR1): rows [{ issuer, x }] → mean, clustered SE, t, p, normal 95% CI.
export function clusteredMean(rows) {
  const xs = rows.filter((r) => Number.isFinite(r.x));
  const n = xs.length; if (!n) return { n: 0 };
  const m = xs.reduce((a, r) => a + r.x, 0) / n;
  const g = new Map(); for (const r of xs) g.set(r.issuer, (g.get(r.issuer) || 0) + (r.x - m));
  const G = g.size;
  const v = G > 1 ? ([...g.values()].reduce((a, s) => a + s * s, 0) / (n * n)) * (G / (G - 1)) : null;
  const se = v != null && v > 0 ? Math.sqrt(v) : null;
  const t = se ? m / se : null;
  return { n, issuers: G, mean: r4(m), se: r4(se), t: t == null ? null : Math.round(t * 100) / 100, p: t == null || G < 5 ? null : r4(pValue(t)), ci95: se ? [r4(m - 1.96 * se), r4(m + 1.96 * se)] : null };
}
// OLS x = a + b·z, issuer-clustered (copied from deep2/behavior/common.mjs). rows: [{ issuer, x, z }]
export function clusteredOLS(rows) {
  const n = rows.length; if (n < 10) return null;
  let sz = 0, sx = 0, szz = 0, szx = 0;
  for (const r of rows) { sz += r.z; sx += r.x; szz += r.z * r.z; szx += r.z * r.x; }
  const det = n * szz - sz * sz; if (!(Math.abs(det) > 1e-12)) return null;
  const a = (szz * sx - sz * szx) / det, b = (n * szx - sz * sx) / det;
  const inv = [[szz / det, -sz / det], [-sz / det, n / det]];
  const g = new Map();
  for (const r of rows) { const e = r.x - a - b * r.z; const s = g.get(r.issuer) || [0, 0]; s[0] += e; s[1] += e * r.z; g.set(r.issuer, s); }
  const G = g.size; if (G < 5) return null;
  let m00 = 0, m01 = 0, m11 = 0;
  for (const [u0, u1] of g.values()) { m00 += u0 * u0; m01 += u0 * u1; m11 += u1 * u1; }
  const k = (G / (G - 1)) * ((n - 1) / (n - 2));
  const M = [[m00, m01], [m01, m11]];
  const IM = [[inv[0][0] * M[0][0] + inv[0][1] * M[1][0], inv[0][0] * M[0][1] + inv[0][1] * M[1][1]], [inv[1][0] * M[0][0] + inv[1][1] * M[1][0], inv[1][0] * M[0][1] + inv[1][1] * M[1][1]]];
  const v11 = k * (IM[1][0] * inv[0][1] + IM[1][1] * inv[1][1]);
  const t = v11 > 0 ? b / Math.sqrt(v11) : null;
  return { n, issuers: G, a: r4(a), b: r4(b), t: t == null ? null : Math.round(t * 100) / 100, p: t == null ? null : r4(pValue(t)) };
}
// Difference of means A − B (issuer-clustered). A, B: [{ issuer, x }]
export function diffTest(A, B) {
  const a = A.filter((r) => Number.isFinite(r.x)), b = B.filter((r) => Number.isFinite(r.x));
  const rows = [...a.map((r) => ({ issuer: r.issuer, x: r.x, z: 1 })), ...b.map((r) => ({ issuer: r.issuer, x: r.x, z: 0 }))];
  const o = clusteredOLS(rows);
  return { nA: a.length, nB: b.length, issuersA: new Set(a.map((r) => r.issuer)).size, meanA: r4(mean(a.map((r) => r.x))), meanB: r4(mean(b.map((r) => r.x))), diff: o?.b ?? null, t: o?.t ?? null, p: o?.p ?? null };
}
// Rank-slope (top-vs-bottom spread of x on the centred percentile rank of z), issuer-clustered.
export function rankSlope(rows) {
  const s = [...rows].filter((r) => Number.isFinite(r.z) && Number.isFinite(r.x)).sort((a, b) => a.z - b.z);
  if (s.length < 20) return null;
  const out = []; let i = 0;
  while (i < s.length) { let j = i; while (j + 1 < s.length && s[j + 1].z === s[i].z) j++; const rk = (i + j) / 2 / (s.length - 1) - 0.5; for (let k = i; k <= j; k++) out.push({ issuer: s[k].issuer, x: s[k].x, z: rk }); i = j + 1; }
  return clusteredOLS(out);
}
// Deterministic issuer-block bootstrap CI of a mean (same LCG as lib2.companyStats).
export function bootCI(rows, { boot = 400, seed = 11 } = {}) {
  const byI = new Map(); for (const r of rows) if (Number.isFinite(r.x)) (byI.get(r.issuer) || byI.set(r.issuer, []).get(r.issuer)).push(r.x);
  const groups = [...byI.values()]; if (groups.length < 5) return null;
  let s = seed; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const bm = [];
  for (let b = 0; b < boot; b++) { let sum = 0, n = 0; for (let k = 0; k < groups.length; k++) { const g = groups[Math.floor(rnd() * groups.length)]; for (const x of g) { sum += x; n++; } } bm.push(sum / n); }
  bm.sort((a, b) => a - b);
  return [r4(bm[Math.floor(0.025 * boot)]), r4(bm[Math.floor(0.975 * boot)])];
}

// ---------------- roles, names, holdings (copied from deep2/behavior/common.mjs + features.mjs) ----------------
const CEO_RE = /\b(chief executive officer|principal executive officer|co-?ceo|ceo)\b/i;
const CFO_RE = /\b(chief financial officer|principal financial officer|cfo)\b/i;
const OFFICER_RE = /\b(president|officer|chief|vice|vp|evp|svp|treasurer|secretary|controller|general counsel|coo|cto|cio|cao|chairman|chairwoman|chair)\b/i;
export function rolesOfText(role) {
  const t = String(role || "");
  const g = new Set();
  if (CEO_RE.test(t)) g.add("CEO");
  if (CFO_RE.test(t)) g.add("CFO");
  if (/director/i.test(t)) g.add("Director");
  if (/10%\s*owner/i.test(t)) g.add("10% Owner");
  const rest = t.replace(/director|10%\s*owner/gi, "");
  if (!g.has("CEO") && !g.has("CFO") && OFFICER_RE.test(rest)) g.add("Officer");
  if (!g.size) g.add("Other");
  return g;
}
// One primary role per buyer: CEO > CFO > other officer > director > 10% owner > other.
export const primaryRole = (g) => (g.has("CEO") ? "CEO" : g.has("CFO") ? "CFO" : g.has("Officer") ? "Officer" : g.has("Director") ? "Director" : g.has("10% Owner") ? "TenPct" : "Other");
export const ownerNames = (insider) => String(insider || "").split(/\s*;\s*/).filter(Boolean);
export const normName = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
// % of prior holdings from sharesOwnedAfter (deep2 features.mjs `conviction`, without the earlier-rows check):
// each ownership line (D, or I + nature) → bought = Σ shares, after = max(after), prior = after − bought.
export function holdingsOf(rows) {
  const lines = group(rows, (r) => `${r.own}|${normName(r.nature)}`);
  let bought = 0, prior = 0, after = 0, valid = true;
  for (const [, xs] of lines) {
    const b = xs.reduce((a, r) => a + (r.shares || 0), 0);
    const aft = Math.max(...xs.map((r) => (Number.isFinite(r.after) ? r.after : -1)));
    if (!(b > 0) || !(aft >= 0)) { valid = false; continue; }
    const pr = aft - b;
    if (pr < -Math.max(1, 0.001 * aft)) { valid = false; continue; }
    bought += b; after += aft; prior += Math.max(0, pr);
  }
  if (!valid || !(bought > 0)) return { holdValid: false, sharesBought: bought || null, holdingsAfter: null, priorHoldings: null, pctOfPrior: null, priorNearZero: null };
  const priorNearZero = prior <= 0.005 * after;
  return { holdValid: true, sharesBought: bought, holdingsAfter: after, priorHoldings: prior, pctOfPrior: priorNearZero ? null : r4(bought / prior), priorNearZero };
}

// ---------------- union-find over owner keys ----------------
export class UF {
  constructor() { this.p = new Map(); }
  add(k) { if (!this.p.has(k)) this.p.set(k, k); }
  find(k) { this.add(k); let r = k; while (this.p.get(r) !== r) r = this.p.get(r); let c = k; while (this.p.get(c) !== r) { const n = this.p.get(c); this.p.set(c, r); c = n; } return r; }
  union(a, b) { const ra = this.find(a), rb = this.find(b); if (ra === rb) return false; if (ra < rb) this.p.set(rb, ra); else this.p.set(ra, rb); return true; }
}

// ---------------- calendar + chart features (copied from deep2/chart/common.mjs) ----------------
export const sd = (xs) => { if (xs.length < 3) return null; const m = mean(xs); return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1)); };
export const clip = (x, lo, hi) => (x == null || !Number.isFinite(x) ? null : Math.min(hi, Math.max(lo, x)));
export function costBpsFor(dv) { if (!(dv > 0)) return 100; if (dv >= 50e6) return 5; if (dv >= 5e6) return 15; if (dv >= 1e6) return 35; return 75; }
export const tierOf = (dv) => { const b = costBpsFor(dv); return b >= 75 ? 75 : b; };
export function calendar(bars) {
  const spy = bars.get("SPY"); const days = spy.arr.map((b) => b.d); const idx = new Map(days.map((d, i) => [d, i]));
  const above50 = new Map(); let s = 0;
  for (let i = 0; i < spy.arr.length; i++) { s += spy.arr[i].c; if (i >= 50) s -= spy.arr[i - 50].c; if (i >= 49) above50.set(days[i], spy.arr[i].c > s / 50); }
  const firstOnOrAfter = (d) => { let lo = 0, hi = days.length - 1, ans = days.length; while (lo <= hi) { const m = (lo + hi) >> 1; if (days[m] >= d) { ans = m; hi = m - 1; } else lo = m + 1; } return ans; };
  return { spy, days, idx, above50, firstOnOrAfter };
}
export function featuresAt(s, i, cal) {
  const a = s.arr;
  if (i < 25 || !(a[i]?.c > 0)) return null;
  const last = a[i].c;
  const ret = (n) => (i - n >= 0 && a[i - n].c > 0 ? last / a[i - n].c - 1 : null);
  const w60 = Math.max(0, i - 59);
  let hiC = -Infinity, loC = Infinity, loL = Infinity;
  for (let k = w60; k <= i; k++) { const b = a[k]; if (b.c > hiC) hiC = b.c; if (b.c < loC) loC = b.c; if (b.l < loL) loL = b.l; }
  const lr = (from, to) => { const xs = []; for (let k = Math.max(1, from); k <= to; k++) if (a[k].c > 0 && a[k - 1].c > 0) xs.push(Math.log(a[k].c / a[k - 1].c)); return xs; };
  const vol20 = sd(lr(i - 19, i)), vol10 = sd(lr(i - 9, i)), vol60 = sd(lr(i - 59, i));
  let dv = 0, n = 0; for (let k = Math.max(0, i - 19); k <= i; k++) { dv += a[k].c * a[k].v; n++; }
  const dv20 = n ? dv / n : null;
  const avgV = (from, to) => { let t = 0, m = 0; for (let k = Math.max(0, from); k <= to; k++) { t += a[k].v; m++; } return m ? t / m : null; };
  const v60 = avgV(i - 59, i), vSpike = avgV(i - 2, i), vBase = avgV(i - 22, i - 3);
  const sma = (len) => { if (i + 1 < len) return null; let t = 0; for (let k = i - len + 1; k <= i; k++) t += a[k].c; return t / len; };
  const sma50 = sma(50);
  let hi20p = -Infinity; for (let k = Math.max(0, i - 20); k < i; k++) hi20p = Math.max(hi20p, a[k].h);
  let lo20 = Infinity, hi20 = -Infinity; for (let k = Math.max(0, i - 19); k <= i; k++) { lo20 = Math.min(lo20, a[k].l); hi20 = Math.max(hi20, a[k].h); }
  const range20 = lo20 > 0 ? hi20 / lo20 - 1 : null;
  return {
    decDate: a[i].d, price: last, r1: ret(1), r5: ret(5), r20: ret(20), r60: i >= 60 ? ret(60) : null,
    dd60: last / hiC - 1, pos60: hiC > loC ? (last - loC) / (hiC - loC) : null, nearLow60: last <= loL * 1.05,
    vol20, vol10_60: vol10 && vol60 ? vol10 / vol60 : null, dv20, gapPrev: a[i - 1].c > 0 ? a[i].o / a[i - 1].c - 1 : null,
    sma50r: sma50 ? last / sma50 - 1 : null, range20, tight: range20 != null && vol60 ? range20 / (vol60 * Math.sqrt(20)) : null,
    breakout20: last > hi20p, volSpike: vBase > 0 && vSpike != null ? vSpike / vBase : null, volRatio5_60: v60 > 0 ? avgV(i - 4, i) / v60 : null,
    spyAbove50: cal.above50.has(a[i].d) ? cal.above50.get(a[i].d) : null,
  };
}

// ---------------- path outcomes (touch / limit-fill approximation / executable) ----------------
export const TARGETS = [0.05, 0.10, 0.15, 0.20];
export const TKEY = (X) => `t${Math.round(X * 100)}`;
export const TOUCH_W = [1, 2, 3, 5, 10]; // sessions, the entry session counted as session 1
export const HORIZONS = [0, 1, 2, 3, 5, 10]; // realised exit at the close of the N-th session after the entry session (0 = same-day close)
export const TP_N = [1, 2, 3, 5, 10];
export const FILL_BUFFER = 0.005; // BRIEF: limit filled only if high >= target × 1.005
export const SCAN = 11; // sessions 0..10
// One long position. j0 = calendar index of the entry session. mode "open": filled at the official open of session 0
// (the whole session-0 range lies at/after the fill). mode "close": filled at the official close of session 0 (path starts at
// session 1). periodEndDate: outcome dates must be < this (lib2 embargo). Returns null when the entry bar is unusable.
export function pathOutcome(ser, cal, j0, { mode = "open", periodEndDate, costBps, completeThrough = "2026-11-03" }) {
  const D0 = cal.days[j0]; if (!D0) return null;
  const k0 = ser.idx.get(D0); if (k0 == null) return null;
  const b0 = ser.arr[k0];
  const entry = mode === "open" ? b0.o : b0.c;
  if (!(entry > 0)) return null;
  const S = cal.spy.arr, spyEntry = mode === "open" ? S[j0].o : S[j0].c;
  const start = mode === "open" ? 0 : 1;
  const sess = [];
  for (let s = 0; s <= SCAN; s++) {
    const d = cal.days[j0 + s];
    if (!d || d >= periodEndDate || d > completeThrough) break;
    const k = ser.idx.get(d);
    sess.push({ s, d, b: k == null ? null : ser.arr[k], spy: S[j0 + s] });
  }
  const avail = sess.length; // sessions 0..avail-1 are inside the period (embargo) and cached
  const c = costBps / 1e4;
  const o = { mode, entryDate: D0, entry, spyEntry, avail, availTouchW: Math.max(0, Math.min(10, avail - start)), first: {}, ddBefore: {}, ddBeforeStrict: {}, mfe: {}, mae: {}, x: {}, gross: {}, spyR: {}, exitDate: {}, tp: {} };
  // touches (sessions start..start+9; also session start+10 scanned for the TP horizon 10)
  for (const X of TARGETS) {
    const tg = entry * (1 + X); let first = null, lowSoFar = Infinity, lowBefore = Infinity;
    for (const z of sess) {
      if (z.s < start || !z.b) continue;
      if (z.b.h >= tg) { first = z.s - start + 1; lowSoFar = Math.min(lowSoFar, z.b.l); break; }
      lowSoFar = Math.min(lowSoFar, z.b.l); lowBefore = Math.min(lowBefore, z.b.l);
    }
    o.first[TKEY(X)] = first; // 1-based session number (1 = first session of the path)
    o.ddBefore[TKEY(X)] = first == null ? null : r4(Math.min(0, lowSoFar / entry - 1)); // worst case: includes the touch session's low
    o.ddBeforeStrict[TKEY(X)] = first == null ? null : r4(Math.min(0, (lowBefore === Infinity ? entry : lowBefore) / entry - 1));
  }
  for (const W of TOUCH_W) {
    if (start + W - 1 >= avail) { o.mfe[W] = null; o.mae[W] = null; continue; }
    let hi = -Infinity, lo = Infinity;
    for (const z of sess) { if (z.s < start || z.s > start + W - 1 || !z.b) continue; hi = Math.max(hi, z.b.h); lo = Math.min(lo, z.b.l); }
    o.mfe[W] = hi === -Infinity ? null : r4(Math.max(0, hi / entry - 1));
    o.mae[W] = lo === Infinity ? null : r4(Math.min(0, lo / entry - 1));
  }
  // sessions to the maximum high within 10 sessions
  if (start + 9 < avail) { let best = -Infinity, at = null; for (const z of sess) { if (z.s < start || z.s > start + 9 || !z.b) continue; if (z.b.h > best) { best = z.b.h; at = z.s - start + 1; } } o.toMaxHigh10 = at; } else o.toMaxHigh10 = null;
  // realised: close of the N-th session after the entry session
  for (const N of HORIZONS) {
    if (mode === "close" && N === 0) continue;
    const z = sess[N];
    if (!z || !z.b || !(z.b.c > 0)) { o.x[N] = null; continue; }
    const g = z.b.c / entry - 1, sr = z.spy.c / spyEntry - 1;
    o.gross[N] = r4(g); o.spyR[N] = r4(sr); o.exitDate[N] = z.d;
    o.x[N] = [1, 2, 3].map((m) => r4((z.b.c * (1 - m * c)) / (entry * (1 + m * c)) - 1 - sr)); // [×1, ×2, ×3] net excess vs SPY
  }
  // limit take-profit approximation (BRIEF): resting sell limit at entry×(1+X), filled at max(open, target) on the first
  // session whose high >= target×1.005; otherwise exit at the close of N. No stop. Benchmark: SPY to that session's close.
  for (const X of TARGETS) for (const N of TP_N) {
    const key = `${TKEY(X)}n${N}`;
    if (!sess[N] || !sess[N].b || !(sess[N].b.c > 0)) { o.tp[key] = null; continue; }
    const tg = entry * (1 + X); let fillS = null, px = null, z0 = null;
    for (const z of sess) { if (z.s < start || z.s > N || !z.b) continue; if (z.b.h >= tg * (1 + FILL_BUFFER)) { fillS = z.s - start + 1; px = Math.max(z.b.o, tg); z0 = z; break; } }
    if (fillS == null) { z0 = sess[N]; px = z0.b.c; }
    const sr = z0.spy.c / spyEntry - 1;
    o.tp[key] = { fillS, g: r4(px / entry - 1), sr: r4(sr), x1: r4((px * (1 - c)) / (entry * (1 + c)) - 1 - sr), x2: r4((px * (1 - 2 * c)) / (entry * (1 + 2 * c)) - 1 - sr) };
  }
  return o;
}

// ---------------- matched controls (copied from deep2/chart/common.mjs; marks restricted to pre-holdout rows) ----------------
export async function purchaseBlocks(cal, sec, { before = 20, after = 20 } = {}) {
  const cik2sym = new Map();
  for (const r of sec.rows) if (r.ticker && r.cik && !cik2sym.has(r.cik)) cik2sym.set(r.cik, sym(r.ticker));
  const marks = new Map();
  for (const r of sec.rows) {
    if (r.code !== "P") continue;
    if (!(String(r.acceptedAt) < HOLDOUT_START)) continue; // deep 3: never use holdout-period filings, even for exclusion windows
    const s = r.ticker ? sym(r.ticker) : cik2sym.get(r.cik); if (!s) continue;
    const m = marks.get(s) || marks.set(s, new Set()).get(s);
    const ad = String(r.acceptedAt || "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(ad)) { const j = cal.firstOnOrAfter(ad); m.add(j); m.add(j + 1); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(r.tradeDate || "")) m.add(cal.firstOnOrAfter(r.tradeDate));
  }
  const Lc = cal.days.length;
  const blocked = new Map();
  for (const [s, set] of marks) { const b = new Uint8Array(Lc); for (const m of set) for (let j = Math.max(0, m - after); j <= Math.min(Lc - 1, m + before); j++) b[j] = 1; blocked.set(s, b); }
  return { blocked, cik2sym };
}
export function buildPool(bars, cal, blocked, { from = STORE_START, to = HOLDOUT_START } = {}) {
  const syms = [...bars.keys()].filter((s) => s !== "SPY" && s !== "IWM" && bars.get(s).arr.length > 30);
  const rows = [];
  syms.forEach((s, si) => {
    const ser = bars.get(s), a = ser.arr, blk = blocked.get(s);
    for (let k = 26; k < a.length; k++) {
      const D = a[k].d; if (D < from || D >= to) continue;
      const j = cal.idx.get(D); if (j == null) continue;
      if (blk && blk[j]) continue;
      if (!(a[k].o > 0)) continue;
      const f = featuresAt(ser, k - 1, cal); if (!f) continue;
      const jd = cal.idx.get(a[k - 1].d); if (jd == null) continue;
      const S = cal.spy.arr;
      const gapX = (a[k].o / a[k - 1].c - 1) - (S[j].o / S[jd].c - 1);
      rows.push({ si, s, k, j, D, m: D.slice(0, 7), per: periodOfDate(D), tier: tierOf(f.dv20), r5: f.r5, r20: f.r20, dd60: f.dd60, vol20: f.vol20, dv20: f.dv20, gapPrev: f.gapPrev, gapX });
    }
  });
  return { rows, syms };
}
const F = {
  r5: { k: "r5", w: 1, f: (r) => clip(r.r5, -0.5, 1.0) },
  r20: { k: "r20", w: 1, f: (r) => clip(r.r20, -0.7, 2.0) },
  dd60: { k: "dd60", w: 1, f: (r) => clip(r.dd60, -1, 0) },
  lvol20: { k: "lvol20", w: 1, f: (r) => (r.vol20 > 0 ? Math.log(Math.max(r.vol20, 1e-3)) : null) },
  ldv20: { k: "ldv20", w: 1, f: (r) => (r.dv20 > 0 ? Math.log(Math.max(r.dv20, 1e3)) : null) },
  gapPrev: { k: "gapPrev", w: 0.5, f: (r) => clip(r.gapPrev, -0.3, 0.5) },
  gapX: { k: "gapX", w: 2, f: (r) => clip(r.gapX, -0.3, 0.6) },
};
// Three control designs: volatility + liquidity only; + momentum (deep-2 primary); + the entry-day gap.
export const CONTROL_SETS = {
  volOnly: [F.lvol20, F.ldv20],
  volMom: [F.r5, F.r20, F.dd60, F.lvol20, F.ldv20, F.gapPrev],
  volMomGap: [F.r5, F.r20, F.dd60, F.lvol20, F.ldv20, F.gapPrev, F.gapX],
};
export function robustScales(rows, feats) {
  const out = {};
  for (const Fe of feats) {
    const xs = rows.map(Fe.f).filter((v) => v != null && Number.isFinite(v)).sort((a, b) => a - b);
    const q = (p) => xs[Math.floor(p * (xs.length - 1))];
    out[Fe.k] = Math.max(1e-6, (q(0.75) - q(0.25)) / 1.349);
  }
  return out;
}
export function indexPool(rows) { const byMT = new Map(); for (const r of rows) { const a = `${r.m}|${r.tier}`; (byMT.get(a) || byMT.set(a, []).get(a)).push(r); } return byMT; }
export function prepareVectors(rows, feats, key) { for (const r of rows) { const v = new Float64Array(feats.length); for (let q = 0; q < feats.length; q++) { const x = feats[q].f(r); v[q] = x == null ? NaN : x; } r[key] = v; } }
// K nearest pool stock-days (at most one per symbol) in the event's month × liquidity tier and period.
export function nearest(ev, byMT, scales, nSyms, { K = 10, feats, key }) {
  const cand = byMT.get(`${ev.m}|${ev.tier}`); if (!cand) return [];
  const ef = feats.map((Fe) => Fe.f(ev)); if (ef.some((v) => v == null)) return [];
  const w = feats.map((Fe) => Fe.w / scales[Fe.k] ** 2);
  const best = new Float64Array(nSyms).fill(Infinity), bestRow = new Array(nSyms);
  for (const r of cand) {
    if (r.per !== ev.per) continue;
    const v = r[key]; let d2 = 0;
    for (let q = 0; q < v.length; q++) { const dz = v[q] - ef[q]; d2 += w[q] * dz * dz; }
    if (!(d2 < best[r.si])) continue;
    best[r.si] = d2; bestRow[r.si] = r;
  }
  const picks = []; for (let si = 0; si < nSyms; si++) if (best[si] < Infinity) picks.push([best[si], bestRow[si]]);
  picks.sort((x, y) => x[0] - y[0]);
  return picks.slice(0, K).map(([d2, r]) => ({ r, dist: Math.sqrt(d2) }));
}

// ---------------- execution helpers (copied from deep2/execution/execLib.mjs) ----------------
// As-traded adjustment: f = adjusted close on the trade date ÷ reported price; outside [0.55, 1.8] → split inferred.
export function adjFactorOf(ser, tradeDate, price) {
  if (!ser || !(price > 0)) return { f: 1, inferred: false };
  let i = ser.idx.get(tradeDate); if (i == null) i = L.idxBefore(ser, tradeDate);
  if (i < 0) return { f: 1, inferred: false };
  const ratio = ser.arr[i].c / price;
  return ratio > 1.8 || ratio < 0.55 ? { f: ratio, inferred: true } : { f: 1, inferred: false };
}
// ADV over the 20 calendar sessions strictly before `j` (missing bar = 0 volume).
export function adv20Before(ser, cal, j) { let sum = 0; for (let q = j - 20; q < j; q++) { if (q < 0) continue; const k = ser.idx.get(cal.days[q]); if (k != null) sum += ser.arr[k].c * ser.arr[k].v; } return sum / 20; }
