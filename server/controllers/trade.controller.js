import mongoose from "mongoose";
import TradePost from "../models/TradePost.model.js";
import TradeComment from "../models/TradeComment.model.js";
import TradeMatchNotification from "../models/TradeMatchNotification.model.js";
import ImportedInventory from "../models/ImportedInventory.model.js";
import { getIO, emitTradePost } from "../socket/socket.js";
import { sendPushToUser } from "../services/fcm.js";

/* ─── Serializers ───────────────────────────────────── */

function serializePost(doc) {
  return {
    id:              String(doc._id),
    ownerUserId:     String(doc.ownerUserId),
    ownerSteamId:    doc.ownerSteamId   || "",
    ownerUsername:   doc.ownerUsername  || "",
    ownerAvatarUrl:  doc.ownerAvatarUrl || "",
    myOfferItems:    doc.myOfferItems   || [],
    lookingForItems: doc.lookingForItems|| [],
    message:         doc.message        || "",
    status:          doc.status,
    matchCount:      doc.matchCount     || 0,
    commentCount:    doc.commentCount   || 0,
    unreadComments:  doc.unreadComments || 0,
    createdAt:       doc.createdAt instanceof Date ? doc.createdAt.toISOString() : String(doc.createdAt),
    bumpedAt:        doc.bumpedAt instanceof Date  ? doc.bumpedAt.toISOString()  : (doc.bumpedAt || null),
  };
}

function serializeComment(doc) {
  return {
    id:              String(doc._id),
    tradePostId:     String(doc.tradePostId),
    senderUserId:    String(doc.senderUserId),
    senderSteamId:   doc.senderSteamId   || "",
    senderUsername:  doc.senderUsername  || "",
    senderAvatarUrl: doc.senderAvatarUrl || "",
    offeredItems:    doc.offeredItems    || [],
    message:         doc.message        || "",
    readByOwner:     !!doc.readByOwner,
    createdAt:       doc.createdAt instanceof Date ? doc.createdAt.toISOString() : String(doc.createdAt),
  };
}

function serializeNotification(doc) {
  return {
    id:             String(doc._id),
    recipientUserId:String(doc.recipientUserId),
    tradePostId:    String(doc.tradePostId),
    senderUserId:   String(doc.senderUserId),
    senderUsername: doc.senderUsername  || "",
    senderSteamId:  doc.senderSteamId   || "",
    senderAvatarUrl:doc.senderAvatarUrl || "",
    matchedItems:   doc.matchedItems    || [],
    offerItems:     doc.offerItems      || [],
    read:           doc.read,
    createdAt:      doc.createdAt instanceof Date ? doc.createdAt.toISOString() : String(doc.createdAt),
  };
}

/* ─── Item sanitizer ────────────────────────────────── */

function sanitizeItem(raw) {
  const mhn  = String(raw.marketHashName || raw.name || "").trim().slice(0, 300);
  const name = String(raw.name || raw.marketHashName || "").trim().slice(0, 300);
  return {
    assetId:        String(raw.assetId || raw.assetid || "").slice(0, 30),
    name,
    marketHashName: mhn,
    iconUrl:        String(raw.iconUrl || "").trim().slice(0, 2000),
    exterior:       raw.exterior ? String(raw.exterior).slice(0, 80) : null,
    rarity: raw.rarity ? {
      name:  String(raw.rarity.name  || "").slice(0, 80),
      color: String(raw.rarity.color || "").replace(/[^0-9a-fA-F#]/g, "").slice(0, 10),
    } : null,
    quantity:  Math.min(99, Math.max(1, Number(raw.quantity) || 1)),
    isSpecial: !!raw.isSpecial,
  };
}

/* ─── Match detection helpers ───────────────────────── */

/* Strip wear suffix: "AK-47 | Redline (Field-Tested)" → "ak-47 | redline" */
function extractBaseName(mhn) {
  return String(mhn || "")
    .replace(/\s*\((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)\s*$/i, "")
    .trim()
    .toLowerCase();
}

function normalizeExterior(ext) {
  return ext ? String(ext).trim().toLowerCase() : null;
}

function extractExteriorFromMHN(mhn) {
  const m = String(mhn || "").match(/\((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)$/i);
  return m ? m[1].toLowerCase() : null;
}

function extractWeaponBase(baseName) {
  const pipe = baseName.indexOf(" | ");
  return pipe > -1 ? baseName.slice(0, pipe).trim() : baseName;
}

const SERVER_WEAPON_CATEGORY = {
  "ak-47":"rifle","m4a4":"rifle","m4a1-s":"rifle","famas":"rifle","galil ar":"rifle",
  "sg 553":"rifle","aug":"rifle","awp":"sniper","scar-20":"sniper","g3sg1":"sniper",
  "ssg 08":"sniper","desert eagle":"pistol","glock-18":"pistol","usp-s":"pistol",
  "p250":"pistol","five-seven":"pistol","tec-9":"pistol","cz75-auto":"pistol",
  "r8 revolver":"pistol","dual berettas":"pistol","p2000":"pistol",
  "mp9":"smg","mac-10":"smg","mp5-sd":"smg","ump-45":"smg","p90":"smg",
  "mp7":"smg","pp-bizon":"smg","nova":"shotgun","xm1014":"shotgun",
  "sawed-off":"shotgun","mag-7":"shotgun","m249":"heavy","negev":"heavy",
  "karambit":"knife","butterfly knife":"knife","m9 bayonet":"knife",
  "bayonet":"knife","gut knife":"knife","flip knife":"knife",
  "huntsman knife":"knife","falchion knife":"knife","shadow daggers":"knife",
  "bowie knife":"knife","ursus knife":"knife","navaja knife":"knife",
  "stiletto knife":"knife","talon knife":"knife","classic knife":"knife",
  "paracord knife":"knife","survival knife":"knife","nomad knife":"knife",
  "skeleton knife":"knife","kukri knife":"knife",
  "sport gloves":"gloves","specialist gloves":"gloves","driver gloves":"gloves",
  "hand wraps":"gloves","moto gloves":"gloves","bloodhound gloves":"gloves",
  "hydra gloves":"gloves","broken fang gloves":"gloves",
};

function getItemCategory(baseName) {
  return SERVER_WEAPON_CATEGORY[extractWeaponBase(baseName)] || "other";
}

const SPECIAL_NAMES_SET = new Set(["any knife", "any key", "any case", "any offers", "real money"]);

/* Score 0-100 how well a single trade item matches a target (base + optional exterior) */
function scoreItemAgainstTarget(item, targetBase, targetExt) {
  if (!targetBase) return 0;
  const itemBase = extractBaseName(item.marketHashName || item.name || "");
  const itemExt  = normalizeExterior(item.exterior) || extractExteriorFromMHN(item.marketHashName || "");
  if (!itemBase) return 0;

  if (itemBase === targetBase) {
    if (!targetExt || targetExt === itemExt) return 100;
    return 75; // same skin, wrong wear
  }
  // Same weapon type
  if (extractWeaponBase(itemBase) === extractWeaponBase(targetBase)) return 45;
  // Same category (knife/rifle/pistol…)
  const ic = getItemCategory(itemBase), tc = getItemCategory(targetBase);
  if (ic !== "other" && ic === tc) return 25;
  return 0;
}

/* ─── Match detection ───────────────────────────────── */

async function runMatchDetection(tradePost) {
  const {
    _id: postId, ownerUserId, ownerUsername, ownerSteamId, ownerAvatarUrl,
    lookingForItems, myOfferItems,
  } = tradePost;

  const ownerStr = String(ownerUserId);

  console.log(`\n[MATCH] ════════════════════════════`);
  console.log(`[MATCH] new trade created — post=${postId}`);
  console.log(`[MATCH] post owner userId: ${ownerStr} username="${ownerUsername}"`);

  // ── lookingForItems ────────────────────────────────────
  const realLooking = (lookingForItems || []).filter(i => !i.isSpecial);

  console.log(`[MATCH] lookingForItems: total=${lookingForItems?.length || 0} non-special=${realLooking.length}`);
  realLooking.forEach((item, idx) => {
    const raw = item.marketHashName || item.name || "";
    console.log(`[MATCH]   [${idx}] "${raw}" exterior="${item.exterior || "null"}" isSpecial=${!!item.isSpecial}`);
  });

  if (!realLooking.length) {
    console.log(`[MATCH] STOP — no non-special looking-for items`);
    return 0;
  }

  const wantedItems = realLooking.map(item => {
    const raw  = item.marketHashName || item.name || "";
    const base = extractBaseName(raw);
    const ext  = normalizeExterior(item.exterior);
    return { baseName: base, exterior: ext, originalName: raw };
  });

  // ── Fetch ALL inventories so we can log the owner-skip decision ──
  const allInventories = await ImportedInventory.find({}).lean();
  console.log(`[MATCH] inventories found count: ${allInventories.length}`);

  const offerPreview = (myOfferItems || []).slice(0, 6).map(item => ({
    name:           item.name           || "",
    marketHashName: item.marketHashName || "",
    iconUrl:        item.iconUrl        || item.icon_url || "",
    exterior:       item.exterior       || null,
    rarity:         item.rarity         || null,
  }));

  let savedCount = 0;
  let dupeCount  = 0;

  for (const inv of allInventories) {
    const invUserId = String(inv.userId);
    const isOwner   = invUserId === ownerStr;

    // ── Owner check ──────────────────────────────────────
    console.log(`[MATCH] checking inventory owner: userId=${invUserId} steamId=${inv.steamId || "?"} items=${inv.items?.length ?? 0}`);
    console.log(`[MATCH] skip owner? ${isOwner}`);

    if (isOwner) continue;

    if (!Array.isArray(inv.items) || !inv.items.length) {
      console.log(`[MATCH] skip userId=${invUserId} — empty items array`);
      continue;
    }

    // ── Per-wanted-item comparison ───────────────────────
    const matchedItems = [];

    for (const wanted of wantedItems) {
      console.log(`[MATCH] compare lookingFor item: "${wanted.originalName}" baseName="${wanted.baseName}" ext="${wanted.exterior || "any"}"`);

      let found = null;

      for (const invItem of inv.items) {
        const rawName = invItem.marketHashName || invItem.name || "";
        const invBase = extractBaseName(rawName);
        const invExt  = normalizeExterior(invItem.exterior);

        // Log comparison only for candidates that share the first 5 chars (avoids log flood)
        if (invBase.slice(0, 5) !== wanted.baseName.slice(0, 5)) continue;

        console.log(`[MATCH] compare inventory item: "${rawName}" baseName="${invBase}" ext="${invItem.exterior || "null"}"`);

        const nameOk = invBase === wanted.baseName;
        const extOk  = !wanted.exterior || invExt === wanted.exterior;

        console.log(`[MATCH] match result: nameMatch=${nameOk} wearMatch=${extOk} → ${nameOk && extOk ? "MATCH TRUE ✓" : "MATCH FALSE ✗"}`);

        if (nameOk && extOk) {
          found = invItem;
          break;
        }
      }

      if (!found) {
        console.log(`[MATCH] match result: MATCH FALSE — "${wanted.originalName}" not in userId=${invUserId}`);
      } else {
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

    // ── Save notification (DB first, socket after) ──────
    let notif;
    try {
      notif = await TradeMatchNotification.create({
        recipientUserId: inv.userId,
        tradePostId:     postId,
        senderUserId:    ownerUserId,
        senderUsername:  ownerUsername,
        senderSteamId:   ownerSteamId,
        senderAvatarUrl: ownerAvatarUrl,
        matchedItems,
        offerItems: offerPreview,
      });
      savedCount++;
      console.log(`[ALERT_CREATED] source=trade_match notifId=${notif._id} recipientUserId=${invUserId} tradePostId=${postId} matchedItems=${matchedItems.length}`);
    } catch (err) {
      if (err.code === 11000) {
        dupeCount++;
        console.log(`[MATCH] notification DUPE — already exists for recipient=${invUserId} post=${postId}`);
        continue;
      }
      console.error(`[MATCH] notification save ERROR recipient=${invUserId}:`, err.message, err.stack);
      continue;
    }

    // ── Socket (best-effort; DB is source of truth) ─────
    const room = `user:${invUserId}`;
    try {
      const io            = getIO();
      const activeSockets = await io.in(room).fetchSockets();
      io.to(room).emit("trade:match", {
        notification: serializeNotification(notif),
        tradePostId:  String(postId),
      });
      console.log(`[SOCKET_EMIT] source=trade_match notifId=${notif._id} recipientUserId=${invUserId} room="${room}" connections=${activeSockets.length}`);
    } catch (err) {
      console.warn(`[MATCH] socket emit FAILED (${err.message}) — notification in DB, client polls in 15s`);
    }

    // ── FCM push notification (fire-and-forget, additive to socket) ─────────
    const firstMatch = matchedItems[0];
    const matchName  = firstMatch?.marketHashName || firstMatch?.name || "an item";
    console.log(`[PUSH_SEND_START] source=trade_match notifId=${notif._id} recipientUserId=${invUserId} tradePostId=${postId}`);
    sendPushToUser(invUserId, {
      title: "Trade Match on SkinTel",
      body:  `${ownerUsername} wants ${matchName} — check their trade offer`,
      data: {
        type:    "trade_match",
        tradeId: String(postId),
        url:     `/trade/${postId}`,
      },
    }).then((result) => {
      if (!result) {
        console.error(`[PUSH_SEND_FAIL] source=trade_match notifId=${notif._id} recipientUserId=${invUserId} — sendPushToUser returned null (Firebase Admin not initialized)`);
        return;
      }
      if (result.successCount > 0) {
        const ids = result.perToken?.filter(t => t.success).map(t => t.messageId).join(", ");
        console.log(`[PUSH_SEND_OK] source=trade_match notifId=${notif._id} recipientUserId=${invUserId} sent=${result.successCount}/${result.tokenCount} messageIds=[${ids}]`);
      } else {
        const errs = result.perToken?.filter(t => !t.success).map(t => t.error).join("; ");
        console.error(`[PUSH_SEND_FAIL] source=trade_match notifId=${notif._id} recipientUserId=${invUserId} sent=0/${result.tokenCount} errors=[${errs}]`);
      }
    }).catch((err) => {
      console.error(`[PUSH_SEND_FAIL] source=trade_match notifId=${notif._id} recipientUserId=${invUserId} exception=${err.message}`);
    });
  }

  console.log(`[MATCH] DONE post=${postId} — saved=${savedCount} dupes=${dupeCount}`);
  console.log(`[MATCH] ════════════════════════════\n`);
  return savedCount;
}

/* ─── matchNewPost ──────────────────────────────────
 * Runs the same matching used by rescanActivePosts,
 * but for a single newly-created post.
 * Fetches the post with .lean() (plain object) so
 * behaviour is identical to the confirmed-working rescan.
 * ─────────────────────────────────────────────────── */
async function matchNewPost(postId) {
  const leanPost = await TradePost.findById(postId).lean();
  if (!leanPost) {
    console.warn(`[MATCH] matchNewPost: post ${postId} not found in DB`);
    return;
  }
  console.log(`[MATCH] matchNewPost — fetched lean post ${postId}, starting detection`);
  const saved = await runMatchDetection(leanPost);
  if (saved > 0) {
    TradePost.findByIdAndUpdate(postId, { $set: { matchCount: saved } }).catch(() => {});
  }
}

/* ═══════════════════════════════════════════════════
   POST /api/trades
   Ownership validation: every non-special offer item
   must exist in req.user's synced inventory.
═══════════════════════════════════════════════════ */
export async function createTradePost(req, res) {
  try {
    const me = req.user;
    const { myOfferItems = [], lookingForItems = [], message = "" } = req.body ?? {};

    if (!myOfferItems.length && !lookingForItems.length) {
      return res.status(400).json({ ok: false, error: "Add at least one offer or looking-for item." });
    }

    // ── Active post limit (max 8) ──────────────────────────
    // Count only status="active" — closed/deleted posts do not count.
    // Re-queried inside the same request so there is no stale cached value.
    const activeCount = await TradePost.countDocuments({
      ownerUserId: me._id,   // matches schema field: TradePostSchema.ownerUserId
      status:      "active",
    });
    console.log(`[trade] post limit check — user=${me.username} active=${activeCount}/8`);
    if (activeCount >= 8) {
      console.log(`[trade] post limit BLOCKED — user=${me.username} already has ${activeCount} active posts`);
      return res.status(400).json({
        ok:      false,
        error:   "MAX_ACTIVE_POSTS",
        message: "You can only have up to 8 active trade posts.",
      });
    }

    // ── Ownership validation for offer items ──
    const realOfferItems = (myOfferItems || []).filter(i => !i.isSpecial && i.assetId);
    if (realOfferItems.length > 0) {
      const inv = await ImportedInventory.findOne({ userId: me._id }).lean();
      if (!inv || !inv.items?.length) {
        return res.status(400).json({ ok: false, error: "You have no synced inventory. Use the extension to import your CS2 items first." });
      }

      const ownedAssetIds = new Set(inv.items.map(i => String(i.assetId || i.assetid || "")));
      const invalidItems  = realOfferItems.filter(i => !ownedAssetIds.has(String(i.assetId)));

      if (invalidItems.length > 0) {
        console.warn(`[trade] ownership check failed for user ${me._id}: items ${invalidItems.map(i => i.assetId).join(", ")} not found in inventory`);
        return res.status(403).json({
          ok: false,
          error: "One or more offered items don't belong to your synced inventory.",
          invalidAssetIds: invalidItems.map(i => i.assetId),
        });
      }
    }

    const safeOffer   = (myOfferItems   || []).slice(0, 12).map(sanitizeItem).filter(i => i.name);
    const safeLooking = (lookingForItems|| []).slice(0, 12).map(sanitizeItem).filter(i => i.name);

    if (!safeOffer.length && !safeLooking.length) {
      return res.status(400).json({ ok: false, error: "No valid items after sanitization." });
    }

    const post = await TradePost.create({
      ownerUserId:    me._id,
      ownerSteamId:   me.steamId    || "",
      ownerUsername:  me.username   || "",
      ownerAvatarUrl: me.avatarUrl  || "",
      myOfferItems:   safeOffer,
      lookingForItems:safeLooking,
      message:        String(message || "").trim().slice(0, 500),
    });

    console.log(`[MATCH] trade created — post=${post._id} owner=${me.username}`);
    console.log(`[MATCH] lookingForItems: ${safeLooking.map(i => i.marketHashName || i.name).join(" | ") || "(none)"}`);

    // Broadcast new post to ALL connected clients so every Trade Board updates instantly
    emitTradePost(serializePost(post));

    // Fetch the newly saved post as a lean plain object — this is the EXACT same code
    // path that rescanActivePosts uses and is confirmed to work. Passing the raw
    // Mongoose document causes subtle subdocument issues that silently skip matching.
    matchNewPost(post._id).catch(err =>
      console.error("[MATCH] auto-detection error post=" + post._id + ":", err.message, err.stack)
    );

    return res.json({ ok: true, post: serializePost(post) });
  } catch (err) {
    console.error("[trade] createTradePost:", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

/* ═══════════════════════════════════════════════════
   GET /api/trades  (public)
═══════════════════════════════════════════════════ */
export async function listTradePosts(req, res) {
  try {
    const page  = Math.max(1, Number(req.query.page  || 1));
    const limit = Math.min(50, Math.max(1, Number(req.query.limit || 20)));
    const skip  = (page - 1) * limit;

    const [posts, total] = await Promise.all([
      TradePost.find({ status: "active" })
        .sort({ bumpedAt: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      TradePost.countDocuments({ status: "active" }),
    ]);

    return res.json({ ok: true, posts: posts.map(serializePost), total, page, limit });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}

/* ═══════════════════════════════════════════════════
   GET /api/trades/mine
═══════════════════════════════════════════════════ */
export async function myTradePosts(req, res) {
  try {
    const posts = await TradePost.find({ ownerUserId: req.user._id, status: "active" })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    return res.json({ ok: true, posts: posts.map(serializePost) });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}

/* ═══════════════════════════════════════════════════
   GET /api/trades/:id  (public)
═══════════════════════════════════════════════════ */
export async function getTradePost(req, res) {
  try {
    const post = await TradePost.findById(req.params.id).lean();
    if (!post) return res.status(404).json({ ok: false, error: "Trade post not found." });
    return res.json({ ok: true, post: serializePost(post) });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}

/* ═══════════════════════════════════════════════════
   PATCH /api/trades/:id/close
═══════════════════════════════════════════════════ */
export async function closeTradePost(req, res) {
  try {
    const post = await TradePost.findOne({ _id: req.params.id, ownerUserId: req.user._id });
    if (!post) return res.status(404).json({ ok: false, error: "Not found or not yours." });
    post.status = "closed";
    await post.save();
    return res.json({ ok: true, post: serializePost(post) });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}

/* ═══════════════════════════════════════════════════
   PATCH /api/trades/:id/bump
   Move post to top of feed (once every 30 min)
═══════════════════════════════════════════════════ */
export async function bumpTradePost(req, res) {
  try {
    const post = await TradePost.findOne({ _id: req.params.id, ownerUserId: req.user._id });
    if (!post) return res.status(404).json({ ok: false, error: "Not found or not yours." });
    if (post.status !== "active") return res.status(400).json({ ok: false, error: "Can only bump active posts." });

    const BUMP_COOLDOWN_MS = 3 * 60 * 60 * 1000; // 3 hours
    const lastBump = post.bumpedAt ? post.bumpedAt.getTime() : 0;
    const msSinceLastBump = Date.now() - lastBump;
    if (msSinceLastBump < BUMP_COOLDOWN_MS) {
      const nextBumpAt = new Date(lastBump + BUMP_COOLDOWN_MS).toISOString();
      return res.status(429).json({ ok: false, error: "BUMP_COOLDOWN", nextBumpAt });
    }

    post.bumpedAt = new Date();
    await post.save();
    return res.json({ ok: true, post: serializePost(post) });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}

/* ═══════════════════════════════════════════════════
   DELETE /api/trades/:id
═══════════════════════════════════════════════════ */
export async function deleteTradePost(req, res) {
  try {
    const postId = req.params.id;
    console.log(`[trade:delete] request — postId=${postId} userId=${req.user._id}`);

    const result = await TradePost.findOneAndDelete({ _id: postId, ownerUserId: req.user._id });
    if (!result) {
      console.warn(`[trade:delete] not found or not owner — postId=${postId} userId=${req.user._id}`);
      return res.status(404).json({ ok: false, error: "Not found or not yours." });
    }

    console.log(`[trade:delete] post deleted from DB — postId=${postId}`);

    const [notifResult, commentResult] = await Promise.all([
      TradeMatchNotification.deleteMany({ tradePostId: postId }),
      TradeComment.deleteMany({ tradePostId: postId }),
    ]);

    console.log(`[trade:delete] cleanup — notifications=${notifResult.deletedCount} comments=${commentResult.deletedCount}`);

    return res.json({ ok: true, deletedId: postId });
  } catch (err) {
    console.error(`[trade:delete] error:`, err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

/* ═══════════════════════════════════════════════════
   NOTIFICATIONS
═══════════════════════════════════════════════════ */
export async function getNotifications(req, res) {
  try {
    const notifications = await TradeMatchNotification
      .find({ recipientUserId: req.user._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    return res.json({ ok: true, notifications: notifications.map(serializeNotification) });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}

export async function getUnreadCount(req, res) {
  try {
    const count = await TradeMatchNotification.countDocuments({
      recipientUserId: req.user._id,
      read: false,
    });
    return res.json({ ok: true, count });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}

export async function markNotificationRead(req, res) {
  try {
    await TradeMatchNotification.updateOne(
      { _id: req.params.id, recipientUserId: req.user._id },
      { read: true }
    );
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}

export async function markAllRead(req, res) {
  try {
    await TradeMatchNotification.updateMany(
      { recipientUserId: req.user._id, read: false },
      { read: true }
    );
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}

export async function deleteNotification(req, res) {
  try {
    await TradeMatchNotification.findOneAndDelete({
      _id: req.params.id,
      recipientUserId: req.user._id,
    });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}

/* ═══════════════════════════════════════════════════
   GET /api/trades/:id/comments  (public)
═══════════════════════════════════════════════════ */
export async function getComments(req, res) {
  try {
    const comments = await TradeComment.find({ tradePostId: req.params.id })
      .sort({ createdAt: 1 })
      .limit(200)
      .lean();
    return res.json({ ok: true, comments: comments.map(serializeComment) });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}

/* ═══════════════════════════════════════════════════
   POST /api/trades/:id/comments
   Auth required. Validates inventory ownership.
═══════════════════════════════════════════════════ */
export async function postComment(req, res) {
  try {
    const me   = req.user;
    const post = await TradePost.findById(req.params.id);
    if (!post) return res.status(404).json({ ok: false, error: "Trade post not found." });
    if (post.status !== "active") return res.status(400).json({ ok: false, error: "Cannot comment on a closed post." });

    const { offeredItems = [], message = "" } = req.body ?? {};

    /* Ownership validation for offered items */
    const realOffered = (offeredItems || []).filter(i => !i.isSpecial && i.assetId);
    if (realOffered.length > 0) {
      const inv = await ImportedInventory.findOne({ userId: me._id }).lean();
      if (!inv?.items?.length) {
        return res.status(400).json({ ok: false, error: "You have no synced inventory." });
      }
      const ownedIds = new Set(inv.items.map(i => String(i.assetId || i.assetid || "")));
      const invalid  = realOffered.filter(i => !ownedIds.has(String(i.assetId)));
      if (invalid.length) {
        return res.status(403).json({
          ok: false, error: "Some offered items don't belong to your inventory.",
          invalidAssetIds: invalid.map(i => i.assetId),
        });
      }
    }

    const cleanMsg  = String(message || "").trim().slice(0, 1000);
    const safeItems = (offeredItems || []).slice(0, 12).map(sanitizeItem).filter(i => i.name);

    if (!safeItems.length && !cleanMsg) {
      return res.status(400).json({ ok: false, error: "Send at least one item or a message." });
    }

    const comment = await TradeComment.create({
      tradePostId:     post._id,
      senderUserId:    me._id,
      senderSteamId:   me.steamId    || "",
      senderUsername:  me.username   || "",
      senderAvatarUrl: me.avatarUrl  || "",
      offeredItems:    safeItems,
      message:         cleanMsg,
    });

    const isOwner = String(post.ownerUserId) === String(me._id);

    await TradePost.findByIdAndUpdate(post._id, {
      $inc: {
        commentCount:   1,
        unreadComments: isOwner ? 0 : 1,
      },
    });

    const serialized = serializeComment(comment);

    /* Emit to post owner (not self) */
    if (!isOwner && global.io) {
      global.io.to(`user:${String(post.ownerUserId)}`).emit("trade:new-comment", {
        tradePostId:    String(post._id),
        comment:        serialized,
        senderUsername: me.username || "",
      });
    }

    /* Emit to anyone watching this trade's conversation */
    if (global.io) {
      global.io.to(`trade-conv:${String(post._id)}`).emit("trade:comment-added", {
        tradePostId: String(post._id),
        comment:     serialized,
      });
    }

    console.log(`[trade] comment posted on ${post._id} by ${me.username} (${safeItems.length} items, msg: ${!!cleanMsg})`);
    return res.json({ ok: true, comment: serialized });
  } catch (err) {
    console.error("[trade] postComment:", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

/* ═══════════════════════════════════════════════════
   PATCH /api/trades/:id/comments/read
   Owner marks all comments as read.
═══════════════════════════════════════════════════ */
export async function markCommentsRead(req, res) {
  try {
    const post = await TradePost.findOne({ _id: req.params.id, ownerUserId: req.user._id });
    if (!post) return res.status(404).json({ ok: false, error: "Not found or not yours." });

    await TradeComment.updateMany(
      { tradePostId: post._id, readByOwner: false },
      { $set: { readByOwner: true } }
    );
    await TradePost.findByIdAndUpdate(post._id, { $set: { unreadComments: 0 } });

    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}

/* ═══════════════════════════════════════════════════
   POST /api/trades/test-notification
   Creates a real DB notification for the requesting user
   and emits it via socket — tests the full pipeline.
═══════════════════════════════════════════════════ */
export async function createTestNotification(req, res) {
  try {
    const me = req.user;
    const fakePostId = new mongoose.Types.ObjectId();

    // Remove previous test notifications for this user so the list stays clean
    await TradeMatchNotification.deleteMany({
      recipientUserId: me._id,
      senderUsername:  "_test_",
    });

    const notif = await TradeMatchNotification.create({
      recipientUserId: me._id,
      tradePostId:     fakePostId,
      senderUserId:    me._id,
      senderUsername:  "_test_",
      senderSteamId:   me.steamId   || "",
      senderAvatarUrl: me.avatarUrl || "",
      matchedItems: [
        {
          name:           "AK-47 | Redline",
          marketHashName: "AK-47 | Redline (Field-Tested)",
          iconUrl:        "",
          exterior:       "Field-Tested",
          rarity:         { name: "Classified", color: "#D32CE6" },
        },
        {
          name:           "Desert Eagle | Blaze",
          marketHashName: "Desert Eagle | Blaze (Factory New)",
          iconUrl:        "",
          exterior:       "Factory New",
          rarity:         { name: "Restricted", color: "#8847FF" },
        },
      ],
      offerItems: [
        {
          name:           "AWP | Asiimov",
          marketHashName: "AWP | Asiimov (Field-Tested)",
          iconUrl:        "",
          exterior:       "Field-Tested",
          rarity:         { name: "Covert", color: "#EB4B4B" },
        },
      ],
    });

    const serialized = serializeNotification(notif);
    console.log(`[MATCH] test notification saved — id=${notif._id} recipient=${me._id} (${me.username})`);

    const room = `user:${String(me._id)}`;
    try {
      const io = getIO();
      const activeSockets = await io.in(room).fetchSockets();
      console.log(`[MATCH] test socket — room="${room}" has ${activeSockets.length} connection(s)`);
      io.to(room).emit("trade:match", {
        notification: serialized,
        tradePostId:  String(fakePostId),
      });
      console.log(`[MATCH] test socket emitted to room="${room}"`);
    } catch (err) {
      console.warn(`[MATCH] test socket emit failed: ${err.message} — notification is in DB`);
    }

    return res.json({ ok: true, notification: serialized });
  } catch (err) {
    console.error("[MATCH] createTestNotification error:", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

/* ═══════════════════════════════════════════════════
   POST /api/trades/rescan-active
   Re-runs match detection for every active post.
   Fills gaps caused by server downtime or stale code.
   Safe to call multiple times (dedupe prevents duplicates).
═══════════════════════════════════════════════════ */
export async function rescanActivePosts(req, res) {
  try {
    const posts = await TradePost.find({ status: "active" }).lean();
    console.log(`[MATCH] rescan — ${posts.length} active posts`);

    let totalSaved = 0;
    const errors   = [];

    for (const post of posts) {
      try {
        const saved = await runMatchDetection(post);
        totalSaved += saved;
      } catch (err) {
        const msg = `post=${post._id}: ${err.message}`;
        console.error("[MATCH] rescan error:", msg);
        errors.push(msg);
      }
    }

    console.log(`[MATCH] rescan DONE — posts=${posts.length} saved=${totalSaved} errors=${errors.length}`);
    return res.json({ ok: true, postsScanned: posts.length, notificationsSaved: totalSaved, errors });
  } catch (err) {
    console.error("[MATCH] rescanActivePosts error:", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

/* ═══════════════════════════════════════════════════
   GET /api/trades/search-matches?assetid=
   Returns active posts where lookingForItems match a
   specific item from the requesting user's inventory.
═══════════════════════════════════════════════════ */
export async function searchMatchingPosts(req, res) {
  try {
    const me      = req.user;
    const assetid = String(req.query.assetid || "").trim();

    if (!assetid) {
      return res.status(400).json({ ok: false, error: "assetid query param is required" });
    }

    // 1. Verify the item belongs to this user's synced inventory
    const inv = await ImportedInventory.findOne({ userId: me._id }).lean();
    if (!inv?.items?.length) {
      return res.status(400).json({ ok: false, error: "No synced inventory found. Import via the extension first." });
    }

    const selectedItem = inv.items.find(i =>
      String(i.assetId || i.assetid || "") === assetid
    );
    if (!selectedItem) {
      return res.status(404).json({ ok: false, error: "Item not found in your inventory." });
    }

    // 2. Normalize the selected item for matching
    const selectedBase = extractBaseName(selectedItem.marketHashName || selectedItem.name);
    const selectedExt  = normalizeExterior(selectedItem.exterior);

    // 3. Fetch all active posts (excluding user's own) sorted by recency
    const allPosts = await TradePost.find({
      status:      "active",
      ownerUserId: { $ne: me._id },
    }).sort({ bumpedAt: -1, createdAt: -1 }).lean();

    // 4. Keep posts where at least one lookingForItem matches
    const matchingPosts = allPosts.filter(post =>
      (post.lookingForItems || []).some(item => {
        if (item.isSpecial) return false;
        const postBase = extractBaseName(item.marketHashName || item.name);
        if (postBase !== selectedBase) return false;
        // Post has no wear constraint → matches any wear
        if (!item.exterior) return true;
        // Post has wear constraint → must match exactly
        return normalizeExterior(item.exterior) === selectedExt;
      })
    );

    return res.json({
      ok: true,
      selectedItem: {
        assetId:        selectedItem.assetId || selectedItem.assetid || "",
        name:           selectedItem.name           || selectedItem.marketHashName || "",
        marketHashName: selectedItem.marketHashName || selectedItem.name           || "",
        exterior:       selectedItem.exterior  || null,
        iconUrl:        selectedItem.iconUrl   || "",
        rarity:         selectedItem.rarity    || null,
      },
      posts: matchingPosts.map(serializePost),
      total: matchingPosts.length,
    });
  } catch (err) {
    console.error("[trade] searchMatchingPosts:", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

/* ═══════════════════════════════════════════════════
   GET /api/trades/search-by-want
   Dual-direction trade search.
   ?want=<marketHashName>        — skin I want to receive
   &have_assetid=<assetId>       — optional: item I'm offering
   Returns posts scored by:
     offerScore  = how well post.myOfferItems  matches "want"
     wantScore   = how well post.lookingForItems matches "have"
     combined    = best tier from both directions
════════════════════════════════════════════════════ */
export async function searchByWant(req, res) {
  try {
    const me          = req.user;
    const wantRaw     = String(req.query.want         || "").trim();
    const haveAssetid = String(req.query.have_assetid || "").trim();

    if (!wantRaw && !haveAssetid) {
      return res.status(400).json({ ok: false, error: "Provide 'want' or 'have_assetid'." });
    }

    // Parse comma-separated wanted items
    const wantList = wantRaw
      ? wantRaw.split(",").map(s => s.trim()).filter(Boolean).map(raw => ({
          raw,
          base:      extractBaseName(raw),
          ext:       normalizeExterior(extractExteriorFromMHN(raw) || "") || null,
          isSpecial: SPECIAL_NAMES_SET.has(raw.toLowerCase()),
        }))
      : [];

    // Load the user's "have" item from synced inventory
    let haveBase = null;
    let haveExt  = null;
    let haveItemPreview = null;
    if (haveAssetid) {
      const inv = await ImportedInventory.findOne({ userId: me._id }).lean();
      if (inv?.items?.length) {
        const found = inv.items.find(i => String(i.assetId || i.assetid || "") === haveAssetid);
        if (found) {
          haveBase = extractBaseName(found.marketHashName || found.name || "");
          haveExt  = normalizeExterior(found.exterior) || extractExteriorFromMHN(found.marketHashName || "");
          haveItemPreview = {
            assetId:        found.assetId || found.assetid || "",
            name:           found.name           || found.marketHashName || "",
            marketHashName: found.marketHashName || found.name           || "",
            exterior:       found.exterior || null,
            iconUrl:        found.iconUrl  || "",
            rarity:         found.rarity   || null,
          };
        }
      }
    }

    // Fetch active posts (excluding own)
    const allPosts = await TradePost.find({
      status:      "active",
      ownerUserId: { $ne: me._id },
    }).sort({ bumpedAt: -1, createdAt: -1 }).lean();

    const TIER = { exact: 5, similar: 4, weapon: 3, category: 2, generic: 1, none: 0 };

    const scored = allPosts.map(post => {
      // offerScore: best single-item match between post.myOfferItems and any wanted item
      // matchedWantsCount: how many wanted items matched at score > 0
      let offerScore        = 0;
      let matchedWantsCount = 0;

      if (wantList.length > 0) {
        for (const wanted of wantList) {
          let wantedBest = 0;
          for (const offerItem of (post.myOfferItems || [])) {
            if (wanted.isSpecial) {
              if (offerItem.isSpecial &&
                  (offerItem.marketHashName || offerItem.name || "").toLowerCase() === wanted.raw.toLowerCase()) {
                wantedBest = 100;
                break;
              }
            } else {
              if (offerItem.isSpecial) continue;
              const s = scoreItemAgainstTarget(offerItem, wanted.base, wanted.ext);
              if (s > wantedBest) wantedBest = s;
              if (wantedBest >= 100) break;
            }
          }
          if (wantedBest > 0) matchedWantsCount++;
          if (wantedBest > offerScore) offerScore = wantedBest;
        }
      }

      // wantScore: they want what I have
      let wantScore = 0;
      if (haveBase) {
        for (const item of (post.lookingForItems || [])) {
          if (item.isSpecial) {
            wantScore = Math.max(wantScore, 10); // "Any offers" etc.
            continue;
          }
          const s = scoreItemAgainstTarget(item, haveBase, haveExt);
          if (s > wantScore) wantScore = s;
          if (wantScore >= 100) break;
        }
      }

      // Determine combined score and match type
      let combinedScore, matchType;

      if (wantList.length > 0 && haveBase) {
        // Dual mode: both directions must contribute
        if (offerScore >= 100 && wantScore >= 100)       { combinedScore = 100; matchType = "exact"; }
        else if (offerScore >= 75  && wantScore >= 75)   { combinedScore = 85;  matchType = "dual_similar"; }
        else if (offerScore >= 100 && wantScore >= 45)   { combinedScore = 80;  matchType = "offer_exact"; }
        else if (offerScore >= 45  && wantScore >= 100)  { combinedScore = 75;  matchType = "want_exact"; }
        else if (offerScore >= 100 || wantScore >= 100)  { combinedScore = 60;  matchType = "one_exact"; }
        else if (offerScore >= 45  || wantScore >= 45)   { combinedScore = 40;  matchType = "partial"; }
        else if (offerScore >= 25  || wantScore >= 25)   { combinedScore = 25;  matchType = "category"; }
        else if (offerScore > 0    || wantScore > 0)     { combinedScore = 10;  matchType = "generic"; }
        else                                              { combinedScore = 0;   matchType = "none"; }
      } else if (wantList.length > 0) {
        // Want-only: they offer what I want (one or more items)
        combinedScore = offerScore;
        matchType = offerScore >= 100 ? "offer_exact"
          : offerScore >= 75          ? "offer_similar"
          : offerScore >= 45          ? "offer_weapon"
          : offerScore >= 25          ? "offer_category"
          : offerScore > 0            ? "offer_generic"
          : "none";
      } else {
        // Have-only: they want what I have
        combinedScore = wantScore;
        matchType = wantScore >= 100 ? "want_exact"
          : wantScore >= 75          ? "want_similar"
          : wantScore >= 45          ? "want_weapon"
          : wantScore >= 25          ? "want_category"
          : wantScore > 0            ? "want_generic"
          : "none";
      }

      return { post, offerScore, wantScore, matchedWantsCount, combinedScore, matchType };
    });

    // Filter, then sort: combined desc → matchedCount desc → offerScore desc → wantScore desc
    const results = scored
      .filter(s => s.combinedScore > 0)
      .sort((a, b) =>
        b.combinedScore     !== a.combinedScore     ? b.combinedScore     - a.combinedScore
        : b.matchedWantsCount !== a.matchedWantsCount ? b.matchedWantsCount - a.matchedWantsCount
        : b.offerScore        !== a.offerScore        ? b.offerScore        - a.offerScore
        : b.wantScore         - a.wantScore
      );

    return res.json({
      ok: true,
      haveItem:  haveItemPreview,
      wantQuery: wantRaw || null,
      posts: results.map(s => ({
        ...serializePost(s.post),
        _offerScore:    s.offerScore,
        _wantScore:     s.wantScore,
        _combinedScore: s.combinedScore,
        _matchType:     s.matchType,
        _matchedCount:  s.matchedWantsCount,
      })),
      total: results.length,
    });
  } catch (err) {
    console.error("[trade] searchByWant:", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
