import { memo, useState } from "react";
import { formatCoins, formatFloat, getFloatValue, getWear } from "../../lib/marketItem";

/* ─── Float bar (mini) ───────────────────────────────── */
function FloatBarMini({ floatValue }) {
  if (!Number.isFinite(floatValue) || floatValue < 0 || floatValue > 1) return null;
  const pct = floatValue * 100;
  const zone = floatValue < 0.07 ? { k:"FN", c:"#22c55e" }
    : floatValue < 0.15 ? { k:"MW", c:"#86efac" }
    : floatValue < 0.38 ? { k:"FT", c:"#fde047" }
    : floatValue < 0.45 ? { k:"WW", c:"#fb923c" }
    : { k:"BS", c:"#ef4444" };
  return (
    <div>
      <div className="relative h-[4px] rounded-full float-track">
        <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-[3px] h-[10px] rounded-sm bg-white"
          style={{ left: `${pct}%`, boxShadow: "0 0 6px rgba(255,255,255,0.9)" }} />
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.3)" }}>{floatValue.toFixed(4)}</span>
        <span className="text-[10px] font-bold" style={{ color: zone.c }}>{zone.k}</span>
      </div>
    </div>
  );
}

/* ─── Smart image ─────────────────────────────────────── */
function buildSteamUrl(v) {
  if (!v) return "";
  const s = String(v).trim();
  if (/^https?:\/\//i.test(s)) return s;
  return `https://community.cloudflare.steamstatic.com/economy/image/${s}/360fx360f`;
}

function SmartImage({ item }) {
  const candidates = [item?.image, item?.image_url, buildSteamUrl(item?.icon_url), buildSteamUrl(item?.icon)].filter(Boolean);
  const [idx, setIdx] = useState(0);
  const src = candidates[idx];
  if (!src) return <div className="text-[10px] text-white/20">No image</div>;
  return (
    <img src={src} alt={item?.name || "Item"}
      className="h-14 w-14 object-contain"
      loading="lazy" decoding="async" draggable={false}
      onError={() => setIdx(p => p + 1)} />
  );
}

/* ─── Sticker grid ───────────────────────────────────── */
function StickerGrid({ stickers }) {
  const visible = stickers.filter(s => s?.icon_url || s?.image || s?.url);
  if (!visible.length) return null;
  return (
    <div>
      <p className="text-[9px] font-black uppercase tracking-[0.15em] mb-2" style={{ color: "rgba(255,255,255,0.2)" }}>Stickers</p>
      <div className="flex flex-wrap gap-1.5">
        {visible.map((s, i) => {
          const src = s.icon_url || s.image || s.url;
          const name = s.name || `Sticker ${i + 1}`;
          return (
            <div key={`${name}-${i}`} title={name}
              className="h-9 w-9 flex items-center justify-center rounded-lg"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
              <img src={src} alt={name}
                className="h-7 w-7 object-contain transition-transform hover:scale-110"
                loading="lazy" decoding="async" draggable={false}
                onError={(e) => { e.currentTarget.parentElement.style.display = "none"; }} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Item row ───────────────────────────────────────── */
const ItemRow = memo(function ItemRow({ item, index }) {
  const wear       = getWear(item);
  const floatValue = getFloatValue(item);
  const stickers   = Array.isArray(item?.stickers) ? item.stickers : [];
  const isBest     = index === 0;
  const empireUrl  = item?.itemId ? `https://csgoempire.com/item/${item.itemId}` : "https://csgoempire.com";

  return (
    <div className="rounded-2xl overflow-hidden transition-all duration-150"
      style={{
        background: isBest ? "linear-gradient(135deg, rgba(34,211,238,0.06), rgba(168,85,247,0.04))" : "rgba(255,255,255,0.03)",
        border: isBest ? "1px solid rgba(34,211,238,0.18)" : "1px solid rgba(255,255,255,0.06)",
      }}>
      {isBest && (
        <div className="px-4 py-2 flex items-center gap-1.5"
          style={{ background: "rgba(34,211,238,0.08)", borderBottom: "1px solid rgba(34,211,238,0.1)" }}>
          <span className="text-[9px] font-black uppercase tracking-[0.15em] text-cyan-400">⚡ Best Price</span>
        </div>
      )}

      <div className="p-4 space-y-3">
        {/* Image + name */}
        <div className="flex items-center gap-3">
          <div className="h-[60px] w-[60px] flex-shrink-0 flex items-center justify-center rounded-xl"
            style={{ background: "rgba(255,255,255,0.04)" }}>
            <SmartImage item={item} />
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-black text-white leading-tight truncate">{item?.name}</p>
            {wear && !floatValue && (
              <span className="inline-block mt-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
                style={{ background: "rgba(34,211,238,0.08)", color: "rgba(34,211,238,0.7)" }}>{wear}</span>
            )}
          </div>
        </div>

        {/* Float bar */}
        {floatValue !== null && <FloatBarMini floatValue={floatValue} />}

        {/* Stickers */}
        {stickers.length > 0 && <StickerGrid stickers={stickers} />}

        {/* Price */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] text-white/25 font-medium">Empire price</p>
            <p className="text-[18px] font-black tabular-nums" style={{ color: "#fbbf24" }}>
              {formatCoins(item?.priceCoins)} <span className="text-[12px] font-semibold" style={{ color: "rgba(251,191,36,0.5)" }}>coins</span>
            </p>
          </div>
          {item?.discountPct > 0 && (
            <div className="px-2.5 py-1 rounded-lg text-[12px] font-black"
              style={{ background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.2)", color: "#4ade80" }}>
              -{Math.round(item.discountPct)}%
            </div>
          )}
        </div>

        {/* Buy button */}
        <a href={empireUrl} target="_blank" rel="noreferrer"
          className="block w-full py-2.5 rounded-xl text-center text-[13px] font-black text-black transition-all duration-150 hover:brightness-110"
          style={{ background: "linear-gradient(135deg, #fbbf24, #f59e0b)" }}>
          Buy on Empire
        </a>
      </div>
    </div>
  );
});

/* ─── Sidebar shell ───────────────────────────────────── */
export default function PriceSidebar({ open, title = "Item Details", items = [], loading, onClose }) {
  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose}
        className="fixed inset-0 z-40 transition-all duration-300"
        style={{
          background: "rgba(0,0,0,0.5)",
          backdropFilter: open ? "blur(4px)" : "none",
          pointerEvents: open ? "auto" : "none",
          opacity: open ? 1 : 0,
        }} />

      {/* Panel */}
      <aside className="fixed right-0 top-0 z-50 h-screen w-[400px] max-w-[92vw] flex flex-col transition-transform duration-300"
        style={{
          background: "#1a2133",
          borderLeft: "1px solid rgba(255,255,255,0.09)",
          boxShadow: "-16px 0 40px rgba(0,0,0,0.45)",
          transform: open ? "translateX(0)" : "translateX(100%)",
        }}>

        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 flex-shrink-0"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.09)" }}>
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.16em] mb-0.5" style={{ color: "rgba(34,211,238,0.5)" }}>
              Sorted by price
            </p>
            <h2 className="text-[16px] font-black text-white leading-tight">{title}</h2>
          </div>
          <button onClick={onClose}
            className="h-8 w-8 flex items-center justify-center rounded-xl text-white/40 hover:text-white hover:bg-white/08 transition-all duration-150 flex-shrink-0 mt-0.5"
            style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading && !items.length ? (
            <div className="space-y-3">
              {[1,2,3].map(i => (
                <div key={i} className="h-48 rounded-2xl skeleton" />
              ))}
            </div>
          ) : !items.length ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
              <span className="text-3xl">📭</span>
              <p className="text-sm text-white/30">No related items</p>
            </div>
          ) : (
            items.map((item, i) => (
              <ItemRow key={item.itemId || item.id || `${item.name}-${i}`} item={item} index={i} />
            ))
          )}
        </div>
      </aside>
    </>
  );
}
