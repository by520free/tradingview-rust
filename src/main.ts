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
import { ScriptHost, type ScriptHline, type ScriptFill, type ScriptPlot } from "./scripts/script-host";

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
  wma: {
    label: "WMA(20)", params: [20], series: "price",
    figures: [{ title: "WMA20", color: "#16a085" }],
  },
  smma: {
    label: "SMMA(20)", params: [20], series: "price",
    figures: [{ title: "SMMA20", color: "#7f8c8d" }],
  },
  stdev: {
    label: "STDEV(20)", params: [20], series: "normal",
    figures: [{ title: "STDEV", color: "#e67e22" }],
  },
  roc: {
    label: "ROC(12)", params: [12], series: "normal",
    figures: [{ title: "ROC", color: "#2980b9" }],
  },
  mom: {
    label: "MOM(10)", params: [10], series: "normal",
    figures: [{ title: "MOM", color: "#8e44ad" }],
  },
  dema: {
    label: "DEMA(20)", params: [20], series: "price",
    figures: [{ title: "DEMA20", color: "#c0392b" }],
  },
  tema: {
    label: "TEMA(20)", params: [20], series: "price",
    figures: [{ title: "TEMA20", color: "#9b59b6" }],
  },
  cci: {
    label: "CCI(20)", params: [20], series: "normal",
    figures: [{ title: "CCI", color: "#e67e22" }],
  },
  willr: {
    label: "WILL%R(14)", params: [14], series: "normal",
    figures: [{ title: "WILL%R", color: "#16a085" }],
  },
  mfi: {
    label: "MFI(14)", params: [14], series: "normal",
    figures: [{ title: "MFI", color: "#8e44ad" }],
  },
  adx: {
    label: "ADX(14)", params: [14], series: "normal",
    figures: [
      { title: "+DI", color: "#2f9e44" },
      { title: "-DI", color: "#e03131" },
      { title: "ADX", color: "#e67e22" },
    ],
  },
  donchian: {
    label: "Donchian(20)", params: [20], series: "price",
    figures: [
      { title: "UPPER", color: "#95a5a6" },
      { title: "MID", color: "#e67e22" },
      { title: "LOWER", color: "#95a5a6" },
    ],
  },
  keltner: {
    label: "Keltner(20,2)", params: [20, 2], series: "price",
    figures: [
      { title: "UPPER", color: "#95a5a6" },
      { title: "MID", color: "#2980b9" },
      { title: "LOWER", color: "#95a5a6" },
    ],
  },
  aroon: {
    label: "Aroon(25)", params: [25], series: "normal",
    figures: [
      { title: "UP", color: "#2f9e44" },
      { title: "DOWN", color: "#e03131" },
    ],
  },
  trix: {
    label: "TRIX(15)", params: [15], series: "normal",
    figures: [{ title: "TRIX", color: "#2980b9" }],
  },
  bop: {
    label: "BOP", params: [], series: "normal",
    figures: [{ title: "BOP", color: "#16a085" }],
  },
  cmf: {
    label: "CMF(20)", params: [20], series: "normal",
    figures: [{ title: "CMF", color: "#8e44ad" }],
  },
  uo: {
    label: "Ult Osc", params: [], series: "normal",
    figures: [{ title: "ULT", color: "#e67e22" }],
  },
  dpo: {
    label: "DPO(20)", params: [20], series: "normal",
    figures: [{ title: "DPO", color: "#2980b9" }],
  },
  posc: {
    label: "Price Osc(12,26)", params: [12, 26], series: "normal",
    figures: [{ title: "POSC", color: "#8e44ad" }],
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
      <button id="export-btn" class="control btn" title="导出图表 PNG (G)">导出</button>
      <button id="theme-toggle" class="control btn theme-btn" title="切换主题">◐</button>
      <button id="shortcut-help" class="control btn theme-btn" title="快捷键 (?)">?</button>
      <span id="status" class="status">就绪</span>
    </div>
  </header>
  <main class="layout">
    <aside class="sidebar">
      <div class="panel-title">自选品种</div>
      <div id="symbol-list" class="symbol-list"></div>
      <div class="panel-title" style="margin-top:16px">Rust 指标 <span id="indicator-count" class="panel-count">0/30</span></div>
      <div id="indicator-list" class="indicator-list"></div>
      <div id="indicator-params" class="indicator-params" hidden></div>
      <div class="panel-title" style="margin-top:16px">策略回测</div>
      <div class="backtest-box">
        <div class="bt-strategy">双均线交叉 <span class="bt-sub">MA5 × MA20</span></div>
        <details class="bt-config" id="bt-config">
          <summary>回测参数 <span class="bt-sub">点击调整</span></summary>
          <div class="bt-config-body">
            <div class="btp-row"><label>初始资金</label><input data-btp="initial_capital" type="number" min="1" step="1000"></div>
            <div class="btp-row"><label>仓位方式</label><select data-btp="size_type"><option value="percent">权益百分比</option><option value="cash">固定金额</option><option value="fixed">固定数量</option></select></div>
            <div class="btp-row"><label>仓位值</label><input data-btp="size_value" type="number" min="0" step="1"></div>
            <div class="btp-row"><label>手续费 %</label><input data-btp="commission" type="number" min="0" step="0.01"></div>
            <div class="btp-row"><label>滑点 %</label><input data-btp="slippage" type="number" min="0" step="0.01"></div>
            <div class="btp-row"><label>加仓层数</label><input data-btp="pyramiding" type="number" min="1" step="1"></div>
            <div class="btp-row"><label>成交时机</label><select data-btp="fill_on"><option value="open">下根开盘（防未来）</option><option value="close">当根收盘</option></select></div>
            <div class="btp-row"><label>止损 %</label><input data-btp="stop_loss" type="number" min="0" step="0.5"></div>
            <div class="btp-row"><label>止盈 %</label><input data-btp="take_profit" type="number" min="0" step="0.5"></div>
            <div class="btp-row"><label>追踪止损 %</label><input data-btp="trailing" type="number" min="0" step="0.5"></div>
            <button id="bt-config-reset" class="btn btp-reset">恢复默认参数</button>
          </div>
        </details>
        <button id="bt-run" class="bt-run">运行回测</button>
        <div id="bt-result" class="bt-result">尚未运行</div>
        <div id="equity-wrap" class="equity-wrap" hidden>
          <div class="equity-title">权益曲线 <span id="equity-bh" class="equity-bh"></span></div>
          <canvas id="equity-canvas" class="equity-canvas"></canvas>
        </div>
      </div>
      <div class="panel-title" style="margin-top:16px">绘图工具</div>
      <div id="drawing-list" class="drawing-list"></div>
      <button id="clear-drawings" class="control btn" style="width:100%;margin-top:6px">清除绘图</button>
      <div class="panel-title" style="margin-top:16px">价格预警</div>
      <div class="alert-box">
        <div class="alert-input-row">
          <input id="alert-price" class="alert-input" type="number" step="any" placeholder="目标价" />
          <select id="alert-dir" class="alert-dir">
            <option value="above">≥</option>
            <option value="below">≤</option>
          </select>
          <button id="alert-add" class="alert-add">+</button>
        </div>
        <div id="alert-list" class="alert-list"></div>
      </div>
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
  <div id="shortcut-modal" class="shortcut-modal" hidden>
    <div class="sc-card">
      <div class="sc-title">快捷键</div>
      <div class="sc-row"><span class="sc-desc">切换周期 1分/5分/15分/1时/4时/日线</span><span class="sc-key">1 2 3 4 5 6</span></div>
      <div class="sc-row"><span class="sc-desc">回放播放 / 暂停</span><span class="sc-key">Space</span></div>
      <div class="sc-row"><span class="sc-desc">运行回测</span><span class="sc-key">B</span></div>
      <div class="sc-row"><span class="sc-desc">打开 / 收起脚本编辑器</span><span class="sc-key">E</span></div>
      <div class="sc-row"><span class="sc-desc">切换明暗主题</span><span class="sc-key">T</span></div>
      <div class="sc-row"><span class="sc-desc">刷新数据</span><span class="sc-key">R</span></div>
      <div class="sc-row"><span class="sc-desc">导出图表 PNG</span><span class="sc-key">G</span></div>
      <div class="sc-row"><span class="sc-desc">清除所有绘图</span><span class="sc-key">Esc</span></div>
      <div class="sc-row"><span class="sc-desc">显示本帮助</span><span class="sc-key">?</span></div>
      <button id="sc-close" class="sc-close">关闭</button>
    </div>
  </div>
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
// 回测结果中的买卖点，按 bar index 索引。切换品种/周期时清空。
let backtestMarkersByIndex = new Map<number, "buy" | "sell">();
// 不重新拉取数据、把当前 bars 重新喂给图表（用于绘制 marker / 权益曲线）。
let feedFromCache = false;

// 主题：跟随系统偏好，用户选择后存 localStorage。
type ThemeMode = "light" | "dark";
function preferredTheme(): ThemeMode {
  const saved = localStorage.getItem("candlelab_theme");
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
let currentTheme: ThemeMode = preferredTheme();
// 保存最近一次回测结果，供主题切换时重绘权益曲线。
let lastResult: BacktestResult | null = null;

// 价格预警：{ 目标价, 方向 }，触及后触发一次并标记。
interface PriceAlert { price: number; dir: "above" | "below"; fired: boolean; }
let priceAlerts: PriceAlert[] = [];

// 检查最新价是否触发预警。
function checkPriceAlerts(price: number) {
  let changed = false;
  for (const a of priceAlerts) {
    if (a.fired) continue;
    const hit = a.dir === "above" ? price >= a.price : price <= a.price;
    if (hit) {
      a.fired = true;
      changed = true;
      const dirText = a.dir === "above" ? "涨至" : "跌至";
      setStatus(`⚠ 预警: ${currentSymbol} ${dirText} ${a.price}`);
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification("CandleLab 价格预警", {
          body: `${currentSymbol} ${dirText} ${a.price}（当前 ${price}）`,
        });
      }
    }
  }
  if (changed) renderAlertList();
}

function renderAlertList() {
  const list = document.querySelector<HTMLDivElement>("#alert-list")!;
  list.innerHTML = "";
  if (priceAlerts.length === 0) {
    list.textContent = "无预警";
    return;
  }
  priceAlerts.forEach((a, i) => {
    const row = document.createElement("div");
    row.className = `alert-item${a.fired ? " fired" : ""}`;
    const label = document.createElement("span");
    label.textContent = `${a.dir === "above" ? "≥" : "≤"} ${a.price}`;
    const del = document.createElement("button");
    del.className = "alert-del";
    del.textContent = "×";
    del.title = "删除";
    del.addEventListener("click", () => {
      priceAlerts.splice(i, 1);
      renderAlertList();
    });
    row.appendChild(label);
    row.appendChild(del);
    list.appendChild(row);
  });
}

function exportChartPng() {
  if (!chart) { setStatus("图表未就绪", "err"); return; }
  try {
    const url = chart.getConvertPictureUrl(true, "png", currentTheme === "dark" ? "#1e2128" : "#ffffff");
    const a = document.createElement("a");
    a.href = url;
    a.download = `CandleLab_${currentSymbol}_${currentTimeframe}_${Date.now()}.png`;
    a.click();
    setStatus("图表已导出 PNG");
  } catch (e) {
    setStatus(`导出失败: ${String(e)}`, "err");
  }
}

function applyTheme(theme: ThemeMode) {
  currentTheme = theme;
  document.body.dataset.theme = theme;
  chart?.setStyles(theme);
  const btn = document.querySelector<HTMLButtonElement>("#theme-toggle");
  if (btn) btn.textContent = theme === "dark" ? "☀" : "◐";
  // 权益曲线用 Canvas 手绘，换主题后按当前回测结果重画。
  if (lastResult) renderEquityCurve(lastResult);
}

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
  registerBacktestMarkerIndicator();
}

// 回测买卖箭头：用两个 text figure 分别画多空入场/出场。
// calc 从 bar 扩展字段读 backtest marker（bt_<i>_<kind>），把值作为价格定位，
// text 通过 attrs 回调返回箭头字符。无 marker 的 bar 返回 null，不绘制。
interface MarkerValues { buy: number | null; sell: number | null; }

function registerBacktestMarkerIndicator() {
  registerIndicator<MarkerValues>({
    name: "candlelab_bt_marker",
    shortName: "买卖点",
    series: "price",
    calcParams: [],
    figures: [
      {
        key: "buy", type: "text",
        attrs: () => ({ text: "▲", align: "center", baseline: "bottom" }),
        styles: () => ({ color: "#e03131", size: 14 }),
      },
      {
        key: "sell", type: "text",
        attrs: () => ({ text: "▼", align: "center", baseline: "top" }),
        styles: () => ({ color: "#2f9e44", size: 14 }),
      },
    ],
    calc: (dataList) =>
      dataList.map((bar) => ({
        buy: typeof bar["bt_buy"] === "number" ? bar["bt_buy"] : null,
        sell: typeof bar["bt_sell"] === "number" ? bar["bt_sell"] : null,
      })),
  });
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
    // 把 Rust 指标值和回测 marker 作为扩展字段带上，供自定义指标的 calc 读取。
    for (const key of Object.keys(b)) {
      if (key.startsWith("rust_") || key.startsWith("bt_")) k[key] = b[key];
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

// 把当前回测 marker 挂到 bars 扩展字段（先清后挂，避免切换后残留）。
function applyMarkersToBars() {
  for (const bar of currentBars) {
    delete bar["bt_buy"];
    delete bar["bt_sell"];
  }
  for (const [index, kind] of backtestMarkersByIndex) {
    const bar = currentBars[index];
    if (!bar) continue;
    // 买点标在最低价下方，卖点标在最高价上方，避免遮挡 K 线。
    const range = Math.max(bar.high - bar.low, bar.close * 0.002);
    if (kind === "buy") bar["bt_buy"] = bar.low - range * 0.6;
    else bar["bt_sell"] = bar.high + range * 0.6;
  }
}

// 只重喂现有 bars，不触发网络请求（绘制 marker 时用）。
function refeedChart() {
  if (!chart || currentBars.length === 0) return;
  feedFromCache = true;
  chart.setDataLoader(makeDataLoader());
}

function makeDataLoader(): DataLoader {
  return {
    getBars: async ({ callback }) => {
      try {
        const useCache = feedFromCache;
        feedFromCache = false;
        if (!useCache) setStatus("加载数据中…", "busy");
        if (!useCache) currentBars = await fetchBars(currentSymbol, currentTimeframe, 1000);
        await enrichBarsWithIndicators();
        applyMarkersToBars();
        // 回放时只显示前 replayCount 根，否则全部。
        const display = replayCount >= 0 && replayCount < currentBars.length
          ? currentBars.slice(0, replayCount)
          : currentBars;
        callback(toKLine(display));
        // 数据就绪后再创建指标实例，calc 能立刻拿到扩展字段里的值。
        syncIndicatorInstances();
        syncMarkerIndicator();
        const suffix = replayCount >= 0 ? ` · 回放 ${display.length}/${currentBars.length}` : "";
        setStatus(`${currentSymbol} · ${currentBars.length} 根 K 线${suffix}`);
        // 数据就绪后用最新价检查一次预警（缓存重喂时也检查，避免漏触发）。
        if (!useCache && currentBars.length > 0) {
          checkPriceAlerts(currentBars[currentBars.length - 1].close);
        }
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

// marker 指标实例创建一次即可。切换品种后 marker 变空，calc 返回全 null 自然不画；
// 再次回测时 refeed 触发 calc 重算，无需删除重建。
function syncMarkerIndicator() {
  if (!chart) return;
  const name = "candlelab_bt_marker";
  if (createdIndicators.has(name)) return;
  const id = chart.createIndicator(name);
  if (id) createdIndicators.add(name);
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
  const countEl = document.querySelector<HTMLSpanElement>("#indicator-count");
  if (countEl) countEl.textContent = `${activeIndicators.size}/${supportedIndicators.length}`;
  renderIndicatorParams();
}

// 参数名提示：按指标顺序给出中文标签，缺失时用「参数N」。
const paramNames: Record<string, string[]> = {
  sma: ["周期"], ema: ["周期"], rsi: ["周期"], boll: ["周期", "标准差倍数"],
  atr: ["周期"], kdj: ["周期"], volume_ma: ["周期"],
  macd: ["快线", "慢线", "信号"], keltner: ["周期", "倍数"], posc: ["快线", "慢线"],
};

// 渲染已启用指标的参数输入框，改动后重算并刷新。
function renderIndicatorParams() {
  const box = document.querySelector<HTMLDivElement>("#indicator-params")!;
  box.innerHTML = "";
  if (activeIndicators.size === 0) { box.hidden = true; return; }
  box.hidden = false;
  const title = document.createElement("div");
  title.className = "ip-title";
  title.textContent = "指标参数";
  box.appendChild(title);

  for (const [kind, req] of activeIndicators) {
    const meta = indicatorMeta[kind];
    if (!meta || meta.params.length === 0) continue;
    const row = document.createElement("div");
    row.className = "ip-row";
    const name = document.createElement("span");
    name.className = "ip-name";
    name.textContent = meta.label.split("(")[0];
    row.appendChild(name);
    meta.params.forEach((_, i) => {
      const input = document.createElement("input");
      input.type = "number";
      input.className = "ip-input";
      input.value = String(req.params[i] ?? meta.params[i]);
      input.min = "1";
      input.title = paramNames[kind]?.[i] ?? `参数${i + 1}`;
      input.addEventListener("change", () => {
        const v = Number(input.value);
        if (!Number.isFinite(v) || v <= 0) { input.value = String(req.params[i]); return; }
        req.params[i] = v;
        // refeed 会用新参数让 Rust 重算扩展字段，图表 calc 自动重读。
        refeedChart();
        setStatus(`${meta.label.split("(")[0]} 参数已更新`);
      });
      row.appendChild(input);
    });
    box.appendChild(row);
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
      params: [...(indicatorMeta[kind]?.params ?? [])],
    });
    btn.classList.add("active");
  }
  const countEl = document.querySelector<HTMLSpanElement>("#indicator-count");
  if (countEl) countEl.textContent = `${activeIndicators.size}/${supportedIndicators.length}`;
  renderIndicatorParams();
  // 切换指标（非参数微调）需要重新拉取数据走完整管线。
  clearBacktestVisuals();
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
const mid = plot(r, { title: 'RSI14', color: '#8e44ad' });
const band = plot(50, { title: '中轴', color: '#95a5a6' });
fill(mid, band, { color: 'rgba(142,68,173,0.15)' });
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

// hline / fill 的颜色存在 bar 扩展字段里，figure 的 styles 回调从中读取。
interface OverlayValues extends Record<string, number | null | string> {}

const MAX_SCRIPT_HLINES = 8;
const MAX_SCRIPT_FILLS = 6;

function registerScriptOverlayIndicators() {
  for (let i = 0; i < MAX_SCRIPT_HLINES; i++) {
    registerIndicator<OverlayValues>({
      name: `rust_script_hline_${i}`,
      shortName: `参考线${i + 1}`,
      series: "price",
      calcParams: [],
      figures: [{
        key: "v", type: "line",
        styles: (p) => ({ color: String(p.data.current?.["c"] ?? "#8E8A82"), style: "dashed" } as never),
      }],
      calc: (dataList) => dataList.map((bar) => {
        const v = bar[`sh_${i}`];
        return { v: typeof v === "number" && Number.isFinite(v) ? v : null, c: String(bar[`shc_${i}`] ?? "") };
      }),
    });
  }
  for (let i = 0; i < MAX_SCRIPT_FILLS; i++) {
    registerIndicator<OverlayValues>({
      name: `rust_script_fill_${i}`,
      shortName: `区间${i + 1}`,
      series: "price",
      calcParams: [],
      figures: [{
        key: "hi", type: "bar",
        attrs: (p) => {
          const cur = p.data.current;
          if (!cur || cur["hi"] == null || cur["lo"] == null) return null;
          const y1 = p.coordinate.current["hi"];
          const y2 = p.coordinate.current["lo"];
          if (!Number.isFinite(y1) || !Number.isFinite(y2)) return null;
          return { y: Math.min(y1, y2), height: Math.max(1, Math.abs(y1 - y2)), width: p.barSpace.bar } as never;
        },
        styles: (p) => ({ color: String(p.data.current?.["c"] ?? "rgba(79,163,247,0.18)"), style: "fill" } as never),
      }],
      calc: (dataList) => dataList.map((bar) => {
        const hi = bar[`sf_hi_${i}`];
        const lo = bar[`sf_lo_${i}`];
        return {
          hi: typeof hi === "number" && Number.isFinite(hi) ? hi : null,
          lo: typeof lo === "number" && Number.isFinite(lo) ? lo : null,
          c: String(bar[`sfc_${i}`] ?? ""),
        };
      }),
    });
  }
}

function clearScriptOverlays() {
  if (!chart) return;
  for (let i = 0; i < MAX_SCRIPT_HLINES; i++) {
    chart.removeIndicator({ name: `rust_script_hline_${i}` });
    createdIndicators.delete(`rust_script_hline_${i}`);
  }
  for (let i = 0; i < MAX_SCRIPT_FILLS; i++) {
    chart.removeIndicator({ name: `rust_script_fill_${i}` });
    createdIndicators.delete(`rust_script_fill_${i}`);
  }
}

/** 绘制脚本的 hline 和 fill。fill 的 from/to 是 plot key（p0/p1…），从对应 plot 的 Float64Array 取上下界。 */
function drawScriptOverlays(hlines: ScriptHline[], fills: ScriptFill[], plots: ScriptPlot[]) {
  if (!chart) return;
  clearScriptOverlays();
  const plotByKey = new Map(plots.map((p) => [p.key, p]));

  hlines.slice(0, MAX_SCRIPT_HLINES).forEach((hl, i) => {
    for (let k = 0; k < currentBars.length; k++) {
      currentBars[k][`sh_${i}`] = hl.price;
      currentBars[k][`shc_${i}`] = hl.color;
    }
    if (chart!.createIndicator({ name: `rust_script_hline_${i}` })) {
      createdIndicators.add(`rust_script_hline_${i}`);
    }
  });

  fills.slice(0, MAX_SCRIPT_FILLS).forEach((f, i) => {
    const a = plotByKey.get(f.from)?.values;
    const b = plotByKey.get(f.to)?.values;
    if (!a || !b) return;
    for (let k = 0; k < currentBars.length; k++) {
      const va = a[k];
      const vb = b[k];
      const valid = Number.isFinite(va) && Number.isFinite(vb);
      currentBars[k][`sf_hi_${i}`] = valid ? Math.max(va, vb) : null;
      currentBars[k][`sf_lo_${i}`] = valid ? Math.min(va, vb) : null;
      currentBars[k][`sfc_${i}`] = f.color;
    }
    if (chart!.createIndicator({ name: `rust_script_fill_${i}` })) {
      createdIndicators.add(`rust_script_fill_${i}`);
    }
  });
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
    // 渲染 hline / fill（fill 从原始 ScriptPlot 的 Float64Array 取数）
    drawScriptOverlays(out.hlines, out.fills, out.plots);
    // 输出日志
    const lines: string[] = [`✓ 运行成功 (${out.ms}ms, ${out.plots.length} 条线)`];
    if (out.hlines.length) lines.push(`参考线 ${out.hlines.length} 条`);
    if (out.fills.length) lines.push(`区间填充 ${out.fills.length} 处`);
    if (out.meta) lines.push(`脚本: ${out.meta.name}`);
    if (out.logs.length) lines.push("", "日志:", ...out.logs);
    if (out.signals.length) lines.push("", `策略信号: ${out.signals.map((s) => s.id).join(", ")}`);
    logEl.textContent = lines.join("\n");
    setStatus(`脚本运行成功 · ${out.plots.length} 条线`);

    // 策略脚本：把信号交给 Rust 回测引擎执行
    if (out.meta?.strategy && out.signals.length > 0) {
      const cfg: BacktestConfig = readBacktestConfig();
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
      checkPriceAlerts(bar.close);
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

const BT_CONFIG_KEY = "candlelab_bt_config";
const btNumericFields: (keyof BacktestConfig)[] = [
  "initial_capital", "size_value", "commission", "slippage",
  "pyramiding", "stop_loss", "take_profit", "trailing",
];

// 从参数面板读取配置；面板未填或非法时回退到默认值。
function readBacktestConfig(): BacktestConfig {
  const cfg: BacktestConfig = { ...defaultBacktestConfig };
  for (const key of btNumericFields) {
    const el = document.querySelector<HTMLInputElement>(`[data-btp="${key}"]`);
    if (!el) continue;
    const v = Number(el.value);
    if (Number.isFinite(v)) (cfg[key] as number) = v;
  }
  const sizeType = document.querySelector<HTMLSelectElement>('[data-btp="size_type"]');
  if (sizeType) cfg.size_type = sizeType.value as BacktestConfig["size_type"];
  const fillOn = document.querySelector<HTMLSelectElement>('[data-btp="fill_on"]');
  if (fillOn) cfg.fill_on = fillOn.value as BacktestConfig["fill_on"];
  // 基本约束：加仓层数至少 1，仓位/费率/止损等不允许为负。
  cfg.pyramiding = Math.max(1, Math.floor(cfg.pyramiding));
  for (const key of ["initial_capital", "size_value", "commission", "slippage", "stop_loss", "take_profit", "trailing"] as (keyof BacktestConfig)[]) {
    if ((cfg[key] as number) < 0) (cfg[key] as number) = 0;
  }
  return cfg;
}

// 把配置写回面板并持久化。
function applyBacktestConfig(cfg: BacktestConfig, persist = true) {
  for (const key of btNumericFields) {
    const el = document.querySelector<HTMLInputElement>(`[data-btp="${key}"]`);
    if (el) el.value = String(cfg[key]);
  }
  const sizeType = document.querySelector<HTMLSelectElement>('[data-btp="size_type"]');
  if (sizeType) sizeType.value = cfg.size_type;
  const fillOn = document.querySelector<HTMLSelectElement>('[data-btp="fill_on"]');
  if (fillOn) fillOn.value = cfg.fill_on;
  if (persist) localStorage.setItem(BT_CONFIG_KEY, JSON.stringify(cfg));
}

function initBacktestConfig() {
  let cfg = defaultBacktestConfig;
  try {
    const saved = localStorage.getItem(BT_CONFIG_KEY);
    if (saved) cfg = { ...defaultBacktestConfig, ...JSON.parse(saved) };
  } catch { /* 损坏的缓存直接回落默认 */ }
  applyBacktestConfig(cfg, false);
  document.querySelector<HTMLButtonElement>("#bt-config-reset")?.addEventListener("click", () => {
    applyBacktestConfig(defaultBacktestConfig);
    setStatus("回测参数已恢复默认");
  });
}

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
    const cfg = readBacktestConfig();
    localStorage.setItem(BT_CONFIG_KEY, JSON.stringify(cfg));
    const signals = makeMaCrossSignals(currentBars);
    const result = await runBacktest(
      currentSymbol,
      currentTimeframe,
      cfg,
      signals,
      [],
    );
    lastResult = result;
    renderBacktestResult(result);
    drawBacktestMarkers(result);
    renderEquityCurve(result);
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

// 把回测 marker 转成按 bar index 的 buy/sell 映射，再重喂图表让自定义指标画出箭头。
function drawBacktestMarkers(r: BacktestResult) {
  backtestMarkersByIndex.clear();
  for (const m of r.markers) {
    const isBuy = (m.kind === "entry" && m.side === "long") ||
                  (m.kind === "exit" && m.side === "short");
    backtestMarkersByIndex.set(m.index, isBuy ? "buy" : "sell");
  }
  refeedChart();
}

// 用 Canvas 画权益曲线 + 回撤填充。侧栏窄，画紧凑的双线图。
function renderEquityCurve(r: BacktestResult) {
  const wrap = document.querySelector<HTMLDivElement>("#equity-wrap")!;
  const canvas = document.querySelector<HTMLCanvasElement>("#equity-canvas")!;
  const bhEl = document.querySelector<HTMLSpanElement>("#equity-bh")!;
  if (!r.equity || r.equity.length < 2 || !r.drawdown) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  const bhClass = r.buy_hold_pct >= 0 ? "bt-pos" : "bt-neg";
  bhEl.innerHTML = `买入持有 ${r.buy_hold_pct.toFixed(1)}%`;
  bhEl.className = `equity-bh ${bhClass}`;

  const dpr = window.devicePixelRatio || 1;
  const cssW = 174;
  const cssH = 66;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, cssW, cssH);

  const n = r.equity.length;
  const eq = r.equity;
  let min = Infinity, max = -Infinity;
  for (const v of eq) { if (v < min) min = v; if (v > max) max = v; }
  const pad = 4;
  const span = max - min || 1;
  const x = (i: number) => (i / (n - 1)) * (cssW - 2 * pad) + pad;
  const y = (v: number) => cssH - pad - ((v - min) / span) * (cssH - 2 * pad);

  // 回撤填充（底部红色渐弱区域，表示水下区间）。
  const maxDD = Math.max(...r.drawdown, 0.0001);
  ctx.fillStyle = "rgba(224,49,49,0.16)";
  ctx.beginPath();
  ctx.moveTo(pad, cssH - pad);
  for (let i = 0; i < n; i++) {
    const h = (r.drawdown[i] / maxDD) * (cssH - 2 * pad);
    ctx.lineTo(x(i), cssH - pad - h);
  }
  ctx.lineTo(x(n - 1), cssH - pad);
  ctx.closePath();
  ctx.fill();

  // 权益线。
  ctx.strokeStyle = "#1971c2";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const px = x(i), py = y(eq[i]);
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.stroke();

  // 起始资金基准虚线。
  const start = r.equity[0];
  ctx.strokeStyle = "rgba(108,117,125,0.5)";
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(pad, y(start));
  ctx.lineTo(cssW - pad, y(start));
  ctx.stroke();
  ctx.setLineDash([]);
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

function clearBacktestVisuals() {
  backtestMarkersByIndex.clear();
  lastResult = null;
  const wrap = document.querySelector<HTMLDivElement>("#equity-wrap");
  const resultEl = document.querySelector<HTMLDivElement>("#bt-result");
  if (wrap) wrap.hidden = true;
  if (resultEl) resultEl.textContent = "尚未运行";
}

async function switchSymbol(symbol: string) {
  currentSymbol = symbol;
  symbolSelect.value = symbol;
  highlightSymbol();
  clearBacktestVisuals();
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
      clearBacktestVisuals();
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

  // 导出 PNG
  document.querySelector<HTMLButtonElement>("#export-btn")!.addEventListener("click", exportChartPng);

  // 价格预警
  document.querySelector<HTMLButtonElement>("#alert-add")!.addEventListener("click", () => {
    const input = document.querySelector<HTMLInputElement>("#alert-price")!;
    const dirSel = document.querySelector<HTMLSelectElement>("#alert-dir")!;
    const price = Number(input.value);
    if (!Number.isFinite(price) || price <= 0) { setStatus("请输入有效目标价", "err"); return; }
    if (priceAlerts.length >= 20) { setStatus("预警数量上限 20", "err"); return; }
    priceAlerts.push({ price, dir: dirSel.value as "above" | "below", fired: false });
    input.value = "";
    renderAlertList();
    setStatus(`已添加预警 ${dirSel.value === "above" ? "≥" : "≤"} ${price}`);
    // 首次添加时请求桌面通知权限（用户主动操作，不打扰）。
    if ("Notification" in window && Notification.permission === "default") {
      void Notification.requestPermission();
    }
    // 添加后立即检查当前价（若已满足则马上触发）。
    if (currentBars.length > 0) checkPriceAlerts(currentBars[currentBars.length - 1].close);
  });

  // 主题切换
  document.querySelector<HTMLButtonElement>("#theme-toggle")!.addEventListener("click", () => {
    const next: ThemeMode = currentTheme === "dark" ? "light" : "dark";
    localStorage.setItem("candlelab_theme", next);
    applyTheme(next);
    setStatus(`已切换至${next === "dark" ? "暗" : "亮"}色主题`);
  });

  // 快捷键帮助
  const modal = document.querySelector<HTMLDivElement>("#shortcut-modal")!;
  const openHelp = () => { modal.hidden = false; };
  const closeHelp = () => { modal.hidden = true; };
  document.querySelector<HTMLButtonElement>("#shortcut-help")!.addEventListener("click", openHelp);
  document.querySelector<HTMLButtonElement>("#sc-close")!.addEventListener("click", closeHelp);
  modal.addEventListener("click", (e) => { if (e.target === modal) closeHelp(); });

  // 全局快捷键（输入框聚焦时不响应，避免干扰输入）。
  window.addEventListener("keydown", (e) => {
    const tag = (e.target as HTMLElement)?.tagName;
    const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    if (e.key === "Escape") {
      if (!modal.hidden) { closeHelp(); return; }
      if (typing) return;
      chart?.removeOverlay();
      setStatus("已清除所有绘图");
      return;
    }
    if (typing || modal.hidden === false) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    const tfKeys: Record<string, Timeframe> = {
      "1": "1m", "2": "5m", "3": "15m", "4": "1h", "5": "4h", "6": "1d",
    };
    if (tfKeys[e.key]) {
      const tf = tfKeys[e.key];
      const btn = document.querySelector<HTMLButtonElement>(`.tf[data-tf="${tf}"]`);
      btn?.click();
      e.preventDefault();
      return;
    }
    switch (e.key.toLowerCase()) {
      case " ": {
        e.preventDefault();
        document.querySelector<HTMLButtonElement>("#replay-toggle")!.click();
        break;
      }
      case "b": document.querySelector<HTMLButtonElement>("#bt-run")!.click(); break;
      case "e": showScriptPanel(!document.querySelector<HTMLElement>("#script-panel")!.classList.contains("open")); break;
      case "t": document.querySelector<HTMLButtonElement>("#theme-toggle")!.click(); break;
      case "r": document.querySelector<HTMLButtonElement>("#refresh-btn")!.click(); break;
      case "g": exportChartPng(); break;
      case "?": openHelp(); break;
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
  document.body.dataset.theme = currentTheme;
  const themeBtn = document.querySelector<HTMLButtonElement>("#theme-toggle");
  if (themeBtn) themeBtn.textContent = currentTheme === "dark" ? "☀" : "◐";
  registerRustIndicators();
  registerScriptPlotIndicator();
  registerScriptOverlayIndicators();
  document.querySelector<HTMLTextAreaElement>("#sp-code")!.value = scriptExamples.ma;
  chart = init(chartEl, {
    locale: "zh-CN",
    styles: currentTheme,
  });
  if (!chart) {
    setStatus("图表初始化失败", "err");
    return;
  }
  chart.createIndicator("VOL");
  chart.setDataLoader(makeDataLoader());
  bindEvents();
  initBacktestConfig();
  renderDrawingTools();
  renderAlertList();
  await loadSymbols();
}

void main();
