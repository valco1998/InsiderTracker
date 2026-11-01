// Regression tests for economic-transaction de-duplication.
//
// __fixtures__/0001866581-26-0001{64,66,67}.txt are REAL, unmodified SEC EDGAR
// Form 4 submissions (Dutch Bros Inc., BROS, filed 2026-10-30):
//   000164  Boersma Travis (Exec. Chairman · Director · 10% Owner), Indirect,
//           "By DM Trust Aggregator, LLC" / "By DM Individual Aggregator, LLC"
//   000166  DM Trust Aggregator, LLC (10% Owner), Direct
//   000167  DM Individual Aggregator, LLC (10% Owner), Direct
// Negative cases use SYNTHETIC variants derived in memory from those files;
// they are labelled as such and never served as data.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseForm4Submission } from "./form4Parser.js";
import { groupTransactions, computeTotals, pairEvidence, candidateKey } from "./transactionGroups.js";

const fixture = (acc) => fs.readFileSync(new URL(`./__fixtures__/${acc}.txt`, import.meta.url), "utf8");
const BOERSMA = fixture("0001866581-26-000164");
const DM_TRUST = fixture("0001866581-26-000166");
const DM_INDIVIDUAL = fixture("0001866581-26-000167");
const rowsOf = (...txts) => txts.flatMap((t) => parseForm4Submission(t).transactions);

const TRUST_SALE_VALUE = 11711075.6;                                  // 266,000 × $44.0266
const INDIVIDUAL_SALE_VALUE = Math.round(142023 * 44.0266 * 100) / 100; // 142,023 × $44.0266

test("BROS fixtures parse as expected (real filings)", () => {
  const b = parseForm4Submission(BOERSMA).transactions;
  assert.equal(b.length, 2, "Boersma filing has two sale rows");
  assert.deepEqual(b.map((r) => [r.shares, r.ownership, r.natureOfOwnership]), [
    [266000, "I", "By DM Trust Aggregator, LLC"],
    [142023, "I", "By DM Individual Aggregator, LLC"],
  ]);
  const t = parseForm4Submission(DM_TRUST).transactions;
  assert.equal(t.length, 1);
  assert.equal(t[0].insiderName, "DM Trust Aggregator, LLC");
  assert.equal(t[0].ownership, "D");
  assert.equal(t[0].value, TRUST_SALE_VALUE);
  assert.equal(candidateKey(b[0]), candidateKey(t[0]), "same economic candidate key");
});

test("BROS: Boersma (I) + DM Trust (D) → one confirmed economic transaction, both filings preserved", () => {
  const rows = rowsOf(BOERSMA, DM_TRUST);
  const econ = groupTransactions(rows);
  const trust = econ.filter((e) => e.shares === 266000);
  assert.equal(trust.length, 1, "266,000-share sale appears once");
  const g = trust[0];
  assert.equal(g.dedupe.status, "confirmed");
  assert.equal(g.insiderName, "Boersma Travis", "human officer/director is the primary reporter");
  assert.deepEqual(g.reportedBy.map((r) => r.accessionNo).sort(), ["0001866581-26-000164", "0001866581-26-000166"]);
  assert.deepEqual(g.reportedBy.map((r) => r.insiderName).sort(), ["Boersma Travis", "DM Trust Aggregator, LLC"]);
  assert.ok(g.reportedBy.every((r) => r.filingUrl.startsWith("https://www.sec.gov/Archives/edgar/data/1866581/")));
  assert.ok(g.dedupe.evidence.some((e) => e.includes('names "DM Trust Aggregator, LLC"')), "relationship evidence recorded");
  assert.ok(g.dedupe.evidence.some((e) => /ownership I .* \+ D /.test(e)), "ownership evidence recorded");
  assert.equal(g.value, TRUST_SALE_VALUE);

  // The DM Individual row in the Boersma filing has no counterpart here → single, not flagged.
  const ind = econ.filter((e) => e.shares === 142023);
  assert.equal(ind.length, 1);
  assert.equal(ind[0].dedupe.status, "single");

  // Raw input untouched: 3 rows, 2 filings.
  assert.equal(rows.length, 3);
});

test("BROS totals count the confirmed duplicate value once", () => {
  const rows = rowsOf(BOERSMA, DM_TRUST, DM_INDIVIDUAL);
  const econ = groupTransactions(rows);
  assert.equal(rows.length, 4, "4 raw filing rows");
  assert.equal(econ.length, 2, "2 economic transactions");
  assert.ok(econ.every((e) => e.dedupe.status === "confirmed"));
  assert.deepEqual(econ.map((e) => e.reportedBy.length), [2, 2]);

  const totals = computeTotals(econ);
  assert.equal(totals.count, 2);
  assert.equal(totals.sales, 2);
  assert.equal(totals.confirmedGroups, 2);
  assert.equal(totals.saleValue, Math.round((TRUST_SALE_VALUE + INDIVIDUAL_SALE_VALUE) * 100) / 100);

  const naive = computeTotals(rows); // what the MVP showed before
  assert.equal(naive.saleValue, Math.round(2 * (TRUST_SALE_VALUE + INDIVIDUAL_SALE_VALUE) * 100) / 100, "raw rows double-count");
});

test("BROS groups are order-independent and get a stable economicId", () => {
  const a = groupTransactions(rowsOf(BOERSMA, DM_TRUST, DM_INDIVIDUAL));
  const b = groupTransactions(rowsOf(DM_INDIVIDUAL, DM_TRUST, BOERSMA));
  const ids = (x) => x.map((e) => e.economicId).sort();
  assert.deepEqual(ids(a), ids(b));
  // Same id as the single DM Trust row had before the Boersma filing arrived.
  const trustOnly = groupTransactions(rowsOf(DM_TRUST))[0].economicId;
  assert.ok(ids(a).includes(trustOnly), "late-arriving related filing does not change the economicId");
});

// ── Synthetic negative variants (derived in memory, never served) ───────────
const SYN_NO_RELATIONSHIP = BOERSMA
  .replaceAll("DM Trust Aggregator", "Unrelated Holdings")
  .replaceAll("DM Individual Aggregator", "Other Unrelated Holdings");
const SYN_BOTH_DIRECT = BOERSMA.replace(/<directOrIndirectOwnership>\s*<value>I<\/value>/g, "<directOrIndirectOwnership><value>D</value>");
const SYN_DIFFERENT_AFTER = DM_TRUST.replace("<value>4153652</value>", "<value>4153650</value>");

test("synthetic: same ticker/date/shares/price but no relationship evidence → kept separate, flagged for review", () => {
  const econ = groupTransactions(rowsOf(SYN_NO_RELATIONSHIP, DM_TRUST)).filter((e) => e.shares === 266000);
  assert.equal(econ.length, 2, "not merged");
  assert.ok(econ.every((e) => e.dedupe.status === "needs_review"));
  assert.ok(econ.every((e) => /no reporting-relationship evidence/.test(e.dedupe.reason)));
  assert.notEqual(econ[0].economicId, econ[1].economicId);
  assert.equal(computeTotals(econ).saleValue, Math.round(2 * TRUST_SALE_VALUE * 100) / 100, "uncertain matches are counted separately");
});

test("synthetic: relationship evidence but both rows Direct → kept separate, flagged for review", () => {
  const econ = groupTransactions(rowsOf(SYN_BOTH_DIRECT, DM_TRUST)).filter((e) => e.shares === 266000);
  assert.equal(econ.length, 2);
  assert.ok(econ.every((e) => e.dedupe.status === "needs_review"));
  assert.ok(econ.every((e) => /no indirect holder/.test(e.dedupe.reason)));
});

test("synthetic: different shares-owned-after → not a candidate, not flagged", () => {
  const econ = groupTransactions(rowsOf(BOERSMA, SYN_DIFFERENT_AFTER)).filter((e) => e.shares === 266000);
  assert.equal(econ.length, 2);
  assert.ok(econ.every((e) => e.dedupe.status === "single"));
});

test("rows from the same filing are never merged, even when identical", () => {
  // Synthetic: DM Trust filing with its sale row duplicated.
  const row = DM_TRUST.match(/<nonDerivativeTransaction>[\s\S]*?<\/nonDerivativeTransaction>/)[0];
  const SYN_TWO_IDENTICAL = DM_TRUST.replace(row, row + row);
  const own = rowsOf(SYN_TWO_IDENTICAL);
  assert.equal(own.length, 2);
  assert.equal(pairEvidence(own[0], own[1]).confirmed, false);
  assert.equal(groupTransactions(own).length, 2);

  // With the related Boersma filing present, at most one of the two can join it.
  const econ = groupTransactions(rowsOf(BOERSMA, SYN_TWO_IDENTICAL)).filter((e) => e.shares === 266000);
  assert.equal(econ.length, 2);
  for (const e of econ) {
    const accs = e.reportedBy.map((r) => r.accessionNo);
    assert.equal(new Set(accs).size, accs.length, "no group contains two rows of one filing");
  }
  assert.deepEqual(econ.map((e) => e.dedupe.status).sort(), ["confirmed", "needs_review"]);
});
