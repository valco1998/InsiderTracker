import mongoose from "mongoose";

/**
 * Generic event log for the notification reliability dashboard.
 * Covers infrastructure-level events that aren't tied to a single AlertLog
 * (push outcomes, token churn, WS health, restarts, dedupe skips).
 *
 * Per-alert lifecycle timing (MATCH -> CREATED -> SOCKET -> PUSH) lives on
 * AlertLog.timing instead — see alertLog.models.js.
 *
 * TTL ~8 days — covers the 7-day dashboard window with margin.
 */
const notificationEventSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: [
      "PUSH_SEND_START",
      "PUSH_SEND_SUCCESS",
      "PUSH_SEND_FAIL",
      "ALERT_DUPLICATE_SKIPPED",
      "ALERT_CREATE_FAILED",
      "TOKEN_REGISTERED",
      "TOKEN_INVALID_REMOVED",
      "WS_DISCONNECT",
      "WS_RECONNECT",
      "WS_WATCHDOG_RESTART",
      "SERVER_RESTART",
      // Best-effort receipt posted by firebase-messaging-sw.js when a real alert
      // push reaches the service worker (POST /api/push/device-received).
      "DEVICE_RECEIVED",
    ],
    required: true,
    index: true,
  },

  userId:  { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
  alertId: { type: mongoose.Schema.Types.ObjectId, ref: "AlertLog", default: null },
  ruleId:  { type: mongoose.Schema.Types.ObjectId, default: null },
  itemId:  { type: String, default: null },
  source:  { type: String, default: null },

  latencyMs: { type: Number, default: null },

  meta: { type: mongoose.Schema.Types.Mixed, default: {} },

  // Indexed by the 8-day TTL index below — declared once (see alertLog.models.js).
  createdAt: { type: Date, default: Date.now },
});

notificationEventSchema.index({ type: 1, createdAt: -1 });
notificationEventSchema.index({ userId: 1, createdAt: -1 });

// TTL — auto-delete after 8 days
notificationEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 8 * 24 * 3600 });

export default mongoose.models.NotificationEvent ||
  mongoose.model("NotificationEvent", notificationEventSchema);
