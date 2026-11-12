# AI Visibility · 真实数据链路

Report 里的三个页面（Performance overview / Prompts / Competitors）默认展示 **前端 seed 数据**
（右上角标「示例数据 · Demo」）。这个目录负责把它们换成**真实的模型回答统计**。

---

## 一句话原理

**AI 可见度不是算出来的，是必须真的去问的。**

对每一条追踪的 prompt，让模型现场回答一次，然后从回答里数：

- 有没有提到你的品牌 → 可见度
- 提到你排在第几 → 位置
- 引用了哪些域名 / 链接 → 引用份额
- 提到了哪些竞品 → 份额对比

---

## 三步流程

```bash
# 1) 问模型（每条约 3 轮，减少单次波动）
node scripts/visibility-scan.js

# 2) 把原始记录算成页面要的指标
node scripts/visibility-report.js

# 3) 刷新 Report 页面 → 徽标自动从「示例数据」变成「实时数据」
```

### 还没配模型？先用假数据跑通全链路

```bash
node scripts/visibility-scan.js --mock --date 2026-11-07
node scripts/visibility-report.js
```

`--mock` 不花钱、不联网，产出的是确定性假回答，用来验证管道和页面。
徽标会显示「mock 数据」，**不会**冒充实数据。

### 常用参数

```bash
node scripts/visibility-scan.js --dry-run          # 只列要问什么，不调模型
node scripts/visibility-scan.js --prompt p04       # 只跑一条
node scripts/visibility-scan.js --runs 1           # 少跑几轮（省钱）
node scripts/visibility-scan.js --date 2026-11-10  # 补跑某一天
node scripts/visibility-report.js --quiet          # 只写文件不打印
```

---

## 数据流

```
data/visibility/config.json          你追踪什么（品牌 / 竞品 / prompt 清单）
        │
        │  node scripts/visibility-scan.js
        ▼
data/visibility/runs/YYYY-MM-DD.json 每天一份原始记录（含每条回答的抽取结果）
        │
        │  node scripts/visibility-report.js
        ▼
public/data/visibility/report.json   页面直接读这一个文件
        │
        │  静态服务（server.js 的 serveStatic 本来就服务 public/ 下的 .json）
        ▼
public/views/report.js  fetch → 有真数据就用真数据，没有就退回 seed
```

**所以这个链路不需要给 `server.js` 加任何接口。** 改配置、改指标口径都在上面两个脚本里。

---

## 指标口径（写清楚，避免以后自己都搞混）

| 指标 | 算法 |
|---|---|
| AI visibility | 提到你的回答数 ÷ 总回答数 |
| Share of voice | 提到你的回答数 ÷（你 + 各竞品被提到的回答数之和） |
| Cited pages | 回答里引用你域名的总次数 |
| Brand mentions | 品牌名出现的总次数（别名重叠只算一次） |
| Brand sentiment | 提及中含正面词的回答占比（简单词典，不是真情感模型） |
| Avg. position | 提到你时你排第几的均值（按首次出现位置，越小越好） |
| Cited domains | 所有回答里出现过的不同引用域名数 |
| Cited URLs | 引用链接总次数 |
| Unlinked cites | 提到了你、但整条回答没给过你域名的次数 |

**变化量（那个 ▲/▼）** = 所选区间的**最后一天 vs 第一天**。
所以日期区间选得越长，这个数越像「趋势」，选一天就是 `+0.0`。

---

## 怎么配模型

应用里已经有 provider 体系（`lib/providers.js`），扫描器复用它，不另存 key：

1. 打开应用 → **Settings** → 填一个 provider（OpenAI 兼容网关或 Anthropic 都行）
2. 在下面「模型」里选一个 → 测试通过
3. 回到命令行跑 `node scripts/visibility-scan.js`

也可以指定某个 provider：`node scripts/visibility-scan.js --provider <id>`。

没配 provider 时脚本会直接告诉你，不会静默跑空。

### ⚠️ 推理模型：`max_tokens` 给小了会全是空回答

`deepseek-v4.1-flash` 这类模型先输出 `reasoning_content`（思考）再输出 `content`（正文），
而 `lib/providers.js` 只取 `content`。预算被思考吃光时正文就是空串，
报错长这样：`openai 返回空内容`。

实测（12 条 prompt × 2 轮 = 24 次调用，同一天）：

| `max_tokens` | 空回答数 |
|---|---|
| 700 | **44 / 48** ← 第一版就栽在这，看着像接口挂了 |
| 3000 | 0 / 24 |

所以 `config.json` 里 `scan.maxTokens` 默认 **3000**，扫描器还会在遇到空内容时
自动翻倍到 8000 再试一次。换更「能想」的模型可能要再往上调。

---

## 成本

默认配置 = **12 条 prompt × 3 轮 = 36 次调用/天**。每次回答限 700 tokens。

- 小模型（4o-mini / deepseek-chat 级别）：约 **$0.01–0.03 / 天**
- 大模型（GPT-4o / Claude Sonnet 级别）：约 **$0.3–1 / 天**

嫌贵就把 `config.json` 里的 `scan.runsPerPrompt` 改成 1，或先只留 4–6 条核心 prompt。

---

## 必须说清楚的边界（别把结果当成「用户真实看到的样子」）

这套是**API 采样**，和真人在 ChatGPT/Perplexity 里看到的**不完全一样**：

1. **没有个性化**：真实用户带着历史、地区、账号偏好，API 没有。
2. **没有搜索接地**：真实产品常常先搜再答，API 直连不搜 —— 会让「引用」偏低，
   而「引用」恰恰是这套指标里最值钱的部分。
3. **模型版本会漂移**：provider 那边升级/换模型，可见度会跳，那不是你的内容变了。
4. **样本量小**：12 条 prompt × 3 轮 → 单个 prompt 的可见度误差很大，
   看趋势可以，看小数点后一位没意义。

要更接近真实，需要**带 web search / grounding 的模型或产品**（Perplexity API、
OpenAI 的 web_search 工具、Google AI Overviews 的抓取）。换的时候只需要改
`scripts/visibility-scan.js` 里的 `realAnswer()`，其余不用动。

---

## 回到 demo 状态

```bash
rm data/visibility/runs/*.json
rm public/data/visibility/report.json
```

页面立刻退回 seed，徽标变回「示例数据 · Demo」。

---

## 定时跑

Windows 计划任务（每天 09:00）：

```powershell
schtasks /create /tn "AIVisibility" /sc daily /st 09:00 /tr ^
  "cmd /c cd /d C:\Users\xunuoyan\Desktop\code\social-content-automation && node scripts/visibility-scan.js --quiet && node scripts/visibility-report.js --quiet"
```

⚠️ 同一个 `data/visibility/runs/<日期>.json` 重跑会**覆盖同一天同一条**，不会累加，
所以一天跑几次都安全。
