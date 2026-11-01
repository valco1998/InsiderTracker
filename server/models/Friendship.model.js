import mongoose from "mongoose";

const schema = new mongoose.Schema({
  fromId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  toId:   { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  status: { type: String, enum: ["pending", "accepted"], default: "pending" },
}, { timestamps: true });

schema.index({ fromId: 1, toId: 1 }, { unique: true });

export default mongoose.model("Friendship", schema);
