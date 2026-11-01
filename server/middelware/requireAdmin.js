/**
 * Gates a route to the single operator account, identified by ADMIN_EMAIL.
 * Must run after protectRoute (req.user must already be populated).
 */
export default function requireAdmin(req, res, next) {
  const adminEmail = process.env.ADMIN_EMAIL;

  if (!adminEmail || req.user?.email !== adminEmail) {
    return res.status(403).json({ ok: false, error: "Forbidden" });
  }

  next();
}
