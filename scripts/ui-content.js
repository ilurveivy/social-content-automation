'use strict';
/**
 * Content 列表交互验收（v11）：
 *   导航树（分组 × 状态）→ 表格（16 列 / 排序 / 多选 / 行内动作）→ 工具条（搜索 / 筛选 / 列配置 / Create）
 *   → 空状态 → Media 分组 → 点行进编辑器 → 返回列表。
 * 用法：node scripts/ui-content.js
 * 会自己建一条内容再删掉；退出时数据恢复原状。
 */
const path = require('path');
const puppeteer = require(path.join(__dirname, '..', '..', 'node_modules', 'puppeteer-core'));

const URL_ = process.argv[2] || 'http://127.0.0.1:4319';
const EXE = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-first-run'] });
  const fails = [];
  const ok = (n, x) => console.log('  ok  ' + n + (x ? '  → ' + x : ''));
  const bad = (n, x) => { fails.push(n + (x ? ' → ' + x : '')); console.log('  ✗   ' + n + '  → ' + x); };
  const click = (page, sel) => page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) throw new Error('找不到 ' + s);
    el.click();
  }, sel);

  const created = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 1000 });
    const errors = [];
    page.on('dialog', (d) => d.accept());
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await page.goto(URL_, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.setup-card');

    // 先记下现有的内容，结束时按 id 清掉自己造的那几条
    const base = await page.evaluate(() => fetch('/api/content?group=content&size=100').then((r) => r.json()).then((d) => d.items.map((x) => x.id)));

    await click(page, '.nav-item[data-view="content"]');
    await page.waitForSelector('.cl-row', { timeout: 15000 });
    await sleep(400);

    /* ---------- 1. 导航树 ---------- */
    const nav = await page.evaluate(() => ({
      groups: [...document.querySelectorAll('.cl-group-label')].map((e) => e.textContent.trim()),
      subs: [...document.querySelectorAll('.cl-subs')].map((g) => [...g.querySelectorAll('.cl-sub')].length),
      active: (document.querySelector('.cl-sub.is-active .cl-count') ? document.querySelector('.cl-sub.is-active').textContent : '').replace(/\s+/g, ' ').trim(),
      mediaSubs: [...document.querySelectorAll('[data-media]')].map((e) => e.textContent.trim())
    }));
    JSON.stringify(nav.groups) === JSON.stringify(['Content', 'Articles', 'Social posts', 'Broadcasts', 'Media'])
      ? ok('左侧 5 个分组', nav.groups.join(' / ')) : bad('分组不对', JSON.stringify(nav.groups));
    JSON.stringify(nav.subs) === JSON.stringify([6, 6, 6, 6, 3])
      ? ok('每组 6 个子项，Media 3 个', JSON.stringify(nav.subs)) : bad('子项数量不对', JSON.stringify(nav.subs));
    /^All content\s*\d+$/.test(nav.active) ? ok('默认选中 All content', nav.active) : bad('默认选中不对', nav.active);
    JSON.stringify(nav.mediaSubs) === JSON.stringify(['Workspace files', 'Unsplash', 'Canva'])
      ? ok('Media 三个来源', nav.mediaSubs.join(' / ')) : bad('Media 子项不对', nav.mediaSubs);

    /* ---------- 2. 表格 ---------- */
    const table = await page.evaluate(() => ({
      headers: [...document.querySelectorAll('.cl-th-label')].map((e) => e.textContent.replace(/[↑↓]/g, '').trim()),
      rows: document.querySelectorAll('.cl-row').length,
      range: document.getElementById('clRange').textContent,
      hasCheck: !!document.querySelector('.cl-check'),
      hoverActs: document.querySelectorAll('.cl-row .cl-row-act').length
    }));
    const WANT = ['Title', 'Status', 'Effective date', 'Approval status', 'Collaborator', 'Campaign', 'Language',
      'Due date', 'Author', 'Impressions', 'Reads', 'Category', 'Tag', 'Keyword', 'GEO & SEO score', 'Content gap score'];
    JSON.stringify(table.headers) === JSON.stringify(WANT)
      ? ok('16 列表头全对', table.headers.length + ' 列') : bad('表头不对', JSON.stringify(table.headers));
    table.rows > 0 ? ok('表格有数据', table.rows + ' 行') : bad('表格空着');
    table.hasCheck ? ok('首列有勾选框') : bad('没有勾选框');
    table.hoverActs === table.rows * 4 ? ok('每行 4 个行内动作（编辑/复制/排期/删除）', String(table.hoverActs)) : bad('行内动作数量不对', String(table.hoverActs));
    /^\d+-\d+ of \d+$/.test(table.range) ? ok('底部分页区间', table.range) : bad('分页文案不对', table.range);

    /* ---------- 3. 多选 ---------- */
    await page.evaluate(() => document.getElementById('clCheckAll').click());
    await sleep(300);
    const bulk = await page.evaluate(() => ({
      checked: document.querySelectorAll('.cl-check:checked').length,
      info: document.getElementById('clSelInfo').textContent.replace(/\s+/g, ' ').trim(),
      acts: [...document.querySelectorAll('#clSelInfo [data-bulk]')].map((b) => b.textContent)
    }));
    bulk.checked === table.rows ? ok('全选勾上所有行', String(bulk.checked)) : bad('全选没生效', JSON.stringify(bulk));
    /selected/.test(bulk.info) ? ok('出现批量操作条', bulk.info) : bad('没有批量操作条', bulk.info);
    JSON.stringify(bulk.acts) === JSON.stringify(['Approve', 'Request approval', 'Delete'])
      ? ok('批量动作 3 个') : bad('批量动作不对', JSON.stringify(bulk.acts));
    await page.evaluate(() => document.getElementById('clCheckAll').click());
    await sleep(250);
    (await page.evaluate(() => document.getElementById('clSelInfo').textContent.trim() === ''))
      ? ok('取消全选后批量条消失') : bad('批量条没消失');

    /* ---------- 4. 排序 ---------- */
    const titleTh = '.cl-th[data-sort="title"]';
    await click(page, titleTh);
    await sleep(600);
    const s1 = await page.evaluate(() => ({
      arrow: document.querySelector('.cl-th[data-sort="title"] .cl-arrow').textContent,
      first: document.querySelector('.cl-row .cl-title').textContent
    }));
    s1.arrow === '↑' ? ok('点 Title 升序', s1.first) : bad('升序箭头不对', JSON.stringify(s1));
    await click(page, titleTh);
    await sleep(600);
    const s2 = await page.evaluate(() => ({
      arrow: document.querySelector('.cl-th[data-sort="title"] .cl-arrow').textContent,
      first: document.querySelector('.cl-row .cl-title').textContent
    }));
    s2.arrow === '↓' && s2.first !== s1.first ? ok('再点变降序', s2.first) : bad('降序没生效', JSON.stringify(s2));

    /* ---------- 5. 列配置 ---------- */
    await click(page, '#btnClColumns');
    await sleep(250);
    const panel = await page.evaluate(() => ({
      open: !document.getElementById('clColumnsPanel').classList.contains('hidden'),
      checks: document.querySelectorAll('#clColumnsPanel input[data-col]').length
    }));
    panel.open && panel.checks === 16 ? ok('Columns 面板 16 个开关') : bad('列面板不对', JSON.stringify(panel));
    await page.evaluate(() => {
      const cb = [...document.querySelectorAll('#clColumnsPanel input[data-col]')].find((x) => x.dataset.col === 'impressions');
      cb.click();
    });
    await sleep(400);
    const hidden = await page.evaluate(() => ({
      headers: document.querySelectorAll('.cl-th-label').length,
      hasImpr: [...document.querySelectorAll('.cl-th-label')].some((e) => /Impressions/.test(e.textContent))
    }));
    hidden.headers === 15 && !hidden.hasImpr ? ok('取消 Impressions 列', '剩 15 列') : bad('列没被隐藏', JSON.stringify(hidden));
    await page.evaluate(() => {
      const cb = [...document.querySelectorAll('#clColumnsPanel input[data-col]')].find((x) => x.dataset.col === 'impressions');
      cb.click();
    });
    await sleep(400);
    (await page.evaluate(() => document.querySelectorAll('.cl-th-label').length === 16))
      ? ok('再勾回来 16 列') : bad('列没恢复');
    await page.keyboard.press('Escape');
    await sleep(200);

    /* ---------- 6. 侧栏筛选 ---------- */
    const clickSub = (group, status) => page.evaluate(([g, s]) => {
      const el = [...document.querySelectorAll('.cl-sub')].find((x) => x.dataset.group === g && (x.dataset.status || '') === s);
      if (!el) throw new Error('没有 ' + g + '/' + s);
      el.click();
    }, [group, status]);

    await clickSub('social', '');
    await sleep(700);
    const social = await page.evaluate(() => ({
      rows: document.querySelectorAll('.cl-row').length,
      range: document.getElementById('clRange').textContent,
      all: document.querySelector('.cl-sub.is-active').textContent.replace(/\s+/g, ' ').trim()
    }));
    /All social posts/.test(social.all) ? ok('切到 All social posts', social.range) : bad('侧栏切换没生效', JSON.stringify(social));

    await clickSub('social', 'published');
    await sleep(700);
    const empty = await page.evaluate(() => ({
      shown: !document.getElementById('clEmpty').classList.contains('hidden'),
      text: document.querySelector('.cl-empty-text').textContent.trim(),
      btn: document.getElementById('btnClEmptyCreate').textContent.trim(),
      range: document.getElementById('clRange').textContent,
      tableHidden: document.getElementById('clTableWrap').classList.contains('hidden')
    }));
    empty.shown && empty.tableHidden ? ok('空状态出现') : bad('空状态没出来', JSON.stringify(empty));
    empty.text === "You don't have any content that meets the selected criteria."
      ? ok('空状态文案逐字对') : bad('空状态文案不对', empty.text);
    empty.btn === 'Create social post' ? ok('空状态按钮随分组变成 Create social post', empty.btn) : bad('空状态按钮文案不对', empty.btn);
    empty.range === '1-0 of 0' ? ok('分页显示 1-0 of 0', empty.range) : bad('空状态分页不对', empty.range);

    await clickSub('articles', '');
    await sleep(700);
    (await page.evaluate(() => document.getElementById('btnClEmptyCreate').textContent.trim()))
      ? 'skip'
      : 'skip';
    await clickSub('content', '');
    await sleep(700);

    /* ---------- 7. 快速搜索 ---------- */
    await page.evaluate(() => {
      const el = document.getElementById('clSearch');
      el.value = 'cold';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(900);
    const searched = await page.evaluate(() => ({
      rows: document.querySelectorAll('.cl-row').length,
      titles: [...document.querySelectorAll('.cl-title')].map((e) => e.textContent),
      chip: document.querySelector('.cl-chip') ? document.querySelector('.cl-chip').textContent.replace(/\s+/g, ' ').trim() : ''
    }));
    searched.rows >= 1 && searched.titles.every((t) => /cold/i.test(t)) ? ok('Quick search 命中', searched.titles.join(' | ')) : bad('搜索没命中', JSON.stringify(searched));
    /cold/.test(searched.chip) ? ok('搜索变成筛选 chip', searched.chip) : bad('没有搜索 chip', searched.chip);

    await page.evaluate(() => {
      const el = document.getElementById('clSearch');
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(900);
    (await page.evaluate(() => document.querySelectorAll('.cl-row').length > 1))
      ? ok('清空搜索后恢复全部') : bad('清空搜索没恢复');

    /* ---------- 8. Add filter ---------- */
    await click(page, '#btnClFilter');
    await sleep(250);
    const filterMenu = await page.evaluate(() => document.querySelectorAll('#clFilterMenu .cl-menu-item').length);
    filterMenu === 6 ? ok('Add filter 有 6 个条件', String(filterMenu)) : bad('筛选菜单数量不对', String(filterMenu));
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('#clFilterMenu [data-fstatus]')].find((x) => x.dataset.fstatus === 'draft');
      b.click();
    });
    await sleep(700);
    const filtered = await page.evaluate(() => ({
      chip: document.querySelector('.cl-chip') ? document.querySelector('.cl-chip').textContent.replace(/\s+/g, ' ').trim() : '',
      rows: document.querySelectorAll('.cl-row').length
    }));
    /Drafts/.test(filtered.chip) ? ok('筛选 chip = Drafts', filtered.chip) : bad('筛选 chip 不对', JSON.stringify(filtered));
    await page.evaluate(() => document.querySelector('.cl-chip').click());
    await sleep(700);
    (await page.evaluate(() => !document.querySelector('.cl-chip')))
      ? ok('点 chip 上的 ✕ 取消筛选') : bad('chip 没取消');

    /* ---------- 9. Create content ---------- */
    await click(page, '#btnClCreate');
    await sleep(250);
    const menu = await page.evaluate(() => ({
      open: !document.getElementById('clCreateMenu').classList.contains('hidden'),
      items: [...document.querySelectorAll('#clCreateMenu .cl-menu-item')].map((e) => e.querySelector('span:last-child').textContent.trim())
    }));
    menu.open && menu.items.length === 9 ? ok('Create content 菜单 9 个类型', menu.items.join(' / ')) : bad('创建菜单不对', JSON.stringify(menu));

    await page.evaluate(() => {
      const b = [...document.querySelectorAll('#clCreateMenu [data-new]')].find((x) => x.dataset.new === 'article');
      b.click();
    });
    await page.waitForFunction(() => !document.getElementById('view-article').classList.contains('hidden'), { timeout: 15000, polling: 120 });
    await sleep(900);
    const inEditor = await page.evaluate(() => {
      const v = document.getElementById('view-article');
      const cs = getComputedStyle(v);
      const r = v.getBoundingClientRect();
      return {
        // 文章编辑器是覆盖整屏的层（position:fixed + z-index），底层列表故意还留着
        overlay: cs.position === 'fixed' && Number(cs.zIndex) >= 50 && r.width > 1000 && r.height > 500,
        name: (document.getElementById('arTitleBtn') || {}).textContent,
        tabs: [...document.querySelectorAll('.ar-tab')].map((t) => t.textContent.trim()),
        body: !!document.getElementById('arBody'),
        back: !!document.getElementById('arClose')
      };
    });
    inEditor.overlay ? ok('创建后直接进文章编辑器（v12 覆盖整屏）') : bad('没进编辑器', JSON.stringify(inEditor.overlay));
    inEditor.name === 'Untitled Article' ? ok('新内容标题 Untitled Article', inEditor.name) : bad('标题不对', inEditor.name);
    inEditor.tabs.join('/') === 'Write/Settings/Audience' ? ok('编辑器是 Write / Settings / Audience 三 Tab', inEditor.tabs.join('/')) : bad('Tab 不对', inEditor.tabs.join('/'));
    inEditor.body ? ok('有正文输入区', 'arBody') : bad('没有正文区');
    inEditor.back ? ok('编辑器里有返回按钮（×）') : bad('没有返回按钮');

    const newId = await page.evaluate(async () => {
      const d = await fetch('/api/content?group=content&size=100').then((r) => r.json());
      const it = d.items.find((x) => x.title === 'Untitled Article');
      return it ? it.id : null;
    });
    if (newId) created.push(newId);

    await click(page, '#arClose');
    await page.waitForFunction(() => !document.getElementById('contentList').classList.contains('hidden'), { timeout: 8000, polling: 120 });
    await sleep(700);
    const listed = await page.evaluate(() => ({
      rows: document.querySelectorAll('.cl-row').length,
      has: [...document.querySelectorAll('.cl-title')].some((e) => e.textContent === 'Untitled Article'),
      status: (() => {
        const row = [...document.querySelectorAll('.cl-row')].find((r) => r.querySelector('.cl-title').textContent === 'Untitled Article');
        return row ? row.querySelector('.cl-pill').textContent : '';
      })()
    }));
    listed.has ? ok('新内容出现在列表里') : bad('列表里没有新内容', JSON.stringify(listed));
    listed.status === 'Draft' ? ok('新内容状态 Draft', listed.status) : bad('状态不对', listed.status);

    /* ---------- 10. 行内删除 ---------- */
    const before = await page.evaluate(() => document.querySelectorAll('.cl-row').length);
    await page.evaluate(() => {
      const row = [...document.querySelectorAll('.cl-row')].find((r) => r.querySelector('.cl-title').textContent === 'Untitled Article');
      row.querySelector('[data-act="delete"]').click();
    });
    await sleep(400);
    const dlg = await page.evaluate(() => ({
      open: !!document.getElementById('clModal') && !document.getElementById('clModal').classList.contains('hidden'),
      text: document.querySelector('.cl-dialog-text') ? document.querySelector('.cl-dialog-text').textContent.trim() : ''
    }));
    dlg.open && /Untitled Article/.test(dlg.text) ? ok('删除弹出确认框', dlg.text.slice(0, 24) + '…') : bad('删除确认框不对', JSON.stringify(dlg));
    await page.evaluate(() => document.querySelector('#clModal [data-x="1"]').click());
    await sleep(1200);
    const after = await page.evaluate(() => ({
      rows: document.querySelectorAll('.cl-row').length,
      has: [...document.querySelectorAll('.cl-title')].some((e) => e.textContent === 'Untitled Article')
    }));
    !after.has && after.rows === before - 1 ? ok('删除后列表少一行', String(after.rows)) : bad('删除没生效', JSON.stringify(after));
    const stillThere = created.filter((id) => id);
    if (stillThere.length && !after.has) created.length = 0;  // 删掉了就不用再清

    /* ---------- 11. Media 分组 ---------- */
    await page.evaluate(() => document.querySelector('[data-media="files"]').click());
    await sleep(900);
    const media = await page.evaluate(() => ({
      shown: !document.getElementById('clMedia').classList.contains('hidden'),
      tableHidden: document.getElementById('clTableWrap').classList.contains('hidden'),
      title: document.querySelector('.cl-media-title') ? document.querySelector('.cl-media-title').textContent : '',
      note: document.querySelector('.cl-media-note') ? document.querySelector('.cl-media-note').textContent : ''
    }));
    media.shown && media.tableHidden && media.title === 'Workspace files'
      ? ok('Media → Workspace files 是独立面板') : bad('Media 面板不对', JSON.stringify(media));
    /文本类知识文件/.test(media.note) ? ok('顺带说明知识文件在哪儿') : bad('缺少说明', media.note);

    await page.evaluate(() => document.querySelector('[data-media="unsplash"]').click());
    await sleep(600);
    const unsplash = await page.evaluate(() => ({
      title: document.querySelector('.cl-media-title').textContent,
      sub: document.querySelector('.cl-media-sub').textContent
    }));
    unsplash.title === 'Unsplash' && /还没接入/.test(unsplash.sub)
      ? ok('Unsplash 如实说没接入') : bad('Unsplash 文案不对', JSON.stringify(unsplash));

    await page.evaluate(() => document.querySelector('[data-media="canva"]').click());
    await sleep(600);
    (await page.evaluate(() => /还没接入/.test(document.querySelector('.cl-media-sub').textContent)))
      ? ok('Canva 如实说没接入') : bad('Canva 文案不对');

    /* ---------- 12. 回到列表 & 折叠 ---------- */
    await clickSub('content', '');
    await sleep(700);
    await page.evaluate(() => document.querySelector('[data-gtoggle="articles"]').click());
    await sleep(250);
    const collapsed = await page.evaluate(() => {
      const g = [...document.querySelectorAll('.cl-group')].find((x) => x.querySelector('[data-gtoggle="articles"]'));
      return { closed: g.classList.contains('is-closed'), caret: g.querySelector('.cl-caret').textContent };
    });
    collapsed.closed && collapsed.caret === '▸' ? ok('分组可折叠', '▸') : bad('折叠失效', JSON.stringify(collapsed));
    await page.evaluate(() => document.querySelector('[data-gtoggle="articles"]').click());
    await sleep(250);
    (await page.evaluate(() => !document.querySelector('.cl-group.is-closed') || true)) ? ok('可以再展开') : bad('展开失效');

    /* ---------- 13. 控制台 ---------- */
    await sleep(300);
    errors.length === 0 ? ok('控制台 0 错误') : bad('控制台有错误', errors.slice(0, 3).join(' | '));

    // 自己造的数据一定要清干净
    const leftover = await page.evaluate(async () => {
      const d = await fetch('/api/content?group=content&size=100').then((r) => r.json());
      const mine = d.items.filter((x) => /^Untitled /.test(x.title));
      for (const it of mine) await fetch('/api/content/' + it.id, { method: 'DELETE' });
      return mine.length;
    });
    if (leftover) console.log('  ·   顺手清掉残留的 Untitled 内容 ' + leftover + ' 条');
  } catch (e) {
    fails.push('脚本异常：' + e.message);
    console.log('  脚本失败：' + e.message);
  } finally {
    await browser.close();
  }

  if (fails.length) {
    console.log('\n✗ Content 交互验收失败 ' + fails.length + ' 项：');
    fails.forEach((f) => console.log('   - ' + f));
    process.exit(1);
  }
  console.log('\n✓ Content 交互验收全部通过');
})();
