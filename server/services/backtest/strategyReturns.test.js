// Actionable user-horizon returns (strategyReturns.js) — SYNTHETIC prices, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { availableAtIso, entrySearchStart, exitFor, strategyReturn, strategySummary, STRATEGY_EXECUTION_DEFAULTS } from "./strategyReturns.js";
import { firstEligibleTrade } from "./entrySelection.js";

const NOW = Date.parse("2027-03-01T00:00:00Z"); // long after every exit used here
const ok = (price, time, extra = {}) => ({ status: "ok", price, time, ...extra });
const closes = (o) => new Map(Object.entries(o));

test("defaults are only starting values; latency is applied to the SEC acceptance time", () => {
  assert.deepEqual({ ...STRATEGY_EXECUTION_DEFAULTS }, { horizonSessions: 20, executionLatencySeconds: 60, entrySession: "regular" });
  assert.equal(availableAtIso("2026-11-02 15:24:00 ET", 60), "2026-11-02T20:25:00.000Z", "EST, +60 s");
  assert.equal(availableAtIso("2026-10-22 16:56:25 ET", 0), "2026-10-22T20:56:25.000Z", "EDT, no latency");
  assert.equal(availableAtIso("garbage", 60), null);
});

test("latency: a trade 30 s after acceptance is NOT executable with a 60 s latency", () => {
  const acc = "2026-11-02 11:00:00 ET"; // regular session
  const trades = [
    { t: "2026-11-02T16:00:30.000Z", p: 10.0, s: 100, c: ["@"] }, // T + 30 s
    { t: "2026-11-02T16:01:30.000Z", p: 10.4, s: 100, c: ["@"] }, // T + 90 s
  ];
  const start0 = entrySearchStart(availableAtIso(acc, 0), "regular");
  const start60 = entrySearchStart(availableAtIso(acc, 60), "regular");
  assert.equal(firstEligibleTrade(trades, start0, { regularOnly: true }).p, 10.0);
  assert.equal(firstEligibleTrade(trades, start60, { regularOnly: true }).p, 10.4);
});

test("session rule: after-hours filing enters at the next regular open (regular) or in after-hours (extended)", () => {
  const avail = availableAtIso("2026-11-02 16:30:00 ET", 60); // Monday after the close
  assert.equal(entrySearchStart(avail, "regular"), "2026-11-03T14:30:00.000Z", "Tuesday 09:30 ET");
  assert.equal(entrySearchStart(avail, "extended"), avail);
  // Friday evening → Monday open; Thanksgiving-eve after close → Friday (early-close day) open.
  assert.equal(entrySearchStart(availableAtIso("2026-11-20 18:00:00 ET", 60), "regular"), "2026-11-23T14:30:00.000Z");
  assert.equal(entrySearchStart(availableAtIso("2026-11-25 17:00:00 ET", 60), "regular"), "2026-11-27T14:30:00.000Z");
  // Extended-hours prints are skipped by the regular rule.
  const trades = [{ t: "2026-11-02T21:35:00.000Z", p: 9, s: 100, c: ["T"] }, { t: "2026-11-03T14:30:01.000Z", p: 9.5, s: 100, c: ["@"] }];
  assert.equal(firstEligibleTrade(trades, entrySearchStart(avail, "regular"), { regularOnly: true }).p, 9.5);
  assert.equal(firstEligibleTrade(trades, entrySearchStart(avail, "extended")).p, 9);
});

test("exact N-th TRADING-session exit: weekends, Thanksgiving holiday and the early close", () => {
  // Wednesday 2026-11-25 entry: next sessions are Fri 11-27 (early close 13:00), Mon 11-30, …
  const e = "2026-11-25T15:00:00.000Z";
  assert.deepEqual(exitFor(e, 1), { entryDate: "2026-11-25", exitDate: "2026-11-27", exitTime: "2026-11-27T18:00:00.000Z" }, "1 session → Friday early close 13:00 ET");
  assert.equal(exitFor(e, 2).exitDate, "2026-11-30");
  assert.equal(exitFor(e, 3).exitDate, "2026-12-01");
  assert.equal(exitFor(e, 5).exitDate, "2026-12-03", "5 sessions ≠ 5 calendar days");
  assert.equal(exitFor(e, 19).exitDate, "2026-12-23");
  assert.equal(exitFor(e, 19).exitTime, "2026-12-23T21:00:00.000Z", "regular close 16:00 ET");
  assert.equal(exitFor(e, 20).exitDate, "2026-12-24");
  assert.equal(exitFor(e, 20).exitTime, "2026-12-24T18:00:00.000Z", "Christmas Eve early close 13:00 ET");
  // Pre-market entry on Friday counts sessions from Friday.
  assert.equal(exitFor("2026-11-20T12:00:00.000Z", 1).exitDate, "2026-11-23");
  // Christmas 2026 (Friday) is skipped; Dec 24 is an early close.
  assert.equal(exitFor("2026-12-23T15:00:00.000Z", 1).exitDate, "2026-12-24");
  assert.equal(exitFor("2026-12-23T15:00:00.000Z", 2).exitDate, "2026-12-28");
});

test("gross vs net after costs; SPY over the same entry/exit; excess = net − SPY", () => {
  const r = strategyReturn({
    entry: ok(20, "2026-11-25T15:00:00.000Z", { session: "regular" }), closes: closes({ "2026-12-03": 22 }),
    benchEntry: ok(500, "2026-11-25T15:00:00.050Z"), benchCloses: closes({ "2026-12-03": 505 }),
    n: 5, costBps: 25, nowMs: NOW,
  });
  assert.equal(r.status, "ok");
  assert.equal(r.gross, 0.1);
  assert.equal(r.net, Math.round(((22 * 0.9975) / (20 * 1.0025) - 1) * 1e6) / 1e6);
  assert.ok(r.net < r.gross, "costs reduce the return");
  assert.equal(r.benchmark, 0.01);
  assert.equal(r.excess, Math.round((r.net - 0.01) * 1e6) / 1e6);
  assert.deepEqual([r.entry.date, r.exit.date, r.exit.price, r.exit.time], ["2026-11-25", "2026-12-03", 22, "2026-12-03T21:00:00.000Z"]);
  assert.equal(r.benchmarkTrade.exit.date, "2026-12-03", "same exit session as the stock");
});

test("split-adjusted entry: a 2-for-1 split after entry does not create a fake −50 %", () => {
  const r = strategyReturn({ entry: ok(40, "2026-11-25T15:00:00.000Z", { splitAdjustedPrice: 20, splitFactor: 2 }), closes: closes({ "2026-11-27": 21 }), n: 1, nowMs: NOW });
  assert.equal(r.gross, 0.05);
});

test("missing data is a status, never 0: no entry, immature, missing bar, closes unavailable, no SPY", () => {
  assert.equal(strategyReturn({ entry: { status: "awaiting_first_trade" }, closes: new Map(), n: 5, nowMs: NOW }).status, "awaiting_first_trade");
  assert.equal(strategyReturn({ entry: null, closes: new Map(), n: 5, nowMs: NOW }).status, "no_entry");
  const e = ok(20, "2026-11-25T15:00:00.000Z");
  assert.equal(strategyReturn({ entry: e, closes: new Map(), n: 5, nowMs: Date.parse("2026-12-02T12:00:00Z") }).status, "immature");
  // Exit session closed at 16:00 ET, but Basic SIP bars are only accessible 15 min later.
  assert.equal(strategyReturn({ entry: e, closes: closes({ "2026-12-03": 22 }), n: 5, nowMs: Date.parse("2026-12-03T21:05:00Z") }).status, "immature");
  const noBar = strategyReturn({ entry: e, closes: closes({ "2026-12-02": 22, "2026-12-04": 23 }), n: 5, nowMs: NOW });
  assert.equal(noBar.status, "no_bar", "a neighbouring day is never substituted");
  assert.equal(noBar.gross, undefined);
  assert.equal(strategyReturn({ entry: e, closes: null, n: 5, nowMs: NOW }).status, "bars_unavailable");
  const noSpy = strategyReturn({ entry: e, closes: closes({ "2026-12-03": 22 }), benchEntry: { status: "awaiting_sip" }, n: 5, nowMs: NOW });
  assert.deepEqual([noSpy.status, noSpy.benchmark, noSpy.benchmarkStatus, noSpy.excess], ["ok", null, "awaiting_sip", null]);
});

test("summary: average, median, win rate, SPY comparison and missing counts", () => {
  const e = ok(10, "2026-11-25T15:00:00.000Z");
  const mk = (exit, spy) => strategyReturn({ entry: e, closes: closes({ "2026-11-27": exit }), benchEntry: ok(100, e.time), benchCloses: closes({ "2026-11-27": spy }), n: 1, nowMs: NOW });
  const rows = [mk(11, 101), mk(9, 100), mk(12, 102), { status: "no_bar" }, { status: "immature" }, { status: "no_ticker" }];
  const s = strategySummary(rows);
  assert.equal(s.signals, 6);
  assert.equal(s.n, 3);
  assert.equal(s.grossMean, Math.round(((0.1 - 0.1 + 0.2) / 3) * 1e6) / 1e6);
  assert.equal(s.grossMedian, 0.1);
  assert.equal(s.winRate, Math.round((2 / 3) * 1e6) / 1e6);
  assert.equal(s.benchmarkN, 3);
  assert.equal(s.benchmarkMean, 0.01);
  assert.deepEqual(s.missing, { no_bar: 1, immature: 1, no_ticker: 1 });
  // SPY missing for one signal: SPY / excess cover only the 2 with SPY, and the strategy's
  // net mean over those same 2 is reported beside them (no mixed subsets).
  const noSpy = strategyReturn({ entry: e, closes: closes({ "2026-11-27": 15 }), benchEntry: { status: "awaiting_sip" }, n: 1, nowMs: NOW });
  const p = strategySummary([mk(11, 101), mk(9, 100), noSpy]);
  assert.deepEqual([p.n, p.benchmarkN], [3, 2]);
  assert.equal(p.netMeanWithBenchmark, 0, "(+10 % − 10 %) / 2 over the SPY subset");
  assert.equal(p.netMean, Math.round((0.5 / 3) * 1e6) / 1e6, "all 3 signals");
  assert.deepEqual(strategySummary([]).n, 0);
  assert.equal(strategySummary([]).grossMean, null, "no data → null, not 0");
});
