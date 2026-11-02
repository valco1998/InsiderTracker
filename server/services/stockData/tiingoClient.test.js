// Tiingo EOD client: documented endpoints, Token auth header, ticker mapping,
// 404/401/429 handling, hourly sliding window, field mapping. No network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTiingoClient, tiingoTicker, toBars, TiingoAuthError, TiingoRateLimitError, TiingoInvalidResponseError, STARTER_LIMITS } from "./tiingoClient.js";

const reply = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
const ROW = { date: "2026-03-02T00:00:00.000Z", open: 40, high: 41, low: 39, close: 40.5, volume: 1000, adjOpen: 20, adjHigh: 20.5, adjLow: 19.5, adjClose: 20.25, adjVolume: 2000, divCash: 0, splitFactor: 1 };

test("requests: documented URLs, Token header, class tickers with '-'", async () => {
  const calls = [];
  const c = createTiingoClient({ token: "SECRET", fetchImpl: async (url, init) => { calls.push({ url, auth: init.headers.Authorization }); return url.includes("/prices") ? reply(200, [ROW]) : reply(200, { ticker: "brk-b", name: "Berkshire Hathaway Inc", exchangeCode: "NYSE", startDate: "1996-05-09", endDate: "2026-10-30" }); } });
  const m = await c.meta("BRK.B");
  const bars = await c.dailyBars("BRK.B", { from: "2026-03-01", to: "2026-03-31" });
  assert.equal(calls[0].url, "https://api.tiingo.com/tiingo/daily/brk-b");
  assert.equal(calls[1].url, "https://api.tiingo.com/tiingo/daily/brk-b/prices?startDate=2026-03-01&endDate=2026-03-31");
  assert.ok(calls.every((x) => x.auth === "Token SECRET"));
  assert.ok(calls.every((x) => !x.url.includes("SECRET")), "token never in the URL");
  assert.equal(m.name, "Berkshire Hathaway Inc");
  assert.deepEqual(bars, [{ date: "2026-03-02", open: 40, high: 41, low: 39, close: 40.5, adjClose: 20.25, volume: 1000, splitFactor: 1, divCash: 0 }]);
  assert.equal(tiingoTicker("rapp"), "rapp");
});

test("errors: 404 → null, 401 → auth error, 429 → rate-limit error, missing key refused", async () => {
  const mk = (status) => createTiingoClient({ token: "k", fetchImpl: async () => reply(status, { detail: "x" }) });
  assert.equal(await mk(404).meta("NOPE"), null);
  assert.equal(await mk(404).dailyBars("NOPE", { from: "2026-01-01", to: "2026-02-01" }), null);
  await assert.rejects(mk(401).meta("A"), TiingoAuthError);
  await assert.rejects(mk(429).meta("A"), TiingoRateLimitError);
  await assert.rejects(mk(500).meta("A"), /HTTP 500/);
  assert.throws(() => createTiingoClient({ token: "" }), TiingoAuthError);
});

test("hourly sliding window: waits instead of exceeding the plan's requests per hour", async () => {
  let t = 0;
  const sleeps = [];
  const c = createTiingoClient({ token: "k", perHour: 2, now: () => t, sleep: async (ms) => { sleeps.push(ms); t += ms; }, log: { log() {} }, fetchImpl: async () => reply(200, {}) });
  await c.meta("A"); t += 1000; await c.meta("B"); await c.meta("C");
  assert.equal(sleeps.length, 1);
  assert.equal(sleeps[0], 3_600_000 - 1000 + 1000);
  assert.equal(c.stats().requests, 3);
  assert.deepEqual(toBars([{ date: "bad" }, ROW]).length, 1);
});

test("invalid responses are errors, never data; incomplete rows are dropped, not repaired", async () => {
  const mk = (body) => createTiingoClient({ token: "k", fetchImpl: async () => ({ status: 200, ok: true, json: async () => body }) });
  await assert.rejects(mk({ detail: "oops" }).dailyBars("A", { from: "2026-01-01", to: "2026-02-01" }), TiingoInvalidResponseError);
  await assert.rejects(mk([1, 2]).meta("A"), TiingoInvalidResponseError);
  const notJson = createTiingoClient({ token: "k", fetchImpl: async () => ({ status: 200, ok: true, json: async () => { throw new SyntaxError("x"); } }) });
  await assert.rejects(notJson.meta("A"), TiingoInvalidResponseError);
  assert.deepEqual(toBars([{ date: "2026-03-02T00:00:00.000Z", close: 10, adjClose: null }, { date: "2026-03-03", close: 10, adjClose: 9.5 }]).map((b) => b.date), ["2026-03-03"]);
  assert.deepEqual(STARTER_LIMITS, { symbolsPerMonth: 500, requestsPerHour: 50, requestsPerDay: 1000 });
});
