import { Channel, invoke } from "@tauri-apps/api/core";
import type {
  Bar,
  BacktestConfig,
  BacktestResult,
  IndicatorRequest,
  IndicatorResult,
  Signal,
  Timeframe,
} from "./types";

export async function fetchBars(
  symbol: string,
  timeframe: Timeframe,
  limit = 1000,
): Promise<Bar[]> {
  return invoke<Bar[]>("fetch_bars", { symbol, timeframe, limit });
}

export async function reloadBars(
  symbol: string,
  timeframe: Timeframe,
  limit = 1000,
): Promise<Bar[]> {
  return invoke<Bar[]>("reload_bars", { symbol, timeframe, limit });
}

export async function computeIndicators(
  symbol: string,
  timeframe: Timeframe,
  requests: IndicatorRequest[],
): Promise<IndicatorResult[]> {
  return invoke<IndicatorResult[]>("compute_indicators", {
    symbol,
    timeframe,
    requests,
  });
}

export async function listIndicators(): Promise<string[]> {
  return invoke<string[]>("list_indicators");
}

export async function listSymbols(): Promise<string[]> {
  return invoke<string[]>("list_symbols");
}

export async function runBacktest(
  symbol: string,
  timeframe: Timeframe,
  config: BacktestConfig,
  signals: Signal[],
  closeSignals: Signal[],
): Promise<BacktestResult> {
  return invoke<BacktestResult>("run_backtest", {
    symbol,
    timeframe,
    config,
    signals,
    closeSignals,
  });
}

export async function subscribeRealtime(
  symbol: string,
  timeframe: Timeframe,
  onBar: (bar: Bar) => void,
): Promise<void> {
  const channel = new Channel<Bar>();
  channel.onmessage = onBar;
  return invoke<void>("subscribe_realtime", { symbol, timeframe, onBar: channel });
}

export async function importCsv(path: string): Promise<Bar[]> {
  return invoke<Bar[]>("import_csv", { path });
}
