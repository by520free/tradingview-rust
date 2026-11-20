use serde::{Deserialize, Serialize};

/// 一根 K 线。价格用 f64 存储（图表展示足够），计算精度在指标层用 f64 累积。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Bar {
    /// Unix 时间戳，单位毫秒
    pub time: i64,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub close: f64,
    pub volume: f64,
}

/// 前端传来的周期参数
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum Timeframe {
    #[serde(rename = "1m")]
    Min1,
    #[serde(rename = "5m")]
    Min5,
    #[serde(rename = "15m")]
    Min15,
    #[serde(rename = "1h")]
    Hour1,
    #[serde(rename = "4h")]
    Hour4,
    #[serde(rename = "1d")]
    Day1,
}

impl Timeframe {
    pub fn binance_interval(self) -> &'static str {
        match self {
            Timeframe::Min1 => "1m",
            Timeframe::Min5 => "5m",
            Timeframe::Min15 => "15m",
            Timeframe::Hour1 => "1h",
            Timeframe::Hour4 => "4h",
            Timeframe::Day1 => "1d",
        }
    }
}

/// 指标计算结果：一条线（或多条线）与对应的时间戳
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndicatorLine {
    pub name: String,
    /// 与 bars 等长，无值处为 null
    pub values: Vec<Option<f64>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndicatorResult {
    pub lines: Vec<IndicatorLine>,
}

/// 前端请求的指标参数
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndicatorRequest {
    pub kind: String,
    pub params: Vec<f64>,
}
