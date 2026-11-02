// server/services/edgar/amendments.js
//
// Form 4/A handling — prevents double counting when an amendment restates a
// filing we already hold, while keeping every original row and an audit trail.
//
// Linking (all must hold, else nothing is superseded):
//   amendment.issuerCik == original.issuerCik
//   amendment and original share at least one reporting-owner CIK
//   amendment.dateOfOriginalSubmission == original filing date
//                                       (FILED AS OF DATE or SEC acceptance date)
//   exactly one such original Form 4 is held
//
// Rule 12b-15: an amendment sets forth the complete text of each item amended.
// So when the LATEST amendment of an original contains a non-derivative table
// (Table I) — even one with no transactions, only holdings — that table replaces
// the original's: the original's P/S rows, and those of any earlier amendment,
// are marked superseded (kept, but excluded from totals and alerts). Real case:
// USCB 0001437749-26-034103 retracts a purchase that "did not in fact occur" with
// a Table I holding only. An amendment without Table I amends other items only
// and supersedes nothing.
//
// Row annotation `amendment` (absent on rows unrelated to any amendment):
//   superseded           { status, supersededBy, amendmentFiledAt }
//   amends               { status, original, originalSubmissionDate }
//   original_not_held    { status, originalSubmissionDate }   counted, flagged
//   ambiguous            { status, candidates }               counted, flagged
//   unlinked             { status }  no original submission date in the 4/A
//   amended_other_items  { status, amendedBy }  original kept: 4/A has no Table I

const sameCik = (a, b) => a && b && Number(a) === Number(b);
const acceptedDay = (et) => (et ? String(et).slice(0, 10) : null);

// amendmentFilings: [{ accessionNo, issuerCik, ownerCiks, originalSubmissionDate, hasNonDerivativeTable, totalNonDerivative, acceptedAtET, filingDate }]
// rows: transaction rows (any formType). Returns NEW row objects; input untouched.
export function applyAmendments(rows, amendmentFilings = []) {
  if (!amendmentFilings.length) return rows;

  // Original Form 4 filings, from their rows.
  const originals = new Map();
  for (const r of rows) {
    if (r.formType !== "4") continue;
    let o = originals.get(r.accessionNo);
    if (!o) {
      o = { accessionNo: r.accessionNo, issuerCik: r.issuerCik, ownerCiks: new Set(), filingDate: r.filingDate, acceptedDay: acceptedDay(r.acceptedAtET) };
      originals.set(r.accessionNo, o);
    }
    for (const ow of r.owners || []) if (ow.cik) o.ownerCiks.add(Number(ow.cik));
  }

  const notes = new Map(); // accessionNo → annotation for all its rows
  const byOriginal = new Map(); // original accession → [amendment filings]

  for (const a of amendmentFilings) {
    if (!a.originalSubmissionDate) { notes.set(a.accessionNo, { status: "unlinked" }); continue; }
    const owners = new Set((a.ownerCiks || []).map(Number));
    const matches = [...originals.values()].filter((o) =>
      sameCik(o.issuerCik, a.issuerCik) &&
      [...o.ownerCiks].some((c) => owners.has(c)) &&
      (o.filingDate === a.originalSubmissionDate || o.acceptedDay === a.originalSubmissionDate));
    if (matches.length === 0) {
      notes.set(a.accessionNo, { status: "original_not_held", originalSubmissionDate: a.originalSubmissionDate });
    } else if (matches.length > 1) {
      notes.set(a.accessionNo, { status: "ambiguous", originalSubmissionDate: a.originalSubmissionDate, candidates: matches.map((m) => m.accessionNo).sort() });
    } else {
      const key = matches[0].accessionNo;
      (byOriginal.get(key) || byOriginal.set(key, []).get(key)).push(a);
    }
  }

  for (const [origAcc, amends] of byOriginal) {
    // Latest amendment wins (acceptance time, then accession number).
    amends.sort((x, y) => (x.acceptedAtET || "").localeCompare(y.acceptedAtET || "") || x.accessionNo.localeCompare(y.accessionNo));
    const latest = amends[amends.length - 1];
    // Records parsed before hasNonDerivativeTable existed fall back to the row count.
    const tableRestated = latest.hasNonDerivativeTable ?? latest.totalNonDerivative > 0;
    if (!tableRestated) {
      // Table I not restated: the original's transactions stand.
      notes.set(origAcc, { status: "amended_other_items", amendedBy: latest.accessionNo });
      for (const a of amends) notes.set(a.accessionNo, { status: "amends", original: origAcc, originalSubmissionDate: a.originalSubmissionDate, tableRestated: false });
      continue;
    }
    const superseded = { status: "superseded", supersededBy: latest.accessionNo, amendmentFiledAt: latest.acceptedAtET || latest.filingDate || null };
    notes.set(origAcc, superseded);
    for (const a of amends) {
      notes.set(a.accessionNo, a === latest
        ? { status: "amends", original: origAcc, originalSubmissionDate: a.originalSubmissionDate, tableRestated: true }
        : superseded);
    }
  }

  return rows.map((r) => (notes.has(r.accessionNo) ? { ...r, amendment: notes.get(r.accessionNo) } : r));
}

export const isSuperseded = (t) => t?.amendment?.status === "superseded";
