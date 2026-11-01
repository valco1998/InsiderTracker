import mongoose from "mongoose";
import Friendship from "../models/Friendship.model.js";
import Block from "../models/Block.model.js";
import User from "../models/User.model.js";
import { getIO } from "../socket/socket.js";

/* ─── Helpers ──────────────────────────────────────────────── */

function isValidId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

/** Emit a socket event without crashing if the socket isn't ready. */
function safeEmit(room, event, payload) {
  try { getIO().to(room).emit(event, payload); } catch { /* socket not ready */ }
}

function normalizeFriend(doc, myId) {
  const isFrom = String(doc.fromId._id) === String(myId);
  const other  = isFrom ? doc.toId : doc.fromId;
  return {
    userId:    String(other._id),
    username:  other.username,
    avatarUrl: other.avatarUrl || "",
    addedAt:   doc.updatedAt.toISOString(),
  };
}

function normalizeRequest(doc, role) {
  const person = role === "incoming" ? doc.fromId : doc.toId;
  return {
    requestId: String(doc._id),
    userId:    String(person._id),
    username:  person.username,
    avatarUrl: person.avatarUrl || "",
    sentAt:    doc.createdAt.toISOString(),
  };
}

/* ─── Friends ──────────────────────────────────────────────── */

export async function getFriends(req, res) {
  try {
    const docs = await Friendship.find({
      $or: [{ fromId: req.user._id }, { toId: req.user._id }],
      status: "accepted",
    })
      .populate("fromId", "username avatarUrl")
      .populate("toId",   "username avatarUrl")
      .lean();

    res.json({ ok: true, friends: docs.map(d => normalizeFriend(d, req.user._id)) });
  } catch (err) {
    console.error("[social] getFriends:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

export async function getRequests(req, res) {
  try {
    const [incomingDocs, sentDocs] = await Promise.all([
      Friendship.find({ toId: req.user._id, status: "pending" })
        .populate("fromId", "username avatarUrl").lean(),
      Friendship.find({ fromId: req.user._id, status: "pending" })
        .populate("toId", "username avatarUrl").lean(),
    ]);

    res.json({
      ok:       true,
      incoming: incomingDocs.map(d => normalizeRequest(d, "incoming")),
      sent:     sentDocs.map(d => normalizeRequest(d, "sent")),
    });
  } catch (err) {
    console.error("[social] getRequests:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

export async function sendFriendRequest(req, res) {
  try {
    const fromId = req.user._id;
    const toId   = req.params.userId;

    if (!isValidId(toId))
      return res.status(400).json({ ok: false, error: "Invalid user ID" });

    if (String(fromId) === String(toId))
      return res.status(400).json({ ok: false, error: "You cannot add yourself" });

    const target = await User.findById(toId).select("username avatarUrl").lean();
    if (!target) return res.status(404).json({ ok: false, error: "User not found" });

    // Block check (either direction)
    const blockDoc = await Block.findOne({
      $or: [
        { blockerId: fromId, blockedId: toId },
        { blockerId: toId,   blockedId: fromId },
      ],
    }).lean();
    if (blockDoc) return res.status(403).json({ ok: false, error: "Cannot send request — a block exists" });

    // Check for any existing relationship in either direction
    const existing = await Friendship.findOne({
      $or: [
        { fromId, toId },
        { fromId: toId, toId: fromId },
      ],
    }).lean();

    if (existing) {
      if (existing.status === "accepted")
        return res.status(409).json({ ok: false, error: "You are already friends" });

      if (String(existing.fromId) === String(fromId))
        return res.status(409).json({ ok: false, error: "Friend request already sent" });

      // They already sent us a request — auto-accept
      await Friendship.findByIdAndUpdate(existing._id, { status: "accepted" });

      const me = await User.findById(fromId).select("username avatarUrl").lean();
      const myObj    = { userId: String(fromId),     username: me.username,     avatarUrl: me.avatarUrl     || "", addedAt: new Date().toISOString() };
      const theirObj = { userId: String(target._id), username: target.username, avatarUrl: target.avatarUrl || "", addedAt: new Date().toISOString() };

      safeEmit(`user:${String(fromId)}`, "friend_request:accepted", { friend: theirObj });
      safeEmit(`user:${String(toId)}`,   "friend_request:accepted", { friend: myObj });

      return res.json({ ok: true, status: "accepted", friend: theirObj });
    }

    // Create the pending request
    let doc;
    try {
      doc = await Friendship.create({ fromId, toId, status: "pending" });
    } catch (e) {
      if (e.code === 11000)
        return res.status(409).json({ ok: false, error: "Friend request already sent" });
      throw e;
    }

    const sender = await User.findById(fromId).select("username avatarUrl").lean();

    const incomingForReceiver = {
      requestId: String(doc._id),
      userId:    String(fromId),
      username:  sender.username,
      avatarUrl: sender.avatarUrl || "",
      sentAt:    doc.createdAt.toISOString(),
    };

    safeEmit(`user:${String(toId)}`, "friend_request", { request: incomingForReceiver });

    const sentForSender = {
      requestId: String(doc._id),
      userId:    String(target._id),
      username:  target.username,
      avatarUrl: target.avatarUrl || "",
      sentAt:    doc.createdAt.toISOString(),
    };

    res.json({ ok: true, status: "pending", sentRequest: sentForSender });
  } catch (err) {
    console.error("[social] sendFriendRequest:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

export async function acceptFriendRequest(req, res) {
  try {
    const myId   = req.user._id;
    const fromId = req.params.userId;

    if (!isValidId(fromId))
      return res.status(400).json({ ok: false, error: "Invalid user ID" });

    const doc = await Friendship.findOne({ fromId, toId: myId, status: "pending" });
    if (!doc) return res.status(404).json({ ok: false, error: "Friend request not found" });

    doc.status = "accepted";
    await doc.save();

    const [me, sender] = await Promise.all([
      User.findById(myId).select("username avatarUrl").lean(),
      User.findById(fromId).select("username avatarUrl").lean(),
    ]);

    const meAsFriend     = { userId: String(myId),   username: me.username,     avatarUrl: me.avatarUrl     || "", addedAt: new Date().toISOString() };
    const senderAsFriend = { userId: String(fromId), username: sender.username, avatarUrl: sender.avatarUrl || "", addedAt: new Date().toISOString() };

    safeEmit(`user:${String(fromId)}`, "friend_request:accepted", { friend: meAsFriend });

    res.json({ ok: true, friend: senderAsFriend });
  } catch (err) {
    console.error("[social] acceptFriendRequest:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

export async function declineFriendRequest(req, res) {
  try {
    const myId   = req.user._id;
    const fromId = req.params.userId;

    if (!isValidId(fromId))
      return res.status(400).json({ ok: false, error: "Invalid user ID" });

    await Friendship.deleteOne({ fromId, toId: myId, status: "pending" });

    safeEmit(`user:${String(fromId)}`, "friend_request:declined", { userId: String(myId) });

    res.json({ ok: true });
  } catch (err) {
    console.error("[social] declineFriendRequest:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

export async function cancelFriendRequest(req, res) {
  try {
    const toId = req.params.userId;
    if (!isValidId(toId))
      return res.status(400).json({ ok: false, error: "Invalid user ID" });

    await Friendship.deleteOne({ fromId: req.user._id, toId, status: "pending" });
    res.json({ ok: true });
  } catch (err) {
    console.error("[social] cancelFriendRequest:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

export async function removeFriend(req, res) {
  try {
    const myId    = req.user._id;
    const otherId = req.params.userId;

    if (!isValidId(otherId))
      return res.status(400).json({ ok: false, error: "Invalid user ID" });

    await Friendship.deleteOne({
      $or: [
        { fromId: myId,    toId: otherId, status: "accepted" },
        { fromId: otherId, toId: myId,    status: "accepted" },
      ],
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("[social] removeFriend:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

/* ─── Search ───────────────────────────────────────────────── */

export async function searchUsers(req, res) {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) return res.json({ ok: true, users: [] });

    const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const docs  = await User.find({ username: regex, _id: { $ne: req.user._id } })
      .select("username avatarUrl")
      .limit(10)
      .lean();

    res.json({
      ok: true,
      users: docs.map(u => ({
        userId:    String(u._id),
        username:  u.username,
        avatarUrl: u.avatarUrl || "",
      })),
    });
  } catch (err) {
    console.error("[social] searchUsers:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

/* ─── Block ────────────────────────────────────────────────── */

export async function getBlocked(req, res) {
  try {
    const [byMe, byThem] = await Promise.all([
      Block.find({ blockerId: req.user._id }).populate("blockedId", "username avatarUrl").lean(),
      Block.find({ blockedId: req.user._id }).distinct("blockerId"),
    ]);

    res.json({
      ok: true,
      blocked:      byMe.map(b => ({ userId: String(b.blockedId._id), username: b.blockedId.username, avatarUrl: b.blockedId.avatarUrl || "" })),
      blockedByIds: byThem.map(String),
    });
  } catch (err) {
    console.error("[social] getBlocked:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

export async function blockUser(req, res) {
  try {
    const blockerId = req.user._id;
    const { userId } = req.params;

    if (!isValidId(userId))
      return res.status(400).json({ ok: false, error: "Invalid user ID" });

    if (String(blockerId) === String(userId))
      return res.status(400).json({ ok: false, error: "Cannot block yourself" });

    // Remove all friendship docs between them (any direction, any status)
    await Friendship.deleteMany({
      $or: [
        { fromId: blockerId, toId: userId },
        { fromId: userId,    toId: blockerId },
      ],
    });

    try {
      await Block.create({ blockerId, blockedId: userId });
    } catch (e) {
      if (e.code === 11000) return res.json({ ok: true }); // already blocked — idempotent
      throw e;
    }

    safeEmit(`user:${String(userId)}`, "social:blocked", { userId: String(blockerId) });

    res.json({ ok: true });
  } catch (err) {
    console.error("[social] blockUser:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

export async function unblockUser(req, res) {
  try {
    const blockedId = req.params.userId;

    if (!isValidId(blockedId))
      return res.status(400).json({ ok: false, error: "Invalid user ID" });

    await Block.deleteOne({ blockerId: req.user._id, blockedId });

    safeEmit(`user:${String(blockedId)}`, "social:unblocked", { userId: String(req.user._id) });

    res.json({ ok: true });
  } catch (err) {
    console.error("[social] unblockUser:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
}
