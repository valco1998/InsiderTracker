import mongoose from "mongoose";

/*
 * Stores manually-added CS2 items per user.
 * One document per item — enables individual deletes.
 * Independent of the Steam public API and InventoryCache.
 */
const ManualInventorySchema = new mongoose.Schema(
  {
    userId:     { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name:       { type: String, required: true, trim: true, maxlength: 300 },
    wear:       { type: String, trim: true, default: "" },
    iconUrl:    { type: String, trim: true, default: "" },
    tradable:   { type: Boolean, default: true },
    marketable: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model("ManualInventory", ManualInventorySchema);
