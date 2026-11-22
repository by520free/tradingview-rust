//! 扩展指标库：在首批 10 个核心指标之外再提供 20 个常用指标。
//! 每个函数输入 K 线/数值切片，输出与输入等长的 Option<f64> 序列（预热期为 None）。
//! 多线指标返回 Vec<IndicatorLine>。

use super::model::{Bar, IndicatorLine, IndicatorRequest, IndicatorResult};

fn line(name: &str, values: Vec<Option<f64>>) -> IndicatorLine {
    IndicatorLine { name: name.into(), values }
}

fn iparam(req: &IndicatorRequest, index: usize, default: f64) -> usize {
    let v = req.params.get(index).copied().unwrap_or(default);
    if v <= 0.0 { default as usize } else { v as usize }
}

fn dparam(req: &IndicatorRequest, index: usize, default: f64) -> f64 {
    let v = req.params.get(index).copied().unwrap_or(default);
    if v.is_finite() && v > 0.0 { v } else { default }
}

fn ema(values: &[f64], period: usize) -> Vec<Option<f64>> {
    let mut out = vec![None; values.len()];
    if period == 0 || values.len() < period { return out; }
    let k = 2.0 / (period as f64 + 1.0);
    let mut prev = values[..period].iter().sum::<f64>() / period as f64;
    out[period - 1] = Some(prev);
    for i in period..values.len() {
        prev = values[i] * k + prev * (1.0 - k);
        out[i] = Some(prev);
    }
    out
}

fn wma(values: &[f64], period: usize) -> Vec<Option<f64>> {
    let mut out = vec![None; values.len()];
    if period == 0 || values.len() < period { return out; }
    let denom: f64 = (1..=period).map(|x| x as f64).sum();
    for i in (period - 1)..values.len() {
        let mut sum = 0.0;
        for j in 0..period {
            sum += values[i - j] * (period - j) as f64;
        }
        out[i] = Some(sum / denom);
    }
    out
}

fn smma(values: &[f64], period: usize) -> Vec<Option<f64>> {
    let mut out = vec![None; values.len()];
    if period == 0 || values.len() < period { return out; }
    let mut prev = values[..period].iter().sum::<f64>() / period as f64;
    out[period - 1] = Some(prev);
    for i in period..values.len() {
        prev = (prev * (period as f64 - 1.0) + values[i]) / period as f64;
        out[i] = Some(prev);
    }
    out
}

fn stdev(values: &[f64], period: usize) -> Vec<Option<f64>> {
    let mut out = vec![None; values.len()];
    if period == 0 || values.len() < period { return out; }
    for i in (period - 1)..values.len() {
        let slice = &values[i + 1 - period..=i];
        let mean = slice.iter().sum::<f64>() / period as f64;
        let var = slice.iter().map(|v| (v - mean).powi(2)).sum::<f64>() / period as f64;
        out[i] = Some(var.sqrt());
    }
    out
}

fn roc(values: &[f64], period: usize) -> Vec<Option<f64>> {
    let mut out = vec![None; values.len()];
    if period == 0 { return out; }
    for i in period..values.len() {
        let base = values[i - period];
        if base != 0.0 { out[i] = Some((values[i] - base) / base * 100.0); }
    }
    out
}

fn momentum(values: &[f64], period: usize) -> Vec<Option<f64>> {
    let mut out = vec![None; values.len()];
    if period == 0 { return out; }
    for i in period..values.len() {
        out[i] = Some(values[i] - values[i - period]);
    }
    out
}

fn dema(values: &[f64], period: usize) -> Vec<Option<f64>> {
    let e1 = ema(values, period);
    let flat1: Vec<f64> = e1.iter().map(|v| v.unwrap_or(0.0)).collect();
    let e2 = ema(&flat1, period);
    let mut out = vec![None; values.len()];
    for i in 0..values.len() {
        if let (Some(a), Some(b)) = (e1[i], e2[i]) { out[i] = Some(2.0 * a - b); }
    }
    out
}

fn tema(values: &[f64], period: usize) -> Vec<Option<f64>> {
    let e1 = ema(values, period);
    let flat1: Vec<f64> = e1.iter().map(|v| v.unwrap_or(0.0)).collect();
    let e2 = ema(&flat1, period);
    let flat2: Vec<f64> = e2.iter().map(|v| v.unwrap_or(0.0)).collect();
    let e3 = ema(&flat2, period);
    let mut out = vec![None; values.len()];
    for i in 0..values.len() {
        if let (Some(a), Some(b), Some(c)) = (e1[i], e2[i], e3[i]) {
            out[i] = Some(3.0 * a - 3.0 * b + c);
        }
    }
    out
}

fn cci(bars: &[Bar], period: usize) -> Vec<Option<f64>> {
    let mut out = vec![None; bars.len()];
    if period == 0 || bars.len() < period { return out; }
    let tp: Vec<f64> = bars.iter().map(|b| (b.high + b.low + b.close) / 3.0).collect();
    for i in (period - 1)..bars.len() {
        let slice = &tp[i + 1 - period..=i];
        let mean = slice.iter().sum::<f64>() / period as f64;
        let mad = slice.iter().map(|v| (v - mean).abs()).sum::<f64>() / period as f64;
        out[i] = if mad > 0.0 { Some((tp[i] - mean) / (0.015 * mad)) } else { Some(0.0) };
    }
    out
}

fn willr(bars: &[Bar], period: usize) -> Vec<Option<f64>> {
    let mut out = vec![None; bars.len()];
    if period == 0 || bars.len() < period { return out; }
    for i in (period - 1)..bars.len() {
        let slice = &bars[i + 1 - period..=i];
        let hh = slice.iter().map(|b| b.high).fold(f64::NEG_INFINITY, f64::max);
        let ll = slice.iter().map(|b| b.low).fold(f64::INFINITY, f64::min);
        out[i] = if hh != ll { Some(-100.0 * (hh - bars[i].close) / (hh - ll)) } else { Some(-50.0) };
    }
    out
}

fn mfi(bars: &[Bar], period: usize) -> Vec<Option<f64>> {
    let mut out = vec![None; bars.len()];
    if period == 0 || bars.len() <= period { return out; }
    let tp: Vec<f64> = bars.iter().map(|b| (b.high + b.low + b.close) / 3.0).collect();
    let ratio = |p: f64, n: f64| if n == 0.0 { 100.0 } else { 100.0 - 100.0 / (1.0 + p / n) };
    let mut pos = 0.0;
    let mut neg = 0.0;
    for i in 1..=period {
        let flow = tp[i] * bars[i].volume;
        if tp[i] > tp[i - 1] { pos += flow; } else if tp[i] < tp[i - 1] { neg += flow; }
    }
    out[period] = Some(ratio(pos, neg));
    for i in (period + 1)..bars.len() {
        let flow = tp[i] * bars[i].volume;
        if tp[i] > tp[i - 1] { pos += flow; } else if tp[i] < tp[i - 1] { neg += flow; }
        out[i] = Some(ratio(pos, neg));
    }
    out
}

fn adx(bars: &[Bar], period: usize) -> Vec<IndicatorLine> {
    let n = bars.len();
    let (mut plus_di, mut minus_di, mut adx_line) = (vec![None; n], vec![None; n], vec![None; n]);
    if period == 0 || n <= period {
        return vec![line("+DI", plus_di), line("-DI", minus_di), line("ADX", adx_line)];
    }
    let mut trs = vec![0.0; n];
    let mut pdm = vec![0.0; n];
    let mut mdm = vec![0.0; n];
    for i in 1..n {
        trs[i] = (bars[i].high - bars[i].low)
            .max((bars[i].high - bars[i - 1].close).abs())
            .max((bars[i].low - bars[i - 1].close).abs());
        let up = bars[i].high - bars[i - 1].high;
        let dn = bars[i - 1].low - bars[i].low;
        if up > dn && up > 0.0 { pdm[i] = up; }
        if dn > up && dn > 0.0 { mdm[i] = dn; }
    }
    let di = |dm: f64, atr: f64| if atr == 0.0 { 0.0 } else { 100.0 * dm / atr };
    let dx = |p: f64, m: f64| if p + m > 0.0 { 100.0 * (p - m).abs() / (p + m) } else { 0.0 };
    let mut atr_v: f64 = trs[1..=period].iter().sum();
    let mut pdm_v: f64 = pdm[1..=period].iter().sum();
    let mut mdm_v: f64 = mdm[1..=period].iter().sum();
    let mut dxs = vec![0.0; n];
    let (p, m) = (di(pdm_v, atr_v), di(mdm_v, atr_v));
    plus_di[period] = Some(p);
    minus_di[period] = Some(m);
    dxs[period] = dx(p, m);
    for i in (period + 1)..n {
        atr_v = atr_v - atr_v / period as f64 + trs[i];
        pdm_v = pdm_v - pdm_v / period as f64 + pdm[i];
        mdm_v = mdm_v - mdm_v / period as f64 + mdm[i];
        let (p, m) = (di(pdm_v, atr_v), di(mdm_v, atr_v));
        plus_di[i] = Some(p);
        minus_di[i] = Some(m);
        dxs[i] = dx(p, m);
    }
    let start = period + period - 1;
    if start < n {
        let mut adx_v: f64 = dxs[period..=start].iter().sum::<f64>() / period as f64;
        adx_line[start] = Some(adx_v);
        for i in (start + 1)..n {
            adx_v = (adx_v * (period as f64 - 1.0) + dxs[i]) / period as f64;
            adx_line[i] = Some(adx_v);
        }
    }
    vec![line("+DI", plus_di), line("-DI", minus_di), line("ADX", adx_line)]
}

fn donchian(bars: &[Bar], period: usize) -> Vec<IndicatorLine> {
    let n = bars.len();
    let (mut up, mut mid, mut lo) = (vec![None; n], vec![None; n], vec![None; n]);
    if period == 0 { return vec![line("UPPER", up), line("MID", mid), line("LOWER", lo)]; }
    for i in 0..n {
        let end = i + 1;
        if end < period { continue; }
        let slice = &bars[end - period..end];
        let h = slice.iter().map(|b| b.high).fold(f64::NEG_INFINITY, f64::max);
        let l = slice.iter().map(|b| b.low).fold(f64::INFINITY, f64::min);
        up[i] = Some(h);
        lo[i] = Some(l);
        mid[i] = Some((h + l) / 2.0);
    }
    vec![line("UPPER", up), line("MID", mid), line("LOWER", lo)]
}

fn keltner(bars: &[Bar], period: usize, mult: f64) -> Vec<IndicatorLine> {
    let closes: Vec<f64> = bars.iter().map(|b| b.close).collect();
    let mid = ema(&closes, period);
    let n = bars.len();
    let (mut up, mut lo) = (vec![None; n], vec![None; n]);
    if period > 0 && n > period {
        let mut trs = vec![0.0; n];
        for i in 1..n {
            trs[i] = (bars[i].high - bars[i].low)
                .max((bars[i].high - bars[i - 1].close).abs())
                .max((bars[i].low - bars[i - 1].close).abs());
        }
        let mut atr_now = trs[1..=period].iter().sum::<f64>() / period as f64;
        for i in 0..n {
            if i == period { /* atr_now 已在预热末值 */ }
            else if i > period {
                atr_now = (atr_now * (period as f64 - 1.0) + trs[i]) / period as f64;
            }
            if i >= period {
                if let Some(m) = mid[i] {
                    up[i] = Some(m + mult * atr_now);
                    lo[i] = Some(m - mult * atr_now);
                }
            }
        }
    }
    vec![line("UPPER", up), line("MID", mid), line("LOWER", lo)]
}

fn aroon(bars: &[Bar], period: usize) -> Vec<IndicatorLine> {
    let n = bars.len();
    let (mut au, mut ad) = (vec![None; n], vec![None; n]);
    if period == 0 { return vec![line("AROON UP", au), line("AROON DOWN", ad)]; }
    for i in 0..n {
        let end = i + 1;
        if end < period { continue; }
        let slice = &bars[end - period..end];
        let mut hi = 0usize;
        let mut li = 0usize;
        for (j, b) in slice.iter().enumerate() {
            if b.high > slice[hi].high { hi = j; }
            if b.low < slice[li].low { li = j; }
        }
        au[i] = Some(100.0 * (period - hi) as f64 / period as f64);
        ad[i] = Some(100.0 * (period - li) as f64 / period as f64);
    }
    vec![line("AROON UP", au), line("AROON DOWN", ad)]
}

fn trix(values: &[f64], period: usize) -> Vec<Option<f64>> {
    let e1 = ema(values, period);
    let flat1: Vec<f64> = e1.iter().map(|v| v.unwrap_or(0.0)).collect();
    let e2 = ema(&flat1, period);
    let flat2: Vec<f64> = e2.iter().map(|v| v.unwrap_or(0.0)).collect();
    let e3 = ema(&flat2, period);
    let mut out = vec![None; values.len()];
    for i in period..values.len() {
        if let (Some(a), Some(b)) = (e3[i], e3[i - 1]) {
            if b != 0.0 { out[i] = Some((a - b) / b * 100.0); }
        }
    }
    out
}

fn bop(bars: &[Bar]) -> Vec<Option<f64>> {
    bars.iter().map(|b| {
        let range = b.high - b.low;
        if range == 0.0 { Some(0.0) } else { Some((b.close - b.open) / range) }
    }).collect()
}

fn cmf(bars: &[Bar], period: usize) -> Vec<Option<f64>> {
    let n = bars.len();
    let mut out = vec![None; n];
    if period == 0 || n == 0 { return out; }
    let mfv: Vec<f64> = bars.iter().map(|b| {
        let range = b.high - b.low;
        let m = if range == 0.0 { 0.0 } else { ((b.close - b.low) - (b.high - b.close)) / range };
        m * b.volume
    }).collect();
    for i in (period - 1)..n {
        let vol: f64 = bars[i + 1 - period..=i].iter().map(|b| b.volume).sum();
        if vol > 0.0 {
            let sum: f64 = mfv[i + 1 - period..=i].iter().sum();
            out[i] = Some(sum / vol);
        }
    }
    out
}

fn ultimate_osc(bars: &[Bar]) -> Vec<Option<f64>> {
    let n = bars.len();
    let mut out = vec![None; n];
    if n < 28 { return out; }
    let mut bp = vec![0.0; n];
    let mut ll = f64::INFINITY;
    let mut hh = f64::NEG_INFINITY;
    for i in 1..n {
        ll = ll.min(bars[i - 1].low);
        hh = hh.max(bars[i - 1].high);
        let range = hh - ll;
        if range > 0.0 { bp[i] = 100.0 * (bars[i].close - ll) / range; }
    }
    let avg = |p: usize, i: usize| -> f64 { bp[i + 1 - p..=i].iter().sum::<f64>() / p as f64 };
    for i in 28..n {
        out[i] = Some((4.0 * avg(7, i) + 2.0 * avg(14, i) + avg(28, i)) / 7.0);
    }
    out
}

fn dpo(values: &[f64], period: usize) -> Vec<Option<f64>> {
    let mut out = vec![None; values.len()];
    if period == 0 { return out; }
    let mut sum = 0.0;
    let mut mas = vec![None; values.len()];
    for i in 0..values.len() {
        sum += values[i];
        if i >= period { sum -= values[i - period]; }
        if i + 1 >= period { mas[i] = Some(sum / period as f64); }
    }
    let shift = period / 2 + 1;
    for i in 0..values.len() {
        let j = i + shift;
        if j < values.len() {
            if let Some(m) = mas[i] { out[j] = Some(values[j] - m); }
        }
    }
    out
}

fn price_osc(values: &[f64], fast: usize, slow: usize) -> Vec<Option<f64>> {
    let f = ema(values, fast);
    let s = ema(values, slow);
    f.iter().zip(s.iter()).map(|(a, b)| match (a, b) {
        (Some(a), Some(b)) if *b != 0.0 => Some((a - b) / b * 100.0),
        _ => None,
    }).collect()
}

/// 扩展指标分发。返回 None 表示不属于本模块。
pub fn compute_extended(bars: &[Bar], req: &IndicatorRequest) -> Option<IndicatorResult> {
    let kind = req.kind.to_ascii_lowercase();
    let closes: Vec<f64> = bars.iter().map(|b| b.close).collect();
    let lines = match kind.as_str() {
        "wma" => vec![line("WMA", wma(&closes, iparam(req, 0, 20.0)))],
        "smma" | "rma" => vec![line("SMMA", smma(&closes, iparam(req, 0, 20.0)))],
        "stdev" => vec![line("STDEV", stdev(&closes, iparam(req, 0, 20.0)))],
        "roc" => vec![line("ROC", roc(&closes, iparam(req, 0, 12.0)))],
        "mom" | "momentum" => vec![line("MOM", momentum(&closes, iparam(req, 0, 10.0)))],
        "dema" => vec![line("DEMA", dema(&closes, iparam(req, 0, 20.0)))],
        "tema" => vec![line("TEMA", tema(&closes, iparam(req, 0, 20.0)))],
        "cci" => vec![line("CCI", cci(bars, iparam(req, 0, 20.0)))],
        "willr" | "williams" => vec![line("WILL%R", willr(bars, iparam(req, 0, 14.0)))],
        "mfi" => vec![line("MFI", mfi(bars, iparam(req, 0, 14.0)))],
        "adx" => adx(bars, iparam(req, 0, 14.0)),
        "donchian" => donchian(bars, iparam(req, 0, 20.0)),
        "keltner" => keltner(bars, iparam(req, 0, 20.0), dparam(req, 1, 2.0)),
        "aroon" => aroon(bars, iparam(req, 0, 25.0)),
        "trix" => vec![line("TRIX", trix(&closes, iparam(req, 0, 15.0)))],
        "bop" => vec![line("BOP", bop(bars))],
        "cmf" => vec![line("CMF", cmf(bars, iparam(req, 0, 20.0)))],
        "uo" | "ultimate" => vec![line("ULT OSC", ultimate_osc(bars))],
        "dpo" => vec![line("DPO", dpo(&closes, iparam(req, 0, 20.0)))],
        "posc" | "priceosc" => vec![line("PRICE OSC", price_osc(&closes, iparam(req, 0, 12.0), iparam(req, 1, 26.0)))],
        _ => return None,
    };
    Some(IndicatorResult { lines })
}

/// 扩展支持的指标 kind。
pub fn supported_extended() -> Vec<&'static str> {
    vec!["wma", "smma", "stdev", "roc", "mom", "dema", "tema", "cci",
         "willr", "mfi", "adx", "donchian", "keltner", "aroon", "trix",
         "bop", "cmf", "uo", "dpo", "posc"]
}
