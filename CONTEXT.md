# 项目上下文交接（供云端 / 新会话 Agent 阅读）

> 这份文件是给「换一个 Agent 会话继续这个项目」用的。读完它就能接上之前的设计决策和踩过的坑，不必重新调研。

## 一句话目标

用 Rust 重写一个 TradingView 类图表分析软件。当前处于 MVP 阶段，采用**方案 A（混合架构）**，仓库 `by520free/tradingview-rust`（私有）。

## 已定的关键决策（不要推翻重来）

1. **选方案 A，不选 B。**
   - A = Rust 核心（数据 + 指标 + 回测）+ Tauri 2 桌面壳 + Web 前端图表。
   - B = 纯 Rust 自绘（egui / iced / Slint / GPUI）。曾短暂选择 B，后经工作量调研放弃。
   - 理由：MVP 口径下 A 约 47–98 人天，B 约 108–193 人天，差 2–2.5 倍。B 的 IME/中文输入、绘图工具、K 线渲染都要自研。完整对比见 `方案工作量调研-A_vs_B.md`。
   - 用户最初想"全面用 Rust"，但要理解：**Rust 承担核心引擎即满足初衷，UI 不必也用 Rust**。

2. **图表库选 KLineChart，不是 Lightweight Charts。**
   - TradingView 官方 Lightweight Charts 是纯渲染器：零内置指标、零绘图工具、零数据。
   - KLineChart 10.x（Apache-2.0）自带 27 指标 + 16 绘图工具，58KB gzipped。
   - B 路线的 `egui-charts` 声称 95 工具/130 指标，但只有 2 个 unstable 版本、月下载约 21、单人项目——不可作产品地基。

3. **MVP 范围**：图表 + 20 指标 + 基础绘图 + 回放 + 加密货币数据源。先加密 + 本地 CSV，不做 A 股/美股实时授权数据。

## 技术事实与踩坑（重要）

- **KLineChart 10.x 数据 API 是 DataLoader 懒加载**：`chart.setDataLoader({ getBars: ({callback}) => callback(data) })`，不是旧版的 `applyNewData`。`Period.type` 合法值是 `"minute"|"hour"|"day"`，不是 `"time"`。
- **版本**：Tauri crate 2.12.7 / CLI 2.12.6 / KLineChart 10.1.0 / Vite 8.3.8 / Rust 1.100.0 / Node 22.22.2。
  - KLineChart 用 10.1.0 而非 10.1.1：npm 默认淘宝镜像只同步到 10.1.0；装依赖要加 `--registry=https://registry.npmjs.org/`。
- **未装 MSVC 构建工具时 `cargo check` 都过不了**：Git Bash 的 `/usr/bin/link` 被当成 MSVC 链接器；换 rust-lld 后缺 `kernel32.lib` 等 Windows SDK 库。装 VS Build Tools 2022 是硬要求（命令见 README）。
- **验证状态**：前端 `npm run build` 通过（0 类型错误，234KB / gzip 61.7KB）；Rust 核心算法模块做过独立 rustc metadata 类型检查通过；`cargo test` 尚未真正跑过（缺构建工具）。
- **网络**：国内拉 Binance 需代理；本机代理是 `http://127.0.0.1:1081`。curl 直连 api.github.com 报 schannel 证书错，加 `-k -x http://127.0.0.1:1081`。

## 当前代码结构

- `src/`：TS 前端。`main.ts` 三栏布局 + 图表 + 周期切换 + DataLoader；`api.ts` 封装 Tauri invoke；`types.ts` 共享类型；`style.css` 样式。
- `src-tauri/src/core/`：`model.rs` 数据模型；`indicators.rs` 10 个指标（SMA/EMA/RSI/MACD/BOLL/ATR/KDJ/VWAP/VOL MA/OBV）+ 单测。
- `src-tauri/src/data/`：`binance.rs` REST 分页拉取；`ws.rs` WebSocket 订阅（Tauri Channel 推送）；`csv.rs` CSV 导入。
- `src-tauri/src/lib.rs`：Tauri 命令层 + 内存缓存。

## 还没做（下一步候选）

1. 指标线真正画到图上——目前 Rust 算完写进 bar 扩展字段，缺 KLineChart 自定义指标脚本渲染。
2. 历史回放。
3. 绘图工具按钮（KLineChart 自带 16 种，待接工具栏）。
4. 前端订阅实时 WebSocket 流。
5. 装 VS Build Tools 后跑通 `cargo check` / `cargo test` / `npm run tauri dev`。

## 合规边界

仅接 Binance **公开行情接口**（klines），不含账户/下单/资金。定位离线技术分析工具。不碰交易执行接口；面向中国大陆用户时注意监管要求，行情数据商用需遵守数据源条款。

## Git 状态

- 主分支 `master`，首次提交 `2c94169`。
- `.gitignore` 已排除 node_modules / target / dist / .workbuddy / 密钥文件。
- 仓库 https://github.com/by520free/tradingview-rust （私有）。
- GitHub 连接器 token 可读取但**无创建仓库权限**（403）；建仓和推送用的是本机 `~/.git-credentials` 里的 PAT。
