//! 网络代理探测与管理。
//!
//! Binance 在国内无法直连，且代理端口每次会话都可能变化，硬编码端口不可靠。
//! 本模块在首次请求时并发探测「手动指定 + 环境变量 + 常见本地端口」，
//! 选出第一个能连通 Binance 的代理并缓存，供 REST 与 WebSocket 共用。

use futures_util::future::join_all;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

const PROBE_URL: &str = "https://api.binance.com/api/v3/ping";
const PROBE_TIMEOUT: Duration = Duration::from_secs(4);

/// 前端手动指定的代理（Some 时最高优先级，None 表示自动探测）。
static OVERRIDE: Mutex<Option<String>> = Mutex::new(None);
/// 自动探测结果缓存。Some(Some(url)) 找到代理；Some(None) 直连或全部失败。
static DETECTED: OnceLock<Option<String>> = OnceLock::new();

/// 常见本地代理端口（clash / v2ray / 系统代理常用）。
const COMMON_PORTS: &[u16] = &[
    1081, 7890, 10809, 1080, 7897, 10808, 50686, 53794, 55406, 64402, 33210,
];

fn normalize(raw: &str) -> Option<String> {
    let s = raw.trim();
    if s.is_empty() {
        return None;
    }
    let s = if s.contains("://") {
        s.to_string()
    } else {
        format!("http://{}", s)
    };
    Some(s.trim_end_matches('/').to_string())
}

fn override_proxy() -> Option<String> {
    OVERRIDE
        .lock()
        .ok()
        .and_then(|g| g.clone())
        .and_then(|v| normalize(&v))
}

/// 收集候选代理：手动指定 > 环境变量 > 常见端口。
fn candidates() -> Vec<String> {
    let mut list: Vec<String> = Vec::new();
    let mut push = |s: String| {
        if !list.contains(&s) {
            list.push(s);
        }
    };

    if let Some(u) = override_proxy() {
        push(u);
    }
    for key in [
        "HTTPS_PROXY",
        "https_proxy",
        "HTTP_PROXY",
        "http_proxy",
        "ALL_PROXY",
        "all_proxy",
    ] {
        if let Ok(v) = std::env::var(key) {
            if let Some(u) = normalize(&v) {
                push(u);
            }
        }
    }
    for port in COMMON_PORTS {
        push(format!("http://127.0.0.1:{}", port));
    }
    list
}

async fn reachable_once(client: &reqwest::Client) -> bool {
    match client.get(PROBE_URL).send().await {
        Ok(resp) => resp.status().is_success(),
        Err(_) => false,
    }
}

/// 探测单个代理。代理可能偶发 TLS 握手失败，重试 3 次，一次成功即认定可用。
async fn reachable(url: String) -> Option<String> {
    let proxy = reqwest::Proxy::all(&url).ok()?;
    let client = reqwest::Client::builder()
        .no_proxy()
        .proxy(proxy)
        .timeout(PROBE_TIMEOUT)
        .build()
        .ok()?;
    for _ in 0..3 {
        if reachable_once(&client).await {
            return Some(url);
        }
    }
    None
}

/// 探测可用代理。返回 Some(url) 表示需要代理，None 表示直连或全部失败。
/// 手动指定的代理永远优先，且不受自动探测缓存影响。
pub async fn detect() -> Option<String> {
    if let Some(url) = override_proxy() {
        return Some(url);
    }
    if let Some(cached) = DETECTED.get() {
        return cached.clone();
    }

    // 并发探测所有候选，取第一个（按优先级顺序）连通的。
    let list = candidates();
    let probes: Vec<_> = list.into_iter().map(reachable).collect();
    let results = join_all(probes).await;
    let found = results.into_iter().flatten().next();

    let _ = DETECTED.set(found.clone());
    found
}

/// 手动设置代理。传 None 清除覆盖，回退到自动探测。
pub fn set_override(url: Option<String>) {
    if let Ok(mut g) = OVERRIDE.lock() {
        *g = url.as_deref().and_then(normalize);
    }
}

/// 当前实际使用的代理 URL（前端状态显示用；未探测时为 None）。
pub fn current() -> Option<String> {
    if let Some(url) = override_proxy() {
        return Some(url);
    }
    DETECTED.get().and_then(|v| v.clone())
}

/// 构造一个带（探测到的）代理的 HTTP client。
pub async fn http_client(timeout: Duration) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder()
        .no_proxy()
        .timeout(timeout);
    if let Some(url) = detect().await {
        let proxy = reqwest::Proxy::all(&url)
            .map_err(|e| format!("代理地址无效 {}: {}", url, e))?;
        builder = builder.proxy(proxy);
    }
    builder.build().map_err(|e| format!("创建 HTTP 客户端失败: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore]
    async fn detect_finds_working_proxy() {
        let found = detect().await;
        println!("detected proxy: {:?}", found);
        // 当前测试环境应能探测到某个可用代理（直连不通时）。
        let client = http_client(Duration::from_secs(8)).await.unwrap();
        let resp = client
            .get("https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=2")
            .send()
            .await
            .expect("应能通过探测到的代理访问 Binance");
        assert!(resp.status().is_success(), "HTTP {}", resp.status());
        let body: serde_json::Value = resp.json().await.unwrap();
        assert!(body.as_array().map(|a| a.len() == 2).unwrap_or(false), "应返回 2 根 K 线");
        println!("端到端拉到 K 线: {:?}", body[0]);
    }
}
