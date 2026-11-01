import mongoose from "mongoose";

const schema = new mongoose.Schema(
  {
    roomId:       { type: String, required: true, default: "global" },
    senderId:     { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    senderName:   { type: String, required: true },
    senderAvatar: { type: String, default: "" },
    text:         { type: String, default: "", maxlength: 2000 },
    type:         { type: String, enum: ["text", "system", "auction_share", "market_item"], default: "text" },
    meta:         { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

schema.index({ roomId: 1, createdAt: -1 });

export default mongoose.model("ChatMessage", schema);
