// Exploration: bar dates vs session calendar, completeThrough, missing-bar frequency around design entries.
import fs from "node:fs";
import path from "node:path";
import { visible, loadBars, DESIGN_END } from "../../lib4.mjs";
import { OUT_DIR, entrySessionAfter, isSession, previousSession, nextSession } from "../../../lib.mjs";
import { COMPLETE_THROUGH } from "../../../deep2/execution/execLib.mjs";

console.log("COMPLETE_THROUGH", COMPLETE_THROUGH);
const bars = loadBars();
const spy = bars.get("SPY"); const days = spy.arr.map((b) => b.d); const idx = new Map(days.map((d, i) => [d, i]));
let nonSess = 0, notInSpy = 0; const ex = [];
for (const [s, ser] of bars) for (const b of ser.arr) { if (!isSession(b.d)) { nonSess++; if (ex.length < 5) ex.push([s, b.d]); } if (!idx.has(b.d)) notInSpy++; }
console.log("bars on non-session dates", nonSess, JSON.stringify(ex), "bars not on SPY dates", notInSpy);
// SPY days vs app calendar
let d = days[0], missing = [];
while (d <= days.at(-1)) { if (!idx.has(d)) missing.push(d); d = nextSession(d); }
console.log("calendar sessions without SPY bar", missing.length, JSON.stringify(missing.slice(0, 10)));
const pf = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "deep3", "dataquality", "p-filings.json"), "utf8"));
const rows = visible(pf.rows, (r) => r.publishedAt, "panel");
const sym = (t) => String(t || "").trim().toUpperCase().replace(/-/g, ".");
const addDays = (dd, n) => new Date(Date.parse(`${dd}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const onOrBefore = (dd) => (isSession(dd) ? dd : previousSession(dd));
let withSeries = 0, entryBar = 0, exitMiss = { 5: 0, 10: 0, 20: 0, 30: 0 }, exitTot = { 5: 0, 10: 0, 20: 0, 30: 0 }, entryMiss = 0, entryMissInside = 0;
let moo = 0;
for (const r of rows) {
  const s = bars.get(sym(r.ticker)); if (!s || !s.arr.length) continue; withSeries++;
  const E = entrySessionAfter(r.publishedAt, 60);
  const t = r.publishedAt.slice(11); if (E === r.publishedAt.slice(0, 10) && t > "09:27:00" && t <= "09:29:00") moo++;
  if (!s.idx.has(E)) { entryMiss++; if (E > s.arr[0].d && E < s.arr.at(-1).d) entryMissInside++; continue; }
  entryBar++;
  for (const H of [5, 10, 20, 30]) { const X = onOrBefore(addDays(E, H)); if (X >= DESIGN_END) continue; exitTot[H]++; if (!s.idx.has(X)) exitMiss[H]++; }
}
console.log({ withSeries, entryBar, entryMiss, entryMissInside, exitMiss, exitTot, mooWindow: moo });
