import { memo, useEffect, useState } from "react";
import ItemCard from "../market/ItemCard";

const PAGE_SIZE = 48;

const SkinGrid = memo(function SkinGrid({ items = [], onSeeMore, onShare, resetKey }) {
  const [page, setPage] = useState(1);

  // Reset to page 1 whenever the item list is replaced (filter/search change)
  useEffect(() => { setPage(1); }, [resetKey]);

  const visible = items.slice(0, page * PAGE_SIZE);
  const hasMore = visible.length < items.length;

  if (!items.length) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <div
          className="h-16 w-16 rounded-2xl flex items-center justify-center text-3xl"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}
        >
          🔍
        </div>
        <div className="text-center">
          <p className="text-base font-black text-white/30">No items found</p>
          <p className="text-sm text-white/15 mt-1">Try adjusting your filters</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {visible.map((item) => (
          <ItemCard
            key={item.itemId || item.id || item.name}
            item={item}
            onSeeMore={onSeeMore}
            onShare={onShare}
          />
        ))}
      </div>

      {hasMore && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, marginTop: 32 }}>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.28)" }}>
            Showing {visible.length} of {items.length} items
          </p>
          <button
            onClick={() => setPage(p => p + 1)}
            style={{
              padding: "11px 36px", borderRadius: 12,
              background: "rgba(168,85,247,0.12)",
              border: "1px solid rgba(168,85,247,0.30)",
              color: "rgba(200,160,255,0.95)",
              fontSize: 13, fontWeight: 700, cursor: "pointer",
              fontFamily: "inherit", letterSpacing: "0.01em",
            }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(168,85,247,0.22)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "rgba(168,85,247,0.12)"; }}
          >
            Load more ({items.length - visible.length} remaining)
          </button>
        </div>
      )}
    </div>
  );
});

export default SkinGrid;
