// Forward returns: entry timing, session horizons, adjusted prices (splits), costs,
// benchmark/excess, pending windows, delisted / missing prices, filters, drawdown,
// equity curve, and the no-price-data state. SYNTHETIC bars.
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateSignals, planWithoutPrices, maxDrawdown, cleanBars, median } from "./returns.js";
import { sessionsBetween } from "./sessionCalendar.js";
import { barsFor, fakeProvider } from "./testFixtures.js";

const S = sessionsBetween("2026-01-02", "2026-12-31");
const SPY = barsFor("2026-01-02", "2026-12-31", (d, i) => ({ open: 100 + i, close: 100.5 + i }));
const ACME = barsFor("2026-01-02", "2026-12-31", (d, i) => ({ open: 20 + i, close: 20.5 + i }));
const sig = (publishedAt, ticker = "ACME") => ({ id: `x:${publishedAt}`, issuerCik: "0000005000", ticker, publishedAt, publishedDate: publishedAt.slice(0, 10) });
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);
const run = (signals, series = { SPY, ACME }, config = {}) => evaluateSignals({ signals, provider: fakeProvider(series), benchmarkSymbol: "SPY", config });

test("entry at the next session open after an after-hours filing; horizons in sessions; benchmark and excess", async () => {
  const { results } = await run([sig("2026-03-05 21:45:10 ET")]);
  const r = results[0];
  const e = S.indexOf("2026-03-06");
  assert.equal(r.entryDate, "2026-03-06");
  close(r.entryPrice, 20 + e);
  const h7 = r.horizons["7d"];
  assert.equal(h7.exitDate, S[e + 4], "5 sessions incl. the entry session");
  close(h7.net, (20.5 + e + 4) / (20 + e) - 1);
  close(h7.benchmark, (100.5 + e + 4) / (100 + e) - 1);
  close(h7.excess, h7.net - h7.benchmark);
  assert.equal(r.horizons["30d"].exitDate, S[e + 20]);
  assert.equal(r.horizons["180d"].exitDate, S[e + 125]);
  assert.ok(r.drawdown <= 0);
});

test("commission and slippage per side", async () => {
  const { results } = await run([sig("2026-03-05 08:00:00 ET")], undefined, { commissionBps: 10, slippageBps: 5 });
  const e = S.indexOf("2026-03-05"), c = 0.0015;
  assert.equal(results[0].entryDate, "2026-03-05", "pre-market filing → same-day open");
  close(results[0].horizons["7d"].net, ((20.5 + e + 4) * (1 - c)) / ((20 + e) * (1 + c)) - 1);
  close(results[0].horizons["7d"].gross, (20.5 + e + 4) / (20 + e) - 1);
});

test("splits: returns use adjusted prices (a 2-for-1 split is not a −50 % loss)", async () => {
  const splitAt = S.indexOf("2026-03-10");
  const SPLIT = barsFor("2026-01-02", "2026-12-31", (d, i) => (i < splitAt ? { open: 40, close: 40, adjClose: 20 } : { open: 20, close: 20, adjClose: 20 }));
  const { results } = await run([sig("2026-03-05 21:00:00 ET", "SPLT")], { SPY, SPLT: SPLIT });
  close(results[0].entryPrice, 20);
  close(results[0].horizons["7d"].net, 0);
});

test("incomplete forward windows are pending, never estimated", async () => {
  const { results, stats } = await run([sig("2026-12-10 18:00:00 ET")]);
  const r = results[0];
  assert.equal(r.horizons["7d"].status, "complete");
  assert.equal(r.horizons["30d"].status, "pending");
  assert.equal(r.horizons["180d"].status, "pending");
  assert.equal(stats.byHorizon["30d"].pending, 1);
  assert.equal(stats.byHorizon["30d"].n, 0);
  const late = await run([sig("2026-12-31 18:00:00 ET")]);
  assert.equal(late.results[0].status, "pending");
  assert.equal(late.results[0].reason, "entry_after_price_data");
});

test("delisted / data ended: excluded by default, or valued at the last close when chosen", async () => {
  const DELI = ACME.filter((b) => b.date <= "2026-03-20");
  const ex = await run([sig("2026-03-05 21:00:00 ET", "DELI")], { SPY, DELI });
  assert.equal(ex.results[0].horizons["7d"].status, "complete");
  assert.deepEqual([ex.results[0].horizons["30d"].status, ex.results[0].horizons["30d"].reason], ["excluded", "delisted_or_data_ended"]);
  assert.deepEqual(ex.stats.byHorizon["30d"].excluded, { delisted_or_data_ended: 1 });
  const lc = await run([sig("2026-03-05 21:00:00 ET", "DELI")], { SPY, DELI }, { delistingPolicy: "last_close" });
  assert.equal(lc.results[0].horizons["30d"].status, "complete");
  assert.equal(lc.results[0].horizons["30d"].flag, "valued_at_last_close");
  assert.equal(lc.results[0].horizons["30d"].exitPriceDate, "2026-03-20");
});

test("missing prices: no entry bar, no symbol, gap at exit, invalid bars", async () => {
  const GAP = ACME.filter((b) => b.date !== "2026-03-06");
  const a = await run([sig("2026-03-05 21:00:00 ET", "GAP")], { SPY, GAP });
  assert.deepEqual([a.results[0].status, a.results[0].reason], ["excluded", "no_entry_price"]);
  const b = await run([sig("2026-03-05 21:00:00 ET", "NOPE")]);
  assert.deepEqual([b.results[0].status, b.results[0].reason], ["excluded", "no_price_symbol"]);
  const e = S.indexOf("2026-03-06");
  const HOLE = ACME.filter((x) => x.date !== S[e + 4]);
  const c = await run([sig("2026-03-05 21:00:00 ET", "HOLE")], { SPY, HOLE });
  assert.equal(c.results[0].horizons["7d"].flag, "stale_exit_price", "uses the previous session's close, flagged");
  const { bars, flags } = cleanBars([{ date: "2026-01-02", open: 1, close: 1, adjClose: null }, { date: "2026-01-05", open: 0, close: 1, adjClose: 1 }, { date: "2026-01-06", open: 1, close: 1, adjClose: 1 }]);
  assert.equal(bars.length, 1);
  assert.equal(flags.dropped, 2);
});

test("prior-decline and market-cap filters use only prices known at disclosure", async () => {
  const FALL = barsFor("2026-01-02", "2026-12-31", (d, i) => ({ open: 100 - i * 0.3, close: 100 - i * 0.3, marketCap: 5e8 }));
  const f = await run([sig("2026-06-01 21:00:00 ET", "FALL")], { SPY, FALL }, { minPriorDecline: 0.1, priorLookbackSessions: 63 });
  assert.equal(f.results[0].status, "evaluated");
  assert.ok(f.results[0].priorReturn < -0.1);
  const strict = await run([sig("2026-06-01 21:00:00 ET", "FALL")], { SPY, FALL }, { minPriorDecline: 0.5 });
  assert.deepEqual([strict.results[0].status, strict.results[0].reason], ["filtered", "prior_decline"]);
  const mc = await run([sig("2026-06-01 21:00:00 ET", "FALL")], { SPY, FALL }, { maxMarketCap: 1e8 });
  assert.equal(mc.results[0].reason, "market_cap");
  const noMc = await run([sig("2026-06-01 21:00:00 ET")], undefined, { minMarketCap: 1e6 });
  assert.equal(noMc.results[0].reason, "filter_data_missing:market_cap", "never guessed");
});

test("statistics, drawdown and the equal-weight equity curve", async () => {
  const signals = [sig("2026-03-05 21:00:00 ET"), sig("2026-04-01 08:00:00 ET")];
  const { stats, equity } = await run(signals, undefined, { equityHorizon: "7d" });
  const h = stats.byHorizon["7d"];
  assert.equal(h.n, 2);
  assert.equal(h.winRate, 1);
  assert.ok(h.mean > 0 && h.median > 0 && h.excessMean !== null);
  assert.equal(equity.positions, 2);
  assert.equal(equity.horizon, "7d");
  assert.ok(equity.points.length > 10);
  assert.ok(equity.totalReturn > 0);
  assert.equal(maxDrawdown([1, 1.2, 0.9, 1.3, 1.04]), 0.9 / 1.2 - 1);
  assert.equal(median([3, 1, 2, 10]), 2.5);
});

test("no price provider: planned entries only, no performance numbers", () => {
  const [p] = planWithoutPrices([sig("2026-01-16 18:00:00 ET")]);
  assert.equal(p.status, "price_data_required");
  assert.equal(p.entryDate, "2026-01-20");
  assert.equal(p.entryPrice, null);
  assert.deepEqual(p.horizons, {});
});
