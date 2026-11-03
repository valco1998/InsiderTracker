// server/services/backtest/backtestPrices.js
//
// Market prices for the Backtesting "SEC Publication → NOW" metrics.
// Provider order: Alpaca (primary) → Tiingo (fallback). Every price records its provider.
//
//   ENTRY (primary)  Alpaca SIP TRADES (exact, nanosecond timestamps): first eligible
//                    trade at/after the SEC acceptance time in any session (pre-market,
//                    regular, after-hours). Rules: entrySelection.js.
//   ENTRY (regular)  first eligible regular-session trade at/after publication (next
//                    session open when published outside regular hours).
//   Fallback entry   Tiingo IEX 1-minute bars, regular session only: first bar that
//                    starts at/after publication with volume > 0 — a minute-bar
//                    approximation, labelled as such. Tiingo has no extended hours, so
//                    a primary entry from the fallback is a regular-session entry.
//   LATEST           Alpaca IEX latest trade (Basic plan: IEX only — NOT the consolidated
//                    tape), batched for all symbols; fallback Tiingo IEX reference price.
//   SPLITS           factor = raw / split-adjusted close of the entry day (Alpaca daily
//                    bars); entry ÷ factor puts it in today's share terms.
//   Recent SIP       Basic cannot query SIP data from the last 15 minutes: such entries
//                    are "awaiting_sip" (no request is made) and retried automatically.
// Never fabricates: a missing price is a status, not a number.

import fs from "node:fs";
import path from "node:path";
import { alpacaCredentials, createAlpacaClient, AlpacaAuthError, AlpacaForbiddenError, AlpacaRateLimitError } from "../stockData/alpacaClient.js";
import { DEFAULT_PRICE_DIR } from "../stockData/stockDataProvider.js";
import { etToUtcIso } from "./publicationStart.js";
import { firstEligibleTrade, regularSearchStart, sessionOf, etParts } from "./entrySelection.js";
import { isSession, previousSession } from "./sessionCalendar.js";
import { sessionClosed } from "./horizonReturns.js";

const MIN = 60_000;
export const SIP_DELAY_MS = 16 * MIN; // Basic: no SIP data newer than 15 min (+1 min margin)
const RECHECK_AWAIT_MS = 5 * MIN;
const RECHECK_ERROR_MS = 15 * MIN;
const MAX_TRADE_PAGES = 10;

export function createBacktestPriceService({
  alpacaFactory = () => { const c = alpacaCredentials(); return c ? createAlpacaClient({ ...c, perMinute: Number(process.env.ALPACA_REQUESTS_PER_MINUTE) || 150 }) : null; },
  tiingo = null, // liveQuote.createQuoteService() — fallback (getPublicationStart, getQuotes)
  entriesFile = path.join(process.env.STOCK_DATA_DIR || DEFAULT_PRICE_DIR, "_publication-entries.v1.json"),
  includeOddLots = process.env.BACKTEST_INCLUDE_ODD_LOTS === "1",
  latestTtlMs = (Number(process.env.BACKTEST_LATEST_TTL_SECONDS) || 60) * 1000,
  now = () => Date.now(),
  log = console,
} = {}) {
  let alpaca, alpacaDisabled = null; // reason when unusable (no creds / 401)
  const getAlpaca = () => {
    if (alpacaDisabled) return null;
    if (alpaca === undefined) { try { alpaca = alpacaFactory(); } catch { alpaca = null; } if (!alpaca) alpacaDisabled = "not_configured"; }
    return alpaca;
  };
  // Entry cache, shared with the precompute CLI (another process): re-read when the
  // file changed on disk; disk records win (they are newer final entries).
  let entries = null, entriesMtime = 0;
  const mtimeOf = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };
  const loadEntries = () => {
    const m = mtimeOf(entriesFile);
    if (!entries || (m && m !== entriesMtime)) {
      let disk = {};
      try { disk = JSON.parse(fs.readFileSync(entriesFile, "utf8")); } catch { disk = {}; }
      entries = { ...(entries || {}), ...disk };
      entriesMtime = m;
    }
    return entries;
  };
  const saveEntries = () => {
    try { fs.mkdirSync(path.dirname(entriesFile), { recursive: true }); fs.writeFileSync(`${entriesFile}.tmp`, JSON.stringify(entries)); fs.renameSync(`${entriesFile}.tmp`, entriesFile); entriesMtime = mtimeOf(entriesFile); }
    catch (err) { log.warn(`[BACKTEST_ENTRY_CACHE] write failed: ${String(err?.message || err).slice(0, 120)}`); }
  };
  const latestCache = new Map(); // symbol → { at, rec }
  const splitCache = new Map();  // symbol|day → { at, rec }

  const isFinal = (r) => r?.status === "ok";
  const due = (r) => !r || (!isFinal(r) && now() - Date.parse(r.checkedAt || 0) >= (String(r.status).startsWith("awaiting") ? RECHECK_AWAIT_MS : RECHECK_ERROR_MS));

  // Alpaca trade search from `startIso` to the newest accessible SIP time.
  async function alpacaEntry(sym, startIso, { regularOnly }) {
    const client = getAlpaca();
    if (!client) return null;
    const accessibleEnd = now() - SIP_DELAY_MS;
    if (Date.parse(startIso) > accessibleEnd) {
      return { status: regularOnly && now() < Date.parse(startIso) ? "awaiting_regular_session" : "awaiting_sip", provider: "alpaca" };
    }
    const end = new Date(accessibleEnd).toISOString();
    let token = null;
    try {
      for (let page = 0; page < MAX_TRADE_PAGES; page++) {
        const r = await client.tradesPage(sym, { start: startIso, end, limit: 1000, pageToken: token });
        const t = firstEligibleTrade(r.trades, startIso, { regularOnly, includeOddLots });
        if (t) {
          return { status: "ok", provider: "alpaca", basis: "sip_trade", price: t.p, time: t.t, session: sessionOf(t.t), size: t.s, exchange: t.x || null, conditions: t.c || [] };
        }
        token = r.next;
        if (!token) break;
      }
      return { status: token ? "no_eligible_trade_in_scan" : (regularOnly ? "awaiting_regular_session_trade" : "awaiting_first_trade"), provider: "alpaca" };
    } catch (err) {
      if (err instanceof AlpacaForbiddenError && err.recentSip) return { status: "awaiting_sip", provider: "alpaca" };
      if (err instanceof AlpacaAuthError) { alpacaDisabled = "auth_failed"; log.warn("[ALPACA] credentials rejected (401) — falling back to Tiingo"); return null; }
      if (err instanceof AlpacaRateLimitError) return { status: "rate_limited", provider: "alpaca" };
      log.warn(`[ALPACA_ENTRY] symbol=${sym} error=${String(err?.message || err).slice(0, 120)}`);
      return null; // fall back
    }
  }

  async function tiingoEntry(sym, publishedAtET) {
    if (!tiingo?.getPublicationStart) return { status: "unavailable", provider: "none" };
    const s = await tiingo.getPublicationStart(sym, publishedAtET);
    if (s.status !== "ok") return { status: s.status, provider: "tiingo" };
    if (!(Number(s.volume) > 0)) return { status: "unavailable", provider: "tiingo" }; // never a forward-filled minute
    return { status: "ok", provider: "tiingo", basis: "iex_minute_bar", price: s.price, time: s.time, session: sessionOf(s.time), size: s.volume, exchange: "IEX", conditions: [] };
  }

  // budget: { left } — max NEW Alpaca lookups for this call (the page passes a small budget
  // so one request never waits minutes on the rate limit; the precompute CLI passes none).
  // Over budget → "lookup_queued" (not stored; looked up on a later call).
  async function getEntries(symbol, publishedAtET, { budget = null } = {}) {
    const sym = String(symbol || "").toUpperCase();
    const publishedIso = etToUtcIso(publishedAtET);
    if (!publishedIso) return { publishedIso: null, primary: { status: "invalid_publication_time" }, regular: { status: "invalid_publication_time" } };
    const key = `${sym}|${publishedIso}`;
    const store = loadEntries();
    const rec = store[key] || {};
    let changed = false;
    const queued = {};
    for (const kind of ["primary", "regular"]) {
      if (!due(rec[kind])) continue;
      if (budget && budget.left <= 0) { queued[kind] = { status: "lookup_queued" }; continue; }
      if (budget) budget.left--;
      const startIso = kind === "primary" ? publishedIso : regularSearchStart(publishedIso);
      let r = await alpacaEntry(sym, startIso, { regularOnly: kind === "regular" });
      // Fallback only when Alpaca cannot answer (not configured / error) — never for
      // "awaiting" states, so a pre-publication or stale price is never substituted.
      if (r == null) r = await tiingoEntry(sym, publishedAtET);
      rec[kind] = { ...r, checkedAt: new Date(now()).toISOString() };
      changed = true;
    }
    if (changed) { store[key] = rec; saveEntries(); }
    return { publishedIso, primary: queued.primary || rec.primary, regular: queued.regular || rec.regular };
  }

  // ---- Daily SIP closes (split-adjusted, today's share terms) for fixed horizons ----
  const dailyDir = path.join(path.dirname(entriesFile), "alpaca-daily-split");
  const dailyMem = new Map(); // symbol → { from, through, closes: Map }
  const latestClosed = () => {
    let d = etParts(new Date(now()).toISOString()).date;
    if (!isSession(d) || !sessionClosed(d, now())) d = previousSession(d);
    return d;
  };
  const readDaily = (sym) => {
    if (dailyMem.has(sym)) return dailyMem.get(sym);
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dailyDir, `${sym.replace(/[^A-Z0-9.]/g, "_")}.json`), "utf8"));
      const rec = { from: j.from, through: j.through, closes: new Map(Object.entries(j.closes || {})) };
      dailyMem.set(sym, rec);
      return rec;
    } catch { return null; }
  };
  const writeDaily = (sym, rec) => {
    dailyMem.set(sym, rec);
    try {
      fs.mkdirSync(dailyDir, { recursive: true });
      const f = path.join(dailyDir, `${sym.replace(/[^A-Z0-9.]/g, "_")}.json`);
      fs.writeFileSync(`${f}.tmp`, JSON.stringify({ symbol: sym, from: rec.from, through: rec.through, source: "alpaca_sip_daily_split", closes: Object.fromEntries(rec.closes) }));
      fs.renameSync(`${f}.tmp`, f);
    } catch (err) { log.warn(`[BACKTEST_DAILY_CACHE] write failed: ${String(err?.message || err).slice(0, 120)}`); }
  };

  // → { SYMBOL: Map(date → close) | null }  (null = could not load; never an empty "no data" guess)
  async function getDailyCloses(symbols, { from }) {
    const syms = [...new Set(symbols.map((s) => String(s || "").toUpperCase()).filter(Boolean))];
    const through = latestClosed();
    const out = {}, stale = [];
    for (const s of syms) {
      const c = readDaily(s);
      if (c && c.from <= from && c.through >= through) out[s] = c.closes; else stale.push(s);
    }
    const client = stale.length ? getAlpaca() : null;
    if (!client) { for (const s of stale) out[s] = readDaily(s)?.closes || null; return out; }
    const endIso = new Date(Math.min(Date.parse(`${through}T23:59:59Z`), now() - SIP_DELAY_MS)).toISOString();
    for (let i = 0; i < stale.length; i += 100) {
      const chunk = stale.slice(i, i + 100);
      const got = Object.fromEntries(chunk.map((s) => [s, new Map()]));
      let token = null, ok = true;
      try {
        do {
          const r = await client.barsMultiPage(chunk, { start: `${from}T00:00:00Z`, end: endIso, adjustment: "split", pageToken: token });
          for (const [s, bars] of Object.entries(r.bars)) for (const b of bars || []) if (b?.c > 0 && got[s]) got[s].set(etParts(b.t).date, b.c);
          token = r.next;
        } while (token);
      } catch (err) {
        ok = false;
        if (err instanceof AlpacaAuthError) alpacaDisabled = "auth_failed";
        log.warn(`[ALPACA_DAILY] symbols=${chunk.length} error=${String(err?.message || err).slice(0, 120)}`);
      }
      for (const s of chunk) {
        if (!ok) { out[s] = readDaily(s)?.closes || null; continue; }
        writeDaily(s, { from, through, closes: got[s] });
        out[s] = got[s];
      }
    }
    return out;
  }

  // Latest available price per symbol (IEX last trade on Basic), cached latestTtlMs.
  async function getLatest(symbols) {
    const syms = [...new Set(symbols.map((s) => String(s || "").toUpperCase()).filter(Boolean))];
    const out = {}, need = [];
    for (const s of syms) { const h = latestCache.get(s); if (h && now() - h.at < latestTtlMs) out[s] = h.rec; else need.push(s); }
    const client = need.length ? getAlpaca() : null;
    if (client) {
      try {
        const trades = await client.latestTrades(need, { feed: "iex" });
        for (const s of need) {
          const t = trades[s];
          if (t && t.p > 0 && !Number.isNaN(Date.parse(t.t))) {
            const rec = { status: "ok", price: t.p, time: t.t, provider: "alpaca", source: "iex_last_trade", exchange: "IEX" };
            out[s] = rec; latestCache.set(s, { at: now(), rec });
          }
        }
      } catch (err) {
        if (err instanceof AlpacaAuthError) alpacaDisabled = "auth_failed";
        log.warn(`[ALPACA_LATEST] error=${String(err?.message || err).slice(0, 120)}`);
      }
    }
    const rest = need.filter((s) => !out[s]);
    if (rest.length && tiingo?.getQuotes) {
      const q = await tiingo.getQuotes(rest);
      for (const s of rest) {
        const x = q[s];
        out[s] = x?.status === "ok"
          ? { status: "ok", price: x.price, time: x.timestamp, provider: "tiingo", source: x.source || "tiingo_iex_reference", stale: !!x.stale }
          : { status: x?.status || "unavailable", provider: "tiingo" };
      }
    }
    for (const s of syms) if (!out[s]) out[s] = { status: "unavailable", provider: "none" };
    return out;
  }

  // Split factor between an entry and today: raw ÷ split-adjusted close of the entry day.
  async function getSplitFactor(symbol, entryIso) {
    const sym = String(symbol || "").toUpperCase();
    const day = etParts(entryIso).date;
    if (day === etParts(new Date(now()).toISOString()).date) return { factor: 1, source: "same_day" };
    const k = `${sym}|${day}`;
    const h = splitCache.get(k);
    if (h && now() - h.at < 12 * 60 * MIN) return h.rec;
    const client = getAlpaca();
    if (!client) return null;
    try {
      const start = `${day}T00:00:00Z`, end = `${day}T23:59:59Z`;
      const raw = (await client.barsPage(sym, { start, end, timeframe: "1Day", adjustment: "raw", limit: 2 })).bars[0];
      const adj = (await client.barsPage(sym, { start, end, timeframe: "1Day", adjustment: "split", limit: 2 })).bars[0];
      if (!(raw?.c > 0) || !(adj?.c > 0)) return null;
      let factor = Math.round((raw.c / adj.c) * 1e4) / 1e4;
      if (Math.abs(factor - 1) < 1e-3) factor = 1;
      const rec = { factor, source: "alpaca_daily_raw_vs_split" };
      splitCache.set(k, { at: now(), rec });
      return rec;
    } catch (err) {
      if (err instanceof AlpacaAuthError) alpacaDisabled = "auth_failed";
      return null;
    }
  }

  return {
    getEntries, getLatest, getSplitFactor, getDailyCloses,
    stats: () => ({ alpaca: alpaca ? alpaca.stats() : null, alpacaDisabled, latestCached: latestCache.size, tiingo: tiingo?.stats?.() || null }),
  };
}
