// Google-only authentication: Firebase ID token verification in protectRoute, profile
// creation / linking by Firebase UID, retired email/password endpoints. No network:
// the Firebase verifier and the user store are stubbed.
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import { createProtectRoute } from "./protectRoute.js";
import { looksLikeFirebaseIdToken, verifyGoogleIdToken, setFirebaseVerifierForTests, isFirebaseAuthConfigured } from "../services/firebaseAuth.js";
import { upsertGoogleUser } from "../services/firebaseUsers.js";

// A token whose payload looks like a Firebase ID token (signature is checked by the stubbed verifier).
const fakeIdToken = (claims) => `h.${Buffer.from(JSON.stringify({ iss: "https://securetoken.google.com/insider-tracker", ...claims })).toString("base64url")}.sig`;

// Minimal in-memory stand-in for the mongoose User model (only what the code uses).
function memUsers(seed = []) {
  const docs = seed.map((d, i) => ({ _id: `id${i + 1}`, ...d }));
  let n = docs.length;
  const match = (d, q) => Object.entries(q).every(([k, v]) => d[k] === v);
  const sel = (d) => (d ? { select: () => { const { passwordHash, ...rest } = d; return Promise.resolve(rest); }, then: (r) => Promise.resolve(d).then(r) } : { select: () => Promise.resolve(null), then: (r) => Promise.resolve(null).then(r) });
  return {
    docs,
    findOne: (q) => sel(docs.find((d) => match(d, q)) || null),
    findById: (id) => sel(docs.find((d) => d._id === id) || null),
    exists: async (q) => !!docs.find((d) => match(d, q)),
    create: async (d) => { const doc = { _id: `id${++n}`, ...d }; docs.push(doc); return doc; },
    updateOne: async ({ _id }, { $set }) => { Object.assign(docs.find((d) => d._id === _id), $set); },
  };
}

test("token shape detection: Firebase ID tokens vs legacy app JWTs", () => {
  assert.equal(looksLikeFirebaseIdToken(fakeIdToken({ uid: "u1" })), true);
  assert.equal(looksLikeFirebaseIdToken(jwt.sign({ sub: "x" }, "secret")), false);
  assert.equal(looksLikeFirebaseIdToken("garbage"), false);
});

test("only Google sign-in is accepted; not configured → clear error", async () => {
  setFirebaseVerifierForTests(async () => ({ uid: "u1", firebase: { sign_in_provider: "password" } }));
  await assert.rejects(verifyGoogleIdToken("t"), (e) => e.code === "auth/provider-not-allowed");
  setFirebaseVerifierForTests(async () => ({ uid: "u1", firebase: { sign_in_provider: "google.com" } }));
  assert.equal((await verifyGoogleIdToken("t")).uid, "u1");
  setFirebaseVerifierForTests(null);
  assert.equal(isFirebaseAuthConfigured({}), false);
  await assert.rejects(verifyGoogleIdToken("t"), (e) => e.code === "auth/not-configured" || /projectId|project/i.test(e.message));
});

test("profiles: by UID; existing account LINKED by verified email (same _id → data kept); unverified email never links", async () => {
  const User = memUsers([{ username: "alice", email: "alice@example.com", passwordHash: "x", avatarUrl: "", fullName: "" }]);
  const g = (o) => ({ uid: "g-alice", email: "alice@example.com", email_verified: true, name: "Alice Doe", picture: "https://p/a.png", firebase: { sign_in_provider: "google.com" }, ...o });
  const linked = await upsertGoogleUser(g(), { User });
  assert.equal(linked._id, "id1", "same MongoDB user → watchlists, alerts and device tokens stay attached");
  assert.equal(User.docs[0].firebaseUid, "g-alice");
  assert.equal(User.docs[0].avatarUrl, "https://p/a.png");
  assert.equal(linked.passwordHash, undefined, "never returned");
  const again = await upsertGoogleUser(g(), { User });
  assert.equal(again._id, "id1");
  assert.equal(User.docs.length, 1, "no duplicate profile");
  // Unverified email: a NEW profile, the existing account is not touched.
  const User2 = memUsers([{ username: "bob", email: "bob@example.com" }]);
  const nu = await upsertGoogleUser({ uid: "g-bob", email: "bob@example.com", email_verified: false, name: "Bob", firebase: { sign_in_provider: "google.com" } }, { User: User2 });
  assert.notEqual(nu._id, "id1");
  assert.equal(User2.docs[0].firebaseUid, undefined);
  // Email already linked to ANOTHER Google account → refused.
  const User3 = memUsers([{ username: "carol", email: "carol@example.com", firebaseUid: "g-other" }]);
  await assert.rejects(upsertGoogleUser({ uid: "g-carol", email: "carol@example.com", email_verified: true, firebase: { sign_in_provider: "google.com" } }, { User: User3 }), (e) => e.code === "auth/account-conflict");
  // New users get a unique username.
  const User4 = memUsers([{ username: "dan.smith" }]);
  const d = await upsertGoogleUser({ uid: "g-dan", email: "dan@example.com", email_verified: true, name: "Dan Smith", firebase: { sign_in_provider: "google.com" } }, { User: User4, random: () => 0.1234 });
  assert.equal(User4.docs[1].username, "dan.smith.1234");
  assert.equal(User4.docs[1].firebaseUid, "g-dan");
  assert.equal(d.email, "dan@example.com");
});

test("protectRoute: valid Google token → req.user; expired / wrong provider / missing → 401 with a code; legacy JWT rejected", async () => {
  const User = memUsers([{ username: "alice", email: "alice@example.com", firebaseUid: "g-alice" }]);
  const verify = async (t) => {
    const claims = JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString());
    if (claims.expired) throw Object.assign(new Error("expired"), { code: "auth/id-token-expired" });
    if (claims.provider !== "google.com") throw Object.assign(new Error("provider"), { code: "auth/provider-not-allowed" });
    return { uid: claims.uid, email: claims.email, email_verified: true, firebase: { sign_in_provider: "google.com" } };
  };
  const guard = createProtectRoute({ verify, findByUid: (uid) => User.findOne({ firebaseUid: uid }).select(), upsert: (d) => upsertGoogleUser(d, { User }), allowLegacyJwt: () => false });
  const app = express();
  app.get("/p", guard, (req, res) => res.json({ ok: true, user: req.user.username, provider: req.auth.provider }));
  const srv = app.listen(0, "127.0.0.1"); await new Promise((r) => srv.once("listening", r));
  try {
    const call = async (token) => { const r = await fetch(`http://127.0.0.1:${srv.address().port}/p`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }); return { status: r.status, body: await r.json() }; };
    assert.deepEqual(await call(fakeIdToken({ uid: "g-alice", provider: "google.com" })), { status: 200, body: { ok: true, user: "alice", provider: "google" } });
    const created = await call(fakeIdToken({ uid: "g-new", email: "new@example.com", provider: "google.com" }));
    assert.equal(created.status, 200, "first request of a new Google user creates the profile");
    assert.equal(User.docs.length, 2);
    assert.deepEqual(await call(fakeIdToken({ uid: "g-alice", provider: "google.com", expired: true })), { status: 401, body: { ok: false, error: "Unauthorized", code: "auth/id-token-expired" } });
    assert.equal((await call(fakeIdToken({ uid: "g-alice", provider: "password" }))).body.code, "auth/provider-not-allowed");
    assert.equal((await call(null)).body.code, "auth/sign-in-required");
    const legacy = await call(jwt.sign({ sub: "id1" }, "secret"));
    assert.deepEqual([legacy.status, legacy.body.code], [401, "auth/sign-in-required"], "email/password-era sessions no longer work");
  } finally { srv.close(); }
});

test("auth routes: email/password signup and login are retired (410)", async () => {
  const { default: authRoutes } = await import("../routers/authRoutes.js");
  const app = express(); app.use(express.json()); app.use("/api/auth", authRoutes);
  const srv = app.listen(0, "127.0.0.1"); await new Promise((r) => srv.once("listening", r));
  try {
    for (const p of ["signup", "login"]) {
      const r = await fetch(`http://127.0.0.1:${srv.address().port}/api/auth/${p}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "a@b.c", password: "x" }) });
      assert.equal(r.status, 410);
      assert.equal((await r.json()).code, "auth/password-retired");
    }
    const s = await fetch(`http://127.0.0.1:${srv.address().port}/api/auth/session`, { method: "POST" });
    assert.equal(s.status, 401, "session requires a Google ID token");
  } finally { srv.close(); }
});
