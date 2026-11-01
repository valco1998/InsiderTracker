import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import api from "../../lib/api";
import useAuth from "../../hooks/useAuth";
import { useSocket } from "../../context/SocketContext";
import { TradeItemThumb } from "./TradeItemCard";
import TradeItemCard from "./TradeItemCard";

import anyKnifeImg  from "../../assets/any_knife.png";
import anyKeyImg    from "../../assets/any_key.png";
import anyCaseImg   from "../../assets/any_case.png";
import anyOffersImg from "../../assets/any_offers.png";
import realMoneyImg from "../../assets/real_money.png";

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

function Avatar({ src, username, size = 40 }) {
  const [failed, setFailed] = useState(false);
  const fallback = `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(username || "?")}`;
  return (
    <img
      src={!failed && src ? src : fallback}
      alt={username}
      onError={() => setFailed(true)}
      style={{ width: size, height: size, borderRadius: size * 0.25, objectFit: "cover", border: "1px solid rgba(0,0,0,0.09)", flexShrink: 0 }}
    />
  );
}

const BUMP_COOLDOWN_MS = 3 * 60 * 60 * 1000;

function bumpCooldownRemaining(post) {
  if (!post?.bumpedAt) return 0;
  return Math.max(0, new Date(post.bumpedAt).getTime() + BUMP_COOLDOWN_MS - Date.now());
}

function formatCooldown(ms) {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/* ─── DEDUP helper — never render same ID twice ─────── */
function addUniqueComment(prev, comment) {
  if (prev.some(c => c.id === comment.id)) return prev;
  return [...prev, comment];
}

/* ═══════════════════════════════════════════════════
   TradePostFull — the original post displayed in full
═══════════════════════════════════════════════════ */
function TradePostFull({ post, onBumped, onClosed, user }) {
  const [bumping, setBumping] = useState(false);
  const [closing, setClosing] = useState(false);
  const isOwner    = user && String(post.ownerUserId) === String(user._id);
  const cooldownMs = bumpCooldownRemaining(post);
  const inCooldown = cooldownMs > 0;

  async function handleBump() {
    if (inCooldown) return;
    setBumping(true);
    try {
      const res = await api.patch(`/trades/${post.id}/bump`);
      if (res.data.ok) onBumped?.(res.data.post);
      else alert(res.data.error || "Could not bump.");
    } catch (err) {
      const d = err?.response?.data;
      if (d?.error === "BUMP_COOLDOWN") alert(`Try again in ${formatCooldown(Math.max(0, new Date(d.nextBumpAt).getTime() - Date.now()))}.`);
      else alert(d?.error || "Network error.");
    } finally { setBumping(false); }
  }

  async function handleClose() {
    if (!confirm("Delete this trade post? This cannot be undone.")) return;
    setClosing(true);
    console.log(`[trade:delete] deleting post id=${post.id} from detail page`);
    try {
      const res = await api.delete(`/trades/${post.id}`);
      console.log(`[trade:delete] response:`, res.data);
      if (res.data.ok) {
        onClosed?.();
      } else {
        alert(res.data.error || "Could not delete.");
      }
    } catch (err) {
      console.error("[trade:delete] error:", err?.response?.data || err.message);
      alert("Network error — could not delete.");
    } finally { setClosing(false); }
  }

  const statusColor = post.status === "active" ? "#10b981" : "#94a3b8";

  return (
    <div style={{ background: "#ffffff", borderRadius: 18, border: "1px solid rgba(0,0,0,0.07)", boxShadow: "0 2px 12px rgba(0,0,0,0.07)", overflow: "hidden" }}>

      {/* Gradient top bar */}
      <div style={{ height: 3, background: "linear-gradient(90deg, #6366f1, #8b5cf6, #06b6d4)" }} />

      {/* Post header */}
      <div style={{ padding: "20px 24px", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Avatar src={post.ownerAvatarUrl} username={post.ownerUsername} size={48} />
          <div>
            <div style={{ fontSize: 17, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.01em" }}>
              {post.ownerUsername || "Unknown"}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3 }}>
              <span style={{ fontSize: 11, color: "#94a3b8" }}>{timeAgo(post.createdAt)}</span>
              {post.bumpedAt && (
                <span style={{ fontSize: 10, color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 4, padding: "1px 7px" }}>
                  bumped {timeAgo(post.bumpedAt)}
                </span>
              )}
              <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, color: statusColor }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: statusColor, display: "inline-block" }} />
                {post.status === "active" ? "Active" : "Closed"}
              </span>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {post.ownerSteamId && (
            <a
              href={`https://steamcommunity.com/profiles/${post.ownerSteamId}`}
              target="_blank" rel="noopener noreferrer"
              style={{ height: 34, padding: "0 14px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, color: "#64748b", fontSize: 12, fontWeight: 600, textDecoration: "none", display: "flex", alignItems: "center", gap: 5 }}
            >
              Steam Profile ↗
            </a>
          )}
          {isOwner && post.status === "active" && (
            <>
              <button
                onClick={handleBump}
                disabled={bumping || inCooldown}
                title={inCooldown ? `Bump in ${formatCooldown(cooldownMs)}` : "Bump to top of feed"}
                style={{
                  height: 34, padding: "0 16px",
                  background: inCooldown ? "#f8fafc" : "#f0fdf4",
                  border: inCooldown ? "1px solid #e2e8f0" : "1px solid #bbf7d0",
                  borderRadius: 8, color: inCooldown ? "#94a3b8" : "#16a34a",
                  fontSize: 12, fontWeight: 700,
                  cursor: (bumping || inCooldown) ? "not-allowed" : "pointer",
                  fontFamily: "inherit",
                }}
              >
                {bumping ? "Bumping…" : inCooldown ? `↑ ${formatCooldown(cooldownMs)}` : "↑ Bump"}
              </button>
              <button
                onClick={handleClose}
                disabled={closing}
                style={{ height: 34, padding: "0 16px", background: "#fff5f5", border: "1px solid #fecaca", borderRadius: 8, color: "#ef4444", fontSize: 12, fontWeight: 700, cursor: closing ? "not-allowed" : "pointer", fontFamily: "inherit" }}
              >
                {closing ? "Closing…" : "Close Trade"}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Items section */}
      <div style={{ padding: "20px 24px", display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 20, alignItems: "start" }}>

        {/* Offering */}
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: "#06b6d4", marginBottom: 10 }}>
            Offering
          </div>
          {!post.myOfferItems?.length ? (
            <div style={{ fontSize: 12, color: "#94a3b8", fontStyle: "italic" }}>Open to anything</div>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {post.myOfferItems.map((item, i) => <TradeItemThumb key={i} item={item} size={100} />)}
            </div>
          )}
        </div>

        {/* Arrows */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, paddingTop: 28 }}>
          <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="#c7d2fe" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4" />
          </svg>
          <div style={{ width: 1, height: 16, background: "#e2e8f0" }} />
          <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="#c7d2fe" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 8v12m0 0l4-4m-4 4l-4-4" />
          </svg>
        </div>

        {/* Looking For */}
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: "#8b5cf6", marginBottom: 10 }}>
            Looking For
          </div>
          {!post.lookingForItems?.length ? (
            <div style={{ fontSize: 12, color: "#94a3b8", fontStyle: "italic" }}>Any offers welcome</div>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {post.lookingForItems.map((item, i) => <TradeItemThumb key={i} item={item} size={100} />)}
            </div>
          )}
        </div>
      </div>

      {/* Message */}
      {post.message && (
        <div style={{ padding: "0 24px 20px", fontSize: 13, color: "#475569", fontStyle: "italic", lineHeight: 1.6, borderTop: "1px solid #f8fafc" }}>
          <div style={{ padding: "12px 16px", background: "#f8fafc", borderLeft: "3px solid #e2e8f0", borderRadius: "0 8px 8px 0" }}>
            "{post.message}"
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   CommentCard — individual offer/comment
═══════════════════════════════════════════════════ */
function CommentCard({ comment, myUserId }) {
  const isMe = String(comment.senderUserId) === String(myUserId);
  const hasItems = comment.offeredItems?.length > 0;

  return (
    <div style={{
      background: "#ffffff",
      border: "1px solid rgba(0,0,0,0.07)",
      borderRadius: 14,
      padding: "16px 18px",
      boxShadow: "0 1px 6px rgba(0,0,0,0.05)",
      borderLeft: isMe ? "3px solid #6366f1" : hasItems ? "3px solid #f59e0b" : "3px solid #e2e8f0",
    }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: hasItems || comment.message ? 12 : 0 }}>
        <Avatar src={comment.senderAvatarUrl} username={comment.senderUsername} size={36} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: isMe ? "#6366f1" : "#0f172a" }}>
              {isMe ? "You" : comment.senderUsername}
            </span>
            {comment.senderSteamId && (
              <a
                href={`https://steamcommunity.com/profiles/${comment.senderSteamId}`}
                target="_blank" rel="noopener noreferrer"
                style={{ fontSize: 10, color: "#94a3b8", textDecoration: "none", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 4, padding: "1px 6px" }}
              >Steam ↗</a>
            )}
            <span style={{ fontSize: 11, color: "#94a3b8" }}>{timeAgo(comment.createdAt)}</span>
          </div>
        </div>
        {hasItems && (
          <span style={{ fontSize: 10.5, fontWeight: 700, color: "#d97706", background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 6, padding: "3px 9px", flexShrink: 0 }}>
            Offer
          </span>
        )}
      </div>

      {/* Offered items */}
      {hasItems && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: comment.message ? 12 : 0 }}>
          {comment.offeredItems.map((item, i) => (
            <TradeItemThumb key={i} item={item} size={92} />
          ))}
        </div>
      )}

      {/* Message */}
      {comment.message && (
        <div style={{
          fontSize: 14, color: "#1e293b", lineHeight: 1.6,
          padding: "10px 14px",
          background: isMe ? "#f5f3ff" : "#f8fafc",
          border: `1px solid ${isMe ? "#e9d5ff" : "#f1f5f9"}`,
          borderRadius: 10,
        }}>
          {comment.message}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   Composer — reply / offer section
═══════════════════════════════════════════════════ */
function Composer({ postId, inventory, onSent }) {
  const [message,       setMessage]       = useState("");
  const [offeredItems,  setOfferedItems]  = useState([]);
  const [showInventory, setShowInventory] = useState(false);
  const [invSearch,     setInvSearch]     = useState("");
  const [sending,       setSending]       = useState(false);
  const [error,         setError]         = useState(null);

  const canSend = message.trim().length > 0 || offeredItems.length > 0;

  function toggleItem(item) {
    const key = item.assetId;
    setOfferedItems(prev =>
      prev.find(i => i.assetId === key)
        ? prev.filter(i => i.assetId !== key)
        : [...prev, item]
    );
  }

  async function handleSend() {
    if (!canSend) return;
    setSending(true); setError(null);
    try {
      const res = await api.post(`/trades/${postId}/comments`, {
        offeredItems,
        message: message.trim(),
      });
      if (res.data.ok) {
        onSent(res.data.comment);
        setMessage(""); setOfferedItems([]); setShowInventory(false); setInvSearch("");
      } else {
        setError(res.data.error || "Failed to send.");
      }
    } catch (err) {
      setError(err?.response?.data?.error || "Network error.");
    } finally { setSending(false); }
  }

  const displayedInv = inventory.filter(item => {
    if (!invSearch.trim()) return true;
    return (item.name || item.marketHashName || "").toLowerCase().includes(invSearch.toLowerCase());
  });

  return (
    <div style={{ background: "#ffffff", borderRadius: 18, border: "1px solid rgba(0,0,0,0.07)", boxShadow: "0 2px 12px rgba(0,0,0,0.07)", overflow: "hidden" }}>

      <div style={{ padding: "16px 20px 6px", borderBottom: "1px solid #f1f5f9" }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>Make an offer or reply</div>
        <div style={{ fontSize: 11.5, color: "#94a3b8", marginTop: 2 }}>Attach items from your inventory, write a message, or both.</div>
      </div>

      <div style={{ padding: "14px 20px" }}>

        {/* Selected offered items */}
        {offeredItems.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7, padding: "10px 12px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10, marginBottom: 12 }}>
            {offeredItems.map((item, i) => (
              <div key={i} onClick={() => toggleItem(item)} style={{ cursor: "pointer" }}>
                <TradeItemCard item={item} onRemove={() => toggleItem(item)} />
              </div>
            ))}
          </div>
        )}

        {/* Textarea */}
        <textarea
          value={message}
          onChange={e => setMessage(e.target.value.slice(0, 500))}
          placeholder="Type your message… e.g. 'I can add overpay', '1:1 trade?', 'B/O only'"
          rows={3}
          style={{
            width: "100%", padding: "10px 14px",
            background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10,
            color: "#0f172a", fontSize: 13.5, lineHeight: 1.5,
            outline: "none", fontFamily: "inherit", resize: "vertical",
            boxSizing: "border-box",
          }}
          onFocus={e => e.target.style.borderColor = "#c7d2fe"}
          onBlur={e => e.target.style.borderColor = "#e2e8f0"}
        />

        {/* Actions row */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
          <button
            onClick={() => setShowInventory(v => !v)}
            style={{
              height: 38, padding: "0 16px",
              background: showInventory ? "#eef2ff" : "#f8fafc",
              border: `1px solid ${showInventory ? "#c7d2fe" : "#e2e8f0"}`,
              borderRadius: 9, color: showInventory ? "#6366f1" : "#64748b",
              fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
              display: "flex", alignItems: "center", gap: 6,
            }}
          >
            {offeredItems.length > 0 ? `${offeredItems.length} item${offeredItems.length !== 1 ? "s" : ""} attached` : "Attach Items"}
          </button>

          <div style={{ flex: 1 }} />

          {error && <div style={{ fontSize: 11.5, color: "#ef4444" }}>{error}</div>}

          <button
            onClick={handleSend}
            disabled={sending || !canSend}
            style={{
              height: 38, padding: "0 24px",
              background: (!canSend || sending) ? "#f1f5f9" : "#6366f1",
              border: "none", borderRadius: 9,
              color: (!canSend || sending) ? "#94a3b8" : "#ffffff",
              fontSize: 13, fontWeight: 700,
              cursor: (!canSend || sending) ? "not-allowed" : "pointer",
              fontFamily: "inherit",
              boxShadow: canSend && !sending ? "0 4px 12px rgba(99,102,241,0.3)" : "none",
            }}
          >
            {sending ? "Sending…" : "Send Offer"}
          </button>
        </div>
      </div>

      {/* Inventory panel — expands inline */}
      {showInventory && (
        <div style={{ borderTop: "1px solid #f1f5f9", padding: "14px 20px 16px", background: "#fafafa" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
            Your Inventory — select items to offer
          </div>

          <div style={{ position: "relative", marginBottom: 10 }}>
            <svg style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}
              width={13} height={13} fill="none" viewBox="0 0 24 24" stroke="#94a3b8" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              value={invSearch}
              onChange={e => setInvSearch(e.target.value)}
              placeholder={inventory.length === 0 ? "No synced inventory — use Chrome extension" : `Search ${inventory.length} items…`}
              style={{ width: "100%", height: 34, padding: "0 12px 0 30px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12.5, outline: "none", fontFamily: "inherit", color: "#0f172a", boxSizing: "border-box" }}
            />
          </div>

          {inventory.length === 0 ? (
            <div style={{ textAlign: "center", padding: "24px 0", fontSize: 12.5, color: "#94a3b8" }}>
              Import your CS2 inventory via the SKINTEL Chrome extension.
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(92px, 1fr))", gap: 8, maxHeight: 260, overflowY: "auto" }}>
              {displayedInv.map((item, i) => {
                const isSel = offeredItems.some(s => s.assetId === item.assetId);
                return (
                  <div key={i} onClick={() => toggleItem(item)} style={{ cursor: "pointer" }}>
                    <TradeItemCard item={item} selected={isSel} />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   TradeDetailPage — main full page
═══════════════════════════════════════════════════ */
export default function TradeDetailPage() {
  const { id }      = useParams();
  const navigate    = useNavigate();
  const { user, isAuthed } = useAuth();
  const { socket }  = useSocket();

  const [post,      setPost]      = useState(null);
  const [comments,  setComments]  = useState([]);
  const [inventory, setInventory] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [notFound,  setNotFound]  = useState(false);
  const threadEndRef = useRef(null);

  /* ── Dedup-safe comment adder ── */
  const addComment = useCallback((comment) => {
    setComments(prev => addUniqueComment(prev, comment));
  }, []);

  /* ── Load post + comments ── */
  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [postRes, commentsRes] = await Promise.all([
          api.get(`/trades/${id}`),
          api.get(`/trades/${id}/comments`),
        ]);
        if (!postRes.data.ok) { setNotFound(true); return; }
        setPost(postRes.data.post);
        setComments(commentsRes.data.comments || []);
      } catch {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  /* ── Load inventory for authed users ── */
  useEffect(() => {
    if (!isAuthed) return;
    api.get("/steam/inventory")
      .then(res => {
        if (res.data.ok) {
          setInventory((res.data.items || []).map(i => ({ ...i, iconUrl: i.iconUrl || i.icon_url || "" })));
        }
      })
      .catch(() => {});
  }, [isAuthed]);

  /* ── Mark read when owner views ── */
  useEffect(() => {
    if (!post || !user) return;
    if (String(post.ownerUserId) === String(user._id)) {
      api.patch(`/trades/${id}/comments/read`).catch(() => {});
    }
  }, [post, user, id]);

  /* ── Socket: join conv room + listen for live comments ── */
  useEffect(() => {
    if (!socket || !id) return;
    socket.emit("trade:join-conv", { postId: id });

    function handler(e) {
      const { tradePostId, comment } = e.detail || {};
      if (tradePostId !== id) return;
      addComment(comment);
    }
    window.addEventListener("trade:comment-added", handler);

    return () => {
      socket.emit("trade:leave-conv", { postId: id });
      window.removeEventListener("trade:comment-added", handler);
    };
  }, [socket, id, addComment]);

  /* ── Auto-scroll on new comment ── */
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [comments.length]);

  /* ── Post callbacks ── */
  function handleBumped(updatedPost) { setPost(updatedPost); }
  function handleClosed() { navigate("/trade"); }
  function handleCommentSent(comment) { addComment(comment); }

  /* ── Loading / not found ── */
  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "#f1f4f8", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width={32} height={32} viewBox="0 0 32 32" fill="none" style={{ animation: "detail-spin 1s linear infinite" }}>
          <circle cx="16" cy="16" r="12" stroke="#e2e8f0" strokeWidth="3" />
          <path d="M16 4 A12 12 0 0 1 28 16" stroke="#6366f1" strokeWidth="3" strokeLinecap="round" />
        </svg>
        <style>{`@keyframes detail-spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  if (notFound || !post) {
    return (
      <div style={{ minHeight: "100vh", background: "#f1f4f8", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#0f172a" }}>Trade post not found</div>
        <Link to="/trade" style={{ color: "#6366f1", fontWeight: 600, fontSize: 13 }}>← Back to Trade Board</Link>
      </div>
    );
  }

  const isOwner = user && String(post.ownerUserId) === String(user._id);

  return (
    <div style={{ minHeight: "100vh", background: "#f1f4f8", padding: "28px 20px 60px" }}>
      <div style={{ maxWidth: 860, margin: "0 auto" }}>

        {/* Back navigation */}
        <div style={{ marginBottom: 18 }}>
          <button
            onClick={() => navigate("/trade")}
            style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 5, color: "#64748b", fontSize: 13, fontWeight: 600, fontFamily: "inherit", padding: 0 }}
          >
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Trade Board
          </button>
        </div>

        {/* Original post (full) */}
        <TradePostFull
          post={post}
          user={user}
          onBumped={handleBumped}
          onClosed={handleClosed}
        />

        {/* Comments section */}
        <div style={{ marginTop: 28 }}>

          {/* Section header */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.01em" }}>
              Offers & Comments
            </div>
            <div style={{ height: 1, flex: 1, background: "#e2e8f0" }} />
            <div style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 6, padding: "3px 10px" }}>
              {comments.length} {comments.length === 1 ? "reply" : "replies"}
            </div>
          </div>

          {/* Comment feed */}
          {comments.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 24px", background: "#ffffff", border: "1px solid rgba(0,0,0,0.07)", borderRadius: 16, boxShadow: "0 1px 6px rgba(0,0,0,0.04)" }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#334155", marginBottom: 4 }}>No offers yet</div>
              <div style={{ fontSize: 12.5, color: "#94a3b8" }}>Be the first to make an offer on this trade.</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {comments.map(c => (
                <CommentCard key={c.id} comment={c} myUserId={user?._id} />
              ))}
            </div>
          )}
          <div ref={threadEndRef} />
        </div>

        {/* Composer */}
        <div style={{ marginTop: 24 }}>
          {user ? (
            <Composer postId={id} inventory={inventory} onSent={handleCommentSent} />
          ) : (
            <div style={{ textAlign: "center", padding: "24px", background: "#ffffff", border: "1px solid rgba(0,0,0,0.07)", borderRadius: 16, fontSize: 13.5, color: "#64748b" }}>
              <Link to="/login" style={{ color: "#6366f1", fontWeight: 700 }}>Log in</Link> to make offers or send messages.
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
