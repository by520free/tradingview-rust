mod core;
mod data;

use core::backtest::{BacktestConfig, BacktestResult, Signal};
use core::model::{Bar, IndicatorRequest, IndicatorResult, Timeframe};
use tauri::Emitter;
use std::collections::HashMap;
use std::sync::Mutex;

/// 应用状态：缓存已拉取的 K 线，避免重复请求
struct AppState {
    bars_cache: Mutex<HashMap<String, Vec<Bar>>>,
}

fn cache_key(symbol: &str, tf: Timeframe) -> String {
    format!("{}:{}", symbol.to_uppercase(), tf.binance_interval())
}

#[tauri::command]
async fn fetch_bars(
    symbol: String,
    timeframe: Timeframe,
    limit: Option<usize>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<Bar>, String> {
    let key = cache_key(&symbol, timeframe);
    if let Some(cached) = state.bars_cache.lock().unwrap().get(&key) {
        if !cached.is_empty() {
            return Ok(cached.clone());
        }
    }

    let bars = data::binance::fetch_klines(&symbol, timeframe, limit.unwrap_or(1000)).await?;
    state
        .bars_cache
        .lock()
        .unwrap()
        .insert(key, bars.clone());
    Ok(bars)
}

#[tauri::command]
async fn reload_bars(
    symbol: String,
    timeframe: Timeframe,
    limit: Option<usize>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<Bar>, String> {
    let bars = data::binance::fetch_klines(&symbol, timeframe, limit.unwrap_or(1000)).await?;
    state
        .bars_cache
        .lock()
        .unwrap()
        .insert(cache_key(&symbol, timeframe), bars.clone());
    Ok(bars)
}

#[tauri::command]
fn compute_indicators(
    symbol: String,
    timeframe: Timeframe,
    requests: Vec<IndicatorRequest>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<IndicatorResult>, String> {
    let key = cache_key(&symbol, timeframe);
    let cache = state.bars_cache.lock().unwrap();
    let bars = cache
        .get(&key)
        .ok_or_else(|| "请先加载 K 线数据".to_string())?;
    Ok(requests
        .iter()
        .map(|req| core::indicators::compute(bars, req))
        .collect())
}

/// 运行回测。bars 从缓存取，前端只传信号序列，保证信号与 K 线等长对齐。
#[tauri::command]
fn run_backtest(
    symbol: String,
    timeframe: Timeframe,
    config: BacktestConfig,
    signals: Vec<Signal>,
    close_signals: Vec<Signal>,
    state: tauri::State<'_, AppState>,
) -> Result<BacktestResult, String> {
    let key = cache_key(&symbol, timeframe);
    let cache = state.bars_cache.lock().unwrap();
    let bars = cache
        .get(&key)
        .ok_or_else(|| "请先加载 K 线数据".to_string())?;
    Ok(core::backtest::run(bars, &config, &signals, &close_signals))
}

#[tauri::command]
fn list_indicators() -> Vec<&'static str> {
    core::indicators::supported()
}

#[tauri::command]
fn list_symbols() -> Vec<&'static str> {
    data::binance::default_symbols()
}

/// 订阅实时 K 线。前端传入 channel，后端在新 tokio 任务中持续推送收盘 bar。
#[tauri::command]
async fn subscribe_realtime(
    symbol: String,
    timeframe: Timeframe,
    on_bar: tauri::ipc::Channel<Bar>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    tauri::async_runtime::spawn(async move {
        if let Err(e) = data::ws::subscribe_kline(symbol, timeframe, on_bar).await {
            eprintln!("[ws] {}", e);
            let _ = app.emit("ws-error", e);
        }
    });
    Ok(())
}

/// 从 CSV 文件导入 K 线
#[tauri::command]
fn import_csv(path: String) -> Result<Vec<Bar>, String> {
    data::csv::import_csv(&path)
}

/// 手动设置数据代理（如 http://127.0.0.1:1081），传 null 恢复自动探测。
/// 设置后需前端清缓存重新加载 K 线（reload_bars）。
#[tauri::command]
fn set_proxy(url: Option<String>) -> Option<String> {
    data::proxy::set_override(url);
    data::proxy::current()
}

/// 查询当前使用的代理（未探测时返回 None）。
#[tauri::command]
fn proxy_status() -> Option<String> {
    data::proxy::current()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            bars_cache: Mutex::new(HashMap::new()),
        })
        .invoke_handler(tauri::generate_handler![
            fetch_bars,
            reload_bars,
            compute_indicators,
            run_backtest,
            list_indicators,
            list_symbols,
            subscribe_realtime,
            import_csv,
            set_proxy,
            proxy_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running CandleLab");
}
