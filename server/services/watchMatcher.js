// server/services/watchMatcher.js
//
// Canonical, shared Watchlist identity/matching logic (Phase 4B.1).
//
// PURE FUNCTIONS ONLY. This module must never:
//   - make Empire requests
//   - touch MongoDB / AlertState / AlertLog
//   - mutate the item/rule objects it's given
//   - send Socket.IO events or push notifications
//   - depend on marketCache/scheduling state
//
// NOT YET WIRED into server/jobs/alertEngine.js or
// server/controllers/alerts.controller.js — this file is additive/isolated
// per Phase 4B.1. Both production matchers continue operating exactly as
// they do today until a later sub-phase explicitly connects them.
//
// Price/discount fields (priceCoins, discountPct) are read here, never
// recomputed — Phase 3's normalization/precision work is out of scope and
// must not be duplicated or altered by this module.

const CANONICAL_WEARS = [
  "Factory New",
  "Minimal Wear",
  "Field-Tested",
  "Well-Worn",
  "Battle-Scarred",
];

// Anchored at the END of the string only — deliberately stricter than a
// generic "any trailing parenthetical" match, so a non-wear suffix (e.g. a
// sticker attribute or a Doppler phase note) is never misread as a wear.
const WEAR_SUFFIX_RE = /\((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)\s*$/i;

function getRawItemName(item = {}) {
  return (
    item?.market_hash_name ||
    item?.marketHashName ||
    item?.market_name ||
    item?.name ||
    ""
  );
}

function getRawRuleName(rule = {}) {
  return String(
    rule?.marketHashName ||
    rule?.baseName ||
    rule?.query ||
    rule?.knifeName ||
    rule?.skinName ||
    ""
  ).trim();
}

/**
 * Classifies a raw item/rule name into one of the three real variants.
 * MUST run before canonicalizeWatchName()'s destructive stripping — once
 * the StatTrak/Souvenir qualifier text is gone, it can no longer be
 * classified from the string alone.
 *
 * The ★ symbol is a rarity/category marker (knives, gloves) that appears on
 * both StatTrak and non-StatTrak items alike — it is never itself a variant
 * signal and is stripped first, before checking for StatTrak/Souvenir.
 *
 * Recognizes "StatTrak™" and "StatTrak*" (both already present in the
 * existing, already-proven matcher code) plus a bare "StatTrak " form with
 * no evidence in real captured Empire data but included defensively per
 * Phase 4B planning. "Souvenir" has one real, unambiguous format.
 */
export function extractVariant(rawName = "") {
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

/**
 * Canonical wear value or null if it cannot be reliably determined.
 * Explicit item fields are trusted first (this is how real Empire payloads
 * carry wear — confirmed against real captured samples); falls back to a
 * STRICT trailing-parenthetical match against the five canonical wear
 * strings only. Never treats an arbitrary trailing parenthetical as wear.
 */
export function extractWear(item = {}) {
  const explicit =
    item?.wear_name || item?.wearName || item?.wearLabel || item?.exterior;

  if (explicit) {
    const canon = CANONICAL_WEARS.find(
      (w) => w.toLowerCase() === String(explicit).trim().toLowerCase()
    );
    if (canon) return canon;
  }

  const match = String(getRawItemName(item) || "").match(WEAR_SUFFIX_RE);
  if (match) {
    const canon = CANONICAL_WEARS.find(
      (w) => w.toLowerCase() === match[1].toLowerCase()
    );
    if (canon) return canon;
  }

  return null;
}

/**
 * Union of every ID field either existing matcher (alertEngine.js,
 * alerts.controller.js) currently checks, preserving alerts.controller.js's
 * fuller precedence (it additionally checks item_id, which alertEngine.js's
 * chain lacked) as the canonical order — a strictly additive, non-breaking
 * consolidation per Phase 4A's finding.
 */
export function getCanonicalItemId(item = {}) {
  return String(
    item?.itemId ||
    item?.id ||
    item?.assetid ||
    item?.assetId ||
    item?.item_id ||
    item?.market_nameid ||
    item?.marketNameId ||
    ""
  );
}

/**
 * Deterministic cosmetic normalization for base-name comparison ONLY.
 * Strips: case, whitespace, ★, StatTrak/Souvenir qualifiers, ™/®, and a
 * trailing canonical-wear parenthetical (only when it is genuinely the last
 * thing in the string — a suffix like "- Phase 2" after it prevents the
 * wear-strip from firing, deliberately, so meaningful suffixes such as
 * "- Phase 2/3/4", "Ruby", "Sapphire", "Emerald" are never removed).
 *
 * Variant must already have been read via extractVariant() before calling
 * this — that information is gone once this function returns.
 */
export function canonicalizeWatchName(name = "") {
  return String(name || "")
    .replace(/^★\s*/u, "")
    .replace(/^StatTrak™\s*/i, "")
    .replace(/^StatTrak\*\s*/i, "")
    .replace(/^StatTrak\s+/i, "")
    .replace(/^Souvenir\s*/i, "")
    .replace(/[™®]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(WEAR_SUFFIX_RE, "")
    .trim();
}

function getPriceCoinsForMatch(item = {}) {
  const n = Number(item?.priceCoins);
  return Number.isFinite(n) ? n : 0;
}

function getDiscountPctForMatch(item = {}) {
  const n = Number(item?.discountPct);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Canonical Watchlist match decision. Pure function — reads item/rule,
 * never mutates either, never performs I/O.
 *
 * Variant: rule.variant ?? "ANY" — a rule whose `variant` property is
 * genuinely absent (the real shape of every pre-Phase-4B WatchRule document
 * read via .lean()) is treated as ANY, not NORMAL. This is the load-bearing
 * backward-compatibility guarantee for Phase 4B and must never be replaced
 * by a schema-level default — see Phase 4B planning notes.
 *
 * Name: ONE-DIRECTION containment only (item contains rule). Deliberately
 * not bidirectional — real Empire names can carry meaningful suffixes
 * ("- Phase 2", "Ruby", "Sapphire", "Emerald") beyond a rule's shorter
 * stored name, and reverse containment (rule contains item) has no known
 * legitimate use and was the source of a confirmed cross-engine divergence.
 *
 * Wear: explicit rule wear requires an exact canonical match; if the rule
 * specifies wear but the item's wear cannot be reliably determined, this
 * does NOT match — missing an uncertain listing is preferred over a false
 * alert.
 *
 * Price/discount: reads item.priceCoins/item.discountPct directly (already
 * computed by Phase 3's canonical normalizers) — never recomputed here.
 */
export function matchesWatchRule(item = {}, rule = {}) {
  return explainWatchRuleMatch(item, rule) === null;
}

/**
 * Same decision as matchesWatchRule(), but returns WHY a rule did not match
 * (Phase 5B observability). This is the single implementation of the match
 * logic — matchesWatchRule() is a boolean wrapper around it, so the two can
 * never diverge.
 *
 * Returns null on match, otherwise the FIRST failing stage, in check order:
 *   "variant" | "no_rule_name" | "name" | "wear_unknown" | "wear" |
 *   "target_price" | "min_discount"
 */
export function explainWatchRuleMatch(item = {}, rule = {}) {
  const rawItemName = getRawItemName(item);
  const rawRuleName = getRawRuleName(rule);

  // ── Variant ────────────────────────────────────────────────────────────
  const effectiveVariant = rule?.variant ?? "ANY";
  if (effectiveVariant !== "ANY") {
    const itemVariant = extractVariant(rawItemName);
    if (itemVariant !== effectiveVariant) return "variant";
  }

  // ── Name (one-direction containment) ──────────────────────────────────
  const canonicalRuleName = canonicalizeWatchName(rawRuleName);
  if (!canonicalRuleName) return "no_rule_name";
  const canonicalItemName = canonicalizeWatchName(rawItemName);
  if (!canonicalItemName.includes(canonicalRuleName)) return "name";

  // ── Wear ───────────────────────────────────────────────────────────────
  const ruleWear = rule?.wear && rule.wear !== "ANY" ? rule.wear : null;
  if (ruleWear) {
    const itemWear = extractWear(item);
    if (!itemWear) return "wear_unknown"; // cannot reliably determine -> do not match
    if (itemWear.toLowerCase() !== String(ruleWear).toLowerCase()) return "wear";
  }

  // ── Target price ───────────────────────────────────────────────────────
  const hasTargetPrice =
    rule?.targetPrice !== undefined &&
    rule?.targetPrice !== null &&
    rule?.targetPrice !== "" &&
    Number(rule.targetPrice) > 0;
  if (hasTargetPrice) {
    const targetPrice = Number(rule.targetPrice);
    const priceCoins = getPriceCoinsForMatch(item);
    if (!priceCoins || priceCoins > targetPrice) return "target_price";
  }

  // ── Minimum discount ───────────────────────────────────────────────────
  const hasMinDiscount =
    rule?.minDiscountPct !== undefined &&
    rule?.minDiscountPct !== null &&
    rule?.minDiscountPct !== "" &&
    Number(rule.minDiscountPct) > 0;
  if (hasMinDiscount) {
    const minDiscountPct = Number(rule.minDiscountPct);
    const discountPct = getDiscountPctForMatch(item);
    if (discountPct < minDiscountPct) return "min_discount";
  }

  return null;
}
