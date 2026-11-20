# CandleLab

用 Rust 重写一个 TradingView 类软件的起点项目。采用**方案 A（混合架构）**：Rust 核心负责数据管道与指标计算，Tauri 2 做桌面壳，前端用 KLineChart 渲染图表。

> **换新会话 / 云端继续开发？先读 [`CONTEXT.md`](CONTEXT.md)**——里面汇总了设计决策、技术踩坑和下一步清单，避免重复调研。

## 架构

```
┌─────────────────────────────────────┐
│  前端 (TS + KLineChart)             │
│  三栏布局 / K线渲染 / 周期切换       │
└──────────────┬──────────────────────┘
               │ Tauri IPC
┌──────────────▼──────────────────────┐
│  Rust 核心 (candlelab_lib)          │
│  ├─ data/binance.rs   行情拉取      │
│  ├─ core/indicators.rs 指标计算     │
│  └─ lib.rs            命令层/缓存   │
└─────────────────────────────────────┘
```

## 目录结构

```
.
├── src/                      前端源码
│   ├── main.ts               主逻辑：图表初始化、DataLoader、事件
│   ├── api.ts                Tauri invoke 封装
│   ├── types.ts              共享类型
│   └── style.css             样式
├── src-tauri/                Rust 后端
│   ├── src/
│   │   ├── lib.rs            Tauri 命令层 + 应用状态
│   │   ├── main.rs           入口
│   │   ├── core/
│   │   │   ├── model.rs      数据模型（Bar/周期/指标请求）
│   │   │   └── indicators.rs 指标引擎（10 个指标 + 单测）
│   │   └── data/
│   │       └── binance.rs    Binance 公钥 REST 数据接入
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── icons/icon.png
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── 方案工作量调研-A_vs_B.md   方案选型调研报告
```

## 当前功能（MVP 阶段）

- [x] Tauri 2 + Vite + TypeScript 项目骨架
- [x] KLineChart 10.x 图表（蜡烛图 + 成交量副图）
- [x] 6 个交易对切换（BTC/ETH/SOL/BNB/XRP/DOGE）
- [x] 6 档周期切换（1m/5m/15m/1h/4h/1d）
- [x] Binance 公钥 REST 历史 K 线拉取 + 内存缓存 + 分页拉取
- [x] Binance 实时 K 线 WebSocket 订阅（Tauri Channel 推送，仅收盘 bar）
- [x] CSV 导入（自动识别表头、逗号/制表符、时间戳/日期格式）
- [x] Rust 指标引擎：SMA、EMA、RSI、MACD、BOLL、ATR、KDJ、VWAP、VOL MA、OBV（含单测）
- [x] 前端指标按钮，由 Rust 计算后经 IPC 返回
- [ ] 指标线可视化叠加到主图/副图（当前结果写入 bar 扩展字段，待做脚本渲染）
- [ ] 历史回放
- [ ] 绘图工具（KLineChart 自带 16 种，待接入工具栏）

## 环境要求

- Node.js ≥ 20（当前验证环境 22.22.2）
- Rust stable（当前验证环境 1.100.0）
- **Windows 上需安装 Visual Studio Build Tools 2022（含 "使用 C++ 的桌面开发" workload + Windows 10/11 SDK）**——Tauri 编译需要 MSVC 链接器，`cargo check` 不需要
- WebView2 Runtime（Windows 11 自带，或单独安装）

## 当前机器的验证状态

已完成：
- 前端 `npm run build` 通过：TypeScript 严格模式无错误，产物 234KB（gzip 61.7KB）
- Rust 核心算法模块通过 rustc 类型检查（metadata 编译）
- 指标单测代码已写好（`cargo test --lib` 待装构建工具后运行）

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
