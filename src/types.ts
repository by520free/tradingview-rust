export interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  // Rust 指标值以 rust_<kind>_<lineIndex> 形式挂在 K 线上，供图表自定义指标读取。
  // 脚本 hline/fill 的颜色以字符串形式挂在 shc_*/sfc_* 扩展字段上。
  [key: string]: number | string | null | undefined;
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

// ---------- 回测 ----------

export type SizeType = "percent" | "cash" | "fixed";
export type FillOn = "open" | "close";
export type Direction = "long" | "short";

export interface BacktestConfig {
  initial_capital: number;
  size_type: SizeType;
  size_value: number;
  commission: number;
  slippage: number;
  pyramiding: number;
  fill_on: FillOn;
  stop_loss: number;
  take_profit: number;
  trailing: number;
}

export interface Signal {
  id: string;
  dir: Direction;
  when: boolean[];
  qty?: number | null;
}

export interface Trade {
  id: string;
  side: string;
  qty: number;
  entry_index: number;
  entry_price: number;
  exit_index: number;
  exit_price: number;
  pnl: number;
  pnl_pct: number;
  commission: number;
  reason: string;
  bars: number;
}

export interface Marker {
  index: number;
  kind: string;
  side: string;
  price: number;
  reason: string;
}

export interface Stats {
  net_profit: number;
  net_profit_pct: number;
  gross_profit: number;
  gross_loss: number;
  trades: number;
  wins: number;
  losses: number;
  win_rate: number;
  avg_trade: number;
  largest_win: number;
  largest_loss: number;
  max_consec_wins: number;
  max_consec_losses: number;
}

export interface BacktestResult {
  trades: Trade[];
  markers: Marker[];
  equity: number[];
  drawdown: number[];
  final_equity: number;
  max_drawdown: number;
  max_drawdown_pct: number;
  buy_hold_pct: number;
  commission_paid: number;
  exposure_pct: number;
  sharpe: number | null;
  stats: Stats;
  bars: number;
}
