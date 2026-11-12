'use strict';
/**
 * Skills = 可复用的标准化工作流（给 agent 的 SOP）。
 *
 * 用法：在对话里 @技能名，服务端会把这条技能的步骤拼进 system prompt，
 * 于是同一个流程不用每次重写一大段提示词。技能只是"提示词模板 + 步骤"，
 * 不执行代码、不联网 —— 真正的执行仍然走 agent 的动作协议。
 */
const crypto = require('crypto');
const store = require('./store');

const FILE = 'skills.json';
const MAX_STEPS = 12;
const MAX_SKILLS = 40;

const BUILTIN = [
  {
    id: 'sk_competitor_gap',
    name: '竞品内容缺口分析',
    description: '对着 3–5 个竞品找他们没讲、我们该讲的题。',
    tags: ['调研', '竞品'],
    output: '5 个选题 + 每个的切入角度 + 依据',
    steps: [
      '从公司知识里取竞品名单与我们的内容支柱；竞品不足 3 个就直接说明缺什么，不要编。',
      '逐个竞品列出它已经在讲的 3 个主题（只写你能从资料里看到的，没有资料的标注"待验证"）。',
      '把竞品主题与我们的内容支柱做交叉，找出"支柱有、竞品没讲"和"竞品讲了、我们没讲"两类。',
      '每类各给 2–3 个候选选题，写清目标读者与搜索意图。',
      '按"能不能用我们已有的证据支撑"排序，去掉没有依据的。',
      '输出 5 个选题，每个给：标题、切入角度、支撑证据、建议渠道。'
    ]
  },
  {
    id: 'sk_month_plan',
    name: '月度内容计划',
    description: '一个主张 → 4–6 条内容 → 排进日历。',
    tags: ['计划'],
    output: '一个 campaign + 若干资产 + 排期',
    steps: [
      '确认本月的核心主张（没有就问用户，不要自己编）。',
      '映射到 2–3 个内容支柱，每个支柱给 1–2 个选题。',
      '每个选题指定主渠道（文章 / 社交 / 邮件 / 视频），并说明为什么是这个渠道。',
      '把资产按 4 周铺开，注意同一周不要超过 2 件，留出复用（长文 → 社交）的顺序。',
      '用动作协议真的写进 Content：先 create_campaign，再 write_asset，最后 schedule_asset。',
      '最后用一句话说明这个月"希望读者看完做什么"。'
    ]
  },
  {
    id: 'sk_fix_striking',
    name: 'GSC 机会修复',
    description: '把"排在第 2 页"的页面推到首页。',
    tags: ['SEO', '审计'],
    output: '每条的改法 + 优先级',
    steps: [
      '读 Content audit 里已导入的 GSC 数据；没有数据就停下来让用户先导入，不要猜排名。',
      '只看 position 11–20 且 impressions ≥ 50 的查询，这是最值得动的区间。',
      '对每一条判断意图：是标题没写对、还是内容没答全、还是没有对应页面。',
      '给具体改法：新的 title（≤60 字符）、首段要点、要补的小节。',
      '按"改一改就能进首页"的可能性排序，最多给 5 条。',
      '说明改完多久能看出来（通常 2–4 周），不要承诺效果。'
    ]
  },
  {
    id: 'sk_repurpose6',
    name: '长文改六渠道',
    description: '一篇长文 → 六个渠道的成稿，并自检规则。',
    tags: ['改写', '分发'],
    output: '六份草稿 + 规则分',
    steps: [
      '取这篇长文的核心主张（一句话）和 3 条支撑论据。',
      '按渠道长度与语感分别改写：YouTube 脚本、TikTok 口播、X 帖子、Reddit 软帖、冷邮件、落地页首屏。',
      '每个渠道都要符合它自己的规则（长度、钩子位置、CTA 数量、能不能放链接）。',
      '不要在第一句自我介绍；不要编造数字和客户。',
      '用动作协议 write_asset 写进 Content（同属一个 campaign）。',
      '最后列出每个渠道最容易踩的那条规则，方便人工复核。'
    ]
  }
];

function emptyDb() {
  return { version: 1, skills: BUILTIN.map((s) => ({ ...s, steps: [...s.steps], tags: [...s.tags], builtin: true, createdAt: null, updatedAt: null })) };
}

function load() {
  const j = store.readJson(FILE, null);
  if (!j || !Array.isArray(j.skills)) return emptyDb();
  const db = { version: 1, skills: [] };
  const seen = new Set();
  for (const s of j.skills) {
    if (!s || !s.id || !String(s.name || '').trim()) continue;
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    db.skills.push({
      id: String(s.id),
      name: String(s.name).slice(0, 60),
      description: String(s.description || '').slice(0, 300),
      steps: (Array.isArray(s.steps) ? s.steps : []).map((x) => String(x).slice(0, 400)).filter(Boolean).slice(0, MAX_STEPS),
      tags: (Array.isArray(s.tags) ? s.tags : []).map((x) => String(x).slice(0, 20)).filter(Boolean).slice(0, 6),
      output: String(s.output || '').slice(0, 200),
      builtin: !!s.builtin,
      createdAt: s.createdAt || null,
      updatedAt: s.updatedAt || null
    });
  }
  // 内置技能被删过就补回来，保证"技能库"始终有东西可用
  for (const b of BUILTIN) {
    if (!db.skills.some((s) => s.id === b.id)) {
      db.skills.push({ ...b, steps: [...b.steps], tags: [...b.tags], builtin: true, createdAt: null, updatedAt: null });
    }
  }
  return db;
}

function save(db) {
  return store.writeJson(FILE, { version: 1, skills: db.skills });
}

function list(db) {
  const d = db || load();
  return d.skills.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    steps: s.steps,
    stepCount: s.steps.length,
    tags: s.tags,
    output: s.output,
    builtin: s.builtin,
    updatedAt: s.updatedAt
  }));
}

function get(db, id) {
  return db.skills.find((s) => s.id === id) || null;
}

function normalize(body, base) {
  const name = String((body && body.name) || (base && base.name) || '').trim();
  if (!name) throw Object.assign(new Error('技能名不能为空'), { status: 400 });
  // 局部更新（例如只改 description）时，步骤沿用原来的，不要当成"没写步骤"
  const src = body && body.steps !== undefined ? body.steps : (base && base.steps) || [];
  const steps = (Array.isArray(src) ? src : String(src).split('\n'))
    .map((s) => String(s).replace(/^\s*\d+[.、)]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, MAX_STEPS);
  if (!steps.length) throw Object.assign(new Error('至少要写一步'), { status: 400 });
  return {
    name: name.slice(0, 60),
    description: String((body && body.description) || (base && base.description) || '').slice(0, 300),
    steps,
    tags: (Array.isArray(body && body.tags) ? body.tags : String((body && body.tags) || '').split(/[,，\s]+/))
      .map((s) => String(s).trim()).filter(Boolean).slice(0, 6),
    output: String((body && body.output) || (base && base.output) || '').slice(0, 200)
  };
}

function create(db, body) {
  if (db.skills.length >= MAX_SKILLS) throw Object.assign(new Error(`技能最多 ${MAX_SKILLS} 个`), { status: 400 });
  const v = normalize(body, null);
  const now = new Date().toISOString();
  const rec = { id: 'sk_' + crypto.randomBytes(5).toString('hex'), ...v, builtin: false, createdAt: now, updatedAt: now };
  db.skills.push(rec);
  return rec;
}

function update(db, id, body) {
  const s = get(db, id);
  if (!s) throw Object.assign(new Error('技能不存在'), { status: 404 });
  Object.assign(s, normalize(body, s));
  s.updatedAt = new Date().toISOString();
  return s;
}

function remove(db, id) {
  const before = db.skills.length;
  db.skills = db.skills.filter((s) => s.id !== id);
  if (db.skills.length === before) return false;
  // 内置技能被删 → 立刻补回，避免技能库被清空
  const b = BUILTIN.find((x) => x.id === id);
  if (b) db.skills.push({ ...b, steps: [...b.steps], tags: [...b.tags], builtin: true, createdAt: null, updatedAt: null });
  return true;
}

/** 从一句话里找 @技能名（也接受 @id） */
function matchSkill(text, db) {
  const d = db || load();
  const m = String(text || '').match(/@([^\s@]{1,40})/);
  if (!m) return null;
  const key = m[1].toLowerCase();
  return d.skills.find((s) => s.name.toLowerCase() === key || s.id.toLowerCase() === key) ||
    d.skills.find((s) => s.name.toLowerCase().startsWith(key)) || null;
}

/** 拼进 system prompt 的那一段 */
function instruction(skill) {
  if (!skill) return '';
  const steps = skill.steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
  return [
    `【技能：${skill.name}】`,
    skill.description ? skill.description : '',
    '按下面这套固定步骤执行，不要跳步：',
    steps,
    skill.output ? `输出：${skill.output}` : '',
    '资料不足的地方要明说缺什么，不要编。'
  ].filter(Boolean).join('\n');
}

module.exports = { load, save, list, get, create, update, remove, matchSkill, instruction, BUILTIN, MAX_SKILLS };
