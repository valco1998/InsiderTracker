// server/services/alertDelivery.js
//
// deliverAlert(): the existing SkinTel delivery sequence as one reusable
// function, in the same order (see controllers/alerts.controller.js
// processMatchedItem):
//   AlertLog.create → socket emit → socketEmitAt → pushStartAt +
//   PUSH_SEND_START → sendPushToUser (fire-and-forget, result logged)
// fcm.js itself is not modified.
import AlertLog from "../models/alertLog.models.js";
import { isFcmReady, sendPushToUser } from "./fcm.js";
import { recordEvent, recordAlertTiming } from "./notificationMetrics.js";
import { redact } from "../utils/safeLog.js";

const defaultDeps = { AlertLog, isFcmReady, sendPushToUser, recordEvent, recordAlertTiming };

// alert:    AlertLog fields (ruleId, itemId, name, …)
// buildPush(alertId) → { title, body, data } (data.alertId must equal alertId)
// emit(payload)       → optional realtime emit
// → { alertId, push: "started" | "not_ready" }; throws if the AlertLog cannot be created.
export async function deliverAlert({ userId, alert, buildPush, emit, matchedAt = Date.now(), deps = defaultDeps }) {
  const uid = String(userId);
  const created = await deps.AlertLog.create({
    ...alert,
    userId,
    isRead: false,
    triggeredAt: new Date(),
    timing: { matchedAt: new Date(matchedAt) },
  });
  const alertId = String(created._id);
  console.log(`[ALERT_LOG_CREATED] alertId=${alertId} userId=${uid} itemId=${alert.itemId} source=${alert.source}`);

  if (emit) {
    try {
      emit({ ...(created.toObject?.() ?? created), id: alertId, _id: alertId, userId: uid });
    } catch (err) {
      console.warn(`[SOCKET_EMIT_FAIL] alertId=${alertId} err=${redact(err)}`);
    }
  }
  deps.recordAlertTiming(created._id, "socketEmitAt");

  if (!deps.isFcmReady()) {
    console.error(`[PUSH_FAIL] alertId=${alertId} userId=${uid} — Firebase Admin not initialized`);
    return { alertId, push: "not_ready" };
  }

  deps.recordAlertTiming(created._id, "pushStartAt");
  deps.recordEvent("PUSH_SEND_START", { userId, alertId: created._id, ruleId: alert.ruleId, itemId: alert.itemId, source: alert.source });
  const payload = buildPush(alertId);
  if (payload?.data?.alertId !== alertId) throw new Error("push payload alertId must equal the AlertLog id");

  deps.sendPushToUser(uid, payload).then((result) => {
    if (result?.successCount > 0) console.log(`[PUSH_SEND_OK] alertId=${alertId} userId=${uid} sent=${result.successCount}/${result.tokenCount}`);
    else if (result?.skipped) console.log(`[PUSH_DUPLICATE_SKIPPED] alertId=${alertId} userId=${uid}`);
    else if (result?.aggregated) console.log(`[PUSH_AGGREGATED_QUEUED] alertId=${alertId} userId=${uid}`);
    else if (result) console.error(`[PUSH_FAIL] alertId=${alertId} userId=${uid} sent=0/${result.tokenCount}`);
    else console.error(`[PUSH_FAIL] alertId=${alertId} userId=${uid} — null result`);
  }).catch((err) => console.error(`[PUSH_FAIL] alertId=${alertId} exception=${redact(err)}`));

  return { alertId, push: "started" };
}
