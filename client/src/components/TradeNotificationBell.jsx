import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import api from "../lib/api";
import { TradeItemThumb } from "../pages/trade/TradeItemCard";
import useAuth from "../hooks/useAuth";
import useTradeUnreadCount, { resetTradeUnreadCount } from "../hooks/useTradeUnreadCount";

function timeAgo(iso) {
  if (!iso) return "";
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60_000), h = Math.floor(m / 60), day = Math.floor(h / 24);
  if (day > 0) return `${day}d ago`;
  if (h   > 0) return `${h}h ago`;
  if (m   > 0) return `${m}m ago`;
  return "just now";
}

export default function TradeNotificationBell() {
  const { isAuthed } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const unread = useTradeUnreadCount(isAuthed);
  const ref = useRef(null);

  const loadNotifications = useCallback(async () => {
    if (!isAuthed) return;
    try {
      const res = await api.get("/trades/notifications");
      if (res.data.ok) setNotifications(res.data.notifications);
    } catch { /* ignore */ }
  }, [isAuthed]);

  /* Close dropdown on outside click */
  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  async function handleOpen() {
    if (!open) {
      await loadNotifications();
      /* Mark all read */
      if (unread > 0) {
        api.post("/trades/notifications/read-all").catch(() => {});
        resetTradeUnreadCount();
        setNotifications(prev => prev.map(n => ({ ...n, read: true })));
      }
    }
    setOpen(o => !o);
  }

  async function handleMarkRead(id) {
    api.patch(`/trades/notifications/${id}/read`).catch(() => {});
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  }

  if (!isAuthed) return null;

  return (
    <div ref={ref} style={{ position:"relative" }}>
      {/* Bell button */}
      <button
        onClick={handleOpen}
        title="Trade notifications"
        style={{
          position:"relative", width:36, height:36, borderRadius:10,
          display:"flex", alignItems:"center", justifyContent:"center",
          background: open ? "rgba(168,85,247,0.12)" : unread > 0 ? "rgba(168,85,247,0.07)" : "rgba(255,255,255,0.04)",
          border: open ? "1px solid rgba(168,85,247,0.35)" : unread > 0 ? "1px solid rgba(168,85,247,0.22)" : "1px solid rgba(255,255,255,0.08)",
          cursor:"pointer", transition:"all 0.15s",
        }}
      >
        <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
          style={{ color: unread > 0 ? "rgba(168,85,247,0.8)" : "rgba(255,255,255,0.4)" }}>
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M8 17h8M5.5 17H4a1 1 0 01-.8-1.6l1.3-1.7V9a7 7 0 1114 0v4.7l1.3 1.7A1 1 0 0119 17h-1.5M10 21a2 2 0 004 0" />
        </svg>
        {unread > 0 && (
          <span style={{
            position:"absolute", top:-4, right:-4,
            minWidth:15, height:15, padding:"0 3px", borderRadius:4,
            fontSize:8.5, fontWeight:800, lineHeight:1, display:"flex", alignItems:"center", justifyContent:"center",
            background:"rgba(168,85,247,0.9)", border:"1px solid rgba(168,85,247,0.4)",
            color:"#fff", boxShadow:"0 1px 4px rgba(0,0,0,0.5)",
          }}>
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          position:"absolute", top:"calc(100% + 8px)", right:0, zIndex:9000,
          width:340, maxHeight:480, display:"flex", flexDirection:"column",
          background:"rgba(12,17,28,0.98)", border:"1px solid rgba(168,85,247,0.2)",
          borderRadius:12, boxShadow:"0 12px 40px rgba(0,0,0,0.55)",
          overflow:"hidden",
        }}>
          {/* Header */}
          <div style={{ padding:"12px 14px 10px", borderBottom:"1px solid rgba(255,255,255,0.06)", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <div style={{ fontSize:12, fontWeight:700, color:"rgba(255,255,255,0.82)" }}>Trade Matches</div>
            <button onClick={() => { navigate("/trade/notifications"); setOpen(false); }} style={{ fontSize:11, color:"rgba(168,85,247,0.7)", background:"none", border:"none", cursor:"pointer", fontFamily:"inherit", padding:0 }}>
              View All →
            </button>
          </div>

          {/* List */}
          <div style={{ overflowY:"auto", flex:1 }}>
            {notifications.length === 0 ? (
              <div style={{ padding:"24px 14px", textAlign:"center", fontSize:12, color:"rgba(255,255,255,0.22)" }}>
                No trade match notifications yet.
              </div>
            ) : notifications.map(n => (
              <NotifRow key={n.id} n={n} onRead={() => handleMarkRead(n.id)} onClose={() => setOpen(false)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function NotifRow({ n, onRead, onClose }) {
  const navigate = useNavigate();
  const first = n.matchedItems?.[0];

  return (
    <div
      style={{
        padding:"10px 14px",
        borderBottom:"1px solid rgba(255,255,255,0.04)",
        background: n.read ? "transparent" : "rgba(168,85,247,0.04)",
        cursor:"default",
      }}
    >
      {/* Top row: avatar + text */}
      <div style={{ display:"flex", gap:8, alignItems:"flex-start", marginBottom:8 }}>
        {first && <TradeItemThumb item={first} size={36} />}
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:11, color:"rgba(255,255,255,0.72)", lineHeight:1.4 }}>
            <span style={{ fontWeight:700, color:"rgba(255,255,255,0.9)" }}>{n.senderUsername}</span>
            {" is looking for "}
            <span style={{ fontWeight:600, color:"rgba(168,85,247,0.85)" }}>{first?.name || "an item"}</span>
            {n.matchedItems?.length > 1 && ` +${n.matchedItems.length - 1} more`}
            {" that you own"}
          </div>
          <div style={{ fontSize:9.5, color:"rgba(255,255,255,0.25)", marginTop:2 }}>{timeAgo(n.createdAt)}</div>
        </div>
        {!n.read && <div style={{ width:6, height:6, borderRadius:"50%", background:"rgba(168,85,247,0.9)", flexShrink:0, marginTop:4 }} />}
      </div>

      {/* Action buttons */}
      <div style={{ display:"flex", gap:6 }}>
        <button
          onClick={() => { navigate(`/trade/${n.tradePostId}`); onRead(); onClose(); }}
          style={{ flex:1, height:26, borderRadius:6, background:"rgba(168,85,247,0.1)", border:"1px solid rgba(168,85,247,0.22)", color:"rgba(168,85,247,0.8)", fontSize:10, fontWeight:600, cursor:"pointer", fontFamily:"inherit" }}
        >
          View Post
        </button>
        <a
          href={`/chat?dm=${n.senderUserId}`}
          style={{ flex:1, height:26, borderRadius:6, background:"rgba(34,211,238,0.06)", border:"1px solid rgba(34,211,238,0.18)", color:"rgba(34,211,238,0.7)", fontSize:10, fontWeight:600, cursor:"pointer", fontFamily:"inherit", textDecoration:"none", display:"flex", alignItems:"center", justifyContent:"center" }}
          onClick={onClose}
        >
          Chat
        </a>
        {n.senderSteamId && (
          <a
            href={`https://steamcommunity.com/profiles/${n.senderSteamId}`}
            target="_blank" rel="noopener noreferrer"
            style={{ width:26, height:26, borderRadius:6, border:"1px solid rgba(255,255,255,0.07)", background:"rgba(255,255,255,0.03)", color:"rgba(255,255,255,0.3)", display:"flex", alignItems:"center", justifyContent:"center", textDecoration:"none", flexShrink:0, fontSize:10 }}
          >
            <svg width={11} height={11} viewBox="0 0 32 32" fill="currentColor">
              <path d="M16 0C7.163 0 0 7.163 0 16c0 7.3 4.9 13.48 11.67 15.37L16 16h1.54c4.7 0 8.51-3.81 8.51-8.51S22.24 0 16 0zM7.06 22.7l-1.94-.8a6.4 6.4 0 0 0 4.63 2.68L7.06 22.7zm9-7.7a5.09 5.09 0 1 1 0-10.18 5.09 5.09 0 0 1 0 10.18z" />
            </svg>
          </a>
        )}
      </div>
    </div>
  );
}
