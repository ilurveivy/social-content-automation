'use strict';
/**
 * 界面验收（v4：Dashboard 对齐 StoryChief 的 agent 配置页）
 *   - 排版可量化：字号只用 6 档（12/13/14/16/20/26）、对比度 AA ≥4.5:1
 *   - 几何：四张卡必须在同一行、等宽、圆角柔和、间距一致
 *   - 结构：Dashboard（4 卡 + 8 快捷指令 + 完成度 + 对话 + 历史）/ Content 三栏 / Planning 日历
 *   - 控制台 0 错误、无横向溢出
 *
 * 用法：node scripts/shot.js [url]
 */
const path = require('path');
const fs = require('fs');
const puppeteer = require(path.join(__dirname, '..', '..', 'node_modules', 'puppeteer-core'));

const URL_ = process.argv[2] || 'http://127.0.0.1:4319';
const SHOT_DIR = path.join(__dirname, '..', '_shots');
const EXE = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
].find((p) => fs.existsSync(p));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 在浏览器里算字号 / 对比度 / 溢出；接收 [{name, sel}]，返回纯数据 */
function collect(page, pairs) {
  return page.evaluate((PAIRS) => {
    const parse = (c) => { const m = String(c).match(/rgba?\(([^)]+)\)/); if (!m) return null; const [r, g, b, a] = m[1].split(',').map(Number); return { r, g, b, a: a === undefined ? 1 : a }; };
    const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
    const bgOf = (el) => { let n = el; while (n && n !== document.documentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c.a > 0.5) return c; n = n.parentElement; } return { r: 255, g: 255, b: 255, a: 1 }; };
    const ratio = (el) => { const fg = parse(getComputedStyle(el).color); const bg = bgOf(el); if (!fg) return null; const a = lum(fg) + 0.05, b = lum(bg) + 0.05; return Math.round((Math.max(a, b) / Math.min(a, b)) * 100) / 100; };

    const contrasts = PAIRS.map(([name, sel]) => {
      const el = document.querySelector(sel);
      return el ? { name, ratio: ratio(el) } : null;
    }).filter(Boolean);

    const sizes = {};
    document.querySelectorAll('.page:not(.hidden) *').forEach((el) => {
      if (!el.textContent || !el.textContent.trim() || el.children.length) return;
      if (el.closest('.hidden')) return;
      // SVG 里的 <text> 是图标的一部分（logo 字母），按图片算，不参与字号/对比度判定
      if (el instanceof SVGElement) return;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs) sizes[fs] = (sizes[fs] || 0) + 1;
    });

    return {
      contrasts,
      sizes: Object.keys(sizes).map(Number).sort((a, b) => a - b),
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth
    };
  }, pairs);
}

/** 四张卡的几何：同一行、等宽、圆角、间距 */
function cardGeometry(page) {
  return page.evaluate(() => {
    const cards = [...document.querySelectorAll('#setupCards .setup-card')];
    const boxes = cards.map((c) => {
      const r = c.getBoundingClientRect();
      const cs = getComputedStyle(c);
      return { top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height), radius: parseFloat(cs.borderTopLeftRadius), shadow: cs.boxShadow !== 'none' };
    });
    const tops = boxes.map((b) => b.top);
    const gaps = [];
    for (let i = 1; i < boxes.length; i++) gaps.push(Math.round(boxes[i].left - (boxes[i - 1].left + boxes[i - 1].w)));
    return {
      count: boxes.length,
      sameRow: new Set(tops).size === 1,
      widths: boxes.map((b) => b.w),
      equalWidth: boxes.length > 1 && Math.max(...boxes.map((b) => b.w)) - Math.min(...boxes.map((b) => b.w)) <= 1,
      height: boxes.length ? boxes[0].h : 0,
      radii: [...new Set(boxes.map((b) => b.radius))],
      gaps: [...new Set(gaps)],
      shadows: boxes.every((b) => b.shadow)
    };
  });
}

(async () => {
  if (!EXE) throw new Error('找不到 Chrome');
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-first-run', '--force-color-profile=srgb'] });
  const fails = [];
  const need = (c, m) => { if (!c) fails.push(m); };
  const ALLOWED = [12, 13, 14, 16, 20, 26];

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1680, height: 1050, deviceScaleFactor: 1 });
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

    await page.goto(URL_, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector('.setup-card', { timeout: 15000 });
    await page.evaluate(() => document.fonts.ready);
    await sleep(800);

    /* ================= Dashboard ================= */
    const dash = await page.evaluate(() => ({
      nav: [...document.querySelectorAll('.nav-item')].map((b) => b.textContent.trim()),
      cards: document.querySelectorAll('.setup-card').length,
      cardTitles: [...document.querySelectorAll('.setup-card h3')].map((e) => e.textContent.trim()),
      cardCopy: [...document.querySelectorAll('.setup-card p')].map((e) => e.textContent.trim()),
      buttons: [...document.querySelectorAll('#setupCards .btn')].map((e) => e.textContent.trim()),
      progress: (document.getElementById('knProgress') || {}).textContent,
      credits: (document.getElementById('gscCredits') || {}).textContent,
      tools: document.querySelectorAll('#toolList .app-card').length,
      quick: [...document.querySelectorAll('.quick')].map((b) => b.textContent.trim()),
      providers: document.querySelectorAll('.provider').length,
      optionRow: [...document.querySelectorAll('.appbar-right .btn')].map((b) => b.textContent.trim()),
      placeholder: (document.getElementById('chatText') || {}).placeholder,
      tip: (document.getElementById('chatTip') || {}).textContent,
      chatsPanel: !!document.querySelector('.recent-chats'),
      ready: document.querySelectorAll('.ready').length,
      aiStatus: (document.getElementById('aiStatus') || {}).textContent,
      knPct: (document.getElementById('knPct') || {}).textContent
    }));
    const dm = await collect(page, [
      ['卡片标题', '.setup-card h3'],
      ['卡片说明', '.setup-card p'],
      ['卡片进度', '.sc-meta'],
      ['积分标签', '.sc-credit'],
      ['完成度文字', '.ready'],
      ['导航', '.nav-item'],
      ['导航当前', '.nav-item.is-active'],
      ['快捷指令', '.quick'],
      ['输入提示', '.tip'],
      ['主按钮', '.btn-primary']
    ]);
    const font = await page.evaluate(() => {
      const c = document.createElement('canvas').getContext('2d');
      const w = (f) => { c.font = '16px ' + f; return Math.round(c.measureText('mmmmmmmmmmlli 你好').width * 100) / 100; };
      return {
        body: getComputedStyle(document.body).fontFamily,
        interLoaded: [...document.fonts].filter((f) => f.family === 'Inter').map((f) => f.status),
        wInter: w('Inter'),
        wSegoe: w('"Segoe UI"')
      };
    });
    need(/^Inter/.test(font.body), '正文字体不是 Inter 打头：' + font.body);
    need(font.interLoaded.length >= 4 && font.interLoaded.every((s) => s === 'loaded'), 'Inter 没加载完：' + JSON.stringify(font.interLoaded));
    need(Math.abs(font.wInter - font.wSegoe) > 0.5, 'Inter 没有真正生效（和 Segoe UI 同宽）');
    const clipped = await page.evaluate(() => [...document.querySelectorAll('.setup-card p')].map((el, i) => ({ i, clipped: el.scrollHeight > el.clientHeight + 1, h: el.clientHeight, sh: el.scrollHeight })));
    need(!clipped.some((c) => c.clipped), '卡片文案被截断：' + JSON.stringify(clipped.filter((c) => c.clipped)));
    const geom = await cardGeometry(page);
    /* 视觉体检：浅色（无深色块）、薄边框、柔和圆角、轻阴影 */
    const visual = await page.evaluate(() => {
      const parse = (c) => { const m = String(c).match(/rgba?\(([^)]+)\)/); if (!m) return null; const [r, g, b, a] = m[1].split(',').map(Number); return { r, g, b, a: a === undefined ? 1 : a }; };
      const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
      const allow = '.btn-primary,.btn-send';
      let darkest = { v: 1, sel: '' };
      document.querySelectorAll('#view-dashboard *').forEach((el) => {
        if (el.closest(allow)) return;
        const c = parse(getComputedStyle(el).backgroundColor);
        if (!c || c.a < 0.5) return;
        const r = el.getBoundingClientRect();
        if (r.width * r.height < 2400) return;      // 小圆点/角标不算"色块"
        const v = lum(c);
        if (v < darkest.v) darkest = { v: Math.round(v * 100) / 100, sel: el.className || el.tagName };
      });
      const box = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const s = getComputedStyle(el);
        return {
          radius: parseFloat(s.borderTopLeftRadius),
          borderW: parseFloat(s.borderTopWidth),
          shadow: s.boxShadow === 'none' ? '' : s.boxShadow
        };
      };
      const shadows = [...document.querySelectorAll('#view-dashboard .setup-card, #view-dashboard .composer-card, #view-dashboard .recent-chats')]
        .map((el) => getComputedStyle(el).boxShadow);
      const blur = shadows.map((s) => { const m = s.match(/(\d+)px\s+(\d+)px\s+(\d+)px/); return m ? Number(m[3]) : 0; });
      return {
        page: getComputedStyle(document.querySelector('#view-dashboard')).backgroundColor,
        body: getComputedStyle(document.body).backgroundColor,
        darkest,
        card: box('.setup-card'),
        composer: box('.composer-card'),
        recent: box('.recent-chats'),
        maxShadowBlur: blur.length ? Math.max(...blur) : 0,
        btn: box('.btn-primary')
      };
    });
    await page.screenshot({ path: path.join(SHOT_DIR, 'dash.png') });

    need(dash.nav.join('/') === 'Dashboard/Strategy/Planning/Content/Report', '导航板块不对：' + dash.nav.join('/'));
    need(dash.cards === 4, 'agent 配置卡不是 4 块，实际 ' + dash.cards);
    need(dash.cardTitles.join('|') === 'Company knowledge|Google Search Console|Connect your tools|Knowledge files', '四张卡标题不对：' + dash.cardTitles.join('|'));
    need(/Your business, audience, competitors/.test(dash.cardCopy[0] || ''), '卡 1 文案不对：' + dash.cardCopy[0]);
    need(/What brings visitors to your website/.test(dash.cardCopy[1] || ''), '卡 2 文案不对：' + dash.cardCopy[1]);
    need(/Information and actions from the tools/.test(dash.cardCopy[2] || ''), '卡 3 文案不对：' + dash.cardCopy[2]);
    need(/Internal product details, pricing/.test(dash.cardCopy[3] || ''), '卡 4 文案不对：' + dash.cardCopy[3]);
    need(/^\d+ of \d+ complete$/.test(dash.progress || ''), '进度文案不是 "N of M complete"：' + dash.progress);
    need(dash.credits === '+2k AI credits', '积分标签不对：' + dash.credits);
    need(dash.buttons.includes('Start setup') || dash.buttons.includes('Continue setup') || dash.buttons.includes('Review'), '卡 1 按钮文案不对：' + dash.buttons.join('/'));
    need(dash.buttons.includes('Connect'), '卡 2 缺 Connect 按钮：' + dash.buttons.join('/'));
    need(dash.buttons.includes('Explore'), '卡 3 缺 Explore 按钮：' + dash.buttons.join('/'));
    need(dash.buttons.includes('Upload'), '卡 4 缺 Upload 按钮：' + dash.buttons.join('/'));
    need(dash.quick.length === 8, '快捷指令不是 8 个，实际 ' + dash.quick.length);
    need(dash.quick.join('|') === 'Get started|Research my competitors|Find content gaps|Improve my AI visibility|Plan a campaign|Repurpose my content|Refresh my content|Explore more', '快捷指令文案不对：' + dash.quick.join('|'));
    need(dash.placeholder === 'Ask to analyze your competitors', '输入框 placeholder 不对：' + dash.placeholder);
    need(/\+.*files and context.*@.*plugins.*\$/.test(dash.tip || ''), 'tip 文案不对：' + dash.tip);
    need(dash.tools >= 12, '应用目录不足 12 个，实际 ' + dash.tools);
    need(dash.chatsPanel, '没有 Recent chats 面板');
    need(dash.ready === 5, '完成度指标不是 5 个，实际 ' + dash.ready);
    need(dash.optionRow.some((t) => t.includes('接入模型')), '右上角没有「接入模型」');
    need(dash.optionRow.some((t) => t.includes('导出 MD')), '右上角没有「导出 MD」');
    need(geom.sameRow, '四张卡不在同一行');
    need(geom.equalWidth, '四张卡不等宽：' + geom.widths.join('/'));
    need(geom.height >= 190, '卡片太矮：' + geom.height);
    need(geom.radii.every((r) => r >= 12), '卡片圆角太硬：' + geom.radii.join('/'));
    need(geom.gaps.every((g) => g >= 12 && g <= 24), '卡片间距异常：' + geom.gaps.join('/'));
    need(geom.shadows, '卡片没有阴影');
    need(visual.darkest.v > 0.5, '出现深色块：' + visual.darkest.sel + ' 亮度 ' + visual.darkest.v);
    ['card', 'composer', 'recent'].forEach((k) => {
      need(visual[k] && visual[k].borderW <= 1.5, k + ' 边框太厚：' + (visual[k] && visual[k].borderW));
      need(visual[k] && visual[k].radius >= 12, k + ' 圆角太硬：' + (visual[k] && visual[k].radius));
    });
    need(visual.maxShadowBlur <= 24, '阴影太重：blur ' + visual.maxShadowBlur);
    need(visual.btn && visual.btn.radius >= 8, '主按钮圆角太硬：' + (visual.btn && visual.btn.radius));
    need(dm.overflowX <= 1, 'Dashboard 横向溢出 ' + dm.overflowX + 'px');
    const extra = dm.sizes.filter((s) => !ALLOWED.includes(s));
    need(extra.length === 0, 'Dashboard 计划外字号：' + extra.join(', '));
    dm.contrasts.forEach((c) => need(c.ratio === null || c.ratio >= 4.5, `Dashboard 对比度不足 ${c.name} = ${c.ratio}:1`));

    /* ---- 详情面板：点 Start setup 能展开，且表单还在 ---- */
    await page.evaluate(() => document.querySelector('#btnStartSetup').click());
    await sleep(500);
    const detail = await page.evaluate(() => {
      const p = document.getElementById('setupPanel');
      const r = p.getBoundingClientRect();
      const rect = (sel) => { const e = document.querySelector(sel); return e ? Math.round(e.getBoundingClientRect().width) : 0; };
      return {
        visible: !p.classList.contains('hidden'),
        cardsHidden: document.getElementById('setupCards').classList.contains('hidden'),
        title: document.getElementById('spTitle').textContent,
        tabs: document.querySelectorAll('.kn-tab').length,
        on: (document.querySelector('.kn-tab.is-on') || {}).textContent,
        h3: (document.querySelector('.kn-h') || {}).textContent,
        cardW: rect('.kn-card'),
        cards: document.querySelectorAll('[data-knpane="overview"] .kn-card').length,
        rows: document.querySelectorAll('#stBlocks .kn-setup-row').length,
        rowW: rect('#stBlocks .kn-setup-row'),
        circle: rect('#stBlocks .kn-circle'),
        freshBtn: rect('#btnFreshStart'),
        count: (document.getElementById('stKnDone') || {}).textContent + ' of ' + (document.getElementById('stKnTotal') || {}).textContent,
        height: Math.round(r.height),
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth
      };
    });
    need(detail.visible && detail.cardsHidden, '点 Start setup 没展开详情');
    need(detail.title === 'Company knowledge', '详情标题不对：' + detail.title);
    need(detail.tabs === 8 && detail.on === 'Overview', 'tab 数量/默认项不对：' + detail.tabs + ' 个，当前 ' + detail.on);
    need(detail.h3 === 'Give your AI assistant the right company context', 'Overview 标题不对：' + detail.h3);
    need(detail.cards === 3 && detail.cardW > 150, '三张说明卡没渲染好：' + detail.cards + ' 张 / ' + detail.cardW + 'px');
    need(detail.freshBtn > 100, 'Complete with AI 按钮太窄：' + detail.freshBtn + 'px');
    need(detail.rows === 10 && detail.rowW > 150, 'Setup 清单不是 10 行两列：' + detail.rows + ' 行 / 行宽 ' + detail.rowW);
    need(detail.circle >= 14 && detail.circle <= 20, '清单圆点尺寸异常：' + detail.circle + 'px');
    need(/^\d+ of 10$/.test(detail.count), '进度文案不对：' + detail.count);
    need(detail.height > 200, '详情面板太矮：' + detail.height);
    need(detail.overflowX <= 1, '详情面板横向溢出 ' + detail.overflowX + 'px');
    await page.screenshot({ path: path.join(SHOT_DIR, 'dash-setup.png') });

    /* ---- General tab：表单字段的宽度/回填 ---- */
    await page.evaluate(() => document.querySelector('.kn-tab[data-kntab="general"]').click());
    await sleep(350);
    const genForm = await page.evaluate(() => ({
      fields: ['knWebsite', 'knName', 'knDescription', 'knCompetitors', 'knCustom', 'knLangInput'].map((id) => {
        const el = document.getElementById(id);
        return el ? { id, w: Math.round(el.getBoundingClientRect().width), v: el.value.length } : { id, missing: true };
      }),
      gscPill: (document.getElementById('knGscState') || {}).textContent,
      gscBtn: (document.getElementById('btnKnGsc') || {}).textContent,
      langs: (document.getElementById('knLangList') || {}).textContent,
      pane: (document.querySelector('.kn-pane:not(.hidden)') || {}).dataset.knpane,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth
    }));
    need(genForm.pane === 'general', 'General tab 没打开：' + genForm.pane);
    need(genForm.fields.every((f) => !f.missing && f.w > 60), 'General 字段没渲染或宽度异常：' + JSON.stringify(genForm.fields));
    need(genForm.fields.find((f) => f.id === 'knName').v > 0, '公司名是空的 —— 数据被清掉了？');
    need(/Google Search Console/.test(genForm.gscBtn), 'General 里没有 Connect Google Search Console：' + genForm.gscBtn);
    need(genForm.langs.trim() === 'No languages', 'Languages 初始文案不对：' + genForm.langs);
    need(genForm.overflowX <= 1, 'General 横向溢出 ' + genForm.overflowX + 'px');
    await page.screenshot({ path: path.join(SHOT_DIR, 'dash-setup-general.png') });
    await page.evaluate(() => document.querySelector('.kn-tab[data-kntab="overview"]').click());
    await sleep(250);
    await page.evaluate(() => document.getElementById('btnBackSetup').click());
    await sleep(300);

    /* ---- 顶部接入模型弹窗 ---- */
    await page.evaluate(() => document.getElementById('btnProviders').click());
    await sleep(500);
    const modal = await page.evaluate(() => {
      const m = document.getElementById('providerModal');
      return {
        visible: !m.classList.contains('hidden'),
        hasList: !!document.getElementById('providerList'),
        hasForm: !!document.getElementById('providerForm'),
        addBtn: (document.getElementById('btnAddProvider') || {}).textContent,
        w: Math.round(m.querySelector('.modal-card').getBoundingClientRect().width)
      };
    });
    need(modal.visible, '接入模型弹窗没打开');
    need(modal.hasList && modal.hasForm, '弹窗里缺 provider 列表或表单');
    need(/接入模型/.test(modal.addBtn || ''), '弹窗里缺「＋ 接入模型」：' + modal.addBtn);
    need(modal.w >= 600, '弹窗太窄：' + modal.w);
    await page.screenshot({ path: path.join(SHOT_DIR, 'dash-provider.png') });
    await page.evaluate(() => document.getElementById('btnCloseProviders').click());
    await sleep(300);

    /* ================= Content（列表页 v11） ================= */
    await page.evaluate(() => document.querySelector('.nav-item[data-view="content"]').click());
    await page.waitForSelector('.cl-row', { timeout: 15000 });
    await sleep(600);

    const list = await page.evaluate(() => {
      const box = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), left: Math.round(r.left), right: Math.round(r.right) };
      };
      const cs = (sel, prop) => {
        const el = document.querySelector(sel);
        return el ? getComputedStyle(el)[prop] : null;
      };
      return {
        nav: box('.cl-nav'),
        main: box('.cl-main'),
        toolbar: box('.cl-toolbar'),
        foot: box('.cl-foot'),
        row: box('.cl-row'),
        rowH: document.querySelectorAll('.cl-row').length,
        navBorder: parseFloat(cs('.cl-nav', 'borderRightWidth')),
        rowBorder: parseFloat(cs('.cl-td', 'borderBottomWidth')),
        titleSize: parseFloat(cs('.cl-title', 'fontSize')),
        thSize: parseFloat(cs('.cl-th', 'fontSize')),
        subSize: parseFloat(cs('.cl-sub', 'fontSize')),
        groupSize: parseFloat(cs('.cl-group-head', 'fontSize')),
        rangeSize: parseFloat(cs('.cl-range', 'fontSize')),
        pillR: parseFloat(cs('.cl-pill', 'borderRadius')),
        pillH: box('.cl-pill') ? box('.cl-pill').h : 0,
        navTitleSize: parseFloat(cs('.cl-nav-title', 'fontSize')),
        quickH: box('.cl-quick') ? box('.cl-quick').h : 0,
        quickR: parseFloat(cs('.cl-quick', 'borderRadius')),
        btnH: box('#btnClCreate') ? box('#btnClCreate').h : 0,
        sizes: (() => {
          const set = new Set();
          document.querySelectorAll('#contentList *').forEach((el) => {
            if (!el.offsetParent) return;
            const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
            if (hasText) set.add(parseFloat(getComputedStyle(el).fontSize));
          });
          return [...set];
        })(),
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        overflowY: document.documentElement.scrollHeight - document.documentElement.clientHeight
      };
    });

    const listCm = await collect(page, [
      ['导航分组', '.cl-group-head'],
      ['导航子项', '.cl-sub'],
      ['表头', '.cl-th-label'],
      ['表格正文', '.cl-title'],
      ['分页区间', '.cl-range']
    ]);

    await page.screenshot({ path: path.join(SHOT_DIR, 'content-list.png') });

    need(list.nav && list.nav.w >= 200 && list.nav.w <= 280, '左侧树宽度异常：' + (list.nav && list.nav.w));
    need(list.nav.top === list.main.top, '左树和主区没对齐');
    need(list.toolbar.h >= 48 && list.toolbar.h <= 72, '工具条高度异常：' + list.toolbar.h);
    need(list.foot.h >= 44 && list.foot.h <= 64, '分页条高度异常：' + list.foot.h);
    need(list.row.h >= 32 && list.row.h <= 56, '行高异常：' + list.row.h);
    need(list.rowH >= 3, '列表行数太少：' + list.rowH);
    need(list.navBorder <= 1, '左树分隔线太粗：' + list.navBorder);
    need(list.rowBorder <= 1, '行分隔线太粗：' + list.rowBorder);
    need(list.titleSize === 13, '标题字号应该是 13px，实际 ' + list.titleSize);
    need(list.thSize === 12, '表头字号应该是 12px，实际 ' + list.thSize);
    need(list.subSize === 13, '导航子项字号应该是 13px，实际 ' + list.subSize);
    need(list.groupSize === 13, '导航分组字号应该是 13px，实际 ' + list.groupSize);
    need(list.navTitleSize === 14, '左树标题字号应该是 14px，实际 ' + list.navTitleSize);
    need(list.rangeSize === 13, '分页字号应该是 13px，实际 ' + list.rangeSize);
    need(list.pillR >= 6, '状态胶囊圆角异常：' + list.pillR);
    need(list.pillH >= 18 && list.pillH <= 26, '状态胶囊高度异常：' + list.pillH);
    need(list.quickH >= 30 && list.quickH <= 38, '快速搜索高度异常：' + list.quickH);
    need(list.quickR >= 6, '快速搜索圆角太小：' + list.quickR);
    need(list.btnH >= 30 && list.btnH <= 38, '工具条按钮高度异常：' + list.btnH);
    need(list.overflowX <= 1, 'Content 列表横向溢出 ' + list.overflowX + 'px');
    need(list.overflowY <= 1, 'Content 列表纵向溢出 ' + list.overflowY + 'px');
    const listExtra = list.sizes.filter((s2) => !ALLOWED.includes(s2));
    need(listExtra.length === 0, 'Content 列表计划外字号：' + listExtra.join(', '));
    listCm.contrasts.forEach((c) => need(c.ratio === null || c.ratio >= 4.5, '列表对比度不足 ' + c.name + ' = ' + c.ratio + ':1'));

    // 列配置面板也要看一眼
    await page.evaluate(() => document.getElementById('btnClColumns').click());
    await sleep(300);
    const colPanel = await page.evaluate(() => {
      const el = document.getElementById('clColumnsPanel');
      const r = el.getBoundingClientRect();
      return { shown: !el.classList.contains('hidden'), w: Math.round(r.width), radius: parseFloat(getComputedStyle(el).borderRadius), checks: el.querySelectorAll('input[type=checkbox]').length };
    });
    await page.screenshot({ path: path.join(SHOT_DIR, 'content-columns.png') });
    await page.evaluate(() => document.body.click());
    await sleep(200);
    need(colPanel.shown && colPanel.checks === 16, '列配置面板不对：' + JSON.stringify(colPanel));
    need(colPanel.w >= 200, '列配置面板太窄：' + colPanel.w);
    need(colPanel.radius >= 8, '列配置面板圆角太小：' + colPanel.radius);

    /* ================= Content（编辑器） ================= */
    // v12 之后 article 行会进新的三 Tab 编辑器，所以这里明确挑一条非 article 的进老编辑器
    const otherId = await page.evaluate(async () => {
      const r = await fetch('/api/content?group=content&size=100').then((x) => x.json());
      const it = r.items.find((i) => i.type !== 'article');
      return it ? it.id : '';
    });
    need(!!otherId, '没有非 article 的内容可以进老编辑器');
    await page.evaluate((id) => window.CL.openEditorById(id), otherId);
    await page.waitForFunction(() => !document.getElementById('contentEditor').classList.contains('hidden'), { timeout: 15000, polling: 120 });
    await sleep(900);
    const itemCount = await page.evaluate(() => document.querySelectorAll('.brief-item').length);
    for (let i = 0; i < itemCount; i++) {
      const has = await page.evaluate(() => document.querySelectorAll('.asset-chip').length > 0);
      if (has) break;
      await page.evaluate((k) => document.querySelectorAll('.brief-item')[k].click(), i);
      await sleep(400);
    }
    await page.waitForSelector('.asset-chip', { timeout: 15000 });
    await sleep(500);
    await page.evaluate(() => { const d = document.getElementById('briefCard'); if (d) d.open = true; });
    await sleep(250);

    const content = await page.evaluate(() => ({
      campaigns: document.querySelectorAll('.brief-item').length,
      groups: document.querySelectorAll('.asset-group').length,
      chips: document.querySelectorAll('.asset-chip').length,
      checks: document.querySelectorAll('.check').length,
      versions: document.querySelectorAll('.tl-item').length,
      editorLen: (document.getElementById('editor') || {}).value.length,
      editorFontSize: parseFloat(getComputedStyle(document.getElementById('editor')).fontSize),
      editorFontFamily: getComputedStyle(document.getElementById('editor')).fontFamily,
      titleFontSize: parseFloat(getComputedStyle(document.querySelector('.doc-title')).fontSize),
      summary: (document.getElementById('assetSummary') || {}).textContent,
      panes: {
        left: Math.round(document.querySelector('.sidebar').getBoundingClientRect().width),
        right: Math.round(document.querySelector('.rail').getBoundingClientRect().width)
      }
    }));
    const cm = await collect(page, [
      ['正文', '.check .body > span:first-child'],
      ['次要文字', '.check .why'],
      ['出处', '.check .cite'],
      ['campaign 名', '.brief-item .bi-title'],
      ['资产副标题', '.asset-chip .ac-sub'],
      ['状态胶囊', '.pill'],
      ['文档标题', '.doc-title'],
      ['编辑器', '.editor']
    ]);
    await page.screenshot({ path: path.join(SHOT_DIR, 'sca.png') });

    need(content.campaigns >= 1, 'campaign 列表为空');
    need(content.groups >= 1, '没有资产分组');
    need(content.chips >= 1, '没有资产卡');
    need(content.checks >= 5, '规则项太少：' + content.checks);
    need(content.editorLen > 100, '编辑器没内容：' + content.editorLen);
    need(cm.overflowX <= 1, 'Content 横向溢出 ' + cm.overflowX + 'px');
    need(content.panes.left >= 240, '左栏宽度异常');
    need(content.panes.right >= 300, '右栏宽度异常');
    need(content.editorFontSize >= 16, '编辑器字号 ' + content.editorFontSize + 'px');
    need(!/mono/i.test(content.editorFontFamily), '编辑器用了等宽字体');
    need(content.titleFontSize >= 24, '标题字号 ' + content.titleFontSize + 'px');
    const extra2 = cm.sizes.filter((s) => !ALLOWED.includes(s));
    need(extra2.length === 0, 'Content 计划外字号：' + extra2.join(', '));
    cm.contrasts.forEach((c) => need(c.ratio === null || c.ratio >= 4.5, `对比度不足 ${c.name} = ${c.ratio}:1`));

    /* ================= Article 编辑器（v12） ================= */
    const artId = await page.evaluate(async () => {
      const r = await fetch('/api/content?group=content&size=100').then((x) => x.json());
      const it = r.items.find((i) => i.type === 'article');
      return it ? it.id : '';
    });
    need(!!artId, '找不到 article 类型的条目，没法验编辑器');
    await page.evaluate((id) => window.AR.open(id), artId);
    await page.waitForFunction(() => !document.getElementById('view-article').classList.contains('hidden'), { timeout: 15000 });
    await sleep(900);

    const art = await page.evaluate(() => {
      const box = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), left: Math.round(r.left) };
      };
      const cs = (sel, prop) => { const el = document.querySelector(sel); return el ? getComputedStyle(el)[prop] : null; };
      const circles = [...document.querySelectorAll('.ar-ring')].map((svg) => {
        const bar = svg.querySelector('.ar-ring-bar');
        return bar ? getComputedStyle(bar).stroke : '';
      });
      return {
        head: box('.ar-head'),
        main: box('.ar-main'),
        rail: box('.ar-rail'),
        write: box('.ar-write'),
        toolbar: box('.ar-toolbar'),
        h1: box('.ar-h1'),
        tabs: [...document.querySelectorAll('.ar-tab')].map((t) => t.textContent.trim()),
        tabW: [...document.querySelectorAll('.ar-tab')].map((t) => Math.round(t.getBoundingClientRect().width)),
        cards: document.querySelectorAll('.ar-card').length,
        alerts: document.querySelectorAll('.ar-alert').length,
        rings: circles.length,
        ringStrokes: circles.slice(0, 3),
        cardR: parseFloat(cs('.ar-card', 'borderRadius')),
        cardB: parseFloat(cs('.ar-card', 'borderTopWidth')),
        inputH: box('.ar-input') ? box('.ar-input').h : 0,
        inputR: parseFloat(cs('.ar-input', 'borderRadius')),
        titleSize: parseFloat(cs('.ar-h1', 'fontSize')),
        bodySize: parseFloat(cs('.ar-body-input', 'fontSize')),
        bodyLh: cs('.ar-body-input', 'lineHeight'),
        metaSize: parseFloat(cs('.ar-metric', 'fontSize')),
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        dark: [...document.querySelectorAll('#view-article *')].filter((el) => {
          const bg = getComputedStyle(el).backgroundColor;
          const m = bg.match(/rgba?\(([^)]+)\)/);
          if (!m) return false;
          const parts = m[1].split(',').map((v) => parseFloat(v));
          const alpha = parts.length > 3 ? parts[3] : 1;
          if (!(alpha > 0.5)) return false;   // 透明背景不算「深色块」，否则每个 div 都会被误判
          const lum = (0.299 * parts[0] + 0.587 * parts[1] + 0.114 * parts[2]) / 255;
          // 只把「大块深色面板」当问题：按钮/胶囊本来就是蓝底白字
          const r = el.getBoundingClientRect();
          const isBtn = el.tagName === 'BUTTON' || /\bbtn\b|cl-pill|ar-metric|ar-tab/.test(el.className || '');
          return !isBtn && lum < 0.5 && r.width > 120 && r.height > 60;
        }).map((el) => el.className).slice(0, 3),
        sizes: (() => {
          const set = new Set();
          document.querySelectorAll('#view-article *').forEach((el) => {
            if (!el.offsetParent) return;
            const hasText = [...el.childNodes].some((nd) => nd.nodeType === 3 && nd.textContent.trim());
            if (hasText && !(el instanceof SVGElement)) set.add(parseFloat(getComputedStyle(el).fontSize));
          });
          return [...set].sort((a, b) => a - b);
        })()
      };
    });
    const artCm = await collect(page, [
      ['顶部标题', '#arTitleBtn'],
      ['Tab', '.ar-tab.is-on'],
      ['指标标签', '.ar-metric'],
      ['面板标题', '.ar-rail-head h3'],
      ['模块说明', '.ar-card-body span'],
      ['告警文字', '.ar-alert-hint'],
      ['正文', '.ar-body-input']
    ]);
    await page.screenshot({ path: path.join(SHOT_DIR, 'article-write.png') });

    need(art.head.h >= 56 && art.head.h <= 68, '编辑头高度异常：' + art.head.h);
    need(JSON.stringify(art.tabs) === JSON.stringify(['Write', 'Settings', 'Audience']), 'Article 三个 Tab 不对：' + art.tabs.join('/'));
    need(art.rail && art.rail.w >= 300 && art.rail.w <= 380, '右侧面板宽度异常：' + (art.rail && art.rail.w));
    need(art.main.left + art.main.w <= art.rail.left + 1, '主区和右栏重叠了');
    need(art.cards === 5, 'SEO 模块卡片不是 5 个：' + art.cards);
    need(art.rings >= 3, '环形进度太少：' + art.rings);
    need(art.alerts >= 5, '告警条目太少：' + art.alerts);
    need(art.cardR >= 12, '卡片圆角太小：' + art.cardR);
    need(art.cardB <= 1, '卡片边框太粗：' + art.cardB);
    need(art.inputH >= 30 && art.inputH <= 38, '输入框高度异常：' + art.inputH);
    need(art.inputR >= 8, '输入框圆角太小：' + art.inputR);
    need(art.titleSize >= 24, '文章标题字号太小：' + art.titleSize);
    need(art.bodySize >= 16, '正文字号小于 16px：' + art.bodySize);
    need(parseFloat(art.bodyLh) / art.bodySize >= 1.6, '正文行高太挤：' + art.bodyLh);
    need(art.metaSize === 12, '指标标签字号应该是 12px：' + art.metaSize);
    need(art.overflowX <= 1, 'Article 编辑器横向溢出 ' + art.overflowX + 'px');
    need(art.dark.length === 0, '编辑器里出现深色块：' + art.dark.join(','));
    const artExtra = art.sizes.filter((x) => !ALLOWED.includes(x));
    need(artExtra.length === 0, 'Article 计划外字号：' + artExtra.join(', '));
    artCm.contrasts.forEach((c) => need(c.ratio === null || c.ratio >= 4.5, 'Article 对比度不足 ' + c.name + ' = ' + c.ratio + ':1'));

    // Settings
    await page.evaluate(() => document.querySelector('.ar-tab[data-artab="settings"]').click());
    await sleep(500);
    const setg = await page.evaluate(() => {
      const box = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; };
      return {
        subs: [...document.querySelectorAll('.ar-sub')].map((b) => b.textContent.trim()),
        subnav: box('.ar-subnav'),
        form: box('.ar-form'),
        fields: document.querySelectorAll('.ar-field').length,
        cover: document.querySelectorAll('.ar-cover-acts .btn').length,
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth
      };
    });
    need(JSON.stringify(setg.subs) === JSON.stringify(['Article details', 'SEO settings', 'Custom fields']), 'Settings 子页不对：' + setg.subs.join('/'));
    need(setg.fields >= 5, 'Article details 字段太少：' + setg.fields);
    need(setg.cover === 3, '封面按钮不是 3 个：' + setg.cover);
    need(setg.overflowX <= 1, 'Settings 横向溢出 ' + setg.overflowX + 'px');
    await page.screenshot({ path: path.join(SHOT_DIR, 'article-settings.png') });

    await page.evaluate(() => document.querySelector('.ar-sub[data-arsub="seo"]').click());
    await sleep(400);
    const serp = await page.evaluate(() => {
      const el = document.querySelector('.ar-serp');
      const r = el ? el.getBoundingClientRect() : null;
      return { w: r ? Math.round(r.width) : 0, title: (document.querySelector('.ar-serp-title') || {}).textContent };
    });
    need(serp.w >= 300, '搜索结果预览太窄：' + serp.w);
    need(!!serp.title, '搜索结果预览没有标题');

    // Audience → Socials
    await page.evaluate(() => document.querySelector('.ar-tab[data-artab="audience"]').click());
    await sleep(500);
    const aud = await page.evaluate(() => ({
      cats: [...document.querySelectorAll('.ar-cat-name')].map((x) => x.textContent),
      catW: (() => { const el = document.querySelector('.ar-cats'); return el ? Math.round(el.getBoundingClientRect().width) : 0; })()
    }));
    need(aud.cats.length === 6, 'Audience 分类不是 6 个：' + aud.cats.length);
    need(aud.catW >= 180 && aud.catW <= 260, 'Audience 左列宽度异常：' + aud.catW);
    await page.screenshot({ path: path.join(SHOT_DIR, 'article-audience.png') });

    await page.evaluate(() => document.querySelector('.ar-cat[data-cat="social"]').click());
    await sleep(500);
    const socRail = await page.evaluate(() => {
      const el = document.querySelector('.ar-rail');
      const r = el.getBoundingClientRect();
      return {
        head: (document.querySelector('.ar-rail-head h3') || {}).textContent,
        w: Math.round(r.width),
        acts: [...document.querySelectorAll('.ar-social-acts .btn')].length,
        platforms: document.querySelectorAll('.ar-platform').length,
        empty: !!document.querySelector('.ar-social-empty')
      };
    });
    need(socRail.head === 'Socials', '右侧没切成 Socials：' + socRail.head);
    need(socRail.acts === 2, 'Socials 顶部按钮不是 2 个：' + socRail.acts);
    need(socRail.platforms >= 4, '平台列表太少：' + socRail.platforms);
    await page.screenshot({ path: path.join(SHOT_DIR, 'article-socials.png') });

    // 关掉，回到列表，后面 Planning 还要用
    await page.evaluate(() => document.getElementById('arClose').click());
    await sleep(700);
    const closedOk = await page.evaluate(() => document.getElementById('view-article').classList.contains('hidden'));
    need(closedOk, 'Article 编辑器没关掉');

    /* ================= Planning ================= */
    await page.evaluate(() => document.querySelector('.nav-item[data-view="planning"]').click());
    await sleep(700);
    const cal = await page.evaluate(() => ({
      cells: document.querySelectorAll('.cal-cell').length,
      chips: document.querySelectorAll('.cal-grid .cal-chip').length,
      stripChips: document.querySelectorAll('.cal-unscheduled .cal-chip').length,
      title: (document.getElementById('calTitle') || {}).textContent,
      weekheads: document.querySelectorAll('.cal-weekhead span').length,
      legend: document.querySelectorAll('.legend i').length,
      visible: !document.getElementById('view-planning').classList.contains('hidden'),
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth
    }));
    await page.screenshot({ path: path.join(SHOT_DIR, 'sca-calendar.png') });

    need(cal.visible, 'Planning 没显示');
    need(cal.cells >= 28 && cal.cells <= 42, '日历格子数异常：' + cal.cells);
    need(cal.weekheads === 7, '星期表头不是 7 列');
    need(cal.legend === 4, '图例不是 4 类，实际 ' + cal.legend);
    need(cal.chips + cal.stripChips >= 1, '日历里没有任何资产');
    need(cal.overflowX <= 1, 'Planning 横向溢出 ' + cal.overflowX + 'px');

    await page.click('#calNext');
    await sleep(350);
    const nextTitle = await page.evaluate(() => document.getElementById('calTitle').textContent);
    need(nextTitle !== cal.title, '翻月没有生效');
    await page.click('#calToday');
    await sleep(300);

    /* ================= Strategy（四个板块的视觉/版式） ================= */
    await page.evaluate(() => document.querySelector('.nav-item[data-view="strategy"]').click());
    await sleep(900);
    const st = await page.evaluate(() => {
      const rail = document.querySelector('.st-rail').getBoundingClientRect();
      const body = document.querySelector('.st-body').getBoundingClientRect();
      const sizes = new Set();
      document.querySelectorAll('#view-strategy *').forEach((el) => {
        if (!el.offsetParent && el.id !== 'view-strategy') return;
        const t = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
        if (t) sizes.add(getComputedStyle(el).fontSize);
      });
      const lum = (c) => {
        const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const parse = (s) => (s.match(/[\d.]+/g) || []).slice(0, 4).map(Number);
      let darkest = { v: 1, sel: '' };
      document.querySelectorAll('#view-strategy *').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width * r.height <= 2400) return;
        const c = parse(getComputedStyle(el).backgroundColor);
        if (c.length < 3 || (c[3] !== undefined && c[3] < 0.5)) return;
        const v = lum(c.slice(0, 3));
        if (v < darkest.v) darkest = { v: Math.round(v * 100) / 100, sel: el.id || el.className.split(' ')[0] };
      });
      return {
        railW: Math.round(rail.width),
        bodyW: Math.round(body.width),
        railItems: [...document.querySelectorAll('.st-item')].map((b) => b.textContent.replace(/\d+/g, '').trim()),
        panels: document.querySelectorAll('.st-panel').length,
        quick: document.querySelectorAll('#stQuick .quick').length,
        skillChips: document.querySelectorAll('#stQuick .quick-skill').length,
        headTitle: (document.querySelector('#stPanel-chat h1') || {}).textContent,
        sizes: [...sizes].map((s) => parseInt(s, 10)),
        darkest,
        minRadius: Math.min(...[...document.querySelectorAll('#view-strategy .card, #view-strategy .audit-row')].map((e) => parseFloat(getComputedStyle(e).borderRadius) || 0)),
        maxBorder: Math.max(...[...document.querySelectorAll('#view-strategy .card, #view-strategy .audit-row')].map((e) => parseFloat(getComputedStyle(e).borderTopWidth) || 0)),
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth
      };
    });
    await page.screenshot({ path: path.join(SHOT_DIR, 'strategy-chat.png') });
    need(st.railW >= 200 && st.railW <= 280, 'Strategy 左侧栏宽度异常：' + st.railW);
    need(st.bodyW > 700, 'Strategy 右侧主区太窄：' + st.bodyW);
    need(st.railItems.join('|') === 'New chat|Content audit|Company knowledge|Plugins & skills', '左栏四个板块不对：' + st.railItems.join('|'));
    need(st.panels === 4, 'Strategy 面板不是 4 个：' + st.panels);
    need(st.headTitle === 'New chat', '默认打开的板块不是 New chat：' + st.headTitle);
    need(st.quick >= 8 && st.skillChips >= 4, 'Strategy 快捷指令/技能 chip 不足：' + st.quick + ' / ' + st.skillChips);
    need(st.sizes.every((s) => [12, 13, 14, 16, 20, 26].includes(s)), 'Strategy 计划外字号：' + st.sizes.join(','));
    need(st.darkest.v > 0.5, 'Strategy 出现深色块：' + st.darkest.sel + ' 亮度 ' + st.darkest.v);
    need(st.minRadius >= 12, 'Strategy 卡片圆角太硬：' + st.minRadius);
    need(st.maxBorder <= 1, 'Strategy 边框太厚：' + st.maxBorder);
    need(st.overflowX <= 1, 'Strategy 横向溢出 ' + st.overflowX + 'px');

    // 知识库：表单是"借"过去的，宽度要正常（曾经因为 hidden 类导致 0 宽）
    // Content audit：GSC 卡片 + 粘贴区（默认收起）
    await page.evaluate(() => document.querySelector('.st-item[data-st="audit"]').click());
    await sleep(700);
    const stAudit = await page.evaluate(() => {
      const card = document.querySelector('#stPanel-audit .gsc-card');
      const logo = card.querySelector('.app-logo svg');
      return {
        title: (card.querySelector('.gsc-title') || {}).textContent,
        logoW: Math.round((logo || { getBoundingClientRect: () => ({ width: 0 }) }).getBoundingClientRect().width),
        pasteHidden: document.getElementById('stPaste').classList.contains('hidden') || !!document.querySelector('.audit-empty'),
        btn: (document.getElementById('stGscSetup') || {}).textContent,
        w: Math.round(card.getBoundingClientRect().width)
      };
    });
    need(stAudit.title === 'Google Search Console', 'GSC 卡片标题不对：' + stAudit.title);
    need(stAudit.logoW >= 24, 'GSC 图标没渲染：' + stAudit.logoW);
    need(/接入/.test(stAudit.btn || ''), 'GSC 卡片没有接入按钮：' + stAudit.btn);
    need(stAudit.w > 600, 'GSC 卡片太窄：' + stAudit.w);

    await page.evaluate(() => document.querySelector('.st-item[data-st="knowledge"]').click());
    await sleep(800);
    const stKn = await page.evaluate(() => {
      const n = document.querySelectorAll('#knName');
      const rect = (sel) => { const e = document.querySelector(sel); return e ? Math.round(e.getBoundingClientRect().width) : 0; };
      const rows = [...document.querySelectorAll('#stBlocks .kn-setup-row')];
      return {
        count: n.length,
        tabs: [...document.querySelectorAll('.kn-tab')].map((b2) => b2.textContent.trim()),
        on: (document.querySelector('.kn-tab.is-on') || {}).textContent,
        inSlot: !!document.querySelector('#stKnowledgeSlot .kn-tabs'),
        cardW: rect('.kn-card'),
        rowW: rect('#stBlocks .kn-setup-row'),
        rows: rows.length,
        done: rows.filter((r) => r.classList.contains('is-done')).length,
        doneTxt: (document.getElementById('stKnDone') || {}).textContent,
        totalTxt: (document.getElementById('stKnTotal') || {}).textContent,
        bar: (document.getElementById('stKnBar') || {}).style.width,
        voiceCards: document.querySelectorAll('.voice-card').length,
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        sizes: [...new Set([...document.querySelectorAll('#stKnowledgeSlot *')]
          .filter((e) => !(e instanceof SVGElement) && !e.children.length && e.textContent.trim())
          .map((e) => parseFloat(getComputedStyle(e).fontSize)))].sort((a2, b2) => a2 - b2)
      };
    });
    await page.screenshot({ path: path.join(SHOT_DIR, 'strategy-knowledge.png') });
    need(stKn.count === 1, '知识表单被复制了：文档里有 ' + stKn.count + ' 个 #knName');
    need(stKn.inSlot, '知识面板没挂进 Strategy');
    need(stKn.tabs.length === 8 && stKn.on === 'Overview', '8 个 tab / 默认 Overview 不对：' + stKn.tabs.length + ' 个，当前 ' + stKn.on);
    need(stKn.cardW > 150, '三张说明卡太窄：' + stKn.cardW + 'px');
    need(stKn.rows === 10 && stKn.rowW > 150, 'Setup 清单不是 10 行两列：' + stKn.rows + ' 行 / ' + stKn.rowW + 'px');
    need(stKn.done === parseInt(stKn.doneTxt, 10), '清单打勾数和进度数字对不上：' + stKn.done + ' vs ' + stKn.doneTxt);
    need(stKn.totalTxt === '10', '进度总数不是 10：' + stKn.totalTxt);
    need(stKn.bar === Math.round((stKn.done / 10) * 100) + '%', '进度条宽度和数字不一致：' + stKn.bar);
    need(stKn.voiceCards >= 1, 'Brand voices 里没有卡片：' + stKn.voiceCards);
    need(stKn.overflowX <= 1, '知识面板横向溢出 ' + stKn.overflowX + 'px');
    need(stKn.sizes.every((x) => [12, 13, 14, 16, 20, 26].includes(x)), '知识库里出现计划外字号：' + stKn.sizes.join(','));

    /* ---- v8 受众 / 支柱：列表 + 长弹窗（深蓝 header 是设计意图，单独断言） ---- */
    await page.evaluate(() => document.querySelector('.kn-tab[data-kntab="audiences"]').click());
    await sleep(400);
    const taList = await page.evaluate(() => {
      const card = document.querySelector('#audienceList .entry-card');
      const cs = card ? getComputedStyle(card) : null;
      const tag = document.querySelector('#audienceList .tag');
      return {
        cards: document.querySelectorAll('#audienceList .entry-card').length,
        cardW: card ? Math.round(card.getBoundingClientRect().width) : 0,
        radius: cs ? parseFloat(cs.borderTopLeftRadius) : 0,
        borderW: cs ? parseFloat(cs.borderTopWidth) : 0,
        btn: (document.getElementById('btnAddAudience') || {}).textContent,
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        sizes: [...new Set([...document.querySelectorAll('#audienceList *')]
          .filter((e) => !(e instanceof SVGElement) && !e.children.length && e.textContent.trim())
          .map((e) => parseFloat(getComputedStyle(e).fontSize)))].sort((a, b) => a - b),
        tagText: tag ? tag.textContent.trim() : ''
      };
    });
    need(taList.cards >= 1, 'Target audiences 没渲染出列表');
    need(taList.cardW > 500, '受众卡片太窄：' + taList.cardW + 'px');
    need(taList.radius >= 12 && taList.borderW <= 1, '受众卡片圆角/边框不对：' + taList.radius + ' / ' + taList.borderW);
    need(taList.btn === 'Add target audience', '受众按钮文案不对：' + taList.btn);
    need(taList.overflowX <= 1, '受众列表横向溢出 ' + taList.overflowX + 'px');
    need(taList.sizes.every((x) => [12, 13, 14, 16, 20, 26].includes(x)), '受众列表出现计划外字号：' + taList.sizes.join(','));

    await page.evaluate(() => document.getElementById('btnAddAudience').click());
    await sleep(450);
    const taModal = await page.evaluate(() => {
      const parse = (x) => String(x).match(/\d+/g).slice(0, 3).map(Number);
      const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      const lum = (x) => 0.2126 * lin(x[0]) + 0.7152 * lin(x[1]) + 0.0722 * lin(x[2]);
      const ratio = (fg, bg) => {
        const a = lum(parse(fg)) + 0.05, b = lum(parse(bg)) + 0.05;
        return Math.round((Math.max(a, b) / Math.min(a, b)) * 100) / 100;
      };
      const m = document.getElementById('audienceModal');
      const head = m.querySelector('.kn-modal-head');
      const body = m.querySelector('.kn-modal-body');
      const title = head.querySelector('h3');
      const hint = m.querySelector('.kn-hint');
      const label = m.querySelector('.kn-label');
      const modal = m.querySelector('.kn-modal');
      const foot = m.querySelector('.kn-modal-foot');
      const headBg = getComputedStyle(head).backgroundColor;
      return {
        open: !m.classList.contains('hidden'),
        headLum: Math.round(lum(parse(headBg)) * 100) / 100,
        titleRatio: ratio(getComputedStyle(title).color, headBg),
        bodyBg: getComputedStyle(modal).backgroundColor,
        hintRatio: ratio(getComputedStyle(hint).color, getComputedStyle(modal).backgroundColor),
        labelRatio: ratio(getComputedStyle(label).color, getComputedStyle(modal).backgroundColor),
        radius: parseFloat(getComputedStyle(modal).borderTopLeftRadius),
        w: Math.round(modal.getBoundingClientRect().width),
        h: Math.round(modal.getBoundingClientRect().height),
        vh: window.innerHeight,
        bodyScrolls: getComputedStyle(body).overflowY,
        footBorder: parseFloat(getComputedStyle(foot).borderTopWidth),
        rowH: Math.round(document.querySelector('#taIndustries .row-item').getBoundingClientRect().height),
        inputW: Math.round(document.querySelector('#taIndustries .row-input').getBoundingClientRect().width),
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth
      };
    });
    need(taModal.open, '受众弹窗没打开');
    need(taModal.headLum < 0.25, '弹窗 header 不是深蓝色（亮度 ' + taModal.headLum + '）');
    need(taModal.titleRatio >= 4.5, '弹窗标题对比度不够：' + taModal.titleRatio + ':1');
    need(taModal.hintRatio >= 4.5, '说明小字对比度不够：' + taModal.hintRatio + ':1');
    need(taModal.labelRatio >= 4.5, '字段标签对比度不够：' + taModal.labelRatio + ':1');
    need(taModal.radius >= 12, '弹窗圆角不够：' + taModal.radius + 'px');
    need(taModal.w >= 560 && taModal.w <= 700, '弹窗宽度不对：' + taModal.w + 'px');
    need(taModal.bodyScrolls === 'auto', '弹窗 body 不是独立滚动容器：' + taModal.bodyScrolls);
    need(taModal.h <= taModal.vh * 0.92, '弹窗撑破视口：' + taModal.h + ' / ' + taModal.vh);
    need(taModal.rowH >= 28 && taModal.rowH <= 44 && taModal.inputW > 300, '多行条目尺寸异常：' + taModal.rowH + 'px / ' + taModal.inputW + 'px');
    need(taModal.footBorder === 1, '弹窗 footer 分割线不对：' + taModal.footBorder);
    need(taModal.overflowX <= 1, '弹窗横向溢出 ' + taModal.overflowX + 'px');
    await page.screenshot({ path: path.join(SHOT_DIR, 'audience-modal.png') });
    await page.evaluate(() => document.getElementById('btnAudienceCancel').click());
    await sleep(250);

    await page.evaluate(() => document.querySelector('.kn-tab[data-kntab="pillars"]').click());
    await sleep(400);
    const cpList = await page.evaluate(() => ({
      cards: document.querySelectorAll('#pillarList .entry-card').length,
      btn: (document.getElementById('btnAddPillar') || {}).textContent,
      tags: document.querySelectorAll('#pillarList .tag').length,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth
    }));
    need(cpList.cards >= 1, 'Content pillars 没渲染出列表');
    need(cpList.btn === 'Add content pillar', '支柱按钮文案不对：' + cpList.btn);
    need(cpList.tags >= 3, '支柱卡片没显示结构化条目：' + cpList.tags + ' 个 tag');
    need(cpList.overflowX <= 1, '支柱列表横向溢出 ' + cpList.overflowX + 'px');

    await page.evaluate(() => document.getElementById('btnAddPillar').click());
    await sleep(450);
    const cpModal = await page.evaluate(() => {
      const m = document.getElementById('pillarModal');
      const modal = m.querySelector('.kn-modal');
      return {
        open: !m.classList.contains('hidden'),
        groups: [...m.querySelectorAll('.kn-group-title')].map((e) => e.textContent.trim()),
        pickOpts: document.getElementById('cpAudPick').options.length,
        foot: [...m.querySelectorAll('.kn-modal-foot .btn')].map((e) => e.textContent.trim()).join('/'),
        h: Math.round(modal.getBoundingClientRect().height),
        vh: window.innerHeight,
        bodyScrolls: getComputedStyle(m.querySelector('.kn-modal-body')).overflowY
      };
    });
    need(cpModal.open, '支柱弹窗没打开');
    need(cpModal.groups.join('|') === 'Strategy|Content guidance', '支柱弹窗分组不对：' + cpModal.groups.join('|'));
    need(cpModal.pickOpts >= 2, '支柱弹窗的受众下拉是空的');
    need(cpModal.foot === 'Cancel/Create', '支柱弹窗底部不对：' + cpModal.foot);
    need(cpModal.bodyScrolls === 'auto' && cpModal.h <= cpModal.vh * 0.92, '支柱弹窗滚动/高度不对');
    await page.screenshot({ path: path.join(SHOT_DIR, 'pillar-modal.png') });
    await page.evaluate(() => document.getElementById('btnPillarCancel').click());
    await sleep(250);
    /* ---- v9 写作规范：列表 + 开关/下拉弹窗 ---- */
    await page.evaluate(() => {
      document.getElementById('btnPillarCancel').click();
      document.querySelector('.kn-tab[data-kntab="writing"]').click();
    });
    await sleep(400);
    const wsList = await page.evaluate(() => {
      const card = document.querySelector('#writingList .entry-card');
      const cs = card ? getComputedStyle(card) : null;
      return {
        cards: document.querySelectorAll('#writingList .entry-card').length,
        cardW: card ? Math.round(card.getBoundingClientRect().width) : 0,
        radius: cs ? parseFloat(cs.borderTopLeftRadius) : 0,
        borderW: cs ? parseFloat(cs.borderTopWidth) : 0,
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        sizes: [...new Set([...document.querySelectorAll('#writingList *')]
          .filter((e) => !(e instanceof SVGElement) && !e.children.length && e.textContent.trim())
          .map((e) => parseFloat(getComputedStyle(e).fontSize)))].sort((a, b) => a - b)
      };
    });
    need(wsList.cards >= 1, 'Writing style 没渲染出列表');
    need(wsList.cardW > 500 && wsList.radius >= 12 && wsList.borderW <= 1, '写作规范卡片几何不对：' + wsList.cardW + ' / ' + wsList.radius + ' / ' + wsList.borderW);
    need(wsList.overflowX <= 1, '写作规范列表横向溢出 ' + wsList.overflowX + 'px');
    need(wsList.sizes.every((x) => [12, 13, 14, 16, 20, 26].includes(x)), '写作规范列表出现计划外字号：' + wsList.sizes.join(','));

    await page.evaluate(() => document.getElementById('btnAddWriting').click());
    await sleep(450);
    const wsModal = await page.evaluate(() => {
      const parse = (x) => String(x).match(/\d+/g).slice(0, 3).map(Number);
      const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      const lum = (x) => 0.2126 * lin(x[0]) + 0.7152 * lin(x[1]) + 0.0722 * lin(x[2]);
      const ratio = (fg, bg) => {
        const a = lum(parse(fg)) + 0.05, b = lum(parse(bg)) + 0.05;
        return Math.round((Math.max(a, b) / Math.min(a, b)) * 100) / 100;
      };
      const m = document.getElementById('writingModal');
      const head = m.querySelector('.kn-modal-head');
      const modalEl = m.querySelector('.kn-modal');
      const bodyEl = m.querySelector('.kn-modal-body');
      const headBg = getComputedStyle(head).backgroundColor;
      const modalBg = getComputedStyle(modalEl).backgroundColor;
      const sw = m.querySelector('.kn-switch');
      const knob = m.querySelector('.kn-switch-knob');
      const sel = m.querySelector('.kn-select');
      const rowLabel = m.querySelector('.kn-row-label');
      const rowDesc = m.querySelector('.kn-row-desc');
      const sr = sw.getBoundingClientRect();
      const kr = knob.getBoundingClientRect();
      const bgBefore = getComputedStyle(sw).backgroundColor;
      return {
        open: !m.classList.contains('hidden'),
        headLum: Math.round(lum(parse(headBg)) * 100) / 100,
        titleRatio: ratio(getComputedStyle(head.querySelector('h3')).color, headBg),
        labelRatio: ratio(getComputedStyle(rowLabel).color, modalBg),
        descRatio: ratio(getComputedStyle(rowDesc).color, modalBg),
        swW: Math.round(sr.width), swH: Math.round(sr.height),
        swRadius: parseFloat(getComputedStyle(sw).borderTopLeftRadius),
        knobInside: kr.left >= sr.left - 0.5 && kr.right <= sr.right + 0.5 && kr.height <= sr.height,
        knobTravel: Math.round(kr.left - sr.left),
        bgBefore,
        selH: Math.round(sel.getBoundingClientRect().height),
        selW: Math.round(sel.getBoundingClientRect().width),
        selRadius: parseFloat(getComputedStyle(sel).borderTopLeftRadius),
        rows: m.querySelectorAll('.kn-row').length,
        switches: m.querySelectorAll('.kn-switch').length,
        w: Math.round(modalEl.getBoundingClientRect().width),
        h: Math.round(modalEl.getBoundingClientRect().height),
        vh: window.innerHeight,
        bodyScrolls: getComputedStyle(bodyEl).overflowY,
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth
      };
    });
    need(wsModal.open, '写作规范弹窗没打开');
    need(wsModal.headLum < 0.25, '写作规范弹窗 header 不是深蓝色（亮度 ' + wsModal.headLum + '）');
    need(wsModal.titleRatio >= 4.5 && wsModal.labelRatio >= 4.5 && wsModal.descRatio >= 4.5,
      '写作规范弹窗文字对比度不够：' + [wsModal.titleRatio, wsModal.labelRatio, wsModal.descRatio].join(' / '));
    need(wsModal.switches === 10 && wsModal.rows === 12, '开关/行数不对：' + wsModal.switches + ' 开关 / ' + wsModal.rows + ' 行');
    need(wsModal.swW >= 36 && wsModal.swW <= 40 && wsModal.swH >= 20 && wsModal.swH <= 24 && wsModal.swRadius >= 10,
      '开关尺寸/圆角不对：' + wsModal.swW + '×' + wsModal.swH + ' r' + wsModal.swRadius);
    need(wsModal.knobInside, '开关的圆点跑出轨道了：' + JSON.stringify({ t: wsModal.knobTravel }));

    // 开 → 等过渡结束 → 读颜色和圆点位置；再关回去
    await page.evaluate(() => document.querySelector('#writingModal .kn-switch[data-wskey="contractions"]').click());
    await sleep(320);
    const swOn = await page.evaluate(() => {
      const sw = document.querySelector('#writingModal .kn-switch[data-wskey="contractions"]');
      const knob = sw.querySelector('.kn-switch-knob');
      return {
        checked: sw.getAttribute('aria-checked'),
        bg: getComputedStyle(sw).backgroundColor,
        travel: Math.round(knob.getBoundingClientRect().left - sw.getBoundingClientRect().left)
      };
    });
    await page.evaluate(() => document.querySelector('#writingModal .kn-switch[data-wskey="contractions"]').click());
    await sleep(320);
    const swOff = await page.evaluate(() => {
      const sw = document.querySelector('#writingModal .kn-switch[data-wskey="contractions"]');
      return { checked: sw.getAttribute('aria-checked'), bg: getComputedStyle(sw).backgroundColor };
    });
    need(swOn.checked === 'true' && swOn.bg !== wsModal.bgBefore,
      '开关打开后视觉真的变了（' + wsModal.bgBefore + ' → ' + swOn.bg + '）');
    need(swOn.travel >= 14, '开关打开后圆点没滑过去（位移 ' + swOn.travel + 'px）');
    need(swOff.checked === 'false' && swOff.bg === wsModal.bgBefore, '开关能关回去（' + swOff.bg + '）');
    need(wsModal.selH >= 32 && wsModal.selH <= 36 && wsModal.selW >= 160 && wsModal.selRadius >= 6,
      '下拉尺寸/圆角不对：' + wsModal.selW + '×' + wsModal.selH + ' r' + wsModal.selRadius);
    need(wsModal.w >= 560 && wsModal.w <= 700 && wsModal.h <= wsModal.vh * 0.92, '弹窗尺寸不对：' + wsModal.w + '×' + wsModal.h);
    need(wsModal.bodyScrolls === 'auto', '写作规范弹窗 body 不是独立滚动容器：' + wsModal.bodyScrolls);
    need(wsModal.overflowX <= 1, '写作规范弹窗横向溢出 ' + wsModal.overflowX + 'px');
    await page.screenshot({ path: path.join(SHOT_DIR, 'writing-modal.png') });
    await page.evaluate(() => document.getElementById('btnWritingCancel').click());
    await sleep(250);

    // ---- Visual style 列表 + 弹窗 ----
    await page.evaluate(() => document.querySelector('.kn-tab[data-kntab="visual"]').click());
    await sleep(350);
    const vsList = await page.evaluate(() => {
      const card = document.querySelector('#visualList .entry-card');
      const empty = document.querySelector('#visualList .kn-empty-block');
      const cs = card ? getComputedStyle(card) : (empty ? getComputedStyle(empty) : null);
      const addBtn = document.getElementById('btnAddVisual');
      return {
        cardW: card ? Math.round(card.getBoundingClientRect().width) : 0,
        radius: cs ? parseFloat(cs.borderTopLeftRadius) : 0,
        borderW: cs ? parseFloat(cs.borderTopWidth) : 0,
        addH: Math.round(addBtn.getBoundingClientRect().height),
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        sizes: [...new Set([...document.querySelectorAll('[data-knpane="visual"] *')]
          .filter((e) => !(e instanceof SVGElement) && !e.children.length && e.textContent.trim())
          .map((e) => parseFloat(getComputedStyle(e).fontSize)))].sort((a, b) => a - b)
      };
    });
    need(vsList.radius >= 12 && vsList.borderW <= 1, '视觉风格列表卡片几何不对：r' + vsList.radius + ' / b' + vsList.borderW);
    need(vsList.addH >= 30 && vsList.addH <= 38, 'Add visual style 按钮高度异常：' + vsList.addH);
    need(vsList.overflowX <= 1, '视觉风格列表横向溢出 ' + vsList.overflowX + 'px');
    need(vsList.sizes.every((x) => [12, 13, 14, 16, 20, 26].includes(x)), '视觉风格列表出现计划外字号：' + vsList.sizes.join(','));
    await page.screenshot({ path: path.join(SHOT_DIR, 'visual-tab.png') });

    await page.evaluate(() => document.getElementById('btnAddVisual').click());
    await sleep(450);
    const vsModal = await page.evaluate(() => {
      const parse = (x) => String(x).match(/\d+/g).slice(0, 3).map(Number);
      const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      const lum = (x) => 0.2126 * lin(x[0]) + 0.7152 * lin(x[1]) + 0.0722 * lin(x[2]);
      const ratio = (fg, bg) => {
        const a = lum(parse(fg)) + 0.05, b = lum(parse(bg)) + 0.05;
        return Math.round((Math.max(a, b) / Math.min(a, b)) * 100) / 100;
      };
      const m = document.getElementById('visualModal');
      const head = m.querySelector('.kn-modal-head');
      const modalEl = m.querySelector('.kn-modal');
      const bodyEl = m.querySelector('.kn-modal-body');
      const headBg = getComputedStyle(head).backgroundColor;
      const modalBg = getComputedStyle(modalEl).backgroundColor;
      const groupTitle = m.querySelector('.kn-group-title');
      const hint = m.querySelector('.kn-group-hint');
      const colorText = document.getElementById('vsPrimary');
      const colorPick = document.getElementById('vsPrimaryPick');
      const slot = m.querySelector('#vsRefs .thumb-slot');
      const upBtn = document.getElementById('btnVsRefUpload');
      const left = document.getElementById('vsRefsLeft');
      const cr = colorPick.getBoundingClientRect();
      const sr = slot.getBoundingClientRect();
      const ur = upBtn.getBoundingClientRect();
      return {
        open: !m.classList.contains('hidden'),
        headLum: Math.round(lum(parse(headBg)) * 100) / 100,
        titleRatio: ratio(getComputedStyle(head.querySelector('h3')).color, headBg),
        groupRatio: ratio(getComputedStyle(groupTitle).color, modalBg),
        hintRatio: ratio(getComputedStyle(hint).color, modalBg),
        leftRatio: ratio(getComputedStyle(left).color, modalBg),
        colorW: Math.round(cr.width), colorH: Math.round(cr.height),
        colorRadius: parseFloat(getComputedStyle(colorPick).borderTopLeftRadius),
        textH: Math.round(colorText.getBoundingClientRect().height),
        textRadius: parseFloat(getComputedStyle(colorText).borderTopLeftRadius),
        slotW: Math.round(sr.width), slotH: Math.round(sr.height),
        slotStyle: getComputedStyle(slot).borderTopStyle,
        slotRadius: parseFloat(getComputedStyle(slot).borderTopLeftRadius),
        slots: m.querySelectorAll('#vsRefs .thumb-slot').length,
        upH: Math.round(ur.height),
        groups: m.querySelectorAll('.kn-group-title').length,
        w: Math.round(modalEl.getBoundingClientRect().width),
        h: Math.round(modalEl.getBoundingClientRect().height),
        vh: window.innerHeight,
        bodyScrolls: getComputedStyle(bodyEl).overflowY,
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        sizes: [...new Set([...m.querySelectorAll('.kn-modal *')]
          .filter((e) => !(e instanceof SVGElement) && !e.children.length && e.textContent.trim())
          .map((e) => parseFloat(getComputedStyle(e).fontSize)))].sort((a, b) => a - b)
      };
    });
    need(vsModal.open, '视觉风格弹窗没打开');
    need(vsModal.headLum < 0.25, '视觉风格弹窗 header 不是深蓝色（亮度 ' + vsModal.headLum + '）');
    need(vsModal.titleRatio >= 4.5 && vsModal.groupRatio >= 4.5 && vsModal.hintRatio >= 4.5 && vsModal.leftRatio >= 4.5,
      '视觉风格弹窗文字对比度不够：' + [vsModal.titleRatio, vsModal.groupRatio, vsModal.hintRatio, vsModal.leftRatio].join(' / '));
    need(vsModal.groups === 3, '分组数不是 3：' + vsModal.groups);
    need(vsModal.colorH >= 30 && vsModal.colorH <= 38 && vsModal.colorW >= 30 && vsModal.colorW <= 38
      && vsModal.colorRadius >= 6, '取色器尺寸/圆角不对：' + vsModal.colorW + '×' + vsModal.colorH + ' r' + vsModal.colorRadius);
    need(vsModal.textH >= 30 && vsModal.textH <= 38 && vsModal.textRadius >= 6,
      '色值输入框尺寸/圆角不对：' + vsModal.textH + ' h / r' + vsModal.textRadius);
    need(vsModal.slots === 4 && vsModal.slotStyle === 'dashed' && vsModal.slotRadius >= 8,
      '参考图空位不是 4 个虚线格子：' + vsModal.slots + ' / ' + vsModal.slotStyle + ' / r' + vsModal.slotRadius);
    need(vsModal.slotW >= 60 && vsModal.slotW <= 160 && Math.abs(vsModal.slotW - vsModal.slotH) <= 2,
      '缩略图格子不是正方形：' + vsModal.slotW + '×' + vsModal.slotH);
    need(vsModal.upH >= 30 && vsModal.upH <= 38, 'Upload 按钮高度异常：' + vsModal.upH);
    need(vsModal.w >= 560 && vsModal.w <= 700 && vsModal.h <= vsModal.vh * 0.92, '视觉风格弹窗尺寸不对：' + vsModal.w + '×' + vsModal.h);
    need(vsModal.bodyScrolls === 'auto', '视觉风格弹窗 body 不是独立滚动容器：' + vsModal.bodyScrolls);
    need(vsModal.overflowX <= 1, '视觉风格弹窗横向溢出 ' + vsModal.overflowX + 'px');
    need(vsModal.sizes.every((x) => [12, 13, 14, 16, 20, 26].includes(x)), '视觉风格弹窗出现计划外字号：' + vsModal.sizes.join(','));
    await page.screenshot({ path: path.join(SHOT_DIR, 'visual-modal.png') });
    await page.evaluate(() => document.getElementById('btnVisualCancel').click());
    await sleep(250);

    // ---- Knowledge files 页 ----
    await page.evaluate(() => document.querySelector('.kn-tab[data-kntab="files"]').click());
    await sleep(350);
    const kf = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.kn-files-cards .kn-card')];
      const rects = cards.map((c) => c.getBoundingClientRect());
      const cs = cards[0] ? getComputedStyle(cards[0]) : null;
      const icon = document.querySelector('.kn-empty-ico svg');
      const title = document.querySelector('.kn-empty-title');
      const search = document.getElementById('knFileSearch');
      const upload = document.getElementById('btnKnUpload');
      return {
        cards: cards.length,
        sameRow: rects.length === 3 && rects.every((r) => Math.abs(r.top - rects[0].top) <= 1),
        equalW: rects.length === 3 && rects.every((r) => Math.abs(r.width - rects[0].width) <= 1),
        cardW: rects[0] ? Math.round(rects[0].width) : 0,
        radius: cs ? parseFloat(cs.borderTopLeftRadius) : 0,
        borderW: cs ? parseFloat(cs.borderTopWidth) : 0,
        iconW: icon ? Math.round(icon.getBoundingClientRect().width) : 0,
        titleSize: title ? parseFloat(getComputedStyle(title).fontSize) : 0,
        searchH: Math.round(search.getBoundingClientRect().height),
        searchRadius: parseFloat(getComputedStyle(search).borderTopLeftRadius),
        uploadH: Math.round(upload.getBoundingClientRect().height),
        // 「右上角」= 贴着它自己那一行的右边，且排在标题右边
        uploadGap: Math.round(document.querySelector('.kn-files-head').getBoundingClientRect().right
          - upload.getBoundingClientRect().right),
        uploadAfterTitle: upload.getBoundingClientRect().left
          >= document.querySelector('.kn-files-head .kn-sub').getBoundingClientRect().right - 1,
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        sizes: [...new Set([...document.querySelectorAll('[data-knpane="files"] *')]
          .filter((e) => !(e instanceof SVGElement) && !e.children.length && e.textContent.trim())
          .map((e) => parseFloat(getComputedStyle(e).fontSize)))].sort((a, b) => a - b)
      };
    });
    need(kf.cards === 3 && kf.sameRow && kf.equalW, '三张说明卡没排成一行等宽：' + kf.cards + ' / ' + kf.sameRow + ' / ' + kf.equalW);
    need(kf.radius >= 12 && kf.borderW <= 1, '说明卡圆角/边框不对：r' + kf.radius + ' / b' + kf.borderW);
    need(kf.iconW >= 32 && kf.iconW <= 48, '空状态文档图标尺寸异常：' + kf.iconW);
    need(kf.titleSize === 14, '空状态标题字号不是 14px：' + kf.titleSize);
    need(kf.searchH >= 30 && kf.searchH <= 38 && kf.searchRadius >= 6, '检索框尺寸/圆角不对：' + kf.searchH + ' / r' + kf.searchRadius);
    need(kf.uploadH >= 30 && kf.uploadH <= 38 && kf.uploadGap <= 2 && kf.uploadAfterTitle,
      'Upload files 不在标题区右上角：h' + kf.uploadH + ' / 距右 ' + kf.uploadGap + ' / 在标题后 ' + kf.uploadAfterTitle);
    need(kf.overflowX <= 1, 'Knowledge files 横向溢出 ' + kf.overflowX + 'px');
    need(kf.sizes.every((x) => [12, 13, 14, 16, 20, 26].includes(x)), 'Knowledge files 出现计划外字号：' + kf.sizes.join(','));
    await page.screenshot({ path: path.join(SHOT_DIR, 'knowledge-files.png') });

    await page.evaluate(() => document.querySelector('.kn-tab[data-kntab="overview"]').click());
    await sleep(200);

    await page.evaluate(() => document.querySelector('.st-item[data-st="plugins"]').click());
    await sleep(800);
    const stPl = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('#stToolsSlot .app-card')];
      return {
        tools: cards.length,
        logos: document.querySelectorAll('#stToolsSlot .app-logo svg').length,
        cardW: cards.length ? Math.round(cards[0].getBoundingClientRect().width) : 0,
        cardH: cards.length ? Math.round(cards[0].getBoundingClientRect().height) : 0,
        installs: document.querySelectorAll('#stToolsSlot [data-act="install"]').length,
        // 已安装未授权的应用显示的是「授权」，所以判据是「每张卡都有操作按钮」
        actions: [...document.querySelectorAll('#stToolsSlot .app-card')].filter((c) => c.querySelector('[data-act]')).length,
        skills: document.querySelectorAll('.skill-row').length,
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        sizes: [...new Set([...document.querySelectorAll('#stToolsSlot *')]
          .filter((e) => !(e instanceof SVGElement) && !e.children.length && e.textContent.trim())
          .map((e) => parseFloat(getComputedStyle(e).fontSize)))].sort((a, b) => a - b)
      };
    });
    await page.screenshot({ path: path.join(SHOT_DIR, 'strategy-plugins.png') });
    need(stPl.tools >= 12, '应用目录不足 12 个：' + stPl.tools);
    need(stPl.logos === stPl.tools, '有应用没图标：' + stPl.logos + '/' + stPl.tools);
    need(stPl.actions === stPl.tools, '有应用没给任何操作按钮：' + stPl.actions + '/' + stPl.tools);
    need(stPl.cardW >= 380 && stPl.cardW <= 520, '应用卡片宽度异常：' + stPl.cardW);
    need(stPl.cardH >= 90 && stPl.cardH <= 140, '应用卡片高度异常（信息挤）：' + stPl.cardH);
    need(stPl.skills === 4, '内置技能不是 4 个：' + stPl.skills);
    need(stPl.sizes.every((x) => [12, 13, 14, 16, 20, 26].includes(x)), '插件区出现计划外字号：' + stPl.sizes.join(','));
    need(stPl.overflowX <= 1, 'Plugins 横向溢出 ' + stPl.overflowX + 'px');

    /* ================= Report ================= */
    await page.evaluate(() => document.querySelector('.nav-item[data-view="report"]').click());
    await sleep(600);
    const report = await page.evaluate(() => ({
      cards: document.querySelectorAll('.stat-card').length,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth
    }));
    need(report.cards >= 6, 'Report 指标卡太少：' + report.cards);
    need(report.overflowX <= 1, 'Report 横向溢出 ' + report.overflowX + 'px');

    console.log('Dashboard：' + JSON.stringify({ ...dash, fontSizes: dm.sizes }));
    console.log('字体：' + JSON.stringify(font));
    console.log('卡片几何：' + JSON.stringify(geom));
    console.log('视觉体检：' + JSON.stringify(visual));
    console.log('Dashboard 对比度：' + dm.contrasts.map((c) => `${c.name} ${c.ratio}:1`).join(' · '));
    console.log('详情面板：' + JSON.stringify(detail));
    console.log('接入弹窗：' + JSON.stringify(modal));
    console.log('Content：' + JSON.stringify(content));
    console.log('Content 对比度：' + cm.contrasts.map((c) => `${c.name} ${c.ratio}:1`).join(' · '));
    console.log('Strategy：' + JSON.stringify(st));
    console.log('Strategy 知识库：' + JSON.stringify(stKn));
    console.log('Strategy GSC：' + JSON.stringify(stAudit));
    console.log('Strategy 插件/技能：' + JSON.stringify(stPl));
    console.log('Planning：' + JSON.stringify(cal));
    console.log('Report：' + JSON.stringify(report));
    console.log('控制台错误：' + (errors.length ? errors.join(' | ') : '0'));
    need(errors.length === 0, '控制台有错误');

    if (fails.length) { console.error('\n✗ UI 验收失败 ' + fails.length + ' 项：\n - ' + fails.join('\n - ')); process.exitCode = 1; }
    else console.log('\n✓ UI 验收全部通过');
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error('验收失败：' + e.message); process.exit(1); });
