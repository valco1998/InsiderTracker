// "Insider buyers" for one company — unique PEOPLE (by SEC reporting-owner CIK;
// joint filers counted once) who reported Form 4 code P purchases with a TRADE
// date in the selected window, computed server-side from the published snapshot
// (GET /api/insider/company/:ticker/insights). Superseded rows are excluded and
// confirmed duplicate reports count once. Totals are labelled "Partial data"
// whenever SEC coverage of the window is incomplete.
import { memo } from "react";
import { compactUsd, count, day, shares } from "../../../utils/insiderFormat";
import { Skeleton } from "../components/Common";

const WINDOWS = [7, 30, 90];
const ROLES = ["CEO", "CFO", "Director", "Officer", "10% Owner", "Other"];

function Stat({ label, value, sub, color, title }) {
  return (
    <div className="it-kpi" title={title}>
      <div className="it-label">{label}</div>
      <div className="it-num mt-1 text-[18px] font-semibold" style={{ color: color || "var(--it-text)" }}>{value}</div>
      {sub && <div className="text-[11px] it-dim2">{sub}</div>}
    </div>
  );
}

function CoverageBadge({ coverage, window: w }) {
  if (!coverage) return null;
  if (coverage.complete) {
    return <span className="it-chip" title={coverage.note} style={{ color: "var(--it-buy)" }}>Complete · {day(w.from)} – {day(w.to)}</span>;
  }
  return (
    <span className="it-chip" title={coverage.note} style={{ color: "var(--it-warn)", borderColor: "var(--it-warn-line)", background: "var(--it-warn-soft)" }}>
      Partial data · SEC filings loaded {coverage.coveredFrom ? `from ${day(coverage.coveredFrom)}` : "—"}
    </span>
  );
}

function RoleTable({ byRole }) {
  return (
    <div className="overflow-x-auto">
      <table className="it-table min-w-[420px]">
        <thead><tr><th scope="col">Role</th><th scope="col" className="num">Buyers</th><th scope="col" className="num">Purchases</th><th scope="col" className="num">Reported value</th></tr></thead>
        <tbody>
          {ROLES.map((g) => {
            const v = byRole[g];
            return (
              <tr key={g} style={v.buyers ? undefined : { opacity: 0.45 }}>
                <td style={{ color: "var(--it-text)" }}>{g}</td>
                <td className="num it-num">{count(v.buyers)}</td>
                <td className="num it-num">{count(v.transactions)}</td>
                <td className="num it-num it-buy">{v.value ? compactUsd(v.value) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function BuyerList({ buyers }) {
  if (!buyers.length) return <div className="px-4 py-6 text-center text-[12px] it-dim2">No reported purchases (code P) with a trade date in this window.</div>;
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="it-table min-w-[760px]">
          <thead><tr>
            <th scope="col">Buyer</th><th scope="col">Role</th><th scope="col" className="num">Purchases</th><th scope="col" className="num">Shares</th>
            <th scope="col" className="num">Reported value</th><th scope="col">Trade dates</th><th scope="col">SEC filings</th>
          </tr></thead>
          <tbody>
            {buyers.map((b) => (
              <tr key={b.id}>
                <td style={{ color: "var(--it-text)" }} title={b.ciks.length ? `SEC CIK ${b.ciks.join(", ")}` : undefined}>{b.name}<GroupNote b={b} /></td>
                <td className="text-[11.5px] it-dim">{b.roles.join(" · ")}</td>
                <td className="num it-num">{count(b.transactions)}</td>
                <td className="num it-num">{shares(b.shares)}</td>
                <td className="num it-num it-buy">{b.value ? compactUsd(b.value) : "—"}{b.valueMissing ? <span className="it-dim2" title="Purchases without a usable reported price"> +{b.valueMissing} n/a</span> : null}</td>
                <td className="it-num whitespace-nowrap it-dim">{b.firstDate === b.lastDate ? day(b.firstDate) : `${day(b.firstDate)} – ${day(b.lastDate)}`}</td>
                <td className="whitespace-nowrap">
                  {b.filings.slice(0, 3).map((f, i) => f.url && <a key={f.accessionNo} className="it-link text-xs" href={f.url} target="_blank" rel="noopener noreferrer">{i ? " · " : ""}{day(f.filingDate)} ↗</a>)}
                  {b.filings.length > 3 && <span className="text-xs it-dim2"> +{b.filings.length - 3}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="md:hidden">
        {buyers.map((b) => (
          <li key={b.id} className="px-3.5 py-3" style={{ borderBottom: "1px solid var(--it-line-soft)" }}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-[13px]" style={{ color: "var(--it-text)" }}>{b.name}</div>
                <GroupNote b={b} />
                <div className="text-[11.5px] it-dim2">{b.roles.join(" · ")}</div>
              </div>
              <div className="shrink-0 text-right">
                <div className="it-num font-semibold it-buy">{b.value ? compactUsd(b.value) : "—"}</div>
                <div className="it-num text-[11px] it-dim2">{count(b.transactions)} purchase{b.transactions === 1 ? "" : "s"} · {shares(b.shares)} sh</div>
              </div>
            </div>
            <div className="mt-1 flex justify-between gap-2 text-[11.5px] it-dim2">
              <span className="it-num">{b.firstDate === b.lastDate ? day(b.firstDate) : `${day(b.firstDate)} – ${day(b.lastDate)}`}</span>
              {b.filings[0]?.url && <a className="it-link" href={b.filings[0].url} target="_blank" rel="noopener noreferrer">SEC filing ↗</a>}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

// One buyer can be several SEC reporting owners: joint filers, or related filers (e.g. funds
// of one investment firm) reporting the same purchase. Make that explicit — two CIKs do not
// automatically mean two independent buyers.
function GroupNote({ b }) {
  const names = b.reportingOwners || [];
  if (names.length < 2) return null;
  return (
    <span className="block text-[11px] it-dim2" title={`Counted as ONE buyer — joint / related filers:\n${names.join("\n")}`}>
      Joint filing group · {names.length} reporting owners · counted as 1 buyer
    </span>
  );
}

function InsiderBuyersPanel({ insights, loading, error, days, onDays }) {
  const a = insights?.activity;
  const w = insights?.window;
  const partial = insights && !insights.coverage?.complete;
  return (
    <section className="it-panel flex min-w-0 flex-col" aria-label="Insider buyers">
      <header className="it-panel-head flex-wrap gap-2">
        <div className="min-w-0">
          <h2 className="it-panel-title">Insider buyers · last {days} days</h2>
          <div className="text-[11px] it-dim2">By trade date{w ? ` ${day(w.from)} – ${day(w.to)}` : ""} · unique buyers by SEC CIK (joint &amp; related filers = 1) · Form 4 code P</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {insights && <CoverageBadge coverage={insights.coverage} window={w} />}
          <div className="flex gap-1" role="group" aria-label="Window">
            {WINDOWS.map((d) => (
              <button key={d} className="it-chip" aria-pressed={d === days} onClick={() => onDays(d)}
                style={d === days ? { color: "var(--it-text)", borderColor: "var(--it-accent)", background: "var(--it-accent-soft)" } : undefined}>{d}D</button>
            ))}
          </div>
        </div>
      </header>

      {error && <div className="px-4 py-3 text-[12.5px]" style={{ color: "var(--it-sell)" }}>{error}</div>}
      {loading && !a ? (
        <div className="grid grid-cols-2 gap-3 p-4 lg:grid-cols-6">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-10" />)}</div>
      ) : a && (
        <>
          {partial && (
            <div className="px-4 pt-3 text-[11.5px] leading-relaxed" style={{ color: "var(--it-warn)" }}>
              {insights.coverage.note} Totals below cover only the loaded days and are not complete {days}-day statistics.
            </div>
          )}
          <div className="it-kpis grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Unique buyers" value={count(a.uniqueBuyers)} sub={partial ? "partial window" : "distinct insiders"} color="var(--it-buy)"
              title="Distinct buyers (SEC reporting-owner CIK) with a code-P purchase in the window. Joint filers count once — including related filers that report the same purchase in separate Form 4s." />
            <Stat label="Purchases" value={count(a.purchaseTransactions)} sub="transactions" />
            <Stat label="Reported purchase value" value={compactUsd(a.purchaseValue)} sub={a.purchaseValueMissing ? `${a.purchaseValueMissing} without price` : "shares × reported price"} color="var(--it-buy)" />
            <Stat label="Unique sellers" value={count(a.uniqueSellers)} sub={`${count(a.saleTransactions)} sale transactions`} color="var(--it-sell)" />
            <Stat label="First purchase" value={a.firstPurchase ? day(a.firstPurchase) : "—"} sub="trade date" />
            <Stat label="Latest purchase" value={a.lastPurchase ? day(a.lastPurchase) : "—"} sub="trade date" />
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-[440px_minmax(0,1fr)]">
            <div className="min-w-0 xl:border-r" style={{ borderColor: "var(--it-line-soft)" }}>
              <div className="px-4 pt-3 it-label">Purchases by role</div>
              <RoleTable byRole={a.byRole} />
              <div className="px-4 py-2 text-[11px] it-dim2">A person with several roles (e.g. CEO and Director) is counted in each.</div>
            </div>
            <div className="min-w-0">
              <div className="px-4 pt-3 it-label">Buyers</div>
              <BuyerList buyers={a.buyers} />
            </div>
          </div>
          <div className="px-4 py-2 text-[11px] it-dim2" style={{ borderTop: "1px solid var(--it-line-soft)" }}>
            {insights.definitions.purchase} Superseded Form 4/A rows are excluded; confirmed duplicate reports by related filers count once.
          </div>
        </>
      )}
    </section>
  );
}

export default memo(InsiderBuyersPanel);
