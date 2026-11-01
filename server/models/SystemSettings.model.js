import mongoose from "mongoose";
const { Schema } = mongoose;

const SystemSettingsSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    value: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

export default mongoose.model("SystemSettings", SystemSettingsSchema);
