import { useCallback, useState } from "react";

const CATEGORIES = [
  { key: "",        label: "All"      },
  { key: "knife",   label: "Knives"   },
  { key: "rifle",   label: "Rifles"   },
  { key: "pistol",  label: "Pistols"  },
  { key: "smg",     label: "SMGs"     },
  { key: "sniper",  label: "Snipers"  },
  { key: "gloves",  label: "Gloves"   },
  { key: "sticker", label: "Stickers" },
];

function FilterInput({ icon, placeholder, value, onChange, type = "text" }) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      height: 36, padding: "0 12px", borderRadius: 12,
      background: focused ? "rgba(168,85,247,0.09)" : "rgba(255,255,255,0.04)",
      border: focused ? "1px solid rgba(168,85,247,0.36)" : "1px solid rgba(255,255,255,0.08)",
      boxShadow: focused ? "0 0 0 3px rgba(168,85,247,0.07), 0 0 20px rgba(168,85,247,0.07)" : "none",
      transition: "all 0.15s ease",
    }}>
      {icon && (
        <span style={{ fontSize: 13, color: "rgba(168,85,247,0.55)", flexShrink: 0 }}>{icon}</span>
      )}
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        className="placeholder:text-white/20"
        style={{
          flex: 1, background: "transparent", border: "none", outline: "none",
          fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.88)",
          fontFamily: "inherit", minWidth: 0,
        }}
      />
    </div>
  );
}

export default function FiltersBar({ filters, setFilters }) {
  const [local, setLocal] = useState(filters || {});

  const update = useCallback((key, value) => {
    const next = { ...local, [key]: value };
    setLocal(next);
    setFilters(next);
  }, [local, setFilters]);

  const activeCategory = local.category || "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Category pills — horizontal scroll on mobile */}
      <div className="chips-scroll" style={{ alignItems: "center" }}>
        {CATEGORIES.map(cat => {
          const active = activeCategory === cat.key;
          return (
            <button key={cat.key} onClick={() => update("category", cat.key)}
              style={{
                height: 34, padding: "0 16px", borderRadius: 20,
                fontSize: 12.5, fontWeight: 700, cursor: "pointer",
                background: active ? "rgba(168,85,247,0.15)" : "rgba(255,255,255,0.04)",
                border: active ? "1px solid rgba(168,85,247,0.36)" : "1px solid rgba(255,255,255,0.07)",
                color: active ? "#c084fc" : "rgba(255,255,255,0.45)",
                boxShadow: active ? "0 0 14px rgba(168,85,247,0.18)" : "none",
                transition: "all 0.15s ease",
              }}>
              {cat.label}
            </button>
          );
        })}
      </div>

      {/* Inputs row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 160px", minWidth: 0 }}>
          <FilterInput
            icon="⌕"
            placeholder="Search skins…"
            value={local.search || ""}
            onChange={v => update("search", v)}
          />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          <div style={{ minWidth: 70, flex: "0 1 86px" }}>
            <FilterInput
              placeholder="Min"
              value={local.minPrice || ""}
              onChange={v => update("minPrice", v)}
              type="number"
            />
          </div>
          <span style={{ color: "rgba(255,255,255,0.22)", fontSize: 13, padding: "0 1px" }}>–</span>
          <div style={{ minWidth: 70, flex: "0 1 86px" }}>
            <FilterInput
              placeholder="Max"
              value={local.maxPrice || ""}
              onChange={v => update("maxPrice", v)}
              type="number"
            />
          </div>
        </div>

        <div style={{ width: 120, flexShrink: 0 }}>
          <FilterInput
            icon="%"
            placeholder="Min disc."
            value={local.minDiscountPct || ""}
            onChange={v => update("minDiscountPct", v)}
            type="number"
          />
        </div>

        {(local.search || local.category || local.minDiscountPct) && (
          <button
            onClick={() => {
              const reset = { search: "", category: "", minPrice: "30", maxPrice: "10000", minDiscountPct: "" };
              setLocal(reset);
              setFilters(reset);
            }}
            style={{
              height: 36, padding: "0 12px", borderRadius: 12,
              fontSize: 12, fontWeight: 600, cursor: "pointer",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              color: "rgba(255,255,255,0.40)",
              transition: "all 0.15s",
            }}
            onMouseEnter={e => {
              e.currentTarget.style.color = "#fff";
              e.currentTarget.style.borderColor = "rgba(255,255,255,0.16)";
            }}
            onMouseLeave={e => {
              e.currentTarget.style.color = "rgba(255,255,255,0.40)";
              e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)";
            }}
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
