// node --test src/utils/insiderScreener.test.js   (runs under Node, not the browser)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SCREENER_FILTERS as D, screenerQuery, normalizeScreenerFilters, effectiveMinBuyers, valueBounds, activeScreenerFilters, describeScreen,
} from "./insiderScreener.js";

test("defaults: purchases by trade date, last 30 days, most unique buyers, no sales columns", () => {
  assert.deepEqual(screenerQuery(D).params, { basis: "transactionDate", sort: "buyers", dir: "desc", limit: 100, period: "30d" });
  assert.equal(D.showSales, false);
  assert.equal(activeScreenerFilters(D), 0);
});

test("combined screen: >= 3 different insiders, $1M+, last 30 days, open-market only", () => {
  const f = { ...D, minBuyers: 3, value: "1m", openMarket: true };
  assert.deepEqual(screenerQuery(f).params, { basis: "transactionDate", sort: "buyers", dir: "desc", limit: 100, period: "30d", minBuyers: 3, minValue: 1_000_000, openMarket: 1 });
  assert.equal(activeScreenerFilters(f), 3);
  assert.equal(describeScreen(f), "Companies with at least 3 different insiders who purchased a combined $1M or more · last 30 days by trade date · open-market purchases only");
});

test("custom buyers and custom value range; invalid combinations are reported, not sent", () => {
  assert.equal(effectiveMinBuyers({ ...D, minBuyers: "custom", customBuyers: "7" }), 7);
  assert.equal(effectiveMinBuyers({ ...D, minBuyers: "custom", customBuyers: "" }), 1);
  assert.deepEqual(valueBounds({ ...D, value: "custom", minValue: "25000", maxValue: "" }), [25_000, null]);
  const q = screenerQuery({ ...D, minBuyers: "custom", customBuyers: "4", value: "custom", minValue: "1000", maxValue: "50000" }).params;
  assert.equal(q.minBuyers, 4); assert.equal(q.minValue, 1000); assert.equal(q.maxValue, 50_000);
  assert.ok(screenerQuery({ ...D, value: "custom", minValue: "9", maxValue: "5" }).error);
});

test("periods, custom ranges and the SEC filing-date basis", () => {
  assert.equal(screenerQuery({ ...D, period: "1d" }).params.period, "1d");
  assert.equal(screenerQuery({ ...D, basis: "filingDate", period: "14d" }).params.basis, "filingDate");
  assert.ok(screenerQuery({ ...D, period: "custom" }).error, "custom needs a start date");
  assert.ok(screenerQuery({ ...D, period: "custom", from: "2026-10-10", to: "2026-10-01" }).error);
  const p = screenerQuery({ ...D, period: "custom", from: "2026-10-01" }).params;
  assert.equal(p.from, "2026-10-01"); assert.equal(p.period, undefined); assert.equal(p.to, undefined);
  assert.match(describeScreen({ ...D, period: "1d", basis: "filingDate" }), /last 24 hours by SEC filing date/);
});

test("stored filters are sanitized", () => {
  const n = normalizeScreenerFilters({ minBuyers: 4, value: "huge", period: "2d", basis: "x", sort: "net", dir: "up", from: "nope", q: 5, minValue: "1e5$", openMarket: 1 });
  assert.equal(n.minBuyers, 1); assert.equal(n.value, "any"); assert.equal(n.period, "30d"); assert.equal(n.basis, "transactionDate");
  assert.equal(n.sort, "buyers"); assert.equal(n.dir, "desc"); assert.equal(n.from, ""); assert.equal(n.q, "5"); assert.equal(n.minValue, "15"); assert.equal(n.openMarket, true);
  assert.deepEqual(normalizeScreenerFilters(null), D);
});
