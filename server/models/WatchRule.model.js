import mongoose from "mongoose";
const { Schema } = mongoose;

const WatchRuleSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    baseName: {
      type: String,
      trim: true,
      required: true,
      index: true,
    },

    wear: {
      type: String,
      trim: true,
      required: true,
      enum: [
        "Factory New",
        "Minimal Wear",
        "Field-Tested",
        "Well-Worn",
        "Battle-Scarred",
      ],
      index: true,
    },

    // Phase 4C: NO default. A document with no `variant` key (every
    // pre-Phase-4C document, and any new one that omits it) must remain
    // genuinely absent so server/services/watchMatcher.js's
    // `rule.variant ?? "ANY"` legacy-safety guarantee keeps working —
    // never backfill this with a schema default.
    variant: {
      type: String,
      trim: true,
      enum: ["NORMAL", "STATTRAK", "SOUVENIR", "ANY"],
    },

    marketHashName: {
      type: String,
      trim: true,
      required: true,
    },

    weapon: {
      type: String,
      trim: true,
      default: "",
    },

    skin: {
      type: String,
      trim: true,
      default: "",
    },

    image: {
      type: String,
      trim: true,
      default: "",
    },

    appId: {
      type: Number,
      default: 730,
      index: true,
    },

    targetPrice: {
      type: Number,
      min: 0,
      default: null,
    },

    minDiscountPct: {
      type: Number,
      min: 0,
      max: 100,
      default: null,
    },

    cooldownMin: {
      type: Number,
      min: 1,
      default: 5,
    },

    lastNotifiedAt: {
      type: Date,
      default: null,
    },

    lastMatchedItemKey: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

WatchRuleSchema.index({ userId: 1, baseName: 1, wear: 1, appId: 1 });

export default mongoose.models.WatchRule ||
  mongoose.model("WatchRule", WatchRuleSchema);