'use strict';
/**
 * Content 列表单测（lib/content.js）
 *
 * 这一层是纯函数 + 文件存取，不用起服务、不用浏览器。
 * 重点验证：类型/状态/列的口径、筛选与分页的边界、状态推导（和编辑器同一份真相）、
 * campaign 同步的幂等性、以及「没数据源就留空」不被偷偷编造。
 */
const assert = require('assert');
const C = require('../lib/content');

let n = 0;
const t = (name, fn) => {
  try { fn(); n++; console.log('  ok  ' + name); }
  catch (e) { console.log('  ✗  ' + name + '\n      ' + e.message); process.exitCode = 1; }
};

const pad = (k) => String(k).padStart(2, '0');
const day = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const fresh = () => C.emptyDb();

function seed() {
  const db = fresh();
  C.create(db, { type: 'article', title: 'B2B 内容选题矩阵', tags: ['seo'], keywords: ['b2b content'] });
  C.create(db, { type: 'social', title: 'Launch post', tags: ['launch'] });
  C.create(db, { type: 'newsletter', title: 'Cold email v2' });
  C.create(db, { type: 'video', title: 'Short-form shotlist' });
  C.create(db, { type: 'campaign', title: 'Q4 出海战役' });
  return db;
}

console.log('\n[content.meta] 类型 / 状态 / 分组 / 列的口径');
t('9 种内容类型，Article 打头', () => {
  assert.strictEqual(C.TYPES.length, 9);
  assert.deepStrictEqual(C.TYPES.map((x) => x.label), [
    'Article', 'Social post', 'Webpage', 'Newsletter', 'Video', 'Webinar', 'Ebook', 'Podcast', 'Campaign'
  ]);
});
t('4 个状态', () => {
  assert.deepStrictEqual(C.STATUSES.map((s) => s.label), ['Draft', 'Pending approval', 'Scheduled', 'Published']);
});
t('5 个导航分组，Media 有 3 个子项', () => {
  assert.deepStrictEqual(C.GROUPS.map((g) => g.label), ['Content', 'Articles', 'Social posts', 'Broadcasts', 'Media']);
  assert.strictEqual(C.GROUPS[4].id, 'media');
  assert.deepStrictEqual(C.MEDIA_SUBS.map((s) => s.label), ['Workspace files', 'Unsplash', 'Canva']);
});
t('16 列表头顺序与文案完全对齐', () => {
  assert.deepStrictEqual(C.COLUMNS.map((c) => c.label), [
    'Title', 'Status', 'Effective date', 'Approval status', 'Collaborator', 'Campaign', 'Language',
    'Due date', 'Author', 'Impressions', 'Reads', 'Category', 'Tag', 'Keyword', 'GEO & SEO score', 'Content gap score'
  ]);
  assert.strictEqual(C.COLUMNS[0].key, 'title');
  assert.strictEqual(C.COLUMNS.filter((c) => c.sort).length, 14); // Tag / Keyword 不排序
});

console.log('\n[content.create] 建条目的校验与默认值');
t('类型不对直接报错', () => {
  assert.throws(() => C.create(fresh(), { type: 'podcastx', title: 'x' }), /内容类型不对/);
  assert.throws(() => C.create(fresh(), { title: '没类型' }), /内容类型不对/);
});
t('标题必填（全空格也不行）', () => {
  assert.throws(() => C.create(fresh(), { type: 'article', title: '   ' }), /标题不能为空/);
});
t('默认值：owner=me、状态=draft、category=类型名', () => {
  const db = fresh();
  const it = C.create(db, { type: 'social', title: '  首帖  ' });
  assert.strictEqual(it.title, '首帖');       // 两端空格被裁掉
  assert.strictEqual(it.collaborator, 'me');
  assert.strictEqual(it.status, 'draft');
  assert.strictEqual(it.category, 'Social post');
  assert.ok(/^ct_/.test(it.id));
});
t('指标默认留空而不是 0（没有数据源就不编）', () => {
  const it = C.create(fresh(), { type: 'article', title: 'x' });
  assert.strictEqual(it.impressions, null);
  assert.strictEqual(it.reads, null);
  assert.strictEqual(it.geo, null);
  assert.strictEqual(it.gap, null);
});

console.log('\n[content.query] 分组 / 状态 / 搜索 / 排序 / 分页');
t('分组只看自己那类', () => {
  const db = seed();
  assert.strictEqual(C.query(db, { group: 'articles' }).total, 1);
  assert.strictEqual(C.query(db, { group: 'social' }).total, 2);   // social + video
  assert.strictEqual(C.query(db, { group: 'broadcast' }).total, 1); // newsletter
  assert.strictEqual(C.query(db, { group: 'content' }).total, 5);   // 全部
});
t('Assigned to me 命中 owner=me 的条目', () => {
  const db = seed();
  assert.strictEqual(C.query(db, { group: 'content', status: 'assigned' }).total, 5);
  C.update(db, db.items[0].id, { collaborator: '' });
  assert.strictEqual(C.query(db, { group: 'content', status: 'assigned' }).total, 4);
});
t('状态筛选', () => {
  const db = seed();
  assert.strictEqual(C.query(db, { group: 'content', status: 'draft' }).total, 5);
  assert.strictEqual(C.query(db, { group: 'content', status: 'published' }).total, 0);
});
t('搜索命中标题 / 标签 / 关键词', () => {
  const db = seed();
  assert.strictEqual(C.query(db, { group: 'content', q: 'cold' }).total, 1);
  assert.strictEqual(C.query(db, { group: 'content', q: 'launch' }).total, 1);
  assert.strictEqual(C.query(db, { group: 'content', q: 'b2b content' }).total, 1);
  assert.strictEqual(C.query(db, { group: 'content', q: '不存在的词' }).total, 0);
});
t('排序可正可反，都是同一条规则', () => {
  const db = seed();
  const asc = C.query(db, { group: 'content', sort: 'title', dir: 'asc' }).items.map((x) => x.title);
  const desc = C.query(db, { group: 'content', sort: 'title', dir: 'desc' }).items.map((x) => x.title);
  assert.deepStrictEqual(asc.slice().reverse(), desc);
});
t('分页：from/to/pages 算对，越界页收敛到最后一页', () => {
  const db = seed();
  const p1 = C.query(db, { group: 'content', size: 2, page: 1 });
  assert.strictEqual(p1.total, 5);
  assert.strictEqual(p1.pages, 3);
  assert.strictEqual(p1.from, 1);
  assert.strictEqual(p1.to, 2);
  const p3 = C.query(db, { group: 'content', size: 2, page: 3 });
  assert.strictEqual(p3.page, 3);
  assert.strictEqual(p3.from, 5);
  assert.strictEqual(p3.to, 5);
  const p9 = C.query(db, { group: 'content', size: 2, page: 9 });
  assert.strictEqual(p9.page, 3);
});
t('一条都没有时显示 1-0 of 0（不显示 0-0）', () => {
  const r = C.query(fresh(), { group: 'content' });
  assert.strictEqual(r.total, 0);
  assert.strictEqual(r.from, 1);
  assert.strictEqual(r.to, 0);
  assert.strictEqual(r.pages, 1);
  assert.deepStrictEqual(r.items, []);
});
t('未知排序字段回落到 Effective date，不报错', () => {
  const r = C.query(seed(), { group: 'content', sort: 'DROP TABLE' });
  assert.strictEqual(r.sort, 'effectiveDate');
});

console.log('\n[content.update] 改字段的白名单');
t('标题不能改成空', () => {
  const db = seed();
  assert.throws(() => C.update(db, db.items[0].id, { title: '  ' }), /标题不能为空/);
});
t('未知 id 是 404', () => {
  assert.throws(() => C.update(fresh(), 'ct_nope', { title: 'x' }), /没有这条内容/);
});
t('状态只能是 4 个之一', () => {
  const db = seed();
  assert.throws(() => C.update(db, db.items[0].id, { status: 'done' }), /状态不对/);
  const it = C.update(db, db.items[0].id, { status: 'pending' });
  assert.strictEqual(it.status, 'pending');
  assert.strictEqual(it.statusManual, true);   // 手动改过就不再被资产推导覆盖
});
t('审核状态白名单 + pending 会把状态推到 Pending approval', () => {
  const db = seed();
  const id = db.items[0].id;
  assert.throws(() => C.update(db, id, { approval: 'yes' }), /审核状态不对/);
  C.update(db, id, { approval: 'pending' });
  assert.strictEqual(C.statusOf(db.items[0]), 'pending');
});
t('标签最多 8 个、单个 24 字', () => {
  const db = seed();
  const it = C.update(db, db.items[0].id, { tags: Array.from({ length: 12 }, (_, i) => 'tag' + i) });
  assert.strictEqual(it.tags.length, 8);
  const long = C.update(db, db.items[0].id, { tags: ['x'.repeat(80)] });
  assert.strictEqual(long.tags[0].length, 24);
});
t('指标传空字符串会变成 null（不写成 0）', () => {
  const db = seed();
  const it = C.update(db, db.items[0].id, { reads: '' });
  assert.strictEqual(it.reads, null);
  const it2 = C.update(db, db.items[0].id, { reads: '128' });
  assert.strictEqual(it2.reads, 128);
});

console.log('\n[content.remove/duplicate] 删与复制');
t('删除只删指定条目', () => {
  const db = seed();
  const id = db.items[0].id;
  assert.strictEqual(C.remove(db, id), true);
  assert.strictEqual(db.items.length, 4);
  assert.strictEqual(C.find(db, id), null);
  assert.strictEqual(C.remove(db, id), false);
});
t('复制带 (copy) 后缀，且不带原来的 campaign 绑定', () => {
  const db = seed();
  const src = db.items[0];
  src.campaignId = 'cp_1';
  src.assetId = 'as_1';
  const copy = C.duplicate(db, src.id);
  assert.strictEqual(copy.title, src.title + ' (copy)');
  assert.strictEqual(copy.campaignId, '');
  assert.strictEqual(copy.assetId, '');
  assert.notStrictEqual(copy.id, src.id);
  assert.strictEqual(db.items.length, 6);
});

console.log('\n[content.derive] 状态从资产推导 —— 和编辑器不能各说一套');
const cpWith = (versions, scheduledAt) => [{
  id: 'cp_1', name: 'Q4 战役', language: 'zh', fromName: 'Aiden',
  assets: [{ id: 'as_1', channel: 'x_post', title: '首发帖', current: versions.length ? versions[versions.length - 1].v : 0, versions, scheduledAt }]
}];
const itemOn = (extra) => Object.assign(
  C.normalize({ id: 'ct_as_as_1', type: 'social', title: '首发帖', campaignId: 'cp_1', assetId: 'as_1' }),
  extra || {}
);

t('还没生成 = Draft', () => {
  const it = C.derive(itemOn(), cpWith([], null));
  assert.strictEqual(it.status, 'draft');
  assert.strictEqual(it.effectiveDate, '');
});
t('有草稿 + 排了未来日期 = 还是 Draft（没批准不算 Scheduled）', () => {
  const it = C.derive(itemOn(), cpWith([{ v: 1, status: 'draft' }], day(30)));
  assert.strictEqual(it.status, 'draft');
  assert.strictEqual(it.effectiveDate, day(30));
});
t('已批准 + 未来日期 = Scheduled', () => {
  const it = C.derive(itemOn(), cpWith([{ v: 1, status: 'approved' }], day(30)));
  assert.strictEqual(it.status, 'scheduled');
  assert.strictEqual(it.approval, 'approved');
});
t('已批准 + 没排期 = Published', () => {
  const it = C.derive(itemOn(), cpWith([{ v: 1, status: 'approved' }], null));
  assert.strictEqual(it.status, 'published');
});
t('已批准 + 过去的日期 = Published', () => {
  const it = C.derive(itemOn(), cpWith([{ v: 1, status: 'approved' }], day(-3)));
  assert.strictEqual(it.status, 'published');
});
t('提交审核 → Pending approval', () => {
  const it = C.derive(itemOn({ approval: 'pending' }), cpWith([{ v: 1, status: 'draft' }], null));
  assert.strictEqual(it.status, 'pending');
});
t('手动改过状态就不再被推导覆盖', () => {
  const it = C.derive(itemOn({ status: 'published', statusManual: true }), cpWith([{ v: 1, status: 'draft' }], null));
  assert.strictEqual(it.status, 'published');
});
t('标题 / 语言 / 作者从资产和 campaign 回填', () => {
  const cps = cpWith([{ v: 1, status: 'draft' }], null);
  cps[0].assets[0].title = '改过的标题';
  const it = C.derive(itemOn(), cps);
  assert.strictEqual(it.title, '改过的标题');
  assert.strictEqual(it.language, 'zh');
  assert.strictEqual(it.author, 'Aiden');
  assert.strictEqual(it.campaign, 'Q4 战役');
});
t('资产没了就原样返回，不炸', () => {
  const it = C.derive(itemOn(), []);
  assert.strictEqual(it.status, 'draft');
});
t('query 不修改传入的条目（推导走副本）', () => {
  const db = fresh();
  const it = C.normalize({ id: 'ct_as_as_1', type: 'social', title: 'x', campaignId: 'cp_1', assetId: 'as_1' });
  db.items.push(it);
  const cps = cpWith([{ v: 1, status: 'approved' }], day(10));
  const r = C.query(db, { group: 'content' }, cps);
  assert.strictEqual(r.items[0].status, 'scheduled');
  assert.strictEqual(db.items[0].status, 'draft');   // 磁盘上的没被改
});

console.log('\n[content.sync] 老 campaign / 资产也要出现在列表里');
const cps = () => ([{
  id: 'cp_a', name: '首发 campaign', language: 'en', fromName: 'Aiden', createdAt: '2026-01-01T00:00:00.000Z',
  assets: [
    { id: 'as_a', channel: 'x_post', title: 'Launch post', versions: [], current: 0, scheduledAt: null },
    { id: 'as_b', channel: 'cold_email', title: 'Cold email', versions: [], current: 0, scheduledAt: null }
  ]
}, {
  id: 'cp_b', name: '显式 Campaign', contentType: 'campaign', language: 'zh',
  assets: [{ id: 'as_c', channel: 'video_shotlist', title: '分镜', versions: [], current: 0, scheduledAt: null }]
}]);

t('每个资产一条；Campaign 只有在显式创建时才单独成行', () => {
  const db = fresh();
  assert.strictEqual(C.sync(db, cps()), true);
  assert.strictEqual(db.items.length, 4);   // 3 个资产 + 1 个显式 campaign
  const types = db.items.map((x) => x.type).sort();
  assert.deepStrictEqual(types, ['campaign', 'newsletter', 'social', 'video']);
});
t('同步是幂等的：第二次不再新增', () => {
  const db = fresh();
  C.sync(db, cps());
  assert.strictEqual(C.sync(db, cps()), false);
  assert.strictEqual(db.items.length, 4);
});
t('渠道映射到内容类型', () => {
  const db = fresh();
  C.sync(db, cps());
  const byTitle = {};
  db.items.forEach((x) => { byTitle[x.title] = x.type; });
  assert.strictEqual(byTitle['Launch post'], 'social');
  assert.strictEqual(byTitle['Cold email'], 'newsletter');
  assert.strictEqual(byTitle['分镜'], 'video');
});
t('资产被删：条目解绑但保留（不静默丢用户的东西）', () => {
  const db = fresh();
  C.sync(db, cps());
  const next = cps();
  next[0].assets = next[0].assets.filter((a) => a.id !== 'as_a');
  assert.strictEqual(C.sync(db, next), true);
  const it = db.items.find((x) => x.title === 'Launch post');
  assert.ok(it, '条目应该还在');
  assert.strictEqual(it.assetId, '');
  assert.strictEqual(it.campaignId, '');
  assert.strictEqual(it.statusManual, true);
});
t('同步出来的条目 owner 默认是自己', () => {
  const db = fresh();
  C.sync(db, cps());
  assert.ok(db.items.every((x) => x.collaborator === 'me'));
});

console.log('\n[content.counts/publicView] 左侧树上的数字');
t('每个分组都有 all + 5 个状态计数', () => {
  const db = fresh();
  const list = cps();
  C.sync(db, list);
  const c = C.counts(db, list);
  assert.deepStrictEqual(Object.keys(c.content).sort(), ['all', 'assigned', 'draft', 'pending', 'published', 'scheduled']);
  assert.strictEqual(c.content.all, 4);
  assert.strictEqual(c.content.draft, 4);
  assert.strictEqual(c.social.all, 2);   // video 也算 Social posts
  assert.strictEqual(c.broadcast.all, 1);
  assert.deepStrictEqual(c.media, { all: 0 });
});
t('全量视图带上 types/columns/counts，行是推导后的', () => {
  const db = fresh();
  const list = cps();
  C.sync(db, list);
  const v = C.publicView(db, list);
  assert.strictEqual(v.types.length, 9);
  assert.strictEqual(v.columns.length, 16);
  assert.strictEqual(v.groups.length, 5);
  assert.ok(v.counts.content);
  assert.strictEqual(v.items.length, 4);
});
t('分组归属：video 归 Social posts，newsletter 归 Broadcasts', () => {
  assert.strictEqual(C.inGroup({ type: 'video' }, 'social'), true);
  assert.strictEqual(C.inGroup({ type: 'video' }, 'articles'), false);
  assert.strictEqual(C.inGroup({ type: 'newsletter' }, 'broadcast'), true);
  assert.strictEqual(C.inGroup({ type: 'ebook' }, 'articles'), true);
  assert.strictEqual(C.inGroup({ type: 'campaign' }, 'articles'), false);
});

console.log(`\n${process.exitCode ? '✗ 有失败' : '✓ content 单测全部通过'} ${n} 项`);
