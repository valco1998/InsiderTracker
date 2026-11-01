// server/controllers/empire.controllers.js
import axios from "axios";
import SystemSettings from "../models/systemSettingsmodels.js";
import withRetry from "../utils/withRetry.js";

/* =========================
   Axios Client (Upstream)
========================= */
export function getClient() {
  const BASE = process.env.EMPIRE_BASE_URL || process.env.EMPIRE_API_BASE;
  const KEY = process.env.EMPIRE_API_KEY;
  const TIMEOUT = Number(process.env.EMPIRE_TIMEOUT_MS || 8000);

  if (!BASE) throw new Error("EMPIRE_BASE_URL is missing");
  if (!KEY) throw new Error("EMPIRE_API_KEY is missing");

  return axios.create({
    baseURL: BASE,
    timeout: TIMEOUT,
    headers: {
      Authorization: `Bearer ${KEY}`,
      Accept: "application/json",
      "User-Agent": "AppCSNT/1.0",
    },
  });
}

/* =========================
   Helpers
========================= */
function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toFinite(v) {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * ✅ Empire returns prices in CENTS (integers), e.g. 28 => 0.28 coins
 * We keep cents as integer in DB/cache to avoid float issues.
 */
function toCoinCents(v) {
  if (v == null) return 0;

  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return 0;

    // decimals => coins, convert to cents
    if (s.includes(".")) return Math.round(toNumber(s) * 100);

    // integer string => cents
    return Math.round(toNumber(s));
  }

  const n = toNumber(v);

  // integer => cents
  if (Number.isInteger(n)) return n;

  // decimal => coins
  return Math.round(n * 100);
}

function centsToCoins(cents) {
  return toNumber(cents) / 100;
}

/* =========================
   Image helpers
========================= */
function pickIcon(raw) {
  return (
    raw?.image ??
    raw?.image_url ??
    raw?.icon_url ??
    raw?.iconUrl ??
    raw?.icon ??
    raw?.icon_url_large ??
    raw?.icon_large ??
    raw?.iconLarge ??
    null
  );
}

function buildSteamImage(icon) {
  if (!icon) return "";
  const s = String(icon);
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  return `https://community.cloudflare.steamstatic.com/economy/image/${s}/360fx360f`;
}

/* =========================
   Normalization
========================= */
export function normalizeItem(raw) {
  // purchase_price first — the same field the WS normalizer
  // (services/marketCache.js normalizeItem) and PriceSnapshot use, so a REST
  // refresh and a WS event yield the same priceCoins for the same listing.
  // For auctions with bids Empire's market_value tracks the highest bid and
  // differs from purchase_price. Without purchase_price the previous order
  // (price → market_value → suggested_price) is unchanged.
  const rawPrice =
    raw?.purchase_price ??
    raw?.price ??
    raw?.market_value ??
    raw?.suggested_price ??
    0;

  const rawSuggested =
    raw?.suggested_price ??
    raw?.market_value ??
    rawPrice;

  const priceCents = toCoinCents(rawPrice);
  const suggestedCents = toCoinCents(rawSuggested);

  const priceCoins = centsToCoins(priceCents);
  const suggestedCoins = centsToCoins(suggestedCents);

  // market_value kept separately (display/diagnostics only — not used for
  // matching, targets or discounts). null when Empire didn't send it.
  const marketValueCoins =
    raw?.market_value != null ? centsToCoins(toCoinCents(raw.market_value)) : null;

  const underPct =
    suggestedCoins > 0
      ? ((suggestedCoins - priceCoins) / suggestedCoins) * 100
      : 0;

  // 2-decimal precision to match services/marketCache.js's WS-side normalizer
  // exactly (Phase 3C) — whole-number rounding here previously let a rule
  // like minDiscountPct=6 match a real ~5.66% discount via REST/fallback
  // while correctly rejecting it via live WS, for the identical item.
  const discountPct =
    suggestedCoins > 0 && priceCoins <= suggestedCoins
      ? Math.round(((suggestedCoins - priceCoins) / suggestedCoins) * 10000) / 100
      : 0;

  const isDiscount = discountPct > 0;

  const icon = pickIcon(raw);
  const image = buildSteamImage(icon);

  const id = raw?.id ?? raw?.item_id ?? raw?.itemId ?? null;
  const itemId = id;

  const name =
    raw?.market_name ??
    raw?.name ??
    raw?.marketName ??
    raw?.display_name ??
    null;

  const market_hash_name =
    raw?.market_hash_name ??
    raw?.market_hash ??
    raw?.marketName ??
    null;

  // aliases
  const price = priceCoins;
  const suggestedPrice = suggestedCoins;

  return {
    id,
    itemId,

    name,
    market_hash_name,

    wear: raw?.wear ?? null,
    wear_name: raw?.wear_name ?? raw?.wearName ?? null,

    // STORE (ints)
    priceCents,
    suggestedCents,

    // DISPLAY (decimals)
    priceCoins,
    suggestedCoins,
    marketValueCoins,

    // aliases for app
    price,
    suggestedPrice,

    discountPct,
    underPct,
    isDiscount,

    image,
    icon,

    published_at: raw?.published_at ?? raw?.publishedAt ?? null,
    type: raw?.type ?? raw?.item_type ?? "",
    category: raw?.category ?? raw?.kind ?? raw?.item_type ?? "",

    // Pass stickers through as-is if the API includes them (listing endpoint
    // usually doesn't, but WS new_item events sometimes do).
    stickers: Array.isArray(raw?.stickers) ? raw.stickers : [],

    paint_wear: raw?.paint_wear ?? raw?.paintWear ?? null,
    paint_index: raw?.paint_index ?? raw?.paintIndex ?? null,
    paint_seed: raw?.paint_seed ?? raw?.paintSeed ?? null,

    auction: {
      enabled: raw?.auction_ends_at != null,
      highest_bid: raw?.auction_highest_bid ?? null,
      bids: raw?.auction_number_of_bids ?? 0,
      ends_at: raw?.auction_ends_at ?? null,
    },
  };
}

/* =========================
   Knife Detection Helpers
========================= */
const STAR_RE = /\u2605/;
const KNIFE_NAME_RE =
  /\b(knife|karambit|m9\s*bayonet|bayonet|butterfly|stiletto|flip|shadow\s*daggers?|daggers?|classic|nomad|talon|ursus|bowie|huntsman|falchion|gut|navaja|paracord|survival|skeleton|kukri|tactical|tanto)\b/i;

function isKnifeByNameOrType(it) {
  const t = String(it?.type || "").toLowerCase();
  const c = String(it?.category || "").toLowerCase();
  const n = String(it?.name || "");
  const mh = String(it?.market_hash_name || "");
  if (t.includes("knife")) return true;
  if (c.includes("knife")) return true;
  if (STAR_RE.test(n)) return true;
  if (KNIFE_NAME_RE.test(n)) return true;
  if (KNIFE_NAME_RE.test(mh)) return true;
  return false;
}

/* =========================
   Quick Auth Test
========================= */
export async function testAuth() {
  const client = getClient();
  const res = await withRetry(() =>
    client.get("/trading/items", { params: { page: 1, per_page: 1, app_id: 730 } })
  );
  return {
    path: "/trading/items?page=1&per_page=1&app_id=730",
    status: res.status,
    data: res.data,
  };
}

/* =========================
   Low-level fetch (single page)
========================= */
export async function fetchMarket({
  appId = 730,
  page = 1,
  perPage = 2500,
  minPrice,
  maxPrice,
  minDiscountPct,
  search,
  auction = "no",
  sort = "desc",
  order = "market_value",
  hasStickers,
  wearMin,
  wearMax,
  debug = false,
} = {}) {
  const client = getClient();

  const safePerPage = Math.min(2500, Math.max(1, Number(perPage) || 2500));

  const minCoins = toFinite(minPrice);
  const maxCoins = toFinite(maxPrice);

  const minUp = Number.isFinite(minCoins) ? Math.round(minCoins * 100) : undefined;
  const maxUp = Number.isFinite(maxCoins) ? Math.round(maxCoins * 100) : undefined;

  const params = {
    page: Math.max(1, Number(page) || 1),
    per_page: safePerPage,

    // Empire docs
    auction: auction === "yes" || auction === true ? "yes" : "no",
    sort: sort === "asc" ? "asc" : "desc",
    order: order || "market_value",

    search: search ? String(search).trim() : undefined,
    price_min: minUp,
    price_max: maxUp,

    has_stickers:
      hasStickers === true ? "yes" :
        hasStickers === false ? "no" :
          hasStickers,

    wear_min: wearMin !== undefined ? String(wearMin) : undefined,
    wear_max: wearMax !== undefined ? String(wearMax) : undefined,
  };

  Object.keys(params).forEach((k) => {
    if (params[k] === undefined || params[k] === null || params[k] === "") {
      delete params[k];
    }
  });

  try {
    const res = await withRetry(() => client.get("/trading/items", { params }));
    const body = res?.data || {};

    const rawList = Array.isArray(body?.data)
      ? body.data
      : Array.isArray(body?.items)
        ? body.items
        : [];

    let items = rawList.map(normalizeItem);

    if (Number.isFinite(Number(minDiscountPct)) && Number(minDiscountPct) > 0) {
      const minD = Number(minDiscountPct);

      items = items.filter((item) => {
        const discount = Math.max(
          Number(item?.discountPct || 0),
          Number(item?.underPct || 0),
          0
        );

        return discount >= minD;
      });
    }

    if (debug) {
      console.log("UPSTREAM URL:", client.defaults.baseURL, "/trading/items", params);
      console.log("UPSTREAM RAW COUNT:", rawList.length);
      console.log("UPSTREAM BODY:", body);
    }

    return {
      total: Number(body?.total ?? body?.last_page ?? items.length),
      page: Number(body?.current_page ?? params.page),
      items,
      meta: {
        apiShape: Array.isArray(body?.data)
          ? "data"
          : Array.isArray(body?.items)
            ? "items"
            : "unknown",
        rawCount: rawList.length,
        filteredCount: items.length,
        paramsSent: debug ? params : undefined,
      },
    };
  } catch (e) {
    console.log("fetchMarket status:", e?.response?.status);
    console.log("fetchMarket data:", e?.response?.data);

    return {
      items: [],
      page: Number(params.page),
      total: 0,
      meta: {
        error: true,
        status: e?.response?.status,
        details: e?.response?.data,
        paramsSent: debug ? params : undefined,
      },
    };
  }
}

/* ====================================================
   High-level: Rotating scans
==================================================== */
export async function fetchAndFilterByRules({
  appId,
  page = 1,
  perPage = 50,
  category,
  type,
  onlyKnives,
  includeAuctions = true,
  buyNowOnly = false,
  minPrice,
  maxPrice,
  minDiscountPct,
  nameIncludes,
} = {}) {
  let settings = await SystemSettings.findOne();
  if (!settings) settings = await SystemSettings.create({});
  const rules = settings?.auto?.rules || {};

  const _appId = Number(appId ?? rules.appId ?? 730);
  const _perPage = Math.min(Number(perPage) || 50, 100);

  const _maxPrice = Number.isFinite(Number(maxPrice)) ? Number(maxPrice) : undefined;
  const _minDisc = Number.isFinite(Number(minDiscountPct)) ? Number(minDiscountPct) : undefined;

  const wantKnives =
    Boolean(onlyKnives) ||
    (category && String(category).toLowerCase() === "knife") ||
    (type && String(type).toLowerCase() === "knife");

  let needles = [];
  if (nameIncludes) {
    needles = Array.isArray(nameIncludes)
      ? nameIncludes
      : String(nameIncludes).split(",").map((s) => s.trim()).filter(Boolean);
  }
  const lowers = needles.map((x) => String(x).toLowerCase());
  const hasNeedles = lowers.length > 0;

  const qStr = String(nameIncludes || "").toLowerCase();
  const knifeIntent = wantKnives || qStr.includes("karambit") || qStr.includes("knife");

  const scans = [];
  scans.push({ includeAuctions, buyNowOnly, minPrice, maxPrice: _maxPrice, minDiscountPct: _minDisc });
  scans.push({ includeAuctions: true, buyNowOnly: true, minPrice, maxPrice: _maxPrice, minDiscountPct: _minDisc });
  scans.push({ includeAuctions: false, buyNowOnly: false, minPrice, maxPrice: _maxPrice, minDiscountPct: _minDisc });

  const userMin = minPrice === "" || minPrice == null ? null : Number(minPrice);
  const userMax = _maxPrice == null ? null : Number(_maxPrice);

  const buckets = knifeIntent
    ? [[0, 2], [2, 10], [10, 50], [50, 200], [200, userMax ?? 20000]]
    : [[0, 5], [5, 20], [20, userMax ?? 200]];

  if (userMin == null && userMax == null) {
    for (const [bMin, bMax] of buckets) {
      scans.push({ includeAuctions: true, buyNowOnly: false, minPrice: bMin, maxPrice: bMax, minDiscountPct: _minDisc });
    }
  }

  if (knifeIntent && Number.isFinite(Number(_minDisc))) {
    scans.push({ includeAuctions: true, buyNowOnly: false, minPrice, maxPrice: _maxPrice, minDiscountPct: undefined });
  }

  const scanKey = (s) =>
    [s.includeAuctions ? 1 : 0, s.buyNowOnly ? 1 : 0, s.minPrice ?? "", s.maxPrice ?? "", s.minDiscountPct ?? ""].join("|");

  const uniq = new Map();
  for (const s of scans) uniq.set(scanKey(s), s);
  const uniqScans = Array.from(uniq.values()).slice(0, knifeIntent ? 10 : 6);

  const MAX_CONCURRENCY = 2;

  async function runWithPool(tasks, limit) {
    const results = [];
    let idx = 0;
    async function worker() {
      while (idx < tasks.length) {
        const i = idx++;
        results[i] = await tasks[i]();
      }
    }
    const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker());
    await Promise.all(workers);
    return results;
  }

  const tasks = uniqScans.map((s) => async () => {
    try {
      return await fetchMarket({
        appId: _appId,
        page: 1,
        perPage: _perPage,
        includeAuctions: s.includeAuctions,
        buyNowOnly: s.buyNowOnly,
        minPrice: s.minPrice,
        maxPrice: s.maxPrice,
        minDiscountPct: s.minDiscountPct,
      });
    } catch (e) {
      return { items: [], page: 1, total: 0, meta: { error: true, status: e?.response?.status } };
    }
  });

  const responses = await runWithPool(tasks, MAX_CONCURRENCY);

  const allRaw = responses.flatMap((r) => r?.items || []);
  const seen = new Set();
  let out = [];

  for (const it of allRaw) {
    const id = String(it?.itemId ?? it?.item_id ?? it?.id ?? "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(it);
  }

  if (wantKnives) out = out.filter(isKnifeByNameOrType);
  if (Number.isFinite(Number(_minDisc))) out = out.filter((it) => Number(it.discountPct) >= Number(_minDisc));

  if (hasNeedles) {
    out = out.filter((it) => {
      const nm = String(it.name || "").toLowerCase();
      const mh = String(it.market_hash_name || "").toLowerCase();
      return lowers.some((x) => nm.includes(x) || mh.includes(x));
    });
  }

  return {
    items: out,
    page: 1,
    total: out.length,
    meta: {
      filteredTo: out.length,
      fetchedUnique: out.length,
      scans: uniqScans.length,
      perPage: _perPage,
      includeAuctions,
      buyNowOnly,
      note: "Upstream pagination not available; using rotating scans.",
    },
  };
}

/* ====================================================
   REQUIRED EXPORTS for empireRoutes.js
==================================================== */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fetchRawUpstream({
  appId = 730,
  page = 1,
  perPage = 50,
  includeAuctions = true,
  buyNowOnly = false,
  minPrice,
  maxPrice,
  minDiscountPct,
  sort,
  order,
  auction,
  search,
} = {}) {
  const client = getClient();

  const minCoins = toFinite(minPrice);
  const maxCoins = toFinite(maxPrice);

  const minUp = Number.isFinite(minCoins) ? Math.round(minCoins * 100) : undefined;
  const maxUp = Number.isFinite(maxCoins) ? Math.round(maxCoins * 100) : undefined;

  const auctionNorm = (() => {
    const s = String(auction ?? "").trim().toLowerCase();
    return s === "yes" || s === "no" ? s : undefined;
  })();

  const params = {
    page: Math.max(1, Number(page) || 1),
    per_page: Math.min(100, Math.max(1, Number(perPage) || 50)),
    app_id: Number(appId) || 730,
    include_auctions: includeAuctions ? 1 : undefined,
    buy_now_only: buyNowOnly ? 1 : undefined,
    price_min: minUp,
    price_max: maxUp,
    min_discount_pct: Number.isFinite(Number(minDiscountPct)) ? Number(minDiscountPct) : undefined,
    sort: sort ? String(sort) : undefined,
    order: order ? String(order) : undefined,
    auction: auctionNorm,
    search: search ? String(search) : undefined,
  };
  Object.keys(params).forEach((k) => params[k] === undefined && delete params[k]);

  const res = await withRetry(() => client.get("/trading/items", { params }), {
    retries: 6,
    onRetry: ({ attempt, status, delayMs }) => {
      console.log(`[fetchRawUpstream] retry #${attempt + 1} status=${status} wait=${delayMs}ms`);
    },
  });

  return { ok: true, paramsSent: params, status: res.status, data: res.data };
}

export async function fetchAllAndFilterByRules({
  appId = 730,
  includeAuctions = true,
  buyNowOnly = false,
  minPrice,
  maxPrice,
  onlyKnives = false,
  nameIncludes,
  minUnderPct = -9999,
  maxUnderPct = 9999,
  startPage = 1,
  maxPages = 200,
  delayMs = 1000,
  perPage = 50,
} = {}) {
  const out = [];
  const seen = new Set();

  const needles = nameIncludes
    ? (Array.isArray(nameIncludes) ? nameIncludes : String(nameIncludes).split(","))
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.toLowerCase())
    : [];

  for (let page = Math.max(1, Number(startPage) || 1); page < startPage + maxPages; page++) {
    const r = await fetchMarket({ appId, page, perPage, includeAuctions, buyNowOnly, minPrice, maxPrice });
    const items = Array.isArray(r?.items) ? r.items : [];
    if (items.length === 0) break;

    for (const it of items) {
      const id = String(it?.itemId ?? it?.id ?? "");
      if (!id || seen.has(id)) continue;

      if (onlyKnives && !isKnifeByNameOrType(it)) continue;

      if (needles.length) {
        const nm = String(it?.name || "").toLowerCase();
        const mh = String(it?.market_hash_name || "").toLowerCase();
        if (!needles.some((x) => nm.includes(x) || mh.includes(x))) continue;
      }

      const under = Number(it?.underPct);
      if (!Number.isFinite(under)) continue;
      if (under < Number(minUnderPct) || under > Number(maxUnderPct)) continue;

      seen.add(id);
      out.push(it);
    }

    if (delayMs > 0) await sleep(Number(delayMs) || 0);
  }

  return {
    items: out,
    total: out.length,
    meta: {
      scanned: { startPage, maxPages, perPage, delayMs },
      filters: { includeAuctions, buyNowOnly, minPrice, maxPrice, onlyKnives, nameIncludes, minUnderPct, maxUnderPct },
    },
  };
}

export async function scanKnivesByPriceBuckets({
  appId = 730,
  nameIncludes,
  onlyKnives = true,
  perPage = 50,
  delayMs = 1000,
  buckets,
} = {}) {
  const b =
    Array.isArray(buckets) && buckets.length
      ? buckets
      : [[0, 2], [2, 10], [10, 50], [50, 200], [200, 20000]];

  const all = [];
  const seen = new Set();

  for (const [minP, maxP] of b) {
    const r = await fetchAndFilterByRules({
      appId,
      perPage,
      includeAuctions: true,
      buyNowOnly: false,
      minPrice: minP,
      maxPrice: maxP,
      onlyKnives,
      nameIncludes,
    });

    const items = Array.isArray(r?.items) ? r.items : [];
    for (const it of items) {
      const id = String(it?.itemId ?? it?.id ?? "");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      all.push(it);
    }

    if (delayMs > 0) await sleep(Number(delayMs) || 0);
  }

  return { ok: true, items: all, total: all.length, meta: { buckets: b, perPage, delayMs, onlyKnives, nameIncludes } };
}

export async function findFirstKnifePage({
  appId = 730,
  nameIncludes,
  onlyKnives = true,
  perPage = 50,
  startPage = 1,
  maxProbes = 40,
  step = 20,
  delayMs = 1000,
} = {}) {
  const needles = nameIncludes
    ? String(nameIncludes).split(",").map((s) => s.trim()).filter(Boolean).map((s) => s.toLowerCase())
    : [];

  const matchesAny = (it) => {
    if (onlyKnives && !isKnifeByNameOrType(it)) return false;
    if (!needles.length) return true;
    const nm = String(it?.name || "").toLowerCase();
    const mh = String(it?.market_hash_name || "").toLowerCase();
    return needles.some((x) => nm.includes(x) || mh.includes(x));
  };

  let page = Math.max(1, Number(startPage) || 1);

  for (let i = 0; i < maxProbes; i++) {
    const r = await fetchMarket({ appId, page, perPage, includeAuctions: true });
    const items = Array.isArray(r?.items) ? r.items : [];
    if (items.some(matchesAny)) {
      let p = Math.max(1, page - step);
      for (; p <= page; p++) {
        const rr = await fetchMarket({ appId, page: p, perPage, includeAuctions: true });
        const its = Array.isArray(rr?.items) ? rr.items : [];
        if (its.some(matchesAny)) return { ok: true, found: true, page: p, sampleCount: its.length };
        if (delayMs > 0) await sleep(Number(delayMs) || 0);
      }
      return { ok: true, found: true, page, sampleCount: items.length };
    }

    page += step;
    if (delayMs > 0) await sleep(Number(delayMs) || 0);
  }

  return { ok: true, found: false, pageTried: page };
}

export async function findFirstMatchAcrossPages({
  appId = 730,
  nameIncludes,
  onlyKnives = true,
  perPage = 50,
  startPage = 1,
  maxPages = 80,
  minPrice,
  maxPrice,
  includeAuctions = true,
  buyNowOnly = false,
  delayMs = 900,
} = {}) {
  const needles = nameIncludes
    ? String(nameIncludes).split(",").map((s) => s.trim()).filter(Boolean).map((s) => s.toLowerCase())
    : [];

  const matchesAny = (it) => {
    if (onlyKnives && !isKnifeByNameOrType(it)) return false;
    if (!needles.length) return true;
    const nm = String(it?.name || "").toLowerCase();
    const mh = String(it?.market_hash_name || "").toLowerCase();
    return needles.some((x) => nm.includes(x) || mh.includes(x));
  };

  for (let p = Math.max(1, Number(startPage) || 1); p < startPage + maxPages; p++) {
    const r = await fetchMarket({
      appId,
      page: p,
      perPage,
      includeAuctions,
      buyNowOnly,
      minPrice,
      maxPrice,
    });

    const items = Array.isArray(r?.items) ? r.items : [];
    const hit = items.find(matchesAny);

    if (hit) {
      return { ok: true, found: true, page: p, item: hit, meta: { itemsOnPage: items.length } };
    }

    if (items.length === 0) break;
    if (delayMs > 0) await sleep(Number(delayMs) || 0);
  }

  return { ok: true, found: false, meta: { startPage, maxPages, perPage, onlyKnives, nameIncludes } };
}
function toBool(v, def = false) {
  if (v === undefined || v === null || v === "") return def;
  return v === true || v === "1" || String(v).toLowerCase() === "true";
}

function toNum(v, def = undefined) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

/**
 * GET /api/items/market-live
 * LIVE upstream + פילטרים
 */
export async function getMarketLive(req, res, next) {
  try {
    const appId = toNum(req.query.appId, 730) ?? 730;

    const perPage = clamp(
      toNum(req.query.perPage ?? req.query.per_page, 100),
      1,
      2500
    );

    const minPrice = req.query.minPrice ?? undefined;
    const maxPrice = req.query.maxPrice ?? undefined;

    const auctionRaw = String(req.query.auction ?? "").trim().toLowerCase();
    const auction =
      auctionRaw === "yes" || auctionRaw === "no" ? auctionRaw : undefined;

    const order = req.query.order ?? "market_value";
    const sort = req.query.sort ?? "desc";
    const search = req.query.search ?? undefined;

    const minDiscountPct = toNum(req.query.minDiscountPct, undefined);

    const r = await fetchMarket({
      appId,
      page: 1,
      perPage,
      minPrice,
      maxPrice,
      auction,
      order,
      sort,
      search,
      debug: toBool(req.query.debug, false),
    });

    let items = Array.isArray(r?.items) ? r.items : [];

    const effectiveDiscount = (it) => {
      const d = Number(it?.discountPct);
      return Number.isFinite(d) && d > 0 ? d : 0;
    };

    if (Number.isFinite(minDiscountPct)) {
      items = items.filter((it) => effectiveDiscount(it) >= minDiscountPct);
    }

    res.json({
      ok: true,
      items,
      total: items.length,
      updatedAt: Date.now(),
      meta: {
        note: "LIVE upstream (no cache)",
        receivedQuery: req.query,
        receivedAuction: auction,
        minDiscountPct,
        upstreamTotal: r?.total ?? null,
        ...r?.meta,
      },
    });
  } catch (e) {
    next(e);
  }
}
export { isKnifeByNameOrType };

