import { useEffect, useMemo, useState } from "react";
import api from "../lib/api";
import { normalizeForSearch, uniqueSkinSuggestions } from "../utils/watchRule";

function scoreSuggestion(baseName, query) {
  const name = normalizeForSearch(baseName);
  const q = normalizeForSearch(query);

  if (!q) return 0;
  if (name === q) return 1000;
  if (name.startsWith(q)) return 900;
  if (name.includes(q)) return 700;

  const words = q.split(" ").filter(Boolean);
  let score = 0;

  for (const word of words) {
    if (name.includes(word)) score += 100;
  }

  return score;
}

export default function useSkinSuggestions(search) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const q = String(search || "").trim();

    // 🔥 הגנה מיותר מדי בקשות
    if (!q || q.length < 3) {
      setItems([]);
      return;
    }

    const controller = new AbortController();

    async function run() {
      try {
        setLoading(true);

        const res = await api.get("/items/market-live", {
          params: { search: q },
          signal: controller.signal,
        });

        const raw = Array.isArray(res?.data?.items) ? res.data.items : [];
        setItems(raw);
      } catch (err) {
        if (err?.name !== "CanceledError" && err?.name !== "AbortError") {
          console.error("Suggestions load error:", err);
          setItems([]);
        }
      } finally {
        setLoading(false);
      }
    }

    // 🔥 debounce חכם (הכי חשוב)
    const timer = setTimeout(run, 1000);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [search]);

  const suggestions = useMemo(() => {
    const q = String(search || "").trim();
    if (!q) return [];

    return uniqueSkinSuggestions(items)
      .map((item) => ({
        ...item,
        _score: scoreSuggestion(item.baseName, q),
      }))
      .filter((item) => item._score > 0)
      .sort((a, b) => {
        if (b._score !== a._score) return b._score - a._score;
        return a.baseName.localeCompare(b.baseName);
      })
      .slice(0, 8);
  }, [items, search]);

  return {
    suggestions,
    loading,
  };
}