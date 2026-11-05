// Companies — Evidence Grid building blocks (real SEC data from GET /api/insider/companies and
// GET /api/insider/companies/:cik/evidence). Ported from client/prototype/companies/parts.jsx; the price lane
// (returns, sparkline) is not rendered — no display-licensed price source is configured.
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Link } from "react-router-dom";
import { LuX, LuExternalLink, LuInfo, LuTriangleAlert, LuShieldCheck, LuFileSearch, LuChevronRight, LuChartLine } from "react-icons/lu";
import api from "../../../lib/api";
import { compactUsd, count, price as fmtPrice, shortDay, acceptedShort, ago } from "../../../utils/insiderFormat";
import { CONF, QUALITY_FLAG, CLUSTER_DEF, MOMENTUM, PURCHASE_TYPE, ROLE_TITLE, roleChips, evolutionPoints, holdingsLabel, etToIso } from "../../../utils/companiesEvidence";
import { loadLogoManifest, logoFor, initialsOf, onLogosLoaded, logosReady } from "../../../utils/issuerLogos";

// ---------------------------------------------------------------- logo
const subscribeLogos = (cb) => { loadLogoManifest(); return onLogosLoaded(cb); };
export function CompanyLogo({ cik, ticker, name, small = false }) {
  const ready = useSyncExternalStore(subscribeLogos, logosReady, () => false);
  const [failed, setFailed] = useState(false);
  const logo = ready && !failed ? logoFor(cik) : null;
  return (
    <span className={`cp-logo-tile${small ? " sm" : ""}${logo?.bg === "dark" ? " dark" : ""}`} aria-hidden="true">
      {logo ? <img src={logo.src} alt="" width={22} height={22} loading="lazy" decoding="async" onError={() => setFailed(true)} /> : initialsOf(ticker, name)}
    </span>
  );
}

// ---------------------------------------------------------------- confidence / marks
export function ConfidenceGlyph({ status = "verified", size = 14 }) {
  const c = status === "verified" ? "var(--it-text-2)" : status === "warning" ? "var(--it-warn-fill)" : "var(--it-text-3)";
  const info = CONF[status] || CONF.verified;
  return (
    <svg className="cp-conf" width={size} height={size} viewBox="0 0 14 14" role="img" aria-label={`Data confidence: ${info.label}`}>
      <title>{`${info.label} — ${info.detail}`}</title>
      {status === "verified" && <><circle cx="7" cy="7" r="5.5" fill={c} /><path d="M4.6 7.1l1.6 1.6 3.2-3.3" stroke="var(--it-panel)" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" /></>}
      {status === "warning" && <><circle cx="7" cy="7" r="5" fill="none" stroke={c} strokeWidth="1.5" /><path d="M7 2a5 5 0 0 1 0 10z" fill={c} /></>}
      {status === "uncertain" && <circle cx="7" cy="7" r="5" fill="none" stroke={c} strokeWidth="1.5" strokeDasharray="2 2" />}
    </svg>
  );
}
export function ClusterBadge({ type }) {
  if (!type) return null;
  return <span className="cp-cluster" title={`Cluster ${type}: ${CLUSTER_DEF[type]}. Factual pattern — not a recommendation.`}><b>{type}</b><span>Cluster</span></span>;
}
export function RoleChips({ roles }) {
  const chips = roleChips(roles);
  if (!chips.length) return null;
  return <div className="cp-roles">{chips.map((r) => <span key={r} className={`cp-role${r === "CEO" || r === "CFO" ? " exec" : ""}`} title={ROLE_TITLE[r]}>{r}</span>)}</div>;
}
export function ActivityStrip({ days = [], end }) {
  const max = Math.max(1, ...days);
  const n = days.filter(Boolean).length;
  return (
    <div className="cp-strip" role="img" aria-label={`Purchases on ${n} of the last ${days.length} days`} title={`Purchases per trade date, ${days.length} days to ${shortDay(end)} (oldest → newest)`}>
      {days.map((d, i) => (d ? <i key={i} style={{ height: `${4 + (d / max) * 14}px`, opacity: 0.45 + (d / max) * 0.55 }} /> : <i key={i} className="z" />))}
    </div>
  );
}
export function PatternCell({ c }) {
  const a = c.activity || {};
  return (
    <div>
      <ActivityStrip days={a.days} end={a.end} />
      <div className="cp-pat-label">
        <span title="Purchases in the last 7 days vs the 7 days before">{MOMENTUM[a.momentum] || "—"}</span>
        {a.repeat && <span className="cp-small" title="The same insider bought on 2+ dates">· repeat</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- cluster evolution (from the buyers list)
function Evolution({ c }) {
  const ev = evolutionPoints(c.buyersList);
  if (!ev.length) return <div className="cp-small">No dated purchases.</div>;
  const w = 420, h = 116, padL = 26, padR = 10, padT = 14, padB = 22;
  const t = (d) => Date.parse(`${d}T12:00:00Z`);
  const t0 = t(ev[0].date) - 86_400_000, t1 = Math.max(t(c.activity?.end || ev[ev.length - 1].date), t(ev[ev.length - 1].date)) + 86_400_000;
  const maxB = Math.max(ev.length, 2);
  const x = (ms) => padL + ((ms - t0) / (t1 - t0 || 1)) * (w - padL - padR);
  const y = (b) => padT + (1 - b / maxB) * (h - padT - padB);
  const maxV = Math.max(1, ...ev.map((e) => e.value));
  let d = `M${x(t0)},${y(0)}`;
  for (const e of ev) d += `H${x(t(e.date))}V${y(e.cumulative)}`;
  d += `H${x(t1)}`;
  const pub = etToIso(c.firstAcceptedAt);
  const step = Math.max(1, Math.ceil(maxB / 3));
  return (
    <svg className="cp-evo" width="100%" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Cluster evolution: ${ev.length} independent buyers by first purchase date`} style={{ display: "block", maxWidth: w }}>
      {[...Array(maxB + 1).keys()].filter((b) => b % step === 0).map((b) => (
        <g key={b}>
          <line x1={padL} x2={w - padR} y1={y(b)} y2={y(b)} stroke="var(--it-line-soft)" />
          <text x={padL - 8} y={y(b) + 3.5} textAnchor="end" fontSize="9.5" fill="var(--it-text-3)">{b}</text>
        </g>
      ))}
      {pub && Date.parse(pub) >= t0 && Date.parse(pub) <= t1 && (
        <g>
          <line x1={x(Date.parse(pub))} x2={x(Date.parse(pub))} y1={padT - 6} y2={h - padB} stroke="var(--cp-act)" strokeDasharray="3 3" />
          <text x={x(Date.parse(pub)) - 4} y={h - padB - 5} fontSize="9.5" fill="var(--cp-act)" fontWeight="600" textAnchor="end">First SEC filing</text>
        </g>
      )}
      <path d={d} fill="none" stroke="var(--cp-act)" strokeWidth="2" />
      {ev.map((e, i) => (
        <circle key={i} cx={x(t(e.date))} cy={y(e.cumulative)} r={3 + (e.value / maxV) * 4} fill="var(--cp-act)" stroke="var(--cp-act)" strokeWidth="1.5" opacity="0.9">
          <title>{`${e.name}${e.roles?.length ? ` (${e.roles.join(", ")})` : ""} · first bought ${shortDay(e.date)} · ${compactUsd(e.value)} in the period`}</title>
        </circle>
      ))}
      <text x={padL} y={h - 6} fontSize="9.5" fill="var(--it-text-3)">{shortDay(new Date(t0).toISOString().slice(0, 10))}</text>
      <text x={w - padR} y={h - 6} fontSize="9.5" fill="var(--it-text-3)" textAnchor="end">{shortDay(new Date(t1).toISOString().slice(0, 10))}</text>
    </svg>
  );
}

function FlagList({ flags = [] }) {
  return flags.map((f) => {
    const q = QUALITY_FLAG[f.code] || { label: f.code, detail: "" };
    return <div key={f.code} className="cp-row" style={{ alignItems: "flex-start", color: "var(--it-warn)", fontSize: 12 }}><LuTriangleAlert size={13} style={{ flex: "none", marginTop: 2 }} /><span><b>{q.label}.</b> <span className="it-dim">{count(f.count)} {q.detail}</span></span></div>;
  });
}

export function ExpandedRow({ c, onEvidence, onPrice }) {
  const types = c.purchaseTypes || {};
  return (
    <div className="cp-x">
      <section aria-label="Buyers">
        <h4><span>Independent buyers · {count(c.uniqueBuyers)}</span><span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 500 }}>{count(c.legalFilers)} legal filer{c.legalFilers === 1 ? "" : "s"}</span></h4>
        {(c.buyersList || []).map((b) => (
          <div key={b.name + b.firstDate} className="cp-buyer">
            <div className="cp-row" style={{ minWidth: 0 }}><span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.name}</span><RoleChips roles={b.roles} /></div>
            <div className="it-num" style={{ textAlign: "right", fontWeight: 600 }}>{compactUsd(b.value)}</div>
            <div className="cp-small">{holdingsLabel(b.holdingsIncrease) ? <>Holdings <span style={{ color: "var(--cp-act)" }}>{holdingsLabel(b.holdingsIncrease)}</span> · </> : null}{count(b.transactions)} purchase{b.transactions === 1 ? "" : "s"} · {shortDay(b.firstDate)}{b.lastDate !== b.firstDate ? `–${shortDay(b.lastDate)}` : ""}</div>
            <div className="cp-small" style={{ textAlign: "right" }}>{count(b.shares)} sh</div>
            {b.reportingOwners?.length > 1 && <div className="cp-legal" title="Legal filers merged into this one economic buyer">{b.reportingOwners.map((o) => <span key={o}>{o}</span>)}</div>}
          </div>
        ))}
        {c.uniqueBuyers > (c.buyersList || []).length && <div className="cp-small" style={{ marginTop: 6 }}>{(c.buyersList || []).length ? `+${count(c.uniqueBuyers - c.buyersList.length)} more — see evidence` : "Buyer details — see evidence"}</div>}
      </section>
      <section aria-label="Cluster evolution">
        <h4><span>Cluster evolution</span><span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 500 }}>dot size = value in the period</span></h4>
        <Evolution c={c} />
        {c.cluster && (
          <div className="cp-note"><LuInfo size={14} style={{ flex: "none", marginTop: 2, color: "var(--cp-act)" }} />
            <span>Cluster window {shortDay(c.cluster.from)} – {shortDay(c.cluster.to)}: <b>{count(c.cluster.peakBuyers)}</b> distinct buyers within 30 days{c.clusterType ? <> · strongest pattern <b>Cluster {c.clusterType}</b> ({CLUSTER_DEF[c.clusterType]})</> : null}.</span>
          </div>
        )}
      </section>
      <section aria-label="Evidence">
        <h4><span>Evidence</span><span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 500 }}><ConfidenceGlyph status={c.quality?.status} size={12} /> {CONF[c.quality?.status]?.label}</span></h4>
        <div className="cp-col" style={{ gap: 6, fontSize: 12.5 }}>
          <div className="cp-row" style={{ justifyContent: "space-between" }}><span className="it-dim">SEC filings</span><b className="it-num">{count(c.filings)}</b></div>
          <div className="cp-row" style={{ justifyContent: "space-between" }}><span className="it-dim">Purchases · stated open-market</span><b className="it-num">{count(types.openMarket)} of {count(c.purchaseTransactions)}</b></div>
          {types.offering > 0 && <div className="cp-row" style={{ justifyContent: "space-between" }}><span className="it-dim">Offering / private</span><b className="it-num" style={{ color: "var(--it-warn)" }}>{count(types.offering)}</b></div>}
          <div className="cp-row" style={{ justifyContent: "space-between" }}><span className="it-dim">First / latest SEC acceptance</span><b className="it-num" style={{ fontWeight: 500 }}>{acceptedShort(c.firstAcceptedAt)}{c.latestAcceptedAt !== c.firstAcceptedAt ? ` → ${acceptedShort(c.latestAcceptedAt)}` : ""}</b></div>
          {c.avgPrice != null && <div className="cp-row" style={{ justifyContent: "space-between" }}><span className="it-dim">Insiders&rsquo; average price</span><b className="it-num">{fmtPrice(c.avgPrice)}</b></div>}
          <FlagList flags={c.quality?.flags} />
        </div>
        {onPrice && <button className="it-btn it-btn-primary" style={{ marginTop: 12, width: "100%", height: 34 }} onClick={onPrice}><LuChartLine size={15} />Price chart &amp; insider purchases</button>}
        <button className="it-btn" style={{ marginTop: 8, width: "100%", height: 34 }} onClick={onEvidence}><LuFileSearch size={15} />Open evidence (SEC rows)</button>
        {c.ticker && <Link className="it-link" to={`/insider/company/${encodeURIComponent(c.ticker)}`} style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 12, fontSize: 12.5 }} onClick={(e) => e.stopPropagation()}>Open company page<LuChevronRight size={14} /></Link>}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- evidence drawer (real SEC rows)
const TYPE_CLASS = { open_market: "verified_om", offering_or_private: "offering", unspecified: "unknown" };
export function EvidenceDrawer({ c, params, onClose }) {
  const [tab, setTab] = useState("counted");
  const [st, setSt] = useState({ loading: true, data: null, error: null });
  const key = JSON.stringify(params || {});
  useEffect(() => {
    let live = true;
    setSt({ loading: true, data: null, error: null });
    const p = JSON.parse(key);
    api.get(`/insider/companies/${encodeURIComponent(String(c.cik || "").replace(/\D/g, ""))}/evidence`, { params: { period: p.period, from: p.from, to: p.to, basis: p.basis, ptype: p.ptype || (p.openMarket ? "verified" : undefined) } })
      .then(({ data }) => { if (live) setSt({ loading: false, data, error: null }); })
      .catch((err) => { if (live) setSt({ loading: false, data: null, error: err.response?.data?.error || "Could not load the SEC rows." }); });
    return () => { live = false; };
  }, [c.cik, key]);
  useEffect(() => {
    const k = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const d = st.data;
  const counted = useMemo(() => d?.counted || [], [d]);
  return (
    <>
      <div className="it-backdrop" onClick={onClose} />
      <aside className="it-drawer cp-drawer" role="dialog" aria-modal="true" aria-label={`Evidence for ${c.ticker || c.name}`} style={{ display: "flex", flexDirection: "column" }}>
        <div className="cp-dhead">
          <div className="cp-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
            <div className="cp-row" style={{ alignItems: "flex-start" }}>
              <CompanyLogo cik={c.cik} ticker={c.ticker} name={c.name} />
              <div>
                <div className="cp-row"><span className="cp-ticker" style={{ fontSize: 16 }}>{c.ticker || "—"}</span><ConfidenceGlyph status={c.quality?.status} /><span className="it-dim" style={{ fontSize: 12.5 }}>{CONF[c.quality?.status]?.label}</span></div>
                <div className="it-dim" style={{ fontSize: 12.5, marginTop: 2 }}>{c.name}</div>
              </div>
            </div>
            <button className="it-btn it-btn-ghost it-icon-btn" onClick={onClose} aria-label="Close evidence"><LuX size={18} /></button>
          </div>
          <p className="it-dim" style={{ fontSize: 12.5, marginTop: 10, lineHeight: 1.5 }}>
            Every number on the Companies row is computed from these SEC Form 4 rows. Filed values are never modified; excluded rows stay visible with the reason.
          </p>
          <div className="cp-row" style={{ gap: 18, marginTop: 10, fontSize: 12.5, flexWrap: "wrap" }}>
            <span><b className="it-num">{count(d?.uniqueBuyers ?? c.uniqueBuyers)}</b> <span className="it-dim">independent buyers</span></span>
            <span><b className="it-num">{count(d?.legalFilers ?? c.legalFilers)}</b> <span className="it-dim">legal filers</span></span>
            <span><b className="it-num">{compactUsd(d?.countedValue ?? c.purchaseValue)}</b> <span className="it-dim">counted value</span></span>
          </div>
        </div>
        <div className="cp-dtabs" role="tablist">
          {[["counted", `Counted (${d ? counted.length : "…"})`], ["excluded", `Excluded / merged (${d ? d.excluded.length : "…"})`], ["defs", "Definitions"]].map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>
        <div className="cp-dbody">
          {st.loading && <div className="cp-col" style={{ gap: 8 }}>{[0, 1, 2].map((i) => <div key={i} className="it-skel" style={{ height: 92, borderRadius: 10 }} />)}</div>}
          {st.error && <div className="cp-empty" style={{ padding: 32 }}><div className="cp-empty-icon" style={{ color: "var(--it-sell)" }}><LuTriangleAlert size={22} /></div><b>{st.error}</b></div>}
          {d && tab === "counted" && counted.map((r) => (
            <div key={r.id} className="cp-ev">
              <div className="cp-row" style={{ justifyContent: "space-between" }}>
                <div className="cp-row" style={{ minWidth: 0 }}><b style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.owner}</b></div>
                <span className={`cp-type ${TYPE_CLASS[r.purchaseType] || "unknown"}`}>{PURCHASE_TYPE[r.purchaseType] || PURCHASE_TYPE.unspecified}</span>
              </div>
              <div className="cp-small" style={{ marginTop: 2, whiteSpace: "normal" }}>{r.role || "—"}{r.buyer && r.buyer !== r.owner ? ` · economic buyer: ${r.buyer}` : ""}{r.is10b5_1 ? " · 10b5-1 plan" : ""}</div>
              <div className="cp-ev-grid">
                <div><span>Trade date</span>{shortDay(r.tradeDate)}</div>
                <div><span>SEC accepted</span>{acceptedShort(r.acceptedAt)}</div>
                <div><span>Shares · {r.ownership === "I" ? "Indirect" : "Direct"}</span>{count(r.shares)}</div>
                <div><span>Price · value</span>{r.price != null ? fmtPrice(r.price) : "—"} · {r.value != null ? compactUsd(r.value) : <span style={{ color: "var(--it-warn)" }}>not counted</span>}</div>
              </div>
              {r.priceCheck === "anomaly" && <div className="cp-small" style={{ marginTop: 6, color: "var(--it-warn)", whiteSpace: "normal" }}>Price anomaly: {r.priceNote.join(" ")}</div>}
              <div className="cp-row" style={{ justifyContent: "space-between", marginTop: 8 }}>
                <span className="cp-acc">Form 4 · {r.accessionNo}</span>
                {r.filingUrl && <a className="it-link cp-small" href={r.filingUrl} target="_blank" rel="noopener noreferrer"><LuExternalLink size={12} style={{ verticalAlign: -2 }} /> sec.gov</a>}
              </div>
            </div>
          ))}
          {d?.truncated && tab === "counted" && <div className="cp-small" style={{ padding: 8 }}>First 300 rows shown — open the company page for the full list.</div>}
          {d && tab === "excluded" && (d.excluded.length ? d.excluded.map((r, i) => (
            <div key={`${r.accessionNo}-${i}`} className="cp-ev cp-excl">
              <div className="cp-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}><b style={{ fontSize: 13 }}>{r.reason}</b>{r.value != null && <span className="cp-small">{compactUsd(r.value)}</span>}</div>
              <p className="it-dim" style={{ fontSize: 12.5, marginTop: 4, lineHeight: 1.5 }}>{r.detail}</p>
              <div className="cp-row" style={{ justifyContent: "space-between", marginTop: 6 }}>
                <span className="cp-small">Filer: {r.owner}</span>
                {r.filingUrl && <a className="it-link cp-small" href={r.filingUrl} target="_blank" rel="noopener noreferrer"><LuExternalLink size={12} style={{ verticalAlign: -2 }} /> {r.accessionNo}</a>}
              </div>
            </div>
          )) : <div className="cp-empty" style={{ padding: 32 }}><div className="cp-empty-icon"><LuShieldCheck size={22} /></div><b>No exclusions</b><span className="it-dim" style={{ fontSize: 12.5 }}>Every SEC row for this company in the period was counted as filed.</span></div>)}
          {tab === "defs" && (
            <div className="cp-col" style={{ gap: 12, fontSize: 12.5, lineHeight: 1.55 }}>
              <p><b>Independent buyer.</b> <span className="it-dim">One economic decision-maker. Legal filers (a person, their trust or LLC; a fund and its general partner; joint filers) are merged only with evidence from the filings.</span></p>
              <p><b>Stated open-market.</b> <span className="it-dim">The filing itself describes an open-market purchase. “Venue not stated” is a code P purchase without that statement. Offerings and private placements are never treated as open-market.</span></p>
              <p><b>Counted value.</b> <span className="it-dim">Shares × reported price of the counted rows. Price anomalies, superseded Form 4/A rows and duplicate reports are excluded from value — never deleted.</span></p>
              <p><b>Confidence.</b> <span className="it-dim">{CONF.verified.label}: {CONF.verified.detail} {CONF.warning.label}: {CONF.warning.detail} {CONF.uncertain.label}: {CONF.uncertain.detail}</span></p>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

// ---------------------------------------------------------------- mobile card
export function MobileCard({ c, onEvidence, onPrice, onOpen }) {
  const pub = etToIso(c.latestAcceptedAt);
  return (
    <div className="cp-card" role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => { if (e.key === "Enter") onOpen(); }}>
      <div className="cp-card-top">
        <div className="cp-row" style={{ minWidth: 0, alignItems: "flex-start" }}>
          <CompanyLogo cik={c.cik} ticker={c.ticker} name={c.name} small />
          <div style={{ minWidth: 0 }}>
            <div className="cp-row" style={{ gap: 7 }}><ConfidenceGlyph status={c.quality?.status} /><span className="cp-ticker">{c.ticker || "—"}</span><ClusterBadge type={c.clusterType} /></div>
            <div className="cp-co-name" style={{ marginTop: 2 }}>{c.name}</div>
          </div>
        </div>
        <ActivityStrip days={c.activity?.days} end={c.activity?.end} />
      </div>
      <div className="cp-card-mid">
        <b className="it-num" style={{ color: "var(--it-text)" }}>{count(c.uniqueBuyers)}</b> independent buyer{c.uniqueBuyers === 1 ? "" : "s"}
        <span className="cp-dot-sep" /><b className="it-num" style={{ color: "var(--it-text)" }}>{compactUsd(c.purchaseValue)}</b>
        {holdingsLabel(c.holdingsIncrease) && <><span className="cp-dot-sep" /><span>holdings <span style={{ color: "var(--cp-act)" }}>{holdingsLabel(c.holdingsIncrease)}</span></span></>}
      </div>
      <div className="cp-card-bot">
        <div className="cp-col" style={{ gap: 4 }}>
          <RoleChips roles={c.roles} />
          <span className="cp-small">{pub ? `Published ${ago(pub)}` : `Filed ${shortDay(c.latestFilingDate)}`} · {count(c.purchaseTransactions)} purchase{c.purchaseTransactions === 1 ? "" : "s"}</span>
        </div>
        <div className="cp-row" style={{ gap: 6 }}>
          {onPrice && <button className="cp-expand-btn cp-price-card-btn" aria-label={`Price chart and insider purchases for ${c.ticker || c.name}`} onClick={(e) => { e.stopPropagation(); onPrice(); }}><LuChartLine size={15} /></button>}
          <button className="cp-expand-btn" aria-label={`Evidence for ${c.ticker || c.name}`} onClick={(e) => { e.stopPropagation(); onEvidence(); }}><LuFileSearch size={15} /></button>
        </div>
      </div>
    </div>
  );
}
