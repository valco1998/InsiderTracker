// Insider Tracker account data: server capabilities, follows and alerts.
// Uses the shared axios client (lib/api.js) — token handling stays in lib/storage.js.
import { useCallback, useEffect, useMemo, useState } from "react";
import api from "../lib/api";
import useAuth from "./useAuth";
import useSocketEvent from "./useSocketEvent";

const errorOf = (err, fallback) => err?.response?.data?.error || fallback;

export default function useInsiderAccount() {
  const { isAuthed, user } = useAuth();
  const [health, setHealth] = useState(null);
  const [watches, setWatches] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState(null);

  useEffect(() => {
    let off = false;
    api.get("/health").then((r) => { if (!off) setHealth(r.data); }).catch(() => { if (!off) setHealth({ accounts: false, push: false }); });
    return () => { off = true; };
  }, []);

  const accountsAvailable = !!health?.accounts;
  const ready = isAuthed && accountsAvailable;

  const refresh = useCallback(async () => {
    if (!ready) { setWatches([]); setAlerts([]); setUnread(0); return; }
    try {
      const [w, a] = await Promise.all([api.get("/insider/watches"), api.get("/insider/alerts")]);
      setWatches(w.data.watches || []);
      setAlerts(a.data.alerts || []);
      setUnread(a.data.unread || 0);
      setError(null);
    } catch (err) {
      setError(errorOf(err, "Could not load your follows and alerts."));
    }
  }, [ready]);

  useEffect(() => { refresh(); }, [refresh]);

  // Realtime: the server emits `insider:alert` to the signed-in user's room.
  const onAlert = useCallback(() => { refresh(); }, [refresh]);
  useSocketEvent("insider:alert", onAlert);

  const watchByCik = useMemo(() => new Map(watches.map((w) => [w.cik, w])), [watches]);
  const isFollowing = useCallback((cik) => !!cik && watchByCik.has(String(Number(cik)).padStart(10, "0")), [watchByCik]);

  const follow = useCallback(async (ticker, types = "both") => {
    try {
      await api.post("/insider/watches", { ticker, types });
      await refresh();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: errorOf(err, "Could not follow this company.") };
    }
  }, [refresh]);

  const updateWatch = useCallback(async (id, patch) => {
    try { await api.patch(`/insider/watches/${id}`, patch); await refresh(); return { ok: true }; }
    catch (err) { return { ok: false, error: errorOf(err, "Could not update.") }; }
  }, [refresh]);

  const unfollow = useCallback(async (id) => {
    try { await api.delete(`/insider/watches/${id}`); await refresh(); return { ok: true }; }
    catch (err) { return { ok: false, error: errorOf(err, "Could not unfollow.") }; }
  }, [refresh]);

  const markRead = useCallback(async (id) => {
    try { await (id ? api.patch(`/insider/alerts/${id}/read`) : api.patch("/insider/alerts/read-all")); await refresh(); }
    catch { /* non-critical */ }
  }, [refresh]);

  return {
    health, accountsAvailable, ready, user,
    watches, alerts, unread, error,
    isFollowing, follow, updateWatch, unfollow, markRead, refresh,
  };
}
