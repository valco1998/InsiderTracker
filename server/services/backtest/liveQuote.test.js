// Current-price quote for the Backtesting tracking panel: Tiingo IEX mapping,
// caching, hourly cap, missing/invalid key, and the headline change from the
// fixed first-purchase-date close. No network (fake clients).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createQuoteService } from "./liveQuote.js";
import { toQuote, createTiingoClient, TiingoAuthError } from "../stockData/tiingoClient.js";
import { currentChange } from "./tracking.js";

test("IEX row → quote: Tiingo reference price without an IEX agreement, IEX last trade when entitled", () => {
  const ref = toQuote({ ticker: "rapp", tngoLast: 25, last: null, timestamp: "2026-11-02T15:24:07.123-05:00", prevClose: 25.05 });
  assert.deepEqual(ref, { symbol: "RAPP", price: 25, timestamp: "2026-11-02T20:24:07.123Z", source: "tiingo_iex_reference", prevClose: 25.05 });
  const iex = toQuote({ ticker: "rapp", tngoLast: 25, last: 25.01, lastSaleTimestamp: "2026-11-02T15:24:05-05:00", timestamp: "2026-11-02T15:24:07-05:00" });
  assert.deepEqual([iex.price, iex.source, iex.timestamp], [25.01, "iex_last_trade", "2026-11-02T20:24:05.000Z"]);
  assert.equal(toQuote({ ticker: "x", tngoLast: null, last: null, timestamp: "2026-11-02T15:00:00Z" }), null, "no price → no quote");
  assert.equal(toQuote({ ticker: "x", tngoLast: 5 }), null, "no timestamp → no quote");
});

test("client uses the documented endpoint GET /iex/<ticker> with the Token header", async () => {
  const calls = [];
  const c = createTiingoClient({ token: "K", fetchImpl: async (url, init) => { calls.push([url, init.headers.Authorization]); return { status: 200, ok: true, json: async () => [{ ticker: "brk-b", tngoLast: 480, timestamp: "2026-11-02T15:00:00-05:00" }] }; } });
  const q = await c.iexQuote("BRK.B");
  assert.deepEqual(calls, [["https://api.tiingo.com/iex/brk-b", "Token K"]]);
  assert.equal(q.price, 480);
});

test("quote service: cache per symbol, hourly cap, no key, invalid key — never throws", async () => {
  let t = 0, calls = 0;
  const fake = { iexQuote: async (s) => { calls++; return { symbol: s, price: 10 + calls, timestamp: "2026-11-02T20:00:00.000Z", source: "tiingo_iex_reference" }; } };
  const svc = createQuoteService({ token: () => "K", ttlMs: 60_000, maxPerHour: 2, clientFactory: () => fake, now: () => t, log: { warn() {} } });
  assert.equal((await svc.getQuote("rapp")).price, 11);
  assert.equal((await svc.getQuote("RAPP")).cached, true);
  t = 61_000; assert.equal((await svc.getQuote("RAPP")).price, 12);
  t = 122_000; const capped = await svc.getQuote("RAPP");
  assert.deepEqual([capped.price, capped.stale, calls], [12, true, 2], "over the hourly cap → last cached quote, marked stale");
  assert.equal((await svc.getQuote("SPY")).status, "quota");
  assert.equal((await createQuoteService({ token: () => "" }).getQuote("RAPP")).status, "no_key");
  const bad = createQuoteService({ token: () => "K", clientFactory: () => ({ iexQuote: async () => { throw new TiingoAuthError("401"); } }), log: { warn() {} } });
  assert.equal((await bad.getQuote("RAPP")).status, "invalid_key");
});

const BASE = { date: "2026-10-15", close: 20, adjClose: 20, splitAdjClose: 20 };
const STATS = { lastDate: "2026-10-30", lastClose: 24, changePct: 0.2 };

test("headline: (current price − first-purchase-date close) / that close — the user's example", () => {
  const now = Date.parse("2026-11-02T20:24:00Z"); // Monday 15:24 New York
  const c = currentChange({ baseline: BASE, stats: STATS, quote: { status: "ok", price: 25, timestamp: "2026-11-02T20:23:58.000Z", source: "tiingo_iex_reference" }, nowMs: now });
  assert.deepEqual([c.basis, c.price, c.startPrice, c.startDate, c.changePct, c.marketOpen], ["live_quote", 25, 20, "2026-10-15", 0.25, true]);
  assert.equal(c.timestamp, "2026-11-02T20:23:58.000Z");
});

test("headline falls back to the latest daily close — labelled with its date, never as live", () => {
  const sat = Date.parse("2026-11-07T15:00:00Z");
  const noKey = currentChange({ baseline: BASE, stats: STATS, quote: { status: "no_key" }, nowMs: sat });
  assert.deepEqual([noKey.basis, noKey.price, noKey.closeDate, noKey.changePct, noKey.timestamp, noKey.quoteStatus, noKey.marketOpen], ["eod_close", 24, "2026-10-30", 0.2, null, "no_key", false]);
  const old = currentChange({ baseline: BASE, stats: STATS, quote: { status: "ok", price: 99, timestamp: "2026-10-29T20:00:00.000Z" }, nowMs: sat });
  assert.deepEqual([old.basis, old.quoteStatus], ["eod_close", "older_than_close"], "a quote older than the latest close is not used");
});
