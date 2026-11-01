import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import api from "../../lib/api";
import useAuth from "../../hooks/useAuth";
import useSkinSuggestions from "../../hooks/useSkinSuggestions";
import TradePostCard from "./TradePostCard";
import TradeItemCard, { TradeItemThumb, resolveItemIcon } from "./TradeItemCard";
import DevTradeMatchTest from "./DevTradeMatchTest";
import SearchTradesTab from "./SearchTradesTab";
import { sortedByMatch, MATCH_TIERS } from "../../utils/tradeMatch";
import useTradeUnreadCount from "../../hooks/useTradeUnreadCount";

import anyKnifeImg  from "../../assets/any_knife.png";
import anyKeyImg    from "../../assets/any_key.png";
import anyCaseImg   from "../../assets/any_case.png";
import anyOffersImg from "../../assets/any_offers.png";
import realMoneyImg from "../../assets/real_money.png";

/* ─── Special items ──────────────────────────────────── */
const SPECIAL_ITEMS = [
  { name:"Any Knife",  marketHashName:"Any Knife",  iconUrl:anyKnifeImg,  isSpecial:true, rarity:{ name:"Covert",          color:"#eb4b4b" } },
  { name:"Any Key",    marketHashName:"Any Key",    iconUrl:anyKeyImg,    isSpecial:true, rarity:{ name:"Industrial Grade", color:"#5e98d9" } },
  { name:"Any Case",   marketHashName:"Any Case",   iconUrl:anyCaseImg,   isSpecial:true, rarity:{ name:"Base Grade",       color:"#b0c3d9" } },
  { name:"Any Offers", marketHashName:"Any Offers", iconUrl:anyOffersImg, isSpecial:true, rarity:null },
  { name:"Real Money", marketHashName:"Real Money", iconUrl:realMoneyImg, isSpecial:true, rarity:null },
];

function timeAgo(iso) {
  if (!iso) return "";
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60_000), h = Math.floor(m / 60), day = Math.floor(h / 24);
  if (day > 0) return `${day}d ago`;
  if (h   > 0) return `${h}h ago`;
  if (m   > 0) return `${m}m ago`;
  return "just now";
}

/* ─── Input helper (dark) ────────────────────────────── */
const inputStyle = {
  height: 36, padding: "0 12px 0 32px", width: "100%",
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(168,85,247,0.18)",
  borderRadius: 8,
  color: "rgba(255,255,255,0.88)", fontSize: 12.5, outline: "none", fontFamily: "inherit",
  boxSizing: "border-box",
};

/* ═══════════════════════════════════════════════════════
   Preview row — shows selected items horizontally
═══════════════════════════════════════════════════════ */
function PreviewRow({ offerItems, lookingFor, onRemoveOffer, onRemoveLooking }) {
  return (
    <div className="trade-modal-preview" style={{
      display: "flex", alignItems: "stretch", gap: 0,
      borderBottom: "1px solid rgba(168,85,247,0.12)",
      background: "rgba(255,255,255,0.02)",
      minHeight: 128, flexShrink: 0,
    }}>
      {/* Left: My Offer */}
      <div className="trade-modal-preview-left" style={{ flex: 1, padding: "12px 14px", borderRight: "1px solid rgba(168,85,247,0.10)", minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "#22d3ee", marginBottom: 8 }}>
          My Offer
          {offerItems.length > 0 && (
            <span style={{ marginLeft: 6, background: "rgba(34,211,238,0.10)", border: "1px solid rgba(34,211,238,0.25)", borderRadius: 4, padding: "1px 6px", fontSize: 10.5, color: "#22d3ee" }}>
              {offerItems.length}
            </span>
          )}
        </div>
        {offerItems.length === 0 ? (
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.28)" }}>Select from inventory or add special items below →</div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {offerItems.map((item, i) => (
              <TradeItemCard key={i} item={item} onRemove={() => onRemoveOffer(item)} />
            ))}
          </div>
        )}
      </div>

      {/* Center: arrows */}
      <div className="trade-modal-arrows" style={{ width: 44, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, flexShrink: 0, background: "rgba(255,255,255,0.01)" }}>
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="rgba(168,85,247,0.55)" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4" />
        </svg>
        <div style={{ width: 1, height: 10, background: "rgba(168,85,247,0.20)" }} />
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="rgba(168,85,247,0.55)" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M17 8v12m0 0l4-4m-4 4l-4-4" />
        </svg>
      </div>

      {/* Right: Looking For */}
      <div style={{ flex: 1, padding: "12px 14px", borderLeft: "1px solid rgba(168,85,247,0.10)", minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "#c084fc", marginBottom: 8 }}>
          Looking For
          {lookingFor.length > 0 && (
            <span style={{ marginLeft: 6, background: "rgba(168,85,247,0.12)", border: "1px solid rgba(168,85,247,0.28)", borderRadius: 4, padding: "1px 6px", fontSize: 10.5, color: "#c084fc" }}>
              {lookingFor.length}
            </span>
          )}
        </div>
        {lookingFor.length === 0 ? (
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.28)" }}>Search or pick special items below →</div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {lookingFor.map((item, i) => (
              <TradeItemCard key={i} item={item} onRemove={() => onRemoveLooking(item.marketHashName)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   Inventory browser (left panel of modal bottom)
═══════════════════════════════════════════════════════ */
function InventoryPanel({ inventory, selected, onToggle }) {
  const [search, setSearch] = useState("");

  const displayed = inventory.filter(item => {
    if (!search.trim()) return true;
    const n = (item.name || item.marketHashName || "").toLowerCase();
    return n.includes(search.toLowerCase());
  });

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 10 }}>

      {/* Quick Add: special items */}
      <div style={{ flexShrink: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "rgba(255,255,255,0.40)", marginBottom: 7 }}>
          Quick Add
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
          {SPECIAL_ITEMS.map(s => {
            const isAdded = selected.some(i => i.marketHashName === s.marketHashName);
            return (
              <div key={s.marketHashName} onClick={() => onToggle(s)} style={{ cursor: "pointer" }}>
                <TradeItemCard item={s} selected={isAdded} />
              </div>
            );
          })}
        </div>
      </div>

      {/* Divider */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <div style={{ flex: 1, height: 1, background: "rgba(168,85,247,0.12)" }} />
        <span style={{ fontSize: 11, fontWeight: 600, color: "rgba(168,85,247,0.50)", letterSpacing: "0.06em", textTransform: "uppercase" }}>My Inventory</span>
        <div style={{ flex: 1, height: 1, background: "rgba(168,85,247,0.12)" }} />
      </div>

      {/* Search bar */}
      <div style={{ position: "relative", flexShrink: 0 }}>
        <svg style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}
          width={13} height={13} fill="none" viewBox="0 0 24 24" stroke="rgba(168,85,247,0.5)" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={inventory.length === 0 ? "No synced inventory — use Chrome extension" : `Search ${inventory.length} items…`}
          disabled={inventory.length === 0}
          style={{ ...inputStyle, padding: "0 12px 0 32px" }}
          className="placeholder:text-white/20"
        />
      </div>

      {/* Item grid */}
      <div style={{
        flex: 1, overflowY: "auto", minHeight: 0,
        display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(90px, 1fr))", gap: 8,
        paddingRight: 2,
      }}>
        {inventory.length === 0 ? (
          <div style={{ gridColumn: "1/-1", padding: "24px 0", textAlign: "center", fontSize: 12, color: "rgba(255,255,255,0.28)", lineHeight: 1.8 }}>
            Import your CS2 inventory<br />via the SKINTEL Chrome extension.
          </div>
        ) : displayed.length === 0 ? (
          <div style={{ gridColumn: "1/-1", padding: "24px 0", textAlign: "center", fontSize: 12, color: "rgba(255,255,255,0.28)" }}>
            No items match "{search}"
          </div>
        ) : displayed.map((item) => {
          const isSel = selected.some(s => s.assetId === item.assetId);
          return (
            <div key={item.assetId || item.itemId || item.id} onClick={() => onToggle(item)} style={{ cursor: "pointer" }}>
              <TradeItemCard item={item} selected={isSel} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Wear variant helpers ───────────────────────────────────── */

const WEAR_VARIANTS = [
  { label: "Factory New",    short: "FN", color: "#22c55e" },
  { label: "Minimal Wear",   short: "MW", color: "#86efac" },
  { label: "Field-Tested",   short: "FT", color: "#ca8a04" },
  { label: "Well-Worn",      short: "WW", color: "#f97316" },
  { label: "Battle-Scarred", short: "BS", color: "#ef4444" },
];

const NO_WEAR_RE = /^(sticker|case|souvenir|music\s*kit|graffiti|sealed\s*graffiti|agent|patch|pin|autograph)/i;

function skinHasWear(suggestion) {
  const baseName = suggestion.baseName || "";
  const weapon   = suggestion.weapon   || baseName.split(" | ")[0] || "";
  const skin     = suggestion.skin     || (baseName.includes(" | ") ? baseName.split(" | ").slice(1).join(" | ") : "");
  if (!weapon || !skin) return false;
  if (NO_WEAR_RE.test(weapon.trim())) return false;
  return true;
}

/* ═══════════════════════════════════════════════════════
   Looking For panel — skin search + wear variants
═══════════════════════════════════════════════════════ */
function LookingForPanel({ added, onAdd, onRemove }) {
  const inputRef    = useRef(null);
  const dropdownRef = useRef(null);
  const [search, setSearch]             = useState("");
  const [showDropdown, setShowDropdown] = useState(false);

  const { suggestions, loading: sugLoading } = useSkinSuggestions(search);

  useEffect(() => {
    function handler(e) {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target) &&
        inputRef.current    && !inputRef.current.contains(e.target)
      ) setShowDropdown(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function selectAndAdd(variant) {
    const mhn = variant.marketHashName;
    if (added.some(a => a.marketHashName === mhn)) {
      setSearch(""); setShowDropdown(false); return;
    }
    console.log("[trade:lf] adding:", mhn, "| exterior:", variant.exterior || "any");
    onAdd({
      name:           mhn,
      marketHashName: mhn,
      iconUrl:        variant.image || "",
      exterior:       variant.exterior || null,
      rarity:         variant.rarity  || null,
      isSpecial:      false,
    });
    setSearch(""); setShowDropdown(false);
  }

  function toggleSpecial(s) {
    if (added.find(a => a.marketHashName === s.marketHashName)) {
      onRemove(s.marketHashName);
    } else {
      console.log("[trade:lf] adding special:", s.name);
      onAdd(s);
    }
  }

  const hasSuggestions = suggestions.length > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

      {/* Quick Add specials */}
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(255,255,255,0.35)", marginBottom: 8 }}>
          Quick Add
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
          {SPECIAL_ITEMS.map(s => {
            const isAdded = added.some(a => a.marketHashName === s.marketHashName);
            return (
              <div key={s.name} onClick={() => toggleSpecial(s)} style={{ cursor: "pointer" }}>
                <TradeItemCard item={s} selected={isAdded} />
              </div>
            );
          })}
        </div>
      </div>

      {/* Skin search */}
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(255,255,255,0.35)", marginBottom: 8 }}>
          Search CS2 Skins
        </div>

        <div style={{ position: "relative" }}>
          <div style={{ position: "relative" }}>
            <svg style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}
              width={13} height={13} fill="none" viewBox="0 0 24 24" stroke="rgba(168,85,247,0.5)" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              ref={inputRef}
              value={search}
              onChange={e => { setSearch(e.target.value); setShowDropdown(true); }}
              onFocus={() => setShowDropdown(true)}
              placeholder="AK-47 Redline, Karambit…"
              style={{ ...inputStyle, padding: "0 12px 0 32px" }}
              className="placeholder:text-white/20"
            />
            {sugLoading && (
              <div style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)" }}>
                <svg width={13} height={13} viewBox="0 0 32 32" fill="none" style={{ animation: "trade-spin 0.8s linear infinite" }}>
                  <circle cx="16" cy="16" r="12" stroke="rgba(168,85,247,0.25)" strokeWidth="3" />
                  <path d="M16 4 A12 12 0 0 1 28 16" stroke="#a855f7" strokeWidth="3" strokeLinecap="round" />
                </svg>
              </div>
            )}
          </div>

          {/* Dropdown — dark */}
          {showDropdown && search.trim().length >= 2 && (
            <div
              ref={dropdownRef}
              style={{
                position: "absolute", zIndex: 300, top: "calc(100% + 4px)", left: 0, right: 0,
                background: "#130f22",
                border: "1px solid rgba(168,85,247,0.25)",
                borderRadius: 12,
                boxShadow: "0 16px 48px rgba(0,0,0,0.7), 0 0 0 1px rgba(168,85,247,0.08)",
                overflow: "hidden",
              }}
            >
              {sugLoading && !hasSuggestions ? (
                <div style={{ padding: "14px 16px", fontSize: 12, color: "rgba(255,255,255,0.40)" }}>Searching…</div>
              ) : !hasSuggestions ? (
                <div style={{ padding: "14px 16px", fontSize: 12, color: "rgba(255,255,255,0.28)" }}>No results for "{search}"</div>
              ) : (
                <div style={{ maxHeight: 420, overflowY: "auto" }}>
                  {suggestions.map((skin, si) => {
                    const hasWear = skinHasWear(skin);

                    if (!hasWear) {
                      const isAdded = added.some(a => a.marketHashName === skin.baseName);
                      return (
                        <button
                          key={skin.baseName + si}
                          type="button"
                          onMouseDown={e => { e.preventDefault(); selectAndAdd({ ...skin, marketHashName: skin.baseName, exterior: null }); }}
                          style={{
                            width: "100%", display: "flex", alignItems: "center", gap: 10,
                            padding: "9px 14px", textAlign: "left", cursor: "pointer",
                            background: isAdded ? "rgba(168,85,247,0.12)" : "transparent",
                            border: "none", borderBottom: "1px solid rgba(168,85,247,0.08)",
                            fontFamily: "inherit", transition: "background 0.1s", boxSizing: "border-box",
                          }}
                          onMouseEnter={e => { if (!isAdded) e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
                          onMouseLeave={e => { e.currentTarget.style.background = isAdded ? "rgba(168,85,247,0.12)" : "transparent"; }}
                        >
                          {skin.image
                            ? <img src={skin.image} alt={skin.baseName} style={{ width: 48, height: 36, objectFit: "contain", flexShrink: 0, background: "rgba(255,255,255,0.05)", borderRadius: 5 }} />
                            : <div style={{ width: 48, height: 36, background: "rgba(255,255,255,0.05)", borderRadius: 5, flexShrink: 0 }} />
                          }
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: 12.5, fontWeight: 600, color: "rgba(255,255,255,0.88)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {skin.baseName}
                            </div>
                            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>
                              {skin.rarity?.name || skin.weapon || ""}
                            </div>
                          </div>
                          {isAdded && <span style={{ fontSize: 10.5, fontWeight: 700, color: "#c084fc", background: "rgba(168,85,247,0.14)", padding: "2px 7px", borderRadius: 5, flexShrink: 0 }}>Added</span>}
                        </button>
                      );
                    }

                    return WEAR_VARIANTS.map(wear => {
                      const mhn     = `${skin.fullName} (${wear.label})`;
                      const isAdded = added.some(a => a.marketHashName === mhn);
                      return (
                        <button
                          key={mhn}
                          type="button"
                          onMouseDown={e => {
                            e.preventDefault();
                            selectAndAdd({ ...skin, marketHashName: mhn, exterior: wear.label });
                          }}
                          style={{
                            width: "100%", display: "flex", alignItems: "center", gap: 10,
                            padding: "9px 14px", textAlign: "left", cursor: "pointer",
                            background: isAdded ? "rgba(168,85,247,0.12)" : skin.isStatTrak ? "rgba(249,115,22,0.04)" : "transparent",
                            border: "none", borderBottom: "1px solid rgba(168,85,247,0.08)",
                            fontFamily: "inherit", transition: "background 0.1s", boxSizing: "border-box",
                          }}
                          onMouseEnter={e => { if (!isAdded) e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
                          onMouseLeave={e => { e.currentTarget.style.background = isAdded ? "rgba(168,85,247,0.12)" : skin.isStatTrak ? "rgba(249,115,22,0.04)" : "transparent"; }}
                        >
                          {skin.image
                            ? <img src={skin.image} alt={mhn} style={{ width: 48, height: 36, objectFit: "contain", flexShrink: 0, background: "rgba(255,255,255,0.05)", borderRadius: 5 }} />
                            : <div style={{ width: 48, height: 36, background: "rgba(255,255,255,0.05)", borderRadius: 5, flexShrink: 0 }} />
                          }

                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.88)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {mhn}
                            </div>
                            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.38)", marginTop: 2, display: "flex", alignItems: "center", gap: 4 }}>
                              {skin.rarity?.name && (
                                <span style={{ color: skin.rarity.color || "rgba(255,255,255,0.35)" }}>{skin.rarity.name}</span>
                              )}
                              {skin.rarity?.name && skin.weapon && <span style={{ color: "rgba(255,255,255,0.18)" }}>·</span>}
                              {skin.weapon && <span>{skin.weapon}</span>}
                            </div>
                          </div>

                          <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                            {isAdded && (
                              <span style={{ fontSize: 10.5, fontWeight: 700, color: "#c084fc", background: "rgba(168,85,247,0.14)", padding: "2px 5px", borderRadius: 4 }}>
                                Added
                              </span>
                            )}
                            {skin.isStatTrak && (
                              <span style={{ fontSize: 10.5, fontWeight: 800, color: "#fff", background: "#f97316", borderRadius: 4, padding: "2px 5px", letterSpacing: "0.02em" }}>
                                ST
                              </span>
                            )}
                            <span style={{
                              fontSize: 10, fontWeight: 800, color: "#fff",
                              background: wear.color, borderRadius: 4,
                              padding: "2px 7px", minWidth: 26, textAlign: "center", letterSpacing: "0.02em",
                            }}>
                              {wear.short}
                            </span>
                          </div>
                        </button>
                      );
                    });
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.28)", marginTop: 7 }}>
          Weapon skins show all 5 wear variants — click any to add it
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   Create Trade Modal — dark glass
═══════════════════════════════════════════════════════ */
function CreateTradeModal({ inventory, onClose, onCreated }) {
  const [offerItems, setOfferItems] = useState([]);
  const [lookingFor, setLookingFor] = useState([]);
  const [message,    setMessage]    = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState(null);

  function toggleOffer(item) {
    if (item.isSpecial) {
      const mhn = item.marketHashName;
      if (offerItems.find(i => i.marketHashName === mhn)) {
        setOfferItems(prev => prev.filter(i => i.marketHashName !== mhn));
      } else {
        setOfferItems(prev => [...prev, item]);
      }
    } else {
      const key = item.assetId;
      if (offerItems.find(i => i.assetId === key)) {
        setOfferItems(prev => prev.filter(i => i.assetId !== key));
      } else {
        setOfferItems(prev => [...prev, item]);
      }
    }
  }

  function addLooking(item) {
    if (lookingFor.find(i => i.marketHashName === item.marketHashName)) return;
    setLookingFor(prev => [...prev, item]);
  }
  function removeLooking(mhn) {
    setLookingFor(prev => prev.filter(i => i.marketHashName !== mhn));
  }

  async function handleSubmit() {
    if (!offerItems.length && !lookingFor.length) {
      setError("Add at least one item to offer or looking for."); return;
    }

    console.log("[trade:modal] lookingFor before submit:", lookingFor.map(i => ({ name: i.name, iconUrl: i.iconUrl?.slice(0, 60), exterior: i.exterior, isSpecial: i.isSpecial })));
    console.log("[trade:modal] payload:", { myOfferItems: offerItems.length, lookingForItems: lookingFor.length });

    setSubmitting(true); setError(null);
    try {
      const payload = {
        myOfferItems:    offerItems,
        lookingForItems: lookingFor,
        message,
      };
      console.log("[trade:modal] sending payload:", JSON.stringify(payload).slice(0, 400));

      const res = await api.post("/trades", payload);
      if (res.data.ok) {
        onCreated(res.data.post);
        onClose();
      } else {
        setError(res.data.message || res.data.error || "Failed to create post.");
      }
    } catch (err) {
      const serverMsg = err?.response?.data?.message || err?.response?.data?.error;
      console.error("[trade:modal] submit error:", err?.response?.data || err.message);
      setError(serverMsg || "Network error — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="trade-modal-overlay"
      style={{
        position: "fixed", inset: 0, zIndex: 9000,
        background: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="trade-modal" style={{
        width: "100%", maxWidth: 1020, maxHeight: "90vh",
        background: "#0d0a1a",
        border: "1px solid rgba(168,85,247,0.25)",
        borderRadius: 20,
        boxShadow: "0 32px 80px rgba(0,0,0,0.8), 0 0 60px rgba(168,85,247,0.08)",
        display: "flex", flexDirection: "column",
        overflow: "hidden",
      }}>

        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 22px",
          borderBottom: "1px solid rgba(168,85,247,0.12)",
          flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 800, color: "rgba(255,255,255,0.92)", letterSpacing: "-0.02em" }}>
              Create Trade Post
            </div>
            <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>
              Select items to offer and what you're looking for
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              width: 32, height: 32, borderRadius: 8,
              border: "1px solid rgba(168,85,247,0.20)",
              background: "rgba(255,255,255,0.05)",
              color: "rgba(255,255,255,0.55)", cursor: "pointer", fontSize: 18,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontFamily: "inherit",
            }}
          >×</button>
        </div>

        {/* Top preview row */}
        <PreviewRow
          offerItems={offerItems}
          lookingFor={lookingFor}
          onRemoveOffer={toggleOffer}
          onRemoveLooking={removeLooking}
        />

        {/* Bottom: inventory | looking for */}
        <div className="trade-modal-body" style={{
          display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr",
          flex: 1, minHeight: 0, overflow: "hidden",
          borderBottom: "1px solid rgba(168,85,247,0.10)",
        }}>

          {/* Left — Inventory */}
          <div style={{ display: "flex", flexDirection: "column", padding: "14px 16px", borderRight: "1px solid rgba(168,85,247,0.10)", overflow: "hidden", minHeight: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexShrink: 0 }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#22d3ee" }}>
                My Inventory
              </span>
              {offerItems.length > 0 && (
                <span style={{ fontSize: 10, fontWeight: 700, color: "#22d3ee", background: "rgba(34,211,238,0.10)", border: "1px solid rgba(34,211,238,0.25)", borderRadius: 4, padding: "1px 6px" }}>
                  {offerItems.length} selected
                </span>
              )}
            </div>
            <InventoryPanel inventory={inventory} selected={offerItems} onToggle={toggleOffer} />
          </div>

          {/* Right — Looking For */}
          <div style={{ display: "flex", flexDirection: "column", padding: "14px 16px", overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexShrink: 0 }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#c084fc" }}>
                Looking For
              </span>
              {lookingFor.length > 0 && (
                <span style={{ fontSize: 10, fontWeight: 700, color: "#c084fc", background: "rgba(168,85,247,0.12)", border: "1px solid rgba(168,85,247,0.28)", borderRadius: 4, padding: "1px 6px" }}>
                  {lookingFor.length} added
                </span>
              )}
            </div>
            <LookingForPanel added={lookingFor} onAdd={addLooking} onRemove={removeLooking} />
          </div>
        </div>

        {/* Footer */}
        <div className="trade-modal-footer" style={{
          padding: "12px 22px", display: "flex", gap: 10, alignItems: "center", flexShrink: 0,
          background: "rgba(255,255,255,0.02)",
        }}>
          <input
            value={message}
            onChange={e => setMessage(e.target.value.slice(0, 500))}
            placeholder="Optional message (e.g. quick trade, B/O welcome)…"
            style={{
              flex: 1, height: 36, padding: "0 12px",
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(168,85,247,0.18)",
              borderRadius: 8, color: "rgba(255,255,255,0.88)", fontSize: 12.5,
              outline: "none", fontFamily: "inherit",
            }}
            className="placeholder:text-white/20"
          />
          {error && (
            <div style={{ fontSize: 11, color: "#f87171", maxWidth: 200, flexShrink: 0 }}>{error}</div>
          )}
          <button
            onClick={handleSubmit}
            disabled={submitting}
            style={{
              height: 36, padding: "0 26px",
              background: submitting ? "rgba(255,255,255,0.06)" : "linear-gradient(135deg,#7c3aed,#6366f1)",
              border: "none", borderRadius: 9,
              color: submitting ? "rgba(255,255,255,0.30)" : "#ffffff",
              fontSize: 13, fontWeight: 700,
              cursor: submitting ? "not-allowed" : "pointer",
              fontFamily: "inherit", flexShrink: 0,
              boxShadow: submitting ? "none" : "0 4px 16px rgba(99,102,241,0.35)",
            }}
          >
            {submitting ? "Posting…" : "Post Trade"}
          </button>
        </div>
      </div>

      <style>{`@keyframes trade-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   Main TradePage — dark cyberpunk purple
═══════════════════════════════════════════════════════ */
export default function TradePage() {
  const { isAuthed, user, updateUserSetting } = useAuth();
  const navigate  = useNavigate();
  const location  = useLocation();

  const [tab,         setTab]         = useState(location.state?.tab || "feed");
  const [posts,       setPosts]       = useState([]);
  const [myPosts,     setMyPosts]     = useState([]);
  const [total,       setTotal]       = useState(0);
  const [page,        setPage]        = useState(1);
  const [loading,     setLoading]     = useState(true);
  const [inventory,   setInventory]   = useState([]);
  const [showCreate,  setShowCreate]  = useState(false);
  const notifUnread = useTradeUnreadCount(isAuthed);
  const [matchFilter, setMatchFilter] = useState("all"); // "all" | "matched" | "exact"

  const loadFeed = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const res = await api.get(`/trades?page=${p}&limit=20`);
      if (res.data.ok) {
        if (p === 1) setPosts(res.data.posts);
        else setPosts(prev => [...prev, ...res.data.posts]);
        setTotal(res.data.total);
        setPage(p);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  const loadMine = useCallback(async () => {
    if (!isAuthed) return;
    try {
      const res = await api.get("/trades/mine");
      if (res.data.ok) setMyPosts(res.data.posts);
    } catch { /* ignore */ }
  }, [isAuthed]);

  const loadInventory = useCallback(async () => {
    if (!isAuthed) return;
    try {
      const res = await api.get("/steam/inventory");
      if (res.data.ok) {
        setInventory((res.data.items || []).map(i => ({
          ...i,
          iconUrl: i.iconUrl || i.icon_url || "",
        })));
      }
    } catch { /* ignore */ }
  }, [isAuthed]);

  useEffect(() => {
    loadFeed(1);
    if (isAuthed) { loadMine(); loadInventory(); }
  }, [loadFeed, loadMine, loadInventory, isAuthed]);

  useEffect(() => {
    function handler(e) {
      const post = e.detail;
      if (!post?.id) return;
      console.log(`[trade:feed] trade:new-post event — id=${post.id} owner="${post.ownerUsername}"`);
      setTotal(t => t + 1);
      setPosts(prev => {
        if (prev.some(p => p.id === post.id)) return prev;
        return [post, ...prev];
      });
    }
    window.addEventListener("trade:new-post", handler);
    return () => window.removeEventListener("trade:new-post", handler);
  }, []);

  useEffect(() => {
    const timer = setInterval(async () => {
      // Skip while backgrounded — the visibilitychange effect below already
      // does an immediate catch-up fetch when the tab regains focus.
      if (document.visibilityState !== "visible") return;
      try {
        const res = await api.get("/trades?page=1&limit=20");
        if (!res.data.ok) return;
        const incoming = res.data.posts || [];
        setTotal(res.data.total ?? 0);
        setPosts(prev => {
          const existingIds = new Set(prev.map(p => p.id));
          const brandNew = incoming.filter(p => !existingIds.has(p.id));
          if (!brandNew.length) return prev;
          console.log(`[trade:feed] poll found ${brandNew.length} new post(s)`);
          return [...brandNew, ...prev];
        });
      } catch { /* ignore */ }
    }, 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    function onVisible() {
      if (document.visibilityState !== "visible") return;
      api.get("/trades?page=1&limit=20")
        .then(res => {
          if (!res.data.ok) return;
          const incoming = res.data.posts || [];
          setTotal(res.data.total ?? 0);
          setPosts(prev => {
            const existingIds = new Set(prev.map(p => p.id));
            const brandNew = incoming.filter(p => !existingIds.has(p.id));
            if (!brandNew.length) return prev;
            console.log(`[trade:feed] visibilitychange found ${brandNew.length} new post(s)`);
            return [...brandNew, ...prev];
          });
        })
        .catch(() => {});
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  useEffect(() => {
    function handler(e) {
      const { tradePostId } = e.detail || {};
      if (!tradePostId) return;
      function updatePost(p) {
        if (p.id !== tradePostId) return p;
        return { ...p, commentCount: (p.commentCount || 0) + 1, unreadComments: (p.unreadComments || 0) + 1 };
      }
      setPosts(prev => prev.map(updatePost));
      setMyPosts(prev => prev.map(updatePost));
    }
    window.addEventListener("trade:new-comment", handler);
    return () => window.removeEventListener("trade:new-comment", handler);
  }, []);

  function handlePostCreated(newPost) {
    setPosts(prev => {
      if (prev.some(p => p.id === newPost.id)) return prev;
      return [newPost, ...prev];
    });
    setMyPosts(prev => {
      if (prev.some(p => p.id === newPost.id)) return prev;
      return [newPost, ...prev];
    });
    setTotal(t => t + 1);
    setTimeout(() => loadMine(), 3000);
  }
  function handlePostClosed(postId) {
    console.log(`[trade] post deleted from UI — id=${postId}`);
    setPosts(prev => prev.filter(p => p.id !== postId));
    setMyPosts(prev => prev.filter(p => p.id !== postId));
    setTotal(t => Math.max(0, t - 1));
    // Re-fetch My Posts after 800ms to confirm backend sync
    setTimeout(() => loadMine(), 800);
  }
  function handlePostBumped(updatedPost) {
    setPosts(prev => [updatedPost, ...prev.filter(p => p.id !== updatedPost.id)]);
    setMyPosts(prev => prev.map(p => p.id === updatedPost.id ? updatedPost : p));
  }

  const tradeAlertsEnabled = user?.tradeMatchAlertsEnabled !== false;
  const [togglingAlerts, setTogglingAlerts] = useState(false);

  async function handleToggleAlerts() {
    if (!isAuthed || togglingAlerts) return;
    setTogglingAlerts(true);
    try {
      await updateUserSetting("tradeMatchAlertsEnabled", !tradeAlertsEnabled);
    } catch { /* ignore */ }
    finally { setTogglingAlerts(false); }
  }

  const rawActivePosts = tab === "feed" ? posts : myPosts;

  // Score + sort the feed when inventory is available
  const scoredPosts = useMemo(() => {
    if (tab !== "feed" || !inventory.length) return rawActivePosts;
    return sortedByMatch(rawActivePosts, inventory);
  }, [rawActivePosts, inventory, tab]);

  // Apply match filter
  const activePosts = useMemo(() => {
    if (matchFilter === "exact")   return scoredPosts.filter(p => (p._matchTier || "none") === "exact");
    if (matchFilter === "matched") return scoredPosts.filter(p => (p._matchScore || 0) > 0);
    return scoredPosts;
  }, [scoredPosts, matchFilter]);

  const hasMore = posts.length < total;

  // Count useful match stats for the filter bar
  const exactCount   = useMemo(() => scoredPosts.filter(p => p._matchTier === "exact").length,   [scoredPosts]);
  const matchedCount = useMemo(() => scoredPosts.filter(p => (p._matchScore || 0) > 0).length,   [scoredPosts]);
  const hasInventory = inventory.length > 0;

  /* ─── Render ─────────────────────────────────────────────────── */

  return (
    <div style={{ minHeight: "100vh", background: "#0a0d16", padding: "clamp(14px,2.5vw,24px) clamp(12px,2.5vw,20px) 48px", maxWidth: 1440, margin: "0 auto", overflowX: "hidden" }}>

      {/* Page header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 24, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: "rgba(255,255,255,0.92)", margin: 0, letterSpacing: "-0.03em" }}>
            Trade Board
          </h1>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", marginTop: 4 }}>
            {total.toLocaleString()} active trade post{total !== 1 ? "s" : ""}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <DevTradeMatchTest />
          {isAuthed && (
            <button
              onClick={() => setShowCreate(true)}
              style={{
                height: 40, padding: "0 22px",
                background: "linear-gradient(135deg,#7c3aed,#6366f1)",
                border: "none",
                borderRadius: 11, color: "#ffffff", fontSize: 13, fontWeight: 700,
                cursor: "pointer", fontFamily: "inherit",
                boxShadow: "0 4px 14px rgba(99,102,241,0.28)",
                transition: "opacity 0.15s, box-shadow 0.15s",
              }}
              onMouseEnter={e => { e.currentTarget.style.opacity = "0.9"; e.currentTarget.style.boxShadow = "0 6px 20px rgba(124,58,237,0.38)"; }}
              onMouseLeave={e => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.boxShadow = "0 4px 14px rgba(99,102,241,0.28)"; }}
            >
              + Create Trade Post
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="trade-tabs-row" style={{ display: "flex", gap: 4, marginBottom: 20, alignItems: "center" }}>
        {[["feed", "Trade Board"], ["mine", "My Posts"]].map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)}
            style={{
              height: 34, padding: "0 18px", borderRadius: 8,
              fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
              background: tab === t ? "rgba(168,85,247,0.14)" : "transparent",
              border: tab === t ? "1px solid rgba(168,85,247,0.32)" : "1px solid transparent",
              color: tab === t ? "#c084fc" : "rgba(255,255,255,0.40)",
              boxShadow: "none",
              transition: "all 0.15s",
            }}>
            {label}
            {t === "mine" && myPosts.length > 0 && (
              <span style={{ marginLeft: 6, fontSize: 10, opacity: 0.6 }}>({myPosts.length})</span>
            )}
          </button>
        ))}

        {/* Notifications tab */}
        {isAuthed && (
          <button
            onClick={() => navigate("/trade/notifications")}
            style={{
              height: 34, padding: "0 18px", borderRadius: 8,
              fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
              background: "transparent", border: "1px solid transparent",
              color: "rgba(255,255,255,0.40)", transition: "all 0.15s",
              display: "flex", alignItems: "center", gap: 6,
            }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.09)"; e.currentTarget.style.color = "rgba(255,255,255,0.80)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "transparent"; e.currentTarget.style.color = "rgba(255,255,255,0.40)"; }}
          >
            Notifications
            {notifUnread > 0 && (
              <span style={{
                background: "#8b5cf6", color: "#fff",
                fontSize: 10.5, fontWeight: 800, padding: "1px 6px",
                borderRadius: 4, lineHeight: 1.6,
                boxShadow: "0 0 8px rgba(139,92,246,0.5)",
              }}>
                {notifUnread > 99 ? "99+" : notifUnread}
              </span>
            )}
          </button>
        )}

        {/* Search Trades tab */}
        {isAuthed && (
          <button
            onClick={() => setTab("search")}
            style={{
              height: 34, padding: "0 18px", borderRadius: 8,
              fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
              background: tab === "search" ? "rgba(168,85,247,0.14)" : "transparent",
              border: tab === "search" ? "1px solid rgba(168,85,247,0.32)" : "1px solid transparent",
              color: tab === "search" ? "#c084fc" : "rgba(255,255,255,0.40)",
              boxShadow: tab === "search" ? "0 0 12px rgba(168,85,247,0.10)" : "none",
              transition: "all 0.15s",
            }}
            onMouseEnter={e => {
              if (tab !== "search") { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.09)"; e.currentTarget.style.color = "rgba(255,255,255,0.80)"; }
            }}
            onMouseLeave={e => {
              if (tab !== "search") { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "transparent"; e.currentTarget.style.color = "rgba(255,255,255,0.40)"; }
            }}
          >
            Search Trades
          </button>
        )}

        {/* Trade Match Alerts toggle */}
        {isAuthed && (
          <div className="trade-tabs-toggle" style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 9 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.38)", userSelect: "none" }}>
              Trade Match Alerts
            </span>
            <button
              onClick={handleToggleAlerts}
              disabled={togglingAlerts}
              title={tradeAlertsEnabled ? "Disable trade match alerts" : "Enable trade match alerts"}
              style={{
                position: "relative", width: 40, height: 22, borderRadius: 11,
                border: "none", cursor: togglingAlerts ? "not-allowed" : "pointer",
                background: tradeAlertsEnabled ? "#7c3aed" : "rgba(255,255,255,0.12)",
                transition: "background 0.2s",
                flexShrink: 0, padding: 0,
                opacity: togglingAlerts ? 0.6 : 1,
              }}
            >
              <span style={{
                position: "absolute", top: 3, left: tradeAlertsEnabled ? 21 : 3,
                width: 16, height: 16, borderRadius: "50%",
                background: "#fff",
                boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
                transition: "left 0.2s",
              }} />
            </button>
            <span style={{
              fontSize: 11, fontWeight: 700,
              color: tradeAlertsEnabled ? "#c084fc" : "rgba(255,255,255,0.28)",
              minWidth: 24,
            }}>
              {tradeAlertsEnabled ? "ON" : "OFF"}
            </span>
          </div>
        )}
      </div>

      {/* Match filter bar — only for feed tab when inventory loaded */}
      {tab === "feed" && hasInventory && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.30)", fontWeight: 500, marginRight: 2 }}>Filter</span>
          {[
            { value: "all",     label: "All trades",     count: posts.length },
            { value: "matched", label: "Matches you",    count: matchedCount, color: "#c084fc" },
            { value: "exact",   label: "Exact matches",  count: exactCount,   color: "#4ade80" },
          ].map(f => {
            const active = matchFilter === f.value;
            return (
              <button
                key={f.value}
                onClick={() => setMatchFilter(f.value)}
                style={{
                  height: 30, padding: "0 12px", borderRadius: 20,
                  fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                  background: active
                    ? f.value === "exact"   ? "rgba(74,222,128,0.14)"
                    : f.value === "matched" ? "rgba(168,85,247,0.14)"
                    : "rgba(255,255,255,0.08)"
                    : "rgba(255,255,255,0.04)",
                  border: active
                    ? f.value === "exact"   ? "1px solid rgba(74,222,128,0.32)"
                    : f.value === "matched" ? "1px solid rgba(168,85,247,0.30)"
                    : "1px solid rgba(255,255,255,0.15)"
                    : "1px solid rgba(255,255,255,0.07)",
                  color: active
                    ? f.value === "exact"   ? "#4ade80"
                    : f.value === "matched" ? "#c084fc"
                    : "rgba(255,255,255,0.75)"
                    : "rgba(255,255,255,0.38)",
                  transition: "all 0.15s",
                  display: "flex", alignItems: "center", gap: 5,
                }}
              >
                {f.label}
                {f.count > 0 && (
                  <span style={{
                    fontSize: 10, fontWeight: 800, minWidth: 16, height: 16, borderRadius: 8,
                    background: active
                      ? f.value === "exact"   ? "rgba(74,222,128,0.22)"
                      : f.value === "matched" ? "rgba(168,85,247,0.22)"
                      : "rgba(255,255,255,0.15)"
                      : "rgba(255,255,255,0.06)",
                    color: active
                      ? f.value === "exact"   ? "#4ade80"
                      : f.value === "matched" ? "#c084fc"
                      : "rgba(255,255,255,0.7)"
                      : "rgba(255,255,255,0.30)",
                    display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px",
                  }}>
                    {f.count}
                  </span>
                )}
              </button>
            );
          })}

          {/* Legend dots */}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
            {Object.entries(MATCH_TIERS)
              .filter(([k]) => k !== "none")
              .map(([k, t]) => (
                <div key={k} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: t.color, boxShadow: `0 0 4px ${t.color}` }} />
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.28)" }}>{t.label}</span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Search Trades tab */}
      {tab === "search" && (
        <SearchTradesTab inventory={inventory} />
      )}

      {/* Feed */}
      {tab !== "search" && loading && activePosts.length === 0 ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
          <svg width={28} height={28} viewBox="0 0 32 32" fill="none" style={{ animation: "trade-spin 1s linear infinite" }}>
            <circle cx="16" cy="16" r="12" stroke="rgba(168,85,247,0.20)" strokeWidth="3" />
            <path d="M16 4 A12 12 0 0 1 28 16" stroke="#a855f7" strokeWidth="3" strokeLinecap="round" />
          </svg>
          <style>{`@keyframes trade-spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      ) : tab !== "search" && activePosts.length === 0 ? (
        <div style={{ textAlign: "center", padding: "80px 0" }}>
          <div style={{ fontSize: 14, color: "rgba(255,255,255,0.30)" }}>
            {tab === "mine"
              ? isAuthed ? "You haven't posted any trades yet." : "Log in to see your posts."
              : "No active trade posts yet."}
          </div>
          {isAuthed && tab === "mine" && (
            <button
              onClick={() => setShowCreate(true)}
              style={{
                marginTop: 16, height: 36, padding: "0 20px",
                background: "linear-gradient(135deg,#7c3aed,#6366f1)",
                border: "none",
                borderRadius: 8, color: "#fff", fontSize: 13, fontWeight: 600,
                cursor: "pointer", fontFamily: "inherit",
                boxShadow: "0 4px 14px rgba(124,58,237,0.40)",
              }}
            >
              Create your first trade post
            </button>
          )}
        </div>
      ) : tab !== "search" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {activePosts.map(post => (
            <TradePostCard
              key={post.id}
              post={post}
              showControls={tab === "mine"}
              onClosed={handlePostClosed}
              onBumped={handlePostBumped}
              matchScore={post._matchScore || 0}
              matchTier={post._matchTier   || "none"}
              matchLabel={post._matchLabel  || ""}
            />
          ))}
          {tab === "feed" && hasMore && (
            <button
              onClick={() => loadFeed(page + 1)}
              disabled={loading}
              style={{
                height: 38, margin: "10px auto 0", padding: "0 28px",
                background: "rgba(168,85,247,0.08)",
                border: "1px solid rgba(168,85,247,0.22)",
                borderRadius: 10, color: "rgba(168,85,247,0.80)", fontSize: 12.5, fontWeight: 600,
                cursor: loading ? "not-allowed" : "pointer", fontFamily: "inherit",
                transition: "all 0.15s",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = "rgba(168,85,247,0.16)"; e.currentTarget.style.color = "#c084fc"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "rgba(168,85,247,0.08)"; e.currentTarget.style.color = "rgba(168,85,247,0.80)"; }}
            >
              {loading ? "Loading…" : `Load more (${total - posts.length} remaining)`}
            </button>
          )}
        </div>
      ) : null}

      {showCreate && (
        <CreateTradeModal
          inventory={inventory}
          onClose={() => setShowCreate(false)}
          onCreated={handlePostCreated}
        />
      )}

      <style>{`@keyframes trade-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
