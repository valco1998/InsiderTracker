// Companies — "Evidence Grid" insider-buying screener (GET /api/insider/companies), real SEC data.
// Design ported from client/prototype/companies (mock data); every number here comes from the server
// (server/services/edgar/companyScreener.js): unique buyers by reporting-owner CIK (joint / related filers
// merged with evidence), code P purchases only, superseded Form 4/A rows and price anomalies excluded from
// values, duplicate reports counted once, sales never subtracted. "Partial data" is shown whenever the SEC
// daily indexes behind the window are not all loaded. Rows open the SEC evidence (accessions → sec.gov).
// Kept from Wave 1: one request per query (useCompanyScreener), session-stored filters, Retry on error,
// server-side paging ("Show more"), filters in a bottom sheet on phones.
import { Fragment, lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  LuSearch, LuZap, LuUsers, LuBriefcase, LuGem, LuRepeat, LuRadar, LuChevronRight, LuX, LuBookmark,
  LuSlidersHorizontal, LuInbox, LuRefreshCw, LuTriangleAlert, LuClock, LuChartLine,
} from "react-icons/lu";
import api from "../../../lib/api";
import { useInsider } from "../InsiderContext";
import useCompanyScreener from "../../../hooks/useCompanyScreener";
import { Disclaimer } from "../components/Common";
import { compactUsd, count, day, price as fmtPrice, acceptedShort, ago } from "../../../utils/insiderFormat";
import {
  BASIS_OPTIONS, BUYER_OPTIONS, CLUSTER_TYPE_OPTIONS, CONF_OPTIONS, DEFAULT_SCREENER_FILTERS, PERIOD_OPTIONS, PTYPE_OPTIONS, PUB_OPTIONS,
  ROLE_OPTIONS, SORT_OPTIONS, VALUE_OPTIONS, activeScreenerFilters, describeScreen, normalizeScreenerFilters, screenerQuery,
} from "../../../utils/insiderScreener";
import { CLUSTER_DEF, etToIso, holdingsLabel } from "../../../utils/companiesEvidence";
import { ActivityStrip, ClusterBadge, CompanyLogo, ConfidenceGlyph, EvidenceDrawer, ExpandedRow, MobileCard, PatternCell, RoleChips } from "./evidenceParts";
import "./companies.css";

// Price & insider purchases (Backtesting's TrackChart + ECharts) — loaded only when opened.
const PriceDrawer = lazy(() => import("./PriceDrawer.jsx"));

const STORE_KEY = "it.companiesScreen.v2";
const SAVED_KEY = "it.companiesScreens.saved.v1";
const PAGE = 100;
const MAX_LIMIT = 500;

// Presets (activity only — the price lane is off until a display-licensed EOD source exists).
const PRESETS = [
  { key: "fresh", label: "Fresh insider activity", icon: LuZap, patch: { pub: "72h", ptype: "likely" }, hint: "Published in the last 72 hours, offerings excluded" },
  { key: "multi", label: "Multiple independent buyers", icon: LuUsers, patch: { minBuyers: 2 }, hint: "2+ independent economic buyers" },
  { key: "exec", label: "CEO & CFO purchases", icon: LuBriefcase, patch: { roles: ["CEO", "CFO"] }, hint: "A CEO or CFO bought" },
  { key: "large", label: "Large open-market purchases", icon: LuGem, patch: { value: "1m", ptype: "verified" }, hint: "$1M+ stated open-market purchases" },
  { key: "repeat", label: "Repeated buying", icon: LuRepeat, patch: { repeat: true }, hint: "The same insider bought on several dates" },
  { key: "clusters", label: "Recently published clusters", icon: LuRadar, patch: { clusterTypes: ["A", "B", "C"], pub: "7d" }, hint: "Cluster A/B/C published in the last 7 days" },
];
const presetFilters = (base, p) => normalizeScreenerFilters({ ...DEFAULT_SCREENER_FILTERS, period: base.period, from: base.from, to: base.to, basis: base.basis, sort: base.sort, dir: base.dir, ...p.patch });

const store = {
  get(k, d) { try { const v = (k === SAVED_KEY ? localStorage : sessionStorage).getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { (k === SAVED_KEY ? localStorage : sessionStorage).setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

function useScreenerFilters() {
  const [filters, setFilters] = useState(() => normalizeScreenerFilters(store.get(STORE_KEY, null) || store.get("it.companiesScreen.v1", null)));
  useEffect(() => { store.set(STORE_KEY, filters); }, [filters]);
  const patch = useCallback((p) => setFilters((f) => normalizeScreenerFilters({ ...f, ...p })), []);
  const replace = useCallback((f) => setFilters(normalizeScreenerFilters(f)), []);
  return { filters, patch, replace };
}

// Small one-shot queries (preset counts, latest filings): same endpoint, refreshed with the snapshot version.
function useQuick(paramsList, dataVersion) {
  const key = JSON.stringify(paramsList);
  const [out, setOut] = useState({});
  useEffect(() => {
    let live = true;
    const list = JSON.parse(key);
    const t = setTimeout(() => {
      Promise.all(list.map(([k, params]) => api.get("/insider/companies", { params }).then(({ data }) => [k, data]).catch(() => [k, null])))
        .then((pairs) => { if (live) setOut(Object.fromEntries(pairs)); });
    }, 120);
    return () => { live = false; clearTimeout(t); };
  }, [key, dataVersion]);
  return out;
}

// ---------------------------------------------------------------- small UI
function Seg({ value, options, onChange, label }) {
  return (
    <div className="cp-seg it-scroll-x" role="group" aria-label={label} style={{ maxWidth: "100%" }}>
      {options.map((o) => <button key={o.key} aria-pressed={value === o.key} onClick={() => onChange(o.key)}>{o.label}</button>)}
    </div>
  );
}
function Field({ label, children }) {
  return <div className="cp-field"><span>{label}</span><div className="cp-row" style={{ gap: 6, flexWrap: "wrap" }}>{children}</div></div>;
}
function Select({ value, options, onChange, label, width }) {
  return (
    <select className="it-input cp-select" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} style={{ width }}>
      {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
    </select>
  );
}

function FilterControls({ f, patch, vertical = false }) {
  const toggle = (k, v) => patch({ [k]: f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v] });
  const buyerOpts = BUYER_OPTIONS.map((n) => ({ key: String(n), label: n === 1 ? "Any" : `${n}+` }));
  const main = (
    <>
      <Field label="Period"><Seg label="Period" value={f.period} onChange={(v) => patch({ period: v })} options={PERIOD_OPTIONS.filter((o) => o.key !== "custom")} /></Field>
      <Field label="Date basis"><Seg label="Date basis" value={f.basis} onChange={(v) => patch({ basis: v })} options={BASIS_OPTIONS.map((o) => ({ key: o.key, label: o.key === "filingDate" ? "SEC published" : "Trade date" }))} /></Field>
      <Field label="Independent buyers"><Seg label="Minimum independent buyers" value={String(f.minBuyers)} onChange={(v) => patch({ minBuyers: Number(v) })} options={buyerOpts} /></Field>
      <Field label="Purchase value"><Select label="Minimum purchase value" value={f.value} options={VALUE_OPTIONS.filter((o) => o.key !== "custom")} onChange={(v) => patch({ value: v })} width={118} /></Field>
      <Field label="Roles">{ROLE_OPTIONS.map((r) => <button key={r.key} className="cp-toggle" aria-pressed={f.roles.includes(r.key)} onClick={() => toggle("roles", r.key)}>{r.label}</button>)}</Field>
      <Field label="Purchase type"><Select label="Purchase type" value={f.ptype} options={PTYPE_OPTIONS} onChange={(v) => patch({ ptype: v, openMarket: v === "verified" })} width={vertical ? "100%" : 196} /></Field>
    </>
  );
  const more = (
    <>
      <Field label="Cluster type">{CLUSTER_TYPE_OPTIONS.map((t) => <button key={t} className="cp-toggle" aria-pressed={f.clusterTypes.includes(t)} title={CLUSTER_DEF[t]} onClick={() => toggle("clusterTypes", t)}>Cluster {t}</button>)}
        <button className="cp-toggle" aria-pressed={f.clusterOnly} title="3+ distinct buyers within a 30-day window" onClick={() => patch({ clusterOnly: !f.clusterOnly })}>3+ in 30 days</button></Field>
      <Field label="Published"><Select label="Published within" value={f.pub} options={PUB_OPTIONS} onChange={(v) => patch({ pub: v })} width="100%" /></Field>
      <Field label="Data confidence"><Select label="Data confidence" value={f.conf} options={CONF_OPTIONS} onChange={(v) => patch({ conf: v })} width="100%" /></Field>
      <Field label="Buying pattern"><button className="cp-toggle" aria-pressed={f.repeat} onClick={() => patch({ repeat: !f.repeat })}>Repeated buying only</button></Field>
      <Field label="Display"><button className="cp-toggle" aria-pressed={f.showSales} title="Insider sales as separate columns (never subtracted)" onClick={() => patch({ showSales: !f.showSales })}>Show sales</button></Field>
    </>
  );
  return { main, more };
}

function activeTokens(f) {
  const t = [];
  const vo = VALUE_OPTIONS.find((o) => o.key === f.value);
  if (f.minBuyers > 1) t.push(["minBuyers", `${f.minBuyers}+ independent buyers`, { minBuyers: 1 }]);
  if (f.value !== "any" && vo) t.push(["value", `${vo.label} purchases`, { value: "any" }]);
  if (f.roles.length) t.push(["roles", f.roles.map((r) => ROLE_OPTIONS.find((o) => o.key === r)?.label || r).join(" / "), { roles: [] }]);
  if (f.ptype !== "all") t.push(["ptype", PTYPE_OPTIONS.find((o) => o.key === f.ptype)?.label, { ptype: "all", openMarket: false }]);
  if (f.clusterTypes.length) t.push(["clusterTypes", `Cluster ${f.clusterTypes.join("/")}`, { clusterTypes: [] }]);
  if (f.clusterOnly) t.push(["clusterOnly", "3+ buyers in 30 days", { clusterOnly: false }]);
  if (f.pub !== "any") t.push(["pub", `Published: ${PUB_OPTIONS.find((o) => o.key === f.pub)?.label.toLowerCase()}`, { pub: "any" }]);
  if (f.conf !== "all") t.push(["conf", CONF_OPTIONS.find((o) => o.key === f.conf)?.label, { conf: "all" }]);
  if (f.repeat) t.push(["repeat", "Repeated buying", { repeat: false }]);
  if (f.q.trim()) t.push(["q", `“${f.q.trim()}”`, { q: "" }]);
  return t;
}

// ---------------------------------------------------------------- page
export default function CompaniesScreener() {
  const { dataVersion } = useInsider();
  const navigate = useNavigate();
  const { filters: f, patch, replace } = useScreenerFilters();
  const [debounced, setDebounced] = useState(f);
  useEffect(() => { const t = setTimeout(() => setDebounced(f), 250); return () => clearTimeout(t); }, [f]);
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => { setLimit(PAGE); }, [debounced]);
  const q = useMemo(() => screenerQuery(debounced, { limit }), [debounced, limit]);
  const { data, loading, error, retry } = useCompanyScreener(q.params || null, dataVersion);

  const [preset, setPreset] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set());
  const [drawer, setDrawer] = useState(null);
  const [priceFor, setPriceFor] = useState(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [saved, setSaved] = useState(() => store.get(SAVED_KEY, []));
  const [savedOpen, setSavedOpen] = useState(false);
  const [acOpen, setAcOpen] = useState(false);

  // Preset counts + latest-filings strip: small queries on the same period / basis.
  const quick = useQuick([
    ...PRESETS.map((p) => [p.key, { ...screenerQuery(presetFilters(debounced, p), { limit: 1 }).params }]),
    ["latest", { ...screenerQuery({ ...DEFAULT_SCREENER_FILTERS, period: debounced.period, basis: debounced.basis }, { limit: 10 }).params, sort: "published", dir: "desc" }],
  ], dataVersion);

  const applyPreset = (p) => {
    if (preset === p.key) { replace({ ...DEFAULT_SCREENER_FILTERS, period: f.period, basis: f.basis }); setPreset(null); return; }
    replace(presetFilters(f, p)); setPreset(p.key);
  };
  const patchUser = useCallback((p) => { patch(p); setPreset(null); }, [patch]);

  const list = useMemo(() => data?.companies || [], [data]);
  const acList = useMemo(() => {
    const s = f.q.trim().toUpperCase();
    return s && list.length ? list.filter((c) => String(c.ticker || "").startsWith(s) || String(c.name || "").toUpperCase().includes(s)).slice(0, 6) : [];
  }, [f.q, list]);
  const maxValue = Math.max(1, ...list.map((c) => c.purchaseValue || 0));
  const tokens = activeTokens(f);
  const nActive = activeScreenerFilters(f);
  const controls = FilterControls({ f, patch: patchUser });
  const mobileControls = FilterControls({ f, patch: patchUser, vertical: true });
  const toggleRow = (k) => setExpanded((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const onSort = (key) => patchUser(f.sort === key ? { sort: key, dir: f.dir === "desc" ? "asc" : "desc" } : { sort: key, dir: "desc" });
  const drawerCo = drawer ? list.find((c) => c.key === drawer) : null;
  const priceCo = priceFor ? list.find((c) => c.key === priceFor) : null;
  const closePrice = useCallback(() => setPriceFor(null), []);
  const t = data?.totals;
  const verifiedShare = t?.quality && t.companies ? t.quality.verified / t.companies : null; // older API: no quality totals → "—"
  const firstLoad = loading && !data;

  const saveScreen = () => {
    const name = preset ? PRESETS.find((p) => p.key === preset).label : tokens.length ? tokens.map((x) => x[1]).slice(0, 2).join(" · ") : `All companies, ${f.period.toUpperCase()}`;
    const entry = { name, filters: f, at: Date.now() };
    const next = [entry, ...saved.filter((s) => JSON.stringify(s.filters) !== JSON.stringify(f))].slice(0, 8);
    setSaved(next); store.set(SAVED_KEY, next);
  };

  const SortTh = ({ k, children, className = "", title }) => (
    <th scope="col" className={className} title={title} aria-sort={f.sort === k ? (f.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button className="cp-sort" onClick={() => onSort(k)}>{children}<span aria-hidden="true" style={{ opacity: f.sort === k ? 1 : 0.25, fontSize: 9 }}>{f.sort === k && f.dir === "asc" ? "▲" : "▼"}</span></button>
    </th>
  );
  const colCount = 7 + (f.showSales ? 1 : 0);

  return (
    <div className="flex flex-col gap-0">
      <div className="cp-head">
        <div>
          <h1 className="cp-title">Companies<small>Insider buying intelligence · SEC Form 4</small></h1>
          <p className="cp-sub">Every company with reported insider purchases, counted by <b style={{ color: "var(--it-text)", fontWeight: 600 }}>independent economic buyers</b> and traced to the SEC filings behind each number.</p>
        </div>
        <div className="cp-head-actions">
          <div className="cp-search">
            <LuSearch size={15} />
            <input className="it-input" placeholder="Ticker or company" aria-label="Search ticker or company" value={f.q}
              onChange={(e) => { patchUser({ q: e.target.value.slice(0, 40) }); setAcOpen(true); }} onFocus={() => setAcOpen(true)} onBlur={() => setTimeout(() => setAcOpen(false), 120)} />
            {acOpen && acList.length > 0 && (
              <div className="cp-ac" role="listbox">
                {acList.map((c) => (
                  <button key={c.key} role="option" aria-selected="false" onMouseDown={() => { patchUser({ q: c.ticker || c.name }); setAcOpen(false); setExpanded(new Set([c.key])); }}>
                    <CompanyLogo cik={c.cik} ticker={c.ticker} name={c.name} small /><span className="cp-ticker">{c.ticker || "—"}</span><span className="cp-co-name cp-grow">{c.name}</span><span className="cp-small">{count(c.uniqueBuyers)} buyer{c.uniqueBuyers === 1 ? "" : "s"}</span>
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
                {saved.map((s) => <button key={s.at} onClick={() => { replace(s.filters); setPreset(null); setSavedOpen(false); }}><span className="cp-grow" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span><LuChevronRight size={14} /></button>)}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* latest SEC publications in this period */}
      {quick.latest?.companies?.length > 0 && (
        <div className="cp-fresh" aria-label="Latest SEC publications">
          <span className="cp-fresh-label"><span className="it-dot it-dot-live" />Latest filings</span>
          <div className="cp-fresh-items">
            {quick.latest.companies.map((c) => (
              <button key={c.key} className="cp-fresh-item" onClick={() => { replace({ ...DEFAULT_SCREENER_FILTERS, period: f.period, basis: f.basis, q: c.ticker || c.name }); setPreset(null); setExpanded(new Set([c.key])); }}>
                <b>{c.ticker || "—"}</b><span>{c.latestAcceptedAt ? ago(etToIso(c.latestAcceptedAt)) : day(c.latestFilingDate)}</span><span className="cp-small">{count(c.uniqueBuyers)} buyer{c.uniqueBuyers === 1 ? "" : "s"} · {compactUsd(c.purchaseValue)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* presets */}
      <div className="cp-presets" role="group" aria-label="Screen presets">
        {PRESETS.map((p) => (
          <button key={p.key} className="cp-preset" aria-pressed={preset === p.key} title={`${p.hint}. Describes activity — not a recommendation.`} onClick={() => applyPreset(p)}>
            <p.icon size={15} />{p.label}<span className="cp-count">{quick[p.key] ? count(quick[p.key].total) : "…"}</span>
          </button>
        ))}
      </div>

      <section className="cp-panel" aria-label="Companies screener">
        <div className="cp-filters cp-filters-desktop" role="search" aria-label="Screen companies">
          {controls.main}
          <div className="cp-spacer" />
          <button className="it-btn" style={{ height: 32 }} aria-expanded={moreOpen} onClick={() => setMoreOpen((v) => !v)}><LuSlidersHorizontal size={15} />More filters</button>
        </div>
        {moreOpen && <div className="cp-more">{controls.more}</div>}

        <div className="cp-mobile-only cp-row" style={{ padding: "10px 12px", borderBottom: "1px solid var(--it-line-soft)", justifyContent: "space-between" }}>
          <Seg label="Period" value={f.period} onChange={(v) => patchUser({ period: v })} options={PERIOD_OPTIONS.filter((o) => o.key !== "custom")} />
          <button className="it-btn" style={{ height: 34, flex: "none" }} onClick={() => setSheet(true)} aria-haspopup="dialog" aria-expanded={sheet}><LuSlidersHorizontal size={15} />Filters{nActive ? ` · ${nActive}` : ""}</button>
        </div>

        <div className="cp-active">
          {tokens.length === 0 ? <span>{describeScreen(f)}</span>
            : tokens.map(([k, label, reset]) => <span key={k} className="cp-token">{label}<button aria-label={`Remove ${label}`} onClick={() => patchUser(reset)}><LuX size={11} /></button></span>)}
          {tokens.length > 0 && <button className="it-link" style={{ fontSize: 12 }} onClick={() => { replace({ ...DEFAULT_SCREENER_FILTERS, period: f.period, basis: f.basis }); setPreset(null); }}>Reset all</button>}
          <span className="cp-grow" />
          <span className="cp-row" style={{ gap: 6 }}>Sort
            <Select label="Sort companies" value={f.sort} onChange={(v) => patchUser({ sort: v, dir: "desc" })} width={210} options={SORT_OPTIONS} />
          </span>
        </div>

        {/* KPI ribbon — responds to filters (totals of the whole screen, not just this page) */}
        <div className="cp-kpis" aria-label="Summary of this screen">
          <div className="cp-kpi"><div className="cp-kpi-label">Companies</div><div className="cp-kpi-value">{t ? count(t.companies) : "…"}</div><div className="cp-kpi-foot">{t?.withCluster != null ? `${count(t.withCluster)} with 3+ buyers in 30 days` : " "}</div></div>
          <div className="cp-kpi"><div className="cp-kpi-label">Reported purchases</div><div className="cp-kpi-value">{t ? compactUsd(t.purchaseValue) : "…"}</div><div className="cp-kpi-foot">{t ? `${count(t.purchaseTransactions)} code P rows · USD` : " "}</div></div>
          <div className="cp-kpi"><div className="cp-kpi-label">Independent buyers</div><div className="cp-kpi-value">{t?.uniqueBuyers != null ? count(t.uniqueBuyers) : "—"}</div><div className="cp-kpi-foot">{t?.legalFilers != null ? `from ${count(t.legalFilers)} legal filers` : " "}</div></div>
          <div className="cp-kpi"><div className="cp-kpi-label">Clusters A · B · C</div><div className="cp-kpi-value">{t?.clusterTypes ? `${t.clusterTypes.A} · ${t.clusterTypes.B} · ${t.clusterTypes.C}` : "—"}</div><div className="cp-kpi-foot">{t?.newClusters7d != null ? `${count(t.newClusters7d)} new in the last 7 days` : " "}</div></div>
          <div className="cp-kpi"><div className="cp-kpi-label">Data confidence</div><div className="cp-kpi-value">{verifiedShare == null ? "—" : `${Math.round(verifiedShare * 100)}%`}</div><div className="cp-kpi-foot">{t?.quality ? `verified · ${count(t.quality.warning + t.quality.uncertain)} with notes` : " "}</div></div>
          <div className="cp-kpi"><div className="cp-kpi-label">SEC coverage</div><div className="cp-kpi-value" style={{ fontSize: 15, marginTop: 7, color: data && !data.coverage.complete ? "var(--it-warn)" : undefined }}>{data ? (data.coverage.complete ? "Complete" : "Partial") : "…"}</div><div className="cp-kpi-foot">{data ? `${day(data.window.from)} – ${day(data.window.to)}` : " "}</div></div>
        </div>

        {data && !data.coverage.complete && (
          <div className="cp-coverage" role="status"><LuTriangleAlert size={15} style={{ color: "var(--it-warn)", flex: "none", marginTop: 1 }} />
            <span><b style={{ color: "var(--it-warn)" }}>Partial data.</b> {String(data.coverage.note || "").replace(/^Partial data:\s*/, "")} Totals cover only the loaded days and are not complete statistics for {day(data.window.from)} – {day(data.window.to)}.</span>
          </div>
        )}
        {q.error && <div className="cp-coverage" role="status"><LuTriangleAlert size={15} style={{ color: "var(--it-warn)", flex: "none" }} /><span>{q.error}</span></div>}

        {error && !data ? (
          <div className="cp-empty"><div className="cp-empty-icon" style={{ color: "var(--it-sell)" }}><LuTriangleAlert size={22} /></div><b>Could not load the screen</b><span className="it-dim" style={{ fontSize: 13, margin: "4px 0 14px" }}>{error} Your filters are kept.</span><button className="it-btn" onClick={retry}><LuRefreshCw size={15} />Retry</button></div>
        ) : firstLoad ? (
          <div style={{ padding: 12 }} aria-busy="true">{Array.from({ length: 9 }, (_, i) => <div key={i} className="cp-row" style={{ gap: 14, padding: "10px 4px", borderBottom: "1px solid var(--it-line-soft)" }}><div className="it-skel" style={{ width: 30, height: 30, borderRadius: 8 }} /><div className="cp-col" style={{ gap: 6, width: 200 }}><div className="it-skel" style={{ height: 12, width: 64 }} /><div className="it-skel" style={{ height: 10, width: 150 }} /></div><div className="it-skel" style={{ height: 14, width: 40 }} /><div className="it-skel" style={{ height: 14, width: 70 }} /><div className="it-skel cp-grow" style={{ height: 14 }} /></div>)}</div>
        ) : data && list.length === 0 ? (
          <div className="cp-empty"><div className="cp-empty-icon"><LuInbox size={22} /></div><b>No companies match this screen</b>
            <span className="it-dim" style={{ fontSize: 13, margin: "4px 0 14px", maxWidth: 420 }}>Insider purchases are rare events — try 2+ buyers instead of 3+, a longer period, or include all purchase types.</span>
            <div className="cp-row"><button className="it-btn" onClick={() => patchUser({ period: "90d" })}>Widen to 90 days</button><button className="it-btn it-btn-ghost" onClick={() => { replace({ ...DEFAULT_SCREENER_FILTERS }); setPreset(null); }}>Reset filters</button></div>
          </div>
        ) : data ? (
          <>
            {error && <div className="cp-coverage" role="status"><LuTriangleAlert size={15} style={{ color: "var(--it-sell)", flex: "none" }} /><span>{error} Showing the last loaded result. <button className="it-link" onClick={retry}>Retry</button></span></div>}
            <div className="cp-table-wrap" style={{ opacity: loading ? 0.6 : 1, transition: "opacity 140ms ease" }}>
              <table className="cp-table" style={{ minWidth: f.showSales ? 1080 : 960 }}>
                <thead>
                  <tr className="cp-groups">
                    <th scope="colgroup" />
                    <th scope="colgroup" colSpan={colCount - 2} className="act">SEC buying activity · {data.window.basis === "filingDate" ? "by SEC filing date" : "by trade date"}</th>
                    <th scope="colgroup" />
                  </tr>
                  <tr className="cp-cols">
                    <th scope="col">Company</th>
                    <SortTh k="buyers" className="num" title="Independent economic buyers. Legal filers that are one decision-maker are merged — with evidence.">Buyers</SortTh>
                    <SortTh k="value" className="num" title="Reported purchase value (USD) and holdings increase">Purchase value</SortTh>
                    <SortTh k="published" title="SEC acceptance time of the latest qualifying filing">Published</SortTh>
                    <SortTh k="transactions" className="num cp-hide-md" title="Code P rows; stated open-market; offerings">Purchases</SortTh>
                    <th scope="col" className="cp-hide-md" title="Purchases per trade date over the last 30 days, and the buying trend">Activity pattern</th>
                    <th scope="col" className="num cp-hide-md" title="Value-weighted average reported purchase price (priced rows)">Insider avg</th>
                    {f.showSales && <th scope="col" className="num" title="Insider sales in the period — shown separately, never subtracted">Sales</th>}
                    <th scope="col" style={{ width: 40 }}><span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Expand</span></th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((c) => {
                    const open = expanded.has(c.key);
                    const pub = etToIso(c.latestAcceptedAt);
                    return (
                      <Fragment key={c.key}>
                        <tr className="cp-tr" aria-expanded={open} onClick={() => toggleRow(c.key)}>
                          <td>
                            <div className="cp-co">
                              <CompanyLogo cik={c.cik} ticker={c.ticker} name={c.name} />
                              <div style={{ minWidth: 0 }}>
                                <div className="cp-row" style={{ gap: 7 }}>
                                  <ConfidenceGlyph status={c.quality?.status} />
                                  {c.ticker ? <Link className="cp-ticker" to={`/insider/company/${encodeURIComponent(c.ticker)}`} onClick={(e) => e.stopPropagation()}>{c.ticker}</Link> : <span className="cp-ticker">—</span>}
                                  <ClusterBadge type={c.clusterType} />
                                  <button className="cp-price-btn" title="Stock price performance with insider purchases marked" aria-label={`Price chart and insider purchases for ${c.ticker || c.name}`} onClick={(e) => { e.stopPropagation(); setPriceFor(c.key); }}><LuChartLine size={14} /></button>
                                </div>
                                <div className="cp-co-name" title={c.name}>{c.name}</div>
                              </div>
                            </div>
                          </td>
                          <td className="num">
                            <div className="cp-big">{count(c.uniqueBuyers)}</div>
                            {c.legalFilers > c.uniqueBuyers && <div className="cp-small" title="Legal filers merged into independent buyers">of {count(c.legalFilers)} filers</div>}
                            {c.cluster && <div className="cp-small" title={`${c.cluster.peakBuyers} distinct buyers within 30 days (${day(c.cluster.from)} – ${day(c.cluster.to)})`} style={{ color: "var(--cp-act)" }}>{c.cluster.peakBuyers} in 30d</div>}
                            <div style={{ display: "flex", justifyContent: "flex-end" }}><RoleChips roles={c.roles} /></div>
                          </td>
                          <td className="num">
                            <div className="cp-big">{compactUsd(c.purchaseValue)}</div>
                            <div className="cp-vbar" aria-hidden="true"><i style={{ width: `${Math.max(4, ((c.purchaseValue || 0) / maxValue) * 100)}%` }} /></div>
                            {holdingsLabel(c.holdingsIncrease) && <div className="cp-small" style={{ marginTop: 4 }} title="Shares bought ÷ shares held before (Form 4 shares owned after)">holdings <span style={{ color: "var(--cp-act)", fontWeight: 600 }}>{holdingsLabel(c.holdingsIncrease)}</span></div>}
                            {c.purchaseValueMissing > 0 && <div className="cp-small" style={{ color: "var(--it-warn)" }} title="Rows without a usable price — counted as purchases, not in value">+{count(c.purchaseValueMissing)} unpriced</div>}
                          </td>
                          <td>
                            <div style={{ fontWeight: 600, whiteSpace: "nowrap" }}><LuClock size={12} style={{ verticalAlign: -1, marginRight: 5, color: "var(--it-text-3)" }} />{pub ? ago(pub) : day(c.latestFilingDate)}{c.filings > 1 && <span className="cp-later" title={`${c.filings} SEC filings in this period`}>{c.filings} filings</span>}</div>
                            <div className="cp-small" style={{ marginTop: 3 }}>{acceptedShort(c.latestAcceptedAt)}</div>
                            <div className="cp-small">last trade {day(c.latestPurchaseDate)}</div>
                          </td>
                          <td className="num cp-hide-md"><div className="it-num" style={{ fontWeight: 600 }}>{count(c.purchaseTransactions)}</div><div className="cp-small">{count(c.purchaseTypes?.openMarket)} open-mkt</div>{c.purchaseTypes?.offering > 0 && <div className="cp-small" style={{ color: "var(--it-warn)" }}>{count(c.purchaseTypes.offering)} offering</div>}</td>
                          <td className="cp-hide-md"><PatternCell c={c} /></td>
                          <td className="num cp-hide-md it-num">{c.avgPrice != null ? fmtPrice(c.avgPrice) : "—"}</td>
                          {f.showSales && <td className="num"><div className="it-num" style={{ color: c.saleValue ? "var(--it-sell)" : "var(--it-text-3)" }}>{c.saleValue ? compactUsd(c.saleValue) : "—"}</div>{c.uniqueSellers > 0 && <div className="cp-small">{count(c.uniqueSellers)} seller{c.uniqueSellers === 1 ? "" : "s"}</div>}</td>}
                          <td><button className="cp-expand-btn" aria-expanded={open} aria-label={`${open ? "Collapse" : "Expand"} ${c.ticker || c.name}`} onClick={(e) => { e.stopPropagation(); toggleRow(c.key); }}><LuChevronRight size={16} /></button></td>
                        </tr>
                        {open && <tr className="cp-xrow"><td colSpan={colCount + 1}><ExpandedRow c={c} onEvidence={() => setDrawer(c.key)} onPrice={() => setPriceFor(c.key)} /></td></tr>}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <ul className="cp-cards">{list.map((c) => <li key={c.key}><MobileCard c={c} onEvidence={() => setDrawer(c.key)} onPrice={() => setPriceFor(c.key)} onOpen={() => (c.ticker ? navigate(`/insider/company/${encodeURIComponent(c.ticker)}`) : setDrawer(c.key))} /></li>)}</ul>
            <div className="cp-pager">
              <span className="it-num">{count(list.length)} of {count(data.total)} companies</span>
              {list.length < data.total && (limit < MAX_LIMIT
                ? <button className="it-btn" onClick={() => setLimit((n) => Math.min(MAX_LIMIT, n + PAGE))}>Show {count(Math.min(PAGE, data.total - list.length))} more</button>
                : <span>Showing the first {count(MAX_LIMIT)} — narrow the screen to see more.</span>)}
            </div>
          </>
        ) : null}

        <div className="cp-defs">
          {data?.definitions && <>
            <p><b>Independent buyers.</b> {data.definitions.uniqueBuyers}</p>
            <p><b>Purchase value.</b> {data.definitions.purchaseValue}</p>
            <p><b>Clusters.</b> {data.definitions.clusterType} The “in 30d” mark: {data.definitions.cluster}</p>
            <p><b>Confidence.</b> {data.definitions.quality}</p>
          </>}
          <p className="cp-defs-note"><b>Not investment advice.</b> Factual reported SEC activity. Stock-price columns appear only when a display-licensed end-of-day price source is connected. Company logos are self-hosted icons from each company’s SEC-verified official website and remain trademarks of their owners; other companies show ticker initials.</p>
        </div>
      </section>
      <div style={{ marginTop: 16 }}><Disclaimer /></div>

      {sheet && (
        <>
          <div className="it-backdrop" onClick={() => setSheet(false)} />
          <div className="it-sheet" role="dialog" aria-modal="true" aria-label="Filters" style={{ padding: "8px 16px 20px" }}>
            <div style={{ width: 36, height: 4, borderRadius: 4, background: "var(--it-line-strong)", margin: "4px auto 12px" }} />
            <div className="cp-row" style={{ justifyContent: "space-between", marginBottom: 12 }}><b style={{ fontSize: 16 }}>Filters</b><button className="it-btn it-btn-ghost it-icon-btn" onClick={() => setSheet(false)} aria-label="Close filters"><LuX size={18} /></button></div>
            <div className="cp-col" style={{ gap: 14 }}>{mobileControls.main}{mobileControls.more}
              <Field label="Sort"><Select label="Sort companies" value={f.sort} onChange={(v) => patchUser({ sort: v, dir: "desc" })} width="100%" options={SORT_OPTIONS} /></Field>
            </div>
            <div className="cp-row" style={{ marginTop: 18, gap: 8 }}>
              {nActive > 0 && <button className="it-btn" style={{ height: 44 }} onClick={() => { replace({ ...DEFAULT_SCREENER_FILTERS, period: f.period, basis: f.basis }); setPreset(null); }}>Reset ({nActive})</button>}
              <button className="it-btn it-btn-primary cp-grow" style={{ height: 44 }} onClick={() => setSheet(false)}>Show {data ? count(data.total) : ""} companies</button>
            </div>
          </div>
        </>
      )}

      {drawerCo && <EvidenceDrawer c={drawerCo} params={q.params} onClose={() => setDrawer(null)} />}
      {priceCo && <Suspense fallback={null}><PriceDrawer c={priceCo} from={priceCo.firstPurchaseDate || data?.window?.from} to={data?.window?.to} onClose={closePrice} /></Suspense>}
    </div>
  );
}

// Exposed for tests / reuse.
export { ActivityStrip, PRESETS };
