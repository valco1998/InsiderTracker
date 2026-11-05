// Cluster peak study — window, peak, thresholds and status rules. SYNTHETIC bars.
//   node --test scripts/research/clusterPeaks/peakLib.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { sessionsBetween } from "../../../services/backtest/sessionCalendar.js";
import { peakWindow, summarizePeaks, addDays } from "./peakLib.mjs";

// Flat bars at 100 on every session in [from, to] with overrides { date: [o,h,l,c] }.
const series = (from, to, over = {}) => sessionsBetween(from, to).map((d) => [d, ...(over[d] || [100, 100, 100, 100]), 1000]);

test("entry is the first open after publication; the window is publication date + 180 calendar days", () => {
  const bars = series("2026-01-02", "2026-09-30");
  const r = peakWindow({ bars, publishedAt: "2026-01-09 17:00:00 ET", cutoff: "2026-09-30" }); // Friday after the close
  assert.equal(r.entryDate, "2026-01-12");
  assert.equal(r.windowEnd, addDays("2026-01-09", 180));
  assert.equal(r.status, "complete");
  assert.equal(r.entryPrice, 100);
  assert.equal(r.observedThrough <= r.windowEnd, true);
});

test("peak uses the daily HIGH; the peak close is reported separately; days and sessions count from the entry day (0)", () => {
  const bars = series("2026-02-02", "2026-09-30", {
    "2026-02-10": [101, 130, 100, 105], // intraday spike — highest high
    "2026-03-16": [118, 125, 117, 124], // highest close
    "2026-07-01": [90, 91, 80, 85], // inside the window (02-02 + 180 = 08-01)
  });
  const r = peakWindow({ bars, publishedAt: "2026-02-02 07:00:00 ET", cutoff: "2026-09-30" });
  assert.equal(r.entryDate, "2026-02-02");
  assert.equal(r.peakHigh, 130);
  assert.equal(r.peakHighGain, 0.3);
  assert.equal(r.peakHighDate, "2026-02-10");
  assert.equal(r.daysToPeakHigh, 8);
  assert.equal(r.sessionsToPeakHigh, 6);
  assert.equal(r.peakClose, 124);
  assert.equal(r.peakCloseDate, "2026-03-16");
  assert.equal(r.peakCloseGain, 0.24);
  assert.equal(r.maxDrawdown, -0.2);
  assert.equal(r.drawdownBeforePeak, 0, "the July low came after the peak");
  assert.deepEqual([r.thresholds[0.1].hit, r.thresholds[0.3].hit, r.thresholds[0.5].hit], [true, true, false]);
  assert.equal(r.thresholds[0.1].date, "2026-02-10");
});

test("a price after the window end never counts; the end return is the last close inside the window", () => {
  const end = addDays("2026-01-05", 180);
  const bars = series("2026-01-05", "2026-09-30", { [addDays(end, 3)]: [100, 300, 100, 300] });
  const r = peakWindow({ bars, publishedAt: "2026-01-05 07:00:00 ET", cutoff: "2026-09-30" });
  assert.equal(r.peakHighGain, 0);
  assert.ok(r.endDate <= end);
});

test("newer clusters are incomplete; a series that stops early is 'series_ended'; missing data has a reason", () => {
  const bars = series("2026-06-01", "2026-11-03");
  assert.equal(peakWindow({ bars, publishedAt: "2026-07-01 07:00:00 ET", cutoff: "2026-11-03" }).status, "incomplete");
  const delisted = series("2026-01-02", "2026-03-31");
  const d = peakWindow({ bars: delisted, publishedAt: "2026-01-05 07:00:00 ET", cutoff: "2026-11-03" });
  assert.equal(d.status, "series_ended");
  assert.equal(d.lastBarDate, "2026-03-31");
  assert.equal(peakWindow({ bars: null, publishedAt: "2026-01-05 07:00:00 ET", cutoff: "2026-11-03" }).status, "no_price_series");
  const gap = series("2026-01-02", "2026-09-30").filter((b) => b[0] !== "2026-01-05");
  assert.equal(peakWindow({ bars: gap, publishedAt: "2026-01-05 07:00:00 ET", cutoff: "2026-09-30" }).status, "no_entry_bar");
});

test("summary: medians, threshold shares and peak timing over complete rows only", () => {
  const rows = [0.05, 0.25, 0.6].map((g, i) => ({ peakHighGain: g, peakCloseGain: g / 2, daysToPeakHigh: [10, 40, 170][i], sessionsToPeakHigh: [6, 28, 118][i], daysToPeakClose: 20, endReturn: [-0.2, 0.1, 0.3][i], drawdownBeforePeak: -0.05, maxDrawdown: -0.3,
    thresholds: { 0.1: { hit: g >= 0.1, calendarDays: 5, sessions: 3 }, 0.2: { hit: g >= 0.2, calendarDays: 9, sessions: 6 }, 0.3: { hit: g >= 0.3 }, 0.5: { hit: g >= 0.5 }, 1: { hit: false } } }));
  const s = summarizePeaks(rows);
  assert.equal(s.n, 3);
  assert.equal(s.peakHighGain.median, 0.25);
  assert.equal(s.reached[0.1].share, 0.666667);
  assert.equal(s.reached[1].share, 0);
  assert.equal(s.endPositive, 0.666667);
  assert.equal(s.peakTiming[30], 0.333333);
  assert.equal(s.daysToPeakHigh.median, 40);
});
