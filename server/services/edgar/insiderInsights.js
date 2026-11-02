// server/services/edgar/insiderInsights.js
//
// Company insider intelligence — pure functions over the processed snapshot's
// ECONOMIC transactions (already price-checked, amendment-linked and grouped:
// confirmed duplicate reports by related filers are ONE row; see
// transactionGroups.js / amendments.js). Nothing here is estimated.
//
// Counting rules
//   • Purchases = Form 4 code "P", sales = code "S" (non-derivative table).
//     Code P is a purchase reported on Form 4; it is NOT always an
//     exchange-traded (open-market) purchase — see `purchaseContext`.
//   • Rows superseded by a Form 4/A are excluded entirely (the amendment counts).
//   • Window membership uses the TRADE date (transactionDate), never the filing date.
//   • Values: shares × reported price. Price anomalies and rows without a price
//     are counted as transactions but excluded from value sums (as computeTotals).
//   • A PERSON is identified by reporting-owner CIK (stable SEC identifier), not by
//     name. Owners that file JOINTLY on one Form 4 (e.g. an individual and the
//     trust/fund they control) are merged into one buyer, so one economic
//     purchase is never counted as several buyers. Owners without a CIK fall
//     back to their normalized name.
//   • Roles come from the filing's reporting-owner relationship. A person can
//     hold several roles (e.g. CEO + Director) and is counted in EACH role group.

import { isSuperseded } from "./amendments.js";
import { businessDaysBack, isBusinessDay } from "./businessDays.js";

export const ROLE_GROUPS = ["CEO", "CFO", "Director", "Officer", "10% Owner", "Other"];

const CEO_RE = /\b(chief executive officer|principal executive officer|co-?ceo|ceo)\b/i;
const CFO_RE = /\b(chief financial officer|principal financial officer|cfo)\b/i;

// One reporting owner → role groups (Set). `role` is the filing's title text.
export function ownerRoleGroups(o = {}) {
  const g = new Set();
  const text = String(o.role || "");
  if (CEO_RE.test(text)) g.add("CEO");
  if (CFO_RE.test(text)) g.add("CFO");
  if (o.isDirector) g.add("Director");
  if (o.isOfficer && !g.has("CEO") && !g.has("CFO")) g.add("Officer");
  if (o.isTenPercentOwner) g.add("10% Owner");
  if (!g.size) g.add("Other");
  return g;
}

// Role groups of a transaction row (union over its reporting owners), in
// ROLE_GROUPS order. Rows without owner detail fall back to the role text.
export function rowRoleGroups(r) {
  const g = new Set();
  const owners = r.owners?.length ? r.owners : [{ role: r.role }];
  for (const o of owners) for (const x of ownerRoleGroups(o)) g.add(x);
  if (g.size > 1) g.delete("Other");
  return ROLE_GROUPS.filter((x) => g.has(x));
}

const normName = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const ownerKey = (o) => (o.cik ? `cik:${Number(o.cik)}` : o.name ? `name:${normName(o.name)}` : null);
const ownersOf = (r) => (r.owners?.length ? r.owners : [{ cik: r.insiderCik, name: r.insiderName, role: r.role }]);

// Union-find of owner keys that appear together on a filing → stable person ids.
export function buildIdentities(rows) {
  const parent = new Map();
  const find = (k) => { let p = parent.get(k) ?? k; while (p !== (parent.get(p) ?? p)) p = parent.get(p) ?? p; return p; };
  const add = (k) => { if (!parent.has(k)) parent.set(k, k); };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb); };
  for (const r of rows) {
    const keys = ownersOf(r).map(ownerKey).filter(Boolean);
    keys.forEach(add);
    for (let i = 1; i < keys.length; i++) union(keys[0], keys[i]);
  }
  return { personOf: (r) => { const k = ownersOf(r).map(ownerKey).find(Boolean); return k ? find(k) : null; } };
}

const countable = (r) => (r.priceCheck?.status === "anomaly" || r.value == null ? null : r.value);
const round2 = (n) => Math.round(n * 100) / 100;

const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const isoDayDiff = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

// Calendar date in New York (EDGAR's timezone).
export function easternToday(nowMs = Date.now()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date(nowMs)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

// Inclusive window of `days` calendar days ending `to`.
export function windowOf({ days = 30, to, from } = {}) {
  const end = to;
  const start = from || addDays(end, -(days - 1));
  return { from: start, to: end, days: isoDayDiff(start, end) + 1 };
}

// Per-person aggregate over rows of one code.
function people(rows, personOf) {
  const map = new Map();
  for (const r of rows) {
    const id = personOf(r);
    if (!id) continue;
    let p = map.get(id);
    if (!p) { p = { id, names: new Map(), ciks: new Set(), roles: new Set(), transactions: 0, shares: 0, value: 0, valueMissing: 0, firstDate: null, lastDate: null, filings: new Map() }; map.set(id, p); }
    const primary = ownersOf(r)[0];
    if (primary?.name) p.names.set(primary.name, (p.names.get(primary.name) || 0) + 1);
    for (const o of ownersOf(r)) if (o.cik) p.ciks.add(String(o.cik));
    for (const g of rowRoleGroups(r)) p.roles.add(g);
    p.transactions++;
    if (r.shares != null) p.shares += r.shares;
    const v = countable(r);
    if (v == null) p.valueMissing++; else p.value += v;
    if (!p.firstDate || r.transactionDate < p.firstDate) p.firstDate = r.transactionDate;
    if (!p.lastDate || r.transactionDate > p.lastDate) p.lastDate = r.transactionDate;
    for (const rep of r.reportedBy || [r]) if (rep.accessionNo) p.filings.set(rep.accessionNo, { accessionNo: rep.accessionNo, url: rep.filingUrl || null, filingDate: rep.filingDate || null });
  }
  return [...map.values()].map((p) => {
    const roles = ROLE_GROUPS.filter((g) => p.roles.has(g));
    return {
      id: p.id,
      name: [...p.names.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || "Unknown",
      ciks: [...p.ciks].sort(),
      roles: roles.length > 1 ? roles.filter((g) => g !== "Other") : roles,
      transactions: p.transactions, shares: p.shares, value: round2(p.value), valueMissing: p.valueMissing,
      firstDate: p.firstDate, lastDate: p.lastDate,
      filings: [...p.filings.values()].sort((a, b) => (b.filingDate || "").localeCompare(a.filingDate || "")),
    };
  });
}

// Economic rows of one issuer that count (not superseded, P/S, has a trade date).
export function countedRows(rows) {
  return rows.filter((r) => !isSuperseded(r) && (r.code === "P" || r.code === "S") && /^\d{4}-\d{2}-\d{2}$/.test(r.transactionDate || ""));
}

// 30-day (or any window) buyer / seller statistics.
export function insiderActivity(rows, win, identities = buildIdentities(rows)) {
  const inWin = rows.filter((r) => r.transactionDate >= win.from && r.transactionDate <= win.to);
  const buys = inWin.filter((r) => r.code === "P");
  const sells = inWin.filter((r) => r.code === "S");
  const buyers = people(buys, identities.personOf).sort((a, b) => b.value - a.value || b.transactions - a.transactions || a.name.localeCompare(b.name));
  const sellers = people(sells, identities.personOf);
  const byRole = Object.fromEntries(ROLE_GROUPS.map((g) => [g, { buyers: 0, transactions: 0, value: 0 }]));
  for (const r of buys) {
    for (const g of rowRoleGroups(r)) {
      byRole[g].transactions++;
      const v = countable(r);
      if (v != null) byRole[g].value = round2(byRole[g].value + v);
    }
  }
  for (const b of buyers) for (const g of b.roles) byRole[g].buyers++;
  const dates = buys.map((r) => r.transactionDate).sort();
  const sum = (list) => round2(list.reduce((s, r) => s + (countable(r) ?? 0), 0));
  return {
    uniqueBuyers: buyers.length,
    purchaseTransactions: buys.length,
    purchaseValue: sum(buys),
    purchaseValueMissing: buys.filter((r) => countable(r) == null).length,
    purchaseShares: buys.reduce((s, r) => s + (r.shares ?? 0), 0),
    uniqueSellers: sellers.length,
    saleTransactions: sells.length,
    saleValue: sum(sells),
    firstPurchase: dates[0] || null,
    lastPurchase: dates[dates.length - 1] || null,
    byRole,
    buyers,
  };
}

// Cluster buying: >= threshold DISTINCT buyers whose purchases fall within a
// rolling `windowDays`-calendar-day window (trade dates). Overlapping qualifying
// windows are merged into one cluster (its span may then exceed windowDays;
// `peakBuyers` is the most distinct buyers inside any single window).
export function detectClusters(rows, { threshold = 3, windowDays = 30, identities = buildIdentities(rows) } = {}) {
  const buys = rows.filter((r) => r.code === "P").map((r) => ({ r, id: identities.personOf(r) })).filter((x) => x.id)
    .sort((a, b) => a.r.transactionDate.localeCompare(b.r.transactionDate));
  const qualifying = []; // [fromIdx, toIdx, distinct]
  let i = 0;
  for (let j = 0; j < buys.length; j++) {
    while (isoDayDiff(buys[i].r.transactionDate, buys[j].r.transactionDate) >= windowDays) i++;
    // Extend j over same-day purchases is handled naturally as j advances.
    const distinct = new Set(buys.slice(i, j + 1).map((x) => x.id)).size;
    if (distinct >= threshold) qualifying.push([i, j, distinct]);
  }
  const merged = [];
  for (const [a, b, d] of qualifying) {
    const last = merged[merged.length - 1];
    if (last && a <= last.to) { last.to = Math.max(last.to, b); last.peak = Math.max(last.peak, d); }
    else merged.push({ from: a, to: b, peak: d });
  }
  return merged.map((m) => {
    const slice = buys.slice(m.from, m.to + 1).map((x) => x.r);
    const act = insiderActivity(slice, { from: slice[0].transactionDate, to: slice[slice.length - 1].transactionDate }, identities);
    return {
      from: act.firstPurchase, to: act.lastPurchase, spanDays: isoDayDiff(act.firstPurchase, act.lastPurchase) + 1,
      distinctBuyers: act.uniqueBuyers, peakBuyers: m.peak, transactions: act.purchaseTransactions,
      value: act.purchaseValue, valueMissing: act.purchaseValueMissing,
      roles: ROLE_GROUPS.filter((g) => act.byRole[g].buyers > 0).map((g) => ({ role: g, buyers: act.byRole[g].buyers })),
      buyers: act.buyers.map((b) => ({ name: b.name, roles: b.roles, transactions: b.transactions, value: b.value, filings: b.filings })),
    };
  }).sort((a, b) => b.to.localeCompare(a.to));
}

// Is every SEC daily index that could contain a filing for a trade in `win` held?
// A trade on day D is filed on or after D, so the window is complete when every
// business day from win.from to the newest published index is indexed (or known
// to have no index), and no filing of those days failed or is still pending.
// Days after the newest published index come from the live feed only.
// coverage: ingest getCoverage() rows; noIndexDays: [iso]; latestIndexDay: iso.
export function windowCoverage(win, { coverage = [], noIndexDays = [], latestIndexDay = null, livePollOk = false } = {}) {
  const byDay = new Map(coverage.map((c) => [c.day, c]));
  const closed = new Set(noIndexDays);
  const end = latestIndexDay && latestIndexDay < win.to ? latestIndexDay : win.to;
  const days = end >= win.from ? businessDaysBack(end, 400, win.from).filter((d) => isBusinessDay(d)) : [];
  const missing = [], incomplete = [];
  for (const d of days) {
    const c = byDay.get(d);
    if (closed.has(d)) continue;
    if (!c) missing.push(d);
    else if (c.failed > 0 || c.pending > 0) incomplete.push(d);
  }
  // Earliest day from which coverage is contiguous up to `end`.
  let coveredFrom = null;
  for (const d of [...days].sort().reverse()) {
    const c = byDay.get(d);
    if (closed.has(d) || (c && !c.failed && !c.pending)) coveredFrom = d; else break;
  }
  const liveTail = latestIndexDay != null && latestIndexDay < win.to;
  const complete = !missing.length && !incomplete.length && (!liveTail || livePollOk);
  return {
    complete,
    coveredFrom,
    coveredTo: liveTail ? (livePollOk ? win.to : latestIndexDay) : end,
    missingDays: missing.sort(),
    incompleteDays: incomplete.sort(),
    liveFeedDays: liveTail ? { from: addDays(latestIndexDay, 1), to: win.to, pollOk: livePollOk } : null,
    note: complete
      ? "Every SEC daily index for this window is loaded. Form 4s filed late (after today) cannot be known yet."
      : `Partial data: SEC filings are loaded only from ${coveredFrom || "—"}${missing.length ? `; ${missing.length} business day(s) in the window are not loaded` : ""}${incomplete.length ? `; ${incomplete.length} day(s) still downloading or failed` : ""}.`,
  };
}

// Economic rows of one issuer: by issuer CIK when known (filed ticker text
// varies — "NYSE:FLG", "BRK.A, BRK.B"), else by the filed ticker symbols.
export function rowsForCompany(rows, { cik = null, ticker = "" } = {}) {
  if (cik != null && cik !== "") return rows.filter((r) => r.issuerCik && Number(r.issuerCik) === Number(cik));
  const q = String(ticker).toUpperCase().replace(/-/g, ".");
  const canon = (s) => String(s || "").toUpperCase().replace(/-/g, ".");
  return rows.filter((r) => canon(r.ticker) === q || (r.tickerSymbols || []).some((s) => canon(s) === q));
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PRESET_DAYS = new Set([7, 30, 90]);

// Full company insight payload. rows: economic rows of the issuer.
// query: { days=7|30|90 | from+to (custom), threshold=2..10 }.
export function companyInsights({ rows, company, query = {}, ingest = null, now = Date.now() }) {
  const today = easternToday(now);
  const threshold = query.threshold === undefined ? 3 : Number(query.threshold);
  if (!Number.isInteger(threshold) || threshold < 2 || threshold > 10) return { error: "threshold must be an integer from 2 to 10" };
  let win;
  if (query.from !== undefined || query.to !== undefined) {
    const from = String(query.from || ""), to = String(query.to || today);
    if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) return { error: "from/to must be YYYY-MM-DD with from <= to" };
    if (isoDayDiff(from, to) > 366) return { error: "custom range is limited to 366 days" };
    win = windowOf({ from, to: to > today ? today : to });
  } else {
    const days = query.days === undefined ? 30 : Number(query.days);
    if (!PRESET_DAYS.has(days)) return { error: "days must be 7, 30 or 90 (or use from/to)" };
    win = windowOf({ days, to: today });
  }

  const counted = countedRows(rows);
  const identities = buildIdentities(counted);
  const activity = insiderActivity(counted, win, identities);
  const clusterWindowDays = 30;
  const activeFrom = addDays(today, -(clusterWindowDays - 1));
  const clusters = detectClusters(counted, { threshold, windowDays: clusterWindowDays, identities })
    .map((c) => ({ ...c, active: c.to >= activeFrom }));

  const pollMs = ingest?.pollIntervalMs || 60_000;
  const livePollOk = !!ingest?.lastPollAt && now - Date.parse(ingest.lastPollAt) <= pollMs * 3;
  const coverage = windowCoverage(win, {
    coverage: ingest?.coverage || [], noIndexDays: ingest?.noIndexDays || [],
    latestIndexDay: ingest?.recovery?.latestExpectedDay ?? null, livePollOk,
  });
  // Clusters can only be detected inside the loaded SEC history.
  const tradeDates = counted.map((r) => r.transactionDate).sort();
  return {
    company,
    tradingView: tradingViewSymbol(company),
    window: { ...win, basis: "transactionDate", today },
    coverage,
    activity,
    clusters: {
      threshold, windowDays: clusterWindowDays, list: clusters,
      dataFrom: tradeDates[0] || null, dataTo: tradeDates[tradeDates.length - 1] || null,
      note: "Factual pattern in reported Form 4 purchases (code P) — not an investment recommendation.",
    },
    definitions: {
      purchase: "Form 4 transaction code P (purchase). Code P is not always an exchange-traded purchase — check the venue badge.",
      sale: "Form 4 transaction code S (sale).",
      uniqueInsider: "Distinct reporting owners by SEC CIK; joint filers on the same Form 4 count as one.",
      excluded: "Rows superseded by a Form 4/A; confirmed duplicate reports by related filers are counted once.",
    },
  };
}

// SEC exchange name (company_tickers_exchange.json) → TradingView symbol.
// SEC class tickers use "-" (BRK-B); TradingView uses "." (BRK.B).
const TV_EXCHANGE = { Nasdaq: "NASDAQ", NYSE: "NYSE", CBOE: "CBOE", OTC: "OTC" };
export function tradingViewSymbol(company) {
  if (!company?.ticker) return { symbol: null, supported: false, reason: "No exchange ticker on SEC's company list" };
  const ex = TV_EXCHANGE[company.exchange];
  if (!ex) return { symbol: null, supported: false, reason: company.exchange ? `Exchange "${company.exchange}" is not mapped to a chart provider` : "SEC lists no exchange for this ticker" };
  return { symbol: `${ex}:${String(company.ticker).toUpperCase().replace(/-/g, ".")}`, supported: true, reason: null };
}
