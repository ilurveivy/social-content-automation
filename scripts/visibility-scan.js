'use strict';
/* ============================================================
   AI Visibility 扫描器 —— 真正去「问模型」，把回答存成原始记录
   ------------------------------------------------------------
   为什么需要它：AI 可见度不是能算出来的，是必须**真的去问**。
   每一条 prompt 都要让模型现场回答一次，然后从回答里数：
   - 有没有提到你的品牌（提到 = 可见）
   - 提到你排在第几（越靠前越好）
   - 引用了哪些域名 / 链接（= 引用份额）
   - 提到了哪些竞品

   用法：
     node scripts/visibility-scan.js                 # 真跑（需要先配好 provider）
     node scripts/visibility-scan.js --mock          # 不花钱，端到端自测
     node scripts/visibility-scan.js --mock --runs 1 # 少跑几轮
     node scripts/visibility-scan.js --prompt p01 --runs 1
     node scripts/visibility-scan.js --date 2026-11-10
     node scripts/visibility-scan.js --dry-run       # 只打印要问什么，不调模型

   产出：data/visibility/runs/<YYYY-MM-DD>.json
        同一 prompt 同一天重跑会覆盖那一条（幂等，不会重复累加）

   零依赖；模型调用复用项目已有的 lib/providers.js
   ============================================================ */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CONFIG = path.join(ROOT, 'data', 'visibility', 'config.json');
const RUNDIR = path.join(ROOT, 'data', 'visibility', 'runs');

/* ---------- 参数 ---------- */
function parseArgs(argv) {
  const a = { mock: false, dryRun: false, runs: null, prompt: null, date: null, provider: null, quiet: false };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--mock') a.mock = true;
    else if (k === '--dry-run') a.dryRun = true;
    else if (k === '--quiet') a.quiet = true;
    else if (k === '--runs') a.runs = parseInt(argv[++i], 10);
    else if (k === '--prompt') a.prompt = argv[++i];
    else if (k === '--date') a.date = argv[++i];
    else if (k === '--provider') a.provider = argv[++i];
    else if (k === '--help' || k === '-h') a.help = true;
  }
  return a;
}

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function loadJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}

function writeJSON(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

/* ============================================================
   1. 从回答里抽取指标（纯函数，可单测）
   ============================================================ */

const POS = ['best', 'recommend', 'great', 'excellent', 'powerful', 'solid', 'worth it', 'good choice',
  'easy to use', 'top pick', 'strong', 'reliable', 'well suited'];
const NEG = ['avoid', 'not recommended', 'poor', 'lacks', 'lacking', 'expensive', 'overpriced',
  'worst', 'buggy', 'limited', 'no longer', 'deprecated', 'not worth', 'drawback', 'downside'];

function lower(s) { return String(s || '').toLowerCase(); }

/** 抽取所有被引用的域名（含裸域名，不带协议的那些） */
function extractCitations(text) {
  const out = new Set();
  const t = String(text || '');

  // 带协议 / 带 www 的完整链接
  const urlRe = /(?:https?:\/\/|www\.)[^\s)\]"'<>）】]+/gi;
  let m;
  while ((m = urlRe.exec(t))) {
    const raw = m[0].replace(/[.,;:]+$/, '');
    let host = '';
    try { host = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw).hostname; } catch (e) { host = ''; }
    host = lower(host).replace(/^www\./, '');
    if (host && host.includes('.')) out.add(host);
  }

  // 裸域名：xxx.com / xxx.ai / xxx.io …
  const bareRe = /\b([a-z0-9][a-z0-9-]{1,60}\.(?:com|ai|io|co|org|net|dev|app|so|me|xyz|cn))(?![a-z0-9.-])/gi;
  while ((m = bareRe.exec(t))) {
    out.add(lower(m[1]).replace(/^www\./, ''));
  }
  return Array.from(out);
}

/** 品牌/竞品在回答里的第一次出现位置 → 名次（1 最靠前） */
function firstIndexOf(text, aliases) {
  const t = lower(text);
  let best = -1;
  aliases.forEach((a) => {
    const i = t.indexOf(lower(a));
    if (i >= 0 && (best < 0 || i < best)) best = i;
  });
  return best;
}

/**
 * 数「提到了几次」。别名之间会重叠（品牌有 eSheep.ai / eSheep / esheep 三个别名，
 * 一次 "eSheep.ai" 会被三个别名各命中一次 → 不合并就会算成 3 次）。
 * 所以先把所有命中摊成区间，合并重叠，最后数区间段数。
 */
function countOf(text, aliases) {
  const t = lower(text);
  const spans = [];
  aliases.forEach((a) => {
    const s = lower(a);
    if (!s) return;
    let i = 0;
    while ((i = t.indexOf(s, i)) >= 0) {
      spans.push([i, i + s.length]);
      i += s.length;
    }
  });
  if (!spans.length) return 0;
  spans.sort((x, y) => x[0] - y[0] || y[1] - x[1]);
  let n = 1;
  let end = spans[0][1];
  for (let i = 1; i < spans.length; i++) {
    if (spans[i][0] >= end) { n++; end = spans[i][1]; }
    else if (spans[i][1] > end) { end = spans[i][1]; }
  }
  return n;
}

function sentimentOf(text) {
  const t = lower(text);
  let pos = 0;
  let neg = 0;
  POS.forEach((w) => { if (t.includes(w)) pos++; });
  NEG.forEach((w) => { if (t.includes(w)) neg++; });
  if (pos > neg) return 'positive';
  if (neg > pos) return 'negative';
  return 'neutral';
}

function hostMatches(host, domain) {
  const d = lower(domain).replace(/^www\./, '');
  return host === d || host.endsWith('.' + d);
}

/**
 * 一条回答 → 一条指标记录
 * cfg: { brand:{name,domain,aliases}, competitors:[{key,name,domain,aliases}] }
 */
function analyze(answer, cfg) {
  const text = String(answer || '');
  const citations = extractCitations(text);

  const brandAliases = cfg.brand.aliases && cfg.brand.aliases.length
    ? cfg.brand.aliases : [cfg.brand.name, cfg.brand.domain];
  const brandAt = firstIndexOf(text, brandAliases);
  const brandCitations = citations.filter((h) => hostMatches(h, cfg.brand.domain));

  const comps = {};
  const ranks = [];
  if (brandAt >= 0) ranks.push({ key: 'you', at: brandAt });

  cfg.competitors.forEach((c) => {
    const aliases = c.aliases && c.aliases.length ? c.aliases : [c.name, c.domain];
    const at = firstIndexOf(text, aliases);
    const cites = citations.filter((h) => hostMatches(h, c.domain));
    comps[c.key] = {
      mentioned: at >= 0,
      mentions: countOf(text, aliases),
      at: at,
      citations: cites.length
    };
    if (at >= 0) ranks.push({ key: c.key, at: at });
  });

  ranks.sort((a, b) => a.at - b.at);
  const rank = brandAt >= 0 ? ranks.findIndex((r) => r.key === 'you') + 1 : null;

  return {
    mentioned: brandAt >= 0,
    mentions: countOf(text, brandAliases),
    rank: rank,
    sentiment: brandAt >= 0 ? sentimentOf(text) : null,
    citations: citations,
    brandCitations: brandCitations.length,
    competitors: comps,
    answerChars: text.length,
    answerHead: text.slice(0, 500)
  };
}

/* ============================================================
   2. 造回答：真跑 / mock
   ============================================================ */

const MOCK_HOSTS = ['reddit.com', 'youtube.com', 'g2.com', 'producthunt.com', 'buffer.com',
  'hootsuite.com', 'metricool.com', 'publer.com', 'zapier.com', 'medium.com'];

/** 确定性 mock：同一个 (prompt, run) 每次结果一致，方便断言 */
function mockAnswer(prompt, runIndex, cfg, salt) {
  let s = 0;
  const seedStr = prompt.id + '|' + runIndex + '|' + (salt || '');
  for (let i = 0; i < seedStr.length; i++) s = (s * 31 + seedStr.charCodeAt(i)) % 100000;
  const hit = (s % 100) < 42;                       // 约 42% 的回答提到品牌
  const comp = cfg.competitors[s % cfg.competitors.length];
  const host1 = MOCK_HOSTS[s % MOCK_HOSTS.length];
  const host2 = MOCK_HOSTS[(s + 3) % MOCK_HOSTS.length];

  const parts = [];
  parts.push('Here are a few options worth looking at:');
  if (hit) {
    parts.push('1. ' + cfg.brand.name + ' — built for adapting one piece of content across channels. Easy to use and solid for small teams. See https://' + cfg.brand.domain + '/pricing');
    parts.push('2. ' + comp.name + ' — a well known alternative (https://' + comp.domain + ').');
  } else {
    parts.push('1. ' + comp.name + ' — a popular choice (https://' + comp.domain + ').');
    parts.push('2. Buffer — simple scheduling, limited analytics (https://buffer.com).');
  }
  parts.push('Worth reading the community threads on https://' + host1 + '/r/socialmedia and https://' + host2 + '/reviews.');
  return parts.join('\n');
}

async function realAnswer(prompt, cfg, provider, budget) {
  const providers = require(path.join(ROOT, 'lib', 'providers.js'));
  const system = cfg.scan.system ||
    'You are a helpful assistant answering a real user question. Answer naturally and concisely, ' +
    'listing concrete product or tool recommendations. Include links when you would normally cite them.';
  return providers.chat(provider, {
    system: system,
    messages: [{ role: 'user', content: prompt.text }],
    // ⚠️ 这条链路上的模型可能是「推理模型」：reasoning_content 会先吃掉预算，
    // 预算给小了 message.content 就是空串（表现为「openai 返回空内容」）。
    // 700 实测 44/48 次为空；3000 起就稳定有正文。
    maxTokens: budget || cfg.scan.maxTokens || 3000,
    temperature: cfg.scan.temperature === undefined ? 0.4 : cfg.scan.temperature,
    timeoutMs: cfg.scan.timeoutMs || 120000
  });
}

/* ============================================================
   3. 主流程
   ============================================================ */
async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log('\n用法: node scripts/visibility-scan.js [--mock] [--runs N] [--prompt p01] [--date YYYY-MM-DD] [--dry-run]\n');
    return 0;
  }

  const cfg = loadJSON(CONFIG, null);
  if (!cfg || !Array.isArray(cfg.prompts) || !cfg.prompts.length) {
    console.error('❌ 读不到 data/visibility/config.json（或里面没有 prompts）');
    return 2;
  }
  if (!cfg.brand || !cfg.brand.domain) {
    console.error('❌ config.json 里缺 brand.domain（没有它没法判断「提到你」）');
    return 2;
  }
  cfg.competitors = Array.isArray(cfg.competitors) ? cfg.competitors : [];

  const date = args.date || today();
  const runs = Math.max(1, args.runs || cfg.scan.runsPerPrompt || 3);
  const prompts = args.prompt
    ? cfg.prompts.filter((p) => p.id === args.prompt)
    : cfg.prompts;
  if (!prompts.length) {
    console.error('❌ --prompt ' + args.prompt + ' 在 config.json 里找不到');
    return 2;
  }

  // 选 provider
  let provider = null;
  let providerLabel = 'mock';
  if (!args.mock) {
    const providers = require(path.join(ROOT, 'lib', 'providers.js'));
    provider = args.provider ? providers.getProvider(args.provider) : providers.activeProvider();
    if (!provider) {
      console.error('');
      console.error('❌ 还没有配置模型，无法真跑。两条路：');
      console.error('   1) 打开应用 → Settings 里加一个 provider（OpenAI 兼容网关 / Anthropic 都行），');
      console.error('      然后在下方「模型」里选一个，再回来执行本命令；');
      console.error('   2) 先用 --mock 跑通全链路（不花钱，数据是假的）：');
      console.error('        node scripts/visibility-scan.js --mock');
      console.error('');
      return 3;
    }
    providerLabel = (provider.kind || 'openai') + ' / ' + provider.model;
    if (!provider.apiKey && !/localhost|127\.0\.0\.1/.test(provider.baseUrl || '')) {
      console.warn('⚠️ 这个 provider 没填 apiKey，请求大概率会被拒。');
    }
  }

  if (!args.quiet) {
    console.log('');
    console.log('  AI Visibility 扫描');
    console.log('  ────────────────────────────────────────────');
    console.log('  日期      ' + date);
    console.log('  模型      ' + providerLabel + (args.mock ? '  （假数据，仅用于自测）' : ''));
    console.log('  prompt    ' + prompts.length + ' 条 × ' + runs + ' 轮 = ' + (prompts.length * runs) + ' 次回答');
    console.log('  品牌      ' + cfg.brand.name + ' (' + cfg.brand.domain + ')');
    console.log('  竞品      ' + (cfg.competitors.map((c) => c.name).join(' / ') || '（无）'));
    console.log('');
  }

  if (args.dryRun) {
    prompts.forEach((p) => console.log('  · [' + p.id + '] ' + p.text));
    console.log('\n  --dry-run：只列了要问什么，没有调用模型。\n');
    return 0;
  }

  // 读已有记录（同一天重跑要覆盖，不能累加）
  const file = path.join(RUNDIR, date + '.json');
  const day = loadJSON(file, { date: date, createdAt: null, provider: providerLabel, runs: [] });
  const byKey = new Map();
  (day.runs || []).forEach((r) => byKey.set(r.promptId + '#' + r.runIndex, r));

  let done = 0;
  let failed = 0;
  let mentionedN = 0;

  for (const p of prompts) {
    for (let ri = 1; ri <= runs; ri++) {
      const tag = '[' + p.id + ' r' + ri + ']';
      let answer = '';
      try {
        answer = args.mock ? mockAnswer(p, ri, cfg, date) : await realAnswer(p, cfg, provider);
      } catch (e) {
        // 推理模型偶尔把预算全烧在 reasoning 上 → content 空。
        // 这种情况不是失败，是预算不够，翻倍再试一次。
        if (!args.mock && /返回空内容/.test(e.message || '')) {
          try {
            const bigger = Math.max(8000, (cfg.scan.maxTokens || 3000) * 2);
            answer = await realAnswer(p, cfg, provider, bigger);
          } catch (e2) {
            failed++;
            console.error('  ❌ ' + tag + ' 加了 token 仍为空：' + e2.message);
            continue;
          }
        } else {
          failed++;
          console.error('  ❌ ' + tag + ' 调用失败：' + e.message);
          continue;
        }
      }

      const a = analyze(answer, cfg);
      if (a.mentioned) mentionedN++;
      byKey.set(p.id + '#' + ri, Object.assign({
        promptId: p.id,
        prompt: p.text,
        stage: p.stage || '',
        runIndex: ri,
        at: new Date().toISOString(),
        mock: !!args.mock
      }, a));
      done++;
      if (!args.quiet) {
        console.log('  ' + (a.mentioned ? '✅' : '· ') + ' ' + tag + ' ' +
          (a.mentioned ? '提到你（第 ' + a.rank + ' 位，引用 ' + a.brandCitations + ' 条）' : '没提到你') +
          '  引用域名 ' + a.citations.length + ' 个  回答 ' + a.answerChars + ' 字');
      }
    }
  }

  day.runs = Array.from(byKey.values()).sort((a, b) =>
    a.promptId.localeCompare(b.promptId) || a.runIndex - b.runIndex);
  day.updatedAt = new Date().toISOString();
  day.provider = providerLabel;
  day.mock = !!args.mock;
  writeJSON(file, day);

  const total = day.runs.length;
  if (!args.quiet) {
    console.log('');
    console.log('  ────────────────────────────────────────────');
    console.log('  本次成功   ' + done + ' 次' + (failed ? '，失败 ' + failed + ' 次' : ''));
    console.log('  当天累计   ' + total + ' 条记录');
    if (total) {
      console.log('  当天可见度 ' + (100 * day.runs.filter((r) => r.mentioned).length / total).toFixed(1) + '%' +
        '（提到 ' + day.runs.filter((r) => r.mentioned).length + ' / ' + total + '）');
    }
    console.log('  已写入     ' + path.relative(ROOT, file));
    console.log('');
    console.log('  下一步：node scripts/visibility-report.js   （把这些记录算成页面要的指标）');
    console.log('');
  }
  return failed && !done ? 1 : 0;
}

if (require.main === module) {
  main().then((code) => process.exit(code || 0)).catch((e) => {
    console.error('❌ ' + (e && e.stack || e));
    process.exit(1);
  });
}

module.exports = { analyze, extractCitations, sentimentOf, firstIndexOf, mockAnswer, hostMatches };
