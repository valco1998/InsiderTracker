// Monthly per-buyer study — signal rules. SYNTHETIC filings only (no real SEC data, no
// numbers from any manual report). The full pipeline (snapshot → point-in-time items) is used.
import { test } from "node:test";
import assert from "node:assert/strict";
import { OWNERS as O, tx } from "./testFixtures.js";
import { buildSnapshot } from "../edgar/insiderSnapshot.js";
import { buildHistoryDataset } from "./form4History.js";
import { detectMonthlySignals, classifyPurchase, detectCurrency, securityMatch, aggregatePriceStatement, fxNeeds } from "./monthlyStudy.js";

function monthly(transactions, { months = ["2026-10"], thresholdUsd = 1_000_000, amendmentFilings = [], fx = null } = {}) {
  const ds = buildHistoryDataset({ store: { records: new Map() }, live: { transactions, amendmentFilings } });
  const snap = buildSnapshot({ transactions: ds.transactions, amendmentFilings: ds.amendmentFilings });
  return detectMonthlySignals({ rows: snap.economic, acceptedAtByAccession: ds.acceptedAtByAccession, months, thresholdUsd, fx,
    reportOwners: (id) => snap.rawById.get(id)?.owners, reportRow: (id) => snap.rawById.get(id) });
}
// $600,000 per default purchase below (12,000 shares × $50).
const buy = (o) => tx({ shares: 12_000, price: 50, ...o });

test("the signal is dated at the filing that first takes the buyer's month sum above the threshold", () => {
  const a = buy({ owners: [O.CEO], date: "2026-10-01", accepted: "2026-10-02 17:00:00" });
  const b = buy({ owners: [O.CEO], date: "2026-10-06", accepted: "2026-10-07 18:30:00" });
  const r = monthly([a, b]);
  assert.equal(r.signals.length, 1);
  const s = r.signals[0];
  assert.equal(s.publishedAt, "2026-10-07 18:30:00 ET");
  assert.equal(s.valueUsdAtSignal, 1_200_000, "only the two purchases public at that moment");
  assert.deepEqual(s.crossingAccessions, [b.accessionNo]);
  assert.equal(s.purchasesAtSignal, 2);
  // A later purchase in the same month never creates a second signal for that buyer.
  const c = buy({ owners: [O.CEO], date: "2026-10-12", accepted: "2026-10-13 18:30:00" });
  assert.equal(monthly([a, b, c]).signals.length, 1);
});

test("the threshold is strictly greater than; another buyer's purchases never add up", () => {
  const exact = tx({ owners: [O.CEO], date: "2026-10-01", accepted: "2026-10-02 17:00:00", shares: 20_000, price: 50 }); // 1,000,000.00
  assert.equal(monthly([exact]).signals.length, 0);
  const twoPeople = [buy({ owners: [O.CEO], date: "2026-10-01", accepted: "2026-10-02 17:00:00" }), buy({ owners: [O.CFO], date: "2026-10-01", accepted: "2026-10-02 18:00:00" })];
  assert.equal(monthly(twoPeople).signals.length, 0, "1.2M in total but 600k per buyer");
});

test("only filings PUBLISHED in the month count — trade dates may be earlier, later filings are another month", () => {
  const sepTrade = buy({ owners: [O.DIR], date: "2026-09-24", accepted: "2026-10-01 16:10:00" });
  const octTrade = buy({ owners: [O.DIR], date: "2026-10-01", accepted: "2026-10-05 08:00:00" });
  const r = monthly([sepTrade, octTrade]);
  assert.equal(r.signals.length, 1);
  assert.equal(r.signals[0].tradeDateFrom, "2026-09-24");
  assert.equal(r.signals[0].tradedBeforeMonth, true);
  // Same purchases, but the second one is published in November → no October signal, no November signal.
  const nov = buy({ owners: [O.DIR], date: "2026-10-29", accepted: "2026-11-02 08:00:00" });
  assert.equal(monthly([sepTrade, nov]).signals.length, 0);
  assert.equal(monthly([sepTrade, nov], { months: ["2026-11"] }).signals.length, 0);
  // A purchase published in September never counts in October.
  const sepPub = buy({ owners: [O.DIR], date: "2026-09-20", accepted: "2026-09-22 17:00:00" });
  assert.equal(monthly([sepPub, octTrade]).signals.length, 0);
});

test("joint filers on one report are one buyer; every legal owner is kept", () => {
  const j = tx({ owners: [O.FUND, O.FUND_GP], date: "2026-10-01", accepted: "2026-10-02 17:00:00", shares: 30_000, price: 50 });
  const r = monthly([j]);
  assert.equal(r.signals.length, 1);
  assert.deepEqual(r.signals[0].legalOwners.map((o) => o.cik).sort(), [O.FUND.cik, O.FUND_GP.cik]);
  assert.equal(r.signals[0].valueUsdAtSignal, 1_500_000, "one transaction, not counted per filer");
});

test("a fund's purchase reported again by its manager (confirmed duplicate) is counted once", () => {
  const GP = { cik: "0000000202", name: "Big Fund GP LLC", role: "10% Owner", isTenPercentOwner: true };
  const fund = tx({ owners: [O.FUND], date: "2026-10-01", accepted: "2026-10-02 10:00:00", ownership: "D", sharesOwnedAfter: 50_000, shares: 12_000 });
  const gp = tx({ owners: [GP], date: "2026-10-01", accepted: "2026-10-03 10:00:00", ownership: "I", nature: "By Big Fund LP", sharesOwnedAfter: 50_000, shares: 12_000 });
  const r = monthly([fund, gp]);
  assert.equal(r.signals.length, 0, "600k once — never 1.2M");
  const p = r.examined.filter((x) => x.valueUsd != null);
  assert.equal(p.length, 1, "one economic purchase in the audit list");
});

test("different CIKs with the same name are never merged", () => {
  const smith1 = { cik: "0000000901", name: "Smith John", role: "Director", isDirector: true };
  const smith2 = { cik: "0000000902", name: "Smith John", role: "Director", isDirector: true };
  const r = monthly([buy({ owners: [smith1], date: "2026-10-01", accepted: "2026-10-02 17:00:00" }), buy({ owners: [smith2], date: "2026-10-01", accepted: "2026-10-02 18:00:00" })]);
  assert.equal(r.signals.length, 0);
});

test("Form 4/A: an original counts while public; a correction of an EARLIER month's filing is not a new purchase", () => {
  // Original 1.2M public on 10-02 → signal then, even though a 4/A later cuts it (no lookahead).
  const orig = tx({ owners: [O.CFO], date: "2026-10-01", accepted: "2026-10-02 17:00:00", shares: 24_000 });
  const amend = tx({ owners: [O.CFO], date: "2026-10-01", accepted: "2026-10-20 08:00:00", formType: "4/A", shares: 2_000 });
  const af = [{ accessionNo: amend.accessionNo, issuerCik: "0000005000", ownerCiks: [O.CFO.cik], originalSubmissionDate: "2026-10-02", hasNonDerivativeTable: true, totalNonDerivative: 1, acceptedAtET: "2026-10-20 08:00:00 ET", filingDate: "2026-10-20" }];
  const r = monthly([orig, amend], { amendmentFilings: af });
  assert.equal(r.signals.length, 1);
  assert.equal(r.signals[0].publishedAt, "2026-10-02 17:00:00 ET");
  // A September purchase restated by a 4/A in October: the restatement is not October money.
  const sep = tx({ owners: [O.COO], date: "2026-09-25", accepted: "2026-09-28 17:00:00", shares: 24_000 });
  const fix = tx({ owners: [O.COO], date: "2026-09-25", accepted: "2026-10-06 08:00:00", formType: "4/A", shares: 24_000 });
  const af2 = [{ accessionNo: fix.accessionNo, issuerCik: "0000005000", ownerCiks: [O.COO.cik], originalSubmissionDate: "2026-09-28", hasNonDerivativeTable: true, totalNonDerivative: 1, acceptedAtET: "2026-10-06 08:00:00 ET", filingDate: "2026-10-06" }];
  const r2 = monthly([sep, fix], { amendmentFilings: af2 });
  assert.equal(r2.signals.length, 0);
  assert.equal(r2.examined.find((x) => x.accessionNo === fix.accessionNo)?.valueExcludedReason, "correction_of_earlier_month");
  assert.equal(r2.stats.correctionsOfEarlierMonths, 1);
});

test("foreign currency: converted with the documented reference rate, unknown currency not counted", () => {
  const brl = tx({ owners: [O.DIR2], date: "2026-10-01", accepted: "2026-10-02 17:00:00", shares: 100_000, price: 30, footnotes: [{ id: "F1", text: "Brazilian reais." }] }); // BRL 3,000,000
  assert.equal(detectCurrency(brl).code, "BRL");
  assert.deepEqual(fxNeeds([{ ...brl, code: "P" }], ["2026-10"]), [{ code: "BRL", date: "2026-10-01" }]);
  const lowRate = () => ({ rate: 0.18, rateDate: "2026-10-01", source: "test" });
  const highRate = () => ({ rate: 0.4, rateDate: "2026-09-30", source: "test" });
  assert.equal(monthly([brl], { fx: lowRate }).signals.length, 0, "BRL 3M × 0.18 = USD 540k — never read as USD 3M");
  const r = monthly([brl], { fx: highRate });
  assert.equal(r.signals.length, 1);
  assert.equal(r.signals[0].valueUsdAtSignal, 1_200_000);
  assert.deepEqual(r.signals[0].purchases[0].fx, { from: "BRL", rate: 0.4, rateDate: "2026-09-30", source: "test" });
  assert.equal(monthly([brl], { fx: () => null }).examined[0].valueExcludedReason, "fx_unavailable");
  const unknown = tx({ owners: [O.DIR2], date: "2026-10-01", accepted: "2026-10-02 17:00:00", shares: 100_000, price: 30, footnotes: [{ id: "F1", text: "The price per share is in ILA." }] });
  const u = monthly([unknown]);
  assert.equal(u.signals.length, 0);
  assert.equal(u.examined[0].valueExcludedReason, "currency_unknown");
  // Filer's own conversion statement → already USD.
  const conv = tx({ owners: [O.DIR2], date: "2026-10-01", accepted: "2026-10-02 17:00:00", footnotes: [{ id: "F1", text: "The price of BRL 56.27 per share has been converted to U.S. dollars at a rate of 5.2 BRL per USD." }] });
  assert.equal(detectCurrency(conv).code, "USD");
});

test("an aggregate price entered in the price column is honoured only with an explicit matching footnote", () => {
  const row = tx({ owners: [O.FUND], date: "2026-10-01", accepted: "2026-10-02 17:00:00", shares: 4_000_000, price: 2_000_000, footnotes: [{ id: "F1", text: "Sold and transferred 4,000,000 shares for an aggregate purchase price of US$2,000,000." }] });
  assert.deepEqual(aggregatePriceStatement(row)?.valueUsd, 2_000_000);
  const r = monthly([row]);
  assert.equal(r.signals[0].valueUsdAtSignal, 2_000_000);
  assert.equal(r.signals[0].insiderAvgPriceUsd, 0.5);
  assert.equal(aggregatePriceStatement({ ...row, footnotes: [{ text: "aggregate purchase price of US$5,000,000" }] }), null, "amount must equal the reported price");
});

test("missing prices are kept in the audit list with a reason, never counted as zero", () => {
  const r = monthly([tx({ owners: [O.CEO], date: "2026-10-01", accepted: "2026-10-02 17:00:00", price: null })]);
  assert.equal(r.signals.length, 0);
  assert.equal(r.examined[0].valueExcludedReason, "missing_price");
  assert.equal(r.examined[0].valueUsd, null);
});

test("purchase classification labels without excluding", () => {
  const text = (t, extra = {}) => ({ footnotes: [{ text: t }], remarks: null, purchaseContext: "unspecified", ...extra });
  assert.equal(classifyPurchase(text("Represents shares acquired from irrevocable trusts through the power to substitute assets of equivalent value. In exchange for the shares, a revocable trust transferred cash.")).type, "trust_or_asset_exchange");
  assert.equal(classifyPurchase(text("Represents shares acquired from irrevocable trusts through the power to substitute assets.")).isNewCapital, false);
  assert.equal(classifyPurchase(text("Shares purchased in the issuer's underwritten public offering at the public offering price.")).type, "offering");
  assert.equal(classifyPurchase(text("entered into a share purchase agreement with the Issuer")).type, "private_placement");
  assert.equal(classifyPurchase(text("Purchased pursuant to a Rule 10b5-1 trading plan.")).type, "plan_10b5_1");
  assert.equal(classifyPurchase({ footnotes: [], purchaseContext: "open_market" }).type, "open_market");
  assert.equal(classifyPurchase({ footnotes: [{ text: "Section 16 of the Securities Exchange Act of 1934" }], purchaseContext: "unspecified" }).type, "unknown", "the Exchange Act is not an exchange of assets");
  // Classification never removes a purchase: a trust exchange still counts toward the threshold.
  const ex = tx({ owners: [O.DIR], date: "2026-10-01", accepted: "2026-10-02 17:00:00", shares: 30_000, context: "unspecified", footnotes: [{ id: "F1", text: "In exchange for the shares, a revocable trust transferred cash of equivalent value to the irrevocable trusts." }] });
  const r = monthly([ex]);
  assert.equal(r.signals.length, 1);
  assert.deepEqual(r.signals[0].purchaseTypes, ["trust_or_asset_exchange"]);
  assert.equal(r.signals[0].newCapitalShare, 0);
});

test("security match flags another class / local series / non-common security", () => {
  assert.equal(securityMatch({ ticker: "ACME", securityTitle: "Common Stock", tickerSymbols: ["ACME"] }).status, "ok");
  assert.equal(securityMatch({ ticker: "BBD", securityTitle: "Preference shares - BBDC4", tickerSymbols: ["BBD", "BBDO"] }).status, "uncertain");
  assert.ok(securityMatch({ ticker: "XYZ", securityTitle: "Class B Common Stock", tickerSymbols: ["XYZ", "XYZ.A"] }).reasons[0].startsWith("class_B"));
  assert.deepEqual(securityMatch({ ticker: null, securityTitle: "Common Stock" }).reasons, ["no_ticker"]);
});
