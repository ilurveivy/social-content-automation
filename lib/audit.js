'use strict';
/**
 * Content audit：把 Google Search Console 的导出表变成"按优先级排的修复清单"。
 *
 * 纯函数、确定性、不联网、不猜：
 *   - 只吃用户粘贴的导出（真实 OAuth 没接，见 README）
 *   - 每条判断都给得出依据（区间阈值写在这里，界面上也会显示）
 *   - 没有数据就是没有数据，返回 warnings，不编排名
 */

/** 表头识别：GSC 中英文导出都认 */
const COL = {
  query: ['query', 'queries', 'topqueries', 'searchquery', 'keyword', 'keywords', '搜索字词', '查询', '关键词', '热门查询'],
  clicks: ['clicks', 'cicks', '点击次数', '点击'],
  impressions: ['impressions', 'impression', '展示次数', '展示', '曝光次数', '曝光'],
  ctr: ['ctr', '点击率'],
  position: ['position', 'avgposition', 'averageposition', '平均排名', '排名', '位置']
};

const norm = (s) => String(s || '').trim().toLowerCase().replace(/["']/g, '').replace(/\s+/g, '');

function detectDelimiter(line) {
  if (line.includes('\t')) return '\t';
  if (line.includes(';')) return ';';
  if (line.split(',').length > 2) return ',';
  return null;
}

function num(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s || s === '-' || s === '—') return 0;
  const pct = s.endsWith('%');
  // 顺手去掉引号（CSV 里 "1,900" 这种）和不换行空格
  const n = parseFloat(s.replace(/["'%,\s\u00a0]/g, ''));
  if (!isFinite(n)) return 0;
  return pct ? n / 100 : n;
}

/**
 * 按分隔符切一行，但尊重引号：CSV 里的 "1,900" 不能被逗号切开
 * （这是真实踩过的坑：不加这层，"1,900" 会被切成 `"1` 和 `900"`，展示数变成 1）
 */
function splitLine(line, delim) {
  if (!delim || delim === '\t') return line.split('\t');
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; continue; }
      inQ = !inQ;
      continue;
    }
    if (ch === delim && !inQ) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function mapHeader(cells) {
  const map = {};
  cells.forEach((c, i) => {
    const n = norm(c);
    for (const [key, list] of Object.entries(COL)) {
      if (map[key] !== undefined) continue;
      if (list.some((alias) => n === alias || n.startsWith(alias) || n.includes(alias))) map[key] = i;
    }
  });
  return map;
}
/**
 * 解析粘贴的表格。返回 { rows, warnings, headerFound }
 * row = { query, clicks, impressions, ctr, position }
 */
function parseGsc(text) {
  const raw = String(text || '');
  const warnings = [];
  const lines = raw.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim());
  if (!lines.length) return { rows: [], warnings: ['没有内容'], headerFound: false };

  // 找表头行：必须同时认出"查询"和至少一个指标
  let headIdx = -1;
  let map = {};
  let delim = null;
  for (let i = 0; i < Math.min(lines.length, 8); i++) {
    const d = detectDelimiter(lines[i]) || '\t';
    const m = mapHeader(splitLine(lines[i], d));
    if (m.query !== undefined && (m.clicks !== undefined || m.impressions !== undefined || m.position !== undefined)) {
      headIdx = i; map = m; delim = d;
      break;
    }
  }

  if (headIdx < 0) {
    // 没表头：按 GSC 面板默认顺序（查询 / 点击 / 展示 / CTR / 排名）猜，但要明确警告
    const d = detectDelimiter(lines[0]) || '\t';
    const first = splitLine(lines[0], d);
    if (first.length >= 3 && !/^[\d.,%\s-]+$/.test(first[0])) {
      map = { query: 0, clicks: 1, impressions: 2, ctr: 3, position: 4 };
      delim = d;
      warnings.push('没找到表头，按「查询 / 点击 / 展示 / CTR / 排名」的列序解析；如果列不对请补一行表头。');
    } else {
      return { rows: [], warnings: ['认不出来：至少要有一列「查询」和其中一个指标列（点击 / 展示 / 排名）。'], headerFound: false };
    }
  }

  const rows = [];
  for (let i = headIdx < 0 ? 0 : headIdx + 1; i < lines.length; i++) {
    const cells = splitLine(lines[i], delim);
    const q = String(cells[map.query] || '').replace(/^["']|["']$/g, '').trim();
    if (!q) continue;
    if (q.length > 200) continue;
    const impressions = Math.round(num(cells[map.impressions]));
    const clicks = Math.round(num(cells[map.clicks]));
    const position = num(cells[map.position]);
    let ctr = cells[map.ctr] !== undefined ? num(cells[map.ctr]) : 0;
    if (!ctr && impressions > 0) ctr = clicks / impressions;
    rows.push({
      query: q,
      clicks,
      impressions,
      ctr: Math.round(ctr * 10000) / 10000,
      position: Math.round(position * 10) / 10
    });
  }
  if (!rows.length) warnings.push('表头认出来了，但一行数据都没读到。');
  return { rows, warnings, headerFound: headIdx >= 0 };
}

/** 阈值都在这，改这里等于改规则；界面上也会把区间写出来 */
const RULES = {
  striking: { minPos: 11, maxPos: 20, minImpr: 50 },
  lowCtr: { maxPos: 10, maxCtr: 0.02, minImpr: 100 },
  thin: { minPos: 21, maxPos: 50, minImpr: 20 },
  gap: { minPos: 50, minImpr: 10 }
};

const TYPE_META = {
  low_ctr: { label: '标题/描述不够吸引', weight: 1.2, action: (r) => `改 title 与 meta description：现在的 CTR 是 ${(r.ctr * 100).toFixed(1)}%，排在第 ${r.position} 位说明位置够、文案不够。` },
  striking: { label: '临门一脚（第 2 页）', weight: 1.0, action: (r) => `补内容把它推上首页：排名 ${r.position}，展示 ${r.impressions}，最省力的做法是加一个小节直接回答这个查询。` },
  thin: { label: '内容不够深', weight: 0.6, action: (r) => `排名 ${r.position}：主题对但覆盖浅，扩写成一篇完整文章比新建页面划算。` },
  gap: { label: '没有对应内容', weight: 0.5, action: (r) => `排名 ${r.position || '未上榜'}：现有页面没接住这个意图，做一个新页或新章节。` },
  pillar: { label: '内容支柱还没落地', weight: 0.8, action: (r) => `「${r.query}」这条支柱在数据里没有任何查询命中，要么还没写，要么写了没人搜。` }
};

const pill = (x) => x.replace(/[^\w\s\u4e00-\u9fa5]/g, '').slice(0, 6);

function analyze(input, opts) {
  const options = opts || {};
  const parsed = Array.isArray(input) ? { rows: input, warnings: [] } : parseGsc(input);
  const rows = parsed.rows || [];
  const pillars = (options.pillars || []).map((p) => String(p || '').trim()).filter(Boolean);

  const totalImpr = rows.reduce((a, r) => a + r.impressions, 0);
  const totalClicks = rows.reduce((a, r) => a + r.clicks, 0);
  const opportunities = [];

  for (const r of rows) {
    let type = null;
    if (r.position >= RULES.striking.minPos && r.position <= RULES.striking.maxPos && r.impressions >= RULES.striking.minImpr) type = 'striking';
    else if (r.position > 0 && r.position <= RULES.lowCtr.maxPos && r.ctr < RULES.lowCtr.maxCtr && r.impressions >= RULES.lowCtr.minImpr) type = 'low_ctr';
    else if (r.position > RULES.thin.minPos && r.position <= RULES.thin.maxPos && r.impressions >= RULES.thin.minImpr) type = 'thin';
    else if ((r.position > RULES.gap.minPos || r.position === 0) && r.impressions >= RULES.gap.minImpr) type = 'gap';
    if (!type) continue;

    const meta = TYPE_META[type];
    opportunities.push({
      id: 'op_' + type + '_' + opportunities.length,
      type,
      typeLabel: meta.label,
      query: r.query,
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: r.ctr,
      position: r.position,
      priority: Math.round(r.impressions * meta.weight),
      action: meta.action(r),
      campaignName: `SEO · ${r.query.slice(0, 40)}`
    });
  }

  // 内容支柱 vs 实际有搜索数据的主题
  if (pillars.length && rows.length) {
    for (const p of pillars) {
      // 只认 >=3 字符的词：像 'AI' 这种两个字母会在英文查询里假命中，宁可报「支柱没内容」
      const keys = p.split(/[\s/、,·]+/).filter((w) => w.length >= 3);
      const hit = rows.some((r) => keys.some((k) => r.query.toLowerCase().includes(k.toLowerCase())));
      if (hit) continue;
      const meta = TYPE_META.pillar;
      opportunities.push({
        id: 'op_pillar_' + pill(p),
        type: 'pillar',
        typeLabel: meta.label,
        query: p,
        clicks: 0,
        impressions: 0,
        ctr: 0,
        position: 0,
        priority: Math.round(totalImpr * 0.05 * meta.weight),
        action: meta.action({ query: p }),
        campaignName: `SEO · ${p}`.slice(0, 60)
      });
    }
  }

  opportunities.sort((a, b) => b.priority - a.priority);
  const byType = {};
  for (const o of opportunities) byType[o.type] = (byType[o.type] || 0) + 1;

  return {
    ok: true,
    rows: rows.length,
    totalImpressions: totalImpr,
    totalClicks,
    ctr: totalImpr ? Math.round((totalClicks / totalImpr) * 10000) / 10000 : 0,
    avgPosition: rows.length ? Math.round((rows.reduce((a, r) => a + (r.position || 0), 0) / rows.length) * 10) / 10 : 0,
    opportunities: opportunities.slice(0, 40),
    byType,
    rules: RULES,
    pillars: pillars.length,
    sample: rows.slice(0, 8),
    warnings: parsed.warnings || []
  };
}

module.exports = { parseGsc, analyze, RULES, TYPE_META, num, mapHeader };
