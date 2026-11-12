'use strict';
/**
 * Strategy 交互验收：四个板块都用真实点击 / 输入跑一遍。
 *   1) New chat       —— 发消息、@技能、新建对话，并且和 Dashboard 共用同一份记录
 *   2) Content audit  —— 粘 GSC 导出 → 排序的机会清单 → 转成 campaign → 清空
 *   3) Company knowledge —— 和 Dashboard 是同一张表单 / 同一份数据（不是复制）
 *   4) Plugins & skills —— 插件登记/移除、技能增删改、@调用
 *
 * 用法：node scripts/ui-strategy.js
 * 结束时把本次造出来的 chat / campaign / plugin / skill 全删掉，并还原 GSC 与知识字段。
 */
const path = require('path');
const puppeteer = require(path.join(__dirname, '..', '..', 'node_modules', 'puppeteer-core'));

const URL_ = process.argv[2] || 'http://127.0.0.1:4319';
const EXE = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fs = require('fs');

const FONT_OK = ['12px', '13px', '14px', '16px', '20px', '26px'];

/** 把本次造出来的东西删掉、字段还原。放 finally 里，断言失败也要跑。 */
async function cleanup(page, base) {
  await page.evaluate(async (b) => {
    const [chats, state, kn, sk, strat] = await Promise.all([
      fetch('/api/chats').then((r) => r.json()),
      fetch('/api/state').then((r) => r.json()),
      fetch('/api/knowledge').then((r) => r.json()),
      fetch('/api/skills').then((r) => r.json()),
      fetch('/api/strategy').then((r) => r.json())
    ]);
    for (const c of chats.chats) if (!b.chats.includes(c.id)) await fetch('/api/chats/' + c.id, { method: 'DELETE' });
    for (const c of state.campaigns) if (!b.campaigns.includes(c.id)) await fetch('/api/campaigns/' + c.id, { method: 'DELETE' });
    for (const t of kn.tools) if (t.custom && !b.plugins.includes(t.id)) await fetch('/api/plugins/' + t.id, { method: 'DELETE' });
    for (const s of sk.skills) if (!b.skills.includes(s.id)) await fetch('/api/skills/' + s.id, { method: 'DELETE' });
    // 还原知识字段（含受众 / 内容支柱 / brand voices）与 GSC 导入
    await fetch('/api/knowledge', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ company: b.company })
    });
    const live = (await (await fetch('/api/knowledge')).json()).company || {};
    for (const [kind, key] of [['voice', 'brandVoices'], ['audience', 'audiences'], ['pillar', 'contentPillars'], ['writing-style', 'writingStyles'], ['visual-style', 'visualStyles']]) {
      const want = (b.company && b.company[key]) || [];
      for (const x of (live[key] || [])) {
        if (!want.some((w) => w.id === x.id)) {
          await fetch('/api/knowledge/' + kind + '/' + encodeURIComponent(x.id), { method: 'DELETE' });
        }
      }
    }
    // 图片库：本次传的图也要删，不然 data/knowledge/img 越攒越多
    const wantImgs = (b.images || []);
    const liveKn = await (await fetch('/api/knowledge')).json();
    for (const im of (liveKn.images || [])) {
      if (!wantImgs.includes(im.id)) await fetch('/api/knowledge/image/' + im.id, { method: 'DELETE' });
    }
    if ((strat.gsc.raw || '') !== b.gscRaw) {
      await fetch('/api/audit', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ raw: b.gscRaw })
      });
    }
  }, base);
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-first-run'] });
  const fails = [];
  let checks = 0;
  const ok = (n, x) => { checks++; console.log('  ok  ' + n + (x ? '  → ' + x : '')); };
  const bad = (n, x) => { checks++; fails.push(n); console.log('  ✗   ' + n + '  → ' + x); };
  const chk = (cond, n, x) => (cond ? ok(n, x) : bad(n, x));

  const click = (page, sel) => page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) throw new Error('没有 ' + s);
    el.click();
  }, sel);
  const setVal = (page, sel, v) => page.evaluate(([s, val]) => {
    const el = document.querySelector(s);
    el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, [sel, v]);
  const text = (page, sel) => page.evaluate((s) => {
    const el = document.querySelector(s);
    return el ? el.textContent.trim() : null;
  }, sel);
  const wait = (page, fn, arg, ms) => page.waitForFunction(fn, { timeout: ms || 8000, polling: 100 }, arg);
  const nav = async (page, view) => {
    await page.evaluate((v) => document.querySelector('.nav-item[data-view="' + v + '"]').click(), view);
    await wait(page, (v) => !document.getElementById('view-' + v).classList.contains('hidden'), view);
    await sleep(350);
  };
  const stTab = async (page, tab) => {
    await page.evaluate((t) => document.querySelector('.st-item[data-st="' + t + '"]').click(), tab);
    await wait(page, (t) => !document.getElementById('stPanel-' + t).classList.contains('hidden'), tab);
    await sleep(300);
  };
  const api = (page, p, opt) => page.evaluate(async ([pp, o]) => {
    const r = await fetch(pp, o ? { method: o.method, headers: { 'content-type': 'application/json' }, body: o.body ? JSON.stringify(o.body) : undefined } : undefined);
    return r.json();
  }, [p, opt || null]);

  let baseline = null;
  let page = null;
  try {
    page = await browser.newPage();
    await page.setViewport({ width: 1680, height: 1050 });
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    page.on('dialog', (d) => d.accept());

    await page.goto(URL_, { waitUntil: 'networkidle2' });
    await page.evaluate(() => document.fonts.ready);

    // 记下基线，结束时只删自己造的
    const st0 = await page.evaluate(async () => {
      const [chats, state, kn, sk, strat] = await Promise.all([
        fetch('/api/chats').then((r) => r.json()),
        fetch('/api/state').then((r) => r.json()),
        fetch('/api/knowledge').then((r) => r.json()),
        fetch('/api/skills').then((r) => r.json()),
        fetch('/api/strategy').then((r) => r.json())
      ]);
      return {
        chats: chats.chats.map((c) => c.id),
        campaigns: state.campaigns.map((c) => c.id),
        plugins: kn.tools.filter((t) => t.custom).map((t) => t.id),
        skills: sk.skills.map((s) => s.id),
        writingStyles: (kn.company.writingStyles || []).map((w) => w.name).join('|'),
      visualStyles: (kn.company.visualStyles || []).map((v) => v.name).join('|'),
      images: (kn.images || []).map((i) => i.id),
    company: kn.company,   // 整份快照：测试中途挂了也能还原
        gscRaw: strat.gsc.raw || ''
      };
    });
    baseline = st0;

    // 先把导入清掉，空状态才可判定（结束时用基线还原）
    await page.evaluate(() => fetch('/api/audit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ raw: '' }) }));

    console.log('\n【一】结构与视觉');
    await nav(page, 'strategy');
    const vis = await page.evaluate(() => ({
      strategy: !document.getElementById('view-strategy').classList.contains('hidden'),
      dashboard: document.getElementById('view-dashboard').classList.contains('hidden'),
      items: [...document.querySelectorAll('.st-item')].map((b) => b.textContent.replace(/\d+/g, '').trim()),
      panels: [...document.querySelectorAll('.st-panel')].map((p) => p.id + ':' + (p.classList.contains('hidden') ? 'hidden' : 'shown'))
    }));
    chk(vis.strategy && vis.dashboard, '导航进入 Strategy，Dashboard 隐藏', 'view-strategy 可见');
    chk(JSON.stringify(vis.items) === JSON.stringify(['New chat', 'Content audit', 'Company knowledge', 'Plugins & skills']),
      '左侧四个板块名称正确', vis.items.join(' / '));
    chk(vis.panels.length === 4 && vis.panels[0].endsWith('shown') && vis.panels.slice(1).every((p) => p.endsWith('hidden')),
      '四个面板，默认只有 New chat 展开', vis.panels.join(' '));

    const geo = await page.evaluate(() => {
      const rail = document.querySelector('.st-rail').getBoundingClientRect();
      const doc = document.documentElement;
      const sizes = new Set();
      document.querySelectorAll('#view-strategy *').forEach((el) => {
        if (!el.offsetParent && el !== document.querySelector('#view-strategy')) return;
        const t = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
        if (t) sizes.add(getComputedStyle(el).fontSize);
      });
      return { rail: Math.round(rail.width), overflow: doc.scrollWidth - doc.clientWidth, sizes: [...sizes] };
    });
    chk(geo.rail >= 200 && geo.rail <= 280, '左侧栏宽度在 200–280 之间', geo.rail + 'px');
    chk(geo.overflow === 0, '页面没有横向溢出', 'overflow-x ' + geo.overflow);
    chk(geo.sizes.every((s) => FONT_OK.includes(s)), '字号只用了 12/13/14/16/20/26', geo.sizes.join(' '));

    // 对比度 / 边框 / 圆角 / 深色块
    const vis2 = await page.evaluate(() => {
      const lum = (c) => {
        const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const parse = (s) => (s.match(/[\d.]+/g) || []).slice(0, 4).map(Number);
      const bgOf = (el) => {
        let n = el;
        while (n && n !== document.documentElement) {
          const c = parse(getComputedStyle(n).backgroundColor);
          if (c.length >= 3 && (c[3] === undefined || c[3] > 0.5)) return c.slice(0, 3);
          n = n.parentElement;
        }
        return [255, 255, 255];
      };
      const ratio = (el) => {
        const fg = parse(getComputedStyle(el).color).slice(0, 3);
        const a = lum(fg), b = lum(bgOf(el));
        const [hi, lo] = a > b ? [a, b] : [b, a];
        return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
      };
      const sels = ['.st-item.is-active', '.st-head p', '.st-block', '.st-sec-head .muted', '.audit-empty p', '.skill-main p'];
      const contrasts = {};
      for (const s of sels) { const el = document.querySelector('#view-strategy ' + s); if (el) contrasts[s] = ratio(el); }

      const borderW = Math.max(...[...document.querySelectorAll('#view-strategy .card, #view-strategy .audit-row, #view-strategy .skill-row')]
        .map((el) => parseFloat(getComputedStyle(el).borderTopWidth) || 0));
      const minRadius = Math.min(...[...document.querySelectorAll('#view-strategy .card, #view-strategy .audit-row')]
        .map((el) => parseFloat(getComputedStyle(el).borderRadius) || 0));
      const dark = [...document.querySelectorAll('#view-strategy *')].filter((el) => {
        const r = el.getBoundingClientRect();
        if (r.width * r.height <= 2400) return false;
        const c = parse(getComputedStyle(el).backgroundColor);
        if (c.length < 3 || (c[3] !== undefined && c[3] < 0.5)) return false;
        return lum(c.slice(0, 3)) < 0.5;
      }).length;
      return { contrasts, borderW, minRadius, dark };
    });
    chk(Object.values(vis2.contrasts).every((v) => v >= 4.5), '文字对比度 ≥ 4.5:1', JSON.stringify(vis2.contrasts));
    chk(vis2.borderW <= 1, '卡片/列表边框 ≤ 1px', vis2.borderW + 'px');
    chk(vis2.minRadius >= 12, '卡片/列表圆角 ≥ 12px', vis2.minRadius + 'px');
    chk(vis2.dark === 0, '没有深色大色块', vis2.dark + ' 个');

    // Dashboard 的进度文案读的是同一份 blocks
    await nav(page, 'dashboard');
    const dashProg = await text(page, '#setupCards .sc-meta');
    const srv = await api(page, '/api/strategy');
    chk(dashProg === srv.blocks.done + ' of ' + srv.blocks.total + ' complete',
      'Dashboard 进度与 /api/strategy 的 blocks 一致', dashProg);

    // Dashboard 的 GSC 卡 → Strategy 的 Content audit（同一份数据，两个入口）
    await page.evaluate(() => document.querySelector('.setup-card[data-panel="gsc"]').click());
    await sleep(400);
    await click(page, '#btnGoAudit');
    await wait(page, () => !document.getElementById('view-strategy').classList.contains('hidden')
      && !document.getElementById('stPanel-audit').classList.contains('hidden'), null, 8000);
    chk(true, 'Dashboard 的 GSC 卡能跳到 Strategy 的 Content audit', '同一份数据两个入口');
    await stTab(page, 'chat');
    await nav(page, 'strategy');

    console.log('\n【二】New chat（和 Dashboard 同一份对话）');
    const chips = await page.evaluate(() => ({
      all: document.querySelectorAll('#stQuick .quick').length,
      skills: [...document.querySelectorAll('#stQuick .quick-skill')].map((b) => b.textContent.trim())
    }));
    chk(chips.all >= 8 && chips.skills.length >= 4, '快捷 chip：预设 + 技能', chips.all + ' 个，其中技能 ' + chips.skills.length);

    await setVal(page, '#stChatText', '这个月帮我排一个内容计划');
    await click(page, '#stSend');
    await wait(page, () => document.querySelectorAll('#stMessages .msg-assistant').length > 0, null, 12000);
    const ch = await page.evaluate(() => ({
      msgs: document.querySelectorAll('#stMessages .msg').length,
      reply: (document.querySelector('#stMessages .msg-assistant .msg-bubble') || {}).textContent || '',
      source: (document.getElementById('stChatSource') || {}).textContent
    }));
    chk(ch.msgs === 2 && ch.reply.length > 40, '发一条 → 用户+助手两条，回复有内容', ch.msgs + ' 条，' + ch.reply.length + ' 字');
    chk(/离线模板|·/.test(ch.source || ''), '来源明确标注（有模型时显示 provider）', ch.source);

    const chatsNow = await api(page, '/api/chats');
    const firstChat = chatsNow.chats[0];
    const stored = await api(page, '/api/chats/' + firstChat.id);
    chk(stored.chat.messages.some((m) => m.role === 'user' && m.content.includes('内容计划')),
      '消息写进了服务端的同一份 chats', firstChat.id + ' / ' + stored.chat.messages.length + ' 条');

    await nav(page, 'dashboard');
    const dashChats = await page.evaluate(() => [...document.querySelectorAll('#chatList .chat-title')].map((e) => e.textContent));
    chk(dashChats.some((t) => t === firstChat.title), 'Dashboard 的 Recent chats 里能看到刚在 Strategy 发的对话', firstChat.title);
    await nav(page, 'strategy');

    // 用技能跑一次
    const skillName = chips.skills[0].replace(/^@/, '');
    await page.evaluate((s) => document.querySelector('#stQuick .quick-skill[data-skill="' + s + '"]').click(), skillName);
    await wait(page, () => [...document.querySelectorAll('#stMessages .msg-assistant')].length >= 2, null, 12000);
    const withSkill = await page.evaluate(() => {
      const metas = [...document.querySelectorAll('#stMessages .msg-assistant .msg-meta')].map((m) => m.textContent);
      return { last: metas[metas.length - 1], n: metas.length };
    });
    chk(withSkill.last.includes('@' + skillName), '技能调用被记录（回复上标 @' + skillName + '）', withSkill.last);

    await click(page, '#stNewChat');
    await sleep(700);
    const newChat = await page.evaluate(() => ({
      opts: document.querySelectorAll('#stChatSelect option').length,
      msgs: document.querySelectorAll('#stMessages .msg').length
    }));
    chk(newChat.msgs === 0 && newChat.opts >= 2, '「＋ 新建」开空对话并进入历史下拉', newChat.opts + ' 个历史');

    console.log('\n【三】Content audit');
    await page.evaluate(async () => { await fetch('/api/gsc/disconnect', { method: 'POST' }); await window.renderStrategy(); });
    await sleep(600);
    await stTab(page, 'audit');

    // ---- GSC 真实接入：未接入 → 存凭据 → 出现授权按钮（真授权要用户自己的 Google 账号，不假装）----
    const g0 = await page.evaluate(() => ({
      pill: document.getElementById('stGscPill').textContent,
      setup: !document.getElementById('stGscSetup').classList.contains('hidden'),
      stepsHidden: document.getElementById('stGscSteps').classList.contains('hidden'),
      authHidden: document.getElementById('stGscAuth').classList.contains('hidden'),
      syncHidden: document.getElementById('stGscSync').classList.contains('hidden')
    }));
    chk(/未接入/.test(g0.pill) && g0.setup && g0.stepsHidden && g0.authHidden && g0.syncHidden,
      'GSC 未接入时：只给「开始接入」，不显示授权/同步', g0.pill + ' / ' + JSON.stringify(g0));

    await click(page, '#stGscSetup');
    await sleep(300);
    const g1 = await page.evaluate(() => ({
      steps: !document.getElementById('stGscSteps').classList.contains('hidden'),
      uri: document.getElementById('stGscUri').textContent.trim()
    }));
    chk(g1.steps && g1.uri === 'http://127.0.0.1:4319/api/gsc/callback',
      '「开始接入」展开分步引导，回调地址就是要填进 Google Cloud 的那个', g1.uri);

    await setVal(page, '#stGscId', '123-abc.apps.googleusercontent.com');
    await setVal(page, '#stGscSecret', 'GOCSPX-ui-test');
    await click(page, '#stGscSaveCreds');
    await wait(page, () => !document.getElementById('stGscAuth').classList.contains('hidden'), null, 8000);
    const g2 = await page.evaluate(() => ({
      pill: document.getElementById('stGscPill').textContent,
      auth: !document.getElementById('stGscAuth').classList.contains('hidden'),
      syncHidden: document.getElementById('stGscSync').classList.contains('hidden')
    }));
    chk(/凭据已存/.test(g2.pill) && g2.auth && g2.syncHidden,
      '存了凭据 → 出现「用 Google 授权」；没授权前不显示同步按钮', g2.pill);

    // 授权入口真的是 Google 的 OAuth 页（302 + 只读 scope），不是本地假跳转
    const authRes = await fetch(URL_ + '/api/gsc/authorize', { redirect: 'manual' });
    const loc = authRes.headers.get('location') || '';
    chk(authRes.status === 302 && /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/.test(loc)
      && /webmasters\.readonly/.test(decodeURIComponent(loc)),
      '「用 Google 授权」跳的是真的 accounts.google.com 授权页（只读 scope）', authRes.status + ' ' + loc.slice(0, 48));

    // 清掉假凭据，避免污染真实状态
    await page.evaluate(() => fetch('/api/gsc/disconnect', { method: 'POST' }));
    await sleep(300);
    const g3 = await page.evaluate(async () => {
      const r = await fetch('/api/gsc').then((x) => x.json());
      return { configured: r.gsc.configured, authorized: r.gsc.authorized };
    });
    chk(!g3.configured && !g3.authorized, '断开后凭据一并清空（不会拿旧 id 去撞 Google）', JSON.stringify(g3));

    const empty0 = await page.evaluate(() => ({
      empty: !!document.querySelector('.audit-empty'),
      rows: document.querySelectorAll('.audit-row').length
    }));
    chk(empty0.empty && empty0.rows === 0, '没有数据时显示空状态，且不编机会', '空状态');

    const tsv = [
      'Top queries\tClicks\tImpressions\tCTR\tPosition',
      'how to write a marketing brief\t12\t1800\t0.67%\t8',
      'storychief alternatives\t45\t900\t5.00%\t14',
      'ai content automation for saas\t0\t640\t0%\t23',
      'what is an editorial calendar\t1\t320\t0.31%\t61'
    ].join('\n');
    await setVal(page, '#stAuditRaw', tsv);
    await click(page, '#stAuditRun');
    await wait(page, () => document.querySelectorAll('.audit-row').length > 0, null, 12000);
    const au = await page.evaluate(() => ({
      rows: document.querySelectorAll('.audit-row').length,
      prios: [...document.querySelectorAll('.ar-prio')].map((e) => Number(e.textContent)),
      queries: [...document.querySelectorAll('.ar-q')].map((e) => e.textContent),
      stats: [...document.querySelectorAll('.audit-stat strong')].map((e) => e.textContent),
      badge: (document.getElementById('stAuditBadge') || {}).textContent,
      first: (document.querySelector('.audit-row .ar-q') || {}).textContent
    }));
    chk(au.rows >= 4, '4 行查询 → 4 个机会（阈值内全部命中）', au.rows + ' 个');
    chk(au.prios.every((v, i) => i === 0 || v <= au.prios[i - 1]), '机会按优先级降序', au.prios.join(' > '));
    chk(au.badge === String(au.rows), '左侧栏角标显示机会数', au.badge);
    chk(au.stats[0] === '4' && au.stats[1] === String(au.rows), '顶部统计：行数与机会数', au.stats.join(' / '));
    chk(/marketing brief/.test(au.first), '最高优先级是「展示大但 CTR 低」的那条', au.first);

    await page.evaluate(() => document.querySelector('.audit-row [data-act="toCampaign"]').click());
    await wait(page, () => !document.getElementById('view-content').classList.contains('hidden'), null, 10000);
    await sleep(500);
    const stAfter = await api(page, '/api/state');
    const created = stAfter.campaigns.find((c) => !baseline.campaigns.includes(c.id));
    chk(!!created && /^SEO · /.test(created.name), '「转成 campaign」真的建了 campaign 并跳到 Content', created ? created.name : '没有');
    // 到 Content 之后要能看见它，并且是选中的那一条（否则用户以为没建成）
    const inContent = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#campaignList .brief-item')];
      const hit = rows.find((e) => e.textContent.includes('SEO ·'));
      return { listed: !!hit, active: !!hit && hit.classList.contains('is-active'), total: rows.length };
    });
    chk(inContent.listed && inContent.active, 'Content 左侧能看到并选中这条新 campaign', JSON.stringify(inContent));

    await nav(page, 'strategy');
    await stTab(page, 'audit');
    // 垃圾输入 → 只给解析提示，不编机会
    await setVal(page, '#stAuditRaw', '这不是表');
    await click(page, '#stAuditRun');
    await sleep(1200);
    const junk = await page.evaluate(() => ({
      rows: document.querySelectorAll('.audit-row').length,
      title: (document.querySelector('.audit-empty h3') || {}).textContent,
      warn: (document.querySelector('.audit-empty p.muted') || {}).textContent
    }));
    chk(junk.rows === 0 && !!junk.title, '解析不了就如实说，不编数据', junk.title);

    await page.evaluate((v) => { document.getElementById('stAuditRaw').value = v; }, tsv);
    await click(page, '#stAuditRun');
    await wait(page, () => document.querySelectorAll('.audit-row').length > 0, null, 8000);
    await click(page, '#stAuditClear');
    await sleep(1200);
    const cleared = await page.evaluate(() => ({
      empty: !!document.querySelector('.audit-empty'),
      raw: document.getElementById('stAuditRaw').value,
      badge: (document.getElementById('stAuditBadge') || {}).textContent
    }));
    chk(cleared.empty && cleared.raw === '' && cleared.badge === '', '「清空数据」把导入内容和结果一起清掉', '空状态 / textarea 空 / 角标空');

    console.log('\n【四】Company knowledge（8 个 tab，同一份数据）');
    await stTab(page, 'knowledge');
    await wait(page, () => document.querySelectorAll('.kn-tab').length === 8, null, 8000);
    const kn = await page.evaluate(() => {
      const pane = document.querySelector('.kn-pane:not(.hidden)');
      const rows = [...document.querySelectorAll('#stBlocks .kn-setup-row')];
      return {
        tabs: [...document.querySelectorAll('.kn-tab')].map((b) => b.textContent.trim()),
        pane: pane ? pane.dataset.knpane : '',
        h3: (document.querySelector('.kn-h') || {}).textContent,
        cards: [...document.querySelectorAll('[data-knpane="overview"] .kn-card h4')].map((e) => e.textContent.trim()),
        fresh: (document.getElementById('btnFreshStart') || {}).textContent,
        rows: rows.length,
        done: rows.filter((r) => r.classList.contains('is-done')).length,
        count: document.getElementById('stKnDone').textContent + '/' + document.getElementById('stKnTotal').textContent,
        bar: document.getElementById('stKnBar').style.width,
        names: document.querySelectorAll('#knName').length,
        inSlot: !!document.querySelector('#stKnowledgeSlot .kn-tabs'),
        slotW: Math.round(document.getElementById('stKnowledgeSlot').getBoundingClientRect().width)
      };
    });
    chk(kn.tabs.join('|') === 'Overview|General|Target audiences|Content pillars|Brand voices|Writing style|Visual style|Knowledge files',
      '8 个 tab 顺序与文案逐字对', kn.tabs.length + ' 个');
    chk(kn.pane === 'overview', '默认打开 Overview', String(kn.pane));
    chk(kn.h3 === 'Give your AI assistant the right company context', 'Overview 标题与产品逐字一致', kn.h3);
    chk(kn.cards.join('|') === 'Sharper recommendations|More consistent writing|Grounded in your sources',
      '三张说明卡的标题对', kn.cards.join(' / '));
    chk(kn.fresh === 'Complete with AI', 'Fresh start 卡片有 Complete with AI', kn.fresh);
    chk(kn.rows === 10 && kn.done >= 7, 'Setup progress 10 项（已完成的打勾）', kn.done + '/' + kn.rows);
    chk(/^\d+\/10$/.test(kn.count) && parseInt(kn.count, 10) === kn.done, '进度数字和清单一致', kn.count + ' · 条 ' + kn.bar);
    chk(kn.names === 1 && kn.inSlot, '整块 UI 只有一份（DOM 借用，不是复制）', kn.names + ' 个 #knName');
    chk(kn.slotW > 900, '面板真的铺开在 Company knowledge 里', kn.slotW + 'px');

    // 点清单里的一项 → 跳到对应 tab 并聚焦那个输入框
    await page.evaluate(() => document.querySelector('#stBlocks [data-knkey="competitors"]').click());
    await sleep(600);
    const jump = await page.evaluate(() => ({
      tab: (document.querySelector('.kn-tab.is-on') || {}).textContent,
      pane: (document.querySelector('.kn-pane:not(.hidden)') || {}).dataset.knpane,
      focus: document.activeElement.id
    }));
    chk(jump.tab === 'General' && jump.pane === 'general' && jump.focus === 'knCompetitors',
      '清单点一项 → 跳到 General 并聚焦到那个字段', jump.tab + ' / ' + jump.focus);

    // General：新字段真的从同一份数据回填
    const gen = await page.evaluate(() => ({
      name: document.getElementById('knName').value,
      website: document.getElementById('knWebsite').value,
      desc: document.getElementById('knDescription').value,
      comp: document.getElementById('knCompetitors').value,
      custom: document.getElementById('knCustom').value,
      langs: document.getElementById('knLangList').textContent.trim(),
      gscPill: document.getElementById('knGscState').textContent,
      gscBtn: document.getElementById('btnKnGsc').textContent
    }));
    chk(gen.name === 'eSheep.ai' && gen.website.includes('esheep.ai'), 'General 回填了公司名 / 官网', gen.name + ' · ' + gen.website);
    chk(/一份素材/.test(gen.desc), '一句话定位与产品都进了 Company description', gen.desc.split('\n')[0]);
    chk(/StoryChief/.test(gen.comp), 'Competitor websites 有竞品', gen.comp.split('\n').join(' / '));
    chk(/差异化卖点/.test(gen.custom), '卖点/证据进了 Custom instructions', gen.custom.slice(0, 18));
    chk(gen.langs === 'No languages', 'Languages 初始是 No languages', gen.langs);
    chk(/Google Search Console/.test(gen.gscBtn), 'GSC 那一块有 Connect 按钮', gen.gscBtn);

    // 加一个语言 → 服务端真的变了 → 删掉
    await page.evaluate(() => {
      document.getElementById('knLangInput').value = 'English';
      document.getElementById('btnAddLanguage').click();
    });
    await wait(page, () => document.querySelectorAll('#knLangList .lang-chip').length === 1, null, 8000);
    const langAfter = await page.evaluate(async () => (await (await fetch('/api/knowledge')).json()).company.languages);
    chk(langAfter.length === 1 && langAfter[0] === 'English', 'Add language 写进了同一份存储', JSON.stringify(langAfter));
    await page.evaluate(() => document.querySelector('#knLangList .lang-x').click());
    await wait(page, () => document.getElementById('knLangList').textContent.trim() === 'No languages', null, 8000);
    chk(true, '语言能删掉（回到 No languages）', 'No languages');

    // Brand voices：弹窗建一条 → 列表 +1 → 删掉
    await page.evaluate(() => document.querySelector('.kn-tab[data-kntab="voices"]').click());
    await sleep(300);
    const vBefore = await page.evaluate(() => document.querySelectorAll('.voice-card').length);
    chk(vBefore >= 1, '已有品牌语气显示成 brand voice 卡片', vBefore + ' 条');
    await page.evaluate(() => document.getElementById('btnAddVoice').click());
    await sleep(400);
    const vModal = await page.evaluate(() => ({
      open: !document.getElementById('voiceModal').classList.contains('hidden'),
      title: document.getElementById('voiceModalTitle').textContent,
      fields: ['vName', 'vDesc', 'vUse'].every((id) => !!document.getElementById(id)),
      excerpts: document.querySelectorAll('#vExcerpts .row-item').length,
      foot: [...document.querySelectorAll('#voiceModal .kn-modal-foot .btn')].map((b) => b.textContent.trim()).join('/')
    }));
    chk(vModal.open && vModal.title === 'Create Brand Voice' && vModal.fields && vModal.excerpts >= 1,
      'Add brand voice → 打开 Create Brand Voice 弹窗（Name/Description/Use case/Excerpts）', vModal.title);
    chk(vModal.foot === 'Cancel/Create', '弹窗底部是 Cancel + Create', vModal.foot);

    await page.evaluate(() => {
      document.getElementById('vName').value = 'UI 测试语气';
      document.getElementById('vDesc').value = '测试用：先说结论，再给理由。';
      document.getElementById('vUse').value = 'social';
      document.querySelector('#vExcerpts .row-input').value = '一句示例文案。';
      document.getElementById('btnVoiceSave').click();
    });
    await wait(page, () => document.querySelectorAll('.voice-card').length === 2, null, 8000);
    const vSaved = await page.evaluate(async () => {
      const k = await (await fetch('/api/knowledge')).json();
      const v = (k.company.brandVoices || []).find((x) => x.name === 'UI 测试语气');
      return v ? { useCase: v.useCase, excerpts: v.excerpts.length, desc: v.description } : null;
    });
    chk(!!vSaved && vSaved.useCase === 'social' && vSaved.excerpts === 1, '新建的 brand voice 存下来了（用途 + 示例片段）', JSON.stringify(vSaved));

    // 名字为空要拦住
    await page.evaluate(() => {
      document.getElementById('btnAddVoice').click();
    });
    await sleep(300);
    await page.evaluate(() => document.getElementById('btnVoiceSave').click());
    await sleep(300);
    const err = await page.evaluate(() => ({
      msg: document.getElementById('vErr').textContent,
      stillOpen: !document.getElementById('voiceModal').classList.contains('hidden')
    }));
    chk(err.stillOpen && /Name/.test(err.msg), '名字空着点 Create → 当场提示，不关弹窗', err.msg);
    await page.evaluate(() => document.getElementById('btnVoiceCancel').click());
    await sleep(250);

    // 删掉测试语气，恢复原状
    await page.evaluate(() => {
      const card = [...document.querySelectorAll('.voice-card')].find((c) => c.textContent.includes('UI 测试语气'));
      card.querySelector('[data-vact="del"]').click();
    });
    await wait(page, () => document.querySelectorAll('.voice-card').length === 1, null, 8000);
    const vAfter = await page.evaluate(async () => (await (await fetch('/api/knowledge')).json()).company.brandVoices.map((v) => v.name));
    chk(vAfter.length === 1, '删除后只剩原来那条', vAfter.join(' / '));

    /* ---------- Target audiences：列表 + 长弹窗 ---------- */
    await page.evaluate(() => document.querySelector('.kn-tab[data-kntab="audiences"]').click());
    await sleep(350);
    const ta0 = await page.evaluate(() => ({
      cards: document.querySelectorAll('#audienceList .entry-card').length,
      btn: document.getElementById('btnAddAudience').textContent.trim(),
      textareas: document.querySelectorAll('#audienceList textarea, #audienceModal textarea').length
    }));
    chk(ta0.btn === 'Add target audience', 'Target audiences 是列表 + Add target audience', ta0.cards + ' 张卡');
    chk(ta0.textareas === 0, '没有自由文本大框（改成列表 + 弹窗）', String(ta0.textareas));

    await page.evaluate(() => document.getElementById('btnAddAudience').click());
    await sleep(450);
    const taM = await page.evaluate(() => {
      const m = document.getElementById('audienceModal');
      const head = m.querySelector('.kn-modal-head');
      const body = m.querySelector('.kn-modal-body');
      const rgb = String(getComputedStyle(head).backgroundColor).match(/\d+/g).slice(0, 3).map(Number);
      return {
        open: !m.classList.contains('hidden'),
        title: document.getElementById('audienceModalTitle').textContent,
        dark: (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255 < 0.25,
        headH: Math.round(head.getBoundingClientRect().height),
        scrollable: getComputedStyle(body).overflowY === 'auto',
        modalH: Math.round(m.querySelector('.kn-modal').getBoundingClientRect().height),
        vh: window.innerHeight,
        groups: [...m.querySelectorAll('.kn-group-title')].map((e) => e.textContent.trim()),
        labels: [...m.querySelectorAll('.kn-label, .field > span')].map((e) => e.textContent.trim()),
        sizePh: document.getElementById('taSize').placeholder,
        foot: [...m.querySelectorAll('.kn-modal-foot .btn')].map((e) => e.textContent.trim()).join('/')
      };
    });
    chk(taM.open && taM.title === 'Create Target Audience' && taM.dark && taM.headH >= 44,
      'Create Target Audience 弹窗（深蓝 header）', taM.headH + 'px');
    chk(taM.scrollable && taM.modalH <= taM.vh * 0.92, '长弹窗自己滚，不撑破视口', taM.modalH + 'px / ' + taM.vh + 'px');
    chk(taM.groups.join('|') === 'Audience profile|Needs and concerns', '分组标题：Audience profile / Needs and concerns');
    chk(['Audience name *', 'Description *', 'Industries', 'Job titles', 'Company size', 'Goals', 'Pain points'].every((x) => taM.labels.some((l) => l.startsWith(x))),
      '字段齐全（名字/说明/行业/职位/规模/目标/痛点）');
    chk(taM.sizePh === 'Select or type company size...' && taM.foot === 'Cancel/Create', 'Company size 提示语 + Cancel/Create');

    await page.evaluate(() => document.getElementById('btnAddGoal').click());
    await sleep(200);
    const gRows = await page.evaluate(() => document.getElementById('taGoals').children.length);
    await page.evaluate(() => document.querySelector('#taGoals .row-item:last-child .row-x').click());
    await sleep(200);
    const gRows2 = await page.evaluate(() => document.getElementById('taGoals').children.length);
    chk(gRows === 2 && gRows2 === 1, '多行条目能加能删（2 → 1）', gRows + '→' + gRows2);

    await page.evaluate(() => document.getElementById('btnAudienceSave').click());
    await sleep(250);
    const taV1 = await page.evaluate(() => ({ msg: document.getElementById('taErr').textContent, open: !document.getElementById('audienceModal').classList.contains('hidden') }));
    chk(taV1.open && /Audience name/.test(taV1.msg), '名字必填（不关弹窗）', taV1.msg.slice(0, 14));

    await page.evaluate(() => {
      document.getElementById('taName').value = 'UI 受众';
      document.getElementById('taDesc').value = 'UI 测试用';
      document.getElementById('taSize').value = '201-500';
      const fill = (id, v) => { document.getElementById(id).querySelector('.row-input').value = v; };
      fill('taIndustries', 'SaaS');
      fill('taJobTitles', 'Growth lead');
      fill('taGoals', 'grow faster');
      fill('taPains', 'no bandwidth');
      document.getElementById('btnAudienceSave').click();
    });
    await wait(page, () => document.getElementById('audienceModal').classList.contains('hidden'), null, 8000);
    const taSaved = await page.evaluate(async () => {
      const k = await (await fetch('/api/knowledge')).json();
      const a = (k.company.audiences || []).find((x) => x.name === 'UI 受众');
      const card = [...document.querySelectorAll('#audienceList .entry-card')].find((c) => c.textContent.includes('UI 受众'));
      return { a, card: card ? card.textContent : '' };
    });
    chk(!!taSaved.a && taSaved.a.industries[0] === 'SaaS' && taSaved.a.jobTitles[0] === 'Growth lead'
      && taSaved.a.companySize === '201-500' && taSaved.a.goals[0] === 'grow faster' && taSaved.a.painPoints[0] === 'no bandwidth',
      '新建受众存下了全部结构化字段', JSON.stringify(taSaved.a && taSaved.a.industries));
    chk(/SaaS/.test(taSaved.card) && /201-500/.test(taSaved.card), '卡片上能看到画像', 'SaaS / 201-500');

    /* ---------- Content pillars：列表 + 长弹窗 ---------- */
    await page.evaluate(() => document.querySelector('.kn-tab[data-kntab="pillars"]').click());
    await sleep(350);
    const cp0 = await page.evaluate(() => ({
      cards: document.querySelectorAll('#pillarList .entry-card').length,
      btn: document.getElementById('btnAddPillar').textContent.trim(),
      first: (document.querySelector('#pillarList .entry-card') || {}).innerText || ''
    }));
    chk(cp0.btn === 'Add content pillar', 'Content pillars 是列表 + Add content pillar', cp0.cards + ' 张卡');
    chk(/内容适配/.test(cp0.first) && /AI 可见性/.test(cp0.first), '老的三条支柱确实合进了这一条（Topics to include）', cp0.cards + ' 条');

    await page.evaluate(() => document.getElementById('btnAddPillar').click());
    await sleep(450);
    const cpM = await page.evaluate(() => {
      const m = document.getElementById('pillarModal');
      const rgb = String(getComputedStyle(m.querySelector('.kn-modal-head')).backgroundColor).match(/\d+/g).slice(0, 3).map(Number);
      return {
        open: !m.classList.contains('hidden'),
        title: document.getElementById('pillarModalTitle').textContent,
        dark: (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255 < 0.25,
        groups: [...m.querySelectorAll('.kn-group-title')].map((e) => e.textContent.trim()),
        pickPh: document.getElementById('cpAudPick').options[0].textContent.trim(),
        pickOpts: document.getElementById('cpAudPick').options.length,
        hints: [...m.querySelectorAll('.kn-hint')].map((e) => e.textContent.trim()),
        adds: [...m.querySelectorAll('.kn-add')].map((e) => e.textContent.trim()).join('/'),
        foot: [...m.querySelectorAll('.kn-modal-foot .btn')].map((e) => e.textContent.trim()).join('/'),
        scrollable: getComputedStyle(m.querySelector('.kn-modal-body')).overflowY === 'auto'
      };
    });
    chk(cpM.open && cpM.title === 'Create Content Pillar' && cpM.dark, 'Create Content Pillar 弹窗（深蓝 header）');
    chk(cpM.groups.join('|') === 'Strategy|Content guidance', '分组标题：Strategy / Content guidance');
    chk(cpM.pickPh === 'Select audiences this pillar is for...' && cpM.pickOpts >= 3, 'Target audiences 下拉能绑定刚建的受众', cpM.pickOpts + ' 项');
    chk(cpM.hints.some((h) => /Do not add keyword volumes/.test(h)) && cpM.hints.some((h) => /stay away from/.test(h)), '说明小字都在');
    chk(cpM.adds === 'Add search question/Add topic/Add topic/Add message' && cpM.foot === 'Cancel/Create', '四个新增按钮 + Cancel/Create');
    chk(cpM.scrollable, '长弹窗内部滚动（body 是滚动容器）', 'auto');

    await page.evaluate(() => {
      document.getElementById('cpName').value = 'UI 支柱';
      document.getElementById('cpDesc').value = 'UI 测试支柱';
      const sel = document.getElementById('cpAudPick');
      const opt = [...sel.options].find((o) => o.textContent.trim() === 'UI 受众');
      sel.value = opt.value;
      sel.dispatchEvent(new Event('change'));
      const fill = (id, v) => { document.getElementById(id).querySelector('.row-input').value = v; };
      fill('cpQuestions', 'how to ship weekly');
      fill('cpTopicsIn', '内容适配');
      fill('cpTopicsOut', 'link buying');
      fill('cpMessages', 'one source, seven channels');
      document.getElementById('btnPillarSave').click();
    });
    await wait(page, () => document.getElementById('pillarModal').classList.contains('hidden'), null, 8000);
    const cpSaved = await page.evaluate(async () => {
      const k = await (await fetch('/api/knowledge')).json();
      const x = (k.company.contentPillars || []).find((c) => c.name === 'UI 支柱');
      const card = [...document.querySelectorAll('#pillarList .entry-card')].find((c) => c.textContent.includes('UI 支柱'));
      return { x, card: card ? card.textContent : '' };
    });
    chk(!!cpSaved.x && cpSaved.x.audienceIds.length === 1 && cpSaved.x.topicsAvoid[0] === 'link buying'
      && cpSaved.x.coreMessages[0] === 'one source, seven channels',
      '新建支柱存下了全部字段（含绑定受众）', JSON.stringify(cpSaved.x && cpSaved.x.searchQuestions));
    chk(/UI 受众/.test(cpSaved.card), '卡片里能看到绑定的受众名', 'UI 受众');

    await page.evaluate((id) => {
      const card = document.querySelector('#pillarList .entry-card[data-pid="' + id + '"]');
      if (card) card.querySelector('[data-pact="del"]').click();
    }, cpSaved.x.id);
    await page.waitForFunction((id) => !document.querySelector('#pillarList .entry-card[data-pid="' + id + '"]'), { timeout: 8000, polling: 120 }, cpSaved.x.id);
    await page.evaluate(() => document.querySelector('.kn-tab[data-kntab="audiences"]').click());
    await sleep(250);
    await page.evaluate((id) => {
      const card = document.querySelector('#audienceList .entry-card[data-aid="' + id + '"]');
      if (card) card.querySelector('[data-aact="del"]').click();
    }, taSaved.a.id);
    await page.waitForFunction((id) => !document.querySelector('#audienceList .entry-card[data-aid="' + id + '"]'), { timeout: 8000, polling: 120 }, taSaved.a.id);
    const gone = await page.evaluate(async (ids) => {
      const k = await (await fetch('/api/knowledge')).json();
      return {
        a: (k.company.audiences || []).filter((x) => x.id === ids.a).length,
        p: (k.company.contentPillars || []).filter((x) => x.id === ids.p).length
      };
    }, { a: taSaved.a.id, p: cpSaved.x.id });
    chk(gone.a === 0 && gone.p === 0, '删除受众/支柱都真的删掉了', JSON.stringify(gone));

    /* ---------- Writing style：列表 + Create Writing Style 长弹窗 ---------- */
    await page.evaluate(() => document.querySelector('.kn-tab[data-kntab="writing"]').click());
    await sleep(350);
    const ws0 = await page.evaluate(() => ({
      cards: document.querySelectorAll('#writingList .entry-card').length,
      btn: document.getElementById('btnAddWriting').textContent.trim(),
      textareas: document.querySelectorAll('[data-knpane="writing"] textarea').length
    }));
    chk(ws0.btn === 'Add writing style', 'Writing style 是列表 + Add writing style', ws0.cards + ' 张卡');
    chk(ws0.textareas === 0, '自由文本大框已废弃', String(ws0.textareas));

    await page.evaluate(() => document.getElementById('btnAddWriting').click());
    await sleep(450);
    const wsM = await page.evaluate(() => {
      const m = document.getElementById('writingModal');
      const rgb = String(getComputedStyle(m.querySelector('.kn-modal-head')).backgroundColor).match(/\d+/g).slice(0, 3).map(Number);
      return {
        open: !m.classList.contains('hidden'),
        title: document.getElementById('writingModalTitle').textContent,
        dark: (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255 < 0.25,
        groups: [...m.querySelectorAll('.kn-group-title')].map((e) => e.textContent.trim()),
        switches: m.querySelectorAll('.kn-switch').length,
        descs: m.querySelectorAll('.kn-row-desc').length,
        quote: [...document.querySelector('.kn-select[data-wskey="quoteStyle"]').options].map((o) => o.textContent).join('/'),
        heading: [...document.querySelector('.kn-select[data-wskey="headingCase"]').options].map((o) => o.textContent).join('/'),
        foot: [...m.querySelectorAll('.kn-modal-foot .btn')].map((e) => e.textContent.trim()).join('/'),
        scrolls: getComputedStyle(m.querySelector('.kn-modal-body')).overflowY,
        h: Math.round(m.querySelector('.kn-modal').getBoundingClientRect().height),
        vh: window.innerHeight
      };
    });
    chk(wsM.open && wsM.title === 'Create Writing Style' && wsM.dark, 'Create Writing Style 弹窗（深蓝 header）');
    chk(wsM.groups.join('|') === 'Writing style|Punctuation|Symbols and special characters|Titles and headings',
      '四个分组：Writing style / Punctuation / Symbols / Titles');
    chk(wsM.switches === 10 && wsM.descs >= 12, '10 个开关 + 每条都有说明小字', wsM.switches + ' 开关 / ' + wsM.descs + ' 条说明');
    chk(wsM.quote === 'No preference/Double quotes/Single quotes' && wsM.heading === 'No preference/Title case/Sentence case/All caps',
      '两个下拉的选项逐字对');
    chk(wsM.foot === 'Cancel/Create' && wsM.scrolls === 'auto' && wsM.h <= wsM.vh * 0.92,
      'Cancel+Create，body 自己滚，不撑破视口', wsM.h + 'px');

    await page.evaluate(() => document.getElementById('btnWritingSave').click());
    await sleep(250);
    const wsV = await page.evaluate(() => ({ msg: document.getElementById('wsErr').textContent, open: !document.getElementById('writingModal').classList.contains('hidden') }));
    chk(wsV.open && /Name/.test(wsV.msg), '名字必填（不关弹窗）', wsV.msg.slice(0, 12));

    await page.evaluate(() => {
      document.getElementById('wsName').value = 'UI 写作规范';
      ['contractions', 'avoidFiller', 'avoidEmDashes'].forEach((k) => {
        document.querySelector('.kn-switch[data-wskey="' + k + '"]').click();
      });
      document.querySelector('.kn-select[data-wskey="quoteStyle"]').value = 'single';
      document.querySelector('.kn-select[data-wskey="headingCase"]').value = 'sentence';
      document.getElementById('wsNotes').value = 'UI 测试备注';
      document.getElementById('btnWritingSave').click();
    });
    await wait(page, () => document.getElementById('writingModal').classList.contains('hidden'), null, 8000);
    const wsSaved = await page.evaluate(async () => {
      const k = await (await fetch('/api/knowledge')).json();
      const w = (k.company.writingStyles || []).find((x) => x.name === 'UI 写作规范');
      const card = [...document.querySelectorAll('#writingList .entry-card')].find((c) => c.textContent.includes('UI 写作规范'));
      return { w, tags: card ? [...card.querySelectorAll('.tag')].map((t) => t.textContent).join('/') : '' };
    });
    chk(!!wsSaved.w && wsSaved.w.contractions && wsSaved.w.avoidFiller && wsSaved.w.avoidEmDashes
      && wsSaved.w.quoteStyle === 'single' && wsSaved.w.headingCase === 'sentence' && wsSaved.w.notes === 'UI 测试备注',
      '新建写作规范存下了开关 / 下拉 / 备注', JSON.stringify(wsSaved.w && wsSaved.w.headingCase));
    chk(wsSaved.tags === 'Contractions/No filler words/No em-dashes/Single quotes/Sentence case',
      '卡片上列出开着的规则', wsSaved.tags);

    // 供给 agent 的上下文里要能看到这套规则
    const wsBrief = await page.evaluate(async () => (await (await fetch('/api/knowledge')).json()).brief.writingStyle);
    chk(/UI 写作规范/.test(wsBrief) && /尽量用缩写/.test(wsBrief) && /引号用单引号/.test(wsBrief),
      '这套规则进了给 LLM 的上下文（brief.writingStyle）', wsBrief.slice(0, 40));

    await page.evaluate((id) => {
      const card = document.querySelector('#writingList .entry-card[data-wid="' + id + '"]');
      if (card) card.querySelector('[data-wact="del"]').click();
    }, wsSaved.w.id);
    await page.waitForFunction((id) => !document.querySelector('#writingList .entry-card[data-wid="' + id + '"]'), { timeout: 8000, polling: 120 }, wsSaved.w.id);
    const wsGone = await page.evaluate(async (id) => (await (await fetch('/api/knowledge')).json()).company.writingStyles.filter((w) => w.id === id).length, wsSaved.w.id);
    chk(wsGone === 0, '删除写作规范真的删掉了', String(wsGone));

    // Visual style：在 Strategy 侧走一遍弹窗（结构化条目 + 配色 + 参考图）
    await page.evaluate(() => document.querySelector('.kn-tab[data-kntab="visual"]').click());
    await sleep(300);
    const vsEmpty = await page.evaluate(() => ({
      head: document.querySelector('[data-knpane="visual"] .kn-h4').textContent.trim(),
      add: !!document.getElementById('btnAddVisual'),
      list: document.querySelectorAll('#visualList .entry-card').length
    }));
    chk(vsEmpty.head === 'Visual style' && vsEmpty.add, 'Visual style tab：标题 + Add visual style', vsEmpty.head + ' / ' + vsEmpty.list + ' 条');

    const imgPath = path.join(__dirname, '..', '_shots', 'ui-vs-ref.png');
    fs.mkdirSync(path.dirname(imgPath), { recursive: true });
    fs.writeFileSync(imgPath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAKUlEQVR42u3NMQ0AAAgEsQf/nlEg4dGit7ZzUxHRAQEBERERERERERERER0QHXl0E45QRJdCAAAAAElFTkSuQmCC', 'base64'));

    await click(page, '#btnAddVisual');
    await sleep(400);
    await setVal(page, '#vsName', 'UI 视觉规范');
    await setVal(page, '#vsGuide', '冷色、留白多，不要渐变（UI 测试）');
    await setVal(page, '#vsPrimary', '#123456');
    const refInput = await page.$('#vsImgInput');
    await page.evaluate(() => document.getElementById('btnVsRefUpload').click());
    await refInput.uploadFile(imgPath);
    await sleep(1600);
    const vsForm = await page.evaluate(() => ({
      thumbs: document.querySelectorAll('#vsRefs .thumb').length,
      left: document.getElementById('vsRefsLeft').textContent
    }));
    chk(vsForm.thumbs === 1 && vsForm.left === '3 of 4 left', '上传一张参考图 → 缩略图 + 剩余计数变了', vsForm.thumbs + ' / ' + vsForm.left);
    await click(page, '#btnVisualSave');
    await sleep(1400);
    const vsSaved = await page.evaluate(() => {
      const card = document.querySelector('#visualList .entry-card');
      return { cards: document.querySelectorAll('#visualList .entry-card').length, text: card ? card.textContent.replace(/\s+/g, ' ') : '' };
    });
    chk(vsSaved.cards >= 1 && vsSaved.text.includes('UI 视觉规范') && vsSaved.text.includes('#123456'),
      '新建的视觉风格出现在 Strategy 的同一份列表里', vsSaved.text.slice(0, 60));

    const vsApi = await api(page, '/api/knowledge');
    const vsRec = (vsApi.company.visualStyles || []).find((v) => v.name === 'UI 视觉规范');
    chk(!!vsRec && vsRec.primaryColor === '#123456' && vsRec.referenceIds.length === 1,
      '配色和参考图真的存进了同一份存储', vsRec ? JSON.stringify({ c: vsRec.primaryColor, n: vsRec.referenceIds.length }) : 'null');
    chk(/UI 视觉规范/.test(vsApi.brief.visualStyle) && /冷色、留白多/.test(vsApi.brief.visualStyle) && /1 张风格参考图/.test(vsApi.brief.visualStyle),
      '这套视觉规范进了生成用的上下文（brief.visualStyle）', String(vsApi.brief.visualStyle).slice(0, 40));

    // 编辑要能原样回填
    await page.evaluate(() => document.querySelector('#visualList [data-vsact="edit"]').click());
    await sleep(400);
    const vsBack = await page.evaluate(() => ({
      title: document.getElementById('visualModalTitle').textContent,
      name: document.getElementById('vsName').value,
      color: document.getElementById('vsPrimary').value,
      thumbs: document.querySelectorAll('#vsRefs .thumb').length
    }));
    chk(vsBack.title === 'Edit Visual Style' && vsBack.name === 'UI 视觉规范' && vsBack.color === '#123456' && vsBack.thumbs === 1,
      '编辑视觉风格回填了名字 / 配色 / 参考图', JSON.stringify(vsBack));
    await click(page, '#btnVisualCancel');
    await sleep(250);

    await page.evaluate(() => document.querySelector('#visualList [data-vsact="del"]').click());
    await sleep(1400);
    const vsGone = await page.evaluate(async () => (await (await fetch('/api/knowledge')).json()).company.visualStyles.filter((v) => v.name === 'UI 视觉规范').length);
    chk(vsGone === 0, '删除视觉风格真的删掉了', String(vsGone));
    fs.unlinkSync(imgPath);

    // 回到 Writing style tab —— 后面那条「同一个 DOM / tab 状态保留」的断言要它还是当前 tab
    await page.evaluate(() => document.querySelector('.kn-tab[data-kntab="writing"]').click());
    await sleep(250);

    // 回 Dashboard 打开 company 卡 → 还是同一块 DOM，tab 状态也还在
    await nav(page, 'dashboard');
    await page.evaluate(() => document.querySelector('.setup-card[data-panel="company"]').click());
    await sleep(700);
    const back = await page.evaluate(() => ({
      count: document.querySelectorAll('#knName').length,
      inPanel: !!document.querySelector('#spBody .kn-tabs'),
      tabs: document.querySelectorAll('.kn-tab').length,
      pane: (document.querySelector('.kn-pane:not(.hidden)') || {}).dataset.knpane
    }));
    chk(back.count === 1 && back.inPanel && back.tabs === 8, '回 Dashboard 打开卡片，同一块 UI 跟着回来', back.tabs + ' 个 tab');
    chk(back.pane === 'writing', '连当前 tab 都保留（不是重新渲染一份）', back.pane);
    await nav(page, 'strategy');

    console.log('\n【五】Plugins & skills');
    await stTab(page, 'plugins');
    await wait(page, () => document.querySelectorAll('#stToolsSlot .app-card').length > 0, null, 8000);
    const pl1 = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('#stToolsSlot .app-card')];
      return {
        apps: cards.length,
        logos: document.querySelectorAll('#stToolsSlot .app-logo svg').length,
        installs: document.querySelectorAll('#stToolsSlot [data-act="install"]').length,
        authorized: document.querySelectorAll('#stToolsSlot .app-card .pill-ok').length,
        w: Math.round(cards[0].getBoundingClientRect().width),
        names: cards.slice(0, 3).map((c) => c.querySelector('.app-name').textContent.trim())
      };
    });
    chk(pl1.apps >= 12 && pl1.logos === pl1.apps && pl1.installs + pl1.authorized === pl1.apps,
      '应用目录：每个应用都有图标，未安装的都显示「安装」', pl1.apps + ' 个，' + pl1.names.join(' / '));

    // 安装 → 授权（弹窗里填账号 + 令牌）
    await click(page, '#stToolsSlot .app-cell[data-tid="ahrefs"] [data-act="install"]');
    await wait(page, () => !!(document.querySelector('#stToolsSlot .app-cell[data-tid="ahrefs"] [data-act="authorize"]')), null, 8000);
    chk(true, '「安装」之后原地变成「授权」', '已安装');

    await click(page, '#stToolsSlot .app-cell[data-tid="ahrefs"] [data-act="authorize"]');
    await wait(page, () => !document.getElementById('toolModal').classList.contains('hidden'), null, 8000);
    const modal = await page.evaluate(() => ({
      title: document.getElementById('toolModalName').textContent.trim(),
      why: document.getElementById('toolModalWhy').textContent,
      hasAccount: !!document.getElementById('toolAccount'),
      hasToken: !!document.getElementById('toolToken')
    }));
    chk(modal.title === 'Ahrefs' && /开发者应用|OAuth|凭据/.test(modal.why) && modal.hasAccount && modal.hasToken,
      '授权弹窗：说清为什么不走真 OAuth，并要求账号/令牌', modal.title);

    await setVal(page, '#toolAccount', 'team@esheep.ai');
    await setVal(page, '#toolToken', 'abcdef123456');
    await click(page, '#btnToolSave');
    await wait(page, () => {
      const c = document.querySelector('#stToolsSlot .app-cell[data-tid="ahrefs"]');
      return !!(c && c.querySelector('.pill-ok'));
    }, null, 8000);
    const pl2 = await page.evaluate(() => {
      const c = document.querySelector('#stToolsSlot .app-cell[data-tid="ahrefs"]');
      return { meta: c.querySelector('.app-meta').textContent, foot: document.getElementById('toolsPill').textContent };
    });
    chk(/已授权/.test(pl2.meta) && /team@esheep\.ai/.test(pl2.meta) && /1 个已授权/.test(pl2.foot),
      '授权后卡片显示账号 + 「已授权」，底部计数同步', pl2.meta);

    // 令牌不能回显在 DOM 里
    const leaked = await page.evaluate(() => document.body.innerHTML.includes('abcdef123456'));
    chk(!leaked, '明文令牌不出现在页面里', leaked ? '漏了' : '没有');

    // 管理 → 贴数据 → 卡片上显示字数
    await click(page, '#stToolsSlot .app-cell[data-tid="ahrefs"] [data-act="manage"]');
    await sleep(200);
    await setVal(page, '[data-drawer="ahrefs"] [data-input]', '关键词 ahrefs 月搜索 1200，难度 42');
    await click(page, '#stToolsSlot .app-cell[data-tid="ahrefs"] [data-act="savedata"]');
    await wait(page, () => /已贴/.test(document.querySelector('#stToolsSlot .app-cell[data-tid="ahrefs"] .app-meta').textContent), null, 8000);
    chk(true, '管理里能贴导出数据，卡片上显示字数', '已贴');

    // 卸载 → 回到「安装」
    await click(page, '#stToolsSlot .app-cell[data-tid="ahrefs"] [data-act="uninstall"]');
    await wait(page, () => !!(document.querySelector('#stToolsSlot .app-cell[data-tid="ahrefs"] [data-act="install"]')), null, 8000);
    chk(true, '卸载后回到未安装状态', '已复位');

    // 自定义应用
    await click(page, '#btnAddApp');
    await sleep(200);
    await setVal(page, '#plName', 'UI 测试应用');
    await setVal(page, '#plUrl', 'https://bi.example.com');
    await setVal(page, '#plDesc', '自建 BI 看板');
    await click(page, '#btnAddAppSave');
    await wait(page, () => [...document.querySelectorAll('#stToolsSlot .app-card')].some((c) => c.textContent.includes('UI 测试应用')), null, 8000);
    const pl3 = await page.evaluate(() => {
      const cell = [...document.querySelectorAll('#stToolsSlot .app-cell')].find((c) => c.textContent.includes('UI 测试应用'));
      return { tag: cell.querySelector('.app-tag').textContent, act: cell.querySelector('[data-act="authorize"]').textContent };
    });
    chk(pl3.tag === '自定义' && pl3.act === '授权', '自定义应用带「自定义」标记，加完还要授权', pl3.tag + ' / ' + pl3.act);

    // 删掉它（未授权时也必须有「移除」，否则自定义应用会卡在那儿删不掉）
    await page.evaluate(() => {
      const cell = [...document.querySelectorAll('#stToolsSlot .app-cell')].find((c) => c.textContent.includes('UI 测试应用'));
      cell.querySelector('[data-act="uninstall"]').click();
    });
    await wait(page, () => ![...document.querySelectorAll('#stToolsSlot .app-card')].some((c) => c.textContent.includes('UI 测试应用')), null, 8000);
    chk(true, '自定义应用能移除', '已移除');

    chk(true, '删除技能回到 4 个内置', '4 个');

    chk(errors.length === 0, '控制台 0 报错', errors.length ? errors.slice(0, 3).join(' | ') : '0');

    await cleanup(page, baseline);
    const after = await page.evaluate(async () => {
      const [chats, kn, sk] = await Promise.all([
        fetch('/api/chats').then((r) => r.json()),
        fetch('/api/knowledge').then((r) => r.json()),
        fetch('/api/skills').then((r) => r.json())
      ]);
      return { chats: chats.chats.length, plugins: kn.tools.filter((t) => t.custom).length, skills: sk.skills.length, writingStyles: (kn.company.writingStyles || []).map((w) => w.name).join('|'), visualStyles: (kn.company.visualStyles || []).map((v) => v.name).join('|'), images: (kn.images || []).length, voices: (kn.company.brandVoices || []).length };
    });
    chk(after.plugins === baseline.plugins.length && after.skills === baseline.skills.length
      && after.writingStyles === baseline.writingStyles && after.visualStyles === baseline.visualStyles
      && after.images === baseline.images.length,
      '测试数据已清理（插件/技能/知识字段还原）', JSON.stringify(after));
  } catch (e) {
    bad('脚本异常', e.message);
  } finally {
    // 断言中途失败也要清干净，否则脏数据会让下一轮"假失败"
    // （真踩过：上一轮在 junk 输入后崩了，残留的 raw 被下一轮当成基线还原回去）
    if (page && baseline && !page.isClosed()) {
      try { await cleanup(page, baseline); } catch (_) { /* 尽力而为 */ }
    }
    await browser.close();
  }

  console.log('\n' + (fails.length ? '✗ 失败 ' + fails.length + ' / ' + checks : '✓ 全部通过 ' + checks + ' 项'));
  if (fails.length) { console.log(fails.map((f) => ' - ' + f).join('\n')); process.exit(1); }
})();
