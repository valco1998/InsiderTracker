import mongoose from "mongoose";

// One claim per (user, economic transaction). The unique index is the hard
// guarantee against duplicate alerts: a second insert for the same pair fails
// (E11000) regardless of restarts, concurrent runs or late related filings.
const InsiderAlertClaimSchema = new mongoose.Schema(
  {
    userId:       { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    economicId:   { type: String, required: true, maxlength: 80 },
    watchId:      { type: mongoose.Schema.Types.ObjectId, ref: "InsiderWatch", required: true },
    ticker:       { type: String, default: "" },
    accessionNos: { type: [String], default: [] },
    status:       { type: String, enum: ["claimed", "delivered", "failed"], default: "claimed" },
    alertId:      { type: mongoose.Schema.Types.ObjectId, ref: "AlertLog", default: null },
    error:        { type: String, default: null, maxlength: 200 },
  },
  { timestamps: true }
);

InsiderAlertClaimSchema.index({ userId: 1, economicId: 1 }, { unique: true });

export default mongoose.models.InsiderAlertClaim || mongoose.model("InsiderAlertClaim", InsiderAlertClaimSchema);
