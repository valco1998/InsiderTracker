import mongoose from "mongoose";

const { Schema } = mongoose;

const AlertStateSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    ruleId: {
      type: Schema.Types.ObjectId,
      ref: "WatchRule",
      required: true,
      index: true,
    },

    itemId: {
      type: String,
      required: true,
      index: true,
    },

    name: {
      type: String,
      default: "",
    },

    lastPrice: {
      type: Number,
      default: null,
    },

    lastSeenAt: {
      type: Date,
      default: null,
    },

    lastNotifiedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Each rule gets a separate cooldown per item.
AlertStateSchema.index({ userId: 1, ruleId: 1, itemId: 1 }, { unique: true });

// Auto-clean cooldown state that has not been touched in 30 days.
// updatedAt is maintained by Mongoose timestamps; sparse: false is fine here.
AlertStateSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 30 * 24 * 3600 });

export default mongoose.models.AlertState ||
  mongoose.model("AlertState", AlertStateSchema);