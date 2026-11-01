import { Router } from "express";
import protectRoute from "../middelware/protectRoute.js";
import requireAdmin from "../middelware/requireAdmin.js";
import { getDashboard, getAlertTimeline, getRecentEvents } from "../services/notificationMetrics.js";
import { getEmpireMarketSocketStatus } from "../services/empireMarketSocket.js";
import { getBandwidthSnapshot, resetBandwidthMetrics } from "../middelware/bandwidthMetrics.js";

const router = Router();

router.use(protectRoute, requireAdmin);

/* GET /api/notifications/metrics/bandwidth — per-route request count + bytes sent */
router.get("/bandwidth", (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 25, 100);
  res.json({ ok: true, ...getBandwidthSnapshot({ limit }) });
});

/* POST /api/notifications/metrics/bandwidth/reset — zero the counters */
router.post("/bandwidth/reset", (req, res) => {
  resetBandwidthMetrics();
  res.json({ ok: true });
});

/* GET /api/notifications/metrics/dashboard */
router.get("/dashboard", async (req, res) => {
  try {
    const periods = await getDashboard();
    res.json({ ok: true, periods, wsStatus: getEmpireMarketSocketStatus() });
  } catch (e) {
    console.error("GET /api/notifications/metrics/dashboard error:", e);
    res.status(500).json({ ok: false, error: e.message || "Failed to load dashboard" });
  }
});

/* GET /api/notifications/metrics/alert/:alertId/timeline */
router.get("/alert/:alertId/timeline", async (req, res) => {
  try {
    const timeline = await getAlertTimeline(req.params.alertId);
    if (!timeline) return res.status(404).json({ ok: false, error: "Alert not found" });
    res.json({ ok: true, timeline });
  } catch (e) {
    console.error("GET /api/notifications/metrics/alert/:alertId/timeline error:", e);
    res.status(500).json({ ok: false, error: e.message || "Failed to load alert timeline" });
  }
});

/* GET /api/notifications/metrics/events?type=PUSH_SEND_FAIL&limit=50 */
router.get("/events", async (req, res) => {
  try {
    const events = await getRecentEvents({ type: req.query.type, limit: req.query.limit });
    res.json({ ok: true, events });
  } catch (e) {
    console.error("GET /api/notifications/metrics/events error:", e);
    res.status(500).json({ ok: false, error: e.message || "Failed to load events" });
  }
});

export default router;
