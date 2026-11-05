// Regression guard for the 2026-11-03 incident: legacy SkinTel code connected to the InsiderTracker
// database and Mongoose auto-created 19 SkinTel collections there (which then made the isolation guard
// refuse the database and disabled Google sign-in).
//
// 1. STATIC: every server file that opens a MongoDB connection is either the guarded InsiderTracker
//    connection (services/insiderDb.js) or has config/legacyServerGuard.js as its FIRST import
//    (ES modules evaluate imports in order, so the process exits before any model or driver loads).
// 2. BEHAVIOUR: each guarded entry point, started against an InsiderTracker-named database, exits with
//    code 1 and [LEGACY_SERVER_BLOCKED] — even with ALLOW_LEGACY_SKINTEL_SERVER=1. No network: the URI
//    points at a closed local port, and cwd is a temp dir so no .env is loaded.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const GUARD = path.join(SERVER, "config", "legacyServerGuard.js");
const CONNECT_RE = /mongoose\.(?:connect|createConnection)\s*\(|new\s+MongoClient\s*\(|MongoClient\.connect\s*\(/;
const ALLOWED_UNGUARDED = new Set(["services/insiderDb.js"]); // the InsiderTracker connection: checkMongoUri + verifyMongoIdentity
const IMPORT_RE = /^\s*import\s+(?:[^'"]*?\sfrom\s+)?["']([^"']+)["']/;
const rel = (f) => path.relative(SERVER, f).replace(/\\/g, "/");

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".cache", ".git", "dist", "coverage"].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(m|c)?js$/.test(e.name) && !/\.test\.(m|c)?js$/.test(e.name)) out.push(p);
  }
  return out;
}
const connecting = walk(SERVER).filter((f) => CONNECT_RE.test(fs.readFileSync(f, "utf8")));
const guarded = connecting.filter((f) => !ALLOWED_UNGUARDED.has(rel(f)));

function firstImport(f) {
  for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = IMPORT_RE.exec(line);
    if (m) return path.resolve(path.dirname(f), m[1]);
    if (/^\s*(const|let|var|export|async|function|await)\b/.test(line)) return null; // code before any import
  }
  return null;
}

test("every legacy MongoDB entry point imports the guard FIRST (InsiderTracker's own connection excepted)", () => {
  assert.ok(connecting.some((f) => rel(f) === "services/insiderDb.js"), "scanner finds the InsiderTracker connection");
  assert.ok(guarded.length >= 17, `scanner finds the legacy entry points (found ${guarded.length})`);
  const missing = guarded.filter((f) => firstImport(f) !== GUARD).map(rel);
  assert.deepEqual(missing, [], `these files open a MongoDB connection without config/legacyServerGuard.js as their first import: ${missing.join(", ")}`);
});

test("server.js and the legacy connection module are covered", () => {
  const names = guarded.map(rel);
  for (const f of ["db/connectToMongooseDB.js", "test-mongo.js"]) assert.ok(names.includes(f), `${f} is scanned`);
  assert.equal(firstImport(path.join(SERVER, "server.js")), GUARD, "server.js imports the guard first");
});

test("each guarded entry point refuses an InsiderTracker database before connecting (even with the override flag)", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "legacy-guard-"));
  try {
    for (const allow of [undefined, "1"]) {
      for (const f of [...guarded, path.join(SERVER, "server.js")]) {
        const env = { ...process.env, MONGO_URI: "mongodb://127.0.0.1:1/insider_tracker" };
        delete env.MONGO_URL; delete env.ALLOW_LEGACY_SKINTEL_SERVER;
        if (allow) env.ALLOW_LEGACY_SKINTEL_SERVER = allow;
        const r = spawnSync(process.execPath, [f], { cwd, env, encoding: "utf8", timeout: 20_000 });
        assert.equal(r.status, 1, `${rel(f)} (flag ${allow ?? "unset"}) should exit 1, got ${r.status}; stderr: ${String(r.stderr).slice(0, 300)}`);
        assert.match(r.stderr, /\[LEGACY_SERVER_BLOCKED\].*InsiderTracker database/, `${rel(f)} prints the block reason`);
      }
    }
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
});
