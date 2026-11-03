// Token access — the ONLY module that knows where the session token comes from.
//
// Google sign-in (Firebase Authentication): AuthContext registers a token provider that
// returns the current Firebase ID token (refreshed automatically by Firebase;
// forceRefresh = true asks for a fresh one, e.g. after a 401). getAuthToken() is what the
// API client attaches to requests.
//
// getToken / setToken / clearToken: the legacy app-JWT slot from the retired email/password
// login. Kept so older code paths compile; AuthContext clears it on start-up.
const KEY = "token";

let tokenProvider = null;

export function setTokenProvider(fn) {
  tokenProvider = typeof fn === "function" ? fn : null;
}

export function hasTokenProvider() {
  return !!tokenProvider;
}

export async function getAuthToken({ forceRefresh = false } = {}) {
  if (!tokenProvider) return null;
  try {
    return (await tokenProvider(forceRefresh)) || null;
  } catch {
    return null;
  }
}

export function getToken() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setToken(t) {
  try {
    localStorage.setItem(KEY, t);
  } catch { /* storage unavailable (private mode) — nothing to persist */ }
}

export function clearToken() {
  try {
    localStorage.removeItem(KEY);
  } catch { /* storage unavailable — nothing to clear */ }
}

// Cached profile (shown immediately on reload while the session is re-validated).
const USER_KEY = "user";
export function getCachedUser() {
  try { const raw = localStorage.getItem(USER_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
export function setCachedUser(u) {
  try { if (u) localStorage.setItem(USER_KEY, JSON.stringify(u)); else localStorage.removeItem(USER_KEY); } catch { /* storage unavailable — cache is optional */ }
}
