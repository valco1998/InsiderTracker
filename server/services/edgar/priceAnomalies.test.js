// Regression tests for price-anomaly safeguards.
//
// REAL, unmodified SEC fixtures:
//   0002126186-26-000002  LeonaBio, Inc. (LONA) — reports 3,149,470 sh @ $3,149.47
//                         (footnote: warrant exercise) → the motivating anomaly
//   0001866581-26-0001{64,66,67}  Dutch Bros (BROS) duplicate-reporting case
// All other inputs are SYNTHETIC rows built in memory and labelled as such.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseForm4Submission } from "./form4Parser.js";
import { annotatePriceChecks, isAlertEligible, ANOMALY_LABEL } from "./priceAnomalies.js";
import { groupTransactions, computeTotals } from "./transactionGroups.js";

const fixture = (acc) => fs.readFileSync(new URL(`./__fixtures__/${acc}.txt`, import.meta.url), "utf8");
const rowsOf = (...accs) => accs.flatMap((a) => parseForm4Submission(fixture(a)).transactions);
const LONA = "0002126186-26-000002";
const BROS = ["0001866581-26-000164", "0001866581-26-000166", "0001866581-26-000167"];

// SYNTHETIC row factory (not SEC data).
let n = 0;
const syn = (o = {}) => {
  const shares = o.shares ?? 1000;
  const price = o.price === undefined ? 50 : o.price;
  return {
    id: `SYN-${++n}:0`, accessionNo: o.accessionNo ?? `0000000000-26-${String(n).padStart(6, "0")}`,
    issuerCik: o.issuerCik ?? "0000009999", ticker: "SYNX", code: o.code ?? "P", securityTitle: o.securityTitle ?? "Common Stock",
    transactionDate: o.transactionDate ?? "2026-10-28", shares, price, value: price != null && shares ? Math.round(shares * price * 100) / 100 : null,
    sharesOwnedAfter: o.sharesOwnedAfter ?? shares * 3, ownership: o.ownership ?? "D", owners: [{ name: "Synthetic Owner", cik: "0000000001" }],
    footnotes: o.footnotes ?? [], reported: o.reported ?? { shares: String(shares), pricePerShare: price == null ? null : String(price), sharesOwnedAfter: null },
  };
};
const check = (row, others = []) => annotatePriceChecks([row, ...others])[0].priceCheck;

// ── Suspicious prices ────────────────────────────────────────────────────────
test("REAL LONA filing: price echoes share count → anomaly, original SEC values preserved", () => {
  const [t] = annotatePriceChecks(rowsOf(LONA));
  assert.equal(t.priceCheck.status, "anomaly");
  assert.equal(t.priceCheck.label, ANOMALY_LABEL);
  assert.equal(ANOMALY_LABEL, "Price anomaly — verify filing");
  assert.deepEqual(t.priceCheck.reasons.map((r) => r.rule), ["price_echoes_shares"]);
  // Audit trail: exactly what was filed, plus the parsed numbers, untouched.
  assert.equal(t.reported.shares, "3149470");
  assert.equal(t.reported.pricePerShare, "3149.47");
  assert.equal(t.shares, 3149470);
  assert.equal(t.price, 3149.47);
  assert.equal(t.value, 9919161280.9);
  assert.match(t.filingUrl, /^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/\d+\/000212618626000002\/0002126186-26-000002-index\.htm$/);
  assert.deepEqual(isAlertEligible(t), { eligible: false, reason: ANOMALY_LABEL });
});

test("REAL LONA in totals: stays visible and counted, but its value is excluded", () => {
  const econ = groupTransactions(annotatePriceChecks(rowsOf(LONA, ...BROS)));
  const lona = econ.find((e) => e.ticker === "LONA");
  assert.ok(lona, "anomalous record remains in the result set");
  const totals = computeTotals(econ);
  assert.equal(totals.count, 3, "LONA + 2 BROS economic transactions");
  assert.equal(totals.priceAnomalies, 1);
  assert.equal(totals.anomalyValueExcluded, 9919161280.9);
  assert.equal(totals.purchaseValue, 0, "the $9.9B anomaly is not in purchase totals");
  assert.equal(totals.saleValue, Math.round((11711075.6 + 142023 * 44.0266) * 100) / 100);
});

test("synthetic: reported price far outside the single range stated in its footnote → anomaly", () => {
  const c = check(syn({ price: 75, footnotes: [{ id: "F1", text: "weighted average price; shares purchased in multiple transactions at prices ranging from $20.10 to $24.95, inclusive." }] }));
  assert.equal(c.status, "anomaly");
  assert.deepEqual(c.reasons.map((r) => r.rule), ["outside_stated_range"]);
});

test("synthetic: price ≥ 20× the median of other reported prices for the same security → anomaly", () => {
  const peers = [syn({ price: 20.1 }), syn({ price: 19.8 }), syn({ price: 20.4, transactionDate: "2026-10-30" })];
  const c = check(syn({ price: 2010 }), peers);
  assert.equal(c.status, "anomaly");
  assert.deepEqual(c.reasons.map((r) => r.rule), ["peer_price_outlier"]);
});

test("synthetic: unparseable filed price → anomaly", () => {
  const c = check(syn({ price: null, reported: { shares: "1000", pricePerShare: "N/A", sharesOwnedAfter: null } }));
  assert.equal(c.status, "anomaly");
  assert.deepEqual(c.reasons.map((r) => r.rule), ["unparseable_value"]);
});

// ── Normal / legitimate (must NOT be flagged) ───────────────────────────────
test("REAL BROS filings → all ok and alert-eligible", () => {
  const rows = annotatePriceChecks(rowsOf(...BROS));
  assert.ok(rows.every((t) => t.priceCheck.status === "ok"));
  assert.ok(rows.every((t) => isAlertEligible(t).eligible));
});

test("synthetic: legitimate high-value trades are never flagged for size alone", () => {
  // ~$1.0B sale, price consistent with its stated range.
  assert.equal(check(syn({ code: "S", shares: 2500000, price: 401.23, footnotes: [{ id: "F1", text: "sold in multiple transactions at prices ranging from $400.10 to $402.00" }] })).status, "ok");
  // Very high share price (BRK.A-like), small share count.
  assert.equal(check(syn({ shares: 12, price: 725000.5 })).status, "ok");
  // $25B block — large, but nothing inconsistent in the filing.
  assert.equal(check(syn({ code: "S", shares: 100000000, price: 250.17 })).status, "ok");
});

test("synthetic: near-coincidences from real data are not flagged (GDYN, KMTS, round numbers)", () => {
  assert.equal(check(syn({ shares: 10512, price: 10.51 })).status, "ok");    // GDYN-like: 10.51×1000 ≠ 10512
  assert.equal(check(syn({ shares: 30000, price: 30.0294 })).status, "ok");  // KMTS-like
  assert.equal(check(syn({ shares: 31250, price: 3.125 })).status, "ok");    // < 5 significant digits
  assert.equal(check(syn({ shares: 1000, price: 1 })).status, "ok");
});

test("synthetic: ambiguous footnotes never trigger the range rule", () => {
  // Multiple ranges in shared multi-row footnotes (NEGG-like) → ignored.
  assert.equal(check(syn({ price: 9.78, footnotes: [{ id: "F1", text: "Row 1: prices ranging from $10.065 to $10.38. Row 2: prices ranging from $9.53 to $9.99." }] })).status, "ok");
  // Slightly outside a stated range (KEY-like, within 2×) → not gross → ok.
  assert.equal(check(syn({ price: 21.2, footnotes: [{ id: "F1", text: "prices ranging from $20.20 to $20.21" }] })).status, "ok");
});

test("synthetic: peer rule needs ≥ 2 peers of the SAME security within ±7 days", () => {
  assert.equal(check(syn({ price: 2010 }), [syn({ price: 20 })]).status, "ok", "one peer is not enough");
  assert.equal(check(syn({ price: 2010 }), [syn({ price: 20, securityTitle: "Series A Preferred" }), syn({ price: 21, securityTitle: "Series A Preferred" })]).status, "ok", "different security");
  assert.equal(check(syn({ price: 2010 }), [syn({ price: 20, transactionDate: "2026-09-01" }), syn({ price: 21, transactionDate: "2026-09-02" })]).status, "ok", "outside the window");
  assert.equal(check(syn({ price: 35 }), [syn({ price: 20 }), syn({ price: 21 })]).status, "ok", "1.7× is normal volatility");
});

// ── Missing prices ───────────────────────────────────────────────────────────
test("missing price → missing_price (not an anomaly), kept, excluded from value totals", () => {
  const rows = annotatePriceChecks([syn({ price: null, reported: { shares: "500", pricePerShare: null, sharesOwnedAfter: null } }), syn({ price: 10 })]);
  assert.equal(rows[0].priceCheck.status, "missing_price");
  assert.equal(rows[0].value, null);
  assert.equal(isAlertEligible(rows[0]).eligible, true, "no value to misreport; value-based rules simply cannot match");
  const totals = computeTotals(groupTransactions(rows));
  assert.equal(totals.count, 2);
  assert.equal(totals.valueMissing, 1);
  assert.equal(totals.priceAnomalies, 0);
  assert.equal(totals.purchaseValue, 10000);
});

test("rows without a price check are not alert-eligible (fail closed)", () => {
  assert.equal(isAlertEligible(syn()).eligible, false);
});

// ── Duplicate economic transactions ──────────────────────────────────────────
test("REAL BROS duplicates: still one confirmed group each, ok, value counted once", () => {
  const econ = groupTransactions(annotatePriceChecks(rowsOf(...BROS)));
  assert.equal(econ.length, 2);
  assert.ok(econ.every((e) => e.dedupe.status === "confirmed" && e.priceCheck.status === "ok"));
  assert.equal(computeTotals(econ).saleValue, Math.round((11711075.6 + 142023 * 44.0266) * 100) / 100);
});

test("duplicate group with ONE anomalous filing → whole group anomalous, excluded once", () => {
  // Synthetic: mark the DM Trust filing's row anomalous; Boersma's matching row is ok.
  const rows = annotatePriceChecks(rowsOf("0001866581-26-000164", "0001866581-26-000166")).map((t) =>
    t.accessionNo === "0001866581-26-000166"
      ? { ...t, priceCheck: { status: "anomaly", label: ANOMALY_LABEL, reasons: [{ rule: "synthetic", detail: "synthetic test reason" }] } }
      : t);
  const econ = groupTransactions(rows);
  const g = econ.find((e) => e.shares === 266000);
  assert.equal(g.dedupe.status, "confirmed", "grouping is unaffected");
  assert.equal(g.reportedBy.length, 2, "both original filings preserved");
  assert.equal(g.priceCheck.status, "anomaly");
  assert.equal(isAlertEligible(g).eligible, false);
  const totals = computeTotals(econ);
  assert.equal(totals.priceAnomalies, 1, "group counted once");
  assert.equal(totals.anomalyValueExcluded, 11711075.6);
  assert.equal(totals.saleValue, Math.round(142023 * 44.0266 * 100) / 100, "only the ok group is summed");
});
