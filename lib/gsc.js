'use strict';
/**
 * Google Search Console 真实接入（OAuth 2.0 + Search Analytics）。
 *
 * 为什么这样做：你不能用"我的"凭据去读"你的"站点数据 —— Google 的授权是发给
 * 具体一个 OAuth 客户端 + 具体一个 Google 账号的。所以本地版让你填**自己的**
 * Google Cloud 凭据（Client ID / Secret），走标准授权码流程：
 *
 *   1. 你在 Google Cloud 建一个 OAuth 客户端（类型：Web 应用），
 *      把 http://127.0.0.1:4319/api/gsc/callback 加进"已获授权的重定向 URI"
 *   2. 在本页面填 Client ID / Secret → 点「用 Google 授权」
 *   3. 浏览器跳到 Google → 同意 → 回调 → 换 token → 拉站点列表
 *   4. 「同步最近 28 天」→ 调 Search Analytics API → 写进 knowledge.gsc.raw
 *      （之后 Content audit 的分析逻辑完全不变，它只吃这张表）
 *
 * 凭据只存在本机 data/gsc.json，明文（和 provider 的 key 一样，本地工具，不上传）。
 * 没验证过真连：这台机器没有你的 Google Cloud 凭据，失败路径已覆盖。
 */
const crypto = require('crypto');
const store = require('./store');

const FILE = 'gsc.json';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SITES_URL = 'https://www.googleapis.com/webmasters/v3/sites';
const QUERY_URL = (site) => `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`;
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const TIMEOUT_MS = 15000;

function emptyDb() {
  return {
    version: 1,
    clientId: '',
    clientSecret: '',
    state: '',
    token: { access_token: '', refresh_token: '', expiresAt: 0, scope: '', token_type: '' },
    account: '',
    sites: [],
    site: '',
    lastSync: null,
    lastError: null,
    source: ''
  };
}

function load() {
  const j = store.readJson(FILE, null);
  if (!j) return emptyDb();
  const db = { ...emptyDb(), ...j };
  db.token = { ...emptyDb().token, ...(j.token || {}) };
  db.sites = Array.isArray(j.sites) ? j.sites : [];
  return db;
}

function save(db) {
  return store.writeJson(FILE, db);
}

function redirectUri(port) {
  return `http://127.0.0.1:${port || 4319}/api/gsc/callback`;
}

const mask = (s) => (s ? '••••' + String(s).slice(-4) : '');

function publicView(db, port) {
  const d = db || load();
  return {
    configured: !!(d.clientId && d.clientSecret),
    authorized: !!(d.token && (d.token.refresh_token || d.token.access_token)),
    clientIdTail: mask(d.clientId),
    hasSecret: !!d.clientSecret,
    redirectUri: redirectUri(port),
    account: d.account || '',
    sites: d.sites || [],
    site: d.site || '',
    lastSync: d.lastSync || null,
    lastError: d.lastError || null,
    expiresAt: d.token && d.token.expiresAt ? new Date(d.token.expiresAt).toISOString() : null,
    source: d.source || ''
  };
}

function setCredentials(db, { clientId, clientSecret }) {
  const id = String(clientId || '').trim();
  const sec = String(clientSecret || '').trim();
  if (!id || !sec) throw Object.assign(new Error('Client ID 和 Client Secret 都要填'), { status: 400 });
  if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(id)) {
    throw Object.assign(new Error('Client ID 应该形如 1234567890-abc.apps.googleusercontent.com'), { status: 400 });
  }
  db.clientId = id;
  db.clientSecret = sec;
  db.lastError = null;
  return db;
}

function authUrl(db, port) {
  if (!db.clientId || !db.clientSecret) {
    throw Object.assign(new Error('先在设置里填 Client ID / Client Secret'), { status: 400 });
  }
  const state = crypto.randomBytes(12).toString('hex');
  db.state = state;
  const q = new URLSearchParams({
    client_id: db.clientId,
    redirect_uri: redirectUri(port),
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent',
    state
  });
  return AUTH_URL + '?' + q.toString();
}

async function httpJson(url, opt, label) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...opt, signal: ctl.signal });
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch (_) { body = { raw: text.slice(0, 500) }; }
    if (!res.ok) {
      const msg = (body && (body.error_description || (body.error && body.error.message) || body.error)) || res.status;
      throw new Error(`${label} 失败（HTTP ${res.status}）：${String(msg).slice(0, 300)}`);
    }
    return body || {};
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`${label} 超时（${TIMEOUT_MS / 1000}s）`);
    const code = String((e.cause && (e.cause.code || e.cause.message)) || e.code || '');
    if (/CONNECT_TIMEOUT|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|EPROTO/i.test(code)) {
      throw new Error(`${label} 连不上 Google（${code}）。这台机器到 googleapis.com 出不去 —— 换台能上外网的机器跑，或者先用「粘贴 Search Console 导出」那条路。`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function exchangeCode(db, code, port) {
  if (!db.clientId || !db.clientSecret) throw Object.assign(new Error('缺 Client ID / Secret'), { status: 400 });
  const body = new URLSearchParams({
    code: String(code),
    client_id: db.clientId,
    client_secret: db.clientSecret,
    redirect_uri: redirectUri(port),
    grant_type: 'authorization_code'
  });
  const out = await httpJson(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  }, '用授权码换 token');
  applyToken(db, out);
  db.lastError = null;
  return out;
}

function applyToken(db, out) {
  db.token = {
    access_token: out.access_token || '',
    refresh_token: out.refresh_token || (db.token && db.token.refresh_token) || '',
    expiresAt: Date.now() + (Number(out.expires_in || 3600) - 60) * 1000,
    scope: out.scope || SCOPE,
    token_type: out.token_type || 'Bearer'
  };
}

/** 有 refresh_token 就静默续期；没有就报"重新授权" */
async function ensureToken(db) {
  if (db.token && db.token.access_token && db.token.expiresAt > Date.now()) return db.token.access_token;
  if (!db.token || !db.token.refresh_token) {
    throw Object.assign(new Error('还没有授权，或授权已失效：点「用 Google 授权」重新来一次'), { status: 401 });
  }
  const body = new URLSearchParams({
    client_id: db.clientId,
    client_secret: db.clientSecret,
    refresh_token: db.token.refresh_token,
    grant_type: 'refresh_token'
  });
  const out = await httpJson(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  }, '刷新 token');
  applyToken(db, out);
  return db.token.access_token;
}

async function listSites(db) {
  const token = await ensureToken(db);
  const out = await httpJson(SITES_URL, { headers: { authorization: 'Bearer ' + token } }, '拉站点列表');
  const sites = (out.siteEntry || []).map((s) => ({
    siteUrl: String(s.siteUrl || ''),
    permission: String(s.permissionLevel || '')
  })).filter((s) => s.siteUrl);
  db.sites = sites;
  if (!db.site && sites.length) db.site = sites[0].siteUrl;
  return sites;
}

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

/** 拉最近 N 天的搜索词，直接产出 audit 能吃的 TSV */
async function sync(db, { days } = {}) {
  const site = db.site;
  if (!site) throw Object.assign(new Error('先选一个站点'), { status: 400 });
  const token = await ensureToken(db);
  const span = Math.min(Math.max(Number(days) || 28, 1), 480);
  const body = {
    startDate: isoDaysAgo(span),
    endDate: isoDaysAgo(1),
    dimensions: ['query'],
    rowLimit: 500,
    dataState: 'final'
  };
  const out = await httpJson(QUERY_URL(site), {
    method: 'POST',
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: JSON.stringify(body)
  }, '拉搜索数据');
  const rows = (out.rows || []).map((r) => ({
    query: String((r.keys && r.keys[0]) || ''),
    clicks: Math.round(r.clicks || 0),
    impressions: Math.round(r.impressions || 0),
    ctr: Math.round((r.ctr || 0) * 10000) / 10000,
    position: Math.round((r.position || 0) * 10) / 10
  })).filter((r) => r.query);
  db.lastSync = new Date().toISOString();
  db.source = 'gsc-api';
  db.lastError = null;
  return { rows, span, startDate: body.startDate, endDate: body.endDate };
}

/** rows → TSV（和 Search Console 导出同构，audit.parseGsc 直接认） */
function rowsToTsv(rows) {
  const head = 'Top queries\tClicks\tImpressions\tCTR\tPosition';
  const lines = rows.map((r) => [r.query, r.clicks, r.impressions, (r.ctr * 100).toFixed(2) + '%', r.position].join('\t'));
  return [head, ...lines].join('\n');
}

/** 断开 = 清掉凭据 + token + 站点选择；已经同步进 knowledge.gsc.raw 的数据保留 */
function disconnect(db) {
  const empty = emptyDb();
  db.token = empty.token;
  db.clientId = '';
  db.clientSecret = '';
  db.state = '';
  db.account = '';
  db.sites = [];
  db.site = '';
  db.lastSync = null;
  db.source = '';
  db.lastError = null;
  return db;
}

module.exports = {
  load, save, publicView, setCredentials, authUrl, exchangeCode, ensureToken,
  listSites, sync, rowsToTsv, disconnect, redirectUri, SCOPE, emptyDb
};
