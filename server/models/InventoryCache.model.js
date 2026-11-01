import mongoose from "mongoose";

/*
 * Caches the last successful Steam CS2 inventory fetch for a steamId.
 * One document per steamId (upserted on every successful live fetch).
 * TTL index automatically removes stale entries after 7 days.
 */
const InventoryCacheSchema = new mongoose.Schema(
  {
    steamId:   { type: String, required: true, unique: true },
    userId:    { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    items:     { type: [mongoose.Schema.Types.Mixed], default: [] },
    fetchedAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

// Auto-expire after 7 days
InventoryCacheSchema.index({ fetchedAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

export default mongoose.model("InventoryCache", InventoryCacheSchema);
