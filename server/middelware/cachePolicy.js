// Route-level Cache-Control override for semi-static, non-personalized GET
// endpoints (e.g. market/auction listings that are identical for every
// authenticated user). server.js sets a blanket `Cache-Control: no-store`
// default on every /api/* response; routes that opt into this middleware
// override that default with a short private+revalidate policy so repeat
// polls within the window are served from the browser's HTTP cache (or a
// cheap 304) instead of re-downloading the full payload.
//
// Never apply this to per-user-sensitive or auth-flow endpoints — see
// server.js comments for the current allow-list.
export function cachePrivate(maxAgeSec, { staleWhileRevalidateSec } = {}) {
  const swr = staleWhileRevalidateSec ?? Math.max(maxAgeSec * 2, maxAgeSec + 5);
  return (req, res, next) => {
    res.set("Cache-Control", `private, max-age=${maxAgeSec}, stale-while-revalidate=${swr}`);
    res.removeHeader("Pragma");
    res.removeHeader("Expires");
    next();
  };
}
