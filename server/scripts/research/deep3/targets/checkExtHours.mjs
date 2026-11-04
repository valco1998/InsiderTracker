// deep3/targets/checkExtHours.mjs — data check (no outcomes): do the cached split-adjusted DAILY bars' high/low
// include extended-hours trades? Uses the deep-1 after-hours SIP trade cache (16:00–20:00 ET, raw prices) for
// pre-holdout filings only (joined on lib2.loadEvents ids, which hides the holdout).
import fs from "node:fs";
import path from "node:path";
import { loadEvents, loadBars, DEEP1 } from "../../deep2/lib2.mjs";
const OUT = path.join(DEEP1, "..", "deep3", "targets");
const ev = new Map(loadEvents().map((e) => [e.id, e]));
const bars = loadBars();
const cache = JSON.parse(fs.readFileSync(path.join(DEEP1, "ah-trades-cache.json"), "utf8"));
const raw = JSON.parse(fs.readFileSync(path.join(DEEP1, "ah-raw-daily.json"), "utf8"));
const rawM = new Map(Object.entries(raw).map(([k, v]) => [k, new Map(v)]));
const sym = (t) => String(t || "").trim().toUpperCase().replace(/-/g, ".");
let n = 0, aboveH = 0, belowL = 0, outside = 0; const ex = [];
for (const [id, c] of Object.entries(cache)) {
  const e = ev.get(id); if (!e || c.error || !c.trades?.length) continue; // holdout ids are not in ev
  const s = sym(e.ticker), ser = bars.get(s), rb = rawM.get(s); if (!ser || !rb) continue;
  const day = e.publishedAt.slice(0, 10); const i = ser.idx.get(day); const r = rb.get(day);
  if (i == null || !r || !(r.c > 0)) continue;
  const b = ser.arr[i]; const f = r.c / b.c; // raw / adjusted
  const px = c.trades.map((t) => t[1] / f);
  const mx = Math.max(...px), mn = Math.min(...px);
  n++;
  const a = mx > b.h * 1.002, bl = mn < b.l * 0.998;
  if (a) aboveH++; if (bl) belowL++; if (a || bl) { outside++; if (ex.length < 12) ex.push({ id, s, day, high: b.h, low: b.l, ahMax: +mx.toFixed(4), ahMin: +mn.toFixed(4), trades: px.length }); }
}
const res = { checkedAt: new Date().toISOString(), filings: n, ahMaxAboveDailyHigh: aboveH, ahMinBelowDailyLow: belowL, anyOutside: outside, shareOutside: +(outside / n).toFixed(4), examples: ex,
  reading: "If after-hours trades frequently fall outside the daily [low, high], the daily bar's high/low exclude extended-hours prints (regular-session range)." };
fs.writeFileSync(path.join(OUT, "check-ext-hours.json"), JSON.stringify(res, null, 1));
console.log(JSON.stringify(res, null, 1));
