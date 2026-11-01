import { Router } from "express";
import protectRoute from "../middelware/protectRoute.js";
import { rescanActivePosts } from "../controllers/trade.controller.js";

const router = Router();

/**
 * POST /api/trade-notifications/rescan
 * Re-runs match detection for every active trade post against all synced inventories.
 * Creates any missing notifications. Safe to call repeatedly — deduplicated by unique index.
 */
router.post("/rescan", protectRoute, rescanActivePosts);

export default router;
