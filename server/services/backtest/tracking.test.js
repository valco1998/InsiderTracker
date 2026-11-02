// Purchase-date tracking timelines: baseline on the first purchase's TRADE date,
// never reset by later purchases or later clusters, market (adjusted) prices only,
// splits, missing baseline bars, ended price history, no provider, licence guard,
// and the API end-to-end. SYNTHETIC filings and bars.
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { priceTimeline, placeEvents, trackSignalsFor, purchaseEvents, adjustmentJumps } from "./tracking.js";
import { createBacktestService } from "./backtestEngine.js";
import { createBacktestRouter, redactTrack, redactRunResult, isLocalRequest } from "../../routers/backtestRoutes.js";
import { OWNERS as O, tx, barsFor, fakeProvider } from "./testFixtures.js";

const NOW = Date.parse("2026-11-02T15:00:00Z");
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);
// Step prices: $20 until Mar 3, $22 from Mar 4, $24 from Mar 12, $26 from Apr 15.
const STEP = (d) => (d >= "2026-04-15" ? 26 : d >= "2026-03-12" ? 24 : d >= "2026-03-04" ? 22 : 20);
const ACME = barsFor("2026-01-02", "2026-10-30", (d) => ({ open: STEP(d), close: STEP(d) }));
const SPY = barsFor("2026-01-02", "2026-10-30", (d, i) => ({ open: 400 + i, close: 400 + i }));

test("the user's example: baseline $20 on the first purchase's trade date; +10 %, +20 %, +30 % — never reset", () => {
  const t = priceTimeline({ startDate: "2026-03-02", bars: ACME, benchBars: SPY, today: "2026-11-02" });
  assert.equal(t.status, "ok");
  assert.deepEqual([t.baseline.date, t.baseline.adjClose], ["2026-03-02", 20]);
  const at = (d) => t.series.find((p) => p.date === d).pct;
  close(at("2026-03-02"), 0);
  close(at("2026-03-04"), 0.1);
  close(at("2026-03-12"), 0.2);
  close(at("2026-04-15"), 0.3);
  close(t.stats.changePct, 0.3);
  assert.equal(t.stats.lastDate, "2026-10-30");
  assert.equal(t.series[0].date, "2026-03-02", "continuous from the first purchase");
  assert.equal(t.series.length - 1, t.stats.sessions);
  const events = placeEvents([{ date: "2026-03-04", insider: "B" }, { date: "2026-03-12", insider: "C" }], t.series);
  assert.deepEqual(events.map((e) => e.pctAtEvent), [t.series.find((p) => p.date === "2026-03-04").pct, t.series.find((p) => p.date === "2026-03-12").pct]);
  assert.ok(t.stats.benchmarkChangePct > 0);
});

test("splits: adjusted prices keep the timeline continuous; the corporate action is reported", () => {
  const SPLIT = barsFor("2026-01-02", "2026-10-30", (d) => (d < "2026-06-01" ? { open: 40, close: 40, adjClose: 20 } : { open: 21, close: 21, adjClose: 21 }));
  const t = priceTimeline({ startDate: "2026-03-02", bars: SPLIT, today: "2026-11-02" });
  close(t.stats.changePct, 0.05, 1e-6);
  assert.ok(t.stats.troughPct >= 0, "no fake −50 % drop");
  assert.equal(t.corporateActions.length, 1);
  assert.equal(t.corporateActions[0].date, "2026-06-01");
  assert.deepEqual(adjustmentJumps(ACME), []);
});

test("baseline uses market prices, never the insider's Form 4 price", () => {
  // The Form 4 price is not an input of priceTimeline at all; events keep it for reference only.
  const t = priceTimeline({ startDate: "2026-03-02", bars: ACME, today: "2026-11-02" });
  const [e] = placeEvents([{ date: "2026-03-02", form4Price: 5 }], t.series);
  assert.equal(t.baseline.adjClose, 20);
  assert.equal(e.form4Price, 5);
  assert.equal(e.pctAtEvent, 0);
});

test("missing baseline bar: earlier session within 5 sessions (flagged), otherwise no baseline", () => {
  const gap = ACME.filter((b) => b.date !== "2026-03-02");
  const t = priceTimeline({ startDate: "2026-03-02", bars: gap, today: "2026-11-02" });
  assert.equal(t.baseline.date, "2026-02-27");
  assert.deepEqual(t.flags, ["baseline_previous_session", "missing_sessions"]);
  assert.deepEqual(t.missingSessions, ["2026-03-02"], "the trading session without a bar is listed, not filled");
  const late = priceTimeline({ startDate: "2026-03-02", bars: ACME.filter((b) => b.date >= "2026-05-01"), today: "2026-11-02" });
  assert.equal(late.status, "no_baseline_price");
  assert.equal(late.firstPriceDate, "2026-05-01");
  assert.equal(priceTimeline({ startDate: "2026-03-02", bars: [], today: "2026-11-02" }).status, "no_price_data");
});

test("ended price history (delisting / vendor gap) is flagged, never extrapolated", () => {
  const t = priceTimeline({ startDate: "2026-03-02", bars: ACME.filter((b) => b.date <= "2026-06-30"), benchBars: SPY, today: "2026-11-02" });
  assert.equal(t.stats.lastDate, "2026-06-30");
  assert.ok(t.flags.includes("price_history_ended"));
  assert.ok(t.stats.sessionsBehindReference > 5);
});

// ---------- engine + API end-to-end ----------
const ROWS = [
  tx({ owners: [O.CEO], date: "2026-03-02", accepted: "2026-03-04 17:00:00", price: 5, shares: 30_000 }), // first purchase $150K (Form 4 price $5 ≠ market $20)
  tx({ owners: [O.CFO], date: "2026-03-04", accepted: "2026-03-06 18:00:00" }),                 // completes cluster 1 → signal
  tx({ owners: [O.COO], date: "2026-03-12", accepted: "2026-03-13 17:00:00" }),                 // same cluster — absorbed
  tx({ owners: [O.DIR], date: "2026-06-01", accepted: "2026-06-02 17:00:00" }),                 // later independent cluster …
  tx({ owners: [O.DIR2], date: "2026-06-03", accepted: "2026-06-04 17:00:00" }),                // … → signal 2
  tx({ owners: [O.CEO], date: "2026-09-01", accepted: "2026-09-02 17:00:00", shares: 10 }),     // small later purchase (no signal)
];
const live = () => ({ transactions: ROWS, amendmentFilings: [], coverage: [], noIndexDays: [], dataVersion: 1 });
const store = () => ({ sig: "empty", records: new Map(), days: new Map() });
const svc = (provider) => createBacktestService({ quotes: { getQuote: async () => ({ status: "no_key" }) }, loadStore: store, live, getProvider: () => provider, now: () => NOW });

test("engine: one company timeline anchored at the earliest cluster; later clusters and purchases are events", async () => {
  const service = svc({ ...fakeProvider({ SPY, ACME }), licence: "internal" });
  const result = await service.run(service.normalize({ from: "2026-01-01", to: "2026-10-31" }).config);
  assert.equal(result.signals.length, 2);
  const [s1, s2] = result.signals;
  assert.equal(s1.windowFrom, "2026-03-02");
  assert.equal(s1.clusterTo, "2026-03-12", "the third buyer extended the same cluster");
  const { anchor, clusters } = trackSignalsFor(result.signals, s2.issuerCik);
  assert.equal(anchor.id, s1.id);
  assert.equal(clusters.length, 2);

  const t = await service.track({ result, signalId: s2.id }); // opened from the LATER signal — same timeline
  assert.equal(t.status, "ok");
  assert.equal(t.startDate, "2026-03-02");
  assert.equal(t.baseline.adjClose, 20, "market close, not the $5 Form 4 price");
  assert.deepEqual(t.missingSessions, [], "the API carries the list of trading sessions without a bar");
  assert.deepEqual(t.events.map((e) => [e.date, e.cluster]), [["2026-03-02", 0], ["2026-03-04", 0], ["2026-03-12", 0], ["2026-06-01", 1], ["2026-06-03", 1], ["2026-09-01", null]]);
  close(t.events.find((e) => e.date === "2026-03-12").pctAtEvent, 0.2);
  close(t.events.find((e) => e.date === "2026-06-01").pctAtEvent, 0.3, 1e-9);
  assert.equal(t.events[0].form4Price, 5);
  assert.equal(t.clusters[1].windowFrom, "2026-06-01");
  assert.equal(t.clusters[0].entryDate, "2026-03-09", "tradable entry (after SEC publication) marked separately");
  close(t.stats.changePct, 0.3);
  assert.equal(result.tracks[s1.issuerCik].anchorSignalId, s1.id);
  close(result.tracks[s1.issuerCik].changePct, 0.3);
  // the publication-based backtest is unchanged and still computed
  assert.equal(result.signals[0].status, "evaluated");
  assert.equal(result.signals[0].entryDate, "2026-03-09");
});

test("engine without a price provider: events and clusters, no prices", async () => {
  const service = svc({ name: null, available: false, reason: "No licensed market-data provider is configured" });
  const result = await service.run(service.normalize({ from: "2026-01-01", to: "2026-10-31" }).config);
  const t = await service.track({ result, signalId: result.signals[0].id });
  assert.equal(t.status, "price_data_required");
  assert.equal(t.events.length, 6);
  assert.ok(t.events.every((e) => e.pctAtEvent === null));
  assert.equal(t.series, undefined);
  assert.equal(result.tracks[result.signals[0].issuerCik].changePct, null);
});

test("licence guard: price-derived data only for local requests unless licensed for public display", async () => {
  assert.equal(isLocalRequest({ socket: { remoteAddress: "127.0.0.1" }, get: () => undefined }), true);
  assert.equal(isLocalRequest({ socket: { remoteAddress: "::1" }, get: (h) => (h === "x-forwarded-for" ? "203.0.113.9" : undefined) }), false, "behind a proxy");
  assert.equal(isLocalRequest({ socket: { remoteAddress: "198.51.100.7" }, get: () => undefined }), false);

  const service = svc({ ...fakeProvider({ SPY, ACME }), licence: "internal" });
  const app = express();
  app.use(express.json());
  app.use("/bt", createBacktestRouter({ service, now: () => NOW, log: { log() {}, error() {} } }));
  const srv = app.listen(0, "127.0.0.1");
  await new Promise((r) => srv.once("listening", r));
  try {
    const base = `http://127.0.0.1:${srv.address().port}/bt`;
    const { jobId } = await (await fetch(`${base}/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from: "2026-01-01", to: "2026-10-31" }) })).json();
    let j;
    for (let i = 0; i < 200; i++) { j = await (await fetch(`${base}/run/${jobId}`)).json(); if (j.state !== "running") break; await new Promise((r) => setTimeout(r, 10)); }
    const sid = encodeURIComponent(j.result.signals[0].id);
    const local = await (await fetch(`${base}/run/${jobId}/track/${sid}`)).json();
    assert.equal(local.status, "ok");
    assert.ok(local.series.length > 100);
    const proxied = await (await fetch(`${base}/run/${jobId}/track/${sid}`, { headers: { "X-Forwarded-For": "203.0.113.9" } })).json();
    assert.equal(proxied.status, "price_data_restricted");
    assert.deepEqual(proxied.series, []);
    assert.equal(proxied.stats, null);
    assert.ok(proxied.events.every((e) => !("pctAtEvent" in e)));
    const run = await (await fetch(`${base}/run/${jobId}`, { headers: { "X-Forwarded-For": "203.0.113.9" } })).json();
    assert.equal(run.result.status, "price_data_restricted");
    assert.equal(run.result.stats, null);
    assert.ok(run.result.signals.every((s) => s.entryPrice === undefined && Object.keys(s.horizons).length === 0));
    assert.ok(Object.values(run.result.tracks).every((t) => t.changePct === null));
    assert.equal((await fetch(`${base}/run/${jobId}/track/nope`)).status, 404);
    // headline poll endpoint: local → numbers (daily close, labelled, since the test has no quote key); proxied → none
    const cur = await (await fetch(`${base}/run/${jobId}/track/${sid}/current`)).json();
    assert.deepEqual([cur.status, cur.current.basis, cur.current.startDate, cur.current.startPrice, cur.current.quoteStatus], ["ok", "eod_close", "2026-03-02", 20, "no_key"]);
    assert.ok(Math.abs(cur.current.changePct - 0.3) < 1e-9);
    const curP = await (await fetch(`${base}/run/${jobId}/track/${sid}/current`, { headers: { "X-Forwarded-For": "203.0.113.9" } })).json();
    assert.deepEqual([curP.status, curP.current], ["price_data_restricted", null]);
    assert.equal(local.current.basis, "eod_close");
  } finally { srv.close(); }
  assert.equal(redactTrack({ status: "price_data_required", events: [] }).status, "price_data_required");
  assert.equal(redactRunResult({ status: "price_data_required", signals: [] }).status, "price_data_required");
});

test("purchase events exclude superseded rows and other companies; Form 4 prices kept for reference", () => {
  const rows = [
    { code: "P", issuerCik: "5000", transactionDate: "2026-03-02", owners: [O.CEO], price: 5, value: 5000, purchaseContext: "open_market", accessionNo: "a", acceptedAtET: "2026-03-03 10:00:00 ET" },
    { code: "P", issuerCik: "5000", transactionDate: "2026-03-03", owners: [O.CFO], price: 6, value: 6000, amendment: { status: "superseded" }, accessionNo: "b", acceptedAtET: "2026-03-04 10:00:00 ET" },
    { code: "S", issuerCik: "5000", transactionDate: "2026-03-03", owners: [O.CFO], accessionNo: "c", acceptedAtET: "2026-03-04 10:00:00 ET" },
    { code: "P", issuerCik: "6000", transactionDate: "2026-03-03", owners: [O.CFO], accessionNo: "d", acceptedAtET: "2026-03-04 10:00:00 ET" },
  ];
  const ev = purchaseEvents({ rows, issuerCik: "0000005000", from: "2026-03-01", to: "2026-12-31" });
  assert.deepEqual(ev.map((e) => [e.date, e.form4Price, e.openMarket, e.publishedAt]), [["2026-03-02", 5, true, "2026-03-03 10:00:00 ET"]]);
});

// ---------- daily (one-day) precision ----------
test("daily: same-day and consecutive-day purchases keep their exact dates and the fixed baseline", () => {
  const t = priceTimeline({ startDate: "2026-03-02", bars: ACME, today: "2026-11-02" });
  const ev = placeEvents([
    { date: "2026-03-02", insider: "A" }, { date: "2026-03-02", insider: "B" }, // same day
    { date: "2026-03-03", insider: "C" }, { date: "2026-03-04", insider: "D" }, // consecutive days
    { date: "2026-03-12", insider: "E" },                                        // later purchase
  ], t.series);
  assert.deepEqual(ev.map((e) => [e.date, e.priceDate, e.priceBasis]), [
    ["2026-03-02", "2026-03-02", "same_day"], ["2026-03-02", "2026-03-02", "same_day"],
    ["2026-03-03", "2026-03-03", "same_day"], ["2026-03-04", "2026-03-04", "same_day"], ["2026-03-12", "2026-03-12", "same_day"],
  ]);
  assert.deepEqual(ev.map((e) => e.pctAtEvent), [0, 0, 0, 0.1, 0.2].map((x) => +x.toFixed(6)));
  assert.equal(t.baseline.date, "2026-03-02", "later purchases never move the baseline");
  assert.equal(t.series[1].date, "2026-03-03", "daily resolution — no weekly aggregation");
});

test("daily: weekend and holiday purchases keep their own date and are compared with the last earlier close", () => {
  const t = priceTimeline({ startDate: "2026-03-02", bars: ACME, today: "2026-11-02" });
  const ev = placeEvents([
    { date: "2026-03-07" },  // Saturday
    { date: "2026-04-03" },  // Good Friday (NYSE closed)
    { date: "2026-07-03" },  // Independence Day observed
  ], t.series);
  assert.deepEqual(ev.map((e) => [e.date, e.priceDate, e.priceBasis]), [
    ["2026-03-07", "2026-03-06", "non_trading_day"], ["2026-04-03", "2026-04-02", "non_trading_day"], ["2026-07-03", "2026-07-02", "non_trading_day"],
  ]);
  assert.ok(!t.series.some((p) => ["2026-03-07", "2026-04-03", "2026-07-03"].includes(p.date)), "no invented bars on closed days");
  assert.deepEqual(t.missingSessions, [], "weekends/holidays are not 'missing'");
});

test("daily: a trading session without a price bar is listed and the purchase is labelled, never filled in", () => {
  const gap = ACME.filter((b) => b.date !== "2026-03-10");
  const t = priceTimeline({ startDate: "2026-03-02", bars: gap, today: "2026-11-02" });
  assert.deepEqual(t.missingSessions, ["2026-03-10"]);
  assert.ok(t.flags.includes("missing_sessions"));
  assert.ok(!t.series.some((p) => p.date === "2026-03-10"));
  const [e] = placeEvents([{ date: "2026-03-10" }], t.series);
  assert.deepEqual([e.date, e.priceDate, e.priceBasis], ["2026-03-10", "2026-03-09", "missing_bar"]);
});

// ---------- simple headline: split-adjusted first-purchase close → latest close ----------
test("start price = actual close on the first purchase date (dividends do not change it); end = latest close", () => {
  // Vendor adjClose is lower before a dividend; the split-adjusted start price is the real close.
  const bars = barsFor("2026-06-29", "2026-10-30", (d) => (d < "2026-09-17" ? { open: 17.82, close: 17.82, adjClose: 17.6477 } : { open: 15.88, close: 15.88, adjClose: 15.88 }))
    .map((b) => ({ ...b, splitFactor: 1 }));
  const t = priceTimeline({ startDate: "2026-06-29", bars, today: "2026-11-02" });
  assert.equal(t.adjustment, "split");
  assert.deepEqual([t.baseline.date, t.baseline.splitAdjClose, t.stats.lastDate, t.stats.lastClose], ["2026-06-29", 17.82, "2026-10-30", 15.88]);
  close(t.stats.changePct, 15.88 / 17.82 - 1, 1e-6);
});

test("2-for-1 split after the first purchase: start price is split-adjusted, change is continuous", () => {
  const bars = barsFor("2026-03-02", "2026-10-30", (d) => (d < "2026-06-01" ? { open: 40, close: 40 } : { open: 21, close: 21 }))
    .map((b) => ({ ...b, splitFactor: b.date === "2026-06-01" ? 2 : 1 }));
  const t = priceTimeline({ startDate: "2026-03-02", bars, today: "2026-11-02" });
  assert.deepEqual([t.baseline.close, t.baseline.splitAdjClose, t.stats.lastClose], [40, 20, 21]);
  close(t.stats.changePct, 0.05, 1e-9);
  assert.ok(t.stats.troughPct >= 0, "no fake −47 % drop on the split day");
  assert.deepEqual(t.corporateActions, [{ date: "2026-06-01", ratio: 2 }]);
});

test("without split factors the vendor's split+dividend-adjusted close is used — and labelled", () => {
  const t = priceTimeline({ startDate: "2026-03-02", bars: ACME, today: "2026-11-02" });
  assert.equal(t.adjustment, "split_and_dividend");
  close(t.stats.changePct, 0.3);
});
