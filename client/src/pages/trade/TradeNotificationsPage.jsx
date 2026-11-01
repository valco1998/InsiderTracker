import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import api from "../../lib/api";
import useAuth from "../../hooks/useAuth";
import { TradeItemThumb } from "./TradeItemCard";
import tradeAlImg from "../../assets/tradeAl.png";

/* ─── Helpers ─────────────────────────────────────────── */

function timeAgo(iso) {
  if (!iso) return "";
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60_000), h = Math.floor(m / 60), day = Math.floor(h / 24);
  if (day > 0) return `${day}d ago`;
  if (h   > 0) return `${h}h ago`;
  if (m   > 0) return `${m}m ago`;
  return "just now";
}

/* ─── Background stars (deterministic) ───────────────── */
const BG_STARS = [
  [4,12,1,0.16],[11,28,0.75,0.11],[19,8,1.5,0.19],[27,45,1,0.13],[35,19,0.75,0.20],
  [42,68,1,0.12],[50,35,1.5,0.17],[58,82,0.75,0.10],[65,22,1,0.19],[72,55,1.5,0.13],
  [78,14,1,0.21],[84,72,0.75,0.11],[91,38,1,0.17],[96,60,1.5,0.19],[8,92,0.75,0.10],
  [16,52,1,0.14],[24,76,1.5,0.17],[31,30,0.75,0.21],[39,88,1,0.11],[47,5,1,0.19],
  [55,65,1.5,0.14],[63,42,0.75,0.17],[70,80,1,0.21],[76,25,1.5,0.10],[82,58,1,0.19],
  [88,10,0.75,0.14],[93,85,1,0.17],[2,48,1.5,0.11],[14,70,1,0.21],[22,15,0.75,0.19],
];

/* ─── Avatar ──────────────────────────────────────────── */
function Avatar({ src, username, size = 38, isUnread }) {
  const [failed, setFailed] = useState(false);
  const fallback = `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(username || "?")}`;
  return (
    <img
      src={!failed && src ? src : fallback}
      alt={username}
      onError={() => setFailed(true)}
      style={{
        width: size, height: size,
        borderRadius: Math.round(size * 0.28),
        objectFit: "cover", flexShrink: 0,
        border: `2px solid ${isUnread ? "rgba(168,85,247,0.50)" : "rgba(255,255,255,0.10)"}`,
        boxShadow: isUnread ? "0 0 14px rgba(168,85,247,0.40)" : "none",
        transition: "border-color 0.2s, box-shadow 0.2s",
      }}
    />
  );
}

/* ─── Notification card ───────────────────────────────── */
function NotifCard({ notif, onRead, onDelete }) {
  const navigate  = useNavigate();
  const [hov,      setHov]      = useState(false);
  const [deleting, setDeleting] = useState(false);

  const matchedItems = notif.matchedItems || [];
  const offerItems   = notif.offerItems   || [];
  const isUnread     = !notif.read;

  async function handleRead() {
    if (isUnread) onRead(notif.id);
  }

  async function handleDelete() {
    if (deleting) return;
    setDeleting(true);
    onDelete(notif.id);
  }

  const borderColor = isUnread
    ? hov ? "rgba(168,85,247,0.38)" : "rgba(168,85,247,0.24)"
    : hov ? "rgba(255,255,255,0.11)" : "rgba(255,255,255,0.07)";

  const bgGradient = isUnread
    ? "linear-gradient(160deg, #13112a 0%, #0e1020 100%)"
    : "linear-gradient(160deg, #111520 0%, #0d1018 100%)";

  return (
    <article
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: bgGradient,
        border: `1px solid ${borderColor}`,
        borderRadius: 16,
        overflow: "hidden",
        boxShadow: isUnread
          ? hov
            ? "0 12px 36px rgba(0,0,0,0.55), 0 0 28px rgba(168,85,247,0.12)"
            : "0 6px 24px rgba(0,0,0,0.45), 0 0 18px rgba(168,85,247,0.07)"
          : hov
          ? "0 8px 28px rgba(0,0,0,0.45)"
          : "0 2px 12px rgba(0,0,0,0.35)",
        transition: "box-shadow 0.22s ease, border-color 0.22s ease",
        backdropFilter: "blur(8px)",
      }}
    >
      {/* Top accent bar */}
      <div style={{
        height: 2,
        background: isUnread
          ? "linear-gradient(90deg, transparent, #a855f7 50%, transparent)"
          : "linear-gradient(90deg, transparent, rgba(255,255,255,0.08) 50%, transparent)",
        opacity: isUnread ? (hov ? 1 : 0.8) : 0.4,
        transition: "opacity 0.22s",
      }} />

      <div style={{ padding: "18px 20px 16px" }}>

        {/* ── Header row ── */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16, gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0, flex: 1 }}>
            <Avatar src={notif.senderAvatarUrl} username={notif.senderUsername} size={40} isUnread={isUnread} />
            <div style={{ minWidth: 0 }}>
              <div style={{
                fontSize: 13.5, fontWeight: 700,
                color: isUnread ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.78)",
                lineHeight: 1.2, transition: "color 0.2s",
              }}>
                {notif.senderUsername || "Someone"}
              </div>
              <div style={{
                fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 3,
                display: "flex", alignItems: "center", gap: 5,
              }}>
                <svg width={10} height={10} fill="none" viewBox="0 0 24 24" stroke="rgba(168,85,247,0.55)" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                </svg>
                wants to trade for your items
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>{timeAgo(notif.createdAt)}</span>
            {isUnread && (
              <div style={{
                width: 8, height: 8, borderRadius: "50%",
                background: "#a855f7", flexShrink: 0,
                boxShadow: "0 0 10px rgba(168,85,247,0.70)",
                animation: "tnPulse 2.5s ease-in-out infinite",
              }} />
            )}
          </div>
        </div>

        {/* ── Your items they want ── */}
        {matchedItems.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{
              fontSize: 11, fontWeight: 700, letterSpacing: "0.09em",
              textTransform: "uppercase", color: "#c084fc",
              marginBottom: 10, display: "flex", alignItems: "center", gap: 6,
            }}>
              <div style={{ width: 14, height: 1, background: "rgba(168,85,247,0.40)" }} />
              Your Items They Want
              <span style={{
                fontSize: 10.5, fontWeight: 800, padding: "1px 6px", borderRadius: 4,
                background: "rgba(168,85,247,0.12)", border: "1px solid rgba(168,85,247,0.25)",
                color: "#c084fc",
              }}>{matchedItems.length}</span>
              <div style={{ flex: 1, height: 1, background: "rgba(168,85,247,0.12)" }} />
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {matchedItems.map((item, i) => (
                <TradeItemThumb key={i} item={item} size={100} />
              ))}
            </div>
          </div>
        )}

        {/* ── Their offer ── */}
        {offerItems.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{
              fontSize: 11, fontWeight: 700, letterSpacing: "0.09em",
              textTransform: "uppercase", color: "#22d3ee",
              marginBottom: 10, display: "flex", alignItems: "center", gap: 6,
            }}>
              <div style={{ width: 14, height: 1, background: "rgba(34,211,238,0.35)" }} />
              Their Offer
              <span style={{
                fontSize: 10.5, fontWeight: 800, padding: "1px 6px", borderRadius: 4,
                background: "rgba(34,211,238,0.08)", border: "1px solid rgba(34,211,238,0.20)",
                color: "#22d3ee",
              }}>{offerItems.length}</span>
              <div style={{ flex: 1, height: 1, background: "rgba(34,211,238,0.10)" }} />
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {offerItems.slice(0, 8).map((item, i) => (
                <TradeItemThumb key={i} item={item} size={80} />
              ))}
            </div>
          </div>
        )}

        {/* ── Separator ── */}
        <div style={{ height: 1, background: "rgba(255,255,255,0.05)", marginBottom: 14 }} />

        {/* ── Action buttons ── */}
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap", alignItems: "center" }}>

          {/* Primary: Open trade */}
          <button
            onClick={() => { navigate(`/trade/${notif.tradePostId}`); handleRead(); }}
            style={{
              height: 34, padding: "0 18px",
              background: "linear-gradient(135deg, #7c3aed, #6366f1)",
              border: "none", borderRadius: 9,
              color: "#fff", fontSize: 12, fontWeight: 700,
              cursor: "pointer", fontFamily: "inherit",
              boxShadow: "0 4px 14px rgba(99,102,241,0.30)",
              flexShrink: 0, transition: "opacity 0.15s, box-shadow 0.15s",
            }}
            onMouseEnter={e => { e.currentTarget.style.opacity = "0.90"; e.currentTarget.style.boxShadow = "0 6px 20px rgba(124,58,237,0.40)"; }}
            onMouseLeave={e => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.boxShadow = "0 4px 14px rgba(99,102,241,0.30)"; }}
          >
            Open Trade Post
          </button>

          {/* DM */}
          <a
            href={`/chat?dm=${notif.senderUserId}`}
            onClick={handleRead}
            style={{
              height: 34, padding: "0 16px",
              background: "rgba(34,211,238,0.07)", border: "1px solid rgba(34,211,238,0.20)",
              borderRadius: 9, color: "#22d3ee", fontSize: 12, fontWeight: 600,
              cursor: "pointer", fontFamily: "inherit", textDecoration: "none",
              display: "flex", alignItems: "center",
              flexShrink: 0, transition: "background 0.15s, border-color 0.15s",
            }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(34,211,238,0.14)"; e.currentTarget.style.borderColor = "rgba(34,211,238,0.35)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "rgba(34,211,238,0.07)"; e.currentTarget.style.borderColor = "rgba(34,211,238,0.20)"; }}
          >
            DM
          </a>

          {/* Steam */}
          {notif.senderSteamId && (
            <a
              href={`https://steamcommunity.com/profiles/${notif.senderSteamId}`}
              target="_blank" rel="noopener noreferrer"
              style={{
                height: 34, padding: "0 14px",
                background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)",
                borderRadius: 9, color: "rgba(255,255,255,0.40)", fontSize: 12, fontWeight: 600,
                cursor: "pointer", fontFamily: "inherit", textDecoration: "none",
                display: "flex", alignItems: "center",
                flexShrink: 0, transition: "background 0.15s, color 0.15s",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "rgba(255,255,255,0.70)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; e.currentTarget.style.color = "rgba(255,255,255,0.40)"; }}
            >
              Steam ↗
            </a>
          )}

          <div style={{ flex: 1 }} />

          {/* Mark as read */}
          {isUnread && (
            <button
              onClick={handleRead}
              style={{
                height: 30, padding: "0 12px",
                background: "rgba(74,222,128,0.06)", border: "1px solid rgba(74,222,128,0.14)",
                borderRadius: 8, color: "rgba(74,222,128,0.65)", fontSize: 11.5, fontWeight: 600,
                cursor: "pointer", fontFamily: "inherit", flexShrink: 0,
                display: "flex", alignItems: "center", gap: 4,
                transition: "background 0.15s, color 0.15s",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = "rgba(74,222,128,0.12)"; e.currentTarget.style.color = "#4ade80"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "rgba(74,222,128,0.06)"; e.currentTarget.style.color = "rgba(74,222,128,0.65)"; }}
            >
              <svg width={10} height={10} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Read
            </button>
          )}

          {/* Dismiss */}
          <button
            onClick={handleDelete}
            disabled={deleting}
            style={{
              height: 30, padding: "0 12px",
              background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.12)",
              borderRadius: 8, color: "rgba(248,113,113,0.50)", fontSize: 11.5, fontWeight: 600,
              cursor: deleting ? "not-allowed" : "pointer", fontFamily: "inherit", flexShrink: 0,
              opacity: deleting ? 0.4 : 1, transition: "background 0.15s, color 0.15s",
            }}
            onMouseEnter={e => { if (!deleting) { e.currentTarget.style.background = "rgba(239,68,68,0.10)"; e.currentTarget.style.color = "#f87171"; } }}
            onMouseLeave={e => { e.currentTarget.style.background = "rgba(239,68,68,0.05)"; e.currentTarget.style.color = "rgba(248,113,113,0.50)"; }}
          >
            {deleting ? "…" : "Dismiss"}
          </button>
        </div>
      </div>
    </article>
  );
}

/* ─── Empty state ─────────────────────────────────────── */
function EmptyState({ onBrowse }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: "80px 24px", textAlign: "center", gap: 20,
      borderRadius: 20,
      background: "rgba(168,85,247,0.02)", border: "1px solid rgba(168,85,247,0.09)",
    }}>
      {/* Outer glow ring */}
      <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{
          position: "absolute",
          width: 90, height: 90, borderRadius: "50%",
          background: "radial-gradient(circle, rgba(168,85,247,0.18) 0%, transparent 70%)",
          filter: "blur(12px)",
        }} />
        <div style={{
          width: 64, height: 64, borderRadius: 20,
          background: "rgba(168,85,247,0.06)",
          border: "1px solid rgba(168,85,247,0.18)",
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 0 28px rgba(168,85,247,0.12), inset 0 1px 0 rgba(255,255,255,0.05)",
          position: "relative",
        }}>
          <svg width={28} height={28} fill="none" viewBox="0 0 24 24" stroke="rgba(168,85,247,0.65)" strokeWidth={1.4}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
          </svg>
        </div>
      </div>

      <div style={{ maxWidth: 320 }}>
        <div style={{
          fontSize: 18, fontWeight: 700, marginBottom: 8,
          background: "linear-gradient(135deg, rgba(255,255,255,0.80) 0%, rgba(168,85,247,0.70) 100%)",
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
        }}>
          No trade matches yet
        </div>
        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.30)", lineHeight: 1.70, margin: 0 }}>
          You'll be notified here when someone posts a trade looking for items in your inventory.
        </p>
      </div>

      <button
        onClick={onBrowse}
        style={{
          height: 38, padding: "0 24px",
          background: "rgba(168,85,247,0.09)", border: "1px solid rgba(168,85,247,0.25)",
          borderRadius: 10, color: "#c084fc", fontSize: 13, fontWeight: 600,
          cursor: "pointer", fontFamily: "inherit",
          boxShadow: "0 0 18px rgba(168,85,247,0.08)",
          transition: "all 0.15s",
        }}
        onMouseEnter={e => { e.currentTarget.style.background = "rgba(168,85,247,0.16)"; e.currentTarget.style.boxShadow = "0 0 24px rgba(168,85,247,0.16)"; }}
        onMouseLeave={e => { e.currentTarget.style.background = "rgba(168,85,247,0.09)"; e.currentTarget.style.boxShadow = "0 0 18px rgba(168,85,247,0.08)"; }}
      >
        Browse Trade Board
      </button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   Trade Notifications Page
═══════════════════════════════════════════════════════ */
const POLL_MS = 15_000;

export default function TradeNotificationsPage() {
  const { isAuthed } = useAuth();
  const navigate     = useNavigate();

  const [notifications, setNotifications] = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [unread,        setUnread]        = useState(0);

  const load = useCallback(async (silent = false) => {
    if (!isAuthed) return;
    try {
      const res = await api.get("/trades/notifications");
      if (res.data.ok) {
        const notifs = res.data.notifications;
        setNotifications(notifs);
        setUnread(notifs.filter(n => !n.read).length);
      }
    } catch (err) {
      console.warn("[TRADE NOTIFS] fetch error:", err.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [isAuthed]);

  useEffect(() => { load(false); }, [load]);

  useEffect(() => {
    if (!isAuthed) return;
    const timer = setInterval(() => load(true), POLL_MS);
    return () => clearInterval(timer);
  }, [isAuthed, load]);

  useEffect(() => {
    function handler(e) {
      const { notification } = e.detail || {};
      if (!notification) return;
      setNotifications(prev => {
        if (prev.some(n => n.id === notification.id)) return prev;
        return [notification, ...prev];
      });
      setUnread(n => n + 1);
    }
    window.addEventListener("trade:match", handler);
    return () => window.removeEventListener("trade:match", handler);
  }, []);

  async function handleRead(id) {
    api.patch(`/trades/notifications/${id}/read`).catch(() => {});
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    setUnread(n => Math.max(0, n - 1));
  }

  async function handleDelete(id) {
    api.delete(`/trades/notifications/${id}`).catch(() => {});
    const notif = notifications.find(n => n.id === id);
    setNotifications(prev => prev.filter(n => n.id !== id));
    if (notif && !notif.read) setUnread(n => Math.max(0, n - 1));
  }

  async function handleMarkAllRead() {
    api.post("/trades/notifications/read-all").catch(() => {});
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    setUnread(0);
  }

  /* ─── Not authed ── */
  if (!isAuthed) {
    return (
      <div style={{ minHeight: "100vh", background: "#07080f", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontSize: 14, color: "rgba(255,255,255,0.30)" }}>Please log in to view notifications.</div>
      </div>
    );
  }

  /* ─── Render ── */
  return (
    <div style={{ background: "#07080f", position: "relative", minHeight: "100vh", color: "#fff" }}>

      <style>{`
        @keyframes tnNebula    { 0%,100%{opacity:0.60;transform:scale(1)} 50%{opacity:0.88;transform:scale(1.05)} }
        @keyframes tnBlob      { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(12px,-18px) scale(1.06)} }
        @keyframes tnStreak    { 0%,100%{opacity:0.05;transform:translateY(0)} 50%{opacity:0.12;transform:translateY(-12px)} }
        @keyframes tnParticle  { 0%,100%{opacity:0.14;transform:scale(1)} 50%{opacity:0.30;transform:scale(1.5)} }
        @keyframes tnBreath    { 0%,100%{opacity:0.82} 50%{opacity:0.97} }
        @keyframes tnSpin      { to{transform:rotate(360deg)} }
        @keyframes tnPulse     { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.60;transform:scale(1.4)} }
        @keyframes tnLiveDot   { 0%,100%{opacity:1} 50%{opacity:0.30} }
        @keyframes tnSlideIn   { from{opacity:0;transform:translateY(-6px)} to{opacity:1;transform:translateY(0)} }
      `}</style>

      {/* ── Fixed cinematic background ── */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0, overflow: "hidden" }}>

        {/* Nebula base */}
        <div style={{
          position: "absolute", inset: 0,
          background: [
            "radial-gradient(ellipse 72% 76% at 96% 64%, rgba(88,28,135,0.24) 0%, transparent 60%)",
            "radial-gradient(ellipse 48% 46% at 8% 18%,  rgba(34,211,238,0.04) 0%, transparent 52%)",
            "radial-gradient(ellipse 54% 50% at 28% 90%, rgba(109,40,217,0.10) 0%, transparent 56%)",
            "radial-gradient(ellipse 40% 34% at 62% 6%,  rgba(168,85,247,0.05) 0%, transparent 48%)",
          ].join(","),
          animation: "tnNebula 22s ease-in-out infinite",
        }} />

        {/* Floating fog blobs */}
        <div style={{
          position: "absolute", right: "0%", top: "8%", width: 420, height: 500,
          background: "radial-gradient(ellipse at 65% 45%, rgba(88,28,135,0.22) 0%, rgba(109,40,217,0.10) 45%, transparent 70%)",
          filter: "blur(70px)",
          animation: "tnBlob 26s ease-in-out infinite",
        }} />
        <div style={{
          position: "absolute", right: "4%", bottom: "2%", width: 360, height: 420,
          background: "radial-gradient(ellipse at 55% 55%, rgba(139,92,246,0.20) 0%, transparent 66%)",
          filter: "blur(56px)",
          animation: "tnBlob 32s ease-in-out infinite",
          animationDelay: "-14s",
        }} />

        {/* Subtle grid */}
        <div style={{
          position: "absolute", inset: 0,
          backgroundImage: [
            "linear-gradient(rgba(168,85,247,0.011) 1px, transparent 1px)",
            "linear-gradient(90deg, rgba(168,85,247,0.011) 1px, transparent 1px)",
          ].join(","),
          backgroundSize: "72px 72px",
        }} />

        {/* Vertical streaks */}
        {[["20%","10%","72%"],["52%","18%","65%"],["78%","6%","80%"]].map(([x, t, h], i) => (
          <div key={i} style={{
            position: "absolute", left: x, top: t, width: 1, height: h,
            background: "linear-gradient(180deg, transparent 0%, rgba(168,85,247,0.08) 40%, rgba(168,85,247,0.05) 65%, transparent 100%)",
            animation: `tnStreak ${15 + i * 4}s ease-in-out infinite`,
            animationDelay: `${i * 3.5}s`,
          }} />
        ))}

        {/* Stars */}
        {BG_STARS.map(([x, y, sz, op], i) => (
          <div key={i} style={{
            position: "absolute", left: `${x}%`, top: `${y}%`,
            width: sz, height: sz, borderRadius: "50%",
            background: i % 6 === 0 ? `rgba(255,255,255,${op * 0.82})` : `rgba(168,85,247,${op})`,
            boxShadow: sz > 1 ? `0 0 ${sz * 3}px rgba(168,85,247,${op * 0.45})` : "none",
            animation: i % 4 === 0 ? `tnParticle ${7 + (i % 5) * 1.2}s ease-in-out infinite` : "none",
            animationDelay: `${(i * 0.38) % 6}s`,
          }} />
        ))}

        {/* ── Cinematic trade image — bottom-right, large ── */}
        <div className="hidden lg:block" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>

          {/* Deep atmospheric glow behind image */}
          <div style={{
            position: "absolute", bottom: "-6%", right: "-8%", width: "52%", height: "84%",
            background: "radial-gradient(ellipse 60% 70% at 68% 90%, rgba(88,28,135,0.46) 0%, rgba(109,40,217,0.24) 40%, transparent 68%)",
            filter: "blur(60px)",
          }} />

          {/* Cyan rim accent */}
          <div style={{
            position: "absolute", bottom: "10%", right: "28%", width: 2, height: "44%",
            background: "linear-gradient(180deg, transparent, rgba(168,85,247,0.28), rgba(34,211,238,0.12), transparent)",
          }} />

          {/* Image */}
          <img
            src={tradeAlImg}
            alt="" aria-hidden="true" draggable={false}
            style={{
              position: "absolute",
              bottom: 0,
              right: "-1%",
              height: "88vh",
              maxHeight: 960,
              width: "auto",
              objectFit: "contain",
              objectPosition: "bottom right",
              filter: "drop-shadow(0 0 52px rgba(168,85,247,0.50)) drop-shadow(0 0 110px rgba(109,40,217,0.24))",
              maskImage: "radial-gradient(ellipse 72% 96% at 84% 100%, black 0%, rgba(0,0,0,0.95) 15%, rgba(0,0,0,0.80) 35%, rgba(0,0,0,0.50) 56%, rgba(0,0,0,0.16) 74%, transparent 90%)",
              WebkitMaskImage: "radial-gradient(ellipse 72% 96% at 84% 100%, black 0%, rgba(0,0,0,0.95) 15%, rgba(0,0,0,0.80) 35%, rgba(0,0,0,0.50) 56%, rgba(0,0,0,0.16) 74%, transparent 90%)",
              userSelect: "none",
              animation: "tnBreath 9s ease-in-out infinite",
            }}
          />
        </div>
      </div>

      {/* ── Content layer ── */}
      <div style={{ position: "relative", zIndex: 1, minHeight: "100vh" }}>
        <div style={{ maxWidth: 860, margin: "0 auto", padding: "clamp(24px,5vw,44px) clamp(16px,4vw,28px) 80px", display: "flex", flexDirection: "column", gap: 32 }}>

          {/* ── PAGE HEADER ── */}
          <header style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "flex-start", justifyContent: "space-between" }}>
            <div>
              {/* Live indicator */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <span style={{
                  width: 6, height: 6, borderRadius: "50%", background: "#a855f7",
                  display: "inline-block", animation: "tnLiveDot 2.5s ease-in-out infinite",
                  boxShadow: "0 0 8px rgba(168,85,247,0.70)",
                }} />
                <span style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.18em", color: "rgba(168,85,247,0.60)" }}>
                  Trade Matches
                </span>
              </div>

              <h1 style={{
                fontSize: 32, fontWeight: 800, letterSpacing: "-0.025em", lineHeight: 1, margin: "0 0 10px",
                background: "linear-gradient(135deg, #fff 30%, rgba(168,85,247,0.80) 100%)",
                WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
              }}>
                Notifications
              </h1>

              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", lineHeight: 1.65, maxWidth: 380, margin: 0 }}>
                Real-time alerts when traders are looking for items you own.
              </p>
            </div>

            {/* Right: stats + actions */}
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>

              {/* Stats strip */}
              <div style={{
                display: "flex", alignItems: "center",
                borderRadius: 10, overflow: "hidden",
                border: "1px solid rgba(168,85,247,0.16)",
                background: "rgba(168,85,247,0.03)", backdropFilter: "blur(8px)",
              }}>
                {[
                  { label: "Unread",  value: unread,                highlight: unread > 0 },
                  { label: "Total",   value: notifications.length,  highlight: false },
                ].map((s, i) => (
                  <div key={s.label} style={{
                    display: "flex", flexDirection: "column", alignItems: "center",
                    padding: "8px 18px", gap: 2,
                    borderLeft: i > 0 ? "1px solid rgba(255,255,255,0.06)" : "none",
                  }}>
                    <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.11em", color: "rgba(168,85,247,0.55)" }}>
                      {s.label}
                    </span>
                    <span style={{
                      fontSize: 16, fontWeight: 800, lineHeight: 1.2,
                      color: s.highlight ? "#c084fc" : "rgba(255,255,255,0.88)",
                    }}>
                      {s.value}
                    </span>
                  </div>
                ))}
              </div>

              <div style={{ width: 1, height: 28, background: "rgba(255,255,255,0.07)" }} />

              {/* Ghost buttons */}
              {[
                { label: loading ? "Loading…" : "Refresh",       onClick: () => load(false), disabled: loading },
                { label: "Mark all read", onClick: handleMarkAllRead, disabled: !unread },
              ].map(btn => (
                <button
                  key={btn.label}
                  onClick={btn.onClick}
                  disabled={btn.disabled}
                  style={{
                    padding: "7px 13px", borderRadius: 8,
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "rgba(255,255,255,0.03)",
                    fontSize: 12.5, fontWeight: 500, fontFamily: "inherit",
                    color: btn.disabled ? "rgba(255,255,255,0.20)" : "rgba(255,255,255,0.50)",
                    cursor: btn.disabled ? "not-allowed" : "pointer", transition: "all 0.15s",
                  }}
                  onMouseEnter={e => { if (!btn.disabled) { e.currentTarget.style.background = "rgba(255,255,255,0.07)"; e.currentTarget.style.color = "rgba(255,255,255,0.82)"; } }}
                  onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.03)"; e.currentTarget.style.color = btn.disabled ? "rgba(255,255,255,0.20)" : "rgba(255,255,255,0.50)"; }}
                >
                  {btn.label}
                </button>
              ))}
            </div>
          </header>

          {/* ── Nav tabs ── */}
          <div style={{ display: "flex", gap: 4, marginTop: -16 }}>
            {[
              { label: "Trade Board", onClick: () => navigate("/trade") },
              { label: "My Posts",    onClick: () => navigate("/trade", { state: { tab: "mine" } }) },
            ].map(({ label, onClick }) => (
              <button key={label} onClick={onClick}
                style={{
                  height: 34, padding: "0 18px", borderRadius: 8,
                  fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                  background: "transparent", border: "1px solid transparent",
                  color: "rgba(255,255,255,0.38)", transition: "all 0.15s",
                }}
                onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.09)"; e.currentTarget.style.color = "rgba(255,255,255,0.78)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "transparent"; e.currentTarget.style.color = "rgba(255,255,255,0.38)"; }}
              >
                {label}
              </button>
            ))}

            {/* Active tab */}
            <button style={{
              height: 34, padding: "0 18px", borderRadius: 8,
              fontSize: 12.5, fontWeight: 600, cursor: "default", fontFamily: "inherit",
              background: "rgba(168,85,247,0.10)", border: "1px solid rgba(168,85,247,0.28)",
              color: "#c084fc",
              display: "flex", alignItems: "center", gap: 6,
              boxShadow: "0 0 14px rgba(168,85,247,0.08)",
            }}>
              Notifications
              {unread > 0 && (
                <span style={{
                  background: "#8b5cf6", color: "#fff",
                  fontSize: 10.5, fontWeight: 800, padding: "1px 6px",
                  borderRadius: 4, lineHeight: 1.6,
                  boxShadow: "0 0 8px rgba(139,92,246,0.55)",
                }}>
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </button>
          </div>

          {/* ── Content ── */}
          {loading ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "80px 0", gap: 16 }}>
              <svg width={30} height={30} viewBox="0 0 32 32" fill="none" style={{ animation: "tnSpin 1s linear infinite" }}>
                <circle cx="16" cy="16" r="12" stroke="rgba(168,85,247,0.18)" strokeWidth="3" />
                <path d="M16 4 A12 12 0 0 1 28 16" stroke="#a855f7" strokeWidth="3" strokeLinecap="round" />
              </svg>
              <span style={{ fontSize: 12, color: "rgba(255,255,255,0.25)" }}>Loading notifications…</span>
            </div>
          ) : notifications.length === 0 ? (
            <EmptyState onBrowse={() => navigate("/trade")} />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {notifications.map(n => (
                <NotifCard
                  key={n.id}
                  notif={n}
                  onRead={handleRead}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
