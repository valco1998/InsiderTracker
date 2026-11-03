import mongoose from "mongoose";

const UserSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, trim: true, unique: true },
    fullName: { type: String, trim: true, default: "" },
    // Optional for Steam-only users; sparse so multiple null values are allowed
    email: { type: String, trim: true, lowercase: true, unique: true, sparse: true },
    passwordHash: { type: String },
    gender: {
      type: String,
      enum: ["male", "female", "other", "unspecified"],
      default: "unspecified",
    },
    avatarUrl: { type: String, default: "" },
    // Steam OAuth fields
    steamId:          { type: String, unique: true, sparse: true },
    steamDisplayName: { type: String, default: "" },
    steamProfileUrl:  { type: String, default: "" },
    // Steam trade URL (user-provided, not a credential)
    tradeUrl:         { type: String, default: "" },
    // Google sign-in (Firebase Authentication) — stable identity
    firebaseUid:  { type: String, unique: true, sparse: true },
    authProvider: { type: String, default: "" },
    lastLoginAt:  { type: Date },
    // User notification preferences
    tradeMatchAlertsEnabled: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model("User", UserSchema);