// Strips fields confirmed to have zero frontend consumers (grepped across
// client/src) from market/auction item objects before they're sent over the
// wire. Internal server logic — alert matching, deal-score computation,
// Socket.IO broadcasts, the in-memory caches themselves — is untouched;
// this only runs at the REST response boundary for /items/market,
// /items/market-live, /items/home-premium, and /auctions.
//
// - priceCents / suggestedCents: pure integer-cents duplicates of
//   priceCoins / suggestedCoins, which are always present and are what
//   every consumer actually reads (verified: any client-side reference to
//   *Cents is itself only a fallback for when *Coins is absent, which the
//   server never does).
// - _rawCategory / _rawType: internal debug fields, no client reference.
const STRIP_FIELDS = ["priceCents", "suggestedCents", "_rawCategory", "_rawType"];

export function trimItemForClient(item) {
  if (!item || typeof item !== "object") return item;
  const out = { ...item };
  for (const field of STRIP_FIELDS) delete out[field];
  return out;
}

export function trimItemsForClient(items) {
  return Array.isArray(items) ? items.map(trimItemForClient) : items;
}
