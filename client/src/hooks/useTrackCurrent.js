// Headline of an open tracking panel: first-purchase-date close → current price.
// Polls GET /insider/backtest/run/:jobId/track/:signalId/current every POLL_MS
// while mounted; the server caches Tiingo quotes, so polling never exceeds the
// quote budget. Shows nothing until the server answers.
import { useEffect, useState } from "react";
import api from "../lib/api";

const POLL_MS = 60_000;

export default function useTrackCurrent(jobId, signalId, initial = null) {
  const key = jobId && signalId ? `${jobId}|${signalId}` : "";
  const [state, setState] = useState({ key, current: initial, updatedAt: initial ? Date.now() : null, error: null });
  useEffect(() => {
    if (!key) return undefined;
    let alive = true;
    const load = () => api.get(`/insider/backtest/run/${encodeURIComponent(jobId)}/track/${encodeURIComponent(signalId)}/current`)
      .then(({ data }) => { if (alive) setState({ key, current: data.current, updatedAt: Date.now(), error: null }); })
      .catch(() => { if (alive) setState((s) => ({ ...s, key, error: "Could not refresh the current price." })); });
    const timer = setInterval(load, POLL_MS);
    if (!initial) load();
    return () => { alive = false; clearInterval(timer); };
  }, [key, jobId, signalId, initial]);
  return state.key === key ? state : { key, current: initial, updatedAt: null, error: null };
}
