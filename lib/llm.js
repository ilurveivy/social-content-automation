'use strict';
/**
 * 生成层。
 *
 * 三种模式（settings.provider.mode）：
 *  - "gateway"  : Anthropic Messages 兼容网关（本机 ~/.claude/settings.json 里那套）
 *  - "openai"   : OpenAI 兼容 /v1/chat/completions
 *  - "template" : 离线模板。不联网、不花钱，产出可编辑的骨架。
 *
 * 设计取舍：连不上就降级成 template，并且把降级原因如实带回去给界面显示，
 * 不要假装生成成功。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const C = require('./channels');

function readClaudeEnv() {
  const p = path.join(os.homedir(), '.claude', 'settings.json');
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    return j.env || {};
  } catch (_) {
    return {};
  }
}

/** 解析出实际要用的凭据：settings 优先，其次环境变量，最后 ~/.claude */
function resolveProvider(settings, override) {
  const p = { ...(settings.provider || {}), ...(override || {}) };
  const claudeEnv = readClaudeEnv();
  const token =
    p.token ||
    process.env.ANTHROPIC_AUTH_TOKEN ||
    claudeEnv.ANTHROPIC_AUTH_TOKEN ||
    process.env.OPENAI_API_KEY ||
    '';
  const baseUrl =
    p.baseUrl ||
    process.env.ANTHROPIC_BASE_URL ||
    claudeEnv.ANTHROPIC_BASE_URL ||
    '';
  const model =
    p.model ||
    claudeEnv.ANTHROPIC_MODEL ||
    process.env.ANTHROPIC_MODEL ||
    'claude-sonnet-4';
  const mode = p.mode || (token && baseUrl ? 'gateway' : 'template');
  return { mode, token, baseUrl: String(baseUrl).replace(/\/+$/, ''), model, timeoutMs: p.timeoutMs || 60000 };
}

async function callGateway({ baseUrl, token, model, timeoutMs }, system, user) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': token,
        authorization: `Bearer ${token}`,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model,
        max_tokens: 2000,
        temperature: 0.7,
        system,
        messages: [{ role: 'user', content: user }]
      })
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`gateway ${res.status}: ${text.slice(0, 300)}`);
    const j = JSON.parse(text);
    const out = (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    if (!out) throw new Error('gateway 返回空内容');
    return out;
  } finally {
    clearTimeout(timer);
  }
}

async function callOpenAI({ baseUrl, token, model, timeoutMs }, system, user) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        model,
        temperature: 0.7,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }]
      })
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`openai ${res.status}: ${text.slice(0, 300)}`);
    const j = JSON.parse(text);
    const out = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content || '').trim();
    if (!out) throw new Error('openai 返回空内容');
    return out;
  } finally {
    clearTimeout(timer);
  }
}

/** 取第一个短句：按冒号/破折号/逗号切，避免把整条卖点当标题用 */
function shortClause(s, n) {
  const raw = String(s || '').trim();
  const head = (raw.split(/[:：—–]|[,，;；]/)[0] || raw).trim() || raw;
  return clamp(head, n);
}

/** 按字符截断，尽量不切在半个单词上 */
function clamp(s, n) {
  const chars = [...String(s || '').trim()];
  if (chars.length <= n) return chars.join('');
  let cut = chars.slice(0, Math.max(1, n - 1)).join('');
  if (/[A-Za-z]$/.test(cut)) cut = cut.replace(/[A-Za-z']+$/, '').trim();
  return cut.replace(/[\s,，、:：;；]+$/, '') + '…';
}

/** 离线模板：生成"可以直接开始改"的骨架，而不是空串 */
function templateDraft(channelId, brief, variant) {
  const pts = (brief.sellingPoints || []).filter(Boolean);
  const p1 = pts[0] || brief.title || '（在这里写核心卖点）';
  const p2 = pts[1] || '第二支撑点';
  const p3 = pts[2] || '第三支撑点';
  const aud = brief.audience || '（目标人群）';
  const cta = brief.cta || '（行动号召）';
  const link = (brief.links && brief.links.product) || '';
  const tag = variant === 'A' ? '' : `\n\n[变体 ${variant}：换一个切入角度重写上面这一段]`;

  switch (channelId) {
    case 'youtube_script':
      return `00:00 ${p1}
00:20 这件事为什么现在值得说（给 ${aud}）
01:10 ${p2}
03:00 ${p3}
04:30 一个具体的、可复现的例子：把过程拆成三步说清楚，每一步都给一个能立刻照做的动作
06:00 常见误解 / 反面情况：先承认对方可能是对的，再说明你的前提条件是什么
07:00 收尾：一句话复述结论，然后只留一个请求
07:30 ${cta}${link ? '\n（描述区放链接：' + link + '）' : ''}

[口播提示]
- 前两行必须能独立成立，不要在开头说"大家好、我是谁、欢迎回到我的频道"。
- 全文按口语写，句子短，每句不超过 25 个字。
- 每个时间点写成一个完整段落，方便直接进提词器或分镜表。
- 结尾只留一个 CTA，不要同时要订阅、点赞、评论、点链接。${tag}`;
    case 'tiktok_script':
      // 短视频只讲一个点：模板里也不要塞第二条卖点，否则 tt_one_point 会真实地报错
      return `0-3s：${p1} —— 但大多数人搞反了。
3-8s：我用 ${aud} 的实际情况试过，差别比想象中大。
8-20s：具体到这一步就够了，再往下就是过度优化。
20-25s：${cta}（不要放外链）${tag}`;
    case 'x_post': {
      // 首行必须能独立成立且 ≤60 字符，所以用短句而不是整条卖点
      const hook = shortClause(p1, 55);
      const mid = clamp(p2, 90 - hook.length > 40 ? 90 : 60);
      const parts = [hook, mid, cta ? clamp(cta, 60) : ''].filter(Boolean);
      let out = '';
      for (const part of parts) {
        const next = out ? out + '\n\n' + part : part;
        if ([...next].length > 270) break;
        out = next;
      }
      return clamp(out, 270) + tag;
    }
    case 'reddit_post':
      return `我最近在折腾${brief.title || '这个问题'}，踩了几个坑，写下来给同样情况的人。

背景：${p1}。我不是来推东西的，是因为搜了一圈没找到能直接用的答案，只能自己试。

具体做法：${p2}。

再往下是${p3}，这一步最容易翻车，因为大部分人卡在"看起来可以了"就停了。

我自己的判断标准是：能不能在下一个人接手时，只看文档就跑通一遍。如果不能，说明还没做完。

有一个我还没想明白的地方：如果预算只有一半，你会先砍哪一步？我现在的选择可能不是最优。

（披露：我在做${brief.productName || '相关工具'}，所以视角可能有偏差，欢迎拍。）${tag}`;
    case 'cold_email':
      return `主题：${(brief.subject || brief.title || '').slice(0, 55)}

Hi ——

我看到你在做 ${aud} 这块，${p1}。

${p2}

我先不发长文，只想确认一件事：${cta || '这个方向对你有用吗？'}

如果不对，直接回一句"不用了"就行，我不会再追。

—— ${brief.fromName || 'Aiden'}${tag}`;
    case 'landing_hero': {
      const h1 = shortClause(p1, 56);
      const sub = clamp(`给 ${aud}：${shortClause(p2, 88)}`, 138);
      return `${h1}

${sub}

→ ${cta || '免费试用'}

[证据位：换成真实数字，例如"已跑过 1,200 次，平均省 6 小时/周"]${tag}`;
    }
    case 'video_shotlist': {
      // 分镜包的格式是"可被规则校验"的：镜头块 + 画面 + 提示词 + 总时长 + 结尾 CTA
      const shot = (n, from, to, visual, line, prompt) =>
        `【镜头 ${n} · ${from}–${to}s】\n画面：${visual}\n台词：${line}\n提示词：${prompt}`;
      return [
        shot(1, 0, 3, `${aud} 的桌面，屏幕上是来回复制粘贴的稿子`, p1, `特写，冷色调，手部动作，竖屏 9:16，浅景深`),
        shot(2, 3, 9, `同一份素材被摊成六个并列窗口，互相错位`, `同一个卖点，为什么要写六遍？`, `俯拍，六宫格布局，文字逐渐对齐，极简`),
        shot(3, 9, 18, `${p2} 的可视化：一进六出的漏斗`, `差别不在工具，在于你每次都从头想。`, `动态图形，蓝色渐变，等距视角，干净背景`),
        shot(4, 18, 30, `六个渠道各自亮起，旁边浮出各自的规则卡`, p3, `分屏动画，每个窗口带一个小勾，暖光点缀`),
        shot(5, 30, 36, `画面收回到一个人，点头`, cta || '想知道怎么做，评论区说一句', `中景，自然光，真实感，不要演`),
        '',
        `总时长：36 秒`
      ].join('\n\n') + tag;
    }
    default:
      return `${p1}\n\n${p2}\n\n${p3}`;
  }
}

/**
 * 生成一个渠道版本。
 * 返回 { body, source: 'gateway'|'openai'|'template', degraded?: string }
 */
async function generate(channelId, brief, settings, override) {
  const ch = C.channelById(channelId);
  if (!ch) throw new Error('未知渠道: ' + channelId);
  const provider = resolveProvider(settings, override);
  const { system, user } = C.buildPrompt(ch, brief);
  const variant = (override && override.variant) || 'A';

  if (provider.mode === 'template') {
    return { body: templateDraft(channelId, brief, variant), source: 'template' };
  }
  try {
    const fn = provider.mode === 'openai' ? callOpenAI : callGateway;
    const body = await fn(provider, system, user);
    return { body, source: provider.mode };
  } catch (e) {
    // 降级不静默：把原因带回去
    return {
      body: templateDraft(channelId, brief, variant),
      source: 'template',
      degraded: `${provider.mode} 调用失败，已降级为模板：${e.message}`
    };
  }
}

module.exports = { generate, templateDraft, resolveProvider, readClaudeEnv };
