//! 事件驱动回测引擎。成交语义参考 Wickline（MIT）的 backtest.js：
//!  - 信号在一根 bar 的 close 产生，默认在下一根 bar 的 open 成交（fill_on=open）。
//!    信号永远看不到未来数据。
//!  - 单一净持仓：反向信号先平仓再开仓（反转）；pyramiding 控制同向堆叠手数。
//!  - 止损/止盈/移动止损用每根 bar 的 high/low 检查；若 bar 的 open 已越过价位，按 open 成交（跳空）。
//!  - 同一根 bar 同时触及止损与止盈时，先算止损（保守）。
//!  - 每笔成交收手续费（成交额百分比），滑点使成交价向不利方向偏移（百分比）。

use super::model::Bar;
use serde::{Deserialize, Serialize};

/// 仓位 sizing 方式
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SizeType {
    /// size_value 为权益的百分比（如 100 = 满仓）
    Percent,
    /// size_value 为固定现金金额
    Cash,
    /// size_value 为固定数量
    Fixed,
}

/// 成交时机
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FillOn {
    /// 下一根 bar 的 open 成交（默认，防未来函数）
    Open,
    /// 当前 bar 的 close 成交
    Close,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BacktestConfig {
    #[serde(default = "default_capital")]
    pub initial_capital: f64,
    #[serde(default)]
    pub size_type: SizeType,
    #[serde(default = "default_size_value")]
    pub size_value: f64,
    /// 每笔成交手续费，百分比（0.1 = 0.1%）
    #[serde(default)]
    pub commission: f64,
    /// 滑点，百分比
    #[serde(default)]
    pub slippage: f64,
    /// 同向最多堆叠几笔
    #[serde(default = "default_one")]
    pub pyramiding: usize,
    #[serde(default)]
    pub fill_on: FillOn,
    /// 止损百分比（>0 生效），基于开仓价
    #[serde(default)]
    pub stop_loss: f64,
    /// 止盈百分比（>0 生效），基于开仓价
    #[serde(default)]
    pub take_profit: f64,
    /// 移动止损百分比（>0 生效），基于持仓期间最佳价
    #[serde(default)]
    pub trailing: f64,
}

fn default_capital() -> f64 { 10_000.0 }
fn default_size_value() -> f64 { 100.0 }
fn default_one() -> usize { 1 }

impl Default for BacktestConfig {
    fn default() -> Self {
        Self {
            initial_capital: default_capital(),
            size_type: SizeType::Percent,
            size_value: default_size_value(),
            commission: 0.0,
            slippage: 0.0,
            pyramiding: 1,
            fill_on: FillOn::Open,
            stop_loss: 0.0,
            take_profit: 0.0,
            trailing: 0.0,
        }
    }
}

/// 一条信号规则：when[i] 为 true 表示第 i 根 bar 的 close 触发。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Signal {
    pub id: String,
    pub dir: Direction,
    /// 与 bars 等长的布尔序列
    pub when: Vec<bool>,
    #[serde(default)]
    pub qty: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Direction { Long, Short }

/// 一笔成交标记，供前端在图表上画箭头
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Marker {
    pub index: usize,
    pub kind: String,
    pub side: String,
    pub price: f64,
    pub reason: String,
}

/// 平仓的一笔交易
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Trade {
    pub id: String,
    pub side: String,
    pub qty: f64,
    pub entry_index: usize,
    pub entry_price: f64,
    pub exit_index: usize,
    pub exit_price: f64,
    pub pnl: f64,
    pub pnl_pct: f64,
    pub commission: f64,
    pub reason: String,
    pub bars: usize,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Stats {
    pub net_profit: f64,
    pub net_profit_pct: f64,
    pub gross_profit: f64,
    pub gross_loss: f64,
    pub trades: usize,
    pub wins: usize,
    pub losses: usize,
    pub win_rate: f64,
    pub avg_trade: f64,
    pub largest_win: f64,
    pub largest_loss: f64,
    pub max_consec_wins: usize,
    pub max_consec_losses: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BacktestResult {
    pub trades: Vec<Trade>,
    pub markers: Vec<Marker>,
    /// 与 bars 等长的权益曲线
    pub equity: Vec<f64>,
    /// 与 bars 等长的回撤曲线（负值，百分比）
    pub drawdown: Vec<f64>,
    pub final_equity: f64,
    pub max_drawdown: f64,
    pub max_drawdown_pct: f64,
    pub buy_hold_pct: f64,
    pub commission_paid: f64,
    pub exposure_pct: f64,
    pub sharpe: Option<f64>,
    pub stats: Stats,
    pub bars: usize,
}

#[derive(Debug, Clone)]
struct Lot {
    id: String,
    side: Direction,
    qty: f64,
    price: f64,
    index: usize,
    entry_comm: f64,
    best: f64,
}

/// 滑点：买单向上、卖单向下偏移。
fn slip(price: f64, is_buy: bool, slippage_pct: f64) -> f64 {
    price * (1.0 + (if is_buy { 1.0 } else { -1.0 }) * slippage_pct / 100.0)
}

fn sign(d: Direction) -> f64 {
    match d { Direction::Long => 1.0, Direction::Short => -1.0 }
}

/// 运行回测。bars 与每条信号的 when 必须等长（不足处按 false 处理）。
pub fn run(bars: &[Bar], config: &BacktestConfig, signals: &[Signal], close_signals: &[Signal]) -> BacktestResult {
    let n = bars.len();
    let mut lots: Vec<Lot> = Vec::new();
    let mut trades: Vec<Trade> = Vec::new();
    let mut markers: Vec<Marker> = Vec::new();
    let mut equity = vec![config.initial_capital; n];
    let mut drawdown = vec![0.0; n];
    let mut realized = 0.0;
    let mut commission_paid = 0.0;
    let mut pending: Vec<(usize, Direction, Option<f64>, String)> = Vec::new();
    let mut bars_in_market = 0usize;

    fn open_pnl(lots: &[Lot], price: f64) -> f64 {
        lots.iter().map(|l| sign(l.side) * (price - l.price) * l.qty).sum()
    }
    fn equity_at(lots: &[Lot], realized: f64, capital: f64, price: f64) -> f64 {
        capital + realized + open_pnl(lots, price)
    }
    fn position_side(lots: &[Lot]) -> Option<Direction> {
        lots.first().map(|l| l.side)
    }

    fn close_lot(
        lot: Lot, price: f64, index: usize, reason: &str, config: &BacktestConfig,
        realized: &mut f64, commission_paid: &mut f64, trades: &mut Vec<Trade>, markers: &mut Vec<Marker>,
    ) {
        let px = slip(price, lot.side == Direction::Short, config.slippage);
        let comm = (px * lot.qty).abs() * config.commission / 100.0;
        let gross = sign(lot.side) * (px - lot.price) * lot.qty;
        *realized += gross - comm;
        *commission_paid += comm;
        let pnl = gross - comm - lot.entry_comm;
        let notional = (lot.price * lot.qty).abs();
        trades.push(Trade {
            id: lot.id.clone(),
            side: match lot.side { Direction::Long => "long".into(), Direction::Short => "short".into() },
            qty: lot.qty,
            entry_index: lot.index,
            entry_price: lot.price,
            exit_index: index,
            exit_price: px,
            pnl,
            pnl_pct: if notional > 0.0 { pnl / notional * 100.0 } else { 0.0 },
            commission: comm + lot.entry_comm,
            reason: reason.to_string(),
            bars: index.saturating_sub(lot.index),
        });
        markers.push(Marker {
            index, kind: "exit".into(),
            side: match lot.side { Direction::Long => "long".into(), Direction::Short => "short".into() },
            price: px, reason: reason.to_string(),
        });
    }

    fn open_lot(
        id: &str, dir: Direction, qty_opt: Option<f64>, price: f64, index: usize, config: &BacktestConfig,
        eq: f64, realized: &mut f64, commission_paid: &mut f64, lots: &mut Vec<Lot>, markers: &mut Vec<Marker>,
    ) {
        let px = slip(price, dir == Direction::Long, config.slippage);
        let mut qty = qty_opt.unwrap_or(0.0);
        if !(qty > 0.0) {
            qty = match config.size_type {
                SizeType::Fixed => config.size_value,
                SizeType::Cash => config.size_value / px,
                SizeType::Percent => (eq * config.size_value) / 100.0 / px,
            };
        }
        if !(qty > 0.0) || !qty.is_finite() || eq <= 0.0 || px <= 0.0 { return; }
        let comm = (px * qty).abs() * config.commission / 100.0;
        *realized -= comm;
        *commission_paid += comm;
        lots.push(Lot {
            id: id.to_string(), side: dir, qty, price: px, index, entry_comm: comm,
            best: match dir { Direction::Long => f64::NEG_INFINITY, Direction::Short => f64::INFINITY },
        });
        markers.push(Marker {
            index, kind: "entry".into(),
            side: match dir { Direction::Long => "long".into(), Direction::Short => "short".into() },
            price: px, reason: id.to_string(),
        });
    }

    /// 止损/止盈/移动止损检查。价位在上一根 bar 收盘时已知。
    fn check_exits(
        i: usize, b: &Bar, config: &BacktestConfig, lots: &mut Vec<Lot>,
        realized: &mut f64, commission_paid: &mut f64, trades: &mut Vec<Trade>, markers: &mut Vec<Marker>,
    ) {
        if lots.is_empty() { return; }
        if config.fill_on == FillOn::Close && lots.iter().any(|l| l.index == i) { return; }
        let snapshot: Vec<Lot> = lots.clone();
        for lot in snapshot {
            let long = lot.side == Direction::Long;
            let mut stop: Option<f64> = None;
            let mut stop_reason = "Stop loss";
            let mut target: Option<f64> = None;
            if config.stop_loss > 0.0 {
                let s = if long { lot.price * (1.0 - config.stop_loss / 100.0) } else { lot.price * (1.0 + config.stop_loss / 100.0) };
                stop = Some(s);
            }
            if config.take_profit > 0.0 {
                let t = if long { lot.price * (1.0 + config.take_profit / 100.0) } else { lot.price * (1.0 - config.take_profit / 100.0) };
                target = Some(t);
            }
            if config.trailing > 0.0 && lot.best.is_finite() {
                let s = if long { lot.best * (1.0 - config.trailing / 100.0) } else { lot.best * (1.0 + config.trailing / 100.0) };
                stop = Some(match stop { None => s, Some(prev) => if long { prev.max(s) } else { prev.min(s) } });
                stop_reason = "Trailing stop";
            }
            // 跳空按 open 成交；同根同时触及止损止盈时先算止损（保守）。
            let mut hit: Option<(f64, &str)> = None;
            if let Some(s) = stop {
                if (long && b.open <= s) || (!long && b.open >= s) { hit = Some((b.open, stop_reason)); }
            }
            if hit.is_none() {
                if let Some(t) = target {
                    if (long && b.open >= t) || (!long && b.open <= t) { hit = Some((b.open, "Take profit")); }
                }
            }
            if hit.is_none() {
                if let Some(s) = stop {
                    if (long && b.low <= s) || (!long && b.high >= s) { hit = Some((s, stop_reason)); }
                }
            }
            if hit.is_none() {
                if let Some(t) = target {
                    if (long && b.high >= t) || (!long && b.low <= t) { hit = Some((t, "Take profit")); }
                }
            }
            if let Some((px, reason)) = hit {
                if let Some(pos) = lots.iter().position(|l| l.id == lot.id && l.index == lot.index) {
                    let l = lots.remove(pos);
                    close_lot(l, px, i, reason, config, realized, commission_paid, trades, markers);
                }
            }
        }
    }

    for i in 0..n {
        let b = &bars[i];
        // 1) 上一根 close 的信号在本根 open 成交
        if !pending.is_empty() {
            for (sig_idx, dir, qty, id) in pending.drain(..) {
                let _ = sig_idx;
                if let Some(cur) = position_side(&lots) {
                    if cur != dir {
                        for l in std::mem::take(&mut lots) {
                            close_lot(l, b.open, i, "Reverse", config, &mut realized, &mut commission_paid, &mut trades, &mut markers);
                        }
                    }
                }
                if lots.len() < config.pyramiding {
                    let eq = equity_at(&lots, realized, config.initial_capital, b.open);
                    open_lot(&id, dir, qty, b.open, i, config, eq, &mut realized, &mut commission_paid, &mut lots, &mut markers);
                }
            }
        }
        // 2) 检查止损止盈
        check_exits(i, b, config, &mut lots, &mut realized, &mut commission_paid, &mut trades, &mut markers);
        // 3) 更新最佳价（移动止损）
        for l in lots.iter_mut() {
            l.best = match l.side {
                Direction::Long => l.best.max(b.high),
                Direction::Short => l.best.min(b.low),
            };
        }
        // 4) 本根 close 产生信号：先处理平仓信号，再处理开仓信号。
        let mut queue: Vec<(Direction, Option<f64>, String)> = Vec::new();
        for sig in close_signals {
            if sig.when.get(i).copied().unwrap_or(false) {
                for l in std::mem::take(&mut lots) {
                    close_lot(l, b.close, i, "Close", config, &mut realized, &mut commission_paid, &mut trades, &mut markers);
                }
            }
        }
        for sig in signals {
            if sig.when.get(i).copied().unwrap_or(false) {
                queue.push((sig.dir, sig.qty, sig.id.clone()));
            }
        }
        if config.fill_on == FillOn::Close {
            for (dir, qty, id) in queue {
                if let Some(cur) = position_side(&lots) {
                    if cur != dir {
                        for l in std::mem::take(&mut lots) {
                            close_lot(l, b.close, i, "Reverse", config, &mut realized, &mut commission_paid, &mut trades, &mut markers);
                        }
                    }
                }
                if lots.len() < config.pyramiding {
                    let eq = equity_at(&lots, realized, config.initial_capital, b.close);
                    open_lot(&id, dir, qty, b.close, i, config, eq, &mut realized, &mut commission_paid, &mut lots, &mut markers);
                }
            }
        } else {
            pending = queue.into_iter().map(|(dir, qty, id)| (i, dir, qty, id)).collect();
        }
        if !lots.is_empty() { bars_in_market += 1; }
        equity[i] = equity_at(&lots, realized, config.initial_capital, b.close);
    }

    // 权益曲线与最大回撤
    let first = bars.first().map(|b| b.close).unwrap_or(0.0);
    let mut peak = f64::NEG_INFINITY;
    let mut max_dd = 0.0;
    let mut max_dd_pct = 0.0;
    for (i, e) in equity.iter().enumerate() {
        peak = peak.max(*e);
        let dd = peak - e;
        drawdown[i] = if peak > 0.0 { -(dd / peak) * 100.0 } else { 0.0 };
        if dd > max_dd { max_dd = dd; }
        if peak > 0.0 && dd / peak > max_dd_pct { max_dd_pct = dd / peak; }
    }
    let last = bars.last().map(|b| b.close).unwrap_or(0.0);
    let final_equity = equity.last().copied().unwrap_or(config.initial_capital);
    let buy_hold_pct = if first > 0.0 { (last / first - 1.0) * 100.0 } else { 0.0 };

    let mut rets = Vec::with_capacity(n.saturating_sub(1));
    for i in 1..n {
        if equity[i - 1] > 0.0 { rets.push(equity[i] / equity[i - 1] - 1.0); }
    }
    let mean = if rets.is_empty() { 0.0 } else { rets.iter().sum::<f64>() / rets.len() as f64 };
    let sd = if rets.is_empty() { 0.0 } else {
        (rets.iter().map(|r| (r - mean).powi(2)).sum::<f64>() / rets.len() as f64).sqrt()
    };
    let sharpe = if sd > 0.0 { Some(mean / sd * (252.0_f64).sqrt()) } else { None };

    let mut stats = Stats::default();
    let mut gp = 0.0;
    let mut gl = 0.0;
    let mut streak_w = 0usize;
    let mut streak_l = 0usize;
    for t in &trades {
        if t.pnl > 0.0 {
            gp += t.pnl;
            stats.wins += 1;
            streak_w += 1; streak_l = 0;
            stats.max_consec_wins = stats.max_consec_wins.max(streak_w);
            stats.largest_win = stats.largest_win.max(t.pnl);
        } else {
            gl += t.pnl;
            stats.losses += 1;
            streak_l += 1; streak_w = 0;
            stats.max_consec_losses = stats.max_consec_losses.max(streak_l);
            stats.largest_loss = stats.largest_loss.min(t.pnl);
        }
    }
    stats.trades = trades.len();
    stats.gross_profit = gp;
    stats.gross_loss = gl;
    stats.net_profit = gp + gl;
    stats.net_profit_pct = if config.initial_capital > 0.0 { (gp + gl) / config.initial_capital * 100.0 } else { 0.0 };
    stats.win_rate = if stats.trades > 0 { stats.wins as f64 / stats.trades as f64 * 100.0 } else { 0.0 };
    stats.avg_trade = if stats.trades > 0 { (gp + gl) / stats.trades as f64 } else { 0.0 };

    BacktestResult {
        trades, markers, equity, drawdown,
        final_equity,
        max_drawdown: max_dd,
        max_drawdown_pct: max_dd_pct * 100.0,
        buy_hold_pct,
        commission_paid,
        exposure_pct: if n > 0 { bars_in_market as f64 / n as f64 * 100.0 } else { 0.0 },
        sharpe,
        stats,
        bars: n,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bars(n: usize, price: f64) -> Vec<Bar> {
        (0..n).map(|i| Bar {
            time: i as i64 * 60_000,
            open: price, high: price, low: price, close: price, volume: 1.0,
        }).collect()
    }

    fn signal(n: usize, at: usize, dir: Direction) -> Signal {
        let mut when = vec![false; n];
        if at < n { when[at] = true; }
        Signal { id: "T".into(), dir, when, qty: Some(1.0) }
    }

    #[test]
    fn no_future_leak_signal_fills_next_open() {
        // 第 10 根 close 出多头信号，必须在第 11 根 open 成交，绝不能是第 10 根。
        let mut data = bars(20, 100.0);
        data[11].open = 110.0;
        let cfg = BacktestConfig::default();
        let r = run(&data, &cfg, &[signal(20, 10, Direction::Long)], &[]);
        assert_eq!(r.trades.len(), 1, "应产生一笔交易");
        assert_eq!(r.trades[0].entry_index, 11, "下一根 bar 的 open 成交");
        assert_eq!(r.trades[0].entry_price, 110.0);
    }

    #[test]
    fn stop_hit_before_target_when_both_touched() {
        // 第 11 根 bar 同时触及止损(95)和止盈(105)，保守起见先算止损。
        let mut data = bars(20, 100.0);
        data[11].high = 106.0;
        data[11].low = 94.0;
        let cfg = BacktestConfig { stop_loss: 5.0, take_profit: 5.0, ..Default::default() };
        let r = run(&data, &cfg, &[signal(20, 10, Direction::Long)], &[]);
        // 先被止损平掉，之后信号已用尽，不会再开仓
        let exit = r.trades.iter().find(|t| t.reason == "Stop loss" || t.reason == "Take profit");
        assert!(exit.is_some(), "应触发止损或止盈");
        // 同 bar 内止损优先：open=100 未越过任一价位，low<=95 触发止损
        assert_eq!(exit.unwrap().reason, "Stop loss");
    }

    #[test]
    fn gap_open_fills_at_open_not_stop_price() {
        // 第 11 根跳空低开到 90，止损位 95，应按 open=90 成交而非 95。
        let mut data = bars(20, 100.0);
        data[11].open = 90.0;
        data[11].high = 91.0;
        let cfg = BacktestConfig { stop_loss: 5.0, ..Default::default() };
        let r = run(&data, &cfg, &[signal(20, 10, Direction::Long)], &[]);
        let exit = r.trades.iter().find(|t| t.reason == "Stop loss").expect("应止损");
        assert_eq!(exit.exit_price, 90.0, "跳空按 open 成交");
    }

    #[test]
    fn commission_and_slippage_applied() {
        let mut data = bars(20, 100.0);
        data[11].open = 100.0;
        let cfg = BacktestConfig { commission: 0.1, slippage: 0.1, size_type: SizeType::Fixed, size_value: 10.0, ..Default::default() };
        let r = run(&data, &cfg, &[signal(20, 10, Direction::Long)], &[]);
        assert_eq!(r.trades[0].entry_price, 100.1, "买单滑点向上");
        assert!(r.commission_paid > 0.0, "应收取手续费");
    }
}
