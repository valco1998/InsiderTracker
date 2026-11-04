// deep2/chart/common.mjs — shared helpers for the "chart" agent (read-only research, cache-only data via lib2).
// No network: only lib2.loadBars / loadEvents / loadSecRows. Writes only under .cache/research/deep2/chart/.
//
// Conventions (identical for insider events and control stock-days):
//   decision bar  = the symbol's last daily bar strictly before the entry session (its close = decisionClose)
//   entry         = official open of the entry session E (events: first session >= acceptance + 60 s, from stage C)
//   gapX          = (open_E / decisionClose - 1) - (SPY open_E / SPY close on the decision date - 1)
//   x[N]          = open_E -> close of the N-th session after E (N = 0 is the same-day close, MOO->MOC),
//                   net of costBps per side, minus SPY open_E -> SPY close on the same exit date
//   moc[N]        = close_E -> close of the N-th session after E (observe the open, fill at the MOC), net, minus SPY
// Exit dates come from the SPY session calendar; a missing exit bar means "no outcome" (never filled).
import fs from "node:fs";
import path from "node:path";
import { loadBars, loadEvents, loadSecRows, periodOf, usable, DISCOVER_END, HOLDOUT_START, DEEP2, mean, median, r4, companyStats, bhQ, registerHypothesis, recordResult, wmean, pValue, clusteredT } from "../lib2.mjs";

export { loadBars, loadEvents, loadSecRows, periodOf, usable, DISCOVER_END, HOLDOUT_START, mean, median, r4, companyStats, bhQ, wmean, pValue, clusteredT };
export const AGENT = "chart";
export const OUT = path.join(DEEP2, "chart");
fs.mkdirSync(OUT, { recursive: true });
export const sym = (t) => String(t || "").trim().toUpperCase().replace(/-/g, ".");
// Copied from ../../lib.mjs (costBpsFor): per-side cost by 20-session average dollar volume.
export function costBpsFor(dv) { if (!(dv > 0)) return 100; if (dv >= 50e6) return 5; if (dv >= 5e6) return 15; if (dv >= 1e6) return 35; return 75; }
export const tierOf = (dv) => { const b = costBpsFor(dv); return b >= 75 ? 75 : b; };
export const clip = (x, lo, hi) => (x == null || !Number.isFinite(x) ? null : Math.min(hi, Math.max(lo, x)));
export const sd = (xs) => { if (xs.length < 3) return null; const m = mean(xs); return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1)); };
export const pct = (v, d = 2) => (v == null || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(d)}%`);
export const periodEnd = (per) => (per === "discover" ? DISCOVER_END : HOLDOUT_START);

// ---------------- registry helpers ----------------
const REG = path.join(DEEP2, "registry.jsonl");
const RES = path.join(DEEP2, "registry-results.jsonl");
const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : []);
export const myRegistry = () => readJsonl(REG).filter((h) => h.agent === AGENT);
export const myResults = () => readJsonl(RES).filter((h) => h.agent === AGENT);
// Register once (idempotent across re-runs: the first registration time is the one that counts).
export function reg(h) { if (myRegistry().some((x) => x.id === h.id)) return false; registerHypothesis({ agent: AGENT, preRegistered: true, ...h }); return true; }
// Record a result; a re-run that reproduces the latest recorded result for this id exactly is not appended again.
export function rec(id, result) {
  const prev = myResults().filter((x) => x.id === id).at(-1);
  if (prev && JSON.stringify(prev.result) === JSON.stringify(JSON.parse(JSON.stringify(result)))) return false;
  recordResult(id, AGENT, result); return true;
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
  return {
    nHist: i + 1, decDate: a[i].d, price: last,
    r1: ret(1), r5: ret(5), r20: ret(20), r60: i >= 60 ? ret(60) : null,
    seg1: i >= 60 && a[i - 40].c > 0 && a[i - 60].c > 0 ? a[i - 40].c / a[i - 60].c - 1 : null, // sessions -60..-40
    seg2: i >= 40 && a[i - 20].c > 0 && a[i - 40].c > 0 ? a[i - 20].c / a[i - 40].c - 1 : null, // sessions -40..-20
    dd60: last / hiC - 1, pos60: hiC > loC ? (last - loC) / (hiC - loC) : null, nearLow60: last <= loL * 1.05,
    vol20, vol10_60: vol10 && vol60 ? vol10 / vol60 : null, dv20,
    gapPrev: a[i - 1].c > 0 ? a[i].o / a[i - 1].c - 1 : null,
    sma50r: sma50 ? last / sma50 - 1 : null, range20, tight: range20 != null && vol60 ? range20 / (vol60 * Math.sqrt(20)) : null,
    breakout20: last > hi20p, breakout60: i >= 60 ? last > hi60p : null,
    volDry: v60 > 0 && vDry != null ? vDry / v60 : null, volSpike: vBase > 0 && vSpike != null ? vSpike / vBase : null,
    downRun, spyAbove50: cal.above50.has(a[i].d) ? cal.above50.get(a[i].d) : null,
  };
}

// ---------------- outcomes from entry bar k (bars from k on) ----------------
// costBps per side; returns null if the entry or decision bar is unusable.
export function outcomeAt(s, k, cal, costBps) {
  const a = s.arr, eb = a[k], dec = a[k - 1];
  if (!eb || !dec || !(eb.o > 0) || !(dec.c > 0)) return null;
  const j = cal.idx.get(eb.d), jd = cal.idx.get(dec.d); if (j == null || jd == null) return null;
  const S = cal.spy.arr, sE = S[j], sD = S[jd];
  const c = costBps / 1e4;
  const o = { j, entryDate: eb.d, entry: eb.o, gap: eb.o / dec.c - 1, spyGap: sE.o / sD.c - 1, x: [], moc: [], exitDates: [] };
  o.gapX = o.gap - o.spyGap;
  for (let N = 0; N <= 5; N++) {
    const xd = cal.days[j + N]; o.exitDates[N] = xd ?? null;
    const xi = xd ? s.idx.get(xd) : null, sx = S[j + N];
    if (xi == null || !sx || !(a[xi].c > 0)) { o.x[N] = null; o.moc[N] = null; continue; }
    const px = a[xi].c, spyR = sx.c / sE.o - 1;
    const gross = px / eb.o - 1, net = (px * (1 - c)) / (eb.o * (1 + c)) - 1;
    o.x[N] = { gross, spy: spyR, excess: gross - spyR, xnet: net - spyR };
    if (N >= 1 && eb.c > 0) { const g = px / eb.c - 1, sr = sx.c / sE.c - 1, nt = (px * (1 - c)) / (eb.c * (1 + c)) - 1; o.moc[N] = { gross: g, spy: sr, xnet: nt - sr }; }
    else o.moc[N] = null;
  }
  return o;
}
// Re-price an outcome at a different per-side cost (used to charge each control the cost its event paid).
export function xnetAt(s, k, cal, N, costBps, mode = "open") {
  const a = s.arr, eb = a[k]; const j = cal.idx.get(eb.d); const xd = cal.days[j + N]; if (!xd) return null;
  const xi = s.idx.get(xd); const S = cal.spy.arr, sx = S[j + N], sE = S[j]; if (xi == null || !sx || !(a[xi].c > 0)) return null;
  const c = costBps / 1e4, px = a[xi].c;
  if (mode === "open") { const net = (px * (1 - c)) / (eb.o * (1 + c)) - 1; return net - (sx.c / sE.o - 1); }
  if (N < 1 || !(eb.c > 0)) return null;
  const net = (px * (1 - c)) / (eb.c * (1 + c)) - 1; return net - (sx.c / sE.c - 1);
}

// ---------------- insider purchase marks (any code-P filing, from lib2.loadSecRows) ----------------
// For each symbol: Uint8Array over the session calendar, 1 = within the exclusion window of a P filing.
// A filing marks its acceptance session (first session on/after the acceptance date), the next session, and the
// trade-date session. blocked: control day j excluded if a mark lies in [j - before, j + after].
export async function purchaseBlocks(cal, { before = 20, after = 20, extAfter = 60, extraCik2Sym = null } = {}) {
  const sec = await loadSecRows();
  const cik2sym = new Map(extraCik2Sym || []);
  for (const r of sec.rows) if (r.ticker && r.cik && !cik2sym.has(r.cik)) cik2sym.set(r.cik, sym(r.ticker));
  const marks = new Map();
  for (const r of sec.rows) {
    if (r.code !== "P") continue;
    const s = r.ticker ? sym(r.ticker) : cik2sym.get(r.cik); if (!s) continue;
    const m = marks.get(s) || marks.set(s, new Set()).get(s);
    const ad = String(r.acceptedAt || "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(ad)) { const j = cal.firstOnOrAfter(ad); m.add(j); m.add(j + 1); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(r.tradeDate || "")) m.add(cal.firstOnOrAfter(r.tradeDate));
  }
  const L = cal.days.length;
  const make = (bef, aft) => { const out = new Map(); for (const [s, set] of marks) { const b = new Uint8Array(L); for (const m of set) { for (let j = Math.max(0, m - aft); j <= Math.min(L - 1, m + bef); j++) b[j] = 1; } out.set(s, b); } return out; };
  // control day j is blocked if a mark m satisfies j - before <= m <= j + after  <=>  m - after <= j <= m + before
  // "ext": also blocked when a P filing follows within extAfter sessions (removes pre-purchase stretches).
  return { blocked: make(before, after), blockedExt: make(before, extAfter), marks, cik2sym };
}

// ---------------- control pool: every (symbol, session) with no P filing nearby ----------------
// Each row: matching features at the decision bar, the entry-day excess gap, and where to find outcomes later.
export function buildPool(bars, cal, blocks, { from = "2025-12-01", to = HOLDOUT_START, blocksExt = null } = {}) {
  const syms = [...bars.keys()].filter((s) => s !== "SPY" && s !== "IWM" && bars.get(s).arr.length > 30);
  const rows = [];
  syms.forEach((s, si) => {
    const ser = bars.get(s), a = ser.arr, blk = blocks.get(s), blkE = blocksExt?.get(s);
    for (let k = 26; k < a.length; k++) {
      const D = a[k].d; if (D < from || D >= to) continue;
      const j = cal.idx.get(D); if (j == null) continue;
      if (blk && blk[j]) continue;
      const per = D < DISCOVER_END ? "discover" : "confirm";
      const x5 = cal.days[j + 5]; if (!x5 || x5 >= (per === "discover" ? DISCOVER_END : HOLDOUT_START)) continue;
      const f = featuresAt(ser, k - 1, cal); if (!f || !(a[k].o > 0)) continue;
      const jd = cal.idx.get(a[k - 1].d); if (jd == null) continue;
      const S = cal.spy.arr;
      const gapX = (a[k].o / a[k - 1].c - 1) - (S[j].o / S[jd].c - 1);
      rows.push({ si, s, k, j, D, m: D.slice(0, 7), per, tier: tierOf(f.dv20), ext: blkE ? !blkE[j] : true,
        r5: f.r5, r20: f.r20, dd60: f.dd60, vol20: f.vol20, dv20: f.dv20, gapPrev: f.gapPrev, gapX,
        r1: f.r1, r60: f.r60, pos60: f.pos60, price: f.price, sma50r: f.sma50r, volSpike: f.volSpike, nearLow60: f.nearLow60 });
    }
  });
  return { rows, syms };
}

// ---------------- matching ----------------
// Transformed matching coordinates (winsorized returns, logs of volatility and dollar volume).
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
// Index pool rows by month|tier and by session|tier.
export function indexPool(rows) {
  const byMT = new Map(), byJT = new Map();
  for (const r of rows) {
    const a = `${r.m}|${r.tier}`, b = `${r.j}|${r.tier}`;
    (byMT.get(a) || byMT.set(a, []).get(a)).push(r);
    (byJT.get(b) || byJT.set(b, []).get(b)).push(r);
  }
  return { byMT, byJT };
}
// Precompute transformed matching vectors on pool rows (NaN = missing → never matched).
export function prepareVectors(rows, feats, key) {
  for (const r of rows) { const v = new Float64Array(feats.length); for (let q = 0; q < feats.length; q++) { const x = feats[q].f(r); v[q] = x == null ? NaN : x; } r[key] = v; }
}
// K nearest controls for one event row (at most one stock-day per symbol), within the event's period.
export function nearest(ev, idx, scales, nSyms, { K = 10, feats = MATCH_FEATURES, key = "fv", sameDate = false, ext = false, filter = null } = {}) {
  const cand = sameDate ? idx.byJT.get(`${ev.j}|${ev.tier}`) : idx.byMT.get(`${ev.m}|${ev.tier}`);
  if (!cand) return [];
  const ef = feats.map((F) => F.f(ev));
  if (ef.some((v) => v == null)) return [];
  const w = feats.map((F) => F.w / scales[F.k] ** 2);
  const best = new Float64Array(nSyms).fill(Infinity), bestRow = new Array(nSyms);
  for (const r of cand) {
    if (r.per !== ev.per) continue;
    if (ext && !r.ext) continue;
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

// ---------------- events ----------------
export const pubBucket = (t) => (t >= "09:30:00" && t < "16:00:00" ? "rth" : t >= "16:00:00" && t < "20:00:00" ? "ah" : "overnight");
export function eventRows(E, bars, cal) {
  const out = [];
  for (const e of E) {
    const s = bars.get(sym(e.ticker)); if (!s) continue;
    const k = s.idx.get(e.entryDate); if (k == null || k < 1) continue;
    const f = featuresAt(s, k - 1, cal); if (!f) continue;
    const o = outcomeAt(s, k, cal, e.costBpsPerSide); if (!o) continue;
    const per = periodOf(e);
    out.push({ e, s: sym(e.ticker), ser: s, k, j: o.j, m: e.entryDate.slice(0, 7), per, tier: tierOf(f.dv20), ...f, gapX: o.gapX, o });
  }
  return out;
}
// Embargo for a horizon computed from bars (mirrors lib2.usable): exit date must be inside the event's period.
export function usableN(row, N) {
  const xd = row.o.exitDates[N]; if (!xd || row.o.x[N] == null) return false;
  if (row.per === "discover") return xd < DISCOVER_END;
  if (row.per === "confirm") return xd < HOLDOUT_START;
  return false;
}

// ---------------- output helpers ----------------
export function toCsv(rows, cols) {
  const esc = (v) => (v == null ? "" : typeof v === "number" ? String(Math.round(v * 1e6) / 1e6) : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}
export const writeOut = (name, data) => { const f = path.join(OUT, name); fs.writeFileSync(f, typeof data === "string" ? data : JSON.stringify(data, null, 1)); return f; };
export const smd = (a, b) => { const ma = mean(a), mb = mean(b), va = sd(a) ** 2, vb = sd(b) ** 2; const den = Math.sqrt((va + vb) / 2); return den > 0 ? (ma - mb) / den : null; };
