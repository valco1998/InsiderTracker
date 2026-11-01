/**
 * Repairs missing TradeMatchNotifications.
 * Run from server/ directory: node scripts/repairNotifications.mjs
 *
 * Scans every active TradePost against every ImportedInventory,
 * creates any missing notifications, and prints a full report.
 */
import "dotenv/config";
import mongoose from "mongoose";
import ImportedInventory      from "../models/ImportedInventory.model.js";
import TradeMatchNotification from "../models/TradeMatchNotification.model.js";
import TradePost              from "../models/TradePost.model.js";

function extractBaseName(mhn) {
  return String(mhn || "")
    .replace(/\s*\((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)\s*$/i, "")
    .trim()
    .toLowerCase();
}
function normalizeExterior(ext) {
  return ext ? String(ext).trim().toLowerCase() : null;
}

await mongoose.connect(process.env.MONGO_URL);
console.log("✅ Connected to MongoDB\n");

const posts = await TradePost.find({ status: "active" }).lean();
const invs  = await ImportedInventory.find({}).lean();

console.log(`Posts: ${posts.length}  Inventories: ${invs.length}\n`);

let created = 0;
let skipped = 0;
let errors  = 0;

for (const post of posts) {
  const ownerStr    = String(post.ownerUserId);
  const realLooking = (post.lookingForItems || []).filter(i => !i.isSpecial);
  if (!realLooking.length) continue;

  const wantedItems = realLooking.map(item => ({
    baseName: extractBaseName(item.marketHashName || item.name),
    exterior: normalizeExterior(item.exterior),
  }));

  const offerPreview = (post.myOfferItems || []).slice(0, 6).map(item => ({
    name:           item.name           || "",
    marketHashName: item.marketHashName || "",
    iconUrl:        item.iconUrl        || "",
    exterior:       item.exterior       || null,
    rarity:         item.rarity         || null,
  }));

  for (const inv of invs) {
    if (String(inv.userId) === ownerStr) continue;
    if (!inv.items?.length) continue;

    const matchedItems = [];
    for (const wanted of wantedItems) {
      const found = inv.items.find(invItem => {
        const invBase = extractBaseName(invItem.marketHashName || invItem.name);
        if (invBase !== wanted.baseName) return false;
        if (wanted.exterior) return normalizeExterior(invItem.exterior) === wanted.exterior;
        return true;
      });
      if (found) {
        matchedItems.push({
          name:           found.name           || found.marketHashName || "",
          marketHashName: found.marketHashName || found.name           || "",
          iconUrl:        found.iconUrl        || found.icon_url       || "",
          exterior:       found.exterior       || null,
          rarity:         found.rarity         || null,
        });
      }
    }

    if (!matchedItems.length) continue;

    try {
      await TradeMatchNotification.create({
        recipientUserId: inv.userId,
        tradePostId:     post._id,
        senderUserId:    post.ownerUserId,
        senderUsername:  post.ownerUsername  || "",
        senderSteamId:   post.ownerSteamId   || "",
        senderAvatarUrl: post.ownerAvatarUrl || "",
        matchedItems,
        offerItems: offerPreview,
      });
      created++;
      console.log(`  ✓ CREATED  post=${post._id} → recipient=${inv.userId}  items=[${matchedItems.map(i=>i.name).join(", ")}]`);
    } catch (err) {
      if (err.code === 11000) {
        skipped++;
        console.log(`  · SKIP (duplicate)  post=${post._id} → recipient=${inv.userId}`);
      } else {
        errors++;
        console.error(`  ✗ ERROR  post=${post._id}:`, err.message);
      }
    }
  }
}

console.log(`\n════ Done — created=${created} skipped=${skipped} errors=${errors} ════`);
await mongoose.disconnect();
