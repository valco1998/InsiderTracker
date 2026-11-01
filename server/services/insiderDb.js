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

// Set at import time (insider-mvp.js imports this module first) so no model
// compiled later can auto-create collections or indexes on connect.
mongoose.set("autoIndex", false);
mongoose.set("autoCreate", false);

const state = { configured: false, connected: false, verified: false, dbName: null, reason: "not started", verifiedAt: null };

export function getDbState() {
  return { ...state };
}

export function isAccountsReady() {
  return state.verified && checkJwtSecret().ok;
}

// Express middleware: account routes are unavailable until isolation is verified.
export function requireAccounts(_req, res, next) {
  if (isAccountsReady()) return next();
  return res.status(503).json({ ok: false, error: "Account features are not configured" });
}

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

  // Indexes for Insider Tracker's own models only.
  for (const model of Object.values(mongoose.models)) {
    if (!OWN_COLLECTIONS.has(model.collection.collectionName)) continue;
    try {
      await model.createIndexes();
    } catch (err) {
      console.warn(`[INSIDER_DB] index build failed model=${model.modelName} err=${err.message}`);
    }
  }

  state.verified = true;
  state.verifiedAt = new Date().toISOString();
  state.reason = null;
  console.log(`[INSIDER_DB] verified database="${uriCheck.dbName}"`);
  return getDbState();
}
