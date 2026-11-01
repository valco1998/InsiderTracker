import { useMemo } from "react";
import useWatchlist from "../../../hooks/useWatchlist.js";
import AddWatchForm from "../../components/watch/AddWatchForm.jsx";
import WatchRuleCard from "../../components/watch/WatchRuleCard.jsx";
import watchlistAvatar from "../../../assets/avatarTellWatchlist.png";

/* ─── Keyframes ────────────────────────────────────── */

const WS_STYLES = `
  @keyframes wsStarTwinkle {
    0%, 100% { opacity: 0.4; transform: scale(1);   }
    50%       { opacity: 1;   transform: scale(1.4); }
  }
  @keyframes wsParticleDrift {
    0%   { transform: translate(0px,  0px) scale(1);      opacity: 0.5;  }
    33%  { transform: translate(5px, -13px) scale(1.12);  opacity: 0.85; }
    66%  { transform: translate(-4px,-21px) scale(0.92);  opacity: 0.62; }
    100% { transform: translate(0px,  0px) scale(1);      opacity: 0.5;  }
  }
  @keyframes wsStreakFlash {
    0%   { opacity: 0;    }
    15%  { opacity: 1;    }
    80%  { opacity: 0.65; }
    100% { opacity: 0;    }
  }
  @keyframes wsNebulaBreath {
    0%, 100% { opacity: 1;    }
    50%       { opacity: 0.68; }
  }
  @keyframes wsCharFloat {
    0%, 100% { transform: translateY(0px);  }
    50%       { transform: translateY(-8px); }
  }
  @keyframes wsHoloFloat {
    0%, 100% { transform: translateY(0px);  }
    50%       { transform: translateY(-7px); }
  }
  @keyframes wsScanRing {
    0%   { transform: translate(-50%,-50%) scale(0.1); opacity: 0.7; }
    100% { transform: translate(-50%,-50%) scale(1);   opacity: 0;   }
  }
  @keyframes wsRadarSweep {
    from { transform: translate(-50%,-50%) rotate(0deg);   }
    to   { transform: translate(-50%,-50%) rotate(360deg); }
  }
  @keyframes wsHorizonGlow {
    0%, 100% { opacity: 0.8; }
    50%       { opacity: 1;   }
  }
  @keyframes wsLiveDot {
    0%, 100% { opacity: 1; box-shadow: 0 0 4px #22d3ee; }
    50%       { opacity: 0.35; box-shadow: 0 0 8px #22d3ee; }
  }
  @media (max-width: 767px) {
    .ws-content { max-width: 100% !important; min-height: 0 !important; padding: 24px 20px 32px !important; background: rgba(6,7,14,0.88) !important; position: relative !important; z-index: 10 !important; }
    .ws-veil { width: 100% !important; }
    .ws-char { display: none !important; }
    .ws-holo-zone { display: none !important; }
  }
`;

/* ─── Scene data ────────────────────────────────────── */

const WS_STARS = Array.from({ length: 40 }, (_, i) => {
  const a = (i * 137.508) % 360;
  const r = Math.sqrt((i + 1) / 40);
  return {
    x:     Math.max(1, Math.min(99, 50 + r * 54 * Math.cos(a * Math.PI / 180))),
    y:     Math.max(1, Math.min(99, 50 + r * 52 * Math.sin(a * Math.PI / 180))),
    size:  [1, 1, 1.5, 2][i % 4],
    dur:   2.2 + (i * 0.38) % 3.5,
    delay: (i * 0.65) % 5,
    color: i % 8 === 0 ? "#c4b5fd" : i % 6 === 0 ? "#a5f3fc" : "#fff",
  };
});

const WS_NEBULAS = [
  { x: 78, y: 12, w: 560, h: 380, blur: 74, color: "rgba(109,40,217,0.48)",  rot: -12 },
  { x: 55, y: 58, w: 480, h: 360, blur: 68, color: "rgba(88,28,135,0.38)",   rot: -16 },
  { x: 94, y: 72, w: 340, h: 280, blur: 58, color: "rgba(124,58,237,0.3)",   rot:  14 },
  { x: 18, y: 35, w: 360, h: 270, blur: 62, color: "rgba(67,56,202,0.32)",   rot:   8 },
  { x: 40, y: 85, w: 280, h: 210, blur: 52, color: "rgba(192,38,211,0.2)",   rot:  -6 },
];

const WS_STREAKS = [
  { x: 58, y: 8,  w: 240, angle: -38, delay: 0,   dur: 4.8, ca: "rgba(139,92,246,0.55)", cb: "rgba(34,211,238,0.2)"  },
  { x: 76, y: 32, w: 170, angle: -30, delay: 2.3, dur: 5.5, ca: "rgba(168,85,247,0.45)", cb: "transparent"           },
  { x: 86, y: 60, w: 155, angle: -42, delay: 4.6, dur: 4.2, ca: "rgba(34,211,238,0.38)", cb: "rgba(139,92,246,0.18)" },
];

const WS_PARTICLES = [
  { x: 10, y: 28, size: 2,   color: "#a855f7", delay: 0,   dur: 3.8 },
  { x: 25, y: 74, size: 1.5, color: "#22d3ee", delay: 1.2, dur: 4.5 },
  { x: 42, y: 16, size: 2,   color: "#e879f9", delay: 0.6, dur: 3.2 },
  { x: 60, y: 84, size: 1.5, color: "#a855f7", delay: 2.4, dur: 4.8 },
  { x: 80, y: 22, size: 2,   color: "#22d3ee", delay: 1.8, dur: 3.6 },
  { x: 18, y: 90, size: 1,   color: "#c084fc", delay: 3.2, dur: 5.1 },
  { x: 68, y: 58, size: 1.5, color: "#a855f7", delay: 0.4, dur: 3.9 },
  { x: 93, y: 68, size: 2,   color: "#e879f9", delay: 4.1, dur: 4.3 },
];

// Four radar rings — stagger by 0.75s each
const WS_SCAN_RINGS = [0, 0.75, 1.5, 2.25];

// Hologram deal cards — float in the character zone (right side)
const WS_HOLO_CARDS = [
  { name: "Karambit | Doppler",  price: "2,480c", disc: "-22%", wear: "FN", top: "10%", right: "42%", rot: "-6deg",  delay: "0s",   dur: "4.5s" },
  { name: "AK-47 | Hydroponic",  price: "342c",   disc: "-18%", wear: "FT", top: "47%", right: "44%", rot:  "5deg",  delay: "1.5s", dur: "5.2s" },
  { name: "AWP | Asiimov",       price: "920c",   disc: "-15%", wear: "FT", top: "73%", right: "41%", rot: "-4deg",  delay: "0.8s", dur: "4.8s" },
];

/* ─── SkeletonCard ─────────────────────────────────── */

function SkeletonCard() {
  return (
    <div style={{
      borderRadius: 16, overflow: "hidden",
      background: "linear-gradient(135deg, rgba(31,42,60,0.9), rgba(26,35,53,0.9))",
      border: "1px solid rgba(255,255,255,0.07)",
      height: 180,
    }}>
      <div style={{ height: 2, background: "rgba(34,211,238,0.2)" }} />
      <div style={{ padding: "14px 16px" }}>
        <div style={{ display: "flex", gap: 14 }}>
          <div className="skeleton" style={{ width: 80, height: 60, borderRadius: 10, flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div className="skeleton" style={{ height: 14, width: "70%", borderRadius: 6, marginBottom: 8 }} />
            <div className="skeleton" style={{ height: 11, width: "45%", borderRadius: 5 }} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 14 }}>
          <div className="skeleton" style={{ height: 22, width: 90, borderRadius: 6 }} />
          <div className="skeleton" style={{ height: 22, width: 72, borderRadius: 6 }} />
        </div>
      </div>
    </div>
  );
}

/* ─── WatchlistScene — cinematic wrapper ────────────── */
/*
  Always rendered. Left 57% = content column.
  Right 43% = character + atmosphere (background only).
  Rule cards, skeletons, and empty-state text live in the
  content column at z:10 — the galaxy scene is behind them.
*/

function WatchlistScene({ rules, loading, onDelete }) {
  const isEmpty = !loading && rules.length === 0;

  return (
    <div style={{
      position: "relative",
      overflow: "hidden",
      borderRadius: 20,
      minHeight: 540,
      border: "1px solid rgba(109,40,217,0.2)",
      boxShadow: "0 0 0 1px rgba(109,40,217,0.06) inset",
    }}>
      <style>{WS_STYLES}</style>

      {/* ══ BACKGROUND ══════════════════════════════════ */}

      {/* Space gradient */}
      <div style={{
        position: "absolute", inset: 0,
        background: "linear-gradient(160deg, #06070e 0%, #08091c 22%, #0a0d20 50%, #0e1225 75%, #141a24 100%)",
        zIndex: 0,
      }} />

      {/* Galactic core */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        background: [
          "radial-gradient(ellipse 70% 55% at 76% 32%, rgba(88,28,135,0.26) 0%, transparent 68%)",
          "radial-gradient(ellipse 48% 38% at 20% 65%, rgba(29,78,216,0.16) 0%, transparent 65%)",
        ].join(", "),
        zIndex: 0,
      }} />

      {/* Nebula clouds */}
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", zIndex: 1 }}>
        {WS_NEBULAS.map((n, i) => (
          <div key={i} style={{
            position: "absolute",
            left: `${n.x}%`, top: `${n.y}%`,
            width: n.w, height: n.h,
            transform: `translate(-50%,-50%) rotate(${n.rot}deg)`,
            background: `radial-gradient(ellipse at center, ${n.color} 0%, transparent 70%)`,
            filter: `blur(${n.blur}px)`,
            animation: `wsNebulaBreath ${10 + i * 2}s ease-in-out ${i * 1.8}s infinite`,
          }} />
        ))}
      </div>

      {/* Stars */}
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", zIndex: 2 }}>
        {WS_STARS.map((s, i) => (
          <div key={i} style={{
            position: "absolute",
            left: `${s.x}%`, top: `${s.y}%`,
            width: s.size, height: s.size,
            borderRadius: "50%",
            background: s.color,
            boxShadow: `0 0 ${s.size * 2}px ${s.color}`,
            animation: `wsStarTwinkle ${s.dur}s ease-in-out ${s.delay}s infinite`,
          }} />
        ))}
      </div>

      {/* Streaks */}
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", zIndex: 3 }}>
        {WS_STREAKS.map((s, i) => (
          <div key={i} style={{
            position: "absolute",
            left: `${s.x}%`, top: `${s.y}%`,
            width: s.w, height: 1,
            background: `linear-gradient(to right, transparent 0%, ${s.ca} 30%, ${s.cb} 70%, transparent 100%)`,
            transform: `rotate(${s.angle}deg)`,
            transformOrigin: "left center",
            filter: "blur(0.4px)",
            animation: `wsStreakFlash ${s.dur}s ease-in-out ${s.delay}s infinite`,
          }} />
        ))}
      </div>

      {/* Particles */}
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", zIndex: 4 }}>
        {WS_PARTICLES.map((p, i) => (
          <div key={i} style={{
            position: "absolute",
            left: `${p.x}%`, top: `${p.y}%`,
            width: p.size, height: p.size,
            borderRadius: "50%",
            background: p.color,
            boxShadow: `0 0 ${p.size * 4}px ${p.color}bb`,
            animation: `wsParticleDrift ${p.dur}s ease-in-out ${p.delay}s infinite`,
          }} />
        ))}
      </div>

      {/* ══ RADAR — positioned in character zone ════════ */}

      {WS_SCAN_RINGS.map((delay, i) => (
        <div key={i} style={{
          position: "absolute",
          left: "74%", top: "62%",
          width: 280, height: 280,
          borderRadius: "50%",
          border: `1px solid rgba(34,211,238,${0.48 - i * 0.08})`,
          pointerEvents: "none", zIndex: 3,
          animation: `wsScanRing 3s ease-out ${delay}s infinite`,
        }} />
      ))}

      {/* Radar sweep cone */}
      <div style={{
        position: "absolute",
        left: "74%", top: "62%",
        width: 240, height: 240,
        background: "conic-gradient(from 0deg, transparent 75%, rgba(34,211,238,0.2) 90%, rgba(34,211,238,0.06) 100%)",
        borderRadius: "50%",
        pointerEvents: "none", zIndex: 4,
        animation: "wsRadarSweep 4s linear infinite",
      }} />

      {/* Radar center dot */}
      <div style={{
        position: "absolute",
        left: "74%", top: "62%",
        width: 8, height: 8,
        borderRadius: "50%",
        background: "#22d3ee",
        transform: "translate(-50%,-50%)",
        boxShadow: "0 0 8px 3px rgba(34,211,238,0.55)",
        pointerEvents: "none", zIndex: 5,
      }} />

      {/* Radar cross-hairs */}
      <div style={{
        position: "absolute", left: "74%", top: "62%",
        width: 280, height: 1,
        background: "linear-gradient(to right, transparent, rgba(34,211,238,0.14) 30%, rgba(34,211,238,0.14) 70%, transparent)",
        transform: "translate(-50%,-50%)",
        pointerEvents: "none", zIndex: 3,
      }} />
      <div style={{
        position: "absolute", left: "74%", top: "62%",
        width: 1, height: 280,
        background: "linear-gradient(to bottom, transparent, rgba(34,211,238,0.14) 30%, rgba(34,211,238,0.14) 70%, transparent)",
        transform: "translate(-50%,-50%)",
        pointerEvents: "none", zIndex: 3,
      }} />

      {/* ══ CHARACTER atmospheric layers ════════════════ */}

      {/* Deep body orb */}
      <div style={{
        position: "absolute", top: "28%", right: "6%",
        transform: "translate(50%,-50%)",
        width: 460, height: 460,
        borderRadius: "50%",
        background: "radial-gradient(ellipse at center, rgba(109,40,217,0.56) 0%, rgba(88,28,135,0.24) 42%, transparent 70%)",
        filter: "blur(54px)",
        animation: "wsNebulaBreath 9s ease-in-out 1s infinite",
        pointerEvents: "none", zIndex: 1,
      }} />

      {/* Head / shoulder aura — z:7 so it glows above the character */}
      <div style={{
        position: "absolute", top: "3%", right: "4%",
        width: 330, height: 330,
        borderRadius: "50%",
        background: "radial-gradient(ellipse at center, rgba(168,85,247,0.68) 0%, rgba(139,92,246,0.28) 40%, rgba(109,40,217,0.1) 65%, transparent 80%)",
        filter: "blur(52px)",
        animation: "wsNebulaBreath 7s ease-in-out 0.5s infinite",
        pointerEvents: "none", zIndex: 7,
      }} />

      {/* Cyan rim light */}
      <div style={{
        position: "absolute", top: "20%", right: "38%",
        width: 80, height: 340,
        borderRadius: "50%",
        background: "radial-gradient(ellipse at center, rgba(34,211,238,0.24) 0%, transparent 70%)",
        filter: "blur(28px)",
        pointerEvents: "none", zIndex: 1,
      }} />

      {/* Ground glow */}
      <div style={{
        position: "absolute", bottom: -60, right: 0, left: "42%", height: "50%",
        background: "radial-gradient(ellipse at 65% 100%, rgba(109,40,217,0.74) 0%, rgba(88,28,135,0.34) 34%, transparent 68%)",
        filter: "blur(38px)",
        animation: "wsHorizonGlow 4.5s ease-in-out infinite",
        pointerEvents: "none", zIndex: 1,
      }} />

      {/* Smoke wisps */}
      <div style={{
        position: "absolute", bottom: "26%", right: "40%",
        width: 300, height: 80,
        background: "rgba(88,28,135,0.12)", borderRadius: "50%",
        filter: "blur(40px)", transform: "rotate(-10deg)",
        pointerEvents: "none", zIndex: 2,
      }} />
      <div style={{
        position: "absolute", bottom: "12%", right: "4%",
        width: 230, height: 68,
        background: "rgba(34,211,238,0.07)", borderRadius: "50%",
        filter: "blur(28px)", transform: "rotate(14deg)",
        pointerEvents: "none", zIndex: 2,
      }} />

      {/* Lens flares */}
      <div style={{
        position: "absolute", top: "12%", right: "10%",
        width: 3, height: 3, borderRadius: "50%", background: "#fff",
        boxShadow: "0 0 6px 3px rgba(220,190,255,0.95), 0 0 22px 9px rgba(139,92,246,0.62), 0 0 55px 22px rgba(109,40,217,0.3)",
        pointerEvents: "none", zIndex: 8,
      }} />
      <div style={{
        position: "absolute", top: "30%", right: "3%",
        width: 2, height: 2, borderRadius: "50%", background: "rgba(210,200,255,0.95)",
        boxShadow: "0 0 4px 2px rgba(168,85,247,0.88), 0 0 14px 5px rgba(139,92,246,0.4)",
        pointerEvents: "none", zIndex: 8,
      }} />

      {/* CHARACTER IMAGE */}
      <img
        src={watchlistAvatar}
        alt=""
        aria-hidden
        className="ws-char"
        style={{
          position: "absolute",
          bottom: 0, right: -18,
          height: "95%",
          width: "auto",
          objectFit: "contain",
          objectPosition: "bottom right",
          animation: "wsCharFloat 6.5s ease-in-out infinite",
          filter: "drop-shadow(0 0 30px rgba(139,92,246,0.72)) drop-shadow(0 0 72px rgba(109,40,217,0.44))",
          mixBlendMode: "screen",
          maskImage: [
            "linear-gradient(to right,  transparent 0%, rgba(0,0,0,0.55) 10%, black 22%)",
            "linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.45) 7%,  black 17%)",
            "linear-gradient(to left,   transparent 0%, black 4%)",
            "linear-gradient(to top,    transparent 0%, black 4%)",
          ].join(", "),
          WebkitMaskImage: [
            "linear-gradient(to right,  transparent 0%, rgba(0,0,0,0.55) 10%, black 22%)",
            "linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.45) 7%,  black 17%)",
            "linear-gradient(to left,   transparent 0%, black 4%)",
            "linear-gradient(to top,    transparent 0%, black 4%)",
          ].join(", "),
          maskComposite: "intersect",
          WebkitMaskComposite: "destination-in, destination-in, destination-in",
          zIndex: 5,
          pointerEvents: "none",
        }}
      />

      {/* ══ HOLOGRAM CARDS (right / character zone) ═════ */}
      <div className="ws-holo-zone" style={{ position: "contents" }}>
      {WS_HOLO_CARDS.map((card, i) => (
        <div key={i} style={{
          position: "absolute",
          top: card.top, right: card.right,
          transform: `rotate(${card.rot})`,
          pointerEvents: "none", zIndex: 6,
        }}>
          <div style={{ animation: `wsHoloFloat ${card.dur} ease-in-out ${card.delay} infinite` }}>
            <div style={{
              padding: "10px 14px", borderRadius: 12,
              background: "rgba(109,40,217,0.13)",
              backdropFilter: "blur(10px)",
              WebkitBackdropFilter: "blur(10px)",
              border: "1px solid rgba(139,92,246,0.34)",
              boxShadow: "0 8px 32px rgba(109,40,217,0.24), inset 0 1px 0 rgba(255,255,255,0.08)",
              minWidth: 160,
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.09em", color: "rgba(139,92,246,0.88)", marginBottom: 4 }}>
                {card.wear} · {card.disc}
              </div>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: "rgba(255,255,255,0.88)", marginBottom: 6, whiteSpace: "nowrap" }}>
                {card.name}
              </div>
              <div style={{ fontSize: 14, fontWeight: 800, color: "#fbbf24", fontVariantNumeric: "tabular-nums" }}>
                {card.price}
              </div>
            </div>
          </div>
        </div>
      ))}
      </div>

      {/* ══ LEFT READABILITY VEIL ════════════════════════
          Dark gradient over the content column so rule
          cards and text stay legible against the galaxy.  */}
      <div className="ws-veil" style={{
        position: "absolute",
        top: 0, left: 0, bottom: 0, width: "62%",
        background: "linear-gradient(to right, rgba(6,8,18,0.86) 0%, rgba(6,8,18,0.68) 42%, rgba(6,8,18,0.28) 72%, transparent 100%)",
        pointerEvents: "none", zIndex: 9,
      }} />

      {/* ══ CONTENT FOREGROUND (z:10 — above everything) ═ */}
      <div className="ws-content" style={{
        position: "relative",
        zIndex: 10,
        maxWidth: "57%",
        minHeight: 540,
        padding: "52px 36px 52px 48px",
        display: "flex",
        flexDirection: "column",
      }}>
        {loading ? (
          /* Skeleton cards */
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : isEmpty ? (
          <EmptySceneText />
        ) : (
          /* Rules list */
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {rules.map(r => (
              <WatchRuleCard key={r._id} rule={r} onDelete={onDelete} />
            ))}
          </div>
        )}
      </div>

      {/* Bottom fade → blends into page bg */}
      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0, height: 80,
        background: "linear-gradient(to top, #141a24 0%, transparent 100%)",
        pointerEvents: "none", zIndex: 20,
      }} />
    </div>
  );
}

/* ─── Empty text overlay ───────────────────────────── */

function EmptySceneText() {
  return (
    <div>
      {/* Eyebrow */}
      <div style={{
        display: "inline-flex", alignItems: "center", gap: 7,
        padding: "4px 10px", borderRadius: 7, width: "fit-content",
        background: "rgba(34,211,238,0.08)", border: "1px solid rgba(34,211,238,0.22)",
        marginBottom: 22,
      }}>
        <span style={{
          width: 5, height: 5, borderRadius: "50%",
          background: "#22d3ee", display: "inline-block",
          animation: "wsLiveDot 2s ease-in-out infinite",
        }} />
        <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.18em", color: "rgba(34,211,238,0.88)" }}>
          Scanner ready
        </span>
      </div>

      {/* Headline */}
      <h3 style={{
        fontSize: "clamp(22px, 2.5vw, 36px)",
        fontWeight: 800,
        letterSpacing: "-0.03em",
        lineHeight: 1.08,
        color: "#fff",
        margin: "0 0 14px",
        textShadow: "0 2px 30px rgba(0,0,0,0.5)",
      }}>
        No targets{" "}
        <span style={{
          background: "linear-gradient(135deg, #a855f7, #22d3ee)",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          backgroundClip: "text",
        }}>
          tracked yet
        </span>
      </h3>

      {/* Description */}
      <p style={{
        fontSize: 14, lineHeight: 1.7,
        color: "rgba(255,255,255,0.44)",
        margin: "0 0 32px", maxWidth: 320,
      }}>
        Add a rule above to start scanning. You'll get an alert the moment a skin hits your target price or discount.
      </p>

      {/* Status chips */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {[
          { label: "Rules",     value: "0 active"  },
          { label: "Scan rate", value: "6s"        },
          { label: "Alerts",    value: "Real-time" },
        ].map(s => (
          <div key={s.label} style={{
            padding: "7px 13px", borderRadius: 9,
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
          }}>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.10em", color: "rgba(255,255,255,0.35)", marginBottom: 3 }}>
              {s.label}
            </div>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: "rgba(255,255,255,0.65)", fontVariantNumeric: "tabular-nums" }}>
              {s.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Watchlist page ───────────────────────────────── */

export default function Watchlist() {
  const { rules, loading, addRule, removeRule } = useWatchlist();

  const sortedRules = useMemo(() => (
    [...(rules || [])].sort((a, b) => {
      const ta = new Date(a?.updatedAt || a?.createdAt || 0).getTime();
      const tb = new Date(b?.updatedAt || b?.createdAt || 0).getTime();
      return tb - ta;
    })
  ), [rules]);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-app)" }}>

      {/* Ambient glow */}
      <div className="fixed inset-0 pointer-events-none" style={{
        background: [
          "radial-gradient(ellipse at 20% 10%, rgba(34,211,238,0.022) 0%, transparent 45%)",
          "radial-gradient(ellipse at 80% 85%, rgba(168,85,247,0.018) 0%, transparent 45%)",
        ].join(", "),
        zIndex: 0,
      }} />

      <div className="relative z-10" style={{ maxWidth: 1800, margin: "0 auto", padding: "clamp(20px,4vw,36px) clamp(12px,3vw,24px)" }}>

        {/* Page header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 28 }}>
          <div>
            <p style={{
              fontSize: 10, fontWeight: 600, textTransform: "uppercase",
              letterSpacing: "0.18em", color: "rgba(34,211,238,0.6)", marginBottom: 6,
            }}>
              Price tracking
            </p>
            <h1 style={{ fontSize: 28, fontWeight: 800, color: "#fff", letterSpacing: "-0.02em", lineHeight: 1 }}>
              Watchlist
            </h1>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginTop: 6 }}>
              Track skins and get alerted when they hit your target price or discount.
            </p>
          </div>

          {sortedRules.length > 0 && (
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "8px 14px", borderRadius: 10,
              background: "rgba(34,211,238,0.06)", border: "1px solid rgba(34,211,238,0.14)",
            }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#4ade80", display: "inline-block", boxShadow: "0 0 5px rgba(74,222,128,0.6)" }} />
              <span style={{ fontSize: 12.5, fontWeight: 600, color: "rgba(34,211,238,0.8)" }}>
                {sortedRules.length} rule{sortedRules.length !== 1 ? "s" : ""} active
              </span>
            </div>
          )}
        </div>

        {/* Add rule form */}
        <div style={{ marginBottom: 20 }}>
          <AddWatchForm onAdd={addRule} />
        </div>

        {/* Cinematic content scene — always visible */}
        <WatchlistScene
          rules={sortedRules}
          loading={loading}
          onDelete={removeRule}
        />
      </div>
    </div>
  );
}
