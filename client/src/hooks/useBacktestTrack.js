// Insider purchase tracking timeline for one signal of a finished backtest run
// (GET /insider/backtest/run/:jobId/track/:signalId). Nothing is shown until the
// server returns real data.
import { useEffect, useState } from "react";
import api from "../lib/api";

export default function useBacktestTrack(jobId, signalId) {
  const key = jobId && signalId ? `${jobId}|${signalId}` : "";
  const [state, setState] = useState({ key: "", data: null, loading: false, error: null });
  useEffect(() => {
    if (!key) return undefined;
    let alive = true;
    setState({ key, data: null, loading: true, error: null });
    api.get(`/insider/backtest/run/${encodeURIComponent(jobId)}/track/${encodeURIComponent(signalId)}`)
      .then(({ data }) => { if (alive) setState({ key, data, loading: false, error: null }); })
      .catch((err) => { if (alive) setState({ key, data: null, loading: false, error: err.response?.data?.error || "Could not load the tracking timeline." }); });
    return () => { alive = false; };
  }, [key, jobId, signalId]);
  return state.key === key ? state : { key, data: null, loading: !!key, error: null };
}
