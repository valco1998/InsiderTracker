import mongoose from "mongoose";

// A user following one SEC issuer (resolved from a ticker to its CIK).
// alertsFrom: only filings accepted by the SEC at/after this instant may alert.
// It is set when the follow is created and reset whenever it is re-enabled, so
// historical filings and filings from paused periods never generate alerts.
const InsiderWatchSchema = new mongoose.Schema(
  {
    userId:      { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    cik:         { type: String, required: true, match: /^\d{10}$/ },
    ticker:      { type: String, required: true, trim: true, uppercase: true, maxlength: 12 },
    companyName: { type: String, default: "", trim: true, maxlength: 200 },
    types:       { type: String, enum: ["purchase", "sale", "both"], default: "both" },
    enabled:     { type: Boolean, default: true },
    alertsFrom:  { type: Date, required: true },
  },
  { timestamps: true }
);

InsiderWatchSchema.index({ userId: 1, cik: 1 }, { unique: true });
InsiderWatchSchema.index({ cik: 1, enabled: 1 });

export default mongoose.models.InsiderWatch || mongoose.model("InsiderWatch", InsiderWatchSchema);
