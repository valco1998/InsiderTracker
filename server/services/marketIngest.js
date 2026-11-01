import MarketSnapshotItem from "../models/MarketSnapshotItem.model.js";

// יציבות ב-id
function getId(it) {
  return String(it?.itemId ?? it?.item_id ?? it?.id ?? "");
}

function normNumber(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

export function normalizeMarketItem(it) {
  const itemId = getId(it);
  const name = it?.name ?? it?.market_name ?? it?.marketName ?? it?.market_hash_name ?? "";

  const priceCoins = Number.isFinite(Number(it?.priceCoins))
    ? Number(it.priceCoins)
    : Number.isFinite(Number(it?.priceCents))
      ? Number(it.priceCents) / 100
      : Number.isFinite(Number(it?.price))
        ? Number(it.price)
        : 0;

  const suggestedCoins = Number.isFinite(Number(it?.suggestedCoins))
    ? Number(it.suggestedCoins)
    : Number.isFinite(Number(it?.suggestedCents))
      ? Number(it.suggestedCents) / 100
      : priceCoins;

  const priceCents = Number.isFinite(Number(it?.priceCents))
    ? Number(it.priceCents)
    : Math.round(priceCoins * 100);

  const suggestedCents = Number.isFinite(Number(it?.suggestedCents))
    ? Number(it.suggestedCents)
    : Math.round(suggestedCoins * 100);

  const discountPct = normNumber(it?.discountPct, 0);

  const image =
    it?.image ||
    it?.icon ||
    it?.icon_url ||
    it?.iconUrl ||
    it?.image_url ||
    "";

  const category = it?.category ?? it?.type ?? "";
  const type = it?.type ?? "";

  return {
    itemId,
    name,
    market_hash_name: it?.market_hash_name ?? "",
    type,
    category,
    image,
    priceCoins,
    priceCents,
    suggestedCoins,
    suggestedCents,
    discountPct,
  };
}

/**
 * upsert batch:
 * - אם קיים: מעדכן שדות + lastSeenAt + seenCount++
 * - אם חדש: יוצר עם firstSeenAt/lastSeenAt
 */
export async function upsertMarketBatch(rawItems = []) {
  const ops = [];

  for (const it of rawItems) {
    const n = normalizeMarketItem(it);
    if (!n.itemId) continue;

    ops.push({
      updateOne: {
        filter: { itemId: n.itemId },
        update: {
          $set: { ...n, lastSeenAt: new Date() },
          $setOnInsert: { firstSeenAt: new Date() },
          $inc: { seenCount: 1 },
        },
        upsert: true,
      },
    });
  }

  if (!ops.length) return { upserted: 0, matched: 0 };

  const r = await MarketSnapshotItem.bulkWrite(ops, { ordered: false });
  return {
    upserted: r.upsertedCount ?? 0,
    matched: r.matchedCount ?? 0,
    modified: r.modifiedCount ?? 0,
  };
}
