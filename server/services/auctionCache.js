// server/services/auctionCache.js
// In-memory auction cache fed exclusively by websocket events.
// No HTTP requests are made from this module.

import { getAllFromCache as getAllMarketItems } from "./marketCache.js";

const MAX_ITEMS           = Number(process.env.AUCTION_CACHE_MAX || 2000);
const CLEANUP_INTERVAL_MS = 60_000;

// itemId (string) → normalized auction item
let auctions     = new Map();
let cleanupTimer = null;

/* ─── Helpers ─────────────────────────────────────── */

function now() { return Date.now(); }

function getId(raw) {
  return String(raw?.itemId ?? raw?.item_id ?? raw?.id ?? "");
}

function buildSteamImage(icon) {
  const s = String(icon || "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  return `https://community.cloudflare.steamstatic.com/economy/image/${s}/360fx360f`;
}

// Resolve the best available image across all known sources, preserving any
// previously-cached image when a bid-update event arrives without image data.
function resolveImage(raw, existingItem) {
  // 1. Direct image fields on the incoming item
  const directFields = [
    raw?.image,
    raw?.image_url,
    raw?.icon_url,
    raw?.iconUrl,
    raw?.icon,
    raw?.img,
    // Some WS events nest the icon under an asset object
    raw?.asset?.icon_url,
    raw?.asset?.image,
  ];

  for (const c of directFields) {
    const s = String(c || "").trim();
    if (s) return buildSteamImage(s);
  }

  // 2. Preserve whatever we already stored for this item
  if (existingItem?.image) return existingItem.image;

  // 3. Scan the market cache by itemId  ─ items from new_item / updated_item
  //    WS events are normalised there and often carry the full image URL.
  const id = getId(raw);
  const marketItems = getAllMarketItems(); // single call, no repeat allocation

  if (id) {
    for (const it of marketItems) {
      const itId = String(it?.itemId ?? it?.id ?? "");
      if (itId === id && it?.image) return it.image;
    }
  }

  // 4. Fallback: match by market_hash_name — useful when the WS auction event
  //    uses a different id than the market listing event.
  const hashName = (
    raw?.market_hash_name ??
    raw?.marketHashName ??
    raw?.market_name ??
    raw?.name ??
    ""
  ).trim().toLowerCase();

  if (hashName && hashName !== "unknown item") {
    for (const it of marketItems) {
      const itHash = String(
        it?.market_hash_name ?? it?.marketHashName ?? it?.market_name ?? it?.name ?? ""
      ).trim().toLowerCase();
      if (itHash === hashName && it?.image) return it.image;
    }
  }

  return "";
}

// Resolve the best available name, trying all known aliases.
function resolveName(raw, existingItem) {
  const candidates = [
    raw?.market_name,
    raw?.name,
    raw?.marketName,
    raw?.market_hash_name,
    raw?.marketHashName,
    existingItem?.name,
    existingItem?.market_hash_name,
  ];

  for (const c of candidates) {
    const s = String(c || "").trim();
    if (s && s.toLowerCase() !== "unknown item") return s;
  }

  // Last resort: look up name from market cache by itemId
  const id = getId(raw);
  if (id) {
    for (const it of getAllMarketItems()) {
      const itId = String(it?.itemId ?? it?.id ?? "");
      if (itId === id && it?.name) return it.name;
    }
  }

  return "";
}

const KNIFE_RE =
  /karambit|bayonet|butterfly|daggers|shadow daggers|ursus|stiletto|talon|navaja|gut|falchion|bowie|huntsman|m9|classic knife|\bknife\b/i;

function computeCategory(raw) {
  const name  = String(raw?.market_name ?? raw?.name ?? "");
  const type  = String(raw?.type ?? "").toLowerCase();
  const lname = name.toLowerCase();

  if (name.includes("★") || KNIFE_RE.test(name) || type.includes("knife")) return "knife";
  if (lname.includes("glove") || lname.includes("wraps"))                   return "gloves";
  if (type.includes("rifle")  || lname.includes("ak-47") || lname.includes("m4a")) return "rifle";
  if (type.includes("pistol") || lname.includes("glock") || lname.includes("usp")) return "pistol";
  if (type.includes("smg"))                                                  return "smg";
  if (type.includes("sniper") || lname.includes("awp"))                     return "sniper";
  if (type.includes("sticker") || lname.startsWith("sticker |"))            return "sticker";
  return "other";
}

// Empire sends prices as integers in cents (e.g. 28 → 0.28 coins).
function toCents(v) {
  if (v == null) return 0;
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  if (Number.isInteger(n)) return n;
  return Math.round(n * 100);
}

// Next valid bid on Empire, in coincents: exactly 1% above the previous bid,
// rounded half away from zero, minimum increment 1 coincent (Place Bid docs).
// Integer arithmetic — no floating-point rounding error.
export function nextBidCents(highestBidCents) {
  const h = Math.round(Number(highestBidCents));
  return Math.max(h + 1, Math.floor((h * 101 + 50) / 100));
}

function normalizeAuction(raw, existing) {
  const name = resolveName(raw, existing);
  const image = resolveImage(raw, existing);

  // ── Price contract (all amounts in Empire coincents, 100 = 1 coin) ─────────
  // priceCoins = the ACTIONABLE price: what a user must pay on Empire now.
  //   • highest bid H known → next valid bid = max(H + 1, round½↑(H × 1.01)).
  //     Empire docs (Place Bid): "exactly 1% above the previous bid, if any.
  //     The minimum increment is 1 coincent … rounding … half away from zero."
  //     Matches the documented updated_item example (H 72967 → purchase_price 73697).
  //   • no bids → the listing's starting price (purchase_price; REST priceCents).
  //   • bids exist, H unknown → purchase_price from this same event only.
  //   • anything else → estimate (priceIsEstimate = true) — never used for
  //     profit alerts.
  // currentBidCoins = the highest bid itself (null = no bids), kept separately.

  // Out-of-order guard: an event reporting fewer bids than already cached is
  // older than what we have — keep the cached bid state.
  const incomingBids = raw?.auction_number_of_bids ?? raw?.auction?.bids ?? null;
  const existingBids = existing?.auction?.bids ?? null;
  const stale = incomingBids != null && existingBids != null && Number(incomingBids) < Number(existingBids);

  const incomingBid = raw?.auction_highest_bid ?? raw?.auction?.highest_bid;
  const currentBidCents = !stale && incomingBid != null
    ? toCents(incomingBid)
    : (existing?.currentBidCents ?? null);
  const currentBidCoins = currentBidCents != null ? currentBidCents / 100 : null;

  const effectiveBids = stale
    ? Number(existingBids) || 0
    : Number(incomingBids ?? existingBids ?? 0) || 0;

  // Starting/listing price, carried across partial events (it only changes
  // with a new listing event). purchase_price from raw WS/REST, or priceCents
  // from REST-normalized items (auctionWorker) — never `price`, which is in
  // coins on normalized items and ambiguous on raw ones.
  let listPriceCents = existing?.listPriceCents ?? null;
  let listPriceFresh = false;
  if (!stale && raw?.purchase_price != null) {
    listPriceCents = toCents(raw.purchase_price); listPriceFresh = true;
  } else if (!stale && raw?.priceCents != null && Number.isFinite(Number(raw.priceCents))) {
    listPriceCents = Math.round(Number(raw.priceCents)); listPriceFresh = true;
  }

  let priceCents = null;
  let priceSource;
  let priceIsEstimate = false;
  if (currentBidCents != null && currentBidCents > 0) {
    priceCents  = nextBidCents(currentBidCents);
    priceSource = "next_bid";
  } else if (effectiveBids > 0) {
    if (listPriceFresh && listPriceCents != null) {
      priceCents = listPriceCents; priceSource = "purchase_price";
    } else {
      priceCents = listPriceCents ?? (raw?.market_value != null ? toCents(raw.market_value) : null);
      priceSource = "estimate"; priceIsEstimate = true;
    }
  } else if (listPriceCents != null) {
    priceCents = listPriceCents; priceSource = "starting_price";
  } else if (raw?.market_value != null) {
    priceCents = toCents(raw.market_value); priceSource = "estimate"; priceIsEstimate = true;
  } else {
    priceSource = "none"; priceIsEstimate = true;
  }
  const priceCoins = priceCents != null ? priceCents / 100 : 0;

  // Suggested = market reference price: suggested_price (raw) or suggestedCents
  // (REST-normalized), carried from earlier events when absent. Never a price —
  // market_value tracks the highest bid on auctions, so it is not a reference.
  // Unknown → null (no reference → no profit claim).
  const suggestedCents =
    raw?.suggested_price != null ? toCents(raw.suggested_price) :
    raw?.suggestedCents != null && Number.isFinite(Number(raw.suggestedCents)) ? Math.round(Number(raw.suggestedCents)) :
    existing?.suggestedCents ?? null;
  const suggestedCoins = suggestedCents != null ? suggestedCents / 100 : null;

  const discountPct =
    !priceIsEstimate && suggestedCoins > 0 && priceCoins > 0 && priceCoins <= suggestedCoins
      ? Math.round(((suggestedCoins - priceCoins) / suggestedCoins) * 100)
      : 0;

  // Support both flat WS fields and already-normalised nested auction object
  const endsAt =
    raw?.auction_ends_at ??
    raw?.auction?.ends_at ??
    existing?.auction?.ends_at ??
    null;

  const bids = stale
    ? existingBids
    : (raw?.auction_number_of_bids ??
       raw?.auction?.bids ??
       existing?.auction?.bids ??
       0);

  const highestBid = stale
    ? (existing?.auction?.highest_bid ?? null)
    : (raw?.auction_highest_bid ??
       raw?.auction?.highest_bid ??
       existing?.auction?.highest_bid ??
       null);

  // Resolve category key — prefer existing non-"other" value over re-computing
  let categoryKey = computeCategory(raw);
  if (categoryKey === "other" && existing?.categoryKey && existing.categoryKey !== "other") {
    categoryKey = existing.categoryKey;
  }

  return {
    itemId: getId(raw),
    id:     getId(raw),
    name,
    market_hash_name:
      raw?.market_hash_name ?? raw?.market_hash ?? raw?.marketHashName ??
      existing?.market_hash_name ?? name,
    wear:      raw?.wear      ?? existing?.wear      ?? null,
    wear_name: raw?.wear_name ?? raw?.wearName ?? existing?.wear_name ?? null,
    type:      raw?.type      ?? raw?.item_type ?? existing?.type ?? "",
    category:  raw?.category  ?? raw?.kind     ?? existing?.category ?? "",
    categoryKey,
    image,
    priceCoins,
    priceCents,
    priceSource,
    priceIsEstimate,
    currentBidCoins,
    currentBidCents,
    listPriceCents,
    suggestedCoins,
    suggestedCents,
    discountPct,
    paint_wear: raw?.paint_wear ?? raw?.paintWear ?? existing?.paint_wear ?? null,
    auction: {
      enabled:     true,
      ends_at:     endsAt,
      bids:        Number(bids) || 0,
      highest_bid: highestBid,
    },
    // meta flag — lets the UI know whether this item has enough data to render
    _incomplete: !image && !name,
    cachedAt: now(),
  };
}

function isExpired(item) {
  const endsAt = item?.auction?.ends_at;
  if (!endsAt) return false;
  return Number(endsAt) * 1000 < now();
}

/* ─── Cleanup ─────────────────────────────────────── */

function scheduleCleanup() {
  if (cleanupTimer) return;

  cleanupTimer = setInterval(() => {
    let removed = 0;
    for (const [id, item] of auctions) {
      if (isExpired(item)) {
        auctions.delete(id);
        removed++;
      }
    }
    if (removed) {
      console.log(`🧹 [AuctionCache] Removed ${removed} expired. Remaining: ${auctions.size}`);
    }
  }, CLEANUP_INTERVAL_MS);

  if (cleanupTimer?.unref) cleanupTimer.unref();
}

/* ─── Public API ──────────────────────────────────── */

export function upsertAuction(rawItem) {
  const id       = getId(rawItem);
  if (!id) return null;

  const existing = auctions.get(id) ?? null;
  const item     = normalizeAuction(rawItem, existing);

  if (isExpired(item)) {
    auctions.delete(id);
    return null;
  }

  if (existing) {
    // Merge: prefer non-empty values from the new event, keep old values as fallback
    auctions.set(id, { ...existing, ...item, cachedAt: now() });
  } else {
    if (auctions.size >= MAX_ITEMS) {
      auctions.delete(auctions.keys().next().value);
    }
    auctions.set(id, item);
  }

  scheduleCleanup();
  return auctions.get(id);
}

// Returns true only if the id was actually cached (and is now removed).
export function removeAuction(itemId) {
  const id = String(itemId || "");
  return id ? auctions.delete(id) : false;
}

export function getAuctionCacheSize() {
  return auctions.size;
}

// Returns all non-expired, non-incomplete auctions — used by the run-once scan route.
export function getAllAuctions() {
  const now = Date.now();
  return Array.from(auctions.values()).filter(
    (item) =>
      !item._incomplete &&
      !(item.auction?.ends_at && Number(item.auction.ends_at) * 1000 < now)
  );
}

/* ─── Query ───────────────────────────────────────── */

function lc(s) { return String(s || "").trim().toLowerCase(); }

export function queryAuctions({
  search   = "",
  category = "",
  minPrice = "",
  maxPrice = "",
  wear     = "",
  sort     = "endingSoon",
  limit    = 200,
  skip     = 0,
} = {}) {
  let arr = Array.from(auctions.values()).filter(
    (item) => !isExpired(item)
  );

  // text search
  const q = lc(search);
  if (q) {
    const words = q.split(/\s+/).filter(Boolean);
    arr = arr.filter((item) => {
      const hay = [item.name, item.market_hash_name].map(lc).join(" ");
      return words.every((w) => hay.includes(w));
    });
  }

  // category
  if (category && category !== "all" && category !== "") {
    const c = lc(category);
    arr = arr.filter(
      (item) =>
        lc(item.categoryKey) === c ||
        lc(item.category)    === c ||
        lc(item.type).includes(c)
    );
  }

  // wear
  if (wear && lc(wear) !== "all" && wear !== "") {
    const w = lc(wear);
    arr = arr.filter((item) => lc(item.wear_name) === w);
  }

  // price range
  const minP = minPrice === "" ? null : Number(minPrice);
  const maxP = maxPrice === "" ? null : Number(maxPrice);
  if (minP !== null && !Number.isNaN(minP)) arr = arr.filter((item) => item.priceCoins >= minP);
  if (maxP !== null && !Number.isNaN(maxP)) arr = arr.filter((item) => item.priceCoins <= maxP);

  // sort
  arr = [...arr].sort((a, b) => {
    switch (sort) {
      case "endingSoon": {
        const ae = Number(a?.auction?.ends_at ?? Infinity);
        const be = Number(b?.auction?.ends_at ?? Infinity);
        return ae - be;
      }
      case "priceAsc":     return a.priceCoins - b.priceCoins;
      case "priceDesc":    return b.priceCoins - a.priceCoins;
      case "discountDesc": return Number(b.discountPct || 0) - Number(a.discountPct || 0);
      case "bidsDesc":     return Number(b?.auction?.bids || 0) - Number(a?.auction?.bids || 0);
      default:             return 0;
    }
  });

  const total  = arr.length;
  const sSkip  = Math.max(0, Number(skip)  || 0);
  const sLimit = Math.min(500, Math.max(1, Number(limit) || 200));

  return {
    items:     arr.slice(sSkip, sSkip + sLimit),
    total,
    cacheSize: auctions.size,
    updatedAt: now(),
  };
}
