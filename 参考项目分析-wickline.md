# 参考项目分析：Wickline

分析对象：https://github.com/keptaduona/wickline （2026-11-22 查阅，commit `c0d19fb`）

## 一句话结论

**这是"我们要做的东西"的完成态参照物，而且 MIT 许可、可以合法借鉴代码。** 它证明了"砍掉 Pine Script 兼容 + 砍掉授权数据后，一个人加 AI 一个月能做出接近 TradingView 核心体验的软件"。我们的方案 A 判断得到验证，技术选型（Tauri + KLineChart）无需改变，但它的**脚本沙箱、回测成交语义、双形态部署**三处设计值得直接抄。

## 项目事实

| 项 | 值 |
|---|---|
| 许可证 | MIT（图表库 Lightweight Charts 是 Apache-2.0，需保留署名） |
| 版本 | 0.1.2 |
| 首个提交 | 2026-11-13，最新 2026-11-18 —— 约一周密集开发 |
| 开发方式 | commit 明确带 `Co-Authored-By: Claude Opus 5.5`，人 + AI 协作模式 |
| 技术栈 | Electron 45 + Lightweight Charts 5.3 + 纯静态 JS（无构建步骤）+ Node.js 22 |
| 规模 | `public/js/` 约 20 个模块，核心文件 chart-view.js 64KB、app.js 47KB、indicators.js 44KB、datafeed.js 32KB |
| 数据来源 | 加密：Binance / Binance Futures / Coinbase（免 key）；股票等：Yahoo + Nasdaq（非官方，靠本地 server 转发绕 CORS）；静态站降级用 Twelve Data（用户自填 key） |

功能覆盖：55 内置指标、JS 自定义指标/策略 + Web Worker 沙箱、回测引擎 + Strategy Tester、16 种绘图工具、价格预警、1/2/3/4/6 图表布局与跨图同步、选股器、新闻与财经日历、多主题。

## 架构对比：它和我们走的是相反的路

| 层级 | Wickline | CandleLab（我们） | 判断 |
|---|---|---|---|
| 桌面壳 | Electron | Tauri 2 | 我们的更小更快，但 Windows 上要装 MSVC（当前阻塞点）；它开箱即用 |
| 数据中转 | Node `server.mjs` | Rust 后端 | **同一个角色**，我们用 Rust 扮演，符合初衷 |
| 前端 | 纯静态 JS，零构建 | Vite + TypeScript | 它省事、可直接托管；我们有类型安全，长期更稳 |
| 图表库 | Lightweight Charts + 插件自绘工具 | KLineChart 10.x | 我们占优：它得自己用 plugin API 画全套绘图工具，KLineChart 自带 16 种 |
| 指标/脚本 | 55 个，JS 写，Worker 沙箱 | 10 个，Rust 核心 | 它的数量碾压；但我们的计算在 Rust，性能和"用 Rust 重写"的初衷都保住了 |
| 回测 | 完整引擎 + 测试面板 | 未做 | **最大差距**，可直接借鉴设计 |

注意一个自我修正：之前调研说"Lightweight Charts 零绘图工具"，严格讲是**库本身零工具，但提供 plugin API 让 Wickline 自己画出 16 种**。所以它不是做不到，而是要自己写。我们选 KLineChart 依然更省事。

## 三处值得直接抄的设计

### 1. 脚本系统：用 JavaScript，不自研 DSL

这是对我们"Pine Script 兼容是最大坑"那个判断的**实用解法**——不做 Pine 兼容，自己定义一套简单的 JS API（`indicator` / `input` / `plot` / `ta.*` / `marker` / `fill`），用户用普通 JavaScript 写指标。

`public/js/script-worker.js` 的关键手法，值得照搬到我们的实现：

- **Web Worker 隔离**：用户脚本跑在独立 Worker，碰不到 DOM、页面存储和主进程数据。
- **3 秒超时 kill**：死循环不会冻住应用。
- **黑名单遮蔽**：把 `self` / `fetch` / `WebSocket` / `importScripts` 等用 `undefined` 参数遮蔽（`BLOCKED` 数组）。README 也诚实说明这"不是硬安全边界，只是让脚本专注图表数学"。
- **块级作用域包裹**：`PREFIX = '"use strict";{\n'` + `SUFFIX='\n}'`，让用户能声明 `max`、`n` 这类同名变量不冲突。
- **精确错误行号**：靠 `throw` 一个探测异常算出 `lineOffset`，把堆栈行号映射回用户代码行。
- **TypedArray 零拷贝回传**：`Float64Array` + `postMessage` 的 transfer list 传递 plot 数据。

我们的版本可以把 `ta.*` 的计算放到 Rust（通过 WASM 或 IPC），脚本层只做编排——这样既保留它的易用性，又守住 Rust 核心。

### 2. 回测成交语义：防未来函数的正确做法

README 里写得很清楚，这几条是回测引擎的底线，我们做回测时照抄：

- 信号在 **bar close** 读取，成交在 **下一根 bar 的 open**（`fillOn: 'open'` 是默认）——策略看不到未来。
- 止损/止盈/移动止损按每根 bar 的 high/low 检查；跳空越过价位则按开盘价成交。
- **同一根 bar 同时触及止损和止盈时，先算止损**（保守选择）。
- 手续费和滑点作用于每次成交。
- 多空分表统计，权益曲线对标 buy & hold。

`public/js/backtest.js` 只有 12.8KB，逻辑紧凑，配合 `test/backtest.test.mjs` 单测，是最值得移植的部分。

### 3. 双形态部署：一套前端两种运行方式

同一套 `public/` 静态文件：
- **桌面端 / `npm start`**：内置 server 转发 Yahoo 和 Nasdaq（浏览器被 CORS 挡），全功能、免 key。
- **纯静态托管**：把 `public/` 丢到任何静态主机即可免费托管，crypto 全功能；股票历史要访客自填免费 Twelve Data key，屏幕选股器/新闻/日历等功能降级。

这个设计的价值：桌面端负责"数据代理 + 全功能"，网页端负责"零成本分发"。我们的 Tauri 后端天然就是它那个 server 的角色，可以参考它的降级表设计功能矩阵。

其他可借鉴的小点：版本更新检查（`/api/health` 报版本，检查 GitHub Releases）、分享链接（`/#s=YAHOO:AAPL&tf=1D`）、图表导出 PNG、快捷键体系、可视化配色全可自定义、双轴缩放处理。

## 必须警惕的坑（也是我对你项目的判断依据）

1. **Yahoo 是非官方、未文档化的数据源**。README 自己承认随时可能变更或限流，部分交易所延迟 15 分钟。这印证了之前调研的结论：**数据授权是这类项目最容易翻车的地方**。我们坚持"加密 + 本地 CSV 起步"是对的。

2. **它没有 Pine Script 兼容**。它用自定义 JS API 绕开了这个难题——这再次说明"让存量 Pine 脚本跑起来"是另一个量级的工程，不该放进第一版。

3. **合规边界比我们预想的更敏感**。它接了 Yahoo 的股票/外汇/期货公开流，自己声明"数据可能延迟或错误，不构成投资建议，不要用于交易决策"。我们定位"离线技术分析工具、不碰交易执行"的边界要继续守住。特别是面向中国大陆用户时，股票数据商用授权和加密行情监管这两条不能碰线。

4. **MIT 不等于完全无负担**。Wickline 代码 MIT 可以用，但图表库 Lightweight Charts 是 Apache-2.0，要求保留署名（它的图表上有 TradingView logo、状态栏有链接，README 明确要求修改版保留或提供等效署名）。如果我们**借鉴代码而非直接依赖库**，这条不适用；但如果 fork 它的 `public/` 整套，就得保留。

## 对我项目的具体影响

- **不改方案**：方案 A（Tauri + KLineChart + Rust 核心）继续成立。它用 Electron + LW Charts 是另一条可行路，但我们没有理由掉头。
- **抄设计不抄代码**：它的脚本沙箱和回测语义是通用设计，可以直接指导我们的实现；具体代码是 JS，我们要用 Rust 重写核心，只能借鉴思路。
- **重新排序待办**：原计划第 4 项是"前端订阅实时 WebSocket"，第 5 项是回测。看完它我倾向于把**回测引擎提前**——它证明了回测是这类软件的核心卖点，而且设计清晰、12.8KB 就能起步。
- **一个诚实的备选**：如果目标只是"尽快有一个能用的 TradingView 类软件"，直接 fork Wickline（MIT）比我们从零快得多。但我倾向不走这条——用户要的是"用 Rust 重写"，全 JS 的 Wickline 不满足这个初衷。保留我们的路线，把它当参照物和设计蓝本。

## 出处

- 仓库 README、package.json、commit 历史、`public/js/script-worker.js`（2026-11-22 通过 GitHub API 读取）
