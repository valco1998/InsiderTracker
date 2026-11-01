import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { TradeItemThumb } from "./TradeItemCard";
import { MATCH_TIERS } from "../../utils/tradeMatch";
import api from "../../lib/api";
import useAuth from "../../hooks/useAuth";

function timeAgo(iso) {
  if (!iso) return "";
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60_000), h = Math.floor(m / 60), day = Math.floor(h / 24);
  if (day > 0) return `${day}d ago`;
  if (h   > 0) return `${h}h ago`;
  if (m   > 0) return `${m}m ago`;
  return "just now";
}

const BUMP_COOLDOWN_MS = 3 * 60 * 60 * 1000;

function bumpCooldownRemaining(post) {
  if (!post.bumpedAt) return 0;
  return Math.max(0, new Date(post.bumpedAt).getTime() + BUMP_COOLDOWN_MS - Date.now());
}

function formatCooldown(ms) {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function Avatar({ src, username, size = 32 }) {
  const [failed, setFailed] = useState(false);
  const fallback = `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(username || "?")}`;
  return (
    <img
      src={!failed && src ? src : fallback}
      alt={username}
      onError={() => setFailed(true)}
      style={{
        width: size, height: size, borderRadius: 8, objectFit: "cover",
        border: "1px solid rgba(168,85,247,0.22)", flexShrink: 0,
      }}
    />
  );
}

/* Items visible per side before +N overflow */
const FEED_MAX = 16;

function itemSize(count) {
  if (count === 1) return 120;
  if (count <= 3)  return 100;
  return 84;
}

function OverflowCard({ count, size }) {
  return (
    <div style={{
      minHeight: Math.round(size * 1.20), borderRadius: 8,
      background: "rgba(168,85,247,0.07)", border: "1px solid rgba(168,85,247,0.18)",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", gap: 3,
    }}>
      <span style={{ fontSize: Math.round(size * 0.24), fontWeight: 800, color: "#c084fc", lineHeight: 1 }}>
        +{count}
      </span>
      <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "rgba(255,255,255,0.28)" }}>
        more
      </span>
    </div>
  );
}

function ItemsRow({ items, emptyLabel }) {
  if (!items?.length) {
    return (
      <div style={{ padding: "6px 0 2px", fontSize: 11, color: "rgba(255,255,255,0.22)", fontStyle: "italic" }}>
        {emptyLabel}
      </div>
    );
  }
  const shown = items.slice(0, FEED_MAX);
  const extra  = items.length - shown.length;
  const size   = itemSize(items.length);
  return (
    <div className="tc-items-grid" style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${size}px, 1fr))`, gap: 8 }}>
      {shown.map((item, i) => <TradeItemThumb key={i} item={item} size={size} />)}
      {extra > 0 && <OverflowCard count={extra} size={size} />}
    </div>
  );
}

function MatchBadge({ score, tier, label }) {
  if (!tier || tier === "none" || score <= 0) return null;
  const t = MATCH_TIERS[tier] || MATCH_TIERS.none;
  if (!t.label) return null;
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "2px 7px", borderRadius: 5,
      background: t.bg, border: `1px solid ${t.border}`,
      fontSize: 10, fontWeight: 800, color: t.color,
      letterSpacing: "0.02em", lineHeight: 1.5, flexShrink: 0,
      alignSelf: "flex-start",
    }}>
      <span style={{
        display: "inline-block", width: 4, height: 4, borderRadius: "50%",
        background: t.color, boxShadow: `0 0 4px ${t.color}`, flexShrink: 0,
      }} />
      {score}% · {label}
    </div>
  );
}

function SectionLabel({ children, color }) {
  return (
    <div className="tc-sl" style={{
      fontSize: 12.5, fontWeight: 700, letterSpacing: "0.09em",
      textTransform: "uppercase", color, marginBottom: 8,
    }}>
      {children}
    </div>
  );
}

/* ─── Main card ──────────────────────────────────────── */
export default function TradePostCard({
  post,
  onClosed,
  onBumped,
  showControls = false,
  matchScore   = 0,
  matchTier    = "none",
  matchLabel   = "",
}) {
  const navigate  = useNavigate();
  const { user }  = useAuth();
  const [bumping, setBumping] = useState(false);
  const [closing, setClosing] = useState(false);
  const [hov,     setHov]     = useState(false);

  const isOwner        = user && String(post.ownerUserId) === String(user._id);
  const displayTime    = post.bumpedAt ? `bumped ${timeAgo(post.bumpedAt)}` : timeAgo(post.createdAt);
  const cooldownMs     = bumpCooldownRemaining(post);
  const inCooldown     = cooldownMs > 0;
  const commentCount   = post.commentCount   || 0;
  const unreadComments = isOwner ? (post.unreadComments || 0) : 0;
  const hasUnread      = unreadComments > 0;

  const score = matchScore || post._matchScore || 0;
  const tier  = matchTier !== "none" ? matchTier : (post._matchTier || "none");
  const label = matchLabel || post._matchLabel || "";

  const isExact   = tier === "exact";
  const isSimilar = tier === "similar";

  const accentColor = hasUnread ? "#ef4444"
    : isExact   ? "#4ade80"
    : isSimilar ? "#a855f7"
    : "rgba(168,85,247,0.28)";

  const borderColor = hasUnread
    ? "rgba(239,68,68,0.28)"
    : hov && isExact ? "rgba(74,222,128,0.32)"
    : hov            ? "rgba(168,85,247,0.24)"
    : isExact        ? "rgba(74,222,128,0.18)"
    : "rgba(255,255,255,0.07)";

  const boxShadow = hov
    ? isExact
      ? "0 6px 28px rgba(0,0,0,0.45), 0 0 20px rgba(74,222,128,0.07)"
      : "0 6px 28px rgba(0,0,0,0.40)"
    : isExact
      ? "0 2px 14px rgba(74,222,128,0.06)"
      : "0 1px 8px rgba(0,0,0,0.28)";

  async function handleBump() {
    if (inCooldown) return;
    setBumping(true);
    try {
      const res = await api.patch(`/trades/${post.id}/bump`);
      if (res.data.ok) onBumped?.(res.data.post);
      else alert(res.data.error || "Could not bump.");
    } catch (err) {
      const data = err?.response?.data;
      if (data?.error === "BUMP_COOLDOWN") {
        const msLeft = data.nextBumpAt
          ? Math.max(0, new Date(data.nextBumpAt).getTime() - Date.now())
          : BUMP_COOLDOWN_MS;
        alert(`Try again in ${formatCooldown(msLeft)}.`);
      } else {
        alert(data?.error || "Network error.");
      }
    } finally { setBumping(false); }
  }

  async function handleClose() {
    if (!confirm("Delete this trade post? This cannot be undone.")) return;
    setClosing(true);
    try {
      const res = await api.delete(`/trades/${post.id}`);
      if (res.data.ok) onClosed?.(post.id);
      else alert(res.data.error || "Could not delete.");
    } catch { alert("Network error — could not delete."); }
    finally { setClosing(false); }
  }

  /* Primary CTA color */
  const offersBg  = hasUnread ? "rgba(239,68,68,0.11)"  : isExact ? "rgba(74,222,128,0.10)"  : "rgba(124,58,237,0.16)";
  const offersBgh = hasUnread ? "rgba(239,68,68,0.20)"  : isExact ? "rgba(74,222,128,0.20)"  : "rgba(124,58,237,0.26)";
  const offersBdr = hasUnread ? "rgba(239,68,68,0.28)"  : isExact ? "rgba(74,222,128,0.26)"  : "rgba(139,92,246,0.26)";
  const offersClr = hasUnread ? "#f87171"                : isExact ? "#4ade80"                : "#c084fc";

  const divider = "1px solid rgba(168,85,247,0.07)";

  return (
    <article
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: isExact
          ? "linear-gradient(160deg,#101a12 0%,#0f1320 100%)"
          : "linear-gradient(160deg,#121720 0%,#0f1320 100%)",
        border: `1px solid ${borderColor}`,
        borderRadius: 14, overflow: "hidden",
        boxShadow,
        transition: "box-shadow 0.20s ease, border-color 0.20s ease",
      }}
    >
      {/* 2px accent bar */}
      <div style={{
        height: 2,
        background: `linear-gradient(90deg,transparent,${accentColor} 50%,transparent)`,
        opacity: hov ? 1 : 0.60,
        transition: "opacity 0.20s",
        animation: hasUnread ? "tpc-pulse-bar 1.5s ease-in-out infinite" : "none",
      }} />

      {/*
        ── 3-zone body: identity | offer | want ────────────────
        Desktop: grid 160px 1fr 1fr
        Mobile (≤680px): tc-identity spans full row, then 2-col offer/want
      */}
      <div className="tc-body" style={{
        display: "grid",
        gridTemplateColumns: "200px 1fr 1fr",
        borderBottom: `1px solid rgba(255,255,255,0.04)`,
      }}>

        {/* ── Identity column ─────────────────────────────── */}
        <div className="tc-identity" style={{
          padding: "10px 11px",
          borderRight: divider,
          display: "flex", flexDirection: "column",
          gap: 8, alignContent: "flex-start",
        }}>
          {/* Avatar + name row */}
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <Avatar src={post.ownerAvatarUrl} username={post.ownerUsername} />
            <div style={{ minWidth: 0 }}>
              <div style={{
                fontSize: 12.5, fontWeight: 700, color: "rgba(255,255,255,0.90)",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1.2,
              }}>
                {post.ownerUsername || "Unknown"}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 3 }}>
                <div style={{ width: 4, height: 4, borderRadius: "50%", background: "#10b981", flexShrink: 0 }} />
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.28)" }}>{displayTime}</span>
              </div>
            </div>
          </div>

          {/* Match badge */}
          {score > 0 && tier !== "none" && (
            <MatchBadge score={score} tier={tier} label={label} />
          )}

          {/* "You have it" tag */}
          {isExact && (
            <span style={{
              fontSize: 9.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em",
              padding: "2px 6px", borderRadius: 4, alignSelf: "flex-start",
              background: "rgba(74,222,128,0.10)", border: "1px solid rgba(74,222,128,0.20)",
              color: "#4ade80",
            }}>
              You have it
            </span>
          )}
        </div>

        {/* ── Their Offer ──────────────────────────────────── */}
        <div className="tc-offer" style={{ padding: "14px 18px", borderLeft: divider }}>
          <SectionLabel color="#22d3ee">Their Offer</SectionLabel>
          <ItemsRow items={post.myOfferItems} emptyLabel="Anything" />
        </div>

        {/* ── They Want ────────────────────────────────────── */}
        <div className="tc-want" style={{ padding: "14px 18px", borderLeft: divider }}>
          <SectionLabel color="#c084fc">They Want</SectionLabel>
          <ItemsRow items={post.lookingForItems} emptyLabel="Any offers" />
        </div>
      </div>

      {/* Optional trade message */}
      {post.message && (
        <div style={{
          padding: "6px 16px",
          borderBottom: "1px solid rgba(168,85,247,0.05)",
          fontSize: 10.5, color: "rgba(255,255,255,0.28)", fontStyle: "italic", lineHeight: 1.5,
        }}>
          "{post.message}"
        </div>
      )}

      {/* ── Footer: action buttons ───────────────────────── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 5,
        padding: "7px 13px 8px", flexWrap: "wrap",
      }}>
        {/* Primary CTA */}
        <button
          onClick={() => navigate(`/trade/${post.id}`)}
          onMouseEnter={e => { e.currentTarget.style.background = offersBgh; }}
          onMouseLeave={e => { e.currentTarget.style.background = offersBg; }}
          style={{
            height: 30, padding: "0 13px",
            background: offersBg, border: `1px solid ${offersBdr}`, borderRadius: 7,
            color: offersClr, fontSize: 12, fontWeight: 700,
            cursor: "pointer", fontFamily: "inherit",
            display: "flex", alignItems: "center", gap: 5,
            position: "relative", transition: "background 0.15s", flexShrink: 0,
          }}
        >
          Offers
          {commentCount > 0 && (
            <span style={{ fontSize: 11, fontWeight: 800 }}>{commentCount}</span>
          )}
          {hasUnread && (
            <span style={{
              position: "absolute", top: 3, right: 3,
              width: 6, height: 6, borderRadius: "50%",
              background: "#ef4444", boxShadow: "0 0 6px #ef4444",
              animation: "tpc-badge-pulse 1.2s ease-in-out infinite",
            }} />
          )}
        </button>

        <button
          onClick={() => navigate(`/trade/${post.id}`)}
          onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.07)"; e.currentTarget.style.color = "rgba(255,255,255,0.60)"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "rgba(255,255,255,0.30)"; }}
          style={{
            height: 30, padding: "0 13px",
            background: "transparent", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 7,
            color: "rgba(255,255,255,0.30)", fontSize: 12, fontWeight: 600,
            cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s", flexShrink: 0,
          }}
        >
          Details
        </button>

        <div style={{ flex: 1 }} />

        {user && !isOwner && (
          <button
            type="button"
            onClick={() => navigate(`/chat?dm=${post.ownerUserId}`)}
            style={{
              height: 28, padding: "0 11px", borderRadius: 6,
              background: "rgba(34,211,238,0.07)", border: "1px solid rgba(34,211,238,0.15)",
              color: "rgba(34,211,238,0.70)", fontSize: 11, fontWeight: 600,
              cursor: "pointer", display: "flex", alignItems: "center", flexShrink: 0,
            }}
          >
            DM
          </button>
        )}

        {post.ownerSteamId && !isOwner && (
          <a
            href={`https://steamcommunity.com/profiles/${post.ownerSteamId}`}
            target="_blank" rel="noopener noreferrer"
            style={{
              height: 28, padding: "0 10px", borderRadius: 6,
              background: "transparent", border: "1px solid rgba(255,255,255,0.07)",
              color: "rgba(255,255,255,0.25)", fontSize: 10.5, fontWeight: 600,
              textDecoration: "none", display: "flex", alignItems: "center", flexShrink: 0,
            }}
          >
            Steam ↗
          </a>
        )}

        {(showControls || isOwner) && post.status === "active" && (
          <>
            <button
              onClick={handleBump}
              disabled={bumping || inCooldown}
              title={inCooldown ? `Next bump in ${formatCooldown(cooldownMs)}` : "Bump to top"}
              style={{
                height: 28, padding: "0 10px", borderRadius: 6,
                background: inCooldown ? "rgba(255,255,255,0.04)" : "rgba(34,197,94,0.09)",
                border: inCooldown ? "1px solid rgba(255,255,255,0.07)" : "1px solid rgba(34,197,94,0.22)",
                color: inCooldown ? "rgba(255,255,255,0.22)" : "#4ade80",
                fontSize: 11, fontWeight: 600, flexShrink: 0,
                cursor: (bumping || inCooldown) ? "not-allowed" : "pointer", fontFamily: "inherit",
              }}
            >
              {bumping ? "…" : inCooldown ? formatCooldown(cooldownMs) : "↑ Bump"}
            </button>
            <button
              onClick={handleClose}
              disabled={closing}
              style={{
                height: 28, padding: "0 10px", borderRadius: 6,
                background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.20)",
                color: "#f87171", fontSize: 11, fontWeight: 600, flexShrink: 0,
                cursor: closing ? "not-allowed" : "pointer", fontFamily: "inherit",
              }}
            >
              {closing ? "…" : "Delete"}
            </button>
          </>
        )}
      </div>

      <style>{`
        @keyframes tpc-pulse-bar   { 0%,100%{opacity:1} 50%{opacity:0.45} }
        @keyframes tpc-badge-pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.7;transform:scale(1.3)} }

        /* Mobile: identity spans full row, offer+want sit 2-col below */
        @media (max-width: 680px) {
          .tc-body {
            grid-template-columns: 1fr 1fr !important;
          }
          .tc-identity {
            grid-column: 1 / -1 !important;
            flex-direction: row !important;
            align-items: center !important;
            gap: 10px !important;
            padding: 8px 12px !important;
            border-right: none !important;
            border-bottom: 1px solid rgba(255,255,255,0.04) !important;
          }
          .tc-offer {
            border-left: none !important;
            border-top: 1px solid rgba(168,85,247,0.07) !important;
            padding: 6px 8px !important;
          }
          .tc-want {
            border-top: 1px solid rgba(168,85,247,0.07) !important;
            padding: 6px 8px !important;
          }
          /* Mobile readability floor */
          .tit-name  { font-size: 10.5px !important; }
          .tit-price { font-size: 10px   !important; }
          .tc-sl     { font-size: 10.5px !important; margin-bottom: 6px !important; }
          /* Revert item grid to mobile-friendly size */
          .tc-items-grid {
            grid-template-columns: repeat(auto-fill, minmax(68px, 1fr)) !important;
            gap: 5px !important;
          }
        }
      `}</style>
    </article>
  );
}
