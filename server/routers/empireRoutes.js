// server/routers/empireRoutes.js
import { Router } from "express";
import {
  testAuth,
  fetchMarket,
  fetchAndFilterByRules,
  fetchAllAndFilterByRules,
  scanKnivesByPriceBuckets,
  findFirstKnifePage,
  findFirstMatchAcrossPages,
  fetchRawUpstream,
} from "../controllers/empire.controllers.js";

const router = Router();

/* ===== בדיקת חיבור ל-API ===== */
router.get("/ping", async (_req, res) => {
  try {
    if (!process.env.EMPIRE_BASE_URL || !process.env.EMPIRE_API_KEY) {
      return res.status(500).json({ error: "Missing EMPIRE_BASE_URL or EMPIRE_API_KEY" });
    }
    const result = await testAuth();
    res.json({ ok: true, upstream: result });
  } catch (err) {
    res.status(err.response?.status || 500).json({
      ok: false,
      message: err.message,
      upstreamStatus: err.response?.status,
      upstreamData: err.response?.data,
    });
  }
});

/* ===== שליפת פריטים כללית (עמוד אחד) ===== */
router.get("/market", async (req, res) => {
  try {
    const appId = Number(req.query.appId || process.env.EMPIRE_APP_ID || 730);
    const page = Math.max(1, Number(req.query.page || 1));
    const perPage = Math.min(100, Math.max(1, Number(req.query.perPage || 10)));

    const data = await fetchMarket({
      appId,
      page,
      perPage,
      includeAuctions: req.query.includeAuctions !== "0" && req.query.includeAuctions !== "false",
      buyNowOnly: req.query.buyNowOnly === "1" || req.query.buyNowOnly === "true",
      minPrice: req.query.minPrice,
      maxPrice: req.query.maxPrice,
      minDiscountPct: req.query.minDiscountPct,
      sort: req.query.sort,
      search: req.query.search,
      debug: req.query.debug === "1" || req.query.debug === "true",
    });

    res.json({ ok: true, ...data });
  } catch (err) {
    res.status(err.response?.status || 500).json({
      ok: false,
      message: err.message,
      upstreamStatus: err.response?.status,
      upstreamData: err.response?.data,
    });
  }
});

/* ===== סינון לפי כללי המערכת (עמוד אחד) ===== */
router.get("/market/filtered", async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const perPage = Math.min(50, Math.max(1, Number(req.query.perPage || 20)));

    const data = await fetchAndFilterByRules({
      page,
      perPage,
      appId: req.query.appId,
      includeAuctions: req.query.includeAuctions !== "0" && req.query.includeAuctions !== "false",
      buyNowOnly: req.query.buyNowOnly === "1" || req.query.buyNowOnly === "true",
      minPrice: req.query.minPrice,
      maxPrice: req.query.maxPrice,
      minDiscountPct: req.query.minDiscountPct,
      category: req.query.category,
      type: req.query.type,
      onlyKnives: req.query.onlyKnives === "1" || req.query.onlyKnives === "true",
      nameIncludes: req.query.nameIncludes
        ? String(req.query.nameIncludes).split(",").map((s) => s.trim()).filter(Boolean)
        : undefined,
    });

    res.json({ ok: true, ...data });
  } catch (err) {
    res.status(err.response?.status || 500).json({
      ok: false,
      message: err.message,
      upstreamStatus: err.response?.status,
      upstreamData: err.response?.data,
    });
  }
});

/* ===== סריקה לפי underPct (טווחים) עם אפשרות scanAll ===== */
router.get("/market/custom-scan", async (req, res) => {
  try {
    const scanAll = req.query.scanAll === "1" || req.query.scanAll === "true";
    const onlyKnives = req.query.onlyKnives === "1" || req.query.onlyKnives === "true";
    const minUnderPct = Number(req.query.minUnderPct ?? -9999);
    const maxUnderPct = Number(req.query.maxUnderPct ?? 9999);
    const minPrice = Number(req.query.minPrice ?? 0);
    const maxPrice = Number(req.query.maxPrice ?? 999999);
    const nameIncludes = req.query.nameIncludes;

    if (scanAll) {
      const result = await fetchAllAndFilterByRules({
        appId: req.query.appId,
        includeAuctions: req.query.includeAuctions !== "0" && req.query.includeAuctions !== "false",
        buyNowOnly: req.query.buyNowOnly === "1" || req.query.buyNowOnly === "true",
        minPrice,
        maxPrice,
        onlyKnives,
        nameIncludes,
        minUnderPct,
        maxUnderPct,
        startPage: Number(req.query.startPage || 1),
        maxPages: Number(req.query.maxPages || 200),
        delayMs: Number(req.query.delayMs || 1000),
      });
      return res.json({ ok: true, ...result });
    }

    const page = Math.max(1, Number(req.query.page || 1));
    const perPage = Math.min(50, Math.max(1, Number(req.query.perPage || 20)));
    const data = await fetchAndFilterByRules({
      page,
      perPage,
      appId: req.query.appId,
      includeAuctions: req.query.includeAuctions !== "0" && req.query.includeAuctions !== "false",
      buyNowOnly: req.query.buyNowOnly === "1" || req.query.buyNowOnly === "true",
      category: req.query.category,
      type: req.query.type,
      onlyKnives,
      nameIncludes,
    });

    const filtered = data.items.filter((it) => {
      const u = Number(it?.underPct);
      return Number.isFinite(u) && u >= minUnderPct && u <= maxUnderPct;
    });

    res.json({
      ok: true,
      matches: filtered,
      meta: {
        filteredCount: filtered.length,
        totalFetched: data.items.length,
        page,
        perPage,
        range: { minUnderPct, maxUnderPct },
      },
    });
  } catch (err) {
    console.error("custom-scan error:", err.message);
    res.status(err.response?.status || 500).json({
      ok: false,
      message: err.message,
      upstreamStatus: err.response?.status,
      upstreamData: err.response?.data,
    });
  }
});

/* ===== Raw upstream (debug) ===== */
router.get("/market/raw", async (req, res) => {
  try {
    const r = await fetchRawUpstream({
      appId: req.query.appId,
      page: Number(req.query.page || 1),
      perPage: Number(req.query.perPage || 50),
    });
    res.json(r);
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message });
  }
});

/* ===== סכינים לפי Buckets של מחיר ===== */
router.get("/market/knives-by-price", async (req, res) => {
  try {
    const r = await scanKnivesByPriceBuckets({
      appId: req.query.appId,
      nameIncludes: req.query.nameIncludes,
      onlyKnives: req.query.onlyKnives !== "0",
      perPage: Number(req.query.perPage || 50),
      delayMs: Number(req.query.delayMs || 1000),
    });
    res.json(r);
  } catch (err) {
    res.status(err.response?.status || 500).json({
      ok: false,
      message: err.message,
      upstreamStatus: err.response?.status,
      upstreamData: err.response?.data,
    });
  }
});

/* ===== למצוא את הדף הראשון עם סכינים/שם ===== */
router.get("/market/find-knife-page", async (req, res) => {
  try {
    const r = await findFirstKnifePage({
      appId: req.query.appId,
      nameIncludes: req.query.nameIncludes,
      onlyKnives: req.query.onlyKnives !== "0",
      perPage: Number(req.query.perPage || 50),
      startPage: Number(req.query.startPage || 1),
      maxProbes: Number(req.query.maxProbes || 40),
      step: Number(req.query.step || 20),
      delayMs: Number(req.query.delayMs || 1000),
    });
    res.json(r);
  } catch (err) {
    res.status(err.response?.status || 500).json({
      ok: false,
      message: err.message,
      upstreamStatus: err.response?.status,
      upstreamData: err.response?.data,
    });
  }
});

/* ===== לינארי עד שמוצאים ===== */
router.get("/market/find-first", async (req, res) => {
  try {
    const r = await findFirstMatchAcrossPages({
      appId: req.query.appId,
      nameIncludes: req.query.nameIncludes,
      onlyKnives: req.query.onlyKnives !== "0",
      perPage: Number(req.query.perPage || 50),
      startPage: Number(req.query.startPage || 1),
      maxPages: Number(req.query.maxPages || 80),
      minPrice: req.query.minPrice,
      maxPrice: req.query.maxPrice,
      includeAuctions: req.query.includeAuctions !== "0" && req.query.includeAuctions !== "false",
      buyNowOnly: req.query.buyNowOnly === "1" || req.query.buyNowOnly === "true",
      delayMs: Number(req.query.delayMs || 900),
    });
    res.json(r);
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message });
  }
});

export default router;