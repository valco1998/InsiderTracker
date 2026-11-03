// server/services/firebaseUsers.js
//
// Google (Firebase) identity → InsiderTracker user profile in MongoDB.
// Stable identity = Firebase UID (users.firebaseUid).
//   1. A user with this firebaseUid → that user.
//   2. Else, an EXISTING account with the same Google-VERIFIED email and no Firebase link
//      → linked (same MongoDB _id, so watchlists, alerts, device tokens and settings are kept).
//   3. Else a new profile.
// An email already linked to a different Google account is refused (no silent takeover).
import UserModelDefault from "../models/User.model.js";

const authError = (code, message) => Object.assign(new Error(message), { code });

function usernameBase(decoded) {
  const raw = decoded.name || String(decoded.email || "").split("@")[0] || "investor";
  const s = raw.normalize("NFKD").replace(/[^\w.-]+/g, ".").replace(/^[._-]+|[._-]+$/g, "").replace(/\.{2,}/g, ".").toLowerCase();
  return (s || "investor").slice(0, 24).padEnd(3, "0");
}

async function uniqueUsername(User, base, random = Math.random) {
  if (!(await User.exists({ username: base }))) return base;
  for (let i = 0; i < 8; i++) {
    const candidate = `${base.slice(0, 19)}.${String(Math.floor(random() * 10000)).padStart(4, "0")}`;
    if (!(await User.exists({ username: candidate }))) return candidate;
  }
  throw authError("auth/username-unavailable", "Could not allocate a username");
}

export async function upsertGoogleUser(decoded, { User = UserModelDefault, now = () => new Date(), random = Math.random } = {}) {
  const uid = String(decoded.uid);
  const email = decoded.email && decoded.email_verified ? String(decoded.email).trim().toLowerCase() : null;
  const profile = { lastLoginAt: now(), authProvider: "google" };

  let user = await User.findOne({ firebaseUid: uid });
  if (!user && email) {
    const existing = await User.findOne({ email });
    if (existing) {
      if (existing.firebaseUid && existing.firebaseUid !== uid) throw authError("auth/account-conflict", "This email is linked to a different Google account");
      user = existing; // link: same _id → existing data preserved
      profile.firebaseUid = uid;
    }
  }
  if (!user) {
    const created = await User.create({
      username: await uniqueUsername(User, usernameBase(decoded), random),
      fullName: decoded.name || "",
      email: email || undefined,
      avatarUrl: decoded.picture || "",
      firebaseUid: uid,
      authProvider: "google",
      lastLoginAt: now(),
    });
    return User.findById(created._id).select("-passwordHash");
  }
  if (!user.avatarUrl && decoded.picture) profile.avatarUrl = decoded.picture;
  if (!user.fullName && decoded.name) profile.fullName = decoded.name;
  await User.updateOne({ _id: user._id }, { $set: profile });
  return User.findById(user._id).select("-passwordHash");
}
