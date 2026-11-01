import ChatMessage from "../models/ChatMessage.model.js";
import PrivateGroup from "../models/PrivateGroup.model.js";
import User from "../models/User.model.js";
import Block from "../models/Block.model.js";
import { getIO, normalizeGroup, normalizeMsg } from "../socket/socket.js";

/* =========================
   MESSAGES
========================= */

export async function getHistory(req, res) {
  try {
    const roomId = String(req.query.roomId || "global");
    const limit  = Math.min(Number(req.query.limit) || 50, 100);
    const before = req.query.before ? new Date(req.query.before) : null;

    // For group rooms, verify membership
    if (roomId.startsWith("group:")) {
      const groupId = roomId.replace("group:", "");
      const group   = await PrivateGroup.findById(groupId).lean();
      if (!group) return res.status(404).json({ ok: false, error: "Group not found" });
      const isMember = group.members.some((m) => String(m.userId) === String(req.user._id));
      if (!isMember) return res.status(403).json({ ok: false, error: "Not a member" });
    }

    const query = { roomId };
    if (before && !isNaN(before)) query.createdAt = { $lt: before };

    const docs = await ChatMessage.find(query)
      .sort({ createdAt: -1 }).limit(limit).lean();

    res.json({
      ok: true,
      messages: docs.reverse().map((m) => ({
        id:           String(m._id),
        roomId:       m.roomId,
        senderId:     String(m.senderId),
        senderName:   m.senderName,
        senderAvatar: m.senderAvatar || "",
        text:         m.text || "",
        type:         m.type || "text",
        meta:         m.meta ?? null,
        createdAt:    m.createdAt.toISOString(),
      })),
      hasMore: docs.length === limit,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

/* =========================
   GROUPS
========================= */

export async function createGroup(req, res) {
  try {
    const { name, memberUsernames = [] } = req.body;
    if (!name?.trim()) return res.status(400).json({ ok: false, error: "Group name is required" });

    const owner = req.user;
    const members = [{
      userId:    owner._id,
      username:  owner.username,
      avatarUrl: owner.avatarUrl || "",
      joinedAt:  new Date(),
    }];

    // Resolve usernames → users (skip duplicates and self)
    const seen = new Set([String(owner._id)]);
    for (const uname of memberUsernames) {
      const trimmed = String(uname || "").trim();
      if (!trimmed || trimmed === owner.username) continue;

      const u = await User.findOne({ username: trimmed }).select("_id username avatarUrl").lean();
      if (u && !seen.has(String(u._id))) {
        seen.add(String(u._id));
        members.push({ userId: u._id, username: u.username, avatarUrl: u.avatarUrl || "", joinedAt: new Date() });
      }
    }

    const group = await PrivateGroup.create({ name: name.trim(), ownerId: owner._id, members });
    const normalized = normalizeGroup(group);

    // Notify each invited member via their user socket room
    const io = getIO();
    for (const m of normalized.members) {
      if (m.userId !== String(owner._id)) {
        io.to(`user:${m.userId}`).emit("group:invited", { group: normalized });
      }
    }

    res.json({ ok: true, group: normalized });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

export async function getMyGroups(req, res) {
  try {
    const groups = await PrivateGroup.find({ "members.userId": req.user._id })
      .sort({ updatedAt: -1 }).lean();
    res.json({ ok: true, groups: groups.map(normalizeGroup) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

export async function addMember(req, res) {
  try {
    const { username } = req.body;
    const group = await PrivateGroup.findById(req.params.id);
    if (!group) return res.status(404).json({ ok: false, error: "Group not found" });
    if (String(group.ownerId) !== String(req.user._id))
      return res.status(403).json({ ok: false, error: "Only the owner can add members" });

    const u = await User.findOne({ username: String(username || "").trim() })
      .select("_id username avatarUrl").lean();
    if (!u) return res.status(404).json({ ok: false, error: `User @${username} not found` });

    if (group.members.some((m) => String(m.userId) === String(u._id)))
      return res.status(400).json({ ok: false, error: "Already a member" });

    // Block in either direction prevents joining
    const hasBlock = await Block.findOne({
      $or: [
        { blockerId: req.user._id, blockedId: u._id },
        { blockerId: u._id,        blockedId: req.user._id },
      ],
    }).lean();
    if (hasBlock) return res.status(403).json({ ok: false, error: "Cannot add — a block exists between these users" });

    group.members.push({ userId: u._id, username: u.username, avatarUrl: u.avatarUrl || "", joinedAt: new Date() });
    await group.save();

    const normalized = normalizeGroup(group);
    const io = getIO();

    // Tell the group room membership changed
    io.to(`group:${group._id}`).emit("group:updated", { group: normalized });

    // Invite the new member via their user room
    io.to(`user:${String(u._id)}`).emit("group:invited", { group: normalized });

    res.json({ ok: true, group: normalized });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

export async function removeMember(req, res) {
  try {
    const { id, userId } = req.params;
    const requesterId    = String(req.user._id);
    const isLeavingSelf  = userId === requesterId;

    const group = await PrivateGroup.findById(id);
    if (!group) return res.status(404).json({ ok: false, error: "Group not found" });

    const isOwner = String(group.ownerId) === requesterId;
    if (!isLeavingSelf && !isOwner)
      return res.status(403).json({ ok: false, error: "Not authorized" });
    if (String(group.ownerId) === userId)
      return res.status(400).json({ ok: false, error: "Owner cannot be removed. Delete the group instead." });

    const isMember = group.members.some((m) => String(m.userId) === userId);
    if (!isMember) return res.status(400).json({ ok: false, error: "Not a member" });

    group.members = group.members.filter((m) => String(m.userId) !== userId);
    await group.save();

    const normalized = normalizeGroup(group);
    const io = getIO();

    io.to(`group:${group._id}`).emit("group:updated", { group: normalized });
    // Tell the removed user directly
    io.to(`user:${userId}`).emit("group:removed", { groupId: String(group._id) });

    res.json({ ok: true, group: normalized });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

/* =========================
   AUCTION SHARE
========================= */

// Safe numeric coercion — Number(x || 0) silently turns a garbage string into
// NaN (since "abc" is truthy, "|| 0" never kicks in); this always yields a
// finite number so persisted meta can't end up with NaN in it.
function safeNumber(v, { min, max } = {}) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  if (min != null && n < min) return min;
  if (max != null && n > max) return max;
  return n;
}

function safeString(v, maxLen) {
  return String(v ?? "").slice(0, maxLen);
}

// Only allow http(s) image URLs — blocks javascript:/data: URIs from a
// client-supplied field ending up in an <img src> in the chat renderer.
function safeImageUrl(v) {
  const s = String(v || "").trim();
  return /^https?:\/\//i.test(s) ? s.slice(0, 500) : "";
}

const SHARE_TYPES = new Set(["auction_share", "market_item"]);

export async function shareAuction(req, res) {
  try {
    const { roomId, auction, type: rawType } = req.body;
    const type = SHARE_TYPES.has(rawType) ? rawType : "auction_share";

    if (!roomId) {
      return res.status(400).json({ ok: false, error: "roomId is required" });
    }
    if (!auction?.itemId) {
      return res.status(400).json({ ok: false, error: "auction.itemId is required" });
    }

    // Verify group membership when sharing to a private group
    if (roomId.startsWith("group:")) {
      const groupId = roomId.replace("group:", "");
      const group   = await PrivateGroup.findById(groupId).lean();
      if (!group) return res.status(404).json({ ok: false, error: "Group not found" });
      const isMember = group.members.some(
        (m) => String(m.userId) === String(req.user._id)
      );
      if (!isMember) return res.status(403).json({ ok: false, error: "Not a member" });
    }

    const user = req.user;

    // Server-validated/sanitized metadata — never trust client-supplied
    // numbers/URLs directly (see safeNumber/safeImageUrl above).
    const meta = {
      itemId:         safeString(auction.itemId, 100),
      auctionId:      auction.auctionId ? safeString(auction.auctionId, 100) : "",
      name:           safeString(auction.name, 200),
      marketHashName: safeString(auction.marketHashName || auction.name, 200),
      image:          safeImageUrl(auction.image),
      priceCoins:     safeNumber(auction.priceCoins,     { min: 0 }),
      suggestedCoins: safeNumber(auction.suggestedCoins, { min: 0 }),
      profitCoins:    safeNumber(auction.profitCoins,    { min: 0 }),
      discountPct:    safeNumber(auction.discountPct,    { min: 0, max: 100 }),
      endsAt:         safeNumber(auction.endsAt,         { min: 0 }),
      category:       safeString(auction.category, 60),
      wear:           safeString(auction.wear, 40),
      statTrak:       Boolean(auction.statTrak),
      souvenir:       Boolean(auction.souvenir),
      empireUrl:      `https://csgoempire.com/item/${safeString(auction.itemId, 100)}`,
    };

    const doc = await ChatMessage.create({
      roomId,
      senderId:     user._id,
      senderName:   user.fullName || user.username,
      senderAvatar: user.avatarUrl || "",
      text:         "",
      type,
      meta,
    });

    // Emit to the exact room clients actually joined: chat:global for the
    // global room, but group:<id>/dm:<id> as-is (no "chat:" prefix — that
    // prefix previously caused shared items in a group to never arrive live,
    // since group members only ever join room "group:<id>", not "chat:group:<id>").
    const targetRoom = (roomId.startsWith("group:") || roomId.startsWith("dm:"))
      ? roomId
      : `chat:${roomId}`;
    const io = getIO();
    io.to(targetRoom).emit("chat:message", normalizeMsg(doc));
    console.log(`[CHAT_SHARE] type=${type} room=${targetRoom} item=${meta.itemId}`);

    res.json({ ok: true, message: normalizeMsg(doc) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

export async function deleteGroup(req, res) {
  try {
    const group = await PrivateGroup.findById(req.params.id);
    if (!group) return res.status(404).json({ ok: false, error: "Group not found" });
    if (String(group.ownerId) !== String(req.user._id))
      return res.status(403).json({ ok: false, error: "Only the owner can delete the group" });

    const groupId = String(group._id);
    await group.deleteOne();
    await ChatMessage.deleteMany({ roomId: `group:${groupId}` });

    getIO().to(`group:${groupId}`).emit("group:disbanded", { groupId });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}
