// Transaction workspace: desktop table (sticky header, sortable within the
// loaded rows) + mobile cards. Rows keep every label from the original view.
import { memo, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { FollowButton } from "../InsiderAccountPanel";
import { TypeBadge, DetailBadges, ValueCell, Reporters, FilingLinks } from "./Badges";
import { day, price, shares } from "../../../utils/insiderFormat";
import { Skeleton } from "./Common";

const COLS = [
  { key: "filed", label: "Filed", get: (t) => t.acceptedAtET || t.filingDate || "" },
  { key: "trade", label: "Trade date", get: (t) => t.transactionDate || "" },
  { key: "ticker", label: "Company", get: (t) => t.ticker || t.issuerName || "" },
  { key: "insider", label: "Insider", get: (t) => t.insiderName || "" },
  { key: "role", label: "Role", sortable: false },
  { key: "type", label: "Type", get: (t) => t.code || "" },
  { key: "shares", label: "Shares", num: true, get: (t) => t.shares },
  { key: "price", label: "Price", num: true, get: (t) => t.price },
  { key: "value", label: "Reported value", num: true, get: (t) => t.value },
  { key: "source", label: "Source", sortable: false },
];
const byKey = Object.fromEntries(COLS.map((c) => [c.key, c]));

function compare(a, b, col, dir) {
  const va = col.get(a), vb = col.get(b);
  // Missing values always sort last.
  if (va == null || va === "") return vb == null || vb === "" ? 0 : 1;
  if (vb == null || vb === "") return -1;
  const r = typeof va === "number" ? va - vb : String(va).localeCompare(String(vb));
  return dir === "asc" ? r : -r;
}

export function useSortedRows(rows) {
  const [sort, setSort] = useState({ key: "filed", dir: "desc" }); // server order
  const sorted = useMemo(() => {
    if (sort.key === "filed" && sort.dir === "desc") return rows;
    const col = byKey[sort.key];
    return rows.map((r, i) => [r, i]).sort((x, y) => compare(x[0], y[0], col, sort.dir) || x[1] - y[1]).map((x) => x[0]);
  }, [rows, sort]);
  const toggle = (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: byKey[key].num || key === "filed" || key === "trade" ? "desc" : "asc" }));
  return { sorted, sort, toggle, isDefault: sort.key === "filed" && sort.dir === "desc" };
}

const companyHref = (t) => (t.ticker ? `/insider/company/${encodeURIComponent(t.ticker)}` : null);

const Row = memo(function Row({ t, account, isNew }) {
  const superseded = t.amendment?.status === "superseded";
  const cls = `${t.code === "P" ? "it-r-buy" : "it-r-sell"}${superseded ? " it-r-muted" : ""}${isNew ? " it-row-new" : ""}`;
  const href = companyHref(t);
  return (
    <tr className={cls} data-id={t.id}>
      <td className="whitespace-nowrap it-num" style={{ color: "var(--it-text)" }} title={t.acceptedAtET ? `Accepted by SEC ${t.acceptedAtET}` : undefined}>{day(t.filingDate)}</td>
      <td className="whitespace-nowrap it-num it-dim">{day(t.transactionDate)}</td>
      <td className="max-w-[230px]">
        <div className="flex items-center gap-2">
          {href ? <Link to={href} className="it-mono font-semibold hover:underline" style={{ color: "var(--it-text)" }} title={`Open ${t.ticker} insider activity`}>{t.ticker}</Link>
            : <span className="it-mono font-semibold">—</span>}
          <FollowButton t={t} account={account} />
        </div>
        <div className="truncate text-[11.5px] it-dim2" title={t.issuerName}>{t.issuerName}</div>
      </td>
      <td className="max-w-[260px]"><Reporters t={t} /></td>
      <td className="max-w-[180px] text-[11.5px] it-dim">{t.role}</td>
      <td><TypeBadge code={t.code} formType={t.formType} /><DetailBadges t={t} /></td>
      <td className="num whitespace-nowrap it-num" style={{ color: "var(--it-text)" }}>{shares(t.shares)}</td>
      <td className="num whitespace-nowrap it-num it-dim">{t.price == null ? <span className="it-dim2" title="No price reported in the filing">n/a</span> : price(t.price)}</td>
      <td className="num whitespace-nowrap it-num font-semibold" style={{ color: "var(--it-text)" }} title={t.value != null ? `$${t.value.toLocaleString("en-US")}` : "Not computable: no price reported"}><ValueCell t={t} /></td>
      <td><FilingLinks t={t} /></td>
    </tr>
  );
});

function SortHead({ col, sort, toggle }) {
  if (col.sortable === false) return <th className={col.num ? "num" : ""} scope="col">{col.label}</th>;
  const active = sort.key === col.key;
  return (
    <th className={col.num ? "num" : ""} scope="col" aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button onClick={() => toggle(col.key)} title={`Sort by ${col.label.toLowerCase()} (loaded rows)`}>
        {col.label}<span aria-hidden="true" style={{ opacity: active ? 1 : 0.25 }}>{active && sort.dir === "asc" ? "▲" : "▼"}</span>
      </button>
    </th>
  );
}

export function DesktopTable({ rows, account, newIds, sort, toggle, maxHeight, wrapRef }) {
  return (
    <div ref={wrapRef} className="it-table-wrap hidden lg:block" style={maxHeight ? { maxHeight } : undefined}>
      <table className="it-table min-w-[1120px]">
        <thead>
          <tr>{COLS.map((c) => <SortHead key={c.key} col={c} sort={sort} toggle={toggle} />)}</tr>
        </thead>
        <tbody>
          {rows.map((t) => <Row key={t.id} t={t} account={account} isNew={newIds?.has(t.id)} />)}
        </tbody>
      </table>
    </div>
  );
}

const Card = memo(function Card({ t, account, isNew }) {
  const href = companyHref(t);
  const buy = t.code === "P";
  return (
    <li className={`p-3.5 ${isNew ? "it-row-new" : ""}`} style={{ borderBottom: "1px solid var(--it-line-soft)", boxShadow: `inset 2px 0 0 ${buy ? "var(--it-buy)" : "var(--it-sell)"}`, opacity: t.amendment?.status === "superseded" ? 0.62 : 1 }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {href ? <Link to={href} className="it-mono font-semibold" style={{ color: "var(--it-text)" }}>{t.ticker}</Link> : <span className="it-mono font-semibold">—</span>}
            <TypeBadge code={t.code} formType={t.formType} />
            <FollowButton t={t} account={account} />
          </div>
          <div className="truncate text-xs it-dim2">{t.issuerName}</div>
        </div>
        <div className="shrink-0 text-right">
          <div className="it-num font-semibold" style={{ color: "var(--it-text)" }}><ValueCell t={t} /></div>
          <div className="it-num text-[11px] it-dim2">{shares(t.shares)} sh @ {price(t.price)}</div>
        </div>
      </div>
      <DetailBadges t={t} />
      <div className="mt-2 text-[12.5px]"><Reporters t={t} /></div>
      <div className="text-[11.5px] it-dim2">{t.role}</div>
      <div className="mt-2 flex items-start justify-between gap-2 text-[11.5px] it-dim2">
        <span className="it-num">Traded {day(t.transactionDate)} · Filed {day(t.filingDate)}</span>
        <FilingLinks t={t} />
      </div>
    </li>
  );
});

export function MobileCards({ rows, account, newIds }) {
  return (
    <ul className="lg:hidden">
      {rows.map((t) => <Card key={t.id} t={t} account={account} isNew={newIds?.has(t.id)} />)}
    </ul>
  );
}

export function TableSkeleton({ rows = 8 }) {
  return (
    <div className="flex flex-col gap-0" aria-busy="true" aria-label="Loading transactions">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-3 py-3" style={{ borderBottom: "1px solid var(--it-line-soft)" }}>
          <Skeleton className="h-3 w-20" /><Skeleton className="h-3 w-16" /><Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 flex-1" /><Skeleton className="hidden h-3 w-16 sm:block" /><Skeleton className="h-3 w-20" />
        </div>
      ))}
    </div>
  );
}
