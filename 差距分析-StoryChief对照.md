# 差距分析：我做的 vs StoryChief

> 依据：storychief.io 首页、`/create-collaborate`、`/data-performance`、`/pricing` 的原文（2026-11-11 抓取）。
> 只写页面上有的；没抓到的标 `[未核实]`。

## 进度

- [x] **第 1 步｜界面重做（A 浅色编辑室）** —— 2026-11-11 完成，验收见 `VERIFY.md` 第 3 节
- [x] **第 2 步｜campaign + 资产模型 + 日历** —— 2026-11-11 完成
      · campaign → assets（文章/社交/邮件/视频）→ versions
      · 新增「视频分镜包」渠道（5 条规则），可直接喂 Seedance / HeyGen
      · 月历视图：排期、未排期栏、点格子加资产、点资产回编辑
      · v1 数据自动迁移（13 项单测）
- [x] **第 3 步｜按 StoryChief 分板块，先把 Dashboard 做出来** —— 2026-11-11 完成
      · 五个板块导航：Dashboard / Strategy / Planning / Content / Report（后两个还是说明页）
      · 顶部 banner：多个 provider + 每个的模型清单 + 切换默认 + 连通性测试 + 拉模型
      · Set up your marketing agent：Company knowledge / Search Console / Connect your tools / Knowledge files
      · 对话框 + 快捷指令 + Recent chats（可删）
      · agent 会**真的动手**：create_campaign / write_asset / schedule_asset / update_knowledge，执行结果回显并写回 Content
      · 未接模型时如实降级（写明原因），不假装成功
- [x] **第 3.5 步｜Dashboard 视觉对齐参考图** —— 2026-11-11 完成
      · 一行四列圆角卡（1680 视口下 276px）+ Start setup / Connect / Explore / Upload
      · 卡片右下角进度「N of M complete」（现在是 11 项，见 3.6）、绿色「+2k AI credits」
      · 对话区：placeholder「Ask to analyze your competitors」、`+ / @ / $` 小字提示、8 个快捷指令
      · 右上角「接入模型」改成蓝色主按钮，provider 管理收进弹窗
      · 自托管 Inter（latin 子集）+ 排版网格放宽到 1520
      · 只改布局/视觉/文案：数据、接口、校验逻辑一行没动（验收时核对公司知识仍 100%、14 个资产都在）
- [x] **第 3.6 步｜Strategy 四个板块（同一份数据）** —— 2026-11-12 完成
      · 左栏：New chat / Content audit / Company knowledge / Plugins & skills
      · **不是四套新功能**：对话、知识库、GSC、插件全部读 Dashboard 的那一份存储
        （知识表单是把 Dashboard 的 DOM 搬过去，整页只有 1 份，改哪边都一样）
      · building blocks 统一成 11 项，Dashboard 卡片与 Strategy 清单同一个口径「N of M complete」
      · Content audit：粘 GSC 导出 → 确定性解析 → 按阈值排序的修复清单 → 一键转 campaign
        （阈值：11–20 名=临门一脚、CTR<2%=改标题、21–50 名=内容太浅、>50 名=没内容、支柱没人搜=空着）
      · Skills：`data/skills.json`，4 条内置（竞品缺口 / 月度计划 / GSC 修复 / 长文改六渠道），
        对话里 `@技能名` 就把步骤拼进 system prompt；执行仍走动作协议，不绕过校验
      · 验收：单测 32 项 + 真实点击 46 项 + shot.js 顺带扫版式
- [ ] 第 4 步｜一个出口（approved → 队列文件）
- [~] 第 5 步｜效果回流（Strategy 的审计已接真实 GSC，代码全通、待用真账号跑一次；Report 仍待填实）

**对上表的影响**（本轮变化）：

| 能力 | 上一轮 | 现在 |
|---|---|---|
| Company intelligence / 品牌语料 | ✅ 独立知识库 + 完整度 + 注入 agent 上下文 | ✅ 11 个 building block 分 4 组，**Strategy 里是看板**（清单 + 进度条 + 点一项跳表单），Dashboard 卡片同一口径 |
| AI 起草（从 brief 而非空白 prompt） | 🟡 架构通了，**但真模型没验证过** | 🟡 同上；新增 @技能 = 固定流程，仍走动作协议 |
| 选题 / opportunity 发现 | 🟡 只能对话里聊 | ✅ **Content audit**：真数据 + 确定性排序 + 一键转 campaign |
| 数据回流 / GSC | 🟡 只登记绑定 + 贴数据 | ✅ **真 OAuth 接入**（你自己的 Google Cloud 凭据 → 授权 → 同步 28 天查询）+ 贴导出兜底；本机网关挡住 `www.googleapis.com`，所以"真同步"在这台机器上没跑通 |
| 多工具接入 | 🟡 8 个工具登记 + 贴导出数据 | ✅ **应用目录**：15 个应用（图标 + 一句话 + 安装 → 授权 → 管理/贴数据）+ 自定义应用；逐家真 OAuth 按你的要求不做 |
| 可复用流程 | ❌ | ✅ Skills（增删改 + @调用），内置 4 条

**仍然空着的三大块**：发布出口、效果回流、协作（@评论 / 建议模式 / 分享链接）。

---

## 一、先把 StoryChief 的真实结构摆出来

它不是"多渠道改写工具"，它是**内容营销操作系统**，六块拼成一个环：

| # | 模块 | 页面原文证据 |
|---|---|---|
| 1 | **Strategy / 选题** | "Plan from live data"；`/strategy` = market demand、opportunity found（"AI citation gap in content operations"） |
| 2 | **Briefs / 简报** | `/briefs`；"One working title in. Your editorial brief, focus keyword, and brand voice load automatically"；"Drafts are grounded in the brief's topic, audience, and key points. **Never a blank prompt**" |
| 3 | **Company intelligence** | `/train-ai-on-your-business`；"Company info … Context loaded automatically" |
| 4 | **Create & collaborate** | 评论区 @mentions（转发到 Slack）、**Suggesting mode**（逐条 accept/reject）、**Reviews without accounts**（客户用分享链接批准，不占席位）、**Quality gates**：GEO & SEO 92 / Readability 88 / Content gap 76 / **Plagiarism check** / Word count 1,842 vs 1,800 target |
| 5 | **Publish everywhere** | WordPress、Webflow、LinkedIn、Instagram、Facebook、TikTok、YT Shorts、Mailchimp、Slack +10 |
| 6 | **Data & performance** | **Google Search Console 直连**（impressions/clicks/CTR/position + 关键词分档）、社媒数据回流（IG/LI/FB/Pinterest）、**每篇文章实际赚到多少**（reads、read time、search clicks、附带社媒触达）、**AI visibility**（ChatGPT/Gemini/Copilot 引用） |

还有两个我没单独列但反复出现的：
- **Campaign 级审批**："One review for every campaign asset"、一次 campaign 9 个资产（Article / Social / Email / Video）
- **Version history**："Every save is a version … Browse revisions, see exactly what changed, and **restore any point in time**"

---

## 二、逐条对账（我做的版本）

| StoryChief 能力 | 我的现状 | 差距 | 你（自用）该不该抄 |
|---|---|---|---|
| 选题 / opportunity 发现 | ❌ 无 | 大 | 🟡 可选：你已有 lead 挖掘流水线，选题可以复用 |
| **Brief 作为一等对象**（编辑简报 + focus keyword + 目标字数） | ⚠️ 半个：有字段但没有"简报 → 草稿"的约束关系 | **中** | ✅ **该抄**，成本极低，收益最大 |
| Company intelligence / 品牌语料 | ❌ 无 | 大 | 🟡 轻量版：把 eSheep 的产品事实存成一段固定语料，注入 prompt |
| AI 起草（从 brief 而非空白 prompt） | ⚠️ 模板占位，没接真模型 | 中 | ✅ 该做（等网关通） |
| 逐渠道改写（master → 每渠道） | ✅ 有，且我认为**比它细**（31 条带出处规则） | —— | 这是你唯一的领先项，要保住 |
| @mentions 评论 | ❌ 无 | 中 | ❌ 你自己用，不需要 |
| **Suggesting mode**（建议式修改） | ❌ 无（只有整段新版本） | 中 | 🟡 可以简化成"标注某句有问题" |
| **分享链接给外部审批（不占席位）** | ❌ 无 | 中 | ✅ 便宜好用，值得做 |
| 实时质量分（SEO/GEO + readability） | ⚠️ 有规则分但没有 SEO/GEO 维度 | 中 | 🟡 先做 readability，SEO/GEO 要看你要不要做搜索流量 |
| 查重 | ❌ 无 | 小 | ❌ 你不需要 |
| **版本历史 + 任意时点还原** | ✅ 有版本 + diff + 批准 | 小 | 已够用，补"还原"按钮 |
| **发布到 WordPress / 社媒 / 邮件** | ❌ 完全没做 | **大** | ✅ 该做，但只做 1 个出口（见路线图） |
| 数据回流（GSC / 社媒 / 每篇归因） | ❌ 无 | **大** | ✅ 部分该做：至少"变体谁赢了"要能填真数 |
| AI visibility 追踪（GEO） | ❌ 无 | 大 | ❌ 现阶段不值得 |
| Campaign / 日历（9 个资产一个 campaign） | ❌ 无（只有单条素材 + 6 渠道） | **中** | ✅ 该抄，这是"资产模型"的关键 |
| 客户工作区 / 席位 / 权限 | ❌ 无 | 大 | ❌ 不需要 |

**结论一句话：我做的只覆盖了它的第 4 块的一部分（Create）。**
缺的不是功能数量，是**三样结构性的东西**：

1. **资产模型不对**：StoryChief 是 `campaign → N 个资产（article/social/email/video）→ 每个资产多版本`；
   我是 `一条素材 → 6 个渠道文本`。缺"campaign"和"非文本资产"，所以做不了日历、做不了跨资产审批。
2. **没有出口**：StoryChief 写完能发到 12 个地方；我写完只能复制。**没有出口的内容系统 = 一个更复杂的记事本。**
3. **没有回流**：它知道哪篇赚到了什么；我不知道哪个变体赢了。没有回流，"A/B 变体"就是个字段，不是能力。

---

## 三、界面为什么难看（具体诊断，不是感觉）

现在这版是"IDE 味"的，问题是具体的：

| # | 问题 | 后果 |
|---|---|---|
| 1 | 8 个输入框挤在 3 列小网格里，全是 `<label>字段名+input` | 信息密度高但没有层级，看起来像后台配置页 |
| 2 | 用 emoji（▶♪𝕏👽✉▤）当渠道图标 | 每个系统渲染不一样，显得廉价 |
| 3 | 正文编辑区是等宽字体 + 深色底 | 像代码编辑器，读长文案很累 |
| 4 | 没有留白节奏（padding 统一 12/16px，不区分区块层级） | 平、闷、没有呼吸感 |
| 5 | 颜色只有蓝 + 灰，没有语义色阶 | 状态（草稿/已批准/有硬伤）只能靠小圆点，扫不出来 |
| 6 | 三栏等宽（260 / 1fr / 320），右栏塞了版本 + diff 两个不同性质的东西 | 右栏像杂物抽屉 |
| 7 | 没有空状态设计、没有进度感 | 新建素材后不知道下一步做什么 |
| 8 | 字号只用了 11.5 / 12.5 / 13 / 14 四种，且都偏小 | 标题不够重，正文不够大 |

**两个可选方向**（差别很大，需要你选）：

- **A｜浅色编辑室（学 StoryChief / Notion）**：白底 + 浅灰分区 + 卡片 + 柔和阴影，正文 16px 无衬线，渠道做成卡片带状态徽章，右栏改成「版本时间线」纵向流。适合长时间读写，截图给客户看也体面。
- **B｜深色工作台（学 Linear / Vercel）**：保留深色但大幅提升对比和层级，紧凑排版，键盘优先，状态用色阶，适合你自己高强度用。

---

## 四、四步路线图（每步都能单独验收）

### 第 1 步｜界面重做（1 次交付）
- 重写 `index.html` + `styles.css`，按 A 或 B 方向
- 信息架构改成：`左：campaign/素材` → `中：资产编辑` → `右：版本时间线 + 校验摘要`
- 验收：三栏信息层级清楚、状态一眼可扫、正文可读（≥16px）、空状态有引导、无横向溢出

### 第 2 步｜资产模型对齐（campaign → assets）
- 新增 campaign 层：一个 campaign = 1 个核心卖点 + N 个渠道资产
- 资产类型扩到：文章 / 社交 / 邮件 / **视频脚本（分镜包）**
- 新增**内容日历**视图：按日期排资产（StoryChief 的 calendar 那半）
- 验收：能建 campaign、能加资产、能在日历上看到排期

### 第 3 步｜一个出口（不要 12 个）
- 只做一个：**导出成你现有流水线能吃的队列文件**（`approved` 版本 → JSON），或 WordPress 草稿
- 验收：从"批准"到"进队列"一键，且只有 approved 的能出去

### 第 4 步｜回流（把 A/B 变成真数据）
- 定义指标字段：每渠道资产 `impressions / clicks / replies / conversions`
- 支持手工贴回 + 一个 CSV 导入
- 赢家自动推荐（按你定义的公式），并写回版本
- 验收：能看到"同一卖点下，哪个渠道的哪个变体赢了"

> 顺序建议：**1 → 2 → 3 → 4**。因为界面不改，后面加日历/图表会更乱；资产模型不对齐，出口和回流都没地方挂。

---

## 五、我不建议抄的部分（省成本）

- 席位 / 权限 / 客户工作区：你是自己用
- 查重：对你不构成风险
- AI visibility（GEO 追踪）：好玩但不解决你当前的瓶颈，且要持续烧 API
- 12 个发布集成：维护成本极高，且最容易出事（账号/IP）

---

## 六、需要你拍板的两件事

1. **界面方向**：A 浅色编辑室 / B 深色工作台
2. **先做哪一步**：界面（第 1 步）还是资产模型（第 2 步）
   —— 我的建议是 **先 1 后 2**，但如果你想尽快看到"日历 + campaign"，可以先 2 再 1（会返工一次样式）。

