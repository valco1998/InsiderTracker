// node --test src/utils/insiderAnalyticsRoutes.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { needsInsiderAnalytics } from "./insiderAnalyticsRoutes.js";

test("consumers of the analytics dataset", () => {
  for (const p of ["/insider", "/insider/", "/insider/transactions", "/insider/analytics", "/insider/analytics/"]) {
    assert.equal(needsInsiderAnalytics(p), true, p);
  }
});

test("routes that never read it", () => {
  for (const p of ["/insider/companies", "/insider/company/AAPL", "/insider/owner/0001234", "/insider/backtesting", "/insider/sign-in", "/insiders", "/", "/market", undefined, null]) {
    assert.equal(needsInsiderAnalytics(p), false, String(p));
  }
});
