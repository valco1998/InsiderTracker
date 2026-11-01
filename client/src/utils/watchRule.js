export const WEAR_OPTIONS = [
  "Factory New",
  "Minimal Wear",
  "Field-Tested",
  "Well-Worn",
  "Battle-Scarred",
];

function cleanDisplayText(v = "") {
  return String(v || "")
    .replace(/^★\s*/u, "")
    .replace(/^StatTrak™\s*/i, "")
    .replace(/^StatTrak\*\s*/i, "")
    .replace(/^Souvenir\s*/i, "")
    .trim();
}

export function buildSteamImage(icon = "") {
  const value = String(icon || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  return `https://community.cloudflare.steamstatic.com/economy/image/${value}/360fx360f`;
}

export function extractItemImage(item = {}) {
  return (
    item?.image ||
    item?.iconUrl ||
    item?.icon ||
    item?.img ||
    buildSteamImage(item?.icon_url) ||
    ""
  );
}

export function parseMarketName(full = "") {
  const value = cleanDisplayText(full);

  if (!value) {
    return {
      weapon: "",
      skin: "",
      wear: "",
      baseName: "",
      marketHashName: "",
    };
  }

  const parts = value.split("|");
  const weapon = cleanDisplayText(parts[0] || "");
  const rest = cleanDisplayText(parts.slice(1).join("|"));

  const wearMatch = rest.match(
    /\((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)\s*$/i
  );

  const wear = wearMatch ? wearMatch[1] : "";
  const skin = cleanDisplayText(wear ? rest.replace(wearMatch[0], "") : rest);

  const baseName = weapon && skin ? `${weapon} | ${skin}` : value;

  return {
    weapon,
    skin,
    wear,
    baseName,
    marketHashName: value,
  };
}

export function buildMarketHashName(baseName = "", wear = "") {
  const base = cleanDisplayText(baseName);
  const w = cleanDisplayText(wear);

  if (!base) return "";
  if (!w) return base;

  return `${base} (${w})`;
}

export function normalizeForSearch(v = "") {
  return cleanDisplayText(v)
    .toLowerCase()
    .replace(/[™®]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const STATTRAK_RE = /^StatTrak™?\s*/i;

/**
 * Client-side mirror of server/services/watchMatcher.js's extractVariant().
 * Kept as a small, independent, dependency-free detector rather than
 * importing server code into the React client — must stay in sync with that
 * file's semantics if Empire's naming format ever changes.
 *
 * MUST run on the raw name before cleanDisplayText()/parseMarketName()
 * strip the StatTrak/Souvenir qualifier text — once stripped, the name can
 * no longer be classified. ★ is a rarity marker (knives/gloves), never a
 * variant signal, and is stripped first before checking StatTrak/Souvenir.
 */
export function detectWatchVariant(rawName = "") {
  const withoutStar = String(rawName || "").trim().replace(/^★\s*/u, "");

  if (
    /^StatTrak™\s*/i.test(withoutStar) ||
    /^StatTrak\*\s*/i.test(withoutStar) ||
    /^StatTrak\s+/i.test(withoutStar)
  ) {
    return "STATTRAK";
  }

  if (/^Souvenir\s*/i.test(withoutStar)) {
    return "SOUVENIR";
  }

  return "NORMAL";
}

/* Derive a rarity object from the CSGOEmpire "type" string ("Covert Rifle", "★ Covert Knife", etc.) */
function rarityFromType(typeStr) {
  const t = String(typeStr || "").toLowerCase();
  if (t.includes("covert"))        return { name: "Covert",           color: "#eb4b4b" };
  if (t.includes("classified"))    return { name: "Classified",       color: "#d32ce6" };
  if (t.includes("restricted"))    return { name: "Restricted",       color: "#8847ff" };
  if (t.includes("mil-spec"))      return { name: "Mil-Spec Grade",   color: "#4b69ff" };
  if (t.includes("industrial"))    return { name: "Industrial Grade", color: "#5e98d9" };
  if (t.includes("consumer"))      return { name: "Consumer Grade",   color: "#b0c3d9" };
  if (t.includes("extraordinary")) return { name: "Extraordinary",    color: "#d2701b" };
  if (t.includes("contraband"))    return { name: "Contraband",       color: "#e4ae33" };
  return null;
}

export function uniqueSkinSuggestions(items = []) {
  const map = new Map();

  for (const item of items) {
    const rawName = item?.market_hash_name || item?.market_name || item?.name || "";
    if (!rawName) continue;

    // Detect StatTrak before cleanDisplayText strips it. Kept exactly as
    // before (TradePage.jsx / SearchTradesTab.jsx read `isStatTrak` and
    // `fullName` directly for Trade Board post construction — unchanged).
    const isStatTrak = STATTRAK_RE.test(rawName.trim());
    // Full NORMAL/STATTRAK/SOUVENIR classification, computed independently
    // and additively for Watchlist variant persistence (Phase 4C). ANY is
    // never returned here — ANY is a user rule choice, not a listing fact.
    const variant = detectWatchVariant(rawName);

    const parsed = parseMarketName(rawName);
    if (!parsed.baseName) continue;

    const weapon = parsed.weapon || "";
    const skin   = parsed.skin || (parsed.baseName.includes(" | ")
      ? parsed.baseName.split(" | ").slice(1).join(" | ")
      : "");

    // Key separates NORMAL / STATTRAK / SOUVENIR so all three appear as
    // distinct suggestions instead of collapsing onto one another.
    const key = `${variant}\x00${normalizeForSearch(parsed.baseName)}`;

    if (!map.has(key)) {
      map.set(key, {
        baseName:   parsed.baseName,
        fullName:   isStatTrak ? `StatTrak™ ${parsed.baseName}` : parsed.baseName,
        weapon,
        skin,
        isStatTrak,
        variant,
        image:    extractItemImage(item),
        rarity:   item?.rarity ?? rarityFromType(item?.type ?? item?.category ?? "") ?? null,
        type:     item?.type ?? item?.category ?? "",
        wearName: item?.wear_name ?? item?.wearName ?? "",
      });
    }
  }

  return Array.from(map.values()).sort((a, b) => {
    if (a.baseName === b.baseName) return a.isStatTrak ? 1 : -1;
    return a.baseName.localeCompare(b.baseName);
  });
}