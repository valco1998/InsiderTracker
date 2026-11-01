import http from "http";
import express from "express";
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import User from "../models/User.model.js";
import ChatMessage from "../models/ChatMessage.model.js";
import PrivateGroup from "../models/PrivateGroup.model.js";
import DMConversation from "../models/DMConversation.model.js";
import Block from "../models/Block.model.js";
import TradePost from "../models/TradePost.model.js";
import { getAllowedOrigins } from "../config/clientUrls.js";

/* Local copy — avoids circular import with dm.controller.js */
function normalizeDMConv(conv, viewerUserId) {
  const viewerStr = String(viewerUserId);
  const other = conv.participants.find(p => String(p._id || p) !== viewerStr);
  const unread = conv.unread || {};
  return {
    id: String(conv._id),
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

export const app = express();
export const server = http.createServer(app);

let io = null;

// socketId → { userId, username, displayName, avatarUrl, rooms: Set<string> }
const onlineUsers = new Map();

/* =========================
   HELPERS
========================= */

function getOnlineUsersInRoom(roomId) {
  const seen  = new Set();
  const users = [];
  for (const u of onlineUsers.values()) {
    if (u.rooms.has(roomId) && !seen.has(u.userId)) {
      seen.add(u.userId);
      users.push({ userId: u.userId, username: u.username, displayName: u.displayName, avatarUrl: u.avatarUrl });
    }
  }
  return users;
}

function broadcastOnlineUsers(roomId) {
  if (!io) return;
  io.to(`chat:${roomId}`).emit("chat:online_users", { roomId, users: getOnlineUsersInRoom(roomId) });
}

export function normalizeMsg(doc) {
  return {
    id:           String(doc._id),
    roomId:       doc.roomId,
    senderId:     String(doc.senderId),
    senderName:   doc.senderName,
    senderAvatar: doc.senderAvatar || "",
    text:         doc.text || "",
    type:         doc.type || "text",
    meta:         doc.meta ?? null,
    createdAt:    doc.createdAt instanceof Date ? doc.createdAt.toISOString() : String(doc.createdAt),
  };
}

export function normalizeGroup(g) {
  return {
    id:      String(g._id),
    name:    g.name,
    ownerId: String(g.ownerId),
    members: (g.members || []).map((m) => ({
      userId:    String(m.userId),
      username:  m.username,
      avatarUrl: m.avatarUrl || "",
      joinedAt:  m.joinedAt instanceof Date ? m.joinedAt.toISOString() : String(m.joinedAt || ""),
    })),
    createdAt: g.createdAt instanceof Date ? g.createdAt.toISOString() : String(g.createdAt || ""),
  };
}

/* =========================
   CHAT + GROUP + DM SOCKET HANDLERS
========================= */

async function registerChatHandlers(socket) {
  let chatUser = null;

  async function verifyUser() {
    if (chatUser) return chatUser;
    const token = socket.handshake.auth?.token;
    if (!token) throw new Error("Unauthorized");
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const userId  = payload.sub || payload.id;
    const user    = await User.findById(userId).select("username fullName avatarUrl").lean();
    if (!user) throw new Error("User not found");
    chatUser = {
      userId:      String(user._id),
      username:    user.username,
      displayName: user.fullName || user.username,
      avatarUrl:   user.avatarUrl || "",
    };
    return chatUser;
  }

  function trackRoom(roomId) {
    if (!onlineUsers.has(socket.id)) {
      onlineUsers.set(socket.id, { ...chatUser, socketId: socket.id, rooms: new Set() });
    }
    onlineUsers.get(socket.id).rooms.add(roomId);
  }

  /* ── Global: chat:join ── */
  socket.on("chat:join", async ({ roomId = "global" } = {}) => {
    try {
      // roomId is client input, used both as a Socket.IO room name and as a
      // MongoDB query filter value below. Coerce to a plain string BEFORE either
      // use — otherwise a payload like {$ne:"x"} would be passed straight into
      // ChatMessage.find({ roomId }) and interpreted as a Mongo query operator,
      // matching every message in every room (including private DM/group rooms)
      // instead of just this one. Reject non-string/non-number input outright
      // rather than silently stringifying an object into a nonsense room name.
      if (typeof roomId !== "string" && typeof roomId !== "number") {
        return socket.emit("chat:error", { message: "Invalid room." });
      }
      const safeRoomId = String(roomId).trim().slice(0, 200) || "global";

      const user = await verifyUser();
      socket.join(`chat:${safeRoomId}`);
      trackRoom(safeRoomId);

      const history = await ChatMessage.find({ roomId: safeRoomId })
        .sort({ createdAt: -1 }).limit(50).lean();

      socket.emit("chat:history", { roomId: safeRoomId, messages: history.reverse().map(normalizeMsg) });

      socket.to(`chat:${safeRoomId}`).emit("chat:system", {
        id: `sys-join-${socket.id}`, roomId: safeRoomId,
        text: `${user.displayName} joined`, type: "system",
        createdAt: new Date().toISOString(),
      });

      broadcastOnlineUsers(safeRoomId);
    } catch (err) {
      socket.emit("chat:error", { message: err.message });
    }
  });

  /* ── Global: chat:message ── */
  socket.on("chat:message", async ({ roomId = "global", text } = {}) => {
    try {
      const user  = await verifyUser();
      const clean = String(text || "").trim().slice(0, 2000);
      if (!clean) return;

      const doc = await ChatMessage.create({
        roomId, senderId: user.userId,
        senderName: user.displayName, senderAvatar: user.avatarUrl, text: clean,
      });

      io.to(`chat:${roomId}`).emit("chat:message", normalizeMsg(doc));
      socket.to(`chat:${roomId}`).emit("chat:stop_typing", { userId: user.userId, roomId });
    } catch (err) {
      socket.emit("chat:error", { message: err.message });
    }
  });

  /* ── Global: typing ── */
  socket.on("chat:typing", ({ roomId = "global" } = {}) => {
    if (!chatUser) return;
    socket.to(`chat:${roomId}`).emit("chat:typing", {
      userId: chatUser.userId, username: chatUser.displayName, roomId,
    });
  });

  socket.on("chat:stop_typing", ({ roomId = "global" } = {}) => {
    if (!chatUser) return;
    socket.to(`chat:${roomId}`).emit("chat:stop_typing", { userId: chatUser.userId, roomId });
  });

  /* ── Group: group:join ── */
  socket.on("group:join", async ({ groupId } = {}) => {
    try {
      const user  = await verifyUser();
      const group = await PrivateGroup.findById(groupId).lean();
      if (!group) return socket.emit("chat:error", { message: "Group not found" });

      const isMember = group.members.some((m) => String(m.userId) === user.userId);
      if (!isMember) return socket.emit("chat:error", { message: "Not a member of this group" });

      const roomId = `group:${groupId}`;
      socket.join(roomId);
      trackRoom(roomId);
      console.log(`[CHAT_SOCKET] user=${user.userId} joined ${roomId}`);

      const history = await ChatMessage.find({ roomId })
        .sort({ createdAt: -1 }).limit(50).lean();

      socket.emit("chat:history", { roomId, messages: history.reverse().map(normalizeMsg) });
    } catch (err) {
      socket.emit("chat:error", { message: err.message });
    }
  });

  /* ── Group: group:message ── */
  socket.on("group:message", async ({ groupId, text } = {}) => {
    try {
      const user  = await verifyUser();
      const clean = String(text || "").trim().slice(0, 2000);
      if (!clean) return;

      const group = await PrivateGroup.findById(groupId).lean();
      if (!group) return socket.emit("chat:error", { message: "Group not found" });

      const isMember = group.members.some((m) => String(m.userId) === user.userId);
      if (!isMember) return socket.emit("chat:error", { message: "Not a member of this group" });

      const roomId = `group:${groupId}`;
      const doc    = await ChatMessage.create({
        roomId, senderId: user.userId,
        senderName: user.displayName, senderAvatar: user.avatarUrl, text: clean,
      });

      io.to(roomId).emit("chat:message", normalizeMsg(doc));
      socket.to(roomId).emit("chat:stop_typing", { userId: user.userId, roomId });
      console.log(`[CHAT_SOCKET] group message emitted room=${roomId} sender=${user.userId}`);
    } catch (err) {
      socket.emit("chat:error", { message: err.message });
    }
  });

  /* ── Group: typing ── */
  socket.on("group:typing", ({ groupId } = {}) => {
    if (!chatUser || !groupId) return;
    const roomId = `group:${groupId}`;
    socket.to(roomId).emit("chat:typing", {
      userId: chatUser.userId, username: chatUser.displayName, roomId,
    });
  });

  socket.on("group:stop_typing", ({ groupId } = {}) => {
    if (!chatUser || !groupId) return;
    socket.to(`group:${groupId}`).emit("chat:stop_typing", { userId: chatUser.userId, roomId: `group:${groupId}` });
  });

  /* ══════════════════════════════════════════════
     DM HANDLERS
  ══════════════════════════════════════════════ */

  /* ── DM: dm:join ── */
  socket.on("dm:join", async ({ convId } = {}) => {
    try {
      const user = await verifyUser();
      if (!convId) return;

      const conv = await DMConversation.findById(convId).lean();
      if (!conv) return socket.emit("chat:error", { message: "Conversation not found" });

      const isParticipant = conv.participants.some(p => String(p) === user.userId);
      if (!isParticipant) return socket.emit("chat:error", { message: "Not a participant" });

      const roomId = `dm:${convId}`;
      socket.join(roomId);

      const history = await ChatMessage.find({ roomId })
        .sort({ createdAt: -1 }).limit(50).lean();

      socket.emit("chat:history", { roomId, messages: history.reverse().map(normalizeMsg) });
    } catch (err) {
      socket.emit("chat:error", { message: err.message });
    }
  });

  /* ── DM: dm:message ── */
  socket.on("dm:message", async ({ convId, text } = {}) => {
    try {
      const user  = await verifyUser();
      const clean = String(text || "").trim().slice(0, 2000);
      if (!clean || !convId) return;

      const conv = await DMConversation.findById(convId).lean();
      if (!conv) return socket.emit("chat:error", { message: "Conversation not found" });

      const isParticipant = conv.participants.some(p => String(p) === user.userId);
      if (!isParticipant) return socket.emit("chat:error", { message: "Not a participant" });

      const recipientId = String(conv.participants.find(p => String(p) !== user.userId));

      // Mutual block check
      const hasBlock = await Block.findOne({
        $or: [
          { blockerId: user.userId, blockedId: recipientId },
          { blockerId: recipientId, blockedId: user.userId },
        ],
      }).lean();
      if (hasBlock) return socket.emit("chat:error", { message: "Cannot message a blocked user" });

      // Persist message
      const roomId = `dm:${convId}`;
      const doc = await ChatMessage.create({
        roomId,
        senderId:     user.userId,
        senderName:   user.displayName,
        senderAvatar: user.avatarUrl,
        text:         clean,
      });

      // Update conversation metadata + unread + unhide for recipient
      // Mongoose auto-casts recipientId string to ObjectId for the $pull
      await DMConversation.findByIdAndUpdate(convId, {
        $set: {
          lastMessage:   clean.slice(0, 120),
          lastMessageAt: new Date(),
          lastSenderId:  user.userId,
        },
        $inc:  { [`unread.${recipientId}`]: 1 },
        $pull: { hiddenFor: recipientId },
      });

      // Emit message to everyone in the DM room
      io.to(roomId).emit("dm:message", normalizeMsg(doc));

      // Stop-typing broadcast
      socket.to(roomId).emit("dm:stop_typing", { userId: user.userId, convId });

      // Push updated conversation summaries to both users' personal rooms
      // so the sidebar unread count updates even if they haven't joined the DM room
      const updated = await DMConversation.findById(convId)
        .populate("participants", "username avatarUrl")
        .lean();

      if (updated) {
        io.to(`user:${user.userId}`).emit("dm:conversation",
          { conversation: normalizeDMConv(updated, user.userId) });
        io.to(`user:${recipientId}`).emit("dm:conversation",
          { conversation: normalizeDMConv(updated, recipientId) });
      }
    } catch (err) {
      socket.emit("chat:error", { message: err.message });
    }
  });

  /* ── DM: typing ── */
  socket.on("dm:typing", ({ convId } = {}) => {
    if (!chatUser || !convId) return;
    socket.to(`dm:${convId}`).emit("dm:typing", {
      userId: chatUser.userId, username: chatUser.displayName, convId,
      roomId: `dm:${convId}`,
    });
  });

  socket.on("dm:stop_typing", ({ convId } = {}) => {
    if (!chatUser || !convId) return;
    socket.to(`dm:${convId}`).emit("dm:stop_typing", {
      userId: chatUser.userId, convId,
      roomId: `dm:${convId}`,
    });
  });

  /* ── Disconnect cleanup ── */
  socket.on("disconnect", () => {
    const u = onlineUsers.get(socket.id);
    if (!u) return;

    u.rooms.forEach((roomId) => {
      if (!roomId.startsWith("group:") && !roomId.startsWith("dm:")) {
        socket.to(`chat:${roomId}`).emit("chat:system", {
          id: `sys-leave-${socket.id}`, roomId,
          text: `${u.displayName} left`, type: "system",
          createdAt: new Date().toISOString(),
        });
      }
      const remaining = getOnlineUsersInRoom(roomId)
        .filter((x) => x.userId !== u.userId ||
          [...onlineUsers.entries()].some(
            ([sid, ou]) => sid !== socket.id && ou.userId === x.userId && ou.rooms.has(roomId)
          ));
      io.to(`chat:${roomId}`).emit("chat:online_users", { roomId, users: remaining });
    });

    onlineUsers.delete(socket.id);
  });
}

/* =========================
   INIT
========================= */

function getVerifiedUserId(socket) {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) return null;
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    return String(payload.sub || payload.id);
  } catch {
    return null;
  }
}

export const initSocket = () => {
  if (io) return io;

  const isProd = process.env.NODE_ENV === "production";

  // Allowed origins — single source of truth in config/clientUrls.js.
  const socketOrigins = getAllowedOrigins(isProd);

  console.log("🔌 Socket.IO CORS origins:", socketOrigins);

  io = new Server(server, {
    cors: {
      origin: socketOrigins,
      credentials: true,
      methods: ["GET", "POST"],
    },
    // Buffer events for briefly-disconnected clients and replay on reconnect.
    // 60s covers: mobile switching apps, network handoffs, phone lock/unlock,
    // short Render cold-start, brief Wi-Fi drops.
    // Events older than this are permanently lost — FCM push covers the rest.
    connectionStateRecovery: {
      maxDisconnectionDuration: 60_000,
      skipMiddlewares: true,
    },
  });

  io.on("connection", (socket) => {
    console.log("✅ socket connected:", socket.id);

    socket.on("join_user", (userId) => {
      const verifiedId = getVerifiedUserId(socket);
      if (!verifiedId) {
        console.warn(`[socket] join_user rejected — no valid/verifiable auth token, socket=${socket.id}`);
        return;
      }
      socket.join(`user:${verifiedId}`);
      const roomSize = io.sockets.adapter.rooms.get(`user:${verifiedId}`)?.size ?? 0;
      console.log(`[socket] join_user — socket=${socket.id} joined room=user:${verifiedId} | sockets in room: ${roomSize}`);
    });

    /* Trade conversation rooms — join to receive live comments.
       GET /api/trades/:id/comments is a public, unauthenticated endpoint
       (trade post negotiation threads are intentionally public), so this
       isn't a data-privacy gate — it's a sanity check that postId refers to
       a real trade post, so a client can't spam the server into creating
       and tracking an unbounded number of rooms for nonexistent/garbage ids. */
    socket.on("trade:join-conv", async ({ postId } = {}) => {
      if (!postId || !mongoose.Types.ObjectId.isValid(postId)) return;
      try {
        const exists = await TradePost.exists({ _id: postId });
        if (!exists) return;
        socket.join(`trade-conv:${postId}`);
      } catch (err) {
        console.warn("[socket] trade:join-conv lookup failed:", err?.message || err);
      }
    });

    socket.on("trade:leave-conv", ({ postId } = {}) => {
      if (!postId) return;
      socket.leave(`trade-conv:${postId}`);
    });

    /* Market / auction live-update rooms — scope the high-frequency
       market:deals / auctions:update broadcasts to only the clients whose
       UI is actually rendering that data (Market / Auctions pages), instead
       of fanning every update out to every connected socket regardless of
       what page they're on. */
    socket.on("market:subscribe", () => socket.join("market:live"));
    socket.on("market:unsubscribe", () => socket.leave("market:live"));
    socket.on("auctions:subscribe", () => socket.join("auctions:live"));
    socket.on("auctions:unsubscribe", () => socket.leave("auctions:live"));

    socket.on("disconnect", (reason) => {
      console.log("❌ socket disconnected:", socket.id, reason);
    });

    registerChatHandlers(socket);
  });

  // Periodic cleanup — remove onlineUsers entries whose socket is no longer
  // connected. Covers the case where a client crashes without a clean disconnect,
  // which would leave a ghost entry that shows the user as online indefinitely.
  setInterval(() => {
    for (const [socketId, entry] of onlineUsers.entries()) {
      const sock = io.sockets.sockets.get(socketId);
      if (!sock || !sock.connected) {
        onlineUsers.delete(socketId);
        console.log(`[socket] cleaned ghost onlineUsers entry for socketId=${socketId} userId=${entry?.userId}`);
      }
    }
  }, 5 * 60 * 1000).unref();

  return io;
};

/* =========================
   EMIT HELPERS
========================= */

export const getIO = () => {
  if (!io) throw new Error("Socket.io not initialized yet.");
  return io;
};

export const emitPriceAlert = (payload = {}) => {
  if (!io) {
    console.warn("[emitPriceAlert] io not initialized — emit dropped");
    return;
  }
  const userId = payload.userId;
  if (!userId) {
    console.warn("[emitPriceAlert] no userId in payload — emit dropped");
    return;
  }
  const room = `user:${userId}`;
  const socketsInRoom = io.sockets.adapter.rooms.get(room)?.size ?? 0;
  console.log(`[emitPriceAlert] → room="${room}" sockets=${socketsInRoom} item="${payload.name}"`);
  if (socketsInRoom === 0) {
    console.warn(`[emitPriceAlert] ⚠️  no sockets in room "${room}" — alert will not be received`);
  }
  io.to(room).emit("price_alert", {
    ...payload,
    createdAt: payload.createdAt || new Date().toISOString(),
  });
};

// Scoped to the "market:live" / "auctions:live" rooms — only clients whose
// UI joined via market:subscribe / auctions:subscribe receive these (see
// AuctionsPage.jsx / Market.jsx). item_deleted and trade:new-post stay as
// global io.emit below since they're consumed by pages outside these rooms
// (e.g. Alerts.jsx listens for item_deleted) and their payload/frequency is
// small enough that scoping them isn't worth the added complexity.
export const emitMarketDeals = (items = []) => {
  if (!io) return;
  io.to("market:live").emit("market:deals", items);
};

export const emitAuctionUpdate = (items = []) => {
  if (!io) return;
  io.to("auctions:live").emit("auctions:update", items);
};

export const emitTradePost = (post = {}) => {
  if (!io) return;
  io.emit("trade:new-post", post);
};
