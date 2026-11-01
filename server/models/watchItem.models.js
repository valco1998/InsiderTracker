import mongoose from "mongoose";
const { Schema } = mongoose;

const AlertStateSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    itemId: { type: String, required: true, index: true },

    name: { type: String, default: "" },
    lastPrice: { type: Number, default: null },
    lastSeenAt: { type: Date, default: null },
  },
  { timestamps: true }
);

AlertStateSchema.index({ userId: 1, itemId: 1 }, { unique: true });

export default mongoose.model("AlertState", AlertStateSchema);