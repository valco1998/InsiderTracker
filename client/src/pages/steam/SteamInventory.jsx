import { useState, useEffect, useCallback, useRef } from "react";
import api from "../../lib/api";
import steamLogoImg from "../../assets/Steam_icon_logo.png";
import { STEAM_LOGIN_URL } from "../../lib/config";

/* ─── Rarity palette ───────────────────────────────── */
const RARITY_COLORS = {
  "Consumer Grade":   "#B0C3D9",
  "Industrial Grade": "#5E98D9",
  "Mil-Spec Grade":   "#4B69FF",
  "Restricted":       "#8847FF",
  "Classified":       "#D32CE6",
  "Covert":           "#EB4B4B",
  "Contraband":       "#E4AE33",
  "Base Grade":       "#B0C3D9",
};

function getRarity(item) {
  if (item.rarity) return item.rarity;
  const t = (item.tags || []).find(x => x.category === "Rarity");
  if (!t) return null;
  return { name: t.localized_tag_name, color: t.color ? `#${t.color}` : null };
}
function getExterior(item) {
  if (item.exterior) return item.exterior;
  const t = (item.tags || []).find(x => x.category === "Exterior");
  return t ? t.localized_tag_name : null;
}
function rarityColor(r) {
  if (!r) return "#64748b";
  return r.color || RARITY_COLORS[r.name] || "#64748b";
}
function timeAgo(iso) {
  if (!iso) return "";
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60_000), h = Math.floor(m / 60), day = Math.floor(h / 24);
  if (day > 0) return `${day}d ago`;
  if (h   > 0) return `${h}h ago`;
  if (m   > 0) return `${m}m ago`;
  return "just now";
}

/* ─── Skin card ─────────────────────────────────────── */
function SkinCard({ item }) {
  const [imgFailed, setImgFailed] = useState(false);
  const rarity   = getRarity(item);
  const exterior = getExterior(item);
  const color    = rarityColor(rarity);
  const isImported = item._source === "imported";

  return (
    <div
      style={{
        position: "relative",
        background: isImported ? "rgba(168,85,247,0.04)" : "rgba(255,255,255,0.035)",
        borderTop:    `2px solid ${isImported ? "rgba(168,85,247,0.25)" : color + "33"}`,
        borderRight:  "1px solid rgba(255,255,255,0.07)",
        borderBottom: "1px solid rgba(255,255,255,0.07)",
        borderLeft:   "1px solid rgba(255,255,255,0.07)",
        borderRadius: 10,
        padding: "12px 10px 10px",
        display: "flex", flexDirection: "column", gap: 8,
        overflow: "hidden", transition: "background 0.15s",
      }}
      onMouseEnter={e => e.currentTarget.style.background = isImported ? "rgba(168,85,247,0.07)" : "rgba(255,255,255,0.055)"}
      onMouseLeave={e => e.currentTarget.style.background = isImported ? "rgba(168,85,247,0.04)" : "rgba(255,255,255,0.035)"}
    >
      {isImported && (
        <div style={{ position:"absolute", top:6, left:6, fontSize:8, fontWeight:700, letterSpacing:"0.06em", textTransform:"uppercase", background:"rgba(168,85,247,0.15)", border:"1px solid rgba(168,85,247,0.3)", color:"rgba(168,85,247,0.9)", borderRadius:4, padding:"1px 5px", lineHeight:"14px", zIndex:1 }}>
          Synced
        </div>
      )}

      <div style={{ width:"100%", aspectRatio:"1/1", display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(0,0,0,0.2)", borderRadius:7, overflow:"hidden" }}>
        {item.iconUrl && !imgFailed
          ? <img src={item.iconUrl} alt={item.name} loading="lazy" style={{ width:"90%", height:"90%", objectFit:"contain" }} onError={() => setImgFailed(true)} />
          : <div style={{ fontSize:28, opacity:0.12 }}>🔫</div>}
      </div>

      <div style={{ fontSize:11, fontWeight:600, color:"rgba(255,255,255,0.82)", lineHeight:1.3, wordBreak:"break-word", paddingTop: isImported ? 6 : 0 }}>
        {item.name || item.marketHashName || item.market_hash_name}
      </div>

      <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
        {rarity && (
          <span style={{ fontSize:10.5, fontWeight:700, letterSpacing:"0.04em", textTransform:"uppercase", color: rarityColor(rarity), background:`${rarityColor(rarity)}18`, border:`1px solid ${rarityColor(rarity)}33`, borderRadius:4, padding:"2px 6px", lineHeight:"16px" }}>
            {rarity.name}
          </span>
        )}
        {exterior && (
          <span style={{ fontSize:10.5, color:"rgba(255,255,255,0.45)", background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:4, padding:"2px 6px", lineHeight:"16px" }}>
            {exterior}
          </span>
        )}
      </div>

      {(!item.tradable || !item.marketable) && (
        <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
          {!item.tradable   && <span style={{ fontSize:10.5, fontWeight:600, color:"rgba(239,68,68,0.75)", background:"rgba(239,68,68,0.08)", border:"1px solid rgba(239,68,68,0.18)", borderRadius:4, padding:"2px 6px", lineHeight:"16px" }}>Not tradable</span>}
          {!item.marketable && <span style={{ fontSize:10.5, fontWeight:600, color:"rgba(239,68,68,0.75)", background:"rgba(239,68,68,0.08)", border:"1px solid rgba(239,68,68,0.18)", borderRadius:4, padding:"2px 6px", lineHeight:"16px" }}>Not marketable</span>}
        </div>
      )}
    </div>
  );
}

function RarityChip({ rarity, active, onClick }) {
  const color = RARITY_COLORS[rarity] || "#64748b";
  return (
    <button onClick={onClick} style={{ fontSize:10, fontWeight:600, letterSpacing:"0.04em", textTransform:"uppercase", color: active ? color : "rgba(255,255,255,0.35)", background: active ? `${color}18` : "rgba(255,255,255,0.04)", border: active ? `1px solid ${color}44` : "1px solid rgba(255,255,255,0.08)", borderRadius:6, padding:"4px 10px", cursor:"pointer", flexShrink:0, fontFamily:"inherit" }}>
      {rarity}
    </button>
  );
}

function SteamIcon({ size = 18 }) {
  return (
    <img
      src={steamLogoImg}
      alt="Steam"
      style={{ width: size, height: size, objectFit: "contain", flexShrink: 0 }}
    />
  );
}

/* ─── Extension sync panel ──────────────────────────── */
function ExtensionPanel({ loading, importedAt, itemCount, onClear, clearing }) {
  const hasItems = itemCount > 0;
  return (
    <div style={{ marginBottom:20, borderRadius:10, border:"1px solid rgba(168,85,247,0.2)", background:"rgba(168,85,247,0.03)", overflow:"hidden" }}>
      <div style={{ height:2, background:"rgba(168,85,247,0.4)" }} />
      <div style={{ padding:"14px 18px", display:"flex", flexDirection:"column", gap:10 }}>

        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:8 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <span style={{ fontSize:13, fontWeight:700, color:"rgba(255,255,255,0.8)" }}>SKINTEL Extension</span>
            {loading ? (
              <span style={{ fontSize:11, color:"rgba(168,85,247,0.5)" }}>Loading…</span>
            ) : hasItems ? (
              <span style={{ fontSize:11, color:"rgba(168,85,247,0.85)", background:"rgba(168,85,247,0.12)", border:"1px solid rgba(168,85,247,0.25)", borderRadius:5, padding:"2px 9px", fontWeight:600 }}>
                {itemCount.toLocaleString()} items synced · {timeAgo(importedAt)}
              </span>
            ) : (
              <span style={{ fontSize:11, color:"rgba(255,255,255,0.28)" }}>No synced inventory</span>
            )}
          </div>
          {hasItems && (
            <button onClick={onClear} disabled={clearing}
              style={{ fontSize:11, fontWeight:600, color:"rgba(239,68,68,0.6)", background:"rgba(239,68,68,0.07)", border:"1px solid rgba(239,68,68,0.15)", borderRadius:6, padding:"3px 10px", cursor: clearing ? "not-allowed" : "pointer", fontFamily:"inherit" }}>
              {clearing ? "Clearing…" : "Clear synced data"}
            </button>
          )}
        </div>

        {!loading && !hasItems && (
          <div style={{ fontSize:11, lineHeight:1.65, color:"rgba(255,255,255,0.32)", padding:"8px 12px", background:"rgba(0,0,0,0.2)", borderRadius:8 }}>
            <strong style={{ color:"rgba(255,255,255,0.5)" }}>How to import:</strong>
            <ol style={{ marginTop:5, paddingLeft:16, display:"flex", flexDirection:"column", gap:3 }}>
              <li>Load <code style={{ background:"rgba(255,255,255,0.07)", padding:"0 4px", borderRadius:3 }}>extension/</code> in Chrome → <em>chrome://extensions</em> → Developer mode → Load unpacked</li>
              <li>Log in with Steam on this site (already done ✓)</li>
              <li>Open <a href="https://steamcommunity.com" target="_blank" rel="noopener noreferrer" style={{ color:"rgba(168,85,247,0.7)" }}>steamcommunity.com</a> → Profile → Inventory</li>
              <li>Click the extension icon → <strong>Import CS2 Inventory</strong></li>
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   Main page
═══════════════════════════════════════════════════════ */
export default function SteamInventory() {
  /* Profile — loads in background, doesn't block UI */
  const [profile, setProfile] = useState(null);

  /* Synced inventory — PRIMARY source, drives spinner */
  const [syncedItems, setSyncedItems]   = useState([]);
  const [syncedAt, setSyncedAt]         = useState(null);
  const [syncedCount, setSyncedCount]   = useState(0);
  const [syncedLoading, setSyncedLoading] = useState(true);
  const [clearing, setClearing]         = useState(false);

  /* Steam public API — background only, never blocks spinner */
  const [steamItems, setSteamItems]     = useState([]);
  const [steamLoading, setSteamLoading] = useState(false);
  const [steamMsg, setSteamMsg]         = useState(null);
  const [isCached, setIsCached]         = useState(false);
  const [fetchedAt, setFetchedAt]       = useState(null);
  const [steamIdInput, setSteamIdInput] = useState("");
  const [loadedId, setLoadedId]         = useState(null);

  /* Filters */
  const [search, setSearch]                 = useState("");
  const [rarityFilter, setRarityFilter]     = useState(null);
  const [onlyTradable, setOnlyTradable]     = useState(false);
  const [onlyMarketable, setOnlyMarketable] = useState(false);

  /* Track if Steam fallback has already been auto-triggered */
  const steamAutoTriggered = useRef(false);

  /* ── Load synced inventory (fast MongoDB, ~100ms) ── */
  const loadSynced = useCallback(async () => {
    try {
      const res = await api.get("/steam/inventory");
      if (res.data.ok) {
        setSyncedItems((res.data.items || []).map(i => ({
          ...i,
          _source: "imported",
          iconUrl: i.iconUrl || i.icon_url || "",
        })));
        setSyncedAt(res.data.importedAt || null);
        setSyncedCount(res.data.itemCount || 0);
      }
    } catch {
      // network error — leave state as-is
    } finally {
      setSyncedLoading(false);
    }
  }, []);

  /* ── Clear synced inventory ── */
  const clearSynced = useCallback(async () => {
    setClearing(true);
    try {
      await api.delete("/steam/imported-inventory");
      setSyncedItems([]); setSyncedAt(null); setSyncedCount(0);
    } catch {
      // ignore
    } finally {
      setClearing(false);
    }
  }, []);

  /* ── Steam public API with 5-second timeout ── */
  const loadSteamPublic = useCallback(async (id) => {
    const clean = String(id || "").trim();
    if (!clean || !/^\d{17}$/.test(clean)) return;
    setSteamLoading(true); setSteamMsg(null); setSteamItems([]); setLoadedId(clean);
    try {
      const res = await api.get(`/steam/inventory/${clean}`, { timeout: 5000 });
      if (res.data.ok) {
        setSteamItems((res.data.items || []).map(i => ({ ...i, _source: "steam", iconUrl: i.iconUrl || "" })));
        setIsCached(!!res.data.cached);
        setFetchedAt(res.data.fetchedAt || null);
        if (!res.data.items?.length) setSteamMsg(res.data.message || "Steam public inventory returned no items.");
      } else {
        setSteamMsg(res.data.message || "Steam public inventory failed.");
      }
    } catch (e) {
      const isTimeout = e.code === "ECONNABORTED" || e.message?.includes("timeout");
      setSteamMsg(isTimeout
        ? "Steam public inventory timed out. Use the extension to sync your items."
        : "Could not reach Steam public inventory.");
    } finally {
      setSteamLoading(false);
    }
  }, []);

  /* ── Init: synced items first, profile in background ── */
  useEffect(() => {
    // 1. Load synced items immediately — this is what drives the spinner
    loadSynced();

    // 2. Load profile in background (doesn't block anything)
    api.get("/steam/me")
      .then(res => {
        const p = res.data?.user ?? null;
        setProfile(p);
        if (p?.steamId) setSteamIdInput(p.steamId);
      })
      .catch(() => {});

    // 3. Auto-refresh when tab regains focus (silent, no spinner)
    window.addEventListener("focus", loadSynced);
    return () => window.removeEventListener("focus", loadSynced);
  }, [loadSynced]);

  /* ── Auto-trigger Steam fallback only when there are no synced items ──
   *  Runs once after both synced load and profile are resolved.
   *  Does NOT block the spinner — synced items are already showing.
   */
  useEffect(() => {
    if (syncedLoading) return;
    if (syncedItems.length > 0) return;
    if (!profile?.steamId) return;
    if (steamAutoTriggered.current) return;
    steamAutoTriggered.current = true;
    loadSteamPublic(profile.steamId);
  }, [syncedLoading, syncedItems.length, profile, loadSteamPublic]);

  /* ── Combined grid ── */
  const allItems = [...syncedItems, ...steamItems];

  const rarityNames = [...new Set(
    allItems.map(i => getRarity(i)?.name).filter(Boolean)
  )].sort((a, b) =>
    Object.keys(RARITY_COLORS).indexOf(a) - Object.keys(RARITY_COLORS).indexOf(b)
  );

  const filtered = allItems.filter(item => {
    const name = item.name || item.marketHashName || item.market_hash_name || "";
    if (search && !name.toLowerCase().includes(search.toLowerCase())) return false;
    if (rarityFilter && getRarity(item)?.name !== rarityFilter) return false;
    if (onlyTradable   && !item.tradable)   return false;
    if (onlyMarketable && !item.marketable) return false;
    return true;
  });

  /* Spinner only during initial synced load — typically <200ms */
  const showSpinner = syncedLoading;

  const steamFailed = !steamLoading && steamItems.length === 0 && steamMsg;

  return (
    <div style={{ minHeight:"100vh", background:"#0d1117", padding:"clamp(16px,4vw,32px) clamp(12px,3vw,24px)", maxWidth:1600, margin:"0 auto" }}>

      {/* Header */}
      <div style={{ marginBottom:16 }}>
        <h1 style={{ fontSize:22, fontWeight:800, color:"rgba(255,255,255,0.92)", letterSpacing:"-0.02em", margin:0 }}>CS2 Inventory</h1>
        <p style={{ fontSize:13, color:"rgba(255,255,255,0.35)", marginTop:4, marginBottom:0 }}>
          {syncedLoading
            ? "Loading synced inventory…"
            : syncedCount > 0
              ? `${syncedCount.toLocaleString()} items synced · ${timeAgo(syncedAt)}`
              : "Synced via extension · Steam public API fallback"}
        </p>
      </div>

      {/* Profile chip */}
      <div style={{ display:"inline-flex", alignItems:"center", gap:8, marginBottom:20, padding:"5px 12px", background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.09)", borderRadius:7, fontSize:11, fontFamily:"system-ui, sans-serif", color:"rgba(255,255,255,0.45)" }}>
        {profile === null && !syncedLoading
          ? <><span style={{ color:"rgba(255,255,255,0.2)" }}>●</span> Loading profile…</>
          : profile?.steamId
            ? <><span style={{ color:"rgba(34,197,94,0.7)" }}>●</span> SteamID: <span style={{ color:"rgba(255,255,255,0.75)", fontWeight:600 }}>{profile.steamId}</span> ({profile.username})</>
            : <><span style={{ color:"rgba(239,68,68,0.6)" }}>●</span> Not logged in — <a href={STEAM_LOGIN_URL} style={{ display:"inline-flex", alignItems:"center", gap:4, color:"rgba(102,192,244,0.85)", textDecoration:"none", verticalAlign:"middle" }}><img src={steamLogoImg} alt="Steam" style={{ width:11, height:11, objectFit:"contain" }} />Login with Steam</a></>}
      </div>

      {/* Extension panel */}
      <ExtensionPanel
        loading={syncedLoading}
        importedAt={syncedAt}
        itemCount={syncedCount}
        onClear={clearSynced}
        clearing={clearing}
      />

      {/* Steam public API status — only visible when it has run */}
      {steamFailed && (
        <div style={{ marginBottom:20, padding:"12px 16px", background:"rgba(255,165,0,0.05)", border:"1px solid rgba(255,165,0,0.15)", borderRadius:9, fontSize:12, color:"rgba(255,165,0,0.7)", lineHeight:1.6 }}>
          ⚠️ Steam public inventory: <em>{steamMsg}</em>
          {syncedCount === 0 && (
            <span style={{ display:"block", marginTop:4, color:"rgba(255,255,255,0.45)" }}>
              Use the <strong>SKINTEL Chrome Extension</strong> above to sync your CS2 items.
            </span>
          )}
        </div>
      )}

      {/* Steam live/cache banner */}
      {steamItems.length > 0 && fetchedAt && (
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:10, marginBottom:16, padding:"8px 14px", background: isCached ? "rgba(251,191,36,0.06)" : "rgba(34,197,94,0.05)", border: isCached ? "1px solid rgba(251,191,36,0.18)" : "1px solid rgba(34,197,94,0.15)", borderRadius:8 }}>
          <span style={{ fontSize:12, color: isCached ? "rgba(251,191,36,0.8)" : "rgba(34,197,94,0.7)" }}>
            {isCached ? "⚠️ Cached" : "✓ Live"} Steam inventory · {timeAgo(fetchedAt)}
          </span>
          <button onClick={() => loadSteamPublic(loadedId)} disabled={steamLoading}
            style={{ height:26, padding:"0 12px", background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:6, color:"rgba(255,255,255,0.45)", fontSize:11, fontWeight:600, cursor: steamLoading ? "not-allowed" : "pointer", fontFamily:"inherit" }}>
            ↻ Refresh
          </button>
        </div>
      )}

      {/* Toolbar */}
      <div style={{ display:"flex", gap:8, marginBottom:20, flexWrap:"wrap" }}>
        {profile?.steamId ? (
          <button onClick={() => loadSteamPublic(profile.steamId)} disabled={steamLoading}
            style={{ display:"inline-flex", alignItems:"center", gap:7, height:40, padding:"0 16px", background: steamLoading ? "rgba(255,255,255,0.04)" : "rgba(23,26,33,0.85)", border: steamLoading ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(102,192,244,0.22)", borderRadius:9, color: steamLoading ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.85)", fontSize:13, fontWeight:600, cursor: steamLoading ? "not-allowed" : "pointer", flexShrink:0, fontFamily:"inherit", transition:"all 0.18s ease" }}
            onMouseEnter={e => { if (!steamLoading) { e.currentTarget.style.borderColor = "rgba(102,192,244,0.42)"; e.currentTarget.style.boxShadow = "0 0 14px rgba(102,192,244,0.16)"; } }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = steamLoading ? "rgba(255,255,255,0.08)" : "rgba(102,192,244,0.22)"; e.currentTarget.style.boxShadow = "none"; }}>
            <SteamIcon size={15} />{steamLoading ? "Loading…" : "Load Steam inventory"}
          </button>
        ) : !syncedLoading && (
          <a href={STEAM_LOGIN_URL}
            style={{ display:"inline-flex", alignItems:"center", gap:7, height:40, padding:"0 16px", background:"rgba(23,26,33,0.8)", border:"1px solid rgba(102,192,244,0.22)", borderRadius:9, color:"rgba(255,255,255,0.8)", fontSize:13, fontWeight:600, textDecoration:"none", flexShrink:0, transition:"all 0.18s ease" }}
            onMouseEnter={e => { e.currentTarget.style.color = "#fff"; e.currentTarget.style.borderColor = "rgba(102,192,244,0.42)"; e.currentTarget.style.boxShadow = "0 0 16px rgba(102,192,244,0.18)"; }}
            onMouseLeave={e => { e.currentTarget.style.color = "rgba(255,255,255,0.8)"; e.currentTarget.style.borderColor = "rgba(102,192,244,0.22)"; e.currentTarget.style.boxShadow = "none"; }}>
            <SteamIcon size={15} />Login with Steam
          </a>
        )}
        <div style={{ width:1, height:40, background:"rgba(255,255,255,0.07)", flexShrink:0 }} />
        <input value={steamIdInput} onChange={e => setSteamIdInput(e.target.value)} onKeyDown={e => e.key === "Enter" && loadSteamPublic(steamIdInput)} placeholder="Any SteamID64 (17 digits)…"
          style={{ flex:"1 1 220px", minWidth:0, height:40, padding:"0 14px", background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.09)", borderRadius:9, color:"rgba(255,255,255,0.85)", fontSize:13, outline:"none", fontFamily:"inherit" }} />
        <button onClick={() => loadSteamPublic(steamIdInput)} disabled={steamLoading}
          style={{ height:40, padding:"0 18px", background: steamLoading ? "rgba(255,255,255,0.04)" : "rgba(34,211,238,0.1)", border:"1px solid rgba(34,211,238,0.2)", borderRadius:9, color: steamLoading ? "rgba(255,255,255,0.3)" : "rgba(34,211,238,0.85)", fontSize:13, fontWeight:600, cursor: steamLoading ? "not-allowed" : "pointer", flexShrink:0, fontFamily:"inherit" }}>
          Load
        </button>
        {/* Inline indicator when Steam API is loading (non-blocking) */}
        {steamLoading && (
          <div style={{ display:"flex", alignItems:"center", gap:6, fontSize:11, color:"rgba(255,255,255,0.3)", paddingLeft:4 }}>
            <svg width={12} height={12} viewBox="0 0 32 32" fill="none" style={{ animation:"spin 1s linear infinite", flexShrink:0 }}>
              <circle cx="16" cy="16" r="12" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
              <path d="M16 4 A12 12 0 0 1 28 16" stroke="rgba(34,211,238,0.55)" strokeWidth="3" strokeLinecap="round" />
            </svg>
            Steam API…
          </div>
        )}
      </div>

      {/* Filters */}
      {allItems.length > 0 && (
        <div style={{ marginBottom:18, display:"flex", flexWrap:"wrap", gap:8, alignItems:"center" }}>
          <span style={{ fontSize:12, color:"rgba(255,255,255,0.3)" }}>{filtered.length.toLocaleString()} / {allItems.length.toLocaleString()}</span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter by name…" style={{ height:32, padding:"0 12px", background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.09)", borderRadius:7, color:"rgba(255,255,255,0.78)", fontSize:12, outline:"none", fontFamily:"inherit", minWidth:130 }} />
          {rarityNames.map(r => <RarityChip key={r} rarity={r} active={rarityFilter === r} onClick={() => setRarityFilter(rarityFilter === r ? null : r)} />)}
          <button onClick={() => setOnlyTradable(v => !v)} style={{ fontSize:10, fontWeight:600, letterSpacing:"0.04em", textTransform:"uppercase", color: onlyTradable ? "rgba(34,197,94,0.9)" : "rgba(255,255,255,0.35)", background: onlyTradable ? "rgba(34,197,94,0.1)" : "rgba(255,255,255,0.04)", border: onlyTradable ? "1px solid rgba(34,197,94,0.3)" : "1px solid rgba(255,255,255,0.08)", borderRadius:6, padding:"4px 10px", cursor:"pointer", flexShrink:0, fontFamily:"inherit" }}>Tradable only</button>
          <button onClick={() => setOnlyMarketable(v => !v)} style={{ fontSize:10, fontWeight:600, letterSpacing:"0.04em", textTransform:"uppercase", color: onlyMarketable ? "rgba(34,197,94,0.9)" : "rgba(255,255,255,0.35)", background: onlyMarketable ? "rgba(34,197,94,0.1)" : "rgba(255,255,255,0.04)", border: onlyMarketable ? "1px solid rgba(34,197,94,0.3)" : "1px solid rgba(255,255,255,0.08)", borderRadius:6, padding:"4px 10px", cursor:"pointer", flexShrink:0, fontFamily:"inherit" }}>Marketable only</button>
          {(search || rarityFilter || onlyTradable || onlyMarketable) && (
            <button onClick={() => { setSearch(""); setRarityFilter(null); setOnlyTradable(false); setOnlyMarketable(false); }} style={{ fontSize:10, color:"rgba(255,255,255,0.28)", background:"transparent", border:"none", cursor:"pointer", padding:"4px 6px", fontFamily:"inherit", textDecoration:"underline" }}>Clear</button>
          )}
        </div>
      )}

      {/* Initial spinner — only while fetching synced items (~100–200ms) */}
      {showSpinner && (
        <div style={{ display:"flex", justifyContent:"center", padding:"60px 0" }}>
          <svg width={32} height={32} viewBox="0 0 32 32" fill="none" style={{ animation:"spin 1s linear infinite" }}>
            <circle cx="16" cy="16" r="12" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
            <path d="M16 4 A12 12 0 0 1 28 16" stroke="rgba(34,211,238,0.55)" strokeWidth="3" strokeLinecap="round" />
          </svg>
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      )}

      {/* Empty state */}
      {!showSpinner && allItems.length === 0 && (
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", padding:"60px 0", color:"rgba(255,255,255,0.22)", gap:12, textAlign:"center" }}>
          <div style={{ fontSize:40, opacity:0.12 }}>🎒</div>
          <div style={{ fontSize:13 }}>
            {profile?.steamId
              ? "No items yet. Use the extension to import your CS2 inventory."
              : "Log in with Steam to get started."}
          </div>
        </div>
      )}

      {/* Grid */}
      {!showSpinner && filtered.length > 0 && (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(min(130px,100%), 1fr))", gap:10 }}>
          {filtered.map(item => <SkinCard key={`${item._source}-${item.assetId || item.assetid}`} item={item} />)}
        </div>
      )}

      {!showSpinner && allItems.length > 0 && filtered.length === 0 && (
        <div style={{ textAlign:"center", padding:"40px 0", color:"rgba(255,255,255,0.25)", fontSize:13 }}>No items match your filters.</div>
      )}
    </div>
  );
}
