// Companies screener — unique buyer counting, value/buyer filters, date basis
// and boundaries, sorting, amendments, duplicates, open-market filter, cluster
// indicator, coverage and the HTTP route. Rows are SYNTHETIC (no SEC data implied).
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { indexIssuers, parseScreenerQuery, screenCompanies, createScreener, easternStamp } from "./companyScreener.js";
import { buildSnapshot } from "./insiderSnapshot.js";
import { companiesHandler } from "../../routers/insiderRoutes.js";

const NOW = Date.parse("2026-11-02T15:00:00Z"); // Monday 10:00 ET
const CEO = { cik: "111", name: "Doe Jane", role: "Chief Executive Officer", isOfficer: true, isDirector: true };
const CFO = { cik: "222", name: "Roe Rick", role: "Chief Financial Officer", isOfficer: true };
const DIR = { cik: "333", name: "Poe Pat", role: "Director", isDirector: true };
const DIR2 = { cik: "334", name: "Moe Max", role: "Director", isDirector: true };
const FUND = { cik: "444", name: "Big Fund LP", role: "10% Owner", isTenPercentOwner: true };
const FUND_GP = { cik: "555", name: "Big Fund GP LLC", role: "10% Owner", isTenPercentOwner: true };

let seq = 0;
function row({ code = "P", date, filed = date, owners, value = 1000, shares = 10, superseded = false, anomaly = false, issuerCik = "1000", ticker = "ACME", name = "Acme Corp", context = "open_market", accepted = null }) {
  const acc = `0000000000-26-${String(++seq).padStart(6, "0")}`;
  return {
    id: `${acc}:0`, accessionNo: acc, issuerCik, ticker, issuerName: name, code,
    transactionDate: date, filingDate: filed, acceptedAtET: accepted || `${filed} 16:00:00 ET`, shares, value, price: value == null ? null : value / shares,
    purchaseContext: code === "P" ? context : null,
    owners, insiderName: owners[0].name, insiderCik: owners[0].cik, role: owners.map((o) => o.role).join("; "),
    filingUrl: `https://www.sec.gov/Archives/edgar/data/${issuerCik}/${acc.replace(/-/g, "")}/${acc}-index.htm`,
    ...(superseded ? { amendment: { status: "superseded" } } : {}),
    priceCheck: { status: anomaly ? "anomaly" : value == null ? "missing_price" : "ok" },
  };
}
const fullCoverage = (from, to) => {
  const out = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    out.push({ day: new Date(t).toISOString().slice(0, 10), listed: 1, parsed: 1, failed: 0, pending: 0, retrying: 0 });
  }
  return out;
};
const INGEST = { lastPollAt: new Date(NOW - 20_000).toISOString(), pollIntervalMs: 60_000, coverage: fullCoverage("2026-07-01", "2026-11-02"), noIndexDays: [], recovery: { latestExpectedDay: "2026-11-02" } };
const screen = (rows, query = {}, ingest = INGEST) => screenCompanies({ issuers: indexIssuers(rows), query, ingest, now: NOW });
const tickers = (r) => r.companies.map((c) => c.ticker);

test("unique buyers are people by CIK: one CEO buying 10 times = 1 buyer, 10 transactions", () => {
  const rows = Array.from({ length: 10 }, (_, i) => row({ date: `2026-10-${String(10 + i).padStart(2, "0")}`, owners: [CEO], value: 100 * (i + 1) }));
  const r = screen(rows);
  assert.equal(r.total, 1);
  const c = r.companies[0];
  assert.equal(c.uniqueBuyers, 1);
  assert.equal(c.purchaseTransactions, 10);
  assert.equal(c.purchaseValue, 5500);
  assert.equal(c.latestPurchaseDate, "2026-10-19");
  assert.deepEqual(c.roles.map((x) => x.role), ["CEO", "Director"]);
});

test("joint filers count once; amendments and anomalies are handled; sales are never subtracted", () => {
  const rows = [
    row({ date: "2026-10-20", owners: [FUND, FUND_GP], value: 50_000 }),     // joint filing: ONE buyer
    row({ date: "2026-10-22", owners: [FUND_GP], value: 10_000 }),           // GP alone later: same person
    row({ date: "2026-10-21", owners: [CFO], value: 999_999, superseded: true }), // superseded by 4/A: excluded entirely
    row({ date: "2026-10-21", owners: [CFO], value: 9_000 }),               // the amendment's row
    row({ date: "2026-10-23", owners: [DIR], value: 1e12, anomaly: true }),   // counted, value excluded
    row({ code: "S", date: "2026-10-24", owners: [CEO], value: 5_000_000 }),  // a sale — separate
  ];
  const c = screen(rows).companies[0];
  assert.equal(c.uniqueBuyers, 3, "fund+GP, CFO, director");
  assert.equal(c.purchaseTransactions, 4);
  assert.equal(c.purchaseValue, 69_000, "no superseded value, no anomaly value, sales not subtracted");
  assert.equal(c.purchaseValueMissing, 1);
  assert.equal(c.uniqueSellers, 1);
  assert.equal(c.saleValue, 5_000_000);
});

test("confirmed duplicate reports by related filers are one economic row (real snapshot pipeline)", () => {
  const base = { issuerCik: "1000", ticker: "ACME", issuerName: "Acme Corp", code: "P", type: "Purchase", securityTitle: "Common Stock", shares: 100, price: 10, value: 1000,
    transactionDate: "2026-10-20", filingDate: "2026-10-21", sharesOwnedAfter: 5000, purchaseContext: "open_market", footnotes: [], remarks: null };
  const a = { ...base, id: "0000000001-26-000001:0", accessionNo: "0000000001-26-000001", acceptedAtET: "2026-10-21 16:00:00 ET", ownership: "D",
    insiderName: "Big Fund LP", insiderCik: "444", owners: [FUND, FUND_GP] };
  const b = { ...base, id: "0000000002-26-000002:0", accessionNo: "0000000002-26-000002", acceptedAtET: "2026-10-21 16:05:00 ET", ownership: "I",
    natureOfOwnership: "By Big Fund LP", insiderName: "Big Fund GP LLC", insiderCik: "555", owners: [FUND_GP] };
  const snap = buildSnapshot({ transactions: [a, b], amendmentFilings: [], now: NOW });
  assert.equal(snap.economic.length, 1, "pipeline merged the duplicate report");
  const c = screen(snap.economic).companies[0];
  assert.equal(c.purchaseTransactions, 1);
  assert.equal(c.purchaseValue, 1000);
  assert.equal(c.uniqueBuyers, 1);
  assert.equal(c.latestFilingDate, "2026-10-21");
});

test("min buyers + min value work together; max value; search", () => {
  const rows = [
    // BIG: 3 buyers, $1.5M
    row({ date: "2026-10-20", owners: [CEO], value: 500_000 }), row({ date: "2026-10-21", owners: [CFO], value: 500_000 }), row({ date: "2026-10-22", owners: [DIR], value: 500_000 }),
    // TWO: 2 buyers, $2M
    row({ issuerCik: "2000", ticker: "TWO", name: "Two Inc", date: "2026-10-20", owners: [CEO], value: 1_000_000 }),
    row({ issuerCik: "2000", ticker: "TWO", name: "Two Inc", date: "2026-10-21", owners: [CFO], value: 1_000_000 }),
    // SML: 3 buyers, $30k
    ...[CEO, CFO, DIR].map((o) => row({ issuerCik: "3000", ticker: "SML", name: "Small Co", date: "2026-10-25", owners: [o], value: 10_000 })),
  ];
  assert.deepEqual(tickers(screen(rows, { minBuyers: "3", minValue: "1000000" })), ["ACME"]);
  assert.deepEqual(tickers(screen(rows, { minBuyers: "3" })).sort(), ["ACME", "SML"]);
  assert.deepEqual(tickers(screen(rows, { minValue: "10000", maxValue: "1600000" })).sort(), ["ACME", "SML"]);
  assert.deepEqual(tickers(screen(rows, { q: "two" })), ["TWO"]);
  assert.equal(screen(rows, { minBuyers: "10" }).total, 0);
});

test("sorting: buyers, value, recent, transactions (desc and asc)", () => {
  const rows = [
    row({ date: "2026-10-20", owners: [CEO], value: 100 }), row({ date: "2026-10-20", owners: [CFO], value: 100 }),
    row({ issuerCik: "2000", ticker: "BBB", date: "2026-10-28", owners: [CEO], value: 9_000 }),
    ...[1, 2, 3].map((d) => row({ issuerCik: "3000", ticker: "CCC", date: `2026-10-1${d}`, owners: [DIR], value: 1_000 })),
  ];
  assert.deepEqual(tickers(screen(rows, { sort: "buyers" })), ["ACME", "BBB", "CCC"], "ties on buyers → higher value first");
  assert.deepEqual(tickers(screen(rows, { sort: "value" })), ["BBB", "CCC", "ACME"]);
  assert.deepEqual(tickers(screen(rows, { sort: "recent" })), ["BBB", "ACME", "CCC"]);
  assert.deepEqual(tickers(screen(rows, { sort: "transactions" })), ["CCC", "ACME", "BBB"]);
  assert.deepEqual(tickers(screen(rows, { sort: "value", dir: "asc" })), ["ACME", "CCC", "BBB"]);
});

test("date basis and boundaries: trade date vs SEC filing date, inclusive edges, 24h", () => {
  const rows = [
    row({ date: "2026-10-04", filed: "2026-10-06", owners: [CEO] }),                // 30d trade edge (Oct 4 .. Nov 2)
    row({ issuerCik: "2000", ticker: "OLD", date: "2026-10-03", filed: "2026-11-01", owners: [CFO], accepted: "2026-11-01 09:59:00 ET" }), // 24h + 1 min ago // trade outside, filed inside
    row({ issuerCik: "3000", ticker: "NEW", date: "2026-11-01", filed: "2026-11-02", owners: [DIR], accepted: "2026-11-02 08:00:00 ET" }),
  ];
  assert.deepEqual(tickers(screen(rows, { period: "30d" })).sort(), ["ACME", "NEW"]);
  assert.deepEqual(tickers(screen(rows, { period: "30d", basis: "filingDate" })).sort(), ["ACME", "NEW", "OLD"]);
  const w = screen(rows, { period: "30d" }).window;
  assert.deepEqual([w.from, w.to, w.days, w.basis], ["2026-10-04", "2026-11-02", 30, "transactionDate"]);
  // 24h: trade basis = today or the previous calendar day (ET); filing basis = acceptance time.
  assert.deepEqual(tickers(screen(rows, { period: "1d" })), ["NEW"]);
  assert.deepEqual(tickers(screen(rows, { period: "1d", basis: "filingDate" })), ["NEW"]);
  assert.equal(easternStamp(NOW), "2026-11-02 10:00:00");
  // custom range (inclusive)
  assert.deepEqual(tickers(screen(rows, { from: "2026-10-03", to: "2026-10-04" })).sort(), ["ACME", "OLD"]);
  assert.deepEqual(tickers(screen(rows, { period: "7d" })), ["NEW"]);
});

test("open-market only restricts to purchases described as open-market; code P alone is not assumed open-market", () => {
  const rows = [
    row({ date: "2026-10-20", owners: [CEO], context: "open_market", value: 1000 }),
    row({ date: "2026-10-21", owners: [CFO], context: "offering_or_private", value: 9000 }),
    row({ issuerCik: "2000", ticker: "PRV", date: "2026-10-21", owners: [DIR], context: "unspecified" }),
  ];
  const all = screen(rows);
  assert.equal(all.total, 2);
  const om = screen(rows, { openMarket: "1" });
  assert.deepEqual(tickers(om), ["ACME"]);
  assert.equal(om.companies[0].uniqueBuyers, 1);
  assert.equal(om.companies[0].purchaseValue, 1000);
  assert.equal(all.companies.find((c) => c.ticker === "ACME").openMarketPurchases, 1);
});

test("cluster indicator: 3+ distinct buyers within 30 trade days overlapping the window; cluster-only filter", () => {
  const rows = [
    row({ date: "2026-10-01", owners: [CEO] }), row({ date: "2026-10-15", owners: [CFO] }), row({ date: "2026-10-29", owners: [DIR] }), // 29 days apart → cluster
    row({ issuerCik: "2000", ticker: "SPR", date: "2026-08-01", owners: [CEO] }), row({ issuerCik: "2000", ticker: "SPR", date: "2026-09-15", owners: [CFO] }),
    row({ issuerCik: "2000", ticker: "SPR", date: "2026-10-30", owners: [DIR] }), // spread out → no cluster
    row({ issuerCik: "3000", ticker: "JNT", date: "2026-10-20", owners: [FUND, FUND_GP] }), row({ issuerCik: "3000", ticker: "JNT", date: "2026-10-21", owners: [FUND_GP] }),
    row({ issuerCik: "3000", ticker: "JNT", date: "2026-10-22", owners: [DIR2] }), // joint filers are one person → only 2 buyers
  ];
  const r = screen(rows, { period: "90d" });
  const acme = r.companies.find((c) => c.ticker === "ACME");
  assert.deepEqual(acme.cluster, { from: "2026-10-01", to: "2026-10-29", peakBuyers: 3, distinctBuyers: 3 });
  assert.equal(r.companies.find((c) => c.ticker === "SPR").cluster, null);
  assert.equal(r.companies.find((c) => c.ticker === "JNT").cluster, null);
  assert.deepEqual(tickers(screen(rows, { period: "90d", cluster: "1" })), ["ACME"]);
});

test("partial SEC coverage is reported, never silently complete", () => {
  const rows = [row({ date: "2026-10-28", owners: [CEO] })];
  assert.equal(screen(rows, { period: "30d" }).coverage.complete, true);
  const partial = { ...INGEST, coverage: fullCoverage("2026-10-19", "2026-11-02") };
  const r = screen(rows, { period: "30d" }, partial);
  assert.equal(r.coverage.complete, false);
  assert.equal(r.coverage.coveredFrom, "2026-10-19");
  assert.ok(r.coverage.missingDays.includes("2026-10-05"));
  assert.match(r.coverage.note, /Partial data/);
  assert.equal(screen(rows, { period: "7d" }, partial).coverage.complete, true, "a 7-day window inside loaded days is complete");
  const stale = { ...partial, lastPollAt: new Date(NOW - 3_600_000).toISOString(), recovery: { latestExpectedDay: "2026-10-30" } };
  assert.equal(screen(rows, { period: "7d" }, stale).coverage.complete, false, "live tail without a recent poll is partial");
});

test("validation and paging", () => {
  for (const q of [{ basis: "x" }, { period: "2d" }, { minBuyers: "0" }, { minBuyers: "1.5" }, { minValue: "-1" }, { minValue: "abc" },
    { minValue: "10", maxValue: "5" }, { sort: "net" }, { limit: "0" }, { limit: "501" }, { offset: "-1" }, { from: "2026-13-01" }, { from: "2025-01-01", to: "2026-11-01" }]) {
    assert.ok(parseScreenerQuery(q, NOW).error, JSON.stringify(q));
  }
  const rows = Array.from({ length: 5 }, (_, i) => row({ issuerCik: String(5000 + i), ticker: `T${i}`, date: "2026-10-20", owners: [CEO], value: 1000 * (i + 1) }));
  const p = screen(rows, { sort: "value", limit: "2", offset: "2" });
  assert.equal(p.total, 5);
  assert.deepEqual(tickers(p), ["T2", "T1"]);
  assert.equal(p.totals.purchaseValue, 15_000);
});

test("route: GET /companies validates, caches the issuer index per snapshot version", async () => {
  const rows = [row({ date: "2026-10-20", owners: [CEO], value: 1000 })];
  let builds = 0;
  const base = createScreener();
  const issuersOf = (snap) => { const before = base.lastVersion; const r = base(snap); if (before !== snap.version) builds++; base.lastVersion = snap.version; return r; };
  const app = express();
  app.get("/companies", companiesHandler({ snapshot: () => ({ version: 7, economic: rows }), ingestStatus: () => INGEST, issuersOf, now: () => NOW }));
  const srv = app.listen(0);
  try {
    const url = `http://127.0.0.1:${srv.address().port}/companies`;
    const ok = await (await fetch(`${url}?minBuyers=1&period=30d`)).json();
    assert.equal(ok.total, 1);
    assert.equal(ok.snapshotVersion, 7);
    assert.equal(ok.window.basis, "transactionDate");
    await fetch(url);
    assert.equal(builds, 1);
    const bad = await fetch(`${url}?sort=net`);
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error, /sort must be/);
  } finally { srv.close(); }
});

test("screener buyer counts: actual numbers (1, 2, 3, 5), 'min buyers' means AT LEAST, joint filers once", () => {
  const P = Array.from({ length: 5 }, (_, i) => ({ cik: String(900 + i), name: `Person ${i}`, role: "Director", isDirector: true }));
  const co = (cik, ticker, n) => P.slice(0, n).map((o) => row({ issuerCik: cik, ticker, name: `${ticker} Inc`, date: "2026-10-20", owners: [o], value: 200_000 }));
  const rows = [...co("5001", "ONE", 1), ...co("5002", "TWO", 2), ...co("5003", "THR", 3), ...co("5005", "FIV", 5),
    row({ issuerCik: "5005", ticker: "FIV", name: "FIV Inc", date: "2026-10-21", owners: [FUND, FUND_GP], value: 200_000 })]; // joint filing → +1 buyer
  const all = screen(rows, { minBuyers: "1" });
  const byT = Object.fromEntries(all.companies.map((c) => [c.ticker, c.uniqueBuyers]));
  assert.deepEqual(byT, { ONE: 1, TWO: 2, THR: 3, FIV: 6 }, "actual counts, never capped");
  assert.deepEqual(tickers(screen(rows, { minBuyers: "2" })).sort(), ["FIV", "THR", "TWO"], "≥ 2 includes 2, 3 and 6");
  assert.deepEqual(tickers(screen(rows, { minBuyers: "3" })).sort(), ["FIV", "THR"]);
  assert.deepEqual(tickers(screen(rows, { minBuyers: "6" })), ["FIV"]);
});

// ── Evidence Grid fields (additive) ──────────────────────────────────────────
test("evidence fields: publication times, legal filers, avg price, activity strip, repeat, cluster type, quality", () => {
  const rows = [
    row({ date: "2026-10-28", owners: [CEO], value: 10_000, shares: 1000, accepted: "2026-10-29 17:05:00 ET" }),
    row({ date: "2026-10-28", owners: [CFO], value: 20_000, shares: 1000, accepted: "2026-10-29 18:10:00 ET" }),
    row({ date: "2026-10-29", owners: [DIR], value: 30_000, shares: 1000, accepted: "2026-10-30 09:00:00 ET" }),
    row({ date: "2026-10-30", owners: [CEO], value: 5_000, shares: 500, accepted: "2026-11-02 08:00:00 ET" }),
  ];
  const c = screen(rows).companies[0];
  assert.equal(c.firstAcceptedAt, "2026-10-29 17:05:00");
  assert.equal(c.latestAcceptedAt, "2026-11-02 08:00:00");
  assert.equal(c.filings, 4);
  assert.equal(c.legalFilers, 3);
  assert.equal(c.avgPrice, Math.round((65_000 / 3_500) * 1e4) / 1e4);
  assert.equal(c.activity.days.length, 30);
  assert.equal(c.activity.days.reduce((a, b) => a + b, 0), 4);
  assert.equal(c.activity.repeat, true, "the CEO bought on two dates");
  assert.equal(c.clusterType, "B", "3 buyers within 2 days (Oct 28–29)");
  assert.equal(c.quality.status, "verified");
  assert.equal(c.buyersList.length, 3);
  // Existing fields unchanged.
  assert.equal(c.uniqueBuyers, 3);
  assert.equal(c.purchaseTransactions, 4);
});

test("cluster types: A = 2 same day, C = 5 within 7 days, none for a single buyer", () => {
  const people = [CEO, CFO, DIR, DIR2, FUND];
  const a = screen([row({ date: "2026-10-20", owners: [CEO] }), row({ date: "2026-10-20", owners: [DIR] })]).companies[0];
  assert.equal(a.clusterType, "A");
  const cRows = people.map((p, i) => row({ date: `2026-10-${20 + i}`, owners: [p] }));
  assert.equal(screen(cRows).companies[0].clusterType, "C");
  assert.equal(screen([row({ date: "2026-10-20", owners: [CEO] })]).companies[0].clusterType, null);
});

test("quality: offering → uncertain; anomaly / superseded → warning with reasons", () => {
  const off = screen([row({ date: "2026-10-20", owners: [CEO], context: "offering_or_private" })]).companies[0];
  assert.equal(off.quality.status, "uncertain");
  assert.ok(off.quality.flags.some((f) => f.code === "offering"));
  const w = screen([row({ date: "2026-10-20", owners: [CEO] }), row({ date: "2026-10-21", owners: [DIR], anomaly: true }), row({ date: "2026-10-21", owners: [DIR2] }), row({ date: "2026-10-22", owners: [CFO], superseded: true })]).companies[0];
  assert.equal(w.quality.status, "warning");
  assert.deepEqual(w.quality.flags.map((f) => f.code).sort(), ["priceAnomaly", "superseded"]);
});

test("new filters: roles, ptype, conf, clusterType, repeat, pub — and new sorts", () => {
  const rows = [
    row({ ticker: "AAA", issuerCik: "1", date: "2026-10-20", owners: [CEO], accepted: "2026-10-21 10:00:00 ET" }),
    row({ ticker: "AAA", issuerCik: "1", date: "2026-10-20", owners: [DIR], accepted: "2026-10-21 10:05:00 ET" }),
    row({ ticker: "BBB", issuerCik: "2", date: "2026-10-30", owners: [DIR2], accepted: "2026-11-02 09:00:00 ET", context: "offering_or_private" }),
    row({ ticker: "CCC", issuerCik: "3", date: "2026-10-25", owners: [CFO], accepted: "2026-10-26 12:00:00 ET", context: null }),
  ];
  assert.deepEqual(tickers(screen(rows, { roles: "CEO" })), ["AAA"]);
  assert.deepEqual(tickers(screen(rows, { roles: "CFO,CEO", sort: "recent" })).sort(), ["AAA", "CCC"]);
  assert.deepEqual(tickers(screen(rows, { ptype: "verified" })), ["AAA"], "verified = stated open-market only");
  assert.deepEqual(tickers(screen(rows, { ptype: "likely" })).sort(), ["AAA", "CCC"], "likely excludes offerings");
  assert.deepEqual(tickers(screen(rows, { conf: "hide_uncertain" })).sort(), ["AAA", "CCC"]);
  assert.deepEqual(tickers(screen(rows, { clusterType: "A" })), ["AAA"]);
  assert.deepEqual(tickers(screen(rows, { pub: "72h" })), ["BBB"], "published within 72h of Nov 2 10:00 ET");
  assert.equal(tickers(screen(rows, { sort: "published" }))[0], "BBB");
  // openMarket=1 keeps its old meaning.
  assert.deepEqual(tickers(screen(rows, { openMarket: "1" })), ["AAA"]);
  assert.equal(screen(rows, { roles: "CEO" }).filters.roles[0], "CEO");
  for (const bad of [{ roles: "King" }, { ptype: "x" }, { conf: "x" }, { clusterType: "D" }, { pub: "1y" }, { sort: "x" }]) assert.ok(screen(rows, bad).error, JSON.stringify(bad));
});

test("totals: buyers, legal filers, clusters, quality counts", () => {
  const rows = [row({ ticker: "AAA", issuerCik: "1", date: "2026-10-20", owners: [CEO] }), row({ ticker: "AAA", issuerCik: "1", date: "2026-10-20", owners: [DIR] }), row({ ticker: "BBB", issuerCik: "2", date: "2026-10-20", owners: [CFO], context: "offering_or_private" })];
  const t = screen(rows).totals;
  assert.equal(t.uniqueBuyers, 3);
  assert.equal(t.clusterTypes.A, 1);
  assert.deepEqual(t.quality, { verified: 1, warning: 0, uncertain: 1 });
});

test("companyEvidence: counted rows with accessions, superseded rows as excluded, 404 / 400", async () => {
  const { companyEvidence } = await import("./companyScreener.js");
  const rows = [row({ date: "2026-10-20", owners: [CEO] }), row({ date: "2026-10-21", owners: [DIR], superseded: true })];
  const issuers = indexIssuers(rows);
  const e = companyEvidence({ issuers, cik: "1000", query: {}, now: NOW });
  assert.equal(e.counted.length, 1);
  assert.match(e.counted[0].accessionNo, /^0000000000-26-/);
  assert.equal(e.excluded.filter((x) => x.kind === "superseded").length, 1);
  assert.equal(companyEvidence({ issuers, cik: "999999", query: {}, now: NOW }).notFound, true);
  assert.ok(companyEvidence({ issuers, cik: "abc", query: {}, now: NOW }).error);
});
