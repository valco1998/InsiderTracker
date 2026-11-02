// Minimal ECharts wrapper: modular imports (tree-shaken), one instance per
// mount, option updates merged, ResizeObserver resize, event handlers by name.
import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, LineChart, ScatterChart } from "echarts/charts";
import { GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, MarkLineComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([BarChart, LineChart, ScatterChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, MarkLineComponent, CanvasRenderer]);

// Validated (dataviz validator, dark, surface #10151f): CVD ΔE 10.3, both in band.
export const C = {
  buy: "#12ae75",
  sell: "#c4364a",
  accent: "#3b9eff",
  warn: "#e8b04b",
  text: "#e6ebf2",
  text2: "#a3adbd",
  text3: "#6b7686",
  grid: "rgba(148,163,184,0.09)",
  axis: "rgba(148,163,184,0.22)",
  surface: "#10151f",
  tooltip: "#151c28",
};

export const FONT = 'Inter, system-ui, -apple-system, sans-serif';
export const MONO = '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace';

export const baseOption = {
  animationDuration: 300,
  animationDurationUpdate: 300,
  textStyle: { fontFamily: FONT, color: C.text2, fontSize: 11 },
  tooltip: {
    backgroundColor: C.tooltip,
    borderColor: "rgba(148,163,184,0.24)",
    borderWidth: 1,
    padding: [8, 10],
    textStyle: { color: C.text, fontSize: 12, fontFamily: FONT },
    extraCssText: "border-radius:6px;box-shadow:0 8px 24px rgba(0,0,0,.45);",
    confine: true,
  },
};

export const axisCommon = {
  axisLine: { lineStyle: { color: C.axis } },
  axisTick: { show: false },
  axisLabel: { color: C.text3, fontSize: 10.5, fontFamily: MONO },
  splitLine: { lineStyle: { color: C.grid } },
};

export default function EChart({ option, onEvents, height = 260, ariaLabel }) {
  const el = useRef(null);
  const chart = useRef(null);
  const handlers = useRef(onEvents);
  handlers.current = onEvents;

  useEffect(() => {
    const inst = echarts.init(el.current, null, { renderer: "canvas" });
    chart.current = inst;
    const names = ["click", "datazoom"];
    names.forEach((n) => inst.on(n, (p) => handlers.current?.[n]?.(p, inst)));
    const ro = new ResizeObserver(() => inst.resize());
    ro.observe(el.current);
    return () => { ro.disconnect(); inst.dispose(); chart.current = null; };
  }, []);

  useEffect(() => {
    chart.current?.setOption(option, { notMerge: false, replaceMerge: ["series", "xAxis", "yAxis", "dataZoom"] });
  }, [option]);

  return <div ref={el} role="img" aria-label={ariaLabel} style={{ width: "100%", height }} />;
}
