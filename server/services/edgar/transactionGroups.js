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
import { isSuperseded } from "./amendments.js";

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

// DIRECT HOLDER(S) a filing itself names in its ownership footnotes / nature / remarks, e.g.
//   "The securities are held directly by SR One Capital Fund II Aggregator, LP …"
//   "… New Enterprise Associates 17, L.P. ("NEA 17"), the direct beneficial owner of the securities"
// → normalized entity names ("new enterprise associates 17 lp"). Only names ending in an entity
// suffix are taken (LP / LLC / Ltd / Limited / Inc / Trust) — vague text ("certain affiliated
// funds") yields nothing, so no link is ever inferred from it.
const FORWARD_CUES = [["held", "directly", "by"], ["directly", "held", "by"], ["held", "of", "record", "by"], ["owned", "directly", "by"], ["directly", "owned", "by"], ["held", "by"]];
const BACKWARD_CUES = [["the", "direct", "beneficial", "owner"], ["the", "direct", "owner"], ["the", "record", "holder"], ["the", "record", "owner"]];
const STOP = new Set(["of", "by", "is", "the", "and", "a", "an", "which", "that", "partner", "general", "sole", "manager", "member", "managing", "as", "to", "in", "for", "are", "were", "be", "its", "each"]);
function suffixAt(t, i) { // → number of tokens of an entity suffix starting at i (0 = none)
  if (["lp", "llc", "ltd", "limited", "inc", "trust", "llp"].includes(t[i])) return 1;
  if (t[i] === "l" && t[i + 1] === "p") return 2;
  if (t[i] === "l" && t[i + 1] === "l" && (t[i + 2] === "c" || t[i + 2] === "p")) return 3;
  return 0;
}
const canonicalEntity = (toks) => toks.join(" ").replace(/\bl l c\b/g, "llc").replace(/\bl l p\b/g, "llp").replace(/\bl p\b/g, "lp");
const matchAt = (t, i, cue) => cue.every((w, k) => t[i + k] === w);
// Vague descriptions never identify a holder ("certain affiliated funds managed by …").
const VAGUE = new Set(["certain", "affiliated", "affiliates", "various", "managed", "advised", "funds", "accounts", "entities", "vehicles", "one", "more", "their", "its", "his", "her", "such"]);
const holderName = (toks) => { const x = toks[0] === "the" ? toks.slice(1) : toks; return x.some((w) => VAGUE.has(w)) ? null : canonicalEntity(x); };
export function directHolders(row) {
  const t = evidenceText(row).trim().split(" ").filter(Boolean);
  const out = new Set();
  for (let i = 0; i < t.length; i++) {
    for (const cue of FORWARD_CUES) {
      if (!matchAt(t, i, cue)) continue;
      if (t[i - 1] === "indirectly") break; // "indirectly held by X" names an indirect holder
      const start = i + cue.length;
      for (let j = start; j < Math.min(t.length, start + 12); j++) {
        const n = suffixAt(t, j);
        if (n) { const h = j > start ? holderName(t.slice(start, j + n)) : null; if (h) out.add(h); break; }
      }
      break;
    }
    for (const cue of BACKWARD_CUES) {
      if (!matchAt(t, i, cue)) continue;
      // nearest entity suffix within 6 tokens before the cue (an alias may sit in between)
      for (let j = i - 1; j >= Math.max(0, i - 6); j--) {
        const n = [3, 2, 1].find((len) => j - len + 1 >= 0 && suffixAt(t, j - len + 1) === len);
        if (!n) continue;
        const end = j + 1, sufStart = j - n + 1;
        let s = sufStart;
        while (s > 0 && sufStart - s < 8 && !STOP.has(t[s - 1])) s--;
        const h = s < sufStart ? holderName(t.slice(s, end)) : null;
        if (h) out.add(h);
        break;
      }
    }
  }
  return [...out].filter((x) => x.replace(/ (lp|llc|llp|ltd|limited|inc|trust)$/, "").length >= 3);
}
function sharedDirectHolder(a, b) {
  const ha = directHolders(a), hb = new Set(directHolders(b));
  return ha.find((h) => hb.has(h)) || null;
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
  // Same holding reported by several related persons (e.g. each manager of a fund files
  // separately): only with an identical candidate key (this function is only called within a
  // key bucket: date, security, shares, price AND shares owned after), BOTH indirect, and both
  // filings' own footnotes naming the same direct holder. A shared entity name alone is never
  // enough; same-filing rows are never merged (above).
  const holder = !aRefB && !bRefA && !cik && a.ownership === "I" && b.ownership === "I" ? sharedDirectHolder(a, b) : null;
  if (holder) evidence.push(`both filings name "${holder}" as the direct holder of the same shares (identical date, shares, price and holdings after)`);
  if (!aRefB && !bRefA && !cik && !holder) missing.push("no reporting-relationship evidence between the filings");

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
    // Rows superseded by an amendment are kept as-is and never grouped.
    const key = isSuperseded(r) ? null : candidateKey(r);
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
// Rows superseded by a Form 4/A are excluded entirely (the amendment counts).
export function computeTotals(economicRows) {
  const t = { count: 0, purchases: 0, sales: 0, purchaseValue: 0, saleValue: 0, valueMissing: 0, confirmedGroups: 0, needsReview: 0, priceAnomalies: 0, anomalyValueExcluded: 0, supersededByAmendment: 0, amendmentsFlagged: 0, lateFilings: 0 };
  for (const r of economicRows) {
    if (isSuperseded(r)) { t.supersededByAmendment++; continue; }
    t.count++;
    if (r.filingDelay?.late) t.lateFilings++;
    if (["original_not_held", "ambiguous", "unlinked"].includes(r.amendment?.status)) t.amendmentsFlagged++;
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
