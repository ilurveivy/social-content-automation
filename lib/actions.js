'use strict';
/**
 * 执行 agent 提出的动作。
 *
 * 全部动作都要过一遍校验：模型给的 campaignId 不存在就重定向到最近一个，
 * 渠道名不认识就报错，日期不合法就不写。**模型不能直接把数据写坏。**
 */
const C = require('./channels');
const knowledge = require('./knowledge');

const validDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

function findCampaign(ctx, id) {
  if (id) {
    const hit = ctx.db.campaigns.find((c) => c.id === id);
    if (hit) return hit;
  }
  return ctx.db.campaigns[0] || null;
}

function ensureAsset(ctx, cp, channelId, title) {
  const ch = C.channelById(channelId);
  if (!ch) throw new Error('未知渠道: ' + channelId);
  const exist = cp.assets.find((a) => a.channel === ch.id);
  if (exist) return exist;
  const a = {
    id: ctx.uid('as'),
    channel: ch.id,
    type: ch.type,
    title: title || '',
    scheduledAt: null,
    current: 0,
    versions: []
  };
  cp.assets.push(a);
  return a;
}

const KNOWLEDGE_ARRAY_FIELDS = ['products', 'audiences', 'competitors', 'differentiators', 'proofPoints'];
const KNOWLEDGE_TEXT_FIELDS = ['name', 'oneLiner', 'tone'];

function execute(a, ctx) {
  switch (a.type) {
    case 'create_campaign': {
      if (!a.name) throw new Error('create_campaign 缺 name');
      const cp = {
        id: ctx.uid('cp'),
        name: String(a.name).slice(0, 120),
        objective: a.objective || '',
        productName: '',
        subject: '',
        audience: a.audience || '',
        language: a.language || 'zh',
        tone: a.tone || '',
        cta: a.cta || '',
        fromName: '',
        links: { product: '', demo: '' },
        sellingPoints: Array.isArray(a.sellingPoints) ? a.sellingPoints.slice(0, 6) : [],
        rawMaterial: a.rawMaterial || '',
        createdAt: ctx.nowIso(),
        updatedAt: ctx.nowIso(),
        assets: []
      };
      ctx.db.campaigns.unshift(cp);
      return { type: a.type, ok: true, campaignId: cp.id, summary: `已创建 campaign「${cp.name}」` };
    }

    case 'write_asset': {
      const cp = findCampaign(ctx, a.campaignId);
      if (!cp) throw new Error('没有可写入的 campaign');
      if (!a.body || !String(a.body).trim()) throw new Error('write_asset 的 body 为空');
      const asset = ensureAsset(ctx, cp, a.channel || 'x_post', a.title);
      const entry = ctx.runAndAttach(cp, asset, String(a.body), { source: 'agent', variant: 'A', note: 'agent chat' });
      return {
        type: a.type,
        ok: true,
        campaignId: cp.id,
        assetId: asset.id,
        summary: `已写入 ${(C.channelById(asset.channel) || {}).labelZh || asset.channel} v${entry.v}（规则分 ${entry.checks.score}%）`
      };
    }

    case 'schedule_asset': {
      const cp = findCampaign(ctx, a.campaignId);
      if (!cp) throw new Error('没有可排期的 campaign');
      const asset = ensureAsset(ctx, cp, a.channel || 'x_post');
      const d = String(a.scheduledAt || '');
      if (!validDate(d)) throw new Error('scheduledAt 必须是 YYYY-MM-DD，收到：' + d);
      asset.scheduledAt = d;
      cp.updatedAt = ctx.nowIso();
      return { type: a.type, ok: true, campaignId: cp.id, assetId: asset.id, summary: `已把 ${(C.channelById(asset.channel) || {}).labelZh || asset.channel} 排到 ${d}` };
    }

    case 'update_knowledge': {
      const kdb = knowledge.load();
      const field = String(a.field || '');
      const value = String(a.value || '').trim();
      if (!value || value === '（未填写）') throw new Error('update_knowledge 没有有效内容');
      if (KNOWLEDGE_ARRAY_FIELDS.includes(field)) {
        if (!kdb.company[field].includes(value)) kdb.company[field].push(value);
      } else if (KNOWLEDGE_TEXT_FIELDS.includes(field)) {
        kdb.company[field] = value.slice(0, 400);
      } else {
        throw new Error('不支持的 knowledge 字段: ' + field);
      }
      knowledge.save(kdb);
      return { type: a.type, ok: true, summary: `已补充「${field}」` };
    }

    default:
      throw new Error('未知动作: ' + a.type);
  }
}

module.exports = { execute, validDate, ensureAsset, findCampaign };
