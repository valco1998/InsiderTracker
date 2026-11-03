// server/services/stockData/alpacaClient.js
//
// Alpaca market-data REST client — used ONLY by Backtesting
// (services/backtest/backtestPrices.js; see isolation.test.js). Documented v2
// endpoints on https://data.alpaca.markets:
//   GET /v2/stocks/{symbol}/trades       individual trades (ns timestamps, size, conditions)
//   GET /v2/stocks/{symbol}/bars         OHLCV bars (adjustment=raw|split)
//   GET /v2/stocks/trades/latest         latest trade for many symbols (feed=iex on Basic)
// Auth headers APCA-API-KEY-ID / APCA-API-SECRET-KEY from server/.env — never logged.
// Basic (free) plan, verified: SIP history from 2016 except the most recent 15
// minutes (HTTP 403 "subscription does not permit querying recent SIP data");
// latest SIP is not available (IEX only); 200 requests/minute (we keep a margin).

export class AlpacaAuthError extends Error {}
export class AlpacaForbiddenError extends Error {
  constructor(message) { super(message); this.recentSip = /recent SIP/i.test(message); }
}
export class AlpacaRateLimitError extends Error {}

const HOST = "https://data.alpaca.markets";
const MINUTE = 60_000;

export function alpacaCredentials(env = process.env) {
  const keyId = String(env.ALPACA_API_KEY_ID || "").trim(), secretKey = String(env.ALPACA_API_SECRET_KEY || "").trim();
  return keyId && secretKey ? { keyId, secretKey } : null;
}

export function createAlpacaClient({
  keyId, secretKey, fetchImpl = (u, i) => fetch(u, i), perMinute = 150, now = () => Date.now(),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = console, retries5xx = 2,
} = {}) {
  if (!keyId || !secretKey) throw new AlpacaAuthError("Alpaca credentials are not configured");
  const headers = { "APCA-API-KEY-ID": keyId, "APCA-API-SECRET-KEY": secretKey, Accept: "application/json" };
  const sent = [];
  let requests = 0;

  async function slot() {
    for (;;) {
      const t = now();
      while (sent.length && t - sent[0] >= MINUTE) sent.shift();
      if (sent.length < perMinute) { sent.push(t); return; }
      await sleep(sent[0] + MINUTE - t + 50);
    }
  }

  async function get(path, params = {}) {
    const u = new URL(`${HOST}${path}`);
    for (const [k, v] of Object.entries(params)) if (v != null && v !== "") u.searchParams.set(k, String(v));
    for (let attempt = 0; ; attempt++) {
      await slot();
      requests++;
      const res = await fetchImpl(u.toString(), { headers });
      if (res.status === 200) {
        try { return await res.json(); } catch { throw new Error("Alpaca returned a response that is not JSON"); }
      }
      let message = `HTTP ${res.status}`;
      try { const b = await res.json(); if (b?.message) message = String(b.message).slice(0, 200); } catch { /* html or empty */ }
      if (res.status === 401) throw new AlpacaAuthError(`Alpaca rejected the credentials (401)`);
      if (res.status === 403) throw new AlpacaForbiddenError(message);
      if (res.status === 429) throw new AlpacaRateLimitError("Alpaca rate limit reached (429)");
      if (res.status >= 500 && attempt < retries5xx) { await sleep(500 * 2 ** attempt); continue; }
      const e = new Error(`Alpaca ${message}`); e.status = res.status; throw e;
    }
  }

  return {
    stats: () => ({ requests, lastMinute: sent.length, perMinute }),
    // One page of trades → { trades: [{ t, p, s, x, c }], next }
    async tradesPage(symbol, { start, end, limit = 200, feed = "sip", pageToken = null }) {
      const b = await get(`/v2/stocks/${encodeURIComponent(symbol)}/trades`, { start, end, limit, feed, sort: "asc", page_token: pageToken });
      return { trades: Array.isArray(b?.trades) ? b.trades : [], next: b?.next_page_token || null };
    },
    async barsPage(symbol, { start, end, timeframe = "1Min", adjustment = "raw", feed = "sip", limit = 1000, pageToken = null }) {
      const b = await get(`/v2/stocks/${encodeURIComponent(symbol)}/bars`, { start, end, timeframe, adjustment, feed, limit, sort: "asc", page_token: pageToken });
      return { bars: Array.isArray(b?.bars) ? b.bars : [], next: b?.next_page_token || null };
    },
    // Bars for many symbols in one request (≤ 100 symbols) → { bars: { SYMBOL: [...] }, next }
    async barsMultiPage(symbols, { start, end, timeframe = "1Day", adjustment = "split", feed = "sip", limit = 10000, pageToken = null }) {
      const b = await get("/v2/stocks/bars", { symbols: symbols.join(","), start, end, timeframe, adjustment, feed, limit, sort: "asc", page_token: pageToken });
      return { bars: b?.bars && typeof b.bars === "object" ? b.bars : {}, next: b?.next_page_token || null };
    },
    // Latest trade per symbol (IEX on Basic) → { SYMBOL: { t, p, s, x, c } }
    async latestTrades(symbols, { feed = "iex" } = {}) {
      const out = {};
      for (let i = 0; i < symbols.length; i += 100) {
        const b = await get("/v2/stocks/trades/latest", { symbols: symbols.slice(i, i + 100).join(","), feed });
        Object.assign(out, b?.trades || {});
      }
      return out;
    },
  };
}
