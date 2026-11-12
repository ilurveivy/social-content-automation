# 验证记录 · Social Content Automation

验证时间：2026-11-11　环境：Windows / Node 24 / 本机 Chrome（headless）

四轮迭代：
- v2 campaign + 资产模型 + 日历
- v3 五个板块 + Dashboard（接入 AI / 营销智能体 / 对话）
- v4 Dashboard 按 StoryChief 的 agent 首页重排布局、换字体、改文案
- v5~v11 Strategy 知识库 8 tab / GSC 接入 / 应用目录 / Content 列表
- **v12 本轮：文章编辑器（Write / Settings / Audience + 右侧 GEO & SEO 面板）**

---

## 1. 单元测试（284 项）

```
npm test
```

| 套件 | 项数 | 覆盖 |
|---|---|---|
| `tests/rules.test.js` | **30** | 7 个渠道 35 条规则 + 品牌禁用词 + 中文阈值折算 + 纯函数一致性 + 渠道→资产类型映射 |
| `tests/migrate.test.js` | **13** | v1 briefs → v2 campaigns：id 前缀、类型推导、版本/current 保留、空渠道不产生资产、坏数据自愈 |
| `tests/strategy.test.js` | **72** | GSC 表解析（制表符/CSV/带引号的 1,900/中文表头/无表头/垃圾输入）、机会阈值边界（10/11-20/21-50/>50/未上榜）、优先级排序、内容支柱缺口、技能增删改与 @匹配与 12 步上限、building blocks 口径、应用目录（15 项字段齐全 / 安装≠授权 / keyHint 掩码 / 卸载内置只是复位 / 自定义增删）、GSC 接入（凭据形状校验 / 授权 URL 的 state+offline+只读 scope / 没凭据就报错 / rowsToTsv 能被 parseGsc 吃回 / 断开连凭据一起清） |
| `tests/agent.test.js` | **24** | 动作解析（代码块/裸 JSON/脏输入/上限 6 个/未知类型丢弃）、上下文拼装、离线模板、动作执行校验 |
| `tests/article.test.js` | **47** | slug 生成（英文 / 引号 / 中文退回 `article-<id尾>` / 超长截断）、词数（拉丁按空格 / 中文按字 / Markdown 记号不算）、plain 剥壳、可读性（短句高分 / 长句长词扣分 / 空正文不炸）、阅读时长下限、**12 项硬检查逐项能过能挂**（空文章只有 language 能过；关键词过长挂 keywordLength 但不挂 keyword；meta 120/160、SEO 标题 30/60、字数 300 的边界；slug 空格与中文；图片 alt）、`report` 分数＝通过项/12 且告警数对得上、**查重恒 `available:false`**、内容缺口（无支柱不可用 / 覆盖率与 missing / 0%）、自动填充五类字段 + `mode=ai` 标 `degraded` + 未知字段被拒、`trimTo` 按词边界、meta 默认值与非法值回退、白名单不放进脏字段、**回归：`content.normalize()` 不许吞掉 `item.article`**、受众 6 分类与「只有 X / Reddit 真支持」、**列表分数口径 `scoresOf`**（与 `report()` 一致 / 空文章不为 0 / 没支柱时 gap 为 null / 恒在 0–100） |
| `tests/content.test.js` | **42** | 9 个类型 / 4 个状态 / 5 个分组 / 16 列的文案与顺序；建条目校验（类型、标题、owner、指标留空不写 0）；分组·状态·搜索·排序·分页边界（1-0 of 0、越界页收敛）；改字段白名单（状态/审核/标签上限/指标空串→null）；复制解绑；状态推导七种情形（未生成/有草稿/已批准+未来/已批准+没排期/已批准+过去/提交审核/手动优先）；campaign 同步幂等、渠道映射、资产被删只解绑不删；分组计数 |
| `tests/social-post.test.js` | **56** | Buffer 适配层：拼 `createPost` 入参（`shareNow` / `customScheduled` / `assets.image` / `assets.document`）、发布前校验（没渠道 / 空文案 / 时间非法 / 附件不是 https）、`friendlyError` 翻译、未连接时 `mode=none` 且给原因、`auth-url` 缺 client_id 不造假链接、API Key 连接 → 拉渠道（走缓存）→ **按渠道 fan-out 发布** → 分渠道文案生效 → **部分失败如实报** → `post-status` 查不到时 `verified:false` |

agent 层的重点断言（这一层最容易"看起来在工作"）：

| 断言 | 为什么重要 |
|---|---|
| 不是 JSON 就返回 `[]`，不抛错 | 模型随口一段话不能把聊天搞崩 |
| 未知动作类型被丢弃、最多执行 6 个 | 模型不能发明动作，也不能一次刷 20 个 |
| `write_asset` 正文为空格 → 拒 | 否则会存一堆空资产 |
| 渠道名 `myspace` → 拒 | 资产类型/规则都按渠道来，脏渠道会一路错下去 |
| `campaignId` 编造 → 退回到最近一个 campaign | 模型经常复述错 id，不能因此丢内容 |
| `scheduledAt` 只收 `YYYY-MM-DD` | 日期列是日历和"排期到没到"的唯一依据 |
| 未绑定 GSC 时上下文里必须出现"未绑定 / 待数据验证" | 防止模型凭空虚造"搜索数据显示…" |
| 未接入的工具数据**不得**出现在上下文里 | 同理，避免把没接的东西当成事实 |

---

## 2. 界面验收（v4 布局 + v5 Strategy）

```
node scripts/shot.js
```

### Dashboard 实测

```
四张卡      4 块，同一行、等宽 248、高 222、间距 16、圆角 16、阴影 blur 2px
卡片标题    Company knowledge / Google Search Console / Connect your tools / Knowledge files
卡片文案    与参考图逐字一致（断言 /Your business, audience, competitors/ 等四条）
按钮        Start setup（100% 时为 Review）/ Connect / Explore / Upload
卡片右下角  7 of 10 complete · +2k AI credits · N available · N files
快捷指令    8 个，文案顺序完全对齐：Get started … Explore more
输入框      placeholder = "Ask to analyze your competitors"
tip         "Tip: use + to add files and context, @ for plugins, or $ for skills"
右上角      离线模式 · 导出 MD · CSV · 接入模型(蓝) · ⚙
字号        12 / 13 / 14 / 16 / 26（只有这 5 档）
对比度      卡片标题 18.11:1 · 卡片说明 5.78:1 · 进度 5.78:1 · 积分标签 5.4:1
            完成度 5.6:1 · 导航 6.03:1 · 快捷指令 9.51:1 · tip 5.78:1 · 主按钮 4.5:1
视觉体检    最深的大面积背景亮度 0.95（绿标签）→ 0 个深色块
            卡片/对话区/右侧栏：边框 1px、圆角 16–18、阴影 blur ≤ 2px
字体        本地 Inter 4 个字重 loaded；实测字宽 188.28 ≠ Segoe UI 185.82 → 真的生效
横向溢出    0
```

截图：`_shots/dash.png`（首页）、`_shots/dash-setup.png`（点开的 Company knowledge 详情）、`_shots/dash-provider.png`（接入模型弹窗）

### 其余板块（回归，均未受布局改动影响）

```
Content：2 campaign / 4 分组 / 7 资产卡 / 6 条规则 / 编辑 16px 非等宽 / 文档标题 26px
         三栏 288 + 自适应 + 344
Planning：42 格 / 7 列星期 / 4 个图例 / 翻月生效
Report：8 张指标卡
控制台错误：0
```

### Strategy 版式（同一个 shot.js 顺带扫）

```
左栏       236px，四个板块：New chat / Content audit / Company knowledge / Plugins & skills
主区       1444px，内容最大 1040px；面板默认只展开一个
chip       10 个（6 个策略预设 + 4 个 @技能）
字号       12 / 13 / 14 / 16 / 20（知识库那块用满这几档）
深色块     最深背景亮度 0.89 → 0 个
卡片       圆角 ≥12、边框 1px
知识库     8 个 tab、默认 Overview；面板借到这里后铺满 998px；整页只有 1 份 #knName
            Setup 清单 10 行两列（行宽 470），打勾数 === 右上角 N/10；进度条 = done/10
            Brand voices 有卡片；点清单一项会跳到对应 tab 并聚焦字段
插件/技能  8 个插件铺满 1038px；4 个内置技能
横向溢出   0
```

截图：`_shots/strategy-chat.png`、`strategy-audit.png`（导入 6 行 GSC 后的机会清单）、`strategy-knowledge.png`（Overview 清单）、`dash-setup-general.png`（General 六个块）、`strategy-plugins.png`

### 判据（任何一条不满足就退出码 1）

- 四张卡必须**同一行、等宽（差 ≤1px）、间距 12–24、圆角 ≥12、有阴影**
- 卡片文案**不得被截断**（scrollHeight vs clientHeight）
- 除主按钮外，任何面积 >2400px² 的元素背景亮度必须 >0.5（禁止深色块）
- 卡片/对话区/右侧栏：边框 ≤1.5px、圆角 ≥12、阴影 blur ≤24px
- 正文字体必须 Inter 打头且 4 个字重 loaded，且字宽与 Segoe UI 不同
- 字号只允许 12/13/14/16/20/26；对比度 ≥4.5:1；零横向溢出；控制台 0 报错

---

## 3. 交互验收

```
node scripts/ui-dash.js       # Dashboard 157 项（含 8 个 tab / 两列清单 / 受众、支柱、写作规范、视觉风格四套弹窗 + 知识文件页）
node scripts/ui-flow.js       # 编辑器 20 项（列表点一行进去之后：加资产 / 生成 / 存版本 / 批准 / 排期 / 日历跳回）
node scripts/ui-strategy.js   # Strategy 113 项（含知识库 tab / 清单跳转 / 五个弹窗）
node scripts/ui-content.js    # Content 列表 43 项（导航树 / 16 列 / 排序 / 多选 / 列配置 / 搜索 / 筛选 / 空状态 / 建内容进编辑器 / 行内删除 / Media）
```

Dashboard 的 157 项（v4 布局 + v6 应用目录/GSC 接入 + v7 知识库 tab + v8 受众/支柱 + v9 写作规范 + v10 视觉风格/知识文件）：

| 步骤 | 结果 |
|---|---|
| 默认进 Dashboard、五板块顺序 | ok |
| 四块配置一行四列 + 进度文案 + 积分标签 | ok |
| 8 个快捷指令、placeholder、tip 逐字 | ok |
| 右上角三个按钮都在 | ok |
| **点卡片展开详情**、Overview 打开（8 个 tab / 三张卡 / Fresh start / 10 项清单两列） | ok |
| General 表单可见（Website / 公司名 / Description / Competitors / Custom instructions） | ok |
| 公司知识保存 → **70%**（Visual style / GSC / Knowledge files 还空着，如实显示）、卡片进度同步成 `7 of 10 complete`、缺项列表点名 | ok |
| **详情能回退到四卡** | ok |
| 知识文件上传（`sca-pricing.md`） | ok |
| 应用目录 15 个 → **安装**后原地变「授权」→ 弹窗填账号/令牌 → 显示「已授权 · ads@esheep.ai」+ 底部计数 1 个已授权 | ok |
| 管理 → 贴数据 → 「已贴 27 字」 | ok |
| GSC 面板：未接入时只给「连接你的 Google 账号」，不显示授权/同步；说明里写明要自己的 Google 凭据 | ok |
| `/api/gsc/authorize` 在没配凭据时被挡回引导（302，不会白屏） | ok |
| 接入模型弹窗打开 / 关闭 | ok |
| 模型清单写进 textarea → 下拉同步 | ok |
| 只显示 key 后四位、自动成为默认 | ok |
| 连通性测试（地址换死端口）→ 如实标「不通」+ 原因 | ok |
| 对话一问一答 + **降级原因** + 动作回显 + 写回内容库（2→3） | ok |
| 快捷指令点一下直接发问 | ok |
| 切 Planning / Content / Report 无溢出 | ok |
| 删除对话 1 → 0 | ok |
| 控制台错误 | 0 |

### Content 列表（v11）46 项

| 步骤 | 结果 |
|---|---|
| 左树 5 个分组，每组 6 个子项（Media 3 个），默认选中 All content 且带计数 | ok |
| 表格 16 列表头逐字对齐；有数据；首列勾选框；每行 4 个行内动作；底部分页区间 | ok |
| 全选 → 全部勾上 + 出现批量条（Approve / Request approval / Delete）→ 取消全选后消失 | ok |
| 点 Title 表头 → 升序箭头 ↑；再点 → 降序 ↓ 且首行变了 | ok |
| Columns 面板 16 个开关；取消 Impressions → 表头剩 15；勾回来 → 16 | ok |
| 侧栏切 All social posts → 10 行；再点 Published → 空状态 | ok |
| 空状态文案逐字（`You don't have any content that meets the selected criteria.`）+ 按钮变 `Create social post` + 分页 `1-0 of 0` | ok |
| Quick search 输 `cold` → 只剩 Cold email，并变成一个可取消的 chip；清空 → 恢复全部 | ok |
| Add filter 6 个条件 → 选 Drafts → 出现 Drafts chip → 点 ✕ 取消 | ok |
| Create content 菜单 9 个类型 → 建 Article → **直接进 v12 文章编辑器**（覆盖整屏、`#arTitleBtn` = Untitled Article、三个 Tab 齐全、有正文区）→ 点 `×` 回列表，新行状态 Draft | ok |
| 行内删除 → 自定义确认框（点名标题）→ 确认后少一行、条目真的没了 | ok |
| Media → Workspace files 是独立面板；Unsplash / Canva 如实说「还没接入」 | ok |
| 分组可折叠（▸）并再展开 | ok |
| 控制台 0 错误 | 0 |

版式断言（`scripts/shot.js` 顺带扫，两档宽度 1280 / 1440 都跑过）：

| 判据 | 结果 |
|---|---|
| 左树 236px、与主区顶部对齐、分隔线 ≤1px | ok |
| 工具条 60px、分页条 52px、行高 43px | ok |
| 字号只用 12/13/14（标题 13、表头 12、导航 13、左树标题 14） | ok |
| 状态胶囊圆角 ≥6、高 18–26；搜索框 32px r8；工具条按钮 34px | ok |
| 页面横向/纵向零溢出（表格内部自己横向滚） | ok |
| 列配置面板 16 个开关、圆角 ≥8 | ok |
| 对比度全部 ≥4.5:1；控制台 0 报错 | ok |

### 文章编辑器（v12）73 项

`node scripts/ui-article.js` —— 从 Content 列表真建一篇、真点进去、真敲字，全程 `page.on('dialog')` 接管原生弹窗，最后把测试造的数据全删回去。

| 步骤 | 结果 |
|---|---|
| 顶部：60px 栏、三个 Tab 文案与顺序、默认 Write、标题显示、\`Draft\` 胶囊、三个指标标签、右上 Chat/评论/Collaborate/Publish/⋯/× 齐 | ok |
| Write：大标题占位、提示语逐字、两个起始项、9 个工具条按钮、字数从 `0 words · 1 min read` 起 | ok |
| 右栏：标题 `Optimize for GEO & SEO`、Focus keyword 输入框、地区+语言两个选择器、五张卡片（含 Plagiarism check）、11 条告警且每条都有 `show` | ok |
| 写 559 词正文 → 停手 900ms 自动存、「已保存」出现、SEO 分从 0 涨到 33% | ok |
| 填关键词 → 分数 33% → 67%、关键字告警消失、顶部指标同步刷新 | ok |
| 点 `show`(metaDescription) → 切到 Settings + `SEO settings` 子页 + 目标字段拿到焦点 | ok |
| Settings 三个子页；搜索结果预览卡片；SEO 标题 / Slug / Meta（`n / 160` 计数）齐全 | ok |
| `Auto-fill` meta → 159 字且告警消失；`Auto-fill` SEO 标题 → 38 字（区间内） | ok |
| Custom fields：ICP 下拉来自知识库受众（出海 SaaS 创始人 / 增长负责人）、KPI 写进去存得住 | ok |
| Article details：封面三按钮、摘要/作者/分类/标签/截止日/语言齐全、摘要写进去存得住 | ok |
| Audience：六个分类文案逐字、默认 Personal websites、右侧标题跟着变、空状态 + `Add your websites` | ok |
| 未接入分类如实说（Content hubs → 「这个分类还没接入。」） | ok |
| Social networks → 右栏变 `Socials`、空状态逐字、两个按钮、六个平台、4 个标未支持 | ok |
| `Create social post` 建一条并直接进编辑态 → 写完保存 → 列表里出现独立子资产 | ok |
| `Create with AI` 再生成一条（2 条），点一次只建一条（监听没叠） | ok |
| Publish 菜单三项（立即 / 定时 / 审核）→ 提交审核后状态 `pending` + 胶囊 `Pending approval` | ok |
| `×` 关掉 → 回列表、17 行、新建的文章在列表里看得到 | ok |
| 回列表：article 行的 GEO & SEO score === 编辑器里的 83%（不是 —）、Content gap 也是百分比；社媒行两列仍是 — | ok |
| Planning 日历里点一条文章类条子 → 打开的是三 Tab 编辑器（老编辑器保持隐藏）、标题就是那一条、× 关掉后落在内容列表 | ok |
| 收尾：测试造的内容全删、条数回基线 14/14、控制台 0 报错 | ok |

版式断言（`scripts/shot.js` 的 Article 段，1280 / 1440 / 1680 都跑过）：

| 判据 | 结果 |
|---|---|
| 编辑头 56–68px；右栏 300–380px；主区与右栏不重叠 | ok |
| 五张卡片、≥3 个环形进度、≥5 条告警；卡片圆角 ≥12、边框 ≤1px | ok |
| 输入框 30–38px、圆角 ≥8；标题 ≥24px；正文 16px 且行高比 ≥1.6 | ok |
| 字号只在 12/13/14/16/26；无深色大块；三档宽度横向零溢出 | ok |
| Settings：三个子页、≥5 个字段、封面三按钮、预览卡片 ≥300px | ok |
| Audience：六个分类、左列 180–260px；Socials 面板标题与按钮数对 | ok |

Strategy 的 113 项（v5 结构 + v6 接入流程 + v7 知识库 tab + v8 受众/支柱 + v9 写作规范 + v10 视觉风格，全部真实点击 / 输入）：

| 分组 | 检查 |
|---|---|
| 结构 | 左栏 236px、四个板块名称逐字、四个面板只展开一个、无横向溢出、字号只用 12/13/14/16/20/26、对比度全 ≥ 4.5:1、边框 ≤ 1px、圆角 ≥ 12、0 个深色块 |
| Company knowledge · 结构 | 8 个 tab 顺序与文案逐字对、默认 Overview、标题与三张说明卡逐字对、`Complete with AI` 在、清单 10 项两列（左列 5 项顺序对）|
| Company knowledge · 清单 | 打勾数 === `N/10`；**点一项 → 跳到对应 tab 并聚焦那个字段**（点 Competitor websites → General + `#knCompetitors` 聚焦）|
| Company knowledge · General | 公司名/官网回填、一句话定位+产品进了 Company description、竞品进了 Competitors、卖点+证据进了 Custom instructions、Languages 初始 `No languages`、GSC 有 Connect 按钮 |
| Company knowledge · Languages | `Add language` 写进同一份存储（`["English"]`）→ 能删回 `No languages` |
| Company knowledge · Brand voices | 原有语气是一条卡片 → `Add brand voice` 打开 `Create Brand Voice`（Name/Description/Use case/Excerpts，底部 Cancel+Create）→ Create 后列表 2 条且服务端存下 useCase/excerpts → 名字空着被拦住（不关弹窗）→ 删除回 1 条 |
| Company knowledge · Target audiences（v8） | 列表视图 + `Add target audience`，**没有自由文本大框**；弹窗 `Create Target Audience`：深蓝 header、body 独立滚动、分组 `Audience profile` / `Needs and concerns`、7 个字段齐全、Company size 可选可输、底部 Cancel/Create；多行条目能加能删（2→1）；名字/说明必填都被拦住；存下来的是**结构化字段**（industries / jobTitles / companySize / goals / painPoints），卡片上能看到画像 |
| Company knowledge · Visual style（v10） | 列表 + `Add visual style`，**没有自由文本框**；弹窗 `Create Visual Style`：深蓝 header、body 独立滚动、Name（示例 `Ex. Social visuals`）、Guidelines（说明 + 示例占位）、**Color system**（Primary / Secondary 两个色值框 + 取色器，占位 `#000000`）、**Style references** 与 **Logos** 各带 `Upload` / `Library` 两个入口、底部 `4 of 4 left` 计数、四格虚线位置；名字必填被拦住；上传真图能显示缩略图、计数变 `3 of 4 left`；Library 能选已上传的图；存下来的是名字 / 文本 / 色值 / 图片 id（不是一段文字），卡片上显示名字、Guidelines、色块、参考图与 Logo 缩略；编辑能原样回填，移除缩略图后计数回到 4；删条目图片留在图库；`brief.visualStyle` 里带名字 / 配色 / 图数（进图像生成上下文）；进度 70% → 80% → 70% |
| Company knowledge · Knowledge files（v10） | 独立文件页：右上 `Upload files`、三栏说明卡（`Your unfair advantage` / `Private to this workspace` / `Found when it matters`，文案逐字对）、检索框、空白状态 `No knowledge files yet` + 说明段落；上传后出文件行（名字 / 字数 / 日期 / 查看 / 删除）、文件数变 `1 file`；**按正文检索**返回命中片段并切到结果视图；点查看能看到原文；删除后回到空状态、文件数归零；进度 70% → 80% → 70%；「可引用的事实」已挪到 General，文件页不再混着结构化配置 |
| Company knowledge · Writing style（v9） | 列表 + `Add writing style`，**没有自由文本大框**；弹窗 `Create Writing Style`：深蓝 header、body 独立滚动、四组 `Writing style` / `Punctuation` / `Symbols and special characters` / `Titles and headings`、**10 个开关 + 2 个下拉**（Quote style 三选 / Heading case 四选）、每条规则都带说明小字、Name 的示例是 `Ex. Blog articles`、底部 Cancel/Create；新建时开关默认全关；名字必填被拦住；存下来的是布尔值 + 枚举（不是一段文字），卡片上列出开着的规则；点编辑能原样回填；关掉再开关能存下来；`brief.writingStyle` 里能看到这套规则（进 LLM 上下文）；删除后服务端确实没了 |
| Company knowledge · Content pillars（v8） | 列表 + `Add content pillar`；老的 3 条支柱已合并成 1 条，三个主题都在 Topics to include 里；弹窗 `Create Content Pillar`：分组 `Strategy` / `Content guidance`、Target audiences 下拉能绑定刚建的受众、Search questions / Topics to include / Topics to avoid / Core messages 各成一行并带说明小字、四个 Add 按钮文案对；存下来含 `audienceIds`，卡片上能看到绑定的受众名；删除后服务端确实没了 |
| 同一份数据 | Dashboard 卡片进度 === `/api/strategy` 的 `blocks`；整页 `#knName` 只有 1 个（DOM 借用）；在 Strategy 改 Writing style → 服务端变 → 回 Dashboard 打开卡片**连当前 tab 都还在**；在 Strategy 改字段 → 服务端变 → 回 Dashboard 打开卡片还是同一份；Strategy 发的对话出现在 Dashboard 的 Recent chats；Dashboard 的 GSC 卡能跳到 Content audit |
| New chat | 10 个 chip（6 预设 + 4 技能）；发一条 → 两条消息、回复 228 字；来源标「离线模板」；消息真的写进 `/api/chats`；`@技能` 调用后回复上标 `@技能名`；「＋ 新建」开空对话 |
| Content audit · GSC 三态 | 未接入 → 只有「开始接入」，授权/同步都藏着；点开 → 分步引导里的回调地址 === `http://127.0.0.1:4319/api/gsc/callback`；存凭据 → 变成「凭据已存 · 未授权」并出现「用 Google 授权」；**该入口 302 到真的 accounts.google.com，scope 含 `webmasters.readonly`**；断开 → 凭据一起清空（configured/authorized 都 false）|
| Content audit · 解析 | 无数据 → 空状态且不编机会；粘 4 行 GSC → 7 个机会（4 + 3 条支柱缺口）、优先级降序、角标同步、统计 4/7/1.6%/26.5；「转成 campaign」真的建库、跳到 Content，且新 campaign 在左栏可见并已选中；垃圾输入 → 只给解析提示；「清空」连 raw 一起清 |
| Plugins & skills | 应用目录 15 个、每个都有内联 SVG 图标、未安装的都有「安装」；安装 → 授权 → 填账号/令牌 → 卡片显示「已授权 team@esheep.ai」+ 底部计数 1 个已授权；**明文令牌不出现在 DOM 里**；管理 → 贴数据 → 「已贴」；卸载 → 回「安装」；自定义应用带「自定义」标记、加完还要授权、未授权也能移除 |
| Skills | 新建技能 → 5 个标「自定义」；编辑回填 + 改成 3 步；「运行」切到对话并插入 `@UI 测试技能`；删除回 4 个 |
| 收尾 | 控制台 0 报错；本次造的 chat / campaign / 插件 / 技能 / 字段全部还原 |

---

### 社交编辑器（v13）65 项

跑法：`npm run verify:socialpost`。它会起一个 **Buffer 替身**（`tests/stub-buffer.js`，只实现本项目用到的 4 条 GraphQL）+ 一个**临时 app 服务**（临时 `SCA_DATA_DIR` + 独立端口），跑完就删，绝不碰 4319 上的真 data/ 和真凭据。

| 断言 | 结果 |
|---|---|
| Content → `Create content → Social post` → 落到铺满整屏的 composer（`position:fixed`）、标签 `Draft`、左侧 280px、卡片 640px | ok |
| 三层卡片：顶部操作栏 / 左侧渠道 / 右侧编辑器，**统一圆角 8px、统一阴影 `0 1px 3px rgba(0,0,0,.06)`、都是白底** | ok |
| 顶部卡片与下方左右卡片**左右对齐**（同一条 940px 列）、两张卡片之间留 20px | ok |
| 右侧卡片**撑满内容区高度**（900 高视口下 800px、底部只剩 16px 留白）、左侧卡片**贴合内容**（194px，不拉成空卡） | ok |
| 状态 A：**提示只说一遍**（那两句重复文案已删）、不拿假渠道填列表、不显示搜索框、Publish 置灰 | ok |
| 锁态提示在**卡片内部**、浅灰行内条（`#f3f4f6`），**外部那块悬浮黑色 tooltip 已不存在** | ok |
| Tab 选中态实心主蓝 `#2563eb` + 白字，未选中浅灰 `#f3f4f6` | ok |
| 没配 `BUFFER_CLIENT_ID` 时点 Connect → 自动降级成「粘 API Key」输入框，并说明为什么 OAuth 用不了 | ok |
| 粘 Key 后渲染 Buffer 的 4 个渠道，顺序按规格（Facebook → X → Instagram → LinkedIn）、图标 20px 品牌原色、出现 Search channels、锁态解除 | ok |
| 连上后收起 `Connect` 按钮，刷新/断开收成底部两个小链接；卡片内那行轻提示消失 | ok |
| 搜索 `linked` → 只剩 1 行 | ok |
| 勾 2 个渠道：选中行出现品牌色竖线；**文案还空着时 Publish 仍然不可点**（title 说明原因） | ok |
| 打字 → Publish 变可点 → 2 秒防抖后草稿里真的有渠道 + 正文，顶部 `Saved …` | ok |
| 打开 `Customize per channel` → 每个渠道一个子面板，专属文案也进草稿 | ok |
| Schedule 页签：UTC 提示、自动填未来时间、主按钮变 `Schedule`、时间按 UTC 存成 ISO | ok |
| 发布 → 绿色反馈条；替身收到 **2 次 createPost**（一次一个渠道）、`mode=customScheduled`、`dueAt` 正确、分渠道文案生效 | ok |
| 让替身对 1 个渠道报权限错 → 红色反馈条 + 中文可读原因（不整批算成功） | ok |
| 上传 PNG → 缩略图 + **本机地址「Buffer 抓不到」警告** + 素材 URL 落进草稿且自己能取到（200） | ok |
| ⋮ 菜单 8 项且顺序与规格一致；Duplicate 真复制出第二份草稿 | ok |
| 断开 Buffer → 回到状态 A（不残留假渠道、也不重复提示）、Connect 按钮回原位、编辑器重新锁上、Publish 又变灰 | ok |
| Delete 删掉当前草稿（剩 Duplicate 那份）；控制台 0 报错 | ok |
## 4. 种子数据

`node scripts/seed.js` → 2 campaign × 7 资产 = **14/14 资产规则分 100%**（含视频分镜包）。

---

## 5a. 上一轮（v4 · Dashboard）抓到 / 避开的问题

1. **`document.fonts.check('13px Inter')` 恒为 true**，不能用来判断字体是否存在 —— 它对任何 family 都返回可渲染。
   可靠办法：`canvas.measureText` 比字宽（Inter 188.28 vs Segoe UI 185.82），再加上 `[...document.fonts]` 的 status。
2. **Inter 本机没装**。方案：把 latin 子集 4 个 woff2 下到 `public/fonts/`，用 `@font-face` 自托管 ——
   离线可用、不依赖 Google Fonts、中文自动回退系统字体。顺手给 `server.js` 的 MIME 加 `.woff2`，否则字体被当 `octet-stream`。
3. **字符集陷阱**：PowerShell 5.1 里 `Get-Content`/`Set-Content` 默认 ANSI，写中文会变乱码。
   改文件一律 `[System.IO.File]::WriteAllText(...UTF8Encoding($false))`，验证用 `read` 工具而不是 `Get-Content`。
4. **卡片文案被 clamp 截断**（第 4 张卡 "…can't find online." 被切）。加断言：`scrollHeight > clientHeight + 1` 即失败。
5. **“深色块”要按面积判**：第一次扫描把 6×6 的状态小圆点（绿色）判成深色块 → 误报。
   改成只看面积 >2400px² 的元素。
6. **首屏 1240px 太窄**：1680 视口下四张卡只有 203px、"Google Search Console" 折成两行。
   放宽到 1400px + 右侧栏 272px → 248px/卡，文案不再挤。
7. 布局大改必然踩测试：Dash 测试里点 `#btnAddProvider` 前必须先开 `#btnProviders` 弹窗；
   表单挪进详情面板后，交互前要先点卡片。**改结构时同步改测试，否则测试绿着但界面是坏的。**

---

## 5b. 本轮（v5 · Strategy）抓到 / 避开的问题

1. **`write` 报告成功但文件不在盘上**：`public/views/chat-ui.js` 写完后目录里没有它，页面只报一行 `404`。
   `dashboard.js` 因为「没有 chatId 就提前 return」把崩溃藏住了 —— **改动新文件后必须 `GET` 一次确认真的能取到**，
   不能只看写文件工具的返回值。
2. **借 DOM 时忘了 `hidden` 类**：知识表单搬到 Strategy 后宽度是 **0**（Dashboard 的 `openPanel` 给它留着 `hidden`）。
   现在搬运完显式 `classList.remove('hidden')`，并断言宽度 > 200。
3. **"同一份数据"必须用 DOM 借用，不能复制**：复制一份 HTML 会让 `#knName` 出现两次（id 重复 + 两边填的不一样）。
   验收脚本现在断言「整页只有 1 个 `#knName`」。
4. **CSV 的 `"1,900"` 被逗号切开**：展示数变成 1，整张表的机会排序全错。
   加了尊重引号的 `splitLine`，并在单测里钉住。
5. **两个字母的支柱词会假命中**：`AI` 会在 `email` / `train` / `detail` 里匹配到，把"没内容"说成"有覆盖"。
   短于 3 字符的词不参与匹配 → 宁可报缺口，也不假装覆盖。
6. **`skills.update` 只改 description 会报「至少要写一步」**：局部更新时步骤要沿用原值。
   单测直接钉住这条（PATCH 描述不许连带清空步骤）。
7. **改后端不重启 = 测试绿但行为是旧的**：`chats.addMessage` 加了 `skill` 字段后没重启，
   「技能被记录」那条断言拿到的是旧进程的响应。**改 server/lib 之后先重启再跑 UI 验收。**
8. **测试脚本自己的脏数据会污染断言**：之前探测留下的 `SEO · …` campaign 让离线模板的
   `existing < 3` 条件不成立 → 「动作已执行」直接失败。跑之前先清、跑完再清（脚本已内置）。

---

## 5c. 本轮（v6 · GSC 真接入 / 应用目录 / 知识看板）抓到 / 避开的问题

1. **SVG 里的 `<text>` 会被"字号白名单"扫到**。应用图标用内联 SVG 字母（不是位图），
   `querySelectorAll('*')` + `getComputedStyle().fontSize` 把 11.5px 的数字当成正文 →
   直接判"计划外字号"。修法：扫描时 `if (el instanceof SVGElement) return`（SVG 是图片，不是文字），
   同时把字号改回 12 这个白名单值。**没有这条，图标方案从一开始就会被判失败。**
2. **测试会把真实数据清空，而且中途挂掉就还原不了**。ui-dash 原来只填 8 个字段就保存，
   此时若表单没渲染完（website 输入框还是空的），保存就等于把官网/写作风格/内容支柱清掉；
   而还原逻辑写在脚本末尾，脚本一挂就永远不还原 —— 本轮真丢过一次数据。
   修法：**脚本开头快照 `company`，`finally` 里整份写回**（ui-dash 和 ui-strategy 都改了）。
3. **中途挂掉的运行会污染下一次的计数**。上一轮装到一半的 `ahrefs` / `google_ads` 还在"已安装"，
   于是下一次"未安装的都有安装按钮"断言假失败。修法：测试开头把已安装的应用复位（走 API），
   并让断言容忍"已授权"的卡片（安装数 + 已授权数 === 应用数）。
4. **`disconnect` 必须连 Client ID/Secret 一起清**。否则下次点"用 Google 授权"会拿旧 id 去撞 Google，
   报错信息还指向授权页，很难查。现在断开 = 清凭据 + token + 站点选择（已同步的数据保留）。
5. **自定义应用装完但没授权时，没有入口删掉它**（只有"授权"按钮）。现在未授权也显示"移除"。
6. **`#toolList` 的渲染是异步的**，测试里固定 `sleep(300)` 偶尔不够 → 点到了 null。
   修法：`clickWhen()`（先 `waitForFunction` 等元素出现再点），而不是加长 sleep。

---

## 5d. 本轮（v11 · Content 列表）抓到 / 避开的问题

| 问题 | 怎么发现的 | 怎么修的 |
|---|---|---|
| **`setNav('content')` 把编辑器盖掉**：加完资产后应用内会再调一次 `setNav`，列表页的 `CL.open()` 直接把编辑器换成列表，后续 `page.click('#btnGen')` 拿到 0×0 的元素 | `ui-flow` 报 `Node is either not clickable`，量 `#btnGen` 矩形是 `{w:0,h:0}` | `CL.open()` 里先判 `isEditing()`，正在编辑就不动；`setNav` 只在真的不在编辑器时切回列表 |
| **新建内容进编辑器却显示上一个 campaign** | `ui-content` 建完 Article 后断言 `#fName` 是 `Untitled Article`，实际读到了旧标题 | 新建的 campaign 还不在前端 `S.details` 里，进编辑器前先 `await loadState(true)` |
| **删掉内容后条目又复活** | API 探针「创建 → 删除」后总数从 14 变 15，多出来的是刚删那条 | `content.save()` 是排队写盘，读之前必须 `await`；否则 `contentDbSynced()` 读到旧文件，把已删条目的资产「解绑」又写回去 |
| **排期 ≠ 已排期**：填了未来日期但稿子还没批准，一开始全被算成 Scheduled，Scheduled 一栏 14 条、Draft 0 条 | 用真实数据跑 `counts` 时发现 14/14 全是 scheduled | 状态推导改成「已批准 + 未来日期才是 Scheduled」，否则一律 Draft；Pending approval 只由「提交审核」触发 |
| **没有版本时，人工设的审核状态被清掉** | 单测「提交审核 → Pending approval」失败（先批准了审批再读是空） | 推导只在真有当前版本时才覆盖 `approval`；没版本时保留人工值 |
| **Campaign 容器在列表里刷重复行**：一条 Article 建了一个 campaign，列表里同时出现 campaign 行和资产行 | 首次同步后 16 行里 2 行是容器 | 只有显式创建成 Campaign 类型的 campaign 才单独成行；容器 campaign 空了就跟着资产一起删 |
| **删资产留下点不开的孤儿条目** | 编辑器里删资产后，列表里还留着那条，点进去报「没有可编辑的资产」 | 资产 DELETE 路由顺带删掉 `ct_as_<assetId>` 条目；资产被 campaign 侧删除时条目解绑但保留（不静默丢东西） |
| **`$` 在 `String.replace` 里是替换模式** | 打补丁的脚本把 `(/.*)?$'` 里的 `$'` 展开成「匹配之后的所有内容」，整段代码被截断 | patch 一律用函数式 `replace(a, () => b)`，或直接 `indexOf/slice` 拼接 |
| **行高 61px、字号出现 10/11px** | `shot.js` 报「行高异常 61」「计划外字号 10px, 11px」 | 勾选框容器写死 16px、单元格 8px 内边距（行高落到 43）；折角符/箭头从 10/11px 提到 12px；`shot.js` 里字号统一 `parseFloat` 再比 |
| **「未安装的应用没给安装按钮」这条断言本身会撒谎** | `shot.js` 报 14/15 | 不是缺按钮：GA4 已安装未授权，按钮合法地显示「授权」。判据改成「每张卡都有操作按钮」 |
| **Strategy「转成 campaign」把人丢在空列表页** | `ui-strategy` 报「Content 左侧能看到并选中这条新 campaign」失败 | 新 campaign 还没资产、列表里没有它 → 建完直接 `CL.showEditor()` 落到编辑器 |

| **列表里 article 的分数是 —，编辑器里却是 83%** | 断言「列表 GEO 分 === 编辑器里的分」拿到 `— vs 83%` | 服务端只在**内存里**给 article 行补分（`attachArticleScores`），而且必须在 `content.query` **之前**补，否则按 GEO 排序会把所有行都当成 null |
| **测试按整行文本找行，错抓到社媒行** | 同一个断言又失败一次，但 API 明明返回 geo: 83 | 社媒行的 **Campaign 列也叫 Untitled article**，`row.textContent` 一匹配就命中它。改成只认 `.cl-title` 的文本 |
| **`ui-content` 的「Create Article 直接进编辑器」整段失效** | 15s 超时，之后连行内删除也连带失败 | v12 起 article 走新编辑器：断言从 `#contentEditor` + `#fName` 换成 `#view-article` + `#arTitleBtn`，返回按钮从 `#btnBackToList` 换成 `#arClose`；新编辑器是**覆盖整屏的层**（底层列表故意不隐藏），所以判据改成查 `position:fixed` + `z-index≥50` + 尺寸，而不是查 `contentList.hidden` |

顺带确认的（不是问题，但记下来免得以后当 bug 改）：

- 表格在 1280 / 1440 两档都会**内部横向滚动**，但**页面本身零溢出** —— 这是设计：列多的时候宁可表内滚，不要让整页横滚。
- 群组计数里 `video` 计入 **Social posts**（短视频本来就是社媒形式）、`newsletter`/`podcast` 计入 **Broadcasts**，这是分组口径，不是类型错了。
- `Impressions / Reads` 两列恒为 `—`：没有站内分析就不填数字，这也是断言（不能写成 0）。v12 起 `GEO & SEO / Content gap` 对 `article` 是真数（`scoresOf`，与编辑器同一套算法，读取时现算不落盘），其它类型仍是 `—`。

---

## 5e. 本轮（v12 · 文章编辑器）抓到 / 避开的问题

| 问题 | 怎么发现的 | 怎么修的 |
|---|---|---|
| **`window.SCA is not a function`，整屏脚本没起来** | 打开页面 `pageerror` 立刻报这一句，`typeof window.AR === 'undefined'` | views 是 IIFE，**执行那一刻 `window.SCA` 还没赋值**，不能在模块顶层解构。改成懒取：`const SCA = () => window.SCA || {}`，`esc` 自己实现一份 |
| **编辑器能打开但一片空白** | 视图 class 已去掉 `hidden`，但标题/正文/卡片全查不到 | 模板里按钮 id 是 `arTitleBtn`，JS 却写 `$('arTitle')` → `null.textContent` 抛错，而 `open()` 外面有 `try/catch` 弹 toast，**把异常吃掉了**，看起来只是「没渲染」。修：id 对齐 + 每个可选节点判空 |
| **点 Tab 没反应，只有代码里手动切才生效** | `ui-article` 里点 `Audience` 后 `.ar-cat` 一个都没有，但 `AR.tab='audience'; AR.render()` 正常 | `A.init()` **从来没被调用过**（其它视图由 `setNav` 触发 init）。改成脚本末尾自己 init（DOM 未就绪时等 `DOMContentLoaded`） |
| **点一次 `Create with AI` 建了 5 条社媒帖** | 断言「再生成一条 → 2 条」拿到 5 | `renderRail()` 每次都往 `#arRail` 上 `addEventListener`，**监听器越叠越多**。改成右侧面板只在 `init` 挂一次，靠 `onRailClick` 分发 |
| **文章元信息「保存成功、读出来是空」** | PATCH 返回 `ok:true`，紧接着 GET 到 `slug`/`focusKeyword`/`custom` 全是空 | `content.normalize()` 是**严格白名单**，没列 `article` 就在每次 `save` 时把它丢掉。给 normalize 加上 `article`（含深拷贝），并在单测里加回归 |
| **存正文报 `Cannot read properties of undefined (reading 'words')`** | 新建文章的资产**没有任何版本**，`curOf()` 返回 undefined，处理器却直接读 `cur.body` | 抽出 `writeBody()`：没版本时先 `runAndAttach` 建 v1，已批准则开新版本，否则原地改当前版本 |
| **`slug` 检查永远过不了** | 标题带中文时生成 `persist-探针-two`，slug 校验（不含空格/中文）必然挂 | `slugify` 改成只保留 ascii 词，纯中文标题退回 `article-<id 尾 6 位>` |
| **`shot.js` 卡在 15 秒超时，且一个字都不打印** | 输出只有一行 `验收失败：Waiting failed: 15000ms exceeded` | 不是网络问题：`shot.js` 原来点 `.cl-title` 进**老编辑器**，而 v12 起 article 行改开新编辑器 → 老编辑器的 `contentEditor` 永远不出现。改成明确挑一条**非 article** 的进老编辑器。另外所有 `console.log` 都在脚本末尾，所以中途失败时没有上下文 —— 以后中途断言也要即时打印 |
| **深色块扫描全是误报** | 报「编辑器里出现深色块：ar-shell, ar-head-left, ar-icon」 | 扫描只看 `rgb()` 的前三个数，把 `rgba(0,0,0,0)`（透明）算成纯黑。改成先读 alpha、`alpha ≤ 0.5` 跳过；再排除按钮/胶囊，只把 `>120×60` 的面板当块 |
| **环形进度里出现 10px / 11px** | `shot.js` 报「计划外字号 10, 11」 | 圆圈里的数字/单位提到 12px，回到 12/13/14/16 的字号档 |
| **`page.waitForFunction(fn, null, {polling})` 直接抛** | `Cannot read properties of null (reading 'polling')` | 这个版本的签名是 `(fn, options, ...args)`，options 不能传 `null` |
| **关掉编辑器回列表，新建的文章看不见** | 列表 17 行但 `some(id)` 为 false | `close()` 只 `CL.open()` 渲染**旧缓存**。改成 `CL.open()` + `CL.load()` 重新拉一次 |
| **测试断言读了一个不存在的字段** | 断言「新建的文章在列表里」一直 false | 顺手发现 `window.CL` **没有 `data` 这个属性**（列表数据是模块内私有变量），断言读到的是 `undefined`。改成直接查 `/api/content` + 看 DOM 行 |

顺带确认的（不是问题，但记下来免得以后当 bug 改）：

- `Plagiarism check` 卡片**没有分数**是设计：`available:false` + 一句说明，比编一个 92% 诚实。
- LinkedIn / Facebook / Slack / Google Business Profile 标「未支持」也是设计：只有 X（4 条）和 Reddit（5 条）有带出处的渠道规则，**不为了凑满六个平台去发明规则**。
- 「GEO & SEO 67%」是 12 项硬检查的完成度，不是排名预测；页面上没写它是排名预测。

## 5f. 本轮（v13 · 社媒编辑器）抓到 / 避开的问题

| 问题 | 表现 | 原因与修法 |
|---|---|---|
| **点 Connect Buffer 报「连不上 Buffer：200 OK」** | 交互测试第一次跑就撞上 | 共享的 `SCA().api()` 把 `data.ok === false` **当异常抛**（那是给真错误用的）。而 Buffer 这几条接口的 `ok:false` 是**正常业务状态**（未连接 / 缺 client_id / 部分渠道失败）→ 这一屏改用不抛错的 `rawJson()`，并让服务端在 `ok:false` 时同时给 `error` 字段 |
| **素材存了，`/media/xxx.png` 却 404** | 上传成功、缩略图裂开、控制台两条 404 | `route()` 第一句就是「非 `/api` 的 GET 直接交给 serveStatic」—— `/media/` 写在下面的路由**永远走不到**。现在在那个分支里单独分流 `serveMedia()` |
| **刚存完 API key 立刻调接口报「还没连接 Buffer」** | 单测里 `setApiKey()` 之后马上拉渠道就挂 | `store.writeJson()` 是**排队异步**的（和五点六同源），写完立刻 `readJson` 读到的是旧文件。`lib/buffer.js` 现在有内存副本：先改内存、再异步落盘 |
| **测试跑一遍把真凭据写进 data/** | — | 新增 `SCA_DATA_DIR`：测试用临时目录 + 独立端口 + Buffer 替身，完全不碰 4319 上的真数据；`data/buffer-tokens.json`、`data/media/` 已进 `.gitignore` |
| **`data/providers.json` 里躺着明文 apiKey** | 排查 diff 时发现 | 运行时配置里有真 key → 加进 `.gitignore` 并 `git rm --cached`，以后不会再被 `git add -A` 带进版本库 |
| **`.sp-body` 撞了别人的类名** | 改版后右侧卡片只剩 318px 宽、两张卡叠在一起 | `index.html:123` 那个设置面板**早就用了** `.sp-head/.sp-body/.sp-section`，我新页面又起同一个名字 → 把它的 `padding/border-box/flex-direction:column` 全吃进来。我的容器改名 `.sp-shell`。**新增页面类名前先 grep 一遍 index.html 和 styles.css** |

---

## 6. 没验证的部分（如实标注）

| 项 | 状态 | 原因 |
|---|---|---|
| **和 StoryChief 逐像素一致** | ❌ 无法验证 | `app.storychief.io` 需要你的登录态，我只能按你给的文案 + 帮助中心里公开的结构去对；**我看不到图，只能靠几何/字重/间距的数字断言** |
| 真实 LLM 出稿 / 动作质量 | ❌ 未验证 | 本机连公司网关 502 / TLS 断开；只用死地址验证了失败路径 |
| **GSC 真 OAuth 全流程** | 🟡 代码全通，未跑真实账号 | 存凭据 → 302 `accounts.google.com`（只读 scope + state）→ 回调校验 → 换 token → 同步，都在测试里验过；**但用你的账号真的授权、真的拉回数据没验过**：本机 `www.googleapis.com` 被网关挡住（`oauth2.googleapis.com` 通，所以授权能走完、同步会报「连不上 Google」）。贴导出的路永远可用 |
| 外部应用直连 | ❌ 未做（按你的要求） | 15 个应用只做到 安装 → 授权（凭据存本机）→ 贴数据；逐家真 OAuth 要各自的开发者应用 + 审核，你说过要合作就不做 |
| **真实 MCP server** | ❌ 未做 | 「插件」是 `knowledge.tools` 的登记 + 贴数据，没有实现 MCP 协议握手 |
| **Strategy 四个板块** | ✅ 真功能 | New chat / Content audit / Company knowledge / Plugins & skills 都是真交互（73 项验收），且与 Dashboard 共用同一份存储 |
| Report 板块 | ⚠️ 说明页 | 只有 Dashboard / Strategy / Planning / Content 是真功能 |
| **`npm run verify:flow`** | ❌ 当前是红的（**不是本轮引入**） | 这个脚本是 v2 时代写的，直接操作老三栏编辑器；v11 之后 Content 列表接管了 content 视图，它第一步就 `Node is either not clickable`（元素被列表盖住）。已用「把本轮改动全部 stash 掉再跑」验证过是预存问题。要修得按现在的 UI 重写，属于单独一件事 |
| 文章编辑器 · 真实 LLM 生成 | 🟡 代码通，未跑真模型 | `Write article with AI` / `Create with AI` 走的是同一个 `llm.generate`。本机连不上网关，所以**验证到的是离线模板路径**（返回里带 `source: template` / `degraded: offline-rules`），真模型出稿质量没验过 |
| 文章编辑器 · 查重 | ❌ 恒不可用 | 没接任何查重服务，卡片上如实写「没接」，`available:false`、`pct:null`，并有单测钉住它不许变成数字 |
| 文章编辑器 · 真实排名 / 数据回流 | ❌ 未做 | `GEO & SEO` 是 12 项本地规则的完成度；Impressions / Reads 仍恒为 `—`。没有 GSC 之外的排名数据源，也不编 |
| 文章编辑器 · WYSIWYG | ❌ 刻意不做 | 正文是 Markdown 源文 + 预览。质检（`lib/rules.js` + 这 12 项）全建立在纯文本上，换文档模型等于把规则层推倒重来 |
| 文章编辑器 · 平台直发 | ❌ 未做 | `/publish` 只改本地状态，返回里明确写「本地工具不直连平台」；社媒帖也是本地子资产，不会真发到 X / Reddit |
| 移动端 / 窄屏 | ⚠️ 只到 720px 断点 | 三栏在手机上未适配 |
| 平台直发 | ❌ 故意没做 | 发布仍交给现有流水线 |

---

## 7. 已知的坑（累计）

1. 视图脚本必须包 IIFE —— 多个经典 `<script>` 共享同一个顶层词法作用域，`const` 重名会静默让整个文件不执行。
2. 全局对象在赋值时引用了未定义标识符 → 整条赋值语句抛错，后续所有依赖它的视图全挂。**改完先看控制台第一行。**
3. `page.evaluate` 的返回值必须可序列化：返回带函数的对象会被丢掉。
4. 验收脚本要先挑"有资产的 campaign"再断言，否则空 campaign 会让整轮卡在选择器上。
5. 测失败路径时要用**死端口 / 假地址**，不要依赖真实网络状态。
6. `element.click()` 对**隐藏元素**照样有效（详情面板里的表单、弹窗里的按钮都能点），
   但断言"用户能不能看到"必须单独查：`getBoundingClientRect()` 宽高、`!closest('.hidden')`。
7. 结果型接口（测试连通性、拉模型）一律 `ok:true` + 嵌套结果，别让前端通用 `api()` 当异常吞掉。
8. accent 蓝的软底文字要用更深的 `--accent-ink`（`#2f6bff` 在浅蓝底上只有 4.05:1）。
9. **新建的前端文件要 HTTP `GET` 一次确认存在**：写文件工具报成功、目录里却没有，页面只留一行 404，
   而且很容易被"没有 chatId 就提前 return"这类分支掩盖。
10. **同一份表单要在两处显示，就搬 DOM、不要拷 HTML**：拷贝会 id 重复、状态分裂。
    搬完记得清掉 `hidden`，并且用**宽度断言**防止"看不见但点得到"。
11. **改了 `server.js` / `lib/*` 必须重启进程再跑 UI 验收**，否则断言测的是旧进程（已因此误判过一次）。
12. **测试脚本自己造的脏数据会让断言假失败**：遗留的 campaign 会让离线模板的 `existing < 3` 不成立。
    跑前清、跑后清，并把"清理成功"本身也断言掉。
13. **views 里的 IIFE 不许在顶层解构 `window.SCA`** —— 脚本执行那一刻它还没赋值，会直接 `window.SCA is not a function` 让整个文件不跑。一律懒取（`const SCA = () => window.SCA || {}`）。
14. **`try/catch` 包住的渲染会"看起来只是空白"**：把异常吞成 toast，DOM 就是没内容。`open()` 里要判空每一个节点，别让一个错 id 干掉整屏。
15. **`addEventListener` 别写在每次 render 里**：右侧面板重绘 N 次就有 N 个监听，一次点击触发 N 次（本轮的「点一下建 5 条社媒帖」）。挂一次、内部按状态分发。
16. **`content.normalize()` 是严格白名单**：往条目上挂新字段（`item.article`）必须同时加进 normalize，否则"保存成功、读出来是空"，而且 PATCH 会返回 `ok:true` 骗过所有看返回值的测试。
17. **深色块扫描要读 alpha**：`rgba(0,0,0,0)` 的 RGB 是 0，只看前三段会把每个透明 div 判成纯黑。
18. **`page.waitForFunction(fn, options, ...args)`**：options 不能传 `null`，会 `Cannot read properties of null (reading 'polling')`。
19. **PATH 里的 `node` 版本带 `fetch`（Node 24）**，但 patch 脚本里**别用模板字符串装 Markdown 片段**：反引号 + PowerShell here-string 混在一起极易被吃掉，改完就 `SyntaxError`。装文档用单引号字符串 + `join('\n')`。
