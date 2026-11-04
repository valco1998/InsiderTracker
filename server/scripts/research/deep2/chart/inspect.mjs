// deep2/chart/inspect.mjs — read-only inventory of stage-C events and the bar cache (no results computed).
//   node scripts/research/deep2/chart/inspect.mjs
import { loadEvents, loadBars, periodOf, usable } from "../lib2.mjs";

const E = loadEvents();
console.log("priced events (non-holdout):", E.length);
const e0 = E[0];
console.log("keys:", Object.keys(e0).join(", "));
console.log("h keys:", Object.keys(e0.h || {}).join(","), "h[1] keys:", Object.keys(e0.h?.[1] || {}).join(","));
const byP = {}; for (const e of E) byP[periodOf(e)] = (byP[periodOf(e)] || 0) + 1;
console.log("by period:", byP);
for (const H of [1, 2, 3, 5]) console.log(`usable H${H}: discover ${E.filter((e) => usable(e, H, "discover")).length}, confirm ${E.filter((e) => usable(e, H, "confirm")).length}`);
const venue = {}; for (const e of E) venue[e.venue] = (venue[e.venue] || 0) + 1; console.log("venue:", venue);
const role = {}; for (const e of E) role[e.role] = (role[e.role] || 0) + 1; console.log("role:", role);
const own = {}; for (const e of E) own[e.ownership] = (own[e.ownership] || 0) + 1; console.log("ownership:", own);
const chart = {}; for (const e of E) chart[e.chartStatus] = (chart[e.chartStatus] || 0) + 1; console.log("chartStatus:", chart);
console.log("sample event:", JSON.stringify({ ...e0, evPath: undefined, h: { 1: e0.h?.[1], 5: e0.h?.[5] } }, null, 0).slice(0, 2500));
const bars = loadBars();
console.log("bar symbols:", bars.size);
const spy = bars.get("SPY"); console.log("SPY bars:", spy.arr.length, spy.arr[0].d, spy.arr.at(-1).d);
const lens = [...bars.values()].map((s) => s.arr.length).sort((a, b) => a - b);
console.log("bars per symbol: min", lens[0], "median", lens[lens.length >> 1], "max", lens.at(-1));
// tickers in events vs bar symbols
const tick = new Set(E.map((e) => String(e.ticker).toUpperCase().replace(/-/g, ".")));
console.log("event tickers:", tick.size, "with bars:", [...tick].filter((t) => bars.has(t)).length);
// entry date range
const ents = E.map((e) => e.entryDate).sort(); console.log("entry range", ents[0], ents.at(-1));
// cost tiers
const cost = {}; for (const e of E) cost[e.costBpsPerSide] = (cost[e.costBpsPerSide] || 0) + 1; console.log("cost tiers:", cost);
// fields check
const has = (k) => E.filter((e) => e[k] != null).length;
for (const k of ["decisionClose", "decisionDate", "prevClose", "entryPrice", "spyEntry", "dd60", "vol20", "dollarVol20", "ret5", "ret20", "ret1", "smaRatio50", "nearLow60", "atHigh60", "spyAbove50", "avgDollarVol20"]) console.log(k, has(k));
// decisionDate vs entryDate: is decisionDate always the previous session of entryDate?
let mism = 0; for (const e of E) { const s = bars.get(String(e.ticker).toUpperCase().replace(/-/g, ".")); if (!s) continue; const i = s.idx.get(e.entryDate); if (i == null) { mism++; continue; } if (s.arr[i - 1]?.d !== e.decisionDate) mism++; }
console.log("decisionDate != bar before entry:", mism);
// entryPrice vs bar open at entryDate
let em = 0; for (const e of E) { const s = bars.get(String(e.ticker).toUpperCase().replace(/-/g, ".")); if (!s) continue; const i = s.idx.get(e.entryDate); if (i == null) continue; if (Math.abs(s.arr[i].o / e.entryPrice - 1) > 1e-6) em++; }
console.log("entryPrice != bar open:", em);
// note: ret5/ret20 exist twice? (priceEvent overwrote chart ret5/ret20 with trade-date-based ones)
console.log("ret5 sample", E.slice(0, 5).map((e) => [e.ret5, e.ret20, e.ret1]));
