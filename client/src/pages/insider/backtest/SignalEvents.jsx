// Signal integrity views for one signal (display only — every number comes from the server):
//   SignalSnapshot  the purchases exactly as public at the signal's SEC acceptance (frozen),
//                   then the purchases published LATER (hindsight — never in the signal or
//                   its returns), each with its own SEC acceptance time.
//   EventStudy      on demand: every later SEC publication of the company measured from
//                   ITS OWN acceptance with the run's execution rules
//                   (GET /insider/backtest/run/:id/event-study/:signalId). Separate from
//                   the signal's strategy return, which is never rewritten.
import { useState } from "react";
import api from "../../../lib/api";
import { ErrorNote } from "../components/Common";
import { compactUsd, count, day, acceptedShort, shares as fmtShares } from "../../../utils/insiderFormat";
import { pct, plainPct, etParts, strategyStatusShort, strategyStatusText, RELIABILITY_TEXT, missingBreakdown } from "../../../utils/insiderBacktest";

const tone = (v) => (v == null || Math.abs(v) < 0.0005 ? undefined : v > 0 ? "var(--it-buy)" : "var(--it-sell)");

function PurchaseRows({ rows, dim = false }) {
  return (
    <div className="it-scroll-x">
      <table className="w-full min-w-[720px] text-[12.5px]">
        <thead><tr className="it-dim2 text-left text-[11px]">
          {["Insider", "Role", "Trade date", "SEC public", "Shares", "Value (USD)", "Filed after"].map((h, i) => <th key={h} className={`py-1 pr-3 font-medium ${i >= 4 ? "text-right" : ""}`}>{h}</th>)}
        </tr></thead>
        <tbody>
          {rows.map((p) => (
            <tr key={`${p.rowId}-${p.publicAt}`} style={{ borderTop: "1px solid var(--it-line-soft)", opacity: dim ? 0.85 : 1 }}>
              <td className="py-1.5 pr-3" style={{ color: "var(--it-text)" }}>
                {p.url ? <a className="hover:underline" href={p.url} target="_blank" rel="noopener noreferrer">{p.name}</a> : p.name}
                {p.possibleDuplicate ? <span className="ml-1 text-[10.5px]" style={{ color: "var(--it-warn)" }} title="Same date, shares, price and holdings-after as another filer's report, but no filing links them — counted separately, may be the same transaction">possible duplicate report</span> : null}
              </td>
              <td className="py-1.5 pr-3 text-[11.5px] it-dim">{(p.roles || []).join(" · ")}</td>
              <td className="it-num py-1.5 pr-3 whitespace-nowrap">{day(p.transactionDate)}</td>
              <td className="it-num py-1.5 pr-3 whitespace-nowrap text-[12px] it-dim">{acceptedShort(p.publicAt)}</td>
              <td className="it-num py-1.5 pr-3 text-right">{fmtShares(p.shares)}</td>
              <td className="it-num py-1.5 pr-3 text-right">{p.valueUsd != null ? compactUsd(p.valueUsd) : <span className="it-dim2" title={p.valueExcludedReason || ""}>not counted</span>}</td>
              <td className="it-num py-1.5 text-right it-dim">{p.filingDelayDays != null ? `${p.filingDelayDays} d` : "—"}{p.late ? <span className="ml-1 text-[10.5px]" style={{ color: "var(--it-warn)" }}>late</span> : null}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SignalSnapshot({ signal }) {
  const snap = signal?.snapshot?.purchases || [];
  const later = signal?.hindsight?.laterPurchases || [];
  const corrections = signal?.hindsight?.amendmentsOfSignalPurchases || [];
  if (!snap.length) return null;
  return (
    <div className="flex flex-col gap-3 px-4 py-3" style={{ borderTop: "1px solid var(--it-line-soft)" }}>
      <section>
        <h4 className="it-label">Signal snapshot · frozen at SEC acceptance {signal.publishedAt}</h4>
        <p className="mb-1.5 text-[11.5px] it-dim2">
          {count(signal.uniqueBuyers)} distinct buyer{signal.uniqueBuyers === 1 ? "" : "s"} · {count(signal.purchases)} purchase transaction{signal.purchases === 1 ? "" : "s"} · {compactUsd(signal.valueUsd)} combined.
          Exactly what was public at that moment; later filings never change it. Cluster {signal.clusterId}.
        </p>
        <PurchaseRows rows={snap} />
      </section>
      <section>
        <h4 className="it-label">Later SEC publications · hindsight — not part of the signal or its return</h4>
        {later.length ? <PurchaseRows rows={later} dim /> : <p className="text-[12px] it-dim2">No later purchases were published for this cluster.</p>}
      </section>
      {corrections.length > 0 && (
        <section>
          <h4 className="it-label">Form 4/A corrections of signal purchases · hindsight — not new purchases</h4>
          <p className="mb-1.5 text-[11.5px] it-dim2">Filed after the signal; each restates a purchase the signal used. The signal, its entry and its return stay as published.</p>
          <PurchaseRows rows={corrections} dim />
        </section>
      )}
    </div>
  );
}

export function EventStudy({ jobId, signalId }) {
  const [s, setS] = useState({ loading: false, data: null, error: null });
  const load = async () => {
    setS({ loading: true, data: null, error: null });
    try { const { data } = await api.get(`/insider/backtest/run/${jobId}/event-study/${encodeURIComponent(signalId)}`); setS({ loading: false, data, error: null }); }
    catch (err) { setS({ loading: false, data: null, error: err.response?.data?.error || "Could not load the event study." }); }
  };
  const d = s.data, sum = d?.summary, miss = missingBreakdown(sum?.missing);
  return (
    <div className="flex flex-col gap-2 px-4 py-3" style={{ borderTop: "1px solid var(--it-line-soft)" }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="it-label">Event study · later SEC publications measured from their own acceptance</h4>
        <button className="it-btn" onClick={load} disabled={s.loading}>{s.loading ? "Loading…" : d ? "Refresh" : "Run event study"}</button>
      </div>
      <p className="text-[11.5px] leading-relaxed it-dim2">Separate analysis: each later Form 4 publication for this company is treated as its own event, entered after its own SEC acceptance plus the run&apos;s latency and held for the run&apos;s horizon. It never changes the signal, its entry or its return.</p>
      {s.error && <ErrorNote>{s.error}</ErrorNote>}
      {d && (
        <>
          {d.restrictedNote && <p className="text-[12px]" style={{ color: "var(--it-warn)" }}>{d.restrictedNote}</p>}
          {sum && (
            <p className="text-[12.5px]" style={{ color: "var(--it-text-2)" }}>
              {count(d.eventsShown)} event{d.eventsShown === 1 ? "" : "s"}{d.eventsTotal > d.eventsShown ? ` (first ${d.eventsShown} of ${d.eventsTotal})` : ""} · n = {count(sum.n)} complete ·
              avg net <span className="it-num" style={{ color: tone(sum.netMean) }}>{pct(sum.netMean, 2)}</span> · median <span className="it-num">{pct(sum.netMedian, 2)}</span> ·
              win rate {sum.winRate == null ? "—" : plainPct(sum.winRate)} · SPY {pct(sum.benchmarkMean, 2)}
              <span className="it-dim2"> · {miss.immature} not mature · {miss.missingEntry} no entry · {miss.missingExit} no exit · {miss.loading} loading</span>
            </p>
          )}
          {d.reliability?.verdict === "not_reliable" && <p className="text-[11.5px]" style={{ color: "var(--it-warn)" }}>Not statistically reliable: {d.reliability.reasons.map((r) => RELIABILITY_TEXT[r] || r).join("; ")}.</p>}
          {!d.events.length ? <p className="text-[12px] it-dim2">No later SEC publications for this company in the held data.</p> : (
            <div className="it-scroll-x">
              <table className="w-full min-w-[760px] text-[12.5px]">
                <thead><tr className="it-dim2 text-left text-[11px]">
                  {["SEC published", "Insiders · purchases", "Value", "Entry", "Exit", "Gross", "Net", "SPY"].map((h, i) => <th key={h} className={`py-1 pr-3 font-medium ${i >= 2 ? "text-right" : ""}`}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {d.events.map((e) => {
                    const r = e.strategy || {};
                    const ok = r.status === "ok";
                    return (
                      <tr key={e.publishedAt} style={{ borderTop: "1px solid var(--it-line-soft)" }}>
                        <td className="it-num py-1.5 pr-3 whitespace-nowrap" style={{ color: "var(--it-text)" }}>{acceptedShort(e.publishedAt)}</td>
                        <td className="py-1.5 pr-3 text-[12px] it-dim">{e.insiders} · {e.purchases.length}</td>
                        <td className="it-num py-1.5 pr-3 text-right">{compactUsd(e.valueUsd)}</td>
                        <td className="it-num py-1.5 pr-3 text-right whitespace-nowrap">{r.entry ? `${etParts(r.entry.time, { year: false }).date}` : <span className="bt-status" title={strategyStatusText(r.status)}>{strategyStatusShort(r.status)}</span>}</td>
                        <td className="it-num py-1.5 pr-3 text-right whitespace-nowrap">{r.exit ? day(r.exit.date) : "—"}</td>
                        <td className="it-num py-1.5 pr-3 text-right" style={{ color: tone(r.gross) }}>{ok ? pct(r.gross, 2) : r.entry ? <span className="bt-status" title={strategyStatusText(r.status)}>{strategyStatusShort(r.status)}</span> : "—"}</td>
                        <td className="it-num py-1.5 pr-3 text-right" style={{ color: tone(r.net) }}>{ok ? pct(r.net, 2) : "—"}</td>
                        <td className="it-num py-1.5 text-right">{ok ? pct(r.benchmark, 2) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
