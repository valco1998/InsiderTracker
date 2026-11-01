// Insider Tracker — MVP dashboard of real SEC Form 4 open-market purchases (P)
// and sales (S). Data: GET /api/insider/transactions (parsed from SEC EDGAR).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import api from "../../lib/api";
import useInsiderAccount from "../../hooks/useInsiderAccount";
import InsiderAccountPanel, { FollowButton } from "./InsiderAccountPanel";

const REFRESH_MS = 60_000;

const TYPE_TABS = [
  { key: "all",      label: "All" },
  { key: "purchase", label: "Purchases" },
  { key: "sale",     label: "Sales" },
];

const usd = (n, digits = 2) =>
  n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits });

function compactUsd(n) {
  if (n == null) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return usd(n, 0);
}

const shares = (n) => (n == null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 4 }));

// YYYY-MM-DD from the filing — format in UTC so the calendar date never shifts.
function day(iso) {
  if (!iso) return "—";
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
}

function TypeBadge({ code, formType }) {
  const buy = code === "P";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="rounded-md px-2 py-0.5 text-xs font-semibold"
        style={{
          color: buy ? "var(--emerald)" : "var(--rose)",
          background: buy ? "rgba(74,222,128,0.12)" : "rgba(248,113,113,0.12)",
          border: `1px solid ${buy ? "rgba(74,222,128,0.25)" : "rgba(248,113,113,0.25)"}`,
        }}
      >
        {buy ? "Purchase" : "Sale"}
      </span>
      {formType === "4/A" && <span className="text-[10px] font-semibold uppercase text-amber-300/80" title="Amended filing">4/A</span>}
    </span>
  );
}

function SecLink({ url, label = "SEC filing ↗", title }) {
  if (!url) return <span className="text-white/30">—</span>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" title={title} className="whitespace-nowrap text-xs font-medium hover:underline" style={{ color: "var(--cyan)" }}>
      {label}
    </a>
  );
}

const VENUE_LABEL = {
  open_market: { text: "Open market", color: "var(--emerald)", tip: "Filing footnotes describe open-market execution" },
  offering_or_private: { text: "Offering / private", color: "var(--gold)", tip: "Filing footnotes describe an offering or private placement" },
  unspecified: { text: "Venue not stated", color: "rgba(255,255,255,0.45)", tip: "The filing does not state where the shares were bought" },
};

// Purchase venue (P only, from filing text), 10b5-1 plan, duplicate review flag.
function DetailBadges({ t }) {
  const venue = t.code === "P" ? VENUE_LABEL[t.purchaseContext] : null;
  const chip = "rounded px-1.5 py-px text-[10px] font-medium whitespace-nowrap";
  const anomaly = t.priceCheck?.status === "anomaly";
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {anomaly && (
        <span className={`${chip} font-semibold`} style={{ color: "var(--rose)", background: "rgba(248,113,113,0.10)", border: "1px solid rgba(248,113,113,0.35)" }}
          title={`${t.priceCheck.reasons.map((r) => r.detail).join("\n")}\n\nExcluded from totals and alerts until verified against the SEC filing.`}>
          {t.priceCheck.label}
        </span>
      )}
      {venue && (
        <span className={chip} style={{ color: venue.color, border: "1px solid var(--border)" }}
          title={t.purchaseContextEvidence ? `${venue.tip}: “${t.purchaseContextEvidence}”` : venue.tip}>
          {venue.text}
        </span>
      )}
      {t.is10b5_1 && <span className={`${chip} text-white/55`} style={{ border: "1px solid var(--border)" }} title="Filing indicates a Rule 10b5-1 trading plan">10b5-1 plan</span>}
      {t.dedupe?.status === "needs_review" && (
        <span className={`${chip} text-amber-300`} style={{ border: "1px solid rgba(251,191,36,0.35)" }}
          title={`Possible duplicate of another filing — kept separate. ${t.dedupe.reason || ""}`}>
          Possible duplicate · review
        </span>
      )}
    </div>
  );
}

// Anomalous values stay visible as filed, but are marked and excluded from totals.
function ValueCell({ t }) {
  if (t.priceCheck?.status !== "anomaly") return compactUsd(t.value);
  return (
    <span className="inline-flex flex-col items-end">
      <span className="text-white/45 line-through decoration-rose-400/60" title={`As reported: ${t.reported?.shares ?? t.shares} sh × $${t.reported?.pricePerShare ?? t.price}`}>{compactUsd(t.value)}</span>
      <span className="text-[10px] font-medium" style={{ color: "var(--rose)" }}>unverified · excluded</span>
    </span>
  );
}

const ownershipLabel = (r) => (r.ownership === "I" ? `Indirect${r.natureOfOwnership ? ` · ${r.natureOfOwnership}` : ""}` : r.ownership === "D" ? "Direct" : "");

// Primary reporter + every related filer that reported the same economic transaction.
function Reporters({ t }) {
  const reporters = t.reportedBy?.length ? t.reportedBy : [t];
  const [primary, ...others] = reporters;
  const names = (primary.insiderName || "—").split("; ");
  return (
    <div className="min-w-0">
      <div className="text-white/85" title={primary.insiderName}>
        {names[0]}{names.length > 1 && <span className="text-white/45"> +{names.length - 1} related filers</span>}
      </div>
      {ownershipLabel(primary) && <div className="text-[11px] text-white/40">{ownershipLabel(primary)}</div>}
      {others.length > 0 && (
        <div className="mt-1.5 rounded-md px-2 py-1 text-[11px] leading-relaxed text-white/55" style={{ background: "var(--bg-surface)" }}
          title={(t.dedupe?.evidence || []).join("\n")}>
          <span className="text-white/40">Also reported by </span>
          {others.map((r, i) => (
            <span key={r.rowId}>
              {i > 0 && "; "}
              <span className="text-white/75">{r.insiderName}</span>
              {r.ownership && <span className="text-white/40"> ({r.ownership === "I" ? "indirect" : "direct"})</span>}
            </span>
          ))}
          <span className="text-white/35"> — counted once</span>
        </div>
      )}
    </div>
  );
}

function FilingLinks({ t }) {
  const reporters = t.reportedBy?.length ? t.reportedBy : [t];
  return (
    <div className="flex flex-col gap-0.5">
      {reporters.map((r, i) => (
        <SecLink key={r.accessionNo + i} url={r.filingUrl} label={reporters.length > 1 ? `Filing ${i + 1} ↗` : "SEC filing ↗"}
          title={`${r.accessionNo}${r.insiderName ? ` — ${r.insiderName}` : ""}`} />
      ))}
    </div>
  );
}

function TotalsBar({ totals }) {
  if (!totals) return null;
  const cell = "flex flex-col gap-0.5 rounded-xl px-4 py-3";
  const style = { background: "var(--bg-panel)", border: "1px solid var(--border)" };
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
      <div className={cell} style={style}><span className="text-[11px] uppercase tracking-wide text-white/45">Transactions</span><span className="text-lg font-semibold tabular-nums text-white">{totals.count.toLocaleString()}</span></div>
      <div className={cell} style={style}><span className="text-[11px] uppercase tracking-wide text-white/45">Purchases · reported value</span><span className="text-lg font-semibold tabular-nums" style={{ color: "var(--emerald)" }}>{compactUsd(totals.purchaseValue)}</span><span className="text-[11px] text-white/40">{totals.purchases.toLocaleString()} transactions</span></div>
      <div className={cell} style={style}><span className="text-[11px] uppercase tracking-wide text-white/45">Sales · reported value</span><span className="text-lg font-semibold tabular-nums" style={{ color: "var(--rose)" }}>{compactUsd(totals.saleValue)}</span><span className="text-[11px] text-white/40">{totals.sales.toLocaleString()} transactions</span></div>
      <div className={cell} style={style} title="Confirmed duplicate reports by related filers are grouped and counted once. Uncertain matches stay separate and are flagged.">
        <span className="text-[11px] uppercase tracking-wide text-white/45">Duplicate reports</span>
        <span className="text-sm text-white/80">{totals.confirmedGroups} grouped</span>
        <span className="text-[11px] text-white/40">{totals.needsReview} flagged for review{totals.valueMissing ? ` · ${totals.valueMissing} without price` : ""}</span>
      </div>
      {totals.priceAnomalies > 0 && (
        <div className="col-span-2 rounded-lg px-3 py-2 text-xs sm:col-span-4" style={{ color: "var(--rose)", background: "rgba(248,113,113,0.07)", border: "1px solid rgba(248,113,113,0.25)" }}>
          {totals.priceAnomalies} transaction{totals.priceAnomalies === 1 ? "" : "s"} with a price anomaly ({compactUsd(totals.anomalyValueExcluded)} as reported) excluded from these totals until verified against the SEC filing.
        </div>
      )}
    </div>
  );
}

function FilterBar({ type, setType, tickerInput, setTickerInput, from, setFrom, to, setTo, openMarketOnly, setOpenMarketOnly, onClear }) {
  const inputCls = "h-9 rounded-lg px-3 text-sm text-white/90 outline-none focus:ring-1 focus:ring-cyan-400/50";
  const inputStyle = { background: "var(--bg-surface)", border: "1px solid var(--border)", colorScheme: "dark" };
  return (
    <div className="flex flex-col gap-3 rounded-xl p-3 sm:flex-row sm:flex-wrap sm:items-end" style={{ background: "var(--bg-panel)", border: "1px solid var(--border)" }}>
      <div className="flex rounded-lg p-0.5" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }} role="tablist">
        {TYPE_TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={type === t.key}
            onClick={() => setType(t.key)}
            className={`h-8 flex-1 rounded-md px-4 text-sm font-medium transition-colors sm:flex-none ${type === t.key ? "text-white" : "text-white/55 hover:text-white/85"}`}
            style={type === t.key ? { background: "var(--bg-elevated)" } : undefined}
          >
            {t.label}
          </button>
        ))}
      </div>

      <label className="flex flex-col gap-1 text-xs text-white/50">
        Ticker
        <input
          value={tickerInput}
          onChange={(e) => setTickerInput(e.target.value.toUpperCase().replace(/[^A-Z0-9.-]/g, "").slice(0, 10))}
          placeholder="e.g. AAPL"
          className={`${inputCls} w-full sm:w-32`}
          style={inputStyle}
          inputMode="text"
          autoCapitalize="characters"
        />
      </label>

      <div className="grid grid-cols-2 gap-3 sm:flex">
        <label className="flex flex-col gap-1 text-xs text-white/50">
          Filed from
          <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className={inputCls} style={inputStyle} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-white/50">
          Filed to
          <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className={inputCls} style={inputStyle} />
        </label>
      </div>

      <label className="flex h-9 cursor-pointer items-center gap-2 text-sm text-white/70" title="Purchases whose filing footnotes describe open-market execution">
        <input type="checkbox" checked={openMarketOnly} onChange={(e) => setOpenMarketOnly(e.target.checked)} className="h-4 w-4 accent-cyan-400" />
        Open-market purchases only
      </label>

      <button onClick={onClear} className="h-9 rounded-lg px-3 text-sm text-white/60 hover:text-white sm:ml-auto" style={{ border: "1px solid var(--border)" }}>
        Clear filters
      </button>
    </div>
  );
}

function StatusLine({ status, total, loading }) {
  if (!status) return null;
  const working = status.processing || status.queueLength > 0;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-white/45">
      <span className="inline-flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 rounded-full ${status.lastPollError ? "bg-rose-400" : working ? "bg-amber-300 animate-pulse" : "bg-emerald-400"}`} />
        {status.lastPollError ? "SEC feed error — retrying" : working ? `Fetching filings from SEC… (${status.queueLength} queued)` : "Up to date with SEC EDGAR"}
      </span>
      <span>{status.filingsStored.toLocaleString()} Form 4 filings scanned</span>
      <span>{total.toLocaleString()} matching P/S transactions</span>
      {(status.coverage || []).map((c) => (
        <span key={c.day} title={`Official SEC daily index ${c.day}: ${c.listed} Form 4 filings · ${c.parsed} parsed · ${c.failed} failed · ${c.pending} pending`}>
          {day(c.day)}: {c.parsed}/{c.listed}{c.failed ? ` (${c.failed} failed)` : ""}
        </span>
      ))}
      {status.lastPollAt && <span>Last SEC check {new Date(status.lastPollAt).toLocaleTimeString()}</span>}
      {loading && <span>Refreshing…</span>}
    </div>
  );
}

function DesktopTable({ rows, account }) {
  const th = "px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/45 whitespace-nowrap";
  const td = "px-3 py-3 align-top text-sm";
  return (
    <div className="hidden overflow-x-auto rounded-xl lg:block" style={{ background: "var(--bg-panel)", border: "1px solid var(--border)" }}>
      <table className="w-full min-w-[1100px] border-collapse">
        <thead style={{ background: "var(--bg-surface)" }}>
          <tr>
            <th className={th}>Filed</th>
            <th className={th}>Trade date</th>
            <th className={th}>Company</th>
            <th className={th}>Insider</th>
            <th className={th}>Role</th>
            <th className={th}>Type</th>
            <th className={`${th} text-right`}>Shares</th>
            <th className={`${th} text-right`}>Price</th>
            <th className={`${th} text-right`}>Reported value</th>
            <th className={th}>Source</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.economicId || t.id} className="transition-colors hover:bg-white/[0.03]" style={{ borderTop: "1px solid var(--border)" }}>
              <td className={`${td} whitespace-nowrap text-white/80`} title={t.acceptedAtET ? `Accepted by SEC ${t.acceptedAtET}` : undefined}>{day(t.filingDate)}</td>
              <td className={`${td} whitespace-nowrap text-white/60`}>{day(t.transactionDate)}</td>
              <td className={td}>
                <div className="flex items-center gap-2"><span className="font-semibold text-white">{t.ticker || "—"}</span><FollowButton t={t} account={account} /></div>
                <div className="max-w-[220px] truncate text-xs text-white/50" title={t.issuerName}>{t.issuerName}</div>
              </td>
              <td className={`${td} max-w-[260px]`}><Reporters t={t} /></td>
              <td className={`${td} max-w-[180px] text-xs text-white/60`}>{t.role}</td>
              <td className={td}><TypeBadge code={t.code} formType={t.formType} /><DetailBadges t={t} /></td>
              <td className={`${td} whitespace-nowrap text-right tabular-nums text-white/85`}>{shares(t.shares)}</td>
              <td className={`${td} whitespace-nowrap text-right tabular-nums text-white/70`}>{t.price == null ? <span className="text-white/35" title="No price reported in the filing">n/a</span> : usd(t.price, t.price < 1 ? 4 : 2)}</td>
              <td className={`${td} whitespace-nowrap text-right font-semibold tabular-nums text-white`} title={t.value != null ? usd(t.value) : "Not computable: no price reported"}><ValueCell t={t} /></td>
              <td className={td}><FilingLinks t={t} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MobileCards({ rows, account }) {
  return (
    <div className="flex flex-col gap-2.5 lg:hidden">
      {rows.map((t) => (
        <div key={t.economicId || t.id} className="rounded-xl p-3.5" style={{ background: "var(--bg-panel)", border: "1px solid var(--border)" }}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-white">{t.ticker || "—"}</span>
                <FollowButton t={t} account={account} />
                <TypeBadge code={t.code} formType={t.formType} />
              </div>
              <div className="truncate text-xs text-white/50">{t.issuerName}</div>
              <DetailBadges t={t} />
            </div>
            <div className="shrink-0 text-right">
              <div className="font-semibold tabular-nums text-white"><ValueCell t={t} /></div>
              <div className="text-xs tabular-nums text-white/50">{shares(t.shares)} sh @ {t.price == null ? "n/a" : usd(t.price, t.price < 1 ? 4 : 2)}</div>
            </div>
          </div>
          <div className="mt-2.5 text-sm"><Reporters t={t} /></div>
          <div className="text-xs text-white/50">{t.role}</div>
          <div className="mt-2.5 flex items-start justify-between gap-2 text-xs text-white/50">
            <span>Traded {day(t.transactionDate)} · Filed {day(t.filingDate)}</span>
            <FilingLinks t={t} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function InsiderDashboard() {
  const [type, setType] = useState("all");
  const [tickerInput, setTickerInput] = useState("");
  const [ticker, setTicker] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [openMarketOnly, setOpenMarketOnly] = useState(false);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [totals, setTotals] = useState(null);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const reqId = useRef(0);
  const account = useInsiderAccount();

  // Debounce ticker typing.
  useEffect(() => {
    const t = setTimeout(() => setTicker(tickerInput), 350);
    return () => clearTimeout(t);
  }, [tickerInput]);

  const params = useMemo(() => {
    const p = { type, limit: 500 };
    if (ticker) p.ticker = ticker;
    if (from) p.from = from;
    if (to) p.to = to;
    if (openMarketOnly) p.venue = "open_market";
    return p;
  }, [type, ticker, from, to, openMarketOnly]);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true);
    try {
      const { data } = await api.get("/insider/transactions", { params });
      if (id !== reqId.current) return; // a newer request superseded this one
      setRows(data.transactions || []);
      setTotal(data.total || 0);
      setTotals(data.totals || null);
      setStatus(data.status || null);
      setError(null);
    } catch (err) {
      if (id !== reqId.current) return;
      setError(err.response?.data?.error || "Could not reach the Insider Tracker API.");
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [params]);

  useEffect(() => {
    load();
    // Poll faster while the server is still downloading the initial batch.
    const interval = status && (status.processing || status.queueLength > 0) ? 8_000 : REFRESH_MS;
    const timer = setInterval(load, interval);
    return () => clearInterval(timer);
  }, [load, status?.processing, status?.queueLength > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const clear = () => { setType("all"); setTickerInput(""); setTicker(""); setFrom(""); setTo(""); setOpenMarketOnly(false); };
  const firstLoad = loading && !status && !error;

  return (
    <div className="min-h-screen" style={{ background: "var(--bg-app)" }}>
      <div className="mx-auto flex max-w-[1400px] flex-col gap-4 px-4 py-6 sm:px-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Insider <span style={{ color: "var(--cyan)" }}>Tracker</span>
          </h1>
          <p className="text-sm text-white/55">
            Insider purchases and sales reported on SEC Form 4, parsed directly from SEC EDGAR.
          </p>
        </header>

        <div className="rounded-lg px-3 py-2 text-xs leading-relaxed text-amber-200/85" style={{ background: "rgba(251,191,36,0.07)", border: "1px solid rgba(251,191,36,0.2)" }}>
          These are <strong>reported</strong> trades, not real-time trades. Insiders file Form 4 up to two business days after the
          <strong> trade date</strong>; the <strong>filed</strong> date is when the SEC received the report. Reported value = shares × reported
          price per share. Data is informational only and is not investment advice. Always verify against the official SEC filing.
        </div>

        <FilterBar {...{ type, setType, tickerInput, setTickerInput, from, setFrom, to, setTo, openMarketOnly, setOpenMarketOnly }} onClear={clear} />
        <StatusLine status={status} total={total} loading={loading && !!status} />
        <TotalsBar totals={totals} />
        <InsiderAccountPanel account={account} />

        {error && (
          <div className="rounded-lg px-3 py-2 text-sm text-rose-300" style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.25)" }}>
            {error}
          </div>
        )}

        {firstLoad && <div className="py-16 text-center text-sm text-white/45">Loading SEC filings…</div>}

        {!firstLoad && !error && rows.length === 0 && (
          <div className="rounded-xl py-14 text-center" style={{ background: "var(--bg-panel)", border: "1px solid var(--border)" }}>
            <div className="text-sm text-white/70">No matching open-market purchases or sales yet.</div>
            <div className="mt-1 text-xs text-white/40">
              {status && (status.processing || status.queueLength > 0)
                ? "Filings are still being downloaded from SEC EDGAR — results appear automatically."
                : "Try clearing filters. Most Form 4 filings report grants, option exercises or tax withholding, which are not shown."}
            </div>
          </div>
        )}

        {rows.length > 0 && (
          <>
            <DesktopTable rows={rows} account={account} />
            <MobileCards rows={rows} account={account} />
            {total > rows.length && <div className="text-center text-xs text-white/40">Showing the {rows.length} most recent of {total.toLocaleString()} transactions.</div>}
          </>
        )}

        <footer className="pt-2 text-[11px] text-white/35">
          Source: U.S. Securities and Exchange Commission, EDGAR. Only non-derivative transaction codes P (open-market or private purchase) and S (open-market or private sale) are shown.
        </footer>
      </div>
    </div>
  );
}
