import { useEffect, useState } from "react";
import api from "../lib/api";

export default function useWatchlist() {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    const res = await api.get("/watch");
    const items = Array.isArray(res.data?.items) ? res.data.items : [];
    setRules(items);
    return items;
  };

  useEffect(() => {
    let ignore = false;

    async function run() {
      try {
        setLoading(true);
        const res = await api.get("/watch");
        const items = Array.isArray(res.data?.items) ? res.data.items : [];
        if (!ignore) setRules(items);
      } catch (err) {
        console.error("watchlist load error:", err);
        if (!ignore) setRules([]);
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    run();

    return () => {
      ignore = true;
    };
  }, []);

  const addRule = async (payload) => {
    const res = await api.post("/watch", payload);
    const item = res.data?.item;

    if (item) {
      setRules((prev) => {
        const list = Array.isArray(prev) ? prev : [];
        const filtered = list.filter((x) => x?._id !== item._id);
        return [item, ...filtered];
      });
    }

    return res.data;
  };

  const removeRule = async (id) => {
    await api.delete(`/watch/${id}`);
    setRules((prev) =>
      Array.isArray(prev) ? prev.filter((x) => x?._id !== id) : []
    );
  };

  return {
    rules,
    loading,
    refresh,
    addRule,
    removeRule,
  };
}