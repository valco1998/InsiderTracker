// Advanced insider filters for the company page: role (multi-select; multi-role
// insiders match each role), insider name, purchase/sale, reported-value range,
// trade-date period (7/30/90 days or custom). Kept per browser tab
// (sessionStorage) so they persist while switching between companies.
import { useCallback, useEffect, useState } from "react";
import { DEFAULT_COMPANY_FILTERS, PERIODS, ROLE_OPTIONS, activeFilterCount } from "../../../utils/insiderCompanyFilters";

const STORE_KEY = "it.companyFilters.v1";

function readStored() {
  try {
    const v = JSON.parse(sessionStorage.getItem(STORE_KEY) || "null");
    return v && typeof v === "object" ? { ...DEFAULT_COMPANY_FILTERS, ...v, roles: Array.isArray(v.roles) ? v.roles.filter((r) => ROLE_OPTIONS.includes(r)) : [] } : DEFAULT_COMPANY_FILTERS;
  } catch { return DEFAULT_COMPANY_FILTERS; }
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCompanyFilters() {
  const [filters, setFilters] = useState(readStored);
  useEffect(() => { try { sessionStorage.setItem(STORE_KEY, JSON.stringify(filters)); } catch { /* storage unavailable */ } }, [filters]);
  const patch = useCallback((p) => setFilters((f) => ({ ...f, ...p })), []);
  const reset = useCallback(() => setFilters(DEFAULT_COMPANY_FILTERS), []);
  return { filters, patch, reset };
}

const chipOn = { color: "var(--it-text)", borderColor: "var(--it-accent)", background: "var(--it-accent-soft)" };

export default function CompanyFilters({ filters: f, patch, reset, shown, total }) {
  // Name typing is debounced locally so the table does not re-filter per keystroke.
  const [name, setName] = useState(f.name);
  useEffect(() => { setName(f.name); }, [f.name]);
  useEffect(() => {
    if (name === f.name) return undefined;
    const t = setTimeout(() => patch({ name }), 250);
    return () => clearTimeout(t);
  }, [name, f.name, patch]);
  const toggleRole = (r) => patch({ roles: f.roles.includes(r) ? f.roles.filter((x) => x !== r) : [...f.roles, r] });
  const n = activeFilterCount(f);

  return (
    <div className="flex flex-col gap-2 px-3 py-2.5" style={{ borderBottom: "1px solid var(--it-line-soft)" }} role="search" aria-label="Filter insider transactions">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="it-label mr-1">Role</span>
        {ROLE_OPTIONS.map((r) => (
          <button key={r} className="it-chip" aria-pressed={f.roles.includes(r)} onClick={() => toggleRole(r)} style={f.roles.includes(r) ? chipOn : undefined}>{r}</button>
        ))}
        <span className="it-label ml-3 mr-1">Type</span>
        {[["all", "All"], ["purchase", "Purchases"], ["sale", "Sales"]].map(([k, l]) => (
          <button key={k} className="it-chip" aria-pressed={f.type === k} onClick={() => patch({ type: k })} style={f.type === k ? chipOn : undefined}>{l}</button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input className="it-input w-48" placeholder="Insider name…" aria-label="Insider name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="it-input it-num w-28" inputMode="decimal" placeholder="Min value $" aria-label="Minimum reported value in dollars" value={f.minValue}
          onChange={(e) => patch({ minValue: e.target.value.replace(/[^0-9.]/g, "") })} />
        <input className="it-input it-num w-28" inputMode="decimal" placeholder="Max value $" aria-label="Maximum reported value in dollars" value={f.maxValue}
          onChange={(e) => patch({ maxValue: e.target.value.replace(/[^0-9.]/g, "") })} />
        <div className="flex flex-wrap gap-1" role="group" aria-label="Trade-date period">
          {PERIODS.map((p) => (
            <button key={p.key} className="it-chip" aria-pressed={f.period === p.key} onClick={() => patch({ period: p.key })} style={f.period === p.key ? chipOn : undefined}>{p.label}</button>
          ))}
        </div>
        {f.period === "custom" && (
          <>
            <input type="date" className="it-input" aria-label="Trade date from" value={f.from} onChange={(e) => patch({ from: e.target.value })} />
            <input type="date" className="it-input" aria-label="Trade date to" value={f.to} onChange={(e) => patch({ to: e.target.value })} />
          </>
        )}
        <span className="ml-auto text-[11.5px] it-dim2 it-num">{shown.toLocaleString("en-US")} of {total.toLocaleString("en-US")}</span>
        {n > 0 && <button className="it-chip" onClick={reset}>Clear {n} filter{n === 1 ? "" : "s"}</button>}
      </div>
    </div>
  );
}
