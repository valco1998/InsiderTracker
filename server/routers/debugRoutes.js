// server/routes/debugRoutes.js
import { Router } from "express";
import User from "../models/users.models.js";
import { getIO } from "../socket/socket.js";

import {
  startEmpireSocketTap,
  stopEmpireSocketTap,
  getEmpireTapStatus,
} from "../services/empireSocketTap.js";

const router = Router();

/* =========================
   Helpers
========================= */
function safeStr(v) {
  return String(v ?? "").trim();
}

function toBool(v, def = false) {
  if (v === undefined || v === null || v === "") return def;
  return v === true || v === "1" || String(v).toLowerCase() === "true";
}

function sendBadRequest(res, msg) {
  return res.status(400).json({ ok: false, error: msg });
}

function logErr(tag, e) {
  console.error(`[debugRoutes] ${tag}:`, e?.message || e);
}

function parseTransports(raw) {
  // default: websocket only (נמנע מ-xhr poll error)
  const s = safeStr(raw);
  if (!s) return ["websocket"];

  const parts = s
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);

  const allow = new Set(["websocket", "polling"]);
  const out = parts.filter((p) => allow.has(p));
  return out.length ? out : ["websocket"];
}

/* =========================
   ROUTES
========================= */

// GET /api/debug/user-exists/:userName
router.get("/user-exists/:userName", async (req, res) => {
  try {
    const userName = safeStr(req.params.userName);
    if (!userName) return sendBadRequest(res, "Missing userName");

    const u = await User.findOne({ $or: [{ userName }, { username: userName }] })
      .select("_id userName username fullName email profilePic")
      .lean();

    return res.json({ ok: true, exists: Boolean(u), user: u || null });
  } catch (e) {
    logErr("GET /user-exists", e);
    return res.status(500).json({ ok: false, error: e?.message || "Server error" });
  }
});

// GET /api/debug/me-cookie
router.get("/me-cookie", (req, res) => {
  return res.json({ ok: true, cookies: req.cookies || {} });
});

// POST /api/debug/alert
router.post("/alert", (req, res) => {
  const body = req.body || {};

  const userId = safeStr(body.userId);
  if (!userId) return sendBadRequest(res, "Missing userId");

  const itemId = safeStr(body.itemId) || `test-${Date.now()}`;
  const name = safeStr(body.name) || "Test Item";

  const priceNow = Number(body.priceNow);
  const price = Number.isFinite(priceNow) ? priceNow : 8.42;

  const dropPct = Number(body.dropPct);
  const discountPct = Number.isFinite(dropPct) ? dropPct : 12;

  const image = safeStr(body.image) || "https://placehold.co/64x64";

  const payload = {
    scope: "debug",
    sentAt: new Date().toISOString(),
    item: { id: itemId, name, price, discountPct, image },
    reasons: [{ type: "debug" }],
  };

  const publicFlag = toBool(body.public, false);

  try {
    const io = getIO();
    io.to(`user:${userId}`).emit("alert", payload);
    if (publicFlag) io.emit("alert", payload);

    return res.json({
      ok: true,
      sent: payload,
      meta: { to: `user:${userId}`, public: publicFlag },
    });
  } catch (e) {
    logErr("POST /alert socket", e);
    return res.status(500).json({ ok: false, error: "Socket not initialized" });
  }
});

// GET /api/debug/socket-status
router.get("/socket-status", (_req, res) => {
  try {
    const io = getIO();
    const clients = io.engine?.clientsCount ?? null;
    const roomsCount = io.sockets.adapter?.rooms?.size ?? null;
    return res.json({ ok: true, clients, roomsCount });
  } catch {
    return res.status(500).json({ ok: false, error: "Socket not initialized" });
  }
});

// GET /api/debug/room/:userId
router.get("/room/:userId", (req, res) => {
  try {
    const io = getIO();
    const userId = safeStr(req.params.userId);
    if (!userId) return sendBadRequest(res, "Missing userId");

    const room = `user:${userId}`;
    const set = io.sockets.adapter.rooms.get(room);
    const size = set ? set.size : 0;

    return res.json({ ok: true, room, size });
  } catch {
    return res.status(500).json({ ok: false, error: "Socket not initialized" });
  }
});

/**
 * POST /api/debug/force-join
 * body: { userId }
 * emits to all clients: force_join_user { userId }
 */
router.post("/force-join", (req, res) => {
  try {
    const io = getIO();
    const userId = safeStr(req.body?.userId);
    if (!userId) return sendBadRequest(res, "Missing userId");

    io.emit("force_join_user", { userId });
    return res.json({ ok: true, emitted: true, userId });
  } catch {
    return res.status(500).json({ ok: false, error: "Socket not initialized" });
  }
});

// GET /api/debug/rooms
router.get("/rooms", (_req, res) => {
  try {
    const io = getIO();
    const rooms = [];

    for (const [name, set] of io.sockets.adapter.rooms.entries()) {
      if (io.sockets.sockets.get(name)) continue; // ignore per-socket rooms
      rooms.push({ room: name, size: set?.size ?? 0 });
    }

    rooms.sort((a, b) => b.size - a.size);
    return res.json({ ok: true, rooms, roomsCount: rooms.length });
  } catch {
    return res.status(500).json({ ok: false, error: "Socket not initialized" });
  }
});

/**
 * GET /api/debug/empire-socket/start
 * requires: EMPIRE_UID, EMPIRE_TOKEN
 *
 * Optional query params:
 * - url=https://roulette.csgoempire.com
 * - path=/s/
 * - transports=websocket (default)
 * - transports=websocket,polling
 * - logEveryMs=800
 */
router.get("/empire-socket/start", (req, res) => {
  const uid = safeStr(process.env.EMPIRE_UID);
  const token = safeStr(process.env.EMPIRE_TOKEN);

  if (!uid) return sendBadRequest(res, "Missing EMPIRE_UID in .env");
  if (!token) return sendBadRequest(res, "Missing EMPIRE_TOKEN in .env");

  const url = safeStr(req.query.url) || "https://roulette.csgoempire.com";
  const path = safeStr(req.query.path) || "/s/";
  const transports = parseTransports(req.query.transports);
  const logEveryMs = Number(req.query.logEveryMs ?? 800) || 800;

  try {
    startEmpireSocketTap({
      url,
      path,
      transports,
      query: { uid, token },
      logEveryMs,
    });

    return res.json({ ok: true, started: true, url, path, transports, logEveryMs });
  } catch (e) {
    return res.status(400).json({ ok: false, error: e?.message || "Failed to start tap" });
  }
});

// GET /api/debug/empire-socket/stop
router.get("/empire-socket/stop", (_req, res) => {
  stopEmpireSocketTap();
  return res.json({ ok: true, stopped: true });
});

// GET /api/debug/empire-socket/status
router.get("/empire-socket/status", (_req, res) => {
  return res.json({ ok: true, ...getEmpireTapStatus() });
});

router.get("/ping", (_req, res) => res.json({ ok: true, route: "debug/ping" }));

// GET /api/debug/env-check
router.get("/env-check", (_req, res) => {
  res.json({
    ok: true,
    hasUID: Boolean(String(process.env.EMPIRE_UID || "").trim()),
    hasTOKEN: Boolean(String(process.env.EMPIRE_TOKEN || "").trim()),
    hasAPIKEY: Boolean(String(process.env.EMPIRE_API_KEY || "").trim()),
  });
});

export default router;
