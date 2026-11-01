import mongoose from "mongoose";

const ItemPreviewSchema = new mongoose.Schema({
  name:           { type: String, default: "" },
  marketHashName: { type: String, default: "" },
  iconUrl:        { type: String, default: "", maxLength: 2000 },
  exterior:       { type: String, default: null },
  rarity: {
    name:  { type: String, default: null },
    color: { type: String, default: null },
  },
}, { _id: false });

const TradeMatchNotificationSchema = new mongoose.Schema({
  recipientUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  tradePostId:     { type: mongoose.Schema.Types.ObjectId, ref: "TradePost", required: true },
  senderUserId:    { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  senderUsername:  { type: String, default: "" },
  senderSteamId:   { type: String, default: "" },
  senderAvatarUrl: { type: String, default: "" },
  matchedItems:    { type: [ItemPreviewSchema], default: [] },
  offerItems:      { type: [ItemPreviewSchema], default: [] },
  read:            { type: Boolean, default: false },
}, { timestamps: true });

// Unique per (recipient, post) — DB-level guard against duplicates
TradeMatchNotificationSchema.index({ recipientUserId: 1, tradePostId: 1 }, { unique: true });
TradeMatchNotificationSchema.index({ recipientUserId: 1, createdAt: -1 });
TradeMatchNotificationSchema.index({ recipientUserId: 1, read: 1 });

export default mongoose.model("TradeMatchNotification", TradeMatchNotificationSchema);
