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

import { buildIdentities, countedRows, detectClusters, easternToday, insiderActivity, isoDayDiff, windowCoverage, windowOf } from "./insiderInsights.js";

export const PERIODS = { "1d": 1, "7d": 7, "14d": 14, "30d": 30, "90d": 90 };
export const SORTS = new Set(["buyers", "value", "recent", "transactions"]);
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
  if (!SORTS.has(sort)) return { error: "sort must be buyers, value, recent or transactions" };
  const dir = q.dir === "asc" ? "asc" : "desc";
  const limit = q.limit === undefined || q.limit === "" ? 100 : Number(q.limit);
  const offset = q.offset === undefined || q.offset === "" ? 0 : Number(q.offset);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) return { error: `limit must be an integer from 1 to ${MAX_LIMIT}` };
  if (!Number.isInteger(offset) || offset < 0) return { error: "offset must be a non-negative integer" };
  const search = String(q.q || "").trim().slice(0, 80).toUpperCase();
  const flag = (v) => v === "1" || v === "true" || v === true;

  return {
    today, basis, period, win, minBuyers, minValue: minValue.value, maxValue: maxValue.value,
    openMarketOnly: flag(q.openMarket), clusterOnly: flag(q.cluster), search, sort, dir, limit, offset,
    since24h: period === "1d" && basis === "filingDate" ? easternStamp(now - 86_400_000) : null,
  };
}

// Per-version precomputation: issuer → { counted rows, identities, clusters }.
export function indexIssuers(economic, { reportOwners = null } = {}) {
  const groups = new Map();
  for (const r of countedRows(economic)) {
    const k = r.issuerCik ? `cik:${Number(r.issuerCik)}` : r.ticker ? `t:${String(r.ticker).toUpperCase()}` : null;
    if (!k) continue;
    (groups.get(k) || groups.set(k, []).get(k)).push(r);
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
export function summarizeIssuer(issuer, opt) {
  const rows = issuer.rows.filter((r) => inWindow(r, opt));
  const buys = rows.filter((r) => r.code === "P" && (!opt.openMarketOnly || r.purchaseContext === "open_market"));
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
  };
}

const SORT_FNS = {
  buyers: (a, b) => a.uniqueBuyers - b.uniqueBuyers || a.purchaseValue - b.purchaseValue,
  value: (a, b) => a.purchaseValue - b.purchaseValue || a.uniqueBuyers - b.uniqueBuyers,
  recent: (a, b) => String(a.latestPurchaseDate).localeCompare(String(b.latestPurchaseDate)) || String(a.latestFilingDate).localeCompare(String(b.latestFilingDate)),
  transactions: (a, b) => a.purchaseTransactions - b.purchaseTransactions || a.purchaseValue - b.purchaseValue,
};

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
    && (!opt.search || String(s.ticker || "").toUpperCase().includes(opt.search) || String(s.name || "").toUpperCase().includes(opt.search)));
  const m = opt.dir === "asc" ? 1 : -1;
  const cmp = SORT_FNS[opt.sort];
  matched.sort((a, b) => cmp(a, b) * m || String(a.ticker || "~").localeCompare(String(b.ticker || "~")));

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
    return t;
  }, { companies: matched.length, purchaseTransactions: 0, purchaseValue: 0 });
  totals.purchaseValue = Math.round(totals.purchaseValue * 100) / 100;

  return {
    window: { from: opt.win.from, to: opt.win.to, days: opt.win.days, period: opt.period, basis: opt.basis, today: opt.today, since: opt.since24h ? `${opt.since24h} ET` : null },
    filters: { minBuyers: opt.minBuyers, minValue: opt.minValue, maxValue: opt.maxValue, openMarketOnly: opt.openMarketOnly, clusterOnly: opt.clusterOnly, q: opt.search || null },
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
    },
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
