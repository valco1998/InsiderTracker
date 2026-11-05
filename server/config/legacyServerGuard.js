// server/config/legacyServerGuard.js
//
// server.js is the LEGACY SkinTel entry point, kept in this repository for reference. On
// 2026-11-03 it was started against the InsiderTracker database and created 19 SkinTel
// collections there (its MongoDB connection has no isolation guard and auto-creates
// collections and indexes). This module is imported FIRST by server.js — ES modules evaluate
// imports in order, so the process exits before any database, socket or job module loads.
//
// It refuses to start unless explicitly allowed (ALLOW_LEGACY_SKINTEL_SERVER=1), and NEVER
// against a database whose name contains "insider", whatever the flag says.
// InsiderTracker itself starts with `npm start` (insider-mvp.js).
//
// The same guard is the FIRST import of every other legacy SkinTel MongoDB entry point
// (db/connectToMongooseDB.js, test-mongo.js and the legacy scripts/ diagnostics), so none of
// them can connect to — and auto-create SkinTel collections in — the InsiderTracker database.
// config/legacyDbEntryPoints.test.js fails if a new MongoDB connection appears without it.
import dotenv from "dotenv";

dotenv.config({ quiet: true });

export function legacyServerBlockReason(env = process.env) {
  const m = /^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]*)/.exec(String(env.MONGO_URI || env.MONGO_URL || "").trim());
  let db = "";
  try { db = decodeURIComponent(m?.[1] || ""); } catch { db = m?.[1] || ""; }
  if (/insider/i.test(db)) return `MONGO_URI points at an InsiderTracker database ("${db}")`;
  if (env.ALLOW_LEGACY_SKINTEL_SERVER !== "1") return "ALLOW_LEGACY_SKINTEL_SERVER is not set to 1";
  return null;
}

const reason = legacyServerBlockReason();
if (reason) {
  const entry = String(process.argv[1] || "server.js").split(/[\\/]/).slice(-2).join("/");
  console.error(`[LEGACY_SERVER_BLOCKED] ${entry} is legacy SkinTel code and must not run in InsiderTracker: ${reason}. Start InsiderTracker with "npm start" (insider-mvp.js).`);
  process.exit(1);
}
