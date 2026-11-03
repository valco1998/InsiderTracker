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
const isoToEtStamp = (iso) => { const p = etParts(iso); return `${p.date} ${p.time} ET`; };

export function createBacktestPriceService({
  alpacaFactory = () => { const c = alpacaCredentials(); return c ? createAlpacaClient({ ...c, perMinute: Number(process.env.ALPACA_REQUESTS_PER_MINUTE) || 150 }) : null; },
  tiingo = null, // liveQuote.createQuoteService() — fallback (getPublicationStart, getQuotes)
  entriesFile = path.join(process.env.STOCK_DATA_DIR || DEFAULT_PRICE_DIR, "_publication-entries.v1.json"),
  includeOddLots = process.env.BACKTEST_INCLUDE_ODD_LOTS === "1",
  latestTtlMs = (Number(process.env.BACKTEST_LATEST_TTL_SECONDS) || 60) * 1000,
  entriesStatMs = 1000, // how often the entry-cache file is checked for writes by another process
  pricingConcurrency = Math.max(1, Math.min(6, Number(process.env.BACKTEST_PRICING_CONCURRENCY) || 3)),
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
  let lastStatAt = -Infinity;
  const loadEntries = () => {
    // Re-check the file for writes by another process at most once per second.
    if (entries && Date.now() - lastStatAt < entriesStatMs) return entries;
    lastStatAt = Date.now();
    const m = mtimeOf(entriesFile);
    if (!entries || (m && m !== entriesMtime)) {
      let disk = {};
      try { disk = JSON.parse(fs.readFileSync(entriesFile, "utf8")); } catch { disk = {}; }
      entries = { ...(entries || {}), ...disk };
      entriesMtime = m;
    }
    return entries;
  };
  // Writes are coalesced: one file write per 500 ms burst (the background queue may finish
  // many lookups in a row); flushEntries() writes immediately (CLI exit, queue drained).
  let saveTimer = null;
  const saveEntries = () => {
    if (saveTimer) return;
    saveTimer = setTimeout(flushEntries, 500);
    saveTimer.unref?.();
  };
  function flushEntries() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (!entries) return;
    try { fs.mkdirSync(path.dirname(entriesFile), { recursive: true }); fs.writeFileSync(`${entriesFile}.tmp`, JSON.stringify(entries)); fs.renameSync(`${entriesFile}.tmp`, entriesFile); entriesMtime = mtimeOf(entriesFile); }
    catch (err) { log.warn(`[BACKTEST_ENTRY_CACHE] write failed: ${String(err?.message || err).slice(0, 120)}`); }
  }
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
  // cachedOnly: never touches the network — kinds that need a lookup come back as
  // "lookup_queued" (the caller hands them to the background pricing queue).
  // Concurrent network lookups for the same signal share one computation (the background
  // queue and a queued strategy lookup can ask for the same acceptance-based entries).
  const entriesInflight = new Map();
  function getEntries(symbol, publishedAtET, opts = {}) {
    if (opts.cachedOnly) return getEntriesOnce(symbol, publishedAtET, opts);
    const k = `${String(symbol || "").toUpperCase()}|${publishedAtET}`;
    if (entriesInflight.has(k)) return entriesInflight.get(k);
    const p = getEntriesOnce(symbol, publishedAtET, opts).finally(() => entriesInflight.delete(k));
    entriesInflight.set(k, p);
    return p;
  }
  async function getEntriesOnce(symbol, publishedAtET, { budget = null, cachedOnly = false } = {}) {
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
      // A stored non-final state (e.g. awaiting_sip) stays visible while its re-check is queued.
      if (cachedOnly) { if (!rec[kind]) queued[kind] = { status: "lookup_queued" }; continue; }
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

  // Entry for a user strategy: first eligible trade at/after `startIso` (acceptance +
  // execution latency, moved to the next regular open for regularOnly). Cached under
  // "SYMBOL|at|startIso|kind". REUSE RULE (no request): when the entry already found from
  // the bare SEC acceptance (getEntries, same kind) is at/after startIso, it is by
  // definition also the first eligible trade at/after startIso — returned as is.
  // publishedAtET may be null (benchmark lookups: no acceptance-based record to reuse).
  // opts.prior: the acceptance-based entry the CALLER already read in this pass — the reuse
  // decision then uses that same snapshot (a page poll stays consistent even while the
  // background queue completes lookups). Omitted → read from the cache.
  async function getEntryAt(symbol, publishedAtET, startIso, { regularOnly = false, budget = null, cachedOnly = false, prior: given } = {}) {
    const sym = String(symbol || "").toUpperCase();
    if (!sym || !startIso || Number.isNaN(Date.parse(startIso))) return { status: "invalid_start_time" };
    const kind = regularOnly ? "regular" : "primary";
    const store = loadEntries();
    if (publishedAtET) {
      const pubIso = etToUtcIso(publishedAtET);
      const prior = given !== undefined ? given : pubIso ? store[`${sym}|${pubIso}`]?.[kind] : null;
      if (prior?.status === "ok" && Date.parse(prior.time) >= Date.parse(startIso)) return { ...prior, reused: true };
    }
    const key = `${sym}|at|${startIso}|${kind}`;
    const rec = store[key];
    if (!due(rec)) return rec;
    if (cachedOnly) return rec || { status: "lookup_queued" };
    if (budget && budget.left <= 0) return rec || { status: "lookup_queued" };
    if (budget) budget.left--;
    let r = await alpacaEntry(sym, startIso, { regularOnly });
    // Tiingo fallback only for regular-session entries (it has no extended hours) and only
    // when Alpaca cannot answer; its minute-bar start is searched from startIso itself.
    if (r == null) r = regularOnly && tiingo?.getPublicationStart ? await tiingoEntry(sym, isoToEtStamp(startIso)) : { status: "unavailable", provider: "none" };
    const out = { ...r, checkedAt: new Date(now()).toISOString() };
    store[key] = out;
    saveEntries();
    return out;
  }

  // ---- Daily SIP closes (split-adjusted, today's share terms) for fixed horizons ----
  const dailyDirOf = (adj) => path.join(path.dirname(entriesFile), `alpaca-daily-${adj}`);
  const dailyMem = new Map(); // "adj|symbol" → { from, through, closes: Map }
  const latestClosed = () => {
    let d = etParts(new Date(now()).toISOString()).date;
    if (!isSession(d) || !sessionClosed(d, now())) d = previousSession(d);
    return d;
  };
  const readDaily = (sym, adj = "split") => {
    const mk = `${adj}|${sym}`;
    if (dailyMem.has(mk)) return dailyMem.get(mk);
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dailyDirOf(adj), `${sym.replace(/[^A-Z0-9.]/g, "_")}.json`), "utf8"));
      const rec = { from: j.from, through: j.through, closes: new Map(Object.entries(j.closes || {})) };
      dailyMem.set(mk, rec);
      return rec;
    } catch { return null; }
  };
  const writeDaily = (sym, rec, adj = "split") => {
    dailyMem.set(`${adj}|${sym}`, rec);
    try {
      const dir = dailyDirOf(adj);
      fs.mkdirSync(dir, { recursive: true });
      const f = path.join(dir, `${sym.replace(/[^A-Z0-9.]/g, "_")}.json`);
      fs.writeFileSync(`${f}.tmp`, JSON.stringify({ symbol: sym, from: rec.from, through: rec.through, source: `alpaca_sip_daily_${adj}`, closes: Object.fromEntries(rec.closes) }));
      fs.renameSync(`${f}.tmp`, f);
    } catch (err) { log.warn(`[BACKTEST_DAILY_CACHE] write failed: ${String(err?.message || err).slice(0, 120)}`); }
  };

  // → { SYMBOL: Map(date → close) | null }  (null = could not load; never an empty "no data" guess)
  async function getDailyCloses(symbols, { from, adjustment = "split" }) {
    const adj = adjustment === "raw" ? "raw" : "split";
    const syms = [...new Set(symbols.map((s) => String(s || "").toUpperCase()).filter(Boolean))];
    const through = latestClosed();
    const out = {}, stale = [];
    for (const s of syms) {
      const c = readDaily(s, adj);
      if (c && c.from <= from && c.through >= through) out[s] = c.closes; else stale.push(s);
    }
    const client = stale.length ? getAlpaca() : null;
    if (!client) { for (const s of stale) out[s] = readDaily(s, adj)?.closes || null; return out; }
    const endIso = new Date(Math.min(Date.parse(`${through}T23:59:59Z`), now() - SIP_DELAY_MS)).toISOString();
    for (let i = 0; i < stale.length; i += 100) {
      const chunk = stale.slice(i, i + 100);
      const got = Object.fromEntries(chunk.map((s) => [s, new Map()]));
      let token = null, ok = true;
      const invalid = new Set(); // symbols Alpaca rejected — excluded from later pages too
      try {
        do {
          const r = await withoutInvalidSymbols(chunk.filter((x) => !invalid.has(x)), (syms) => client.barsMultiPage(syms, { start: `${from}T00:00:00Z`, end: endIso, adjustment: adj, pageToken: token, priority: true }), invalid);
          for (const [s, bars] of Object.entries(r?.bars || {})) for (const b of bars || []) if (b?.c > 0 && got[s]) got[s].set(etParts(b.t).date, b.c);
          token = r?.next || null;
        } while (token);
      } catch (err) {
        ok = false;
        if (err instanceof AlpacaAuthError) alpacaDisabled = "auth_failed";
        log.warn(`[ALPACA_DAILY] symbols=${chunk.length} error=${String(err?.message || err).slice(0, 120)}`);
      }
      for (const s of chunk) {
        if (invalid.has(s)) { out[s] = null; continue; } // unsupported symbol: no data, never an empty series cached
        if (!ok) { out[s] = readDaily(s, adj)?.closes || null; continue; }
        writeDaily(s, { from, through, closes: got[s] }, adj);
        out[s] = got[s];
      }
    }
    return out;
  }

  // Latest available price per symbol (IEX last trade on Basic), cached latestTtlMs.
  // Alpaca rejects a WHOLE multi-symbol request when one symbol is invalid (HTTP 400
  // "invalid symbol: X"). Drop the offending symbol (reported as unsupported) and retry the
  // rest, so one malformed ticker never blanks every row. At most 10 retries per call.
  async function withoutInvalidSymbols(symbols, fn, invalid) {
    let syms = [...symbols];
    for (let i = 0; i < 10 && syms.length; i++) {
      try { return await fn(syms); } catch (err) {
        const m = /invalid symbol:\s*([A-Za-z0-9.\-/]+)/i.exec(String(err?.message || ""));
        if (!m) throw err;
        const bad = m[1].toUpperCase();
        if (!syms.includes(bad)) throw err;
        invalid.add(bad);
        log.warn(`[ALPACA_INVALID_SYMBOL] symbol=${bad} — excluded from the batch, reported as unsupported`);
        syms = syms.filter((x) => x !== bad);
      }
    }
    return syms.length ? fn(syms) : {};
  }

  async function getLatest(symbols) {
    const syms = [...new Set(symbols.map((s) => String(s || "").toUpperCase()).filter(Boolean))];
    const out = {}, need = [];
    for (const s of syms) { const h = latestCache.get(s); if (h && now() - h.at < latestTtlMs) out[s] = h.rec; else need.push(s); }
    const client = need.length ? getAlpaca() : null;
    if (client) {
      try {
        const invalid = new Set();
        const trades = await withoutInvalidSymbols(need, (syms) => client.latestTrades(syms, { feed: "iex", priority: true }), invalid);
        for (const s of invalid) out[s] = { status: "unsupported_symbol", provider: "alpaca" };
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

  // ---- Background pricing queue: entry lookups run OUTSIDE HTTP requests ----
  // Deduplicated per signal (symbol + publication), at most `concurrency` lookups in
  // flight; every request still passes the Alpaca client's per-minute limiter.
  const pq = new Map(), pInflight = new Set();
  const pStats = { done: 0, failed: 0 };
  let pActive = 0;
  const pumpQueue = () => {
    while (pActive < pricingConcurrency && pq.size) {
      const [k, v] = pq.entries().next().value;
      pq.delete(k); pInflight.add(k); pActive++;
      (v.run ? v.run() : getEntries(v.symbol, v.publishedAtET))
        .then(() => { pStats.done++; })
        .catch((err) => { pStats.failed++; log.warn(`[BACKTEST_PRICING] key=${k} error=${String(err?.message || err).slice(0, 120)}`); })
        .finally(() => { pActive--; pInflight.delete(k); if (!pq.size && !pActive) flushEntries(); pumpQueue(); });
    }
  };
  function enqueueEntries(symbol, publishedAtET) {
    const k = `${String(symbol || "").toUpperCase()}|${publishedAtET}`;
    if (pq.has(k) || pInflight.has(k)) return false;
    pq.set(k, { symbol, publishedAtET });
    pumpQueue();
    return true;
  }
  // Background lookup for a strategy entry (getEntryAt), deduplicated by its cache key.
  function enqueueEntryAt(symbol, publishedAtET, startIso, { regularOnly = false } = {}) {
    const k = `${String(symbol || "").toUpperCase()}|at|${startIso}|${regularOnly ? "regular" : "primary"}`;
    if (pq.has(k) || pInflight.has(k)) return false;
    // The acceptance-based entries first (shared with their own queue item when in flight):
    // when they are already at/after startIso they are reused, with no extra request.
    pq.set(k, { run: async () => { if (publishedAtET) await getEntries(symbol, publishedAtET); return getEntryAt(symbol, publishedAtET, startIso, { regularOnly }); } });
    pumpQueue();
    return true;
  }
  const pricingStats = () => ({ queued: pq.size, inFlight: pActive, done: pStats.done, failed: pStats.failed });

  return {
    getEntries, getEntryAt, getLatest, getSplitFactor, getDailyCloses, enqueueEntries, enqueueEntryAt, pricingStats, flushEntries,
    stats: () => ({ alpaca: alpaca ? alpaca.stats() : null, alpacaDisabled, latestCached: latestCache.size, tiingo: tiingo?.stats?.() || null }),
  };
}
