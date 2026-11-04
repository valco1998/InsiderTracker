// deep2/behavior/outcomes.mjs — joins stage-C returns (+ 4-session exit, opening gap, same-session open→close from bars)
// with the behaviour features. Used by the discovery and confirmation scripts. Holdout events are hidden by lib2.
import { loadEvents, loadBars, usable, periodOf, DISCOVER_END, HOLDOUT_START } from "../lib2.mjs";
import { readOut, horizonFromBars, gapOf, day0Of } from "./common.mjs";

export function buildRows() {
  const bars = loadBars();
  const F = new Map(readOut("event-features.json").map((x) => [x.acc, x]));
  const rows = [];
  for (const e of loadEvents()) {
    const f = F.get(e.accessionNo); if (!f) continue;
    const h4 = horizonFromBars(e, 4, bars);
    const e4 = { ...e, h: { ...e.h, 4: h4 } };
    const per = periodOf(e);
    const ok = (H) => usable(H === 4 ? e4 : e, H, per);
    const x = {}; for (const H of [1, 2, 3, 4, 5, 10, 20]) x[H] = ok(H) ? (H === 4 ? h4.excessNet : e.h[H].excessNet) : null;
    const gross = {}; for (const H of [1, 5, 20]) gross[H] = ok(H) ? e.h[H].excess : null;
    rows.push({ ...f, period: per, entryDate: e.entryDate, entryPrice: e.entryPrice, costBpsPerSide: e.costBpsPerSide, x, gross,
      gap: ok(1) ? gapOf(e, bars) : null, day0: ok(1) ? day0Of(e, bars) : null,
      exitDates: Object.fromEntries([1, 2, 3, 4, 5].map((H) => [H, H === 4 ? h4.exitDate : e.h[H]?.exitDate])),
      chart: { ret5: e.ret5 ?? null, ret20: e.ret20 ?? null, ret60: e.ret60 ?? null, dd60: e.dd60 ?? null, vol20: e.vol20 ?? null, volumeSpike5_60: e.volumeSpike5_60 ?? null, dollarVol20: e.dollarVol20 ?? null } });
  }
  return rows;
}
export { DISCOVER_END, HOLDOUT_START };
