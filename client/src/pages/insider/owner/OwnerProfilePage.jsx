// Reporting-owner profile (GET /insider/backtest/owner/:cik): identity, role at each company
// over time, reported purchases / sales / holdings, and the track record of FOLLOWING the
// owner's monthly signals (not the owner's own profit). Every number comes from the server.
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import api from "../../../lib/api";
import { EmptyState, ErrorNote, PageHeader, Panel, Skeleton } from "../components/Common";
import { TypeBadge } from "../components/Badges";
import { compactUsd, count, day, price, shares } from "../../../utils/insiderFormat";
import { pct, studyNaText, monthLabel, PURCHASE_TYPE_SHORT } from "../../../utils/insiderBacktest";

const tone = (v) => (v == null || Math.abs(v) < 0.0005 ? undefined : v > 0 ? "var(--it-buy)" : "var(--it-sell)");
const Pct = ({ v }) => <span className="it-num" style={{ color: tone(v) }}>{v == null ? "N/A" : pct(v, 2)}</span>;
const share = (v) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const KIND = { person: "Person", entity: "Entity / fund", trust: "Trust" };

function Kpi({ label, value, sub }) {
  return <div className="it-kpi"><div className="it-label">{label}</div><div className="it-num mt-1 text-[18px] font-semibold" style={{ color: "var(--it-text)" }}>{value}</div>{sub && <div className="text-[11px] it-dim2">{sub}</div>}</div>;
}

function TrackRecord({ t, rule, restricted }) {
  if (!t) return null;
  return (
    <Panel title="Track record of following this owner's monthly signals" subtitle={`Entry after SEC publication · ${rule?.label || ""} · gross · not the owner's own profit`}>
      <div className="it-kpis grid grid-cols-2 md:grid-cols-5">
        <Kpi label="Signals" value={count(t.signals)} sub={`${count(t.matured)} with a complete 5-day window`} />
        <Kpi label="Companies" value={count(t.issuers)} />
        <Kpi label="Period" value={t.from ? `${t.from.slice(0, 10)}` : "—"} sub={t.to ? `to ${t.to.slice(0, 10)}` : null} />
        <Kpi label="Known at signals" value={compactUsd(t.valueUsdAtSignals)} />
        <Kpi label="Ranking" value={t.rankEligible ? "Sample sufficient" : "Insufficient"} sub={t.sampleNote || "Still a small sample — read the interval"} />
      </div>
      {restricted ? <div className="px-5 py-4 text-[13px] it-dim">{restricted}</div> : (
        <div className="overflow-x-auto">
          <table className="it-table min-w-[720px]">
            <thead><tr><th>Measure</th><th className="text-right">n</th><th className="text-right">Mean</th><th className="text-right">Median</th><th className="text-right">Reached</th><th className="text-right">Days to target</th><th className="text-right">95% CI</th></tr></thead>
            <tbody>
              {[1, 2, 3, 5].map((k) => { const s = t.closes?.[k] || {}; return <tr key={k}><td>Close of day {k}</td><td className="text-right it-num">{count(s.n || 0)}</td><td className="text-right"><Pct v={s.mean} /></td><td className="text-right"><Pct v={s.median} /></td><td className="text-right">—</td><td className="text-right">—</td><td className="text-right it-num">{s.ci95 ? `${pct(s.ci95[0])} … ${pct(s.ci95[1])}` : "—"}</td></tr>; })}
              {[["TP 4% within 5 days", t.tp4], ["TP 6.5% within 5 days", t.tp65]].map(([l, s]) => <tr key={l}><td>{l}</td><td className="text-right it-num">{count(s?.n || 0)}</td><td className="text-right"><Pct v={s?.mean} /></td><td className="text-right"><Pct v={s?.median} /></td><td className="text-right it-num">{share(s?.hitRate)}</td><td className="text-right it-num">{s?.meanDaysToTarget == null ? "—" : s.meanDaysToTarget.toFixed(1)}</td><td className="text-right it-num">{s?.ci95 ? `${pct(s.ci95[0])} … ${pct(s.ci95[1])}` : "—"}</td></tr>)}
            </tbody>
          </table>
        </div>
      )}
      {t.signalsList?.length > 0 && (
        <div className="overflow-x-auto border-t" style={{ borderColor: "var(--it-line-soft)" }}>
          <table className="it-table min-w-[820px]">
            <thead><tr><th>Month</th><th>Stock</th><th>Published (ET)</th><th className="text-right">Known at signal</th><th>Type</th><th>Entry</th><th className="text-right">Day 1</th><th className="text-right">Day 5</th><th className="text-right">TP 4%</th><th className="text-right">TP 6.5%</th></tr></thead>
            <tbody>
              {t.signalsList.map((s) => (
                <tr key={s.id}>
                  <td>{monthLabel(s.month)}</td>
                  <td>{s.ticker ? <Link className="it-link" to={`/insider/company/${encodeURIComponent(s.ticker)}`}>{s.ticker}</Link> : <span className="it-dim2">{s.issuerName}</span>}</td>
                  <td className="it-num text-[12.5px]">{s.publishedAt.slice(0, 16)}</td>
                  <td className="text-right it-num">{compactUsd(s.valueUsdAtSignal)}</td>
                  <td className="text-[12px]">{(s.purchaseTypes || []).map((x) => PURCHASE_TYPE_SHORT[x]).join(", ")}</td>
                  <td className="it-num text-[12.5px]">{s.entryDate ? day(s.entryDate) : "—"}</td>
                  {s.status === "na" ? <td colSpan={4}><span className="bt-status is-waiting">N/A · {studyNaText(s.naReason)}</span></td> : <>
                    <td className="text-right">{s.closes ? <Pct v={s.closes[1]} /> : "—"}</td>
                    <td className="text-right">{s.closes?.[5] == null ? <span className="bt-status">window open</span> : <Pct v={s.closes[5]} />}</td>
                    <td className="text-right">{s.tp4 ? <Pct v={s.tp4.ret} /> : <span className="bt-status">—</span>}</td>
                    <td className="text-right">{s.tp65 ? <Pct v={s.tp65.ret} /> : <span className="bt-status">—</span>}</td>
                  </>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

export default function OwnerProfilePage() {
  const { cik = "" } = useParams();
  const [state, setState] = useState({ data: null, loading: true, error: null });
  useEffect(() => {
    let alive = true;
    setState({ data: null, loading: true, error: null });
    api.get(`/insider/backtest/owner/${encodeURIComponent(cik)}`, { timeout: 0 })
      .then(({ data }) => alive && setState({ data, loading: false, error: null }))
      .catch((err) => alive && setState({ data: null, loading: false, error: err.response?.status === 404 ? "No stored SEC filings for this reporting owner." : err.response?.data?.error || "Could not load the profile." }));
    return () => { alive = false; };
  }, [cik]);
  const p = state.data;
  if (state.loading) return <div className="flex flex-col gap-4"><Skeleton className="h-16" /><Skeleton className="h-40" /><Skeleton className="h-64" /><span className="text-[12px] it-dim2">The first profile load computes every held month and can take a few minutes.</span></div>;
  if (state.error) return <div className="flex flex-col gap-4"><Link className="it-link" to="/insider/backtesting">← Backtesting</Link><ErrorNote>{state.error}</ErrorNote></div>;
  if (!p) return null;
  return (
    <div className="flex flex-col gap-5">
      <Link className="it-link text-[13px]" to="/insider/backtesting">← Backtesting</Link>
      <PageHeader title={p.names[0] || `CIK ${p.cik}`}
        description={`SEC reporting owner · CIK ${p.cik}${p.names.length > 1 ? ` · also reported as ${p.names.slice(1).join(", ")}` : ""}`}
        badge={<span className="it-badge it-badge-neutral" title={p.kindNote}>{KIND[p.kind] || p.kind}</span>}
        right={<a className="it-btn" href={p.links.secFilings} target="_blank" rel="noreferrer">SEC filings</a>} />
      {p.group?.owners?.length > 1 && (
        <Panel title="Economic group" subtitle={p.group.note}>
          <div className="flex flex-wrap gap-1.5 px-5 py-4">{p.group.owners.map((o) => <Link key={o.cik || o.name} className="it-chip" to={o.cik ? `/insider/owner/${Number(o.cik)}` : "#"}>{o.name}</Link>)}</div>
        </Panel>
      )}
      <TrackRecord t={p.trackRecord} rule={p.rule} restricted={p.restrictedNote} />
      {p.groupTrackRecord && <p className="text-[12.5px] it-dim2">Whole economic group: {count(p.groupTrackRecord.signals)} signals, {count(p.groupTrackRecord.matured)} matured{p.groupTrackRecord.strategy ? <> · {p.rule?.label} mean <Pct v={p.groupTrackRecord.strategy.mean} /></> : null}.</p>}
      <Panel title="Companies" subtitle={p.coverage}>
        {p.issuers.length ? (
          <div className="overflow-x-auto">
            <table className="it-table min-w-[900px]">
              <thead><tr><th>Company</th><th>Role over time</th><th className="text-right">Purchases</th><th className="text-right">Sales</th><th>Last reported holding</th><th>Ownership</th><th>Active</th></tr></thead>
              <tbody>
                {p.issuers.map((i) => (
                  <tr key={i.issuerCik}>
                    <td>{i.ticker ? <Link className="it-link" to={`/insider/company/${encodeURIComponent(i.ticker)}`}>{i.ticker}</Link> : "—"}<div className="text-[11px] it-dim2">{i.issuerName}</div></td>
                    <td className="text-[12px]">{i.roles.map((r, k) => <div key={k}>{r.role} <span className="it-dim2">{r.from}{r.to !== r.from ? ` – ${r.to}` : ""}</span></div>)}</td>
                    <td className="text-right it-num">{count(i.purchases.count)}<div className="text-[11px] it-dim2">{compactUsd(i.purchases.valueReported)}</div></td>
                    <td className="text-right it-num">{count(i.sales.count)}<div className="text-[11px] it-dim2">{compactUsd(i.sales.valueReported)}</div></td>
                    <td className="it-num text-[12.5px]">{i.lastHolding ? <>{shares(i.lastHolding.sharesOwnedAfter)} <span className="it-dim2">({day(i.lastHolding.asOf)})</span></> : "—"}</td>
                    <td className="text-[12px]">{i.ownershipForms.map((x) => (x === "I" ? "Indirect" : "Direct")).join(", ")}{i.lastHolding?.natureOfOwnership && <div className="text-[11px] it-dim2">{i.lastHolding.natureOfOwnership}</div>}</td>
                    <td className="it-num text-[12px]">{day(i.firstDate)} – {day(i.lastDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState title="No stored purchases or sales" />}
      </Panel>
      <Panel title="Reported purchases and sales" subtitle={`${count(p.transactionsTotal)} stored rows${p.transactionsTotal > p.transactions.length ? ` · latest ${count(p.transactions.length)} shown` : ""} · trade date and publication time are separate`}>
        <div className="overflow-x-auto">
          <table className="it-table min-w-[960px]">
            <thead><tr><th>Trade date</th><th>Published (ET)</th><th>Code</th><th>Company</th><th className="text-right">Shares</th><th className="text-right">Price</th><th className="text-right">Value</th><th>Ownership</th><th>Filed with</th><th>Filing</th></tr></thead>
            <tbody>
              {p.transactions.map((t) => (
                <tr key={`${t.accessionNo}-${t.transactionDate}-${t.shares}-${t.code}`}>
                  <td className="it-num text-[12.5px]">{day(t.transactionDate)}</td>
                  <td className="it-num text-[12.5px]">{t.publishedAt ? String(t.publishedAt).slice(0, 16) : "—"}</td>
                  <td><TypeBadge code={t.code} formType={t.formType} /></td>
                  <td>{t.ticker || "—"}<div className="text-[11px] it-dim2">{t.securityTitle}</div></td>
                  <td className="text-right it-num">{shares(t.shares)}</td>
                  <td className="text-right it-num">{t.price == null ? "n/a" : price(t.price)}</td>
                  <td className="text-right it-num">{t.value == null ? "—" : compactUsd(t.value)}{t.priceCheck === "anomaly" && <div className="text-[11px]" style={{ color: "var(--it-warn)" }}>price check</div>}</td>
                  <td className="text-[12px]">{t.ownership === "I" ? `Indirect${t.natureOfOwnership ? ` · ${t.natureOfOwnership}` : ""}` : "Direct"}</td>
                  <td className="text-[11.5px] it-dim2">{t.coReporters.slice(0, 3).join(", ")}{t.coReporters.length > 3 ? ` +${t.coReporters.length - 3}` : ""}</td>
                  <td>{t.url ? <a className="it-link text-[12px]" href={t.url} target="_blank" rel="noreferrer">SEC</a> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
