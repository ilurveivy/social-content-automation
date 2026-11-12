'use strict';
/* ==================== Strategy：chat / content audit / company knowledge / plugins & skills ====================
 * 这里**没有独立的数据**：知识库、GSC、插件、对话都读同一份存储，
 * 在 Strategy 改的东西 Dashboard 立刻能看到，反之亦然。
 */
(function () {
  'use strict';

  const T = { data: null, tab: 'chat', chatId: null, chat: null, sending: false, editingSkill: null };

  const SCA = () => window.SCA;
  const esc = (s) => window.SCA.esc(s);
  const $ = (id) => document.getElementById(id);

  /** 策略类预设指令（和 Dashboard 那组视觉一致，但内容偏调研/规划） */
  const PRESETS = [
    ['Research my competitors', '研究我的竞品：他们在讲什么、哪些主题没讲，我们该抢哪些。没有资料的地方标注待验证。'],
    ['Find content gaps', '基于我的知识库和内容支柱，列出 5 个内容缺口，每个说明依据和目标读者。'],
    ['Plan a campaign', '帮我做一份这个月的推广方案：先定主张，再排 4 个渠道的资产，动作直接执行。'],
    ['Generate briefs', '按我的内容支柱生成 3 个 brief：标题 + 目标关键词 + 要回答的问题 + 建议渠道。'],
    ['Improve my AI visibility', '怎么让 ChatGPT / Gemini 这类答案引擎更容易引用我们的内容？给可执行动作。'],
    ['Audit my site', '读 Content audit 里我导入的 GSC 数据，给它排优先级并说每条该怎么改。']
  ];

  /* ==================== 渲染入口 ==================== */

  /** OAuth 回跳：/?gsc=ok&sites=N 或 /?gsc=err&msg=… */
  function handleGscReturn() {
    const q = new URLSearchParams(location.search);
    if (!q.get('gsc')) return false;
    const ok = q.get('gsc') === 'ok';
    const warn = q.get('warn');
    if (ok) {
      SCA().toast(warn ? 'Google 授权成功，但拉站点列表失败：' + warn
        : 'Google 授权成功' + (q.get('sites') ? '，拉到 ' + q.get('sites') + ' 个站点' : ''), !!warn);
    } else {
      SCA().toast('授权失败：' + (q.get('msg') || '未知原因'), true);
    }
    history.replaceState(null, '', location.pathname);
    return true;
  }

  async function renderStrategy() {
    const { api } = SCA();
    try {
      T.data = await api('/api/strategy');
    } catch (e) {
      SCA().toast('Strategy 加载失败：' + e.message, true);
      return;
    }
    if (!T.chatId && T.data.chats.length) T.chatId = T.data.chats[0].id;
    // OAuth 回跳（/?gsc=ok…）→ 直接落到 Content audit，别让人自己再点一次
    if (handleGscReturn()) T.tab = 'audit';
    renderRail();
    renderQuick();
    setTab(T.tab, true);
    await loadChat();
  }

  /** Dashboard 那边刷新完应用列表后，顺带把这边正在显示的插件区重画一遍 */
  window.refreshStrategyTools = async () => {
    const panel = $('stPanel-plugins');
    if (!T.data || !panel || panel.classList.contains('hidden')) return;
    await renderStrategy();
  };

  function renderRail() {
    const d = T.data;
    if (!d) return;
    const auditN = d.audit && d.audit.opportunities ? d.audit.opportunities.length : 0;
    const badge = $('stAuditBadge');
    if (badge) badge.textContent = auditN ? String(auditN) : '';
    const ready = $('stReady');
    if (ready) {
      const pct = d.knowledge.completeness.pct;
      ready.innerHTML = `
        <div class="st-ready-row"><span class="muted small">品牌知识</span><strong>${d.blocks.done}/${d.blocks.total}</strong></div>
        <div class="st-ready-row"><span class="muted small">插件</span><strong>${d.stats.plugins}</strong></div>
        <div class="st-ready-row"><span class="muted small">技能</span><strong>${d.stats.skills}</strong></div>
        <div class="st-bar"><i style="width:${pct}%"></i></div>`;
    }
  }

  function setTab(tab, silent) {
    T.tab = tab;
    document.querySelectorAll('.st-item').forEach((b) => b.classList.toggle('is-active', b.dataset.st === tab));
    document.querySelectorAll('.st-panel').forEach((p) => p.classList.toggle('hidden', p.id !== 'stPanel-' + tab));
    if (!silent) {
      if (tab === 'chat') loadChat();
      if (tab === 'audit') renderAudit();
      if (tab === 'knowledge') renderKnowledge();
      if (tab === 'plugins') renderPlugins();
    } else {
      if (tab === 'audit') renderAudit();
      if (tab === 'knowledge') renderKnowledge();
      if (tab === 'plugins') renderPlugins();
    }
  }

  /* ==================== 1. New chat ==================== */

  async function loadChat() {
    const { api } = SCA();
    const box = $('stMessages');
    if (!box) return;
    if (!T.chatId) {
      T.chat = null;
      box.innerHTML = '';
      renderChatSelect();
      return;
    }
    try {
      const r = await api('/api/chats/' + T.chatId);
      T.chat = r.chat;
    } catch (_) {
      T.chatId = null; T.chat = null; box.innerHTML = ''; renderChatSelect(); return;
    }
    box.innerHTML = window.ChatUI.messagesHtml(T.chat);
    window.ChatUI.scrollBottom(box);
    renderChatSelect();
  }

  function renderChatSelect() {
    const d = T.data;
    const sel = $('stChatSelect');
    if (!d || !sel) return;
    sel.innerHTML = d.chats.length
      ? d.chats.map((c) => `<option value="${c.id}" ${c.id === T.chatId ? 'selected' : ''}>${esc(c.title)}</option>`).join('')
      : '<option value="">（还没有对话）</option>';
    const src = $('stChatSource');
    if (src) {
      const p = d.provider;
      src.textContent = p ? `${p.name} · ${p.model || '未选模型'}` : '离线模板';
      src.className = 'pill ' + (p ? 'pill-ok' : 'pill-neutral');
    }
  }

  function renderQuick() {
    const d = T.data;
    const box = $('stQuick');
    if (!box || !d) return;
    const presets = PRESETS.map(([label, prompt]) => `<button class="quick" data-q="${esc(prompt)}">${esc(label)}</button>`);
    const skills = d.skills.map((s) => `<button class="quick quick-skill" data-skill="${esc(s.name)}" title="${esc(s.description)}">@${esc(s.name)}</button>`);
    box.innerHTML = presets.join('') + (skills.length ? '<span class="quick-sep"></span>' + skills.join('') : '');
  }

  async function sendChat(text) {
    const { api, toast } = SCA();
    const t = String(text || '').trim();
    if (!t || T.sending) return;
    T.sending = true;
    $('stSend').disabled = true;
    $('stChatText').value = '';
    try {
      const r = await api('/api/agent/chat', { method: 'POST', body: { chatId: T.chatId, text: t } });
      T.chatId = r.chatId;
      await renderStrategy();
      const okN = (r.executed || []).filter((a) => a.ok).length;
      if (r.skill) toast(`已按技能「${r.skill.name}」执行`);
      else if (okN) toast(`已完成 ${okN} 个动作`);
      else if (r.degraded) toast('未接模型，已用离线模板：' + String(r.degraded).slice(0, 60), true);
    } catch (e) {
      toast('发送失败：' + e.message, true);
    } finally {
      T.sending = false;
      $('stSend').disabled = false;
    }
  }

  /* ==================== 2. Content audit ==================== */

  /** GSC 接入的三种状态：没凭据 / 有凭据没授权 / 已授权可同步 */
  function renderGsc() {
    const d = T.data;
    if (!d) return;
    const g = d.gsc || {};
    const st = d.gscStatus || {};
    const pill = $('stGscPill');
    if (pill) {
      const label = g.connected
        ? '已接入 ' + (st.site || g.site || '')
        : st.authorized ? '已授权 · 待同步'
          : st.configured ? '凭据已存 · 未授权' : '未接入';
      pill.textContent = label;
      pill.className = 'pill ' + (g.connected ? 'pill-ok' : st.configured ? 'pill-warn' : 'pill-neutral');
    }
    const sub = $('stGscSub');
    if (sub) {
      sub.textContent = st.authorized
        ? '已授权' + (st.account ? ' ' + st.account : '') + '，选站点后点「同步最近 28 天」。'
        : st.configured
          ? '凭据已存，下一步：用 Google 账号授权。'
          : '用你自己的 Google 账号授权，数据直连（不是我们代连）。';
    }
    const show = (id, on) => { const el = $(id); if (el) el.classList.toggle('hidden', !on); };
    if ($('stGscSetup')) $('stGscSetup').textContent = st.configured ? '修改凭据' : '开始接入';
    show('stGscAuth', !!st.configured && !st.authorized);
    show('stGscSync', !!st.authorized);
    show('stGscDisconnect', !!(st.authorized || st.configured));
    show('stGscReady', !!st.authorized);
    if ($('stGscUri')) $('stGscUri').textContent = st.redirectUri || '';
    const dl = $('stGscSiteList');
    if (dl) {
      dl.innerHTML = (st.sites || []).map((x) =>
        '<option value="' + esc(x.siteUrl) + '">' + esc(x.permission) + '</option>').join('');
    }
    const siteIn = $('stGscSite');
    if (siteIn && !siteIn.value) siteIn.value = st.site || g.site || '';
    if ($('stGscAccount')) $('stGscAccount').value = st.account || (st.authorized ? '已授权' : '');
    if ($('stGscNotice')) {
      $('stGscNotice').textContent = st.lastError
        ? '上次出错：' + st.lastError
        : st.authorized && !(st.sites || []).length
          ? '没拉到站点列表（可能这台机器连不上 googleapis.com）。直接手填站点地址，同步时再试。'
          : '';
    }
    // 没有 API 授权、但已经有数据 → 把粘贴框直接打开，别让人找
    const paste = $('stPaste');
    if (paste && !st.authorized && g.hasRaw && paste.classList.contains('hidden')) paste.classList.remove('hidden');
  }

  function renderAudit() {
    const d = T.data;
    if (!d) return;
    const g = d.gsc || {};
    renderGsc();
    const raw = $('stAuditRaw');
    if (raw && !raw.value) raw.value = g.raw || '';
    const at = $('stImportAt');
    if (at) {
      at.textContent = g.importedAt
        ? (g.source === 'gsc-api' ? 'API 同步于 ' : '数据导入于 ') + String(g.importedAt).replace('T', ' ').slice(0, 16)
        : '还没有数据';
    }

    const a = d.audit || {};
    const sum = $('stAuditSummary');
    const list = $('stAuditList');
    const warnLine = (a.warnings || []).length
      ? '<p class="muted small">解析提示：' + a.warnings.map(esc).join('；') + '</p>' : '';
    const st = d.gscStatus || {};
    if (!a.hasData || !a.rows) {
      if (sum) sum.innerHTML = '';
      if (list) {
        list.innerHTML = '<div class="card audit-empty">' +
          '<h3>' + (a.hasData && !a.rows ? '这份数据没解析出东西' : '还没有数据') + '</h3>' +
          '<p class="muted small">' + (st.authorized
            ? '选好站点，点上面的「同步最近 28 天」；或者手动粘贴一张导出表。'
            : '先点「开始接入」把自己的 Google Cloud 凭据填进来，授权后就能同步；不想接入也可以直接粘贴 Search Console 的导出表。') + '</p>' +
          warnLine +
          '</div>';
      }
      return;
    }
    const t = (k) => (a.byType && a.byType[k]) || 0;
    if (sum) {
      sum.innerHTML = `
        <div class="audit-stat"><strong>${a.rows}</strong><span class="muted small">行查询</span></div>
        <div class="audit-stat"><strong>${a.opportunities.length}</strong><span class="muted small">个机会</span></div>
        <div class="audit-stat"><strong>${(a.ctr * 100).toFixed(1)}%</strong><span class="muted small">整体 CTR</span></div>
        <div class="audit-stat"><strong>${a.avgPosition}</strong><span class="muted small">平均排名</span></div>
        <div class="audit-legend">
          <span class="pill pill-bad">标题/描述 ${t('low_ctr')}</span>
          <span class="pill pill-warn">临门一脚 ${t('striking')}</span>
          <span class="pill pill-neutral">内容太浅 ${t('thin')}</span>
          <span class="pill pill-neutral">没有内容 ${t('gap')}</span>
          <span class="pill pill-accent">支柱空着 ${t('pillar')}</span>
        </div>`;
    }

    const warn = (a.warnings || []).length
      ? `<p class="muted small">注意：${a.warnings.map(esc).join('；')}</p>` : '';
    const rows = a.opportunities
      .map((o) => `<div class="audit-row" data-op="${o.id}">
        <div class="ar-prio">${o.priority}</div>
        <div class="ar-main">
          <div class="row wrap">
            <strong class="ar-q">${esc(o.query)}</strong>
            <span class="pill ${o.type === 'low_ctr' ? 'pill-bad' : o.type === 'striking' ? 'pill-warn' : o.type === 'pillar' ? 'pill-accent' : 'pill-neutral'}">${esc(o.typeLabel)}</span>
          </div>
          <p class="muted small">${esc(o.action)}</p>
          <div class="ar-metrics muted small">
            <span>展示 ${o.impressions}</span>
            <span>点击 ${o.clicks}</span>
            <span>CTR ${(o.ctr * 100).toFixed(2)}%</span>
            <span>排名 ${o.position || '—'}</span>
          </div>
        </div>
        <button class="btn btn-small" data-act="toCampaign" data-op="${esc(o.id)}">转成 campaign</button>
      </div>`)
      .join('');
    list.innerHTML = warn + (rows || '<p class="muted small">这份数据里没有达到阈值的查询（说明要么没流量、要么都还不错）。</p>');
    list.dataset.audit = JSON.stringify(a.opportunities.map((o) => ({ id: o.id, query: o.query, campaignName: o.campaignName, action: o.action })));
  }

  async function runAudit() {
    const { api, toast } = SCA();
    const raw = $('stAuditRaw').value;
    if (!raw.trim()) { toast('先把 GSC 的表格贴进来', true); return; }
    try {
      const r = await api('/api/audit', { method: 'POST', body: { raw } });
      T.data.audit = { ...r.audit, hasData: true };
      T.data.gsc = { ...T.data.gsc, raw, importedAt: r.importedAt };
      renderRail();
      renderAudit();
      toast(`分析完成：${r.audit.rows} 行，${r.audit.opportunities.length} 个机会`);
    } catch (e) {
      toast('分析失败：' + e.message, true);
    }
  }

  async function toCampaign(opId) {
    const { api, toast, setNav } = SCA();
    const ops = JSON.parse($('stAuditList').dataset.audit || '[]');
    const o = ops.find((x) => x.id === opId);
    if (!o) return;
    const c = T.data.knowledge.company;
    try {
      const r = await api('/api/campaigns', {
        method: 'POST',
        body: {
          name: o.campaignName,
          objective: o.action,
          productName: c.name || '',
          audience: (c.audiences || [])[0] || '',
          tone: c.tone || '',
          sellingPoints: c.differentiators || [],
          rawMaterial: `来自 Content audit 的机会：${o.query}\n\n${o.action}`
        }
      });
      await SCA().loadState(true);
      // 直接选中刚建的那条，别让用户到了 Content 还在看旧 campaign
      if (r && r.campaign && r.campaign.id) {
        SCA().S.campaignId = r.campaign.id;
        SCA().S.assetId = null;
      }
      toast('已建 campaign，去 Content 里写');
      setNav('content');
      // v11：Content 默认是列表页，但这条 campaign 还没资产、列表里没它 —— 直接进编辑器
      if (window.CL && window.CL.showEditor) {
        SCA().renderList();
        SCA().renderWorkspace();
        window.CL.showEditor();
      }
    } catch (e) {
      toast('创建失败：' + e.message, true);
    }
  }

  /* ==================== 3. Company knowledge ==================== */

  /**
   * 这块 UI（8 个 tab / Overview 清单 / Brand voices / 各表单）全部由 dashboard.js 渲染，
   * 因为 Dashboard 的「Company knowledge」详情面板借的是**同一个 DOM 节点** ——
   * 两边各写一套就迟早分叉。这里只负责"挂过来 + 让它重画"。
   */
  function renderKnowledge() {
    if (SCA().mountSection('company', '#stKnowledgeSlot')) {
      const sec = document.querySelector('[data-section="company"]');
      if (sec) sec.classList.remove('hidden');
    }
    if (window.renderDashboard) window.renderDashboard();
  }

  /** 别处（Dashboard 保存知识 / 增删 brand voice）改完数据后，让这边也刷新 */
  window.refreshStrategyKnowledge = () => {
    const panel = $('stPanel-knowledge');
    if (!T.data || !panel || panel.classList.contains('hidden')) return;
    renderKnowledge();
  };

  /* ==================== 4. Plugins & skills ==================== */

  function renderPlugins() {
    const d = T.data;
    if (!d) return;
    if (SCA().mountSection('tools', '#stToolsSlot')) {
      const sec = document.querySelector('[data-section="tools"]');
      if (sec) sec.classList.remove('hidden');
    }
    // 工具区渲染交给 dashboard.js（同一套 DOM 与逻辑）
    if (window.renderDashboard) window.renderDashboard();

    const box = $('stSkills');
    if (!box) return;
    box.innerHTML = d.skills
      .map((s) => `<div class="skill-row" data-sid="${s.id}">
        <div class="skill-main">
          <div class="row wrap">
            <strong>${esc(s.name)}</strong>
            ${s.builtin ? '<span class="pill pill-neutral">内置</span>' : '<span class="pill pill-accent">自定义</span>'}
            <span class="muted small">${s.stepCount} 步</span>
            ${(s.tags || []).map((t) => `<span class="pill pill-neutral">${esc(t)}</span>`).join('')}
          </div>
          <p class="muted small">${esc(s.description || '（没有说明）')}</p>
          <details class="skill-steps"><summary class="muted small">看步骤</summary>
            <ol class="muted small">${s.steps.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>
          </details>
        </div>
        <div class="skill-actions">
          <button class="btn btn-small btn-primary" data-act="run" data-sid="${s.id}">运行</button>
          <button class="btn btn-small" data-act="edit" data-sid="${s.id}">编辑</button>
          <button class="btn btn-small btn-quiet" data-act="del" data-sid="${s.id}">删除</button>
        </div>
      </div>`)
      .join('');
  }

  function skillFormOpen(skill) {
    T.editingSkill = skill ? skill.id : null;
    $('skillForm').classList.remove('hidden');
    $('skFormTitle').textContent = skill ? '编辑技能：' + skill.name : '新建技能';
    $('skName').value = skill ? skill.name : '';
    $('skDesc').value = skill ? skill.description : '';
    $('skSteps').value = skill ? skill.steps.map((s, i) => `${i + 1}. ${s}`).join('\n') : '';
    $('skOutput').value = skill ? skill.output : '';
    $('skTags').value = skill ? (skill.tags || []).join(', ') : '';
    $('skName').focus();
  }

  async function saveSkill(e) {
    e.preventDefault();
    const { api, toast } = SCA();
    const body = {
      name: $('skName').value.trim(),
      description: $('skDesc').value.trim(),
      steps: $('skSteps').value.split('\n').map((s) => s.trim()).filter(Boolean),
      output: $('skOutput').value.trim(),
      tags: $('skTags').value
    };
    try {
      if (T.editingSkill && !T.editingSkill.startsWith('sk_builtin') && T.editingSkill !== null) {
        await api('/api/skills/' + T.editingSkill, { method: 'PATCH', body });
      } else {
        await api('/api/skills', { method: 'POST', body });
      }
      $('skillForm').classList.add('hidden');
      T.editingSkill = null;
      toast('技能已保存');
      await renderStrategy();
    } catch (err) {
      toast('保存失败：' + err.message, true);
    }
  }

  /* ==================== 事件 ==================== */

  function bind() {
    const { api, toast } = SCA();

    document.querySelectorAll('.st-item').forEach((b) => { b.onclick = () => setTab(b.dataset.st); });

    $('stNewChat').onclick = async () => {
      const r = await api('/api/chats', { method: 'POST', body: {} });
      T.chatId = r.chat.id;
      await renderStrategy();
      $('stChatText').focus();
    };
    $('stChatSelect').onchange = (e) => { T.chatId = e.target.value; loadChat(); };
    $('stSend').onclick = () => sendChat($('stChatText').value);
    $('stChatText').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendChat($('stChatText').value); }
    });
    $('stQuick').addEventListener('click', (e) => {
      const b = e.target.closest('.quick');
      if (!b) return;
      if (b.dataset.skill) { sendChat(`@${b.dataset.skill} 请按这套步骤执行，资料从我上传的知识库里取。`); return; }
      $('stChatText').value = b.dataset.q;
      sendChat(b.dataset.q);
    });

    $('stAuditRun').onclick = () => runAudit();
    $('stAuditClear').onclick = async () => {
      $('stAuditRaw').value = '';
      await api('/api/audit', { method: 'POST', body: { raw: '' } });
      await renderStrategy();
      toast('已清空导入的数据');
    };
    // ---- GSC 真实接入 ----
    $('stGscSetup').onclick = () => {
      $('stGscSteps').classList.toggle('hidden');
      if (!$('stGscSteps').classList.contains('hidden')) setTimeout(() => $('stGscId').focus(), 60);
    };
    $('stGscCopy').onclick = async () => {
      try {
        await navigator.clipboard.writeText($('stGscUri').textContent);
        toast('回调地址已复制');
      } catch (_) {
        toast('复制失败，手动选中复制：' + $('stGscUri').textContent, true);
      }
    };
    $('stGscSaveCreds').onclick = async () => {
      try {
        await api('/api/gsc/credentials', {
          method: 'POST',
          body: { clientId: $('stGscId').value.trim(), clientSecret: $('stGscSecret').value.trim() }
        });
        $('stGscSecret').value = '';
        toast('凭据已保存，下一步用 Google 授权');
        await renderStrategy();
      } catch (e) { toast(e.message, true); }
    };
    $('stGscAuth').onclick = () => { window.location.href = '/api/gsc/authorize'; };
    $('stGscSync').onclick = async () => {
      const site = $('stGscSite').value.trim();
      if (!site) { toast('先填站点地址', true); return; }
      const btn = $('stGscSync');
      btn.disabled = true;
      btn.textContent = '同步中…';
      try {
        await api('/api/gsc/site', { method: 'POST', body: { site } });
        const r = await api('/api/gsc/sync', { method: 'POST', body: { days: 28 } });
        if (r.error) { toast(r.error, true); await renderStrategy(); return; }
        toast('同步完成：' + r.rows + ' 行查询 → ' + r.audit.opportunities.length + ' 个机会');
        await renderStrategy();
      } catch (e) {
        toast('同步失败：' + e.message, true);
      } finally {
        btn.disabled = false;
        btn.textContent = '同步最近 28 天';
      }
    };
    $('stGscDisconnect').onclick = async () => {
      if (!confirm('断开 Search Console？凭据会删除，已经同步的数据保留。')) return;
      try {
        await api('/api/gsc/disconnect', { method: 'POST', body: {} });
        toast('已断开');
        await renderStrategy();
      } catch (e) { toast(e.message, true); }
    };
    $('stPasteToggle').onclick = () => $('stPaste').classList.toggle('hidden');
    $('stAuditList').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act="toCampaign"]');
      if (b) toCampaign(b.dataset.op);
    });

    $('skillForm').onsubmit = saveSkill;
    $('skCancel').onclick = () => { $('skillForm').classList.add('hidden'); T.editingSkill = null; };
    $('btnNewSkill').onclick = () => skillFormOpen(null);

    $('stSkills').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const id = b.dataset.sid;
      const skill = (T.data.skills || []).find((s) => s.id === id);
      if (!skill) return;
      if (b.dataset.act === 'run') {
        setTab('chat');
        $('stChatText').value = `@${skill.name} `;
        $('stChatText').focus();
        toast(`已插入 @${skill.name}，补一句你的具体要求再回车`);
      } else if (b.dataset.act === 'edit') {
        skillFormOpen(skill);
      } else if (b.dataset.act === 'del') {
        if (!confirm(`删除技能「${skill.name}」？`)) return;
        await api('/api/skills/' + id, { method: 'DELETE' });
        await renderStrategy();
      }
    });
  }

  bind();
  window.renderStrategy = renderStrategy;
})();
