import mongoose from "mongoose";

const alertLogSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    ruleId: {
      type: mongoose.Schema.Types.ObjectId,
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
      required: true,
      trim: true,
    },

    marketHashName: {
      type: String,
      default: "",
      trim: true,
    },

    image: {
      type: String,
      default: "",
    },

    priceCoins: {
      type: Number,
      default: 0,
      index: true,
    },

    suggestedCoins: {
      type: Number,
      default: 0,
    },

    discountPct: {
      type: Number,
      default: 0,
    },

    wear: {
      type: String,
      default: "",
    },

    floatValue: {
      type: Number,
      default: null,
    },

    // Unix timestamp (seconds) when the Empire auction ends.
    // Populated only for source="auction-alert". Used by the expiry sweep
    // to mark alerts expired as soon as the auction closes.
    auctionEndsAt: {
      type: Number,
      default: null,
      index: true,
    },

    source: {
      type: String,
      default: "engine",
    },

    // live | expired | deleted
    // "expired"  — auction ended or alert is older than TTL
    // "deleted"  — Empire emitted deleted_item for this itemId
    status: {
      type: String,
      enum: ["live", "expired", "deleted"],
      default: "live",
      index: true,
    },

    expiredAt: {
      type: Date,
      default: null,
    },

    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },

    seen: {
      type: Boolean,
      default: false,
    },

    triggeredAt: {
      type: Date,
      default: Date.now,
      index: true,
    },

    // ── Reliability dashboard: per-alert lifecycle timing ────────────────────
    // All fields additive/optional — older documents simply have timing=undefined.
    // matchedAt is set at create() time (== detectedAt from the matching path).
    // The other stages are filled in via fire-and-forget updates as the alert
    // moves through the pipeline; failures to set these never block delivery.
    // ── Insider Tracker (additive/optional — absent on legacy documents) ─────
    // kind="insider_trade": ruleId = InsiderWatch._id, itemId = economic alert key.
    kind: { type: String, default: "" },
    insider: {
      type: new mongoose.Schema({
        economicId:      String,
        ticker:          String,
        issuerName:      String,
        issuerCik:       String,
        insiderName:     String,
        role:            String,
        code:            String,
        type:            String,
        shares:          Number,
        price:           Number,
        value:           Number,
        transactionDate: String,
        filingDate:      String,
        acceptedAtET:    String,
        filingUrl:       String,
        filings:         [{ _id: false, accessionNo: String, insiderName: String, ownership: String, filingUrl: String }],
      }, { _id: false }),
      default: undefined,
    },

    timing: {
      matchedAt:      { type: Date, default: null },
      socketEmitAt:   { type: Date, default: null },
      pushStartAt:    { type: Date, default: null },
      pushDoneAt:     { type: Date, default: null },
      pushOutcome:    { type: String, enum: ["success", "fail", null], default: null },
      totalLatencyMs: { type: Number, default: null },
    },
  },
  {
    timestamps: true,
  }
);

/* =========================
   PERFORMANCE
========================= */

alertLogSchema.index({ userId: 1, triggeredAt: -1 });
alertLogSchema.index({ userId: 1, isRead: 1, triggeredAt: -1 });
alertLogSchema.index({ ruleId: 1, triggeredAt: -1 });
alertLogSchema.index({ userId: 1, seen: 1, triggeredAt: -1 });

// Compound index for live-alert queries: GET /alerts filters by { userId, status }
// and the expiry sweep queries { status, auctionEndsAt }.
alertLogSchema.index({ userId: 1, status: 1, triggeredAt: -1 });
alertLogSchema.index({ status: 1, auctionEndsAt: 1 });

// Hard-expire alerts older than 60 days — keeps the collection lean.
// MongoDB TTL monitor runs once per minute; actual expiry may lag up to ~60s.
alertLogSchema.index({ triggeredAt: 1 }, { expireAfterSeconds: 60 * 24 * 3600 });

export default mongoose.models.AlertLog ||
  mongoose.model("AlertLog", alertLogSchema);