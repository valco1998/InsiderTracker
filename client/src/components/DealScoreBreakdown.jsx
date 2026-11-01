import { memo } from "react";

function barColor(score) {
  if (score >= 80) return "#4ade80";
  if (score >= 65) return "#86efac";
  if (score >= 50) return "#fbbf24";
  if (score >= 35) return "#fb923c";
  return "rgba(255,255,255,0.20)";
}

function ScoreBar({ score }) {
  return (
    <div style={{
      flex: 1, height: 3, borderRadius: 2,
      background: "rgba(255,255,255,0.07)", overflow: "hidden",
    }}>
      <div style={{
        width: `${Math.round(score)}%`, height: "100%", borderRadius: 2,
        background: barColor(score),
        transition: "width 0.35s ease",
      }} />
    </div>
  );
}

/**
 * Expandable breakdown of the deal score factors.
 * @param {{ dealScore: object }} props
 */
const DealScoreBreakdown = memo(function DealScoreBreakdown({ dealScore }) {
  if (!dealScore) return null;

  const { confidence, factors, confidenceLabel } = dealScore;
  const { discount, priceHistory, liquidity, float: floatFactor } = factors;

  const activeFactors = [
    discount     && { key: "discount",  f: discount },
    priceHistory && { key: "price",     f: priceHistory },
    liquidity    && { key: "liquidity", f: liquidity },
    floatFactor  && { key: "float",     f: floatFactor },
  ].filter(Boolean);

  const missingFactors = [
    !priceHistory && { label: "Sale history",  reason: "Accumulating data" },
    !liquidity    && { label: "Liquidity",      reason: "Insufficient data" },
    !floatFactor  && { label: "Float",          reason: "No float available" },
  ].filter(Boolean);

  return (
    <div style={{
      borderRadius: 10,
      background: "rgba(8,5,18,0.88)",
      border: "1px solid rgba(255,255,255,0.08)",
      overflow: "hidden",
    }}>
      {/* Active factors */}
      <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
        {activeFactors.map(({ key, f }) => (
          <div key={key}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {/* Factor name */}
              <span style={{
                fontSize: 10, fontWeight: 700,
                color: "rgba(255,255,255,0.45)",
                width: 64, flexShrink: 0,
              }}>
                {f.label}
              </span>
              {/* Mini bar */}
              <ScoreBar score={f.score} />
              {/* Score number */}
              <span style={{
                fontSize: 12, fontWeight: 900,
                color: barColor(f.score),
                fontVariantNumeric: "tabular-nums",
                width: 20, textAlign: "right", flexShrink: 0,
              }}>
                {Math.round(f.score)}
              </span>
              {/* Weight */}
              <span style={{
                fontSize: 9, fontWeight: 600,
                color: "rgba(255,255,255,0.20)",
                width: 24, textAlign: "right", flexShrink: 0,
              }}>
                {Math.round(f.weight * 100)}%
              </span>
            </div>
            {/* Detail line */}
            {f.detail && (
              <p style={{
                fontSize: 9.5, color: "rgba(255,255,255,0.25)",
                marginLeft: 70, marginTop: 2, lineHeight: 1.4,
              }}>
                {f.detail}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Excluded factors */}
      {missingFactors.length > 0 && (
        <div style={{
          borderTop: "1px solid rgba(255,255,255,0.05)",
          padding: "5px 12px",
          display: "flex", flexWrap: "wrap", gap: "3px 12px",
        }}>
          {missingFactors.map(m => (
            <span key={m.label} style={{ fontSize: 9.5, color: "rgba(255,255,255,0.18)" }}>
              {m.label}: {m.reason}
            </span>
          ))}
        </div>
      )}

      {/* Confidence footer */}
      <div style={{
        borderTop: "1px solid rgba(255,255,255,0.05)",
        padding: "5px 12px",
        display: "flex", alignItems: "center", gap: 6,
      }}>
        {/* Confidence bar */}
        <div style={{
          flex: 1, height: 2, borderRadius: 1,
          background: "rgba(255,255,255,0.06)", overflow: "hidden",
        }}>
          <div style={{
            width: `${Math.round(confidence * 100)}%`, height: "100%",
            background: "rgba(168,85,247,0.55)",
          }} />
        </div>
        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.22)", flexShrink: 0 }}>
          {Math.round(confidence * 100)}% · {confidenceLabel}
        </span>
      </div>
    </div>
  );
});

export default DealScoreBreakdown;
