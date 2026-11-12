'use strict';
/**
 * Social post composer 单测（不碰网络：Buffer 由 tests/stub-buffer.js 顶替）
 *
 * 覆盖三件事：
 *   1. 拼请求体的纯函数（mode / dueAt / assets / document）
 *   2. 发布前校验（没渠道、空文案、时间非法、附件不是 https）
 *   3. 跟 Buffer 的整条链路：连上 → 拉渠道 → 逐个渠道发布 → 查状态，
 *      以及**部分渠道失败**时必须如实报（不能整批算成功）
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

/* ⚠️ 必须在 require lib/* 之前设好：store 在模块加载时就算 DATA_DIR */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sca-social-'));
process.env.SCA_DATA_DIR = TMP;

const { startStub } = require('./stub-buffer');

let pass = 0;
const fails = [];
function ok(cond, label, detail) {
  if (cond) { pass += 1; console.log('  ok  ' + label + (detail ? '  → ' + detail : '')); }
  else { fails.push(label + (detail ? ' → ' + detail : '')); console.log('  ✗   ' + label + (detail ? '  → ' + detail : '')); }
}
function eq(a, b, label) { ok(a === b, label, JSON.stringify(a) + ' vs ' + JSON.stringify(b)); }

(async () => {
  const stub = await startStub({});
  process.env.BUFFER_API_BASE = stub.base;
  process.env.BUFFER_AUTH_BASE = stub.base;
  process.env.BUFFER_CLIENT_ID = '';
  process.env.BUFFER_CLIENT_SECRET = '';
  process.env.SCA_PUBLIC_BASE = 'http://127.0.0.1:4399';

  const buffer = require('../lib/buffer');

  /* ---------- 1. 拼请求体 ---------- */
  console.log('\n· buildPostInput');
  const now = buffer.buildPostInput({ text: 'hi', channelId: 'ch1', mediaUrl: '' });
  eq(now.mode, 'shareNow', '立即发布 → mode=shareNow');
  eq(now.schedulingType, 'automatic', 'schedulingType 恒为 automatic（文档示例）');
  ok(!('dueAt' in now), '立即发布不带 dueAt');
  ok(!('assets' in now), '没附件就不传 assets');

  const sch = buffer.buildPostInput({ text: 'hi', channelId: 'ch1', scheduleAt: '2026-12-01T09:00:00.000Z' });
  eq(sch.mode, 'customScheduled', '定时 → mode=customScheduled');
  eq(sch.dueAt, '2026-12-01T09:00:00.000Z', '定时 → dueAt 原样传');

  const img = buffer.buildPostInput({ text: 'hi', channelId: 'ch1', mediaUrl: 'https://x.test/a.png' });
  ok(Array.isArray(img.assets) && img.assets[0] && img.assets[0].image && img.assets[0].image.url === 'https://x.test/a.png', '附件 → assets[0].image.url');
  const doc = buffer.buildPostInput({ text: 'hi', channelId: 'ch1', mediaUrl: 'https://x.test/a.pdf', mediaKind: 'document' });
  ok(doc.assets && doc.assets[0] && doc.assets[0].document, 'PDF → assets[0].document（不是 image）');

  /* ---------- 2. 发布前校验 ---------- */
  console.log('\n· validateCreate');
  ok(!buffer.validateCreate({ channelIds: [], mainContent: 'x' }).ok, '一个渠道都没勾 → 拒绝');
  ok(!buffer.validateCreate({ channelIds: ['a'], mainContent: '   ' }).ok, '文案全空 → 拒绝');
  ok(buffer.validateCreate({ channelIds: ['a'], mainContent: '', channelCustomContent: { a: { content: '只在 A 发' } } }).ok, '只有分渠道文案 → 允许');
  ok(!buffer.validateCreate({ channelIds: ['a'], mainContent: 'x', scheduleAt: '不是时间' }).ok, '定时时间非法 → 拒绝');
  ok(!buffer.validateCreate({ channelIds: ['a'], mainContent: 'x', scheduleAt: '2020-01-01T00:00:00Z' }).ok, '定时时间已过去 → 拒绝');
  ok(!buffer.validateCreate({ channelIds: ['a'], mainContent: 'x', mediaUrl: 'http://x.test/a.png' }).ok, '附件是 http → 拒绝（Buffer 抓不到）');
  ok(buffer.validateCreate({ channelIds: ['a'], mainContent: 'x', mediaUrl: 'https://x.test/a.png' }).ok, '附件是 https → 允许');

  /* ---------- 3. 错误翻译 / 小工具 ---------- */
  console.log('\n· friendlyError / 工具');
  ok(/重新连接/.test(buffer.friendlyError('invalid_grant: token expired')), 'token 失效 → 提示重新连接');
  ok(/权限/.test(buffer.friendlyError('permission denied for scope')), '权限 → 提示权限不够');
  ok(/媒体/.test(buffer.friendlyError('Failed to fetch image dimensions: Not Found')), '图片抓不到 → 归到媒体问题');
  ok(buffer.friendlyError('some weird thing') === 'some weird thing', '翻不了的原样透出，不吞错');
  eq(buffer.maskKey('abcdefghijklmnop'), 'abcd••••mnop', 'key 打码只留头尾');
  ok(buffer.isLocalhost('http://127.0.0.1:4319/x'), 'isLocalhost 认 127.0.0.1');
  ok(buffer.isLocalhost('http://localhost:4319'), 'isLocalhost 认 localhost');
  ok(!buffer.isLocalhost('https://example.com/x'), 'isLocalhost 不认公网域名');

  const sorted = buffer.sortChannels([
    { id: '3', key: 'slack', displayName: 'S' },
    { id: '1', key: 'facebook', displayName: 'F' },
    { id: '2', key: 'twitter', displayName: 'X' }
  ], (k) => ({ facebook: 0, twitter: 1, slack: 10 }[k] == null ? 99 : { facebook: 0, twitter: 1, slack: 10 }[k]));
  eq(sorted.map((x) => x.key).join(','), 'facebook,twitter,slack', '渠道按规格顺序排');

  /* ---------- 4. 未连接状态 ---------- */
  console.log('\n· 未连接');
  buffer.__resetCache();
  const st0 = buffer.status();
  eq(st0.mode, 'none', '没凭据 → mode=none');
  ok(st0.why.length > 10, '未连接必须给一句「为什么 + 下一步」', st0.why.slice(0, 24) + '…');
  eq(st0.mediaPublic, false, '本机 publicBase → mediaPublic=false（还没配公网地址）');
  const au = buffer.authUrl();
  eq(au.ok, false, '没有 client_id → auth-url 不硬编一个假链接');
  eq(au.need, 'client_id', '并说明缺的是 client_id');

  // channels 在未连接时要说人话
  let threw = null;
  try { await buffer.channels({ refresh: true }); } catch (e) { threw = e; }
  eq(threw && threw.code, 'not_connected', '未连接拉渠道 → not_connected（不是 organization 玄学错）');

  /* ---------- 5. 连上（API Key 模式，走真 HTTP 到替身） ---------- */
  console.log('\n· 连接 + 渠道');
  const conn = await buffer.setApiKey('test_api_key_1234567890');
  eq(conn.ok, true, 'API Key 连上');
  eq(conn.org.id, 'org_test', '拿到 organization');
  const chs = await buffer.channels({ refresh: true });
  eq(chs.channels.length, 4, '拉到 4 个渠道');
  const q1 = stub.state.channelQueries;
  await buffer.channels({});
  eq(stub.state.channelQueries, q1, '5 分钟内走缓存，不重复打 Buffer');
  eq(stub.state.tokenSeen.filter((h) => h === 'Bearer test_api_key_1234567890').length > 0, true, '请求带 Bearer');

  /* ---------- 6. 发布：fan-out / 分渠道文案 / 部分失败 ---------- */
  console.log('\n· createPost');
  stub.state.calls.length = 0;
  const r1 = await buffer.createPost({
    channelIds: ['ch_fb_1', 'ch_x_1'],
    mainContent: '主文案',
    channelCustomContent: { ch_x_1: { content: 'X 专用文案' } },
    mediaUrl: 'https://cdn.test/a.png'
  });
  eq(r1.ok, true, '两个渠道都成功 → ok=true');
  eq(r1.total, 2, 'fan-out 成 2 次调用（Buffer 一次只能一个渠道）');
  eq(stub.state.calls.length, 2, '替身真的收到 2 次 createPost');
  eq(stub.state.calls.find((c) => c.channelId === 'ch_x_1').text, 'X 专用文案', '分渠道文案覆盖主文案');
  eq(stub.state.calls.find((c) => c.channelId === 'ch_fb_1').text, '主文案', '没单独填的渠道用主文案');
  ok(stub.state.calls.every((c) => c.assets && c.assets[0].image.url === 'https://cdn.test/a.png'), '每个渠道都带上了附件');

  stub.state.calls.length = 0;
  stub.state.failFor = ['ch_li_1'];
  const r2 = await buffer.createPost({ channelIds: ['ch_fb_1', 'ch_li_1'], mainContent: 'x' });
  eq(r2.ok, false, '一个渠道失败 → 整批 ok=false（不粉饰）');
  eq(r2.okCount, 1, '成功数 1');
  eq(r2.failCount, 1, '失败数 1');
  ok(/权限/.test(r2.results.find((r) => !r.ok).error), '失败原因被翻译成看得懂的话');
  stub.state.failFor = [];

  stub.state.calls.length = 0;
  const r3 = await buffer.createPost({
    channelIds: ['ch_x_1'], mainContent: 'x', scheduleAt: '2026-12-01T09:00:00.000Z'
  });
  eq(stub.state.calls[0].mode, 'customScheduled', '定时发布 → 传给 Buffer 的 mode');
  eq(stub.state.calls[0].dueAt, '2026-12-01T09:00:00.000Z', '定时发布 → dueAt 传对');
  eq(r3.scheduleAt, '2026-12-01T09:00:00.000Z', '结果里记着定时时间');

  let bad = null;
  try { await buffer.createPost({ channelIds: [], mainContent: 'x' }); } catch (e) { bad = e; }
  eq(bad && bad.code, 'invalid', '没勾渠道直接调接口 → invalid，不是发个空帖出去');

  /* ---------- 7. 查状态 ---------- */
  console.log('\n· postStatus');
  const ps = await buffer.postStatus('post_ch_x_1');
  eq(ps.verified, true, '能查到就 verified=true');
  eq(ps.remote.status, 'sent', '带上 Buffer 侧状态');
  stub.state.postStatusOk = false;
  const ps2 = await buffer.postStatus('post_ch_x_1');
  eq(ps2.verified, false, '查不到就 verified=false');
  ok(ps2.why.length > 5, '并说明为什么没查到（不编一个「已发布」）');
  ok(ps2.local && ps2.local.hit, '本地记录照样返回');

  /* ---------- 8. 断开 ---------- */
  console.log('\n· 断开');
  buffer.disconnect();
  eq(buffer.status().mode, 'none', '断开后回到未连接');
  const hist = fs.readdirSync(TMP).filter((f) => /buffer-posts/.test(f));
  ok(hist.length > 0, '发布历史落盘（buffer-posts.json）');

  await stub.stop();
  console.log('\n' + (fails.length ? '✗ social post 单测失败 ' + fails.length + ' 项：\n- ' + fails.join('\n- ') : '✓ social post 单测全部通过 ' + pass + ' 项'));
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error('脚本失败：' + e.stack);
  process.exit(1);
});
