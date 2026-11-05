// Monthly per-buyer study — entry timing, exits, take profit, stop ambiguity and samples.
// SYNTHETIC bars only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sessionsBetween } from "./sessionCalendar.js";
import { entryDateFor, pricePath, closeReturn, tpExit, stopTargetExit, excursions, priceScaleCheck, evaluateSignal, gridSummary, netReturn, TP_GRID, summarizeRule } from "./exitRules.js";

const mapOf = (rows) => new Map(rows.map(([d, o, h, l, c]) => [d, { o, h, l, c, v: 1000 }]));
// Flat bars at 100 on every session in [from, to], with overrides per date.
function flat(from, to, over = {}) {
  return new Map(sessionsBetween(from, to).map((d) => [d, { o: 100, h: 100, l: 100, c: 100, v: 1000, ...(over[d] || {}) }]));
}

test("entry: the first opening auction that starts after publication + latency (ET, calendar, DST)", () => {
  // Before the open on a session day → same day.
  assert.equal(entryDateFor("2026-10-28 06:45:40 ET").entryDate, "2026-10-28");
  // 09:27:30 + 60 s = 09:28:30, past the 09:28 MOO cut-off → next session.
  assert.equal(entryDateFor("2026-10-28 09:27:30 ET").entryDate, "2026-10-29");
  assert.equal(entryDateFor("2026-10-28 09:26:00 ET").entryDate, "2026-10-28");
  assert.equal(entryDateFor("2026-10-28 09:27:30 ET", { latencySeconds: 0 }).entryDate, "2026-10-28", "latency is configurable");
  // During the session → next session (the open has already happened).
  assert.equal(entryDateFor("2026-10-29 09:40:22 ET").entryDate, "2026-10-30");
  // Friday after the close → Monday.
  assert.equal(entryDateFor("2026-10-30 19:32:45 ET").entryDate, "2026-11-02");
  // Saturday → Monday.
  assert.equal(entryDateFor("2026-10-31 10:00:00 ET").entryDate, "2026-11-02");
  // Holiday: Thanksgiving 2026-11-26 is closed → the evening before enters on Friday.
  assert.equal(entryDateFor("2026-11-25 18:00:00 ET").entryDate, "2026-11-27");
  // DST: EDT before 2026-11-01, EST after — the UTC instant differs by one hour.
  assert.equal(entryDateFor("2026-10-30 19:32:45 ET").availableIso, "2026-10-30T23:33:45.000Z");
  assert.equal(entryDateFor("2026-11-02 19:32:45 ET").availableIso, "2026-11-03T00:33:45.000Z");
  assert.equal(entryDateFor("2026-11-02 07:00:00 ET").entryDate, "2026-11-02", "pre-open on the first EST Monday");
  assert.equal(entryDateFor("not a stamp"), null);
});

test("price path: pending, missing entry bar, gaps are statuses — never filled", () => {
  const bars = flat("2026-10-01", "2026-10-09");
  assert.equal(pricePath({ bars, entryDate: "2026-10-12", cutoff: "2026-10-09" }).status, "pending");
  assert.equal(pricePath({ bars: new Map(), entryDate: "2026-10-05", cutoff: "2026-10-09" }).status, "no_price_series");
  const gap = new Map(bars); gap.delete("2026-10-05");
  assert.equal(pricePath({ bars: gap, entryDate: "2026-10-05", cutoff: "2026-10-09" }).status, "no_entry_bar");
  gap.delete("2026-10-07");
  const p = pricePath({ bars: gap, entryDate: "2026-10-06", cutoff: "2026-10-09" });
  assert.equal(p.complete, 1);
  assert.equal(p.stopReason, "missing_bar");
  assert.equal(closeReturn(p, 2), null);
  // Cutoff inside the window → incomplete, not pending.
  const q = pricePath({ bars, entryDate: "2026-10-07", cutoff: "2026-10-08" });
  assert.equal(q.complete, 2);
  assert.equal(q.stopReason, "after_cutoff");
});

test("fixed exits: entry day is day 1", () => {
  const bars = flat("2026-10-01", "2026-10-30", { "2026-10-05": { o: 100, c: 101 }, "2026-10-06": { c: 102 }, "2026-10-09": { c: 95 } });
  const p = pricePath({ bars, entryDate: "2026-10-05", cutoff: "2026-10-30" });
  assert.equal(closeReturn(p, 1), 0.01);
  assert.equal(closeReturn(p, 2), 0.02);
  assert.equal(closeReturn(p, 5), -0.05);
});

test("take profit: touch, gap above the target, and no touch", () => {
  const entry = "2026-10-05";
  // Touch on day 3 (entry day = 1): sold at the target; days to target = 2 (entry day = 0).
  const touch = pricePath({ bars: flat("2026-10-01", "2026-10-30", { "2026-10-07": { h: 104.5 } }), entryDate: entry, cutoff: "2026-10-30" });
  assert.deepEqual(
    (({ ret, hit, exitDay, daysToTarget, reason }) => ({ ret, hit, exitDay, daysToTarget, reason }))(tpExit(touch, 0.04, 5)),
    { ret: 0.04, hit: true, exitDay: 3, daysToTarget: 2, reason: "target_touch" });
  // Gap: day 2 opens at 106 above a 4 % target → sold at that open (+6 %), not at the target.
  const gap = pricePath({ bars: flat("2026-10-01", "2026-10-30", { "2026-10-06": { o: 106, h: 107, l: 105, c: 106 } }), entryDate: entry, cutoff: "2026-10-30" });
  assert.equal(tpExit(gap, 0.04, 5).ret, 0.06);
  assert.equal(tpExit(gap, 0.04, 5).reason, "target_gap_open");
  // No touch → close of the last day of the horizon.
  const none = pricePath({ bars: flat("2026-10-01", "2026-10-30", { "2026-10-07": { c: 97 } }), entryDate: entry, cutoff: "2026-10-30" });
  assert.deepEqual([tpExit(none, 0.04, 3).ret, tpExit(none, 0.04, 3).hit, tpExit(none, 0.04, 3).reason], [-0.03, false, "close_day_3"]);
  // Incomplete horizon → null (never computed on a shorter window).
  const short = pricePath({ bars: flat("2026-10-01", "2026-10-30"), entryDate: "2026-10-28", cutoff: "2026-10-30" });
  assert.equal(tpExit(short, 0.04, 5), null);
});

test("buffer sensitivity requires the high to exceed the target", () => {
  const p = pricePath({ bars: flat("2026-10-01", "2026-10-30", { "2026-10-07": { h: 104.5 } }), entryDate: "2026-10-05", cutoff: "2026-10-30" });
  const x = tpExit(p, 0.04, 5, { buffer: 0.005 }); // trigger 104.52 > 104.5 → not hit
  assert.equal(x.hit, false);
  assert.equal(x.reason, "close_day_5");
});

test("stop module: same-day target and stop is ambiguous (range), gap through the stop fills at the open", () => {
  const amb = pricePath({ bars: flat("2026-10-01", "2026-10-30", { "2026-10-06": { h: 105, l: 94 } }), entryDate: "2026-10-05", cutoff: "2026-10-30" });
  const a = stopTargetExit(amb, 0.04, 0.05, 5);
  assert.equal(a.status, "ambiguous");
  assert.equal(a.conservative.ret, -0.05);
  assert.equal(a.optimistic.ret, 0.04);
  const g = pricePath({ bars: flat("2026-10-01", "2026-10-30", { "2026-10-06": { o: 90, h: 91, l: 89, c: 90 } }), entryDate: "2026-10-05", cutoff: "2026-10-30" });
  const s = stopTargetExit(g, 0.04, 0.05, 5);
  assert.equal(s.conservative.ret, -0.1, "the stop is not assumed to fill at its level after a gap");
  assert.equal(s.conservative.reason, "stop_gap_open");
});

test("excursions use only bars inside the window; days to peak counts the entry day as 0", () => {
  const p = pricePath({ bars: flat("2026-10-01", "2026-10-30", { "2026-10-07": { h: 110 }, "2026-10-14": { h: 130 } }), entryDate: "2026-10-05", cutoff: "2026-10-30", maxDays: 5 });
  const x = excursions(p, 5);
  assert.equal(x.mfe, 0.1);
  assert.equal(x.daysToPeak, 2);
  assert.equal(x.peakDate, "2026-10-07");
});

test("price scale check: insider price far from the listed series is flagged (ADR ratio, currency, unit)", () => {
  const raw = mapOf([["2026-10-01", 76, 77, 75, 76.5]]);
  assert.equal(priceScaleCheck(3.9, raw, "2026-10-01").status, "mismatch");
  assert.equal(priceScaleCheck(70, raw, "2026-10-01").status, "ok");
  assert.equal(priceScaleCheck(70, raw, "2026-10-03").status, "ok", "weekend trade date → previous session");
  assert.equal(priceScaleCheck(70, new Map(), "2026-10-01").status, "unknown");
});

test("evaluateSignal: security uncertainty and missing series are N/A with a reason", () => {
  const bars = flat("2026-09-20", "2026-10-30");
  const base = { id: "x", symbol: "ACME", publishedAt: "2026-10-02 17:00:00 ET", tradeDateTo: "2026-10-01", insiderAvgPriceUsd: 100, securityMatch: { status: "ok", reasons: [] } };
  const ok = evaluateSignal(base, { bars, rawBars: bars, spyBars: bars, cutoff: "2026-10-30" });
  assert.equal(ok.status, "ok");
  assert.equal(ok.entryDate, "2026-10-05");
  assert.equal(ok.tp.length, TP_GRID.length);
  assert.equal(ok.insider.toEntryOpen, 0);
  const unc = evaluateSignal({ ...base, securityMatch: { status: "uncertain", reasons: ["local_series_BBDC4"] } }, { bars, rawBars: bars, cutoff: "2026-10-30" });
  assert.equal(unc.status, "na");
  assert.equal(unc.naReason, "security_local_series_BBDC4");
  const scale = evaluateSignal({ ...base, insiderAvgPriceUsd: 4 }, { bars, rawBars: bars, cutoff: "2026-10-30" });
  assert.equal(scale.naReason, "price_scale_mismatch");
  assert.equal(evaluateSignal({ ...base, symbol: null, securityMatch: { status: "uncertain", reasons: ["no_ticker"] } }, { bars, cutoff: "2026-10-30" }).naReason, "no_ticker");
  assert.equal(evaluateSignal(base, { bars: null, cutoff: "2026-10-30" }).naReason, "no_price_series");
});

test("grid: every rule of a horizon uses the same sample; pending and N/A are counted, not dropped silently", () => {
  const up = flat("2026-09-20", "2026-11-04", { "2026-10-06": { h: 103 } });
  const sigs = [
    { id: "a", issuerCik: "1", symbol: "AAA", publishedAt: "2026-10-02 17:00:00 ET", tradeDateTo: "2026-10-01", insiderAvgPriceUsd: 100, securityMatch: { status: "ok", reasons: [] } },
    { id: "b", issuerCik: "2", symbol: "BBB", publishedAt: "2026-10-30 19:00:00 ET", tradeDateTo: "2026-10-29", insiderAvgPriceUsd: 100, securityMatch: { status: "ok", reasons: [] } }, // only 3 days by 11-04
    { id: "c", issuerCik: "3", symbol: "CCC", publishedAt: "2026-10-02 17:00:00 ET", tradeDateTo: "2026-10-01", insiderAvgPriceUsd: 100, securityMatch: { status: "ok", reasons: [] } }, // no bars
    { id: "d", issuerCik: "1", symbol: "AAA", publishedAt: "2026-10-02 18:00:00 ET", tradeDateTo: "2026-10-01", insiderAvgPriceUsd: 100, securityMatch: { status: "ok", reasons: [] } }, // 2nd buyer, same stock + entry
  ];
  const barsOf = { AAA: up, BBB: flat("2026-09-20", "2026-11-04"), CCC: null };
  const items = sigs.map((sig) => ({ sig, ev: evaluateSignal(sig, { bars: barsOf[sig.symbol], rawBars: barsOf[sig.symbol], spyBars: flat("2026-09-20", "2026-11-04"), cutoff: "2026-11-04" }) }));
  const g = gridSummary(items);
  assert.equal(g.counts.signals, 4);
  assert.equal(g.counts.na, 1);
  assert.deepEqual(g.counts.naReasons, { no_price_series: 1 });
  assert.equal(g.horizons[3].n, 3);
  assert.equal(g.horizons[5].n, 2, "BBB has only 3 complete days by the cutoff");
  for (const t of g.horizons[5].tp) assert.equal(t.n, 2, "same sample for every target");
  assert.equal(g.combinations, 195);
  const c = gridSummary(items, { view: "consolidated" });
  assert.equal(c.counts.eligible, 2, "two buyers of AAA entering the same day count once");
  assert.equal(c.counts.mergedDuplicates, 1);
  assert.equal(g.fixedSample5[1].n, 2, "day 1…5 on the same five-day sample");
});

test("statistics: costs are separate from gross, payoff and ex-top sensitivity", () => {
  const s = summarizeRule([0.05, -0.02, 0.01, 0.1].map((ret, i) => ({ ret, issuer: String(i) })));
  assert.equal(s.n, 4);
  assert.equal(s.mean, 0.035);
  assert.equal(s.meanExTop1, 0.013333);
  assert.equal(s.pctPositive, 0.75);
  assert.ok(s.netMean[25] < s.netMean[0]);
  assert.equal(netReturn(0, 0), 0);
  assert.ok(netReturn(0, 25) < 0, "a flat trade loses the round-trip cost");
});
