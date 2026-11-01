// server/services/edgar/insiderIngest.js
//
// MVP ingestion of real SEC EDGAR Form 4 filings into an in-memory store
// (mirrored to a local JSON cache so restarts don't re-download).
//
// Sources (official, free; strictly Form 4 / 4/A — see edgarSources.js):
//   1. Official daily form index (form.YYYYMMDD.idx) — the complete, reliable
//      source. Backfills the last EDGAR_BACKFILL_DAYS published business days
//      and reconciles each new index as SEC publishes it (~10 PM ET).
//   2. Latest-filings Atom feed — today's filings before the nightly index
//      exists. Paged until a page yields no new Form 4s.
// Each filing is fetched once as its full .txt submission and parsed by form4Parser.
//
// Nothing here is synthetic: every stored record comes from a parsed SEC filing.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { edgarGetText, getEdgarClientStats } from "./edgarClient.js";
import { parseForm4Submission, PARSER_VERSION } from "./form4Parser.js";
import { feedUrl, dailyIndexUrl, parseFeedForm4, parseDailyFormIndex } from "./edgarSources.js";

const POLL_MS = Math.max(Number(process.env.EDGAR_POLL_MS) || 60_000, 30_000);
const FEED_MAX_PAGES = Math.min(Math.max(Number(process.env.EDGAR_FEED_MAX_PAGES) || 10, 1), 50);
const BACKFILL_DAYS = Math.min(Math.max(Number(process.env.EDGAR_BACKFILL_DAYS) || 3, 0), 10);
const MAX_ATTEMPTS = 3;

const CACHE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".cache");
const CACHE_FILE = path.join(CACHE_DIR, "insider-filings.json");

// accessionNo → { cikDir, formType, filingDate, parserVersion, parsedAt, transactions[] }
const filings = new Map();
// "YYYY-MM-DD" → [accessionNo] as listed in the official daily index
const indexes = new Map();
// accessionNo → attempts (failed fetch/parse)
const failures = new Map();
const queued = new Set();
const queue = [];

const status = {
  startedAt: null,
  lastPollAt: null,
  lastPollError: null,
  lastFeed: { pages: 0, entries: 0, form4: 0, added: 0 },
  lastIndexCheck: null,
  initialSyncCompletedAt: null,
  filingsParsed: 0,
  filingsFailed: 0,
  processing: false,
};

const toIsoDay = (yyyymmdd) => `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;

// ── Cache ────────────────────────────────────────────────────────────────────
function loadCache() {
  try {
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
    let stale = 0;
    for (const [acc, f] of Object.entries(raw.filings || {})) {
      // Parsed by an older parser → drop; rediscovered via index/feed and re-parsed.
      if (f.parserVersion !== PARSER_VERSION) { stale++; continue; }
      filings.set(acc, f);
    }
    for (const [day, accs] of Object.entries(raw.indexes || {})) indexes.set(day, accs);
    console.log(`[INSIDER_CACHE] loaded filings=${filings.size} staleDropped=${stale} indexes=${indexes.size} parserVersion=${PARSER_VERSION}`);
  } catch (err) {
    if (err.code !== "ENOENT") console.warn(`[INSIDER_CACHE] unreadable, starting empty: ${err.message}`);
  }
}

let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      const tmp = `${CACHE_FILE}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({
        version: 2,
        savedAt: new Date().toISOString(),
        filings: Object.fromEntries(filings),
        indexes: Object.fromEntries(indexes),
      }));
      fs.renameSync(tmp, CACHE_FILE);
    } catch (err) {
      console.warn(`[INSIDER_CACHE] save failed: ${err.message}`);
    }
  }, 2000);
}

// ── Queue ────────────────────────────────────────────────────────────────────
function enqueue(accessionNo, cikDir, source) {
  if (filings.has(accessionNo) || queued.has(accessionNo)) return false;
  if ((failures.get(accessionNo) || 0) >= MAX_ATTEMPTS) return false;
  queued.add(accessionNo);
  queue.push({ accessionNo, cikDir, source });
  return true;
}

async function processQueue() {
  if (status.processing) return;
  status.processing = true;
  try {
    while (queue.length) {
      const { accessionNo, cikDir, source } = queue.shift();
      const startedAt = Date.now();
      try {
        const txt = await edgarGetText(`https://www.sec.gov/Archives/edgar/data/${cikDir}/${accessionNo}.txt`);
        const parsed = parseForm4Submission(txt, { accessionNo });
        filings.set(accessionNo, {
          cikDir,
          formType: parsed.formType,
          issuerName: parsed.issuerName,
          ticker: parsed.ticker,
          filingDate: parsed.filingDate,
          parserVersion: PARSER_VERSION,
          parsedAt: new Date().toISOString(),
          transactions: parsed.transactions,
        });
        status.filingsParsed++;
        failures.delete(accessionNo);
        if (parsed.transactions.length) {
          console.log(`[FORM4_PARSED] acc=${accessionNo} ticker=${parsed.ticker || "-"} ps=${parsed.transactions.length} source=${source} durationMs=${Date.now() - startedAt}`);
        }
        scheduleSave();
      } catch (err) {
        // A non-Form-4 document can never succeed — don't retry it.
        const permanent = /not a Form 4|no ownershipDocument/.test(err.message);
        failures.set(accessionNo, permanent ? MAX_ATTEMPTS : (failures.get(accessionNo) || 0) + 1);
        status.filingsFailed++;
        console.warn(`[FORM4_FAILED] acc=${accessionNo} source=${source} attempt=${failures.get(accessionNo)} permanent=${permanent} err=${err.message}`);
      } finally {
        queued.delete(accessionNo);
      }
    }
  } finally {
    status.processing = false;
    notifyBatch();
  }
}

// ── Batch listeners (alert engine) ───────────────────────────────────────────
const batchListeners = new Set();
export function onIngestBatch(fn) {
  batchListeners.add(fn);
  return () => batchListeners.delete(fn);
}
function notifyBatch() {
  for (const fn of batchListeners) {
    try { Promise.resolve(fn()).catch((err) => console.warn(`[INGEST_LISTENER] failed err=${err.message}`)); }
    catch (err) { console.warn(`[INGEST_LISTENER] failed err=${err.message}`); }
  }
}

// ── Sources ──────────────────────────────────────────────────────────────────
async function pollFeed(maxPages) {
  const res = { pages: 0, entries: 0, form4: 0, added: 0 };
  for (let p = 0; p < maxPages; p++) {
    const page = parseFeedForm4(await edgarGetText(feedUrl(p * 100)));
    res.pages++;
    res.entries += page.entries;
    res.form4 += page.form4.length;
    let addedHere = 0;
    for (const f of page.form4) if (enqueue(f.accessionNo, f.cikDir, "feed")) addedHere++;
    res.added += addedHere;
    // Stop once a page brings nothing new (older pages are already known) or the feed ends.
    if (page.entries < 100 || (addedHere === 0 && page.form4.length > 0)) break;
  }
  status.lastFeed = res;
  return res;
}

// Calendar date in New York (EDGAR's timezone) as YYYYMMDD, plus hour.
function easternNow() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  return { ymd: `${parts.year}${parts.month}${parts.day}`, hour: Number(parts.hour) };
}

// Business days (newest first) whose daily index should be published by now.
function expectedIndexDays(count) {
  const { ymd, hour } = easternNow();
  const d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8)));
  if (hour < 22) d.setUTCDate(d.getUTCDate() - 1); // tonight's index appears ~10:01 PM ET
  const days = [];
  for (let guard = 0; days.length < count && guard < count * 3 + 7; guard++, d.setUTCDate(d.getUTCDate() - 1)) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) days.push(d.toISOString().slice(0, 10).replace(/-/g, ""));
  }
  return days;
}

// Fetches any expected index not yet recorded and enqueues its unseen filings.
// Known indexes are re-enqueued from cache only (no request).
const UNPUBLISHED_RETRY_MS = 30 * 60_000;
const unpublishedAt = new Map(); // day → last 404 time

async function syncDailyIndexes(count) {
  const results = [];
  for (const ymd of expectedIndexDays(count)) {
    const day = toIsoDay(ymd);
    let entries = null;
    if (!indexes.has(day)) {
      if (Date.now() - (unpublishedAt.get(day) || 0) < UNPUBLISHED_RETRY_MS) { results.push(`${day}:unpublished`); continue; }
      try {
        entries = parseDailyFormIndex(await edgarGetText(dailyIndexUrl(ymd), { retries: 1 }));
        unpublishedAt.delete(day);
      } catch (err) {
        // Holiday or not yet published — retry at most every 30 min.
        if (err.status === 404 || err.status === 403) { unpublishedAt.set(day, Date.now()); results.push(`${day}:unpublished`); continue; }
        throw err;
      }
      indexes.set(day, entries.map((e) => e.accessionNo));
      scheduleSave();
    }
    let added = 0;
    const list = entries || indexes.get(day).map((accessionNo) => ({ accessionNo, cikDir: null }));
    for (const e of list) {
      if (!e.cikDir) continue; // already-known index: filings were enqueued when it was first fetched
      if (enqueue(e.accessionNo, e.cikDir, `index:${day}`)) added++;
    }
    results.push(`${day}:listed=${indexes.get(day).length},queued=${added}`);
  }
  status.lastIndexCheck = { at: new Date().toISOString(), results };
  console.log(`[EDGAR_INDEX] ${results.join(" ")}`);
}

async function pollOnce(feedPages) {
  const startedAt = Date.now();
  try {
    const feed = await pollFeed(feedPages);
    await syncDailyIndexes(BACKFILL_DAYS);
    status.lastPollAt = new Date().toISOString();
    status.lastPollError = null;
    console.log(`[EDGAR_POLL] feedPages=${feed.pages} entries=${feed.entries} form4=${feed.form4} new=${feed.added} queue=${queue.length} durationMs=${Date.now() - startedAt}`);
  } catch (err) {
    status.lastPollError = err.message;
    console.warn(`[EDGAR_POLL] failed err=${err.message}`);
  }
  await processQueue();
}

let pollTimer = null;
export async function startInsiderIngest() {
  if (status.startedAt) return;
  status.startedAt = new Date().toISOString();
  loadCache();
  // Cached index lists may reference filings dropped as stale — re-fetch those indexes.
  for (const [day, accs] of indexes) if (accs.some((a) => !filings.has(a))) indexes.delete(day);
  await pollOnce(FEED_MAX_PAGES);
  // Startup backfill finished — the alert engine may only run after this point.
  status.initialSyncCompletedAt = new Date().toISOString();
  pollTimer = setInterval(() => pollOnce(FEED_MAX_PAGES), POLL_MS);
}

export function stopInsiderIngest() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

// ── Read API ─────────────────────────────────────────────────────────────────
export function getTransactions() {
  const out = [];
  for (const f of filings.values()) for (const t of f.transactions) out.push(t);
  return out;
}

// Per-day completeness against the official daily index.
export function getCoverage() {
  return [...indexes.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([day, accs]) => {
      let parsed = 0, failed = 0, pending = 0;
      for (const a of accs) {
        if (filings.has(a)) parsed++;
        else if ((failures.get(a) || 0) >= MAX_ATTEMPTS) failed++;
        else pending++;
      }
      return { day, listed: accs.length, parsed, failed, pending };
    });
}

export function getIngestStatus() {
  return {
    ...status,
    filingsStored: filings.size,
    queueLength: queue.length,
    pollIntervalMs: POLL_MS,
    coverage: getCoverage(),
    edgar: getEdgarClientStats(),
  };
}
