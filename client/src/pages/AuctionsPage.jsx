import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import api from "../lib/api";
import { formatCoins, getBaseName, getItemType, getWear } from "../lib/marketItem";
import ShareAuctionModal from "./components/ShareAuctionModal";
import { useSocket } from "../context/SocketContext";

/* ─── Constants ─────────────────────────────────────────────────── */

const POLL_MS = 60_000;

const AUCTION_CATEGORIES = [
  { key: "",        label: "All"      },
  { key: "knife",   label: "Knives"   },
  { key: "gloves",  label: "Gloves"   },
  { key: "rifle",   label: "Rifles"   },
  { key: "pistol",  label: "Pistols"  },
  { key: "smg",     label: "SMGs"     },
  { key: "sniper",  label: "Snipers"  },
  { key: "sticker", label: "Stickers" },
];

const WEARS = ["All", "Factory New", "Minimal Wear", "Field-Tested", "Well-Worn", "Battle-Scarred"];

/* ─── Stable decorative background data ─────────────────────────── */

const BG_PARTICLES = [
  { id: 0,  x: 7,  y: 68, sz: 1.5, del: 0,   dur: 10, col: "168,85,247"  },
  { id: 1,  x: 16, y: 22, sz: 2,   del: 2,   dur: 12, col: "251,115,0"   },
  { id: 2,  x: 24, y: 55, sz: 1,   del: 4,   dur: 8,  col: "168,85,247"  },
  { id: 3,  x: 34, y: 82, sz: 2.5, del: 1,   dur: 14, col: "251,191,36"  },
  { id: 4,  x: 43, y: 38, sz: 1.5, del: 3,   dur: 11, col: "168,85,247"  },
  { id: 5,  x: 52, y: 70, sz: 1,   del: 5,   dur: 9,  col: "251,115,0"   },
  { id: 6,  x: 61, y: 18, sz: 2,   del: 0.5, dur: 13, col: "168,85,247"  },
  { id: 7,  x: 70, y: 78, sz: 1.5, del: 2.5, dur: 10, col: "251,115,0"   },
  { id: 8,  x: 79, y: 42, sz: 2.5, del: 4.5, dur: 8,  col: "168,85,247"  },
  { id: 9,  x: 88, y: 28, sz: 1,   del: 1.5, dur: 12, col: "251,191,36"  },
  { id: 10, x: 11, y: 52, sz: 1.5, del: 3.5, dur: 11, col: "251,115,0"   },
  { id: 11, x: 21, y: 85, sz: 2,   del: 0,   dur: 9,  col: "168,85,247"  },
  { id: 12, x: 48, y: 35, sz: 1,   del: 2,   dur: 14, col: "251,115,0"   },
  { id: 13, x: 66, y: 88, sz: 2.5, del: 4,   dur: 10, col: "168,85,247"  },
  { id: 14, x: 84, y: 60, sz: 1.5, del: 1.5, dur: 8,  col: "251,191,36"  },
  { id: 15, x: 37, y: 28, sz: 2,   del: 3,   dur: 12, col: "168,85,247"  },
  { id: 16, x: 56, y: 50, sz: 1,   del: 5,   dur: 11, col: "251,115,0"   },
  { id: 17, x: 92, y: 12, sz: 2.5, del: 0.8, dur: 9,  col: "251,191,36"  },
];

const BG_EMBERS = [
  { id: 0, x: 13, y: 65, del: 0,   dur: 8  },
  { id: 1, x: 27, y: 48, del: 3,   dur: 10 },
  { id: 2, x: 44, y: 70, del: 6,   dur: 7  },
  { id: 3, x: 58, y: 32, del: 1.5, dur: 9  },
  { id: 4, x: 71, y: 55, del: 4.5, dur: 11 },
  { id: 5, x: 86, y: 73, del: 2,   dur: 8  },
  { id: 6, x: 35, y: 45, del: 5,   dur: 10 },
  { id: 7, x: 64, y: 80, del: 0.5, dur: 7  },
];

const BG_METEORS = [
  { id: 0, x: 8,  y: 6,  del: 0,  dur: 3   },
  { id: 1, x: 32, y: 4,  del: 8,  dur: 3.5 },
  { id: 2, x: 60, y: 10, del: 16, dur: 3   },
  { id: 3, x: 80, y: 3,  del: 24, dur: 4   },
];

/* ─── Item classification ────────────────────────────────────────── */

const KNIFE_RE    = /karambit|bayonet|butterfly|daggers|shadow|huntsman|stiletto|ursus|navaja|talon|falchion|bowie|m9 bayonet|classic knife|gut knife|paracord|survival|nomad|skeleton|★/i;
const GLOVE_RE    = /gloves|wraps/i;
const STATRAK_RE  = /stattrak/i;
const SOUVENIR_RE = /souvenir/i;

function classifyItem(name = "", priceCoins = 0) {
  const isKnife     = KNIFE_RE.test(name);
  const isGlove     = GLOVE_RE.test(name);
  const isStatTrak  = STATRAK_RE.test(name);
  const isSouvenir  = SOUVENIR_RE.test(name);
  const isPremium   = isKnife || isGlove || priceCoins >= 200;
  const isExpensive = priceCoins >= 1000;

  const accentRgb = isKnife || isGlove ? "168,85,247"
    : isSouvenir                        ? "251,191,36"
    : isStatTrak                        ? "249,115,22"
    :                                     "34,211,238";

  return { isKnife, isGlove, isPremium, isExpensive, accentRgb };
}

/* ─── Time helpers ──────────────────────────────────────────────── */

function getTimeInfo(endsAt) {
  if (!endsAt) return { label: "–", urgency: "none", msLeft: Infinity };
  const ms     = Number(endsAt) * 1000;
  const diff   = ms - Date.now();
  const msLeft = Math.max(0, diff);
  if (diff <= 0) return { label: "Ended", urgency: "done", msLeft: 0 };
  const totalMins = Math.floor(diff / 60_000);
  const hours     = Math.floor(totalMins / 60);
  const days      = Math.floor(hours / 24);
  let label;
  if (days  > 0) label = `${days}d ${hours % 24}h`;
  else if (hours > 0) label = `${hours}h ${totalMins % 60}m`;
  else if (totalMins > 0) label = `${totalMins}m`;
  else label = "<1m";
  const urgency = totalMins < 5 ? "danger" : totalMins < 30 ? "warn" : "normal";
  return { label, urgency, msLeft };
}

function isRenderable(item) {
  const hasImage = Boolean(item?.image);
  const name     = String(item?.name || "").trim();
  const hasName  = name.length > 3 && name.toLowerCase() !== "unknown item";
  return hasImage || hasName;
}

/* ─── Cinematic Background ──────────────────────────────────────── */

function CinematicBackground() {
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 0 }}>
      {/* Galaxy nebula — warm orange/purple mix */}
      <div style={{
        position: "absolute", inset: 0,
        background: [
          "radial-gradient(ellipse at 18% 15%, rgba(88,28,135,0.22)  0%, transparent 50%)",
          "radial-gradient(ellipse at 82% 12%, rgba(124,45,18,0.16)  0%, transparent 45%)",
          "radial-gradient(ellipse at 65% 82%, rgba(76,29,149,0.20)  0%, transparent 50%)",
          "radial-gradient(ellipse at 5%  72%, rgba(120,53,15,0.14)  0%, transparent 42%)",
          "radial-gradient(ellipse at 90% 48%, rgba(168,85,247,0.09) 0%, transparent 38%)",
        ].join(","),
      }} />

      {/* Animated fog blobs */}
      <div style={{
        position: "absolute", top: "4%", left: "14%", width: 660, height: 420,
        borderRadius: "50%", background: "rgba(88,28,135,0.08)", filter: "blur(90px)",
        animation: "fogDrift 20s ease-in-out infinite",
      }} />
      <div style={{
        position: "absolute", top: "50%", right: "7%", width: 500, height: 330,
        borderRadius: "50%", background: "rgba(124,45,18,0.06)", filter: "blur(80px)",
        animation: "fogDrift 26s ease-in-out infinite reverse",
      }} />
      <div style={{
        position: "absolute", top: "25%", left: "58%", width: 440, height: 300,
        borderRadius: "50%", background: "rgba(139,92,246,0.05)", filter: "blur(70px)",
        animation: "fogDrift 22s ease-in-out infinite", animationDelay: "5s",
      }} />

      {/* Grid */}
      <div style={{
        position: "absolute", inset: 0,
        backgroundImage: [
          "linear-gradient(rgba(251,115,0,0.025) 1px, transparent 1px)",
          "linear-gradient(90deg, rgba(168,85,247,0.025) 1px, transparent 1px)",
        ].join(","),
        backgroundSize: "72px 72px",
      }} />

      {/* Radar scanner — top right, orange tint */}
      <div style={{ position: "absolute", top: "6%", right: "3%", width: 260, height: 260, opacity: 0.7 }}>
        <div style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "1px solid rgba(251,115,0,0.14)" }} />
        <div style={{ position: "absolute", inset: "22%", borderRadius: "50%", border: "1px solid rgba(251,115,0,0.08)" }} />
        <div style={{
          position: "absolute", inset: 0, borderRadius: "50%", overflow: "hidden",
          animation: "scannerSweep 10s linear infinite",
        }}>
          <div style={{
            position: "absolute", top: "50%", left: "50%", width: "50%", height: 1,
            background: "linear-gradient(90deg, rgba(251,115,0,0.55) 0%, transparent 100%)",
            transformOrigin: "left center",
          }} />
        </div>
        {[0, 1.8, 3.6].map((d, i) => (
          <div key={i} style={{
            position: "absolute", inset: "36%", borderRadius: "50%",
            border: "1px solid rgba(251,115,0,0.3)",
            animation: `ringPing 3s ${d}s ease-out infinite`,
          }} />
        ))}
        <div style={{ position: "absolute", top: "50%", left: "8%", right: "8%", height: 1, background: "rgba(251,115,0,0.05)", transform: "translateY(-50%)" }} />
        <div style={{ position: "absolute", left: "50%", top: "8%", bottom: "8%", width: 1, background: "rgba(251,115,0,0.05)", transform: "translateX(-50%)" }} />
      </div>

      {/* Meteor streaks */}
      {BG_METEORS.map(m => (
        <div key={m.id} style={{
          position: "absolute", left: `${m.x}%`, top: `${m.y}%`,
          width: 140, height: 1,
          background: "linear-gradient(90deg, transparent 0%, rgba(251,115,0,0.65) 35%, rgba(168,85,247,0.45) 70%, transparent 100%)",
          transform: "rotate(35deg)", transformOrigin: "left center",
          animation: `meteorFly ${m.dur}s ${m.del}s ease-in infinite`,
          opacity: 0,
        }} />
      ))}

      {/* Particles — reduced opacity (calm) */}
      {BG_PARTICLES.map(p => (
        <div key={p.id} style={{
          position: "absolute", left: `${p.x}%`, top: `${p.y}%`,
          width: p.sz, height: p.sz, borderRadius: "50%",
          background: `rgba(${p.col},0.28)`,
          boxShadow: `0 0 ${p.sz * 3}px rgba(${p.col},0.20)`,
          animation: `particleRise ${p.dur}s ${p.del}s ease-in-out infinite`,
        }} />
      ))}

      {/* Embers — reduced opacity (calm) */}
      {BG_EMBERS.map(e => (
        <div key={e.id} style={{
          position: "absolute", left: `${e.x}%`, top: `${e.y}%`,
          width: 2, height: 2, borderRadius: "50%",
          background: "rgba(251,115,0,0.22)",
          boxShadow: "0 0 4px rgba(251,115,0,0.14)",
          animation: `floatEmber ${e.dur}s ${e.del}s ease-in-out infinite`,
        }} />
      ))}

      {/* Vignette */}
      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0, height: "28%",
        background: "linear-gradient(to top, rgba(7,8,18,0.55), transparent)",
      }} />
    </div>
  );
}

/* ─── Live Activity Ticker ──────────────────────────────────────── */

function LiveActivityTicker({ items }) {
  const events = useMemo(() => {
    if (!items.length) return [];
    const evts = [];
    for (const item of items.slice(0, 24)) {
      const bids = Number(item?.auction?.bids ?? 0);
      const { urgency } = getTimeInfo(item?.auction?.ends_at);
      const name  = getBaseName(item?.name) || "Unknown";
      const price = Number(item?.priceCoins ?? 0);
      if (urgency === "danger") {
        evts.push({ type: "ending", tag: "ENDING", name, price, bids });
      } else if (bids >= 5) {
        evts.push({ type: "hot",    tag: "HOT BID", name, price, bids });
      } else if (bids > 0) {
        evts.push({ type: "bid",    tag: "BID",     name, price, bids });
      } else {
        evts.push({ type: "new",    tag: "LISTED",  name, price, bids });
      }
    }
    return evts;
  }, [items]);

  if (!events.length) return null;

  const tagColor = { ending: "#FFAAAA", hot: "#f59e0b", bid: "#a855f7", new: "rgba(255,255,255,0.25)" };
  const allEvts  = [...events, ...events]; // duplicate for seamless loop
  const duration = Math.max(22, events.length * 3.5);

  return (
    <div style={{
      position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 40,
      height: 34, overflow: "hidden",
      background: "rgba(7,8,18,0.95)", backdropFilter: "blur(20px)",
      borderTop: "1px solid rgba(251,115,0,0.14)",
      boxShadow: "0 -8px 40px rgba(0,0,0,0.5)",
    }}>
      {/* Fade edges */}
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 72, background: "linear-gradient(90deg, rgba(7,8,18,1), transparent)", zIndex: 2, pointerEvents: "none" }} />
      <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 72, background: "linear-gradient(-90deg, rgba(7,8,18,1), transparent)", zIndex: 2, pointerEvents: "none" }} />

      {/* LIVE label */}
      <div style={{
        position: "absolute", left: 0, top: 0, bottom: 0, zIndex: 3,
        display: "flex", alignItems: "center", gap: 6, padding: "0 14px",
        background: "rgba(251,115,0,0.12)", borderRight: "1px solid rgba(251,115,0,0.18)",
      }}>
        <span style={{
          width: 5, height: 5, borderRadius: "50%",
          background: "#fb923c", boxShadow: "0 0 8px #fb923c",
          animation: "accentPulse 1.5s ease-in-out infinite",
        }} />
        <span style={{ fontSize: 10.5, fontWeight: 900, letterSpacing: "0.10em", color: "#fb923c" }}>LIVE</span>
      </div>

      {/* Scrolling content */}
      <div style={{
        display: "flex", alignItems: "center", height: "100%",
        paddingLeft: 80, width: "max-content",
        animation: `tickerScroll ${duration}s linear infinite`,
      }}>
        {allEvts.map((evt, i) => (
          <div key={i} style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "0 20px", whiteSpace: "nowrap", flexShrink: 0,
          }}>
            <span style={{
              fontSize: 10.5, fontWeight: 800, letterSpacing: "0.08em",
              color: tagColor[evt.type] ?? "rgba(255,255,255,0.3)",
              textShadow: evt.type !== "new" ? `0 0 6px ${tagColor[evt.type]}50` : "none",
            }}>
              {evt.tag}
            </span>
            <span style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.58)" }}>{evt.name}</span>
            {evt.price > 0 && (
              <span style={{ fontSize: 11, fontWeight: 800, color: "rgba(251,191,36,0.65)" }}>
                {formatCoins(evt.price)}
              </span>
            )}
            {evt.bids > 0 && (
              <span style={{ fontSize: 10.5, color: "rgba(255,255,255,0.28)", fontWeight: 600 }}>
                {evt.bids} bid{evt.bids !== 1 ? "s" : ""}
              </span>
            )}
            <span style={{ width: 2, height: 2, borderRadius: "50%", background: "rgba(255,255,255,0.12)" }} />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Sub-components ────────────────────────────────────────────── */

function StatChip({ label, value, accent, glow }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "5px 12px", borderRadius: 12,
      background: glow ? `rgba(${accent},0.08)` : "rgba(255,255,255,0.04)",
      border: `1px solid rgba(${accent || "255,255,255"},${glow ? "0.20" : "0.08"})`,
      boxShadow: glow ? `0 0 16px rgba(${accent},0.10)` : "none",
    }}>
      <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: "rgba(255,255,255,0.35)" }}>
        {label}
      </span>
      <span style={{
        fontSize: 14, fontWeight: 900, fontVariantNumeric: "tabular-nums",
        color: accent ? `rgb(${accent})` : "rgba(255,255,255,0.9)",
        textShadow: glow ? `0 0 12px rgba(${accent},0.45)` : "none",
      }}>
        {value}
      </span>
    </div>
  );
}

function FilterInput({ icon, placeholder, value, onChange, type = "text", width }) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      height: 36, padding: "0 12px", borderRadius: 12,
      width: width || undefined,
      background: focused ? "rgba(251,115,0,0.08)" : "rgba(255,255,255,0.04)",
      border: focused ? "1px solid rgba(251,115,0,0.35)" : "1px solid rgba(255,255,255,0.08)",
      boxShadow: focused ? "0 0 0 3px rgba(251,115,0,0.06), 0 0 18px rgba(251,115,0,0.06)" : "none",
      transition: "all 0.15s ease",
    }}>
      {icon && <span style={{ fontSize: 13, color: "rgba(251,115,0,0.55)", flexShrink: 0 }}>{icon}</span>}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        className="placeholder:text-white/20"
        style={{ flex: 1, background: "transparent", border: "none", outline: "none", fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.88)", fontFamily: "inherit", minWidth: 0 }}
      />
    </div>
  );
}

function FilterSelect({ value, onChange, options }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        height: 36, padding: "0 12px", borderRadius: 12,
        fontSize: 13, fontWeight: 500, outline: "none", appearance: "none", cursor: "pointer",
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
        color: "rgba(255,255,255,0.7)",
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} style={{ background: "#0f0c1e" }}>{o.label}</option>
      ))}
    </select>
  );
}

function DiscountBadge({ pct }) {
  if (!pct || pct < 1) return null;
  const r = Math.round(pct);
  const hot = r >= 15, good = r >= 7;
  return (
    <div style={{
      padding: "3px 8px", borderRadius: 8, fontSize: 11, fontWeight: 900, lineHeight: 1,
      background: hot  ? "rgba(34,197,94,0.22)"  : good ? "rgba(34,197,94,0.13)" : "rgba(34,197,94,0.08)",
      border:     hot  ? "1px solid rgba(34,197,94,0.52)" : "1px solid rgba(34,197,94,0.20)",
      color:      hot  ? "#4ade80" : "#86efac",
      boxShadow:  hot  ? "0 0 18px rgba(34,197,94,0.32)" : "none",
    }}>
      -{r}%
    </div>
  );
}

function LoadingGrid() {
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="rounded-[20px] overflow-hidden" style={{
          background: "linear-gradient(160deg, #1a1030 0%, #120d20 100%)",
          border: "1px solid rgba(251,115,0,0.07)",
          height: 390,
        }}>
          <div className="p-4 space-y-3">
            <div className="h-[170px] w-full rounded-xl skeleton" />
            <div className="h-4 w-40 rounded skeleton" />
            <div className="h-3 w-20 rounded skeleton" />
            <div className="h-7 w-28 rounded skeleton" />
            <div className="h-10 w-full rounded-xl skeleton" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ImagePlaceholder({ accentRgb }) {
  return (
    <div style={{
      width: "100%", height: "100%",
      display: "flex", alignItems: "center", justifyContent: "center",
      background: `radial-gradient(ellipse at 50% 30%, rgba(${accentRgb},0.08) 0%, transparent 70%)`,
    }}>
      <svg width={52} height={52} viewBox="0 0 24 24" fill="none"
        stroke={`rgba(${accentRgb},0.2)`} strokeWidth={0.7} strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
        <path d="M12 17h.01" />
      </svg>
    </div>
  );
}

/* ─── Corner Accents ─────────────────────────────────────────────── */

function CornerAccents({ accentRgb }) {
  const base = { position: "absolute", width: 12, height: 12 };
  const c = `rgba(${accentRgb},0.38)`;
  return (
    <>
      <div style={{ ...base, top: 0, left: 0,   borderTop: `1.5px solid ${c}`, borderLeft: `1.5px solid ${c}`,  borderTopLeftRadius: 4     }} />
      <div style={{ ...base, top: 0, right: 0,  borderTop: `1.5px solid ${c}`, borderRight: `1.5px solid ${c}`, borderTopRightRadius: 4    }} />
      <div style={{ ...base, bottom: 0, left: 0,  borderBottom: `1.5px solid ${c}`, borderLeft: `1.5px solid ${c}`,  borderBottomLeftRadius: 4  }} />
      <div style={{ ...base, bottom: 0, right: 0, borderBottom: `1.5px solid ${c}`, borderRight: `1.5px solid ${c}`, borderBottomRightRadius: 4 }} />
    </>
  );
}

/* ─── Auction Card ──────────────────────────────────────────────── */

const AuctionCard = memo(function AuctionCard({ item, onShare }) {
  const [hov,  setHov]  = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const fullName   = item?.name || "";
  const baseName   = getBaseName(fullName) || fullName;
  const itemType   = item?.type || getItemType(fullName);
  const image      = item?.image || "";
  const priceCoins = Number(item?.priceCoins    ?? 0) || 0;
  const suggested  = Number(item?.suggestedCoins ?? 0) || 0;
  const discount   = Number(item?.discountPct    ?? 0) || 0;
  const wear       = item?.wear_name || getWear(item);
  const bids       = Number(item?.auction?.bids ?? 0);
  const endsAt     = item?.auction?.ends_at;
  const savedCoins = discount > 0 && suggested > priceCoins ? suggested - priceCoins : 0;
  const empireUrl  = item?.itemId ? `https://csgoempire.com/item/${item.itemId}` : "https://csgoempire.com";

  const { isKnife, isGlove, isPremium, isExpensive, accentRgb } = classifyItem(fullName, priceCoins);
  const imgHeight = isKnife || isGlove ? 190 : isExpensive ? 185 : 170;

  const { label: timeLabel, urgency } = getTimeInfo(endsAt);

  // Timer badge colours — danger uses amber, not red
  const timeBadge = {
    normal: { color: `rgba(${accentRgb},0.9)`, bg: `rgba(${accentRgb},0.10)`, border: `rgba(${accentRgb},0.22)` },
    warn:   { color: "#FFE7B0",                 bg: "rgba(245,158,11,0.14)",    border: "rgba(245,158,11,0.35)"  },
    danger: { color: "#FFE7B0",                 bg: "rgba(245,158,11,0.14)",    border: "rgba(245,158,11,0.35)"  },
    done:   { color: "rgba(255,255,255,0.2)",   bg: "rgba(255,255,255,0.04)",   border: "rgba(255,255,255,0.07)" },
    none:   { color: "rgba(255,255,255,0.2)",   bg: "rgba(255,255,255,0.04)",   border: "rgba(255,255,255,0.07)" },
  };
  const tb = timeBadge[urgency] ?? timeBadge.normal;

  // Card background: deep dark with purple/navy
  const cardBg = isPremium
    ? "linear-gradient(160deg, #1e1535 0%, #18112e 50%, #120e24 100%)"
    : "linear-gradient(160deg, #191230 0%, #13102a 55%, #0e0c1e 100%)";

  // Image area ambient glow
  const imgBg = [
    `radial-gradient(ellipse at 50% 30%, rgba(${accentRgb},0.22) 0%, transparent 60%)`,
    `radial-gradient(ellipse at 50% 95%, rgba(${accentRgb},0.07) 0%, transparent 50%)`,
    isPremium ? "linear-gradient(180deg, #1a1030 0%, #120d20 100%)" : "#130f1e",
  ].join(",");

  // Neutral borders — no breathing animations, no red
  const cardBorder = hov
    ? `1px solid rgba(${accentRgb},0.35)`
    : "1px solid rgba(255,255,255,0.10)";

  const cardShadow = hov
    ? `0 16px 40px rgba(0,0,0,0.55), 0 0 40px rgba(${accentRgb},0.08)`
    : "0 4px 16px rgba(0,0,0,0.35)";

  return (
    <article
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      onDoubleClick={() => onShare?.(item)}
      title="Double-click to share to chat"
      style={{
        position: "relative", display: "flex", flexDirection: "column",
        overflow: "hidden", borderRadius: 20,
        background: cardBg,
        border: cardBorder,
        boxShadow: cardShadow,
        transform: hov ? "translateY(-4px)" : "translateY(0)",
        transition: "transform 0.22s ease, box-shadow 0.22s ease, border-color 0.22s ease",
      }}
    >
      {/* Hover inner radial glow */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        opacity: hov ? 1 : 0, transition: "opacity 0.3s ease",
        background: `radial-gradient(ellipse at 50% 0%, rgba(${accentRgb},0.14), transparent 58%)`,
      }} />

      {/* Corner accents on premium items */}
      {isPremium && <CornerAccents accentRgb={accentRgb} />}

      {/* Top accent line */}
      <div style={{
        height: 2, flexShrink: 0,
        background: (urgency === "danger" || urgency === "warn")
          ? "linear-gradient(90deg, transparent, rgba(245,158,11,0.70) 50%, transparent)"
          : `linear-gradient(90deg, transparent, rgba(${accentRgb},0.75) 50%, transparent)`,
        opacity: hov ? 1 : isPremium ? 0.55 : 0.22,
        transition: "opacity 0.3s",
      }} />

      {/* Type label */}
      {itemType && (
        <div style={{ padding: "10px 14px 0", position: "relative", zIndex: 1 }}>
          <span style={{
            fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.14em",
            color: `rgba(${accentRgb},0.70)`,
          }}>
            {itemType}
          </span>
        </div>
      )}

      {/* Image area */}
      <div style={{ position: "relative", margin: itemType ? "6px 12px 0" : "12px 12px 0", zIndex: 1 }}>
        <div style={{
          position: "relative", height: imgHeight, borderRadius: 14, overflow: "hidden",
          display: "flex", alignItems: "center", justifyContent: "center",
          background: imgBg,
        }}>
          {/* Floor ambient glow */}
          <div style={{
            position: "absolute", bottom: 0, left: "10%", right: "10%", height: "40%",
            background: `radial-gradient(ellipse at 50% 100%, rgba(${accentRgb},0.26) 0%, transparent 70%)`,
            pointerEvents: "none",
          }} />

          {/* Discount badge */}
          {discount >= 1 && (
            <div style={{ position: "absolute", top: 8, left: 8, zIndex: 10 }}>
              <DiscountBadge pct={discount} />
            </div>
          )}

          {/* Timer badge — top right */}
          {urgency !== "none" && (
            <div style={{
              position: "absolute", top: 8, right: 8, zIndex: 10,
              display: "inline-flex", alignItems: "center", gap: 5,
              padding: "4px 9px", borderRadius: 8,
              fontSize: 12, fontWeight: 700, lineHeight: 1.2, whiteSpace: "nowrap",
              background: tb.bg, border: `1px solid ${tb.border}`, color: tb.color,
            }}>
              {(urgency === "danger" || urgency === "warn") && (
                <span style={{
                  width: 5, height: 5, borderRadius: "50%",
                  background: "#f59e0b", flexShrink: 0, display: "inline-block",
                  animation: "accentPulse 2s ease-in-out infinite",
                }} />
              )}
              {timeLabel}
            </div>
          )}

          {/* AUCTION badge — bottom left */}
          <div style={{
            position: "absolute", bottom: 8, left: 8, zIndex: 10,
            display: "inline-flex", alignItems: "center", gap: 5,
            height: 20, padding: "0 8px", borderRadius: 6,
            fontSize: 10, fontWeight: 800, letterSpacing: "0.10em", textTransform: "uppercase",
            background: "rgba(251,115,0,0.14)", border: "1px solid rgba(251,115,0,0.28)",
            color: "rgba(251,140,0,0.95)",
          }}>
            <span style={{
              width: 4, height: 4, borderRadius: "50%",
              background: "#fb923c", boxShadow: "0 0 6px #fb923c",
              display: "inline-block",
              animation: "accentPulse 2s ease-in-out infinite",
            }} />
            AUCTION
          </div>

          {/* Skin image */}
          {image ? (
            <img
              src={image}
              alt={baseName || "auction item"}
              style={{
                height: "86%", width: "100%", objectFit: "contain",
                transform: hov ? "scale(1.09) translateY(-3px)" : "scale(1)",
                transition: "transform 0.4s cubic-bezier(0.4,0,0.2,1), filter 0.4s ease",
                filter: hov ? `drop-shadow(0 0 14px rgba(${accentRgb},0.40))` : "none",
              }}
              loading="lazy"
              decoding="async"
              onError={(e) => { e.currentTarget.style.opacity = "0"; }}
            />
          ) : (
            <ImagePlaceholder accentRgb={accentRgb} />
          )}
        </div>
      </div>

      {/* Name */}
      <div style={{ padding: "10px 14px 0", position: "relative", zIndex: 1 }}>
        <p style={{
          fontSize: 14, fontWeight: 700, color: "rgba(255,255,255,0.92)",
          lineHeight: 1.4, letterSpacing: "-0.01em",
          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
        }}>
          {baseName || <span style={{ color: "rgba(255,255,255,0.25)" }}>Loading…</span>}
        </p>
      </div>

      {/* Wear chip */}
      {wear && (
        <div style={{ padding: "6px 14px 0", position: "relative", zIndex: 1 }}>
          <span style={{
            display: "inline-flex", alignItems: "center",
            height: 22, padding: "0 9px", borderRadius: 10,
            fontSize: 12, fontWeight: 600,
            background: `rgba(${accentRgb},0.09)`,
            border:     `1px solid rgba(${accentRgb},0.22)`,
            color:      `rgba(${accentRgb},0.88)`,
          }}>
            {wear}
          </span>
        </div>
      )}

      {/* Price */}
      <div style={{ padding: "8px 14px 0", position: "relative", zIndex: 1 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
          <span style={{
            fontSize: 24, fontWeight: 900, lineHeight: 1,
            fontVariantNumeric: "tabular-nums", color: "#fbbf24",
            textShadow: hov ? "0 0 24px rgba(251,191,36,0.45)" : "0 0 10px rgba(251,191,36,0.18)",
            transition: "text-shadow 0.3s",
          }}>
            {formatCoins(priceCoins)}
          </span>
          <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(251,191,36,0.40)", flexShrink: 0 }}>coins</span>
        </div>

        {savedCoins > 0 && suggested > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.22)" }}>
              from <span style={{ textDecoration: "line-through" }}>{formatCoins(suggested)}</span>
            </span>
            <span style={{
              fontSize: 11, fontWeight: 800, color: "#4ade80",
              background: "rgba(34,197,94,0.10)", borderRadius: 5, padding: "1px 5px",
              border: "1px solid rgba(34,197,94,0.22)",
            }}>
              save {formatCoins(savedCoins)}
            </span>
          </div>
        )}
      </div>

      {/* Bids counter */}
      <div style={{ padding: "5px 14px 0", position: "relative", zIndex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          {bids > 0 && (
            <span style={{
              width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
              background: `rgba(${accentRgb},0.7)`,
              boxShadow: `0 0 6px rgba(${accentRgb},0.4)`,
              animation: bids > 3 ? "accentPulse 2s ease-in-out infinite" : "none",
            }} />
          )}
          <span style={{ fontSize: 12, color: bids > 0 ? `rgba(${accentRgb},0.75)` : "rgba(255,255,255,0.28)", fontWeight: bids > 0 ? 600 : 400 }}>
            {bids === 0 ? "No bids yet" : `${bids} bid${bids !== 1 ? "s" : ""}`}
          </span>
        </div>
      </div>

      {/* Urgency strip — amber for both warn and danger */}
      {(urgency === "danger" || urgency === "warn") && (
        <div style={{
          margin: "8px 12px 0", padding: "6px 10px", borderRadius: 10,
          display: "flex", alignItems: "center", gap: 6,
          background: "rgba(245,158,11,0.14)",
          border: "1px solid rgba(245,158,11,0.35)",
          position: "relative", zIndex: 1,
        }}>
          <span style={{
            width: 5, height: 5, borderRadius: "50%", flexShrink: 0,
            background: "#f59e0b",
            animation: "accentPulse 2.5s ease-in-out infinite",
          }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: "#FFE7B0" }}>
            {urgency === "danger" ? `Ending soon · ${timeLabel}` : `Ends in ${timeLabel}`}
          </span>
        </div>
      )}

      {/* CTA */}
      <div style={{ marginTop: "auto", padding: "10px 12px 12px", position: "relative", zIndex: 1, display: "flex", gap: 8 }}>
        <a
          href={empireUrl}
          target="_blank"
          rel="noreferrer"
          style={{
            flex: 1, display: "block", textAlign: "center",
            padding: "11px 0", borderRadius: 14,
            fontSize: 13, fontWeight: 900, color: "#000", textDecoration: "none",
            background: "linear-gradient(135deg,#fbbf24 0%,#f59e0b 100%)",
            boxShadow: hov
              ? "0 8px 26px rgba(251,191,36,0.38), 0 0 0 1px rgba(251,191,36,0.22)"
              : "0 2px 10px rgba(251,191,36,0.16)",
            transition: "box-shadow 0.2s",
          }}
        >
          Open Auction →
        </a>
        <button
          type="button"
          title="Share to chat"
          onClick={(e) => { e.stopPropagation(); onShare?.(item); }}
          style={{
            flexShrink: 0, width: 40, borderRadius: 14, cursor: "pointer",
            background: `rgba(${accentRgb},0.10)`,
            border: `1px solid rgba(${accentRgb},0.24)`,
            color: `rgba(${accentRgb},0.9)`,
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "background 0.15s",
          }}
          onMouseEnter={e => { e.currentTarget.style.background = `rgba(${accentRgb},0.20)`; }}
          onMouseLeave={e => { e.currentTarget.style.background = `rgba(${accentRgb},0.10)`; }}
        >
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
            <line x1="8.6" y1="10.6" x2="15.4" y2="6.4" /><line x1="8.6" y1="13.4" x2="15.4" y2="17.6" />
          </svg>
        </button>
      </div>
    </article>
  );
});

/* ─── Main Page ─────────────────────────────────────────────────── */

export default function AuctionsPage() {
  const [itemMap,   setItemMap]   = useState(new Map());
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);
  const [shareItem, setShareItem] = useState(null);
  const aliveRef                  = useRef(true);
  const { socket, connected }     = useSocket();

  const [search,   setSearch]   = useState("");
  const [category, setCategory] = useState("");
  const [wear,     setWear]     = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [sort,     setSort]     = useState("endingSoon");

  const handleShare = useCallback((item) => setShareItem(item), []);

  const upsertItems = useCallback((incoming) => {
    if (!Array.isArray(incoming) || !incoming.length) return;
    setItemMap((prev) => {
      const next = new Map(prev);
      for (const it of incoming) {
        const id = String(it?.itemId ?? it?.id ?? "");
        if (id) next.set(id, it);
      }
      return next;
    });
  }, []);

  const pruneExpired = useCallback(() => {
    const cutoff = Date.now();
    setItemMap((prev) => {
      const next = new Map(prev);
      let changed = false;
      for (const [id, it] of next) {
        const endsAt = it?.auction?.ends_at;
        if (endsAt && Number(endsAt) * 1000 < cutoff) { next.delete(id); changed = true; }
      }
      return changed ? next : prev;
    });
  }, []);

  const fetchAuctions = useCallback(async () => {
    try {
      const res = await api.get("/auctions", { params: { limit: 500 } });
      const raw = Array.isArray(res?.data?.items) ? res.data.items : [];
      if (aliveRef.current) {
        setItemMap((prev) => {
          const next = new Map(prev);
          for (const it of raw) {
            const id = String(it?.itemId ?? it?.id ?? "");
            if (id) next.set(id, it);
          }
          return next;
        });
        setError(null);
      }
    } catch (err) {
      console.error("[AuctionsPage] fetch error:", err);
      if (aliveRef.current) setError("Failed to load auctions.");
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    fetchAuctions();
    // REST fallback/resync — pauses while backgrounded, catches up on focus.
    // Live updates otherwise stream in via the "auctions:live" socket room
    // (see the subscribe effect below), so this interval only needs to
    // correct drift, not be the primary delivery path.
    const pollTimer = setInterval(() => {
      if (aliveRef.current && document.visibilityState === "visible") fetchAuctions();
    }, POLL_MS);
    const pruneTimer = setInterval(pruneExpired, 30_000);
    function onAuctionUpdate(e) { if (aliveRef.current) upsertItems(e.detail); }
    function onItemDeleted(e) {
      const itemId = e.detail?.itemId;
      if (!itemId || !aliveRef.current) return;
      setItemMap((prev) => {
        const id = String(itemId);
        if (!prev.has(id)) return prev;
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
    }
    function onVisible() {
      if (aliveRef.current && document.visibilityState === "visible") fetchAuctions();
    }
    window.addEventListener("auctions:update", onAuctionUpdate);
    window.addEventListener("item_deleted", onItemDeleted);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      aliveRef.current = false;
      clearInterval(pollTimer);
      clearInterval(pruneTimer);
      window.removeEventListener("auctions:update", onAuctionUpdate);
      window.removeEventListener("item_deleted", onItemDeleted);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [fetchAuctions, upsertItems, pruneExpired]);

  // Join the "auctions:live" Socket.IO room while this page is mounted so
  // the server scopes auctions:update broadcasts to viewers of this page
  // instead of every connected client. Re-subscribes on reconnect (a fresh
  // socket doesn't retain prior room membership) and does one REST resync
  // to cover anything missed while disconnected — but not on the very first
  // connect, since fetchAuctions() already runs once on mount.
  const wasConnectedRef = useRef(false);
  useEffect(() => {
    if (!socket) return;
    function subscribe() { socket.emit("auctions:subscribe"); }
    if (connected) subscribe();
    socket.on("connect", subscribe);
    return () => {
      socket.off("connect", subscribe);
      socket.emit("auctions:unsubscribe");
    };
  }, [socket, connected]);

  useEffect(() => {
    if (connected && wasConnectedRef.current && aliveRef.current) {
      fetchAuctions();
    }
    wasConnectedRef.current = connected;
  }, [connected, fetchAuctions]);

  const allItems = useMemo(() => Array.from(itemMap.values()), [itemMap]);

  const filteredItems = useMemo(() => {
    const q      = search.trim().toLowerCase();
    const cutoff = Date.now();
    return allItems
      .filter((item) => {
        if (!isRenderable(item)) return false;
        const endsAt = item?.auction?.ends_at;
        if (endsAt && Number(endsAt) * 1000 < cutoff) return false;
        if (q && !String(item?.name || "").toLowerCase().includes(q)) return false;
        if (category) {
          const ck = String(item?.categoryKey || "").toLowerCase();
          const ct = String(item?.category || item?.type || "").toLowerCase();
          if (ck !== category && !ct.includes(category)) return false;
        }
        if (wear && wear !== "All") { if (item?.wear_name !== wear) return false; }
        const price = Number(item?.priceCoins || 0);
        if (minPrice && price < Number(minPrice)) return false;
        if (maxPrice && price > Number(maxPrice)) return false;
        return true;
      })
      .sort((a, b) => {
        if (sort === "priceAsc")     return Number(a.priceCoins || 0) - Number(b.priceCoins || 0);
        if (sort === "priceDesc")    return Number(b.priceCoins || 0) - Number(a.priceCoins || 0);
        if (sort === "discountDesc") return Number(b.discountPct || 0) - Number(a.discountPct || 0);
        if (sort === "bidsDesc")     return Number(b?.auction?.bids || 0) - Number(a?.auction?.bids || 0);
        return Number(a?.auction?.ends_at ?? Infinity) - Number(b?.auction?.ends_at ?? Infinity);
      });
  }, [allItems, search, category, wear, minPrice, maxPrice, sort]);

  const bestDiscount = useMemo(
    () => (filteredItems.length ? Math.max(...filteredItems.map((i) => Number(i.discountPct || 0))) : 0),
    [filteredItems]
  );

  const hasFilters = search || category || (wear && wear !== "All") || minPrice || maxPrice;

  /* ─── Render ─────────────────────────────────────────────────── */

  return (
    <div className="min-h-screen" style={{ background: "#07080f" }}>
      <CinematicBackground />

      <div className="auc-content relative z-10 px-5 py-7 max-w-[1800px] mx-auto">

        {/* Header */}
        <div className="flex items-end justify-between mb-7">
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <div style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "3px 10px 3px 8px", borderRadius: 20,
                background: "rgba(251,115,0,0.10)", border: "1px solid rgba(251,115,0,0.24)",
                boxShadow: "0 0 16px rgba(251,115,0,0.08)",
              }}>
                <span style={{
                  width: 5, height: 5, borderRadius: "50%",
                  background: "#fb923c", boxShadow: "0 0 8px #fb923c",
                  display: "block", animation: "accentPulse 1.8s ease-in-out infinite",
                }} />
                <span style={{
                  fontSize: 10, fontWeight: 800, letterSpacing: "0.15em", textTransform: "uppercase",
                  color: "rgba(251,115,0,0.95)",
                }}>Live Bidding Network</span>
              </div>
            </div>

            <h1 className="auc-h1" style={{
              fontSize: 38, fontWeight: 900, letterSpacing: "-0.03em", lineHeight: 1,
              background: "linear-gradient(135deg, #ffffff 20%, rgba(251,115,0,0.85) 100%)",
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
            }}>
              Auctions
            </h1>
          </div>

          <div className="hidden md:flex items-center gap-2 flex-wrap justify-end">
            <StatChip label="Live" value={filteredItems.length.toLocaleString()} accent="34,211,238" glow />
            {bestDiscount > 0 && (
              <StatChip label="Best Deal" value={`-${Math.round(bestDiscount)}%`} accent="34,197,94" glow />
            )}
            <StatChip label="Cached" value={allItems.length.toLocaleString()} />
            <div style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "5px 12px", borderRadius: 12,
              background: "rgba(251,115,0,0.08)", border: "1px solid rgba(251,115,0,0.20)",
            }}>
              <span style={{
                width: 6, height: 6, borderRadius: "50%",
                background: "#fb923c", boxShadow: "0 0 10px rgba(251,115,0,0.7)",
                display: "block", animation: "accentPulse 1.5s ease-in-out infinite",
              }} />
              <span style={{ fontSize: 11, fontWeight: 800, color: "#fb923c", letterSpacing: "0.08em" }}>LIVE</span>
            </div>
          </div>
        </div>

        {/* Sticky filters */}
        <div className="sticky top-[60px] z-30 py-3 mb-6 -mx-5 px-5" style={{
          background: "rgba(7,8,15,0.92)", backdropFilter: "blur(24px)",
          borderBottom: "1px solid rgba(251,115,0,0.12)",
          boxShadow: "0 4px 30px rgba(0,0,0,0.55), 0 1px 0 rgba(251,115,0,0.07)",
        }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {/* Category pills — horizontal scroll on mobile */}
            <div className="chips-scroll" style={{ alignItems: "center" }}>
              {AUCTION_CATEGORIES.map((cat) => {
                const active = category === cat.key;
                return (
                  <button key={cat.key} onClick={() => setCategory(cat.key)} style={{
                    height: 30, padding: "0 14px", borderRadius: 20,
                    fontSize: 12, fontWeight: 700, cursor: "pointer",
                    background: active ? "rgba(251,115,0,0.15)" : "rgba(255,255,255,0.04)",
                    border: active ? "1px solid rgba(251,115,0,0.36)" : "1px solid rgba(255,255,255,0.07)",
                    color: active ? "#fb923c" : "rgba(255,255,255,0.45)",
                    boxShadow: active ? "0 0 14px rgba(251,115,0,0.18)" : "none",
                    transition: "all 0.15s ease",
                  }}>
                    {cat.label}
                  </button>
                );
              })}
            </div>

            {/* Inputs row */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 140px", minWidth: 0 }}>
                <FilterInput icon="⌕" placeholder="Search skins…" value={search} onChange={setSearch} />
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                <FilterInput placeholder="Min" value={minPrice} onChange={setMinPrice} type="number" width={72} />
                <span style={{ color: "rgba(255,255,255,0.18)", fontSize: 13, padding: "0 2px" }}>–</span>
                <FilterInput placeholder="Max" value={maxPrice} onChange={setMaxPrice} type="number" width={72} />
              </div>

              <FilterSelect
                value={wear || "All"}
                onChange={(v) => setWear(v === "All" ? "" : v)}
                options={WEARS.map((w) => ({ value: w, label: w }))}
              />

              <FilterSelect
                value={sort}
                onChange={setSort}
                options={[
                  { value: "endingSoon",   label: "Ending soon"   },
                  { value: "priceAsc",     label: "Price: low"    },
                  { value: "priceDesc",    label: "Price: high"   },
                  { value: "discountDesc", label: "Best discount"  },
                  { value: "bidsDesc",     label: "Most bids"     },
                ]}
              />

              {hasFilters && (
                <button
                  onClick={() => { setSearch(""); setCategory(""); setWear(""); setMinPrice(""); setMaxPrice(""); }}
                  style={{
                    height: 36, padding: "0 12px", borderRadius: 12,
                    fontSize: 12, fontWeight: 600, cursor: "pointer",
                    background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                    color: "rgba(255,255,255,0.40)", transition: "all 0.15s",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.color = "#fff"; }}
                  onMouseLeave={e => { e.currentTarget.style.color = "rgba(255,255,255,0.40)"; }}
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <LoadingGrid />
        ) : error ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "96px 0", gap: 16 }}>
            <div style={{ height: 64, width: 64, borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.16)" }}>⚠️</div>
            <p style={{ fontSize: 13, fontWeight: 700, color: "rgba(248,113,113,0.6)" }}>{error}</p>
          </div>
        ) : filteredItems.length === 0 && !hasFilters ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "96px 0", gap: 16 }}>
            <div style={{ height: 64, width: 64, borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, background: "rgba(251,115,0,0.06)", border: "1px solid rgba(251,115,0,0.14)" }}>⏳</div>
            <div style={{ textAlign: "center" }}>
              <p style={{ fontSize: 15, fontWeight: 900, color: "rgba(255,255,255,0.22)" }}>Waiting for live data</p>
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.12)", marginTop: 4 }}>Auction items stream in via websocket</p>
            </div>
          </div>
        ) : filteredItems.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "96px 0", gap: 16 }}>
            <div style={{ height: 64, width: 64, borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>🔍</div>
            <div style={{ textAlign: "center" }}>
              <p style={{ fontSize: 15, fontWeight: 900, color: "rgba(255,255,255,0.22)" }}>No auctions found</p>
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.12)", marginTop: 4 }}>Try adjusting your filters</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filteredItems.map((item) => (
              <AuctionCard key={item.itemId || item.id} item={item} onShare={handleShare} />
            ))}
          </div>
        )}
      </div>


      {shareItem && (
        <ShareAuctionModal item={shareItem} onClose={() => setShareItem(null)} />
      )}
    </div>
  );
}
