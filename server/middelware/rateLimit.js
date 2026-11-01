// server/middelware/rateLimit.js
// Small in-memory fixed-window rate limiter (per IP + route key).
// Process-local, which matches the single-instance deployment model.
export function rateLimit({ windowMs = 60_000, max = 10, key = "default" } = {}) {
  const hits = new Map(); // ip → { count, resetAt }
  return (req, res, next) => {
    const now = Date.now();
    const ip = req.ip || req.socket?.remoteAddress || "unknown";
    let h = hits.get(ip);
    if (!h || now >= h.resetAt) {
      h = { count: 0, resetAt: now + windowMs };
      hits.set(ip, h);
      if (hits.size > 10_000) for (const [k, v] of hits) if (now >= v.resetAt) hits.delete(k);
    }
    h.count++;
    if (h.count > max) {
      res.set("Retry-After", String(Math.ceil((h.resetAt - now) / 1000)));
      console.warn(`[RATE_LIMITED] key=${key} ip=${ip} count=${h.count}`);
      return res.status(429).json({ ok: false, error: "Too many requests" });
    }
    next();
  };
}
