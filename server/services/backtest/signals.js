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
// Signal rule (defaults): at least MIN_BUYERS (2) DISTINCT reporting owners
// (SEC CIK; joint filers = one) with Form 4 code P purchases whose trade dates
// fall in one rolling WINDOW_DAYS (30) calendar-day window, with a combined
// reliable purchase value STRICTLY greater than MIN_VALUE_USD ($250,000) across
// all buyers. Purchases without a reliable USD value (price anomaly, missing
// price, unverified currency) still count as buyers but add nothing to the sum.
// The window's latest trade date must be within MAX_SIGNAL_LAG_DAYS (30) calendar
// days of the publication date (stale late filings do not create signals).
//
// Overlap rule: once an issuer signals, that cluster stays open while purchases
// continue — every purchase with a trade date within WINDOW_DAYS after the
// cluster's latest purchase is absorbed and extends it. A new, independent signal
// for the same issuer needs a qualifying window made only of purchases dated
// after the open cluster's horizon (latest purchase + WINDOW_DAYS − 1).

import { buildIdentities, ownerRoleGroups } from "../edgar/insiderInsights.js";
import { peerKey, peerOutlierDetail } from "../edgar/priceAnomalies.js";

export const DEFAULTS = Object.freeze({
  minBuyers: 2,
  minValueUsd: 250_000,
  windowDays: 30,
  maxSignalLagDays: 30,
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
  for (const [k, lo, hi] of [["minBuyers", 1, 50], ["windowDays", 1, 365], ["maxSignalLagDays", 0, 3650]]) {
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

// rows: economic rows. range: publication dates { from, to } (inclusive, ET).
// → { signals, stats }
export function detectSignals({ rows, acceptedAtByAccession = new Map(), config = DEFAULTS, range = {} }) {
  const cfg = { ...DEFAULTS, ...config };
  const stats = { rowsWithoutAcceptance: 0, purchasesConsidered: 0, purchasesUnreliableValue: 0, staleClusters: 0, issuers: 0 };

  // 1. Point-in-time metadata per row; group by issuer.
  const byIssuer = new Map();
  for (const r of rows) {
    if (r.code !== "P" && r.code !== "S") continue;
    if (!DATE_RE.test(r.transactionDate || "")) continue;
    const knownAt = knownAtOf(r, acceptedAtByAccession);
    if (!knownAt) { stats.rowsWithoutAcceptance++; continue; }
    const validUntil = r.amendment?.status === "superseded" ? stampOf(r.amendment.amendmentFiledAt) : null;
    const k = r.issuerCik ? Number(r.issuerCik) : null;
    if (k == null) continue;
    (byIssuer.get(k) || byIssuer.set(k, []).get(k)).push({ r, knownAt, validUntil });
  }

  const signals = [];
  for (const [cik, items] of byIssuer) {
    const buys = items.filter((x) => x.r.code === "P");
    if (!buys.length) continue;
    stats.issuers++;
    const events = [...new Set(buys.map((x) => x.knownAt))].sort();
    let cluster = null; // { firstNum, lastNum, signal } — open cluster of the latest signal
    for (const T of events) {
      const tDate = T.slice(0, 10);
      const known = items.filter((x) => x.knownAt <= T && (!x.validUntil || x.validUntil > T));
      const identities = buildIdentities(known.map((x) => x.r));
      const peersByKey = new Map();
      for (const x of known) { const pk = peerKey(x.r); if (pk) (peersByKey.get(pk) || peersByKey.set(pk, []).get(pk)).push(x.r); }

      const purchases = [];
      for (const x of known) {
        const r = x.r;
        if (r.code !== "P" || r.transactionDate > tDate) continue;
        if (cfg.openMarketOnly && r.purchaseContext !== "open_market") continue;
        const roles = rowBacktestRoles(r);
        if (cfg.roles.length && !roles.some((g) => cfg.roles.includes(g))) continue;
        const rel = reliableUsd(r, peersByKey.get(peerKey(r)) || []);
        if (cfg.minTransactionUsd != null && !(rel.usd != null && rel.usd >= cfg.minTransactionUsd)) continue;
        purchases.push({
          x, r, roles, person: identities.personOf(r), usd: rel.usd, unreliable: rel.reason,
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
      const lagFloor = dayNum(tDate) - cfg.maxSignalLagDays;

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
        if (people.size >= cfg.minBuyers && usd > cfg.minValueUsd) found = { members, start, end, people, usd };
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
        roles: BACKTEST_ROLES.filter((g) => m.some((p) => p.roles.includes(g))),
        buyers: [...buyers.values()].map((b) => ({ ...b, roles: BACKTEST_ROLES.filter((g) => b.roles.has(g)), valueUsd: round2(b.valueUsd) }))
          .sort((a, b) => b.valueUsd - a.valueUsd),
        filings: [...new Map(m.flatMap((p) => (p.r.reportedBy?.length ? p.r.reportedBy : [p.r]).map((rep) => [rep.accessionNo, {
          accessionNo: rep.accessionNo, url: rep.filingUrl || null, acceptedAt: acceptedAtByAccession.get(rep.accessionNo) || null,
        }]))).values()],
      });
      cluster.signal = signals[signals.length - 1];
    }
  }
  signals.sort((a, b) => a.publishedAt.localeCompare(b.publishedAt) || a.issuerCik.localeCompare(b.issuerCik));
  return { signals, stats };
}
