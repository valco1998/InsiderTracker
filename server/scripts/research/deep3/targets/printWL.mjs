// deep3/targets/printWL.mjs — prints compact winner/loser lines from winners-losers.json (read-only).
import { readOut } from "./common.mjs";
const W = readOut("winners-losers.json").patterns;
const P = (v) => (v == null || !Number.isFinite(v) ? "n/a" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(0)}%`);
for (const [pid, v] of Object.entries(W)) {
  console.log(`## ${pid} ${v.outcome} n ${v.n} distinct ${v.distinctSituations}`);
  for (const side of ["winners", "losers"]) {
    console.log(side);
    for (const x of v[side]) {
      const c = x.chart;
      const multi = x.sameDayFilings > 1 ? `, ${x.sameDayFilings} filings` : "";
      console.log(`${x.ticker} ${x.entryDate} (${x.period === "discover" ? "D" : "C"}, ${x.role}, $${Math.round(x.filingValue / 1000)}k${multi}): ${P(x.value)}; prior60 ${P(c.ret60)}, dd60 ${P(c.dd60)}, pos ${c.pos60 == null ? "n/a" : c.pos60.toFixed(2)}, vol ${(c.vol20 * 100).toFixed(1)}%, vol5/60 ${c.vol5vs60 == null ? "n/a" : c.vol5vs60.toFixed(1)}x, gap ${P(c.gap)}, day0 ${P(c.day0)}, x1 ${P(c.x1)}, x5 ${P(c.x5)}, MFE5 ${P(c.mfe5)}, MAE5 ${P(c.mae5)}, +10% ${c.ttt10 == null ? "no" : `s${c.ttt10}`}`);
    }
  }
}
