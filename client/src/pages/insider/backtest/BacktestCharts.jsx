// Backtest charts (lazy chunk with ECharts): equity curve vs S&P 500 and the
// distribution of per-signal net returns. Colors validated on the dark surface
// #10151f (dataviz validator): strategy #3987e5 / benchmark #d95926 (CVD ΔE 26.8);
// gain/loss bars use the dashboard's validated buy/sell pair (ΔE 10.3).
import EChart, { C, MONO, axisCommon, baseOption } from "../charts/EChart";
import { returnHistogram, pct } from "../../../utils/insiderBacktest";
import { eventPoints, clusterSpans, signalMarkers, lineData } from "../../../utils/insiderTrack";
import { shortDay, day } from "../../../utils/insiderFormat";

// ECharts reads "YYYY-MM-DD" on a time axis as LOCAL midnight → read it back with
// local getters (toISOString() would shift the date in time zones east of UTC).
const localIso = (v) => { const d = new Date(v); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const STRATEGY = "#3987e5";
const BENCH = "#d95926";

export function EquityCurveChart({ equity, benchmarkSymbol = "SPY", height = 300 }) {
  const pts = equity.points;
  const last = pts[pts.length - 1];
  const option = {
    ...baseOption,
    grid: { left: 52, right: 96, top: 28, bottom: 28 },
    legend: { top: 0, left: 0, itemWidth: 14, itemHeight: 2, icon: "rect", textStyle: { color: C.text2, fontSize: 11 }, data: ["Strategy (net)", `${benchmarkSymbol} buy & hold`] },
    tooltip: {
      ...baseOption.tooltip, trigger: "axis", axisPointer: { type: "line", lineStyle: { color: C.axis } },
      formatter: (ps) => {
        const p = pts[ps[0].dataIndex];
        return `<div style="font-family:${MONO};font-size:11px;color:${C.text3}">${day(p.date)}</div>`
          + ps.map((x) => `<div><span style="display:inline-block;width:8px;height:2px;margin-right:6px;vertical-align:middle;background:${x.color}"></span>${x.seriesName}: <b>${pct(x.value - 1)}</b></div>`).join("")
          + `<div style="color:${C.text3}">${p.open} open position${p.open === 1 ? "" : "s"}</div>`;
      },
    },
    xAxis: { type: "category", data: pts.map((p) => p.date), boundaryGap: false, ...axisCommon, splitLine: { show: false }, axisLabel: { ...axisCommon.axisLabel, formatter: shortDay, hideOverlap: true } },
    yAxis: { type: "value", scale: true, ...axisCommon, axisLabel: { ...axisCommon.axisLabel, formatter: (v) => pct(v - 1, 0) } },
    series: [
      { name: "Strategy (net)", type: "line", data: pts.map((p) => p.value), showSymbol: false, lineStyle: { width: 2, color: STRATEGY }, itemStyle: { color: STRATEGY },
        endLabel: { show: true, formatter: () => `Strategy ${pct(last.value - 1, 0)}`, color: C.text, fontSize: 11 } },
      { name: `${benchmarkSymbol} buy & hold`, type: "line", data: pts.map((p) => p.benchmark), showSymbol: false, lineStyle: { width: 2, color: BENCH }, itemStyle: { color: BENCH },
        endLabel: { show: true, formatter: () => `${benchmarkSymbol} ${pct(last.benchmark - 1, 0)}`, color: C.text2, fontSize: 11 } },
    ],
  };
  return <EChart option={option} height={height} ariaLabel={`Equity curve of the strategy versus ${benchmarkSymbol}`} />;
}

export function ReturnDistributionChart({ signals, horizon, height = 260 }) {
  const bins = returnHistogram(signals, horizon, 0.05);
  const option = {
    ...baseOption,
    grid: { left: 40, right: 12, top: 12, bottom: 30 },
    tooltip: {
      ...baseOption.tooltip, trigger: "item",
      formatter: (p) => { const b = bins[p.dataIndex]; return `${pct(b.from, 0)} to ${pct(b.to, 0)}<br/><b>${b.count}</b> signal${b.count === 1 ? "" : "s"}`; },
    },
    xAxis: { type: "category", data: bins.map((b) => pct(b.from, 0)), ...axisCommon, splitLine: { show: false }, axisLabel: { ...axisCommon.axisLabel, hideOverlap: true } },
    yAxis: { type: "value", minInterval: 1, ...axisCommon },
    series: [{
      type: "bar", barCategoryGap: 2, data: bins.map((b) => ({ value: b.count, itemStyle: { color: b.from >= 0 ? C.buy : C.sell, borderRadius: [4, 4, 0, 0] } })),
      emphasis: { itemStyle: { opacity: 0.85 } },
    }],
  };
  return <EChart option={option} height={height} ariaLabel={`Distribution of ${horizon} net returns per signal`} />;
}

// Purchase-date tracking timeline on a CALENDAR (time) axis at one-day resolution:
// % change of the split/dividend-adjusted daily close vs the FIXED baseline (first
// purchase trade date); optional benchmark over the same sessions; purchase markers
// at their EXACT transaction dates (one marker per day — several purchases on a day
// are grouped, never by week); weekends/holidays have no bars (the line spans them);
// trading sessions without a bar break the line (null gap, never filled).
// Grey dashed "SEC n" = SEC acceptance date of signal n; blue dashed = backtest entry.
// Colors: stock #3987e5, benchmark #d95926, purchases #12ae75 — validated together
// on #10151f (all-pairs CVD ΔE ≥ 8.7); purchases also differ by shape (triangles).
export function TrackChart({ track, events, height = 340 }) {
  const series = track.series || [];
  const missing = track.missingSessions || [];
  const points = eventPoints(events ?? track.events);
  const spans = clusterSpans(track.clusters, series);
  const markers = signalMarkers(track.clusters, series);
  const hasBench = series.some((p) => p.benchmarkPct != null);
  const byDate = new Map(series.map((p) => [p.date, p]));
  const last = series[series.length - 1];
  const option = {
    ...baseOption,
    grid: { left: 52, right: 104, top: 44, bottom: 30 },
    legend: { top: 0, left: 0, itemWidth: 14, itemHeight: 8, textStyle: { color: C.text2, fontSize: 11 }, data: [`${track.symbol} vs baseline`, ...(hasBench ? [`${track.benchmarkSymbol} same period`] : []), "Insider purchase (trade date)"] },
    tooltip: {
      ...baseOption.tooltip, trigger: "axis", axisPointer: { type: "line", lineStyle: { color: C.axis } },
      formatter: (ps) => {
        const d = localIso(ps[0].axisValue);
        const p = byDate.get(d);
        const ev = points.filter((e) => e.x === d);
        const head = `<div style="font-family:${MONO};font-size:11px;color:${C.text3}">${day(d)}${!p && missing.includes(d) ? " · no price bar" : ""}</div>`;
        const line = p ? `<div><span style="display:inline-block;width:8px;height:2px;margin-right:6px;vertical-align:middle;background:${STRATEGY}"></span>${track.symbol}: <b>${pct(p.pct)}</b> · close $${p.close}</div>`
          + (p.benchmarkPct != null ? `<div><span style="display:inline-block;width:8px;height:2px;margin-right:6px;vertical-align:middle;background:${BENCH}"></span>${track.benchmarkSymbol}: <b>${pct(p.benchmarkPct)}</b></div>` : "") : "";
        const evs = ev.map((g) => `<div style="margin-top:4px;color:${C.text}">▲ ${g.purchases} purchase${g.purchases === 1 ? "" : "s"} on ${shortDay(g.date)}: ${g.insiders.slice(0, 3).join(", ")}${g.insiders.length > 3 ? " …" : ""}${g.priceBasis && g.priceBasis !== "same_day" ? ` <span style="color:${C.text3}">(vs close of ${shortDay(g.priceDate)})</span>` : ""}</div>`).join("");
        return head + line + evs;
      },
    },
    xAxis: { type: "time", ...axisCommon, splitLine: { show: false }, minInterval: 86_400_000, axisLabel: { ...axisCommon.axisLabel, formatter: (v) => shortDay(localIso(v)), hideOverlap: true } },
    yAxis: { type: "value", scale: true, ...axisCommon, axisLabel: { ...axisCommon.axisLabel, formatter: (v) => pct(v, 0) } },
    series: [
      {
        name: `${track.symbol} vs baseline`, type: "line", data: lineData(series, missing, "pct"), showSymbol: false, connectNulls: false,
        lineStyle: { width: 2, color: STRATEGY }, itemStyle: { color: STRATEGY },
        endLabel: { show: true, formatter: () => `${track.symbol} ${pct(last.pct, 1)}`, color: C.text, fontSize: 11 },
        markLine: {
          silent: true, symbol: "none",
          data: [
            { yAxis: 0, lineStyle: { color: C.text3, type: "solid", width: 1 }, label: { formatter: "0 % = baseline", position: "insideEndBottom", color: C.text3, fontSize: 10 } },
            ...markers.map((m) => ({ xAxis: m.date, lineStyle: { color: m.kind === "published" ? C.text2 : C.accent, type: "dashed", width: 1 },
              label: m.kind === "published" ? { formatter: `SEC ${m.cluster + 1}`, position: "end", color: C.text2, fontSize: 10 } : { show: false } })),
          ],
        },
        markArea: { silent: true, itemStyle: { color: "rgba(18,174,117,0.08)" }, label: { show: false }, data: spans.map((sp) => [{ xAxis: sp.from }, { xAxis: sp.to }]) },
      },
      ...(hasBench ? [{
        name: `${track.benchmarkSymbol} same period`, type: "line", data: lineData(series, missing, "benchmarkPct"), showSymbol: false, connectNulls: false,
        lineStyle: { width: 2, color: BENCH }, itemStyle: { color: BENCH },
        endLabel: { show: true, formatter: () => `${track.benchmarkSymbol} ${pct(last.benchmarkPct, 1)}`, color: C.text2, fontSize: 11 },
      }] : []),
      {
        name: "Insider purchase (trade date)", type: "scatter", symbol: "triangle", z: 5,
        symbolSize: (v, prm) => 10 + Math.min(6, (points[prm.dataIndex]?.purchases || 1) - 1) * 2,
        data: points.map((g) => ({ value: [g.x, g.y], itemStyle: { color: C.buy, borderColor: C.surface, borderWidth: 2 } })),
      },
    ],
  };
  return <EChart option={option} height={height} ariaLabel={`${track.symbol} change since the first insider purchase on ${track.baseline.date}, insider purchases marked on their transaction dates`} />;
}
