// Insider Tracker — company intelligence (GET /api/insider/company/:ticker/insights).
// One request per (ticker, window, threshold); refetched when the published
// snapshot version changes (live updates), at most once per MIN_REFETCH_MS for
// the same query. Previous data stays on screen while refreshing.
import { useEffect, useRef, useState } from "react";
import api from "../lib/api";

const MIN_REFETCH_MS = 10_000;

export default function useCompanyInsights(ticker, { days = 30, threshold = 3 } = {}, dataVersion = null) {
  const key = ticker ? `${ticker}|${days}|${threshold}` : "";
  const [state, setState] = useState({ key: "", data: null, loading: !!ticker, error: null, status: null });
  const runId = useRef(0);
  const lastFetch = useRef({ key: "", at: 0 });

  useEffect(() => {
    if (!ticker) return undefined;
    const id = ++runId.current;
    const sameQuery = lastFetch.current.key === key;
    const wait = sameQuery ? Math.max(0, lastFetch.current.at + MIN_REFETCH_MS - Date.now()) : 0;
    setState((s) => (s.key === key ? { ...s, loading: true } : { key, data: null, loading: true, error: null, status: null }));
    const timer = setTimeout(async () => {
      lastFetch.current = { key, at: Date.now() };
      try {
        const { data } = await api.get(`/insider/company/${encodeURIComponent(ticker)}/insights`, { params: { days, threshold } });
        if (id !== runId.current) return;
        setState({ key, data, loading: false, error: null, status: 200 });
      } catch (err) {
        if (id !== runId.current) return;
        const status = err.response?.status ?? null;
        setState((s) => ({ ...s, key, loading: false, status, error: err.response?.data?.error || "Could not load company insider statistics." }));
      }
    }, wait);
    return () => clearTimeout(timer);
  }, [key, ticker, days, threshold, dataVersion]);

  return state.key === key ? state : { key, data: null, loading: !!ticker, error: null, status: null };
}
