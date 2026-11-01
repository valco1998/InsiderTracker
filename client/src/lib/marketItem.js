function parseFiniteNumber(value) {
  if (value === null || value === undefined) return null;

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;

    const normalized = trimmed.replace(",", ".");
    const num = Number(normalized);
    return Number.isFinite(num) ? num : null;
  }

  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export function formatCoins(value) {
  const num = parseFiniteNumber(value);
  if (num === null) return "0";

  return num.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export function formatUsd(value) {
  const num = parseFiniteNumber(value);
  if (num === null || num <= 0) return null;

  return num.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatFloat(value) {
  const num = parseFiniteNumber(value);
  if (num === null || num < 0 || num > 1) return null;
  return num.toFixed(3);
}

export function normalizeWearKey(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function slugify(name = "") {
  return String(name || "")
    .toLowerCase()
    .replace(/\((.*?)\)/g, "")
    .replace(/\|/g, " ")
    .replace(/[™®']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function getBaseName(name = "") {
  return String(name || "").replace(/\s*\(([^)]+)\)\s*$/, "").trim();
}

export function getWearFromName(name = "") {
  const match = String(name || "").match(/\(([^)]+)\)\s*$/);
  return match ? match[1].trim() : "";
}

export function getItemType(name = "") {
  const left = String(name || "").split("|")[0]?.trim();
  return left || "";
}

export function getCollection(item = {}) {
  return (
    item?.collection ||
    item?.collectionName ||
    item?.set ||
    item?.setName ||
    ""
  );
}

export function shouldHaveWear(item = {}) {
  const text = `${item?.name || ""} ${item?.type || ""}`.toLowerCase();

  const blocked = [
    "sticker",
    "graffiti",
    "music kit",
    "case",
    "key",
    "capsule",
    "patch",
    "charm",
    "agent",
    "souvenir package",
    "tool",
    "tag",
  ];

  return !blocked.some((word) => text.includes(word));
}

function extractTextWearCandidate(value) {
  if (value === null || value === undefined) return "";

  const num = parseFiniteNumber(value);
  if (num !== null && num >= 0 && num <= 1) {
    return "";
  }

  const text = String(value).trim();
  if (!text) return "";

  return text;
}

function normalizeSticker(sticker = {}) {
  if (!sticker || typeof sticker !== "object") return null;

  const image =
    sticker?.icon_url ||
    sticker?.image ||
    sticker?.url ||
    sticker?.iconUrl ||
    sticker?.img ||
    "";

  const name =
    sticker?.name ||
    sticker?.market_name ||
    sticker?.market_hash_name ||
    sticker?.label ||
    "";

  if (!image && !name) return null;

  return {
    ...sticker,
    icon_url: image,
    name,
  };
}

function dedupeStickers(stickers = []) {
  const seen = new Set();
  const result = [];

  for (const sticker of stickers) {
    const normalized = normalizeSticker(sticker);
    if (!normalized) continue;

    const key = `${normalized.name}__${normalized.icon_url}`;
    if (seen.has(key)) continue;

    seen.add(key);
    result.push(normalized);
  }

  return result;
}

function extractStickers(raw = {}) {
  const directSources = [
    raw?.stickers,
    raw?.asset?.stickers,
    raw?.item?.stickers,
    raw?.extra?.stickers,
  ];

  for (const source of directSources) {
    if (Array.isArray(source) && source.length) {
      return dedupeStickers(source);
    }
  }

  if (Array.isArray(raw?.assets)) {
    const fromAssets = raw.assets.flatMap((asset) =>
      Array.isArray(asset?.stickers) ? asset.stickers : []
    );

    if (fromAssets.length) {
      return dedupeStickers(fromAssets);
    }
  }

  if (Array.isArray(raw?.item?.assets)) {
    const fromItemAssets = raw.item.assets.flatMap((asset) =>
      Array.isArray(asset?.stickers) ? asset.stickers : []
    );

    if (fromItemAssets.length) {
      return dedupeStickers(fromItemAssets);
    }
  }

  return [];
}

export function getFloatValue(item = {}) {
  if (!shouldHaveWear(item)) return null;

  const candidates = [
    item?.float,
    item?.wearValue,
    item?.floatValue,
    item?.paint_wear,
    item?.paintWear,
    item?.wear_value,
    item?.wear,
  ];

  for (const candidate of candidates) {
    const num = parseFiniteNumber(candidate);
    if (num === null) continue;
    if (num < 0 || num > 1) continue;
    return num;
  }

  return null;
}

export function wearFromFloat(floatValue) {
  const f = parseFiniteNumber(floatValue);
  if (f === null || f < 0 || f > 1) return "";

  if (f < 0.07) return "Factory New";
  if (f < 0.15) return "Minimal Wear";
  if (f < 0.38) return "Field-Tested";
  if (f < 0.45) return "Well-Worn";
  return "Battle-Scarred";
}

export function getWear(item = {}) {
  const directCandidates = [
    item?.wear_name,
    item?.exterior,
    item?.condition,
    item?.conditionName,
    item?.wear,
  ];

  for (const candidate of directCandidates) {
    const textWear = extractTextWearCandidate(candidate);
    if (textWear) return textWear;
  }

  const fromName = getWearFromName(item?.name || "");
  if (fromName) return fromName;

  if (!shouldHaveWear(item)) return "";

  return wearFromFloat(getFloatValue(item));
}

export function getExactReferenceUsd(item = {}, wear = "") {
  const exactWear = normalizeWearKey(wear);

  const sources = [
    item?.referenceUsdByWear,
    item?.analystUsdByWear,
    item?.steamAnalystByWear,
    item?.externalUsdByWear,
    item?.pricesByWear,
    item?.wearPrices,
  ].filter(Boolean);

  if (exactWear) {
    for (const source of sources) {
      if (typeof source !== "object" || source === null) continue;

      for (const [key, rawValue] of Object.entries(source)) {
        if (normalizeWearKey(key) !== exactWear) continue;

        const value =
          typeof rawValue === "object" && rawValue !== null
            ? rawValue.usd ??
            rawValue.priceUsd ??
            rawValue.referenceUsd ??
            rawValue.value
            : rawValue;

        const num = parseFiniteNumber(value);
        if (num !== null && num > 0) {
          return {
            usd: num,
            isExactWearMatch: true,
          };
        }
      }
    }
  }

  const fallback =
    item?.referenceUsd ??
    item?.analystUsd ??
    item?.steamAnalystUsd ??
    item?.referencePriceUsd ??
    item?.analystPriceUsd ??
    item?.priceUsd ??
    item?.suggested_price ??
    item?.suggestedPrice ??
    item?.market_value ??
    null;

  const num = parseFiniteNumber(fallback);

  return {
    usd: num !== null && num > 0 ? num : null,
    isExactWearMatch: false,
  };
}

export function normalizeItem(raw = {}) {
  const name =
    raw?.name ||
    raw?.market_name ||
    raw?.market_hash_name ||
    raw?.fullName ||
    raw?.item_name ||
    "";

  const image =
    raw?.image ||
    raw?.image_url ||
    raw?.icon_url ||
    raw?.iconUrl ||
    raw?.asset_image ||
    raw?.preview_image ||
    "";

  const priceCoins =
    raw?.priceCoins != null
      ? parseFiniteNumber(raw.priceCoins)
      : raw?.price != null
        ? (parseFiniteNumber(raw.price) ?? 0) / 100
        : raw?.market_value != null
          ? (parseFiniteNumber(raw.market_value) ?? 0) / 100
          : raw?.current_price != null
            ? (parseFiniteNumber(raw.current_price) ?? 0) / 100
            : 0;

  const suggestedCoins =
    raw?.suggestedCoins != null
      ? parseFiniteNumber(raw.suggestedCoins)
      : raw?.suggested_price != null
        ? (parseFiniteNumber(raw.suggested_price) ?? 0) / 100
        : raw?.suggestedPrice != null
          ? (parseFiniteNumber(raw.suggestedPrice) ?? 0) / 100
          : raw?.marketValue != null
            ? (parseFiniteNumber(raw.marketValue) ?? 0) / 100
            : 0;

  const explicitDiscount =
    parseFiniteNumber(raw?.discountPct) ?? parseFiniteNumber(raw?.discount);

  const discountPct =
    explicitDiscount !== null
      ? explicitDiscount
      : suggestedCoins > 0 && priceCoins > 0
        ? Math.round(((suggestedCoins - priceCoins) / suggestedCoins) * 100)
        : 0;

  const type = raw?.type || getItemType(name);
  const collection = getCollection(raw);
  const stickers = extractStickers(raw);

  const base = {
    ...raw,
    itemId: raw?.itemId || raw?.id || raw?._id || name,
    name,
    image,
    type,
    collection,
    priceCoins: Number.isFinite(priceCoins) ? priceCoins : 0,
    suggestedCoins: Number.isFinite(suggestedCoins) ? suggestedCoins : 0,
    discountPct: Number.isFinite(discountPct) ? discountPct : 0,
    marketUrl: raw?.marketUrl || raw?.url || raw?.itemUrl || "",
    stickers,
  };

  const floatValue = getFloatValue(base);

  const normalized = {
    ...base,
    float: floatValue,
  };

  return {
    ...normalized,
    wear: getWear(normalized),
  };

}

export function extractMarketItems(payload) {
  if (Array.isArray(payload)) return payload;

  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.results)) return payload.results;

  if (Array.isArray(payload?.data?.items)) return payload.data.items;
  if (Array.isArray(payload?.data?.data)) return payload.data.data;
  if (Array.isArray(payload?.payload?.items)) return payload.payload.items;

  return [];
}