// node --test src/utils/insiderScreenerFetch.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { acceptResponse, screenerPlan, MIN_REFETCH_MS } from "./insiderScreenerFetch.js";

const base = { key: "q1", dataVersion: 5, shown: null, last: null, inFlightKey: null, now: 100_000 };

test("no query → nothing", () => {
  assert.equal(screenerPlan({ ...base, key: "" }).action, "none");
});

test("cold load: nothing shown → fetch immediately", () => {
  assert.deepEqual(screenerPlan({ ...base, dataVersion: null }), { action: "fetch", delay: 0 });
});

test("regression: version arrives while the first request is in flight → await it, no throttle", () => {
  const p = screenerPlan({ ...base, dataVersion: 7, last: { key: "q1", at: 99_000 }, inFlightKey: "q1" });
  assert.equal(p.action, "await");
});

test("nothing shown for this key → never throttled, even right after a fetch", () => {
  const p = screenerPlan({ ...base, shown: { key: "q0", version: 5 }, last: { key: "q1", at: 99_900 } });
  assert.deepEqual(p, { action: "fetch", delay: 0 });
});

test("shown at the current version → settle", () => {
  assert.equal(screenerPlan({ ...base, shown: { key: "q1", version: 5 } }).action, "settle");
});

test("shown, version changed → throttled from the last request", () => {
  const p = screenerPlan({ ...base, dataVersion: 6, shown: { key: "q1", version: 5 }, last: { key: "q1", at: 95_000 } });
  assert.deepEqual(p, { action: "fetch", delay: MIN_REFETCH_MS - 5_000 });
  const late = screenerPlan({ ...base, dataVersion: 6, shown: { key: "q1", version: 5 }, last: { key: "q1", at: 0 } });
  assert.deepEqual(late, { action: "fetch", delay: 0 });
});

test("unknown version with data shown → not settled, throttled refetch only", () => {
  const p = screenerPlan({ ...base, dataVersion: null, shown: { key: "q1", version: null }, last: { key: "q1", at: 99_000 } });
  assert.equal(p.action, "fetch");
  assert.equal(p.delay, MIN_REFETCH_MS - 1_000);
});

test("retry forces an immediate fetch, even while one is in flight", () => {
  const p = screenerPlan({ ...base, force: true, shown: { key: "q1", version: 4 }, last: { key: "q1", at: 99_999 }, inFlightKey: "q1" });
  assert.deepEqual(p, { action: "fetch", delay: 0 });
});

test("in flight for a different key → fetch the new key now", () => {
  assert.deepEqual(screenerPlan({ ...base, inFlightKey: "q0" }), { action: "fetch", delay: 0 });
});

test("responses: only a key change (or a newer applied response) discards", () => {
  assert.equal(acceptResponse({ respKey: "q1", currentKey: "q1", seq: 1, appliedSeq: 0 }), true);
  assert.equal(acceptResponse({ respKey: "q1", currentKey: "q2", seq: 2, appliedSeq: 0 }), false);
  assert.equal(acceptResponse({ respKey: "q1", currentKey: "q1", seq: 1, appliedSeq: 3 }), false);
});
