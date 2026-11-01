import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import api from "../../lib/api";
import PriceSidebar from "../market/PriceSidebar";
import { normalizeItem } from "../../lib/marketItem";
import avatarAlertImg from "../../assets/avatarAlert.png";
import usePushNotifications from "../../hooks/usePushNotifications";
import { isFirebaseConfigured } from "../../lib/firebase";

/* ─── Helpers ─────────────────────────────────────────── */

function fmtRelative(v) {
  if (!v) return null;
  try {
    const ms = Date.now() - new Date(v).getTime();
    if (ms < 60_000)     return "just now";
    if (ms < 3_600_000)  return `${Math.floor(ms / 60_000)}m ago`;
    if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
    return new Date(v).toLocaleDateString([], { month: "short", day: "numeric" });
  } catch { return null; }
}

function fmtCoins(v) {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
}

function fmtFloat(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(6) : null;
}

function shortWear(w) {
  if (!w) return null;
  const m = {
    "factory new": "FN", "minimal wear": "MW",
    "field-tested": "FT", "well-worn": "WW", "battle-scarred": "BS",
  };
  return m[String(w).toLowerCase()] ?? w;
}

function buildBuyUrl(alert) {
  return alert.buyUrl || alert.url
    || (alert.itemId ? `https://csgoempire.com/item/${alert.itemId}` : "https://csgoempire.com");
}

/* ─── Constants ───────────────────────────────────────── */

const AUCTION_CATEGORIES = [
  { value: "all",     label: "All categories" },
  { value: "knife",   label: "Knives"         },
  { value: "gloves",  label: "Gloves"         },
  { value: "rifle",   label: "Rifles"         },
  { value: "pistol",  label: "Pistols"        },
  { value: "smg",     label: "SMGs"           },
  { value: "sniper",  label: "Snipers"        },
  { value: "sticker", label: "Stickers"       },
];

const WEARS = ["Any wear","Factory New","Minimal Wear","Field-Tested","Well-Worn","Battle-Scarred"];

const SORT_OPTIONS = [
  { value: "profit",    label: "Best profit first"      },
  { value: "newest",    label: "Newest first"           },
  { value: "price",     label: "Highest price"          },
  { value: "auction",   label: "Auction alerts first"   },
  { value: "watchlist", label: "Watchlist alerts first" },
];

const FILTER_CHIPS = [
  { value: "all",       label: "All"         },
  { value: "auction",   label: "Auction"     },
  { value: "watchlist", label: "Watchlist"   },
  { value: "profit",    label: "Profit only" },
  { value: "unread",    label: "Unread"      },
  { value: "today",     label: "Today"       },
];

const LS_SORT   = "skintel_alerts_sort";
const LS_FILTER = "skintel_alerts_filter";

/* ─── Background star data (deterministic) ───────────── */

const BG_STARS = [
  [4,12,1,0.16],[11,28,0.75,0.11],[19,8,1.5,0.19],[27,45,1,0.13],[35,19,0.75,0.20],
  [42,68,1,0.12],[50,35,1.5,0.17],[58,82,0.75,0.10],[65,22,1,0.19],[72,55,1.5,0.13],
  [78,14,1,0.21],[84,72,0.75,0.11],[91,38,1,0.17],[96,60,1.5,0.19],[8,92,0.75,0.10],
  [16,52,1,0.14],[24,76,1.5,0.17],[31,30,0.75,0.21],[39,88,1,0.11],[47,5,1,0.19],
  [55,65,1.5,0.14],[63,42,0.75,0.17],[70,80,1,0.21],[76,25,1.5,0.10],[82,58,1,0.19],
  [88,10,0.75,0.14],[93,85,1,0.17],[2,48,1.5,0.11],[14,70,1,0.21],[22,15,0.75,0.19],
];

/* ─── Shared field style ──────────────────────────────── */

const F = {
  field: {
    width: "100%", borderRadius: 9, padding: "8px 12px",
    background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)",
    fontSize: 13, color: "rgba(255,255,255,0.85)", outline: "none",
    fontFamily: "inherit", transition: "border-color 0.15s, background 0.15s", appearance: "none",
  },
  label: {
    display: "block", fontSize: 10, fontWeight: 600, textTransform: "uppercase",
    letterSpacing: "0.13em", color: "rgba(255,255,255,0.38)", marginBottom: 6,
  },
};

function onFocus(e) {
  e.target.style.borderColor = "rgba(168,85,247,0.45)";
  e.target.style.background  = "rgba(168,85,247,0.07)";
  e.target.style.boxShadow   = "0 0 0 2px rgba(168,85,247,0.10)";
}
function onBlur(e) {
  e.target.style.borderColor = "rgba(255,255,255,0.09)";
  e.target.style.background  = "rgba(255,255,255,0.05)";
  e.target.style.boxShadow   = "none";
}

/* ─── Thumbnail ───────────────────────────────────────── */

function Thumb({ src, alt }) {
  const [err, setErr] = useState(false);
  if (!src || err) {
    return (
      <div style={{ width:"100%", height:"100%", display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(255,255,255,0.03)" }}>
        <svg width={16} height={16} fill="none" viewBox="0 0 24 24" stroke="rgba(255,255,255,0.14)" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      </div>
    );
  }
  return <img src={src} alt={alt || ""} style={{ width:"100%", height:"100%", objectFit:"contain" }} onError={() => setErr(true)} />;
}

/* ─── Rule parameter chip ─────────────────────────────── */

function Param({ children, highlight }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center",
      padding: "3px 9px", borderRadius: 6, fontSize: 12, fontWeight: 600,
      background: highlight ? "rgba(168,85,247,0.10)" : "rgba(255,255,255,0.05)",
      border: `1px solid ${highlight ? "rgba(168,85,247,0.22)" : "rgba(255,255,255,0.07)"}`,
      color: highlight ? "#c084fc" : "rgba(255,255,255,0.48)",
      whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums",
    }}>
      {children}
    </span>
  );
}

/* ─── Auction rule row ────────────────────────────────── */

function RuleRow({ rule, onDelete, onToggle }) {
  const [hov, setHov] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const on = rule.enabled;

  async function handleDelete() {
    if (!confirm("Delete this rule?")) return;
    try { setDeleting(true); await api.delete(`/auction-alerts/${rule._id}`); onDelete(rule._id); }
    catch (e) { console.error(e); }
    finally { setDeleting(false); }
  }

  async function handleToggle() {
    try {
      const res = await api.patch(`/auction-alerts/${rule._id}`, { enabled: !rule.enabled });
      onToggle(res.data.rule);
    } catch (e) { console.error(e); }
  }

  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "12px 16px", borderRadius: 10,
        background: hov ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.02)",
        border: `1px solid ${hov ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.06)"}`,
        transition: "all 0.15s ease",
      }}
    >
      {/* Enabled dot */}
      <div style={{
        width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
        background: on ? "#4ade80" : "rgba(255,255,255,0.15)",
        boxShadow: on ? "0 0 6px rgba(74,222,128,0.4)" : "none",
        transition: "background 0.15s, box-shadow 0.15s",
      }} />

      {/* Parameters */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexWrap: "wrap", gap: 5 }}>
        <Param highlight>≥ {rule.minProfitCoins}c profit</Param>
        {rule.minProfitPct  != null && <Param>≥ {rule.minProfitPct}%</Param>}
        {rule.maxBidPrice   != null && <Param>bid ≤ {rule.maxBidPrice}c</Param>}
        {rule.category && rule.category !== "all" && <Param>{rule.category}</Param>}
        {rule.search   && <Param>"{rule.search}"</Param>}
        {rule.wear     && <Param>{shortWear(rule.wear) || rule.wear}</Param>}
        <Param>{rule.cooldownMin}m cd</Param>
      </div>

      {/* Toggle */}
      <button
        onClick={handleToggle}
        style={{
          flexShrink: 0, height: 26, minWidth: 46, padding: "0 10px", borderRadius: 7,
          border: `1px solid ${on ? "rgba(74,222,128,0.20)" : "rgba(255,255,255,0.08)"}`,
          background: on ? "rgba(74,222,128,0.08)" : "rgba(255,255,255,0.04)",
          color: on ? "#4ade80" : "rgba(255,255,255,0.25)",
          fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
          cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s",
        }}
      >
        {on ? "ON" : "OFF"}
      </button>

      {/* Delete */}
      <button
        onClick={handleDelete}
        disabled={deleting}
        style={{
          flexShrink: 0, width: 28, height: 28, borderRadius: 7,
          background: hov ? "rgba(239,68,68,0.10)" : "rgba(239,68,68,0.04)",
          border: "1px solid rgba(239,68,68,0.10)",
          color: hov ? "#f87171" : "rgba(248,113,113,0.35)",
          fontSize: 16, lineHeight: 1, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          opacity: deleting ? 0.4 : 1, transition: "all 0.15s", fontFamily: "inherit",
        }}
      >
        ×
      </button>
    </div>
  );
}

/* ─── New rule form ───────────────────────────────────── */

const DEFAULTS = {
  minProfitCoins: "", minProfitPct: "", maxBidPrice: "",
  category: "all", search: "", wear: "", cooldownMin: "10",
};

function NewRuleForm({ onCreated, onCancel }) {
  const [form, setForm] = useState(DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const set = (k, v) => { setForm(p => ({ ...p, [k]: v })); setErr(""); };

  async function submit(e) {
    e.preventDefault();
    if (!form.minProfitCoins || Number(form.minProfitCoins) < 0) {
      setErr("Minimum profit is required."); return;
    }
    try {
      setSaving(true);
      const res = await api.post("/auction-alerts", {
        ...form,
        minProfitCoins: Number(form.minProfitCoins),
        minProfitPct:   form.minProfitPct !== "" ? Number(form.minProfitPct) : null,
        maxBidPrice:    form.maxBidPrice   !== "" ? Number(form.maxBidPrice)  : null,
        cooldownMin:    Number(form.cooldownMin || 10),
        wear:           form.wear === "Any wear" ? "" : form.wear,
      });
      onCreated(res.data.rule);
      setForm(DEFAULTS);
    } catch (e) {
      setErr(e?.response?.data?.error || "Failed to save rule.");
    } finally { setSaving(false); }
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {err && (
        <p style={{
          padding: "9px 13px", borderRadius: 8, fontSize: 12.5, margin: 0,
          background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.16)", color: "#fca5a5",
        }}>{err}</p>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(148px, 1fr))", gap: 12 }}>
        {[
          { k: "minProfitCoins", label: "Min profit (coins) *", type: "number", step: "0.01", placeholder: "e.g. 30" },
          { k: "minProfitPct",   label: "Min profit %",         type: "number", step: "0.1",  placeholder: "e.g. 12" },
          { k: "maxBidPrice",    label: "Max bid (coins)",       type: "number", step: "0.01", placeholder: "none" },
          { k: "search",         label: "Skin name",             type: "text",                placeholder: "Karambit, Redline…" },
          { k: "cooldownMin",    label: "Cooldown (min)",        type: "number", step: "1",   placeholder: "10" },
        ].map(({ k, label, ...rest }) => (
          <div key={k}>
            <label style={F.label}>{label}</label>
            <input style={F.field} value={form[k]} onChange={e => set(k, e.target.value)} onFocus={onFocus} onBlur={onBlur} min="0" {...rest} />
          </div>
        ))}
        <div>
          <label style={F.label}>Category</label>
          <select style={F.field} value={form.category} onChange={e => set("category", e.target.value)} onFocus={onFocus} onBlur={onBlur}>
            {AUCTION_CATEGORIES.map(c => <option key={c.value} value={c.value} style={{ background: "#141020" }}>{c.label}</option>)}
          </select>
        </div>
        <div>
          <label style={F.label}>Wear</label>
          <select style={F.field} value={form.wear || "Any wear"} onChange={e => set("wear", e.target.value === "Any wear" ? "" : e.target.value)} onFocus={onFocus} onBlur={onBlur}>
            {WEARS.map(w => <option key={w} value={w} style={{ background: "#141020" }}>{w}</option>)}
          </select>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          type="submit" disabled={saving}
          style={{
            padding: "9px 22px", borderRadius: 9, border: "none",
            fontSize: 13, fontWeight: 700, color: "#fff", cursor: saving ? "not-allowed" : "pointer",
            background: "linear-gradient(135deg, #7c3aed, #6366f1)",
            boxShadow: "0 4px 14px rgba(99,102,241,0.30)",
            opacity: saving ? 0.6 : 1, fontFamily: "inherit", transition: "opacity 0.15s",
          }}
        >
          {saving ? "Saving…" : "Create Rule"}
        </button>
        <button
          type="button" onClick={onCancel}
          style={{
            padding: "9px 16px", borderRadius: 9, border: "1px solid rgba(255,255,255,0.09)",
            fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.4)",
            cursor: "pointer", background: "transparent", fontFamily: "inherit", transition: "all 0.15s",
          }}
          onMouseEnter={e => { e.currentTarget.style.color = "rgba(255,255,255,0.7)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.16)"; }}
          onMouseLeave={e => { e.currentTarget.style.color = "rgba(255,255,255,0.4)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.09)"; }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

/* ─── Filter + Sort bar ───────────────────────────────── */

function FilterSortBar({ filter, sort, onFilter, onSort, unreadCount, filteredCount }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
      {/* Filter chips + sort row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {/* Filter chips */}
        <div className="chips-scroll" style={{ flex: 1 }}>
          {FILTER_CHIPS.map(chip => {
            const active = filter === chip.value;
            const badge = chip.value === "unread" && unreadCount > 0 ? unreadCount : null;
            return (
              <button
                key={chip.value}
                onClick={() => onFilter(chip.value)}
                style={{
                  height: 30, padding: "0 12px", borderRadius: 20,
                  fontSize: 12, fontWeight: 600, cursor: "pointer",
                  background: active ? "rgba(168,85,247,0.16)" : "rgba(255,255,255,0.04)",
                  border: active ? "1px solid rgba(168,85,247,0.32)" : "1px solid rgba(255,255,255,0.07)",
                  color: active ? "#c084fc" : "rgba(255,255,255,0.42)",
                  boxShadow: active ? "0 0 12px rgba(168,85,247,0.10)" : "none",
                  transition: "all 0.15s ease",
                  display: "flex", alignItems: "center", gap: 5,
                  fontFamily: "inherit",
                }}
              >
                {chip.label}
                {badge && (
                  <span style={{
                    fontSize: 10, fontWeight: 800, minWidth: 16, height: 16, borderRadius: 8,
                    background: "rgba(168,85,247,0.25)", color: "#c084fc",
                    display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px",
                  }}>
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Sort dropdown */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.28)", fontWeight: 500 }}>Sort</span>
          <select
            value={sort}
            onChange={e => onSort(e.target.value)}
            style={{
              height: 30, padding: "0 28px 0 10px", borderRadius: 8,
              fontSize: 12, fontWeight: 500, outline: "none", appearance: "none", cursor: "pointer",
              background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)",
              color: "rgba(255,255,255,0.70)", fontFamily: "inherit",
            }}
          >
            {SORT_OPTIONS.map(o => <option key={o.value} value={o.value} style={{ background: "#141020" }}>{o.label}</option>)}
          </select>
        </div>
      </div>

      {/* Result count */}
      {filteredCount > 0 && (
        <span style={{ fontSize: 11.5, color: "rgba(255,255,255,0.22)", fontVariantNumeric: "tabular-nums" }}>
          {filteredCount} alert{filteredCount !== 1 ? "s" : ""}
        </span>
      )}
    </div>
  );
}

/* ─── Feed row ────────────────────────────────────────── */

const FeedRow = memo(function FeedRow({ alert, isAuction, profitCoins, discount, floatVal, onOpen, onMarkRead, onDelete, isNew: _isNew }) {
  const [hov, setHov] = useState(false);
  if (!alert) return null;
  const status    = alert.status || alert.state || "";
  const isLive    = status !== "expired" && status !== "sold" && status !== "deleted" && !alert.isDeleted && alert.available !== false;
  const isNew     = !alert.isRead;
  const accentRgb = isAuction ? "168,85,247" : "34,211,238";
  const accent    = isAuction ? "#a855f7"    : "#22d3ee";
  const date      = fmtRelative(alert.triggeredAt || alert.createdAt);
  const hasBigProfit = isLive && profitCoins != null && profitCoins >= 50;

  return (
    <div
      onClick={() => onOpen(alert)}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: "flex", alignItems: "stretch", overflow: "hidden",
        borderRadius: 12, cursor: "pointer",
        background: hov ? "rgba(255,255,255,0.04)" : isNew ? `rgba(${accentRgb},0.04)` : "rgba(255,255,255,0.02)",
        border: `1px solid ${isNew ? `rgba(${accentRgb},0.18)` : hov ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.06)"}`,
        transition: "all 0.18s ease",
        animation: _isNew ? "rowSlideIn 0.3s ease" : "none",
      }}
    >
      {/* Left accent bar */}
      <div style={{
        width: 3, flexShrink: 0,
        background: isNew ? `linear-gradient(180deg, ${accent} 0%, transparent 100%)` : "transparent",
        opacity: 0.7,
      }} />

      <div style={{ display: "flex", flex: 1, alignItems: "center", gap: 12, padding: "13px 14px", minWidth: 0 }}>

        {/* Thumbnail */}
        <div style={{
          position: "relative", width: 60, height: 46, flexShrink: 0,
          borderRadius: 10, overflow: "hidden",
          background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)",
        }}>
          <Thumb src={alert.image} alt={alert.name} />
          {isNew && (
            <span style={{
              position: "absolute", top: 4, right: 4,
              width: 6, height: 6, borderRadius: "50%",
              background: accent, animation: "liveDot 2.5s ease-in-out infinite",
            }} />
          )}
        </div>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Name row */}
          <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", marginBottom: 6 }}>
            <span style={{
              fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.10em",
              padding: "2px 8px", borderRadius: 5,
              background: `rgba(${accentRgb},0.10)`, border: `1px solid rgba(${accentRgb},0.18)`,
              color: accent, flexShrink: 0, lineHeight: 1.5,
            }}>
              {isAuction ? "Auction" : "Watchlist"}
            </span>
            <span style={{
              fontSize: 13.5, fontWeight: 600,
              color: isNew ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.70)",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              transition: "color 0.15s",
            }}>
              {alert.name || "Unknown item"}
            </span>
            {hasBigProfit && (
              <span style={{
                fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em",
                padding: "2px 7px", borderRadius: 4,
                background: "rgba(74,222,128,0.10)", border: "1px solid rgba(74,222,128,0.20)",
                color: "#4ade80", flexShrink: 0,
              }}>
                Hot deal
              </span>
            )}
          </div>

          {/* Stats row */}
          <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "3px 12px" }}>
            <DataPoint label={isAuction ? "Bid" : "Price"} value={`${fmtCoins(alert.priceCoins)}c`} gold />
            {isAuction && profitCoins != null && profitCoins > 0 ? (
              <DataPoint label="Profit" value={`+${fmtCoins(profitCoins)}c`} green />
            ) : discount > 0 ? (
              <DataPoint label="Disc" value={`${discount.toFixed(1)}%`} green />
            ) : null}
            {alert.wear && <DataPoint label="Wear" value={shortWear(alert.wear) || alert.wear} />}
            {floatVal != null && <DataPoint label="Float" value={fmtFloat(floatVal)} mono />}
            {date && <span style={{ fontSize: 11, color: "rgba(255,255,255,0.20)" }}>{date}</span>}
          </div>
        </div>

        {/* Actions — visible on hover (always visible on touch screens via CSS) */}
        <div
          className="feed-row-actions"
          style={{
            display: "flex", alignItems: "center", gap: 5, flexShrink: 0,
            opacity: hov ? 1 : 0, transition: "opacity 0.15s ease",
            pointerEvents: hov ? "auto" : "none",
          }}
        >
          <a
            href={buildBuyUrl(alert)} target="_blank" rel="noreferrer"
            onClick={e => e.stopPropagation()}
            style={{
              padding: "6px 13px", borderRadius: 7, fontSize: 12, fontWeight: 700,
              color: "#000", textDecoration: "none",
              background: "linear-gradient(135deg, #fbbf24, #f59e0b)",
              transition: "filter 0.15s",
            }}
            onMouseEnter={e => { e.currentTarget.style.filter = "brightness(1.1)"; }}
            onMouseLeave={e => { e.currentTarget.style.filter = "brightness(1)"; }}
          >
            {isAuction ? "Bid →" : "Buy →"}
          </a>

          {alert.isRead === false && (
            <button
              onClick={e => { e.stopPropagation(); onMarkRead(alert._id); }}
              title="Mark as read"
              style={{
                width: 36, height: 36, borderRadius: 8,
                background: "rgba(74,222,128,0.07)", border: "1px solid rgba(74,222,128,0.15)",
                color: "rgba(74,222,128,0.75)", fontSize: 14, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "inherit",
              }}
            >✓</button>
          )}

          <button
            onClick={e => { e.stopPropagation(); onDelete(alert._id); }}
            title="Delete"
            style={{
              width: 36, height: 36, borderRadius: 8,
              background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.10)",
              color: "rgba(248,113,113,0.50)", fontSize: 18, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "inherit",
            }}
          >×</button>
        </div>
      </div>
    </div>
  );
});

/* ─── DataPoint ───────────────────────────────────────── */

function DataPoint({ label, value, gold, green, mono }) {
  if (!value) return null;
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 4 }}>
      <span style={{
        fontSize: 11, fontWeight: 600, textTransform: "uppercase",
        letterSpacing: "0.07em", color: "rgba(255,255,255,0.28)",
      }}>{label}</span>
      <span style={{
        fontSize: 12.5, fontWeight: 700, fontVariantNumeric: "tabular-nums",
        fontFamily: mono ? "monospace" : "inherit",
        color: gold ? "#fbbf24" : green ? "#4ade80" : "rgba(255,255,255,0.62)",
      }}>{value}</span>
    </span>
  );
}

/* ─── Skeletons ───────────────────────────────────────── */

function Skeletons({ count, height = 72 }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skeleton" style={{ height, borderRadius: 12 }} />
      ))}
    </div>
  );
}

/* ─── Empty states ────────────────────────────────────── */

function EmptyRules({ onAdd }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"40px 24px", textAlign:"center", gap:14 }}>
      <div style={{ width:48, height:48, borderRadius:14, background:"rgba(168,85,247,0.07)", border:"1px solid rgba(168,85,247,0.14)", display:"flex", alignItems:"center", justifyContent:"center" }}>
        <svg width={20} height={20} fill="none" viewBox="0 0 24 24" stroke="rgba(168,85,247,0.5)" strokeWidth={1.5}>
          <circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3" />
          <line x1="3" y1="12" x2="9" y2="12" /><line x1="15" y1="12" x2="21" y2="12" />
          <line x1="12" y1="3" x2="12" y2="9" /><line x1="12" y1="15" x2="12" y2="21" />
        </svg>
      </div>
      <div>
        <p style={{ fontSize:13.5, fontWeight:600, color:"rgba(255,255,255,0.35)", margin:"0 0 5px" }}>No rules configured</p>
        <p style={{ fontSize:12, color:"rgba(255,255,255,0.20)", margin:0 }}>Rules fire automatically when auctions match your criteria.</p>
      </div>
      <button onClick={onAdd} style={{
        padding:"7px 16px", borderRadius:8, border:"1px solid rgba(168,85,247,0.22)",
        background:"rgba(168,85,247,0.08)", fontSize:12.5, fontWeight:600, color:"#c084fc",
        cursor:"pointer", fontFamily:"inherit",
      }}>
        Create first rule
      </button>
    </div>
  );
}

function EmptyFeed() {
  return (
    <div style={{
      display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
      padding:"72px 24px", textAlign:"center", borderRadius:16,
      background:"rgba(168,85,247,0.02)", border:"1px solid rgba(168,85,247,0.08)",
    }}>
      <div style={{
        width:52, height:52, borderRadius:16, marginBottom:16,
        background:"rgba(34,211,238,0.05)", border:"1px solid rgba(34,211,238,0.12)",
        display:"flex", alignItems:"center", justifyContent:"center",
      }}>
        <svg width={22} height={22} fill="none" viewBox="0 0 24 24" stroke="rgba(34,211,238,0.50)" strokeWidth={1.5}>
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
      </div>
      <p style={{ fontSize:14, fontWeight:600, color:"rgba(255,255,255,0.32)", margin:"0 0 6px" }}>No alerts yet</p>
      <p style={{ fontSize:12.5, color:"rgba(255,255,255,0.20)", maxWidth:260, lineHeight:1.6, margin:0 }}>
        Watchlist and auction alerts will stream here in real time.
      </p>
    </div>
  );
}

/* ─── Stat chip ───────────────────────────────────────── */

function Stat({ label, value, highlight }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", padding:"7px 16px", gap:2 }}>
      <span style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.11em", color:"rgba(168,85,247,0.55)" }}>
        {label}
      </span>
      <span style={{
        fontSize:16, fontWeight:800, fontVariantNumeric:"tabular-nums", lineHeight:1.2,
        color: highlight ? "#c084fc" : "rgba(255,255,255,0.88)",
      }}>
        {value}
      </span>
    </div>
  );
}

function GhostBtn({ onClick, disabled, children }) {
  const [hov, setHov] = useState(false);
  return (
    <button onClick={onClick} disabled={disabled}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        padding:"7px 13px", borderRadius:8, border:"1px solid rgba(255,255,255,0.08)",
        background: hov && !disabled ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.03)",
        fontSize:12.5, fontWeight:500, fontFamily:"inherit",
        color: disabled ? "rgba(255,255,255,0.20)" : hov ? "rgba(255,255,255,0.82)" : "rgba(255,255,255,0.50)",
        cursor: disabled ? "not-allowed" : "pointer", transition:"all 0.15s",
      }}
    >
      {children}
    </button>
  );
}

/* ─── Push notifications toggle ──────────────────────── */

const PUSH_INFO = {
  "no-config": {
    label: "FIREBASE NOT SET",
    tooltip: "VITE_FIREBASE_* env vars are missing — add them in Vercel dashboard → Project → Settings → Environment Variables, then redeploy",
    icon: (
      <svg width={11} height={11} fill="none" viewBox="0 0 24 24" stroke="rgba(251,191,36,0.55)" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      </svg>
    ),
    color: "rgba(251,191,36,0.50)",
    border: "rgba(251,191,36,0.16)",
    bg: "rgba(251,191,36,0.05)",
  },
  "browser-unsupported": {
    label: "PUSH UNSUPPORTED",
    tooltip: "This browser does not support Web Push. Try Chrome, Firefox, or Edge on desktop.",
    icon: (
      <svg width={11} height={11} fill="none" viewBox="0 0 24 24" stroke="rgba(255,255,255,0.28)" strokeWidth={2}>
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="8" x2="12" y2="12"/>
        <circle cx="12" cy="16" r="0.5" fill="rgba(255,255,255,0.28)" stroke="rgba(255,255,255,0.28)" strokeWidth={1.5}/>
      </svg>
    ),
    color: "rgba(255,255,255,0.28)",
    border: "rgba(255,255,255,0.07)",
    bg: "rgba(255,255,255,0.02)",
  },
  "not-logged-in": {
    label: "LOG IN FOR PUSH",
    tooltip: "You must be logged in to enable push notifications",
    icon: (
      <svg width={11} height={11} fill="none" viewBox="0 0 24 24" stroke="rgba(255,255,255,0.28)" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    ),
    color: "rgba(255,255,255,0.28)",
    border: "rgba(255,255,255,0.07)",
    bg: "rgba(255,255,255,0.02)",
  },
  "denied": {
    label: "PERMISSION DENIED",
    tooltip: "Push is blocked by your browser. Click the lock icon in the address bar → Notifications → Allow, then reload.",
    icon: (
      <svg width={11} height={11} fill="none" viewBox="0 0 24 24" stroke="rgba(248,113,113,0.60)" strokeWidth={2}>
        <circle cx="12" cy="12" r="10"/>
        <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
      </svg>
    ),
    color: "rgba(248,113,113,0.60)",
    border: "rgba(248,113,113,0.16)",
    bg: "rgba(248,113,113,0.04)",
  },
};

function PushToggle({ push }) {
  const { status, loading, error, request, disable, autoTestResult, probe } = push;
  const [hov,      setHov]      = useState(false);
  const [sending,  setSending]  = useState(false);
  const prevAutoTestTs = useRef(null);

  // Show toast when auto-test result arrives after a fresh enable
  useEffect(() => {
    if (!autoTestResult) return;
    if (autoTestResult.ts === prevAutoTestTs.current) return;
    prevAutoTestTs.current = autoTestResult.ts;
    if (autoTestResult.ok) {
      toast.success(autoTestResult.msg, { duration: 5000 });
    } else {
      toast.error(autoTestResult.msg, { duration: 6000 });
    }
  }, [autoTestResult]);

  async function sendTestPush() {
    setSending(true);
    try {
      const res = await api.post("/push/test");
      const d   = res.data ?? {};
      toast.success(`Test sent to ${d.tokenCount ?? "?"} device${(d.tokenCount ?? 0) !== 1 ? "s" : ""}`, { duration: 5000 });
    } catch (err) {
      toast.error(err?.response?.data?.error || err.message || "Send failed", { duration: 6000 });
    } finally {
      setSending(false);
    }
  }

  // ── PERMISSION DENIED — mobile gets step-by-step panel ───────────
  if (status === "denied") {
    const isMobile = /android|ipad|iphone|ipod/i.test(navigator.userAgent ?? "");

    const RefreshBtn = () => (
      <button
        onClick={probe}
        style={{
          display: "flex", alignItems: "center", gap: 5,
          padding: "5px 11px", borderRadius: 7, flexShrink: 0,
          background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.10)",
          color: "rgba(255,255,255,0.48)", fontSize: 11, fontWeight: 600,
          cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
          transition: "all 0.15s",
        }}
        onMouseEnter={e => { e.currentTarget.style.color = "rgba(255,255,255,0.80)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.22)"; }}
        onMouseLeave={e => { e.currentTarget.style.color = "rgba(255,255,255,0.48)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.10)"; }}
        title="Re-check notification permission after updating Chrome settings"
      >
        <svg width={9} height={9} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} style={{ flexShrink: 0 }}>
          <polyline points="23 4 23 10 17 10"/>
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
        </svg>
        Refresh permission status
      </button>
    );

    if (isMobile) {
      const STEPS = [
        ["Open", <><strong style={{ color: "rgba(255,255,255,0.72)" }}>Chrome</strong></>],
        ["Tap",  <><strong style={{ color: "rgba(255,255,255,0.72)" }}>⋮</strong>{" → "}<strong style={{ color: "rgba(255,255,255,0.72)" }}>Settings</strong></>],
        ["Tap",  <><strong style={{ color: "rgba(255,255,255,0.72)" }}>Site settings</strong>{" → "}<strong style={{ color: "rgba(255,255,255,0.72)" }}>Notifications</strong></>],
        ["Find", <><code style={{ fontSize: 11, color: "rgba(168,85,247,0.90)", background: "rgba(168,85,247,0.10)", padding: "1px 5px", borderRadius: 3, fontFamily: "monospace" }}>www.skin-tel.com</code></>],
        ["Set",  <><strong style={{ color: "rgba(74,222,128,0.90)" }}>Allow</strong></>],
        ["Tap",  <>the <strong style={{ color: "rgba(255,255,255,0.72)" }}>back arrow</strong> to return here</>],
        ["Tap",  <><strong style={{ color: "rgba(74,222,128,0.90)" }}>Enable Push</strong>{" below"}</>],
      ];

      return (
        <div style={{
          display: "flex", flexDirection: "column", gap: 11,
          padding: "13px 15px", borderRadius: 11, width: "100%",
          background: "rgba(248,113,113,0.05)",
          border: "1px solid rgba(248,113,113,0.18)",
        }}>

          {/* Header row */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <svg width={12} height={12} fill="none" viewBox="0 0 24 24" stroke="rgba(248,113,113,0.75)" strokeWidth={2}>
                <circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
              </svg>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.09em", color: "rgba(248,113,113,0.80)", textTransform: "uppercase" }}>
                Permission Denied
              </span>
            </div>
            <RefreshBtn />
          </div>

          {/* Instructions */}
          <div>
            <p style={{ margin: "0 0 8px", fontSize: 12, color: "rgba(255,255,255,0.35)", lineHeight: 1.4 }}>
              Push is blocked in Chrome. To enable it:
            </p>
            <ol style={{ margin: 0, paddingLeft: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 5 }}>
              {STEPS.map(([verb, detail], i) => (
                <li key={i} style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
                  <span style={{
                    flexShrink: 0, width: 18, height: 18, borderRadius: "50%",
                    background: "rgba(248,113,113,0.10)", border: "1px solid rgba(248,113,113,0.22)",
                    fontSize: 9.5, fontWeight: 800, color: "rgba(248,113,113,0.70)",
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                  }}>
                    {i + 1}
                  </span>
                  <span style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", lineHeight: 1.45 }}>
                    {verb}{" "}{detail}
                  </span>
                </li>
              ))}
            </ol>
          </div>

        </div>
      );
    }

    // Desktop — compact pill + refresh button side by side
    const info = PUSH_INFO["denied"];
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div
          title="Push is blocked. In Chrome: click the padlock in the address bar → Notifications → Allow, then reload."
          style={{
            display: "flex", alignItems: "center", gap: 6,
            height: 30, padding: "0 12px", borderRadius: 7,
            border: `1px solid ${info.border}`, background: info.bg, cursor: "default",
          }}
        >
          {info.icon}
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.07em", color: info.color, whiteSpace: "nowrap" }}>
            {info.label}
          </span>
        </div>
        <RefreshBtn />
      </div>
    );
  }

  // ── Static info pills (non-interactive states) ────────────────────
  const info = PUSH_INFO[status];
  if (info) {
    return (
      <div
        title={info.tooltip}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          height: 30, padding: "0 12px", borderRadius: 7,
          border: `1px solid ${info.border}`,
          background: info.bg,
          cursor: "default",
        }}
      >
        {info.icon}
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.07em", color: info.color, whiteSpace: "nowrap" }}>
          {info.label}
        </span>
      </div>
    );
  }

  // ── Checking state ────────────────────────────────────────────────
  if (status === "checking") {
    return (
      <div style={{
        display: "flex", alignItems: "center", gap: 6,
        height: 30, padding: "0 12px", borderRadius: 7,
        border: "1px solid rgba(255,255,255,0.06)",
        background: "rgba(255,255,255,0.02)",
      }}>
        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.22)", letterSpacing: "0.06em" }}>Push…</span>
      </div>
    );
  }

  // ── ENABLE PUSH / ENABLING… / PUSH ENABLED toggle ────────────────
  const on = status === "enabled";
  const label = loading ? "ENABLING…" : on ? "PUSH ENABLED" : "ENABLE PUSH";

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>

      {/* Button row */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <button
          onClick={on ? disable : request}
          disabled={loading}
          onMouseEnter={() => setHov(true)}
          onMouseLeave={() => setHov(false)}
          title={on ? "Click to disable push alerts" : "Click to enable push alerts for price + trade events"}
          style={{
            display: "flex", alignItems: "center", gap: 7,
            height: 30, padding: "0 13px", borderRadius: 7,
            border: on
              ? `1px solid rgba(74,222,128,${hov ? "0.35" : "0.20"})`
              : `1px solid rgba(168,85,247,${hov ? "0.35" : "0.18"})`,
            background: on
              ? `rgba(74,222,128,${hov ? "0.14" : "0.07"})`
              : `rgba(168,85,247,${hov ? "0.12" : "0.06"})`,
            color: on
              ? (hov ? "#86efac" : "#4ade80")
              : (hov ? "#d8b4fe" : "#c084fc"),
            fontSize: 11, fontWeight: 700, letterSpacing: "0.08em",
            cursor: loading ? "not-allowed" : "pointer",
            fontFamily: "inherit", transition: "all 0.15s ease",
            opacity: loading ? 0.6 : 1, whiteSpace: "nowrap",
          }}
        >
          <svg width={12} height={12} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6 6 0 10-12 0v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
          {label}
        </button>

        {/* Send test button — only shown when enabled */}
        {on && (
          <button
            onClick={sendTestPush}
            disabled={sending}
            title="Fire a real FCM notification to verify the full push stack"
            style={{
              height: 30, padding: "0 11px", borderRadius: 7,
              border: "1px solid rgba(34,211,238,0.22)",
              background: "rgba(34,211,238,0.07)",
              color: "rgba(103,232,249,0.85)",
              fontSize: 11, fontWeight: 700, letterSpacing: "0.06em",
              cursor: sending ? "not-allowed" : "pointer",
              fontFamily: "inherit", transition: "all 0.15s ease",
              opacity: sending ? 0.55 : 1, whiteSpace: "nowrap",
            }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(34,211,238,0.13)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "rgba(34,211,238,0.07)"; }}
          >
            {sending ? "Sending…" : "Send test"}
          </button>
        )}
      </div>

      {/* Inline error from enable/disable */}
      {error && !loading && (
        <span style={{
          fontSize: 10.5, color: "rgba(252,165,165,0.80)", maxWidth: 260,
          textAlign: "right", lineHeight: 1.4,
        }}>
          {error}
        </span>
      )}
    </div>
  );
}

/* ─── FCM Debug Panel ─────────────────────────────────── */

/* ─── PushServerDebug ────────────────────────────────── */

export function PushServerDebug() {
  const [open,    setOpen]    = useState(false);
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get("/push/debug");
      const d   = res.data;
      console.log("[PushServerDebug] /api/push/debug →", d);
      setData(d);
      setOpen(true);
    } catch (e) {
      const msg = e?.response?.data?.error || e?.message || "Request failed";
      console.error("[PushServerDebug] error:", msg, e?.response?.data);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  function dot(ok) {
    if (ok === true)  return { bg: "#4ade80", glow: "rgba(74,222,128,0.5)"  };
    if (ok === false) return { bg: "#f87171", glow: "rgba(248,113,113,0.5)" };
    return { bg: "#fbbf24", glow: "rgba(251,191,36,0.5)" };
  }

  function Dot({ ok }) {
    const { bg, glow } = dot(ok);
    return <div style={{ width:7, height:7, borderRadius:"50%", background:bg, boxShadow:`0 0 6px ${glow}`, flexShrink:0 }} />;
  }

  function Row({ label, value, ok, mono }) {
    return (
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:10, padding:"6px 10px", borderRadius:7, background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.06)" }}>
        <span style={{ fontSize:11, color:"rgba(255,255,255,0.38)", flexShrink:0 }}>{label}</span>
        <div style={{ display:"flex", alignItems:"center", gap:6, minWidth:0 }}>
          {ok !== undefined && <Dot ok={ok} />}
          <span style={{ fontSize:11, fontWeight:500, color:"rgba(255,255,255,0.78)", fontFamily:mono?"monospace":"inherit", wordBreak:"break-all", textAlign:"right" }}>
            {value ?? "–"}
          </span>
        </div>
      </div>
    );
  }

  function Chip({ label, value, color = "rgba(168,85,247,0.80)" }) {
    return (
      <div style={{ textAlign:"center", padding:"8px 10px", borderRadius:8, background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.07)" }}>
        <div style={{ fontSize:16, fontWeight:800, color, fontVariantNumeric:"tabular-nums", lineHeight:1.1 }}>{value ?? 0}</div>
        <div style={{ fontSize:9, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.10em", color:"rgba(255,255,255,0.30)", marginTop:3 }}>{label}</div>
      </div>
    );
  }

  const containerStyle = {
    borderRadius:12,
    border:"1px solid rgba(168,85,247,0.14)",
    background:"rgba(168,85,247,0.02)",
    backdropFilter:"blur(8px)",
    overflow:"hidden",
  };

  const headerStyle = {
    display:"flex", alignItems:"center", justifyContent:"space-between",
    padding:"11px 16px",
    background:"none", border:"none", cursor:"pointer",
    fontFamily:"inherit", width:"100%",
    color:"rgba(168,85,247,0.65)",
  };

  const sectionTitle = (t) => (
    <div style={{ fontSize:9.5, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.11em", color:"rgba(255,255,255,0.30)", margin:"14px 0 7px" }}>
      {t}
    </div>
  );

  return (
    <div style={containerStyle}>
      <button style={headerStyle} onClick={() => setOpen(v => !v)}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <svg width={11} height={11} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
            <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
          </svg>
          <span style={{ fontSize:11.5, fontWeight:700, letterSpacing:"0.06em" }}>Push Server Debug</span>
          {data && (
            <span style={{ fontSize:9.5, padding:"2px 7px", borderRadius:4, background: data.fcmReady ? "rgba(74,222,128,0.10)" : "rgba(248,113,113,0.10)", border:`1px solid ${data.fcmReady ? "rgba(74,222,128,0.22)" : "rgba(248,113,113,0.22)"}`, color: data.fcmReady ? "#4ade80" : "#f87171" }}>
              {data.fcmReady ? "FCM ready" : "FCM not ready"}
            </span>
          )}
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <button
            onClick={(e) => { e.stopPropagation(); load(); }}
            disabled={loading}
            style={{ padding:"4px 11px", borderRadius:7, fontSize:11, fontWeight:600, background:"rgba(168,85,247,0.10)", border:"1px solid rgba(168,85,247,0.22)", color:"rgba(168,85,247,0.90)", cursor:"pointer", fontFamily:"inherit", opacity:loading?0.6:1 }}
          >
            {loading ? "Loading…" : data ? "Refresh" : "Load"}
          </button>
          <svg width={10} height={10} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} style={{ transform:open?"rotate(180deg)":"none", transition:"transform 0.2s" }}>
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </div>
      </button>

      {error && (
        <div style={{ margin:"0 14px 12px", padding:"9px 12px", borderRadius:8, background:"rgba(248,113,113,0.08)", border:"1px solid rgba(248,113,113,0.22)", fontSize:12, color:"#f87171" }}>
          {error}
        </div>
      )}

      {open && data && (
        <div style={{ padding:"0 14px 16px" }}>

          {/* ── Summary row ── */}
          {sectionTitle("Status")}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(100px,1fr))", gap:8 }}>
            <Chip label="Active tokens"  value={data.activeTokenCount}  color={data.activeTokenCount > 0 ? "#4ade80" : "#f87171"} />
            <Chip label="Inactive tokens" value={data.inactiveTokenCount} color="rgba(255,255,255,0.40)" />
          </div>

          {sectionTitle("Diagnostic summary")}
          <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
            <Row label="Push enabled (server-verified)" value={data.pushEnabled ? "yes" : "no"} ok={data.pushEnabled} />
            <Row label="Token status" value={data.tokenStatus ?? "unknown"} ok={data.tokenStatus === "valid" ? true : data.tokenStatus === "invalid" ? false : undefined} />
            {data.lastPushError && <Row label="Last push error" value={data.lastPushError} ok={false} />}
          </div>

          {sectionTitle("Key timestamps")}
          <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
            <Row label="Last push attempt"    value={data.lastPushAttempt    ? fmtRelative(data.lastPushAttempt)    + " — " + new Date(data.lastPushAttempt).toLocaleTimeString()    : "never"} ok={!!data.lastPushAttempt} />
            <Row label="Last successful push" value={data.lastSuccessfulPush ? fmtRelative(data.lastSuccessfulPush) + " — " + new Date(data.lastSuccessfulPush).toLocaleTimeString() : "never"} ok={!!data.lastSuccessfulPush} />
            <Row label="Last failed push"     value={data.lastFailedPush     ? fmtRelative(data.lastFailedPush)     + " — " + new Date(data.lastFailedPush).toLocaleTimeString()     : "none"}  ok={!data.lastFailedPush || undefined} />
          </div>

          {/* ── Tokens ── */}
          {sectionTitle(`Tokens (${data.tokens?.length ?? 0} total)`)}
          {(!data.tokens?.length) ? (
            <div style={{ fontSize:12, color:"rgba(255,255,255,0.28)", fontStyle:"italic", padding:"6px 0" }}>No tokens found for this account.</div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
              {data.tokens.map((t, i) => (
                <div key={i} style={{ padding:"9px 11px", borderRadius:8, background:t.active?"rgba(74,222,128,0.04)":"rgba(248,113,113,0.04)", border:`1px solid ${t.active?"rgba(74,222,128,0.14)":"rgba(248,113,113,0.14)"}` }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:5 }}>
                    <Dot ok={t.active} />
                    <span style={{ fontSize:11, fontWeight:600, color:"rgba(255,255,255,0.70)", fontFamily:"monospace" }}>{t.tail}</span>
                    <span style={{ fontSize:9.5, padding:"1px 6px", borderRadius:4, background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.09)", color:"rgba(255,255,255,0.35)" }}>
                      {t.platform} / {t.browser || "unknown"}
                    </span>
                    {!t.active && <span style={{ fontSize:9.5, color:"#f87171", fontWeight:700 }}>INACTIVE</span>}
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))", gap:"3px 12px" }}>
                    {[
                      ["Last seen",      t.lastSeenAt  ? fmtRelative(t.lastSeenAt)  : "never"],
                      ["Last push",      t.lastPushAt  ? fmtRelative(t.lastPushAt)  : "never"],
                      ["Last push ok",   t.lastPushSuccess === null ? "no data" : t.lastPushSuccess ? "✓ success" : "✗ failed"],
                      ["Fail count",     String(t.failCount ?? 0)],
                    ].map(([k,v]) => (
                      <div key={k} style={{ display:"flex", gap:6 }}>
                        <span style={{ fontSize:10, color:"rgba(255,255,255,0.28)" }}>{k}:</span>
                        <span style={{ fontSize:10, color:"rgba(255,255,255,0.62)" }}>{v}</span>
                      </div>
                    ))}
                  </div>
                  {!t.active && t.failureReason && (
                    <div style={{ marginTop:6, fontSize:10, color:"#f87171" }}>
                      Deactivated: {t.failureReason}
                      {t.lastFailureAt && <> — {fmtRelative(t.lastFailureAt)}</>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ── Server stats ── */}
          {sectionTitle("Server stats (since last restart)")}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(110px,1fr))", gap:7 }}>
            {data.serverStats && [
              ["Alerts created",   data.serverStats.alertsCreated,       "rgba(74,222,128,0.80)"],
              ["Push sent",        data.serverStats.pushSent,            "rgba(74,222,128,0.70)"],
              ["Push failed",      data.serverStats.pushFailed,          "rgba(248,113,113,0.70)"],
              ["Aggregated",       data.serverStats.pushAggregated,      "rgba(168,85,247,0.80)"],
              ["No tokens",        data.serverStats.pushSkippedNoTokens, "rgba(251,191,36,0.70)"],
              ["Tokens removed",   data.serverStats.tokenInvalidRemoved, "rgba(248,113,113,0.60)"],
            ].map(([label, value, color]) => (
              <Chip key={label} label={label} value={value} color={color} />
            ))}
          </div>
          <div style={{ marginTop:8, fontSize:10, color:"rgba(255,255,255,0.22)", textAlign:"right" }}>
            uptime {data.serverStats ? Math.round(data.serverStats.uptimeMs / 60000) : "?"}m — started {data.serverStats?.startedAt ? new Date(data.serverStats.startedAt).toLocaleTimeString() : "?"}
          </div>

          {/* ── Raw JSON ── */}
          <div style={{ marginTop:12 }}>
            <button
              onClick={() => console.log("[PushServerDebug] full data →", data)}
              style={{ fontSize:10, padding:"4px 10px", borderRadius:6, background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.09)", color:"rgba(255,255,255,0.38)", cursor:"pointer", fontFamily:"inherit" }}
            >
              Log full JSON to console
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── FcmDebugPanel ──────────────────────────────────── */

export function FcmDebugPanel({ swRegistered, fcmToken, lastFgMessage, lastSaveStatus }) {
  const [open,          setOpen]          = useState(false);
  const [swState,       setSwState]       = useState(null);   // "active" | "waiting" | "installing" | "none"
  const [backendTokens, setBackendTokens] = useState(null);   // { count, tokens } | null
  const [loadingToks,   setLoadingToks]   = useState(false);

  const permission = typeof Notification !== "undefined" ? Notification.permission : "N/A";
  const firebaseOk = isFirebaseConfigured();
  const ua         = navigator.userAgent ?? "N/A";
  const platform   = navigator.userAgentData?.platform ?? navigator.platform ?? "N/A";
  const origin     = window.location.origin;
  const tokenTail  = fcmToken ? `…${fcmToken.slice(-20)}` : null;

  // Fetch SW state + backend tokens whenever panel is opened
  useEffect(() => {
    if (!open) return;

    // SW registration state
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .getRegistration("/firebase-cloud-messaging-push-scope")
        .then((reg) => {
          if (!reg)              { setSwState("none"); return; }
          if (reg.active)        { setSwState("active");      return; }
          if (reg.waiting)       { setSwState("waiting");     return; }
          if (reg.installing)    { setSwState("installing");  return; }
          setSwState("registered-no-worker");
        })
        .catch(() => setSwState("error"));
    } else {
      setSwState("unsupported");
    }

    // Backend token list
    setLoadingToks(true);
    api.get("/push/tokens")
      .then((r) => setBackendTokens(r.data))
      .catch(() => setBackendTokens({ ok: false, count: 0, tokens: [] }))
      .finally(() => setLoadingToks(false));
  }, [open]);

  function statusDot(ok) {
    if (ok === true)  return { bg: "#4ade80", glow: "rgba(74,222,128,0.45)" };
    if (ok === false) return { bg: "#f87171", glow: "rgba(248,113,113,0.45)" };
    return { bg: "#fbbf24", glow: "rgba(251,191,36,0.45)" };
  }

  const deviceRows = [
    { label: "origin",      value: origin,                                          ok: null },
    { label: "userAgent",   value: ua.length > 72 ? ua.slice(0, 72) + "…" : ua,   ok: null },
    { label: "platform",    value: platform,                                        ok: null },
  ];

  const swOk = swState === "active" ? true : swState === null ? null : false;

  const pushRows = [
    {
      label: "Notification.permission",
      value: permission,
      ok: permission === "granted" ? true : permission === "denied" ? false : null,
    },
    { label: "Firebase configured", value: String(firebaseOk), ok: firebaseOk },
    {
      label: "Service worker state",
      value: swState === null ? "checking…" : swState,
      ok: swOk,
    },
    {
      label: "FCM token (this device)",
      value: tokenTail ?? "not yet",
      ok: !!fcmToken,
    },
    {
      label: "Token saved to backend",
      value: lastSaveStatus === null ? "not yet" : lastSaveStatus.ok ? "ok ✓" : `failed: ${lastSaveStatus.msg}`,
      ok: lastSaveStatus === null ? null : lastSaveStatus.ok,
    },
  ];

  // Is this device's token present in the backend list?
  const thisDeviceRegistered = (() => {
    if (!fcmToken || !backendTokens?.tokens?.length) return null;
    return backendTokens.tokens.some((t) => t.tail === `...${fcmToken.slice(-20)}`);
  })();

  function DebugRow({ label, value, ok }) {
    const { bg, glow } = statusDot(ok);
    return (
      <div style={{
        display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12,
        padding: "7px 11px", borderRadius: 8,
        background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)",
      }}>
        <span style={{ fontSize: 11.5, color: "rgba(255,255,255,0.40)", flexShrink: 0 }}>{label}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
          {ok !== null && (
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: bg, boxShadow: `0 0 6px ${glow}`, flexShrink: 0 }} />
          )}
          <span style={{
            fontSize: 11, fontWeight: 500, color: "rgba(255,255,255,0.75)", fontFamily: "monospace",
            wordBreak: "break-all", textAlign: "right",
          }}>
            {value}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      borderRadius: 12,
      border: "1px solid rgba(34,211,238,0.12)",
      background: "rgba(34,211,238,0.02)",
      backdropFilter: "blur(8px)",
      overflow: "hidden",
    }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          width: "100%", padding: "11px 16px",
          background: "none", border: "none", cursor: "pointer", fontFamily: "inherit",
          color: "rgba(103,232,249,0.65)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <svg width={11} height={11} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2v-4M9 21H5a2 2 0 01-2-2v-4m0 0h18" />
          </svg>
          <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase" }}>
            Push Notification Debug
          </span>
        </div>
        <span style={{ fontSize: 10, opacity: 0.40 }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div style={{ padding: "0 14px 14px", display: "flex", flexDirection: "column", gap: 10 }}>

          {/* Device */}
          <div>
            <div style={{ fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.11em", color: "rgba(34,211,238,0.45)", marginBottom: 5 }}>
              Device
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {deviceRows.map(r => <DebugRow key={r.label} {...r} />)}
            </div>
          </div>

          {/* Push setup */}
          <div>
            <div style={{ fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.11em", color: "rgba(34,211,238,0.45)", marginBottom: 5 }}>
              Push setup
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {pushRows.map(r => <DebugRow key={r.label} {...r} />)}
            </div>
          </div>

          {/* Backend tokens */}
          <div style={{ padding: "10px 12px", borderRadius: 8, background: "rgba(168,85,247,0.04)", border: "1px solid rgba(168,85,247,0.12)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
              <span style={{ fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.11em", color: "rgba(168,85,247,0.50)" }}>
                Backend tokens for your account
              </span>
              {loadingToks && (
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.22)" }}>loading…</span>
              )}
            </div>

            {!backendTokens ? (
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.22)", fontStyle: "italic" }}>fetching…</span>
            ) : backendTokens.count === 0 ? (
              <span style={{ fontSize: 11, color: "rgba(248,113,113,0.70)" }}>
                0 tokens — push not registered from any device
              </span>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.40)", marginBottom: 3 }}>
                  {backendTokens.count} active token{backendTokens.count !== 1 ? "s" : ""} — push will be sent to all of them
                </span>
                {backendTokens.tokens.map((t, i) => {
                  const isThis = tokenTail && t.tail === `...${fcmToken?.slice(-20)}`;
                  return (
                    <div key={i} style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "5px 9px", borderRadius: 6,
                      background: isThis ? "rgba(74,222,128,0.06)" : "rgba(255,255,255,0.02)",
                      border: `1px solid ${isThis ? "rgba(74,222,128,0.18)" : "rgba(255,255,255,0.06)"}`,
                    }}>
                      <span style={{ fontSize: 11, fontFamily: "monospace", color: isThis ? "#86efac" : "rgba(255,255,255,0.55)" }}>
                        {t.tail}
                        {isThis && <span style={{ marginLeft: 7, fontSize: 10, color: "#4ade80", fontFamily: "inherit" }}>← this device</span>}
                      </span>
                      <span style={{ fontSize: 10, color: "rgba(255,255,255,0.22)" }}>
                        {t.savedAt ? new Date(t.savedAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}
                      </span>
                    </div>
                  );
                })}
                {thisDeviceRegistered === false && fcmToken && (
                  <div style={{ padding: "6px 9px", borderRadius: 6, background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.18)" }}>
                    <span style={{ fontSize: 11, color: "rgba(251,191,36,0.85)" }}>
                      This device token is NOT in the backend list — click ENABLE PUSH to register it
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Last foreground message */}
          <div style={{ padding: "10px 12px", borderRadius: 8, background: "rgba(168,85,247,0.04)", border: "1px solid rgba(168,85,247,0.12)" }}>
            <div style={{ fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.11em", color: "rgba(168,85,247,0.50)", marginBottom: lastFgMessage ? 7 : 0 }}>
              Last foreground push (onMessage)
            </div>
            {lastFgMessage ? (
              <pre style={{ fontSize: 10.5, color: "rgba(255,255,255,0.55)", margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all", lineHeight: 1.55, fontFamily: "monospace" }}>
                {JSON.stringify(lastFgMessage, null, 2)}
              </pre>
            ) : (
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.22)", fontStyle: "italic" }}>
                none yet — fires when app is open and a push arrives
              </span>
            )}
          </div>

        </div>
      )}
    </div>
  );
}

/* ─── LivePermissionDebug ────────────────────────────── */

export function LivePermissionDebug({ fcmToken }) {
  const [snap, setSnap] = useState(null);
  const [busy, setBusy] = useState(false);

  const collect = useCallback(async () => {
    setBusy(true);
    try {
      const notifPerm      = typeof Notification !== "undefined" ? Notification.permission : "API_MISSING";
      const origin         = window.location.origin;
      const href           = window.location.href;
      const ua             = navigator.userAgent ?? "N/A";
      const isStandalone   = window.matchMedia?.("(display-mode: standalone)").matches ?? false;
      const isIosPwa       = !!window.navigator?.standalone;
      const isWebApk       = (document.referrer ?? "").startsWith("android-app://");
      const isPwa          = isStandalone || isIosPwa || isWebApk;
      const lsEnabled      = localStorage.getItem("skintel_push_enabled");
      const lsLastSavedRaw = localStorage.getItem("skintel_push_last_saved");
      const lsLastSaved    = lsLastSavedRaw ? new Date(Number(lsLastSavedRaw)).toISOString() : null;
      const ctrlUrl        = navigator.serviceWorker?.controller?.scriptURL ?? null;
      const ctrlState      = navigator.serviceWorker?.controller?.state ?? null;
      const quietUiLikely  = notifPerm === "denied" && lsEnabled !== "true";

      let permApiState = "unavailable";
      if ("permissions" in navigator) {
        try {
          const ps = await navigator.permissions.query({ name: "notifications" });
          permApiState = ps.state;
        } catch (e) { permApiState = `error: ${e.message}`; }
      }

      let swRegs = [];
      if ("serviceWorker" in navigator) {
        try {
          const regs = await navigator.serviceWorker.getRegistrations();
          for (const reg of regs) {
            const worker = reg.active ?? reg.waiting ?? reg.installing;
            let pushEndpoint = null, pushExpiry = null;
            try {
              if (reg.pushManager) {
                const sub = await reg.pushManager.getSubscription();
                if (sub) {
                  pushEndpoint = sub.endpoint.slice(-40);
                  pushExpiry   = sub.expirationTime ? new Date(sub.expirationTime).toISOString() : "no expiry";
                }
              }
            } catch { /* ignore */ }
            swRegs.push({
              scope: reg.scope, scriptURL: worker?.scriptURL ?? "—",
              workerState: worker?.state ?? "—", updateViaCache: reg.updateViaCache ?? "—",
              isController: ctrlUrl === worker?.scriptURL, pushEndpoint, pushExpiry,
            });
          }
        } catch (e) { swRegs = [{ error: e.message }]; }
      } else {
        swRegs = [{ error: "serviceWorker not supported" }];
      }

      setSnap({
        notifPerm, origin, href, ua,
        isPwa, isStandalone, isIosPwa, isWebApk,
        lsEnabled, lsLastSaved, ctrlUrl, ctrlState,
        permApiState, swRegs, quietUiLikely,
        fcmTokenTail: fcmToken ? `…${fcmToken.slice(-20)}` : null,
        collectedAt: new Date().toISOString(),
      });
    } finally { setBusy(false); }
  }, [fcmToken]);

  useEffect(() => { collect(); }, [collect]);

  const Row = ({ label, value, ok, mono = false }) => (
    <div style={{
      display: "flex", alignItems: "flex-start", justifyContent: "space-between",
      gap: 12, padding: "5px 10px", borderRadius: 7,
      background: "rgba(251,191,36,0.03)", border: "1px solid rgba(251,191,36,0.09)",
    }}>
      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.38)", flexShrink: 0, minWidth: 150 }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
        {ok === true  && <div style={{ width:5, height:5, borderRadius:"50%", background:"#4ade80", boxShadow:"0 0 5px rgba(74,222,128,0.55)", flexShrink:0 }} />}
        {ok === false && <div style={{ width:5, height:5, borderRadius:"50%", background:"#f87171", boxShadow:"0 0 5px rgba(248,113,113,0.55)", flexShrink:0 }} />}
        <span style={{
          fontSize: 11, fontWeight: 500, textAlign: "right", wordBreak: "break-all",
          color: ok === true ? "#4ade80" : ok === false ? "#f87171" : "rgba(251,191,36,0.82)",
          fontFamily: mono ? "monospace" : "inherit",
        }}>{value ?? "—"}</span>
      </div>
    </div>
  );

  const Sec = ({ title }) => (
    <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.14em", color: "rgba(251,191,36,0.40)", margin: "12px 0 5px" }}>
      {title}
    </div>
  );

  return (
    <div style={{ borderRadius: 12, border: "1px solid rgba(251,191,36,0.20)", background: "rgba(251,191,36,0.015)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 16px", borderBottom: snap ? "1px solid rgba(251,191,36,0.08)" : "none" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="rgba(251,191,36,0.70)" strokeWidth={2}>
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.11em", textTransform: "uppercase", color: "rgba(251,191,36,0.70)" }}>
            Live Permission Debug
          </span>
          <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 4, background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.16)", color: "rgba(251,191,36,0.45)" }}>
            TEMPORARY
          </span>
        </div>
        <button
          onClick={collect} disabled={busy}
          style={{ padding: "4px 11px", borderRadius: 7, fontSize: 11, fontWeight: 600, background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.20)", color: "rgba(251,191,36,0.85)", cursor: busy ? "not-allowed" : "pointer", fontFamily: "inherit", opacity: busy ? 0.6 : 1 }}
        >
          {busy ? "Collecting…" : "Refresh"}
        </button>
      </div>

      {snap && (
        <div style={{ padding: "0 14px 16px" }}>
          {snap.quietUiLikely && (
            <div style={{ margin: "10px 0 4px", padding: "9px 12px", borderRadius: 8, background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.28)", fontSize: 11, color: "rgba(251,191,36,0.90)", lineHeight: 1.5 }}>
              ⚠ Chrome Quiet UI likely: permission is denied but user never successfully enabled push.
              Chrome auto-blocked the permission request without showing a dialog.
            </div>
          )}

          <Sec title="Permission" />
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <Row label="Notification.permission"    value={snap.notifPerm}    ok={snap.notifPerm==="granted"?true:snap.notifPerm==="denied"?false:null} mono />
            <Row label="Permissions API state"      value={snap.permApiState} ok={snap.permApiState==="granted"?true:snap.permApiState==="denied"?false:null} mono />
            <Row label="skintel_push_enabled (LS)"  value={snap.lsEnabled ?? "(null)"}  ok={snap.lsEnabled==="true"?true:snap.lsEnabled==="disabled"?false:null} mono />
            <Row label="last token save"             value={snap.lsLastSaved ?? "never"} mono />
          </div>

          <Sec title="Origin" />
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <Row label="window.location.origin"    value={snap.origin}              mono />
            <Row label="window.location.href"      value={snap.href}                mono />
            <Row label="PWA / standalone"           value={String(snap.isPwa)}       ok={snap.isPwa} />
            <Row label="display-mode: standalone"  value={String(snap.isStandalone)} />
            <Row label="iOS standalone"             value={String(snap.isIosPwa)} />
            <Row label="Android WebAPK referrer"   value={String(snap.isWebApk)} />
          </div>

          <Sec title="FCM Token" />
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <Row label="token tail" value={snap.fcmTokenTail ?? "none — not registered"} ok={!!snap.fcmTokenTail} mono />
          </div>

          <Sec title="SW Controller" />
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <Row label="controller.scriptURL" value={snap.ctrlUrl ?? "none"} ok={!!snap.ctrlUrl} mono />
            <Row label="controller.state"     value={snap.ctrlState ?? "none"} mono />
          </div>

          <Sec title="SW Registrations" />
          {snap.swRegs.length === 0 ? (
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.28)", padding: "6px 0" }}>No service workers registered.</div>
          ) : snap.swRegs.map((r, i) => (
            <div key={i} style={{ marginBottom: 6, padding: "9px 12px", borderRadius: 8, background: "rgba(251,191,36,0.025)", border: "1px solid rgba(251,191,36,0.10)" }}>
              {r.error ? (
                <span style={{ fontSize: 11, color: "#f87171" }}>Error: {r.error}</span>
              ) : (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                    <div style={{ width:6, height:6, borderRadius:"50%", flexShrink:0, background: r.workerState==="activated"?"#4ade80":"#fbbf24", boxShadow:`0 0 5px ${r.workerState==="activated"?"rgba(74,222,128,0.5)":"rgba(251,191,36,0.5)"}` }} />
                    <span style={{ fontSize: 10.5, fontFamily: "monospace", color: "rgba(255,255,255,0.60)", wordBreak: "break-all" }}>{r.scriptURL}</span>
                    {r.isController && (
                      <span style={{ fontSize:9, padding:"1px 5px", borderRadius:4, flexShrink:0, background:"rgba(74,222,128,0.08)", border:"1px solid rgba(74,222,128,0.18)", color:"#4ade80" }}>controller</span>
                    )}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: "3px 14px" }}>
                    {[
                      ["scope",          r.scope],
                      ["state",          r.workerState],
                      ["updateViaCache", r.updateViaCache],
                      ["push endpoint",  r.pushEndpoint ? `…${r.pushEndpoint}` : "none"],
                      ["push expiry",    r.pushExpiry ?? "—"],
                    ].map(([k, v]) => (
                      <div key={k} style={{ display:"flex", gap:5 }}>
                        <span style={{ fontSize:10, color:"rgba(255,255,255,0.28)", flexShrink:0 }}>{k}:</span>
                        <span style={{ fontSize:10, fontFamily:"monospace", color:"rgba(255,255,255,0.55)", wordBreak:"break-all" }}>{v}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          ))}

          <Sec title="Device" />
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <Row label="userAgent" value={snap.ua.length > 100 ? snap.ua.slice(0,100)+"…" : snap.ua} mono />
          </div>

          <Sec title="Probe Log (last 20 events)" />
          {(() => {
            let entries = [];
            try { entries = JSON.parse(localStorage.getItem("skintel_push_probe_log") || "[]"); } catch { /* */ }
            if (!entries.length) return (
              <div style={{ fontSize:11, color:"rgba(255,255,255,0.28)", padding:"4px 0" }}>
                No entries yet — probe() has not run since this key was added. Reload the page.
              </div>
            );
            return entries.map((e, i) => {
              const denied  = e.status === "denied" || (e.source === "requestPermission" && e.status === "denied");
              const granted = e.status === "enabled" || e.status === "granting" || e.notifPerm === "granted";
              const isChange = e.source === "permissions-api-change" || e.source === "requestPermission";
              return (
                <div key={i} style={{
                  display:"flex", gap:8, alignItems:"flex-start",
                  padding:"5px 10px", borderRadius:7, marginBottom:3,
                  background: denied ? "rgba(248,113,113,0.04)" : granted ? "rgba(74,222,128,0.04)" : "rgba(251,191,36,0.03)",
                  border: `1px solid ${denied ? "rgba(248,113,113,0.12)" : granted ? "rgba(74,222,128,0.10)" : "rgba(251,191,36,0.09)"}`,
                }}>
                  <div style={{ width:5, height:5, borderRadius:"50%", marginTop:4, flexShrink:0, background: denied ? "#f87171" : granted ? "#4ade80" : "#fbbf24" }} />
                  <div style={{ minWidth:0 }}>
                    <div style={{ fontSize:10, fontFamily:"monospace", color:"rgba(255,255,255,0.65)" }}>
                      <span style={{ color: denied?"#f87171":granted?"#4ade80":"rgba(251,191,36,0.85)", fontWeight:600 }}>{e.status}</span>
                      {" · "}
                      <span style={{ color:"rgba(255,255,255,0.45)" }}>{e.notifPerm}</span>
                      {isChange && <span style={{ marginLeft:5, fontSize:9, padding:"1px 5px", borderRadius:4, background:"rgba(251,191,36,0.12)", border:"1px solid rgba(251,191,36,0.22)", color:"rgba(251,191,36,0.70)" }}>⚡ {e.source}</span>}
                      {!isChange && <span style={{ color:"rgba(255,255,255,0.25)", marginLeft:5 }}>via {e.source}</span>}
                    </div>
                    <div style={{ fontSize:9.5, fontFamily:"monospace", color:"rgba(255,255,255,0.25)", marginTop:1 }}>
                      {e.origin} · {e.ts ? new Date(e.ts).toLocaleTimeString() : "—"}
                    </div>
                  </div>
                </div>
              );
            });
          })()}

          <div style={{ marginTop: 10, fontSize: 10, color: "rgba(255,255,255,0.18)", textAlign: "right" }}>
            collected {new Date(snap.collectedAt).toLocaleTimeString()}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Pipeline Stats Panel ───────────────────────────── */

const MAX_CLIENT_SAMPLES = 200;

function computeLatStats(samples) {
  if (!samples.length) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const n = sorted.length;
  return {
    count: n,
    last:  samples[samples.length - 1],
    avg:   Math.round(sorted.reduce((s, v) => s + v, 0) / n),
    p95:   sorted[Math.floor((n - 1) * 0.95)],
    p99:   sorted[Math.floor((n - 1) * 0.99)],
    max:   sorted[n - 1],
  };
}

function LatBar({ label, hint, stat, color = "rgba(168,85,247,0.80)", target }) {
  if (!stat) return (
    <div style={{ padding: "9px 12px", borderRadius: 8, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)" }}>
      <div style={{ fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.10em", color: "rgba(255,255,255,0.28)", marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.20)", fontStyle: "italic" }}>no data yet</div>
    </div>
  );

  const cols = [
    { key: "last", label: "Last"  },
    { key: "avg",  label: "Avg"   },
    { key: "p95",  label: "P95"   },
    { key: "max",  label: "Max"   },
  ];

  function msColor(ms) {
    if (!target) return color;
    if (ms <= target * 0.5) return "rgba(74,222,128,0.90)";
    if (ms <= target)       return "rgba(251,191,36,0.90)";
    return "rgba(248,113,113,0.90)";
  }

  return (
    <div
      title={hint}
      style={{ padding: "10px 12px", borderRadius: 8, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)" }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.10em", color: "rgba(255,255,255,0.35)" }}>
          {label}
        </span>
        <span style={{ fontSize: 9.5, color: "rgba(255,255,255,0.22)" }}>n={stat.count}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4 }}>
        {cols.map(({ key, label: colLabel }) => (
          <div key={key} style={{ textAlign: "center" }}>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.28)", marginBottom: 2 }}>{colLabel}</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: msColor(stat[key]), fontVariantNumeric: "tabular-nums" }}>
              {stat[key] ?? "–"}
            </div>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.20)" }}>ms</div>
          </div>
        ))}
      </div>
      {target && (
        <div style={{ marginTop: 7, height: 3, borderRadius: 2, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
          <div style={{
            height: "100%", borderRadius: 2,
            width: `${Math.min(100, Math.round((stat.avg / target) * 100))}%`,
            background: msColor(stat.avg),
            transition: "width 0.4s ease",
          }} />
        </div>
      )}
    </div>
  );
}

export function PipelineStats({ stats, loading, onRefresh, onReset }) {
  const [open, setOpen] = useState(false);

  // Client-side end-to-end latency — collected from alert:latency window events
  const clientSamplesRef = useRef([]);
  const [clientStats, setClientStats] = useState(null);

  useEffect(() => {
    function onLatency(e) {
      const { ms } = e.detail ?? {};
      if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return;
      clientSamplesRef.current.push(ms);
      if (clientSamplesRef.current.length > MAX_CLIENT_SAMPLES) clientSamplesRef.current.shift();
      setClientStats(computeLatStats(clientSamplesRef.current));
    }
    window.addEventListener("alert:latency", onLatency);
    return () => window.removeEventListener("alert:latency", onLatency);
  }, []);

  function fmtUptime(ms) {
    if (!ms) return "just started";
    const m = Math.floor(ms / 60_000);
    const h = Math.floor(m / 60);
    if (h > 0) return `${h}h ${m % 60}m`;
    if (m > 0) return `${m}m`;
    return `${Math.floor(ms / 1000)}s`;
  }

  const countChips = stats ? [
    { label: "Scanned",   value: stats.itemsScanned,          hint: "Market items from Empire WS",             color: "rgba(34,211,238,0.70)"  },
    { label: "Matched",   value: stats.rulesMatched,          hint: "Rule×item matches before DB write",       color: "rgba(168,85,247,0.80)"  },
    { label: "Created",   value: stats.alertsCreated,         hint: "New alert records written to DB",         color: "rgba(74,222,128,0.80)"  },
    { label: "Cooldown",  value: stats.alertsSkippedCooldown, hint: "Skipped — cooldown still active",         color: "rgba(251,191,36,0.70)"  },
    { label: "Dedupe",    value: stats.alertsSkippedDedupe,   hint: "Skipped — already alerted for this item", color: "rgba(251,191,36,0.50)"  },
    { label: "Push sent", value: stats.pushSent,              hint: "Successful Firebase deliveries",          color: "rgba(74,222,128,0.70)"  },
    { label: "Push fail", value: stats.pushFailed,            hint: "Failed Firebase deliveries",              color: "rgba(248,113,113,0.70)" },
  ] : [];

  return (
    <div style={{
      borderRadius: 12,
      border: "1px solid rgba(168,85,247,0.14)",
      background: "rgba(168,85,247,0.02)",
      backdropFilter: "blur(8px)",
      overflow: "hidden",
    }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          width: "100%", padding: "11px 16px",
          background: "none", border: "none", cursor: "pointer", fontFamily: "inherit",
          color: "rgba(168,85,247,0.65)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <svg width={11} height={11} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
          <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase" }}>
            Alert Pipeline Stats
          </span>
          {stats && (
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.22)", fontWeight: 400 }}>
              — {fmtUptime(stats.uptimeMs)} window
            </span>
          )}
          {/* Inline latency summary in header */}
          {clientStats && (
            <span style={{
              fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 5,
              background: clientStats.avg <= 1000 ? "rgba(74,222,128,0.10)" : "rgba(248,113,113,0.10)",
              border:     clientStats.avg <= 1000 ? "1px solid rgba(74,222,128,0.22)" : "1px solid rgba(248,113,113,0.22)",
              color:      clientStats.avg <= 1000 ? "#4ade80" : "#f87171",
            }}>
              avg {clientStats.avg}ms
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {loading && <span style={{ fontSize: 10, color: "rgba(255,255,255,0.22)" }}>…</span>}
          <span style={{ fontSize: 10, opacity: 0.40 }}>{open ? "▲" : "▼"}</span>
        </div>
      </button>

      {open && (
        <div style={{ padding: "0 14px 14px", display: "flex", flexDirection: "column", gap: 12 }}>

          {/* ── Latency section ── */}
          <div>
            <div style={{ fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.11em", color: "rgba(168,85,247,0.50)", marginBottom: 6 }}>
              End-to-end latency (ms) &nbsp;
              <span style={{ fontWeight: 400, color: "rgba(255,255,255,0.22)" }}>green &lt;500 · yellow &lt;1000 · red &gt;1000</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <LatBar
                label="Stage 1 — Detection → Rule matched"
                hint="Empire WS event received → sync rule-check pass completed. Should be ~0ms (pure CPU)."
                stat={stats?.latency?.detectionToMatch}
                target={50}
              />
              <LatBar
                label="Stage 2 — Match → AlertLog created"
                hint="Rule matched → AlertLog.create() returned. This is the MongoDB write time."
                stat={stats?.latency?.matchToCreated}
                target={50}
              />
              <LatBar
                label="Stage 3 — AlertLog created → Push started"
                hint="AlertLog created → sendPushToUser() called. Should be ~0ms (just socket emit in between)."
                stat={stats?.latency?.createdToPushStart}
                target={10}
              />
              <LatBar
                label="Stage 4 — Detection → Browser (client)"
                hint="Market item detected → price_alert socket event received in this browser tab. Measured live from _detectedAt in each alert payload."
                stat={clientStats}
                target={1000}
              />
              <LatBar
                label="Stage 5 — Detection → Mobile push ACK"
                hint="Market item detected → Firebase Admin sendEachForMulticast() returned successfully. Includes MongoDB write + Firebase RTT."
                stat={stats?.latency?.detectionToPush}
                target={1000}
              />
            </div>
          </div>

          {/* ── Dedupe explanation ── */}
          {stats && (stats.alertsSkippedDedupe > 0 || stats.alertsSkippedCooldown > 0) && (
            <div style={{ padding: "9px 12px", borderRadius: 8, background: "rgba(251,191,36,0.04)", border: "1px solid rgba(251,191,36,0.14)" }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.09em", color: "rgba(251,191,36,0.60)", marginBottom: 5 }}>
                Why matches &gt; alerts created?
              </div>
              <p style={{ margin: 0, fontSize: 11, color: "rgba(255,255,255,0.40)", lineHeight: 1.6 }}>
                <strong style={{ color: "rgba(255,255,255,0.55)" }}>Dedupe ({stats.alertsSkippedDedupe.toLocaleString()} skipped):</strong>{" "}
                Empire's WS stream sends the same item repeatedly while it's listed. Once you've been alerted for an item+rule pair, re-alerts are suppressed. This is correct — your feed already contains those items.
              </p>
              {stats.alertsSkippedCooldown > 0 && (
                <p style={{ margin: "6px 0 0", fontSize: 11, color: "rgba(255,255,255,0.40)", lineHeight: 1.6 }}>
                  <strong style={{ color: "rgba(255,255,255,0.55)" }}>Cooldown ({stats.alertsSkippedCooldown.toLocaleString()} skipped):</strong>{" "}
                  Same item reappeared after its AlertLog was deleted (item sold &amp; relisted), but the cooldown window is still active.
                </p>
              )}
            </div>
          )}

          {/* ── Counters section ── */}
          <div>
            <div style={{ fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.11em", color: "rgba(34,211,238,0.50)", marginBottom: 6 }}>
              Pipeline counters — since server start
            </div>
            {countChips.length > 0 ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 5 }}>
                {countChips.map(c => (
                  <div key={c.label} title={c.hint} style={{
                    padding: "8px 10px", borderRadius: 7,
                    background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)",
                  }}>
                    <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.09em", color: "rgba(255,255,255,0.28)", marginBottom: 3 }}>
                      {c.label}
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: c.color, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
                      {(c.value ?? 0).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.22)", fontStyle: "italic" }}>loading…</span>
            )}
          </div>

          {/* ── Actions ── */}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onRefresh} style={{
              padding: "6px 13px", borderRadius: 7, fontSize: 11.5, fontWeight: 600,
              border: "1px solid rgba(168,85,247,0.22)", background: "rgba(168,85,247,0.07)",
              color: "rgba(196,132,252,0.85)", cursor: "pointer", fontFamily: "inherit",
            }}>
              Refresh
            </button>
            <button onClick={onReset} style={{
              padding: "6px 13px", borderRadius: 7, fontSize: 11.5, fontWeight: 600,
              border: "1px solid rgba(255,255,255,0.08)", background: "transparent",
              color: "rgba(255,255,255,0.30)", cursor: "pointer", fontFamily: "inherit",
            }}>
              Reset all
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Main page ───────────────────────────────────────── */

export default function Alerts() {
  const [alerts,       setAlerts]       = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [markingAll,   setMarkingAll]   = useState(false);
  const [pageError,    setPageError]    = useState("");
  const [auctionRules, setAuctionRules] = useState([]);
  const [rulesLoading, setRulesLoading] = useState(true);
  const [showForm,     setShowForm]     = useState(false);
  const [sidebarOpen,  setSidebarOpen]  = useState(false);
  const [sidebarTitle, setSidebarTitle] = useState("");
  const [sidebarItems, setSidebarItems] = useState([]);

  const push = usePushNotifications();

  // Sort + filter with localStorage persistence
  const [feedSort,   setFeedSort]   = useState(() => localStorage.getItem(LS_SORT)   || "profit");
  const [feedFilter, setFeedFilter] = useState(() => localStorage.getItem(LS_FILTER) || "all");

  useEffect(() => { localStorage.setItem(LS_SORT,   feedSort);   }, [feedSort]);
  useEffect(() => { localStorage.setItem(LS_FILTER, feedFilter); }, [feedFilter]);

  const unreadCount = useMemo(() => alerts.filter(a => !a.isRead).length, [alerts]);
  const activeRules = useMemo(() => auctionRules.filter(r => r.enabled).length,  [auctionRules]);

  /* ── Data loaders ── */

  async function loadAlerts() {
    try {
      setLoading(true); setPageError("");
      const res  = await api.get("/alerts");
      const list = Array.isArray(res.data?.alerts) ? res.data.alerts
        : Array.isArray(res.data) ? res.data : [];
      setAlerts(list);
    } catch (e) {
      setPageError(e?.response?.data?.error || "Failed to load alerts.");
    } finally { setLoading(false); }
  }

  async function loadRules() {
    try {
      setRulesLoading(true);
      const res = await api.get("/auction-alerts");
      setAuctionRules(Array.isArray(res.data?.rules) ? res.data.rules : []);
    } catch { }
    finally { setRulesLoading(false); }
  }

  /* ── Alert actions ── */

  // Stable callbacks — useCallback with [] so memo on FeedRow is not broken
  // by new function references on every parent render.
  const openAlertDetails = useCallback(async (alert) => {
    setSidebarTitle(alert.marketHashName || alert.name || "Item");
    setSidebarItems([normalizeItem(alert)]);
    setSidebarOpen(true);
    if (!alert.itemId) return;
    try {
      const res = await api.get(`/items/${alert.itemId}/details`);
      const raw = res?.data?.item || res?.data?.data?.item || res?.data?.data || res?.data;
      setSidebarItems([normalizeItem({ ...alert, ...raw })]);
    } catch { }
  }, []);

  const markAsRead = useCallback(async (alertId) => {
    try {
      await api.patch(`/alerts/${alertId}/read`);
      setAlerts(p => p.map(a => a._id === alertId ? { ...a, isRead: true } : a));
    } catch { }
  }, []);

  async function markAllAsRead() {
    try {
      setMarkingAll(true);
      await api.patch("/alerts/read-all");
      setAlerts(p => p.map(a => ({ ...a, isRead: true })));
    } catch { }
    finally { setMarkingAll(false); }
  }

  const deleteAlert = useCallback(async (alertId) => {
    try {
      await api.delete(`/alerts/${alertId}`);
      setAlerts(p => p.filter(a => a._id !== alertId));
    } catch { }
  }, []);

  /* ── WebSocket alerts ── */

  useEffect(() => { loadAlerts(); loadRules(); }, []);

  useEffect(() => {
    let mounted = true;

    function onAlert(e) {
      const alert = e.detail;
      if (!mounted || !alert) return;
      const incoming = {
        ...alert,
        _id:    alert._id || alert.id || `${alert.itemId}-${Date.now()}`,
        isRead: false,
        _isNew: true,
        status: "live",
      };
      setAlerts(prev => {
        // Replace any existing entry for the same itemId so the feed stays
        // deduplicated, then prepend the freshest alert.
        const withoutOld = prev.filter(a => String(a.itemId) !== String(alert.itemId));
        return [incoming, ...withoutOld];
      });
    }

    function onDeleted(e) {
      const { itemId } = e.detail || {};
      if (!mounted || !itemId) return;
      // Remove entirely — deleted items should not appear in the feed at all.
      setAlerts(prev => prev.filter(a => String(a.itemId) !== String(itemId)));
    }

    function onExpired(e) {
      const { alertIds } = e.detail || {};
      if (!mounted || !Array.isArray(alertIds) || !alertIds.length) return;
      const idSet = new Set(alertIds.map(String));
      setAlerts(prev => prev.filter(a => !idSet.has(String(a._id))));
    }

    window.addEventListener("price_alert",  onAlert);
    window.addEventListener("item_deleted", onDeleted);
    window.addEventListener("alert_expired", onExpired);
    return () => {
      mounted = false;
      window.removeEventListener("price_alert",  onAlert);
      window.removeEventListener("item_deleted", onDeleted);
      window.removeEventListener("alert_expired", onExpired);
    };
  }, []);

  /* ── Sort + filter logic ── */

  const profitOf = a => a.source === "auction-alert"
    ? Number(a.suggestedCoins || 0) - Number(a.priceCoins || 0)
    : (Number(a.discountPct || 0) * Number(a.priceCoins || 0) / 100);

  const timeOf = a => new Date(a.triggeredAt || a.createdAt || 0).getTime();

  const displayedAlerts = useMemo(() => {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);

    // Defensive: never render expired/deleted alerts regardless of how they
    // arrived (page load, socket, stale state). API already filters these out
    // but keep the guard here so the UI never renders stale entries.
    let items = alerts.filter(a => !a.status || a.status === "live");

    if (feedFilter === "auction")   items = items.filter(a => a.source === "auction-alert");
    if (feedFilter === "watchlist") items = items.filter(a => a.source !== "auction-alert");
    if (feedFilter === "profit")    items = items.filter(a => profitOf(a) > 0 || Number(a.discountPct || 0) > 0);
    if (feedFilter === "unread")    items = items.filter(a => !a.isRead);
    if (feedFilter === "today")     items = items.filter(a => {
      const ts = a.triggeredAt || a.createdAt;
      return ts && new Date(ts) >= todayStart;
    });

    return [...items].sort((a, b) => {
      if (feedSort === "profit")    return profitOf(b) - profitOf(a);
      if (feedSort === "newest")    return timeOf(b) - timeOf(a);
      if (feedSort === "price")     return Number(b.priceCoins || 0) - Number(a.priceCoins || 0);
      if (feedSort === "auction")   return (a.source === "auction-alert" ? 0 : 1) - (b.source === "auction-alert" ? 0 : 1);
      if (feedSort === "watchlist") return (a.source !== "auction-alert" ? 0 : 1) - (b.source !== "auction-alert" ? 0 : 1);
      return timeOf(b) - timeOf(a);
    });
  }, [alerts, feedFilter, feedSort]);

  /* ─── Render ─────────────────────────────────────────────────── */

  return (
    <div className="min-h-screen text-white" style={{ background: "#07080f", position: "relative" }}>
      <style>{`
        @keyframes liveDot       { 0%,100%{opacity:1} 50%{opacity:0.30} }
        @keyframes rowSlideIn    { from{opacity:0;transform:translateY(-6px)} to{opacity:1;transform:translateY(0)} }
        @keyframes alertNebula   { 0%,100%{opacity:0.62;transform:scale(1) translateX(0)} 50%{opacity:0.90;transform:scale(1.06) translateX(10px)} }
        @keyframes charBreath    { 0%,100%{opacity:0.84} 50%{opacity:0.97} }
        @keyframes streakDrift   { 0%,100%{opacity:0.05;transform:translateY(0)} 50%{opacity:0.11;transform:translateY(-14px)} }
        @keyframes blobFloat     { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(14px,-20px) scale(1.07)} }
        @keyframes particlePulse { 0%,100%{opacity:0.14;transform:scale(1)} 50%{opacity:0.32;transform:scale(1.6)} }
      `}</style>

      {/* ── Fixed cinematic background ── */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0, overflow: "hidden" }}>

        {/* Nebula base — multiple layered gradients */}
        <div style={{
          position: "absolute", inset: 0,
          background: [
            "radial-gradient(ellipse 74% 78% at 4% 62%, rgba(88,28,135,0.26) 0%, transparent 62%)",
            "radial-gradient(ellipse 50% 48% at 92% 18%, rgba(34,211,238,0.05) 0%, transparent 55%)",
            "radial-gradient(ellipse 55% 52% at 72% 88%, rgba(109,40,217,0.11) 0%, transparent 58%)",
            "radial-gradient(ellipse 42% 36% at 38% 8%, rgba(168,85,247,0.05) 0%, transparent 50%)",
          ].join(","),
          animation: "alertNebula 20s ease-in-out infinite",
        }} />

        {/* Floating nebula fog blobs */}
        <div style={{
          position: "absolute", left: "1%", top: "10%", width: 400, height: 480,
          background: "radial-gradient(ellipse at 35% 45%, rgba(88,28,135,0.24) 0%, rgba(109,40,217,0.12) 45%, transparent 72%)",
          filter: "blur(64px)",
          animation: "blobFloat 24s ease-in-out infinite",
        }} />
        <div style={{
          position: "absolute", left: "5%", bottom: "4%", width: 340, height: 400,
          background: "radial-gradient(ellipse at 45% 55%, rgba(139,92,246,0.22) 0%, transparent 68%)",
          filter: "blur(52px)",
          animation: "blobFloat 30s ease-in-out infinite",
          animationDelay: "-12s",
        }} />

        {/* Subtle grid */}
        <div style={{
          position: "absolute", inset: 0,
          backgroundImage: [
            "linear-gradient(rgba(168,85,247,0.012) 1px, transparent 1px)",
            "linear-gradient(90deg, rgba(168,85,247,0.012) 1px, transparent 1px)",
          ].join(","),
          backgroundSize: "72px 72px",
        }} />

        {/* Vertical light streaks */}
        {[["22%","8%","75%"],["55%","15%","68%"],["81%","5%","82%"]].map(([x,t,h],i) => (
          <div key={i} style={{
            position:"absolute", left:x, top:t, width:1, height:h,
            background:"linear-gradient(180deg, transparent 0%, rgba(168,85,247,0.09) 38%, rgba(168,85,247,0.06) 62%, transparent 100%)",
            animation:`streakDrift ${14+i*4}s ease-in-out infinite`,
            animationDelay:`${i*3}s`,
          }} />
        ))}

        {/* Stars — mix of purple and white dots, some animated */}
        {BG_STARS.map(([x, y, sz, op], i) => (
          <div key={i} style={{
            position: "absolute", left: `${x}%`, top: `${y}%`,
            width: sz, height: sz, borderRadius: "50%",
            background: i % 6 === 0 ? `rgba(255,255,255,${op * 0.85})` : `rgba(168,85,247,${op})`,
            boxShadow: sz > 1 ? `0 0 ${sz * 3}px rgba(168,85,247,${op * 0.5})` : "none",
            animation: i % 4 === 0 ? `particlePulse ${7 + (i % 5) * 1.2}s ease-in-out infinite` : "none",
            animationDelay: `${(i * 0.35) % 6}s`,
          }} />
        ))}

        {/* ── Character — cinematic, bottom-left, large (lg screens only) ── */}
        <div className="hidden lg:block" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>

          {/* Deep atmospheric glow behind character */}
          <div style={{
            position: "absolute", bottom: "-6%", left: "-8%", width: "52%", height: "84%",
            background: "radial-gradient(ellipse 62% 72% at 32% 90%, rgba(88,28,135,0.50) 0%, rgba(109,40,217,0.28) 40%, transparent 70%)",
            filter: "blur(64px)",
          }} />

          {/* Cyan rim accent */}
          <div style={{
            position: "absolute", bottom: "9%", left: "26%", width: 2, height: "46%",
            background: "linear-gradient(180deg, transparent, rgba(34,211,238,0.30), rgba(34,211,238,0.14), transparent)",
          }} />

          {/* Character — positioned freely at bottom-left, much larger */}
          <img
            src={avatarAlertImg}
            alt="" aria-hidden="true" draggable={false}
            style={{
              position: "absolute",
              bottom: 0,
              left: "-1%",
              height: "88vh",
              maxHeight: 960,
              width: "auto",
              objectFit: "contain",
              objectPosition: "bottom left",
              filter: "drop-shadow(0 0 56px rgba(168,85,247,0.52)) drop-shadow(0 0 120px rgba(109,40,217,0.26))",
              maskImage: "radial-gradient(ellipse 72% 96% at 16% 100%, black 0%, rgba(0,0,0,0.95) 15%, rgba(0,0,0,0.82) 35%, rgba(0,0,0,0.52) 56%, rgba(0,0,0,0.18) 74%, transparent 90%)",
              WebkitMaskImage: "radial-gradient(ellipse 72% 96% at 16% 100%, black 0%, rgba(0,0,0,0.95) 15%, rgba(0,0,0,0.82) 35%, rgba(0,0,0,0.52) 56%, rgba(0,0,0,0.18) 74%, transparent 90%)",
              userSelect: "none",
              animation: "charBreath 9s ease-in-out infinite",
            }}
          />
        </div>
      </div>

      {/* ── Content — full width, centered ── */}
      <div style={{ position: "relative", zIndex: 1, minHeight: "100vh" }}>
          <div style={{ maxWidth: 940, margin: "0 auto", padding: "clamp(20px,5vw,44px) clamp(12px,4vw,28px) 100px", display: "flex", flexDirection: "column", gap: "clamp(24px,5vw,40px)" }}>

            {/* ── PAGE HEADER ── */}
            <header style={{ display: "flex", flexWrap: "wrap", gap: "clamp(12px,3vw,20px)", alignItems: "flex-start", justifyContent: "space-between" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <span style={{
                    width: 6, height: 6, borderRadius: "50%", background: "#22d3ee",
                    display: "inline-block", animation: "liveDot 2.5s ease-in-out infinite",
                  }} />
                  <span style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.18em", color: "rgba(34,211,238,0.55)" }}>
                    Live
                  </span>
                </div>

                <h1 style={{
                  fontSize: 32, fontWeight: 800, letterSpacing: "-0.025em", lineHeight: 1, margin: "0 0 10px",
                  background: "linear-gradient(135deg, #fff 30%, rgba(168,85,247,0.80) 100%)",
                  WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
                }}>
                  Alerts Center
                </h1>

                <p style={{ fontSize: 13, color: "rgba(255,255,255,0.38)", lineHeight: 1.65, maxWidth: 400, margin: 0 }}>
                  Real-time profit alerts for auction sniping and watchlist deals.
                </p>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                {/* Stats strip */}
                <div style={{
                  display: "flex", alignItems: "center", gap: 0,
                  borderRadius: 10, overflow: "hidden",
                  border: "1px solid rgba(168,85,247,0.16)",
                  background: "rgba(168,85,247,0.03)", backdropFilter: "blur(8px)",
                }}>
                  <Stat label="Unread" value={unreadCount} highlight={unreadCount > 0} />
                  <div style={{ width: 1, alignSelf: "stretch", background: "rgba(255,255,255,0.06)" }} />
                  <Stat label="Rules" value={auctionRules.length} />
                  <div style={{ width: 1, alignSelf: "stretch", background: "rgba(255,255,255,0.06)" }} />
                  <Stat label="Active" value={activeRules} />
                </div>

                <div style={{ width: 1, height: 28, background: "rgba(255,255,255,0.07)" }} />

                <GhostBtn onClick={loadAlerts} disabled={loading}>
                  {loading ? "Loading…" : "Refresh"}
                </GhostBtn>
                <GhostBtn onClick={markAllAsRead} disabled={markingAll || !unreadCount}>
                  {markingAll ? "…" : "Mark all read"}
                </GhostBtn>

                <a
                  href="/alerts/debug"
                  style={{
                    height: 30, padding: "0 12px", borderRadius: 7, display: "flex", alignItems: "center",
                    fontSize: 12, fontWeight: 600, letterSpacing: "0.05em", whiteSpace: "nowrap",
                    color: "rgba(255,255,255,0.28)", border: "1px solid rgba(255,255,255,0.07)",
                    background: "transparent", textDecoration: "none", transition: "all 0.15s",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.color = "rgba(255,255,255,0.55)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.14)"; }}
                  onMouseLeave={e => { e.currentTarget.style.color = "rgba(255,255,255,0.28)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.07)"; }}
                >
                  Debug
                </a>

                {/* Push alerts toggle */}
                <PushToggle push={push} />
              </div>
            </header>

            {pageError && (
              <div style={{
                padding: "11px 16px", borderRadius: 10, fontSize: 13, color: "#fca5a5",
                background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.14)",
              }}>
                {pageError}
              </div>
            )}

            {/* ── AUCTION PROFIT RULES ── */}
            <section>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:12, marginBottom:16 }}>
                <div>
                  <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
                    <svg width={13} height={13} fill="none" viewBox="0 0 24 24" stroke="rgba(168,85,247,0.80)" strokeWidth={2}>
                      <circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3" />
                      <line x1="3" y1="12" x2="9" y2="12" /><line x1="15" y1="12" x2="21" y2="12" />
                      <line x1="12" y1="3" x2="12" y2="9" /><line x1="12" y1="15" x2="12" y2="21" />
                    </svg>
                    <h2 style={{ fontSize:15, fontWeight:700, color:"rgba(255,255,255,0.88)", margin:0 }}>
                      Auction Profit Rules
                    </h2>
                    {!rulesLoading && activeRules > 0 && (
                      <span style={{
                        fontSize:10, fontWeight:700, padding:"2px 7px", borderRadius:5,
                        background:"rgba(74,222,128,0.09)", border:"1px solid rgba(74,222,128,0.18)", color:"#4ade80",
                      }}>
                        {activeRules} active
                      </span>
                    )}
                  </div>
                  <p style={{ fontSize:12, color:"rgba(255,255,255,0.28)", margin:0 }}>
                    Trigger when auction profit exceeds configured threshold
                  </p>
                </div>

                <button
                  onClick={() => setShowForm(v => !v)}
                  style={{
                    padding:"7px 14px", borderRadius:8, fontSize:12.5, fontWeight:600,
                    cursor:"pointer", fontFamily:"inherit", transition:"all 0.15s",
                    border: showForm ? "1px solid rgba(255,255,255,0.09)" : "1px solid rgba(168,85,247,0.25)",
                    background: showForm ? "rgba(255,255,255,0.04)" : "rgba(168,85,247,0.09)",
                    color: showForm ? "rgba(255,255,255,0.38)" : "#c084fc",
                  }}
                >
                  {showForm ? "Cancel" : "+ New Rule"}
                </button>
              </div>

              {showForm && (
                <div style={{
                  marginBottom:14, padding:"18px 20px", borderRadius:14,
                  background:"rgba(168,85,247,0.04)", border:"1px solid rgba(168,85,247,0.16)",
                  backdropFilter:"blur(8px)",
                }}>
                  <NewRuleForm
                    onCreated={rule => { setAuctionRules(p => [rule, ...p]); setShowForm(false); }}
                    onCancel={() => setShowForm(false)}
                  />
                </div>
              )}

              <div style={{
                borderRadius:14, border:"1px solid rgba(255,255,255,0.07)",
                background:"rgba(255,255,255,0.02)", backdropFilter:"blur(8px)", overflow:"hidden",
              }}>
                {rulesLoading ? (
                  <div style={{ padding:16 }}><Skeletons count={2} height={52} /></div>
                ) : auctionRules.length === 0 ? (
                  <EmptyRules onAdd={() => setShowForm(true)} />
                ) : (
                  <div style={{ padding:"10px 12px", display:"flex", flexDirection:"column", gap:4 }}>
                    {auctionRules.map(rule => (
                      <RuleRow
                        key={rule._id}
                        rule={rule}
                        onDelete={id => setAuctionRules(p => p.filter(r => r._id !== id))}
                        onToggle={updated => setAuctionRules(p => p.map(r => r._id === updated._id ? updated : r))}
                      />
                    ))}
                  </div>
                )}
              </div>
            </section>

            {/* ── ALERT FEED ── */}
            <section>
              <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:16, flexWrap:"wrap", gap:10 }}>
                <div>
                  <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
                    <svg width={13} height={13} fill="none" viewBox="0 0 24 24" stroke="rgba(34,211,238,0.75)" strokeWidth={2}>
                      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                    </svg>
                    <h2 style={{ fontSize:15, fontWeight:700, color:"rgba(255,255,255,0.90)", margin:0 }}>
                      Alert Feed
                    </h2>
                  </div>
                  <p style={{ fontSize:12, color:"rgba(255,255,255,0.28)", margin:0 }}>
                    Watchlist deals and auction snipes — sorted and filtered below
                  </p>
                </div>
              </div>

              {/* Filter + Sort */}
              <FilterSortBar
                filter={feedFilter}
                sort={feedSort}
                onFilter={setFeedFilter}
                onSort={setFeedSort}
                unreadCount={unreadCount}
                filteredCount={displayedAlerts.length}
              />

              {loading ? (
                <Skeletons count={5} height={78} />
              ) : displayedAlerts.length === 0 ? (
                feedFilter === "all" ? <EmptyFeed /> : (
                  <div style={{
                    textAlign:"center", padding:"48px 24px",
                    borderRadius:12, border:"1px solid rgba(255,255,255,0.06)",
                    background:"rgba(255,255,255,0.02)",
                  }}>
                    <p style={{ fontSize:13.5, color:"rgba(255,255,255,0.28)", margin:0 }}>
                      No alerts match this filter.
                    </p>
                  </div>
                )
              ) : (
                <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
                  {displayedAlerts.map(alert => {
                    const isAuction   = alert.source === "auction-alert";
                    const profitCoins = isAuction
                      ? Number(alert.suggestedCoins || 0) - Number(alert.priceCoins || 0)
                      : null;
                    const discount = Number(alert.discountPct ?? 0);
                    const floatVal = alert.floatValue ?? alert.float ?? alert.wearFloat ?? null;

                    return (
                      <FeedRow
                        key={alert._id}
                        alert={alert}
                        isAuction={isAuction}
                        profitCoins={profitCoins}
                        discount={discount}
                        floatVal={floatVal}
                        isNew={Boolean(alert._isNew)}
                        onOpen={openAlertDetails}
                        onMarkRead={markAsRead}
                        onDelete={deleteAlert}
                      />
                    );
                  })}
                </div>
              )}
            </section>

          </div>
      </div>

      <PriceSidebar
        open={sidebarOpen}
        title={sidebarTitle}
        items={sidebarItems}
        onClose={() => setSidebarOpen(false)}
      />
    </div>
  );
}
