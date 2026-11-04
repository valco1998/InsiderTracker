// server/server.js
// LEGACY SkinTel entry point — blocked unless explicitly allowed, never against InsiderTracker.
import "./config/legacyServerGuard.js"; // must stay the FIRST import
import express from "express";
import "dotenv/config";
import cookieParser from "cookie-parser";
import cors from "cors";
import compression from "compression";

// ROUTES
import authRoutes from "./routers/authRoutes.js";
import watchRoutes from "./routers/watchlistRoutes.js";
import empireRoutes from "./routers/empireRoutes.js";
import userFilterRoutes from "./routers/userFilterRoutes.js";
import systemSettingsRoutes from "./routers/SystemSettings.js";
import routerItem from "./routers/items.Routers.js";
import alertRoutes from "./routers/alertRoutes.js";
import chatRoutes from "./routers/chatRoutes.js";
import socialRoutes from "./routers/socialRoutes.js";
import dmRoutes from "./routers/dmRoutes.js";
import steamRoutes from "./routers/steamRoutes.js";
import { startMarketWorker } from "./services/marketWorker.js";
import { startAuctionWorker } from "./services/auctionWorker.js";
import { warmHomePremiumCache } from "./services/marketCache.js";
import { startSkinMetricsAggregator } from "./jobs/skinMetricsAggregator.js";

// CORE
import connectToMongoDB from "./db/connectToMongooseDB.js";
import { app, server, initSocket } from "./socket/socket.js";
import { startAlertEngine } from "./jobs/alertEngine.js";
import AlertLog from "./models/alertLog.models.js";
import { ensureSystemSettingsDefaults } from "./models/systemSettingsmodels.js";
import { startEmpireMarketSocket, stopEmpireMarketSocket, getEmpireMarketSocketStatus } from "./services/empireMarketSocket.js";
import auctionRoutes           from "./routers/auctionRoutes.js";
import auctionAlertRoutes           from "./routers/auctionAlertRoutes.js";
import { sweepExpiredAuctionAlerts } from "./services/auctionAlertEngine.js";
import tradeRoutes             from "./routers/tradeRoutes.js";
import tradeNotificationRoutes from "./routers/tradeNotificationRoutes.js";
import pushRoutes              from "./routers/pushRoutes.js";
import { initFirebaseAdmin, isFcmReady } from "./services/fcm.js";
import { getAllowedOrigins, CLIENT_URL } from "./config/clientUrls.js";
import notificationMetricsRoutes from "./routers/notificationMetricsRoutes.js";
import { recordEvent } from "./services/notificationMetrics.js";
import { flushNow as flushSnapshots } from "./services/priceSnapshotWriter.js";
import { bandwidthMetrics, logBandwidthSummary } from "./middelware/bandwidthMetrics.js";


console.log("✅ server/server.js loaded");

/* ======================
   GLOBAL ERROR HOOKS
====================== */
process.on("unhandledRejection", (err) => {
  console.error("❌ unhandledRejection:", err);
});

process.on("uncaughtException", (err) => {
  console.error("❌ uncaughtException:", err);
});

/* ======================
   GRACEFUL SHUTDOWN
====================== */
const shutdown = (signal) => {
  console.log(`🛑 ${signal} received. Shutting down...`);

  server.close(async () => {
    console.log("✅ HTTP server closed");
    try { await flushSnapshots(); } catch {}
    process.exit(0);
  });
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

/* ======================
   MIDDLEWARES
====================== */
app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());

// Bandwidth instrumentation — must run BEFORE compression() so it wraps the
// outer res.write/res.end and measures bytes actually sent to the client
// (compression re-patches res.write/res.end on top of this and calls back
// into our patched versions with the already-compressed chunks).
app.use(bandwidthMetrics);

// gzip/brotli-capable compression for all JSON/text responses over ~1KB
// (default threshold). Cuts typical JSON payload size by ~70-80%.
app.use(compression());

// ETag left at Express's default ("weak") so semi-static routes that opt
// into cachePrivate() (see server/middelware/cachePolicy.js) can serve 304s.
// Harmless for everything else: the no-store default below still forbids
// any caching, so a computed-but-unused ETag is just a no-op header.
app.use((req, res, next) => {
  if (req.originalUrl.startsWith("/api")) {
    // DEFAULT for every /api/* route: no caching. Routes that are safe to
    // cache (semi-static, non-personalized, e.g. market/auction listings)
    // override this further down the chain via cachePrivate() — Express
    // middleware runs in registration order, and headers aren't flushed
    // until the response is sent, so a later res.set() call always wins.
    // Never apply cachePrivate() to auth, alerts, watch, steam, push, chat,
    // dm, social, or trade routes — those stay no-store.
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
  }
  next();
});

const isProd = process.env.NODE_ENV === "production";

// Allowed CORS origins — single source of truth in config/clientUrls.js.
// On Render set CLIENT_ORIGIN=https://www.skin-tel.com
// and/or CORS_ORIGIN=https://a.com,https://b.com for any extra origins.
const allowedOrigins = getAllowedOrigins(isProd);

console.log("🌐 CORS allowed origins:", allowedOrigins);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      // Allow Chrome / Firefox extension service workers
      // (endpoints are still protected by JWT — this only lifts the CORS gate)
      if (/^(chrome|moz)-extension:\/\//.test(origin)) return cb(null, true);
      return cb(new Error("CORS blocked: " + origin));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.options("*", cors({ credentials: true }));

/* ======================
   HEALTH
====================== */
app.get("/health", (_req, res) => {
  res.json({ ok: true, fcmReady: isFcmReady() });
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, fcmReady: isFcmReady() });
});

/* ======================
   ROUTES
====================== */
app.use("/api/auth", authRoutes);
app.use("/api/watch", watchRoutes);
app.use("/api/settings", systemSettingsRoutes);
app.use("/api/empire", empireRoutes);
app.use("/api/user-filters", userFilterRoutes);
app.use("/api/items", routerItem);
app.use("/api/alerts", alertRoutes);
app.use("/api/chat",           chatRoutes);
app.use("/api/social",         socialRoutes);
app.use("/api/dm",             dmRoutes);
app.use("/api/steam",          steamRoutes);
app.use("/api/auctions",             auctionRoutes);
app.use("/api/auction-alerts",      auctionAlertRoutes);
app.use("/api/trades",              tradeRoutes);
app.use("/api/trade-notifications", tradeNotificationRoutes);
app.use("/api/push",                pushRoutes);
app.use("/api/notifications/metrics", notificationMetricsRoutes);

console.log("✅ Routes registered:", [
  "/api/auth", "/api/watch", "/api/settings", "/api/empire",
  "/api/user-filters", "/api/items", "/api/alerts",
  "/api/chat", "/api/social", "/api/dm", "/api/steam",
  "/api/auctions", "/api/auction-alerts",
]);

/* ======================
   404 + ERROR HANDLERS
====================== */
app.use("/api", (req, res) => {
  console.warn("⚠️ API 404:", req.method, req.originalUrl);

  res.status(404).json({
    ok: false,
    error: "API route not found",
  });
});

app.use((err, _req, res, _next) => {
  console.error("❌ Server error:", err);

  res.status(500).json({
    ok: false,
    error: err?.message || "Server error",
  });
});

/* ======================
   STARTUP
====================== */
const PORT = Number(process.env.PORT || 5055);
const ALERTS_INTERVAL_MS = 15_000;

async function start() {
  // ── 1. ENV diagnostic ──────────────────────────────────────────────────────
  const envCheck = {
    NODE_ENV:              process.env.NODE_ENV              || "(not set)",
    PORT:                  process.env.PORT                  || "(not set — defaults to 5055)",
    CLIENT_ORIGIN:         process.env.CLIENT_ORIGIN         || "(not set)",
    CLIENT_URL_RESOLVED:   CLIENT_URL,
    MONGO_URI:             process.env.MONGO_URI             ? "✅ set" : (process.env.MONGO_URL ? "✅ set (MONGO_URL)" : "❌ MISSING"),
    JWT_SECRET:            process.env.JWT_SECRET            ? "✅ set" : "❌ MISSING",
    EMPIRE_API_KEY:        process.env.EMPIRE_API_KEY        ? "✅ set" : "❌ MISSING — Empire socket disabled",
    FIREBASE_PROJECT_ID:   process.env.FIREBASE_PROJECT_ID   ? "✅ set" : "❌ MISSING — push disabled",
    FIREBASE_CLIENT_EMAIL: process.env.FIREBASE_CLIENT_EMAIL ? "✅ set" : "❌ MISSING — push disabled",
    FIREBASE_PRIVATE_KEY:  process.env.FIREBASE_PRIVATE_KEY
      ? `✅ set (${process.env.FIREBASE_PRIVATE_KEY.length} chars, starts: ${process.env.FIREBASE_PRIVATE_KEY.slice(0, 27)}...)`
      : "❌ MISSING — push disabled",
  };
  console.log("🔧 ENV CHECK:", envCheck);

  // ── 2. Firebase Admin (non-blocking — never crashes startup) ───────────────
  console.log("⏳ [1/6] Initializing Firebase Admin...");
  try { initFirebaseAdmin(); } catch (e) { console.error("❌ Firebase Admin init threw:", e.message); }
  console.log("✅ [1/6] Firebase Admin init done");

  // ── 3. HTTP server listening — MUST happen before any awaited I/O ──────────
  // Render marks a deploy as failed if the bound PORT is not open within its
  // timeout. startEmpireMarketSocket() awaits an external HTTP call (15 s
  // timeout); if that call hangs the port would never open. Listen first.
  await new Promise((resolve, reject) => {
    console.log(`⏳ [2/6] Binding to PORT ${PORT}...`);
    server.listen(PORT, "0.0.0.0", () => {
      console.log(`✅ [2/6] Server listening on PORT ${PORT}`);
      console.log("🟣 BUILD-ID: server.js 2026-05-27");
      resolve();
    });
    server.on("error", (err) => {
      console.error(`❌ [2/6] server.listen error: ${err.message}`);
      reject(err);
    });
  });

  // ── 4. MongoDB ────────────────────────────────────────────────────────────
  console.log("⏳ [3/6] Connecting to MongoDB...");
  let conn;
  try {
    conn = await connectToMongoDB();
    console.log("✅ [3/6] MongoDB connected");
  } catch (err) {
    console.error("❌ [3/6] MongoDB connection failed — server will stay up but DB calls will fail:", err.message);
    // Don't exit: server is already listening; keeps Render deploy alive so
    // the error is visible in logs rather than "cause could not be determined".
  }

  // ── 4b. DB migrations (non-fatal) ────────────────────────────────────────
  if (conn) {
    // Drop non-sparse unique indexes on `users.email` so Steam users (no email) can be inserted.
    await (async () => {
      try {
        const db = conn.db;
        const cols = await db.listCollections({ name: "users" }).toArray();
        if (!cols.length) return;
        const indexes = await db.collection("users").indexes();
        const emailIdx = indexes.find(i => i.key?.email === 1 && !i.sparse);
        if (emailIdx) {
          await db.collection("users").dropIndex(emailIdx.name);
          console.log("✅ Dropped non-sparse 'email_1' index on users");
        }
      } catch (e) { console.warn("⚠️  Users email index migration:", e.message); }
    })();

    await (async () => {
      try {
        const db = conn.db;
        const cols = await db.listCollections({ name: "friendships" }).toArray();
        if (!cols.length) return;
        const indexes = await db.collection("friendships").indexes();
        if (indexes.some(i => i.name === "userId_1_friendId_1")) {
          await db.dropCollection("friendships");
          console.log("✅ Dropped stale 'friendships' collection");
        }
      } catch (e) { console.warn("⚠️  Friendship migration:", e.message); }
    })();

    try { await ensureSystemSettingsDefaults(); } catch (e) { console.warn("⚠️  ensureSystemSettingsDefaults:", e.message); }

    // Reliability dashboard — record this boot (fire-and-forget)
    recordEvent("SERVER_RESTART", {});
  }

  // ── 5. Socket.io ─────────────────────────────────────────────────────────
  console.log("⏳ [4/6] Initializing Socket.io...");
  try {
    const io = initSocket();
    if (io) { app.set("io", io); global.io = io; }
    console.log("✅ [4/6] Socket.io initialized");
  } catch (e) { console.error("❌ [4/6] Socket.io init failed:", e.message); }

  // ── 6. Empire market socket (non-blocking — external I/O, can be slow) ────
  console.log("⏳ [5/6] Starting Empire market socket (non-blocking)...");
  startEmpireMarketSocket()
    .then(() => console.log("✅ [5/6] Empire market socket connected"))
    .catch((err) => console.error("❌ [5/6] Empire market socket failed (non-fatal):", err.message));

  // ── 5b. Empire WS health watchdog ────────────────────────────────────────
  // Detects the "connected-but-dead" failure mode: socket.io says connected
  // but Empire stopped sending events (e.g. server-side session expired without
  // closing the WebSocket). Restarts the socket after 10 minutes of silence.
  // A 3-minute grace period after socket start prevents false triggers on boot.
  // Token-expiry reconnect failures are handled separately by the connect_error
  // handler inside empireMarketSocket.js.
  const EMPIRE_WATCHDOG_INTERVAL_MS = 60_000;       // check every 60 s
  const EMPIRE_SILENCE_THRESHOLD_MS = 10 * 60_000;  // 10 min without any WS event
  const EMPIRE_GRACE_PERIOD_MS      =  3 * 60_000;  // ignore first 3 min after socket start

  setInterval(async () => {
    try {
      const st = getEmpireMarketSocketStatus();

      // Let socket.io's own reconnection logic handle a disconnected socket.
      // The connect_error handler already upgrades to a hard restart after 3 failures.
      if (!st.connected) return;

      const socketAgeMs = st.socketStartedAt ? Date.now() - st.socketStartedAt : 0;
      if (socketAgeMs < EMPIRE_GRACE_PERIOD_MS) return;

      const silentMs = st.lastEventAt ? Date.now() - st.lastEventAt : socketAgeMs;
      if (silentMs < EMPIRE_SILENCE_THRESHOLD_MS) return;

      console.warn(
        `[Empire WS Watchdog] connected but silent for ${Math.round(silentMs / 1000)}s ` +
        `(threshold ${EMPIRE_SILENCE_THRESHOLD_MS / 1000}s) — restarting socket`
      );
      recordEvent("WS_WATCHDOG_RESTART", { meta: { silentMs } });
      stopEmpireMarketSocket();
      await new Promise((r) => setTimeout(r, 2_000));
      await startEmpireMarketSocket();
    } catch (err) {
      console.error("[Empire WS Watchdog] error:", err?.message || err);
    }
  }, EMPIRE_WATCHDOG_INTERVAL_MS);

  // ── 7. Background jobs ────────────────────────────────────────────────────
  console.log("⏳ [6/6] Starting background jobs...");

  try { startAlertEngine({ intervalMs: ALERTS_INTERVAL_MS }); } catch (e) { console.error("❌ startAlertEngine:", e.message); }
  try { startMarketWorker(1000 * 60 * 1); } catch (e) { console.error("❌ startMarketWorker:", e.message); }
  try { startAuctionWorker(1000 * 60 * 5); } catch (e) { console.error("❌ startAuctionWorker:", e.message); }
  try { startSkinMetricsAggregator(); } catch (e) { console.error("❌ startSkinMetricsAggregator:", e.message); }

  // Precise auction-expiry sweep: marks AlertLog docs expired when auctionEndsAt
  // passes and notifies connected clients via alert_expired socket event.
  // Runs every 30 s so the UI clears within half a minute of auction end.
  const AUCTION_SWEEP_MS = 30_000;
  sweepExpiredAuctionAlerts().catch((e) => console.error("⚠️ sweepExpiredAuctionAlerts (startup):", e.message));
  setInterval(
    () => sweepExpiredAuctionAlerts().catch((e) => console.error("⚠️ sweepExpiredAuctionAlerts:", e.message)),
    AUCTION_SWEEP_MS
  );
  warmHomePremiumCache().catch(e => console.warn("[home-premium] startup warm failed:", e.message));

  const AUCTION_TTL_MIN     = Number(process.env.AUCTION_ALERT_TTL_MIN    || 45);
  const WATCHLIST_TTL_HOURS = Number(process.env.WATCHLIST_ALERT_TTL_HOURS || 24);

  async function expireStaleAlerts() {
    try {
      const now = new Date();
      const auctionCutoff   = new Date(now - AUCTION_TTL_MIN    * 60_000);
      const watchlistCutoff = new Date(now - WATCHLIST_TTL_HOURS * 3_600_000);
      const deleteCutoff    = new Date(now - 24 * 3_600_000);

      const ra = await AlertLog.updateMany(
        { source: "auction-alert", status: "live", triggeredAt: { $lt: auctionCutoff } },
        { $set: { status: "expired", expiredAt: now } }
      );
      const rw = await AlertLog.updateMany(
        { source: { $ne: "auction-alert" }, status: "live", triggeredAt: { $lt: watchlistCutoff } },
        { $set: { status: "expired", expiredAt: now } }
      );
      const rd = await AlertLog.deleteMany({
        status: { $in: ["expired", "deleted"] },
        expiredAt: { $lt: deleteCutoff },
      });

      const total = ra.modifiedCount + rw.modifiedCount;
      if (total > 0 || rd.deletedCount > 0) {
        console.log(`⏳ Alert cleanup: expired=${total} | hard-deleted=${rd.deletedCount}`);
      }
    } catch (err) { console.error("⚠️ expireStaleAlerts:", err?.message); }
  }

  expireStaleAlerts();
  setInterval(expireStaleAlerts, 10 * 60 * 1000);

  // Bandwidth-by-endpoint summary — see server/middelware/bandwidthMetrics.js.
  // Prints the top 10 routes by bytes sent every 15 minutes so usage is
  // visible directly in Render logs without hitting the metrics endpoint.
  setInterval(() => logBandwidthSummary(10), 15 * 60 * 1000);

  console.log(`✅ [6/6] Jobs started (alerts every ${ALERTS_INTERVAL_MS}ms | auction TTL ${AUCTION_TTL_MIN}min | watchlist TTL ${WATCHLIST_TTL_HOURS}h)`);
  console.log("🚀 Startup complete");
}

start().catch((err) => {
  console.error("❌ Fatal startup error:", err.message);
  console.error(err.stack);
  process.exit(1);
});
