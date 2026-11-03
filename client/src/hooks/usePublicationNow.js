// SEC Publication → NOW rows for a finished backtest run.
// The server answers from cached prices immediately and prices missing entries in a
// background queue; while that queue is working (pricing.pendingRows > 0) this hook
// polls every FAST_MS so values appear progressively, otherwise every POLL_MS.
// A poll never starts before the previous one has returned (no overlapping requests).
import { useEffect, useState } from "react";
import api from "../lib/api";

const POLL_MS = 60_000;
const FAST_MS = 4_000;

export const pricingPending = (data) => {
  const p = data?.pricing;
  return !!p && (p.pendingRows > 0 || p.queued > 0 || p.inFlight > 0);
};

export default function usePublicationNow(jobId) {
  const [state, setState] = useState({ jobId, data: null, loading: !!jobId, error: null, updatedAt: null });
  useEffect(() => {
    if (!jobId) return undefined;
    let alive = true, timer = null;
    const load = () => api.get(`/insider/backtest/run/${encodeURIComponent(jobId)}/publication-now`)
      .then(({ data }) => {
        if (!alive) return;
        setState({ jobId, data, loading: false, error: null, updatedAt: Date.now() });
        timer = setTimeout(load, pricingPending(data) ? FAST_MS : POLL_MS);
      })
      .catch((err) => {
        if (!alive) return;
        setState((s) => ({ ...s, jobId, loading: false, error: err.response?.data?.error || "Could not load SEC publication → now." }));
        timer = setTimeout(load, POLL_MS);
      });
    load();
    return () => { alive = false; clearTimeout(timer); };
  }, [jobId]);
  return state.jobId === jobId ? state : { jobId, data: null, loading: !!jobId, error: null, updatedAt: null };
}
