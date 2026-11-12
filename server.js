'use strict';
/**
 * Social Content Automation —— 本地内容工作台
 * 零依赖：只用 Node 内置模块。启动：node server.js
 *
 * v2 数据模型：campaign（一个核心主张）→ assets（文章/社交/邮件/视频）→ versions
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const C = require('./lib/channels');
const { runChecks } = require('./lib/rules');
const llm = require('./lib/llm');
const store = require('./lib/store');
const { migrateV1, normalizeV2 } = require('./lib/migrate');
const { diffLines, summarize } = require('./lib/diff');
const providers = require('./lib/providers');
const knowledge = require('./lib/knowledge');
const content = require('./lib/content');
const article = require('./lib/article');
const chats = require('./lib/chats');
const agent = require('./lib/agent');
const actionsMod = require('./lib/actions');
const skills = require('./lib/skills');
const audit = require('./lib/audit');
const gsc = require('./lib/gsc');
const buffer = require('./lib/buffer');

const PORT = Number(process.env.PORT || process.env.SCA_PORT || 4319);
// Buffer 的 OAuth 回调地址、以及媒体给 Buffer 抓的公网 URL，都以这个为准。
// 本机跑就是 127.0.0.1（Buffer 抓不到本机图，页面会如实标出来）；有公网域名就设 SCA_PUBLIC_BASE。
if (!process.env.SCA_PUBLIC_BASE) process.env.SCA_PUBLIC_BASE = 'http://127.0.0.1:' + PORT;
const HOST = process.env.SCA_HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');
const DB_FILE = 'campaigns.json';

const DEFAULT_SETTINGS = {
  provider: { mode: 'template', baseUrl: '', model: '', token: '' },
  bannedWords: C.DEFAULT_BANNED,
  brandVoice: { tone: '直接、具体、不吹', doNot: [], examples: [] }
};

const nowIso = () => new Date().toISOString();
const uid = (p) => p + '_' + crypto.randomBytes(6).toString('hex');
const today = () => new Date().toISOString().slice(0, 10);

function httpError(code, msg) {
  const e = new Error(msg);
  e.status = code;
  return e;
}

// ---------- 数据 ----------
function loadDb() {
  const existing = store.readJson(DB_FILE, null);
  if (existing) return normalizeV2(existing);
  const v1 = store.readJson('briefs.json', null);
  if (v1 && Array.isArray(v1.briefs)) {
    const migrated = migrateV1(v1);
    store.writeJson(DB_FILE, migrated);
    console.log(`[migrate] briefs.json → campaigns.json：${migrated.campaigns.length} 个 campaign（原文件保留不删）`);
    return migrated;
  }
  return { version: 2, campaigns: [] };
}

function loadSettings() {
  const s = store.readJson('settings.json', null);
  if (!s) return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    provider: { ...DEFAULT_SETTINGS.provider, ...(s.provider || {}) },
    brandVoice: { ...DEFAULT_SETTINGS.brandVoice, ...(s.brandVoice || {}) }
  };
}

const db = loadDb();
function persist() {
  db.version = 2;
  return store.writeJson(DB_FILE, db);
}

/** 规则引擎和提示词模板是按 brief 的形状写的，这里把 campaign 映射过去，避免两套逻辑 */
function briefView(cp) {
  return {
    title: cp.name,
    name: cp.name,
    objective: cp.objective || '',
    productName: cp.productName || '',
    subject: cp.subject || '',
    audience: cp.audience || '',
    language: cp.language || 'en',
    tone: cp.tone || '',
    cta: cp.cta || '',
    fromName: cp.fromName || '',
    links: cp.links || {},
    sellingPoints: cp.sellingPoints || [],
    rawMaterial: cp.rawMaterial || ''
  };
}

// ---------- 查找 ----------
function findCampaign(id) {
  const cp = db.campaigns.find((x) => x.id === id);
  if (!cp) throw httpError(404, 'campaign 不存在: ' + id);
  return cp;
}
function findAsset(cp, assetId) {
  const a = (cp.assets || []).find((x) => x.id === assetId);
  if (!a) throw httpError(404, 'asset 不存在: ' + assetId);
  return a;
}
function currentVersion(asset) {
  if (!asset || !asset.versions || !asset.versions.length) return null;
  return asset.versions.find((v) => v.v === asset.current) || asset.versions[asset.versions.length - 1];
}
function assetSummary(a) {
  const cur = currentVersion(a);
  return {
    id: a.id,
    channel: a.channel,
    type: a.type || C.assetTypeOf(a.channel),
    title: a.title || '',
    scheduledAt: a.scheduledAt || null,
    hasContent: !!cur,
    versions: a.versions.length,
    current: a.current || 0,
    status: cur ? cur.status : 'empty',
    score: cur && cur.checks ? cur.checks.score : null,
    mustFail: cur && cur.checks ? cur.checks.mustFail : null
  };
}

// ---------- HTTP 工具 ----------
function json(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  });
  res.end(body);
}

/** 直接把图片字节写回去（data/knowledge/img 里的风格参考图和 Logo） */
function sendImage(res, img) {
  const type = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml' }[img.ext] || 'application/octet-stream';
  res.writeHead(200, {
    'content-type': type,
    'content-length': img.buf.length,
    'cache-control': 'private, max-age=86400'
  });
  res.end(img.buf);
}

function redirect(res, url) {
  res.writeHead(302, { location: url, 'cache-control': 'no-store' });
  res.end();
}

/** 从请求的 Host 推回调地址：用户用 localhost 还是 127.0.0.1 访问，回调都要对得上 */
function hostPort(req) {
  const host = String(req.headers.host || '');
  const m = host.match(/:(d+)$/);
  return m ? Number(m[1]) : PORT;
}

function readBody(req, limit) {
  const cap = limit || 5 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > cap) { reject(httpError(413, '请求体过大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(httpError(400, 'JSON 解析失败: ' + e.message)); }
    });
    req.on('error', reject);
  });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff' };

function serveStatic(req, res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const full = path.join(PUBLIC_DIR, rel);
  if (!full.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(full, (err, buf) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(full)] || 'application/octet-stream' });
    res.end(buf);
  });
}

/** data/media 下的文件（社媒素材）。名字只取 basename，防目录穿越 */
function serveMedia(res, urlPath) {
  const name = path.basename(decodeURIComponent(urlPath.slice('/media/'.length)));
  const full = path.join(store.DATA_DIR, 'media', name);
  if (!full.startsWith(path.join(store.DATA_DIR, 'media')) || !fs.existsSync(full)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('not found');
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(full)] || 'application/octet-stream', 'cache-control': 'public, max-age=60' });
  res.end(fs.readFileSync(full));
}

// ---------- 视图 ----------
const QUICK_ACTIONS = [
  { id: 'plan', label: '做一份推广方案', text: '帮我做一份这个月的推广方案：先定主张，再排 4 个渠道的资产，动作直接执行。' },
  { id: 'gaps', label: '我的资料还缺什么', text: '检查我的公司知识库，告诉我缺哪些信息会明显影响文案质量，并按重要性排序。' },
  { id: 'social', label: '写一组社媒草稿', text: '把我们的核心主张改写成 X 和 Reddit 两个渠道的草稿，并直接写入 Content（write_asset）。' },
  { id: 'opps', label: '找 5 个内容机会', text: '基于公司知识和已接入的数据，列出 5 个值得做内容的机会，每个都要说明依据；没有数据的要标注待验证。' }
];

const isStale = (iso, days) => {
  if (!iso) return true;
  return Date.now() - Date.parse(iso) > days * 86400000;
};

/** 把旧 settings.provider 迁成一个 provider，用户不用重新填一遍 */
function ensureLegacyProvider() {
  const pdb = providers.load();
  if (pdb.providers.length) return pdb;
  const s = loadSettings();
  const rp = llm.resolveProvider(s);
  if (!rp.baseUrl || rp.mode === 'template') return pdb;
  const rec = {
    id: uid('pv'),
    name: '默认（沿用旧设置）',
    kind: rp.mode === 'gateway' ? 'anthropic' : 'openai',
    baseUrl: rp.baseUrl,
    apiKey: rp.token || '',
    models: [rp.model].filter(Boolean),
    model: rp.model,
    createdAt: nowIso(),
    lastTestOk: null
  };
  pdb.providers.push(rec);
  pdb.active = rec.id;
  providers.save(pdb);
  return pdb;
}

function dashboardView() {
  ensureLegacyProvider();
  const pdb = providers.publicDb();
  const kdb = knowledge.load();
  const kview = knowledge.publicView(kdb);
  const rows = calendarRows();
  const todayStr = new Date().toISOString().slice(0, 10);
  const active = pdb.providers.find((x) => x.id === pdb.active) || null;
  const cdb = chats.load();

  const ready = {
    provider: !!(active && active.baseUrl && active.model),
    knowledge: kview.completeness.pct >= 50,
    files: kview.files.length > 0,
    gsc: !!kview.gsc.connected,
    tools: kview.tools.filter((t) => t.connected).length
  };

  return {
    providers: pdb,
    knowledge: kview,
    gscStatus: gsc.publicView(gsc.load(), PORT),
    catalog: knowledge.APP_CATALOG,
    ready,
    stats: {
      campaigns: db.campaigns.length,
      assets: rows.length,
      approved: rows.filter((r) => r.status === 'approved').length,
      mustFail: rows.filter((r) => r.mustFail > 0).length,
      unscheduled: rows.filter((r) => !r.scheduledAt).length,
      upcomingWeek: rows.filter((r) => r.scheduledAt && r.scheduledAt >= todayStr && r.scheduledAt <= new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)).length,
      calls: pdb.calls || 0,
      chats: cdb.chats.length
    },
    upcoming: rows.filter((r) => r.scheduledAt && r.scheduledAt >= todayStr).slice(0, 5),
    chats: chats.list(cdb),
    quickActions: QUICK_ACTIONS
  };
}


function calendarRows() {
  const rows = [];
  for (const cp of db.campaigns) {
    for (const a of cp.assets) {
      const s = assetSummary(a);
      rows.push({
        campaignId: cp.id,
        campaignName: cp.name,
        assetId: a.id,
        channel: a.channel,
        channelLabel: (C.channelById(a.channel) || {}).labelZh || a.channel,
        type: s.type,
        title: s.title,
        scheduledAt: s.scheduledAt,
        status: s.status,
        score: s.score,
        mustFail: s.mustFail,
        versions: s.versions,
        hasContent: s.hasContent
      });
    }
  }
  rows.sort((x, y) => String(x.scheduledAt || '9999').localeCompare(String(y.scheduledAt || '9999')));
  return rows;
}

function publicState() {
  const settings = loadSettings();
  const provider = llm.resolveProvider(settings);
  const rows = calendarRows();
  return {
    campaigns: db.campaigns.map((cp) => {
      const assets = cp.assets.map(assetSummary);
      const scheduled = assets.filter((a) => a.scheduledAt).map((a) => a.scheduledAt).sort();
      return {
        id: cp.id,
        name: cp.name,
        objective: cp.objective || '',
        updatedAt: cp.updatedAt,
        assetCount: assets.length,
        approvedCount: assets.filter((a) => a.status === 'approved').length,
        mustFailCount: assets.filter((a) => a.mustFail > 0).length,
        from: scheduled[0] || null,
        to: scheduled[scheduled.length - 1] || null,
        assets
      };
    }),
    campaignDetails: db.campaigns.reduce((acc, cp) => { acc[cp.id] = cp; return acc; }, {}),
    calendar: rows,
    channels: C.CHANNELS,
    assetTypes: C.ASSET_TYPES,
    settings: {
      provider: { mode: provider.mode, baseUrl: provider.baseUrl, model: provider.model, hasToken: !!provider.token },
      bannedWords: settings.bannedWords,
      brandVoice: settings.brandVoice
    }
  };
}

function runAndAttach(cp, asset, body, meta) {
  const settings = loadSettings();
  const checks = runChecks(asset.channel, body, briefView(cp), { bannedWords: settings.bannedWords });
  const v = (asset.versions.reduce((m, x) => Math.max(m, x.v), 0) || 0) + 1;
  const entry = {
    v,
    body,
    variant: meta.variant || 'A',
    source: meta.source || 'manual',
    note: meta.note || '',
    status: meta.status || 'draft',
    createdAt: nowIso(),
    checks
  };
  asset.versions.push(entry);
  asset.current = v;
  cp.updatedAt = nowIso();
  return entry;
}

function newAsset(cp, channelId, extra) {
  const ch = C.channelById(channelId);
  if (!ch) throw httpError(400, '未知渠道: ' + channelId);
  const a = {
    id: uid('as'),
    channel: ch.id,
    type: ch.type,
    title: (extra && extra.title) || '',
    scheduledAt: validDate(extra && extra.scheduledAt) ? extra.scheduledAt : null,
    current: 0,
    versions: []
  };
  cp.assets.push(a);
  cp.updatedAt = nowIso();
  return a;
}

function validDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

/** 生成时如果没有对应资产就建一个（一键生成 6 渠道的语义：缺哪个建哪个） */
function ensureAssetForChannel(cp, channelId) {
  const existing = cp.assets.find((a) => a.channel === channelId);
  return existing || newAsset(cp, channelId, {});
}

function exportMarkdown(cp) {
  const lines = [];
  lines.push(`# ${cp.name || '(untitled)'}`);
  const meta = [];
  if (cp.objective) meta.push(`目标：${cp.objective}`);
  if (cp.audience) meta.push(`受众：${cp.audience}`);
  if (cp.language) meta.push(`语言：${cp.language}`);
  if (cp.tone) meta.push(`调性：${cp.tone}`);
  if (meta.length) lines.push('\n' + meta.join('　'));
  if (cp.sellingPoints && cp.sellingPoints.length) {
    lines.push('\n## 核心主张\n');
    cp.sellingPoints.forEach((p, i) => lines.push(`${i + 1}. ${p}`));
  }
  const sorted = [...cp.assets].sort((a, b) => String(a.scheduledAt || '9999').localeCompare(String(b.scheduledAt || '9999')));
  for (const a of sorted) {
    const v = currentVersion(a);
    if (!v) continue;
    const ch = C.channelById(a.channel) || { labelZh: a.channel, label: a.channel };
    const t = C.assetTypeMeta(a.type || C.assetTypeOf(a.channel));
    lines.push('\n---\n');
    lines.push(`## ${ch.labelZh}（${ch.label}）· ${t.short} · 排期 ${a.scheduledAt || '未排期'}`);
    lines.push(`v${v.v} · ${v.status === 'approved' ? '✅ 已批准' : '草稿'} · 规则分 ${v.checks ? v.checks.score : '-'}%`);
    if (v.checks && v.checks.mustFail) {
      lines.push(`\n> ⚠️ 还有 ${v.checks.mustFail} 条硬规则未通过：`);
      v.checks.results.filter((r) => !r.ok && r.severity === 'must').forEach((r) => lines.push(`> - ${r.text}｜${r.detail}`));
    }
    lines.push('\n```\n' + v.body + '\n```');
  }
  return lines.join('\n');
}

function exportCsv(cp) {
  const esc = (s) => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
  const rows = [['campaign', 'asset_id', 'channel', 'type', 'scheduled', 'version', 'variant', 'status', 'score', 'must_fail', 'body']];
  for (const a of cp.assets) {
    const v = currentVersion(a);
    if (!v) continue;
    rows.push([
      cp.name || '', a.id, a.channel, a.type || C.assetTypeOf(a.channel), a.scheduledAt || '',
      v.v, v.variant, v.status, v.checks ? v.checks.score : '', v.checks ? v.checks.mustFail : '', v.body
    ]);
  }
  return rows.map((r) => r.map(esc).join(',')).join('\r\n');
}

// ---------- 路由 ----------
async function route(req, res) {
  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = u.pathname;
  const method = req.method.toUpperCase();

  if (!p.startsWith('/api/')) {
    // 社媒素材存在 data/media（不在 public 里）：Buffer 要抓的就是这个 URL
    if ((method === 'GET' || method === 'HEAD') && p.indexOf('/media/') === 0) return serveMedia(res, p);
    if (method === 'GET' || method === 'HEAD') return serveStatic(req, res, p);
    throw httpError(405, 'method not allowed');
  }

  if (method === 'GET' && p === '/api/state') return json(res, 200, publicState());
  if (method === 'GET' && p === '/api/calendar') {
    const from = u.searchParams.get('from');
    const to = u.searchParams.get('to');
    let rows = calendarRows();
    if (validDate(from)) rows = rows.filter((r) => !r.scheduledAt || r.scheduledAt >= from);
    if (validDate(to)) rows = rows.filter((r) => !r.scheduledAt || r.scheduledAt <= to);
    return json(res, 200, { ok: true, rows });
  }

  // settings
  if (method === 'GET' && p === '/api/settings') {
    const s = loadSettings();
    const rp = llm.resolveProvider(s);
    return json(res, 200, {
      provider: { mode: rp.mode, baseUrl: rp.baseUrl, model: rp.model, hasToken: !!rp.token },
      bannedWords: s.bannedWords,
      brandVoice: s.brandVoice
    });
  }
  if (method === 'POST' && p === '/api/settings') {
    const body = await readBody(req);
    const cur = loadSettings();
    const next = {
      ...cur,
      provider: { ...cur.provider, ...(body.provider || {}) },
      bannedWords: Array.isArray(body.bannedWords) ? body.bannedWords : cur.bannedWords,
      brandVoice: { ...cur.brandVoice, ...(body.brandVoice || {}) }
    };
    if (next.provider.token === '' || next.provider.token === undefined) delete next.provider.token;
    if (body.provider && typeof body.provider.token === 'string' && body.provider.token.trim()) {
      next.provider.token = body.provider.token.trim();
    }
    await store.writeJson('settings.json', next);
    const rp = llm.resolveProvider(next);
    return json(res, 200, { ok: true, provider: { mode: rp.mode, baseUrl: rp.baseUrl, model: rp.model, hasToken: !!rp.token } });
  }

  /* ================= providers（dashboard 顶部 banner） ================= */
  if (method === 'GET' && p === '/api/providers') {
    ensureLegacyProvider();
    return json(res, 200, providers.publicDb());
  }

  if (method === 'POST' && p === '/api/providers') {
    const body = await readBody(req);
    if (!String(body.baseUrl || '').trim()) throw httpError(400, 'baseUrl 不能为空');
    const pdb = providers.load();
    const models = Array.isArray(body.models) ? body.models.map((m) => String(m).trim()).filter(Boolean) : [];
    const rec = {
      id: uid('pv'),
      name: String(body.name || '未命名 provider').slice(0, 60),
      kind: providers.KINDS[body.kind] ? body.kind : 'openai',
      baseUrl: String(body.baseUrl).trim().replace(/\/+$/, ''),
      apiKey: String(body.apiKey || '').trim(),
      models,
      model: String(body.model || models[0] || '').trim(),
      createdAt: nowIso(),
      lastTestOk: null
    };
    if (!rec.models.length && rec.model) rec.models = [rec.model];
    pdb.providers.push(rec);
    if (!pdb.active) pdb.active = rec.id;
    await providers.save(pdb);
    return json(res, 200, { ok: true, provider: providers.mask(rec), active: pdb.active });
  }

  if (method === 'POST' && p === '/api/providers/active') {
    const body = await readBody(req);
    const pdb = providers.load();
    if (!pdb.providers.some((x) => x.id === body.id)) throw httpError(404, 'provider 不存在');
    pdb.active = body.id;
    await providers.save(pdb);
    return json(res, 200, { ok: true, active: pdb.active });
  }

  const mPv = p.match(/^\/api\/providers\/([^/]+)(\/.*)?$/);
  if (mPv) {
    const pdb = providers.load();
    const rec = pdb.providers.find((x) => x.id === mPv[1]);
    if (!rec) throw httpError(404, 'provider 不存在');
    const sub = mPv[2] || '';

    if (method === 'PATCH' && sub === '') {
      const body = await readBody(req);
      if (body.name !== undefined) rec.name = String(body.name).slice(0, 60);
      if (body.kind !== undefined && providers.KINDS[body.kind]) rec.kind = body.kind;
      if (body.baseUrl !== undefined) rec.baseUrl = String(body.baseUrl).trim().replace(/\/+$/, '');
      if (body.model !== undefined) rec.model = String(body.model).trim();
      if (Array.isArray(body.models)) rec.models = body.models.map((m) => String(m).trim()).filter(Boolean);
      // 空 key 表示"保持原样"，避免界面把已存的 key 抹掉
      if (typeof body.apiKey === 'string' && body.apiKey.trim()) rec.apiKey = body.apiKey.trim();
      if (body.clearKey === true) rec.apiKey = '';
      rec.lastTestOk = null;
      await providers.save(pdb);
      return json(res, 200, { ok: true, provider: providers.mask(rec) });
    }

    if (method === 'DELETE' && sub === '') {
      pdb.providers = pdb.providers.filter((x) => x.id !== rec.id);
      if (pdb.active === rec.id) pdb.active = pdb.providers[0] ? pdb.providers[0].id : null;
      await providers.save(pdb);
      return json(res, 200, { ok: true, active: pdb.active });
    }

    if (method === 'POST' && sub === '/test') {
      try {
        const r = await providers.testProvider(rec);
        rec.lastTestAt = nowIso(); rec.lastTestOk = true; rec.lastError = '';
        await providers.save(pdb);
        return json(res, 200, { ok: true, test: { ok: true, ms: r.ms, reply: r.reply } });
      } catch (e) {
        rec.lastTestAt = nowIso(); rec.lastTestOk = false; rec.lastError = String(e.message).slice(0, 300);
        await providers.save(pdb);
        return json(res, 200, { ok: true, test: { ok: false, error: String(e.message).slice(0, 400) } });
      }
    }

    if (method === 'POST' && sub === '/models') {
      try {
        const ids = await providers.listModels(rec);
        rec.models = [...new Set([...(rec.models || []), ...ids])];
        if (!rec.model && rec.models.length) rec.model = rec.models[0];
        await providers.save(pdb);
        return json(res, 200, { ok: true, models: rec.models, fetched: ids.length });
      } catch (e) {
        return json(res, 200, { ok: true, error: String(e.message).slice(0, 300), models: rec.models || [], fetched: 0 });
      }
    }
  }

  /* ================= 公司知识 / 工具 / 文件 ================= */
  if (method === 'GET' && p === '/api/knowledge') return json(res, 200, knowledge.publicView());

  if (method === 'POST' && p === '/api/knowledge') {
    const body = await readBody(req);
    const kdb = knowledge.load();
    if (body.company && typeof body.company === 'object') {
      for (const k of knowledge.TEXT_KEYS) {
        if (body.company[k] !== undefined) {
          // 说明 / 自定义指令是整段话，600 字符不够用；名字、站点这类仍然很短
          const cap = ['description', 'customInstructions', 'writingStyle', 'visualStyle'].includes(k) ? 4000 : 600;
          kdb.company[k] = String(body.company[k]).slice(0, cap);
        }
      }
      for (const k of knowledge.LIST_KEYS) {
        if (body.company[k] !== undefined) {
          kdb.company[k] = (Array.isArray(body.company[k]) ? body.company[k] : String(body.company[k]).split(/[\n,，]/))
            .map((s) => String(s).trim()).filter(Boolean).slice(0, 30);
        }
      }
    }
    if (body.gsc && typeof body.gsc === 'object') {
      kdb.gsc = { ...kdb.gsc, ...body.gsc };
      kdb.gsc.connected = !!body.gsc.connected;
      kdb.gsc.connectedAt = kdb.gsc.connected ? nowIso() : null;
      if (body.gsc.raw !== undefined) kdb.gsc.raw = String(body.gsc.raw).slice(0, 200000);
      if (body.gsc.note !== undefined) kdb.gsc.note = String(body.gsc.note).slice(0, 20000);
      if (body.gsc.site !== undefined) kdb.gsc.site = String(body.gsc.site).slice(0, 200);
      if (kdb.gsc.raw && !body.gsc.raw && kdb.gsc.importedAt === null) kdb.gsc.importedAt = null;
      if (body.gsc.raw && String(body.gsc.raw).trim()) kdb.gsc.importedAt = nowIso();
    }
    // 兜底：如果还有老调用把 audiences / contentPillars 当字符串数组发过来，
    // 归一成结构化条目，而不是把已有对象覆盖成字符串
    if (body.company && (Array.isArray(body.company.audiences) || Array.isArray(body.company.contentPillars)
    || Array.isArray(body.company.writingStyles) || String(body.company.writingStyle || '').trim()
    || Array.isArray(body.company.visualStyles) || String(body.company.visualStyle || '').trim())) {
      knowledge.migrateCompany(kdb.company);
    }
    // 兼容旧调用：{tool:{id, connected, data}} —— 走和 /api/tools 同一套逻辑
    if (body.tool && body.tool.id) {
      if (body.tool.connected === true) {
        knowledge.authorizeTool(kdb, body.tool.id, {
          token: body.tool.token || '',
          account: body.tool.account || '',
          skipToken: !body.tool.token,
          data: body.tool.data
        });
      } else if (body.tool.connected === false) {
        knowledge.disconnectTool(kdb, body.tool.id);
      }
      if (body.tool.data !== undefined && body.tool.connected !== true) {
        knowledge.setToolData(kdb, body.tool.id, body.tool.data);
      }
    }
    await knowledge.save(kdb);
    return json(res, 200, { ok: true, knowledge: knowledge.publicView(kdb) });
  }

  /* ---------- Target audiences / Content pillars（结构化条目） ---------- */

  if (method === 'POST' && p === '/api/knowledge/audience') {
    const body = await readBody(req);
    const kdb = knowledge.load();
    const a = body.id
      ? knowledge.updateAudience(kdb, String(body.id), body)
      : knowledge.addAudience(kdb, body);
    knowledge.save(kdb);
    return json(res, 200, { ok: true, audience: a, knowledge: knowledge.publicView(kdb) });
  }

  const mAud = p.match(/^\/api\/knowledge\/audience\/([^/]+)$/);
  if (mAud && method === 'DELETE') {
    const kdb = knowledge.load();
    const okA = knowledge.removeAudience(kdb, decodeURIComponent(mAud[1]));
    if (!okA) throw httpError(404, '没有这个目标受众');
    knowledge.save(kdb);
    return json(res, 200, { ok: true, knowledge: knowledge.publicView(kdb) });
  }

  if (method === 'POST' && p === '/api/knowledge/pillar') {
    const body = await readBody(req);
    const kdb = knowledge.load();
    const x = body.id
      ? knowledge.updatePillar(kdb, String(body.id), body)
      : knowledge.addPillar(kdb, body);
    knowledge.save(kdb);
    return json(res, 200, { ok: true, pillar: x, knowledge: knowledge.publicView(kdb) });
  }

  const mPil = p.match(/^\/api\/knowledge\/pillar\/([^/]+)$/);
  if (mPil && method === 'DELETE') {
    const kdb = knowledge.load();
    const okP = knowledge.removePillar(kdb, decodeURIComponent(mPil[1]));
    if (!okP) throw httpError(404, '没有这个内容支柱');
    knowledge.save(kdb);
    return json(res, 200, { ok: true, knowledge: knowledge.publicView(kdb) });
  }

  /* ---------- Writing styles（结构化：开关 + 下拉 + 备注） ---------- */

  if (method === 'POST' && p === '/api/knowledge/writing-style') {
    const body = await readBody(req);
    const kdb = knowledge.load();
    const w = body.id
      ? knowledge.updateWritingStyle(kdb, String(body.id), body)
      : knowledge.addWritingStyle(kdb, body);
    knowledge.save(kdb);
    return json(res, 200, { ok: true, writingStyle: w, knowledge: knowledge.publicView(kdb) });
  }

  const mWs = p.match(/^\/api\/knowledge\/writing-style\/([^/]+)$/);
  if (mWs && method === 'DELETE') {
    const kdb = knowledge.load();
    const okW = knowledge.removeWritingStyle(kdb, decodeURIComponent(mWs[1]));
    if (!okW) throw httpError(404, '没有这条写作规范');
    knowledge.save(kdb);
    return json(res, 200, { ok: true, knowledge: knowledge.publicView(kdb) });
  }

  /* ---------- Visual styles（结构化）+ 图片库 ---------- */

  if (method === 'POST' && p === '/api/knowledge/visual-style') {
    const body = await readBody(req);
    const kdb = knowledge.load();
    const v = body.id
      ? knowledge.updateVisualStyle(kdb, String(body.id), body)
      : knowledge.addVisualStyle(kdb, body);
    knowledge.save(kdb);
    return json(res, 200, { ok: true, visualStyle: v, knowledge: knowledge.publicView(kdb) });
  }

  const mVs = p.match(/^\/api\/knowledge\/visual-style\/([^/]+)$/);
  if (mVs && method === 'DELETE') {
    const kdb = knowledge.load();
    const okV = knowledge.removeVisualStyle(kdb, decodeURIComponent(mVs[1]));
    if (!okV) throw httpError(404, '没有这条视觉风格');
    knowledge.save(kdb);
    return json(res, 200, { ok: true, knowledge: knowledge.publicView(kdb) });
  }

  if (method === 'POST' && p === '/api/knowledge/image') {
    // 图片是 base64 data URL，比普通 JSON 大，单独放宽到 8MB
    const body = await readBody(req, 8 * 1024 * 1024);
    const kdb = knowledge.load();
    let rec;
    try {
      rec = knowledge.addImage(kdb, body.name, body.data);
    } catch (e) {
      throw httpError(e.status || 400, e.message);
    }
    knowledge.save(kdb);
    const view = knowledge.publicView(kdb);
    return json(res, 200, {
      ok: true,
      image: view.images.find((i) => i.id === rec.id),
      images: view.images
    });
  }

  const mImg = p.match(/^\/api\/knowledge\/images\/([^/]+)$/);
  if (mImg && method === 'GET') {
    const img = knowledge.readImage(decodeURIComponent(mImg[1]));
    if (!img) throw httpError(404, '图片不存在');
    return sendImage(res, img);
  }

  const mImgDel = p.match(/^\/api\/knowledge\/image\/([^/]+)$/);
  if (mImgDel && method === 'DELETE') {
    const kdb = knowledge.load();
    const okI = knowledge.removeImage(kdb, decodeURIComponent(mImgDel[1]));
    if (!okI) throw httpError(404, '图片不存在');
    knowledge.save(kdb);
    return json(res, 200, { ok: true, knowledge: knowledge.publicView(kdb) });
  }

  /* ---------- Brand voices（Strategy → Company knowledge → Brand voices） ---------- */

  if (method === 'POST' && p === '/api/knowledge/voice') {
    const body = await readBody(req);
    const kdb = knowledge.load();
    const v = body.id
      ? knowledge.updateVoice(kdb, String(body.id), body)
      : knowledge.addVoice(kdb, body);
    knowledge.save(kdb);
    return json(res, 200, { ok: true, voice: v, knowledge: knowledge.publicView(kdb) });
  }

  const mVoice = p.match(/^\/api\/knowledge\/voice\/([^/]+)$/);
  if (mVoice && method === 'DELETE') {
    const kdb = knowledge.load();
    const id = decodeURIComponent(mVoice[1]);
    const okv = knowledge.removeVoice(kdb, id);
    if (!okv) throw httpError(404, '没有这条 brand voice');
    knowledge.save(kdb);
    return json(res, 200, { ok: true, knowledge: knowledge.publicView(kdb) });
  }

  /* ================= Strategy：内容审计 / 插件 / 技能 ================= */

  if (method === 'GET' && p === '/api/strategy') {
    ensureLegacyProvider();
    const pdb = providers.publicDb();
    const kdb = knowledge.load();
    const kview = knowledge.publicView(kdb);
    const cdb = chats.load();
    const sk = skills.load();
    const res_ = audit.analyze(kdb.gsc.raw || '', { pillars: knowledge.brief(kdb.company).contentPillars });
    const active = pdb.providers.find((x) => x.id === pdb.active) || null;
    return json(res, 200, {
      knowledge: kview,
      blocks: kview.blocks,
      gsc: kdb.gsc,
      audit: { ...res_, hasData: !!String(kdb.gsc.raw || '').trim() },
      skills: skills.list(sk),
      tools: kview.tools,
      gscStatus: gsc.publicView(gsc.load(), hostPort(req)),
      catalog: knowledge.APP_CATALOG,
      chats: chats.list(cdb).slice(0, 12),
      provider: active ? { name: active.name, model: active.model, kind: active.kind } : null,
      stats: {
        campaigns: db.campaigns.length,
        pillars: (kdb.company.contentPillars || []).length,
        skills: sk.skills.length,
        plugins: kview.tools.filter((t) => t.connected).length
      }
    });
  }

  if (method === 'POST' && p === '/api/audit') {
    const body = await readBody(req);
    const kdb = knowledge.load();
    const raw = String(body.raw !== undefined ? body.raw : kdb.gsc.raw || '');
    if (body.raw !== undefined) {
      kdb.gsc.raw = raw.slice(0, 200000);
      kdb.gsc.importedAt = raw.trim() ? nowIso() : null;
      await knowledge.save(kdb);
    }
    const r = audit.analyze(raw, { pillars: knowledge.brief(kdb.company).contentPillars });
    return json(res, 200, { ok: true, audit: r, importedAt: kdb.gsc.importedAt });
  }

  if (method === 'GET' && p === '/api/skills') {
    const sk = skills.load();
    return json(res, 200, { ok: true, skills: skills.list(sk) });
  }
  if (method === 'POST' && p === '/api/skills') {
    const body = await readBody(req);
    const sk = skills.load();
    let rec;
    try { rec = skills.create(sk, body); } catch (e) { throw httpError(e.status || 400, e.message); }
    await skills.save(sk);
    return json(res, 200, { ok: true, skill: rec, skills: skills.list(sk) });
  }
  const mSk = p.match(/^\/api\/skills\/([^/]+)$/);
  if (mSk) {
    const sk = skills.load();
    if (method === 'PATCH') {
      const body = await readBody(req);
      let rec;
      try { rec = skills.update(sk, mSk[1], body); } catch (e) { throw httpError(e.status || 400, e.message); }
      await skills.save(sk);
      return json(res, 200, { ok: true, skill: rec, skills: skills.list(sk) });
    }
    if (method === 'DELETE') {
      const okDel = skills.remove(sk, mSk[1]);
      await skills.save(sk);
      return json(res, 200, { ok: okDel, skills: skills.list(sk) });
    }
  }

  /* ---------- Google Search Console：真 OAuth ---------- */
  if (method === 'GET' && p === '/api/gsc') {
    return json(res, 200, { ok: true, gsc: gsc.publicView(gsc.load(), hostPort(req)) });
  }

  if (method === 'POST' && p === '/api/gsc/credentials') {
    const body = await readBody(req);
    const g = gsc.load();
    try { gsc.setCredentials(g, body); } catch (e) { throw httpError(e.status || 400, e.message); }
    await gsc.save(g);
    return json(res, 200, { ok: true, gsc: gsc.publicView(g, hostPort(req)) });
  }

  // 浏览器直接跳 Google（不是 XHR），所以失败也用 302 带回前端
  if (method === 'GET' && p === '/api/gsc/authorize') {
    const g = gsc.load();
    let url;
    try {
      url = gsc.authUrl(g, hostPort(req));
    } catch (e) {
      return redirect(res, '/?gsc=err&msg=' + encodeURIComponent(e.message));
    }
    await gsc.save(g);
    return redirect(res, url);
  }

  if (method === 'GET' && p === '/api/gsc/callback') {
    const u = new URL(req.url, 'http://127.0.0.1');
    const g = gsc.load();
    const fail = (msg) => {
      g.lastError = String(msg).slice(0, 400);
      try { gsc.save(g); } catch (_) { /* 尽力 */ }
      return redirect(res, '/?gsc=err&msg=' + encodeURIComponent(String(msg).slice(0, 300)));
    };
    const err = u.searchParams.get('error');
    if (err) return fail('Google 拒绝了授权：' + err);
    const code = u.searchParams.get('code');
    const state = u.searchParams.get('state');
    if (!code) return fail('回调里没有 code');
    if (!state || state !== g.state) return fail('state 不匹配（可能页面过期了，重新点一次授权）');
    try {
      await gsc.exchangeCode(g, code, hostPort(req));
      // 授权本身成功了；拉站点列表可能因为网络出不去而失败 —— 那不算授权失败，
      // 只是"站点要手填"，如实告诉用户，不要把 token 丢掉。
      let sites = [];
      let warn = '';
      try { sites = await gsc.listSites(g); } catch (e) { warn = e.message; }
      g.state = '';
      g.source = 'gsc-api';
      g.lastError = warn || null;
      // 同步一份"已授权"状态到共享的 knowledge.gsc，Dashboard 的卡立刻变 Connected
      if (g.site) {
        const kdb = knowledge.load();
        kdb.gsc = { ...kdb.gsc, connected: true, site: g.site, connectedAt: nowIso() };
        await knowledge.save(kdb);
      }
      await gsc.save(g);
      const qs = '?gsc=ok&sites=' + encodeURIComponent(String(sites.length)) +
        (warn ? '&warn=' + encodeURIComponent(warn.slice(0, 240)) : '');
      return redirect(res, '/' + qs);
    } catch (e) {
      return fail(e.message);
    }
  }

  if (method === 'POST' && p === '/api/gsc/site') {
    const body = await readBody(req);
    const g = gsc.load();
    g.site = String((body && body.site) || '').slice(0, 300);
    await gsc.save(g);
    const kdb = knowledge.load();
    if (g.site) {
      kdb.gsc = { ...kdb.gsc, connected: true, site: g.site };
      await knowledge.save(kdb);
    }
    return json(res, 200, { ok: true, gsc: gsc.publicView(g, hostPort(req)) });
  }

  // 拉 Search Analytics → 写成 TSV 存进 knowledge.gsc.raw，交给同一套 audit 分析
  if (method === 'POST' && p === '/api/gsc/sync') {
    const body = await readBody(req);
    const g = gsc.load();
    try {
      const r = await gsc.sync(g, { days: body && body.days });
      const tsv = gsc.rowsToTsv(r.rows).slice(0, 200000);
      const kdb = knowledge.load();
      kdb.gsc = {
        ...kdb.gsc,
        connected: true,
        site: g.site,
        raw: tsv,
        note: '',
        importedAt: nowIso(),
        connectedAt: kdb.gsc.connectedAt || nowIso(),
        source: 'gsc-api'
      };
      await knowledge.save(kdb);
      await gsc.save(g);
      const a = audit.analyze(tsv, { pillars: knowledge.brief(kdb.company).contentPillars });
      return json(res, 200, {
        ok: true,
        rows: r.rows.length,
        span: r.span,
        startDate: r.startDate,
        endDate: r.endDate,
        audit: { ...a, hasData: !!tsv.trim() },
        knowledge: knowledge.publicView(kdb),
        gsc: gsc.publicView(g, hostPort(req))
      });
    } catch (e) {
      g.lastError = String(e.message).slice(0, 400);
      try { await gsc.save(g); } catch (_) { /* 尽力 */ }
      // 和 provider 的约定一致：业务失败也返回 200，让前端能显示原因
      return json(res, 200, { ok: true, error: String(e.message).slice(0, 400), rows: 0 });
    }
  }

  if (method === 'POST' && p === '/api/gsc/disconnect') {
    const g = gsc.load();
    gsc.disconnect(g);
    await gsc.save(g);
    const kdb = knowledge.load();
    kdb.gsc = { ...kdb.gsc, connected: false, connectedAt: null, source: kdb.gsc.raw ? 'gsc-api' : '' };
    await knowledge.save(kdb);
    return json(res, 200, { ok: true, gsc: gsc.publicView(g, hostPort(req)), knowledge: knowledge.publicView(kdb) });
  }

  /* ---------- 应用目录：安装 / 授权 / 断开 ---------- */
  if (method === 'POST' && (p === '/api/tools' || p === '/api/plugins')) {
    const body = await readBody(req);
    const kdb = knowledge.load();
    const action = String((body && body.action) || 'install');
    let tool = null;
    try {
      if (action === 'install') knowledge.installTool(kdb, body.id);
      else if (action === 'uninstall' || action === 'remove') knowledge.uninstallTool(kdb, body.id);
      else if (action === 'authorize') knowledge.authorizeTool(kdb, body.id, body);
      else if (action === 'disconnect') knowledge.disconnectTool(kdb, body.id);
      else if (action === 'data') knowledge.setToolData(kdb, body.id, body.data);
      else if (action === 'add') tool = knowledge.addTool(kdb, body);
      else throw httpError(400, '未知动作: ' + action);
    } catch (e) {
      throw httpError(e.status || 400, e.message);
    }
    await knowledge.save(kdb);
    return json(res, 200, { ok: true, action, tool, knowledge: knowledge.publicView(kdb) });
  }

  const mTool = p.match(/^\/api\/(?:tools|plugins)\/([^/]+)$/);
  if (mTool && (method === 'DELETE')) {
    const kdb = knowledge.load();
    try { knowledge.uninstallTool(kdb, mTool[1]); } catch (e) { throw httpError(e.status || 400, e.message); }
    await knowledge.save(kdb);
    return json(res, 200, { ok: true, knowledge: knowledge.publicView(kdb) });
  }


  if (method === 'POST' && p === '/api/knowledge/files') {
    const body = await readBody(req);
    const kdb = knowledge.load();
    let rec;
    try {
      rec = knowledge.addFile(kdb, body.name, body.text);
    } catch (e) {
      throw httpError(e.status || 400, e.message);
    }
    await knowledge.save(kdb);
    return json(res, 200, { ok: true, file: rec, files: kdb.files });
  }

  if (method === 'GET' && p === '/api/knowledge/files/search') {
    const q = u.searchParams.get('q') || '';
    const kdb = knowledge.load();
    return json(res, 200, { ok: true, q, hits: knowledge.searchFiles(kdb, q) });
  }

  const mKf = p.match(/^\/api\/knowledge\/files\/([^/]+)$/);
  if (mKf) {
    if (method === 'DELETE') {
      const kdb = knowledge.load();
      const removed = knowledge.removeFile(kdb, mKf[1]);
      await knowledge.save(kdb);
      return json(res, 200, { ok: removed, files: kdb.files });
    }
    if (method === 'GET') {
      const text = knowledge.readOne(mKf[1]);
      const kdb = knowledge.load();
      const rec = kdb.files.find((f) => f.id === mKf[1]);
      return json(res, 200, { ok: true, name: rec ? rec.name : mKf[1], text: text.slice(0, 20000), chars: text.length });
    }
  }

  /* ================= 对话 ================= */
  if (method === 'GET' && p === '/api/chats') {
    const cdb = chats.load();
    return json(res, 200, { ok: true, chats: chats.list(cdb) });
  }
  if (method === 'POST' && p === '/api/chats') {
    const body = await readBody(req);
    const cdb = chats.load();
    const chat = chats.create(cdb, body.title);
    await chats.save(cdb);
    return json(res, 200, { ok: true, chat });
  }
  const mChat = p.match(/^\/api\/chats\/([^/]+)$/);
  if (mChat) {
    const cdb = chats.load();
    if (method === 'GET') {
      const chat = chats.get(cdb, mChat[1]);
      if (!chat) throw httpError(404, '对话不存在');
      return json(res, 200, { ok: true, chat });
    }
    if (method === 'DELETE') {
      const removed = chats.remove(cdb, mChat[1]);
      await chats.save(cdb);
      return json(res, 200, { ok: removed, chats: chats.list(cdb) });
    }
  }

  /* ================= dashboard / agent ================= */
  if (method === 'GET' && p === '/api/dashboard') return json(res, 200, dashboardView());

  if (method === 'POST' && p === '/api/agent/chat') {
    const body = await readBody(req);
    const text = String(body.text || '').trim();
    if (!text) throw httpError(400, '消息不能为空');

    const cdb = chats.load();
    let chat = body.chatId ? chats.get(cdb, body.chatId) : null;
    if (!chat) chat = chats.create(cdb, text);
    chats.addMessage(chat, { role: 'user', content: text });

    const kdb = knowledge.load();
    const skdb = skills.load();
    const usedSkill = skills.matchSkill(text, skdb);
    const ctxText = agent.buildContext({
      knowledge: kdb,
      campaigns: db.campaigns,
      calendar: calendarRows(),
      files: knowledge.readFiles(kdb)
    });

    let reply = '';
    let planned = [];
    let source = 'template';
    let degraded = null;
    let providerName = '';

    const pv = providers.activeProvider();
    if (pv && pv.baseUrl && pv.model) {
      try {
        const history = chat.messages.slice(-7, -1).map((m) => ({ role: m.role, content: m.content }));
        const out = await providers.chat(pv, {
          system: usedSkill ? agent.SYSTEM_PROMPT + '\n\n' + skills.instruction(usedSkill) : agent.SYSTEM_PROMPT,
          messages: [...history, { role: 'user', content: `${ctxText}\n\n---\n\n用户指令：${text}` }],
          maxTokens: 2600,
          temperature: 0.5
        });
        providers.countCall();
        source = pv.kind;
        providerName = pv.name || pv.model;
        planned = agent.parseActions(out);
        reply = agent.stripActions(out);
      } catch (e) {
        degraded = String(e.message).slice(0, 300);
      }
    } else {
      degraded = '没有配置可用的模型（顶部 banner 里加一个 provider，或本地跑一个 OpenAI 兼容服务）';
    }

    if (source === 'template') {
      const t = agent.planTemplate({ knowledge: kdb, campaigns: db.campaigns });
      planned = t.actions;
      reply = t.reply;
    }

    const executed = [];
    const ctx = { db, uid, nowIso, runAndAttach, briefView };
    for (const a of planned) {
      try {
        executed.push(actionsMod.execute(a, ctx));
      } catch (e) {
        executed.push({ type: a.type, ok: false, summary: '执行失败：' + e.message });
      }
    }
    if (executed.some((x) => x.ok)) await persist();

    const am = chats.addMessage(chat, {
      role: 'assistant', content: reply, actions: executed, error: degraded,
      skill: usedSkill ? usedSkill.name : null
    });
    await chats.save(cdb);
    return json(res, 200, {
      ok: true, chatId: chat.id, chat, message: am, executed, source, providerName, degraded,
      skill: usedSkill ? { id: usedSkill.id, name: usedSkill.name } : null
    });
  }

  /* ================= Content（内容资产仓库） ================= */

  /** 每次读都补一次同步：老 campaign/资产也能出现在列表里，且幂等 */
  async function contentDbSynced() {
    const cdb = content.load();
    if (content.sync(cdb, db.campaigns)) await content.save(cdb);
    return cdb;
  }

  /**
   * 文章行的 GEO & SEO / Content gap 是真算的：在编辑器里怎么算，列表里就怎么算。
   * 其它类型没有这两项的数据源，继续留 null（列表显示 —），不编数字。
   * 只在内存里补，不写盘 —— 分数是正文的函数，存下来就会和正文脱节。
   */
  function attachArticleScores(items, campaigns) {
    const list = (items || []).filter((it) => it && it.type === 'article' && it.assetId);
    if (!list.length) return items;
    const ctx = article.knowledgeCtx();
    const byId = new Map();
    (campaigns || []).forEach((cp) => (cp.assets || []).forEach((a) => byId.set(a.id, a)));
    for (const it of list) {
      const a = byId.get(it.assetId);
      const v = a && (a.versions || []).find((x) => x.v === a.current);
      const sc = article.scoresOf(it, (v && v.body) || '', ctx);
      it.geo = sc.geo;
      it.gap = sc.gap;
    }
    return items;
  }

  if (method === 'GET' && p === '/api/content/meta') {
    return json(res, 200, {
      ok: true,
      types: content.TYPES, statuses: content.STATUSES, groups: content.GROUPS,
      mediaSubs: content.MEDIA_SUBS, columns: content.COLUMNS
    });
  }

  if (method === 'GET' && p === '/api/content') {
    const cdb = await contentDbSynced();
    attachArticleScores(cdb.items, db.campaigns);
    const page = content.query(cdb, {
      group: u.searchParams.get('group') || 'content',
      status: u.searchParams.get('status') || '',
      q: u.searchParams.get('q') || '',
      sort: u.searchParams.get('sort') || '',
      dir: u.searchParams.get('dir') || 'desc',
      page: u.searchParams.get('page') || 1,
      size: u.searchParams.get('size') || 20
    }, db.campaigns);
    return json(res, 200, { ok: true, ...page, counts: content.counts(cdb, db.campaigns) });
  }

  if (method === 'POST' && p === '/api/content') {
    const body = await readBody(req);
    const meta = content.typeOf(body.type);
    if (!meta) throw httpError(400, '内容类型不对：' + String(body.type || '(空)'));
    const title = String(body.title || '').trim();
    if (!title) throw httpError(400, '标题不能为空');

    // 内容要能「进编辑器」，所以背后得有一个 campaign（+ 一个资产）
    let cp = body.campaignId ? findCampaign(String(body.campaignId)) : null;
    if (!cp) {
      cp = {
        id: uid('cp'),
        name: title,
        objective: '', productName: '', subject: '', audience: '',
        language: String(body.language || 'en'),
        tone: '', cta: '', fromName: String(body.author || ''),
        links: { product: '', demo: '' }, sellingPoints: [], rawMaterial: '',
        createdAt: nowIso(), updatedAt: nowIso(), assets: []
      };
      if (meta.id === 'campaign') cp.contentType = 'campaign';
      db.campaigns.unshift(cp);
    }
    let assetId = '';
    if (meta.id !== 'campaign') {
      const a = newAsset(cp, meta.channel, { title, scheduledAt: body.effectiveDate });
      assetId = a.id;
    }
    await persist();

    const cdb = await contentDbSynced();
    const id = assetId ? 'ct_as_' + assetId : 'ct_cp_' + cp.id;
    const item = content.find(cdb, id);
    if (item) {
      content.update(cdb, id, {
        category: body.category || meta.label,
        tags: body.tags || [],
        keywords: body.keywords || [],
        dueDate: body.dueDate || '',
        language: body.language || cp.language,
        author: body.author || cp.fromName
      });
      content.save(cdb);
    }
    return json(res, 200, { ok: true, item: item ? content.derive({ ...item }, db.campaigns) : null, campaignId: cp.id, assetId });
  }

  const mCt = p.match(new RegExp(String.raw`^/api/content/([^/]+)(/.*)?$`));
  if (mCt) {
    const cdb = await contentDbSynced();
    const item = content.find(cdb, decodeURIComponent(mCt[1]));
    if (!item) throw httpError(404, '没有这条内容: ' + mCt[1]);
    const sub = mCt[2] || '';

    if (method === 'GET' && sub === '') {
      const one = content.derive({ ...item }, db.campaigns);
      attachArticleScores([one], db.campaigns);
      return json(res, 200, { ok: true, item: one });
    }

    if (method === 'POST' && sub === '/duplicate') {
      const copy = content.duplicate(cdb, item.id);
      // 挂着的资产也真复制一份（否则副本没有编辑器可进）
      if (item.assetId) {
        const cp = db.campaigns.find((c) => c.id === item.campaignId);
        const src = cp && (cp.assets || []).find((a) => a.id === item.assetId);
        if (src) {
          const a = newAsset(cp, src.channel, { title: copy.title, scheduledAt: src.scheduledAt });
          a.current = src.current;
          a.versions = JSON.parse(JSON.stringify(src.versions || []));
          content.update(cdb, copy.id, { campaignId: cp.id, assetId: a.id, campaign: cp.name });
          await persist();
        }
      }
      await content.save(cdb);
      const freshC = await contentDbSynced();
      return json(res, 200, { ok: true, item: content.derive({ ...content.find(freshC, copy.id) }, db.campaigns) });
    }

    if (method === 'POST' && sub === '/status') {
      const body = await readBody(req);
      if (body.approval !== undefined) {
        content.update(cdb, item.id, { approval: body.approval });
        // 批准 / 打回也真的落到当前版本上（列表和编辑器不能各说一套）
        if (item.assetId) {
          const cp = db.campaigns.find((c) => c.id === item.campaignId);
          const a = cp && (cp.assets || []).find((x) => x.id === item.assetId);
          const cur = a && (a.versions || []).find((v) => v.v === a.current);
          if (cur && body.approval) {
            cur.status = body.approval === 'approved' ? 'approved' : 'draft';
            cur.approvedAt = body.approval === 'approved' ? nowIso() : null;
            await persist();
          }
        }
      }
      if (body.status !== undefined) content.update(cdb, item.id, { status: body.status });
      await content.save(cdb);
      const freshS = await contentDbSynced();
      return json(res, 200, { ok: true, item: content.derive({ ...content.find(freshS, item.id) }, db.campaigns) });
    }

    if (method === 'PATCH' && sub === '') {
      const body = await readBody(req);
      // 先写资产（编辑器读的是资产），再写条目
      if (item.assetId) {
        const cp = db.campaigns.find((c) => c.id === item.campaignId);
        const a = cp && (cp.assets || []).find((x) => x.id === item.assetId);
        if (a) {
          if (body.title !== undefined) a.title = String(body.title).trim();
          if (body.effectiveDate !== undefined) {
            a.scheduledAt = validDate(body.effectiveDate) ? body.effectiveDate : null;
          }
          if (body.campaign !== undefined && body.campaign) cp.name = String(body.campaign).trim();
          cp.updatedAt = nowIso();
        }
      }
      content.update(cdb, item.id, body);
      await persist();
      await content.save(cdb);
      const freshP = await contentDbSynced();
      return json(res, 200, { ok: true, item: content.derive({ ...content.find(freshP, item.id) }, db.campaigns) });
    }

    if (method === 'DELETE' && sub === '') {
      // 删内容 = 删掉它背后的资产；campaign 条目才删整条 campaign
      content.remove(cdb, item.id);
      if (item.assetId) {
        const cp = db.campaigns.find((c) => c.id === item.campaignId);
        if (cp) {
          cp.assets = (cp.assets || []).filter((a) => a.id !== item.assetId);
          cp.updatedAt = nowIso();
          // 这个 campaign 就是个容器，空了就一起收拾掉
          if (!cp.assets.length && cp.contentType !== 'campaign') {
            db.campaigns = db.campaigns.filter((x) => x.id !== cp.id);
            cdb.items = cdb.items.filter((x) => x.campaignId !== cp.id);
          }
        }
      } else if (item.campaignId) {
        const gone = item.campaignId;
        db.campaigns = db.campaigns.filter((c) => c.id !== gone);
        // 整条 campaign 没了，它的子资产条目也一起清掉（否则成一堆点不开的孤儿）
        cdb.items = cdb.items.filter((x) => x.campaignId !== gone);
      }
      await persist();
      await content.save(cdb);   // 必须先落盘：否则下面的 sync 会读到旧文件，把刚删的条目又「解绑」回来
      return json(res, 200, { ok: true, counts: content.counts(await contentDbSynced(), db.campaigns) });
    }
  }

  /* ================================================================
   * Social post composer（对标 StoryChief：/content/segments/social-post）
   * 连接模型照 StoryChief：不逐个平台 Connect —— 先连 Buffer，
   * 再把 Buffer 里已绑定的渠道列出来勾选，发布由 Buffer 执行。
   * ================================================================ */
  function socialState(item) {
    const st = (item && item.socialpost) || {};
    return {
      channelIds: Array.isArray(st.channelIds) ? st.channelIds.filter((x) => typeof x === 'string').slice(0, 40) : [],
      mainContent: typeof st.mainContent === 'string' ? st.mainContent : '',
      perChannel: st.perChannel && typeof st.perChannel === 'object' ? st.perChannel : {},
      mediaUrl: typeof st.mediaUrl === 'string' ? st.mediaUrl : '',
      mediaName: typeof st.mediaName === 'string' ? st.mediaName : '',
      scheduleAt: typeof st.scheduleAt === 'string' ? st.scheduleAt : null,
      mode: st.mode === 'schedule' ? 'schedule' : 'now',
      customize: !!st.customize,
      lastBatchId: st.lastBatchId || null,
      lastPublishAt: st.lastPublishAt || null,
      lastResults: Array.isArray(st.lastResults) ? st.lastResults.slice(0, 40) : []
    };
  }

  if (method === 'GET' && p === '/api/buffer/status') {
    return json(res, 200, Object.assign({ ok: true }, buffer.status()));
  }

  if (method === 'GET' && p === '/api/buffer/auth-url') {
    const r = buffer.authUrl();
    if (!r.ok) return json(res, 200, Object.assign({ error: r.why }, r));
    return json(res, 200, { ok: true, url: r.url, redirectUri: buffer.redirectUri() });
  }

  // Buffer 回调：浏览器会被甩回这里，处理完再 302 回前端（前端读 ?buffer=connected 弹提示）
  if (method === 'GET' && p === '/api/buffer/callback') {
    const code = u.searchParams.get('code') || '';
    const state = u.searchParams.get('state') || '';
    const denied = u.searchParams.get('error');
    try {
      if (denied) throw httpError(400, 'Buffer 拒绝了授权：' + (u.searchParams.get('error_description') || denied));
      if (!code) throw httpError(400, 'Buffer 回调里没有 code');
      await buffer.exchangeCode(code, state);
      try { await buffer.channels({ refresh: true }); } catch (e) { /* 连上了但拉不到渠道：页面会如实报错 */ }
      res.writeHead(302, { location: '/?buffer=connected' });
      return res.end();
    } catch (e) {
      res.writeHead(302, { location: '/?buffer=error&reason=' + encodeURIComponent(e.message) });
      return res.end();
    }
  }

  if (method === 'POST' && p === '/api/buffer/api-key') {
    const body = await readBody(req);
    const r = await buffer.setApiKey(body.key);
    return json(res, 200, { ok: true, org: r.org, status: buffer.status() });
  }

  if (method === 'POST' && p === '/api/buffer/disconnect') {
    buffer.disconnect();
    return json(res, 200, { ok: true, status: buffer.status() });
  }

  if (method === 'GET' && p === '/api/buffer/channels') {
    const refresh = u.searchParams.get('refresh') === '1';
    try {
      const r = await buffer.channels({ refresh });
      return json(res, 200, { ok: true, channels: r.channels, cached: r.cached, at: r.at, status: buffer.status() });
    } catch (e) {
      // 不抛 500：前端要据此切到「未连接 / 授权失效」两种状态之一
      const need = e.code === 'not_connected' ? 'connect' : 'reconnect';
      const why = buffer.friendlyError(e.message);
      return json(res, 200, { ok: false, error: why, need, why, channels: [], status: buffer.status() });
    }
  }

  if (method === 'POST' && p === '/api/buffer/create-post') {
    const body = await readBody(req);
    const r = await buffer.createPost({
      channelIds: body.channelIds,
      mainContent: body.mainContent,
      channelCustomContent: body.channelCustomContent,
      mediaUrl: body.mediaUrl,
      mediaKind: body.mediaKind || 'image',
      scheduleAt: body.scheduleAt || null,
      contentId: body.contentId || null
    });
    // 把这一批的结果记回条目（只记事实：提交了哪些渠道、各自成没成，不改状态字段去假装「已发布」）
    if (body.contentId) {
      try {
        const cdb = await contentDbSynced();
        const item = content.find(cdb, body.contentId);
        if (item) {
          const st = socialState(item);
          st.lastBatchId = r.batchId;
          st.lastPublishAt = nowIso();
          st.lastResults = r.results;
          if (body.scheduleAt) st.scheduleAt = body.scheduleAt;
          item.socialpost = st;
          item.updatedAt = nowIso();
          await content.save(cdb);
        }
      } catch (e) { /* 记不回去不影响这次发布的结果 */ }
    }
    return json(res, r.ok ? 200 : 207, r);
  }

  const mPostStatus = p.match(/^\/api\/buffer\/post-status\/(.+)$/);
  if (method === 'GET' && mPostStatus) {
    const r = await buffer.postStatus(decodeURIComponent(mPostStatus[1]));
    return json(res, 200, r);
  }

  /* ---------- 媒体：先落本地，再如实说明 Buffer 抓不抓得到 ---------- */
  if (method === 'POST' && p === '/api/social-post/media') {
    const body = await readBody(req, 14 * 1024 * 1024);
    const dataUrl = String(body.dataUrl || '');
    const m = dataUrl.match(/^data:([a-z0-9.+\/-]+);base64,([A-Za-z0-9+/=]+)$/i);
    if (!m) throw httpError(400, '只接受 data URL 形式的上传（data:<mime>;base64,...）');
    const mime = m[1].toLowerCase();
    const EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm' };
    if (!EXT[mime]) throw httpError(415, '不支持的格式：' + mime + '（支持 png/jpg/gif/webp/mp4/mov/webm）');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 8 * 1024 * 1024) throw httpError(413, '文件超过 8 MB（Buffer 那边也有上限）');
    const dir = path.join(store.DATA_DIR, 'media');
    fs.mkdirSync(dir, { recursive: true });
    const name = Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex') + EXT[mime];
    fs.writeFileSync(path.join(dir, name), buf);
    const base = buffer.cfg().publicBase || ('http://127.0.0.1:' + PORT);
    const url = base + '/media/' + name;
    const pub = !buffer.isLocalhost(base);
    return json(res, 200, {
      ok: true, name, bytes: buf.length, mime, url,
      publicUrl: pub,
      why: pub ? '' : '这个地址是本机的，Buffer 服务器抓不到。要在社媒上真带图，得把 SCA_PUBLIC_BASE 配成公网可访问的地址（或传到 R2/S3 再把公网 URL 填进来）。'
    });
  }

  /* ---------- 草稿（GET/POST /api/draft/social-post） ---------- */
  if (p === '/api/draft/social-post' && method === 'GET') {
    const id = u.searchParams.get('id') || '';
    const cdb = await contentDbSynced();
    if (id) {
      const item = content.find(cdb, id);
      if (!item) throw httpError(404, '没有这条草稿: ' + id);
      return json(res, 200, {
        ok: true, id: item.id, title: item.title, state: socialState(item),
        status: content.statusOf(item), updatedAt: item.updatedAt
      });
    }
    const drafts = cdb.items.filter((x) => x.type === 'social').slice(0, 50).map((x) => ({
      id: x.id, title: x.title, status: content.statusOf(x), updatedAt: x.updatedAt,
      channelCount: (socialState(x).channelIds || []).length,
      excerpt: String(socialState(x).mainContent || '').slice(0, 80)
    }));
    return json(res, 200, { ok: true, drafts });
  }

  if (p === '/api/draft/social-post' && method === 'POST') {
    const body = await readBody(req);
    const cdb = await contentDbSynced();
    const item = content.find(cdb, body.id);
    if (!item) throw httpError(404, '没有这条草稿: ' + body.id);
    const next = socialState(Object.assign({}, item, { socialpost: body.state || {} }));
    item.socialpost = next;
    item.updatedAt = nowIso();
    await content.save(cdb);
    return json(res, 200, { ok: true, saved: true, id: item.id, updatedAt: item.updatedAt, state: next });
  }

  if (p === '/api/draft/social-post/duplicate' && method === 'POST') {
    const body = await readBody(req);
    const cdb = await contentDbSynced();
    const src = content.find(cdb, body.id);
    if (!src) throw httpError(404, '没有这条草稿: ' + body.id);
    const copy = content.duplicate(cdb, body.id);
    copy.socialpost = socialState(src);           // 渠道勾选 / 文案 / 素材 / 定时时间整套复制
    copy.title = (src.title || 'Untitled social post') + ' (copy)';
    copy.status = 'draft';
    await content.save(cdb);
    return json(res, 200, { ok: true, item: { id: copy.id, title: copy.title }, state: copy.socialpost });
  }

  /* AI 起草：复用 lib/llm 的渠道 prompt；没有可用模型时返回离线模板并带 degraded（不假装是模型写的） */
  if (method === 'POST' && p === '/api/social-post/generate') {
    const body = await readBody(req);
    const idea = String(body.idea || '').trim();
    if (!idea) throw httpError(400, '先写一句你要表达什么');
    const settings = loadSettings();
    const channelId = String(body.channel || 'x_post');
    const brief = {
      title: idea.slice(0, 120),
      name: idea.slice(0, 120),
      objective: '',
      productName: (settings.company && settings.company.name) || '',
      audience: String(body.audience || ''),
      language: 'zh',
      tone: String(body.tone || ''),
      cta: String(body.cta || ''),
      fromName: '',
      links: {},
      sellingPoints: [],
      rawMaterial: idea
    };
    try {
      const r = await llm.generate(channelId, brief, settings, { variant: 'A' });
      return json(res, 200, { ok: true, channel: channelId, text: r.body, source: r.source, degraded: r.degraded || null });
    } catch (e) {
      throw httpError(400, 'AI 起草失败：' + e.message);
    }
  }

  /* ================================================================
   * Article 编辑器（文章母版：Write / Settings / Audience + 右侧 SEO 面板）
   * 条目还是 content.json 里的那一条，只是多挂了 item.article 元信息。
   * ================================================================ */
  if (method === 'GET' && p === '/api/article/meta') {
    return json(res, 200, {
      ok: true,
      regions: article.REGIONS,
      locales: article.LOCALES,
      audience: article.AUDIENCE,
      platforms: article.SOCIAL_PLATFORMS,
      customKeys: article.CUSTOM_KEYS,
      thresholds: {
        words: article.MIN_WORDS,
        meta: [article.META_MIN, article.META_MAX],
        seoTitle: [article.SEOTITLE_MIN, article.SEOTITLE_MAX]
      }
    });
  }

  const mAr = p.match(new RegExp(String.raw`^/api/article/([^/]+)(/.*)?$`));
  if (mAr) {
    const cdb = await contentDbSynced();
    const aid = decodeURIComponent(mAr[1]);
    const item = content.find(cdb, aid);
    if (!item) throw httpError(404, '没有这篇文章: ' + aid);
    const sub = mAr[2] || '';
    article.normalizeItem(item);

    const cp = item.campaignId ? db.campaigns.find((c) => c.id === item.campaignId) : null;
    const assetOf = (id) => (cp && (cp.assets || []).find((x) => x.id === id)) || null;
    const curOf = (a) => {
      if (!a) return null;
      const vs = a.versions || [];
      return vs.find((v) => v.v === a.current) || vs[vs.length - 1] || null;
    };
    const bodyOf = (a) => {
      const cur = curOf(a);
      return cur ? String(cur.body || '') : '';
    };
    /**
     * 写正文：没有版本就先建第 1 版；已批准的那版不许就地改（要改就另存新版本）；
     * 其余情况就地更新，这样自动保存不会刷一堆版本历史。
     */
    const writeBody = (a, text, note) => {
      const cur = curOf(a);
      if (!cur || cur.status === 'approved') {
        return { entry: runAndAttach(cp, a, text, { source: 'manual', variant: 'A', note: note || 'article-autosave' }), inPlace: false };
      }
      cur.body = text;
      cur.chars = text.length;
      cur.checks = runChecks(a.channel, text, loadSettings());
      a.updatedAt = nowIso();
      if (cp) cp.updatedAt = nowIso();
      return { entry: cur, inPlace: true };
    };
    const knCtx = article.knowledgeCtx();
    const tools = (knowledge.load().tools || []);

    /** 已绑定 = 装了 + 授权了；装了没授权单独标出来，不能显示成「已绑定」 */
    function boundApps(cat) {
      if (!cat) return [];
      return (knowledge.APP_CATALOG || [])
        .filter((a) => a.category === cat)
        .map((a) => {
          const st = tools.find((t) => t.id === a.id) || {};
          return {
            id: a.id,
            name: a.name,
            installed: !!st.installed,
            connected: !!st.connected,
            account: st.account || '',
            state: st.connected ? 'bound' : st.installed ? 'pending' : 'none'
          };
        });
    }

    function audiencePayload() {
      return article.AUDIENCE.map((c) => ({
        ...c,
        apps: boundApps(c.appCategory),
        channels: (c.channels || []).map((chId) => {
          const ch = C.channelById(chId);
          return ch ? { id: ch.id, label: ch.label, labelZh: ch.labelZh, rules: (ch.rules || []).length } : null;
        }).filter(Boolean)
      }));
    }

    function socialsPayload() {
      if (!cp) return [];
      return (cp.assets || [])
        .filter((a) => a.id !== item.assetId && (a.channel === 'x_post' || a.channel === 'reddit_post'))
        .map((a) => {
          const cur = curOf(a);
          const it = cdb.items.find((x) => x.assetId === a.id);
          return {
            assetId: a.id,
            itemId: it ? it.id : '',
            channel: a.channel,
            channelLabel: (C.channelById(a.channel) || {}).labelZh || a.channel,
            title: a.title || '',
            body: bodyOf(a),
            status: it ? content.derive({ ...it }, db.campaigns).status : 'draft',
            approval: it ? it.approval || '' : '',
            scheduledAt: a.scheduledAt || '',
            version: cur ? cur.v : 0,
            source: cur ? cur.source : '',
            checks: cur && cur.checks ? { score: cur.checks.score, fails: (cur.checks.items || []).filter((i) => !i.pass).length } : null
          };
        });
    }

    function payload() {
      const body = item.assetId ? bodyOf(assetOf(item.assetId)) : '';
      const rep = article.report(item, body, knCtx);
      const a = item.assetId ? assetOf(item.assetId) : null;
      const cur = curOf(a);
      return {
        ok: true,
        item: content.derive({ ...item }, db.campaigns),
        article: article.meta(item),
        campaign: cp ? { id: cp.id, name: cp.name, audience: cp.audience || '', objective: cp.objective || '', tone: cp.tone || '' } : null,
        asset: a ? {
          id: a.id,
          channel: a.channel,
          title: a.title || '',
          scheduledAt: a.scheduledAt || null,
          current: a.current,
          versions: (a.versions || []).length,
          status: cur ? cur.status : '',
          source: cur ? cur.source : ''
        } : null,
        body,
        report: rep,
        knowledge: {
          companyName: knCtx.companyName,
          website: knCtx.website,
          audiences: knCtx.audiences,
          pillars: knCtx.pillars,
          writingStyles: knCtx.writingStyles,
          voices: knCtx.voiceNames
        },
        audience: audiencePayload(),
        platforms: article.SOCIAL_PLATFORMS.map((pl) => ({
          ...pl,
          posts: pl.supported ? payloadSocialCount(pl.channel) : 0
        })),
        socials: socialsPayload()
      };
    }

    function payloadSocialCount(channel) {
      if (!cp) return 0;
      return (cp.assets || []).filter((a) => a.id !== item.assetId && a.channel === channel).length;
    }

    if (method === 'GET' && sub === '') return json(res, 200, payload());

    /* 正文：默认改当前版本（自动保存），mode=version 才另存新版本 */
    if (method === 'POST' && sub === '/body') {
      const body = await readBody(req);
      const a = item.assetId ? assetOf(item.assetId) : null;
      if (!a) throw httpError(400, '这条内容没有可写的资产');
      const text = String(body.body == null ? '' : body.body);
      const mode = body.mode === 'version' ? 'version' : 'current';
      let entry;
      let inPlace = false;
      if (mode === 'version') {
        entry = runAndAttach(cp, a, text, { source: 'manual', variant: 'A', note: 'article-editor' });
      } else {
        const w = writeBody(a, text, 'article-autosave');
        entry = w.entry;
        inPlace = w.inPlace;
      }
      await persist();
      await content.save(cdb);
      return json(res, 200, {
        ok: true,
        saved: inPlace ? 'current' : 'version',
        v: entry.v,
        report: article.report(item, text, knCtx)
      });
    }

    /* 自动填充：规则版。mode=ai 但没有模型时如实标 degraded */
    if (method === 'POST' && sub === '/autofill') {
      const body = await readBody(req);
      const a = item.assetId ? assetOf(item.assetId) : null;
      const text = body.body != null ? String(body.body) : bodyOf(a);
      const r = article.autofill(item, text, String(body.field || ''), body.mode === 'ai' ? 'ai' : 'rule');
      if (!r.ok) throw httpError(400, r.error);
      if (body.apply) {
        item.article = { ...article.meta(item), [r.field]: r.value, savedAt: nowIso() };
        await content.save(cdb);
      }
      return json(res, 200, { ok: true, ...r });
    }

    /* 生成：target=article 写母版；target=social 建一条社媒子资产再生成 */
    if (method === 'POST' && sub === '/generate') {
      const body = await readBody(req);
      if (!cp) throw httpError(400, '这篇文章没有 campaign，没法生成');
      const settings = loadSettings();
      const target = body.target === 'social' ? 'social' : 'article';

      if (target === 'article') {
        let a = item.assetId ? assetOf(item.assetId) : null;
        if (!a) {
          a = newAsset(cp, 'landing_hero', { title: item.title });
          content.update(cdb, item.id, { assetId: a.id, campaignId: cp.id, campaign: cp.name });
        }
        const r = await llm.generate('landing_hero', briefView(cp), settings, { ...(settings.provider || {}), variant: body.variant || 'A' });
        const entry = runAndAttach(cp, a, r.body, { source: r.source, variant: body.variant || 'A', note: 'article-ai' });
        await persist();
        await content.save(cdb);
        return json(res, 200, { ok: true, target, assetId: a.id, v: entry.v, source: r.source, degraded: r.degraded || null, payload: payload() });
      }

      const channel = String(body.channel || 'x_post');
      const pl = article.SOCIAL_PLATFORMS.find((x) => x.channel === channel && x.supported);
      if (!pl) throw httpError(400, '这个平台还没做渠道规则：' + channel);
      const a = newAsset(cp, channel, { title: item.title + ' · ' + pl.label });
      await persist();
      const r = await llm.generate(channel, briefView(cp), settings, { ...(settings.provider || {}), variant: 'A' });
      const entry = runAndAttach(cp, a, r.body, { source: r.source, variant: 'A', note: 'article-social-ai' });
      await persist();
      const fresh = await contentDbSynced();
      const it = fresh.items.find((x) => x.assetId === a.id);
      return json(res, 200, { ok: true, target, assetId: a.id, itemId: it ? it.id : '', v: entry.v, source: r.source, degraded: r.degraded || null, payload: payload() });
    }

    /* 手动建一条社媒帖（空正文，进编辑器自己写） */
    if (method === 'POST' && sub === '/socials') {
      const body = await readBody(req);
      const channel = String(body.channel || 'x_post');
      if (!C.channelById(channel)) throw httpError(400, '未知渠道: ' + channel);
      if (!cp) throw httpError(400, '这篇文章没有 campaign，没法加社媒帖');
      const a = newAsset(cp, channel, { title: item.title + ' · ' + ((C.channelById(channel) || {}).label || channel) });
      await persist();
      const fresh = await contentDbSynced();
      const it = fresh.items.find((x) => x.assetId === a.id);
      return json(res, 200, { ok: true, assetId: a.id, itemId: it ? it.id : '', payload: payload() });
    }

    /* 改 / 删一条社媒子资产 */
    const mSoc = sub.match(new RegExp(String.raw`^/socials/([^/]+)$`));
    if (mSoc) {
      const sa = assetOf(decodeURIComponent(mSoc[1]));
      if (!sa) throw httpError(404, '没有这条社媒帖');
      if (method === 'POST' || method === 'PATCH') {
        const body = await readBody(req);
        if (body.body != null) {
          writeBody(sa, String(body.body), 'social-edit');
          const it = cdb.items.find((x) => x.assetId === sa.id);
          if (it && it.title !== sa.title) it.title = sa.title;
        }
        if (body.scheduledAt !== undefined) {
          sa.scheduledAt = validDate(body.scheduledAt) ? body.scheduledAt : null;
        }
        if (body.title != null && String(body.title).trim()) sa.title = String(body.title).trim();
        sa.updatedAt = nowIso();
        cp.updatedAt = nowIso();
        await persist();
        await content.save(cdb);
        return json(res, 200, { ok: true, payload: payload() });
      }
      if (method === 'DELETE') {
        cp.assets = (cp.assets || []).filter((x) => x.id !== sa.id);
        cdb.items = cdb.items.filter((x) => x.assetId !== sa.id);
        await persist();
        await content.save(cdb);
        return json(res, 200, { ok: true, payload: payload() });
      }
    }

    /* 发布 / 定时 / 提交审核 */
    if (method === 'POST' && sub === '/publish') {
      const body = await readBody(req);
      const mode = String(body.mode || 'review');
      const a = item.assetId ? assetOf(item.assetId) : null;
      const cur = curOf(a);
      let warning = '';
      if (mode === 'review') {
        content.update(cdb, item.id, { approval: 'pending' });
        if (cur) cur.status = cur.status === 'approved' ? 'approved' : 'draft';
      } else if (mode === 'schedule') {
        const d = String(body.date || '');
        if (!validDate(d)) throw httpError(400, '日期不对：' + d);
        if (a) a.scheduledAt = d;
        content.update(cdb, item.id, { effectiveDate: d });
        if (!cur || cur.status !== 'approved') warning = '稿子还没批准，日历上能看到，但到点不会真的发出去';
      } else if (mode === 'now') {
        content.update(cdb, item.id, { approval: 'approved', status: 'published' });
        if (cur) { cur.status = 'approved'; cur.approvedAt = nowIso(); }
      } else {
        throw httpError(400, '发布方式不对：' + mode);
      }
      await persist();
      await content.save(cdb);
      const fresh = await contentDbSynced();
      return json(res, 200, {
        ok: true,
        mode,
        warning,
        // 平台直发是故意没做的（不碰你的账号），这里只把状态记下来
        note: '本地工具不直连平台：这里只记状态，真正的发布交给你现有的脚本或手工',
        item: content.derive({ ...content.find(fresh, item.id) }, db.campaigns),
        payload: payload()
      });
    }

    /* 一把改掉元信息 / 标题 / 列表字段 */
    if ((method === 'PATCH' || method === 'POST') && sub === '') {
      const body = await readBody(req);
      const fields = ['title', 'language', 'category', 'author', 'dueDate', 'status'];
      fields.forEach((f) => { if (body[f] !== undefined) content.update(cdb, item.id, { [f]: body[f] }); });
      if (Array.isArray(body.tags)) content.update(cdb, item.id, { tags: body.tags });
      if (Array.isArray(body.keywords)) content.update(cdb, item.id, { keywords: body.keywords });

      if (body.article && typeof body.article === 'object') {
        const next = article.meta(item);
        Object.keys(body.article).forEach((k) => {
          if (k === 'custom') {
            next.custom = { ...next.custom, ...(body.article.custom || {}) };
          } else if (article.CUSTOM_KEYS.includes(k)) {
            next.custom[k] = body.article[k];
          } else if (Object.prototype.hasOwnProperty.call(next, k)) {
            next[k] = body.article[k];
          }
        });
        next.savedAt = nowIso();
        item.article = article.meta({ article: next });
        // slug 留空 = 自动，按标题生成
        if (!item.article.slug) item.article.slug = article.slugify(item.title, item.id);
      }

      if (body.title !== undefined && item.assetId) {
        const a = assetOf(item.assetId);
        if (a) { a.title = String(body.title).trim(); a.updatedAt = nowIso(); }
        if (cp) cp.name = String(body.title).trim();
      }
      if (body.body != null && item.assetId) {
        const a = assetOf(item.assetId);
        if (a) writeBody(a, String(body.body), 'article-patch');
      }
      await persist();
      await content.save(cdb);
      const freshP = await contentDbSynced();
      item.article = article.meta(content.find(freshP, item.id) || item);
      return json(res, 200, { ok: true, payload: payload() });
    }
  }

  // campaigns
  if (method === 'POST' && p === '/api/campaigns') {    const body = await readBody(req);
    const cp = {
      id: uid('cp'),
      name: body.name || body.title || '未命名 campaign',
      objective: body.objective || '',
      productName: body.productName || '',
      subject: body.subject || '',
      audience: body.audience || '',
      language: body.language || 'en',
      tone: body.tone || '',
      cta: body.cta || '',
      fromName: body.fromName || '',
      links: body.links || { product: '', demo: '' },
      sellingPoints: body.sellingPoints || [],
      rawMaterial: body.rawMaterial || '',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      assets: []
    };
    db.campaigns.unshift(cp);
    await persist();
    return json(res, 200, { ok: true, campaign: cp });
  }

  const mCp = p.match(/^\/api\/campaigns\/([^/]+)(\/.*)?$/);
  if (!mCp) throw httpError(404, 'no route: ' + method + ' ' + p);
  const cp = findCampaign(mCp[1]);
  const rest = mCp[2] || '';

  if (method === 'PATCH' && rest === '') {
    const body = await readBody(req);
    for (const k of ['name', 'title', 'objective', 'productName', 'subject', 'audience', 'language', 'tone', 'cta', 'fromName', 'rawMaterial', 'sellingPoints', 'links']) {
      if (body[k] === undefined) continue;
      if (k === 'title') cp.name = body.title;
      else cp[k] = body[k];
    }
    cp.updatedAt = nowIso();
    await persist();
    return json(res, 200, { ok: true, campaign: cp });
  }

  if (method === 'DELETE' && rest === '') {
    db.campaigns = db.campaigns.filter((x) => x.id !== cp.id);
    await persist();
    return json(res, 200, { ok: true });
  }

  // 生成：为指定渠道建/复用资产
  if (method === 'POST' && rest === '/generate') {
    const body = await readBody(req);
    const settings = loadSettings();
    const ids = Array.isArray(body.channels) && body.channels.length ? body.channels : C.CHANNELS.map((c) => c.id);
    const override = { ...(settings.provider || {}), variant: body.variant || 'A' };
    const results = [];
    for (const chId of ids) {
      if (!C.channelById(chId)) continue;
      const asset = ensureAssetForChannel(cp, chId);
      const r = await llm.generate(chId, briefView(cp), settings, override);
      const entry = runAndAttach(cp, asset, r.body, { source: r.source, variant: body.variant || 'A', note: 'generated' });
      results.push({ assetId: asset.id, channel: chId, v: entry.v, source: r.source, degraded: r.degraded || null, score: entry.checks.score });
    }
    await persist();
    return json(res, 200, { ok: true, results });
  }

  if (method === 'GET' && rest === '/export') {
    const fmt = (u.searchParams.get('format') || 'md').toLowerCase();
    if (fmt === 'csv') {
      const csv = exportCsv(cp);
      res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${cp.id}.csv"` });
      return res.end('\ufeff' + csv);
    }
    const md = exportMarkdown(cp);
    if (u.searchParams.get('download') === '1') {
      res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8', 'content-disposition': `attachment; filename="${cp.id}.md"` });
      return res.end(md);
    }
    return json(res, 200, { ok: true, markdown: md });
  }

  // assets
  if (rest === '/assets' && method === 'POST') {
    const body = await readBody(req);
    const a = newAsset(cp, body.channel, { title: body.title, scheduledAt: body.scheduledAt });
    await persist();
    return json(res, 200, { ok: true, asset: a });
  }

  const mA = rest.match(/^\/assets\/([^/]+)(\/.*)?$/);
  if (!mA) throw httpError(404, 'no route: ' + method + ' ' + p);
  const asset = findAsset(cp, mA[1]);
  const sub = mA[2] || '';

  if (method === 'PATCH' && sub === '') {
    const body = await readBody(req);
    if (typeof body.title === 'string') asset.title = body.title;
    if (body.scheduledAt === null || body.scheduledAt === '') asset.scheduledAt = null;
    else if (validDate(body.scheduledAt)) asset.scheduledAt = body.scheduledAt;
    else if (body.scheduledAt !== undefined) throw httpError(400, 'scheduledAt 必须是 YYYY-MM-DD');
    cp.updatedAt = nowIso();
    await persist();
    return json(res, 200, { ok: true, asset });
  }

  if (method === 'DELETE' && sub === '') {
    cp.assets = cp.assets.filter((x) => x.id !== asset.id);
    cp.updatedAt = nowIso();
    await persist();
    // 资产删了，列表里那条内容也得跟着消失（否则留一条点不开的孤儿）
    const cdbA = await contentDbSynced();
    if (content.remove(cdbA, 'ct_as_' + asset.id)) await content.save(cdbA);
    return json(res, 200, { ok: true });
  }

  if (method === 'POST' && sub === '/generate') {
    const body = await readBody(req);
    const settings = loadSettings();
    const r = await llm.generate(asset.channel, briefView(cp), settings, { ...(settings.provider || {}), variant: body.variant || 'A' });
    const entry = runAndAttach(cp, asset, r.body, { source: r.source, variant: body.variant || 'A', note: 'generated' });
    await persist();
    return json(res, 200, { ok: true, entry, degraded: r.degraded || null });
  }

  if (method === 'POST' && sub === '/versions') {
    const body = await readBody(req);
    if (typeof body.body !== 'string' || !body.body.trim()) throw httpError(400, '正文不能为空');
    const entry = runAndAttach(cp, asset, body.body, { source: 'manual', variant: body.variant || 'A', note: body.note || '' });
    await persist();
    return json(res, 200, { ok: true, entry });
  }

  if (method === 'POST' && sub === '/approve') {
    const body = await readBody(req);
    const target = asset.versions.find((v) => v.v === Number(body.v)) || currentVersion(asset);
    if (!target) throw httpError(400, '没有可批准的版本');
    target.status = body.approved === false ? 'draft' : 'approved';
    target.approvedAt = target.status === 'approved' ? nowIso() : null;
    cp.updatedAt = nowIso();
    await persist();
    return json(res, 200, { ok: true, entry: target });
  }

  if (method === 'POST' && sub === '/winner') {
    const body = await readBody(req);
    asset.versions.forEach((v) => { v.isWinner = v.v === Number(body.v); });
    cp.updatedAt = nowIso();
    await persist();
    return json(res, 200, { ok: true });
  }

  if (method === 'POST' && sub === '/current') {
    const body = await readBody(req);
    if (!asset.versions.some((v) => v.v === Number(body.v))) throw httpError(400, '版本不存在');
    asset.current = Number(body.v);
    await persist();
    return json(res, 200, { ok: true });
  }

  if (method === 'POST' && sub === '/recheck') {
    const settings = loadSettings();
    asset.versions.forEach((v) => {
      v.checks = runChecks(asset.channel, v.body, briefView(cp), { bannedWords: settings.bannedWords });
    });
    await persist();
    return json(res, 200, { ok: true });
  }

  if (method === 'GET' && sub === '/diff') {
    const a = Number(u.searchParams.get('a'));
    const b = Number(u.searchParams.get('b'));
    const va = asset.versions.find((v) => v.v === a);
    const vb = asset.versions.find((v) => v.v === b);
    if (!va || !vb) throw httpError(404, '版本不存在');
    const d = diffLines(va.body, vb.body);
    return json(res, 200, { ok: true, a, b, diff: d, summary: summarize(d) });
  }

  throw httpError(404, 'no route: ' + method + ' ' + p);
}

const server = http.createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (e) {
    const code = e.status || 500;
    if (code >= 500) console.error('[sca]', e.stack || e.message);
    json(res, code, { ok: false, error: e.message });
  }
});

server.listen(PORT, HOST, () => {
  const s = loadSettings();
  const rp = llm.resolveProvider(s);
  const assetCount = db.campaigns.reduce((n, cp) => n + cp.assets.length, 0);
  console.log(`Social Content Automation  →  http://${HOST}:${PORT}`);
  console.log(`生成模式：${rp.mode}${rp.mode === 'template' ? '（离线模板，不联网）' : ' · ' + rp.model}`);
  console.log(`数据：${db.campaigns.length} 个 campaign / ${assetCount} 个资产　目录：${store.DATA_DIR}`);
});
