// PRIMARY METRIC rows (SEC signal published → NOW) for a finished backtest run.
// Polls every POLL_MS; the server caches start prices permanently and quotes per
// symbol within the Tiingo budget, so polling never exceeds the plan's limits.
import { useEffect, useState } from "react";
import api from "../lib/api";

const POLL_MS = 60_000;

export default function usePublicationNow(jobId) {
  const [state, setState] = useState({ jobId, data: null, loading: !!jobId, error: null, updatedAt: null });
  useEffect(() => {
    if (!jobId) return undefined;
    let alive = true;
    const load = () => api.get(`/insider/backtest/run/${encodeURIComponent(jobId)}/publication-now`)
      .then(({ data }) => { if (alive) setState({ jobId, data, loading: false, error: null, updatedAt: Date.now() }); })
      .catch((err) => { if (alive) setState((s) => ({ ...s, jobId, loading: false, error: err.response?.data?.error || "Could not load SEC publication → now." })); });
    load();
    const timer = setInterval(load, POLL_MS);
    return () => { alive = false; clearInterval(timer); };
  }, [jobId]);
  return state.jobId === jobId ? state : { jobId, data: null, loading: !!jobId, error: null, updatedAt: null };
}
