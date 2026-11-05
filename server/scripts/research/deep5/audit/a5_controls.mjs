// Task 5: control audit. Point-in-time pool checks, pool-vs-matched comparison, future-insider-selection demonstration (descriptive),
// universe-vs-SPY/IWM, matching balance, control reuse.
import * as A from "./alib.mjs";
const rows = A.loadRows(); const K = A.market();
const P = rows.filter((r) => r.code === "P");
const { rows: elig } = A.eligibleRows(P, K);
const R = A.pipeline(K, elig, { allP: P });
const M = R.main.filter((c) => c.ctrlSt === "ok");
// acceptance stamps per symbol (all P rows) for "next purchase" look-ups — DESCRIPTIVE ONLY
const accBy = new Map(); for (const r of P) { const s = A.sym(r.ticker); if (!s || !r.acceptedAt) continue; if (!accBy.has(s)) accBy.set(s, []); accBy.get(s).push(r.acceptedAt); }
for (const v of accBy.values()) v.sort();
const nextP = (s, T) => { const v = accBy.get(s) || []; const x = v.find((a) => a > T); return x ? A.dn(x) - A.dn(T) : null; };
const ev = (o, cost) => ({ n180: A.net(o.ret[180], cost), maxGain: o.maxGain, hit20: o.hit[20] != null ? 1 : 0, vol: null });
const per = [];
for (const c of M) {
  const pOut = c.pool.map((p) => ({ s: p.s, ...ev(R.P(p.s, c.E, c.mode), A.costOf(p.f.adv)), nxt: nextP(p.s, c.T) }));
  const g = (f) => pOut.filter(f);
  const m = (xs, k) => A.avg(xs.map((x) => x[k]));
  const near = g((x) => x.nxt != null && x.nxt <= 60), far = g((x) => x.nxt == null || x.nxt > 60), inWin = g((x) => x.nxt != null && x.nxt <= 180), none = g((x) => x.nxt == null || x.nxt > 180);
  const ctlNxt = c.ctrl.map((x) => nextP(x.s, c.T));
  per.push({ id: c.id, cik: c.cik, E: c.E, ev_n180: c.n180, ev_maxGain: c.maxGain, ev_hit20: c.hit20, spy180: c.spy.ret[180], iwm180: (() => { const o = R.P("IWM", c.E, c.mode); return o?.ret[180] ?? null; })(),
    ctl_n180: c.ctl_n180, ctl_maxGain: c.ctl_maxGain, ctl_hit20: c.ctl_hit20, pool_n: pOut.length, pool_n180: m(pOut, "n180"), pool_maxGain: m(pOut, "maxGain"), pool_hit20: m(pOut, "hit20"), pool_medN180: A.med(pOut.map((x) => x.n180)),
    near60_n: near.length, near60_n180: m(near, "n180"), near60_maxGain: m(near, "maxGain"), far60_n: far.length, far60_n180: m(far, "n180"), far60_maxGain: m(far, "maxGain"),
    futIn180_n180: m(inWin, "n180"), futNone180_n180: m(none, "n180"), poolShareNear60: near.length / pOut.length, ctlShareNear60: A.avg(ctlNxt.map((x) => (x != null && x <= 60 ? 1 : 0))) });
}
const col = (k) => A.avg(per.map((x) => x[k]));
const diff = (a, b) => A.boot(per.filter((x) => x[a] != null && x[b] != null), (xs) => A.avg(xs.map((x) => x[a] - x[b])));
// matching balance: standardized differences event vs mean of its controls (pre-entry features) + realised post-entry volatility
function postVol(sy, E, mode) { const s = K.S.get(sy); const i0 = s.ix.get(E); const end = A.add(E, 180); const lr = []; for (let j = i0 + 1; j < s.a.length && s.a[j][0] <= end; j++) lr.push(Math.log(s.a[j][4] / s.a[j - 1][4])); return A.sdev(lr); }
const bal = M.map((c) => { const cf = c.ctrl.map((x) => R.F(x.s, c.E)); return { ev: A.vecOf(c.f), ct: [0, 1, 2, 3, 4].map((k) => A.avg(cf.map((f) => A.vecOf(f)[k]))), evPV: postVol(c.ticker, c.E, c.mode), ctPV: A.avg(c.ctrl.map((x) => postVol(x.s, c.E, c.mode))) }; });
const names = ["logADV", "r30", "r60", "logVol40", "logPrice"];
const balance = Object.fromEntries(names.map((n, k) => { const d = bal.map((b) => b.ev[k] - b.ct[k]); const sdE = A.sdev(bal.map((b) => b.ev[k])); return [n, { evMean: A.avg(bal.map((b) => b.ev[k])), ctlMean: A.avg(bal.map((b) => b.ct[k])), meanDiff: A.avg(d), stdDiff: A.avg(d) / sdE }]; }));
// control reuse
const use = {}; for (const c of M) for (const x of c.ctrl) use[x.s] = (use[x.s] || 0) + 1;
const reuse = Object.entries(use).sort((a, b) => b[1] - a[1]);
const res = {
  n: M.length,
  pointInTime: "pool = symbols with any P filing accepted <= T (firstP), bar on E, features from bars < E, no own-clock cluster with time <= T in [E-30, E]; exact reproduction of all ctrlSyms/poolSize in a1 (0 mismatches) using an independent implementation that never reads acceptance stamps > T",
  means: { event_n180: col("ev_n180"), matched_ctl_n180: col("ctl_n180"), pool_n180: col("pool_n180"), pool_median_n180: col("pool_medN180"), spy180: col("spy180"), iwm180: col("iwm180"),
    event_maxGain: col("ev_maxGain"), matched_ctl_maxGain: col("ctl_maxGain"), pool_maxGain: col("pool_maxGain"), event_hit20: col("ev_hit20"), matched_ctl_hit20: col("ctl_hit20"), pool_hit20: col("pool_hit20"),
    poolNext60_n180: col("near60_n180"), poolNotNext60_n180: col("far60_n180"), poolNext60_maxGain: col("near60_maxGain"), poolNotNext60_maxGain: col("far60_maxGain"), poolFutureIn180_n180: col("futIn180_n180"), poolNoFuture180_n180: col("futNone180_n180"),
    poolShareNext60: col("poolShareNear60"), matchedCtlShareNext60: col("ctlShareNear60") },
  tests: { matched_minus_pool_n180: diff("ctl_n180", "pool_n180"), matched_minus_pool_maxGain: diff("ctl_maxGain", "pool_maxGain"), event_minus_pool_n180: diff("ev_n180", "pool_n180"), event_minus_pool_maxGain: diff("ev_maxGain", "pool_maxGain"), event_minus_IWM: diff("ev_n180", "iwm180"), pool_minus_spy: diff("pool_n180", "spy180"), iwm_minus_spy: diff("iwm180", "spy180"), next60_minus_notNext60_n180: diff("near60_n180", "far60_n180") },
  balance, postEntryVol: { event: A.avg(bal.map((b) => b.evPV)), controls: A.avg(bal.map((b) => b.ctPV)), eventMedian: A.med(bal.map((b) => b.evPV)), ctlMedian: A.med(bal.map((b) => b.ctPV)) },
  preEntryVol40: { event: A.avg(bal.map((b) => Math.exp(b.ev[3]))), controls: A.avg(bal.map((b) => Math.exp(b.ct[3]))) },
  controlReuse: { distinctControls: reuse.length, slots: M.length * 5, top10: reuse.slice(0, 10) },
};
A.save("a5_controls.json", res); A.save("a5_controls_per_event.csv", A.csv(per));
console.log(JSON.stringify(res, (k, v) => (typeof v === "number" ? Math.round(v * 10000) / 10000 : v), 1));
