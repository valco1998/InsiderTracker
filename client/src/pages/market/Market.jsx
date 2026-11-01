import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import api from "../../lib/api";
import { useSocket } from "../../context/SocketContext";
import FiltersBar from "../market/FiltersBar";
import SkinGrid from "../components/SkinGrid";
import PriceSidebar from "../market/PriceSidebar";
import ShareAuctionModal from "../components/ShareAuctionModal";
import { extractMarketItems, getBaseName, normalizeItem } from "../../lib/marketItem";

function getCoins(item) {
  const v = Number(item?.priceCoins ?? (item?.priceCents ? item.priceCents / 100 : null) ?? 0);
  return Number.isFinite(v) ? v : 0;
}
function getDiscount(item) { return Number(item?.discountPct ?? 0); }

// ── Stable decorative data (deterministic positions, no random in render) ──
const BG_PARTICLES = [
  { id: 0,  x: 8,  y: 72, sz: 1.5, del: 0,   dur: 10, col: "168,85,247"  },
  { id: 1,  x: 17, y: 15, sz: 2,   del: 2,   dur: 12, col: "34,211,238"  },
  { id: 2,  x: 25, y: 58, sz: 1,   del: 4,   dur: 8,  col: "139,92,246"  },
  { id: 3,  x: 33, y: 88, sz: 2.5, del: 1,   dur: 14, col: "168,85,247"  },
  { id: 4,  x: 42, y: 32, sz: 1.5, del: 3,   dur: 11, col: "34,211,238"  },
  { id: 5,  x: 51, y: 65, sz: 1,   del: 5,   dur: 9,  col: "139,92,246"  },
  { id: 6,  x: 60, y: 20, sz: 2,   del: 0.5, dur: 13, col: "168,85,247"  },
  { id: 7,  x: 69, y: 75, sz: 1.5, del: 2.5, dur: 10, col: "34,211,238"  },
  { id: 8,  x: 78, y: 45, sz: 2.5, del: 4.5, dur: 8,  col: "139,92,246"  },
  { id: 9,  x: 87, y: 30, sz: 1,   del: 1.5, dur: 12, col: "168,85,247"  },
  { id: 10, x: 12, y: 50, sz: 1.5, del: 3.5, dur: 11, col: "34,211,238"  },
  { id: 11, x: 22, y: 82, sz: 2,   del: 0,   dur: 9,  col: "139,92,246"  },
  { id: 12, x: 47, y: 40, sz: 1,   del: 2,   dur: 14, col: "168,85,247"  },
  { id: 13, x: 65, y: 90, sz: 2.5, del: 4,   dur: 10, col: "34,211,238"  },
  { id: 14, x: 83, y: 62, sz: 1.5, del: 1.5, dur: 8,  col: "139,92,246"  },
  { id: 15, x: 38, y: 25, sz: 2,   del: 3,   dur: 12, col: "168,85,247"  },
  { id: 16, x: 55, y: 55, sz: 1,   del: 5,   dur: 11, col: "34,211,238"  },
  { id: 17, x: 91, y: 10, sz: 2.5, del: 0.8, dur: 9,  col: "139,92,246"  },
];

const BG_EMBERS = [
  { id: 0, x: 14, y: 68, del: 0,   dur: 8  },
  { id: 1, x: 28, y: 45, del: 3,   dur: 10 },
  { id: 2, x: 43, y: 72, del: 6,   dur: 7  },
  { id: 3, x: 57, y: 35, del: 1.5, dur: 9  },
  { id: 4, x: 72, y: 58, del: 4.5, dur: 11 },
  { id: 5, x: 85, y: 75, del: 2,   dur: 8  },
  { id: 6, x: 36, y: 48, del: 5,   dur: 10 },
  { id: 7, x: 63, y: 82, del: 0.5, dur: 7  },
];

const BG_METEORS = [
  { id: 0, x: 5,  y: 8,  del: 0,  dur: 3   },
  { id: 1, x: 30, y: 3,  del: 7,  dur: 3.5 },
  { id: 2, x: 58, y: 12, del: 14, dur: 3   },
  { id: 3, x: 78, y: 5,  del: 21, dur: 4   },
];

function CinematicBackground() {
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 0 }}>
      {/* Galaxy nebula gradients */}
      <div style={{
        position: "absolute", inset: 0,
        background: [
          "radial-gradient(ellipse at 15% 15%, rgba(88,28,135,0.26) 0%, transparent 50%)",
          "radial-gradient(ellipse at 85% 10%, rgba(109,40,217,0.18) 0%, transparent 45%)",
          "radial-gradient(ellipse at 70% 80%, rgba(76,29,149,0.22) 0%, transparent 50%)",
          "radial-gradient(ellipse at 5%  75%, rgba(55,48,163,0.16) 0%, transparent 42%)",
          "radial-gradient(ellipse at 92% 50%, rgba(168,85,247,0.10) 0%, transparent 38%)",
        ].join(","),
      }} />

      {/* Animated fog blobs */}
      <div style={{
        position: "absolute", top: "3%", left: "12%", width: 680, height: 440,
        borderRadius: "50%", background: "rgba(88,28,135,0.08)", filter: "blur(90px)",
        animation: "fogDrift 18s ease-in-out infinite",
      }} />
      <div style={{
        position: "absolute", top: "52%", right: "6%", width: 540, height: 360,
        borderRadius: "50%", background: "rgba(34,211,238,0.04)", filter: "blur(80px)",
        animation: "fogDrift 24s ease-in-out infinite reverse",
      }} />
      <div style={{
        position: "absolute", top: "28%", left: "55%", width: 460, height: 320,
        borderRadius: "50%", background: "rgba(139,92,246,0.06)", filter: "blur(75px)",
        animation: "fogDrift 21s ease-in-out infinite",
        animationDelay: "4s",
      }} />

      {/* Subtle perspective grid */}
      <div style={{
        position: "absolute", inset: 0,
        backgroundImage: [
          "linear-gradient(rgba(168,85,247,0.032) 1px, transparent 1px)",
          "linear-gradient(90deg, rgba(168,85,247,0.032) 1px, transparent 1px)",
        ].join(","),
        backgroundSize: "72px 72px",
      }} />

      {/* Scanner UI — top right corner */}
      <div style={{ position: "absolute", top: "6%", right: "3%", width: 260, height: 260, opacity: 0.75 }}>
        {/* Outer ring */}
        <div style={{
          position: "absolute", inset: 0, borderRadius: "50%",
          border: "1px solid rgba(168,85,247,0.15)",
        }} />
        {/* Inner ring */}
        <div style={{
          position: "absolute", inset: "22%", borderRadius: "50%",
          border: "1px solid rgba(168,85,247,0.09)",
        }} />
        {/* Rotating sweep */}
        <div style={{
          position: "absolute", inset: 0, borderRadius: "50%", overflow: "hidden",
          animation: "scannerSweep 8s linear infinite",
        }}>
          <div style={{
            position: "absolute", top: "50%", left: "50%",
            width: "50%", height: 1,
            background: "linear-gradient(90deg, rgba(168,85,247,0.6) 0%, transparent 100%)",
            transformOrigin: "left center",
          }} />
        </div>
        {/* Ping rings */}
        {[0, 1.6, 3.2].map((d, i) => (
          <div key={i} style={{
            position: "absolute", inset: "36%", borderRadius: "50%",
            border: "1px solid rgba(168,85,247,0.3)",
            animation: `ringPing 3s ${d}s ease-out infinite`,
          }} />
        ))}
        {/* Crosshairs */}
        <div style={{ position: "absolute", top: "50%", left: "8%", right: "8%", height: 1, background: "rgba(168,85,247,0.05)", transform: "translateY(-50%)" }} />
        <div style={{ position: "absolute", left: "50%", top: "8%", bottom: "8%", width: 1, background: "rgba(168,85,247,0.05)", transform: "translateX(-50%)" }} />
      </div>

      {/* Meteor streaks */}
      {BG_METEORS.map(m => (
        <div key={m.id} style={{
          position: "absolute", left: `${m.x}%`, top: `${m.y}%`,
          width: 140, height: 1,
          background: "linear-gradient(90deg, transparent 0%, rgba(168,85,247,0.75) 35%, rgba(34,211,238,0.5) 70%, transparent 100%)",
          transform: "rotate(35deg)", transformOrigin: "left center",
          animation: `meteorFly ${m.dur}s ${m.del}s ease-in infinite`,
          opacity: 0,
        }} />
      ))}

      {/* Floating particles */}
      {BG_PARTICLES.map(p => (
        <div key={p.id} style={{
          position: "absolute", left: `${p.x}%`, top: `${p.y}%`,
          width: p.sz, height: p.sz, borderRadius: "50%",
          background: `rgba(${p.col},0.85)`,
          boxShadow: `0 0 ${p.sz * 4}px rgba(${p.col},0.7)`,
          animation: `particleRise ${p.dur}s ${p.del}s ease-in-out infinite`,
        }} />
      ))}

      {/* Floating embers */}
      {BG_EMBERS.map(e => (
        <div key={e.id} style={{
          position: "absolute", left: `${e.x}%`, top: `${e.y}%`,
          width: 2, height: 2, borderRadius: "50%",
          background: "rgba(251,191,36,0.75)",
          boxShadow: "0 0 6px rgba(251,191,36,0.5)",
          animation: `floatEmber ${e.dur}s ${e.del}s ease-in-out infinite`,
        }} />
      ))}

      {/* Bottom vignette */}
      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0, height: "30%",
        background: "linear-gradient(to top, rgba(8,10,20,0.55), transparent)",
      }} />
    </div>
  );
}

function StatChip({ label, value, accent, glow }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "5px 12px", borderRadius: 12,
      background: glow ? `rgba(${accent},0.08)` : "rgba(255,255,255,0.04)",
      border: `1px solid rgba(${accent || "255,255,255"},${glow ? "0.20" : "0.08"})`,
      boxShadow: glow ? `0 0 16px rgba(${accent},0.10)` : "none",
    }}>
      <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: "rgba(255,255,255,0.35)" }}>
        {label}
      </span>
      <span style={{
        fontSize: 14, fontWeight: 900, fontVariantNumeric: "tabular-nums",
        color: accent ? `rgb(${accent})` : "rgba(255,255,255,0.9)",
        textShadow: glow ? `0 0 12px rgba(${accent},0.45)` : "none",
      }}>
        {value}
      </span>
    </div>
  );
}

function LoadingGrid() {
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="rounded-2xl overflow-hidden h-[380px]" style={{
          background: "linear-gradient(160deg, #18142a 0%, #120f1e 100%)",
          border: "1px solid rgba(168,85,247,0.08)",
        }}>
          <div className="p-4 space-y-3">
            <div className="h-3 w-24 rounded skeleton" />
            <div className="h-4 w-40 rounded skeleton" />
            <div className="h-[164px] w-full rounded-xl skeleton" />
            <div className="h-5 w-20 rounded skeleton" />
            <div className="h-8 w-full rounded-xl skeleton" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function MarketPage() {
  const [items,          setItems]          = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [lastUpdated,    setLastUpdated]    = useState(null);
  const [sidebarOpen,    setSidebarOpen]    = useState(false);
  const [sidebarTitle,   setSidebarTitle]   = useState("");
  const [sidebarItems,   setSidebarItems]   = useState([]);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [shareItem,      setShareItem]      = useState(null);

  const [filters, setFilters] = useState({
    search: "", category: "", minPrice: "30", maxPrice: "10000", minDiscountPct: "",
  });
  const [gridKey, setGridKey] = useState(0);
  const { socket, connected } = useSocket();
  const prevConnectedRef = useRef(connected);
  const reloadRef = useRef(() => {});

  // Server-side cache TTL + the private/ETag Cache-Control policy on
  // /items/market (see server/routers/items.Routers.js) mean a poll that
  // lands before the underlying data changed is typically served from the
  // browser's HTTP cache or a 304 — so this interval mainly exists as a
  // freshness ceiling, not the primary bandwidth driver it used to be.
  const MARKET_POLL_MS = 20_000;

  useEffect(() => {
    let alive = true;
    const ctrl = new AbortController();
    let inFlight = false;

    async function load(isRefresh = false) {
      if (inFlight) return;
      inFlight = true;
      try {
        if (!isRefresh) setLoading(true);
        const search = filters.search?.trim();
        const res = await api.get("/items/market", {
          params: {
            q: search || undefined,
            search: search || undefined,
            category: filters.category || undefined,
            minPrice: filters.minPrice || 30,
            maxPrice: filters.maxPrice || 10000,
            minDiscountPct: filters.minDiscountPct || 0,
            limit: 200,
          },
          signal: ctrl.signal,
          timeout: 30000,
        });

        const raw = extractMarketItems(res?.data);
        const normalized = raw
          .map(normalizeItem)
          .filter(i => i && (i.name || i.image || getCoins(i) > 0))
          .sort((a, b) => {
            const dd = getDiscount(b) - getDiscount(a);
            return dd !== 0 ? dd : getCoins(b) - getCoins(a);
          });

        if (alive) { setItems(normalized); setLastUpdated(new Date()); if (!isRefresh) setGridKey(k => k + 1); }
      } catch (err) {
        if (err?.name === "CanceledError" || err?.name === "AbortError") return;
        if (alive && !isRefresh) setItems([]);
      } finally {
        if (alive) setLoading(false);
        inFlight = false;
      }
    }

    reloadRef.current = () => load(true);

    const delay = setTimeout(() => load(false), 350);

    // Pause polling while the tab is hidden; catch up immediately on focus.
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") load(true);
    }, MARKET_POLL_MS);

    function onVisible() {
      if (document.visibilityState === "visible") load(true);
    }
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      alive = false;
      reloadRef.current = () => {};
      clearTimeout(delay);
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      ctrl.abort();
    };
  }, [filters.search, filters.category, filters.minPrice, filters.maxPrice, filters.minDiscountPct]);

  // One-shot silent resync after the socket reconnects — covers data missed
  // while the connection was down (mobile network drop, Render blip, etc).
  useEffect(() => {
    if (connected && !prevConnectedRef.current) {
      reloadRef.current();
    }
    prevConnectedRef.current = connected;
  }, [connected]);

  // Join the "market:live" Socket.IO room while this page is mounted so the
  // server scopes market:deals broadcasts to viewers of this page instead of
  // every connected client. Re-subscribes on reconnect (a fresh socket
  // doesn't retain prior room membership) — mirrors AuctionsPage.jsx.
  useEffect(() => {
    if (!socket) return;
    function subscribe() { socket.emit("market:subscribe"); }
    if (connected) subscribe();
    socket.on("connect", subscribe);
    return () => {
      socket.off("connect", subscribe);
      socket.emit("market:unsubscribe");
    };
  }, [socket, connected]);

  // Live deal-change notifications trigger an immediate resync instead of
  // waiting for the next poll tick. market:deals is already batched/deduped
  // server-side (see empireMarketSocket.js), so this fires only when
  // something actually changed — reuses the same guarded load(true) path
  // as the reconnect resync above rather than merging items client-side.
  useEffect(() => {
    function onMarketDeals() { reloadRef.current(); }
    window.addEventListener("market:deals", onMarketDeals);
    return () => window.removeEventListener("market:deals", onMarketDeals);
  }, []);

  const displayed = useMemo(() => {
    if (!filters.minDiscountPct) return items;
    const min = Number(filters.minDiscountPct);
    return items.filter(i => getDiscount(i) >= min);
  }, [items, filters.minDiscountPct]);

  const topDiscount = useMemo(() => {
    if (!displayed.length) return 0;
    return Math.max(...displayed.map(i => getDiscount(i)));
  }, [displayed]);

  async function handleSeeMore(item) {
    const baseName = getBaseName(item?.name);
    const wear = item?.wear || item?.wear_name || "";
    const related = displayed
      .filter(x => getBaseName(x?.name) === baseName && (x?.wear || x?.wear_name || "") === wear)
      .sort((a, b) => getCoins(a) - getCoins(b))
      .slice(0, 8);

    setSidebarTitle(wear ? `${baseName} • ${wear}` : baseName);
    setSidebarItems(related);
    setSidebarOpen(true);

    if (!related.length) return;
    try {
      setLoadingDetails(true);
      await Promise.all(related.map(async (it) => {
        try {
          const res = await api.get(`/items/${it.itemId}/details`);
          const raw = res?.data?.item || res?.data?.data?.item || res?.data?.data || res?.data;
          const detailed = normalizeItem(raw);
          setSidebarItems(prev => prev.map(x => String(x?.itemId) === String(it?.itemId) ? { ...x, ...detailed } : x));
        } catch {}
      }));
    } finally { setLoadingDetails(false); }
  }

  const handleShare = useCallback((item) => setShareItem(item), []);

  const fmtTime = (d) => d?.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="min-h-screen" style={{ background: "#08091a" }}>
      <CinematicBackground />

      <div className="relative z-10 px-5 py-7 max-w-[1800px] mx-auto">

        {/* Page header */}
        <div className="flex items-end justify-between mb-7">
          <div>
            {/* AI Scanner label */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <div style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "3px 10px 3px 8px", borderRadius: 20,
                background: "rgba(168,85,247,0.10)",
                border: "1px solid rgba(168,85,247,0.24)",
                boxShadow: "0 0 16px rgba(168,85,247,0.08)",
              }}>
                <span style={{
                  width: 5, height: 5, borderRadius: "50%",
                  background: "#a855f7", boxShadow: "0 0 8px #a855f7",
                  display: "block", animation: "accentPulse 2s ease-in-out infinite",
                }} />
                <span style={{
                  fontSize: 10, fontWeight: 800, letterSpacing: "0.15em", textTransform: "uppercase",
                  color: "rgba(168,85,247,0.95)",
                }}>AI Market Scanner</span>
              </div>
            </div>

            <h1 className="mkt-h1" style={{
              fontSize: 38, fontWeight: 900, letterSpacing: "-0.03em", lineHeight: 1,
              background: "linear-gradient(135deg, #ffffff 20%, rgba(168,85,247,0.85) 100%)",
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
            }}>
              Market
            </h1>
          </div>

          {/* Live stats */}
          <div className="hidden md:flex items-center gap-2">
            <StatChip label="Items" value={displayed.length.toLocaleString()} accent="34,211,238" glow />
            {topDiscount > 0 && (
              <StatChip label="Best Deal" value={`-${Math.round(topDiscount)}%`} accent="34,197,94" glow />
            )}
            {lastUpdated && (
              <StatChip label="Updated" value={fmtTime(lastUpdated)} />
            )}
            <div style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "5px 12px", borderRadius: 12,
              background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.18)",
            }}>
              <span style={{
                width: 6, height: 6, borderRadius: "50%",
                background: "#4ade80", boxShadow: "0 0 10px rgba(74,222,128,0.6)",
                display: "block", animation: "accentPulse 1.5s ease-in-out infinite",
              }} />
              <span style={{ fontSize: 11, fontWeight: 800, color: "#4ade80", letterSpacing: "0.08em" }}>LIVE</span>
            </div>
          </div>
        </div>

        {/* Sticky filter bar */}
        <div className="sticky top-[60px] z-30 py-3 mb-6 -mx-5 px-5" style={{
          background: "rgba(8,9,26,0.96)", backdropFilter: "blur(12px)",
          borderBottom: "1px solid rgba(168,85,247,0.13)",
          boxShadow: "0 4px 30px rgba(0,0,0,0.55), 0 1px 0 rgba(168,85,247,0.08)",
        }}>
          <FiltersBar filters={filters} setFilters={setFilters} />
        </div>

        {/* Grid */}
        {loading ? <LoadingGrid /> : <SkinGrid items={displayed} onSeeMore={handleSeeMore} onShare={handleShare} resetKey={gridKey} />}
      </div>

      <PriceSidebar
        open={sidebarOpen}
        title={sidebarTitle}
        items={sidebarItems}
        loading={loadingDetails}
        onClose={() => setSidebarOpen(false)}
      />

      {shareItem && (
        <ShareAuctionModal item={shareItem} kind="market_item" onClose={() => setShareItem(null)} />
      )}
    </div>
  );
}
