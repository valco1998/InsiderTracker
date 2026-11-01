import { useState } from "react";
import { Chip, VARIANT_LABELS, VARIANT_COLORS } from "./Chip";

const WEAR_SHORT = {
  "factory new": "FN", "minimal wear": "MW", "field-tested": "FT",
  "well-worn": "WW", "battle-scarred": "BS",
};

function shortWear(w) {
  return WEAR_SHORT[String(w || "").toLowerCase()] ?? w;
}

// Display-only fallback for legacy rules with no persisted `variant` — never
// writes anything back to MongoDB. Mirrors the same `?? "ANY"` guarantee
// used by server/services/watchMatcher.js's matchesWatchRule().
function effectiveVariant(rule) {
  return rule?.variant ?? "ANY";
}

function fmtDate(v) {
  if (!v) return null;
  try {
    const d = new Date(v);
    if (isNaN(d)) return null;
    const now = new Date();
    const ms = now - d;
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
    if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  } catch { return null; }
}

export default function WatchRuleCard({ rule, onDelete }) {
  const [hov, setHov] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const title = rule?.marketHashName
    || `${rule?.baseName || ""}${rule?.wear ? ` (${rule.wear})` : ""}`;
  const weapon = rule?.weapon || "";
  const skin = rule?.skin || "";
  const wear = rule?.wear || "";
  const wearShort = shortWear(wear);
  const variant = effectiveVariant(rule);
  const variantLabel = VARIANT_LABELS[variant] ?? "Any";
  const variantColor = VARIANT_COLORS[variant] ?? "neutral";
  const dateStr = fmtDate(rule?.updatedAt || rule?.createdAt);

  function handleDelete() {
    if (!confirming) { setConfirming(true); return; }
    onDelete(rule?._id);
  }

  return (
    <article
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => { setHov(false); setConfirming(false); }}
      style={{
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        borderRadius: 16,
        background: "linear-gradient(135deg, #1f2a3c 0%, #1a2335 100%)",
        border: hov ? "1px solid rgba(34,211,238,0.22)" : "1px solid rgba(255,255,255,0.09)",
        boxShadow: hov ? "0 12px 32px rgba(0,0,0,0.35), 0 0 0 1px rgba(34,211,238,0.06)" : "0 2px 12px rgba(0,0,0,0.22)",
        transform: hov ? "translateY(-2px)" : "translateY(0)",
        transition: "all 0.2s ease",
        position: "relative",
      }}
    >
      {/* Top accent bar */}
      <div style={{
        height: 2, flexShrink: 0,
        background: "linear-gradient(90deg, transparent, rgba(34,211,238,0.55) 50%, transparent)",
        opacity: hov ? 1 : 0.35,
        transition: "opacity 0.25s",
      }} />

      <div style={{ display: "flex", alignItems: "flex-start", gap: 14, padding: "14px 16px 0" }}>

        {/* Image */}
        <div style={{
          flexShrink: 0, width: 80, height: 60,
          borderRadius: 10, overflow: "hidden",
          background: "radial-gradient(ellipse at 50% 30%, rgba(34,211,238,0.08) 0%, #151e2d 100%)",
          border: "1px solid rgba(255,255,255,0.08)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          {rule?.image ? (
            <img
              src={rule.image}
              alt={title}
              style={{
                width: "100%", height: "100%", objectFit: "contain",
                transform: hov ? "scale(1.06)" : "scale(1)",
                transition: "transform 0.3s ease",
              }}
              loading="lazy"
              onError={e => { e.currentTarget.style.display = "none"; }}
            />
          ) : (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", height: "100%" }}>
              <svg width={28} height={28} fill="none" viewBox="0 0 24 24" stroke="rgba(255,255,255,0.12)" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
          )}
        </div>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 13.5, fontWeight: 600, color: "rgba(255,255,255,0.92)",
            lineHeight: 1.35, letterSpacing: "-0.01em",
            overflow: "hidden", display: "-webkit-box",
            WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
            marginBottom: 4,
          }}>
            {title || "Unknown item"}
          </div>
          {(weapon || skin) && (
            <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.38)", lineHeight: 1.3 }}>
              {[weapon, skin].filter(Boolean).join(" · ")}
            </div>
          )}
        </div>

        {/* Delete button */}
        <button
          onClick={handleDelete}
          style={{
            flexShrink: 0,
            width: 28, height: 28,
            borderRadius: 8,
            border: confirming ? "1px solid rgba(239,68,68,0.45)" : "1px solid rgba(255,255,255,0.08)",
            background: confirming ? "rgba(239,68,68,0.18)" : "rgba(255,255,255,0.04)",
            color: confirming ? "#f87171" : "rgba(255,255,255,0.3)",
            fontSize: confirming ? 9 : 15,
            fontWeight: 700,
            cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "all 0.15s",
          }}
          title={confirming ? "Click again to confirm" : "Remove rule"}
        >
          {confirming ? "✓" : "×"}
        </button>
      </div>

      {/* Chips row */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, padding: "10px 16px 0" }}>
        <Chip color={variantColor}>{variantLabel}</Chip>
        {typeof rule?.targetPrice === "number" && (
          <Chip color="gold">≤ {rule.targetPrice} coins</Chip>
        )}
        {typeof rule?.minDiscountPct === "number" && (
          <Chip color="green">≥ {rule.minDiscountPct}% off</Chip>
        )}
        {wear && <Chip color="cyan">{wearShort || wear}</Chip>}
        {rule?.cooldownMin != null && (
          <Chip color="neutral">{rule.cooldownMin}m cooldown</Chip>
        )}
      </div>

      {/* Footer */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 16px 14px", marginTop: 6,
        borderTop: "1px solid rgba(255,255,255,0.05)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{
            width: 6, height: 6, borderRadius: "50%",
            background: "#4ade80",
            boxShadow: "0 0 5px rgba(74,222,128,0.6)",
            display: "inline-block",
          }} />
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", fontWeight: 500 }}>
            Active
          </span>
        </div>
        {dateStr && (
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>
            {dateStr}
          </span>
        )}
      </div>
    </article>
  );
}
