// server/services/backtest/priceFetch.js
//
// Targeted historical-price collection for the BACKTESTING module only: just the
// tickers that have signals, from shortly before each company's first qualifying
// purchase through today, plus the benchmark. Output is the existing CSV
// provider format (stockDataProvider.js, provider "csv"):
//   <dir>/<SYMBOL>.csv          date,open,high,low,close,adj_close,volume,split_factor,div_cash
//   <dir>/<SYMBOL>.meta.json    source, vendor ticker/name, range, fetchedAt, licence, name check
//   <dir>/_fetch-manifest.json  last run summary
//   <dir>/_tiingo-usage.json    quota ledger: unique symbols this month, requests per day
//
// Data handling (Tiingo guidance, tiingo.com/kb "fastest method to ingest … EOD"):
// download a history once and keep it locally; refresh when stale. A refresh
// always re-downloads the WHOLE needed range (never appends), so split/dividend
// re-adjustments (splitFactor ≠ 1 / divCash > 0) are always picked up.
// Quotas (Starter): 500 unique symbols / month, 1,000 requests / day, 50 / hour —
// enforced before every request; a 429, an invalid key or an exhausted quota
// stops the run (the remaining symbols are reported, never guessed).
// Identity guard: the vendor's company name must match the SEC issuer name
// (tickers are reused by different companies over time).

import fs from "node:fs";
import path from "node:path";
import { lastClosedSession } from "./sessionCalendar.js";
// (No import of tiingoClient.js: the web server imports this module for
// readFetchManifest() and must never load the Tiingo client — see isolation.test.js.)
const STARTER_LIMITS = Object.freeze({ symbolsPerMonth: 500, requestsPerDay: 1000 }); // = tiingoClient.STARTER_LIMITS

const DAY = 86_400_000;
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
export const canonicalSymbol = (t) => String(t || "").trim().toUpperCase().replace(/-/g, ".");
const SYMBOL_RE = /^[A-Z0-9][A-Z0-9.\-^]{0,14}$/;
const REQUESTS_PER_SYMBOL = 2; // meta + prices

// Days of history kept before the earliest needed date (prior-decline filter of the backtest, baseline fallback).
export const LOOKBACK_DAYS = 120;

// signals → { requests: [{ symbol, from, to, issuers: [{cik,name}] }], skipped: [...] }
export function planPriceRequests(signals, { today, benchmarkSymbol = "SPY", lookbackDays = LOOKBACK_DAYS } = {}) {
  const bySymbol = new Map(), skipped = [];
  for (const s of signals) {
    const symbol = canonicalSymbol(s.ticker);
    if (!symbol || !SYMBOL_RE.test(symbol)) { skipped.push({ signalId: s.id, issuerCik: s.issuerCik, issuerName: s.issuerName, reason: "no_ticker_on_form4" }); continue; }
    const from = addDays([s.windowFrom, s.publishedDate].sort()[0], -lookbackDays);
    let r = bySymbol.get(symbol);
    if (!r) { r = { symbol, from, to: today, issuers: new Map() }; bySymbol.set(symbol, r); }
    if (from < r.from) r.from = from;
    r.issuers.set(s.issuerCik, s.issuerName || null);
  }
  const requests = [];
  for (const r of bySymbol.values()) {
    const issuers = [...r.issuers.entries()].map(([cik, name]) => ({ cik, name }));
    if (issuers.length > 1) { skipped.push({ symbol: r.symbol, reason: "ticker_used_by_several_issuers", issuers }); continue; }
    requests.push({ symbol: r.symbol, from: r.from, to: r.to, issuers });
  }
  requests.sort((a, b) => a.symbol.localeCompare(b.symbol));
  if (requests.length) {
    const from = requests.reduce((m, r) => (r.from < m ? r.from : m), requests[0].from);
    requests.unshift({ symbol: canonicalSymbol(benchmarkSymbol), from, to: today, issuers: [], benchmark: true });
  }
  return { requests, skipped };
}

const STOP = new Set(["inc", "incorporated", "corp", "corporation", "co", "company", "ltd", "limited", "plc", "llc", "lp", "the", "holdings", "holding", "group", "class", "common", "stock", "shares", "sa", "nv", "ag", "de", "fund", "trust", "and"]);
const tokens = (s) => String(s || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").split(" ").filter((t) => t && !STOP.has(t));

// Does the vendor's company name plausibly name the same issuer as SEC?
export function namesMatch(secName, vendorName) {
  const a = tokens(secName), b = new Set(tokens(vendorName));
  if (!a.length || !b.size) return null; // unknown
  return b.has(a[0]) || a.filter((t) => b.has(t)).length >= Math.min(2, a.length);
}

function readJson(f) { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } }
function writeAtomic(f, text) { fs.writeFileSync(`${f}.tmp`, text); fs.renameSync(`${f}.tmp`, f); }

export function barsToCsv(bars) {
  const v = (x) => (x == null || !Number.isFinite(Number(x)) ? "" : String(x));
  return ["date,open,high,low,close,adj_close,volume,split_factor,div_cash",
    ...bars.map((b) => [b.date, v(b.open), v(b.high), v(b.low), v(b.close), v(b.adjClose), v(b.volume), v(b.splitFactor), v(b.divCash)].join(","))].join("\n") + "\n";
}

// Is the stored file good enough for this request? It must cover `from` and be
// current to the last closed session — or have been fetched within the last 12 h
// (the vendor may publish the latest session a little later).
export function isUpToDate(meta, req, nowStamp, nowMs = Date.now()) {
  if (!meta || meta.status !== "ok" || !meta.lastBarDate) return false;
  if (meta.from > req.from) return false;
  if (meta.lastBarDate >= lastClosedSession(nowStamp)) return true;
  return nowMs - Date.parse(meta.fetchedAt || 0) < 12 * 3_600_000;
}

// ---- quota ledger --------------------------------------------------------------
export function readUsage(dir, { month, day }) {
  const u = readJson(path.join(dir, "_tiingo-usage.json")) || {};
  return {
    month, day,
    symbols: u.month === month ? new Set(u.symbols || []) : new Set(),
    requestsToday: u.day === day ? Number(u.requestsToday) || 0 : 0,
  };
}
export function writeUsage(dir, u) {
  writeAtomic(path.join(dir, "_tiingo-usage.json"), JSON.stringify({ month: u.month, symbols: [...u.symbols].sort(), day: u.day, requestsToday: u.requestsToday }, null, 1));
}

export function readFetchManifest(dir) {
  const m = readJson(path.join(dir, "_fetch-manifest.json"));
  if (!m) return null;
  const by = {};
  for (const r of m.results || []) by[r.status] = (by[r.status] || 0) + 1;
  return { source: m.source, licence: m.licence, ranAt: m.ranAt, stoppedReason: m.stoppedReason || null, byStatus: by, skipped: (m.skipped || []).length };
}

// client: tiingoClient. → manifest
export async function runPriceFetch({
  plan, client, dir, now = () => Date.now(), log = console, allowNameMismatch = false,
  licence = "Tiingo Starter — personal use only", isAborted = () => false,
  limits = { symbolsPerMonth: STARTER_LIMITS.symbolsPerMonth - 50, requestsPerDay: STARTER_LIMITS.requestsPerDay - 50 },
}) {
  fs.mkdirSync(dir, { recursive: true });
  const nowIso = new Date(now()).toISOString();
  const etDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(now()));
  const nowStamp = `${etDay} 23:59:59 ET`;
  const usage = readUsage(dir, { month: etDay.slice(0, 7), day: etDay });
  const results = [];
  let stoppedReason = null;
  for (const req of plan.requests) {
    if (stoppedReason || isAborted()) { results.push({ symbol: req.symbol, status: stoppedReason ? "not_attempted" : "aborted" }); continue; }
    const metaFile = path.join(dir, `${req.symbol}.meta.json`);
    const prev = readJson(metaFile);
    if (isUpToDate(prev, req, nowStamp, now())) { results.push({ symbol: req.symbol, status: "up_to_date", lastBarDate: prev.lastBarDate }); continue; }
    // Quotas — checked BEFORE any request for this symbol.
    if (!usage.symbols.has(req.symbol) && usage.symbols.size >= limits.symbolsPerMonth) { stoppedReason = "monthly_symbol_quota"; results.push({ symbol: req.symbol, status: "not_attempted" }); continue; }
    if (usage.requestsToday + REQUESTS_PER_SYMBOL > limits.requestsPerDay) { stoppedReason = "daily_request_quota"; results.push({ symbol: req.symbol, status: "not_attempted" }); continue; }

    let status = "ok", note = null, meta = null, bars = null;
    const before = client.stats().requests;
    try {
      usage.symbols.add(req.symbol);
      meta = await client.meta(req.symbol);
      if (!meta) status = "not_found";
      else {
        const secName = req.issuers[0]?.name;
        const match = req.benchmark ? true : namesMatch(secName, meta.name);
        if (match === false && !allowNameMismatch) { status = "name_mismatch"; note = `SEC "${secName}" vs vendor "${meta.name}"`; }
        else {
          bars = await client.dailyBars(req.symbol, { from: req.from, to: req.to });
          if (!bars || !bars.length) status = "no_bars";
        }
      }
    } catch (err) {
      status = "error"; note = String(err.message || err).slice(0, 160);
      const kind = err.constructor?.name;
      if (kind === "TiingoAuthError") stoppedReason = "invalid_api_key";
      else if (kind === "TiingoRateLimitError") { stoppedReason = "rate_limited"; status = "rate_limited"; }
    } finally {
      usage.requestsToday += client.stats().requests - before;
      writeUsage(dir, usage);
    }
    const entry = {
      symbol: req.symbol, status, note, source: "tiingo", vendorTicker: meta?.ticker ?? null, vendorName: meta?.name ?? null, exchangeCode: meta?.exchangeCode ?? null,
      vendorStartDate: meta?.startDate ?? null, vendorEndDate: meta?.endDate ?? null,
      issuers: req.issuers, benchmark: !!req.benchmark, from: req.from, fetchedTo: req.to, fetchedAt: nowIso, licence,
      bars: bars?.length ?? 0, firstBarDate: bars?.[0]?.date ?? null, lastBarDate: bars?.[bars.length - 1]?.date ?? null,
    };
    // Only a complete, verified download replaces the stored file; failures keep the previous good data.
    if (status === "ok") { writeAtomic(path.join(dir, `${req.symbol}.csv`), barsToCsv(bars)); writeAtomic(metaFile, JSON.stringify(entry, null, 1)); }
    else if (!prev || prev.status !== "ok") writeAtomic(metaFile, JSON.stringify(entry, null, 1));
    results.push(entry);
    log.log(`[PRICE_FETCH] symbol=${req.symbol} status=${status} bars=${entry.bars} range=${entry.firstBarDate || "-"}..${entry.lastBarDate || "-"}${note ? ` note=${note}` : ""}`);
    if (stoppedReason) log.warn(`[PRICE_FETCH] stopping: ${stoppedReason}`);
  }
  const manifest = {
    source: "tiingo", licence, ranAt: nowIso, requested: plan.requests.length, skipped: plan.skipped, stoppedReason,
    usage: { month: usage.month, uniqueSymbolsThisMonth: usage.symbols.size, requestsToday: usage.requestsToday, limits },
    results: results.map(({ issuers, ...r }) => r),
  };
  writeAtomic(path.join(dir, "_fetch-manifest.json"), JSON.stringify(manifest, null, 1));
  return manifest;
}
