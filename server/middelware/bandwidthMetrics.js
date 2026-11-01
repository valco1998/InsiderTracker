// Lightweight in-process bandwidth/request observability.
//
// Tracks, per route pattern (method + path template, e.g. "GET /api/items/market"):
//   - request count
//   - total response bytes (measured AFTER compression, since this middleware
//     is registered before `compression()` in server.js — compression wraps
//     res.write/res.end a second time and calls back into the functions we
//     patch here with the already-compressed chunks)
//   - status code counts
//
// No request/response bodies, headers, cookies, or auth tokens are ever
// captured — only aggregate counters keyed by route + status code.
// Memory footprint is O(distinct routes), not O(requests).

const routeStats = new Map();
const startedAt = Date.now();

function routeKeyFor(req) {
  const base = req.baseUrl || "";
  const routePath = req.route?.path;
  const path = routePath ? `${base}${routePath}` : (req.baseUrl || req.path || "unmatched");
  return `${req.method} ${path}`;
}

export function bandwidthMetrics(req, res, next) {
  let bytes = 0;

  const originalWrite = res.write.bind(res);
  const originalEnd = res.end.bind(res);

  res.write = function patchedWrite(chunk, ...args) {
    if (chunk) bytes += Buffer.byteLength(chunk);
    return originalWrite(chunk, ...args);
  };

  res.end = function patchedEnd(chunk, ...args) {
    if (chunk) bytes += Buffer.byteLength(chunk);
    return originalEnd(chunk, ...args);
  };

  res.on("finish", () => {
    const key = routeKeyFor(req);
    let stat = routeStats.get(key);
    if (!stat) {
      stat = { count: 0, bytes: 0, statusCounts: {} };
      routeStats.set(key, stat);
    }
    stat.count += 1;
    stat.bytes += bytes;
    stat.statusCounts[res.statusCode] = (stat.statusCounts[res.statusCode] || 0) + 1;
  });

  next();
}

export function getBandwidthSnapshot({ limit = 25 } = {}) {
  let totalRequests = 0;
  let totalBytes = 0;
  const routes = [];

  for (const [route, stat] of routeStats.entries()) {
    totalRequests += stat.count;
    totalBytes += stat.bytes;
    routes.push({
      route,
      requests: stat.count,
      bytes: stat.bytes,
      avgBytes: stat.count ? Math.round(stat.bytes / stat.count) : 0,
      statusCounts: stat.statusCounts,
    });
  }

  routes.sort((a, b) => b.bytes - a.bytes);

  return {
    generatedAt: new Date().toISOString(),
    sinceStartAt: new Date(startedAt).toISOString(),
    totalRequests,
    totalBytes,
    routes: routes.slice(0, limit),
  };
}

export function resetBandwidthMetrics() {
  routeStats.clear();
}

function formatBytes(n) {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(2)}MB`;
}

/**
 * Logs a compact top-N summary to stdout. Intended to be called on a
 * setInterval from server.js so operators can eyeball bandwidth-by-endpoint
 * directly in Render logs without needing to hit the metrics endpoint.
 */
export function logBandwidthSummary(topN = 10) {
  const snap = getBandwidthSnapshot({ limit: topN });
  if (!snap.totalRequests) return;
  const lines = snap.routes
    .map((r, i) => `  ${i + 1}. ${r.route} — ${r.requests} reqs, ${formatBytes(r.bytes)} total, ${formatBytes(r.avgBytes)} avg`)
    .join("\n");
  console.log(
    `[BANDWIDTH] since ${snap.sinceStartAt} — ${snap.totalRequests} requests, ${formatBytes(snap.totalBytes)} total\n${lines}`
  );
}
