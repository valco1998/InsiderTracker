// The legacy SkinTel entry point (server.js) must never start against InsiderTracker, and
// `npm start` must launch InsiderTracker. No network: the URIs point at a closed local port.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.join(here, "..");

// Importing the guard runs its check: make that import itself allowed (non-insider db + flag).
process.env.MONGO_URI = "mongodb://127.0.0.1:1/skintel_test";
process.env.ALLOW_LEGACY_SKINTEL_SERVER = "1";
const { legacyServerBlockReason } = await import("./legacyServerGuard.js");

test("rule: InsiderTracker databases are always refused; anything else needs the explicit flag", () => {
  const r = (uri, allow) => legacyServerBlockReason({ MONGO_URI: uri, ...(allow ? { ALLOW_LEGACY_SKINTEL_SERVER: "1" } : {}) });
  assert.match(r("mongodb+srv://u:p@cluster0.x.mongodb.net/insider_tracker?retryWrites=true", true), /InsiderTracker database/, "flag cannot override");
  assert.match(r("mongodb://h/Insider%5FTracker", true), /InsiderTracker database/, "URL-encoded and case-insensitive");
  assert.match(r("mongodb://h/skintel", false), /ALLOW_LEGACY_SKINTEL_SERVER/);
  assert.match(r("", false), /ALLOW_LEGACY_SKINTEL_SERVER/);
  assert.equal(r("mongodb://h/skintel", true), null);
  assert.match(legacyServerBlockReason({ MONGO_URL: "mongodb://h/insider_tracker", ALLOW_LEGACY_SKINTEL_SERVER: "1" }), /InsiderTracker/, "MONGO_URL fallback is checked too");
});

function runLegacy(env) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "legacy-guard-")); // no .env here
  try {
    return spawnSync(process.execPath, [path.join(SERVER_DIR, "server.js")], {
      cwd, encoding: "utf8", timeout: 20_000,
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env },
    });
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
}

test("node server.js against insider_tracker exits immediately — even with the flag — before any connection", () => {
  for (const allow of [undefined, "1"]) {
    const r = runLegacy({ MONGO_URI: "mongodb://127.0.0.1:1/insider_tracker", ...(allow ? { ALLOW_LEGACY_SKINTEL_SERVER: allow } : {}) });
    assert.equal(r.status, 1, `exit code (flag=${allow}) stderr=${r.stderr.slice(0, 300)}`);
    assert.match(r.stderr, /\[LEGACY_SERVER_BLOCKED\]/);
    assert.doesNotMatch(r.stdout + r.stderr, /MongoDB connected|\[3\/6\]|Empire/i, "nothing after the guard ran");
  }
});

test("node server.js without the explicit flag exits for any database", () => {
  const r = runLegacy({ MONGO_URI: "mongodb://127.0.0.1:1/some_other_db" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /ALLOW_LEGACY_SKINTEL_SERVER/);
});

test("npm start launches InsiderTracker; the guard is server.js's first import", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(SERVER_DIR, "package.json"), "utf8"));
  assert.equal(pkg.scripts.start, "node insider-mvp.js");
  assert.equal(pkg.main, "insider-mvp.js");
  const firstImport = fs.readFileSync(path.join(SERVER_DIR, "server.js"), "utf8").split("\n").find((l) => /^import /.test(l));
  assert.match(firstImport, /legacyServerGuard\.js/);
});
