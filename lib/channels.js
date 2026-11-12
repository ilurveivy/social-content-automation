'use strict';
/**
 * 渠道规则包（rules-as-data）
 *
 * 设计原则：
 *  1. 每条规则都必须能指回一个出处（cite）—— 没有出处的规则是"过期权威"，比没有更危险。
 *  2. 规则是可版本化的数据，不是散落在代码里的 if。
 *  3. 抓不到的规则就写 "社区共识"，不假装是官方原文。
 */

const CHANNELS = [
  {
    id: 'youtube_script',
    label: 'YouTube Script',
    labelZh: 'YouTube 脚本',
    icon: '▶',
    blurb: '长视频口播稿：前 2 行定生死，必须有章节与单一 CTA。',
    limits: { max: 4000, min: 600 },
    rules: [
      { id: 'yt_hook_first_2_lines', text: '前两行必须是钩子（问题 / 反常识结论 / 具体数字），不能是自我介绍。', severity: 'must', cite: 'YouTube 创作者共识：前 30 秒决定留存' },
      { id: 'yt_len_min', text: '正文至少 600 字符（中文按 300 字计，否则不构成脚本，只是提纲）。', severity: 'must', cite: '内部约定' },
      { id: 'yt_chapters', text: '必须含章节或时间轴标记（00:00 形式），否则无法剪辑。', severity: 'should', cite: '内部约定（便于 Seedance/HeyGen 分镜）' },
      { id: 'yt_single_cta', text: 'CTA 只能有一个，且出现在结尾附近。', severity: 'must', cite: '内部约定' },
      { id: 'yt_no_link_bio', text: '不要写 "link in bio"（YouTube 描述区才是放链接的地方）。', severity: 'should', cite: '平台惯例' }
    ]
  },
  {
    id: 'tiktok_script',
    label: 'TikTok Short',
    labelZh: 'TikTok 短口播',
    icon: '♪',
    blurb: '3 秒钩子 + 单点信息 + 口播感。不能有外链、不能像 PPT。',
    limits: { max: 900, min: 120 },
    rules: [
      { id: 'tt_hook_3s', text: '前 15 个词（≈3 秒）内必须出现冲突/结果/悬念，不能是"大家好我是…"。', severity: 'must', cite: 'TikTok 创作者共识：3 秒完播率' },
      { id: 'tt_len_max', text: '正文 ≤ 900 字符（约 60–90 秒口播）。', severity: 'must', cite: '内部约定' },
      { id: 'tt_spoken', text: '不许用 Markdown 列表 / 加粗 —— 这是要念出来的，不是读的。', severity: 'should', cite: '内部约定' },
      { id: 'tt_no_link', text: '正文不放外链（会被降权，且不可点击）。', severity: 'must', cite: '平台惯例（外部链接在短视频描述里不可点）' },
      { id: 'tt_one_point', text: '只讲一个点。出现 ≥3 个卖点时算失败。', severity: 'should', cite: '短视频信息密度共识' }
    ]
  },
  {
    id: 'x_post',
    label: 'X Post',
    labelZh: 'X 帖子',
    icon: '𝕏',
    blurb: '短钩子 + 一条信息 + 克制。首行决定展开率。',
    limits: { max: 280, min: 60 },
    rules: [
      { id: 'x_len_280', text: '≤ 280 字符（链接按 23 字符计）。', severity: 'must', cite: 'X 官方字符规则' },
      { id: 'x_hook_60', text: '第一行 ≤ 60 字符，且本身能独立成立（折叠后仍可读）。', severity: 'should', cite: '信息流折叠行为（社区共识）' },
      { id: 'x_hashtag_max1', text: '话题标签 ≤ 1 个。堆标签降低触达。', severity: 'should', cite: '社区共识' },
      { id: 'x_no_hard_sell', text: '不许出现 "Buy now / 立即抢购 / limited offer" 这类硬广词。', severity: 'must', cite: '内部约定（品牌调性）' }
    ]
  },
  {
    id: 'reddit_post',
    label: 'Reddit Post',
    labelZh: 'Reddit 软帖',
    icon: '👽',
    blurb: '先给价值再提产品。标题不能有推广词，第一段不能放链接。',
    limits: { max: 6000, min: 400 },
    rules: [
      { id: 'rd_title_no_promo', text: '标题不含推广词（buy / discount / promo / launch / free trial）。', severity: 'must', cite: 'Reddit 自我推广规则（各 sub 普遍执行）' },
      { id: 'rd_no_link_first_para', text: '第一段不能出现链接 —— 先证明你是来讨论的。', severity: 'must', cite: 'Reddit 反垃圾惯例（社区共识）' },
      { id: 'rd_len_min', text: '≥ 400 字符（中文按 200 字计；短贴会被当广告秒删）。', severity: 'must', cite: '内部约定' },
      { id: 'rd_has_question', text: '必须含一个真问题（邀请讨论，而不是单向输出）。', severity: 'should', cite: 'sub 文化：讨论优先' },
      { id: 'rd_disclosure', text: '提到自家产品时必须显式披露利益关系（如 "I built this"）。', severity: 'must', cite: 'Reddit 自我推广规则（披露要求）' }
    ]
  },
  {
    id: 'cold_email',
    label: 'Cold Email',
    labelZh: '冷邮件',
    icon: '✉',
    blurb: '一个收件人 + 一个理由 + 一个低门槛请求。正文别出现"附件"两个字。',
    limits: { max: 1200, min: 120 },
    rules: [
      { id: 'ce_subject_60', text: '主题 ≤ 60 字符，且不含全大写与感叹号。', severity: 'must', cite: '冷邮件回复率共识' },
      { id: 'ce_len_max', text: '正文 ≤ 1200 字符（超过就不会被读完）。', severity: 'must', cite: '冷邮件回复率共识' },
      { id: 'ce_link_max1', text: '链接 ≤ 1 个。', severity: 'should', cite: '送达率共识' },
      { id: 'ce_no_attach_word', text: '正文不许出现 "附件 / attach / attached" —— Gmail 会弹"忘记加附件了吗"并挡下发送。', severity: 'must', cite: '本工作区 2026-09-28 实测（AGENTS.md 第四节）' },
      { id: 'ce_one_ask', text: '只提一个请求，且是低门槛的（不是"约个会"—— 本工作区明确禁止约通话）。', severity: 'must', cite: '用户明确要求（AGENTS.md 0.1）' },
      { id: 'ce_points_max3', text: '卖点 ≤ 3 条，超过就是群发感。', severity: 'should', cite: '内部约定' }
    ]
  },
  {
    id: 'landing_hero',
    label: 'Landing Page',
    labelZh: '落地页首屏',
    icon: '▤',
    blurb: '首屏只说一件事：谁、解决什么、下一步点哪里。',
    limits: { max: 1500, min: 200 },
    rules: [
      { id: 'lp_headline_60', text: '主标题 ≤ 60 字符（H1 一行能读完）。', severity: 'must', cite: '首屏可读性共识' },
      { id: 'lp_subhead_140', text: '副标题 ≤ 140 字符，且必须写"给谁 + 得到什么"。', severity: 'should', cite: '首屏结构共识' },
      { id: 'lp_one_cta', text: '首屏只有一个主 CTA（多个 CTA = 没有 CTA）。', severity: 'must', cite: '转化率共识' },
      { id: 'lp_proof', text: '必须有一个具体证据（数字 / 客户名 / 结果），不能只有形容词。', severity: 'must', cite: '内部约定' },
      { id: 'lp_no_jargon', text: '不许出现 "赋能 / 闭环 / 一站式 / 颠覆" 这类行话。', severity: 'should', cite: '内部约定' }
    ]
  },
  {
    id: 'video_shotlist',
    label: 'Video Shotlist',
    labelZh: '视频分镜包',
    icon: '▦',
    blurb: '给 Seedance / HeyGen 直接吃的分镜：每镜头都有秒数、画面、台词、提示词。',
    limits: { max: 3000, min: 200 },
    rules: [
      { id: 'vs_shot_count', text: '至少 5 个镜头，每个镜头以「【镜头 N · 起–止s】」开头。', severity: 'must', cite: '分镜可执行性（内部约定）' },
      { id: 'vs_total_duration', text: '必须标注「总时长：N 秒」，且 ≤ 45 秒（竖屏短视频口径）。', severity: 'should', cite: 'TikTok / Shorts 完播共识' },
      { id: 'vs_each_has_prompt', text: '每个镜头都要同时有「画面：」和「提示词：」—— 少了模型生成不出来。', severity: 'must', cite: 'Seedance / HeyGen 需要逐镜画面提示词（内部约定）' },
      { id: 'vs_no_link', text: '分镜里不要出现外链（画面里的链接不可点，还容易被判搬运）。', severity: 'should', cite: '平台惯例' },
      { id: 'vs_cta_end', text: '最后一个镜头必须是 CTA 或品牌落版。', severity: 'must', cite: '内部约定' }
    ]
  }
];

/** 资产类别：StoryChief 的 campaign 里是按 article / social / email / video 分的，这里对齐 */
const ASSET_TYPES = [
  { id: 'article', label: '文章 / 落地页', short: '文章', hint: '落地页首屏、长文' },
  { id: 'social', label: '社交帖', short: '社交', hint: 'X、Reddit' },
  { id: 'email', label: '邮件', short: '邮件', hint: '冷邮件' },
  { id: 'video', label: '视频', short: '视频', hint: 'YouTube 脚本、TikTok 口播、分镜包' }
];

const CHANNEL_TYPE = {
  youtube_script: 'video',
  tiktok_script: 'video',
  video_shotlist: 'video',
  x_post: 'social',
  reddit_post: 'social',
  cold_email: 'email',
  landing_hero: 'article'
};
CHANNELS.forEach((c) => { c.type = CHANNEL_TYPE[c.id] || 'article'; });

const assetTypeOf = (channelId) => {
  const ch = channelById(channelId);
  return ch ? ch.type : 'article';
};
const assetTypeMeta = (id) => ASSET_TYPES.find((t) => t.id === id) || ASSET_TYPES[0];

/** 全局禁用词（品牌级，可被 data/settings.json 覆盖） */
const DEFAULT_BANNED = [
  '赋能', '闭环', '一站式', '颠覆', '革命性', 'game-changer', 'game changer',
  'buy now', 'limited offer', '立即抢购'
];

const HARD_SELL = ['buy now', 'limited offer', '立即抢购', 'act now', 'order today'];
const PROMO_WORDS = ['buy', 'discount', 'promo', 'launch', 'free trial', 'sale', 'coupon', 'deal'];
const JARGON = ['赋能', '闭环', '一站式', '颠覆', 'synergy', 'leverage', 'disrupt'];
const ATTACH_WORDS = ['附件', 'attach', 'attached', 'attachment'];

function channelById(id) {
  return CHANNELS.find((c) => c.id === id) || null;
}

/** 每条渠道的生成提示词（给 LLM 用；也可以用模板模式离线生成） */
function buildPrompt(channel, brief) {
  const ruleText = channel.rules
    .map((r) => `- [${r.severity === 'must' ? '必须' : '建议'}] ${r.text}（依据：${r.cite}）`)
    .join('\n');
  const points = (brief.sellingPoints || []).map((p, i) => `${i + 1}. ${p}`).join('\n') || '（未提供，请从原始素材中提炼 1 条）';

  const sys = `你是渠道适配编辑，只输出成稿正文，不要解释、不要 Markdown 代码块。
你的任务：把同一份原始素材改写成【${channel.labelZh}】这一渠道的版本。

渠道规则（必须逐条满足）：
${ruleText}

硬性要求：
- 语言：${brief.language || 'en'}
- 受众：${brief.audience || '未指定'}
- 调性：${brief.tone || '直接、具体、不吹'}
- 禁止：编造数字、编造客户名、承诺效果、约通话/约会议。`;

  const user = `标题/主题：${brief.title || ''}
核心卖点：
${points}
行动号召：${brief.cta || '（无，请弱化 CTA）'}
产品链接：${brief.links && brief.links.product ? brief.links.product : '（无）'}

原始素材：
"""
${(brief.rawMaterial || '').slice(0, 6000)}
"""

请按上面规则输出【${channel.labelZh}】的成稿。`;

  return { system: sys, user };
}

module.exports = {
  CHANNELS, ASSET_TYPES, DEFAULT_BANNED, HARD_SELL, PROMO_WORDS, JARGON, ATTACH_WORDS,
  channelById, assetTypeOf, assetTypeMeta, buildPrompt
};
