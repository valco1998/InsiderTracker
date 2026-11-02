// Insider Tracker — pure aggregations over economic transaction rows
// (GET /api/insider/transactions, dedupe=true). Counting rules mirror the
// server's computeTotals (server/services/edgar/transactionGroups.js):
//   • superseded by a Form 4/A  → excluded entirely
//   • price anomaly             → counted as a transaction, value excluded
//   • value == null (no price)  → counted as a transaction, no value
// so chart sums equal the API `totals` for the same filters.

export const isSuperseded = (r) => r.amendment?.status === "superseded";
export const isCounted = (r) => !isSuperseded(r);
// Value that may be summed (null when excluded or not computable).
export const countableValue = (r) =>
  isSuperseded(r) || r.priceCheck?.status === "anomaly" || r.value == null ? null : r.value;

const insiderKey = (r) => r.insiderCik || r.insiderName || null;

function blankDay(day) {
  return { day, buyValue: 0, sellValue: 0, buyCount: 0, sellCount: 0 };
}

// Per-day purchase/sale value and count. dateKey: "filingDate" | "transactionDate".
export function byDay(rows, dateKey = "filingDate") {
  const map = new Map();
  for (const r of rows) {
    if (!isCounted(r)) continue;
    const d = r[dateKey];
    if (!d) continue;
    const b = map.get(d) || map.set(d, blankDay(d)).get(d);
    const v = countableValue(r);
    if (r.code === "P") { b.buyCount++; if (v != null) b.buyValue += v; }
    else if (r.code === "S") { b.sellCount++; if (v != null) b.sellValue += v; }
  }
  return [...map.values()].sort((a, b) => a.day.localeCompare(b.day));
}

// Per-issuer leaderboard (keyed by issuer CIK — filed ticker text varies).
export function byCompany(rows) {
  const map = new Map();
  for (const r of rows) {
    if (!isCounted(r)) continue;
    const k = r.issuerCik || r.ticker || r.issuerName;
    if (!k) continue;
    let c = map.get(k);
    if (!c) {
      c = { key: k, cik: r.issuerCik, ticker: r.ticker, name: r.issuerName, buyValue: 0, sellValue: 0, buyCount: 0, sellCount: 0, insiders: new Set(), lastFiled: "", lastTrade: "" };
      map.set(k, c);
    }
    if (!c.ticker && r.ticker) c.ticker = r.ticker;
    const v = countableValue(r);
    if (r.code === "P") { c.buyCount++; if (v != null) c.buyValue += v; }
    else if (r.code === "S") { c.sellCount++; if (v != null) c.sellValue += v; }
    const ik = insiderKey(r);
    if (ik) c.insiders.add(ik);
    if ((r.filingDate || "") > c.lastFiled) c.lastFiled = r.filingDate;
    if ((r.transactionDate || "") > c.lastTrade) c.lastTrade = r.transactionDate;
  }
  return [...map.values()].map((c) => ({
    ...c, insiders: c.insiders.size, count: c.buyCount + c.sellCount, net: c.buyValue - c.sellValue,
  }));
}

export function topCompanies(rows, code = "P", n = 10) {
  const field = code === "P" ? "buyValue" : "sellValue";
  return byCompany(rows).filter((c) => c[field] > 0).sort((a, b) => b[field] - a[field]).slice(0, n);
}

// Distinct issuers and primary reporting insiders among counted rows.
export function uniqueCounts(rows) {
  const companies = new Set(), insiders = new Set();
  for (const r of rows) {
    if (!isCounted(r)) continue;
    if (r.issuerCik) companies.add(r.issuerCik);
    const ik = insiderKey(r);
    if (ik) insiders.add(ik);
  }
  return { companies: companies.size, insiders: insiders.size };
}

// Per-insider summary (company detail view). Roles come from the filing.
export function byInsider(rows) {
  const map = new Map();
  for (const r of rows) {
    if (!isCounted(r)) continue;
    const k = insiderKey(r);
    if (!k) continue;
    let p = map.get(k);
    if (!p) { p = { key: k, name: r.insiderName, role: r.role, buyValue: 0, sellValue: 0, buyCount: 0, sellCount: 0, lastTrade: "", lastFiled: "", lastFilingUrl: null }; map.set(k, p); }
    const v = countableValue(r);
    if (r.code === "P") { p.buyCount++; if (v != null) p.buyValue += v; }
    else if (r.code === "S") { p.sellCount++; if (v != null) p.sellValue += v; }
    if ((r.transactionDate || "") > p.lastTrade) p.lastTrade = r.transactionDate;
    if ((r.filingDate || "") >= p.lastFiled) { p.lastFiled = r.filingDate; p.lastFilingUrl = r.filingUrl; if (r.role) p.role = r.role; }
  }
  return [...map.values()].sort((a, b) => (b.buyValue + b.sellValue) - (a.buyValue + a.sellValue));
}

// Scatter points: trade date (x) vs filing date (y). Superseded rows excluded;
// anomalous / unpriced rows are kept (size floor) but flagged.
export function timelinePoints(rows) {
  const out = [];
  for (const r of rows) {
    if (!isCounted(r) || !r.transactionDate || !r.filingDate) continue;
    out.push({
      id: r.id,
      trade: r.transactionDate,
      filed: r.filingDate,
      value: countableValue(r),
      code: r.code,
      ticker: r.ticker,
      issuer: r.issuerName,
      insider: r.insiderName,
      late: !!r.filingDelay?.late,
      businessDays: r.filingDelay?.businessDays ?? null,
      excluded: r.priceCheck?.status === "anomaly",
    });
  }
  return out;
}

// Inclusive list of YYYY-MM-DD days between two dates (UTC).
export function dayRange(first, last) {
  if (!first || !last) return [];
  const out = [];
  const end = Date.parse(`${last}T00:00:00Z`);
  for (let t = Date.parse(`${first}T00:00:00Z`); t <= end && out.length < 400; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

// Sum check against server totals (dev verification).
export function sumValues(rows) {
  let purchaseValue = 0, saleValue = 0, purchases = 0, sales = 0;
  for (const r of rows) {
    if (!isCounted(r)) continue;
    const v = countableValue(r);
    if (r.code === "P") { purchases++; if (v != null) purchaseValue += v; }
    if (r.code === "S") { sales++; if (v != null) saleValue += v; }
  }
  return { purchases, sales, purchaseValue: Math.round(purchaseValue * 100) / 100, saleValue: Math.round(saleValue * 100) / 100 };
}
