export const VARIANT_LABELS = {
  NORMAL: "Normal",
  STATTRAK: "StatTrak™",
  SOUVENIR: "Souvenir",
  ANY: "Any",
};

export const VARIANT_COLORS = {
  NORMAL: "neutral",
  STATTRAK: "gold",
  SOUVENIR: "green",
  ANY: "neutral",
};

export function Chip({ children, color = "neutral" }) {
  const styles = {
    neutral: { bg: "rgba(255,255,255,0.06)", border: "rgba(255,255,255,0.10)", text: "rgba(255,255,255,0.6)" },
    cyan:    { bg: "rgba(34,211,238,0.08)",  border: "rgba(34,211,238,0.18)",  text: "#67e8f9" },
    gold:    { bg: "rgba(251,191,36,0.09)",  border: "rgba(251,191,36,0.2)",   text: "#fcd34d" },
    green:   { bg: "rgba(74,222,128,0.08)",  border: "rgba(74,222,128,0.18)",  text: "#86efac" },
  };
  const s = styles[color] ?? styles.neutral;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center",
      padding: "2px 8px", borderRadius: 6,
      fontSize: 11, fontWeight: 600, lineHeight: "18px",
      background: s.bg, border: `1px solid ${s.border}`, color: s.text,
      whiteSpace: "nowrap",
    }}>
      {children}
    </span>
  );
}
