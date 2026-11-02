import bcrypt from "bcryptjs";
import { logError } from "../utils/safeLog.js";
import jwt from "jsonwebtoken";
import User from "../models/User.model.js";

function signToken(userId) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET missing in .env");
  const exp = process.env.JWT_EXPIRES_IN || "7d";
  return jwt.sign({ sub: String(userId) }, secret, { expiresIn: exp });
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}
function normalizeGender(g) {
  const s = String(g || "").trim().toLowerCase();
  if (s === "male" || s === "m" || s === "man") return "male";
  if (s === "female" || s === "f" || s === "woman") return "female";
  if (!s) return "unspecified";
  return "other";
}
function generateAvatarUrl({ username, email } = {}) {
  const seedBase = username || email || `u${Date.now()}${Math.random()}`;
  const seed = encodeURIComponent(String(seedBase));
  return `https://api.dicebear.com/7.x/identicon/svg?seed=${seed}`;
}

export async function signup(req, res) {
  try {
    const body = req.body || {};

    // תומך גם username וגם userName (כדי שלא תישבר אם צד אחד שונה)
    const username = body.username ?? body.userName;
    const fullName = body.fullName ?? "";
    const email = body.email;
    const password = body.password;
    const confirmPassword = body.confirmPassword;
    const gender = body.gender;
    const avatarUrl = body.avatarUrl;

    const cleanUsername = String(username || "").trim();
    const cleanEmail = normalizeEmail(email);
    const cleanFullName = String(fullName || "").trim();

    if (!cleanUsername || !cleanEmail || !password) {
      return res.status(400).json({ ok: false, error: "Missing fields" });
    }
    if (cleanUsername.length < 3) {
      return res.status(400).json({ ok: false, error: "Username must be at least 3 characters" });
    }
    if (!isValidEmail(cleanEmail)) {
      return res.status(400).json({ ok: false, error: "Invalid email" });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ ok: false, error: "Password must be at least 6 characters" });
    }
    if (confirmPassword !== undefined && String(password) !== String(confirmPassword)) {
      return res.status(400).json({ ok: false, error: "Passwords do not match" });
    }

    const [existingEmail, existingUsername] = await Promise.all([
      User.findOne({ email: cleanEmail }),
      User.findOne({ username: cleanUsername }),
    ]);

    if (existingEmail) return res.status(409).json({ ok: false, error: "Email already exists" });
    if (existingUsername) return res.status(409).json({ ok: false, error: "Username already exists" });

    const passwordHash = await bcrypt.hash(String(password), 10);

    const user = await User.create({
      username: cleanUsername,
      fullName: cleanFullName,
      email: cleanEmail,
      passwordHash,
      gender: normalizeGender(gender),
      avatarUrl: avatarUrl ? String(avatarUrl) : generateAvatarUrl({ username: cleanUsername, email: cleanEmail }),
    });

    const token = signToken(user._id);

    return res.json({
      ok: true,
      token,
      user: {
        id: user._id,
        username: user.username,
        fullName: user.fullName,
        email: user.email,
        gender: user.gender,
        avatarUrl: user.avatarUrl,
      },
    });
  } catch (err) {
    if (err?.code === 11000) {
      const field = Object.keys(err.keyPattern || {})[0] || "field";
      return res.status(409).json({ ok: false, error: `${field} already exists` });
    }
    logError("AUTH_ERROR", { requestId: req.id, op: "signup", err });
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
}

export async function login(req, res) {
  try {
    const { identifier, email, username, password } = req.body || {};

    const idRaw = identifier ?? email ?? username ?? "";
    const cleanId = String(idRaw).trim().toLowerCase();
    const cleanPass = String(password || "");

    if (!cleanId || !cleanPass) {
      return res.status(400).json({ ok: false, error: "Missing fields" });
    }

    const query = cleanId.includes("@") ? { email: cleanId } : { username: cleanId };
    const user = await User.findOne(query);

    if (!user) return res.status(401).json({ ok: false, error: "Invalid credentials" });
    if (!user.passwordHash) return res.status(401).json({ ok: false, error: "This account uses Steam login" });

    const ok = await bcrypt.compare(cleanPass, user.passwordHash);
    if (!ok) return res.status(401).json({ ok: false, error: "Invalid credentials" });

    const token = signToken(user._id);

    return res.json({
      ok: true,
      token,
      user: {
        id: user._id,
        username: user.username,
        fullName: user.fullName,
        email: user.email,
        gender: user.gender,
        avatarUrl: user.avatarUrl,
      },
    });
  } catch (err) {
    logError("AUTH_ERROR", { requestId: req.id, op: "login", err });
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
}

export async function me(req, res) {
  return res.json({ ok: true, user: req.user });
}

export async function updateSettings(req, res) {
  try {
    const { tradeMatchAlertsEnabled } = req.body || {};
    const update = {};
    if (typeof tradeMatchAlertsEnabled === "boolean") {
      update.tradeMatchAlertsEnabled = tradeMatchAlertsEnabled;
    }
    if (!Object.keys(update).length) {
      return res.status(400).json({ ok: false, error: "No valid settings provided." });
    }
    const user = await User.findByIdAndUpdate(req.user._id, update, { new: true }).select("-passwordHash");
    return res.json({ ok: true, user });
  } catch (err) {
    logError("AUTH_ERROR", { requestId: req.id, op: "updateSettings", err });
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
}

export const logout = async (req, res) => {
  try {
    res.clearCookie("token");
    return res.json({ ok: true });
  } catch (err) {
    logError("AUTH_ERROR", { requestId: req.id, op: "logout", err });
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
};