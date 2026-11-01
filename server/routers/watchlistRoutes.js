import { Router } from "express";
import protectRoute from "../middelware/protectRoute.js";
import WatchRule from "../models/WatchRule.model.js";
import { invalidateRuleCache } from "../jobs/alertEngine.js";
import { invalidateLiveRuleCache } from "../controllers/alerts.controller.js";

const router = Router();

const VALID_VARIANTS = ["NORMAL", "STATTRAK", "SOUVENIR", "ANY"];

// Returns the canonical uppercase variant to persist, or undefined to mean
// "omit the field" (legacy-compatible — must NEVER become "NORMAL"). Throws
// only via the caller's own 400 response; this function itself never throws.
function resolveVariantOrUndefined(variant) {
  if (variant === undefined || variant === null || variant === "") {
    return { ok: true, value: undefined };
  }
  if (typeof variant !== "string") {
    return { ok: false };
  }
  const normalized = variant.trim().toUpperCase();
  if (!VALID_VARIANTS.includes(normalized)) {
    return { ok: false };
  }
  return { ok: true, value: normalized };
}

router.get("/", protectRoute, async (req, res) => {
  try {
    const items = await WatchRule.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .lean();

    res.json({ ok: true, items });
  } catch (err) {
    console.error("GET /watch error:", err);
    res.status(500).json({ ok: false, error: "Failed to load watch rules" });
  }
});

router.post("/", protectRoute, async (req, res) => {
  try {
    const userId = req.user._id;

    const {
      baseName,
      wear,
      marketHashName,
      weapon,
      skin,
      image,
      appId,
      targetPrice,
      minDiscountPct,
      cooldownMin,
      variant,
    } = req.body;

    if (!baseName || !wear) {
      return res.status(400).json({ ok: false, error: "baseName + wear required" });
    }

    const resolvedVariant = resolveVariantOrUndefined(variant);
    if (!resolvedVariant.ok) {
      return res.status(400).json({ ok: false, error: "Invalid variant" });
    }

    const createPayload = {
      userId,
      baseName: String(baseName).trim(),
      wear: String(wear).trim(),
      marketHashName: String(marketHashName || "").trim() || `${baseName} (${wear})`,
      weapon: String(weapon || "").trim(),
      skin: String(skin || "").trim(),
      image: String(image || "").trim(),
      appId: Number(appId) || 730,
      targetPrice:
        targetPrice === "" || targetPrice === null || targetPrice === undefined
          ? null
          : Number(targetPrice),
      minDiscountPct:
        minDiscountPct === "" || minDiscountPct === null || minDiscountPct === undefined
          ? null
          : Number(minDiscountPct),
      cooldownMin:
        cooldownMin === "" || cooldownMin === null || cooldownMin === undefined
          ? 5
          : Number(cooldownMin),
    };
    // Only ever set the key when a valid, explicit variant was sent — an
    // omitted/legacy request must leave the field genuinely absent, never
    // default to "NORMAL" or any other value.
    if (resolvedVariant.value !== undefined) {
      createPayload.variant = resolvedVariant.value;
    }

    const doc = await WatchRule.create(createPayload);

    res.json({ ok: true, item: doc });
    invalidateRuleCache();
    invalidateLiveRuleCache();
  } catch (err) {
    console.error("POST /watch error:", err);
    res.status(500).json({ ok: false, error: "Failed to create watch rule" });
  }
});

router.delete("/:id", protectRoute, async (req, res) => {
  try {
    const result = await WatchRule.deleteOne({
      _id: req.params.id,
      userId: req.user._id,
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        ok: false,
        error: "Watch rule not found or not yours",
      });
    }

    res.json({
      ok: true,
      deleted: result.deletedCount,
    });
    invalidateRuleCache();
    invalidateLiveRuleCache();
  } catch (err) {
    console.error("DELETE /watch/:id error:", err);
    res.status(500).json({ ok: false, error: "Failed to delete watch rule" });
  }
});

export default router;