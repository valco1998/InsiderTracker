// Insider Tracker — connection manager for the public SSE stream
// GET /api/insider/stream (Phase D3). Framework-free external store; React reads
// it through hooks/useInsiderStream.js (useSyncExternalStore), so heartbeats
// re-render only the components that display live status.
//
// Server events (server/services/edgar/insiderStream.js):
//   snapshot  { version, publishedAt, rows, total, newestAcceptedAt }  id = version
//   heartbeat { at, version, sec: { state, lastPollAt, pollIntervalMs, queueLength } }  every 25 s
//
// State.connection:
//   "connecting"   first attempt
//   "open"         stream established (events flowing)
//   "reconnecting" the browser is retrying (it resends Last-Event-ID), or the
//                  stream went silent for STALL_MS and was reopened
//   "unavailable"  the server refused/failed (e.g. 429/503) — retried with
//                  backoff 5 s → 60 s; the dashboard polls meanwhile
//   "unsupported"  no EventSource in this browser — polling only
//
// A snapshot is reported to onSnapshot listeners whenever its version DIFFERS
// from the last one seen (not only when greater: a restarted server may count
// from a lower version).

const STALL_MS = 70_000; // > 2 missed heartbeats
const RETRY_MIN_MS = 5_000;
const RETRY_MAX_MS = 60_000;

const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };

export function createLiveStream(url, { EventSourceImpl = globalThis.EventSource, now = () => Date.now(), stallMs = STALL_MS } = {}) {
  let state = { connection: "idle", version: null, snapshot: null, heartbeat: null, lastMessageAt: null, openedAt: null, failures: 0 };
  const listeners = new Set();
  const snapshotListeners = new Set();
  let es = null, retryTimer = null, watchdog = null, stopped = true, retryMs = RETRY_MIN_MS;

  const set = (patch) => {
    const next = { ...state, ...patch };
    if (Object.keys(patch).every((k) => next[k] === state[k])) return;
    state = next;
    listeners.forEach((l) => l());
  };

  function armWatchdog() {
    clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      if (stopped) return;
      // Silent stream (proxy dropped it without an error): reopen.
      close();
      set({ connection: "reconnecting" });
      connect();
    }, stallMs);
  }

  function close() {
    if (es) { es.onopen = es.onerror = null; es.close(); es = null; }
    clearTimeout(watchdog);
  }

  function connect() {
    clearTimeout(retryTimer);
    if (stopped) return;
    if (typeof EventSourceImpl !== "function") { set({ connection: "unsupported" }); return; }
    // A NEW EventSource cannot send Last-Event-ID — pass the last version in the query.
    const u = state.version != null ? `${url}${url.includes("?") ? "&" : "?"}lastEventId=${encodeURIComponent(state.version)}` : url;
    es = new EventSourceImpl(u); // public, read-only: no credentials
    if (state.connection === "idle") set({ connection: "connecting" });
    es.onopen = () => {
      retryMs = RETRY_MIN_MS;
      set({ connection: "open", openedAt: now(), failures: 0 });
      armWatchdog();
    };
    es.addEventListener("snapshot", (e) => {
      const d = parse(e.data);
      armWatchdog();
      if (!d || !Number.isFinite(d.version)) return;
      const changed = d.version !== state.version;
      set({ snapshot: d, version: d.version, lastMessageAt: now() });
      if (changed) snapshotListeners.forEach((l) => l(d));
    });
    es.addEventListener("heartbeat", (e) => {
      const d = parse(e.data);
      armWatchdog();
      if (!d) return;
      // A heartbeat naming another version means a snapshot event was missed
      // (dropped by a proxy, or published during a reconnect): report it.
      const missed = Number.isFinite(d.version) && d.version !== state.version;
      set({ heartbeat: d, lastMessageAt: now(), ...(missed ? { version: d.version } : {}) });
      if (missed) snapshotListeners.forEach((l) => l({ version: d.version }));
    });
    es.onerror = () => {
      if (stopped || !es) return;
      if (es.readyState === 2 /* CLOSED: HTTP error or wrong content type — the browser gave up */) {
        close();
        set({ connection: "unavailable", failures: state.failures + 1 });
        retryTimer = setTimeout(connect, retryMs);
        retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
      } else {
        // CONNECTING: the browser retries on its own (server sends retry: 5000).
        set({ connection: "reconnecting", failures: state.failures + 1 });
      }
    };
  }

  const onOnline = () => { if (!stopped && state.connection !== "open") { close(); connect(); } };

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      globalThis.addEventListener?.("online", onOnline);
      connect();
    },
    stop() {
      stopped = true;
      globalThis.removeEventListener?.("online", onOnline);
      clearTimeout(retryTimer);
      close();
      set({ connection: "idle" });
    },
    getState: () => state,
    subscribe(l) { listeners.add(l); return () => listeners.delete(l); },
    onSnapshot(l) { snapshotListeners.add(l); return () => snapshotListeners.delete(l); },
  };
}

// Truthful one-line status for the UI, from stream + last API response.
// Every input is real server state; nothing is assumed when data is missing.
// pollMs: the feed's actual fallback polling interval (shown while not live).
export function liveIndicator({ connection, heartbeat, lastMessageAt }, now = Date.now(), pollMs = 60_000) {
  const every = `${Math.round(pollMs / 1000)}s`;
  const silentFor = lastMessageAt ? now - lastMessageAt : null;
  if (connection === "open" && heartbeat && silentFor != null && silentFor < STALL_MS) {
    const sec = heartbeat.sec || {};
    if (sec.state === "throttled") return { dot: "it-dot-warn", text: "Live · SEC rate limit — paused" };
    if (sec.state === "initial_sync") return { dot: "it-dot-sync", text: `Live · syncing SEC filings${sec.queueLength ? ` · ${sec.queueLength.toLocaleString("en-US")} queued` : ""}` };
    if (sec.state === "stale") return { dot: "it-dot-warn", text: "Live · SEC poll delayed" };
    if (sec.state === "error") return { dot: "it-dot-err", text: "Live · SEC poll error, retrying" };
    if (sec.queueLength > 0) return { dot: "it-dot-sync", text: `Live · ${sec.queueLength.toLocaleString("en-US")} filings downloading` };
    return { dot: "it-dot-live", text: "Live · SEC EDGAR" };
  }
  if (connection === "open") return { dot: "it-dot-live", text: "Live" };
  if (connection === "connecting") return null; // nothing known yet
  if (connection === "reconnecting") return { dot: "it-dot-warn", text: `Reconnecting live updates · polling every ${every}` };
  if (connection === "unavailable" || connection === "unsupported") return { dot: "it-dot-warn", text: `Polling every ${every} · live updates unavailable` };
  return null;
}
