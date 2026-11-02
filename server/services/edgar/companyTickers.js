// server/services/edgar/companyTickers.js
//
// Ticker → issuer CIK lookup from SEC's official company_tickers_exchange.json
// (free; refreshed at most once per 24h, cached locally). Follows are matched by
// CIK because Form 4s identify the issuer by CIK; ticker text in filings varies.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { edgarGetText } from "./edgarClient.js";

const URL_TICKERS = "https://www.sec.gov/files/company_tickers_exchange.json";
const MAX_AGE_MS = 24 * 3600_000;
const CACHE_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".cache", "company_tickers_exchange.json");

export class CompanyLookupUnavailable extends Error {}

// SEC uses "BRK-B"; users often type "BRK.B".
export const normalizeTicker = (t) => String(t || "").trim().toUpperCase().replace(/\./g, "-");

// Pure: SEC JSON → Map(ticker → { cik, name, ticker, exchange })
export function parseCompanyTickers(json) {
  const fields = json?.fields || [];
  const i = { cik: fields.indexOf("cik"), name: fields.indexOf("name"), ticker: fields.indexOf("ticker"), exchange: fields.indexOf("exchange") };
  if (i.cik < 0 || i.ticker < 0) throw new Error("unexpected company_tickers format");
  const map = new Map();
  for (const row of json.data || []) {
    const ticker = normalizeTicker(row[i.ticker]);
    if (!ticker || map.has(ticker)) continue;
    map.set(ticker, {
      cik: String(row[i.cik]).padStart(10, "0"),
      name: i.name >= 0 ? String(row[i.name] || "") : "",
      ticker,
      exchange: i.exchange >= 0 ? row[i.exchange] || null : null,
    });
  }
  return map;
}

let cache = { map: null, loadedAt: 0 };
let loading = null;

async function load() {
  try {
    const stat = fs.statSync(CACHE_FILE);
    if (Date.now() - stat.mtimeMs < MAX_AGE_MS) {
      cache = { map: parseCompanyTickers(JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"))), loadedAt: stat.mtimeMs };
      return;
    }
  } catch { /* no usable cache */ }
  try {
    const text = await edgarGetText(URL_TICKERS);
    const map = parseCompanyTickers(JSON.parse(text));
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, text);
    cache = { map, loadedAt: Date.now() };
    console.log(`[COMPANY_TICKERS] loaded tickers=${map.size}`);
  } catch (err) {
    console.warn(`[COMPANY_TICKERS] refresh failed err=${err.message}`);
    if (!cache.map) {
      // Fall back to a stale cache rather than nothing.
      try { cache = { map: parseCompanyTickers(JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"))), loadedAt: 0 }; } catch { /* none */ }
    }
  }
}

// Pure: ticker map → Map(10-digit CIK → company). The first listing per CIK wins
// (SEC lists an issuer's primary class first).
export function indexByCik(map) {
  const byCik = new Map();
  for (const c of map.values()) if (!byCik.has(c.cik)) byCik.set(c.cik, c);
  return byCik;
}

let byCikCache = { source: null, map: null };

async function ensureLoaded() {
  if (!cache.map || Date.now() - cache.loadedAt > MAX_AGE_MS) {
    loading ||= load().finally(() => { loading = null; });
    await loading;
  }
  if (!cache.map) throw new CompanyLookupUnavailable("SEC company list unavailable");
}

export async function lookupTicker(ticker) {
  await ensureLoaded();
  return cache.map.get(normalizeTicker(ticker)) || null;
}

// Issuer CIK (any digits form) → company, or null when SEC lists no ticker for it.
export async function lookupCik(cik) {
  await ensureLoaded();
  if (byCikCache.source !== cache.map) byCikCache = { source: cache.map, map: indexByCik(cache.map) };
  return byCikCache.map.get(String(Number(cik)).padStart(10, "0")) || null;
}
