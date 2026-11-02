// Insider Tracker — paginated transaction feed (GET /api/insider/transactions)
// driven by the Phase D3 snapshot stream (GET /api/insider/stream, SSE).
//
// Stream: one shared EventSource per page (ref-counted). `snapshot` events carry
// the published snapshot version; `heartbeat` events carry real SEC freshness.
// Events are STATE, not deltas (server/services/edgar/insiderStream.js), so a
// reconnect can never miss data — the server re-sends the current version.
//
// Feed: refreshes ONLY when a newer snapshot version than the one last served
// is announced. While the stream is not live (connecting, reconnecting, server
// without /stream, EventSource unsupported) it falls back to the previous
// interval polling. Nothing is fetched while the tab is hidden.
//
// Kept from the original dashboard: request-id supersede guard, refresh
// re-fetches every row currently shown (same filters, same depth), cursor Load
// More with id de-dupe, `newIds` highlight. Added: when the user is reading
// older rows, a refresh only CHECKS for new rows (small first page) and exposes
// `pending` instead of replacing the list under them.
//
// HTTP revalidation: the server sends a weak ETag + Cache-Control: no-cache;
// the browser HTTP cache adds If-None-Match itself and serves 304s transparently.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import api from "../lib/api";
import { API_BASE } from "../lib/config";

const REFRESH_MS = 60_000;
const BACKLOG_REFRESH_MS = 8_000;
export const PAGE_SIZE = 100;
const MAX_PAGE = 1000;           // server limit per request
const MAX_REFRESH_ROWS = 3000;   // deepest window re-fetched on refresh
const NEW_HIGHLIGHT_MS = 6_000;
const MIN_REFRESH_GAP_MS = 1_500; // coalesce bursts of snapshot versions

// ── Shared snapshot stream ───────────────────────────────────────────────────
const STREAM_URL = `${API_BASE}/insider/stream`;
const WATCHDOG_MS = 75_000;      // > 2 heartbeats (25 s) + slack → reconnect
const RETRY_MIN_MS = 5_000;
const RETRY_MAX_MS = 300_000;

// mode: connecting | live | reconnecting | fallback | paused | unsupported
let streamState = {
  mode: typeof window !== "undefined" && "EventSource" in window ? "connecting" : "unsupported",
  version: null, publishedAt: null, newestAcceptedAt: null, total: null,
  sec: null, lastMessageAt: null, lastHeartbeatAt: null, connectedAt: null, reconnects: 0, retryAt: null,
};
const statusListeners = new Set();
const snapshotListeners = new Set();
let es = null, refs = 0, retryTimer = null, watchdog = null, failures = 0;

function setStream(patch) {
  streamState = { ...streamState, ...patch };
  statusListeners.forEach((l) => l());
}

function armWatchdog() {
  clearTimeout(watchdog);
  watchdog = setTimeout(() => { // silent connection (proxy, sleep): reopen
    closeES();
    setStream({ mode: "reconnecting" });
    scheduleRetry(0);
  }, WATCHDOG_MS);
}

function closeES() {
  clearTimeout(watchdog);
  if (es) { es.onopen = es.onerror = null; es.close(); es = null; }
}

function scheduleRetry(delay) {
  clearTimeout(retryTimer);
  setStream({ retryAt: new Date(Date.now() + delay).toISOString() });
  retryTimer = setTimeout(openES, delay);
}

function openES() {
  clearTimeout(retryTimer);
  if (!refs || streamState.mode === "unsupported" || es) return;
  if (typeof document !== "undefined" && document.hidden) { setStream({ mode: "paused" }); return; }
  // Server skips the connect-time event when we already hold its current version.
  const url = streamState.version != null ? `${STREAM_URL}?lastEventId=${encodeURIComponent(streamState.version)}` : STREAM_URL;
  const src = new EventSource(url);
  es = src;
  if (streamState.mode !== "live") setStream({ mode: streamState.version == null && !failures ? "connecting" : "reconnecting" });

  src.onopen = () => {
    failures = 0;
    setStream({ mode: "live", connectedAt: new Date().toISOString(), retryAt: null, lastMessageAt: new Date().toISOString() });
    armWatchdog();
  };
  src.onerror = () => {
    if (src.readyState === EventSource.CONNECTING) { // browser auto-reconnect (server `retry:`)
      setStream({ mode: "reconnecting", reconnects: streamState.reconnects + 1 });
      return;
    }
    // CLOSED: non-200 (e.g. 404 on a server without D3, 429/503 caps) — we retry with backoff and poll meanwhile.
    closeES();
    failures++;
    setStream({ mode: "fallback", reconnects: streamState.reconnects + 1 });
    scheduleRetry(Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** Math.min(failures, 6)));
  };
  src.addEventListener("snapshot", (e) => {
    let info;
    try { info = JSON.parse(e.data); } catch { return; }
    if (!Number.isFinite(info?.version)) return;
    const now = new Date().toISOString();
    armWatchdog();
    if (streamState.version != null && info.version <= streamState.version) { setStream({ lastMessageAt: now }); return; }
    setStream({ version: info.version, publishedAt: info.publishedAt ?? null, newestAcceptedAt: info.newestAcceptedAt ?? null, total: info.total ?? null, lastMessageAt: now, mode: "live" });
    snapshotListeners.forEach((l) => l(info));
  });
  src.addEventListener("heartbeat", (e) => {
    let hb;
    try { hb = JSON.parse(e.data); } catch { return; }
    armWatchdog();
    const now = new Date().toISOString();
    setStream({ sec: hb.sec ?? null, lastHeartbeatAt: now, lastMessageAt: now, mode: "live" });
    // A heartbeat can reveal a version we never saw (e.g. event dropped by a proxy).
    if (Number.isFinite(hb.version) && (streamState.version == null || hb.version > streamState.version)) {
      setStream({ version: hb.version });
      snapshotListeners.forEach((l) => l({ version: hb.version }));
    }
  });
}

function onVisibility() {
  if (document.hidden) { closeES(); clearTimeout(retryTimer); setStream({ mode: "paused" }); }
  else if (refs && !es) { failures = 0; openES(); }
}

function acquireStream() {
  if (++refs === 1 && streamState.mode !== "unsupported") {
    document.addEventListener("visibilitychange", onVisibility);
    openES();
  }
  return () => {
    if (--refs > 0) return;
    document.removeEventListener("visibilitychange", onVisibility);
    closeES();
    clearTimeout(retryTimer);
    if (streamState.mode !== "unsupported") setStream({ mode: "connecting" });
  };
}

const subscribeStatus = (l) => { statusListeners.add(l); return () => statusListeners.delete(l); };
const getStatus = () => streamState;
const getMode = () => streamState.mode;

// Full stream status — re-renders on every heartbeat; use only in small components.
export function useInsiderStreamStatus() {
  return useSyncExternalStore(subscribeStatus, getStatus, getStatus);
}

// ── Fetch helpers ────────────────────────────────────────────────────────────
// First `count` rows of a query (≤ MAX_REFRESH_ROWS), in pages of ≤ 1000, id de-duped.
async function fetchWindow(params, count) {
  const want = Math.min(Math.max(count, PAGE_SIZE), MAX_REFRESH_ROWS);
  const { data: first } = await api.get("/insider/transactions", { params: { ...params, limit: Math.min(want, MAX_PAGE) } });
  let list = first.transactions || [];
  let cursor = first.nextCursor ?? null;
  if (list.length < want && cursor) {
    const seen = new Set(list.map((t) => t.id));
    list = [...list];
    while (list.length < want && cursor) {
      const { data } = await api.get("/insider/transactions", { params: { ...params, limit: Math.min(want - list.length, MAX_PAGE), cursor } });
      for (const t of data.transactions || []) if (!seen.has(t.id)) { seen.add(t.id); list.push(t); }
      cursor = data.nextCursor ?? null;
    }
  }
  return { ...first, transactions: list, nextCursor: cursor };
}

const versionOf = (data) => data.snapshotVersion ?? data.status?.dataVersion ?? null;

// ── Hook ─────────────────────────────────────────────────────────────────────
export default function useInsiderFeed(params, { poll = true } = {}) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [totals, setTotals] = useState(null);
  const [status, setStatus] = useState(null);
  const [snapshotVersion, setSnapshotVersion] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [nextCursor, setNextCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [newIds, setNewIds] = useState(() => new Set());
  const [pending, setPending] = useState(null); // { count, capped } new rows held back while reading
  const [lastOkAt, setLastOkAt] = useState(null);

  const key = useMemo(() => JSON.stringify(params), [params]);
  const reqId = useRef(0);          // list loads (load / loadMore supersede guard)
  const checkId = useRef(0);        // background "are there new rows?" checks
  const loadedRef = useRef(PAGE_SIZE);
  const rowsRef = useRef({ key: null, ids: null }); // ids shown for the current query
  const servedVersion = useRef(null); // snapshot version of the rows on screen
  const knownVersion = useRef(null);  // newest version seen in any response
  const readingRef = useRef(false);   // user is scrolled into older rows
  const staleRef = useRef(false);     // a newer snapshot exists than the rows on screen
  const pendingRef = useRef(null);
  const loadBusy = useRef(false);     // a list load is in flight
  const wantVersion = useRef(null);   // newest version announced by the stream
  const followed = useRef(null);      // version a follow-up refresh was already issued for
  const inFlight = useRef(false);
  const queued = useRef(false);
  const lastRefreshAt = useRef(0);
  const gapTimer = useRef(null);
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const keyRef = useRef(key);
  keyRef.current = key;

  const applyMeta = useCallback((data) => {
    setTotal(data.total || 0);
    setTotals(data.totals || null);
    setStatus(data.status || null);
    const v = versionOf(data);
    if (v != null && (knownVersion.current == null || v >= knownVersion.current)) { knownVersion.current = v; setSnapshotVersion(v); }
    setError(null);
    setLastOkAt(new Date().toISOString());
  }, []);

  // Full (re)load of the visible window for the current query.
  const load = useCallback(async () => {
    const id = ++reqId.current;
    const k = keyRef.current;
    loadBusy.current = true;
    setLoading(true);
    try {
      const data = await fetchWindow(paramsRef.current, loadedRef.current);
      if (id !== reqId.current) return; // a newer request superseded this one
      const list = data.transactions || [];
      // Highlight only rows new to this same query (never on filter change / first load).
      const prev = rowsRef.current;
      if (prev.key === k && prev.ids) {
        const fresh = list.filter((t) => !prev.ids.has(t.id)).map((t) => t.id);
        setNewIds(fresh.length ? new Set(fresh) : new Set());
      } else {
        setNewIds(new Set());
      }
      rowsRef.current = { key: k, ids: new Set(list.map((t) => t.id)) };
      servedVersion.current = versionOf(data);
      staleRef.current = false;
      setRows(list);
      setNextCursor(data.nextCursor ?? null);
      setPending(null);
      applyMeta(data);
    } catch (err) {
      if (id !== reqId.current) return;
      setError(err.response?.data?.error || "Could not reach the Insider Tracker API.");
    } finally {
      if (id === reqId.current) { setLoading(false); loadBusy.current = false; }
    }
    // A version announced while this load was in flight and newer than what it served → one follow-up.
    const w = wantVersion.current;
    if (id === reqId.current && w != null && w > (servedVersion.current ?? -1) && followed.current !== w) {
      followed.current = w;
      refreshRef.current?.();
    }
  }, [applyMeta]);

  // Reader is in older rows: keep the list, count what is new on the first page.
  const check = useCallback(async () => {
    const id = ++checkId.current;
    const k = keyRef.current;
    try {
      const { data } = await api.get("/insider/transactions", { params: { ...paramsRef.current, limit: PAGE_SIZE } });
      if (id !== checkId.current || k !== keyRef.current) return;
      const shown = rowsRef.current.ids || new Set();
      const fresh = (data.transactions || []).filter((t) => !shown.has(t.id)).length;
      applyMeta(data); // KPIs / charts / status follow the new snapshot immediately
      // Existing rows may have changed too (e.g. superseded by a 4/A): reload on return to the top.
      if ((versionOf(data) ?? -1) > (servedVersion.current ?? -1)) staleRef.current = true;
      setPending(fresh > 0 ? { count: fresh, capped: fresh >= PAGE_SIZE } : null);
    } catch { /* the next event or poll retries */ }
  }, [applyMeta]);

  // One refresh at a time; bursts of versions collapse into one trailing refresh.
  const refresh = useCallback(async () => {
    if (inFlight.current) { queued.current = true; return; }
    const wait = lastRefreshAt.current + MIN_REFRESH_GAP_MS - Date.now();
    if (wait > 0) { clearTimeout(gapTimer.current); gapTimer.current = setTimeout(refresh, wait); return; }
    inFlight.current = true;
    lastRefreshAt.current = Date.now();
    try {
      if (readingRef.current && rowsRef.current.key === keyRef.current && rowsRef.current.ids?.size) await check();
      else await load();
    } finally {
      inFlight.current = false;
      if (queued.current) { queued.current = false; refresh(); }
    }
  }, [load, check]);
  const refreshRef = useRef(null);
  refreshRef.current = refresh;

  // Filter change → first page, immediately.
  useEffect(() => {
    loadedRef.current = PAGE_SIZE;
    setPending(null);
    load();
  }, [key, load]);

  // Live stream → refresh only for a version newer than what is on screen.
  useEffect(() => {
    if (!poll) return undefined;
    const release = acquireStream();
    const onSnapshot = (info) => {
      wantVersion.current = Math.max(wantVersion.current ?? -1, info.version);
      if (loadBusy.current) return; // the running load decides whether a follow-up is needed
      const have = Math.max(servedVersion.current ?? -1, knownVersion.current ?? -1);
      if (info.version > have) refresh();
    };
    snapshotListeners.add(onSnapshot);
    return () => { snapshotListeners.delete(onSnapshot); release(); clearTimeout(gapTimer.current); };
  }, [poll, refresh]);

  // Polling fallback while the stream is not live (re-renders only on mode change).
  const mode = useSyncExternalStore(subscribeStatus, getMode, getMode);
  const backlog = !!status && (status.processing || status.queueLength > 0);
  useEffect(() => {
    if (!poll || mode === "live" || mode === "paused") return undefined;
    const tick = () => { if (!document.hidden) refresh(); };
    const timer = setInterval(tick, backlog ? BACKLOG_REFRESH_MS : REFRESH_MS);
    return () => clearInterval(timer);
  }, [poll, mode, backlog, refresh]);

  // New-row highlight fades out on its own.
  useEffect(() => {
    if (!newIds.size) return undefined;
    const t = setTimeout(() => setNewIds(new Set()), NEW_HIGHLIGHT_MS);
    return () => clearTimeout(t);
  }, [newIds]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    const id = reqId.current; // a refresh or filter change after this point supersedes this page
    setLoadingMore(true);
    try {
      const { data } = await api.get("/insider/transactions", { params: { ...paramsRef.current, limit: PAGE_SIZE, cursor: nextCursor } });
      if (id !== reqId.current) return;
      setRows((prev) => {
        const seen = new Set(prev.map((r) => r.id)); // row ids are unique; economicId is not
        const next = [...prev, ...(data.transactions || []).filter((t) => !seen.has(t.id))];
        loadedRef.current = next.length;
        rowsRef.current = { key: keyRef.current, ids: new Set(next.map((t) => t.id)) };
        return next;
      });
      setNextCursor(data.nextCursor ?? null);
    } catch (err) {
      if (id === reqId.current) setError(err.response?.data?.error || "Could not load more transactions.");
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, loadingMore]);

  // UI reports whether the reader is in older rows (ref only — no re-render).
  pendingRef.current = pending;
  const setReading = useCallback((reading) => {
    const was = readingRef.current;
    readingRef.current = reading;
    // Back at the top with new or changed rows waiting → show them.
    if (was && !reading && (pendingRef.current || staleRef.current)) load();
  }, [load]);

  const applyPending = useCallback(() => load(), [load]);

  return {
    rows, total, totals, status, snapshotVersion, loading, error, nextCursor, loadingMore,
    loadMore, reload: load, newIds, pending, applyPending, setReading, lastOkAt,
  };
}
