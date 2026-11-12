'use strict';
/**
 * v1 → v2 数据迁移。
 *
 * v1（brief 模型）：一条素材 → channels{ <chId>: {versions, current} }
 * v2（campaign 模型）：campaign → assets[] → versions[]
 *
 * 为什么必须迁移而不是重命名：
 *   v1 里"渠道"既是内容单位又是容器，所以排期、资产标题、跨渠道统计全都没地方挂。
 *   v2 把"资产"提升为一等对象 —— 一个渠道可以有多个资产（比如同一 campaign 发两条 X），
 *   每个资产有自己的排期和版本历史。
 *
 * 迁移是幂等的：v2 已有的字段原样保留，只补缺失的。
 */
const C = require('./channels');
const crypto = require('crypto');

const nowIso = () => new Date().toISOString();
const uid = (p) => p + '_' + crypto.randomBytes(6).toString('hex');

/** 把 v1 的 brief 转成一个 campaign */
function fromV1Brief(b) {
  const assets = [];
  const channels = b.channels || {};
  for (const ch of C.CHANNELS) {
    const c = channels[ch.id];
    if (!c || !Array.isArray(c.versions) || !c.versions.length) continue;
    assets.push({
      id: uid('as'),
      channel: ch.id,
      type: ch.type,
      title: '',
      scheduledAt: null,
      current: c.current || c.versions[c.versions.length - 1].v,
      versions: c.versions
    });
  }
  return {
    id: (b.id || 'cp').replace(/^br_/, 'cp_'),
    name: b.title || '未命名 campaign',
    objective: '',
    productName: b.productName || '',
    subject: b.subject || '',
    audience: b.audience || '',
    language: b.language || 'en',
    tone: b.tone || '',
    cta: b.cta || '',
    fromName: b.fromName || '',
    links: b.links || { product: '', demo: '' },
    sellingPoints: b.sellingPoints || [],
    rawMaterial: b.rawMaterial || '',
    createdAt: b.createdAt || nowIso(),
    updatedAt: b.updatedAt || nowIso(),
    assets
  };
}

function migrateV1(v1) {
  const briefs = (v1 && v1.briefs) || [];
  return { version: 2, campaigns: briefs.map(fromV1Brief) };
}

/** v2 数据自愈：补齐缺字段，防止旧文件缺 assets 之类的崩溃 */
function normalizeV2(db) {
  if (!db || !Array.isArray(db.campaigns)) return { version: 2, campaigns: [] };
  db.version = 2;
  for (const cp of db.campaigns) {
    if (!Array.isArray(cp.assets)) cp.assets = [];
    for (const a of cp.assets) {
      if (!a.id) a.id = 'as_' + Math.random().toString(16).slice(2, 10);
      if (!a.channel) a.channel = 'x_post';
      if (!a.type) a.type = C.assetTypeOf(a.channel);
      if (!Array.isArray(a.versions)) a.versions = [];
      if (!a.current && a.versions.length) a.current = a.versions[a.versions.length - 1].v;
      if (a.scheduledAt === undefined) a.scheduledAt = null;
    }
  }
  return db;
}

module.exports = { fromV1Brief, migrateV1, normalizeV2 };
