// server/services/insiderDb.js
//
// MongoDB for Insider Tracker accounts, follows and alerts — fail closed.
//   1. MONGO_URI must name a non-SkinTel database (checkMongoUri).
//   2. Mongoose auto-index / auto-create are OFF, so connecting writes nothing.
//   3. verifyMongoIdentity() inspects the database read-only.
//   4. Only then: identity marker (empty DB + INSIDER_DB_ALLOW_INIT=true) and indexes.
// Until all steps pass, account features return 503 and the alert engine is off.
import mongoose from "mongoose";
import {
  checkMongoUri, verifyMongoIdentity, checkJwtSecret,
  IDENTITY_COLLECTION, IDENTITY_DOC, OWN_COLLECTIONS,
} from "../config/isolationGuards.js";
import { logEvent, logWarn } from "../utils/safeLog.js";

const PING_INTERVAL_MS = 30_000;

// Set at import time (insider-mvp.js imports this module first) so no model
// compiled later can auto-create collections or indexes on connect.
mongoose.set("autoIndex", false);
mongoose.set("autoCreate", false);

const freshState = () => ({
  configured: false, connected: false, verified: false, dbName: null, reason: "not started", verifiedAt: null,
  // Live connectivity (after verification): driver events + periodic ping.
  lastPingAt: null, lastPingMs: null, pingFailures: 0, lastError: null,
  disconnectedSince: null, disconnects: 0, reconnects: 0, indexIssues: [],
});
const state = freshState();

export function getDbState() {
  return { ...state, indexIssues: [...state.indexIssues] };
}

export function isAccountsReady() {
  return state.verified && state.connected && checkJwtSecret().ok;
}

// Express middleware: account routes are unavailable until isolation is verified,
// and fail fast (instead of hanging on Mongoose's command buffer) while disconnected.
export function requireAccounts(_req, res, next) {
  if (isAccountsReady()) return next();
  if (state.verified && checkJwtSecret().ok && !state.connected) {
    res.set("Retry-After", "15");
    return res.status(503).json({ ok: false, error: "Account features are temporarily unavailable" });
  }
  return res.status(503).json({ ok: false, error: "Account features are not configured" });
}

function markDown(st, cause) {
  if (!st.connected) return;
  st.connected = false;
  st.disconnectedSince = new Date().toISOString();
  st.disconnects++;
  logWarn("INSIDER_DB_DISCONNECTED", { db: st.dbName, cause });
}
function markUp(st, cause) {
  if (st.connected || !st.verified) return;
  const downMs = st.disconnectedSince ? Date.now() - Date.parse(st.disconnectedSince) : null;
  st.connected = true;
  st.disconnectedSince = null;
  st.reconnects++;
  logEvent("INSIDER_DB_RECONNECTED", { db: st.dbName, cause, downMs });
}

// Driver connection events → live state. `conn` is an EventEmitter (mongoose.connection).
export function attachConnectionMonitor(conn, st = state) {
  conn.on("disconnected", () => markDown(st, "driver_disconnected"));
  conn.on("reconnected", () => markUp(st, "driver_reconnected"));
  conn.on("connected", () => markUp(st, "driver_connected"));
  conn.on("error", (err) => { st.lastError = err?.name || "Error"; logWarn("INSIDER_DB_ERROR", { db: st.dbName, err }); });
}

// Periodic ping with a hard timeout; `failAfter` consecutive failures mark the DB down.
export function createDbPinger({ ping, st = state, timeoutMs = 3000, failAfter = 2 } = {}) {
  return async function tick() {
    const t0 = Date.now();
    let timer;
    try {
      await Promise.race([ping(), new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error("ping timeout"), { name: "PingTimeout" })), timeoutMs); })]);
      st.lastPingAt = new Date().toISOString();
      st.lastPingMs = Date.now() - t0;
      st.pingFailures = 0;
      markUp(st, "ping_ok");
      return true;
    } catch (err) {
      st.pingFailures++;
      st.lastError = err?.name || "Error";
      if (st.pingFailures >= failAfter) markDown(st, `ping_failed:${st.lastError}`);
      return false;
    } finally {
      clearTimeout(timer);
    }
  };
}

// Test hook: reset module state.
export function _resetDbStateForTests() { Object.assign(state, freshState()); return state; }

export async function connectInsiderDb({ uri = process.env.MONGO_URI, allowInit = /^(1|true|yes)$/i.test(process.env.INSIDER_DB_ALLOW_INIT || "") } = {}) {
  const uriCheck = checkMongoUri(uri);
  state.configured = uriCheck.configured !== false;
  if (!uriCheck.ok) {
    state.reason = uriCheck.reason;
    console.warn(`[INSIDER_DB] disabled — ${uriCheck.reason}`);
    return getDbState();
  }
  state.dbName = uriCheck.dbName;

  // Never create collections or indexes before the database identity is verified.
  mongoose.set("autoIndex", false);
  mongoose.set("autoCreate", false);
  mongoose.set("strictQuery", true);

  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 15_000, autoIndex: false, autoCreate: false });
    state.connected = true;
  } catch (err) {
    state.reason = "connection failed";
    console.error(`[INSIDER_DB] connection failed (details withheld): ${err.name}`);
    return getDbState();
  }

  const db = mongoose.connection.db;
  let identity;
  try {
    identity = await verifyMongoIdentity(db, { expectedDbName: uriCheck.dbName, allowInit });
  } catch (err) {
    identity = { ok: false, reason: `identity check failed: ${err.name}` };
  }
  if (!identity.ok) {
    state.reason = identity.reason;
    console.error(`[INSIDER_DB] REFUSING database "${uriCheck.dbName}": ${identity.reason}`);
    await mongoose.disconnect().catch(() => {});
    state.connected = false;
    return getDbState();
  }

  if (identity.needsMarker) {
    await db.collection(IDENTITY_COLLECTION).insertOne({ ...IDENTITY_DOC, createdAt: new Date() });
    console.log(`[INSIDER_DB] initialized empty database "${uriCheck.dbName}" for insider-tracker`);
  }

  // Indexes for Insider Tracker's own models only. Never drops or alters an
  // existing index — a conflicting definition is reported (health + log) instead.
  state.indexIssues = [];
  for (const model of Object.values(mongoose.models)) {
    if (!OWN_COLLECTIONS.has(model.collection.collectionName)) continue;
    try {
      await model.createIndexes();
    } catch (err) {
      const issue = { collection: model.collection.collectionName, code: err?.codeName || err?.name || "Error" };
      state.indexIssues.push(issue);
      logWarn("INSIDER_DB_INDEX", { model: model.modelName, collection: issue.collection, code: issue.code, err });
    }
  }

  state.verified = true;
  state.verifiedAt = new Date().toISOString();
  state.reason = null;
  console.log(`[INSIDER_DB] verified database="${uriCheck.dbName}"`);

  // Live connectivity from here on (attached after verification so the refusal
  // path above never reports a "disconnect").
  attachConnectionMonitor(mongoose.connection);
  const tick = createDbPinger({ ping: () => mongoose.connection.db.admin().command({ ping: 1 }) });
  tick();
  setInterval(tick, PING_INTERVAL_MS).unref();
  return getDbState();
}
