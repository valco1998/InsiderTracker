// Minimal ECharts wrapper: modular imports (tree-shaken), one instance per
// mount, option updates merged, ResizeObserver resize, event handlers by name.
//
// THEMES: chart code builds options from the stable palette keys in `C` (unchanged
// literals). At setOption time this wrapper maps every palette literal — including
// colours inside strings returned by formatter functions — to the active theme's
// validated colours (dataviz validator: light on #FFFFFF, dark on #111827; CVD ΔE ≥ 8),
// and re-applies the option when the theme changes. Chart data logic is untouched.
import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, LineChart, ScatterChart } from "echarts/charts";
import { GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, MarkLineComponent, MarkAreaComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { useTheme } from "../theme";

echarts.use([BarChart, LineChart, ScatterChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, MarkLineComponent, MarkAreaComponent, CanvasRenderer]);

// Palette KEYS used by chart code (do not change — they are mapped per theme below).
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

// key literal → [light, dark]
const MAP = [
  ["#12ae75", "#059669", "#10AD7A"],              // purchases / positive
  ["#c4364a", "#DC2626", "#C81E45"],              // sales / negative
  ["#3b9eff", "#2563EB", "#60A5FA"],              // accent
  ["#e8b04b", "#D97706", "#FBBF24"],              // warning
  ["#e6ebf2", "#0F172A", "#F8FAFC"],              // text
  ["#a3adbd", "#475569", "#CBD5E1"],              // text 2
  ["#6b7686", "#64748B", "#94A3B8"],              // text 3
  ["#10151f", "#FFFFFF", "#111827"],              // surface
  ["#151c28", "#FFFFFF", "#1E293B"],              // tooltip
  ["#3987e5", "#2563EB", "#4A8FE7"],              // strategy / stock line
  ["#d95926", "#C2410C", "#E2622A"],              // benchmark line
  ["rgba(148,163,184,0.09)", "rgba(15,23,42,0.06)", "rgba(148,163,184,0.10)"],   // grid
  ["rgba(148,163,184,0.22)", "rgba(15,23,42,0.16)", "rgba(148,163,184,0.24)"],   // axis
  ["rgba(148,163,184,0.24)", "#E2E8F0", "#334155"],                              // tooltip border
  ["rgba(148,163,184,0.06)", "rgba(15,23,42,0.04)", "rgba(148,163,184,0.07)"],   // shadows / slider bg
  ["rgba(148,163,184,.15)", "#E2E8F0", "rgba(148,163,184,.18)"],                  // tooltip divider
  ["rgba(59,158,255,0.14)", "rgba(37,99,235,0.12)", "rgba(96,165,250,0.16)"],    // slider fill
  ["rgba(18,174,117,0.22)", "rgba(5,150,105,0.16)", "rgba(16,173,122,0.22)"],    // area top
  ["rgba(18,174,117,0.08)", "rgba(5,150,105,0.07)", "rgba(16,173,122,0.09)"],    // mark area
  ["rgba(18,174,117,0)", "rgba(5,150,105,0)", "rgba(16,173,122,0)"],             // area bottom
  ["rgba(0,0,0,.45)", "rgba(15,23,42,.12)", "rgba(0,0,0,.5)"],                   // tooltip shadow
];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const RE = new RegExp(MAP.map(([k]) => esc(k)).join("|"), "gi");
const LOOKUP = new Map(MAP.map(([k, l, d]) => [k.toLowerCase(), { light: l, dark: d }]));

export function themeString(s, theme) {
  return typeof s === "string" ? s.replace(RE, (m) => LOOKUP.get(m.toLowerCase())?.[theme] ?? m) : s;
}
// Deep copy of an option with every palette literal mapped; functions wrapped so
// formatter / colour callbacks return themed strings too.
export function themeOption(v, theme) {
  if (typeof v === "string") return themeString(v, theme);
  if (typeof v === "function") return function themed(...a) { return themeOption(v.apply(this, a), theme); };
  if (Array.isArray(v)) return v.map((x) => themeOption(x, theme));
  if (v && typeof v === "object" && !(v instanceof Date) && !(v instanceof RegExp)) {
    const o = {};
    for (const k of Object.keys(v)) o[k] = themeOption(v[k], theme);
    return o;
  }
  return v;
}

export const FONT = 'Inter, system-ui, -apple-system, sans-serif';
export const MONO = 'Inter, system-ui, -apple-system, sans-serif'; // tabular figures via Inter (fintech style)

export const baseOption = {
  animationDuration: 300,
  animationDurationUpdate: 300,
  textStyle: { fontFamily: FONT, color: C.text2, fontSize: 11.5 },
  tooltip: {
    backgroundColor: C.tooltip,
    borderColor: "rgba(148,163,184,0.24)",
    borderWidth: 1,
    padding: [10, 12],
    textStyle: { color: C.text, fontSize: 12.5, fontFamily: FONT },
    extraCssText: "border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.45);font-variant-numeric:tabular-nums;",
    confine: true,
  },
};

export const axisCommon = {
  axisLine: { lineStyle: { color: C.axis } },
  axisTick: { show: false },
  axisLabel: { color: C.text3, fontSize: 11, fontFamily: MONO },
  splitLine: { lineStyle: { color: C.grid } },
};

export default function EChart({ option, onEvents, height = 260, ariaLabel }) {
  const el = useRef(null);
  const chart = useRef(null);
  const handlers = useRef(onEvents);
  handlers.current = onEvents;
  const [theme] = useTheme();
  const appliedTheme = useRef(theme);

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
    if (!chart.current || !option) return;
    const themeChanged = appliedTheme.current !== theme;
    appliedTheme.current = theme;
    chart.current.setOption(themeOption(option, theme), themeChanged ? { notMerge: true } : { notMerge: false, replaceMerge: ["series", "xAxis", "yAxis", "dataZoom"] });
  }, [option, theme]);

  return <div ref={el} role="img" aria-label={ariaLabel} style={{ width: "100%", height }} />;
}
