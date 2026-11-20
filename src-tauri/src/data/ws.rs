//! Binance 实时 K 线 WebSocket。仅订阅公开行情流，不涉及交易。

use crate::core::model::{Bar, Timeframe};
use futures_util::SinkExt;
use serde::Deserialize;
use tauri::ipc::Channel;

#[derive(Debug, Deserialize)]
struct WsKlineEvent {
    #[serde(rename = "k")]
    kline: WsKline,
}

#[derive(Debug, Deserialize)]
struct WsKline {
    #[serde(rename = "t")]
    start_time: i64,
    #[serde(rename = "o")]
    open: String,
    #[serde(rename = "h")]
    high: String,
    #[serde(rename = "l")]
    low: String,
    #[serde(rename = "c")]
    close: String,
    #[serde(rename = "v")]
    volume: String,
    #[serde(rename = "x")]
    is_closed: bool,
}

fn parse_f(s: &str) -> f64 {
    s.parse::<f64>().unwrap_or(0.0)
}

/// 订阅实时 K 线，每收到一根推送到前端 channel。
/// 该函数在独立 tokio 任务中运行，调用方不阻塞。
pub async fn subscribe_kline(
    symbol: String,
    timeframe: Timeframe,
    on_bar: Channel<Bar>,
) -> Result<(), String> {
    let stream = format!(
        "wss://stream.binance.com:9443/ws/{}@kline_{}",
        symbol.to_lowercase(),
        timeframe.binance_interval()
    );

    let (mut socket, _) = tokio_tungstenite::connect_async(&stream)
        .await
        .map_err(|e| format!("WebSocket 连接失败: {}", e))?;

    // 保持连接活跃：订阅 ping/pong 由 tokio-tungstenite 自动处理
    while let Some(msg) = futures_util::StreamExt::next(&mut socket).await {
        let msg = msg.map_err(|e| format!("WebSocket 消息错误: {}", e))?;
        if let tokio_tungstenite::tungstenite::Message::Text(text) = msg {
            if let Ok(event) = serde_json::from_str::<WsKlineEvent>(&text) {
                let bar = Bar {
                    time: event.kline.start_time,
                    open: parse_f(&event.kline.open),
                    high: parse_f(&event.kline.high),
                    low: parse_f(&event.kline.low),
                    close: parse_f(&event.kline.close),
                    volume: parse_f(&event.kline.volume),
                };
                // 只推送已收盘的 bar，避免与 REST 历史数据重复（未收盘 bar 前端可局部更新）
                if event.kline.is_closed {
                    let _ = on_bar.send(bar);
                }
            }
        }
    }
    Ok(())
}
