'use strict';
/**
 * Social post composer 交互验收（真点击 / 真打字 / 真 HTTP）
 *
 * 隔离方式：临时数据目录 + Buffer 替身（tests/stub-buffer.js）+ 一个**临时 app 服务**，
 * 不去碰 4319 上正在用的那份 data/（更不能把测试 token 写进真凭据文件）。
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const puppeteer = require(path.join(__dirname, '..', '..', 'node_modules', 'puppeteer-core'));
const { startStub } = require('../tests/stub-buffer');

const EXE = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
const fails = [];
function ok(label, detail) { pass += 1; console.log('  ok  ' + label + (detail ? '  → ' + detail : '')); }
function bad(label, detail) { fails.push(label + (detail ? ' → ' + detail : '')); console.log('  ✗   ' + label + (detail ? '  → ' + detail : '')); }
function chk(cond, label, detail) { if (cond) ok(label, detail); else bad(label, detail); }

async function waitPort(url, tries) {
  for (let i = 0; i < (tries || 60); i += 1) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch (e) { /* 还没起来 */ }
    await sleep(200);
  }
  return false;
}

async function main() {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sca-ui-sp-'));
  const stub = await startStub({});
  const PORT = 4519;
  const BASE = 'http://127.0.0.1:' + PORT;

  // 1x1 透明 PNG（测试上传用）
  const pngPath = path.join(TMP, 'dot.png');
  fs.writeFileSync(pngPath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AL+2wYAAAAASUVORK5CYII=', 'base64'));

  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    stdio: 'ignore',
    env: Object.assign({}, process.env, {
      PORT: String(PORT),
      SCA_PORT: String(PORT),
      SCA_DATA_DIR: TMP,
      SCA_PUBLIC_BASE: BASE,
      BUFFER_API_BASE: stub.base,
      BUFFER_AUTH_BASE: stub.base,
      BUFFER_CLIENT_ID: '',           // 故意不配 → 走「自动降级到 API Key」那条路
      BUFFER_CLIENT_SECRET: '',
      BUFFER_API_KEY: ''
    })
  });

  const up = await waitPort(BASE + '/api/state');
  if (!up) { console.log('✗ 临时服务没起来'); child.kill(); await stub.stop(); process.exit(1); }

  const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-first-run', '--no-default-browser-check'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push('console: ' + m.text()); });
  page.on('dialog', (d) => d.accept());

  try {
    await page.goto(BASE, { waitUntil: 'networkidle2' });
    await sleep(900);

    /* ---------- 1. 从 Content 建一条社媒内容 → 落到新页面 ---------- */
    await page.evaluate(() => document.querySelector('.nav-item[data-view="content"]').click());
    await sleep(900);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /Create content/.test(x.textContent));
      b.click();
    });
    await sleep(300);
    await page.evaluate(() => document.querySelector('#clCreateMenu [data-new="social"]').click());
    await sleep(2000);

    const opened = await page.evaluate(() => {
      const v = document.getElementById('view-social-post');
      const cs = getComputedStyle(v);
      return {
        open: !v.classList.contains('hidden'),
        fixed: cs.position === 'fixed',
        pill: (document.getElementById('spStatus') || {}).textContent,
        cardW: Math.round(document.getElementById('spCard').getBoundingClientRect().width),
        sideW: Math.round(document.querySelector('.sp-side').getBoundingClientRect().width),
        bg: cs.backgroundColor
      };
    });
    chk(opened.open && opened.fixed, 'Create content → Social post 落到铺满整屏的 composer', JSON.stringify({ fixed: opened.fixed }));
    chk(opened.pill === 'Draft', '顶部状态标签是 Draft', opened.pill);
    chk(opened.sideW === 280, '左侧栏固定 280px', String(opened.sideW));
    chk(opened.cardW === 640, '编辑器卡片最大宽 640px 且居中', String(opened.cardW));

    /* ---------- 1b. 三层卡片：同一圆角/阴影，顶部与下方左右对齐 ---------- */
    const cards = await page.evaluate(() => {
      const pick = (sel) => {
        const el = document.querySelector(sel);
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return { bg: cs.backgroundColor, radius: cs.borderRadius, shadow: cs.boxShadow, w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left), right: Math.round(r.right) };
      };
      return { top: pick('.sp-top'), side: pick('.sp-side'), card: pick('.sp-card'), body: pick('.sp-shell') };
    });
    chk(['8px', '8px', '8px'].every((v, i) => [cards.top, cards.side, cards.card][i].radius === v), '三层卡片统一圆角 8px', [cards.top.radius, cards.side.radius, cards.card.radius].join(','));
    chk([cards.top, cards.side, cards.card].every((x) => /rgba\(0, 0, 0, 0\.06\)/.test(x.shadow)), '三层卡片统一阴影 0 1px 3px rgba(0,0,0,.06)');
    chk([cards.top, cards.side, cards.card].every((x) => x.bg === 'rgb(255, 255, 255)'), '三层卡片都是白底（不是裸文字扔在灰底上）');
    chk(cards.side.w === 280, '左侧是 280px 白底卡片', String(cards.side.w));
    chk(cards.card.w === 640, '右侧是 640px 白底卡片', String(cards.card.w));
    chk(cards.top.left === cards.side.left && cards.top.right === cards.card.right, '顶部卡片与下方左右卡片左右对齐（同一条 940 列）', cards.top.left + '..' + cards.top.right + ' vs ' + cards.side.left + '..' + cards.card.right);
    chk(cards.card.left - cards.side.right >= 14, '两张卡片之间留了间距（同级容器成对出现）', String(cards.card.left - cards.side.right));
    chk(cards.card.h >= 700, '右侧卡片撑满内容区高度（下方不留大面积空白）', String(cards.card.h));
    chk(cards.side.h <= 340, '左侧卡片贴合内容高度（不拉成一整条空卡）', String(cards.side.h));

    /* ---------- 2. 状态 A：未连接（提示只说一次）---------- */
    const stateA = await page.evaluate(() => {
      const rail = document.querySelector('.sp-side');
      return {
        railText: rail.innerText.replace(/\s+/g, ' '),
        connectVisible: !document.getElementById('spConnect').classList.contains('hidden'),
        dupText: /haven’t connected|Connect Buffer to load all|yet\./.test(rail.innerText),
        publishDisabled: document.getElementById('spPublish').disabled,
        lock: !document.getElementById('spLock').classList.contains('hidden'),
        lockInCard: !!document.querySelector('#spCard #spLock'),
        lockBg: getComputedStyle(document.getElementById('spLock')).backgroundColor,
        noTooltip: !document.querySelector('.sp-lock'),
        locked: document.getElementById('spCard').classList.contains('is-locked'),
        searchHidden: document.getElementById('spSearchWrap').classList.contains('hidden'),
        rows: document.querySelectorAll('#spChannels .sp-ch').length
      };
    });
    chk(stateA.connectVisible, '状态 A 有蓝色 Connect Buffer 主按钮');
    chk(!stateA.dupText, '状态 A 不再重复那两句「还没连 Buffer」提示（同一信息只说一次）');
    chk(stateA.rows === 0, '状态 A 不拿假渠道把列表填满', String(stateA.rows));
    chk(stateA.searchHidden, '状态 A 不显示搜索框');
    chk(stateA.publishDisabled, '没连/没渠道时 Publish 置灰');
    chk(stateA.lock && stateA.locked, '编辑器柔和置灰 + 锁态');
    chk(stateA.lockInCard, '锁态提示在卡片内部（一行轻提示）');
    chk(stateA.lockBg === 'rgb(243, 244, 246)', '锁态提示是浅灰行内条，不是黑色 tooltip', stateA.lockBg);
    chk(stateA.noTooltip, '外部那块悬浮黑色 tooltip 已删掉');

    /* ---------- 3. 没配 client_id → 自动降级到粘 API Key ---------- */
    await page.evaluate(() => document.getElementById('spConnect').click());
    await sleep(900);
    const keyUi = await page.evaluate(() => ({
      input: !!document.getElementById('spKeyInput'),
      fb: (document.getElementById('spFeedback') || {}).innerText || ''
    }));
    chk(keyUi.input, '没配 OAuth client 时自动给出「粘 API Key」而不是死链');
    chk(/OAuth 这条路现在用不了/.test(keyUi.fb), '并说清为什么（不假装弹了授权窗口）');

    const key = 'test_api_key_abcdefghijkl';
    await page.evaluate((k) => { document.getElementById('spKeyInput').value = k; }, key);
    await page.evaluate(() => document.querySelector('[data-sp="savekey"]').click());
    await sleep(1600);

    /* ---------- 4. 状态 B：渠道列表 ---------- */
    const list = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#spChannels .sp-ch')];
      return {
        count: rows.length,
        names: rows.map((r) => (r.querySelector('.sp-ch-name') || {}).textContent),
        svgs: document.querySelectorAll('#spChannels svg.sp-brand').length,
        iconSizes: [...document.querySelectorAll('#spChannels svg.sp-brand')].map((s) => s.getAttribute('width')),
        iconFills: [...document.querySelectorAll('#spChannels svg.sp-brand')].map((s) => s.style.fill),
        searchVisible: !document.getElementById('spSearchWrap').classList.contains('hidden'),
        lock: !document.getElementById('spLock').classList.contains('hidden')
      };
    });
    chk(list.count === 4, '连上后渲染 Buffer 里的 4 个渠道', String(list.count));
    chk(list.names.join('|') === 'Acme on Facebook|Acme @acmeco|Acme on Instagram|Acme on LinkedIn', '按规格固定顺序排（FB → X → IG → LinkedIn）', list.names.join(' | '));
    chk(list.searchVisible, '渠道列表上方出现 Search channels');
    chk(!list.lock, '连上后锁态解除');
    const railB = await page.evaluate(() => ({
      connectHidden: document.getElementById('spConnect').classList.contains('hidden'),
      linksVisible: !document.getElementById('spSideLinks').classList.contains('hidden'),
      lockInside: !document.getElementById('spLock').classList.contains('hidden')
    }));
    chk(railB.connectHidden && railB.linksVisible, '连上后收起 Connect 按钮，刷新/断开收成底部小链接');
    chk(!railB.lockInside, '连上后卡片内那行轻提示消失');
    chk(list.svgs === 4 && list.iconSizes.every((s) => s === '20'), '每个渠道一个 simple-icons 图标，尺寸 20', list.iconSizes.join(','));
    chk(list.iconFills[0] === 'rgb(8, 102, 255)' || /#0866FF/i.test(list.iconFills[0] || ''), '图标用品牌原色（Facebook #0866FF）', list.iconFills[0]);

    /* ---------- 5. 搜索过滤 ---------- */
    await page.evaluate(() => {
      const i = document.getElementById('spSearch');
      i.value = 'linked';
      i.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(300);
    const filtered = await page.evaluate(() => document.querySelectorAll('#spChannels .sp-ch').length);
    chk(filtered === 1, '搜索能过滤渠道', String(filtered));
    await page.evaluate(() => {
      const i = document.getElementById('spSearch');
      i.value = '';
      i.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(250);

    /* ---------- 6. 勾选渠道 → Publish 仍灰（文案为空）---------- */
    await page.evaluate(() => {
      document.querySelector('[data-spcheck="ch_fb_1"]').click();
      document.querySelector('[data-spcheck="ch_x_1"]').click();
    });
    await sleep(400);
    const picked = await page.evaluate(() => ({
      selected: document.querySelectorAll('#spChannels .sp-ch.is-on').length,
      disabled: document.getElementById('spPublish').disabled,
      title: document.getElementById('spPublish').title
    }));
    chk(picked.selected === 2, '多选渠道，选中行左侧出现品牌色竖线', String(picked.selected));
    chk(picked.disabled && /文案/.test(picked.title), '选了渠道但文案为空 → Publish 仍然不可点', picked.title);

    /* ---------- 7. 打字 + 2s 防抖自动存草稿 ---------- */
    const id = await page.evaluate(() => window.SP.id());
    await page.click('#spText');
    await page.type('#spText', '我们做了一个本地内容工具，先跑通自己的流程。');
    await sleep(400);
    const enabledNow = await page.evaluate(() => document.getElementById('spPublish').disabled);
    chk(!enabledNow, '有渠道 + 有文案 → Publish 变可点');

    await sleep(2600);
    const saved = await fetch(BASE + '/api/draft/social-post?id=' + encodeURIComponent(id)).then((r) => r.json());
    chk(saved.state.channelIds.length === 2, '2 秒防抖后草稿里存了勾选状态', JSON.stringify(saved.state.channelIds));
    chk(/本地内容工具/.test(saved.state.mainContent), '草稿里存了正文');
    const savedLabel = await page.evaluate(() => document.getElementById('spSaved').textContent);
    chk(/Saved/.test(savedLabel), '顶部显示 Saved …', savedLabel);

    /* ---------- 8. Customize per channel ---------- */
    await page.evaluate(() => document.getElementById('spCustomize').click());
    await sleep(400);
    const pc = await page.evaluate(() => document.querySelectorAll('.sp-pc').length);
    chk(pc === 2, '打开「Customize per channel」→ 每个勾选渠道一个子面板', String(pc));
    await page.evaluate(() => {
      const t = document.querySelector('[data-pc="ch_x_1"]');
      t.value = 'X 专用：一条更短的版本';
      t.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(2500);
    const saved2 = await fetch(BASE + '/api/draft/social-post?id=' + encodeURIComponent(id)).then((r) => r.json());
    chk(saved2.state.perChannel.ch_x_1 && /X 专用/.test(saved2.state.perChannel.ch_x_1.content), '分渠道文案也存进草稿', JSON.stringify(saved2.state.perChannel.ch_x_1 || null));

    /* ---------- 9. Schedule（UTC）---------- */
    await page.evaluate(() => document.querySelector('.sp-tab[data-sptab="schedule"]').click());
    await sleep(400);
    const tabStyle = await page.evaluate(() => {
      const on = document.querySelector('.sp-tab.is-on');
      const off = document.querySelector('.sp-tab:not(.is-on)');
      return { onBg: getComputedStyle(on).backgroundColor, onColor: getComputedStyle(on).color, offBg: getComputedStyle(off).backgroundColor };
    });
    chk(tabStyle.onBg === 'rgb(37, 99, 235)' && tabStyle.onColor === 'rgb(255, 255, 255)', 'Tab 选中态实心主蓝 #2563eb', tabStyle.onBg);
    chk(tabStyle.offBg === 'rgb(243, 244, 246)', 'Tab 未选中浅灰 #f3f4f6', tabStyle.offBg);

    const schUi = await page.evaluate(() => ({
      shown: !document.getElementById('spSchedule').classList.contains('hidden'),
      utc: (document.querySelector('.sp-utc') || {}).textContent,
      val: document.getElementById('spWhen').value,
      publishLabel: document.getElementById('spPublish').textContent
    }));
    chk(schUi.shown && /UTC/.test(schUi.utc), 'Schedule 页签给出 UTC 提示', schUi.utc);
    chk(!!schUi.val, '切到 Schedule 会自动填一个未来时间', schUi.val);
    chk(schUi.publishLabel === 'Schedule', '定时模式下主按钮变成 Schedule', schUi.publishLabel);
    await page.evaluate(() => {
      const el = document.getElementById('spWhen');
      el.value = '2026-12-24T09:30';
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await sleep(2500);
    const saved3 = await fetch(BASE + '/api/draft/social-post?id=' + encodeURIComponent(id)).then((r) => r.json());
    chk(/^2026-12-24T09:30:00\.000Z$/.test(saved3.state.scheduleAt || ''), '定时时间按 UTC 存成 ISO', String(saved3.state.scheduleAt));

    /* ---------- 10. 发布（定时）→ 真打到 Buffer 替身 ---------- */
    stub.state.calls.length = 0;
    await page.evaluate(() => document.getElementById('spPublish').click());
    await sleep(1500);
    const fb1 = await page.evaluate(() => ({
      cls: document.getElementById('spFeedback').className,
      text: document.getElementById('spFeedback').innerText
    }));
    chk(/is-ok/.test(fb1.cls) && /已提交给 Buffer/.test(fb1.text), '发布成功 → 绿色提示条', fb1.cls);
    chk(stub.state.calls.length === 2, '两个渠道 → Buffer 收到 2 次 createPost（一次一个渠道）', String(stub.state.calls.length));
    chk(stub.state.calls.every((c) => c.mode === 'customScheduled' && c.dueAt === '2026-12-24T09:30:00.000Z'), '定时发布真的把 dueAt 传下去了', JSON.stringify(stub.state.calls.map((c) => c.mode)));
    const xCall = stub.state.calls.find((c) => c.channelId === 'ch_x_1') || {};
    chk(/X 专用/.test(xCall.text || ''), '勾了分渠道文案的渠道发的是专属文案', String(xCall.text).slice(0, 12));

    /* ---------- 11. 部分失败 → 红条 + 可读原因 ---------- */
    await page.evaluate(() => document.querySelector('.sp-tab[data-sptab="now"]').click());
    await sleep(300);
    await fetch(stub.base + '/__fail', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ failFor: ['ch_fb_1'] }) });
    await page.evaluate(() => document.getElementById('spPublish').click());
    await sleep(1500);
    const fb2 = await page.evaluate(() => ({
      cls: document.getElementById('spFeedback').className,
      text: document.getElementById('spFeedback').innerText
    }));
    chk(/is-bad/.test(fb2.cls), '有渠道失败 → 红色提示条', fb2.cls);
    chk(/权限/.test(fb2.text), '失败原因翻成中文可读（权限）', fb2.text.replace(/\s+/g, ' ').slice(0, 60));
    await fetch(stub.base + '/__fail', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ failFor: [] }) });

    /* ---------- 12. 媒体上传 + 本机地址的诚实警告 ---------- */
    const input = await page.$('#spFile');
    await input.uploadFile(pngPath);
    await sleep(900);
    // 等 2 秒防抖自动保存真的落盘
    await sleep(2600);
    const media = await page.evaluate(() => ({
      shown: !document.getElementById('spMediaBox').classList.contains('hidden'),
      thumb: !!document.querySelector('.sp-media-thumb'),
      warn: (document.querySelector('.sp-warn') || {}).textContent || ''
    }));
    chk(media.shown && media.thumb, 'Media 上传后出现缩略图');
    chk(/Buffer 服务器抓不到/.test(media.warn), '本机地址明确警告 Buffer 抓不到（不假装能带图）', media.warn.slice(0, 26));
    const saved4 = await fetch(BASE + '/api/draft/social-post?id=' + encodeURIComponent(id)).then((r) => r.json());
    chk(/^http:\/\/127\.0\.0\.1:\d+\/media\//.test(saved4.state.mediaUrl || ''), '素材 URL 落到草稿里', saved4.state.mediaUrl);
    const fileOk = saved4.state.mediaUrl ? await fetch(saved4.state.mediaUrl).then((r) => r.status).catch(() => 0) : 0;
    chk(fileOk === 200, '这个 URL 自己服务是能取到的（本地可用）', String(fileOk));

    /* ---------- 13. ⋮ 菜单 ---------- */
    await page.evaluate(() => document.getElementById('spMore').click());
    await sleep(300);
    const menu = await page.evaluate(() => [...document.querySelectorAll('#spMoreMenu .sp-mi')].map((b) => b.textContent));
    chk(menu.length === 8, '⋮ 菜单 8 项', String(menu.length));
    chk(['Updates', 'Custom fields', 'Version History', 'Manage campaigns', 'Duplicate', 'Duplicate to', 'Delete', 'Visit Help center'].every((x, i) => menu[i] === x), '顺序与规格一致', menu.join(' | '));

    await page.evaluate(() => document.querySelector('#spMoreMenu [data-spmore="dup"]').click());
    await sleep(1200);
    const drafts = await fetch(BASE + '/api/draft/social-post').then((r) => r.json());
    chk((drafts.drafts || []).length === 2, 'Duplicate 真的复制出一份草稿（渠道 + 文案一起）', String((drafts.drafts || []).length));

    /* ---------- 14. 断开 Buffer → 回到状态 A ---------- */
    await page.evaluate(() => { window.confirm = () => true; });
    await page.evaluate(() => document.querySelector('[data-sp="disconnect"]').click());
    await sleep(1200);
    const backA = await page.evaluate(() => ({
      rows: document.querySelectorAll('#spChannels .sp-ch').length,
      dup: /haven’t connected|Connect Buffer to load all/.test(document.querySelector('.sp-side').innerText),
      connectVisible: !document.getElementById('spConnect').classList.contains('hidden'),
      linksHidden: document.getElementById('spSideLinks').classList.contains('hidden'),
      lock: !document.getElementById('spLock').classList.contains('hidden'),
      disabled: document.getElementById('spPublish').disabled
    }));
    chk(backA.rows === 0 && !backA.dup, '断开后回到状态 A（不残留假渠道、也不重复提示）');
    chk(backA.connectVisible && backA.linksHidden, '断开后 Connect Buffer 按钮回到原位、底部链接收起');
    chk(backA.lock && backA.disabled, '断开后编辑器重新锁上、Publish 又变灰');

    /* ---------- 15. 删除草稿 + 收尾 ---------- */
    await page.evaluate(() => document.getElementById('spMore').click());
    await sleep(250);
    await page.evaluate(() => document.querySelector('#spMoreMenu [data-spmore="del"]').click());
    await sleep(1200);
    const afterDel = await fetch(BASE + '/api/content?group=content&size=50').then((r) => r.json());
    chk(afterDel.total === 1, 'Delete 删掉当前草稿（还剩 Duplicate 那份）', String(afterDel.total));

    chk(consoleErrors.length === 0, '控制台 0 报错', consoleErrors.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
    try { child.kill(); } catch (e) { /* ignore */ }
    await stub.stop();
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }

  console.log('\n' + (fails.length ? '✗ Social post 交互验收失败 ' + fails.length + ' 项：\n- ' + fails.join('\n- ') : '✓ Social post 交互验收全部通过 ' + pass + ' 项'));
  process.exit(fails.length ? 1 : 0);
}

main().catch((e) => { console.error('脚本失败：' + e.stack); process.exit(1); });
