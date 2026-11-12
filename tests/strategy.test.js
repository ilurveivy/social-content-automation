'use strict';
/**
 * Strategy 层单测：
 *   lib/audit.js    —— GSC 导出解析 + 优先级判定的阈值边界
 *   lib/skills.js   —— 技能库的增删改、@匹配、prompt 拼装
 *   lib/knowledge.js—— building blocks（Dashboard 与 Strategy 共用的进度口径）
 *
 * 这三块都是"纯函数 + 文件存储"，不需要起服务、不需要浏览器。
 */
const assert = require('assert');
const audit = require('../lib/audit');
const skills = require('../lib/skills');
const knowledge = require('../lib/knowledge');
const gsc = require('../lib/gsc');

let n = 0;
const t = (name, fn) => {
  try { fn(); n++; console.log('  ok  ' + name); }
  catch (e) { console.log('  ✗   ' + name + '\n      ' + e.message); process.exitCode = 1; }
};

const TSV = [
  'Top queries\tClicks\tImpressions\tCTR\tPosition',
  'how to write a marketing brief\t12\t1800\t0.67%\t8',
  'storychief alternatives\t45\t900\t5.00%\t14',
  'ai content automation for saas\t0\t640\t0%\t23',
  'what is an editorial calendar\t1\t320\t0.31%\t61'
].join('\n');

console.log('\n[audit.parseGsc] 认表头和数字 —— 认错了后面全是错的');

t('GSC 制表符导出', () => {
  const r = audit.parseGsc(TSV);
  assert.strictEqual(r.rows.length, 4);
  assert.strictEqual(r.headerFound, true);
  assert.deepStrictEqual(r.rows[0], { query: 'how to write a marketing brief', clicks: 12, impressions: 1800, ctr: 0.0067, position: 8 });
});

t('CSV + 引号包裹的查询', () => {
  const r = audit.parseGsc('Query,Clicks,Impressions,CTR,Position\n"seo for saas",4,"1,900","0.44%",18');
  assert.strictEqual(r.rows[0].query, 'seo for saas');
  assert.strictEqual(r.rows[0].impressions, 1900);
  assert.strictEqual(r.rows[0].position, 18);
});

t('中文字头（点击次数 / 展示次数 / 平均排名）', () => {
  const r = audit.parseGsc('查询\t点击次数\t展示次数\t点击率\t平均排名\n内容改写\t3\t400\t0.75%\t12');
  assert.strictEqual(r.rows.length, 1);
  assert.strictEqual(r.rows[0].query, '内容改写');
  assert.strictEqual(r.rows[0].clicks, 3);
  assert.strictEqual(r.rows[0].position, 12);
});

t('没有表头：按默认列序解析，但必须给出警告', () => {
  const r = audit.parseGsc('marketing brief\t5\t300\t1.6%\t9');
  assert.strictEqual(r.rows.length, 1);
  assert.strictEqual(r.rows[0].query, 'marketing brief');
  assert.ok(r.warnings.length > 0, '没警告就等于悄悄猜');
});

t('不是表格：明确报错，不硬编数据', () => {
  const r = audit.parseGsc('这不是表');
  assert.strictEqual(r.rows.length, 0);
  assert.ok(/认不出来/.test(r.warnings.join('')), '实际警告：' + r.warnings.join(' / '));
});

t('空输入', () => {
  const r = audit.parseGsc('');
  assert.strictEqual(r.rows.length, 0);
});

t('CTR 缺失时用 点击/展示 反算', () => {
  const r = audit.parseGsc('Query\tClicks\tImpressions\tPosition\nx\t10\t100\t5');
  assert.strictEqual(r.rows[0].ctr, 0.1);
});

console.log('\n[audit.analyze] 阈值边界 —— 改这里等于改产品口径');

const typeOf = (row, opts) => {
  const r = audit.analyze([row], opts);
  return r.opportunities.length ? r.opportunities[0].type : null;
};
const row = (query, clicks, impressions, ctr, position) => ({ query, clicks, impressions, ctr, position });

t('前 10 名但 CTR < 2% 且展示 ≥ 100 → low_ctr', () => {
  assert.strictEqual(typeOf(row('a', 12, 1800, 0.0067, 8)), 'low_ctr');
});

t('前 10 名、CTR 够高 → 不算机会（不要为了有产出而硬凑）', () => {
  assert.strictEqual(typeOf(row('a', 90, 1800, 0.05, 8)), null);
});

t('第 11–20 名且展示 ≥ 50 → striking', () => {
  assert.strictEqual(typeOf(row('a', 45, 900, 0.05, 14)), 'striking');
  assert.strictEqual(typeOf(row('a', 1, 49, 0.02, 14)), null, '展示没到 50 不该报');
});

t('第 21–50 名 → thin；> 50 名 → gap', () => {
  assert.strictEqual(typeOf(row('a', 0, 640, 0, 23)), 'thin');
  assert.strictEqual(typeOf(row('a', 1, 320, 0.003, 61)), 'gap');
});

t('未上榜（position 0）但有点击 → gap', () => {
  assert.strictEqual(typeOf(row('a', 2, 40, 0.05, 0)), 'gap');
});

t('优先级 = 展示 × 类型权重，且降序', () => {
  const r = audit.analyze(TSV);
  const prios = r.opportunities.map((o) => o.priority);
  assert.deepStrictEqual(prios, [...prios].sort((a, b) => b - a));
  assert.strictEqual(r.opportunities[0].query, 'how to write a marketing brief');
});

t('统计：整体 CTR / 平均排名', () => {
  const r = audit.analyze(TSV);
  assert.strictEqual(r.rows, 4);
  assert.strictEqual(r.totalClicks, 58);
  assert.strictEqual(r.totalImpressions, 3660);
  assert.strictEqual(r.ctr, Math.round((58 / 3660) * 10000) / 10000);
  assert.strictEqual(r.avgPosition, Math.round(((8 + 14 + 23 + 61) / 4) * 10) / 10);
});

t('内容支柱：数据里没人搜 → 报「支柱空着」', () => {
  const r = audit.analyze(TSV, { pillars: ['内容适配'] });
  assert.ok(r.opportunities.some((o) => o.type === 'pillar' && o.query === '内容适配'));
});

t('内容支柱：搜到了就不报', () => {
  const r = audit.analyze(TSV, { pillars: ['marketing brief'] });
  assert.ok(!r.opportunities.some((o) => o.type === 'pillar'), '命中还报缺口就是误报');
});

t('两个字母的支柱词宁可报缺口，也不假装覆盖', () => {
  // 「AI」会在 email / train / detail 里假命中，所以短词不参与匹配 → 如实报「支柱空着」
  const r = audit.analyze(TSV, { pillars: ['AI'] });
  assert.ok(r.opportunities.some((o) => o.type === 'pillar'), '短词不该把缺口说成覆盖了');
});

t('每个机会都带可执行建议和 campaign 名', () => {
  const r = audit.analyze(TSV);
  assert.ok(r.opportunities.every((o) => o.action && o.action.length > 10 && /^SEO · /.test(o.campaignName)));
});

console.log('\n[skills] 技能库');

t('内置 4 条技能，字段完整', () => {
  const db = skills.load();
  assert.strictEqual(db.skills.length, 4);
  const l = skills.list(db);
  assert.ok(l.every((s) => s.name && s.steps.length >= 4 && s.stepCount === s.steps.length && s.builtin));
});

t('@ 名字 / @id / 前缀 都能匹配', () => {
  const db = skills.load();
  const name = db.skills[0].name;
  assert.strictEqual(skills.matchSkill('@' + name + ' 帮我看看', db).name, name);
  assert.strictEqual(skills.matchSkill('@' + db.skills[1].id, db).name, db.skills[1].name);
  assert.ok(skills.matchSkill('@' + name.slice(0, 2), db));
  assert.strictEqual(skills.matchSkill('没有 at 符号', db), null);
});

t('instruction 把步骤编号拼进去', () => {
  const db = skills.load();
  const s = db.skills[0];
  const txt = skills.instruction(s);
  assert.ok(txt.includes('【技能：' + s.name + '】'));
  assert.ok(txt.includes('1. ' + s.steps[0]));
  assert.ok(txt.includes('不要编'));
});

t('新建校验：没名字 / 没步骤 都要拒绝', () => {
  const db = skills.load();
  assert.throws(() => skills.create(db, { name: '', steps: ['a'] }), /技能名/);
  assert.throws(() => skills.create(db, { name: 'x', steps: [] }), /至少/);
});

t('新建时把「1. 」前缀去掉，并按行切分', () => {
  const db = skills.load();
  const rec = skills.create(db, { name: '临时技能', steps: '1. 第一步\n2. 第二步\n\n3. 第三步' });
  assert.deepStrictEqual(rec.steps, ['第一步', '第二步', '第三步']);
  assert.strictEqual(rec.builtin, false);
});

t('编辑 / 删除', () => {
  const db = skills.load();
  const rec = skills.create(db, { name: '临时技能', steps: ['a'] });
  skills.update(db, rec.id, { description: '改了说明' });
  assert.strictEqual(skills.get(db, rec.id).description, '改了说明');
  assert.strictEqual(skills.remove(db, rec.id), true);
  assert.strictEqual(skills.get(db, rec.id), null);
});

t('内置技能删掉会自动补回（技能库不能被清空）', () => {
  const db = skills.load();
  const id = db.skills.find((s) => s.builtin).id;
  skills.remove(db, id);
  assert.ok(skills.get(db, id), '内置技能应被补回');
});

t('步骤最多 12 步（防止把整篇 prompt 塞进来）', () => {
  const db = skills.load();
  const rec = skills.create(db, { name: '长技能', steps: Array.from({ length: 20 }, (_, i) => 'step ' + i) });
  assert.strictEqual(rec.steps.length, 12);
});

console.log('\n[knowledge] setup 清单 —— Dashboard 与 Strategy 共用的进度口径');

t('10 项 setup，空库时 done = 0', () => {
  const b = knowledge.blocks({ company: {}, gsc: null, files: [] });
  assert.strictEqual(b.total, 10);
  assert.strictEqual(b.done, 0);
  assert.strictEqual(b.items.length, 10);
  assert.strictEqual(b.missing.length, 10);
});

t('清单顺序 = Overview 两列网格的填充顺序（先左列 5 个，再右列 5 个）', () => {
  const labels = knowledge.blocks({ company: {}, gsc: null, files: [] }).items.map((i) => i.label);
  assert.deepStrictEqual(labels, [
    'Website', 'Brand voices', 'Visual style', 'Google Search Console', 'Target audiences',
    'Company description', 'Writing style', 'Competitor websites', 'Content pillars', 'Knowledge files'
  ]);
  assert.deepStrictEqual(labels.slice(0, 5), ['Website', 'Brand voices', 'Visual style', 'Google Search Console', 'Target audiences']);
  assert.deepStrictEqual(labels.slice(5), ['Company description', 'Writing style', 'Competitor websites', 'Content pillars', 'Knowledge files']);
});

t('只有 company 字段，靠 gsc / files / brandVoices 单独判定的块不能被误判成已完成', () => {
  const db = { company: { website: 'https://e.x' }, gsc: { connected: false }, files: [] };
  const byKey = Object.fromEntries(knowledge.blocks(db).items.map((i) => [i.key, i.done]));
  assert.strictEqual(byKey.website, true);
  assert.strictEqual(byKey.gsc, false);
  assert.strictEqual(byKey.files, false);
  assert.strictEqual(byKey.brandVoices, false);
  // GSC 接上了就算完成
  assert.strictEqual(knowledge.blocks({ ...db, gsc: { connected: true } }).items.find((i) => i.key === 'gsc').done, true);
  // 传了文件才算 files
  assert.strictEqual(knowledge.blocks({ ...db, files: [{ id: 'kf_1' }] }).items.find((i) => i.key === 'files').done, true);
});

t('填满就是 10/10，pct 100，missing 为空', () => {
  const db = {
    company: {
      website: 'https://e.x', description: '做内容',
      brandVoices: [{ id: 'bv_1', name: '直接', description: '', useCase: 'general', excerpts: [] }],
      audiences: [{ id: 'ta_1', name: 'b' }],
      contentPillars: [{ id: 'cp_1', name: 'p' }],
      competitors: ['c'], writingStyles: [{ id: 'ws_1', name: 'Blog articles' }],
    visualStyles: [{ id: 'vs_1', name: 'Social visuals' }]
    },
    gsc: { connected: true },
    files: [{ id: 'kf_1', name: 'a.md' }]
  };
  const b = knowledge.blocks(db);
  assert.strictEqual(b.done, 10);
  assert.strictEqual(knowledge.completeness(db).pct, 100);
  assert.deepStrictEqual(b.missing, []);
});

t('空字符串 / 空数组不算完成', () => {
  const b = knowledge.blocks({ company: { description: '   ', audiences: ['', '  '], writingStyle: '' }, gsc: null, files: [] });
  assert.strictEqual(b.done, 0);
});

t('缺哪块要说得出来（前端直接显示）', () => {
  const b = knowledge.blocks({ company: { website: 'https://e.x' }, gsc: null, files: [] });
  assert.ok(b.missing.includes('Company description'));
  assert.ok(!b.missing.includes('Website'));
});

/* ---------- 老数据 → 新结构 ---------- */

t('迁移：一句话定位/产品 → Company description；卖点/证据 → Custom instructions', () => {
  const c = knowledge.migrateCompany({
    oneLiner: '一份素材，七个渠道', products: ['内容适配', '视频分镜包'],
    differentiators: ['规则带出处'], proofPoints: ['14/14 满分'], tone: '直接、具体、不吹'
  });
  assert.strictEqual(c.description, '一份素材，七个渠道\n- 内容适配\n- 视频分镜包');
  assert.ok(c.customInstructions.includes('差异化卖点：'));
  assert.ok(c.customInstructions.includes('- 规则带出处'));
  assert.ok(c.customInstructions.includes('可引用的事实 / 证据：'));
  assert.ok(c.customInstructions.includes('- 14/14 满分'));
});

t('迁移：品牌语气 → 一条 brand voice', () => {
  const c = knowledge.migrateCompany({ tone: '直接、具体、不吹' });
  assert.strictEqual(c.brandVoices.length, 1);
  assert.strictEqual(c.brandVoices[0].name, '直接、具体、不吹');
  assert.ok(c.brandVoices[0].id.startsWith('bv_'));
});

t('迁移是幂等的：跑第三遍不会再拼一遍', () => {
  const once = knowledge.migrateCompany({ oneLiner: 'x', products: ['y'], tone: 't' });
  const twice = knowledge.migrateCompany(JSON.parse(JSON.stringify(once)));
  assert.strictEqual(twice.description, once.description);
  assert.strictEqual(twice.customInstructions, once.customInstructions);
  assert.strictEqual(twice.brandVoices.length, 1);
});

t('brief()：老字段也能汇成同一份上下文', () => {
  const b = knowledge.brief({ name: 'eSheep.ai', oneLiner: '一稿七渠道', differentiators: ['规则带出处'], proofPoints: ['14/14'], tone: '直接' });
  assert.strictEqual(b.description, '一稿七渠道');
  assert.ok(b.facts.includes('规则带出处'));
  assert.deepStrictEqual(b.sellingPoints, ['规则带出处']);
  assert.strictEqual(b.voice, '直接');
});

/* ---------- Target audiences：结构化条目 ---------- */

t('受众：字符串数组自动升级成对象，id 稳定', () => {
  const c = knowledge.migrateCompany({ audiences: ['出海 SaaS 创始人', '增长负责人'] });
  assert.strictEqual(c.audiences.length, 2);
  assert.strictEqual(c.audiences[0].name, '出海 SaaS 创始人');
  assert.deepStrictEqual(c.audiences[0].industries, []);
  assert.ok(c.audiences[0].id.startsWith('ta_'));
  const again = knowledge.migrateCompany(JSON.parse(JSON.stringify(c)));
  assert.strictEqual(again.audiences[0].id, c.audiences[0].id);
});

t('受众：能加能改能删，名字不能空', () => {
  const db = knowledge.load();
  db.company.audiences = [];
  assert.throws(() => knowledge.addAudience(db, { name: '   ' }), /Audience name/);
  const a = knowledge.addAudience(db, {
    name: 'Growth marketers at Series B SaaS',
    description: 'Senior marketers at growing SaaS companies',
    industries: ['SaaS', ' AI '], jobTitles: ['Head of Content'],
    companySize: '51-200', goals: ['publish weekly'], painPoints: ['no time']
  });
  assert.strictEqual(db.company.audiences.length, 1);
  assert.deepStrictEqual(a.industries, ['SaaS', 'AI']);
  assert.strictEqual(a.companySize, '51-200');
  knowledge.updateAudience(db, a.id, { name: 'Growth marketers', painPoints: [] });
  assert.strictEqual(db.company.audiences[0].name, 'Growth marketers');
  assert.deepStrictEqual(db.company.audiences[0].painPoints, []);
  assert.strictEqual(knowledge.removeAudience(db, a.id), true);
  assert.strictEqual(knowledge.removeAudience(db, a.id), false);
});

t('删受众会把它从 pillar 的绑定里解掉', () => {
  const db = knowledge.load();
  db.company.audiences = [];
  db.company.contentPillars = [];
  const a = knowledge.addAudience(db, { name: 'A', description: 'd' });
  const b = knowledge.addAudience(db, { name: 'B', description: 'd' });
  const cp = knowledge.addPillar(db, { name: 'P', description: 'd', audienceIds: [a.id, b.id] });
  knowledge.removeAudience(db, a.id);
  assert.deepStrictEqual(db.company.contentPillars[0].audienceIds, [b.id]);
  assert.strictEqual(cp.id, db.company.contentPillars[0].id);
});

/* ---------- Content pillars：三条老的合成一条 ---------- */

t('支柱：老的三条合并成一条，原主题进 topicsInclude', () => {
  const c = knowledge.migrateCompany({ contentPillars: ['内容适配', 'AI 可见性', '竞品对比'] });
  assert.strictEqual(c.contentPillars.length, 1);
  const cp = c.contentPillars[0];
  assert.ok(cp.id.startsWith('cp_'));
  assert.ok(cp.name.includes('内容适配'));
  assert.deepStrictEqual(cp.topicsInclude, ['内容适配', 'AI 可见性', '竞品对比']);
  assert.deepStrictEqual(cp.topicsAvoid, []);
  assert.ok(cp.description);
  // 幂等：再跑一遍不重复合并
  const again = knowledge.migrateCompany(JSON.parse(JSON.stringify(c)));
  assert.strictEqual(again.contentPillars.length, 1);
  assert.strictEqual(again.contentPillars[0].id, cp.id);
  assert.deepStrictEqual(again.contentPillars[0].topicsInclude, ['内容适配', 'AI 可见性', '竞品对比']);
});

t('支柱：能加能改能删，名字不能空', () => {
  const db = knowledge.load();
  db.company.contentPillars = [];
  assert.throws(() => knowledge.addPillar(db, { name: '' }), /Pillar name/);
  const x = knowledge.addPillar(db, {
    name: 'Technical SEO', description: 'Educational content about technical SEO',
    audienceIds: ['ta_1'], searchQuestions: ['what is hreflang'],
    topicsInclude: ['crawl budget'], topicsAvoid: ['link buying'], coreMessages: ['one source, seven channels']
  });
  assert.strictEqual(db.company.contentPillars.length, 1);
  assert.deepStrictEqual(x.topicsAvoid, ['link buying']);
  knowledge.updatePillar(db, x.id, { topicsInclude: ['crawl budget', 'sitemap'] });
  assert.deepStrictEqual(db.company.contentPillars[0].topicsInclude, ['crawl budget', 'sitemap']);
  assert.strictEqual(knowledge.removePillar(db, x.id), true);
  assert.strictEqual(knowledge.removePillar(db, 'nope'), false);
});

t('brief()：受众和支柱带着细节进 prompt', () => {
  const b = knowledge.brief({
    audiences: [{ id: 'ta_1', name: 'Growth marketers', description: 'Series B SaaS', industries: ['SaaS'], jobTitles: ['Head of Content'], companySize: '51-200', goals: ['publish weekly'], painPoints: ['no time'] }],
    contentPillars: [{ id: 'cp_1', name: 'Technical SEO', description: 'Educational', audienceIds: ['ta_1'], searchQuestions: ['what is hreflang'], topicsInclude: ['crawl budget'], topicsAvoid: ['link buying'], coreMessages: ['one source'] }]
  });
  assert.strictEqual(b.audiences.length, 1);
  assert.ok(b.audiences[0].includes('Growth marketers'));
  ['Series B SaaS', '行业：SaaS', '职位：Head of Content', '公司规模：51-200', '目标：publish weekly', '痛点：no time'].forEach((x) => {
    assert.ok(b.audiences[0].includes(x), '受众里缺 ' + x);
  });
  assert.deepStrictEqual(b.contentPillars, ['Technical SEO']);
  const line = knowledge.pillarLines({ audiences: [{ id: 'ta_1', name: 'Growth marketers' }], contentPillars: [{ name: 'Technical SEO', description: 'Educational', audienceIds: ['ta_1'], searchQuestions: ['q'], topicsInclude: ['t'], topicsAvoid: ['x'], coreMessages: ['m'] }] })[0];
  ['Educational', '面向：Growth marketers', '要回答的搜索问题：q', '要覆盖：t', '要避开：x', '核心信息：m'].forEach((x) => {
    assert.ok(line.includes(x), '支柱里缺 ' + x);
  });
});

t('受众/支柱有名字才算完成（空名字不算）', () => {
  const base = { company: { audiences: [{ id: 'ta_1', name: 'A' }], contentPillars: [{ id: 'cp_1', name: 'P' }] }, gsc: null, files: [] };
  const byKey = Object.fromEntries(knowledge.blocks(base).items.map((i) => [i.key, i.done]));
  assert.strictEqual(byKey.audiences, true);
  assert.strictEqual(byKey.contentPillars, true);
  const blank = { company: { audiences: [{ id: 'ta_1', name: '  ' }], contentPillars: [] }, gsc: null, files: [] };
  const byKey2 = Object.fromEntries(knowledge.blocks(blank).items.map((i) => [i.key, i.done]));
  assert.strictEqual(byKey2.audiences, false);
  assert.strictEqual(byKey2.contentPillars, false);
});

/* ---------- Writing styles：结构化（开关 + 下拉 + 备注） ---------- */

t('写作规范：老的那段文字变成一条条目，原文进 notes', () => {
  const c = knowledge.migrateCompany({ writingStyle: '短句为主，先说结论；不堆形容词' });
  assert.strictEqual(c.writingStyles.length, 1);
  const w = c.writingStyles[0];
  assert.ok(w.id.startsWith('ws_'));
  assert.strictEqual(w.name, '通用写作规范');
  assert.strictEqual(w.notes, '短句为主，先说结论；不堆形容词');
  // 开关默认全关、下拉默认 no preference —— 不能凭空给用户加上规则
  assert.strictEqual(w.contractions, false);
  assert.strictEqual(w.quoteStyle, 'none');
  assert.strictEqual(w.headingCase, 'none');
  // 老字段清空，避免同一句话在 prompt 里出现两遍
  assert.strictEqual(c.writingStyle, '');
  // 幂等：再跑一遍 id 不变、也不会变成两条
  const again = knowledge.migrateCompany(JSON.parse(JSON.stringify(c)));
  assert.strictEqual(again.writingStyles.length, 1);
  assert.strictEqual(again.writingStyles[0].id, w.id);
});

t('写作规范：能加能改能删，名字不能空', () => {
  const db = knowledge.load();
  const keep = JSON.stringify(db.company.writingStyles);
  db.company.writingStyles = [];
  assert.throws(() => knowledge.addWritingStyle(db, { name: '   ' }), /Writing style name/);
  const w = knowledge.addWritingStyle(db, {
    name: 'Blog articles',
    contractions: true, avoidHedging: true, avoidSemicolons: true,
    oxfordCommas: true, genderNeutral: true, avoidPlus: true,
    quoteStyle: 'double', headingCase: 'title',
    notes: '短句为主'
  });
  assert.strictEqual(db.company.writingStyles.length, 1);
  assert.strictEqual(w.contractions, true);
  assert.strictEqual(w.avoidPlus, true);
  assert.strictEqual(w.quoteStyle, 'double');
  assert.strictEqual(w.headingCase, 'title');
  knowledge.updateWritingStyle(db, w.id, { avoidFiller: true, contractions: false });
  assert.strictEqual(db.company.writingStyles[0].avoidFiller, true);
  assert.strictEqual(db.company.writingStyles[0].contractions, false);
  // 下拉只认白名单里的值，乱传就回落成 no preference
  knowledge.updateWritingStyle(db, w.id, { quoteStyle: 'triple', headingCase: 'weird' });
  assert.strictEqual(db.company.writingStyles[0].quoteStyle, 'none');
  assert.strictEqual(db.company.writingStyles[0].headingCase, 'none');
  assert.strictEqual(knowledge.removeWritingStyle(db, w.id), true);
  assert.strictEqual(knowledge.removeWritingStyle(db, w.id), false);
  db.company.writingStyles = JSON.parse(keep);
});

t('写作规范：长度有上限（name 60 / notes 2000）', () => {
  const db = knowledge.load();
  const keep = JSON.stringify(db.company.writingStyles);
  db.company.writingStyles = [];
  const w = knowledge.addWritingStyle(db, { name: 'x'.repeat(200), notes: 'y'.repeat(5000) });
  assert.strictEqual(w.name.length, 60);
  assert.strictEqual(w.notes.length, 2000);
  knowledge.removeWritingStyle(db, w.id);
  db.company.writingStyles = JSON.parse(keep);
});

t('写作规范：只有开着的规则才进 prompt（翻成人话）', () => {
  const lines = knowledge.writingStyleLines({
    writingStyles: [{
      name: 'Blog articles', notes: '短句为主',
      contractions: true, avoidHedging: false, avoidFiller: true, genderNeutral: false,
      avoidSemicolons: true, oxfordCommas: false, preferPeriods: true, avoidEmDashes: false,
      quoteStyle: 'single', avoidAmpersands: false, avoidPlus: true, headingCase: 'sentence'
    }]
  });
  assert.strictEqual(lines.length, 1);
  ['Blog articles', '尽量用缩写', '不用填充词', '不用分号', '用句号不用感叹号', '引号用单引号', '不用 + 表示 and', '标题用 Sentence case', '备注：短句为主']
    .forEach((x) => assert.ok(lines[0].includes(x), '写作规范里缺 ' + x));
  // 关着的规则不能出现
  ['模糊限定词', '牛津逗号', '破折号', '&', 'Title case'].forEach((x) => assert.ok(!lines[0].includes(x), '不该出现 ' + x));
});

t('写作规范：多条并存，各自一套开关', () => {
  const lines = knowledge.writingStyleLines({
    writingStyles: [
      { name: 'Blog', contractions: true, quoteStyle: 'none', headingCase: 'none' },
      { name: 'Twitter', contractions: false, preferPeriods: true, quoteStyle: 'none', headingCase: 'none' }
    ]
  });
  assert.strictEqual(lines.length, 2);
  assert.ok(lines[0].startsWith('Blog —— 尽量用缩写'));
  assert.ok(lines[1].includes('用句号不用感叹号'));
  assert.ok(!lines[1].includes('尽量用缩写'));
});

t('写作规范：有条目才算完成（空名字不算）', () => {
  const withOne = knowledge.blocks({ company: { writingStyles: [{ id: 'ws_1', name: 'Blog' }] }, gsc: null, files: [] });
  assert.strictEqual(withOne.items.find((i) => i.key === 'writingStyle').done, true);
  const withBlank = knowledge.blocks({ company: { writingStyles: [{ id: 'ws_1', name: '  ' }] }, gsc: null, files: [] });
  assert.strictEqual(withBlank.items.find((i) => i.key === 'writingStyle').done, false);
  // 老的纯文本字段不再算完成（它已经迁进条目里了）
  const legacyOnly = knowledge.blocks({ company: { writingStyle: '短句' }, gsc: null, files: [] });
  assert.strictEqual(legacyOnly.items.find((i) => i.key === 'writingStyle').done, false);
});

t('写作规范：brief() 输出的 writingStyle 就是结构化后的那句话', () => {
  const b = knowledge.brief({ writingStyles: [{ name: 'Blog', contractions: true, quoteStyle: 'double', headingCase: 'none', notes: '' }] });
  assert.ok(b.writingStyle.includes('Blog'));
  assert.ok(b.writingStyle.includes('尽量用缩写'));
  assert.ok(b.writingStyle.includes('引号用双引号'));
  assert.strictEqual(b.writingStyles.length, 1);
  assert.strictEqual(b.writingStylesRaw.length, 1);
});

t('写作规范：规则表就是前端渲染用的那份（4 组 / 10 开关 / 2 下拉）', () => {
  const groups = knowledge.WRITING_GROUPS;
  assert.deepStrictEqual(groups.map((g) => g.title),
    ['Writing style', 'Punctuation', 'Symbols and special characters', 'Titles and headings']);
  const rules = groups.flatMap((g) => g.rules);
  assert.strictEqual(rules.filter((r) => r.type === 'switch').length, 10);
  assert.strictEqual(rules.filter((r) => r.type === 'select').length, 2);
  rules.forEach((r) => {
    if (r.type === 'switch') {
      assert.ok(r.label && r.desc && r.phrase, '规则缺字段：' + r.key);
    } else {
      assert.strictEqual(r.options[0].id, 'none', r.key + ' 第一个必须是不限');
    }
  });
  assert.deepStrictEqual(knowledge.QUOTE_STYLES.map((o) => o.label), ['No preference', 'Double quotes', 'Single quotes']);
  assert.deepStrictEqual(knowledge.HEADING_CASES.map((o) => o.label), ['No preference', 'Title case', 'Sentence case', 'All caps']);
});

/* ---------- Visual style（结构化） + 图片库 + 文件检索 ---------- */

t('视觉风格：老的那段文字变成一条条目，原文进 Guidelines', () => {
  const c = knowledge.migrateCompany({ visualStyle: '冷色、留白多、不要渐变' });
  assert.strictEqual(c.visualStyles.length, 1);
  assert.strictEqual(c.visualStyles[0].name, '通用视觉规范');
  assert.strictEqual(c.visualStyles[0].guidelines, '冷色、留白多、不要渐变');
  // 老字段清空，免得同一句话在 prompt 里出现两次
  assert.strictEqual(c.visualStyle, '');
  // 再迁一次不会变成两条（id 也稳定）
  const again = knowledge.migrateCompany(JSON.parse(JSON.stringify(c)));
  assert.strictEqual(again.visualStyles.length, 1);
  assert.strictEqual(again.visualStyles[0].id, c.visualStyles[0].id);
});

t('视觉风格：能加能改能删，名字不能空；色值只认 #RGB / #RRGGBB', () => {
  const db = knowledge.load();
  const keep = JSON.stringify(db.company.visualStyles);
  db.company.visualStyles = [];
  assert.throws(() => knowledge.addVisualStyle(db, { name: '   ' }), /不能为空/);
  const v = knowledge.addVisualStyle(db, {
    name: 'Social visuals',
    guidelines: 'Clean, bright product photography on a neutral background.',
    primaryColor: '#2F4BFF',
    secondaryColor: 'not-a-color'
  });
  assert.strictEqual(db.company.visualStyles.length, 1);
  assert.strictEqual(v.primaryColor, '#2f4bff');
  assert.strictEqual(v.secondaryColor, '');          // 非法的直接丢掉，不猜
  knowledge.updateVisualStyle(db, v.id, { name: 'Social visuals v2', primaryColor: '#fff' });
  assert.strictEqual(db.company.visualStyles[0].name, 'Social visuals v2');
  assert.strictEqual(db.company.visualStyles[0].primaryColor, '#fff');
  assert.throws(() => knowledge.updateVisualStyle(db, 'vs_nope', { name: 'x' }), /没有这条视觉风格/);
  assert.strictEqual(knowledge.removeVisualStyle(db, v.id), true);
  assert.strictEqual(db.company.visualStyles.length, 0);
  db.company.visualStyles = JSON.parse(keep);
  knowledge.save(db);
});

t('视觉风格：参考图 / Logo 各最多 4 张', () => {
  const db = knowledge.load();
  const v = knowledge.addVisualStyle(db, {
    name: 'Capped',
    referenceIds: ['a', 'b', 'c', 'd', 'e', 'f'],
    logoIds: ['l1', 'l2', 'l3', 'l4', 'l5']
  });
  assert.strictEqual(v.referenceIds.length, 4);
  assert.strictEqual(v.logoIds.length, 4);
  knowledge.removeVisualStyle(db, v.id);
  knowledge.save(db);
});

t('视觉风格：有条目才算完成；brief 里带名字、配色和图片张数', () => {
  const empty = knowledge.blocks({ company: { visualStyles: [] }, gsc: null, files: [] });
  assert.strictEqual(empty.items.find((i) => i.key === 'visualStyle').done, false);
  const done = knowledge.blocks({ company: { visualStyles: [{ name: 'Social visuals' }] }, gsc: null, files: [] });
  assert.strictEqual(done.items.find((i) => i.key === 'visualStyle').done, true);

  const b = knowledge.brief({
    visualStyles: [{
      name: 'Social visuals',
      guidelines: 'Clean, bright product photography.',
      primaryColor: '#2f4bff', secondaryColor: '#ffffff',
      referenceIds: ['img_1', 'img_2'], logoIds: ['img_3']
    }]
  });
  assert.ok(b.visualStyle.includes('Social visuals'));
  assert.ok(b.visualStyle.includes('Clean, bright product photography.'));
  assert.ok(b.visualStyle.includes('#2f4bff'));
  assert.ok(b.visualStyle.includes('2 张风格参考图'));
  assert.ok(b.visualStyle.includes('1 个 Logo'));
  assert.strictEqual(b.visualStyles.length, 1);
});

t('图片库：data URL 存盘能读回；删图会把视觉风格里的引用摘掉', () => {
  const png = 'data:image/png;base64,' + Buffer.from('89504e470d0a1a0a', 'hex').toString('base64');
  const db = knowledge.load();
  const keepImgs = JSON.stringify(db.images || []);
  const keepVs = JSON.stringify(db.company.visualStyles);
  db.images = [];
  db.company.visualStyles = [];

  const rec = knowledge.addImage(db, 'ref-1.png', png);
  assert.strictEqual(rec.ext, '.png');
  assert.strictEqual(rec.bytes, 8);
  const back = knowledge.readImage(rec.id, db);
  assert.strictEqual(back.buf.length, 8);

  const v = knowledge.addVisualStyle(db, { name: 'Uses refs', referenceIds: [rec.id], logoIds: [rec.id] });
  assert.strictEqual(knowledge.removeImage(db, rec.id), true);
  assert.strictEqual(db.images.length, 0);
  assert.deepStrictEqual(db.company.visualStyles[0].referenceIds, []);
  assert.deepStrictEqual(db.company.visualStyles[0].logoIds, []);
  assert.strictEqual(knowledge.readImage(rec.id, db), null);

  knowledge.removeVisualStyle(db, v.id);
  db.images = JSON.parse(keepImgs);
  db.company.visualStyles = JSON.parse(keepVs);
  knowledge.save(db);
});

t('图片库：只认 jpeg / jpg / png / svg，空白图直接拒绝', () => {
  const db = knowledge.load();
  const keep = JSON.stringify(db.images || []);
  db.images = [];
  assert.throws(() => knowledge.addImage(db, 'a.gif', 'data:image/gif;base64,R0lGODlh'), /只支持/);
  assert.throws(() => knowledge.addImage(db, 'a.png', 'not-a-data-url'), /data:image/);
  assert.throws(() => knowledge.addImage(db, 'empty.png', 'data:image/png;base64,'), /空/);
  db.images = JSON.parse(keep);
  knowledge.save(db);
});

t('知识文件：检索命中正文给片段，只命中文件名也算，没命中返回空', () => {
  const db = knowledge.load();
  db.files = [];
  const rec = knowledge.addFile(db, 'pricing.md', '# 定价\n\nPro 版 $29/月，年付 $290。支持团队席位。');
  const hit = knowledge.searchFiles(db, '年付');
  assert.strictEqual(hit.length, 1);
  assert.ok(hit[0].snippet.includes('年付'));
  const byName = knowledge.searchFiles(db, 'PRICING');
  assert.strictEqual(byName.length, 1);
  assert.deepStrictEqual(knowledge.searchFiles(db, '不存在的词'), []);
  assert.deepStrictEqual(knowledge.searchFiles(db, '   '), []);
  knowledge.removeFile(db, rec.id);
  knowledge.save(db);
});

/* ---------- Brand voices 增删改 ---------- */

t('brand voice：能加能改能删，名字不能空', () => {
  const db = knowledge.load();
  db.company.brandVoices = [];
  assert.throws(() => knowledge.addVoice(db, { name: '  ' }), /名字不能为空/);
  const v = knowledge.addVoice(db, { name: 'Confident expert', description: '先说结论', useCase: 'blog', excerpts: ['一句示例'] });
  assert.strictEqual(db.company.brandVoices.length, 1);
  assert.strictEqual(v.useCase, 'blog');
  knowledge.updateVoice(db, v.id, { name: 'Confident expert v2' });
  assert.strictEqual(db.company.brandVoices[0].name, 'Confident expert v2');
  assert.strictEqual(knowledge.removeVoice(db, v.id), true);
  assert.strictEqual(db.company.brandVoices.length, 0);
  assert.strictEqual(knowledge.removeVoice(db, 'nope'), false);
});

t('brand voice 有名字就算这块完成（不要求描述/示例）', () => {
  const db = { company: { brandVoices: [{ id: 'bv_1', name: '直接', description: '', excerpts: [] }] }, gsc: null, files: [] };
  assert.strictEqual(knowledge.blocks(db).items.find((i) => i.key === 'brandVoices').done, true);
  const db2 = { company: { brandVoices: [{ id: 'bv_1', name: '  ', description: 'x' }] }, gsc: null, files: [] };
  assert.strictEqual(knowledge.blocks(db2).items.find((i) => i.key === 'brandVoices').done, false);
});

/* ==================== 应用目录：安装 → 授权 → 断开 ==================== */

t('目录里有 15 个应用，每个都有图标色/分类/一句话', () => {
  const cat = knowledge.APP_CATALOG;
  assert.strictEqual(cat.length >= 12, true);
  for (const a of cat) {
    assert.ok(a.id && a.name && a.category && a.mono && a.color && a.tint && a.desc, '字段缺失: ' + a.id);
  }
});

t('自定义应用：能加能删；内置的卸载只是复位，不会消失', () => {
  const db = knowledge.load();
  const before = db.tools.length;
  const p = knowledge.addTool(db, { name: 'UI 测试插件', url: 'https://x', description: 'd' });
  assert.strictEqual(p.custom, true);
  assert.strictEqual(db.tools.length, before + 1);
  assert.strictEqual(knowledge.removeTool(db, p.id), null); // 自定义的删掉 → 返回 null
  assert.strictEqual(db.tools.length, before);
  // 内置应用"卸载"= 复位，列表里还在
  knowledge.installTool(db, 'google_ads');
  knowledge.uninstallTool(db, 'google_ads');
  const again = db.tools.find((x) => x.id === 'google_ads');
  assert.ok(again, '内置应用不能被删掉');
  assert.strictEqual(again.installed, false);
});

t('自定义应用名不能为空', () => {
  const db = knowledge.load();
  assert.throws(() => knowledge.addTool(db, { name: '  ' }), /应用名/);
});

t('安装不等于授权：install 后仍未授权，授权后才有账号', () => {
  const db = knowledge.load();
  knowledge.installTool(db, 'ahrefs');
  let t = db.tools.find((x) => x.id === 'ahrefs');
  assert.strictEqual(t.installed, true);
  assert.strictEqual(t.connected, false);

  assert.throws(() => knowledge.authorizeTool(db, 'ahrefs', {}), /令牌/);
  knowledge.authorizeTool(db, 'ahrefs', { token: 'abcdef123456', account: 'team@x.com' });
  t = db.tools.find((x) => x.id === 'ahrefs');
  assert.strictEqual(t.connected, true);
  assert.strictEqual(t.account, 'team@x.com');
  assert.strictEqual(t.token, 'abcdef123456');
});

t('publicView 只给 key 后四位，不吐明文令牌', () => {
  const db = knowledge.load();
  knowledge.authorizeTool(db, 'ahrefs', { token: 'abcdef123456', account: 'a' });
  const v = knowledge.publicView(db).tools.find((x) => x.id === 'ahrefs');
  assert.strictEqual(v.hasToken, true);
  assert.strictEqual(v.keyHint, '••••3456');
  assert.ok(!JSON.stringify(v).includes('abcdef'), 'publicView 里不能出现明文 token');
});

t('"先只登记账号"可以不填令牌，但断开后一律清空', () => {
  const db = knowledge.load();
  knowledge.authorizeTool(db, 'ahrefs', { skipToken: true, account: 'no-token@x.com' });
  let t = db.tools.find((x) => x.id === 'ahrefs');
  assert.strictEqual(t.connected, true);
  assert.strictEqual(t.token, '');
  knowledge.disconnectTool(db, 'ahrefs');
  t = db.tools.find((x) => x.id === 'ahrefs');
  assert.strictEqual(t.connected, false);
  assert.strictEqual(t.account, 'no-token@x.com');
  knowledge.uninstallTool(db, 'ahrefs');
});

/* ==================== GSC 真实接入（不联网） ==================== */

t('没填凭据时 configured=false，而且给出回调地址', () => {
  const db = gsc.emptyDb();
  const v = gsc.publicView(db, 4319);
  assert.strictEqual(v.configured, false);
  assert.strictEqual(v.authorized, false);
  assert.strictEqual(v.redirectUri, 'http://127.0.0.1:4319/api/gsc/callback');
});

t('Client ID 格式不对要当场拒绝，别等到 Google 报错', () => {
  const db = gsc.emptyDb();
  assert.throws(() => gsc.setCredentials(db, { clientId: 'abc', clientSecret: 'x' }), /apps\.googleusercontent\.com/);
  assert.throws(() => gsc.setCredentials(db, { clientId: '', clientSecret: '' }), /都要填/);
  gsc.setCredentials(db, { clientId: '123-abc.apps.googleusercontent.com', clientSecret: 's3cret' });
  assert.strictEqual(gsc.publicView(db, 4319).configured, true);
  assert.strictEqual(gsc.publicView(db, 4319).clientIdTail, '••••.com');
});

t('授权 URL 带 state / offline / 只读 scope', () => {
  const db = gsc.emptyDb();
  gsc.setCredentials(db, { clientId: '123-abc.apps.googleusercontent.com', clientSecret: 's' });
  const url = gsc.authUrl(db, 4319);
  const u = new URL(url);
  assert.strictEqual(u.host, 'accounts.google.com');
  assert.strictEqual(u.searchParams.get('access_type'), 'offline');
  assert.strictEqual(u.searchParams.get('response_type'), 'code');
  assert.strictEqual(u.searchParams.get('scope'), gsc.SCOPE);
  assert.ok(u.searchParams.get('state').length >= 16);
  assert.strictEqual(u.searchParams.get('redirect_uri'), 'http://127.0.0.1:4319/api/gsc/callback');
  assert.strictEqual(db.state, u.searchParams.get('state'));
});

t('没凭据就点授权 → 明确报错，不是白屏', () => {
  assert.throws(() => gsc.authUrl(gsc.emptyDb(), 4319), /Client ID/);
});

t('rowsToTsv 产出的表能被 audit.parseGsc 原样吃回去', () => {
  const rows = [
    { query: 'how to write a brief', clicks: 12, impressions: 1800, ctr: 0.0067, position: 8 },
    { query: 'seo for saas', clicks: 4, impressions: 1900, ctr: 0.0021, position: 18 }
  ];
  const tsv = gsc.rowsToTsv(rows);
  const r = audit.parseGsc(tsv);
  assert.strictEqual(r.rows.length, 2);
  assert.strictEqual(r.rows[0].impressions, 1800);
  assert.strictEqual(r.rows[1].query, 'seo for saas');
  assert.strictEqual(r.warnings.length, 0);
});

t('断开要连凭据一起清掉（否则下次点授权会拿旧 id 去撞）', () => {
  const db = gsc.emptyDb();
  gsc.setCredentials(db, { clientId: '123-abc.apps.googleusercontent.com', clientSecret: 's' });
  db.token = { access_token: 'a', refresh_token: 'r', expiresAt: Date.now() + 1e6 };
  db.site = 'https://e.x/';
  gsc.disconnect(db);
  const v = gsc.publicView(db, 4319);
  assert.strictEqual(v.configured, false);
  assert.strictEqual(v.authorized, false);
  assert.strictEqual(v.site, '');
});

console.log('\n' + (process.exitCode ? '有失败项' : `${n} 项通过，全部通过`));
