/**
 * Compact auction-share card — all inline styles, works in ChatShell and GlobalChatDock.
 * Data resolution: msg.meta (structured) → JSON.parse(msg.text) (legacy)
 */
import { memo } from "react";

/* ─── Helpers ──────────────────────────────────────── */

export function resolveAuctionData(msg) {
  if (msg?.meta?.itemId) return msg.meta;
  const t = String(msg?.text || "").trim();
  if (t && t[0] === "{") {
    try { const p = JSON.parse(t); if (p?.itemId) return p; } catch {}
  }
  return null;
}

function fmtC(v) {
  return Number(v || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function timeLeft(endsAt) {
  if (!endsAt) return null;
  const diff = Number(endsAt) * 1000 - Date.now();
  if (diff <= 0) return { label: "Ended", urgent: false };
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(mins / 60);
  const urgent = mins < 10;
  return { label: hours > 0 ? `${hours}h ${mins % 60}m` : `${mins}m`, urgent };
}

/* ─── Component ─────────────────────────────────────── */

const AuctionShareMessage = memo(function AuctionShareMessage({ msg, isMine = false, compact = false }) {
  const data = resolveAuctionData(msg);
  if (!data) return null;

  const isMarketItem = msg?.type === "market_item";
  const badgeLabel = isMarketItem ? "Market Deal" : "Auction";
  const ctaLabel   = isMarketItem ? "View Item →" : "Open Auction →";
  const discount   = Number(data.discountPct || 0) > 0 ? Number(data.discountPct) : null;

  const profit = Number(data.profitCoins || 0) > 0 ? Number(data.profitCoins) : null;
  const tl     = isMarketItem ? null : timeLeft(data.endsAt);
  const url    = data.empireUrl || `https://csgoempire.com/item/${data.itemId}`;
  const w      = compact ? 196 : 240;

  return (
    <div style={{ display: "flex", justifyContent: isMine ? "flex-end" : "flex-start" }}>
      <div style={{
        width: w, flexShrink: 0, overflow: "hidden", borderRadius: 12,
        background: "linear-gradient(160deg, #1e2840 0%, #172030 60%, #151c2c 100%)",
        border: "1px solid rgba(251,115,0,0.24)",
        backdropFilter: "blur(12px)",
        boxShadow: "0 0 20px rgba(251,115,0,0.10), 0 4px 24px rgba(0,0,0,0.40), inset 0 1px 0 rgba(255,255,255,0.06)",
      }}>
        {/* Top accent */}
        <div style={{ height: 2, background: "linear-gradient(90deg, #fb923c, #fbbf24, #fb923c)", backgroundSize: "200% 100%", animation: "shimmer 2s linear infinite" }} />

        {/* Image */}
        {data.image && (
          <div style={{
            height: compact ? 64 : 80,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(255,255,255,0.03)",
            borderBottom: "1px solid rgba(255,255,255,0.05)",
          }}>
            <img
              src={data.image}
              alt={data.name || ""}
              style={{ height: "90%", width: "90%", objectFit: "contain" }}
              loading="lazy"
              onError={e => { e.currentTarget.parentElement.style.display = "none"; }}
            />
          </div>
        )}

        <div style={{ padding: compact ? "8px 10px 10px" : "10px 12px 12px" }}>

          {/* Source label */}
          <div style={{
            fontSize: 8.5, fontWeight: 700, textTransform: "uppercase",
            letterSpacing: "0.14em", color: "rgba(251,115,0,0.7)",
            marginBottom: 6, display: "flex", alignItems: "center", gap: 4,
          }}>
            <span style={{ width: 4, height: 4, borderRadius: "50%", background: "#fb923c", display: "inline-block" }} />
            {badgeLabel}
          </div>

          {/* Item name */}
          <p style={{
            fontSize: compact ? 11.5 : 12.5, fontWeight: 600,
            color: "rgba(255,255,255,0.88)", lineHeight: 1.35, margin: "0 0 8px",
            display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
          }}>
            {data.name || "Unknown Item"}
          </p>

          {/* Wear / StatTrak / Souvenir chips */}
          {(data.wear || data.statTrak || data.souvenir) && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
              {data.statTrak && (
                <span style={{ fontSize: 8.5, fontWeight: 700, color: "#f97316", background: "rgba(249,115,22,0.10)", border: "1px solid rgba(249,115,22,0.24)", borderRadius: 5, padding: "2px 5px" }}>
                  StatTrak™
                </span>
              )}
              {data.souvenir && (
                <span style={{ fontSize: 8.5, fontWeight: 700, color: "#fbbf24", background: "rgba(251,191,36,0.10)", border: "1px solid rgba(251,191,36,0.24)", borderRadius: 5, padding: "2px 5px" }}>
                  Souvenir
                </span>
              )}
              {data.wear && (
                <span style={{ fontSize: 8.5, fontWeight: 700, color: "rgba(255,255,255,0.45)", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.10)", borderRadius: 5, padding: "2px 5px" }}>
                  {data.wear}
                </span>
              )}
            </div>
          )}

          {/* Stats row */}
          <div style={{ display: "flex", gap: 6, marginBottom: tl ? 6 : 8 }}>
            <div style={{
              flex: 1, borderRadius: 7, padding: "5px 8px",
              background: "rgba(0,0,0,0.25)",
            }}>
              <div style={{ fontSize: 8, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(255,255,255,0.3)", fontWeight: 600, marginBottom: 2 }}>
                {isMarketItem ? "Price" : "Bid"}
              </div>
              <div style={{ fontSize: compact ? 11 : 12, fontWeight: 800, color: "#fbbf24", fontVariantNumeric: "tabular-nums" }}>
                {fmtC(data.priceCoins)}c
              </div>
            </div>

            {profit !== null ? (
              <div style={{
                flex: 1, borderRadius: 7, padding: "5px 8px",
                background: "rgba(74,222,128,0.09)", border: "1px solid rgba(74,222,128,0.22)",
                boxShadow: "0 0 10px rgba(74,222,128,0.08)",
                animation: "pulseGlow 2.5s ease-in-out infinite",
              }}>
                <div style={{ fontSize: 8, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(255,255,255,0.3)", fontWeight: 600, marginBottom: 2 }}>
                  {isMarketItem ? "Save" : "Profit"}
                </div>
                <div style={{ fontSize: compact ? 11 : 12, fontWeight: 800, color: "#4ade80", fontVariantNumeric: "tabular-nums", textShadow: "0 0 6px rgba(74,222,128,0.5)" }}>
                  +{fmtC(profit)}c
                </div>
              </div>
            ) : discount !== null ? (
              <div style={{
                flex: 1, borderRadius: 7, padding: "5px 8px",
                background: "rgba(74,222,128,0.09)", border: "1px solid rgba(74,222,128,0.22)",
              }}>
                <div style={{ fontSize: 8, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(255,255,255,0.3)", fontWeight: 600, marginBottom: 2 }}>
                  Discount
                </div>
                <div style={{ fontSize: compact ? 11 : 12, fontWeight: 800, color: "#4ade80", fontVariantNumeric: "tabular-nums" }}>
                  -{Math.round(discount)}%
                </div>
              </div>
            ) : data.suggestedCoins > data.priceCoins ? (
              <div style={{
                flex: 1, borderRadius: 7, padding: "5px 8px",
                background: "rgba(0,0,0,0.25)",
              }}>
                <div style={{ fontSize: 8, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(255,255,255,0.3)", fontWeight: 600, marginBottom: 2 }}>
                  Ref
                </div>
                <div style={{ fontSize: compact ? 11 : 12, fontWeight: 700, color: "rgba(255,255,255,0.4)", fontVariantNumeric: "tabular-nums", textDecoration: "line-through" }}>
                  {fmtC(data.suggestedCoins)}c
                </div>
              </div>
            ) : null}
          </div>

          {/* Time left */}
          {tl && (
            <div style={{
              fontSize: 10.5, fontWeight: 600, marginBottom: 8,
              color: tl.urgent ? "#f87171" : tl.label === "Ended" ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.45)",
            }}>
              {tl.label === "Ended" ? "Auction ended" : `${tl.label} left`}
            </div>
          )}

          {/* CTA */}
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            style={{
              display: "block", textAlign: "center",
              padding: compact ? "6px 0" : "8px 0",
              borderRadius: 8, fontSize: 11, fontWeight: 700, color: "#000",
              background: "linear-gradient(135deg, #fbbf24, #f59e0b)",
              textDecoration: "none",
              boxShadow: "0 2px 12px rgba(251,191,36,0.22)",
              transition: "filter 0.15s, transform 0.15s",
            }}
            onMouseEnter={e => { e.currentTarget.style.filter = "brightness(1.12)"; e.currentTarget.style.transform = "scale(1.01)"; }}
            onMouseLeave={e => { e.currentTarget.style.filter = "none"; e.currentTarget.style.transform = "scale(1)"; }}
          >
            {ctaLabel}
          </a>
        </div>
      </div>
    </div>
  );
});

export default AuctionShareMessage;
