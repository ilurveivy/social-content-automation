'use strict';
/**
 * 交互验收（v2）：真实点击 / 打字 / 快捷键，覆盖 campaign、资产、排期、日历。
 * 用法：node scripts/ui-flow.js
 * 会新增并删除一个测试资产；退出时数据恢复原状。
 */
const path = require('path');
const puppeteer = require(path.join(__dirname, '..', '..', 'node_modules', 'puppeteer-core'));

const URL_ = process.argv[2] || 'http://127.0.0.1:4319';
const EXE = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (n) => String(n).padStart(2, '0');
const plusDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

(async () => {
  const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-first-run'] });
  const fails = [];
  const ok = (n, x) => console.log('  ok  ' + n + (x ? '  → ' + x : ''));
  const bad = (n, x) => { fails.push(n + (x ? ' → ' + x : '')); console.log('  ✗   ' + n + '  → ' + x); };
  const testDate = plusDays(21);

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 1000 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    const enterContent = async () => {
      await page.evaluate(() => document.querySelector('.nav-item[data-view="content"]').click());
      await sleep(700);
      // v11：Content 先是列表页，点一行才进编辑器
      const opened = await page.evaluate(() => {
        const t = document.querySelector('.cl-title');
        if (!t) return false;
        t.click();
        return true;
      });
      if (opened) await sleep(900);
      const n = await page.evaluate(() => document.querySelectorAll('.brief-item').length);
      for (let i = 0; i < n; i++) {
        if (await page.evaluate(() => document.querySelectorAll('.asset-chip').length > 0)) break;
        await page.evaluate((k) => document.querySelectorAll('.brief-item')[k].click(), i);
        await sleep(400);
      }
      await page.waitForSelector('.asset-chip', { timeout: 15000 });
      await sleep(300);
    };

    await page.goto(URL_, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.setup-card');
    await enterContent();

    // 清理上次异常中断留下的测试资产，保证计数断言可靠
    const cleaned = await page.evaluate(async () => {
      const st = await fetch('/api/state').then((r) => r.json());
      let n = 0;
      for (const cp of st.campaigns) {
        for (const a of cp.assets) {
          if (a.title === 'UI 流程测试分镜') {
            await fetch(`/api/campaigns/${cp.id}/assets/${a.id}`, { method: 'DELETE' });
            n++;
          }
        }
      }
      return n;
    });
    if (cleaned) {
      await page.reload({ waitUntil: 'networkidle2' });
      await page.waitForSelector('.setup-card');
      await enterContent();
      ok('清理残留测试资产', String(cleaned));
    }

    const before = await page.evaluate(() => ({
      chips: document.querySelectorAll('.asset-chip').length,
      versions: document.querySelectorAll('.tl-item').length
    }));
    ok('初始资产数', String(before.chips));

    // 1) 添加资产（分镜包 + 排期）
    await page.click('#btnAddAsset');
    await sleep(300);
    await page.select('#aChannel', 'video_shotlist');
    await page.evaluate((d) => {
      document.getElementById('aTitle').value = 'UI 流程测试分镜';
      document.getElementById('aScheduled').value = d;
    }, testDate);
    await page.click('#btnCreateAsset');
    await sleep(1200);
    const afterAdd = await page.evaluate(() => ({
      chips: document.querySelectorAll('.asset-chip').length,
      selected: document.querySelector('.asset-chip.is-active') ? document.querySelector('.asset-chip.is-active .ac-name').textContent : '',
      typeTag: document.getElementById('assetTypeTag').textContent,
      scheduled: document.getElementById('statusScheduled').textContent
    }));
    afterAdd.chips === before.chips + 1 ? ok('添加资产 → 资产数 +1', String(afterAdd.chips)) : bad('添加资产没生效', JSON.stringify(afterAdd));
    afterAdd.selected === 'UI 流程测试分镜' ? ok('新资产自动选中', afterAdd.selected) : bad('新资产没被选中', afterAdd.selected);
    afterAdd.typeTag === '视频' ? ok('类型标签正确', afterAdd.typeTag) : bad('类型标签不对', afterAdd.typeTag);
    afterAdd.scheduled === testDate ? ok('排期写入', afterAdd.scheduled) : bad('排期不对', afterAdd.scheduled);

    // 2) 生成
    const v0 = await page.evaluate(() => document.querySelectorAll('.tl-item').length);
    await page.click('#btnGen');
    await page.waitForFunction((n) => document.querySelectorAll('.tl-item').length > n, { timeout: 20000 }, v0)
      .then(() => ok('生成 → 新增版本'))
      .catch((e) => bad('生成没出新版本', e.message));
    const gen = await page.evaluate(() => ({
      len: document.getElementById('editor').value.length,
      score: document.getElementById('statusScore').textContent
    }));
    gen.len > 200 ? ok('生成内容已填入', gen.len + ' 字符 · ' + gen.score) : bad('生成内容为空', JSON.stringify(gen));

    // 3) 打字 → 未保存
    await page.click('#editor');
    await page.evaluate(() => {
      const ed = document.getElementById('editor');
      ed.value += '\n\n[UI 流程测试追加]';
      ed.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(200);
    (await page.evaluate(() => !document.getElementById('dirtyFlag').classList.contains('hidden')))
      ? ok('打字后出现未保存') : bad('没出现未保存标记');

    // 4) Ctrl+S
    const v1 = await page.evaluate(() => document.querySelectorAll('.tl-item').length);
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyS');
    await page.keyboard.up('Control');
    await sleep(1500);
    const saved = await page.evaluate(() => ({
      versions: document.querySelectorAll('.tl-item').length,
      dirty: !document.getElementById('dirtyFlag').classList.contains('hidden'),
      toast: document.getElementById('toast').textContent
    }));
    saved.versions > v1 ? ok('Ctrl+S 存成新版本', saved.versions + ' 版') : bad('Ctrl+S 没存上', JSON.stringify(saved));
    !saved.dirty ? ok('保存后未保存消失') : bad('仍标记未保存');

    // 5) 批准
    await page.click('#btnApprove');
    await sleep(1200);
    const ap = await page.evaluate(() => ({
      status: document.getElementById('statusState').textContent,
      badge: !!document.querySelector('.tl-item.is-approved')
    }));
    ap.status === '已批准' ? ok('批准生效') : bad('批准后状态不对', ap.status);
    ap.badge ? ok('时间线有已批准标记') : bad('时间线没有批准标记');

    // 6) 改排期
    const newDate = plusDays(22);
    await page.evaluate((d) => { document.getElementById('fScheduled').value = d; }, newDate);
    await page.click('#btnSaveAsset');
    await sleep(1000);
    const sched = await page.evaluate(() => document.getElementById('statusScheduled').textContent);
    sched === newDate ? ok('修改排期', sched) : bad('排期没更新', sched);

    // 7) 日历（Planning 板块）：能看到这个资产，点它回到编辑
    const cpId = await page.evaluate(() => window.SCA.S.campaignId);
    await page.evaluate(() => document.querySelector('.nav-item[data-view="planning"]').click());
    await sleep(700);
    await page.select('#planCampaign', cpId);
    await sleep(600);
    const cal = await page.evaluate((d) => {
      const chips = [...document.querySelectorAll('.cal-grid .cal-chip')];
      const hit = chips.find((c) => (c.getAttribute('title') || '').includes(d));
      return { chips: chips.length, found: !!hit, label: hit ? hit.textContent.trim() : '' };
    }, newDate);
    cal.found ? ok('日历里能找到刚排期的资产', cal.label) : bad('日历里找不到该资产', JSON.stringify(cal));

    await page.evaluate((d) => {
      const chips = [...document.querySelectorAll('.cal-grid .cal-chip')];
      const hit = chips.find((c) => (c.getAttribute('title') || '').includes(d));
      if (hit) hit.click();
    }, newDate);
    await sleep(700);
    const back = await page.evaluate(() => ({
      view: document.getElementById('view-content').classList.contains('hidden') ? 'planning' : 'content',
      name: document.querySelector('.asset-chip.is-active .ac-name') ? document.querySelector('.asset-chip.is-active .ac-name').textContent : ''
    }));
    back.view === 'content' && back.name === 'UI 流程测试分镜'
      ? ok('点日历里的资产 → 跳回编辑该资产')
      : bad('日历跳转失败', JSON.stringify(back));

    // 8) 删除测试资产
    await page.evaluate(() => { window.confirm = () => true; });
    await page.click('#btnDeleteAsset');
    await sleep(1200);
    const afterDel = await page.evaluate(() => document.querySelectorAll('.asset-chip').length);
    afterDel === before.chips ? ok('删除资产 → 恢复原状', String(afterDel)) : bad('删除后数量不对', afterDel + ' vs ' + before.chips);

    // 9) 设置弹窗
    await page.click('#btnSettings');
    await sleep(250);
    (await page.evaluate(() => !document.getElementById('settingsModal').classList.contains('hidden')))
      ? ok('设置弹窗打开') : bad('设置弹窗没开');
    await page.click('#btnCloseSettings');
    await sleep(200);
    (await page.evaluate(() => document.getElementById('settingsModal').classList.contains('hidden')))
      ? ok('设置弹窗关闭') : bad('设置弹窗没关');

    errors.length ? bad('控制台错误', errors.join(' | ')) : ok('控制台 0 错误');

    await page.screenshot({ path: path.join(__dirname, '..', '_shots', 'sca-flow.png') });
  } finally {
    await browser.close();
  }

  if (fails.length) { console.error('\n✗ 交互验收失败 ' + fails.length + ' 项：\n - ' + fails.join('\n - ')); process.exitCode = 1; }
  else console.log('\n✓ 交互验收全部通过');
})().catch((e) => { console.error('脚本失败：' + e.message); process.exit(1); });
