import mongoose from "mongoose";
import DMConversation from "../models/DMConversation.model.js";
import ChatMessage    from "../models/ChatMessage.model.js";
import Block          from "../models/Block.model.js";
import User           from "../models/User.model.js";

/*
 * No import from socket.js — avoids circular dependency.
 * server.js sets global.io after initSocket(); we access it lazily here.
 */
function safeEmit(room, event, payload) {
  try { if (global.io) global.io.to(room).emit(event, payload); } catch {}
}

/* ─── Pure helpers ─────────────────────────────────────────── */

function makePairKey(a, b) {
  return [String(a), String(b)].sort().join("_");
}

export function normalizeDMConv(conv, viewerUserId) {
  const viewerStr = String(viewerUserId);
  const other = conv.participants.find(p => String(p._id || p) !== viewerStr);
  const unread = conv.unread || {};
  return {
    id:            String(conv._id),
    otherUser: other ? {
      userId:    String(other._id || other),
      username:  other.username  || "",
      avatarUrl: other.avatarUrl || "",
    } : null,
    lastMessage:   conv.lastMessage   || "",
    lastMessageAt: conv.lastMessageAt instanceof Date
      ? conv.lastMessageAt.toISOString()
      : (conv.lastMessageAt || null),
    lastSenderId:  conv.lastSenderId ? String(conv.lastSenderId) : null,
    myUnread:      unread[viewerStr] || 0,
  };
}

function normalizeMsg(doc) {
  return {
    id:           String(doc._id),
    roomId:       doc.roomId,
    senderId:     String(doc.senderId),
    senderName:   doc.senderName,
    senderAvatar: doc.senderAvatar || "",
    text:         doc.text || "",
    type:         doc.type || "text",
    meta:         doc.meta ?? null,
    createdAt:    doc.createdAt instanceof Date
      ? doc.createdAt.toISOString()
      : String(doc.createdAt),
  };
}

/* ─── Open or create a DM conversation ────────────────────── */

export async function openOrCreateDM(req, res) {
  try {
    const myId    = req.user._id;
    const otherId = req.params.userId;

    if (!mongoose.Types.ObjectId.isValid(otherId))
      return res.status(400).json({ ok: false, error: "Invalid user ID" });
    if (String(myId) === String(otherId))
      return res.status(400).json({ ok: false, error: "Cannot DM yourself" });

    const other = await User.findById(otherId).select("username avatarUrl").lean();
    if (!other) return res.status(404).json({ ok: false, error: "User not found" });

    const hasBlock = await Block.findOne({
      $or: [
        { blockerId: myId,    blockedId: otherId },
        { blockerId: otherId, blockedId: myId },
      ],
    }).lean();
    if (hasBlock)
      return res.status(403).json({ ok: false, error: "Cannot message a blocked user" });

    const pairKey = makePairKey(myId, otherId);
    const sorted  = pairKey.split("_").map(id => new mongoose.Types.ObjectId(id));

    let conv = await DMConversation.findOneAndUpdate(
      { pairKey },
      // If it exists and viewer had hidden it, unhide on re-open
      { $pull: { hiddenFor: myId } },
      { new: true }
    ).populate("participants", "username avatarUrl").lean();

    if (!conv) {
      const created = await DMConversation.create({
        pairKey,
        participants: sorted,
        unread:     {},
        hiddenFor:  [],
        clearedAt:  {},
      });
      conv = await DMConversation.findById(created._id)
        .populate("participants", "username avatarUrl")
        .lean();
    }

    res.json({ ok: true, conversation: normalizeDMConv(conv, myId) });
  } catch (err) {
    console.error("[dm] openOrCreateDM:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

/* ─── List conversations (excludes hidden ones) ─────────────── */

export async function getMyDMs(req, res) {
  try {
    const myId = req.user._id;

    const convs = await DMConversation.find({
      participants: myId,
      hiddenFor:    { $ne: myId },  // exclude conversations this user has hidden
    })
      .populate("participants", "username avatarUrl")
      .sort({ lastMessageAt: -1, createdAt: -1 })
      .lean();

    res.json({
      ok: true,
      conversations: convs.map(c => normalizeDMConv(c, myId)),
    });
  } catch (err) {
    console.error("[dm] getMyDMs:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

/* ─── Message history (respects clearedAt per user) ─────────── */

export async function getDMHistory(req, res) {
  try {
    const myId   = req.user._id;
    const convId = req.params.convId;
    const limit  = Math.min(Number(req.query.limit) || 50, 100);
    const before = req.query.before ? new Date(req.query.before) : null;

    if (!mongoose.Types.ObjectId.isValid(convId))
      return res.status(400).json({ ok: false, error: "Invalid conversation ID" });

    const conv = await DMConversation.findById(convId).lean();
    if (!conv) return res.status(404).json({ ok: false, error: "Conversation not found" });

    const isParticipant = conv.participants.some(p => String(p) === String(myId));
    if (!isParticipant) return res.status(403).json({ ok: false, error: "Not a participant" });

    const query = { roomId: `dm:${convId}` };

    // Only return messages created after the user's last clear
    const clearDate = (conv.clearedAt || {})[String(myId)];
    if (clearDate) {
      query.createdAt = { $gt: new Date(clearDate) };
    }
    if (before && !isNaN(before)) {
      query.createdAt = { ...(query.createdAt || {}), $lt: before };
    }

    const docs = await ChatMessage.find(query)
      .sort({ createdAt: -1 }).limit(limit).lean();

    res.json({
      ok: true,
      messages: docs.reverse().map(normalizeMsg),
      hasMore: docs.length === limit,
    });
  } catch (err) {
    console.error("[dm] getDMHistory:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

/* ─── Send a message via HTTP ──────────────────────────────── */

export async function sendDMMessage(req, res) {
  try {
    const myId   = req.user._id;
    const convId = req.params.convId;
    const text   = String(req.body.text || "").trim().slice(0, 2000);

    if (!mongoose.Types.ObjectId.isValid(convId))
      return res.status(400).json({ ok: false, error: "Invalid conversation ID" });
    if (!text)
      return res.status(400).json({ ok: false, error: "Message text is required" });

    const conv = await DMConversation.findById(convId).lean();
    if (!conv) return res.status(404).json({ ok: false, error: "Conversation not found" });

    const isParticipant = conv.participants.some(p => String(p) === String(myId));
    if (!isParticipant) return res.status(403).json({ ok: false, error: "Not a participant" });

    const recipientId = String(conv.participants.find(p => String(p) !== String(myId)));

    const hasBlock = await Block.findOne({
      $or: [
        { blockerId: myId,        blockedId: recipientId },
        { blockerId: recipientId, blockedId: myId },
      ],
    }).lean();
    if (hasBlock)
      return res.status(403).json({ ok: false, error: "Cannot message a blocked user" });

    const me = await User.findById(myId).select("username fullName avatarUrl").lean();

    const roomId = `dm:${convId}`;
    const doc = await ChatMessage.create({
      roomId,
      senderId:     myId,
      senderName:   me.fullName || me.username,
      senderAvatar: me.avatarUrl || "",
      text,
    });

    // Update conversation + unhide for recipient (new message restores visibility)
    await DMConversation.findByIdAndUpdate(convId, {
      $set: {
        lastMessage:   text.slice(0, 120),
        lastMessageAt: new Date(),
        lastSenderId:  myId,
      },
      $inc:  { [`unread.${recipientId}`]: 1 },
      $pull: { hiddenFor: new mongoose.Types.ObjectId(recipientId) },
    });

    const msg = normalizeMsg(doc);
    safeEmit(roomId, "dm:message", msg);

    const updatedConv = await DMConversation.findById(convId)
      .populate("participants", "username avatarUrl").lean();
    if (updatedConv) {
      safeEmit(`user:${String(myId)}`,        "dm:conversation", { conversation: normalizeDMConv(updatedConv, myId) });
      safeEmit(`user:${String(recipientId)}`, "dm:conversation", { conversation: normalizeDMConv(updatedConv, recipientId) });
    }

    res.json({ ok: true, message: msg });
  } catch (err) {
    console.error("[dm] sendDMMessage:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

/* ─── Hide / delete conversation (current user only) ────────── */

export async function hideConversation(req, res) {
  try {
    const myId   = req.user._id;
    const convId = req.params.convId;

    if (!mongoose.Types.ObjectId.isValid(convId))
      return res.status(400).json({ ok: false, error: "Invalid conversation ID" });

    const conv = await DMConversation.findById(convId).lean();
    if (!conv) return res.status(404).json({ ok: false, error: "Conversation not found" });

    const isParticipant = conv.participants.some(p => String(p) === String(myId));
    if (!isParticipant) return res.status(403).json({ ok: false, error: "Not a participant" });

    await DMConversation.findByIdAndUpdate(convId, {
      $addToSet: { hiddenFor: myId },
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("[dm] hideConversation:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

/* ─── Clear message history (current user only) ─────────────── */

export async function clearConversation(req, res) {
  try {
    const myId   = req.user._id;
    const convId = req.params.convId;

    if (!mongoose.Types.ObjectId.isValid(convId))
      return res.status(400).json({ ok: false, error: "Invalid conversation ID" });

    const conv = await DMConversation.findById(convId).lean();
    if (!conv) return res.status(404).json({ ok: false, error: "Conversation not found" });

    const isParticipant = conv.participants.some(p => String(p) === String(myId));
    if (!isParticipant) return res.status(403).json({ ok: false, error: "Not a participant" });

    await DMConversation.findByIdAndUpdate(convId, {
      $set: { [`clearedAt.${String(myId)}`]: new Date().toISOString() },
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("[dm] clearConversation:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

/* ─── Mark conversation as read ────────────────────────────── */

export async function markDMRead(req, res) {
  try {
    const myId   = req.user._id;
    const convId = req.params.convId;

    if (!mongoose.Types.ObjectId.isValid(convId))
      return res.status(400).json({ ok: false, error: "Invalid conversation ID" });

    const conv = await DMConversation.findById(convId).lean();
    if (!conv) return res.status(404).json({ ok: false, error: "Conversation not found" });

    const isParticipant = conv.participants.some(p => String(p) === String(myId));
    if (!isParticipant) return res.status(403).json({ ok: false, error: "Not a participant" });

    await DMConversation.findByIdAndUpdate(convId, {
      $set: { [`unread.${String(myId)}`]: 0 },
    });

    safeEmit(`user:${String(myId)}`, "dm:read", { convId });

    res.json({ ok: true });
  } catch (err) {
    console.error("[dm] markDMRead:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
}
