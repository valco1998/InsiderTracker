// Insider Tracker — paginated transaction feed (GET /api/insider/transactions),
// kept current by the Phase D3 snapshot stream.
//
// The stream connection is NOT owned here: InsiderContext creates the single
// shared connection (hooks/useInsiderStream.js → utils/insiderLiveStream.js)
// and passes it in as `live`. This hook only reacts to it:
//   • snapshot version DIFFERENT from the version on screen → refresh
//     (different, not greater: a restarted server can count from lower);
//   • stream re-opened after a drop → one revalidation (covers anything the
//     server could not tell us, e.g. a restart that reused our version number);
//   • stream not open (connecting / reconnecting / unavailable / unsupported)
//     → the original interval polling (60 s, 8 s while SEC backlog loads);
//   • tab hidden → nothing is fetched; one refresh on return if data changed.
//
// Refresh = re-fetch the rows currently shown (same filters, same depth, up to
// MAX_REFRESH_ROWS) and reconcile them (utils/insiderLiveMerge.js) so unchanged
// rows keep their objects. While the reader is scrolled into older rows the
// list is NOT replaced: a small first-page check counts new rows → `pending`
// ("New filings available"); KPIs, charts and status still update.
//
// HTTP revalidation: the server sends a weak ETag + Cache-Control: no-cache; the
// browser HTTP cache adds If-None-Match itself and serves 304s transparently.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import api from "../lib/api";
import { appendUnique, createRefreshScheduler, newRowIds, reconcileRows, versionChanged } from "../utils/insiderLiveMerge";

export const REFRESH_MS = 60_000;
export const BACKLOG_REFRESH_MS = 8_000;
export const PAGE_SIZE = 100;
const MAX_PAGE = 1000;           // server limit per request
const MAX_REFRESH_ROWS = 3000;   // deepest window re-fetched on refresh
const NEW_HIGHLIGHT_MS = 6_000;

// First `count` rows of a query (≤ MAX_REFRESH_ROWS), pages of ≤ 1000, id de-duped.
async function fetchWindow(params, count) {
  const want = Math.min(Math.max(count, PAGE_SIZE), MAX_REFRESH_ROWS);
  const { data: first } = await api.get("/insider/transactions", { params: { ...params, limit: Math.min(want, MAX_PAGE) } });
  let list = first.transactions || [];
  let cursor = first.nextCursor ?? null;
  while (list.length < want && cursor) {
    const { data } = await api.get("/insider/transactions", { params: { ...params, limit: Math.min(want - list.length, MAX_PAGE), cursor } });
    const more = appendUnique(list, data.transactions || []);
    cursor = more === list && (data.transactions || []).length ? null : data.nextCursor ?? null; // guard against a stuck cursor
    list = more;
  }
  return { ...first, transactions: list, nextCursor: cursor };
}

// D3 servers report snapshotVersion; older servers only status.dataVersion (same counter).
const versionOf = (data) => data?.snapshotVersion ?? data?.status?.dataVersion ?? null;

const noStore = { subscribe: () => () => {}, get: () => "unsupported" };

export default function useInsiderFeed(params, { live = null } = {}) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [totals, setTotals] = useState(null);
  const [status, setStatus] = useState(null);
  const [version, setVersion] = useState(null); // snapshot version of the latest response (KPIs, charts)
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [nextCursor, setNextCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [newIds, setNewIds] = useState(() => new Set());
  const [pending, setPending] = useState(null); // { count, capped } new rows held back while reading
  const [lastOkAt, setLastOkAt] = useState(null);

  const key = useMemo(() => JSON.stringify(params), [params]);
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const keyRef = useRef(key);
  keyRef.current = key;

  const reqId = useRef(0);            // list loads (load / loadMore supersede guard)
  const checkId = useRef(0);          // background "are there new rows?" checks
  const loadedRef = useRef(PAGE_SIZE);
  const shownRef = useRef({ key: null, rows: [] }); // rows on screen for the current query
  const servedVersion = useRef(null); // version of the rows on screen
  const metaRef = useRef({ key: null, version: null }); // version the KPIs/totals reflect
  const checkedVersion = useRef(null); // version already checked while reading
  const readingRef = useRef(false);
  const staleRef = useRef(false);     // rows on screen are older than the latest data
  const pendingRef = useRef(null);
  pendingRef.current = pending;
  const loadBusy = useRef(false);
  const wantVersion = useRef(null);   // version announced while a load was in flight
  const followed = useRef(null);      // version a follow-up was already issued for
  const dirtyWhileHidden = useRef(false);

  const applyMeta = useCallback((data, k) => {
    const v = versionOf(data);
    const m = metaRef.current;
    // Totals depend only on (snapshot, query): skip identical ones to spare re-renders.
    if (!(m.key === k && m.version != null && m.version === v)) {
      setTotal(data.total || 0);
      setTotals(data.totals || null);
      metaRef.current = { key: k, version: v };
    }
    setVersion(v);
    setStatus(data.status || null);
    setError(null);
    setLastOkAt(new Date().toISOString());
  }, []);

  const schedulerRef = useRef(null);

  // Full (re)load of the visible window for the current query.
  const load = useCallback(async () => {
    const id = ++reqId.current;
    const k = keyRef.current;
    loadBusy.current = true;
    wantVersion.current = null; // only versions announced DURING this load count
    setLoading(true);
    try {
      const data = await fetchWindow(paramsRef.current, loadedRef.current);
      if (id !== reqId.current) return; // superseded by a newer load / filter change
      const list = data.transactions || [];
      const prev = shownRef.current;
      const sameQuery = prev.key === k;
      const next = sameQuery ? reconcileRows(prev.rows, list) : list;
      const fresh = sameQuery && prev.rows.length ? newRowIds(prev.rows, next) : [];
      if (fresh.length) setNewIds(new Set(fresh));
      else if (!sameQuery) setNewIds(new Set());
      shownRef.current = { key: k, rows: next };
      servedVersion.current = versionOf(data);
      checkedVersion.current = null;
      staleRef.current = false;
      setRows(next); // same array when nothing changed → no re-render
      setNextCursor(data.nextCursor ?? null);
      setPending(null);
      applyMeta(data, k);
    } catch (err) {
      if (id !== reqId.current) return;
      setError(err.response?.data?.error || "Could not reach the Insider Tracker API.");
    } finally {
      if (id === reqId.current) { setLoading(false); loadBusy.current = false; }
    }
    // A version announced during this load that it did not serve → exactly one follow-up.
    // Consumed here: a stale value would compare as "different" and refresh needlessly.
    if (id !== reqId.current) return;
    const w = wantVersion.current;
    wantVersion.current = null;
    if (w != null && versionChanged(w, servedVersion.current) && followed.current !== w) {
      followed.current = w;
      schedulerRef.current?.trigger();
    }
  }, [applyMeta]);

  // Reader is in older rows: keep the list, count new rows on the first page.
  const check = useCallback(async () => {
    const id = ++checkId.current;
    const k = keyRef.current;
    try {
      const { data } = await api.get("/insider/transactions", { params: { ...paramsRef.current, limit: PAGE_SIZE } });
      if (id !== checkId.current || k !== keyRef.current) return;
      const fresh = newRowIds(shownRef.current.rows, data.transactions || []).length;
      const v = versionOf(data);
      checkedVersion.current = v;
      applyMeta(data, k); // KPIs / charts / status follow the new snapshot now
      if (versionChanged(v, servedVersion.current)) staleRef.current = true; // older rows may have changed too
      setPending(fresh > 0 ? { count: fresh, capped: fresh >= PAGE_SIZE } : null);
    } catch { /* next event or poll retries */ }
  }, [applyMeta]);

  // One refresh at a time; bursts of versions collapse into one trailing refresh.
  useEffect(() => {
    const s = createRefreshScheduler(async () => {
      if (typeof document !== "undefined" && document.hidden) { dirtyWhileHidden.current = true; return; }
      const shown = shownRef.current;
      if (readingRef.current && shown.key === keyRef.current && shown.rows.length) await check();
      else await load();
    });
    schedulerRef.current = s;
    return () => { s.stop(); if (schedulerRef.current === s) schedulerRef.current = null; };
  }, [load, check]);
  const trigger = useCallback(() => schedulerRef.current?.trigger(), []);

  // Filter change → first page, immediately (not throttled).
  useEffect(() => {
    loadedRef.current = PAGE_SIZE;
    setPending(null);
    checkedVersion.current = null;
    load();
  }, [key, load]);

  // Snapshot events from the shared stream.
  useEffect(() => {
    if (!live) return undefined;
    return live.onSnapshot((info) => {
      const v = info?.version;
      if (loadBusy.current) { wantVersion.current = v; return; } // the running load decides
      if (versionChanged(v, servedVersion.current) && v !== checkedVersion.current) trigger();
    });
  }, [live, trigger]);

  // Connection state (re-renders this hook only when it changes).
  const connection = useSyncExternalStore(
    live ? live.subscribe : noStore.subscribe,
    live ? () => live.getState().connection : noStore.get,
  );
  const prevConnection = useRef(connection);
  useEffect(() => {
    const was = prevConnection.current;
    prevConnection.current = connection;
    // Re-opened after a drop: revalidate once (cheap; ETag/version guard the rest).
    if (connection === "open" && (was === "reconnecting" || was === "unavailable")) trigger();
  }, [connection, trigger]);

  // Polling fallback while the stream is not open.
  const backlog = !!status && (status.processing || status.queueLength > 0);
  const pollMs = backlog ? BACKLOG_REFRESH_MS : REFRESH_MS;
  const polling = connection !== "open";
  useEffect(() => {
    if (!polling) return undefined;
    const timer = setInterval(trigger, pollMs);
    return () => clearInterval(timer);
  }, [polling, pollMs, trigger]);

  // Hidden tab: nothing fetched; refresh once on return if something changed meanwhile.
  useEffect(() => {
    const onVis = () => { if (!document.hidden && dirtyWhileHidden.current) { dirtyWhileHidden.current = false; trigger(); } };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [trigger]);

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
      const next = appendUnique(shownRef.current.rows, data.transactions || []);
      shownRef.current = { key: keyRef.current, rows: next };
      loadedRef.current = next.length;
      setRows(next);
      setNextCursor(data.nextCursor ?? null);
    } catch (err) {
      if (id === reqId.current) setError(err.response?.data?.error || "Could not load more transactions.");
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, loadingMore]);

  // UI reports whether the reader is in older rows (ref only — no re-render).
  const setReading = useCallback((reading) => {
    const was = readingRef.current;
    readingRef.current = reading;
    // Back at the top with new or changed rows waiting → show them.
    if (was && !reading && (pendingRef.current || staleRef.current)) load();
  }, [load]);

  const applyPending = useCallback(() => load(), [load]);

  return {
    rows, total, totals, status, version, loading, error, nextCursor, loadingMore,
    loadMore, reload: load, newIds, pending, applyPending, setReading, lastOkAt,
    connection, polling, pollMs,
  };
}
