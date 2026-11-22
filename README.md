# CandleLab

用 Rust 重写一个 TradingView 类软件的起点项目。采用**方案 A（混合架构）**：Rust 核心负责数据管道与指标计算，Tauri 2 做桌面壳，前端用 KLineChart 渲染图表。

> **换新会话 / 云端继续开发？先读 [`CONTEXT.md`](CONTEXT.md)**——里面汇总了设计决策、技术踩坑和下一步清单，避免重复调研。

## 架构

```
┌──────────────────────────────────────────────┐
│  前端 (TS + KLineChart 10)                   │
│  · K线/成交量 · 指标叠加 · 绘图工具 · 回放    │
│  · JS 脚本沙箱(Web Worker) · 实时订阅         │
└────────────────┬─────────────────────────────┘
                 │ Tauri IPC (invoke + Channel)
┌────────────────▼─────────────────────────────┐
│  Rust 核心 (candlelab_lib)                   │
│  ├─ data/binance.rs     REST 行情拉取         │
│  ├─ data/ws.rs          实时 K 线 WebSocket  │
│  ├─ data/csv.rs         CSV 导入             │
│  ├─ core/indicators.rs  10 个技术指标         │
│  ├─ core/backtest.rs    事件驱动回测引擎      │
│  └─ lib.rs              命令层 + 内存缓存    │
└──────────────────────────────────────────────┘
```

设计要点：脚本用 JS 写在 Web Worker 沙箱里（3 秒超时、危险 API 遮蔽），
但**成交逻辑始终由 Rust 回测引擎执行**——脚本只产出信号，保持 Rust 作为计算核心。

## 目录结构

```
.
├── src/                      前端源码
│   ├── main.ts               主逻辑：图表/指标叠加/回测面板/回放/实时/绘图
│   ├── api.ts                Tauri invoke 封装（含 Channel/CSV）
│   ├── types.ts              共享类型（含回测类型）
│   ├── style.css             样式
│   └── scripts/
│       ├── ta.ts             脚本用精简指标库（纯函数）
│       ├── script-worker.ts  Web Worker 沙箱运行时
│       └── script-host.ts    主线程侧 Worker 管理 + 超时终止
├── src-tauri/                Rust 后端
│   ├── src/
│   │   ├── lib.rs            Tauri 命令层 + 应用状态
│   │   ├── main.rs           入口
│   │   ├── core/
│   │   │   ├── model.rs              数据模型（Bar/周期/指标请求）
│   │   │   ├── indicators.rs         核心指标（10 个 + 单测 + 扩展分发）
│   │   │   ├── indicators_extended.rs 扩展指标（20 个：WMA/CCI/ADX/CMF...）
│   │   │   └── backtest.rs           回测引擎（成交语义 + 4 个单测）
│   │   └── data/
│   │       ├── binance.rs    Binance 公钥 REST 数据接入
│   │       ├── ws.rs         实时 K 线 WebSocket
│   │       └── csv.rs        CSV 导入
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── icons/icon.png
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── 方案工作量调研-A_vs_B.md   方案选型调研报告
└── 参考项目分析-wickline.md   Wickline 项目借鉴分析
```

## 当前功能（阶段 1–8 已完成）

- [x] Tauri 2 + Vite + TypeScript 项目骨架
- [x] KLineChart 10.x 图表（蜡烛图 + 成交量副图）
- [x] 6 个交易对切换（BTC/ETH/SOL/BNB/XRP/DOGE）
- [x] 6 档周期切换（1m/5m/15m/1h/4h/1d）
- [x] Binance 公钥 REST 历史 K 线拉取 + 内存缓存 + 分页拉取
- [x] Binance 实时 K 线 WebSocket 订阅（Tauri Channel 推送，仅收盘 bar）
- [x] CSV 导入（自动识别表头、逗号/制表符、时间戳/日期格式）
- [x] Rust 指标引擎：SMA、EMA、RSI、MACD、BOLL、ATR、KDJ、VWAP、VOL MA、OBV（含单测）
- [x] **指标线真正画到图上**：主图（SMA/EMA/BOLL/VWAP）+ 副图（RSI/MACD/KDJ/ATR/OBV），
      通过自定义指标 + K 线扩展字段实现（阶段 1）
- [x] **Rust 回测引擎**：防未来函数（信号 close 产生、下一根 open 成交）、跳空按 open、
      止损优先、手续费/滑点、完整统计；内置双均线交叉策略面板（阶段 2）
- [x] **JS 脚本沙箱**：Web Worker 隔离、3 秒超时、危险 API 遮蔽、错误行号映射、
      策略信号交给 Rust 执行；内置均线/RSI/策略三个示例（阶段 3）
- [x] **绘图工具**：自动列出 KLineChart 内置工具（趋势线/斐波那契/文字等）+ 一键清除（阶段 4）
- [x] **历史回放**：播放/暂停、进度条拖拽、1×/2×/4× 速度（阶段 4）
- [x] **实时订阅前端接线**：订阅开关 + 图表原生 subscribeBar 局部更新（阶段 4）
- [x] **回测可视化**：买卖箭头画到主图（红▲买/绿▼卖）+ 权益曲线与回撤填充 + 买入持有对比（阶段 5）
- [x] **指标扩展到 30 个**：新增 WMA/SMMA/STDEV/ROC/MOM/DEMA/TEMA/CCI/WILL%R/MFI/ADX/
      Donchian/Keltner/Aroon/TRIX/BOP/CMF/ULT/DPO/PriceOsc（阶段 6）
- [x] **指标参数可调**：已启用指标的参数输入框，改动后 Rust 重算（阶段 6）
- [x] **多主题**：亮/暗双主题（跟随系统 + 手动切换 + localStorage 持久化），图表同步切换（阶段 7）
- [x] **快捷键体系**：周期 1-6、空格回放、B 回测、E 脚本、T 主题、R 刷新、G 导出、Esc 清除、? 帮助（阶段 7）
- [x] **图表导出 PNG**：KLineChart 原生 getConvertPictureUrl，导出按钮 + G 键（阶段 8）
- [x] **价格预警**：目标价 + 上/下方向，触发时应用内提示 + 桌面通知（阶段 8）

## 环境要求

- Node.js ≥ 20（当前验证环境 22.22.2）
- Rust stable（当前验证环境 1.100.0）
- **Windows 上需安装 Visual Studio Build Tools 2022（含 "使用 C++ 的桌面开发" workload + Windows 10/11 SDK）**——Tauri 编译需要 MSVC 链接器，`cargo check` 不需要
- WebView2 Runtime（Windows 11 自带，或单独安装）

## 当前机器的验证状态

已完成：
- 前端 `npm run build` 通过：TypeScript 严格模式无错误，产物 262KB（gzip 70.8KB），
  Worker 正确拆分为独立 chunk（8.88KB）
- Rust 四个核心算法模块（model/indicators/indicators_extended/backtest）整体通过 rustc 类型检查（metadata 编译）
- 用到的 KLineChart API（getConvertPictureUrl/setStyles/createIndicator 等）均在 d.ts 中确认存在，
  且 tsc 严格模式校验通过
- **实际运行验证的测试**（用 Node 真实执行，非仅类型检查）：
  - TA 库 10 项：SMA/EMA/RSI/BOLL/MACD/交叉/ATR/KDJ 全部通过
  - 脚本沙箱 11 项：三个示例脚本、plot/marker/hline、策略信号、块作用域全部通过
- 指标单测 + 回测单测（4 个：防未来函数/止损优先/跳空按 open/手续费滑点）代码已写好，
  `cargo test --lib` 待装构建工具后运行

**阻塞项**：当前机器没有 Visual Studio Build Tools / Windows SDK，Rust 依赖的 build script 无法链接（缺 `kernel32.lib` 等）。这是 Tauri 在 Windows 上的硬性要求，`cargo check` 也绕不过去。运行前的第一步是装构建工具：

```powershell
# 以管理员身份运行 PowerShell
winget install Microsoft.VisualStudio.2022.BuildTools `
  --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

装完后重新打开终端，再执行下面的运行命令。

## 运行

```bash
# 安装前端依赖（若默认 registry 缺版本，用官方源）
npm install --registry=https://registry.npmjs.org/

# 开发模式（Vite + Tauri）
npm run tauri dev

# 仅前端预览（不启动 Rust 后端，图表无数据）
npm run dev

# 类型检查 / 构建
npm run build

# Rust 侧检查（不需要 MSVC）
cd src-tauri && cargo check

# Rust 指标单测
cd src-tauri && cargo test --lib
```

## 网络与代理

- Binance API 在国内网络可能不可达，需要配置代理。当前代码用 reqwest 直连，环境变量 `HTTPS_PROXY` 会被 reqwest 自动读取。
- 本机可用的代理是 `http://127.0.0.1:1081`（与全局配置一致）。运行 `npm run tauri dev` 前可设置：
  ```bash
  export HTTPS_PROXY=http://127.0.0.1:1081
  export HTTP_PROXY=http://127.0.0.1:1081
  ```
- npm 默认 registry 是淘宝镜像 `registry.npmmirror.com`，同步可能滞后；遇到版本找不到时加 `--registry=https://registry.npmjs.org/`。

## 合规说明

本项目仅接入 Binance **公开行情接口**（klines），不含账户、下单、资金等交易接口，定位为离线/本地技术分析工具。行情数据的商业使用需遵守数据源的服务条款；中国大陆用户使用加密行情与相关工具时请注意当地监管要求。
