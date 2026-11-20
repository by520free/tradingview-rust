import "./style.css";
import { init, type Chart, type KLineData, type DataLoader } from "klinecharts";
import {
  fetchBars,
  reloadBars,
  computeIndicators,
  listIndicators,
  listSymbols,
} from "./api";
import type { Bar, IndicatorRequest, IndicatorResult, Timeframe } from "./types";

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
      <span id="status" class="status">就绪</span>
    </div>
  </header>
  <main class="layout">
    <aside class="sidebar">
      <div class="panel-title">自选品种</div>
      <div id="symbol-list" class="symbol-list"></div>
      <div class="panel-title" style="margin-top:16px">Rust 指标</div>
      <div id="indicator-list" class="indicator-list"></div>
      <div class="hint">指标由 Rust 核心计算<br/>经 Tauri IPC 传给图表</div>
    </aside>
    <section class="chart-area">
      <div id="chart" class="chart"></div>
    </section>
  </main>
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

function setStatus(text: string, kind: "ok" | "err" | "busy" = "ok") {
  statusEl.textContent = text;
  statusEl.dataset.kind = kind;
}

function toKLine(bars: Bar[]): KLineData[] {
  return bars.map((b) => ({
    timestamp: b.time,
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    volume: b.volume,
  }));
}

function makeDataLoader(): DataLoader {
  return {
    getBars: async ({ callback }) => {
      try {
        setStatus("加载数据中…", "busy");
        const bars = await fetchBars(currentSymbol, currentTimeframe, 1000);
        currentBars = bars;
        callback(toKLine(bars));
        setStatus(`${currentSymbol} · ${bars.length} 根 K 线`);
        if (bars.length > 0) {
          await applyRustIndicators();
        }
      } catch (e) {
        setStatus(`加载失败: ${String(e)}`, "err");
        callback([]);
      }
    },
  };
}

const indicatorDisplay: Record<string, { label: string; params: number[] }> = {
  sma: { label: "SMA(20)", params: [20] },
  ema: { label: "EMA(20)", params: [20] },
  rsi: { label: "RSI(14)", params: [14] },
  macd: { label: "MACD(12,26,9)", params: [12, 26, 9] },
  boll: { label: "BOLL(20,2)", params: [20, 2] },
  atr: { label: "ATR(14)", params: [14] },
  kdj: { label: "KDJ(9)", params: [9] },
  vwap: { label: "VWAP", params: [] },
  volume_ma: { label: "VOL MA(20)", params: [20] },
  obv: { label: "OBV", params: [] },
};

async function applyRustIndicators() {
  if (currentBars.length === 0 || !chart) return;
  const requests = Array.from(activeIndicators.values());
  if (requests.length === 0) return;

  try {
    const results = await computeIndicators(
      currentSymbol,
      currentTimeframe,
      requests,
    );
    drawIndicatorLines(results);
  } catch (e) {
    setStatus(`指标计算失败: ${String(e)}`, "err");
  }
}

function drawIndicatorLines(results: IndicatorResult[]) {
  if (!chart) return;
  // KLineChart 创建副图指标线：用自定义 indicator 脚本较复杂，
  // MVP 阶段将指标值作为 data 的附加字段，主图叠加用 createIndicator 内置 + 自定义扩展留待下一阶段。
  // 这里先把结果映射到每个 bar 的扩展字段，供 tooltip/后续脚本读取。
  const windows = results.map((r) => r.lines);
  currentBars.forEach((bar, i) => {
    const record = toKLine([bar])[0] as KLineData & Record<string, unknown>;
    windows.forEach((lines, wi) => {
      lines.forEach((line) => {
        record[`rust_${wi}_${line.name}`] = line.values[i] ?? null;
      });
    });
  });
}

function renderIndicatorList() {
  indicatorListEl.innerHTML = "";
  for (const kind of supportedIndicators) {
    const meta = indicatorDisplay[kind];
    const label = meta?.label ?? kind;
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
  if (activeIndicators.has(kind)) {
    activeIndicators.delete(kind);
    btn.classList.remove("active");
  } else {
    const meta = indicatorDisplay[kind];
    activeIndicators.set(kind, {
      kind,
      params: meta?.params ?? [],
    });
    btn.classList.add("active");
  }
  void applyRustIndicators();
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
  }
  setStatus(`切换至 ${symbol}…`, "busy");
  if (chart) {
    chart.setDataLoader(makeDataLoader());
  }
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
  await loadSymbols();
}

void main();
