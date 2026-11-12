# Social Content Automation

本地跑的内容工作台，按 **StoryChief 的板块结构**组织：

```
Dashboard   ← 接 AI、配 agent、下指令（现在做的就是这个）
Strategy    ← 选题与内容机会（还没做）
Planning    ← 排期日历（已有）
Content     ← campaign / 资产 / 版本 / 规则校验（已有）
Report      ← 效果回流（还没做）
```

零依赖：只用 Node 内置模块，`node server.js` 就起来，没有 `npm install`、没有构建、没有数据库。

---

## 怎么跑

```powershell
cd social-content-automation
node server.js
# 打开 http://127.0.0.1:4319
```

或者双击 `start.cmd`。

| 想做的事 | 命令 |
|---|---|
| 灌演示数据（2 campaign × 7 资产，带排期） | `node scripts/seed.js` |
| 单元测试（规则 + 迁移 + agent） | `npm test`（30 + 13 + 24 项） |
| 界面可量化验收 | `node scripts/shot.js` |
| Content 交互验收 | `node scripts/ui-flow.js` |
| Dashboard 交互验收 | `node scripts/ui-dash.js` |
| 换端口 | `$env:SCA_PORT=4400; node server.js` |
| 重灌数据 | 删掉 `data/campaigns.json` 再启动 + `node scripts/seed.js` |
| 停掉后台实例 | `Get-NetTCPConnection -LocalPort 4319 -State Listen \| %{ Stop-Process -Id $_.OwningProcess -Force }` |

---

## Dashboard：对齐 StoryChief 的 agent 首页

页面从上到下就三层：**标题 → 四张配置卡 → 对话**，右侧一列 Recent chats。

```
┌─────────────────────────────────────────────────┬──────────────┐
│ Set up your marketing agent                     │ Recent chats │
│ Teach it about your business once. …            │           ＋ │
│ ●模型 · ●公司知识 · ○文件 · ○SC · ○工具          │ ───────────  │
│                                                 │ 还没有历史对话 │
│ ┌──────────┬──────────┬──────────┬──────────┐   │              │
│ │ Company  │ Google   │ Connect  │ Knowledge│   │              │
│ │ knowledge│ Search   │ your     │ files    │   │              │
│ │          │ Console  │ tools    │          │   │              │
│ │ [Start   │ [Connect]│ [Explore]│ [Upload] │   │              │
│ │  setup]  │ +2k AI   │ 8        │ 0 files  │   │              │
│ │ 7 of 7   │ credits  │ available│          │   │              │
│ └──────────┴──────────┴──────────┴──────────┘   │              │
│ ┌───────────────────────────────────────────┐   │              │
│ │ Ask to analyze your competitors        [↑] │   │              │
│ │ Tip: use + files, @ plugins, $ skills      │   │              │
│ │ (Get started)(Research my competitors)…    │   │              │
│ └───────────────────────────────────────────┘   │              │
└─────────────────────────────────────────────────┴──────────────┘
```

### 四张卡 = 四块「配置」的入口

| 卡 | 文案 | 按钮 | 右下角 |
|---|---|---|---|
| Company knowledge | Your business, audience, competitors, and what makes your brand different. | **Start setup**（蓝）→ 填过一部分变 Continue setup，齐了变 Review | `N of 10 complete` |
| Google Search Console | What brings visitors to your website, and where you're missing opportunities. | **Connect**（= 真 OAuth 的第一步）/ Connected | 绿色 `+2k AI credits` |
| Connect your tools | Information and actions from the tools your team already uses. | Explore | `15 available` / `N of 15 connected` |
| Knowledge files | Internal product details, pricing, and research your agent can't find online. | Upload（直接唤起选文件） | `N files` |

**点整张卡或按钮 → 展开详情面板**（四块的完整表单都在里面，带返回箭头）。表单还是原来那套字段，一个没删；数据、接口、校验逻辑全没动，只是从"四张卡里摊着"变成"点进去编辑"。

### 对话区

- 输入框占位：`Ask to analyze your competitors`
- 下面一行小字：`Tip: use + to add files and context, @ for plugins, or $ for skills`
- 再下面 8 个圆角快捷指令：`Get started` `Research my competitors` `Find content gaps` `Improve my AI visibility` `Plan a campaign` `Repurpose my content` `Refresh my content` `Explore more` —— 点一下直接发问
- 右下角小胶囊显示这次用的是哪个 provider（没接就写"离线模板"）
- `Enter` 发送，`Shift+Enter` 换行，输入框高度自适应

### 右上角

`离线模式`（胶囊，接上模型会变成 provider 名） · `导出 MD` · `CSV` · **`接入模型`（蓝色主按钮，点开 provider 弹窗）** · 齿轮（生成设置）

### 视觉规格（都被 `scripts/shot.js` 断言，跑不过就是坏了）

| | 值 |
|---|---|
| 背景 | 页面 `#fbfbfd`，卡片纯白 |
| 字体 | **本地 Inter**（400/500/600/700，latin 子集，离线可用；中文回退 PingFang/微软雅黑）。4 个 woff2 共 ~190KB，在 `public/fonts/` |
| 字号 | 只用 12 / 13 / 14 / 16 / 20 / 26；H1 26，卡片标题 16，正文 13 |
| 卡片 | 4 列等宽（当前 248×222）、间距 16、圆角 16、边框 1px `#ebedf2`、阴影 `0 1px 2px rgba(16,24,40,.04)` |
| 弹窗 | 760px 宽，同样薄边框 |
| 深色块 | 0 个（脚本会扫整页，除主按钮外任何大面积背景亮度必须 > 0.5） |
| 对比度 | 全部 ≥ 4.5:1（实测最低 4.5，主按钮白字在 `#2f6bff` 上） |

---

## Strategy：四个板块，但只有一份数据

Strategy 不是新做一套功能，它是 Dashboard 那些东西的**另一个门**。StoryChief 的导航就是这个结构，
我们也照抄结构、不照抄"每个板块各存一份"的坏毛病。

```
Strategy
├─ New chat           和 Dashboard 的对话框共用 /api/chats + /api/agent/chat
├─ Content audit      接入 Search Console（真 OAuth）或粘导出 → 修复清单 → 一键转成 campaign
├─ Company knowledge  就是 Dashboard「Company knowledge」那整块 8-tab 面板（DOM 借用，不是复制）
└─ Plugins & skills   应用目录（安装→授权→贴数据）+ 技能 = data/skills.json
```

### 「同一份数据」是怎么保证的

| 共享的东西 | 实现方式 | 怎么验证 |
|---|---|---|
| 品牌知识 | 一个 `data/knowledge.json`，一个 `POST /api/knowledge` | 整页 `#knName` 只有 1 个；改完两边都变 |
| 视觉规范 / 图库 | `knowledge.company.visualStyles` + `knowledge.images` + `data/knowledge/img/` | 删条目不动图片；删图片会把引用一并摘掉 |
| 知识文件 | `knowledge.files` + `data/knowledge/<id>.txt` | 列表 / 检索 / agent 取事实都读同一份 |
| setup 清单 | `lib/knowledge.js` 的 `BLOCKS`（10 项）算进度，两页都读 `knowledge.blocks` | 两页文案都必须等于 `done of total complete` |
| 对话 | 一个 `data/chats.json` | Strategy 发的话在 Dashboard 的 Recent chats 里能看见 |
| GSC | `data/gsc.json`（账号授权）+ `knowledge.gsc`（导入的原始表 `raw`） | 两个入口读同一份；Dashboard 卡显示 Connected/未接入 |
| 应用 | 就是 `knowledge.tools`（15 个内置目录项 + 自定义） | 任一侧安装/授权，另一侧立刻同步（`window.refreshStrategyTools`） |
| 技能 | `data/skills.json`（4 条内置 + 自定义） | 对话里 `@名字` 直接用 |

关键一条：知识表单在 Strategy 里是**把 Dashboard 的那块 DOM 搬过去**（`SCA.mountSection`），
不是复制一份 HTML。复制一份就迟早出现"两边填的不一样"，而且 id 会重复。

### Content audit：确定性的，不是让模型猜

分析永远是确定性的（阈值 + 规则），模型只负责照着清单写。数据有两条路进来，**都不用改代码**：

**A. 真接入 Search Console（推荐，一次性 3 步）**

1. 在 [Google Cloud Console](https://console.cloud.google.com/) 建一个项目 → 启用 **Search Console API** →
   OAuth 同意屏幕选 External、加你自己为 test user；
2. 凭据 → 创建 **OAuth 客户端 ID**，类型选「Web 应用」，
   把回调地址填成 `http://127.0.0.1:4319/api/gsc/callback`（页面上有「复制」按钮，别手打）；
3. 把 Client ID / Client Secret 贴进 `Strategy → Content audit → 开始接入`，存好后点 **用 Google 授权**，
   走完 Google 的同意页会自动跳回来，然后点 **同步最近 28 天**。

- scope 只要 `webmasters.readonly`（只读），token 存在本机 `data/gsc.json`，`publicView` 只回 `keyHint`，不回明文；
- 凭据由**你自己**在自己项目里创建，这个工具不带任何内置 key —— 也就没有「用谁的项目、谁付配额」的问题；
- ⚠️ 本机实测：`oauth2.googleapis.com` 通（授权能走完），但 `www.googleapis.com`（Search Console API 的域名）
  被公司网关挡住，**在这台机器上同步会失败**，报错会如实写"连不上 Google（ENOTFOUND/超时）"。
  换一台能直连的机器，或者用下面的 B。

**B. 粘导出（永远能用）**

表格直接从 Search Console「效果 → 查询」整段复制即可，中英文表头、制表符 / CSV / 带引号的 `"1,900"` 都认。
解析不出来就明说"这一行看不懂"，**绝不瞎猜**。

| 类型 | 条件 | 建议 |
|---|---|---|
| 标题/描述不够吸引 | 前 10 名、CTR < 2%、展示 ≥ 100 | 改 title 与 meta description |
| 临门一脚（第 2 页） | 第 11–20 名、展示 ≥ 50 | 加一个小节直接回答这个查询 |
| 内容不够深 | 21–50 名、展示 ≥ 20 | 扩写成完整文章 |
| 没有对应内容 | > 50 名或未上榜、展示 ≥ 10 | 新页或新章节 |
| 内容支柱空着 | 支柱词在数据里一条都没命中 | 这个支柱还没写，或写了没人搜 |

优先级 = 展示 × 类型权重，降序。每条都能「转成 campaign」直接进 Content 写。
解析不了就返回 `warnings` + 空清单，**绝不编排名**。

### Plugins 不是"登记表单"，是应用目录

真实产品里这一块的形状是：**图标 + 一句话 + 安装按钮**，装完再授权，授权之后才读得到数据。
我们照这个形状做，但不做假的 OAuth 握手：

```
┌──────────────────────────────────────────────┐
│ [G]  Google Analytics 4           [安装]      │  ← 15 个内置（GA4 / Google Ads / Meta Ads /
│      网站流量与会话数据                        │     Ahrefs / Semrush / HubSpot / Mailchimp /
└──────────────────────────────────────────────┘     Notion / WordPress / Webflow / LinkedIn /
                                                     Slack / Stripe / PartnerStack / Zapier）
安装 → [授权] → 弹窗填账号 + 令牌 → 已授权 · team@x.com
                              └ 管理：贴导出数据 / 撤销授权 / 卸载
```

- **为什么不做真 OAuth**：那要逐个应用登记开发者应用、过审核、还可能要商务合作。
  用户原话：「如果这个是需要和这些软件合作这一块就不用做了」—— 所以这里**如实说清**：
  凭据存在你本机，工具只是拿它去调 API；
- 令牌**不回显**：`publicView` 只给 `keyHint`（`••••3456`），页面上搜不到明文；
- 「安装」和「授权」是两件事（装 = 我要用它；授权 = 给它凭据），卸载内置应用只是复位、不会被删掉；
- 自定义应用（自建 BI / 内部系统）可以自己加，标记 `自定义`，未授权时也能直接移除。

### Company knowledge：8 个 tab + 一张 setup 清单

按 StoryChief 那套形态重做的，一块面板里 8 个 tab：

```
Overview │ General │ Target audiences │ Content pillars │ Brand voices │ Writing style │ Visual style │ Knowledge files
```

- **Overview（默认）**：一句说明 + 三张解释卡（Sharper recommendations / More consistent writing /
  Grounded in your sources）+ **Fresh start**（蓝按钮 `Complete with AI`）+ **Setup progress**；
- **Setup progress 是两列 10 项**（左列 Website / Brand voices / Visual style / Google Search Console /
  Target audiences，右列 Company description / Writing style / Competitor websites / Content pillars /
  Knowledge files）。做完的打绿勾，没做的空心圆；**点任意一项 → 跳到对应 tab 并聚焦那个输入框**。
  右上角写 `N/10 complete`，Dashboard 卡上是同一份数字（都来自 `knowledge.blocks`）；
- **General**：Website（+ 公司名）、Company description、Languages（`Add language`，空时显示
  `No languages`）、Competitor websites、Google Search Console（右侧 `Connect Google Search Console`）、
  Custom instructions（Expert mode）。老字段没丢：一句话定位 + 产品进了 **Company description**，
  差异化卖点 + 可引用证据进了 **Custom instructions**（迁移一次性写回磁盘，幂等）；
- **Brand voices**：列表 + `Add brand voice` → 弹窗 `Create Brand Voice`
  （Name / Description / Use case / Excerpts，底部 `Cancel` + `Create`）。原来那条
  「直接、具体、不吹」就是一条 voice；
- **Target audiences**：列表 + `Add target audience` → 弹窗 `Create Target Audience`。
  上半是 **Audience profile**（Industries / Job titles 可多行加、Company size 可选可输），
  下半是 **Needs and concerns**（Goals 绿勾 / Pain points 红色警告）。条目都能单行删；
- **Content pillars**：列表 + `Add content pillar` → 弹窗 `Create Content Pillar`。
  **Strategy** 组里 Target audiences 能直接绑定上面建好的受众、Search questions 逐条加；
  **Content guidance** 组里 Topics to include（绿勾）/ Topics to avoid（红叉）/ Core messages（文档）各成一行。
  老的三条（内容适配 / AI 可见性 / 竞品对比）已经合成**一条** pillar，三个主题都在 Topics to include 里；
- **Writing style**：列表 + `Add writing style` → 弹窗 `Create Writing Style`（和其他三个同一套外形）。
  字段是**纯结构化的开关和下拉**，不是自由文本：
  **Writing style**（缩写 / 不用模糊限定词 / 不用填充词 / 性别中立）、
  **Punctuation**（不用分号 / 牛津逗号 / 句号代替感叹号 / 不用破折号 / 引号风格）、
  **Symbols and special characters**（不用 & / 不用 + 表示 and）、
  **Titles and headings**（标题大小写）。可以并存多条（Blog / Twitter / YouTube 各一套）。
  规则表只有一份（`lib/knowledge.js` 的 `WRITING_GROUPS`），前端照它渲染、prompt 照它写人话；
  原来那句「短句为主，先说结论；不堆形容词」已迁进一条 `通用写作规范` 的 **Additional notes**，
  生成文案时「开关配置 + 备注」一起进 LLM 上下文；
- **Visual style**：列表 + `Add visual style` → 弹窗 `Create Visual Style`。
  一条视觉规范 = Name + **Guidelines**（构图 / 情绪 / 光线 / 不要什么）+ **Color system**
  （Primary / Secondary，写成 `#RGB` 或 `#RRGGBB`，旁边带取色器）+ **Style references**
  （最多 4 张，jpeg/jpg/png/svg）+ **Logos**（最多 4 张）。可以并存多条
  （YouTube 封面 / 社媒配图 / 落地页各一套）。参考图和 Logo 存在**同一个工作区图库**里
  （`data/knowledge/img/`），每组上传后底部显示 `N of 4 left`；`Library` 下拉能直接复用图库里已有的图，
  删条目**不删图**；
- **Knowledge files**：独立文件页（不是弹窗）。三栏说明卡 + `Upload files` + 检索框 + 文件列表，
  空状态是 `No knowledge files yet` 加一段说明。文件支持查看 / 删除 / **按正文检索**
  （`GET /api/knowledge/files/search?q=` 返回命中片段，agent 执行任务时就是这么取事实的）。
  只收纯文本类（.md / .txt / .csv / .json / .html / .yml / .log / .tsv），
  PDF / Word / PPT **如实拒绝并提示先导出成文本**，不假装能解析；
- 三个弹窗同一套外形：**深蓝 header** + 可滚动的 body + 固定在底部的 `Cancel` / `Create`；
  受众、支柱、语气一律「列表 + 弹窗 + 结构化多行条目」，没有自由文本大框；
- `Complete with AI` **不编草稿**：它把"请读我的公司知识、指出缺哪几项并给具体草稿"的提示词放进
  Strategy 的对话框，并如实提示"发送前确认已接入模型"。

### Skills：一套流程存一次，@ 一下就跑### Skills：一套流程存一次，@ 一下就跑

技能 = 名字 + 说明 + 步骤（≤12 步）+ 期望输出。在对话里 `@技能名`（或点 chip），
服务端把它的步骤拼进 system prompt，回复上会标 `@技能名`。
技能**只是提示词模板** —— 真正的执行仍然走动作协议（≤6 个动作、服务端校验后落库），
所以"技能"不会绕过安全边界去改数据库。

内置 4 条：竞品内容缺口分析 / 月度内容计划 / GSC 机会修复 / 长文改六渠道。
自定义的可以增删改；内置的删掉会被自动补回，避免技能库被清空。

### 视觉上没重新设计

Strategy 沿用 Dashboard 那套：Inter、1px `#ebedf2` 边框、圆角 12–16、字号只用 12/13/14/16/20/26、
左侧栏 236px、右侧主区最大 1040px。`scripts/shot.js` 会把 Strategy 也扫一遍（深色块、对比度、字号、溢出）。

---

## 数据模型

```
data/
├─ campaigns.json   campaign → assets[] → versions[]（内容主库）
├─ providers.json   多个 provider + 每个的模型清单 + active
├─ knowledge.json   公司知识（10 项 setup / brand voices / audiences / pillars / languages）/ GSC（含导入的原始表）/ 插件 / 文件索引
├─ skills.json      技能库（步骤 = 拼进 system prompt 的 SOP）
├─ chats.json       对话历史（Dashboard 与 Strategy 共用）
├─ content.json     Content 列表的行（每条都指回 campaignId + assetId）
└─ knowledge/       上传的文本文件正文 + 图片库
```

```
campaigns[]
└─ assets[]
   ├─ type: article | social | email | video
   ├─ scheduledAt: '2026-11-14' | null
   └─ versions[]   { v, body, variant, source, status, checks }

content.items[]
├─ type: article | social | webpage | newsletter | video | webinar | ebook | podcast | campaign
├─ campaignId + assetId    ← 有它就进编辑器；状态/日期/语言都从这儿推导
├─ status / approval       ← 只有手动改过（statusManual）才以自己为准
└─ impressions / reads / geo / gap   ← 没数据源就是 null（列表显示 —）
```

**campaign = 一个核心主张，asset = 一处投放，version = 一次修改。** 版本只增不改，规则结果跟着版本存，`approved` 是下游唯一可信的状态。

### 从 v1 迁移

v1（`briefs.json`，一条素材 → 6 个渠道）首次启动自动迁成 v2（`campaigns.json`）：每个 brief 变成一个 campaign，每个有内容的渠道变成一个资产，版本历史与 `current` 原样保留，v1 文件不删。13 项单测覆盖。

---

## Content：一行一条内容，点进去才是编辑器

对齐 StoryChief 的 Content 页：**左边是树，右边是表**。

**左树（236px）= 分组 × 状态两层筛选**，每个分组都有 `All …` 加上 5 个状态子项：

| 分组 | 装的是 | 子项 |
|---|---|---|
| Content | 全部内容 | All content / Assigned to me / Drafts / Pending approval / Scheduled / Published |
| Articles | article · webpage · ebook · webinar | All articles + 同样 5 个 |
| Social posts | social · video | All social posts + 同样 5 个 |
| Broadcasts | newsletter · podcast | All broadcasts + 同样 5 个 |
| Media | 素材库（不是内容条目） | Workspace files / Unsplash / Canva |

`Assigned to me` 不是状态，是负责人筛选（单工作区里新建的东西默认就是你的）。

**右表 = 16 列**：`Title｜Status｜Effective date｜Approval status｜Collaborator｜Campaign｜Language｜Due date｜Author｜Impressions｜Reads｜Category｜Tag｜Keyword｜GEO & SEO score｜Content gap score`。除了 Tag / Keyword 都能点表头排序；首列勾选框支持多选（批量 Approve / Request approval / Delete）；`Columns` 面板逐列开关，选择存在 localStorage；行悬停出现四个动作（编辑 / 复制 / 排期 / 删除）。工具条：`Quick search`（输入即筛，变成可取消的 chip）、`＋ Add filter`（6 个条件）、`Create content`（9 种类型）、`Columns`。底部 `Prev｜1-14 of 14｜Next`。

空列表时是 StoryChief 那句原话 + 一个主按钮，按钮文案随分组变（Articles 下是 `Create article`，Social posts 下是 `Create social post`）。

**指标默认是 `—`，不是 0。** Impressions / Reads 要有站内分析 / GSC 数据源才填；**GEO & SEO 和 Content gap 两列只有 `article` 类型是真数** —— 就是文章编辑器里那 12 项通过率和内容支柱覆盖率，同一套算法，**读取时现算、不落盘**（分数是正文的函数，存下来就会跟正文脱节）；其它类型没有数据源，仍然是 `—`。本地工具不该编数字。

### 一条内容 = 一个渠道资产

列表里每一行都指向 `campaignId + assetId`，所以点标题进的就是**原来那个编辑器**：生成草稿 → 改 → 存版本 → 质检 → 批准 → 排期，全在那儿。列表页不做出渠道分发，分发是编辑器里的事。

- **状态不存第二份真相**：只要还挂在资产上，`Status / Effective date / Campaign / Language / Author` 都从资产和 campaign 推导 —— `Draft`（没生成或没批准）→ `Pending approval`（提交了审核）→ `Scheduled`（已批准 + 排了未来日期）→ `Published`（已批准 + 没排期或已过日期）。列表和编辑器不会各说一套。手动改过状态的条目才以手动为准。
- **Create content** 建的是「campaign 容器 + 一个对应渠道的资产」，然后直接进编辑器。删掉一条内容 = 删掉它背后的资产；容器 campaign 空了就一起收拾掉。
- **老数据自动进来**：`data/content.json` 不存在时，会按现有 campaign / 资产幂等补条目（campaign 只有在显式创建为 Campaign 类型时才单独成行，否则只通过子资产出现）。资产被删的条目**解绑但保留**，不会静默吃掉用户写过的东西。

### Media 三个来源

- **Workspace files**：真实的本地图片库（和 Company Knowledge → Visual style 的 Style references / Logos 是同一份），有图就铺缩略图，没图就说从哪儿上传。
- **Unsplash / Canva**：**没接入**，页面上如实写「接它需要 API key，本地工具默认不联网」。

### 编辑器三栏（点行进来的那一屏）

288px / 自适应 / 344px：

- **左**：campaign 列表，带资产数 / 已批准数 / 硬伤数
- **中**：主张与简报（折叠）→ 资产看板（按 文章/社交/邮件/视频 分组）→ 编辑器（16px/1.75，非等宽）→ 质量门（每条规则带出处）
- **右**：状态卡 / 版本时间线 / 与上一版 diff

左上角 `← 内容列表` 回去。快捷键：`Ctrl+S` 存成新版本。日历里点资产、Strategy 的「转成 campaign」都会**直接落到编辑器**，不会把人丢在列表页。


## 文章编辑器：Write / Settings / Audience

对齐 StoryChief 的 **Create Article**。v12 起，`type: 'article'` 的行点进去开的是这一屏（其它类型仍走上面那个三栏编辑器）。

顶部 60px 一条栏：标题（点一下就能改）+ 状态胶囊 + 状态下拉 + 三个指标（GEO & SEO / Readability / Content Gap，没配关键词时是灰点）→ 中间三个 Tab → 右边 Chat / 评论 / `Collaborate` / `Publish` / `⋯` / `×`。

下面两栏 = 正文 + **常驻的 `Optimize for GEO & SEO` 面板**（340px）。面板跟着 Tab 换：Write / Settings 下是 SEO 面板，Audience → Social networks 下换成 `Socials` 面板。

### Write

大标题占位框、提示语（逐字 `Press Enter to continue with an empty page, or pick a template (↑↓ to select)`）、两个起始项 `Start from scratch` / `Write article with AI`（后者读 Company Knowledge，复用 `llm.generate`；没有可用供应商时如实标「离线模板」）。

正文是 **Markdown 源文 + 工具条 + 预览**，不是 WYSIWYG（为什么见下面「诚实清单」）。工具条：粗体 / 斜体 / H2 / 有序 / 无序 / 引用 / 代码 / 链接 / 图片。停止输入 900ms 自动存（`POST /api/article/:id/body`），`Ctrl+S` 立即存，角落显示「已保存」。

### 右侧：Optimize for GEO & SEO

- **Focus keyword** + **Search localization**（地区 7 个 / 语言 7 个）
- 五张卡片：Content gap insights / GEO & SEO basics / Readability & structure / Plagiarism check / Word count，前三张带环形进度
- 告警清单：红的＝硬伤、灰的＝没配置；每条右边的 `show` **直接跳到出问题的那个字段并聚焦**（跳到 Settings 时会连子页一起切过去）

### 评分口径（12 项硬检查，全是本地规则）

| 检查 | 过 | 出问题该改哪儿 |
|---|---|---|
| Language 已设置 | 有值（critical） | 顶部 / Article details |
| Focus keyword 已填 | 非空（critical） | 右栏输入框 |
| 关键词 1–6 词 | 1–6 | 右栏输入框 |
| 关键词在标题里 | 包含 | Write 标题 |
| 关键词在开头 120 词内 | 包含 | Write 正文 |
| 正文 ≥ 300 词 | ≥ 300 | Write 正文 |
| Meta description 120–160 字 | 区间内 | SEO settings |
| SEO title 30–60 字 | 区间内 | SEO settings |
| URL slug 合法 | 无空格 / 无中文 | SEO settings |
| 有 2 个以上小标题 | ≥ 2 | Write 正文 |
| 至少 1 个外链 | ≥ 1 | Write 正文 |
| 图片都有 alt | 0 张缺 | Write 正文 |

`GEO & SEO 分 = 通过项 / 12`。**这是「该做的都做了」的完成度，不是排名预测** —— 页面上也没说它是排名预测。

`Readability & structure` 是另一套算法（平均句长 + 长句占比 + 长词占比 → 0–100，落成 easy / ok / hard），**不改上面那 12 项**。

这两个分也会回填到 Content 列表的 `GEO & SEO score` / `Content gap score` 两列（只对 article 生效），所以**列表和编辑器不会各说一套**。

`Content gap insights` = 拿正文和关键词去对 `knowledge.pillars[].topics`（没写 topics 就用支柱名），算覆盖率并列出没覆盖的主题；**知识库里没支柱时直接显示不可用、不给分**。

`Plagiarism check` **恒为不可用**，卡片上写明没接查重服务 —— 不编一个分数出来。

### Settings

左边三个子页，都是**真存**的（写进 `data/content.json` 的 `item.article`，读回来一模一样）：

- **Article details**：Cover image（`Upload` / `Generate` / `Library`，下方 `1200 × 650` 提示）、Excerpt（`Auto-fill` / `Write with AI`）、Author + `Manage authors`、Category + `Manage categories`、Tags + `Manage tags`、`Due date (internal use)`、Language
- **SEO settings**：搜索结果预览（标题 / URL / 描述实时跟着改）、SEO title、Slug（改标题自动生成，也能手改）、Meta description（带字符计数 `n / 160`）
- **Custom fields**：ICP（下拉取自 Company Knowledge 的目标受众）、KPI（文本）、底部链接 + `Manage custom fields`

`Auto-fill` 是规则生成（取首句 / 拼关键词 / 按词边界截断），`Write with AI` 才走模型；没有可用模型时结果里带 `degraded: 'offline-rules'`，**不假装是模型写的**。

### Audience

左边六个分类（Personal websites / Content hubs / Employee advocacy / Email marketing / Mobile platforms / Social networks），每个带一句说明、一个空状态和一个 `Add …` 按钮。**只有真接了的才可点**：

| 分类 | 状态 |
|---|---|
| Personal websites / Content hubs / Mobile platforms | 没接入，如实标出来 |
| Employee advocacy / Email marketing | 复用已有渠道（协作 / 邮件），显示已绑定与待补数量 |
| Social networks | 可用，并把右侧面板切成 `Socials` |

`Socials` 面板：`Create social post` / `Create with AI`、空状态逐字 `No social posts found for this article.`，下面列出六个平台 —— **只有 X 和 Reddit 有渠道规则**（4 条 / 5 条），LinkedIn / Facebook / Slack / Google Business Profile 标「未支持」并写明原因，**不硬造规则充数**。

每条社媒帖是**独立子资产**（自己的文案 / 图 / CTA / 排期），改了不影响母文章；它们也照样出现在 Content 列表的 Social posts 里。

### Publish

三个选项：立即发布 / 定时发布 / 提交审核。**本地工具不直连任何平台** —— 点完只改状态（`pending` / `scheduled` / `published`），返回里带一句 `note` 说明这件事；定时发布时如果文章还没批准，额外返回 `warning` 提醒。

### 诚实清单（这一屏哪些是真的、哪些是占位）

- ✅ **真**：正文与元信息读写、12 项检查、可读性、内容缺口、自动填充（规则模式）、社媒子资产增删改、状态流转
- ⚠️ `Write with AI` / `Create with AI`：没有可用模型时走离线模板（返回里带 `degraded`）
- ❌ 查重：恒不可用
- ❌ 平台直发、真实排名、平台侧数据回流：都没做
- ❌ **不是 WYSIWYG**：正文是 Markdown 源文 + 预览。因为质检（`lib/rules.js` 和这 12 项）都建立在纯文本上，换文档模型会把已有规则全废掉；要真富文本得先重做规则层，那是另一件事

### 三个入口都落到这一屏

Content 列表点标题 / 行内编辑、Content 的 `Create content → Article`、**Planning 日历点文章条子** —— 都开这个三 Tab 编辑器（其它类型的资产还是老三栏编辑器）。StoryChief 的日历里点一条内容就是打开那条内容，这里照做。

**删掉文章不会连带删它的社媒帖**：StoryChief 里社媒帖是独立的 postset（有自己的 Edit / Report / Duplicate / Delete，「删除前必须先 unpublished」），咱们一样 —— 删文章只删文章和版本，社媒帖留着，各自在 Socials 面板里删。删除确认框会明说这件事。

## Social post composer（先连 Buffer，再从渠道里挑）

Content → `Create content → Social post`（或点列表里 social 类型的行）进这一屏。对标 StoryChief 的 `/content/segments/social-post`：**不给每个平台配 Connect 按钮**，统一先连 Buffer，把 Buffer 里已绑定的渠道拉下来勾选，发布交给 Buffer 执行。

布局按需求方给的规格：底色 `#f7f8fa`、卡片 `#ffffff`、圆角 8px、阴影 `0 1px 3px rgba(0,0,0,.06)`、主色 `#2563eb`、左侧栏固定 280px、卡片最大 640px。字号仍用全站那套 12/13/14/16（换字号整页密度会和其它屏对不上）。

| 位置 | 内容 |
|---|---|
| 顶部 | `Draft` 标签 + `Saved 2 sec ago`（2 秒防抖自动存草稿）+ Chat / Collaborate + Publish + ⋮ 八项菜单 |
| 左侧 280px | `Connected Social Channels` + 搜索 + 渠道行（simple-icons 20px 品牌色，选中行左侧品牌色竖线）+ 底部「去 Buffer 后台加账号」提示 |
| 右侧卡片 | Publish now / Schedule(UTC) 双 Tab、正文 textarea、Emoji / AI、`Customize per channel` 分渠道子面板、Article / Link / Media / PDF 四个附件入口、反馈条 |

左侧栏三种状态：**A 未连接**（空态文案 + Connect Buffer，右侧编辑器整块置灰并压一句 `Connect Buffer to start drafting social posts`）、**B 已连接**（渠道列表可搜索可多选）、**C 授权失效**（黄条 + Reconnect）。

### 两种连接方式，自动降级

Buffer 官方现在**同时支持** OAuth 2.0（+PKCE）和 Personal API Key：

- 配了 `BUFFER_CLIENT_ID`（+ `BUFFER_CLIENT_SECRET`）→ 点 Connect Buffer 弹 OAuth 授权窗，回调 `/api/buffer/callback` 换 token。
- 没配 → 不给你一个死链，而是当场给「粘 API Key」的输入框（`publish.buffer.com/settings/api` 生成，30 秒可用）。

| 环境变量 | 作用 |
|---|---|
| `BUFFER_CLIENT_ID` / `BUFFER_CLIENT_SECRET` | OAuth；不配就走 API Key |
| `BUFFER_API_KEY` | 只给自己用：启动就算已连接 |
| `SCA_PUBLIC_BASE` | OAuth 回调地址 + 媒体公网 URL 的根（有公网域名时设它，否则是本机 127.0.0.1） |
| `SCA_DATA_DIR` | 数据目录（测试用它隔离，别把真凭据搅了） |

### 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/buffer/status` | 当前连接方式（oauth / apikey / none）、是否过期、org、渠道缓存时间 |
| GET | `/api/buffer/auth-url` | OAuth 授权链接；**没配 client_id 时返回 `ok:false, need:client_id`**，不硬编链接 |
| GET | `/api/buffer/callback` | OAuth 回调：换 token 后 302 回 `/?buffer=connected` |
| POST | `/api/buffer/api-key` | 粘 Key；先真调一次 Buffer 验证，验不过不留「已连接」 |
| POST | `/api/buffer/disconnect` | 断开 |
| GET | `/api/buffer/channels` | 渠道列表（5 分钟缓存，`?refresh=1` 强制刷） |
| POST | `/api/buffer/create-post` | `{channelIds, mainContent, channelCustomContent, mediaUrl, scheduleAt}`；**服务端按渠道 fan-out**，逐个返回结果，部分失败返回 207 |
| GET | `/api/buffer/post-status/:postId` | 先给本地记录，再尽力向 Buffer 核一次；核不到返回 `verified:false` |
| POST | `/api/social-post/media` | 附件先落 `data/media/`，返回 URL + `publicUrl`（本机地址会明说 Buffer 抓不到） |
| GET | `/api/draft/social-post` | `?id=` 取一条草稿；不带 id 列最近 50 条 |
| POST | `/api/draft/social-post` | 存草稿（渠道勾选 / 正文 / 分渠道文案 / 素材 / 定时） |
| POST | `/api/draft/social-post/duplicate` | 整套复制成一份新草稿 |
| POST | `/api/social-post/generate` | AI 起草：复用 `lib/llm` 的渠道 prompt，没模型时返回离线模板并带 `degraded` |

### 诚实清单

- ❌ **不直连任何平台**：发布只是把请求交给 Buffer，再由 Buffer 发到各平台；本地工具不做「自己 OAuth 到 Facebook/X」这一步。
- ⚠️ **Buffer 一次只能发一个渠道**（`createPost(input:{channelId})`），多选是服务端循环 N 次；界面上的「N/N」是逐个渠道的真实结果，不是整批乐观值。
- ⚠️ **附件必须是公网 https 直链**。上传到本机后 URL 是 `127.0.0.1`，Buffer 服务器抓不到 → 页面明确警告，不假装能带图。要真带图：把 `SCA_PUBLIC_BASE` 配成公网地址，或先传 R2/S3 再填公网 URL。
- ⚠️ **OAuth 需要你先注册一个 Buffer OAuth client**（`publish.buffer.com/settings/api`）并登记回调地址；没注册就只能走 API Key。
- ⚠️ **`post-status` 的查询形状官方没给示例**：查不到时如实返回 `verified:false` + 原因，不编「已发布」。
- ⚠️ **Google Business Profile 在 simple-icons 里没有条目**（商标原因），用 G 字母徽标 + Google 蓝代替，代码里注明了。
- ⚠️ Chat / Collaborate / Custom fields / Version History / Duplicate to 都**如实说明不支持**，点开只给一句人话，不做假功能。

## Planning：排期日历

月视图（周一开头、今天高亮）、顶部「未排期」栏、点空格子直接加资产（日期自动带上）、点资产跳回编辑。四种资产类型四种颜色，已批准绿边、有硬伤红边。

进 Planning 时会**跟着当前选中资产的排期月份走**；手动翻过月之后不再自动跳。

## 渠道规则（36 条，每条带出处）

| 渠道 | 条数 | 硬规则举例 |
|---|---|---|
| YouTube 脚本 | 5 | 前两行不能是自我介绍；≥600 字符（中文 300 字）；必须有一个 CTA |
| TikTok 短口播 | 5 | 前 15 词必须有钩子；≤900 字符；不许外链 |
| 视频分镜包 | 5 | 至少 5 个镜头；每镜要有「画面：」「提示词：」；总时长 ≤45 秒；末镜是 CTA |
| X 帖子 | 4 | ≤280 字符（链接按 23 计）；首行 ≤60；标签 ≤1 |
| Reddit 软帖 | 5 | 标题无推广词；第一段无链接；≥400 字符；提自家产品必须披露 |
| 冷邮件 | 6 | 不许出现「附件/attach」；不许约通话；只提一个低门槛请求 |
| 落地页首屏 | 5 | 主标题 ≤60；只有一个 CTA；必须有具体证据 |
| 品牌级 | 1 | 禁用词表（设置里可改） |

规则是数据（`lib/channels.js`），加一条 = 写 `{id, text, severity, cite}` + 在 `lib/rules.js` 实现检查函数。

---

## API 一览

```
GET    /api/dashboard              # dashboard 一把抓
GET|POST /api/providers
PATCH|DELETE /api/providers/:id
POST   /api/providers/active       # 切默认
POST   /api/providers/:id/test     # 连通性测试
POST   /api/providers/:id/models   # 从接口拉模型清单

GET|POST /api/knowledge            # 公司知识 / GSC / 工具
POST   /api/knowledge/voice        # 建/改 brand voice（{name, description, useCase, excerpts}）
DELETE /api/knowledge/voice/:id    # 删一条 brand voice
POST   /api/knowledge/audience     # 建/改目标受众（name / description / industries / jobTitles / companySize / goals / painPoints）
DELETE /api/knowledge/audience/:id # 删受众（顺带把它从 pillar 的绑定里解掉）
POST   /api/knowledge/pillar       # 建/改内容支柱（name / description / audienceIds / searchQuestions / topicsInclude / topicsAvoid / coreMessages）
DELETE /api/knowledge/pillar/:id   # 删内容支柱
POST   /api/knowledge/writing-style      # 建/改写作规范（name / notes / 10 个开关 / quoteStyle / headingCase）
DELETE /api/knowledge/writing-style/:id  # 删写作规范
POST   /api/knowledge/visual-style      # 建/改视觉风格（name / guidelines / primaryColor / secondaryColor / referenceIds / logoIds）
DELETE /api/knowledge/visual-style/:id  # 删视觉风格（图片留在图库）
POST   /api/knowledge/image        # 传图 {name, data: 'data:image/png;base64,...'}，上限 4MB
GET    /api/knowledge/images/:id   # 取图（带正确 content-type）
DELETE /api/knowledge/image/:id    # 删图（顺带从各视觉风格里摘掉引用）
POST   /api/knowledge/files        # {name, text}
GET|DELETE /api/knowledge/files/:id
GET    /api/knowledge/files/search?q=   # 按正文/文件名检索，返回命中片段

GET|POST /api/chats
GET|DELETE /api/chats/:id
POST   /api/agent/chat             # {chatId?, text} → 回复 + 执行结果（支持 @技能名）

GET    /api/strategy               # 知识 blocks + GSC 接入状态 + 审计结果 + 技能 + 应用目录 + 最近对话
GET    /api/gsc                    # 接入状态（configured/authorized/site/lastSync；不回明文凭据）
POST   /api/gsc/credentials        # {clientId, clientSecret} —— 校验形状后存本机
GET    /api/gsc/authorize          # → 302 到 accounts.google.com（只读 scope + state）
GET    /api/gsc/callback           # Google 回跳：校验 state → 换 token → 回 /?gsc=ok|err
POST   /api/gsc/site               # {site} 选站点
POST   /api/gsc/sync               # {days} 拉 Search Console → 写进 knowledge.gsc.raw
POST   /api/gsc/disconnect         # 清凭据 + token（已同步的数据保留）
POST   /api/tools                  # {action: install|authorize|disconnect|data|add|uninstall}
DELETE /api/tools/:id              # 删自定义应用
GET|POST /api/audit                # {raw} → 解析 + 排序后的机会清单（存 knowledge.gsc.raw）
GET|POST /api/skills
PATCH|DELETE /api/skills/:id
POST   /api/plugins                # 自定义插件（写 knowledge.tools）
DELETE /api/plugins/:id

GET    /api/state
GET    /api/calendar?from&to
GET|POST /api/settings

GET    /api/content?group&status&q&sort&dir&page&size   # 一页内容 + 各分组计数
GET    /api/content/meta                                 # 类型 / 状态 / 分组 / 16 列
POST   /api/content                                      # 建内容（顺带建 campaign + 资产）
GET|PATCH|DELETE /api/content/:id                        # 读 / 改（写透到资产）/ 删（连资产一起删）
POST   /api/content/:id/duplicate                        # 复制（副本连同版本）
POST   /api/content/:id/status                           # { status } 或 { approval }，批准会落到当前版本

GET    /api/article/meta                                 # 地区 / 语言 / 受众分类 / 社媒平台 / 自定义字段 / 阈值
GET    /api/article/:id                                  # 正文 + 元信息 + 12 项检查 + 缺口 + 可读性 + 社媒列表
PATCH  /api/article/:id                                  # 标题/语言/分类/作者/截止日/状态/标签/关键词 + article:{…}
POST   /api/article/:id/body                             # { body, mode: current|version } —— 改当前版本或存新版本
POST   /api/article/:id/autofill                         # { field, mode: rule|ai, apply, body }
POST   /api/article/:id/generate                         # { target: article|social, channel }
POST   /api/article/:id/socials                          # { channel } 建一条社媒子资产
POST|PATCH|DELETE /api/article/:id/socials/:assetId      # 改 / 删某条社媒帖
POST   /api/article/:id/publish                          # { mode: now|schedule|review, date } —— 只记状态，不直连平台

POST   /api/campaigns
PATCH|DELETE /api/campaigns/:id
POST   /api/campaigns/:id/generate
GET    /api/campaigns/:id/export?format=md|csv
POST   /api/campaigns/:id/assets
PATCH|DELETE /api/campaigns/:id/assets/:aid
POST   /api/campaigns/:id/assets/:aid/generate|versions|approve|winner|current|recheck
GET    /api/campaigns/:id/assets/:aid/diff?a=&b=
```

供应商接口约定（很重要）：`/test` 和 `/models` **永远返回 200 + `ok:true`**，业务结果放在 `test.ok` / `error` 里。这样前端的通用 `api()` 不会把"测试没通过"当成网络错误吞掉一行红字。

---

## 怎么接你现有的流水线

发布仍然交给你现有的脚本/手工，本工具不碰账号。

```js
const db = require('./social-content-automation/data/campaigns.json');
for (const cp of db.campaigns) {
  for (const a of cp.assets) {
    const v = a.versions.find(x => x.v === a.current);
    if (!v || v.status !== 'approved') continue;                 // 人工闸门
    if (a.scheduledAt > new Date().toISOString().slice(0, 10)) continue; // 排期没到
    enqueue({ channel: a.channel, body: v.body, campaignId: cp.id, assetId: a.id });
  }
}
```

---

## 已验证 / 未验证

- ✅ **规则引擎** 30 项、**数据迁移** 13 项、**agent 层** 24 项、**Strategy 层** 72 项、**Content 层** 42 项、**Article 层** 42 项单测全过（共 223 项）
- ✅ **REST 全链路**：provider 增删改测 / 模型拉取 / 知识库 / 文件上传 / 工具数据 / 对话 / 动作执行 / 审计解析 / 技能增删改
- ✅ **界面（v4 布局）**：四张卡同一行、等宽、圆角 16、1px 边框、阴影 blur 2px、间距 16；0 个深色块；字号只用 12/13/14/16/20/26；对比度全部 ≥ 4.5:1；零横向溢出；控制台 0 报错
- ✅ **字体**：本地 Inter 4 个字重全部 loaded，且实测字宽与 Segoe UI 不同（证明真的在用 Inter，不是回退）
- ✅ **布局改动没动数据**：改版前后公司知识仍 100% 完整、GSC 站点、2 campaign / 14 资产一个不少
- ✅ **交互**：编辑器流程 20 项 + Dashboard 157 项 + Strategy 113 项 + Content 列表 46 项 + **文章编辑器 69 项** + **社媒编辑器 65 项**真实点击 + 视觉断言（含列表版式/列配置面板/编辑器三 Tab）
- ✅ **Strategy 与 Dashboard 同数据**：知识表单整页只有 1 份（DOM 借用）；在 Strategy 改字段 → 服务端变 → 回 Dashboard 打开卡片还是同一份；Strategy 发的对话出现在 Dashboard 的 Recent chats
- ❌ **真实 LLM 出稿**：本机连不上公司网关（502/TLS），**没有验证过真模型**。默认离线模板。
- ⚠️ **GSC 真 OAuth**：流程全通（存凭据 → 302 到 accounts.google.com → 回调校验 state → 换 token → 同步），
  单测 + 交互都覆盖了；**但用你的账号真的授权、真的拉到数据这一步没有验过** ——
  本机 `www.googleapis.com` 被网关挡住（`oauth2.googleapis.com` 通），同步会如实报"连不上 Google"。
  粘导出的路永远可用。
- ❌ **工具直连 / MCP**：15 个应用目录项只做到"安装 + 授权（凭据存本机）+ 贴数据"；
  没有逐家 OAuth（要各自的开发者应用与审核，按你的要求不做），也没有真的 MCP server
- ⚠️ **Content 的指标列**：Impressions / Reads 恒为 `—`（没有站内分析）；`GEO & SEO` / `Content gap` 只对 `article` 有真数（与编辑器同一套 `scoresOf`），其它类型仍是 `—` —— 都不编数字
- ❌ **Content 的 Unsplash / Canva**：页面如实写「没接入」，只有 Workspace files 是真的
- ❌ **Report**：还是说明页
- ✅ **文章编辑器（v12）**：三 Tab 全链路真实点击 —— 从列表点进、写正文自动存、填关键词分数上涨、告警 show 跳到对应字段并聚焦、Settings 三个子页字段存得住、Audience 六个分类、社媒帖建/改/删、发布三态、关掉回列表能看到改动；版式在 1280/1440/1680 三档零溢出，字号只在 12/13/14/16/26，对比度全 ≥4.5
- ❌ **文章编辑器的查重 / 真实排名 / 平台直发**：查重恒不可用、GEO & SEO 是本地规则完成度不是排名、发布只改状态（见上面「诚实清单」）
- ❌ **平台直发**：故意没做

细节见 `VERIFY.md`；和 StoryChief 的差距见 `差距分析-StoryChief对照.md`。
