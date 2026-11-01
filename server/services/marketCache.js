// server/services/marketCache.js
import { fetchMarket } from "../controllers/empire.controllers.js";

const DEFAULT_MAX_CACHE_ITEMS = Number(process.env.MARKET_CACHE_MAX || 5000);
const ITEM_TTL_MS = 1000 * 60 * 15;

let cache = { items: [], updatedAt: 0, meta: {} };
let index = new Map();
let refreshing = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();

function cleanupOldItems() {
  const cutoff = now() - ITEM_TTL_MS;

  const before = cache.items.length;

  cache.items = cache.items.filter((it) => {
    const t = new Date(it.cachedAt || 0).getTime();
    return t && t >= cutoff;
  });

  if (cache.items.length !== before) {
    rebuildIndex();
    cache.updatedAt = now();
    patchMeta({ cleaned: true });
    console.log(`🧹 Cleaned old items: ${before} → ${cache.items.length}`);
  }
}
function safeStr(x) {
  return String(x ?? "");
}

function lc(x) {
  return safeStr(x).trim().toLowerCase();
}

function getId(it) {
  return String(it?.itemId ?? it?.item_id ?? it?.id ?? "");
}

function isKnifeLikeName(name = "") {
  const n = lc(name);

  return (
    n.includes("★") ||
    /karambit|bayonet|butterfly|daggers|shadow daggers|ursus|stiletto|talon|navaja|gut|falchion|bowie|huntsman|m9|classic knife|knife/i.test(
      name
    )
  );
}

function computeCategoryKey({ name, type, category }) {
  const t = lc(type);
  const c = lc(category);

  if (isKnifeLikeName(name) || t.includes("knife") || c.includes("knife")) {
    return "knife";
  }

  if (t.includes("sticker") || lc(name).startsWith("sticker |")) return "sticker";
  if (t.includes("smg")) return "smg";
  if (t.includes("shotgun")) return "shotgun";
  if (t.includes("rifle")) return "rifle";
  if (t.includes("pistol")) return "pistol";
  if (t.includes("sniper")) return "sniper";

  return "other";
}

function buildSteamImage(icon = "") {
  const value = String(icon || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  // 128f is sufficient for card thumbnails; saves ~8x bandwidth vs 360f
  return `https://community.cloudflare.steamstatic.com/economy/image/${value}/128fx128f`;
}

// Exported so callers that need the canonical normalized shape without going
// through the cache itself (e.g. alertEngine.js's REST-fallback escalation,
// which must match against the same normalized fields as every other item
// source) can reuse this instead of re-deriving price/discount logic.
export function normalizeItem(it = {}) {
  const itemId = it?.itemId ?? it?.item_id ?? it?.id;

  const name =
    it?.name ??
    it?.market_name ??
    it?.marketName ??
    it?.market_hash_name ??
    "";

  const rawCategory = it?.category ?? "";
  const rawType = it?.type ?? "";

  const priceCoins = Number.isFinite(Number(it?.priceCoins))
    ? Number(it.priceCoins)
    : Number.isFinite(Number(it?.priceCents))
      ? Number(it.priceCents) / 100
      : Number.isFinite(Number(it?.purchase_price))
        ? Number(it.purchase_price) / 100
        : Number.isFinite(Number(it?.market_value))
          ? Number(it.market_value) / 100
          : Number.isFinite(Number(it?.price))
            ? Number(it.price)
            : 0;

  const suggestedCoins = Number.isFinite(Number(it?.suggestedCoins))
    ? Number(it.suggestedCoins)
    : Number.isFinite(Number(it?.suggestedCents))
      ? Number(it.suggestedCents) / 100
      : Number.isFinite(Number(it?.suggested_price))
        ? Number(it.suggested_price) / 100
        : Number.isFinite(Number(it?.suggestedPrice))
          ? Number(it.suggestedPrice)
          : priceCoins;

  const priceCents = Number.isFinite(Number(it?.priceCents))
    ? Number(it.priceCents)
    : Math.round(priceCoins * 100);

  const suggestedCents = Number.isFinite(Number(it?.suggestedCents))
    ? Number(it.suggestedCents)
    : Math.round(suggestedCoins * 100);

  const discountPct = Number.isFinite(Number(it?.discountPct))
    ? Number(it.discountPct)
    : suggestedCoins > 0 && priceCoins > 0 && priceCoins <= suggestedCoins
      ? Math.round(((suggestedCoins - priceCoins) / suggestedCoins) * 10000) / 100
      : Number.isFinite(Number(it?.underPct))
        ? Number(it.underPct)
        : 0;

  const image =
    it?.image ||
    it?.image_url ||
    buildSteamImage(it?.icon_url) ||
    it?.iconUrl ||
    it?.icon ||
    it?.img ||
    "";

  const category = rawCategory || rawType || "";
  const categoryKey = computeCategoryKey({
    name,
    type: rawType,
    category: rawCategory,
  });

  return {
    ...it,
    itemId,
    name,
    marketHashName: it?.marketHashName || it?.market_hash_name || it?.market_name || name,
    category,
    type: rawType,
    image,

    priceCoins,
    priceCents,
    suggestedCoins,
    suggestedCents,
    discountPct,

    categoryKey,
    _rawCategory: rawCategory,
    _rawType: rawType,
    cachedAt: new Date(),
  };
}

function rebuildIndex() {
  index = new Map();

  for (let i = 0; i < cache.items.length; i++) {
    const id = getId(cache.items[i]);
    if (id) index.set(id, i);
  }
}

function enforceCap(maxItems = DEFAULT_MAX_CACHE_ITEMS) {
  const cap = Math.max(100, Number(maxItems) || DEFAULT_MAX_CACHE_ITEMS);

  if (cache.items.length <= cap) return;

  cache.items = cache.items.slice(0, cap);
  rebuildIndex();
}

function patchMeta(extra = {}) {
  cache.meta = {
    ...(cache.meta || {}),
    ...extra,
    cached: cache.items.length,
    rawCount: cache.items.length,
    updatedAt: cache.updatedAt,
  };
}

function toArrayItems(resp) {
  return Array.isArray(resp?.items) ? resp.items : [];
}

/* =========================
   PUBLIC CACHE API
========================= */

export function getMarketCache() {
  return cache;
}

export function getAllFromCache() {
  return cache.items;
}

export function getCacheSize() {
  return cache.items.length;
}

// Returns ms since the last item was upserted into the cache.
// Used by the fallback engine to detect Empire WS silence.
export function getCacheAgeMs() {
  return cache.updatedAt ? Date.now() - cache.updatedAt : Infinity;
}

export function resetMarketCache() {
  cache = { items: [], updatedAt: 0, meta: {} };
  index = new Map();
  refreshing = null;
}

export function upsertIntoCache(rawItem, { maxItems = DEFAULT_MAX_CACHE_ITEMS } = {}) {
  const item = normalizeItem(rawItem);
  const id = getId(item);
  if (!id) return null;

  const hit = index.get(id);
  if (hit === undefined) {
    cache.items.unshift(item);
    for (const [k, v] of index.entries()) index.set(k, v + 1);
    index.set(id, 0);
  } else {
    cache.items[hit] = { ...cache.items[hit], ...item, cachedAt: new Date() };
  }

  cache.updatedAt = now();
  enforceCap(maxItems);
  cleanupOldItems();
  patchMeta({ updatedAt: cache.updatedAt });
  return item;
}

/**
 * Insert many items at once — O(n) instead of O(n²).
 * Rebuilds the index only once after all inserts.
 */
export function batchUpsertIntoCache(rawItems, { maxItems = DEFAULT_MAX_CACHE_ITEMS } = {}) {
  if (!Array.isArray(rawItems) || !rawItems.length) return 0;

  let inserted = 0;
  for (const raw of rawItems) {
    const item = normalizeItem(raw);
    const id = getId(item);
    if (!id) continue;

    const hit = index.get(id);
    if (hit === undefined) {
      cache.items.push(item);
      inserted++;
    } else {
      cache.items[hit] = { ...cache.items[hit], ...item, cachedAt: new Date() };
    }
  }

  if (inserted > 0) rebuildIndex();

  cache.updatedAt = now();
  enforceCap(maxItems);
  cleanupOldItems();
  patchMeta({ updatedAt: cache.updatedAt });
  return inserted;
}

export function removeFromCache(itemId) {
  const id = String(itemId || "");
  if (!id) return;

  const hit = index.get(id);
  if (hit === undefined) return;

  cache.items.splice(hit, 1);
  rebuildIndex();

  cache.updatedAt = now();
  patchMeta({ updatedAt: cache.updatedAt });
}

/* =========================
   REFRESH CACHE
========================= */

export async function refreshMarketCache({ appId = 730, perPage = 100 } = {}) {
  if (refreshing) return refreshing;

  refreshing = (async () => {
    const safePerPage = Math.min(Math.max(Number(perPage) || 100, 1), 100);

    const normalResp = await fetchMarket({
      appId,
      page: 1,
      perPage: safePerPage,
      auction: "no",
      sort: "desc",
      order: "market_value",
      debug: false,
    });

    const stickersResp = await fetchMarket({
      appId,
      page: 1,
      perPage: safePerPage,
      auction: "no",
      sort: "desc",
      order: "market_value",
      hasStickers: true,
      debug: false,
    });

    const list = [
      ...toArrayItems(normalResp),
      ...toArrayItems(stickersResp),
    ];

    console.log("TOTAL FROM BOTH:", list.length);
    batchUpsertIntoCache(list);

    const prev = cache.meta || {};

    cache.meta = {
      ...(normalResp?.meta || {}),
      ...prev,
      pagesLoaded: Math.max(Number(prev.pagesLoaded || 1), 1),
      perPage: safePerPage,
      deep: Boolean(prev.deep),
      warning: null,
      receivedType: Array.isArray(normalResp?.items)
        ? "array"
        : typeof normalResp?.items,
      cached: cache.items.length,
      rawCount: list.length,
      normalCount: toArrayItems(normalResp).length,
      stickersCount: toArrayItems(stickersResp).length,
      updatedAt: cache.updatedAt,
    };

    return cache;
  })().finally(() => {
    refreshing = null;
  });

  return refreshing;
}



export async function ensureMarketCache({
  appId = 730,
  ttlMs = 60_000,
  perPage = 100,
} = {}) {
  const fresh = cache.updatedAt && now() - cache.updatedAt < ttlMs;

  if (fresh) return cache;

  return refreshMarketCache({
    appId,
    perPage,
  });
}

/* =========================
   SEARCH / QUERY
========================= */

export function searchInCache(q = "") {
  const s = lc(q);
  if (!s) return cache.items;

  const aliases = {
    m9: "m9",
    ak: "ak-47",
    awp: "awp",
    web: "web",
    we: "web",
    red: "redline",
    bfk: "butterfly",
    butterfly: "butterfly",
    kara: "karambit",
  };

  const words = s
    .split(/\s+/)
    .map((w) => aliases[w] || w)
    .filter(Boolean);

  return cache.items.filter((it) => {
    const haystack = [
      it.name,
      it.marketHashName,
      it.market_hash_name,
      it.market_name,
      it.type,
      it.category,
      it.categoryKey,
    ]
      .map(lc)
      .join(" ");

    return words.every((word) => haystack.includes(word));
  });
}

export function queryCache({
  q = "",
  category = "",
  minPrice = "",
  maxPrice = "",
  minDiscountPct = "",
  sort = "-discountPct",
  limit = 60,
  skip = 0,
} = {}) {
  let arr = cache.items;

  const s = lc(q);
  if (s) arr = searchInCache(s);

  if (category) {
    const c = lc(category);

    if (c === "knife") {
      arr = arr.filter(
        (it) => it.categoryKey === "knife" || isKnifeLikeName(it.name)
      );
    } else {
      arr = arr.filter((it) => {
        const ck = lc(it.categoryKey);

        if (ck === c) return true;

        const legacy = lc(it.category || it.type || "");
        return legacy.includes(c);
      });
    }
  }

  const minP = minPrice === "" ? null : Number(minPrice);
  const maxP = maxPrice === "" ? null : Number(maxPrice);
  const minD = minDiscountPct === "" ? null : Number(minDiscountPct);

  if (minP !== null && !Number.isNaN(minP)) {
    arr = arr.filter((it) => Number(it.priceCoins || 0) >= minP);
  }

  if (maxP !== null && !Number.isNaN(maxP)) {
    arr = arr.filter((it) => Number(it.priceCoins || 0) <= maxP);
  }

  if (minD !== null && !Number.isNaN(minD)) {
    arr = arr.filter((it) => Number(it.discountPct || 0) >= minD);
  }

  const dir = String(sort).startsWith("-") ? -1 : 1;
  const key = String(sort).replace("-", "");

  arr = [...arr].sort((a, b) => {
    const av = Number(a?.[key] ?? 0);
    const bv = Number(b?.[key] ?? 0);

    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;

    return 0;
  });

  const total = arr.length;
  const sSkip = Number(skip) || 0;
  const sLimit = Math.min(Number(limit) || 60, 500);

  return {
    items: arr.slice(sSkip, sSkip + sLimit),
    total,
    updatedAt: cache.updatedAt,
    meta: cache.meta,
  };
}

// Periodic cleanup — runs independently of upserts so old items are evicted
// even during quiet periods when new items stop arriving.
setInterval(cleanupOldItems, 60_000).unref();

export async function warmHomePremiumCache() {
  if (cache.items.length >= 100) return;
  console.log("[home-premium] startup warm cache begin");
  try {
    const [broadLive, cheapLive] = await Promise.allSettled([
      fetchMarket({ appId: 730, page: 1, perPage: 2500, auction: "no", sort: "desc", order: "market_value", debug: false }),
      fetchMarket({ appId: 730, page: 1, perPage: 500, maxPrice: 200, auction: "no", sort: "desc", order: "market_value", debug: false }),
    ]);
    const broadItems = broadLive.status === "fulfilled" ? (Array.isArray(broadLive.value?.items) ? broadLive.value.items : []) : [];
    const cheapItems = cheapLive.status === "fulfilled" ? (Array.isArray(cheapLive.value?.items) ? cheapLive.value.items : []) : [];
    const total = broadItems.length + cheapItems.length;
    if (total > 0) {
      if (broadItems.length) batchUpsertIntoCache(broadItems);
      if (cheapItems.length) batchUpsertIntoCache(cheapItems);
      console.log(`[home-premium] startup warm done: ${broadItems.length} broad + ${cheapItems.length} cheap`);
    } else {
      console.warn("[home-premium] startup warm: 0 items returned");
    }
    if (cheapLive.status === "rejected") console.warn("[home-premium] startup warm cheap error:", cheapLive.reason?.message);
  } catch (err) {
    console.warn("[home-premium] startup warm error:", err?.message);
  }
}

export function getPremiumDealsFromCache({
  minPrice = 50,
  maxPrice = Infinity,
  minDiscountPct = 2,
  limit = 60,
} = {}) {
  const result = cache.items
    .filter((it) => {
      const price = Number(it.priceCoins || 0);
      const suggested = Number(it.suggestedCoins || 0);
      const discount = Number(it.discountPct || 0);

      if (!price || price <= 0) return false;
      if (suggested > 0 && price > suggested) return false;

      return (
        price >= Number(minPrice) &&
        price <= Number(maxPrice) &&
        discount >= Number(minDiscountPct)
      );
    })
    .sort((a, b) => {
      const dA = Number(a.discountPct || 0);
      const dB = Number(b.discountPct || 0);

      const pA = Number(a.priceCoins || 0);
      const pB = Number(b.priceCoins || 0);

      const sA = Number(a.suggestedCoins || 0);
      const sB = Number(b.suggestedCoins || 0);

      const scoreA =
        dA * 100 + Math.min(pA / 100, 100) + Math.min(sA / 100, 100);

      const scoreB =
        dB * 100 + Math.min(pB / 100, 100) + Math.min(sB / 100, 100);

      return scoreB - scoreA;
    });

  return {
    items: result.slice(0, Number(limit) || 60),
    total: result.length,
    updatedAt: cache.updatedAt,
    meta: {
      ...(cache.meta || {}),
      premiumMinPrice: minPrice,
      premiumMaxPrice: maxPrice,
      premiumMinDiscountPct: minDiscountPct,
      premiumTotal: result.length,
    },
  };
}

