import { memo, useState } from "react";
import empireLogo from "../../assets/emp1re-logo.png";
import {
  formatCoins, getBaseName, getFloatValue, getItemType, getWear, slugify,
} from "../../lib/marketItem";
import DealScoreBadge from "../../components/DealScoreBadge";
import DealScoreBreakdown from "../../components/DealScoreBreakdown";

function EmpireLogo() {
  const [failed, setFailed] = useState(false);
  if (failed) return <span style={{ fontSize: 10.5, fontWeight: 900, color: "rgba(251,191,36,0.85)" }}>EMP</span>;
  return (
    <img src={empireLogo} alt="CSGOEmpire" width={16} height={16}
      style={{ borderRadius: "50%", objectFit: "contain", display: "block" }}
      onError={() => setFailed(true)} />
  );
}

const KNIFE_RE    = /karambit|bayonet|butterfly|daggers|shadow|huntsman|stiletto|ursus|navaja|talon|falchion|bowie|m9 bayonet|classic knife|gut knife|paracord|survival|nomad|skeleton|★/i;
const GLOVE_RE    = /gloves|wraps/i;
const STATRAK_RE  = /stattrak/i;
const SOUVENIR_RE = /souvenir/i;

function classifyItem(name = "", priceCoins = 0) {
  const isKnife    = KNIFE_RE.test(name);
  const isGlove    = GLOVE_RE.test(name);
  const isStatTrak = STATRAK_RE.test(name);
  const isSouvenir = SOUVENIR_RE.test(name);
  const isPremium  = isKnife || isGlove || priceCoins >= 200;
  const isExpensive = priceCoins >= 1000;

  const accentRgb = isKnife || isGlove ? "168,85,247"
    : isSouvenir ? "251,191,36"
    : isStatTrak ? "249,115,22"
    : "34,211,238";

  return { isKnife, isGlove, isStatTrak, isSouvenir, isPremium, isExpensive, accentRgb };
}

// Real CS wear ranges: start/end are float values (0–1), width is % of the track
const SEGMENTS = [
  { key: "FN", floatStart: 0.00, floatEnd: 0.07, width:  7, color: "#22c55e", label: "Factory New"    },
  { key: "MW", floatStart: 0.07, floatEnd: 0.15, width:  8, color: "#86efac", label: "Minimal Wear"   },
  { key: "FT", floatStart: 0.15, floatEnd: 0.38, width: 23, color: "#fde047", label: "Field-Tested"   },
  { key: "WW", floatStart: 0.38, floatEnd: 0.45, width:  7, color: "#fb923c", label: "Well-Worn"      },
  { key: "BS", floatStart: 0.45, floatEnd: 1.00, width: 55, color: "#ef4444", label: "Battle-Scarred" },
];

function activeSegment(f) {
  return SEGMENTS.find(s => f < s.floatEnd) ?? SEGMENTS[4];
}

const FloatBar = memo(function FloatBar({ floatValue }) {
  if (!Number.isFinite(floatValue) || floatValue < 0 || floatValue > 1) return null;

  // Marker is a direct linear mapping: float 0→1 = 0%→100% of the track
  const markerPct = Math.min(Math.max(floatValue * 100, 0.3), 99.7);
  const seg = activeSegment(floatValue);

  return (
    <div style={{ padding: "0 2px" }}>
      {/* Track: explicit segments with correct proportional widths */}
      <div style={{ position: "relative" }}>
        <div style={{ display: "flex", height: 7, borderRadius: 4, overflow: "hidden" }}>
          {SEGMENTS.map((s, i) => (
            <div key={s.key} style={{
              width: `${s.width}%`, flexShrink: 0,
              background: s.color,
              position: "relative",
            }}>
              {/* Separator line between zones */}
              {i > 0 && (
                <div style={{ position: "absolute", inset: "0 auto 0 0", width: 1, background: "rgba(0,0,0,0.55)" }} />
              )}
            </div>
          ))}
        </div>

        {/* Marker needle — positioned over the track using floatValue * 100% */}
        <div style={{
          position: "absolute", top: "50%", left: `${markerPct}%`,
          transform: "translate(-50%, -50%)",
          width: 4, height: 16, borderRadius: 2,
          background: "#fff",
          boxShadow: "0 0 0 2px rgba(0,0,0,0.5), 0 0 14px rgba(255,255,255,0.95)",
          pointerEvents: "none",
        }} />
      </div>

      {/* Zone labels — each centered within its proportional segment */}
      <div style={{ display: "flex", marginTop: 5, padding: "0 1px" }}>
        {SEGMENTS.map(s => (
          <div key={s.key} style={{ width: `${s.width}%`, flexShrink: 0, textAlign: "center" }}>
            <span style={{
              fontSize: 10, fontWeight: 900, textTransform: "uppercase",
              color: s.key === seg.key ? s.color : "rgba(255,255,255,0.15)",
              textShadow: s.key === seg.key ? `0 0 8px ${s.color}80` : "none",
              transition: "color 0.2s",
            }}>{s.key}</span>
          </div>
        ))}
      </div>

      {/* Float value + wear name */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 3, padding: "0 1px" }}>
        <span style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.4)" }}>
          {floatValue.toFixed(4)}
        </span>
        <span style={{ fontSize: 11, fontWeight: 900, color: seg.color }}>{seg.label}</span>
      </div>
    </div>
  );
});

function stickerSrc(s) { return s?.icon_url || s?.image || s?.url || ""; }

const StickerStrip = memo(function StickerStrip({ stickers }) {
  const visible = stickers.filter(s => stickerSrc(s)).slice(0, 5);
  if (!visible.length) return null;
  return (
    <div style={{ position: "absolute", bottom: 8, left: 8, display: "flex", gap: 4, zIndex: 10 }}>
      {visible.map((s, i) => (
        <div key={i} style={{
          width: 32, height: 32, borderRadius: 8, flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "rgba(10,7,20,0.90)",
          border: "1px solid rgba(255,255,255,0.10)",
        }}>
          <img src={stickerSrc(s)} alt={s?.name || "Sticker"} title={s?.name}
            style={{ width: 24, height: 24, objectFit: "contain" }}
            onError={e => { e.currentTarget.parentElement.style.display = "none"; }} />
        </div>
      ))}
    </div>
  );
});

function DiscountBadge({ pct }) {
  if (!pct || pct < 1) return null;
  const r = Math.round(pct);
  const hot = r >= 15, good = r >= 7;
  return (
    <div style={{
      padding: "3px 8px", borderRadius: 8, fontSize: 11, fontWeight: 900, lineHeight: 1,
      background: hot ? "rgba(34,197,94,0.22)" : good ? "rgba(34,197,94,0.13)" : "rgba(34,197,94,0.08)",
      border: hot ? "1px solid rgba(34,197,94,0.52)" : "1px solid rgba(34,197,94,0.20)",
      color: hot ? "#4ade80" : "#86efac",
      boxShadow: hot ? "0 0 18px rgba(34,197,94,0.32)" : "none",
    }}>
      -{r}%
    </div>
  );
}

// Subtle corner bracket decorations for premium items
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

const ItemCard = memo(function ItemCard({ item, onSeeMore, onShare }) {
  const [hov, setHov] = useState(false);
  const [breakdownOpen, setBreakdownOpen] = useState(false);

  const fullName   = item?.name || "Unknown Item";
  const baseName   = getBaseName(fullName);
  const itemType   = item?.type || getItemType(fullName);
  const image      = item?.image || "";
  const priceCoins = Number(item?.priceCoins    ?? 0) || 0;
  const suggested  = Number(item?.suggestedCoins ?? 0) || 0;
  const discount   = Number(item?.discountPct    ?? 0) || 0;
  const floatValue = getFloatValue(item);
  const wear       = getWear(item);
  const isSticker  = /sticker/i.test(itemType || "") || /sticker/i.test(fullName || "");
  const stickers   = Array.isArray(item?.stickers) ? item.stickers : [];
  const slug       = slugify(fullName);
  const analystUrl = slug ? `https://www.steamanalyst.com/skin/${slug}` : "#";
  const empireUrl  = item?.itemId ? `https://csgoempire.com/item/${item.itemId}` : "https://csgoempire.com";
  const hasFloat   = floatValue !== null && !isSticker;
  const savedCoins = discount > 0 && suggested > priceCoins ? (suggested - priceCoins) : 0;

  const { isKnife, isGlove, isPremium, isExpensive, accentRgb } = classifyItem(fullName, priceCoins);
  const imgHeight = isKnife || isGlove ? 200 : isExpensive ? 195 : 180;
  const imgScale  = isSticker ? 100 : isKnife || isGlove ? "92%" : "88%";

  // Deep cinematic card backgrounds
  const cardBg = isPremium
    ? "linear-gradient(160deg, #1e1535 0%, #18112e 50%, #120e24 100%)"
    : "linear-gradient(160deg, #181228 0%, #130f20 55%, #0f0c1a 100%)";

  // Richer image area with strong ambient glow
  const imgBg = [
    `radial-gradient(ellipse at 50% 30%, rgba(${accentRgb},0.22) 0%, transparent 60%)`,
    `radial-gradient(ellipse at 50% 95%, rgba(${accentRgb},0.07) 0%, transparent 50%)`,
    isPremium ? "linear-gradient(180deg, #1a1030 0%, #120d20 100%)" : "#130f1e",
  ].join(",");

  return (
    <article
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        position: "relative", display: "flex", flexDirection: "column",
        overflow: "hidden", borderRadius: 20,
        background: cardBg,
        contain: "layout style",
        willChange: "transform",
        border: hov
          ? `1px solid rgba(${accentRgb},0.42)`
          : isPremium
          ? `1px solid rgba(${accentRgb},0.20)`
          : "1px solid rgba(168,85,247,0.10)",
        boxShadow: hov
          ? `0 20px 50px rgba(0,0,0,0.60), 0 0 55px rgba(${accentRgb},0.12), inset 0 1px 0 rgba(${accentRgb},0.09)`
          : isExpensive
          ? `0 6px 24px rgba(0,0,0,0.45), 0 0 22px rgba(${accentRgb},0.07)`
          : "0 4px 16px rgba(0,0,0,0.40)",
        transform: hov ? "translateY(-6px) scale(1.012)" : "translateY(0) scale(1)",
        transition: "transform 0.25s cubic-bezier(0.4,0,0.2,1), box-shadow 0.25s ease, border-color 0.25s ease",
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

      {/* Top accent line — pulsing on premium */}
      <div style={{
        height: 2, flexShrink: 0,
        background: `linear-gradient(90deg, transparent, rgba(${accentRgb},0.85) 50%, transparent)`,
        opacity: hov ? 1 : isPremium ? 0.6 : 0.25,
        transition: "opacity 0.3s",
        animation: isPremium ? "accentPulse 3s ease-in-out infinite" : "none",
      }} />

      {/* Type label */}
      {itemType && (
        <div style={{ padding: "12px 14px 0", position: "relative", zIndex: 1 }}>
          <span style={{
            fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.16em",
            color: `rgba(${accentRgb},0.65)`,
          }}>
            {itemType}
          </span>
        </div>
      )}

      {/* Image area */}
      <div style={{ position: "relative", margin: "8px 12px 0", zIndex: 1 }}>
        <div style={{
          position: "relative", height: imgHeight, borderRadius: 14, overflow: "hidden",
          display: "flex", alignItems: "center", justifyContent: "center",
          background: imgBg,
        }}>
          {/* Floor glow beneath the skin */}
          <div style={{
            position: "absolute", bottom: 0, left: "10%", right: "10%", height: "42%",
            background: `radial-gradient(ellipse at 50% 100%, rgba(${accentRgb},0.28) 0%, transparent 70%)`,
            pointerEvents: "none",
          }} />

          {/* Empire logo */}
          <div style={{
            position: "absolute", top: 8, right: 8, zIndex: 10,
            width: 26, height: 26, borderRadius: 8,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(8,6,18,0.90)", border: "1px solid rgba(251,191,36,0.18)",
            backdropFilter: "blur(4px)",
          }}>
            <EmpireLogo />
          </div>

          {/* Discount badge */}
          {discount >= 1 && (
            <div style={{ position: "absolute", top: 8, left: 8, zIndex: 10 }}>
              <DiscountBadge pct={discount} />
            </div>
          )}

          {/* Skin image */}
          {image ? (
            <img src={image} alt={fullName}
              style={{
                height: isSticker ? `${imgScale}px` : imgScale,
                width: isSticker ? `${imgScale}px` : "100%",
                objectFit: "contain",
                transform: hov ? "scale(1.09) translateY(-3px)" : "scale(1)",
                transition: "transform 0.4s cubic-bezier(0.4,0,0.2,1)",
              }}
              loading="lazy" decoding="async"
            />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, color: "rgba(255,255,255,0.12)" }}>
              <svg width={40} height={40} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span style={{ fontSize: 11 }}>No image</span>
            </div>
          )}

          {!isSticker && <StickerStrip stickers={stickers} />}
        </div>
      </div>

      {/* Skin name */}
      <div style={{ padding: "12px 14px 0", position: "relative", zIndex: 1 }}>
        <p style={{
          fontSize: 14, fontWeight: 700, color: "rgba(255,255,255,0.92)",
          lineHeight: 1.4, letterSpacing: "-0.01em",
          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}>
          {baseName}
        </p>
      </div>

      {/* Deal Score */}
      {item?.dealScore && (
        <div style={{ padding: "6px 14px 0", position: "relative", zIndex: 1 }}>
          <DealScoreBadge
            dealScore={item.dealScore}
            open={breakdownOpen}
            onToggle={() => setBreakdownOpen(o => !o)}
          />
          {breakdownOpen && (
            <div style={{ marginTop: 6 }}>
              <DealScoreBreakdown dealScore={item.dealScore} />
            </div>
          )}
        </div>
      )}

      {/* Float bar */}
      {hasFloat && (
        <div style={{ padding: "10px 14px 0", position: "relative", zIndex: 1 }}>
          <FloatBar floatValue={floatValue} accentRgb={accentRgb} />
        </div>
      )}

      {/* Wear chip (no float) */}
      {!hasFloat && wear && (
        <div style={{ padding: "8px 14px 0", position: "relative", zIndex: 1 }}>
          <span style={{
            display: "inline-flex", alignItems: "center",
            height: 22, padding: "0 10px", borderRadius: 11,
            fontSize: 11, fontWeight: 600,
            background: `rgba(${accentRgb},0.09)`,
            border: `1px solid rgba(${accentRgb},0.22)`,
            color: `rgba(${accentRgb},0.88)`,
          }}>
            {wear}
          </span>
        </div>
      )}

      {/* Price */}
      <div style={{ padding: "10px 14px 0", position: "relative", zIndex: 1 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
          <span style={{
            fontSize: 25, fontWeight: 900, lineHeight: 1, fontVariantNumeric: "tabular-nums",
            color: "#fbbf24",
            textShadow: hov ? "0 0 24px rgba(251,191,36,0.45)" : "0 0 10px rgba(251,191,36,0.18)",
            transition: "text-shadow 0.3s",
          }}>
            {formatCoins(priceCoins)}
          </span>
          <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(251,191,36,0.40)" }}>coins</span>
        </div>

        {savedCoins > 0 && suggested > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>
              from <span style={{ textDecoration: "line-through", color: "rgba(255,255,255,0.18)" }}>
                {formatCoins(suggested)}
              </span>
            </span>
            <span style={{
              fontSize: 11, fontWeight: 800, color: "#4ade80",
              background: "rgba(34,197,94,0.10)", borderRadius: 6, padding: "1px 6px",
              border: "1px solid rgba(34,197,94,0.22)",
            }}>
              save {formatCoins(savedCoins)}
            </span>
          </div>
        )}
      </div>

      {/* Actions */}
      <div style={{ marginTop: "auto", padding: "12px 12px 12px", display: "flex", flexDirection: "column", gap: 8, position: "relative", zIndex: 1 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <a href={empireUrl} target="_blank" rel="noreferrer"
            style={{
              flex: 1, display: "block", textAlign: "center",
              padding: "11px 0", borderRadius: 14,
              fontSize: 13, fontWeight: 900, color: "#000", textDecoration: "none",
              background: "linear-gradient(135deg,#fbbf24 0%,#f59e0b 100%)",
              boxShadow: hov
                ? "0 8px 26px rgba(251,191,36,0.38), 0 0 0 1px rgba(251,191,36,0.22)"
                : "0 2px 10px rgba(251,191,36,0.16)",
              transition: "box-shadow 0.2s",
            }}>
            Buy on Empire
          </a>
          <button
            type="button"
            title="Share to chat"
            onClick={() => onShare?.(item)}
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

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <button
            onClick={() => onSeeMore?.(item)}
            style={{
              padding: "9px 0", borderRadius: 12,
              fontSize: 12, fontWeight: 700, cursor: "pointer",
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.09)",
              color: "rgba(255,255,255,0.55)",
              transition: "background 0.15s, color 0.15s, border-color 0.15s",
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = "rgba(255,255,255,0.10)";
              e.currentTarget.style.color = "#fff";
              e.currentTarget.style.borderColor = "rgba(255,255,255,0.16)";
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = "rgba(255,255,255,0.05)";
              e.currentTarget.style.color = "rgba(255,255,255,0.55)";
              e.currentTarget.style.borderColor = "rgba(255,255,255,0.09)";
            }}
          >
            Details
          </button>

          <a href={analystUrl} target="_blank" rel="noreferrer"
            style={{
              display: "block", textAlign: "center",
              padding: "9px 0", borderRadius: 12,
              fontSize: 12, fontWeight: 700, textDecoration: "none",
              background: `rgba(${accentRgb},0.07)`,
              border: `1px solid rgba(${accentRgb},0.16)`,
              color: `rgba(${accentRgb},0.72)`,
              transition: "background 0.15s, color 0.15s",
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = `rgba(${accentRgb},0.16)`;
              e.currentTarget.style.color = `rgb(${accentRgb})`;
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = `rgba(${accentRgb},0.07)`;
              e.currentTarget.style.color = `rgba(${accentRgb},0.72)`;
            }}
          >
            Analyst ↗
          </a>
        </div>
      </div>
    </article>
  );
});

export default ItemCard;
