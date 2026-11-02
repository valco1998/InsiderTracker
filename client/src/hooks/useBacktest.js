// Insider Tracker — historical backtest API (GET /insider/backtest/status,
// POST /insider/backtest/run, GET /insider/backtest/run/:id). A run is a server
// job; this hook polls its progress until it finishes. Nothing is shown as a
// result until the server returns one.
import { useCallback, useEffect, useRef, useState } from "react";
import api from "../lib/api";

const POLL_MS = 700;

export default function useBacktest(range) {
  const [status, setStatus] = useState({ data: null, loading: true, error: null });
  const [run, setRun] = useState({ jobId: null, state: "idle", progress: null, result: null, error: null });
  const timer = useRef(null);
  const alive = useRef(true);
  // Set on every mount: StrictMode (dev) mounts → unmounts → mounts again.
  useEffect(() => { alive.current = true; return () => { alive.current = false; clearTimeout(timer.current); }; }, []);

  const from = range?.from, to = range?.to;
  const loadStatus = useCallback(async () => {
    try {
      const { data } = await api.get("/insider/backtest/status", { params: from && to ? { from, to } : {} });
      if (alive.current) setStatus({ data, loading: false, error: null });
    } catch (err) {
      if (alive.current) setStatus((s) => ({ ...s, loading: false, error: err.response?.data?.error || "Could not load backtest data status." }));
    }
  }, [from, to]);
  useEffect(() => {
    const t = setTimeout(loadStatus, 300); // debounce date typing
    return () => clearTimeout(t);
  }, [loadStatus]);

  const poll = useCallback((jobId) => {
    timer.current = setTimeout(async () => {
      try {
        const { data } = await api.get(`/insider/backtest/run/${jobId}`);
        if (!alive.current) return;
        if (data.state === "running") { setRun((r) => ({ ...r, progress: data.progress })); poll(jobId); return; }
        setRun({ jobId, state: data.state, progress: data.progress, result: data.result, error: data.error });
      } catch (err) {
        if (alive.current) setRun((r) => ({ ...r, state: "error", error: err.response?.data?.error || "Lost contact with the backtest job." }));
      }
    }, POLL_MS);
  }, []);

  const start = useCallback(async (body) => {
    clearTimeout(timer.current);
    setRun({ jobId: null, state: "running", progress: { stage: "starting", done: 0, total: 0 }, result: null, error: null });
    try {
      const { data } = await api.post("/insider/backtest/run", body);
      if (!alive.current) return;
      setRun((r) => ({ ...r, jobId: data.jobId }));
      poll(data.jobId);
    } catch (err) {
      const jobId = err.response?.status === 409 ? err.response.data?.jobId : null;
      if (jobId) { setRun((r) => ({ ...r, jobId })); poll(jobId); return; } // attach to the run already in progress
      setRun({ jobId: null, state: "error", progress: null, result: null, error: err.response?.data?.error || "Could not start the backtest." });
    }
  }, [poll]);

  return { status, reloadStatus: loadStatus, run, start };
}
