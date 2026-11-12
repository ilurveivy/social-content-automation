'use strict';
/* ============================================================
   AI Visibility 聚合器 —— 把原始扫描记录算成页面要的指标
   ------------------------------------------------------------
   输入：data/visibility/config.json
         data/visibility/runs/*.json      （visibility-scan.js 攒出来的）
   输出：public/data/visibility/report.json
         ↑ 前端 /views/report.js 直接 fetch 这个文件（public/ 下静态可读，
           所以不需要给 server.js 加接口）

   指标口径（写清楚，避免以后自己都搞混）：
     AI visibility     提到你的回答数 / 总回答数
     Share of voice    提到你的回答数 / (提到你的 + 提到全部竞品的回答数之和)
     Cited domains     所有回答里出现过的不同引用域名数
     Cited URLs        引用链接总次数
     Unlinked cites    提到了你、但整条回答没给过你域名的次数
     Avg. position     提到你时你排第几（按首次出现位置）的均值，越小越好

   用法：
     node scripts/visibility-report.js
     node scripts/visibility-report.js --quiet
   ============================================================ */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CONFIG = path.join(ROOT, 'data', 'visibility', 'config.json');
const RUNDIR = path.join(ROOT, 'data', 'visibility', 'runs');
const OUT = path.join(ROOT, 'public', 'data', 'visibility', 'report.json');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function loadJSON(f, fb) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return fb; } }
function writeJSON(f, o) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(o, null, 2) + '\n', 'utf8');
}
const round1 = (n) => Math.round(n * 10) / 10;
const pctOf = (a, b) => (b ? round1((a / b) * 100) : 0);
const mean = (arr) => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0);

function labelOf(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return String(d.getDate()).padStart(2, '0') + ' ' + MONTHS[d.getMonth()];
}

/** 变化量：值为百分比→返回 pts；值为计数→返回 % 变化 */
function delta(from, to, isPct) {
  if (isPct) return round1(to - from);
  if (!from) return to ? 100 : 0;
  return round1(((to - from) / from) * 100);
}

function loadRuns() {
  if (!fs.existsSync(RUNDIR)) return [];
  const files = fs.readdirSync(RUNDIR).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  const days = [];
  files.forEach((f) => {
    const d = loadJSON(path.join(RUNDIR, f), null);
    if (!d || !Array.isArray(d.runs) || !d.runs.length) return;
    days.push({ date: d.date || f.slice(0, 10), runs: d.runs, mock: !!d.mock });
  });
  return days;
}

/** 单日小计，用于算「区间首日 → 末日」的变化量 */
function dayStats(day) {
  const runs = (day && day.runs) || [];
  const total = runs.length || 1;
  const men = runs.filter((r) => r.mentioned);
  const hosts = new Set();
  runs.forEach((r) => (r.citations || []).forEach((h) => hosts.add(h)));
  const ranks = men.map((r) => r.rank).filter((x) => x != null);
  return {
    vis: pctOf(men.length, total),
    mentions: runs.reduce((s, r) => s + (r.mentions || 0), 0),
    sentiment: pctOf(men.filter((r) => r.sentiment === 'positive').length, men.length || 1),
    avgRank: ranks.length ? round1(mean(ranks)) : 0,
    hosts: hosts.size,
    citedUrls: runs.reduce((s, r) => s + (r.citations || []).length, 0),
    unlinked: runs.filter((r) => r.mentioned && !r.brandCitations).length,
    cited: runs.reduce((s, r) => s + (r.brandCitations || 0), 0)
  };
}

function build(cfg, days) {
  const brand = cfg.brand;
  const comps = cfg.competitors || [];
  const isMock = days.some((d) => d.mock);
  const allRuns = days.flatMap((d) => d.runs);

  if (!allRuns.length) return null;

  /* ---------- 全局计数 ---------- */
  const total = allRuns.length;
  const mentionedRuns = allRuns.filter((r) => r.mentioned);
  const compMentionedTotal = comps.reduce((s, c) => s +
    allRuns.filter((r) => r.competitors && r.competitors[c.key] && r.competitors[c.key].mentioned).length, 0);

  /* ---------- 每天 × 每个实体的可见度（折线） ---------- */
  const labels = days.map((d) => labelOf(d.date));
  const series = [{
    key: 'you', name: brand.name, domain: brand.domain, you: true,
    values: days.map((d) => pctOf(d.runs.filter((r) => r.mentioned).length, d.runs.length))
  }].concat(comps.map((c) => ({
    key: c.key, name: c.name, domain: c.domain, you: false,
    values: days.map((d) => pctOf(
      d.runs.filter((r) => r.competitors && r.competitors[c.key] && r.competitors[c.key].mentioned).length,
      d.runs.length))
  })));

  const lastIdx = days.length - 1;
  const prevIdx = lastIdx - 1;
  const first = dayStats(days[0]);
  const last = dayStats(days[lastIdx]);
  const at = (s, i) => (i >= 0 && s.values[i] !== undefined ? s.values[i] : 0);
  const youSeries = series[0];

  /* ---------- 引用 ---------- */
  const hostCount = new Map();
  allRuns.forEach((r) => (r.citations || []).forEach((h) => hostCount.set(h, (hostCount.get(h) || 0) + 1)));
  const citedUrls = allRuns.reduce((s, r) => s + (r.citations || []).length, 0);
  const unlinked = allRuns.filter((r) => r.mentioned && !r.brandCitations).length;

  const topDomains = Array.from(hostCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, n]) => {
      const last = (days[lastIdx].runs || []).filter((r) => (r.citations || []).includes(name)).length;
      const prev = prevIdx >= 0 ? (days[prevIdx].runs || []).filter((r) => (r.citations || []).includes(name)).length : 0;
      return {
        name: name,
        n: n,
        d: delta(prev, last, false),
        you: name === String(brand.domain).toLowerCase() || name.endsWith('.' + String(brand.domain).toLowerCase())
      };
    });

  /* ---------- 逐 prompt ---------- */
  const promptRows = cfg.prompts.map((p) => {
    const rs = allRuns.filter((r) => r.promptId === p.id);
    const hit = rs.filter((r) => r.mentioned).length;
    return {
      stage: p.stage || 'Awareness',
      text: p.text,
      added: p.addedAt || '—',
      vis: pctOf(hit, rs.length),
      _hits: hit,
      _runs: rs.length,
      _last: (days[lastIdx].runs || []).filter((r) => r.promptId === p.id && r.mentioned).length,
      _prev: prevIdx >= 0 ? (days[prevIdx].runs || []).filter((r) => r.promptId === p.id && r.mentioned).length : 0
    };
  });

  const topPrompts = promptRows.slice()
    .sort((a, b) => b.vis - a.vis)
    .slice(0, 5)
    .map((p) => ({ text: p.text, n: p._hits, d: delta(p._prev, p._last, false), you: false }));

  /* ---------- 竞品 ---------- */
  const compRows = comps.map((c) => {
    const rs = allRuns.filter((r) => r.competitors && r.competitors[c.key]);
    const mentioned = rs.filter((r) => r.competitors[c.key].mentioned).length;
    const cited = rs.reduce((s, r) => s + (r.competitors[c.key].citations || 0), 0);
    return {
      name: c.name,
      domain: c.domain,
      mentioned: mentioned,
      cited: cited,
      vis: pctOf(mentioned, total),
      you: false,
      _key: c.key,
      _last: (days[lastIdx].runs || []).filter((r) => r.competitors && r.competitors[c.key] && r.competitors[c.key].mentioned).length,
      _prev: prevIdx >= 0 ? (days[prevIdx].runs || []).filter((r) => r.competitors && r.competitors[c.key] && r.competitors[c.key].mentioned).length : 0
    };
  });

  const youRow = {
    name: brand.name,
    domain: brand.domain,
    mentioned: mentionedRuns.length,
    cited: allRuns.reduce((s, r) => s + (r.brandCitations || 0), 0),
    vis: pctOf(mentionedRuns.length, total),
    you: true,
    _key: 'you',
    _last: (days[lastIdx].runs || []).filter((r) => r.mentioned).length,
    _prev: prevIdx >= 0 ? (days[prevIdx].runs || []).filter((r) => r.mentioned).length : 0
  };

  const compRowsAll = [youRow].concat(compRows).sort((a, b) => b.vis - a.vis);

  const topCompetitors = compRowsAll.slice(0, 5).map((r) => ({
    name: r.name,
    domain: r.domain,
    n: r.vis,
    d: delta(pctOf(r._prev, prevIdx >= 0 ? (days[prevIdx].runs || []).length : 1),
      pctOf(r._last, (days[lastIdx].runs || []).length), true),
    you: r.you
  }));

  /* ---------- 三张 KPI 卡的三个页签 ---------- */
  const sentimentPos = mentionedRuns.filter((r) => r.sentiment === 'positive').length;
  const ranks = mentionedRuns.map((r) => r.rank).filter((x) => x != null);
  const brandMentionsTotal = allRuns.reduce((s, r) => s + (r.mentions || 0), 0);
  const uniqHosts = hostCount.size;

  const kpis = {
    results: [
      { name: 'AI visibility', value: round1(pctOf(mentionedRuns.length, total)) + '%', raw: pctOf(mentionedRuns.length, total),
        delta: delta(first.vis, last.vis, true), unit: 'pts',
        hint: '在追踪的 prompt 里，AI 回答提到你的比例。' },
      { name: 'Share of voice', value: round1(pctOf(mentionedRuns.length, mentionedRuns.length + compMentionedTotal)) + '%',
        raw: pctOf(mentionedRuns.length, mentionedRuns.length + compMentionedTotal),
        delta: 0, unit: 'pts',
        hint: '你与全部竞品合计提及量中，你占的份额。' },
      { name: 'Cited pages', value: String(youRow.cited),
        delta: delta(first.cited, last.cited, false), unit: 'pct',
        hint: 'AI 回答中引用你域名的次数。' }
    ],
    brand: [
      { name: 'Brand mentions', value: String(brandMentionsTotal),
        delta: delta(first.mentions, last.mentions, false), unit: 'pct',
        hint: '品牌名被直接提及的总次数。' },
      { name: 'Brand sentiment', value: round1(pctOf(sentimentPos, mentionedRuns.length)) + '%',
        delta: delta(first.sentiment, last.sentiment, true), unit: 'pts',
        hint: '提及中含正面表述的比例。' },
      { name: 'Avg. position', value: ranks.length ? round1(mean(ranks)) : '—',
        delta: delta(first.avgRank, last.avgRank, true), unit: 'pts',
        hint: '在回答的候选清单中，你平均排第几（越小越好）。' }
    ],
    citation: [
      { name: 'Cited domains', value: String(uniqHosts),
        delta: delta(first.hosts, last.hosts, false), unit: 'pct',
        hint: '所有回答里出现过的不同引用域名数。' },
      { name: 'Cited URLs', value: String(citedUrls),
        delta: delta(first.citedUrls, last.citedUrls, false), unit: 'pct',
        hint: '引用链接的总次数。' },
      { name: 'Unlinked cites', value: String(unlinked),
        delta: delta(first.unlinked, last.unlinked, false), unit: 'pct',
        hint: '提到你但没给链接的次数。' }
    ]
  };

  return {
    mode: 'live',
    generatedAt: new Date().toISOString(),
    sample: isMock ? 'mock' : 'real',
    range: { from: days[0].date, to: days[days.length - 1].date },
    brand: { name: brand.name, domain: brand.domain },
    labels: labels,
    series: series,
    kpis: kpis,
    topDomains: topDomains,
    topPrompts: topPrompts,
    topCompetitors: topCompetitors,
    promptRows: promptRows.map((p) => ({ stage: p.stage, text: p.text, added: p.added, vis: p.vis })),
    compRows: compRowsAll.map((r) => ({
      name: r.name, domain: r.domain, mentioned: r.mentioned, cited: r.cited, vis: r.vis, you: r.you
    })),
    totals: { answers: total, prompts: cfg.prompts.length, days: days.length },
    defs: {
      visibility: '提到你的回答数 / 总回答数',
      shareOfVoice: '提到你的回答数 / (你 + 各竞品被提到的回答数之和)',
      citedDomains: '所有回答里出现过的不同引用域名数',
      unlinked: '提到了你、但整条回答没给过你域名的次数'
    }
  };
}

function main() {
  const quiet = process.argv.includes('--quiet');
  const cfg = loadJSON(CONFIG, null);
  if (!cfg || !cfg.brand) {
    console.error('❌ 读不到 data/visibility/config.json');
    return 2;
  }
  cfg.competitors = Array.isArray(cfg.competitors) ? cfg.competitors : [];
  cfg.prompts = Array.isArray(cfg.prompts) ? cfg.prompts : [];

  const days = loadRuns();
  if (!days.length) {
    console.error('');
    console.error('❌ data/visibility/runs/ 里还没有任何扫描记录。');
    console.error('   先跑一次扫描（--mock 不花钱，可以先跑通链路）：');
    console.error('     node scripts/visibility-scan.js --mock');
    console.error('');
    return 3;
  }

  const report = build(cfg, days);
  if (!report) {
    console.error('❌ 记录为空，算不出指标');
    return 3;
  }
  writeJSON(OUT, report);

  if (!quiet) {
    console.log('');
    console.log('  AI Visibility 聚合完成');
    console.log('  ────────────────────────────────────────────');
    console.log('  区间      ' + report.range.from + ' → ' + report.range.to + '（' + report.totals.days + ' 天）');
    console.log('  回答      ' + report.totals.answers + ' 条 · ' + report.totals.prompts + ' 条 prompt');
    console.log('  数据源    ' + (report.sample === 'mock' ? '⚠️ mock（假数据）' : '真实模型回答'));
    console.log('');
    report.kpis.results.forEach((k) => {
      console.log('  ' + k.name.padEnd(18) + String(k.value).padStart(7) + '   ' +
        (k.delta >= 0 ? '▲ +' : '▼ ') + k.delta + (k.unit === 'pts' ? ' pts' : '%'));
    });
    console.log('');
    console.log('  已写入    ' + path.relative(ROOT, OUT));
    console.log('  刷新 Report 页面即可看到（首页徽标会从「示例数据」变成「实时数据」）');
    console.log('');
  }
  return 0;
}

if (require.main === module) process.exit(main() || 0);

module.exports = { build, loadRuns, delta };
