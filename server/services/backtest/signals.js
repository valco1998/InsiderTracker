// server/services/backtest/signals.js
//
// Point-in-time insider cluster-buying signals (no lookahead).
//
// Input: ECONOMIC rows from the snapshot pipeline (insiderSnapshot.buildSnapshot)
// over the historical Form 4 store — confirmed duplicate reports already merged
// (every report kept in `reportedBy`), Form 4/A links annotated (amendments.js).
//
// What the public knew at time T (an SEC acceptance timestamp, ET):
//   • a row is KNOWN from the earliest SEC acceptance among the filings that
//     reported it (duplicates by related filers: the first report);
//   • a row superseded by a Form 4/A stops counting at the amendment's acceptance
//     (`amendment.amendmentFiledAt`); the amendment's own rows count from then;
//   • joint-filer identities are rebuilt from rows known at T only;
//   • the peer-price outlier check uses only peers known at T; the other price
//     checks are intrinsic to the filing itself;
//   • values are the Form 4 U.S.-dollar amounts (shares × reported price);
//     prices whose currency cannot be verified as USD are excluded (currency.js).
// A signal can therefore only be produced at the acceptance time of a filing,
// using filings accepted at or before it.
//
// Signal rule — every threshold is the USER's choice (DEFAULTS are only the form's
// starting values, never global rules): at least minBuyers DISTINCT reporting owners
// (SEC CIK; joint filers = one) with Form 4 code P purchases whose TRADE dates fall in
// one rolling windowDays calendar-day window, with a combined reliable purchase value
// of AT LEAST minValueUsd across all buyers. Purchases without a reliable USD value
// (price anomaly, missing price, unverified currency) still count as buyers but add
// nothing to the sum. Trade dates are used ONLY to group purchases; the signal is
// dated at the SEC acceptance that first satisfied the rule.
// Late filings count by default. Two OPTIONAL filters, both off unless the user sets them:
//   maxFilingDelayDays  per purchase: calendar days from its trade date to the SEC
//                       acceptance that made it public; later-filed purchases are ignored.
//   maxSignalLagDays    per cluster: the window's latest trade date must be within this
//                       many calendar days of the publication date.
//
// Overlap rule: once an issuer signals, that cluster stays open while purchases
// continue — every purchase with a trade date within WINDOW_DAYS after the
// cluster's latest purchase is absorbed and extends it. A new, independent signal
// for the same issuer needs a qualifying window made only of purchases dated
// after the open cluster's horizon (latest purchase + WINDOW_DAYS − 1).

import { buildIdentities, ownerRoleGroups } from "../edgar/insiderInsights.js";
import { peerKey, peerOutlierDetail } from "../edgar/priceAnomalies.js";
import { groupTransactions } from "../edgar/transactionGroups.js";

export const DEFAULTS = Object.freeze({
  minBuyers: 2,
  minValueUsd: 250_000,
  windowDays: 30,
  maxSignalLagDays: null,   // optional cluster staleness filter — off by default
  maxFilingDelayDays: null, // optional per-purchase filing-delay filter — off by default
  roles: [],
  openMarketOnly: false,
  minTransactionUsd: null,
});

export const BACKTEST_ROLES = ["CEO", "CFO", "COO", "CTO", "VP", "Director", "10% Owner", "Other officer", "Other"];

const COO_RE = /\b(chief operating officer|principal operating officer|coo)\b/i;
const CTO_RE = /\b(chief technology officer|cto)\b/i;
const VP_RE = /\b(vice[\s-]+president|vp|evp|svp|avp)\b/i;

// Disclosed role(s) of one reporting owner (a person can hold several).
export function ownerBacktestRoles(o = {}) {
  const base = ownerRoleGroups(o); // CEO, CFO, Director, Officer, 10% Owner, Other
  const text = String(o.role || "");
  const g = new Set();
  if (base.has("CEO")) g.add("CEO");
  if (base.has("CFO")) g.add("CFO");
  if (COO_RE.test(text)) g.add("COO");
  if (CTO_RE.test(text)) g.add("CTO");
  if (VP_RE.test(text)) g.add("VP");
  if (base.has("Director")) g.add("Director");
  if (base.has("10% Owner")) g.add("10% Owner");
  if (o.isOfficer && !["CEO", "CFO", "COO", "CTO", "VP"].some((r) => g.has(r))) g.add("Other officer");
  if (!g.size) g.add("Other");
  return g;
}

export function rowBacktestRoles(r) {
  const g = new Set();
  for (const o of r.owners?.length ? r.owners : [{ role: r.role }]) for (const x of ownerBacktestRoles(o)) g.add(x);
  if (g.size > 1) g.delete("Other");
  return BACKTEST_ROLES.filter((x) => g.has(x));
}

const DAY = 86_400_000;
const dayNum = (iso) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY);
const isoDay = (n) => new Date(n * DAY).toISOString().slice(0, 10);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const stampOf = (s) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? String(s).replace(/\s*ET$/, "") : null);
const round2 = (n) => Math.round(n * 100) / 100;

// Calendar days from a purchase's trade date to the SEC acceptance that made it public.
export function filingDelayDays(r, knownAt) {
  if (!DATE_RE.test(r.transactionDate || "") || !knownAt) return null;
  return Math.max(0, dayNum(knownAt.slice(0, 10)) - dayNum(r.transactionDate));
}

// One purchase as shown in a signal snapshot / later-purchase list (display data only).
function purchaseRecord(p) {
  const r = p.r;
  return {
    rowId: r.id, person: p.person, name: r.owners?.[0]?.name || r.insiderName || "Unknown", roles: p.roles || rowBacktestRoles(r),
    transactionDate: r.transactionDate, shares: r.shares ?? null, price: r.price ?? null,
    valueUsd: p.usd == null ? null : round2(p.usd), valueExcludedReason: p.usd == null ? p.unreliable || "missing_price" : null,
    accessionNo: r.accessionNo || null, url: r.filingUrl || null, publicAt: `${p.x.firstKnownAt ?? p.x.knownAt} ET`,
    filingDelayDays: p.delayDays ?? filingDelayDays(r, p.x.firstKnownAt ?? p.x.knownAt), late: !!r.filingDelay?.late,
    purchaseContext: r.purchaseContext || null,
    // Form 4/A: accession of the original it amends (a property of this filing itself, known
    // when it was public). A LATER amendment of this purchase is never recorded here — the
    // snapshot stays frozen; the timeline and hindsight show it.
    amends: r.amendment?.status === "amends" ? r.amendment.original || null : null,
    // Identical to another filing's purchase (same date, shares, price, holdings after) but
    // with no evidence linking the two: counted separately, flagged as a possible duplicate.
    possibleDuplicate: r.dedupe?.status === "needs_review",
  };
}

// Earliest public acceptance of an economic row (all its reports).
export function knownAtOf(row, acceptedAtByAccession) {
  let best = null;
  for (const rep of row.reportedBy?.length ? row.reportedBy : [row]) {
    const s = stampOf(acceptedAtByAccession.get(rep.accessionNo) ?? (rep === row ? row.acceptedAtET : null));
    if (s && (!best || s < best)) best = s;
  }
  return best ?? stampOf(row.acceptedAtET);
}

// Value reliability AT time `at`: intrinsic checks + peer check over peers known then.
function reliableUsd(row, knownPeers) {
  if (row.value == null || !(row.value > 0)) return { usd: null, reason: "missing_price" };
  const intrinsic = (row.priceCheck?.reasons || []).filter((r) => r.rule !== "peer_price_outlier");
  if (intrinsic.length) return { usd: null, reason: "price_anomaly" };
  if (peerOutlierDetail(row, knownPeers)) return { usd: null, reason: "price_anomaly" };
  return { usd: row.value, reason: null };
}

// Validates and fills a config. → { config } or { error }.
export function normalizeSignalConfig(c = {}) {
  const out = { ...DEFAULTS };
  const int = (v, lo, hi, name) => {
    if (v === undefined || v === null || v === "") return { ok: true };
    const n = Number(v);
    return Number.isInteger(n) && n >= lo && n <= hi ? { ok: true, n } : { error: `${name} must be an integer from ${lo} to ${hi}` };
  };
  // Bounds are input sanity only (no strategy limit): any positive buyer count, any window
  // up to 10 years. The two delay filters accept null / "" = off.
  for (const [k, lo, hi] of [["minBuyers", 1, 100_000], ["windowDays", 1, 3650], ["maxSignalLagDays", 0, 3650], ["maxFilingDelayDays", 0, 3650]]) {
    const r = int(c[k], lo, hi, k); if (r.error) return r; if (r.n !== undefined) out[k] = r.n;
  }
  // The strategy threshold is in U.S. dollars. A request still carrying the old ILS
  // field is refused rather than silently reinterpreted.
  if (c.minValueIls !== undefined) return { error: "minValueIls is no longer supported — the threshold is in U.S. dollars (minValueUsd)" };
  if (c.minValueUsd !== undefined && c.minValueUsd !== null && c.minValueUsd !== "") {
    const n = Number(c.minValueUsd);
    if (!Number.isFinite(n) || n < 0 || n > 1e12) return { error: "minValueUsd must be a number from 0 to 1e12" };
    out.minValueUsd = n;
  }
  if (c.minTransactionUsd !== undefined && c.minTransactionUsd !== null && c.minTransactionUsd !== "") {
    const n = Number(c.minTransactionUsd);
    if (!Number.isFinite(n) || n < 0 || n > 1e12) return { error: "minTransactionUsd must be a number from 0 to 1e12" };
    out.minTransactionUsd = n;
  }
  if (c.roles !== undefined) {
    if (!Array.isArray(c.roles) || c.roles.some((r) => !BACKTEST_ROLES.includes(r))) return { error: `roles must be a list of: ${BACKTEST_ROLES.join(", ")}` };
    out.roles = [...new Set(c.roles)];
  }
  out.openMarketOnly = c.openMarketOnly === true || c.openMarketOnly === "true" || c.openMarketOnly === 1;
  return { config: out };
}

// Identity view of an economic row at time T: its own reporting owners plus those of
// every CONFIRMED duplicate report of the same transaction (transactionGroups.js merges
// only with relationship evidence + an indirect holder) that was public at T. Related
// filers who report the same shares (e.g. two fund families of one joint filing, one
// reporting the other's purchase as an indirect holding) are then one buyer: "joint
// filers = one". Unrelated investors are never linked: rows without confirmed
// duplicate reports are returned unchanged. Display names and roles still come from
// the row's own (primary) report.
export function identityRowAt(r, T, reportOwners, acceptedAtByAccession) {
  if (!reportOwners || !(r.reportedBy?.length > 1)) return r;
  const keyOf = (o) => (o.cik ? `cik:${Number(o.cik)}` : `name:${String(o.name || "").toLowerCase()}`);
  const owners = [...(r.owners?.length ? r.owners : [{ cik: r.insiderCik, name: r.insiderName, role: r.role }])];
  const seen = new Set(owners.map(keyOf));
  let added = false;
  for (const rep of r.reportedBy) {
    if (rep.rowId === r.id) continue;
    const at = stampOf(acceptedAtByAccession.get(rep.accessionNo));
    if (!at || at > T) continue; // that report was not public yet (no lookahead)
    for (const o of reportOwners(rep.rowId) || []) {
      if (!seen.has(keyOf(o))) { seen.add(keyOf(o)); owners.push(o); added = true; }
    }
  }
  return added ? { ...r, owners } : r;
}

// POINT-IN-TIME VERSIONS of a confirmed duplicate group (transactionGroups.js merges the
// reports of one economic transaction using EVERY filing held now). Before all of its
// reports were public, the public saw only some of them — possibly as separate purchases
// (a later report can be the one that links them), and with the fields of a report that
// was public then (the final group's primary may have been filed later). So for each
// acceptance time t_i of the group's reports, the reports public at t_i are regrouped with
// the SAME rules (groupTransactions) and that view is valid until t_{i+1}. The last
// version is the final economic row itself (unchanged). → null when no versioning applies.
//   reportRow(rowId) → the checked raw report row (snapshot.rawById).
export function groupVersions(r, acceptedAtByAccession, reportRow) {
  if (!reportRow || !(r.reportedBy?.length > 1)) return null;
  const members = [];
  for (const rep of r.reportedBy) {
    const raw = reportRow(rep.rowId);
    const t = stampOf(acceptedAtByAccession.get(rep.accessionNo));
    if (!raw || !t) return null; // incomplete data → keep the final row (previous behaviour)
    members.push({ raw, t });
  }
  const times = [...new Set(members.map((m) => m.t))].sort();
  if (times.length < 2) return null; // all reports public at the same moment
  return times.map((t, i) => ({
    from: t,
    until: times[i + 1] || null,
    rows: i === times.length - 1 ? [r] : groupTransactions(members.filter((m) => m.t <= t).map((m) => m.raw)),
  }));
}

// Point-in-time metadata per P/S row, grouped by issuer CIK (number). Each item
// { r, knownAt, validUntil, firstKnownAt } is valid from knownAt until validUntil (an
// amendment's acceptance, or the next version of a duplicate group); firstKnownAt = when
// that transaction first became public (filing delay, "public at"). Shared by
// detectSignals and the monthly per-buyer study (monthlyStudy.js). stats is updated in place.
export function pointInTimeItems({ rows, acceptedAtByAccession = new Map(), reportRow = null, stats = {} }) {
  const byIssuer = new Map();
  const push = (k, item) => (byIssuer.get(k) || byIssuer.set(k, []).get(k)).push(item);
  const minStamp = (a, b) => (a && b ? (a < b ? a : b) : a || b || null);
  stats.rowsWithoutAcceptance ??= 0;
  stats.versionedGroups ??= 0;
  for (const r of rows) {
    if (r.code !== "P" && r.code !== "S") continue;
    if (!DATE_RE.test(r.transactionDate || "")) continue;
    const knownAt = knownAtOf(r, acceptedAtByAccession);
    if (!knownAt) { stats.rowsWithoutAcceptance++; continue; }
    const validUntil = r.amendment?.status === "superseded" ? stampOf(r.amendment.amendmentFiledAt) : null;
    const k = r.issuerCik ? Number(r.issuerCik) : null;
    if (k == null) continue;
    const versions = groupVersions(r, acceptedAtByAccession, reportRow);
    if (!versions) { push(k, { r, knownAt, validUntil, firstKnownAt: knownAt }); continue; }
    stats.versionedGroups++;
    for (const v of versions) {
      if (validUntil && v.from >= validUntil) continue; // already superseded by an amendment
      for (const vr of v.rows) {
        if (vr.code !== r.code) continue;
        push(k, { r: vr, knownAt: v.from, validUntil: minStamp(v.until, validUntil), firstKnownAt: knownAtOf(vr, acceptedAtByAccession) || v.from });
      }
    }
  }
  return byIssuer;
}

// rows: economic rows. range: publication dates { from, to } (inclusive, ET).
// reportOwners(rowId) → reporting owners of one raw report; links joint filers across
// confirmed duplicate reports (identityRowAt). reportRow(rowId) → the raw report row, for
// point-in-time versions of duplicate groups (groupVersions). → { signals, stats }
export function detectSignals({ rows, acceptedAtByAccession = new Map(), config = DEFAULTS, range = {}, reportOwners = null, reportRow = null }) {
  const cfg = { ...DEFAULTS, ...config };
  const stats = { rowsWithoutAcceptance: 0, purchasesConsidered: 0, purchasesUnreliableValue: 0, staleClusters: 0, issuers: 0, purchasesOverFilingDelay: 0, versionedGroups: 0 };
  const overDelay = new Set(); // row ids excluded by the optional filing-delay filter (counted once)

  // 1. Point-in-time metadata per row, grouped by issuer (pointInTimeItems).
  const byIssuer = pointInTimeItems({ rows, acceptedAtByAccession, reportRow, stats });

  const signals = [];
  for (const [cik, items] of byIssuer) {
    const buys = items.filter((x) => x.r.code === "P");
    if (!buys.length) continue;
    stats.issuers++;
    const events = [...new Set(buys.map((x) => x.knownAt))].sort();
    const firstSignalIdx = signals.length;
    let cluster = null; // { firstNum, lastNum, signal } — open cluster of the latest signal
    for (const T of events) {
      const tDate = T.slice(0, 10);
      const known = items.filter((x) => x.knownAt <= T && (!x.validUntil || x.validUntil > T));
      const identities = buildIdentities(known.map((x) => identityRowAt(x.r, T, reportOwners, acceptedAtByAccession)));
      const peersByKey = new Map();
      for (const x of known) { const pk = peerKey(x.r); if (pk) (peersByKey.get(pk) || peersByKey.set(pk, []).get(pk)).push(x.r); }

      const purchases = [];
      for (const x of known) {
        const r = x.r;
        if (r.code !== "P" || r.transactionDate > tDate) continue;
        const delayDays = filingDelayDays(r, x.firstKnownAt);
        if (cfg.maxFilingDelayDays != null && delayDays > cfg.maxFilingDelayDays) {
          if (!overDelay.has(r.id)) { overDelay.add(r.id); stats.purchasesOverFilingDelay++; }
          continue;
        }
        if (cfg.openMarketOnly && r.purchaseContext !== "open_market") continue;
        const roles = rowBacktestRoles(r);
        if (cfg.roles.length && !roles.some((g) => cfg.roles.includes(g))) continue;
        const rel = reliableUsd(r, peersByKey.get(peerKey(r)) || []);
        if (cfg.minTransactionUsd != null && !(rel.usd != null && rel.usd >= cfg.minTransactionUsd)) continue;
        purchases.push({
          x, r, roles, person: identities.personOf(r), usd: rel.usd, unreliable: rel.reason, delayDays,
        });
      }
      purchases.sort((a, b) => a.r.transactionDate.localeCompare(b.r.transactionDate));

      // Absorb continuing purchases into the open cluster (overlap rule).
      if (cluster) {
        for (const p of purchases) {
          const d = dayNum(p.r.transactionDate);
          if (d >= cluster.firstNum && d <= cluster.lastNum + cfg.windowDays - 1 && d > cluster.lastNum) cluster.lastNum = d;
        }
        // Retrospective extent of the emitted signal's cluster (display only; never used for detection).
        if (cluster.signal) cluster.signal.clusterTo = isoDay(cluster.lastNum);
      }
      const floorNum = cluster ? cluster.lastNum + cfg.windowDays - 1 : -Infinity; // new purchases must be AFTER this
      const lagFloor = cfg.maxSignalLagDays == null ? -Infinity : dayNum(tDate) - cfg.maxSignalLagDays;

      // Maximal window ending at each purchase date, newest first.
      let found = null, sawStale = false;
      for (let j = purchases.length - 1; j >= 0 && !found; j--) {
        const end = dayNum(purchases[j].r.transactionDate);
        if (end <= floorNum) break;
        if (end < lagFloor) { sawStale = true; break; }
        const start = Math.max(end - (cfg.windowDays - 1), floorNum + 1);
        const members = purchases.filter((p) => { const d = dayNum(p.r.transactionDate); return d >= start && d <= end; });
        const people = new Set(members.map((p) => p.person).filter(Boolean));
        const usd = members.reduce((s, p) => s + (p.usd ?? 0), 0);
        if (people.size >= cfg.minBuyers && usd >= cfg.minValueUsd) found = { members, start, end, people, usd };
      }
      if (!found) { if (sawStale) stats.staleClusters++; continue; }

      const m = found.members;
      const firstNum = Math.min(...m.map((p) => dayNum(p.r.transactionDate)));
      cluster = { firstNum, lastNum: found.end, signal: null };
      if ((range.from && tDate < range.from) || (range.to && tDate > range.to)) continue; // outside the requested publication range (state still advances)

      stats.purchasesConsidered += m.length;
      stats.purchasesUnreliableValue += m.filter((p) => p.usd == null).length;
      const latestKnown = [...known].sort((a, b) => b.knownAt.localeCompare(a.knownAt))[0].r;
      const buyers = new Map();
      for (const p of m) {
        let b = buyers.get(p.person);
        if (!b) { b = { id: p.person, name: p.r.owners?.[0]?.name || p.r.insiderName || "Unknown", roles: new Set(), transactions: 0, valueUsd: 0 }; buyers.set(p.person, b); }
        for (const g of p.roles) b.roles.add(g);
        b.transactions++;
        b.valueUsd += p.usd ?? 0;
      }
      signals.push({
        id: `${cik}:${T}`,
        clusterId: `${cik}:${isoDay(firstNum)}`, // deterministic: issuer + first trade date of the cluster
        issuerCik: String(cik).padStart(10, "0"),
        ticker: latestKnown.ticker || m[m.length - 1].r.ticker || null,
        issuerName: latestKnown.issuerName || null,
        publishedAt: `${T} ET`,
        publishedDate: tDate,
        windowFrom: isoDay(firstNum),
        windowTo: isoDay(found.end),
        clusterTo: isoDay(found.end), // extended later as the same cluster continues (overlap rule)
        lagDays: dayNum(tDate) - found.end,
        uniqueBuyers: found.people.size,
        purchases: m.length,
        valueUsd: round2(found.usd),
        valuesExcluded: m.filter((p) => p.usd == null).length,
        lateFilings: m.filter((p) => p.r.filingDelay?.late).length,
        // Purchases that may be the same transaction reported by another, unlinked filer.
        possibleDuplicatePurchases: m.filter((p) => p.r.dedupe?.status === "needs_review").length,
        roles: BACKTEST_ROLES.filter((g) => m.some((p) => p.roles.includes(g))),
        buyers: [...buyers.values()].map((b) => ({ ...b, roles: BACKTEST_ROLES.filter((g) => b.roles.has(g)), valueUsd: round2(b.valueUsd) }))
          .sort((a, b) => b.valueUsd - a.valueUsd),
        filings: [...new Map(m.flatMap((p) => (p.r.reportedBy?.length ? p.r.reportedBy : [p.r]).map((rep) => [rep.accessionNo, {
          accessionNo: rep.accessionNo, url: rep.filingUrl || null, acceptedAt: acceptedAtByAccession.get(rep.accessionNo) || null,
        }]))).values()],
        // Frozen snapshot of every qualifying purchase exactly as public at T (never updated later).
        snapshot: { asOf: `${T} ET`, purchases: m.map((p) => purchaseRecord(p)) },
      });
      cluster.signal = signals[signals.length - 1];
    }

    // HINDSIGHT — display only, computed AFTER detection and never used for signals,
    // entries or returns: the whole cluster (first window day → clusterTo) as reported by
    // every filing held now, with the SAME filters as the run (open-market only, roles,
    // minimum purchase). Buyers whose filings came after the signal are counted here,
    // never in the signal itself (no lookahead).
    if (signals.length > firstSignalIdx) {
      const finalRows = items.filter((x) => !x.validUntil); // superseded rows are out; amendments count
      const ids = buildIdentities(finalRows.map((x) => identityRowAt(x.r, "9999-12-31 23:59:59", reportOwners, acceptedAtByAccession)));
      const peers = new Map();
      for (const x of finalRows) { const pk = peerKey(x.r); if (pk) (peers.get(pk) || peers.set(pk, []).get(pk)).push(x.r); }
      for (let i = firstSignalIdx; i < signals.length; i++) {
        const sg = signals[i];
        const T = sg.publishedAt.replace(/ ET$/, "");
        const ps = [];
        for (const x of finalRows) {
          const r = x.r;
          if (r.code !== "P" || r.transactionDate < sg.windowFrom || r.transactionDate > sg.clusterTo) continue;
          if (cfg.maxFilingDelayDays != null && filingDelayDays(r, x.firstKnownAt) > cfg.maxFilingDelayDays) continue;
          if (cfg.openMarketOnly && r.purchaseContext !== "open_market") continue;
          const roles = rowBacktestRoles(r);
          if (cfg.roles.length && !roles.some((g) => cfg.roles.includes(g))) continue;
          const rel = reliableUsd(r, peers.get(peerKey(r)) || []);
          if (cfg.minTransactionUsd != null && !(rel.usd != null && rel.usd >= cfg.minTransactionUsd)) continue;
          ps.push({ x, r, person: ids.personOf(r), usd: rel.usd, unreliable: rel.reason, roles, delayDays: filingDelayDays(r, x.firstKnownAt) });
        }
        const known = (p) => p.x.firstKnownAt <= T && p.r.transactionDate <= sg.windowTo;
        // A Form 4/A restating a purchase of the signal snapshot is a CORRECTION of that
        // purchase (the original is superseded now), not a new purchase or a new buyer.
        const snapOriginals = new Set(sg.snapshot.purchases.flatMap((q) => [q.accessionNo, q.amends]).filter(Boolean));
        const amendsSnapshot = (p) => p.r.amendment?.status === "amends" && snapOriginals.has(p.r.amendment.original);
        const people = new Set(ps.map((p) => p.person).filter(Boolean));
        const atSignalPeople = new Set(ps.filter((p) => known(p) || amendsSnapshot(p)).map((p) => p.person).filter(Boolean));
        const corrections = ps.filter((p) => !known(p) && amendsSnapshot(p));
        const added = ps.filter((p) => !known(p) && !amendsSnapshot(p));
        const addedPeople = [...people].filter((p) => !atSignalPeople.has(p));
        const nameOf = (person) => { const p = ps.find((q) => q.person === person); return p?.r.owners?.[0]?.name || p?.r.insiderName || "Unknown"; };
        sg.hindsight = {
          basis: "all filings held now",
          clusterFrom: sg.windowFrom, clusterTo: sg.clusterTo,
          buyers: people.size, purchases: ps.length,
          valueUsd: round2(ps.reduce((a, p) => a + (p.usd ?? 0), 0)),
          valuesExcluded: ps.filter((p) => p.usd == null).length,
          buyersAdded: addedPeople.length, purchasesAdded: added.length,
          valueAddedUsd: round2(added.reduce((a, p) => a + (p.usd ?? 0), 0)),
          addedBuyers: addedPeople.slice(0, 12).map(nameOf),
          lastReportedAt: ps.length ? `${ps.map((p) => p.x.firstKnownAt).sort().at(-1)} ET` : null,
          // Purchases NOT in the signal snapshot (public later, or traded after windowTo):
          // subsequent events of the company timeline — never used for the signal or returns.
          laterPurchases: [...added].sort((a, b) => a.x.firstKnownAt.localeCompare(b.x.firstKnownAt) || a.r.transactionDate.localeCompare(b.r.transactionDate))
            .slice(0, 100).map((p) => purchaseRecord(p)),
          // Form 4/A amendments of snapshot purchases (listed separately; never "added").
          amendmentsOfSignalPurchases: corrections.slice(0, 50).map((p) => purchaseRecord(p)),
        };
      }
    }
  }
  signals.sort((a, b) => a.publishedAt.localeCompare(b.publishedAt) || a.issuerCik.localeCompare(b.issuerCik));
  return { signals, stats };
}
