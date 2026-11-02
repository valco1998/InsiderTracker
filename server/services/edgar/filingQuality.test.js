// Phase A data-quality tests: exchange-prefixed tickers, Form 4/A amendments,
// late filings — end to end through the shared pipeline (checkRows → group →
// totals → alert eligibility).
//
// REAL SEC fixtures:
//   0001649471-26-000006  FLG Form 4 whose issuerTradingSymbol is "NYSE:FLG"
//   0001284489-26-000040  SCCO Form 4 filed 2026-09-25 (S 100 sh, 1,503 owned after)
//   0001284489-26-000042  SCCO Form 4/A filed 2026-10-30 correcting it (1,403 owned after)
//   0001437749-26-034087  USCB Form 4 filed 2026-10-30: P 1,000 sh
//   0001437749-26-034103  USCB Form 4/A the same day: the purchase "did not in fact occur"
//                         (Table I restated with a holding only, no transactions)
// Edge cases derive SYNTHETIC variants from those in memory and say so.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseForm4Submission, normalizeFiledTicker } from "./form4Parser.js";
import { checkRows } from "./insiderData.js";
import { groupTransactions, computeTotals } from "./transactionGroups.js";
import { isAlertEligible } from "./priceAnomalies.js";
import { selectAlertCandidates } from "../insiderAlertEngine.js";
import { parseAcceptedAtET } from "./easternTime.js";

const fx = (acc) => fs.readFileSync(new URL(`./__fixtures__/${acc}.txt`, import.meta.url), "utf8");
const FLG = parseForm4Submission(fx("0001649471-26-000006"));
const ORIG = parseForm4Submission(fx("0001284489-26-000040"));
const AMEND = parseForm4Submission(fx("0001284489-26-000042"));
const USCB = parseForm4Submission(fx("0001437749-26-034087"));
const USCB_A = parseForm4Submission(fx("0001437749-26-034103"));
const meta = (p) => ({
  accessionNo: p.accessionNo, issuerCik: p.issuerCik, ownerCiks: p.ownerCiks, originalSubmissionDate: p.originalSubmissionDate,
  hasNonDerivativeTable: p.hasNonDerivativeTable, totalNonDerivative: p.totalNonDerivative, acceptedAtET: p.acceptedAtET, filingDate: p.filingDate,
});
const pipeline = (rows, amends) => { const econ = groupTransactions(checkRows(rows, amends)); return { econ, totals: computeTotals(econ) }; };
const byAcc = (rows, acc) => rows.filter((r) => r.accessionNo === acc);

// ── Tickers ──────────────────────────────────────────────────────────────────
test("normalizeFiledTicker strips exchange prefixes and placeholders", () => {
  const cases = {
    "NYSE:FLG": ["FLG", ["FLG"]],
    "NYSE: KRC": ["KRC", ["KRC"]],
    "nasdaq gs: abcd": ["ABCD", ["ABCD"]],
    "NYSE KRC": ["KRC", ["KRC"]],
    "BRK.A, BRK.B": ["BRK.A", ["BRK.A", "BRK.B"]],
    "GOOG/GOOGL": ["GOOG", ["GOOG", "GOOGL"]],
    "  msft ": ["MSFT", ["MSFT"]],
    "GS": ["GS", ["GS"]],
    "NYSE": ["NYSE", ["NYSE"]],
    "None": [null, []],
    "N/A": [null, []],
    "": [null, []],
  };
  for (const [raw, [ticker, symbols]] of Object.entries(cases)) {
    assert.deepEqual(normalizeFiledTicker(raw), { ticker, symbols }, raw);
  }
  assert.deepEqual(normalizeFiledTicker(null), { ticker: null, symbols: [] });
});

test("real FLG filing: ticker normalized, SEC value preserved, CIK untouched", () => {
  assert.equal(FLG.tickerReported, "NYSE:FLG");
  assert.equal(FLG.ticker, "FLG");
  assert.ok(FLG.transactions.length > 0);
  for (const t of FLG.transactions) {
    assert.equal(t.ticker, "FLG");
    assert.equal(t.tickerReported, "NYSE:FLG");
    assert.deepEqual(t.tickerSymbols, ["FLG"]);
    assert.equal(t.issuerCik, FLG.issuerCik);
  }
});

// ── Amendments (real SCCO pair) ──────────────────────────────────────────────
test("real SCCO 4/A metadata: original submission date and Table I", () => {
  assert.equal(AMEND.formType, "4/A");
  assert.equal(AMEND.originalSubmissionDate, "2026-09-25");
  assert.equal(AMEND.totalNonDerivative, 1);
  assert.equal(ORIG.originalSubmissionDate, null);
  assert.equal(ORIG.filingDate, "2026-09-25");
  assert.deepEqual(AMEND.ownerCiks, ORIG.ownerCiks);
  // The correction itself, exactly as filed.
  assert.equal(ORIG.transactions[0].reported.sharesOwnedAfter, "1503");
  assert.equal(AMEND.transactions[0].reported.sharesOwnedAfter, "1403");
});

test("without amendment linking the corrected sale would be counted twice (the bug)", () => {
  const { totals } = pipeline([...ORIG.transactions, ...AMEND.transactions], []);
  assert.equal(totals.sales, 2);
});

test("amendment supersedes the original: counted once, original kept with an audit trail", () => {
  const { econ, totals } = pipeline([...ORIG.transactions, ...AMEND.transactions], [meta(AMEND)]);
  assert.equal(econ.length, 2, "both rows are still returned");
  const [orig] = byAcc(econ, ORIG.accessionNo);
  const [amend] = byAcc(econ, AMEND.accessionNo);
  assert.deepEqual(orig.amendment, { status: "superseded", supersededBy: AMEND.accessionNo, amendmentFiledAt: AMEND.acceptedAtET });
  assert.equal(orig.reported.sharesOwnedAfter, "1503", "original values untouched");
  assert.deepEqual(amend.amendment, { status: "amends", original: ORIG.accessionNo, originalSubmissionDate: "2026-09-25", tableRestated: true });
  assert.equal(totals.count, 1);
  assert.equal(totals.sales, 1);
  assert.equal(totals.saleValue, amend.value);
  assert.equal(totals.supersededByAmendment, 1);
  // Neither the superseded original nor the amendment alerts automatically.
  assert.equal(isAlertEligible(orig).eligible, false);
  assert.equal(isAlertEligible(amend).eligible, false);
  // Superseded rows are never merged into a duplicate group.
  assert.match(orig.economicId, /^row_/);
});

test("alert engine skips superseded rows and amendments with explicit reasons", () => {
  const { econ } = pipeline([...ORIG.transactions, ...AMEND.transactions], [meta(AMEND)]);
  const t = parseAcceptedAtET(AMEND.acceptedAtET).getTime();
  // SYNTHETIC timing: pretend both were just accepted so every time gate passes.
  const fresh = econ.map((r) => ({ ...r, acceptedAtET: AMEND.acceptedAtET }));
  const sel = selectAlertCandidates({
    transactions: fresh, watches: [{ _id: "w", userId: "u", cik: AMEND.issuerCik, types: "both", enabled: true, alertsFrom: new Date(t - 3600_000) }],
    now: t + 5 * 60_000, settleMs: 2 * 60_000, maxAgeMs: 24 * 3600_000, notBefore: t - 3600_000,
  });
  assert.equal(sel.candidates.length, 0);
  assert.equal(sel.skipped.superseded_by_amendment, 1);
  assert.equal(sel.skipped.amendment, 1);
});

test("late-filing classification on the amendment uses the original submission date", () => {
  const rows = checkRows([...ORIG.transactions, ...AMEND.transactions], [meta(AMEND)]);
  const [amend] = byAcc(rows, AMEND.accessionNo);
  assert.equal(amend.filingDate, "2026-10-30");
  assert.equal(amend.transactionDate, "2026-09-24");
  assert.equal(amend.filingDelay.measuredTo, "original_submission");
  assert.equal(amend.filingDelay.late, false);
});

test("amendment whose original is not held is counted once and flagged", () => {
  const { econ, totals } = pipeline([...AMEND.transactions], [meta(AMEND)]);
  assert.equal(econ[0].amendment.status, "original_not_held");
  assert.equal(totals.count, 1);
  assert.equal(totals.amendmentsFlagged, 1);
  assert.equal(totals.supersededByAmendment, 0);
});

test("SYNTHETIC: amendment without Table I amends other items — original stays counted", () => {
  const { econ, totals } = pipeline([...ORIG.transactions], [{ ...meta(AMEND), hasNonDerivativeTable: false, totalNonDerivative: 0 }]);
  assert.equal(econ[0].amendment.status, "amended_other_items");
  assert.equal(totals.count, 1);
  assert.equal(totals.supersededByAmendment, 0);
});

test("SYNTHETIC: ambiguous original → nothing superseded, flagged for review", () => {
  const twinAcc = "0001284489-26-000041";
  const twin = ORIG.transactions.map((t) => ({ ...t, id: `${twinAcc}:0`, accessionNo: twinAcc, shares: 50 }));
  const { econ, totals } = pipeline([...ORIG.transactions, ...twin, ...AMEND.transactions], [meta(AMEND)]);
  const amend = byAcc(econ, AMEND.accessionNo)[0];
  assert.equal(amend.amendment.status, "ambiguous");
  assert.deepEqual(amend.amendment.candidates, [ORIG.accessionNo, twinAcc].sort());
  assert.equal(totals.supersededByAmendment, 0);
  assert.equal(totals.amendmentsFlagged, 1);
});

test("SYNTHETIC: linking requires same issuer, a shared owner and the original date", () => {
  const otherOwner = ORIG.transactions.map((t) => ({ ...t, owners: t.owners.map((o) => ({ ...o, cik: "0009999999" })) }));
  assert.equal(pipeline([...otherOwner, ...AMEND.transactions], [meta(AMEND)]).totals.supersededByAmendment, 0);
  const otherIssuer = ORIG.transactions.map((t) => ({ ...t, issuerCik: "0000000001" }));
  assert.equal(pipeline([...otherIssuer, ...AMEND.transactions], [meta(AMEND)]).totals.supersededByAmendment, 0);
  const otherDate = { ...meta(AMEND), originalSubmissionDate: "2026-09-10" };
  assert.equal(pipeline([...ORIG.transactions, ...AMEND.transactions], [otherDate]).totals.supersededByAmendment, 0);
  // No original submission date stated → unlinked, never superseding.
  const undated = pipeline([...ORIG.transactions, ...AMEND.transactions], [{ ...meta(AMEND), originalSubmissionDate: null }]);
  assert.equal(byAcc(undated.econ, AMEND.accessionNo)[0].amendment.status, "unlinked");
  assert.equal(undated.totals.supersededByAmendment, 0);
});

test("SYNTHETIC: original matched by SEC acceptance date when its FILED AS OF date rolled over", () => {
  const rolled = ORIG.transactions.map((t) => ({ ...t, filingDate: "2026-09-26", acceptedAtET: "2026-09-25 18:02:11 ET" }));
  assert.equal(pipeline([...rolled, ...AMEND.transactions], [meta(AMEND)]).totals.supersededByAmendment, 1);
});

test("SYNTHETIC: two amendments of one original — the latest wins, the earlier is superseded too", () => {
  const laterAcc = "0001284489-26-000050";
  const later = AMEND.transactions.map((t) => ({ ...t, id: `${laterAcc}:0`, accessionNo: laterAcc, acceptedAtET: "2026-10-31 09:00:00 ET", shares: 90 }));
  const laterMeta = { ...meta(AMEND), accessionNo: laterAcc, acceptedAtET: "2026-10-31 09:00:00 ET" };
  const { econ, totals } = pipeline([...ORIG.transactions, ...AMEND.transactions, ...later], [meta(AMEND), laterMeta]);
  assert.equal(byAcc(econ, ORIG.accessionNo)[0].amendment.supersededBy, laterAcc);
  assert.equal(byAcc(econ, AMEND.accessionNo)[0].amendment.status, "superseded");
  assert.equal(byAcc(econ, laterAcc)[0].amendment.status, "amends");
  assert.equal(totals.count, 1);
  assert.equal(totals.supersededByAmendment, 2);
});

test("late filings are counted in totals and flagged per row", () => {
  // SYNTHETIC trade date derived from the real FLG row (filed 2026-10-28).
  const late = FLG.transactions.map((t) => ({ ...t, transactionDate: "2026-10-01" }));
  const { econ, totals } = pipeline(late, []);
  assert.equal(econ[0].filingDelay.late, true);
  assert.equal(totals.lateFilings, late.length);
  const onTime = pipeline(FLG.transactions, []);
  assert.equal(onTime.econ[0].filingDelay.late, false);
  assert.equal(onTime.totals.lateFilings, 0);
});

test("push body says when a Form 4 was filed late, keeping trade and filing dates distinct", async () => {
  const { insiderAlertBody } = await import("../insiderPushFormat.js");
  const [row] = pipeline(FLG.transactions.map((t) => ({ ...t, transactionDate: "2026-10-01" })), []).econ;
  const body = insiderAlertBody(row);
  assert.match(body, /traded Oct 1 · Form 4 filed Oct 28 \(late, 18 business days\)/);
  // Real NUAI dates from the audit: a 2025 trade filed in 2026 must show its year.
  const old = { ...row, transactionDate: "2025-09-26", filingDate: "2026-10-30", filingDelay: { late: true, businessDays: 274 } };
  assert.match(insiderAlertBody(old), /traded Sep 26, 2025 · Form 4 filed Oct 30 \(late, 274 business days\)/);
  const [onTime] = pipeline(FLG.transactions, []).econ;
  assert.doesNotMatch(insiderAlertBody(onTime), /late/);
});

test("real USCB retraction: a 4/A with Table I but no transactions removes the phantom purchase", () => {
  assert.equal(USCB.transactions.length, 1);
  assert.equal(USCB.transactions[0].code, "P");
  assert.equal(USCB_A.formType, "4/A");
  assert.equal(USCB_A.transactions.length, 0, "the amendment reports no P/S transaction");
  assert.equal(USCB_A.totalNonDerivative, 0);
  assert.equal(USCB_A.hasNonDerivativeTable, true, "Table I is present (a holding row)");
  assert.equal(USCB_A.originalSubmissionDate, "2026-10-30");

  // Before the fix (row count as the test): the purchase stayed counted.
  const legacy = pipeline(USCB.transactions, [{ ...meta(USCB_A), hasNonDerivativeTable: undefined }]);
  assert.equal(legacy.totals.purchases, 1);

  const { econ, totals } = pipeline(USCB.transactions, [meta(USCB_A)]);
  assert.equal(econ.length, 1, "the original row is still returned for the audit trail");
  assert.deepEqual(econ[0].amendment, { status: "superseded", supersededBy: USCB_A.accessionNo, amendmentFiledAt: USCB_A.acceptedAtET });
  assert.equal(econ[0].reported.shares, USCB.transactions[0].reported.shares, "original values untouched");
  assert.equal(totals.count, 0);
  assert.equal(totals.purchases, 0);
  assert.equal(totals.purchaseValue, 0);
  assert.equal(totals.supersededByAmendment, 1);
  assert.equal(isAlertEligible(econ[0]).eligible, false);
});
