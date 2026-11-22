import "./style.css";
import {
  init,
  registerIndicator,
  getSupportedOverlays,
  type Chart,
  type KLineData,
  type DataLoader,
} from "klinecharts";
import {
  fetchBars,
  reloadBars,
  computeIndicators,
  listIndicators,
  listSymbols,
  runBacktest,
  subscribeRealtime,
} from "./api";
import type {
  Bar,
  BacktestConfig,
  BacktestResult,
  Direction,
  IndicatorRequest,
  Signal,
  Timeframe,
} from "./types";
import { ScriptHost } from "./scripts/script-host";

// 每个 Rust 指标的展示元数据：线数、颜色、画在哪个窗格。
// figures 的数量和顺序必须与 Rust 侧 compute() 返回的 lines 一一对应。
type FigureType = "line" | "bar";
interface FigureDef {
  title: string;
  color: string;
  type?: FigureType;
}
interface IndicatorMeta {
  label: string;
  params: number[];
  series: "price" | "volume" | "normal";
  figures: FigureDef[];
}

const indicatorMeta: Record<string, IndicatorMeta> = {
  sma: {
    label: "SMA(20)", params: [20], series: "price",
    figures: [{ title: "SMA20", color: "#e67e22" }],
  },
  ema: {
    label: "EMA(20)", params: [20], series: "price",
    figures: [{ title: "EMA20", color: "#2980b9" }],
  },
  rsi: {
    label: "RSI(14)", params: [14], series: "normal",
    figures: [{ title: "RSI14", color: "#8e44ad" }],
  },
  macd: {
    label: "MACD(12,26,9)", params: [12, 26, 9], series: "normal",
    figures: [
      { title: "DIF", color: "#e67e22" },
      { title: "DEA", color: "#2980b9" },
      { title: "MACD", color: "#c0392b", type: "bar" },
    ],
  },
  boll: {
    label: "BOLL(20,2)", params: [20, 2], series: "price",
    figures: [
      { title: "UPPER", color: "#95a5a6" },
      { title: "MID", color: "#e67e22" },
      { title: "LOWER", color: "#95a5a6" },
    ],
  },
  atr: {
    label: "ATR(14)", params: [14], series: "normal",
    figures: [{ title: "ATR14", color: "#27ae60" }],
  },
  kdj: {
    label: "KDJ(9)", params: [9], series: "normal",
    figures: [
      { title: "K", color: "#e67e22" },
      { title: "D", color: "#2980b9" },
      { title: "J", color: "#8e44ad" },
    ],
  },
  vwap: {
    label: "VWAP", params: [], series: "price",
    figures: [{ title: "VWAP", color: "#8e44ad" }],
  },
  volume_ma: {
    label: "VOL MA(20)", params: [20], series: "volume",
    figures: [{ title: "VOLMA20", color: "#e67e22" }],
  },
  obv: {
    label: "OBV", params: [], series: "normal",
    figures: [{ title: "OBV", color: "#2980b9" }],
  },
};

// 自定义指标的计算结果：每条 figure 一个字段（line0/line1/...）。
type FigureValues = Record<string, number | null>;

const app = document.querySelector<HTMLDivElement>("#app")!;

app.innerHTML = `
  <header class="topbar">
    <div class="brand"><span class="brand-mark">◇</span> CandleLab <span class="brand-tag">Rust core</span></div>
    <div class="toolbar">
      <select id="symbol-select" class="control" aria-label="交易对"></select>
      <div class="tf-group" id="tf-group">
        <button class="tf" data-tf="1m">1分</button>
        <button class="tf" data-tf="5m">5分</button>
        <button class="tf" data-tf="15m">15分</button>
        <button class="tf active" data-tf="1h">1时</button>
        <button class="tf" data-tf="4h">4时</button>
        <button class="tf" data-tf="1d">日线</button>
      </div>
      <button id="refresh-btn" class="control btn">刷新</button>
      <button id="realtime-btn" class="control btn">实时:关</button>
      <button id="script-toggle" class="control btn">脚本</button>
      <span id="status" class="status">就绪</span>
    </div>
  </header>
  <main class="layout">
    <aside class="sidebar">
      <div class="panel-title">自选品种</div>
      <div id="symbol-list" class="symbol-list"></div>
      <div class="panel-title" style="margin-top:16px">Rust 指标</div>
      <div id="indicator-list" class="indicator-list"></div>
      <div class="panel-title" style="margin-top:16px">策略回测</div>
      <div class="backtest-box">
        <div class="bt-strategy">双均线交叉 <span class="bt-sub">MA5 × MA20</span></div>
        <button id="bt-run" class="bt-run">运行回测</button>
        <div id="bt-result" class="bt-result">尚未运行</div>
      </div>
      <div class="panel-title" style="margin-top:16px">绘图工具</div>
      <div id="drawing-list" class="drawing-list"></div>
      <button id="clear-drawings" class="control btn" style="width:100%;margin-top:6px">清除绘图</button>
      <div class="hint">指标与回测均由 Rust 核心计算<br/>经 Tauri IPC 传给图表</div>
    </aside>
    <section class="chart-area">
      <div class="replay-bar">
        <button id="replay-toggle" class="control btn">▶ 回放</button>
        <input id="replay-slider" type="range" min="0" max="100" value="100" />
        <span id="replay-label" class="replay-label">实时</span>
        <select id="replay-speed" class="control" aria-label="回放速度">
          <option value="1">1×</option>
          <option value="2">2×</option>
          <option value="4">4×</option>
        </select>
      </div>
      <div id="chart" class="chart"></div>
    </section>
  </main>
  <section id="script-panel" class="script-panel">
    <div class="sp-header">
      <span class="sp-title">脚本编辑器 <span class="sp-sub">JavaScript · 隔离沙箱 · 3s 超时</span></span>
      <div class="sp-actions">
        <button id="sp-run" class="sp-btn primary">运行脚本</button>
        <button id="sp-close" class="sp-btn">收起</button>
      </div>
    </div>
    <div class="sp-body">
      <div class="sp-editor-wrap">
        <textarea id="sp-code" class="sp-code" spellcheck="false"></textarea>
        <div class="sp-examples">
          <button class="sp-example" data-ex="ma">均线</button>
          <button class="sp-example" data-ex="rsi">RSI</button>
          <button class="sp-example" data-ex="strategy">策略</button>
        </div>
      </div>
      <div class="sp-output">
        <div class="sp-out-title">输出</div>
        <pre id="sp-log" class="sp-log">就绪。选择示例或编写脚本后点击「运行脚本」。</pre>
      </div>
    </div>
  </section>
`;

const statusEl = document.querySelector<HTMLSpanElement>("#status")!;
const symbolSelect = document.querySelector<HTMLSelectElement>("#symbol-select")!;
const symbolListEl = document.querySelector<HTMLDivElement>("#symbol-list")!;
const indicatorListEl = document.querySelector<HTMLDivElement>("#indicator-list")!;
const chartEl = document.querySelector<HTMLDivElement>("#chart")!;

let currentSymbol = "BTCUSDT";
let currentTimeframe: Timeframe = "1h";
let chart: Chart | null = null;
let currentBars: Bar[] = [];
let supportedIndicators: string[] = [];
const activeIndicators = new Map<string, IndicatorRequest>();
const createdIndicators = new Set<string>();

// 回放状态：-1 表示不回放（显示全部），否则为显示的 bar 数量。
let replayCount = -1;
let replayTimer: ReturnType<typeof setInterval> | null = null;
let realtimeOn = false;
// KLineChart 通过 DataLoader.subscribeBar 注册的实时更新回调。
let realtimeBarCallback: ((data: KLineData) => void) | null = null;

function setStatus(text: string, kind: "ok" | "err" | "busy" = "ok") {
  statusEl.textContent = text;
  statusEl.dataset.kind = kind;
}

// 注册所有自定义指标。calc 从 bar 的扩展字段（rust_<kind>_<index>）读 Rust 算好的值。
function registerRustIndicators() {
  for (const [kind, meta] of Object.entries(indicatorMeta)) {
    registerIndicator<FigureValues>({
      name: `rust_${kind}`,
      shortName: meta.label,
      series: meta.series,
      calcParams: [],
      figures: meta.figures.map((f, i) => ({
        key: `line${i}`,
        title: f.title,
        type: f.type ?? "line",
        baseValue: f.type === "bar" ? 0 : undefined,
        styles: () => ({ color: f.color }),
      })),
      calc: (dataList) =>
        dataList.map((bar) => {
          const row: FigureValues = {};
          meta.figures.forEach((_, i) => {
            const v = bar[`rust_${kind}_${i}`];
            row[`line${i}`] = typeof v === "number" ? v : null;
          });
          return row;
        }),
    });
  }
}

function toKLine(bars: Bar[]): KLineData[] {
  return bars.map((b) => {
    const k: KLineData = {
      timestamp: b.time,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume,
    };
    // 把 Rust 指标值作为扩展字段带上，供自定义指标的 calc 读取。
    for (const key of Object.keys(b)) {
      if (key.startsWith("rust_")) k[key] = b[key];
    }
    return k;
  });
}

// 重新计算所有活跃指标，把每条线的值写进 bar 的扩展字段。
async function enrichBarsWithIndicators() {
  for (const bar of currentBars) {
    for (const key of Object.keys(bar)) {
      if (key.startsWith("rust_")) delete bar[key];
    }
  }
  const requests = Array.from(activeIndicators.values());
  if (requests.length === 0 || currentBars.length === 0) return;

  const results = await computeIndicators(currentSymbol, currentTimeframe, requests);
  results.forEach((result, ri) => {
    const kind = requests[ri]?.kind;
    if (!kind) return;
    result.lines.forEach((line, li) => {
      const key = `rust_${kind}_${li}`;
      for (let i = 0; i < currentBars.length; i++) {
        currentBars[i][key] = line.values[i] ?? null;
      }
    });
  });
}

// 确保活跃指标在图表上有对应的实例（首次创建，之后复用）。
function syncIndicatorInstances() {
  if (!chart) return;
  for (const kind of activeIndicators.keys()) {
    const name = `rust_${kind}`;
    if (createdIndicators.has(name)) continue;
    const id = chart.createIndicator(name);
    if (id) createdIndicators.add(name);
  }
}

function makeDataLoader(): DataLoader {
  return {
    getBars: async ({ callback }) => {
      try {
        setStatus("加载数据中…", "busy");
        const bars = await fetchBars(currentSymbol, currentTimeframe, 1000);
        currentBars = bars;
        await enrichBarsWithIndicators();
        // 回放时只显示前 replayCount 根，否则全部。
        const display = replayCount >= 0 && replayCount < currentBars.length
          ? currentBars.slice(0, replayCount)
          : currentBars;
        callback(toKLine(display));
        // 数据就绪后再创建指标实例，calc 能立刻拿到扩展字段里的值。
        syncIndicatorInstances();
        const suffix = replayCount >= 0 ? ` · 回放 ${display.length}/${bars.length}` : "";
        setStatus(`${currentSymbol} · ${bars.length} 根 K 线${suffix}`);
      } catch (e) {
        setStatus(`加载失败: ${String(e)}`, "err");
        callback([]);
      }
    },
    // KLineChart 订阅实时 bar：收到推送时直接回调，图表只更新最后一根，不重置视窗。
    subscribeBar: ({ callback }) => { realtimeBarCallback = callback; },
    unsubscribeBar: () => { realtimeBarCallback = null; },
  };
}

function renderIndicatorList() {
  indicatorListEl.innerHTML = "";
  for (const kind of supportedIndicators) {
    const label = indicatorMeta[kind]?.label ?? kind;
    const btn = document.createElement("button");
    btn.className = "indicator-btn";
    btn.textContent = label;
    btn.dataset.kind = kind;
    btn.title = `由 Rust 计算 ${label}`;
    btn.addEventListener("click", () => toggleIndicator(kind, btn));
    indicatorListEl.appendChild(btn);
  }
  for (const kind of activeIndicators.keys()) {
    const btn = indicatorListEl.querySelector<HTMLButtonElement>(
      `[data-kind="${kind}"]`,
    );
    if (btn) btn.classList.add("active");
  }
}

function toggleIndicator(kind: string, btn: HTMLButtonElement) {
  const name = `rust_${kind}`;
  if (activeIndicators.has(kind)) {
    activeIndicators.delete(kind);
    chart?.removeIndicator({ name });
    createdIndicators.delete(name);
    btn.classList.remove("active");
  } else {
    activeIndicators.set(kind, {
      kind,
      params: indicatorMeta[kind]?.params ?? [],
    });
    btn.classList.add("active");
  }
  // 重新走一次数据管线：Rust 重算 → 写入扩展字段 → 图表重绘。
  if (chart) chart.setDataLoader(makeDataLoader());
}

// ---- 脚本沙箱 ----

const scriptHost = new ScriptHost();
const scriptExamples: Record<string, string> = {
  ma: `indicator('双均线', { overlay: true });
const fast = ta.sma(close, 5);
const slow = ta.sma(close, 20);
plot(fast, { title: 'MA5', color: '#e67e22' });
plot(slow, { title: 'MA20', color: '#2980b9' });
marker(crossAbove(fast, slow), { shape: 'arrowUp', position: 'belowBar', color: '#d32f2f', text: '金叉' });
log('快线末值', fast[n-1]);`,
  rsi: `indicator('RSI 教学', { overlay: false, precision: 2 });
const r = ta.rsi(close, 14);
plot(r, { title: 'RSI14', color: '#8e44ad' });
hline(70, { color: '#d32f2f' });
hline(30, { color: '#1e9e6a' });
log('当前 RSI', r[n-1]);`,
  strategy: `strategy('均线交叉策略', { overlay: true });
const fast = ta.sma(close, 5);
const slow = ta.sma(close, 20);
strategy.entry('多', 'long', crossAbove(fast, slow));
strategy.entry('空', 'short', crossBelow(fast, slow));
strategy.exit({ stopLoss: 2, takeProfit: 6 });
plot(fast, { title: 'MA5', color: '#e67e22' });
plot(slow, { title: 'MA20', color: '#2980b9' });`,
};

const scriptPlotNames: string[] = [];
const MAX_SCRIPT_PLOTS = 6;

function registerScriptPlotIndicator() {
  for (let i = 0; i < MAX_SCRIPT_PLOTS; i++) {
    registerIndicator<FigureValues>({
      name: `rust_script_plot_${i}`,
      shortName: `脚本线${i + 1}`,
      series: "price",
      calcParams: [],
      figures: [{ key: "v", title: `脚本${i + 1}`, type: "line" }],
      calc: (dataList) =>
        dataList.map((bar) => {
          const raw = bar[`sp_${i}`];
          return { v: typeof raw === "number" && Number.isFinite(raw) ? raw : null };
        }),
    });
  }
}

function clearScriptPlots() {
  if (!chart) return;
  for (let i = 0; i < MAX_SCRIPT_PLOTS; i++) {
    chart.removeIndicator({ name: `rust_script_plot_${i}` });
    createdIndicators.delete(`rust_script_plot_${i}`);
  }
  scriptPlotNames.length = 0;
}

function drawScriptPlots(values: { color: string; title?: string; data: Float64Array }[]) {
  if (!chart) return;
  clearScriptPlots();
  const selected = values.slice(0, MAX_SCRIPT_PLOTS);
  selected.forEach((plot, i) => {
    // 把值挂到当前 K 线的扩展字段，供自定义指标的 calc 读取。
    for (let k = 0; k < currentBars.length; k++) {
      const v = plot.data[k];
      currentBars[k][`sp_${i}`] = Number.isFinite(v) ? v : null;
    }
    const title = plot.title || `脚本${i + 1}`;
    scriptPlotNames[i] = title;
    const id = chart!.createIndicator({
      name: `rust_script_plot_${i}`,
      shortName: title,
      styles: { lines: [{ color: plot.color }] },
    } as never);
    if (id) createdIndicators.add(`rust_script_plot_${i}`);
  });
  // 重新喂数据触发 calc
  chart.setDataLoader(makeDataLoader());
}

function showScriptPanel(show: boolean) {
  document.querySelector<HTMLElement>("#script-panel")!.classList.toggle("open", show);
}

async function onRunScript() {
  const code = document.querySelector<HTMLTextAreaElement>("#sp-code")!.value;
  const logEl = document.querySelector<HTMLPreElement>("#sp-log")!;
  const btn = document.querySelector<HTMLButtonElement>("#sp-run")!;
  if (currentBars.length === 0) {
    logEl.textContent = "请先等待 K 线加载";
    return;
  }
  btn.disabled = true;
  logEl.textContent = "运行中…";
  try {
    const tfSec = timeframeSeconds(currentTimeframe);
    const out = await scriptHost.run(code, currentBars, { symbol: currentSymbol, tfSec });
    if (!out.ok) {
      logEl.textContent = `✗ 错误${out.line ? `（第 ${out.line} 行）` : ""}:\n${out.error}\n\n日志:\n${out.logs.join("\n")}`;
      setStatus(`脚本错误: ${out.error}`, "err");
      return;
    }
    // 渲染 plot 线
    const plots = out.plots.map((p) => ({ color: p.color, title: p.title, data: p.values }));
    drawScriptPlots(plots);
    // 输出日志
    const lines: string[] = [`✓ 运行成功 (${out.ms}ms, ${out.plots.length} 条线)`];
    if (out.meta) lines.push(`脚本: ${out.meta.name}`);
    if (out.logs.length) lines.push("", "日志:", ...out.logs);
    if (out.signals.length) lines.push("", `策略信号: ${out.signals.map((s) => s.id).join(", ")}`);
    logEl.textContent = lines.join("\n");
    setStatus(`脚本运行成功 · ${out.plots.length} 条线`);

    // 策略脚本：把信号交给 Rust 回测引擎执行
    if (out.meta?.strategy && out.signals.length > 0) {
      const cfg: BacktestConfig = { ...defaultBacktestConfig };
      const { signals, closeSignals } = ScriptHost.signalsToBacktest(out, currentBars.length, cfg);
      const result = await runBacktest(currentSymbol, currentTimeframe, cfg, signals, closeSignals);
      renderBacktestResult(result);
      lines.push("", "=== Rust 回测结果 ===",
        `净利润 ${result.stats.net_profit.toFixed(2)} (${result.stats.net_profit_pct.toFixed(2)}%)`,
        `交易 ${result.stats.trades} 笔 · 胜率 ${result.stats.win_rate.toFixed(1)}%`,
        `最大回撤 ${result.max_drawdown_pct.toFixed(2)}%`);
      logEl.textContent = lines.join("\n");
    }
  } catch (e) {
    logEl.textContent = `✗ 异常: ${String(e)}`;
    setStatus(`脚本异常: ${String(e)}`, "err");
  } finally {
    btn.disabled = false;
  }
}

function timeframeSeconds(tf: Timeframe): number {
  const map: Record<Timeframe, number> = {
    "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400,
  };
  return map[tf];
}

// ---- 绘图工具 ----

const DRAWING_LABELS: Record<string, string> = {
  horizontalLine: "水平线", trendLine: "趋势线", segment: "线段", arrow: "箭头",
  text: "文字", rect: "矩形", circle: "圆形", triangle: "三角形",
  fibonacci: "斐波那契", fibonacciSegment: "斐波那契段", parallel: "平行线",
  channel: "通道", brush: "画笔", priceLine: "价格线", timeLine: "时间线",
  raster: "图片",
};

function renderDrawingTools() {
  const list = document.querySelector<HTMLDivElement>("#drawing-list")!;
  list.innerHTML = "";
  const overlays = getSupportedOverlays();
  for (const name of overlays) {
    const btn = document.createElement("button");
    btn.className = "drawing-btn";
    btn.textContent = DRAWING_LABELS[name] || name;
    btn.dataset.name = name;
    btn.title = name;
    btn.addEventListener("click", () => {
      if (!chart) return;
      chart.createOverlay(name);
      setStatus(`已选择工具：${DRAWING_LABELS[name] || name}，在图表上拖拽绘制`);
    });
    list.appendChild(btn);
  }
}

// ---- 历史回放 ----

function stopReplay() {
  if (replayTimer) { clearInterval(replayTimer); replayTimer = null; }
  const toggle = document.querySelector<HTMLButtonElement>("#replay-toggle");
  if (toggle) { toggle.textContent = "▶ 回放"; toggle.classList.remove("active"); }
}

function startReplay() {
  if (currentBars.length === 0) { setStatus("请先等待 K 线加载", "err"); return; }
  if (replayCount < 0 || replayCount >= currentBars.length) replayCount = Math.max(20, Math.floor(currentBars.length / 3));
  const toggle = document.querySelector<HTMLButtonElement>("#replay-toggle")!;
  toggle.textContent = "❚❚ 暂停";
  toggle.classList.add("active");
  const speed = Number(document.querySelector<HTMLSelectElement>("#replay-speed")!.value) || 1;
  replayTimer = setInterval(() => {
    replayCount += speed;
    if (replayCount >= currentBars.length) {
      replayCount = -1;
      stopReplay();
      updateReplayUI();
      chart?.setDataLoader(makeDataLoader());
      setStatus("回放结束 · 显示全部");
      return;
    }
    updateReplayUI();
    chart?.setDataLoader(makeDataLoader());
  }, 200);
  chart?.setDataLoader(makeDataLoader());
}

function updateReplayUI() {
  const slider = document.querySelector<HTMLInputElement>("#replay-slider")!;
  const label = document.querySelector<HTMLSpanElement>("#replay-label")!;
  const total = currentBars.length || 1;
  const shown = replayCount < 0 ? total : replayCount;
  slider.value = String(Math.round(shown / total * 100));
  label.textContent = replayCount < 0 ? "实时" : `${shown}/${total}`;
}

// ---- 实时订阅 ----

async function toggleRealtime() {
  const btn = document.querySelector<HTMLButtonElement>("#realtime-btn")!;
  if (realtimeOn) {
    realtimeOn = false;
    btn.textContent = "实时:关";
    btn.classList.remove("active");
    setStatus("已关闭实时推送");
    return;
  }
  if (currentBars.length === 0) { setStatus("请先等待 K 线加载", "err"); return; }
  setStatus("连接实时数据…", "busy");
  try {
    await subscribeRealtime(currentSymbol, currentTimeframe, (bar) => {
      // 更新最后一根 K 线（实时推送的是当前正在形成的 bar）。
      if (currentBars.length === 0) return;
      const last = currentBars[currentBars.length - 1];
      if (bar.time === last.time) {
        currentBars[currentBars.length - 1] = bar;
      } else if (bar.time > last.time) {
        currentBars.push(bar);
        if (currentBars.length > 1000) currentBars.shift();
      }
      // 优先用图表原生订阅回调：只更新最后一根 bar，保留缩放和平移位置。
      if (realtimeBarCallback && replayCount < 0) {
        realtimeBarCallback(toKLine([bar])[0]);
      }
    });
    realtimeOn = true;
    btn.textContent = "实时:开";
    btn.classList.add("active");
    setStatus("实时推送已连接");
  } catch (e) {
    setStatus(`实时连接失败: ${String(e)}`, "err");
  }
}

// ---- 策略回测：内置双均线交叉示例 ----

function smaSeries(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i + 1 >= period) out[i] = sum / period;
  }
  return out;
}

function makeMaCrossSignals(bars: Bar[]): Signal[] {
  const closes = bars.map((b) => b.close);
  const fast = smaSeries(closes, 5);
  const slow = smaSeries(closes, 20);
  const longWhen: boolean[] = new Array(bars.length).fill(false);
  const shortWhen: boolean[] = new Array(bars.length).fill(false);
  for (let i = 1; i < bars.length; i++) {
    const pf = fast[i - 1], ps = slow[i - 1], f = fast[i], s = slow[i];
    if (pf == null || ps == null || f == null || s == null) continue;
    if (pf <= ps && f > s) longWhen[i] = true;   // 金叉做多
    if (pf >= ps && f < s) shortWhen[i] = true;  // 死叉做空
  }
  return [
    { id: "MA金叉", dir: "long" as Direction, when: longWhen },
    { id: "MA死叉", dir: "short" as Direction, when: shortWhen },
  ];
}

const defaultBacktestConfig: BacktestConfig = {
  initial_capital: 10_000,
  size_type: "percent",
  size_value: 95,
  commission: 0.02,
  slippage: 0.01,
  pyramiding: 1,
  fill_on: "open",
  stop_loss: 3,
  take_profit: 9,
  trailing: 0,
};

async function onRunBacktest() {
  const btn = document.querySelector<HTMLButtonElement>("#bt-run")!;
  const resultEl = document.querySelector<HTMLDivElement>("#bt-result")!;
  if (currentBars.length === 0) {
    resultEl.textContent = "请先等待 K 线加载";
    return;
  }
  btn.disabled = true;
  resultEl.textContent = "计算中…";
  try {
    const signals = makeMaCrossSignals(currentBars);
    const result = await runBacktest(
      currentSymbol,
      currentTimeframe,
      defaultBacktestConfig,
      signals,
      [],
    );
    renderBacktestResult(result);
    drawBacktestMarkers(result);
    setStatus(`回测完成 · ${result.stats.trades} 笔交易`);
  } catch (e) {
    resultEl.textContent = `回测失败: ${String(e)}`;
    setStatus(`回测失败: ${String(e)}`, "err");
  } finally {
    btn.disabled = false;
  }
}

function renderBacktestResult(r: BacktestResult) {
  const el = document.querySelector<HTMLDivElement>("#bt-result")!;
  const s = r.stats;
  const pnlClass = s.net_profit >= 0 ? "bt-pos" : "bt-neg";
  el.innerHTML = `
    <div class="bt-row"><span>净利润</span><b class="${pnlClass}">${s.net_profit.toFixed(2)} (${s.net_profit_pct.toFixed(2)}%)</b></div>
    <div class="bt-row"><span>交易 / 胜率</span><b>${s.trades} / ${s.win_rate.toFixed(1)}%</b></div>
    <div class="bt-row"><span>最大回撤</span><b>${r.max_drawdown_pct.toFixed(2)}%</b></div>
    <div class="bt-row"><span>夏普</span><b>${r.sharpe?.toFixed(2) ?? "—"}</b></div>
    <div class="bt-row"><span>最终权益</span><b>${r.final_equity.toFixed(2)}</b></div>
  `;
}

function drawBacktestMarkers(r: BacktestResult) {
  if (!chart) return;
  // 用 SVG overlay 在图上画买卖箭头：通过 KLineChart 的 overlay 插件较复杂，
  // 这里用轻量方案——把每个 marker 的价格和时间写到窗口变量，供自定义 overlay 读取。
  // MVP 阶段先在状态栏提示，箭头绘制在阶段 4 的绘图工具里统一接入。
  (window as unknown as Record<string, unknown>).__candlelabBacktestMarkers = r.markers;
}

function renderSymbolList(symbols: string[]) {
  symbolSelect.innerHTML = "";
  symbolListEl.innerHTML = "";
  for (const sym of symbols) {
    const opt = document.createElement("option");
    opt.value = sym;
    opt.textContent = sym.replace("USDT", "/USDT");
    symbolSelect.appendChild(opt);

    const item = document.createElement("button");
    item.className = "symbol-item";
    item.textContent = sym.replace("USDT", "/USDT");
    item.dataset.symbol = sym;
    item.addEventListener("click", () => switchSymbol(sym));
    symbolListEl.appendChild(item);
  }
  symbolSelect.value = currentSymbol;
  highlightSymbol();
}

function highlightSymbol() {
  symbolListEl.querySelectorAll<HTMLButtonElement>(".symbol-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.symbol === currentSymbol);
  });
}

async function switchSymbol(symbol: string) {
  currentSymbol = symbol;
  symbolSelect.value = symbol;
  highlightSymbol();
  if (chart) {
    chart.setSymbol({ ticker: symbol, pricePrecision: 2, volumePrecision: 3 });
    chart.setDataLoader(makeDataLoader());
  }
  setStatus(`切换至 ${symbol}…`, "busy");
}

async function loadSymbols() {
  try {
    const symbols = await listSymbols();
    renderSymbolList(symbols);
    supportedIndicators = await listIndicators();
    renderIndicatorList();
  } catch (e) {
    setStatus(`初始化失败: ${String(e)}`, "err");
  }
}

function bindEvents() {
  document.querySelectorAll<HTMLButtonElement>(".tf").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tf").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentTimeframe = btn.dataset.tf as Timeframe;
      if (chart) {
        chart.setPeriod(periodOf(currentTimeframe));
        chart.setDataLoader(makeDataLoader());
      }
    });
  });

  symbolSelect.addEventListener("change", () => {
    void switchSymbol(symbolSelect.value);
  });

  document.querySelector<HTMLButtonElement>("#bt-run")!.addEventListener("click", () => {
    void onRunBacktest();
  });

  // 绘图工具
  document.querySelector<HTMLButtonElement>("#clear-drawings")!.addEventListener("click", () => {
    chart?.removeOverlay();
    setStatus("已清除所有绘图");
  });

  // 回放
  document.querySelector<HTMLButtonElement>("#replay-toggle")!.addEventListener("click", () => {
    if (replayTimer) stopReplay(); else startReplay();
  });
  document.querySelector<HTMLInputElement>("#replay-slider")!.addEventListener("input", (e) => {
    stopReplay();
    const pct = Number((e.target as HTMLInputElement).value);
    const total = currentBars.length;
    if (total === 0) return;
    replayCount = pct >= 100 ? -1 : Math.max(1, Math.round(total * pct / 100));
    updateReplayUI();
    chart?.setDataLoader(makeDataLoader());
  });

  // 实时
  document.querySelector<HTMLButtonElement>("#realtime-btn")!.addEventListener("click", () => {
    void toggleRealtime();
  });

  // 脚本面板
  document.querySelector<HTMLButtonElement>("#script-toggle")!.addEventListener("click", () => {
    showScriptPanel(true);
  });
  document.querySelector<HTMLButtonElement>("#sp-close")!.addEventListener("click", () => {
    showScriptPanel(false);
  });
  document.querySelector<HTMLButtonElement>("#sp-run")!.addEventListener("click", () => {
    void onRunScript();
  });
  document.querySelectorAll<HTMLButtonElement>(".sp-example").forEach((btn) => {
    btn.addEventListener("click", () => {
      const ex = btn.dataset.ex || "ma";
      document.querySelector<HTMLTextAreaElement>("#sp-code")!.value = scriptExamples[ex] || "";
    });
  });

  document.querySelector<HTMLButtonElement>("#refresh-btn")!.addEventListener("click", async () => {
    try {
      setStatus("刷新数据…", "busy");
      const bars = await reloadBars(currentSymbol, currentTimeframe, 1000);
      currentBars = bars;
      if (chart) {
        chart.setDataLoader(makeDataLoader());
      }
      setStatus(`${currentSymbol} · ${bars.length} 根 K 线（已刷新）`);
    } catch (e) {
      setStatus(`刷新失败: ${String(e)}`, "err");
    }
  });

  window.addEventListener("resize", () => chart?.resize());
}

function periodOf(tf: Timeframe): { type: "minute" | "hour" | "day"; span: number } {
  switch (tf) {
    case "1m": return { type: "minute", span: 1 };
    case "5m": return { type: "minute", span: 5 };
    case "15m": return { type: "minute", span: 15 };
    case "1h": return { type: "hour", span: 1 };
    case "4h": return { type: "hour", span: 4 };
    case "1d": return { type: "day", span: 1 };
  }
}

async function main() {
  registerRustIndicators();
  registerScriptPlotIndicator();
  document.querySelector<HTMLTextAreaElement>("#sp-code")!.value = scriptExamples.ma;
  chart = init(chartEl, {
    locale: "zh-CN",
    styles: "light",
  });
  if (!chart) {
    setStatus("图表初始化失败", "err");
    return;
  }
  chart.createIndicator("VOL");
  chart.setDataLoader(makeDataLoader());
  bindEvents();
  renderDrawingTools();
  await loadSymbols();
}

void main();
