import mongoose from "mongoose";

const skinMetricsSchema = new mongoose.Schema(
  {
    marketHashName:  { type: String, required: true },
    wear:            { type: String, default: null },

    // Market tier — derived from sold history when there's enough of it,
    // otherwise falls back to observed listing frequency (see tierSource)
    tier: {
      type:    String,
      enum:    ["active", "thin", "rare", "no_data"],
      default: "no_data",
    },

    // Which signal produced `tier` — confirmed sales (ground truth) vs. the
    // listing-frequency proxy used when there isn't yet enough sold data.
    tierSource: {
      type:    String,
      enum:    ["sold_history", "listing_proxy", "none"],
      default: "none",
    },

    // 7-day price statistics (null until enough data exists)
    avgPrice7d:     { type: Number, default: null },
    medianPrice7d:  { type: Number, default: null },
    minPrice7d:     { type: Number, default: null },
    maxPrice7d:     { type: Number, default: null },
    avgDiscount7d:  { type: Number, default: null },

    // Listing frequency in the last 7 days (unique observation events)
    listingCount7d: { type: Number, default: 0 },

    // Float statistics over the last 7 days (null when no float data)
    avgFloat7d:     { type: Number, default: null },
    minFloat7d:     { type: Number, default: null },
    maxFloat7d:     { type: Number, default: null },

    // Live count — patched by the market cache sweep, not the aggregator
    activeListingsNow: { type: Number, default: 0 },

    // Confirmed sale stats — aggregated from SoldHistory collection (Phase 0.5+)
    soldCount30d:      { type: Number, default: 0 },
    soldCount90d:      { type: Number, default: 0 },
    medianSoldPrice:   { type: Number, default: null },
    avgSoldPrice:      { type: Number, default: null },
    soldPriceMin30d:   { type: Number, default: null },
    soldPriceMax30d:   { type: Number, default: null },
    lastSoldPrice:     { type: Number, default: null },
    lastSoldAt:        { type: Date,   default: null },
    soldPriceTrend:    { type: Number, default: null }, // % change old→new half; null if <6 sales
    soldDataUpdatedAt: { type: Date,   default: null },
    soldEarliestAt:    { type: Date,   default: null }, // oldest sale ever seen — used for CRC confidence tenure factor

    dataStartedAt:  { type: Date, default: null },
    lastUpdatedAt:  { type: Date, default: Date.now },
  },
  { timestamps: false, versionKey: false }
);

// Every (skin, wear) pair maps to exactly one metrics document
skinMetricsSchema.index({ marketHashName: 1, wear: 1 }, { unique: true });

const SkinMetrics = mongoose.model("SkinMetrics", skinMetricsSchema);
export default SkinMetrics;
