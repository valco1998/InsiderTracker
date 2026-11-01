import { memo, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  FiActivity, FiArrowRight, FiBell, FiClock, FiEye, FiMessageCircle,
  FiPercent, FiRefreshCw, FiTrendingDown, FiZap,
} from "react-icons/fi";
import useHomePremium from "../../hooks/useHomePremium";
// Optimised WebP renditions of assets/avatar3.png (the original SkinTel hero art)
import hero1200     from "../../assets/hero/hero-1200.webp";
import hero1686     from "../../assets/hero/hero-1686.webp";
import heroMobile   from "../../assets/hero/hero-mobile-900.webp";

/* ─── Constants ─────────────────────────────────────── */

const DEAL_BUCKETS = [
  { key: "30-100",     label: "30 – 100 Coins",      min: 30,   max: 100   },
  { key: "100-300",    label: "100 – 300 Coins",      min: 100,  max: 300   },
  { key: "300-1000",   label: "300 – 1,000 Coins",    min: 300,  max: 1000  },
  { key: "1000-10000", label: "1,000 – 10,000 Coins", min: 1000, max: 10000 },
];

// Mirrors REFRESH_MS in hooks/useHomePremium.js — keep in sync.
const FEED_REFRESH_LABEL = "30s";

// Only features that exist today, each linked to its live route.
const FEATURES = [
  { to: "/market",    label: "Live Deals",     Icon: FiZap },
  { to: "/alerts",    label: "Price Alerts",   Icon: FiBell },
  { to: "/watchlist", label: "Watchlist",      Icon: FiEye },
  { to: "/auctions",  label: "Auctions",       Icon: FiClock },
  { to: "/chat",      label: "Community Chat", Icon: FiMessageCircle },
];

// Static positions (no Math.random → stable across renders, no layout shift)
const PARTICLES = [
  { x: 52, y: 22, s: 2,   d: 7.5, delay: 0   },
  { x: 61, y: 68, s: 1.5, d: 9,   delay: 1.2 },
  { x: 70, y: 35, s: 2.5, d: 8,   delay: 2.4 },
  { x: 78, y: 80, s: 1.5, d: 10,  delay: 0.6 },
  { x: 86, y: 18, s: 2,   d: 7,   delay: 3.1 },
  { x: 93, y: 55, s: 1.5, d: 9.5, delay: 1.8 },
  { x: 44, y: 84, s: 2,   d: 8.5, delay: 4.0 },
  { x: 66, y: 50, s: 1,   d: 11,  delay: 2.0 },
  { x: 82, y: 42, s: 2,   d: 7.8, delay: 5.2 },
  { x: 57, y: 10, s: 1.5, d: 9.2, delay: 3.6 },
  { x: 90, y: 88, s: 2.5, d: 8.8, delay: 0.9 },
  { x: 74, y: 12, s: 1,   d: 10.5, delay: 4.6 },
];

/* ─── Styles ─────────────────────────────────────────── */

const HOME_STYLES = `
  .hx-root {
    --hx-ink:     #07050d;
    --hx-deep:    #120a22;
    --hx-violet:  #a855f7;
    --hx-violet2: #8b5cf6;
    --hx-magenta: #e879f9;
    --hx-gold:    #fbbf24;
    background:
      radial-gradient(ellipse 60% 40% at 80% 0%, rgba(88,28,135,0.20) 0%, transparent 70%),
      linear-gradient(180deg, #07050d 0%, #0b0716 45%, #0e0a1a 100%);
  }

  @keyframes hxLivePulse {
    0%, 100% { opacity: 1;   box-shadow: 0 0 4px #a855f7;  }
    50%      { opacity: 0.4; box-shadow: 0 0 12px #a855f7; }
  }
  @keyframes hxSmoke {
    0%   { transform: translate3d(0, 0, 0) scale(1);        opacity: 0.55; }
    50%  { transform: translate3d(-40px, -18px, 0) scale(1.08); opacity: 0.8; }
    100% { transform: translate3d(0, 0, 0) scale(1);        opacity: 0.55; }
  }
  @keyframes hxParticle {
    0%   { transform: translate3d(0, 0, 0);       opacity: 0;   }
    15%  { opacity: 0.9; }
    85%  { opacity: 0.5; }
    100% { transform: translate3d(6px, -60px, 0); opacity: 0;   }
  }

  /* ── Hero ── */
  .hx-hero {
    position: relative;
    overflow: hidden;
    isolation: isolate;
    min-height: clamp(560px, 78vh, 760px);
    display: flex;
    align-items: center;
  }
  .hx-art {
    position: absolute; inset: 0; z-index: 0;
  }
  .hx-art img {
    width: 100%; height: 100%;
    object-fit: cover;
    object-position: 72% 30%;
    display: block;
  }
  /* Scrims: blend the artwork into the page — no hard image edges */
  .hx-scrim {
    position: absolute; inset: 0; z-index: 1; pointer-events: none;
    background:
      linear-gradient(90deg, rgba(7,5,13,0.97) 0%, rgba(7,5,13,0.90) 24%, rgba(7,5,13,0.55) 44%, rgba(7,5,13,0.12) 62%, transparent 76%),
      linear-gradient(180deg, rgba(7,5,13,0.55) 0%, transparent 18%, transparent 60%, rgba(7,5,13,0.85) 88%, #07050d 100%),
      radial-gradient(ellipse 45% 55% at 70% 45%, rgba(168,85,247,0.16) 0%, transparent 70%);
  }
  .hx-smoke {
    position: absolute; z-index: 2; pointer-events: none;
    border-radius: 50%;
    filter: blur(60px);
    will-change: transform, opacity;
  }
  .hx-smoke-a {
    width: 620px; height: 240px; right: -120px; bottom: 6%;
    background: radial-gradient(ellipse at center, rgba(168,85,247,0.38) 0%, rgba(109,40,217,0.14) 45%, transparent 72%);
    animation: hxSmoke 18s ease-in-out infinite;
  }
  .hx-smoke-b {
    width: 480px; height: 200px; left: 38%; bottom: -40px;
    background: radial-gradient(ellipse at center, rgba(232,121,249,0.20) 0%, rgba(139,92,246,0.10) 50%, transparent 72%);
    animation: hxSmoke 24s ease-in-out 4s infinite reverse;
  }
  .hx-particles { position: absolute; inset: 0; z-index: 3; pointer-events: none; }
  .hx-particle {
    position: absolute; border-radius: 50%;
    background: #e9d5ff;
    box-shadow: 0 0 6px 1px rgba(192,132,252,0.9);
    animation: hxParticle linear infinite;
  }

  .hx-content {
    position: relative; z-index: 10;
    width: 100%; max-width: 1820px; margin: 0 auto;
    padding: clamp(48px, 7vw, 88px) clamp(16px, 4vw, 48px) clamp(88px, 9vw, 120px);
  }
  .hx-copy { max-width: 580px; }

  .hx-eyebrow {
    display: inline-flex; align-items: center; gap: 8px;
    padding: 6px 12px; border-radius: 999px;
    background: rgba(88,28,135,0.28);
    border: 1px solid rgba(168,85,247,0.35);
    backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
    font-size: 11px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase;
    color: #d8b4fe;
    margin-bottom: 20px;
  }
  .hx-live-dot {
    width: 7px; height: 7px; border-radius: 50%; background: #a855f7;
    animation: hxLivePulse 2s ease-in-out infinite;
  }

  .hx-title {
    margin: 0;
    font-size: clamp(56px, 8.4vw, 124px);
    font-weight: 900;
    line-height: 0.92;
    letter-spacing: -0.035em;
    text-shadow: 0 0 60px rgba(168,85,247,0.25);
  }
  .hx-title-skin {
    background: linear-gradient(180deg, #ffffff 0%, #e4e4ee 55%, #a8a3bf 100%);
    -webkit-background-clip: text; background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  .hx-title-tel {
    background: linear-gradient(180deg, #d8b4fe 0%, #a855f7 50%, #7c3aed 100%);
    -webkit-background-clip: text; background-clip: text;
    -webkit-text-fill-color: transparent;
    filter: drop-shadow(0 0 18px rgba(168,85,247,0.55));
  }
  .hx-tagline {
    margin: 14px 0 20px;
    font-size: clamp(13px, 1.25vw, 17px);
    font-weight: 800;
    letter-spacing: 0.34em;
    text-transform: uppercase;
    background: linear-gradient(90deg, #c084fc 0%, #e879f9 100%);
    -webkit-background-clip: text; background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  .hx-para {
    margin: 0 0 28px;
    max-width: 470px;
    font-size: 16px; line-height: 1.65;
    color: rgba(236,233,248,0.78);
  }

  .hx-btns { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 26px; }
  .hx-btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    min-height: 48px; padding: 0 26px; border-radius: 12px;
    font-family: inherit; font-size: 14px; font-weight: 700; letter-spacing: -0.005em;
    cursor: pointer;
    transition: transform 0.18s ease, box-shadow 0.18s ease, background 0.18s ease, border-color 0.18s ease, filter 0.18s ease;
  }
  .hx-btn:focus-visible, .hx-chip:focus-visible, .hx-card:focus-visible, .hx-link:focus-visible {
    outline: 2px solid #c084fc; outline-offset: 2px;
  }
  .hx-btn-primary {
    color: #fff; border: 1px solid rgba(216,180,254,0.35);
    background: linear-gradient(135deg, #a855f7 0%, #7c3aed 60%, #6d28d9 100%);
    box-shadow: 0 6px 28px rgba(124,58,237,0.45), inset 0 1px 0 rgba(255,255,255,0.18);
  }
  .hx-btn-primary:hover {
    transform: translateY(-2px); filter: brightness(1.1);
    box-shadow: 0 10px 40px rgba(168,85,247,0.6), inset 0 1px 0 rgba(255,255,255,0.22);
  }
  .hx-btn-ghost {
    color: rgba(255,255,255,0.9);
    background: rgba(20,12,36,0.55);
    border: 1px solid rgba(168,85,247,0.35);
    backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
  }
  .hx-btn-ghost:hover {
    transform: translateY(-2px);
    background: rgba(88,28,135,0.35);
    border-color: rgba(216,180,254,0.55);
    box-shadow: 0 0 24px rgba(168,85,247,0.3);
  }

  .hx-chips { display: flex; flex-wrap: wrap; gap: 8px; }
  .hx-chip {
    display: inline-flex; align-items: center; gap: 7px;
    min-height: 40px; padding: 0 14px; border-radius: 10px;
    font-size: 12.5px; font-weight: 600; text-decoration: none;
    color: rgba(233,213,255,0.88);
    background: rgba(12,8,24,0.55);
    border: 1px solid rgba(168,85,247,0.2);
    backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
    transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
    white-space: nowrap;
  }
  .hx-chip svg { color: #c084fc; flex-shrink: 0; }
  .hx-chip:hover { color: #fff; border-color: rgba(168,85,247,0.5); background: rgba(88,28,135,0.3); }

  /* ── Stats strip ── */
  .hx-stats-wrap {
    position: relative; z-index: 20;
    max-width: 1820px; margin: -56px auto 0;
    padding: 0 clamp(14px, 3.5vw, 32px);
  }
  .hx-stats {
    display: grid; grid-template-columns: repeat(4, minmax(0, 1fr));
    border-radius: 16px;
    background: rgba(18,10,34,0.62);
    border: 1px solid rgba(168,85,247,0.22);
    box-shadow: 0 12px 40px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.04);
    backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
    overflow: hidden;
  }
  .hx-stat {
    display: flex; align-items: center; gap: 14px;
    padding: 18px 22px;
    min-width: 0;
  }
  .hx-stat + .hx-stat { border-left: 1px solid rgba(168,85,247,0.12); }
  .hx-stat-icon {
    width: 42px; height: 42px; border-radius: 12px; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    color: #d8b4fe;
    background: rgba(168,85,247,0.12);
    border: 1px solid rgba(168,85,247,0.28);
    box-shadow: 0 0 18px rgba(168,85,247,0.18);
  }
  .hx-stat-val {
    font-size: 22px; font-weight: 800; line-height: 1.1; letter-spacing: -0.02em;
    color: #fff; font-variant-numeric: tabular-nums;
  }
  .hx-stat-label {
    font-size: 11.5px; font-weight: 600; letter-spacing: 0.04em;
    color: rgba(216,200,245,0.55); margin-top: 3px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }

  /* ── Sections ── */
  .hx-section-head {
    display: flex; align-items: flex-end; justify-content: space-between; gap: 12px;
    margin-bottom: 16px;
  }
  .hx-kicker {
    font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase;
    color: rgba(192,132,252,0.85); margin-bottom: 4px;
  }
  .hx-h2 {
    margin: 0; font-size: 22px; font-weight: 800; letter-spacing: -0.02em; color: #fff;
    display: flex; align-items: center; gap: 10px;
  }
  .hx-h2::before {
    content: ""; width: 4px; height: 20px; border-radius: 2px;
    background: linear-gradient(180deg, #e879f9, #8b5cf6);
    box-shadow: 0 0 12px rgba(168,85,247,0.7);
  }
  .hx-link {
    display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0;
    min-height: 36px; padding: 0 14px; border-radius: 9px;
    font-size: 13px; font-weight: 600; text-decoration: none;
    color: rgba(216,180,254,0.85);
    background: rgba(168,85,247,0.06);
    border: 1px solid rgba(168,85,247,0.2);
    cursor: pointer; font-family: inherit;
    transition: all 0.15s ease;
  }
  .hx-link:hover { color: #fff; border-color: rgba(168,85,247,0.45); background: rgba(168,85,247,0.14); }

  .hx-premium-row {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(200px, 1fr);
    gap: 14px;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scroll-snap-type: x mandatory;
    scrollbar-width: none;
    padding: 4px 2px 10px;
  }
  .hx-premium-row::-webkit-scrollbar { display: none; }
  .hx-premium-row > * { scroll-snap-align: start; }
  @media (min-width: 1280px) {
    .hx-premium-row {
      grid-auto-flow: row;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      overflow: visible;
    }
  }
  .hx-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(150px, 100%), 1fr));
    gap: 10px;
  }

  /* ── Deal card ── */
  .hx-card {
    display: flex; flex-direction: column; overflow: hidden;
    border-radius: 14px;
    background: linear-gradient(165deg, #1a1030 0%, #120b22 55%, #0c0818 100%);
    border: 1px solid rgba(168,85,247,0.18);
    cursor: pointer;
    transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
  }
  .hx-card:hover {
    transform: translateY(-4px);
    border-color: rgba(192,132,252,0.55);
    box-shadow: 0 10px 34px rgba(168,85,247,0.25), 0 2px 8px rgba(0,0,0,0.5);
  }
  .hx-card-media {
    position: relative; height: 140px;
    display: flex; align-items: center; justify-content: center;
    padding: 0 12px;
    background: radial-gradient(ellipse at 50% 40%, rgba(168,85,247,0.22) 0%, rgba(12,8,24,0) 70%);
  }
  .hx-card-media img { transition: transform 0.25s ease; }
  .hx-card:hover .hx-card-media img { transform: scale(1.05); }

  .hx-panel {
    border-radius: 16px;
    background: rgba(16,10,30,0.55);
    border: 1px solid rgba(168,85,247,0.14);
    overflow: hidden;
  }

  /* ── Tablet ── */
  @media (max-width: 1023px) {
    .hx-art img { object-position: 78% 30%; }
    .hx-scrim {
      background:
        linear-gradient(90deg, rgba(7,5,13,0.96) 0%, rgba(7,5,13,0.82) 40%, rgba(7,5,13,0.35) 70%, rgba(7,5,13,0.2) 100%),
        linear-gradient(180deg, rgba(7,5,13,0.5) 0%, transparent 20%, transparent 55%, rgba(7,5,13,0.9) 88%, #07050d 100%);
    }
    .hx-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .hx-stat:nth-child(3) { border-left: none; }
    .hx-stat:nth-child(n+3) { border-top: 1px solid rgba(168,85,247,0.12); }
  }

  /* ── Mobile: art on top, copy below ── */
  @media (max-width: 767px) {
    .hx-hero { display: block; min-height: 0; }
    .hx-art { position: relative; inset: auto; aspect-ratio: 900 / 663; }
    .hx-art img { object-position: center top; }
    .hx-scrim {
      bottom: auto; aspect-ratio: 900 / 663;
      background:
        linear-gradient(180deg, rgba(7,5,13,0.35) 0%, transparent 25%, rgba(7,5,13,0.55) 70%, #07050d 100%);
    }
    .hx-smoke-a { width: 360px; height: 160px; right: -80px; bottom: auto; top: 38%; }
    .hx-smoke-b, .hx-particles { display: none; }
    .hx-content { margin-top: -84px; padding: 0 18px 84px; }
    .hx-eyebrow { margin-bottom: 12px; }
    .hx-title { font-size: clamp(44px, 14vw, 60px); }
    .hx-tagline { letter-spacing: 0.26em; margin: 10px 0 14px; }
    .hx-para { font-size: 14.5px; margin-bottom: 20px; color: rgba(236,233,248,0.84); }
    .hx-btns { flex-direction: column; gap: 10px; margin-bottom: 18px; }
    .hx-btn { width: 100%; }
    .hx-chips {
      flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none;
      margin: 0 -18px; padding: 0 18px 4px;
    }
    .hx-chips::-webkit-scrollbar { display: none; }
    .hx-stats-wrap { margin-top: -56px; }
    .hx-stat { padding: 14px 14px; gap: 10px; }
    .hx-stat-icon { width: 36px; height: 36px; border-radius: 10px; }
    .hx-stat-val { font-size: 18px; }
    .hx-stat-label { white-space: normal; line-height: 1.25; font-size: 11px; letter-spacing: 0.02em; }
    .hx-premium-row { grid-auto-columns: minmax(168px, 46%); gap: 10px; }
    .hx-card-media { height: 120px; }
  }

  @media (prefers-reduced-motion: reduce) {
    .hx-smoke, .hx-particle, .hx-live-dot { animation: none !important; }
    .hx-particles { display: none; }
    .hx-card, .hx-btn, .hx-card-media img { transition: none !important; }
    .hx-card:hover, .hx-btn:hover { transform: none !important; }
    .hx-card:hover .hx-card-media img { transform: none !important; }
  }
`;

/* ─── Pure helpers ───────────────────────────────────── */

function itemName(item) {
  return item?.name || item?.marketHashName || item?.market_hash_name || item?.market_name || "Unknown item";
}

function itemImage(item) {
  const src = item?.image || item?.image_url || item?.icon_url || item?.iconUrl || item?.icon || item?.icon_url_large || item?.icon_large || "";
  if (!src) return "";
  const v = String(src).trim();
  return v.startsWith("http")
    ? v
    : `https://community.cloudflare.steamstatic.com/economy/image/${v}/128fx128f`;
}

function priceOf(item)     { return Number(item?.priceCoins ?? item?.price ?? item?.market_value ?? item?.purchase_price ?? 0); }
function suggestedOf(item) { return Number(item?.suggestedCoins ?? item?.suggestedPrice ?? item?.suggested ?? item?.market_value ?? 0); }
function discountOf(item)  { return Number(item?.discountPct ?? item?.discount_pct ?? item?.discount ?? 0); }
function wearOf(item)      { return item?.wear_name || item?.wearName || item?.exterior || ""; }
function floatOf(item) {
  const n = Number(item?.floatValue ?? item?.float ?? item?.wear ?? NaN);
  return Number.isFinite(n) ? n.toFixed(3) : "";
}
function buyUrlOf(item) {
  return item?.purchaseUrl || item?.buyUrl || item?.url || item?.market_url
    || `https://csgoempire.com/item/${item?.id || item?.itemId || ""}`;
}
function coins(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
function splitName(name = "") {
  const [weapon, rest] = String(name).split("|").map(s => s.trim());
  if (!rest) return { weapon: name, skin: "" };
  return { weapon, skin: rest.replace(/\(.*?\)/g, "").trim() };
}
function openBuy(item) {
  const url = buyUrlOf(item);
  if (!url || url.endsWith("/item/")) return;
  window.open(url, "_blank", "noopener,noreferrer");
}

/* ─── SkinImage ──────────────────────────────────────── */

const SkinImage = memo(function SkinImage({ item, style }) {
  const src = itemImage(item);
  if (!src) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,0.03)", ...style }}>
        <svg width={32} height={32} fill="none" viewBox="0 0 24 24" stroke="rgba(255,255,255,0.12)" strokeWidth={1}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      </div>
    );
  }
  return (
    <img
      src={src} alt={itemName(item)} style={style}
      loading="lazy" decoding="async"
      onError={e => { e.currentTarget.onerror = null; e.currentTarget.style.opacity = "0.2"; }}
    />
  );
});

/* ─── DiscountTag ────────────────────────────────────── */

function DiscountTag({ pct }) {
  if (!pct || pct < 1) return null;
  const r = Math.round(pct);
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", padding: "3px 8px",
      borderRadius: 6, fontSize: 11, fontWeight: 800, fontVariantNumeric: "tabular-nums",
      background: r >= 15 ? "rgba(74,222,128,0.16)" : "rgba(74,222,128,0.10)",
      border:     r >= 15 ? "1px solid rgba(74,222,128,0.34)" : "1px solid rgba(74,222,128,0.2)",
      color:      r >= 15 ? "#86efac" : "#a7f3d0", lineHeight: 1,
      boxShadow:  r >= 15 ? "0 0 12px rgba(74,222,128,0.18)" : "none",
    }}>
      -{r}%
    </span>
  );
}

/* ─── DealCard ───────────────────────────────────────── */

const DealCard = memo(function DealCard({ item }) {
  const name      = itemName(item);
  const { weapon, skin } = splitName(name);
  const price     = priceOf(item);
  const discount  = discountOf(item);
  const wear      = wearOf(item);
  const float     = floatOf(item);
  const suggested = suggestedOf(item);

  return (
    <article
      className="hx-card"
      role="link"
      tabIndex={0}
      aria-label={`${name}, ${coins(price)} coins${discount >= 1 ? `, ${Math.round(discount)}% below suggested` : ""}`}
      onClick={() => openBuy(item)}
      onKeyDown={e => { if (e.key === "Enter") openBuy(item); }}
    >
      <div className="hx-card-media">
        <SkinImage item={item} style={{ height: 104, width: "100%", objectFit: "contain", filter: "drop-shadow(0 6px 14px rgba(0,0,0,0.55))" }} />
        {discount >= 1 && <span style={{ position: "absolute", top: 10, left: 10 }}><DiscountTag pct={discount} /></span>}
      </div>

      <div style={{ padding: "12px 14px 14px", display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(216,180,254,0.55)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 4 }}>
          {weapon}
        </div>
        <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.3, color: "rgba(255,255,255,0.94)", letterSpacing: "-0.01em", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", minHeight: 36, marginBottom: 4 }}>
          {skin || weapon}
        </div>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.42)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 10 }}>
          {[wear, float ? `Float ${float}` : ""].filter(Boolean).join(" · ") || " "}
        </div>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 6, paddingTop: 10, borderTop: "1px solid rgba(168,85,247,0.14)" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 4, minWidth: 0 }}>
            <span style={{ fontSize: 19, fontWeight: 800, lineHeight: 1, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em", color: "#fbbf24" }}>
              {coins(price)}
            </span>
            <span style={{ fontSize: 11, fontWeight: 600, color: "rgba(251,191,36,0.6)" }}>coins</span>
          </div>
          {suggested > price && (
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", textDecoration: "line-through", fontVariantNumeric: "tabular-nums" }}>
              {coins(suggested)}
            </span>
          )}
        </div>
      </div>
    </article>
  );
});

/* ─── SkeletonCard ───────────────────────────────────── */

function SkeletonCard({ height = 260 }) {
  return <div className="skeleton" style={{ height, borderRadius: 14, background: "rgba(168,85,247,0.06)" }} />;
}

/* ─── EmptyState ─────────────────────────────────────── */

function EmptyState({ message, cols }) {
  return (
    <div style={{
      gridColumn: cols ? "1 / -1" : undefined,
      padding: "28px 20px", textAlign: "center", borderRadius: 12,
      background: "rgba(168,85,247,0.03)", border: "1px solid rgba(168,85,247,0.12)",
      fontSize: 13, color: "rgba(255,255,255,0.45)",
    }}>
      {message}
    </div>
  );
}

/* ─── TimedOutState ──────────────────────────────────── */

function TimedOutState({ onRetry, cols }) {
  return (
    <div style={{
      gridColumn: cols ? "1 / -1" : undefined,
      padding: "28px 20px", textAlign: "center", borderRadius: 12,
      background: "rgba(168,85,247,0.03)", border: "1px solid rgba(168,85,247,0.12)",
      display: "flex", flexDirection: "column", alignItems: "center", gap: 12,
    }}>
      <div style={{ fontSize: 13, color: "rgba(255,255,255,0.55)", textAlign: "center", lineHeight: 1.5 }}>
        Server is waking up — this can take up to 30 seconds on first load.
        <br />
        Retrying automatically...
      </div>
      <button type="button" className="hx-link" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}

/* ─── StatsStrip ─────────────────────────────────────── */

const StatsStrip = memo(function StatsStrip({ items, loading }) {
  const stats = useMemo(() => {
    const discounts = items.map(discountOf).filter(d => Number.isFinite(d) && d > 0);
    const hasData = discounts.length > 0;
    const top = hasData ? Math.max(...discounts) : 0;
    const avg = hasData ? discounts.reduce((s, d) => s + d, 0) / discounts.length : 0;
    return { hasData, count: items.length, top, avg };
  }, [items]);

  const dash = "—";
  const rows = [
    { Icon: FiActivity,     label: "Live deals in feed", value: loading ? dash : stats.count.toLocaleString(), data: true },
    { Icon: FiTrendingDown, label: "Top discount now",   value: loading ? dash : `-${Math.round(stats.top)}%`,   data: true },
    { Icon: FiPercent,      label: "Avg feed discount",  value: loading ? dash : `-${stats.avg.toFixed(1)}%`,    data: true },
    { Icon: FiRefreshCw,    label: "Feed auto-refresh",  value: FEED_REFRESH_LABEL,                               data: false },
  ].filter(r => !r.data || loading || stats.hasData);

  return (
    <div className="hx-stats-wrap">
      <div
        className="hx-stats"
        style={rows.length < 4 ? { gridTemplateColumns: `repeat(${rows.length}, minmax(0, 1fr))` } : undefined}
        aria-live="polite"
      >
        {rows.map(({ Icon, label, value }) => (
          <div key={label} className="hx-stat">
            <div className="hx-stat-icon"><Icon size={18} aria-hidden /></div>
            <div style={{ minWidth: 0 }}>
              <div className="hx-stat-val">{value}</div>
              <div className="hx-stat-label">{label}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});

/* ─── PremiumSection ─────────────────────────────────── */

const PremiumSection = memo(function PremiumSection({ items, loading, timedOut, onRetry }) {
  return (
    <section style={{ padding: "0 0 36px" }}>
      <div className="hx-section-head">
        <div>
          <div className="hx-kicker">500 – 10,000 Coins · Top by discount</div>
          <h2 className="hx-h2">Premium Deals</h2>
        </div>
        <Link to="/market" className="hx-link">View all <FiArrowRight size={14} aria-hidden /></Link>
      </div>

      {loading ? (
        <div className="hx-premium-row">
          {Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} height={250} />)}
        </div>
      ) : timedOut && items.length === 0 ? (
        <TimedOutState onRetry={onRetry} />
      ) : items.length > 0 ? (
        <div className="hx-premium-row">
          {items.map((item, i) => <DealCard key={item?.itemId || item?.id || i} item={item} />)}
        </div>
      ) : (
        <EmptyState message="No premium deals right now" />
      )}
    </section>
  );
});

/* ─── BucketSection ──────────────────────────────────── */

const BucketSection = memo(function BucketSection({ bucket, items, loading, timedOut, onRetry }) {
  return (
    <div className="hx-panel">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "14px 18px", borderBottom: "1px solid rgba(168,85,247,0.1)", background: "rgba(168,85,247,0.035)" }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: "rgba(216,180,254,0.5)", marginBottom: 3 }}>
            Price range
          </div>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: "rgba(255,255,255,0.92)", letterSpacing: "-0.02em", margin: 0 }}>
            {bucket.label}
          </h3>
        </div>
        <span style={{ fontSize: 11, fontWeight: 600, padding: "3px 9px", borderRadius: 6, flexShrink: 0, background: "rgba(74,222,128,0.08)", border: "1px solid rgba(74,222,128,0.18)", color: "rgba(74,222,128,0.85)" }}>
          Best discount
        </span>
      </div>
      <div style={{ padding: 14 }}>
        {loading ? (
          <div className="hx-grid">
            {Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} height={250} />)}
          </div>
        ) : timedOut && items.length === 0 ? (
          <TimedOutState onRetry={onRetry} />
        ) : items.length === 0 ? (
          <EmptyState message="No strong deals in this range right now" />
        ) : (
          <div className="hx-grid">
            {items.map((item, i) => <DealCard key={item?.itemId || item?.id || `${bucket.key}-${i}`} item={item} />)}
          </div>
        )}
      </div>
    </div>
  );
});

/* ─── Hero ───────────────────────────────────────────── */

function Hero({ onExplore, onAlert }) {
  return (
    <section className="hx-hero" aria-labelledby="hx-title">
      <picture className="hx-art">
        <source media="(max-width: 767px)" srcSet={heroMobile} type="image/webp" />
        <source srcSet={`${hero1200} 1200w, ${hero1686} 1686w`} sizes="100vw" type="image/webp" />
        <img
          src={hero1686}
          alt=""
          aria-hidden="true"
          width={1686}
          height={933}
          decoding="async"
        />
      </picture>

      <div className="hx-scrim" />
      <div className="hx-smoke hx-smoke-a" />
      <div className="hx-smoke hx-smoke-b" />
      <div className="hx-particles" aria-hidden="true">
        {PARTICLES.map((p, i) => (
          <span
            key={i}
            className="hx-particle"
            style={{ left: `${p.x}%`, top: `${p.y}%`, width: p.s, height: p.s, animationDuration: `${p.d}s`, animationDelay: `${p.delay}s` }}
          />
        ))}
      </div>

      <div className="hx-content">
        <div className="hx-copy">
          <div className="hx-eyebrow">
            <span className="hx-live-dot" aria-hidden="true" />
            Live CS2 deal scanner
          </div>

          <h1 id="hx-title" className="hx-title">
            <span className="hx-title-skin">SKIN</span><span className="hx-title-tel">TEL</span>
          </h1>
          <p className="hx-tagline">Upgrade. Trade. Profit.</p>

          <p className="hx-para">
            Live CS2 skin deals from CSGOEmpire, ranked by discount and refreshed automatically.
            Set watchlist price rules and get push alerts the moment a match lists.
          </p>

          <div className="hx-btns">
            <button type="button" className="hx-btn hx-btn-primary" onClick={onExplore}>
              Explore Market <FiArrowRight size={16} aria-hidden />
            </button>
            <button type="button" className="hx-btn hx-btn-ghost" onClick={onAlert}>
              <FiBell size={16} aria-hidden /> Set Price Alert
            </button>
          </div>

          <nav className="hx-chips" aria-label="SkinTel features">
            {FEATURES.map(({ to, label, Icon }) => (
              <Link key={to} to={to} className="hx-chip">
                <Icon size={14} aria-hidden /> {label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </section>
  );
}

/* ─── Home ───────────────────────────────────────────── */

export default function Home() {
  const navigate = useNavigate();
  const { items, loading, timedOut, retry } = useHomePremium({ minPrice: 30, maxPrice: 10_000, minDiscountPct: 0 });

  const validItems = useMemo(() => (
    items
      .filter(item => { const p = priceOf(item); return itemName(item) && p >= 30 && p <= 10_000; })
      .sort((a, b) => discountOf(b) - discountOf(a))
  ), [items]);

  const premiumDeals = useMemo(() => {
    const candidates = validItems.filter(item => priceOf(item) >= 500 && discountOf(item) > 0);
    if (candidates.length >= 3) return candidates.slice(0, 5);
    return validItems.filter(item => priceOf(item) >= 500).slice(0, 5);
  }, [validItems]);

  const bucketDeals = useMemo(() => (
    DEAL_BUCKETS.map(bucket => ({
      ...bucket,
      items: validItems
        .filter(item => { const p = priceOf(item); return p >= bucket.min && p <= bucket.max; })
        .sort((a, b) => { const dd = discountOf(b) - discountOf(a); return dd !== 0 ? dd : priceOf(b) - priceOf(a); })
        .slice(0, 5),
    }))
  ), [validItems]);

  return (
    <div className="hx-root min-h-screen overflow-x-hidden text-white">
      <style>{HOME_STYLES}</style>

      <Hero onExplore={() => navigate("/market")} onAlert={() => navigate("/watchlist")} />

      <StatsStrip items={validItems} loading={loading && validItems.length === 0} />

      <div style={{ maxWidth: 1820, margin: "0 auto", padding: "clamp(28px,4vw,40px) clamp(14px,3.5vw,32px) clamp(40px,7vw,64px)" }}>

        <PremiumSection items={premiumDeals} loading={loading} timedOut={timedOut} onRetry={retry} />

        <div className="hx-section-head">
          <div>
            <div className="hx-kicker">By price range</div>
            <h2 className="hx-h2">Best deals by budget</h2>
          </div>
          <Link to="/market" className="hx-link">View all <FiArrowRight size={14} aria-hidden /></Link>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {bucketDeals.map(bucket => (
            <BucketSection key={bucket.key} bucket={bucket} items={bucket.items} loading={loading} timedOut={timedOut} onRetry={retry} />
          ))}
        </div>

      </div>
    </div>
  );
}
