const state = {
  lastRequestAt: 0,
  blockedUntil: 0,
  consecutive429: 0,

  minDelayMs: 3500,
  baseCooldownAfter429Ms: 60_000,
  maxExtraPenaltyMs: 120_000,

  cacheTtlMs: 45_000,
  cache: new Map(),
};

function now() {
  return Date.now();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeSearch(value = "") {
  return String(value || "").trim().toLowerCase();
}

function toNumberOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function buildCacheKey(params = {}) {
  return JSON.stringify({
    appId: Number(params.appId || params.app_id || 730),
    page: Number(params.page || 1),
    perPage: Number(params.perPage || params.per_page || 100),
    minPrice: toNumberOrNull(params.minPrice ?? params.price_min),
    maxPrice: toNumberOrNull(params.maxPrice ?? params.price_max),
    search: normalizeSearch(params.search || ""),
    auction: params.auction ?? null,
    buyNowOnly: params.buyNowOnly ?? params.buy_now_only ?? null,
    minDiscountPct: toNumberOrNull(
      params.minDiscountPct ?? params.min_discount_pct
    ),
  });
}

function cleanupCache() {
  const current = now();

  for (const [key, entry] of state.cache.entries()) {
    if (!entry || current - entry.createdAt > state.cacheTtlMs) {
      state.cache.delete(key);
    }
  }
}

export function getEmpireRateGuardState() {
  cleanupCache();

  const current = now();

  return {
    lastRequestAt: state.lastRequestAt,
    blockedUntil: state.blockedUntil,
    consecutive429: state.consecutive429,
    isBlocked: current < state.blockedUntil,
    retryAfterMs: current < state.blockedUntil ? state.blockedUntil - current : 0,
    minDelayMs: state.minDelayMs,
    baseCooldownAfter429Ms: state.baseCooldownAfter429Ms,
    cacheTtlMs: state.cacheTtlMs,
    cacheSize: state.cache.size,
  };
}

export function configureEmpireRateGuard(config = {}) {
  if (config.minDelayMs !== undefined) {
    state.minDelayMs = Math.max(0, Number(config.minDelayMs) || 0);
  }

  if (config.baseCooldownAfter429Ms !== undefined) {
    state.baseCooldownAfter429Ms = Math.max(
      0,
      Number(config.baseCooldownAfter429Ms) || 0
    );
  }

  if (config.maxExtraPenaltyMs !== undefined) {
    state.maxExtraPenaltyMs = Math.max(
      0,
      Number(config.maxExtraPenaltyMs) || 0
    );
  }

  if (config.cacheTtlMs !== undefined) {
    state.cacheTtlMs = Math.max(0, Number(config.cacheTtlMs) || 0);
  }

  cleanupCache();

  return getEmpireRateGuardState();
}

export function resetEmpireRateGuard() {
  state.lastRequestAt = 0;
  state.blockedUntil = 0;
  state.consecutive429 = 0;
  state.cache.clear();

  return getEmpireRateGuardState();
}

export async function beforeEmpireRequest(params = {}) {
  cleanupCache();

  const current = now();

  if (current < state.blockedUntil) {
    return {
      allowed: false,
      reason: "blocked",
      retryAfterMs: state.blockedUntil - current,
      state: getEmpireRateGuardState(),
    };
  }

  const elapsed = current - state.lastRequestAt;
  const waitMs = Math.max(0, state.minDelayMs - elapsed);

  if (waitMs > 0) {
    await sleep(waitMs);
  }

  const key = buildCacheKey(params);
  const cached = state.cache.get(key);

  if (cached && now() - cached.createdAt < state.cacheTtlMs) {
    return {
      allowed: false,
      reason: "cache",
      key,
      data: cached.data,
      state: getEmpireRateGuardState(),
    };
  }

  return {
    allowed: true,
    key,
    state: getEmpireRateGuardState(),
  };
}

export function onEmpireSuccess(key, data) {
  state.lastRequestAt = now();
  state.consecutive429 = 0;
  state.blockedUntil = 0;

  if (key) {
    state.cache.set(key, {
      createdAt: now(),
      data,
    });
  }

  cleanupCache();

  return getEmpireRateGuardState();
}

export function onEmpire429() {
  state.lastRequestAt = now();
  state.consecutive429 += 1;

  const extraPenalty = Math.min(
    state.consecutive429 * 15_000,
    state.maxExtraPenaltyMs
  );

  state.blockedUntil = now() + state.baseCooldownAfter429Ms + extraPenalty;

  return getEmpireRateGuardState();
}

export function onEmpireError() {
  state.lastRequestAt = now();
  cleanupCache();
  return getEmpireRateGuardState();
}

export function getEmpireCachedResponse(params = {}) {
  cleanupCache();

  const key = buildCacheKey(params);
  const cached = state.cache.get(key);

  if (!cached) return null;
  if (now() - cached.createdAt > state.cacheTtlMs) {
    state.cache.delete(key);
    return null;
  }

  return cached.data;
}

export function setEmpireCachedResponse(params = {}, data) {
  const key = buildCacheKey(params);

  state.cache.set(key, {
    createdAt: now(),
    data,
  });

  cleanupCache();

  return data;
}