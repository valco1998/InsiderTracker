// Companies Intelligence Screener — "Evidence Grid" PROTOTYPE.
// Isolated: served only by the Vite dev server at /prototype/companies/ — not part of the
// production build, not linked from the app, no API calls. All data is fictional (mockData.js).
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  LuSearch, LuZap, LuUsers, LuBriefcase, LuGem, LuRepeat, LuRadar, LuArrowDownRight, LuChevronRight, LuX, LuShare2, LuBookmark,
  LuSlidersHorizontal, LuInbox, LuRefreshCw, LuColumns3, LuSmartphone, LuCheck, LuTriangleAlert, LuClock,
} from "react-icons/lu";
import { COMPANIES, COVERAGE, NOW, perfOf, hasPrice, PRICE_ASOF_LABEL } from "./mockData";
import { ConfidenceGlyph, ClusterBadge, RoleChips, PatternCell, Sparkline, ReturnCell, ExpandedRow, EvidenceDrawer, MobileCard } from "./parts";
import { usd, pct, pts, tone, ago, etTime, price, CLUSTER_DEF } from "./format";
import { DEFAULTS, VALUES, PTYPES, CONFS, PUBS, PERFS, applyFilters, sortList, median } from "./screenLogic";

const DAY = 86_400_000;
const PAGE = 25;


// ---------------------------------------------------------------- filter model (logic in screenLogic.js)

const PRESETS = [
  { key: "fresh", label: "Fresh insider activity", icon: LuZap, patch: { pub: "72h", ptype: "likely" }, hint: "Published in the last 72 hours" },
  { key: "multi", label: "Multiple independent buyers", icon: LuUsers, patch: { minBuyers: 2 }, hint: "2+ independent economic buyers" },
  { key: "exec", label: "CEO & CFO purchases", icon: LuBriefcase, patch: { roles: ["CEO", "CFO"] }, hint: "A CEO or CFO bought" },
  { key: "large", label: "Large verified purchases", icon: LuGem, patch: { value: "1m", ptype: "verified" }, hint: "$1M+ verified open-market" },
  { key: "repeat", label: "Repeated buying", icon: LuRepeat, patch: { repeat: true }, hint: "Same insiders bought on several dates" },
  { key: "clusters", label: "Recently published clusters", icon: LuRadar, patch: { clusters: ["A", "B", "C"], pub: "7d" }, hint: "Cluster A/B/C published in 7 days" },
  { key: "below", label: "Below insider purchase price", icon: LuArrowDownRight, patch: { perf: "below_insider" }, hint: "Latest close below the insiders’ average price", price: true },
];

const COLUMNS = [
  { key: "purchases", label: "Purchases", lane: "act", def: false },
  { key: "pattern", label: "Activity pattern", lane: "act", def: true },
  { key: "insiderPx", label: "Insider avg price", lane: "act", def: false },
  { key: "ret", label: "Since publication", lane: "price", def: true },
  { key: "horizons", label: "R1 · R5 · R20", lane: "price", def: false },
  { key: "peak", label: "Peak (hindsight)", lane: "price", def: false },
  { key: "trend", label: "Trend", lane: "price", def: true },
];

function readUrl() {
  const s = new URLSearchParams(window.location.search);
  const f = { ...DEFAULTS };
  for (const k of Object.keys(DEFAULTS)) {
    if (!s.has(k)) continue;
    const v = s.get(k);
    f[k] = Array.isArray(DEFAULTS[k]) ? v.split(",").filter(Boolean) : typeof DEFAULTS[k] === "boolean" ? v === "1" : typeof DEFAULTS[k] === "number" ? Number(v) || 1 : v;
  }
  return f;
}
function toQuery(f, extra) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) {
    if (JSON.stringify(v) === JSON.stringify(DEFAULTS[k])) continue;
    s.set(k, Array.isArray(v) ? v.join(",") : typeof v === "boolean" ? (v ? "1" : "0") : String(v));
  }
  for (const [k, v] of Object.entries(extra)) if (v != null) s.set(k, v);
  return s.toString();
}
const ls = { get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } } };


// ---------------------------------------------------------------- small UI
function Seg({ value, options, onChange, label }) {
  return (
    <div className="cp-seg" role="group" aria-label={label}>
      {options.map(([k, l]) => <button key={k} aria-pressed={value === k} onClick={() => onChange(k)}>{l}</button>)}
    </div>
  );
}
function Field({ label, children, lane }) {
  return <div className="cp-field"><span>{label}{lane === "price" && <span className="cp-lane-tag cp-lane-price" style={{ marginLeft: 6 }}>price</span>}</span><div className="cp-row" style={{ gap: 6, flexWrap: "wrap" }}>{children}</div></div>;
}
function Select({ value, options, onChange, label, width }) {
  return (
    <select className="it-input cp-select" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} style={{ width }}>
      {Object.entries(options).map(([k, v]) => <option key={k} value={k}>{Array.isArray(v) ? v[1] : v}</option>)}
    </select>
  );
}
function Toast({ text }) {
  if (!text) return null;
  return <div role="status" style={{ position: "fixed", left: "50%", bottom: 24, transform: "translateX(-50%)", zIndex: 80, padding: "9px 14px", borderRadius: 10, background: "var(--it-elevated)", border: "1px solid var(--it-line)", boxShadow: "var(--it-shadow-lg)", fontSize: 13, display: "flex", gap: 8, alignItems: "center" }}><LuCheck size={15} style={{ color: "var(--cp-act)" }} />{text}</div>;
}

function FilterControls({ f, patch, licensed, vertical = false }) {
  const toggleArr = (k, v) => patch({ [k]: f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v] });
  const main = (
    <>
      <Field label="Period"><Seg label="Period" value={f.period} onChange={(v) => patch({ period: v })} options={[["24h", "24H"], ["7d", "7D"], ["30d", "30D"], ["90d", "90D"]]} /></Field>
      <Field label="Date basis"><Seg label="Date basis" value={f.basis} onChange={(v) => patch({ basis: v })} options={[["filed", "SEC published"], ["traded", "Trade date"]]} /></Field>
      <Field label="Independent buyers"><Seg label="Minimum independent buyers" value={f.minBuyers} onChange={(v) => patch({ minBuyers: v })} options={[[1, "Any"], [2, "2+"], [3, "3+"], [5, "5+"]]} /></Field>
      <Field label="Verified value"><Select label="Minimum verified purchase value" value={f.value} options={VALUES} onChange={(v) => patch({ value: v })} width={118} /></Field>
      <Field label="Roles">{["CEO", "CFO", "Dir", "10%"].map((r) => <button key={r} className="cp-toggle" aria-pressed={f.roles.includes(r)} onClick={() => toggleArr("roles", r)}>{r}</button>)}</Field>
      <Field label="Purchase type"><Select label="Purchase type" value={f.ptype} options={PTYPES} onChange={(v) => patch({ ptype: v })} width={vertical ? "100%" : 196} /></Field>
    </>
  );
  const more = (
    <>
      <Field label="Cluster type">{["A", "B", "C"].map((t) => <button key={t} className="cp-toggle" aria-pressed={f.clusters.includes(t)} title={CLUSTER_DEF[t]} onClick={() => toggleArr("clusters", t)}>Cluster {t}</button>)}</Field>
      <Field label="Published"><Select label="Published within" value={f.pub} options={PUBS} onChange={(v) => patch({ pub: v })} width="100%" /></Field>
      <Field label="Data confidence"><Select label="Data confidence" value={f.conf} options={CONFS} onChange={(v) => patch({ conf: v })} width="100%" /></Field>
      <Field label="Buying pattern"><button className="cp-toggle" aria-pressed={f.repeat} onClick={() => patch({ repeat: !f.repeat })}>Repeated buying only</button></Field>
      {licensed && <Field label="Since signal" lane="price"><Select label="Performance since signal" value={f.perf} options={PERFS} onChange={(v) => patch({ perf: v })} width="100%" /></Field>}
    </>
  );
  return { main, more };
}

function activeTokens(f, licensed) {
  const t = [];
  if (f.minBuyers > 1) t.push(["minBuyers", `${f.minBuyers}+ independent buyers`, { minBuyers: 1 }]);
  if (f.value !== "any") t.push(["value", `${VALUES[f.value][1]} verified`, { value: "any" }]);
  if (f.roles.length) t.push(["roles", f.roles.join(" / "), { roles: [] }]);
  if (f.ptype !== DEFAULTS.ptype) t.push(["ptype", PTYPES[f.ptype], { ptype: DEFAULTS.ptype }]);
  if (f.clusters.length) t.push(["clusters", `Cluster ${f.clusters.join("/")}`, { clusters: [] }]);
  if (f.pub !== "any") t.push(["pub", `Published: ${PUBS[f.pub].toLowerCase()}`, { pub: "any" }]);
  if (f.conf !== "all") t.push(["conf", CONFS[f.conf], { conf: "all" }]);
  if (f.repeat) t.push(["repeat", "Repeated buying", { repeat: false }]);
  if (licensed && f.perf !== "any") t.push(["perf", PERFS[f.perf], { perf: "any" }]);
  if (f.q.trim()) t.push(["q", `“${f.q.trim()}”`, { q: "" }]);
  return t;
}

// ---------------------------------------------------------------- page
export default function CompaniesPrototype() {
  const params = new URLSearchParams(window.location.search);
  const inFrame = params.get("frame") === "1";
  const [f, setF] = useState(readUrl);
  const [proto, setProto] = useState(() => ({ state: params.get("state") || "ready", licensed: params.get("lic") !== "0", theme: params.get("theme") || "dark", open: !inFrame }));
  const [preset, setPreset] = useState(null);
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState(() => new Set([params.get("open") || "c0"]));
  const [drawer, setDrawer] = useState(() => params.get("ev"));
  const [moreOpen, setMoreOpen] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [frame, setFrame] = useState(false);
  const [toast, setToast] = useState("");
  const [cols, setCols] = useState(() => ls.get("it.proto.cols", Object.fromEntries(COLUMNS.map((c) => [c.key, c.def]))));
  const [colsOpen, setColsOpen] = useState(false);
  const [saved, setSaved] = useState(() => ls.get("it.proto.saved", []));
  const [savedOpen, setSavedOpen] = useState(false);
  const [acOpen, setAcOpen] = useState(false);
  const [loadingFlash, setLoadingFlash] = useState(false);
  const licensed = proto.licensed;

  // theme + URL state
  useEffect(() => { document.documentElement.dataset.theme = proto.theme; }, [proto.theme]);
  useEffect(() => {
    const q = toQuery(f, { state: proto.state !== "ready" ? proto.state : null, lic: licensed ? null : "0", theme: proto.theme !== "dark" ? proto.theme : null, frame: inFrame ? "1" : null });
    window.history.replaceState(null, "", `${window.location.pathname}${q ? `?${q}` : ""}`);
  }, [f, proto.state, licensed, proto.theme, inFrame]);
  useEffect(() => { ls.set("it.proto.cols", cols); }, [cols]);
  useEffect(() => { if (!toast) return undefined; const t = setTimeout(() => setToast(""), 1800); return () => clearTimeout(t); }, [toast]);

  const patch = useCallback((p) => { setF((x) => ({ ...x, ...p })); setPage(0); setPreset(null); }, []);
  const applyPreset = (p) => {
    if (preset === p.key) { setF({ ...DEFAULTS, anchor: f.anchor }); setPreset(null); setPage(0); return; }
    setF({ ...DEFAULTS, anchor: f.anchor, ...p.patch }); setPreset(p.key); setPage(0);
    setLoadingFlash(true); setTimeout(() => setLoadingFlash(false), 260); // what a real refetch would feel like
  };

  const filtered = useMemo(() => applyFilters(COMPANIES, f, licensed), [f, licensed]);
  const sorted = useMemo(() => sortList(filtered, f), [filtered, f]);
  const rows = useMemo(() => (proto.state === "empty" ? [] : sorted), [proto.state, sorted]);
  const pageRows = rows.slice(page * PAGE, page * PAGE + PAGE);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const presetCounts = useMemo(() => Object.fromEntries(PRESETS.map((p) => [p.key, applyFilters(COMPANIES, { ...DEFAULTS, ...p.patch }, licensed).length])), [licensed]);
  const fresh = useMemo(() => [...COMPANIES].sort((a, b) => b.publication.latestAt - a.publication.latestAt).slice(0, 8), []);
  const acList = useMemo(() => { const q = f.q.trim().toUpperCase(); return q ? COMPANIES.filter((c) => c.ticker.startsWith(q) || c.name.toUpperCase().includes(q)).slice(0, 6) : []; }, [f.q]);

  const kpi = useMemo(() => {
    const ps = rows.map((c) => perfOf(c, f.anchor));
    const ok = ps.filter(hasPrice);
    const pending = ps.filter((p) => p.status === "pending").length;
    return {
      companies: rows.length,
      value: rows.reduce((s, c) => s + c.purchases.verifiedValue, 0),
      econ: rows.reduce((s, c) => s + c.buyers.economic, 0), legal: rows.reduce((s, c) => s + c.buyers.legal, 0),
      clusters: rows.filter((c) => c.cluster).length, newClusters: rows.filter((c) => c.cluster && NOW - c.publication.signalAt < 7 * DAY).length,
      verified: rows.length ? rows.filter((c) => c.quality.status === "verified").length / rows.length : null,
      warn: rows.filter((c) => c.quality.status !== "verified").length,
      medRet: median(ok.map((p) => p.ret)), medEx: median(ok.map((p) => p.excess)), n: ok.length, pending, na: rows.length - ok.length - pending,
      pos: ok.length ? ok.filter((p) => p.ret > 0).length / ok.length : null,
    };
  }, [rows, f.anchor]);
  const maxValue = Math.max(1, ...pageRows.map((c) => c.purchases.verifiedValue));
  const toggleRow = (id) => setExpanded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const onSort = (key) => patch(f.sort === key ? { sort: key, dir: f.dir === "desc" ? "asc" : "desc" } : { sort: key, dir: "desc" });
  // launch state (no price licence): the freed width goes to two more SEC columns
  const showCol = (k) => (cols[k] || (!licensed && (k === "purchases" || k === "insiderPx"))) && (COLUMNS.find((c) => c.key === k).lane !== "price" || licensed);
  const priceCols = licensed ? COLUMNS.filter((c) => c.lane === "price" && cols[c.key]).length : 0;
  const actCols = 3 + COLUMNS.filter((c) => c.lane === "act" && showCol(c.key)).length;
  const tokens = activeTokens(f, licensed);
  const controls = FilterControls({ f, patch, licensed });
  const mobileControls = FilterControls({ f, patch, licensed, vertical: true });
  const drawerCo = drawer ? COMPANIES.find((c) => c.id === drawer) : null;
  const busy = proto.state === "loading" || loadingFlash;

  const share = async () => { try { await navigator.clipboard.writeText(window.location.href.replace(/[?&]frame=1/, "")); setToast("Link to this screen copied"); } catch { setToast("Copy the address bar — this screen is fully encoded in the URL"); } };
  const saveScreen = () => {
    const name = preset ? PRESETS.find((p) => p.key === preset).label : tokens.length ? tokens.map((t) => t[1]).slice(0, 2).join(" · ") : "All companies, 30D";
    const next = [{ name, query: window.location.search, at: Date.now() }, ...saved.filter((s) => s.query !== window.location.search)].slice(0, 8);
    setSaved(next); ls.set("it.proto.saved", next); setToast("Screen saved on this device");
  };

  const SortTh = ({ k, children, className = "", title }) => (
    <th scope="col" className={className} title={title} aria-sort={f.sort === k ? (f.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button className="cp-sort" onClick={() => onSort(k)}>{children}<span aria-hidden="true" style={{ opacity: f.sort === k ? 1 : 0.25, fontSize: 9 }}>{f.sort === k && f.dir === "asc" ? "▲" : "▼"}</span></button>
    </th>
  );

  return (
    <div className="it-root">
      <div className="cp-mock" role="note"><LuTriangleAlert size={14} />PROTOTYPE · MOCK DATA<span>Fictional companies, people, filings and prices — not SEC data, not market data. Not linked from the app.</span></div>

      {/* app chrome — replica of the existing InsiderTracker navigation */}
      <header className="it-nav cp-nav">
        <div className="cp-page cp-row" style={{ height: 56, gap: 18, paddingBottom: 0 }}>
          <a href="/insider" className="cp-brand"><span className="cp-logo">IT</span><span>InsiderTracker</span></a>
          <nav className="cp-row it-scroll-x cp-grow" aria-label="Sections" style={{ gap: 2 }}>
            {[["/insider", "Overview"], ["/insider/transactions", "Transactions"], ["/insider/companies", "Companies"], ["/insider/analytics", "Analytics"], ["/insider/backtesting", "Backtesting"]].map(([to, l]) => (
              <a key={to} href={to} className={`it-tab${l === "Companies" ? " active" : ""}`}>{l}</a>
            ))}
          </nav>
          <span className="cp-live" style={{ flex: "none" }}><span className="it-dot it-dot-live" />SEC live</span>
        </div>
      </header>

      <main className="cp-page">
        <div className="cp-head">
          <div>
            <h1 className="cp-title">Companies<small>Insider buying intelligence · free for everyone</small></h1>
            <p className="cp-sub">Every company with reported insider purchases, counted by <b style={{ color: "var(--it-text)", fontWeight: 600 }}>independent economic buyers</b> and traced to the SEC filings behind each number. Blue = what insiders did. Green / red = what the stock did afterwards.</p>
          </div>
          <div className="cp-head-actions">
            <div className="cp-search">
              <LuSearch size={15} />
              <input className="it-input" placeholder="Ticker or company" aria-label="Search ticker or company" value={f.q}
                onChange={(e) => { patch({ q: e.target.value.slice(0, 40) }); setAcOpen(true); }} onFocus={() => setAcOpen(true)} onBlur={() => setTimeout(() => setAcOpen(false), 120)} />
              <span className="it-kbd">/</span>
              {acOpen && acList.length > 0 && (
                <div className="cp-ac" role="listbox">
                  {acList.map((c) => (
                    <button key={c.id} role="option" aria-selected="false" onMouseDown={() => { patch({ q: c.ticker }); setAcOpen(false); setExpanded(new Set([c.id])); }}>
                      <ConfidenceGlyph status={c.quality.status} /><span className="cp-ticker">{c.ticker}</span><span className="cp-co-name cp-grow">{c.name}</span><span className="cp-small">{c.buyers.economic} buyer{c.buyers.economic === 1 ? "" : "s"}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div style={{ position: "relative" }}>
              <button className="it-btn" onClick={() => setSavedOpen((v) => !v)} aria-expanded={savedOpen}><LuBookmark size={15} /><span className="cp-btn-label">Screens</span></button>
              {savedOpen && (
                <div className="cp-ac" style={{ left: "auto", right: 0, width: 280 }}>
                  <button onClick={() => { saveScreen(); setSavedOpen(false); }} style={{ color: "var(--cp-act)", fontWeight: 600 }}><LuBookmark size={14} />Save current screen</button>
                  {saved.length === 0 && <div className="cp-small" style={{ padding: "6px 10px 8px", whiteSpace: "normal" }}>Saved on this device — no account needed.</div>}
                  {saved.map((s) => <button key={s.query + s.at} onClick={() => { window.location.search = s.query; }}><span className="cp-grow" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span><LuChevronRight size={14} /></button>)}
                </div>
              )}
            </div>
            <button className="it-btn" onClick={share}><LuShare2 size={15} /><span className="cp-btn-label">Share</span></button>
          </div>
        </div>

        {/* latest publications */}
        <div className="cp-fresh" aria-label="Latest SEC publications">
          <span className="cp-fresh-label"><span className="it-dot it-dot-live" />Latest filings</span>
          <div className="cp-fresh-items">
            {fresh.map((c) => (
              <button key={c.id} className="cp-fresh-item" onClick={() => { setF({ ...DEFAULTS, q: c.ticker }); setPreset(null); setExpanded(new Set([c.id])); }}>
                <b>{c.ticker}</b><span>{ago(c.publication.latestAt)}</span><span className="cp-small">{c.buyers.economic} buyer{c.buyers.economic === 1 ? "" : "s"} · {usd(c.purchases.verifiedValue)}</span>
              </button>
            ))}
          </div>
        </div>

        {/* presets */}
        <div className="cp-presets" role="group" aria-label="Screen presets">
          {PRESETS.filter((p) => !p.price || licensed).map((p) => (
            <button key={p.key} className={`cp-preset${p.price ? " cp-preset-price" : ""}`} aria-pressed={preset === p.key} title={`${p.hint}. Describes activity — not a recommendation.`} onClick={() => applyPreset(p)}>
              <p.icon size={15} />{p.label}<span className="cp-count">{presetCounts[p.key]}</span>
            </button>
          ))}
        </div>

        <section className="cp-panel" aria-label="Companies screener">
          {/* filters — desktop */}
          <div className="cp-filters cp-filters-desktop" role="search" aria-label="Screen companies">
            {controls.main}
            <div className="cp-spacer" />
            <div className="cp-row" style={{ gap: 6 }}>
              <button className="it-btn" style={{ height: 32 }} aria-expanded={moreOpen} onClick={() => setMoreOpen((v) => !v)}><LuSlidersHorizontal size={15} />More filters</button>
              <div style={{ position: "relative" }}>
                <button className="it-btn it-icon-btn" style={{ height: 32, width: 32 }} aria-label="Choose columns" aria-expanded={colsOpen} onClick={() => setColsOpen((v) => !v)}><LuColumns3 size={15} /></button>
                {colsOpen && (
                  <div className="cp-ac" style={{ left: "auto", right: 0, width: 250 }}>
                    <div className="cp-small" style={{ padding: "6px 10px" }}>Columns (saved on this device)</div>
                    {COLUMNS.map((c) => (
                      <button key={c.key} disabled={c.lane === "price" && !licensed} style={{ opacity: c.lane === "price" && !licensed ? 0.45 : 1 }} onClick={() => setCols((x) => ({ ...x, [c.key]: !x[c.key] }))}>
                        <span style={{ width: 16, display: "grid", placeItems: "center", color: "var(--cp-act)" }}>{cols[c.key] && <LuCheck size={14} />}</span>
                        <span className="cp-grow">{c.label}</span><span className={`cp-lane-tag ${c.lane === "act" ? "cp-lane-act" : "cp-lane-price"}`}>{c.lane === "act" ? "SEC" : "price"}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
          {moreOpen && <div className="cp-more">{controls.more}</div>}

          {/* mobile filter trigger */}
          <div className="cp-mobile-only cp-row" style={{ padding: "10px 12px", borderBottom: "1px solid var(--it-line-soft)", justifyContent: "space-between" }}>
            <Seg label="Period" value={f.period} onChange={(v) => patch({ period: v })} options={[["24h", "24H"], ["7d", "7D"], ["30d", "30D"], ["90d", "90D"]]} />
            <button className="it-btn" style={{ height: 34 }} onClick={() => setSheet(true)}><LuSlidersHorizontal size={15} />Filters{tokens.length ? ` · ${tokens.length}` : ""}</button>
          </div>

          {/* active filters + sort */}
          <div className="cp-active">
            {tokens.length === 0 ? <span>All companies with reported insider purchases · last {f.period.replace("d", " days").replace("24h", "24 hours")} by {f.basis === "filed" ? "SEC publication" : "trade date"}</span>
              : tokens.map(([k, label, reset]) => <span key={k} className="cp-token">{label}<button aria-label={`Remove ${label}`} onClick={() => patch(reset)}><LuX size={11} /></button></span>)}
            {tokens.length > 0 && <button className="it-link" style={{ fontSize: 12 }} onClick={() => { setF({ ...DEFAULTS, anchor: f.anchor }); setPreset(null); }}>Reset all</button>}
            <span className="cp-grow" />
            <span className="cp-row" style={{ gap: 6 }}>Sort
              <Select label="Sort companies" value={f.sort} onChange={(v) => patch({ sort: v, dir: "desc" })} width={196}
                options={{ published: "Newest publication", buyers: "Most independent buyers", value: "Largest verified value", own: "Largest holdings increase", ...(licensed ? { ret: "Return since signal", excess: "Return vs SPY" } : {}) }} />
            </span>
          </div>

          {/* KPI ribbon — responds to filters */}
          <div className="cp-kpis" aria-label="Summary of this screen">
            <div className="cp-kpi"><div className="cp-kpi-label">Companies</div><div className="cp-kpi-value">{busy ? "…" : kpi.companies}</div><div className="cp-kpi-foot">{kpi.clusters} with a buying cluster</div></div>
            <div className="cp-kpi"><div className="cp-kpi-label">Verified purchases</div><div className="cp-kpi-value">{usd(kpi.value)}</div><div className="cp-kpi-foot">open-market + likely, USD</div></div>
            <div className="cp-kpi"><div className="cp-kpi-label">Independent buyers</div><div className="cp-kpi-value">{kpi.econ}</div><div className="cp-kpi-foot">from {kpi.legal} legal filers</div></div>
            <div className="cp-kpi"><div className="cp-kpi-label">New clusters · 7D</div><div className="cp-kpi-value">{kpi.newClusters}</div><div className="cp-kpi-foot">signal published this week</div></div>
            <div className="cp-kpi"><div className="cp-kpi-label">Data confidence</div><div className="cp-kpi-value">{kpi.verified == null ? "—" : `${Math.round(kpi.verified * 100)}%`}</div><div className="cp-kpi-foot">verified · {kpi.warn} with notes</div></div>
            {licensed ? (
              <div className="cp-kpi price" title="Median of companies with a priced entry. Descriptive — past moves, not a prediction."><div className="cp-kpi-label">Median since signal</div><div className={`cp-kpi-value ${tone(kpi.medRet)}`}>{pct(kpi.medRet)}</div><div className="cp-kpi-foot">vs SPY {pts(kpi.medEx)} · n={kpi.n} · {kpi.pending} pending · {kpi.na} N/A</div></div>
            ) : (
              <div className="cp-kpi"><div className="cp-kpi-label">SEC coverage</div><div className="cp-kpi-value" style={{ fontSize: 15, marginTop: 7 }}>{COVERAGE.from} →</div><div className="cp-kpi-foot">{COVERAGE.missingDays} partial index days</div></div>
            )}
          </div>

          {proto.state === "partial" && <div className="cp-coverage" role="status"><LuTriangleAlert size={15} style={{ color: "var(--it-warn)", flex: "none", marginTop: 1 }} /><span><b style={{ color: "var(--it-warn)" }}>Partial data.</b> 3 SEC daily indexes in this period are still loading. Totals cover the loaded days only.</span></div>}

          {proto.state === "error" ? (
            <div className="cp-empty"><div className="cp-empty-icon" style={{ color: "var(--it-sell)" }}><LuTriangleAlert size={22} /></div><b>Could not load the screen</b><span className="it-dim" style={{ fontSize: 13, margin: "4px 0 14px" }}>Your filters are kept. The last loaded result stays available offline.</span><button className="it-btn" onClick={() => setProto((p) => ({ ...p, state: "ready" }))}><LuRefreshCw size={15} />Retry</button></div>
          ) : busy && proto.state === "loading" ? (
            <div style={{ padding: 12 }}>{Array.from({ length: 9 }, (_, i) => <div key={i} className="cp-row" style={{ gap: 14, padding: "10px 4px", borderBottom: "1px solid var(--it-line-soft)" }}><div className="it-skel" style={{ width: 16, height: 16, borderRadius: 999 }} /><div className="cp-col" style={{ gap: 6, width: 200 }}><div className="it-skel" style={{ height: 12, width: 64 }} /><div className="it-skel" style={{ height: 10, width: 150 }} /></div><div className="it-skel" style={{ height: 14, width: 40 }} /><div className="it-skel" style={{ height: 14, width: 70 }} /><div className="it-skel cp-grow" style={{ height: 14 }} /><div className="it-skel" style={{ height: 24, width: 100 }} /></div>)}</div>
          ) : rows.length === 0 ? (
            <div className="cp-empty"><div className="cp-empty-icon"><LuInbox size={22} /></div><b>No companies match this screen</b>
              <span className="it-dim" style={{ fontSize: 13, margin: "4px 0 14px", maxWidth: 420 }}>Insider purchases are rare events — try 2+ buyers instead of 3+, a longer period, or include “likely” open-market purchases.</span>
              <div className="cp-row"><button className="it-btn" onClick={() => { patch({ period: "90d" }); setProto((p) => ({ ...p, state: "ready" })); }}>Widen to 90 days</button><button className="it-btn it-btn-ghost" onClick={() => { setF({ ...DEFAULTS }); setPreset(null); setProto((p) => ({ ...p, state: "ready" })); }}>Reset filters</button></div>
            </div>
          ) : (
            <>
              <div className="cp-table-wrap" style={{ opacity: loadingFlash ? 0.55 : 1, transition: "opacity 140ms ease" }}>
                <table className="cp-table" style={{ minWidth: licensed ? 1080 : 860 }}>
                  <thead>
                    <tr className="cp-groups">
                      <th scope="colgroup" />
                      <th scope="colgroup" colSpan={actCols} className="act">SEC buying activity</th>
                      {licensed && priceCols > 0 && <th scope="colgroup" colSpan={priceCols} className="price">Stock price since publication · simulated EOD · as of {PRICE_ASOF_LABEL}</th>}
                      <th scope="colgroup" />
                    </tr>
                    <tr className="cp-cols">
                      <th scope="col">Company</th>
                      <SortTh k="buyers" className="num" title="Independent economic buyers. Legal filers that are one decision-maker are merged — with evidence.">Buyers</SortTh>
                      <SortTh k="value" className="num" title="Verified purchase value (USD) and holdings increase">Verified value</SortTh>
                      <SortTh k="published" title="SEC acceptance time of the anchor filing">Published</SortTh>
                      {showCol("purchases") && <th scope="col" className="num cp-hide-md">Purchases</th>}
                      {showCol("pattern") && <th scope="col" className="cp-hide-md" title="Purchase days over the last 30 days, and the buying trend">Activity pattern</th>}
                      {showCol("insiderPx") && <th scope="col" className="num cp-hide-md">Insider avg</th>}
                      {showCol("ret") && (
                        <th scope="col" className="price" aria-sort={f.sort === "ret" ? (f.dir === "asc" ? "ascending" : "descending") : "none"}>
                          <button className="cp-sort" onClick={() => onSort("ret")}>Since<span aria-hidden="true" style={{ opacity: f.sort === "ret" ? 1 : 0.25, fontSize: 9 }}>{f.sort === "ret" && f.dir === "asc" ? "▲" : "▼"}</span></button>
                          <span className="cp-anchor" role="group" aria-label="Return anchor">
                            <button aria-pressed={f.anchor === "signal"} onClick={() => setF((x) => ({ ...x, anchor: "signal" }))} title="Since the first filing that made this company meet your screen">signal</button>
                            <button aria-pressed={f.anchor === "latest"} onClick={() => setF((x) => ({ ...x, anchor: "latest" }))} title="Since the most recent qualifying filing">latest</button>
                          </span>
                        </th>
                      )}
                      {showCol("horizons") && <th scope="col" className="price num cp-hide-md">R1 · R5 · R20</th>}
                      {showCol("peak") && <th scope="col" className="price num cp-hide-md" title="Highest high since entry. Hindsight — not an achievable return.">Peak <i style={{ fontWeight: 500 }}>(hindsight)</i></th>}
                      {showCol("trend") && <th scope="col" className="price">Trend</th>}
                      <th scope="col" style={{ width: 40 }}><span className="sr-only" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Expand</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((c) => {
                      const open = expanded.has(c.id);
                      const anchorAt = f.anchor === "latest" ? c.publication.latestAt : c.publication.signalAt;
                      const p = perfOf(c, f.anchor);
                      return (
                        <Fragment key={c.id}>
                          <tr className="cp-tr" aria-expanded={open} onClick={() => toggleRow(c.id)}>
                            <td>
                              <div className="cp-co">
                                <ConfidenceGlyph status={c.quality.status} />
                                <div style={{ minWidth: 0 }}>
                                  <div className="cp-row" style={{ gap: 7 }}>
                                    <a className="cp-ticker" href={`/insider/company/${encodeURIComponent(c.ticker)}`} onClick={(e) => { e.stopPropagation(); e.preventDefault(); setToast(`Opens the existing company page: /insider/company/${c.ticker}`); }}>{c.ticker}</a>
                                    <ClusterBadge type={c.cluster} />
                                  </div>
                                  <div className="cp-co-name" title={c.name}>{c.name}</div>
                                </div>
                              </div>
                            </td>
                            <td className="num">
                              <div className="cp-big">{c.buyers.economic}</div>
                              {c.buyers.legal > c.buyers.economic && <div className="cp-small" title="Legal filers merged into independent buyers">of {c.buyers.legal} filers</div>}
                              <div style={{ display: "flex", justifyContent: "flex-end" }}><RoleChips roles={c.buyers.roles} /></div>
                            </td>
                            <td className="num">
                              <div className="cp-big">{usd(c.purchases.verifiedValue)}</div>
                              <div className="cp-vbar" aria-hidden="true"><i style={{ width: `${Math.max(4, (c.purchases.verifiedValue / maxValue) * 100)}%` }} /></div>
                              <div className="cp-small" style={{ marginTop: 4 }} title="Increase of the insiders’ holdings from these purchases (Form 4 shares owned after)">holdings <span style={{ color: "var(--cp-act)", fontWeight: 600 }}>+{(c.purchases.deltaOwnPct * 100).toFixed(c.purchases.deltaOwnPct < 0.1 ? 1 : 0)}%</span></div>
                            </td>
                            <td>
                              <div style={{ fontWeight: 600, whiteSpace: "nowrap" }}><LuClock size={12} style={{ verticalAlign: -1, marginRight: 5, color: "var(--it-text-3)" }} />{ago(anchorAt)}{f.anchor === "signal" && c.publication.laterFilings > 0 && <span className="cp-later" title={`${c.publication.laterFilings} later qualifying filing(s) after the signal`}>+{c.publication.laterFilings} later</span>}</div>
                              <div className="cp-small" style={{ marginTop: 3 }}>{etTime(anchorAt)}</div>
                              <div className="cp-small">{f.anchor === "signal" ? "signal filing" : "latest filing"}</div>
                            </td>
                            {showCol("purchases") && <td className="num cp-hide-md"><div className="it-num" style={{ fontWeight: 600 }}>{c.purchases.count}</div><div className="cp-small">{c.purchases.verifiedOM} verified OM</div>{c.purchases.offering > 0 && <div className="cp-small" style={{ color: "var(--it-warn)" }}>{c.purchases.offering} offering</div>}</td>}
                            {showCol("pattern") && <td className="cp-hide-md"><PatternCell c={c} /></td>}
                            {showCol("insiderPx") && <td className="num cp-hide-md it-num">{price(c.purchases.insiderAvgPrice)}</td>}
                            {showCol("ret") && <td className="price"><ReturnCell c={c} anchor={f.anchor} /></td>}
                            {showCol("horizons") && <td className="price num cp-hide-md">{hasPrice(p) ? <div className="cp-col it-num" style={{ gap: 2, fontSize: 12 }}>{[["r1", 1], ["r5", 5], ["r20", 20]].map(([k, n]) => <span key={k}><span className="cp-small">{k.toUpperCase()} </span>{p[k] == null ? <span className="cp-small" title={`Needs ${n} sessions; ${p.sessions} so far`}>pending {p.sessions}/{n}</span> : <span className={tone(p[k])}>{pct(p[k])}</span>}</span>)}</div> : <span className="cp-small">—</span>}</td>}
                            {showCol("peak") && <td className="price num cp-hide-md">{hasPrice(p) ? <span className="cp-hind it-num" title={`Highest high on ${p.peakDate}`}>{pct(p.peak)}</span> : <span className="cp-small">—</span>}</td>}
                            {showCol("trend") && <td className="price">{hasPrice(p) ? <Sparkline c={c} anchor={f.anchor} /> : <span className="cp-small">—</span>}</td>}
                            <td><button className="cp-expand-btn" aria-expanded={open} aria-label={`${open ? "Collapse" : "Expand"} ${c.ticker}`} onClick={(e) => { e.stopPropagation(); toggleRow(c.id); }}><LuChevronRight size={16} /></button></td>
                          </tr>
                          {open && <tr className="cp-xrow"><td colSpan={1 + actCols + priceCols + 1}><ExpandedRow c={c} licensed={licensed} anchor={f.anchor} onEvidence={() => setDrawer(c.id)} /></td></tr>}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <ul className="cp-cards">{pageRows.map((c) => <li key={c.id}><MobileCard c={c} licensed={licensed} anchor={f.anchor} onEvidence={() => setDrawer(c.id)} /></li>)}</ul>
              <div className="cp-pager">
                <span className="it-num">{page * PAGE + 1}–{Math.min(rows.length, (page + 1) * PAGE)} of {rows.length} companies</span>
                <div className="cp-seg" role="group" aria-label="Pages">
                  {Array.from({ length: pages }, (_, i) => <button key={i} aria-pressed={page === i} onClick={() => { setPage(i); window.scrollTo({ top: 0, behavior: "smooth" }); }}>{i + 1}</button>)}
                </div>
              </div>
            </>
          )}

          <div className="cp-defs">
            <p><b>Independent buyers.</b> Economic decision-makers. A person and their trust or LLC, or a fund and its general partner, count once when the filings show they are related. The legal filer count is shown alongside.</p>
            <p><b>Verified value.</b> Shares × reported price of code P purchases. Rows with price-field anomalies, unverified currencies, superseded amendments and duplicate reports are excluded — never deleted; see the evidence drawer.</p>
            <p><b>Since publication.</b> {licensed ? "Entry = first regular-session trade after SEC acceptance + 60 s, or the next open when published outside market hours; latest = last completed daily close. Price return, split-adjusted, dividends excluded. Peak is hindsight." : "Stock-price columns appear when a display-licensed end-of-day price source is connected. Until then the screener shows SEC data only."}</p>
            <p><b>Not investment advice.</b> Factual reported activity and, where licensed, past price moves. Nothing here predicts returns or recommends a trade. SEC history covered: {COVERAGE.from} → {COVERAGE.through}.</p>
          </div>
        </section>
      </main>

      {/* mobile filter sheet */}
      {sheet && (
        <>
          <div className="it-backdrop" onClick={() => setSheet(false)} />
          <div className="it-sheet" role="dialog" aria-modal="true" aria-label="Filters" style={{ padding: "8px 16px 20px" }}>
            <div style={{ width: 36, height: 4, borderRadius: 4, background: "var(--it-line-strong)", margin: "4px auto 12px" }} />
            <div className="cp-row" style={{ justifyContent: "space-between", marginBottom: 12 }}><b style={{ fontSize: 16 }}>Filters</b><button className="it-btn it-btn-ghost it-icon-btn" onClick={() => setSheet(false)} aria-label="Close filters"><LuX size={18} /></button></div>
            <div className="cp-col" style={{ gap: 14 }}>{mobileControls.main}{mobileControls.more}</div>
            <button className="it-btn it-btn-primary" style={{ width: "100%", marginTop: 18, height: 44 }} onClick={() => setSheet(false)}>Show {rows.length} companies</button>
          </div>
        </>
      )}

      {drawerCo && <EvidenceDrawer c={drawerCo} onClose={() => setDrawer(null)} />}

      {/* prototype controls (not part of the product) */}
      {!inFrame && (proto.open ? (
        <aside className="cp-proto" aria-label="Prototype controls">
          <header><span>Prototype controls</span><button className="it-btn it-btn-ghost it-icon-btn" style={{ width: 26, height: 26 }} onClick={() => setProto((p) => ({ ...p, open: false }))} aria-label="Minimize"><LuX size={14} /></button></header>
          <div className="body">
            <div className="cp-col" style={{ gap: 4 }}><span className="cp-small">Data state</span><Seg label="Data state" value={proto.state} onChange={(v) => setProto((p) => ({ ...p, state: v }))} options={[["ready", "Ready"], ["loading", "Loading"], ["partial", "Partial"], ["empty", "Empty"], ["error", "Error"]]} /></div>
            <div className="cp-col" style={{ gap: 4 }}><span className="cp-small">Price lane</span><Seg label="Price licence" value={licensed ? "on" : "off"} onChange={(v) => setProto((p) => ({ ...p, licensed: v === "on" }))} options={[["on", "Licensed EOD (mock)"], ["off", "No licence — launch state"]]} /></div>
            <div className="cp-row" style={{ justifyContent: "space-between" }}>
              <Seg label="Theme" value={proto.theme} onChange={(v) => setProto((p) => ({ ...p, theme: v }))} options={[["dark", "Dark"], ["light", "Light"]]} />
              <button className="it-btn" style={{ height: 28, fontSize: 12 }} onClick={() => setFrame(true)}><LuSmartphone size={14} />Mobile view</button>
            </div>
          </div>
        </aside>
      ) : <button className="it-btn cp-proto-min" onClick={() => setProto((p) => ({ ...p, open: true }))}><LuSlidersHorizontal size={15} />Prototype</button>)}

      {frame && (
        <div className="cp-frame" onClick={() => setFrame(false)}>
          <div className="cp-frame-device" onClick={(e) => e.stopPropagation()}>
            <iframe title="Mobile preview (390 px)" src={`${window.location.pathname}?${toQuery(f, { frame: "1", lic: licensed ? null : "0", theme: proto.theme !== "dark" ? proto.theme : null })}`} />
            <button className="it-btn it-icon-btn cp-frame-close" onClick={() => setFrame(false)} aria-label="Close mobile preview"><LuX size={18} /></button>
          </div>
        </div>
      )}
      <Toast text={toast} />
    </div>
  );
}
