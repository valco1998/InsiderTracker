// PRIMARY METRIC "SEC signal published → NOW": start = first IEX trade minute at/after
// the SEC acceptance time; end = latest quote. Times, sessions, no pre-disclosure
// prices, caching, shared quota, splits, licence. No network (fake Tiingo clients).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { etToUtcIso, publicationSession, firstPriceAtOrAfter, publicationToNow, resampleFor } from "./publicationStart.js";
import { createQuoteService } from "./liveQuote.js";
import { createBacktestService } from "./backtestEngine.js";
import { createBacktestPriceService } from "./backtestPrices.js";
import { createBacktestRouter } from "../../routers/backtestRoutes.js";
import { OWNERS as O, tx, barsFor, fakeProvider } from "./testFixtures.js";

test("SEC acceptance time (New York) → UTC, across daylight saving", () => {
  assert.equal(etToUtcIso("2026-10-22 16:56:25 ET"), "2026-10-22T20:56:25.000Z", "EDT = UTC−4");
  assert.equal(etToUtcIso("2026-11-02 15:24:00 ET"), "2026-11-02T20:24:00.000Z", "EST = UTC−5");
  assert.equal(etToUtcIso("garbage"), null);
});

test("publication session: regular, pre-market, after hours, weekend, holiday", () => {
  assert.equal(publicationSession("2026-10-22 10:15:00 ET"), "regular_session");
  assert.equal(publicationSession("2026-10-22 08:59:59 ET"), "pre_market");
  assert.equal(publicationSession("2026-10-22 16:56:25 ET"), "after_hours");
  assert.equal(publicationSession("2026-11-27 13:30:00 ET"), "after_hours", "early close 13:00");
  assert.equal(publicationSession("2026-10-24 12:00:00 ET"), "non_trading_day", "Saturday");
  assert.equal(publicationSession("2026-11-26 12:00:00 ET"), "non_trading_day", "Thanksgiving");
});

// Real RAPP shape (Tiingo IEX 1-min bars, labelled by bar START, regular session only).
const BARS = [
  { time: "2026-10-22T19:58:00.000Z", open: 27.4, volume: 120 }, { time: "2026-10-22T19:59:00.000Z", open: 27.5, volume: 90 },  // before publication
  { time: "2026-10-23T13:30:00.000Z", open: 27.61, volume: 325 }, { time: "2026-10-23T13:31:00.000Z", open: 27.45, volume: 210 },
];

test("start = first bar starting at/after publication — never a pre-disclosure price", () => {
  assert.deepEqual(firstPriceAtOrAfter(BARS, "2026-10-22T20:56:25.000Z"), { price: 27.61, time: "2026-10-23T13:30:00.000Z", volume: 325 }, "after-hours → next session's first minute");
  assert.deepEqual(firstPriceAtOrAfter(BARS, "2026-10-22T19:58:30.000Z"), { price: 27.5, time: "2026-10-22T19:59:00.000Z", volume: 90 }, "in session → the next minute, not the one in progress");
  assert.deepEqual(firstPriceAtOrAfter(BARS, "2026-10-22T19:59:00.000Z").price, 27.5, "a bar starting exactly at publication counts");
  assert.equal(firstPriceAtOrAfter(BARS, "2026-10-23T14:00:00.000Z"), null, "no trade yet after publication");
  // forward-filled minutes (volume 0 / missing) are never a start price
  const filled = [{ time: "2026-10-26T13:30:00.000Z", open: 44.195, volume: 0 }, { time: "2026-10-26T13:31:00.000Z", open: 44.195 }, { time: "2026-10-26T13:48:00.000Z", open: 45.34, volume: 100 }];
  assert.deepEqual(firstPriceAtOrAfter(filled, "2026-10-23T21:13:39.000Z"), { price: 45.34, time: "2026-10-26T13:48:00.000Z", volume: 100 }, "NXG: real first trade, not the carried 44.195");
  assert.equal(resampleFor("2026-10-22T20:56:25Z", Date.parse("2026-11-02T20:00:00Z")), "1min");
  assert.equal(resampleFor("2026-01-02T20:56:25Z", Date.parse("2026-11-02T20:00:00Z")), "5min");
});

test("change = (latest quote − start) ÷ start; elapsed from publication; works within hours", () => {
  const start = { status: "ok", price: 20, time: "2026-11-02T14:31:00.000Z" };
  const r = publicationToNow({ publishedIso: "2026-11-02T14:30:10.000Z", start, quote: { status: "ok", price: 25, timestamp: "2026-11-02T20:24:00.000Z", source: "tiingo_iex_reference" }, nowMs: Date.parse("2026-11-02T20:24:05Z") });
  assert.deepEqual([r.status, r.changePct, r.end.price, Math.round(r.elapsedMs / 60000)], ["ok", 0.25, 25, 354], "+25.00 % after 5 h 54 min");
  assert.equal(publicationToNow({ publishedIso: "2026-11-02T14:30:10Z", start, quote: { status: "ok", price: 9, timestamp: "2026-11-02T14:00:00Z" }, nowMs: Date.now() }).status, "awaiting_first_trade", "quote older than the start observation");
  assert.equal(publicationToNow({ publishedIso: "2026-11-02T14:30:10Z", start, quote: { status: "quota" }, nowMs: Date.now() }).status, "quota", "the reason is passed through");
  assert.equal(publicationToNow({ publishedIso: "2026-11-02T14:30:10Z", start, quote: { status: "unavailable" }, nowMs: Date.now() }).status, "no_quote");
  assert.equal(publicationToNow({ publishedIso: "2026-11-02T14:30:10Z", start: { status: "no_key" }, quote: null, nowMs: Date.now() }).status, "no_key");
  const split = publicationToNow({ publishedIso: "2026-11-02T14:30:10Z", start: { ...start, price: 40, splitAdjustedPrice: 20 }, quote: { status: "ok", price: 21, timestamp: "2026-11-02T20:00:00Z" }, nowMs: Date.now() });
  assert.equal(split.changePct, 0.05, "start split-adjusted after a 2-for-1 split");
});

test("quote service: start found once and cached on disk; shared hourly budget; stalest quotes first", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pub-"));
  let t = Date.parse("2026-11-02T20:00:00Z");
  const calls = [];
  const fake = {
    iexIntraday: async (sym, opts) => { calls.push(`bars:${sym}:${opts.startDate}:${opts.resampleFreq}`); return BARS; },
    iexQuote: async (sym) => { calls.push(`quote:${sym}`); return { symbol: sym, price: 25, timestamp: new Date(t).toISOString(), source: "tiingo_iex_reference" }; },
  };
  const mk = () => createQuoteService({ token: () => "K", maxPerHour: 3, ttlMs: 60_000, clientFactory: () => fake, startsFile: path.join(dir, "starts.json"), now: () => t, log: { warn() {} } });
  const svc = mk();
  const s1 = await svc.getPublicationStart("RAPP", "2026-10-22 16:56:25 ET");
  assert.deepEqual([s1.status, s1.price, s1.time, s1.session, s1.resolution], ["ok", 27.61, "2026-10-23T13:30:00.000Z", "after_hours", "1min"]);
  assert.deepEqual(calls, ["bars:RAPP:2026-10-22:1min"]);
  const again = await mk().getPublicationStart("RAPP", "2026-10-22 16:56:25 ET"); // new process: read from disk
  assert.equal(again.price, 27.61);
  assert.equal(calls.length, 1, "never fetched twice");
  const q = await svc.getQuotes(["AAA", "BBB", "CCC"]); // budget 3, one used by the start lookup
  assert.deepEqual(Object.values(q).map((x) => x.status), ["ok", "ok", "quota"]);
  t += 61_000;
  const q2 = await svc.getQuotes(["AAA", "BBB", "CCC"]);
  assert.equal(q2.CCC.status, "quota", "budget exhausted within the hour");
  assert.deepEqual([q2.AAA.status, q2.AAA.stale], ["ok", true], "kept with its timestamp, marked stale");
  assert.equal((await createQuoteService({ token: () => "", startsFile: path.join(dir, "empty.json") }).getPublicationStart("RAPP", "2026-10-22 16:56:25 ET")).status, "no_key");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("engine + API: primary & regular rows from Alpaca trades, split-adjusted, no pre-publication trade, no ticker labelled, licence-restricted for non-local viewers", async () => {
  const ROWS = [
    tx({ owners: [O.CEO], date: "2026-03-02", accepted: "2026-03-03 17:00:00" }),
    tx({ owners: [O.CFO], date: "2026-03-04", accepted: "2026-03-05 10:15:00" }),         // signal published in session (15:15:00Z)
    tx({ owners: [O.CEO], date: "2026-03-02", accepted: "2026-03-03 17:00:00", issuerCik: "0000009001", ticker: "" }),
    tx({ owners: [O.CFO], date: "2026-03-04", accepted: "2026-03-05 18:00:00", issuerCik: "0000009001", ticker: "" }), // no ticker
  ];
  const ACME = barsFor("2026-01-02", "2026-10-30", (d) => (d < "2026-06-01" ? { open: 40, close: 40 } : { open: 21, close: 21 })).map((b) => ({ ...b, splitFactor: b.date === "2026-06-01" ? 2 : 1 }));
  const SPY = barsFor("2026-01-02", "2026-10-30", (d, i) => ({ open: 400 + i, close: 400 + i }));
  const asked = [];
  const alpaca = {
    stats: () => ({ requests: asked.length }),
    tradesPage: async (sym, q) => { asked.push(q.start); return { trades: [
      { t: "2026-03-05T15:14:59.999999999Z", p: 39, s: 500, c: ["@"] },   // before publication — never used
      { t: "2026-03-05T15:15:03.120000000Z", p: 40, s: 100, c: ["@"] },
    ], next: null }; },
    barsPage: async (sym, q) => ({ bars: [{ t: "2026-03-05T05:00:00Z", c: q.adjustment === "split" ? 20 : 40 }], next: null }),
    latestTrades: async (syms) => Object.fromEntries(syms.map((s) => [s, { t: "2026-11-02T19:59:58Z", p: 22 }])),
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-entries-"));
  const prices = createBacktestPriceService({ alpacaFactory: () => alpaca, tiingo: null, entriesFile: path.join(dir, "e.json"), now: () => Date.parse("2026-11-02T20:00:30Z"), log: { warn() {} } });
  const service = createBacktestService({ prices, loadStore: () => ({ sig: "x", records: new Map(), days: new Map() }), live: () => ({ transactions: ROWS, amendmentFilings: [], coverage: [], noIndexDays: [], dataVersion: 1 }),
    getProvider: () => ({ ...fakeProvider({ SPY, ACME }), licence: "internal" }), now: () => Date.parse("2026-11-02T20:00:30Z") });
  const app = express(); app.use(express.json());
  app.use("/bt", createBacktestRouter({ service, now: () => Date.parse("2026-11-02T20:00:30Z"), log: { log() {}, error() {} } }));
  const srv = app.listen(0, "127.0.0.1"); await new Promise((r) => srv.once("listening", r));
  try {
    const base = `http://127.0.0.1:${srv.address().port}/bt`;
    const { jobId } = await (await fetch(`${base}/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from: "2026-01-01", to: "2026-10-31" }) })).json();
    let j; for (let i = 0; i < 200; i++) { j = await (await fetch(`${base}/run/${jobId}`)).json(); if (j.state !== "running") break; await new Promise((r) => setTimeout(r, 10)); }
    const acme = j.result.signals.find((s) => s.ticker === "ACME"), anon = j.result.signals.find((s) => !s.ticker);
    const r = await (await fetch(`${base}/run/${jobId}/publication-now`)).json();
    const a = r.rows[acme.id];
    assert.equal(a.publishedAt, "2026-03-05 10:15:00 ET");
    assert.ok(a.elapsedMs > 0);
    assert.ok(asked.every((s) => s >= "2026-03-05T15:15:00.000Z"), "trade search never starts before publication");
    for (const m of [a.primary, a.regular]) {
      assert.deepEqual([m.status, m.entry.price, m.entry.time, m.entry.session, m.entry.provider, m.entry.splitFactor, m.entry.splitAdjustedPrice, m.changePct],
        ["ok", 40, "2026-03-05T15:15:03.120000000Z", "regular", "alpaca", 2, 20, 0.1], "2-for-1 split on 2026-06-01 between entry and now");
    }
    assert.deepEqual([a.latest.price, a.latest.provider, a.latest.source, a.latest.ageMs], [22, "alpaca", "iex_last_trade", 32000]);
    assert.equal(r.rows[anon.id].status, "no_ticker");
    assert.equal(r.rows[anon.id].primary.status, "no_ticker");
    const p = await (await fetch(`${base}/run/${jobId}/publication-now`, { headers: { "X-Forwarded-For": "203.0.113.9" } })).json();
    assert.deepEqual(p.rows[acme.id].status, "price_data_restricted");
    assert.equal(p.rows[acme.id].primary.entry, undefined);
    assert.equal(p.rows[acme.id].latest, undefined);
    assert.ok(!/"(price|changePct|splitAdjustedPrice)"/.test(JSON.stringify(p)), "no prices or returns leak");
  } finally { srv.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------- Latest price for rows WITHOUT an entry (ASPE case) ----------
async function pubNowWith(alpaca, nowIso = "2026-03-05T21:30:00Z") {
  const ROWS = [
    tx({ owners: [O.CEO], date: "2026-03-02", accepted: "2026-03-03 17:00:00" }),
    tx({ owners: [O.CFO], date: "2026-03-04", accepted: "2026-03-05 16:10:00" }), // published after the close (21:10Z)
  ];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-latest-"));
  const prices = createBacktestPriceService({ alpacaFactory: () => alpaca, tiingo: null, entriesFile: path.join(dir, "e.json"), now: () => Date.parse(nowIso), log: { warn() {} } });
  const service = createBacktestService({ prices, loadStore: () => ({ sig: "x", records: new Map(), days: new Map() }), live: () => ({ transactions: ROWS, amendmentFilings: [], coverage: [], noIndexDays: [], dataVersion: 1 }),
    getProvider: () => ({ ...fakeProvider({ SPY: barsFor("2026-01-02", "2026-03-31", (d, i) => ({ open: 400 + i, close: 400 + i })), ACME: barsFor("2026-01-02", "2026-03-31", () => ({ open: 40, close: 40 })) }), licence: "internal" }), now: () => Date.parse(nowIso) });
  const result = await service.run(service.normalize({ from: "2026-01-01", to: "2026-03-31" }).config);
  const r = await service.publicationNow({ result });
  fs.rmSync(dir, { recursive: true, force: true });
  return { r, row: Object.values(r.rows)[0] };
}
const fakeAlpaca = ({ trades = [], latest = {}, latestError = null } = {}) => {
  const calls = [];
  return { calls, stats: () => ({}),
    tradesPage: async (sym, q) => { calls.push(["trades", q.start]); return { trades: trades.filter((t) => t.t >= q.start), next: null }; },
    barsPage: async () => ({ bars: [], next: null }),
    latestTrades: async (syms) => { calls.push(["latest", syms.join(",")]); if (latestError) throw latestError; return latest; } };
};

test("no entry yet: latest price is still requested and shown; returns stay unavailable; a pre-signal trade is never the entry", async () => {
  const a = fakeAlpaca({
    trades: [{ t: "2026-03-05T21:05:00Z", p: 39, s: 500, c: ["@"] },                 // BEFORE publication (21:10Z)
             { t: "2026-03-05T21:12:00Z", p: 40, s: 4, c: ["@", "T", "I"] }],          // after, but an odd lot
    latest: { ACME: { t: "2026-03-05T21:12:00Z", p: 40 } },
  });
  const { r, row } = await pubNowWith(a);
  assert.deepEqual(a.calls.find((c) => c[0] === "latest"), ["latest", "ACME"], "latest requested although no entry exists");
  assert.deepEqual([row.primary.status, row.primary.entry, row.primary.changePct], ["awaiting_first_trade", null, undefined]);
  assert.equal(row.regular.status, "awaiting_regular_session", "next open is tomorrow 09:30 ET");
  assert.deepEqual([row.latest.status, row.latest.price, row.latest.provider, row.latest.session], ["ok", 40, "alpaca", "post"]);
  assert.equal(row.latest.ageMs, Date.parse("2026-03-05T21:30:00Z") - Date.parse("2026-03-05T21:12:00Z"));
  assert.equal(r.market.session, "post", "after-hours at 16:30 ET");
  assert.ok(a.calls.filter((c) => c[0] === "trades").every((c) => c[1] >= "2026-03-05T21:10:00.000Z"), "searches never start before publication");
});

test("stale latest: an old trade keeps its own timestamp and age (never relabelled as current)", async () => {
  const a = fakeAlpaca({ latest: { ACME: { t: "2026-03-04T20:59:00Z", p: 41 } } });
  const { r, row } = await pubNowWith(a, "2026-03-07T15:00:00Z"); // Saturday
  assert.deepEqual([row.latest.price, row.latest.time, row.latest.session], [41, "2026-03-04T20:59:00Z", "regular"]);
  assert.ok(row.latest.ageMs > 2 * 86_400_000);
  assert.equal(r.market.session, "closed", "weekend");
});

test("unsupported symbol and API failure: latest is 'unavailable' — nothing invented, no return", async () => {
  const none = await pubNowWith(fakeAlpaca({ latest: {} }));                       // Alpaca returns no trade for the symbol
  assert.equal(none.row.latest.status, "unavailable");
  const fail = await pubNowWith(fakeAlpaca({ latestError: new Error("Alpaca HTTP 503") }));
  assert.equal(fail.row.latest.status, "unavailable");
  for (const x of [none.row, fail.row]) assert.equal(x.primary.changePct, undefined);
});
