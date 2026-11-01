import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import api from "../../lib/api";
import { TradeItemThumb } from "./TradeItemCard";
import { MATCH_TIERS } from "../../utils/tradeMatch";
import useSkinSuggestions from "../../hooks/useSkinSuggestions";
import anyKnifeImg  from "../../assets/any_knife.png";
import anyKeyImg    from "../../assets/any_key.png";
import anyCaseImg   from "../../assets/any_case.png";
import anyOffersImg from "../../assets/any_offers.png";

/* ─── Trade categories shown at top of "I Want" dropdown ── */
const TRADE_CATEGORIES = [
  { name: "Any Knife",  marketHashName: "Any Knife",  iconUrl: anyKnifeImg,  isSpecial: true },
  { name: "Any Key",    marketHashName: "Any Key",    iconUrl: anyKeyImg,    isSpecial: true },
  { name: "Any Case",   marketHashName: "Any Case",   iconUrl: anyCaseImg,   isSpecial: true },
  { name: "Any Offers", marketHashName: "Any Offers", iconUrl: anyOffersImg, isSpecial: true },
];

/* ─── helpers ─────────────────────────────────────── */

function timeAgo(iso) {
  if (!iso) return "";
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60_000), h = Math.floor(m / 60), day = Math.floor(h / 24);
  if (day > 0) return `${day}d ago`;
  if (h   > 0) return `${h}h ago`;
  if (m   > 0) return `${m}m ago`;
  return "just now";
}

const WEAR_VARIANTS = [
  { label: "Factory New",    short: "FN", color: "#22c55e" },
  { label: "Minimal Wear",   short: "MW", color: "#86efac" },
  { label: "Field-Tested",   short: "FT", color: "#ca8a04" },
  { label: "Well-Worn",      short: "WW", color: "#f97316" },
  { label: "Battle-Scarred", short: "BS", color: "#ef4444" },
];
const NO_WEAR_RE = /^(sticker|case|souvenir|music\s*kit|graffiti|sealed\s*graffiti|agent|patch|pin)/i;

function skinHasWear(skin) {
  const w = skin.weapon || (skin.baseName || "").split(" | ")[0] || "";
  return !NO_WEAR_RE.test(w.trim());
}

/* ─── Avatar ─────────────────────────────────────── */
function Avatar({ src, username, size = 34 }) {
  const [failed, setFailed] = useState(false);
  const fallback = `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(username || "?")}`;
  return (
    <img src={!failed && src ? src : fallback} alt={username} onError={() => setFailed(true)}
      style={{ width: size, height: size, borderRadius: 9, objectFit: "cover", border: "1px solid rgba(168,85,247,0.25)", flexShrink: 0 }}
    />
  );
}

/* ─── Small item pill ─────────────────────────────── */
function ItemPill({ item, onRemove }) {
  if (!item) return null;
  const name = item.name || item.marketHashName || "";
  const ext  = item.exterior || null;
  const isSpecial = !!item.isSpecial;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "7px 10px 7px 8px", borderRadius: 10,
      background: isSpecial ? "rgba(168,85,247,0.12)" : "rgba(168,85,247,0.08)",
      border: isSpecial ? "1px solid rgba(168,85,247,0.35)" : "1px solid rgba(168,85,247,0.22)",
    }}>
      {item.iconUrl && (
        <div style={{
          width: 36, height: 28, flexShrink: 0, borderRadius: 6, overflow: "hidden",
          background: isSpecial ? "rgba(168,85,247,0.10)" : "rgba(255,255,255,0.04)",
          border: isSpecial ? "1px solid rgba(168,85,247,0.20)" : "none",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <img src={item.iconUrl} alt={name} style={{ width: "88%", height: "88%", objectFit: "contain" }} />
        </div>
      )}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.90)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {name}
          </span>
          {isSpecial && (
            <span style={{
              fontSize: 8, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.10em",
              padding: "1px 5px", borderRadius: 4, flexShrink: 0,
              background: "rgba(168,85,247,0.16)", border: "1px solid rgba(168,85,247,0.28)",
              color: "#c084fc",
            }}>Category</span>
          )}
        </div>
        {ext && <div style={{ fontSize: 10, color: "rgba(168,85,247,0.65)", marginTop: 1 }}>{ext}</div>}
      </div>
      <button onClick={onRemove} style={{
        width: 18, height: 18, borderRadius: 5, border: "none", flexShrink: 0,
        background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.40)",
        cursor: "pointer", fontSize: 13, lineHeight: 1,
        display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "inherit",
      }}>×</button>
    </div>
  );
}

/* ─── Chip inside the multi-select "I Want" box ─────── */
function WantChip({ item, onRemove }) {
  const isSpecial = !!item.isSpecial;
  const name      = item.name || item.marketHashName || "";
  const ext       = item.exterior || null;
  const wearShort = ext ? (WEAR_VARIANTS.find(w => w.label === ext)?.short || ext.slice(0, 2).toUpperCase()) : null;
  // Trim to base name so chip stays compact
  const displayName = name
    .replace(/ \((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)$/, "")
    .trim();
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      height: 26, padding: "0 5px 0 5px", borderRadius: 6, flexShrink: 0,
      background: isSpecial ? "rgba(168,85,247,0.16)" : "rgba(255,255,255,0.09)",
      border: isSpecial ? "1px solid rgba(168,85,247,0.34)" : "1px solid rgba(255,255,255,0.13)",
      maxWidth: 180,
    }}>
      {item.iconUrl && (
        <img src={item.iconUrl} alt={name}
          style={{ width: 16, height: 16, objectFit: "contain", flexShrink: 0, opacity: 0.9 }} />
      )}
      <span style={{
        fontSize: 11, fontWeight: 600,
        color: isSpecial ? "#c084fc" : "rgba(255,255,255,0.85)",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        maxWidth: 110,
      }}>
        {displayName}
      </span>
      {wearShort && !isSpecial && (
        <span style={{
          fontSize: 9, fontWeight: 800, flexShrink: 0,
          color: WEAR_VARIANTS.find(w => w.label === ext)?.color || "rgba(255,255,255,0.40)",
        }}>
          {wearShort}
        </span>
      )}
      {isSpecial && (
        <span style={{
          fontSize: 8, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em",
          padding: "1px 4px", borderRadius: 3, flexShrink: 0,
          background: "rgba(168,85,247,0.18)", color: "#c084fc",
        }}>CAT</span>
      )}
      <button
        onMouseDown={e => e.preventDefault()}
        onClick={e => { e.stopPropagation(); onRemove(); }}
        style={{
          width: 14, height: 14, borderRadius: 3, border: "none", flexShrink: 0,
          background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.50)",
          cursor: "pointer", fontSize: 11, lineHeight: 1,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontFamily: "inherit", marginLeft: 1,
        }}
      >×</button>
    </div>
  );
}

/* ─── Inventory picker panel ──────────────────────── */
function InventoryPicker({ inventory, selectedItem, onSelect, onClose }) {
  const [search, setSearch] = useState("");
  const filtered = (inventory || []).filter(item =>
    !search.trim() || (item.name || item.marketHashName || "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div style={{
      position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, zIndex: 400,
      background: "#110e1f", border: "1px solid rgba(168,85,247,0.28)", borderRadius: 14,
      boxShadow: "0 20px 56px rgba(0,0,0,0.80), 0 0 0 1px rgba(168,85,247,0.08)",
      overflow: "hidden",
    }}>
      <div style={{ padding: "10px 12px", borderBottom: "1px solid rgba(168,85,247,0.10)" }}>
        <div style={{ position: "relative" }}>
          <svg style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}
            width={12} height={12} fill="none" viewBox="0 0 24 24" stroke="rgba(168,85,247,0.5)" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            autoFocus
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={`Search ${inventory?.length || 0} items…`}
            style={{
              width: "100%", height: 32, padding: "0 10px 0 28px", boxSizing: "border-box",
              background: "rgba(255,255,255,0.04)", border: "1px solid rgba(168,85,247,0.18)",
              borderRadius: 7, color: "rgba(255,255,255,0.85)", fontSize: 12,
              outline: "none", fontFamily: "inherit",
            }}
            className="placeholder:text-white/20"
          />
        </div>
      </div>
      <div style={{ maxHeight: 280, overflowY: "auto", padding: 6 }}>
        {filtered.length === 0 ? (
          <div style={{ padding: "16px 12px", textAlign: "center", fontSize: 12, color: "rgba(255,255,255,0.28)" }}>
            {inventory?.length ? `No items match "${search}"` : "No inventory synced — use the extension."}
          </div>
        ) : filtered.map((item, i) => {
          const isSel = selectedItem?.assetId === item.assetId;
          const name  = item.name || item.marketHashName || "";
          return (
            <button
              key={item.assetId || i}
              onClick={() => { onSelect(item); onClose(); }}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 8,
                padding: "6px 10px", borderRadius: 8, cursor: "pointer", textAlign: "left",
                background: isSel ? "rgba(168,85,247,0.14)" : "transparent",
                border: "none", fontFamily: "inherit", transition: "background 0.12s",
              }}
              onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = "rgba(255,255,255,0.05)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = isSel ? "rgba(168,85,247,0.14)" : "transparent"; }}
            >
              <div style={{ width: 36, height: 28, flexShrink: 0, background: "rgba(255,255,255,0.04)", borderRadius: 6, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
                {item.iconUrl
                  ? <img src={item.iconUrl} alt={name} style={{ width: "88%", height: "88%", objectFit: "contain" }} />
                  : <span style={{ fontSize: 14, opacity: 0.12 }}>🔫</span>
                }
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 11.5, fontWeight: 600, color: "rgba(255,255,255,0.85)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
                {item.exterior && <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 1 }}>{item.exterior}</div>}
              </div>
              {isSel && <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#a855f7", boxShadow: "0 0 5px #a855f7", flexShrink: 0 }} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ─── "I Want" multi-select tag input + dropdown ─────── */
function WantSearch({ wantItems, onAdd, onRemove }) {
  const inputRef     = useRef(null);
  const dropdownRef  = useRef(null);
  const containerRef = useRef(null);
  const [search, setSearch] = useState("");
  const [open,   setOpen]   = useState(false);
  const { suggestions, loading } = useSkinSuggestions(search);

  useEffect(() => {
    function handler(e) {
      if (
        dropdownRef.current  && !dropdownRef.current.contains(e.target) &&
        containerRef.current && !containerRef.current.contains(e.target)
      ) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const alreadyAdded = mhn => wantItems.some(w => w.marketHashName === mhn);

  const visibleCategories = (search.trim()
    ? TRADE_CATEGORIES.filter(c => c.name.toLowerCase().includes(search.trim().toLowerCase()))
    : TRADE_CATEGORIES
  ).filter(c => !alreadyAdded(c.marketHashName));

  const showSkins       = search.trim().length >= 2;
  const showDropdown    = open && (visibleCategories.length > 0 || showSkins);
  const showSkinSection = showSkins && (suggestions.length > 0 || loading);
  const showDivider     = visibleCategories.length > 0 && showSkinSection;

  function selectItem(item) {
    if (alreadyAdded(item.marketHashName)) return;
    onAdd(item);
    setSearch("");
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  return (
    <div style={{ position: "relative" }}>
      {/* Tag container — acts as the visual input */}
      <div
        ref={containerRef}
        onClick={() => { inputRef.current?.focus(); setOpen(true); }}
        style={{
          minHeight: 38, padding: "4px 30px 4px 6px",
          boxSizing: "border-box",
          background: "rgba(255,255,255,0.05)", border: "1px solid rgba(168,85,247,0.20)",
          borderRadius: 9, cursor: "text",
          display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4,
          transition: "border-color 0.15s",
        }}
        onFocus={() => {}}
      >
        {/* Search icon — only when empty */}
        {wantItems.length === 0 && (
          <svg style={{ flexShrink: 0, opacity: 0.5 }}
            width={13} height={13} fill="none" viewBox="0 0 24 24" stroke="rgba(168,85,247,0.9)" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        )}

        {/* Selected item chips */}
        {wantItems.map(item => (
          <WantChip key={item.marketHashName} item={item} onRemove={() => onRemove(item.marketHashName)} />
        ))}

        {/* Text input for adding more */}
        <input
          ref={inputRef}
          value={search}
          onChange={e => { setSearch(e.target.value); setOpen(true); }}
          onFocus={e => {
            setOpen(true);
            // Update container border to focused state
            if (containerRef.current) containerRef.current.style.borderColor = "rgba(168,85,247,0.48)";
          }}
          onBlur={() => {
            if (containerRef.current) containerRef.current.style.borderColor = "rgba(168,85,247,0.20)";
          }}
          placeholder={wantItems.length === 0 ? "Any Knife, M4A1-S Cyrex…" : "Add more…"}
          style={{
            flex: 1, minWidth: 80, height: 26, padding: "0 4px",
            background: "transparent", border: "none", outline: "none",
            color: "rgba(255,255,255,0.88)", fontSize: 13, fontFamily: "inherit",
          }}
          className="placeholder:text-white/20"
        />

        {/* Loading spinner */}
        {loading && (
          <div style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)" }}>
            <svg width={13} height={13} viewBox="0 0 32 32" fill="none" style={{ animation: "sw-spin 0.8s linear infinite" }}>
              <circle cx="16" cy="16" r="12" stroke="rgba(168,85,247,0.25)" strokeWidth="3" />
              <path d="M16 4 A12 12 0 0 1 28 16" stroke="#a855f7" strokeWidth="3" strokeLinecap="round" />
            </svg>
          </div>
        )}

        {/* Clear-all button */}
        {(wantItems.length > 0 || search) && !loading && (
          <button
            onMouseDown={e => e.preventDefault()}
            onClick={() => { wantItems.forEach(i => onRemove(i.marketHashName)); setSearch(""); }}
            style={{
              position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
              width: 18, height: 18, borderRadius: 5, border: "none",
              background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.40)",
              cursor: "pointer", fontSize: 13, lineHeight: 1,
              display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "inherit",
            }}
          >×</button>
        )}
      </div>

      {showDropdown && (
        <div
          ref={dropdownRef}
          style={{
            position: "absolute", zIndex: 500, top: "calc(100% + 4px)", left: 0, right: 0,
            background: "#130f22", border: "1px solid rgba(168,85,247,0.25)", borderRadius: 12,
            boxShadow: "0 16px 48px rgba(0,0,0,0.70), 0 0 0 1px rgba(168,85,247,0.08)",
            overflow: "hidden",
          }}
        >
          <div style={{ maxHeight: 400, overflowY: "auto" }}>

            {/* ── Trade categories ── */}
            {visibleCategories.length > 0 && (
              <>
                <div style={{
                  padding: "8px 14px 5px",
                  fontSize: 11, fontWeight: 700, letterSpacing: "0.10em", textTransform: "uppercase",
                  color: "rgba(168,85,247,0.62)",
                }}>
                  Trade Categories
                </div>
                {visibleCategories.map(cat => (
                  <button
                    key={cat.marketHashName}
                    type="button"
                    onMouseDown={e => { e.preventDefault(); selectItem(cat); }}
                    style={{
                      width: "100%", display: "flex", alignItems: "center", gap: 10,
                      padding: "8px 14px",
                      background: "rgba(168,85,247,0.04)",
                      border: "none", borderBottom: "1px solid rgba(168,85,247,0.08)",
                      cursor: "pointer", textAlign: "left", fontFamily: "inherit",
                      transition: "background 0.1s",
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = "rgba(168,85,247,0.10)"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "rgba(168,85,247,0.04)"; }}
                  >
                    {/* Icon */}
                    <div style={{
                      width: 40, height: 32, flexShrink: 0, borderRadius: 7,
                      background: "rgba(168,85,247,0.08)", border: "1px solid rgba(168,85,247,0.16)",
                      display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
                    }}>
                      <img src={cat.iconUrl} alt={cat.name} style={{ width: "80%", height: "80%", objectFit: "contain" }} />
                    </div>

                    {/* Name */}
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: "rgba(255,255,255,0.90)" }}>
                        {cat.name}
                      </div>
                      <div style={{ fontSize: 10, color: "rgba(168,85,247,0.55)", marginTop: 1 }}>
                        All trade posts offering this
                      </div>
                    </div>

                    {/* Category badge */}
                    <span style={{
                      fontSize: 8.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.10em",
                      padding: "2px 6px", borderRadius: 4, flexShrink: 0,
                      background: "rgba(168,85,247,0.14)", border: "1px solid rgba(168,85,247,0.28)",
                      color: "#c084fc",
                    }}>
                      Category
                    </span>
                  </button>
                ))}
              </>
            )}

            {/* ── Divider between categories and skin results ── */}
            {showDivider && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 14px" }}>
                <div style={{ flex: 1, height: 1, background: "rgba(168,85,247,0.10)" }} />
                <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.09em", textTransform: "uppercase", color: "rgba(255,255,255,0.28)" }}>Exact Skins</span>
                <div style={{ flex: 1, height: 1, background: "rgba(168,85,247,0.10)" }} />
              </div>
            )}

            {/* ── Skin suggestions ── */}
            {showSkins && !loading && suggestions.length === 0 && visibleCategories.length === 0 && (
              <div style={{ padding: "14px 16px", fontSize: 12, color: "rgba(255,255,255,0.28)" }}>
                No results for "{search}"
              </div>
            )}

            {showSkins && suggestions.map((skin, si) => {
              const hasWear = skinHasWear(skin);
              if (!hasWear) {
                if (alreadyAdded(skin.baseName)) return null;
                return (
                  <button key={skin.baseName + si} type="button"
                    onMouseDown={e => { e.preventDefault(); selectItem({ name: skin.baseName, marketHashName: skin.baseName, iconUrl: skin.image || "", exterior: null, rarity: skin.rarity || null }); }}
                    style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", background: "transparent", border: "none", borderBottom: "1px solid rgba(168,85,247,0.08)", cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}
                    onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                  >
                    {skin.image && <img src={skin.image} alt={skin.baseName} style={{ width: 48, height: 36, objectFit: "contain", flexShrink: 0, background: "rgba(255,255,255,0.05)", borderRadius: 5 }} />}
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: "rgba(255,255,255,0.88)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{skin.baseName}</div>
                      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>{skin.rarity?.name || skin.weapon || ""}</div>
                    </div>
                  </button>
                );
              }
              return WEAR_VARIANTS.map(wear => {
                const mhn = `${skin.fullName} (${wear.label})`;
                if (alreadyAdded(mhn)) return null;
                return (
                  <button key={mhn} type="button"
                    onMouseDown={e => { e.preventDefault(); selectItem({ name: mhn, marketHashName: mhn, iconUrl: skin.image || "", exterior: wear.label, rarity: skin.rarity || null }); }}
                    style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", background: "transparent", border: "none", borderBottom: "1px solid rgba(168,85,247,0.08)", cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}
                    onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                  >
                    {skin.image && <img src={skin.image} alt={mhn} style={{ width: 48, height: 36, objectFit: "contain", flexShrink: 0, background: "rgba(255,255,255,0.05)", borderRadius: 5 }} />}
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.88)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{mhn}</div>
                      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.40)", marginTop: 2, display: "flex", alignItems: "center", gap: 4 }}>
                        {skin.rarity?.name && <span style={{ color: skin.rarity.color || "rgba(255,255,255,0.35)" }}>{skin.rarity.name}</span>}
                        {skin.weapon && <><span style={{ color: "rgba(255,255,255,0.18)" }}>·</span><span>{skin.weapon}</span></>}
                      </div>
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 800, color: "#fff", background: wear.color, borderRadius: 4, padding: "2px 7px", flexShrink: 0 }}>{wear.short}</span>
                  </button>
                );
              });
            })}
          </div>
        </div>
      )}
      <style>{`@keyframes sw-spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

/* ─── Mobile breakpoint hook ─────────────────────────────── */
function useIsMobile(bp = 680) {
  const [mobile, setMobile] = useState(
    typeof window !== "undefined" && window.innerWidth <= bp
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${bp}px)`);
    const fn = (e) => setMobile(e.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, [bp]);
  return mobile;
}

/* ─── Score badges for a result card ─────────────── */
function ScoreBadge({ score, label, icon }) {
  if (!score || score <= 0) return null;
  const isHigh = score >= 100;
  const isMid  = score >= 75;
  const color  = isHigh ? "#4ade80" : isMid ? "#c084fc" : "#60a5fa";
  const bg     = isHigh ? "rgba(74,222,128,0.12)" : isMid ? "rgba(168,85,247,0.12)" : "rgba(96,165,250,0.10)";
  const border = isHigh ? "rgba(74,222,128,0.28)"  : isMid ? "rgba(168,85,247,0.28)" : "rgba(96,165,250,0.22)";
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 4,
      padding: "2px 7px", borderRadius: 5,
      background: bg, border: `1px solid ${border}`,
      fontSize: 10, fontWeight: 800, color,
    }}>
      {icon && <span style={{ fontSize: 10.5 }}>{icon}</span>}
      {score}% {label}
    </div>
  );
}

/* ─── Result card ─────────────────────────────────── */
function ResultCard({ post, haveItem, showHaveScore, showOfferScore }) {
  const navigate  = useNavigate();
  const [hov, setHov] = useState(false);
  const isMobile  = useIsMobile();

  const offerScore = post._offerScore    || 0;
  const wantScore  = post._wantScore     || 0;
  const combined   = post._combinedScore || 0;

  const isPerfect   = combined >= 100;
  const displayTime = post.bumpedAt ? `bumped ${timeAgo(post.bumpedAt)}` : timeAgo(post.createdAt);
  const MAX         = 6;

  /* Shared items row — thumbSize differs between mobile and desktop */
  function ItemsRow({ items, label: rowLabel, accent, highlightScore, highlightLabel, thumbSize = 100 }) {
    const shown = (items || []).slice(0, MAX);
    const extra = (items || []).length - MAX;
    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: isMobile ? 8 : 10 }}>
          <div style={{
            fontSize: isMobile ? 11 : 13, fontWeight: 700,
            letterSpacing: "0.08em", textTransform: "uppercase", color: accent,
          }}>
            {rowLabel}
          </div>
          {highlightScore > 0 && <ScoreBadge score={highlightScore} label={highlightLabel} />}
        </div>
        {!items?.length
          ? <div style={{ fontSize: 12, color: "rgba(255,255,255,0.28)", fontStyle: "italic" }}>Any offers</div>
          : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: isMobile ? 6 : 8 }}>
              {shown.map((item, i) => <TradeItemThumb key={i} item={item} size={thumbSize} />)}
              {extra > 0 && (
                <div style={{
                  width: thumbSize, height: thumbSize, borderRadius: 9, flexShrink: 0,
                  background: "rgba(168,85,247,0.06)", border: `1px dashed ${accent}55`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 12, fontWeight: 700, color: accent,
                }}>+{extra}</div>
              )}
            </div>
          )}
      </div>
    );
  }

  /* Shared card chrome */
  const cardBorder = hov && isPerfect ? "rgba(74,222,128,0.40)"
    : hov       ? "rgba(168,85,247,0.30)"
    : isPerfect ? "rgba(74,222,128,0.25)"
    : "rgba(255,255,255,0.07)";

  const cardStyle = {
    background: isPerfect
      ? "linear-gradient(160deg, #0e1a12 0%, #101420 100%)"
      : "linear-gradient(160deg, #131720 0%, #101420 100%)",
    border: `1px solid ${cardBorder}`,
    borderRadius: 16, overflow: "hidden",
    boxShadow: isPerfect && hov
      ? "0 10px 32px rgba(0,0,0,0.55), 0 0 28px rgba(74,222,128,0.12)"
      : hov ? "0 8px 28px rgba(0,0,0,0.45)" : "0 2px 12px rgba(0,0,0,0.30)",
    transition: "all 0.2s ease",
  };

  const accentBar = (
    <div style={{
      height: 2,
      background: `linear-gradient(90deg, transparent, ${
        isPerfect ? "#4ade80" : offerScore >= 75 ? "#c084fc" : "rgba(168,85,247,0.30)"
      } 50%, transparent)`,
      opacity: hov ? 1 : 0.7, transition: "opacity 0.2s",
    }} />
  );

  const messageRow = post.message && (
    <div style={{
      borderTop: "1px solid rgba(168,85,247,0.10)",
      padding: isMobile ? "8px 14px 10px" : "8px 18px 10px",
      fontSize: 11, color: "rgba(255,255,255,0.35)", fontStyle: "italic",
    }}>
      "{post.message}"
    </div>
  );

  /* ────────────────────────────────────────────────────────
     MOBILE layout — full-width stacked, no grid
  ──────────────────────────────────────────────────────── */
  if (isMobile) {
    return (
      <article
        onMouseEnter={() => setHov(true)}
        onMouseLeave={() => setHov(false)}
        style={cardStyle}
      >
        {accentBar}

        <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 0 }}>

          {/* Row 1: Owner identity */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, paddingBottom: 12 }}>
            <Avatar src={post.ownerAvatarUrl} username={post.ownerUsername} size={36} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{
                fontSize: 13.5, fontWeight: 700, color: "rgba(255,255,255,0.92)",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {post.ownerUsername || "Unknown"}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 3 }}>
                <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#10b981", flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.32)" }}>{displayTime}</span>
              </div>
            </div>
            {/* Match scores — top-right of identity row */}
            {((showOfferScore && offerScore > 0) || (showHaveScore && wantScore > 0) || (post._matchedCount || 0) > 1) && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end", flexShrink: 0 }}>
                {showOfferScore && offerScore > 0 && <ScoreBadge score={offerScore} label="offer" />}
                {showHaveScore  && wantScore  > 0 && <ScoreBadge score={wantScore}  label="match" />}
                {(post._matchedCount || 0) > 1 && (
                  <div style={{
                    display: "inline-flex", alignItems: "center", gap: 3,
                    padding: "2px 6px", borderRadius: 4,
                    background: "rgba(168,85,247,0.13)", border: "1px solid rgba(168,85,247,0.28)",
                    fontSize: 9.5, fontWeight: 800, color: "#c084fc",
                  }}>✦ {post._matchedCount}</div>
                )}
              </div>
            )}
          </div>

          {/* Divider */}
          <div style={{ height: 1, background: "rgba(168,85,247,0.10)", marginBottom: 14 }} />

          {/* Row 2: Their Offer */}
          <div style={{ paddingBottom: 14 }}>
            <ItemsRow
              items={post.myOfferItems}
              label="Their Offer"
              accent="#22d3ee"
              highlightScore={showOfferScore ? offerScore : 0}
              highlightLabel={offerScore >= 100 ? "You want this!" : offerScore >= 75 ? "Similar" : offerScore >= 45 ? "Same weapon" : ""}
              thumbSize={76}
            />
          </div>

          {/* Divider */}
          <div style={{ height: 1, background: "rgba(168,85,247,0.08)", marginBottom: 14 }} />

          {/* Row 3: They Want */}
          <div style={{ paddingBottom: 14 }}>
            <ItemsRow
              items={post.lookingForItems}
              label="They Want"
              accent="#c084fc"
              highlightScore={showHaveScore ? wantScore : 0}
              highlightLabel={wantScore >= 100 ? "You have it!" : wantScore >= 75 ? "Similar" : wantScore >= 45 ? "Same weapon" : ""}
              thumbSize={76}
            />
          </div>

          {/* Row 4: Actions */}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => navigate(`/trade/${post.id}`)}
              style={{
                flex: 1, height: 40, padding: "0 10px",
                background: isPerfect
                  ? "rgba(74,222,128,0.14)"
                  : "linear-gradient(135deg, rgba(124,58,237,0.22) 0%, rgba(99,102,241,0.18) 100%)",
                border: `1px solid ${isPerfect ? "rgba(74,222,128,0.32)" : "rgba(139,92,246,0.30)"}`,
                borderRadius: 9, color: isPerfect ? "#4ade80" : "rgba(192,132,252,0.95)",
                fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
              }}
            >
              Open Trade
            </button>
            {post.ownerSteamId && (
              <a
                href={`https://steamcommunity.com/profiles/${post.ownerSteamId}`}
                target="_blank" rel="noopener noreferrer"
                style={{
                  height: 40, padding: "0 16px", borderRadius: 9, flexShrink: 0,
                  background: "transparent", border: "1px solid rgba(255,255,255,0.09)",
                  color: "rgba(255,255,255,0.35)", fontSize: 12, fontWeight: 600,
                  textDecoration: "none", display: "flex", alignItems: "center",
                }}
              >
                Steam ↗
              </a>
            )}
          </div>
        </div>

        {messageRow}
      </article>
    );
  }

  /* ────────────────────────────────────────────────────────
     DESKTOP layout — 5-column grid, unchanged
  ──────────────────────────────────────────────────────── */
  return (
    <article
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={cardStyle}
    >
      {accentBar}

      <div className="src-grid" style={{ padding: "18px 24px", display: "grid", gridTemplateColumns: "172px 1fr 30px 1fr 160px", gap: 20, alignItems: "start" }}>

        {/* Owner + scores */}
        <div style={{ display: "flex", flexDirection: "column", gap: 7, paddingTop: 2 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Avatar src={post.ownerAvatarUrl} username={post.ownerUsername} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: "rgba(255,255,255,0.90)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {post.ownerUsername || "Unknown"}
              </div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.28)", marginTop: 1 }}>wants to trade</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#10b981", boxShadow: "0 0 4px #10b981" }} />
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.28)" }}>{displayTime}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {showOfferScore && offerScore > 0 && <ScoreBadge score={offerScore} label="offer" icon="📦" />}
            {showHaveScore  && wantScore  > 0 && <ScoreBadge score={wantScore}  label="match" icon="🎯" />}
            {(post._matchedCount || 0) > 1 && (
              <div style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                padding: "2px 7px", borderRadius: 5,
                background: "rgba(168,85,247,0.13)", border: "1px solid rgba(168,85,247,0.28)",
                fontSize: 10, fontWeight: 800, color: "#c084fc",
              }}>✦ {post._matchedCount} items match</div>
            )}
          </div>
        </div>

        {/* Their Offer */}
        <ItemsRow
          items={post.myOfferItems}
          label="Their Offer"
          accent="#22d3ee"
          highlightScore={showOfferScore ? offerScore : 0}
          highlightLabel={offerScore >= 100 ? "You want this!" : offerScore >= 75 ? "Similar" : offerScore >= 45 ? "Same weapon" : ""}
        />

        {/* Arrows */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5, paddingTop: 20 }}>
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="rgba(168,85,247,0.55)" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4" />
          </svg>
          <div style={{ width: 1, height: 10, background: "rgba(168,85,247,0.20)" }} />
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="rgba(168,85,247,0.55)" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 8v12m0 0l4-4m-4 4l-4-4" />
          </svg>
        </div>

        {/* They Want */}
        <ItemsRow
          items={post.lookingForItems}
          label="They Want"
          accent="#c084fc"
          highlightScore={showHaveScore ? wantScore : 0}
          highlightLabel={wantScore >= 100 ? "You have it!" : wantScore >= 75 ? "Similar" : wantScore >= 45 ? "Same weapon" : ""}
        />

        {/* Actions */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <button
            onClick={() => navigate(`/trade/${post.id}`)}
            style={{
              height: 34, padding: "0 10px", width: "100%",
              background: isPerfect
                ? "rgba(74,222,128,0.14)"
                : "linear-gradient(135deg, rgba(124,58,237,0.22) 0%, rgba(99,102,241,0.18) 100%)",
              border: `1px solid ${isPerfect ? "rgba(74,222,128,0.32)" : "rgba(139,92,246,0.30)"}`,
              borderRadius: 8, color: isPerfect ? "#4ade80" : "rgba(192,132,252,0.92)",
              fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", transition: "opacity 0.15s",
            }}
            onMouseEnter={e => { e.currentTarget.style.opacity = "0.85"; }}
            onMouseLeave={e => { e.currentTarget.style.opacity = "1"; }}
          >
            Open Trade
          </button>
          <button
            onClick={() => navigate(`/trade/${post.id}`)}
            style={{
              height: 28, padding: "0 10px", width: "100%",
              background: "rgba(34,211,238,0.06)", border: "1px solid rgba(34,211,238,0.16)",
              borderRadius: 8, color: "rgba(34,211,238,0.75)", fontSize: 11, fontWeight: 600,
              cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s",
            }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(34,211,238,0.12)"; e.currentTarget.style.color = "#22d3ee"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "rgba(34,211,238,0.06)"; e.currentTarget.style.color = "rgba(34,211,238,0.75)"; }}
          >
            Reply with Offer
          </button>
          {post.ownerSteamId && (
            <a href={`https://steamcommunity.com/profiles/${post.ownerSteamId}`} target="_blank" rel="noopener noreferrer"
              style={{ height: 24, padding: "0 10px", background: "transparent", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 6, color: "rgba(255,255,255,0.28)", fontSize: 10, fontWeight: 600, textDecoration: "none", display: "flex", alignItems: "center", justifyContent: "center" }}>
              Steam ↗
            </a>
          )}
        </div>
      </div>

      {messageRow}
    </article>
  );
}

/* ═══════════════════════════════════════════════════
   SearchTradesTab — main export
═══════════════════════════════════════════════════ */
export default function SearchTradesTab({ inventory }) {
  const [haveItem,      setHaveItem]      = useState(null);  // selected inventory item
  const [wantItems,     setWantItems]     = useState([]);    // multi-select "I want" list
  const [showInvPicker, setShowInvPicker] = useState(false);
  const [results,      setResults]      = useState([]);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState(null);
  const [searched,     setSearched]     = useState(false); // whether a search has been run
  const [activeTab,    setActiveTab]    = useState("all");

  const haveBoxRef = useRef(null);

  // Close inv picker when clicking outside
  useEffect(() => {
    function handler(e) {
      if (haveBoxRef.current && !haveBoxRef.current.contains(e.target)) {
        setShowInvPicker(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Determine search mode
  const mode = haveItem && wantItems.length > 0 ? "dual"
    : wantItems.length > 0 ? "want_only"
    : haveItem             ? "have_only"
    : "none";

  const canSearch = mode !== "none";

  async function doSearch() {
    if (!canSearch) return;
    setLoading(true);
    setError(null);
    setSearched(true);
    setActiveTab("all");

    try {
      let res;
      if (mode === "have_only") {
        // Existing endpoint: who wants what I have
        res = await api.get("/trades/search-matches", { params: { assetid: haveItem.assetId } });
        if (!res.data.ok) throw new Error(res.data.error);
        setResults((res.data.posts || []).map(p => ({
          ...p,
          _offerScore: 0, _wantScore: 100, _combinedScore: 100,
          _matchType: "want_exact", _matchedCount: 0,
        })));
      } else {
        // New endpoint: want-based search (supports multiple wanted items)
        const params = { want: wantItems.map(i => i.marketHashName).join(",") };
        if (haveItem) params.have_assetid = haveItem.assetId;
        res = await api.get("/trades/search-by-want", { params });
        if (!res.data.ok) throw new Error(res.data.error);
        setResults(res.data.posts || []);
      }
    } catch (err) {
      setError(err?.response?.data?.error || err.message || "Search failed.");
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  // Filter results by active tab
  const filteredResults = useMemo(() => {
    if (activeTab === "perfect") return results.filter(p => (p._combinedScore || 0) >= 100);
    if (activeTab === "offer")   return results.filter(p => (p._offerScore  || 0) > 0);
    if (activeTab === "want")    return results.filter(p => (p._wantScore   || 0) > 0);
    return results;
  }, [results, activeTab]);

  const perfectCount = useMemo(() => results.filter(p => (p._combinedScore || 0) >= 100).length, [results]);
  const offerCount   = useMemo(() => results.filter(p => (p._offerScore    || 0) > 0).length,    [results]);
  const wantCount    = useMemo(() => results.filter(p => (p._wantScore     || 0) > 0).length,    [results]);

  const hasInventory = (inventory?.length || 0) > 0;

  const showOfferScore = mode === "dual" || mode === "want_only";
  const showHaveScore  = mode === "dual" || mode === "have_only";

  // Mode label shown above results
  const wantNames = wantItems.map(i => (i.name || i.marketHashName || "").split("(")[0].trim()).join(", ");
  const modeDesc = mode === "dual"
    ? `Trades where they offer any of [${wantNames}] and want your "${haveItem?.name?.split("(")[0].trim()}"`
    : mode === "want_only"
    ? `Trades where they offer any of: ${wantNames}`
    : mode === "have_only"
    ? `Trades looking for "${haveItem?.name?.split("(")[0].trim()}"`
    : "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* ── Search panel ──────────────────────────────── */}
      <div style={{
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(168,85,247,0.18)",
        borderRadius: 16, padding: "18px 20px",
        display: "flex", flexDirection: "column", gap: 16,
      }}>

        {/* Two input fields */}
        <div className="trade-search-inputs" style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 12, alignItems: "start" }}>

          {/* I Have */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: "#22d3ee", marginBottom: 8 }}>
              I Have
              <span style={{ marginLeft: 5, fontSize: 10.5, fontWeight: 500, color: "rgba(255,255,255,0.32)", textTransform: "none", letterSpacing: 0 }}>
                (from my inventory)
              </span>
            </div>
            <div ref={haveBoxRef} style={{ position: "relative" }}>
              {haveItem ? (
                <ItemPill item={haveItem} onRemove={() => { setHaveItem(null); setShowInvPicker(false); }} />
              ) : (
                <button
                  onClick={() => setShowInvPicker(v => !v)}
                  disabled={!hasInventory}
                  style={{
                    width: "100%", height: 38, padding: "0 12px",
                    background: showInvPicker ? "rgba(34,211,238,0.10)" : "rgba(255,255,255,0.04)",
                    border: `1px solid ${showInvPicker ? "rgba(34,211,238,0.35)" : "rgba(255,255,255,0.09)"}`,
                    borderRadius: 9, cursor: hasInventory ? "pointer" : "not-allowed",
                    fontSize: 12.5, fontWeight: 500, fontFamily: "inherit",
                    color: hasInventory ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.22)",
                    display: "flex", alignItems: "center", gap: 7,
                    transition: "all 0.15s",
                  }}
                >
                  <svg width={14} height={14} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
                    <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
                  </svg>
                  {hasInventory ? `Select from inventory (${inventory.length})` : "No inventory synced"}
                  <svg width={10} height={10} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ marginLeft: "auto", transform: showInvPicker ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              )}
              {showInvPicker && !haveItem && (
                <InventoryPicker
                  inventory={inventory}
                  selectedItem={haveItem}
                  onSelect={setHaveItem}
                  onClose={() => setShowInvPicker(false)}
                />
              )}
            </div>
          </div>

          {/* Center divider */}
          <div className="trade-search-divider" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", paddingBottom: 4, gap: 3 }}>
            <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="rgba(168,85,247,0.45)" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4" />
            </svg>
            <div style={{ width: 1, height: 8, background: "rgba(168,85,247,0.20)" }} />
            <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="rgba(168,85,247,0.45)" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 8v12m0 0l4-4m-4 4l-4-4" />
            </svg>
          </div>

          {/* I Want */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: "#c084fc", marginBottom: 8 }}>
              I Want
              <span style={{ marginLeft: 5, fontSize: 10.5, fontWeight: 500, color: "rgba(255,255,255,0.32)", textTransform: "none", letterSpacing: 0 }}>
                (any CS2 skin)
              </span>
            </div>
            <WantSearch
              wantItems={wantItems}
              onAdd={item => {
                if (!wantItems.some(w => w.marketHashName === item.marketHashName)) {
                  setWantItems(prev => [...prev, item]);
                }
              }}
              onRemove={mhn => setWantItems(prev => prev.filter(w => w.marketHashName !== mhn))}
            />
          </div>
        </div>

        {/* Search button + hint */}
        <div className="trade-search-cta" style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            onClick={doSearch}
            disabled={!canSearch || loading}
            style={{
              height: 38, padding: "0 24px",
              background: canSearch && !loading
                ? "linear-gradient(135deg, #7c3aed, #6366f1)"
                : "rgba(255,255,255,0.06)",
              border: "none", borderRadius: 9,
              color: canSearch && !loading ? "#fff" : "rgba(255,255,255,0.25)",
              fontSize: 13, fontWeight: 700, cursor: canSearch && !loading ? "pointer" : "not-allowed",
              fontFamily: "inherit", transition: "opacity 0.15s",
              boxShadow: canSearch && !loading ? "0 4px 16px rgba(99,102,241,0.35)" : "none",
              display: "flex", alignItems: "center", gap: 7,
            }}
            onMouseEnter={e => { if (canSearch && !loading) e.currentTarget.style.opacity = "0.90"; }}
            onMouseLeave={e => { e.currentTarget.style.opacity = "1"; }}
          >
            {loading ? (
              <>
                <svg width={14} height={14} viewBox="0 0 32 32" fill="none" style={{ animation: "sw-spin 0.8s linear infinite", flexShrink: 0 }}>
                  <circle cx="16" cy="16" r="12" stroke="rgba(255,255,255,0.25)" strokeWidth="3" />
                  <path d="M16 4 A12 12 0 0 1 28 16" stroke="white" strokeWidth="3" strokeLinecap="round" />
                </svg>
                Searching…
              </>
            ) : (
              <>
                <svg width={14} height={14} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                Find Trades
              </>
            )}
          </button>

          {/* Context hint */}
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.28)", lineHeight: 1.5 }}>
            {mode === "dual" && `Finding trades where they offer any of your ${wantItems.length} wanted item${wantItems.length !== 1 ? "s" : ""} and want your item.`}
            {mode === "want_only" && `Finding all trades offering any of your ${wantItems.length} wanted item${wantItems.length !== 1 ? "s" : ""}. Add "I Have" to narrow down.`}
            {mode === "have_only" && "Finding trades that want your item. Add \"I Want\" to narrow down."}
            {mode === "none" && (
              <span>Select at least one field to search. <span style={{ color: "#c084fc" }}>Both fields = best results.</span></span>
            )}
          </div>
        </div>
      </div>

      {/* ── Results ───────────────────────────────────── */}
      {searched && !loading && !error && (
        <>
          {/* Mode + count header */}
          {results.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", margin: 0, lineHeight: 1.5, maxWidth: 560 }}>
                {modeDesc}
              </p>
              <span style={{ fontSize: 11.5, color: "rgba(255,255,255,0.25)", fontVariantNumeric: "tabular-nums" }}>
                {results.length} result{results.length !== 1 ? "s" : ""}
              </span>
            </div>
          )}

          {/* Tab filter */}
          {results.length > 0 && (
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {[
                { value: "all",     label: "All",               count: results.length },
                { value: "perfect", label: "Perfect Match",     count: perfectCount,   color: "#4ade80", activeBg: "rgba(74,222,128,0.14)",  activeBorder: "rgba(74,222,128,0.32)",  activeColor: "#4ade80" },
                ...(showOfferScore ? [{ value: "offer", label: "They Offer My Want", count: offerCount, color: "#22d3ee", activeBg: "rgba(34,211,238,0.12)", activeBorder: "rgba(34,211,238,0.28)", activeColor: "#22d3ee" }] : []),
                ...(showHaveScore  ? [{ value: "want",  label: "They Want My Have",  count: wantCount,  color: "#c084fc", activeBg: "rgba(168,85,247,0.13)", activeBorder: "rgba(168,85,247,0.30)", activeColor: "#c084fc" }] : []),
              ].map(f => {
                const active = activeTab === f.value;
                const aBg  = f.activeBg     || "rgba(255,255,255,0.10)";
                const aBdr = f.activeBorder || "rgba(255,255,255,0.18)";
                const aCl  = f.activeColor  || "rgba(255,255,255,0.80)";
                return (
                  <button
                    key={f.value}
                    onClick={() => setActiveTab(f.value)}
                    style={{
                      height: 30, padding: "0 12px", borderRadius: 20,
                      fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                      background: active ? aBg : "rgba(255,255,255,0.04)",
                      border: `1px solid ${active ? aBdr : "rgba(255,255,255,0.07)"}`,
                      color: active ? aCl : "rgba(255,255,255,0.38)",
                      transition: "all 0.15s", display: "flex", alignItems: "center", gap: 5,
                    }}
                  >
                    {f.label}
                    {f.count > 0 && (
                      <span style={{
                        fontSize: 10, fontWeight: 800, minWidth: 16, height: 16, borderRadius: 8,
                        background: active ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.07)",
                        color: active ? aCl : "rgba(255,255,255,0.30)",
                        display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px",
                      }}>
                        {f.count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Empty state */}
          {results.length === 0 && (
            <div style={{ textAlign: "center", padding: "60px 0" }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: "rgba(255,255,255,0.30)", marginBottom: 6 }}>
                No trade posts found
              </div>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.18)" }}>
                Try adjusting your search — or{" "}
                <span style={{ color: "#c084fc" }}>browse the Trade Board</span> for more posts.
              </div>
            </div>
          )}

          {/* Filtered empty state */}
          {results.length > 0 && filteredResults.length === 0 && (
            <div style={{ textAlign: "center", padding: "32px 0" }}>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.28)" }}>No results in this filter.</div>
            </div>
          )}

          {/* Results list */}
          {filteredResults.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {filteredResults.map(post => (
                <ResultCard
                  key={post.id}
                  post={post}
                  haveItem={haveItem}
                  showOfferScore={showOfferScore}
                  showHaveScore={showHaveScore}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Error */}
      {error && (
        <div style={{ textAlign: "center", padding: "32px 0", color: "#f87171", fontSize: 13 }}>{error}</div>
      )}

      {/* Initial empty state */}
      {!searched && !loading && (
        <div style={{ textAlign: "center", padding: "64px 0" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.25)", marginBottom: 8 }}>
            Precise Trade Search
          </div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.15)", lineHeight: 1.7 }}>
            Fill in "I Have" and/or "I Want" above,<br />
            then click <span style={{ color: "#c084fc" }}>Find Trades</span>.
          </div>
        </div>
      )}

      <style>{`
        /* ── Desktop: nothing to override, defaults are fine ── */

        /* ── Tablet / small desktop (≤900px): tighten result card ── */
        @media (max-width: 900px) {
          .src-grid {
            grid-template-columns: 160px 1fr 24px 1fr 120px !important;
            gap: 12px !important;
            padding: 14px 16px !important;
          }
        }

        /* ── Mobile (≤680px): stack result card vertically ── */
        @media (max-width: 680px) {
          .src-grid {
            grid-template-columns: 1fr !important;
            gap: 14px !important;
            padding: 14px 16px !important;
          }
          .src-arrows { display: none !important; }
          /* Mobile item row: smaller thumbnails to fit viewport */
          .src-items-row {
            gap: 6px !important;
          }
        }

        /* ── Mobile search panel (≤640px): stack I Have / I Want ── */
        @media (max-width: 640px) {
          .trade-search-inputs {
            grid-template-columns: 1fr !important;
          }
          .trade-search-divider { display: none !important; }
          .trade-search-cta {
            flex-direction: column !important;
            align-items: stretch !important;
            gap: 10px !important;
          }
          .trade-search-cta > button {
            width: 100% !important;
            justify-content: center !important;
          }
        }
      `}</style>
    </div>
  );
}
