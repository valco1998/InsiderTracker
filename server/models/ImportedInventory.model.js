import mongoose from "mongoose";

/*
 * Stores CS2 inventory items imported via the browser extension.
 * One document per user (upserted on each import).
 * Items are sanitized by the backend before storage — only the
 * fields listed in EXTENSION_SAFE_FIELDS are ever persisted.
 */
const ImportedInventorySchema = new mongoose.Schema(
  {
    userId:     { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    steamId:    { type: String },
    items:      { type: [mongoose.Schema.Types.Mixed], default: [] },
    importedAt: { type: Date, default: Date.now },
    updatedAt:  { type: Date, default: Date.now },
    itemCount:  { type: Number, default: 0 },
  },
  { timestamps: false }
);

export default mongoose.model("ImportedInventory", ImportedInventorySchema);
