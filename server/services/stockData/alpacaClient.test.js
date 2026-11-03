// Alpaca market-data client: documented endpoints, auth headers, pagination,
// 401 / 403 (recent SIP) / 429 / 5xx handling, per-minute limiter, batching. No network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAlpacaClient, alpacaCredentials, AlpacaAuthError, AlpacaForbiddenError, AlpacaRateLimitError } from "./alpacaClient.js";

const reply = (status, body) => ({ status, ok: status === 200, json: async () => body });

test("trades/bars/latest use the documented URLs, auth headers and pagination tokens", async () => {
  const calls = [];
  const c = createAlpacaClient({ keyId: "PKTEST", secretKey: "S3CRET", fetchImpl: async (url, init) => {
    calls.push({ url, h: init.headers });
    if (url.includes("/trades/latest")) return reply(200, { trades: { RAPP: { t: "2026-11-02T20:59:58Z", p: 25.11 } } });
    if (url.includes("/trades")) return reply(200, { trades: [{ t: "2026-10-22T20:57:20.378572251Z", p: 26.65, s: 101, c: ["@", "F", "T"] }], next_page_token: "abc" });
    return reply(200, { bars: [{ t: "2024-06-07T04:00:00Z", c: 1208.88 }], next_page_token: null });
  } });
  const p = await c.tradesPage("RAPP", { start: "2026-10-22T20:56:25.000Z", end: "2026-10-23T14:00:00Z", limit: 1000, pageToken: "tok1" });
  assert.equal(p.next, "abc");
  assert.equal(p.trades[0].p, 26.65);
  const u = new URL(calls[0].url);
  assert.equal(u.origin + u.pathname, "https://data.alpaca.markets/v2/stocks/RAPP/trades");
  assert.deepEqual(Object.fromEntries(u.searchParams), { start: "2026-10-22T20:56:25.000Z", end: "2026-10-23T14:00:00Z", limit: "1000", feed: "sip", sort: "asc", page_token: "tok1" });
  assert.equal(calls[0].h["APCA-API-KEY-ID"], "PKTEST");
  assert.ok(!calls[0].url.includes("S3CRET"), "secret never in the URL");
  await c.barsPage("NVDA", { start: "2024-06-07T00:00:00Z", end: "2024-06-07T23:59:59Z", timeframe: "1Day", adjustment: "split" });
  assert.equal(new URL(calls[1].url).searchParams.get("adjustment"), "split");
  const l = await c.latestTrades(["RAPP"]);
  assert.equal(new URL(calls[2].url).searchParams.get("feed"), "iex");
  assert.equal(l.RAPP.p, 25.11);
  assert.deepEqual(alpacaCredentials({ ALPACA_API_KEY_ID: " PK1 ", ALPACA_API_SECRET_KEY: "x" }), { keyId: "PK1", secretKey: "x" });
  assert.equal(alpacaCredentials({}), null);
});

test("errors: 401 auth, 403 recent-SIP vs other 403, 429, 5xx retried then succeeds", async () => {
  const mk = (seq) => { let i = 0; return createAlpacaClient({ keyId: "k", secretKey: "s", sleep: async () => {}, fetchImpl: async () => seq[Math.min(i++, seq.length - 1)] }); };
  await assert.rejects(mk([reply(401, null)]).latestTrades(["A"]), AlpacaAuthError);
  const e = await mk([reply(403, { message: "subscription does not permit querying recent SIP data" })]).tradesPage("A", {}).catch((x) => x);
  assert.ok(e instanceof AlpacaForbiddenError && e.recentSip === true);
  const e2 = await mk([reply(403, { message: "forbidden" })]).tradesPage("A", {}).catch((x) => x);
  assert.equal(e2.recentSip, false);
  await assert.rejects(mk([reply(429, null)]).tradesPage("A", {}), AlpacaRateLimitError);
  const ok = await mk([reply(502, null), reply(503, null), reply(200, { trades: [], next_page_token: null })]).tradesPage("A", {});
  assert.deepEqual(ok, { trades: [], next: null });
  await assert.rejects(mk([reply(500, null)]).tradesPage("A", {}), /Alpaca HTTP 500/);
  assert.throws(() => createAlpacaClient({ keyId: "", secretKey: "" }), AlpacaAuthError);
});

test("per-minute limiter waits instead of exceeding; latest trades batched by 100 symbols", async () => {
  let t = 0; const sleeps = [];
  let n = 0;
  const c = createAlpacaClient({ keyId: "k", secretKey: "s", perMinute: 2, now: () => t, sleep: async (ms) => { sleeps.push(ms); t += ms; }, fetchImpl: async () => { n++; return reply(200, { trades: {} }); } });
  await c.latestTrades(Array.from({ length: 250 }, (_, i) => `S${i}`));
  assert.equal(n, 3, "250 symbols → 3 batched requests");
  assert.equal(sleeps.length, 1, "third request waited for the minute window");
  assert.equal(c.stats().requests, 3);
});
