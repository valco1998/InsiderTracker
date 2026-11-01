import jwt from "jsonwebtoken";
import User from "../models/User.model.js";

export default async function protectRoute(req, res, next) {
  try {
    let token = null;

    const auth = req.headers.authorization;
    if (auth?.startsWith("Bearer ")) token = auth.slice(7).trim();
    if (!token && req.cookies?.token) token = req.cookies.token;

    if (!token) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error("JWT_SECRET missing in .env");

    const payload = jwt.verify(token, secret);

    // 🔥 התיקון הקריטי
    const userId = payload.sub || payload.id;

    if (!userId) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    const user = await User.findById(userId).select("-passwordHash");

    if (!user) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    req.user = user;
    next();
  } catch (err) {
    console.error("protectRoute error:", err.message);
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
}