// server/services/edgar/insiderStream.js
//
// Phase D3 — public, read-only Server-Sent Events stream of SNAPSHOT VERSIONS.
//
//   GET /api/insider/stream   (text/event-stream)
//
// Events are tiny notifications, never transaction data. A client that receives
// a newer version re-fetches the first page of /api/insider/transactions.
//
//   event: snapshot   id: <snapshot version>
//   data: {"version","publishedAt","rows","total","newestAcceptedAt"}
//         Sent ONLY when a processed snapshot containing new SEC data has been
//         built (publish() is called from the snapshot store's onBuild hook), and
//         once on connect (current state). Every field comes from the snapshot:
//         publishedAt = when that snapshot was built, newestAcceptedAt = SEC
//         acceptance time of the newest filing it contains.
//
//   event: heartbeat  (every heartbeatMs, default 25 s; also keeps proxies open)
//   data: {"at","version","sec":{"state","lastPollAt","pollIntervalMs","queueLength"}}
//         `sec` is the ingest's real status (last SUCCESSFUL SEC poll, throttling)
//         so a UI can show truthful freshness without polling.
//
// Reconnect: EventSource reconnects by itself (server sends `retry:`), with the
// Last-Event-ID header = last version seen. Events are STATE, not deltas, so a
// reconnecting client gets the current version once (or nothing if it is
// already current) — nothing can be "missed". `?lastEventId=` is accepted too.
//
// Cost: one serialized frame per published version, shared by all clients; the
// snapshot is never built per client. Slow consumers are dropped (backpressure),
// connections are capped globally and per IP.

import compression from "compression";

const FRAME_LIMIT_BYTES = 256 * 1024; // buffered-but-unsent bytes before a client is dropped

// For app.use(compression({ filter })): gzip everything compressible EXCEPT
// text/event-stream, which compression would buffer (delaying live events).
export const isEventStream = (res) => String(res.getHeader("Content-Type") || "").startsWith("text/event-stream");
export const compressionFilter = (req, res) => !isEventStream(res) && compression.filter(req, res);

export function createSnapshotStream({
  heartbeatMs = 25_000,
  retryMs = 5000,
  // Behind a reverse proxy without `trust proxy`, every client shares the proxy's
  // IP — raise INSIDER_SSE_MAX_PER_IP (or configure trust proxy) in that setup.
  maxClients = Math.min(Math.max(Number(process.env.INSIDER_SSE_MAX_CLIENTS) || 1000, 1), 20_000),
  maxPerIp = Math.min(Math.max(Number(process.env.INSIDER_SSE_MAX_PER_IP) || 20, 1), 20_000),
  now = () => Date.now(),
  getCurrent = () => null, // → snapshot info for clients that connect before the first publish
  getSecStatus = () => null,
  log = console,
} = {}) {
  const clients = new Set(); // { res, ip, id }
  const perIp = new Map();
  let nextId = 1;
  let last = null; // { version, frame, info }
  let heartbeat = null;
  const stats = { connects: 0, disconnects: 0, rejected: 0, dropped: 0, events: 0, framesWritten: 0, heartbeats: 0, lastEventAt: null };

  const frameOf = (event, data, id) => `${id != null ? `id: ${id}\n` : ""}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

  function remember(info) {
    if (!info || !Number.isFinite(info.version)) return null;
    if (last && info.version <= last.version) return null;
    last = { version: info.version, info, frame: frameOf("snapshot", info, info.version) };
    return last;
  }

  function write(c, frame) {
    try {
      c.res.write(frame);
      stats.framesWritten++;
      if (c.res.writableLength > FRAME_LIMIT_BYTES) { stats.dropped++; drop(c, "slow_consumer"); }
    } catch {
      drop(c, "write_failed");
    }
  }

  function drop(c, reason) {
    if (!clients.delete(c)) return;
    stats.disconnects++;
    const n = (perIp.get(c.ip) || 1) - 1;
    if (n > 0) perIp.set(c.ip, n); else perIp.delete(c.ip);
    if (reason !== "closed") { try { c.res.end(); } catch { /* already gone */ } }
    if (!clients.size && heartbeat) { clearInterval(heartbeat); heartbeat = null; }
  }

  function sendHeartbeat() {
    stats.heartbeats++;
    const frame = frameOf("heartbeat", { at: new Date(now()).toISOString(), version: last?.version ?? null, sec: getSecStatus() });
    for (const c of [...clients]) write(c, frame);
  }

  // Called after a snapshot build. Emits only when the version is newer than the last one sent.
  function publish(info) {
    const ev = remember(info);
    if (!ev) return 0;
    stats.events++;
    stats.lastEventAt = new Date(now()).toISOString();
    for (const c of [...clients]) write(c, ev.frame);
    return clients.size;
  }

  // Express handler.
  function handle(req, res) {
    const ip = req.ip || req.socket?.remoteAddress || "unknown";
    if (clients.size >= maxClients || (perIp.get(ip) || 0) >= maxPerIp) {
      stats.rejected++;
      res.set("Retry-After", "30");
      return res.status(clients.size >= maxClients ? 503 : 429).json({ error: "Too many live connections" });
    }
    res.status(200);
    res.set({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // nginx: do not buffer
    });
    res.flushHeaders?.();
    req.socket?.setNoDelay?.(true);
    req.socket?.setKeepAlive?.(true);

    const c = { res, ip, id: nextId++ };
    clients.add(c);
    perIp.set(ip, (perIp.get(ip) || 0) + 1);
    stats.connects++;
    req.on("close", () => drop(c, "closed"));

    res.write(`retry: ${retryMs}\n\n`);
    if (!last) remember(getCurrent());
    const seen = Number(req.get?.("last-event-id") ?? req.query?.lastEventId);
    // State, not deltas: send the current version unless the client already has it.
    if (last && !(Number.isFinite(seen) && seen === last.version)) write(c, last.frame);
    if (!heartbeat) {
      heartbeat = setInterval(sendHeartbeat, heartbeatMs);
      heartbeat.unref?.();
    }
  }

  function close() {
    for (const c of [...clients]) drop(c, "shutdown");
  }

  return {
    handle, publish, close,
    getStats: () => ({ ...stats, clients: clients.size, ips: perIp.size, version: last?.version ?? null }),
    _sendHeartbeat: sendHeartbeat,
  };
}

// Snapshot → event payload (all values taken from the snapshot itself).
export function describeSnapshot(snap, publishedAtMs) {
  return {
    version: snap.version,
    publishedAt: new Date(publishedAtMs ?? snap.builtAt).toISOString(),
    rows: snap.raw.length,
    total: snap.economic.length,
    newestAcceptedAt: snap.raw[0]?.acceptedAtET ?? null,
  };
}

// Ingest status → the small, truthful freshness block sent with heartbeats.
export function secFreshness(st) {
  if (!st) return null;
  const paused = !!st.throttle?.paused || st.edgar?.breaker?.state === "open";
  const pollMs = st.pollIntervalMs || 60_000;
  const age = st.lastPollAt ? Date.now() - Date.parse(st.lastPollAt) : null;
  const state = !st.initialSyncCompletedAt ? "initial_sync"
    : paused ? "throttled"
    : age == null || age > pollMs * 3 ? "stale"
    : st.lastPollError ? "error"
    : "ok";
  return { state, lastPollAt: st.lastPollAt ?? null, pollIntervalMs: pollMs, queueLength: st.queueLength ?? 0 };
}
