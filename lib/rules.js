'use strict';
/**
 * 规则检查引擎：把 channels.js 里的规则 id 映射成确定性检查。
 * 纯函数，无网络、无副作用 —— 同样的输入永远同样的结果，方便写测试。
 */
const C = require('./channels');

const URL_RE = /https?:\/\/[^\s)>\]]+/gi;
const MD_BULLET_RE = /^\s*(?:[-*+]|\d+\.)\s+/m;
const HASHTAG_RE = /#[\p{L}\p{N}_]+/gu;

const len = (s) => [...(s || '')].length;
const lower = (s) => (s || '').toLowerCase();
const hasAny = (text, list) => list.filter((w) => lower(text).includes(lower(w)));
const urls = (s) => (s || '').match(URL_RE) || [];
/** X 的链接按 23 字符计 */
const weightedLen = (s, linkWeight = 0) => {
  let n = len(s);
  for (const u of urls(s)) n += linkWeight - len(u);
  return n;
};
const firstLine = (s) => (s || '').split('\n').find((l) => l.trim()) || '';
const firstWords = (s, k) => (s || '').replace(/\s+/g, ' ').trim().split(' ').slice(0, k).join(' ');
/** 中文一个字符承载的信息量约等于英文一个词，所以字符阈值必须按语种折算，否则中文稿永远"太短" */
const cjkRatio = (s) => {
  const chars = [...(s || '')];
  if (!chars.length) return 0;
  const cjk = chars.filter((c) => /[\u4e00-\u9fff\u3040-\u30ff]/.test(c)).length;
  return cjk / chars.length;
};
const isCJK = (s) => cjkRatio(s) > 0.3;

/** 把分镜包切成镜头块：每遇到「镜头 N」开头的一行就开一个新块 */
function shotBlocks(body) {
  const blocks = [];
  let cur = null;
  for (const line of (body || '').split('\n')) {
    if (/^\s*(?:【\s*)?镜头\s*\d+/.test(line)) {
      if (cur) blocks.push(cur);
      cur = { head: line.trim(), text: line + '\n' };
    } else if (cur) {
      cur.text += line + '\n';
    }
  }
  if (cur) blocks.push(cur);
  return blocks;
}

function countPoints(body, brief) {  const pts = (brief.sellingPoints || []).filter(Boolean);
  if (!pts.length) return 0;
  const b = lower(body);
  return pts.filter((p) => {
    const key = lower(p).replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).filter((w) => w.length > 3).slice(0, 3);
    return key.length ? key.filter((w) => b.includes(w)).length >= Math.min(2, key.length) : false;
  }).length;
}

const CHECKS = {
  yt_hook_first_2_lines: (b) => {
    const two = (b || '').split('\n').filter((l) => l.trim()).slice(0, 2).join(' ');
    const bad = /^(hi|hey|hello|大家好|我是|welcome back|in this video)/i.test(two.trim());
    return { ok: !bad && len(two) > 0, detail: bad ? '开头是自我介绍/寒暄' : '开头不是自我介绍' };
  },
  yt_len_min: (b) => {
    const min = isCJK(b) ? 300 : 600;
    return { ok: len(b) >= min, detail: `${len(b)} / ${min} 字符${isCJK(b) ? '（中文口径）' : ''}` };
  },
  yt_chapters: (b) => ({ ok: /\b\d{1,2}:\d{2}\b/.test(b || ''), detail: /\b\d{1,2}:\d{2}\b/.test(b || '') ? '有时间轴' : '缺 00:00 形式的时间轴' }),
  yt_single_cta: (b, brief) => {
    const hits = (b || '').match(/\b(subscribe|comment|click|sign up|try|book|download|关注|订阅|点击)\b/gi) || [];
    return { ok: hits.length <= 2, detail: `CTA 词出现 ${hits.length} 次` };
  },
  yt_no_link_bio: (b) => ({ ok: !/link in bio/i.test(b || ''), detail: /link in bio/i.test(b || '') ? '出现 link in bio' : '无' }),

  tt_hook_3s: (b) => {
    const w = firstWords(b, 15);
    const bad = /^(hi|hey|hello|大家好|我是|welcome)/i.test(w.trim());
    const hasNumberOrQ = /[0-9%$]|\?|？/.test(w);
    return { ok: !bad && (hasNumberOrQ || len(w) > 20), detail: `前 15 词：${w.slice(0, 50)}` };
  },
  tt_len_max: (b) => ({ ok: len(b) <= 900, detail: `${len(b)} / 900 字符` }),
  tt_spoken: (b) => ({ ok: !MD_BULLET_RE.test(b || ''), detail: MD_BULLET_RE.test(b || '') ? '出现 Markdown 列表' : '是口播体' }),
  tt_no_link: (b) => ({ ok: urls(b).length === 0, detail: `链接 ${urls(b).length} 个` }),
  tt_one_point: (b, brief) => {
    const n = countPoints(b, brief);
    return { ok: n <= 2, detail: `命中卖点 ${n} 条` };
  },

  x_len_280: (b) => ({ ok: weightedLen(b, 23) <= 280, detail: `${weightedLen(b, 23)} / 280（链接按 23 计）` }),
  x_hook_60: (b) => ({ ok: len(firstLine(b)) <= 60, detail: `首行 ${len(firstLine(b))} 字符` }),
  x_hashtag_max1: (b) => {
    const n = ((b || '').match(HASHTAG_RE) || []).length;
    return { ok: n <= 1, detail: `标签 ${n} 个` };
  },
  x_no_hard_sell: (b) => {
    const hit = hasAny(b, C.HARD_SELL);
    return { ok: hit.length === 0, detail: hit.length ? `硬广词：${hit.join(', ')}` : '无硬广词' };
  },

  rd_title_no_promo: (b, brief) => {
    // Reddit 的标题可能是正文第一行（直接粘），也可能是素材标题 —— 两边都查，任一命中即算
    const lineTitle = firstLine(b);
    const briefTitle = (brief && brief.title) || '';
    const hit = [...new Set([...hasAny(lineTitle, C.PROMO_WORDS), ...hasAny(briefTitle, C.PROMO_WORDS)])];
    if (!hit.length) return { ok: true, detail: '标题干净' };
    const where = hasAny(lineTitle, C.PROMO_WORDS).length ? '正文首行' : '素材标题';
    return { ok: false, detail: `${where}含推广词：${hit.join(', ')}` };
  },
  rd_no_link_first_para: (b) => {
    const p = (b || '').split(/\n\s*\n/)[0] || '';
    return { ok: urls(p).length === 0, detail: urls(p).length ? '第一段有链接' : '第一段无链接' };
  },
  rd_len_min: (b) => {
    const min = isCJK(b) ? 200 : 400;
    return { ok: len(b) >= min, detail: `${len(b)} / ${min} 字符${isCJK(b) ? '（中文口径）' : ''}` };
  },
  rd_has_question: (b) => ({ ok: /[?？]/.test(b || ''), detail: /[?？]/.test(b || '') ? '含提问' : '没有提问' }),
  rd_disclosure: (b) => {
    const mentions = /(i built|we built|i made|my product|our product|我做的|我们做的|我们的产品)/i.test(b || '');
    const discloses = /(disclosure|i work at|founder of|disclaimer|利益相关|我是作者)/i.test(b || '');
    return { ok: !mentions || discloses, detail: mentions && !discloses ? '提到自家产品但没披露' : '披露 OK' };
  },

  ce_subject_60: (b, brief) => {
    const s = (brief && brief.subject) || '';
    const caps = s.replace(/[^A-Z]/g, '').length > Math.max(6, s.length * 0.4);
    return { ok: len(s) <= 60 && !/[!！]/.test(s) && !caps, detail: `主题 ${len(s)} 字符${caps ? '（大量大写）' : ''}` };
  },
  ce_len_max: (b) => ({ ok: len(b) <= 1200, detail: `${len(b)} / 1200 字符` }),
  ce_link_max1: (b) => ({ ok: urls(b).length <= 1, detail: `链接 ${urls(b).length} 个` }),
  ce_no_attach_word: (b) => {
    const hit = hasAny(b, C.ATTACH_WORDS);
    return { ok: hit.length === 0, detail: hit.length ? `出现「${hit.join(', ')}」——会被 Gmail 拦截` : '无附件字样' };
  },
  ce_one_ask: (b) => {
    const asks = (b || '').match(/\b(call|meeting|zoom|book|schedule|reply|let me know|open to)\b/gi) || [];
    const banned = hasAny(b, ['call', 'meeting', 'zoom', 'schedule a']);
    return { ok: asks.length <= 1 && banned.length === 0, detail: banned.length ? `出现约通话词：${banned.join(', ')}` : `请求词 ${asks.length} 个` };
  },
  ce_points_max3: (b, brief) => {
    const n = countPoints(b, brief);
    return { ok: n <= 3, detail: `命中卖点 ${n} 条` };
  },

  lp_headline_60: (b) => {
    const h = firstLine(b);
    return { ok: len(h) <= 60, detail: `主标题 ${len(h)} 字符` };
  },
  lp_subhead_140: (b) => {
    const lines = (b || '').split('\n').filter((l) => l.trim());
    const sub = lines[1] || '';
    return { ok: len(sub) <= 140 && len(sub) > 0, detail: `副标题 ${len(sub)} 字符` };
  },
  lp_one_cta: (b, brief) => {
    const n = (b || '').match(/\b(get started|sign up|try free|book|download|start now|免费试用|立即开始)\b/gi) || [];
    // 素材里给了自定义 CTA 时，正文出现它也算数 —— 别强迫用户改成人家的按钮文案
    const custom = brief && brief.cta ? lower(brief.cta).trim() : '';
    const hasCustom = custom && lower(b).includes(custom.slice(0, Math.min(12, custom.length)));
    return { ok: hasCustom || (n.length >= 1 && n.length <= 2), detail: hasCustom ? '含素材指定的 CTA' : `CTA ${n.length} 个` };
  },
  lp_proof: (b) => {
    const ok = /\d+[%+]|\d{2,}|\$\d+|用户|客户|customers|users|revenue|hours saved/i.test(b || '');
    return { ok, detail: ok ? '有具体证据' : '只有形容词，没有证据' };
  },
  lp_no_jargon: (b) => {
    const hit = hasAny(b, C.JARGON);
    return { ok: hit.length === 0, detail: hit.length ? `行话：${hit.join(', ')}` : '无行话' };
  },

  /* ---- 视频分镜包 ---- */
  vs_shot_count: (b) => {
    const n = shotBlocks(b).length;
    return { ok: n >= 5, detail: `${n} 个镜头（≥5）` };
  },
  vs_total_duration: (b) => {
    const m = (b || '').match(/总时长\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(?:秒|s|sec)/i);
    if (!m) return { ok: false, detail: '没写「总时长：N 秒」' };
    const sec = Number(m[1]);
    return { ok: sec > 0 && sec <= 45, detail: `总时长 ${sec} 秒（≤45）` };
  },
  vs_each_has_prompt: (b) => {
    const blocks = shotBlocks(b);
    if (!blocks.length) return { ok: false, detail: '没有镜头块' };
    const bad = blocks.filter((x) => !/画面\s*[:：]/.test(x.text) || !/提示词\s*[:：]/.test(x.text));
    return { ok: bad.length === 0, detail: bad.length ? `${bad.length}/${blocks.length} 个镜头缺画面或提示词` : `${blocks.length} 个镜头都齐` };
  },
  vs_no_link: (b) => ({ ok: urls(b).length === 0, detail: `链接 ${urls(b).length} 个` }),
  vs_cta_end: (b, brief) => {
    const blocks = shotBlocks(b);
    if (!blocks.length) return { ok: false, detail: '没有镜头块' };
    const last = lower(blocks[blocks.length - 1].text);
    const words = ['cta', '关注', '评论', '点击', '试试', '了解', '私信', 'dm', 'follow', 'comment', 'demo', 'sign up', 'try'];
    const custom = brief && brief.cta ? lower(brief.cta).slice(0, 10) : '';
    const ok = words.some((w) => last.includes(w)) || (!!custom && last.includes(custom));
    return { ok, detail: ok ? '结尾是 CTA / 落版' : '最后一个镜头没有 CTA' };
  }
};

/** 对某个渠道的正文跑全部规则 */
function runChecks(channelId, body, brief, options = {}) {
  const ch = C.channelById(channelId);
  if (!ch) return { results: [], score: 0, mustFail: 0 };
  const results = ch.rules.map((rule) => {
    const fn = CHECKS[rule.id];
    let r = { ok: true, detail: '未实现' };
    try {
      if (fn) r = fn(body || '', brief || {});
    } catch (e) {
      r = { ok: false, detail: 'check error: ' + e.message };
    }
    return { id: rule.id, text: rule.text, severity: rule.severity, cite: rule.cite, ...r };
  });

  const banned = options.bannedWords && options.bannedWords.length ? options.bannedWords : C.DEFAULT_BANNED;
  const hitBanned = hasAny(body, banned);
  results.push({
    id: 'global_banned',
    text: '不得出现品牌禁用词。',
    severity: 'must',
    cite: 'data/settings.json → bannedWords',
    ok: hitBanned.length === 0,
    detail: hitBanned.length ? `命中：${hitBanned.join(', ')}` : '无'
  });

  const mustFail = results.filter((r) => r.severity === 'must' && !r.ok).length;
  const pass = results.filter((r) => r.ok).length;
  return { results, score: Math.round((pass / results.length) * 100), mustFail };
}

module.exports = { runChecks, CHECKS };
