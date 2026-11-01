import { useState, useEffect, useRef, useCallback } from "react";
import api from "../../lib/api";
import useAuth from "../../hooks/useAuth";
import { useSocket } from "../../context/SocketContext";
import { TradeItemThumb } from "./TradeItemCard";
import TradeItemCard from "./TradeItemCard";

/* ─── helpers ─────────────────────────────────────── */
function timeAgo(iso) {
  if (!iso) return "";
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60_000), h = Math.floor(m / 60), day = Math.floor(h / 24);
  if (day > 0) return `${day}d ago`;
  if (h   > 0) return `${h}h ago`;
  if (m   > 0) return `${m}m ago`;
  return "just now";
}

function Avatar({ src, username, size = 34 }) {
  const [failed, setFailed] = useState(false);
  const fallback = `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(username || "?")}`;
  return (
    <img
      src={!failed && src ? src : fallback}
      alt={username}
      onError={() => setFailed(true)}
      style={{ width: size, height: size, borderRadius: size * 0.28, objectFit: "cover", border: "1px solid rgba(0,0,0,0.08)", flexShrink: 0 }}
    />
  );
}

/* ─── Compact original post preview ─────────────── */
function OriginalPost({ post }) {
  const MAX = 4;
  const offerShown  = (post.myOfferItems  || []).slice(0, MAX);
  const offerExtra  = (post.myOfferItems  || []).length - MAX;
  const lookShown   = (post.lookingForItems || []).slice(0, MAX);
  const lookExtra   = (post.lookingForItems || []).length - MAX;

  function OverflowBadge({ n, color }) {
    return (
      <div style={{
        width: 60, height: 60, borderRadius: 10, flexShrink: 0,
        background: "#f8fafc", border: `1px dashed ${color}55`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 11, fontWeight: 700, color,
      }}>+{n}</div>
    );
  }

  return (
    <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 14, padding: "14px 16px", flexShrink: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <Avatar src={post.ownerAvatarUrl} username={post.ownerUsername} size={28} />
        <div>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: "#0f172a" }}>{post.ownerUsername}</span>
          <span style={{ fontSize: 10.5, color: "#94a3b8", marginLeft: 6 }}>· original post · {timeAgo(post.createdAt)}</span>
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        {/* Offer */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#06b6d4", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>Offering</div>
          {offerShown.length === 0
            ? <div style={{ fontSize: 11, color: "#94a3b8", fontStyle: "italic" }}>Anything</div>
            : <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {offerShown.map((i, idx) => <TradeItemThumb key={idx} item={i} size={60} />)}
                {offerExtra > 0 && <OverflowBadge n={offerExtra} color="#06b6d4" />}
              </div>
          }
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, paddingTop: 18, flexShrink: 0 }}>
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#c7d2fe" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4" />
          </svg>
          <div style={{ width: 1, height: 8, background: "#e2e8f0" }} />
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#c7d2fe" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 8v12m0 0l4-4m-4 4l-4-4" />
          </svg>
        </div>

        {/* Looking For */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#8b5cf6", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>Looking For</div>
          {lookShown.length === 0
            ? <div style={{ fontSize: 11, color: "#94a3b8", fontStyle: "italic" }}>Any offers</div>
            : <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {lookShown.map((i, idx) => <TradeItemThumb key={idx} item={i} size={60} />)}
                {lookExtra > 0 && <OverflowBadge n={lookExtra} color="#8b5cf6" />}
              </div>
          }
        </div>
      </div>

      {post.message && (
        <div style={{ marginTop: 10, fontSize: 11.5, color: "#64748b", fontStyle: "italic", paddingTop: 10, borderTop: "1px solid #f1f5f9" }}>
          "{post.message}"
        </div>
      )}
    </div>
  );
}

/* ─── Single comment/offer card ─────────────────── */
function CommentCard({ comment, myUserId }) {
  const isMe = String(comment.senderUserId) === String(myUserId);

  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start", flexDirection: isMe ? "row-reverse" : "row" }}>
      <Avatar src={comment.senderAvatarUrl} username={comment.senderUsername} size={32} />

      <div style={{ maxWidth: "76%", display: "flex", flexDirection: "column", gap: 4, alignItems: isMe ? "flex-end" : "flex-start" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: isMe ? "#6366f1" : "#0f172a" }}>
            {isMe ? "You" : comment.senderUsername}
          </span>
          <span style={{ fontSize: 10, color: "#94a3b8" }}>{timeAgo(comment.createdAt)}</span>
          {comment.offeredItems?.length > 0 && (
            <span style={{ fontSize: 11, fontWeight: 700, color: "#f59e0b", background: "#fef3c720", border: "1px solid #fde68a50", borderRadius: 4, padding: "2px 7px" }}>
              Offer
            </span>
          )}
        </div>

        {comment.offeredItems?.length > 0 && (
          <div style={{
            display: "flex", flexWrap: "wrap", gap: 6, padding: "10px 12px",
            background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12,
            boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
          }}>
            {comment.offeredItems.map((item, i) => (
              <TradeItemThumb key={i} item={item} size={82} />
            ))}
          </div>
        )}

        {comment.message && (
          <div style={{
            padding: "9px 13px",
            background: isMe ? "#eef2ff" : "#f8fafc",
            border: `1px solid ${isMe ? "#c7d2fe" : "#e2e8f0"}`,
            borderRadius: 12,
            fontSize: 13.5, color: "#0f172a", lineHeight: 1.5,
          }}>
            {comment.message}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Inventory item picker (mini) ──────────────── */
function ItemPicker({ inventory, selected, onToggle, onClose }) {
  const [search, setSearch] = useState("");
  const displayed = inventory.filter(item => {
    if (!search.trim()) return true;
    return (item.name || item.marketHashName || "").toLowerCase().includes(search.toLowerCase());
  });

  return (
    <div style={{
      position: "absolute", bottom: "calc(100% + 8px)", left: 0, right: 0,
      background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 14,
      boxShadow: "0 -8px 28px rgba(0,0,0,0.1)",
      zIndex: 100, padding: 14,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "#0f172a" }}>Select items to offer</span>
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "#94a3b8", lineHeight: 1 }}>×</button>
      </div>

      {selected.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, padding: "8px 10px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, marginBottom: 10 }}>
          {selected.map((item, i) => (
            <div key={i} onClick={() => onToggle(item)} style={{ cursor: "pointer" }}>
              <TradeItemCard item={item} onRemove={() => onToggle(item)} />
            </div>
          ))}
        </div>
      )}

      <div style={{ position: "relative", marginBottom: 10 }}>
        <svg style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}
          width={12} height={12} fill="none" viewBox="0 0 24 24" stroke="#94a3b8" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={`Search ${inventory.length} items…`}
          style={{ width: "100%", height: 32, padding: "0 10px 0 28px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 7, fontSize: 12, outline: "none", fontFamily: "inherit", boxSizing: "border-box", color: "#0f172a" }}
        />
      </div>

      {inventory.length === 0 ? (
        <div style={{ textAlign: "center", padding: "20px 0", fontSize: 12, color: "#94a3b8" }}>
          No synced inventory — use the Chrome extension.
        </div>
      ) : (
        <div style={{ maxHeight: 220, overflowY: "auto", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(86px, 1fr))", gap: 7 }}>
          {displayed.map((item, i) => {
            const isSel = selected.some(s => s.assetId === item.assetId);
            return (
              <div key={i} onClick={() => onToggle(item)} style={{ cursor: "pointer" }}>
                <TradeItemCard item={item} selected={isSel} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─── Composer ──────────────────────────────────── */
function Composer({ tradePostId, inventory, onSent }) {
  const [message,      setMessage]      = useState("");
  const [offeredItems, setOfferedItems] = useState([]);
  const [showPicker,   setShowPicker]   = useState(false);
  const [sending,      setSending]      = useState(false);
  const [error,        setError]        = useState(null);

  function toggleItem(item) {
    const key = item.assetId;
    if (offeredItems.find(i => i.assetId === key)) {
      setOfferedItems(prev => prev.filter(i => i.assetId !== key));
    } else {
      setOfferedItems(prev => [...prev, item]);
    }
  }

  async function handleSend() {
    if (!message.trim() && !offeredItems.length) return;
    setSending(true); setError(null);
    try {
      const res = await api.post(`/trades/${tradePostId}/comments`, {
        offeredItems,
        message: message.trim(),
      });
      if (res.data.ok) {
        onSent(res.data.comment);
        setMessage("");
        setOfferedItems([]);
        setShowPicker(false);
      } else {
        setError(res.data.error || "Failed to send.");
      }
    } catch (err) {
      setError(err?.response?.data?.error || "Network error.");
    } finally {
      setSending(false);
    }
  }

  function handleKey(e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }

  return (
    <div style={{ borderTop: "1px solid #f1f5f9", padding: "12px 16px", background: "#fafafa", flexShrink: 0, position: "relative" }}>
      {/* Selected offered items preview */}
      {offeredItems.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 10, padding: "8px 10px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8 }}>
          {offeredItems.map((item, i) => (
            <div key={i} onClick={() => toggleItem(item)} style={{ cursor: "pointer" }}>
              <TradeItemCard item={item} onRemove={() => toggleItem(item)} />
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {/* Item picker toggle */}
        <button
          onClick={() => setShowPicker(v => !v)}
          style={{
            height: 36, padding: "0 14px", borderRadius: 8, flexShrink: 0,
            background: showPicker ? "#eef2ff" : "#f8fafc",
            border: `1px solid ${showPicker ? "#c7d2fe" : "#e2e8f0"}`,
            color: showPicker ? "#6366f1" : "#64748b",
            cursor: "pointer", fontSize: 12.5, fontWeight: 600, fontFamily: "inherit",
          }}
        >
          {offeredItems.length > 0 ? `${offeredItems.length} item${offeredItems.length !== 1 ? "s" : ""} attached` : "Attach Items"}
        </button>

        {/* Message input */}
        <input
          value={message}
          onChange={e => setMessage(e.target.value.slice(0, 500))}
          onKeyDown={handleKey}
          placeholder="Write a message or offer… (Enter to send)"
          style={{
            flex: 1, height: 36, padding: "0 12px",
            background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8,
            color: "#0f172a", fontSize: 13, outline: "none", fontFamily: "inherit",
          }}
        />

        {/* Send */}
        <button
          onClick={handleSend}
          disabled={sending || (!message.trim() && !offeredItems.length)}
          style={{
            height: 36, padding: "0 18px", borderRadius: 8, flexShrink: 0,
            background: (sending || (!message.trim() && !offeredItems.length)) ? "#f1f5f9" : "#6366f1",
            border: "none",
            color: (sending || (!message.trim() && !offeredItems.length)) ? "#94a3b8" : "#ffffff",
            fontSize: 13, fontWeight: 700, cursor: (sending || (!message.trim() && !offeredItems.length)) ? "not-allowed" : "pointer",
            fontFamily: "inherit",
          }}
        >
          {sending ? "…" : "Send"}
        </button>
      </div>

      {error && (
        <div style={{ marginTop: 6, fontSize: 11, color: "#ef4444" }}>{error}</div>
      )}

      {/* Item picker popup */}
      {showPicker && (
        <ItemPicker
          inventory={inventory}
          selected={offeredItems}
          onToggle={toggleItem}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   TradeConversation — main modal
═══════════════════════════════════════════════════ */
export default function TradeConversation({ post, onClose, inventory = [] }) {
  const { user }    = useAuth();
  const { socket }  = useSocket();
  const [comments,  setComments]  = useState([]);
  const [loading,   setLoading]   = useState(true);
  const threadRef   = useRef(null);
  const isOwner     = user && String(post.ownerUserId) === String(user._id);

  /* Load comments + mark read */
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/trades/${post.id}/comments`);
      if (res.data.ok) setComments(res.data.comments);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [post.id]);

  useEffect(() => {
    load();
    if (isOwner) {
      api.patch(`/trades/${post.id}/comments/read`).catch(() => {});
    }
  }, [load, post.id, isOwner]);

  /* Join/leave socket room for live comments */
  useEffect(() => {
    if (!socket) return;
    socket.emit("trade:join-conv", { postId: post.id });

    function handler(e) {
      const { tradePostId, comment } = e.detail || {};
      if (tradePostId !== post.id) return;
      setComments(prev => [...prev, comment]);
    }
    window.addEventListener("trade:comment-added", handler);

    return () => {
      socket.emit("trade:leave-conv", { postId: post.id });
      window.removeEventListener("trade:comment-added", handler);
    };
  }, [socket, post.id]);

  /* Auto-scroll to bottom when new comments arrive */
  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [comments]);

  function handleCommentSent(newComment) {
    setComments(prev => [...prev, newComment]);
  }

  /* Keyboard close */
  useEffect(() => {
    function handler(e) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9100,
        background: "rgba(15,23,42,0.55)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{
        width: "100%", maxWidth: 740, maxHeight: "90vh",
        background: "#ffffff", borderRadius: 20,
        boxShadow: "0 32px 80px rgba(15,23,42,0.2)",
        border: "1px solid rgba(0,0,0,0.08)",
        display: "flex", flexDirection: "column",
        overflow: "hidden",
      }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: "1px solid #f1f5f9", flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.02em" }}>
              Offers & Comments
            </div>
            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>
              {post.ownerUsername}'s trade · {comments.length} message{comments.length !== 1 ? "s" : ""}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ width: 30, height: 30, borderRadius: 7, border: "1px solid #e2e8f0", background: "#f8fafc", color: "#64748b", cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "inherit" }}
          >×</button>
        </div>

        {/* Original post */}
        <div style={{ padding: "12px 16px", flexShrink: 0 }}>
          <OriginalPost post={post} />
        </div>

        {/* Divider */}
        <div style={{ marginTop: 0, padding: "0 16px" }}>
          <div style={{ height: 1, background: "#f1f5f9" }} />
          <div style={{ textAlign: "center", marginTop: -10, marginBottom: 4 }}>
            <span style={{ background: "#fff", padding: "0 10px", fontSize: 10.5, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              {comments.length} offer{comments.length !== 1 ? "s" : ""} & comment{comments.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>

        {/* Thread */}
        <div
          ref={threadRef}
          style={{ flex: 1, overflowY: "auto", minHeight: 0, padding: "4px 16px 12px", display: "flex", flexDirection: "column", gap: 14 }}
        >
          {loading ? (
            <div style={{ display: "flex", justifyContent: "center", padding: "32px 0" }}>
              <svg width={22} height={22} viewBox="0 0 32 32" fill="none" style={{ animation: "conv-spin 1s linear infinite" }}>
                <circle cx="16" cy="16" r="12" stroke="#e2e8f0" strokeWidth="3" />
                <path d="M16 4 A12 12 0 0 1 28 16" stroke="#6366f1" strokeWidth="3" strokeLinecap="round" />
              </svg>
              <style>{`@keyframes conv-spin{to{transform:rotate(360deg)}}`}</style>
            </div>
          ) : comments.length === 0 ? (
            <div style={{ textAlign: "center", padding: "36px 0", color: "#94a3b8" }}>
              <div style={{ fontSize: 13 }}>No offers or comments yet.</div>
              {user && <div style={{ fontSize: 12, marginTop: 4 }}>Be the first to make an offer!</div>}
            </div>
          ) : (
            comments.map(c => (
              <CommentCard key={c.id} comment={c} myUserId={user?._id} />
            ))
          )}
        </div>

        {/* Composer — only for authed non-owner (and owner can respond too) */}
        {user ? (
          <Composer
            tradePostId={post.id}
            inventory={inventory}
            onSent={handleCommentSent}
          />
        ) : (
          <div style={{ borderTop: "1px solid #f1f5f9", padding: "14px 18px", background: "#fafafa", textAlign: "center", fontSize: 12.5, color: "#64748b", flexShrink: 0 }}>
            <a href="/login" style={{ color: "#6366f1", fontWeight: 700 }}>Log in</a> to send offers or comments.
          </div>
        )}
      </div>
    </div>
  );
}
