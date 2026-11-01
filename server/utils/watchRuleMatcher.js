export function parseMarketName(full = "") {
  const value = String(full || "").trim();
  if (!value) {
    return {
      weapon: "",
      skin: "",
      wear: "",
      baseName: "",
      marketHashName: "",
    };
  }

  const cleaned = value
    .replace(/^StatTrak™\s*/i, "")
    .replace(/^StatTrak\*\s*/i, "")
    .replace(/^Souvenir\s*/i, "")
    .trim();

  const parts = cleaned.split("|");
  const weapon = parts[0]?.trim() || "";
  const rest = parts.slice(1).join("|").trim();

  const wearMatch = rest.match(
    /\((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)\s*$/i
  );

  const wear = wearMatch ? wearMatch[1] : "";
  const skin = wear ? rest.replace(wearMatch[0], "").trim() : rest;
  const baseName = weapon && skin ? `${weapon} | ${skin}` : cleaned;

  return {
    weapon,
    skin,
    wear,
    baseName,
    marketHashName: cleaned,
  };
}

export function calcDiscountPct(price, marketPrice) {
  const p = Number(price);
  const m = Number(marketPrice);

  if (!Number.isFinite(p) || !Number.isFinite(m) || m <= 0) return null;
  return ((m - p) / m) * 100;
}

export function canNotify(rule) {
  if (!rule?.lastNotifiedAt) return true;

  const cooldownMin = Number(rule.cooldownMin ?? 5);
  const elapsed = Date.now() - new Date(rule.lastNotifiedAt).getTime();

  return elapsed >= cooldownMin * 60_000;
}

export function buildItemKey(item) {
  return String(
    item?.itemId ||
      item?.id ||
      item?.listingId ||
      item?.assetId ||
      item?.market_hash_name ||
      item?.name ||
      ""
  );
}

export function doesItemMatchRule(item, rule) {
  const parsed = parseMarketName(item?.market_hash_name || item?.name || "");

  if (!parsed.baseName || !parsed.wear) return false;
  if (parsed.baseName !== rule.baseName) return false;
  if (parsed.wear !== rule.wear) return false;

  const priceCoins = Number(item?.priceCoins ?? item?.price ?? 0);
  const suggestedCoins = Number(
    item?.suggestedCoins ?? item?.suggestedPrice ?? item?.marketPrice ?? 0
  );

  if (typeof rule?.targetPrice === "number" && priceCoins > rule.targetPrice) {
    return false;
  }

  if (typeof rule?.minDiscountPct === "number") {
    const pct = calcDiscountPct(priceCoins, suggestedCoins);
    if (pct === null || pct < rule.minDiscountPct) {
      return false;
    }
  }

  return true;
}