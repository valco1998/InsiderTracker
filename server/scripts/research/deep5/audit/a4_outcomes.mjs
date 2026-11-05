// Task 4: recompute outcomes for 40 random main-sample events directly from daily-bars.json arrays (no helper reuse).
import fs from "node:fs";
import path from "node:path";
import * as A from "./alib.mjs";
const raw = A.loadRawBars();
const J = JSON.parse(fs.readFileSync(path.join(A.D5, "clusters.json"), "utf8"));
const main = J.unions[2].filter((u) => u.full180 && !u.gap);
const spyDates = raw.SPY.map((b) => b[0]);
const dnum = (d) => Math.round(Date.parse(d + "T00:00:00Z") / 864e5);
const plus = (d, n) => new Date((dnum(d) + n) * 864e5).toISOString().slice(0, 10);
const rows = [], bad = [];
for (const c of A.sampleK(main, 40, 4040)) {
  const a = raw[c.ticker], k0 = a.findIndex((b) => b[0] === c.entryDate); const entry = a[k0][1]; // open
  const end = plus(c.entryDate, 180);
  let mx = -1, mxd = null, mc = -1, mn = 1e18; const hit = {};
  for (let k = k0; k < a.length && a[k][0] <= end; k++) {
    const [d, , h, l, cl] = a[k];
    if (h > mx) { mx = h; mxd = d; } if (cl > mc) mc = cl; if (l < mn) mn = l;
    for (const t of [10, 20, 30, 50, 100]) if (hit[t] === undefined && h >= entry * (1 + t / 100)) hit[t] = dnum(d) - dnum(c.entryDate);
  }
  const retAt = (arr, D, e0) => { let j = -1; for (let k = 0; k < arr.length; k++) if (arr[k][0] <= plus(c.entryDate, D)) j = k; return arr[j][4] / e0 - 1; };
  // 20-bar dollar volume before entry -> cost tier
  let dv = 0, n = 0; for (let k = Math.max(0, k0 - 20); k < k0; k++) { dv += a[k][4] * a[k][5]; n++; }
  const adv = dv / n; const bps = adv >= 50e6 ? 5 : adv >= 5e6 ? 15 : adv >= 1e6 ? 35 : adv > 0 ? 75 : 100; const cst = bps / 1e4;
  const spy = raw.SPY, s0 = spy.findIndex((b) => b[0] === c.entryDate);
  const r = { id: c.id, ticker: c.ticker, entryDate: c.entryDate, entry, maxGain: mx / entry - 1, maxDate: mxd, daysToMax: dnum(mxd) - dnum(c.entryDate), sessToMax: spyDates.indexOf(mxd) - spyDates.indexOf(c.entryDate), maxCloseGain: mc / entry - 1, minLowRet: mn / entry - 1, bps };
  for (const D of A.HOR) { r[`r${D}`] = retAt(a, D, entry); r[`spy${D}`] = retAt(spy, D, spy[s0][1]); }
  r.n180 = ((1 + r.r180) * (1 - cst)) / (1 + cst) - 1; r.x180 = r.n180 - r.spy180;
  for (const t of [10, 20, 30, 50, 100]) r[`dHit${t}`] = hit[t] ?? null;
  const cmp = [["entry", c.entry], ["maxGain", c.maxGain], ["maxDate", c.maxDate], ["daysToMax", c.daysToMax], ["sessToMax", c.sessToMax], ["maxCloseGain", c.maxCloseGain], ["minLowRet", c.minLowRet], ["n180", c.n180], ["x180", c.x180], ["bps", Math.round(c.costPerSide * 1e4)],
    ...A.HOR.flatMap((D) => [[`r${D}`, c[`r${D}`]], [`spy${D}`, c[`spy${D}`]]]), ...[10, 20, 30, 50, 100].map((t) => [`dHit${t}`, c[`dHit${t}`]])];
  for (const [f, v] of cmp) { const m = r[f]; const ok = typeof m === "number" && typeof v === "number" ? Math.abs(m - v) < 1e-9 : (m ?? null) === (v ?? null); if (!ok) bad.push({ id: c.id, field: f, audit: m, study: v }); }
  rows.push(r);
}
A.save("a4_outcomes_sample.csv", A.csv(rows));
A.save("a4_outcomes.json", { checked: rows.length, fieldsPerEvent: 10 + A.HOR.length * 2 + 5, mismatches: bad });
console.log(rows.length, "events checked; mismatches:", bad.length, JSON.stringify(bad.slice(0, 20)));
