import mongoose from "mongoose";

const DeviceTokenSchema = new mongoose.Schema(
  {
    userId:          { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    token:           { type: String, required: true, unique: true, trim: true },
    active:          { type: Boolean, default: true, index: true },

    // Device metadata — populated at registration time from client UA / explicit fields
    platform:        { type: String, default: "web", trim: true },   // "web" | "android" | "ios"
    browser:         { type: String, default: "",    trim: true },   // "Chrome" | "Firefox" | "Safari" | …

    // Lifecycle timestamps — used for debugging + TTL cleanup
    lastSeenAt:      { type: Date,    default: null }, // last time token was registered / refreshed
    lastPushAt:      { type: Date,    default: null }, // last time a push was attempted to this token
    lastPushSuccess: { type: Boolean, default: null }, // outcome of most recent push attempt
    failCount:       { type: Number,  default: 0 },   // consecutive FCM failures (reset on success)

    // Populated when FCM returns a terminal error (e.g. registration-token-not-registered).
    // Lets /push/health and the client distinguish "never registered" from "server deactivated".
    failureReason:   { type: String,  default: null },
    lastFailureAt:   { type: Date,    default: null },
  },
  { timestamps: true }
);

// Hard-delete tokens whose owner has not refreshed them in 90 days.
// lastSeenAt is set on every POST /push/register call.
// sparse: true so existing tokens without lastSeenAt are not immediately expired.
DeviceTokenSchema.index(
  { lastSeenAt: 1 },
  { expireAfterSeconds: 90 * 24 * 3600, sparse: true }
);

export default mongoose.model("DeviceToken", DeviceTokenSchema);
