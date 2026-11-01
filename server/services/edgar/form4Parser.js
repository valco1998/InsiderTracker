// server/services/edgar/form4Parser.js
//
// Parses an EDGAR Form 4 full submission (.txt) into normalized records.
// The .txt contains the SEC header (FILED AS OF DATE, ACCEPTANCE-DATETIME)
// and the ownershipDocument XML. Pure functions — no I/O.
//
// Only non-derivative purchases (P) and sales (S) are returned.
// Values come exclusively from the filing; nothing is estimated.

import { XMLParser } from "fast-xml-parser";

// Bump when the parsed record shape changes; cached filings with an older
// version are re-fetched and re-parsed by insiderIngest.js.
export const PARSER_VERSION = 3;

const ARRAY_TAGS = new Set(["reportingOwner", "nonDerivativeTransaction", "derivativeTransaction", "footnote", "footnoteId"]);

const xml = new XMLParser({
  ignoreAttributes: false, // footnoteId id="F1" / footnote id="F1"
  attributeNamePrefix: "@_",
  parseTagValue: false,    // keep CIKs, tickers and numbers as exact strings
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name) => ARRAY_TAGS.has(name),
});

export const TRACKED_CODES = { P: "Purchase", S: "Sale" };
export const FORM4_TYPES = new Set(["4", "4/A"]);

const val = (node) => {
  if (node == null) return undefined;
  if (typeof node === "object") return node.value != null && typeof node.value !== "object" ? String(node.value) : undefined;
  return String(node);
};
const text = (node) => {
  if (node == null) return "";
  if (typeof node === "object") return String(node["#text"] ?? "").trim();
  return String(node).trim();
};
const bool = (node) => {
  const v = val(node);
  return v === "1" || (v || "").toLowerCase() === "true";
};
const num = (node) => {
  const v = val(node);
  if (v == null || v === "") return null;
  const n = Number(v.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};
const isoDate = (s) => (/^\d{4}-\d{2}-\d{2}/.test(s || "") ? s.slice(0, 10) : null);

// Every footnoteId referenced anywhere inside a transaction row, in document order.
function collectFootnoteIds(node, out = []) {
  if (!node || typeof node !== "object") return out;
  for (const [k, v] of Object.entries(node)) {
    if (k === "footnoteId") for (const f of v) { if (f?.["@_id"] && !out.includes(f["@_id"])) out.push(f["@_id"]); }
    else if (typeof v === "object") collectFootnoteIds(v, out);
  }
  return out;
}

function headerField(txt, name) {
  const m = txt.match(new RegExp(`^\\s*${name}:\\s*(.+)$`, "m"));
  return m ? m[1].trim() : null;
}

// "20261030" → "2026-10-30"
const compactToIso = (s) => (/^\d{8}$/.test(s || "") ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null);

export function accessionDigits(accessionNo) {
  return accessionNo.replace(/-/g, "");
}

export function filingIndexUrl(cik, accessionNo) {
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accessionDigits(accessionNo)}/${accessionNo}-index.htm`;
}

// Officer titles like "See Remarks" defer to the filing's remarks section.
export function describeRole(rel = {}, remarks = "") {
  const roles = [];
  if (bool(rel.isOfficer)) {
    const title = val(rel.officerTitle) || "Officer";
    roles.push(/^see remarks?\.?$/i.test(title) && remarks ? remarks.slice(0, 120) : title);
  }
  if (bool(rel.isDirector)) roles.push("Director");
  if (bool(rel.isTenPercentOwner)) roles.push("10% Owner");
  if (bool(rel.isOther)) {
    const other = val(rel.otherText) || "Other";
    roles.push(/^see remarks?\.?$/i.test(other) && remarks ? remarks.slice(0, 120) : other);
  }
  return roles.join(" · ") || "Not specified";
}

// Purchase venue, only from what the filing text states.
const OFFERING_RE = /private placement|\bPIPE\b|securities purchase agreement|subscription agreement|registered direct|underwritten (public )?offering|public offering|initial public offering|\bIPO\b|directly from the issuer|purchased from the issuer/i;
const OPEN_MARKET_RE = /open[- ]market|weighted[- ]average (purchase |sale )?price|multiple transactions at prices ranging/i;

export function classifyPurchaseContext(footnoteTexts, remarks = "") {
  const sources = [...footnoteTexts, remarks].filter(Boolean);
  const offering = sources.find((t) => OFFERING_RE.test(t));
  if (offering) return { context: "offering_or_private", evidence: offering.slice(0, 280) };
  const market = sources.find((t) => OPEN_MARKET_RE.test(t));
  if (market) return { context: "open_market", evidence: market.slice(0, 280) };
  return { context: "unspecified", evidence: null };
}

export function parseForm4Submission(txt, { accessionNo: expectedAccession } = {}) {
  if (typeof txt !== "string" || !txt.length) throw new Error("empty submission");

  const accessionNo = headerField(txt, "ACCESSION NUMBER") || expectedAccession;
  if (!accessionNo || !/^\d{10}-\d{2}-\d{6}$/.test(accessionNo)) throw new Error("missing accession number");

  const filingDate = compactToIso(headerField(txt, "FILED AS OF DATE"));
  const acceptance = (txt.match(/<ACCEPTANCE-DATETIME>(\d{14})/) || [])[1] || null;
  // EDGAR acceptance timestamps are US Eastern time.
  const acceptedAtET = acceptance
    ? `${compactToIso(acceptance.slice(0, 8))} ${acceptance.slice(8, 10)}:${acceptance.slice(10, 12)}:${acceptance.slice(12, 14)} ET`
    : null;

  const xmlMatch = txt.match(/<XML>([\s\S]*?)<\/XML>/i);
  if (!xmlMatch || !/<ownershipDocument/i.test(xmlMatch[1])) throw new Error("no ownershipDocument XML");
  const doc = xml.parse(xmlMatch[1].trim()).ownershipDocument;
  if (!doc) throw new Error("ownershipDocument not parsed");

  const formType = val(doc.documentType) || headerField(txt, "CONFORMED SUBMISSION TYPE");
  if (!FORM4_TYPES.has(formType)) throw new Error(`not a Form 4 (documentType=${formType})`);

  const issuer = doc.issuer || {};
  const issuerCik = val(issuer.issuerCik);
  const issuerName = val(issuer.issuerName) || null;
  const ticker = (val(issuer.issuerTradingSymbol) || "").toUpperCase().trim() || null;
  const is10b5_1 = doc.aff10b5One != null ? bool(doc.aff10b5One) : null;
  const remarks = text(doc.remarks);

  const footnotes = {};
  for (const f of doc.footnotes?.footnote || []) if (f?.["@_id"]) footnotes[f["@_id"]] = text(f).replace(/\s+/g, " ");

  const owners = (doc.reportingOwner || []).map((o) => ({
    cik: val(o.reportingOwnerId?.rptOwnerCik) || null,
    name: val(o.reportingOwnerId?.rptOwnerName) || null,
    role: describeRole(o.reportingOwnerRelationship, remarks),
    isDirector: bool(o.reportingOwnerRelationship?.isDirector),
    isOfficer: bool(o.reportingOwnerRelationship?.isOfficer),
    isTenPercentOwner: bool(o.reportingOwnerRelationship?.isTenPercentOwner),
  }));
  const insiderName = owners.map((o) => o.name).filter(Boolean).join("; ") || null;
  const role = [...new Set(owners.map((o) => o.role))].join("; ") || "Not specified";

  const filingUrl = issuerCik ? filingIndexUrl(issuerCik, accessionNo) : null;

  const rows = doc.nonDerivativeTable?.nonDerivativeTransaction || [];
  const transactions = [];
  rows.forEach((t, i) => {
    const code = val(t.transactionCoding?.transactionCode);
    if (!TRACKED_CODES[code]) return;
    const shares = num(t.transactionAmounts?.transactionShares);
    const price = num(t.transactionAmounts?.transactionPricePerShare);
    const footnoteIds = collectFootnoteIds(t);
    const rowFootnotes = footnoteIds.map((id) => footnotes[id]).filter(Boolean);
    const purchase = code === "P" ? classifyPurchaseContext(rowFootnotes, remarks) : null;
    transactions.push({
      id: `${accessionNo}:${i}`,
      accessionNo,
      formType,
      issuerCik,
      issuerName,
      ticker,
      insiderName,
      insiderCik: owners[0]?.cik || null,
      role,
      owners,
      code,
      type: TRACKED_CODES[code],
      securityTitle: val(t.securityTitle) || null,
      shares,
      price: price && price > 0 ? price : null,
      // Reported value = shares × reported price. Null when the filing gives no price.
      value: shares && price && price > 0 ? Math.round(shares * price * 100) / 100 : null,
      // Exact strings as filed with the SEC — kept for auditing, never modified.
      reported: {
        shares: val(t.transactionAmounts?.transactionShares) ?? null,
        pricePerShare: val(t.transactionAmounts?.transactionPricePerShare) ?? null,
        sharesOwnedAfter: val(t.postTransactionAmounts?.sharesOwnedFollowingTransaction) ?? null,
      },
      acquiredDisposed: val(t.transactionAmounts?.transactionAcquiredDisposedCode) || null,
      sharesOwnedAfter: num(t.postTransactionAmounts?.sharesOwnedFollowingTransaction),
      ownership: val(t.ownershipNature?.directOrIndirectOwnership) || null,
      natureOfOwnership: val(t.ownershipNature?.natureOfOwnership) || null,
      footnotes: footnoteIds.filter((id) => footnotes[id]).map((id) => ({ id, text: footnotes[id] })),
      remarks: remarks || null,
      purchaseContext: purchase?.context ?? null,
      purchaseContextEvidence: purchase?.evidence ?? null,
      is10b5_1,
      transactionDate: isoDate(val(t.transactionDate)),
      filingDate,
      acceptedAtET,
      filingUrl,
    });
  });

  return {
    accessionNo, formType, issuerCik, issuerName, ticker, filingDate, acceptedAtET, filingUrl,
    totalNonDerivative: rows.length,
    transactions,
  };
}
