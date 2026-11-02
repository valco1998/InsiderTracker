// Redaction must remove credential material from any logged value.
// All "secrets" below are SYNTHETIC test strings.
import { test } from "node:test";
import assert from "node:assert/strict";
import { redact, formatEvent, logEvent } from "./safeLog.js";

test("redacts MongoDB URIs, URL credentials, JWTs, Bearer tokens, PEM keys and key=value secrets", () => {
  const cases = [
    ["MongoServerError: connect to mongodb+srv://app:S3cretPw@cluster0.abcde.mongodb.net/insider_tracker?retryWrites=true failed", "S3cretPw", "[redacted-mongodb-uri]"],
    ["fetch https://user:hunter2@example.com/x failed", "hunter2", "https://[redacted-credentials]@example.com/x"],
    ["token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlLXZhbHVl rejected", "eyJzdWIi", "[redacted-jwt]"],
    ["header Authorization: Bearer abc.def-ghi_123", "abc.def-ghi_123", "Bearer [redacted]"],
    ["key -----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg\n-----END PRIVATE KEY----- end", "MIIEvQ", "[redacted-private-key]"],
    ["config password=letmein secret: \"topsecret\" api_key=AKIA123", "letmein", "password=[redacted]"],
  ];
  for (const [input, secret, marker] of cases) {
    const out = redact(input);
    assert.ok(!out.includes(secret), `leaked: ${out}`);
    assert.ok(out.includes(marker), `missing marker in: ${out}`);
  }
  assert.ok(!redact("secret: \"topsecret\"").includes("topsecret"));
  assert.ok(!redact("api_key=AKIA123").includes("AKIA123"));
});

test("errors are redacted too; long values truncated; newlines flattened", () => {
  const err = new Error("cannot reach mongodb://u:p@h/db");
  assert.equal(redact(err), "Error: cannot reach [redacted-mongodb-uri]");
  assert.equal(redact("x".repeat(500)).length, 300);
  assert.equal(redact("a\nb\tc"), "a b c");
  assert.equal(redact(null), "");
});

test("formatEvent: structured key=value, quoting, omits empty fields, expands errors", () => {
  const line = formatEvent("AUTH_ERROR", { requestId: "r-123", op: "login", note: "two words", skip: undefined, none: null, err: new TypeError("bad mongodb://a:b@c/d") });
  assert.equal(line, '[AUTH_ERROR] requestId=r-123 op=login note="two words" err=TypeError msg="bad [redacted-mongodb-uri]"');
  const lines = [];
  logEvent("X", { a: 1 }, "warn", { warn: (l) => lines.push(l) });
  assert.deepEqual(lines, ["[X] a=1"]);
});
