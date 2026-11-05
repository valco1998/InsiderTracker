// deep6/lib6.mjs — deep6 data inputs for the unchanged deep5 pipeline. Research only, cache only.
//   SEC:    .cache/research/deep6/sec-rows.json (deep2 row mapping of the complete Nov 2025 – Nov 2026 store)
//   prices: .cache/research/deep6/daily-bars-ext.json (Alpaca SIP daily, split-adjusted, 2025-07-28 → 2026-11-04)
//   out:    .cache/research/deep6/build/
import fs from "node:fs";
import path from "node:path";
import * as L from "../deep5/lib5.mjs";
import { createMarket } from "../deep4/panel/panelLib.mjs";

export const D6 = path.join(L.SERVER, ".cache", "research", "deep6");
export const OUT6 = path.join(D6, "build");
export const STORE_START6 = "2025-11-03";
export const BARS_FROM6 = "2025-07-28";
export const TEST_END = "2025-12-01"; // Clock 2 disclosure before this = locked test period
export const writeOut = (name, data) => { const f = path.join(OUT6, name); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof data === "string" ? data : JSON.stringify(data)); return f; };
export const readOut = (name) => JSON.parse(fs.readFileSync(path.join(OUT6, name), "utf8"));
export const loadSec6 = () => JSON.parse(fs.readFileSync(path.join(D6, "sec-rows.json"), "utf8"));

let _bars = null;
export function loadBars6() {
  if (_bars) return _bars;
  const raw = JSON.parse(fs.readFileSync(path.join(D6, "daily-bars-ext.json"), "utf8"));
  _bars = new Map();
  for (const [s, bs] of Object.entries(raw)) {
    if (s === "__meta" || !bs) continue;
    const arr = bs.map((b) => ({ d: b[0], o: b[1], h: b[2], l: b[3], c: b[4], v: b[5] }));
    _bars.set(s, { arr, idx: new Map(arr.map((b, i) => [b.d, i])) });
  }
  return _bars;
}
// Same helpers as lib5.makeMarket, on the extended bars.
export function makeMarket6() {
  const M = createMarket({ bars: loadBars6() });
  const ser = (sym) => M.bars.get(sym) || null;
  const lastBarOnOrBefore = (s, d) => { const a = s.arr; let lo = 0, hi = a.length - 1, ans = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (a[m].d <= d) { ans = m; lo = m + 1; } else hi = m - 1; } return ans; };
  const firstBarOnOrAfter = (s, d) => { const a = s.arr; let lo = 0, hi = a.length - 1, ans = a.length; while (lo <= hi) { const m = (lo + hi) >> 1; if (a[m].d >= d) { ans = m; hi = m - 1; } else lo = m + 1; } return ans; };
  const sessionsBetween = (a, b) => M.firstOnOrAfter(b) - M.firstOnOrAfter(a);
  return { M, ser, lastBarOnOrBefore, firstBarOnOrAfter, sessionsBetween, sIdx: M.idx };
}
