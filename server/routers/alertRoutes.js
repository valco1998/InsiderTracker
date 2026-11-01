import { Router } from "express";
import { scanAlerts, runAlertsOnce } from "../controllers/alerts.controller.js";
import AlertLog from "../models/alertLog.models.js";
import protectRoute from "../middelware/protectRoute.js";
import requireAdmin from "../middelware/requireAdmin.js";
import { getAlertStats, resetAlertStats } from "../services/alertStats.js";

const router = Router();

console.log("✅ alertRoutes loaded");

/* =========================
   PUBLIC
========================= */
router.get("/ping", (_req, res) => {
  res.json({ ok: true, message: "alerts route ready" });
});

/* =========================
   PIPELINE STATS
========================= */
router.get("/stats", protectRoute, (_req, res) => {
  res.json({ ok: true, stats: getAlertStats() });
});

// Counters are global (all users) — only the operator may wipe them.
router.post("/stats/reset", protectRoute, requireAdmin, (_req, res) => {
  resetAlertStats();
  res.json({ ok: true, stats: getAlertStats() });
});

/* =========================
   PROTECTED
========================= */
router.use(protectRoute);

router.get("/", async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;

    // Only return live alerts — expired/deleted are invisible to the user.
    // Sort newest-first so the dedup below keeps the freshest alert per item.
    const raw = await AlertLog.find({ userId, status: "live" })
      .sort({ triggeredAt: -1 })
      .limit(200)
      .lean();

    // Deduplicate by itemId: if two rules fired on the same market listing,
    // show only the freshest one (highest profit / lowest price is already
    // whichever triggered first given the sort above).
    const seen = new Set();
    const alerts = raw.filter(a => {
      const key = String(a.itemId || "");
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 100);

    res.json({ ok: true, alerts });
  } catch (e) {
    console.error("GET /api/alerts error:", e);
    res.status(500).json({ ok: false, error: e.message || "Failed to fetch alerts" });
  }
});

router.patch("/:id/read", async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;

    const alert = await AlertLog.findOneAndUpdate(
      { _id: req.params.id, userId },
      { $set: { isRead: true } },
      { new: true }
    ).lean();

    if (!alert) {
      return res.status(404).json({
        ok: false,
        error: "Alert not found",
      });
    }

    res.json({
      ok: true,
      alert,
    });
  } catch (e) {
    console.error("PATCH /api/alerts/:id/read error:", e);
    res.status(500).json({
      ok: false,
      error: e.message || "Failed to mark alert as read",
    });
  }
});

router.patch("/read-all", async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;

    const result = await AlertLog.updateMany(
      { userId, isRead: false },
      { $set: { isRead: true } }
    );

    res.json({
      ok: true,
      updated: result.modifiedCount ?? 0,
    });
  } catch (e) {
    console.error("PATCH /api/alerts/read-all error:", e);
    res.status(500).json({
      ok: false,
      error: e.message || "Failed to mark all alerts as read",
    });
  }
});
router.delete("/:id", async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;

    const result = await AlertLog.deleteOne({
      _id: req.params.id,
      userId,
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        ok: false,
        error: "Alert not found",
      });
    }

    res.json({
      ok: true,
      deleted: result.deletedCount,
    });
  } catch (e) {
    console.error("DELETE /api/alerts/:id error:", e);
    res.status(500).json({
      ok: false,
      error: e.message || "Failed to delete alert",
    });
  }
});
router.post("/run-once", async (req, res) => {
  try {
    const result = await runAlertsOnce({
      ...(req.query || {}),
      ...(req.body || {}),
      userId: req.user?._id || req.user?.id,
      io: req.app.get("io"),
      source: "manual",
    });

    res.json(result);
  } catch (e) {
    console.error("POST /api/alerts/run-once error:", e);
    res.status(500).json({
      ok: false,
      error: e.message || "Failed to run alerts once",
    });
  }
});

router.get("/scan", scanAlerts);
router.post("/scan", scanAlerts);

router.post("/debug/alert", async (req, res) => {
  try {
    const payload = req.body || {};
    const userId = req.user?._id || req.user?.id;

    const alert = await AlertLog.findOneAndUpdate(
      {
        userId,
        ruleId: "000000000000000000000001",
        itemId: "debug-ak-redline-ft",
      },
      {
        $set: {
          name: payload.name,
          marketHashName: payload.marketHashName,
          image: payload.image || "",
          priceCoins: payload.priceCoins,
          suggestedCoins: payload.suggestedCoins,
          discountPct: payload.discountPct,
          wear: payload.wear,
          isRead: false,
          triggeredAt: new Date(),
        },
        $setOnInsert: {
          userId,
          ruleId: "000000000000000000000001",
          itemId: "debug-ak-redline-ft",
        },
      },
      {
        upsert: true,
        new: true,
      }
    );

    res.json({ ok: true, alert });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post("/debug/clear-dedup", async (req, res) => {
  try {
    if (process.env.NODE_ENV === "production") {
      return res.status(404).json({ ok: false });
    }

    const userId = req.user?._id || req.user?.id;

    const result = await AlertLog.deleteMany({
      userId,
      source: "debug",
    });

    res.json({
      ok: true,
      cleared: true,
      deleted: result.deletedCount ?? 0,
    });
  } catch (e) {
    console.error("POST /api/alerts/debug/clear-dedup error:", e);
    res.status(500).json({
      ok: false,
      error: e.message || "Failed to clear debug alerts",
    });
  }
});

export default router;