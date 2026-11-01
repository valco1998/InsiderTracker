/**
 * Run from server/ directory:
 *   node scripts/checkPipeline.mjs
 * Shows the current state of the trade notification pipeline in MongoDB.
 */
import "dotenv/config";
import mongoose from "mongoose";

const MONGO_URL = process.env.MONGO_URL;

const ImportedInventorySchema = new mongoose.Schema({
  userId:    mongoose.Schema.Types.ObjectId,
  steamId:   String,
  items:     [mongoose.Schema.Types.Mixed],
  itemCount: Number,
  importedAt: Date,
  updatedAt:  Date,
}, { collection: "importedinventories" });

const TradeMatchNotificationSchema = new mongoose.Schema({
  recipientUserId: mongoose.Schema.Types.ObjectId,
  tradePostId:     mongoose.Schema.Types.ObjectId,
  senderUsername:  String,
  matchedItems:    [mongoose.Schema.Types.Mixed],
  read:            Boolean,
}, { timestamps: true, collection: "tradematchnotifications" });

const TradePostSchema = new mongoose.Schema({
  ownerUserId:    mongoose.Schema.Types.ObjectId,
  ownerUsername:  String,
  lookingForItems:[mongoose.Schema.Types.Mixed],
  myOfferItems:   [mongoose.Schema.Types.Mixed],
  status:         String,
  matchCount:     Number,
}, { timestamps: true, collection: "tradeposts" });

const ImportedInventory      = mongoose.model("ImportedInventory",      ImportedInventorySchema);
const TradeMatchNotification = mongoose.model("TradeMatchNotification", TradeMatchNotificationSchema);
const TradePost              = mongoose.model("TradePost",              TradePostSchema);

function extractBaseName(mhn) {
  return String(mhn || "")
    .replace(/\s*\((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)\s*$/i, "")
    .trim()
    .toLowerCase();
}

function normalizeExterior(ext) {
  return ext ? String(ext).trim().toLowerCase() : null;
}

await mongoose.connect(MONGO_URL);
console.log("✅ Connected to MongoDB\n");

/* ── 1. ImportedInventory ── */
const invDocs = await ImportedInventory.find({}).lean();
console.log(`═══ ImportedInventory (${invDocs.length} documents) ═══`);
for (const inv of invDocs) {
  const count = inv.items?.length || 0;
  console.log(`  userId=${inv.userId}  steamId=${inv.steamId || "?"}  items.length=${count}  itemCount=${inv.itemCount ?? "unset"}`);
  if (count > 0) {
    const sample = inv.items.slice(0, 3).map(i => ({
      name:          i.name           || "(none)",
      marketHashName:i.marketHashName || "(none)",
      exterior:      i.exterior       || "null",
    }));
    console.log(`    sample items:`, JSON.stringify(sample, null, 2));
  }
}

/* ── 2. Active TradePosts ── */
const posts = await TradePost.find({ status: "active" }).sort({ createdAt: -1 }).limit(10).lean();
console.log(`\n═══ Active TradePosts (${posts.length} shown) ═══`);
for (const p of posts) {
  const looking = (p.lookingForItems || []).map(i => `"${i.marketHashName || i.name}" ext="${i.exterior || "any"}" special=${i.isSpecial}`);
  console.log(`  post=${p._id}  owner=${p.ownerUsername} (${p.ownerUserId})`);
  console.log(`    lookingFor: ${looking.join(", ") || "(none)"}`);
}

/* ── 3. TradeMatchNotifications ── */
const notifs = await TradeMatchNotification.find({}).sort({ createdAt: -1 }).limit(10).lean();
console.log(`\n═══ TradeMatchNotifications (${notifs.length} shown) ═══`);
for (const n of notifs) {
  console.log(`  id=${n._id}  recipient=${n.recipientUserId}  from="${n.senderUsername}"  read=${n.read}  createdAt=${n.createdAt?.toISOString()}`);
  const items = (n.matchedItems || []).map(i => i.name || i.marketHashName).join(", ");
  console.log(`    matchedItems: ${items || "(none)"}`);
}

/* ── 4. Cross-check: would any post match any inventory? ── */
console.log(`\n═══ Cross-match simulation ═══`);
for (const post of posts) {
  const realLooking = (post.lookingForItems || []).filter(i => !i.isSpecial);
  if (!realLooking.length) continue;

  const wantedItems = realLooking.map(item => ({
    baseName: extractBaseName(item.marketHashName || item.name),
    exterior: normalizeExterior(item.exterior),
    raw:      item.marketHashName || item.name,
  }));

  for (const inv of invDocs) {
    if (String(inv.userId) === String(post.ownerUserId)) continue; // skip owner
    if (!inv.items?.length) continue;

    for (const wanted of wantedItems) {
      const found = inv.items.find(invItem => {
        const invBase = extractBaseName(invItem.marketHashName || invItem.name);
        if (invBase !== wanted.baseName) return false;
        if (wanted.exterior) return normalizeExterior(invItem.exterior) === wanted.exterior;
        return true;
      });

      if (found) {
        const notifExists = notifs.some(
          n => String(n.recipientUserId) === String(inv.userId) &&
               String(n.tradePostId)     === String(post._id)
        );
        console.log(`  ✓ MATCH: post=${post._id} owner="${post.ownerUsername}" → inv userId=${inv.userId}`);
        console.log(`    wanted: "${wanted.raw}" → found: "${found.marketHashName || found.name}" ext="${found.exterior}"`);
        console.log(`    notification exists in DB: ${notifExists}`);
      }
    }
  }
}

await mongoose.disconnect();
console.log("\n✅ Done");
