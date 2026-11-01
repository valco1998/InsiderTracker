import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { rarityColor } from "../pages/trade/TradeItemCard";
import useAuth from "../hooks/useAuth";
import steamLogoImg from "../assets/Steam_icon_logo.png";

const AUTO_DISMISS_MS = 14000;

const WEAR_SHORTS = {
  "Factory New":    { short: "FN", color: "#22c55e" },
  "Minimal Wear":   { short: "MW", color: "#86efac" },
  "Field-Tested":   { short: "FT", color: "#ca8a04" },
  "Well-Worn":      { short: "WW", color: "#f97316" },
  "Battle-Scarred": { short: "BS", color: "#ef4444" },
};

/* ─── Global animation styles — always in DOM ───────── */
const TOAST_STYLES = `
  @keyframes tmSlideIn {
    from { opacity:0; transform:translateX(24px) scale(0.96); }
    to   { opacity:1; transform:translateX(0)    scale(1);    }
  }
  @keyframes tmTimer { from{width:100%} to{width:0%} }
`;

function safeColor(rarity) {
  try { return rarityColor(rarity); } catch { return "#cbd5e1"; }
}

/* ─── Offer thumb ────────────────────────────────────── */
function OfferThumb({ item }) {
  const [failed, setFailed] = useState(false);
  if (!item) return null;
  const src   = String(item.iconUrl || "");
  const name  = item.name || item.marketHashName || "";
  const color = safeColor(item.rarity);
  return (
    <div title={name} style={{
      width: 54, height: 54, borderRadius: 8, flexShrink: 0,
      background: "rgba(255,255,255,0.05)",
      border: "1px solid rgba(255,255,255,0.09)",
      display: "flex", alignItems: "center", justifyContent: "center",
      overflow: "hidden", position: "relative",
    }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: color, opacity: 0.7 }} />
      {src && !failed
        ? <img src={src} alt={name} style={{ width: "80%", height: "80%", objectFit: "contain" }} onError={() => setFailed(true)} />
        : <span style={{ fontSize: 18, opacity: 0.15 }}>🔫</span>
      }
    </div>
  );
}

/* ─── Main matched item (large) ──────────────────────── */
function MatchedItemCard({ item, extra }) {
  const [failed, setFailed] = useState(false);
  if (!item) return null;
  const src    = String(item.iconUrl || "");
  const name   = item.name || item.marketHashName || "Unknown";
  const color  = safeColor(item.rarity);
  const wEntry = item.exterior ? (WEAR_SHORTS[item.exterior] || null) : null;
  const isST   = /^StatTrak™/i.test(String(name).trim());
  const displayName = isST ? String(name).replace(/^StatTrak™\s*/i, "") : name;

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 14,
      padding: "12px 14px",
      background: "rgba(168,85,247,0.07)",
      border: "1px solid rgba(168,85,247,0.18)",
      borderRadius: 12,
    }}>
      {/* 96×96 image — contain, never cropped */}
      <div style={{
        width: 96, height: 96, flexShrink: 0, borderRadius: 10,
        background: "rgba(0,0,0,0.28)",
        display: "flex", alignItems: "center", justifyContent: "center",
        overflow: "hidden", position: "relative",
      }}>
        {src && !failed
          ? <img src={src} alt={name} style={{ width: "88%", height: "88%", objectFit: "contain" }} onError={() => setFailed(true)} />
          : <span style={{ fontSize: 28, opacity: 0.15 }}>🔫</span>
        }
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 2, background: color, opacity: 0.7 }} />
      </div>

      {/* Details */}
      <div style={{ minWidth: 0, flex: 1 }}>
        {isST && (
          <div style={{ marginBottom: 5 }}>
            <span style={{
              fontSize: 9, fontWeight: 800, color: "#f97316",
              background: "rgba(249,115,22,0.12)",
              border: "1px solid rgba(249,115,22,0.25)",
              borderRadius: 4, padding: "1px 6px",
            }}>StatTrak™</span>
          </div>
        )}
        <div style={{
          fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.92)",
          lineHeight: 1.35,
          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
        }}>
          {displayName}
        </div>
        {item.rarity?.name && (
          <div style={{ fontSize: 10, color, fontWeight: 600, marginTop: 4, opacity: 0.85 }}>
            {item.rarity.name}
          </div>
        )}
        {wEntry && (
          <div style={{ marginTop: 5, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: "#fff", background: wEntry.color, borderRadius: 4, padding: "2px 7px" }}>
              {wEntry.short}
            </span>
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>{item.exterior}</span>
          </div>
        )}
        {extra > 0 && (
          <div style={{ fontSize: 10, color: "rgba(168,85,247,0.7)", marginTop: 5, fontWeight: 600 }}>
            +{extra} more matched item{extra > 1 ? "s" : ""}
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   Toast container — always mounted, style always in DOM
═══════════════════════════════════════════════════════ */
export default function TradeMatchToast() {
  const [toasts, setToasts] = useState([]);
  const { user } = useAuth();
  const alertsEnabledRef = useRef(true);

  useEffect(() => {
    alertsEnabledRef.current = user?.tradeMatchAlertsEnabled !== false;
    console.log(`[TRADE NOTIFS] alertsEnabled updated → ${alertsEnabledRef.current}`);
  }, [user?.tradeMatchAlertsEnabled]);

  useEffect(() => {
    function handler(e) {
      const detail       = e?.detail || {};
      const notification = detail.notification;
      const tradePostId  = detail.tradePostId || null;

      console.log(`[TRADE NOTIFS] popup handler fired — alertsEnabled=${alertsEnabledRef.current} notifId=${notification?.id || "?"}`);

      if (!alertsEnabledRef.current) {
        console.log("[TRADE NOTIFS] popup SUPPRESSED — Trade Match Alerts is OFF");
        return;
      }

      if (!notification) {
        console.warn("[TRADE NOTIFS] popup handler — no notification in event detail, ignoring");
        return;
      }

      const id = notification.id || `tm-${Date.now()}`;

      setToasts(prev => {
        if (prev.some(t => t._pid === id)) {
          console.log(`[TRADE NOTIFS] popup DEDUPE — toast id=${id} already visible`);
          return prev;
        }
        console.log(`[TRADE NOTIFS] popup render — adding toast id=${id} sender="${notification.senderUsername}"`);
        return [{ ...notification, _pid: id, tradePostId }, ...prev].slice(0, 3);
      });

      setTimeout(() => setToasts(p => p.filter(t => t._pid !== id)), AUTO_DISMISS_MS);
    }

    window.addEventListener("trade:match", handler);
    return () => window.removeEventListener("trade:match", handler);
  }, []);

  // Style always in DOM so animations are ready before any toast appears
  return (
    <>
      <style>{TOAST_STYLES}</style>

      {toasts.length > 0 && (
        <div style={{
          position: "fixed", right: 20, top: 80, zIndex: 9999,
          display: "flex", flexDirection: "column", gap: 12,
          width: 460, pointerEvents: "none",
        }}>
          {toasts.map(t => (
            <ToastCard
              key={t._pid}
              toast={t}
              onDismiss={() => setToasts(p => p.filter(x => x._pid !== t._pid))}
            />
          ))}
        </div>
      )}
    </>
  );
}

/* ═══════════════════════════════════════════════════════
   Individual toast card
═══════════════════════════════════════════════════════ */
function ToastCard({ toast, onDismiss }) {
  const navigate = useNavigate();

  console.log("[TRADE POPUP] ToastCard render — sender:", toast.senderUsername, "| pid:", toast._pid);

  const matchedItems = Array.isArray(toast.matchedItems) ? toast.matchedItems : [];
  const offerItems   = Array.isArray(toast.offerItems)   ? toast.offerItems   : [];
  const firstMatch   = matchedItems[0] || null;
  const extraMatch   = Math.max(0, matchedItems.length - 1);
  const offerPreview = offerItems.slice(0, 8);
  const offerExtra   = Math.max(0, offerItems.length - 8);

  function goToPost() {
    const id = toast.tradePostId;
    if (id && id !== "dev-trade-post-preview") navigate(`/trade/${id}`);
    onDismiss();
  }

  return (
    <div style={{
      pointerEvents: "auto",
      background: "rgba(13,18,28,0.97)",
      border: "1px solid rgba(168,85,247,0.25)",
      borderRadius: 16,
      overflow: "hidden",
      boxShadow: "0 20px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(168,85,247,0.07)",
      animation: "tmSlideIn 0.26s cubic-bezier(0.16,1,0.3,1)",
    }}>
      {/* Accent stripe */}
      <div style={{ height: 3, background: "linear-gradient(90deg, #a855f7, #6366f1, #22d3ee)" }} />

      <div style={{ padding: "16px 18px 14px" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10, minWidth: 0, flex: 1 }}>
            <div style={{
              width: 9, height: 9, borderRadius: "50%", flexShrink: 0, marginTop: 4,
              background: "rgba(168,85,247,0.9)",
              boxShadow: "0 0 0 3px rgba(168,85,247,0.2), 0 0 10px rgba(168,85,247,0.5)",
            }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(168,85,247,0.8)", marginBottom: 3 }}>
                Trade Match
              </div>
              <div style={{ fontSize: 13.5, fontWeight: 500, color: "rgba(255,255,255,0.75)", lineHeight: 1.35 }}>
                <span style={{ fontWeight: 800, color: "#fff" }}>{toast.senderUsername || "Someone"}</span>
                {" is looking for an item you own"}
              </div>
            </div>
          </div>
          <button
            onClick={onDismiss}
            style={{
              width: 26, height: 26, borderRadius: 7, flexShrink: 0,
              border: "1px solid rgba(255,255,255,0.09)", background: "rgba(255,255,255,0.05)",
              color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 14,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >×</button>
        </div>

        {/* Matched item */}
        {firstMatch && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(168,85,247,0.5)", marginBottom: 7 }}>
              They want this from you
            </div>
            <MatchedItemCard item={firstMatch} extra={extraMatch} />
          </div>
        )}

        {/* Their offer */}
        {offerPreview.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(34,211,238,0.5)", marginBottom: 7 }}>
              Their Offer
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {offerPreview.map((item, i) => <OfferThumb key={i} item={item} />)}
              {offerExtra > 0 && (
                <div style={{
                  width: 54, height: 54, borderRadius: 8, flexShrink: 0,
                  background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.3)",
                }}>
                  +{offerExtra}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Buttons */}
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={goToPost} style={{
            flex: 1, height: 36, borderRadius: 9,
            background: "rgba(168,85,247,0.18)", border: "1px solid rgba(168,85,247,0.38)",
            color: "rgba(200,160,255,1)", fontSize: 12.5, fontWeight: 700,
            cursor: "pointer", fontFamily: "inherit",
          }}>
            View Trade Post
          </button>

          <button onClick={goToPost} style={{
            flex: 1, height: 36, borderRadius: 9,
            background: "rgba(34,211,238,0.08)", border: "1px solid rgba(34,211,238,0.22)",
            color: "rgba(34,211,238,0.85)", fontSize: 12.5, fontWeight: 700,
            cursor: "pointer", fontFamily: "inherit",
          }}>
            Reply with Offer
          </button>

          {toast.senderSteamId && (
            <a
              href={`https://steamcommunity.com/profiles/${toast.senderSteamId}`}
              target="_blank" rel="noopener noreferrer"
              title="View on Steam"
              style={{
                width: 36, height: 36, borderRadius: 9, flexShrink: 0,
                border: "1px solid rgba(255,255,255,0.09)", background: "rgba(255,255,255,0.04)",
                color: "rgba(255,255,255,0.35)", display: "flex", alignItems: "center", justifyContent: "center",
                textDecoration: "none",
              }}
            >
              <SteamIcon size={14} />
            </a>
          )}
        </div>
      </div>

      {/* Timer bar */}
      <div style={{ height: 2, background: "rgba(255,255,255,0.04)", overflow: "hidden" }}>
        <div style={{ height: "100%", background: "linear-gradient(90deg,#a855f7,#6366f1,#22d3ee)", animation: `tmTimer ${AUTO_DISMISS_MS}ms linear forwards` }} />
      </div>
    </div>
  );
}

function SteamIcon({ size = 16 }) {
  return (
    <img
      src={steamLogoImg}
      alt="Steam"
      style={{ width: size, height: size, objectFit: "contain", flexShrink: 0 }}
    />
  );
}
