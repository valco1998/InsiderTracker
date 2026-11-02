// node --test src/utils/insiderAnalyticsCache.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { refetchDelay, MIN_REFETCH_MS } from "./insiderAnalyticsCache.js";

const full = (version, fetchedAt) => ({ version, fetchedAt, rows: [{ id: "a" }, { id: "b" }] });
const empty = (version, fetchedAt) => ({ version, fetchedAt, rows: [] });

test("no cache → fetch now", () => {
  assert.equal(refetchDelay(undefined, 10, 1000), 0);
});

test("same version → no fetch", () => {
  assert.equal(refetchDelay(full(10, 0), 10, 1000), null);
  assert.equal(refetchDelay(empty(10, 0), 10, 1000), null); // a genuinely empty query is not re-fetched for the same version
});

test("non-empty cache, new version → throttled from the last fetch", () => {
  assert.equal(refetchDelay(full(10, 1000), 11, 6000), MIN_REFETCH_MS - 5000);
  assert.equal(refetchDelay(full(10, 1000), 11, 1000 + MIN_REFETCH_MS + 1), 0);
});

test("empty cache, new version → fetch immediately (never throttled)", () => {
  assert.equal(refetchDelay(empty(0, 1000), 2942, 1500), 0);
});

// Regression: Overview showed Companies 0 / 0 and "No data" charts after a server restart.
test("server restart sequence: full v2942 → empty v0 → full v2942 recovers without waiting", () => {
  let cached = full(2942, 0); // loaded long ago
  const t1 = 120_000;
  // 1. restarted server publishes an empty snapshot v0 → fetch now (old data is not reused for another version)
  assert.equal(refetchDelay(cached, 0, t1), 0);
  cached = empty(0, t1); // the fetch returned 0 rows
  // 2. two seconds later the real snapshot (same version number as before the restart) is published
  const delay = refetchDelay(cached, 2942, t1 + 2000);
  assert.equal(delay, 0, `analytics must refetch immediately, was delayed ${delay} ms`);
});

test("missing rows field is treated as empty", () => {
  assert.equal(refetchDelay({ version: 1, fetchedAt: 0 }, 2, 10), 0);
});
