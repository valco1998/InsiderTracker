// server/services/backtest/liveQuote.js
//
// Current price for the BACKTESTING tracking panel only (the only place in the
// web server allowed to contact Tiingo — see isolation.test.js).
//
//   Source: Tiingo IEX endpoint GET /iex/<ticker> (documented). Without a signed
//   IEX market-data agreement, IEX's own last trade is not delivered; Tiingo's
//   derived reference price (tngoLast, IEX trading only — not the consolidated
//   tape) is used and labelled as such, always with its timestamp.
//   Budget: the Starter plan allows 50 requests/hour in total. Quotes are cached
//   per symbol (TIINGO_QUOTE_TTL_SECONDS, default 120) and capped per hour
//   (TIINGO_QUOTES_PER_HOUR, default 30) so the price fetch CLI keeps headroom.
//   Never throws: every outcome is a status the UI can show honestly.

import { createTiingoClient } from "../stockData/tiingoClient.js";

const HOUR = 3_600_000;

export function createQuoteService({
  token = () => (process.env.TIINGO_API_KEY || "").trim(),
  ttlMs = (Number(process.env.TIINGO_QUOTE_TTL_SECONDS) || 120) * 1000,
  maxPerHour = Number(process.env.TIINGO_QUOTES_PER_HOUR) || 30,
  clientFactory = (key) => createTiingoClient({ token: key, perHour: maxPerHour }),
  now = () => Date.now(),
  log = console,
} = {}) {
  const cache = new Map(); // symbol → { at, result }
  const sent = [];
  let client = null, clientKey = null;

  async function getQuote(symbol) {
    const sym = String(symbol || "").toUpperCase();
    const t = now();
    const hit = cache.get(sym);
    if (hit && t - hit.at < ttlMs) return { ...hit.result, cached: true };
    const key = token();
    if (!key) return { status: "no_key", symbol: sym };
    while (sent.length && t - sent[0] >= HOUR) sent.shift();
    if (sent.length >= maxPerHour) return hit ? { ...hit.result, cached: true, stale: true } : { status: "quota", symbol: sym };
    if (!client || clientKey !== key) { client = clientFactory(key); clientKey = key; }
    sent.push(t);
    let result;
    try {
      const q = await client.iexQuote(sym);
      result = q ? { status: "ok", ...q, fetchedAt: new Date(t).toISOString() } : { status: "unavailable", symbol: sym };
    } catch (err) {
      const kind = err?.constructor?.name;
      result = { status: kind === "TiingoAuthError" ? "invalid_key" : kind === "TiingoRateLimitError" ? "rate_limited" : "error", symbol: sym };
      log.warn(`[TIINGO_QUOTE] symbol=${sym} status=${result.status} error=${String(err?.message || err).slice(0, 120)}`);
    }
    cache.set(sym, { at: t, result });
    return { ...result, cached: false };
  }

  return { getQuote, stats: () => ({ cached: cache.size, requestsLastHour: sent.length, maxPerHour, ttlMs }) };
}
