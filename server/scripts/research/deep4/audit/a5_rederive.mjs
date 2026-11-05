// deep4/audit/a5_rederive.mjs — Phase A item 5: independent re-derivation (own code, raw split-adjusted bars, SPY session list)
// of a random sample of panel features and outcomes for events (design + confirmation) and matched-control stock-days.
// Every feature is recomputed from bars dated strictly before the entry date; outcomes from the entry open / exit close.
//   node --max-old-space-size=8192 scripts/research/deep4/audit/a5_rederive.mjs
import { phaseA, L4, loadP, loadC, writeOut, checkpoint, r4, fin, rng, countBy } from "./common.mjs";

phaseA();
const t0 = Date.now();
const bars = L4.loadBars();
const SPY = bars.get("SPY").arr, S = SPY.map((b) => b.d), sIdx = new Map(S.map((d, i) => [d, i]));
const LAST = "2026-11-03";
const addD = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const lastSessOnOrBefore = (d) => { let lo = 0, hi = S.length - 1, a = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (S[m] <= d) { a = m; lo = m + 1; } else hi = m - 1; } return a; };
const lastBarOnOrBefore = (a, d) => { let lo = 0, hi = a.length - 1, ans = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (a[m].d <= d) { ans = m; lo = m + 1; } else hi = m - 1; } return ans; };
const tier = (dv) => (!(dv > 0) ? 100 : dv >= 50e6 ? 5 : dv >= 5e6 ? 15 : dv >= 1e6 ? 35 : 75);
const sdS = (xs) => { if (xs.length < 3) return null; const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1)); };
function feats(sym, E) {
  const ser = bars.get(sym); if (!ser) return null; const a = ser.arr;
  const jE = sIdx.get(E); if (jE == null) return null; const jDec = jE - 1; if (jDec < 0) return null;
  const i = lastBarOnOrBefore(a, S[jDec]); if (i < 0) return null;
  const last = a[i].c, firstJ = sIdx.get(a[0].d);
  const histSessions = jDec - firstJ + 1;
  const ret = (n) => { if (jDec - n < firstJ) return null; const k = lastBarOnOrBefore(a, S[jDec - n]); return k >= 0 && a[k].c > 0 ? last / a[k].c - 1 : null; };
  const win = (W) => { const from = jDec - W >= 0 ? S[jDec - W] : null; let lo = 0; if (from) { lo = lastBarOnOrBefore(a, from) + 1; } return { lo, hi: i, sess: Math.min(W, histSessions) }; };
  const cl = (w) => a.slice(w.lo, w.hi + 1).map((b) => b.c);
  const w20 = win(20), w60 = win(60);
  const c20 = cl(w20), c60 = cl(w60);
  const lr = (w) => { const xs = []; for (let k = Math.max(1, w.lo); k <= w.hi; k++) if (a[k].c > 0 && a[k - 1].c > 0) xs.push(Math.log(a[k].c / a[k - 1].c)); return xs; };
  let dv = 0; for (let k = w20.lo; k <= w20.hi; k++) dv += a[k].c * a[k].v; const dv20 = dv / Math.max(1, w20.sess);
  let run = -Infinity, mdd = 0; for (const c of c60) { run = Math.max(run, c); mdd = Math.min(mdd, c / run - 1); }
  const avgV = (f, t) => { if (t < 0) return null; let s = 0, m = 0; for (let k = Math.max(0, f); k <= t; k++) { s += a[k].v; m++; } return m ? s / m : null; };
  const vS = avgV(i - 2, i), vB = avgV(i - 22, i - 3);
  let sma = null; if (i >= 49) { let s = 0; for (let k = i - 49; k <= i; k++) s += a[k].c; sma = s / 50; }
  return { r5: ret(5), r20: ret(20), r60: ret(60), dHi60: last / Math.max(...c60) - 1, dLo60: last / Math.min(...c60) - 1, vol20: sdS(lr(w20)), vol60: sdS(lr(w60)), dv20, costBps: tier(dv20),
    gapPrev: i >= 1 && a[i - 1].c > 0 ? a[i].o / a[i - 1].c - 1 : null, bo20: last >= Math.max(...c20) ? 1 : 0, mdd60: mdd, sma50r: sma ? last / sma - 1 : null, volSurge: vB > 0 && vS != null ? vS / vB : null, _last: last, _i: i };
}
function outB(sym, E, costBps, H) {
  const a = bars.get(sym)?.arr; if (!a) return null; const k0 = lastBarOnOrBefore(a, E); if (k0 < 0 || a[k0].d !== E || !(a[k0].o > 0)) return null;
  const jX = lastSessOnOrBefore(addD(E, H)); if (jX < 0 || S[jX] > LAST) return null; const X = S[jX];
  const kX = lastBarOnOrBefore(a, X); if (kX < 0 || a[kX].d !== X || !(a[kX].c > 0)) return null;
  const c = costBps / 1e4, entry = a[k0].o, px = a[kX].c, spy = SPY[jX].c / SPY[sIdx.get(E)].o - 1;
  let hit = 0; for (let k = k0; k <= kX; k++) if (a[k].h >= entry * 1.1) { hit = 1; break; }
  return { xsNet: (px * (1 - c)) / (entry * (1 + c)) - 1 - spy, hit10: hit };
}
function outA(sym, td, price, H) {
  const a = bars.get(sym)?.arr; if (!a || !(price > 0) || !td || td < a[0].d) return null;
  const kt = lastBarOnOrBefore(a, td); if (kt < 0) return null; const ratio = a[kt].c / price; const base = ratio > 1.8 || ratio < 0.55 ? price * ratio : price;
  const jT = lastSessOnOrBefore(td), jX = lastSessOnOrBefore(addD(td, H)); if (S[jX] > LAST) return null; const X = S[jX];
  const kX = lastBarOnOrBefore(a, X); if (kX < 0 || a[kX].d !== X || !(a[kX].c > 0)) return null;
  return { xs: a[kX].c / base - 1 - (SPY[jX].c / SPY[jT].c - 1) };
}
const close = (x, y) => (x == null && y == null) || (fin(x) != null && fin(y) != null && Math.abs(x - y) <= 1e-5 * Math.max(1, Math.abs(x), Math.abs(y)));
const P = loadP(["design", "confirm"]);
const C = loadC(["design", "confirm"]);
const rnd = rng(4242);
const pick = (xs, k) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, k); };
const evPool = P.rows.filter((r) => r.priced === 1 && r.featOk === 1);
const sample = [...pick(evPool.filter((r) => r.segment === "design"), 400), ...pick(evPool.filter((r) => r.segment === "confirm"), 300)];
const FE = ["r5", "r20", "r60", "dHi60", "dLo60", "vol20", "vol60", "dv20", "costBps", "gapPrev", "bo20", "mdd60", "sma50r", "volSurge"];
const res = { events: { n: 0, fields: {}, mismatches: [] }, controls: { n: 0, fields: {}, mismatches: [] } };
const note = (bucket, k, ok, ctx) => { const f = (res[bucket].fields[k] ||= { compared: 0, mismatch: 0 }); f.compared++; if (!ok) { f.mismatch++; if (res[bucket].mismatches.length < 25) res[bucket].mismatches.push(ctx); } };
for (const r of sample) {
  res.events.n++;
  const f = feats(r.sym, r.entryDate); if (!f) { note("events", "_features", false, { key: r.key, why: "no features" }); continue; }
  for (const k of FE) note("events", k, close(f[k], r[k]), { key: r.key, k, panel: r[k], audit: f[k] });
  // retTdToDec (trade-date close -> decision close)
  if (r.retTdToDec != null) { const a = bars.get(r.sym).arr; const kt = lastBarOnOrBefore(a, r.tradeDate); const v = kt >= 0 && r.tradeDate >= a[0].d ? f._last / a[kt].c - 1 : null; note("events", "retTdToDec", close(v, r.retTdToDec), { key: r.key, k: "retTdToDec", panel: r.retTdToDec, audit: v }); }
  for (const H of [5, 30]) { const o = r.B_status === "ok" && r[`B_st${H}`] === "ok" ? outB(r.sym, r.entryDate, r.costBps, H) : null; if (r[`B_st${H}`] === "ok") { note("events", `B_xsNet${H}`, close(o?.xsNet, r[`B_xsNet${H}`]), { key: r.key, k: `B_xsNet${H}`, panel: r[`B_xsNet${H}`], audit: o?.xsNet }); if (H === 30) note("events", "B_hit10_30", o?.hit10 === r.B_hit10_30, { key: r.key, k: "hit", panel: r.B_hit10_30, audit: o?.hit10 }); } }
  if (r.A_st30 === "ok") { const o = outA(r.sym, r.tradeDate, r.priceReported, 30); note("events", "A_xs30", close(o?.xs, r.A_xs30), { key: r.key, k: "A_xs30", panel: r.A_xs30, audit: o?.xs }); }
  // per-event control mean consistency (C_xsNet30 = mean of its controls' B_xsNet30)
  const cs = C.of(r.key).map((c) => c.B_xsNet30).filter((x) => fin(x) != null);
  if (cs.length) note("events", "C_xsNet30", close(cs.reduce((a, b) => a + b, 0) / cs.length, r.C_xsNet30), { key: r.key, k: "C_xsNet30", panel: r.C_xsNet30, audit: cs.reduce((a, b) => a + b, 0) / cs.length });
}
// controls: features and outcomes of a random sample of control stock-days
const ctlSample = pick([...C.rows.values()], 500);
for (const c of ctlSample) {
  res.controls.n++;
  const f = feats(c.sym, c.entryDate); if (!f) { note("controls", "_features", false, { key: c.ctlKey, why: "no features" }); continue; }
  for (const k of FE) note("controls", k, close(f[k], c[k]), { key: c.ctlKey, k, panel: c[k], audit: f[k] });
  if (c.B_st30 === "ok") { const o = outB(c.sym, c.entryDate, c.costBps, 30); note("controls", "B_xsNet30", close(o?.xsNet, c.B_xsNet30), { key: c.ctlKey, k: "B_xsNet30", panel: c.B_xsNet30, audit: o?.xsNet }); }
  // control-day exclusion: no purchase filing of the same symbol within the window must be visible in the panel rows (spot check)
}
// controls never share the event's own symbol; controls of an event are distinct symbols
let ownSym = 0, dupSym = 0; for (const r of P.rows) { const cs = C.of(r.key); if (cs.some((c) => c.sym === r.sym)) ownSym++; if (new Set(cs.map((c) => c.sym)).size !== cs.length) dupSym++; }
res.controlStructure = { eventsWithOwnSymbolControl: ownSym, eventsWithDuplicateControlSymbol: dupSym, controlsPerEvent: countBy(P.rows.filter((r) => r.priced === 1), (r) => C.of(r.key).length) };
for (const b of ["events", "controls"]) res[b].totalMismatch = Object.values(res[b].fields).reduce((a, f) => a + f.mismatch, 0);
res.elapsedSec = (Date.now() - t0) / 1000;
writeOut("a5-rederive.json", res);
checkpoint("a5_rederive", { events: res.events.n, controls: res.controls.n, mismatches: res.events.totalMismatch + res.controls.totalMismatch });
console.log(JSON.stringify({ events: { n: res.events.n, total: res.events.totalMismatch, fields: res.events.fields, ex: res.events.mismatches.slice(0, 6) }, controls: { n: res.controls.n, total: res.controls.totalMismatch, fields: res.controls.fields, ex: res.controls.mismatches.slice(0, 6) }, structure: res.controlStructure }, null, 1));
