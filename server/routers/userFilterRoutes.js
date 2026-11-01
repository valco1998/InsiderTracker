// server/routes/userFilterRoutes.js
import { Router } from "express";
import UserFilter from "../models/UserFilter.model.js";
import { normalizeFiltersInput } from "../utils/normalizeFilters.js";
import protectRoute from "../middelware/protectRoute.js";

const router = Router();

router.get("/ping", (_req, res) => res.json({ ok: true, route: "user-filters/ping" }));
router.use(protectRoute);


/* ---------- helpers ---------- */
const toIntOrUndef = (v) => {
  if (v === null || typeof v === "undefined") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

const isPlainObject = (v) =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/* ---------- GET /api/user-filters (של המשתמש המחובר) ---------- */
router.get("/", async (req, res) => {
  try {
    const userId = String(req.user._id);
    const item = await UserFilter.findOne({ userId }).lean();
    res.json({ ok: true, item: item || null });
  } catch (e) {
    console.error("GET /user-filters error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ---------- POST /api/user-filters (upsert מלא) ---------- */
router.post("/", async (req, res) => {
  try {
    const userId = String(req.user._id);

    const rawFilters = isPlainObject(req.body.filters) ? req.body.filters : null;
    if (!rawFilters) {
      return res.status(400).json({ ok: false, error: "filters object is required" });
    }

    const filters = normalizeFiltersInput(rawFilters);

    const channels =
      typeof req.body.channels === "undefined"
        ? undefined
        : isPlainObject(req.body.channels)
          ? req.body.channels
          : {};

    const throttle =
      typeof req.body?.throttle?.minMinutesBetweenAlerts !== "undefined"
        ? { minMinutesBetweenAlerts: toIntOrUndef(req.body.throttle.minMinutesBetweenAlerts) }
        : undefined;

    const item = await UserFilter.findOneAndUpdate(
      { userId },
      { $set: { filters, channels, throttle } },
      { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }
    );

    res.json({ ok: true, item });
  } catch (e) {
    console.error("POST /user-filters error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ---------- PUT /api/user-filters (replace מלא) ---------- */
router.put("/", async (req, res) => {
  try {
    const userId = String(req.user._id);

    const rawFilters = isPlainObject(req.body.filters) ? req.body.filters : null;
    if (!rawFilters) {
      return res.status(400).json({ ok: false, error: "filters object is required" });
    }

    const filters = normalizeFiltersInput(rawFilters);

    const update = { filters };

    if (typeof req.body.channels !== "undefined") {
      update.channels = isPlainObject(req.body.channels) ? req.body.channels : {};
    }
    if (typeof req.body.throttle !== "undefined") {
      update.throttle = toIntOrUndef(req.body.throttle);
    }

    const item = await UserFilter.findOneAndUpdate(
      { userId },
      { $set: update },
      { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }
    );

    res.json({ ok: true, item });
  } catch (e) {
    console.error("PUT /user-filters error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ---------- PATCH /api/user-filters (עדכון חלקי אמיתי = merge) ---------- */
router.patch("/", async (req, res) => {
  try {
    const userId = String(req.user._id);

    // נטען קיים כדי ש-PATCH לא ימחק שדות שלא נשלחו
    const existing = await UserFilter.findOne({ userId }).lean();
    const existingFilters = isPlainObject(existing?.filters) ? existing.filters : {};
    const existingChannels = isPlainObject(existing?.channels) ? existing.channels : {};
    const existingThrottle =
      typeof existing?.throttle === "undefined" ? undefined : existing.throttle;

    const $set = {};

    // ✅ filters: merge ואז normalize
    if (isPlainObject(req.body.filters)) {
      const merged = { ...existingFilters, ...req.body.filters };
      $set.filters = normalizeFiltersInput(merged);
    }

    // channels: אם נשלח — החלף (אפשר גם לעשות merge אם אתה רוצה)
    if (typeof req.body.channels !== "undefined") {
      $set.channels = isPlainObject(req.body.channels) ? req.body.channels : {};
    }

    // throttle
    if (typeof req.body.throttle !== "undefined") {
      $set.throttle = toIntOrUndef(req.body.throttle);
    }

    // אם לא נשלח כלום אבל אין doc עדיין — תייצר אחד מינימלי
    if (Object.keys($set).length === 0) {
      return res.status(400).json({ ok: false, error: "No fields to update" });
    }

    // אם אין מסמך קיים, אבל PATCH שלח רק channels/throttle בלי filters:
    // נשמור filters קיימים (ריקים) בצורה מנורמלת, כדי שהסכמה תהיה עקבית
    if (!existing && !$set.filters) {
      $set.filters = normalizeFiltersInput(existingFilters);
      if (typeof $set.channels === "undefined") $set.channels = existingChannels;
      if (typeof $set.throttle === "undefined") $set.throttle = existingThrottle;
    }

    const item = await UserFilter.findOneAndUpdate(
      { userId },
      { $set },
      { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }
    );

    res.json({ ok: true, item });
  } catch (e) {
    console.error("PATCH /user-filters error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ---------- DELETE /api/user-filters (של המשתמש המחובר) ---------- */
router.delete("/", async (req, res) => {
  try {
    const userId = String(req.user._id);

    const result = await UserFilter.findOneAndDelete({ userId });
    if (!result) return res.status(404).json({ ok: false, error: "User filter not found" });

    res.json({ ok: true, deleted: result });
  } catch (e) {
    console.error("DELETE /user-filters error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

export default router;
