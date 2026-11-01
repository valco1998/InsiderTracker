// server/services/insiderAlertRuntime.js
// Wires the alert engine to MongoDB, the existing delivery pipeline and the ingest.
// Triggered after each ingest batch and every 30s (so settle windows elapse).
import InsiderWatch from "../models/InsiderWatch.model.js";
import InsiderAlertClaim from "../models/InsiderAlertClaim.model.js";
import { createAlertEngine } from "./insiderAlertEngine.js";
import { deliverAlert } from "./alertDelivery.js";
import { buildInsiderAlertDoc, buildInsiderPushPayload } from "./insiderPushFormat.js";
import { getEconomicTransactions } from "./edgar/insiderData.js";
import { onIngestBatch, getIngestStatus } from "./edgar/insiderIngest.js";
import { isAccountsReady } from "./insiderDb.js";
import { isFcmReady } from "./fcm.js";
import { emitToUser } from "../socket/insiderSocket.js";

const TICK_MS = 30_000;
let engine = null;
let timer = null;

export function startInsiderAlerts({ flags, firebaseIsolated }) {
  if (engine) return engine;
  engine = createAlertEngine({
    flags,
    deps: {
      getTransactions: getEconomicTransactions,
      findWatches: (ciks) => InsiderWatch.find({ enabled: true, cik: { $in: ciks } }).lean(),
      claim: async (c) => {
        try {
          await InsiderAlertClaim.create({
            userId: c.watch.userId, economicId: c.alertKey, watchId: c.watch._id, ticker: c.tx.ticker || "",
            accessionNos: (c.tx.reportedBy || [c.tx]).map((r) => r.accessionNo),
          });
          return true;
        } catch (err) {
          if (err?.code === 11000) return false;
          throw err;
        }
      },
      deliver: (c) => deliverAlert({
        userId: c.watch.userId,
        alert: buildInsiderAlertDoc(c),
        buildPush: (alertId) => buildInsiderPushPayload({ tx: c.tx, alertId, alertKey: c.alertKey }),
        emit: (payload) => emitToUser(c.watch.userId, "insider:alert", payload),
      }),
      markClaim: (c, update) => InsiderAlertClaim.updateOne({ userId: c.watch.userId, economicId: c.alertKey }, { $set: update }),
      isDbReady: () => isAccountsReady(),
      isIngestReady: () => !!getIngestStatus().initialSyncCompletedAt,
      // Real delivery only with a verified DB AND an isolated, initialized Firebase project.
      isLiveReady: () => isAccountsReady() && firebaseIsolated && isFcmReady(),
    },
  });

  if (!flags.enabled) {
    console.log("[INSIDER_ALERTS] engine disabled (INSIDER_ALERTS_ENABLED is not true)");
    return engine;
  }
  onIngestBatch(() => engine.runOnce());
  timer = setInterval(() => engine.runOnce(), TICK_MS);
  timer.unref?.();
  console.log(`[INSIDER_ALERTS] engine started dryRun=${flags.dryRun} settleMs=${flags.settleMs} maxAgeH=${flags.maxAgeMs / 3600_000}`);
  return engine;
}

export function getAlertEngineStats() {
  return engine ? engine.getStats() : null;
}
