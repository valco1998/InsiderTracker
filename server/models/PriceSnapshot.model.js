import mongoose from "mongoose";

const priceSnapshotSchema = new mongoose.Schema(
  {
    marketHashName: { type: String, required: true },
    wear:           { type: String, default: null },
    floatValue:     { type: Number, default: null },
    priceCoins:     { type: Number, required: true },
    suggestedCoins: { type: Number, required: true },
    discountPct:    { type: Number, required: true },
    itemId:         { type: String, required: true },
    source:         { type: String, enum: ["ws:new_item", "ws:updated_item"], required: true },
    observedAt:     { type: Date, default: Date.now },
  },
  { timestamps: false, versionKey: false }
);

// TTL — auto-delete after 30 days; also serves as the primary time-range index
priceSnapshotSchema.index({ observedAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

// Primary aggregation query: "all prices for AK Redline FT in the last 7 days"
priceSnapshotSchema.index({ marketHashName: 1, wear: 1, observedAt: -1 });

// Dedup check: "did we already snapshot this specific listing in the last 15 min?"
priceSnapshotSchema.index({ itemId: 1, observedAt: -1 });

const PriceSnapshot = mongoose.model("PriceSnapshot", priceSnapshotSchema);
export default PriceSnapshot;
