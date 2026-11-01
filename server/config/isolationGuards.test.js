// Phase 1 — isolation and fail-closed infrastructure tests. No network, no DB.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import jwt from "jsonwebtoken";
import express from "express";
import {
  checkMongoUri, verifyMongoIdentity, checkFirebaseConfig, checkJwtSecret, readAlertFlags,
  IDENTITY_COLLECTION,
} from "./isolationGuards.js";
import { verifySocketToken } from "../socket/insiderSocket.js";
import { rateLimit } from "../middelware/rateLimit.js";
import { requireAccounts, getDbState } from "../services/insiderDb.js";

// Fake native Db: read-only methods only; any write throws.
function fakeDb({ name = "insider_tracker", collections = {}, marker = null } = {}) {
  const writes = [];
  return {
    writes,
    databaseName: name,
    listCollections: () => ({ toArray: async () => Object.keys(collections).map((n) => ({ name: n })) }),
    collection: (n) => ({
      estimatedDocumentCount: async () => collections[n] ?? 0,
      findOne: async () => (n === IDENTITY_COLLECTION ? marker : null),
      insertOne: async () => { writes.push(n); throw new Error("write attempted"); },
    }),
  };
}

// ── MONGO_URI ────────────────────────────────────────────────────────────────
test("MONGO_URI: must be set and name a non-SkinTel, non-reserved database", () => {
  assert.equal(checkMongoUri("").ok, false);
  assert.equal(checkMongoUri("").configured, false);
  assert.match(checkMongoUri("mongodb+srv://u:p@cluster0.example.net/?retryWrites=true").reason, /name a database/);
  assert.match(checkMongoUri("mongodb+srv://u:p@cluster0.example.net/skintel?x=1").reason, /SkinTel/);
  assert.match(checkMongoUri("mongodb+srv://u:p@SkinTel-cluster.example.net/insider").reason, /SkinTel/);
  assert.match(checkMongoUri("mongodb://localhost:27017/admin").reason, /reserved/);
  assert.deepEqual(checkMongoUri("mongodb+srv://u:p@cluster0.example.net/insider_tracker?retryWrites=true"),
    { ok: true, configured: true, dbName: "insider_tracker" });
});

// ── Database identity (read-only) ────────────────────────────────────────────
test("identity: a database with SkinTel collections is refused (even if empty) and never written", async () => {
  const db = fakeDb({ collections: { users: 10, tradeposts: 0, chatmessages: 5 } });
  const r = await verifyMongoIdentity(db, { expectedDbName: "insider_tracker", allowInit: true });
  assert.equal(r.ok, false);
  assert.match(r.reason, /SkinTel collections/);
  assert.deepEqual(db.writes, []);
});

test("identity: connected database name must match MONGO_URI", async () => {
  const r = await verifyMongoIdentity(fakeDb({ name: "other" }), { expectedDbName: "insider_tracker" });
  assert.match(r.reason, /does not match/);
});

test("identity: non-empty database without the marker is refused", async () => {
  const r = await verifyMongoIdentity(fakeDb({ collections: { users: 3, devicetokens: 1 } }), { expectedDbName: "insider_tracker", allowInit: true });
  assert.equal(r.ok, false);
  assert.match(r.reason, /already has data/);
});

test("identity: unrecognized collections are refused", async () => {
  const r = await verifyMongoIdentity(fakeDb({ collections: { orders: 0 } }), { expectedDbName: "insider_tracker", allowInit: true });
  assert.match(r.reason, /unrecognized collections/);
});

test("identity: a foreign marker is refused", async () => {
  const r = await verifyMongoIdentity(fakeDb({ collections: { [IDENTITY_COLLECTION]: 1 }, marker: { _id: "identity", app: "something-else" } }), { expectedDbName: "insider_tracker" });
  assert.match(r.reason, /does not belong/);
});

test("identity: empty database needs explicit INSIDER_DB_ALLOW_INIT before a marker may be written", async () => {
  const empty = fakeDb();
  const denied = await verifyMongoIdentity(empty, { expectedDbName: "insider_tracker", allowInit: false });
  assert.equal(denied.ok, false);
  assert.match(denied.reason, /INSIDER_DB_ALLOW_INIT/);
  const allowed = await verifyMongoIdentity(empty, { expectedDbName: "insider_tracker", allowInit: true });
  assert.deepEqual(allowed, { ok: true, needsMarker: true });
  assert.deepEqual(empty.writes, [], "verification itself never writes");
});

test("identity: our own marker → verified without re-initializing", async () => {
  const r = await verifyMongoIdentity(fakeDb({ collections: { [IDENTITY_COLLECTION]: 1, users: 4 }, marker: { _id: "identity", app: "insider-tracker" } }), { expectedDbName: "insider_tracker" });
  assert.deepEqual(r, { ok: true, needsMarker: false });
});

// ── Firebase / JWT / flags ───────────────────────────────────────────────────
test("Firebase: missing, partial, SkinTel or mismatched config is rejected", () => {
  const key = "-----BEGIN PRIVATE KEY-----\\nX\\n-----END PRIVATE KEY-----";
  assert.equal(checkFirebaseConfig({}).configured, false);
  assert.match(checkFirebaseConfig({ FIREBASE_PROJECT_ID: "insider-tracker-1" }).reason, /incomplete/);
  assert.match(checkFirebaseConfig({ FIREBASE_PROJECT_ID: "skintel-3fbc1", FIREBASE_CLIENT_EMAIL: "a@skintel-3fbc1.iam.gserviceaccount.com", FIREBASE_PRIVATE_KEY: key }).reason, /SkinTel/);
  assert.match(checkFirebaseConfig({ FIREBASE_PROJECT_ID: "insider-tracker-1", FIREBASE_CLIENT_EMAIL: "a@other.iam.gserviceaccount.com", FIREBASE_PRIVATE_KEY: key }).reason, /does not belong/);
  assert.deepEqual(checkFirebaseConfig({ FIREBASE_PROJECT_ID: "insider-tracker-1", FIREBASE_CLIENT_EMAIL: "firebase-adminsdk-x@insider-tracker-1.iam.gserviceaccount.com", FIREBASE_PRIVATE_KEY: key }), { ok: true, configured: true });
});

test("JWT secret must be set and ≥ 32 chars", () => {
  assert.equal(checkJwtSecret({}).ok, false);
  assert.equal(checkJwtSecret({ JWT_SECRET: "short" }).ok, false);
  assert.equal(checkJwtSecret({ JWT_SECRET: "x".repeat(32) }).ok, true);
});

test("alert flags default to disabled + dry-run", () => {
  const f = readAlertFlags({});
  assert.equal(f.enabled, false);
  assert.equal(f.dryRun, true);
  assert.equal(readAlertFlags({ INSIDER_ALERTS_ENABLED: "true", INSIDER_ALERTS_DRY_RUN: "false" }).dryRun, false);
  assert.equal(readAlertFlags({ INSIDER_ALERTS_DRY_RUN: "maybe" }).dryRun, true, "anything but an explicit false stays dry-run");
});

// ── Socket auth ──────────────────────────────────────────────────────────────
test("socket: only a valid HS256 JWT with an ObjectId subject is accepted", () => {
  const secret = "s".repeat(40);
  const id = "6ae7543c5036c880bb1df51b";
  assert.equal(verifySocketToken(jwt.sign({ sub: id }, secret), secret), id);
  assert.equal(verifySocketToken(jwt.sign({ sub: id }, "wrong".repeat(10)), secret), null);
  assert.equal(verifySocketToken(jwt.sign({ sub: "not-an-id" }, secret), secret), null);
  assert.equal(verifySocketToken(jwt.sign({ sub: id }, secret, { algorithm: "HS512" }), secret), null);
  assert.equal(verifySocketToken(undefined, secret), null);
});

// ── HTTP gates ───────────────────────────────────────────────────────────────
async function withApp(mount, fn) {
  const app = express();
  app.use(express.json());
  mount(app);
  const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  try { await fn(`http://127.0.0.1:${server.address().port}`); } finally { await new Promise((r) => server.close(r)); }
}

test("account routes return 503 while the database is not verified", async () => {
  assert.equal(getDbState().verified, false);
  await withApp((app) => app.use("/api/auth", requireAccounts, (_q, s) => s.json({ reached: true })), async (base) => {
    const r = await fetch(`${base}/api/auth/me`);
    assert.equal(r.status, 503);
    assert.deepEqual(await r.json(), { ok: false, error: "Account features are not configured" });
  });
});

test("rate limiter returns 429 after the limit", async () => {
  await withApp((app) => app.use("/x", rateLimit({ windowMs: 60_000, max: 3, key: "t" }), (_q, s) => s.json({ ok: true })), async (base) => {
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await fetch(`${base}/x`)).status);
    assert.deepEqual(codes, [200, 200, 200, 429, 429]);
  });
});

test("auth login 500 never leaks internal error details", async () => {
  const { default: User } = await import("../models/User.model.js");
  const { login } = await import("../controllers/auth.controllers.js");
  const orig = User.findOne;
  User.findOne = async () => { throw new Error("MongoServerError: secret-host.example:27017 auth failed"); };
  const errs = console.error; console.error = () => {};
  try {
    await withApp((app) => app.post("/login", login), async (base) => {
      const r = await fetch(`${base}/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier: "a@b.co", password: "x" }) });
      assert.equal(r.status, 500);
      const body = await r.text();
      assert.equal(body, JSON.stringify({ ok: false, error: "Internal server error" }));
      assert.ok(!body.includes("secret-host"));
    });
  } finally { User.findOne = orig; console.error = errs; }
});

// ── No SkinTel modules in the Insider Tracker server's import graph ──────────
test("insider-mvp.js never imports legacy SkinTel modules", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const seen = new Set();
  const walk = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = fs.readFileSync(file, "utf8");
    for (const m of src.matchAll(/(?:^|\n)\s*import\s+(?:[^'"]*?from\s+)?["'](\.{1,2}\/[^"']+)["']|import\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g)) {
      const rel = m[1] || m[2];
      const next = path.resolve(path.dirname(file), rel);
      if (fs.existsSync(next)) walk(next);
    }
  };
  walk(path.join(root, "insider-mvp.js"));
  const files = [...seen].map((f) => path.relative(root, f).replace(/\\/g, "/"));
  const banned = files.filter((f) => /empire|market|auction|trade|chat|steam|social|\bdm\b|socket\/socket\.js|jobs\/alertEngine|alerts\.controller|watchMatcher|pushNotificationFormat|WatchRule\.model|AlertState/i.test(f));
  assert.ok(files.includes("services/insiderAlertEngine.js"), "new engine is reachable (sanity check that the walk works)");
  assert.deepEqual(banned, [], `legacy modules reachable: ${banned.join(", ")}`);
  assert.ok(files.includes("services/fcm.js"), "existing FCM delivery module is reused");
});
