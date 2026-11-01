// server/services/edgar/transactionGroups.js
//
// Conservative economic-transaction de-duplication.
//
// Related filers (e.g. a trust and its manager) can each file a Form 4 for the
// SAME economic transaction. Rows are merged only when ALL of these hold:
//   1. Candidate key: different accession numbers, and identical issuer CIK,
//      transaction code, trade date, security title, shares, price and
//      shares owned after the transaction.
//   2. Relationship evidence: one row's ownership nature / footnotes / remarks
//      names a reporting owner of the other filing, or both filings share a
//      reporting-owner CIK.
//   3. Ownership consistency: at least one row is Indirect (two Direct holders
//      cannot hold the same shares).
// Rows from the same filing are never merged. Candidate-key matches without
// evidence stay separate and are flagged "needs_review".
// Original rows are never mutated or dropped: every filing stays in reportedBy.

import crypto from "node:crypto";

const normalize = (s) =>
  String(s || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();

// Form 4 owner names are usually "Last First"; footnotes often say "First Last".
function nameVariants(name) {
  const n = normalize(name);
  if (!n) return [];
  const toks = n.split(" ");
  const variants = [n];
  if (toks.length >= 2 && toks.length <= 4) variants.push([...toks.slice(1), toks[0]].join(" "));
  // Too-short names ("smith j") would match unrelated text — require ≥ 2 words and ≥ 6 chars.
  return variants.filter((v) => v.length >= 6 && v.split(" ").length >= 2);
}

function evidenceText(row) {
  return ` ${normalize([row.natureOfOwnership, ...(row.footnotes || []).map((f) => f.text), row.remarks].filter(Boolean).join(" "))} `;
}

// Name of an owner of `other` that `row`'s own text refers to, or null.
function referencedOwner(row, other) {
  const hay = evidenceText(row);
  for (const o of other.owners || []) {
    if (nameVariants(o.name).some((v) => hay.includes(` ${v} `))) return o.name;
  }
  return null;
}

function sharedOwnerCik(a, b) {
  const ciks = new Set((a.owners || []).map((o) => o.cik).filter(Boolean));
  return (b.owners || []).find((o) => o.cik && ciks.has(o.cik))?.cik || null;
}

export function candidateKey(t) {
  if (t.shares == null || t.sharesOwnedAfter == null || !t.transactionDate || !t.issuerCik) return null;
  return [Number(t.issuerCik), t.code, t.transactionDate, normalize(t.securityTitle), t.shares, t.price ?? "noprice", t.sharesOwnedAfter].join("|");
}

const keyHash = (key) => crypto.createHash("sha1").update(key).digest("hex").slice(0, 16);

// → { confirmed: boolean, evidence: string[], missing: string[] }
export function pairEvidence(a, b) {
  if (a.accessionNo === b.accessionNo) return { confirmed: false, evidence: [], missing: ["same filing — never merged"] };
  const evidence = [];
  const missing = [];

  const aRefB = referencedOwner(a, b);
  const bRefA = referencedOwner(b, a);
  const cik = sharedOwnerCik(a, b);
  if (aRefB) evidence.push(`${a.accessionNo} names "${aRefB}", a reporting owner of ${b.accessionNo}`);
  if (bRefA) evidence.push(`${b.accessionNo} names "${bRefA}", a reporting owner of ${a.accessionNo}`);
  if (cik) evidence.push(`both filings list reporting owner CIK ${cik}`);
  if (!aRefB && !bRefA && !cik) missing.push("no reporting-relationship evidence between the filings");

  const ownershipOk = (a.ownership === "I" || b.ownership === "I") && !!a.ownership && !!b.ownership;
  if (ownershipOk) evidence.push(`ownership ${a.ownership} (${a.accessionNo}) + ${b.ownership} (${b.accessionNo})`);
  else missing.push(`ownership ${a.ownership || "?"} + ${b.ownership || "?"}: no indirect holder`);

  return { confirmed: missing.length === 0, evidence, missing };
}

function pickPrimary(rows) {
  const score = (r) => {
    const o = r.owners?.[0] || {};
    return (o.isOfficer || o.isDirector ? 2 : 0) + (r.ownership === "D" ? 1 : 0);
  };
  return [...rows].sort((a, b) => score(b) - score(a) || a.accessionNo.localeCompare(b.accessionNo) || a.id.localeCompare(b.id))[0];
}

const reporterOf = (r) => ({
  rowId: r.id,
  insiderName: r.insiderName,
  role: r.role,
  ownership: r.ownership,
  natureOfOwnership: r.natureOfOwnership,
  accessionNo: r.accessionNo,
  formType: r.formType,
  filingDate: r.filingDate,
  filingUrl: r.filingUrl,
});

// A group is anomalous if ANY of its filings is (all report the same price).
function mergePriceChecks(members) {
  const checks = members.map((m) => m.priceCheck).filter(Boolean);
  const anomalous = checks.filter((c) => c.status === "anomaly");
  if (anomalous.length) {
    const seen = new Set();
    const reasons = anomalous.flatMap((c) => c.reasons).filter((r) => !seen.has(r.detail) && seen.add(r.detail));
    return { ...anomalous[0], reasons };
  }
  return checks.find((c) => c.status === "missing_price") || checks[0];
}

// rows: raw parsed transactions → economic transactions (one per real-world trade)
export function groupTransactions(rows) {
  const buckets = new Map();
  const singles = [];
  for (const r of rows) {
    const key = candidateKey(r);
    if (!key) { singles.push({ r, key: null }); continue; }
    (buckets.get(key) || buckets.set(key, []).get(key)).push(r);
  }

  const out = [];
  const emit = (members, key, dedupe) => {
    const primary = pickPrimary(members);
    out.push({
      ...primary,
      economicId: key ? `econ_${keyHash(key)}${dedupe.status === "needs_review" ? `_${primary.accessionNo.replace(/-/g, "")}` : ""}` : `row_${primary.id}`,
      reportedBy: [primary, ...members.filter((m) => m !== primary)].map(reporterOf),
      dedupe,
      ...(members.some((m) => m.priceCheck) ? { priceCheck: mergePriceChecks(members) } : {}),
    });
  };

  for (const { r } of singles) emit([r], null, { status: "single", evidence: [], possibleDuplicateOf: [] });

  for (const [key, members] of buckets) {
    // Union-find over confirmed pairs; a component may never hold two rows of one filing.
    const comp = new Map(members.map((m) => [m.id, { rows: [m], evidence: [] }]));
    const find = (id) => comp.get(id);
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const ca = find(members[i].id), cb = find(members[j].id);
        if (ca === cb) continue;
        const accs = new Set(ca.rows.map((x) => x.accessionNo));
        if (cb.rows.some((x) => accs.has(x.accessionNo))) continue;
        const ev = pairEvidence(members[i], members[j]);
        if (!ev.confirmed) continue;
        ca.rows.push(...cb.rows);
        ca.evidence.push(...cb.evidence, ...ev.evidence);
        for (const [id, c] of comp) if (c === cb) comp.set(id, ca);
      }
    }

    for (const c of new Set(comp.values())) {
      const others = members.filter((m) => !c.rows.includes(m) && !c.rows.some((x) => x.accessionNo === m.accessionNo));
      if (c.rows.length > 1) {
        emit(c.rows, key, { status: "confirmed", evidence: [...new Set(c.evidence)], possibleDuplicateOf: others.map((o) => o.id) });
      } else if (others.length) {
        const reasons = others.map((o) => pairEvidence(c.rows[0], o).missing.join("; "));
        emit(c.rows, key, { status: "needs_review", evidence: [], possibleDuplicateOf: others.map((o) => o.id), reason: [...new Set(reasons)].join(" | ") });
      } else {
        emit(c.rows, key, { status: "single", evidence: [], possibleDuplicateOf: [] });
      }
    }
  }
  return out;
}

// Totals over ECONOMIC transactions — each confirmed group counted once.
// Price anomalies stay in the counts but are excluded from monetary totals.
export function computeTotals(economicRows) {
  const t = { count: economicRows.length, purchases: 0, sales: 0, purchaseValue: 0, saleValue: 0, valueMissing: 0, confirmedGroups: 0, needsReview: 0, priceAnomalies: 0, anomalyValueExcluded: 0 };
  for (const r of economicRows) {
    if (r.code === "P") t.purchases++;
    if (r.code === "S") t.sales++;
    if (r.priceCheck?.status === "anomaly") { t.priceAnomalies++; t.anomalyValueExcluded += r.value || 0; }
    else if (r.value == null) t.valueMissing++;
    else if (r.code === "P") t.purchaseValue += r.value;
    else if (r.code === "S") t.saleValue += r.value;
    if (r.dedupe?.status === "confirmed") t.confirmedGroups++;
    if (r.dedupe?.status === "needs_review") t.needsReview++;
  }
  t.purchaseValue = Math.round(t.purchaseValue * 100) / 100;
  t.saleValue = Math.round(t.saleValue * 100) / 100;
  t.anomalyValueExcluded = Math.round(t.anomalyValueExcluded * 100) / 100;
  return t;
}
