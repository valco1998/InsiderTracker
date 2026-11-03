// Entry selection after an SEC publication: exact trade timestamps, eligible
// conditions, odd lots, sessions (pre/regular/post, holidays, early close, DST),
// regular-session start, and the minute-bar fallback (zero-volume rejection).
// Trade samples are REAL Alpaca SIP prints for RAPP (Oct 22–23 2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import { firstEligibleTrade, isEligibleTrade, sessionOf, regularSearchStart, firstTradedMinute, EXCLUDED_CONDITIONS } from "./entrySelection.js";

const PUB = "2026-10-22T20:56:25.000Z"; // RAPP signal accepted 16:56:25 ET (after hours)
const AFTER = [
  { t: "2026-10-22T20:56:54.488538039Z", p: 26.59, s: 1, x: "D", c: ["@", "T", "I"] },
  { t: "2026-10-22T20:56:55.164018988Z", p: 26.54, s: 48, x: "D", c: ["@", "T", "I"] },
  { t: "2026-10-22T20:57:04.157458698Z", p: 26.63, s: 1, x: "Q", c: ["@", "T", "I"] },
  { t: "2026-10-22T20:57:20.378572251Z", p: 26.65, s: 101, x: "P", c: ["@", "F", "T"] },
];
const OPEN = [
  { t: "2026-10-23T13:30:00.536657075Z", p: 27.79, s: 4, c: ["@", "F", "T", "I"] },
  { t: "2026-10-23T13:30:00.537203217Z", p: 27.83, s: 1, c: ["@", "Q"] },
  { t: "2026-10-23T13:30:00.979126792Z", p: 27.54, s: 14045, c: ["@", "O", "X"] },
  { t: "2026-10-23T13:30:00.97913973Z", p: 27.54, s: 14045, c: ["@", "Q"] },
];

test("primary: first eligible trade at/after publication in ANY session (real RAPP after-hours prints)", () => {
  const t = firstEligibleTrade(AFTER, PUB);
  assert.deepEqual([t.p, t.s, t.t, sessionOf(t.t)], [26.65, 101, "2026-10-22T20:57:20.378572251Z", "post"], "odd lots skipped; first round lot");
  assert.equal(firstEligibleTrade(AFTER, PUB, { includeOddLots: true }).p, 26.59, "with odd lots allowed, the 1-share print counts");
});

test("regular: first eligible regular-session trade — skips pre-open T prints and the official-open report", () => {
  const t = firstEligibleTrade([...AFTER, ...OPEN], regularSearchStart(PUB), { regularOnly: true });
  assert.deepEqual([t.p, t.s, t.c.includes("O")], [27.54, 14045, true], "the opening print, not 27.79 (T-flagged) or the Q report");
});

test("exact timestamps: a trade earlier in the same second as publication is never used", () => {
  const at = "2026-10-22T19:58:30.500000000Z";
  const trades = [{ t: "2026-10-22T19:58:30.499999999Z", p: 1, s: 100, c: ["@"] }, { t: "2026-10-22T19:58:30.500000001Z", p: 2, s: 100, c: ["@"] }];
  assert.equal(firstEligibleTrade(trades, at).p, 2);
});

test("condition filters: report-only / non-representative prints are rejected", () => {
  for (const c of ["W", "Z", "P", "Q", "M", "4", "7", "C", "N", "R", "U", "L", "9", "B", "H", "V"]) {
    assert.equal(isEligibleTrade({ t: "2026-10-22T15:00:00Z", p: 10, s: 100, c: ["@", c] }), false, c);
    assert.ok(EXCLUDED_CONDITIONS.has(c));
  }
  for (const c of ["@", "F", "O", "6", "T", "X"]) assert.equal(isEligibleTrade({ t: "2026-10-22T15:00:00Z", p: 10, s: 100, c: ["@", c] }), true, c);
  assert.equal(isEligibleTrade({ t: "2026-10-22T15:00:00Z", p: 0, s: 100, c: [] }), false);
  assert.equal(isEligibleTrade({ t: "bad", p: 1, s: 100, c: [] }), false);
});

test("sessions in New York time: DST, early close, weekend, holiday", () => {
  assert.equal(sessionOf("2026-10-23T13:30:00Z"), "regular", "EDT 09:30");
  assert.equal(sessionOf("2026-11-02T14:29:59Z"), "pre", "EST 09:29:59");
  assert.equal(sessionOf("2026-11-02T14:30:00Z"), "regular", "EST 09:30");
  assert.equal(sessionOf("2026-11-02T21:00:00Z"), "post", "EST 16:00");
  assert.equal(sessionOf("2026-11-27T18:30:00Z"), "post", "13:30 after the 13:00 early close");
  assert.equal(sessionOf("2026-10-24T15:00:00Z"), "closed", "Saturday");
  assert.equal(sessionOf("2026-11-26T15:00:00Z"), "closed", "Thanksgiving");
  assert.equal(sessionOf("2026-10-23T01:30:00Z"), "closed", "21:30 ET, after extended hours");
});

test("regular search start: in-session = publication; else next session open (weekend, holiday, DST)", () => {
  assert.equal(regularSearchStart("2026-10-22T15:00:00.000Z"), "2026-10-22T15:00:00.000Z");
  assert.equal(regularSearchStart(PUB), "2026-10-23T13:30:00.000Z", "after hours → next morning");
  assert.equal(regularSearchStart("2026-10-22T11:11:41.000Z"), "2026-10-22T13:30:00.000Z", "pre-market → same day open");
  assert.equal(regularSearchStart("2026-10-24T01:34:10.000Z"), "2026-10-26T13:30:00.000Z", "Friday night → Monday");
  assert.equal(regularSearchStart("2026-10-30T22:00:00.000Z"), "2026-11-02T14:30:00.000Z", "across the DST change → 09:30 EST");
  assert.equal(regularSearchStart("2026-11-25T22:00:00.000Z"), "2026-11-27T14:30:00.000Z", "over Thanksgiving");
});

test("minute-bar fallback: first bar STARTING after publication with volume > 0 (no forward-filled minutes)", () => {
  const bars = [
    { time: "2026-10-22T19:56:00.000Z", open: 5.31, volume: 200 }, // in progress at 15:56:11 — never used
    { time: "2026-10-22T19:57:00.000Z", open: 5.32, volume: 0 },   // forward-filled (DSM bug)
    { time: "2026-10-22T19:58:00.000Z", open: 5.33, volume: 300 },
  ];
  assert.equal(firstTradedMinute(bars, "2026-10-22T19:56:11.000Z").open, 5.33);
  assert.equal(firstTradedMinute([{ time: "2026-10-22T19:58:00.000Z", open: 5.33 }], "2026-10-22T19:56:11.000Z"), null, "volume missing → rejected");
});
