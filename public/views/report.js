'use strict';
/* ============================================================
   Report 模块 · AI Visibility（Demo）
   ------------------------------------------------------------
   结构（对齐产品导航层级）
     #view-report  ← 顶部全局导航 Report 选中时进入
       └ .dash-shell.single          （复用现有骨架：max-width/padding）
           └ .av-module              （左侧二级侧边栏 + 右侧内容区）
               ├ .av-side            AI VISIBILITY / SEO INSIGHTS / SOCIAL INSIGHTS
               └ .av-main            当前子页内容

   设计约束
   - 不新增设计语言：只用现有 token
     --accent / --accent-ink / --accent-soft / --accent-line
     --line / --line-strong / --text / --muted / --faint
     --ok(+bg) / --warn(+bg) / --bad(+bg) / --r-sm|md|pill
   - 复用现有类：.card .page-head .muted .small .pill .stat-grid
                  .dash-shell .row .between .input-inline
   - 零依赖、零构建；图表为手写内联 SVG
   - 数据全部是前端 seed，每页右上角标注「示例数据 · Demo」
   ============================================================ */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
  const nf = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US'));
  const pc = (n) => (n == null ? '—' : Number(n).toFixed(1) + '%');
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  let GID = 0;

  /* ============================================================
     1. seed 数据（Demo）
     ============================================================ */
  const BRAND = { name: 'eSheep.ai', domain: 'esheep.ai' };
  const RANGE = { from: '2026-10-20', to: '2026-11-10' };

  function buildLabels(from, to) {
    const out = [];
    const a = new Date(from + 'T00:00:00');
    const b = new Date(to + 'T00:00:00');
    const d = new Date(a);
    while (d <= b) {
      out.push(String(d.getDate()).padStart(2, '0') + ' ' + MONTHS[d.getMonth()]);
      d.setDate(d.getDate() + 1);
    }
    return out;
  }

  /** 稳定伪随机序列：同一 seed 每次刷新一致 */
  function wave(n, base, amp, seed, drift) {
    const out = [];
    let s = seed;
    for (let i = 0; i < n; i++) {
      s = (s * 9301 + 49297) % 233280;
      const r = s / 233280;
      const v = base + (drift || 0) * i + Math.sin(i / 3.1) * amp + (r - 0.5) * amp * 0.8;
      out.push(Math.max(1, Math.min(100, Math.round(v * 10) / 10)));
    }
    return out;
  }

  const LABELS = buildLabels(RANGE.from, RANGE.to);
  const N = LABELS.length;

  const COMPETITORS = [
    { key: 'you', name: BRAND.name, domain: BRAND.domain, color: 'var(--accent)', you: true },
    { key: 'hootsuite', name: 'Hootsuite', domain: 'hootsuite.com', color: 'var(--accent-ink)' },
    { key: 'buffer', name: 'Buffer', domain: 'buffer.com', color: 'var(--muted)' },
    { key: 'publer', name: 'Publer', domain: 'publer.com', color: 'var(--ok)' },
    { key: 'metricool', name: 'Metricool', domain: 'metricool.com', color: 'var(--warn)' }
  ];

  const TREND = COMPETITORS.map((c, i) => Object.assign({}, c, {
    values: wave(N, c.you ? 26 : 34 - i * 5, 4, 1000 + i * 137, c.you ? 0.35 : -0.1)
  }));

  const KPI_SETS = {
    results: [
      { name: 'AI visibility', value: '34.2%', delta: 3.8, unit: 'pts',
        hint: '在追踪的 prompt 里，AI 回答提到你的比例。' },
      { name: 'Share of voice', value: '18.6%', delta: 1.2, unit: 'pts',
        hint: '你与全部竞品合计提及量中，你占的份额。' },
      { name: 'Cited pages', value: '1,248', delta: -2.1, unit: 'pct',
        hint: 'AI 回答中引用你域名的次数。' }
    ],
    brand: [
      { name: 'Brand mentions', value: '2,431', delta: 5.4, unit: 'pct',
        hint: '品牌名被直接提及的总次数。' },
      { name: 'Brand sentiment', value: '81.0%', delta: 2.6, unit: 'pts',
        hint: '提及中含正面表述的比例。' },
      { name: 'Avg. position', value: '2.4', delta: -0.3, unit: 'pts',
        hint: '在回答的候选清单中，你平均排第几（越小越好）。' }
    ],
    citation: [
      { name: 'Cited domains', value: '96', delta: 4.0, unit: 'pct',
        hint: '引用过你的不同域名数量。' },
      { name: 'Cited URLs', value: '1,248', delta: 6.1, unit: 'pct',
        hint: '被引用的具体页面数。' },
      { name: 'Unlinked cites', value: '312', delta: -1.8, unit: 'pct',
        hint: '提到你但没给链接的次数。' }
    ]
  };

  const TOP_DOMAINS = [
    { name: 'hootsuite.com', n: 188, d: 12 },
    { name: 'buffer.com', n: 142, d: 6 },
    { name: 'reddit.com', n: 118, d: -4 },
    { name: 'youtube.com', n: 94, d: 9 },
    { name: BRAND.domain, n: 88, d: 14, you: true }
  ];

  const TOP_PROMPTS = [
    { text: 'how to repurpose one blog post into ten social posts', n: 47, d: 8 },
    { text: 'best multi-channel content repurposing tool', n: 39, d: 3 },
    { text: 'how to keep brand voice across channels', n: 31, d: -2 },
    { text: 'AI tool that adapts copy per platform', n: 26, d: 11 },
    { text: 'is ' + BRAND.name + ' worth it', n: 22, d: 5, you: true }
  ];

  const TOP_COMPETITORS = [
    { name: 'Hootsuite', domain: 'hootsuite.com', n: 28.4, d: 1.8 },
    { name: BRAND.name, domain: BRAND.domain, n: 18.6, d: 3.8, you: true },
    { name: 'Buffer', domain: 'buffer.com', n: 15.2, d: -0.9 },
    { name: 'Metricool', domain: 'metricool.com', n: 12.7, d: 2.1 },
    { name: 'Publer', domain: 'publer.com', n: 9.3, d: -1.4 }
  ];

  const PROMPT_ROWS = [
    { stage: 'Awareness', text: 'what is multi-channel content adaptation', added: '2 months ago', vis: 41.8 },
    { stage: 'Awareness', text: 'how do brands keep one voice across platforms', added: '1 month ago', vis: 36.2 },
    { stage: 'Awareness', text: 'why does the same post flop on different channels', added: '1 month ago', vis: 28.4 },
    { stage: 'Consideration', text: 'best multi-channel content repurposing tool', added: '3 weeks ago', vis: 52.6 },
    { stage: 'Consideration', text: 'AI tool that adapts copy per platform', added: '3 weeks ago', vis: 47.1 },
    { stage: 'Consideration', text: 'how to repurpose one blog post into ten social posts', added: '2 weeks ago', vis: 44.0 },
    { stage: 'Consideration', text: 'content workflow for small marketing teams', added: '2 weeks ago', vis: 31.5 },
    { stage: 'Decision', text: 'hootsuite vs buffer vs community tools', added: '10 days ago', vis: 24.9 },
    { stage: 'Decision', text: 'cheapest tool to schedule ten channels', added: '8 days ago', vis: 22.3 },
    { stage: 'Decision', text: 'which tool exports to Google Search Console', added: '6 days ago', vis: 18.7 },
    { stage: 'Brand evaluation', text: 'is ' + BRAND.name + ' worth it', added: '5 days ago', vis: 61.4 },
    { stage: 'Brand evaluation', text: BRAND.name + ' reviews and pricing', added: '3 days ago', vis: 55.2 }
  ];

  const COMP_ROWS = [
    { name: 'Hootsuite', domain: 'hootsuite.com', mentioned: 812, cited: 233, vis: 28.4 },
    { name: BRAND.name, domain: BRAND.domain, mentioned: 431, cited: 188, vis: 18.6, you: true },
    { name: 'Buffer', domain: 'buffer.com', mentioned: 388, cited: 142, vis: 15.2 },
    { name: 'Metricool', domain: 'metricool.com', mentioned: 301, cited: 118, vis: 12.7 },
    { name: 'Publer', domain: 'publer.com', mentioned: 244, cited: 96, vis: 9.3 },
    { name: 'Typefully', domain: 'typefully.com', mentioned: 176, cited: 61, vis: 6.8 },
    { name: 'Predis.ai', domain: 'predis.ai', mentioned: 121, cited: 44, vis: 4.1 }
  ];

  /* ============================================================
     1b. 数据来源：真数据优先，没有就退回 seed
     ------------------------------------------------------------
     scripts/visibility-report.js 把真实扫描结果写成
     public/data/visibility/report.json；这里 fetch 得到就用真的，
     拿不到（还没跑过扫描）就继续用上面的 seed，并把徽标显示成「示例数据」。
     ============================================================ */
  const REPORT_URL = '/data/visibility/report.json';
  const PALETTE = ['var(--accent)', 'var(--accent-ink)', 'var(--muted)', 'var(--ok)', 'var(--warn)'];

  const SEED_MODEL = {
    mode: 'demo', sample: 'seed', generatedAt: null,
    range: RANGE, brand: BRAND,
    labels: LABELS, series: TREND, kpis: KPI_SETS,
    topDomains: TOP_DOMAINS, topPrompts: TOP_PROMPTS, topCompetitors: TOP_COMPETITORS,
    promptRows: PROMPT_ROWS, compRows: COMP_ROWS,
    totals: { answers: 0, prompts: PROMPT_ROWS.length, days: N }
  };

  const SRC = { live: null, tried: false, err: null };

  /** 当前生效的数据模型 */
  function M() { return SRC.live || SEED_MODEL; }

  function fmtTime(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const p = (x) => String(x).padStart(2, '0');
    return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function normalizeLive(d) {
    if (!d || !Array.isArray(d.labels) || !Array.isArray(d.series) || !d.kpis) return null;
    d.series = d.series.map((s, i) => Object.assign({}, s, {
      color: s.you ? PALETTE[0] : (PALETTE[(i % (PALETTE.length - 1)) + 1] || PALETTE[1])
    }));
    d.promptRows = Array.isArray(d.promptRows) ? d.promptRows : [];
    d.compRows = Array.isArray(d.compRows) ? d.compRows : [];
    d.topDomains = Array.isArray(d.topDomains) ? d.topDomains : [];
    d.topPrompts = Array.isArray(d.topPrompts) ? d.topPrompts : [];
    d.topCompetitors = Array.isArray(d.topCompetitors) ? d.topCompetitors : [];
    d.totals = d.totals || { answers: 0, prompts: d.promptRows.length, days: d.labels.length };
    return d;
  }

  /** 拉一次真数据；失败/不存在就静默保持 seed（不打扰用户） */
  function boot() {
    if (SRC.tried || typeof fetch !== 'function') return;
    SRC.tried = true;
    fetch(REPORT_URL + '?t=' + Date.now(), { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const live = normalizeLive(d);
        if (!live) return;
        SRC.live = live;
        renderMain();               // 静默换成真数据
      })
      .catch((e) => { SRC.err = (e && e.message) || 'fetch failed'; });
  }

  /* ============================================================
     2. 二级侧边栏配置
     ============================================================ */
  const ICON = {
    overview: '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 16.5h14"/><path d="M4.5 13l3.5-4.2 3 2.6L15.5 5.6"/></svg>',
    prompts: '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16.5 11.5a2 2 0 01-2 2H8l-3.5 3v-3H5a2 2 0 01-2-2V5.5a2 2 0 012-2h9.5a2 2 0 012 2z"/></svg>',
    competitors: '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.6" cy="7" r="2.6"/><path d="M3 15.6c.4-2.7 2.3-4.2 4.6-4.2s4.2 1.5 4.6 4.2"/><path d="M13.4 5.1a2.3 2.3 0 010 4.2"/><path d="M14 11.5c1.9.3 3.2 1.8 3.5 4.1"/></svg>'
  };

  const GROUPS = [
    {
      id: 'ai-visibility',
      label: 'AI VISIBILITY',
      items: [
        { id: 'av-overview', label: 'Performance overview', icon: ICON.overview },
        { id: 'av-prompts', label: 'Prompts', icon: ICON.prompts },
        { id: 'av-competitors', label: 'Competitors', icon: ICON.competitors }
      ]
    },
    // 预留位：后续分组，先占位不提供入口
    { id: 'seo-insights', label: 'SEO INSIGHTS', items: [], reserved: true },
    { id: 'social-insights', label: 'SOCIAL INSIGHTS', items: [], reserved: true }
  ];

  /* ============================================================
     3. 内部状态
     ============================================================ */
  const ST = {
    page: 'av-overview',
    kpiTab: 'results',
    sortKey: 'vis',
    sortDir: 'desc',
    off: new Set()
  };

  /* ============================================================
     4. 通用片段
     ============================================================ */
  function deltaHTML(d, unit) {
    if (d == null) return '';
    const up = d >= 0;
    const suffix = unit === 'pts' ? ' pts' : '%';
    return '<span class="av-delta ' + (up ? 'av-up' : 'av-down') + '">' +
      (up ? '▲' : '▼') + ' ' + Math.abs(d).toFixed(1) + suffix + '</span>';
  }

  function demoBadge() {
    const m = M();
    if (m.mode === 'live') {
      const when = fmtTime(m.generatedAt);
      const tag = m.sample === 'mock' ? 'mock 数据' : '实时数据';
      return '<span class="av-demo av-demo-live" title="来自 ' + REPORT_URL + '：' +
        m.totals.answers + ' 条模型回答 / ' + m.totals.days + ' 天">' + tag +
        (when ? ' · 更新于 ' + when : '') + '</span>';
    }
    return '<span class="av-demo" title="当前为前端静态 seed 数据；跑一次 scripts/visibility-scan.js + visibility-report.js 就会自动切换成真实数据">示例数据 · Demo</span>';
  }

  /** 标题下那行说明：真数据时报告实际样本量，demo 时保留设计稿文案 */
  function updatedText() {
    const m = M();
    if (m.mode !== 'live' || !m.generatedAt) return 'Last updated: 2 days ago · Next update in 5 days';
    return 'Last updated: ' + fmtTime(m.generatedAt) + ' · ' +
      m.totals.answers + ' answers / ' + m.totals.prompts + ' prompts / ' + m.totals.days + ' days';
  }

  const STAGE_CLS = {
    Awareness: 'av-st-gray',
    Consideration: 'av-st-blue',
    Decision: 'av-st-green',
    'Brand evaluation': 'av-st-orange'
  };

  function youTag() {
    return '<span class="av-you">YOU</span>';
  }

  function favi(name) {
    return '<span class="av-favi" aria-hidden="true">' + esc(String(name).charAt(0).toUpperCase()) + '</span>';
  }

  /* ============================================================
     5. 手写 SVG 折线图
     ============================================================ */
  function chartSVG(opts) {
    const labels = opts.labels;
    const series = opts.series;
    const W = 760;
    const H = opts.h || 240;
    const P = { l: 40, r: 14, t: 14, b: 26 };
    const n = labels.length;
    const maxV = 100;
    const iw = W - P.l - P.r;
    const ih = H - P.t - P.b;
    const xAt = (i) => P.l + (n <= 1 ? 0 : (iw * i) / (n - 1));
    const yAt = (v) => P.t + ih * (1 - v / maxV);
    const ticks = [0, 25, 50, 75, 100];
    const gid = 'avg' + (++GID);
    const out = [];

    out.push('<svg class="av-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" ' +
      'aria-label="' + esc(opts.aria || 'visibility trend') + '">');

    if (opts.area) {
      out.push('<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0%" stop-color="var(--accent)" stop-opacity=".18"/>' +
        '<stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>');
    }

    ticks.forEach((t) => {
      const y = yAt(t);
      out.push('<line class="av-grid" x1="' + P.l + '" y1="' + y + '" x2="' + (W - P.r) + '" y2="' + y + '"/>');
      out.push('<text class="av-ytick" x="' + (P.l - 8) + '" y="' + (y + 3.5) + '">' + t + '%</text>');
    });

    labels.forEach((lb, i) => {
      if (i % 4 !== 0 && i !== n - 1) return;
      out.push('<text class="av-xtick" x="' + xAt(i) + '" y="' + (H - 8) + '">' + esc(lb) + '</text>');
    });

    if (opts.area) {
      const s = series[0];
      const d = s.values.map((v, i) => (i ? 'L' : 'M') + xAt(i) + ',' + yAt(v)).join(' ') +
        ' L' + xAt(n - 1) + ',' + yAt(0) + ' L' + xAt(0) + ',' + yAt(0) + ' Z';
      out.push('<path d="' + d + '" fill="url(#' + gid + ')"/>');
    }

    series.forEach((s) => {
      const d = s.values.map((v, i) => (i ? 'L' : 'M') + xAt(i) + ',' + yAt(v)).join(' ');
      out.push('<path d="' + d + '" fill="none" stroke="' + s.color + '" ' +
        'stroke-width="' + (s.you ? 2.4 : 1.4) + '" stroke-linejoin="round" stroke-linecap="round" ' +
        'stroke-opacity="' + (s.you ? 1 : 0.75) + '"/>');
    });

    out.push('</svg>');
    return out.join('');
  }

  /* ============================================================
     6. 页面片段
     ============================================================ */
  function headHTML(title, sub) {
    return '<div class="page-head av-head">' +
      '<div>' +
        '<h1>' + esc(title) + '</h1>' +
        '<p class="muted small">' + sub + '</p>' +
      '</div>' +
      '<div class="av-head-right">' +
        demoBadge() +
        '<div class="av-range">' +
          '<input class="input-inline" type="date" value="' + M().range.from + '" aria-label="开始日期">' +
          '<span class="muted small">–</span>' +
          '<input class="input-inline" type="date" value="' + M().range.to + '" aria-label="结束日期">' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  const KPI_TABS = [
    { id: 'results', label: 'Your results' },
    { id: 'brand', label: 'View brand details' },
    { id: 'citation', label: 'View citation details' }
  ];

  function kpiCardHTML(k) {
    return '<div class="card av-kpi">' +
      '<div class="av-kpi-name">' + esc(k.name) +
        '<span class="av-q" title="' + esc(k.hint) + '" tabindex="0" role="img" aria-label="指标释义">?</span>' +
      '</div>' +
      '<div class="av-kpi-row">' +
        '<span class="av-kpi-val av-num">' + esc(k.value) + '</span>' +
        deltaHTML(k.delta, k.unit) +
      '</div>' +
      '<div class="av-kpi-foot">' +
        KPI_TABS.map((t) => '<button type="button" class="av-link' +
          (ST.kpiTab === t.id ? ' is-on' : '') + '" data-kpi-tab="' + t.id + '">' + t.label + '</button>').join('') +
      '</div>' +
    '</div>';
  }

  function listCardHTML(title, sub, rows, kind) {
    const body = rows.map((r) => {
      let left, right;
      if (kind === 'domains') {
        left = favi(r.name) + '<span class="av-row-name">' + esc(r.name) + '</span>';
        right = '<span class="av-num av-b">' + nf(r.n) + '</span>' + deltaHTML(r.d, 'pct');
      } else if (kind === 'prompts') {
        left = '<span class="av-row-name av-wrap">' + esc(r.text) + '</span>';
        right = '<span class="av-num av-b">' + nf(r.n) + '</span>' + deltaHTML(r.d, 'pct');
      } else {
        left = favi(r.name) + '<span class="av-row-name">' + esc(r.name) +
          (r.you ? youTag() : '') + '<i class="av-row-sub">' + esc(r.domain) + '</i></span>';
        right = '<span class="av-num av-b">' + pc(r.n) + '</span>' + deltaHTML(r.d, 'pts');
      }
      return '<div class="av-row' + (r.you ? ' is-you' : '') + '">' +
        '<div class="av-row-l">' + left + '</div>' +
        '<div class="av-row-r">' + right + '</div>' +
      '</div>';
    }).join('');

    return '<div class="card av-card">' +
      '<div class="av-card-h">' +
        '<h3>' + esc(title) + '</h3>' +
        '<p class="muted small">' + esc(sub) + '</p>' +
      '</div>' +
      '<div class="av-list">' + body + '</div>' +
    '</div>';
  }

  function sortRows(rows) {
    const k = ST.sortKey;
    const dir = ST.sortDir === 'asc' ? 1 : -1;
    return rows.slice().sort((a, b) => {
      const av = a[k], bv = b[k];
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }

  function th(label, key, cls) {
    const on = ST.sortKey === key;
    return '<th class="av-th ' + (cls || '') + (on ? ' is-sorted' : '') + '" data-sort="' + key + '" ' +
      'tabindex="0" role="button" aria-sort="' + (on ? (ST.sortDir === 'asc' ? 'ascending' : 'descending') : 'none') + '">' +
      esc(label) + '<i class="av-sort">' + (on ? (ST.sortDir === 'asc' ? '▲' : '▼') : '⇅') + '</i></th>';
  }

  /* ---------- 三个子页的 HTML（纯函数） ---------- */

  function htmlOverview() {
    const m = M();
    const set = m.kpis[ST.kpiTab] || m.kpis.results;
    const ySeries = m.series.filter((s) => s.you);
    const days = m.labels.length;
    return headHTML('Performance overview', updatedText()) +
      '<div class="stat-grid av-kpi-grid">' + set.map(kpiCardHTML).join('') + '</div>' +
      '<div class="av-stack">' +
        '<div class="card av-card av-chart-card">' +
          '<div class="av-card-h">' +
            '<h3>Visibility trend</h3>' +
            '<p class="muted small">追踪 prompt 的平均可见度，' + days + ' 天。</p>' +
          '</div>' +
          chartSVG({ labels: m.labels, series: ySeries, area: true, h: 250, aria: '可见度趋势折线图' }) +
        '</div>' +
        '<div class="av-grid-3">' +
          listCardHTML('Top cited domains', 'Explore the questions these domains help answer.', m.topDomains, 'domains') +
          listCardHTML('Top prompts', 'Queries where you are most visible.', m.topPrompts, 'prompts') +
          listCardHTML('Top competitors', 'Visibility share against your tracked set.', m.topCompetitors, 'competitors') +
        '</div>' +
      '</div>';
  }

  function htmlPrompts() {
    const rows = sortRows(M().promptRows);
    const body = rows.map((r) => (
      '<tr>' +
        '<td class="av-td">' +
          '<span class="pill ' + (STAGE_CLS[r.stage] || 'av-st-gray') + '">' + esc(r.stage) + '</span>' +
          '<div class="av-prompt-text">' + esc(r.text) + '</div>' +
        '</td>' +
        '<td class="av-td av-c"><span class="muted small">' + esc(r.added) + '</span></td>' +
        '<td class="av-td av-r">' +
          '<span class="av-vis-cell">' +
            '<span class="av-bar"><i style="width:' + Math.max(2, Math.min(100, r.vis)) + '%"></i></span>' +
            '<span class="av-num av-b">' + pc(r.vis) + '</span>' +
          '</span>' +
        '</td>' +
      '</tr>'
    )).join('');

    return headHTML('Prompts', 'Tracked queries, grouped by funnel stage.') +
      '<div class="card av-card">' +
        '<div class="av-card-h">' +
          '<h3>Tracked prompts</h3>' +
          '<p class="muted small">' + M().promptRows.length + ' 条 prompt · 点击表头排序</p>' +
        '</div>' +
        '<div class="av-table-wrap">' +
          '<table class="av-table">' +
            '<thead><tr>' +
              th('Prompt', 'text', 'av-w') +
              th('Added', 'added', 'av-c') +
              th('Visibility', 'vis', 'av-r') +
            '</tr></thead>' +
            '<tbody>' + body + '</tbody>' +
          '</table>' +
        '</div>' +
      '</div>';
  }

  function htmlCompetitors() {
    const m = M();
    const legend = m.series.map((c) => (
      '<button type="button" class="av-leg' + (ST.off.has(c.key) ? ' is-off' : '') + '" data-leg="' + c.key + '">' +
        '<i class="av-dot" style="background:' + c.color + '"></i>' +
        '<span>' + esc(c.name) + (c.you ? youTag() : '') + '</span>' +
      '</button>'
    )).join('');

    const rows = m.compRows.map((r) => (
      '<tr' + (r.you ? ' class="is-you"' : '') + '>' +
        '<td class="av-td">' +
          favi(r.name) +
          '<span class="av-name-cell">' +
            '<span class="av-b">' + esc(r.name) + (r.you ? youTag() : '') + '</span>' +
            '<i class="av-row-sub">' + esc(r.domain) + '</i>' +
          '</span>' +
        '</td>' +
        '<td class="av-td av-r"><span class="av-num">' + nf(r.mentioned) + '</span></td>' +
        '<td class="av-td av-r"><span class="av-num">' + nf(r.cited) + '</span></td>' +
        '<td class="av-td av-r"><span class="av-num av-b">' + pc(r.vis) + '</span></td>' +
      '</tr>'
    )).join('');

    return headHTML('Competitors', 'Visibility comparison against your tracked set.') +
      '<div class="av-stack">' +
        '<div class="card av-card av-chart-card">' +
          '<div class="av-card-h">' +
            '<h3>Top competitors visibility</h3>' +
            '<p class="muted small">点击图例可隐藏/显示对应折线。</p>' +
          '</div>' +
          chartSVG({ labels: m.labels, series: m.series.filter((s) => !ST.off.has(s.key)), h: 260, aria: '竞品可见度对比折线图' }) +
          '<div class="av-legend">' + legend + '</div>' +
        '</div>' +
        '<div class="card av-card">' +
          '<div class="av-card-h">' +
            '<h3>Competitor breakdown</h3>' +
            '<p class="muted small">Mentioned / Cited 为原始计数，Visibility 为份额。</p>' +
          '</div>' +
          '<div class="av-table-wrap">' +
            '<table class="av-table">' +
              '<thead><tr>' +
                '<th class="av-th av-w">Name</th>' +
                '<th class="av-th av-r">Mentioned</th>' +
                '<th class="av-th av-r">Cited</th>' +
                '<th class="av-th av-r">Visibility</th>' +
              '</tr></thead>' +
              '<tbody>' + rows + '</tbody>' +
            '</table>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  const BUILDERS = {
    'av-overview': htmlOverview,
    'av-prompts': htmlPrompts,
    'av-competitors': htmlCompetitors
  };

  /* ---------- 左侧二级侧边栏 ---------- */

  function htmlSidebar() {
    const groups = GROUPS.map((g) => {
      const head = '<div class="av-side-group' + (g.reserved ? ' is-reserved' : '') + '">' + esc(g.label) + '</div>';
      const items = g.items.map((it) => (
        '<button type="button" class="av-side-item' + (ST.page === it.id ? ' is-on' : '') + '" ' +
          'data-av-page="' + it.id + '" aria-current="' + (ST.page === it.id ? 'page' : 'false') + '">' +
          '<span class="av-ico" aria-hidden="true">' + it.icon + '</span>' +
          '<span class="av-side-label">' + esc(it.label) + '</span>' +
        '</button>'
      )).join('');
      return head + items;
    }).join('');
    return '<nav class="av-side" aria-label="Report 二级导航">' + groups + '</nav>';
  }

  /* ============================================================
     7. 样式（全部使用现有 token，不新增色值）
     ============================================================ */
  const CSS = [
    /* 模块骨架：左侧二级侧边栏 + 右侧内容区 */
    '.av-module{display:grid;grid-template-columns:232px minmax(0,1fr);gap:24px;align-items:start}',
    '@media (max-width:980px){.av-module{grid-template-columns:1fr}}',

    '.av-side{display:flex;flex-direction:column;gap:1px;padding:2px 12px 8px 0;',
    '  border-right:1px solid var(--line);position:sticky;top:8px}',
    '.av-side-group{font-size:10px;font-weight:600;letter-spacing:.8px;text-transform:uppercase;',
    '  color:var(--faint);padding:14px 10px 6px}',
    '.av-side-group:first-child{padding-top:4px}',
    '.av-side-group.is-reserved{opacity:.45}',
    '.av-side-item{display:flex;align-items:center;gap:8px;width:100%;border:0;background:none;',
    '  font:inherit;font-size:13px;color:var(--muted);text-align:left;cursor:pointer;',
    '  padding:8px 10px;border-radius:var(--r-md);line-height:18px}',
    '.av-side-item:hover{background:#f4f6fa;color:var(--text)}',
    '.av-side-item.is-on{background:var(--accent-soft);color:var(--accent-ink);font-weight:600}',
    '.av-side-item .av-ico{display:flex;flex:0 0 16px;align-items:center;justify-content:center}',
    '.av-side-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',

    '.av-main{min-width:0;display:flex;flex-direction:column}',
    '.av-main-inner{display:flex;flex-direction:column;gap:16px;min-width:0}',

    '.av-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap}',
    '.av-head-right{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
    '.av-demo{display:inline-block;padding:2px 8px;border:1px solid var(--line-strong);border-radius:var(--r-pill);',
    '  color:var(--muted);font-size:11px;font-weight:500;line-height:16px;cursor:help}',
    '.av-range{display:flex;align-items:center;gap:8px}',

    '.av-stack{display:flex;flex-direction:column;gap:16px}',
    '.av-grid-3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}',
    '@media (max-width:1280px){.av-grid-3{grid-template-columns:1fr}}',

    '.av-kpi-grid{margin-top:0;grid-template-columns:repeat(3,minmax(0,1fr))}',
    '@media (max-width:1100px){.av-kpi-grid{grid-template-columns:1fr}}',
    '.av-kpi{padding:18px 20px;display:flex;flex-direction:column;gap:10px}',
    '.av-kpi-name{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:500;color:var(--muted)}',
    '.av-q{width:14px;height:14px;flex:0 0 14px;border-radius:var(--r-pill);border:1px solid var(--line-strong);',
    '  color:var(--faint);font-size:10px;line-height:12px;text-align:center;cursor:help;font-weight:600}',
    '.av-kpi-row{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}',
    '.av-kpi-val{font-size:28px;font-weight:700;line-height:1.15;letter-spacing:-.5px;color:var(--text)}',
    '.av-kpi-foot{display:flex;flex-wrap:wrap;gap:12px;border-top:1px solid var(--line);padding-top:8px;margin-top:2px}',
    '.av-link{border:0;background:none;padding:0;font:inherit;font-size:12px;color:var(--faint);',
    '  text-decoration:underline;text-underline-offset:2px;cursor:pointer}',
    '.av-link:hover{color:var(--accent)}',
    '.av-link.is-on{color:var(--accent-ink);font-weight:600}',

    '.av-delta{font-size:12px;font-weight:600;white-space:nowrap}',
    '.av-up{color:var(--ok)}',
    '.av-down{color:var(--bad)}',

    '.av-card{padding:18px 20px;display:flex;flex-direction:column;gap:12px}',
    '.av-card-h h3{font-size:14px;font-weight:600;color:var(--text);margin:0}',
    '.av-card-h p{margin:4px 0 0}',
    '.av-chart-card{gap:14px}',

    '.av-svg{width:100%;height:auto;display:block;overflow:visible}',
    '.av-grid{stroke:var(--line);stroke-width:1;stroke-dasharray:3 4}',
    '.av-ytick{fill:var(--faint);font-size:10px;text-anchor:end}',
    '.av-xtick{fill:var(--faint);font-size:10px;text-anchor:middle}',

    '.av-list{display:flex;flex-direction:column}',
    '.av-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 0;',
    '  border-bottom:1px solid var(--line);min-height:40px}',
    '.av-row:last-child{border-bottom:0}',
    '.av-row.is-you{background:var(--accent-soft);margin:0 -8px;padding-left:8px;padding-right:8px;border-radius:var(--r-sm)}',
    '.av-row-l{display:flex;align-items:center;gap:8px;min-width:0;flex:1}',
    '.av-row-r{display:flex;align-items:center;gap:8px;flex:0 0 auto}',
    '.av-row-name{font-size:13px;color:var(--text);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.av-row-name.av-wrap{white-space:normal;line-height:1.45;display:block}',
    '.av-row.is-you .av-row-name{font-weight:600}',
    '.av-row-sub{display:block;font-style:normal;font-size:11px;color:var(--faint);margin-top:1px}',
    '.av-favi{width:20px;height:20px;flex:0 0 20px;border-radius:var(--r-sm);background:#f2f4f7;',
    '  color:var(--muted);font-size:10px;font-weight:600;line-height:20px;text-align:center}',
    '.av-you{display:inline-block;margin-left:6px;padding:0 6px;border-radius:var(--r-pill);background:var(--accent);',
    '  color:#fff;font-size:9px;font-weight:700;letter-spacing:.4px;line-height:15px;vertical-align:1px}',

    '.av-num{font-variant-numeric:tabular-nums;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:13px;color:var(--text)}',
    '.av-b{font-weight:600}',
    '.av-c{text-align:center}',
    '.av-r{text-align:right}',

    '.av-table-wrap{overflow-x:auto;margin:0 -20px -18px;padding:0 20px}',
    '.av-table{width:100%;border-collapse:collapse;font-size:13px}',
    '.av-table thead th{background:#fafbfd;border-bottom:1px solid var(--line);color:var(--text);',
    '  font-size:12px;font-weight:600;text-align:left;padding:9px 12px;white-space:nowrap}',
    '.av-th{cursor:pointer;user-select:none;position:relative}',
    '.av-th:hover{color:var(--accent)}',
    '.av-th.is-sorted{color:var(--accent-ink)}',
    '.av-table thead th.av-r{text-align:right}',
    '.av-table thead th.av-c{text-align:center}',
    '.av-table tbody td{border-bottom:1px solid var(--line);padding:12px;vertical-align:top}',
    '.av-table tbody tr:last-child td{border-bottom:0}',
    '.av-table tbody tr:hover{background:#fafbfd}',
    '.av-table tbody tr.is-you{background:var(--accent-soft)}',
    '.av-table tbody tr.is-you .av-b{font-weight:700}',
    '.av-w{width:60%}',
    '.av-sort{font-style:normal;margin-left:6px;color:var(--faint);font-size:10px}',
    '.av-th.is-sorted .av-sort{color:var(--accent-ink)}',

    '.av-prompt-text{margin-top:6px;font-size:13px;line-height:1.55;color:var(--text);word-break:break-word}',
    '.av-vis-cell{display:inline-flex;align-items:center;justify-content:flex-end;gap:10px}',
    '.av-bar{width:84px;height:6px;border-radius:var(--r-pill);background:var(--line);overflow:hidden;flex:0 0 auto}',
    '.av-bar i{display:block;height:100%;border-radius:var(--r-pill);background:var(--accent)}',

    '.pill.av-st-gray{background:#f2f4f7;border-color:var(--line-strong);color:var(--muted)}',
    '.pill.av-st-blue{background:var(--accent-soft);border-color:var(--accent-line);color:var(--accent-ink)}',
    '.pill.av-st-green{background:var(--ok-bg);border-color:var(--ok-line);color:var(--ok)}',
    '.pill.av-st-orange{background:var(--warn-bg);border-color:var(--warn-line);color:var(--warn)}',

    '.av-name-cell{display:inline-block;vertical-align:middle;margin-left:8px}',
    '.av-legend{display:flex;flex-wrap:wrap;gap:8px 16px;padding-top:4px}',
    '.av-leg{display:inline-flex;align-items:center;gap:6px;border:0;background:none;padding:2px 0;',
    '  font:inherit;font-size:12px;color:var(--muted);cursor:pointer}',
    '.av-leg:hover{color:var(--text)}',
    '.av-leg.is-off{opacity:.4;text-decoration:line-through}',
    '.av-dot{width:8px;height:8px;border-radius:var(--r-pill);flex:0 0 8px}'
  ].join('\n');

  /* ============================================================
     8. 渲染与交互
     ============================================================ */
  function ensureStyle() {
    if ($('av-style')) return;
    const el = document.createElement('style');
    el.id = 'av-style';
    el.textContent = CSS;
    document.head.appendChild(el);
  }

  function currentPage() {
    return BUILDERS[ST.page] ? ST.page : 'av-overview';
  }

  function pageHTML(pageId) {
    const fn = BUILDERS[pageId];
    return '<div class="av-main-inner">' + (fn ? fn() : '') + '</div>';
  }

  /** 只刷新右侧内容区 + 侧边栏选中态（避免整块重绘丢滚动位置） */
  function renderMain() {
    const host = $('view-report');
    if (!host) return false;
    ensureStyle();
    const main = host.querySelector('.av-main');
    if (main) main.innerHTML = pageHTML(currentPage());
    host.querySelectorAll('[data-av-page]').forEach((b) => {
      const on = b.dataset.avPage === currentPage();
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-current', on ? 'page' : 'false');
    });
    bindMain(host);
    return true;
  }

  /** 进入 Report 模块：整块渲染骨架（骨架只建一次，之后只换右侧） */
  function renderReport() {
    const host = $('view-report');
    if (!host) return false;
    ensureStyle();

    const built = host.querySelector('.av-module');
    if (!built) {
      ST.page = initialPage();
      host.innerHTML =
        '<div class="dash-shell single">' +
          '<div class="av-module">' +
            htmlSidebar() +
            '<div class="av-main">' + pageHTML(ST.page) + '</div>' +
          '</div>' +
        '</div>';
    }
    bindSidebar(host);
    bindMain(host);
    boot();                 // 首次进入时去拉真数据；拿不到就继续用 seed
    return true;
  }

  function bindSidebar(host) {
    host.querySelectorAll('[data-av-page]').forEach((b) => {
      b.onclick = () => {
        const id = b.dataset.avPage;
        if (!BUILDERS[id] || id === currentPage()) return;
        ST.page = id;
        renderMain();
      };
    });
  }

  function bindMain(host) {
    // 指标卡底部切换栏
    host.querySelectorAll('[data-kpi-tab]').forEach((b) => {
      b.onclick = () => { ST.kpiTab = b.dataset.kpiTab; renderMain(); };
    });

    // Prompts 表头排序
    host.querySelectorAll('.av-th[data-sort]').forEach((elm) => {
      const go = () => {
        const k = elm.dataset.sort;
        if (ST.sortKey === k) ST.sortDir = ST.sortDir === 'asc' ? 'desc' : 'asc';
        else { ST.sortKey = k; ST.sortDir = (k === 'text' || k === 'added') ? 'asc' : 'desc'; }
        renderMain();
      };
      elm.onclick = go;
      elm.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
    });

    // 竞品图例开关
    host.querySelectorAll('[data-leg]').forEach((b) => {
      b.onclick = () => {
        const k = b.dataset.leg;
        if (ST.off.has(k)) ST.off.delete(k); else ST.off.add(k);
        renderMain();
      };
    });
  }

  /** 子页深链：#report/av-prompts */
  function initialPage() {
    const seg = String(location.hash || '').split('/')[1];
    return BUILDERS[seg] ? seg : 'av-overview';
  }

  function setPage(id) {
    if (!BUILDERS[id]) return false;
    ST.page = id;
    return renderMain();
  }

  ensureStyle();

  window.AV = {
    renderReport,
    setPage,
    page: () => currentPage(),
    /** 纯函数：返回某子页的 HTML，供离线冒烟测试 */
    html: (pageId) => (BUILDERS[pageId] ? BUILDERS[pageId]() : ''),
    pages: Object.keys(BUILDERS),
    groups: () => GROUPS.map((g) => ({ id: g.id, label: g.label, items: g.items.map((i) => i.id), reserved: !!g.reserved })),
    sidebarHTML: htmlSidebar,
    /** 当前数据来源（demo = seed / live = report.json） */
    source: () => ({
      mode: M().mode, sample: M().sample, generatedAt: M().generatedAt,
      answers: M().totals.answers, prompts: M().totals.prompts, days: M().totals.days,
      tried: SRC.tried, err: SRC.err
    }),
    /** 主动重新拉一次真数据（调试用） */
    refresh: () => { SRC.tried = false; boot(); },
    /** 测试注入用：绕开网络直接塞一份 live 数据 */
    __inject: (payload) => {
      const live = normalizeLive(payload);
      SRC.tried = true;
      SRC.live = live;
      return !!live;
    },
    data: { BRAND, RANGE, LABELS, TREND, KPI_SETS, PROMPT_ROWS, COMP_ROWS, TOP_DOMAINS, TOP_PROMPTS, TOP_COMPETITORS }
  };
})();
