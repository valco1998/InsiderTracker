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
import express from "express";
import cors from "cors";
import { getAllowedOrigins } from "./config/clientUrls.js";
import { checkFirebaseConfig, checkJwtSecret, readAlertFlags } from "./config/isolationGuards.js";
import { getUserAgent, EdgarConfigError } from "./services/edgar/edgarClient.js";
import { startInsiderIngest, stopInsiderIngest } from "./services/edgar/insiderIngest.js";
import { initFirebaseAdmin, isFcmReady } from "./services/fcm.js";
import { initInsiderSocket } from "./socket/insiderSocket.js";
import { rateLimit } from "./middelware/rateLimit.js";
import insiderRoutes from "./routers/insiderRoutes.js";
import authRoutes from "./routers/authRoutes.js";
import pushRoutes from "./routers/pushRoutes.js";
import insiderWatchRoutes from "./routers/insiderWatchRoutes.js";
import insiderAlertRoutes from "./routers/insiderAlertRoutes.js";
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
app.use(cors({ origin: origins, credentials: true }));
app.use(express.json({ limit: "100kb" }));

app.get("/api/health", (_req, res) => {
  const db = getDbState();
  res.json({
    ok: true,
    service: "insider-mvp",
    accounts: db.verified && jwtCheck.ok,
    push: isFcmReady(),
    alerts: { enabled: alertFlags.enabled, dryRun: alertFlags.dryRun, engine: getAlertEngineStats() },
  });
});

// Public SEC data.
app.use("/api/insider", insiderRoutes);

// Account features — 503 until MongoDB isolation + JWT secret are verified.
app.use("/api/auth/login", rateLimit({ windowMs: 60_000, max: 10, key: "auth.login" }));
app.use("/api/auth/signup", rateLimit({ windowMs: 60 * 60_000, max: 5, key: "auth.signup" }));
app.use("/api/auth", requireAccounts, authRoutes);
app.use("/api/push", requireAccounts, pushRoutes);
app.use("/api/insider/watches", requireAccounts, protectRoute, insiderWatchRoutes);
app.use("/api/insider/alerts", requireAccounts, protectRoute, insiderAlertRoutes);

app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

// Generic error response — never leak internals to clients.
app.use((err, _req, res, _next) => {
  console.error(`[INSIDER_MVP] unhandled err=${err.message}`);
  res.status(500).json({ error: "Internal server error" });
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

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    stopInsiderIngest();
    server.close(() => process.exit(0));
  });
}
