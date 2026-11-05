// Companies — stock price performance with insider purchases marked (the Backtesting TrackChart,
// reused). Data: GET /api/insider/backtest/company/:cik/track — real split-adjusted daily closes
// and SEC Form 4 code P purchases only. No prices → a clear message, never simulated values.
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { LuX, LuExternalLink, LuTriangleAlert, LuInfo, LuMousePointerClick } from "react-icons/lu";
import api from "../../../lib/api";
import { compactUsd, count, price as fmtPrice, shortDay, day, acceptedShort, shares as fmtShares } from "../../../utils/insiderFormat";
import { pct } from "../../../utils/insiderBacktest";
import { companyReturns, sinceMark, groupEventsByDay, COMPANY_TRACK_STATUS_TEXT, FLAG_TEXT, PRICE_BASIS_TEXT } from "../../../utils/insiderTrack";
import { PURCHASE_TYPE } from "../../../utils/companiesEvidence";
import { ChartErrorBoundary } from "../charts/LazyCharts";
import { CompanyLogo } from "./evidenceParts";

const LTrack = lazy(() => import("../backtest/BacktestCharts.jsx").then((m) => ({ default: m.TrackChart })));
const tone = (v) => (v == null ? "var(--it-text-2)" : v > 0 ? "var(--it-buy)" : v < 0 ? "var(--it-sell)" : "var(--it-text-2)");

function Kpi({ label, value, sub, tag }) {
  return (
    <div className="cp-pkpi">
      <div className="cp-pkpi-label">{label}{tag && <span className="cp-pkpi-tag">{tag}</span>}</div>
      <div className="cp-pkpi-value it-num" style={{ color: tone(value) }}>{value == null ? "—" : pct(value)}</div>
      {sub && <div className="cp-small" style={{ whiteSpace: "normal" }}>{sub}</div>}
    </div>
  );
}

function EventDetail({ track, events, onClear }) {
  return (
    <div className="cp-pick" role="region" aria-label="Selected insider purchase">
      <div className="cp-row" style={{ justifyContent: "space-between" }}>
        <b style={{ fontSize: 13 }}>{events.length} purchase{events.length === 1 ? "" : "s"} · trade date {day(events[0].date)}</b>
        <button className="it-btn it-btn-ghost it-icon-btn" onClick={onClear} aria-label="Clear selection"><LuX size={15} /></button>
      </div>
      {events.map((e, i) => {
        const sinceBuy = sinceMark(track, e.pctAtEvent), sincePub = sinceMark(track, e.pctAtPublication);
        return (
          <div key={`${e.rowId || e.accessionNo}-${i}`} className="cp-ev" style={{ marginTop: 8 }}>
            <div className="cp-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ minWidth: 0 }}>
                <b style={{ fontSize: 13 }}>{e.insider}</b>
                <div className="cp-small" style={{ whiteSpace: "normal" }}>{(e.roles || []).join(" · ") || "—"}{e.jointFilers ? ` · +${e.jointFilers} joint filer${e.jointFilers === 1 ? "" : "s"}` : ""}</div>
              </div>
              <span className="cp-small">{PURCHASE_TYPE[e.purchaseContext] || PURCHASE_TYPE.unspecified}</span>
            </div>
            <div className="cp-ev-grid">
              <div><span>Transaction date</span>{shortDay(e.date)}</div>
              <div><span>SEC filed (accepted)</span>{acceptedShort(e.publishedAt)}</div>
              <div><span>Shares</span>{e.shares != null ? fmtShares(e.shares) : "—"}</div>
              <div><span>Form 4 price</span>{e.form4Price != null ? fmtPrice(e.form4Price) : "—"}</div>
              <div><span>Total value</span>{e.valueUsd != null ? compactUsd(e.valueUsd) : <span style={{ color: "var(--it-warn)" }}>{e.priceFlag === "price_anomaly" ? "price anomaly — not counted" : "not reported"}</span>}</div>
              <div><span>Since this purchase</span><b className="it-num" style={{ color: tone(sinceBuy) }}>{sinceBuy == null ? "—" : pct(sinceBuy)}</b></div>
              <div><span>Since SEC publication</span><b className="it-num" style={{ color: tone(sincePub) }}>{sincePub == null ? "—" : pct(sincePub)}</b>{sincePub == null && track ? <span style={{ display: "inline", textTransform: "none", letterSpacing: 0 }}> · no close after the filing in the price data yet</span> : null}{e.publicationPriceDate ? <span style={{ display: "inline", textTransform: "none", letterSpacing: 0 }}> · from close {shortDay(e.publicationPriceDate)}</span> : null}</div>
              <div><span>Close used</span>{e.priceDate ? `${shortDay(e.priceDate)}${PRICE_BASIS_TEXT[e.priceBasis] ? ` (${PRICE_BASIS_TEXT[e.priceBasis]})` : ""}` : "—"}</div>
            </div>
            {e.amendedBy && <div className="cp-small" style={{ marginTop: 6, color: "var(--it-warn)", whiteSpace: "normal" }}>Later restated by Form 4/A {e.amendedBy.accessionNo}.</div>}
            <div className="cp-row" style={{ justifyContent: "space-between", marginTop: 8 }}>
              <span className="cp-acc">Form 4 · {e.accessionNo}</span>
              {e.filingUrl && <a className="it-link cp-small" href={e.filingUrl} target="_blank" rel="noopener noreferrer"><LuExternalLink size={12} style={{ verticalAlign: -2 }} /> sec.gov</a>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function PriceDrawer({ c, from, to, onClose }) {
  const cik = String(c.cik || "").replace(/\D/g, "");
  const [st, setSt] = useState({ loading: true, data: null, error: null });
  const [picked, setPicked] = useState(null);
  useEffect(() => {
    let live = true;
    setSt({ loading: true, data: null, error: null });
    setPicked(null);
    api.get(`/insider/backtest/company/${encodeURIComponent(cik)}/track`, { params: { from, to: to || undefined } })
      .then(({ data }) => { if (live) setSt({ loading: false, data, error: null }); })
      .catch((err) => { if (live) setSt({ loading: false, data: null, error: err.response?.status === 404 ? err.response.data?.error || "No SEC purchases in this period." : "Could not load the price timeline." }); });
    return () => { live = false; };
  }, [cik, from, to]);
  useEffect(() => {
    const k = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const t = st.data;
  const priced = t?.status === "ok" && (t.series || []).length > 0;
  const r = useMemo(() => (priced ? companyReturns(t) : null), [t, priced]);
  const days = useMemo(() => groupEventsByDay(t?.events || []).reverse(), [t]);
  const pickedEvents = picked ? (t?.events || []).filter((e) => e.date === picked) : [];
  const narrow = typeof window !== "undefined" && window.innerWidth < 640;

  return (
    <>
      <div className="it-backdrop" onClick={onClose} />
      <aside className="it-drawer cp-drawer cp-drawer-wide" role="dialog" aria-modal="true" aria-label={`Price performance and insider purchases for ${c.ticker || c.name}`} style={{ display: "flex", flexDirection: "column" }}>
        <div className="cp-dhead">
          <div className="cp-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
            <div className="cp-row" style={{ alignItems: "flex-start" }}>
              <CompanyLogo cik={c.cik} ticker={c.ticker} name={c.name} />
              <div>
                <div className="cp-row"><span className="cp-ticker" style={{ fontSize: 16 }}>{c.ticker || "—"}</span><span className="it-dim" style={{ fontSize: 12.5 }}>Price &amp; insider purchases</span></div>
                <div className="it-dim" style={{ fontSize: 12.5, marginTop: 2 }}>{c.name}</div>
              </div>
            </div>
            <button className="it-btn it-btn-ghost it-icon-btn" onClick={onClose} aria-label="Close price chart"><LuX size={18} /></button>
          </div>
          {t && (
            <p className="it-dim" style={{ fontSize: 12, marginTop: 8, lineHeight: 1.5 }}>
              Baseline: close on the first purchase&rsquo;s transaction date ({day(t.baseline?.date || t.startDate)}).
              {priced ? ` Daily closes, split-adjusted (${t.prices?.provider === "alpaca_sip_daily_closes" ? "Alpaca SIP" : t.prices?.provider}; ${t.symbol} vs ${t.benchmarkSymbol}) — dividends not included.` : ""}
            </p>
          )}
        </div>
        <div className="cp-dbody">
          {st.loading && <div className="cp-col" style={{ gap: 8 }}><div className="it-skel" style={{ height: 70, borderRadius: 10 }} /><div className="it-skel" style={{ height: 300, borderRadius: 10 }} /></div>}
          {st.error && <div className="cp-empty" style={{ padding: 32 }}><div className="cp-empty-icon" style={{ color: "var(--it-sell)" }}><LuTriangleAlert size={22} /></div><b>{st.error}</b></div>}
          {t && !priced && (
            <div className="cp-note" role="status" style={{ marginBottom: 12 }}><LuTriangleAlert size={15} style={{ flex: "none", marginTop: 2, color: "var(--it-warn)" }} />
              <span><b>Price data unavailable.</b> {COMPANY_TRACK_STATUS_TEXT[t.status] || "No historical prices for this company. No prices are simulated."}</span>
            </div>
          )}
          {r && (
            <div className="cp-pkpis">
              <Kpi label="Since first purchase" tag="hindsight" value={r.sinceFirst.pct} sub={`${shortDay(r.sinceFirst.from)} close ${fmtPrice(r.sinceFirst.fromClose)} → ${shortDay(r.sinceFirst.to)} ${fmtPrice(r.sinceFirst.toClose)}`} />
              <Kpi label="Since first SEC publication" value={r.sinceFirstPublication?.pct ?? null} sub={r.sinceFirstPublication ? `From close ${shortDay(r.sinceFirstPublication.from)} (filed ${acceptedShort(r.sinceFirstPublication.publishedAt)})` : "Not available"} />
              <Kpi label="Since latest purchase" value={r.sinceLatest?.pct ?? null} sub={r.sinceLatest ? `${shortDay(r.sinceLatest.date)} · ${r.sinceLatest.insider}` : "Same as first purchase date"} />
              <Kpi label={`${r.benchmark?.symbol || "SPY"} same period`} value={r.benchmark?.pct ?? null} sub={r.peak ? `${t.symbol} peak ${pct(r.peak.pct)} (${shortDay(r.peak.date)})` : null} />
            </div>
          )}
          {priced && (t.flags || []).length > 0 && (
            <ul className="cp-small" style={{ whiteSpace: "normal", margin: "0 0 10px", paddingLeft: 16, color: "var(--it-warn)" }}>{t.flags.map((f) => <li key={f}>{FLAG_TEXT[f] || f}</li>)}</ul>
          )}
          {priced && (
            <div className="cp-pchart">
              <ChartErrorBoundary title="price performance" height={narrow ? 260 : 320}>
                <Suspense fallback={<div className="it-skel" style={{ height: narrow ? 260 : 320, borderRadius: 10 }} />}>
                  <LTrack track={t} height={narrow ? 260 : 320} onPickEvent={setPicked} compact={narrow} />
                </Suspense>
              </ChartErrorBoundary>
              <div className="cp-small" style={{ display: "flex", gap: 6, alignItems: "flex-start", marginTop: 4, whiteSpace: "normal" }}><LuMousePointerClick size={13} style={{ flex: "none", marginTop: 2 }} />Click a ▲ purchase marker (or a date below) for the Form 4 details. ◯ = first close after the SEC filing was accepted.</div>
            </div>
          )}
          {pickedEvents.length > 0 && <EventDetail track={priced ? t : null} events={pickedEvents} onClear={() => setPicked(null)} />}
          {t && days.length > 0 && (
            <section aria-label="Insider purchases" style={{ marginTop: 14 }}>
              <h4 className="cp-ph4">SEC Form 4 purchases · {count(t.eventCount ?? t.events?.length)}</h4>
              <ul className="cp-pdays">
                {days.map((g) => (
                  <li key={g.date}>
                    <button className={`cp-pday${picked === g.date ? " on" : ""}`} onClick={() => setPicked(picked === g.date ? null : g.date)} aria-pressed={picked === g.date}>
                      <span className="it-num" style={{ fontWeight: 600 }}>{shortDay(g.date)}</span>
                      <span className="cp-pday-who">{g.purchases} · {g.insiders.slice(0, 2).join(", ")}{g.insiders.length > 2 ? ` +${g.insiders.length - 2}` : ""}</span>
                      <span className="it-num">{g.valueUsd ? compactUsd(g.valueUsd) : "—"}</span>
                      <span className="it-num" style={{ color: tone(g.pctAtEvent), minWidth: 58, textAlign: "right" }}>{priced && g.pctAtEvent != null ? pct(g.pctAtEvent) : ""}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {t && (
            <div className="cp-note" style={{ marginTop: 14 }}><LuInfo size={14} style={{ flex: "none", marginTop: 2, color: "var(--cp-act)" }} />
              <span>Purchases are drawn on their <b>transaction date</b>; the public learned of them only at the <b>SEC filing</b> (accepted time shown per purchase). &ldquo;Since first purchase&rdquo; therefore uses hindsight; &ldquo;since SEC publication&rdquo; starts at the first close after acceptance. Past performance — not investment advice. Backtesting results are separate and unchanged.</span>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
