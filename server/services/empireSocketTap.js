// server/services/empireSocketTap.js
import { io } from "socket.io-client";

let socket = null;

const state = {
  startedAt: 0,
  lastConnectAt: 0,
  lastDisconnectAt: 0,
  lastDisconnectReason: null,

  lastEventAt: 0,
  lastEventName: null,
  eventsSeen: 0,

  lastError: null,
  lastErrorDetails: null,

  samples: [],

  url: null,
  path: null,
  transports: [],
  tokenInfo: null, // { len, dots, sub, exp, expInSec, uidMatchesSub }
};

function resetState() {
  state.startedAt = Date.now();
  state.lastConnectAt = 0;
  state.lastDisconnectAt = 0;
  state.lastDisconnectReason = null;

  state.lastEventAt = 0;
  state.lastEventName = null;
  state.eventsSeen = 0;

  state.lastError = null;
  state.lastErrorDetails = null;

  state.samples = [];

  state.url = null;
  state.path = null;
  state.transports = [];
  state.tokenInfo = null;
}

function pushSample(entry) {
  state.samples.unshift(entry);
  if (state.samples.length > 25) state.samples.pop();
}

function safeJsonPreview(x, max = 280) {
  try {
    if (x == null) return "";
    if (typeof x === "string") return x.slice(0, max);
    return JSON.stringify(x).slice(0, max);
  } catch {
    return "[unprintable]";
  }
}

function maskToken(v) {
  if (!v) return v;
  const s = String(v);
  if (s.length <= 10) return "***";
  return s.slice(0, 4) + "***" + s.slice(-4);
}

function sanitizeToken(raw) {
  // ⚠️ אם המשתמש העתק "token&EIO=4&transport=websocket" — נחתוך מה-&
  const s = String(raw || "").trim();
  if (!s) return "";
  const cut = s.split("&")[0].trim();
  return cut;
}

function pickUidTokenFromEnv() {
  const uid = String(process.env.EMPIRE_UID || "").trim();
  const token = sanitizeToken(process.env.EMPIRE_TOKEN || "");
  return { uid, token };
}

function assertUidToken({ uid, token }) {
  if (!uid) throw new Error("Missing EMPIRE_UID — add EMPIRE_UID to server/.env");
  if (!token) throw new Error("Missing EMPIRE_TOKEN — add EMPIRE_TOKEN to server/.env");
}

function base64UrlToJson(b64url) {
  const pad = "=".repeat((4 - (b64url.length % 4)) % 4);
  const b64 = (b64url + pad).replace(/-/g, "+").replace(/_/g, "/");
  const json = Buffer.from(b64, "base64").toString("utf8");
  return JSON.parse(json);
}

function inspectToken(uid, token) {
  const t = sanitizeToken(token);
  const dots = (t.match(/\./g) || []).length;
  const info = { len: t.length, dots, sub: null, exp: null, expInSec: null, uidMatchesSub: null };

  if (dots !== 2) return info;

  try {
    const payload = base64UrlToJson(t.split(".")[1]);
    info.sub = payload?.sub != null ? String(payload.sub) : null;
    info.exp = payload?.exp != null ? Number(payload.exp) : null;
    if (Number.isFinite(info.exp)) info.expInSec = info.exp - Math.floor(Date.now() / 1000);
    info.uidMatchesSub = info.sub && String(uid) ? info.sub === String(uid) : null;
    return info;
  } catch {
    return info;
  }
}

function ensureNotExpired(tokenInfo) {
  const expInSec = tokenInfo?.expInSec;
  // אם אין exp — לא נכשיל (אבל לרוב יש)
  if (!Number.isFinite(expInSec)) return;
  if (expInSec <= 0) {
    throw new Error(`Token expired (${expInSec}s). Refresh EMPIRE_TOKEN and restart server.`);
  }
}

/**
 * Start a passive socket tap to Empire roulette socket.
 * Note: roulette token בדרך כלל קצר־חיים מאוד.
 */
export function startEmpireSocketTap({
  url = "https://roulette.csgoempire.com",
  path = "/s/",
  transports = ["websocket"],

  query = undefined, // { uid, token }
  auth = undefined,

  logEveryMs = 800,
  origin = "https://csgoempire.com",
  userAgent =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
  timeoutMs = 20000,
} = {}) {
  if (socket) return socket;

  resetState();

  const q0 = query ?? pickUidTokenFromEnv();
  const q = { uid: String(q0.uid || "").trim(), token: sanitizeToken(q0.token || "") };

  assertUidToken(q);

  state.tokenInfo = inspectToken(q.uid, q.token);
  state.url = url;
  state.path = path;
  state.transports = Array.isArray(transports) ? transports : ["websocket"];

  // ✅ fail fast if token format broken
  if (state.tokenInfo?.dots !== 2) {
    state.lastError = "Token looks invalid (JWT must contain 2 dots). Use only the JWT part (before &EIO=...).";
    throw new Error(state.lastError);
  }

  // ✅ fail fast if expired
  ensureNotExpired(state.tokenInfo);

  const qSafe = { ...q, token: maskToken(q.token) };

  console.log("🛰️ starting Empire socket tap:", {
    url,
    path,
    transports: state.transports,
    query: qSafe,
    tokenInfo: state.tokenInfo,
    timeoutMs,
  });

  socket = io(url, {
    path,
    transports: state.transports,
    query: q,
    auth,

    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 5000,

    timeout: timeoutMs,
    forceNew: true,

    extraHeaders: {
      Origin: origin,
      "User-Agent": userAgent,
    },
  });

  try {
    socket.io.on("error", (e) => {
      const msg = e?.message || String(e);
      state.lastError = msg;
      state.lastErrorDetails = { where: "engine", message: msg };
      console.log("🧩 engine error:", msg);
    });
  } catch {}

  socket.on("connect", () => {
    state.lastError = null;
    state.lastErrorDetails = null;
    state.lastConnectAt = Date.now();
    console.log("🟢 Empire socket connected:", socket.id);
  });

  socket.on("disconnect", (reason) => {
    state.lastDisconnectAt = Date.now();
    state.lastDisconnectReason = reason;
    console.log("🟡 Empire socket disconnected:", reason);
  });

  socket.on("connect_error", (err) => {
    const msg = err?.message || String(err);
    state.lastError = msg;
    state.lastErrorDetails = {
      where: "connect_error",
      message: msg,
      name: err?.name,
      code: err?.code,
      description: err?.description,
    };
    console.log("🔴 Empire socket connect_error:", msg);
  });

  let lastLogAt = 0;
  socket.onAny((event, ...args) => {
    state.eventsSeen += 1;
    state.lastEventAt = Date.now();
    state.lastEventName = event;

    const sample0 = args?.[0];
    pushSample({ at: new Date().toISOString(), event, preview: safeJsonPreview(sample0) });

    const now = Date.now();
    if (now - lastLogAt >= logEveryMs) {
      lastLogAt = now;
      console.log(`📨 [empire] ${event} ::`, safeJsonPreview(sample0));
    }
  });

  return socket;
}

export function stopEmpireSocketTap() {
  if (!socket) return;

  try {
    socket.removeAllListeners();
    socket.close();
  } finally {
    socket = null;
  }

  console.log("🛑 Empire socket tap stopped");
}

export function getEmpireTapStatus() {
  return {
    hasSocket: !!socket,
    connected: !!socket?.connected,
    id: socket?.id || null,

    startedAt: state.startedAt || null,
    lastConnectAt: state.lastConnectAt || null,
    lastDisconnectAt: state.lastDisconnectAt || null,
    lastDisconnectReason: state.lastDisconnectReason || null,

    lastEventAt: state.lastEventAt || null,
    lastEventName: state.lastEventName || null,
    eventsSeen: state.eventsSeen || 0,

    lastError: state.lastError || null,
    lastErrorDetails: state.lastErrorDetails || null,

    url: state.url,
    path: state.path,
    transports: state.transports,
    tokenInfo: state.tokenInfo,

    samples: state.samples,
  };
}
