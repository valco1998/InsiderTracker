/**
 * dealScore.js
 *
 * Pure computation — no DB calls, no side effects, no imports from other services.
 * Takes one market item + one SkinMetrics document and returns a deal score object.
 *
 * Confidence model: Coverage-Relative Confidence (CRC)
 *   confidence = coverageFactor × tenureFactor × recencyFactor
 *
 * The model is price-neutral — a $6,000 knife with 3 sales gets the same confidence
 * as a $50 AK-47 with 3 sales, because both represent 100% of their expected rate.
 *
 * Weights are confidence-derived — no hard-coded tier tables.
 */

const clamp  = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;

// ── Discount Score ────────────────────────────────────────────────────────────
// Progressive mapping of discount% vs Empire suggested price → 0–100.
function computeDiscountScore(discountPct) {
  const d = Number(discountPct) || 0;
  if (d <= 0)  return 0;
  if (d <= 5)  return round1(d * 3);                       // 0–15
  if (d <= 15) return round1(15 + (d - 5) * 4.5);         // 15–60
  if (d <= 30) return round1(60 + (d - 15) * 2.667);      // 60–100
  return 100;
}

// ── Historical Price Score ────────────────────────────────────────────────────
// How does the current ask price compare to the reference price (sold median or listing median)?
// At reference → 50. 33% below → 100. At 133% of reference → ~0.
function computePriceScore(priceCoins, referencePrice) {
  if (!referencePrice || !priceCoins) return null;
  const ratio = priceCoins / referencePrice;
  return clamp(Math.round(50 + (1 - ratio) * 150), 0, 100);
}

// ── Liquidity Score ───────────────────────────────────────────────────────────
const TIER_LIQUIDITY = { active: 80, thin: 50, rare: 25 };

// Wording keyed by [tier][tierSource] — same score/weight either way, but the
// label discloses whether the tier came from confirmed sales (SoldHistory) or
// is only estimated from listing frequency (no sold data yet for this skin).
// Qualitative by design — no transaction counts, so at-a-glance recognition of
// confirmed vs. estimated doesn't compete with a number that isn't independently
// meaningful without the threshold it's being compared against.
const LIQUIDITY_DETAIL = {
  active: {
    sold_history:  "Active market — confirmed from sales history",
    listing_proxy: "Active market — estimated from listing activity (7d)",
  },
  thin: {
    sold_history:  "Thin market — confirmed from sales history",
    listing_proxy: "Thin market — estimated from listing activity (7d)",
  },
  rare: {
    sold_history:  "Rare item — confirmed from sales history",
    listing_proxy: "Rare item — estimated from listing activity (7d)",
  },
};

// ── Float Score ───────────────────────────────────────────────────────────────
// Compares this listing's float to the 7d average for this (skin, wear).
// Lower float within the same wear tier = generally better quality.
// Centered at 50; each 0.002 diff ≈ 1 point.
function computeFloatScore(floatValue, avgFloat7d) {
  if (floatValue == null || avgFloat7d == null) return null;
  const delta = avgFloat7d - floatValue; // positive = current is lower (better)
  return clamp(50 + Math.round(delta * 500), 0, 100);
}

// ── Coverage-Relative Confidence (CRC) ───────────────────────────────────────
// Market-relative: a skin with 3 sales over its own expected rate scores just as
// confidently as a high-volume skin with 50 sales. Price-neutral by design.
function computeSignalConfidence(metrics, now = Date.now()) {
  const {
    soldCount30d  = 0,
    soldCount90d  = 0,
    soldEarliestAt,
    lastSoldAt,
    listingCount7d = 0,
  } = metrics;

  // No sold history — fall back to listing frequency as a weak prior
  if (!soldCount90d) {
    if (listingCount7d >= 21) return 0.40;
    if (listingCount7d >= 5)  return 0.25;
    if (listingCount7d >= 1)  return 0.15;
    return 0.10;
  }

  // How many days of sale data have we actually collected for this skin?
  // soldEarliestAt = oldest sale in SoldHistory (set by aggregator).
  // Fallback: 1 day per confirmed sale (conservative floor when field not yet populated).
  const soldObservedDays = soldEarliestAt
    ? Math.max(1, (now - new Date(soldEarliestAt).getTime()) / 86_400_000)
    : Math.min(90, soldCount90d);

  // Factor 1: Coverage — did we observe the expected fraction of this skin's activity?
  const estimatedDailyRate = soldCount90d / Math.min(soldObservedDays, 90);
  const expectedIn30d      = estimatedDailyRate * Math.min(30, soldObservedDays);
  const coverageFactor     = Math.min(1.0, soldCount30d / Math.max(0.5, expectedIn30d));

  // Factor 2: Tenure — how long have we been collecting data for this skin?
  const tenureFactor = soldObservedDays >= 90 ? 1.00
    : soldObservedDays >= 30 ? 0.80
    : soldObservedDays >= 14 ? 0.60
    : 0.35;

  // Factor 3: Recency — how current is the most recent sale?
  const daysSinceLastSale = lastSoldAt
    ? (now - new Date(lastSoldAt).getTime()) / 86_400_000
    : 999;
  const recencyFactor = daysSinceLastSale <=  7 ? 1.00
    : daysSinceLastSale <= 14 ? 0.85
    : daysSinceLastSale <= 30 ? 0.70
    : daysSinceLastSale <= 60 ? 0.50
    : daysSinceLastSale <= 90 ? 0.35
    : 0.15;

  const rawConfidence = coverageFactor * tenureFactor * recencyFactor;

  // Floor: acknowledge we have real transaction data even when coverage is thin
  const minFromRealData = Math.min(0.40, Math.max(0.20, soldCount90d * 0.025));

  return Math.min(0.95, Math.max(rawConfidence, minFromRealData));
}

// ── Main: computeDealScore ────────────────────────────────────────────────────
/**
 * @param {object} item    — normalized market item from marketCache
 * @param {object|null} metrics — SkinMetrics document (lean), or null if no data yet
 * @returns {object|null}  — deal score object, or null if item has no price
 */
export function computeDealScore(item, metrics) {
  const priceCoins = Number(item?.priceCoins) || 0;
  if (!priceCoins) return null;

  const m          = metrics || {};
  const confidence = metrics ? computeSignalConfidence(m) : 0.10;

  // ── Factor 1: Discount (always active — Empire suggested price is always available) ──
  const discountPct   = Number(item?.discountPct) || 0;
  const discountScore = computeDiscountScore(discountPct);

  // ── Factor 2: Historical Price ──────────────────────────────────────────────
  let priceScore  = null;
  let priceSource = null;
  let priceDetail = null;

  const soldCount30d = Number(m.soldCount30d) || 0;
  if (m.medianSoldPrice != null && soldCount30d >= 5) {
    priceScore  = computePriceScore(priceCoins, m.medianSoldPrice);
    priceSource = "sold_history";
    priceDetail = `${soldCount30d} sales (30d) · median ${Math.round(m.medianSoldPrice)} coins`;
  } else if (m.medianPrice7d != null && (m.listingCount7d || 0) >= 5) {
    priceScore  = computePriceScore(priceCoins, m.medianPrice7d);
    priceSource = "listing_snapshot";
    priceDetail = `Listing median · ${m.listingCount7d || 0} seen (7d) · sold data accumulating`;
  }

  // ── Factor 3: Liquidity ─────────────────────────────────────────────────────
  const tier          = m.tier || "no_data";
  const tierSource     = m.tierSource || "none";
  const liquidityScore = TIER_LIQUIDITY[tier] ?? null;
  const liquidityDetail = LIQUIDITY_DETAIL[tier]?.[tierSource] ?? null;

  // ── Factor 4: Float ─────────────────────────────────────────────────────────
  const floatValue = item?.paint_wear ?? item?.floatValue ?? null;
  const avgFloat7d  = m.avgFloat7d ?? null;
  const floatScore  = (floatValue != null && avgFloat7d != null)
    ? computeFloatScore(Number(floatValue), Number(avgFloat7d))
    : null;
  const floatDetail = floatScore != null
    ? `${Number(floatValue).toFixed(4)} vs avg ${Number(avgFloat7d).toFixed(4)}`
    : null;

  // ── Confidence-derived weights ──────────────────────────────────────────────
  // Discount weight grows as confidence shrinks — when we have no sold data,
  // the discount vs. Empire's suggested price is the best signal we have.
  let wDiscount  = 0.40 + (1 - confidence) * 0.45;  // 0.40–0.85
  let wPrice     = priceScore != null ? confidence * 0.40 : 0;
  let wLiquidity = (liquidityScore != null && confidence >= 0.60) ? 0.15 : 0;
  let wFloat     = floatScore != null ? 0.10 : 0;

  const totalW = wDiscount + wPrice + wLiquidity + wFloat;
  if (totalW > 0) {
    wDiscount  /= totalW;
    wPrice     /= totalW;
    wLiquidity /= totalW;
    wFloat     /= totalW;
  }

  // ── Final score (weighted sum → 0–100) ─────────────────────────────────────
  let raw = discountScore * wDiscount;
  if (priceScore    != null) raw += priceScore    * wPrice;
  if (liquidityScore != null) raw += liquidityScore * wLiquidity;
  if (floatScore     != null) raw += floatScore     * wFloat;
  const score = clamp(Math.round(raw), 0, 100);

  // ── Metadata ────────────────────────────────────────────────────────────────
  const dataSource = priceSource === "sold_history" ? "sold_history"
    : priceSource === "listing_snapshot" ? "listing_snapshot"
    : "discount_only";

  let confidenceLabel;
  if (!metrics) {
    confidenceLabel = "No historical data";
  } else if (soldCount30d >= 5) {
    confidenceLabel = `${soldCount30d} confirmed sales (30d)`;
  } else if ((m.soldCount90d || 0) >= 2) {
    confidenceLabel = `${m.soldCount90d} confirmed sales (90d) · accumulating`;
  } else if ((m.listingCount7d || 0) >= 5) {
    confidenceLabel = `${m.listingCount7d} listings (7d) · sold data accumulating`;
  } else {
    confidenceLabel = "Limited data";
  }

  return {
    score,
    confidence:      round2(confidence),
    tier,
    dataSource,
    confidenceLabel,
    factors: {
      discount: {
        score:  discountScore,
        weight: round2(wDiscount),
        label:  "Empire discount",
        detail: discountPct >= 1 ? `-${Math.round(discountPct)}% off suggested` : "No discount",
      },
      priceHistory: priceScore != null ? {
        score:  priceScore,
        weight: round2(wPrice),
        label:  "vs market price",
        detail: priceDetail,
        source: priceSource,
      } : null,
      liquidity: liquidityScore != null ? {
        score:  liquidityScore,
        weight: round2(wLiquidity),
        label:  "Liquidity",
        detail: liquidityDetail,
        source: tierSource,
      } : null,
      float: floatScore != null ? {
        score:  floatScore,
        weight: round2(wFloat),
        label:  "Float",
        detail: floatDetail,
      } : null,
    },
  };
}
