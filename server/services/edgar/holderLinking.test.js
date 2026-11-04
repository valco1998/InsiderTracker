// Duplicate-report linking by the DIRECT HOLDER each filing names (transactionGroups.js) —
// genuine purchases are never merged; related filers reporting one holding are one transaction.
// SYNTHETIC rows modelled on real filings (KRRO / NEA 17, AVLN / SR One, KLRA / Bain).
import { test } from "node:test";
import assert from "node:assert/strict";
import { directHolders, groupTransactions, pairEvidence } from "./transactionGroups.js";
import { OWNERS as O, tx, signalsFor } from "../backtest/testFixtures.js";

const ISS = { issuerCik: "0001703647", ticker: "KRRO" };
const nea = (name, cik) => ({ cik, name, role: "10% Owner", isTenPercentOwner: true });
const MANAGER_FN = [{ id: "F2", text: 'The Reporting Person is a manager of NEA 17 GP, LLC, which is the sole general partner of NEA Partners 17, L.P. ("NEA Partners 17"). NEA Partners 17 is the sole general partner of New Enterprise Associates 17, L.P. ("NEA 17"), the direct beneficial owner of the securities.' }];
const FUND_FN = [{ id: "F2", text: 'The securities are directly held by New Enterprise Associates 17, L.P. ("NEA 17") and are indirectly held by NEA Partners 17, L.P.' }];
const managerRow = (owner, accepted, extra = {}) => tx({ ...ISS, owners: [owner], date: "2026-03-10", accepted, shares: 207_100, price: 11.11, sharesOwnedAfter: 1_297_893, ownership: "I", nature: "See Note 2", footnotes: MANAGER_FN, context: "offering_or_private", ...extra });

test("direct-holder extraction: explicit holder phrases only; vague or indirect wording yields nothing", () => {
  assert.deepEqual(directHolders({ footnotes: MANAGER_FN }), ["new enterprise associates 17 lp"]);
  assert.deepEqual(directHolders({ footnotes: FUND_FN }), ["new enterprise associates 17 lp"], "'indirectly held by' is not a direct holder");
  assert.deepEqual(directHolders({ footnotes: [{ text: 'Held by certain affiliated funds managed by RTW Investments, LP ("RTW").' }] }), []);
  assert.deepEqual(directHolders({ footnotes: [{ text: "Represents securities held directly by BCPE Perseus Investor, LP." }] }), ["bcpe perseus investor lp"]);
  assert.deepEqual(directHolders({ footnotes: [{ text: "Shares held of record by Sofinnova Venture Partners XI, L.P." }] }), ["sofinnova venture partners xi lp"]);
});

test("KRRO: seven managers' filings of the SAME NEA 17 purchase (seconds apart) are one transaction from the first filing on", () => {
  const managers = ["Florence Anthony", "Walker Paul", "Makhzoumi Mohamad", "Mathers Edward", "Baskett Forest", "Chang Carmen", "Yang Rick"];
  const rows = managers.map((n, i) => managerRow(nea(n, `00015${i}0000`), `2026-03-12 20:15:${String(3 + i).padStart(2, "0")}`));
  const ev = pairEvidence(rows[0], rows[1]);
  assert.equal(ev.confirmed, true, ev.missing.join("; "));
  assert.match(ev.evidence.join(" "), /new enterprise associates 17 lp/);
  assert.equal(groupTransactions(rows).length, 1, "7 reports → 1 economic transaction ($2.3M once)");
  // Point in time: with only the first TWO filings public, they are already one purchase.
  assert.equal(groupTransactions(rows.slice(0, 2)).length, 1);
  // Signal engine: one holding → never "3 buyers / 3× value" before the fund's own filing.
  const r = signalsFor(rows, { config: { minBuyers: 2, minValueUsd: 0 } });
  assert.equal(r.signals.length, 0, "one economic buyer (NEA 17), not seven");
  const one = signalsFor(rows, { config: { minBuyers: 1, minValueUsd: 0 } }).signals[0];
  assert.deepEqual([one.uniqueBuyers, one.purchases, one.valueUsd], [1, 1, 207_100 * 11.11]);
  assert.equal(one.publishedAt, "2026-03-12 20:15:03 ET", "public from the FIRST report");
});

test("same holder named, but a different transaction (shares / holdings after differ) → never merged", () => {
  const a = managerRow(nea("Florence Anthony", "0001559827"), "2026-03-12 20:15:03");
  const b = managerRow(nea("Walker Paul", "0001553150"), "2026-03-12 20:15:04", { shares: 100_000, sharesOwnedAfter: 1_397_893 });
  assert.equal(groupTransactions([a, b]).length, 2, "matching ownership entity alone is not enough");
});

test("same owner buys repeatedly — same day and across days — every purchase is kept", () => {
  // $50K, then $100K, then $20M by one person: 3 purchases, 1 buyer, all value counted.
  const p = (date, accepted, shares, after, acc) => tx({ owners: [O.CEO], date, accepted, shares, price: 50, sharesOwnedAfter: after, accessionNo: acc });
  const rows = [p("2026-05-04", "2026-05-05 17:00:00", 1_000, 101_000), p("2026-05-04", "2026-05-05 17:00:01", 2_000, 103_000), p("2026-05-06", "2026-05-07 17:00:00", 400_000, 503_000)];
  assert.equal(groupTransactions(rows).length, 3);
  const s = signalsFor(rows, { config: { minBuyers: 1, minValueUsd: 0 } }).signals[0];
  assert.deepEqual([s.uniqueBuyers, s.purchases, s.valueUsd], [1, 1, 50_000], "first signal: what was public then");
  const all = signalsFor(rows, { config: { minBuyers: 1, minValueUsd: 20_000_000 } }).signals[0];
  assert.deepEqual([all.uniqueBuyers, all.purchases, all.valueUsd], [1, 3, 20_150_000]);
  // Two rows of ONE filing with identical numbers (two genuine lots) are never merged.
  const lot1 = tx({ owners: [O.CFO], date: "2026-05-04", accepted: "2026-05-05 18:00:00", shares: 500, sharesOwnedAfter: 9_000, accessionNo: "0000000000-26-777777" });
  const lot2 = { ...lot1, id: "0000000000-26-777777:1" };
  assert.equal(groupTransactions([lot1, lot2]).length, 2);
});

test("AVLN: two funds' purchases in one filing stay two; a related director's duplicate of one is merged", () => {
  const SR = [{ cik: "0001853723", name: "SR ONE CAPITAL MANAGEMENT, LLC", role: "10% Owner", isTenPercentOwner: true }];
  const fund2 = tx({ owners: SR, date: "2026-05-01", accepted: "2026-05-01 18:46:03", shares: 277_778, price: 18, sharesOwnedAfter: 2_186_562, ownership: "I", accessionNo: "0001193125-26-201887", issuerCik: "0001540171", ticker: "AVLN",
    footnotes: [{ id: "F2", text: "The reported securities are held directly by SR One Capital Fund II Aggregator, LP." }] });
  const amzl = { ...tx({ owners: SR, date: "2026-05-01", accepted: "2026-05-01 18:46:03", shares: 277_777, price: 18, sharesOwnedAfter: 1_122_087, ownership: "I", accessionNo: "0001193125-26-201887", issuerCik: "0001540171", ticker: "AVLN",
    footnotes: [{ id: "F4", text: "The reported securities are held directly by AMZL, LP." }] }), id: "0001193125-26-201887:5" };
  const carroll = tx({ owners: [{ cik: "0001598542", name: "Carroll Jill", role: "Director", isDirector: true }], date: "2026-05-01", accepted: "2026-05-01 18:50:38", shares: 277_778, price: 18, sharesOwnedAfter: 2_186_562, ownership: "I", issuerCik: "0001540171", ticker: "AVLN",
    footnotes: [{ id: "F2", text: "The securities are directly held by SR One Capital Fund II Aggregator, LP. SR One Capital Management, LLC serves as general partner." }] });
  const g = groupTransactions([fund2, amzl, carroll]);
  assert.equal(g.length, 2, "Fund II purchase (reported twice) + AMZL purchase");
  const s = signalsFor([fund2, amzl, carroll], { config: { minBuyers: 1, minValueUsd: 0, roles: ["10% Owner"] } }).signals[0];
  assert.deepEqual([s.purchases, s.valueUsd], [2, 277_778 * 18 + 277_777 * 18], "two genuine fund purchases, the duplicate counted once");
});

test("identical numbers by unrelated filers with NO linking evidence: kept separate and FLAGGED as a possible duplicate", () => {
  const a = tx({ owners: [O.DIR], date: "2026-03-02", accepted: "2026-03-03 17:00:00", ownership: "I", sharesOwnedAfter: 9_000, footnotes: [{ text: "Held by certain affiliated funds." }] });
  const b = tx({ owners: [O.DIR2], date: "2026-03-02", accepted: "2026-03-03 17:05:00", ownership: "I", sharesOwnedAfter: 9_000, footnotes: [{ text: "Held by certain affiliated funds." }] });
  const g = groupTransactions([a, b]);
  assert.equal(g.length, 2);
  assert.ok(g.every((e) => e.dedupe.status === "needs_review"));
  const s = signalsFor([a, b]).signals[0];
  assert.equal(s.possibleDuplicatePurchases, 2, "uncertainty is surfaced on the signal");
  assert.ok(s.snapshot.purchases.every((p) => p.possibleDuplicate === true));
});

test("a linking filing that arrives LATER is still never used before it is public", () => {
  // Two managers name DIFFERENT wording (no shared holder phrase) — only the fund's own
  // filing (later) links them. Before it: two flagged purchases; after: one (final view).
  const vague = [{ text: "The Reporting Person may be deemed to share voting power over the securities." }];
  const a = managerRow(nea("Florence Anthony", "0001559827"), "2026-03-12 20:15:03", { footnotes: vague });
  const b = managerRow(nea("Walker Paul", "0001553150"), "2026-03-12 20:15:04", { footnotes: vague });
  const fund = tx({ ...ISS, owners: [{ cik: "0001768564", name: "New Enterprise Associates 17, L.P.", role: "10% Owner", isTenPercentOwner: true }], date: "2026-03-10", accepted: "2026-03-16 09:00:00",
    shares: 207_100, price: 11.11, sharesOwnedAfter: 1_297_893, ownership: "D", footnotes: [{ text: "Reporting persons: Florence Anthony and Walker Paul are managers." }] });
  const early = signalsFor([a, b, fund], { config: { minBuyers: 2, minValueUsd: 0 } });
  assert.equal(early.signals.length, 1, "at 20:15:04 the public saw two unlinked filers");
  assert.equal(early.signals[0].possibleDuplicatePurchases, 2, "…and the signal says they may be one transaction");
  assert.deepEqual([early.signals[0].hindsight.buyers, early.signals[0].hindsight.purchases], [1, 1], "hindsight (all filings): one");
});
