'use strict';
/**
 * 模型接入层：支持**多个 provider**，每个 provider 可以有自己的模型清单。
 *
 * 为什么不再用单一 settings.provider：
 *   StoryChief 的 dashboard 顶部是"接入你的 AI"，而真实情况是——公司网关一个地址、
 *   个人账号一个 key、本地 ollama 又是另一套，而且同一个地址后面往往挂十几个模型。
 *   所以数据模型必须是 providers[] + 每个 provider 的 models[] + 一个 active。
 *
 * 两种协议：
 *   anthropic : POST {base}/v1/messages        （x-api-key + anthropic-version）
 *   openai    : POST {base}/v1/chat/completions（Authorization: Bearer）
 *
 * 安全：key 只落在本地 data/providers.json，任何 API 返回都不带原文（只给 hasKey / 后四位）。
 */
const store = require('./store');
const crypto = require('crypto');

const FILE = 'providers.json';
const KINDS = {
  anthropic: { id: 'anthropic', label: 'Anthropic Messages 兼容', path: '/v1/messages' },
  openai: { id: 'openai', label: 'OpenAI Chat Completions 兼容', path: '/v1/chat/completions' }
};

function emptyDb() {
  return { version: 1, active: null, providers: [], calls: 0 };
}

function load() {
  const j = store.readJson(FILE, null);
  if (!j || !Array.isArray(j.providers)) return emptyDb();
  j.version = 1;
  if (!Array.isArray(j.providers)) j.providers = [];
  for (const p of j.providers) {
    if (!p.id) p.id = 'pv_' + crypto.randomBytes(5).toString('hex');
    if (!KINDS[p.kind]) p.kind = 'openai';
    if (!Array.isArray(p.models)) p.models = p.model ? [p.model] : [];
    if (!p.model && p.models.length) p.model = p.models[0];
    p.baseUrl = String(p.baseUrl || '').replace(/\/+$/, '');
  }
  if (typeof j.calls !== 'number') j.calls = 0;
  if (j.active && !j.providers.some((p) => p.id === j.active)) j.active = null;
  return j;
}

function save(db) {
  return store.writeJson(FILE, db);
}

/** 对外视图：绝不返回 apiKey */
function mask(p) {
  return {
    id: p.id,
    name: p.name || '',
    kind: p.kind,
    baseUrl: p.baseUrl || '',
    models: p.models || [],
    model: p.model || (p.models || [])[0] || '',
    hasKey: !!p.apiKey,
    keyHint: p.apiKey ? '…' + String(p.apiKey).slice(-4) : '',
    createdAt: p.createdAt || null,
    lastTestAt: p.lastTestAt || null,
    lastTestOk: p.lastTestOk === undefined ? null : p.lastTestOk,
    lastError: p.lastError || ''
  };
}

function publicDb(db) {
  const d = db || load();
  return {
    active: d.active,
    calls: d.calls || 0,
    providers: d.providers.map(mask),
    kinds: Object.values(KINDS).map((k) => ({ id: k.id, label: k.label }))
  };
}

function getProvider(id) {
  const db = load();
  return db.providers.find((p) => p.id === id) || null;
}

function activeProvider() {
  const db = load();
  if (!db.active) return null;
  return db.providers.find((p) => p.id === db.active) || null;
}

async function httpJson(url, options, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || 60000);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch (_) { body = null; }
    return { ok: res.ok, status: res.status, text, body };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 调一次对话，返回纯文本。
 * cfg: { kind, baseUrl, apiKey, model }
 */
async function chat(cfg, { system, messages, maxTokens, temperature, timeoutMs }) {
  if (!cfg || !cfg.baseUrl) throw new Error('没有配置 baseUrl');
  if (!cfg.model) throw new Error('没有选择模型');
  const kind = KINDS[cfg.kind] ? cfg.kind : 'openai';
  const url = cfg.baseUrl + KINDS[kind].path;
  const msgs = messages && messages.length ? messages : [{ role: 'user', content: '' }];

  let headers;
  let payload;
  if (kind === 'anthropic') {
    headers = {
      'content-type': 'application/json',
      'x-api-key': cfg.apiKey || '',
      authorization: `Bearer ${cfg.apiKey || ''}`,
      'anthropic-version': '2023-06-01'
    };
    payload = {
      model: cfg.model,
      max_tokens: maxTokens || 2000,
      temperature: temperature === undefined ? 0.6 : temperature,
      system: system || '',
      messages: msgs.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }))
    };
  } else {
    headers = { 'content-type': 'application/json' };
    if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`;
    payload = {
      model: cfg.model,
      temperature: temperature === undefined ? 0.6 : temperature,
      max_tokens: maxTokens || 2000,
      messages: [{ role: 'system', content: system || '' }, ...msgs]
    };
  }

  const r = await httpJson(url, { method: 'POST', headers, body: JSON.stringify(payload) }, timeoutMs);
  if (!r.ok) throw new Error(`${kind} ${r.status}: ${(r.text || '').slice(0, 300)}`);

  let out = '';
  if (kind === 'anthropic') {
    out = ((r.body && r.body.content) || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  } else {
    out = (r.body && r.body.choices && r.body.choices[0] && r.body.choices[0].message && r.body.choices[0].message.content) || '';
  }
  out = String(out).trim();
  if (!out) throw new Error(`${kind} 返回空内容`);
  return out;
}

/** 拉模型清单；拉不到就返回空数组（很多网关不实现 /v1/models） */
async function listModels(cfg) {
  if (!cfg || !cfg.baseUrl) throw new Error('没有配置 baseUrl');
  const kind = KINDS[cfg.kind] ? cfg.kind : 'openai';
  const url = cfg.baseUrl + '/v1/models';
  const headers = { 'content-type': 'application/json' };
  if (cfg.apiKey) {
    headers.authorization = `Bearer ${cfg.apiKey}`;
    headers['x-api-key'] = cfg.apiKey;
  }
  const r = await httpJson(url, { method: 'GET', headers }, 20000);
  if (!r.ok) throw new Error(`${kind} ${r.status}: ${(r.text || '').slice(0, 200)}`);
  const raw = (r.body && (r.body.data || r.body.models)) || [];
  const ids = raw.map((m) => m && (m.id || m.name)).filter(Boolean);
  return [...new Set(ids)].sort();
}

/** 连通性测试：发一个极小的请求 */
async function testProvider(cfg) {
  const t0 = Date.now();
  const reply = await chat(cfg, {
    system: 'You are a connectivity probe. Reply with the single word: pong',
    messages: [{ role: 'user', content: 'ping' }],
    maxTokens: 16,
    temperature: 0,
    timeoutMs: 25000
  });
  return { ok: true, ms: Date.now() - t0, reply: reply.slice(0, 40) };
}

function countCall() {
  const db = load();
  db.calls = (db.calls || 0) + 1;
  save(db);
}

module.exports = { load, save, publicDb, mask, getProvider, activeProvider, chat, listModels, testProvider, countCall, KINDS };
