// Backtest API integration: status, validation, job lifecycle, one run at a time,
// and the three result states — complete (with a price provider), price data
// required (no provider: signals only, NO performance numbers); legacy ILS field refused.
// SYNTHETIC filings and bars.
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createBacktestRouter } from "../../routers/backtestRoutes.js";
import { createBacktestService, normalizeRunConfig } from "./backtestEngine.js";
import { OWNERS as O, tx, barsFor, fakeProvider } from "./testFixtures.js";

const NOW = Date.parse("2026-11-02T15:00:00Z");
const ROWS = [
  tx({ owners: [O.CEO], date: "2026-03-02", accepted: "2026-03-03 17:00:00" }),
  tx({ owners: [O.CFO], date: "2026-03-04", accepted: "2026-03-05 21:45:10" }),
];
const emptyStore = () => ({ sig: "empty", records: new Map(), days: new Map() });
const live = () => ({ transactions: ROWS, amendmentFilings: [], coverage: [], noIndexDays: [], dataVersion: 1 });
const SPY = barsFor("2026-01-02", "2026-10-30", (d, i) => ({ open: 100 + i * 0.1, close: 100.05 + i * 0.1 }));
const ACME = barsFor("2026-01-02", "2026-10-30", (d, i) => ({ open: 20 + i * 0.05, close: 20.02 + i * 0.05 }));
const unavailable = { name: null, available: false, reason: "No licensed market-data provider is configured", capabilities: null };

async function withApp(service, fn) {
  const app = express();
  app.use(express.json());
  app.use("/bt", createBacktestRouter({ service, now: () => NOW, log: { log() {}, error() {} } }));
  const srv = app.listen(0);
  try { await fn(`http://127.0.0.1:${srv.address().port}/bt`); } finally { srv.close(); }
}
const post = (url, body) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
async function runToEnd(base, body) {
  const r = await post(`${base}/run`, body);
  assert.equal(r.status, 202);
  const { jobId } = await r.json();
  for (let i = 0; i < 200; i++) {
    const j = await (await fetch(`${base}/run/${jobId}`)).json();
    if (j.state !== "running") return j;
    await new Promise((res) => setTimeout(res, 10));
  }
  throw new Error("job did not finish");
}

test("config validation", () => {
  assert.ok(normalizeRunConfig({}, NOW).error);
  assert.ok(normalizeRunConfig({ from: "2026-05-01", to: "2026-01-01" }, NOW).error);
  assert.ok(normalizeRunConfig({ from: "2000-01-01", to: "2026-01-01" }, NOW).error, "max 15 years");
  assert.ok(normalizeRunConfig({ from: "2026-01-01", slippageBps: 9999 }, NOW).error);
  assert.ok(normalizeRunConfig({ from: "2026-01-01", roles: ["CEO", "Pope"] }, NOW).error);
  const ok = normalizeRunConfig({ from: "2026-01-01", to: "2027-05-01", roles: ["CEO"] }, NOW).config;
  assert.equal(ok.to, "2026-11-02", "clipped to today");
  assert.equal(ok.minBuyers, 2);
  assert.equal(ok.minValueUsd, 250_000);
  assert.equal(ok.minValueIls, undefined);
  assert.match(normalizeRunConfig({ from: "2026-01-01", minValueIls: 250000 }, NOW).error, /U.S. dollars/);
  assert.equal(ok.windowDays, 30);
});

test("no price provider → price_data_required: real signals and planned entries, no performance", async () => {
  const service = createBacktestService({ quotes: { getQuote: async () => ({ status: "no_key" }) }, loadStore: emptyStore, live, getProvider: () => unavailable, now: () => NOW });
  await withApp(service, async (base) => {
    const st = await (await fetch(`${base}/status?from=2026-01-01&to=2026-06-30`)).json();
    assert.equal(st.prices.available, false);
    assert.equal(st.defaults.minValueUsd, 250_000);
    assert.ok(st.methodology.entry && st.methodology.overlap);
    assert.ok(st.form4.range.businessDays > 100);
    assert.equal(st.form4.range.complete, false, "only live data, nothing backfilled");
    const bad = await post(`${base}/run`, { from: "bad" });
    assert.equal(bad.status, 400);
    const j = await runToEnd(base, { from: "2026-01-01", to: "2026-06-30" });
    assert.equal(j.state, "done");
    const r = j.result;
    assert.equal(r.status, "price_data_required");
    assert.equal(r.signals.length, 1);
    assert.equal(r.signals[0].entryDate, "2026-03-06");
    assert.equal(r.signals[0].entryPrice, null);
    assert.equal(r.stats, null);
    assert.equal(r.equity, null);
    assert.equal(r.coverage.complete, false);
  });
});

test("with a price provider → complete results; one run at a time", async () => {
  let release;
  const gate = new Promise((res) => { release = res; });
  const provider = fakeProvider({ SPY, ACME });
  const slow = { ...provider, async getDailyBars(...a) { await gate; return provider.getDailyBars(...a); } };
  const service = createBacktestService({ quotes: { getQuote: async () => ({ status: "no_key" }) }, loadStore: emptyStore, live, getProvider: () => slow, now: () => NOW });
  await withApp(service, async (base) => {
    const first = await post(`${base}/run`, { from: "2026-01-01", to: "2026-06-30", commissionBps: 5 });
    assert.equal(first.status, 202);
    const busy = await post(`${base}/run`, { from: "2026-01-01", to: "2026-06-30" });
    assert.equal(busy.status, 409);
    const { jobId } = await first.json();
    const running = await (await fetch(`${base}/run/${jobId}`)).json();
    assert.equal(running.state, "running");
    assert.equal(running.result, null);
    release();
    let j;
    for (let i = 0; i < 200; i++) { j = await (await fetch(`${base}/run/${jobId}`)).json(); if (j.state !== "running") break; await new Promise((r) => setTimeout(r, 10)); }
    assert.equal(j.state, "done");
    const r = j.result;
    assert.equal(r.status, "complete");
    assert.equal(r.signals[0].status, "evaluated");
    assert.equal(r.signals[0].entryDate, "2026-03-06");
    assert.equal(r.stats.byHorizon["30d"].n, 1);
    assert.equal(r.stats.costPerSideBps, 5);
    assert.ok(r.equity.points.length > 0);
    assert.equal((await fetch(`${base}/run/nope`)).status, 404);
  });
});

test("a saved request with the old ILS threshold is refused (400), never reinterpreted", async () => {
  const service = createBacktestService({ quotes: { getQuote: async () => ({ status: "no_key" }) }, loadStore: emptyStore, live, getProvider: () => unavailable, now: () => NOW });
  await withApp(service, async (base) => {
    const r = await post(`${base}/run`, { from: "2026-01-01", to: "2026-06-30", minValueIls: 250000 });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /U.S. dollars/);
    const st = await (await fetch(`${base}/status`)).json();
    assert.equal(st.defaults.minValueUsd, 250_000);
    assert.equal(st.fx, undefined, "no FX in the backtest any more");
  });
});
