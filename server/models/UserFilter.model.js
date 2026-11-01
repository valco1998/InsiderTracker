import mongoose from "mongoose";
const { Schema } = mongoose;

const UserFilterSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", index: true, required: true },
    name: { type: String, trim: true, default: "default" },
    payload: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

export default mongoose.model("UserFilter", UserFilterSchema);
