'use strict';
/**
 * Buffer API 的本地替身（只实现这个项目用到的那几条 GraphQL）。
 *
 * 为什么需要它：Buffer 的 API 要真凭据，而验收必须能反复跑、且不能把用户的真 token
 * 写进 data/。所以单测和交互测试都打这个替身 —— 走的是**同一条 HTTP 代码路径**
 * （lib/buffer.js 只换 base URL），不是把 buffer 模块 mock 掉。
 *
 * 替身的行为都是「照官方文档的形状」写的：
 *   query { account { organizations { id name } } }
 *   query { channels(input:{organizationId}) { id name displayName service avatar isQueuePaused } }
 *   mutation { createPost(input:{...}) { ... on PostActionSuccess { post { id text } } ... on MutationError { message } } }
 *   query { post(input:{id}) { id status sentAt text } }
 */
const http = require('http');

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

function startStub(opts) {
  const o = opts || {};
  const channels = o.channels || [
    { id: 'ch_fb_1', name: 'acme', displayName: 'Acme on Facebook', service: 'facebook', avatar: '', isQueuePaused: false },
    { id: 'ch_x_1', name: 'acme', displayName: 'Acme @acmeco', service: 'twitter', avatar: '', isQueuePaused: false },
    { id: 'ch_li_1', name: 'acme', displayName: 'Acme on LinkedIn', service: 'linkedin', avatar: '', isQueuePaused: false },
    { id: 'ch_ig_1', name: 'acme', displayName: 'Acme on Instagram', service: 'instagram', avatar: '', isQueuePaused: false }
  ];

  const state = {
    calls: [],              // 每次 createPost 的 input，用来断言 fan-out 与分渠道文案
    channelQueries: 0,
    failFor: [],            // 这些 channelId 返回 MutationError
    failMessage: 'Channel is not allowed to post: permission denied',
    postStatusOk: o.postStatusOk !== false,
    tokenSeen: [],
    channelList: channels
  };

  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/__state') return json(res, 200, state);
    if (req.method === 'POST' && req.url === '/__fail') {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        try {
          const b = JSON.parse(raw || '{}');
          state.failFor = Array.isArray(b.failFor) ? b.failFor : [];
          state.failMessage = b.failMessage || state.failMessage;
          state.postStatusOk = b.postStatusOk !== false;
        } catch (e) { /* ignore */ }
        json(res, 200, { ok: true, failFor: state.failFor });
      });
      return;
    }
    if (req.method !== 'POST') return json(res, 404, { error: 'only POST' });

    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      state.tokenSeen.push(String(req.headers.authorization || ''));
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch (e) { return json(res, 400, { errors: [{ message: 'bad json' }] }); }
      const q = String(body.query || '');
      const v = body.variables || {};

      if (/\borganizations\b/.test(q)) {
        return json(res, 200, { data: { account: { organizations: [{ id: 'org_test', name: 'Test Org' }] } } });
      }
      if (/\bchannels\b/.test(q)) {
        state.channelQueries += 1;
        // 变量写法（推荐）和字符串内联写法都要支持 —— 服务端两种都会用到
        if (!("organizationId" in v) && !/organizationId\s*:\s*"/.test(q)) {
          return json(res, 200, { errors: [{ message: 'organizationId is required' }] });
        }
        return json(res, 200, { data: { channels: state.channelList } });
      }
      if (/\bcreatePost\b/.test(q)) {
        const input = v.input || {};
        state.calls.push(input);
        if (state.failFor.includes(input.channelId)) {
          return json(res, 200, { data: { createPost: { message: state.failMessage } } });
        }
        return json(res, 200, { data: { createPost: { post: { id: 'post_' + input.channelId, text: input.text } } } });
      }
      if (/\bpost\b/.test(q) && /\bstatus\b/.test(q)) {
        if (!state.postStatusOk) return json(res, 200, { errors: [{ message: 'Cannot query field "post" on type "Query"' }] });
        return json(res, 200, { data: { post: { id: v.id, status: 'sent', sentAt: '2026-01-01T00:00:00Z', text: 'x' } } });
      }
      return json(res, 200, { errors: [{ message: 'Unknown query: ' + q.slice(0, 60) }] });
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        server,
        port,
        base: 'http://127.0.0.1:' + port,
        state,
        stop: () => new Promise((r) => server.close(r))
      });
    });
  });
}

module.exports = { startStub };
