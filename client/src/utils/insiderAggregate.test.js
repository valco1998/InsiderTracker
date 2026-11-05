// Regression: chart aggregations must tolerate empty / malformed API payloads
// without throwing, and must never sum non-finite values into chart series
// (NaN in a bar series renders as a gap and poisons period totals).
import { test } from "node:test";
import assert from "node:assert/strict";
import { byDay, byCompany, byInsider, countableValue, sumValues, timelinePoints, topCompanies, uniqueCounts } from "./insiderAggregate.js";

const P = (o) => ({ code: "P", filingDate: "2026-11-02", transactionDate: "2026-10-30", issuerCik: "1", ticker: "AAA", insiderCik: "9", ...o });

test("non-array payloads (null / undefined / error object / string) aggregate as empty", () => {
  for (const bad of [null, undefined, {}, { error: "Internal" }, "oops", 42]) {
    assert.deepEqual(byDay(bad), []);
    assert.deepEqual(byCompany(bad), []);
    assert.deepEqual(topCompanies(bad), []);
    assert.deepEqual(byInsider(bad), []);
    assert.deepEqual(timelinePoints(bad), []);
    assert.deepEqual(uniqueCounts(bad), { companies: 0, insiders: 0 });
    assert.deepEqual(sumValues(bad), { purchases: 0, sales: 0, purchaseValue: 0, saleValue: 0 });
  }
});

test("null / primitive rows inside the array are skipped, valid rows kept", () => {
  const rows = [null, undefined, "x", 7, P({ value: 100 })];
  const days = byDay(rows);
  assert.equal(days.length, 1);
  assert.equal(days[0].buyValue, 100);
  assert.equal(days[0].buyCount, 1);
  assert.equal(timelinePoints(rows).length, 1);
});

test("non-finite / non-numeric values are counted as transactions but not summed", () => {
  const rows = [P({ value: NaN }), P({ value: Infinity }), P({ value: "123" }), P({ value: null }), P({ value: 250.5 })];
  const [d] = byDay(rows);
  assert.equal(d.buyCount, 5);
  assert.equal(d.buyValue, 250.5);
  assert.ok(Number.isFinite(d.buyValue));
  assert.equal(sumValues(rows).purchaseValue, 250.5);
  assert.equal(countableValue(P({ value: NaN })), null);
  assert.equal(countableValue(P({ value: 0 })), 0);
  assert.equal(countableValue(P({ value: -5 })), -5);
});

test("valid values are preserved exactly (no rounding or fabrication)", () => {
  const rows = [P({ value: 1234567.89 }), { ...P({ value: 1000 }), code: "S" }];
  const [d] = byDay(rows);
  assert.equal(d.buyValue, 1234567.89);
  assert.equal(d.sellValue, 1000);
  const [c] = byCompany(rows);
  assert.equal(c.net, 1234567.89 - 1000);
});

test("existing exclusion rules still apply (superseded, price anomaly)", () => {
  const rows = [P({ value: 10, amendment: { status: "superseded" } }), P({ value: 20, priceCheck: { status: "anomaly" } }), P({ value: 30 })];
  const [d] = byDay(rows);
  assert.equal(d.buyCount, 2);
  assert.equal(d.buyValue, 30);
});

test("non-string dates are skipped instead of crashing the sort", () => {
  const rows = [P({ filingDate: 20261102, value: 1 }), P({ filingDate: { $date: 1 }, value: 1 }), P({ value: 5 })];
  assert.doesNotThrow(() => byDay(rows));
  assert.equal(byDay(rows).length, 1);
  assert.equal(timelinePoints([P({ transactionDate: 5 })]).length, 0);
});
