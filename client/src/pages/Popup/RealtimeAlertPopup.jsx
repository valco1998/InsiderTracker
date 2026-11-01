import { useEffect, useState } from "react";
import { playAlertSound } from "../../lib/alertSound";

const AUTO_DISMISS_MS = 7000;

export default function RealtimeAlertPopup() {
  const [alerts, setAlerts] = useState([]);

  useEffect(() => {
    const handler = (e) => {
      const alert = e.detail;
      if (!alert) return;
      const id    = alert.id || alert._id || `${alert.itemId}-${Date.now()}`;
      const popup = { ...alert, popupId: id };

      setAlerts((prev) => {
        if (prev.find((a) => a.itemId === popup.itemId)) return prev;
        playAlertSound();
        return [popup, ...prev].slice(0, 5);
      });

      setTimeout(() => {
        setAlerts((prev) => prev.filter((a) => a.popupId !== id));
      }, AUTO_DISMISS_MS);
    };

    window.addEventListener("price_alert", handler);
    return () => window.removeEventListener("price_alert", handler);
  }, []);

  if (!alerts.length) return null;

  return (
    <>
      <style>{`
        @keyframes alertIn {
          from { opacity:0; transform:translateX(16px) scale(0.97); }
          to   { opacity:1; transform:translateX(0)   scale(1);    }
        }
        @keyframes timerShrink { from{width:100%} to{width:0%} }
      `}</style>

      <div
        className="pointer-events-none fixed right-4 top-[80px] z-[9999] flex flex-col gap-2"
        style={{ width: 300 }}
      >
        {alerts.map((alert) => (
          <PopupCard
            key={alert.popupId}
            alert={alert}
            onDismiss={() => setAlerts((prev) => prev.filter((a) => a.popupId !== alert.popupId))}
          />
        ))}
      </div>
    </>
  );
}

/* ─── Individual popup card ───────────────────────────────────── */

function PopupCard({ alert, onDismiss }) {
  const isAuction  = alert.source === "auction-alert" || !!alert.isAuction;
  const profitCoins = Number(alert.profitCoins || 0);
  const showProfit  = isAuction && profitCoins > 0;

  const accent    = isAuction ? "#fb923c" : "#22d3ee";
  const accentRgb = isAuction ? "251,115,0" : "34,211,238";
  const accentGrad = isAuction
    ? "linear-gradient(90deg,#fb923c,#fbbf24)"
    : "linear-gradient(90deg,#22d3ee,#a855f7)";

  const empireHref = `https://csgoempire.com/item/${alert.itemId}`;

  return (
    <div
      className="pointer-events-auto overflow-hidden rounded-2xl"
      style={{
        background:    "rgba(26,33,51,0.97)",
        border:        `1px solid rgba(${accentRgb},0.18)`,
        boxShadow:     `0 8px 28px rgba(0,0,0,0.5), 0 0 0 1px rgba(${accentRgb},0.06)`,
        backdropFilter:"blur(24px)",
        animation:     "alertIn 0.22s cubic-bezier(0.16,1,0.3,1)",
      }}
    >
      {/* 2px accent stripe */}
      <div style={{ height: 2, background: accentGrad }} />

      {/* Content row */}
      <div className="flex items-start gap-3 px-3.5 py-3">

        {/* Thumbnail */}
        <div
          className="h-[48px] w-[48px] flex-shrink-0 rounded-xl overflow-hidden flex items-center justify-center"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}
        >
          <img
            src={alert.image || ""}
            alt=""
            className="h-10 w-10 object-contain"
            onError={(e) => { e.currentTarget.style.display = "none"; }}
          />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          {/* Source badge */}
          <div className="flex items-center gap-1.5 mb-1">
            <span
              className="text-[8px] font-black uppercase tracking-[0.18em] px-1.5 py-0.5 rounded-md"
              style={{
                background: `rgba(${accentRgb},0.12)`,
                border:     `1px solid rgba(${accentRgb},0.22)`,
                color:       accent,
              }}
            >
              {isAuction ? "Auction Profit" : "Deal Alert"}
            </span>
          </div>

          {/* Name */}
          <p className="text-[12px] font-black text-white leading-tight line-clamp-1 mb-2">
            {alert.name || "Unknown item"}
          </p>

          {/* Stats row */}
          <div className="flex items-center gap-2 mb-2.5">
            <StatPill label={isAuction ? "Bid" : "Price"} value={fmtC(alert.priceCoins)} yellow />
            {showProfit ? (
              <StatPill label="Profit" value={`+${fmtC(profitCoins)}`} green />
            ) : alert.discountPct > 0 ? (
              <StatPill label="Off" value={`${Number(alert.discountPct).toFixed(1)}%`} green />
            ) : null}
          </div>

          {/* CTA row */}
          <div className="flex items-center gap-1.5">
            <a
              href={empireHref}
              target="_blank"
              rel="noreferrer"
              className="flex-1 py-1.5 rounded-xl text-center text-[11px] font-black text-black transition hover:brightness-110"
              style={{ background: "linear-gradient(135deg,#fbbf24,#f59e0b)" }}
            >
              {isAuction ? "Open Auction" : "Buy Now"}
            </a>
            <button
              onClick={onDismiss}
              className="h-7 w-7 flex items-center justify-center rounded-xl transition"
              style={{ border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.3)" }}
              onMouseEnter={e => { e.currentTarget.style.color = "#fff"; e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
              onMouseLeave={e => { e.currentTarget.style.color = "rgba(255,255,255,0.3)"; e.currentTarget.style.background = "transparent"; }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Timer bar */}
      <div style={{ height: 2, background: "rgba(255,255,255,0.05)", overflow: "hidden" }}>
        <div style={{
          height: "100%",
          background: accentGrad,
          animation: `timerShrink ${AUTO_DISMISS_MS}ms linear forwards`,
        }} />
      </div>
    </div>
  );
}

/* ─── Helpers ─────────────────────────────────────────────────── */

function fmtC(v) {
  return Number(v || 0).toFixed(2);
}

function StatPill({ label, value, yellow, green }) {
  return (
    <div className="flex items-center gap-1 px-2 py-1 rounded-lg"
      style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.07)" }}>
      <span className="text-[8px] font-bold uppercase text-white/25">{label}</span>
      <span className={`text-[11px] font-black tabular-nums ${
        yellow ? "text-amber-300" : green ? "text-emerald-400" : "text-white/70"
      }`}>
        {value}
      </span>
    </div>
  );
}
