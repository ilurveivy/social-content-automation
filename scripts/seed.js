'use strict';
/**
 * 种子数据：两个 campaign，各 7 个资产（含视频分镜包），带排期。
 * 用法：node scripts/seed.js [baseUrl]
 */
const BASE = process.argv[2] || 'http://127.0.0.1:4319';

async function api(p, opts) {
  const res = await fetch(BASE + p, {
    headers: { 'content-type': 'application/json' },
    ...opts,
    body: opts && opts.body ? JSON.stringify(opts.body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${p} → ${res.status} ${data.error || ''}`);
  return data;
}

const pad = (n) => String(n).padStart(2, '0');
function dayOffset(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const PLANS = [
  {
    name: '一份素材，6 个渠道，15 分钟跑完',
    objective: '让做内容的人相信：换渠道不是换产品，改结构才是',
    audience: '出海 SaaS 的增长负责人 / build in public 的独立创始人',
    language: 'zh',
    tone: '直接、具体、不装',
    cta: '回复一句「怎么做」，我把模板发你',
    productName: 'eSheep.ai',
    fromName: 'Aiden',
    sellingPoints: [
      '同一卖点换渠道，不是换产品：改的是结构，不是核心主张',
      '每个渠道自带规则检查：Reddit 不能硬广、TikTok 前 3 秒必须有钩子、X 只留一个钩子',
      '每次修改都是一个新版本，随时能 diff、能回到上一版'
    ],
    rawMaterial:
      '我们每天要在六个地方说同一件事：YouTube 讲长的，TikTok 讲短的，X 讲一句，Reddit 要像个人在讨论，冷邮件只有一个收件人，落地页首屏只有三秒。\n' +
      '以前的做法是复制粘贴再改，结果六个版本互相矛盾，改到第三版就忘了第一版想说什么。\n' +
      '后来把"主张"和"渠道表达"分开：主张只有一份，渠道表达各自生成，每条渠道有自己的硬规则。',
    assets: [
      { channel: 'youtube_script', title: '主稿（长视频）', scheduledAt: dayOffset(-2) },
      { channel: 'video_shotlist', title: '短视频分镜', scheduledAt: dayOffset(0) },
      { channel: 'tiktok_script', title: '短视频口播', scheduledAt: dayOffset(0) },
      { channel: 'x_post', title: '首发帖', scheduledAt: dayOffset(1) },
      { channel: 'reddit_post', title: 'r/SaaS 软帖', scheduledAt: dayOffset(2) },
      { channel: 'cold_email', title: '冷启动邮件', scheduledAt: dayOffset(4) },
      { channel: 'landing_hero', title: '落地页首屏', scheduledAt: dayOffset(6) }
    ]
  },
  {
    name: 'Why we stopped rewriting the same pitch six times',
    objective: 'Convince solo founders that channel adaptation is a structure problem, not a writing problem',
    audience: 'SaaS founders doing build-in-public',
    language: 'en',
    tone: 'Direct, concrete, no hype',
    cta: 'Reply "how" and I will send the template',
    productName: 'eSheep.ai',
    fromName: 'Aiden',
    sellingPoints: [
      'Same claim, different channel: you change the structure, not the product story',
      'Every channel ships with its own hard rules (no links in the first Reddit paragraph, no pitch in cold email)',
      'Every edit is a version you can diff and roll back'
    ],
    rawMaterial:
      'We had to say the same thing in six places every day. Copy-paste-edit turned into six contradictory drafts, and by v3 nobody remembered what v1 was about.\n' +
      'Splitting "the claim" from "the channel expression" fixed it: one claim lives once, each channel gets its own draft and its own hard rules.',
    assets: [
      { channel: 'youtube_script', title: 'Main script', scheduledAt: dayOffset(-1) },
      { channel: 'video_shotlist', title: 'Short-form shotlist', scheduledAt: dayOffset(1) },
      { channel: 'tiktok_script', title: 'TikTok talking head', scheduledAt: dayOffset(1) },
      { channel: 'x_post', title: 'Launch post', scheduledAt: dayOffset(3) },
      { channel: 'reddit_post', title: 'r/SaaS post', scheduledAt: dayOffset(5) },
      { channel: 'cold_email', title: 'Cold email', scheduledAt: dayOffset(7) },
      { channel: 'landing_hero', title: 'Landing hero', scheduledAt: dayOffset(9) }
    ]
  }
];

(async () => {
  const st = await api('/api/state');
  if (st.campaigns.length) {
    console.log(`已有 ${st.campaigns.length} 个 campaign。要重灌请先删掉 data/campaigns.json 再启动服务。`);
    return;
  }
  for (const plan of PLANS) {
    const { assets, ...fields } = plan;
    const r = await api('/api/campaigns', { method: 'POST', body: fields });
    const cp = r.campaign;
    for (const a of assets) {
      await api(`/api/campaigns/${cp.id}/assets`, { method: 'POST', body: a });
    }
    const gen = await api(`/api/campaigns/${cp.id}/generate`, { method: 'POST', body: {} });
    const min = Math.min(...gen.results.map((x) => x.score));
    console.log(`✔ ${plan.name}  →  ${cp.id} · ${gen.results.length} 个资产 · 最低分 ${min}%`);
  }
  const after = await api('/api/state');
  console.log(`\n完成：${after.campaigns.length} 个 campaign / ${after.calendar.length} 个资产，打开 ${BASE}`);
})().catch((e) => { console.error('种子失败：' + e.message); process.exit(1); });
