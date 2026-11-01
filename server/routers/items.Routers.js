// server/routes/items.Routers.js
import { Router } from "express";
import protectRoute from "../middelware/protectRoute.js";
import { cachePrivate } from "../middelware/cachePolicy.js";
import { getItemDetails } from "../controllers/items.controllers.js";
import { fetchMarket } from "../controllers/empire.controllers.js";
import { safeFetchMarket } from "../services/safeFetchMarket.js";
import {
  ensureMarketCache,
  getMarketCache,
  queryCache,
  upsertIntoCache,
  batchUpsertIntoCache,
  getPremiumDealsFromCache,
} from "../services/marketCache.js";
import SkinMetrics from "../models/SkinMetrics.model.js";
import { computeDealScore } from "../services/dealScore.js";
import { trimItemsForClient } from "../utils/trimItemForClient.js";

// ── Deal Score enrichment ─────────────────────────────────────────────────────
// Batch-fetches SkinMetrics for all items and attaches a dealScore object to each.
// Non-blocking: if the DB query fails, items are returned as-is without a score.
async function enrichWithDealScores(items) {
  if (!items.length) return items;
  try {
    const uniqueNames = [...new Set(
      items.map(it => it.marketHashName ?? it.market_hash_name ?? it.name ?? "").filter(Boolean)
    )];
    if (!uniqueNames.length) return items;

    const metricsArr = await SkinMetrics
      .find({ marketHashName: { $in: uniqueNames } })
      .select("marketHashName wear tier tierSource soldCount30d soldCount90d soldEarliestAt lastSoldAt medianSoldPrice medianPrice7d listingCount7d avgFloat7d")
      .lean();

    // marketHashName already encodes the wear tier (Empire includes it in the name),
    // so one entry per marketHashName is all we need for the lookup.
    const metricsMap = new Map();
    for (const m of metricsArr) {
      metricsMap.set(m.marketHashName, m);
    }

    return items.map(item => {
      const mhn     = item.marketHashName ?? item.market_hash_name ?? item.name ?? "";
      const metrics = mhn ? (metricsMap.get(mhn) ?? null) : null;
      return { ...item, dealScore: computeDealScore(item, metrics) };
    });
  } catch (err) {
    console.warn("[DEAL_SCORE] enrichment failed (non-fatal):", err?.message || err);
    return items;
  }
}

const router = Router();
router.get("/:id/details", protectRoute, (req, res, next) => {
  console.log("DETAIL ROUTE HIT:", req.params.id);
  next();
}, getItemDetails);
router.get("/home-premium", cachePrivate(10), async (req, res) => {
  const t0 = Date.now();
  try {
    const limit = Math.min(Number(req.query.limit || 100), 300);
    const minPrice = Number(req.query.minPrice || 30);
    const maxPrice = Number(req.query.maxPrice || 1000000);
    const minDiscountPct = Number(req.query.minDiscountPct ?? 5);

    const cache = getMarketCache();
    const cacheAge = cache.updatedAt ? Date.now() - cache.updatedAt : Infinity;
    const cacheHasData = cache.items.length > 0;
    const cacheFresh = cache.items.length > 100 && cacheAge < 60_000;

    // STALE-WHILE-REVALIDATE: return any cached data immediately (fresh or stale)
    if (cacheHasData) {
      const data = getPremiumDealsFromCache({ minPrice, maxPrice, minDiscountPct, limit });
      data.items = trimItemsForClient(data.items);
      const elapsed = Date.now() - t0;
      const source = cacheFresh ? "cache-fresh" : "cache-stale";
      console.log(`[home-premium] ${source} | ${elapsed}ms | items=${data.items?.length} | cacheAge=${Math.round(cacheAge / 1000)}s | cached=${cache.items.length}`);

      // Background refresh when stale — don't block the response
      if (!cacheFresh) {
        setImmediate(() => {
          // Broad fetch: top items by market value (covers expensive/mid-tier)
          fetchMarket({ appId: 730, page: 1, perPage: 2500, auction: "no", sort: "desc", order: "market_value", debug: false })
            .then(live => {
              const liveItems = Array.isArray(live?.items) ? live.items : [];
              if (liveItems.length > 0) {
                batchUpsertIntoCache(liveItems);
                console.log(`[home-premium] bg-refresh done: ${liveItems.length} items`);
              }
            })
            .catch(err => console.warn(`[home-premium] bg-refresh error: ${err?.message}`));
          // Cheap-item fetch: ensures 30–200 coin items are cached for budget buckets
          fetchMarket({ appId: 730, page: 1, perPage: 500, maxPrice: 200, auction: "no", sort: "desc", order: "market_value", debug: false })
            .then(live => {
              const liveItems = Array.isArray(live?.items) ? live.items : [];
              if (liveItems.length > 0) {
                batchUpsertIntoCache(liveItems);
                console.log(`[home-premium] bg-refresh cheap done: ${liveItems.length} items`);
              }
            })
            .catch(err => console.warn(`[home-premium] bg-refresh cheap error: ${err?.message}`));
        });
      }

      return res.json({
        ok: true,
        ...data,
        source,
        updatedAt: cache.updatedAt,
        meta: { ...data.meta, cacheFresh, cacheAge: Math.round(cacheAge / 1000), elapsed },
      });
    }

    // Cache empty — attempt live fetch with hard timeout
    const TIMEOUT_MS = 2500;
    let liveItems = [];
    let timedOut = false;

    const livePromise = fetchMarket({ appId: 730, page: 1, perPage: 2500, auction: "no", sort: "desc", order: "market_value", debug: false });

    // Keep live fetch running in background even if timeout fires
    livePromise
      .then(live => {
        const items = Array.isArray(live?.items) ? live.items : [];
        if (items.length > 0) {
          batchUpsertIntoCache(items);
          console.log(`[home-premium] deferred live done: ${items.length} items`);
        }
      })
      .catch(err => console.warn(`[home-premium] deferred live error: ${err?.message}`));

    let timeoutHandle;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutHandle = setTimeout(() => reject(Object.assign(new Error("timeout"), { isTimeout: true })), TIMEOUT_MS);
    });

    try {
      const live = await Promise.race([livePromise, timeoutPromise]);
      clearTimeout(timeoutHandle);
      liveItems = Array.isArray(live?.items) ? live.items : [];
      batchUpsertIntoCache(liveItems);
    } catch (err) {
      clearTimeout(timeoutHandle);
      if (!err.isTimeout) throw err;
      timedOut = true;
      console.warn(`[home-premium] live fetch timed out after ${TIMEOUT_MS}ms — returning empty, bg fetch continues`);
    }

    const data = getPremiumDealsFromCache({ minPrice, maxPrice, minDiscountPct, limit });
    data.items = trimItemsForClient(data.items);
    const elapsed = Date.now() - t0;
    const source = timedOut ? "timeout-empty" : "live-fetch";
    console.log(`[home-premium] ${source} | ${elapsed}ms | items=${data.items?.length}`);

    return res.json({
      ok: true,
      ...data,
      source,
      timedOut,
      updatedAt: getMarketCache().updatedAt || Date.now(),
      meta: { ...data.meta, cacheFresh: false, elapsed, timedOut },
    });
  } catch (err) {
    const elapsed = Date.now() - t0;
    console.error(`[home-premium] error after ${elapsed}ms:`, err?.message);
    return res.status(500).json({
      ok: false,
      items: [],
      message: err?.message || "home premium failed",
      elapsed,
    });
  }
});

/* =========================
   Helpers
========================= */
function toBool(v, def = false) {
  if (v === undefined || v === null || v === "") return def;
  return v === true || v === "1" || String(v).toLowerCase() === "true";
}

function toNum(v, def = undefined) {
  if (v === undefined || v === null || v === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function clamp(n, min, max) {
  if (!Number.isFinite(n)) return n;
  return Math.min(max, Math.max(min, n));
}

function normSort(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "-discountPct";
  return s;
}

function parseNeedles(q) {
  const s = String(q ?? "").toLowerCase().trim();
  if (!s) return [];
  return s.split(/\s+/); // ["m9", "web"]
}

function coinPrice(item) {
  if (Number.isFinite(Number(item?.priceCoins))) return Number(item.priceCoins);
  if (Number.isFinite(Number(item?.price))) return Number(item.price);
  if (Number.isFinite(Number(item?.priceCents))) return Number(item.priceCents) / 100;
  return 0;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* =========================
   Ping
========================= */
router.get("/ping", (_req, res) => {
  res.json({ ok: true, from: "items.Routers.js", version: "rotating-v6-livefix" });
});

// נוחות: /api/items => כמו /api/items/market
router.get("/", protectRoute, (req, res, next) => {
  req.url =
    "/market" + (req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "");
  return router.handle(req, res, next);
});

/* =========================
   Rotating scans (sequential + backoff)
========================= */
async function rotatingScanOnce({
  appId = 730,
  perPage = 100,
  maxScans = 12,
  minPrice,
  maxPrice,
  startDelayMs = 500,
  maxDelayMs = 8000,
  tryAuctionOnly = true,
} = {}) {
  const reqMin = Number.isFinite(Number(minPrice)) ? Number(minPrice) : null;
  const reqMax = Number.isFinite(Number(maxPrice)) ? Number(maxPrice) : null;

  const priceBuckets = [
    [0, 5],
    [5, 20],
    [20, 200],
    [200, 2000],
    [2000, 10000],
    [10000, 50000],
    [50000, 200000],
    [200000, 1000000],
  ];

  const bucketScans = (() => {
    if (reqMin != null || reqMax != null) {
      const a = reqMin ?? 0;
      const b = reqMax ?? 1000000;

      const primary = [
        {
          includeAuctions: true,
          buyNowOnly: false,
          minPrice: reqMin ?? undefined,
          maxPrice: reqMax ?? undefined,
          minDiscountPct: undefined,
          sort: "desc",
          order: "market_value",
        },
      ];

      const overlapping = priceBuckets
        .filter(([x, y]) => !(y < a || x > b))
        .sort((p1, p2) => p2[0] - p1[0])
        .map(([x, y]) => ({
          includeAuctions: true,
          buyNowOnly: false,
          minPrice: Math.max(x, a),
          maxPrice: Math.min(y, b),
          minDiscountPct: undefined,
          sort: "desc",
          order: "market_value",
        }));

      return [...primary, ...overlapping];
    }

    return priceBuckets.map(([minP, maxP]) => ({
      includeAuctions: true,
      buyNowOnly: false,
      minPrice: minP,
      maxPrice: maxP,
      minDiscountPct: undefined,
      sort: "desc",
      order: "market_value",
    }));
  })();

  const baseScans = [
    { includeAuctions: true, buyNowOnly: false, minPrice: undefined, maxPrice: undefined, minDiscountPct: undefined, sort: "market_value", order: "desc" },
    { includeAuctions: true, buyNowOnly: true, minPrice: undefined, maxPrice: undefined, minDiscountPct: undefined, sort: "market_value", order: "desc" },
    { includeAuctions: false, buyNowOnly: false, minPrice: undefined, maxPrice: undefined, minDiscountPct: undefined, sort: "market_value", order: "desc" },
  ];

  const scans = (reqMin != null || reqMax != null) ? [...bucketScans, ...baseScans] : [...baseScans, ...bucketScans];

  const key = (s) =>
    [
      s.includeAuctions ? 1 : 0,
      s.buyNowOnly ? 1 : 0,
      s.minPrice ?? "",
      s.maxPrice ?? "",
      s.minDiscountPct ?? "",
      s.sort ?? "",
      s.order ?? "",
    ].join("|");

  const uniq = new Map();
  for (const s of scans) uniq.set(key(s), s);
  const finalScans = Array.from(uniq.values()).slice(0, maxScans);

  async function callWithBackoff(makeCall, delayObj) {
    for (; ;) {
      try {
        return await makeCall();
      } catch (e) {
        const st = e?.response?.status;
        if (st === 429) {
          const ra = Number(e?.response?.headers?.["retry-after"]);
          const waitMs = Number.isFinite(ra)
            ? ra * 1000
            : Math.min(maxDelayMs, delayObj.delay * 2);
          delayObj.delay = Math.min(maxDelayMs, waitMs);
          await sleep(delayObj.delay);
          continue;
        }
        throw e;
      }
    }
  }

  let delay = startDelayMs;
  let upserted = 0;

  let lastAllCount = 0;
  let lastAuctionCount = 0;
  let sumAllCount = 0;
  let sumAuctionCount = 0;

  for (let i = 0; i < finalScans.length; i++) {
    const s = finalScans[i];
    const delayObj = { delay };

    // 1) ALL / MIXED
    try {
      const respAll = await callWithBackoff(
        () =>
          fetchMarket({
            appId,
            page: 1,
            perPage,
            includeAuctions: s.includeAuctions,
            buyNowOnly: s.buyNowOnly,
            minPrice: s.minPrice,
            maxPrice: s.maxPrice,
            minDiscountPct: s.minDiscountPct,
            sort: s.sort ?? "market_value",
            order: s.order ?? "desc",
            debug: false,
          }),
        delayObj
      );

      lastAllCount = respAll?.items?.length || 0;
      sumAllCount += lastAllCount;
      upserted += batchUpsertIntoCache(respAll?.items || []);

      delayObj.delay = Math.max(250, Math.floor(delayObj.delay * 0.85));
      await sleep(delayObj.delay);
    } catch {
      await sleep(delayObj.delay);
    }

    // 2) AUCTION ONLY (אם רוצים)
    if (tryAuctionOnly) {
      try {
        const respAuction = await callWithBackoff(
          () =>
            fetchMarket({
              appId,
              page: 1,
              perPage,
              includeAuctions: true,
              minPrice: s.minPrice,
              maxPrice: s.maxPrice,
              sort: s.sort ?? "market_value",
              order: s.order ?? "desc",
              auction: "yes",
              debug: false,
            }),
          delayObj
        );

        lastAuctionCount = respAuction?.items?.length || 0;
        sumAuctionCount += lastAuctionCount;
        upserted += batchUpsertIntoCache(respAuction?.items || []);

        delayObj.delay = Math.max(250, Math.floor(delayObj.delay * 0.85));
        await sleep(delayObj.delay);
      } catch {
        await sleep(delayObj.delay);
      }
    }

    delay = delayObj.delay;

    const cMid = getMarketCache();
    cMid.meta = {
      ...(cMid.meta || {}),
      lastAllCount,
      lastAuctionCount,
      sumAllCount,
      sumAuctionCount,
      lastScanAt: Date.now(),
    };
  }

  const c = getMarketCache();
  c.meta = {
    ...(c.meta || {}),
    version: "items.Routers.js rotating-v6-livefix",
    scans: finalScans.length,
    rotatingUpserted: upserted,
    rotatingAt: Date.now(),
    lastAllCount,
    lastAuctionCount,
    sumAllCount,
    sumAuctionCount,
  };

  return { scans: finalScans.length, upserted, lastAllCount, lastAuctionCount, sumAllCount, sumAuctionCount };
}

/* =========================
   /market = Cache-first + Auto-broad when needed
========================= */
router.get("/market", protectRoute, cachePrivate(8), async (req, res, next) => {
  try {
    const q = String(req.query.q || req.query.search || "").trim();

    const category = String(req.query.category ?? "");
    const minPrice = toNum(req.query.minPrice, undefined);
    const maxPrice = toNum(req.query.maxPrice, undefined);
    const minDiscountPct = toNum(req.query.minDiscountPct, undefined);

    const sort = normSort(req.query.sort || "-discountPct");
    const limit = clamp(toNum(req.query.limit, 300), 1, 1000);
    const skip = Math.max(toNum(req.query.skip, 0), 0);

    // 🔥 אם יש חיפוש — מחפש LIVE בכל CSGOEmpire, לא רק ב-cache
    if (q) {
      const live = await fetchMarket({
        appId: 730,
        page: 1,
        perPage: 2500,
        search: q,
        auction: req.query.auction ?? "no",
        sort: "desc",
        order: "market_value",
        minPrice,
        maxPrice,
        debug: true,
      });

      let liveItems = Array.isArray(live?.items) ? live.items : [];
      batchUpsertIntoCache(liveItems);

      if (Number.isFinite(minDiscountPct)) {
        liveItems = liveItems.filter(
          (item) => Number(item?.discountPct || 0) >= minDiscountPct
        );
      }

      const liveSlice   = liveItems.slice(skip, skip + limit);
      const enrichedLive = await enrichWithDealScores(liveSlice);
      return res.json({
        ok: true,
        items: trimItemsForClient(enrichedLive),
        total: liveItems.length,
        updatedAt: Date.now(),
        meta: {
          source: "live-search-csgoempire",
          q,
          returned: enrichedLive.length,
          cached: getMarketCache().items.length,
          ...live?.meta,
        },
      });
    }

    // ✅ בלי חיפוש — משתמשים ב-cache
    await ensureMarketCache({
      appId: 730,
      ttlMs: getMarketCache().items.length < 100 ? 0 : 60_000,
      perPage: 100,
      deepWhen: () => false,
    });

    const out = queryCache({
      q,
      category,
      minPrice: typeof minPrice === "number" ? String(minPrice) : "",
      maxPrice: typeof maxPrice === "number" ? String(maxPrice) : "",
      minDiscountPct:
        typeof minDiscountPct === "number" ? String(minDiscountPct) : "",
      sort,
      limit,
      skip,
    });

    const rawItems    = Array.isArray(out.items) ? out.items : [];
    const items       = await enrichWithDealScores(rawItems);
    const c = getMarketCache();

    return res.json({
      ok: true,
      items: trimItemsForClient(items),
      total: out.total || rawItems.length,
      updatedAt: out.updatedAt || c.updatedAt,
      meta: {
        ...(c.meta || {}),
        cached: c.items.length,
        returned: items.length,
        q,
        source: "cache-market",
      },
    });
  } catch (e) {
    next(e);
  }
});

/* =========================
   /refresh = the only intentional broad expander
========================= */
router.get("/refresh", protectRoute, async (req, res, next) => {
  try {
    const perPage = clamp(toNum(req.query.perPage, 100), 1, 100);
    const appId = toNum(req.query.appId, 730) ?? 730;
    const broad = toBool(req.query.broad, false);

    // ✅ חשוב
    const minPrice = toNum(req.query.minPrice, undefined);
    const maxPrice = toNum(req.query.maxPrice, undefined);

    await ensureMarketCache({ appId, ttlMs: 0, perPage });
    const cache = getMarketCache();

    if (!cache.items.length) {
      console.log("⚡ Cache empty → running initial scan");

      await rotatingScanOnce({
        appId: 730,
        perPage: 100,
        maxScans: 8,
      });
    }
    let scanMeta = null;
    if (broad) {
      scanMeta = await rotatingScanOnce({
        appId,
        perPage,
        maxScans: 12,
        minPrice,
        maxPrice,
      });
    }

    const c = getMarketCache();

    res.json({
      ok: true,
      updatedAt: c.updatedAt,
      count: c.items.length,
      meta: {
        ...(c.meta || {}),
        scans: scanMeta?.scans,
        rotatingUpserted: scanMeta?.upserted,
      },
    });
  } catch (e) {
    next(e);
  }
});

/* =========================
   /market-live = live upstream (no cache)
========================= */
router.get("/market-live", cachePrivate(6), async (req, res, next) => {
  try {
    const appId = toNum(req.query.appId, 730) ?? 730;

    const perPage = clamp(
      toNum(req.query.perPage ?? req.query.per_page, 100),
      1,
      100
    );

    const minPrice = req.query.minPrice ?? undefined;
    const maxPrice = req.query.maxPrice ?? undefined;
    const search = req.query.search ?? undefined;
    const minDiscountPct = toNum(req.query.minDiscountPct, undefined);

    const r = await fetchMarket({
      appId,
      page: 1,
      perPage,
      minPrice,
      maxPrice,
      search,
      debug: true,
    });

    if (r?.meta?.error) {
      return res.status(r.meta.status || 500).json({
        ok: false,
        error: "Upstream market request failed",
        details: r.meta,
      });
    }

    let items = Array.isArray(r?.items) ? r.items : [];

    console.log("LIVE ITEMS:", items.length);

    if (Number.isFinite(minDiscountPct)) {
      items = items.filter((item) => {
        const discount = Number(item?.discountPct ?? 0);
        return Number.isFinite(discount) && discount >= minDiscountPct;
      });
    }

    res.json({
      ok: true,
      items: trimItemsForClient(items),
      total: items.length,
      updatedAt: Date.now(),
      meta: {
        note: "LIVE upstream",
        receivedQuery: req.query,
        ...r.meta,
      },
    });
  } catch (e) {
    next(e);
  }
});
router.get("/cache-status", async (_req, res) => {
  const c = getMarketCache();

  const deals = c.items
    .filter((i) => Number(i.discountPct || 0) >= 2 && Number(i.priceCoins || 0) >= 50)
    .sort((a, b) => Number(b.discountPct || 0) - Number(a.discountPct || 0));

  res.json({
    ok: true,
    cached: c.items.length,
    updatedAt: c.updatedAt,
    ageSec: c.updatedAt ? Math.round((Date.now() - c.updatedAt) / 1000) : null,
    dealsCount: deals.length,
    topDeals: deals.slice(0, 10).map((i) => ({
      name: i.name,
      priceCoins: i.priceCoins,
      suggestedCoins: i.suggestedCoins,
      discountPct: i.discountPct,
      categoryKey: i.categoryKey,
      cachedAt: i.cachedAt,
    })),
    meta: c.meta,
  });
});
export default router;