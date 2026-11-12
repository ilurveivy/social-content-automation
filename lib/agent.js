'use strict';
const { brief: knowledgeBrief } = require('./knowledge');
/**
 * 营销智能体：把"公司知识 + 营销数据 + 工具数据"拼成上下文，让模型给出**可执行动作**。
 *
 * 关键设计：模型不直接写数据库，只输出一个 actions 数组，由服务端校验后执行。
 *   - 好处 1：模型不能编造 campaignId 就把东西写坏
 *   - 好处 2：每个动作的执行结果可以回传给界面（"已创建 1 个 campaign / 4 个资产"）
 *   - 好处 3：离线模板模式也能产出同样的动作，demo 不需要 API key
 */

const ACTIONS = {
  create_campaign: {
    label: '创建 campaign',
    fields: ['name', 'objective', 'audience', 'language', 'tone', 'cta', 'sellingPoints', 'rawMaterial'],
    doc: '{"type":"create_campaign","name":"...","objective":"...","audience":"...","language":"zh","cta":"...","sellingPoints":["...","..."],"rawMaterial":"..."}'
  },
  write_asset: {
    label: '写入资产正文',
    fields: ['campaignId', 'channel', 'title', 'body'],
    doc: '{"type":"write_asset","campaignId":"cp_xxx","channel":"x_post","title":"首发帖","body":"正文…"}'
  },
  schedule_asset: {
    label: '安排排期',
    fields: ['campaignId', 'channel', 'scheduledAt'],
    doc: '{"type":"schedule_asset","campaignId":"cp_xxx","channel":"x_post","scheduledAt":"2026-11-20"}'
  },
  update_knowledge: {
    label: '补充公司知识',
    fields: ['field', 'value'],
    doc: '{"type":"update_knowledge","field":"competitors","value":"竞品A、竞品B"}'
  }
};

const SYSTEM_PROMPT = `你是一个营销智能体，嵌在用户自己的内容工作台里。
你能读到的资料：公司知识库、知识文件、已接入工具的数据、当前 campaign 与排期。
你的产出必须同时包含两部分：

1) 自然语言回答（简洁、具体、可执行，用用户的语言）。
2) 一个 JSON 代码块，形如：
\`\`\`json
{"actions":[ ... ]}
\`\`\`

可用动作（不要发明新类型）：
- ${ACTIONS.create_campaign.doc}
- ${ACTIONS.write_asset.doc}
- ${ACTIONS.schedule_asset.doc}
- ${ACTIONS.update_knowledge.doc}

规则：
- 不确定就不要创建动作，先用自然语言向用户要信息。
- 不要编造数据、客户名、效果数字；缺证据就写"待补充"。
- 不要约通话/会议。
- 动作最多 6 个；write_asset 的 body 必须是完整成稿，不是提纲。
- 如果用户只是提问，actions 可以是空数组。`;

/** 把资料拼成上下文文本（有长度上限，避免把上下文撑爆） */
function buildContext({ knowledge, campaigns, calendar, files, today }) {
  const k = knowledge || {};
  // 统一从 brief() 取：新字段（description/customInstructions/brandVoices…）和老字段
  // 在知识库里已经归一，这里不需要再判断"是新的还是老的"
  const b = knowledgeBrief(k.company);
  const lines = [];

  lines.push(`# 今天\n${today || new Date().toISOString().slice(0, 10)}`);

  lines.push('\n# 公司知识');
  const pick = (label, v) => {
    const val = Array.isArray(v) ? v.filter(Boolean).join('；') : String(v || '').trim();
    if (val) lines.push(`${label}：${val.slice(0, 900)}`);
  };
  pick('公司/产品名', b.name);
  pick('官网', b.website);
  pick('公司介绍', b.description);
  pick('目标受众', b.audiences);
  pick('竞品', b.competitors);
  pick('内容支柱', b.contentPillars);
  pick('语言', b.languages);
  pick('品牌语气', b.voice);
  pick('写作风格', b.writingStyle);
  pick('可引用的事实/证据 / 自定义说明', b.facts);

  if (k.gsc && k.gsc.connected) {
    lines.push(`\n# Google Search Console\n已绑定站点：${k.gsc.site || '(未填)'}${k.gsc.note ? '\n备注：' + k.gsc.note : ''}`);
  } else {
    lines.push('\n# Google Search Console\n未绑定（无法读取真实搜索数据，涉及 SEO 的机会点要标注"待数据验证"）');
  }

  const tools = (k.tools || []).filter((t) => t.connected && (t.data || '').trim());
  if (tools.length) {
    lines.push('\n# 已接入工具的数据');
    tools.forEach((t) => {
      lines.push(`## ${t.name}\n${String(t.data).slice(0, 1200)}`);
    });
  } else {
    lines.push('\n# 已接入工具的数据\n（无）');
  }

  const fileList = (k.files || []).slice(0, 12);
  if (fileList.length && files) {
    lines.push('\n# 知识文件');
    lines.push(fileList.map((f) => `- ${f.name}（${f.chars} 字）`).join('\n'));
    const excerpts = fileList
      .map((f) => {
        const body = files[f.id];
        if (!body) return '';
        return `## ${f.name}\n${String(body).slice(0, 1500)}`;
      })
      .filter(Boolean);
    if (excerpts.length) lines.push(excerpts.join('\n\n'));
  }

  const cps = (campaigns || []).slice(0, 8);
  lines.push('\n# 现有 campaign');
  if (!cps.length) lines.push('（没有）');
  else {
    cps.forEach((cp) => {
      const assets = (cp.assets || []).map((a) => `${a.channel}${a.scheduledAt ? '@' + a.scheduledAt : ''}`).join(', ');
      lines.push(`- ${cp.id}｜${cp.name}｜资产：${assets || '无'}`);
    });
  }

  const upcoming = (calendar || []).filter((r) => r.scheduledAt).slice(0, 12);
  lines.push('\n# 排期（最近）');
  if (!upcoming.length) lines.push('（还没排期）');
  else upcoming.forEach((r) => lines.push(`- ${r.scheduledAt}｜${r.channelLabel}｜${r.title || '(未命名)'}｜${r.status}`));

  return lines.join('\n');
}

/** 从模型回复里抠出 actions 数组（先找 ```json 代码块，再退回找裸 JSON） */
function parseActions(text) {
  const src = String(text || '');
  const blocks = [...src.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((m) => m[1].trim());
  const candidates = blocks.length ? blocks : [];
  if (!candidates.length) {
    const start = src.indexOf('{');
    if (start >= 0) candidates.push(src.slice(start));
  }
  for (const c of candidates) {
    try {
      const j = JSON.parse(c);
      if (j && Array.isArray(j.actions)) return sanitizeActions(j.actions);
    } catch (_) { /* 继续试下一个 */ }
  }
  // 代码块可能只含 actions 数组
  for (const c of candidates) {
    try {
      const j = JSON.parse(c);
      if (Array.isArray(j)) return sanitizeActions(j);
    } catch (_) { /* ignore */ }
  }
  return [];
}

/** 这几个字段必须是数组：模型经常给字符串，直接丢会静默丢数据 */
const LIST_FIELDS = new Set(['sellingPoints']);

function sanitizeActions(list) {
  return (list || [])
    .filter((a) => a && typeof a === 'object' && ACTIONS[a.type])
    .slice(0, 6)
    .map((a) => {
      const out = { type: a.type };
      for (const f of ACTIONS[a.type].fields) {
        if (a[f] === undefined || a[f] === null) continue;
        if (LIST_FIELDS.has(f)) {
          const arr = Array.isArray(a[f]) ? a[f] : String(a[f]).split(/[\n、；;]+/);
          out[f] = arr.map((x) => String(x).trim()).filter(Boolean).slice(0, 12);
        } else {
          out[f] = Array.isArray(a[f]) ? a[f].map((x) => String(x)).slice(0, 12) : String(a[f]).slice(0, 4000);
        }
      }
      return out;
    });
}

/** 去掉回复里的 JSON 代码块，只留给人看的部分 */
function stripActions(text) {
  return String(text || '')
    .replace(/```(?:json)?\s*[\s\S]*?```/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function describeAction(a) {
  switch (a.type) {
    case 'create_campaign': return `创建 campaign「${a.name || '(未命名)'}」`;
    case 'write_asset': return `写入 ${a.channel || '资产'} 正文（${(a.body || '').length} 字符）`;
    case 'schedule_asset': return `${a.channel || '资产'} 排到 ${a.scheduledAt}`;
    case 'update_knowledge': return `补充公司知识：${a.field}`;
    default: return a.type;
  }
}

/** 离线模板：没有接模型时也能给出一个真实可执行的动作，而不是空聊 */
function planTemplate({ knowledge, campaigns }) {
  const b = knowledgeBrief(knowledge && knowledge.company);
  const hasProducts = !!(b.name || b.description);
  const existing = (campaigns || []).length;

  const actions = [];
  if (hasProducts && existing < 3) {
    const name = `${b.name || '推广'} · 本月主张`;
    actions.push({
      type: 'create_campaign',
      name: name.slice(0, 60),
      objective: (b.description.split('\n')[0] || '让目标受众留下印象').slice(0, 200),
      audience: b.audiences.join('；').slice(0, 200),
      language: 'zh',
      cta: '（在这里写一个低门槛的行动号召）',
      sellingPoints: (b.sellingPoints || []).slice(0, 3),
      rawMaterial: [b.description, b.facts].filter(Boolean).join('\n').slice(0, 2000)
    });
  }

  const reply = [
    '当前是**离线模板**模式（没有接入模型），我只能给骨架，不会编造内容。',
    '',
    '**我读到的资料**',
    `- 公司/产品：${b.name || '（未填）'}`,
    `- 公司介绍：${(b.description.split('\n')[0] || '（未填）').slice(0, 80)}`,
    `- 受众：${b.audiences.join('；') || '（未填）'}`,
    `- 竞品：${b.competitors.join('；') || '（未填）'}`,
    `- 品牌语气：${b.voice || '（未填）'}`,
    `- 知识文件：${((knowledge && knowledge.files) || []).length} 个`,
    '',
    hasProducts
      ? `**建议的下一步**：先补 1 个 campaign（我已经把能读到的信息填进去了），然后在 Content 里按渠道生成草稿、排期。`
      : '**建议的下一步**：先在左边 1. Company knowledge 里填公司名和一句话定位 —— 不然我写什么都是空的。',
    '',
    '接入模型后（顶部 banner），我会用你的真实资料写完整草稿并直接存回 Content。'
  ].join('\n');

  return { reply, actions };
}

module.exports = { ACTIONS, SYSTEM_PROMPT, buildContext, parseActions, stripActions, describeAction, planTemplate, sanitizeActions };
