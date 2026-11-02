// Insider Tracker — Companies screener (GET /api/insider/companies).
// One request per query; refetched when the published snapshot version changes
// (live updates via the shared SSE/feed dataVersion), at most once per
// MIN_REFETCH_MS for the same query. Previous data stays on screen while refreshing.
import { useEffect, useRef, useState } from "react";
import api from "../lib/api";

const MIN_REFETCH_MS = 10_000;

export default function useCompanyScreener(params, dataVersion = null) {
  const key = params ? JSON.stringify(params) : "";
  const [state, setState] = useState({ key: "", data: null, loading: !!params, error: null });
  const runId = useRef(0);
  const lastFetch = useRef({ key: "", at: 0, version: null });

  useEffect(() => {
    if (!key) return undefined;
    const id = ++runId.current;
    const sameQuery = lastFetch.current.key === key;
    // Already showing this query at this snapshot version (e.g. the first live version arriving).
    if (sameQuery && dataVersion != null && lastFetch.current.version === dataVersion) {
      // (A query switched away from and back before its fetch fired: the shown data is this query's.)
      setState((s) => (s.loading ? { ...s, key, loading: false } : s));
      return undefined;
    }
    const wait = sameQuery ? Math.max(0, lastFetch.current.at + MIN_REFETCH_MS - Date.now()) : 0;
    // Keep the previous result visible (also across query changes) to avoid flashing.
    setState((s) => ({ ...s, key, loading: true, error: null }));
    const timer = setTimeout(async () => {
      lastFetch.current = { key, at: Date.now(), version: null };
      try {
        const { data } = await api.get("/insider/companies", { params: JSON.parse(key) });
        if (id !== runId.current) return;
        lastFetch.current = { ...lastFetch.current, version: data.snapshotVersion ?? null };
        setState({ key, data, loading: false, error: null });
      } catch (err) {
        if (id !== runId.current) return;
        setState((s) => ({ ...s, key, loading: false, error: err.response?.data?.error || "Could not load the companies screen." }));
      }
    }, wait);
    return () => clearTimeout(timer);
  }, [key, dataVersion]);

  return state;
}
