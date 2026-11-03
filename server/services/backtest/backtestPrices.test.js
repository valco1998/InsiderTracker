// Backtesting price service: Alpaca primary, Tiingo fallback, awaiting states,
// latest-price batching, split factors, persisted entries — and REGRESSION tests for
// the five real Tiingo forward-fill errors found on 2026-11-03. No network.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createBacktestPriceService, SIP_DELAY_MS } from "./backtestPrices.js";
import { createQuoteService } from "./liveQuote.js";
import { AlpacaAuthError, AlpacaForbiddenError, AlpacaRateLimitError } from "../stockData/alpacaClient.js";

const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "bt-prices-")); return { dir: d, file: path.join(d, "entries.json") }; };
const quiet = { warn() {} };
const NOW = Date.parse("2026-11-03T15:00:00Z");

function fakeAlpaca(trades = [], opts = {}) {
  const calls = [];
  return {
    calls,
    stats: () => ({ requests: calls.length }),
    tradesPage: async (sym, q) => { calls.push(["trades", sym, q.start]); if (opts.throwTrades) throw opts.throwTrades; return { trades: trades.filter((t) => t.t >= q.start), next: null }; },
    barsPage: async (sym, q) => { calls.push(["bars", sym, q.adjustment]); return { bars: opts.daily ? [{ c: opts.daily[q.adjustment] }] : [], next: null }; },
    latestTrades: async (syms) => { calls.push(["latest", syms.join(",")]); if (opts.throwLatest) throw opts.throwLatest; return opts.latest || {}; },
  };
}

test("Alpaca entry: SIP trades for both metrics, provider + session recorded, persisted (no second request)", async () => {
  const { dir, file } = tmp();
  const a = fakeAlpaca([
    { t: "2026-10-22T20:56:20.000000000Z", p: 26.0, s: 200, c: ["@", "T"] },   // before publication
    { t: "2026-10-22T20:57:20.378572251Z", p: 26.65, s: 101, c: ["@", "F", "T"] },
    { t: "2026-10-23T13:30:00.979126792Z", p: 27.54, s: 14045, c: ["@", "O", "X"] },
  ]);
  const svc = createBacktestPriceService({ alpacaFactory: () => a, entriesFile: file, now: () => NOW, log: quiet });
  const e = await svc.getEntries("rapp", "2026-10-22 16:56:25 ET");
  assert.equal(e.publishedIso, "2026-10-22T20:56:25.000Z");
  assert.deepEqual([e.primary.status, e.primary.price, e.primary.session, e.primary.provider, e.primary.basis], ["ok", 26.65, "post", "alpaca", "sip_trade"]);
  assert.deepEqual([e.regular.price, e.regular.session, e.regular.time], [27.54, "regular", "2026-10-23T13:30:00.979126792Z"]);
  assert.deepEqual(a.calls.map((c) => c[2]), ["2026-10-22T20:56:25.000Z", "2026-10-23T13:30:00.000Z"], "searches start at publication / next open");
  const again = createBacktestPriceService({ alpacaFactory: () => a, entriesFile: file, now: () => NOW, log: quiet });
  assert.equal((await again.getEntries("RAPP", "2026-10-22 16:56:25 ET")).primary.price, 26.65);
  assert.equal(a.calls.length, 2, "final entries come from the cache");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("published < 15 min ago: 'awaiting_sip' with NO request; regular before the open: 'awaiting_regular_session'; retried later", async () => {
  const { dir, file } = tmp();
  let t = Date.parse("2026-11-03T15:05:00Z");
  const a = fakeAlpaca([{ t: "2026-11-03T15:01:00Z", p: 10, s: 100, c: ["@"] }]);
  const svc = createBacktestPriceService({ alpacaFactory: () => a, entriesFile: file, now: () => t, log: quiet });
  const e = await svc.getEntries("ABC", "2026-11-03 10:00:00 ET"); // 15:00Z, 5 min ago
  assert.deepEqual([e.primary.status, e.regular.status, a.calls.length], ["awaiting_sip", "awaiting_sip", 0]);
  const pre = await svc.getEntries("ABC", "2026-11-04 07:00:00 ET"); // tomorrow pre-market (future relative to now in this test)
  assert.equal(pre.regular.status, "awaiting_regular_session");
  t += SIP_DELAY_MS + 60_000;
  const later = await svc.getEntries("ABC", "2026-11-03 10:00:00 ET");
  assert.deepEqual([later.primary.status, later.primary.price], ["ok", 10], "retried automatically once SIP data is accessible");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("403 recent-SIP is NOT permanent and NOT replaced by Tiingo; 429 → rate_limited; no trade yet → awaiting", async () => {
  const { dir, file } = tmp();
  const tiingo = { getPublicationStart: async () => { throw new Error("must not be called"); } };
  const s403 = createBacktestPriceService({ alpacaFactory: () => fakeAlpaca([], { throwTrades: new AlpacaForbiddenError("subscription does not permit querying recent SIP data") }), tiingo, entriesFile: file, now: () => NOW, log: quiet });
  assert.equal((await s403.getEntries("ABC", "2026-11-02 10:00:00 ET")).primary.status, "awaiting_sip");
  const s429 = createBacktestPriceService({ alpacaFactory: () => fakeAlpaca([], { throwTrades: new AlpacaRateLimitError("429") }), tiingo, entriesFile: file + "2", now: () => NOW, log: quiet });
  assert.equal((await s429.getEntries("ABC", "2026-11-02 10:00:00 ET")).primary.status, "rate_limited");
  const none = createBacktestPriceService({ alpacaFactory: () => fakeAlpaca([]), tiingo, entriesFile: file + "3", now: () => NOW, log: quiet });
  const n = await none.getEntries("ABC", "2026-11-02 10:00:00 ET");
  assert.deepEqual([n.primary.status, n.regular.status], ["awaiting_first_trade", "awaiting_regular_session_trade"]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("fallback to Tiingo only when Alpaca cannot answer (401 / not configured); Tiingo zero-volume start rejected", async () => {
  const { dir, file } = tmp();
  const tiingo = { getPublicationStart: async (sym) => (sym === "OK"
    ? { status: "ok", price: 16.145, time: "2026-10-28T13:31:00.000Z", volume: 300 }
    : { status: "ok", price: 15.78, time: "2026-10-28T13:30:00.000Z", volume: 0 }) };
  const svc = createBacktestPriceService({ alpacaFactory: () => fakeAlpaca([], { throwTrades: new AlpacaAuthError("401") }), tiingo, entriesFile: file, now: () => NOW, log: quiet });
  const e = await svc.getEntries("OK", "2026-10-27 16:10:29 ET");
  assert.deepEqual([e.primary.status, e.primary.provider, e.primary.basis, e.primary.price], ["ok", "tiingo", "iex_minute_bar", 16.145]);
  assert.equal(svc.stats().alpacaDisabled, "auth_failed");
  const z = await svc.getEntries("ZERO", "2026-10-27 16:10:29 ET");
  assert.equal(z.primary.status, "unavailable", "a forward-filled (volume 0) minute is never an entry");
  const noCreds = createBacktestPriceService({ alpacaFactory: () => null, tiingo: null, entriesFile: file + "2", now: () => NOW, log: quiet });
  assert.equal((await noCreds.getEntries("OK", "2026-10-27 16:10:29 ET")).primary.status, "unavailable");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("latest: one batched Alpaca IEX request, cached; Tiingo fallback for missing symbols; unavailable otherwise", async () => {
  let t = NOW;
  const a = fakeAlpaca([], { latest: { AAA: { t: "2026-11-03T14:59:58Z", p: 12.5 }, BBB: { t: "bad", p: 3 } } });
  const tiingo = { getQuotes: async (syms) => Object.fromEntries(syms.map((s) => [s, s === "BBB" ? { status: "ok", price: 3.1, timestamp: "2026-11-03T14:50:00Z", stale: true } : { status: "quota" }])) };
  const svc = createBacktestPriceService({ alpacaFactory: () => a, tiingo, entriesFile: tmp().file, now: () => t, log: quiet });
  const l = await svc.getLatest(["AAA", "bbb", "CCC", "AAA"]);
  assert.deepEqual(a.calls, [["latest", "AAA,BBB,CCC"]]);
  assert.deepEqual([l.AAA.price, l.AAA.provider, l.AAA.source], [12.5, "alpaca", "iex_last_trade"]);
  assert.deepEqual([l.BBB.price, l.BBB.provider, l.BBB.stale], [3.1, "tiingo", true]);
  assert.equal(l.CCC.status, "quota");
  await svc.getLatest(["AAA"]);
  assert.equal(a.calls.length, 1, "cached within the TTL");
  const failing = createBacktestPriceService({ alpacaFactory: () => fakeAlpaca([], { throwLatest: new Error("HTTP 503") }), entriesFile: tmp().file, now: () => t, log: quiet });
  assert.equal((await failing.getLatest(["AAA"])).AAA.status, "unavailable", "never invented");
});

test("split factor = raw ÷ split-adjusted daily close; same day = 1; no data → null", async () => {
  const two = createBacktestPriceService({ alpacaFactory: () => fakeAlpaca([], { daily: { raw: 1208.88, split: 120.888 } }), entriesFile: tmp().file, now: () => NOW, log: quiet });
  assert.deepEqual(await two.getSplitFactor("NVDA", "2024-06-07T14:00:00Z"), { factor: 10, source: "alpaca_daily_raw_vs_split" });
  assert.deepEqual(await two.getSplitFactor("NVDA", "2026-11-03T14:00:00Z"), { factor: 1, source: "same_day" });
  const none = createBacktestPriceService({ alpacaFactory: () => fakeAlpaca([]), entriesFile: tmp().file, now: () => NOW, log: quiet });
  assert.equal(await none.getSplitFactor("X", "2026-10-01T14:00:00Z"), null);
});

// REAL cases: Tiingo IEX 1-minute bars are forward-filled with volume 0. The old
// cache (_publication-starts.json, no volume check) held these wrong starts.
const TIINGO_CASES = [
  { sym: "NXG", pub: "2026-10-23 17:13:39 ET", wrong: { t: "2026-10-26T13:30:00.000Z", p: 44.195 }, real: { t: "2026-10-26T13:48:00.000Z", p: 45.34 } },
  { sym: "NPB", pub: "2026-10-27 16:10:29 ET", wrong: { t: "2026-10-28T13:30:00.000Z", p: 15.78 }, real: { t: "2026-10-28T13:31:00.000Z", p: 16.145 } },
  { sym: "STC", pub: "2026-10-26 18:51:54 ET", wrong: { t: "2026-10-27T13:30:00.000Z", p: 42.97 }, real: { t: "2026-10-27T13:32:00.000Z", p: 43.885 } },
  { sym: "DSM", pub: "2026-10-22 15:56:11 ET", wrong: { t: "2026-10-22T19:57:00.000Z", p: 5.32 }, real: { t: "2026-10-22T19:58:00.000Z", p: 5.33 } },
  { sym: "NMCO", pub: "2026-10-27 16:34:07 ET", wrong: { t: "2026-10-28T13:30:00.000Z", p: 8.975 }, real: { t: "2026-10-28T13:36:00.000Z", p: 8.96 } },
];

test("REGRESSION Tiingo forward-fill: NXG, NPB, STC, DSM, NMCO — old cached starts invalidated, fallback returns the first TRADED minute", async () => {
  const { dir } = tmp();
  const startsFile = path.join(dir, "starts.json");
  // Seed the cache with the old (schema-less, volume-less) wrong records, as on disk before the fix.
  const old = {};
  for (const c of TIINGO_CASES) {
    const iso = new Date(Date.parse(c.pub.replace(" ET", "").replace(" ", "T") + (c.pub.startsWith("2026-11") ? "-05:00" : "-04:00"))).toISOString();
    old[`${c.sym}|${iso}`] = { status: "ok", price: c.wrong.p, time: c.wrong.t, checkedAt: "2026-11-01T00:00:00Z" };
  }
  fs.writeFileSync(startsFile, JSON.stringify(old));
  const fake = { iexIntraday: async (sym) => {
    const c = TIINGO_CASES.find((x) => x.sym === sym);
    const bars = [];
    for (let t = Date.parse(c.wrong.t); t < Date.parse(c.real.t); t += 60_000) bars.push({ time: new Date(t).toISOString(), open: c.wrong.p, close: c.wrong.p, volume: 0 }); // forward-filled
    bars.push({ time: c.real.t, open: c.real.p, close: c.real.p, volume: 500 });
    return bars;
  } };
  const tiingo = createQuoteService({ token: () => "K", maxPerHour: 50, clientFactory: () => fake, startsFile, now: () => NOW, log: quiet });
  const svc = createBacktestPriceService({ alpacaFactory: () => null, tiingo, entriesFile: path.join(dir, "e.json"), now: () => NOW, log: quiet });
  for (const c of TIINGO_CASES) {
    const e = await svc.getEntries(c.sym, c.pub);
    assert.deepEqual([e.primary.status, e.primary.price, e.primary.time, e.primary.provider], ["ok", c.real.p, c.real.t, "tiingo"], c.sym);
    assert.notEqual(e.primary.price, c.wrong.p, `${c.sym}: the forward-filled price is never returned`);
    assert.ok(Date.parse(e.primary.time) >= Date.parse(e.publishedIso), `${c.sym}: never before publication`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- Lookup budget, cross-process cache reload, daily closes ----------
test("lookup budget: over-budget entries are 'lookup_queued' (not stored) and resolve on a later call", async () => {
  const { dir, file } = tmp();
  const a = fakeAlpaca([{ t: "2026-10-22T15:00:01Z", p: 10, s: 100, c: ["@"] }]);
  const svc = createBacktestPriceService({ alpacaFactory: () => a, entriesFile: file, now: () => NOW, log: quiet });
  const budget = { left: 1 };
  const e = await svc.getEntries("ABC", "2026-10-22 11:00:00 ET", { budget });
  assert.deepEqual([e.primary.status, e.regular.status, budget.left], ["ok", "lookup_queued", 0]);
  const again = await svc.getEntries("ABC", "2026-10-22 11:00:00 ET", { budget: { left: 5 } });
  assert.deepEqual([again.primary.status, again.regular.status], ["ok", "ok"]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("entries written by another process (the precompute CLI) are picked up without a restart", async () => {
  const { dir, file } = tmp();
  const server = createBacktestPriceService({ alpacaFactory: () => fakeAlpaca([]), entriesFile: file, now: () => NOW, log: quiet });
  await server.getEntries("ZZZ", "2026-10-22 11:00:00 ET", { budget: { left: 0 } }); // loads (empty) cache
  const cli = createBacktestPriceService({ alpacaFactory: () => fakeAlpaca([{ t: "2026-10-22T15:00:01Z", p: 7, s: 100, c: ["@"] }]), entriesFile: file, now: () => NOW, log: quiet });
  await cli.getEntries("ZZZ", "2026-10-22 11:00:00 ET");
  const seen = await server.getEntries("ZZZ", "2026-10-22 11:00:00 ET", { budget: { left: 0 } });
  assert.deepEqual([seen.primary.status, seen.primary.price], ["ok", 7]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("daily closes: one batched multi-symbol request (paginated), cached on disk; failures are null, never empty data", async () => {
  const { dir, file } = tmp();
  const calls = [];
  const a = { ...fakeAlpaca([]), barsMultiPage: async (syms, q) => {
    calls.push([syms.join(","), q.adjustment, q.pageToken]);
    if (!q.pageToken) return { bars: { AAA: [{ t: "2026-10-22T04:00:00Z", c: 10 }] }, next: "p2" };
    return { bars: { AAA: [{ t: "2026-10-23T04:00:00Z", c: 11 }], BBB: [{ t: "2026-10-23T04:00:00Z", c: 5 }] }, next: null };
  } };
  const svc = createBacktestPriceService({ alpacaFactory: () => a, entriesFile: file, now: () => NOW, log: quiet });
  const c = await svc.getDailyCloses(["AAA", "bbb"], { from: "2026-10-20" });
  assert.deepEqual(calls, [["AAA,BBB", "split", null], ["AAA,BBB", "split", "p2"]]);
  assert.deepEqual([...c.AAA.entries()], [["2026-10-22", 10], ["2026-10-23", 11]]);
  assert.equal(c.BBB.get("2026-10-23"), 5);
  const svc2 = createBacktestPriceService({ alpacaFactory: () => a, entriesFile: file, now: () => NOW, log: quiet });
  await svc2.getDailyCloses(["AAA"], { from: "2026-10-20" });
  assert.equal(calls.length, 2, "served from the disk cache");
  const failing = createBacktestPriceService({ alpacaFactory: () => ({ ...fakeAlpaca([]), barsMultiPage: async () => { throw new Error("HTTP 503"); } }), entriesFile: path.join(dir, "x", "e.json"), now: () => NOW, log: quiet });
  assert.equal((await failing.getDailyCloses(["CCC"], { from: "2026-10-20" })).CCC, null);
  fs.rmSync(dir, { recursive: true, force: true });
});
