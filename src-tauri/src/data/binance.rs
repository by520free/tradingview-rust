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

/// Binance API 域名：主域名 + 官方数据镜像（后者抗封锁能力强）。
const API_HOSTS: &[&str] = &["api.binance.com", "data-api.binance.vision"];

fn rows_to_bars(rows: Vec<KlineRow>) -> Vec<Bar> {
    rows.into_iter()
        .map(|r| Bar {
            time: r.0,
            open: parse_f(&r.1),
            high: parse_f(&r.2),
            low: parse_f(&r.3),
            close: parse_f(&r.4),
            volume: parse_f(&r.5),
        })
        .collect()
}

/// 带重试 + 域名 fallback 的 K 线请求。
/// 代理偶发 TLS 握手失败，因此对同一 URL 重试；主域名失败切换镜像域名。
async fn fetch_klines_once(
    client: &reqwest::Client,
    path: &str,
) -> Result<Vec<KlineRow>, String> {
    let mut last_err = String::new();
    // 每个域名重试 2 次，共 2 域名 = 最多 4 次尝试。
    for host in API_HOSTS {
        let url = format!("https://{}{}", host, path);
        for attempt in 0..2 {
            match client
                .get(&url)
                .send()
                .await
                .and_then(|r| r.error_for_status())
            {
                Ok(resp) => match resp.json::<Vec<KlineRow>>().await {
                    Ok(rows) => return Ok(rows),
                    Err(e) => last_err = format!("解析 Binance 数据失败: {}", e),
                },
                Err(e) => last_err = format!("请求 {} 失败: {}", host, e),
            }
            if attempt == 0 {
                tokio::time::sleep(std::time::Duration::from_millis(300)).await;
            }
        }
    }
    Err(last_err)
}

/// 从 Binance 拉取历史 K 线。limit 最大 1000。
pub async fn fetch_klines(
    symbol: &str,
    timeframe: Timeframe,
    limit: usize,
) -> Result<Vec<Bar>, String> {
    let limit = limit.clamp(1, 1000);
    let path = format!(
        "/api/v3/klines?symbol={}&interval={}&limit={}",
        symbol.to_uppercase(),
        timeframe.binance_interval(),
        limit
    );

    let client = crate::data::proxy::http_client(std::time::Duration::from_secs(15)).await?;
    let rows = fetch_klines_once(&client, &path).await?;
    Ok(rows_to_bars(rows))
}

/// 拉取更多历史：分批向前翻页，直到拿到足够的 bar 数
pub async fn fetch_klines_paged(
    symbol: &str,
    timeframe: Timeframe,
    total: usize,
) -> Result<Vec<Bar>, String> {
    let mut all: Vec<Bar> = Vec::new();
    let mut end_time: Option<i64> = None;
    let client = crate::data::proxy::http_client(std::time::Duration::from_secs(15)).await?;

    while all.len() < total {
        let batch = 1000.min(total - all.len());
        let mut path = format!(
            "/api/v3/klines?symbol={}&interval={}&limit={}",
            symbol.to_uppercase(),
            timeframe.binance_interval(),
            batch
        );
        if let Some(t) = end_time {
            path.push_str(&format!("&endTime={}", t - 1));
        }

        let rows = fetch_klines_once(&client, &path).await?;
        if rows.is_empty() {
            break;
        }

        end_time = Some(rows[0].0);
        let mut batch_bars = rows_to_bars(rows);
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
