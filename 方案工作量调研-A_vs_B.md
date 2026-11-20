# TradingView 类软件：A / B 方案工作量调研

调研日期：2026-11-20
目标：用 Rust 重写一个 TradingView 类软件，对比两条 UI 路线在**本项目具体模块**上的工作量，给出倾向性建议。

---

## 0. 先纠正一个上一轮的错误判断

上一轮我说"Web 图表库帮你省掉 80% 的图表工作量"——**这是错的**，必须修正。

TradingView 官方产品对比页明确写着：Lightweight Charts 是纯渲染器，**不含任何内置指标、不含绘图工具、不含行情数据**。它只负责把蜡烛图画出来 + 时间轴/价格轴/十字光标/实时更新。所有技术指标、趋势线、斐波那契、多窗格布局，都得你自己写。

所以 A / B 两方案的真实差距不在"图表引擎"，而在**UI 外壳的开发效率**和**指标/绘图工具库的可复用程度**。

---

## 1. 两条路线定义

| | 方案 A（混合，主流） | 方案 B（纯 Rust 原生） |
|---|---|---|
| 架构 | Rust 核心计算 + Tauri 桌面壳 + Web 前端 | egui/eframe 全原生，wgpu 直绘 |
| 渲染 | 浏览器 WebView（Canvas） | GPU 直接绘制 |
| UI 语言 | HTML/CSS/TS | Rust |
| 代表库 | KLineChart / Lightweight Charts | egui-charts / egui_plot |
| 网络共识 | 多数"Rust 重写软件"的默认答案 | 少数派，Zed/Discord 级投入 |

---

## 2. 关键发现：两个现成的图表库改变了工作量天平

### A 路线的王牌：KLineChart（成熟）
- Apache-2.0，Canvas，零运行时依赖，约 58 KB gzipped
- **开箱自带 27 个技术指标 + 16 个绘图工具**（MACD、RSI、布林带、趋势线、斐波那契等）
- GitHub 4.3K stars，约 295 commits/年，3 天前还有提交（截至 2026-11 数据）
- 移动端触摸支持
- 对比：Lightweight Charts 虽有 17.9K stars、更活跃，但零指标零绘图工具，用它等于把分析层整个重写一遍
- **结论：A 路线选 KLineChart，不是 Lightweight Charts**

### B 路线的潜在王牌：egui-charts（极不成熟）
- 定位就是"TradingView-quality charts for egui"，纯 Rust，可编 WASM
- 纸面功能非常完整：20 种图表类型、95 个绘图工具、130+ 指标、撤销重做、磁吸、持久化、主题系统、回测框架、脚本扩展、订单流/深度图
- **但**：0.1.0（2026-03）、0.2.0（2026-06）两个版本都标为 unstable，月下载量约 21，作者单人项目
- docs.rs 的 API 文档里，很多模块仍标为内部实现细节，文档与功能宣称不完全一致
- **结论：功能诱人但不可作为生产依赖。可以拿它做技术验证，不能拿它做产品地基**

---

## 3. 模块化工作量清单（人天估算，单人熟练开发者）

估算口径：做到"可用 MVP"（图表 + 20 指标 + 基础绘图 + 回放 + 加密数据源），非 TradingView 全功能。

| 模块 | A：Tauri + KLineChart | B：egui 自研 / egui-charts | 说明 |
|---|---|---|---|
| 桌面壳 + 打包 | 3–5 天 | 3–5 天 | Tauri vs eframe 都是现成的，持平 |
| K 线渲染 + 缩放平移 | 1–2 天（库自带） | 15–30 天（自研）/ 5–10 天（用 egui-charts 且承担风险） | 差价最大的一项 |
| 20 个技术指标 | 5–10 天（库带 27 个，补缺口） | 20–40 天（从零写或用不稳定库） | 指标算法本身两边都是 Rust/TS 重写 |
| 绘图工具（趋势线/斐波那契等） | 3–8 天（库带 16 个） | 30–60 天（95 个工具是巨大工程量） | 即使 egui-charts 提供 95 个，验证/修复也要大量时间 |
| 历史回放 | 5–8 天 | 5–8 天 | 逻辑层工作，与 UI 无关 |
| 数据源（Binance/CSV/复权） | 10–15 天 | 10–15 天 | Rust 侧两边都一样 |
| 中文输入 / IME | 0 天（浏览器天然支持） | 5–15 天（egui 部分支持；Iced/GPUI 不支持） | B 的隐性成本 |
| 多窗格 / 布局保存 | 5–10 天 | 10–20 天 | egui 布局需手写 |
| 策略回测引擎 | 20–40 天 | 20–40 天 | 纯逻辑，两边持平 |
| **合计 MVP** | **约 47–98 人天** | **约 108–193 人天** | B 约为 A 的 2–2.5 倍 |

持续维护成本：A 跟随成熟库的 bugfix；B 需要自己维护渲染栈，且 egui-charts 这类库随时可能停更（参考 2026 横评中 Maycoon 已停维、Pax 两年未更新）。

---

## 4. 一个对本项目的关键提醒

"用 Rust 重写"和"UI 也必须用 Rust"是两件事。TradingView 类软件的性能瓶颈在**指标计算、数据管道、回测**，这些天然属于 Rust；而 UI 是典型的 I/O + 声明式描述场景，WebView 完全够用。A 方案把 Rust 用在了刀刃上，B 方案把 Rust 用在了它最不擅长的生态领域。

2026 年覆盖 46 套 Rust GUI 框架的横评结论：Slint 和 egui 是唯二在无障碍与 IME 上无明显短板的；GPUI 无内置文本输入组件，评测者自写约 780 行绕过；多数框架的 CJK 字体与无障碍需额外处理；生态至今未收敛出"无聊但可靠"的默认选择。（原始来源：wybxc, *A 2026 Survey of Rust GUI Libraries*，由 charlie27.com 转述）

Zed 自研 GPUI 的规模：1961 个 Rust 文件、180 万行代码、252 个 crate，仅 gpui 一个 crate 就 10.4 万行（GitCode 博客基于其代码库统计）。这是"自研 UI 基础设施"的真实价签。

---

## 5. 结论与建议

**倾向：方案 A（Tauri + KLineChart），且现在就改。**

理由：
1. MVP 工作量约为 B 的一半（47–98 vs 108–193 人天）
2. KLineChart 提供的 27 指标 + 16 绘图工具是 B 路线无法稳定获得的现成能力
3. 中文输入、无障碍、移动端这些"非核心但必须有"的东西，A 免费获得，B 要额外付成本
4. Rust 在 A 方案里依然承担核心引擎角色，没有违背"用 Rust 重写"的初衷

如果仍想保留 B 的探索：把 egui-charts 作为**技术验证**（spike）单独做 1–2 周，看它的 95 工具/130 指标是否名副其实；验证通过再考虑是否切换主路线，不要让一个 unstable 单人项目成为产品地基。

### 前置事项
本机目前 `cargo`/`rustc` 不在 PATH，`~/.cargo/bin` 与 `~/.rustup` 均不存在。无论选 A 还是 B，动手前都需先安装 Rust 工具链。

---

## 资料来源
- TradingView 官方产品对比页：https://www.tradingview.com/charting-library-docs/latest/product-comparison
- KLineChart 能力调研：https://stockmarketstack.com/how-to/draw-candlesticks-in-your-own-app 、https://redsurgetechnology.com/blog/best-javascript-financial-charting-libraries-2026
- egui-charts crate 文档：https://docs.rs/egui-charts 、https://lib.rs/crates/egui-charts
- 2026 Rust GUI 横评：https://www.charlie27.com/2026/08/... （转述 wybxc 原始调查）
- Zed 代码规模：https://blog.gitcode.com/5379b0220a6d60311e72c89e4eb552a3.html
- Rust GUI 框架对比矩阵：https://blog.csdn.net/jjhenda00/article/details/160743198
