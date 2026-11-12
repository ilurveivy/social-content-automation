'use strict';
/**
 * 公司知识库 / 应用目录（插件）/ 知识文件。
 *
 * 这是 agent 的"记忆"：没有它，模型只能写通用废话。
 * Dashboard 和 Strategy 用的是**同一份数据**，只是入口不同 —— 所以
 * 进度、字段定义、完整度全部由这里的 BLOCKS 单一决定，不要在前端各算一套。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./store');

const FILE = 'knowledge.json';
const FILE_DIR = path.join(store.DATA_DIR, 'knowledge');
const IMG_DIR = path.join(store.DATA_DIR, 'knowledge', 'img');
const MAX_FILE_CHARS = 200000;

/**
 * 应用目录（StoryChief 的 Plugins 页就是这个形态：图标 + 名字 + 一句话 + Install）。
 * 说明写清楚：本地版装上之后是"存凭据 / 贴导出"，不是各家 OAuth ——
 * 真 OAuth 需要逐个应用登记开发者应用，那是商务+审核的事，这里不做假的。
 */
const APP_CATALOG = [
  { id: 'ga4', name: 'Google Analytics 4', category: '分析', mono: 'GA', color: '#b45309', tint: '#fef3c7', desc: '会话、渠道来源与转化数据' },
  { id: 'google_ads', name: 'Google Ads', category: '广告', mono: 'Ad', color: '#1d4ed8', tint: '#dbeafe', desc: '花费、点击与转化成本' },
  { id: 'meta_ads', name: 'Meta Ads', category: '广告', mono: 'Me', color: '#1e40af', tint: '#dbeafe', desc: 'Facebook / Instagram 投放表现' },
  { id: 'ahrefs', name: 'Ahrefs', category: 'SEO', mono: 'Ah', color: '#0f766e', tint: '#ccfbf1', desc: '关键词搜索量与自然排名' },
  { id: 'semrush', name: 'Semrush', category: 'SEO', mono: 'Se', color: '#9a3412', tint: '#ffedd5', desc: '竞品自然流量与关键词差距' },
  { id: 'hubspot', name: 'HubSpot', category: 'CRM', mono: 'Hu', color: '#9d174d', tint: '#fce7f3', desc: '线索、生命周期阶段与成交' },
  { id: 'mailchimp', name: 'Mailchimp', category: '邮件', mono: 'Ma', color: '#854d0e', tint: '#fef9c3', desc: '订阅数、打开率与退订' },
  { id: 'notion', name: 'Notion', category: '知识库', mono: 'No', color: '#111827', tint: '#e5e7eb', desc: '内部文档、产品资料与会议纪要' },
  { id: 'wordpress', name: 'WordPress', category: '发布', mono: 'Wp', color: '#1e4d6b', tint: '#e0f2fe', desc: '已发布文章与历史旧稿' },
  { id: 'webflow', name: 'Webflow', category: '发布', mono: 'Wf', color: '#3730a3', tint: '#e0e7ff', desc: '落地页与 CMS 内容' },
  { id: 'linkedin', name: 'LinkedIn Pages', category: '社交', mono: 'In', color: '#0f4c81', tint: '#e0f2fe', desc: '主页帖子表现与触达' },
  { id: 'slack', name: 'Slack', category: '协作', mono: 'Sl', color: '#6b21a8', tint: '#f3e8ff', desc: '把日报和提醒发到频道' },
  { id: 'stripe', name: 'Stripe', category: '收入', mono: 'St', color: '#4c1d95', tint: '#ede9fe', desc: '收入、订阅与流失变化' },
  { id: 'partnerstack', name: 'PartnerStack', category: '联盟', mono: 'Pa', color: '#115e59', tint: '#ccfbf1', desc: '联盟与推荐渠道表现' },
  { id: 'zapier', name: 'Zapier', category: '自动化', mono: 'Za', color: '#9a3412', tint: '#ffedd5', desc: '把这里的动作接到别的工具' }
];

const BY_ID = new Map(APP_CATALOG.map((a) => [a.id, a]));

/**
 * 10 项 setup 清单 —— Strategy → Company knowledge 的 Overview 进度就是它，
 * Dashboard 卡片上的 "N of 10 complete" 也是它。**一个数字，两处显示**。
 * 顺序即 Overview 里那个两列网格的填充顺序（先填满左列 5 个，再填右列 5 个）。
 */
const BLOCKS = [
  { key: 'website', label: 'Website', tab: 'general', hint: '你对外的主站地址' },
  { key: 'brandVoices', label: 'Brand voices', tab: 'voices', hint: '写出来的东西得像谁在说' },
  { key: 'visualStyle', label: 'Visual style', tab: 'visual', hint: '配色、字体、图片风格' },
  { key: 'gsc', label: 'Google Search Console', tab: 'general', hint: '接上真实搜索数据' },
  { key: 'audiences', label: 'Target audiences', tab: 'audiences', hint: '具体到角色和公司规模' },
  { key: 'description', label: 'Company description', tab: 'general', hint: '做什么、给谁、凭什么是你' },
  { key: 'writingStyle', label: 'Writing style', tab: 'writing', hint: '句式、标点、怎么写的规则' },
  { key: 'competitors', label: 'Competitor websites', tab: 'general', hint: '真实在抢客户的 3–5 个' },
  { key: 'contentPillars', label: 'Content pillars', tab: 'pillars', hint: '长期反复讲的 2–4 个主题' },
  { key: 'files', label: 'Knowledge files', tab: 'files', hint: '内部文档，agent 读得到的' }
];

const TEXT_KEYS = ['website', 'name', 'description', 'customInstructions', 'writingStyle', 'visualStyle', 'oneLiner', 'tone'];
// audiences / contentPillars 已经是结构化对象，走各自的增删改接口，不再当成"一行一个"的文本列表
const LIST_KEYS = ['languages', 'competitors', 'products', 'differentiators', 'proofPoints'];

/** 品牌语气：StoryChief 的 Brand voice（名字 + 说明 + 用途 + 示例片段） */
function emptyVoice() {
  return { id: '', name: '', description: '', useCase: 'general', excerpts: [] };
}

/** 目标受众：StoryChief 的 Target audience（Basic + Audience profile + Needs and concerns） */
function emptyAudience() {
  return {
    id: '', name: '', description: '',
    industries: [], jobTitles: [], companySize: '',
    goals: [], painPoints: []
  };
}

/** 内容支柱：StoryChief 的 Content pillar（Basic + Strategy + Content guidance） */
function emptyPillar() {
  return {
    id: '', name: '', description: '',
    audienceIds: [], searchQuestions: [],
    topicsInclude: [], topicsAvoid: [], coreMessages: []
  };
}

/** 写作规范：StoryChief 的 Writing style（名字 + 四组开关 + 备注） */
function emptyWritingStyle() {
  return {
    id: '', name: '', notes: '',
    contractions: false, avoidHedging: false, avoidFiller: false, genderNeutral: false,
    avoidSemicolons: false, oxfordCommas: false, preferPeriods: false, avoidEmDashes: false,
    quoteStyle: 'none',
    avoidAmpersands: false, avoidPlus: false,
    headingCase: 'none'
  };
}

/** 视觉风格：StoryChief 的 Visual style（名字 + Guidelines + 配色 + 参考图 / Logo） */
function emptyVisualStyle() {
  return {
    id: '', name: '', guidelines: '',
    primaryColor: '', secondaryColor: '',
    referenceIds: [], logoIds: []
  };
}

/** Company size 下拉的档位（同时也允许自己输入，用 datalist） */
const COMPANY_SIZES = ['1-10', '11-50', '51-200', '201-500', '501-1000', '1000+'];

/**
 * Writing style 的规则表 —— 前端弹窗靠它渲染，prompt 靠 phrase 写人话。
 * 开关默认全关（= 不强制），下拉默认 no preference。**加规则只要在这里加一行。**
 */
const QUOTE_STYLES = [
  { id: 'none', label: 'No preference' },
  { id: 'double', label: 'Double quotes', phrase: '引号用双引号' },
  { id: 'single', label: 'Single quotes', phrase: '引号用单引号' }
];

const HEADING_CASES = [
  { id: 'none', label: 'No preference' },
  { id: 'title', label: 'Title case', phrase: '标题用 Title case' },
  { id: 'sentence', label: 'Sentence case', phrase: '标题用 Sentence case' },
  { id: 'upper', label: 'All caps', phrase: '标题全大写' }
];

const WRITING_GROUPS = [
  {
    title: 'Writing style',
    rules: [
      { key: 'contractions', type: 'switch', label: 'Use contractions where possible', short: 'Contractions', desc: "Prefer shortened forms like \"it's,\" \"don't,\" and \"you're\" over their spelled-out equivalents.", phrase: '尽量用缩写（it\'s / don\'t）' },
      { key: 'avoidHedging', type: 'switch', label: 'Avoid hedging language', short: 'No hedging', desc: 'Cut tentative words such as "perhaps," "maybe," and "somewhat" that weaken a statement.', phrase: '不用模糊限定词（perhaps / maybe / somewhat）' },
      { key: 'avoidFiller', type: 'switch', label: 'Avoid filler words', short: 'No filler words', desc: 'Avoid words that add little meaning, like "very," "really," "just," and "actually."', phrase: '不用填充词（very / really / just / actually）' },
      { key: 'genderNeutral', type: 'switch', label: 'Use gender-neutral language', short: 'Gender-neutral', desc: 'Prefer inclusive terms such as singular "they" instead of "he/she."', phrase: '性别中立措辞（用 they 而不是 he/she）' }
    ]
  },
  {
    title: 'Punctuation',
    rules: [
      { key: 'avoidSemicolons', type: 'switch', label: 'Avoid semicolons', short: 'No semicolons', desc: 'Split or rejoin sentences with periods or commas instead of using semicolons.', phrase: '不用分号' },
      { key: 'oxfordCommas', type: 'switch', label: 'Use Oxford commas', short: 'Oxford commas', desc: 'Add a comma before the final "and" or "or" in a list of three or more items.', phrase: '用牛津逗号' },
      { key: 'preferPeriods', type: 'switch', label: 'Prefer periods over exclamation marks', short: 'No exclamation marks', desc: 'Swap exclamation marks for periods to keep a calmer, more measured tone.', phrase: '用句号不用感叹号' },
      { key: 'avoidEmDashes', type: 'switch', label: 'Avoid em-dashes', short: 'No em-dashes', desc: 'Rework sentences to avoid the em-dash (—), using commas, parentheses, or separate sentences instead.', phrase: '不用破折号' },
      { key: 'quoteStyle', type: 'select', label: 'Quote style', desc: 'Choose which quotation marks to use throughout the text.', options: QUOTE_STYLES }
    ]
  },
  {
    title: 'Symbols and special characters',
    rules: [
      { key: 'avoidAmpersands', type: 'switch', label: 'Avoid ampersands', short: 'No ampersands', desc: 'Write out "and" instead of using "&," unless it appears in a brand name.', phrase: '不用 &（写 and）' },
      { key: 'avoidPlus', type: 'switch', label: "Avoid '+' to mean 'and'", short: 'No "+" for and', desc: 'Spell out "and" rather than using a plus sign to join words.', phrase: '不用 + 表示 and' }
    ]
  },
  {
    title: 'Titles and headings',
    rules: [
      { key: 'headingCase', type: 'select', label: 'Heading case style', desc: 'Set how words in titles and headings are capitalized.', options: HEADING_CASES }
    ]
  }
];

/** 给 prompt 用：把开着的规则翻成一句人话 */
function writingPhrases(ws) {
  const out = [];
  for (const g of WRITING_GROUPS) {
    for (const r of g.rules) {
      if (r.type === 'switch') { if (ws[r.key]) out.push(r.phrase); continue; }
      const pick = r.options.find((o) => o.id === ws[r.key]);
      if (pick && pick.id !== 'none') out.push(pick.phrase || (r.label + '：' + pick.label));
    }
  }
  return out;
}

const strList = (v, cap, len) => (Array.isArray(v) ? v : [])
  .map((x) => String(x == null ? '' : x).trim())
  .filter(Boolean)
  .slice(0, cap || 20)
  .map((x) => x.slice(0, len || 160));

const shortId = (prefix, seed) => prefix + crypto.createHash('sha1')
  .update(String(seed)).digest('hex').slice(0, 8);

function emptyCompany() {
  return {
    website: '',
    name: '',
    description: '',
    languages: [],
    competitors: [],
    customInstructions: '',
    visualStyle: '',
    brandVoices: [],
    audiences: [],
    contentPillars: [],
    writingStyles: [],
    visualStyles: [],
    writingStyle: '',
    // —— 老字段：只作为迁移来源保留，新的 UI 不再直接写它们 ——
    oneLiner: '',
    products: [],
    differentiators: [],
    tone: '',
    proofPoints: []
  };
}

/**
 * 老数据 → 新结构（幂等）。第一次 load 就会自动补齐，
 * 所以历史数据不用手工迁移，UI 也不会看到半新半旧。
 */
function migrateCompany(c) {
  if (!c.description) {
    const lines = [];
    if (c.oneLiner) lines.push(String(c.oneLiner));
    for (const x of c.products || []) if (String(x || '').trim()) lines.push('- ' + String(x).trim());
    if (lines.length) c.description = lines.join('\n');
  }
  if (!c.customInstructions) {
    const parts = [];
    const diff = (c.differentiators || []).filter((x) => String(x || '').trim());
    const proof = (c.proofPoints || []).filter((x) => String(x || '').trim());
    if (diff.length) parts.push('差异化卖点：\n' + diff.map((x) => '- ' + String(x).trim()).join('\n'));
    if (proof.length) parts.push('可引用的事实 / 证据：\n' + proof.map((x) => '- ' + String(x).trim()).join('\n'));
    if (parts.length) c.customInstructions = parts.join('\n\n');
  }
  if (!Array.isArray(c.brandVoices) || !c.brandVoices.length) {
    if (String(c.tone || '').trim()) {
      // id 必须是稳定的：随机的 id 会导致"每次 load 都像换了一条 voice"，删都删不掉
      const stable = crypto.createHash('sha1').update(String(c.tone).trim()).digest('hex').slice(0, 8);
      c.brandVoices = [{
        id: 'bv_' + stable,
        name: String(c.tone).trim().slice(0, 60),
        description: '',
        useCase: 'general',
        excerpts: []
      }];
    }
  }
  // —— 目标受众：老数据是一行一个字符串 ——
  if (!Array.isArray(c.audiences)) c.audiences = [];
  c.audiences = c.audiences.map((a, i) => {
    if (a && typeof a === 'object') return a;
    const name = String(a || '').trim();
    return {
      id: shortId('ta_', 'audience' + i + '|' + name),
      name: name.slice(0, 60),
      description: '', industries: [], jobTitles: [], companySize: '', goals: [], painPoints: []
    };
  }).filter((a) => String(a.name || '').trim());

  // —— 内容支柱：原来有多条（内容适配 / AI 可见性 / 竞品对比），
  //    按 StoryChief 的形态合并成**一条** pillar，原来的主题进 Topics to include ——
  if (!Array.isArray(c.contentPillars)) c.contentPillars = [];
  if (c.contentPillars.some((x) => typeof x === 'string')) {
    const names = c.contentPillars.map((x) => String(x || '').trim()).filter(Boolean);
    c.contentPillars = names.length ? [{
      id: shortId('cp_', 'pillar|' + names.join('|')),
      name: names.join(' / ').slice(0, 60),
      description: '原有内容支柱合并成这一条，具体主题见 Topics to include。',
      audienceIds: [],
      searchQuestions: [],
      topicsInclude: names.slice(0, 12),
      topicsAvoid: [],
      coreMessages: []
    }] : [];
  }
  c.contentPillars = c.contentPillars.map((x) => (x && typeof x === 'object' ? x : null)).filter(Boolean);
  c.audiences = c.audiences.map((a, i) => ({
    id: String(a.id || shortId('ta_', 'audience' + i + '|' + String(a.name || ''))),
    name: String(a.name || '').slice(0, 60),
    description: String(a.description || '').slice(0, 2000),
    industries: strList(a.industries, 20, 120),
    jobTitles: strList(a.jobTitles, 20, 120),
    companySize: String(a.companySize || '').slice(0, 60),
    goals: strList(a.goals, 20, 200),
    painPoints: strList(a.painPoints, 20, 200)
  })).filter((a) => a.name);
  c.contentPillars = c.contentPillars.map((x, i) => ({
    id: String(x.id || shortId('cp_', 'pillar' + i + '|' + String(x.name || ''))),
    name: String(x.name || '').slice(0, 60),
    description: String(x.description || '').slice(0, 2000),
    audienceIds: strList(x.audienceIds, 30, 60),
    searchQuestions: strList(x.searchQuestions, 20, 200),
    topicsInclude: strList(x.topicsInclude, 20, 160),
    topicsAvoid: strList(x.topicsAvoid, 20, 160),
    coreMessages: strList(x.coreMessages, 20, 200)
  })).filter((x) => x.name);

  // —— 写作规范：老的单段文字变成**一条**结构化条目，原文放进 notes ——
  if (!Array.isArray(c.writingStyles)) c.writingStyles = [];
  if (!c.writingStyles.length && String(c.writingStyle || '').trim()) {
    const text = String(c.writingStyle).trim().slice(0, 2000);
    c.writingStyles = [{
      ...emptyWritingStyle(),
      id: shortId('ws_', 'writing|' + text),
      name: '通用写作规范',
      notes: text
    }];
  }
  c.writingStyle = '';
  c.writingStyles = c.writingStyles.map((w, i) => ({
    ...emptyWritingStyle(),
    id: String(w.id || shortId('ws_', 'writing' + i + '|' + String(w.name || ''))),
    name: String(w.name || '').slice(0, 60),
    notes: String(w.notes || '').slice(0, 2000),
    contractions: !!w.contractions, avoidHedging: !!w.avoidHedging,
    avoidFiller: !!w.avoidFiller, genderNeutral: !!w.genderNeutral,
    avoidSemicolons: !!w.avoidSemicolons, oxfordCommas: !!w.oxfordCommas,
    preferPeriods: !!w.preferPeriods, avoidEmDashes: !!w.avoidEmDashes,
    quoteStyle: QUOTE_STYLES.some((o) => o.id === w.quoteStyle) ? w.quoteStyle : 'none',
    avoidAmpersands: !!w.avoidAmpersands, avoidPlus: !!w.avoidPlus,
    headingCase: HEADING_CASES.some((o) => o.id === w.headingCase) ? w.headingCase : 'none'
  })).filter((w) => w.name);

  // —— 视觉风格：老的单段文字变成**一条**结构化条目，原文放进 Guidelines ——
  if (!Array.isArray(c.visualStyles)) c.visualStyles = [];
  if (!c.visualStyles.length && String(c.visualStyle || '').trim()) {
    const text = String(c.visualStyle).trim().slice(0, 4000);
    c.visualStyles = [{
      ...emptyVisualStyle(),
      id: shortId('vs_', 'visual|' + text),
      name: '通用视觉规范',
      guidelines: text
    }];
  }
  c.visualStyle = '';
  c.visualStyles = c.visualStyles.map((v, i) => ({
    ...emptyVisualStyle(),
    id: String(v.id || shortId('vs_', 'visual' + i + '|' + String(v.name || ''))),
    name: String(v.name || '').slice(0, 60),
    guidelines: String(v.guidelines || '').slice(0, 4000),
    primaryColor: normColor(v.primaryColor),
    secondaryColor: normColor(v.secondaryColor),
    referenceIds: strList(v.referenceIds, 4, 60),
    logoIds: strList(v.logoIds, 4, 60)
  })).filter((v) => v.name);

  if (!Array.isArray(c.brandVoices)) c.brandVoices = [];
  c.brandVoices = c.brandVoices.map((v, i) => ({
    // 没有 id 的（老数据）按位置生成，保证同一份数据每次算出同一个 id
    id: String(v.id || 'bv_' + crypto.createHash('sha1').update('voice' + i + '|' + String(v.name || '')).digest('hex').slice(0, 8)),
    name: String(v.name || '').slice(0, 60),
    description: String(v.description || '').slice(0, 2000),
    useCase: String(v.useCase || 'general').slice(0, 40),
    excerpts: (Array.isArray(v.excerpts) ? v.excerpts : []).map((x) => String(x || '').slice(0, 500)).filter(Boolean).slice(0, 10)
  })).filter((v) => v.name);
  return c;
}

/**
 * agent / 提示词用的统一出口：不管字段是新的还是老的，都从这儿取。
 * 这样 prompt 里不会出现"同一件事两种写法"。
 */
function brief(company) {
  const c = company || {};
  const voices = (c.brandVoices || []).filter((v) => String(v.name || '').trim());
  const voiceLine = voices.map((v) => v.name + (v.description ? '（' + v.description.split('\n')[0].slice(0, 80) + '）' : '')).join('；')
    || String(c.tone || '');

  // 自定义说明是新的统一入口；老数据（差异化卖点 / 可引用事实）还能当兜底，
  // 但两者都在时只用自定义说明，避免同一句话在 prompt 里出现两遍
  const legacyFacts = [
    ...(c.differentiators || []).filter((x) => String(x || '').trim()).map((x) => '- ' + String(x).trim()),
    ...(c.proofPoints || []).filter((x) => String(x || '').trim()).map((x) => '- ' + String(x).trim())
  ].join('\n');
  const custom = String(c.customInstructions || '').trim();
  const facts = custom || legacyFacts;

  // 卖点：优先从自定义说明的「差异化卖点：」小节里抠，抠不到再用老字段
  const diffBlock = /差异化卖点：([\s\S]*?)(\n\s*\n|$)/.exec(custom);
  const sellingPoints = diffBlock
    ? diffBlock[1].split('\n').map((x) => x.replace(/^[-*\s]+/, '').trim()).filter(Boolean)
    : (c.differentiators || []).map(String).filter(Boolean);
  return {
    name: String(c.name || '').trim(),
    website: String(c.website || '').trim(),
    description: String(c.description || c.oneLiner || '').trim(),
    audiences: audienceLines(c),
    audiencesRaw: c.audiences || [],
    competitors: (c.competitors || []).map(String).filter(Boolean),
    contentPillars: (c.contentPillars || []).map((x) => String((x && x.name) || '')).filter(Boolean),
    pillarsRaw: c.contentPillars || [],
    languages: (c.languages || []).map(String).filter(Boolean),
    voice: voiceLine,
    // 老的单段文字已经进了 writingStyles 的 notes，这里统一输出结构化后的描述
    writingStyle: writingStyleLines(c).join('；') || String(c.writingStyle || '').trim(),
    writingStyles: writingStyleLines(c),
    writingStylesRaw: c.writingStyles || [],
    visualStyle: visualStyleLines(c).join('；') || String(c.visualStyle || '').trim(),
    visualStyles: visualStyleLines(c),
    visualStylesRaw: c.visualStyles || [],
    facts,
    sellingPoints,
    customInstructions: custom
  };
}

function emptyTool(a) {
  return {
    id: a.id,
    name: a.name,
    category: a.category,
    mono: a.mono,
    color: a.color,
    tint: a.tint,
    desc: a.desc,
    custom: false,
    installed: false,
    connected: false,
    account: '',
    token: '',
    url: '',
    data: '',
    connectedAt: null,
    installedAt: null
  };
}

function emptyDb() {
  return {
    version: 3,
    company: emptyCompany(),
    gsc: { connected: false, site: '', note: '', raw: '', importedAt: null, connectedAt: null, source: '' },
    tools: APP_CATALOG.map(emptyTool),
    files: [],
    images: [],
    updatedAt: null
  };
}

function load() {
  const j = store.readJson(FILE, null);
  if (!j) return emptyDb();
  const db = { ...emptyDb(), ...j };
  db.company = { ...emptyCompany(), ...(j.company || {}) };
  for (const k of LIST_KEYS) if (!Array.isArray(db.company[k])) db.company[k] = [];
  const beforeMigrate = JSON.stringify(db.company);
  migrateCompany(db.company);
  const migrated = JSON.stringify(db.company) !== beforeMigrate;
  db.gsc = { ...emptyDb().gsc, ...(j.gsc || {}) };

  // 应用：目录为骨架（新增的应用自动出现），合并已存的安装/授权状态；自定义应用保序追加
  const saved = Array.isArray(j.tools) ? j.tools : [];
  const builtin = APP_CATALOG.map((a) => {
    const s = saved.find((x) => x && x.id === a.id) || {};
    return {
      ...emptyTool(a),
      installed: !!s.installed,
      connected: !!s.connected,
      account: String(s.account || ''),
      token: String(s.token || ''),
      data: String(s.data || ''),
      connectedAt: s.connectedAt || null,
      installedAt: s.installedAt || null
    };
  });
  const custom = saved
    .filter((x) => x && x.custom && x.id && !BY_ID.has(x.id))
    .map((x) => ({
      id: String(x.id),
      name: String(x.name || '自定义应用').slice(0, 60),
      category: '自定义',
      mono: String(x.mono || (x.name || 'A').slice(0, 2)).slice(0, 2),
      color: '#334155',
      tint: '#e2e8f0',
      desc: String(x.desc || x.description || '').slice(0, 200),
      custom: true,
      installed: true,
      connected: !!x.connected,
      account: String(x.account || '').slice(0, 200),
      token: String(x.token || '').slice(0, 500),
      url: String(x.url || '').slice(0, 300),
      data: String(x.data || '').slice(0, 20000),
      connectedAt: x.connectedAt || null,
      installedAt: x.installedAt || null
    }));
  db.tools = [...builtin, ...custom];
  db.files = Array.isArray(j.files) ? j.files : [];
  db.images = Array.isArray(j.images) ? j.images : [];
  // 老数据迁移一次就写回磁盘，免得每次 load 都在内存里重算（id 也会漂）
  if (migrated) store.writeJson(FILE, db);
  return db;
}

function save(db) {
  db.updatedAt = new Date().toISOString();
  return store.writeJson(FILE, db);
}

function ensureFileDir() {
  if (!fs.existsSync(FILE_DIR)) fs.mkdirSync(FILE_DIR, { recursive: true });
}

function filePath(id) {
  return path.join(FILE_DIR, id + '.txt');
}

/** 只接受纯文本类文件；二进制（pdf/docx）如实拒绝，不假装能解析 */
const TEXT_EXT = ['.txt', '.md', '.markdown', '.csv', '.json', '.html', '.yml', '.yaml', '.log', '.tsv'];

function addFile(db, name, text) {
  const ext = path.extname(String(name || '')).toLowerCase();
  if (!TEXT_EXT.includes(ext)) {
    throw Object.assign(new Error(`只支持纯文本类文件（${TEXT_EXT.join(' / ')}）。${ext || '无扩展名'} 现在解析不了，请先导出成 .md 或 .txt。`), { status: 400 });
  }
  const body = String(text || '');
  if (!body.trim()) throw Object.assign(new Error('文件内容为空'), { status: 400 });
  if (body.length > MAX_FILE_CHARS) {
    throw Object.assign(new Error(`文件太大（${body.length} 字符），上限 ${MAX_FILE_CHARS}`), { status: 413 });
  }
  ensureFileDir();
  const id = 'kf_' + crypto.randomBytes(6).toString('hex');
  fs.writeFileSync(filePath(id), body, 'utf8');
  const rec = { id, name: name || id + ext, ext, chars: body.length, uploadedAt: new Date().toISOString() };
  db.files.unshift(rec);
  return rec;
}

function removeFile(db, id) {
  const before = db.files.length;
  db.files = db.files.filter((f) => f.id !== id);
  try { fs.unlinkSync(filePath(id)); } catch (_) { /* 文件可能已不在 */ }
  return db.files.length < before;
}

function readFiles(db) {
  ensureFileDir();
  const out = {};
  for (const f of db.files) {
    try { out[f.id] = fs.readFileSync(filePath(f.id), 'utf8'); } catch (_) { out[f.id] = ''; }
  }
  return out;
}

function readOne(id) {
  try { return fs.readFileSync(filePath(id), 'utf8'); } catch (_) { return ''; }
}

const filled = (v) => (Array.isArray(v) ? v.filter((x) => String(x || '').trim()).length > 0 : !!String(v || '').trim());

/** 有的块不是 company 字段（GSC / 文件），所以要整个 db 才判得出来 */
function isDone(db, key) {
  const c = db.company || {};
  if (key === 'gsc') return !!(db.gsc && db.gsc.connected);
  if (key === 'files') return (db.files || []).length > 0;
  if (key === 'brandVoices') return (c.brandVoices || []).some((v) => String(v.name || '').trim());
  if (key === 'audiences') return (c.audiences || []).some((a) => String((a && a.name) || '').trim());
  if (key === 'contentPillars') return (c.contentPillars || []).some((x) => String((x && x.name) || '').trim());
  if (key === 'writingStyle') return (c.writingStyles || []).some((w) => String((w && w.name) || '').trim());
  if (key === 'visualStyle') return (c.visualStyles || []).some((v) => String((v && v.name) || '').trim());
  return filled(c[key]);
}

/** setup 清单的完成情况（Dashboard 卡片进度、Strategy 的 Overview 共用） */
function blocks(input) {
  const db = input && input.company ? input : { company: input || {}, gsc: null, files: [] };
  const items = BLOCKS.map((b) => ({ key: b.key, label: b.label, tab: b.tab, hint: b.hint, done: isDone(db, b.key) }));
  const done = items.filter((i) => i.done).length;
  return {
    done,
    total: items.length,
    items,
    missing: items.filter((i) => !i.done).map((i) => i.label),
    percent: Math.round((done / items.length) * 100)
  };
}

/** 完整度：就是上面的 blocks，保留 pct 方便显示百分比 */
function completeness(input) {
  const b = blocks(input);
  return { done: b.done, total: b.total, pct: b.percent, missing: b.missing };
}

/* ==================== 品牌语气（Brand voices） ==================== */

const USE_CASES = [
  { id: 'general', label: 'General' },
  { id: 'blog', label: 'Blog posts' },
  { id: 'social', label: 'Social media' },
  { id: 'email', label: 'Email' },
  { id: 'landing', label: 'Landing pages' }
];

function addVoice(db, input) {
  const name = String((input && input.name) || '').trim();
  if (!name) throw Object.assign(new Error('Brand voice 名字不能为空，比如「直接、具体、不吹」'), { status: 400 });
  const v = {
    id: 'bv_' + crypto.randomBytes(4).toString('hex'),
    name: name.slice(0, 60),
    description: String((input && input.description) || '').slice(0, 2000),
    useCase: String((input && input.useCase) || 'general').slice(0, 40),
    excerpts: (Array.isArray(input && input.excerpts) ? input.excerpts : [])
      .map((x) => String(x || '').trim()).filter(Boolean).slice(0, 10)
  };
  db.company.brandVoices.push(v);
  return v;
}

function updateVoice(db, id, input) {
  const v = (db.company.brandVoices || []).find((x) => x.id === id);
  if (!v) throw Object.assign(new Error('没有这条 brand voice: ' + id), { status: 404 });
  if (input && input.name !== undefined) {
    const name = String(input.name).trim();
    if (!name) throw Object.assign(new Error('Brand voice 名字不能为空'), { status: 400 });
    v.name = name.slice(0, 60);
  }
  if (input && input.description !== undefined) v.description = String(input.description).slice(0, 2000);
  if (input && input.useCase !== undefined) v.useCase = String(input.useCase).slice(0, 40);
  if (input && input.excerpts !== undefined) {
    v.excerpts = (Array.isArray(input.excerpts) ? input.excerpts : [])
      .map((x) => String(x || '').trim()).filter(Boolean).slice(0, 10);
  }
  return v;
}

function removeVoice(db, id) {
  const before = (db.company.brandVoices || []).length;
  db.company.brandVoices = (db.company.brandVoices || []).filter((x) => x.id !== id);
  return db.company.brandVoices.length < before;
}

/* ==================== 目标受众（Target audiences） ==================== */

/** 给 prompt 用的一句话描述：名字 + 说明 + 画像 + 目标/痛点 */
function audienceLines(company) {
  const c = company || {};
  return (c.audiences || []).filter((a) => String((a && a.name) || '').trim()).map((a) => {
    const bits = [];
    if (String(a.description || '').trim()) bits.push(String(a.description).trim());
    if (a.industries && a.industries.length) bits.push('行业：' + a.industries.join('、'));
    if (a.jobTitles && a.jobTitles.length) bits.push('职位：' + a.jobTitles.join('、'));
    if (a.companySize) bits.push('公司规模：' + a.companySize);
    if (a.goals && a.goals.length) bits.push('目标：' + a.goals.join('；'));
    if (a.painPoints && a.painPoints.length) bits.push('痛点：' + a.painPoints.join('；'));
    return a.name + (bits.length ? ' —— ' + bits.join('；') : '');
  });
}

function pickAudienceFields(target, input) {
  const i = input || {};
  if (i.name !== undefined) {
    const name = String(i.name).trim();
    if (!name) throw Object.assign(new Error('Audience name 不能为空，比如「Growth marketers at Series B SaaS」'), { status: 400 });
    target.name = name.slice(0, 60);
  }
  if (i.description !== undefined) target.description = String(i.description).slice(0, 2000);
  if (i.industries !== undefined) target.industries = strList(i.industries, 20, 120);
  if (i.jobTitles !== undefined) target.jobTitles = strList(i.jobTitles, 20, 120);
  if (i.companySize !== undefined) target.companySize = String(i.companySize || '').slice(0, 60);
  if (i.goals !== undefined) target.goals = strList(i.goals, 20, 200);
  if (i.painPoints !== undefined) target.painPoints = strList(i.painPoints, 20, 200);
  return target;
}

function addAudience(db, input) {
  if (!String((input && input.name) || '').trim()) {
    throw Object.assign(new Error('Audience name 不能为空，比如「Growth marketers at Series B SaaS」'), { status: 400 });
  }
  const a = pickAudienceFields({ ...emptyAudience(), id: 'ta_' + crypto.randomBytes(4).toString('hex') }, input);
  db.company.audiences.push(a);
  return a;
}

function updateAudience(db, id, input) {
  const a = (db.company.audiences || []).find((x) => x.id === id);
  if (!a) throw Object.assign(new Error('没有这个受众: ' + id), { status: 404 });
  return pickAudienceFields(a, input);
}

/** 删受众时，顺便把引用它的 pillar 解绑，避免留下死 id */
function removeAudience(db, id) {
  const before = (db.company.audiences || []).length;
  db.company.audiences = (db.company.audiences || []).filter((x) => x.id !== id);
  for (const cp of db.company.contentPillars || []) {
    cp.audienceIds = (cp.audienceIds || []).filter((x) => x !== id);
  }
  return db.company.audiences.length < before;
}

/* ==================== 内容支柱（Content pillars） ==================== */

/** 给 prompt 用：名字 + 说明 + 搜索问题 + 该写/不该写 + 核心信息 */
function pillarLines(company) {
  const c = company || {};
  const byId = new Map((c.audiences || []).map((a) => [a.id, a.name]));
  return (c.contentPillars || []).filter((x) => String((x && x.name) || '').trim()).map((x) => {
    const bits = [];
    if (String(x.description || '').trim()) bits.push(String(x.description).trim());
    const auds = (x.audienceIds || []).map((id) => byId.get(id)).filter(Boolean);
    if (auds.length) bits.push('面向：' + auds.join('、'));
    if (x.searchQuestions && x.searchQuestions.length) bits.push('要回答的搜索问题：' + x.searchQuestions.join('；'));
    if (x.topicsInclude && x.topicsInclude.length) bits.push('要覆盖：' + x.topicsInclude.join('、'));
    if (x.topicsAvoid && x.topicsAvoid.length) bits.push('要避开：' + x.topicsAvoid.join('、'));
    if (x.coreMessages && x.coreMessages.length) bits.push('核心信息：' + x.coreMessages.join('；'));
    return x.name + (bits.length ? ' —— ' + bits.join('；') : '');
  });
}

function pickPillarFields(target, input) {
  const i = input || {};
  if (i.name !== undefined) {
    const name = String(i.name).trim();
    if (!name) throw Object.assign(new Error('Pillar name 不能为空，比如「Technical SEO」'), { status: 400 });
    target.name = name.slice(0, 60);
  }
  if (i.description !== undefined) target.description = String(i.description).slice(0, 2000);
  if (i.audienceIds !== undefined) target.audienceIds = strList(i.audienceIds, 30, 60);
  if (i.searchQuestions !== undefined) target.searchQuestions = strList(i.searchQuestions, 20, 200);
  if (i.topicsInclude !== undefined) target.topicsInclude = strList(i.topicsInclude, 20, 160);
  if (i.topicsAvoid !== undefined) target.topicsAvoid = strList(i.topicsAvoid, 20, 160);
  if (i.coreMessages !== undefined) target.coreMessages = strList(i.coreMessages, 20, 200);
  return target;
}

function addPillar(db, input) {
  if (!String((input && input.name) || '').trim()) {
    throw Object.assign(new Error('Pillar name 不能为空，比如「Technical SEO」'), { status: 400 });
  }
  const x = pickPillarFields({ ...emptyPillar(), id: 'cp_' + crypto.randomBytes(4).toString('hex') }, input);
  db.company.contentPillars.push(x);
  return x;
}

function updatePillar(db, id, input) {
  const x = (db.company.contentPillars || []).find((p2) => p2.id === id);
  if (!x) throw Object.assign(new Error('没有这个内容支柱: ' + id), { status: 404 });
  return pickPillarFields(x, input);
}

function removePillar(db, id) {
  const before = (db.company.contentPillars || []).length;
  db.company.contentPillars = (db.company.contentPillars || []).filter((x) => x.id !== id);
  return db.company.contentPillars.length < before;
}

/* ==================== 写作规范（Writing styles） ==================== */

/** 给 prompt 用：名字 + 开着的规则 + 备注 */
function writingStyleLines(company) {
  const c = company || {};
  return (c.writingStyles || []).filter((w) => String((w && w.name) || '').trim()).map((w) => {
    const bits = writingPhrases(w);
    if (String(w.notes || '').trim()) bits.push('备注：' + String(w.notes).trim());
    return w.name + (bits.length ? ' —— ' + bits.join('；') : '');
  });
}

function pickWritingStyleFields(target, input) {
  const i = input || {};
  const t = target;
  if (i.name !== undefined) {
    const name = String(i.name).trim();
    if (!name) throw Object.assign(new Error('Writing style name 不能为空，比如「Blog articles」'), { status: 400 });
    t.name = name.slice(0, 60);
  }
  if (i.notes !== undefined) t.notes = String(i.notes).slice(0, 2000);
  for (const g of WRITING_GROUPS) {
    for (const r of g.rules) {
      if (i[r.key] === undefined) continue;
      if (r.type === 'switch') t[r.key] = !!i[r.key];
      else t[r.key] = r.options.some((o) => o.id === i[r.key]) ? i[r.key] : 'none';
    }
  }
  return t;
}

function addWritingStyle(db, input) {
  if (!String((input && input.name) || '').trim()) {
    throw Object.assign(new Error('Writing style name 不能为空，比如「Blog articles」'), { status: 400 });
  }
  const w = pickWritingStyleFields({ ...emptyWritingStyle(), id: 'ws_' + crypto.randomBytes(4).toString('hex') }, input);
  db.company.writingStyles.push(w);
  return w;
}

function updateWritingStyle(db, id, input) {
  const w = (db.company.writingStyles || []).find((x) => x.id === id);
  if (!w) throw Object.assign(new Error('没有这条写作规范: ' + id), { status: 404 });
  return pickWritingStyleFields(w, input);
}

function removeWritingStyle(db, id) {
  const before = (db.company.writingStyles || []).length;
  db.company.writingStyles = (db.company.writingStyles || []).filter((x) => x.id !== id);
  return db.company.writingStyles.length < before;
}

/* ==================== 视觉风格（Visual styles） ==================== */

/** #RGB / #RRGGBB / 空都接受，其他一律丢掉（不猜用户想写什么） */
function normColor(v) {
  const t = String(v || '').trim();
  if (!t) return '';
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(t) ? t.toLowerCase() : '';
}

const MAX_PER_GROUP = 4;

/** 给 prompt 用：名字 + Guidelines + 配色 + 参考图 / Logo 张数 */
function visualStyleLines(company) {
  const c = company || {};
  return (c.visualStyles || []).filter((v) => String((v && v.name) || '').trim()).map((v) => {
    const bits = [];
    if (String(v.guidelines || '').trim()) bits.push(String(v.guidelines).trim());
    const colors = [v.primaryColor, v.secondaryColor].filter(Boolean);
    if (colors.length) bits.push('配色：' + colors.join(' / '));
    const refs = (v.referenceIds || []).length;
    const logos = (v.logoIds || []).length;
    if (refs) bits.push(refs + ' 张风格参考图');
    if (logos) bits.push(logos + ' 个 Logo');
    return v.name + (bits.length ? ' —— ' + bits.join('；') : '');
  });
}

function pickVisualStyleFields(target, input) {
  const i = input || {};
  if (i.name !== undefined) {
    const name = String(i.name).trim();
    if (!name) throw Object.assign(new Error('Visual style name 不能为空，比如「Social visuals」'), { status: 400 });
    target.name = name.slice(0, 60);
  }
  if (i.guidelines !== undefined) target.guidelines = String(i.guidelines).slice(0, 4000);
  if (i.primaryColor !== undefined) target.primaryColor = normColor(i.primaryColor);
  if (i.secondaryColor !== undefined) target.secondaryColor = normColor(i.secondaryColor);
  if (i.referenceIds !== undefined) target.referenceIds = strList(i.referenceIds, MAX_PER_GROUP, 60);
  if (i.logoIds !== undefined) target.logoIds = strList(i.logoIds, MAX_PER_GROUP, 60);
  return target;
}

function addVisualStyle(db, input) {
  if (!String((input && input.name) || '').trim()) {
    throw Object.assign(new Error('Visual style name 不能为空，比如「Social visuals」'), { status: 400 });
  }
  const v = pickVisualStyleFields({ ...emptyVisualStyle(), id: 'vs_' + crypto.randomBytes(4).toString('hex') }, input);
  db.company.visualStyles.push(v);
  return v;
}

function updateVisualStyle(db, id, input) {
  const v = (db.company.visualStyles || []).find((x) => x.id === id);
  if (!v) throw Object.assign(new Error('没有这条视觉风格: ' + id), { status: 404 });
  return pickVisualStyleFields(v, input);
}

function removeVisualStyle(db, id) {
  const before = (db.company.visualStyles || []).length;
  db.company.visualStyles = (db.company.visualStyles || []).filter((x) => x.id !== id);
  return db.company.visualStyles.length < before;
}

/* ==================== 图片库（风格参考图 / Logo） ==================== */

const IMAGE_EXT = ['.jpeg', '.jpg', '.png', '.svg'];
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

function ensureImgDir() {
  if (!fs.existsSync(IMG_DIR)) fs.mkdirSync(IMG_DIR, { recursive: true });
}

/**
 * 存一张图：前端传 data URL（data:image/png;base64,xxx）。
 * 只认 jpeg/jpg/png/svg —— 和 StoryChief 的上传限制一致。
 */
function addImage(db, name, dataUrl) {
  if (!Array.isArray(db.images)) db.images = [];
  const raw = String(dataUrl || '');
  const m = /^data:image\/([a-z0-9.+-]+);base64,([\s\S]*)$/i.exec(raw);
  if (!m) throw Object.assign(new Error('图片格式不对：需要 data:image/...;base64 形式'), { status: 400 });
  const ext = '.' + m[1].toLowerCase();
  if (!IMAGE_EXT.includes(ext)) {
    throw Object.assign(new Error('只支持 jpeg / jpg / png / svg'), { status: 400 });
  }
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length) throw Object.assign(new Error('图片是空的'), { status: 400 });
  if (buf.length > MAX_IMAGE_BYTES) {
    throw Object.assign(new Error('图片太大（' + Math.round(buf.length / 1024) + 'KB），上限 4MB'), { status: 413 });
  }
  ensureImgDir();
  const id = 'img_' + crypto.randomBytes(6).toString('hex');
  fs.writeFileSync(path.join(IMG_DIR, id + ext), buf);
  const rec = {
    id, ext,
    name: String(name || 'image' + ext).slice(0, 160),
    bytes: buf.length,
    uploadedAt: new Date().toISOString()
  };
  db.images.unshift(rec);
  return rec;
}

function imageById(id) {
  const db = load();
  return (db.images || []).find((x) => x.id === id) || null;
}

function removeImage(db, id) {
  const before = (db.images || []).length;
  const rec = (db.images || []).find((x) => x.id === id);
  db.images = (db.images || []).filter((x) => x.id !== id);
  if (rec) { try { fs.unlinkSync(path.join(IMG_DIR, id + rec.ext)); } catch (_) { /* 文件可能已不在 */ } }
  // 引用它的视觉风格里也要摘掉，避免留下死 id
  for (const v of db.company.visualStyles || []) {
    v.referenceIds = (v.referenceIds || []).filter((x) => x !== id);
    v.logoIds = (v.logoIds || []).filter((x) => x !== id);
  }
  return (db.images || []).length < before;
}

/** db 可传可不传：传了就不用再 load 一次（刚写完磁盘时更可靠） */
function readImage(id, db) {
  const src = db || load();
  const rec = (src.images || []).find((x) => x.id === id);
  if (!rec) return null;
  try {
    return { buf: fs.readFileSync(path.join(IMG_DIR, id + rec.ext)), ext: rec.ext, rec };
  } catch (_) { return null; }
}

/* ==================== 文件检索（RAG 用） ==================== */

/** 名字或正文命中都算；返回命中处前后的一小段，前端直接显示 */
function searchFiles(db, q) {
  const needle = String(q || '').trim().toLowerCase();
  if (!needle) return [];
  const out = [];
  for (const f of db.files || []) {
    const text = readOne(f.id) || '';
    const inName = String(f.name || '').toLowerCase().includes(needle);
    const at = text.toLowerCase().indexOf(needle);
    if (!inName && at < 0) continue;
    const from = Math.max(0, (at < 0 ? 0 : at) - 60);
    const snippet = text.slice(from, from + 200).replace(/\s+/g, ' ').trim();
    out.push({ id: f.id, name: f.name, chars: f.chars, snippet });
  }
  return out;
}

/* ==================== 应用：安装 / 授权 / 断开 ==================== */

function getTool(db, id) {
  return db.tools.find((x) => x.id === id) || null;
}

function installTool(db, id) {
  const t = getTool(db, id);
  if (!t) throw Object.assign(new Error('未知应用: ' + id), { status: 404 });
  t.installed = true;
  t.installedAt = t.installedAt || new Date().toISOString();
  return t;
}

function uninstallTool(db, id) {
  const t = getTool(db, id);
  if (!t) throw Object.assign(new Error('未知应用: ' + id), { status: 404 });
  if (t.custom) {
    db.tools = db.tools.filter((x) => x.id !== id);
    return null;
  }
  t.installed = false;
  t.connected = false;
  t.account = '';
  t.token = '';
  t.data = '';
  t.connectedAt = null;
  t.installedAt = null;
  return t;
}

/**
 * 授权：本地版只把凭据存在本机（data/knowledge.json），
 * 不代替你完成各家 OAuth —— 那需要逐个应用登记开发者应用，属于商务/审核，不做假的。
 */
function authorizeTool(db, id, input) {
  const t = getTool(db, id);
  if (!t) throw Object.assign(new Error('未知应用: ' + id), { status: 404 });
  const token = String((input && input.token) || '').trim();
  const account = String((input && input.account) || '').trim();
  if (!token && !(input && input.skipToken)) {
    throw Object.assign(new Error('请填 API key / 访问令牌，或选择"先只登记账号"'), { status: 400 });
  }
  t.installed = true;
  t.installedAt = t.installedAt || new Date().toISOString();
  t.connected = true;
  t.connectedAt = new Date().toISOString();
  t.account = account.slice(0, 200);
  if (token) t.token = token.slice(0, 500);
  if (input && input.data !== undefined) t.data = String(input.data).slice(0, 20000);
  return t;
}

function disconnectTool(db, id) {
  const t = getTool(db, id);
  if (!t) throw Object.assign(new Error('未知应用: ' + id), { status: 404 });
  t.connected = false;
  t.connectedAt = null;
  t.token = '';
  return t;
}

function setToolData(db, id, data) {
  const t = getTool(db, id);
  if (!t) throw Object.assign(new Error('未知应用: ' + id), { status: 404 });
  t.data = String(data || '').slice(0, 20000);
  return t;
}

function addTool(db, input) {
  const name = String((input && input.name) || '').trim();
  if (!name) throw Object.assign(new Error('应用名不能为空'), { status: 400 });
  const id = 'pl_' + crypto.randomBytes(5).toString('hex');
  const rec = {
    id,
    name: name.slice(0, 60),
    category: '自定义',
    mono: name.slice(0, 2),
    color: '#334155',
    tint: '#e2e8f0',
    desc: String((input && input.desc) || input && input.description || '').trim().slice(0, 200),
    custom: true,
    installed: true,
    connected: false,
    account: '',
    token: '',
    url: String((input && input.url) || '').trim().slice(0, 300),
    data: '',
    connectedAt: null,
    installedAt: new Date().toISOString()
  };
  db.tools.push(rec);
  return rec;
}

function removeTool(db, id) {
  return uninstallTool(db, id);
}

const maskToken = (t) => (t ? '••••' + String(t).slice(-4) : '');

function publicView(db) {
  const d = db || load();
  const b = blocks(d);
  const raw = String(d.gsc.raw || '');
  return {
    company: d.company,
    // 前端 Company size 的 datalist 用（也允许自己输入）
    companySizes: COMPANY_SIZES,
    // 前端 Writing style 弹窗靠它渲染开关/下拉（规则只写一份，前后端共用）
    writingRules: WRITING_GROUPS,
    // 原始导出可能几十万字符，publicView 里只给状态；要看全文走 /api/strategy
    gsc: { ...d.gsc, raw: undefined, rawChars: raw.length, hasRaw: !!raw.trim() },
    tools: d.tools.map((t) => ({
      id: t.id,
      name: t.name,
      category: t.category,
      mono: t.mono,
      color: t.color,
      tint: t.tint,
      desc: t.desc,
      custom: !!t.custom,
      url: t.url || '',
      installed: !!t.installed,
      connected: !!t.connected,
      account: t.account || '',
      hasToken: !!t.token,
      keyHint: maskToken(t.token),
      connectedAt: t.connectedAt || null,
      installedAt: t.installedAt || null,
      hasData: !!(t.data || '').trim(),
      dataChars: (t.data || '').length
    })),
    files: d.files,
    images: (d.images || []).map((i) => ({
      id: i.id, name: i.name, ext: i.ext, bytes: i.bytes, uploadedAt: i.uploadedAt,
      url: '/api/knowledge/images/' + i.id
    })),
    blocks: b,
    completeness: completeness(d),
    brief: brief(d.company),
    updatedAt: d.updatedAt
  };
}

module.exports = {
  load, save, publicDb: publicView, publicView,
  addFile, removeFile, readFiles, readOne,
  blocks, completeness,
  getTool, installTool, uninstallTool, authorizeTool, disconnectTool, setToolData,
  addTool, removeTool,
  addVoice, updateVoice, removeVoice, emptyVoice, brief, migrateCompany,
  emptyAudience, emptyPillar, addAudience, updateAudience, removeAudience, audienceLines,
  addPillar, updatePillar, removePillar, pillarLines,
  emptyWritingStyle, addWritingStyle, updateWritingStyle, removeWritingStyle, writingStyleLines,
  emptyVisualStyle, addVisualStyle, updateVisualStyle, removeVisualStyle, visualStyleLines,
  addImage, removeImage, readImage, imageById, searchFiles, normColor,
  IMAGE_EXT, MAX_IMAGE_BYTES, MAX_PER_GROUP,
  WRITING_GROUPS, QUOTE_STYLES, HEADING_CASES,
  APP_CATALOG, BLOCKS, USE_CASES, COMPANY_SIZES, TEXT_KEYS, LIST_KEYS, TEXT_EXT, MAX_FILE_CHARS
};
