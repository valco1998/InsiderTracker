// Saved Backtesting strategies of the signed-in user (/api/insider/strategies).
// Only active when signed in — Backtesting itself never requires an account.
import { useCallback, useEffect, useState } from "react";
import api from "../lib/api";

export default function useSavedStrategies(enabled) {
  const [s, setS] = useState({ list: [], loading: false, error: null });
  const load = useCallback(async () => {
    if (!enabled) { setS({ list: [], loading: false, error: null }); return; }
    setS((x) => ({ ...x, loading: true, error: null }));
    try { const { data } = await api.get("/insider/strategies"); setS({ list: data.strategies || [], loading: false, error: null }); }
    catch (err) { setS((x) => ({ ...x, loading: false, error: err.response?.data?.error || "Could not load saved strategies." })); }
  }, [enabled]);
  useEffect(() => { load(); }, [load]);

  const save = useCallback(async (name, params) => {
    const { data } = await api.post("/insider/strategies", { name, params });
    setS((x) => ({ ...x, list: [data.strategy, ...x.list] }));
    return data.strategy;
  }, []);
  const update = useCallback(async (id, params) => {
    const { data } = await api.put(`/insider/strategies/${id}`, { params });
    setS((x) => ({ ...x, list: x.list.map((y) => (y.id === id ? data.strategy : y)) }));
    return data.strategy;
  }, []);
  const remove = useCallback(async (id) => {
    await api.delete(`/insider/strategies/${id}`);
    setS((x) => ({ ...x, list: x.list.filter((y) => y.id !== id) }));
  }, []);
  return { ...s, reload: load, save, update, remove };
}
