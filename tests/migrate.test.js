'use strict';
/** v1 → v2 迁移测试：node tests/migrate.test.js */
const assert = require('assert');
const { migrateV1, normalizeV2 } = require('../lib/migrate');

let pass = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { console.error('FAIL  ' + name + '\n      ' + e.message); process.exitCode = 1; }
}

const V1 = {
  version: 1,
  briefs: [
    {
      id: 'br_abc123',
      title: '旧素材',
      audience: '出海 SaaS',
      language: 'zh',
      sellingPoints: ['a', 'b'],
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-02T00:00:00.000Z',
      channels: {
        x_post: {
          current: 2,
          versions: [
            { v: 1, body: 'one', status: 'draft', checks: { score: 50, mustFail: 1, results: [] } },
            { v: 2, body: 'two', status: 'approved', checks: { score: 100, mustFail: 0, results: [] } }
          ]
        },
        cold_email: { current: 1, versions: [{ v: 1, body: 'mail', status: 'draft', checks: { score: 80, mustFail: 0, results: [] } }] },
        reddit_post: { current: 0, versions: [] }
      }
    }
  ]
};

console.log('\n[migrate] v1 brief → v2 campaign');
const v2 = migrateV1(V1);

t('版本号升到 2', () => assert.strictEqual(v2.version, 2));
t('brief → campaign 一对一', () => assert.strictEqual(v2.campaigns.length, 1));
const cp = v2.campaigns[0];
t('title 映射到 name', () => assert.strictEqual(cp.name, '旧素材'));
t('brief 的其余字段保留', () => {
  assert.strictEqual(cp.audience, '出海 SaaS');
  assert.deepStrictEqual(cp.sellingPoints, ['a', 'b']);
  assert.strictEqual(cp.createdAt, '2026-11-01T00:00:00.000Z');
});
t('id 前缀 br_ → cp_', () => assert.ok(cp.id.startsWith('cp_'), cp.id));
t('只有有版本的渠道变成资产（空渠道不产生资产）', () => {
  assert.strictEqual(cp.assets.length, 2, '实际资产数 ' + cp.assets.length);
  assert.ok(!cp.assets.some((a) => a.channel === 'reddit_post'));
});
t('资产类型由渠道推导', () => {
  assert.strictEqual(cp.assets.find((a) => a.channel === 'x_post').type, 'social');
  assert.strictEqual(cp.assets.find((a) => a.channel === 'cold_email').type, 'email');
});
t('版本历史与 current 原样保留', () => {
  const x = cp.assets.find((a) => a.channel === 'x_post');
  assert.strictEqual(x.versions.length, 2);
  assert.strictEqual(x.current, 2);
  assert.strictEqual(x.versions[1].status, 'approved');
  assert.strictEqual(x.versions[1].checks.score, 100);
});
t('v1 没有排期，所以 scheduledAt 为 null', () => {
  cp.assets.forEach((a) => assert.strictEqual(a.scheduledAt, null));
});
t('每个资产 id 唯一且带 as_ 前缀', () => {
  const ids = cp.assets.map((a) => a.id);
  assert.strictEqual(new Set(ids).size, ids.length);
  ids.forEach((id) => assert.ok(id.startsWith('as_'), id));
});

console.log('\n[normalize] v2 自愈');
t('缺 assets 的 campaign 补成空数组', () => {
  const d = normalizeV2({ version: 2, campaigns: [{ id: 'cp_1', name: 'x' }] });
  assert.deepStrictEqual(d.campaigns[0].assets, []);
});
t('资产缺 type/scheduledAt 时补齐', () => {
  const d = normalizeV2({ campaigns: [{ id: 'cp_1', assets: [{ id: 'as_1', channel: 'x_post', versions: [{ v: 1 }] }] }] });
  const a = d.campaigns[0].assets[0];
  assert.strictEqual(a.type, 'social');
  assert.strictEqual(a.scheduledAt, null);
  assert.strictEqual(a.current, 1, 'current 应回落到最后一个版本');
});
t('完全空的输入不炸', () => {
  assert.deepStrictEqual(normalizeV2(null), { version: 2, campaigns: [] });
  assert.deepStrictEqual(normalizeV2({}), { version: 2, campaigns: [] });
});

console.log(`\n${pass} 项通过${process.exitCode ? '，有失败' : '，全部通过'}\n`);
