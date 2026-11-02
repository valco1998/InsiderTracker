// server/services/stockData/tiingoClient.js
//
// Tiingo end-of-day REST client — used ONLY by the Backtesting price fetch
// (scripts/fetchSignalPrices.mjs → services/backtest/priceFetch.js). The web
// server never calls Tiingo (see services/backtest/isolation.test.js).
//
// Documented endpoints only:
//   GET https://api.tiingo.com/tiingo/daily/<ticker>                → meta (name, exchangeCode, startDate, endDate)
//   GET https://api.tiingo.com/tiingo/daily/<ticker>/prices?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
//       → [{ date, open, high, low, close, volume, adjOpen, adjHigh, adjLow, adjClose, adjVolume, divCash, splitFactor }]
// Auth: header "Authorization: Token <TIINGO_API_KEY>" — the key is never logged
// and never put in a URL.
// Limits are per HOUR / DAY / MONTH (Tiingo does not rate-limit per second); this
// client keeps a sliding one-hour window of at most `perHour` requests. Daily and
// monthly quotas are enforced by priceFetch.js (persisted usage ledger).
// Licence: Tiingo Starter is "Internal Use Only — you may only use the data for
// your own personal use" (no display or sharing); see STOCK_DATA_LICENSE.

export class TiingoAuthError extends Error {}
export class TiingoRateLimitError extends Error {}
export class TiingoInvalidResponseError extends Error {}

// Free "Starter" plan limits (tiingo.com/about/pricing).
export const STARTER_LIMITS = Object.freeze({ symbolsPerMonth: 500, requestsPerHour: 50, requestsPerDay: 1000 });

const BASE = "https://api.tiingo.com/tiingo/daily";
const IEX_BASE = "https://api.tiingo.com/iex";

// IEX top-of-book row → current-price quote. Without a signed IEX market-data
// agreement the IEX fields (last, lastSaleTimestamp, bid/ask) are null and only
// Tiingo's DERIVED reference price (tngoLast) is available — it reflects IEX
// trading only, not the consolidated tape, and is labelled so.
export function toQuote(row) {
  if (!row || typeof row !== "object") return null;
  const iexLast = Number.isFinite(row.last) && row.last > 0 ? row.last : null;
  const ref = Number.isFinite(row.tngoLast) && row.tngoLast > 0 ? row.tngoLast : null;
  const price = iexLast ?? ref;
  const timestamp = (iexLast != null ? row.lastSaleTimestamp : null) || row.timestamp || null;
  if (price == null || !timestamp || Number.isNaN(Date.parse(timestamp))) return null;
  return {
    symbol: String(row.ticker || "").toUpperCase(), price, timestamp: new Date(Date.parse(timestamp)).toISOString(),
    source: iexLast != null ? "iex_last_trade" : "tiingo_iex_reference",
    prevClose: Number.isFinite(row.prevClose) ? row.prevClose : null,
  };
}
const HOUR = 3_600_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Our canonical symbol (Form 4 / SEC style, class with ".") → Tiingo ticker.
export const tiingoTicker = (symbol) => String(symbol || "").trim().toLowerCase().replace(/\./g, "-");

// Tiingo price rows → provider bars (verbatim values; date = first 10 chars).
// Rows without a numeric close and adjusted close are dropped — never repaired.
export function toBars(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => ({
    date: String(r?.date || "").slice(0, 10),
    open: r?.open ?? null, high: r?.high ?? null, low: r?.low ?? null, close: r?.close ?? null,
    adjClose: r?.adjClose ?? null, volume: r?.volume ?? null,
    splitFactor: r?.splitFactor ?? null, divCash: r?.divCash ?? null,
  })).filter((b) => DATE_RE.test(b.date) && Number.isFinite(b.close) && Number.isFinite(b.adjClose));
}

export function createTiingoClient({
  token, fetchImpl = (u, i) => fetch(u, i), perHour = 45, now = () => Date.now(),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = console,
} = {}) {
  if (!token) throw new TiingoAuthError("TIINGO_API_KEY is not set");
  const sent = []; // request timestamps within the last hour
  let requests = 0;

  async function slot() {
    for (;;) {
      const t = now();
      while (sent.length && t - sent[0] >= HOUR) sent.shift();
      if (sent.length < perHour) { sent.push(t); return; }
      const wait = sent[0] + HOUR - t + 1000;
      log.log(`[TIINGO_RATE_WAIT] waitMs=${wait} limitPerHour=${perHour}`);
      await sleep(wait);
    }
  }

  async function get(path) {
    await slot();
    requests++;
    const res = await fetchImpl(path.startsWith("https://") ? path : `${BASE}${path}`, { headers: { Authorization: `Token ${token}`, "Content-Type": "application/json" } });
    if (res.status === 404) return null;
    if (res.status === 401 || res.status === 403) throw new TiingoAuthError(`Tiingo rejected the API key (HTTP ${res.status})`);
    if (res.status === 429) throw new TiingoRateLimitError("Tiingo rate limit reached (HTTP 429) — try again later");
    if (!res.ok) { const e = new Error(`Tiingo HTTP ${res.status}`); e.status = res.status; throw e; }
    try { return await res.json(); } catch { throw new TiingoInvalidResponseError("Tiingo returned a response that is not JSON"); }
  }

  return {
    stats: () => ({ requests }),
    async meta(symbol) {
      const m = await get(`/${encodeURIComponent(tiingoTicker(symbol))}`);
      if (m == null) return null;
      if (typeof m !== "object" || Array.isArray(m)) throw new TiingoInvalidResponseError("unexpected meta response");
      return { ticker: m.ticker ?? null, name: m.name ?? null, exchangeCode: m.exchangeCode ?? null, startDate: m.startDate ?? null, endDate: m.endDate ?? null };
    },
    // Current price (documented endpoint GET /iex/<ticker>) → toQuote() or null.
    async iexQuote(symbol) {
      const rows = await get(`${IEX_BASE}/${encodeURIComponent(tiingoTicker(symbol))}`);
      if (rows == null) return null;
      const row = Array.isArray(rows) ? rows[0] : rows;
      if (row != null && typeof row !== "object") throw new TiingoInvalidResponseError("unexpected IEX response");
      return toQuote(row);
    },
    async dailyBars(symbol, { from, to }) {
      const q = `startDate=${encodeURIComponent(from)}&endDate=${encodeURIComponent(to)}`;
      const rows = await get(`/${encodeURIComponent(tiingoTicker(symbol))}/prices?${q}`);
      if (rows == null) return null;
      if (!Array.isArray(rows)) throw new TiingoInvalidResponseError("unexpected prices response (not a list)");
      return toBars(rows);
    },
  };
}
