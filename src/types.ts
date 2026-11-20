export interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IndicatorLine {
  name: string;
  values: (number | null)[];
}

export interface IndicatorResult {
  lines: IndicatorLine[];
}

export interface IndicatorRequest {
  kind: string;
  params: number[];
}

export type Timeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
