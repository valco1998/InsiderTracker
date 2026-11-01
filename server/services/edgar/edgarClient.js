// server/services/edgar/edgarClient.js
//
// Minimal SEC EDGAR HTTP client, compliant with SEC fair-access policy
// (https://www.sec.gov/os/accessing-edgar-data):
//   • every request declares a User-Agent with contact info (SEC_USER_AGENT, required)
//   • global throttle: at most EDGAR_MAX_RPS requests/second (default 5, SEC cap is 10)
//   • bounded retries with backoff on 429 / 5xx / network errors
//   • only www.sec.gov and data.sec.gov can be requested

const ALLOWED_HOSTS = new Set(["www.sec.gov", "data.sec.gov"]);

export class EdgarConfigError extends Error {}

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

const MAX_RPS = Math.min(Math.max(Number(process.env.EDGAR_MAX_RPS) || 5, 1), 9);
const MIN_INTERVAL_MS = Math.ceil(1000 / MAX_RPS);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Slot reservation is synchronous, so concurrent callers are serialized
// at MIN_INTERVAL_MS spacing without a separate queue.
let nextSlotAt = 0;
async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, nextSlotAt - now);
  nextSlotAt = Math.max(now, nextSlotAt) + MIN_INTERVAL_MS;
  if (wait) await sleep(wait);
}

const stats = { requests: 0, errors: 0, retries: 0, lastRequestAt: null, lastStatus: null };
export function getEdgarClientStats() {
  return { ...stats, maxRps: MAX_RPS };
}

export async function edgarGetText(url, { retries = 3, timeoutMs = 20000 } = {}) {
  const u = new URL(url);
  if (u.protocol !== "https:" || !ALLOWED_HOSTS.has(u.hostname)) {
    throw new Error(`[EDGAR] refusing non-SEC URL: ${u.hostname}`);
  }
  const userAgent = getUserAgent();

  for (let attempt = 0; ; attempt++) {
    await throttle();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();
    try {
      stats.requests++;
      stats.lastRequestAt = new Date().toISOString();
      const res = await fetch(u, {
        headers: { "User-Agent": userAgent, Accept: "*/*" },
        signal: controller.signal,
      });
      stats.lastStatus = res.status;
      if (res.ok) return await res.text();

      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt < retries) {
        // 429 means we exceeded SEC's limit: back off hard.
        const backoff = res.status === 429 ? 10_000 * (attempt + 1) : 1000 * 2 ** attempt;
        stats.retries++;
        console.warn(`[EDGAR] status=${res.status} path=${u.pathname} attempt=${attempt + 1} backoffMs=${backoff}`);
        await sleep(backoff);
        continue;
      }
      const err = new Error(`[EDGAR] HTTP ${res.status} ${u.pathname}`);
      err.status = res.status;
      throw err;
    } catch (err) {
      if (err.status) { stats.errors++; throw err; }
      if (attempt < retries) {
        stats.retries++;
        console.warn(`[EDGAR] network error path=${u.pathname} attempt=${attempt + 1} durationMs=${Date.now() - startedAt} err=${err.message}`);
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      stats.errors++;
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
