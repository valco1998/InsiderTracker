import mongoose from "mongoose";

// A user's saved Backtesting strategy (parameters only — never results or prices).
// `params` holds the run request as validated by backtestEngine.normalizeRunConfig
// (dates, buyers, value, window, filters, horizon, latency, costs …).
// Index { userId: 1 } is declared for documentation; autoIndex is OFF in this app, so it
// is created only by an explicitly approved, separate step.
const BacktestStrategySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    name:   { type: String, required: true, trim: true, maxlength: 80 },
    params: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { timestamps: true, minimize: false }
);

BacktestStrategySchema.index({ userId: 1, updatedAt: -1 });

export default mongoose.models.BacktestStrategy || mongoose.model("BacktestStrategy", BacktestStrategySchema);
