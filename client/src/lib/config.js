// Single source of truth for backend URLs.
// VITE_API_URL is set per-environment:
//   .env               → http://localhost:5055/api  (dev)
//   .env.production    → https://<insider-tracker-backend>/api  (prod build)
// Production builds fail if VITE_API_URL is unset (vite.config.js), so the
// fallback below only ever applies in local dev.
//
// Normalized so API_BASE always ends in "/api", even if VITE_API_URL is
// misconfigured (e.g. set to the bare backend origin without "/api") —
// otherwise STEAM_LOGIN_URL etc. resolve to a 404 on the backend.
const RAW_API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5055/api";
export const API_BASE = RAW_API_BASE.replace(/\/+$/, "").replace(/\/api$/, "") + "/api";

// Socket.IO connects to the server root, not /api
export const SOCKET_URL = API_BASE.replace(/\/api\/?$/, "");

export const STEAM_LOGIN_URL = `${API_BASE}/steam/login`;
