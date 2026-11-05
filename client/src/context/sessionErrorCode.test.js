// /auth/session failures map to accurate sign-in messages (no "try again" when retrying cannot help).
import { test } from "node:test";
import assert from "node:assert/strict";

// AuthContext.jsx imports React/Firebase; keep the rule testable by evaluating the same expression here.
// The expression is copied verbatim from AuthContext.jsx and checked against the source below.
import fs from "node:fs";
const src = fs.readFileSync(new URL("./AuthContext.jsx", import.meta.url), "utf8");
const m = src.match(/export const sessionErrorCode = (\(e\) => [\s\S]*?"auth\/session-failed"\));/);
assert.ok(m, "sessionErrorCode is defined in AuthContext.jsx");
const sessionErrorCode = new Function(`return ${m[1]}`)();

test("503 from /auth/session (accounts switched off on the server) → accounts-unavailable", () => {
  assert.equal(sessionErrorCode({ response: { status: 503, data: { ok: false, error: "Account features are not configured" } } }), "auth/accounts-unavailable");
});
test("account conflict keeps its own code; other failures stay session-failed", () => {
  assert.equal(sessionErrorCode({ response: { status: 409, data: { code: "auth/account-conflict" } } }), "auth/account-conflict");
  assert.equal(sessionErrorCode({ response: { status: 500, data: {} } }), "auth/session-failed");
  assert.equal(sessionErrorCode(new Error("network")), "auth/session-failed");
});
test("every code has a message", () => {
  const msgs = fs.readFileSync(new URL("../lib/firebaseAuth.js", import.meta.url), "utf8");
  for (const c of ["auth/accounts-unavailable", "auth/session-failed", "auth/account-conflict"]) assert.match(msgs, new RegExp(`"${c}":`));
});
