//! 指标计算引擎。首批实现 10 个核心指标，统一通过 compute() 分发。
//! 所有函数输入 K 线切片，输出与输入等长的 Option<f64> 序列（预热期为 None）。

use super::model::{Bar, IndicatorLine, IndicatorRequest, IndicatorResult};

fn sma(values: &[f64], period: usize) -> Vec<Option<f64>> {
    let mut out = vec![None; values.len()];
    if period == 0 || values.len() < period {
        return out;
    }
    let mut sum = 0.0;
    for (i, &v) in values.iter().enumerate() {
        sum += v;
        if i >= period {
            sum -= values[i - period];
        }
        if i + 1 >= period {
            out[i] = Some(sum / period as f64);
        }
    }
    out
}

fn ema(values: &[f64], period: usize) -> Vec<Option<f64>> {
    let mut out = vec![None; values.len()];
    if period == 0 || values.len() < period {
        return out;
    }
    let k = 2.0 / (period as f64 + 1.0);
    let mut prev = values[..period].iter().sum::<f64>() / period as f64;
    out[period - 1] = Some(prev);
    for i in period..values.len() {
        prev = values[i] * k + prev * (1.0 - k);
        out[i] = Some(prev);
    }
    out
}

fn rsi(bars: &[Bar], period: usize) -> Vec<Option<f64>> {
    let mut out = vec![None; bars.len()];
    if bars.len() <= period {
        return out;
    }
    let mut gain = 0.0;
    let mut loss = 0.0;
    for i in 1..=period {
        let d = bars[i].close - bars[i - 1].close;
        if d > 0.0 { gain += d } else { loss -= d }
    }
    let mut avg_gain = gain / period as f64;
    let mut avg_loss = loss / period as f64;
    out[period] = Some(rsi_value(avg_gain, avg_loss));
    for i in (period + 1)..bars.len() {
        let d = bars[i].close - bars[i - 1].close;
        let (g, l) = if d > 0.0 { (d, 0.0) } else { (0.0, -d) };
        avg_gain = (avg_gain * (period as f64 - 1.0) + g) / period as f64;
        avg_loss = (avg_loss * (period as f64 - 1.0) + l) / period as f64;
        out[i] = Some(rsi_value(avg_gain, avg_loss));
    }
    out
}

fn rsi_value(avg_gain: f64, avg_loss: f64) -> f64 {
    if avg_loss == 0.0 { 100.0 } else { 100.0 - 100.0 / (1.0 + avg_gain / avg_loss) }
}

fn macd(bars: &[Bar], fast: usize, slow: usize, signal: usize) -> Vec<IndicatorLine> {
    let closes: Vec<f64> = bars.iter().map(|b| b.close).collect();
    let ef = ema(&closes, fast);
    let es = ema(&closes, slow);
    let diff: Vec<Option<f64>> = ef
        .iter()
        .zip(es.iter())
        .map(|(a, b)| match (a, b) { (Some(a), Some(b)) => Some(a - b), _ => None })
        .collect();
    let flat: Vec<f64> = diff.iter().map(|v| v.unwrap_or(0.0)).collect();
    let dea_raw = ema(&flat, signal);
    let dea: Vec<Option<f64>> = dea_raw
        .iter()
        .zip(diff.iter())
        .map(|(d, x)| if x.is_some() { *d } else { None })
        .collect();
    let hist: Vec<Option<f64>> = diff
        .iter()
        .zip(dea.iter())
        .map(|(a, b)| match (a, b) { (Some(a), Some(b)) => Some((a - b) * 2.0), _ => None })
        .collect();
    vec![
        IndicatorLine { name: "DIF".into(), values: diff },
        IndicatorLine { name: "DEA".into(), values: dea },
        IndicatorLine { name: "MACD".into(), values: hist },
    ]
}

fn bollinger(bars: &[Bar], period: usize, mult: f64) -> Vec<IndicatorLine> {
    let closes: Vec<f64> = bars.iter().map(|b| b.close).collect();
    let mid = sma(&closes, period);
    let mut upper = vec![None; bars.len()];
    let mut lower = vec![None; bars.len()];
    for i in (period - 1)..closes.len() {
        let mean = mid[i].unwrap();
        let variance = closes[i + 1 - period..=i]
            .iter()
            .map(|v| (v - mean).powi(2))
            .sum::<f64>()
            / period as f64;
        let sd = variance.sqrt();
        upper[i] = Some(mean + mult * sd);
        lower[i] = Some(mean - mult * sd);
    }
    vec![
        IndicatorLine { name: "UPPER".into(), values: upper },
        IndicatorLine { name: "MID".into(), values: mid },
        IndicatorLine { name: "LOWER".into(), values: lower },
    ]
}

fn atr(bars: &[Bar], period: usize) -> Vec<Option<f64>> {
    let mut out = vec![None; bars.len()];
    if bars.len() <= period {
        return out;
    }
    let mut trs = vec![0.0; bars.len()];
    for i in 1..bars.len() {
        trs[i] = (bars[i].high - bars[i].low)
            .max((bars[i].high - bars[i - 1].close).abs())
            .max((bars[i].low - bars[i - 1].close).abs());
    }
    let mut prev = trs[1..=period].iter().sum::<f64>() / period as f64;
    out[period] = Some(prev);
    for i in (period + 1)..bars.len() {
        prev = (prev * (period as f64 - 1.0) + trs[i]) / period as f64;
        out[i] = Some(prev);
    }
    out
}

fn kdj(bars: &[Bar], period: usize) -> Vec<IndicatorLine> {
    let mut k_line = vec![None; bars.len()];
    let mut d_line = vec![None; bars.len()];
    let mut j_line = vec![None; bars.len()];
    if bars.len() < period {
        return vec![
            IndicatorLine { name: "K".into(), values: k_line },
            IndicatorLine { name: "D".into(), values: d_line },
            IndicatorLine { name: "J".into(), values: j_line },
        ];
    }
    let (mut k, mut d) = (50.0, 50.0);
    for i in (period - 1)..bars.len() {
        let slice = &bars[i + 1 - period..=i];
        let highest = slice.iter().map(|b| b.high).fold(f64::NEG_INFINITY, f64::max);
        let lowest = slice.iter().map(|b| b.low).fold(f64::INFINITY, f64::min);
        let rsv = if highest == lowest { 50.0 } else { (bars[i].close - lowest) / (highest - lowest) * 100.0 };
        k = (2.0 / 3.0) * k + (1.0 / 3.0) * rsv;
        d = (2.0 / 3.0) * d + (1.0 / 3.0) * k;
        k_line[i] = Some(k);
        d_line[i] = Some(d);
        j_line[i] = Some(3.0 * k - 2.0 * d);
    }
    vec![
        IndicatorLine { name: "K".into(), values: k_line },
        IndicatorLine { name: "D".into(), values: d_line },
        IndicatorLine { name: "J".into(), values: j_line },
    ]
}

fn param(req: &IndicatorRequest, index: usize, default: f64) -> usize {
    let v = req.params.get(index).copied().unwrap_or(default);
    if v <= 0.0 { default as usize } else { v as usize }
}

/// 计算单个指标。kind 不认识时返回空结果（前端据此忽略）。
pub fn compute(bars: &[Bar], req: &IndicatorRequest) -> IndicatorResult {
    let kind = req.kind.to_ascii_lowercase();
    let lines = match kind.as_str() {
        "sma" => vec![IndicatorLine { name: format!("SMA{}", param(req, 0, 20.0)), values: sma(&bars.iter().map(|b| b.close).collect::<Vec<_>>(), param(req, 0, 20.0)) }],
        "ema" => vec![IndicatorLine { name: format!("EMA{}", param(req, 0, 20.0)), values: ema(&bars.iter().map(|b| b.close).collect::<Vec<_>>(), param(req, 0, 20.0)) }],
        "rsi" => vec![IndicatorLine { name: format!("RSI{}", param(req, 0, 14.0)), values: rsi(bars, param(req, 0, 14.0)) }],
        "macd" => macd(bars, param(req, 0, 12.0), param(req, 1, 26.0), param(req, 2, 9.0)),
        "boll" | "bollinger" => bollinger(bars, param(req, 0, 20.0), req.params.get(1).copied().unwrap_or(2.0)),
        "atr" => vec![IndicatorLine { name: format!("ATR{}", param(req, 0, 14.0)), values: atr(bars, param(req, 0, 14.0)) }],
        "kdj" => kdj(bars, param(req, 0, 9.0)),
        "vwap" => {
            let mut cum_pv = 0.0;
            let mut cum_v = 0.0;
            let values: Vec<Option<f64>> = bars.iter().map(|b| {
                let typical = (b.high + b.low + b.close) / 3.0;
                cum_pv += typical * b.volume;
                cum_v += b.volume;
                if cum_v > 0.0 { Some(cum_pv / cum_v) } else { None }
            }).collect();
            vec![IndicatorLine { name: "VWAP".into(), values }]
        }
        "volume_ma" => vec![IndicatorLine { name: format!("VOLMA{}", param(req, 0, 20.0)), values: sma(&bars.iter().map(|b| b.volume).collect::<Vec<_>>(), param(req, 0, 20.0)) }],
        "obv" => {
            let mut obv = 0.0;
            let mut values: Vec<Option<f64>> = vec![Some(0.0); bars.len()];
            for i in 1..bars.len() {
                if bars[i].close > bars[i - 1].close {
                    obv += bars[i].volume;
                } else if bars[i].close < bars[i - 1].close {
                    obv -= bars[i].volume;
                }
                values[i] = Some(obv);
            }
            vec![IndicatorLine { name: "OBV".into(), values }]
        }
        _ => {
            // 核心指标未命中时回退到扩展库。
            return super::indicators_extended::compute_extended(bars, req)
                .unwrap_or(IndicatorResult { lines: vec![] });
        }
    };
    IndicatorResult { lines }
}

/// 返回支持的所有指标 kind，供前端展示菜单（核心 + 扩展）
pub fn supported() -> Vec<&'static str> {
    let mut all = vec!["sma", "ema", "rsi", "macd", "boll", "atr", "kdj", "vwap", "volume_ma", "obv"];
    all.extend(super::indicators_extended::supported_extended());
    all
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sma_basic() {
        let v = vec![1.0, 2.0, 3.0, 4.0, 5.0];
        let r = sma(&v, 3);
        assert_eq!(r, vec![None, None, Some(2.0), Some(3.0), Some(4.0)]);
    }

    #[test]
    fn rsi_all_up_is_100() {
        let bars: Vec<Bar> = (0..20).map(|i| Bar {
            time: i, open: i as f64, high: i as f64 + 1.0,
            low: i as f64, close: i as f64 + 1.0, volume: 1.0,
        }).collect();
        let r = rsi(&bars, 14);
        assert_eq!(r[14], Some(100.0));
    }
}
