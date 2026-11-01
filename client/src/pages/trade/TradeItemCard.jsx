import { useState } from "react";
import anyKnifeImg  from "../../assets/any_knife.png";
import anyKeyImg    from "../../assets/any_key.png";
import anyCaseImg   from "../../assets/any_case.png";
import anyOffersImg from "../../assets/any_offers.png";
import realMoneyImg from "../../assets/real_money.png";

const WEAR_SHORTS = {
  "Factory New":    { short: "FN", color: "#00c853", glow: "#00ff88" },
  "Minimal Wear":   { short: "MW", color: "#0097a7", glow: "#00e5ff" },
  "Field-Tested":   { short: "FT", color: "#e65100", glow: "#ff8c00" },
  "Well-Worn":      { short: "WW", color: "#b71c1c", glow: "#ff6060" },
  "Battle-Scarred": { short: "BS", color: "#6d0000", glow: "#ff2020" },
};

function wearBadge(exterior) {
  return exterior ? (WEAR_SHORTS[exterior] || { short: exterior.substring(0, 2).toUpperCase(), color: "#4b6580", glow: "#94a3b8" }) : null;
}

function itemIsStatTrak(item) {
  const n = item?.marketHashName || item?.name || "";
  return /^StatTrak™/i.test(n.trim());
}

export const RARITY_COLORS = {
  "Consumer Grade":   "#b0c3d9",
  "Industrial Grade": "#5e98d9",
  "Mil-Spec Grade":   "#4b69ff",
  "Restricted":       "#8847ff",
  "Classified":       "#d32ce6",
  "Covert":           "#eb4b4b",
  "Contraband":       "#e4ae33",
  "Base Grade":       "#b0c3d9",
};

const SPECIAL_IMAGES = {
  "Any Knife":  anyKnifeImg,
  "Any Key":    anyKeyImg,
  "Any Case":   anyCaseImg,
  "Any Offers": anyOffersImg,
  "Real Money": realMoneyImg,
};

export function resolveItemIcon(item) {
  if (!item) return "";
  if (item.isSpecial) return SPECIAL_IMAGES[item.marketHashName || item.name] || item.iconUrl || "";
  return item.iconUrl || item.icon_url || "";
}

export function rarityColor(rarity) {
  if (!rarity) return "#cbd5e1";
  return rarity.color || RARITY_COLORS[rarity.name] || "#cbd5e1";
}

/* ─── Static rarity lookup ─────────────────────────────
   Used when item.rarity is null (market-live items, old
   lookingForItems stored before rarity capture was added).
   Base names only — wear/StatTrak stripped before lookup. */
const SKIN_RARITY_LOOKUP = {
  // Contraband
  "m4a4 | howl":                 "#e4ae33",

  // Covert
  "awp | dragon lore":           "#eb4b4b",
  "awp | medusa":                "#eb4b4b",
  "awp | gungnir":               "#eb4b4b",
  "awp | asiimov":               "#eb4b4b",
  "awp | fade":                  "#eb4b4b",
  "awp | lightning strike":      "#eb4b4b",
  "awp | wildfire":              "#eb4b4b",
  "ak-47 | wild lotus":          "#eb4b4b",
  "ak-47 | fire serpent":        "#eb4b4b",
  "ak-47 | gold arabesque":      "#eb4b4b",
  "m4a4 | neo-noir":             "#eb4b4b",
  "m4a4 | desolate space":       "#eb4b4b",
  "m4a4 | buzz kill":            "#eb4b4b",
  "m4a1-s | printstream":        "#eb4b4b",
  "m4a1-s | mecha industries":   "#eb4b4b",
  "m4a1-s | imminent danger":    "#eb4b4b",
  "usp-s | printstream":         "#eb4b4b",
  "usp-s | neo-noir":            "#eb4b4b",
  "desert eagle | printstream":  "#eb4b4b",
  "glock-18 | twilight galaxy":  "#eb4b4b",
  "mp9 | wild lily":             "#eb4b4b",
  "mp5-sd | phosphor":           "#eb4b4b",

  // Classified
  "ak-47 | redline":             "#d32ce6",
  "ak-47 | the empress":         "#d32ce6",
  "ak-47 | slate":               "#d32ce6",
  "ak-47 | neon rider":          "#d32ce6",
  "ak-47 | head shot":           "#d32ce6",
  "ak-47 | asiimov":             "#d32ce6",
  "ak-47 | bloodsport":          "#d32ce6",
  "awp | redline":               "#d32ce6",
  "awp | neo-noir":              "#d32ce6",
  "awp | sun in leo":            "#d32ce6",
  "awp | the prince":            "#d32ce6",
  "m4a1-s | hot rod":            "#d32ce6",
  "m4a1-s | knight":             "#d32ce6",
  "m4a1-s | nightmare":          "#d32ce6",
  "m4a1-s | control panel":      "#d32ce6",
  "m4a1-s | player two":         "#d32ce6",
  "m4a1-s | hyper beast":        "#d32ce6",
  "m4a4 | asiimov":              "#d32ce6",
  "m4a4 | poseidon":             "#d32ce6",
  "usp-s | kill confirmed":      "#d32ce6",
  "usp-s | cortex":              "#d32ce6",
  "usp-s | orion":               "#d32ce6",
  "glock-18 | fade":             "#d32ce6",
  "glock-18 | gamma doppler":    "#d32ce6",
  "glock-18 | neo-noir":         "#d32ce6",
  "desert eagle | golden koi":   "#d32ce6",
  "desert eagle | code red":     "#d32ce6",
  "five-seven | hyper beast":    "#d32ce6",
  "five-seven | neon kimono":    "#d32ce6",
  "sg 553 | cyrex":              "#d32ce6",
  "sg 553 | hyper beast":        "#d32ce6",
  "aug | akihabara accept":      "#d32ce6",
  "aug | midnight lily":         "#d32ce6",

  // Restricted
  "ak-47 | aquamarine revenge":  "#8847ff",
  "ak-47 | fuel injector":       "#8847ff",
  "ak-47 | vulcan":              "#8847ff",
  "ak-47 | frontside misty":     "#8847ff",
  "m4a1-s | cyrex":              "#8847ff",
  "m4a1-s | atomic alloy":       "#8847ff",
  "m4a1-s | welcome to the jungle": "#8847ff",
  "desert eagle | blaze":        "#8847ff",
  "desert eagle | conspiracy":   "#8847ff",
  "desert eagle | hypnotic":     "#8847ff",
  "usp-s | caiman":              "#8847ff",
  "usp-s | serum":               "#8847ff",
  "glock-18 | water elemental":  "#8847ff",
  "p250 | asiimov":              "#8847ff",

  // Mil-Spec Grade
  "ak-47 | jaguar":              "#4b69ff",
  "ak-47 | safari mesh":         "#4b69ff",
  "m4a4 | x-ray":                "#4b69ff",
  "usp-s | whiteout":            "#4b69ff",
  "glock-18 | wraiths":          "#4b69ff",
};

/* Normalize a market hash name to base form for lookup:
   strip StatTrak™ prefix and (Wear) suffix, lowercase */
function toBaseName(mhn) {
  return String(mhn || "")
    .replace(/^StatTrak™\s*/i, "")
    .replace(/\s*\((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)\s*$/i, "")
    .trim()
    .toLowerCase();
}

/* Single shared helper — same result for the same item regardless of context.
   Priority: stored rarity → name patterns (knife/gloves) → lookup table → neutral */
export function getRarityColor(item) {
  // 1. Stored rarity (inventory items always have this; new posts after the fix too)
  if (item?.rarity) {
    const c = rarityColor(item.rarity);
    if (c !== "#cbd5e1") return c;
  }

  const base = toBaseName(item?.marketHashName || item?.name || "");

  // 2. Reliable name patterns
  if (/[★✦]|\bknife\b|karambit|bayonet|butterfly|shadow daggers|bowie|huntsman|falchion|ursus|navaja|stiletto|talon|paracord|survival|nomad|skeleton|kukri/.test(base)) {
    return "#eb4b4b"; // Covert
  }
  if (/\bgloves\b|hand wraps/.test(base)) {
    return "#d2701b"; // Extraordinary
  }

  // 3. Static lookup for popular skins (covers items stored without rarity)
  if (SKIN_RARITY_LOOKUP[base]) return SKIN_RARITY_LOOKUP[base];

  // 4. Neutral fallback — clearly "unknown", not a wrong rarity color
  return "#6b7fa3";
}

/* ─── Feed thumbnail — dark premium card ──────────── */
export function TradeItemThumb({ item, size = 94, fluid = false }) {
  const [imgFailed, setImgFailed] = useState(false);
  const [hov, setHov] = useState(false);
  const color  = getRarityColor(item);
  const src    = resolveItemIcon(item);
  const name   = item?.name || item?.marketHashName || "";
  const strak  = itemIsStatTrak(item);
  const badge  = wearBadge(item?.exterior);

  /* ── Fluid (Steam inventory) mode ────────────────── */
  if (fluid) {
    return (
      <div
        title={name}
        onMouseEnter={() => setHov(true)}
        onMouseLeave={() => setHov(false)}
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "4 / 5",
          borderRadius: 10,
          background: hov ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.035)",
          border: `1px solid ${hov ? color + "60" : "rgba(255,255,255,0.07)"}`,
          boxShadow: hov
            ? `0 10px 28px rgba(0,0,0,0.60), 0 0 20px ${color}28, inset 0 1px 0 rgba(255,255,255,0.06)`
            : `0 2px 8px rgba(0,0,0,0.40), inset 0 1px 0 rgba(255,255,255,0.03)`,
          overflow: "hidden",
          transform: hov ? "translateY(-3px) scale(1.03)" : "none",
          transition: "transform 0.18s ease, box-shadow 0.20s ease, border-color 0.18s ease, background 0.18s ease",
          cursor: "default",
        }}
      >
        {/* Rarity glow bar */}
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, height: 3, zIndex: 4,
          background: `linear-gradient(90deg, transparent 5%, ${color} 30%, ${color} 70%, transparent 95%)`,
          boxShadow: `0 0 14px ${color}cc, 0 2px 8px ${color}55`,
        }} />

        {/* Image area */}
        <div style={{
          position: "absolute", top: "6%", left: "6%", right: "6%", bottom: "32%",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          {src && !imgFailed
            ? <img src={src} alt={name} style={{ width: "100%", height: "100%", objectFit: "contain", filter: hov ? `drop-shadow(0 0 8px ${color}66)` : "none", transition: "filter 0.2s" }} onError={() => setImgFailed(true)} />
            : <span style={{ fontSize: "1.6em", opacity: 0.10 }}>🔫</span>
          }
          {strak && (
            <span style={{
              position: "absolute", top: 0, left: 0,
              fontSize: 7, fontWeight: 900, color: "#fff",
              background: "linear-gradient(135deg,#ea580c,#f97316)",
              borderRadius: "0 0 5px 0", padding: "2px 5px", lineHeight: 1.3,
              boxShadow: "0 0 8px rgba(249,115,22,0.6)",
            }}>ST</span>
          )}
          {item?.quantity > 1 && (
            <span style={{
              position: "absolute", bottom: 0, right: 0,
              fontSize: 8, fontWeight: 800, color: "#fff",
              background: "rgba(0,0,0,0.70)", borderRadius: "4px 0 0 0", padding: "2px 5px",
            }}>×{item.quantity}</span>
          )}
        </div>

        {/* Bottom gradient overlay — name + wear */}
        <div style={{
          position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 3,
          background: "linear-gradient(to top, rgba(5,4,14,0.96) 0%, rgba(5,4,14,0.80) 50%, transparent 100%)",
          padding: "22px 7px 7px",
        }}>
          <div style={{
            fontSize: 8.5, fontWeight: 600, color: "rgba(255,255,255,0.88)",
            lineHeight: 1.2,
            display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
            marginBottom: badge ? 4 : 0,
          }}>
            {name}
          </div>
          {badge && (
            <span style={{
              display: "inline-block",
              fontSize: 7.5, fontWeight: 900, color: "#fff",
              background: badge.color,
              borderRadius: 3, padding: "1px 5px",
              letterSpacing: "0.07em",
              boxShadow: `0 0 10px ${badge.glow}bb, 0 0 4px ${badge.glow}66`,
              textShadow: `0 0 6px ${badge.glow}`,
            }}>{badge.short}</span>
          )}
        </div>
      </div>
    );
  }

  /* ── Fixed-size mode (detail pages, notifications, etc.) ── */
  return (
    <div
      title={name}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        width: size,
        borderRadius: 10,
        background: hov ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.05)",
        border: `1px solid ${hov ? color + "60" : "rgba(255,255,255,0.09)"}`,
        boxShadow: hov
          ? `0 6px 18px rgba(0,0,0,0.50), 0 0 0 1px ${color}30`
          : "0 1px 4px rgba(0,0,0,0.30)",
        display: "flex", flexDirection: "column",
        overflow: "hidden", flexShrink: 0,
        transform: hov ? "translateY(-2px)" : "none",
        transition: "transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease, background 0.18s ease",
      }}
    >
      {/* Rarity top accent */}
      <div style={{
        height: 3, flexShrink: 0,
        background: `linear-gradient(90deg, transparent, ${color} 40%, ${color} 60%, transparent)`,
        boxShadow: `0 0 8px ${color}99`,
      }} />

      {/* Image area */}
      <div style={{
        height: Math.round(size * 0.74),
        background: "rgba(255,255,255,0.03)",
        display: "flex", alignItems: "center", justifyContent: "center",
        position: "relative",
        flexShrink: 0,
      }}>
        {src && !imgFailed
          ? <img src={src} alt={name} style={{ width: "84%", height: "84%", objectFit: "contain" }} onError={() => setImgFailed(true)} />
          : <span style={{ fontSize: Math.round(size * 0.30), opacity: 0.55 }}>🔫</span>
        }
        {item?.quantity > 1 && (
          <span style={{
            position: "absolute", bottom: 3, right: 3,
            fontSize: 8, fontWeight: 800, color: "#fff",
            background: "rgba(0,0,0,0.65)", borderRadius: 3, padding: "1px 4px",
          }}>×{item.quantity}</span>
        )}
        {strak && (
          <span style={{
            position: "absolute", top: 3, left: 3,
            fontSize: 7, fontWeight: 900, color: "#fff",
            background: "#f97316", borderRadius: 3, padding: "1px 4px", lineHeight: 1.4,
          }}>ST</span>
        )}
      </div>

      {/* Price + name + wear badge */}
      <div style={{ padding: "4px 6px 7px" }}>
        {item?.price > 0 && (
          <div className="tit-price" style={{
            fontSize: 10.5, fontWeight: 700, color: "#86efac", lineHeight: 1.2, marginBottom: 2,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            ${Number(item.price).toFixed(2)}
          </div>
        )}
        <div className="tit-name" style={{
          fontSize: 10.5, fontWeight: 600, color: "rgba(255,255,255,0.82)", lineHeight: 1.25,
          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
        }}>
          {name}
        </div>
        {badge && (
          <div style={{ marginTop: 2 }}>
            <span style={{
              fontSize: 7, fontWeight: 900, color: "#fff",
              background: badge.color, borderRadius: 3,
              padding: "1px 4px", letterSpacing: "0.06em",
              boxShadow: `0 0 8px ${badge.glow}99`,
              display: "inline-block",
            }}>{badge.short}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Full selectable card — modal ───────────────────── */
export default function TradeItemCard({ item, onRemove, selected }) {
  const [imgFailed, setImgFailed] = useState(false);
  const [hov, setHov] = useState(false);
  const color = getRarityColor(item);
  const src   = resolveItemIcon(item);
  const name  = item?.name || item?.marketHashName || "Unknown";
  const strak = itemIsStatTrak(item);
  const badge = wearBadge(item?.exterior);

  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        position: "relative",
        width: 90,
        borderRadius: 11,
        background: selected ? "#eef2ff" : "#ffffff",
        border: selected
          ? "2px solid #6366f1"
          : `1px solid ${hov ? "rgba(0,0,0,0.12)" : "rgba(0,0,0,0.07)"}`,
        boxShadow: selected
          ? "0 2px 10px rgba(99,102,241,0.2)"
          : hov ? "0 4px 12px rgba(0,0,0,0.09)" : "0 1px 4px rgba(0,0,0,0.05)",
        display: "flex", flexDirection: "column",
        overflow: "hidden", flexShrink: 0,
        transform: hov && !onRemove ? "translateY(-2px)" : "none",
        transition: "transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease",
        cursor: onRemove ? "default" : "pointer",
      }}
    >
      {/* Remove × */}
      {onRemove && (
        <button
          onClick={e => { e.stopPropagation(); onRemove(); }}
          style={{
            position: "absolute", top: 4, right: 4, zIndex: 10,
            width: 18, height: 18, borderRadius: 5,
            border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.08)",
            color: "#ef4444", fontSize: 12, lineHeight: 1,
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: "inherit",
          }}
        >×</button>
      )}

      {/* Rarity top accent */}
      <div style={{ height: 2, background: `linear-gradient(90deg, transparent, ${selected ? "#6366f1" : color} 50%, transparent)`, flexShrink: 0 }} />

      {/* Image area */}
      <div style={{
        height: 72,
        background: selected ? "#e8eaf6" : "#f8fafc",
        display: "flex", alignItems: "center", justifyContent: "center",
        position: "relative",
      }}>
        {src && !imgFailed
          ? <img src={src} alt={name} style={{ width: "82%", height: "82%", objectFit: "contain" }} onError={() => setImgFailed(true)} />
          : <span style={{ fontSize: 22, opacity: 0.15 }}>🔫</span>
        }
        {item?.quantity > 1 && (
          <span style={{
            position: "absolute", bottom: 3, right: 4,
            fontSize: 8, fontWeight: 800, color: "#fff",
            background: "rgba(15,23,42,0.55)", borderRadius: 4, padding: "1px 4px",
          }}>×{item.quantity}</span>
        )}
        {/* StatTrak badge */}
        {strak && (
          <span style={{
            position: "absolute", top: 4, left: 4,
            fontSize: 7, fontWeight: 800, color: "#fff",
            background: "#f97316", borderRadius: 3, padding: "1px 4px", lineHeight: 1.4,
          }}>ST</span>
        )}
      </div>

      {/* Name + wear badge + rarity */}
      <div style={{ padding: "5px 6px 7px" }}>
        <div style={{
          fontSize: 9.5, fontWeight: 600, color: selected ? "#4338ca" : "#0f172a", lineHeight: 1.3,
          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
        }}>
          {name}
        </div>
        {badge && (
          <div style={{ marginTop: 3 }}>
            <span style={{
              fontSize: 7.5, fontWeight: 800, color: "#fff",
              background: badge.color, borderRadius: 3,
              padding: "1px 5px", letterSpacing: "0.02em",
            }}>{badge.short}</span>
          </div>
        )}
        {item?.rarity?.name && (
          <div style={{ display: "flex", alignItems: "center", gap: 3, marginTop: 3 }}>
            <div style={{ width: 4, height: 4, borderRadius: "50%", background: color, flexShrink: 0 }} />
            <span style={{
              fontSize: 7.5, color: color, fontWeight: 700,
              letterSpacing: "0.03em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {item.rarity.name}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
