// server/services/alertRules.js

function toNumber(value, fallback = null) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function shouldTriggerAlert({ watch = {}, priceNow, lastPrice }) {
  const currentPrice = toNumber(priceNow);
  const previousPrice = toNumber(lastPrice);

  if (currentPrice === null) {
    return { ok: false };
  }

  const targetPrice = toNumber(watch.targetPrice);
  if (targetPrice !== null && currentPrice <= targetPrice) {
    return {
      ok: true,
      type: "target_price",
      priceNow: currentPrice,
      targetPrice,
    };
  }

  const minDropPct = toNumber(watch.minDropPct);
  if (minDropPct !== null && previousPrice !== null && previousPrice > 0) {
    const dropPct = ((previousPrice - currentPrice) / previousPrice) * 100;

    if (dropPct >= minDropPct) {
      return {
        ok: true,
        type: "drop_pct",
        priceNow: currentPrice,
        lastPrice: previousPrice,
        dropPct: Number(dropPct.toFixed(2)),
        minDropPct,
      };
    }
  }

  const minDropAbs = toNumber(watch.minDropAbs);
  if (minDropAbs !== null && previousPrice !== null) {
    const dropAbs = previousPrice - currentPrice;

    if (dropAbs >= minDropAbs) {
      return {
        ok: true,
        type: "drop_abs",
        priceNow: currentPrice,
        lastPrice: previousPrice,
        dropAbs: Number(dropAbs.toFixed(2)),
        minDropAbs,
      };
    }
  }

  return { ok: false };
}

export function buildAlertPayload({ watch = {}, priceNow, lastPrice, decision = {} }) {
  const currentPrice = toNumber(priceNow, 0);
  const previousPrice = toNumber(lastPrice);
  const safeName = watch.name || watch.marketHashName || "Unknown item";
  const safeItemId = String(
    watch.itemId || watch.marketHashName || watch.baseName || "unknown-item"
  );

  const computedDropPct =
    previousPrice !== null && previousPrice > 0
      ? Number((((previousPrice - currentPrice) / previousPrice) * 100).toFixed(2))
      : null;

  return {
    id: `alert-${Date.now()}-${safeItemId}`,
    userId: watch.userId,
    ruleId: watch.ruleId || watch._id || null,
    itemId: safeItemId,
    name: safeName,
    marketHashName: watch.marketHashName || safeName,
    image: watch.image || "",
    priceNow: currentPrice,
    lastPrice: previousPrice,
    targetPrice: toNumber(watch.targetPrice),
    dropPct: decision.dropPct ?? computedDropPct,
    dropAbs: decision.dropAbs ?? null,
    type: decision.type || "unknown",
    wear: watch.wear || "",
    createdAt: new Date().toISOString(),
  };
}

export function makeDedupeKey({ watch = {}, decision = {}, priceNow, lastPrice }) {
  const safeType = decision.type || "unknown";
  const safeItemId = String(
    watch.itemId || watch.marketHashName || watch.baseName || "unknown-item"
  );
  const currentPrice = toNumber(priceNow, "na");
  const previousPrice = toNumber(lastPrice, "na");

  return `${safeType}:${safeItemId}:${currentPrice}:${previousPrice}`;
}