'use strict';
/** 规则引擎的回归测试：node tests/rules.test.js */
const assert = require('assert');
const { runChecks } = require('../lib/rules');
const C = require('../lib/channels');

let pass = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { console.error('FAIL  ' + name + '\n      ' + e.message); process.exitCode = 1; }
}
const fails = (ch, body, brief) => runChecks(ch, body, brief || {}).results.filter((r) => !r.ok).map((r) => r.id);
const okOf = (ch, body, brief) => runChecks(ch, body, brief || {}).results.filter((r) => r.ok).map((r) => r.id);

console.log('\n[reddit] Reddit 软帖');
t('标题有推广词 → 触发 rd_title_no_promo', () => {
  assert.ok(fails('reddit_post', 'x'.repeat(500), { title: 'Launch: 50% discount on our new tool' }).includes('rd_title_no_promo'));
});
t('正文第一行（即帖子里贴的标题）带推广词 → 也要触发', () => {
  const body = '50% discount 活动来了\n\n' + 'y'.repeat(500) + '\n\n你怎么看?';
  assert.ok(fails('reddit_post', body, { title: '一个观察' }).includes('rd_title_no_promo'));
});
t('第一段有链接 → 触发 rd_no_link_first_para', () => {
  const body = '看看这个 https://x.com/a 很不错。\n\n' + 'y'.repeat(500);
  assert.ok(fails('reddit_post', body, { title: '一个观察' }).includes('rd_no_link_first_para'));
});
t('提到自家产品但没披露 → 触发 rd_disclosure', () => {
  const body = 'I built a thing. ' + 'z'.repeat(450) + ' 你怎么看?';
  assert.ok(fails('reddit_post', body, { title: '一个观察' }).includes('rd_disclosure'));
});
t('干净软帖 → 全部通过', () => {
  const body = 'I spent two weeks on this and hit three walls.\n\n'
    + 'First, the data pipeline. Second, the pricing page. Third, the onboarding email.\n\n'
    + 'What I still cannot figure out: is it worth rebuilding the whole thing or patching it?\n\n'
    + '(Disclosure: I work at the company, so take the numbers with salt.)\n\n'
    + 'Context: ' + 'filler '.repeat(60);
  const bad = fails('reddit_post', body, { title: 'Three walls I hit rebuilding onboarding' });
  assert.deepStrictEqual(bad, [], '意外失败：' + bad.join(','));
});

console.log('\n[cold_email] 冷邮件');
t('出现「附件」→ 触发 ce_no_attach_word（Gmail 会拦）', () => {
  assert.ok(fails('cold_email', 'Hi, 附件是我们的方案，请查收。' + 'x'.repeat(200)).includes('ce_no_attach_word'));
});
t('出现 attach → 同样触发', () => {
  assert.ok(fails('cold_email', 'I attached a deck for you. ' + 'x'.repeat(200)).includes('ce_no_attach_word'));
});
t('提约通话 → 触发 ce_one_ask', () => {
  assert.ok(fails('cold_email', 'Would you be open to a quick call next week? ' + 'x'.repeat(200)).includes('ce_one_ask'));
});

console.log('\n[x_post] X 帖子');
t('280 上限（链接按 23 计）', () => {
  const long = 'a'.repeat(270) + ' https://example.com/very/long/path/that/is/long';
  assert.ok(fails('x_post', long).includes('x_len_280'));
});
t('堆标签 → x_hashtag_max1', () => {
  assert.ok(fails('x_post', 'hello world #a #b #c #d').includes('x_hashtag_max1'));
});
t('硬广词 → x_no_hard_sell', () => {
  assert.ok(fails('x_post', 'This is great. Buy now!').includes('x_no_hard_sell'));
});

console.log('\n[tiktok] TikTok 短口播');
t('放外链 → tt_no_link', () => {
  assert.ok(fails('tiktok_script', '看这里 https://a.com 很好用').includes('tt_no_link'));
});
t('Markdown 列表 → tt_spoken', () => {
  assert.ok(fails('tiktok_script', '- 第一点\n- 第二点\n- 第三点').includes('tt_spoken'));
});

console.log('\n[youtube] YouTube 脚本');
t('开头是自我介绍 → yt_hook_first_2_lines', () => {
  assert.ok(fails('youtube_script', 'Hi guys, welcome back to my channel.\n' + 'x'.repeat(700)).includes('yt_hook_first_2_lines'));
});
t('没有时间轴 → yt_chapters', () => {
  assert.ok(fails('youtube_script', 'Hook line one.\n' + 'x'.repeat(700)).includes('yt_chapters'));
});

console.log('\n[landing] 落地页首屏');
t('主标题过长 → lp_headline_60', () => {
  assert.ok(fails('landing_hero', '这是一个非常非常长的主标题'.repeat(5) + '\n副标题\nCTA').includes('lp_headline_60'));
});
t('没有证据 → lp_proof', () => {
  assert.ok(fails('landing_hero', 'Better content\nFor everyone\nGet started').includes('lp_proof'));
});
t('行话 → lp_no_jargon', () => {
  assert.ok(fails('landing_hero', '一站式赋能闭环\n给团队：省时间\nGet started\n1,200 次').includes('lp_no_jargon'));
});

console.log('\n[global] 品牌禁用词');
t('自定义禁用词生效', () => {
  const r = runChecks('x_post', '我们的 game-changer 产品', {}, { bannedWords: ['game-changer'] });
  assert.ok(r.results.some((x) => x.id === 'global_banned' && !x.ok));
});

console.log('\n[cjk] 中文字符阈值折算');
t('中文 YouTube 稿 320 字（<600 字符）应通过 yt_len_min', () => {
  const body = '这是一段中文口播稿。'.repeat(32); // ≈ 320 字
  const r = runChecks('youtube_script', body, {});
  const c = r.results.find((x) => x.id === 'yt_len_min');
  assert.strictEqual(c.ok, true, '中文被误判太短：' + c.detail);
});
t('英文 YouTube 稿 320 字符应失败', () => {
  const body = 'a'.repeat(320);
  const c = runChecks('youtube_script', body, {}).results.find((x) => x.id === 'yt_len_min');
  assert.strictEqual(c.ok, false);
});

console.log('\n[consistent] 同一输入同样输出');
t('两次运行结果一致', () => {
  const a = runChecks('reddit_post', 'body '.repeat(120), { title: 'x' });
  const b = runChecks('reddit_post', 'body '.repeat(120), { title: 'x' });
  assert.strictEqual(JSON.stringify(a), JSON.stringify(b));
});

console.log('\n[video_shotlist] 视频分镜包');
const SHOT = (n, from, to, line) =>
  `【镜头 ${n} · ${from}–${to}s】\n画面：某个画面 ${n}\n台词：${line}\n提示词：竖屏 9:16，冷色调`;

const goodShotlist = [
  SHOT(1, 0, 3, '钩子一'),
  SHOT(2, 3, 9, '钩子二'),
  SHOT(3, 9, 18, '中间一'),
  SHOT(4, 18, 30, '中间二'),
  SHOT(5, 30, 36, '关注我，评论区说一句'),
  '总时长：36 秒'
].join('\n\n');

t('干净分镜包：6 条规则全过', () => {
  const r = runChecks('video_shotlist', goodShotlist, { cta: '关注我' });
  const bad = r.results.filter((x) => !x.ok);
  assert.strictEqual(r.mustFail, 0, '不应有硬伤：' + JSON.stringify(bad.map((b) => b.id + ':' + b.detail)));
});

t('镜头不足 5 个 → vs_shot_count 失败', () => {
  const body = [SHOT(1, 0, 3, 'a'), SHOT(2, 3, 9, 'b'), '总时长：9 秒'].join('\n\n');
  const c = runChecks('video_shotlist', body, {}).results.find((x) => x.id === 'vs_shot_count');
  assert.strictEqual(c.ok, false);
});

t('缺提示词 → vs_each_has_prompt 失败', () => {
  const body = goodShotlist.replace('提示词：竖屏 9:16，冷色调', '');
  const c = runChecks('video_shotlist', body, {}).results.find((x) => x.id === 'vs_each_has_prompt');
  assert.strictEqual(c.ok, false);
});

t('总时长 60 秒 → vs_total_duration 失败', () => {
  const body = goodShotlist.replace('总时长：36 秒', '总时长：60 秒');
  const c = runChecks('video_shotlist', body, {}).results.find((x) => x.id === 'vs_total_duration');
  assert.strictEqual(c.ok, false);
});

t('没写总时长 → vs_total_duration 失败', () => {
  const body = goodShotlist.replace('总时长：36 秒', '');
  const c = runChecks('video_shotlist', body, {}).results.find((x) => x.id === 'vs_total_duration');
  assert.strictEqual(c.ok, false);
});

t('最后一镜没有 CTA → vs_cta_end 失败', () => {
  const body = goodShotlist.replace('关注我，评论区说一句', '画面渐黑');
  const c = runChecks('video_shotlist', body, {}).results.find((x) => x.id === 'vs_cta_end');
  assert.strictEqual(c.ok, false);
});

t('分镜里有链接 → vs_no_link 失败', () => {
  const body = goodShotlist + '\n\nhttps://example.com/x';
  const c = runChecks('video_shotlist', body, {}).results.find((x) => x.id === 'vs_no_link');
  assert.strictEqual(c.ok, false);
});

t('每个渠道都有 type 且属于四类之一', () => {
  const types = new Set(['article', 'social', 'email', 'video']);
  C.CHANNELS.forEach((ch) => assert.ok(types.has(ch.type), ch.id + ' 的 type 非法：' + ch.type));
  assert.strictEqual(C.assetTypeOf('video_shotlist'), 'video');
  assert.strictEqual(C.assetTypeOf('cold_email'), 'email');
});

console.log(`\n${pass} 项通过${process.exitCode ? '，有失败' : '，全部通过'}\n`);
