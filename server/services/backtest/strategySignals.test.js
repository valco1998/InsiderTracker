// User-configurable strategy rules (signals.js) — SYNTHETIC data only.
// Default purchase: 3,000 shares × $50 = $150,000.
import { test } from "node:test";
import assert from "node:assert/strict";
import { OWNERS as O, tx, signalsFor } from "./testFixtures.js";
import { normalizeSignalConfig, DEFAULTS } from "./signals.js";

const sig = (r) => r.signals.map((s) => ({ id: s.id, clusterId: s.clusterId, publishedAt: s.publishedAt, buyers: s.uniqueBuyers, purchases: s.purchases, value: s.valueUsd, snapshot: s.snapshot }));

test("one insider buying 10 times = 1 buyer, 10 purchases, the combined value of all 10", () => {
  const rows = Array.from({ length: 10 }, (_, i) => tx({ owners: [O.CEO], date: `2026-03-${String(2 + i).padStart(2, "0")}`, accepted: "2026-03-13 17:00:00", shares: 1000 + i }));
  const r = signalsFor(rows, { config: { minBuyers: 1, minValueUsd: 0 } });
  assert.equal(r.signals.length, 1);
  const s = r.signals[0];
  assert.deepEqual([s.uniqueBuyers, s.purchases], [1, 10]);
  assert.equal(s.valueUsd, rows.reduce((a, x) => a + x.value, 0));
  assert.equal(s.snapshot.purchases.length, 10, "every transaction kept separately in the snapshot");
  assert.equal(s.buyers[0].transactions, 10);
  // The same 10 purchases never satisfy a 2-buyer strategy.
  assert.equal(signalsFor(rows, { config: { minBuyers: 2, minValueUsd: 0 } }).signals.length, 0);
});

test("multiple independent insiders aggregate at company level; any buyer count is accepted (1, 3, 100)", () => {
  const people = [O.CEO, O.CFO, O.COO, O.VP, O.DIR];
  const rows = people.map((o, i) => tx({ owners: [o], date: "2026-03-02", accepted: `2026-03-03 1${i}:00:00` }));
  const s3 = signalsFor(rows, { config: { minBuyers: 3, minValueUsd: 450_000 } }).signals;
  assert.equal(s3.length, 1);
  assert.equal(s3[0].publishedAt, "2026-03-03 12:00:00 ET", "dated at the filing that made the 3rd buyer public");
  assert.deepEqual([s3[0].uniqueBuyers, s3[0].purchases, s3[0].valueUsd], [3, 3, 450_000]);
  assert.equal(signalsFor(rows, { config: { minBuyers: 6 } }).signals.length, 0, "5 buyers never satisfy 6");
  assert.equal(normalizeSignalConfig({ minBuyers: 100 }).config.minBuyers, 100);
  assert.equal(normalizeSignalConfig({ minBuyers: 1 }).config.minBuyers, 1);
  assert.equal(normalizeSignalConfig({ windowDays: 730 }).config.windowDays, 730);
  assert.ok(normalizeSignalConfig({ minBuyers: 0 }).error);
  assert.ok(normalizeSignalConfig({ minBuyers: 2.5 }).error);
});

test("joint filers and related reporting entities are one buyer; the duplicate report counts once", () => {
  const a = tx({ owners: [O.FUND, O.FUND_GP], date: "2026-03-02", accepted: "2026-03-03 17:00:00", shares: 2600, sharesOwnedAfter: 5000 });
  const b = tx({ owners: [O.FUND_GP], date: "2026-03-02", accepted: "2026-03-03 17:05:00", shares: 2600, ownership: "I", nature: "By Big Fund LP", sharesOwnedAfter: 5000 });
  const ceo = tx({ owners: [O.CEO], date: "2026-03-03", accepted: "2026-03-04 17:00:00" });
  const s = signalsFor([a, b, ceo], { config: { minBuyers: 2, minValueUsd: 0 } }).signals[0];
  assert.equal(s.uniqueBuyers, 2, "fund + GP + duplicate = one buyer, plus the CEO");
  assert.equal(s.purchases, 2, "the duplicate report is not a second purchase");
  assert.equal(s.valueUsd, 130_000 + 150_000);
});

test("rolling-window boundaries are exact for any user window", () => {
  const pair = (gap) => {
    const d2 = new Date(Date.parse("2026-03-02T00:00:00Z") + gap * 86_400_000).toISOString().slice(0, 10);
    return [tx({ owners: [O.CEO], date: "2026-03-02", accepted: "2026-03-02 17:00:00" }), tx({ owners: [O.CFO], date: d2, accepted: `${d2} 18:00:00` })];
  };
  for (const w of [1, 5, 45, 90]) {
    assert.equal(signalsFor(pair(w - 1), { config: { windowDays: w } }).signals.length, 1, `${w}-day window includes day ${w - 1}`);
    assert.equal(signalsFor(pair(w), { config: { windowDays: w } }).signals.length, 0, `${w}-day window excludes day ${w}`);
  }
});

test("late SEC filings count by default; the optional filing-delay filter excludes only when enabled", () => {
  assert.equal(DEFAULTS.maxFilingDelayDays, null);
  assert.equal(DEFAULTS.maxSignalLagDays, null);
  const rows = [
    tx({ owners: [O.CEO], date: "2026-03-02", accepted: "2026-03-03 17:00:00" }),            // 1 day
    tx({ owners: [O.CFO], date: "2026-03-03", accepted: "2026-05-20 17:00:00" }),            // 78 days late
  ];
  const off = signalsFor(rows).signals;
  assert.equal(off.length, 1, "late filing included by default");
  assert.equal(off[0].publishedAt, "2026-05-20 17:00:00 ET", "dated when the late filing became public, never the trade date");
  assert.equal(off[0].snapshot.purchases.find((p) => p.name === "Beta Bob").filingDelayDays, 78);
  const on = signalsFor(rows, { config: { maxFilingDelayDays: 30 } });
  assert.equal(on.signals.length, 0, "excluded only with the filter on");
  assert.equal(on.stats.purchasesOverFilingDelay, 1);
  assert.equal(signalsFor(rows, { config: { maxFilingDelayDays: 78 } }).signals.length, 1, "inclusive limit");
  assert.equal(normalizeSignalConfig({ maxFilingDelayDays: "" }).config.maxFilingDelayDays, null, "empty = off");
  assert.ok(normalizeSignalConfig({ maxFilingDelayDays: -1 }).error);
});

test("threshold crossing after a NEW filing: signal at that filing's acceptance; repeat buys by an existing insider never duplicate", () => {
  const rows = [
    tx({ owners: [O.CEO], date: "2026-03-02", accepted: "2026-03-03 17:00:00", shares: 1000 }), // $50K
    tx({ owners: [O.CFO], date: "2026-03-03", accepted: "2026-03-04 17:00:00", shares: 1000 }), // 2 buyers, $100K — not yet
    tx({ owners: [O.CEO], date: "2026-03-05", accepted: "2026-03-06 09:15:00", shares: 4000 }), // CEO again: $300K → crosses
    tx({ owners: [O.CEO], date: "2026-03-06", accepted: "2026-03-09 17:00:00", shares: 4000 }), // CEO again: no new signal
    tx({ owners: [O.CFO], date: "2026-03-09", accepted: "2026-03-10 17:00:00", shares: 4000 }), // CFO again: no new signal
  ];
  const r = signalsFor(rows, { config: { minBuyers: 2, minValueUsd: 250_000 } });
  assert.equal(r.signals.length, 1);
  const s = r.signals[0];
  assert.equal(s.publishedAt, "2026-03-06 09:15:00 ET");
  assert.deepEqual([s.uniqueBuyers, s.purchases, s.valueUsd], [2, 3, 300_000], "extra purchase raises count + value, not buyers");
  assert.equal(s.snapshot.asOf, "2026-03-06 09:15:00 ET");
  assert.equal(s.snapshot.purchases.length, 3);
  // Later purchases are subsequent events, kept separately (hindsight), never in the snapshot.
  assert.equal(s.hindsight.purchasesAdded, 2);
  assert.equal(s.hindsight.buyersAdded, 0);
  assert.deepEqual(s.hindsight.laterPurchases.map((p) => p.publicAt), ["2026-03-09 17:00:00 ET", "2026-03-10 17:00:00 ET"]);
});

test("NO LOOKAHEAD: later filings never modify an earlier signal or its snapshot", () => {
  const early = [
    tx({ owners: [O.CEO], date: "2026-03-02", accepted: "2026-03-03 17:00:00" }),
    tx({ owners: [O.CFO], date: "2026-03-03", accepted: "2026-03-04 17:00:00" }),
  ];
  const later = [
    tx({ owners: [O.COO], date: "2026-03-01", accepted: "2026-03-20 17:00:00", shares: 50_000 }), // trade BEFORE the signal, public after
    tx({ owners: [O.DIR], date: "2026-03-04", accepted: "2026-03-05 08:00:00" }),
  ];
  const strip = (r) => sig(r).map(({ snapshot, ...x }) => ({ ...x, snapshot: snapshot.purchases.map((p) => [p.rowId, p.valueUsd, p.publicAt]) }));
  const a = strip(signalsFor(early));
  const b = strip(signalsFor([...early, ...later]));
  assert.deepEqual(b.slice(0, 1), a, "the first signal is identical with or without the later filings");
  // Cutting the data at each signal's publication reproduces it exactly.
  const all = [...early, ...later];
  for (const s of signalsFor(all).signals) {
    const cut = signalsFor(all, { cutoff: s.publishedAt.replace(/ ET$/, "") }).signals.find((x) => x.id === s.id);
    assert.ok(cut, `signal ${s.id} reproducible from data public at its time`);
    assert.deepEqual([cut.uniqueBuyers, cut.purchases, cut.valueUsd], [s.uniqueBuyers, s.purchases, s.valueUsd]);
  }
});

test("repeated filings and reruns: identical deterministic ids and results", () => {
  const rows = [tx({ owners: [O.CEO], date: "2026-03-02", accepted: "2026-03-03 17:00:00" }), tx({ owners: [O.CFO], date: "2026-03-03", accepted: "2026-03-04 17:00:00" })];
  const a = signalsFor(rows), b = signalsFor(rows);
  assert.deepEqual(sig(a), sig(b));
  assert.equal(a.signals[0].id, "5000:2026-03-04 17:00:00");
  assert.equal(a.signals[0].clusterId, "5000:2026-03-02");
  // The same SEC filing loaded twice (e.g. live ingest + history) is one transaction.
  const dup = signalsFor([...rows, { ...rows[1] }]);
  assert.deepEqual([dup.signals[0].purchases, dup.signals[0].valueUsd], [2, 300_000]);
});

test("different user strategies produce different results from the same filings", () => {
  const rows = [
    tx({ owners: [O.CEO], date: "2026-03-02", accepted: "2026-03-03 17:00:00", shares: 20_000 }), // $1M alone
    tx({ owners: [O.CFO], date: "2026-03-20", accepted: "2026-03-21 17:00:00", shares: 1000 }),   // $50K, 18 days later
    tx({ owners: [O.DIR], date: "2026-03-22", accepted: "2026-03-23 17:00:00", shares: 1000 }),   // $50K
  ];
  const run = (c) => signalsFor(rows, { config: c }).signals.map((s) => `${s.publishedAt}|${s.uniqueBuyers}|${s.valueUsd}`);
  const one = run({ minBuyers: 1, minValueUsd: 500_000, windowDays: 30 });
  const two30 = run({ minBuyers: 2, minValueUsd: 250_000, windowDays: 30 });
  const two7 = run({ minBuyers: 2, minValueUsd: 250_000, windowDays: 7 });
  const three = run({ minBuyers: 3, minValueUsd: 0, windowDays: 30 });
  assert.deepEqual(one, ["2026-03-03 17:00:00 ET|1|1000000"]);
  assert.deepEqual(two30, ["2026-03-21 17:00:00 ET|2|1050000"]);
  assert.deepEqual(two7, [], "CFO+DIR inside 7 days only reach $100K");
  assert.deepEqual(three, ["2026-03-23 17:00:00 ET|3|1100000"]);
  assert.deepEqual(run({ minBuyers: 2, minValueUsd: 0, windowDays: 30, roles: ["CFO"] }), [], "role filter: one CFO only");
  assert.deepEqual(run({ minBuyers: 2, minValueUsd: 0, windowDays: 30, roles: ["Director"] }), ["2026-03-23 17:00:00 ET|2|1050000"], "CEO (also a director) + director");
  assert.deepEqual(run({ minBuyers: 2, minValueUsd: 0, windowDays: 30, roles: [] }), ["2026-03-21 17:00:00 ET|2|1050000"], "all roles");
});
