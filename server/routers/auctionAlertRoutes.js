import { Router } from "express";
import protectRoute from "../middelware/protectRoute.js";
import AuctionAlertRule from "../models/AuctionAlertRule.model.js";
import { invalidateAuctionRulesCache, processAuctionAlerts } from "../services/auctionAlertEngine.js";
import { getAllAuctions } from "../services/auctionCache.js";

const router = Router();
router.use(protectRoute);

// GET /api/auction-alerts — list current user's rules
router.get("/", async (req, res) => {
  try {
    const rules = await AuctionAlertRule.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ ok: true, rules });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/auction-alerts — create a rule
router.post("/", async (req, res) => {
  try {
    const {
      category,
      search,
      wear,
      minProfitCoins,
      minProfitPct,
      maxBidPrice,
      cooldownMin,
    } = req.body;

    if (minProfitCoins === undefined || minProfitCoins === "" || Number(minProfitCoins) < 0) {
      return res.status(400).json({
        ok: false,
        error: "minProfitCoins is required and must be ≥ 0",
      });
    }

    const rule = await AuctionAlertRule.create({
      userId:         req.user._id,
      category:       String(category || "all"),
      search:         String(search   || "").trim(),
      wear:           String(wear     || "").trim(),
      minProfitCoins: Number(minProfitCoins),
      minProfitPct:   minProfitPct != null && minProfitPct !== "" ? Number(minProfitPct) : null,
      maxBidPrice:    maxBidPrice  != null && maxBidPrice  !== "" ? Number(maxBidPrice)  : null,
      cooldownMin:    Number(cooldownMin || 10),
    });

    invalidateAuctionRulesCache();
    res.status(201).json({ ok: true, rule });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PATCH /api/auction-alerts/:id — toggle enabled or update fields
router.patch("/:id", async (req, res) => {
  try {
    // Guard against setting userId from client
    const { userId: _removed, ...update } = req.body;

    const rule = await AuctionAlertRule.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { $set: update },
      { new: true, runValidators: true }
    );

    if (!rule) {
      return res.status(404).json({ ok: false, error: "Rule not found" });
    }

    invalidateAuctionRulesCache();
    res.json({ ok: true, rule });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/auction-alerts/run-once
// Scans every item currently in the auction cache against all enabled rules.
// No Empire API calls, no page scanning, zero 429 risk.
router.post("/run-once", async (req, res) => {
  try {
    const items = getAllAuctions();
    console.log(`[run-once] scanning ${items.length} cached auction(s) against rules…`);
    const result = await processAuctionAlerts(items);
    res.json({
      ok: true,
      cachedAuctions: items.length,
      processed:      result.processed,
      matched:        result.matched,
      fired:          result.fired,
      message:        result.fired > 0
        ? `${result.fired} new alert(s) created`
        : result.matched > 0
          ? `${result.matched} match(es) found but already alerted (dedup/cooldown)`
          : "No matches found — check rule thresholds vs cached auction prices",
    });
  } catch (err) {
    console.error("❌ [run-once] error:", err?.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// DELETE /api/auction-alerts/:id
router.delete("/:id", async (req, res) => {
  try {
    const result = await AuctionAlertRule.deleteOne({
      _id:    req.params.id,
      userId: req.user._id,
    });

    if (!result.deletedCount) {
      return res.status(404).json({ ok: false, error: "Rule not found" });
    }

    invalidateAuctionRulesCache();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
