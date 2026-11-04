// SYNTHETIC test fixtures for the backtest tests (no real SEC data or prices implied).
import { buildSnapshot } from "../edgar/insiderSnapshot.js";
import { buildHistoryDataset } from "./form4History.js";
import { detectSignals } from "./signals.js";
import { sessionsBetween } from "./sessionCalendar.js";

export const OWNERS = {
  CEO: { cik: "0000000101", name: "Alpha Ann", role: "Chief Executive Officer", isOfficer: true, isDirector: true },
  CFO: { cik: "0000000102", name: "Beta Bob", role: "Chief Financial Officer", isOfficer: true },
  COO: { cik: "0000000103", name: "Gamma Gil", role: "Chief Operating Officer", isOfficer: true },
  VP: { cik: "0000000104", name: "Delta Dee", role: "EVP, Sales", isOfficer: true },
  DIR: { cik: "0000000105", name: "Eps Eve", role: "Director", isDirector: true },
  DIR2: { cik: "0000000106", name: "Zeta Zed", role: "Director", isDirector: true },
  FUND: { cik: "0000000201", name: "Big Fund LP", role: "10% Owner", isTenPercentOwner: true },
  FUND_GP: { cik: "0000000202", name: "Big Fund GP LLC", role: "10% Owner", isTenPercentOwner: true },
};

let seq = 0;
export function resetSeq() { seq = 0; }

// One raw Form 4 row (shape of form4Parser output).
// Default purchase: 3,000 shares × $50 = $150,000 (two default buyers = $300,000 > $250,000).
export function tx({ owners, date, accepted, code = "P", shares = 3000, price = 50, footnotes = [], issuerCik = "0000005000", ticker = "ACME", formType = "4",
  ownership = "D", nature = null, sharesOwnedAfter = null, context = "open_market", accessionNo = null, filingDate = null } = {}) {
  const acc = accessionNo || `0000000000-26-${String(++seq).padStart(6, "0")}`;
  return {
    id: `${acc}:0`, accessionNo: acc, formType, issuerCik, issuerName: `${ticker} Corp`, ticker,
    insiderName: owners[0].name, insiderCik: owners[0].cik, role: owners.map((o) => o.role).join("; "), owners,
    code, type: code === "P" ? "Purchase" : "Sale", securityTitle: "Common Stock", shares, price, value: price == null ? null : shares * price,
    reported: { pricePerShare: price == null ? "" : String(price), shares: String(shares) }, acquiredDisposed: code === "P" ? "A" : "D",
    sharesOwnedAfter: sharesOwnedAfter ?? 100_000 + seq, ownership, natureOfOwnership: nature, footnotes, remarks: null,
    purchaseContext: code === "P" ? context : null, is10b5_1: false,
    transactionDate: date, filingDate: filingDate || accepted.slice(0, 10), acceptedAtET: `${accepted} ET`,
    filingUrl: `https://www.sec.gov/Archives/edgar/data/5000/${acc.replace(/-/g, "")}/${acc}-index.htm`, tickerReported: ticker, tickerSymbols: [ticker],
  };
}

// Runs the REAL pipeline: snapshot (price checks, Form 4/A, duplicates) → signals.
export function signalsFor(transactions, { amendmentFilings = [], config = {}, range = {}, cutoff = null } = {}) {
  const cut = (s) => !cutoff || String(s).replace(/ ET$/, "") <= cutoff;
  const t = transactions.filter((r) => cut(r.acceptedAtET));
  const a = amendmentFilings.filter((r) => cut(r.acceptedAtET));
  const ds = buildHistoryDataset({ store: { records: new Map() }, live: { transactions: t, amendmentFilings: a } });
  const snap = buildSnapshot({ transactions: ds.transactions, amendmentFilings: ds.amendmentFilings });
  return detectSignals({ rows: snap.economic, acceptedAtByAccession: ds.acceptedAtByAccession, config, range, reportOwners: (id) => snap.rawById.get(id)?.owners, reportRow: (id) => snap.rawById.get(id) });
}

// Synthetic daily bars on every NYSE session in [from, to].
// priceOf(date, i) → { open, close, adjClose? }
export function barsFor(from, to, priceOf) {
  return sessionsBetween(from, to).map((date, i) => {
    const p = priceOf(date, i);
    return { date, open: p.open, high: Math.max(p.open, p.close), low: Math.min(p.open, p.close), close: p.close, adjClose: p.adjClose ?? p.close, volume: 1000, marketCap: p.marketCap ?? null };
  });
}

export function fakeProvider(series, { benchmarkSymbol = "SPY", symbols = null } = {}) {
  return {
    name: "test", available: true, reason: null, benchmarkSymbol, capabilities: { adjusted: true, delisted: true, marketCap: true, identityMap: !!symbols },
    async getDailyBars(symbol, { from = "0000", to = "9999" } = {}) { return (series[symbol] || []).filter((b) => b.date >= from && b.date <= to); },
    async resolveSymbol({ ticker }) { return series[ticker] ? ticker : null; },
  };
}
