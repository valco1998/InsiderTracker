// server/services/stockData/stockDataProvider.js
//
// Stock-data provider interface (stock prices, OHLC bars, market cap, P/E, EPS).
//
// SEC EDGAR has no market prices. Licensed price data needs a provider whose
// terms allow display on this site; none is configured, so the default provider
// reports "not configured" and NEVER returns values. The company page then uses
// TradingView's official embeddable widgets (delayed data, TradingView-hosted,
// TradingView attribution kept) for the chart and quote — those widgets cannot
// receive our data, so insider markers on a price chart require a provider here.
//
// A provider implements:
//   name                       string
//   available                  boolean
//   reason                     string | null   (why unavailable)
//   delayed                    { minutes } | null  (must be disclosed in the UI)
//   getDailyBars(symbol, { from, to })  → [{ date, open, high, low, close, volume }]
//   getQuote(symbol)            → { price, change, changePct, volume, marketCap, pe, eps, asOf }
// Values must come from the provider verbatim; missing fields stay null.

export class MarketDataUnavailable extends Error {}

const notConfigured = {
  name: null,
  available: false,
  reason: "No licensed market-data provider is configured (STOCK_DATA_PROVIDER is not set).",
  delayed: null,
  async getDailyBars() { throw new MarketDataUnavailable(this.reason); },
  async getQuote() { throw new MarketDataUnavailable(this.reason); },
};

// Registry of implemented providers (none yet — adding one requires approval
// of its license/terms and a credential in server/.env).
const PROVIDERS = {};

export function getMarketDataProvider(name = process.env.STOCK_DATA_PROVIDER) {
  const key = String(name || "").trim().toLowerCase();
  if (!key) return notConfigured;
  const factory = PROVIDERS[key];
  if (!factory) return { ...notConfigured, reason: `Stock-data provider "${key}" is not implemented.` };
  return factory();
}

// Public description for API responses (no secrets, no values).
export function describeMarketData(provider = getMarketDataProvider()) {
  return { provider: provider.name, available: !!provider.available, reason: provider.reason ?? null, delayed: provider.delayed ?? null };
}
