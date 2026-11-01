/**
 * soldHistoryFetcher.js
 *
 * Opportunistically fetches confirmed sale history from the Empire
 * `/trading/item/{id}/sales` endpoint and persists it to the SoldHistory
 * collection. (Not `/trading/item/{id}` — that endpoint returns
 * `similar_listings.active`, never `.historic`, regardless of auth.)
 *
 * Triggered by new_item WS events via enqueue(). Never blocks the WS handler
 * or the alert matching pipeline — all fetching happens asynchronously.
 *
 * Rate limiting:
 *   - MAX_CONCURRENT = 2 in-flight fetches at any time
 *   - DISPATCH_DELAY_MS = 1500ms between dispatches (~40 req/min max)
 *   - On 429: pause all fetches for PAUSE_ON_429_MS (2 minutes)
 *   - Respects empireRateGuard blocked state (shared API key)
 *   - Per-skin cache TTL of 12h prevents redundant re-fetches
 */

import SoldHistory from "../models/SoldHistory.model.js";
import { getEmpireRateGuardState } from "./empireRateGuard.js";
import { extractWearFromName } from "../controllers/alerts.controller.js";

const CACHE_TTL_MS      = 12 * 60 * 60 * 1000;  // 12 hours per skin
const ERROR_BACKOFF_MS  =  1 * 60 * 60 * 1000;  //  1 hour backoff after fetch error
const MAX_CONCURRENT    = 2;
const DISPATCH_DELAY_MS = 1500;
const PAUSE_ON_429_MS   = 120_000;               // 2 minutes

// Temporary diagnostics — logs full picture for the first N fetches so we can
// audit whether "no historic data" is an empty API response or a filter mismatch.
// Remove once the matching behaviour is confirmed.
const DIAG_LIMIT = 20;
let   diagCount  = 0;

// Per-skin state: marketHashName → { fetchedAt: ms, status: 'pending'|'done'|'error' }
const skinFetchCache = new Map();

const fetchQueue   = [];   // Array<{ itemId: string, marketHashName: string }>
let activeFetches  = 0;
let pausedUntil    = 0;
let dispatchHandle = null; // pending setTimeout handle

// ── Dispatcher ───────────────────────────────────────────────────────────────

function scheduleDispatch(delayMs = 0) {
  if (dispatchHandle !== null) return;
  dispatchHandle = setTimeout(dispatchNext, delayMs);
}

function dispatchNext() {
  dispatchHandle = null;

  // 429 pause
  const now = Date.now();
  if (now < pausedUntil) {
    scheduleDispatch(pausedUntil - now + 50);
    return;
  }

  // Respect the main rate guard's blocked state (shared API key)
  const guard = getEmpireRateGuardState();
  if (guard.isBlocked) {
    const waitMs = Math.min(guard.retryAfterMs + 500, 180_000);
    console.log(`[SOLD_HISTORY] main rate guard blocked — delaying ${Math.round(waitMs / 1000)}s`);
    scheduleDispatch(waitMs);
    return;
  }

  while (fetchQueue.length > 0 && activeFetches < MAX_CONCURRENT) {
    const task = fetchQueue.shift();

    // Re-validate cache — another task in this batch may have already fetched it
    const cached = skinFetchCache.get(task.marketHashName);
    if (cached?.status === "done" && (Date.now() - cached.fetchedAt) < CACHE_TTL_MS) {
      continue;
    }

    activeFetches++;
    fetchAndStore(task).finally(() => {
      activeFetches--;
      scheduleDispatch(DISPATCH_DELAY_MS);
    });
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Enqueue a sold-history fetch for the given skin.
 * Safe to call on every new_item WS event — the cache prevents redundant fetches.
 *
 * @param {string} itemId          — Empire live listing ID (used as the fetch target)
 * @param {string} marketHashName  — Full item name including wear, e.g. "AK-47 | Redline (Field-Tested)"
 */
export function enqueue(itemId, marketHashName) {
  if (!itemId || !marketHashName) return;

  const cached = skinFetchCache.get(marketHashName);
  if (cached) {
    if (cached.status === "pending") return;
    if (cached.status === "done"  && (Date.now() - cached.fetchedAt) < CACHE_TTL_MS)  return;
    if (cached.status === "error" && (Date.now() - cached.fetchedAt) < ERROR_BACKOFF_MS) return;
  }

  skinFetchCache.set(marketHashName, { fetchedAt: 0, status: "pending" });
  fetchQueue.push({ itemId, marketHashName });
  scheduleDispatch();
}

/** Returns live diagnostic state for debug endpoints. */
export function getSoldHistoryFetcherState() {
  return {
    queueLength:   fetchQueue.length,
    activeFetches,
    pausedUntil:   pausedUntil || null,
    isPaused:      Date.now() < pausedUntil,
    cacheSize:     skinFetchCache.size,
  };
}

// ── Pure helpers (exported for unit tests — no network/DB involved) ─────────

/** Build the sold-history endpoint URL. Must include /sales — the plain
 * /trading/item/{id} endpoint returns similar_listings.active, never .historic. */
export function buildSalesUrl(base, itemId) {
  return `${String(base).replace(/\/$/, "")}/trading/item/${itemId}/sales`;
}

/** Empire may use market_name or market_hash_name depending on the endpoint version. */
export function nameOf(entry) {
  return entry?.item?.market_name ?? entry?.item?.market_hash_name ?? null;
}

/** The /sales endpoint returns created_at as Unix epoch **seconds**, not an
 * ISO string and not milliseconds. Returns null (not an invalid Date) on bad input. */
export function toSoldAt(createdAtSeconds) {
  const n = Number(createdAtSeconds);
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = new Date(n * 1000);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Filters raw `historic[]` entries down to ones worth persisting, matching
 * by exact market name against the requested skin.
 *
 * item.wear on this endpoint is a raw paint-wear float (e.g. 0.052), not the
 * condition string ("Factory New") the SoldHistory schema expects — the
 * condition is derived from market_name via the shared extractWearFromName()
 * helper instead of trusting entry.item.wear.
 */
export function filterValidEntries(historic, marketHashName) {
  const validEntries = [];
  const rejected = { name: 0, timestamp: 0, value: 0 };

  for (const entry of historic) {
    if (nameOf(entry) !== marketHashName) {
      rejected.name++;
      continue;
    }

    if (typeof entry.total_value !== "number" || entry.total_value <= 0) {
      rejected.value++;
      continue;
    }

    const soldAt = toSoldAt(entry.created_at);
    if (!soldAt) {
      rejected.timestamp++;
      continue;
    }

    validEntries.push({
      ...entry,
      soldAt,
      wear: extractWearFromName(nameOf(entry)) || null,
    });
  }

  return { validEntries, rejected };
}

/** Builds bulkWrite ops. upsert + $setOnInsert on the unique saleId index is
 * what makes re-running this over the same data idempotent — a duplicate
 * saleId simply hits the unique-index conflict and is skipped, never overwritten. */
export function buildUpsertOps(validEntries, marketHashName) {
  return validEntries.map((entry) => ({
    updateOne: {
      filter: { saleId: String(entry.id) },
      update: {
        $setOnInsert: {
          saleId:          String(entry.id),
          marketHashName:  nameOf(entry) ?? marketHashName,
          wear:            entry.wear,
          totalValueCoins: entry.total_value / 100,   // coin-cents → coins (confirmed)
          soldAt:          entry.soldAt,
          iconUrl:         entry.item?.icon_url ?? null,
          source:          "api:item_detail_sales",
        },
      },
      upsert: true,
    },
  }));
}

// ── Fetch + persist ───────────────────────────────────────────────────────────

async function fetchAndStore(task) {
  const { itemId, marketHashName } = task;

  const apiKey = process.env.EMPIRE_API_KEY;
  // EMPIRE_BASE_URL includes /api/v2 (matches empire.controllers.js convention)
  const base = (process.env.EMPIRE_BASE_URL || "https://csgoempire.com/api/v2").replace(/\/$/, "");
  const url  = buildSalesUrl(base, itemId);

  let res;
  try {
    res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept:        "application/json",
        "User-Agent":  "AppCSNT/1.0",
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    skinFetchCache.set(marketHashName, { fetchedAt: Date.now(), status: "error" });
    console.warn(`[SOLD_HISTORY] network error for "${marketHashName}":`, err?.message || err);
    return;
  }

  // ── 429: pause all fetching, re-enqueue for retry ────────────────────────
  if (res.status === 429) {
    pausedUntil = Date.now() + PAUSE_ON_429_MS;
    console.warn(
      `[SOLD_HISTORY] 429 rate limited — pausing all fetches for ${PAUSE_ON_429_MS / 1000}s`
    );
    // Re-enqueue at front for retry after pause
    skinFetchCache.set(marketHashName, { fetchedAt: 0, status: "pending" });
    fetchQueue.unshift(task);
    return;
  }

  if (!res.ok) {
    skinFetchCache.set(marketHashName, { fetchedAt: Date.now(), status: "error" });
    console.warn(`[SOLD_HISTORY] HTTP ${res.status} for "${marketHashName}" (itemId=${itemId})`);
    return;
  }

  let json;
  try {
    json = await res.json();
  } catch {
    skinFetchCache.set(marketHashName, { fetchedAt: Date.now(), status: "error" });
    console.warn(`[SOLD_HISTORY] invalid JSON for "${marketHashName}"`);
    return;
  }

  const historic = json?.data?.similar_listings?.historic;

  // ── Temporary diagnostics (first DIAG_LIMIT fetches) ─────────────────────
  const isDiag = diagCount < DIAG_LIMIT;
  if (isDiag) {
    diagCount++;
    const firstMhn = Array.isArray(historic) && historic.length > 0
      ? (nameOf(historic[0]) ?? "(no name field)")
      : null;
    console.log(
      `[SOLD_HISTORY][DIAG #${diagCount}/${DIAG_LIMIT}] ` +
      `itemId=${itemId} status=${res.status} ` +
      `historic=${Array.isArray(historic) ? historic.length : String(historic)} ` +
      `requested="${marketHashName}" ` +
      `firstEntryName=${firstMhn != null ? `"${firstMhn}"` : "n/a"}`
    );
  }

  // ── Guard: bad response shape ──────────────────────────────────────────────
  if (!Array.isArray(historic)) {
    skinFetchCache.set(marketHashName, { fetchedAt: Date.now(), status: "done" });
    console.warn(
      `[SOLD_HISTORY] unexpected shape for "${marketHashName}" — ` +
      `similar_listings.historic is ${typeof historic} (itemId=${itemId})`
    );
    return;
  }

  console.log(`[SOLD_HISTORY] itemId=${itemId} historicCount=${historic.length}`);

  // ── Guard: API returned no sales for this item ─────────────────────────────
  if (historic.length === 0) {
    skinFetchCache.set(marketHashName, { fetchedAt: Date.now(), status: "done" });
    // Only log during the diagnostic window — empty responses are common and
    // noisy once the fetcher has been running for a while.
    if (isDiag) {
      console.log(`[SOLD_HISTORY][DIAG] empty historic[] for "${marketHashName}" (itemId=${itemId}) — API has no sales`);
    }
    return;
  }

  // ── Filter: match by name, validate value + timestamp ────────────────────
  const { validEntries, rejected } = filterValidEntries(historic, marketHashName);

  console.log(
    `[SOLD_HISTORY] itemId=${itemId} validCount=${validEntries.length} ` +
    `rejected={name:${rejected.name}, timestamp:${rejected.timestamp}, value:${rejected.value}}`
  );

  if (validEntries.length === 0) {
    skinFetchCache.set(marketHashName, { fetchedAt: Date.now(), status: "done" });
    // Always log this case — it means the filter is rejecting all real data,
    // which indicates a name mismatch or upstream schema change worth investigating.
    console.warn(
      `[SOLD_HISTORY] 0/${historic.length} entries valid for "${marketHashName}" (itemId=${itemId}) ` +
      `rejected={name:${rejected.name}, timestamp:${rejected.timestamp}, value:${rejected.value}} · ` +
      `first entry name: "${nameOf(historic[0])}"`
    );
    return;
  }

  // ── Build upsert ops ──────────────────────────────────────────────────────
  const ops = buildUpsertOps(validEntries, marketHashName);

  if (!ops.length) {
    skinFetchCache.set(marketHashName, { fetchedAt: Date.now(), status: "done" });
    return;
  }

  try {
    const result = await SoldHistory.bulkWrite(ops, { ordered: false });
    const inserted = result.upsertedCount ?? 0;
    const alreadyExists = ops.length - inserted; // already stored (unique saleId)
    console.log(
      `[SOLD_HISTORY] "${marketHashName}" via itemId=${itemId}: ` +
      `inserted=${inserted} alreadyExists=${alreadyExists} (${ops.length} total)`
    );
  } catch (err) {
    // ordered:false — unique index violations on saleId are expected on re-fetch,
    // not a real error. Log only if it's an unexpected failure.
    const writeErrors = err?.writeErrors?.length ?? 0;
    const written = ops.length - writeErrors;
    if (written > 0 || writeErrors > 0) {
      console.log(
        `[SOLD_HISTORY] "${marketHashName}": inserted=${written} alreadyExists=${writeErrors}`
      );
    } else {
      console.warn(`[SOLD_HISTORY] bulkWrite failed for "${marketHashName}":`, err?.message);
    }
  }

  skinFetchCache.set(marketHashName, { fetchedAt: Date.now(), status: "done" });
}
