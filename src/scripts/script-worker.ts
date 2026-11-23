/// <reference lib="webworker" />
// 用户脚本沙箱：运行在 Web Worker 中，与页面 DOM/storage 隔离，主线程可超时终止。
// 借鉴 Wickline（MIT）的 script-worker.js 设计：块级作用域包裹、危险 API 遮蔽、错误行号映射。
// 策略脚本只产出信号；真正的成交由 Rust 回测引擎执行，保持"Rust 核心"架构。

import * as TA from "./ta";

type Series = (number | null)[];
type PlotStyle = "line" | "histogram" | "dots" | "step";

interface WorkerData {
  time: number[];
  open: number[];
  high: number[];
  low: number[];
  close: number[];
  volume: number[];
}

interface RunMessage {
  id: number;
  code: string;
  data: WorkerData;
  inputs?: Record<string, unknown>;
  ctx?: { symbol?: string; tfSec?: number };
}

// 用户代码放进独立块，因而可以声明 max/n 等同名局部变量而不冲突。
const PREFIX = '"use strict";{\n';
const SUFFIX = "\n}";
// 这些名字用 undefined 遮蔽。不是硬安全边界，但让脚本专注于图表数学。
const BLOCKED = [
  "self", "globalThis", "postMessage", "importScripts", "fetch", "XMLHttpRequest",
  "WebSocket", "EventSource", "indexedDB", "caches", "navigator", "location", "Worker",
];

let lineOffset: number | null = null;

function compile(names: string[], code: string): Function {
  // eslint-disable-next-line no-new-func
  return new Function(...names, PREFIX + code + SUFFIX);
}

/** 把错误堆栈映射回用户代码行号 */
function errorLine(err: unknown, names: string[]): number | null {
  const stack = String((err as Error)?.stack || "");
  const m = /<anonymous>:(\d+):(\d+)/.exec(stack);
  if (!m) return null;
  if (lineOffset === null) {
    try { compile(names, 'throw new Error("x")')(); } catch (e) {
      const k = /<anonymous>:(\d+):\d+/.exec(String((e as Error).stack));
      lineOffset = k ? Number(k[1]) - 1 : 2;
    }
  }
  const line = Number(m[1]) - (lineOffset ?? 2);
  return line >= 1 ? line : null;
}

const SHAPES: Record<string, string> = {
  up: "arrowUp", down: "arrowDown", arrowUp: "arrowUp", arrowDown: "arrowDown",
  circle: "circle", square: "square",
};
const POSITIONS: Record<string, string> = {
  above: "aboveBar", below: "belowBar", inside: "inBar",
  aboveBar: "aboveBar", belowBar: "belowBar", inBar: "inBar",
};
const STYLES: PlotStyle[] = ["line", "histogram", "dots", "step"];

interface Plot {
  key: string;
  title: string;
  color: string;
  colors: (string | null)[] | null;
  type: PlotStyle;
  width: number | undefined;
  values: Float64Array;
}
interface Marker {
  i: number; shape: string; position: string; color: string; text: string;
}
interface StrategySignal {
  id: string; dir: "long" | "short"; when: boolean[] | true; qty?: number;
}
interface ScriptResult {
  meta: { name: string; short: string; overlay: boolean; precision: number | null; strategy: boolean };
  inputs: { key: string; title: string; def: unknown; type: string; options?: string[]; min?: number; max?: number; step?: number }[];
  plots: Plot[];
  hlines: { price: number; color: string }[];
  fills: { from: string; to: string; color: string }[];
  markers: Marker[];
  signals: StrategySignal[];
  closeSignals: { when: boolean[] | true }[];
  risk: { stopLoss: number; takeProfit: number; trailing: number };
  consts: Record<string, number>;
  logs: string[];
}

function run(msg: RunMessage): { ok: boolean; result?: ScriptResult; error?: string; line?: number | null; logs: string[] } {
  const { code, data, inputs = {}, ctx = {} } = msg;
  const n = data.time.length;
  const time = data.time, open = data.open, high = data.high, low = data.low, close = data.close, volume = data.volume;
  const bars = time.map((t, i) => ({
    time: t, open: open[i], high: high[i], low: low[i], close: close[i], volume: volume[i],
  }));
  const hl2 = bars.map((b) => (b.high + b.low) / 2);
  const hlc3 = bars.map((b) => (b.high + b.low + b.close) / 3);
  const ohlc4 = bars.map((b) => (b.open + b.high + b.low + b.close) / 4);
  const logs: string[] = [];

  const out: ScriptResult = {
    meta: { name: "未命名脚本", short: "", overlay: false, precision: null, strategy: false },
    inputs: [], plots: [], hlines: [], fills: [], markers: [],
    signals: [], closeSignals: [],
    risk: { stopLoss: 0, takeProfit: 0, trailing: 0 },
    consts: {}, logs,
  };

  const toSeries = (v: unknown, what: string): number[] => {
    let arr: number[];
    if (typeof v === "number" || typeof v === "boolean") arr = new Array(n).fill(Number(v));
    else if (typeof v === "function") arr = Array.from({ length: n }, (_, i) => Number((v as (i: number) => unknown)(i)));
    else if (v && typeof (v as { length: number }).length === "number") {
      arr = Array.from(v as ArrayLike<unknown>, (x) => (x == null ? NaN : Number(x)));
    } else throw new Error(`${what}: 需要长度为 ${n} 的数组、数字或函数 (i) => value`);
    if (arr.length !== n) throw new Error(`${what}: 得到 ${arr.length} 个值，但图表有 ${n} 根 K 线`);
    return arr;
  };

  const elementwise = (f: (a: number, b: number) => number) => (a: unknown, b: unknown): Series => {
    const A = Array.isArray(a), B = Array.isArray(b);
    if (!A && !B) return new Array(n).fill(f(Number(a), Number(b)));
    return Array.from({ length: n }, (_, i) => f(A ? Number((a as Series)[i]) : Number(a), B ? Number((b as Series)[i]) : Number(b)));
  };

  // TA：bar 型函数（atr/kdj）绑定到当前 K 线，用户无需自己传 bars。
  // 其余数组型函数（sma/ema/rsi/boll/macd/cross* 等）原样透出。
  const ta: Record<string, unknown> = { ...TA } as Record<string, unknown>;
  ta.atr = (period = 14) => TA.atr(bars, period);
  ta.kdj = (period = 9) => TA.kdj(bars, period);

  // --- 策略 API：只收集信号，成交交给 Rust ---
  const strat = { declared: false };
  const toWhen = (when: unknown, what: string): boolean[] | true => {
    if (when === undefined || when === true) return true;
    if (when === false || when == null) return false as unknown as boolean[];
    if (typeof when === "function") return toSeries(when, what).map((v) => !!v);
    return toSeries(when, what).map((v) => !!v);
  };
  const needStrategy = (fn: string) => {
    if (!strat.declared) throw new Error(`strategy.${fn}(): 请先在脚本顶部调用 strategy('名称', {...})`);
  };
  const DIRS: Record<string, "long" | "short"> = { long: "long", short: "short", buy: "long", sell: "short" };

  const strategy = (name: string, opts: { overlay?: boolean; shortName?: string; precision?: number } = {}) => {
    strat.declared = true;
    out.meta.name = String(name || "未命名策略").slice(0, 60);
    out.meta.short = String(opts.shortName || "").slice(0, 30);
    out.meta.overlay = opts.overlay !== false;
    out.meta.strategy = true;
    if (opts.precision != null) out.meta.precision = Math.max(0, Math.min(10, Math.round(opts.precision)));
  };
  (strategy as unknown as Record<string, Function>).entry = (
    id: string, direction: string, when: unknown = true, opts: { qty?: number } = {},
  ) => {
    needStrategy("entry");
    const dir = DIRS[String(direction).toLowerCase()];
    if (!dir) throw new Error(`strategy.entry(): 方向必须是 'long' 或 'short'，收到 ${JSON.stringify(direction)}`);
    out.signals.push({ id: String(id), dir, when: toWhen(when, "strategy.entry()"), qty: opts.qty });
  };
  (strategy as unknown as Record<string, Function>).close = (id: string | null = null, when: unknown = true) => {
    needStrategy("close");
    void id;
    out.closeSignals.push({ when: toWhen(when, "strategy.close()") });
  };
  (strategy as unknown as Record<string, Function>).closeAll = (when: unknown = true) => {
    (strategy as unknown as Record<string, Function>).close(null, when);
  };
  (strategy as unknown as Record<string, Function>).exit = (opts: { stopLoss?: number; takeProfit?: number; trailing?: number } = {}) => {
    needStrategy("exit");
    out.risk.stopLoss = Number(opts.stopLoss) || 0;
    out.risk.takeProfit = Number(opts.takeProfit) || 0;
    out.risk.trailing = Number(opts.trailing) || 0;
  };

  const api: Record<string, unknown> = {
    strategy,
    // 数据序列
    open, high, low, close, volume, time, hl2, hlc3, ohlc4, n,
    bar_index: Array.from({ length: n }, (_, i) => i),
    timeframe: { seconds: ctx.tfSec || 0, intraday: (ctx.tfSec || 0) < 86400 },
    symbol: ctx.symbol || "",
    indicator(name: string, opts: { shortName?: string; overlay?: boolean; precision?: number } = {}) {
      out.meta.name = String(name || "未命名脚本").slice(0, 60);
      out.meta.short = String(opts.shortName || "").slice(0, 30);
      out.meta.overlay = !!opts.overlay;
      if (opts.precision != null) out.meta.precision = Math.max(0, Math.min(10, Math.round(opts.precision)));
    },
    input(title: string, def: unknown, opts: { options?: unknown[]; min?: number; max?: number; step?: number } = {}) {
      const key = `in${out.inputs.length}`;
      const type = typeof def === "boolean" ? "bool" : typeof def === "string" ? (opts.options ? "select" : "text") : "number";
      if (type === "number" && !Number.isFinite(Number(def))) throw new Error(`input("${title}"): 默认值必须是数字、布尔或文本`);
      out.inputs.push({
        key, title: String(title), def, type,
        options: opts.options ? opts.options.map(String) : undefined,
        min: opts.min, max: opts.max, step: opts.step,
      });
      const v = inputs[key];
      if (v === undefined) return def;
      if (type === "number") return Number.isFinite(Number(v)) ? Number(v) : def;
      if (type === "bool") return !!v;
      return String(v);
    },
    plot(series: unknown, opts: { title?: string; color?: string; style?: string; width?: number } = {}) {
      const values = toSeries(series, "plot()");
      const key = `p${out.plots.length}`;
      let color = typeof opts.color === "string" ? opts.color : "#4FA3F7";
      out.plots.push({
        key,
        title: String(opts.title || `Plot ${out.plots.length + 1}`).slice(0, 40),
        color, colors: null,
        type: STYLES.includes(opts.style as PlotStyle) ? (opts.style as PlotStyle) : "line",
        width: opts.width ? Math.max(1, Math.min(4, Number(opts.width))) : undefined,
        values: Float64Array.from(values),
      });
      return key;
    },
    hline(price: number, opts: { color?: string } = {}) {
      const p = Number(price);
      if (!Number.isFinite(p)) throw new Error(`hline(): 价格必须是有限数字，收到 ${JSON.stringify(price)}`);
      out.hlines.push({ price: p, color: opts.color || "#8E8A82" });
    },
    // 在两条 plot 线之间填色。plot() 返回 'p0'/'p1'…，直接把 key 传进来。
    fill(from: unknown, to: unknown, opts: { color?: string } = {}) {
      const f = String(from), t = String(to);
      if (!/^p\d+$/.test(f) || !/^p\d+$/.test(t)) {
        throw new Error(`fill(): 参数必须是 plot() 的返回值（如 p0、p1），收到 ${f} / ${t}`);
      }
      out.fills.push({ from: f, to: t, color: opts.color || "rgba(79,163,247,0.18)" });
    },
    marker(condition: unknown, opts: { shape?: string; position?: string; color?: string; text?: string } = {}) {
      const c = toSeries(condition, "marker()");
      const shape = SHAPES[opts.shape || ""] || "circle";
      const position = POSITIONS[opts.position || ""] || "aboveBar";
      for (let i = 0; i < n && out.markers.length < 5000; i++) {
        if (c[i]) out.markers.push({ i, shape, position, color: opts.color || "#4FA3F7", text: opts.text ? String(opts.text).slice(0, 20) : "" });
      }
    },
    log(...args: unknown[]) {
      if (logs.length < 200) logs.push(args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" "));
    },
    // 辅助
    ta,
    na: NaN,
    nz: (x: Series | number, y = 0): Series | number =>
      Array.isArray(x) ? x.map((v) => (v != null && Number.isFinite(v) ? v : y)) : (Number.isFinite(x) ? x : y),
    add: elementwise((a, b) => a + b),
    sub: elementwise((a, b) => a - b),
    mul: elementwise((a, b) => a * b),
    div: elementwise((a, b) => a / b),
    max: elementwise(Math.max),
    min: elementwise(Math.min),
    iff: (cond: Series | boolean, a: Series | number, b: Series | number): Series =>
      Array.from({ length: n }, (_, i) => ((Array.isArray(cond) ? cond[i] : cond) ? (Array.isArray(a) ? a[i] : a) : (Array.isArray(b) ? b[i] : b)) as number | null),
    rgba(hex: string, alpha = 1) {
      const h = String(hex).replace("#", "");
      const v = parseInt(h.length === 3 ? h.split("").map((x) => x + x).join("") : h, 16);
      return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${alpha})`;
    },
    crossAbove: TA.crossAbove,
    crossBelow: TA.crossBelow,
  };

  const names = [...Object.keys(api), ...BLOCKED];
  let fn: Function;
  try {
    fn = compile(names, code);
  } catch (e) {
    return { ok: false, error: `${(e as Error).name}: ${(e as Error).message}`, line: null, logs };
  }
  try {
    fn(...Object.values(api), ...BLOCKED.map(() => undefined));
  } catch (e) {
    return {
      ok: false,
      error: `${(e as Error).name || "Error"}: ${(e as Error).message}`,
      line: errorLine(e, names),
      logs,
    };
  }
  return { ok: true, result: out, logs };
}

self.onmessage = (e: MessageEvent<RunMessage>) => {
  const msg = e.data;
  const started = performance.now();
  let res: ReturnType<typeof run>;
  try {
    res = run(msg);
  } catch (err) {
    res = { ok: false, error: String((err as Error)?.message || err), line: null, logs: [] };
  }
  const payload = { id: msg.id, ...res, ms: Math.round(performance.now() - started) };
  // Float64Array 零拷贝转移；plot 结果交给主线程绘制，不再传回脚本内部引用。
  const transfer: Transferable[] = res.ok && res.result
    ? res.result.plots.map((p) => p.values.buffer)
    : [];
  (self as unknown as Worker).postMessage(payload, transfer);
};
