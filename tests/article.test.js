'use strict';
/**
 * Article 编辑器单测（lib/article.js）
 *
 * 这一层只管「打分和自动填充的口径」，不启服务、不开浏览器。
 * 重点：12 项硬检查逐项能过能挂、词数/可读性的边界、内容缺口对照 knowledge、
 * 自动填充不编造（没模型时标 degraded）、以及 normalize 不会把 item.article 吃掉。
 */
const assert = require('assert');
const A = require('../lib/article');
const content = require('../lib/content');

let n = 0;
const t = (name, fn) => {
  try { fn(); n++; console.log('  ok  ' + name); }
  catch (e) { console.log('  ✗  ' + name + '\n      ' + e.message); process.exitCode = 1; }
};

const LONG = (kw) => [
  '# 用 ai content workflow 把一篇母文章拆成七个渠道',
  '',
  '## 为什么先写母文章',
  '',
  'ai content workflow 这套流程的关键不是模型多强，而是规则可验证。',
  '',
  '## 结构怎么排',
  '',
  '先把主张写透，再派生社媒帖、邮件和落地页。参考 [方法论](https://example.com/m)。',
  '',
  '![结构图](https://example.com/a.png)',
  '',
  '> 一份素材，七个渠道，规则带出处。'
].join('\n') + '\n\n' + Array.from({ length: 30 })
  .map((_, i) => `第 ${i + 1} 段：把结论放前面，用具体的数字和例子说话，不堆形容词，也不写行业黑话。`)
  .join('\n\n');

const item = (over) => ({
  id: 'ct_test1',
  type: 'article',
  title: '用 ai content workflow 拆渠道',
  language: 'en',
  tags: [],
  keywords: [],
  ...over
});

const metaWith = (over) => ({
  article: {
    focusKeyword: 'ai content workflow',
    seoTitle: 'ai content workflow: one article, seven channels',
    metaDescription: 'x'.repeat(140),
    slug: 'ai-content-workflow',
    ...over
  }
});

/* ---------------- slug ---------------- */

t('slug：英文标题正常转', () => {
  assert.strictEqual(A.slugify('How we cut CAC by 40% in Q3'), 'how-we-cut-cac-by-40-in-q3');
});

t('slug：去引号与多余连字符', () => {
  assert.strictEqual(A.slugify("  We're  shipping   NOW  "), 'were-shipping-now');
});

t('slug：中文标题保留英文词，纯中文退回 article-<id尾>', () => {
  assert.strictEqual(A.slugify('Persist 探针 two'), 'persist-two');
  assert.strictEqual(A.slugify('完全中文的标题', 'ct_abc123'), 'article-abc123');
});

t('slug：超长截断且不以连字符结尾', () => {
  const s = A.slugify('a'.repeat(40) + ' ' + 'b'.repeat(40));
  assert.ok(s.length <= 70, s);
  assert.ok(!/-$/.test(s), s);
});

/* ---------------- 文本度量 ---------------- */

t('wordCount：拉丁按空格、中文按字', () => {
  assert.strictEqual(A.wordCount('one two three'), 3);
  assert.strictEqual(A.wordCount('一二三'), 3);
  assert.strictEqual(A.wordCount('one 中文 two'), 4);
  assert.strictEqual(A.wordCount(''), 0);
});

t('wordCount：markdown 记号不算词', () => {
  assert.strictEqual(A.wordCount('## 标题\n\n- 一\n- 二'), 4);  // 标题=2 字 + 一 + 二
  assert.strictEqual(A.wordCount('```\ncode here\n```'), 0);
});

t('plain：剥掉代码块 / 图片 / 链接壳子', () => {
  const s = A.plain('![图](u) [文字](https://x.com) **粗** `code`');
  assert.ok(!/https:\/\/x\.com/.test(s), s);
  assert.ok(s.includes('文字'), s);
});

t('readability：短句为主得分高', () => {
  const r = A.readability('One. Two. Three. Four. Five. Six. Seven. Eight.');
  assert.ok(r.pct >= 90, String(r.pct));
  assert.strictEqual(r.label, 'easy');
});

t('readability：长句 + 长词扣分', () => {
  const long = Array.from({ length: 12 })
    .map(() => 'Extraordinarily complicated internationalization terminology consistently dominates every single paragraph structure without exception.')
    .join(' ');
  const r = A.readability(long);
  assert.ok(r.pct < 90, String(r.pct));
  assert.ok(r.avgWords >= 10, String(r.avgWords));
  assert.ok(r.longPct > 20, String(r.longPct));
});

t('readability：空正文不炸', () => {
  const r = A.readability('');
  assert.strictEqual(r.pct, 100);
  assert.strictEqual(r.words, 0);
  assert.strictEqual(r.sentences, 0);
});

t('readingTime 至少 1 分钟', () => {
  assert.strictEqual(A.readingTime(0), 1);
  assert.strictEqual(A.readingTime(440), 2);
});

/* ---------------- 12 项硬检查 ---------------- */

t('checks：空文章只有 language 能过，其余全挂', () => {
  const checks = A.checksOf(item({ language: 'en' }), '');
  const pass = checks.filter((c) => c.state === 'pass').map((c) => c.key);
  assert.deepStrictEqual(pass, ['language'], 'pass=' + pass.join(','));
  assert.strictEqual(checks.length, 12);
  assert.ok(checks.find((c) => c.key === 'keyword').critical, 'keyword 是严重项');
  assert.ok(checks.every((c) => c.target && c.field), '每条检查都要能指到某个字段');
});

t('checks：语言没填 → language 挂且是 critical', () => {
  const c = A.checksOf(item({ language: '' }), 'x').find((x) => x.key === 'language');
  assert.strictEqual(c.state, 'fail');
  assert.strictEqual(c.critical, true);
  assert.strictEqual(c.target, 'settings');
});

t('checks：满分文章 12 项全过', () => {
  const it = { ...item(metaWith()), ...metaWith() };
  it.article = metaWith().article;
  const checks = A.checksOf(it, LONG());
  const fails = checks.filter((c) => c.state !== 'pass');
  assert.strictEqual(fails.length, 0, 'fail=' + fails.map((f) => f.key + ':' + f.hint).join(' | '));
  assert.strictEqual(checks.length, 12);
});

t('checks：关键词太长（>6 词）挂 keywordLength 但不挂 keyword', () => {
  const it = { ...item(), article: { focusKeyword: 'a b c d e f g' } };
  const checks = A.checksOf(it, 'a b c d e f g');
  assert.strictEqual(checks.find((c) => c.key === 'keyword').state, 'pass');
  assert.strictEqual(checks.find((c) => c.key === 'keywordLength').state, 'fail');
});

t('checks：关键词不在标题 → keywordInTitle 挂，target 是 write', () => {
  const it = { ...item({ title: '别的标题' }), article: { focusKeyword: 'ai content workflow' } };
  const c = A.checksOf(it, LONG()).find((x) => x.key === 'keywordInTitle');
  assert.strictEqual(c.state, 'fail');
  assert.strictEqual(c.target, 'write');
});

t('checks：meta description 太短/太长都挂，边界内过', () => {
  const mk = (len) => A.checksOf({ ...item(), article: { focusKeyword: 'k', metaDescription: 'x'.repeat(len) } }, 'k').find((c) => c.key === 'metaDescription').state;
  assert.strictEqual(mk(100), 'fail');
  assert.strictEqual(mk(120), 'pass');
  assert.strictEqual(mk(160), 'pass');
  assert.strictEqual(mk(200), 'fail');
});

t('checks：SEO 标题边界 30/60', () => {
  const mk = (len) => A.checksOf({ ...item(), article: { focusKeyword: 'k', seoTitle: 'y'.repeat(len) } }, 'k').find((c) => c.key === 'seoTitle').state;
  assert.strictEqual(mk(29), 'fail');
  assert.strictEqual(mk(30), 'pass');
  assert.strictEqual(mk(60), 'pass');
  assert.strictEqual(mk(61), 'fail');
});

t('checks：字数门槛 300', () => {
  const short = 'word '.repeat(299);
  const enough = 'word '.repeat(300);
  const g = (b) => A.checksOf(item(), b).find((c) => c.key === 'textLength').state;
  assert.strictEqual(g(short), 'fail');
  assert.strictEqual(g(enough), 'pass');
});

t('checks：slug 含空格或中文 → 挂', () => {
  const mk = (slug) => A.checksOf({ ...item(), article: { focusKeyword: 'k', slug } }, 'k').find((c) => c.key === 'slug').state;
  assert.strictEqual(mk('has space'), 'fail');
  assert.strictEqual(mk('中文-slug'), 'fail');
  assert.strictEqual(mk('ok-slug'), 'pass');
});

t('checks：图片缺 alt 记在 imageAlt 里', () => {
  const it = { ...item(), article: { focusKeyword: 'k' } };
  const c = A.checksOf(it, '![](https://a.png) ![有alt](https://b.png)').find((x) => x.key === 'imageAlt');
  assert.strictEqual(c.state, 'fail');
  assert.ok(/1 张图缺 alt/.test(c.hint), c.hint);
});

/* ---------------- report 汇总 ---------------- */

t('report：分数 = 通过项 / 12', () => {
  const it = { ...item(), article: metaWith().article };
  const r = A.report(it, LONG(), { pillars: [], audiences: [] });
  assert.strictEqual(r.seo.total, 12);
  assert.strictEqual(r.seo.pct, Math.round((r.seo.passed / 12) * 100));
  assert.strictEqual(r.alerts.length, 12 - r.seo.passed);
});

t('report：查重如实不可用，不给分数', () => {
  const r = A.report(item(), '', { pillars: [], audiences: [] });
  assert.strictEqual(r.plagiarism.available, false);
  assert.strictEqual(r.plagiarism.pct, null);
  assert.ok(/没接/.test(r.plagiarism.note), r.plagiarism.note);
});

t('report：word count 与阅读时长是真的算出来的', () => {
  const r = A.report(item(), LONG(), { pillars: [], audiences: [] });
  assert.ok(r.words > 200, String(r.words));
  assert.ok(r.readingMin >= 1);
});

/* ---------------- 内容缺口 ---------------- */

const ctx = (pillars) => ({ pillars, audiences: [], website: '' });

t('gap：knowledge 没支柱 → 不可用', () => {
  const g = A.contentGap(item(), LONG(), ctx([]));
  assert.strictEqual(g.available, false);
  assert.strictEqual(g.pct, null);
});

t('gap：命中主题就有覆盖率，没命中的列在 missing', () => {
  const pillars = [{ id: 'p1', name: 'P', topics: ['ai content workflow', '竞品对比'] }];
  const g = A.contentGap({ ...item(), article: { focusKeyword: 'ai content workflow' } }, LONG(), ctx(pillars));
  assert.strictEqual(g.available, true);
  assert.ok(g.covered.includes('ai content workflow'), JSON.stringify(g));
  assert.ok(g.missing.includes('竞品对比'), JSON.stringify(g));
  assert.strictEqual(g.pct, 50);
});

t('gap：全不命中 → 0%', () => {
  const pillars = [{ id: 'p1', name: 'P', topics: ['zzz'] }];
  const g = A.contentGap(item(), 'nothing relevant here', ctx(pillars));
  assert.strictEqual(g.pct, 0);
});

t('gap：pillar 没写 topics 时用 pillar 名字当主题', () => {
  const pillars = [{ id: 'p1', name: '品牌故事', topics: [] }];
  const g = A.contentGap(item({ title: '品牌故事怎么写' }), '', ctx(pillars));
  assert.strictEqual(g.pct, 100);
});

/* ---------------- 自动填充 ---------------- */

t('autofill excerpt：从正文前几句截', () => {
  const r = A.autofill(item(), LONG(), 'excerpt', 'rule');
  assert.ok(r.ok && r.value.length > 20, r.value);
  assert.ok(r.value.length <= 180, String(r.value.length));
  assert.strictEqual(r.degraded, null);
});

t('autofill excerpt：正文为空时退回标题', () => {
  const r = A.autofill(item({ title: '只有标题' }), '', 'excerpt', 'rule');
  assert.strictEqual(r.value, '只有标题');
});

t('autofill seoTitle：有关键词但不含在标题里就拼上', () => {
  const it = { ...item({ title: '拆渠道' }), article: { focusKeyword: 'ai content workflow' } };
  const r = A.autofill(it, '', 'seoTitle', 'rule');
  assert.ok(/ai content workflow/.test(r.value), r.value);
  assert.ok(r.value.length <= 60, String(r.value.length));
});

t('autofill metaDescription：不超过 160，且尽量带上关键词', () => {
  const it = { ...item(), article: { focusKeyword: 'ai content workflow' } };
  const r = A.autofill(it, LONG(), 'metaDescription', 'rule');
  assert.ok(r.value.length <= 160, String(r.value.length));
  assert.ok(/ai content workflow/.test(r.value), r.value.slice(0, 60));
});

t('autofill slug：走 slugify', () => {
  const r = A.autofill(item({ title: 'How we ship fast' }), '', 'slug', 'rule');
  assert.strictEqual(r.value, 'how-we-ship-fast');
});

t('autofill：mode=ai 但没有模型时标 degraded，不假装是 AI 写的', () => {
  const r = A.autofill(item(), LONG(), 'excerpt', 'ai');
  assert.strictEqual(r.degraded, 'offline-rules');
});

t('autofill：不认识的字段直接拒绝', () => {
  const r = A.autofill(item(), '', 'nope', 'rule');
  assert.strictEqual(r.ok, false);
  assert.ok(/不能自动填/.test(r.error), r.error);
});

t('trimTo：按词边界截断，不把词切一半', () => {
  const s = A.trimTo('alpha beta gamma delta', 12);
  assert.ok(!/\s$/.test(s), JSON.stringify(s));
  assert.ok(s === 'alpha beta' || s === 'alpha', JSON.stringify(s));
});

/* ---------------- 元信息 & 持久化回归 ---------------- */

t('meta：默认值齐全（地区 / 语言 / 三个自定义字段）', () => {
  const m = A.meta({});
  assert.strictEqual(m.searchRegion, 'google.com');
  assert.strictEqual(m.searchLocale, 'en');
  assert.deepStrictEqual(m.custom, { icp: '', kpi: '', footerLink: '' });
});

t('meta：非法地区 / 语言被拉回默认', () => {
  const m = A.meta({ article: { searchRegion: 'baidu.com', searchLocale: 'xx' } });
  assert.strictEqual(m.searchRegion, 'google.com');
  assert.strictEqual(m.searchLocale, 'en');
});

t('meta：只保留白名单字段，脏字段不进来', () => {
  const m = A.meta({ article: { focusKeyword: 'k', evil: 'x' } });
  assert.strictEqual(m.focusKeyword, 'k');
  assert.ok(!('evil' in m), JSON.stringify(m));
});

t('normalizeItem 会就地补上 article', () => {
  const it = { id: 'x' };
  A.normalizeItem(it);
  assert.ok(it.article && it.article.custom, JSON.stringify(it.article));
});

t('回归：content.normalize 不许吞掉 item.article（吞了就是「保存成功、读出来是空」）', () => {
  const db = content.emptyDb();
  const made = content.create(db, { type: 'article', title: '带着元信息' });
  const got = content.find(db, made.id);
  got.article = { focusKeyword: 'ai content workflow', custom: { kpi: '50' } };
  const norm = content.normalize(JSON.parse(JSON.stringify(got)));
  assert.deepStrictEqual(norm.article, { focusKeyword: 'ai content workflow', custom: { kpi: '50' } });
  // 没有元信息的条目也不该多出脏东西
  const plain = content.normalize({ type: 'social', title: 'x' });
  assert.deepStrictEqual(plain.article, {});
});

/* ---------------- 列表行显示的分数（scoresOf） ---------------- */

t('scoresOf：满分文章 → geo 100，且与编辑器里的 report 完全一致', () => {
  const it = { ...item(), article: metaWith().article };
  const sc = A.scoresOf(it, LONG(), ctx([{ id: 'p1', name: 'P', topics: ['ai content workflow'] }]));
  const rep = A.report(it, LONG(), ctx([{ id: 'p1', name: 'P', topics: ['ai content workflow'] }]));
  assert.strictEqual(sc.geo, rep.seo.pct);
  assert.strictEqual(sc.gap, rep.gap.pct);
  assert.strictEqual(sc.geo, 100, '满分文章应该是 100，实际 ' + sc.geo);
});

t('scoresOf：空文章 → geo 有分但不为 0（language 那项能过）', () => {
  const sc = A.scoresOf(item({ language: 'en' }), '', ctx([]));
  assert.strictEqual(sc.geo, 8, '1/12 应该约等于 8%');
});

t('scoresOf：知识库没支柱 → gap 为 null（不是 0）', () => {
  const sc = A.scoresOf(item(), LONG(), ctx([]));
  assert.strictEqual(sc.gap, null);
  assert.ok(sc.geo > 0);
});

t('scoresOf：非 article 类型不该有这两个分（调用方按 type 过滤，这里保证口径可判空）', () => {
  const sc = A.scoresOf(item({ type: 'social' }), LONG(), ctx([]));
  assert.strictEqual(sc.gap, null);
  // geo 是纯文本规则的通过率，社媒条目算出来也真实；是否显示由调用方按 type 决定
  assert.ok(sc.geo === null || typeof sc.geo === 'number');
});

t('scoresOf：分数恒在 0–100 之间，不会出现负数或超 100', () => {
  for (const body of ['', 'word', LONG(), 'x '.repeat(2000)]) {
    const sc = A.scoresOf(item({ article: { focusKeyword: 'ai content workflow' } }), body, ctx([]));
    assert.ok(sc.geo >= 0 && sc.geo <= 100, 'geo=' + sc.geo);
    assert.ok(sc.gap === null || (sc.gap >= 0 && sc.gap <= 100), 'gap=' + sc.gap);
  }
});

t('AUDIENCE / SOCIAL_PLATFORMS 口径：6 个分类、只有 X 和 Reddit 真支持', () => {
  assert.strictEqual(A.AUDIENCE.length, 6);
  const supported = A.SOCIAL_PLATFORMS.filter((p) => p.supported).map((p) => p.channel);
  assert.deepStrictEqual(supported, ['x_post', 'reddit_post']);
  assert.ok(A.SOCIAL_PLATFORMS.filter((p) => !p.supported).every((p) => p.why), '未支持的平台都要写清楚为什么');
});

console.log('');
if (process.exitCode) { console.log('✗ article 单测有失败项'); process.exit(1); }
console.log('✓ article 单测全部通过 ' + n + ' 项');
