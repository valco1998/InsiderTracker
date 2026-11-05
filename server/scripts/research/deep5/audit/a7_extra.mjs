// Extra checks: (1) was the post-entry volatility gap predictable from OLDER pre-entry volatility (matching artefact)?
// (2) P1/P4 excluding fund-like issuers and re-matching on 100-session vol; (3) K1 decomposition into disclosure-lag move vs window-end shift.
import fs from "node:fs";
import path from "node:path";
import * as A from "./alib.mjs";
const rows = A.loadRows(); const K = A.market();
const P = rows.filter((r) => r.code === "P");
const { rows: elig } = A.eligibleRows(P, K);
const R = A.pipeline(K, elig, { allP: P });
const U = R.main.filter((c) => c.ctrlSt === "ok");
const J = JSON.parse(fs.readFileSync(path.join(A.D5, "clusters.json"), "utf8"));
const fund = new Map(J.unions[2].map((u) => [u.repId, u.fundLike]));
const volWin = (sy, E, from, to) => { const s = K.S.get(sy); const i = K.le(s, A.add(E, -1)); const lr = []; for (let j = Math.max(1, i - to); j <= i - from; j++) lr.push(Math.log(s.a[j][4] / s.a[j - 1][4])); return lr.length >= 20 ? A.sdev(lr) : null; };
const out = {};
// (1) older vol (sessions 41..100 before entry) events vs matched controls
const ov = U.map((c) => ({ cik: c.cik, ev: volWin(c.ticker, c.E, 40, 100), ct: A.avg(c.ctrl.map((x) => volWin(x.s, c.E, 40, 100))) })).filter((x) => x.ev && x.ct);
out.olderVol_41to100 = { n: ov.length, logRatio: A.boot(ov, (x) => A.avg(x.map((a) => Math.log(a.ev) - Math.log(a.ct)))) };
// (2) re-match: same pool, add log vol over sessions 41..100 as a 6th feature (pre-entry information only) — exploratory
const reMatched = [];
for (const c of U) {
  const ev = [...A.vecOf(c.f), Math.log(volWin(c.ticker, c.E, 40, 100) || NaN)]; if (!Number.isFinite(ev[5])) continue;
  const cand = c.pool.map((p) => ({ p, v: [...p.v, Math.log(volWin(p.s, c.E, 40, 100) || NaN)] })).filter((x) => Number.isFinite(x.v[5]));
  const sc = [0, 1, 2, 3, 4, 5].map((k) => Math.max(1e-6, (A.qtl(cand.map((x) => x.v[k]), 0.75) - A.qtl(cand.map((x) => x.v[k]), 0.25)) / 1.349));
  const nb = cand.map((x) => ({ x, d: Math.sqrt(x.v.reduce((s, y, k) => s + ((y - ev[k]) / sc[k]) ** 2, 0)) })).sort((a, b) => a.d - b.d).slice(0, 5);
  const o = nb.map(({ x }) => ({ o: R.P(x.p.s, c.E, c.mode), cost: A.costOf(x.p.f.adv) })).filter((y) => y.o && !y.o.empty);
  reMatched.push({ cik: c.cik, fundLike: fund.get(c.id) || 0, n180: c.n180, maxGain: c.maxGain, hit20: c.hit20, c_n180: A.avg(o.map((y) => A.net(y.o.ret[180], y.cost))), c_maxGain: A.avg(o.map((y) => y.o.maxGain)), c_hit20: A.avg(o.map((y) => (y.o.hit[20] != null ? 1 : 0))) });
}
out.rematchWithOlderVol = { n: reMatched.length, P1: A.boot(reMatched, (x) => A.avg(x.map((a) => a.n180 - a.c_n180))), P3: A.boot(reMatched, (x) => A.avg(x.map((a) => a.hit20 - a.c_hit20))), P4: A.boot(reMatched, (x) => A.avg(x.map((a) => a.maxGain - a.c_maxGain))) };
const nf = U.filter((c) => !fund.get(c.id));
out.excludeFundLike = { n: nf.length, fundLikeEvents: U.length - nf.length, P1: A.boot(nf, (x) => A.avg(x.map((c) => c.n180 - c.ctl_n180))), P4: A.boot(nf, (x) => A.avg(x.map((c) => c.maxGain - c.ctl_maxGain))), P3: A.boot(nf, (x) => A.avg(x.map((c) => c.hit20 - c.ctl_hit20))) };
// (3) K1 decomposition
const linked = R.main.filter((c) => c.c1 && c.c1.o && !c.c1.o.empty && c.c1.o.ret[180] != null && c.r180 != null);
const dec = linked.map((c) => { const s = K.S.get(c.ticker); const d = c.c1.E; const cD = s.a[s.ix.get(d)][4], oE = s.a[s.ix.get(c.E)][1];
  const cEnd1 = s.a[K.le(s, A.add(d, 180))][4], cEnd2 = s.a[K.le(s, A.add(c.E, 180))][4];
  return { cik: c.cik, k1: c.c1.o.ret[180] - c.r180, lagMove: Math.log(oE / cD), endShift: Math.log(cEnd2 / cEnd1), lagDays: A.dn(c.E) - A.dn(d) }; });
out.K1 = { n: dec.length, k1: A.boot(dec, (x) => A.avg(x.map((a) => a.k1))), k1Median: A.med(dec.map((a) => a.k1)), lagMove_logCompletionCloseToEntryOpen: A.boot(dec, (x) => A.avg(x.map((a) => a.lagMove))), endShift_log: A.boot(dec, (x) => A.avg(x.map((a) => a.endShift))), medianLagDays: A.med(dec.map((a) => a.lagDays)), shareLagMovePositive: A.avg(dec.map((a) => (a.lagMove > 0 ? 1 : 0))) };
A.save("a7_extra.json", out);
const sh = (b) => [b.est, b.lo95, b.hi95, b.p].map((x) => Math.round(x * 1e4) / 1e4).join(" ");
console.log("olderVol", out.olderVol_41to100.n, sh(out.olderVol_41to100.logRatio));
for (const k of ["P1", "P3", "P4"]) console.log("rematch", k, out.rematchWithOlderVol.n, sh(out.rematchWithOlderVol[k]));
for (const k of ["P1", "P3", "P4"]) console.log("noFund", k, out.excludeFundLike.n, sh(out.excludeFundLike[k]));
console.log("K1", out.K1.n, sh(out.K1.k1), "lag", sh(out.K1.lagMove_logCompletionCloseToEntryOpen), "end", sh(out.K1.endShift_log), "medLag", out.K1.medianLagDays, "pos", out.K1.shareLagMovePositive, "med", out.K1.k1Median);
