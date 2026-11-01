import { Router } from "express";
import SystemSettings from "../models/SystemSettings.model.js";
import { ensureSystemSettingsDefaults } from "../models/systemSettingsmodels.js";

const router = Router();

// GET /api/settings
router.get("/", async (_req, res) => {
  const rows = await SystemSettings.find({}).lean();
  res.json({ ok: true, items: rows });
});

// POST /api/settings/ensure-defaults
router.post("/ensure-defaults", async (_req, res) => {
  await ensureSystemSettingsDefaults();
  res.json({ ok: true });
});

export default router;
