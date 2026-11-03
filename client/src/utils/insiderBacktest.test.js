// node --test src/utils/insiderBacktest.test.js   (runs under Node, not the browser)
import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultForm, toRunRequest, pct, returnHistogram, dataStatus } from "./insiderBacktest.js";

const NOW = Date.parse("2026-11-02T15:00:00Z");

test("defaults match the strategy: 2 buyers, > $250,000 combined (USD), 30-day window, code P", () => {
  const { body } = toRunRequest(defaultForm(NOW));
  assert.equal(body.minBuyers, 2);
  assert.equal(body.minValueUsd, 250_000);
  assert.equal(body.minValueIls, undefined, "no ILS field is ever sent");
  assert.equal(body.windowDays, 30);
  assert.equal(body.from, "2023-11-03");
  assert.equal(body.to, "2026-11-02");
  assert.equal(body.minPriorDecline, undefined);
  assert.equal(body.minMarketCap, undefined);
});

test("unit conversion and validation", () => {
  const f = { ...defaultForm(NOW), priorDeclinePct: "20", minMarketCapM: "50", maxMarketCapM: "2000", roles: ["CEO"], commissionBps: "5" };
  const { body } = toRunRequest(f);
  assert.equal(body.minPriorDecline, 0.2);
  assert.equal(body.minMarketCap, 50e6);
  assert.equal(body.maxMarketCap, 2e9);
  assert.equal(body.commissionBps, 5);
  assert.deepEqual(body.roles, ["CEO"]);
  for (const bad of [{ from: "2026-05-01", to: "2026-01-01" }, { minBuyers: "0" }, { minBuyers: "2.5" }, { minValueUsd: "-1" }, { priorDeclinePct: "120" }, { minMarketCapM: "9", maxMarketCapM: "1" }]) {
    assert.ok(toRunRequest({ ...defaultForm(NOW), ...bad }).error, JSON.stringify(bad));
  }
});

test("formatting", () => {
  assert.equal(pct(0.1234), "+12.3 %");
  assert.equal(pct(-0.04), "−4.0 %");
  assert.equal(pct(null), "—");
  assert.equal(pct(-0.00001), "0.0 %");
});

test("return histogram uses only complete horizons; zero is a bin edge", () => {
  const s = (net, status = "complete") => ({ horizons: { "30d": { status, net } } });
  const bins = returnHistogram([s(-0.07), s(-0.01), s(0.02), s(0.12), s(0.5, "pending"), { horizons: {} }], "30d", 0.05);
  assert.deepEqual(bins.map((b) => [Math.round(b.from * 100), b.count]), [[-10, 1], [-5, 1], [0, 1], [5, 0], [10, 1]]);
  assert.deepEqual(returnHistogram([], "30d"), []);
});

test("data status keeps SEC coverage, missing prices and pending windows apart", () => {
  const r = { status: "complete", coverage: { complete: false, coveredDays: 10, businessDays: 46 }, signals: [
    { status: "evaluated", horizons: { "7d": { status: "complete" }, "30d": { status: "pending" } } },
    { status: "excluded", reason: "no_price_symbol", horizons: {} },
    { status: "pending", reason: "entry_after_price_data", horizons: {} },
  ] };
  assert.deepEqual(dataStatus(r), { secComplete: false, secCovered: "10/46 days", pricesAvailable: true, pricesMissing: 1, pendingWindows: 2 });
  assert.equal(dataStatus({ status: "price_data_required", coverage: { complete: true }, signals: [{}, {}] }).pricesMissing, 2);
});

// ---------- PRIMARY METRIC: SEC signal published → NOW ----------
import { elapsedText, publicationSummary, pubStatusText, pubStatusShort, SESSION_LABEL } from "./insiderBacktest.js";

test("elapsed time since SEC publication", () => {
  assert.equal(elapsedText(12 * 60_000), "12 min");
  assert.equal(elapsedText((5 * 60 + 12) * 60_000), "5 h 12 min");
  assert.equal(elapsedText((3 * 24 + 4) * 3_600_000), "3 d 4 h");
  assert.equal(elapsedText(NaN), "—");
});

test("summary per metric uses only signals with a result — no horizons, no 'pending', never 0 for missing", () => {
  const ok = (p) => ({ status: "ok", changePct: p });
  const rows = {
    a: { primary: ok(0.25), regular: ok(0.2) }, b: { primary: ok(-0.05), regular: { status: "awaiting_regular_session_trade" } },
    c: { primary: ok(0.01), regular: ok(0.03) }, d: { primary: { status: "awaiting_sip" }, regular: { status: "awaiting_sip" } }, e: { status: "no_ticker", primary: { status: "no_ticker" } },
  };
  const s = publicationSummary(rows);
  assert.deepEqual([s.withData, s.total, Math.round(s.average * 1e4) / 1e4, s.median, Math.round(s.positiveShare * 100) / 100], [3, 5, 0.07, 0.01, 0.67]);
  const r = publicationSummary(rows, "regular");
  assert.deepEqual([r.withData, Math.round(r.average * 1e4) / 1e4], [2, 0.115]);
  assert.equal(publicationSummary({}).average, null);
  assert.equal(publicationSummary(undefined).withData, 0);
  assert.match(pubStatusText("quota"), /^Price data unavailable/);
  assert.match(pubStatusText("something_new"), /^Price data unavailable$/);
  assert.match(pubStatusText("awaiting_sip"), /^Awaiting SIP data/);
  assert.equal(pubStatusShort("awaiting_sip"), "Awaiting SIP data");
  assert.equal(pubStatusShort("awaiting_regular_session"), "Awaiting regular-session trade");
  assert.equal(pubStatusShort("awaiting_regular_session_trade"), "Awaiting regular-session trade");
  assert.equal(pubStatusShort("no_latest_price"), "Price data unavailable");
  assert.deepEqual([SESSION_LABEL.pre, SESSION_LABEL.regular, SESSION_LABEL.post], ["Pre-market", "Regular market", "After-hours"]);
});

// ---------- presentation helpers ----------
import { publishedParts, etParts, freshness, preciseUsd, METRIC_HELP, buyersText, ipoLabel } from "./insiderBacktest.js";

test("readable dates/times in New York time; SEC wall time is not shifted", () => {
  assert.deepEqual(publishedParts("2026-10-19 07:11:41 ET"), { date: "Oct 19, 2026", short: "Oct 19", time: "7:11 AM ET" });
  assert.equal(publishedParts("2026-10-22 16:56:25 ET", { seconds: true }).time, "4:56:25 PM ET");
  assert.equal(publishedParts("2026-10-22 12:05:00 ET").time, "12:05 PM ET");
  assert.equal(publishedParts("2026-10-22 00:05:00 ET").time, "12:05 AM ET");
  assert.equal(publishedParts("bad").date, "—");
  assert.deepEqual(etParts("2026-10-22T20:57:20.378572251Z", { seconds: true }), { date: "Oct 22, 2026", time: "4:57:20 PM ET" });
  assert.equal(etParts("2026-11-02T14:30:00Z").time, "9:30 AM ET", "EST after the DST change");
  assert.equal(etParts(undefined).date, "—");
});

test("freshness with market session: closed / pre / post vs stale during regular hours — never 'live'", () => {
  const old = { status: "ok", ageMs: 13 * 3_600_000 };
  assert.deepEqual([freshness(old, "closed").level, freshness(old, "closed").label], ["closed", "Market closed · last trade 13 h 0 min ago"]);
  assert.equal(freshness(old, "pre").label, "Pre-market · last trade 13 h 0 min ago");
  assert.equal(freshness(old, "post").label, "After-hours · last trade 13 h 0 min ago");
  assert.deepEqual([freshness({ status: "ok", ageMs: 2 * 3_600_000 }, "regular").level, freshness({ status: "ok", ageMs: 2 * 3_600_000 }, "regular").label], ["old", "Stale · last trade 2 h 0 min ago"]);
  assert.equal(freshness({ status: "ok", ageMs: 60_000 }, "closed").level, "recent");
  for (const s of ["closed", "pre", "post", "regular", undefined]) assert.ok(!/\blive\b/i.test(freshness(old, s).label));
  assert.equal(buyersText(2, 3), "2 buyers · 3 purchases");
  assert.equal(buyersText(1, 1), "1 buyer · 1 purchase");
  assert.equal(ipoLabel({ status: "possible" }), "Possible IPO allocation");
  assert.equal(ipoLabel({ status: "verified" }), "IPO allocation");
  assert.equal(ipoLabel({ status: "none" }), null);
  assert.equal(ipoLabel({ status: "unknown" }), null);
});

test("freshness: recent vs old vs unavailable — never 'live'", () => {
  assert.equal(freshness({ status: "ok", ageMs: 5 * 60_000 }).level, "recent");
  const old = freshness({ status: "ok", ageMs: 649 * 60_000 });
  assert.deepEqual([old.level, old.label], ["old", "Last trade 10 h 49 min ago"]);
  assert.equal(freshness({ status: "unavailable" }).level, "unavailable");
  assert.equal(freshness(undefined).label, "Price unavailable");
  for (const f of [freshness({ status: "ok", ageMs: 1 }), old]) assert.ok(!/live/i.test(f.label));
  assert.equal(preciseUsd(47.075), "$47.075");
  assert.equal(preciseUsd(5.3), "$5.30");
  assert.match(METRIC_HELP.returnSinceSignal, /Includes pre-market and after-hours/);
});

import { horizonSummary, signalsByMonth, pubStatusShort as shortOf } from "./insiderBacktest.js";
test("horizon summary counts only matured signals; months group signals and priced ones", () => {
  const h = (o) => ({ primary: { status: "ok", horizons: o } });
  const rows = { a: h({ 5: { status: "ok", changePct: 0.1 } }), b: h({ 5: { status: "ok", changePct: -0.02 } }), c: h({ 5: { status: "immature" } }), d: { primary: { status: "awaiting_sip", horizons: { 5: { status: "no_entry" } } } } };
  const s = horizonSummary(rows, 5);
  assert.deepEqual([s.n, Math.round(s.average * 1000) / 1000, s.winRate, s.immature, s.unavailable], [2, 0.04, 0.5, 1, 1]);
  assert.equal(horizonSummary({}, 60).average, null);
  const m = signalsByMonth([{ id: "a", publishedDate: "2026-03-05" }, { id: "d", publishedDate: "2026-03-09" }, { id: "x", publishedDate: "2026-04-01" }], rows);
  assert.deepEqual(m, { "2026-03": { signals: 2, priced: 1 }, "2026-04": { signals: 1, priced: 0 } });
  assert.equal(shortOf("lookup_queued"), "Price lookup queued");
});
