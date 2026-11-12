'use strict';
/**
 * Buffer 适配层（对标 StoryChief 的「先连 Buffer、再从 Buffer 里挑渠道」）
 * =====================================================================
 * 事实依据：developers.buffer.com（2026-11 查的官方文档），不是猜的。
 *
 *   1. **Buffer 现在是 GraphQL**，不是老的 REST：POST https://api.buffer.com，
 *      header `Authorization: Bearer <token>`，body `{query, variables}`。
 *   2. **认证两条路**：
 *      - OAuth 2.0 + PKCE：授权 `https://auth.buffer.com/auth`，换 token `https://auth.buffer.com/token`。
 *        ⚠️ 前提是**你得先注册一个 Buffer OAuth client**（publish.buffer.com/settings/api），
 *        拿到 client_id 并把回调地址登记进去。没有它，这条链根本发不出去。
 *      - Personal API Key：publish.buffer.com/settings/api 直接生成，30 秒可用。
 *      → 所以这里实现「两种都做、自动降级」：配了 client_id 走 OAuth，没配就走粘 Key。
 *   3. **一次只能发一个渠道**：mutation `createPost(input:{text, channelId, schedulingType, mode, dueAt, assets})`。
 *      想发多个渠道 = 循环调 N 次。上层接口仍然收 `channelIds[]`，由这里 fan-out，
 *      并逐个渠道返回成功/失败（不搞「整批失败」那种糊弄）。
 *   4. **附件必须是公网可达的 https 直链**（官方 Hosting Media 明确写了：拉不到 URL 整条 mutation 失败）。
 *      本机 127.0.0.1 上的图 Buffer 永远抓不到 —— 这一点必须如实告诉用户，不能假装能发图。
 *   5. `mode` 的枚举按文档：`addToQueue`（排队）/ `customScheduled`（指定时间）/ `shareNow`（立即）。
 *
 * 未验证的地方（写在代码里，别当已实现）：
 *   - OAuth 的 scope 名称：文档示例没给，所以默认**不传 scope**，需要时用 BUFFER_SCOPE 覆盖。
 *   - `organizations` 查询的确切形状：文档只给了 channels 需要 organizationId，
 *     所以这里按三个候选形状依次试（account.organizations / organizations / viewer.organizations）。
 *   - 查单条 post 状态的 query 形状：同样未给示例 → 失败时**如实返回本地记录 + verified:false**，
 *     绝不编一个「已发布」。
 */
const crypto = require('crypto');
const store = require('./store');

const TOKENS_FILE = 'buffer-tokens.json';
const PKCE_FILE = 'buffer-pkce.json';
const POSTS_FILE = 'buffer-posts.json';
const CHANNELS_TTL = 5 * 60 * 1000;

function cfg() {
  const env = process.env;
  return {
    clientId: env.BUFFER_CLIENT_ID || '',
    clientSecret: env.BUFFER_CLIENT_SECRET || '',
    apiKey: env.BUFFER_API_KEY || '',
    apiBase: (env.BUFFER_API_BASE || 'https://api.buffer.com').replace(/\/+$/, ''),
    authBase: (env.BUFFER_AUTH_BASE || 'https://auth.buffer.com').replace(/\/+$/, ''),
    publicBase: (env.BUFFER_PUBLIC_BASE || env.SCA_PUBLIC_BASE || '').replace(/\/+$/, ''),
    scope: env.BUFFER_SCOPE || '',
    timeout: Number(env.BUFFER_TIMEOUT_MS || 20000)
  };
}

/* ---------------- 错误 ---------------- */

class BufferError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.code = code;
    this.detail = detail || null;
  }
}

/** 把平台返回的英文报错翻译成「看得懂的一句话」；翻不了就原样透出，绝不吞掉 */
function friendlyError(raw) {
  const m = String(raw || '');
  const low = m.toLowerCase();
  if (/invalid_grant|token.*(expired|revoked|invalid)|unauthor/.test(low)) return 'Buffer 授权已失效，需要重新连接（Reconnect Buffer）';
  if (/permission|scope|forbidden|403/.test(low)) return 'Buffer 说没有权限做这件事（可能是 API key / 授权的 scope 不够）';
  if (/rate.?limit|429|too many/.test(low)) return '触发了 Buffer 的限流，等一会儿再试';
  if (/image|video|media|dimension|mime|asset/.test(low)) return '媒体文件不被这个平台接受（格式/尺寸/大小），或者 URL 不是公网直链：' + m;
  if (/not found|404/.test(low)) return 'Buffer 里找不到这个渠道（可能在 Buffer 后台被解绑了）';
  if (/character|too long|length/.test(low)) return '文案超过这个平台的字符上限：' + m;
  if (/paused|queue/.test(low)) return '这个渠道的 Buffer 队列被暂停了：' + m;
  return m || 'Buffer 返回了空错误';
}

/* ---------------- 凭据存储 ---------------- */

/**
 * ⚠️ 必须有一层内存副本：store.writeJson 是**排队异步**的（lib/store.js 的写队列），
 * 写完立刻 readJson 很可能读到旧文件 —— 那会让「刚存了 API key 就马上调接口」这一步
 * 直接报「还没连接 Buffer」。这里 mem 先改、再异步落盘，读永远看到最新的一份。
 * 单进程独占这个文件（多进程同时连 Buffer 不在支持范围）。
 */
let MEM = null;

function readTokens() {
  if (MEM) return MEM;
  MEM = store.readJson(TOKENS_FILE, {}) || {};
  return MEM;
}

function saveTokens(patch) {
  const next = Object.assign({}, readTokens(), patch || {});
  next.updatedAt = new Date().toISOString();
  MEM = next;
  store.writeJson(TOKENS_FILE, next);
  return next;
}

function clearTokens() {
  MEM = {};
  store.writeJson(TOKENS_FILE, {});
}

/** 只给测试用：丢掉内存副本，下次从磁盘重读 */
function __resetCache() { MEM = null; }

function maskKey(k) {
  const s = String(k || '');
  if (s.length <= 8) return s ? '••••' : '';
  return s.slice(0, 4) + '••••' + s.slice(-4);
}

function isLocalhost(url) {
  return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\]|0\.0\.0\.0)(:|\/|$)/i.test(String(url || ''));
}

/** 当前用哪种方式连的 Buffer */
function mode() {
  const t = readTokens();
  if (t.api_key) return 'apikey';
  if (t.access_token) return 'oauth';
  if (cfg().apiKey) return 'apikey-env';
  return 'none';
}

function redirectUri() {
  const base = cfg().publicBase || 'http://127.0.0.1:' + (process.env.PORT || 4319);
  return base + '/api/buffer/callback';
}

function tokenExpired(t) {
  t = t || readTokens();
  if (!t.access_token) return false;
  if (!t.expires_at) return false;
  return Date.now() >= Number(t.expires_at) - 60 * 1000;
}

function status() {
  const t = readTokens();
  const c = cfg();
  const md = mode();
  const connected = md !== 'none';
  return {
    mode: md,
    connected,
    canOauth: !!c.clientId,
    canApikey: true,
    expired: md === 'oauth' ? tokenExpired(t) : false,
    expiresAt: t.expires_at || null,
    keyMasked: t.api_key ? maskKey(t.api_key) : '',
    org: t.org || null,
    channelsAt: t.channels_at || null,
    channelsCount: Array.isArray(t.channels) ? t.channels.length : 0,
    redirectUri: redirectUri(),
    publicBase: c.publicBase || '',
    mediaPublic: !!c.publicBase && !isLocalhost(c.publicBase),
    why: connected
      ? ''
      : c.clientId
        ? '还没连 Buffer：点 Connect Buffer 走 OAuth 授权，或者直接粘一个 Personal API Key'
        : '还没连 Buffer，而且服务端没配 BUFFER_CLIENT_ID（所以 OAuth 那条路用不了）：先粘一个 Personal API Key，或去 publish.buffer.com/settings/api 建一个 OAuth client'
  };
}

/* ---------------- OAuth（Authorization Code + PKCE） ---------------- */

function pkcePair() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/**
 * 生成授权链接。返回 {ok:false, need:'client_id'} 而不是抛错 ——
 * 前端据此显示「怎么配」，比一个 500 有用。
 */
function authUrl() {
  const c = cfg();
  if (!c.clientId) {
    return {
      ok: false,
      need: 'client_id',
      why: '服务端没有 BUFFER_CLIENT_ID。去 publish.buffer.com/settings/api 建一个 OAuth client，把 client_id / client_secret 写进 .env 再重启服务。',
      docs: 'https://developers.buffer.com/guides/building-apps.html'
    };
  }
  const { verifier, challenge } = pkcePair();
  const state = crypto.randomBytes(16).toString('hex');
  store.writeJson(PKCE_FILE, { state, verifier, at: Date.now() });
  const u = new URL(c.authBase + '/auth');
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', c.clientId);
  u.searchParams.set('redirect_uri', redirectUri());
  u.searchParams.set('state', state);
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  if (c.scope) u.searchParams.set('scope', c.scope);
  return { ok: true, url: u.toString(), state };
}

async function postForm(url, params) {
  const body = new URLSearchParams(params).toString();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg().timeout);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body,
      signal: ctrl.signal
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
    if (!res.ok) {
      const msg = (data && (data.error_description || data.error || data.message)) || text || ('HTTP ' + res.status);
      throw new BufferError('oauth_http_' + res.status, friendlyError(msg), { status: res.status, body: text.slice(0, 400) });
    }
    if (!data) throw new BufferError('oauth_bad_body', 'Buffer 的 token 接口返回了非 JSON：' + text.slice(0, 200));
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function storeTokenResponse(data) {
  const patch = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || null,
    token_type: data.token_type || 'Bearer',
    expires_at: data.expires_in ? Date.now() + Number(data.expires_in) * 1000 : null,
    api_key: null
  };
  // ⚠️ refresh_token 是**一次性**的：每次刷新都会换新的，旧的再用会让整条授权失效。
  // 所以这里永远整份覆盖，绝不「保留旧值」。
  return saveTokens(patch);
}

async function exchangeCode(code, state) {
  const c = cfg();
  if (!c.clientId) throw new BufferError('need_client_id', '服务端没配 BUFFER_CLIENT_ID，换不了 token');
  const pk = store.readJson(PKCE_FILE, {}) || {};
  if (!pk.state || pk.state !== state) {
    throw new BufferError('bad_state', 'OAuth state 对不上（可能是过期的回调或跨站请求），请重新点 Connect Buffer');
  }
  if (Date.now() - Number(pk.at || 0) > 10 * 60 * 1000) {
    throw new BufferError('pkce_expired', 'OAuth 授权超时（超过 10 分钟），请重新点 Connect Buffer');
  }
  const params = {
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(),
    client_id: c.clientId,
    code_verifier: pk.verifier
  };
  if (c.clientSecret) params.client_secret = c.clientSecret;
  const data = await postForm(c.authBase + '/token', params);
  store.writeJson(PKCE_FILE, {}); // 用完即焚
  const t = storeTokenResponse(data);
  saveTokens({ channels: null, channels_at: null, org: null, connectedAt: new Date().toISOString() });
  return t;
}

async function refresh() {
  const c = cfg();
  const t = readTokens();
  if (!t.refresh_token) {
    throw new BufferError('no_refresh', '没有 refresh_token 了，只能重新连接 Buffer');
  }
  const params = {
    grant_type: 'refresh_token',
    refresh_token: t.refresh_token,
    client_id: c.clientId || ''
  };
  if (c.clientSecret) params.client_secret = c.clientSecret;
  const data = await postForm(c.authBase + '/token', params);
  return storeTokenResponse(data);
}

/** 拿到一个可用的 bearer token（api key 模式直接返回，OAuth 模式过期就自动刷） */
async function accessToken() {
  const t = readTokens();
  if (t.api_key) return t.api_key;
  if (cfg().apiKey && !t.access_token) return cfg().apiKey;
  if (t.access_token && !tokenExpired(t)) return t.access_token;
  if (t.refresh_token) {
    const nt = await refresh();
    return nt.access_token;
  }
  throw new BufferError('not_connected', '还没连接 Buffer');
}

/* ---------------- GraphQL ---------------- */

async function gql(query, variables) {
  const token = await accessToken();
  const c = cfg();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), c.timeout);
  try {
    const res = await fetch(c.apiBase, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token, accept: 'application/json' },
      body: JSON.stringify(variables ? { query, variables } : { query }),
      signal: ctrl.signal
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
    if (!res.ok) {
      const msg = (data && (data.message || (data.errors && data.errors[0] && data.errors[0].message))) || text || ('HTTP ' + res.status);
      throw new BufferError('http_' + res.status, friendlyError(msg), { status: res.status, body: String(text).slice(0, 400) });
    }
    if (!data) throw new BufferError('bad_body', 'Buffer 返回了非 JSON：' + String(text).slice(0, 200));
    if (Array.isArray(data.errors) && data.errors.length) {
      throw new BufferError('graphql', friendlyError(data.errors[0].message), { errors: data.errors });
    }
    return data.data;
  } finally {
    clearTimeout(timer);
  }
}

const ORG_QUERIES = [
  { q: 'query OrgAccount { account { organizations { id name } } }', pick: (d) => d && d.account && d.account.organizations },
  { q: 'query OrgList { organizations { id name } }', pick: (d) => d && d.organizations },
  { q: 'query OrgViewer { viewer { organizations { id name } } }', pick: (d) => d && d.viewer && d.viewer.organizations }
];

async function organization(force) {
  if (mode() === 'none') throw new BufferError('not_connected', '还没连接 Buffer');
  const t = readTokens();
  if (!force && t.org && t.org.id) return t.org;
  const tried = [];
  for (const item of ORG_QUERIES) {
    try {
      const d = await gql(item.q);
      const list = item.pick(d) || [];
      if (list.length) {
        saveTokens({ org: list[0], orgs: list.slice(0, 20) });
        return list[0];
      }
      tried.push(item.q.slice(0, 30) + ' → 空');
    } catch (e) {
      if (e.code === 'not_connected') throw e;   // 没连就别表演「取不到 organization」
      tried.push(item.q.slice(0, 30) + ' → ' + e.message);
    }
  }
  throw new BufferError('no_organization', '取不到 Buffer 的 organization。可能是 API key 权限不够，或组织还没建。试过的查询：' + tried.join(' | '));
}

const CHANNELS_QUERY =
  'query Channels($organizationId: String!) { channels(input: { organizationId: $organizationId }) { id name displayName service avatar isQueuePaused } }';

/** 渠道排序：先按规格里的固定顺序，再按名字，保证每次刷新顺序稳定 */
function sortChannels(list, rankOf) {
  const rank = typeof rankOf === 'function' ? rankOf : () => 99;
  return (list || []).slice().sort((a, b) => {
    const ra = rank(a.key || '');
    const rb = rank(b.key || '');
    if (ra !== rb) return ra - rb;
    return String(a.displayName || a.name || '').localeCompare(String(b.displayName || b.name || ''));
  });
}

async function channels(opts) {
  opts = opts || {};
  if (mode() === 'none') throw new BufferError('not_connected', '还没连接 Buffer');
  const t = readTokens();
  const fresh = t.channels_at && Date.now() - Number(t.channels_at) < CHANNELS_TTL;
  if (!opts.refresh && fresh && Array.isArray(t.channels)) {
    return { channels: t.channels, cached: true, at: t.channels_at };
  }
  const org = await organization();
  let d;
  try {
    d = await gql(CHANNELS_QUERY, { organizationId: org.id });
  } catch (e) {
    // 少数账号的 input 类型可能是 ID 而不是 String —— 退一步重试，不硬失败
    d = await gql('query ChannelsInline { channels(input: { organizationId: "' + String(org.id).replace(/"/g, '') + '" }) { id name displayName service avatar isQueuePaused } }');
  }
  const raw = (d && d.channels) || [];
  const list = raw.map((c) => ({
    id: c.id,
    name: c.name || '',
    displayName: c.displayName || c.name || '',
    service: c.service || '',
    avatar: c.avatar || '',
    isQueuePaused: !!c.isQueuePaused
  }));
  saveTokens({ channels: list, channels_at: Date.now(), org });
  return { channels: list, cached: false, at: Date.now() };
}

/* ---------------- 发帖 ---------------- */

/** 拼一条 createPost 的 input（纯函数，单测直接调） */
function buildPostInput(opts) {
  const o = opts || {};
  const input = {
    text: String(o.text || ''),
    channelId: String(o.channelId || ''),
    schedulingType: 'automatic'
  };
  if (o.scheduleAt) {
    input.mode = 'customScheduled';
    input.dueAt = o.scheduleAt;
  } else {
    input.mode = o.mode || 'shareNow';
  }
  const url = String(o.mediaUrl || '');
  if (url) {
    // Buffer 的 assets 是有序列表，每一项只能是 image / video / document 之一。
    // 图片和视频都用 image 入口（Buffer 会自己按 mime 处理），PDF 走 document。
    const kind = o.mediaKind === 'document' ? 'document' : 'image';
    input.assets = [{ [kind]: { url } }];
  }
  return input;
}

const CREATE_POST_MUTATION = [
  'mutation CreatePost($input: PostInput!) {',
  '  createPost(input: $input) {',
  '    ... on PostActionSuccess { post { id text } }',
  '    ... on MutationError { message }',
  '  }',
  '}'
].join('\n');

function validateCreate(p) {
  p = p || {};
  const ids = Array.isArray(p.channelIds) ? p.channelIds.filter(Boolean) : [];
  if (!ids.length) return { ok: false, why: '没有勾选任何渠道，Publish 按钮应该是灰的' };
  const main = String(p.mainContent || '').trim();
  const per = p.channelCustomContent && typeof p.channelCustomContent === 'object' ? p.channelCustomContent : {};
  const emptyEverywhere = !main && ids.every((id) => !String((per[id] || {}).content || '').trim());
  if (emptyEverywhere) return { ok: false, why: '文案是空的，Buffer 会拒绝' };
  if (p.scheduleAt) {
    const ts = Date.parse(p.scheduleAt);
    if (!Number.isFinite(ts)) return { ok: false, why: '定时时间不是合法的 ISO 时间（要用 UTC，例如 2026-11-20T09:00:00Z）' };
    if (ts < Date.now() - 60 * 1000) return { ok: false, why: '定时时间已经过去了' };
  }
  const url = String(p.mediaUrl || '');
  if (url && !/^https:\/\//i.test(url)) {
    return { ok: false, why: '附件必须是公网 https 直链（Buffer 会自己去抓这个 URL；http / 本地地址都抓不到）' };
  }
  return { ok: true, channelIds: ids };
}

async function createPost(payload) {
  const p = payload || {};
  const v = validateCreate(p);
  if (!v.ok) throw new BufferError('invalid', v.why);
  const per = p.channelCustomContent || {};
  const main = String(p.mainContent || '');
  const results = [];
  for (const channelId of v.channelIds) {
    const own = per[channelId] || {};
    const text = String(own.content || '').trim() ? String(own.content) : main;
    const mediaUrl = String(own.mediaUrl || '').trim() || String(p.mediaUrl || '');
    const input = buildPostInput({ text, channelId, mediaUrl, mediaKind: p.mediaKind, scheduleAt: p.scheduleAt || null });
    try {
      const d = await gql(CREATE_POST_MUTATION, { input });
      const node = d && d.createPost;
      if (node && node.message) {
        results.push({ channelId, ok: false, error: friendlyError(node.message) });
        continue;
      }
      const post = (node && node.post) || {};
      results.push({ channelId, ok: true, postId: post.id || '', text: post.text || text });
    } catch (e) {
      results.push({ channelId, ok: false, error: friendlyError(e.message), code: e.code || 'error' });
    }
  }
  const okCount = results.filter((r) => r.ok).length;
  const rec = {
    id: 'bp_' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex'),
    at: new Date().toISOString(),
    contentId: p.contentId || null,
    scheduleAt: p.scheduleAt || null,
    text: main,
    mediaUrl: p.mediaUrl || '',
    results
  };
  const prev = store.readJson(POSTS_FILE, { items: [] }) || { items: [] };
  const items = [rec].concat(Array.isArray(prev.items) ? prev.items : []).slice(0, 200);
  store.writeJson(POSTS_FILE, { items });
  return {
    ok: okCount === results.length && okCount > 0,
    batchId: rec.id,
    scheduleAt: p.scheduleAt || null,
    total: results.length,
    okCount,
    failCount: results.length - okCount,
    results,
    note:
      okCount === results.length
        ? 'Buffer 已接单，发布由 Buffer 执行（本地工具不直连平台）'
        : '有渠道提交失败，失败原因原样透出（见每一项的 error）'
  };
}

/** 单条状态：先给本地记录，再尽力向 Buffer 核一次；核不到就明说 verified:false */
async function postStatus(postId) {
  const prev = store.readJson(POSTS_FILE, { items: [] }) || { items: [] };
  const items = Array.isArray(prev.items) ? prev.items : [];
  let local = null;
  for (const batch of items) {
    const hit = (batch.results || []).find((r) => r.postId === postId || r.channelId === postId);
    if (hit) { local = { batch: { id: batch.id, at: batch.at, scheduleAt: batch.scheduleAt }, hit }; break; }
  }
  let verified = false;
  let remote = null;
  let why = '';
  try {
    const d = await gql(
      'query PostOne($id: String!) { post(input: { id: $id }) { id status sentAt text } }',
      { id: postId }
    );
    remote = (d && d.post) || null;
    verified = !!remote;
  } catch (e) {
    why = '查单条状态的 query 形状官方没给示例，这次没查到：' + e.message;
  }
  return { ok: true, postId, local, remote, verified, why };
}

/* ---------------- 连接管理 ---------------- */

async function setApiKey(key) {
  const k = String(key || '').trim();
  if (!k) throw new BufferError('empty_key', 'API key 是空的');
  if (k.length < 16) throw new BufferError('bad_key', '看起来不像 Buffer 的 API key（太短了）');
  saveTokens({ api_key: k, access_token: null, refresh_token: null, expires_at: null, org: null, channels: null, channels_at: null });
  try {
    const org = await organization(true);
    await channels({ refresh: true });
    return { ok: true, org };
  } catch (e) {
    clearTokens(); // 验不过就不留一个假的「已连接」
    throw new BufferError('key_rejected', '这个 API key 用不了：' + friendlyError(e.message));
  }
}

function disconnect() {
  clearTokens();
  return { ok: true, mode: 'none' };
}

module.exports = {
  BufferError,
  cfg,
  status,
  mode,
  authUrl,
  exchangeCode,
  refresh,
  accessToken,
  gql,
  organization,
  channels,
  sortChannels,
  buildPostInput,
  validateCreate,
  createPost,
  postStatus,
  setApiKey,
  disconnect,
  friendlyError,
  maskKey,
  isLocalhost,
  redirectUri,
  tokenExpired,
  __resetCache,
  FILES: { TOKENS_FILE, PKCE_FILE, POSTS_FILE }
};
