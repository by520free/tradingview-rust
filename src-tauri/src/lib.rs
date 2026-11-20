mod core;
mod data;

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
            list_indicators,
            list_symbols
        ])
        .run(tauri::generate_context!())
        .expect("error while running CandleLab");
}
