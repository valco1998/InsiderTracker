// End-to-end user-strategy backtest (engine + price service + router redaction).
// SYNTHETIC SEC rows and a fake Alpaca — no network, temp cache files only.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createBacktestService } from "./backtestEngine.js";
import { createBacktestPriceService } from "./backtestPrices.js";
import { OWNERS as O, tx, barsFor, fakeProvider } from "./testFixtures.js";
import { sessionAfter } from "./horizonReturns.js";
import { etParts } from "./entrySelection.js";

const NOW = Date.parse("2027-02-01T15:00:00Z");
const quiet = { warn() {}, log() {}, error() {} };

// Prices: ACME trades every 30 s from 04:00 to 20:00 ET (extended + regular) at a price that
// rises 1 cent per trade; daily closes rise $1 per session. SPY: flat 500 trades, closes 500 + i×0.5.
// MISSING: no ticker data at all → no entry.
const SESSIONS = barsFor("2026-01-02", "2027-01-29", () => ({ open: 1, close: 1 })).map((b) => b.date);
const closeOf = (sym, d) => { const i = SESSIONS.indexOf(d); return i < 0 ? null : sym === "SPY" ? 500 + i * 0.5 : 50 + i; };
function fakeAlpaca() {
  const calls = { trades: [] };
  return {
    calls,
    stats: () => ({}),
    tradesPage: async (sym, q) => {
      calls.trades.push([sym, q.start]);
      if (sym === "MISSING") return { trades: [], next: null };
      const start = Date.parse(q.start), out = [];
      for (let t = Math.ceil(start / 30_000) * 30_000, k = 0; out.length < 200 && k < 6000; t += 30_000, k++) {
        const iso = new Date(t).toISOString();
        const p = etParts(iso);
        if (!SESSIONS.includes(p.date) || p.time < "04:00:00" || p.time >= "20:00:00") continue;
        const ext = p.time < "09:30:00" || p.time >= "16:00:00";
        out.push({ t: iso, p: sym === "SPY" ? 500 : 40 + (t % 86_400_000) / 30_000 / 100, s: 100, c: ext ? ["@", "T"] : ["@"] });
      }
      return { trades: out, next: null };
    },
    barsPage: async () => ({ bars: [], next: null }),
    barsMultiPage: async (syms, q) => ({
      bars: Object.fromEntries(syms.map((s) => [s, SESSIONS.filter((d) => d >= q.start.slice(0, 10)).map((d) => ({ t: `${d}T05:00:00Z`, c: closeOf(s, d) }))])), next: null,
    }),
    latestTrades: async (syms) => Object.fromEntries(syms.map((s) => [s, { t: "2027-02-01T14:50:00Z", p: 60 }])),
  };
}

const ROWS = [
  // ACME: CEO + CFO; the CFO's filing completes the signal on Mon 2026-11-02 at 16:30 ET (after the close).
  tx({ owners: [O.CEO], date: "2026-10-28", accepted: "2026-10-29 17:00:00" }),
  tx({ owners: [O.CFO], date: "2026-10-30", accepted: "2026-11-02 16:30:00" }),
  // MISSING: a signal whose stock has no price data.
  tx({ owners: [O.CEO], date: "2026-10-28", accepted: "2026-10-29 11:00:00", ticker: "MISSING", issuerCik: "0000005009" }),
  tx({ owners: [O.CFO], date: "2026-10-29", accepted: "2026-10-30 11:00:00", ticker: "MISSING", issuerCik: "0000005009" }),
];

function setup(rows = ROWS) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-strategy-"));
  const alpaca = fakeAlpaca();
  const prices = createBacktestPriceService({ alpacaFactory: () => alpaca, tiingo: null, entriesFile: path.join(dir, "entries.json"), now: () => NOW, log: quiet });
  const bars = barsFor("2026-01-02", "2027-01-29", (d, i) => ({ open: 400 + i, close: 400 + i }));
  const service = createBacktestService({
    prices, loadStore: () => ({ sig: "x", records: new Map(), days: new Map() }),
    live: () => ({ transactions: rows, amendmentFilings: [], coverage: [], noIndexDays: [], dataVersion: 1 }),
    getProvider: () => ({ ...fakeProvider({ SPY: bars }), licence: "internal" }), now: () => NOW, ipo: { classify: async () => ({}) },
  });
  return { service, alpaca, dir };
}
const runInline = async (service, body) => {
  const n = service.normalize({ from: "2026-10-01", to: "2026-12-31", ...body });
  assert.ok(n.config, n.error);
  const result = await service.run(n.config);
  return { result, pub: await service.publicationNow({ result, lookupBudget: Infinity, background: false }) };
};

test("timestamps stay distinct: trade dates → SEC acceptance → availability (+latency) → entry → exit after N sessions", async () => {
  const { service, dir } = setup();
  const { result, pub } = await runInline(service, { horizonSessions: 5, executionLatencySeconds: 60, entrySession: "regular" });
  const s = result.signals.find((x) => x.ticker === "ACME");
  const r = pub.rows[s.id].strategy;
  assert.equal(s.windowFrom, "2026-10-28");
  assert.equal(s.publishedAt, "2026-11-02 16:30:00 ET");
  assert.equal(r.secAcceptedAt, "2026-11-02 16:30:00 ET");
  assert.equal(r.availableAt, "2026-11-02T21:31:00.000Z", "acceptance + 60 s");
  assert.equal(r.entrySearchStart, "2026-11-03T14:30:00.000Z", "after-hours filing → next regular open");
  assert.equal(r.status, "ok");
  assert.ok(Date.parse(r.entry.time) >= Date.parse(r.availableAt), "entry never before public availability");
  assert.ok(r.entry.time > `${s.windowTo}T23:59:59Z`, "never on the insider's trade date");
  assert.equal(r.entry.session, "regular");
  assert.equal(r.exit.date, sessionAfter("2026-11-03", 5));
  assert.equal(r.exit.price, closeOf("ACME", r.exit.date));
  assert.equal(r.gross, Math.round((r.exit.price / r.entry.adjustedPrice - 1) * 1e6) / 1e6);
  assert.equal(r.benchmark, Math.round((closeOf("SPY", r.exit.date) / 500 - 1) * 1e6) / 1e6, "SPY bought at its first trade at/after the stock entry");
  assert.equal(pub.strategy.config.horizonSessions, 5);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the user's horizon, session rule and costs change the result; missing prices are counted, never filled", async () => {
  const { service, dir } = setup();
  const a = await runInline(service, { horizonSessions: 1, executionLatencySeconds: 60, entrySession: "regular" });
  const b = await runInline(service, { horizonSessions: 20, executionLatencySeconds: 60, entrySession: "regular", commissionBps: 10, slippageBps: 15 });
  const c = await runInline(service, { horizonSessions: 1, executionLatencySeconds: 60, entrySession: "extended" });
  const pick = (x) => Object.values(x.pub.rows).find((r) => r.symbol === "ACME").strategy;
  const [ra, rb, rc] = [pick(a), pick(b), pick(c)];
  assert.notEqual(ra.exit.date, rb.exit.date);
  assert.equal(rb.exit.date, sessionAfter("2026-11-03", 20));
  assert.equal(rb.costPerSideBps, 25);
  assert.ok(rb.net < rb.gross, "net after costs is below gross");
  assert.equal(ra.gross, ra.net, "no costs → gross = net");
  assert.equal(rc.entry.session, "post", "extended rule: after-hours print right after availability");
  assert.ok(Date.parse(rc.entry.time) >= Date.parse("2026-11-02T21:31:00Z"));
  const miss = Object.values(a.pub.rows).find((r) => r.symbol === "MISSING").strategy;
  assert.equal(miss.gross, undefined);
  assert.notEqual(miss.status, "ok");
  assert.equal(a.pub.strategy.summary.signals, 2);
  assert.equal(a.pub.strategy.summary.n, 1);
  assert.equal(Object.values(a.pub.strategy.summary.missing).reduce((x, y) => x + y, 0), 1, "the missing-price signal is counted as missing");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("reruns are identical; invalid settings are refused with a plain message", async () => {
  const { service, dir } = setup();
  const one = await runInline(service, { horizonSessions: 3 });
  const two = await runInline(service, { horizonSessions: 3 });
  const view = (x) => Object.fromEntries(Object.entries(x.pub.rows).map(([k, r]) => [k, [r.strategy.status, r.strategy.entry?.time, r.strategy.exit?.date, r.strategy.gross]]));
  assert.deepEqual(view(one), view(two));
  assert.deepEqual(one.result.signals.map((s) => s.id), two.result.signals.map((s) => s.id));
  assert.match(service.normalize({ from: "2026-10-01", horizonSessions: 0 }).error, /horizonSessions/);
  assert.match(service.normalize({ from: "2026-10-01", horizonSessions: 2.5 }).error, /whole number/);
  assert.match(service.normalize({ from: "2026-10-01", entrySession: "night" }).error, /entrySession/);
  assert.match(service.normalize({ from: "2026-10-01", executionLatencySeconds: -1 }).error, /executionLatencySeconds/);
  const d = service.normalize({ from: "2026-10-01" }).config;
  assert.deepEqual([d.horizonSessions, d.executionLatencySeconds, d.entrySession, d.maxFilingDelayDays, d.maxSignalLagDays], [20, 60, "regular", null, null]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("licence guard: strategy prices and returns never reach non-local viewers", async () => {
  const { default: express } = await import("express");
  const { createBacktestRouter } = await import("../../routers/backtestRoutes.js");
  const { service, dir } = setup();
  const app = express(); app.use(express.json());
  app.use("/bt", createBacktestRouter({ service, log: quiet }));
  const srv = app.listen(0, "127.0.0.1"); await new Promise((r) => srv.once("listening", r));
  try {
    const base = `http://127.0.0.1:${srv.address().port}/bt`;
    const { jobId } = await (await fetch(`${base}/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from: "2026-10-01", to: "2026-12-31" }) })).json();
    for (let i = 0; i < 100; i++) { const j = await (await fetch(`${base}/run/${jobId}`)).json(); if (j.state !== "running") break; await new Promise((r) => setTimeout(r, 20)); }
    const proxied = await (await fetch(`${base}/run/${jobId}/publication-now`, { headers: { "X-Forwarded-For": "203.0.113.9" } })).json();
    const rows = Object.values(proxied.rows);
    assert.ok(rows.length > 0);
    for (const r of rows) {
      assert.equal(r.strategy.entry, undefined);
      assert.equal(r.strategy.gross, undefined);
      assert.ok(r.strategy.secAcceptedAt, "SEC timing stays visible");
    }
    assert.equal(proxied.strategy.summary, null);
  } finally { srv.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

// A later SEC publication for ACME (COO, filed after the signal) + a repeat buy by the CEO.
const LATER = [
  tx({ owners: [O.COO], date: "2026-11-05", accepted: "2026-11-06 10:00:00", shares: 2000 }),
  tx({ owners: [O.CEO], date: "2026-11-09", accepted: "2026-11-10 18:00:00", shares: 1000 }),
];

test("company timeline: snapshot vs subsequent publications, plotted at the publication session on daily closes", async () => {
  const { service, dir } = setup([...ROWS, ...LATER]);
  const { result, pub } = await runInline(service, { horizonSessions: 5 });
  const s = result.signals.find((x) => x.ticker === "ACME");
  // The signal is unchanged by the later filings (frozen snapshot, same entry).
  assert.deepEqual([s.publishedAt, s.uniqueBuyers, s.purchases, s.valueUsd], ["2026-11-02 16:30:00 ET", 2, 2, 300_000]);
  assert.equal(pub.rows[s.id].strategy.entrySearchStart, "2026-11-03T14:30:00.000Z");
  assert.equal(s.hindsight.laterPurchases.length, 2);
  const t = await service.track({ result, signalId: s.id });
  assert.equal(t.status, "ok");
  assert.equal(t.priceBasis, "daily_close_only", "daily closes only — no intraday reaction drawn");
  assert.equal(t.prices.licence, "internal");
  const roles = Object.fromEntries(t.events.map((e) => [e.publishedAt, e.signalRole]));
  assert.deepEqual(roles, {
    "2026-10-29 17:00:00 ET": "signal_snapshot", "2026-11-02 16:30:00 ET": "signal_snapshot",
    "2026-11-06 10:00:00 ET": "subsequent_publication", "2026-11-10 18:00:00 ET": "subsequent_publication",
  });
  const late = t.events.find((e) => e.publishedAt === "2026-11-10 18:00:00 ET");
  assert.equal(late.publicationSession, "2026-11-11", "after-hours publication → next session");
  assert.equal(late.publicationPriceDate, "2026-11-11");
  assert.equal(late.date, "2026-11-09", "trade date kept separately");
  assert.ok(late.insider && late.roles.length && late.shares === 1000 && late.valueUsd === 50_000);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("event study: each later SEC publication measured from its own acceptance — separate from the signal", async () => {
  const { service, dir } = setup([...ROWS, ...LATER]);
  const { result, pub } = await runInline(service, { horizonSessions: 1, executionLatencySeconds: 60, entrySession: "regular" });
  const s = result.signals.find((x) => x.ticker === "ACME");
  const before = JSON.stringify(pub.rows[s.id].strategy);
  const es = await service.eventStudy({ result, signalId: s.id });
  assert.equal(es.basis, "subsequent_sec_publications");
  assert.deepEqual(es.events.map((e) => e.publishedAt), ["2026-11-06 10:00:00 ET", "2026-11-10 18:00:00 ET"]);
  const [a, b] = es.events;
  assert.equal(a.availableAt, "2026-11-06T15:01:00.000Z");
  assert.equal(a.strategy.status, "ok");
  assert.ok(Date.parse(a.strategy.entry.time) >= Date.parse(a.availableAt));
  assert.equal(a.strategy.exit.date, "2026-11-09", "1 session after Friday → Monday");
  assert.equal(b.entrySearchStart, "2026-11-11T14:30:00.000Z");
  assert.equal(es.summary.n, 2);
  assert.equal(es.reliability.verdict, "not_reliable");
  assert.ok(es.reliability.reasons.includes("small_sample"));
  const again = await service.publicationNow({ result, lookupBudget: Infinity, background: false });
  assert.equal(JSON.stringify(again.rows[s.id].strategy), before, "the signal's entry/return is never rewritten");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("reliability: incomplete SEC coverage or a small sample is never presented as reliable", async () => {
  const { assessReliability } = await import("./strategyReturns.js");
  const full = { complete: true, ratio: 1 };
  const big = { signals: 40, n: 40, benchmarkN: 40, missing: {} };
  assert.equal(assessReliability({ coverage: full, summary: big }).verdict, "indicative");
  assert.deepEqual(assessReliability({ coverage: { complete: false, ratio: 0.6 }, summary: big }).reasons, ["sec_coverage_incomplete"]);
  assert.ok(assessReliability({ coverage: full, summary: { ...big, n: 29, benchmarkN: 29, signals: 29 } }).reasons.includes("small_sample"));
  assert.ok(assessReliability({ coverage: full, summary: { signals: 60, n: 40, benchmarkN: 40, missing: { no_bar: 20 } } }).reasons.includes("many_missing_prices"));
  assert.ok(assessReliability({ coverage: full, summary: { signals: 100, n: 40, benchmarkN: 40, missing: { immature: 60 } } }).reasons.includes("most_horizons_immature"));
  const { result, pub } = await (async () => { const x = setup(); const r = await runInline(x.service, {}); fs.rmSync(x.dir, { recursive: true, force: true }); return r; })();
  assert.equal(pub.strategy.reliability.verdict, "not_reliable");
  assert.equal(result.coverage.complete, false, "test data has no SEC coverage → flagged");
});
