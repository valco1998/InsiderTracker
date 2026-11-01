// server/socket/insiderSocket.js
//
// Minimal Socket.IO for Insider Tracker (no chat / DM / trade handlers).
//   • JWT is verified at connection time — unauthenticated sockets are rejected.
//   • Each socket joins only its own verified room `user:<id>`.
//   • `join_user` (sent by the existing client SocketContext) is accepted but the
//     client-supplied id is ignored; the verified id is used.
// Insider alerts use a NEW event name, `insider:alert`, so legacy CS2 listeners
// (RealtimeAlertPopup on `price_alert`) never receive them.
import { Server } from "socket.io";
import jwt from "jsonwebtoken";

let io = null;

export function verifySocketToken(token, secret = process.env.JWT_SECRET) {
  if (!token || typeof token !== "string" || !secret) return null;
  try {
    const payload = jwt.verify(token, secret, { algorithms: ["HS256"] });
    const id = String(payload.sub || payload.id || "");
    return /^[a-f0-9]{24}$/i.test(id) ? id : null;
  } catch {
    return null;
  }
}

export function initInsiderSocket(httpServer, { origins }) {
  io = new Server(httpServer, { cors: { origin: origins, credentials: true } });

  io.use((socket, next) => {
    const userId = verifySocketToken(socket.handshake.auth?.token);
    if (!userId) return next(new Error("unauthorized"));
    socket.data.userId = userId;
    next();
  });

  io.on("connection", (socket) => {
    const room = `user:${socket.data.userId}`;
    socket.join(room);
    socket.on("join_user", () => socket.join(room));
  });

  return io;
}

export function emitToUser(userId, event, payload) {
  if (!io) return false;
  io.to(`user:${String(userId)}`).emit(event, payload);
  return true;
}
