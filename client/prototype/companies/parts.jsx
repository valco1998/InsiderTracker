// Companies Intelligence Screener — PROTOTYPE building blocks (mock data only).
import { useEffect, useMemo, useState } from "react";
import { LuX, LuExternalLink, LuInfo, LuTriangleAlert, LuShieldCheck, LuFileSearch, LuChevronRight, LuClock } from "react-icons/lu";
import { NOW, perfOf, hasPrice } from "./mockData";
import { usd, price, pct, pts, tone, ago, shortDate, md, CONF, CLUSTER_DEF } from "./format";

// ---------------------------------------------------------------- confidence
export function ConfidenceGlyph({ status, size = 14 }) {
  const c = status === "verified" ? "var(--it-text-2)" : status === "warning" ? "var(--it-warn-fill)" : "var(--it-text-3)";
  return (
    <svg className="cp-conf" width={size} height={size} viewBox="0 0 14 14" role="img" aria-label={`Data confidence: ${CONF[status].label}`}>
      <title>{`${CONF[status].label} — ${CONF[status].detail}`}</title>
      {status === "verified" && <><circle cx="7" cy="7" r="5.5" fill={c} /><path d="M4.6 7.1l1.6 1.6 3.2-3.3" stroke="var(--it-panel)" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" /></>}
      {status === "warning" && <><circle cx="7" cy="7" r="5" fill="none" stroke={c} strokeWidth="1.5" /><path d="M7 2a5 5 0 0 1 0 10z" fill={c} /></>}
      {status === "uncertain" && <circle cx="7" cy="7" r="5" fill="none" stroke={c} strokeWidth="1.5" strokeDasharray="2 2" />}
    </svg>
  );
}

// ---------------------------------------------------------------- activity-lane marks
export function ClusterBadge({ type }) {
  if (!type) return null;
  return <span className="cp-cluster" title={`Cluster ${type}: ${CLUSTER_DEF[type]}. Factual pattern — not a recommendation.`}><b>{type}</b><span>Cluster</span></span>;
}
export function RoleChips({ roles }) {
  const order = ["CEO", "CFO", "Dir", "10%", "Officer"];
  return (
    <div className="cp-roles">
      {[...roles].sort((a, b) => order.indexOf(a) - order.indexOf(b)).map((r) => (
        <span key={r} className={`cp-role${r === "CEO" || r === "CFO" ? " exec" : ""}`} title={{ CEO: "Chief Executive Officer", CFO: "Chief Financial Officer", Dir: "Director", "10%": "10% owner", Officer: "Other officer" }[r]}>{r}</span>
      ))}
    </div>
  );
}
export function ActivityStrip({ days }) {
  const max = Math.max(1, ...days);
  return (
    <div className="cp-strip" role="img" aria-label="Insider purchase days over the last 30 days" title="Purchase days, last 30 days (oldest → newest)">
      {days.map((d, i) => d ? <i key={i} style={{ height: `${4 + (d / max) * 14}px`, opacity: 0.45 + (d / max) * 0.55 }} /> : <i key={i} className="z" />)}
    </div>
  );
}
const MOMENTUM = { accelerating: "Accelerating", steady: "Steady", slowing: "Slowing", single: "Single buyer" };
export function PatternCell({ c }) {
  return (
    <div>
      <ActivityStrip days={c.pattern.days} />
      <div className="cp-pat-label">
        <span>{MOMENTUM[c.pattern.momentum]}</span>
        {c.pattern.repeat && <span className="cp-small">· repeat</span>}
        {c.pattern.firstBuy && <span className="cp-pill" title={c.pattern.firstBuy}>1st buy</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- price-lane marks
// Every value below is read from perfOf(c, anchor) — one simulated series, one entry rule.

export function Sparkline({ c, anchor = "signal", w = 112, h = 32 }) {
  const p = perfOf(c, anchor);
  if (!hasPrice(p)) return <span className="cp-na">—</span>;
  const { pre, post, marks } = p.spark;
  const all = [...pre, ...post];
  const n = all.length, entryIdx = pre.length, pad = 2;
  const lo = Math.min(...all), hi = Math.max(...all);
  const x = (i) => pad + (i / Math.max(1, n - 1)) * (w - pad * 2);
  const y = (v) => pad + (1 - (v - lo) / (hi - lo || 1)) * (h - pad * 2 - 4);
  const path = (xs, off) => xs.map((v, i) => `${i ? "L" : "M"}${x(i + off).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const col = p.ret >= 0 ? "var(--cp-up)" : "var(--cp-down)";
  const yE = y(p.entryPrice);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Price: ${pre.length} sessions before publication in grey, ${p.sessions} since entry in colour; ${pct(p.ret)} since entry`}>
      <title>{`Grey: ${pre.length} sessions before publication · Colour: entry ${md(p.entryDate)} → close ${md(p.asOf)} (${p.sessions} session${p.sessions === 1 ? "" : "s"}) · blue ticks: later SEC filings`}</title>
      {pre.length > 1 && <path d={path(pre, 0)} fill="none" stroke="var(--it-text-3)" strokeWidth="1.2" opacity="0.55" />}
      {pre.length > 0 && <line x1={x(entryIdx - 1)} x2={x(entryIdx)} y1={y(pre[pre.length - 1])} y2={yE} stroke="var(--it-text-3)" strokeWidth="1.2" opacity="0.55" />}
      <line x1={x(entryIdx)} x2={w - pad} y1={yE} y2={yE} stroke="var(--it-line-strong)" strokeDasharray="2 3" />
      <line x1={x(entryIdx)} x2={x(entryIdx)} y1={pad} y2={h - 4} stroke="var(--cp-act)" strokeWidth="1" opacity="0.6" />
      {post.length > 1 && <path d={`${path(post, entryIdx)}L${x(n - 1)},${yE}L${x(entryIdx)},${yE}Z`} fill={col} opacity="0.1" />}
      {post.length > 1 && <path d={path(post, entryIdx)} fill="none" stroke={col} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />}
      {marks.map((m, i) => <rect key={i} x={x(entryIdx + m) - 1} y={h - 4} width="2" height="4" rx="1" fill="var(--cp-act)" />)}
      <circle cx={x(entryIdx)} cy={yE} r="2" fill="var(--it-panel)" stroke="var(--cp-act)" strokeWidth="1.2" />
      <circle cx={x(n - 1)} cy={y(post[post.length - 1])} r="2.3" fill={col} />
    </svg>
  );
}

// State labels: pending (will be priced) is visibly different from missing / unavailable data.
function naInfo(p) {
  switch (p.status) {
    case "pending": return { kind: "pending", label: `Awaiting entry · opens ${md(p.nextEntry)}`, detail: `Published after the last close. Entry = ${md(p.nextEntry)} regular open; the return starts then. Not missing data.` };
    case "no_data": return { kind: "missing", label: "No price data", detail: "The price provider has no series for this ticker (e.g. OTC or foreign listing). Nothing is estimated." };
    case "series_ended": return { kind: "missing", label: `Series ended · ${md(p.endedOn)}`, detail: "No bars after this date (delisting, ticker change or vendor gap). Never extrapolated." };
    case "uncertain_security": return { kind: "missing", label: "Security class unclear", detail: "The purchased share class does not match an available price series. No return is computed." };
    default: return null;
  }
}
export function PriceNA({ p }) {
  const n = naInfo(p);
  if (!n) return null;
  return (
    <span className={`cp-na cp-na-${n.kind}`} title={n.detail}>
      {n.kind === "pending" ? <LuClock size={12} /> : <LuInfo size={12} />}{n.label}
    </span>
  );
}
export function StaleChip({ p }) {
  if (p.status !== "stale") return null;
  return <span className="cp-stale" title={`No bar since ${md(p.asOf)} (${p.staleSessions} session${p.staleSessions === 1 ? "" : "s"} behind the latest close). Values are as of ${md(p.asOf)}.`}>Stale · {md(p.asOf)}</span>;
}
export function ReturnCell({ c, anchor }) {
  const p = perfOf(c, anchor);
  if (!hasPrice(p)) return <PriceNA p={p} />;
  return (
    <div>
      <div className="cp-row" style={{ gap: 6 }}><span className={`cp-big ${tone(p.ret)}`}>{pct(p.ret)}</span><StaleChip p={p} /></div>
      <div className="cp-small" title={`SPY over the same dates: ${pct(p.spyRet)}. Excess = stock − SPY.`}>vs SPY <span className={tone(p.excess)}>{pts(p.excess)}</span></div>
      <div className="cp-small" title={`Entry ${md(p.entryDate)} (${p.entryType}) ${price(p.entryPrice)} → close ${md(p.asOf)} ${price(p.lastClose)}`}>{price(p.entryPrice)} → {price(p.lastClose)} · {p.sessions} session{p.sessions === 1 ? "" : "s"}</div>
    </div>
  );
}

// ---------------------------------------------------------------- expanded row
function Evolution({ c }) {
  const ev = c.evolution;
  const w = 420, h = 116, padL = 26, padR = 10, padT = 14, padB = 22;
  const t0 = Math.min(...ev.map((e) => e.at), c.publication.signalAt) - 3600_000 * 12;
  const t1 = Math.max(NOW - 3600_000 * 6, ...ev.map((e) => e.at));
  const maxB = Math.max(...ev.map((e) => e.cumulative), 2);
  const x = (t) => padL + ((t - t0) / (t1 - t0)) * (w - padL - padR);
  const y = (b) => padT + (1 - b / maxB) * (h - padT - padB);
  const maxV = Math.max(...ev.map((e) => e.value));
  const steps = ev.filter((e) => !e.later);
  let d = `M${x(t0)},${y(0)}`;
  steps.forEach((e) => { d += `H${x(e.at)}V${y(e.cumulative)}`; });
  d += `H${x(t1)}`;
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Cluster evolution: cumulative independent buyers over time" style={{ display: "block", maxWidth: w }}>
      {[...Array(maxB + 1).keys()].filter((b) => b % Math.ceil(maxB / 3) === 0).map((b) => (
        <g key={b}>
          <line x1={padL} x2={w - padR} y1={y(b)} y2={y(b)} stroke="var(--it-line-soft)" />
          <text x={padL - 8} y={y(b) + 3.5} textAnchor="end" fontSize="9.5" fill="var(--it-text-3)" fontFamily="var(--it-mono)">{b}</text>
        </g>
      ))}
      <line x1={x(c.publication.signalAt)} x2={x(c.publication.signalAt)} y1={padT - 6} y2={h - padB} stroke="var(--cp-act)" strokeDasharray="3 3" />
      <text x={x(c.publication.signalAt) - 4} y={h - padB - 5} fontSize="9.5" fill="var(--cp-act)" fontWeight="600" textAnchor="end">Signal published</text>
      <path d={d} fill="none" stroke="var(--cp-act)" strokeWidth="2" />
      {ev.map((e, i) => (
        <circle key={i} cx={x(e.at)} cy={y(e.cumulative)} r={3 + (e.value / maxV) * 4} fill={e.later ? "var(--it-panel)" : "var(--cp-act)"} stroke="var(--cp-act)" strokeWidth="1.5" opacity={e.later ? 1 : 0.9}>
          <title>{`${e.who} (${e.role}) · ${usd(e.value)} · ${shortDate(e.at)}${e.later ? " · later filing" : ""}`}</title>
        </circle>
      ))}
      <text x={padL} y={h - 6} fontSize="9.5" fill="var(--it-text-3)">{shortDate(t0)}</text>
      <text x={w - padR} y={h - 6} fontSize="9.5" fill="var(--it-text-3)" textAnchor="end">{shortDate(t1)}</text>
    </svg>
  );
}

export function ExpandedRow({ c, licensed, anchor = "signal", onEvidence }) {
  const p = perfOf(c, anchor);
  return (
    <div className="cp-x">
      <section aria-label="Buyers">
        <h4><span>Independent buyers · {c.buyers.economic}</span><span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 500 }}>{c.buyers.legal} legal filer{c.buyers.legal === 1 ? "" : "s"}</span></h4>
        {c.buyersList.map((b) => (
          <div key={b.name} className="cp-buyer">
            <div className="cp-row" style={{ minWidth: 0 }}><span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.name}</span><span className={`cp-role${b.role === "CEO" || b.role === "CFO" ? " exec" : ""}`}>{b.role}</span></div>
            <div className="it-num" style={{ textAlign: "right", fontWeight: 600 }}>{usd(b.value)}</div>
            <div className="cp-small">Holdings <span style={{ color: "var(--cp-act)" }}>+{(b.ownedAfterIncrease * 100).toFixed(1)}%</span> after purchase</div>
            <div className="cp-small" style={{ textAlign: "right" }}>{b.shares.toLocaleString("en-US")} sh</div>
            {b.legal.length > 1 && <div className="cp-legal" title="Legal filers merged into this one economic buyer">{b.legal.map((l) => <span key={l.cik}>{l.name} · {l.ownership}</span>)}</div>}
          </div>
        ))}
      </section>
      <section aria-label="Cluster evolution">
        <h4><span>Cluster evolution</span><span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 500 }}>dot size = purchase value · hollow = later filing</span></h4>
        <Evolution c={c} />
        {c.note && <div className="cp-note"><LuInfo size={14} style={{ flex: "none", marginTop: 2, color: "var(--cp-act)" }} />{c.note}</div>}
      </section>
      <section aria-label="Evidence and price context">
        <h4><span>Evidence</span></h4>
        <div className="cp-col" style={{ gap: 6, fontSize: 12.5 }}>
          <div className="cp-row" style={{ justifyContent: "space-between" }}><span className="it-dim">Counted SEC rows</span><b className="it-num">{c.evidence.counted.length}</b></div>
          <div className="cp-row" style={{ justifyContent: "space-between" }}><span className="it-dim">Excluded / merged</span><b className="it-num" style={{ color: c.evidence.excluded.length ? "var(--it-warn)" : undefined }}>{c.evidence.excluded.length}</b></div>
          <div className="cp-row" style={{ justifyContent: "space-between" }}><span className="it-dim">Verified open-market</span><b className="it-num">{c.purchases.verifiedOM} of {c.purchases.count}</b></div>
          {c.quality.flags.map((f) => <div key={f.code} className="cp-row" style={{ alignItems: "flex-start", color: "var(--it-warn)", fontSize: 12 }}><LuTriangleAlert size={13} style={{ flex: "none", marginTop: 2 }} /><span><b>{f.label}.</b> <span className="it-dim">{f.detail}</span></span></div>)}
        </div>
        <button className="it-btn" style={{ marginTop: 12, width: "100%", height: 34 }} onClick={onEvidence}><LuFileSearch size={15} />Open evidence drawer</button>
        {licensed && (
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--it-line-soft)" }}>
            <div className="cp-lane-tag cp-lane-price" style={{ marginBottom: 8 }}>Price since {anchor === "latest" ? "latest" : "signal"} filing · simulated EOD</div>
            {!hasPrice(p) ? <PriceNA p={p} /> : (
              <>
                <div className="cp-ev-grid" style={{ gridTemplateColumns: "repeat(3, minmax(0,1fr))", marginTop: 0 }}>
                  <div><span>Insider avg</span>{price(c.purchases.insiderAvgPrice)}</div>
                  <div><span>Entry {md(p.entryDate)}</span>{price(p.entryPrice)}<div className="cp-small">{p.entryType}</div></div>
                  <div><span>Close {md(p.asOf)}</span>{price(p.lastClose)}<div className="cp-small">{p.status === "stale" ? `stale · ${p.staleSessions} behind` : "latest EOD"}</div></div>
                  <div><span>Return</span><b className={tone(p.ret)}>{pct(p.ret)}</b></div>
                  <div><span>SPY same dates</span><b className={tone(p.spyRet)}>{pct(p.spyRet)}</b></div>
                  <div><span>vs SPY</span><b className={tone(p.excess)}>{pts(p.excess)}</b></div>
                  {[["R1", p.r1, 1], ["R5", p.r5, 5], ["R20", p.r20, 20]].map(([k, v, n]) => (
                    <div key={k}><span>{k}</span>{v == null ? <span className="cp-small" title={`Needs ${n} sessions; ${p.sessions} so far`}>pending {p.sessions}/{n}</span> : <b className={tone(v)}>{pct(v)}</b>}</div>
                  ))}
                </div>
                <div className="cp-small" style={{ marginTop: 8, whiteSpace: "normal" }}>Peak since entry <span className="cp-hind">{pct(p.peak)} on {md(p.peakDate)} — hindsight, not an achievable return</span></div>
              </>
            )}
          </div>
        )}
        <a className="it-link" href={`/insider/company/${encodeURIComponent(c.ticker)}`} style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 12, fontSize: 12.5 }} onClick={(e) => e.stopPropagation()}>Open company page<LuChevronRight size={14} /></a>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- evidence drawer
const TYPE_LABEL = { verified_om: "Verified open-market", likely_om: "Likely open-market", offering: "Offering / private", unknown: "Venue not stated" };
export function EvidenceDrawer({ c, onClose }) {
  const [tab, setTab] = useState("counted");
  useEffect(() => {
    const k = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const totals = useMemo(() => c.evidence.counted.reduce((s, r) => s + r.value, 0), [c]);
  return (
    <>
      <div className="it-backdrop" onClick={onClose} />
      <aside className="it-drawer cp-drawer" role="dialog" aria-modal="true" aria-label={`Evidence for ${c.ticker}`}>
        <div className="cp-dhead">
          <div className="cp-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div className="cp-row"><span className="cp-ticker" style={{ fontSize: 16 }}>{c.ticker}</span><ConfidenceGlyph status={c.quality.status} /><span className="it-dim" style={{ fontSize: 12.5 }}>{CONF[c.quality.status].label}</span></div>
              <div className="it-dim" style={{ fontSize: 12.5, marginTop: 2 }}>{c.name}</div>
            </div>
            <button className="it-btn it-btn-ghost it-icon-btn" onClick={onClose} aria-label="Close evidence"><LuX size={18} /></button>
          </div>
          <p className="it-dim" style={{ fontSize: 12.5, marginTop: 10, lineHeight: 1.5 }}>
            Every number on the Companies row is computed from the SEC Form 4 rows below. Original filed values are never modified; excluded rows stay visible with the reason.
          </p>
          <div className="cp-row" style={{ gap: 18, marginTop: 10, fontSize: 12.5 }}>
            <span><b className="it-num">{c.buyers.economic}</b> <span className="it-dim">independent buyers</span></span>
            <span><b className="it-num">{c.buyers.legal}</b> <span className="it-dim">legal filers</span></span>
            <span><b className="it-num">{usd(totals)}</b> <span className="it-dim">counted value</span></span>
          </div>
        </div>
        <div className="cp-dtabs" role="tablist">
          {[["counted", `Counted (${c.evidence.counted.length})`], ["excluded", `Excluded / merged (${c.evidence.excluded.length})`], ["defs", "Definitions"]].map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>
        <div className="cp-dbody">
          {tab === "counted" && c.evidence.counted.map((r) => (
            <div key={r.accession} className="cp-ev">
              <div className="cp-row" style={{ justifyContent: "space-between" }}>
                <div className="cp-row" style={{ minWidth: 0 }}><b style={{ fontSize: 13 }}>{r.owner}</b><span className={`cp-role${r.role === "CEO" || r.role === "CFO" ? " exec" : ""}`}>{r.role}</span></div>
                <span className={`cp-type ${r.type}`}>{TYPE_LABEL[r.type]}</span>
              </div>
              {r.owner !== r.economic && <div className="cp-small" style={{ marginTop: 2 }}>Economic buyer: {r.economic}</div>}
              <div className="cp-ev-grid">
                <div><span>Trade date</span>{r.tradeDate}</div>
                <div><span>SEC accepted</span>{r.filedAt}</div>
                <div><span>Shares · {r.ownership === "D" ? "Direct" : "Indirect"}</span><span className="it-num" style={{ display: "inline", fontSize: 12, letterSpacing: 0, textTransform: "none", color: "var(--it-text)", fontWeight: 400 }}>{r.shares.toLocaleString("en-US")}</span></div>
                <div><span>Price · value</span>{price(r.price)} · {usd(r.value)}</div>
              </div>
              <div className="cp-row" style={{ justifyContent: "space-between", marginTop: 8 }}>
                <span className="cp-acc">Form 4 · {r.accession}</span>
                <span className="cp-small" title="In production this links to the filing on sec.gov"><LuExternalLink size={12} style={{ verticalAlign: -2 }} /> sec.gov (mock — no link)</span>
              </div>
            </div>
          ))}
          {tab === "excluded" && (c.evidence.excluded.length ? c.evidence.excluded.map((r, i) => (
            <div key={i} className="cp-ev cp-excl">
              <div className="cp-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}><b style={{ fontSize: 13 }}>{r.reason}</b>{r.value != null && <span className="cp-small">{usd(r.value)} not double-counted</span>}</div>
              <p className="it-dim" style={{ fontSize: 12.5, marginTop: 4, lineHeight: 1.5 }}>{r.detail}</p>
              <div className="cp-small" style={{ marginTop: 6 }}>Filer: {r.owner}</div>
            </div>
          )) : <div className="cp-empty" style={{ padding: 32 }}><div className="cp-empty-icon"><LuShieldCheck size={22} /></div><b>No exclusions</b><span className="it-dim" style={{ fontSize: 12.5 }}>Every SEC row for this company was counted as filed.</span></div>)}
          {tab === "defs" && (
            <div className="cp-col" style={{ gap: 12, fontSize: 12.5, lineHeight: 1.55 }} >
              <p><b>Independent buyer.</b> <span className="it-dim">One economic decision-maker. Legal filers (a person, their trust, their LLC; a fund and its general partner) that report the same purchase are merged — only with evidence from the filings themselves.</span></p>
              <p><b>Verified open-market.</b> <span className="it-dim">The filing text states an open-market purchase. “Likely” = weighted-average or price-range footnotes. Offerings and private placements are never counted as open-market.</span></p>
              <p><b>Signal published.</b> <span className="it-dim">The SEC acceptance time of the first filing that made this company meet your screen. Amendments never move it.</span></p>
              <p><b>Confidence.</b> <span className="it-dim">Verified = all checks passed. Warning = rows merged or excluded, totals still reliable. Uncertain = classification or security match unclear.</span></p>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

export function MobileCard({ c, licensed, anchor, onEvidence }) {
  return (
    <a className="cp-card" href={`/insider/company/${encodeURIComponent(c.ticker)}`} onClick={(e) => e.preventDefault()}>
      <div className="cp-card-top">
        <div style={{ minWidth: 0 }}>
          <div className="cp-row" style={{ gap: 7 }}><ConfidenceGlyph status={c.quality.status} /><span className="cp-ticker">{c.ticker}</span><ClusterBadge type={c.cluster} /></div>
          <div className="cp-co-name" style={{ marginTop: 2 }}>{c.name}</div>
        </div>
        {licensed && <div className="cp-card-ret"><ReturnCell c={c} anchor={anchor} /></div>}
      </div>
      <div className="cp-card-mid">
        <b className="it-num" style={{ color: "var(--it-text)" }}>{c.buyers.economic}</b> independent buyer{c.buyers.economic === 1 ? "" : "s"}
        <span className="cp-dot-sep" /><b className="it-num" style={{ color: "var(--it-text)" }}>{usd(c.purchases.verifiedValue)}</b>
        <span className="cp-dot-sep" /><span>holdings <span style={{ color: "var(--cp-act)" }}>+{(c.purchases.deltaOwnPct * 100).toFixed(0)}%</span></span>
      </div>
      <div className="cp-card-bot">
        <div className="cp-col" style={{ gap: 4 }}>
          <RoleChips roles={c.buyers.roles} />
          <span className="cp-small">{anchor === "latest" ? `Latest filing ${ago(c.publication.latestAt)}` : `Signal ${ago(c.publication.signalAt)}${c.publication.laterFilings ? ` · +${c.publication.laterFilings} later` : ""}`}{licensed && hasPrice(perfOf(c, anchor)) ? ` · close ${md(perfOf(c, anchor).asOf)}` : ""}</span>
        </div>
        <div className="cp-row">
          {licensed ? <Sparkline c={c} anchor={anchor} w={92} h={28} /> : <ActivityStrip days={c.pattern.days} />}
          <button className="cp-expand-btn" aria-label={`Evidence for ${c.ticker}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); onEvidence(); }}><LuFileSearch size={15} /></button>
        </div>
      </div>
    </a>
  );
}
