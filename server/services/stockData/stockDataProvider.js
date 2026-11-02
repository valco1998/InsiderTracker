// server/services/stockData/stockDataProvider.js
//
// Stock-data provider interface (stock prices, OHLC bars, market cap, P/E, EPS).
//
// SEC EDGAR has no market prices. Licensed price data needs a provider whose
// terms allow this use (and display, if shown publicly). With no provider
// configured, the default provider reports "not configured" and NEVER returns
// values. The company page uses TradingView's official embeddable widgets
// (delayed data, TradingView-hosted, TradingView attribution kept) for its chart
// and quote — those widgets do not expose an API for historical prices and are
// never used as a data source.
//
// A provider implements:
//   name                       string
//   available                  boolean
//   reason                     string | null   (why unavailable)
//   delayed                    { minutes } | null  (must be disclosed in the UI)
//   capabilities               { adjusted, delisted, marketCap, identityMap }
//   benchmarkSymbol            string (S&P 500 proxy used by the backtest)
//   getDailyBars(symbol, { from, to })
//       → [{ date, open, high, low, close, adjClose, volume, marketCap? }]
//         adjClose: split- AND dividend-adjusted close, as delivered by the vendor.
//   resolveSymbol({ cik, ticker, asOf }) → symbol | null
//       Point-in-time: the symbol the issuer traded under on `asOf`.
//   getQuote(symbol)            → { price, change, changePct, volume, marketCap, pe, eps, asOf }
// Values must come from the provider verbatim; missing fields stay null.
//
// Implemented providers (STOCK_DATA_PROVIDER):
//   csv   Daily bars exported from a LICENSED vendor into STOCK_DATA_DIR:
//           <SYMBOL>.csv   header: date,open,high,low,close,adj_close,volume[,market_cap]
//           symbols.csv    optional identity map: cik,symbol,from,to
//                          (historical tickers; from/to inclusive, empty = open-ended)
//         STOCK_DATA_DIR defaults to server/.cache/prices (npm run backtest:prices).
//         Without symbols.csv the ticker reported on the Form 4 itself (the
//         symbol at filing time) is used. Whether the files may be used — and
//         displayed — is governed by the vendor's license, not by this code.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Default folder for STOCK_DATA_PROVIDER=csv (written by npm run backtest:prices; git-ignored).
export const DEFAULT_PRICE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".cache", "prices");

// Display licence of the configured price data (STOCK_DATA_LICENSE):
//   "internal" (default) — price data and anything derived from it (returns,
//                          performance) may only be shown on this machine
//                          (enforced by the backtest API);
//   "public"             — set ONLY when the vendor licence permits public display.
export const priceLicence = (v = process.env.STOCK_DATA_LICENSE) => (String(v || "").trim().toLowerCase() === "public" ? "public" : "internal");

export class MarketDataUnavailable extends Error {}

const notConfigured = {
  name: null,
  available: false,
  reason: "No licensed market-data provider is configured (STOCK_DATA_PROVIDER is not set).",
  delayed: null,
  capabilities: { adjusted: false, delisted: false, marketCap: false, identityMap: false },
  benchmarkSymbol: null,
  async getDailyBars() { throw new MarketDataUnavailable(this.reason); },
  async resolveSymbol() { throw new MarketDataUnavailable(this.reason); },
  async getQuote() { throw new MarketDataUnavailable(this.reason); },
};

const SYMBOL_RE = /^[A-Z0-9][A-Z0-9.\-^]{0,14}$/;
const HEADER_ALIASES = {
  date: ["date"], open: ["open"], high: ["high"], low: ["low"], close: ["close"],
  adjClose: ["adj_close", "adjclose", "adj close", "adjusted_close", "adjustedclose"],
  volume: ["volume"], marketCap: ["market_cap", "marketcap"], splitFactor: ["split_factor", "splitfactor"],
};

// CSV text → bars (no quoted fields expected). Unknown columns ignored.
export function parseBarsCsv(text) {
  const lines = String(text || "").trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const head = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const col = {};
  for (const [k, names] of Object.entries(HEADER_ALIASES)) col[k] = head.findIndex((h) => names.includes(h));
  if (col.date < 0 || col.close < 0) throw new Error("CSV needs at least date and close columns");
  const num = (c, i) => (i < 0 || c[i] === undefined || c[i].trim() === "" ? null : Number(c[i]));
  return lines.slice(1).map((line) => {
    const c = line.split(",");
    return {
      date: (c[col.date] || "").trim().slice(0, 10),
      open: num(c, col.open), high: num(c, col.high), low: num(c, col.low), close: num(c, col.close),
      adjClose: num(c, col.adjClose), volume: num(c, col.volume), marketCap: num(c, col.marketCap),
      ...(col.splitFactor >= 0 ? { splitFactor: num(c, col.splitFactor) } : {}),
    };
  });
}

export function parseSymbolMap(text) {
  const lines = String(text || "").trim().split(/\r?\n/);
  const head = (lines[0] || "").split(",").map((h) => h.trim().toLowerCase());
  const iC = head.indexOf("cik"), iS = head.indexOf("symbol"), iF = head.indexOf("from"), iT = head.indexOf("to");
  if (iC < 0 || iS < 0) return [];
  return lines.slice(1).map((l) => l.split(",")).map((c) => ({
    cik: Number(c[iC]), symbol: String(c[iS] || "").trim().toUpperCase(),
    from: iF >= 0 ? (c[iF] || "").trim() || null : null, to: iT >= 0 ? (c[iT] || "").trim() || null : null,
  })).filter((r) => r.cik > 0 && SYMBOL_RE.test(r.symbol));
}

export function createCsvProvider({ dir, benchmarkSymbol = "SPY" } = {}) {
  const base = { ...notConfigured, name: "csv", delayed: null };
  if (!dir) return { ...base, reason: "STOCK_DATA_PROVIDER=csv needs STOCK_DATA_DIR (folder of licensed daily-bar CSV files)." };
  const root = path.resolve(dir);
  if (!fs.existsSync(root)) return { ...base, reason: `STOCK_DATA_DIR does not exist: ${root}` };
  const fileOf = (symbol) => {
    const s = String(symbol || "").toUpperCase();
    if (!SYMBOL_RE.test(s)) return null;
    const f = path.join(root, `${s}.csv`);
    return path.dirname(f) === root ? f : null; // no path traversal
  };
  let symbolMap = null;
  const loadMap = () => {
    if (symbolMap) return symbolMap;
    try { symbolMap = parseSymbolMap(fs.readFileSync(path.join(root, "symbols.csv"), "utf8")); } catch { symbolMap = []; }
    return symbolMap;
  };
  const hasMap = fs.existsSync(path.join(root, "symbols.csv"));
  const benchFile = fileOf(benchmarkSymbol);
  const available = !!benchFile && fs.existsSync(benchFile);
  return {
    ...base,
    available,
    reason: available ? null : `Benchmark file ${benchmarkSymbol}.csv is missing in STOCK_DATA_DIR.`,
    capabilities: { adjusted: true, delisted: true, marketCap: true, identityMap: hasMap },
    benchmarkSymbol,
    async getDailyBars(symbol, { from = "0000-00-00", to = "9999-99-99" } = {}) {
      const f = fileOf(symbol);
      if (!f || !fs.existsSync(f)) return [];
      return parseBarsCsv(await fs.promises.readFile(f, "utf8")).filter((b) => b.date >= from && b.date <= to);
    },
    async resolveSymbol({ cik, ticker, asOf }) {
      const map = loadMap().filter((r) => r.cik === Number(cik) && (!r.from || r.from <= asOf) && (!r.to || r.to >= asOf));
      if (map.length) return map[0].symbol;
      if (hasMap && loadMap().some((r) => r.cik === Number(cik))) return null; // mapped issuer, no symbol on that date
      const t = String(ticker || "").toUpperCase().replace(/-/g, ".");
      const f = fileOf(t);
      return f && fs.existsSync(f) ? t : null;
    },
  };
}

// Registry. Adding a vendor API provider requires approval of its license/terms
// and a credential in server/.env.
const PROVIDERS = {
  csv: () => ({
    ...createCsvProvider({ dir: process.env.STOCK_DATA_DIR || DEFAULT_PRICE_DIR, benchmarkSymbol: (process.env.STOCK_DATA_BENCHMARK || "SPY").toUpperCase() }),
    licence: priceLicence(),
  }),
};

// Historical price provider of the BACKTESTING module (STOCK_DATA_PROVIDER).
// Nothing else in the site uses it: company pages, the screener, live data and
// alerts never read these prices (see services/backtest/isolation.test.js).
export function getBacktestPriceProvider(name = process.env.STOCK_DATA_PROVIDER) {
  return getMarketDataProvider(name);
}

export function getMarketDataProvider(name = process.env.STOCK_DATA_PROVIDER) {
  const key = String(name || "").trim().toLowerCase();
  if (!key) return notConfigured;
  const factory = PROVIDERS[key];
  if (!factory) return { ...notConfigured, reason: `Stock-data provider "${key}" is not implemented.` };
  return factory();
}

// Public description for API responses (no secrets, no values).
// Shape is part of the company-insights API contract — do not add fields here.
// Site-wide market data (company pages): none is licensed for display. The
// backtest's internal-use price files are deliberately NOT reported here.
const SITE_MARKET_DATA = { ...notConfigured, reason: "No licensed market-data provider is configured for site-wide display (historical prices are used internally by Backtesting only)." };
export function describeMarketData(provider = SITE_MARKET_DATA) {
  return { provider: provider.name, available: !!provider.available, reason: provider.reason ?? null, delayed: provider.delayed ?? null };
}

// Backtest description: adds capabilities and the benchmark symbol; strips local
// file paths from the reason.
export function describePriceProvider(provider = getBacktestPriceProvider()) {
  return {
    provider: provider.name, available: !!provider.available,
    reason: provider.available ? null : (provider.reason || "").replace(/: [A-Z]:\\.*$|: \/.*$/, "") || null,
    delayed: provider.delayed ?? null,
    capabilities: provider.capabilities || null,
    benchmarkSymbol: provider.benchmarkSymbol || null,
    licence: provider.licence || "internal",
  };
}
