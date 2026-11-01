/* ─── CS2 weapon → category map ─────────────────────── */
const WEAPON_CATEGORY = {
  // Rifles
  "ak-47":"rifle","m4a4":"rifle","m4a1-s":"rifle","famas":"rifle","galil ar":"rifle",
  "sg 553":"rifle","aug":"rifle",
  // Snipers
  "awp":"sniper","scar-20":"sniper","g3sg1":"sniper","ssg 08":"sniper",
  // Pistols
  "desert eagle":"pistol","glock-18":"pistol","usp-s":"pistol","p250":"pistol",
  "five-seven":"pistol","tec-9":"pistol","cz75-auto":"pistol","r8 revolver":"pistol",
  "dual berettas":"pistol","p2000":"pistol",
  // SMGs
  "mp9":"smg","mac-10":"smg","mp5-sd":"smg","ump-45":"smg","p90":"smg",
  "mp7":"smg","pp-bizon":"smg",
  // Shotguns
  "nova":"shotgun","xm1014":"shotgun","sawed-off":"shotgun","mag-7":"shotgun",
  // Heavy
  "m249":"heavy","negev":"heavy",
  // Knives
  "karambit":"knife","butterfly knife":"knife","m9 bayonet":"knife","bayonet":"knife",
  "gut knife":"knife","flip knife":"knife","huntsman knife":"knife","falchion knife":"knife",
  "shadow daggers":"knife","bowie knife":"knife","ursus knife":"knife",
  "navaja knife":"knife","stiletto knife":"knife","talon knife":"knife",
  "classic knife":"knife","paracord knife":"knife","survival knife":"knife",
  "nomad knife":"knife","skeleton knife":"knife","kukri knife":"knife",
  "stiletto knife":"knife","broken fang knife":"knife",
  // Gloves
  "sport gloves":"gloves","specialist gloves":"gloves","driver gloves":"gloves",
  "hand wraps":"gloves","moto gloves":"gloves","bloodhound gloves":"gloves",
  "hydra gloves":"gloves","broken fang gloves":"gloves",
};

/* ─── Helpers ────────────────────────────────────────── */

function stripWear(mhn) {
  return String(mhn || "")
    .replace(/\s*\((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)\s*$/i, "")
    .trim()
    .toLowerCase();
}

function extractWearFromName(mhn) {
  const m = String(mhn || "").match(/\((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)$/i);
  return m ? m[1].toLowerCase() : null;
}

function getExterior(item) {
  if (item.exterior) return String(item.exterior).toLowerCase().trim();
  return extractWearFromName(item.marketHashName || item.name || "");
}

function extractWeapon(baseName) {
  const pipe = baseName.indexOf(" | ");
  return pipe > -1 ? baseName.slice(0, pipe).trim() : baseName;
}

function extractCategory(baseName) {
  return WEAPON_CATEGORY[extractWeapon(baseName)] || "other";
}

/* ─── Per-item score 0-100 ───────────────────────────── */

function scoreItemMatch(wantedItem, invItem) {
  const wantedBase = stripWear(wantedItem.marketHashName || wantedItem.name || "");
  const invBase    = stripWear(invItem.marketHashName    || invItem.name    || "");

  if (!wantedBase || !invBase) return 0;

  // Special "any" wanted items
  if (wantedItem.isSpecial) {
    const sn = (wantedItem.name || wantedItem.marketHashName || "").toLowerCase();
    if (sn === "any offers") return 10;
    const invCat = extractCategory(invBase);
    if (sn === "any knife"  && invCat === "knife")           return 20;
    if (sn === "any key"    && invBase.includes("key"))       return 15;
    if (sn === "any case"   && invBase.includes("case"))      return 15;
    return 5;
  }

  if (wantedBase === invBase) {
    const wantedExt = getExterior(wantedItem);
    const invExt    = getExterior(invItem);
    // Exact skin — wear matches OR they didn't specify a wear
    if (!wantedExt || wantedExt === invExt) return 100;
    // Same skin, different wear
    return 75;
  }

  // Same weapon type (e.g. both AK-47 but different skins)
  const ww = extractWeapon(wantedBase);
  const iw = extractWeapon(invBase);
  if (ww && ww === iw) return 45;

  // Same category (knife, rifle, pistol, …)
  const wc = extractCategory(wantedBase);
  const ic = extractCategory(invBase);
  if (wc !== "other" && wc === ic) return 25;

  return 0;
}

/* ─── Public API ─────────────────────────────────────── */

export const MATCH_TIERS = {
  exact:    { label: "Exact Match",    color: "#4ade80", bg: "rgba(74,222,128,0.13)",  border: "rgba(74,222,128,0.30)"  },
  similar:  { label: "Similar Skin",   color: "#c084fc", bg: "rgba(168,85,247,0.13)", border: "rgba(168,85,247,0.30)"  },
  weapon:   { label: "Same Weapon",    color: "#60a5fa", bg: "rgba(96,165,250,0.12)",  border: "rgba(96,165,250,0.28)"  },
  category: { label: "Same Category",  color: "#94a3b8", bg: "rgba(148,163,184,0.10)", border: "rgba(148,163,184,0.22)" },
  generic:  { label: "Generic",        color: "#64748b", bg: "rgba(100,116,139,0.08)", border: "rgba(100,116,139,0.16)" },
  none:     { label: "",               color: "transparent", bg: "transparent",         border: "transparent"            },
};

/**
 * Score a trade post against the viewer's inventory.
 * Returns { score, tier, label, matchedItems }
 */
export function scoreTradePost(post, myInventory = []) {
  const wanted = (post.lookingForItems || []);

  if (!wanted.length) {
    return { score: 0, tier: "none", label: "", matchedItems: [] };
  }

  // If they want "Any Offers" check generic special match
  const hasGenericWant = wanted.some(w => w.isSpecial && (w.name || "").toLowerCase() === "any offers");
  if (hasGenericWant) {
    return { score: 10, tier: "generic", label: "Generic", matchedItems: [] };
  }

  if (!myInventory.length) {
    return { score: 0, tier: "none", label: "", matchedItems: [] };
  }

  let bestScore = 0;
  const matchedItems = [];

  for (const wantedItem of wanted) {
    let itemBest = 0;
    let bestInvItem = null;

    for (const invItem of myInventory) {
      const s = scoreItemMatch(wantedItem, invItem);
      if (s > itemBest) { itemBest = s; bestInvItem = invItem; }
    }

    if (itemBest > 0) {
      matchedItems.push({ wanted: wantedItem, have: bestInvItem, score: itemBest });
    }
    if (itemBest > bestScore) bestScore = itemBest;
  }

  let tier;
  if      (bestScore >= 100) tier = "exact";
  else if (bestScore >= 75)  tier = "similar";
  else if (bestScore >= 45)  tier = "weapon";
  else if (bestScore >= 25)  tier = "category";
  else if (bestScore >= 5)   tier = "generic";
  else                       tier = "none";

  return {
    score:        bestScore,
    tier,
    label:        MATCH_TIERS[tier].label,
    matchedItems,
  };
}

/**
 * Score all posts and sort: exact → similar → weapon → category → generic → none,
 * then by recency within each tier.
 */
export function sortedByMatch(posts, myInventory = []) {
  const TIER_ORDER = { exact: 0, similar: 1, weapon: 2, category: 3, generic: 4, none: 5 };

  return posts
    .map(post => {
      const m = scoreTradePost(post, myInventory);
      return { ...post, _matchScore: m.score, _matchTier: m.tier, _matchLabel: m.label, _matchItems: m.matchedItems };
    })
    .sort((a, b) => {
      const ta = TIER_ORDER[a._matchTier] ?? 5;
      const tb = TIER_ORDER[b._matchTier] ?? 5;
      if (ta !== tb) return ta - tb;
      if (b._matchScore !== a._matchScore) return b._matchScore - a._matchScore;
      // Same tier/score: most recent first
      const dateA = new Date(a.bumpedAt || a.createdAt || 0).getTime();
      const dateB = new Date(b.bumpedAt || b.createdAt || 0).getTime();
      return dateB - dateA;
    });
}
