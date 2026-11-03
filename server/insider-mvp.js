// server/insider-mvp.js
//
// Insider Tracker server. Starts the public SEC EDGAR ingest + dashboard API and,
// ONLY when isolation is verified, account / follow / push / alert features.
// No legacy SkinTel modules (Empire, market, trade, chat) are loaded.
//
// Fail-closed startup:
//   • SEC_USER_AGENT missing → exit.
//   • MONGO_URI missing / unverified → accounts, follows, alerts disabled (503).
//   • Firebase config missing / not isolated → push disabled.
//   • INSIDER_ALERTS_ENABLED defaults to false, INSIDER_ALERTS_DRY_RUN to true.
//
//   cd server && npm run insider:mvp
import "dotenv/config";
import { connectInsiderDb, getDbState, requireAccounts } from "./services/insiderDb.js"; // first: disables mongoose auto-create
import crypto from "node:crypto";
import express from "express";
import cors from "cors";
import compression from "compression";
import { getAllowedOrigins } from "./config/clientUrls.js";
import { checkFirebaseConfig, checkJwtSecret, readAlertFlags } from "./config/isolationGuards.js";
import { getUserAgent, EdgarConfigError } from "./services/edgar/edgarClient.js";
import { startInsiderIngest, stopInsiderIngest, flushInsiderIngest, getIngestStatus } from "./services/edgar/insiderIngest.js";
import { getSnapshotStats, snapshotStream } from "./services/edgar/insiderData.js";
import { compressionFilter } from "./services/edgar/insiderStream.js";
import { computeHealth } from "./services/healthReport.js";
import { logError } from "./utils/safeLog.js";
import { initFirebaseAdmin, isFcmReady } from "./services/fcm.js";
import { initInsiderSocket } from "./socket/insiderSocket.js";
import { rateLimit } from "./middelware/rateLimit.js";
import insiderRoutes from "./routers/insiderRoutes.js";
import authRoutes from "./routers/authRoutes.js";
import pushRoutes from "./routers/pushRoutes.js";
import insiderWatchRoutes from "./routers/insiderWatchRoutes.js";
import insiderAlertRoutes from "./routers/insiderAlertRoutes.js";
import backtestStrategyRoutes from "./routers/backtestStrategyRoutes.js";
import protectRoute from "./middelware/protectRoute.js";
import { startInsiderAlerts, getAlertEngineStats } from "./services/insiderAlertRuntime.js";

try {
  getUserAgent();
} catch (err) {
  if (err instanceof EdgarConfigError) {
    console.error(`[INSIDER_MVP] ${err.message}`);
    process.exit(1);
  }
  throw err;
}

const isProd = process.env.NODE_ENV === "production";
const PORT = Number(process.env.PORT) || 5055;
const HOST = process.env.HOST || "127.0.0.1";
const origins = getAllowedOrigins(isProd);

const firebase = checkFirebaseConfig();
const jwtCheck = checkJwtSecret();
const alertFlags = readAlertFlags();

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", false);
app.use(cors({ origin: origins, credentials: true, exposedHeaders: ["X-Request-Id"] }));

// Request id for log correlation (echoed in X-Request-Id and in 500 bodies).
const REQUEST_ID_RE = /^[A-Za-z0-9-]{8,64}$/;
app.use((req, res, next) => {
  const incoming = req.get("x-request-id");
  req.id = incoming && REQUEST_ID_RE.test(incoming) ? incoming : crypto.randomUUID();
  res.set("X-Request-Id", req.id);
  next();
});
app.use(express.json({ limit: "100kb" }));
// gzip JSON responses (Phase D3). Server-Sent Events are excluded (see
// compressionFilter): compression would buffer the stream and delay notifications.
app.use(compression({ filter: compressionFilter }));

function healthReport() {
  const db = getDbState();
  return computeHealth({
    db, ingest: getIngestStatus(), snapshot: getSnapshotStats(),
    accountsConfigured: db.configured && jwtCheck.ok,
  });
}

// Backward compatible: the client reads ok / accounts / push; always HTTP 200.
app.get("/api/health", (_req, res) => {
  const db = getDbState();
  const h = healthReport();
  res.json({
    ok: true,
    service: "insider-mvp",
    accounts: db.verified && jwtCheck.ok,
    push: isFcmReady(),
    alerts: { enabled: alertFlags.enabled, dryRun: alertFlags.dryRun, engine: getAlertEngineStats() },
    status: h.status,
    ready: h.ready,
    reasons: h.reasons,
    checks: h.checks,
    checkedAt: new Date().toISOString(),
  });
});
// For monitors / load balancers.
app.get("/api/health/live", (_req, res) => res.json({ ok: true }));
app.get("/api/health/ready", (_req, res) => {
  const h = healthReport();
  res.status(h.ready ? 200 : 503).json({ ready: h.ready, status: h.status, reasons: h.reasons });
});

// Public SEC data.
app.use("/api/insider", insiderRoutes);

// Account features — 503 until MongoDB isolation + JWT secret are verified.
app.use("/api/auth/login", rateLimit({ windowMs: 60_000, max: 10, key: "auth.login" }));
app.use("/api/auth/session", rateLimit({ windowMs: 60_000, max: 30, key: "auth.session" }));
app.use("/api/auth/signup", rateLimit({ windowMs: 60 * 60_000, max: 5, key: "auth.signup" }));
app.use("/api/auth", requireAccounts, authRoutes);
app.use("/api/push", requireAccounts, pushRoutes);
app.use("/api/insider/watches", requireAccounts, protectRoute, insiderWatchRoutes);
app.use("/api/insider/alerts", requireAccounts, protectRoute, insiderAlertRoutes);
// Saved Backtesting strategies (account feature; running a backtest stays public).
app.use("/api/insider/strategies", requireAccounts, protectRoute, backtestStrategyRoutes);

app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

// Generic error response — never leak internals to clients.
app.use((err, req, res, _next) => {
  // Body-parser errors are client errors, not server faults.
  if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON body" });
  if (err?.type === "entity.too.large") return res.status(413).json({ error: "Request body too large" });
  logError("INSIDER_UNHANDLED", { requestId: req.id, method: req.method, path: req.path, err });
  res.status(500).json({ error: "Internal server error", requestId: req.id });
});

function logConfig() {
  const db = getDbState();
  console.log(
    `[INSIDER_CONFIG] accounts=${db.verified && jwtCheck.ok ? "on" : `off (${db.reason || jwtCheck.reason})`} ` +
    `push=${isFcmReady() ? "on" : `off (${firebase.reason || "init failed"})`} ` +
    `alerts=${alertFlags.enabled ? "enabled" : "disabled"} dryRun=${alertFlags.dryRun}`
  );
}

const server = app.listen(PORT, HOST, async () => {
  console.log(`[INSIDER_MVP] listening http://${HOST}:${PORT}  origins=${origins.join(",")}`);

  if (jwtCheck.ok) initInsiderSocket(server, { origins });
  else console.warn(`[INSIDER_SOCKET] disabled — ${jwtCheck.reason}`);

  if (firebase.ok) initFirebaseAdmin();
  else console.warn(`[INSIDER_PUSH] disabled — ${firebase.reason}`);

  await connectInsiderDb();
  logConfig();

  startInsiderAlerts({ flags: alertFlags, firebaseIsolated: firebase.ok });

  startInsiderIngest().catch((err) => console.error(`[INSIDER_MVP] ingest start failed: ${err.message}`));
});

let shuttingDown = false;
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    stopInsiderIngest();
    snapshotStream.close(); // open SSE connections would otherwise keep server.close() waiting
    // Persist pending SEC cache changes (bounded wait) before exiting.
    await Promise.race([
      flushInsiderIngest().catch((err) => console.warn(`[INSIDER_CACHE] flush on shutdown failed: ${err.message}`)),
      new Promise((r) => setTimeout(r, 5000).unref()),
    ]);
    server.close(() => process.exit(0));
  });
}
