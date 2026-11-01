// server/config/clientUrls.js
//
// Single source of truth for the frontend origin(s).
// CORS (Express + Socket.IO) and the Steam OAuth redirect (steam.controller.js)
// all import from here instead of re-reading process.env with their own
// fallback logic — keeps the "where does the browser get sent back to"
// behavior consistent across the whole server.
//
// Origins come from env only (CLIENT_URL / CLIENT_ORIGIN / CORS_ORIGIN).
// There is no hardcoded production domain: in production a missing
// CLIENT_URL/CLIENT_ORIGIN stops startup, and any SkinTel production domain
// in the env is rejected so this project can never serve SkinTel's frontend.

const isProd = process.env.NODE_ENV === "production";

// Dev client runs on 5174 (vite.config.js) so it never shares browser storage
// or service workers with a local SkinTel dev server on 5173.
const DEV_CLIENT_URL = "http://localhost:5174";
const DEV_ORIGINS = ["http://localhost:5174", "http://127.0.0.1:5174"];

const SKINTEL_PROD_PATTERN = /skin-tel\.com|skintel-app\.onrender\.com|skintel-beta\.vercel\.app/i;

const configuredUrls = [
  process.env.CLIENT_URL,
  process.env.CLIENT_ORIGIN,
  process.env.CORS_ORIGIN,
].filter(Boolean).join(",");

if (SKINTEL_PROD_PATTERN.test(configuredUrls)) {
  throw new Error(
    "[config] CLIENT_URL / CLIENT_ORIGIN / CORS_ORIGIN references a SkinTel production domain. " +
    "Insider Tracker must use its own frontend domain."
  );
}

const rawClientUrl = (process.env.CLIENT_URL || process.env.CLIENT_ORIGIN || "").trim();

if (isProd && !rawClientUrl) {
  throw new Error("[config] CLIENT_URL (or CLIENT_ORIGIN) must be set in production.");
}

// CLIENT_URL used for server-initiated redirects (Steam OAuth callback, etc).
export const CLIENT_URL = (rawClientUrl || DEV_CLIENT_URL).replace(/\/$/, "");

// Browsers send Origin without a trailing slash; normalize env values to match.
const toOrigin = (s) => s.trim().replace(/\/+$/, "");

// Builds the deduped list of allowed CORS origins (Express + Socket.IO).
export function getAllowedOrigins(isProd) {
  const envOrigins = [
    process.env.CLIENT_ORIGIN,
    process.env.CLIENT_URL,
  ].filter(Boolean).map(toOrigin);

  const extraOrigins = (process.env.CORS_ORIGIN || "")
    .split(",").map(toOrigin).filter(Boolean);

  return [
    ...new Set([
      ...envOrigins,
      ...extraOrigins,
      ...(!isProd ? DEV_ORIGINS : []),
    ]),
  ];
}
