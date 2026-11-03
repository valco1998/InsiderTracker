// server/services/backtest/form4Backfill.js
//
// Incremental, resumable historical Form 4 backfill (run by the CLI
// scripts/backfillForm4.js — never automatically by the server).
//
//   • Walks SEC business days in [from, to] (oldest first); for each day reads the
//     official daily form index (form.YYYYMMDD.idx, Form 4 and 4/A only) and
//     downloads each filing's full .txt submission, parsed by the SAME parser as
//     the live ingest (form4Parser.js). Records already held by the live ingest
//     cache are reused instead of downloaded again.
//   • Checkpoints: one shard per day, saved every SAVE_EVERY filings and at the
//     end of the day; a complete shard is never fetched again, a partial one
//     resumes where it stopped.
//   • SEC fair access: all requests go through edgarClient (declared User-Agent
//     with contact e-mail, request spacing at the configured rps, bounded
//     retries with backoff on 5xx/network errors, global circuit breaker on
//     429/403 honouring Retry-After). When SEC throttles, the backfill waits for
//     the pause and retries the same filing without consuming an attempt.
//   • A day whose index does not exist (404) before today is a day SEC was closed.
//   • Bounded concurrency: at most `concurrency` filings of a day in flight (default 1).
//     The shared edgarClient still spaces every request at its rps limit, and its
//     circuit breaker pauses all workers together.

import { dailyIndexUrl, parseDailyFormIndex } from "../edgar/edgarSources.js";
import { parseForm4Submission, PARSER_VERSION } from "../edgar/form4Parser.js";
import { isBusinessDay } from "../edgar/businessDays.js";
import { readShard, writeShard, writeProgress, shardStats } from "./form4History.js";

const SAVE_EVERY = 25;
const MAX_ATTEMPTS = 3;
const DAY = 86_400_000;
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const isThrottled = (err) => !!err?.throttled || !!err?.circuitOpen || err?.status === 429 || err?.status === 403;
const PERMANENT_RE = /not a Form 4|no ownershipDocument/;

export function recordFromParsed(parsed, cikDir, nowMs) {
  return {
    cikDir,
    formType: parsed.formType,
    issuerCik: parsed.issuerCik,
    issuerName: parsed.issuerName,
    ticker: parsed.ticker,
    tickerReported: parsed.tickerReported,
    filingDate: parsed.filingDate,
    acceptedAtET: parsed.acceptedAtET,
    ownerCiks: parsed.ownerCiks,
    originalSubmissionDate: parsed.originalSubmissionDate,
    hasNonDerivativeTable: parsed.hasNonDerivativeTable,
    totalNonDerivative: parsed.totalNonDerivative,
    parserVersion: PARSER_VERSION,
    parsedAt: new Date(nowMs).toISOString(),
    transactions: parsed.transactions,
  };
}

// client: { getText(url, opts) } (edgarClient). knownRecords: Map acc → live-cache record (read-only).
export function createForm4Backfill({ storeDir, client, knownRecords = new Map(), log = console, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const todayEt = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(now()));

  async function getWithThrottleWait(url, opts, isAborted) {
    for (;;) {
      try { return await client.getText(url, opts); } catch (err) {
        if (!isThrottled(err) || isAborted()) throw err;
        const wait = Math.max(1000, Math.min(err.retryAfterMs ?? 60_000, 3_600_000));
        log.warn(`[BACKFILL_THROTTLED] status=${err.status ?? "circuit_open"} waitMs=${wait}`);
        await sleep(wait);
      }
    }
  }

  async function run({ from, to, maxFilings = Infinity, concurrency = 1, isAborted = () => false, onProgress = () => {} }) {
    const workers = Math.max(1, Math.min(4, Math.floor(concurrency) || 1));
    const today = todayEt();
    const end = to < today ? to : addDays(today, -1);
    const days = [];
    for (let d = from; d <= end; d = addDays(d, 1)) if (isBusinessDay(d)) days.push(d);
    const progress = { state: "running", from, to: end, startedAt: new Date(now()).toISOString(), updatedAt: null, daysTotal: days.length, daysComplete: 0, currentDay: null, downloaded: 0, reused: 0, failed: 0, stoppedReason: null };
    const save = () => { progress.updatedAt = new Date(now()).toISOString(); writeProgress(storeDir, progress); onProgress({ ...progress }); };

    for (const day of days) {
      if (isAborted()) { progress.stoppedReason = "aborted"; break; }
      if (progress.downloaded >= maxFilings) { progress.stoppedReason = "max_filings"; break; }
      let shard = readShard(storeDir, day) || { day, listed: 0, noIndex: false, complete: false, accessions: null, records: {}, failed: {} };
      if (shard.complete) { progress.daysComplete++; continue; }
      progress.currentDay = day; save();

      if (!shard.accessions) {
        let entries;
        try {
          entries = parseDailyFormIndex(await getWithThrottleWait(dailyIndexUrl(day.replace(/-/g, "")), { retries: 2 }, isAborted));
        } catch (err) {
          if (err.status === 404 && day < today) {
            Object.assign(shard, { noIndex: true, complete: true, accessions: [], updatedAt: new Date(now()).toISOString() });
            writeShard(storeDir, shard); progress.daysComplete++;
            log.log(`[BACKFILL_DAY] day=${day} no-index (SEC closed)`);
            continue;
          }
          log.warn(`[BACKFILL_INDEX_FAILED] day=${day} status=${err.status ?? "-"} error=${String(err.message).slice(0, 120)}`);
          progress.stoppedReason = `index_failed:${day}`;
          break;
        }
        shard.accessions = entries.map((e) => e.accessionNo);
        shard.cikDirs = Object.fromEntries(entries.map((e) => [e.accessionNo, e.cikDir]));
        shard.listed = entries.length;
        writeShard(storeDir, shard);
      }

      let sinceSave = 0, stopDay = false, inFlight = 0;
      const queue = shard.accessions.filter((acc) => !(shard.records[acc] || shard.failed[acc]?.permanent || shard.failed[acc]?.exhausted));
      // One filing: reuse the live record, else download + parse. Shared shard state is only
      // mutated synchronously between awaits (single-threaded), so workers never clash.
      async function processOne(acc) {
        const known = knownRecords.get(acc);
        if (known) { shard.records[acc] = known; progress.reused++; return; }
        const cikDir = shard.cikDirs?.[acc];
        try {
          const txt = await getWithThrottleWait(`https://www.sec.gov/Archives/edgar/data/${cikDir}/${acc}.txt`, { retries: 2 }, isAborted);
          shard.records[acc] = recordFromParsed(parseForm4Submission(txt, { accessionNo: acc }), cikDir, now());
          delete shard.failed[acc];
          progress.downloaded++;
        } catch (err) {
          if (isThrottled(err)) { stopDay = true; progress.stoppedReason = "aborted"; return; } // only when aborted during a throttle wait
          const f = shard.failed[acc] || { attempts: 0 };
          f.attempts++;
          f.error = String(err.message || err).slice(0, 160);
          f.permanent = PERMANENT_RE.test(f.error);
          f.exhausted = f.attempts >= MAX_ATTEMPTS;
          shard.failed[acc] = f;
          if (f.permanent || f.exhausted) progress.failed++;
          log.warn(`[BACKFILL_FILING_FAILED] acc=${acc} day=${day} attempts=${f.attempts} permanent=${f.permanent} error=${f.error}`);
        }
        if (++sinceSave >= SAVE_EVERY) { writeShard(storeDir, { ...shard, updatedAt: new Date(now()).toISOString() }); sinceSave = 0; save(); }
      }
      async function worker() {
        while (queue.length && !stopDay) {
          if (isAborted() || progress.downloaded + inFlight >= maxFilings) return;
          const acc = queue.shift();
          inFlight++;
          try { await processOne(acc); } finally { inFlight--; }
        }
      }
      await Promise.all(Array.from({ length: workers }, worker));
      // Complete when every listed filing is parsed or permanently/exhaustively failed.
      const st = shardStats(shard);
      shard.complete = st.parsed + st.failed >= st.listed && !Object.values(shard.failed).some((f) => !f.permanent && !f.exhausted);
      shard.updatedAt = new Date(now()).toISOString();
      writeShard(storeDir, shard);
      if (shard.complete) progress.daysComplete++;
      log.log(`[BACKFILL_DAY] day=${day} listed=${st.listed} parsed=${st.parsed} failed=${st.failed} complete=${shard.complete}`);
      if (!shard.complete && (isAborted() || progress.downloaded >= maxFilings)) { progress.stoppedReason = isAborted() ? "aborted" : "max_filings"; break; }
    }
    progress.state = progress.stoppedReason ? "stopped" : "complete";
    progress.currentDay = null;
    save();
    return progress;
  }

  return { run };
}
