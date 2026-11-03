// IPO-allocation classification: prospectus parsing, owner-name matching, the
// verified / possible / none / unknown levels (never decided by price alone), SEC
// lookups through an injected fetcher (no network), caching.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseOffering, ownerNameKeys, classifyPurchase, createIpoContextService, htmlToText } from "./ipoContext.js";

// Excerpts in the shape of the REAL ASPE 424B4 (0001193125-26-441782).
const ASPE_424B4 = "<p>We are offering 9,375,000 shares of our common stock. The initial public offering price is $15.00 per share . Prior to this offering, there has been no public market for our common stock.</p>"
  + "<p>To the extent certain of our existing stockholders and their affiliated entities participate in this offering, such purchases would reduce the non-affiliate public float.</p>"
  + "<p>We have raised approximately $347 million from a syndicate of leading life sciences investors and organizations, including OrbiMed, ARCH Venture Partners, Frazier Life Sciences.</p>";
const NAMED_424B4 = ASPE_424B4 + "<p>Certain of our existing stockholders, including entities affiliated with ARCH Venture Partners, have indicated an interest in purchasing up to $20.0 million of shares of our common stock in this offering at the initial public offering price.</p>";
const FOLLOW_ON = "<p>We are offering 5,000,000 shares. The public offering price is $22.50 per share. Our common stock is listed on Nasdaq under the symbol XYZ.</p>";
const ARCH_XIV = { cik: "0002138046", name: "ARCH Venture Fund XIV, L.P." };
const offeringOf = (html, filingDate = "2026-10-30") => ({ form: "424B4", accessionNo: "0001193125-26-441782", filingDate, ...parseOffering(htmlToText(html)) });
const row = (o = {}) => ({ id: "r1", transactionDate: "2026-11-02", price: 15, value: 18_000_000, owners: [ARCH_XIV], footnotes: [], remarks: null, purchaseContextEvidence: null, ...o });

test("prospectus parsing: IPO vs follow-on, offering price, participation sentences", () => {
  const ipo = parseOffering(htmlToText(ASPE_424B4));
  assert.deepEqual([ipo.isIpo, ipo.offeringPrice], [true, 15]);
  assert.equal(parseOffering(htmlToText(NAMED_424B4)).participation.length, 1);
  const fo = parseOffering(htmlToText(FOLLOW_ON));
  assert.deepEqual([fo.isIpo, fo.offeringPrice], [false, 22.5], "a follow-on is not an IPO");
  assert.equal(htmlToText("&#x201c;ASPE&#x201d; &amp; Co"), "“ASPE” & Co");
});

test("owner name keys: fund suffixes stripped, person names both orders, nothing too short", () => {
  assert.ok(ownerNameKeys("ARCH Venture Fund XIV, L.P.").includes("arch venture"));
  assert.ok(ownerNameKeys("CRANDELL KEITH").includes("keith crandell"));
  assert.deepEqual(ownerNameKeys("ABC LP"), [], "never a single short token");
});

test("ASPE: prospectus + closing window + exact offering price, but no explicit statement → POSSIBLE (unverified)", () => {
  const c = classifyPurchase(row(), offeringOf(ASPE_424B4));
  assert.equal(c.level, "possible");
  assert.match(c.evidence.join(" "), /initial public offering at \$15\.00/);
  assert.match(c.missing.join(" "), /neither the Form 4 nor the prospectus states/);
});

test("VERIFIED only with an explicit statement: the prospectus names the buyer, or the Form 4 says IPO", () => {
  assert.equal(classifyPurchase(row(), offeringOf(NAMED_424B4)).level, "verified");
  const fn = row({ footnotes: [{ id: "F1", text: "Shares purchased in the Issuer's initial public offering at the public offering price." }] });
  assert.equal(classifyPurchase(fn, offeringOf(ASPE_424B4)).level, "verified");
  // A different buyer is NOT verified by a prospectus sentence naming someone else.
  assert.equal(classifyPurchase(row({ owners: [{ cik: "1", name: "Unrelated Capital Partners LP" }] }), offeringOf(NAMED_424B4)).level, "possible");
});

test("never by price alone: no IPO prospectus, a follow-on, another price, or outside the window → none", () => {
  assert.equal(classifyPurchase(row(), null).level, "none", "price $15 alone proves nothing");
  assert.equal(classifyPurchase(row(), offeringOf(FOLLOW_ON)).level, "none", "follow-on prospectus is not an IPO (isIpo false → not passed in practice)");
  assert.equal(classifyPurchase(row({ price: 14.7 }), offeringOf(ASPE_424B4)).level, "none", "open-market price after listing");
  assert.equal(classifyPurchase(row({ transactionDate: "2026-11-20" }), offeringOf(ASPE_424B4)).level, "none", "weeks after the IPO");
  // A Form 4 that itself says IPO, without a matching prospectus, is only 'possible'.
  const fn = row({ footnotes: [{ id: "F1", text: "Purchased in the IPO." }] });
  assert.equal(classifyPurchase(fn, null).level, "possible");
});

test("service: SEC submissions → IPO prospectus → classification; cached; failures are 'unknown'", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ipo-ctx-"));
  const calls = [];
  const SUBMISSIONS = JSON.stringify({ filings: { recent: {
    form: ["4", "8-K", "424B4", "S-1"], accessionNumber: ["a", "b", "0001193125-26-441782", "d"], filingDate: ["2026-11-02", "2026-11-02", "2026-10-30", "2026-10-09"], primaryDocument: ["x.xml", "y.htm", "elevation_424b4.htm", "s1.htm"],
  } } });
  const getText = async (url) => { calls.push(url); if (url.includes("submissions")) return SUBMISSIONS; if (url.endsWith("elevation_424b4.htm")) return ASPE_424B4; throw new Error("unexpected " + url); };
  const svc = createIpoContextService({ getText, cacheFile: path.join(dir, "c.json"), now: () => Date.parse("2026-11-03T12:00:00Z"), log: { warn() {} } });
  const items = [{ id: "s1", issuerCik: "0002124080", rows: [row(), row({ id: "r2", price: 15, value: 999_990, owners: [{ cik: "0001757011", name: "ARCH Venture Fund X, L.P." }] })] }];
  const out = await svc.classify(items);
  assert.equal(out.s1.status, "possible");
  assert.deepEqual([out.s1.offering.offeringPrice, out.s1.offering.filingDate, out.s1.flaggedPurchases, out.s1.flaggedValueUsd], [15, "2026-10-30", 2, 18_999_990]);
  assert.match(out.s1.offering.url, /Archives\/edgar\/data\/2124080\/000119312526441782\/elevation_424b4\.htm$/);
  assert.equal(calls.length, 2);
  await svc.classify(items);
  assert.equal(calls.length, 2, "submissions (24 h) and prospectus (permanent) are cached");
  const failing = createIpoContextService({ getText: async () => { throw new Error("HTTP 503"); }, cacheFile: path.join(dir, "f.json"), log: { warn() {} } });
  assert.equal((await failing.classify(items)).s1.status, "unknown");
  const noRows = await svc.classify([{ id: "s2", issuerCik: "1", rows: [] }]);
  assert.equal(noRows.s2.status, "none");
  fs.rmSync(dir, { recursive: true, force: true });
});

// Engine wiring: classification receives exactly the purchases behind each signal —
// rows public at its publication time, never later ones in the same window.
import { createBacktestService } from "./backtestEngine.js";
import { OWNERS as O, tx, barsFor, fakeProvider } from "./testFixtures.js";

test("engine.ipoContext: only the signal's own purchases (point-in-time), never later rows", async () => {
  const ROWS = [
    tx({ owners: [O.CEO], date: "2026-03-02", accepted: "2026-03-03 17:00:00" }),
    tx({ owners: [O.CFO], date: "2026-03-04", accepted: "2026-03-05 10:15:00" }), // completes the signal
    tx({ owners: [O.DIR], date: "2026-03-04", accepted: "2026-03-09 09:00:00" }), // same window, public LATER
  ];
  const seen = [];
  const ipo = { classify: async (items) => { seen.push(...items); return Object.fromEntries(items.map((it) => [it.id, { status: "none", purchases: [] }])); } };
  const bars = barsFor("2026-01-02", "2026-04-30", (d, i) => ({ open: 40 + i * 0.01, close: 40 + i * 0.01 }));
  const service = createBacktestService({ ipo, loadStore: () => ({ sig: "x", records: new Map(), days: new Map() }), live: () => ({ transactions: ROWS, amendmentFilings: [], coverage: [], noIndexDays: [], dataVersion: 1 }),
    getProvider: () => ({ ...fakeProvider({ SPY: bars, ACME: bars }), licence: "internal" }), now: () => Date.parse("2026-04-30T20:00:00Z") });
  const result = await service.run(service.normalize({ from: "2026-01-01", to: "2026-04-30" }).config);
  const out = await service.ipoContext({ result });
  assert.equal(result.signals.length, 1);
  const s = result.signals[0];
  assert.equal(seen.length, 1);
  assert.equal(seen[0].rows.length, s.purchases, "classified rows = the signal's purchases");
  assert.deepEqual(seen[0].rows.map((r) => r.insiderName).sort(), ["Alpha Ann", "Beta Bob"], "the director's later filing is excluded");
  assert.equal(out.signals[s.id].status, "none");
});
