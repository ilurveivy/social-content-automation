'use strict';
/**
 * Agent 层单测：动作解析、上下文拼装、离线模板、动作执行校验。
 * 这一层最容易"看起来在工作"：模型说了什么、程序到底执行了什么，必须分开测。
 */
const assert = require('assert');
const path = require('path');
const agent = require('../lib/agent');
const actions = require('../lib/actions');
const channels = require('../lib/channels');

let n = 0;
const t = (name, fn) => {
  try { fn(); n++; console.log('  ok  ' + name); }
  catch (e) { console.log('  ✗   ' + name + '\n      ' + e.message); process.exitCode = 1; }
};

console.log('\n[parseActions] 从模型回复里安全地抠动作');
t('标准 ```json 代码块', () => {
  const a = agent.parseActions('好的，我这样做：\n```json\n{"actions":[{"type":"create_campaign","name":"十月推广"}]}\n```');
  assert.strictEqual(a.length, 1);
  assert.strictEqual(a[0].type, 'create_campaign');
  assert.strictEqual(a[0].name, '十月推广');
});
t('没有语言标记的代码块', () => {
  const a = agent.parseActions('```\n{"actions":[{"type":"schedule_asset","channel":"x_post","scheduledAt":"2026-12-01"}]}\n```');
  assert.strictEqual(a[0].channel, 'x_post');
});
t('裸 JSON（模型没加代码块）', () => {
  const a = agent.parseActions('{"actions":[{"type":"update_knowledge","field":"tone","value":"直接"}]}');
  assert.strictEqual(a[0].field, 'tone');
});
t('不是 JSON 就返回空数组，不抛错', () => {
  assert.deepStrictEqual(agent.parseActions('我觉得应该先做 Reddit。'), []);
  assert.deepStrictEqual(agent.parseActions(''), []);
  assert.deepStrictEqual(agent.parseActions(null), []);
});
t('未知动作类型被丢掉', () => {
  const a = agent.parseActions('```json\n{"actions":[{"type":"drop_database"},{"type":"create_campaign","name":"ok"}]}\n```');
  assert.strictEqual(a.length, 1);
  assert.strictEqual(a[0].type, 'create_campaign');
});
t('动作数量上限 6 个', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ type: 'create_campaign', name: 'c' + i }));
  const a = agent.parseActions('```json\n' + JSON.stringify({ actions: many }) + '\n```');
  assert.strictEqual(a.length, 6);
});
t('数组字段被规范化成字符串数组', () => {
  const a = agent.parseActions('```json\n{"actions":[{"type":"create_campaign","name":"x","sellingPoints":"单条"}]}\n```');
  assert.deepStrictEqual(a[0].sellingPoints, ['单条']);
});

console.log('\n[stripActions] 给人看的部分不能带 JSON');
t('去掉代码块只留说明', () => {
  const out = agent.stripActions('方案如下：\n```json\n{"actions":[]}\n```\n先定主张。');
  assert.ok(!out.includes('actions'));
  assert.ok(out.includes('先定主张'));
});

console.log('\n[buildContext] 上下文必须如实反映"有/没有"');
const knFull = {
  company: { name: 'eSheep.ai', oneLiner: '一稿七渠道', products: ['适配'], audiences: ['出海 SaaS'], competitors: ['Storychief'], differentiators: ['规则带出处'], tone: '直接', proofPoints: ['14/14 满分'] },
  gsc: { connected: false, site: '' },
  tools: [{ id: 'google_ads', name: 'Google Ads', connected: true, data: '花费1200,线索34' }, { id: 'stripe', name: 'Stripe', connected: false, data: '不该出现' }],
  files: [{ id: 'kf_1', name: 'pricing.md', chars: 20 }]
};
t('公司字段都进来了', () => {
  const c = agent.buildContext({ knowledge: knFull, campaigns: [], calendar: [], files: { kf_1: '定价 $29/月' } });
  ['eSheep.ai', '一稿七渠道', 'Storychief', '规则带出处', '14/14 满分'].forEach((s) => assert.ok(c.includes(s), '缺 ' + s));
});
t('未绑定 GSC 时明确标注，不许编数据', () => {
  const c = agent.buildContext({ knowledge: knFull, campaigns: [], calendar: [], files: {} });
  assert.ok(c.includes('未绑定'));
  assert.ok(c.includes('待数据验证'));
});
t('只带已接入工具的数据', () => {
  const c = agent.buildContext({ knowledge: knFull, campaigns: [], calendar: [], files: {} });
  assert.ok(c.includes('花费1200'));
  assert.ok(!c.includes('不该出现'));
});
t('知识文件正文被截断后带进来', () => {
  const big = 'A'.repeat(5000);
  const c = agent.buildContext({ knowledge: knFull, campaigns: [], calendar: [], files: { kf_1: big } });
  assert.ok(c.includes('pricing.md'));
  assert.ok(c.length < 12000, '上下文太长：' + c.length);
});
t('campaign 和排期带进来', () => {
  const c = agent.buildContext({
    knowledge: knFull,
    campaigns: [{ id: 'cp_1', name: '十月', assets: [{ channel: 'x_post', scheduledAt: '2026-11-20' }] }],
    calendar: [{ scheduledAt: '2026-11-20', channelLabel: 'X 帖子', title: '首发', status: 'draft' }],
    files: {}
  });
  assert.ok(c.includes('cp_1'));
  assert.ok(c.includes('2026-11-20'));
});

console.log('\n[planTemplate] 离线时也只能给真实可执行的东西');
t('知识为空 → 不给动作，先要资料', () => {
  const r = agent.planTemplate({ knowledge: { company: {}, files: [] }, campaigns: [] });
  assert.deepStrictEqual(r.actions, []);
  assert.ok(r.reply.includes('Company knowledge'));
});
t('有知识 + 无 campaign → 建一个，字段来自知识库', () => {
  const r = agent.planTemplate({ knowledge: knFull, campaigns: [] });
  assert.strictEqual(r.actions.length, 1);
  const a = r.actions[0];
  assert.strictEqual(a.type, 'create_campaign');
  assert.ok(a.name.includes('eSheep.ai'));
  assert.deepStrictEqual(a.sellingPoints, ['规则带出处']);
  assert.ok(a.rawMaterial.includes('一稿七渠道'));
});
t('已有 3 个 campaign 不再乱建', () => {
  const r = agent.planTemplate({ knowledge: knFull, campaigns: [{}, {}, {}] });
  assert.deepStrictEqual(r.actions, []);
});

console.log('\n[execute] 动作执行必须能挡住坏输入');
function mkCtx() {
  const db = { version: 2, campaigns: [] };
  const ctx = {
    db,
    uid: (p) => p + '_' + Math.random().toString(16).slice(2, 8),
    nowIso: () => new Date().toISOString(),
    briefView: (cp) => cp,
    runAndAttach: (cp, asset, body) => {
      const v = { v: asset.versions.length + 1, body, variant: 'A', source: 'agent', status: 'draft', checks: { score: 100, mustFail: 0, results: [] } };
      asset.versions.push(v);
      asset.current = v.v;
      return v;
    }
  };
  return ctx;
}
t('create_campaign 落库', () => {
  const ctx = mkCtx();
  const r = actions.execute({ type: 'create_campaign', name: '十月推广', sellingPoints: ['a'] }, ctx);
  assert.ok(r.ok);
  assert.strictEqual(ctx.db.campaigns.length, 1);
  assert.strictEqual(ctx.db.campaigns[0].name, '十月推广');
});
t('create_campaign 没有 name 直接报错', () => {
  const ctx = mkCtx();
  assert.throws(() => actions.execute({ type: 'create_campaign' }, ctx), /缺 name/);
  assert.strictEqual(ctx.db.campaigns.length, 0);
});
t('write_asset 会新建资产并写入版本', () => {
  const ctx = mkCtx();
  actions.execute({ type: 'create_campaign', name: 'c1' }, ctx);
  const r = actions.execute({ type: 'write_asset', channel: 'x_post', body: '正文内容' }, ctx);
  assert.ok(r.ok);
  const cp = ctx.db.campaigns[0];
  assert.strictEqual(cp.assets.length, 1);
  assert.strictEqual(cp.assets[0].channel, 'x_post');
  assert.strictEqual(cp.assets[0].type, channels.assetTypeOf('x_post'));
  assert.strictEqual(cp.assets[0].versions.length, 1);
});
t('write_asset 空正文被拒', () => {
  const ctx = mkCtx();
  actions.execute({ type: 'create_campaign', name: 'c1' }, ctx);
  assert.throws(() => actions.execute({ type: 'write_asset', channel: 'x_post', body: '  ' }, ctx), /body 为空/);
});
t('未知渠道被拒', () => {
  const ctx = mkCtx();
  actions.execute({ type: 'create_campaign', name: 'c1' }, ctx);
  assert.throws(() => actions.execute({ type: 'write_asset', channel: 'myspace', body: 'x' }, ctx), /未知渠道/);
});
t('campaignId 不存在时退回到最近一个 campaign', () => {
  const ctx = mkCtx();
  actions.execute({ type: 'create_campaign', name: 'c1' }, ctx);
  const r = actions.execute({ type: 'write_asset', campaignId: 'cp_fake', channel: 'x_post', body: '正文' }, ctx);
  assert.ok(r.ok);
  assert.strictEqual(ctx.db.campaigns[0].assets.length, 1);
});
t('schedule_asset 只接受 YYYY-MM-DD', () => {
  const ctx = mkCtx();
  actions.execute({ type: 'create_campaign', name: 'c1' }, ctx);
  assert.throws(() => actions.execute({ type: 'schedule_asset', channel: 'x_post', scheduledAt: '2026/12/01' }, ctx), /YYYY-MM-DD/);
  const r = actions.execute({ type: 'schedule_asset', channel: 'x_post', scheduledAt: '2026-12-01' }, ctx);
  assert.ok(r.ok);
  assert.strictEqual(ctx.db.campaigns[0].assets[0].scheduledAt, '2026-12-01');
});
t('未知动作类型报错', () => {
  assert.throws(() => actions.execute({ type: 'nuke' }, mkCtx()), /未知动作/);
});

console.log(`\n${n} 项通过` + (process.exitCode ? '，有失败' : '，全部通过') + '\n');
