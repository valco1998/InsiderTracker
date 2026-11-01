import mongoose from "mongoose";

const ItemSnapshotSchema = new mongoose.Schema({
  assetId:        { type: String, default: "" },
  name:           { type: String, required: true, trim: true, maxLength: 300 },
  marketHashName: { type: String, required: true, trim: true, maxLength: 300 },
  iconUrl:        { type: String, default: "", maxLength: 2000 },
  exterior:       { type: String, default: null },
  rarity: {
    name:  { type: String, default: null },
    color: { type: String, default: null },
  },
  quantity:       { type: Number, default: 1, min: 1, max: 99 },
  isSpecial:      { type: Boolean, default: false }, // "Any Knife", "Any Key", etc.
}, { _id: false });

const TradePostSchema = new mongoose.Schema({
  ownerUserId:    { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  ownerSteamId:   { type: String, default: "" },
  ownerUsername:  { type: String, default: "" },
  ownerAvatarUrl: { type: String, default: "" },
  myOfferItems:   { type: [ItemSnapshotSchema], default: [] },
  lookingForItems:{ type: [ItemSnapshotSchema], default: [] },
  message:        { type: String, default: "", maxLength: 500 },
  status:          { type: String, enum: ["active", "closed"], default: "active" },
  matchCount:      { type: Number, default: 0 },
  commentCount:    { type: Number, default: 0 },
  unreadComments:  { type: Number, default: 0 },
  bumpedAt:        { type: Date, default: null },
}, { timestamps: true });

TradePostSchema.index({ status: 1, bumpedAt: -1, createdAt: -1 });
TradePostSchema.index({ ownerUserId: 1, createdAt: -1 });

export default mongoose.model("TradePost", TradePostSchema);
