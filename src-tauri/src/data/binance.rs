//! Binance 公钥市场数据接入。仅读取公开行情，不涉及账户/交易接口。

use crate::core::model::{Bar, Timeframe};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct KlineRow(
    i64,    // open time (ms)
    String, // open
    String, // high
    String, // low
    String, // close
    String, // volume
    i64,    // close time
    String, // quote asset volume
    i64,    // number of trades
    String, // taker buy base
    String, // taker buy quote
    String, // ignore
);

fn parse_f(s: &str) -> f64 {
    s.parse::<f64>().unwrap_or(0.0)
}

/// 从 Binance 拉取历史 K 线。limit 最大 1000。
pub async fn fetch_klines(
    symbol: &str,
    timeframe: Timeframe,
    limit: usize,
) -> Result<Vec<Bar>, String> {
    let limit = limit.clamp(1, 1000);
    let url = format!(
        "https://api.binance.com/api/v3/klines?symbol={}&interval={}&limit={}",
        symbol.to_uppercase(),
        timeframe.binance_interval(),
        limit
    );

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let rows: Vec<KlineRow> = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("请求 Binance 失败: {}", e))?
        .error_for_status()
        .map_err(|e| format!("Binance 返回错误: {}", e))?
        .json::<Vec<KlineRow>>()
        .await
        .map_err(|e| format!("解析 Binance 数据失败: {}", e))?;

    Ok(rows
        .into_iter()
        .map(|r| Bar {
            time: r.0,
            open: parse_f(&r.1),
            high: parse_f(&r.2),
            low: parse_f(&r.3),
            close: parse_f(&r.4),
            volume: parse_f(&r.5),
        })
        .collect())
}

/// 拉取更多历史：分批向前翻页，直到拿到足够的 bar 数
pub async fn fetch_klines_paged(
    symbol: &str,
    timeframe: Timeframe,
    total: usize,
) -> Result<Vec<Bar>, String> {
    let mut all: Vec<Bar> = Vec::new();
    let mut end_time: Option<i64> = None;

    while all.len() < total {
        let batch = 1000.min(total - all.len());
        let mut url = format!(
            "https://api.binance.com/api/v3/klines?symbol={}&interval={}&limit={}",
            symbol.to_uppercase(),
            timeframe.binance_interval(),
            batch
        );
        if let Some(t) = end_time {
            url.push_str(&format!("&endTime={}", t - 1));
        }

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

        let rows: Vec<KlineRow> = client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("请求 Binance 失败: {}", e))?
            .error_for_status()
            .map_err(|e| format!("Binance 返回错误: {}", e))?
            .json::<Vec<KlineRow>>()
            .await
            .map_err(|e| format!("解析 Binance 数据失败: {}", e))?;

        if rows.is_empty() {
            break;
        }

        end_time = Some(rows[0].0);
        let mut batch_bars: Vec<Bar> = rows
            .into_iter()
            .map(|r| Bar {
                time: r.0,
                open: parse_f(&r.1),
                high: parse_f(&r.2),
                low: parse_f(&r.3),
                close: parse_f(&r.4),
                volume: parse_f(&r.5),
            })
            .collect();
        batch_bars.reverse(); // 分页返回是倒序，反转成时间升序
        batch_bars.extend(all);
        all = batch_bars;
    }

    Ok(all)
}

/// 常用交易对列表（供前端默认展示）
pub fn default_symbols() -> Vec<&'static str> {
    vec!["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT"]
}
