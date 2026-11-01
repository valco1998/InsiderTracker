// server/insider-mvp.js
//
// Standalone MVP server for real SEC Form 4 insider data.
// Starts ONLY the EDGAR ingest + /api/insider routes — no MongoDB, Firebase,
// Socket.IO or legacy SkinTel jobs. Binds to localhost.
//
//   cd server && npm run insider:mvp
import "dotenv/config";
import express from "express";
import cors from "cors";
import { getAllowedOrigins } from "./config/clientUrls.js";
import { getUserAgent, EdgarConfigError } from "./services/edgar/edgarClient.js";
import { startInsiderIngest, stopInsiderIngest } from "./services/edgar/insiderIngest.js";
import insiderRoutes from "./routers/insiderRoutes.js";

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

const app = express();
app.disable("x-powered-by");
app.use(cors({ origin: getAllowedOrigins(isProd), credentials: true }));
app.use(express.json({ limit: "100kb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "insider-mvp" }));
app.use("/api/insider", insiderRoutes);
app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

// Generic error response — never leak internals to clients.
app.use((err, _req, res, _next) => {
  console.error(`[INSIDER_MVP] unhandled err=${err.message}`);
  res.status(500).json({ error: "Internal server error" });
});

const server = app.listen(PORT, HOST, () => {
  console.log(`[INSIDER_MVP] listening http://${HOST}:${PORT}  origins=${getAllowedOrigins(isProd).join(",")}`);
  startInsiderIngest().catch((err) => console.error(`[INSIDER_MVP] ingest start failed: ${err.message}`));
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    stopInsiderIngest();
    server.close(() => process.exit(0));
  });
}
