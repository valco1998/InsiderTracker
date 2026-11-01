import mongoose from "mongoose";

const memberSchema = new mongoose.Schema(
  {
    userId:    { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    username:  { type: String, required: true },
    avatarUrl: { type: String, default: "" },
    joinedAt:  { type: Date, default: Date.now },
  },
  { _id: false }
);

const groupSchema = new mongoose.Schema(
  {
    name:    { type: String, required: true, maxlength: 60, trim: true },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    members: [memberSchema],
  },
  { timestamps: true }
);

groupSchema.index({ "members.userId": 1 });

export default mongoose.model("PrivateGroup", groupSchema);
