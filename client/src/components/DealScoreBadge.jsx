import { memo } from "react";

function scoreStyle(score) {
  if (score >= 80) return {
    text: "#4ade80", bg: "rgba(74,222,128,0.12)",
    border: "rgba(74,222,128,0.35)", glow: "0 0 14px rgba(74,222,128,0.28)",
  };
  if (score >= 65) return {
    text: "#86efac", bg: "rgba(134,239,172,0.10)",
    border: "rgba(134,239,172,0.28)", glow: "none",
  };
  if (score >= 50) return {
    text: "#fbbf24", bg: "rgba(251,191,36,0.10)",
    border: "rgba(251,191,36,0.26)", glow: "none",
  };
  if (score >= 35) return {
    text: "#fb923c", bg: "rgba(251,146,60,0.10)",
    border: "rgba(251,146,60,0.24)", glow: "none",
  };
  return {
    text: "rgba(255,255,255,0.32)", bg: "rgba(255,255,255,0.05)",
    border: "rgba(255,255,255,0.10)", glow: "none",
  };
}

// 0–3 filled dots based on confidence tier
function confDots(confidence) {
  if (confidence >= 0.80) return 3;
  if (confidence >= 0.50) return 2;
  if (confidence >= 0.25) return 1;
  return 0;
}

/**
 * Compact deal score badge. Click to toggle the breakdown panel.
 * @param {{ dealScore: object, open: boolean, onToggle: () => void }} props
 */
const DealScoreBadge = memo(function DealScoreBadge({ dealScore, open, onToggle }) {
  if (!dealScore) return null;

  const { score, confidence } = dealScore;
  const { text, bg, border, glow } = scoreStyle(score);
  const dots = confDots(confidence);

  return (
    <button
      onClick={onToggle}
      aria-label={`Deal Score ${score} — click for breakdown`}
      style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        padding: "3px 8px 3px 6px", borderRadius: 8,
        background: bg, border: `1px solid ${border}`,
        boxShadow: glow,
        cursor: "pointer", userSelect: "none",
        fontFamily: "inherit",
        transition: "opacity 0.15s",
        // reset button defaults
        outline: "none", appearance: "none",
      }}
    >
      {/* "DS" label */}
      <span style={{
        fontSize: 9, fontWeight: 800, letterSpacing: "0.11em",
        color: "rgba(255,255,255,0.35)", textTransform: "uppercase",
      }}>
        DS
      </span>

      {/* Score number */}
      <span style={{
        fontSize: 15, fontWeight: 900, lineHeight: 1,
        color: text, fontVariantNumeric: "tabular-nums",
      }}>
        {score}
      </span>

      {/* Confidence dots */}
      <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{
            width: 3, height: 3, borderRadius: "50%",
            background: i < dots ? text : "rgba(255,255,255,0.14)",
          }} />
        ))}
      </div>

      {/* Expand chevron */}
      <span style={{
        fontSize: 8, lineHeight: 1,
        color: "rgba(255,255,255,0.22)",
        marginLeft: 1,
      }}>
        {open ? "▲" : "▼"}
      </span>
    </button>
  );
});

export default DealScoreBadge;
