'use strict';
/**
 * 内容资产仓库（Content 模块）
 *
 * 设计取舍（写在这儿，免得以后有人以为是漏的）：
 *  1. 一条内容 = 一条 asset（campaign 里的一个渠道资产）。列表里的每一行都指向
 *     `campaignId + assetId`，所以点进去就是现成的编辑器（生成 / 版本 / 质检 / 排期）。
 *  2. 状态不是另存一份真相：只要这条内容还挂在资产上，status / 生效日 / 审核状态
 *     就从资产推导（`derive()`）。手动改状态只对「没有资产」的条目生效。
 *  3. Impressions / Reads / GEO / Content gap 这些指标**没有数据源就留空**（列表显示 —），
 *     绝不编数字。接 GSC / 分析之后再由 sync 填。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./store');

const FILE = 'content.json';

/* ==================== 数据表 ==================== */

/** 内容类型：Create content 菜单就是这一份 */
const TYPES = [
  { id: 'article', label: 'Article', icon: '📄', channel: 'landing_hero', group: 'articles' },
  { id: 'social', label: 'Social post', icon: '💬', channel: 'x_post', group: 'social' },
  { id: 'webpage', label: 'Webpage', icon: '🌐', channel: 'landing_hero', group: 'articles' },
  { id: 'newsletter', label: 'Newsletter', icon: '✉', channel: 'cold_email', group: 'broadcast' },
  { id: 'video', label: 'Video', icon: '▶', channel: 'youtube_script', group: 'social' },
  { id: 'webinar', label: 'Webinar', icon: '🗓', channel: 'landing_hero', group: 'articles' },
  { id: 'ebook', label: 'Ebook', icon: '📘', channel: 'landing_hero', group: 'articles' },
  { id: 'podcast', label: 'Podcast', icon: '🎙', channel: 'youtube_script', group: 'broadcast' },
  { id: 'campaign', label: 'Campaign', icon: '🚩', channel: 'x_post', group: 'campaign' }
];

/** 四种工作流状态（Assigned to me 不是状态，是负责人筛选） */
const STATUSES = [
  { id: 'draft', label: 'Draft' },
  { id: 'pending', label: 'Pending approval' },
  { id: 'scheduled', label: 'Scheduled' },
  { id: 'published', label: 'Published' }
];

/** 左侧导航树：分组 + 该分组下每个状态子项 */
const GROUPS = [
  { id: 'content', label: 'Content', all: 'All content', types: null },
  { id: 'articles', label: 'Articles', all: 'All articles', types: ['article', 'webpage', 'ebook', 'webinar'] },
  { id: 'social', label: 'Social posts', all: 'All social posts', types: ['social', 'video'] },
  { id: 'broadcast', label: 'Broadcasts', all: 'All broadcasts', types: ['newsletter', 'podcast'] },
  { id: 'media', label: 'Media', all: 'Workspace files', types: null, subs: ['files', 'unsplash', 'canva'] }
];

const MEDIA_SUBS = [
  { id: 'files', label: 'Workspace files' },
  { id: 'unsplash', label: 'Unsplash' },
  { id: 'canva', label: 'Canva' }
];

/** 表格的 16 列：顺序 = 表头顺序；sort=能否排序 */
const COLUMNS = [
  { key: 'title', label: 'Title', type: 'text', sort: true, w: 300 },
  { key: 'status', label: 'Status', type: 'pill', sort: true, w: 130 },
  { key: 'effectiveDate', label: 'Effective date', type: 'date', sort: true, w: 120 },
  { key: 'approval', label: 'Approval status', type: 'pill', sort: true, w: 140 },
  { key: 'collaborator', label: 'Collaborator', type: 'text', sort: true, w: 120 },
  { key: 'campaign', label: 'Campaign', type: 'text', sort: true, w: 160 },
  { key: 'language', label: 'Language', type: 'text', sort: true, w: 90 },
  { key: 'dueDate', label: 'Due date', type: 'date', sort: true, w: 110 },
  { key: 'author', label: 'Author', type: 'text', sort: true, w: 110 },
  { key: 'impressions', label: 'Impressions', type: 'num', sort: true, w: 110 },
  { key: 'reads', label: 'Reads', type: 'num', sort: true, w: 90 },
  { key: 'category', label: 'Category', type: 'text', sort: true, w: 120 },
  { key: 'tags', label: 'Tag', type: 'tags', sort: false, w: 140 },
  { key: 'keywords', label: 'Keyword', type: 'tags', sort: false, w: 150 },
  { key: 'geo', label: 'GEO & SEO score', type: 'num', sort: true, w: 140 },
  { key: 'gap', label: 'Content gap score', type: 'num', sort: true, w: 150 }
];

const TYPE_IDS = TYPES.map((t) => t.id);
const STATUS_IDS = STATUSES.map((s) => s.id);

/* ==================== 工具 ==================== */

const nowIso = () => new Date().toISOString();
const todayStr = () => {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};
const str = (v, cap) => String(v == null ? '' : v).trim().slice(0, cap || 200);
const list = (v, cap, len) => (Array.isArray(v) ? v.map((x) => str(x, len || 40)).filter(Boolean).slice(0, cap) : []);

const typeOf = (id) => TYPES.find((t) => t.id === id) || null;
const groupOf = (id) => GROUPS.find((g) => g.id === id) || GROUPS[0];

/* ==================== 存取 ==================== */

function emptyDb() {
  return { items: [], updatedAt: null };
}

function load() {
  const j = store.readJson(FILE, null);
  if (!j || typeof j !== 'object') return emptyDb();
  const db = emptyDb();
  db.items = Array.isArray(j.items) ? j.items.map(normalize) : [];
  db.updatedAt = j.updatedAt || null;
  return db;
}

function save(db) {
  db.updatedAt = nowIso();
  return store.writeJson(FILE, db);
}

function normalize(x) {
  const src = x || {};
  const type = TYPE_IDS.includes(src.type) ? src.type : 'article';
  return {
    id: String(src.id || 'ct_' + crypto.randomBytes(5).toString('hex')),
    type,
    title: str(src.title, 200) || '(未命名)',
    status: STATUS_IDS.includes(src.status) ? src.status : 'draft',
    statusManual: !!src.statusManual,
    approval: ['pending', 'approved'].includes(src.approval) ? src.approval : '',
    effectiveDate: str(src.effectiveDate, 10),
    dueDate: str(src.dueDate, 10),
    collaborator: str(src.collaborator, 60),
    campaign: str(src.campaign, 120),
    campaignId: str(src.campaignId, 40),
    assetId: str(src.assetId, 40),
    language: str(src.language, 20),
    author: str(src.author, 60),
    category: str(src.category, 60),
    tags: list(src.tags, 8, 24),
    keywords: list(src.keywords, 8, 40),
    impressions: Number.isFinite(src.impressions) && src.impressions !== null ? Number(src.impressions) : null,
    reads: Number.isFinite(src.reads) && src.reads !== null ? Number(src.reads) : null,
    geo: Number.isFinite(src.geo) && src.geo !== null ? Number(src.geo) : null,
    gap: Number.isFinite(src.gap) && src.gap !== null ? Number(src.gap) : null,
    // 文章编辑器的元信息（封面 / 摘要 / SEO / 自定义字段）跟着条目走。
    // 不放行的话会被 normalize 静默丢掉 —— 保存成功、重新读却是空的。
    article: src.article && typeof src.article === 'object' ? JSON.parse(JSON.stringify(src.article)) : {},
    // v13：social post composer 的状态（勾了哪些渠道 / 文案 / 分渠道定制 / 素材 / 定时）
    socialpost: src.socialpost && typeof src.socialpost === 'object' ? JSON.parse(JSON.stringify(src.socialpost)) : {},
    createdAt: src.createdAt || nowIso(),
    updatedAt: src.updatedAt || src.createdAt || nowIso()
  };
}

/* ==================== 状态推导（和编辑器同一份真相） ==================== */

/**
 * 这条内容还挂在资产上时，标题 / 生效日 / 状态 / 审核都从资产读。
 * 没有资产（理论上不该发生）才用条目自己的值。
 */
function derive(item, campaigns) {
  let a = null;
  let cur = null;
  const linked = !!(item.campaignId && item.assetId && Array.isArray(campaigns));
  if (linked) {
    const cp = campaigns.find((c) => c.id === item.campaignId);
    a = cp && (cp.assets || []).find((x) => x.id === item.assetId);
    if (a) {
      const versions = a.versions || [];
      cur = versions.find((v) => v.v === a.current) || versions[versions.length - 1] || null;
      item.title = str(a.title, 200) || item.title;
      item.effectiveDate = str(a.scheduledAt, 10);
      item.dueDate = str(a.scheduledAt, 10);
      item.campaign = str(cp.name, 120) || item.campaign;
      item.language = str(cp.language, 20) || item.language;
      item.author = item.author || str(cp.fromName, 60);
      // 有版本就以版本为准；没版本（刚建、还没写草稿）时保留人工设的审核状态
      if (cur) item.approval = cur.status === 'approved' ? 'approved' : (item.approval === 'approved' ? '' : item.approval);
    }
  }
  if (!item.statusManual) {
    if (cur && cur.status === 'approved') {
      // 排期 ≠ 已排期：没批准的稿子就算填了日期也还是草稿（否则 Scheduled 一栏全是没写完的）
      item.status = (a.scheduledAt && a.scheduledAt > todayStr()) ? 'scheduled' : 'published';
    } else if (item.approval === 'pending') {
      item.status = 'pending';
    } else if (cur) {
      item.status = 'draft';
    }
    // 既没资产也没版本：保留条目自己的 status（可能是手动推进过的）
  }
  return item;
}

function statusOf(item) {
  return STATUSES.some((s) => s.id === item.status) ? item.status : 'draft';
}

/* ==================== CRUD ==================== */

function create(db, input) {
  const i = input || {};
  const type = TYPE_IDS.includes(i.type) ? i.type : null;
  if (!type) throw Object.assign(new Error('内容类型不对：' + String(i.type || '(空)')), { status: 400 });
  const title = str(i.title, 200);
  if (!title) throw Object.assign(new Error('标题不能为空'), { status: 400 });
  const meta = typeOf(type);
  const item = normalize({
    ...i,
    id: 'ct_' + crypto.randomBytes(5).toString('hex'),
    type,
    title,
    category: i.category || meta.label,
    collaborator: str(i.collaborator, 60) || ME,
    status: STATUS_IDS.includes(i.status) ? i.status : 'draft',
    createdAt: nowIso(),
    updatedAt: nowIso()
  });
  db.items.unshift(item);
  return item;
}

function find(db, id) {
  return (db.items || []).find((x) => x.id === id) || null;
}

const PATCHABLE = ['title', 'status', 'approval', 'effectiveDate', 'dueDate', 'collaborator', 'language',
  'author', 'category', 'tags', 'keywords', 'impressions', 'reads', 'geo', 'gap', 'campaign', 'campaignId', 'assetId'];

function update(db, id, patch) {
  const item = find(db, id);
  if (!item) throw Object.assign(new Error('没有这条内容: ' + id), { status: 404 });
  const p = patch || {};
  for (const k of PATCHABLE) {
    if (p[k] === undefined) continue;
    if (k === 'status') {
      if (!STATUS_IDS.includes(p.status)) throw Object.assign(new Error('状态不对：' + p.status), { status: 400 });
      item.status = p.status;
      item.statusManual = true;          // 手动改过状态，就不再被资产推导覆盖
      continue;
    }
    if (k === 'approval') {
      if (!['', 'pending', 'approved'].includes(p.approval)) throw Object.assign(new Error('审核状态不对：' + p.approval), { status: 400 });
      item.approval = p.approval;
      continue;
    }
    if (k === 'tags' || k === 'keywords') { item[k] = list(p[k], 8, k === 'tags' ? 24 : 40); continue; }
    if (['impressions', 'reads', 'geo', 'gap'].includes(k)) {
      item[k] = p[k] === null || p[k] === '' ? null : (Number.isFinite(Number(p[k])) ? Number(p[k]) : null);
      continue;
    }
    if (k === 'title') {
      const t = str(p.title, 200);
      if (!t) throw Object.assign(new Error('标题不能为空'), { status: 400 });
      item.title = t;
      continue;
    }
    item[k] = str(p[k], k === 'campaign' ? 120 : 200);
  }
  // 没挂资产时状态只能由审核状态推：提交审核 = Pending approval，撤回 = 回 Draft
  if (!item.statusManual && !item.assetId) {
    if (item.approval === 'pending') item.status = 'pending';
    else if (item.status === 'pending') item.status = 'draft';
  }
  item.updatedAt = nowIso();
  return item;
}

function remove(db, id) {
  const before = db.items.length;
  db.items = db.items.filter((x) => x.id !== id);
  return db.items.length < before;
}

function duplicate(db, id) {
  const src = find(db, id);
  if (!src) throw Object.assign(new Error('没有这条内容: ' + id), { status: 404 });
  const copy = normalize({
    ...src,
    id: 'ct_' + crypto.randomBytes(5).toString('hex'),
    title: src.title + ' (copy)',
    campaignId: '', assetId: '',     // 副本先不挂资产，进编辑器时再建
    createdAt: nowIso(), updatedAt: nowIso()
  });
  db.items.unshift(copy);
  return copy;
}

/* ==================== 从现有 campaign 同步条目 ==================== */

/** 渠道 → 内容类型（老的 campaign 资产也要能在新列表里出现） */
const CHANNEL_TYPE = {
  youtube_script: 'video', tiktok_script: 'video', video_shotlist: 'video',
  x_post: 'social', reddit_post: 'social', cold_email: 'newsletter', landing_hero: 'article'
};

/**
 * 幂等：给每个 campaign 和每个资产补一条内容条目（id 由 campaign/asset id 推出来，不会重复）。
 * 资产被删掉的条目只解绑、不删除 —— 静默丢用户的东西比留一条孤儿更糟。
 */
function sync(db, campaigns) {
  let changed = false;
  const items = db.items || (db.items = []);
  const cps = Array.isArray(campaigns) ? campaigns : [];

  for (const cp of cps) {
    const cpItemId = 'ct_cp_' + cp.id;
    // 只有显式建出来的 Campaign（contentType='campaign'）才单独成行；
    // 其他 campaign 只是内容的容器，靠子资产出现就够了，不然列表里全是重复行
    if (cp.contentType === 'campaign' && !items.some((it) => it.id === cpItemId)) {
      items.push(normalize({
        id: cpItemId, type: 'campaign',
        title: cp.name || '(未命名 campaign)',
        campaignId: cp.id, assetId: '',
        campaign: cp.name, language: cp.language, author: cp.fromName,
        category: 'Campaign', collaborator: ME,
        createdAt: cp.createdAt, updatedAt: cp.updatedAt
      }));
      changed = true;
    }
    for (const a of cp.assets || []) {
      const asItemId = 'ct_as_' + a.id;
      if (items.some((it) => it.id === asItemId)) continue;
      const type = CHANNEL_TYPE[a.channel] || 'article';
      items.push(normalize({
        id: asItemId, type,
        title: a.title || ((cp.name || '(未命名)') + ' · ' + ((typeOf(type) || {}).label || type)),
        campaignId: cp.id, assetId: a.id,
        campaign: cp.name, language: cp.language, author: cp.fromName,
        category: (typeOf(type) || {}).label, collaborator: ME,
        createdAt: cp.createdAt, updatedAt: cp.updatedAt
      }));
      changed = true;
    }
  }

  // 反向：资产/整条 campaign 没了 → 解绑，条目留着
  for (const it of items) {
    if (!it.campaignId) continue;
    const cp = cps.find((c) => c.id === it.campaignId);
    if (!cp) { it.campaignId = ''; it.assetId = ''; it.statusManual = true; changed = true; continue; }
    if (it.assetId && !(cp.assets || []).some((a) => a.id === it.assetId)) {
      // 资产没了：整条解绑（campaign 名字留在 campaign 字段里当线索），条目本身别删
      it.assetId = ''; it.campaignId = ''; it.statusManual = true; changed = true;
    }
  }
  return changed;
}

/* ==================== 列表：筛选 / 排序 / 分页 ==================== */

const ME = 'me';

function inGroup(item, groupId) {
  const g = groupOf(groupId);
  if (!g.types) return true;                       // Content = 全部
  return g.types.includes(item.type);
}

function matchStatus(item, status) {
  if (!status) return true;
  if (status === 'assigned') return !!(item.collaborator && item.collaborator.toLowerCase() === ME);
  return statusOf(item) === status;
}

function q_(item) {
  return [item.title, item.campaign, item.author, item.category, (item.tags || []).join(' '),
    (item.keywords || []).join(' '), item.collaborator].join(' ').toLowerCase();
}

function sortValue(item, key) {
  if (key === 'status') return statusOf(item);
  if (key === 'tags' || key === 'keywords') return (item[key] || []).join(',');
  return item[key] == null ? '' : item[key];
}

/**
 * 返回一页结果。
 * page 从 1 开始；size 默认 20。
 */
function query(db, opts, campaigns) {
  const o = opts || {};
  const group = groupOf(o.group || 'content');
  const status = o.status || '';
  const q = str(o.q, 120).toLowerCase();
  const sort = COLUMNS.some((c) => c.key === o.sort && c.sort) ? o.sort : 'effectiveDate';
  const dir = o.dir === 'asc' ? 'asc' : 'desc';
  const size = Math.min(100, Math.max(1, Number(o.size) || 20));
  const page = Math.max(1, Number(o.page) || 1);

  let rows = (db.items || []).map((it) => derive({ ...it }, campaigns)).filter((it) => inGroup(it, group.id) && matchStatus(it, status));
  if (q) rows = rows.filter((it) => q_(it).includes(q));

  rows = rows.slice().sort((a, b) => {
    const av = sortValue(a, sort), bv = sortValue(b, sort);
    const an = typeof av === 'number', bn = typeof bv === 'number';
    let cmp;
    if (an && bn) cmp = av - bv;
    else cmp = String(av).localeCompare(String(bv), 'zh');
    if (cmp === 0) cmp = String(a.title).localeCompare(String(b.title), 'zh');
    return dir === 'asc' ? cmp : -cmp;
  });

  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const cur = Math.min(page, pages);
  const from = total === 0 ? 1 : (cur - 1) * size + 1;
  const to = Math.min(cur * size, total);
  return {
    group: group.id, status, q, sort, dir, page: cur, size, total, pages, from, to,
    items: rows.slice((cur - 1) * size, cur * size)
  };
}

/** 左侧树的计数：每个分组每个状态各有几条 */
function counts(db, campaigns) {
  const items = (db.items || []).map((it) => derive({ ...it }, campaigns));
  const out = {};
  for (const g of GROUPS) {
    if (g.id === 'media') { out[g.id] = { all: 0 }; continue; }
    const inG = items.filter((it) => inGroup(it, g.id));
    out[g.id] = {
      all: inG.length,
      assigned: inG.filter((it) => matchStatus(it, 'assigned')).length,
      draft: inG.filter((it) => statusOf(it) === 'draft').length,
      pending: inG.filter((it) => statusOf(it) === 'pending').length,
      scheduled: inG.filter((it) => statusOf(it) === 'scheduled').length,
      published: inG.filter((it) => statusOf(it) === 'published').length
    };
  }
  return out;
}

/** 给前端的一整份视图（含推导后的行） */
function publicView(db, campaigns) {
  const items = (db.items || []).map((it) => derive({ ...it }, campaigns));
  return {
    items,
    types: TYPES,
    statuses: STATUSES,
    groups: GROUPS,
    mediaSubs: MEDIA_SUBS,
    columns: COLUMNS,
    counts: counts(db, campaigns),
    updatedAt: db.updatedAt
  };
}

module.exports = {
  FILE, TYPES, STATUSES, GROUPS, MEDIA_SUBS, COLUMNS, TYPE_IDS, STATUS_IDS, ME,
  emptyDb, load, save, normalize, derive, statusOf, create, find, update, remove, duplicate,
  query, counts, publicView, inGroup, matchStatus, typeOf, groupOf, sync, CHANNEL_TYPE
};
