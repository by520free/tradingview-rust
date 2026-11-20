import { invoke } from "@tauri-apps/api/core";
import type { Bar, IndicatorRequest, IndicatorResult, Timeframe } from "./types";

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
