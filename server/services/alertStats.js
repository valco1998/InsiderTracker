/**
 * In-memory alert pipeline counters — accumulated since server start.
 * All alert paths import `inc()` to update these.
 * Exposed via GET /api/alerts/stats for the UI and debugging.
 *
 * Deliberately NOT persisted — resets on deploy/restart, which is fine.
 * The numbers are for real-time monitoring, not historical analytics.
 */

const _s = {
  // Market ingestion
  itemsScanned:          0,   // market items received from Empire WS
  itemsCached:           0,   // items successfully upserted into market cache

  // Rule matching
  rulesMatched:          0,   // total individual rule×item matches

  // Alert creation
  alertsCreated:         0,   // new AlertLog documents written
  alertsSkippedCooldown: 0,   // match passed but cooldown still active
  alertsSkippedDedupe:   0,   // match passed but duplicate (11000 / already alerted)
  alertsSkippedNoPriceImprovement: 0, // cooldown expired but price didn't improve enough to re-alert
  alertsRetriggeredPriceImproved:  0, // cooldown expired and price improved enough to re-alert

  // Push delivery
  pushSent:              0,   // successful Firebase token deliveries
  pushFailed:            0,   // failed Firebase token deliveries
  pushSkippedNoTokens:   0,   // userId had no active FCM tokens
  pushAggregated:        0,   // individual pushes collapsed into a summary notification
  tokenInvalidRemoved:   0,   // FCM tokens deactivated due to invalid/not-registered error

  // Live WS watchlist path — silent-drop observability (Phase 5B)
  liveEventsUnrecognized:  0, // WS event payload shape yielded zero items
  liveItemsNoId:           0, // listing dropped by upsertIntoCache (no id after normalize)
  liveItemsPreGateDropped: 0, // cached item missing id/name/price before rule matching
  liveNoRulesLoaded:       0, // listing checked while the rule cache was empty
  liveRulesMissingUserId:  0, // rules without userId seen on rule-cache refresh
  liveRejectWear:          0, // name matched, rejected on wear mismatch
  liveRejectWearUnknown:   0, // name matched, rule has wear but item wear undeterminable
  liveRejectTargetPrice:   0, // name matched, price above rule target
  liveRejectMinDiscount:   0, // name matched, discount below rule minimum
  liveProcessRejected:     0, // processMatchedItem promise rejected (thrown error)
  liveAlertCheckFailed:    0, // processLiveItemForAlerts threw for a listing
  alertStateClaimError:    0, // AlertState claim failed with a non-11000 error

  startedAt: Date.now(),
};

/**
 * Increment a counter.
 * @param {keyof typeof _s} key
 * @param {number} [n=1]
 */
export function inc(key, n = 1) {
  if (Object.prototype.hasOwnProperty.call(_s, key) && typeof _s[key] === "number") {
    _s[key] += n;
  }
}

// ── Log sampling ──────────────────────────────────────────────────────────────

const _sampledAt = new Map();

/**
 * Returns true at most once per `intervalMs` for a given key — use to throttle
 * diagnostic logs on hot paths so they can't flood the log stream.
 * @param {string} key
 * @param {number} [intervalMs=60000]
 */
export function shouldSample(key, intervalMs = 60_000) {
  const now  = Date.now();
  const last = _sampledAt.get(key);
  if (last !== undefined && now - last < intervalMs) return false;
  _sampledAt.set(key, now);
  return true;
}

// ── Latency ring buffers ──────────────────────────────────────────────────────

const MAX_SAMPLES = 200;

const _lat = {
  // Stage 1: market WS event → rule match confirmed
  detectionToMatch:    [],
  // Stage 2: rule match → AlertLog.create returned
  matchToCreated:      [],
  // Stage 3: AlertLog created → sendPushToUser() called
  createdToPushStart:  [],
  // Stage 4 (browser): market WS event → socket received by client tab
  detectionToSocket:   [],
  // Stage 5 (mobile): market WS event → Firebase Admin sendEachForMulticast ACK
  detectionToPush:     [],
};

/**
 * Record one latency sample.
 * @param {keyof typeof _lat} type
 * @param {number} ms
 */
export function recordLatency(type, ms) {
  if (!Object.prototype.hasOwnProperty.call(_lat, type)) return;
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return;
  _lat[type].push(ms);
  if (_lat[type].length > MAX_SAMPLES) _lat[type].shift();
}

function _computeStats(samples) {
  if (!samples.length) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const n = sorted.length;
  return {
    count: n,
    last:  samples[samples.length - 1],
    avg:   Math.round(sorted.reduce((s, v) => s + v, 0) / n),
    p50:   sorted[Math.floor((n - 1) * 0.50)],
    p95:   sorted[Math.floor((n - 1) * 0.95)],
    p99:   sorted[Math.floor((n - 1) * 0.99)],
    max:   sorted[n - 1],
    min:   sorted[0],
  };
}

function getLatencyStats() {
  return {
    detectionToMatch:   _computeStats(_lat.detectionToMatch),
    matchToCreated:     _computeStats(_lat.matchToCreated),
    createdToPushStart: _computeStats(_lat.createdToPushStart),
    detectionToSocket:  _computeStats(_lat.detectionToSocket),
    detectionToPush:    _computeStats(_lat.detectionToPush),
  };
}

/** Return a snapshot of all counters + latency stats. */
export function getAlertStats() {
  return {
    ..._s,
    uptimeMs:     Date.now() - _s.startedAt,
    startedAtIso: new Date(_s.startedAt).toISOString(),
    latency:      getLatencyStats(),
  };
}

/** Reset all counters and latency buffers. */
export function resetAlertStats() {
  for (const key of Object.keys(_s)) {
    if (key !== "startedAt") _s[key] = 0;
  }
  _s.startedAt = Date.now();
  for (const arr of Object.values(_lat)) arr.length = 0;
}
