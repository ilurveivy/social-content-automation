'use strict';
/* ============================================================
   Report 模块 · AI Visibility（Demo）离线冒烟测试
   ------------------------------------------------------------
   不启浏览器、不启服务、零依赖：
   1) 用 vm + 最小 DOM 桩把 public/views/report.js 载进来
   2) 纯函数层：AV.html() 渲染三个子页，检查结构完整性
   3) 挂载层：AV.renderReport() 真的把「侧边栏 + 内容区」写进 #view-report
      （回归：曾因 'av-overview' vs 'view-av-overview' 整页空白）
   4) 挂载点补丁：index.html 只有 5 个一级菜单、app.js 路由指向 AV

   用法：node scripts/ui-report.js
   ============================================================ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const fails = [];
const oks = [];

function ok(msg) { oks.push(msg); }
function bad(msg) { fails.push(msg); }
function assert(cond, msg) { if (cond) ok(msg); else bad(msg); }

/* ---------- 1. 最小 DOM 桩 ---------- */
function makeStub() {
  const head = { children: [], appendChild(el) { this.children.push(el); } };
  const byId = new Map();
  const mkEl = (tag) => ({
    tagName: String(tag).toUpperCase(),
    id: '',
    textContent: '',
    innerHTML: '',
    style: {},
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {}, getAttribute() { return null; },
    appendChild() {}, addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; }
  });
  return {
    document: {
      head,
      body: mkEl('body'),
      getElementById: (id) => byId.get(id) || null,
      querySelectorAll: () => [],
      createElement: mkEl,
      addEventListener() {}
    },
    __byId: byId,
    head
  };
}

/** 让 innerHTML 变成可查询的桩：够 report.js 用就行（只认它真正会问的选择器） */
function makeHost(id) {
  const host = {
    id,
    _html: '',
    _main: null,
    cssToggles: [],
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); this._main = null; },
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {},
    querySelector(sel) {
      if (sel === '.av-module') return this._html.includes('class="av-module"') ? { innerHTML: '' } : null;
      if (sel === '.av-main') {
        if (!this._main) this._main = { innerHTML: '' };
        return this._main;
      }
      return null;
    },
    querySelectorAll(sel) {
      if (sel === '[data-av-page]') {
        const ids = [];
        const re = /data-av-page="([^"]+)"/g;
        let m;
        while ((m = re.exec(this._html))) ids.push(m[1]);
        return ids.map((pid) => {
          const btn = {
            dataset: { avPage: pid },
            _cls: {},
            classList: {
              toggle(c, on) { btn._cls[c] = !!on; host.cssToggles.push([pid, c, !!on]); }
            },
            setAttribute() {},
            onclick: null
          };
          return btn;
        });
      }
      return [];
    }
  };
  return host;
}

/* ---------- 2. 载入 report.js ---------- */
const srcPath = path.join(ROOT, 'public', 'views', 'report.js');
assert(fs.existsSync(srcPath), 'report.js 存在');

const stub = makeStub();
const sandbox = {
  window: {},
  document: stub.document,
  location: { hash: '' },
  localStorage: { getItem: () => null, setItem: () => {} },
  console
};
vm.createContext(sandbox);

let loadErr = null;
try {
  vm.runInContext(fs.readFileSync(srcPath, 'utf8'), sandbox, { filename: 'report.js' });
} catch (e) {
  loadErr = e;
}
assert(!loadErr, 'report.js 加载无异常' + (loadErr ? '：' + loadErr.message : ''));

const AV = sandbox.window.AV;
assert(!!AV, '导出 window.AV');
if (!AV) { report(); process.exit(1); }

assert(typeof AV.renderReport === 'function', 'AV.renderReport 是函数');
assert(typeof AV.html === 'function', 'AV.html 是纯函数');
assert(typeof AV.setPage === 'function', 'AV.setPage 是函数');
assert(Array.isArray(AV.pages) && AV.pages.length === 3, 'AV.pages 有 3 个子页');

/* ---------- 3. 样式注入（全部用现有 token） ---------- */
const styleEl = stub.head.children.find((el) => el.id === 'av-style');
assert(!!styleEl, '已注入 #av-style');
const css = styleEl ? styleEl.textContent : '';
const TOKENS = ['--accent', '--accent-ink', '--accent-soft', '--line', '--line-strong', '--text',
  '--muted', '--faint', '--ok', '--warn', '--bad', '--r-md', '--r-pill', '--r-sm'];
TOKENS.forEach((t) => assert(css.includes('var(' + t + ')'), '样式使用 token ' + t));
// --r-lg / --shadow 由 .card 自带，本文件不重复声明
assert(!/#[0-9a-fA-F]{6}/.test(css.replace(/#(fff|fafbfd|f2f4f7|f4f6fa)\b/g, '')),
  '没有引入新的十六进制色值（除现有 #fff/#fafbfd/#f2f4f7/#f4f6fa）');
assert(css.includes('grid-template-columns:232px'), '模块为「固定宽度侧边栏 + 内容区」两栏');
assert(css.includes('.av-side-item.is-on'), '侧边栏选中态有背景高亮');
assert(css.includes('.av-side-item:hover'), '侧边栏 hover 有反馈');
assert(css.includes('text-transform:uppercase'), '分组标题为大写小字');

/* ---------- 4. 侧边栏结构 ---------- */
const side = AV.sidebarHTML();
assert(side.includes('AI VISIBILITY'), '分组标题含 AI VISIBILITY');
assert(side.includes('SEO INSIGHTS'), '预留分组 SEO INSIGHTS');
assert(side.includes('SOCIAL INSIGHTS'), '预留分组 SOCIAL INSIGHTS');
assert((side.match(/data-av-page="/g) || []).length === 3, '侧边栏 3 个子菜单项');
assert((side.match(/<svg\b/g) || []).length === 3, '每个子菜单项都带线性图标');
assert(!/undefined|NaN|\[object Object\]/.test(side), '侧边栏无脏值');

const grp = AV.groups();
assert(grp.length === 3, 'AV.groups() 共 3 个分组');
assert(grp[0].label === 'AI VISIBILITY' && grp[0].items.length === 3, '第一个分组是 AI VISIBILITY + 3 项');
assert(grp[0].items.join(',') === 'av-overview,av-prompts,av-competitors', '分组内顺序正确');
assert(grp[1].reserved && grp[1].items.length === 0, 'SEO INSIGHTS 为预留位（无入口）');
assert(grp[2].reserved && grp[2].items.length === 0, 'SOCIAL INSIGHTS 为预留位（无入口）');

/* ---------- 5. 三个子页逐页检查 ---------- */
const PAGES = {
  'av-overview': { need: ['Performance overview', '示例数据 · Demo', '<svg', 'Top cited domains',
    'Top prompts', 'Top competitors', 'Your results', 'View brand details', 'View citation details'] },
  'av-prompts': { need: ['Prompts', '示例数据 · Demo', 'Awareness', 'Consideration', 'Decision',
    'Brand evaluation', 'Visibility'] },
  'av-competitors': { need: ['Competitors', '示例数据 · Demo', '<svg', 'Top competitors visibility',
    'Mentioned', 'Cited', 'Visibility', 'YOU'] }
};

Object.keys(PAGES).forEach((id) => {
  let html = '';
  try { html = AV.html(id); } catch (e) { bad(id + ' 渲染抛错：' + e.message); return; }
  assert(html.length > 500, id + ' 产出 HTML（' + html.length + ' 字符）');

  PAGES[id].need.forEach((s) => assert(html.includes(s), id + ' 含「' + s + '」'));

  assert(!html.includes('undefined'), id + ' 无 undefined 泄漏');
  assert(!html.includes('NaN'), id + ' 无 NaN 泄漏');
  assert(!html.includes('[object Object]'), id + ' 无 [object Object]');

  const opens = (html.match(/<div\b/g) || []).length;
  const closes = (html.match(/<\/div>/g) || []).length;
  assert(opens === closes, id + ' <div> 配平（' + opens + '/' + closes + '）');

  const svgOpen = (html.match(/<svg\b/g) || []).length;
  const svgClose = (html.match(/<\/svg>/g) || []).length;
  assert(svgOpen === svgClose, id + ' <svg> 配平（' + svgOpen + '/' + svgClose + '）');

  if (svgOpen) {
    const paths = (html.match(/<path\b/g) || []).length;
    assert(paths > 0, id + ' 折线图存在 path（' + paths + ' 条）');
  }
});

/* ---------- 6. 设计规范抽查 ---------- */
const ov = AV.html('av-overview');
assert(ov.includes('class="card av-card') || ov.includes('class="card av-kpi'), '总览页复用 .card');
assert(ov.includes('class="stat-grid'), '总览页复用 .stat-grid');
assert(ov.includes('class="page-head'), '总览页复用 .page-head');
assert(ov.includes('class="muted small"'), '总览页复用 .muted .small');
assert(ov.includes('av-num'), '数字使用等宽类 .av-num');
assert(ov.includes('var(--accent)'), '折线使用主色 var(--accent)');
assert(ov.includes('linearGradient'), '面积填充使用渐变');
assert(ov.includes('title="'), '帮助图标使用原生 title');

const pr = AV.html('av-prompts');
assert((pr.match(/class="pill av-st-/g) || []).length === 12, 'Prompts 页 12 行阶段标签');
assert(pr.includes('class="pill '), 'Prompts 页复用 .pill');
assert((pr.match(/av-bar/g) || []).length >= 12, 'Prompts 页每行都有进度条');
assert(pr.includes('data-sort="vis"'), 'Prompts 表头可排序');

const cp = AV.html('av-competitors');
assert((cp.match(/<button type="button" class="av-leg\b/g) || []).length === 5, '竞品页 5 条图例');
assert((cp.match(/class="av-you"/g) || []).length >= 2, '竞品页 YOU 标签 ≥2 处（图例+表格）');
assert(cp.includes('is-you'), '竞品页表格 YOU 行高亮');
assert(cp.includes('data-leg='), '图例可点击');

/* ---------- 7. 真实挂载（回归：曾经整页空白） ---------- */
const host = makeHost('view-report');
stub.__byId.set('view-report', host);

let mountErr = null, mounted = null;
try { mounted = AV.renderReport(); } catch (e) { mountErr = e; }
assert(!mountErr, 'AV.renderReport() 不抛错' + (mountErr ? '：' + mountErr.message : ''));
assert(mounted === true, 'AV.renderReport() 返回 true（命中 #view-report）');
assert(host.innerHTML.length > 2000, '真的写入了 #view-report（' + host.innerHTML.length + ' 字符）');
assert(host.innerHTML.includes('class="dash-shell single"'), '外层复用 .dash-shell.single（与其他页同 padding）');
assert(host.innerHTML.includes('class="av-module"'), '两栏骨架 .av-module 存在');
assert(host.innerHTML.includes('class="av-side"'), '左侧二级侧边栏存在');
assert(host.innerHTML.includes('class="av-main"'), '右侧内容区存在');
assert(host.innerHTML.includes('AI VISIBILITY'), '侧边栏分组标题已渲染');
assert(host.innerHTML.includes('示例数据 · Demo'), '默认子页内容已渲染（含 Demo 标注）');
assert(host.innerHTML.includes('Performance overview'), '默认停在 Performance overview');

// 切换子页：只换右侧内容区
assert(AV.page() === 'av-overview', '当前子页为 av-overview');
let swErr = null, swRet = null;
try { swRet = AV.setPage('av-prompts'); } catch (e) { swErr = e; }
assert(!swErr, 'AV.setPage 不抛错' + (swErr ? '：' + swErr.message : ''));
assert(swRet === true, 'AV.setPage 返回 true');
assert(AV.page() === 'av-prompts', '当前子页切到 av-prompts');
assert(host._main && host._main.innerHTML.includes('Tracked prompts'),
  '切换后右侧内容换成 Prompts 页');
assert(!host._main.innerHTML.includes('Top cited domains'), '切换后旧页内容不残留');

// 选中态跟着走（只看最后一次切换的结果）
host.cssToggles.length = 0;
AV.setPage('av-competitors');
const toggles = host.cssToggles.filter((t) => t[1] === 'is-on' && t[2]);
assert(toggles.length > 0 && toggles.every((t) => t[0] === 'av-competitors'),
  '只有当前子菜单项带 is-on');
assert(AV.setPage('av-nope') === false, '未知子页返回 false（不崩）');

// 幂等：再进一次 Report 不重建、不叠加
AV.setPage('av-overview');
const before = host.innerHTML.length;
AV.renderReport();
assert(host.innerHTML.length === before, '重复 renderReport 幂等（不叠加骨架）');

/* ---------- 8. 挂载点补丁 ---------- */
const idx = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const navViews = (idx.match(/data-view="([^"]+)"/g) || []).map((s) => s.slice(11, -1));
assert(navViews.length === 5, '顶部一级导航只有 5 项（实际 ' + navViews.length + '）');
assert(navViews.join(',') === 'dashboard,strategy,planning,content,report',
  '一级导航顺序为 Dashboard/Strategy/Planning/Content/Report');
assert(!/data-view="av-/.test(idx), '一级导航里没有 av-* 子页入口');
assert(!/id="view-av-/.test(idx), '没有多余的 view-av-* 外壳');
assert(/<main class="page hidden" id="view-report"><\/main>/.test(idx), '#view-report 是空容器（内容由 AV 渲染）');
assert(idx.includes('<script src="/views/report.js">'), 'index.html 引了 /views/report.js');
assert(!idx.includes('id="reportStats"'), '旧的 #reportStats 占位已移除');

const appjs = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
assert(/const VIEWS = \['dashboard', 'strategy', 'planning', 'content', 'report'\];/.test(appjs),
  'app.js 的 VIEWS 只有 5 个一级视图');
assert(!/VIEWS[\s\S]{0,80}'av-overview'/.test(appjs), 'VIEWS 里不再有 av-*');
assert(appjs.includes('window.AV.renderReport'), 'setNav 进入 Report 时调用 AV.renderReport');
assert(appjs.includes("split('/')[0]"), '路由支持 #report/<子页> 深链');

/* ---------- 9. 真数据链路：扫描器 → 聚合器 → 前端 ---------- */
const rsrc = fs.readFileSync(path.join(ROOT, 'public', 'views', 'report.js'), 'utf8');
assert(rsrc.includes('/data/visibility/report.json'), 'report.js 指向 /data/visibility/report.json');
assert(rsrc.includes('function boot()'), 'report.js 有 boot() 拉取逻辑');
assert(rsrc.includes('const SEED_MODEL') && rsrc.includes('function M()'), '拿不到真数据时有 seed 兜底');

// 注入一份 live 数据：页面应换成真值、徽标变「实时数据」
const injected = AV.__inject({
  mode: 'live', sample: 'real', generatedAt: '2026-11-10T09:30:00.000Z',
  range: { from: '2026-11-07', to: '2026-11-10' },
  totals: { answers: 144, prompts: 12, days: 4 },
  brand: { name: 'eSheep.ai', domain: 'esheep.ai' },
  labels: ['07 Nov', '08 Nov', '09 Nov', '10 Nov'],
  series: [
    { key: 'you', name: 'eSheep.ai', domain: 'esheep.ai', you: true, values: [10, 20, 30, 42.5] },
    { key: 'buffer', name: 'Buffer', domain: 'buffer.com', you: false, values: [30, 30, 25, 20] }
  ],
  kpis: {
    results: [{ name: 'AI visibility', value: '42.5%', delta: 5.6, unit: 'pts', hint: 'h1' },
      { name: 'Share of voice', value: '18.0%', delta: 1.2, unit: 'pts', hint: 'h2' },
      { name: 'Cited pages', value: '77', delta: -3.0, unit: 'pct', hint: 'h3' }],
    brand: [{ name: 'Brand mentions', value: '231', delta: 4.0, unit: 'pct', hint: 'h4' },
      { name: 'Brand sentiment', value: '88.0%', delta: 2.0, unit: 'pts', hint: 'h5' },
      { name: 'Avg. position', value: '1.9', delta: -0.4, unit: 'pts', hint: 'h6' }],
    citation: [{ name: 'Cited domains', value: '12', delta: 9.0, unit: 'pct', hint: 'h7' },
      { name: 'Cited URLs', value: '140', delta: 6.0, unit: 'pct', hint: 'h8' },
      { name: 'Unlinked cites', value: '9', delta: -2.0, unit: 'pct', hint: 'h9' }]
  },
  topDomains: [{ name: 'reddit.com', n: 40, d: 5 }],
  topPrompts: [{ text: 'best tool', n: 12, d: 3 }],
  topCompetitors: [{ name: 'eSheep.ai', domain: 'esheep.ai', n: 42.5, d: 5.6, you: true }],
  promptRows: [{ stage: 'Awareness', text: 'q1', added: '—', vis: 50 }],
  compRows: [{ name: 'eSheep.ai', domain: 'esheep.ai', mentioned: 12, cited: 40, vis: 42.5, you: true }]
});
assert(injected, '__inject 接受一份 live 数据');

const liveOv = AV.html('av-overview');
assert(liveOv.includes('实时数据'), 'live 数据下徽标是「实时数据」');
assert(!liveOv.includes('示例数据'), 'live 数据下不再出现「示例数据」');
assert(liveOv.includes('42.5%'), 'live 数据下 KPI 用真值');
assert(liveOv.includes('144 answers'), 'live 数据下显示真实样本量');
assert(liveOv.includes('07 Nov'), 'live 数据下 X 轴用真实日期');
assert(AV.source().mode === 'live', 'AV.source() 报告 live');
assert(AV.html('av-competitors').includes('Buffer'), 'live 数据下竞品取自 series');
assert(AV.html('av-prompts').includes('q1'), 'live 数据下 prompt 行取自 promptRows');

/* ---------- 10. 扫描器纯粹的抽取逻辑 ---------- */
const scan = require(path.join(ROOT, 'scripts', 'visibility-scan.js'));
const cites = scan.extractCitations('see https://esheep.ai/pricing and reddit.com/r/x plus www.g2.com');
assert(cites.includes('esheep.ai'), 'extractCitations 抓到带协议的域名');
assert(cites.includes('reddit.com'), 'extractCitations 抓到裸域名');
assert(cites.includes('g2.com'), 'extractCitations 去掉 www.');

const CFG = {
  brand: { name: 'eSheep.ai', domain: 'esheep.ai', aliases: ['eSheep.ai', 'esheep.ai', 'esheep', 'eSheep'] },
  competitors: [{ key: 'buffer', name: 'Buffer', domain: 'buffer.com', aliases: ['Buffer'] }]
};
const a1 = scan.analyze('1. eSheep.ai is great and easy to use (https://esheep.ai). 2. Buffer (https://buffer.com).', CFG);
assert(a1.mentioned === true, 'analyze：提到品牌');
assert(a1.rank === 1, 'analyze：品牌排第 1');
assert(a1.mentions === 2, 'analyze：正文 1 次 + 链接里 1 次 = 2 次');
assert(a1.brandCitations === 1, 'analyze：品牌被引用 1 次');
assert(a1.competitors.buffer.mentioned === true, 'analyze：识别到竞品');
assert(a1.sentiment === 'positive', 'analyze：判为正面');

// 别名重叠不能重复计数：只有一处 "eSheep.ai"，三个别名都会命中，必须只算 1 次
const aOverlap = scan.analyze('eSheep.ai is great', CFG);
assert(aOverlap.mentions === 1, 'analyze：别名重叠只算 1 次（3 个别名命中同一处）');

const a2 = scan.analyze('Use Buffer instead, avoid anything else.', CFG);
assert(a2.mentioned === false, 'analyze：没提到品牌时 mentioned=false');
assert(a2.rank === null, 'analyze：没提到时 rank=null');
assert(a2.sentiment === null, 'analyze：没提到时不算情感');

const a3 = scan.analyze('eSheep.ai and again eSheep.ai', CFG);
assert(a3.mentions === 2, 'analyze：两处独立提及算 2 次');

/* ---------- 11. 配置与产出文件的契约 ---------- */
const cfgFile = path.join(ROOT, 'data', 'visibility', 'config.json');
assert(fs.existsSync(cfgFile), 'data/visibility/config.json 存在');
let cfg = null;
try { cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8')); } catch (e) { /* 下面断言会报 */ }
assert(!!cfg, 'config.json 可解析');
assert(cfg && cfg.brand && cfg.brand.domain === 'esheep.ai', 'config 里 brand.domain 正确');
assert(cfg && Array.isArray(cfg.prompts) && cfg.prompts.length === 12, 'config 里有 12 条追踪 prompt');
assert(cfg && cfg.prompts.every((p) => /^p\d\d$/.test(p.id)), 'prompt id 都是 pNN');
assert(cfg && cfg.prompts.every((p) => p.stage && p.text), '每条 prompt 都有 stage + text');
assert(cfg && Array.isArray(cfg.competitors) && cfg.competitors.length >= 4, 'config 里有竞品清单');
assert(cfg && cfg.scan && cfg.scan.runsPerPrompt >= 1, 'config 里 scan.runsPerPrompt 有效');

['scripts/visibility-scan.js', 'scripts/visibility-report.js'].forEach((f) =>
  assert(fs.existsSync(path.join(ROOT, f)), f + ' 存在'));

const repFile = path.join(ROOT, 'public', 'data', 'visibility', 'report.json');
if (fs.existsSync(repFile)) {
  let rep = null;
  try { rep = JSON.parse(fs.readFileSync(repFile, 'utf8')); } catch (e) { /* 下面断言会报 */ }
  assert(!!rep, 'report.json 可解析');
  if (rep) {
    ['mode', 'generatedAt', 'range', 'brand', 'labels', 'series', 'kpis',
      'topDomains', 'topPrompts', 'topCompetitors', 'promptRows', 'compRows', 'totals']
      .forEach((k) => assert(Object.prototype.hasOwnProperty.call(rep, k), 'report.json 有字段 ' + k));
    assert(rep.series.length > 0 && rep.series.some((s) => s.you), 'report.json 的 series 含「你」');
    assert(['results', 'brand', 'citation'].every((t) => Array.isArray(rep.kpis[t]) && rep.kpis[t].length === 3),
      'report.json 三张 KPI 卡各 3 项');
    assert(rep.promptRows.length === (cfg ? cfg.prompts.length : 12), 'promptRows 覆盖全部追踪 prompt');
    assert(rep.compRows.some((r) => r.you), 'compRows 含你自己');
    assert(rep.series.every((s) => s.values.length === rep.labels.length), '每条折线点数 = 天数');
    assert(!JSON.stringify(rep).includes('undefined'), 'report.json 无 undefined');
  }
} else {
  ok('还没生成 report.json（属于正常初始状态，跑一次扫描+聚合即可）');
}

/* ---------- 12. 输出 ---------- */
function report() {
  console.log('');
  console.log('  通过的检查：' + oks.length);
  if (fails.length) {
    console.log('  ❌ 失败：' + fails.length);
    fails.forEach((f) => console.log('     - ' + f));
    console.log('');
    process.exit(1);
  }
  console.log('  ✅ 全部通过（离线冒烟，无需启动服务）');
  console.log('');
}
report();
