// proxy-empire.js
import express from "express";
import dotenv from "dotenv";
import path from "node:path";
import { fetchText, getEnv } from "./utils/http.js";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const app = express();

const PORT = Number(getEnv("PORT", "5055"));
const LOCAL_AUTH = getEnv("LOCAL_AUTH", "");
const UPSTREAM_BASE = getEnv("EMPIRE_UPSTREAM_BASE", "https://csgoempire.com");
const API_KEY = getEnv("EMPIRE_API_KEY", "");

if (!LOCAL_AUTH) {
  console.error("❌ Missing LOCAL_AUTH in .env (LOCAL_AUTH=...)");
  process.exit(1);
}

console.log("proxy listening on", PORT);
console.log("UPSTREAM_BASE =", UPSTREAM_BASE);

// Health (no auth)
app.get("/health", (req, res) => res.json({ ok: true }));

// Local auth guard
app.use((req, res, next) => {
  if (req.path === "/health") return next();

  const auth = req.headers["x-local-auth"];
  if (!auth || auth !== LOCAL_AUTH) {
    return res.status(401).json({ ok: false, error: "Unauthorized - Bad or missing x-local-auth" });
  }
  next();
});

// Proxy: forward ANY request path/query as-is
app.use(async (req, res) => {
  const upstreamUrl = UPSTREAM_BASE.replace(/\/$/, "") + req.originalUrl;

  const headers = {
    accept: "application/json",
    "user-agent": "AppCSNT/1.0",
  };

  const keyLen = (API_KEY || "").trim().length;
  if (keyLen) {
    headers["x-api-key"] = API_KEY;
    headers["authorization"] = `Bearer ${API_KEY}`;
  }

  console.log("➡️", req.method, upstreamUrl, "| keyLen=", keyLen);

  try {
    const { res: up, ct, text } = await fetchText(upstreamUrl, {
      method: req.method,
      headers,
    });

    console.log("⬅️ status=", up.status, "| ct=", ct, "| bodyFirst=", String(text).slice(0, 120).replace(/\s+/g, " "));

    res.status(up.status);
    if (ct) res.setHeader("content-type", ct);
    return res.send(text);
  } catch (e) {
    console.log("💥 fetch error:", e?.message || e);
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});


app.listen(PORT);
