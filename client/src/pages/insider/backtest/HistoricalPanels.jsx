// Historical evaluation panels for a backtest run (display only — every number comes
// from the server): fixed-horizon performance and SEC Form 4 coverage by month.
import { useEffect, useState } from "react";
import api from "../../../lib/api";
import { Panel } from "../components/Common";
import InfoTip from "./InfoTip";
import { count } from "../../../utils/insiderFormat";
import { pct, plainPct, FIXED_HORIZONS, horizonSummary, signalsByMonth, publicationSummary, HORIZON_STATUS_TEXT } from "../../../utils/insiderBacktest";

const tone = (v) => (v == null || Math.abs(v) < 0.0005 ? undefined : v > 0 ? "var(--it-buy)" : "var(--it-sell)");
const MONTH = (k) => new Date(`${k}-01T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", year: "numeric" });

export function HorizonPanel({ rows }) {
  const since = publicationSummary(rows);
  const reg = publicationSummary(rows, "regular");
  const hs = FIXED_HORIZONS.map((n) => horizonSummary(rows, n));
  return (
    <Panel title="Historical performance" subtitle="What following every qualifying signal would have returned — theoretical, before costs">
      <div className="grid grid-cols-1 gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <section className="bt-detail-card">
          <h4 className="it-label mb-1.5">1 · Since signal → latest price</h4>
          <div className="grid grid-cols-2 gap-3 text-[12.5px]" style={{ color: "var(--it-text-2)" }}>
            <div><div className="it-dim2 text-[11px]">Average</div><div className="it-num text-[18px] font-semibold" style={{ color: tone(since.average) ?? "var(--it-text)" }}>{pct(since.average, 2)}</div></div>
            <div><div className="it-dim2 text-[11px]">Median</div><div className="it-num text-[18px] font-semibold" style={{ color: tone(since.median) ?? "var(--it-text)" }}>{pct(since.median, 2)}</div></div>
            <div><div className="it-dim2 text-[11px]">Profitable</div><div className="it-num text-[15px]" style={{ color: "var(--it-text)" }}>{since.positiveShare == null ? "—" : plainPct(since.positiveShare)}</div></div>
            <div><div className="it-dim2 text-[11px]">Regular market avg.</div><div className="it-num text-[15px]" style={{ color: tone(reg.average) ?? "var(--it-text)" }}>{pct(reg.average, 2)}</div></div>
          </div>
          <p className="mt-2 text-[11.5px] leading-relaxed it-dim2">n = {count(since.withData)} of {count(since.total)} signals. Signals of different ages are mixed here — each is measured to today&apos;s latest price, so older signals have had longer to move.</p>
        </section>
        <section className="bt-detail-card">
          <h4 className="it-label mb-1.5">2 · Fixed horizons (entry → close N trading days later)
            <InfoTip label="Fixed-horizon returns">Entry: the first eligible trade after the SEC publication (same as Return Since Signal). Exit: the official closing price of the N-th NYSE trading session after the entry date (Alpaca SIP daily bars, split-adjusted). Only signals whose exit session has already closed are included — younger signals are excluded, never counted as 0 %. Dividends are not included.</InfoTip>
          </h4>
          <div className="it-scroll-x">
            <table className="w-full min-w-[460px] text-[12.5px]">
              <thead><tr className="it-dim2 text-left text-[11px]">
                <th className="py-1 pr-3 font-medium">Horizon</th><th className="py-1 pr-3 text-right font-medium">Average</th><th className="py-1 pr-3 text-right font-medium">Median</th>
                <th className="py-1 pr-3 text-right font-medium">Win rate</th><th className="py-1 pr-3 text-right font-medium">Signals (n)</th><th className="py-1 text-right font-medium">Not yet / missing</th>
              </tr></thead>
              <tbody>
                {hs.map((h) => (
                  <tr key={h.horizon} style={{ borderTop: "1px solid var(--it-line-soft)" }}>
                    <td className="py-1.5 pr-3" style={{ color: "var(--it-text)" }}>{h.horizon} day{h.horizon === 1 ? "" : "s"}</td>
                    <td className="it-num py-1.5 pr-3 text-right" style={{ color: tone(h.average) ?? "var(--it-text-3)" }}>{pct(h.average, 2)}</td>
                    <td className="it-num py-1.5 pr-3 text-right" style={{ color: tone(h.median) ?? "var(--it-text-3)" }}>{pct(h.median, 2)}</td>
                    <td className="it-num py-1.5 pr-3 text-right" style={{ color: "var(--it-text)" }}>{h.winRate == null ? "—" : plainPct(h.winRate)}</td>
                    <td className="it-num py-1.5 pr-3 text-right" style={{ color: "var(--it-text)" }}>{count(h.n)}</td>
                    <td className="it-num py-1.5 text-right it-dim2" title={`${h.immature}: ${HORIZON_STATUS_TEXT.immature}\n${h.noBar}: ${HORIZON_STATUS_TEXT.no_bar}\n${h.unavailable}: no entry or prices unavailable`}>{h.immature} / {h.noBar + h.unavailable}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11.5px] leading-relaxed it-dim2">
            <strong className="font-medium" style={{ color: "var(--it-text-2)" }}>Theoretical vs executable:</strong> the entry is the first eligible recorded trade — sometimes a thin pre-market or after-hours print a real order might not have matched. The Regular Market Return (first regular-session trade) is the more realistically executable entry. No commissions, spreads, slippage, taxes or dividends.
          </p>
        </section>
      </div>
    </Panel>
  );
}

function useCoverage(from, to) {
  const [s, setS] = useState({ key: null, data: null, error: null });
  const key = `${from}|${to}`;
  useEffect(() => {
    if (!from || !to) return undefined;
    let alive = true;
    api.get("/insider/backtest/coverage", { params: { from, to } })
      .then(({ data }) => { if (alive) setS({ key, data, error: null }); })
      .catch((err) => { if (alive) setS({ key, data: null, error: err.response?.data?.error || "Could not load coverage." }); });
    return () => { alive = false; };
  }, [from, to, key]);
  return s.key === key ? s : { key, data: null, error: null };
}

export function CoveragePanel({ result, rows }) {
  const { data, error } = useCoverage(result.config.from, result.config.to);
  const byMonth = signalsByMonth(result.signals, rows);
  const months = data?.months || [];
  const tot = months.reduce((t, m) => ({ listed: t.listed + m.listed, parsed: t.parsed + m.parsed, failed: t.failed + m.failed, days: t.days + m.businessDays, complete: t.complete + m.complete + m.closed, missing: t.missing + m.missing + m.partial }), { listed: 0, parsed: 0, failed: 0, days: 0, complete: 0, missing: 0 });
  return (
    <details className="it-panel" open={tot.missing > 0 || undefined}>
      <summary className="cursor-pointer px-4 py-3 text-[13px] font-medium" style={{ color: "var(--it-text)" }}>
        Historical SEC coverage — {data ? `${count(tot.complete)} of ${count(tot.days)} business days held · ${count(tot.parsed)} of ${count(tot.listed)} filings processed${tot.failed ? ` · ${count(tot.failed)} failed` : ""}` : error || "loading…"}
        {tot.missing > 0 && <span className="ml-2 text-[12px]" style={{ color: "var(--it-warn)" }}>· {count(tot.missing)} days missing — signals from those days are absent, not zero</span>}
      </summary>
      <div className="it-scroll-x px-4 pb-4">
        <table className="w-full min-w-[720px] text-[12.5px]">
          <thead><tr className="it-dim2 text-left text-[11px]">
            {["Month", "Days held", "Filings (SEC index)", "Processed", "Failed", "Signals", "With prices", "Status"].map((h, i) => <th key={h} className={`py-1 pr-3 font-medium ${i && i < 7 ? "text-right" : ""}`}>{h}</th>)}
          </tr></thead>
          <tbody>
            {months.map((m) => {
              const s = byMonth[m.month] || { signals: 0, priced: 0 };
              const held = m.complete + m.closed;
              const ok = held === m.businessDays;
              const reasons = Object.entries(m.failedReasons || {}).map(([r, n]) => `${n} × ${r}`).join(", ");
              return (
                <tr key={m.month} style={{ borderTop: "1px solid var(--it-line-soft)" }}>
                  <td className="py-1.5 pr-3" style={{ color: "var(--it-text)" }}>{MONTH(m.month)}</td>
                  <td className="it-num py-1.5 pr-3 text-right">{held}/{m.businessDays}</td>
                  <td className="it-num py-1.5 pr-3 text-right">{count(m.listed)}</td>
                  <td className="it-num py-1.5 pr-3 text-right">{count(m.parsed)}</td>
                  <td className="it-num py-1.5 pr-3 text-right" title={reasons || undefined} style={{ color: m.failed ? "var(--it-warn)" : undefined }}>{count(m.failed)}</td>
                  <td className="it-num py-1.5 pr-3 text-right" style={{ color: "var(--it-text)" }}>{ok || s.signals ? count(s.signals) : "—"}</td>
                  <td className="it-num py-1.5 pr-3 text-right">{ok || s.signals ? count(s.priced) : "—"}</td>
                  <td className="py-1.5 text-[12px]" style={{ color: ok ? "var(--it-buy)" : "var(--it-warn)" }}>
                    {ok ? "Complete" : m.missing === m.businessDays ? "Not backfilled" : `${m.missing + m.partial} day${m.missing + m.partial === 1 ? "" : "s"} missing`}
                    {reasons ? <span className="it-dim2"> · {reasons}</span> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-2 text-[11.5px] it-dim2">Source: SEC EDGAR daily form indexes (Form 4 and 4/A), downloaded by <code>npm run backtest:backfill</code>. A month that is not complete may be missing signals — they are absent, never counted as zero activity.</p>
      </div>
    </details>
  );
}
