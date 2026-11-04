// Prints the after-hours study summary (deep/afterHours.json). node scripts/research/deep/printAfterHours.mjs
import fs from "node:fs";
import path from "node:path";
import { OUT_DIR } from "../lib.mjs";
const { result, rows } = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "deep", "afterHours.json"), "utf8"));
const pct = (v) => (v == null ? "—" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(2)}%`);
const ok = rows.filter((r) => r.status === "ok");
console.log("largest |captureToOpen|:", ok.map((r) => [r.ticker, r.captureToOpen]).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 5).map((x) => x.join(" ")).join(", "));
for (const [k, s] of Object.entries(result.strata)) {
  console.log(`\n${k}: ok ${s.captureToOpen.n}/${s.sampled}; AH $ volume median $${s.ahDollars.median}; minutes to first trade ${s.minutesToFirstTrade.median}`);
  console.log(`  capture→open median ${pct(s.captureToOpen.median)} mean ${pct(s.captureToOpen.mean)} positive ${pct(s.captureToOpen.positive)} t=${s.captureToOpen.t} | AH→1d median ${pct(s.ahEntry.d1.median)} mean ${pct(s.ahEntry.d1.mean)} t=${s.ahEntry.d1.t} | 5d ${pct(s.ahEntry.d5.median)} | 20d ${pct(s.ahEntry.d20.median)}`);
  console.log(`  open-entry, same events: 1d ${pct(s.openEntrySameEvents.d1.median)} 5d ${pct(s.openEntrySameEvents.d5.median)} 20d ${pct(s.openEntrySameEvents.d20.median)}`);
  console.log(`  by split: ${Object.entries(s.bySplit).map(([sp, o]) => `${sp} n${o.n} capture ${pct(o.captureToOpen.median)} 1d ${pct(o.d1.median)}`).join(" | ")}`);
  console.log(`  net (median/mean): ${Object.entries(s.netOfCosts).map(([c, o]) => `${c}: →open ${pct(o.captureToOpenMedian)}/${pct(o.captureToOpenMean)} 1d ${pct(o.d1Median)}/${pct(o.d1Mean)}`).join(" | ")}`);
}
