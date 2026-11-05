// Spot re-check of frozen strategies S1-S3 on the confirm period (independent pipeline).
import * as A from "./alib.mjs";
const rows = A.loadRows(); const K = A.market(); const P = rows.filter((r) => r.code === "P");
const R = A.pipeline(K, A.eligibleRows(P, K).rows, { allP: P });
const U = R.main.filter((c) => c.ctrlSt === "ok").map((c) => ({ ...c, n90: A.net(c.o.ret[90], c.cost), ctl_n90: A.avg(c.ctrl.map((x) => A.net(x.o.ret[90], x.cost))), spy90: c.spy.ret[90] }));
const conf = U.filter((c) => c.E >= "2026-03-01");
const ev = (xs, h) => { const it = xs.map((c) => ({ cik: c.cik, m: c.E.slice(0, 7), d: c[`n${h}`] - c[`ctl_n${h}`], s: c[`n${h}`] - c.spy.ret[h] })); const b = A.boot(it, (x) => A.avg(x.map((i) => i.d)), { seed: 11 }); const months = [...A.byKey(it, (i) => i.m)].map(([m, v]) => [m, A.avg(v.map((i) => i.d))]); return { n: it.length, vsCtl: b.est, lo90: b.lo90, vsSpy: A.avg(it.map((i) => i.s)), monthsPos: months.filter((x) => x[1] > 0).length, pass: b.est > 0 && A.avg(it.map((i) => i.s)) > 0 && b.lo90 > 0 && months.filter((x) => x[1] > 0).length >= 2 }; };
const out = { S1: ev(conf, 180), S2: ev(conf.filter((c) => /[BC]/.test(c.cats)), 180), S3: ev(conf, 90) };
A.save("a8_strategies.json", out); console.log(JSON.stringify(out));
