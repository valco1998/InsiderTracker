// Company insider intelligence — unique buyers, roles, amendments/duplicates,
// 30-day trade-date boundaries, cluster buying, coverage, symbol mapping.
// Rows are SYNTHETIC economic rows in the snapshot's shape (no SEC data implied).
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {
  ownerRoleGroups, rowRoleGroups, buildIdentities, countedRows, insiderActivity, detectClusters,
  windowCoverage, tradingViewSymbol, rowsForCompany, companyInsights, windowOf, easternToday,
} from "./insiderInsights.js";
import { queryTransactions } from "./insiderSnapshot.js";
import { CompanyLookupUnavailable } from "./companyTickers.js";

const NOW = Date.parse("2026-11-02T15:00:00Z"); // Monday 10:00 ET
const CEO = { cik: "0000000111", name: "Doe Jane", role: "Chief Executive Officer · Director", isOfficer: true, isDirector: true };
const CEO_ALT = { cik: "111", name: "DOE JANE M", role: "President and CEO", isOfficer: true }; // same CIK, other spelling
const CFO = { cik: "222", name: "Roe Rick", role: "Principal Financial Officer", isOfficer: true };
const DIR = { cik: "333", name: "Poe Pat", role: "Director", isDirector: true };
const FUND = { cik: "444", name: "Big Fund LP", role: "10% Owner", isTenPercentOwner: true };
const FUND_GP = { cik: "555", name: "Big Fund GP LLC", role: "10% Owner", isTenPercentOwner: true };
const VP = { cik: "666", name: "Vee Pee", role: "EVP Sales", isOfficer: true };
const NAMESAKE = { cik: "777", name: "Doe Jane", role: "Director", isDirector: true }; // same name, different person

let seq = 0;
function row({ code = "P", date, owners, value = 1000, shares = 10, superseded = false, anomaly = false, issuerCik = "1000", ticker = "ACME" }) {
  const acc = `0000000000-26-${String(++seq).padStart(6, "0")}`;
  return {
    id: `${acc}:0`, accessionNo: acc, issuerCik, ticker, issuerName: "Acme Corp", code,
    transactionDate: date, filingDate: date, shares, value, price: value == null ? null : value / shares,
    owners, insiderName: owners[0].name, insiderCik: owners[0].cik, role: owners.map((o) => o.role).join("; "),
    filingUrl: `https://www.sec.gov/Archives/edgar/data/1000/${acc.replace(/-/g, "")}/${acc}-index.htm`,
    ...(superseded ? { amendment: { status: "superseded" } } : {}),
    ...(anomaly ? { priceCheck: { status: "anomaly" } } : { priceCheck: { status: value == null ? "missing_price" : "ok" } }),
  };
}
const WIN = windowOf({ days: 30, to: "2026-11-02" }); // 2026-10-04 … 2026-11-02
const act = (rows, win = WIN) => insiderActivity(countedRows(rows), win, buildIdentities(countedRows(rows)));

test("roles: CEO/CFO from the filed title, flags for Director/Officer/10% Owner, multi-role, Other", () => {
  assert.deepEqual([...ownerRoleGroups(CEO)], ["CEO", "Director"]);
  assert.deepEqual([...ownerRoleGroups(CEO_ALT)], ["CEO"]);
  assert.deepEqual([...ownerRoleGroups(CFO)], ["CFO"]);
  assert.deepEqual([...ownerRoleGroups(VP)], ["Officer"]);
  assert.deepEqual([...ownerRoleGroups(FUND)], ["10% Owner"]);
  assert.deepEqual([...ownerRoleGroups({ role: "Not specified" })], ["Other"]);
  assert.deepEqual([...ownerRoleGroups({ role: "Director", isDirector: true, isTenPercentOwner: true })], ["Director", "10% Owner"]);
  assert.deepEqual([...ownerRoleGroups({ role: "Senior Director of Directing", isOfficer: true })], ["Officer"], "word 'Director' in a title is not the board flag");
  assert.deepEqual(rowRoleGroups(row({ date: "2026-10-20", owners: [FUND, VP] })), ["Officer", "10% Owner"]);
});

test("unique buyers: the same CEO buying 5 times = 1 buyer, 5 transactions; counted in BOTH CEO and Director", () => {
  const rows = [1, 2, 3, 4, 5].map((d) => row({ date: `2026-10-2${d}`, owners: [CEO], value: 1000 * d, shares: 10 * d }));
  const a = act(rows);
  assert.equal(a.uniqueBuyers, 1);
  assert.equal(a.purchaseTransactions, 5);
  assert.equal(a.purchaseValue, 15_000);
  assert.equal(a.purchaseShares, 150);
  assert.equal(a.firstPurchase, "2026-10-21");
  assert.equal(a.lastPurchase, "2026-10-25");
  assert.deepEqual(a.byRole.CEO, { buyers: 1, transactions: 5, value: 15_000 });
  assert.deepEqual(a.byRole.Director, { buyers: 1, transactions: 5, value: 15_000 });
  assert.equal(a.byRole.CFO.buyers, 0);
  assert.equal(a.buyers[0].name, "Doe Jane");
  assert.deepEqual(a.buyers[0].roles, ["CEO", "Director"]);
  assert.equal(a.buyers[0].filings.length, 5);
});

test("identity is the SEC CIK, not the name: name variants merge, namesakes stay separate", () => {
  const a = act([row({ date: "2026-10-20", owners: [CEO] }), row({ date: "2026-10-21", owners: [CEO_ALT] }), row({ date: "2026-10-22", owners: [NAMESAKE] })]);
  assert.equal(a.uniqueBuyers, 2, "CIK 0000000111 == 111; namesake CIK 777 is another person");
  assert.equal(a.purchaseTransactions, 3);
});

test("joint filers (fund + its GP on one Form 4) are ONE buyer, also when the GP later files alone", () => {
  const a = act([row({ date: "2026-10-20", owners: [FUND, FUND_GP] }), row({ date: "2026-10-27", owners: [FUND_GP] })]);
  assert.equal(a.uniqueBuyers, 1);
  assert.equal(a.purchaseTransactions, 2);
  assert.deepEqual(a.buyers[0].ciks, ["444", "555"]);
});

test("amendments, duplicates, anomalies: superseded rows excluded; anomaly / no price counted but not valued", () => {
  const rows = [
    row({ date: "2026-10-20", owners: [CFO], value: 5000, superseded: true }), // replaced by the 4/A below
    row({ date: "2026-10-20", owners: [CFO], value: 4000 }),                    // the amendment's row
    row({ date: "2026-10-21", owners: [DIR], value: 9_999_999_999, anomaly: true }),
    row({ date: "2026-10-22", owners: [VP], value: null }),
  ];
  // A confirmed duplicate (two filers, one trade) arrives as ONE economic row with reportedBy[2].
  const dup = row({ date: "2026-10-23", owners: [FUND], value: 7000 });
  dup.reportedBy = [{ accessionNo: dup.accessionNo, filingUrl: dup.filingUrl, filingDate: dup.filingDate }, { accessionNo: "0000000000-26-999999", filingUrl: "https://www.sec.gov/x", filingDate: "2026-10-24" }];
  const a = act([...rows, dup]);
  assert.equal(a.purchaseTransactions, 4);
  assert.equal(a.purchaseValue, 11_000, "4,000 + 7,000 — superseded, anomalous and unpriced values excluded");
  assert.equal(a.purchaseValueMissing, 2);
  assert.equal(a.uniqueBuyers, 4);
  assert.equal(a.buyers.find((b) => b.ciks.includes("444")).filings.length, 2, "both original filings linked");
});

test("30-day window uses the TRADE date (inclusive), never the filing date", () => {
  const inside = row({ date: "2026-10-04", owners: [CEO] });
  const outside = row({ date: "2026-10-03", owners: [CFO] });
  outside.filingDate = "2026-10-06"; // filed inside the window — still excluded
  const lateFiled = row({ date: "2026-10-30", owners: [DIR] });
  lateFiled.filingDate = "2026-11-02";
  assert.deepEqual([WIN.from, WIN.to, WIN.days], ["2026-10-04", "2026-11-02", 30]);
  const a = act([inside, outside, lateFiled]);
  assert.equal(a.uniqueBuyers, 2);
  assert.equal(a.firstPurchase, "2026-10-04");
  assert.equal(easternToday(Date.parse("2026-11-03T03:30:00Z")), "2026-11-02", "late evening ET is still the same ET day");
});

test("sellers are counted separately (unique people, code S)", () => {
  const a = act([row({ code: "S", date: "2026-10-20", owners: [CEO] }), row({ code: "S", date: "2026-10-21", owners: [CEO] }), row({ code: "S", date: "2026-10-22", owners: [CFO] }), row({ date: "2026-10-22", owners: [DIR] })]);
  assert.equal(a.uniqueSellers, 2);
  assert.equal(a.saleTransactions, 3);
  assert.equal(a.uniqueBuyers, 1);
});

test("cluster buying: >= threshold distinct buyers within a rolling 30-day window", () => {
  const ids = (rows) => buildIdentities(countedRows(rows));
  const three = [row({ date: "2026-09-01", owners: [CEO] }), row({ date: "2026-09-15", owners: [CFO] }), row({ date: "2026-09-30", owners: [DIR] })];
  let c = detectClusters(countedRows(three), { threshold: 3, identities: ids(three) });
  assert.equal(c.length, 1);
  assert.deepEqual([c[0].from, c[0].to, c[0].distinctBuyers, c[0].transactions, c[0].spanDays], ["2026-09-01", "2026-09-30", 3, 3, 30]);
  assert.deepEqual(c[0].roles.map((r) => r.role), ["CEO", "CFO", "Director"]);
  assert.ok(c[0].buyers.every((b) => b.filings[0].url.startsWith("https://www.sec.gov/")));

  const spread = [row({ date: "2026-09-01", owners: [CEO] }), row({ date: "2026-09-15", owners: [CFO] }), row({ date: "2026-10-01", owners: [DIR] })]; // 31 days
  assert.equal(detectClusters(countedRows(spread), { threshold: 3, identities: ids(spread) }).length, 0, "31-day span is outside the window");

  const oneBuyer = [1, 2, 3, 4, 5].map((d) => row({ date: `2026-09-0${d}`, owners: [CEO] }));
  assert.equal(detectClusters(countedRows(oneBuyer), { threshold: 3, identities: ids(oneBuyer) }).length, 0, "5 purchases by one person are not a cluster");

  const two = three.slice(0, 2);
  assert.equal(detectClusters(countedRows(two), { threshold: 3, identities: ids(two) }).length, 0);
  assert.equal(detectClusters(countedRows(two), { threshold: 2, identities: ids(two) }).length, 1, "threshold is configurable");

  const joint = [row({ date: "2026-09-01", owners: [FUND, FUND_GP] }), row({ date: "2026-09-02", owners: [FUND_GP] }), row({ date: "2026-09-03", owners: [CEO] })];
  assert.equal(detectClusters(countedRows(joint), { threshold: 3, identities: ids(joint) }).length, 0, "joint filers are one buyer");

  const superseded = [...three.slice(0, 2), row({ date: "2026-09-20", owners: [DIR], superseded: true })];
  assert.equal(detectClusters(countedRows(superseded), { threshold: 3, identities: ids(superseded) }).length, 0, "superseded purchases never form a cluster");

  // Overlapping qualifying windows merge into one cluster.
  const chain = [...three, row({ date: "2026-10-10", owners: [VP] })];
  c = detectClusters(countedRows(chain), { threshold: 3, identities: ids(chain) });
  assert.equal(c.length, 1);
  assert.deepEqual([c[0].from, c[0].to, c[0].distinctBuyers, c[0].peakBuyers], ["2026-09-01", "2026-10-10", 4, 3]);
});

test("coverage: complete only when every business day of the window is indexed; otherwise partial with real dates", () => {
  const win = windowOf({ days: 30, to: "2026-11-02" });
  const all = [];
  for (let t = Date.parse("2026-10-01T00:00:00Z"); t <= Date.parse("2026-10-30T00:00:00Z"); t += 86_400_000) {
    const d = new Date(t).toISOString().slice(0, 10);
    const wd = new Date(t).getUTCDay();
    if (wd !== 0 && wd !== 6) all.push({ day: d, listed: 5, parsed: 5, failed: 0, pending: 0 });
  }
  const full = windowCoverage(win, { coverage: all, latestIndexDay: "2026-10-30", livePollOk: true });
  assert.equal(full.complete, true);
  assert.deepEqual(full.liveFeedDays, { from: "2026-10-31", to: "2026-11-02", pollOk: true });
  // Columbus Day 2026-10-12 is NOT a SEC holiday; it is a business day here.
  const partial = windowCoverage(win, { coverage: all.filter((c) => c.day >= "2026-10-19"), latestIndexDay: "2026-10-30", livePollOk: true });
  assert.equal(partial.complete, false);
  assert.equal(partial.coveredFrom, "2026-10-19");
  assert.equal(partial.missingDays[0], "2026-10-05");
  assert.match(partial.note, /^Partial data: SEC filings are loaded only from 2026-10-19/);
  const failing = windowCoverage(win, { coverage: all.map((c) => (c.day === "2026-10-28" ? { ...c, failed: 1 } : c)), latestIndexDay: "2026-10-30", livePollOk: true });
  assert.deepEqual([failing.complete, failing.incompleteDays], [false, ["2026-10-28"]]);
  const noLive = windowCoverage(win, { coverage: all, latestIndexDay: "2026-10-30", livePollOk: false });
  assert.equal(noLive.complete, false, "days after the newest index rely on a healthy live feed");
  const closed = windowCoverage(win, { coverage: all.filter((c) => c.day !== "2026-10-15"), noIndexDays: ["2026-10-15"], latestIndexDay: "2026-10-30", livePollOk: true });
  assert.equal(closed.complete, true, "a day SEC published no index for is not a gap");
});

test("TradingView symbol mapping and unsupported securities", () => {
  assert.deepEqual(tradingViewSymbol({ ticker: "AAPL", exchange: "Nasdaq" }), { symbol: "NASDAQ:AAPL", supported: true, reason: null });
  assert.equal(tradingViewSymbol({ ticker: "BRK-B", exchange: "NYSE" }).symbol, "NYSE:BRK.B");
  assert.equal(tradingViewSymbol({ ticker: "ABCD", exchange: "OTC" }).symbol, "OTC:ABCD");
  assert.equal(tradingViewSymbol({ ticker: "TXA", exchange: "TXSE" }).supported, false);
  assert.equal(tradingViewSymbol({ ticker: "ZZZ", exchange: null }).supported, false);
  assert.equal(tradingViewSymbol(null).supported, false);
});

test("rowsForCompany: by issuer CIK when known (any filed ticker text), else by filed ticker incl. BRK.B / BRK-B", () => {
  const a = row({ date: "2026-10-20", owners: [CEO], issuerCik: "0000001000", ticker: "ACME" });
  const b = row({ date: "2026-10-20", owners: [CEO], issuerCik: "1000", ticker: null });
  const c = row({ date: "2026-10-20", owners: [CEO], issuerCik: "2000", ticker: "BRK.B" });
  c.tickerSymbols = ["BRK.A", "BRK.B"];
  assert.deepEqual(rowsForCompany([a, b, c], { cik: "1000" }), [a, b]);
  assert.deepEqual(rowsForCompany([a, b, c], { ticker: "BRK-B" }), [c]);
});

test("companyInsights: validation, windows, partial coverage flag, clusters marked active", () => {
  const rows = [row({ date: "2026-10-20", owners: [CEO] }), row({ date: "2026-10-22", owners: [CFO] }), row({ date: "2026-10-25", owners: [DIR] })];
  const ingest = { coverage: [{ day: "2026-10-30", listed: 1, parsed: 1, failed: 0, pending: 0 }], noIndexDays: [], recovery: { latestExpectedDay: "2026-10-30" }, lastPollAt: new Date(NOW - 30_000).toISOString(), pollIntervalMs: 60_000 };
  const r = companyInsights({ rows, company: { ticker: "ACME", exchange: "Nasdaq" }, ingest, now: NOW });
  assert.deepEqual([r.window.from, r.window.to, r.window.basis], ["2026-10-04", "2026-11-02", "transactionDate"]);
  assert.equal(r.activity.uniqueBuyers, 3);
  assert.equal(r.coverage.complete, false, "only one index day held → never presented as complete");
  assert.equal(r.clusters.list.length, 1);
  assert.equal(r.clusters.list[0].active, true);
  assert.equal(r.tradingView.symbol, "NASDAQ:ACME");
  assert.equal(companyInsights({ rows, query: { days: "7" }, ingest, now: NOW }).window.from, "2026-10-27");
  assert.equal(companyInsights({ rows, query: { from: "2026-10-01", to: "2026-12-31" }, ingest, now: NOW }).window.to, "2026-11-02", "future end clipped to today");
  assert.match(companyInsights({ rows, query: { days: "45" }, now: NOW }).error, /days must be/);
  assert.match(companyInsights({ rows, query: { threshold: "1" }, now: NOW }).error, /threshold/);
  assert.match(companyInsights({ rows, query: { from: "2026-10-10", to: "2026-10-01" }, now: NOW }).error, /from <= to/);
});

test("compact transaction rows carry roleGroups (additive) so clients filter with the same rules", () => {
  const r = row({ date: "2026-10-20", owners: [CEO, FUND] });
  const snap = { economic: [r], raw: [r], totalsAll: {}, compact: new WeakMap() };
  const out = queryTransactions(snap, { view: "compact" });
  assert.deepEqual(out.body.transactions[0].roleGroups, ["CEO", "Director", "10% Owner"]);
  assert.equal(out.body.transactions[0].owners, undefined);
});

test("route: /company/:ticker/insights — 400 invalid, 404 unknown, SEC list outage falls back to filed ticker; no market values invented", async () => {
  const { companyInsightsHandler } = await import("../../routers/insiderRoutes.js");
  const rows = [row({ date: "2026-10-20", owners: [CEO], issuerCik: "1000", ticker: "ACME" })];
  const snapshot = () => ({ version: 9, economic: rows });
  const ingestStatus = () => ({ coverage: [], noIndexDays: [], recovery: { latestExpectedDay: "2026-10-30" } });
  let mode = "ok";
  const lookupTicker = async (t) => {
    if (mode === "down") throw new CompanyLookupUnavailable("down");
    return t === "ACME" ? { cik: "0000001000", name: "Acme Corp", ticker: "ACME", exchange: "Nasdaq" } : null;
  };
  const app = express();
  app.get("/company/:ticker/insights", companyInsightsHandler({ lookupTicker, snapshot, ingestStatus }));
  const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}/company`;
  try {
    assert.equal((await fetch(`${base}/BAD!!/insights`)).status, 400);
    assert.equal((await fetch(`${base}/NOPE/insights`)).status, 404);
    const ok = await (await fetch(`${base}/acme/insights`)).json();
    assert.equal(ok.company.cik, "0000001000");
    assert.equal(ok.company.inSecCompanyList, true);
    assert.equal(ok.activity.purchaseTransactions, ok.window.from <= "2026-10-20" ? 1 : 0);
    assert.deepEqual(ok.market, { provider: null, available: false, reason: ok.market.reason, delayed: null });
    assert.match(ok.market.reason, /No licensed market-data provider/);
    assert.equal(ok.snapshotVersion, 9);
    mode = "down";
    const fb = await (await fetch(`${base}/ACME/insights`)).json();
    assert.equal(fb.company.inSecCompanyList, false);
    assert.match(fb.company.lookupError, /temporarily unavailable/);
    assert.equal(fb.company.cik, "0000001000", "issuer CIK taken from the filings");
    assert.equal((await fetch(`${base}/ACME/insights?days=45`)).status, 400);
  } finally { await new Promise((r) => server.close(r)); }
});
