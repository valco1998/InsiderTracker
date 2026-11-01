// server/routers/auctionRoutes.js
// Serves auction data exclusively from the in-memory auctionCache.
// Zero HTTP calls to Empire — all data arrives via websocket.

import express from "express";
import { queryAuctions, getAuctionCacheSize } from "../services/auctionCache.js";
import { cachePrivate } from "../middelware/cachePolicy.js";
import { trimItemsForClient } from "../utils/trimItemForClient.js";

const router = express.Router();

// GET /api/auctions
// Query params: search, category, minPrice, maxPrice, wear, sort, limit, skip
router.get("/", cachePrivate(8), (req, res) => {
  try {
    const {
      search   = "",
      category = "",
      minPrice = "",
      maxPrice = "",
      wear     = "",
      sort     = "endingSoon",
      limit    = "200",
      skip     = "0",
    } = req.query;

    const result = queryAuctions({
      search,
      category,
      minPrice,
      maxPrice,
      wear,
      sort,
      limit:  Math.min(500, Math.max(1, Number(limit) || 200)),
      skip:   Math.max(0,            Number(skip)  || 0),
    });

    res.json({ ok: true, ...result, items: trimItemsForClient(result.items) });
  } catch (err) {
    console.error("❌ [auctionRoutes] GET /api/auctions error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/auctions/status — quick health check
router.get("/status", (_req, res) => {
  res.json({ ok: true, cacheSize: getAuctionCacheSize() });
});

export default router;
