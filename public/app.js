'use strict';

/* ================= 状态 ================= */
const S = {
  campaigns: [], details: {}, calendar: [], channels: [], assetTypes: [], settings: null,
  campaignId: null, assetId: null, view: 'assets', drafts: {},
  nav: 'dashboard', dashboard: null,
  calMonth: null, calManual: false
};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const key = () => S.campaignId + '|' + S.assetId;
const pad = (n) => String(n).padStart(2, '0');
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const ICONS = {
  youtube_script: '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="5" width="16" height="10" rx="3"/><path d="M8.5 8l3.5 2-3.5 2z" fill="currentColor" stroke="none"/></svg>',
  tiktok_script: '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 3v9.2a2.8 2.8 0 11-2.6-2.8"/><path d="M12 3c.4 2 1.8 3.2 4 3.4"/></svg>',
  video_shotlist: '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2.5" y="4" width="15" height="12" rx="2.5"/><path d="M2.5 8h15M6.5 4v4M13.5 4v4"/></svg>',
  x_post: '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 4l12 12M16 4L4 16"/></svg>',
  reddit_post: '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="10" cy="11.5" r="5.2"/><circle cx="7.9" cy="11" r=".9" fill="currentColor" stroke="none"/><circle cx="12.1" cy="11" r=".9" fill="currentColor" stroke="none"/><path d="M8.3 13.6c.9.7 2.5.7 3.4 0"/><path d="M10 6.3V3.4"/></svg>',
  cold_email: '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2.5" y="4.5" width="15" height="11" rx="2.5"/><path d="M3.5 6.5l6.5 4.6 6.5-4.6"/></svg>',
  landing_hero: '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2.5" y="3.5" width="15" height="13" rx="2.5"/><path d="M2.5 8h15"/><path d="M6 11.5h5"/></svg>'
};

function toast(msg, isErr) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast' + (isErr ? ' is-err' : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), isErr ? 6500 : 2400);
  t.classList.remove('hidden');
}

async function api(path, opts) {
  const res = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...opts,
    body: opts && opts.body ? JSON.stringify(opts.body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || res.status + ' ' + res.statusText);
  return data;
}

/* ================= 选择器 ================= */
const campaign = () => S.details[S.campaignId] || null;
const asset = () => {
  const cp = campaign();
  return (cp && cp.assets.find((a) => a.id === S.assetId)) || null;
};
const channelOf = (chId) => S.channels.find((c) => c.id === chId) || null;
const typeMeta = (id) => S.assetTypes.find((t) => t.id === id) || { id, short: id, label: id, hint: '' };
function currentVersion(a) {
  if (!a || !a.versions || !a.versions.length) return null;
  return a.versions.find((v) => v.v === a.current) || a.versions[a.versions.length - 1];
}

/* ================= 加载 ================= */
async function loadState(keep) {
  const st = await api('/api/state');
  S.campaigns = st.campaigns;
  S.details = st.campaignDetails;
  S.calendar = st.calendar;
  S.channels = st.channels;
  S.assetTypes = st.assetTypes;
  S.settings = st.settings;

  if (!keep) {
    if (!S.campaignId && S.campaigns.length) S.campaignId = S.campaigns[0].id;
  }
  if (S.campaignId && !S.details[S.campaignId]) S.campaignId = S.campaigns.length ? S.campaigns[0].id : null;
  const cp = campaign();
  if (cp) {
    const stillThere = cp.assets.some((a) => a.id === S.assetId);
    if (!stillThere) S.assetId = cp.assets.length ? cp.assets[0].id : null;
  } else {
    S.assetId = null;
  }
  if (!S.calMonth) {
    const d = new Date();
    S.calMonth = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  }
  renderMode();
  renderList();
  renderWorkspace();
  renderNav();
  if (S.nav === 'planning' && window.renderPlanning) window.renderPlanning();
}

function renderMode() {
  const p = S.settings.provider;
  const b = $('modeBadge');
  if (p.mode === 'template') {
    b.textContent = '离线模式';
    b.className = 'mode-chip';
    b.title = '离线模板：不联网、不花钱。右上角「接入模型」可以接真实模型。';
  } else {
    b.textContent = (p.mode === 'gateway' ? 'gateway' : 'openai') + (p.hasToken ? '' : ' · 无 token');
    b.className = 'mode-chip' + (p.hasToken ? ' on' : '');
    b.title = (p.model || '') + ' @ ' + (p.baseUrl || '');
  }
}

/* ================= 左栏：campaign ================= */
function renderList() {
  $('campaignCount').textContent = S.campaigns.length ? S.campaigns.length + ' 个' : '';
  const box = $('campaignList');
  if (!S.campaigns.length) {
    box.innerHTML = '<p class="muted small" style="padding:8px 4px">还没有 campaign</p>';
    return;
  }
  box.innerHTML = S.campaigns.map((c) => {
    const bits = [];
    if (c.assetCount) bits.push(`<span class="pill pill-neutral">${c.assetCount} 资产</span>`);
    if (c.approvedCount) bits.push(`<span class="pill pill-ok">${c.approvedCount} 已批准</span>`);
    if (c.mustFailCount) bits.push(`<span class="pill pill-bad">${c.mustFailCount} 处硬伤</span>`);
    const range = c.from ? `<span class="chip">${esc(c.from.slice(5))} → ${esc(c.to.slice(5))}</span>` : '';
    return `<div class="brief-item ${c.id === S.campaignId ? 'is-active' : ''}" data-id="${c.id}" role="button" tabindex="0">
      <div class="bi-title">${esc(c.name || '(未命名)')}</div>
      <div class="bi-meta">${bits.join('')}${range}</div>
    </div>`;
  }).join('');

  box.querySelectorAll('.brief-item').forEach((el) => {
    const go = () => {
      if (el.dataset.id === S.campaignId) return;
      S.campaignId = el.dataset.id;
      S.assetId = null; S.calManual = false;
      renderList(); renderWorkspace();
    };
    el.onclick = go;
    el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
  });
}

/* ================= 中栏 ================= */
function renderWorkspace() {
  const cp = campaign();
  $('emptyState').classList.toggle('hidden', !!cp);
  $('workspace').classList.toggle('hidden', !cp);
  if (!cp) return;

  $('fName').value = cp.name || '';
  $('fObjective').value = cp.objective || '';
  $('fAudience').value = cp.audience || '';
  $('fLanguage').value = cp.language || '';
  $('fTone').value = cp.tone || '';
  $('fCta').value = cp.cta || '';
  $('fProduct').value = cp.productName || '';
  $('fFrom').value = cp.fromName || '';
  $('fPoints').value = (cp.sellingPoints || []).join('\n');
  $('fRaw').value = cp.rawMaterial || '';

  $('docMeta').innerHTML = [
    cp.audience ? `<span class="chip">${esc(cp.audience)}</span>` : '',
    cp.language ? `<span class="chip">${esc(cp.language)}</span>` : '',
    cp.tone ? `<span class="chip">${esc(cp.tone)}</span>` : '',
    cp.objective ? `<span class="chip" title="${esc(cp.objective)}">目标 · ${esc(cp.objective).slice(0, 30)}</span>` : ''
  ].join('');

  const assets = cp.assets;
  const scheduled = assets.filter((a) => a.scheduledAt).length;
  $('assetSummary').textContent = `${assets.length} 个资产 · ${scheduled} 个已排期`;

  renderAssetBoard();
  renderEditor();
}

/* ---- 资产看板 ---- */
function renderAssetBoard() {
  const cp = campaign();
  const box = $('assetBoard');
  if (!cp.assets.length) {
    box.innerHTML = `<div class="card" style="padding:18px">
      <p class="muted small">这个 campaign 还没有资产。点右上「＋ 添加资产」选渠道和日期，或者「按渠道补齐并生成」一次补齐 7 个渠道。</p>
    </div>`;
    return;
  }
  box.innerHTML = S.assetTypes.map((t) => {
    const list = cp.assets.filter((a) => (a.type || 'article') === t.id);
    if (!list.length) return '';
    const chips = list.map((a) => {
      const cur = currentVersion(a);
      const ch = channelOf(a.channel) || { labelZh: a.channel };
      const flag = !cur ? '' : cur.checks && cur.checks.mustFail ? 'bad' : cur.checks && cur.checks.score >= 80 ? 'ok' : 'warn';
      const sub = [a.scheduledAt ? a.scheduledAt.slice(5) : '未排期', cur ? 'v' + cur.v : '空', cur && cur.checks ? cur.checks.score + '%' : '—'].join(' · ');
      return `<button class="asset-chip ${a.id === S.assetId ? 'is-active' : ''} ${cur ? '' : 'is-empty'}" data-aid="${a.id}">
        <span class="ac-icon">${ICONS[a.channel] || ''}</span>
        <span class="ac-main">
          <span class="ac-name">${esc(a.title || ch.labelZh)}</span>
          <span class="ac-sub">${esc(sub)}</span>
        </span>
        <span class="ac-flag ${flag}"></span>
      </button>`;
    }).join('');
    return `<div class="asset-group">
      <div class="asset-group-head"><span>${esc(t.label)}</span><span class="muted">${list.length}</span></div>
      <div class="asset-chips">${chips}</div>
    </div>`;
  }).join('');

  box.querySelectorAll('.asset-chip').forEach((el) => {
    el.onclick = () => {
      if (el.dataset.aid === S.assetId) return;
      S.assetId = el.dataset.aid;
      renderAssetBoard(); renderEditor();
    };
  });
}

/* ---- 编辑器 ---- */
function renderEditor() {
  const a = asset();
  const els = ['chTitle', 'chBlurb', 'assetTypeTag', 'editor', 'fAssetTitle', 'fScheduled', 'variantSel', 'btnGen', 'btnSave', 'btnSaveAsset', 'btnDeleteAsset'];
  if (!a) {
    $('chTitle').textContent = '未选择资产';
    $('chBlurb').textContent = '先在上面选一个资产，或点「＋ 添加资产」。';
    $('assetTypeTag').className = 'type-tag';
    $('assetTypeTag').textContent = '—';
    $('editor').value = '';
    $('editor').disabled = true;
    $('fAssetTitle').value = '';
    $('fScheduled').value = '';
    els.forEach((id) => { const el = $(id); if (el && el.tagName === 'BUTTON') el.disabled = true; });
    updateFoot();
    renderChecks(null);
    renderVersions();
    renderStatus();
    $('diffView').textContent = '没有资产可对比。';
    return;
  }
  els.forEach((id) => { const el = $(id); if (el && el.tagName === 'BUTTON') el.disabled = false; });
  $('editor').disabled = false;

  const ch = channelOf(a.channel) || { labelZh: a.channel, blurb: '' };
  const t = typeMeta(a.type);
  $('chTitle').textContent = ch.labelZh;
  $('chBlurb').textContent = ch.blurb || '';
  $('assetTypeTag').className = 'type-tag type-' + (a.type || 'article');
  $('assetTypeTag').textContent = t.short;
  $('fAssetTitle').value = a.title || '';
  $('fScheduled').value = a.scheduledAt || '';

  const draft = S.drafts[key()];
  const cur = currentVersion(a);
  $('editor').value = draft !== undefined ? draft : cur ? cur.body : '';
  $('variantSel').value = (cur && cur.variant) || 'A';
  $('dirtyFlag').classList.toggle('hidden', draft === undefined);
  updateFoot();
  renderChecks(draft === undefined && cur ? cur.checks : null);
  renderVersions();
  renderStatus();
  loadDiff();
}

function updateFoot() {
  const v = $('editor').value || '';
  const cjk = (v.match(/[\u4e00-\u9fff\u3040-\u30ff]/g) || []).length;
  const words = (v.trim().match(/[A-Za-z0-9']+/g) || []).length;
  $('wordCount').textContent = `${v.length} 字符 · ${cjk ? cjk + ' 汉字 · ' : ''}${words} 词`;
}

function renderChecks(checks) {
  const pill = $('scorePill');
  const list = $('checkList');
  if (!checks) {
    pill.className = 'score-pill';
    pill.textContent = '未校验';
    list.innerHTML = '<p class="muted small" style="padding:10px 8px">保存或生成后会跑一遍渠道规则。</p>';
    return;
  }
  const { score, mustFail, results } = checks;
  pill.className = 'score-pill ' + (mustFail ? 'bad' : score >= 80 ? 'ok' : 'warn');
  pill.textContent = mustFail ? `${score}% · ${mustFail} 处硬伤` : `${score}% 通过`;

  const icon = (ok) => ok
    ? '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 8.5l3.2 3.2L13 5"/></svg>'
    : '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4l8 8M12 4l-8 8"/></svg>';

  list.innerHTML = results.map((r) => `
    <div class="check ${r.ok ? '' : 'is-fail'}">
      <span class="mark">${icon(r.ok)}</span>
      <span class="body">
        <span>${esc(r.text)}</span>
        ${r.detail ? `<span class="why">${esc(r.detail)}</span>` : ''}
        ${r.cite ? `<span class="cite">依据：${esc(r.cite)}</span>` : ''}
      </span>
      <span class="sev ${r.severity === 'must' ? 'must' : ''}">${r.severity === 'must' ? '必须' : '建议'}</span>
    </div>`).join('');
}

function renderStatus() {
  const a = asset();
  const cur = currentVersion(a);
  const ch = a ? channelOf(a.channel) : null;
  $('statusAsset').textContent = a ? (a.title || (ch ? ch.labelZh : a.channel)) : '—';
  $('statusScheduled').textContent = a && a.scheduledAt ? a.scheduledAt : '未排期';
  const st = $('statusState');
  if (!a || !cur) { st.className = 'pill pill-neutral'; st.textContent = '空'; }
  else if (cur.status === 'approved') { st.className = 'pill pill-ok'; st.textContent = '已批准'; }
  else if (cur.checks && cur.checks.mustFail) { st.className = 'pill pill-bad'; st.textContent = '有硬伤'; }
  else { st.className = 'pill pill-warn'; st.textContent = '草稿'; }
  $('statusScore').textContent = cur && cur.checks ? cur.checks.score + '%' : '—';
  $('statusVersion').textContent = cur ? 'v' + cur.v : '—';
}

function renderVersions() {
  const a = asset();
  const box = $('versionList');
  if (!a || !a.versions.length) {
    box.innerHTML = '<p class="muted small" style="padding:6px 0">还没有版本。</p>';
    $('versionHint').textContent = '';
  } else {
    $('versionHint').textContent = a.versions.length + ' 版';
    box.innerHTML = a.versions.slice().reverse().map((v) => {
      const cls = ['tl-item', v.v === a.current ? 'is-cur' : '', v.status === 'approved' ? 'is-approved' : ''].join(' ');
      return `<div class="${cls}" data-v="${v.v}">
        <div class="tl-top">
          <span class="tl-v">v${v.v}</span>
          ${v.variant && v.variant !== 'A' ? `<span class="pill pill-neutral">变体 ${esc(v.variant)}</span>` : ''}
          ${v.status === 'approved' ? '<span class="pill pill-ok">已批准</span>' : ''}
          ${v.isWinner ? '<span class="pill pill-accent">赢家</span>' : ''}
        </div>
        <div class="tl-sub">${esc(v.source)} · ${v.checks ? v.checks.score + '%' : '-'} · ${esc((v.createdAt || '').slice(5, 16).replace('T', ' '))}</div>
      </div>`;
    }).join('');
    box.querySelectorAll('.tl-item').forEach((el) => {
      el.onclick = async () => {
        if (S.drafts[key()] !== undefined) return toast('当前有未保存草稿，先保存再切版本', true);
        await api(`/api/campaigns/${S.campaignId}/assets/${S.assetId}/current`, { method: 'POST', body: { v: Number(el.dataset.v) } });
        await loadState(true);
      };
    });
  }
  const cur = currentVersion(a);
  $('btnApprove').textContent = cur && cur.status === 'approved' ? '取消批准' : '批准当前版本';
}

async function loadDiff() {
  const a = asset();
  const box = $('diffView');
  const hint = $('diffHint');
  if (!a || a.versions.length < 2) { box.textContent = '至少两个版本才有对比。'; hint.textContent = ''; return; }
  const cur = currentVersion(a);
  const prev = a.versions.filter((v) => v.v < cur.v).pop();
  if (!prev) { box.textContent = '这是第一个版本。'; hint.textContent = ''; return; }
  try {
    const d = await api(`/api/campaigns/${S.campaignId}/assets/${S.assetId}/diff?a=${prev.v}&b=${cur.v}`);
    hint.textContent = `v${prev.v} → v${cur.v}  +${d.summary.added} / −${d.summary.removed}`;
    box.innerHTML = d.diff.map((x) => `<span class="${x.type}">${x.type === 'add' ? '+ ' : x.type === 'del' ? '− ' : '  '}${esc(x.line) || ' '}</span>`).join('');
  } catch (e) { box.textContent = '对比失败：' + e.message; hint.textContent = ''; }
}

/* ---- 日历 ---- */
function monthCells(month) {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const lead = (first.getDay() + 6) % 7; // 周一为一周起点
  const days = new Date(y, m, 0).getDate();
  const cells = [];
  const prevDays = new Date(y, m - 1, 0).getDate();
  for (let i = lead; i > 0; i--) cells.push({ out: true, day: prevDays - i + 1 });
  for (let d = 1; d <= days; d++) cells.push({ out: false, day: d });
  while (cells.length % 7 !== 0) cells.push({ out: true, day: cells.length });
  return { y, m, cells };
}

function renderCalendar() {
  // 当前月没有排期时，自动跳到第一个有排期的月份，避免"明明排了却看不到"
  const all = S.calendar.filter((r) => r.campaignId === S.campaignId);
  if (!S.calManual && !all.some((r) => r.scheduledAt && r.scheduledAt.startsWith(S.calMonth))) {
    const first = all.find((r) => r.scheduledAt);
    if (first) S.calMonth = first.scheduledAt.slice(0, 7);
  }
  const [y, m] = S.calMonth.split('-').map(Number);
  $('calTitle').textContent = `${y} 年 ${m} 月`;

  $('calLegend').innerHTML = S.assetTypes
    .map((t) => `<span><i class="legend-${t.id}"></i>${esc(t.short)}</span>`).join('');

  const rows = S.calendar.filter((r) => r.campaignId === S.campaignId);
  const unscheduled = rows.filter((r) => !r.scheduledAt);
  $('calUnscheduled').innerHTML = unscheduled.length
    ? `<span class="cu-label">未排期 ${unscheduled.length}</span>` + unscheduled.map((r) => calChip(r, true)).join('')
    : '<span class="cu-label">没有未排期的资产</span>';

  const { cells } = monthCells(S.calMonth);
  const byDay = {};
  rows.filter((r) => r.scheduledAt && r.scheduledAt.startsWith(S.calMonth)).forEach((r) => {
    const d = Number(r.scheduledAt.slice(8, 10));
    (byDay[d] = byDay[d] || []).push(r);
  });

  const t = todayStr();
  $('calGrid').innerHTML = cells.map((c) => {
    const isToday = !c.out && t === `${S.calMonth}-${pad(c.day)}`;
    const items = c.out ? [] : (byDay[c.day] || []);
    const shown = items.slice(0, 3);
    return `<div class="cal-cell ${c.out ? 'is-out' : ''} ${isToday ? 'is-today' : ''}" data-day="${c.out ? '' : c.day}">
      <div class="cal-day">${c.day}</div>
      <div class="cal-items">${shown.map((r) => calChip(r)).join('')}${items.length > 3 ? `<span class="cal-more">+${items.length - 3}</span>` : ''}</div>
    </div>`;
  }).join('');

  $('calGrid').querySelectorAll('.cal-cell').forEach((el) => {
    el.onclick = (ev) => {
      if (ev.target.closest('.cal-chip')) return;
      const day = el.dataset.day;
      openAssetModal(day ? `${S.calMonth}-${pad(day)}` : '');
    };
  });
  $('calGrid').querySelectorAll('.cal-chip').forEach((el) => {
    el.onclick = async (ev) => {
      ev.stopPropagation();
      S.campaignId = el.dataset.cp;
      S.assetId = el.dataset.aid;
      setNav('content');
      renderList(); renderWorkspace();
      if (await openArticleFromCalendar(el.dataset.aid)) return;   // 文章 → 三 Tab 编辑器
      if (window.CL && window.CL.showEditor) window.CL.showEditor();
    };
  });
  $('calUnscheduled').querySelectorAll('.cal-chip').forEach((el) => {
    el.onclick = async () => {
      S.assetId = el.dataset.aid;
      setNav('content');
      renderWorkspace();
      if (await openArticleFromCalendar(el.dataset.aid)) return;
      if (window.CL && window.CL.showEditor) window.CL.showEditor();
    };
  });
}

/**
 * 日历里的条子点进去，要落到「那条内容自己的编辑器」。
 * v12 起 article 走 Write / Settings / Audience，其它类型还是老三栏编辑器。
 * 返回 true = 文章编辑器已经打开，调用方不要再开老编辑器。
 */
async function openArticleFromCalendar(assetId) {
  if (!assetId || !window.AR || !window.AR.open) return false;
  const ctId = 'ct_as_' + assetId;   // 内容条目的 id 就是 ct_as_<assetId>
  try {
    const r = await api('/api/content/' + encodeURIComponent(ctId));
    const it = r && r.item;
    if (!it || it.type !== 'article') return false;
    window.AR.open(ctId);
    return true;
  } catch (e) {
    return false;   // 没有对应条目 / 取不到 → 老老实实走老路
  }
}

function calChip(r, inStrip) {
  const cur = r.status;
  const cls = ['cal-chip', 'type-' + r.type];
  if (cur === 'approved') cls.push('is-approved');
  else if (r.mustFail > 0) cls.push('is-bad');
  const label = r.title || r.channelLabel;
  return `<button class="${cls.join(' ')}" data-cp="${r.campaignId}" data-aid="${r.assetId}" title="${esc(r.channelLabel)} · ${esc(r.scheduledAt || '未排期')}">
    ${esc(label)}${inStrip ? '' : ''}
  </button>`;
}

/* ================= 动作 ================= */
async function saveMeta() {
  await api('/api/campaigns/' + S.campaignId, {
    method: 'PATCH',
    body: {
      name: $('fName').value.trim(),
      objective: $('fObjective').value.trim(),
      audience: $('fAudience').value.trim(),
      language: $('fLanguage').value.trim(),
      tone: $('fTone').value.trim(),
      cta: $('fCta').value.trim(),
      productName: $('fProduct').value.trim(),
      fromName: $('fFrom').value.trim(),
      sellingPoints: $('fPoints').value.split('\n').map((s) => s.trim()).filter(Boolean),
      rawMaterial: $('fRaw').value
    }
  });
  $('metaSaved').textContent = '已保存';
  setTimeout(() => { $('metaSaved').textContent = ''; }, 1800);
  await loadState(true);
}

async function saveVersion() {
  if (!S.assetId) return toast('先选一个资产', true);
  const body = $('editor').value;
  if (!body.trim()) return toast('正文是空的', true);
  const r = await api(`/api/campaigns/${S.campaignId}/assets/${S.assetId}/versions`, {
    method: 'POST', body: { body, variant: $('variantSel').value, note: 'manual edit' }
  });
  delete S.drafts[key()];
  $('dirtyFlag').classList.add('hidden');
  await loadState(true);
  const bad = r.entry.checks.mustFail;
  toast(bad ? `已存 v${r.entry.v}，但还有 ${bad} 处硬伤` : `已存 v${r.entry.v} · 规则分 ${r.entry.checks.score}%`, !!bad);
}

async function saveAssetInfo() {
  if (!S.assetId) return;
  await api(`/api/campaigns/${S.campaignId}/assets/${S.assetId}`, {
    method: 'PATCH',
    body: { title: $('fAssetTitle').value.trim(), scheduledAt: $('fScheduled').value || null }
  });
  await loadState(true);
  toast('资产信息已保存');
}

async function generate(wholeCampaign) {
  if (!S.campaignId) return;
  const btn = wholeCampaign ? $('btnGenAll') : $('btnGen');
  const old = btn.textContent;
  btn.disabled = true; btn.textContent = '生成中…';
  try {
    let url, body;
    if (wholeCampaign) {
      url = `/api/campaigns/${S.campaignId}/generate`;
      body = { variant: $('variantSel').value };
    } else {
      url = `/api/campaigns/${S.campaignId}/assets/${S.assetId}/generate`;
      body = { variant: $('variantSel').value };
    }
    const r = await api(url, { method: 'POST', body });
    await loadState(true);
    if (wholeCampaign) {
      const degraded = (r.results || []).find((x) => x.degraded);
      toast(degraded ? `${r.results.length} 个资产已生成（降级为模板）` : `${r.results.length} 个资产已生成`, !!degraded);
    } else {
      toast(r.degraded ? `已生成（降级为模板）` : `已生成 v${r.entry.v} · ${r.entry.checks.score}%`, !!r.degraded);
    }
  } catch (e) {
    toast('生成失败：' + e.message, true);
  } finally {
    btn.disabled = false; btn.textContent = old;
  }
}

async function newCampaign() {
  const r = await api('/api/campaigns', { method: 'POST', body: { name: '新 campaign', language: 'en' } });
  S.campaignId = r.campaign.id;
  S.assetId = null;
  await loadState(true);
  setNav('content');
  $('briefCard').open = true;
  $('fName').focus(); $('fName').select();
}

function openAssetModal(date) {
  $('assetErr').textContent = '';
  $('aChannel').innerHTML = S.assetTypes.map((t) => {
    const opts = S.channels.filter((c) => c.type === t.id)
      .map((c) => `<option value="${c.id}">${esc(c.labelZh)}</option>`).join('');
    return `<optgroup label="${esc(t.label)}">${opts}</optgroup>`;
  }).join('');
  $('aTitle').value = '';
  $('aScheduled').value = date || '';
  $('assetModal').classList.remove('hidden');
}

async function createAsset() {
  const body = {
    channel: $('aChannel').value,
    title: $('aTitle').value.trim(),
    scheduledAt: $('aScheduled').value || null
  };
  try {
    const r = await api(`/api/campaigns/${S.campaignId}/assets`, { method: 'POST', body });
    $('assetModal').classList.add('hidden');
    S.assetId = r.asset.id;
    await loadState(true);
    setNav('content');
    toast('资产已添加');
  } catch (e) {
    $('assetErr').textContent = e.message;
  }
}

async function deleteAsset() {
  if (!S.assetId) return;
  const a = asset();
  if (!confirm(`删除资产「${(a && (a.title || a.channel)) || ''}」及其全部版本？`)) return;
  await api(`/api/campaigns/${S.campaignId}/assets/${S.assetId}`, { method: 'DELETE' });
  S.assetId = null;
  await loadState(true);
  toast('资产已删除');
}

async function approve() {
  const cur = currentVersion(asset());
  if (!cur) return toast('没有可批准的版本', true);
  await api(`/api/campaigns/${S.campaignId}/assets/${S.assetId}/approve`, {
    method: 'POST', body: { v: cur.v, approved: cur.status !== 'approved' }
  });
  await loadState(true);
  toast(cur.status === 'approved' ? '已取消批准' : `v${cur.v} 已批准`);
}

async function markWinner() {
  const cur = currentVersion(asset());
  if (!cur) return toast('没有可标记的版本', true);
  await api(`/api/campaigns/${S.campaignId}/assets/${S.assetId}/winner`, { method: 'POST', body: { v: cur.v } });
  await loadState(true);
  toast(`v${cur.v} 已标记为赢家`);
}

async function exportAs(fmt) {
  if (!S.campaignId) return;
  if (fmt === 'csv') return window.open(`/api/campaigns/${S.campaignId}/export?format=csv`, '_blank');
  const r = await api(`/api/campaigns/${S.campaignId}/export?format=md`);
  try {
    await navigator.clipboard.writeText(r.markdown);
    toast('Markdown 已复制到剪贴板');
  } catch (_) {
    window.open(`/api/campaigns/${S.campaignId}/export?format=md&download=1`, '_blank');
  }
}

async function removeCampaign() {
  const cp = campaign();
  if (!cp) return;
  if (!confirm(`删除「${cp.name}」及全部 ${cp.assets.length} 个资产？不可恢复。`)) return;
  await api('/api/campaigns/' + S.campaignId, { method: 'DELETE' });
  S.campaignId = null; S.assetId = null;
  await loadState();
  toast('已删除');
}

/** 把某个配置块（[data-section]）搬到指定容器 —— Dashboard / Strategy 共用同一份表单 DOM */
function mountSection(key, targetSel) {
  const el = document.querySelector('[data-section="' + key + '"]');
  const t = document.querySelector(targetSel);
  if (!el || !t) return false;
  if (el.parentElement !== t) t.appendChild(el);
  return true;
}

/* ================= 设置 ================= */
function openSettings() {
  const p = S.settings.provider;
  $('sMode').value = p.mode;
  $('sBase').value = p.baseUrl || '';
  $('sModel').value = p.model || '';
  $('sToken').value = '';
  $('sBanned').value = (S.settings.bannedWords || []).join(', ');
  $('settingsModal').classList.remove('hidden');
}

async function saveSettings() {
  const body = {
    provider: { mode: $('sMode').value, baseUrl: $('sBase').value.trim(), model: $('sModel').value.trim() },
    bannedWords: $('sBanned').value.split(',').map((s) => s.trim()).filter(Boolean)
  };
  const tok = $('sToken').value.trim();
  if (tok) body.provider.token = tok;
  await api('/api/settings', { method: 'POST', body });
  S.settings = await api('/api/settings');
  renderMode();
  $('settingsSaved').textContent = '已保存';
  setTimeout(() => { $('settingsSaved').textContent = ''; }, 1800);
  toast('设置已保存');
}

/* ================= 绑定 ================= */
$('btnNew').onclick = newCampaign;
$('btnSaveMeta').onclick = () => saveMeta().catch((e) => toast(e.message, true));
$('btnSave').onclick = () => saveVersion().catch((e) => toast(e.message, true));
$('btnGen').onclick = () => generate(false);
$('btnGenAll').onclick = () => generate(true);
$('btnSaveAsset').onclick = () => saveAssetInfo().catch((e) => toast(e.message, true));
$('btnDeleteAsset').onclick = () => deleteAsset().catch((e) => toast(e.message, true));
$('btnApprove').onclick = () => approve().catch((e) => toast(e.message, true));
$('btnWinner').onclick = () => markWinner().catch((e) => toast(e.message, true));
$('btnDelete').onclick = () => removeCampaign().catch((e) => toast(e.message, true));
$('btnExportMd').onclick = () => exportAs('md').catch((e) => toast(e.message, true));
$('btnExportCsv').onclick = () => exportAs('csv');
$('btnSettings').onclick = openSettings;
$('btnCloseSettings').onclick = () => $('settingsModal').classList.add('hidden');
$('btnSaveSettings').onclick = () => saveSettings().catch((e) => toast(e.message, true));

$('btnAddAsset').onclick = () => openAssetModal('');
$('btnCreateAsset').onclick = () => createAsset().catch((e) => { $('assetErr').textContent = e.message; });
$('btnCancelAsset').onclick = () => $('assetModal').classList.add('hidden');
$('calPrev').onclick = () => shiftMonth(-1);
$('calNext').onclick = () => shiftMonth(1);
$('calToday').onclick = () => { S.calManual = true;
  const d = new Date();
  S.calMonth = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  renderCalendar();
};

function shiftMonth(delta) { S.calManual = true;
  const [y, m] = S.calMonth.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  S.calMonth = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  renderCalendar();
}

/* ================= 板块路由 ================= */
const VIEWS = ['dashboard', 'strategy', 'planning', 'content', 'report'];

function setNav(v) {
  if (!VIEWS.includes(v)) v = 'dashboard';
  S.nav = v;
  renderNav();
  if (v === 'content') {
    // 列表是主界面；编辑器按行打开（renderList/renderWorkspace 只在编辑器里用）
    if (window.CL) { window.CL.init(); window.CL.open(); }
    else { renderList(); renderWorkspace(); }
  }
  if (v === 'planning' && typeof window.renderPlanning === 'function') window.renderPlanning();
  if (v === 'dashboard' && typeof window.renderDashboard === 'function') window.renderDashboard();
  if (v === 'strategy' && typeof window.renderStrategy === 'function') window.renderStrategy();
  // Report 模块：优先用 /views/report.js 提供的 AV（左侧二级侧边栏 + 右侧内容区），
  // 老的效果回流占位（dashboard.js 里的 renderReport）作为兜底保留
  if (v === 'report') {
    if (window.AV && typeof window.AV.renderReport === 'function') window.AV.renderReport();
    else if (typeof window.renderReport === 'function') window.renderReport();
  }
}

function renderNav() {
  document.querySelectorAll('.nav-item').forEach((b) => {
    const on = b.dataset.view === S.nav;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-current', on ? 'page' : 'false');
  });
  VIEWS.forEach((v) => {
    const el = $('view-' + v);
    if (el) el.classList.toggle('hidden', v !== S.nav);
  });
}

document.querySelectorAll('.nav-item').forEach((b) => {
  b.onclick = () => {
    setNav(b.dataset.view);
    try { history.replaceState(null, '', '#' + b.dataset.view); } catch (e) { /* file:// 下忽略 */ }
  };
});

window.SCA = {
  S, $, esc, api, toast, loadState, setNav, renderNav, pad, todayStr, ICONS,
  campaign, asset, channelOf, typeMeta, currentVersion,
  openAssetModal, renderCalendar, renderList, renderWorkspace, mountSection,
  renderPlanning: () => (window.renderPlanning ? window.renderPlanning() : null),
  renderStrategy: () => (window.renderStrategy ? window.renderStrategy() : null),
  renderDashboard: () => (window.renderDashboard ? window.renderDashboard() : null)
};

$('editor').addEventListener('input', () => {
  const first = S.drafts[key()] === undefined;
  S.drafts[key()] = $('editor').value;
  updateFoot();
  $('dirtyFlag').classList.remove('hidden');
  if (first) renderAssetBoard();
});

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    if (S.campaignId && S.assetId) saveVersion().catch((err) => toast(err.message, true));
  }
  if (e.key === 'Escape') {
    $('settingsModal').classList.add('hidden');
    $('assetModal').classList.add('hidden');
    $('providerModal').classList.add('hidden');
  }
});

loadState()
  // 支持 #report/av-prompts 这种二级深链，只取第一段当一级视图
  .then(() => setNav(location.hash.slice(1).split('/')[0] || 'dashboard'))
  .catch((e) => toast('加载失败：' + e.message + '（服务端起了吗？）', true));
