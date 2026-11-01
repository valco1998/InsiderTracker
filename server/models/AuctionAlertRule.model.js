import mongoose from "mongoose";
const { Schema } = mongoose;

const AuctionAlertRuleSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Optional filters
    category: {
      type: String,
      default: "all",
      // "all" | "knife" | "gloves" | "rifle" | "pistol" | "smg" | "sniper" | "sticker"
    },
    search: {
      type: String,
      default: "",
      trim: true,
    },
    wear: {
      type: String,
      default: "",
      trim: true,
    },

    // Profit thresholds
    minProfitCoins: {
      type: Number,
      required: true,
      min: 0,
    },
    minProfitPct: {
      type: Number,
      default: null,
      min: 0,
    },
    maxBidPrice: {
      type: Number,
      default: null,
      min: 0,
    },

    // Behaviour
    cooldownMin: {
      type: Number,
      default: 10,
      min: 1,
    },
    enabled: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  { timestamps: true }
);

AuctionAlertRuleSchema.index({ userId: 1, enabled: 1 });

export default mongoose.models.AuctionAlertRule ||
  mongoose.model("AuctionAlertRule", AuctionAlertRuleSchema);
