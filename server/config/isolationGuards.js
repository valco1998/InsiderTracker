// server/config/isolationGuards.js
//
// Fail-closed checks that keep Insider Tracker isolated from SkinTel.
// Nothing here writes anything. The marker document is written by the caller
// ONLY after verifyMongoIdentity() returns { ok: true, needsMarker: true }.

const SKINTEL_RE = /skintel|skin-tel/i;

export const IDENTITY_COLLECTION = "insidertracker_meta";
export const IDENTITY_DOC = { _id: "identity", app: "insider-tracker" };

// Collections Insider Tracker itself creates.
export const OWN_COLLECTIONS = new Set([
  "users", "devicetokens", "alertlogs", "notificationevents",
  "insiderwatches", "insideralertclaims", IDENTITY_COLLECTION,
]);

// Collections that exist only in SkinTel — their presence proves the wrong database.
export const SKINTEL_ONLY_COLLECTIONS = new Set([
  "tradeposts", "tradecomments", "tradematchnotifications", "chatmessages", "dmconversations",
  "privategroups", "marketsnapshotitems", "auctionalertrules", "watchrules", "alertstates",
  "importedinventories", "manualinventories", "inventorycaches", "pricesnapshots", "soldhistories",
  "skinmetrics", "friendships", "blocks", "userfilters", "systemsettings",
]);

const RESERVED_DBS = new Set(["admin", "local", "config", "test"]);

// → { ok, dbName?, reason? }  — the database name must be explicit in MONGO_URI.
export function checkMongoUri(uri) {
  const raw = String(uri || "").trim();
  if (!raw) return { ok: false, configured: false, reason: "MONGO_URI is not set" };
  const m = raw.match(/^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]*)/);
  const dbName = m ? decodeURIComponent(m[1]) : "";
  if (!dbName) return { ok: false, configured: true, reason: "MONGO_URI must name a database explicitly (e.g. …/insider_tracker)" };
  if (!/^[A-Za-z0-9_-]{1,38}$/.test(dbName)) return { ok: false, configured: true, reason: "MONGO_URI database name has invalid characters" };
  if (RESERVED_DBS.has(dbName.toLowerCase())) return { ok: false, configured: true, reason: `database "${dbName}" is reserved` };
  if (SKINTEL_RE.test(dbName)) return { ok: false, configured: true, reason: "database name references SkinTel" };
  if (SKINTEL_RE.test(raw)) return { ok: false, configured: true, reason: "MONGO_URI references SkinTel" };
  return { ok: true, configured: true, dbName };
}

// db: a connected native Db (mongoose.connection.db). Read-only.
// → { ok, needsMarker?, reason? }
export async function verifyMongoIdentity(db, { expectedDbName, allowInit = false } = {}) {
  if (!db) return { ok: false, reason: "no database connection" };
  if (expectedDbName && db.databaseName !== expectedDbName) {
    return { ok: false, reason: `connected database "${db.databaseName}" does not match MONGO_URI` };
  }
  const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name);

  const skintel = names.filter((n) => SKINTEL_ONLY_COLLECTIONS.has(n));
  if (skintel.length) return { ok: false, reason: `database contains SkinTel collections (${skintel.slice(0, 5).join(", ")}) — refusing to use it` };

  if (names.includes(IDENTITY_COLLECTION)) {
    const marker = await db.collection(IDENTITY_COLLECTION).findOne({ _id: IDENTITY_DOC._id });
    if (marker?.app === IDENTITY_DOC.app) return { ok: true, needsMarker: false };
    return { ok: false, reason: "identity marker present but does not belong to insider-tracker" };
  }

  const unknown = names.filter((n) => !OWN_COLLECTIONS.has(n));
  if (unknown.length) return { ok: false, reason: `database has unrecognized collections (${unknown.slice(0, 5).join(", ")}) and no Insider Tracker marker` };

  for (const n of names) {
    if ((await db.collection(n).estimatedDocumentCount()) > 0) {
      return { ok: false, reason: `database already has data in "${n}" but no Insider Tracker marker` };
    }
  }

  // Empty database with an explicit, non-SkinTel name.
  if (!allowInit) return { ok: false, reason: "empty database — set INSIDER_DB_ALLOW_INIT=true once to initialize it for Insider Tracker" };
  return { ok: true, needsMarker: true };
}

// → { ok, configured, reason? }  — all three values required, never SkinTel's project.
export function checkFirebaseConfig(env = process.env) {
  const projectId = (env.FIREBASE_PROJECT_ID || "").trim();
  const clientEmail = (env.FIREBASE_CLIENT_EMAIL || "").trim();
  const privateKey = (env.FIREBASE_PRIVATE_KEY || "").trim();
  const present = [projectId, clientEmail, privateKey].filter(Boolean).length;
  if (present === 0) return { ok: false, configured: false, reason: "Firebase Admin is not configured" };
  if (present < 3) return { ok: false, configured: true, reason: "Firebase Admin config is incomplete" };
  if (SKINTEL_RE.test(projectId) || SKINTEL_RE.test(clientEmail)) return { ok: false, configured: true, reason: "Firebase project references SkinTel" };
  if (!clientEmail.toLowerCase().endsWith(`@${projectId.toLowerCase()}.iam.gserviceaccount.com`)) {
    return { ok: false, configured: true, reason: "FIREBASE_CLIENT_EMAIL does not belong to FIREBASE_PROJECT_ID" };
  }
  return { ok: true, configured: true };
}

export function checkJwtSecret(env = process.env) {
  const s = env.JWT_SECRET || "";
  if (!s) return { ok: false, configured: false, reason: "JWT_SECRET is not set" };
  if (s.length < 32) return { ok: false, configured: true, reason: "JWT_SECRET must be at least 32 characters" };
  return { ok: true, configured: true };
}

const truthy = (v) => /^(1|true|yes)$/i.test(String(v || "").trim());
const falsy = (v) => /^(0|false|no)$/i.test(String(v || "").trim());

// Alerts are OFF and DRY-RUN unless explicitly configured otherwise.
export function readAlertFlags(env = process.env) {
  return {
    enabled: truthy(env.INSIDER_ALERTS_ENABLED),
    dryRun: !falsy(env.INSIDER_ALERTS_DRY_RUN),
    settleMs: Math.max(Number(env.ALERT_SETTLE_MS) || 120_000, 0),
    maxAgeMs: Math.max(Number(env.ALERT_MAX_AGE_HOURS) || 24, 1) * 3600_000,
  };
}
