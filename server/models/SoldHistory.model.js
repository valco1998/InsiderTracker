import mongoose from "mongoose";

const soldHistorySchema = new mongoose.Schema(
  {
    saleId:          { type: String, required: true },
    marketHashName:  { type: String, required: true },
    wear:            { type: String, default: null },   // condition string e.g. "Factory New"
    totalValueCoins: { type: Number, required: true },  // total_value / 100 (coin-cents → coins)
    soldAt:          { type: Date,   required: true },  // from created_at
    iconUrl:         { type: String, default: null },
    source:          { type: String, default: "api:item_detail" },
  },
  { timestamps: false, versionKey: false }
);

// Primary dedup guard — Empire sale IDs are globally unique
soldHistorySchema.index({ saleId: 1 }, { unique: true });

// Aggregation query index — supports 30d/90d/1yr rolling window queries
soldHistorySchema.index({ marketHashName: 1, wear: 1, soldAt: -1 });

const SoldHistory = mongoose.model("SoldHistory", soldHistorySchema);
export default SoldHistory;
