// deep3/targets/common.mjs — helpers for the deep-3 "targets" agent (touch / time-to-target / pattern discovery).
// Copied from deep2/chart/common.mjs (matched controls; conventions unchanged) and extended with daily-path outcomes
// (touches of the daily HIGH, time to target, MFE/MAE, close exits, limit take-profit approximation).
// Research only. Cache only (lib2: loadBars / loadEvents / loadSecRows) — no network, no Alpaca / SEC calls.
// Writes only under .cache/research/deep3/targets/ plus the deep-3 registry files (append-only).
//
// Conventions (identical for insider events and control stock-days):
//   decision bar = the symbol's last daily bar strictly before the entry session (features use bars 0..decision only)
//   entry        = official OPEN of the entry session (events: first session >= acceptance + 60 s, stage C)
//   session t    = t-th SPY session after the entry session (t = 0 is the entry session itself)
//   touch X by N = max(high_0..high_N) >= entry * (1 + X)        (daily bars are regular-session only — see
//                  check-ext-hours.json — so the entry-day high is printed at or after the official open)
//   close exit N = close of session N, net of costBps per side, minus SPY (SPY open of session 0 -> SPY close N)
//   limit TP     = APPROXIMATION (BRIEF): sell limit at entry*(1+X) filled at max(open, target) on the first session
//                  whose high >= target*1.005; optional stop at entry*(1-S) filled at min(open, stop); when target and
//                  stop are both breached in one session the STOP is assumed first (worst case); else close of N.
//   embargo      = a session on/after the event's period end is never read (outcome = null when the window is cut).
import fs from "node:fs";
import path from "node:path";
import { loadBars, loadEvents, loadSecRows, periodOf, DISCOVER_END, HOLDOUT_START, DEEP1, DEEP2, mean, median, r4, companyStats, bhQ, wmean, pValue, clusteredT, idxBefore } from "../../deep2/lib2.mjs";
import { closeTime, isSession } from "../../../../services/backtest/sessionCalendar.js";

export { loadBars, loadEvents, loadSecRows, periodOf, DISCOVER_END, HOLDOUT_START, DEEP1, DEEP2, mean, median, r4, companyStats, bhQ, wmean, pValue, clusteredT, idxBefore, closeTime, isSession };
export const AGENT = "targets";
export const DEEP3 = path.join(DEEP2, "..", "deep3");
export const OUT = path.join(DEEP3, "targets");
fs.mkdirSync(OUT, { recursive: true });
export const STORE_START = "2025-12-01"; // first day of the SEC Form 4 store (history is left-censored before this)
export const sym = (t) => String(t || "").trim().toUpperCase().replace(/-/g, ".");
// Copied from ../../lib.mjs (costBpsFor): per-side cost by 20-session average dollar volume.
export function costBpsFor(dv) { if (!(dv > 0)) return 100; if (dv >= 50e6) return 5; if (dv >= 5e6) return 15; if (dv >= 1e6) return 35; return 75; }
export const tierOf = (dv) => { const b = costBpsFor(dv); return b >= 75 ? 75 : b; };
export const TIER_LABEL = { 75: "<$1M", 35: "$1-5M", 15: "$5-50M", 5: ">=$50M" };
export const clip = (x, lo, hi) => (x == null || !Number.isFinite(x) ? null : Math.min(hi, Math.max(lo, x)));
export const sd = (xs) => { if (xs.length < 3) return null; const m = mean(xs); return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1)); };
export const pct = (v, d = 2) => (v == null || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(d)}%`);
export const periodEnd = (per) => (per === "discover" ? DISCOVER_END : HOLDOUT_START);
const DAY = 86_400_000;
export const dnum = (d) => Math.floor(Date.parse(`${String(d).slice(0, 10)}T00:00:00Z`) / DAY);
export const addDays = (d, n) => new Date((dnum(d) + n) * DAY).toISOString().slice(0, 10);

// ---------------- deep-3 registry (copied from lib2.registerHypothesis / recordResult, pointed at deep3) ----------------
export const REG_FILE = path.join(DEEP3, "registry.jsonl");
export const RES_FILE = path.join(DEEP3, "registry-results.jsonl");
export function registerHypothesis(h) {
  const need = ["agent", "id", "family", "familySize", "statement", "rationale"];
  for (const k of need) if (h[k] == null) throw new Error(`registerHypothesis: missing ${k}`);
  fs.appendFileSync(REG_FILE, JSON.stringify({ ...h, registeredAt: new Date().toISOString() }) + "\n");
}
export function recordResult(id, agent, result) {
  const reg = fs.existsSync(REG_FILE) ? fs.readFileSync(REG_FILE, "utf8") : "";
  if (!reg.includes(`"id":${JSON.stringify(id)}`)) throw new Error(`recordResult: ${id} was not registered first`);
  fs.appendFileSync(RES_FILE, JSON.stringify({ id, agent, result, at: new Date().toISOString() }) + "\n");
}
const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : []);
export const myRegistry = () => readJsonl(REG_FILE).filter((h) => h.agent === AGENT);
export const myResults = () => readJsonl(RES_FILE).filter((h) => h.agent === AGENT);
let _regIds = null;
// Register once (idempotent across re-runs: the first registration time is the one that counts).
export function reg(h) {
  if (!String(h.id).startsWith(`${AGENT}-`)) throw new Error(`id must start with ${AGENT}-`);
  if (!_regIds) _regIds = new Set(myRegistry().map((x) => x.id));
  if (_regIds.has(h.id)) return false;
  registerHypothesis({ agent: AGENT, preRegistered: true, ...h });
  _regIds.add(h.id);
  return true;
}
export const isRegistered = (id) => { if (!_regIds) _regIds = new Set(myRegistry().map((x) => x.id)); return _regIds.has(id); };
// Record a result; a re-run that reproduces the latest recorded result for this id exactly is not appended again.
let _latest = null;
export function rec(id, result) {
  if (!_latest) { _latest = new Map(); for (const x of myResults()) _latest.set(x.id, JSON.stringify(x.result)); }
  const s = JSON.stringify(JSON.parse(JSON.stringify(result)));
  if (_latest.get(id) === s) return false;
  recordResult(id, AGENT, result); _latest.set(id, s); return true;
}

// ---------------- calendar (SPY sessions) ----------------
export function calendar(bars) {
  const spy = bars.get("SPY"); const days = spy.arr.map((b) => b.d); const idx = new Map(days.map((d, i) => [d, i]));
  const above50 = new Map(); let s = 0;
  for (let i = 0; i < spy.arr.length; i++) { s += spy.arr[i].c; if (i >= 50) s -= spy.arr[i - 50].c; if (i >= 49) above50.set(days[i], spy.arr[i].c > s / 50); }
  const firstOnOrAfter = (d) => { let lo = 0, hi = days.length - 1, ans = days.length; while (lo <= hi) { const m = (lo + hi) >> 1; if (days[m] >= d) { ans = m; hi = m - 1; } else lo = m + 1; } return ans; };
  return { spy, days, idx, above50, firstOnOrAfter };
}

// ---------------- chart features at decision bar i (bars 0..i only) ----------------
// deep2/chart featuresAt + vol60, vol20/vol60, rs20 vs SPY (same dates), distance to the prior 60-session high,
// and the most recent confirmed pivot low (a low that is the minimum of its ±5-session window, at least 5 sessions old).
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
  const v60 = avgV(i - 59, i), vDry = avgV(i - 20, i - 6), vSpike = avgV(i - 2, i), vBase = avgV(i - 22, i - 3);
  const sma = (len) => { if (i + 1 < len) return null; let t = 0; for (let k = i - len + 1; k <= i; k++) t += a[k].c; return t / len; };
  const sma50 = sma(50);
  let hi20p = -Infinity; for (let k = Math.max(0, i - 20); k < i; k++) hi20p = Math.max(hi20p, a[k].h);
  let hi60p = -Infinity; for (let k = Math.max(0, i - 60); k < i; k++) hi60p = Math.max(hi60p, a[k].h);
  let lo20 = Infinity, hi20 = -Infinity; for (let k = Math.max(0, i - 19); k <= i; k++) { lo20 = Math.min(lo20, a[k].l); hi20 = Math.max(hi20, a[k].h); }
  let downRun = 0; for (let k = i; k >= 1 && a[k].c < a[k - 1].c; k--) downRun++;
  const range20 = lo20 > 0 ? hi20 / lo20 - 1 : null;
  // SPY over the same dates as the stock's 20-session return
  const S = cal.spy.arr; const jd = cal.idx.get(a[i].d); let spyR20 = null;
  if (jd != null && i - 20 >= 0) { const j20 = cal.idx.get(a[i - 20].d); if (j20 != null && S[j20].c > 0) spyR20 = S[jd].c / S[j20].c - 1; }
  const r20 = ret(20);
  // most recent confirmed pivot low within the last 60 sessions
  let pivotK = -1, pivotLow = null;
  for (let k = i - 5; k >= Math.max(5, i - 59); k--) {
    const lk = a[k].l; if (!(lk > 0)) continue; let ok = true;
    for (let q = k - 5; q <= k + 5; q++) if (q !== k && a[q].l < lk) { ok = false; break; }
    if (ok) { pivotK = k; pivotLow = lk; break; }
  }
  return {
    nHist: i + 1, decDate: a[i].d, price: last,
    r1: ret(1), r5: ret(5), r20, r60: i >= 60 ? ret(60) : null, rs20: r20 != null && spyR20 != null ? r20 - spyR20 : null,
    dd60: last / hiC - 1, pos60: hiC > loC ? (last - loC) / (hiC - loC) : null, nearLow60: last <= loL * 1.05,
    vol20, vol60, vol10_60: vol10 && vol60 ? vol10 / vol60 : null, vr20_60: vol20 && vol60 ? vol20 / vol60 : null, dv20,
    gapPrev: a[i - 1].c > 0 ? a[i].o / a[i - 1].c - 1 : null,
    sma50r: sma50 ? last / sma50 - 1 : null, range20, tight: range20 != null && vol60 ? range20 / (vol60 * Math.sqrt(20)) : null,
    breakout20: last > hi20p, breakout60: i >= 60 ? last > hi60p : null, hi60r: i >= 60 && hi60p > 0 ? last / hi60p - 1 : null,
    volDry: v60 > 0 && vDry != null ? vDry / v60 : null, volSpike: vBase > 0 && vSpike != null ? vSpike / vBase : null,
    downRun, spyAbove50: cal.above50.has(a[i].d) ? cal.above50.get(a[i].d) : null,
    pivotAbove: pivotLow ? last / pivotLow - 1 : null, pivotAge: pivotK >= 0 ? i - pivotK : null,
    nearPivot: pivotLow != null && last >= pivotLow && last <= pivotLow * 1.05,
  };
}

// ---------------- daily path from entry bar k (sessions 0..maxN, never past perEnd) ----------------
export function pathAt(s, k, cal, { maxN = 10, perEnd = null } = {}) {
  const a = s.arr, eb = a[k];
  if (!eb || !(eb.o > 0)) return null;
  const j = cal.idx.get(eb.d); if (j == null) return null;
  const S = cal.spy.arr, P0 = eb.o, spy0 = S[j].o;
  const p = { j, k, entryDate: eb.d, P0, d: [], o: [], h: [], l: [], c: [], v: [], spy: [] };
  for (let t = 0; t <= maxN; t++) {
    const d = cal.days[j + t]; if (!d) break; if (perEnd && d >= perEnd) break;
    const xi = s.idx.get(d), b = xi == null ? null : a[xi];
    p.d.push(d); p.spy.push(S[j + t].c / spy0);
    if (b && b.o > 0 && b.h > 0 && b.l > 0 && b.c > 0) { p.o.push(t === 0 ? 1 : b.o / P0); p.h.push(b.h / P0); p.l.push(b.l / P0); p.c.push(b.c / P0); p.v.push(b.v); }
    else { p.o.push(null); p.h.push(null); p.l.push(null); p.c.push(null); p.v.push(0); }
  }
  p.last = p.d.length - 1;
  return p;
}

export const TARGETS = [5, 10, 15, 20];          // percent
export const HORIZONS = [1, 2, 3, 5, 10];        // sessions after the entry session
export const STOPS = [0, 5, 10];                 // percent; 0 = no stop
export const TP_N = [5, 10];
export const MAE_LEVELS = [5, 10, 20];
export const TP_BUFFER = 0.005;

// Limit take-profit / stop / time exit on a daily path (approximation; see header). Returns { t, px, why } or null.
export function tpExit(p, X, S, N) {
  if (!p || p.last < N) return null;
  const tgt = 1 + X / 100, sp = S ? 1 - S / 100 : null;
  for (let t = 0; t <= N; t++) {
    if (p.h[t] == null) continue; // no bar (no trading) that session
    const op = p.o[t];
    if (sp != null && p.l[t] <= sp) return { t, px: Math.min(op, sp), why: "stop" };
    if (p.h[t] >= tgt * (1 + TP_BUFFER)) return { t, px: Math.max(op, tgt), why: "tp" };
  }
  if (p.c[N] == null) return null;
  return { t: N, px: p.c[N], why: "time" };
}

// All outcomes of one path at a per-side cost (bps). Touches/MFE/MAE do not depend on the cost.
export function outcomesOf(p, costBps, { tp = true } = {}) {
  if (!p) return null;
  const c = costBps / 1e4;
  const o = { last: p.last };
  for (const N of HORIZONS) {
    if (p.last < N || p.c[N] == null) { o[`x${N}`] = null; o[`xg${N}`] = null; o[`ret${N}`] = null; continue; }
    const net = (p.c[N] * (1 - c)) / (1 + c) - 1, spyR = p.spy[N] - 1;
    o[`x${N}`] = net - spyR; o[`xg${N}`] = p.c[N] - 1 - spyR; o[`ret${N}`] = net;
  }
  for (const X of TARGETS) {
    let t0 = null;
    for (let t = 0; t <= Math.min(10, p.last); t++) if (p.h[t] != null && p.h[t] >= 1 + X / 100) { t0 = t; break; }
    o[`ttt${X}`] = t0; // null = not touched within the available window (censored when last < 10)
    for (const N of HORIZONS) o[`hit${X}_${N}`] = p.last < N ? null : t0 != null && t0 <= N ? 1 : 0;
    if (t0 != null) {
      let mb = 1; for (let t = 0; t < t0; t++) if (p.l[t] != null) mb = Math.min(mb, p.l[t]);
      o[`maeB${X}`] = mb - 1; o[`maeBI${X}`] = Math.min(mb, p.l[t0]) - 1; // strictly before / including the touch session
    } else { o[`maeB${X}`] = null; o[`maeBI${X}`] = null; }
  }
  let mx = -Infinity, mn = Infinity, tMax = null;
  for (let t = 0; t <= Math.min(10, p.last); t++) {
    if (p.h[t] != null) { if (p.h[t] > mx) { mx = p.h[t]; tMax = t; } mn = Math.min(mn, p.l[t]); }
    if (HORIZONS.includes(t)) { o[`mfe${t}`] = mx > -Infinity ? mx - 1 : null; o[`mae${t}`] = mn < Infinity ? mn - 1 : null; }
  }
  for (const N of HORIZONS) if (p.last < N) { o[`mfe${N}`] = null; o[`mae${N}`] = null; }
  for (const N of HORIZONS) for (const L of MAE_LEVELS) o[`dd${L}_${N}`] = o[`mae${N}`] == null ? null : o[`mae${N}`] <= -L / 100 ? 1 : 0;
  o.tMax10 = p.last >= 10 ? tMax : null;
  if (tp) for (const X of TARGETS) for (const S of STOPS) for (const N of TP_N) {
    const ex = tpExit(p, X, S, N); const k = `tp${X}s${S}n${N}`;
    if (!ex) { o[k] = null; continue; }
    const net = (ex.px * (1 - c)) / (1 + c) - 1, spyR = p.spy[ex.t] - 1;
    o[k] = net - spyR; o[`${k}_t`] = ex.t; o[`${k}_why`] = ex.why; o[`${k}_ret`] = net;
  }
  return o;
}

// ---------------- insider purchase marks (code-P filings accepted before the holdout) ----------------
// For each symbol: Uint8Array over the session calendar, 1 = within the exclusion window of a P filing.
// A filing marks its acceptance session (first session on/after the acceptance date), the next session, and the
// trade-date session. Control day j is excluded if a mark lies in [j - before, j + after]. Unlike deep2/chart, filings
// accepted on/after 2026-09-01 are ignored entirely (strict holdout hygiene).
export async function purchaseBlocks(cal, { before = 20, after = 20 } = {}) {
  const sec = await loadSecRows();
  const cik2sym = new Map();
  for (const r of sec.rows) if (r.ticker && r.cik && !cik2sym.has(r.cik)) cik2sym.set(r.cik, sym(r.ticker));
  const marks = new Map();
  for (const r of sec.rows) {
    if (r.code !== "P") continue;
    if (!(String(r.acceptedAt || "") < HOLDOUT_START)) continue;
    const s = r.ticker ? sym(r.ticker) : cik2sym.get(r.cik); if (!s) continue;
    const m = marks.get(s) || marks.set(s, new Set()).get(s);
    const ad = String(r.acceptedAt || "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(ad)) { const j = cal.firstOnOrAfter(ad); m.add(j); m.add(j + 1); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(r.tradeDate || "")) m.add(cal.firstOnOrAfter(r.tradeDate));
  }
  const L = cal.days.length;
  const blocked = new Map();
  for (const [s, set] of marks) { const b = new Uint8Array(L); for (const m of set) for (let j = Math.max(0, m - after); j <= Math.min(L - 1, m + before); j++) b[j] = 1; blocked.set(s, b); }
  return { blocked, marks, cik2sym };
}

// ---------------- control pool: every (symbol, session) with no P filing nearby ----------------
export const POOL_FIELDS = ["r1", "r5", "r20", "r60", "rs20", "dd60", "pos60", "vol20", "vol60", "vr20_60", "vol10_60", "dv20", "gapPrev", "sma50r", "range20", "tight", "hi60r", "volDry", "volSpike", "pivotAbove", "price"];
export const POOL_FLAGS = ["nearLow60", "breakout20", "breakout60", "nearPivot", "spyAbove50"];
export function buildPool(bars, cal, blocks, { from = "2025-12-01", to = HOLDOUT_START } = {}) {
  const syms = [...bars.keys()].filter((s) => s !== "SPY" && s !== "IWM" && bars.get(s).arr.length > 30);
  const rows = [];
  syms.forEach((s, si) => {
    const ser = bars.get(s), a = ser.arr, blk = blocks.get(s);
    for (let k = 26; k < a.length; k++) {
      const D = a[k].d; if (D < from || D >= to) continue;
      const j = cal.idx.get(D); if (j == null) continue;
      if (blk && blk[j]) continue;
      const per = D < DISCOVER_END ? "discover" : "confirm";
      const x5 = cal.days[j + 5]; if (!x5 || x5 >= periodEnd(per)) continue;
      const f = featuresAt(ser, k - 1, cal); if (!f || !(a[k].o > 0)) continue;
      const jd = cal.idx.get(a[k - 1].d); if (jd == null) continue;
      const S = cal.spy.arr;
      const gapX = (a[k].o / a[k - 1].c - 1) - (S[j].o / S[jd].c - 1);
      const row = { si, s, k, j, D, m: D.slice(0, 7), per, tier: tierOf(f.dv20), gapX };
      for (const F of POOL_FIELDS) row[F] = f[F];
      for (const F of POOL_FLAGS) row[F] = f[F];
      rows.push(row);
    }
  });
  return { rows, syms };
}

// ---------------- matching (deep2/chart, unchanged) ----------------
export const MATCH_FEATURES = [
  { k: "r5", w: 1, f: (r) => clip(r.r5, -0.5, 1.0) },
  { k: "r20", w: 1, f: (r) => clip(r.r20, -0.7, 2.0) },
  { k: "dd60", w: 1, f: (r) => clip(r.dd60, -1, 0) },
  { k: "lvol20", w: 1, f: (r) => (r.vol20 > 0 ? Math.log(Math.max(r.vol20, 1e-3)) : null) },
  { k: "ldv20", w: 1, f: (r) => (r.dv20 > 0 ? Math.log(Math.max(r.dv20, 1e3)) : null) },
  { k: "gapPrev", w: 0.5, f: (r) => clip(r.gapPrev, -0.3, 0.5) },
];
export const GAP_FEATURE = { k: "gapX", w: 2, f: (r) => clip(r.gapX, -0.3, 0.6) };
export function robustScales(rows, feats) {
  const out = {};
  for (const F of feats) {
    const xs = rows.map(F.f).filter((v) => v != null && Number.isFinite(v)).sort((a, b) => a - b);
    const q = (p) => xs[Math.floor(p * (xs.length - 1))];
    out[F.k] = Math.max(1e-6, (q(0.75) - q(0.25)) / 1.349);
  }
  return out;
}
export function indexPool(rows) {
  const byMT = new Map();
  for (const r of rows) { const a = `${r.m}|${r.tier}`; (byMT.get(a) || byMT.set(a, []).get(a)).push(r); }
  return { byMT };
}
export function prepareVectors(rows, feats, key) {
  for (const r of rows) { const v = new Float64Array(feats.length); for (let q = 0; q < feats.length; q++) { const x = feats[q].f(r); v[q] = x == null ? NaN : x; } r[key] = v; }
}
// K nearest controls for one event row (at most one stock-day per symbol), same month x tier x period.
export function nearest(ev, idx, scales, nSyms, { K = 10, feats = MATCH_FEATURES, key = "fv", filter = null } = {}) {
  const cand = idx.byMT.get(`${ev.m}|${ev.tier}`);
  if (!cand) return [];
  const ef = feats.map((F) => F.f(ev));
  if (ef.some((v) => v == null)) return [];
  const w = feats.map((F) => F.w / scales[F.k] ** 2);
  const best = new Float64Array(nSyms).fill(Infinity), bestRow = new Array(nSyms);
  for (const r of cand) {
    if (r.per !== ev.per) continue;
    if (filter && !filter(r)) continue;
    const v = r[key]; let d2 = 0;
    for (let q = 0; q < v.length; q++) { const dz = v[q] - ef[q]; d2 += w[q] * dz * dz; }
    if (!(d2 < best[r.si])) continue; // NaN-safe
    best[r.si] = d2; bestRow[r.si] = r;
  }
  const picks = [];
  for (let si = 0; si < nSyms; si++) if (best[si] < Infinity) picks.push([best[si], bestRow[si]]);
  picks.sort((x, y) => x[0] - y[0]);
  return picks.slice(0, K).map(([d2, r]) => ({ r, dist: Math.sqrt(d2) }));
}

// ---------------- publication-time bucket (ET) ----------------
export function pubBucket(publishedAt) {
  const d = publishedAt.slice(0, 10), t = publishedAt.slice(11, 19);
  if (!isSession(d)) return "overnight"; // weekend / holiday filings: first chance is the next session's open
  if (t < "04:00:00") return "overnight";
  if (t < "09:30:00") return "premarket";
  if (t < closeTime(d)) return "regular";
  if (t < "20:00:00") return "afterClose";
  return "overnight";
}

// ---------------- statistics helpers ----------------
// rows [{issuer, x}] → companyStats + simple shares. Deterministic.
export const cstats = (rows, opt) => companyStats(rows.filter((r) => r.x != null && Number.isFinite(r.x)), opt);
// OLS x = a + b·z, issuer-clustered SE (copied from deep2/behavior/common.mjs). rows: [{ issuer, x, z }]
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
  const kf = (G / (G - 1)) * ((n - 1) / (n - 2));
  const M = [[m00, m01], [m01, m11]];
  const IM = [[inv[0][0] * M[0][0] + inv[0][1] * M[1][0], inv[0][0] * M[0][1] + inv[0][1] * M[1][1]], [inv[1][0] * M[0][0] + inv[1][1] * M[1][0], inv[1][0] * M[0][1] + inv[1][1] * M[1][1]]];
  const v11 = kf * (IM[1][0] * inv[0][1] + IM[1][1] * inv[1][1]);
  const t = v11 > 0 ? b / Math.sqrt(v11) : null;
  return { n, issuers: G, a: r4(a), b: r4(b), t: t == null ? null : Math.round(t * 100) / 100, p: t == null ? null : pValue(t) };
}
export function diffTest(A, B) {
  const rows = [...A.map((r) => ({ issuer: r.issuer, x: r.x, z: 1 })), ...B.map((r) => ({ issuer: r.issuer, x: r.x, z: 0 }))].filter((r) => r.x != null && Number.isFinite(r.x));
  const o = clusteredOLS(rows); if (!o) return null;
  return { nA: A.length, nB: B.length, meanA: r4(mean(A.map((r) => r.x).filter(Number.isFinite))), meanB: r4(mean(B.map((r) => r.x).filter(Number.isFinite))), diff: o.b, t: o.t, p: o.p };
}
export const quant = (xs, p) => { const s = xs.filter((v) => v != null && Number.isFinite(v)).sort((a, b) => a - b); return s.length ? s[Math.floor(p * (s.length - 1))] : null; };

// ---------------- output helpers ----------------
export function toCsv(rows, cols) {
  const esc = (v) => (v == null ? "" : typeof v === "number" ? String(Number.isInteger(v) ? v : Math.round(v * 1e6) / 1e6) : typeof v === "boolean" ? (v ? "1" : "0") : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}
export const writeOut = (name, data) => { const f = path.join(OUT, name); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof data === "string" ? data : JSON.stringify(data, null, 1)); return f; };
export const readOut = (name) => JSON.parse(fs.readFileSync(path.join(OUT, name), "utf8"));
export const existsOut = (name) => fs.existsSync(path.join(OUT, name));
export function checkpoint(step, info) {
  const f = path.join(OUT, "progress.json");
  let p = { agent: AGENT, steps: [] }; try { p = JSON.parse(fs.readFileSync(f, "utf8")); } catch { /* new */ }
  p.updatedAt = new Date().toISOString();
  p.steps = (p.steps || []).filter((s) => s.step !== step); p.steps.push({ step, status: "done", at: p.updatedAt, ...info });
  fs.writeFileSync(f, JSON.stringify(p, null, 1));
}
export const smd = (a, b) => { const ma = mean(a), mb = mean(b), va = sd(a) ** 2, vb = sd(b) ** 2; const den = Math.sqrt((va + vb) / 2); return den > 0 ? (ma - mb) / den : null; };
