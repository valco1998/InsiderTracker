import { test } from "node:test";
import assert from "node:assert/strict";
import { setTokenProvider, getAuthToken, hasTokenProvider } from "./storage.js";

test("token provider: signed-out → no token; signed-in → current ID token; forced refresh passes through; failures never throw", async () => {
  setTokenProvider(null);
  assert.equal(hasTokenProvider(), false);
  assert.equal(await getAuthToken(), null);
  const calls = [];
  setTokenProvider(async (force) => { calls.push(force); return force ? "fresh" : "cached"; });
  assert.equal(await getAuthToken(), "cached");
  assert.equal(await getAuthToken({ forceRefresh: true }), "fresh");
  assert.deepEqual(calls, [false, true]);
  setTokenProvider(async () => { throw new Error("network"); });
  assert.equal(await getAuthToken(), null, "a failed refresh means 'no token', not a crash");
  setTokenProvider(null);
});
