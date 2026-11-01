import { useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import api from "../../lib/api";
import ItemCard from "../market/ItemCard";
import { extractMarketItems, normalizeItem } from "../../lib/marketItem";

function cleanName(slug) {
  return slug.replace(/-/g, " ");
}

export default function ItemPage() {
  const { slug } = useParams();
  const [items, setItems] = useState([]);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const baseName = cleanName(slug);

        const res = await api.get("/items/market-live", {
          params: {
            search: baseName,
            maxPages: 3,
          },
          signal: controller.signal,
        });

        const rawItems = extractMarketItems(res?.data);

        const normalizedItems = rawItems
          .map(normalizeItem)
          .filter((item) => item && (item.name || item.image || item.priceCoins > 0));

        setItems(normalizedItems);
      } catch (err) {
        if (err.name !== "CanceledError" && err.name !== "AbortError") {
          console.error(err);
          setItems([]);
        }
      }
    }

    load();

    return () => controller.abort();
  }, [slug]);

  return (
    <div className="min-h-screen p-6 text-white" style={{ background: "var(--bg-app)" }}>
      <div className="mx-auto max-w-[1500px]">
        <h1 className="mb-8 text-3xl font-bold capitalize">
          {slug.replace(/-/g, " ")}
        </h1>

        {items.length === 0 ? (
          <div className="mt-20 text-center text-white/40">
            No variants found
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-5 md:grid-cols-3 xl:grid-cols-5">
            {items.map((item) => (
              <ItemCard
                key={item.itemId || item.id || item.name}
                item={item}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}