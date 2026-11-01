// Unit tests for form4Parser. The fixture below is a SYNTHETIC, test-only
// document that follows the SEC ownershipDocument schema — it is never served
// as data. Real data only ever comes from EDGAR via insiderIngest.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseForm4Submission, describeRole, filingIndexUrl } from "./form4Parser.js";

const SYNTHETIC = `<SEC-DOCUMENT>0000000000-26-000001.txt : 20261030
<SEC-HEADER>0000000000-26-000001.hdr.sgml : 20261030
<ACCEPTANCE-DATETIME>20261030173012
ACCESSION NUMBER:		0000000000-26-000001
CONFORMED SUBMISSION TYPE:	4
PUBLIC DOCUMENT COUNT:		1
FILED AS OF DATE:		20261030
</SEC-HEADER>
<DOCUMENT>
<TYPE>4
<TEXT>
<XML>
<?xml version="1.0"?>
<ownershipDocument>
  <schemaVersion>X0508</schemaVersion>
  <documentType>4</documentType>
  <periodOfReport>2026-10-28</periodOfReport>
  <aff10b5One>1</aff10b5One>
  <issuer><issuerCik>0000000001</issuerCik><issuerName>Test Issuer Corp</issuerName><issuerTradingSymbol>tstx</issuerTradingSymbol></issuer>
  <reportingOwner>
    <reportingOwnerId><rptOwnerCik>0000000002</rptOwnerCik><rptOwnerName>Doe Jane</rptOwnerName></reportingOwnerId>
    <reportingOwnerRelationship><isDirector>1</isDirector><isOfficer>true</isOfficer><officerTitle>Chief Executive Officer</officerTitle></reportingOwnerRelationship>
  </reportingOwner>
  <nonDerivativeTable>
    <nonDerivativeTransaction>
      <securityTitle><value>Common Stock</value></securityTitle>
      <transactionDate><value>2026-10-28</value></transactionDate>
      <transactionCoding><transactionFormType>4</transactionFormType><transactionCode>P</transactionCode></transactionCoding>
      <transactionAmounts>
        <transactionShares><value>1000</value></transactionShares>
        <transactionPricePerShare><value>12.345</value></transactionPricePerShare>
        <transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode>
      </transactionAmounts>
      <postTransactionAmounts><sharesOwnedFollowingTransaction><value>5000</value></sharesOwnedFollowingTransaction></postTransactionAmounts>
      <ownershipNature><directOrIndirectOwnership><value>D</value></directOrIndirectOwnership></ownershipNature>
    </nonDerivativeTransaction>
    <nonDerivativeTransaction>
      <securityTitle><value>Common Stock</value></securityTitle>
      <transactionDate><value>2026-10-28</value></transactionDate>
      <transactionCoding><transactionCode>M</transactionCode></transactionCoding>
      <transactionAmounts><transactionShares><value>200</value></transactionShares><transactionPricePerShare><value>1</value></transactionPricePerShare><transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode></transactionAmounts>
    </nonDerivativeTransaction>
    <nonDerivativeTransaction>
      <securityTitle><value>Common Stock</value></securityTitle>
      <transactionDate><value>2026-10-29</value></transactionDate>
      <transactionCoding><transactionCode>S</transactionCode></transactionCoding>
      <transactionAmounts><transactionShares><value>300</value></transactionShares><transactionPricePerShare><footnoteId id="F1"/></transactionPricePerShare><transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode></transactionAmounts>
    </nonDerivativeTransaction>
  </nonDerivativeTable>
</ownershipDocument>
</XML>
</TEXT>
</DOCUMENT>
</SEC-DOCUMENT>`;

test("parses header dates, issuer, owner and only P/S rows", () => {
  const r = parseForm4Submission(SYNTHETIC);
  assert.equal(r.accessionNo, "0000000000-26-000001");
  assert.equal(r.filingDate, "2026-10-30");
  assert.equal(r.acceptedAtET, "2026-10-30 17:30:12 ET");
  assert.equal(r.ticker, "TSTX");
  assert.equal(r.totalNonDerivative, 3);
  assert.deepEqual(r.transactions.map((t) => t.code), ["P", "S"]);

  const [p, s] = r.transactions;
  assert.equal(p.type, "Purchase");
  assert.equal(p.insiderName, "Doe Jane");
  assert.equal(p.role, "Chief Executive Officer · Director");
  assert.equal(p.shares, 1000);
  assert.equal(p.price, 12.345);
  assert.equal(p.value, 12345);
  assert.equal(p.transactionDate, "2026-10-28");
  assert.equal(p.filingDate, "2026-10-30");
  assert.equal(p.is10b5_1, true);
  assert.equal(p.filingUrl, "https://www.sec.gov/Archives/edgar/data/1/000000000026000001/0000000000-26-000001-index.htm");

  // Footnote-only price → no price, no computed value (never estimated).
  assert.equal(s.type, "Sale");
  assert.equal(s.price, null);
  assert.equal(s.value, null);
  assert.equal(s.transactionDate, "2026-10-29");
});

test("rejects submissions without an ownershipDocument", () => {
  assert.throws(() => parseForm4Submission("ACCESSION NUMBER: 0000000000-26-000002\n<XML><other/></XML>"), /ownershipDocument/);
  assert.throws(() => parseForm4Submission(""), /empty/);
});

test("role and URL helpers", () => {
  assert.equal(describeRole({ isTenPercentOwner: "1" }), "10% Owner");
  assert.equal(describeRole({}), "Not specified");
  assert.equal(filingIndexUrl("0000320193", "0000320193-26-000001"),
    "https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/0000320193-26-000001-index.htm");
});

// ── v2 parser: footnotes, ownership nature, missing prices, venue, remarks ──
// (all inputs below are SYNTHETIC variants of the fixture above)
const withRows = (rowsXml, { remarks = "", footnotes = "", officerTitle = "Chief Executive Officer", docType = "4" } = {}) =>
  SYNTHETIC
    .replace(/<nonDerivativeTable>[\s\S]*<\/nonDerivativeTable>/, `<nonDerivativeTable>${rowsXml}</nonDerivativeTable>`)
    .replace("<officerTitle>Chief Executive Officer</officerTitle>", `<officerTitle>${officerTitle}</officerTitle>`)
    .replace("<documentType>4</documentType>", `<documentType>${docType}</documentType>`)
    .replace("</ownershipDocument>", `<footnotes>${footnotes}</footnotes><remarks>${remarks}</remarks></ownershipDocument>`);

const row = ({ code = "P", shares = "<value>100</value>", price = "<value>10</value>", priceFn = "", after = "1000", own = "D", nature = "" }) => `
  <nonDerivativeTransaction>
    <securityTitle><value>Common Stock</value></securityTitle>
    <transactionDate><value>2026-10-28</value></transactionDate>
    <transactionCoding><transactionCode>${code}</transactionCode></transactionCoding>
    <transactionAmounts>
      <transactionShares>${shares}</transactionShares>
      <transactionPricePerShare>${price}${priceFn}</transactionPricePerShare>
      <transactionAcquiredDisposedCode><value>${code === "P" ? "A" : "D"}</value></transactionAcquiredDisposedCode>
    </transactionAmounts>
    <postTransactionAmounts><sharesOwnedFollowingTransaction><value>${after}</value></sharesOwnedFollowingTransaction></postTransactionAmounts>
    <ownershipNature><directOrIndirectOwnership><value>${own}</value></directOrIndirectOwnership>${nature ? `<natureOfOwnership><value>${nature}</value></natureOfOwnership>` : ""}</ownershipNature>
  </nonDerivativeTransaction>`;

test("multiple P/S rows per filing are all kept with unique ids, in document order", () => {
  const r = parseForm4Submission(withRows(row({ shares: "<value>10</value>" }) + row({ code: "S", shares: "<value>20</value>" }) + row({ shares: "<value>30</value>" })));
  assert.deepEqual(r.transactions.map((t) => [t.code, t.shares]), [["P", 10], ["S", 20], ["P", 30]]);
  assert.equal(new Set(r.transactions.map((t) => t.id)).size, 3);
});

test("missing price fields → price and value are null (never estimated)", () => {
  const r = parseForm4Submission(withRows(
    row({ price: "", priceFn: '<footnoteId id="F1"/>' }) +   // footnote only
    row({ price: "<value></value>" }) +                       // empty value
    row({ price: "<value>0</value>" }) +                      // zero
    row({ shares: "", price: "<value>12.5</value>" }),       // missing shares
    { footnotes: '<footnote id="F1">Price not determinable.</footnote>' }));
  assert.equal(r.transactions.length, 4);
  for (const t of r.transactions) assert.equal(t.value, null);
  assert.deepEqual(r.transactions.map((t) => t.price), [null, null, null, 12.5]);
  assert.equal(r.transactions[0].footnotes[0].text, "Price not determinable.");
});

test("footnotes and nature of ownership are attached to their row", () => {
  const r = parseForm4Submission(withRows(
    row({ own: "I", nature: "By Family Trust", priceFn: '<footnoteId id="F1"/><footnoteId id="F2"/>' }),
    { footnotes: '<footnote id="F1">First note.</footnote><footnote id="F2">Second &amp; last.</footnote>' }));
  const t = r.transactions[0];
  assert.equal(t.ownership, "I");
  assert.equal(t.natureOfOwnership, "By Family Trust");
  assert.deepEqual(t.footnotes, [{ id: "F1", text: "First note." }, { id: "F2", text: "Second & last." }]);
});

test("purchase context is classified only from filing text", () => {
  const ctx = (note) => parseForm4Submission(withRows(row({ priceFn: '<footnoteId id="F1"/>' }),
    { footnotes: `<footnote id="F1">${note}</footnote>` })).transactions[0];
  const om = ctx("The price reported is a weighted average price. These shares were purchased in multiple transactions at prices ranging from $9.90 to $10.10.");
  assert.equal(om.purchaseContext, "open_market");
  assert.match(om.purchaseContextEvidence, /weighted average/);
  assert.equal(ctx("Shares purchased in the private placement pursuant to a securities purchase agreement.").purchaseContext, "offering_or_private");
  assert.equal(ctx("Purchased in the underwritten public offering.").purchaseContext, "offering_or_private");
  const none = ctx("The shares are directly held by Example Fund, L.P.");
  assert.equal(none.purchaseContext, "unspecified");
  assert.equal(none.purchaseContextEvidence, null);
  // Sales carry no purchase context.
  assert.equal(parseForm4Submission(withRows(row({ code: "S" }))).transactions[0].purchaseContext, null);
});

test('"See Remarks" officer title is replaced by the remarks text', () => {
  const r = parseForm4Submission(withRows(row({}), { officerTitle: "See Remarks", remarks: "Executive Vice President and Chief Financial Officer" }));
  assert.equal(r.transactions[0].role, "Executive Vice President and Chief Financial Officer · Director");
});

test("documents that are not Form 4 / 4/A are rejected", () => {
  assert.throws(() => parseForm4Submission(withRows(row({}), { docType: "3" })), /not a Form 4/);
  assert.equal(parseForm4Submission(withRows(row({}), { docType: "4/A" })).formType, "4/A");
});
