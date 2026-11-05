// Insider Tracker charts (lazy chunk). Every series is derived from real
// transaction rows via utils/insiderAggregate.js — no mock or random data.
import { memo, useMemo, useState } from "react";
import EChart, { C, MONO, axisCommon, baseOption } from "./EChart";
import { byDay, countableValue, isCounted, rowsOf, timelinePoints, topCompanies } from "../../../utils/insiderAggregate";
import { compactUsd, count, shortDay, day } from "../../../utils/insiderFormat";
import { EmptyState } from "../components/Common";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// Axis ticks: "$500M", "$1.5B" (absolute — sales are drawn below zero).
const axisUsd = (v) => {
  const a = Math.abs(v);
  if (a >= 1e9) return `$${+(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${+(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${+(a / 1e3).toFixed(0)}K`;
  return `$${a}`;
};
const swatch =(color) => `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${color};margin-right:6px"></span>`;
const line = (label, value, color) => `<div style="display:flex;justify-content:space-between;gap:16px;align-items:center"><span>${color ? swatch(color) : ""}${label}</span><span style="font-family:${MONO}">${value}</span></div>`;

function Seg({ value, onChange, options, label }) {
  return (
    <div className="it-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.key} aria-pressed={value === o.key} onClick={() => onChange(o.key)}>{o.label}</button>
      ))}
    </div>
  );
}

// Panel chrome with a chart ↔ table toggle (table = accessible data view).
function ChartFrame({ title, subtitle, controls, children, table, empty, emptyText, summary }) {
  const [mode, setMode] = useState("chart");
  return (
    <section className="it-panel flex h-full min-w-0 flex-col">
      <header className="it-panel-head flex-wrap">
        <div className="min-w-0">
          <h2 className="it-panel-title">{title}</h2>
          {subtitle && <div className="text-[12px] it-dim2">{subtitle}</div>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {controls}
          {!empty && <Seg label={`${title} view`} value={mode} onChange={setMode} options={[{ key: "chart", label: "Chart" }, { key: "table", label: "Table" }]} />}
        </div>
      </header>
      {!empty && summary}
      <div className="min-w-0 px-2 pb-2 pt-1">
        {empty ? <EmptyState title="No data for these filters">{emptyText}</EmptyState> : mode === "chart" ? children : <div className="max-h-[300px] overflow-auto px-2">{table}</div>}
      </div>
    </section>
  );
}

function DataTable({ head, rows }) {
  return (
    <table className="it-table">
      <thead><tr>{head.map((h, i) => <th key={h} className={i ? "num" : ""} scope="col">{h}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={j ? "num it-num" : "it-num"}>{c}</td>)}</tr>)}</tbody>
    </table>
  );
}

const zoomFor = (n, keep = 30) => (n > keep
  ? [{ type: "inside", startValue: n - keep, endValue: n - 1 }, { type: "slider", height: 16, bottom: 4, startValue: n - keep, endValue: n - 1, borderColor: "transparent", backgroundColor: "rgba(148,163,184,0.06)", fillerColor: "rgba(59,158,255,0.14)", handleStyle: { color: C.text3 }, moveHandleSize: 0, textStyle: { color: C.text3, fontSize: 10 }, brushSelect: false }]
  : []);

// 1. Purchases vs sales per day — purchases up, sales down (mirrored bars).
// Period totals of the plotted days (same values the bars show).
function BuySellSummary({ days }) {
  const s = useMemo(() => days.reduce((a, d) => ({ buy: a.buy + d.buyValue, sell: a.sell + d.sellValue, bc: a.bc + d.buyCount, sc: a.sc + d.sellCount }), { buy: 0, sell: 0, bc: 0, sc: 0 }), [days]);
  const net = s.buy - s.sell;
  return (
    <div className="it-legend" aria-label="Period totals">
      <div className="it-legend-item"><span className="k"><i style={{ background: "var(--it-buy-fill)" }} />Purchases · {count(s.bc)}</span><span className="v">{compactUsd(s.buy)}</span></div>
      <div className="it-legend-item"><span className="k"><i style={{ background: "var(--it-sell-fill)" }} />Sales · {count(s.sc)}</span><span className="v">{compactUsd(s.sell)}</span></div>
      <div className="it-legend-item"><span className="k">Net reported</span><span className="v" style={{ color: net >= 0 ? "var(--it-buy)" : "var(--it-sell)" }}>{net >= 0 ? "+" : "−"}{compactUsd(Math.abs(net))}</span></div>
    </div>
  );
}

export const BuySellChart = memo(function BuySellChart({ rows, onPickDay, height = 280 }) {
  const [dateKey, setDateKey] = useState("filingDate");
  const [view, setView] = useState("split");
  const days = useMemo(() => byDay(rows, dateKey), [rows, dateKey]);
  const option = useMemo(() => {
    const n = days.length;
    const zero = { silent: true, symbol: "none", label: { show: false }, lineStyle: { color: C.axis, type: "solid", width: 1 }, data: [{ yAxis: 0 }] };
    const series = view === "net"
      ? [{
        name: "Net", type: "bar", barMaxWidth: 18, barCategoryGap: "38%", markLine: zero,
        data: days.map((d) => { const v = d.buyValue - d.sellValue; return { value: v, itemStyle: { color: v >= 0 ? C.buy : C.sell, borderRadius: v >= 0 ? [4, 4, 0, 0] : [0, 0, 4, 4] } }; }),
      }]
      : [
        { name: "Purchases", type: "bar", stack: "v", barMaxWidth: 18, barCategoryGap: "38%", data: days.map((d) => d.buyValue), itemStyle: { color: C.buy, borderRadius: [4, 4, 0, 0] }, emphasis: { focus: "none" }, markLine: zero },
        { name: "Sales", type: "bar", stack: "v", barMaxWidth: 18, data: days.map((d) => -d.sellValue), itemStyle: { color: C.sell, borderRadius: [0, 0, 4, 4] }, emphasis: { focus: "none" } },
      ];
    return {
      ...baseOption,
      grid: { left: 8, right: 12, top: 18, bottom: n > 30 ? 30 : 8, containLabel: true },
      tooltip: {
        ...baseOption.tooltip, trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(148,163,184,0.06)" } },
        formatter: (ps) => {
          const d = days[ps[0].dataIndex];
          return `<div style="min-width:190px"><div style="color:${C.text2};margin-bottom:4px">${dateKey === "filingDate" ? "Filed" : "Traded"} ${esc(day(d.day))}</div>`
            + line(`Purchases · ${count(d.buyCount)}`, compactUsd(d.buyValue), C.buy)
            + line(`Sales · ${count(d.sellCount)}`, compactUsd(d.sellValue), C.sell)
            + `<div style="border-top:1px solid rgba(148,163,184,.15);margin-top:4px;padding-top:4px">${line("Net reported", (d.buyValue - d.sellValue >= 0 ? "+" : "−") + compactUsd(Math.abs(d.buyValue - d.sellValue)))}</div>`
            + (onPickDay && dateKey === "filingDate" ? `<div style="color:${C.text3};margin-top:4px;font-size:11px">Click to filter this filing day</div>` : "")
            + "</div>";
        },
      },
      xAxis: { type: "category", data: days.map((d) => shortDay(d.day)), ...axisCommon, axisLine: { show: false }, splitLine: { show: false } },
      yAxis: { type: "value", ...axisCommon, axisLine: { show: false }, splitLine: { lineStyle: { color: C.grid, type: [3, 4] } }, axisLabel: { ...axisCommon.axisLabel, formatter: (v) => (v < 0 ? "−" : "") + axisUsd(v) } },
      dataZoom: zoomFor(n),
      series,
    };
  }, [days, dateKey, onPickDay, view]);
  const onEvents = useMemo(() => ({
    click: (p) => { if (dateKey === "filingDate" && onPickDay && days[p.dataIndex]) onPickDay(days[p.dataIndex].day); },
  }), [days, dateKey, onPickDay]);

  return (
    <ChartFrame
      title="Insider buying vs selling"
      subtitle={`Reported value per ${dateKey === "filingDate" ? "SEC filing date" : "transaction (trade) date"} · days without filings omitted`}
      controls={<>
        <Seg label="Bars" value={view} onChange={setView} options={[{ key: "split", label: "Buy / sell" }, { key: "net", label: "Net" }]} />
        <Seg label="Date basis" value={dateKey} onChange={setDateKey} options={[{ key: "filingDate", label: "Filed" }, { key: "transactionDate", label: "Traded" }]} />
      </>}
      summary={<BuySellSummary days={days} />}
      empty={!days.length}
      table={<DataTable head={[dateKey === "filingDate" ? "Filed" : "Traded", "Purchases", "#", "Sales", "#"]} rows={[...days].reverse().map((d) => [day(d.day), compactUsd(d.buyValue), count(d.buyCount), compactUsd(d.sellValue), count(d.sellCount)])} />}
    >
      <EChart option={option} onEvents={onEvents} height={height} ariaLabel="Bar chart of reported insider purchase and sale value per day" />
    </ChartFrame>
  );
});

// 2. Buying breadth — distinct companies with reported insider purchases per trade day.
export const BuyingTrendChart = memo(function BuyingTrendChart({ rows, height = 240 }) {
  const series = useMemo(() => {
    const m = new Map();
    for (const r of rowsOf(rows)) {
      if (!isCounted(r) || r.code !== "P" || typeof r.transactionDate !== "string" || !r.transactionDate) continue;
      let d = m.get(r.transactionDate);
      if (!d) { d = { day: r.transactionDate, companies: new Set(), count: 0, value: 0 }; m.set(r.transactionDate, d); }
      d.companies.add(r.issuerCik || r.ticker);
      d.count++;
      const v = countableValue(r);
      if (v != null) d.value += v;
    }
    return [...m.values()].sort((a, b) => a.day.localeCompare(b.day)).map((d) => ({ ...d, companies: d.companies.size }));
  }, [rows]);
  const option = useMemo(() => ({
    ...baseOption,
    grid: { left: 8, right: 12, top: 14, bottom: series.length > 30 ? 30 : 8, containLabel: true },
    tooltip: {
      ...baseOption.tooltip, trigger: "axis", axisPointer: { type: "line", lineStyle: { color: C.axis } },
      formatter: (ps) => {
        const d = series[ps[0].dataIndex];
        return `<div style="min-width:180px"><div style="color:${C.text2};margin-bottom:4px">Traded ${esc(day(d.day))}</div>`
          + line("Companies with buys", count(d.companies), C.buy) + line("Purchase transactions", count(d.count)) + line("Reported value", compactUsd(d.value)) + "</div>";
      },
    },
    xAxis: { type: "category", data: series.map((d) => shortDay(d.day)), boundaryGap: false, ...axisCommon, splitLine: { show: false } },
    yAxis: { type: "value", minInterval: 1, ...axisCommon },
    dataZoom: zoomFor(series.length),
    series: [{
      name: "Companies with insider purchases", type: "line", data: series.map((d) => d.companies), smooth: false, symbol: "circle", symbolSize: 6, showSymbol: series.length <= 40,
      lineStyle: { width: 2, color: C.buy }, itemStyle: { color: C.buy, borderColor: C.surface, borderWidth: 2 },
      areaStyle: { color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: "rgba(18,174,117,0.22)" }, { offset: 1, color: "rgba(18,174,117,0)" }] } },
    }],
  }), [series]);
  return (
    <ChartFrame title="Insider buying trend" subtitle="Distinct companies with reported insider purchases, by trade date"
      empty={!series.length} emptyText="No reported purchases for the current filters."
      table={<DataTable head={["Traded", "Companies", "Purchases", "Value"]} rows={[...series].reverse().map((d) => [day(d.day), count(d.companies), count(d.count), compactUsd(d.value)])} />}>
      <EChart option={option} height={height} ariaLabel="Line chart of the number of companies with insider purchases per trade date" />
    </ChartFrame>
  );
});

// 3. Top companies by reported purchase (or sale) value. Click → cross-filter.
export const TopCompaniesChart = memo(function TopCompaniesChart({ rows, onPick, n = 10, height = 300 }) {
  const [side, setSide] = useState("P");
  const top = useMemo(() => topCompanies(rows, side, n), [rows, side, n]);
  const field = side === "P" ? "buyValue" : "sellValue";
  const color = side === "P" ? C.buy : C.sell;
  const option = useMemo(() => {
    const data = [...top].reverse();
    return {
      ...baseOption,
      grid: { left: 8, right: 64, top: 6, bottom: 6, containLabel: true },
      tooltip: {
        ...baseOption.tooltip, trigger: "item",
        formatter: (p) => {
          const c = data[p.dataIndex];
          return `<div style="min-width:200px"><div style="font-weight:600">${esc(c.ticker || "—")} <span style="color:${C.text2};font-weight:400">${esc(c.name)}</span></div>`
            + line(side === "P" ? `Purchases · ${count(c.buyCount)}` : `Sales · ${count(c.sellCount)}`, compactUsd(c[field]), color)
            + line("Reporting insiders", count(c.insiders))
            + (onPick ? `<div style="color:${C.text3};margin-top:4px;font-size:11px">Click to filter by ${esc(c.ticker || "company")}</div>` : "") + "</div>";
        },
      },
      xAxis: { type: "value", ...axisCommon, axisLabel: { show: false }, splitLine: { show: false } },
      yAxis: { type: "category", data: data.map((c) => c.ticker || c.name?.slice(0, 10)), ...axisCommon, axisLine: { show: false }, axisLabel: { color: C.text, fontFamily: MONO, fontSize: 11 } },
      series: [{
        type: "bar", data: data.map((c) => c[field]), barMaxWidth: 16, itemStyle: { color, borderRadius: [0, 4, 4, 0] }, cursor: onPick ? "pointer" : "default",
        label: { show: true, position: "right", color: C.text2, fontFamily: MONO, fontSize: 10.5, formatter: (p) => compactUsd(p.value) },
      }],
    };
  }, [top, field, color, side, onPick]);
  const onEvents = useMemo(() => ({ click: (p) => { const c = [...top].reverse()[p.dataIndex]; if (c?.ticker && onPick) onPick(c.ticker); } }), [top, onPick]);
  return (
    <ChartFrame title="Top companies" subtitle={`By reported ${side === "P" ? "purchase" : "sale"} value · anomalies & superseded excluded`}
      controls={<Seg label="Side" value={side} onChange={setSide} options={[{ key: "P", label: "Purchases" }, { key: "S", label: "Sales" }]} />}
      empty={!top.length} emptyText={`No reported ${side === "P" ? "purchases" : "sales"} with a value for the current filters.`}
      table={<DataTable head={["Company", "Value", "Transactions", "Insiders"]} rows={top.map((c) => [`${c.ticker || "—"} · ${c.name}`, compactUsd(c[field]), count(side === "P" ? c.buyCount : c.sellCount), count(c.insiders)])} />}>
      <EChart option={option} onEvents={onEvents} height={height} ariaLabel={`Horizontal bar chart of the top ${n} companies by reported ${side === "P" ? "purchase" : "sale"} value`} />
    </ChartFrame>
  );
});

// 4. Activity timeline — each transaction at (trade date, filing date); size ∝ value.
const WINDOW_DAYS = 60;
export const ActivityTimeline = memo(function ActivityTimeline({ rows, height = 300 }) {
  const pts = useMemo(() => timelinePoints(rows), [rows]);
  // Default window: the most recent WINDOW_DAYS of trade dates.
  const win = useMemo(() => {
    let max = 0;
    for (const p of pts) { const t = Date.parse(`${p.trade}T00:00:00Z`); if (t > max) max = t; }
    const start = max - WINDOW_DAYS * 86_400_000;
    return { start, end: max + 86_400_000, older: pts.filter((p) => Date.parse(`${p.trade}T00:00:00Z`) < start).length };
  }, [pts]);
  const option = useMemo(() => {
    const maxV = Math.max(1, ...pts.map((p) => p.value || 0));
    const size = (v) => (v == null ? 5 : 5 + 19 * Math.sqrt(v / maxV));
    const toSeries = (code) => pts.filter((p) => p.code === code).map((p) => ({
      value: [p.trade, p.filed, p.value], p,
      symbolSize: size(p.value),
      itemStyle: p.late ? { color: "transparent", borderColor: code === "P" ? C.buy : C.sell, borderWidth: 1.5 } : undefined,
    }));
    return {
      ...baseOption,
      legend: { top: 0, right: 4, itemWidth: 10, itemHeight: 10, textStyle: { color: C.text2, fontSize: 11 }, data: ["Purchases", "Sales"] },
      grid: { left: 8, right: 16, top: 30, bottom: 30, containLabel: true },
      tooltip: {
        ...baseOption.tooltip, trigger: "item",
        formatter: ({ data }) => {
          const p = data.p;
          return `<div style="min-width:210px"><div style="font-weight:600">${esc(p.ticker || "—")} <span style="color:${C.text2};font-weight:400">${esc(p.issuer)}</span></div>`
            + `<div style="color:${C.text2};margin-bottom:4px">${esc(p.insider)}</div>`
            + line(p.code === "P" ? "Purchase" : "Sale", p.excluded ? "unverified" : compactUsd(p.value), p.code === "P" ? C.buy : C.sell)
            + line("Traded", day(p.trade)) + line("Filed", day(p.filed))
            + (p.businessDays != null ? line("Filing delay", `${p.businessDays} business days${p.late ? " · late" : ""}`) : "") + "</div>";
        },
      },
      xAxis: { type: "time", ...axisCommon, axisLabel: { ...axisCommon.axisLabel, hideOverlap: true, formatter: "{MMM} {d}" } },
      yAxis: { type: "time", name: "Filed", nameTextStyle: { color: C.text3, fontSize: 10.5 }, ...axisCommon, axisLabel: { ...axisCommon.axisLabel, formatter: "{MMM} {d}" } },
      // Very late filings can report trades from years ago: open on the recent window, full range via slider.
      dataZoom: [
        { type: "inside", xAxisIndex: 0, filterMode: "none", startValue: win.start, endValue: win.end },
        { type: "slider", xAxisIndex: 0, filterMode: "none", startValue: win.start, endValue: win.end, height: 16, bottom: 4, borderColor: "transparent", backgroundColor: "rgba(148,163,184,0.06)", fillerColor: "rgba(59,158,255,0.14)", handleStyle: { color: C.text3 }, moveHandleSize: 0, textStyle: { color: C.text3, fontSize: 10 }, brushSelect: false, labelFormatter: (v) => shortDay(new Date(v).toISOString().slice(0, 10)) },
      ],
      series: [
        { name: "Purchases", type: "scatter", data: toSeries("P"), itemStyle: { color: C.buy, opacity: 0.8, borderColor: C.surface, borderWidth: 1 }, emphasis: { scale: 1.3 }, large: false },
        { name: "Sales", type: "scatter", data: toSeries("S"), itemStyle: { color: C.sell, opacity: 0.7, borderColor: C.surface, borderWidth: 1 }, emphasis: { scale: 1.3 } },
      ],
    };
  }, [pts, win]);
  const lateCount = useMemo(() => pts.filter((p) => p.late).length, [pts]);
  return (
    <ChartFrame title="Insider activity timeline" subtitle={`Trade date vs SEC filing date · size ∝ reported value · hollow = late filing (${count(lateCount)}) · last ${WINDOW_DAYS} trade days shown${win.older ? `, ${count(win.older)} older trades via slider` : ""}`}
      empty={!pts.length}
      table={<DataTable head={["Traded", "Filed", "Ticker", "Side", "Value"]} rows={pts.slice(0, 200).map((p) => [day(p.trade), day(p.filed), p.ticker || "—", p.code === "P" ? "Purchase" : "Sale", p.excluded ? "unverified" : compactUsd(p.value)])} />}>
      <EChart option={option} height={height} ariaLabel="Scatter plot of insider transactions by trade date and filing date" />
    </ChartFrame>
  );
});
