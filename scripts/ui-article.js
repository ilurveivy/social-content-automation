'use strict';
/**
 * scripts/ui-article.js —— Article 编辑器真实点击验收
 * Write / Settings / Audience / 右侧 GEO&SEO 面板 / Socials / 发布 / 列表回跳
 */
const path = require('path');
const puppeteer = require(path.join(__dirname, '..', '..', 'node_modules', 'puppeteer-core'));

const EXE = process.env.SCA_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.env.SCA_BASE || 'http://127.0.0.1:4319';
const SHOT_DIR = path.join(__dirname, '..', '_shots');

let pass = 0;
const fails = [];
function chk(ok, label, detail) {
  if (ok) { pass++; console.log('  ok  ' + label + (detail ? '  → ' + detail : '')); }
  else { fails.push(label + (detail ? '  → ' + detail : '')); console.log('  ✗   ' + label + (detail ? '  → ' + detail : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function click(page, sel) {
  const ok = await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return false;
    el.click();
    return true;
  }, sel);
  if (!ok) throw new Error('点不到：' + sel);
  await sleep(220);
}

async function setVal(page, sel, value) {
  await page.evaluate((s, v) => {
    const el = document.querySelector(s);
    if (!el) throw new Error('没有 ' + s);
    el.focus();
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, sel, value);
  await sleep(160);
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-first-run', '--no-default-browser-check'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push('console: ' + m.text()); });
  page.on('dialog', (d) => d.accept());

  const before = await page.evaluate(() => 0).catch(() => 0);
  await page.goto(BASE, { waitUntil: 'networkidle2' });
  await sleep(700);

  const baseline = await page.evaluate(() => fetch('/api/content?group=content&size=200').then((r) => r.json()));
  const baseIds = baseline.items.map((i) => i.id);

  try {
    /* ---------- 从列表建一篇文章并进编辑器 ---------- */
    await click(page, '.nav-item[data-view="content"]');
    await sleep(900);
    await page.evaluate(() => window.CL.open());
    await sleep(400);

    const created = await page.evaluate(async () => {
      const r = await fetch('/api/content', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'article', title: 'Untitled article' })
      }).then((x) => x.json());
      await window.CL.load();
      await window.CL.openEditorById(r.item.id);
      return r.item.id;
    });
    await page.waitForFunction(() => !document.getElementById('view-article').classList.contains('hidden'), { timeout: 10000, polling: 100 });
    await sleep(900);
    chk(!!created, '从 Content 列表点进文章编辑器', created);

    const head = await page.evaluate(() => {
      const box = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) }; };
      return {
        head: box('.ar-head'),
        tabs: [...document.querySelectorAll('.ar-tab')].map((t) => t.textContent.trim()),
        onTab: (document.querySelector('.ar-tab.is-on') || {}).textContent,
        title: (document.getElementById('arTitleBtn') || {}).textContent,
        pill: (document.getElementById('arStatusPill') || {}).textContent,
        metrics: [...document.querySelectorAll('.ar-metric')].map((m) => m.textContent.trim()),
        right: ['arChat', 'arComments', 'arCollab', 'arPublish', 'arMore'].map((id) => !!document.getElementById(id)),
        close: !!document.getElementById('arClose')
      };
    });
    chk(head.head && head.head.h >= 56 && head.head.h <= 68, '顶部栏高度 56–68px', String(head.head && head.head.h));
    chk(JSON.stringify(head.tabs) === JSON.stringify(['Write', 'Settings', 'Audience']), '三个 Tab：Write / Settings / Audience', head.tabs.join('/'));
    chk(head.onTab === 'Write', '默认选中 Write', head.onTab);
    chk(head.title === 'Untitled article', '顶部显示标题', head.title);
    chk(head.pill === 'Draft', '顶部状态标签 Draft', head.pill);
    chk(head.metrics.length === 3 && /GEO & SEO/.test(head.metrics[0]) && /Readability/.test(head.metrics[1]) && /Content Gap/.test(head.metrics[2]), '左侧三个指标标签', head.metrics.join(' · '));
    chk(head.right.every(Boolean), '右上角 Chat / 评论 / Collaborate / Publish / 更多 都在', head.right.join(','));
    chk(head.close, '有关闭按钮');

    /* ---------- Write 面板 ---------- */
    const write = await page.evaluate(() => ({
      h1: !!document.getElementById('arH1'),
      hint: (document.getElementById('arHint') || {}).textContent,
      starters: [...document.querySelectorAll('.ar-start b')].map((x) => x.textContent),
      tools: [...document.querySelectorAll('.ar-toolbar [data-md]')].map((x) => x.dataset.md),
      body: !!document.getElementById('arBody'),
      words: (document.getElementById('arWords') || {}).textContent
    }));
    chk(write.h1, '有大标题占位框');
    chk(write.hint === 'Press Enter to continue with an empty page, or pick a template (↑↓ to select)', '提示文案逐字', write.hint);
    chk(JSON.stringify(write.starters) === JSON.stringify(['Start from scratch', 'Write article with AI']), '两个起始选项', write.starters.join(' / '));
    chk(write.tools.length >= 9, '富文本工具条（粗体/斜体/H2/列表/引用/代码/链接/图片）', write.tools.join(','));
    chk(/0 words/.test(write.words || ''), '字数统计从 0 开始', write.words);
    await page.screenshot({ path: path.join(SHOT_DIR, 'v12-article-empty.png') });

    /* ---------- 右侧 SEO 面板 ---------- */
    const rail = await page.evaluate(() => ({
      head: (document.querySelector('.ar-rail-head h3') || {}).textContent,
      kw: !!document.getElementById('arKeyword'),
      locs: document.querySelectorAll('.ar-loc select').length,
      cards: [...document.querySelectorAll('.ar-card b')].map((x) => x.textContent),
      alerts: [...document.querySelectorAll('.ar-alert-label')].map((x) => x.textContent),
      shows: document.querySelectorAll('.ar-show').length
    }));
    chk(rail.head === 'Optimize for GEO & SEO', '右侧面板标题', rail.head);
    chk(rail.kw, 'Focus keyword 输入框');
    chk(rail.locs === 2, 'Search localization：地区 + 语言两个选择器', String(rail.locs));
    const wantCards = ['Content gap insights', 'GEO & SEO basics', 'Readability & structure', 'Plagiarism check', 'Word count'];
    chk(wantCards.every((c) => rail.cards.includes(c)), '五个模块卡片齐全', rail.cards.join(' · '));
    chk(rail.alerts.includes('Keyword length') && rail.alerts.includes('Text length') && rail.alerts.includes('Meta description length') && rail.alerts.includes('SEO title width'), '告警清单包含未填关键词 / 字数 / meta / SEO 标题', rail.alerts.slice(0, 6).join(','));
    chk(rail.shows >= 5, '每条告警都有 show 链接', String(rail.shows));

    /* ---------- 写正文 → 分数真的变 ---------- */
    const longBody = [
      '# 用 AI 把一篇母文章拆成七个渠道',
      '',
      '## 为什么先写母文章',
      '',
      '一篇文章写透，再从里面派生社媒帖、邮件和落地页，比每个渠道各写一遍稳定得多。',
      '',
      '## 关键词与结构',
      '',
      'ai content workflow 这套流程的关键不是模型多强，而是规则可验证：每条规则都有出处，跑不过就是跑不过。',
      '',
      '- 母文章定主张',
      '- 社媒帖定钩子',
      '- 落地页定证据',
      '',
      '> 一份素材，七个渠道，规则带出处。',
      '',
      '参考 [我们的方法论](https://example.com/method)，里面写了 36 条渠道规则。',
      '',
      '```',
      'npm run verify:all',
      '```',
      ''
    ].join('\n') + Array.from({ length: 12 }).map((_, i) => `第 ${i + 1} 段补充说明：把结论放前面，用具体的数字和例子说话，不堆形容词。`).join('\n\n');

    await setVal(page, '#arBody', longBody);
    await sleep(1400); // 等自动保存
    const afterSave = await page.evaluate(async () => {
      const d = await fetch('/api/article/' + encodeURIComponent(window.AR.data.item.id)).then((r) => r.json());
      return { words: d.report.words, seo: d.report.seo.pct, a11y: d.report.readability.pct, saved: (document.getElementById('arSaved') || {}).textContent };
    });
    chk(afterSave.words > 200, '正文写进去后词数上去了', afterSave.words + ' words');
    chk(/已保存/.test(afterSave.saved || ''), '自动保存提示', afterSave.saved);
    chk(afterSave.seo > 20, 'GEO & SEO 分数跟着涨', afterSave.seo + '%');

    await setVal(page, '#arKeyword', 'ai content workflow');
    await sleep(1200);
    const kwScore = await page.evaluate(() => ({
      seo: window.AR.data.report.seo.pct,
      alertKeys: window.AR.data.report.alerts.map((a) => a.key),
      metric: (document.getElementById('arMSeo') || {}).textContent
    }));
    chk(kwScore.seo > afterSave.seo, '填了关键词，SEO 分继续涨', afterSave.seo + '% → ' + kwScore.seo + '%');
    chk(!kwScore.alertKeys.includes('keyword'), '关键词告警消失');
    chk(/GEO & SEO/.test(kwScore.metric || ''), '顶部指标同步刷新', kwScore.metric);

    /* ---------- 告警 show 跳到 Settings ---------- */
    const jumped = await page.evaluate(async () => {
      const btn = [...document.querySelectorAll('.ar-show')].find((b) => b.dataset.field === 'metaDescription' || b.dataset.field === 'seoTitle');
      if (!btn) return { clicked: false };
      btn.click();
      await new Promise((r) => setTimeout(r, 400));
      return {
        clicked: true,
        tab: (document.querySelector('.ar-tab.is-on') || {}).textContent,
        sub: (document.querySelector('.ar-sub.is-on') || {}).textContent,
        focused: document.activeElement ? document.activeElement.id : ''
      };
    });
    chk(jumped.clicked && jumped.tab === 'Settings', '点 show 跳到 Settings', jumped.tab);
    chk(jumped.sub === 'SEO settings', '自动切到 SEO settings 子页', jumped.sub);
    chk(jumped.focused === 'arMeta' || jumped.focused === 'arSeoTitle', '目标字段拿到焦点', jumped.focused);
    await page.screenshot({ path: path.join(SHOT_DIR, 'v12-article-settings.png') });

    /* ---------- Settings：三个子页 ---------- */
    const subs = await page.evaluate(() => [...document.querySelectorAll('.ar-sub')].map((b) => b.textContent.trim()));
    chk(JSON.stringify(subs) === JSON.stringify(['Article details', 'SEO settings', 'Custom fields']), 'Settings 三个子页', subs.join(' / '));

    const seoFields = await page.evaluate(() => ({
      serp: !!document.querySelector('.ar-serp'),
      seoTitle: !!document.getElementById('arSeoTitle'),
      slug: !!document.getElementById('arSlug'),
      meta: !!document.getElementById('arMeta'),
      count: (document.getElementById('arMetaCount') || {}).textContent
    }));
    chk(seoFields.serp, '搜索结果预览卡片');
    chk(seoFields.seoTitle && seoFields.slug && seoFields.meta, 'SEO 标题 / Slug / Meta description 三个字段');
    chk(/\/ 160/.test(seoFields.count || ''), 'meta description 带字符计数', seoFields.count);

    // Auto-fill meta description
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('[data-fill="metaDescription"]')].find((x) => x.dataset.mode === 'rule');
      b.click();
    });
    await sleep(1100);
    const filled = await page.evaluate(() => ({
      meta: window.AR.data.article.metaDescription,
      seo: window.AR.data.report.seo.pct,
      alertKeys: window.AR.data.report.alerts.map((a) => a.key)
    }));
    chk((filled.meta || '').length >= 100, 'Auto-fill 把 meta description 填出来了', (filled.meta || '').length + ' 字符');
    chk(!filled.alertKeys.includes('metaDescription'), 'meta description 告警消失');

    // Auto-fill SEO title
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('[data-fill="seoTitle"]')].find((x) => x.dataset.mode === 'rule');
      b.click();
    });
    await sleep(1000);
    const seoT = await page.evaluate(() => ({ v: window.AR.data.article.seoTitle, alerts: window.AR.data.report.alerts.map((a) => a.key) }));
    chk((seoT.v || '').length >= 30 && seoT.v.length <= 60, 'Auto-fill 的 SEO 标题长度在 30–60', (seoT.v || '').length + ' 字符');

    // Custom fields
    await page.evaluate(() => document.querySelector('.ar-sub[data-arsub="custom"]').click());
    await sleep(400);
    const custom = await page.evaluate(() => ({
      icp: !!document.getElementById('arIcp'),
      kpi: !!document.getElementById('arKpi'),
      footer: !!document.getElementById('arFooter'),
      icpOpts: [...document.querySelectorAll('#arIcp option')].map((o) => o.textContent)
    }));
    chk(custom.icp && custom.kpi && custom.footer, 'Custom fields：ICP / KPI / 底部链接');
    chk(custom.icpOpts.some((t) => /出海 SaaS 创始人/.test(t)), 'ICP 下拉来自 Company Knowledge 的受众', custom.icpOpts.join(' | ').slice(0, 60));
    await setVal(page, '#arKpi', '本季度 50 个注册');
    await sleep(900);
    const kpiSaved = await page.evaluate(() => window.AR.data.article.custom.kpi);
    chk(kpiSaved === '本季度 50 个注册', '自定义字段能存住', kpiSaved);

    // Article details
    await page.evaluate(() => document.querySelector('.ar-sub[data-arsub="details"]').click());
    await sleep(400);
    const details = await page.evaluate(() => ({
      cover: document.querySelectorAll('.ar-cover-acts .btn').length,
      excerpt: !!document.getElementById('arExcerpt'),
      author: !!document.getElementById('arAuthor'),
      category: !!document.getElementById('arCategory'),
      tags: !!document.getElementById('arTags'),
      due: !!document.getElementById('arDue'),
      language: !!document.getElementById('arLanguage')
    }));
    chk(details.cover === 3, '封面三个按钮 Upload / Generate / Library', String(details.cover));
    chk(details.excerpt && details.author && details.category && details.tags && details.due && details.language, '摘要 / 作者 / 分类 / 标签 / 截止日 / 语言 都在');
    await setVal(page, '#arExcerpt', '一句话摘要：一篇母文章派生七个渠道。');
    await sleep(900);
    const excerpt = await page.evaluate(() => window.AR.data.article.excerpt);
    chk(/一句话摘要/.test(excerpt || ''), '摘要能存住', excerpt);

    /* ---------- Audience ---------- */
    await click(page, '.ar-tab[data-artab="audience"]');
    await sleep(500);
    const aud = await page.evaluate(() => ({
      cats: [...document.querySelectorAll('.ar-cat-name')].map((x) => x.textContent),
      on: (document.querySelector('.ar-cat.is-on .ar-cat-name') || {}).textContent,
      bodyTitle: (document.querySelector('.ar-cat-head h2') || {}).textContent,
      empty: !!document.querySelector('.ar-empty'),
      addBtn: (document.querySelector('.ar-cat-body .btn-primary') || {}).textContent
    }));
    const wantCats = ['Personal websites', 'Content hubs', 'Employee advocacy', 'Email marketing', 'Mobile platforms', 'Social networks'];
    chk(JSON.stringify(aud.cats) === JSON.stringify(wantCats), '左侧六个渠道分类', aud.cats.join(' / '));
    chk(aud.on === 'Personal websites', '默认选中 Personal websites', aud.on);
    chk(aud.bodyTitle === 'Personal websites', '右侧标题跟着变', aud.bodyTitle);
    chk(aud.empty && /Add your websites/.test(aud.addBtn || ''), '未绑定站点时是空状态 + Add your websites', aud.addBtn);
    await page.screenshot({ path: path.join(SHOT_DIR, 'v12-article-audience.png') });

    // 未接入的分类要如实说
    await page.evaluate(() => document.querySelector('.ar-cat[data-cat="hubs"]').click());
    await sleep(350);
    const hub = await page.evaluate(() => (document.querySelector('.ar-cat-body .ar-empty p') || {}).textContent);
    chk(/还没接入/.test(hub || ''), 'Content hubs 如实说没接入', hub);

    /* ---------- Social networks → 右侧变 Socials 面板 ---------- */
    await page.evaluate(() => document.querySelector('.ar-cat[data-cat="social"]').click());
    await sleep(500);
    const soc0 = await page.evaluate(() => ({
      railHead: (document.querySelector('.ar-rail-head h3') || {}).textContent,
      empty: (document.querySelector('.ar-social-empty') || {}).textContent,
      acts: [...document.querySelectorAll('.ar-social-acts .btn')].map((b) => b.textContent.trim()),
      platforms: [...document.querySelectorAll('.ar-platform-name')].map((x) => x.textContent),
      offs: [...document.querySelectorAll('.ar-platform.is-off .ar-platform-name')].map((x) => x.textContent)
    }));
    chk(soc0.railHead === 'Socials', '右侧面板切成 Socials', soc0.railHead);
    chk(soc0.empty === 'No social posts found for this article.', '空状态文案逐字', soc0.empty);
    chk(soc0.acts.includes('Create social post') && soc0.acts.includes('Create with AI'), '两个按钮：Create social post / Create with AI', soc0.acts.join(' / '));
    chk(soc0.platforms.length === 6, '六个平台都在列表里', soc0.platforms.join(' / '));
    chk(soc0.offs.length === 4, '没做渠道规则的平台如实标未支持', soc0.offs.join(' / '));

    await page.evaluate(() => document.querySelector('[data-soc-new]').click());
    await sleep(900);
    const soc1 = await page.evaluate(() => ({
      cards: document.querySelectorAll('.ar-social').length,
      editing: document.querySelectorAll('.ar-social.is-editing').length,
      textarea: !!document.querySelector('.ar-social-body')
    }));
    chk(soc1.cards === 1, 'Create social post 建出一条子资产', String(soc1.cards));
    chk(soc1.editing === 1 && soc1.textarea, '新帖直接进编辑态');

    await setVal(page, '.ar-social-body', '一篇母文章，七个渠道，规则带出处。 ai content workflow');
    await page.evaluate(() => document.querySelector('[data-soc-save]').click());
    await sleep(900);
    const soc2 = await page.evaluate(() => ({
      cards: document.querySelectorAll('.ar-social').length,
      text: (document.querySelector('.ar-social-text') || {}).textContent,
      items: window.AR.data.socials.length
    }));
    chk(soc2.items === 1 && /一篇母文章/.test(soc2.text || ''), '社媒帖存住了', (soc2.text || '').slice(0, 24));

    // 子资产要能在 Content 列表里独立出现
    const listed = await page.evaluate(() => fetch('/api/content?group=social&size=50').then((r) => r.json()));
    chk(listed.items.some((i) => /一篇母文章/.test(JSON.stringify(i)) || i.campaignId), '社媒帖同步进 Content 列表（独立子资产）', listed.total + ' 条社媒');

    await page.evaluate(() => document.querySelector('[data-soc-ai]').click());
    await sleep(1200);
    const soc3 = await page.evaluate(() => window.AR.data.socials.length);
    chk(soc3 === 2, 'Create with AI 再生成一条', String(soc3));
    await page.screenshot({ path: path.join(SHOT_DIR, 'v12-article-socials.png') });

    /* ---------- 发布 ---------- */
    await page.evaluate(() => document.getElementById('arPublish').click());
    await sleep(300);
    const pubMenu = await page.evaluate(() => [...document.querySelectorAll('.ar-pop .cl-menu-item')].map((b) => b.textContent.trim().slice(0, 6)));
    chk(pubMenu.length === 3, 'Publish 菜单三项：立即 / 定时 / 审核', pubMenu.join(' / '));
    await page.evaluate(() => [...document.querySelectorAll('.ar-pop [data-pub]')].find((b) => b.dataset.pub === 'review').click());
    await sleep(1000);
    const pub = await page.evaluate(() => ({ pill: (document.getElementById('arStatusPill') || {}).textContent, status: window.AR.data.item.status }));
    chk(pub.status === 'pending' && pub.pill === 'Pending approval', '提交审核 → Pending approval', pub.status);

    /* ---------- 回列表 ---------- */
    const geoInEditor = await page.evaluate(() => window.AR.data.report.seo.pct);
    await page.evaluate(() => document.getElementById('arClose').click());
    await sleep(800);
    const back = await page.evaluate(() => ({
      hidden: document.getElementById('view-article').classList.contains('hidden'),
      list: !document.getElementById('contentList').classList.contains('hidden'),
      rows: document.querySelectorAll('.cl-row').length
    }));
    chk(back.hidden, '× 关掉编辑器');
    chk(back.list && back.rows > 0, '回到 Content 列表', back.rows + ' 行');

    const inList = await page.evaluate(async (id) => {
      const r = await fetch('/api/content?group=content&size=100').then((x) => x.json());
      return r.items.some((i) => i.id === id);
    }, created);
    const rowVisible = await page.evaluate(() => [...document.querySelectorAll('.cl-row')].some((r) => /Untitled article/.test(r.textContent)));
    chk(inList && rowVisible, '新建的文章回到列表里能看到', 'api=' + inList + ' dom=' + rowVisible);

    /* ---------- 列表里的 GEO & SEO / Content gap 列：article 是真数，其它类型仍是 — ---------- */
    const cols = await page.evaluate(async () => {
      const ths = [...document.querySelectorAll('thead th')].map((t) => t.textContent.trim());
      const geoIdx = ths.indexOf('GEO & SEO score');
      const gapIdx = ths.indexOf('Content gap score');
      const cells = (title) => {
        // 只认标题单元格：campaign 列也叫 "Untitled article"，用整行 textContent 会错抓到社媒行
        const row = [...document.querySelectorAll('.cl-row')].find((r) => {
          const t = r.querySelector('.cl-title');
          return t && t.textContent.trim() === title;
        });
        if (!row) return null;
        const td = [...row.querySelectorAll('td')];
        return { geo: (td[geoIdx] || {}).textContent, gap: (td[gapIdx] || {}).textContent };
      };
      const api = await fetch('/api/content?group=content&size=100').then((x) => x.json());
      const apiArt = api.items.filter((i) => i.type === 'article').map((i) => ({ title: i.title, geo: i.geo, assetId: !!i.assetId }));
      return { geoIdx, gapIdx, art: cells('Untitled article'), social: cells('r/SaaS post'), apiArt };
    });
    chk(cols.geoIdx > 0 && cols.gapIdx > 0, '表里有 GEO & SEO / Content gap 两列', cols.geoIdx + '/' + cols.gapIdx);
    chk(!!cols.art && cols.art.geo === geoInEditor + '%', 'article 行的 GEO 分 === 编辑器里的分', (cols.art && cols.art.geo) + ' vs ' + geoInEditor + '%');
    chk(!!cols.art && /%$/.test(cols.art.gap || ''), 'article 行的 Content gap 也是真百分比', cols.art && cols.art.gap);
    chk(!!cols.social && cols.social.geo === '—' && cols.social.gap === '—', '社媒行两列仍是 —（没数据源不编数字）', JSON.stringify(cols.social));

    /* ---------- 收尾 ---------- */
    const cleanup = await page.evaluate(async (base) => {
      const list = await fetch('/api/content?group=content&size=200').then((r) => r.json());
      let n = 0;
      for (const it of list.items) {
        if (!base.includes(it.id)) { await fetch('/api/content/' + encodeURIComponent(it.id), { method: 'DELETE' }); n++; }
      }
      const after = await fetch('/api/content?group=content&size=200').then((r) => r.json());
      return { removed: n, left: after.total };
    }, baseIds);
    chk(cleanup.removed >= 2, '测试数据已清理', JSON.stringify(cleanup));
    chk(cleanup.left === baseIds.length, '内容条数回到基线', cleanup.left + ' / ' + baseIds.length);

    /* ---------- Planning 日历里点文章 → 也进这个编辑器 ---------- */
    await click(page, '.nav-item[data-view="planning"]');
    await sleep(900);
    const calPick = await page.evaluate(async () => {
      const chips = [...document.querySelectorAll('#calGrid .cal-chip, #calUnscheduled .cal-chip')];
      for (const c of chips) {
        const id = 'ct_as_' + c.dataset.aid;
        const r = await fetch('/api/content/' + encodeURIComponent(id)).then((x) => (x.ok ? x.json() : null)).catch(() => null);
        if (r && r.item && r.item.type === 'article') return { aid: c.dataset.aid, title: r.item.title };
      }
      return null;
    });
    chk(!!calPick, '日历里能找到一条文章类内容', calPick && calPick.title);
    if (calPick) {
      await page.evaluate((aid) => {
        const c = [...document.querySelectorAll('#calGrid .cal-chip, #calUnscheduled .cal-chip')].find((x) => x.dataset.aid === aid);
        c.click();
      }, calPick.aid);
      await sleep(1500);
      const calOpen = await page.evaluate(() => ({
        article: !document.getElementById('view-article').classList.contains('hidden'),
        old: !document.getElementById('contentEditor').classList.contains('hidden'),
        title: (document.getElementById('arTitleBtn') || {}).textContent
      }));
      chk(calOpen.article && !calOpen.old, '点日历里的文章 → 进三 Tab 编辑器（不是老编辑器）', JSON.stringify(calOpen));
      chk(calOpen.title === calPick.title, '打开的就是那一条', calOpen.title + ' vs ' + calPick.title);
      await page.evaluate(() => document.getElementById('arClose').click());
      await sleep(700);
      const calBack = await page.evaluate(() => ({
        hidden: document.getElementById('view-article').classList.contains('hidden'),
        rows: document.querySelectorAll('.cl-row').length
      }));
      chk(calBack.hidden && calBack.rows > 0, '× 关掉后落在内容列表', String(calBack.rows));
    }

    chk(consoleErrors.length === 0, '控制台 0 报错', consoleErrors.slice(0, 3).join(' | '));
  } catch (e) {
    fails.push('异常中断：' + e.message);
    console.log('  ✗   异常中断：' + e.message);
  }

  await browser.close();
  console.log('');
  if (fails.length) {
    console.log('✗ 失败 ' + fails.length + ' / ' + (pass + fails.length));
    fails.forEach((f) => console.log(' - ' + f));
    process.exit(1);
  }
  console.log('✓ Article 交互验收全部通过 ' + pass + ' 项');
})().catch((e) => { console.error(e); process.exit(1); });
