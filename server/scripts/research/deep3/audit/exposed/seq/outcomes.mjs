// deep3/sequence/outcomes.mjs — per-filing outcomes + matched controls (computed AFTER register.mjs). No tests here.
//   node scripts/research/deep3/sequence/outcomes.mjs
// For every pre-holdout code-P filing with a bar on its entry session:
//   • entry = official open of the first session >= acceptance + 60 s (lib.mjs entrySessionAfter, same as stage C);
//   • cost per side = stage-C tier from the 20 sessions before the (largest row's) trade date;
//   • touches / time to touch / drawdown before touch / MFE / MAE / time to the 10-session high (daily highs & lows);
//   • realised net excess vs SPY at the close of N = 0,1,2,3,5,10 sessions after entry (cost ×1, ×2, ×3);
//   • the BRIEF limit take-profit approximation (fill at max(open, target) when high >= target × 1.005);
//   • variants: same-day-close entry (published on a session day before close − 30 min) and a one-session-delay open entry;
//   • pre-publication moves: trade date → last close before entry, 20 sessions before the first trade, entry gap vs SPY.
// Every window obeys the lib2 embargo: sessions must fall before the end of the filing's period (discovery < 2026-06-15,
// confirmation < 2026-09-01). Holdout filings were never built.
// Controls: K = 10 non-event stock-days per filing for each design (volOnly, volMom, volMomGap) — copied from deep2/chart.
import fs from "node:fs";
import path from "node:path";
import {
  L, EXPOSED, readOut, writeOut, writePretty, calendar, featuresAt, pathOutcome, periodOfDate, periodEnd, costBpsFor, tierOf, CONTROL_SETS, robustScales, indexPool,
  prepareVectors, nearest, purchaseBlocks, buildPool, adjFactorOf, adv20Before, closeTime, isSession, r4, mean, median, TARGETS, TKEY, TOUCH_W, HORIZONS, TP_N, sd,
} from "./common.mjs";

const t0 = Date.now();
const filings = readOut("filings.json");
const bars = L.loadBars();
const cal = calendar(bars);
const sec = await L.loadSecRows();
const stageA = JSON.parse(fs.readFileSync(path.join(L.DEEP1, "stageA.json"), "utf8"));
const COMPLETE = stageA.completeThrough;
const SUSPECT = new Set(stageA.prices.suspectSymbols || []);
const S = cal.spy.arr;
const minus30 = (t) => { const [h, m, s] = t.split(":").map(Number); const x = h * 60 + m - 30; return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}:${String(s).padStart(2, "0")}`; };
const slim = (o) => (o ? { avail: o.avail, availTouchW: o.availTouchW, entry: r4(o.entry), first: o.first, ddBefore: o.ddBefore, ddBeforeStrict: o.ddBeforeStrict, mfe: o.mfe, mae: o.mae, toMaxHigh10: o.toMaxHigh10, x: o.x, gross: o.gross, spyR: o.spyR, exitDate: o.exitDate, tp: o.tp } : null);

const out = {};
const evRows = []; // rows for matching
for (const f of filings) {
  const per = periodOfDate(f.acceptedAt);
  if (per === "holdout" && !EXPOSED) continue; // never built, defensive (audit3: built in the exposed run)
  if (f.priced !== "ok") { out[f.acc] = { status: f.priced }; continue; }
  const ser = bars.get(f.sym); const j0 = cal.idx.get(f.entryDate); const k0 = ser.idx.get(f.entryDate);
  if (j0 == null || k0 == null) { out[f.acc] = { status: "entry_not_in_calendar" }; continue; }
  const pe = periodEnd(per);
  const td = f.tradeDateLargest || f.tradeDateMax;
  let avgDollarVol20 = null;
  if (td) { const jt = cal.firstOnOrAfter(td); let dv = 0, nd = 0; for (let q = jt - 1; q >= jt - 20 && q >= 0; q--) { const k = ser.idx.get(cal.days[q]); if (k != null) { dv += ser.arr[k].c * ser.arr[k].v; nd++; } } avgDollarVol20 = nd ? dv / nd : null; }
  const costBps = costBpsFor(avgDollarVol20);
  const o = pathOutcome(ser, cal, j0, { mode: "open", periodEndDate: pe, costBps, completeThrough: COMPLETE });
  if (!o) { out[f.acc] = { status: "no_entry_price" }; continue; }
  const feat = k0 >= 1 ? featuresAt(ser, k0 - 1, cal) : null;
  // pre-publication moves (all from bars strictly before the entry session)
  const dec = k0 - 1, decBar = dec >= 0 ? ser.arr[dec] : null;
  const spyOn = (d) => { const j = cal.idx.get(d); return j == null ? null : S[j]; };
  let pre = { tradeToDecision: null, tradeToDecisionX: null, pre20: null, pre20X: null, gapRaw: null, gapX: null, sessionsTradeToEntry: null };
  if (decBar) {
    const sd0 = spyOn(decBar.d);
    pre.gapRaw = r4(o.entry / decBar.c - 1);
    if (sd0) pre.gapX = r4(o.entry / decBar.c - 1 - (S[j0].o / sd0.c - 1));
    if (f.tradeDateMax) {
      let iT = ser.idx.get(f.tradeDateMax); if (iT == null) iT = L.idxBefore(ser, f.tradeDateMax);
      if (iT >= 0 && iT <= dec) { const st = spyOn(ser.arr[iT].d); pre.tradeToDecision = r4(decBar.c / ser.arr[iT].c - 1); if (st && sd0) pre.tradeToDecisionX = r4(decBar.c / ser.arr[iT].c - 1 - (sd0.c / st.c - 1)); }
      const jt = cal.firstOnOrAfter(f.tradeDateMax); pre.sessionsTradeToEntry = j0 - jt;
    }
    if (f.tradeDateMin) {
      const i1 = L.idxBefore(ser, f.tradeDateMin);
      if (i1 >= 20) { const a = ser.arr[i1], b = ser.arr[i1 - 20], sa = spyOn(a.d), sb = spyOn(b.d); pre.pre20 = r4(a.c / b.c - 1); if (sa && sb) pre.pre20X = r4(a.c / b.c - 1 - (sa.c / sb.c - 1)); }
    }
  }
  // variants
  const pubDay = f.acceptedAt.slice(0, 10), pubTime = f.acceptedAt.slice(11, 19);
  let oc = null, closeEligible = false;
  if (isSession(pubDay) && pubTime < minus30(closeTime(pubDay))) {
    closeEligible = true;
    const jc = cal.idx.get(pubDay);
    if (jc != null) oc = pathOutcome(ser, cal, jc, { mode: "close", periodEndDate: pe, costBps, completeThrough: COMPLETE });
  }
  const od = cal.days[j0 + 1] ? pathOutcome(ser, cal, j0 + 1, { mode: "open", periodEndDate: pe, costBps, completeThrough: COMPLETE }) : null;
  const adv20 = adv20Before(ser, cal, j0);
  const af = adjFactorOf(ser, f.tradeDateLargest, f.priceLargest);
  out[f.acc] = {
    status: "ok", period: per, sym: f.sym, cik: f.cik, entryDate: f.entryDate, costBps, avgDollarVol20: r4(avgDollarVol20), adv20: r4(adv20), capacityUsd: r4(0.01 * adv20),
    asTradedEntry: r4(o.entry / af.f), splitInferred: af.inferred, suspect: SUSPECT.has(f.sym), entryVolume: ser.arr[k0].v,
    feat: feat ? { r5: r4(feat.r5), r20: r4(feat.r20), r60: r4(feat.r60), dd60: r4(feat.dd60), pos60: r4(feat.pos60), vol20: r4(feat.vol20), dv20: r4(feat.dv20), tight: r4(feat.tight),
      breakout20: feat.breakout20, nearLow60: feat.nearLow60, sma50r: r4(feat.sma50r), volSpike: r4(feat.volSpike), volRatio5_60: r4(feat.volRatio5_60), gapPrev: r4(feat.gapPrev), spyAbove50: feat.spyAbove50 } : null,
    pre, o: slim(o), closeEligible, oc: slim(oc), od: slim(od),
  };
  if (feat) evRows.push({ acc: f.acc, m: f.entryDate.slice(0, 7), per, tier: tierOf(feat.dv20), r5: feat.r5, r20: feat.r20, dd60: feat.dd60, vol20: feat.vol20, dv20: feat.dv20, gapPrev: feat.gapPrev, gapX: pre.gapX, costBps });
}
console.log(`[outcomes] filings with outcomes: ${Object.values(out).filter((x) => x.status === "ok").length}; ${Date.now() - t0} ms`);
writeOut("outcomes.json", out); // checkpoint before controls

// ---- matched controls ----
const { blocked } = await purchaseBlocks(cal, sec);
const pool = buildPool(bars, cal, blocked);
const byMT = indexPool(pool.rows);
const nSyms = pool.syms.length;
console.log(`[controls] pool rows ${pool.rows.length}; ${Date.now() - t0} ms`);
const ctlMemo = new Map();
const ctlOutcome = (r) => {
  const key = `${r.s}|${r.k}`;
  if (!ctlMemo.has(key)) ctlMemo.set(key, pathOutcome(bars.get(r.s), cal, r.j, { mode: "open", periodEndDate: periodEnd(r.per), costBps: 0, completeThrough: COMPLETE }));
  return ctlMemo.get(key);
};
const netAt = (g, sr, cBps, m = 1) => { const c = (m * cBps) / 1e4; return (1 + g) * (1 - c) / (1 + c) - 1 - sr; };
const controls = {}; const balance = {};
for (const [set, feats] of Object.entries(CONTROL_SETS)) {
  const key = `v_${set}`;
  const scales = robustScales(pool.rows, feats);
  prepareVectors(pool.rows, feats, key);
  const evF = [], ctF = [];
  for (const ev of evRows) {
    const picks = nearest(ev, byMT, scales, nSyms, { K: 10, feats, key });
    if (!picks.length) continue;
    const cs = picks.map((p) => ({ r: p.r, o: ctlOutcome(p.r), dist: p.dist })).filter((x) => x.o);
    if (!cs.length) continue;
    const agg = { n: cs.length, dist: r4(mean(cs.map((x) => x.dist))), hit: {}, x: {}, x2: {}, tp: {}, mfe: {}, mae: {}, ttm: {} };
    for (const X of TARGETS) for (const W of TOUCH_W) {
      const u = cs.filter((x) => x.o.availTouchW >= W);
      agg.hit[`${TKEY(X)}w${W}`] = u.length ? r4(mean(u.map((x) => (x.o.first[TKEY(X)] != null && x.o.first[TKEY(X)] <= W ? 1 : 0)))) : null;
    }
    for (const N of HORIZONS) {
      const u = cs.filter((x) => x.o.gross[N] != null);
      agg.x[N] = u.length ? r4(mean(u.map((x) => netAt(x.o.gross[N], x.o.spyR[N], ev.costBps, 1)))) : null;
      agg.x2[N] = u.length ? r4(mean(u.map((x) => netAt(x.o.gross[N], x.o.spyR[N], ev.costBps, 2)))) : null;
    }
    for (const X of TARGETS) for (const N of TP_N) {
      const k = `${TKEY(X)}n${N}`; const u = cs.filter((x) => x.o.tp[k]);
      agg.tp[k] = u.length ? r4(mean(u.map((x) => netAt(x.o.tp[k].g, x.o.tp[k].sr, ev.costBps, 1)))) : null;
    }
    for (const W of TOUCH_W) { const u = cs.filter((x) => x.o.mfe[W] != null); agg.mfe[W] = u.length ? r4(mean(u.map((x) => x.o.mfe[W]))) : null; agg.mae[W] = u.length ? r4(mean(u.map((x) => x.o.mae[W]))) : null; }
    for (const X of TARGETS) { const u = cs.filter((x) => x.o.first[TKEY(X)] != null && x.o.availTouchW >= 10 && x.o.first[TKEY(X)] <= 10); agg.ttm[TKEY(X)] = u.length ? r4(median(u.map((x) => x.o.first[TKEY(X)]))) : null; }
    agg.refs = cs.map((x) => `${x.r.s}|${x.r.D}`);
    (controls[ev.acc] ||= {})[set] = agg;
    evF.push(ev); for (const x of cs) ctF.push(x.r);
  }
  // balance (standardized mean differences on the matching coordinates and the gap)
  const smd = (a, b) => { const ma = mean(a), mb = mean(b), va = sd(a) ** 2, vb = sd(b) ** 2; const den = Math.sqrt((va + vb) / 2); return den > 0 ? r4((ma - mb) / den) : null; };
  const coords = { r5: (r) => r.r5, r20: (r) => r.r20, dd60: (r) => r.dd60, lvol20: (r) => (r.vol20 > 0 ? Math.log(r.vol20) : null), ldv20: (r) => (r.dv20 > 0 ? Math.log(r.dv20) : null), gapPrev: (r) => r.gapPrev, gapX: (r) => r.gapX };
  balance[set] = { events: evF.length, controls: ctF.length, smd: Object.fromEntries(Object.entries(coords).map(([k, fn]) => [k, smd(evF.map(fn).filter(Number.isFinite), ctF.map(fn).filter(Number.isFinite))])) };
  console.log(`[controls] ${set}: ${evF.length} events matched; SMD ${JSON.stringify(balance[set].smd)}; ${Date.now() - t0} ms`);
}
writeOut("controls.json", controls);

// ---- validation against deep-1 stage C (same entry rule and cost tier) ----
const stage = new Map(L.loadEvents().map((e) => [e.accessionNo, e]));
const v = { compared: 0, entryDate: 0, entryPrice: 0, cost: 0, x: { 1: 0, 2: 0, 3: 0, 5: 0, 10: 0 }, xCompared: { 1: 0, 2: 0, 3: 0, 5: 0, 10: 0 }, examples: [] };
for (const [acc, r] of Object.entries(out)) {
  const e = stage.get(acc); if (!e || r.status !== "ok") continue;
  v.compared++;
  if (e.entryDate !== r.entryDate) { v.entryDate++; if (v.examples.length < 8) v.examples.push({ acc, mine: r.entryDate, stage: e.entryDate }); continue; }
  if (Math.abs(e.entryPrice - r.o.entry) > 1e-3 * e.entryPrice) v.entryPrice++;
  if (e.costBpsPerSide !== r.costBps) v.cost++;
  for (const N of [1, 2, 3, 5, 10]) { const h = e.h?.[N]; if (h?.status !== "ok" || !r.o.x[N]) continue; v.xCompared[N]++; if (Math.abs(h.excessNet - r.o.x[N][0]) > 2e-4) v.x[N]++; }
}
writePretty("validation-stageC.json", v);
writePretty("controls-balance.json", { builtAt: new Date().toISOString(), poolRows: pool.rows.length, K: 10, sets: Object.fromEntries(Object.entries(CONTROL_SETS).map(([k, fs]) => [k, fs.map((x) => x.k)])), balance });
console.log("[validation]", JSON.stringify(v));
console.log(`[done] ${Date.now() - t0} ms`);
