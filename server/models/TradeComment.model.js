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
  quantity:  { type: Number, default: 1, min: 1, max: 99 },
  isSpecial: { type: Boolean, default: false },
}, { _id: false });

const TradeCommentSchema = new mongoose.Schema({
  tradePostId:     { type: mongoose.Schema.Types.ObjectId, ref: "TradePost", required: true },
  senderUserId:    { type: mongoose.Schema.Types.ObjectId, ref: "User",      required: true },
  senderSteamId:   { type: String,  default: "" },
  senderUsername:  { type: String,  default: "" },
  senderAvatarUrl: { type: String,  default: "" },
  offeredItems:    { type: [ItemSnapshotSchema], default: [] },
  message:         { type: String,  default: "", maxLength: 1000 },
  readByOwner:     { type: Boolean, default: false },
}, { timestamps: true });

TradeCommentSchema.index({ tradePostId: 1, createdAt: 1 });

export default mongoose.model("TradeComment", TradeCommentSchema);
