// deep4/panel/panelLib.mjs — shared point-in-time building blocks for the deep-4 panel (agent "panel").
// Research only. Cache only (no network, no Alpaca / SEC / Mongo). Reuses deep-2/3 code by importing it.
//
// Conventions (identical for insider events and control stock-days):
//   calendar      = SPY daily-bar sessions (== app session calendar; every cached bar sits on a SPY session; verified)
//   decision t    = SEC acceptance (ET wall clock) + 60 s
//   entry session = first session whose 09:28 ET MOO cut-off is >= t (deep-2 execLib.entryOf with mooCutoff 09:28)
//   decision bar  = the symbol's last bar strictly before the entry date (session jDec = jEntry - 1; the bar may be stale)
//   features      = bars with session index <= jDec only (session windows mapped to bar ranges; a missing bar = no trade)
//   outcome B     = official open of the entry session -> official close of the exit session (split-adjusted bars)
//                   calendar horizon D: exit session = last session <= entryDate + D calendar days
//                   session horizon N: exit session = N-th session after the entry session
//   outcome A     = insider's reported price (split-adjusted with the execLib.adjFactor rule) on the trade date -> later closes
//   costs         = liquidity tier from 20-session dollar volume before entry (lib.costBpsFor: 5/15/35/75/100 bps per side)
//   net           = exit*(1-c) / (entry*(1+c)) - 1 (execLib.netOf); excess = minus SPY over the same fills (SPY never charged)
//   embargo       = with a price cutoff (design build: 2026-06-15) no session on/after the cutoff is ever read; an outcome
//                   that needs one gets status "embargo" (values null) but keeps its scheduled end date
//   censoring     = an exit session after the last complete cached session (2026-11-03) -> status "censored"
import fs from "node:fs";
import path from "node:path";
import * as L4 from "../../../lib4.mjs";
import { costBpsFor, etParts, isSession, nextSession, previousSession, sessionAfter } from "../../../../lib.mjs";
import { etToUtcIso } from "../../../../../../services/backtest/publicationStart.js";
import { closeTime } from "../../../../../../services/backtest/sessionCalendar.js";
import { COMPLETE_THROUGH, symOf, netOf } from "../../../../deep2/execution/execLib.mjs";
import { tierOf, MATCH_FEATURES, robustScales, prepareVectors, indexPool, nearest } from "../../../../deep2/chart/common.mjs";

export { L4, COMPLETE_THROUGH, symOf, netOf, costBpsFor, tierOf, isSession, nextSession, previousSession, sessionAfter, closeTime };
export { MATCH_FEATURES, robustScales, prepareVectors, indexPool, nearest };

export const AGENT = "panel";
export const OUT = process.env.AUDIT_PANEL_OUT ? path.resolve(process.env.AUDIT_PANEL_OUT) : path.join(L4.DEEP4, "audit", "exposed", "panel"); // AUDIT COPY (T2)
fs.mkdirSync(OUT, { recursive: true });
export const STORE_START = "2025-12-01"; // first day of the SEC Form 4 store: insider history before it is unknown (left-censored)
export const CAL_H = [5, 10, 20, 30]; // calendar-day horizons
export const SESS_N = [1, 3, 5, 10]; // session exits (continuity with deep 2/3)
export const TARGETS = [5, 10, 15, 20, 30]; // touch targets, percent
export const LIMIT_X = 10; // limit take-profit approximation target, percent
export const FILL_BUFFER = 0.005; // deep 3: limit filled only if high >= target * 1.005
export const MOO_CUTOFF = "09:28:00";
export const LATENCY_SECONDS = 60;
export const MIN_HIST_BARS = 26; // deep-2 featuresAt needs >= 26 bars (decision bar index >= 25) for chart features / matching

// ---------------- small utils ----------------
const DAYMS = 86_400_000;
export const day = (s) => String(s).slice(0, 10);
export const dnum = (d) => Math.floor(Date.parse(`${day(d)}T00:00:00Z`) / DAYMS);
export const addDays = (d, n) => new Date((dnum(d) + n) * DAYMS).toISOString().slice(0, 10);
export const daysBetween = (a, b) => dnum(b) - dnum(a);
export const sessionOnOrBefore = (d) => (isSession(d) ? d : previousSession(d));
// storage rounding: 6 decimals for |x| >= 1, 7 significant digits below 1 (keeps sub-penny prices / tiny factors precise)
export const r6 = (x) => (typeof x === "number" ? (Number.isFinite(x) ? (Math.abs(x) >= 1 ? Math.round(x * 1e6) / 1e6 : Number(x.toPrecision(7))) : null) : x);
export const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
export const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export const quantile = (xs, p) => { const s = xs.filter((v) => v != null && Number.isFinite(v)).sort((a, b) => a - b); if (!s.length) return null; const i = p * (s.length - 1), lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
export const sd = (xs) => { if (xs.length < 3) return null; const m = mean(xs); return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1)); };
export const cnt = (arr, f) => arr.reduce((m, x) => { const k = String(f(x)); m[k] = (m[k] || 0) + 1; return m; }, {});
export const group = (arr, f) => { const m = new Map(); for (const x of arr) { const k = f(x); (m.get(k) || m.set(k, []).get(k)).push(x); } return m; };
export function roundRow(o) { const out = {}; for (const [k, v] of Object.entries(o)) out[k] = r6(v); return out; }
export function toCsv(rows, cols) {
  const esc = (v) => (v == null ? "" : typeof v === "number" ? (Number.isFinite(v) ? String(Number.isInteger(v) ? v : Math.round(v * 1e6) / 1e6) : "") : typeof v === "boolean" ? (v ? "1" : "0") : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}
export const writeOut = (name, data) => { const f = path.join(OUT, name); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof data === "string" ? data : JSON.stringify(data)); return f; };
export const writePretty = (name, data) => writeOut(name, JSON.stringify(data, null, 1));
export const readOut = (name) => JSON.parse(fs.readFileSync(path.join(OUT, name), "utf8"));
export const existsOut = (name) => fs.existsSync(path.join(OUT, name));
export function checkpoint(step, info = {}) {
  const f = path.join(OUT, "progress.json");
  let p = { agent: AGENT, steps: [] }; try { p = JSON.parse(fs.readFileSync(f, "utf8")); } catch { /* new */ }
  p.updatedAt = new Date().toISOString();
  p.steps = (p.steps || []).filter((s) => s.step !== step); p.steps.push({ step, status: "done", at: p.updatedAt, ...info });
  fs.writeFileSync(f, JSON.stringify(p, null, 1));
}

// ---------------- time: decision and entry ----------------
// t = acceptance (ET wall clock "YYYY-MM-DD HH:MM:SS") + latency, DST-aware. Returns { at, date, time } in ET.
export function decisionOf(publishedAt, latencySeconds = LATENCY_SECONDS) {
  const iso = etToUtcIso(`${publishedAt} ET`);
  if (!iso) return null;
  const { date, time } = etParts(new Date(Date.parse(iso) + latencySeconds * 1000).toISOString());
  return { at: `${date} ${time}`, date, time };
}
// First session whose MOO cut-off (09:28 ET) is at or after t (= execLib.entryOf(..., { mooCutoff: "09:28:00" })).
export function entryDateOf(publishedAt, { mooCutoff = MOO_CUTOFF, latencySeconds = LATENCY_SECONDS } = {}) {
  const t = decisionOf(publishedAt, latencySeconds);
  if (!t) return null;
  return isSession(t.date) && t.time <= mooCutoff ? t.date : nextSession(t.date);
}
// Publication window of an acceptance stamp (copied from deep3/dataquality/secAudit.mjs windowOf).
export function pubWindow(T) {
  const d = T.slice(0, 10), t = T.slice(11);
  if (!isSession(d)) return "non_session_day";
  if (t < "04:00:00") return "overnight_00_04";
  if (t < "09:30:00") return "premarket_04_0930";
  if (t < closeTime(d)) return "regular_session";
  if (t < "20:00:00") return "after_close_to_20";
  return "evening_20_24";
}
// "YYYY-MM-DD HH:MM:SS" shifted by n calendar days (wall clock; for "prior 30 days" windows).
export const shiftStamp = (T, n) => `${addDays(day(T), n)}${String(T).slice(10)}`;

// ---------------- market: calendar, session-aligned series, regime table ----------------
// cutoff: first date that may NOT be read (design build: L4.DESIGN_END). null = read through COMPLETE_THROUGH.
// bars: optional injected Map(symbol → { arr, idx }) (tests: perturbation of future bars); default = the cached split-adjusted bars.
export function createMarket({ cutoff = null, bars: injected = null } = {}) {
  const bars = injected || L4.loadBars();
  const spy = bars.get("SPY");
  const days = spy.arr.map((b) => b.d);
  const idx = new Map(days.map((d, i) => [d, i]));
  const nS = days.length;
  let jComplete = nS - 1; while (jComplete >= 0 && days[jComplete] > COMPLETE_THROUGH) jComplete--;
  let jMax = jComplete; if (cutoff) while (jMax >= 0 && days[jMax] >= cutoff) jMax--;
  const firstOnOrAfter = (d) => { let lo = 0, hi = nS - 1, ans = nS; while (lo <= hi) { const m = (lo + hi) >> 1; if (days[m] >= d) { ans = m; hi = m - 1; } else lo = m + 1; } return ans; };
  const lastOnOrBefore = (d) => firstOnOrAfter(addDays(d, 1)) - 1;
  const alignedMemo = new Map();
  function aligned(sym) {
    if (alignedMemo.has(sym)) return alignedMemo.get(sym);
    const ser = bars.get(sym);
    if (!ser || !ser.arr.length) { alignedMemo.set(sym, null); return null; }
    const arr = ser.arr, kAt = new Int32Array(nS).fill(-1), jOfBar = new Int32Array(arr.length);
    let k = -1;
    for (let j = 0; j < nS; j++) { while (k + 1 < arr.length && arr[k + 1].d <= days[j]) k++; kAt[j] = k; }
    for (let q = 0; q < arr.length; q++) { const j = idx.get(arr[q].d); jOfBar[q] = j == null ? -1 : j; }
    const A = { sym, arr, kAt, jOfBar, first: arr[0].d, last: arr.at(-1).d, firstJ: jOfBar[0] };
    alignedMemo.set(sym, A);
    return A;
  }
  const M = { bars, spy, days, idx, nS, jComplete, jMax, cutoff, firstOnOrAfter, lastOnOrBefore, aligned };
  M.table = regimeTable(M);
  return M;
}
// Bar on session j? → bar index, or -1.
export const barOn = (A, j) => { if (!A || j == null || j < 0) return -1; const k = A.kAt[j]; return k >= 0 && A.jOfBar[k] === j ? k : -1; };

// Market regime per session j (bars on/before j only; sessions after jMax are never computed).
// breadth50[j] / breadth20[j] = share of cached symbols with a bar on j and >= 50 / 20 bars so far whose close > their 50 / 20-bar mean.
function regimeTable(M) {
  const { nS, jMax, days } = M;
  const e50 = new Float64Array(nS), a50 = new Float64Array(nS), e20 = new Float64Array(nS), a20 = new Float64Array(nS);
  for (const [s, ser] of M.bars) {
    if (s === "SPY" || s === "IWM") continue;
    const a = ser.arr; let s50 = 0, s20 = 0;
    for (let k = 0; k < a.length; k++) {
      s50 += a[k].c; if (k >= 50) s50 -= a[k - 50].c;
      s20 += a[k].c; if (k >= 20) s20 -= a[k - 20].c;
      const j = M.idx.get(a[k].d); if (j == null || j > jMax) continue;
      if (k >= 49) { e50[j]++; if (a[k].c > s50 / 50) a50[j]++; }
      if (k >= 19) { e20[j]++; if (a[k].c > s20 / 20) a20[j]++; }
    }
  }
  const S = M.spy.arr;
  const rows = [];
  for (let j = 0; j < nS; j++) {
    if (j > jMax) { rows.push(null); continue; }
    const c = S[j].c;
    const ret = (n) => (j - n >= 0 ? c / S[j - n].c - 1 : null);
    const lr = []; for (let k = Math.max(1, j - 19); k <= j; k++) lr.push(Math.log(S[k].c / S[k - 1].c));
    let hi = -Infinity; for (let k = Math.max(0, j - 59); k <= j; k++) hi = Math.max(hi, S[k].c);
    let s50 = null; if (j >= 49) { let t = 0; for (let k = j - 49; k <= j; k++) t += S[k].c; s50 = t / 50; }
    rows.push({ d: days[j], spyR5: ret(5), spyR20: ret(20), spyVol20: lr.length >= 10 ? sd(lr) : null, spyDd60: c / hi - 1, spyAbove50: s50 == null ? null : c > s50 ? 1 : 0,
      breadth50: e50[j] >= 100 ? a50[j] / e50[j] : null, breadth20: e20[j] >= 100 ? a20[j] / e20[j] : null, breadthN: e50[j] });
  }
  return rows;
}
// Regime label rule (declared before any outcome was computed): terciles of breadth50 over DESIGN sessions only
// (session dates < L4.DESIGN_END where breadth50 is defined). up = breadth >= upper tercile and SPY 20-session return > 0;
// down = breadth <= lower tercile and SPY 20-session return < 0; otherwise mixed. Null while breadth50 is undefined
// (needs 50 bars per symbol: bars start 2025-10-01, so the first ~2 weeks of December have no label).
export function regimeThresholds(M) {
  const xs = M.table.filter((r) => r && r.d < L4.DESIGN_END && r.breadth50 != null).map((r) => r.breadth50);
  return { b33: quantile(xs, 1 / 3), b67: quantile(xs, 2 / 3), nSessions: xs.length, firstDefined: M.table.find((r) => r && r.breadth50 != null)?.d ?? null,
    rule: "up: breadth50 >= b67 and spyR20 > 0; down: breadth50 <= b33 and spyR20 < 0; else mixed (terciles of breadth50 over design sessions)" };
}
export function regimeOf(row, th) {
  if (!row || row.breadth50 == null || row.spyR20 == null) return null;
  if (row.breadth50 >= th.b67 && row.spyR20 > 0) return "up";
  if (row.breadth50 <= th.b33 && row.spyR20 < 0) return "down";
  return "mixed";
}
export const REGIME_FIELDS = ["spyR5", "spyR20", "spyVol20", "spyDd60", "spyAbove50", "breadth50", "breadth20", "regime"];
export function regimeFeatures(M, th, jDec, prefix = "") {
  const r = jDec != null && jDec >= 0 && jDec <= M.jMax ? M.table[jDec] : null;
  const o = {};
  for (const k of REGIME_FIELDS) o[`${prefix}${k}`] = k === "regime" ? regimeOf(r, th) : r?.[k] ?? null;
  return o;
}

// ---------------- chart / market features at decision session jDec (bars on/before jDec only) ----------------
// Session windows: W sessions ending at jDec = bars with session index in (jDec - W, jDec]. Returns use the last bar on/before
// session jDec - N. Volatility = sd of log close-to-close returns of the window's bars (each return uses the preceding bar).
// Dollar volume = sum(close*volume) over the window's bars / min(W, sessions of history) (a missing bar counts as 0).
// Highs/lows for distances are CLOSING highs/lows (deep-2 dd60 convention).
export const MARKET_FIELDS = ["histBars", "histSessions", "decDate", "decStale", "featOk", "r1", "r5", "r10", "r20", "r60", "dHi30", "dLo30", "win30", "dHi60", "dLo60", "win60",
  "dHi252", "dLo252", "win252", "vol20", "vol60", "dv20", "costBps", "tier", "mdd60", "bo20", "gapPrev", "volSurge", "volSurge1", "sma50r", "decCloseAdj"];
export function marketFeatures(M, A, jDec, prefix = "") {
  if (!A || jDec == null || jDec < 0 || jDec > M.jMax) return null;
  const i = A.kAt[jDec];
  if (i < 0) return null;
  const a = A.arr, last = a[i].c;
  if (!(last > 0)) return null;
  const P = (k) => `${prefix}${k}`;
  const out = {};
  const histBars = i + 1, histSessions = jDec - A.firstJ + 1;
  const closeAtSess = (j) => { if (j < 0) return null; const k = A.kAt[j]; return k >= 0 && a[k].c > 0 ? a[k].c : null; };
  const ret = (n) => { if (jDec - n < A.firstJ) return null; const b = closeAtSess(jDec - n); return b == null ? null : last / b - 1; };
  const win = (W) => { const lo = jDec - W >= 0 ? A.kAt[jDec - W] + 1 : 0; return { lo: Math.max(0, lo), hi: i, sess: Math.min(W, histSessions) }; };
  const ext = (w) => { let hc = -Infinity, lc = Infinity; for (let k = w.lo; k <= w.hi; k++) { if (a[k].c > hc) hc = a[k].c; if (a[k].c < lc) lc = a[k].c; } return { hc, lc }; };
  const vol = (w) => { const xs = []; for (let k = Math.max(1, w.lo); k <= w.hi; k++) if (a[k].c > 0 && a[k - 1].c > 0) xs.push(Math.log(a[k].c / a[k - 1].c)); return sd(xs); };
  const w20 = win(20), w30 = win(30), w60 = win(60), w252 = win(252);
  const e20 = ext(w20), e30 = ext(w30), e60 = ext(w60), e252 = ext(w252);
  let dv = 0; for (let k = w20.lo; k <= w20.hi; k++) dv += a[k].c * a[k].v;
  const dv20 = dv / Math.max(1, w20.sess);
  let runMax = -Infinity, mdd = 0; for (let k = w60.lo; k <= w60.hi; k++) { runMax = Math.max(runMax, a[k].c); mdd = Math.min(mdd, a[k].c / runMax - 1); }
  const avgV = (from, to) => { if (to < 0) return null; let t = 0, m = 0; for (let k = Math.max(0, from); k <= to; k++) { t += a[k].v; m++; } return m ? t / m : null; };
  const vSpike = avgV(i - 2, i), vBase = avgV(i - 22, i - 3), vPrev20 = avgV(i - 20, i - 1);
  let sma50 = null; if (i >= 49) { let t = 0; for (let k = i - 49; k <= i; k++) t += a[k].c; sma50 = t / 50; }
  out[P("histBars")] = histBars; out[P("histSessions")] = histSessions; out[P("decDate")] = a[i].d; out[P("decStale")] = jDec - A.jOfBar[i];
  out[P("featOk")] = histBars >= MIN_HIST_BARS ? 1 : 0;
  out[P("r1")] = ret(1); out[P("r5")] = ret(5); out[P("r10")] = ret(10); out[P("r20")] = ret(20); out[P("r60")] = ret(60);
  out[P("dHi30")] = last / e30.hc - 1; out[P("dLo30")] = last / e30.lc - 1; out[P("win30")] = w30.sess;
  out[P("dHi60")] = last / e60.hc - 1; out[P("dLo60")] = last / e60.lc - 1; out[P("win60")] = w60.sess;
  out[P("dHi252")] = last / e252.hc - 1; out[P("dLo252")] = last / e252.lc - 1; out[P("win252")] = w252.sess;
  out[P("vol20")] = vol(w20); out[P("vol60")] = vol(w60);
  out[P("dv20")] = dv20; out[P("costBps")] = costBpsFor(dv20); out[P("tier")] = tierOf(dv20);
  out[P("mdd60")] = mdd;
  out[P("bo20")] = last >= e20.hc ? 1 : 0;
  out[P("gapPrev")] = i >= 1 && a[i - 1].c > 0 ? a[i].o / a[i - 1].c - 1 : null;
  out[P("volSurge")] = vBase > 0 && vSpike != null ? vSpike / vBase : null;
  out[P("volSurge1")] = vPrev20 > 0 ? a[i].v / vPrev20 : null;
  out[P("sma50r")] = sma50 ? last / sma50 - 1 : null;
  out[P("decCloseAdj")] = last; // split-adjusted LEVEL: NOT a feature (encodes later splits); for outcomes / checks only
  return out;
}
export const blankMarket = (prefix = "") => Object.fromEntries(MARKET_FIELDS.map((k) => [`${prefix}${k}`, null]));
// Gap at entry: entry open / decision close - 1, and minus SPY's gap over the same dates. Uses the ENTRY-SESSION OPEN: known only
// at the entry instant; a rule that conditions on it and fills at that same open is optimistic (deep 2).
export function entryGap(M, A, jE) {
  const k = barOn(A, jE); const i = jE >= 1 ? A.kAt[jE - 1] : -1;
  if (k < 0 || i < 0 || !(A.arr[i].c > 0)) return { gapEntry: null, gapEntryX: null };
  const S = M.spy.arr, jd = A.jOfBar[i];
  const g = A.arr[k].o / A.arr[i].c - 1, sg = S[jE].o / S[jd].c - 1;
  return { gapEntry: g, gapEntryX: g - sg };
}

// ---------------- path helpers ----------------
function exitState(M, exitDate) {
  if (M.cutoff && exitDate >= M.cutoff) return "embargo";
  if (exitDate > COMPLETE_THROUGH) return "censored";
  return "ok";
}
// Scan bars with session index in [jFrom, jTo]: max high (and its session), min low, first session whose high >= base*(1+X%).
export function scanPath(A, jFrom, jTo, base, targets = TARGETS) {
  const a = A.arr; let hi = -Infinity, lo = Infinity, jHi = null;
  const first = Object.fromEntries(targets.map((X) => [X, null]));
  let k = jFrom >= 1 ? A.kAt[jFrom - 1] + 1 : 0;
  for (; k < a.length && A.jOfBar[k] <= jTo; k++) {
    const b = a[k], j = A.jOfBar[k];
    if (j < jFrom) continue;
    if (b.h > hi) { hi = b.h; jHi = j; }
    if (b.l < lo) lo = b.l;
    for (const X of targets) if (first[X] == null && b.h >= base * (1 + X / 100)) first[X] = j;
  }
  return { mfe: hi > -Infinity ? hi / base - 1 : null, mae: lo < Infinity ? lo / base - 1 : null, jHi, first };
}
// Limit / stop exit on daily bars over sessions jE..jX (deep-3 approximation, worst-case ordering):
//   stop   (if set): first session whose low <= stop → fill at min(open, stop)   [checked BEFORE the target in the same session]
//   target (if set): first session whose high >= target*(1+FILL_BUFFER) → fill at max(open, target)
//   otherwise      : close of session jX ("time"); px null if no bar on jX. Missing bars are skipped. → { j, px, why }
export function limitExit(A, jE, jX, entry, target, stop) {
  const a = A.arr, tg = target == null ? null : entry * (1 + target), sp = stop == null ? null : entry * (1 - stop);
  let k = jE >= 1 ? A.kAt[jE - 1] + 1 : 0;
  for (; k < a.length && A.jOfBar[k] <= jX; k++) {
    const b = a[k], j = A.jOfBar[k]; if (j < jE) continue;
    const op = b.o; // open entry: the entry-session open IS the entry; close entry: scanning starts at the next session's real open
    if (sp != null && b.l <= sp) return { j, px: Math.min(op, sp), why: "stop" };
    if (tg != null && b.h >= tg * (1 + FILL_BUFFER)) return { j, px: Math.max(op, tg), why: "tp" };
  }
  const kX = barOn(A, jX);
  return { j: jX, px: kX >= 0 && A.arr[kX].c > 0 ? A.arr[kX].c : null, why: "time" };
}

// ---------------- outcome B (public trader) ----------------
export const B_FIELDS = (() => {
  const f = ["B_status", "B_entryDate", "B_entryPrice", "B_spyEntry", "B_entryVolume", "B_costBps"];
  for (const H of CAL_H) {
    f.push(`B_end${H}`, `B_st${H}`, `B_exit${H}`, `B_gross${H}`, `B_spy${H}`, `B_xs${H}`, `B_net${H}`, `B_xsNet${H}`, `B_xsNet2x${H}`, `B_mfe${H}`, `B_mae${H}`);
    for (const X of TARGETS) f.push(`B_hit${X}_${H}`);
    f.push(`B_lim${LIMIT_X}_${H}`, `B_lim${LIMIT_X}fill${H}`, `B_lim${LIMIT_X}sess${H}`);
  }
  for (const X of TARGETS) f.push(`B_tt${X}s`, `B_tt${X}d`, `B_tt${X}obs`);
  f.push("B_ttMaxHi30s");
  for (const N of SESS_N) f.push(`B_sEnd${N}`, `B_sSt${N}`, `B_sGross${N}`, `B_sSpy${N}`, `B_sXsNet${N}`, `B_sXsNet2x${N}`);
  return f;
})();
const blank = (fields) => Object.fromEntries(fields.map((k) => [k, null]));
function fillEnds(o, entryDate, st) {
  for (const H of CAL_H) { o[`B_end${H}`] = sessionOnOrBefore(addDays(entryDate, H)); o[`B_st${H}`] = st; }
  for (const N of SESS_N) { o[`B_sEnd${N}`] = sessionAfter(entryDate, N); o[`B_sSt${N}`] = st; }
}
// All B outcomes for an entry at the official open of session jE (index into M.days), per-side cost costBps.
export function outcomeB(M, A, jE, costBps) {
  const o = blank(B_FIELDS);
  if (jE == null || jE < 0 || jE >= M.nS) { o.B_status = "entry_after_cache"; return o; }
  const c = costBps / 1e4, c2 = 2 * c;
  const entryDate = M.days[jE];
  o.B_entryDate = entryDate; o.B_costBps = costBps;
  if (M.cutoff && entryDate >= M.cutoff) { o.B_status = "embargo"; fillEnds(o, entryDate, "embargo"); return o; }
  if (entryDate > COMPLETE_THROUGH) { o.B_status = "censored"; fillEnds(o, entryDate, "censored"); return o; }
  const k0 = barOn(A, jE);
  if (k0 < 0 || !(A.arr[k0].o > 0)) { o.B_status = "no_entry_bar"; fillEnds(o, entryDate, "no_entry_bar"); return o; }
  const S = M.spy.arr, entry = A.arr[k0].o, spy0 = S[jE].o;
  o.B_status = "ok"; o.B_entryPrice = entry; o.B_spyEntry = spy0; o.B_entryVolume = A.arr[k0].v;
  for (const H of CAL_H) {
    const exitDate = sessionOnOrBefore(addDays(entryDate, H));
    o[`B_end${H}`] = exitDate;
    let st = exitState(M, exitDate);
    const jX = M.idx.get(exitDate);
    let kX = -1;
    if (st === "ok") { kX = barOn(A, jX); if (kX < 0 || !(A.arr[kX].c > 0)) st = "no_exit_bar"; }
    o[`B_st${H}`] = st;
    if (st === "embargo" || st === "censored") continue;
    // the window [entry, exit session] is readable: path statistics and the limit approximation do not need the exit bar
    const p = scanPath(A, jE, jX, entry, TARGETS);
    o[`B_mfe${H}`] = p.mfe; o[`B_mae${H}`] = p.mae;
    for (const X of TARGETS) o[`B_hit${X}_${H}`] = p.first[X] != null ? 1 : 0;
    const lim = limitExit(A, jE, jX, entry, LIMIT_X / 100, null);
    if (lim.px > 0) {
      const spyL = S[lim.j].c / spy0 - 1;
      o[`B_lim${LIMIT_X}_${H}`] = netOf(entry, lim.px, c, c) - spyL; o[`B_lim${LIMIT_X}fill${H}`] = lim.why === "tp" ? 1 : 0; o[`B_lim${LIMIT_X}sess${H}`] = lim.why === "tp" ? lim.j - jE : null;
    }
    if (st !== "ok") continue; // no_exit_bar: no official close on the exit session → no close-exit return
    const px = A.arr[kX].c, spyR = S[jX].c / spy0 - 1;
    const gross = px / entry - 1, net = netOf(entry, px, c, c), net2 = netOf(entry, px, c2, c2);
    o[`B_exit${H}`] = px; o[`B_gross${H}`] = gross; o[`B_spy${H}`] = spyR; o[`B_xs${H}`] = gross - spyR;
    o[`B_net${H}`] = net; o[`B_xsNet${H}`] = net - spyR; o[`B_xsNet2x${H}`] = net2 - spyR;
  }
  // time to target inside the 30-day window, scanning only readable sessions (sessions after entry, 0 = entry session)
  const jEnd30 = M.idx.get(o.B_end30);
  const jScanTo = Math.min(jEnd30 == null ? M.jMax : jEnd30, M.jMax);
  const pAll = scanPath(A, jE, jScanTo, entry, TARGETS);
  const w30ok = o.B_st30 === "ok" || o.B_st30 === "no_exit_bar"; // the 30-day window is fully readable
  for (const X of TARGETS) {
    const jf = pAll.first[X];
    o[`B_tt${X}s`] = jf != null ? jf - jE : null;
    o[`B_tt${X}d`] = jf != null ? daysBetween(entryDate, M.days[jf]) : null;
    o[`B_tt${X}obs`] = jf != null ? 1 : w30ok ? 0 : null; // 1 touched within 30 days, 0 not touched (complete window), null unknown
  }
  o.B_ttMaxHi30s = w30ok && pAll.jHi != null ? pAll.jHi - jE : null;
  // session exits (deep 2/3 continuity): close of the N-th session after the entry session; strict (missing bar → null)
  for (const N of SESS_N) {
    const exitDate = sessionAfter(entryDate, N);
    o[`B_sEnd${N}`] = exitDate;
    let st = exitState(M, exitDate);
    const jX = M.idx.get(exitDate);
    let kX = -1;
    if (st === "ok") { kX = barOn(A, jX); if (kX < 0 || !(A.arr[kX].c > 0)) st = "no_exit_bar"; }
    o[`B_sSt${N}`] = st;
    if (st !== "ok") continue;
    const px = A.arr[kX].c, spyR = S[jX].c / spy0 - 1;
    o[`B_sGross${N}`] = px / entry - 1; o[`B_sSpy${N}`] = spyR; o[`B_sXsNet${N}`] = netOf(entry, px, c, c) - spyR; o[`B_sXsNet2x${N}`] = netOf(entry, px, c2, c2) - spyR;
  }
  return o;
}

// ---------------- outcome A (insider, hypothetical, unrealised mark-to-market) ----------------
// Base = the insider's reported price on the trade date, split-adjusted (reported * f, f from the execLib.adjFactor rule).
// SPY base = SPY close of the last session on/before the trade date. Path = sessions strictly after the trade date.
export const A_FIELDS = (() => {
  const f = ["A_status", "A_spyBase"];
  for (const H of CAL_H) f.push(`A_end${H}`, `A_st${H}`, `A_ret${H}`, `A_spy${H}`, `A_xs${H}`);
  f.push("A_mfe30", "A_mae30");
  for (const X of TARGETS) f.push(`A_hit${X}_30`, `A_tt${X}s`);
  return f;
})();
export function outcomeA(M, A, tradeDate, pAdj) {
  const o = blank(A_FIELDS);
  if (!(pAdj > 0)) { o.A_status = "no_price"; return o; }
  if (!A) { o.A_status = "no_bars"; return o; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate || "")) { o.A_status = "bad_trade_date"; return o; }
  if (tradeDate < A.first || tradeDate < M.days[0]) { o.A_status = "td_before_bars"; return o; }
  const jT = M.lastOnOrBefore(tradeDate);
  if (jT > M.jMax) { o.A_status = M.cutoff && tradeDate >= M.cutoff ? "embargo" : "censored"; return o; }
  const S = M.spy.arr, spy0 = S[jT].c;
  o.A_status = "ok"; o.A_spyBase = spy0;
  for (const H of CAL_H) {
    const exitDate = sessionOnOrBefore(addDays(tradeDate, H));
    o[`A_end${H}`] = exitDate;
    let st = exitState(M, exitDate);
    const jX = M.idx.get(exitDate);
    let kX = -1;
    if (st === "ok") { kX = barOn(A, jX); if (kX < 0 || !(A.arr[kX].c > 0)) st = "no_exit_bar"; }
    o[`A_st${H}`] = st;
    if (st !== "ok") continue;
    const ret = A.arr[kX].c / pAdj - 1, spyR = S[jX].c / spy0 - 1;
    o[`A_ret${H}`] = ret; o[`A_spy${H}`] = spyR; o[`A_xs${H}`] = ret - spyR;
  }
  if (o.A_st30 === "ok" || o.A_st30 === "no_exit_bar") { // the 30-day window is fully readable
    const jX = M.idx.get(o.A_end30);
    const p = scanPath(A, jT + 1, jX, pAdj, TARGETS);
    o.A_mfe30 = p.mfe; o.A_mae30 = p.mae;
    for (const X of TARGETS) { o[`A_hit${X}_30`] = p.first[X] != null ? 1 : 0; o[`A_tt${X}s`] = p.first[X] != null ? p.first[X] - jT : null; }
  }
  return o;
}

// ---------------- control pool + matching (deep-2 chart method) ----------------
// Exclusion marks (deep-2 purchaseBlocks): each visible code-P row marks its acceptance session (first session on/after the
// acceptance date), the next session and its trade-date session; a stock-day j is excluded when a mark lies in [j-20, j+20].
// Only filings visible to this agent are used (design build: accepted < 2026-06-15), so the forward half of the window is
// incomplete for stock-days within 20 sessions of the visibility boundary (flag exclTrunc).
export function purchaseBlocks(M, pRows, cik2sym, { before = 20, after = 20 } = {}) {
  const marks = new Map();
  for (const r of pRows) {
    const s = r.ticker ? symOf(r.ticker) : cik2sym.get(r.cik); if (!s) continue;
    const m = marks.get(s) || marks.set(s, new Set()).get(s);
    const ad = day(r.acceptedAt || "");
    if (/^\d{4}-\d{2}-\d{2}$/.test(ad)) { const j = M.firstOnOrAfter(ad); m.add(j); m.add(j + 1); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(r.tradeDate || "")) m.add(M.firstOnOrAfter(r.tradeDate));
  }
  const blocked = new Map();
  for (const [s, set] of marks) { const b = new Uint8Array(M.nS); for (const m of set) for (let j = Math.max(0, m - after); j <= Math.min(M.nS - 1, m + before); j++) b[j] = 1; blocked.set(s, b); }
  return blocked;
}
// Pool of stock-days D (control entry dates) in [from, cutoff) with an entry bar (open > 0), >= MIN_HIST_BARS bars before D and
// no mark within +-20 sessions. Matching features (r5, r20, dd60 = dHi60, vol20, dv20, gapPrev) = marketFeatures at jDec = j - 1.
export function buildPool(M, blocked, { from = STORE_START, visibleUntil = null, segOf = (d) => L4.segmentOf(d) } = {}) {
  const syms = [...M.bars.keys()].filter((s) => s !== "SPY" && s !== "IWM" && M.bars.get(s).arr.length > 30).sort();
  const rows = [];
  const jFrom = Math.max(1, M.firstOnOrAfter(from));
  const jVis = visibleUntil ? M.firstOnOrAfter(visibleUntil) : M.nS; // first session whose filings are NOT visible
  syms.forEach((s, si) => {
    const A = M.aligned(s); if (!A) return;
    const blk = blocked.get(s);
    for (let j = jFrom; j <= M.jMax; j++) {
      const k = barOn(A, j); if (k < 0 || !(A.arr[k].o > 0)) continue;
      if (blk && blk[j]) continue;
      if (A.kAt[j - 1] < MIN_HIST_BARS - 1) continue;
      const f = marketFeatures(M, A, j - 1);
      if (!f || !f.featOk) continue;
      const D = M.days[j];
      rows.push({ si, s, j, D, m: D.slice(0, 7), per: segOf(D), tier: f.tier, r5: f.r5, r20: f.r20, dd60: f.dHi60, vol20: f.vol20, dv20: f.dv20, gapPrev: f.gapPrev,
        exclTrunc: j + 20 >= jVis ? 1 : 0 });
    }
  });
  return { rows, syms };
}
