//! CSV 导入：支持常见交易所导出的 OHLCV 格式（带表头，按列位置识别）。

use crate::core::model::Bar;
use std::io::Read;

/// 解析 CSV 文本为 K 线。自动跳过表头，兼容逗号/制表符分隔。
pub fn parse_ohlcv_csv(text: &str) -> Result<Vec<Bar>, String> {
    let mut bars = Vec::new();

    for (idx, line) in text.lines().enumerate() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let sep = if line.contains(',') { ',' } else { '\t' };
        let cols: Vec<&str> = line.split(sep).map(|s| s.trim().trim_matches('"')).collect();
        if cols.len() < 6 {
            continue;
        }

        // 表头检测：第一列不是数字
        if cols[0].parse::<f64>().is_err() {
            continue;
        }

        let time = parse_time(cols[0])?;
        let open = parse_f(cols[1], idx)?;
        let high = parse_f(cols[2], idx)?;
        let low = parse_f(cols[3], idx)?;
        let close = parse_f(cols[4], idx)?;
        let volume = parse_f(cols[5], idx)?;

        bars.push(Bar { time, open, high, low, close, volume });
    }

    if bars.is_empty() {
        return Err("未解析到有效数据行".into());
    }
    Ok(bars)
}

fn parse_f(s: &str, line: usize) -> Result<f64, String> {
    s.parse::<f64>()
        .map_err(|_| format!("第 {} 行数值格式错误: {}", line + 1, s))
}

fn parse_time(s: &str) -> Result<i64, String> {
    if let Ok(ms) = s.parse::<i64>() {
        return Ok(if ms < 10_000_000_000 { ms * 1000 } else { ms });
    }
    // 尝试常见日期格式 YYYY-MM-DD / YYYY-MM-DD HH:MM:SS
    let cleaned = s.replace('T', " ");
    let formats = [
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%d",
        "%Y/%m/%d %H:%M:%S",
        "%Y/%m/%d",
    ];
    for fmt in formats {
        if let Ok(dt) = chrono_parse(&cleaned, fmt) {
            return Ok(dt);
        }
    }
    Err(format!("无法解析时间: {}", s))
}

/// 轻量时间解析，避免引入 chrono 依赖。仅支持上述固定格式。
fn chrono_parse(s: &str, fmt: &str) -> Result<i64, ()> {
    let nums: Vec<i64> = s
        .split(|c: char| !c.is_ascii_digit())
        .filter(|p| !p.is_empty())
        .filter_map(|p| p.parse::<i64>().ok())
        .collect();
    let has_time = fmt.contains("%H");
    let need = if has_time { 6 } else { 3 };
    if nums.len() < need {
        return Err(());
    }
    // 这里返回秒级近似值：用 civil date -> days 的算法
    let (y, m, d) = (nums[0], nums[1], nums[2]);
    let days = days_from_civil(y, m, d);
    let secs = days * 86400
        + if has_time { nums[3] * 3600 + nums[4] * 60 + nums.get(5).copied().unwrap_or(0) } else { 0 };
    Ok(secs * 1000)
}

/// Howard Hinnant 的 civil date 转 days since epoch 算法
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = m + if m > 2 { -3 } else { 9 };
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

/// 从文件读取并解析
pub fn import_csv(path: &str) -> Result<Vec<Bar>, String> {
    let mut file = std::fs::File::open(path)
        .map_err(|e| format!("打开文件失败: {}", e))?;
    let mut text = String::new();
    file.read_to_string(&mut text)
        .map_err(|e| format!("读取文件失败: {}", e))?;
    parse_ohlcv_csv(&text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_simple_csv() {
        let csv = "time,open,high,low,close,volume\n\
                   1700000000000,100,105,99,103,12.5\n\
                   1700000060000,103,108,102,107,9.0\n";
        let bars = parse_ohlcv_csv(csv).unwrap();
        assert_eq!(bars.len(), 2);
        assert_eq!(bars[0].close, 103.0);
        assert_eq!(bars[1].volume, 9.0);
    }
}
