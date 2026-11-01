// server/config/clientUrls.js
//
// Single source of truth for the production frontend origin(s).
// CORS (Express + Socket.IO) and the Steam OAuth redirect (steam.controller.js)
// all import from here instead of re-reading process.env with their own
// fallback logic — keeps the "where does the browser get sent back to"
// behavior consistent across the whole server.
//
// IMPORTANT: process.env.CLIENT_URL / CLIENT_ORIGIN (set on Render) still
// take precedence when set. If Render's CLIENT_URL points at the old
// skintel-beta.vercel.app domain, every value derived from PRIMARY_CLIENT_URL
// below will still resolve to the old domain — fix the Render env var, not
// this file.

export const PRIMARY_CLIENT_URL = "https://www.skin-tel.com";

// Always-allowed production origins (apex + www), regardless of env config.
export const PRODUCTION_ORIGINS = [
  "https://www.skin-tel.com",
  "https://skin-tel.com",
];

const DEV_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];

// CLIENT_URL used for server-initiated redirects (Steam OAuth callback, etc).
// process.env.CLIENT_URL / CLIENT_ORIGIN win if set; otherwise PRIMARY_CLIENT_URL.
export const CLIENT_URL = (
  process.env.CLIENT_URL || process.env.CLIENT_ORIGIN || PRIMARY_CLIENT_URL
).trim().replace(/\/$/, "");

if (process.env.NODE_ENV === "production") {
  if (/vercel\.app/i.test(CLIENT_URL)) {
    console.warn(
      `⚠️  CLIENT_URL/CLIENT_ORIGIN resolves to "${CLIENT_URL}" — this looks like ` +
      `the old beta domain. Update CLIENT_URL/CLIENT_ORIGIN on Render to ` +
      `"${PRIMARY_CLIENT_URL}" so OAuth redirects and CORS point at the ` +
      `current production domain.`
    );
  } else if (CLIENT_URL === "https://skin-tel.com") {
    console.warn(
      `⚠️  CLIENT_URL/CLIENT_ORIGIN is set to the apex domain "${CLIENT_URL}". ` +
      `The canonical domain is now "${PRIMARY_CLIENT_URL}". Steam OAuth redirects will hit ` +
      `a Vercel 301 before reaching the client — update CLIENT_URL/CLIENT_ORIGIN on Render to ` +
      `"${PRIMARY_CLIENT_URL}".`
    );
  }
}

// Builds the deduped list of allowed CORS origins (Express + Socket.IO).
export function getAllowedOrigins(isProd) {
  const envOrigins = [
    process.env.CLIENT_ORIGIN,
    process.env.CLIENT_URL,
  ].filter(Boolean).map((s) => s.trim());

  const extraOrigins = (process.env.CORS_ORIGIN || "")
    .split(",").map((s) => s.trim()).filter(Boolean);

  return [
    ...new Set([
      ...PRODUCTION_ORIGINS,
      ...envOrigins,
      ...extraOrigins,
      ...(!isProd ? DEV_ORIGINS : []),
    ]),
  ];
}
