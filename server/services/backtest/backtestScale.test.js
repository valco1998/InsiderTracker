// Backtesting at scale (SYNTHETIC data, fake Alpaca — no network):
//   • a page poll never waits on Alpaca trade lookups (background pricing queue),
//   • concurrent identical polls share one computation,
//   • once the queue settles, every value equals the old inline (blocking) computation,
//   • 2,000 signals: first response fast, every signal present, queue completes.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createBacktestService } from "./backtestEngine.js";
import { createBacktestPriceService } from "./backtestPrices.js";
import { tx, barsFor, fakeProvider } from "./testFixtures.js";

const NOW = Date.parse("2026-11-03T15:00:00Z");
const quiet = { warn() {}, log() {}, error() {} };

// n issuers, each with a 2-buyer cluster published on a business day in Sep–Oct 2026.
function synthRows(n) {
  const rows = [];
  const days = barsFor("2026-09-01", "2026-10-15", () => ({ open: 1, close: 1 })).map((b) => b.date);
  for (let i = 0; i < n; i++) {
    const d = days[i % days.length];
    const ticker = `S${String(i).padStart(4, "0")}`, issuerCik = String(900000 + i).padStart(10, "0");
    const a = { cik: String(100000 + 2 * i).padStart(10, "0"), name: `Buyer A${i}`, role: "Director", isDirector: true };
    const b = { cik: String(100001 + 2 * i).padStart(10, "0"), name: `Buyer B${i}`, role: "Director", isDirector: true };
    rows.push(tx({ owners: [a], date: d, accepted: `${d} 17:00:00`, ticker, issuerCik }));
    rows.push(tx({ owners: [b], date: d, accepted: `${d} 17:30:00`, ticker, issuerCik }));
  }
  return rows;
}

// Fake Alpaca: one eligible trade 2 min after any start; deterministic prices per symbol.
function fakeAlpaca({ delayMs = 0 } = {}) {
  const calls = { trades: 0, bars: 0, multi: 0, latest: 0 };
  const px = (sym) => 10 + (parseInt(sym.slice(1), 10) % 50);
  const sleep = () => (delayMs ? new Promise((r) => setTimeout(r, delayMs)) : null);
  return {
    calls,
    stats: () => ({ requests: calls.trades + calls.bars + calls.multi + calls.latest }),
    tradesPage: async (sym, q) => { calls.trades++; await sleep(); return { trades: [{ t: new Date(Date.parse(q.start) + 120_000).toISOString(), p: px(sym), s: 100, c: ["@"] }], next: null }; },
    barsPage: async (sym, q) => { calls.bars++; return { bars: [{ t: `${q.start.slice(0, 10)}T04:00:00Z`, c: px(sym) * (q.adjustment === "split" ? 1 : (parseInt(sym.slice(1), 10) % 7 === 0 ? 2 : 1)) }], next: null }; },
    barsMultiPage: async (syms, q) => {
      calls.multi++;
      const days = barsFor(q.start.slice(0, 10), "2026-11-02", () => ({ open: 1, close: 1 })).map((b) => b.date);
      // Every 7th symbol had a 2-for-1 split after September (raw = 2 × split-adjusted).
      return { bars: Object.fromEntries(syms.map((s) => [s, days.map((d, i) => ({ t: `${d}T04:00:00Z`, c: (px(s) + i * 0.01) * (q.adjustment === "raw" && parseInt(s.slice(1), 10) % 7 === 0 ? 2 : 1) }))])), next: null };
    },
    latestTrades: async (syms) => { calls.latest++; return Object.fromEntries(syms.map((s) => [s, { t: "2026-11-03T14:50:00Z", p: px(s) * 1.1 }])); },
  };
}

function setup(n, alpaca, { pricingConcurrency = 3 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-scale-"));
  const ROWS = synthRows(n);
  const bars = barsFor("2026-01-02", "2026-11-02", (d, i) => ({ open: 400 + i, close: 400 + i }));
  const prices = createBacktestPriceService({ alpacaFactory: () => alpaca, tiingo: null, entriesFile: path.join(dir, "e.json"), now: () => NOW, log: quiet, pricingConcurrency });
  const service = createBacktestService({ prices, loadStore: () => ({ sig: "x", records: new Map(), days: new Map() }),
    live: () => ({ transactions: ROWS, amendmentFilings: [], coverage: [], noIndexDays: [], dataVersion: 1 }),
    getProvider: () => ({ ...fakeProvider({ SPY: bars }), licence: "internal" }), now: () => NOW, ipo: { classify: async () => ({}) } });
  return { service, dir };
}
async function settle(service, result, maxMs = 120_000) {
  const t0 = Date.now(); let r;
  while (Date.now() - t0 < maxMs) {
    r = await service.publicationNow({ result });
    if (!r.pricing.pendingRows && !r.pricing.queued && !r.pricing.inFlight) return r;
    await new Promise((x) => setTimeout(x, 5));
  }
  throw new Error("pricing did not settle");
}
const comparable = (r) => Object.fromEntries(Object.entries(r.rows).map(([id, x]) => [id, {
  p: [x.primary.status, x.primary.entry?.price, x.primary.entry?.time, x.primary.entry?.splitFactor, x.primary.changePct, JSON.stringify(x.primary.horizons)],
  g: [x.regular.status, x.regular.entry?.price, x.regular.entry?.time, x.regular.entry?.splitFactor, x.regular.changePct],
}]));

test("page poll never waits on Alpaca trade lookups; identical concurrent polls are coalesced", async () => {
  const alpaca = fakeAlpaca({ delayMs: 200 });
  const { service, dir } = setup(20, alpaca);
  const result = await service.run(service.normalize({ from: "2026-09-01", to: "2026-10-31" }).config);
  assert.equal(result.signals.length, 20);
  const t0 = Date.now();
  const [a, b] = await Promise.all([service.publicationNow({ result }), service.publicationNow({ result })]);
  const ms = Date.now() - t0;
  assert.equal(a, b, "same in-flight computation shared");
  assert.ok(ms < 150, `first poll answered in ${ms} ms without waiting on 200 ms trade lookups`);
  assert.equal(a.pricing.pendingRows, 20, "every row is explicitly pending — none silently missing");
  assert.ok(Object.values(a.rows).every((x) => x.primary.status === "lookup_queued" && x.primary.changePct === undefined), "never a fabricated 0 %");
  const done = await settle(service, result);
  assert.ok(Object.values(done.rows).every((x) => x.primary.status === "ok"));
  assert.ok(alpaca.calls.trades <= 40, `each signal looked up once per kind (trades=${alpaca.calls.trades})`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("background-settled results are identical to the inline (old) computation, incl. split factors and horizons", async () => {
  const bg = setup(60, fakeAlpaca());
  const inline = setup(60, fakeAlpaca());
  const cfg = bg.service.normalize({ from: "2026-09-01", to: "2026-10-31" }).config;
  const r1 = await bg.service.run(cfg), r2 = await inline.service.run(cfg);
  const a = await settle(bg.service, r1);
  const b = await inline.service.publicationNow({ result: r2, lookupBudget: Infinity, background: false });
  assert.deepEqual(comparable(a), comparable(b));
  const split = Object.values(a.rows).filter((x) => x.primary.entry?.splitFactor === 2);
  assert.ok(split.length > 0, "2-for-1 splits detected from batched raw vs split closes");
  assert.ok(split.every((x) => x.primary.entry.splitAdjustedPrice === x.primary.entry.price / 2));
  for (const s of [bg, inline]) fs.rmSync(s.dir, { recursive: true, force: true });
});

test("scale: 2,000 signals — run, first poll and full pricing; all signals present; split checks batched", async () => {
  const alpaca = fakeAlpaca();
  const { service, dir } = setup(2000, alpaca, { pricingConcurrency: 6 });
  let t = Date.now();
  const result = await service.run(service.normalize({ from: "2026-09-01", to: "2026-10-31" }).config);
  const runMs = Date.now() - t;
  assert.equal(result.signals.length, 2000, "no qualifying signal dropped");
  t = Date.now();
  const first = await service.publicationNow({ result });
  const firstMs = Date.now() - t;
  assert.equal(Object.keys(first.rows).length, 2000);
  t = Date.now();
  const done = await settle(service, result);
  const settleMs = Date.now() - t;
  assert.ok(Object.values(done.rows).every((x) => x.primary.status === "ok"));
  t = Date.now();
  await service.publicationNow({ result });
  const warmMs = Date.now() - t;
  console.log(`[SCALE] signals=2000 runMs=${runMs} firstPollMs=${firstMs} allPricedMs=${settleMs} warmPollMs=${warmMs} alpaca=${JSON.stringify(alpaca.calls)}`);
  assert.equal(alpaca.calls.bars, 0, "no per-signal split requests — split factors come from batched daily bars");
  assert.ok(firstMs < 3000 && warmMs < 3000, "polls stay fast at 2,000 signals");
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- Recalculation avoided: run cache, snapshot rebuild throttle, job sharing ----------
import express from "express";
import { createBacktestRouter } from "../../routers/backtestRoutes.js";
import { loadHistoryStore, writeShard } from "./form4History.js";

test("identical runs are served from cache; a live-data change recomputes; history-only changes rebuild at most once per window", async () => {
  const ROWS = synthRows(5);
  let liveVersion = 1, storeSig = "a", builds = 0;
  const bars = barsFor("2026-01-02", "2026-11-02", (d, i) => ({ open: 400 + i, close: 400 + i }));
  const mk = (minMs) => createBacktestService({
    prices: createBacktestPriceService({ alpacaFactory: () => fakeAlpaca(), tiingo: null, entriesFile: path.join(os.tmpdir(), `bt-c-${Date.now()}-${Math.random()}.json`), now: () => NOW, log: quiet }),
    loadStore: () => ({ sig: storeSig, records: new Map(), days: new Map() }),
    live: () => { builds++; return { transactions: ROWS, amendmentFilings: [], coverage: [], noIndexDays: [], dataVersion: liveVersion }; },
    getProvider: () => ({ ...fakeProvider({ SPY: bars }), licence: "internal" }), now: () => NOW, ipo: { classify: async () => ({}) }, snapshotMinRebuildMs: minMs });
  const svc = mk(60_000);
  const cfg = svc.normalize({ from: "2026-09-01", to: "2026-10-31" }).config;
  const r1 = await svc.run(cfg);
  assert.equal(await svc.run(cfg), r1, "identical settings + data → cached result");
  storeSig = "b"; // a backfill wrote a shard
  assert.equal(await svc.run(cfg), r1, "history-only change inside the window → same snapshot, same result");
  liveVersion = 2; // live ingest has new filings
  assert.notEqual(await svc.run(cfg), r1, "live-data change → recomputed");
  const eager = mk(0);
  const e1 = await eager.run(cfg); storeSig = "c";
  assert.notEqual(await eager.run(cfg), e1, "window 0 → every data change recomputes");
  assert.ok(builds > 0);
});

test("history store: an unchanged shard is never parsed again", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-inc-"));
  writeShard(dir, { day: "2026-10-01", listed: 1, complete: true, accessions: ["a1"], records: { a1: { formType: "4", transactions: [{ code: "P" }] } }, failed: {} });
  writeShard(dir, { day: "2026-10-02", listed: 1, complete: true, accessions: ["b1"], records: { b1: { formType: "4", transactions: [{ code: "P" }] } }, failed: {} });
  const p1 = path.join(dir, "2026-10-01.json"), fixed = new Date(1_700_000_000_000); // whole-second mtimes (exact on every FS)
  fs.utimesSync(p1, fixed, fixed);
  const s1 = loadHistoryStore(dir);
  assert.equal(s1.records.size, 2);
  const p2 = path.join(dir, "2026-10-02.json");
  const t = new Date(Date.now() + 5000);
  writeShard(dir, { day: "2026-10-02", listed: 2, complete: true, accessions: ["b1", "b2"], records: { b1: { formType: "4", transactions: [{ code: "P" }] }, b2: { formType: "4", transactions: [{ code: "S" }] } }, failed: {} });
  fs.utimesSync(p2, t, t);
  // Corrupt the UNCHANGED shard on disk without changing its mtime: if it were re-read, its record would vanish.
  fs.writeFileSync(p1, "{}"); fs.utimesSync(p1, fixed, fixed);
  const s2 = loadHistoryStore(dir);
  assert.equal(s2.records.size, 3, "day 1 served from memory (not re-parsed), day 2 re-read");
  assert.equal(s2.days.get("2026-10-02").listed, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("router: an identical run submitted while it is running joins that job; a different one is refused", async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const service = { normalize: (b) => ({ config: { from: b.from, to: b.to } }), run: async () => { await gate; return { status: "complete", signals: [], prices: {} }; } };
  const app = express(); app.use(express.json());
  app.use("/bt", createBacktestRouter({ service, log: { log() {}, error() {} } }));
  const srv = app.listen(0, "127.0.0.1"); await new Promise((r) => srv.once("listening", r));
  try {
    const base = `http://127.0.0.1:${srv.address().port}/bt`;
    const post = (body) => fetch(`${base}/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const a = await (await post({ from: "2026-01-01", to: "2026-02-01" })).json();
    const b = await post({ from: "2026-01-01", to: "2026-02-01" });
    const c = await post({ from: "2026-01-01", to: "2026-03-01" });
    assert.equal(b.status, 202);
    assert.equal((await b.json()).jobId, a.jobId, "same job shared");
    assert.equal(c.status, 409, "different settings still wait for the running job");
  } finally { release(); srv.close(); }
});
