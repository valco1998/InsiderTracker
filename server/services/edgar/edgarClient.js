// server/services/edgar/edgarClient.js
//
// Minimal SEC EDGAR HTTP client, compliant with SEC fair-access policy
// (https://www.sec.gov/os/accessing-edgar-data):
//   • every request declares a User-Agent with contact info (SEC_USER_AGENT, required)
//   • global throttle: at most EDGAR_MAX_RPS requests/second (default 5, SEC cap is 10)
//   • bounded retries with backoff on 5xx / network errors
//   • only www.sec.gov and data.sec.gov can be requested
//   • GLOBAL circuit breaker on 429 / 403 (SEC rate limiting / access block):
//       - every SEC request pauses, not just the one that was throttled;
//       - Retry-After (seconds or HTTP date) is honoured when SEC sends it;
//         otherwise 429 → EDGAR_THROTTLE_429_MS (60s), 403 → EDGAR_THROTTLE_403_MS
//         (10 min — SEC blocks over-limit clients for about 10 minutes), doubling
//         on consecutive throttles up to EDGAR_THROTTLE_MAX_MS (1h);
//       - while open, requests fail fast with EdgarThrottledError WITHOUT touching
//         the network; after the pause one probe request is let through (half-open)
//         and its outcome closes or re-opens the breaker.
//     Callers recognise EdgarThrottledError (err.throttled) and must not count it
//     as a failed attempt for the requested document.

const ALLOWED_HOSTS = new Set(["www.sec.gov", "data.sec.gov"]);

export class EdgarConfigError extends Error {}

export class EdgarThrottledError extends Error {
  constructor(message, { status = null, retryAfterMs = null, circuitOpen = false } = {}) {
    super(message);
    this.name = "EdgarThrottledError";
    this.throttled = true;
    this.status = status;          // 429 / 403 when SEC answered; null when the breaker refused locally
    this.retryAfterMs = retryAfterMs; // how long until SEC may be asked again
    this.circuitOpen = circuitOpen;   // true = no request was sent
  }
}

export const isThrottleStatus = (status) => status === 429 || status === 403;

// SEC requires "Sample Company Name AdminContact@<sample company domain>.com".
export function getUserAgent() {
  const ua = (process.env.SEC_USER_AGENT || "").trim();
  if (!ua || !/\S+@\S+\.\S+/.test(ua)) {
    throw new EdgarConfigError(
      'SEC_USER_AGENT is not set (or has no contact email). Example: SEC_USER_AGENT="InsiderTracker you@example.com"'
    );
  }
  return ua;
}

const envInt = (name, def, min, max) => Math.min(Math.max(Number(process.env[name]) || def, min), max);

// Retry-After: delta-seconds or an HTTP date. → ms (≥ 0) or null when absent/invalid.
export function parseRetryAfter(value, nowMs = Date.now()) {
  if (value == null) return null;
  const v = String(value).trim();
  if (/^\d+$/.test(v)) return Number(v) * 1000;
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.max(t - nowMs, 0) : null;
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));
const iso = (ms) => (ms ? new Date(ms).toISOString() : null);

export function createEdgarClient({
  fetchImpl = (url, init) => fetch(url, init),
  now = () => Date.now(),
  sleep = defaultSleep,
  userAgent = getUserAgent,
  maxRps = envInt("EDGAR_MAX_RPS", 5, 1, 9),
  throttle429Ms = envInt("EDGAR_THROTTLE_429_MS", 60_000, 1000, 3_600_000),
  throttle403Ms = envInt("EDGAR_THROTTLE_403_MS", 600_000, 1000, 3_600_000),
  throttleMaxMs = envInt("EDGAR_THROTTLE_MAX_MS", 3_600_000, 1000, 6 * 3_600_000),
  log = console,
} = {}) {
  const minIntervalMs = Math.ceil(1000 / maxRps);

  // Slot reservation is synchronous, so concurrent callers are serialized
  // at minIntervalMs spacing without a separate queue.
  let nextSlotAt = 0;
  async function throttle() {
    const t = now();
    const wait = Math.max(0, nextSlotAt - t);
    nextSlotAt = Math.max(t, nextSlotAt) + minIntervalMs;
    if (wait) await sleep(wait);
  }

  const stats = { requests: 0, errors: 0, retries: 0, lastRequestAt: null, lastStatus: null };

  // ── Circuit breaker ────────────────────────────────────────────────────────
  const breaker = {
    state: "closed", // closed | open (half-open = open with an expired pause; see admit())
    openedAt: 0, openUntil: 0, reason: null, lastStatus: null, lastRetryAfterMs: null,
    consecutive: 0, events: 0, blockedRequests: 0, lastThrottleAt: 0, totalPausedMs: 0,
    probeInFlight: false,
  };

  function refuse(retryAfterMs) {
    breaker.blockedRequests++;
    return new EdgarThrottledError(`[EDGAR] paused after HTTP ${breaker.lastStatus} — SEC not contacted`, {
      status: null, retryAfterMs: Math.max(retryAfterMs, 0), circuitOpen: true,
    });
  }

  // → true when this request is the half-open probe. Throws when paused.
  function admit() {
    if (breaker.state === "closed") return false;
    const remaining = breaker.openUntil - now();
    if (remaining > 0) throw refuse(remaining);
    if (breaker.probeInFlight) throw refuse(1000);
    breaker.probeInFlight = true;
    return true;
  }

  function open(status, retryAfterHeader, path) {
    const t = now();
    breaker.consecutive++;
    breaker.events++;
    const retryAfter = parseRetryAfter(retryAfterHeader, t);
    const base = status === 429 ? throttle429Ms : throttle403Ms;
    const pauseMs = retryAfter != null
      ? Math.min(Math.max(retryAfter, 1000), throttleMaxMs)
      : Math.min(base * 2 ** (breaker.consecutive - 1), throttleMaxMs);
    if (breaker.state === "closed") breaker.openedAt = t;
    breaker.state = "open";
    breaker.openUntil = Math.max(breaker.openUntil, t + pauseMs);
    breaker.reason = `HTTP ${status}`;
    breaker.lastStatus = status;
    breaker.lastRetryAfterMs = retryAfter;
    breaker.lastThrottleAt = t;
    log.warn(`[EDGAR_THROTTLED] status=${status} path=${path} pauseMs=${breaker.openUntil - t} retryAfterMs=${retryAfter ?? "none"} consecutive=${breaker.consecutive}`);
    return breaker.openUntil - t;
  }

  function close() {
    if (breaker.state === "closed") return;
    const pausedMs = now() - breaker.openedAt;
    breaker.totalPausedMs += pausedMs;
    log.log(`[EDGAR_THROTTLE_CLEARED] afterMs=${pausedMs} events=${breaker.events}`);
    Object.assign(breaker, { state: "closed", openedAt: 0, openUntil: 0, reason: null, consecutive: 0 });
  }

  function getStats() {
    const t = now();
    const open_ = breaker.state === "open";
    return {
      ...stats,
      maxRps,
      breaker: {
        // "half_open": the pause has elapsed; the next request is a probe.
        state: !open_ ? "closed" : breaker.openUntil > t ? "open" : "half_open",
        reason: breaker.reason,
        lastStatus: breaker.lastStatus,
        pausedUntil: open_ ? iso(breaker.openUntil) : null,
        remainingMs: open_ ? Math.max(breaker.openUntil - t, 0) : 0,
        lastRetryAfterMs: breaker.lastRetryAfterMs,
        consecutiveThrottles: breaker.consecutive,
        throttleEvents: breaker.events,
        blockedRequests: breaker.blockedRequests,
        lastThrottleAt: iso(breaker.lastThrottleAt),
        totalPausedMs: breaker.totalPausedMs,
      },
    };
  }

  async function getText(url, { retries = 3, timeoutMs = 20000 } = {}) {
    const u = new URL(url);
    if (u.protocol !== "https:" || !ALLOWED_HOSTS.has(u.hostname)) {
      throw new Error(`[EDGAR] refusing non-SEC URL: ${u.hostname}`);
    }
    const ua = userAgent();

    for (let attempt = 0; ; attempt++) {
      const probe = admit();
      let probeSettled = false;
      const settleProbe = (closeIt) => {
        if (!probe || probeSettled) return;
        probeSettled = true;
        breaker.probeInFlight = false;
        if (closeIt) close();
      };
      await throttle();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const startedAt = Date.now();
      try {
        stats.requests++;
        stats.lastRequestAt = new Date(now()).toISOString();
        const res = await fetchImpl(u, {
          headers: { "User-Agent": ua, Accept: "*/*" },
          signal: controller.signal,
        });
        stats.lastStatus = res.status;

        if (isThrottleStatus(res.status)) {
          // SEC rate limiting / access block: pause ALL SEC traffic; never retried here.
          const retryAfterMs = open(res.status, res.headers?.get?.("retry-after"), u.pathname);
          settleProbe(false);
          stats.errors++;
          throw new EdgarThrottledError(`[EDGAR] HTTP ${res.status} ${u.pathname}`, { status: res.status, retryAfterMs });
        }
        // Any other answer proves SEC is serving us again.
        // (A non-probe request admitted before a pause began never closes the breaker.)
        settleProbe(true);
        if (res.ok) return await res.text();

        if (res.status >= 500 && attempt < retries) {
          const backoff = 1000 * 2 ** attempt;
          stats.retries++;
          log.warn(`[EDGAR] status=${res.status} path=${u.pathname} attempt=${attempt + 1} backoffMs=${backoff}`);
          await sleep(backoff);
          continue;
        }
        const err = new Error(`[EDGAR] HTTP ${res.status} ${u.pathname}`);
        err.status = res.status;
        throw err;
      } catch (err) {
        if (err.throttled || err.status) {
          if (!err.throttled) stats.errors++;
          throw err;
        }
        // Network error / timeout: not evidence of throttling; release a probe without closing.
        settleProbe(false);
        if (attempt < retries) {
          stats.retries++;
          log.warn(`[EDGAR] network error path=${u.pathname} attempt=${attempt + 1} durationMs=${Date.now() - startedAt} err=${err.message}`);
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        stats.errors++;
        throw err;
      } finally {
        clearTimeout(timer);
        settleProbe(false);
      }
    }
  }

  return { getText, getStats, _breaker: breaker };
}

// ── Default instance (server) — exported API unchanged ───────────────────────
const defaultClient = createEdgarClient();
export const edgarGetText = (url, opts) => defaultClient.getText(url, opts);
export const getEdgarClientStats = () => defaultClient.getStats();
