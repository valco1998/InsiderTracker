// Insider Tracker — full filtered dataset for charts / leaderboards.
// No aggregate endpoint exists, so this pages the existing cursor API
// (compact view, 1000 rows/page) up to ROW_CAP rows and marks the result
// `partial` beyond that. It never polls on its own: it refetches only when the
// query changes or the server's `dataVersion` (seen by the main feed's existing
// refresh) changes — and at most once per MIN_REFETCH_MS for the same query,
// except when the cached result is empty (utils/insiderAnalyticsCache.js).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import api from "../lib/api";
import { refetchDelay } from "../utils/insiderAnalyticsCache";

const PAGE = 1000;
export const ROW_CAP = 5000;
const CACHE_MAX = 8;

// key → { version, fetchedAt, rows, total, totals, partial }
const cache = new Map();
function remember(key, entry) {
  cache.delete(key);
  cache.set(key, entry);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

async function fetchAll(params, isCurrent) {
  const rows = [];
  let cursor = null, first = null;
  do {
    const { data } = await api.get("/insider/transactions", {
      params: { ...params, view: "compact", limit: PAGE, ...(cursor ? { cursor } : {}) },
    });
    if (!isCurrent()) return null;
    first ||= data;
    rows.push(...(data.transactions || []));
    cursor = data.nextCursor ?? null;
  } while (cursor && rows.length < ROW_CAP);
  return { rows, total: first.total || 0, totals: first.totals || null, partial: !!cursor };
}

// params: API filters (type/ticker/from/to/venue). dataVersion: from feed status.
export default function useInsiderAnalytics(params, dataVersion, { enabled = true } = {}) {
  const key = useMemo(() => JSON.stringify(params), [params]);
  const [state, setState] = useState(() => {
    const c = cache.get(key);
    return c ? { ...c, key, loading: false, error: null } : { key, rows: [], total: 0, totals: null, partial: false, loading: true, error: null };
  });
  const runId = useRef(0);
  const [retryNonce, setRetryNonce] = useState(0); // bumped by retry(): refetch now, bypassing the throttle
  const force = useRef(false);

  useEffect(() => {
    if (!enabled || dataVersion == null) return undefined;
    const id = ++runId.current;
    const isCurrent = () => id === runId.current;
    const cached = cache.get(key);

    // Show what we have for this query immediately (stale-while-revalidate).
    if (cached) setState((s) => (s.key === key && s.rows === cached.rows ? s : { ...cached, key, loading: false, error: null }));
    else setState((s) => (s.key === key ? { ...s, loading: true } : { key, rows: [], total: 0, totals: null, partial: false, loading: true, error: null }));

    const wait = force.current ? 0 : refetchDelay(cached, dataVersion);
    force.current = false;
    if (wait == null) return undefined;

    const run = async () => {
      if (!isCurrent()) return;
      setState((s) => ({ ...s, loading: true }));
      try {
        const r = await fetchAll(JSON.parse(key), isCurrent);
        if (!r || !isCurrent()) return;
        const entry = { ...r, version: dataVersion, fetchedAt: Date.now() };
        remember(key, entry);
        setState({ ...entry, key, loading: false, error: null });
      } catch (err) {
        if (!isCurrent()) return;
        setState((s) => ({ ...s, loading: false, error: err.response?.data?.error || "Could not load analytics data." }));
      }
    };

    // Throttled per query while data keeps changing — never when the cache is empty (see refetchDelay).
    const timer = setTimeout(run, wait);
    return () => { clearTimeout(timer); };
  }, [key, dataVersion, enabled, retryNonce]);

  // Immediate refetch of the current query (error-state Retry); runs once enabled with a known version.
  const retry = useCallback(() => { force.current = true; setRetryNonce((n) => n + 1); }, []);
  const current = state.key === key ? state : null;
  return useMemo(
    () => ({ ...(current || { key, rows: [], total: 0, totals: null, partial: false, loading: true, error: null }), retry }),
    [current, key, retry],
  );
}
