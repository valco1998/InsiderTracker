// Fixed-horizon returns: session counting from the entry's trading date (holidays,
// weekends, after-hours entries), maturity incl. the 15-minute SIP delay, missing
// bars never forward-filled, statistics only over matured signals.
import { test } from "node:test";
import assert from "node:assert/strict";
import { horizonReturns, horizonStats, sessionAfter, sessionClosed, FIXED_HORIZONS } from "./horizonReturns.js";

test("sessions after the entry date: weekends and NYSE holidays skipped", () => {
  assert.equal(sessionAfter("2026-10-22", 1), "2026-10-23");
  assert.equal(sessionAfter("2026-10-23", 1), "2026-10-26", "Friday → Monday");
  assert.equal(sessionAfter("2026-11-25", 1), "2026-11-27", "over Thanksgiving");
  assert.equal(sessionAfter("2026-10-22", 5), "2026-10-29");
  assert.deepEqual(FIXED_HORIZONS, [1, 5, 10, 20, 60]);
});

test("maturity: a session counts only after its close + 15-minute SIP delay (early close aware)", () => {
  assert.equal(sessionClosed("2026-10-23", Date.parse("2026-10-23T20:10:00Z")), false, "16:10 ET — SIP not yet accessible");
  assert.equal(sessionClosed("2026-10-23", Date.parse("2026-10-23T20:17:00Z")), true, "16:17 ET");
  assert.equal(sessionClosed("2026-11-27", Date.parse("2026-11-27T18:20:00Z")), true, "13:20 ET after the 13:00 early close");
  assert.equal(sessionClosed("2026-10-26", Date.parse("2026-10-24T12:00:00Z")), false, "future");
});

test("returns vs split-adjusted entry; immature and missing bars are statuses, never 0", () => {
  // RAPP-like: after-hours entry 2026-10-22 16:57 ET at $26.65 (no split).
  const entry = { time: "2026-10-22T20:57:20.378572251Z", price: 26.65, splitAdjustedPrice: 26.65 };
  const closes = new Map([["2026-10-23", 27.61], ["2026-10-29", 25.0]]); // 10-28 bar missing on purpose
  const r = horizonReturns({ entry, closes, nowMs: Date.parse("2026-11-03T15:00:00Z") });
  assert.deepEqual([r[1].status, r[1].exitDate, r[1].exitPrice], ["ok", "2026-10-23", 27.61], "after-hours entry → exit 1 = next session close");
  assert.equal(r[1].changePct, Math.round((27.61 / 26.65 - 1) * 1e6) / 1e6);
  assert.deepEqual([r[5].status, r[5].changePct], ["ok", Math.round((25 / 26.65 - 1) * 1e6) / 1e6]);
  assert.deepEqual([r[10].status, r[10].exitDate], ["immature", "2026-11-05"]);
  assert.equal(r[60].status, "immature");
  const gap = horizonReturns({ entry, closes: new Map([["2026-10-23", 27.61]]), nowMs: Date.parse("2026-11-03T15:00:00Z") });
  assert.equal(gap[5].status, "no_bar", "missing exit bar is not forward-filled");
  // Split: entry already in today's share terms (2-for-1 after the entry) vs split-adjusted bars.
  const split = horizonReturns({ entry: { time: "2026-03-05T15:15:03Z", price: 40, splitAdjustedPrice: 20 }, closes: new Map([["2026-03-06", 21]]), nowMs: Date.parse("2026-11-03T15:00:00Z"), horizons: [1] });
  assert.equal(split[1].changePct, 0.05);
  assert.equal(horizonReturns({ entry: null, closes, nowMs: 0 })[1].status, "no_entry");
});

test("stats use only matured signals and report how many were excluded", () => {
  const rows = [
    { 1: { status: "ok", changePct: 0.1 }, 5: { status: "ok", changePct: -0.2 } },
    { 1: { status: "ok", changePct: -0.05 }, 5: { status: "immature" } },
    { 1: { status: "ok", changePct: 0.03 }, 5: { status: "no_bar" } },
    { 1: { status: "no_entry" }, 5: { status: "no_entry" } },
  ];
  const s1 = horizonStats(rows, 1);
  assert.deepEqual([s1.n, Math.round(s1.average * 1e4) / 1e4, s1.median, Math.round(s1.winRate * 100) / 100, s1.noEntry], [3, 0.0267, 0.03, 0.67, 1]);
  const s5 = horizonStats(rows, 5);
  assert.deepEqual([s5.n, s5.average, s5.winRate, s5.immature, s5.noBar], [1, -0.2, 0, 1, 1]);
  assert.equal(horizonStats([], 20).average, null);
});
