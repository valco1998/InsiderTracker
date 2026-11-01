import { useEffect, useRef, useState } from "react";
import api from "../../lib/api";
import { getItemType, getWear } from "../../lib/marketItem";

const STATRAK_RE  = /stattrak/i;
const SOUVENIR_RE = /souvenir/i;

function fmtCoins(v) {
  const n = Number(v || 0);
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtTimeLeft(endsAt) {
  if (!endsAt) return null;
  const diff = Number(endsAt) * 1000 - Date.now();
  if (diff <= 0) return "Ended";
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(mins / 60);
  if (hours > 0) return `${hours}h ${mins % 60}m left`;
  return `${mins}m left`;
}

export default function ShareAuctionModal({ item, onClose, kind = "auction" }) {
  const isMarketItem = kind === "market_item";
  const [rooms,    setRooms]    = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [roomId,   setRoomId]   = useState("global");
  const [sending,  setSending]  = useState(false);
  const [sent,     setSent]     = useState(false);
  const [err,      setErr]      = useState("");
  const overlayRef              = useRef(null);

  const profitCoins   = Number(item?.suggestedCoins || 0) - Number(item?.priceCoins || 0);
  const hasProfit     = profitCoins > 0;
  const timeLeft      = fmtTimeLeft(item?.auction?.ends_at);

  /* ── Load available chat rooms ── */
  useEffect(() => {
    let alive = true;

    async function load() {
      try {
        setLoading(true);
        const res = await api.get("/chat/groups");
        const groups = Array.isArray(res.data?.groups) ? res.data.groups : [];

        const roomList = [
          { id: "global", name: "Global Chat", type: "global" },
          ...groups.map((g) => ({ id: `group:${g.id}`, name: g.name, type: "group" })),
        ];

        if (alive) {
          setRooms(roomList);
          setRoomId("global");
        }
      } catch {
        if (alive) setRooms([{ id: "global", name: "Global Chat", type: "global" }]);
      } finally {
        if (alive) setLoading(false);
      }
    }

    load();
    return () => { alive = false; };
  }, []);

  /* ── Close on overlay click ── */
  function handleOverlay(e) {
    if (e.target === overlayRef.current) onClose();
  }

  /* ── Escape key ── */
  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  /* ── Share ── */
  async function handleShare() {
    if (!roomId) return setErr("Please select a chat room.");
    try {
      setSending(true);
      setErr("");

      const fullName = item?.name || "";

      await api.post("/chat/share-auction", {
        roomId,
        type: isMarketItem ? "market_item" : "auction_share",
        auction: {
          itemId:        String(item?.itemId ?? item?.id ?? ""),
          auctionId:     item?.auction?.id ? String(item.auction.id) : "",
          name:          fullName,
          marketHashName:fullName,
          image:         item?.image        || "",
          priceCoins:    Number(item?.priceCoins    || 0),
          suggestedCoins:Number(item?.suggestedCoins || 0),
          profitCoins:   hasProfit ? profitCoins : 0,
          discountPct:   Number(item?.discountPct || 0),
          endsAt:        Number(item?.auction?.ends_at || 0),
          category:      getItemType(fullName),
          wear:          getWear(item) || "",
          statTrak:      STATRAK_RE.test(fullName),
          souvenir:      SOUVENIR_RE.test(fullName),
        },
      });

      setSent(true);
      console.log(`[CHAT_SHARE] ${isMarketItem ? "market item" : "auction"} shared to ${roomId}`);
      setTimeout(onClose, 1200);
    } catch (e) {
      setErr(e?.response?.data?.error || "Failed to share. Try again.");
    } finally {
      setSending(false);
    }
  }

  /* ─── Render ─────────────────────────────────────────────────── */

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlay}
      className="fixed inset-0 z-[9998] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-3xl"
        style={{
          background: "linear-gradient(160deg, #1f2a40 0%, #16202e 100%)",
          border:     "1px solid rgba(251,115,0,0.22)",
          boxShadow:  "0 24px 56px rgba(0,0,0,0.5)",
        }}
      >
        {/* Accent line */}
        <div className="h-[2px]" style={{ background: "linear-gradient(90deg, #fb923c, #fbbf24)" }} />

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-orange-400/70 mb-0.5">
              Share to chat
            </p>
            <h2 className="text-lg font-black text-white">{isMarketItem ? "Share Item" : "Share Auction"}</h2>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-xl text-white/30 hover:text-white transition"
            style={{ border: "1px solid rgba(255,255,255,0.08)" }}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Item preview */}
        <div
          className="mx-5 mb-4 flex gap-3 rounded-2xl p-3"
          style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.06)" }}
        >
          {/* Image */}
          <div
            className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-xl overflow-hidden"
            style={{ background: "rgba(255,255,255,0.04)" }}
          >
            {item.image ? (
              <img
                src={item.image}
                alt={item.name}
                className="h-14 w-14 object-contain"
                onError={(e) => { e.currentTarget.style.display = "none"; }}
              />
            ) : (
              <span className="text-white/20 text-xl">🔫</span>
            )}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-black text-white line-clamp-2 leading-snug">
              {item.name || "Unknown Item"}
            </p>

            <div className="mt-1.5 flex flex-wrap gap-2">
              <span className="text-[11px] tabular-nums" style={{ color: "#fbbf24" }}>
                {fmtCoins(item.priceCoins)} coins
              </span>
              {hasProfit && (
                <span className="text-[11px] tabular-nums font-bold" style={{ color: "#4ade80" }}>
                  +{fmtCoins(profitCoins)} profit
                </span>
              )}
              {timeLeft && (
                <span className="text-[11px] text-orange-300/80">⏱ {timeLeft}</span>
              )}
            </div>
          </div>
        </div>

        {/* Room selector */}
        <div className="px-5 mb-4">
          <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-widest text-white/40">
            Share to
          </label>

          {loading ? (
            <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/30">
              Loading rooms…
            </div>
          ) : (
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {rooms.map((room) => (
                <label
                  key={room.id}
                  className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 transition"
                  style={{
                    background: roomId === room.id ? "rgba(251,115,0,0.1)" : "rgba(255,255,255,0.03)",
                    border:     roomId === room.id ? "1px solid rgba(251,115,0,0.3)" : "1px solid rgba(255,255,255,0.07)",
                  }}
                >
                  <input
                    type="radio"
                    name="chatRoom"
                    value={room.id}
                    checked={roomId === room.id}
                    onChange={() => setRoomId(room.id)}
                    className="accent-orange-400"
                  />
                  <span className="text-sm font-medium text-white/80">{room.name}</span>
                  {room.type === "group" && (
                    <span className="ml-auto text-[10px] text-white/30 uppercase tracking-widest">Group</span>
                  )}
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Error */}
        {err && (
          <p className="mx-5 mb-3 rounded-xl border border-red-400/20 bg-red-400/10 px-3 py-2 text-sm text-red-300">
            {err}
          </p>
        )}

        {/* Actions */}
        <div className="flex gap-2 px-5 pb-5">
          <button
            onClick={onClose}
            className="flex-1 rounded-2xl py-3 text-sm font-bold text-white/50 transition hover:text-white"
            style={{ border: "1px solid rgba(255,255,255,0.09)" }}
          >
            Cancel
          </button>

          <button
            onClick={handleShare}
            disabled={sending || sent || loading}
            className="flex-1 rounded-2xl py-3 text-sm font-black text-black transition hover:brightness-110 disabled:opacity-60"
            style={{ background: sent ? "#4ade80" : "linear-gradient(135deg, #fb923c, #fbbf24)" }}
          >
            {sent ? "✓ Shared!" : sending ? "Sharing…" : "Share"}
          </button>
        </div>
      </div>
    </div>
  );
}
