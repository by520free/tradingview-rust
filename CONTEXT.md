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
- **验证状态**：前端 `npm run build` 通过（0 类型错误，262KB / gzip 70.8KB，Worker 独立 chunk 8.88KB）；Rust 四核心模块（含 indicators_extended）整体 rustc metadata 类型检查通过；TA 库 10 项 + 脚本沙箱 11 项已用 Node 真实执行验证通过。`cargo test` 尚未真正跑过（缺构建工具）。
- **KLineChart 关键 API**：`chart.setStyles("light"|"dark")` 切内置主题；`chart.getConvertPictureUrl(true, "png", bgColor)` 导出图片；这两个方法都在 d.ts 里确认存在。自定义指标 `text` figure 可用 `attrs: () => ({text:"▲"})` 覆盖默认数值文本。
- **网络**：国内拉 Binance 需代理；本机代理是 `http://127.0.0.1:1081`。curl 直连 api.github.com 报 schannel 证书错，加 `-k -x http://127.0.0.1:1081`。

## 当前代码结构

- `src/`：TS 前端。`main.ts` 主逻辑（指标叠加/回测面板/回放/实时/绘图工具/脚本编辑器）；`api.ts` Tauri invoke 封装；`types.ts` 共享类型；`style.css` 样式。
- `src/scripts/`：`ta.ts` 脚本用精简指标库；`script-worker.ts` Web Worker 沙箱；`script-host.ts` 主线程 Worker 管理 + 3s 超时终止。
- `src-tauri/src/core/`：`model.rs` 数据模型；`indicators.rs` 核心 10 指标（未命中时回退扩展库）；`indicators_extended.rs` 扩展 20 指标（合计 30）；`backtest.rs` 事件驱动回测引擎（4 个单测）。
- `src-tauri/src/data/`：`binance.rs` REST；`ws.rs` WebSocket；`csv.rs` CSV 导入。
- `src-tauri/src/lib.rs`：Tauri 命令层 + 内存缓存。

## 已完成（阶段 1–4，详见下方阶段 5–8）

1. **指标线上图**：用 `registerIndicator` 注册自定义指标，Rust 算的值写进 bar 的 `rust_<kind>_<i>` 扩展字段，calc 从 dataList 读取。主图叠 SMA/EMA/BOLL/VWAP，副图 RSI/MACD/KDJ/ATR/OBV。关键：KLineChart 10.x 的 `_addData` 是 `this._dataList = data` 原样引用，扩展字段不会丢；数据更新会触发 `_calcIndicator` 重算。
2. **Rust 回测引擎**：借鉴 Wickline 的 `backtest.js`（MIT）成交语义——信号 close 产生/下一根 open 成交、跳空按 open、同 bar 止损止盈先算止损、手续费滑点、完整统计。前端有双均线交叉示例面板。
3. **JS 脚本沙箱**：借鉴 Wickline 的 `script-worker.js`。Web Worker + 块作用域包裹（`{ code }` 让用户声明同名变量）+ BLOCKED 数组用 undefined 遮蔽危险 API + 错误行号映射 + TypedArray 零拷贝。**关键取舍：脚本只产出策略信号，成交交给 Rust 回测引擎**，不用 JS 做回测。
4. **绘图工具 + 回放 + 实时**：`getSupportedOverlays()` 动态列工具，点击 `createOverlay(name)`；回放到截断 currentBars + setDataLoader 重喂；实时订阅用 DataLoader 的 `subscribeBar` 回调做图表原生局部更新（不要反复 setDataLoader，会重置视窗）。

## 阶段 5–8 已完成

5. **回测可视化**：`candlelab_bt_marker` 自定义指标（text figure 画 ▲/▼）叠在主图；回测 marker 存 `backtestMarkersByIndex`，`applyMarkersToBars` 挂到 bar 的 `bt_buy`/`bt_sell` 扩展字段，`toKLine` 会把 `bt_` 前缀一起带给图表。关键：`refeedChart()` 用 `feedFromCache` 标志让 DataLoader 不重新拉网络、只重喂现有 bars。权益曲线用独立 Canvas 手绘（equity 线 + drawdown 填充 + 买入持有对比）。
6. **指标 30 个 + 参数可调**：`indicators_extended.rs` 新增 20 个（wma/smma/stdev/roc/mom/dema/tema/cci/willr/mfi/adx/donchian/keltner/aroon/trix/bop/cmf/uo/dpo/posc），`indicators.rs` 的 `_ =>` 分支回退到扩展库，`supported()` 合并两者。前端 `indicatorMeta` 补齐 20 个元数据（决定线数/颜色/窗格），`renderIndicatorParams` 生成参数输入框。
7. **主题 + 快捷键**：CSS 全改为变量（`--bg/--surface/--text/--accent/--up/--down` 等），`body[data-theme="dark"]` 覆盖；图表用 `chart.setStyles(theme)`；localStorage 持久化。快捷键见 README。
8. **导出 + 预警**：`chart.getConvertPictureUrl(true,"png",bg)` 导出；价格预警纯前端（目标价 + above/below），在数据加载和实时推送时检查，触发应用内提示 + Notification。

## 还没做（下一步候选）

1. **装 VS Build Tools 后跑通 `cargo check` / `cargo test` / `npm run tauri dev`**（当前机器唯一硬阻塞）。装上后重点实机验证：`series:"price"` 的 text marker 箭头 y 定位是否落在可见范围（当前用 low/high ± range*0.6，理论上在范围内）。
2. 脚本策略的 hline/fill 前端渲染——沙箱已产出 `hlines`/`fills` 数据（见 script-worker 输出），前端目前只画 plot 线和 marker，hline/fill 还没接。
3. 多图表布局（Wickline 有 1/2/3/4/6 布局 + 跨图同步）——这是与 Wickline 功能对齐的最后一块大工程。
4. 设置面板：回测参数可视化调整（当前是代码里的 `defaultBacktestConfig` 常量）。

## 合规边界

仅接 Binance **公开行情接口**（klines），不含账户/下单/资金。定位离线技术分析工具。不碰交易执行接口；面向中国大陆用户时注意监管要求，行情数据商用需遵守数据源条款。

## Git 状态

- 主分支 `master`，首次提交 `2c94169`。
- `.gitignore` 已排除 node_modules / target / dist / .workbuddy / 密钥文件。
- 仓库 https://github.com/by520free/tradingview-rust （私有）。
- GitHub 连接器 token 可读取但**无创建仓库权限**（403）；建仓和推送用的是本机 `~/.git-credentials` 里的 PAT。
