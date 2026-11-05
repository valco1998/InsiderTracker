// Tasks 6 + 7: own bootstrap of P1-P4 (U), BH re-check, dependence (window overlap, time clustering), max-gain artefact checks,
// peak-timing vs random walk / controls / within-path permutation.
import fs from "node:fs";
import path from "node:path";
import * as A from "./alib.mjs";
const rows = A.loadRows(); const K = A.market();
const P = rows.filter((r) => r.code === "P");
const { rows: elig } = A.eligibleRows(P, K);
const R = A.pipeline(K, elig, { allP: P });
const M = R.main, U = M.filter((c) => c.ctrlSt === "ok");
const out = {};
// ---- 6a own bootstrap (issuer clusters, 10k reps, different RNG) ----
const st = { P1: (x) => A.avg(x.map((c) => c.n180 - c.ctl_n180)), P3: (x) => A.avg(x.map((c) => c.hit20 - c.ctl_hit20)), P4: (x) => A.avg(x.map((c) => c.maxGain - c.ctl_maxGain)) };
out.ownBoot = { P1: A.boot(U, st.P1, { reps: 10000, seed: 99 }), P2: A.boot(M.filter((c) => c.x180 != null), (x) => A.avg(x.map((c) => c.x180)), { reps: 10000, seed: 99 }), P3: A.boot(U, st.P3, { reps: 10000, seed: 99 }), P4: A.boot(U, st.P4, { reps: 10000, seed: 99 }) };
// time-clustered bootstrap (entry ISO week, entry month) — common-shock dependence
const wk = (c) => { const d = new Date(c.E + "T00:00:00Z"); const t = new Date(d); t.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return t.toISOString().slice(0, 10); };
out.timeClustered = {};
for (const [k, f] of Object.entries(st)) out.timeClustered[k] = { week: A.boot(U, f, { reps: 10000, seed: 5, key: wk }), month: A.boot(U, f, { reps: 10000, seed: 5, key: (c) => c.E.slice(0, 7) }) };
out.timeClustered.P2 = { week: A.boot(M, (x) => A.avg(x.map((c) => c.x180)), { reps: 10000, seed: 5, key: wk }), month: A.boot(M, (x) => A.avg(x.map((c) => c.x180)), { reps: 10000, seed: 5, key: (c) => c.E.slice(0, 7) }) };
// ---- 6b BH re-check on tests.csv ----
const T = fs.readFileSync(path.join(A.D5, "tests.csv"), "utf8").trim().split("\n").slice(1).map((l) => { const m = l.match(/^([^,]+),([^,]+),(?:"[^"]*"|[^,]*),([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),([^,]*)$/); return m ? { id: m[1], p: m[8] === "" ? null : +m[8], q: m[9] === "" ? null : +m[9] } : { bad: l }; });
const q = A.bhq(T.map((t) => t.p));
out.bh = { tests: T.length, withP: T.filter((t) => t.p != null).length, parseFail: T.filter((t) => t.bad).length, maxAbsQDiff: Math.max(...T.map((t, i) => (t.q == null ? 0 : Math.abs(t.q - q[i])))), significantQ10: T.filter((t, i) => q[i] != null && q[i] < 0.1).map((t, i) => t.id) };
// sanity: K1 q with only the 16 primary p-values or the 1,494 earlier tests not available here
// ---- 6c dependence: 180-day window overlap ----
let ov = 0, np = 0; for (let i = 0; i < M.length; i++) for (let j = i + 1; j < M.length; j++) { const o = Math.max(0, 180 - Math.abs(A.dn(M[i].E) - A.dn(M[j].E))); ov += o / 180; np++; }
const ents = M.map((c) => c.E).sort();
out.dependence = { events: M.length, issuers: new Set(M.map((c) => c.cik)).size, meanPairwiseWindowOverlap: ov / np, entryFirst: ents[0], entryLast: ents.at(-1), entriesByMonth: Object.fromEntries([...A.byKey(M, (c) => c.E.slice(0, 7))].map(([k, v]) => [k, v.length])).valueOf(),
  calendarSpan: [ents[0], A.add(ents.at(-1), 180)], spyOverSpan: (() => { const s = K.S.get("SPY"); return s.a[K.le(s, A.add(ents.at(-1), 180))][4] / s.a[s.ix.get(ents[0])][1] - 1; })(),
  designEffect: Object.fromEntries(Object.keys(st).map((k) => [k, (out.timeClustered[k].week.se / out.ownBoot[k].se) ** 2])) };
// ---- 6d max-gain artefact checks ----
function postVol(sy, E) { const s = K.S.get(sy); const i0 = s.ix.get(E); const end = A.add(E, 180); const lr = []; for (let j = i0 + 1; j < s.a.length && s.a[j][0] <= end; j++) lr.push(Math.log(s.a[j][4] / s.a[j - 1][4])); return A.sdev(lr); }
const art = U.map((c) => { const evPV = postVol(c.ticker, c.E); const cPV = c.ctrl.map((x) => postVol(x.s, c.E)); return { c, evPV, cPV: A.avg(cPV), evZ: Math.log(1 + c.maxGain) / evPV, cZ: A.avg(c.ctrl.map((x, i) => Math.log(1 + x.o.maxGain) / cPV[i])), evLM: Math.log(1 + c.maxGain), cLM: A.avg(c.ctrl.map((x) => Math.log(1 + x.o.maxGain))), evMC: c.o.maxCloseGain, cMC: A.avg(c.ctrl.map((x) => x.o.maxCloseGain)), preRatio: Math.log(c.f.vol) - A.avg(c.ctrl.map((x) => Math.log(R.F(x.s, c.E).vol))) }; });
const ols = (xs, ys) => { const mx = A.avg(xs), my = A.avg(ys); let sxy = 0, sxx = 0; for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; } const b = sxy / sxx; return { slope: b, intercept: my - b * mx }; };
const it = art.map((a) => ({ ...a, cik: a.c.cik, dMax: a.c.maxGain - a.c.ctl_maxGain, dLogVol: Math.log(a.evPV) - Math.log(a.cPV) }));
out.maxGainArtefact = {
  postVol: { eventMean: A.avg(it.map((a) => a.evPV)), ctlMean: A.avg(it.map((a) => a.cPV)), logRatio: A.boot(it, (x) => A.avg(x.map((a) => a.dLogVol))) },
  preVolLogRatioEventMinusCtl: A.avg(it.map((a) => a.preRatio)),
  P4_mean: A.boot(it, (x) => A.avg(x.map((a) => a.dMax))),
  P4_median: A.boot(it, (x) => A.med(x.map((a) => a.dMax))),
  P4_logMaxGain: A.boot(it, (x) => A.avg(x.map((a) => a.evLM - a.cLM))),
  P4_maxCloseGain: A.boot(it, (x) => A.avg(x.map((a) => a.evMC - a.cMC))),
  P4_volNormalised_logMax_over_postVol: A.boot(it, (x) => A.avg(x.map((a) => a.evZ - a.cZ))),
  P4_regressionInterceptAtEqualPostVol: A.boot(it, (x) => ols(x.map((a) => a.dLogVol), x.map((a) => a.dMax)).intercept),
  regression: ols(it.map((a) => a.dLogVol), it.map((a) => a.dMax)),
  excludingFundLike: (() => { const FUND = /\b(FUND|TRUST|INCOME|BDC|CAPITAL CORP)\b/i; return "see clusters.json fundLike"; })(),
};
// ---- 7 peak timing ----
const ctlPeaks = U.flatMap((c) => c.ctrl.map((x) => x.o.daysToMax));
const evPeaks = M.map((c) => c.o.daysToMax);
const sess = M.map((c) => c.o.nBars);
// arcsine law (driftless continuous RW): P(argmax <= x*T) = (2/pi) asin(sqrt(x)); median = T/2
const share = (xs, f) => A.avg(xs.map((x) => (f(x) ? 1 : 0)));
// within-path permutation null: shuffle each event's own daily log returns (open-entry: first step = open->close of day 0 handled by including h/l? use closes only)
const Rn = A.rand(123); const permMed = [], permLate = [], permEarly = [];
const closePaths = M.map((c) => { const s = K.S.get(c.ticker); const i0 = s.ix.get(c.E); const end = A.add(c.E, 180); const px = [s.a[i0][1]]; const ds = [c.E]; for (let j = i0; j < s.a.length && s.a[j][0] <= end; j++) { px.push(s.a[j][4]); ds.push(s.a[j][0]); } return { px, ds, E: c.E }; });
const argmaxDays = (px, ds, E) => { let m = -1, k = 0; for (let i = 0; i < px.length; i++) if (px[i] > m) { m = px[i]; k = i; } return A.dn(ds[Math.max(0, k)]) - A.dn(E); };
const obsCloseDays = closePaths.map((p) => argmaxDays(p.px, p.ds, p.E));
for (let rep = 0; rep < 500; rep++) {
  const d = closePaths.map((p) => { const lr = []; for (let i = 1; i < p.px.length; i++) lr.push(Math.log(p.px[i] / p.px[i - 1])); for (let i = lr.length - 1; i > 0; i--) { const j = Math.floor(Rn() * (i + 1)); [lr[i], lr[j]] = [lr[j], lr[i]]; } const px = [p.px[0]]; for (const r of lr) px.push(px.at(-1) * Math.exp(r)); return argmaxDays(px, p.ds, p.E); });
  permMed.push(A.med(d)); permLate.push(share(d, (x) => x > 150)); permEarly.push(share(d, (x) => x <= 10));
}
// driftless Gaussian RW with the same number of steps (pure arcsine benchmark, in sessions mapped to calendar days via each event's own dates)
const rwMed = []; for (let rep = 0; rep < 500; rep++) { const d = closePaths.map((p) => { const px = [0]; for (let i = 1; i < p.px.length; i++) { const u1 = Rn() || 1e-12, u2 = Rn(); px.push(px.at(-1) + Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)); } return argmaxDays(px, p.ds, p.E); }); rwMed.push(A.med(d)); }
out.peakTiming = {
  eventMedianDaysToMaxHigh: A.med(evPeaks), eventMedianDaysToMaxClose_closePath: A.med(obsCloseDays), medianSessionsInWindow: A.med(sess),
  controlsPooledMedianDays: A.med(ctlPeaks), controlsPooledN: ctlPeaks.length, eventMinusCtlPooledMedian: A.boot(U, (x) => A.med(x.map((c) => c.o.daysToMax)) - A.med(x.flatMap((c) => c.ctrl.map((y) => y.o.daysToMax)))),
  shareFirst10d: { event: share(evPeaks, (x) => x <= 10), controls: share(ctlPeaks, (x) => x <= 10) }, shareLast30d: { event: share(evPeaks, (x) => x > 150), controls: share(ctlPeaks, (x) => x > 150) },
  arcsineTheory: { medianFractionOfWindow: 0.5, medianCalendarDaysApprox: 90, P_first10d: (2 / Math.PI) * Math.asin(Math.sqrt(10 / 180)), P_last30d: 1 - (2 / Math.PI) * Math.asin(Math.sqrt(150 / 180)) },
  driftlessRW_sameDates: { median: A.med(rwMed), p05: A.qtl(rwMed, 0.05), p95: A.qtl(rwMed, 0.95) },
  withinPathPermutation: { median: A.med(permMed), p05: A.qtl(permMed, 0.05), p95: A.qtl(permMed, 0.95), shareLast30: A.med(permLate), shareFirst10: A.med(permEarly) },
  histogram20d: Object.fromEntries([0, 20, 40, 60, 80, 100, 120, 140, 160].map((b) => [b, { ev: share(evPeaks, (x) => x >= b && x < (b === 160 ? 181 : b + 20)), ctl: share(ctlPeaks, (x) => x >= b && x < (b === 160 ? 181 : b + 20)) }])),
};
A.save("a6_stats.json", out);
console.log(JSON.stringify(out, (k, v) => (typeof v === "number" ? Math.round(v * 10000) / 10000 : v), 1));
