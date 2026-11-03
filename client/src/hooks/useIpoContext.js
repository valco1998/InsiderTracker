// INFORMATIONAL IPO-allocation classification for a finished backtest run
// (GET /api/insider/backtest/run/:id/ipo-context — public SEC filings only).
// Loaded once per run; an "unknown" result (SEC lookup failed) is retried once later.
import { useEffect, useState } from "react";
import api from "../lib/api";

const RETRY_MS = 5 * 60_000;

export default function useIpoContext(jobId) {
  const [state, setState] = useState({ jobId, data: null, error: null });
  useEffect(() => {
    if (!jobId) return undefined;
    let alive = true, timer = null;
    const load = (retry) => api.get(`/insider/backtest/run/${encodeURIComponent(jobId)}/ipo-context`)
      .then(({ data }) => {
        if (!alive) return;
        setState({ jobId, data, error: null });
        if (retry && Object.values(data?.signals || {}).some((c) => c.status === "unknown")) timer = setTimeout(() => load(false), RETRY_MS);
      })
      .catch((err) => { if (alive) setState({ jobId, data: null, error: err.response?.data?.error || "Could not classify IPO-related purchases." }); });
    load(true);
    return () => { alive = false; clearTimeout(timer); };
  }, [jobId]);
  return state.jobId === jobId ? state : { jobId, data: null, error: null };
}
