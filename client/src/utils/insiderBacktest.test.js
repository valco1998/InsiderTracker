// node --test src/utils/insiderBacktest.test.js   (runs under Node, not the browser)
import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultForm, toRunRequest, pct, returnHistogram, dataStatus } from "./insiderBacktest.js";

const NOW = Date.parse("2026-11-02T15:00:00Z");

test("defaults match the strategy: 2 buyers, > $250,000 combined (USD), 30-day window, code P", () => {
  const { body } = toRunRequest(defaultForm(NOW));
  assert.equal(body.minBuyers, 2);
  assert.equal(body.minValueUsd, 250_000);
  assert.equal(body.minValueIls, undefined, "no ILS field is ever sent");
  assert.equal(body.windowDays, 30);
  assert.equal(body.from, "2023-11-03");
  assert.equal(body.to, "2026-11-02");
  assert.equal(body.minPriorDecline, undefined);
  assert.equal(body.minMarketCap, undefined);
});

test("unit conversion and validation", () => {
  const f = { ...defaultForm(NOW), priorDeclinePct: "20", minMarketCapM: "50", maxMarketCapM: "2000", roles: ["CEO"], commissionBps: "5" };
  const { body } = toRunRequest(f);
  assert.equal(body.minPriorDecline, 0.2);
  assert.equal(body.minMarketCap, 50e6);
  assert.equal(body.maxMarketCap, 2e9);
  assert.equal(body.commissionBps, 5);
  assert.deepEqual(body.roles, ["CEO"]);
  for (const bad of [{ from: "2026-05-01", to: "2026-01-01" }, { minBuyers: "0" }, { minBuyers: "2.5" }, { minValueUsd: "-1" }, { priorDeclinePct: "120" }, { minMarketCapM: "9", maxMarketCapM: "1" }]) {
    assert.ok(toRunRequest({ ...defaultForm(NOW), ...bad }).error, JSON.stringify(bad));
  }
});

test("formatting", () => {
  assert.equal(pct(0.1234), "+12.3 %");
  assert.equal(pct(-0.04), "−4.0 %");
  assert.equal(pct(null), "—");
  assert.equal(pct(-0.00001), "0.0 %");
});

test("return histogram uses only complete horizons; zero is a bin edge", () => {
  const s = (net, status = "complete") => ({ horizons: { "30d": { status, net } } });
  const bins = returnHistogram([s(-0.07), s(-0.01), s(0.02), s(0.12), s(0.5, "pending"), { horizons: {} }], "30d", 0.05);
  assert.deepEqual(bins.map((b) => [Math.round(b.from * 100), b.count]), [[-10, 1], [-5, 1], [0, 1], [5, 0], [10, 1]]);
  assert.deepEqual(returnHistogram([], "30d"), []);
});

test("data status keeps SEC coverage, missing prices and pending windows apart", () => {
  const r = { status: "complete", coverage: { complete: false, coveredDays: 10, businessDays: 46 }, signals: [
    { status: "evaluated", horizons: { "7d": { status: "complete" }, "30d": { status: "pending" } } },
    { status: "excluded", reason: "no_price_symbol", horizons: {} },
    { status: "pending", reason: "entry_after_price_data", horizons: {} },
  ] };
  assert.deepEqual(dataStatus(r), { secComplete: false, secCovered: "10/46 days", pricesAvailable: true, pricesMissing: 1, pendingWindows: 2 });
  assert.equal(dataStatus({ status: "price_data_required", coverage: { complete: true }, signals: [{}, {}] }).pricesMissing, 2);
});
