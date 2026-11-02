// server/services/edgar/insiderIngest.js
//
// Ingestion of real SEC EDGAR Form 4 filings into an in-memory store
// (mirrored to a local JSON cache so restarts don't re-download).
//
// Sources (official, free; strictly Form 4 / 4/A — see edgarSources.js):
//   1. Official daily form index (form.YYYYMMDD.idx) — the complete, reliable
//      source. Covers the last EDGAR_BACKFILL_DAYS business days and, after a
//      restart or outage, EVERY missing business day back to the oldest day
//      already held (capped at EDGAR_RECOVERY_MAX_DAYS). Federal holidays have
//      no index; a 404 for a past business day is recorded as "no index".
//   2. Latest-filings Atom feed — today's filings before the nightly index
//      exists. Paged until a page yields no new Form 4s. Feed filings are
//      processed before backfill so fresh data is never stuck behind recovery.
// Each filing is fetched once as its full .txt submission and parsed by form4Parser.
//
// Failed downloads are retried with bounded exponential backoff
// (EDGAR_RETRY_BASE_MS doubling up to EDGAR_RETRY_MAX_MS, at most
// EDGAR_RETRY_MAX_ATTEMPTS). Retry state is persisted, so it survives restarts;
// a restart gives exhausted transient failures one fresh round. "Not a Form 4"
// is permanent and never retried.
//
// Phase D:
//   D0  Every filing gets a timeline (see ingestLatency.js): SEC acceptance, feed
//       timestamp, discovery, download duration, parse and snapshot publication.
//       Persisted in the cache under "timelines" (records themselves unchanged).
//   D1  Discovery never waits for a backlog: the poll timer starts before the
//       startup catch-up, overlapping polls share one discovery run, live feed
//       filings always jump the queue (including feed retries and index items the
//       feed sees later), and parsed data is published while a backlog is still
//       downloading (after each run of live filings, else every EDGAR_PUBLISH_EVERY_MS).
//   D2  SEC throttling (429 / 403, see edgarClient.js) pauses ALL SEC requests:
//       the download is put back at the front of the queue WITHOUT consuming a
//       retry attempt, discovery is skipped while paused, and work resumes when
//       the pause ends.
//
// Nothing here is synthetic: every stored record comes from a parsed SEC filing.
// Nothing stored is ever pruned.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { edgarGetText, getEdgarClientStats } from "./edgarClient.js";
import { parseForm4Submission, normalizeFiledTicker, PARSER_VERSION } from "./form4Parser.js";
import { feedUrl, dailyIndexUrl, parseFeedForm4, parseDailyFormIndex } from "./edgarSources.js";
import { businessDaysBack, businessDaysBetween, isBusinessDay, previousDay } from "./businessDays.js";
import { acceptedAtIso, createLatencyTracker, timelineClass, timelineMetrics } from "./ingestLatency.js";
import { redact, formatEvent } from "../../utils/safeLog.js";

const envInt = (name, def, min, max) => Math.min(Math.max(Number(process.env[name]) || def, min), max);

const DEFAULT_CACHE_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".cache", "insider-filings.json");
const UNPUBLISHED_RETRY_MS = 30 * 60_000;

const compactToIso = (yyyymmdd) => `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
const isoToCompact = (iso) => iso.replace(/-/g, "");

// 429 / 403 from SEC (flagged by edgarClient, or a bare status from another fetcher).
const isThrottled = (err) => !!err?.throttled || err?.status === 429 || err?.status === 403;

export function createInsiderIngest({
  fetchText = edgarGetText,
  now = () => Date.now(),
  cacheFile = DEFAULT_CACHE_FILE,
  pollMs = Math.max(Number(process.env.EDGAR_POLL_MS) || 60_000, 30_000),
  feedMaxPages = envInt("EDGAR_FEED_MAX_PAGES", 10, 1, 50),
  backfillDays = Math.min(Math.max(Number(process.env.EDGAR_BACKFILL_DAYS ?? 3) || 0, 0), 10),
  recoveryMaxDays = envInt("EDGAR_RECOVERY_MAX_DAYS", 30, 1, 90),
  retryBaseMs = envInt("EDGAR_RETRY_BASE_MS", 60_000, 1, 3_600_000),
  retryMaxMs = envInt("EDGAR_RETRY_MAX_MS", 3_600_000, 1, 24 * 3_600_000),
  retryMaxAttempts = envInt("EDGAR_RETRY_MAX_ATTEMPTS", 8, 1, 20),
  publishEveryMs = envInt("EDGAR_PUBLISH_EVERY_MS", 5000, 500, 60_000),
  throttleResumeMs = 60_000, // pause when a throttle error carries no retry hint
  latencyWindow = 1000,
  saveDelayMs = 2000,
  getClientStats = getEdgarClientStats,
  setTimer = (fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t; },
  clearTimer = (t) => clearTimeout(t),
  log = console,
} = {}) {
  // accessionNo → { cikDir, formType, issuerName, ticker, …, transactions[] }
  const filings = new Map();
  // "YYYY-MM-DD" → [accessionNo] as listed in the official daily index
  const indexes = new Map();
  // Past business days for which SEC publishes no index (e.g. unscheduled closures).
  const noIndexDays = new Set();
  // accessionNo → { cikDir, source, attempts, nextAt, permanent, lastError, lastAttemptAt }
  const retries = new Map();
  const queued = new Set();
  const queue = []; // items: { accessionNo, cikDir, source, refresh, live }
  const unpublishedAt = new Map(); // day → last 404 time (newest expected day only)
  // D0: accessionNo → timeline (see ingestLatency.js). Kept apart from the immutable records.
  const timelines = new Map();
  const awaitingPublish = new Map(); // accessionNo → data version that contains it
  const latency = createLatencyTracker({ window: latencyWindow });
  // Bumped on every change to stored filings — consumers rebuild derived data when it changes.
  let dataVersion = 0;

  const status = {
    startedAt: null,
    lastPollAt: null,
    lastPollAttemptAt: null,
    lastPollError: null,
    lastPollErrorAt: null,
    consecutivePollFailures: 0,
    lastFeed: { pages: 0, entries: 0, form4: 0, added: 0 },
    lastIndexCheck: null,
    initialSyncCompletedAt: null,
    filingsParsed: 0,
    filingsFailed: 0,
    processing: false,
    recovery: null,
    overlappingPollsJoined: 0,
    publish: { publishes: 0, lastPublishAt: null, publishedMidBacklog: 0 },
  };

  // D2: ingest-side view of SEC throttling (the client holds the authoritative breaker).
  const throttle = { pausedUntil: 0, events: 0, deferredDownloads: 0, skippedPolls: 0, lastThrottledAt: 0, lastError: null };
  let resumeTimer = null;

  const backoffMs = (attempts) => Math.min(retryBaseMs * 2 ** Math.max(attempts - 1, 0), retryMaxMs);
  const isExhausted = (r) => r.permanent || r.attempts >= retryMaxAttempts;
  const isoNow = () => new Date(now()).toISOString();

  // ── Cache ──────────────────────────────────────────────────────────────────
  // Records written before ticker normalization are upgraded in place; the SEC
  // value is preserved as tickerReported.
  function upgradeTicker(rec) {
    if (rec.tickerReported !== undefined) return false;
    rec.tickerReported = rec.ticker ?? null;
    const n = normalizeFiledTicker(rec.ticker);
    rec.ticker = n.ticker;
    rec.tickerSymbols = n.symbols;
    return true;
  }

  function loadCache() {
    let upgraded = 0, refresh = 0;
    try {
      const raw = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
      let stale = 0;
      for (const [acc, f] of Object.entries(raw.filings || {})) {
        // Parsed by an older parser → drop; rediscovered via index/feed and re-parsed.
        if (f.parserVersion !== PARSER_VERSION) { stale++; continue; }
        if (upgradeTicker(f)) upgraded++;
        for (const t of f.transactions || []) upgradeTicker(t);
        setFiling(acc, f);
      }
      for (const [day, accs] of Object.entries(raw.indexes || {})) indexes.set(day, accs);
      for (const day of raw.noIndexDays || []) noIndexDays.add(day);
      for (const [acc, r] of Object.entries(raw.retries || {})) {
        // A restart grants exhausted transient failures one fresh round.
        retries.set(acc, r.permanent ? r : { ...r, attempts: Math.min(r.attempts, retryMaxAttempts - 1), nextAt: 0 });
      }
      // D0: timelines. Completed ones re-seed the latency statistics (oldest first);
      // filings parsed but never published before the restart stay "unavailable".
      for (const [acc, tl] of Object.entries(raw.timelines || {})) if (tl && typeof tl === "object") timelines.set(acc, tl);
      [...timelines.values()].filter((tl) => tl.publishedAt).sort((a, b) => a.publishedAt.localeCompare(b.publishedAt)).forEach((tl) => latency.add(tl));
      // 4/A filings cached before full amendment metadata existed → re-fetch (old record kept until the new parse succeeds).
      for (const [acc, f] of filings) {
        if (f.formType === "4/A" && f.hasNonDerivativeTable === undefined && f.cikDir) { enqueue(acc, f.cikDir, "refresh:4A", { refresh: true }); refresh++; }
      }
      log.log(`[INSIDER_CACHE] loaded filings=${filings.size} staleDropped=${stale} indexes=${indexes.size} retries=${retries.size} timelines=${timelines.size} tickerUpgraded=${upgraded} amendmentRefresh=${refresh} parserVersion=${PARSER_VERSION}`);
      if (upgraded) scheduleSave();
    } catch (err) {
      if (err.code !== "ENOENT") log.warn(`[INSIDER_CACHE] unreadable, starting empty: ${err.message}`);
    }
  }

  // ── Cache writes: asynchronous, atomic, never overlapping ──────────────────
  // Stored filing records are immutable once set (readers copy before
  // annotating), so each record's JSON is computed once and reused: a save joins
  // pre-serialized strings instead of re-serializing the whole store.
  // Atomic: write a temp file, fsync, then rename over the cache — a crash
  // leaves either the previous complete file or the new complete file.
  const recordJson = new Map(); // accessionNo → JSON of filings.get(accessionNo)
  const setFiling = (acc, rec) => { filings.set(acc, rec); recordJson.delete(acc); dataVersion++; };
  function cacheBody() {
    const parts = [];
    for (const [acc, f] of filings) {
      let s = recordJson.get(acc);
      if (s === undefined) { s = JSON.stringify(f); recordJson.set(acc, s); }
      parts.push(`${JSON.stringify(acc)}:${s}`);
    }
    return `{"version":3,"savedAt":${JSON.stringify(new Date(now()).toISOString())},"filings":{${parts.join(",")}},` +
      `"indexes":${JSON.stringify(Object.fromEntries(indexes))},"noIndexDays":${JSON.stringify([...noIndexDays].sort())},` +
      `"retries":${JSON.stringify(Object.fromEntries(retries))},"timelines":${JSON.stringify(Object.fromEntries(timelines))}}`;
  }

  async function renameWithRetry(from, to) {
    // Windows: the target can be briefly locked (antivirus, indexer) → EPERM/EBUSY/EACCES.
    for (let attempt = 0; ; attempt++) {
      try { return await fs.promises.rename(from, to); }
      catch (err) {
        if (attempt >= 5 || !["EPERM", "EBUSY", "EACCES"].includes(err.code)) throw err;
        await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
      }
    }
  }

  let saveTimer = null;
  let dirty = false;
  let saveChain = Promise.resolve();
  let queuedSave = null;
  const stats = {
    saves: 0, saveFailures: 0, consecutiveFailures: 0, lastSaveAt: null, lastSaveMs: null, lastSaveBytes: null,
    lastError: null, lastFailureAt: null,
    dirtySince: null, // oldest change not yet on disk
  };

  async function writeCache() {
    const pendingSince = stats.dirtySince;
    const writeStartedAt = new Date(now()).toISOString();
    dirty = false;
    const t0 = Date.now();
    try {
      const body = cacheBody(); // state captured now; later changes mark dirty again
      const tmp = `${cacheFile}.${process.pid}.tmp`;
      await fs.promises.mkdir(path.dirname(cacheFile), { recursive: true });
      const fh = await fs.promises.open(tmp, "w");
      try { await fh.writeFile(body); await fh.sync(); } finally { await fh.close(); }
      await renameWithRetry(tmp, cacheFile);
      Object.assign(stats, {
        saves: stats.saves + 1, lastSaveAt: new Date(now()).toISOString(), lastSaveMs: Date.now() - t0, lastSaveBytes: body.length,
        consecutiveFailures: 0, lastError: null,
        dirtySince: dirty ? writeStartedAt : null, // changes made during the write are still pending
      });
    } catch (err) {
      dirty = true;
      Object.assign(stats, {
        saveFailures: stats.saveFailures + 1, consecutiveFailures: stats.consecutiveFailures + 1,
        lastError: redact(err), lastFailureAt: new Date(now()).toISOString(), dirtySince: pendingSince || writeStartedAt,
      });
      throw err;
    }
  }

  // Resolves once the state as of this call is on disk (coalesces concurrent calls).
  function saveNow() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (queuedSave) return queuedSave; // the queued write has not started yet — it will capture this state
    queuedSave = saveChain.then(async () => {
      queuedSave = null;
      try { await writeCache(); }
      catch (err) {
        log.warn(formatEvent("INSIDER_CACHE_SAVE_FAILED", { attempt: stats.consecutiveFailures, code: err?.code, err }));
        // Retry pending changes on the normal debounce (the next change also triggers one).
        scheduleSave();
      }
    });
    saveChain = queuedSave;
    return queuedSave;
  }
  function scheduleSave() {
    if (!dirty && !stats.dirtySince) stats.dirtySince = new Date(now()).toISOString();
    dirty = true;
    if (saveTimer) return;
    saveTimer = setTimeout(saveNow, saveDelayMs);
    saveTimer.unref?.();
  }
  // Writes any pending change and waits for in-flight writes (shutdown).
  async function flush() {
    if (dirty || saveTimer) await saveNow();
    await saveChain;
  }

  // ── D0: timelines ──────────────────────────────────────────────────────────
  // A fresh timeline starts at the first discovery of a filing we do not hold
  // (also after a stale-parser drop: the earlier timeline is replaced).
  function noteDiscovery(accessionNo, source, feedUpdatedAt) {
    const tl = timelines.get(accessionNo);
    if (!tl || tl.parsedAt) {
      timelines.set(accessionNo, { source, discoveredAt: isoNow(), feedUpdatedAt: feedUpdatedAt ?? null, acceptedAt: null, downloadMs: null, parsedAt: null, publishedAt: null });
    } else if (feedUpdatedAt && !tl.feedUpdatedAt) {
      tl.feedUpdatedAt = feedUpdatedAt; // seen by the feed after an earlier index listing
    }
  }

  // Called by the snapshot store after each build: every filing stored at or
  // before `version` is now visible through the API.
  function markPublished(version, atMs = now()) {
    if (!awaitingPublish.size) return 0;
    const at = new Date(atMs).toISOString();
    let n = 0;
    for (const [acc, v] of awaitingPublish) {
      if (v > version) continue;
      awaitingPublish.delete(acc);
      const tl = timelines.get(acc);
      if (!tl || tl.publishedAt) continue;
      tl.publishedAt = at;
      latency.add(tl);
      n++;
      if (timelineClass(tl) === "live") {
        const m = timelineMetrics(tl);
        log.log(`[FORM4_PUBLISHED] acc=${acc} source=feed e2eMs=${m.acceptedToPublished ?? "n/a"} discoverMs=${m.acceptedToDiscovered ?? "n/a"} processMs=${m.discoveredToParsed ?? "n/a"} publishMs=${m.parsedToPublished ?? "n/a"} downloadMs=${tl.downloadMs ?? "n/a"}`);
      }
    }
    if (n) scheduleSave(); // persists publishedAt; data version is NOT bumped
    return n;
  }

  // ── Queue ──────────────────────────────────────────────────────────────────
  function enqueue(accessionNo, cikDir, source, { priority = false, refresh = false, feedUpdatedAt = null } = {}) {
    const live = source === "feed" || source === "retry:feed";
    if (queued.has(accessionNo)) {
      // D1: an index/backfill item the live feed now lists moves to the front.
      if (live && !refresh) {
        const i = queue.findIndex((q) => q.accessionNo === accessionNo);
        if (i >= 0 && !queue[i].live && !queue[i].refresh) { const [item] = queue.splice(i, 1); item.live = true; queue.unshift(item); }
        if (feedUpdatedAt && timelines.has(accessionNo)) noteDiscovery(accessionNo, source, feedUpdatedAt);
      }
      return false;
    }
    if (!refresh && filings.has(accessionNo)) return false;
    const r = retries.get(accessionNo);
    if (r && (isExhausted(r) || r.nextAt > now())) return false;
    queued.add(accessionNo);
    const item = { accessionNo, cikDir, source, refresh, live };
    if (priority) queue.unshift(item); else queue.push(item);
    if (!refresh) noteDiscovery(accessionNo, source, feedUpdatedAt);
    return true;
  }

  function enqueueDueRetries() {
    let n = 0;
    for (const [acc, r] of retries) {
      // Retries of live feed filings keep their priority over backfill.
      if (!isExhausted(r) && r.nextAt <= now() && enqueue(acc, r.cikDir, `retry:${r.source}`, { refresh: !!r.refresh, priority: r.source === "feed" })) n++;
    }
    return n;
  }

  // ── D2: global pause on SEC throttling ─────────────────────────────────────
  const isPaused = () => throttle.pausedUntil > now();
  function pauseForThrottle(err) {
    const ms = Number.isFinite(err?.retryAfterMs) && err.retryAfterMs > 0 ? err.retryAfterMs : throttleResumeMs;
    const until = now() + ms;
    if (until > throttle.pausedUntil) throttle.pausedUntil = until;
    throttle.events++;
    throttle.lastThrottledAt = now();
    throttle.lastError = String(err?.message || err).slice(0, 200);
    if (resumeTimer) clearTimer(resumeTimer);
    resumeTimer = setTimer(() => {
      resumeTimer = null;
      processQueue().catch((e) => log.warn(`[INSIDER_INGEST] resume failed err=${e.message}`));
    }, Math.max(throttle.pausedUntil - now(), 0) + 50);
  }

  // ── D1: publication while a backlog is still downloading ───────────────────
  let changedSincePublish = false;
  let liveSincePublish = false;
  let lastPublishAt = 0;
  function maybePublish() {
    if (!changedSincePublish || !queue.length) return; // the end of a run publishes in processQueue's finally
    const liveRunDone = liveSincePublish && !queue[0].live;
    if (liveRunDone || now() - lastPublishAt >= publishEveryMs) {
      status.publish.publishedMidBacklog++;
      notifyBatch();
    }
  }

  async function processQueue() {
    if (status.processing) return;
    if (isPaused()) return; // resumed by the throttle timer (or the next poll after the pause)
    status.processing = true;
    try {
      while (queue.length) {
        const item = queue.shift();
        const { accessionNo, cikDir, source, refresh } = item;
        const startedAt = now();
        let deferred = false;
        try {
          const t0 = performance.now();
          const txt = await fetchText(`https://www.sec.gov/Archives/edgar/data/${cikDir}/${accessionNo}.txt`);
          const downloadMs = Math.round(performance.now() - t0);
          const parsed = parseForm4Submission(txt, { accessionNo });
          setFiling(accessionNo, {
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
            parsedAt: new Date(now()).toISOString(),
            transactions: parsed.transactions,
          });
          status.filingsParsed++;
          changedSincePublish = true;
          if (item.live) liveSincePublish = true;
          // D0: complete the timeline (refreshes of records we already held are not new data).
          const tl = !refresh && timelines.get(accessionNo);
          if (tl && !tl.parsedAt) {
            Object.assign(tl, { acceptedAt: acceptedAtIso(parsed.acceptedAtET), downloadMs, parsedAt: new Date(now()).toISOString() });
            awaitingPublish.set(accessionNo, dataVersion);
          }
          const prior = retries.get(accessionNo);
          if (prior) log.log(`[FORM4_RECOVERED] acc=${accessionNo} source=${source} afterAttempts=${prior.attempts}`);
          retries.delete(accessionNo);
          if (parsed.transactions.length || refresh) {
            log.log(`[FORM4_PARSED] acc=${accessionNo} ticker=${parsed.ticker || "-"} ps=${parsed.transactions.length} source=${source} durationMs=${now() - startedAt} downloadMs=${downloadMs}`);
          }
          scheduleSave();
        } catch (err) {
          if (isThrottled(err)) {
            // D2: SEC is throttling us — not this filing's fault. Put it back at the
            // front (still queued, attempts unchanged) and stop until the pause ends.
            queue.unshift(item);
            deferred = true;
            throttle.deferredDownloads++;
            pauseForThrottle(err);
            log.warn(`[FORM4_DEFERRED] acc=${accessionNo} source=${source} reason=sec_throttled pausedForMs=${throttle.pausedUntil - now()} queue=${queue.length}`);
            break;
          }
          // A non-Form-4 document can never succeed — don't retry it.
          const permanent = /not a Form 4|no ownershipDocument/.test(err.message);
          const prev = retries.get(accessionNo);
          const attempts = (prev?.attempts || 0) + 1;
          const r = {
            // refresh: re-fetch of a record we already hold (kept until a parse succeeds).
            cikDir, source: prev?.source || source, attempts, permanent, refresh: !!refresh,
            nextAt: permanent ? null : now() + backoffMs(attempts),
            lastError: String(err.message).slice(0, 200), lastAttemptAt: new Date(now()).toISOString(),
          };
          retries.set(accessionNo, r);
          status.filingsFailed++;
          const state = permanent ? "permanent" : isExhausted(r) ? "exhausted" : `retryInMs=${r.nextAt - now()}`;
          log.warn(`[FORM4_FAILED] acc=${accessionNo} source=${source} attempt=${attempts}/${retryMaxAttempts} ${state} err=${r.lastError}`);
          scheduleSave();
        } finally {
          if (!deferred) queued.delete(accessionNo);
        }
        maybePublish();
      }
    } finally {
      status.processing = false;
      notifyBatch();
      if (initialSyncPending && !queue.length) markInitialSync();
    }
  }

  // ── Batch listeners (snapshot store, alert engine) ─────────────────────────
  const batchListeners = new Set();
  function onIngestBatch(fn) {
    batchListeners.add(fn);
    return () => batchListeners.delete(fn);
  }
  function notifyBatch() {
    changedSincePublish = false;
    liveSincePublish = false;
    lastPublishAt = now();
    status.publish.publishes++;
    status.publish.lastPublishAt = new Date(lastPublishAt).toISOString();
    for (const fn of batchListeners) {
      try { Promise.resolve(fn()).catch((err) => log.warn(`[INGEST_LISTENER] failed err=${err.message}`)); }
      catch (err) { log.warn(`[INGEST_LISTENER] failed err=${err.message}`); }
    }
  }

  // ── Sources ────────────────────────────────────────────────────────────────
  async function pollFeed(maxPages) {
    const res = { pages: 0, entries: 0, form4: 0, added: 0 };
    for (let p = 0; p < maxPages; p++) {
      const page = parseFeedForm4(await fetchText(feedUrl(p * 100)));
      res.pages++;
      res.entries += page.entries;
      res.form4 += page.form4.length;
      let addedHere = 0;
      for (const f of page.form4) if (enqueue(f.accessionNo, f.cikDir, "feed", { priority: true, feedUpdatedAt: f.updatedAt })) addedHere++;
      res.added += addedHere;
      // Stop once a page brings nothing new (older pages are already known) or the feed ends.
      if (page.entries < 100 || (addedHere === 0 && page.form4.length > 0)) break;
    }
    status.lastFeed = res;
    return res;
  }

  // Calendar date + hour in New York (EDGAR's timezone).
  function easternNow() {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(now())).map((p) => [p.type, p.value]));
    return { iso: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
  }

  // Newest business day whose daily index should be published (~10 PM ET that day).
  function latestExpectedIndexDay() {
    const { iso, hour } = easternNow();
    let d = hour < 22 ? previousDay(iso) : iso;
    while (!isBusinessDay(d)) d = previousDay(d);
    return d;
  }

  // Business days whose index we need: the backfill window, plus every business
  // day from the oldest day already held up to the newest expected (gap recovery),
  // capped at recoveryMaxDays. Newest first.
  function targetIndexDays() {
    const latest = latestExpectedIndexDay();
    const known = [...indexes.keys(), ...noIndexDays].sort();
    const days = new Set(backfillDays ? businessDaysBack(latest, backfillDays) : []);
    let truncated = false;
    if (known.length) {
      for (const d of businessDaysBack(latest, recoveryMaxDays, known[0])) days.add(d);
      const newestKnown = known[known.length - 1];
      truncated = newestKnown < latest && businessDaysBetween(newestKnown, latest) > recoveryMaxDays;
    }
    const sorted = [...days].sort().reverse();
    const missing = sorted.filter((d) => !indexes.has(d) && !noIndexDays.has(d));
    status.recovery = { latestExpectedDay: latest, newestIndexedDay: known[known.length - 1] || null, missingDays: missing.length, truncated, maxDays: recoveryMaxDays };
    if (truncated) log.warn(`[EDGAR_RECOVERY] outage exceeds ${recoveryMaxDays} business days — days older than the cap are not recovered (raise EDGAR_RECOVERY_MAX_DAYS)`);
    return { latest, days: sorted };
  }

  // Fetches any target index not yet held and enqueues its unseen filings.
  async function syncDailyIndexes() {
    const { latest, days } = targetIndexDays();
    const results = [];
    let firstError = null;
    for (const day of days) {
      if (indexes.has(day) || noIndexDays.has(day)) continue;
      if (now() - (unpublishedAt.get(day) || 0) < UNPUBLISHED_RETRY_MS) { results.push(`${day}:unpublished`); continue; }
      let entries;
      try {
        entries = parseDailyFormIndex(await fetchText(dailyIndexUrl(isoToCompact(day)), { retries: 1 }));
        unpublishedAt.delete(day);
      } catch (err) {
        if (isThrottled(err)) {
          // D2: SEC paused — stop asking for further days this poll.
          firstError ||= err;
          results.push(`${day}:throttled`);
          break;
        }
        if (err.status === 404 && day < latest) {
          // A past business day with no index — SEC was closed. Never re-requested.
          noIndexDays.add(day); scheduleSave();
          results.push(`${day}:no-index`); continue;
        }
        if (err.status === 404) { unpublishedAt.set(day, now()); results.push(`${day}:unpublished`); continue; }
        // 5xx/network: transient — try again next poll, keep going with other days.
        firstError ||= err;
        results.push(`${day}:error`);
        continue;
      }
      indexes.set(day, entries.map((e) => e.accessionNo));
      scheduleSave();
      let added = 0;
      for (const e of entries) if (enqueue(e.accessionNo, e.cikDir, `index:${day}`)) added++;
      results.push(`${day}:listed=${entries.length},queued=${added}`);
    }
    status.recovery.missingDays = days.filter((d) => !indexes.has(d) && !noIndexDays.has(d)).length;
    status.lastIndexCheck = { at: new Date(now()).toISOString(), results };
    if (results.length) log.log(`[EDGAR_INDEX] ${results.join(" ")}`);
    if (firstError) throw firstError;
  }

  // One discovery pass: feed first (live filings jump the queue), then daily indexes, then due retries.
  async function discover(feedPages) {
    const startedAt = now();
    status.lastPollAttemptAt = new Date(startedAt).toISOString();
    if (isPaused()) {
      // D2: never contact SEC while paused; freshness/health report the gap.
      throttle.skippedPolls++;
      log.warn(`[EDGAR_POLL_SKIPPED] reason=sec_throttled resumesInMs=${throttle.pausedUntil - now()} queue=${queue.length}`);
      return;
    }
    const errors = [];
    let feed = null;
    try { feed = await pollFeed(feedPages); } catch (err) { errors.push(`feed: ${err.message}`); if (isThrottled(err)) pauseForThrottle(err); }
    if (!isPaused()) {
      try { await syncDailyIndexes(); } catch (err) { errors.push(`index: ${err.message}`); if (isThrottled(err)) pauseForThrottle(err); }
    }
    const retried = enqueueDueRetries();
    if (errors.length) {
      status.lastPollError = redact(errors.join("; "));
      status.lastPollErrorAt = new Date(now()).toISOString();
      status.consecutivePollFailures++;
      log.warn(formatEvent("EDGAR_POLL_FAILED", { consecutive: status.consecutivePollFailures, err: status.lastPollError }));
    } else {
      // lastPollAt = last FULLY successful poll (freshness is measured from it).
      status.lastPollAt = new Date(now()).toISOString();
      status.lastPollError = null;
      status.consecutivePollFailures = 0;
    }
    if (feed) log.log(`[EDGAR_POLL] feedPages=${feed.pages} entries=${feed.entries} form4=${feed.form4} new=${feed.added} retriesDue=${retried} queue=${queue.length} processing=${status.processing} durationMs=${now() - startedAt}`);
  }

  // D1: overlapping polls share one discovery run (no duplicate SEC requests);
  // downloads continue in the single processQueue worker.
  let discovery = null;
  async function pollOnce(feedPages = feedMaxPages) {
    if (discovery) status.overlappingPollsJoined++;
    else discovery = discover(feedPages).finally(() => { discovery = null; });
    await discovery;
    await processQueue();
  }

  let initialSyncPending = false;
  function markInitialSync() {
    initialSyncPending = false;
    status.initialSyncCompletedAt = new Date(now()).toISOString();
  }

  let pollTimer = null;
  async function start() {
    if (status.startedAt) return;
    status.startedAt = new Date(now()).toISOString();
    loadCache();
    // Cached index lists may reference filings dropped as stale — re-fetch those
    // indexes. Filings with persisted retry state are recovered by the retry path.
    for (const [day, accs] of indexes) if (accs.some((a) => !filings.has(a) && !retries.has(a))) indexes.delete(day);
    // D1: the poll timer runs from the start, so the live feed keeps being polled
    // while the startup catch-up downloads (it used to start only afterwards).
    pollTimer = setInterval(() => {
      pollOnce(feedMaxPages).catch((err) => log.warn(`[EDGAR_POLL] unexpected err=${redact(err)}`));
    }, pollMs);
    initialSyncPending = true;
    await pollOnce(feedMaxPages);
    // Startup backfill finished — the alert engine may only run after this point.
    // (If SEC throttled the catch-up, this happens when the queue later drains.)
    if (initialSyncPending && !queue.length) markInitialSync();
  }

  function stop() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    if (resumeTimer) clearTimer(resumeTimer);
    resumeTimer = null;
  }

  // ── Read API ───────────────────────────────────────────────────────────────
  function getTransactions() {
    const out = [];
    for (const f of filings.values()) for (const t of f.transactions) out.push(t);
    return out;
  }

  // Filing-level metadata of every amendment held (incl. ones without P/S rows).
  function getAmendmentFilings() {
    const out = [];
    for (const [accessionNo, f] of filings) {
      if (f.formType !== "4/A") continue;
      out.push({
        accessionNo, issuerCik: f.issuerCik ?? f.transactions[0]?.issuerCik ?? null,
        ownerCiks: f.ownerCiks ?? [...new Set(f.transactions.flatMap((t) => (t.owners || []).map((o) => o.cik)).filter(Boolean))],
        originalSubmissionDate: f.originalSubmissionDate ?? null,
        hasNonDerivativeTable: f.hasNonDerivativeTable ?? null,
        totalNonDerivative: f.totalNonDerivative ?? null,
        acceptedAtET: f.acceptedAtET ?? f.transactions[0]?.acceptedAtET ?? null,
        filingDate: f.filingDate,
      });
    }
    return out;
  }

  // Per-day completeness against the official daily index.
  function getCoverage() {
    return [...indexes.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([day, accs]) => {
        let parsed = 0, failed = 0, pending = 0, retrying = 0;
        for (const a of accs) {
          const r = retries.get(a);
          if (filings.has(a)) parsed++;
          else if (r && isExhausted(r)) failed++;
          else { pending++; if (r) retrying++; }
        }
        return { day, listed: accs.length, parsed, failed, pending, retrying };
      });
  }

  function getStatus() {
    let scheduled = 0, exhausted = 0, permanent = 0;
    for (const r of retries.values()) {
      if (r.permanent) permanent++;
      else if (isExhausted(r)) exhausted++;
      else scheduled++;
    }
    let liveQueued = 0;
    for (const q of queue) if (q.live) liveQueued++;
    return {
      ...status,
      filingsStored: filings.size,
      queueLength: queue.length,
      liveQueued,
      pollIntervalMs: pollMs,
      retry: { scheduled, exhausted, permanent, maxAttempts: retryMaxAttempts },
      noIndexDays: [...noIndexDays].sort().reverse().slice(0, 10),
      coverage: getCoverage(),
      cache: { ...stats, dirty },
      dataVersion,
      throttle: {
        paused: isPaused(),
        pausedUntil: throttle.pausedUntil ? new Date(throttle.pausedUntil).toISOString() : null,
        remainingMs: Math.max(throttle.pausedUntil - now(), 0),
        events: throttle.events, deferredDownloads: throttle.deferredDownloads, skippedPolls: throttle.skippedPolls,
        lastThrottledAt: throttle.lastThrottledAt ? new Date(throttle.lastThrottledAt).toISOString() : null,
        lastError: throttle.lastError,
      },
      latency: { ...latency.summary(), awaitingPublication: awaitingPublish.size },
      edgar: getClientStats(),
    };
  }

  return {
    start, stop, flush, pollOnce, processQueue, saveNow, onIngestBatch, markPublished,
    getDataVersion: () => dataVersion,
    getTransactions, getAmendmentFilings, getCoverage, getStatus,
    _state: { filings, indexes, retries, noIndexDays, queue, queued, timelines },
  };
}

// ── Default instance (server) — exported API unchanged ───────────────────────
let instance = null;
const ingest = () => (instance ||= createInsiderIngest());

export const startInsiderIngest = () => ingest().start();
export const stopInsiderIngest = () => ingest().stop();
export const flushInsiderIngest = () => ingest().flush();
export const getIngestDataVersion = () => ingest().getDataVersion();
export const onIngestBatch = (fn) => ingest().onIngestBatch(fn);
export const markIngestPublished = (version, atMs) => ingest().markPublished(version, atMs);
export const getTransactions = () => ingest().getTransactions();
export const getAmendmentFilings = () => ingest().getAmendmentFilings();
export const getCoverage = () => ingest().getCoverage();
export const getIngestStatus = () => ingest().getStatus();
