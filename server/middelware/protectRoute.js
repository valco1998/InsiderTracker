import jwt from "jsonwebtoken";
import User from "../models/User.model.js";
import { logWarn } from "../utils/safeLog.js";
import { looksLikeFirebaseIdToken, verifyGoogleIdToken } from "../services/firebaseAuth.js";
import { upsertGoogleUser } from "../services/firebaseUsers.js";

// Authentication for protected routes — Google sign-in via Firebase Authentication.
//   Authorization: Bearer <Firebase ID token>  (the client refreshes it automatically)
// The token is verified with firebase-admin (signature, expiry, audience = our project,
// provider = google.com) and mapped to the MongoDB profile by Firebase UID (created or
// linked on first use — services/firebaseUsers.js).
// Legacy app JWTs from the retired email/password login are rejected unless
// AUTH_ALLOW_LEGACY_JWT=1 (temporary escape hatch). Tokens are never logged.
// 401 body: { ok: false, error: "Unauthorized", code } — code tells the client whether to
// refresh (auth/id-token-expired) or sign in again.
export function createProtectRoute({
  verify = verifyGoogleIdToken,
  findByUid = (uid) => User.findOne({ firebaseUid: uid }).select("-passwordHash"),
  upsert = (decoded) => upsertGoogleUser(decoded),
  findById = (id) => User.findById(id).select("-passwordHash"),
  allowLegacyJwt = () => process.env.AUTH_ALLOW_LEGACY_JWT === "1",
} = {}) {
  const deny = (res, code) => res.status(401).json({ ok: false, error: "Unauthorized", code });

  return async function protectRoute(req, res, next) {
    let token = null;
    const auth = req.headers.authorization;
    if (auth?.startsWith("Bearer ")) token = auth.slice(7).trim();
    if (!token && req.cookies?.token) token = req.cookies.token;
    if (!token) return deny(res, "auth/sign-in-required");

    try {
      if (looksLikeFirebaseIdToken(token)) {
        const decoded = await verify(token);
        const user = (await findByUid(decoded.uid)) || (await upsert(decoded));
        if (!user) return deny(res, "auth/user-not-found");
        req.user = user;
        req.auth = { provider: "google", uid: decoded.uid };
        return next();
      }

      if (!allowLegacyJwt()) return deny(res, "auth/sign-in-required");
      const secret = process.env.JWT_SECRET;
      if (!secret) throw new Error("JWT_SECRET missing in .env");
      const payload = jwt.verify(token, secret);
      const userId = payload.sub || payload.id;
      if (!userId) return deny(res, "auth/invalid-token");
      const user = await findById(userId);
      if (!user) return deny(res, "auth/user-not-found");
      req.user = user;
      req.auth = { provider: "legacy-jwt" };
      return next();
    } catch (err) {
      // Expected for bad/expired tokens — logged without the token itself.
      const code = err?.code === "auth/id-token-expired" ? "auth/id-token-expired"
        : err?.code === "auth/provider-not-allowed" ? "auth/provider-not-allowed"
          : err?.code === "auth/account-conflict" ? "auth/account-conflict"
            : err?.code === "auth/not-configured" ? "auth/not-configured"
              : "auth/invalid-token";
      logWarn("AUTH_REJECTED", { requestId: req.id, path: req.originalUrl?.split("?")[0], reason: code, msg: err?.message });
      return deny(res, code);
    }
  };
}

export default createProtectRoute();
