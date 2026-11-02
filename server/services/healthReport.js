// server/services/healthReport.js
//
// Pure health classification for /api/health and /api/health/ready.
//
//   status "ok"        every enabled subsystem is healthy
//   status "degraded"  serving, but something needs attention (see reasons[])
//   ready  false       a monitor / load balancer should not route traffic here:
//                      initial SEC sync not finished, SEC data badly stale, or
//                      accounts are configured but MongoDB is down.
//
// Features that are intentionally OFF (no MONGO_URI, no Firebase, alerts
// disabled) are reported as "disabled" and never count as unhealthy.

export const DEFAULTS = {
  staleAfterPolls: 3,          // SEC poll older than 3 intervals → degraded
  notReadyAfterMs: 15 * 60_000, // … older than 15 min → not ready
  cacheDirtyMaxMs: 5 * 60_000, // unsaved SEC cache changes older than 5 min → degraded
};

const ageMs = (iso, now) => (iso ? Math.max(now - Date.parse(iso), 0) : null);

// db: getDbState(); ingest: getIngestStatus(); snapshot: getSnapshotStats();
// → { status, ready, reasons[], checks{} }
export function computeHealth({ db, ingest, snapshot = null, accountsConfigured, now = Date.now() }, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const reasons = [];
  let ready = true;

  // ── MongoDB ──
  let mongo;
  if (!accountsConfigured) {
    mongo = { state: "disabled", reason: db?.reason || null };
  } else if (!db?.verified) {
    mongo = { state: "unverified", reason: db?.reason || null };
    reasons.push("mongo_unverified");
  } else {
    const up = !!db.connected;
    mongo = {
      state: up ? "connected" : "disconnected",
      lastPingAt: db.lastPingAt, lastPingMs: db.lastPingMs, pingFailures: db.pingFailures,
      disconnectedForMs: up ? null : ageMs(db.disconnectedSince, now),
      disconnects: db.disconnects, reconnects: db.reconnects, lastError: db.lastError,
      indexIssues: db.indexIssues || [],
    };
    if (!up) { reasons.push("mongo_disconnected"); ready = false; }
    else if (db.pingFailures > 0) reasons.push("mongo_ping_failing");
    if ((db.indexIssues || []).length) reasons.push("mongo_index_conflict");
  }

  // ── SEC polling ──
  const pollMs = ingest?.pollIntervalMs || 60_000;
  const sinceOk = ageMs(ingest?.lastPollAt, now);
  const initialSync = !!ingest?.initialSyncCompletedAt;
  const stale = sinceOk == null ? initialSync : sinceOk > pollMs * o.staleAfterPolls;
  const sec = {
    state: !initialSync ? "initial_sync" : stale ? "stale" : ingest?.lastPollError ? "error" : "ok",
    lastPollAt: ingest?.lastPollAt ?? null, lastPollAgeMs: sinceOk,
    lastPollAttemptAt: ingest?.lastPollAttemptAt ?? null,
    lastPollError: ingest?.lastPollError ?? null, consecutivePollFailures: ingest?.consecutivePollFailures ?? 0,
    pollIntervalMs: pollMs, initialSyncCompletedAt: ingest?.initialSyncCompletedAt ?? null,
  };
  if (!initialSync) { reasons.push("sec_initial_sync"); ready = false; }
  else if (stale) {
    reasons.push("sec_poll_stale");
    if (sinceOk == null || sinceOk > o.notReadyAfterMs) ready = false;
  } else if (ingest?.lastPollError) reasons.push("sec_poll_error");

  // ── SEC throttling (Phase D2): 429/403 → all SEC requests paused ──
  // Degraded while paused; readiness still follows data freshness above.
  const breaker = ingest?.edgar?.breaker || null;
  const th = ingest?.throttle || null;
  const clientPaused = breaker?.state === "open";
  const ingestPaused = !!th?.pausedUntil && Date.parse(th.pausedUntil) > now;
  sec.throttle = {
    state: clientPaused || ingestPaused ? "throttled" : breaker?.state === "half_open" ? "probing" : "ok",
    lastStatus: breaker?.lastStatus ?? null,
    pausedUntil: breaker?.pausedUntil ?? th?.pausedUntil ?? null,
    remainingMs: Math.max(breaker?.remainingMs ?? 0, ingestPaused ? Date.parse(th.pausedUntil) - now : 0),
    consecutiveThrottles: breaker?.consecutiveThrottles ?? 0,
    throttleEvents: breaker?.throttleEvents ?? th?.events ?? 0,
    blockedRequests: breaker?.blockedRequests ?? 0,
    deferredDownloads: th?.deferredDownloads ?? 0,
    skippedPolls: th?.skippedPolls ?? 0,
    lastThrottleAt: breaker?.lastThrottleAt ?? th?.lastThrottledAt ?? null,
  };
  if (sec.throttle.state === "throttled") reasons.push("sec_throttled");

  // ── Pipeline latency (Phase D0) — informational, never affects status ──
  const live = ingest?.latency?.live;
  sec.latency = live
    ? { liveFilings: live.filings, endToEndMs: live.metrics?.acceptedToPublished ?? null, discoveryMs: live.metrics?.acceptedToDiscovered ?? null, awaitingPublication: ingest.latency.awaitingPublication ?? 0 }
    : null;

  // ── Ingestion (downloads, retries, coverage) ──
  const coverage = ingest?.coverage || [];
  const incompleteDays = coverage.filter((c) => c.failed > 0).map((c) => c.day);
  const retry = ingest?.retry || { scheduled: 0, exhausted: 0, permanent: 0 };
  const ingestion = {
    state: retry.exhausted > 0 || incompleteDays.length ? "failures" : (ingest?.queueLength || 0) > 0 || retry.scheduled > 0 ? "catching_up" : "ok",
    queueLength: ingest?.queueLength ?? 0,
    retriesScheduled: retry.scheduled, retriesExhausted: retry.exhausted, permanentFailures: retry.permanent,
    filingsFailedAttempts: ingest?.filingsFailed ?? 0,
    daysWithFailures: incompleteDays,
    recovery: ingest?.recovery ?? null,
  };
  if (retry.exhausted > 0) reasons.push("sec_downloads_exhausted");
  if (ingest?.recovery?.truncated) reasons.push("sec_recovery_truncated");

  // ── SEC cache writes ──
  const c = ingest?.cache || {};
  const dirtyFor = ageMs(c.dirtySince, now);
  const cache = {
    state: c.consecutiveFailures > 0 ? "failing" : dirtyFor != null && dirtyFor > o.cacheDirtyMaxMs ? "behind" : "ok",
    lastSaveAt: c.lastSaveAt ?? null, lastSaveMs: c.lastSaveMs ?? null, saves: c.saves ?? 0,
    saveFailures: c.saveFailures ?? 0, consecutiveFailures: c.consecutiveFailures ?? 0,
    lastError: c.lastError ?? null, unsavedForMs: dirtyFor,
  };
  if (cache.state === "failing") reasons.push("cache_write_failing");
  else if (cache.state === "behind") reasons.push("cache_write_behind");

  // ── Processed-data snapshot ──
  const snap = snapshot
    ? { state: snapshot.builds > 0 ? "ok" : "not_built", builds: snapshot.builds, lastBuildMs: snapshot.lastBuildMs, lastBuiltAt: snapshot.lastBuiltAt, rows: snapshot.rows,
        behindIngest: snapshot.version != null && ingest?.dataVersion != null && snapshot.version !== ingest.dataVersion }
    : null;

  return { status: reasons.length ? "degraded" : "ok", ready, reasons, checks: { mongo, sec, ingestion, cache, snapshot: snap } };
}
