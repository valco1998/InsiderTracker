// Owner profiles, track records and point-in-time buyer selection. SYNTHETIC data.
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { trackRecordFor, ownersList, ownerProfile, pointInTimeSelection, entityKind, RANK_MIN } from "./ownerProfile.js";
import { createBacktestRouter } from "../../routers/backtestRoutes.js";

// Minimal evaluated signal: close/tp results for 5 days, exit dates.
let n = 0;
function item({ owners, ticker = "AAA", issuerCik = "0000000001", entryDate, ret = 0.02, status = "ok", completeDays = 5, hitDay = null }) {
  const tp = Array.from({ length: 39 }, (_, i) => [1, 2, 3, 4, 5].map((H) => (completeDays >= H ? [ret, hitDay != null && hitDay <= H ? 1 : 0, hitDay, 0] : null)));
  const days = []; let d = new Date(`${entryDate}T00:00:00Z`);
  while (days.length < 5) { const s = d.toISOString().slice(0, 10); const wd = d.getUTCDay(); if (wd !== 0 && wd !== 6) days.push(s); d = new Date(d.getTime() + 86_400_000); }
  return {
    sig: { id: `s${++n}`, month: entryDate.slice(0, 7), ticker, issuerCik, issuerName: `${ticker} Inc`, buyerName: owners[0].name, legalOwners: owners, roles: ["Director"], purchaseTypes: ["open_market"], valueUsdAtSignal: 2e6, publishedAt: `${entryDate} 07:00:00 ET` },
    ev: { status, completeDays, entryDate, naReason: status === "na" ? "no_price_series" : null, closes: { 1: ret, 2: ret, 3: ret, 4: ret, 5: ret }, spy: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, tp, exitDates: Object.fromEntries(days.map((x, i) => [i + 1, x])) },
  };
}
const A = { cik: "0000000501", name: "Doe Jane" }, F = { cik: "0000000601", name: "Acme Capital LP" }, M = { cik: "0000000602", name: "Acme Capital GP LLC" };

test("one signal never makes a 'successful buyer': below the minimum sample it is not rankable", () => {
  const t = trackRecordFor([item({ owners: [A], entryDate: "2026-10-05", ret: 0.2 })]);
  assert.equal(t.matured, 1);
  assert.equal(t.rankEligible, false);
  assert.match(t.sampleNote, /Insufficient sample/);
  const many = Array.from({ length: RANK_MIN.signals }, (_, i) => item({ owners: [A], ticker: i % 2 ? "AAA" : "BBB", issuerCik: i % 2 ? "1" : "2", entryDate: `2026-0${i + 3}-02` }));
  assert.equal(trackRecordFor(many).rankEligible, true);
});

test("pending and unpriced signals are counted but never averaged", () => {
  const t = trackRecordFor([item({ owners: [A], entryDate: "2026-10-05" }), item({ owners: [A], entryDate: "2026-11-02", completeDays: 3 }), item({ owners: [A], entryDate: "2026-10-06", status: "na" })]);
  assert.equal(t.signals, 3);
  assert.equal(t.matured, 1);
  assert.equal(t.notPriced, 1);
  assert.equal(t.closes[5].n, 1);
  assert.equal(t.closes[3].n, 2);
});

test("a fund and its manager on one signal are one leaderboard row (no double counting)", () => {
  const items = [item({ owners: [F, M], entryDate: "2026-10-05" }), item({ owners: [F], ticker: "BBB", issuerCik: "2", entryDate: "2026-10-12" })];
  const rows = ownersList(items);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].signals, 2);
  assert.equal(ownersList(items, { q: "gp llc" })[0].signals, 2, "found by any member's name");
  assert.equal(ownersList(items, { ticker: "BBB" })[0].signals, 1);
});

test("point-in-time selection uses only earlier signals whose 5-day window had ended", () => {
  // Earlier signal entered Mon 10-05 → day 5 = Fri 10-09. A signal entering 10-08 cannot use it; one entering 10-12 can.
  const first = item({ owners: [A], entryDate: "2026-10-05", ret: 0.05 });
  const tooEarly = item({ owners: [A], ticker: "BBB", issuerCik: "2", entryDate: "2026-10-08", ret: -0.01 });
  const later = item({ owners: [A], ticker: "CCC", issuerCik: "3", entryDate: "2026-10-12", ret: 0.03 });
  const sel = pointInTimeSelection([later, tooEarly, first], { rule: { kind: "close", horizon: 5 } });
  const by = Object.fromEntries(sel.detail.map((d) => [d.ticker, d]));
  assert.equal(by.BBB.bucket, "noHistory");
  assert.equal(by.CCC.bucket, "selected");
  assert.equal(by.CCC.priorSignals, 1, "the 10-08 signal had not matured by 10-12 either (its day 5 = 10-14)");
  assert.equal(by.CCC.priorMean, 0.05);
  // An owner linked only through a LATER joint filing is not linked earlier.
  const other = item({ owners: [F], ticker: "DDD", issuerCik: "4", entryDate: "2026-10-19", ret: 0.01 });
  const joint = item({ owners: [F, A], ticker: "EEE", issuerCik: "5", entryDate: "2026-11-30", ret: 0.01 });
  const s2 = pointInTimeSelection([first, other, joint], { rule: { kind: "close", horizon: 5 } });
  assert.equal(s2.detail.find((d) => d.ticker === "DDD").bucket, "noHistory");
});

test("profile: purchases, sales, roles over time and last holding per issuer from the stored rows", () => {
  const raw = [
    { code: "P", issuerCik: "0000000001", ticker: "AAA", issuerName: "AAA Inc", owners: [{ cik: A.cik, name: A.name, role: "Director" }], transactionDate: "2026-03-02", acceptedAtET: "2026-03-03 17:00:00 ET", shares: 100, price: 10, value: 1000, sharesOwnedAfter: 500, ownership: "D", accessionNo: "a1" },
    { code: "S", issuerCik: "0000000001", ticker: "AAA", issuerName: "AAA Inc", owners: [{ cik: A.cik, name: A.name, role: "CEO" }], transactionDate: "2026-06-02", acceptedAtET: "2026-06-03 17:00:00 ET", shares: 50, price: 12, value: 600, sharesOwnedAfter: 450, ownership: "D", accessionNo: "a2" },
    { code: "P", issuerCik: "0000000009", ticker: "ZZZ", issuerName: "ZZZ Inc", owners: [{ cik: "0000000777", name: "Someone Else" }], transactionDate: "2026-06-02", acceptedAtET: "2026-06-03 17:00:00 ET", shares: 1, price: 1, value: 1, accessionNo: "z" },
  ];
  const p = ownerProfile({ cik: "501", rawRows: raw, items: [item({ owners: [A], entryDate: "2026-10-05" })] });
  assert.equal(p.cik, "0000000501");
  assert.equal(p.issuers.length, 1);
  const iss = p.issuers[0];
  assert.deepEqual([iss.purchases.count, iss.sales.count, iss.lastHolding.sharesOwnedAfter], [1, 1, 450]);
  assert.deepEqual(iss.roles.map((r) => r.role), ["Director", "CEO"]);
  assert.equal(p.transactionsTotal, 2);
  assert.equal(p.trackRecord.signals, 1);
  assert.equal(ownerProfile({ cik: "999", rawRows: raw, items: [] }), null);
  assert.equal(entityKind("Acme Capital LP"), "entity");
  assert.equal(entityKind("Doe Jane"), "person");
  assert.equal(entityKind("Charles A Williams TR Charles A Williams Trust"), "trust");
});

test("API: CIK validation and the price-data licence guard on owner endpoints", async () => {
  const profile = { cik: "0000000501", names: ["Doe Jane"], trackRecord: { signals: 1, matured: 1, closes: { 5: { mean: 0.1 } }, tp4: {}, tp65: {}, strategy: { mean: 0.1 }, signalsList: [{ id: "x", closes: { 1: 0.1 }, tp4: {}, tp65: {} }] }, groupTrackRecord: null };
  const service = { status: () => ({}), ownerProfile: async (c) => (Number(c) === 501 ? profile : null), owners: async () => ({ owners: [] }), normalizeStudy: () => ({ error: "months must be a list" }) };
  const app = express(); app.use(express.json());
  app.use("/bt", createBacktestRouter({ service, log: { log() {}, error() {} } }));
  const srv = app.listen(0);
  try {
    const base = `http://127.0.0.1:${srv.address().port}/bt`;
    assert.equal((await fetch(`${base}/owner/12ab`)).status, 400);
    assert.equal((await fetch(`${base}/owner/99999999999`)).status, 400);
    assert.equal((await fetch(`${base}/owner/42`)).status, 404);
    const local = await (await fetch(`${base}/owner/501`)).json();
    assert.equal(local.trackRecord.strategy.mean, 0.1, "loopback request sees returns");
    const proxied = await (await fetch(`${base}/owner/501`, { headers: { "X-Forwarded-For": "203.0.113.9" } })).json();
    assert.equal(proxied.trackRecord.status, "price_data_restricted");
    assert.equal(proxied.trackRecord.strategy, undefined);
    assert.equal(proxied.trackRecord.signalsList[0].closes, undefined);
    assert.equal((await fetch(`${base}/owners?from=2026-1-1`)).status, 400);
    const bad = await fetch(`${base}/monthly-study`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(bad.status, 400);
  } finally { srv.close(); }
});
