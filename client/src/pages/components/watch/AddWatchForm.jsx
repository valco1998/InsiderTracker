import { useEffect, useRef, useState } from "react";
import api from "../../../lib/api";
import {
  WEAR_OPTIONS,
  buildMarketHashName,
  extractItemImage,
} from "../../../utils/watchRule";
import useSkinSuggestions from "../../../hooks/useSkinSuggestions";
import { Chip, VARIANT_LABELS, VARIANT_COLORS } from "./Chip";

function variantChip(variant) {
  const v = variant || "ANY";
  return <Chip color={VARIANT_COLORS[v] ?? "neutral"}>{VARIANT_LABELS[v] ?? "Any"}</Chip>;
}

/* ─── Normalisation helpers ──────────────────────── */

function normalizeText(v = "") {
  return String(v || "")
    .toLowerCase()
    .replace(/^★\s*/u, "")
    .replace(/^stattrak™\s*/i, "")
    .replace(/^souvenir\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeBaseName(v = "") {
  return normalizeText(v).replace(/\s*\((.*?)\)\s*$/, "").trim();
}

function isStatTrakName(v = "") {
  return /stattrak/i.test(String(v || ""));
}

function pickExactWearItem(items, selectedSkin, wear) {
  const wantedBase = normalizeBaseName(selectedSkin?.baseName || "");
  const wantedWear = normalizeText(wear);
  if (!Array.isArray(items) || !wantedBase || !wantedWear) return null;

  const normalized = items.map(it => {
    const rawName = it?.market_name || it?.market_hash_name || it?.name || "";
    return {
      item: it,
      itemBase: normalizeBaseName(rawName),
      itemWear: normalizeText(it?.wear_name || ""),
      isStatTrak: isStatTrakName(rawName),
    };
  });

  return (
    normalized.find(x => x.itemBase === wantedBase && x.itemWear === wantedWear && !x.isStatTrak)?.item ||
    normalized.find(x => x.itemBase === wantedBase && x.itemWear === wantedWear)?.item ||
    normalized.find(x => x.itemBase === wantedBase && !x.isStatTrak)?.item ||
    normalized.find(x => x.itemBase === wantedBase)?.item ||
    null
  );
}

/* ─── Sub-components ─────────────────────────────── */

function FieldLabel({ children, optional }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 7 }}>
      <span style={{
        fontSize: 10.5, fontWeight: 600,
        textTransform: "uppercase", letterSpacing: "0.12em",
        color: "rgba(255,255,255,0.45)",
      }}>
        {children}
      </span>
      {optional && (
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.22)", fontWeight: 400 }}>
          optional
        </span>
      )}
    </div>
  );
}

const fieldStyle = {
  width: "100%",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.1)",
  background: "rgba(255,255,255,0.05)",
  padding: "10px 14px",
  fontSize: 13.5,
  fontWeight: 500,
  color: "rgba(255,255,255,0.88)",
  outline: "none",
  fontFamily: "inherit",
  transition: "border-color 0.15s, background 0.15s",
};

/* ─── Main component ─────────────────────────────── */

export default function AddWatchForm({ onAdd }) {
  const rootRef = useRef(null);
  const [open, setOpen] = useState(false);

  const [search, setSearch] = useState("");
  const [selectedSkin, setSelectedSkin] = useState(null);
  const [highlightIndex, setHighlightIndex] = useState(0);

  const [wear, setWear] = useState("");
  const [variant, setVariant] = useState("");
  const [targetPrice, setTargetPrice] = useState("");
  const [minDiscountPct, setMinDiscountPct] = useState("");
  const [cooldownMin, setCooldownMin] = useState(5);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { suggestions, loading } = useSkinSuggestions(search);
  const showSuggestions = !selectedSkin && search.trim().length > 0 && suggestions.length > 0;

  useEffect(() => { setHighlightIndex(0); }, [search]);

  useEffect(() => {
    function onDocClick(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setHighlightIndex(0);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const chooseSuggestion = skin => {
    setSelectedSkin({ baseName: skin.baseName, weapon: skin.weapon, skin: skin.skin, image: skin.image || "" });
    setSearch(skin.baseName);
    setHighlightIndex(0);
    setError("");
    // Auto-detect from the concrete listing (NORMAL/STATTRAK/SOUVENIR only —
    // ANY is never auto-detected, it's a user rule choice). Independent of
    // `wear` state: selecting an item never changes a wear the user already
    // picked, and vice versa.
    if (skin.variant) setVariant(skin.variant);
  };

  const handleKeyDown = e => {
    if (!showSuggestions) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlightIndex(p => Math.min(p + 1, suggestions.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setHighlightIndex(p => Math.max(p - 1, 0)); }
    if (e.key === "Enter") { e.preventDefault(); const s = suggestions[highlightIndex]; if (s) chooseSuggestion(s); }
    if (e.key === "Escape") setHighlightIndex(0);
  };

  const resetForm = () => {
    setSearch(""); setSelectedSkin(null); setHighlightIndex(0);
    setWear(""); setVariant(""); setTargetPrice(""); setMinDiscountPct(""); setCooldownMin(5); setError("");
  };

  const submit = async () => {
    setError("");
    if (!selectedSkin?.baseName) { setError("Select an item from the list."); return; }
    if (!wear) { setError("Select a wear condition."); return; }

    try {
      setSubmitting(true);
      const marketHashName = buildMarketHashName(selectedSkin.baseName, wear);
      const lookup = await api.get("/items/market-live", { params: { search: selectedSkin.baseName, perPage: 100 } });
      const items = Array.isArray(lookup?.data?.items) ? lookup.data.items : [];
      const matchedItem = pickExactWearItem(items, selectedSkin, wear);
      const exactImage = extractItemImage(matchedItem || {}) || selectedSkin.image || "";

      const payload = {
        baseName: selectedSkin.baseName, wear, marketHashName,
        weapon: selectedSkin.weapon || "", skin: selectedSkin.skin || "",
        image: exactImage, appId: 730, cooldownMin: Number(cooldownMin) || 5,
      };
      if (targetPrice !== "") payload.targetPrice = Number(targetPrice);
      if (minDiscountPct !== "") payload.minDiscountPct = Number(minDiscountPct);
      // Omit rather than invent NORMAL if variant is genuinely empty.
      if (variant !== "") payload.variant = variant;

      await onAdd(payload);
      resetForm();
      setOpen(false);
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to save rule.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div ref={rootRef}>
      {/* Header bar */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: open ? "18px 22px 18px" : "16px 22px",
        borderRadius: open ? "16px 16px 0 0" : 16,
        background: open ? "rgba(34,211,238,0.04)" : "rgba(255,255,255,0.03)",
        border: open ? "1px solid rgba(34,211,238,0.15)" : "1px solid rgba(255,255,255,0.09)",
        borderBottom: open ? "none" : undefined,
        transition: "all 0.2s ease",
        cursor: "pointer",
      }}
        onClick={() => { if (!open) setOpen(true); }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 34, height: 34, borderRadius: 10, flexShrink: 0,
            background: open ? "rgba(34,211,238,0.12)" : "rgba(255,255,255,0.05)",
            border: open ? "1px solid rgba(34,211,238,0.25)" : "1px solid rgba(255,255,255,0.09)",
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "all 0.2s",
          }}>
            <svg width={16} height={16} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
              style={{ color: open ? "#22d3ee" : "rgba(255,255,255,0.4)" }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: open ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.7)" }}>
              New Watch Rule
            </div>
            <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.35)", marginTop: 1 }}>
              Get alerted when a tracked item hits your target
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {open && (
            <button
              onClick={e => { e.stopPropagation(); resetForm(); setOpen(false); }}
              style={{
                padding: "5px 12px", borderRadius: 8,
                background: "transparent", border: "1px solid rgba(255,255,255,0.09)",
                fontSize: 12, fontWeight: 500, color: "rgba(255,255,255,0.4)",
                cursor: "pointer", transition: "all 0.15s",
              }}
              onMouseEnter={e => { e.currentTarget.style.color = "rgba(255,255,255,0.7)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.18)"; }}
              onMouseLeave={e => { e.currentTarget.style.color = "rgba(255,255,255,0.4)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.09)"; }}
            >
              Cancel
            </button>
          )}
          <div style={{
            width: 20, height: 20, borderRadius: 6,
            background: "rgba(255,255,255,0.05)",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "rgba(255,255,255,0.3)", fontSize: 12, fontWeight: 700,
            transform: open ? "rotate(45deg)" : "rotate(0deg)",
            transition: "transform 0.2s ease",
          }}>
            +
          </div>
        </div>
      </div>

      {/* Expanded form body */}
      {open && (
        <div style={{
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(34,211,238,0.15)",
          borderTop: "1px solid rgba(255,255,255,0.06)",
          borderRadius: "0 0 16px 16px",
          padding: "20px 22px 22px",
        }}>

          {/* Skin search */}
          <div style={{ marginBottom: 18 }}>
            <FieldLabel>Item</FieldLabel>

            {selectedSkin ? (
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                gap: 12, padding: "10px 14px",
                borderRadius: 10, border: "1px solid rgba(34,211,238,0.22)",
                background: "rgba(34,211,238,0.06)",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                  {selectedSkin.image && (
                    <img src={selectedSkin.image} alt={selectedSkin.baseName}
                      style={{ width: 44, height: 32, objectFit: "contain", flexShrink: 0 }} />
                  )}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: "#a5f3fc", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {selectedSkin.baseName}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3, flexWrap: "wrap" }}>
                      {variantChip(variant)}
                      {(selectedSkin.weapon || selectedSkin.skin) && (
                        <span style={{ fontSize: 11, color: "rgba(34,211,238,0.5)" }}>
                          {[selectedSkin.weapon, selectedSkin.skin].filter(Boolean).join(" · ")}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => { setSelectedSkin(null); setSearch(""); }}
                  style={{
                    flexShrink: 0, padding: "4px 10px", borderRadius: 7,
                    background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
                    fontSize: 11.5, fontWeight: 500, color: "rgba(255,255,255,0.5)",
                    cursor: "pointer",
                  }}
                >
                  Change
                </button>
              </div>
            ) : (
              <div style={{ position: "relative" }}>
                <div style={{ position: "relative" }}>
                  <svg style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}
                    width={14} height={14} fill="none" viewBox="0 0 24 24" stroke="rgba(255,255,255,0.28)" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input
                    style={{ ...fieldStyle, paddingLeft: 38 }}
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Search by name, e.g. Karambit, AWP Asiimov…"
                    onFocus={e => { e.currentTarget.style.borderColor = "rgba(34,211,238,0.35)"; e.currentTarget.style.background = "rgba(255,255,255,0.07)"; }}
                    onBlur={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.10)"; e.currentTarget.style.background = "rgba(255,255,255,0.05)"; }}
                  />
                </div>

                {search.trim() && !selectedSkin && (
                  <div style={{
                    position: "absolute", zIndex: 50, marginTop: 6, width: "100%",
                    borderRadius: 12, overflow: "hidden",
                    background: "#1f2838",
                    border: "1px solid rgba(255,255,255,0.10)",
                    boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
                  }}>
                    {loading ? (
                      <div style={{ padding: "14px 16px", fontSize: 13, color: "rgba(255,255,255,0.45)", display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ width: 14, height: 14, border: "2px solid rgba(34,211,238,0.3)", borderTopColor: "#22d3ee", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                        Searching…
                      </div>
                    ) : showSuggestions ? (
                      <div style={{ maxHeight: 320, overflowY: "auto" }}>
                        {suggestions.map((s, i) => (
                          <button
                            key={`${s.variant}::${s.baseName}`}
                            type="button"
                            onClick={() => chooseSuggestion(s)}
                            onMouseEnter={() => setHighlightIndex(i)}
                            style={{
                              width: "100%", display: "flex", alignItems: "center", gap: 12,
                              padding: "10px 16px", textAlign: "left", cursor: "pointer",
                              background: i === highlightIndex ? "rgba(34,211,238,0.07)" : "transparent",
                              border: "none", borderBottom: "1px solid rgba(255,255,255,0.04)",
                              transition: "background 0.1s",
                            }}
                          >
                            {s.image ? (
                              <img src={s.image} alt={s.baseName}
                                style={{ width: 48, height: 34, objectFit: "contain", flexShrink: 0 }} />
                            ) : (
                              <div style={{ width: 48, height: 34, borderRadius: 6, background: "rgba(255,255,255,0.05)", flexShrink: 0 }} />
                            )}
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.9)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {s.baseName}
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3, flexWrap: "wrap" }}>
                                {variantChip(s.variant)}
                                {s.weapon && (
                                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>
                                    {s.weapon}
                                  </span>
                                )}
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div style={{ padding: "14px 16px", fontSize: 13, color: "rgba(255,255,255,0.35)" }}>
                        No results found
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Config grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 14, marginBottom: 18 }}>

            <div>
              <FieldLabel>Wear</FieldLabel>
              <select
                style={{ ...fieldStyle, cursor: "pointer", appearance: "none" }}
                value={wear}
                onChange={e => setWear(e.target.value)}
                onFocus={e => { e.currentTarget.style.borderColor = "rgba(34,211,238,0.35)"; }}
                onBlur={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.10)"; }}
              >
                <option value="" style={{ background: "#1f2838" }}>Select wear</option>
                {WEAR_OPTIONS.map(x => (
                  <option key={x} value={x} style={{ background: "#1f2838" }}>{x}</option>
                ))}
              </select>
            </div>

            <div>
              <FieldLabel optional>Variant</FieldLabel>
              <select
                style={{ ...fieldStyle, cursor: "pointer", appearance: "none" }}
                value={variant}
                onChange={e => setVariant(e.target.value)}
                onFocus={e => { e.currentTarget.style.borderColor = "rgba(34,211,238,0.35)"; }}
                onBlur={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.10)"; }}
              >
                <option value="" style={{ background: "#1f2838" }}>Select variant</option>
                <option value="NORMAL" style={{ background: "#1f2838" }}>Normal</option>
                <option value="STATTRAK" style={{ background: "#1f2838" }}>StatTrak™</option>
                <option value="SOUVENIR" style={{ background: "#1f2838" }}>Souvenir</option>
                <option value="ANY" style={{ background: "#1f2838" }}>Any</option>
              </select>
            </div>

            <div>
              <FieldLabel optional>Target price (coins)</FieldLabel>
              <input
                style={fieldStyle}
                value={targetPrice}
                onChange={e => setTargetPrice(e.target.value)}
                type="number" min="0" step="0.01"
                placeholder="e.g. 350"
                onFocus={e => { e.currentTarget.style.borderColor = "rgba(34,211,238,0.35)"; e.currentTarget.style.background = "rgba(255,255,255,0.07)"; }}
                onBlur={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.10)"; e.currentTarget.style.background = "rgba(255,255,255,0.05)"; }}
              />
            </div>

            <div>
              <FieldLabel optional>Min discount %</FieldLabel>
              <input
                style={fieldStyle}
                value={minDiscountPct}
                onChange={e => setMinDiscountPct(e.target.value)}
                type="number" min="0" max="100" step="0.1"
                placeholder="e.g. 10"
                onFocus={e => { e.currentTarget.style.borderColor = "rgba(34,211,238,0.35)"; e.currentTarget.style.background = "rgba(255,255,255,0.07)"; }}
                onBlur={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.10)"; e.currentTarget.style.background = "rgba(255,255,255,0.05)"; }}
              />
            </div>

            <div>
              <FieldLabel>Cooldown (min)</FieldLabel>
              <input
                style={fieldStyle}
                value={cooldownMin}
                onChange={e => setCooldownMin(e.target.value)}
                type="number" min="1" step="1"
                onFocus={e => { e.currentTarget.style.borderColor = "rgba(34,211,238,0.35)"; e.currentTarget.style.background = "rgba(255,255,255,0.07)"; }}
                onBlur={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.10)"; e.currentTarget.style.background = "rgba(255,255,255,0.05)"; }}
              />
            </div>
          </div>

          {/* Summary preview */}
          {(selectedSkin || wear) && (
            <div style={{
              display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
              padding: "10px 14px", borderRadius: 10, marginBottom: 16,
              background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)",
            }}>
              <svg width={13} height={13} fill="none" viewBox="0 0 24 24" stroke="rgba(255,255,255,0.3)" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span style={{ fontSize: 12.5, color: "rgba(255,255,255,0.45)" }}>
                Tracking:{" "}
                <span style={{ color: "rgba(255,255,255,0.75)", fontWeight: 500 }}>
                  {selectedSkin?.baseName || "—"}{wear ? ` (${wear})` : ""}
                </span>
              </span>
              {variantChip(variant)}
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={{
              marginBottom: 14, padding: "10px 14px", borderRadius: 10,
              background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)",
              fontSize: 13, color: "#fca5a5",
            }}>
              {error}
            </div>
          )}

          {/* Submit */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              type="button"
              disabled={submitting}
              onClick={submit}
              style={{
                padding: "11px 28px", borderRadius: 11,
                fontSize: 13.5, fontWeight: 700, color: "#000", cursor: "pointer",
                background: "linear-gradient(135deg, #22d3ee, #06b6d4)",
                boxShadow: "0 4px 16px rgba(34,211,238,0.28)",
                border: "none",
                opacity: submitting ? 0.6 : 1,
                transition: "all 0.2s",
              }}
              onMouseEnter={e => { if (!submitting) { e.currentTarget.style.boxShadow = "0 6px 22px rgba(34,211,238,0.4)"; e.currentTarget.style.transform = "translateY(-1px)"; } }}
              onMouseLeave={e => { e.currentTarget.style.boxShadow = "0 4px 16px rgba(34,211,238,0.28)"; e.currentTarget.style.transform = "translateY(0)"; }}
            >
              {submitting ? "Saving…" : "Add Rule"}
            </button>
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.25)" }}>
              At least one condition required
            </span>
          </div>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
