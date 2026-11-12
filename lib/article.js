'use strict';
/**
 * lib/article.js —— 文章编辑器的数据与打分
 *
 * 两件事：
 *   1) 文章元信息（封面 / 摘要 / SEO 标题 / slug / meta 描述 / 自定义字段 / 目标关键词）
 *      存在 content.json 的那条 item 上，挂在 `item.article` 下面。
 *      为什么不新开文件：这条 item 就是列表里的一行，元信息跟着它走，
 *      删条目 = 删元信息，不会留孤儿。
 *   2) 打分。全部是**本地确定性规则**，不调用任何外部服务：
 *      - GEO & SEO basics：12 项硬检查，通过率就是分数
 *      - Readability & structure：句均词数 + 长词比例
 *      - Content gap insights：和 Company Knowledge 里的 content pillars / audiences 对照
 *      - Plagiarism：**没有接入查重服务**，这里返回 available:false，不编分数
 *
 * 分数的口径写在 README「文章编辑器」一节，改公式请一起改。
 */

const knowledge = require('./knowledge');

const ME = 'me';

/* ------------------------------------------------------------------ */
/* 元信息                                                              */
/* ------------------------------------------------------------------ */

const TEXT_FIELDS = ['coverImage', 'excerpt', 'seoTitle', 'slug', 'metaDescription', 'focusKeyword', 'searchRegion', 'searchLocale'];
const CUSTOM_KEYS = ['icp', 'kpi', 'footerLink'];

const REGIONS = [
  { id: 'google.com', label: 'google.com', locale: 'en' },
  { id: 'google.de', label: 'google.de', locale: 'de' },
  { id: 'google.co.uk', label: 'google.co.uk', locale: 'en-GB' },
  { id: 'google.co.jp', label: 'google.co.jp', locale: 'ja' },
  { id: 'google.com.hk', label: 'google.com.hk', locale: 'zh-HK' },
  { id: 'google.com.tw', label: 'google.com.tw', locale: 'zh-TW' },
  { id: 'google.com.sg', label: 'google.com.sg', locale: 'en-SG' }
];

const LOCALES = [
  { id: 'en', label: 'English' },
  { id: 'zh-CN', label: '简体中文' },
  { id: 'zh-TW', label: '繁體中文' },
  { id: 'ja', label: '日本語' },
  { id: 'de', label: 'Deutsch' },
  { id: 'en-GB', label: 'English (UK)' },
  { id: 'en-SG', label: 'English (SG)' }
];

function emptyMeta() {
  return {
    coverImage: '',
    excerpt: '',
    seoTitle: '',
    slug: '',
    metaDescription: '',
    focusKeyword: '',
    searchRegion: 'google.com',
    searchLocale: 'en',
    custom: { icp: '', kpi: '', footerLink: '' },
    savedAt: ''
  };
}

function str(v, max) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max || 400);
}

/** item.article 的规范化（只补缺，不覆盖用户写的） */
function meta(item) {
  const src = (item && item.article) || {};
  const out = emptyMeta();
  TEXT_FIELDS.forEach((k) => { out[k] = str(src[k], k === 'metaDescription' ? 320 : 300); });
  out.custom = { ...out.custom, ...(src.custom || {}) };
  CUSTOM_KEYS.forEach((k) => { out.custom[k] = str(out.custom[k], 200); });
  if (!LOCALES.some((l) => l.id === out.searchLocale)) out.searchLocale = 'en';
  if (!REGIONS.some((r) => r.id === out.searchRegion)) out.searchRegion = 'google.com';
  out.savedAt = src.savedAt || '';
  return out;
}

/** 就地规范化（store 读出来就补齐，避免前端到处判空） */
function normalizeItem(item) {
  if (!item) return item;
  item.article = meta(item);
  return item;
}

/**
 * url 友好的 slug：只留 ascii 字母数字和连字符。
 * 中文标题没法转写（不编拼音），保留其中的英文词；一个英文词都没有就用 article-<id尾6>。
 */
function slugify(title, fallbackId) {
  const raw = String(title || '')
    .toLowerCase()
    .replace(/['"’]/g, '')
    .replace(/[\u4e00-\u9fa5]+/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 70)
    .replace(/-+$/g, '');
  if (raw.replace(/-/g, '').length >= 3) return raw;
  const tail = String(fallbackId || '').replace(/[^a-z0-9]/gi, '').slice(-6) || 'x';
  return 'article-' + tail;
}

/* ------------------------------------------------------------------ */
/* 文本度量                                                            */
/* ------------------------------------------------------------------ */

/** Markdown 源码 → 可见文字（打分只该看读者看得到的部分） */
function plain(body) {
  return String(body || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 词数：拉丁按空格切，中文按字算（一个汉字 ≈ 一个词） */
function wordCount(text) {
  const t = plain(text);
  if (!t) return 0;
  const cjk = (t.match(/[\u4e00-\u9fa5]/g) || []).length;
  const latin = t.replace(/[\u4e00-\u9fa5]/g, ' ').split(/\s+/).filter(Boolean);
  return cjk + latin.length;
}

function sentences(text) {
  const t = plain(text);
  if (!t) return [];
  return t.split(/(?<=[.!?。！？])\s*/).map((s) => s.trim()).filter((s) => s.length > 1);
}

function readingTime(words) {
  return Math.max(1, Math.round(words / 220));
}

/** 可读性：句均词数越短越好，长词（>6 字母）比例越低越好 */
function readability(body) {
  const words = wordCount(body);
  const ss = sentences(body);
  const avg = ss.length ? words / ss.length : 0;
  const latin = plain(body).split(/\s+/).filter((w) => /[a-zA-Z]/.test(w));
  const long = latin.filter((w) => w.replace(/[^a-zA-Z]/g, '').length > 6).length;
  const longPct = latin.length ? (long / latin.length) * 100 : 0;
  let pct = 100;
  if (avg > 20) pct -= Math.min(35, (avg - 20) * 5);
  if (avg > 25) pct -= 10;
  if (longPct > 20) pct -= Math.min(25, (longPct - 20) * 1.5);
  if (ss.length < 3 && words > 60) pct -= 10; // 一大段没有句号
  pct = Math.max(0, Math.min(100, Math.round(pct)));
  return {
    pct,
    words,
    sentences: ss.length,
    avgWords: Math.round(avg * 10) / 10,
    longPct: Math.round(longPct),
    label: pct >= 70 ? 'easy' : pct >= 40 ? 'ok' : 'hard'
  };
}

/* ------------------------------------------------------------------ */
/* 12 项硬检查 → GEO & SEO 分                                          */
/* ------------------------------------------------------------------ */

const META_MIN = 120;
const META_MAX = 160;
const SEOTITLE_MIN = 30;
const SEOTITLE_MAX = 60;
const MIN_WORDS = 300;

function hasKeyword(hay, kw) {
  if (!kw) return false;
  return String(hay || '').toLowerCase().includes(kw.toLowerCase());
}

function headings(body) {
  return (String(body || '').match(/^##\s+\S/gm) || []).length;
}

function links(body) {
  return (String(body || '').match(/\[[^\]]+\]\((https?:)?\/[^)]+\)/g) || []).length;
}

function images(body) {
  const all = [...String(body || '').matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)];
  return { total: all.length, withAlt: all.filter((m) => m[1].trim()).length };
}

/**
 * checks 的 target 决定点「show」跳到哪儿：
 *   settings → Settings › Article details / SEO settings 里对应的字段
 *   write    → 回 Write 面板（正文 / 关键词在右上角面板）
 */
function checksOf(item, body) {
  const m = meta(item);
  const text = plain(body);
  const words = wordCount(body);
  const intro = text.split(/\s+/).slice(0, 120).join(' ');
  const h2 = headings(body);
  const lk = links(body);
  const img = images(body);
  const kw = m.focusKeyword;

  const list = [
    {
      key: 'language', label: 'Language', critical: true,
      ok: !!(item && item.language && String(item.language).trim()),
      hint: '没设语言，搜索引擎不知道给哪个语区的人看',
      target: 'settings', field: 'language'
    },
    {
      key: 'keyword', label: 'Keyword length', critical: true,
      ok: kw.length >= 2,
      hint: '没填目标关键词，后面几项都无从判断',
      target: 'seo-panel', field: 'focusKeyword'
    },
    {
      key: 'keywordLength', label: 'Keyword is 1–6 words', critical: false,
      ok: kw.length >= 2 && kw.split(/\s+/).filter(Boolean).length <= 6,
      hint: '关键词太长（>6 词）会稀释主题，短一点更容易命中',
      target: 'seo-panel', field: 'focusKeyword'
    },
    {
      key: 'keywordInTitle', label: 'Keyword in title', critical: false,
      ok: hasKeyword(item && item.title, kw),
      hint: '标题里没有关键词；标题是权重最高的位置',
      target: 'write', field: 'title'
    },
    {
      key: 'keywordInIntro', label: 'Keyword in first 120 words', critical: false,
      ok: hasKeyword(intro, kw),
      hint: '正文开头 120 词里没出现关键词',
      target: 'write', field: 'body'
    },
    {
      key: 'textLength', label: 'Text length', critical: true,
      ok: words >= MIN_WORDS,
      hint: `现在 ${words} 词，建议 ≥${MIN_WORDS} 词`,
      target: 'write', field: 'body'
    },
    {
      key: 'metaDescription', label: 'Meta description length', critical: true,
      ok: m.metaDescription.length >= META_MIN && m.metaDescription.length <= META_MAX,
      hint: `${m.metaDescription.length} 字符，建议 ${META_MIN}–${META_MAX}`,
      target: 'settings', field: 'metaDescription'
    },
    {
      key: 'seoTitle', label: 'SEO title width', critical: true,
      ok: m.seoTitle.length >= SEOTITLE_MIN && m.seoTitle.length <= SEOTITLE_MAX,
      hint: `${m.seoTitle.length} 字符，建议 ${SEOTITLE_MIN}–${SEOTITLE_MAX}`,
      target: 'settings', field: 'seoTitle'
    },
    {
      key: 'slug', label: 'URL slug', critical: false,
      ok: !!m.slug && !/[\s\u4e00-\u9fa5]/.test(m.slug),
      hint: 'slug 没设或含空格/中文',
      target: 'settings', field: 'slug'
    },
    {
      key: 'headings', label: 'Subheadings', critical: false,
      ok: h2 >= 2,
      hint: `只有 ${h2} 个小标题，正文分层建议 ≥2 个 ##`,
      target: 'write', field: 'body'
    },
    {
      key: 'links', label: 'Outbound links', critical: false,
      ok: lk >= 1,
      hint: '没有任何链接；至少引一个来源或站内页面',
      target: 'write', field: 'body'
    },
    {
      key: 'imageAlt', label: 'Image + alt text', critical: false,
      ok: img.total > 0 && img.withAlt === img.total,
      hint: img.total === 0 ? '正文里没有图片' : `${img.total - img.withAlt} 张图缺 alt`,
      target: 'write', field: 'body'
    }
  ];

  return list.map((c) => ({
    key: c.key,
    label: c.label,
    state: c.ok ? 'pass' : 'fail',
    critical: c.critical,
    hint: c.hint,
    target: c.target,
    field: c.field
  }));
}

/* ------------------------------------------------------------------ */
/* Content gap：和 Company Knowledge 对照                              */
/* ------------------------------------------------------------------ */

function knowledgeCtx(kn) {
  const k = kn || knowledge.load();
  const c = k.company || {};
  return {
    website: c.website || '',
    companyName: c.name || '',
    audiences: (c.audiences || []).map((a) => ({ id: a.id, name: a.name })),
    pillars: (c.contentPillars || []).map((p) => ({
      id: p.id,
      name: p.name,
      topics: (p.topicsInclude || []).filter(Boolean)
    })),
    writingStyles: (c.writingStyles || []).map((w) => w.name).filter(Boolean),
    voiceNames: (c.brandVoices || []).map((v) => v.name).filter(Boolean),
    languages: (c.languages || []).slice(0, 12)
  };
}

/** 覆盖率 = 文章碰到的 pillar 主题 / 全部 pillar 主题 */
/**
 * 列表行显示的两个分数：和编辑器里 report() 是同一套算法，不另立口径。
 * 没有数据源时返回 null（列表显示 —），绝不补 0。
 */
function scoresOf(item, body, ctx) {
  const rep = report(item, body, ctx);
  return {
    geo: rep.seo ? rep.seo.pct : null,
    gap: rep.gap && rep.gap.available ? rep.gap.pct : null
  };
}

function contentGap(item, body, ctx) {
  const c = ctx || knowledgeCtx();
  const topics = [];
  c.pillars.forEach((p) => {
    (p.topics.length ? p.topics : [p.name]).forEach((t) => topics.push({ pillar: p.name, topic: t }));
  });
  if (!topics.length) {
    return { available: false, pct: null, covered: [], missing: [], note: 'Company Knowledge 里还没有内容支柱，没法判断缺口' };
  }
  const hay = [item && item.title, item && item.article && item.article.focusKeyword, body, (item && item.tags || []).join(' '), (item && item.keywords || []).join(' ')]
    .filter(Boolean).join(' ').toLowerCase();
  const covered = [];
  const missing = [];
  topics.forEach((t) => {
    (hay.includes(String(t.topic).toLowerCase()) ? covered : missing).push(t.topic);
  });
  const pct = Math.round((covered.length / topics.length) * 100);
  return {
    available: true,
    pct,
    covered: [...new Set(covered)].slice(0, 8),
    missing: [...new Set(missing)].slice(0, 8),
    note: `对照 ${c.pillars.length} 个内容支柱的 ${topics.length} 个主题`
  };
}

/* ------------------------------------------------------------------ */
/* 汇总报告                                                            */
/* ------------------------------------------------------------------ */

function seoOf(checks) {
  const passed = checks.filter((c) => c.state === 'pass').length;
  const total = checks.length;
  return { pct: total ? Math.round((passed / total) * 100) : 0, passed, total };
}

/**
 * 一篇文章的完整体检。
 * item 是 content 条目，body 是资产当前版本正文（Markdown）。
 */
function report(item, body, ctx) {
  const m = meta(item);
  const words = wordCount(body);
  const checks = checksOf(item, body);
  const seo = seoOf(checks);
  const rd = readability(body);
  const gap = contentGap(item, body, ctx);
  return {
    words,
    readingMin: readingTime(words),
    seo,
    checks,
    alerts: checks.filter((c) => c.state === 'fail'),
    readability: rd,
    gap,
    plagiarism: {
      available: false,
      pct: null,
      note: '查重需要 Copyscape / Originality.ai 这类付费接口，本地工具没接，这里不编数字'
    },
    keyword: {
      value: m.focusKeyword,
      inTitle: hasKeyword(item && item.title, m.focusKeyword),
      inBody: hasKeyword(body, m.focusKeyword)
    },
    thresholds: { words: MIN_WORDS, meta: [META_MIN, META_MAX], seoTitle: [SEOTITLE_MIN, SEOTITLE_MAX] }
  };
}

/* ------------------------------------------------------------------ */
/* 自动填充（规则，不是模型）                                           */
/* ------------------------------------------------------------------ */

function firstSentences(text, n) {
  const t = plain(text);
  if (!t) return '';
  const ss = t.split(/(?<=[.!?。！？])\s*/);
  let out = '';
  for (const s of ss) {
    if (!s.trim()) continue;
    out = (out ? out + ' ' : '') + s.trim();
    if (out.split(/\s+/).length >= n) break;
  }
  return out;
}

function trimTo(s, max) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf('，'), cut.lastIndexOf('。'));
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).trim();
}

/**
 * 自动填一个字段。mode='ai' 时如果没有可用模型，就用同一套规则并把 degraded 标出来 ——
 * 宁可如实说「模型没接入，这是规则填的」，也不要假装是 AI 写的。
 */
function autofill(item, body, field, mode) {
  const m = meta(item);
  const title = (item && item.title) || '';
  const kw = m.focusKeyword;
  let value = '';
  if (field === 'excerpt') {
    value = trimTo(firstSentences(body, 30), 180);
    if (!value) value = trimTo(title, 180);
  } else if (field === 'seoTitle') {
    value = kw && !hasKeyword(title, kw) ? trimTo(`${title} · ${kw}`, SEOTITLE_MAX) : trimTo(title, SEOTITLE_MAX);
  } else if (field === 'metaDescription') {
    const lead = firstSentences(body, 24) || title;
    value = trimTo(kw && !hasKeyword(lead, kw) ? `${lead} ${kw}` : lead, META_MAX);
  } else if (field === 'slug') {
    value = slugify(title, item && item.id);
  } else {
    return { ok: false, error: `不能自动填：${field}` };
  }
  return { ok: true, field, value, degraded: mode === 'ai' ? 'offline-rules' : null };
}

/* ------------------------------------------------------------------ */
/* Audience 面板的 6 个渠道分类 + 社媒平台                              */
/* ------------------------------------------------------------------ */

/**
 * appCategory 用来从应用目录（knowledge.APP_CATALOG）里捞「已绑定」的应用：
 * 只有「装了 + 授权了」才显示成已绑定账号，装了没授权显示待授权。
 * channels 是这个分类下**真的能分发**的渠道规则（lib/channels.js）。
 */
const AUDIENCE = [
  {
    id: 'websites',
    label: 'Personal websites',
    blurb: 'It all starts here, publish your article to your website and gather stats.',
    appCategory: '发布',
    addLabel: 'Add your websites',
    channels: [],
    required: true,
    note: '文章至少要发到一个自己的站点；社媒只是附属分发'
  },
  {
    id: 'hubs',
    label: 'Content hubs',
    blurb: 'Extend your reach by bringing your article to additional blog platforms.',
    appCategory: '',
    addLabel: 'Add external content hubs',
    channels: [],
    supported: false,
    note: '外部博客平台（Medium 等）不在应用目录里，这里如实留空'
  },
  {
    id: 'advocacy',
    label: 'Employee advocacy',
    blurb: '让同事、客户帮你转发这篇文章。',
    appCategory: '协作',
    addLabel: 'Add referral channels',
    channels: [],
    note: '绑定 Slack 这类协作工具后，文章会出现在转发清单里'
  },
  {
    id: 'email',
    label: 'Email marketing',
    blurb: 'Include your article in newsletters.',
    appCategory: '邮件',
    addLabel: 'Add mailing tools',
    channels: ['cold_email'],
    note: '冷邮件渠道有 6 条规则，发之前会先过一遍检查'
  },
  {
    id: 'mobile',
    label: 'Mobile platforms',
    blurb: '推送 / App 内分发。',
    appCategory: '',
    addLabel: 'Add mobile platforms',
    channels: [],
    supported: false,
    note: '没有推送 / App 分发的渠道规则，这里如实留空'
  },
  {
    id: 'social',
    label: 'Social networks',
    blurb: 'Promote on Social Media.',
    appCategory: '社交',
    addLabel: 'Manage social posts',
    channels: ['x_post', 'reddit_post'],
    note: '每条社媒帖都是独立子资产：单独改文案、配图、定时，互不影响母文章'
  }
];

/** 社媒平台支持情况：只有真的有渠道规则、且规则带出处的才算支持 */
const SOCIAL_PLATFORMS = [
  { key: 'x', label: 'X (Twitter)', channel: 'x_post', supported: true, rules: 4 },
  { key: 'reddit', label: 'Reddit', channel: 'reddit_post', supported: true, rules: 5 },
  { key: 'linkedin', label: 'LinkedIn', channel: '', supported: false, why: '还没写 LinkedIn 版渠道规则' },
  { key: 'facebook', label: 'Facebook', channel: '', supported: false, why: '还没写 Facebook 版渠道规则' },
  { key: 'slack', label: 'Slack', channel: '', supported: false, why: 'Slack 只做协作通知，不是分发渠道' },
  { key: 'gbp', label: 'Google Business Profile', channel: '', supported: false, why: '还没写 GBP 版渠道规则' }
];

module.exports = {
  ME,
  REGIONS,
  LOCALES,
  AUDIENCE,
  SOCIAL_PLATFORMS,
  CUSTOM_KEYS,
  META_MIN,
  META_MAX,
  SEOTITLE_MIN,
  SEOTITLE_MAX,
  MIN_WORDS,
  emptyMeta,
  meta,
  normalizeItem,
  slugify,
  plain,
  wordCount,
  sentences,
  readingTime,
  readability,
  checksOf,
  knowledgeCtx,
  contentGap,
  scoresOf,
  report,
  autofill,
  firstSentences,
  trimTo,
  hasKeyword,
  headings,
  links,
  images
};
