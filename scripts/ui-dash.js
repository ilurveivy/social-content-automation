'use strict';
/**
 * Dashboard 交互验收（v4 布局）：真实点击 / 输入 / 上传文件。
 * 覆盖：四卡 → 详情面板 → 保存 → 回退；接入模型弹窗；对话与动作写回；板块切换；删除对话。
 * 用法：node scripts/ui-dash.js
 * 结束时会清理自己造的 provider / 文件 / 工具连接 / 空 campaign。
 */
const path = require('path');
const fs = require('fs');
const { restoreCompany } = require('./knowledge-restore');
const os = require('os');
const puppeteer = require(path.join(__dirname, '..', '..', 'node_modules', 'puppeteer-core'));

const URL_ = process.argv[2] || 'http://127.0.0.1:4319';
const EXE = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-first-run'] });
  const fails = [];
  const ok = (n, x) => console.log('  ok  ' + n + (x ? '  → ' + x : ''));
  const bad = (n, x) => { fails.push(n + (x ? ' → ' + x : '')); console.log('  ✗   ' + n + '  → ' + x); };
  const click = (page, sel) => page.evaluate((s) => document.querySelector(s).click(), sel);
  const setVal = (page, sel, v) => page.evaluate(([s, val]) => {
    const el = document.querySelector(s);
    el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, [sel, v]);
  const openPanel = (page, key) => page.evaluate((k) => document.querySelector(`.setup-card[data-panel="${k}"]`).click(), key);
  const waitUntil = async (page, fn, timeout, arg) => {
  await page.waitForFunction(fn, { timeout: timeout || 8000, polling: 120 }, arg);
};

const clickWhen = async (page, sel) => {
    await page.waitForFunction((s2) => !!document.querySelector(s2), { timeout: 10000, polling: 100 }, sel);
    await page.evaluate((s2) => document.querySelector(s2).click(), sel);
  };

  let tmpFile = null;
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1500, height: 1000 });
    const errors = [];
    // 删除类操作会弹 confirm —— 不接管的话渲染进程会被对话框卡住（evaluate 超时）
    page.on('dialog', (d) => d.accept());
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    // 清理上次跑残留的测试数据，保证计数断言可靠
    await page.goto(URL_, { waitUntil: 'networkidle2' });
    // 真实数据快照：测试中途挂了也要还原，否则会把用户填的知识清空
    const knSnapshot = await page.evaluate(() => fetch('/api/knowledge').then((r) => r.json()).then((k) => k.company));

    const cleaned = await page.evaluate(async () => {
      let n = 0;
      const st = await fetch('/api/state').then((r) => r.json());
      for (const cp of st.campaigns) {
        if (cp.name.includes('本月主张') || cp.name.includes('UI 测试')) {
          await fetch('/api/campaigns/' + cp.id, { method: 'DELETE' });
          n++;
        }
      }
      const pv = await fetch('/api/providers').then((r) => r.json());
      for (const x of pv.providers) {
        if (x.name.includes('UI 测试')) { await fetch('/api/providers/' + x.id, { method: 'DELETE' }); n++; }
      }
      const cs = await fetch('/api/chats').then((r) => r.json());
      for (const c of cs.chats) { await fetch('/api/chats/' + c.id, { method: 'DELETE' }); n++; }
      const kn = await fetch('/api/knowledge').then((r) => r.json());
      for (const f of kn.files) {
        if (f.name.includes('sca-pricing')) { await fetch('/api/knowledge/files/' + f.id, { method: 'DELETE' }); n++; }
      }
      // 上一轮中途挂掉可能把应用留在"已安装/已授权"，复位后计数才可靠
      for (const t of kn.tools) {
        if (t.installed) {
          await fetch('/api/tools', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'uninstall', id: t.id })
          });
          n++;
        }
      }
      return n;
    });
    if (cleaned) { await page.reload({ waitUntil: 'networkidle2' }); }
    await page.waitForSelector('.setup-card');
    await sleep(700);

    /* ---------- 0. 布局 ---------- */
    const boot = await page.evaluate(() => {
      const titles = [...document.querySelectorAll('.setup-card h3')].map((e) => e.textContent.trim());
      const boxes = [...document.querySelectorAll('.setup-card')].map((c) => c.getBoundingClientRect());
      return {
        nav: [...document.querySelectorAll('.nav-item')].map((b) => b.textContent),
        visible: [...document.querySelectorAll('.page')].filter((e) => !e.classList.contains('hidden')).map((e) => e.id),
        cards: boxes.length,
        oneRow: new Set(boxes.map((b) => Math.round(b.top))).size === 1,
        titles,
        tools: document.querySelectorAll('.app-card').length,
        quick: [...document.querySelectorAll('.quick')].map((b) => b.textContent.trim()),
        progress: (document.getElementById('knProgress') || {}).textContent,
        credits: (document.getElementById('gscCredits') || {}).textContent,
        placeholder: (document.getElementById('chatText') || {}).placeholder,
        tip: (document.getElementById('chatTip') || {}).textContent,
        right: [...document.querySelectorAll('.appbar-right .btn')].map((b) => b.textContent.trim())
      };
    });
    boot.visible.join() === 'view-dashboard' ? ok('默认进 Dashboard') : bad('默认板块不对', JSON.stringify(boot.visible));
    boot.nav.join('/') === 'Dashboard/Strategy/Planning/Content/Report' ? ok('五个板块都在', boot.nav.join(' / ')) : bad('导航不对', boot.nav.join('/'));
    boot.cards === 4 && boot.oneRow ? ok('四块配置一行四列', boot.titles.join(' · ')) : bad('配置卡布局不对', boot.cards + ' / oneRow=' + boot.oneRow);
    boot.progress && /^\d+ of \d+ complete$/.test(boot.progress) ? ok('进度文案', boot.progress) : bad('进度文案不对', boot.progress);
    boot.credits === '+2k AI credits' ? ok('积分标签', boot.credits) : bad('积分标签不对', boot.credits);
    boot.quick.length === 8 ? ok('快捷指令 8 个', boot.quick.slice(0, 3).join(' · ') + ' …') : bad('快捷指令数量不对', String(boot.quick.length));
    boot.placeholder === 'Ask to analyze your competitors' ? ok('输入框提示语', boot.placeholder) : bad('placeholder 不对', boot.placeholder);
    /\+.*files and context/.test(boot.tip) ? ok('输入框 tip', boot.tip.slice(0, 48)) : bad('tip 不对', boot.tip);
    boot.right.some((t) => t.includes('接入模型')) && boot.right.some((t) => t.includes('导出 MD')) ? ok('右上角三个按钮', boot.right.join(' / ')) : bad('右上角按钮缺', boot.right.join('/'));
    boot.tools >= 12 ? ok('应用目录 ' + boot.tools + ' 个') : bad('应用数量不对', String(boot.tools));

    /* ---------- 1. 点卡片 → 详情面板 ---------- */
    await openPanel(page, 'company');
    await sleep(400);
    const detail = await page.evaluate(() => ({
      shown: !document.getElementById('setupPanel').classList.contains('hidden'),
      cardsHidden: document.getElementById('setupCards').classList.contains('hidden'),
      title: document.getElementById('spTitle').textContent,
      tabs: [...document.querySelectorAll('.kn-tab')].map((b) => b.textContent.trim()),
      paneOn: (document.querySelector('.kn-pane:not(.hidden)') || {}).dataset.knpane,
      h3: (document.querySelector('.kn-h') || {}).textContent,
      cards: document.querySelectorAll('[data-knpane="overview"] .kn-card').length,
      rows: document.querySelectorAll('#stBlocks .kn-setup-row').length,
      done: document.querySelectorAll('#stBlocks .kn-setup-row.is-done').length,
      fresh: !!document.getElementById('btnFreshStart'),
      count: (document.getElementById('stKnDone') || {}).textContent + '/' + (document.getElementById('stKnTotal') || {}).textContent
    }));
    detail.shown && detail.cardsHidden ? ok('点卡片展开详情', detail.title) : bad('详情没展开', JSON.stringify(detail));
    detail.tabs.join('|') === 'Overview|General|Target audiences|Content pillars|Brand voices|Writing style|Visual style|Knowledge files'
      ? ok('8 个 tab 文案逐字对', detail.tabs.length + ' 个') : bad('tab 不对', detail.tabs.join('|'));
    detail.paneOn === 'overview' ? ok('默认打开 Overview') : bad('默认 tab 不对', String(detail.paneOn));
    detail.h3 === 'Give your AI assistant the right company context' ? ok('Overview 大标题逐字对') : bad('标题不对', detail.h3);
    detail.cards === 3 ? ok('三张说明卡都在') : bad('说明卡数量不对', String(detail.cards));
    detail.fresh ? ok('Fresh start 卡片 + Complete with AI') : bad('缺 Fresh start');
    // 10 项清单，两列（左列 5 个）
    detail.rows === 10 ? ok('Setup progress 10 项') : bad('清单数量不对', String(detail.rows));
    /^\d+\/10$/.test(detail.count) ? ok('进度文案 N/10 complete', detail.count) : bad('进度文案不对', detail.count);

    const cols = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#stBlocks .kn-setup-row')];
      const tops = rows.map((r) => Math.round(r.getBoundingClientRect().top));
      const lefts = rows.map((r) => Math.round(r.getBoundingClientRect().left));
      return {
        cols: new Set(lefts).size,
        left: rows.slice(0, 5).map((r) => r.querySelector('.kn-setup-label').textContent.trim()),
        right: rows.slice(5).map((r) => r.querySelector('.kn-setup-label').textContent.trim()),
        firstRowSameTop: tops[0] === tops[5],
        leftColumnOrder: tops.slice(0, 5).every((t, i) => i === 0 || t > tops[i - 1])
      };
    });
    cols.cols === 2 && cols.firstRowSameTop && cols.leftColumnOrder
      ? ok('清单是两列（先填满左列）', cols.cols + ' 列')
      : bad('清单布局不对', JSON.stringify(cols));
    cols.left.join('|') === 'Website|Brand voices|Visual style|Google Search Console|Target audiences'
      ? ok('左列 5 项顺序对') : bad('左列顺序不对', cols.left.join('|'));
    cols.right.join('|') === 'Company description|Writing style|Competitor websites|Content pillars|Knowledge files'
      ? ok('右列 5 项顺序对') : bad('右列顺序不对', cols.right.join('|'));

    /* ---------- 2. 公司知识 ---------- */
    await click(page, '.kn-tab[data-kntab="general"]');
    await sleep(300);
    const generalShown = await page.evaluate(() => {
      const s2 = document.getElementById('knWebsite').getBoundingClientRect();
      return { w: Math.round(s2.width), pane: (document.querySelector('.kn-pane:not(.hidden)') || {}).dataset.knpane };
    });
    generalShown.pane === 'general' && generalShown.w > 100
      ? ok('General tab 打开，字段可见', generalShown.w + 'px') : bad('General 没打开', JSON.stringify(generalShown));

    await setVal(page, '#knWebsite', 'https://www.esheep.ai/');
    await setVal(page, '#knName', 'eSheep.ai');
    await setVal(page, '#knDescription', '一份素材，七个渠道，规则带出处\n- 内容适配\n- 视频分镜包');
    await setVal(page, '#knCompetitors', 'StoryChief\nBlotato');
    await setVal(page, '#knCustom', '差异化卖点：\n- 规则带出处\n- 本地零依赖');
    // 其它 tab 的字段也要能写（这里是"同一份存储"的验证）
    /* --- Target audiences：列表 + 弹窗（结构化多行条目） --- */
    await click(page, '.kn-tab[data-kntab="audiences"]');
    await sleep(300);
    const aud0 = await page.evaluate(() => ({
      cards: document.querySelectorAll('#audienceList .entry-card').length,
      btn: document.getElementById('btnAddAudience').textContent.trim(),
      textareas: document.querySelectorAll('#audienceList textarea').length
    }));
    aud0.cards >= 1 ? ok('受众是列表视图', aud0.cards + ' 张卡') : bad('受众没有列表', String(aud0.cards));
    aud0.btn === 'Add target audience' ? ok('有 Add target audience 按钮') : bad('按钮文案不对', aud0.btn);
    aud0.textareas === 0 ? ok('没有自由文本大框（已改成列表 + 弹窗）') : bad('还留着文本框', String(aud0.textareas));

    await click(page, '#btnAddAudience');
    await sleep(400);
    const audModal = await page.evaluate(() => {
      const m = document.getElementById('audienceModal');
      const head = m.querySelector('.kn-modal-head');
      const body = m.querySelector('.kn-modal-body');
      const rgb = (c) => String(c).match(/\d+/g).slice(0, 3).map(Number);
      const [r, g, b] = rgb(getComputedStyle(head).backgroundColor);
      return {
        open: !m.classList.contains('hidden'),
        title: document.getElementById('audienceModalTitle').textContent,
        dark: (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.25,
        headH: Math.round(head.getBoundingClientRect().height),
        scrolls: body.scrollHeight > body.clientHeight,
        groups: [...m.querySelectorAll('.kn-group-title')].map((e) => e.textContent.trim()),
        labels: [...m.querySelectorAll('.kn-label, .field > span')].map((e) => e.textContent.trim()),
        adds: [...m.querySelectorAll('.kn-add')].map((e) => e.textContent.trim()),
        sizePh: document.getElementById('taSize').placeholder,
        sizeOpts: document.getElementById('companySizeList').children.length,
        rows: ['taIndustries', 'taJobTitles', 'taGoals', 'taPains'].every((id) => document.getElementById(id).children.length >= 1),
        foot: [...m.querySelectorAll('.kn-modal-foot .btn')].map((e) => e.textContent.trim()).join('/')
      };
    });
    audModal.open && audModal.title === 'Create Target Audience'
      ? ok('Add target audience → Create Target Audience 弹窗', audModal.title) : bad('弹窗不对', audModal.title);
    audModal.dark && audModal.headH >= 44 ? ok('弹窗 header 是深蓝色', audModal.headH + 'px') : bad('header 不是深色', JSON.stringify(audModal));
    audModal.scrolls ? ok('长弹窗内容可滚动（body 独立滚动）') : bad('弹窗不滚动，内容会溢出');
    audModal.groups.join('|') === 'Audience profile|Needs and concerns'
      ? ok('两个分组标题对（Audience profile / Needs and concerns）') : bad('分组不对', audModal.groups.join('|'));
    ['Audience name *', 'Description *', 'Industries', 'Job titles', 'Company size', 'Goals', 'Pain points'].every((x) => audModal.labels.some((l) => l.startsWith(x)))
      ? ok('7 个字段齐全（名字/说明/行业/职位/规模/目标/痛点）') : bad('字段缺', audModal.labels.join(' / '));
    audModal.adds.join('/') === 'Add industry/Add job title/Add goal/Add pain point'
      ? ok('四个新增按钮文案对') : bad('新增按钮不对', audModal.adds.join('/'));
    audModal.sizePh === 'Select or type company size...' && audModal.sizeOpts >= 5
      ? ok('Company size 可选可输（' + audModal.sizeOpts + ' 档）') : bad('Company size 不对', audModal.sizePh + ' / ' + audModal.sizeOpts);
    audModal.foot === 'Cancel/Create' ? ok('底部是 Cancel + Create') : bad('底部不对', audModal.foot);

    // 多行条目：Add 一行、删一行
    await page.evaluate(() => document.getElementById('btnAddIndustry').click());
    await sleep(200);
    const rowsAfterAdd = await page.evaluate(() => document.getElementById('taIndustries').children.length);
    await page.evaluate(() => document.querySelector('#taIndustries .row-item .row-x').click());
    await sleep(200);
    const rowsAfterDel = await page.evaluate(() => document.getElementById('taIndustries').children.length);
    rowsAfterAdd === 2 && rowsAfterDel === 1
      ? ok('Add industry / 删除图标 都能用（2 → 1 行）') : bad('行增删不对', rowsAfterAdd + '→' + rowsAfterDel);

    // 名字/说明必填
    await click(page, '#btnAudienceSave');
    await sleep(250);
    const v1 = await page.evaluate(() => ({ msg: document.getElementById('taErr').textContent, open: !document.getElementById('audienceModal').classList.contains('hidden') }));
    v1.open && /Audience name/.test(v1.msg) ? ok('名字空着 → 拦住并提示', v1.msg.slice(0, 16)) : bad('没拦住空名字', JSON.stringify(v1));
    await setVal(page, '#taName', 'UI 测试受众');
    await click(page, '#btnAudienceSave');
    await sleep(250);
    const v2 = await page.evaluate(() => ({ msg: document.getElementById('taErr').textContent, open: !document.getElementById('audienceModal').classList.contains('hidden') }));
    v2.open && /Description/.test(v2.msg) ? ok('说明空着 → 拦住并提示', v2.msg.slice(0, 16)) : bad('没拦住空说明', JSON.stringify(v2));

    // 填好保存
    await setVal(page, '#taDesc', '测试用：Series B SaaS 的增长负责人');
    await setVal(page, '#taSize', '51-200');
    await page.evaluate(() => {
      const fill = (id, v) => { document.getElementById(id).querySelector('.row-input').value = v; };
      fill('taIndustries', 'SaaS');
      fill('taJobTitles', 'Head of Content');
      fill('taGoals', 'publish weekly');
      fill('taPains', 'no time');
      document.getElementById('btnAudienceSave').click();
    });
    await waitUntil(page, () => document.getElementById('audienceModal').classList.contains('hidden'), 8000);
    const audSaved = await page.evaluate(async () => {
      const k = await (await fetch('/api/knowledge')).json();
      const a = (k.company.audiences || []).find((x) => x.name === 'UI 测试受众');
      const card = [...document.querySelectorAll('#audienceList .entry-card')].find((c) => c.textContent.includes('UI 测试受众'));
      return { a, card: card ? card.textContent : '' };
    });
    const audId = audSaved.a ? audSaved.a.id : '';
    audSaved.a && audSaved.a.industries[0] === 'SaaS' && audSaved.a.companySize === '51-200' && audSaved.a.painPoints[0] === 'no time'
      ? ok('新建受众存下了全部结构化字段', JSON.stringify(audSaved.a.industries)) : bad('受众字段没存全', JSON.stringify(audSaved.a));
    /Head of Content/.test(audSaved.card) && /51-200/.test(audSaved.card)
      ? ok('列表卡片显示画像（职位 / 公司规模）') : bad('卡片没显示画像', audSaved.card.slice(0, 60));

    /* --- Content pillars：列表 + 弹窗（能绑定受众） --- */
    await click(page, '.kn-tab[data-kntab="pillars"]');
    await sleep(300);
    const pil0 = await page.evaluate(() => ({
      cards: document.querySelectorAll('#pillarList .entry-card').length,
      btn: document.getElementById('btnAddPillar').textContent.trim()
    }));
    pil0.btn === 'Add content pillar' ? ok('有 Add content pillar 按钮', pil0.cards + ' 张卡') : bad('支柱按钮文案不对', pil0.btn);

    await click(page, '#btnAddPillar');
    await sleep(400);
    const pilModal = await page.evaluate(() => {
      const m = document.getElementById('pillarModal');
      return {
        open: !m.classList.contains('hidden'),
        title: document.getElementById('pillarModalTitle').textContent,
        groups: [...m.querySelectorAll('.kn-group-title')].map((e) => e.textContent.trim()),
        pickPh: document.getElementById('cpAudPick').options[0].textContent.trim(),
        pickOpts: document.getElementById('cpAudPick').options.length,
        hints: [...m.querySelectorAll('.kn-hint')].map((e) => e.textContent.trim()),
        foot: [...m.querySelectorAll('.kn-modal-foot .btn')].map((e) => e.textContent.trim()).join('/')
      };
    });
    pilModal.open && pilModal.title === 'Create Content Pillar'
      ? ok('Add content pillar → Create Content Pillar 弹窗') : bad('支柱弹窗不对', pilModal.title);
    pilModal.groups.join('|') === 'Strategy|Content guidance'
      ? ok('两个分组标题对（Strategy / Content guidance）') : bad('分组不对', pilModal.groups.join('|'));
    pilModal.pickPh === 'Select audiences this pillar is for...' && pilModal.pickOpts >= 3
      ? ok('Target audiences 能选刚建的受众（' + pilModal.pickOpts + ' 项）') : bad('受众下拉不对', pilModal.pickPh + ' / ' + pilModal.pickOpts);
    pilModal.hints.some((h) => /Do not add keyword volumes/.test(h)) && pilModal.hints.some((h) => /stay away from/.test(h))
      ? ok('Search questions / Topics to avoid 的说明小字都在') : bad('说明小字缺', pilModal.hints.join(' | '));
    pilModal.foot === 'Cancel/Create' ? ok('底部是 Cancel + Create') : bad('底部不对', pilModal.foot);

    await page.evaluate(() => {
      document.getElementById('cpName').value = 'UI 测试支柱';
      document.getElementById('cpDesc').value = '测试用：Educational content';
      const sel = document.getElementById('cpAudPick');
      const opt = [...sel.options].find((o) => o.textContent.includes('UI 测试受众'));
      sel.value = opt.value;
      sel.dispatchEvent(new Event('change'));
      const fill = (id, v) => { document.getElementById(id).querySelector('.row-input').value = v; };
      fill('cpQuestions', 'how to adapt one post to seven channels');
      fill('cpTopicsIn', '内容适配');
      fill('cpTopicsOut', 'link buying');
      fill('cpMessages', 'one source, seven channels');
      document.getElementById('btnPillarSave').click();
    });
    await waitUntil(page, () => document.getElementById('pillarModal').classList.contains('hidden'), 8000);
    const pilSaved = await page.evaluate(async () => {
      const k = await (await fetch('/api/knowledge')).json();
      const x = (k.company.contentPillars || []).find((c) => c.name === 'UI 测试支柱');
      const card = [...document.querySelectorAll('#pillarList .entry-card')].find((c) => c.textContent.includes('UI 测试支柱'));
      return { x, card: card ? card.textContent : '', okTags: card ? card.querySelectorAll('.tag-ok').length : 0 };
    });
    const pilId = pilSaved.x ? pilSaved.x.id : '';
    pilSaved.x && pilSaved.x.audienceIds.length === 1 && pilSaved.x.topicsAvoid[0] === 'link buying'
      ? ok('新建支柱存下了全部字段（含绑定受众）') : bad('支柱字段没存全', JSON.stringify(pilSaved.x));
    /UI 测试受众/.test(pilSaved.card) ? ok('卡片里能看到绑定的受众名') : bad('卡片没显示受众', pilSaved.card.slice(0, 60));

    // 删掉两条测试数据（按 id 删，不会被同名残留干扰）
    await page.evaluate((id) => {
      const card = document.querySelector('#pillarList .entry-card[data-pid="' + id + '"]');
      if (card) card.querySelector('[data-pact="del"]').click();
    }, pilId);
    await waitUntil(page, (id) => !document.querySelector('#pillarList .entry-card[data-pid="' + id + '"]'), 8000, pilId);
    await click(page, '.kn-tab[data-kntab="audiences"]');
    await sleep(250);
    await page.evaluate((id) => {
      const card = document.querySelector('#audienceList .entry-card[data-aid="' + id + '"]');
      if (card) card.querySelector('[data-aact="del"]').click();
    }, audId);
    await waitUntil(page, (id) => !document.querySelector('#audienceList .entry-card[data-aid="' + id + '"]'), 8000, audId);
    const purged = await page.evaluate(async (ids) => {
      const k = await (await fetch('/api/knowledge')).json();
      return {
        a: (k.company.audiences || []).filter((x) => x.id === ids.a).length,
        p: (k.company.contentPillars || []).filter((x) => x.id === ids.p).length
      };
    }, { a: audId, p: pilId });
    purged.a === 0 && purged.p === 0 ? ok('删除受众/支柱都真的删掉了') : bad('没删干净', JSON.stringify(purged));

    /* --- Writing style：列表 + Create 弹窗（开关 / 下拉） --- */
    await click(page, '.kn-tab[data-kntab="writing"]');
    await sleep(300);
    const ws0 = await page.evaluate(() => ({
      cards: document.querySelectorAll('#writingList .entry-card').length,
      btn: document.getElementById('btnAddWriting').textContent.trim(),
      textareas: document.querySelectorAll('[data-knpane="writing"] textarea').length
    }));
    ws0.cards >= 1 ? ok('写作规范是列表视图', ws0.cards + ' 张卡') : bad('写作规范没有列表', String(ws0.cards));
    ws0.btn === 'Add writing style' ? ok('有 Add writing style 按钮') : bad('按钮文案不对', ws0.btn);
    ws0.textareas === 0 ? ok('自由文本大框已经去掉') : bad('还留着文本框', String(ws0.textareas));

    await click(page, '#btnAddWriting');
    await sleep(450);
    const wsM = await page.evaluate(() => {
      const m = document.getElementById('writingModal');
      const head = m.querySelector('.kn-modal-head');
      const rgb = String(getComputedStyle(head).backgroundColor).match(/\d+/g).slice(0, 3).map(Number);
      return {
        open: !m.classList.contains('hidden'),
        title: document.getElementById('writingModalTitle').textContent,
        dark: (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255 < 0.25,
        groups: [...m.querySelectorAll('.kn-group-title')].map((e) => e.textContent.trim()),
        switches: m.querySelectorAll('.kn-switch').length,
        selects: [...m.querySelectorAll('.kn-select')].map((e) => e.dataset.wskey).join(','),
        quoteOpts: [...document.querySelector('.kn-select[data-wskey="quoteStyle"]').options].map((o) => o.textContent).join('/'),
        headingOpts: [...document.querySelector('.kn-select[data-wskey="headingCase"]').options].map((o) => o.textContent).join('/'),
        namePh: document.getElementById('wsName').placeholder,
        foot: [...m.querySelectorAll('.kn-modal-foot .btn')].map((e) => e.textContent.trim()).join('/'),
        scrolls: getComputedStyle(m.querySelector('.kn-modal-body')).overflowY,
        allOff: [...m.querySelectorAll('.kn-switch')].every((e) => e.getAttribute('aria-checked') === 'false')
      };
    });
    wsM.open && wsM.title === 'Create Writing Style' ? ok('Add writing style → Create Writing Style 弹窗') : bad('弹窗不对', wsM.title);
    wsM.dark ? ok('弹窗 header 是深蓝色（和其他三个一致）') : bad('header 不是深色');
    wsM.groups.join('|') === 'Writing style|Punctuation|Symbols and special characters|Titles and headings'
      ? ok('四个分组标题逐字对') : bad('分组不对', wsM.groups.join('|'));
    wsM.switches === 10 ? ok('10 个开关都在') : bad('开关数量不对', String(wsM.switches));
    wsM.selects === 'quoteStyle,headingCase' ? ok('两个下拉都在（引号 / 标题大小写）') : bad('下拉不对', wsM.selects);
    wsM.quoteOpts === 'No preference/Double quotes/Single quotes' ? ok('Quote style 三个选项对') : bad('引号选项不对', wsM.quoteOpts);
    wsM.headingOpts === 'No preference/Title case/Sentence case/All caps' ? ok('Heading case 四个选项对') : bad('标题选项不对', wsM.headingOpts);
    wsM.namePh === 'Ex. Blog articles' ? ok('Name 的示例提示对') : bad('示例提示不对', wsM.namePh);
    wsM.allOff ? ok('新建时开关默认全关（默认不强加规则）') : bad('默认值不对');
    wsM.foot === 'Cancel/Create' && wsM.scrolls === 'auto' ? ok('底部 Cancel+Create，body 独立滚动') : bad('底部/滚动不对', wsM.foot + ' / ' + wsM.scrolls);

    // 名字必填
    await click(page, '#btnWritingSave');
    await sleep(250);
    const wsV = await page.evaluate(() => ({ msg: document.getElementById('wsErr').textContent, open: !document.getElementById('writingModal').classList.contains('hidden') }));
    wsV.open && /Name/.test(wsV.msg) ? ok('名字空着 → 拦住并提示', wsV.msg.slice(0, 12)) : bad('没拦住空名字', JSON.stringify(wsV));

    // 开 4 个开关 + 2 个下拉 + 备注 → 保存
    await page.evaluate(() => {
      document.getElementById('wsName').value = 'UI 写作规范';
      ['contractions', 'avoidHedging', 'avoidSemicolons', 'oxfordCommas'].forEach((k) => {
        document.querySelector('.kn-switch[data-wskey="' + k + '"]').click();
      });
      document.querySelector('.kn-select[data-wskey="quoteStyle"]').value = 'double';
      document.querySelector('.kn-select[data-wskey="headingCase"]').value = 'title';
      document.getElementById('wsNotes').value = '短句为主，先说结论（UI 测试）';
      document.getElementById('btnWritingSave').click();
    });
    await waitUntil(page, () => document.getElementById('writingModal').classList.contains('hidden'), 8000);
    const wsSaved = await page.evaluate(async () => {
      const k = await (await fetch('/api/knowledge')).json();
      const w = (k.company.writingStyles || []).find((x) => x.name === 'UI 写作规范');
      const card = [...document.querySelectorAll('#writingList .entry-card')].find((c) => c.textContent.includes('UI 写作规范'));
      return { w, card: card ? card.innerText : '', tags: card ? [...card.querySelectorAll('.tag')].map((t) => t.textContent).join('/') : '' };
    });
    wsSaved.w && wsSaved.w.contractions && wsSaved.w.avoidHedging && wsSaved.w.avoidSemicolons && wsSaved.w.oxfordCommas
      && wsSaved.w.quoteStyle === 'double' && wsSaved.w.headingCase === 'title' && /UI 测试/.test(wsSaved.w.notes)
      ? ok('新建写作规范存下了全部开关 / 下拉 / 备注', JSON.stringify(wsSaved.w.headingCase)) : bad('字段没存全', JSON.stringify(wsSaved.w));
    wsSaved.tags === 'Contractions/No hedging/No semicolons/Oxford commas/Double quotes/Title case'
      ? ok('卡片上能看到开着的规则', wsSaved.tags) : bad('卡片标签不对', wsSaved.tags);
    const wsId = wsSaved.w ? wsSaved.w.id : '';

    // 编辑：开关状态要回填
    await page.evaluate((id) => {
      document.querySelector('#writingList .entry-card[data-wid="' + id + '"] [data-wact="edit"]').click();
    }, wsId);
    await sleep(450);
    const wsEdit = await page.evaluate(() => ({
      title: document.getElementById('writingModalTitle').textContent,
      save: document.getElementById('btnWritingSave').textContent,
      on: [...document.querySelectorAll('.kn-switch[aria-checked="true"]')].map((e) => e.dataset.wskey).sort().join(','),
      quote: document.querySelector('.kn-select[data-wskey="quoteStyle"]').value,
      notes: document.getElementById('wsNotes').value
    }));
    wsEdit.title === 'Edit Writing Style' && wsEdit.save === 'Save'
      ? ok('点编辑 → Edit Writing Style / Save') : bad('编辑态不对', wsEdit.title + ' / ' + wsEdit.save);
    wsEdit.on === 'avoidHedging,avoidSemicolons,contractions,oxfordCommas' && wsEdit.quote === 'double'
      ? ok('开关和下拉都回填了', wsEdit.on) : bad('回填不对', JSON.stringify(wsEdit));

    // 顺手验证「关掉一个开关再存」
    await page.evaluate(() => {
      document.querySelector('.kn-switch[data-wskey="avoidHedging"]').click();
      document.getElementById('btnWritingSave').click();
    });
    await waitUntil(page, () => document.getElementById('writingModal').classList.contains('hidden'), 8000);
    const wsOff = await page.evaluate(async (id) => {
      const k = await (await fetch('/api/knowledge')).json();
      const w = (k.company.writingStyles || []).find((x) => x.id === id);
      return w ? w.avoidHedging : null;
    }, wsId);
    wsOff === false ? ok('关掉开关能存下来') : bad('开关没关掉', String(wsOff));

    // 删掉（按 id）
    await page.evaluate((id) => {
      const card = document.querySelector('#writingList .entry-card[data-wid="' + id + '"]');
      if (card) card.querySelector('[data-wact="del"]').click();
    }, wsId);
    await waitUntil(page, (id) => !document.querySelector('#writingList .entry-card[data-wid="' + id + '"]'), 8000, wsId);
    const wsGone = await page.evaluate(async (id) => {
      const k = await (await fetch('/api/knowledge')).json();
      return (k.company.writingStyles || []).filter((x) => x.id === id).length;
    }, wsId);
    wsGone === 0 ? ok('删除写作规范真的删掉了') : bad('没删掉', String(wsGone));

    /* ---------- 2.6 Visual style：列表 + 弹窗 + 上传 + 图库 ---------- */
    await click(page, '.kn-tab[data-kntab="visual"]');
    await sleep(300);
    const vsImgBase = await page.evaluate(async () => (await (await fetch('/api/knowledge')).json()).images.map((i) => i.id));
    const vs0 = await page.evaluate(() => ({
      head: document.querySelector('[data-knpane="visual"] .kn-h4').textContent.trim(),
      sub: document.querySelector('[data-knpane="visual"] .kn-sub').textContent.trim(),
      add: (document.getElementById('btnAddVisual') || {}).textContent,
      textarea: !!document.getElementById('knVisualStyle'),
      empty: (document.getElementById('visualList') || {}).textContent || ''
    }));
    vs0.head === 'Visual style' && vs0.add === 'Add visual style' ? ok('Visual style 是「列表 + Add visual style」', vs0.add) : bad('头部不对', JSON.stringify(vs0).slice(0, 120));
    !vs0.textarea ? ok('自由文本框已经去掉（改成结构化条目）') : bad('老文本域还在');
    vs0.empty.includes('还没有视觉风格') ? ok('空列表有说明', vs0.empty.slice(0, 24)) : bad('空状态文案不对', vs0.empty.slice(0, 40));

    await click(page, '#btnAddVisual');
    await sleep(400);
    const vsm = await page.evaluate(() => {
      const m = document.querySelector('#visualModal .kn-modal');
      const body = document.querySelector('#visualModal .kn-modal-body');
      const foot = document.querySelector('#visualModal .kn-modal-foot');
      const head = document.querySelector('#visualModal .kn-modal-head');
      const r = m.getBoundingClientRect();
      return {
        open: !document.getElementById('visualModal').classList.contains('hidden'),
        title: document.getElementById('visualModalTitle').textContent,
        namePh: document.getElementById('vsName').placeholder,
        guidePh: document.getElementById('vsGuide').placeholder,
        guideDesc: document.querySelector('#visualModal .kn-field .kn-hint').textContent.trim(),
        groups: [...document.querySelectorAll('#visualModal .kn-group-title')].map((e) => e.textContent.trim()),
        groupHint: document.querySelector('#visualModal .kn-group-hint').textContent.trim(),
        primaryPh: document.getElementById('vsPrimary').placeholder,
        secondaryPh: document.getElementById('vsSecondary').placeholder,
        refsItem: document.getElementById('vsRefsLeft').textContent,
        logosItem: document.getElementById('vsLogosLeft').textContent,
        refsHint: [...document.querySelectorAll('#visualModal .kn-group-hint')].map((e) => e.textContent.trim())[1],
        logosHint: [...document.querySelectorAll('#visualModal .kn-group-hint')].map((e) => e.textContent.trim())[2],
        upLabels: [...document.querySelectorAll('#visualModal .up-row .btn')].map((b) => b.textContent.trim()),
        slots: document.querySelectorAll('#vsRefs .thumb-slot').length,
        w: Math.round(r.width), h: Math.round(r.height), vh: window.innerHeight,
        scroll: getComputedStyle(body).overflowY,
        canScroll: body.scrollHeight > body.clientHeight,
        footVisible: foot.getBoundingClientRect().bottom <= window.innerHeight + 1,
        headBg: getComputedStyle(head).backgroundColor,
        cancel: document.getElementById('btnVisualCancel').textContent,
        create: document.getElementById('btnVisualSave').textContent
      };
    });
    vsm.open && vsm.title === 'Create Visual Style' ? ok('弹窗标题 Create Visual Style', vsm.title) : bad('弹窗没开或标题不对', JSON.stringify({ open: vsm.open, title: vsm.title }));
    vsm.namePh === 'Ex. Social visuals' ? ok('Name 的示例是 Ex. Social visuals') : bad('Name 占位不对', vsm.namePh);
    /composition, mood, lighting/.test(vsm.guideDesc) ? ok('Guidelines 有说明文案') : bad('Guidelines 说明缺失', vsm.guideDesc);
    vsm.guidePh.includes('Clean, bright product photography') ? ok('Guidelines 占位用示例文案') : bad('Guidelines 占位不对', vsm.guidePh);
    JSON.stringify(vsm.groups) === JSON.stringify(['Color system', 'Style references', 'Logos']) ? ok('三组齐全（配色 / 参考图 / Logo）', vsm.groups.join(' · ')) : bad('分组不对', vsm.groups.join(','));
    vsm.groupHint === 'The brand colors that generated visuals should lean on.' ? ok('Color system 有说明', vsm.groupHint) : bad('配色说明不对', vsm.groupHint);
    vsm.primaryPh === '#000000' && vsm.secondaryPh === '#000000' ? ok('Primary / Secondary 占位是 #000000') : bad('色值占位不对', vsm.primaryPh + ' / ' + vsm.secondaryPh);
    /Up to four images/.test(vsm.refsHint) ? ok('Style references 说明 = Up to four images…') : bad('参考图说明不对', String(vsm.refsHint));
    /The logos to use as watermark/.test(vsm.logosHint) ? ok('Logos 说明 = The logos to use as watermark…') : bad('Logo 说明不对', String(vsm.logosHint));
    vsm.upLabels.join('/') === 'Upload/Library ▾/Upload/Library ▾' ? ok('每组都是 Upload + Library 两个入口') : bad('上传入口不对', vsm.upLabels.join(' / '));
    vsm.refsItem === '4 of 4 left' && vsm.logosItem === '4 of 4 left' ? ok('底部分别显示 4 of 4 left') : bad('剩余计数不对', vsm.refsItem + ' / ' + vsm.logosItem);
    vsm.slots === 4 ? ok('参考图位置是 4 个空位', vsm.slots + ' 个') : bad('空位数量不对', String(vsm.slots));
    vsm.scroll === 'auto' && vsm.canScroll && vsm.footVisible ? ok('弹窗自己滚，footer 固定可见', vsm.h + 'px / ' + vsm.vh) : bad('滚动或 footer 不对', JSON.stringify({ scroll: vsm.scroll, can: vsm.canScroll, foot: vsm.footVisible }));
    vsm.h <= vsm.vh * 0.92 ? ok('弹窗高度 ≤ 92vh', vsm.h + ' / ' + vsm.vh) : bad('弹窗太高', vsm.h + ' / ' + vsm.vh);
    vsm.headBg === 'rgb(15, 27, 51)' ? ok('深蓝标题栏和其他弹窗一致', vsm.headBg) : bad('标题栏颜色不对', vsm.headBg);
    vsm.cancel === 'Cancel' && vsm.create === 'Create' ? ok('底部是 Cancel + Create', vsm.cancel + ' / ' + vsm.create) : bad('底部按钮不对', vsm.cancel + ' / ' + vsm.create);

    // 名字必填
    await click(page, '#btnVisualSave');
    await sleep(300);
    const vsErr = await page.evaluate(() => document.getElementById('vsErr').textContent);
    /Name 必填/.test(vsErr) ? ok('名字为空被拦住', vsErr) : bad('空名字没拦住', vsErr);

    // 上传一张参考图（真文件）
    const vsImg = path.join(os.tmpdir(), 'sca-vs-ref.png');
    fs.writeFileSync(vsImg, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAKUlEQVR42u3NMQ0AAAgEsQf/nlEg4dGit7ZzUxHRAQEBERERERERERERER0QHXl0E45QRJdCAAAAAElFTkSuQmCC', 'base64'));
    await setVal(page, '#vsName', 'UI 社交配图');
    await setVal(page, '#vsGuide', 'Clean, bright product photography on a neutral background.');
    await setVal(page, '#vsPrimary', '#2f4bff');
    await page.evaluate(() => document.getElementById('btnVsRefUpload').click());
    const vsInput = await page.$('#vsImgInput');
    await vsInput.uploadFile(vsImg);
    await sleep(1800);
    const vsUp = await page.evaluate(() => ({
      thumbs: document.querySelectorAll('#vsRefs .thumb').length,
      imgs: document.querySelectorAll('#vsRefs .thumb img').length,
      left: document.getElementById('vsRefsLeft').textContent,
      big: document.querySelectorAll('#vsRefs .thumb img').length
        ? document.querySelector('#vsRefs .thumb img').naturalWidth : 0
    }));
    vsUp.thumbs === 1 && vsUp.imgs === 1 ? ok('上传一张参考图 → 出缩略图（真的能显示）', 'naturalWidth ' + vsUp.big) : bad('缩略图不对', JSON.stringify(vsUp));
    vsUp.left === '3 of 4 left' ? ok('剩余计数变成 3 of 4 left', vsUp.left) : bad('计数没变', vsUp.left);

    // Library 下拉：刚传的图能选给 Logos
    await click(page, '#btnVsLogoLib');
    await sleep(300);
    const lib = await page.evaluate(() => ({
      open: !document.getElementById('vsLogoLib').classList.contains('hidden'),
      items: [...document.querySelectorAll('#vsLogoLib [data-libpick]')].map((b) => b.textContent.trim()),
      expanded: document.getElementById('btnVsLogoLib').getAttribute('aria-expanded')
    }));
    lib.open && lib.items.length === 1 ? ok('Library 下拉列出已上传的图', lib.items.join(' / ')) : bad('图库下拉不对', JSON.stringify(lib));
    await click(page, '#vsLogoLib [data-libpick]');
    await sleep(400);
    const libPicked = await page.evaluate(() => ({
      logos: document.querySelectorAll('#vsLogos .thumb').length,
      left: document.getElementById('vsLogosLeft').textContent,
      closed: document.getElementById('vsLogoLib').classList.contains('hidden')
    }));
    libPicked.logos === 1 && libPicked.left === '3 of 4 left' && libPicked.closed
      ? ok('从图库选一张 → Logos 里多一张', libPicked.left) : bad('图库选图失败', JSON.stringify(libPicked));

    await click(page, '#btnVisualSave');
    await sleep(1600);
    const vsCard = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('#visualList .entry-card')];
      const c = cards.find((x) => x.textContent.includes('UI 社交配图'));
      return {
        cards: cards.length,
        text: c ? c.textContent.replace(/\s+/g, ' ') : '',
        thumbs: c ? c.querySelectorAll('.mini-thumbs img').length : 0,
        swatches: c ? c.querySelectorAll('.swatch').length : 0,
        pct: document.getElementById('knPct').textContent,
        modalClosed: document.getElementById('visualModal').classList.contains('hidden')
      };
    });
    vsCard.cards >= 1 && vsCard.text.includes('UI 社交配图') ? ok('新建后出现在列表里', vsCard.text.slice(0, 46)) : bad('列表里没有', JSON.stringify(vsCard).slice(0, 120));
    vsCard.swatches === 1 ? ok('卡片上显示主色', String(vsCard.swatches)) : bad('配色没显示', String(vsCard.swatches));
    vsCard.thumbs === 2 ? ok('卡片上显示参考图和 Logo 的缩略图', vsCard.thumbs + ' 张') : bad('缩略图数量不对', String(vsCard.thumbs));
    vsCard.modalClosed ? ok('存完弹窗关掉') : bad('弹窗没关');
    vsCard.pct === '80%' ? ok('加了视觉风格，公司知识进度 70% → 80%', vsCard.pct) : bad('进度没更新', vsCard.pct);

    const vsStored = await page.evaluate(async () => {
      const k = await (await fetch('/api/knowledge')).json();
      const v = (k.company.visualStyles || []).find((x) => x.name === 'UI 社交配图');
      return { v, img: (k.images || []).length, brief: k.brief.visualStyle };
    });
    !!vsStored.v && vsStored.v.primaryColor === '#2f4bff' && vsStored.v.referenceIds.length === 1 && vsStored.v.logoIds.length === 1
      ? ok('配色 / 参考图 / Logo 都存进服务端了') : bad('服务端没存全', JSON.stringify(vsStored.v));
    /UI 社交配图/.test(vsStored.brief) && /1 张风格参考图/.test(vsStored.brief) ? ok('brief.visualStyle 里能看到这套规范', String(vsStored.brief).slice(0, 40)) : bad('brief 里没有', String(vsStored.brief).slice(0, 60));

    // 编辑回填
    await click(page, '#visualList [data-vsact="edit"]');
    await sleep(450);
    const vsEdit = await page.evaluate(() => ({
      title: document.getElementById('visualModalTitle').textContent,
      name: document.getElementById('vsName').value,
      color: document.getElementById('vsPrimary').value,
      guide: document.getElementById('vsGuide').value.slice(0, 20),
      thumbs: document.querySelectorAll('#vsRefs .thumb').length,
      logos: document.querySelectorAll('#vsLogos .thumb').length,
      btn: document.getElementById('btnVisualSave').textContent
    }));
    vsEdit.title === 'Edit Visual Style' && vsEdit.name === 'UI 社交配图' && vsEdit.color === '#2f4bff'
      && vsEdit.thumbs === 1 && vsEdit.logos === 1 ? ok('编辑时名字 / 配色 / 两张图都回填了', vsEdit.btn) : bad('回填不对', JSON.stringify(vsEdit));
    // 删掉一张缩略图再存
    await click(page, '#vsLogos [data-imgdel]');
    await sleep(250);
    const vsThumbDel = await page.evaluate(() => ({ logos: document.querySelectorAll('#vsLogos .thumb').length, left: document.getElementById('vsLogosLeft').textContent }));
    vsThumbDel.logos === 0 && vsThumbDel.left === '4 of 4 left' ? ok('移除缩略图后计数回到 4 of 4 left') : bad('移除缩略图失败', JSON.stringify(vsThumbDel));
    await click(page, '#btnVisualSave');
    await sleep(1400);
    const vsAfterEdit = await page.evaluate(async () => {
      const k = await (await fetch('/api/knowledge')).json();
      const v = (k.company.visualStyles || []).find((x) => x.name === 'UI 社交配图');
      return v ? v.logoIds.length : -1;
    });
    vsAfterEdit === 0 ? ok('编辑保存后 Logo 引用被清掉（图还在图库）') : bad('编辑没生效', String(vsAfterEdit));

    // 删除 → 进度回到 70%
    await click(page, '#visualList [data-vsact="del"]');
    await sleep(1500);
    const vsDel = await page.evaluate(async () => {
      const k = await (await fetch('/api/knowledge')).json();
      return {
        left: (k.company.visualStyles || []).filter((x) => x.name === 'UI 社交配图').length,
        images: (k.images || []).length,
        pct: document.getElementById('knPct').textContent
      };
    });
    vsDel.left === 0 ? ok('删除视觉风格真的删掉了') : bad('没删掉', String(vsDel.left));
    vsDel.images >= 1 ? ok('图片留在图库里（可以给别的条目复用）', vsDel.images + ' 张') : bad('图片被一起删了', String(vsDel.images));
    vsDel.pct === '70%' ? ok('删掉后进度回到 70%') : bad('进度没回到 70%', vsDel.pct);

    // 自己传的图自己收拾（图库是共享的，不能给下一轮留脏数据）
    const vsImgClean = await page.evaluate(async (base) => {
      const k = await (await fetch('/api/knowledge')).json();
      const extra = (k.images || []).filter((i) => !base.includes(i.id));
      for (const im of extra) await fetch('/api/knowledge/image/' + im.id, { method: 'DELETE' });
      const after = await (await fetch('/api/knowledge')).json();
      return { removed: extra.length, left: after.images.length };
    }, vsImgBase);
    vsImgClean.removed === 1 ? ok('测试传的图片已经清掉（图库回到干净状态）', '剩 ' + vsImgClean.left) : bad('图片没清干净', JSON.stringify(vsImgClean));

    await click(page, '.kn-tab[data-kntab="general"]');
    await sleep(250);
    await setVal(page, '#knProof', '14/14 资产规则分 100%');
    await click(page, '#btnSaveKnowledge');
    await sleep(1300);
    // 卡片进度文案的期望值来自服务端的 building blocks（和 Strategy 同一口径）
    const bootTotal = await page.evaluate(async () => {
      const d = await (await fetch('/api/dashboard')).json();
      return d.knowledge.blocks.done + ' of ' + d.knowledge.blocks.total + ' complete';
    });
    const kn = await page.evaluate(() => ({
      pct: document.getElementById('knPct').textContent,
      missing: document.getElementById('knMissing').textContent,
      progress: document.getElementById('knProgress').textContent,
      ready: [...document.querySelectorAll('.ready.on')].map((e) => e.textContent)
    }));
    // 10 项里 Visual style / GSC / Knowledge files 还是空的 —— 这里如实期望 70%，不是硬凑 100%
    kn.pct === '70%' ? ok('公司知识 70%（三块没填，如实显示）', kn.missing) : bad('完整度不对', kn.pct + ' / ' + kn.missing);
    /Visual style/.test(kn.missing) ? ok('缺哪块说得出来', kn.missing) : bad('缺项列表不对', kn.missing);
    kn.progress === bootTotal ? ok('卡片进度跟新', kn.progress) : bad('进度没更新', kn.progress + ' 期望 ' + bootTotal);
    kn.ready.some((x) => x.includes('公司知识')) ? ok('完成度指标已就绪', kn.ready.join(' · ')) : bad('完成度没更新', kn.ready.join(','));

    /* ---------- 2.7 Knowledge files 页 ---------- */
    await click(page, '.kn-tab[data-kntab="files"]');
    await sleep(300);
    const kf0 = await page.evaluate(() => ({
      cards: [...document.querySelectorAll('.kn-files-cards .kn-card')].map((c) => ({
        h: c.querySelector('h5').textContent.trim(), p: c.querySelector('p').textContent.trim()
      })),
      title: document.querySelector('.kn-empty-title').textContent.trim(),
      copy: document.querySelector('.kn-empty-copy').textContent.trim(),
      emptyShown: !document.getElementById('knFilesEmpty').classList.contains('hidden'),
      upload: document.getElementById('btnKnUpload').textContent.trim(),
      search: !!document.getElementById('knFileSearch'),
      meta: document.getElementById('knFilesMeta').textContent,
      sub: document.querySelector('.kn-files-head .kn-sub').textContent.trim(),
      proofGone: !document.getElementById('knFilesSlot').querySelector('#knProof')
    }));
    const wantCards = [
      ['Your unfair advantage', 'Your data, cases, and expertise make content nobody else can publish.'],
      ['Private to this workspace', 'Files stay scoped to this workspace, so knowledge never leaks across customers.'],
      ['Found when it matters', 'The right fact from the right document, pulled in exactly when a task needs it.']
    ];
    kf0.cards.length === 3 && wantCards.every(([h, pp], i) => kf0.cards[i].h === h && kf0.cards[i].p === pp)
      ? ok('三栏说明卡片逐字一致', kf0.cards.map((c) => c.h).join(' · ')) : bad('说明卡片不对', JSON.stringify(kf0.cards).slice(0, 140));
    kf0.title === 'No knowledge files yet' ? ok('空白状态标题 No knowledge files yet') : bad('空状态标题不对', kf0.title);
    kf0.copy.includes('Upload internal documents — pricing, policies') && kf0.copy.includes('company-specific facts')
      ? ok('空白状态说明文案逐字一致') : bad('空状态文案不对', kf0.copy.slice(0, 60));
    kf0.upload === 'Upload files' ? ok('右上角是 Upload files', kf0.upload) : bad('上传按钮文案不对', kf0.upload);
    kf0.search ? ok('有检索框') : bad('没有检索框');
    kf0.sub.includes('without re-explaining your company in every chat') ? ok('副标题是 StoryChief 那段话') : bad('副标题不对', kf0.sub.slice(0, 40));
    kf0.proofGone ? ok('文件页不再混着「可引用的事实」（已挪到 General）') : bad('事实字段还在文件页');

    // 上传 → 列表
    const kfPath = path.join(os.tmpdir(), 'sca-knowledge-pricing.md');
    fs.writeFileSync(kfPath, '# 定价\n\nPro 版 $29/月，年付 $290。团队版按席位。\n', 'utf8');
    await page.evaluate(() => document.getElementById('btnKnUpload').click());
    const kfInput = await page.$('#knFileInput');
    await kfInput.uploadFile(kfPath);
    await sleep(1800);
    const kf1 = await page.evaluate(() => ({
      rows: document.querySelectorAll('#knFileList .kn-file-row').length,
      name: document.querySelector('#knFileList .kn-file-name') ? document.querySelector('#knFileList .kn-file-name').textContent.trim() : '',
      meta: document.querySelector('#knFileList .kn-file-meta').textContent.trim(),
      emptyHidden: document.getElementById('knFilesEmpty').classList.contains('hidden'),
      count: document.getElementById('knFilesMeta').textContent,
      pct: document.getElementById('knPct').textContent,
      view: !!document.querySelector('#knFileList [data-act="viewfile"]'),
      del: !!document.querySelector('#knFileList [data-act="delfile"]')
    }));
    kf1.rows === 1 && kf1.name === 'sca-knowledge-pricing.md' ? ok('上传后进列表（名字 / 字数 / 日期）', kf1.name + ' · ' + kf1.meta) : bad('文件没进列表', JSON.stringify(kf1).slice(0, 120));
    kf1.emptyHidden ? ok('有文件后空状态自动收起') : bad('空状态还在');
    kf1.count === '1 file' ? ok('文件数显示 1 file', kf1.count) : bad('文件数不对', kf1.count);
    kf1.view && kf1.del ? ok('每行都有查看 / 删除') : bad('行内操作缺失');
    kf1.pct === '80%' ? ok('上传知识文件后进度 70% → 80%', kf1.pct) : bad('进度没更新', kf1.pct);

    // 检索：命中正文给片段
    await setVal(page, '#knFileSearch', '年付');
    await sleep(900);
    const kf2 = await page.evaluate(() => ({
      hits: document.querySelectorAll('#knFileHits .kn-file-row').length,
      text: (document.getElementById('knFileHits').textContent || '').replace(/\s+/g, ' ').trim(),
      mainHidden: document.getElementById('knFileList').classList.contains('hidden')
    }));
    kf2.hits === 1 && kf2.text.includes('年付 $290') ? ok('检索命中正文并给片段', kf2.text.slice(0, 40)) : bad('检索不对', JSON.stringify(kf2).slice(0, 120));
    kf2.mainHidden ? ok('搜索时列表切到结果视图') : bad('搜索结果没切换');

    // 查看
    await click(page, '#knFileHits [data-act="viewfile"]');
    await sleep(800);
    const kf3 = await page.evaluate(() => ({
      open: !document.getElementById('fileView').classList.contains('hidden'),
      title: document.getElementById('fileViewTitle').textContent,
      text: document.getElementById('fileViewText').textContent
    }));
    kf3.open && kf3.title === 'sca-knowledge-pricing.md' && kf3.text.includes('$29/月') ? ok('点查看能看到原文', kf3.text.split('\n')[0]) : bad('查看弹窗不对', JSON.stringify(kf3).slice(0, 120));
    await click(page, '#btnFileViewClose');
    await sleep(300);

    // 清空搜索 → 删除 → 空状态回来
    await setVal(page, '#knFileSearch', '');
    await sleep(700);
    await click(page, '#knFileList [data-act="delfile"]');
    await sleep(1500);
    const kf4 = await page.evaluate(async () => {
      const k = await (await fetch('/api/knowledge')).json();
      return {
        files: k.files.length,
        rows: document.querySelectorAll('#knFileList .kn-file-row').length,
        emptyShown: !document.getElementById('knFilesEmpty').classList.contains('hidden'),
        count: document.getElementById('knFilesMeta').textContent,
        pct: document.getElementById('knPct').textContent
      };
    });
    kf4.files === 0 && kf4.rows === 0 ? ok('删除知识文件真的删掉了') : bad('没删掉', JSON.stringify(kf4));
    kf4.emptyShown ? ok('删完空状态回来') : bad('空状态没回来');
    kf4.count === '0 files' && kf4.pct === '70%' ? ok('文件数归零、进度回到 70%', kf4.count + ' / ' + kf4.pct) : bad('计数或进度不对', kf4.count + ' / ' + kf4.pct);

    /* ---------- 3. 上传知识文件 ---------- */
    await click(page, '#btnBackSetup');
    await sleep(300);
    const backed = await page.evaluate(() => ({
      cards: !document.getElementById('setupCards').classList.contains('hidden'),
      panel: document.getElementById('setupPanel').classList.contains('hidden')
    }));
    backed.cards && backed.panel ? ok('详情能回退到四卡') : bad('回退失效', JSON.stringify(backed));

    await openPanel(page, 'files');
    await sleep(300);
    tmpFile = path.join(os.tmpdir(), 'sca-pricing.md');
    fs.writeFileSync(tmpFile, '# 定价\n\n$29/月，年付 $290。\n\n- 免费版：3 个 campaign\n- Pro：不限\n', 'utf8');
    const input = await page.$('#fileInput');
    await input.uploadFile(tmpFile);
    await sleep(1600);
    const files = await page.evaluate(() => ({
      rows: document.querySelectorAll('.file-row').length,
      name: document.querySelector('.file-name') ? document.querySelector('.file-name').textContent : '',
      pill: document.getElementById('filesPill').textContent,
      meta: document.getElementById('filesMeta').textContent
    }));
    files.rows === 1 && files.name === 'sca-pricing.md' ? ok('知识文件上传', files.name + ' · ' + files.meta) : bad('文件没上去', JSON.stringify(files));

    /* ---------- 4. 应用：安装 → 授权 → 贴数据 ---------- */
    await click(page, '#btnBackSetup');
    await openPanel(page, 'tools');
    await sleep(500);

    await clickWhen(page, '#toolList .app-cell[data-tid="google_ads"] [data-act="install"]');
    await sleep(900);
    const inst = await page.evaluate(() => {
      const cell = document.querySelector('#toolList .app-cell[data-tid="google_ads"]');
      return { act: cell.querySelector('[data-act]').textContent.trim(), state: cell.querySelector('.app-meta').textContent.trim() };
    });
    inst.act === '授权' && /待授权/.test(inst.state) ? ok('安装后变成「授权」', inst.state) : bad('安装状态不对', JSON.stringify(inst));

    await clickWhen(page, '#toolList .app-cell[data-tid="google_ads"] [data-act="authorize"]');
    await sleep(400);
    await page.evaluate(() => {
      document.getElementById('toolAccount').value = 'ads@esheep.ai';
      document.getElementById('toolToken').value = 'dddd9999';
      document.getElementById('btnToolSave').click();
    });
    await sleep(1200);
    const auth = await page.evaluate(() => {
      const cell = document.querySelector('#toolList .app-cell[data-tid="google_ads"]');
      return {
        meta: cell.querySelector('.app-meta').textContent.trim(),
        pill: document.getElementById('toolsPill').textContent,
        cards: document.querySelectorAll('.app-card').length
      };
    });
    /已授权/.test(auth.meta) && /ads@esheep\.ai/.test(auth.meta)
      ? ok('授权后显示账号', auth.meta) : bad('授权没生效', JSON.stringify(auth));
    /1 个已授权/.test(auth.pill) ? ok('底部计数同步', auth.pill) : bad('计数不对', auth.pill);

    await clickWhen(page, '#toolList .app-cell[data-tid="google_ads"] [data-act="manage"]');
    await sleep(250);
    await page.evaluate(() => {
      const cell = document.querySelector('#toolList .app-cell[data-tid="google_ads"]');
      cell.querySelector('[data-input]').value = '渠道,花费,线索\nGoogle Ads,1200,34';
      cell.querySelector('[data-act="savedata"]').click();
    });
    await sleep(1200);
    const withData = await page.evaluate(() => document.querySelector('#toolList .app-cell[data-tid="google_ads"] .app-meta').textContent.trim());
    /已贴/.test(withData) ? ok('工具数据已保存', withData) : bad('数据没存上', withData);

    /* ---------- 5. GSC 接入（真 OAuth 入口，不是"标记已绑定"） ---------- */
    await openPanel(page, 'gsc');
    await sleep(300);
    const gsc0 = await page.evaluate(() => ({
      pill: document.getElementById('gscPill').textContent,
      setup: !document.getElementById('btnSetupGsc').classList.contains('hidden'),
      authHidden: document.getElementById('btnAuthorizeGsc').classList.contains('hidden'),
      syncHidden: document.getElementById('btnSyncGsc').classList.contains('hidden'),
      hint: document.getElementById('gscHint').textContent
    }));
    /未接入|凭据已存/.test(gsc0.pill) && gsc0.setup && gsc0.authHidden && gsc0.syncHidden
      ? ok('GSC 面板给的是真接入按钮（未授权时不显示同步）', gsc0.pill)
      : bad('GSC 状态不对', JSON.stringify(gsc0));
    /Google Cloud|授权/.test(gsc0.hint) ? ok('说明写清要你自己的 Google 凭据', '') : bad('说明缺失', gsc0.hint);

    // 按钮真的会跳 Google 授权页（这里只验服务端 302，不真的跳）
    const authProbe = await fetch(URL_ + '/api/gsc/authorize', { redirect: 'manual' });
    const loc = authProbe.headers.get('location') || '';
    authProbe.status === 302 || /configured/.test(loc)
      ? ok('授权入口存在（未配凭据时会被挡回引导）', authProbe.status)
      : bad('授权入口异常', authProbe.status);
    const gscCard = await page.evaluate(() => document.getElementById('btnConnectGscCard').textContent);
    /Connect|Connected/.test(gscCard) ? ok('卡片按钮文案正常', gscCard) : bad('卡片按钮文案不对', gscCard);
    await click(page, '#btnBackSetup');
    await sleep(300);

    /* ---------- 6. 接入模型弹窗 ---------- */
    await click(page, '#btnProviders');
    await sleep(600);
    const modalOpen = await page.evaluate(() => !document.getElementById('providerModal').classList.contains('hidden'));
    modalOpen ? ok('「接入模型」打开弹窗') : bad('弹窗没打开');
    await click(page, '#btnAddProvider');
    await sleep(250);
    await setVal(page, '#pvName', 'UI 测试网关');
    await page.select('#pvKind', 'openai');
    await setVal(page, '#pvBase', 'http://127.0.0.1:9');
    await setVal(page, '#pvKey', 'sk-test-9876');
    await setVal(page, '#pvModels', 'model-a\nmodel-b');
    await sleep(200);
    const modelOpts = await page.evaluate(() => [...document.querySelectorAll('#pvModel option')].map((o) => o.value));
    modelOpts.join() === 'model-a,model-b' ? ok('模型清单同步到下拉', modelOpts.join(' / ')) : bad('模型下拉没同步', modelOpts.join(','));
    await click(page, '#btnSaveProvider');
    await sleep(1400);
    const pv = await page.evaluate(() => ({
      rows: document.querySelectorAll('.provider').length,
      name: document.querySelector('.provider strong') ? document.querySelector('.provider strong').textContent : '',
      meta: document.querySelector('.pv-meta') ? document.querySelector('.pv-meta').textContent.replace(/\s+/g, ' ').trim() : '',
      active: !!document.querySelector('.provider.is-active'),
      status: document.getElementById('aiStatus').textContent,
      chip: document.getElementById('modeBadge').textContent
    }));
    pv.rows === 1 ? ok('provider 已接入', pv.name) : bad('provider 没加上', String(pv.rows));
    pv.meta.includes('key') && pv.meta.includes('9876') ? ok('只显示 key 后四位', pv.meta) : bad('key 掩码不对', pv.meta);
    pv.active ? ok('自动成为默认') : bad('没成为默认');
    pv.status.includes('model-a') ? ok('弹窗状态显示当前模型', pv.status) : bad('状态不对', pv.status);

    /* ---------- 7. 连通性测试：必须失败，并写回「不通」 ---------- */
    await page.evaluate(() => document.querySelector('[data-act="test"]').click());
    await sleep(1800);
    const tested = await page.evaluate(() => ({
      bad: !!document.querySelector('.provider .pill-bad'),
      toast: document.getElementById('toast').textContent
    }));
    tested.bad ? ok('测试失败如实标记「不通」') : bad('失败没有标记');
    tested.toast.length > 0 ? ok('失败原因提示', tested.toast.slice(0, 40)) : bad('没有失败提示');

    await click(page, '#btnCloseProviders');
    await sleep(400);
    const modalClosed = await page.evaluate(() => document.getElementById('providerModal').classList.contains('hidden'));
    modalClosed ? ok('弹窗能关闭') : bad('弹窗关不掉');

    /* ---------- 8. 问 agent（provider 不通 → 必须降级并说明） ---------- */
    const before = await page.evaluate(async () => (await (await fetch('/api/state')).json()).campaigns.length);
    await click(page, '#btnNewChat');
    await sleep(1000);
    await setVal(page, '#chatText', '帮我做一份推广方案');
    await click(page, '#btnSendChat');
    await page.waitForFunction(() => document.querySelectorAll('.msg-assistant').length > 0, { timeout: 25000 }).catch(() => {});
    await sleep(1400);
    const chat = await page.evaluate(() => ({
      user: document.querySelectorAll('.msg-user').length,
      bot: document.querySelectorAll('.msg-assistant').length,
      err: (document.querySelector('.msg-err') || {}).textContent || '',
      text: (document.querySelector('.msg-assistant .msg-bubble') || {}).textContent || '',
      acts: [...document.querySelectorAll('.msg-actions .act')].map((a) => a.textContent.trim()),
      rows: document.querySelectorAll('.chat-row').length
    }));
    chat.user === 1 && chat.bot === 1 ? ok('对话一来一回', chat.rows + ' 条历史') : bad('对话数量不对', JSON.stringify([chat.user, chat.bot]));
    chat.err.includes('降级原因') ? ok('降级如实说明', chat.err.slice(0, 46)) : bad('没有说明降级原因', chat.err);
    chat.text.length > 50 ? ok('回复有内容', chat.text.replace(/\s+/g, ' ').slice(0, 40)) : bad('回复太短');
    const after = await page.evaluate(async () => (await (await fetch('/api/state')).json()).campaigns.length);
    const made = chat.acts.filter((a) => a.includes('已创建')).length;
    if (chat.acts.length) ok('动作已执行并回显', chat.acts.join(' | '));
    else bad('没有执行任何动作');
    made ? (after > before ? ok('动作写回了内容库（campaign +1）', before + ' → ' + after) : bad('内容库没变化', before + ' → ' + after))
         : bad('没有创建动作', chat.acts.join(' | '));

    /* ---------- 9. 快捷指令 ---------- */
    await page.evaluate(() => document.querySelectorAll('.quick')[0].click());
    await sleep(2500);
    const quickRan = await page.evaluate(() => ({
      msgs: document.querySelectorAll('.msg-user').length,
      last: (document.querySelectorAll('.msg-user .msg-bubble')[0] || {}).textContent || ''
    }));
    quickRan.msgs >= 1 ? ok('快捷指令能直接发问', quickRan.last.slice(0, 30)) : bad('快捷指令没发出去');

    /* ---------- 10. 切板块 ---------- */
    for (const v of ['planning', 'content', 'report']) {
      await page.evaluate((x) => document.querySelector(`.nav-item[data-view="${x}"]`).click(), v);
      await sleep(700);
      const st = await page.evaluate(() => ({
        page: [...document.querySelectorAll('.page')].filter((e) => !e.classList.contains('hidden')).map((e) => e.id)[0],
        cells: document.querySelectorAll('.cal-cell').length,
        stats: document.querySelectorAll('.stat-card').length,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
      }));
      st.page === 'view-' + v ? ok(`切到 ${v}`, JSON.stringify(st).slice(0, 80)) : bad(`${v} 没显示`, st.page);
      if (st.overflow > 0) bad(`${v} 横向溢出`, st.overflow + 'px');
    }

    /* ---------- 11. 回来删对话 ---------- */
    await page.evaluate(() => document.querySelector('.nav-item[data-view="dashboard"]').click());
    await sleep(1000);
    const delBefore = await page.evaluate(() => document.querySelectorAll('.chat-row').length);
    await page.evaluate(() => {
      window.confirm = () => true;
      document.querySelector('[data-act="delchat"]').click();
    });
    await sleep(1300);
    const delAfter = await page.evaluate(() => document.querySelectorAll('.chat-row').length);
    delAfter === delBefore - 1 ? ok('删除对话', delBefore + ' → ' + delAfter) : bad('删除对话没生效', delBefore + ' → ' + delAfter);

    // 收尾：删掉测试造的数据（provider + agent 建的 campaign + 测试文件 + 工具连接）
    await page.evaluate(async () => {
      const pv = await fetch('/api/providers').then((r) => r.json());
      for (const x of pv.providers) {
        if (x.name.includes('UI 测试')) await fetch('/api/providers/' + x.id, { method: 'DELETE' });
      }
      const st = await fetch('/api/state').then((r) => r.json());
      for (const cp of st.campaigns) {
        if (cp.name.includes('本月主张')) await fetch('/api/campaigns/' + cp.id, { method: 'DELETE' });
      }
      const kn = await fetch('/api/knowledge').then((r) => r.json());
      for (const f of kn.files) {
        if (f.name.includes('sca-pricing')) await fetch('/api/knowledge/files/' + f.id, { method: 'DELETE' });
      }
      await fetch('/api/tools', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'uninstall', id: 'google_ads' })
      });
      await fetch('/api/gsc/disconnect', { method: 'POST' });
    });

    errors.length ? bad('控制台错误', errors.join(' | ')) : ok('控制台 0 错误');
    await page.screenshot({ path: path.join(__dirname, '..', '_shots', 'dash-flow.png') });
  } finally {
    // 还原 company（写完再读一次就自动刷新前端状态）
    try {
      if (typeof knSnapshot !== 'undefined' && knSnapshot) {
        await restoreCompany(URL_, knSnapshot);
      }
    } catch (_) {}
    if (tmpFile) { try { fs.unlinkSync(tmpFile); } catch (_) {} }
    await browser.close();
  }

  if (fails.length) { console.error('\n✗ Dashboard 交互验收失败 ' + fails.length + ' 项：\n - ' + fails.join('\n - ')); process.exitCode = 1; }
  else console.log('\n✓ Dashboard 交互验收全部通过');
})().catch((e) => { console.error('脚本失败：' + e.message); process.exit(1); });
