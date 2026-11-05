// server/services/edgar/companyScreener.js
//
// Companies screener — purchase-focused, per-issuer aggregation over the
// published snapshot's ECONOMIC rows (GET /api/insider/companies). Reuses the
// counting rules of insiderInsights.js so the Companies page and the company
// detail page agree:
//   • Purchases = Form 4 code "P" only. Sales are never subtracted; sale
//     statistics are returned separately (optional columns).
//   • Rows superseded by a Form 4/A are excluded; confirmed duplicate reports by
//     related filers are already ONE economic row (transactionGroups.js).
//   • Unique buyers = distinct PEOPLE by reporting-owner CIK, joint filers merged
//     (buildIdentities, built per issuer exactly as on the company page).
//   • Values = shares × reported price; price anomalies / unpriced rows count as
//     transactions but not in value totals (and are flagged via valueMissing).
//   • Date basis: transactionDate (trade date, default) or filingDate (when the
//     purchase was publicly reported). "24h" on the trade basis is day-granular
//     (trade dates have no time): today or the previous calendar day, ET. On the
//     filing basis it uses the SEC acceptance timestamp.
//   • Coverage: the SEC daily indexes behind the window are checked with the same
//     windowCoverage() as the company page; incomplete → `coverage.complete=false`.
//   • Cluster indicator: >= 3 distinct buyers within a rolling 30-day trade-date
//     window (detectClusters) that overlaps the selected window.

//   • Evidence fields (additive, for the Evidence Grid page): SEC publication
//     times, legal filers vs independent buyers, insider average price, holdings
//     increase, 30-day activity strip, repeat buying, cluster type A/B/C, momentum
//     and a data-confidence verdict with its reasons. Evidence rows per company:
//     companyEvidence() (GET /api/insider/companies/:cik/evidence).
import { buildIdentities, countedRows, detectClusters, easternToday, insiderActivity, isoDayDiff, windowCoverage, windowOf } from "./insiderInsights.js";
import { isSuperseded } from "./amendments.js";

export const PERIODS = { "1d": 1, "7d": 7, "14d": 14, "30d": 30, "90d": 90 };
export const SORTS = new Set(["buyers", "value", "recent", "transactions", "published", "own"]);
export const ROLE_FILTERS = new Set(["CEO", "CFO", "Director", "Officer", "10% Owner"]);
export const PTYPES = new Set(["all", "likely", "verified"]);
export const CONFS = new Set(["all", "hide_uncertain", "verified"]);
export const PUB_DAYS = { "24h": 1, "72h": 3, "7d": 7 };
// Cluster types (Evidence Grid): strongest pattern among the window's purchases, by trade date.
export const CLUSTER_TYPES = { C: { buyers: 5, days: 7 }, B: { buyers: 3, days: 2 }, A: { buyers: 2, days: 1 } };
const ACTIVITY_DAYS = 30;
export const CLUSTER_MIN_BUYERS = 3;
export const CLUSTER_WINDOW_DAYS = 30;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LIMIT = 500;
const MAX_VALUE = 1e13;



// "YYYY-MM-DD HH:MM:SS" in New York — comparable with acceptedAtET ("… ET").
export function easternStamp(nowMs = Date.now()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(nowMs)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

function num(v, name) {
  if (v === undefined || v === "") return { value: null };
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > MAX_VALUE) return { error: `${name} must be a number from 0 to ${MAX_VALUE}` };
  return { value: n };
}

// Validates the query → normalized options, or { error }.
export function parseScreenerQuery(q = {}, now = Date.now()) {
  const today = easternToday(now);
  const basis = q.basis === undefined || q.basis === "" ? "transactionDate" : String(q.basis);
  if (basis !== "transactionDate" && basis !== "filingDate") return { error: "basis must be transactionDate or filingDate" };

  let win, period;
  if ((q.from !== undefined && q.from !== "") || (q.to !== undefined && q.to !== "")) {
    const from = String(q.from || ""), to = String(q.to || today);
    if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) return { error: "from/to must be YYYY-MM-DD with from <= to" };
    if (isoDayDiff(from, to) > 366) return { error: "custom range is limited to 366 days" };
    period = "custom";
    win = windowOf({ from, to: to > today ? today : to });
    if (win.from > win.to) return { error: "from must not be in the future" };
  } else {
    period = q.period === undefined || q.period === "" ? "30d" : String(q.period);
    if (!(period in PERIODS)) return { error: "period must be 1d, 7d, 14d, 30d or 90d (or use from/to)" };
    // 1d = last 24 hours: today + previous calendar day as dates.
    win = windowOf({ days: period === "1d" ? 2 : PERIODS[period], to: today });
  }

  const minBuyers = q.minBuyers === undefined || q.minBuyers === "" ? 1 : Number(q.minBuyers);
  if (!Number.isInteger(minBuyers) || minBuyers < 1 || minBuyers > 1000) return { error: "minBuyers must be an integer from 1 to 1000" };
  const minValue = num(q.minValue, "minValue"); if (minValue.error) return minValue;
  const maxValue = num(q.maxValue, "maxValue"); if (maxValue.error) return maxValue;
  if (minValue.value != null && maxValue.value != null && minValue.value > maxValue.value) return { error: "minValue must be <= maxValue" };

  const sort = q.sort === undefined || q.sort === "" ? "buyers" : String(q.sort);
  if (!SORTS.has(sort)) return { error: "sort must be buyers, value, recent, transactions, published or own" };
  const list = (v) => (v === undefined || v === "" ? [] : String(v).split(",").map((x) => x.trim()).filter(Boolean));
  const roles = list(q.roles);
  if (roles.some((r) => !ROLE_FILTERS.has(r)) || roles.length > 5) return { error: "roles must be a comma list of CEO, CFO, Director, Officer, 10% Owner" };
  const clusterTypes = list(q.clusterType);
  if (clusterTypes.some((t) => !(t in CLUSTER_TYPES))) return { error: "clusterType must be a comma list of A, B, C" };
  const flagV = (v) => v === "1" || v === "true" || v === true;
  const ptype = q.ptype === undefined || q.ptype === "" ? (flagV(q.openMarket) ? "verified" : "all") : String(q.ptype);
  if (!PTYPES.has(ptype)) return { error: "ptype must be all, likely or verified" };
  const conf = q.conf === undefined || q.conf === "" ? "all" : String(q.conf);
  if (!CONFS.has(conf)) return { error: "conf must be all, hide_uncertain or verified" };
  const pub = q.pub === undefined || q.pub === "" ? "any" : String(q.pub);
  if (pub !== "any" && !(pub in PUB_DAYS)) return { error: "pub must be any, 24h, 72h or 7d" };
  const dir = q.dir === "asc" ? "asc" : "desc";
  const limit = q.limit === undefined || q.limit === "" ? 100 : Number(q.limit);
  const offset = q.offset === undefined || q.offset === "" ? 0 : Number(q.offset);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) return { error: `limit must be an integer from 1 to ${MAX_LIMIT}` };
  if (!Number.isInteger(offset) || offset < 0) return { error: "offset must be a non-negative integer" };
  const search = String(q.q || "").trim().slice(0, 80).toUpperCase();
  const flag = (v) => v === "1" || v === "true" || v === true;

  return {
    today, basis, period, win, minBuyers, minValue: minValue.value, maxValue: maxValue.value,
    openMarketOnly: ptype === "verified", clusterOnly: flag(q.cluster), search, sort, dir, limit, offset,
    since24h: period === "1d" && basis === "filingDate" ? easternStamp(now - 86_400_000) : null,
    ptype, conf, roles: [...roles].sort(), clusterTypes: [...clusterTypes].sort(), repeatOnly: flag(q.repeat),
    pub, pubSince: pub === "any" ? null : easternStamp(now - PUB_DAYS[pub] * 86_400_000),
  };
}

// Per-version precomputation: issuer → { counted rows, identities, clusters }.
export function indexIssuers(economic, { reportOwners = null } = {}) {
  const groups = new Map();
  const keyOf = (r) => (r.issuerCik ? `cik:${Number(r.issuerCik)}` : r.ticker ? `t:${String(r.ticker).toUpperCase()}` : null);
  for (const r of countedRows(economic)) {
    const k = keyOf(r);
    if (!k) continue;
    (groups.get(k) || groups.set(k, []).get(k)).push(r);
  }
  // Superseded purchase rows (replaced by a Form 4/A) — never counted, kept as evidence.
  const superseded = new Map();
  for (const r of economic) {
    if (r.code !== "P" || !isSuperseded(r)) continue;
    const k = keyOf(r);
    if (k) (superseded.get(k) || superseded.set(k, []).get(k)).push(r);
  }
  const issuers = [];
  for (const [key, rows] of groups) {
    const identities = buildIdentities(rows, { reportOwners });
    // Newest ticker / name as filed (rows are newest-first in the snapshot).
    const ticker = rows.find((r) => r.ticker)?.ticker || null;
    issuers.push({
      key, rows, identities,
      cik: rows[0].issuerCik ? String(rows[0].issuerCik).padStart(10, "0") : null,
      ticker, name: rows.find((r) => r.issuerName)?.issuerName || null,
      clusters: null, // lazy (only purchases with a trade date; computed on first need)
      superseded: superseded.get(key) || [],
    });
  }
  return issuers;
}

function clustersOf(issuer) {
  if (!issuer.clusters) {
    issuer.clusters = detectClusters(issuer.rows, { threshold: CLUSTER_MIN_BUYERS, windowDays: CLUSTER_WINDOW_DAYS, identities: issuer.identities });
  }
  return issuer.clusters;
}

const lastFiled = (r) => (r.reportedBy || [r]).reduce((m, x) => ((x.filingDate || "") > m ? x.filingDate : m), r.filingDate || "");

function inWindow(r, opt) {
  if (opt.basis === "transactionDate") return r.transactionDate >= opt.win.from && r.transactionDate <= opt.win.to;
  if (opt.since24h) return !!r.acceptedAtET && r.acceptedAtET.slice(0, 19) >= opt.since24h;
  const d = r.filingDate || "";
  return d >= opt.win.from && d <= opt.win.to;
}

// One issuer → screener row, or null when it has no qualifying purchase.
// Purchase-type filter: verified = the filing states open-market; likely = everything except
// offerings / private placements; all = every code P row (default; same as before).
const ptypeOk = (r, ptype) => (ptype === "verified" ? r.purchaseContext === "open_market" : ptype === "likely" ? r.purchaseContext !== "offering_or_private" : true);
const acceptedOf = (r) => String(r.acceptedAtET || "").replace(/\s*ET$/, "") || null;
const addDaysIso = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const round4 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1e4) / 1e4);

// Strongest cluster type among purchases (trade dates; distinct people), C > B > A.
export function clusterTypeOf(buys, personOf) {
  const pts = buys.map((r) => ({ d: r.transactionDate, id: personOf(r) })).filter((x) => x.id && x.d).sort((a, b) => a.d.localeCompare(b.d));
  for (const t of ["C", "B", "A"]) {
    const { buyers, days } = CLUSTER_TYPES[t];
    for (let j = 0, i = 0; j < pts.length; j++) {
      const lo = addDaysIso(pts[j].d, -(days - 1));
      while (pts[i].d < lo) i++;
      if (new Set(pts.slice(i, j + 1).map((x) => x.id)).size >= buyers) return t;
    }
  }
  return null;
}

// Holdings increase: per buyer and ownership line, holding before the first purchase =
// min(sharesOwnedAfter − shares); pooled bought / pooled before over lines where that is > 0.
function holdingsIncrease(rows) {
  const lines = new Map();
  for (const r of rows) {
    const k = `${r.ownership || ""}|${r.natureOfOwnership || ""}`;
    const pre = r.sharesOwnedAfter != null && r.shares != null ? r.sharesOwnedAfter - r.shares : null;
    const l = lines.get(k) || { bought: 0, pre: Infinity, ok: true };
    l.bought += r.shares || 0;
    if (pre == null) l.ok = false; else l.pre = Math.min(l.pre, pre);
    lines.set(k, l);
  }
  let b = 0, p = 0;
  for (const l of lines.values()) if (l.ok && l.pre > 0 && Number.isFinite(l.pre)) { b += l.bought; p += l.pre; }
  return p > 0 ? round4(b / p) : null;
}

// Data-confidence verdict from the filings themselves (no market data).
export function qualityOf({ buys, legalFilers, uniqueBuyers, superseded }) {
  const c = (f) => buys.filter(f).length;
  const flags = {
    priceAnomaly: c((r) => r.priceCheck?.status === "anomaly"),
    missingPrice: c((r) => r.priceCheck?.status !== "anomaly" && r.value == null),
    currencyUnverified: c((r) => r.currency?.basis === "unverified"),
    offering: c((r) => r.purchaseContext === "offering_or_private"),
    duplicateReports: buys.reduce((s, r) => s + Math.max(0, (r.reportedBy?.length || 1) - 1), 0),
    relatedFilers: Math.max(0, legalFilers - uniqueBuyers),
    needsReview: c((r) => r.dedupe?.status === "needs_review"),
    amendmentUnlinked: c((r) => ["original_not_held", "ambiguous", "unlinked"].includes(r.amendment?.status)),
    superseded,
  };
  const active = Object.entries(flags).filter(([, n]) => n > 0).map(([code, count]) => ({ code, count }));
  const uncertain = flags.offering > 0 || flags.currencyUnverified > 0 || flags.priceAnomaly + flags.missingPrice > buys.length / 2;
  return { status: uncertain ? "uncertain" : active.length ? "warning" : "verified", flags: active };
}

export function summarizeIssuer(issuer, opt) {
  const rows = issuer.rows.filter((r) => inWindow(r, opt));
  const ptype = opt.ptype || (opt.openMarketOnly ? "verified" : "all");
  const buys = rows.filter((r) => r.code === "P" && ptypeOk(r, ptype));
  if (!buys.length) return null;
  const sells = rows.filter((r) => r.code === "S");
  // insiderActivity filters by trade date; the rows are already windowed, so
  // pass an all-inclusive window and let it do the people / value counting.
  const all = { from: "0000-00-00", to: "9999-99-99" };
  const a = insiderActivity([...buys, ...sells], all, issuer.identities);
  // Overlap by trade dates (clusters are a trade-date pattern on either basis).
  const clusters = clustersOf(issuer).filter((c) => c.to >= opt.win.from && c.from <= opt.win.to);
  const best = [...clusters].sort((x, y) => y.peakBuyers - x.peakBuyers || y.to.localeCompare(x.to))[0] || null;
  return {
    key: issuer.key, cik: issuer.cik, ticker: issuer.ticker, name: issuer.name,
    uniqueBuyers: a.uniqueBuyers,
    purchaseTransactions: a.purchaseTransactions,
    purchaseValue: a.purchaseValue,
    purchaseValueMissing: a.purchaseValueMissing,
    purchaseShares: a.purchaseShares,
    openMarketPurchases: buys.filter((r) => r.purchaseContext === "open_market").length,
    latestPurchaseDate: a.lastPurchase,
    latestFilingDate: buys.reduce((m, r) => { const d = lastFiled(r); return d > m ? d : m; }, "") || null,
    roles: Object.entries(a.byRole).filter(([, v]) => v.buyers > 0).map(([role, v]) => ({ role, buyers: v.buyers })),
    topBuyers: a.buyers.slice(0, 3).map((b) => ({ name: b.name, roles: b.roles, value: b.value })),
    uniqueSellers: a.uniqueSellers,
    saleTransactions: a.saleTransactions,
    saleValue: a.saleValue,
    cluster: best ? { from: best.from, to: best.to, peakBuyers: best.peakBuyers, distinctBuyers: best.distinctBuyers } : null,
    ...evidenceFields(issuer, opt, buys, a, best),
  };
}

// Additive Evidence Grid fields (see header). Pure; uses only the window's purchase rows.
function evidenceFields(issuer, opt, buys, a, best) {
  const personOf = issuer.identities.personOf;
  const legalFilers = new Set(a.buyers.flatMap((b) => b.ciks)).size || a.uniqueBuyers;
  const accepted = buys.map(acceptedOf).filter(Boolean).sort();
  const filings = new Set(buys.flatMap((r) => (r.reportedBy?.length ? r.reportedBy : [r]).map((x) => x.accessionNo).filter(Boolean)));
  const priced = buys.filter((r) => r.priceCheck?.status !== "anomaly" && r.value != null && r.shares > 0);
  const pricedShares = priced.reduce((s, r) => s + r.shares, 0);
  const end = opt.win.to;
  const days = Array(ACTIVITY_DAYS).fill(0);
  for (const r of buys) { const d = isoDayDiff(r.transactionDate, end); if (d >= 0 && d < ACTIVITY_DAYS) days[ACTIVITY_DAYS - 1 - d]++; }
  const byPerson = new Map();
  for (const r of buys) { const id = personOf(r); if (id) (byPerson.get(id) || byPerson.set(id, []).get(id)).push(r); }
  const repeat = [...byPerson.values()].some((rs) => new Set(rs.map((r) => r.transactionDate)).size >= 2);
  const recent = (lo, hi) => buys.filter((r) => { const d = isoDayDiff(r.transactionDate, end); return d >= lo && d <= hi; }).length;
  const last7 = recent(0, 6), prev7 = recent(7, 13);
  const momentum = a.uniqueBuyers === 1 ? "single" : last7 > prev7 ? "accelerating" : last7 < prev7 ? "slowing" : "steady";
  const superseded = issuer.superseded.filter((r) => inWindow(r, opt)).length;
  const buyersList = a.buyers.slice(0, 8).map((b) => ({
    name: b.name, roles: b.roles, value: b.value, shares: b.shares, transactions: b.transactions,
    legalFilers: b.ciks.length || 1, reportingOwners: b.reportingOwners.length > 1 ? b.reportingOwners.slice(0, 6) : [],
    firstDate: b.firstDate, lastDate: b.lastDate, holdingsIncrease: holdingsIncrease(byPerson.get(b.id) || []),
  }));
  return {
    firstAcceptedAt: accepted[0] || null,
    latestAcceptedAt: accepted[accepted.length - 1] || null,
    filings: filings.size,
    legalFilers,
    purchaseTypes: {
      openMarket: buys.filter((r) => r.purchaseContext === "open_market").length,
      offering: buys.filter((r) => r.purchaseContext === "offering_or_private").length,
      unspecified: buys.filter((r) => r.purchaseContext !== "open_market" && r.purchaseContext !== "offering_or_private").length,
    },
    avgPrice: pricedShares > 0 ? round4(priced.reduce((s, r) => s + r.value, 0) / pricedShares) : null,
    holdingsIncrease: (() => { // pooled over buyers' valid lines
      let b = 0, p = 0;
      for (const rs of byPerson.values()) {
        const h = holdingsIncrease(rs);
        if (h == null) continue;
        const bought = rs.reduce((s, r) => s + (r.shares || 0), 0);
        b += bought; p += bought / h;
      }
      return p > 0 ? round4(b / p) : null;
    })(),
    activity: { days, end, repeat, momentum },
    clusterType: clusterTypeOf(buys, personOf),
    newCluster: !!best && best.to >= addDaysIso(opt.today, -6),
    quality: qualityOf({ buys, legalFilers, uniqueBuyers: a.uniqueBuyers, superseded }),
    buyersList,
  };
}

const SORT_FNS = {
  buyers: (a, b) => a.uniqueBuyers - b.uniqueBuyers || a.purchaseValue - b.purchaseValue,
  value: (a, b) => a.purchaseValue - b.purchaseValue || a.uniqueBuyers - b.uniqueBuyers,
  recent: (a, b) => String(a.latestPurchaseDate).localeCompare(String(b.latestPurchaseDate)) || String(a.latestFilingDate).localeCompare(String(b.latestFilingDate)),
  transactions: (a, b) => a.purchaseTransactions - b.purchaseTransactions || a.purchaseValue - b.purchaseValue,
  published: (a, b) => String(a.latestAcceptedAt || "").localeCompare(String(b.latestAcceptedAt || "")) || a.uniqueBuyers - b.uniqueBuyers,
  own: (a, b) => (a.holdingsIncrease ?? -1) - (b.holdingsIncrease ?? -1) || a.purchaseValue - b.purchaseValue,
};
const hasRole = (s, roles) => roles.some((r) => s.roles.some((x) => x.role === r && x.buyers > 0));

export function screenCompanies({ issuers, query = {}, ingest = null, now = Date.now() }) {
  const opt = query.win ? query : parseScreenerQuery(query, now);
  if (opt.error) return opt;
  const summaries = [];
  for (const iss of issuers) {
    const s = summarizeIssuer(iss, opt);
    if (s) summaries.push(s);
  }
  const matched = summaries.filter((s) => s.uniqueBuyers >= opt.minBuyers
    && (opt.minValue == null || s.purchaseValue >= opt.minValue)
    && (opt.maxValue == null || s.purchaseValue <= opt.maxValue)
    && (!opt.clusterOnly || s.cluster)
    && (!opt.roles?.length || hasRole(s, opt.roles))
    && (!opt.clusterTypes?.length || opt.clusterTypes.includes(s.clusterType))
    && (!opt.repeatOnly || s.activity.repeat)
    && (!opt.conf || opt.conf === "all" || (opt.conf === "verified" ? s.quality.status === "verified" : s.quality.status !== "uncertain"))
    && (!opt.pubSince || (s.latestAcceptedAt && s.latestAcceptedAt >= opt.pubSince))
    && (!opt.search || String(s.ticker || "").toUpperCase().includes(opt.search) || String(s.name || "").toUpperCase().includes(opt.search)));
  const m = opt.dir === "asc" ? 1 : -1;
  const cmp = SORT_FNS[opt.sort];
  // "own": companies without a measurable holdings increase stay last in either direction.
  const nullLast = opt.sort === "own" ? (a, b) => (a.holdingsIncrease == null) - (b.holdingsIncrease == null) : () => 0;
  matched.sort((a, b) => nullLast(a, b) || cmp(a, b) * m || String(a.ticker || "~").localeCompare(String(b.ticker || "~")));

  const pollMs = ingest?.pollIntervalMs || 60_000;
  const livePollOk = !!ingest?.lastPollAt && now - Date.parse(ingest.lastPollAt) <= pollMs * 3;
  // Coverage of the SEC daily indexes. Filing basis: filings of day D are in
  // index D. Trade basis: a trade on D is filed on/after D — same day range.
  const coverage = windowCoverage(opt.win, {
    coverage: ingest?.coverage || [], noIndexDays: ingest?.noIndexDays || [],
    latestIndexDay: ingest?.recovery?.latestExpectedDay ?? null, livePollOk,
  });
  const totals = matched.reduce((t, s) => {
    t.purchaseTransactions += s.purchaseTransactions;
    t.purchaseValue += s.purchaseValue;
    t.uniqueBuyers += s.uniqueBuyers;
    t.legalFilers += s.legalFilers;
    if (s.cluster) t.withCluster++;
    if (s.newCluster) t.newClusters7d++;
    if (s.clusterType) t.clusterTypes[s.clusterType]++;
    t.quality[s.quality.status]++;
    return t;
  }, { companies: matched.length, purchaseTransactions: 0, purchaseValue: 0, uniqueBuyers: 0, legalFilers: 0, withCluster: 0, newClusters7d: 0, clusterTypes: { A: 0, B: 0, C: 0 }, quality: { verified: 0, warning: 0, uncertain: 0 } });
  totals.purchaseValue = Math.round(totals.purchaseValue * 100) / 100;

  return {
    window: { from: opt.win.from, to: opt.win.to, days: opt.win.days, period: opt.period, basis: opt.basis, today: opt.today, since: opt.since24h ? `${opt.since24h} ET` : null },
    filters: {
      minBuyers: opt.minBuyers, minValue: opt.minValue, maxValue: opt.maxValue, openMarketOnly: opt.openMarketOnly, clusterOnly: opt.clusterOnly, q: opt.search || null,
      ptype: opt.ptype || (opt.openMarketOnly ? "verified" : "all"), conf: opt.conf || "all", roles: opt.roles || [], clusterTypes: opt.clusterTypes || [], repeatOnly: !!opt.repeatOnly, pub: opt.pub || "any",
    },
    sort: { key: opt.sort, dir: opt.dir },
    coverage,
    total: matched.length,
    totals,
    offset: opt.offset, limit: opt.limit,
    companies: matched.slice(opt.offset, opt.offset + opt.limit),
    definitions: {
      uniqueBuyers: "Distinct buyers (SEC reporting-owner CIK) with a Form 4 code P purchase in the window — the actual count, at least the minimum selected. Joint filers count once, including related filers that report the same purchase in separate Form 4s.",
      purchaseValue: "Sum of shares × reported price of code P purchases. Superseded Form 4/A rows and price anomalies are excluded; duplicate reports count once. Sales are not subtracted.",
      purchase: "Form 4 code P is a reported purchase — not always an exchange-traded (open-market) purchase. Use “Open-market purchases only” to restrict to purchases the filing describes as open-market.",
      cluster: `${CLUSTER_MIN_BUYERS}+ distinct buyers within any ${CLUSTER_WINDOW_DAYS}-day trade-date window overlapping the selected period. Factual pattern — not a recommendation.`,
      basis: opt.basis === "transactionDate" ? "Trade date (when insiders bought)." : "SEC filing date (when the purchase was publicly reported).",
      legalFilers: "Distinct reporting-owner CIKs behind the buyers. Related filers (a person and their trust, a fund and its GP, joint filers) are merged into one buyer only with evidence from the filings.",
      clusterType: "A = 2+ buyers on one trade date · B = 3+ within 2 days · C = 5+ within 7 days (strongest shown). Factual pattern — not a recommendation.",
      quality: "Verified = every counted row passed the SEC data checks. Warning = rows merged, superseded or excluded from value; totals stay reliable. Uncertain = offering / private placement, unverified currency or most prices unusable.",
      holdingsIncrease: "Shares bought ÷ shares held before the first purchase (Form 4 shares owned after), pooled over buyers with a valid prior holding.",
    },
  };
}

// Evidence rows behind one company's screener row (same window, same purchase-type rule).
export function companyEvidence({ issuers, cik, query = {}, now = Date.now() }) {
  const opt = parseScreenerQuery(query, now);
  if (opt.error) return opt;
  const digits = String(cik || "").replace(/\D/g, "");
  if (!digits || digits.length > 10) return { error: "cik must be up to 10 digits" };
  const issuer = issuers.find((i) => i.key === `cik:${Number(digits)}`);
  if (!issuer) return { notFound: true };
  const rows = issuer.rows.filter((r) => inWindow(r, opt));
  const buys = rows.filter((r) => r.code === "P" && ptypeOk(r, opt.ptype));
  const a = insiderActivity(buys, { from: "0000-00-00", to: "9999-99-99" }, issuer.identities);
  const nameOf = new Map(a.buyers.map((b) => [b.id, b.name]));
  const counted = buys.slice(0, 300).map((r) => ({
    id: r.id, accessionNo: r.accessionNo, filingUrl: r.filingUrl || null, owner: r.insiderName, buyer: nameOf.get(issuer.identities.personOf(r)) || r.insiderName,
    role: r.role || null, tradeDate: r.transactionDate, acceptedAt: acceptedOf(r), shares: r.shares, price: r.price,
    value: r.priceCheck?.status === "anomaly" ? null : r.value, ownership: r.ownership || null, purchaseType: r.purchaseContext || "unspecified",
    priceCheck: r.priceCheck?.status || null, priceNote: (r.priceCheck?.reasons || []).map((x) => x.detail).slice(0, 2), currency: r.currency?.basis || null,
    is10b5_1: !!r.is10b5_1,
  }));
  const excluded = [];
  for (const r of buys) {
    if (r.priceCheck?.status === "anomaly") excluded.push({ kind: "price_anomaly", reason: "Price anomaly — value not counted", detail: (r.priceCheck.reasons || []).map((x) => x.detail).join(" "), owner: r.insiderName, accessionNo: r.accessionNo, filingUrl: r.filingUrl || null, value: null });
    if (r.reportedBy?.length > 1) for (const rep of r.reportedBy.filter((x) => x.rowId !== r.id)) excluded.push({ kind: "duplicate", reason: "Same transaction reported by a related filer — counted once", detail: `${rep.insiderName} reported the identical purchase in a separate Form 4.`, owner: rep.insiderName, accessionNo: rep.accessionNo, filingUrl: rep.filingUrl || null, value: r.value });
  }
  for (const r of issuer.superseded.filter((x) => inWindow(x, opt))) excluded.push({ kind: "superseded", reason: "Superseded by Form 4/A — not counted", detail: "An amendment replaced this row; the amended values are counted instead.", owner: r.insiderName, accessionNo: r.accessionNo, filingUrl: r.filingUrl || null, value: r.value });
  const legalFilers = new Set(a.buyers.flatMap((b) => b.ciks)).size || a.uniqueBuyers;
  return {
    cik: issuer.cik, ticker: issuer.ticker, name: issuer.name, window: { from: opt.win.from, to: opt.win.to, basis: opt.basis }, ptype: opt.ptype,
    uniqueBuyers: a.uniqueBuyers, legalFilers, countedValue: a.purchaseValue, counted, excluded: excluded.slice(0, 200), truncated: buys.length > 300,
  };
}

// Small per-snapshot-version cache of the issuer index.
export function createScreener() {
  let cached = { version: null, issuers: null };
  return (snap) => {
    if (cached.version !== snap.version || !cached.issuers) cached = { version: snap.version, issuers: indexIssuers(snap.economic, { reportOwners: (rowId) => snap.rawById?.get(rowId)?.owners }) };
    return cached.issuers;
  };
}
