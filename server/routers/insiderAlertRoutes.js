// server/routers/insiderAlertRoutes.js
// The signed-in user's insider-trade alerts. Mounted behind requireAccounts + protectRoute.
import express from "express";
import mongoose from "mongoose";
import AlertLog from "../models/alertLog.models.js";

const router = express.Router();
const fail = (res, err, where) => {
  console.error(`[INSIDER_ALERTS_ERROR] where=${where} err=${err?.name}: ${err?.message}`);
  return res.status(500).json({ ok: false, error: "Internal server error" });
};

router.get("/", async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const alerts = await AlertLog.find({ userId: req.user._id, kind: "insider_trade" })
      .sort({ triggeredAt: -1 }).limit(limit)
      .select("_id name insider isRead triggeredAt").lean();
    res.json({
      ok: true,
      unread: alerts.filter((a) => !a.isRead).length,
      alerts: alerts.map((a) => ({ id: String(a._id), title: a.name, isRead: a.isRead, triggeredAt: a.triggeredAt, ...a.insider })),
    });
  } catch (err) { fail(res, err, "list"); }
});

router.patch("/read-all", async (req, res) => {
  try {
    await AlertLog.updateMany({ userId: req.user._id, kind: "insider_trade", isRead: false }, { $set: { isRead: true } });
    res.json({ ok: true });
  } catch (err) { fail(res, err, "readAll"); }
});

router.patch("/:id/read", async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ ok: false, error: "Invalid id" });
    const r = await AlertLog.updateOne({ _id: req.params.id, userId: req.user._id, kind: "insider_trade" }, { $set: { isRead: true } });
    if (!r.matchedCount) return res.status(404).json({ ok: false, error: "Not found" });
    res.json({ ok: true });
  } catch (err) { fail(res, err, "read"); }
});

export default router;
