// 主线程侧脚本沙箱管理器：创建 Worker、超时终止、按 id 匹配回包。
// 脚本在独立 Worker 中运行，超时或异常时直接 terminate，杜绝死循环卡死主线程。

import type { Bar } from "../types";
import type { BacktestConfig, Direction, Signal } from "../types";

export interface ScriptPlot {
  key: string;
  title: string;
  color: string;
  type: string;
  values: Float64Array;
}
export interface ScriptMarker {
  i: number;
  shape: string;
  position: string;
  color: string;
  text: string;
}
export interface ScriptStrategySignal {
  id: string;
  dir: "long" | "short";
  when: boolean[] | true;
  qty?: number;
}
export interface ScriptOutput {
  ok: boolean;
  error?: string;
  line?: number | null;
  logs: string[];
  ms: number;
  meta?: {
    name: string;
    short: string;
    overlay: boolean;
    precision: number | null;
    strategy: boolean;
  };
  plots: ScriptPlot[];
  markers: ScriptMarker[];
  signals: ScriptStrategySignal[];
  closeSignals: { when: boolean[] | true }[];
  risk: { stopLoss: number; takeProfit: number; trailing: number };
}

interface RawResult {
  id: number;
  ok: boolean;
  error?: string;
  line?: number | null;
  logs: string[];
  ms: number;
  result?: {
    meta: ScriptOutput["meta"];
    plots: ScriptPlot[];
    markers: ScriptMarker[];
    signals: ScriptStrategySignal[];
    closeSignals: { when: boolean[] | true }[];
    risk: ScriptOutput["risk"];
  };
}

const DEFAULT_TIMEOUT_MS = 3000;

export class ScriptHost {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, {
    resolve: (r: ScriptOutput) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    this.worker = new Worker(new URL("./script-worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (e: MessageEvent<RawResult>) => {
      const raw = e.data;
      const entry = this.pending.get(raw.id);
      if (!entry) return;
      clearTimeout(entry.timer);
      this.pending.delete(raw.id);
      entry.resolve({
        ok: raw.ok,
        error: raw.error,
        line: raw.line,
        logs: raw.logs || [],
        ms: raw.ms,
        plots: raw.result?.plots || [],
        markers: raw.result?.markers || [],
        signals: raw.result?.signals || [],
        closeSignals: raw.result?.closeSignals || [],
        risk: raw.result?.risk || { stopLoss: 0, takeProfit: 0, trailing: 0 },
        meta: raw.result?.meta,
      });
    };
    this.worker.onerror = (e) => {
      // Worker 级错误：拒绝所有挂起请求并重建。
      for (const [id, entry] of this.pending) {
        clearTimeout(entry.timer);
        entry.resolve({
          ok: false, error: `脚本运行时错误: ${e.message}`, line: null,
          logs: [], ms: 0, plots: [], markers: [], signals: [], closeSignals: [],
          risk: { stopLoss: 0, takeProfit: 0, trailing: 0 },
        });
        this.pending.delete(id);
      }
      this.worker?.terminate();
      this.worker = null;
    };
    return this.worker;
  }

  /** 运行脚本。超时会终止整个 Worker（连死循环一起杀掉）。 */
  run(
    code: string,
    bars: Bar[],
    ctx: { symbol: string; tfSec: number },
    inputs: Record<string, unknown> = {},
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<ScriptOutput> {
    const worker = this.ensureWorker();
    const id = ++this.seq;
    const data = {
      time: bars.map((b) => b.time),
      open: bars.map((b) => b.open),
      high: bars.map((b) => b.high),
      low: bars.map((b) => b.low),
      close: bars.map((b) => b.close),
      volume: bars.map((b) => b.volume),
    };
    return new Promise<ScriptOutput>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        // 超时：终止 Worker 并清空后续请求，防止脏状态。
        this.worker?.terminate();
        this.worker = null;
        resolve({
          ok: false, error: `脚本超时（>${timeoutMs}ms），已终止`, line: null,
          logs: [], ms: timeoutMs, plots: [], markers: [], signals: [], closeSignals: [],
          risk: { stopLoss: 0, takeProfit: 0, trailing: 0 },
        });
      }, timeoutMs);
      this.pending.set(id, { resolve, timer });
      worker.postMessage({ id, code, data, inputs, ctx });
    });
  }

  /** 把脚本策略信号转换成 Rust 回测引擎需要的 Signal[]。 */
  static signalsToBacktest(
    out: ScriptOutput,
    barCount: number,
    config: BacktestConfig,
  ): { signals: Signal[]; closeSignals: Signal[] } {
    const n = barCount;
    const expand = (when: boolean[] | true): boolean[] =>
      when === true ? new Array(n).fill(true) : when;
    const signals: Signal[] = out.signals.map((s) => ({
      id: s.id,
      dir: s.dir as Direction,
      when: expand(s.when),
      qty: s.qty ?? null,
    }));
    const closeSignals: Signal[] = out.closeSignals.map((c, i) => ({
      id: `close_${i}`,
      dir: "long" as Direction,
      when: expand(c.when),
    }));
    // 合并脚本里 strategy.exit() 声明的风控参数
    if (out.risk.stopLoss > 0) config.stop_loss = out.risk.stopLoss;
    if (out.risk.takeProfit > 0) config.take_profit = out.risk.takeProfit;
    if (out.risk.trailing > 0) config.trailing = out.risk.trailing;
    return { signals, closeSignals };
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    for (const [, entry] of this.pending) clearTimeout(entry.timer);
    this.pending.clear();
  }
}
