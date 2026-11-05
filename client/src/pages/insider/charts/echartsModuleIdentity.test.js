// Regression for the Overview crash:
//   Uncaught Error: Invalid data provider.  at DataStore.initData ← BarSeriesModel.getInitialData
//
// Root cause: two copies of ECharts in one page (Vite re-bundled deps at runtime
// while the lazy chart chunk was loading). Series data is wrapped in a SourceImpl
// from one copy and checked with `instanceof SourceImpl` by the other, so the raw
// Source object is treated as the provider and fails the getItem/count assert.
// Chart DATA cannot produce this error with a single ECharts copy — covered below.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as echarts from "echarts/core";
import { BarChart, LineChart, ScatterChart } from "echarts/charts";
import { GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, MarkLineComponent, MarkAreaComponent } from "echarts/components";
import { SVGRenderer } from "echarts/renderers";

echarts.use([BarChart, LineChart, ScatterChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, MarkLineComponent, MarkAreaComponent, SVGRenderer]);

const lib = (p, q = "") => new URL(`../../../../node_modules/echarts/lib/${p}`, import.meta.url).href + q;

test("reproduces the original crash: SourceImpl from a second ECharts copy → 'Invalid data provider.'", async () => {
  const { default: SeriesData } = await import(lib("data/SeriesData.js"));
  const same = await import(lib("data/Source.js"));
  const other = await import(lib("data/Source.js", "?second-copy")); // distinct module instance

  const ok = new SeriesData(["value"], null);
  assert.doesNotThrow(() => ok.initData(same.createSourceFromSeriesDataOption([1, 2, 3])));
  assert.equal(ok.count(), 3);

  const mixed = new SeriesData(["value"], null);
  assert.throws(() => mixed.initData(other.createSourceFromSeriesDataOption([1, 2, 3])), /Invalid data provider\./);
});

test("single ECharts copy: malformed series data never raises 'Invalid data provider.'", async () => {
  const { default: SeriesData } = await import(lib("data/SeriesData.js"));
  const { createSourceFromSeriesDataOption } = await import(lib("data/Source.js"));
  for (const data of [[], [NaN, null, undefined, "x", Infinity], [{ value: NaN }, { value: null }], {}, null, undefined]) {
    const sd = new SeriesData(["value"], null);
    assert.doesNotThrow(() => sd.initData(createSourceFromSeriesDataOption(data)), `data=${JSON.stringify(data)}`);
  }
});

// Same option shapes the Insider charts build (stacked mirrored bars + markLine +
// dataZoom, line with area, time/time scatter), fed with edge-case data.
function render(option) {
  const chart = echarts.init(null, null, { renderer: "svg", ssr: true, width: 600, height: 300 });
  try { chart.setOption(option); return chart.renderToSVGString(); } finally { chart.dispose(); }
}
const zero = { silent: true, symbol: "none", data: [{ yAxis: 0 }] };
const barOption = (cats, buys, sells) => ({
  animation: false,
  xAxis: { type: "category", data: cats }, yAxis: { type: "value" },
  dataZoom: cats.length > 30 ? [{ type: "inside", startValue: cats.length - 30, endValue: cats.length - 1 }, { type: "slider" }] : [],
  series: [
    { name: "Purchases", type: "bar", stack: "v", data: buys, markLine: zero },
    { name: "Sales", type: "bar", stack: "v", data: sells },
  ],
});

test("bar / line / scatter options with empty, NaN, null and malformed data render without throwing", () => {
  const cases = [
    barOption([], [], []),
    barOption(["Nov 1", "Nov 2"], [NaN, null], [undefined, -Infinity]),
    barOption(["Nov 1"], ["abc"], [{ value: NaN }]),
    barOption(Array.from({ length: 45 }, (_, i) => `D${i}`), Array.from({ length: 45 }, (_, i) => i), Array.from({ length: 45 }, () => -1)),
    { animation: false, xAxis: { type: "category", data: ["a", "b"] }, yAxis: { type: "value" }, series: [{ type: "line", data: [NaN, null], areaStyle: {} }] },
    { animation: false, xAxis: { type: "time" }, yAxis: { type: "time" }, series: [{ type: "scatter", data: [{ value: ["2026-10-30", "2026-11-02", null] }, { value: [null, "bad", NaN] }] }] },
    { animation: false, xAxis: { type: "value" }, yAxis: { type: "category", data: [] }, series: [{ type: "bar", data: [] }] },
  ];
  for (const opt of cases) assert.doesNotThrow(() => render(opt));
});

test("re-applying an option after an update (replaceMerge path used by EChart.jsx) does not throw", () => {
  const chart = echarts.init(null, null, { renderer: "svg", ssr: true, width: 600, height: 300 });
  try {
    chart.setOption(barOption(["Nov 1"], [5], [-3]));
    assert.doesNotThrow(() => chart.setOption(barOption([], [], []), { notMerge: false, replaceMerge: ["series", "xAxis", "yAxis", "dataZoom"] }));
    assert.doesNotThrow(() => chart.resize());
  } finally { chart.dispose(); }
});

test("vite.config pre-bundles ECharts and every runtime-discovered dep (prevents mid-session re-bundle)", async () => {
  const { default: config } = await import(new URL("../../../../vite.config.js", import.meta.url).href);
  const include = config.optimizeDeps?.include || [];
  for (const dep of ["echarts/core", "echarts/charts", "echarts/components", "echarts/renderers", "react/jsx-dev-runtime", "workbox-window", "workbox-core", "workbox-precaching"]) {
    assert.ok(include.includes(dep), `optimizeDeps.include is missing ${dep}`);
  }
});
