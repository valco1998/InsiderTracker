// node --test src/utils/insiderTrack.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { eventPoints, clusterSpans, signalMarkers, TRACK_STATUS_TEXT } from "./insiderTrack.js";

const series = ["2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06", "2026-03-09", "2026-03-10"].map((date, i) => ({ date, pct: i / 100 }));

test("event points sit on the EXACT transaction date; y = change vs the fixed baseline at the close used", () => {
  const pts = eventPoints([{ date: "2026-03-02", priceDate: "2026-03-02", pctAtEvent: 0 }, { date: "2026-03-07", priceDate: "2026-03-06", pctAtEvent: 0.04, priceBasis: "non_trading_day" }, { date: "2026-03-08", priceDate: null, pctAtEvent: null }]);
  assert.deepEqual(pts.map((p) => [p.x, p.y, p.priceDate]), [["2026-03-02", 0, "2026-03-02"], ["2026-03-07", 0.04, "2026-03-06"]], "Saturday purchase stays on Saturday");
});

test("cluster spans and signal markers use exact calendar dates", () => {
  const clusters = [{ index: 0, windowFrom: "2026-03-02", clusterTo: "2026-03-07", publishedAt: "2026-03-06 18:00:00 ET", entryDate: "2026-03-09" }];
  assert.deepEqual(clusterSpans(clusters, series).map((c) => [c.from, c.to]), [["2026-03-02", "2026-03-07"]]);
  assert.deepEqual(signalMarkers(clusters, series).map((m) => [m.kind, m.date]), [["published", "2026-03-06"], ["entry", "2026-03-09"]]);
  assert.deepEqual(clusterSpans(clusters, []), []);
  assert.ok(TRACK_STATUS_TEXT.price_data_required.includes("TIINGO_API_KEY"));
});

// ---------- daily (one-day) precision ----------
import { groupEventsByDay, eventsWithinDays, lineData, DAY_WINDOWS } from "./insiderTrack.js";

const EV = [
  { date: "2026-03-02", insider: "A", valueUsd: 100, pctAtEvent: 0, priceDate: "2026-03-02", priceBasis: "same_day", publishedAt: "2026-03-03 17:00:00 ET", cluster: 0 },
  { date: "2026-03-02", insider: "B", valueUsd: 200, pctAtEvent: 0, priceDate: "2026-03-02", priceBasis: "same_day", publishedAt: "2026-03-02 21:00:00 ET", cluster: 0 },
  { date: "2026-03-03", insider: "C", valueUsd: null, pctAtEvent: 0.01, priceDate: "2026-03-03", priceBasis: "same_day", publishedAt: "2026-03-04 17:00:00 ET", cluster: 0 },
  { date: "2026-03-07", insider: "D", valueUsd: 50, pctAtEvent: 0.04, priceDate: "2026-03-06", priceBasis: "non_trading_day", publishedAt: "2026-03-09 17:00:00 ET", cluster: 0 },
  { date: "2026-03-31", insider: "E", valueUsd: 70, pctAtEvent: 0.2, priceDate: "2026-03-31", priceBasis: "same_day", publishedAt: "2026-04-01 17:00:00 ET", cluster: null },
];

test("daily grouping: one row per transaction date (same-day purchases together; weekend date kept)", () => {
  const g = groupEventsByDay(EV);
  assert.deepEqual(g.map((x) => [x.date, x.purchases, x.valueUsd, x.valueMissing]), [["2026-03-02", 2, 300, 0], ["2026-03-03", 1, 0, 1], ["2026-03-07", 1, 50, 0], ["2026-03-31", 1, 70, 0]]);
  assert.equal(g[0].firstPublishedAt, "2026-03-02 21:00:00 ET", "earliest SEC publication of that day");
  assert.equal(g[2].priceBasis, "non_trading_day");
});

test("daily windows 1, 2, 3, 7, 30 calendar days from the first purchase (inclusive)", () => {
  assert.deepEqual(DAY_WINDOWS, [1, 2, 3, 7, 30]);
  const n = (d) => eventsWithinDays(EV, "2026-03-02", d).length;
  assert.deepEqual([n(1), n(2), n(3), n(7), n(30), n(null)], [2, 3, 3, 4, 5, 5]);
});

test("line data breaks at trading sessions without a bar (null), never fills", () => {
  const pts = lineData([{ date: "2026-03-02", pct: 0 }, { date: "2026-03-04", pct: 0.1 }], ["2026-03-03"]);
  assert.deepEqual(pts, [["2026-03-02", 0], ["2026-03-03", null], ["2026-03-04", 0.1]]);
});
