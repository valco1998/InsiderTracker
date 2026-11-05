/**
 * Diagnostic follow-up: classify AlertState claims (last 24h) that have no
 * matching AlertLog. Determines whether ruleId belongs to WatchRule or
 * AuctionAlertRule, and whether ANY AlertLog exists for that user+item
 * regardless of ruleId/source. Read-only.
 *
 * Run from server/:  node scripts/watchlistMissingAlertDiag.mjs
 */
import "../config/legacyServerGuard.js"; // must stay the FIRST import: refuses InsiderTracker databases (legacy SkinTel code)
import "dotenv/config";
import mongoose from "mongoose";

import WatchRule from "../models/WatchRule.model.js";
import AuctionAlertRule from "../models/AuctionAlertRule.model.js";
import AlertLog from "../models/alertLog.models.js";
import AlertState from "../models/AlertState.js";

const MONGO_URL = (process.env.MONGO_URI || process.env.MONGO_URL || "").trim();
await mongoose.connect(MONGO_URL, { serverSelectionTimeoutMS: 15000 });
console.log("Connected to:", mongoose.connection.name || "(default db)");

const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

const recentStates = await AlertState.find({ lastNotifiedAt: { $gte: since24h } }).lean();
console.log(`AlertState docs in last 24h: ${recentStates.length}`);

let watchRuleCount = 0, auctionRuleCount = 0, unknownRuleCount = 0;
let anyAlertLogForUserItem = 0, noAlertLogAtAll = 0;

const sampleDetails = [];

for (const st of recentStates) {
  const exists5min = await AlertLog.exists({
    userId: st.userId, ruleId: st.ruleId, itemId: st.itemId,
    triggeredAt: { $gte: new Date(st.lastNotifiedAt.getTime() - 5 * 60 * 1000) },
  });
  if (exists5min) continue; // not "missing" — already counted in prior script

  const [isWatch, isAuction, anyLogForUserItem] = await Promise.all([
    WatchRule.exists({ _id: st.ruleId }),
    AuctionAlertRule.exists({ _id: st.ruleId }),
    AlertLog.exists({ userId: st.userId, itemId: st.itemId, triggeredAt: { $gte: since24h } }),
  ]);

  if (isWatch) watchRuleCount++;
  else if (isAuction) auctionRuleCount++;
  else unknownRuleCount++;

  if (anyLogForUserItem) anyAlertLogForUserItem++;
  else noAlertLogAtAll++;

  if (sampleDetails.length < 15) {
    sampleDetails.push({
      ruleId: String(st.ruleId),
      itemId: st.itemId,
      ruleType: isWatch ? "WatchRule" : isAuction ? "AuctionAlertRule" : "UNKNOWN",
      anyAlertLogForUserItem: !!anyLogForUserItem,
      lastNotifiedAt: st.lastNotifiedAt.toISOString(),
    });
  }
}

console.log(`\nOf the "missing" AlertState claims:`);
console.log(`  ruleId belongs to WatchRule:        ${watchRuleCount}`);
console.log(`  ruleId belongs to AuctionAlertRule: ${auctionRuleCount}`);
console.log(`  ruleId belongs to NEITHER (orphan): ${unknownRuleCount}`);
console.log(`  has SOME AlertLog for user+item (any ruleId/source) in 24h: ${anyAlertLogForUserItem}`);
console.log(`  has NO AlertLog at all for user+item in 24h:                ${noAlertLogAtAll}`);

console.log(`\nSample (up to 15):`);
for (const s of sampleDetails) console.log(" ", JSON.stringify(s));

await mongoose.disconnect();
console.log("\nDone.");
