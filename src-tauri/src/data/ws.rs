//! Binance 实时 K 线 WebSocket。仅订阅公开行情流，不涉及交易。
//! 支持经 HTTP 代理（CONNECT 隧道）连接，因为 Binance 国内无法直连。

use crate::core::model::{Bar, Timeframe};
use crate::data::proxy;
use serde::Deserialize;
use std::sync::Arc;
use tauri::ipc::Channel;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

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

/// rustls 0.23 需显式选择进程级 crypto provider；重复安装返回 Err，忽略即可。
fn ensure_crypto_provider() {
    let _ = rustls::crypto::ring::default_provider().install_default();
}

/// 建立到 host:port 的 TCP 连接：有代理则走 CONNECT 隧道，否则直连。
async fn connect_tcp(proxy_url: Option<&str>, host: &str, port: u16) -> Result<TcpStream, String> {
    match proxy_url {
        None => TcpStream::connect((host, port))
            .await
            .map_err(|e| format!("直连 {} 失败: {}", host, e)),
        Some(p) => connect_via_proxy(p, host, port).await,
    }
}

/// 经 HTTP 代理建立到 target_host:port 的 CONNECT 隧道，返回已连接的 TcpStream。
async fn connect_via_proxy(proxy_url: &str, host: &str, port: u16) -> Result<TcpStream, String> {
    // 解析代理地址，提取 host:port（默认 http / 80）。
    let stripped = proxy_url
        .strip_prefix("http://")
        .or_else(|| proxy_url.strip_prefix("https://"))
        .unwrap_or(proxy_url);
    let stripped = stripped.split('/').next().unwrap_or(stripped);
    let proxy_addr = if stripped.contains(':') {
        stripped.to_string()
    } else {
        format!("{}:80", stripped)
    };

    let mut stream = TcpStream::connect(&proxy_addr)
        .await
        .map_err(|e| format!("连接代理 {} 失败: {}", proxy_addr, e))?;

    let connect_req = format!(
        "CONNECT {}:{} HTTP/1.1\r\nHost: {}:{}\r\nProxy-Connection: Keep-Alive\r\n\r\n",
        host, port, host, port
    );
    stream
        .write_all(connect_req.as_bytes())
        .await
        .map_err(|e| format!("发送 CONNECT 失败: {}", e))?;

    // 读取响应头，直到 \r\n\r\n。
    let mut buf = Vec::new();
    let mut byte = [0u8; 1];
    loop {
        let n = stream
            .read(&mut byte)
            .await
            .map_err(|e| format!("读取 CONNECT 响应失败: {}", e))?;
        if n == 0 {
            return Err("代理关闭了连接".to_string());
        }
        buf.push(byte[0]);
        if buf.ends_with(b"\r\n\r\n") {
            break;
        }
        if buf.len() > 8192 {
            return Err("CONNECT 响应过大".to_string());
        }
    }
    let header = String::from_utf8_lossy(&buf);
    let status_ok = header.lines().next().map(|l| l.contains(" 200 ")).unwrap_or(false);
    if !status_ok {
        return Err(format!("代理 CONNECT 失败: {}", header.lines().next().unwrap_or("")));
    }
    Ok(stream)
}

/// 订阅实时 K 线，每收到一根推送到前端 channel。
/// 该函数在独立 tokio 任务中运行，调用方不阻塞。
pub async fn subscribe_kline(
    symbol: String,
    timeframe: Timeframe,
    on_bar: Channel<Bar>,
) -> Result<(), String> {
    ensure_crypto_provider();
    let host = "stream.binance.com";
    let port = 9443u16;
    let path = format!(
        "/ws/{}@kline_{}",
        symbol.to_lowercase(),
        timeframe.binance_interval()
    );
    // wss:// URI 供 WebSocket 握手用（CONNECT 隧道下 TLS 由我们手工包装）。
    let ws_uri = format!("wss://{}:{}{}", host, port, path);

    let mut root_store = rustls::RootCertStore::empty();
    root_store.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let tls_config = Arc::new(
        rustls::ClientConfig::builder()
            .with_root_certificates(root_store)
            .with_no_client_auth(),
    );

    // 统一路径：TCP 层按「代理 CONNECT 隧道 / 直连」二选一，之后手工 TLS + WS 握手。
    let proxy_url = proxy::detect().await;
    let tcp = connect_tcp(proxy_url.as_deref(), host, port).await?;
    let domain = rustls_pki_types::ServerName::try_from(host)
        .map_err(|_| "非法域名".to_string())?
        .to_owned();
    let connector = tokio_rustls::TlsConnector::from(tls_config);
    let tls_stream = connector
        .connect(domain, tcp)
        .await
        .map_err(|e| format!("TLS 握手失败: {}", e))?;
    let (mut socket, _) = tokio_tungstenite::client_async_with_config(ws_uri, tls_stream, None)
        .await
        .map_err(|e| format!("WebSocket 握手失败: {}", e))?;

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

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore]
    async fn ws_connects_via_proxy() {
        ensure_crypto_provider();
        let proxy_url = proxy::detect().await;
        println!("ws test proxy: {:?}", proxy_url);
        let host = "stream.binance.com";
        let port = 9443u16;
        let tcp = connect_tcp(proxy_url.as_deref(), host, port)
            .await
            .expect("应能建立 TCP/CONNECT 连接");
        let mut root_store = rustls::RootCertStore::empty();
        root_store.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
        let cfg = Arc::new(
            rustls::ClientConfig::builder()
                .with_root_certificates(root_store)
                .with_no_client_auth(),
        );
        let domain = rustls_pki_types::ServerName::try_from(host).unwrap().to_owned();
        let tls = tokio_rustls::TlsConnector::from(cfg)
            .connect(domain, tcp)
            .await
            .expect("TLS 握手应成功");
        let uri = format!("wss://{}:{}/ws/btcusdt@kline_1h", host, port);
        let (mut socket, _) = tokio_tungstenite::client_async_with_config(uri, tls, None)
            .await
            .expect("WS 握手应成功");
        println!("WS 连接成功，等待消息…");
        let msg = tokio::time::timeout(
            std::time::Duration::from_secs(15),
            futures_util::StreamExt::next(&mut socket),
        )
        .await
        .expect("15 秒内应收到消息")
        .expect("socket 应活跃")
        .expect("消息无错");
        println!("收到 WS 消息: {}", &format!("{:?}", msg)[..80.min(format!("{:?}", msg).len())]);
    }
}
