// server/services/backtest/liveQuote.js
//
// Market data for the BACKTESTING module only (the only place in the web server
// allowed to contact Tiingo — see isolation.test.js):
//   • getQuote / getQuotes — current price (Tiingo IEX GET /iex/<ticker>). Without a
//     signed IEX agreement this is Tiingo's derived reference price (tngoLast, IEX
//     trading only — not the consolidated last sale); always with its timestamp.
//   • getPublicationStart — first IEX intraday trade minute at/after an SEC
//     publication time (GET /iex/<ticker>/prices). Found once, then cached on disk
//     permanently (it never changes); "not traded yet" results are re-checked later.
// One shared hourly request budget (TIINGO_QUOTES_PER_HOUR, default 30 — the
// Starter plan allows 50/hour in total). getQuotes() refreshes the stalest quotes
// first within the budget; the rest keep their last quote, marked stale with its
// timestamp. Never throws.

import fs from "node:fs";
import path from "node:path";
import { createTiingoClient } from "../stockData/tiingoClient.js";
import { DEFAULT_PRICE_DIR } from "../stockData/stockDataProvider.js";
import { etToUtcIso, firstPriceAtOrAfter, publicationSession, resampleFor } from "./publicationStart.js";

const HOUR = 3_600_000;
const RECHECK_MS = 15 * 60_000; // re-check a start that has no trade yet

export function createQuoteService({
  token = () => (process.env.TIINGO_API_KEY || "").trim(),
  ttlMs = (Number(process.env.TIINGO_QUOTE_TTL_SECONDS) || 120) * 1000,
  maxPerHour = Number(process.env.TIINGO_QUOTES_PER_HOUR) || 30,
  clientFactory = (key) => createTiingoClient({ token: key, perHour: maxPerHour }),
  // v2: only volume-verified starts. The v1 file (pre-fix, could hold forward-filled
  // zero-volume minutes) is left untouched for audit and never read again.
  startsFile = path.join(process.env.STOCK_DATA_DIR || DEFAULT_PRICE_DIR, "_publication-starts.v2.json"),
  now = () => Date.now(),
  log = console,
} = {}) {
  const cache = new Map(); // symbol → { at, result }
  const sent = [];
  let client = null, clientKey = null;
  let starts = null; // key → start record

  const budgetLeft = () => { const t = now(); while (sent.length && t - sent[0] >= HOUR) sent.shift(); return maxPerHour - sent.length; };
  function tiingo() {
    const key = token();
    if (!key) return null;
    if (!client || clientKey !== key) { client = clientFactory(key); clientKey = key; }
    return client;
  }
  const errStatus = (err) => { const k = err?.constructor?.name; return k === "TiingoAuthError" ? "invalid_key" : k === "TiingoRateLimitError" ? "rate_limited" : "error"; };

  async function fetchQuote(sym) {
    const t = now();
    sent.push(t);
    let result;
    try {
      const q = await tiingo().iexQuote(sym);
      result = q ? { status: "ok", ...q, fetchedAt: new Date(t).toISOString() } : { status: "unavailable", symbol: sym };
    } catch (err) {
      result = { status: errStatus(err), symbol: sym };
      log.warn(`[TIINGO_QUOTE] symbol=${sym} status=${result.status} error=${String(err?.message || err).slice(0, 120)}`);
    }
    cache.set(sym, { at: t, result });
    return { ...result, cached: false };
  }

  async function getQuote(symbol) {
    const sym = String(symbol || "").toUpperCase();
    const hit = cache.get(sym);
    if (hit && now() - hit.at < ttlMs) return { ...hit.result, cached: true };
    if (!token()) return { status: "no_key", symbol: sym };
    if (budgetLeft() <= 0) return hit ? { ...hit.result, cached: true, stale: true } : { status: "quota", symbol: sym };
    return fetchQuote(sym);
  }

  // Many symbols: refresh the stalest first while budget remains; keep the rest.
  async function getQuotes(symbols) {
    const syms = [...new Set(symbols.map((s) => String(s || "").toUpperCase()).filter(Boolean))];
    const out = {};
    if (!token()) { for (const s of syms) out[s] = { status: "no_key", symbol: s }; return out; }
    const due = syms.filter((s) => { const h = cache.get(s); return !h || now() - h.at >= ttlMs; })
      .sort((a, b) => (cache.get(a)?.at ?? -1) - (cache.get(b)?.at ?? -1));
    for (const s of due) { if (budgetLeft() <= 0) break; out[s] = await fetchQuote(s); }
    for (const s of syms) {
      if (out[s]) continue;
      const h = cache.get(s);
      out[s] = h ? { ...h.result, cached: true, stale: now() - h.at >= ttlMs } : { status: "quota", symbol: s };
    }
    return out;
  }

  function loadStarts() {
    if (starts) return starts;
    try { starts = JSON.parse(fs.readFileSync(startsFile, "utf8")); } catch { starts = {}; }
    return starts;
  }
  function saveStarts() {
    try { fs.mkdirSync(path.dirname(startsFile), { recursive: true }); fs.writeFileSync(`${startsFile}.tmp`, JSON.stringify(starts)); fs.renameSync(`${startsFile}.tmp`, startsFile); }
    catch (err) { log.warn(`[TIINGO_START_CACHE] write failed: ${String(err?.message || err).slice(0, 120)}`); }
  }

  // First IEX trade minute at/after the SEC publication time ("YYYY-MM-DD HH:MM:SS ET").
  async function getPublicationStart(symbol, publishedAtET) {
    const sym = String(symbol || "").toUpperCase();
    const publishedIso = etToUtcIso(publishedAtET);
    if (!publishedIso) return { status: "invalid_publication_time" };
    const key = `${sym}|${publishedIso}`;
    const st = loadStarts();
    const hit = st[key];
    if (hit?.status === "ok" && hit.schema === 2 && Number(hit.volume) > 0) return hit; // revalidated on read
    if (hit && now() - Date.parse(hit.checkedAt) < RECHECK_MS) return hit;
    if (!token()) return { status: "no_key" };
    if (budgetLeft() <= 0) return { status: "quota" };
    const t = now();
    sent.push(t);
    const session = publicationSession(publishedAtET);
    const resample = resampleFor(publishedIso, t);
    let rec;
    try {
      const bars = await tiingo().iexIntraday(sym, { startDate: publishedAtET.slice(0, 10), resampleFreq: resample });
      const first = bars ? firstPriceAtOrAfter(bars, publishedIso) : null;
      rec = bars == null ? { status: "unknown_ticker" }
        : first ? { status: "ok", price: first.price, time: first.time, volume: first.volume, resolution: resample, session, source: "tiingo_iex_intraday", basis: "iex_minute_bar", schema: 2 }
          : { status: "awaiting_first_trade", session };
    } catch (err) {
      rec = { status: errStatus(err) };
      log.warn(`[TIINGO_START] symbol=${sym} status=${rec.status} error=${String(err?.message || err).slice(0, 120)}`);
    }
    rec = { ...rec, symbol: sym, publishedIso, checkedAt: new Date(t).toISOString() };
    if (rec.status === "ok" || rec.status === "awaiting_first_trade" || rec.status === "unknown_ticker") { st[key] = rec; saveStarts(); }
    return rec;
  }

  return { getQuote, getQuotes, getPublicationStart, stats: () => ({ cached: cache.size, requestsLastHour: sent.length, maxPerHour, ttlMs }) };
}
