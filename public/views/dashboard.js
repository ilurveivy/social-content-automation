'use strict';
/* ==================== Dashboard（对齐 StoryChief 的 agent 配置页） ==================== */
(function () {
  'use strict';

  const D = { dash: null, chatId: null, chat: null, providerOpen: false, sending: false, panel: null };
  /** Company knowledge 里当前打开的 tab（Overview / General / …） */
  const KN_TABS = ['overview', 'general', 'audiences', 'pillars', 'voices', 'writing', 'visual', 'files'];
  const KN = { tab: 'overview', voice: null };   // voice = 正在编辑的 brand voice（null 表示新建）
  const VOICE_USE = { general: 'General', blog: 'Blog posts', social: 'Social media', email: 'Email', landing: 'Landing pages' };
  const TA = { editing: null };    // 正在编辑的 target audience
  const CP = { editing: null };    // 正在编辑的 content pillar
  const WS = { editing: null };    // 正在编辑的 writing style
  const VS = { editing: null, refs: [], logos: [], target: null };  // 视觉风格弹窗（含两组图片）

  const SCA = () => window.SCA;
  const esc = (s) => window.SCA.esc(s);

  /** 卡片里点开的四块 */
  const PANELS = {
    company: {
      title: 'Company knowledge',
      sub: 'Your business, audience, competitors, and what makes your brand different.'
    },
    gsc: {
      title: 'Google Search Console',
      sub: 'What brings visitors to your website, and where you are missing opportunities.'
    },
    tools: {
      title: 'Connect your tools',
      sub: 'Information and actions from the tools your team already uses.'
    },
    files: {
      title: 'Knowledge files',
      sub: 'Internal product details, pricing, and research your agent can not find online.'
    }
  };

  /** 参考图里那 8 个快捷指令（不依赖后端） */
  const QUICK = [
    ['Get started', '我们该怎么用这个营销 agent？先给一个最省事的起手式。'],
    ['Research my competitors', '研究我的竞品：他们在做什么内容、哪些主题他们覆盖而我们没有。没有数据的标注待验证。'],
    ['Find content gaps', '基于我的公司知识和已接入的数据，列出 5 个内容缺口，每个都说明依据。'],
    ['Improve my AI visibility', '怎么让 ChatGPT / Gemini 这类答案引擎更容易引用我们的内容？给可执行的动作。'],
    ['Plan a campaign', '帮我做一份这个月的推广方案：先定主张，再排 4 个渠道的资产，动作直接执行。'],
    ['Repurpose my content', '把我们的核心主张改写成 X 和 Reddit 两个渠道的草稿，并直接写入 Content。'],
    ['Refresh my content', '哪些已发内容值得更新？给一个优先级清单和每个的具体改法。'],
    ['Explore more', '还有哪些值得我做的事？给我一份按影响排序的清单，并说明为什么现在做。']
  ];

  /** 进度用服务端算好的 blocks（和 Strategy 的 Company knowledge 是同一份） */
  function progress7(d) {
    const b = (d && d.knowledge && d.knowledge.blocks) || { done: 0, total: 0 };
    return { done: b.done, total: b.total };
  }

  const mdHtml = (s) => window.ChatUI.mdHtml(s);
  const timeOf = (iso) => (iso ? iso.slice(11, 16) : '');

  /* ==================== 渲染 ==================== */

  async function renderDashboard() {
    const { api } = SCA();
    try {
      D.dash = await api('/api/dashboard');
    } catch (e) {
      SCA().toast('dashboard 加载失败：' + e.message, true);
      return;
    }
    const d = D.dash;
    renderAi(d);
    renderReady(d);
    renderKnowledge(d);
    renderGsc(d);
    renderTools(d);
    renderFiles(d);
    renderQuick();
    renderChatList(d);
    if (!D.chatId && d.chats.length) D.chatId = d.chats[0].id;
    await loadChat();
  }

  /* ---- 顶部：provider（在弹窗里） ---- */
  function renderAi(d) {
    const { $ } = SCA();
    const pv = d.providers;
    const active = pv.providers.find((p) => p.id === pv.active) || null;

    const st = $('aiStatus');
    if (active) {
      st.className = 'pill pill-ok';
      st.textContent = `已接入 · ${active.model || '未选模型'}`;
    } else {
      st.className = 'pill pill-warn';
      st.textContent = pv.providers.length ? '已添加，未选默认' : '未接入';
    }
    $('aiCalls').textContent = pv.calls ? `累计调用 ${pv.calls} 次` : '';
    const src = $('chatSource');
    src.textContent = active ? active.name : '离线模板';
    src.className = 'pill ' + (active ? 'pill-ok' : 'pill-neutral');

    const box = $('providerList');
    if (!pv.providers.length) {
      box.innerHTML = `<div class="pv-empty muted small">
        还没接入任何模型。填一个 OpenAI 兼容地址（自己的 key、公司网关、本地 ollama 都行），
        agent 才真正会用你的资料写东西；不接也能用，但只能跑离线模板。
      </div>`;
      return;
    }

    box.innerHTML = pv.providers
      .map((p) => {
        const isActive = p.id === pv.active;
        const modelOpts = (p.models.length ? p.models : [p.model]).filter(Boolean)
          .map((m) => `<option value="${esc(m)}" ${m === p.model ? 'selected' : ''}>${esc(m)}</option>`).join('');
        const test =
          p.lastTestOk === true ? '<span class="pill pill-ok">连通</span>' :
          p.lastTestOk === false ? '<span class="pill pill-bad">不通</span>' : '';
        return `<div class="provider ${isActive ? 'is-active' : ''}" data-pid="${p.id}">
          <div class="pv-main">
            <div class="row wrap">
              <strong>${esc(p.name)}</strong>
              <span class="pill pill-neutral">${p.kind === 'anthropic' ? 'Messages' : 'Chat'}</span>
              ${isActive ? '<span class="pill pill-accent">默认</span>' : ''}
              ${test}
            </div>
            <div class="pv-meta muted small">
              ${esc(p.baseUrl)} · ${p.hasKey ? 'key ' + esc(p.keyHint) : '无 key（本地服务）'}
              ${p.models.length ? ' · ' + p.models.length + ' 个模型' : ''}
              ${p.lastError ? ' · <span class="bad-text">' + esc(String(p.lastError).slice(0, 80)) + '</span>' : ''}
            </div>
          </div>
          <div class="pv-actions">
            <select class="select pv-model" data-act="model" data-pid="${p.id}" aria-label="模型">
              ${modelOpts || '<option value="">（先拉取模型）</option>'}
            </select>
            ${isActive ? '' : '<button class="btn btn-small" data-act="use" data-pid="' + p.id + '">设为默认</button>'}
            <button class="btn btn-small" data-act="test" data-pid="${p.id}">测试</button>
            <button class="btn btn-icon" data-act="models" data-pid="${p.id}" title="从接口拉取模型清单" aria-label="拉取模型">
              <svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M16 10a6 6 0 11-2-4.5"/><path d="M16 4v3.5h-3.5"/></svg>
            </button>
            <button class="btn btn-icon btn-quiet" data-act="del" data-pid="${p.id}" title="删除" aria-label="删除">✕</button>
          </div>
        </div>`;
      })
      .join('');
  }

  /* ---- 完成度 ---- */
  function renderReady(d) {
    const el = SCA().$('readyRow');
    if (!el) return;
    const r = d.ready;
    const items = [
      { on: r.provider, label: '模型' },
      { on: r.knowledge, label: '公司知识' },
      { on: r.files, label: d.knowledge.files.length + ' 个文件' },
      { on: r.gsc, label: 'Search Console' },
      { on: r.tools > 0, label: '工具 ' + r.tools + ' 个' }
    ];
    el.innerHTML = items
      .map((i) => `<span class="ready ${i.on ? 'on' : ''}"><i></i>${esc(i.label)}</span>`)
      .join('<span class="ready-sep">·</span>');
  }

  /* ---- 1. 公司知识（8 个 tab） ---- */

  /** Overview 的 10 项清单：两列网格，左边 5 个先填 */
  function renderSetup(d) {
    const b = (d.knowledge && d.knowledge.blocks) || { items: [], done: 0, total: 0 };
    const { $ } = SCA();
    if ($('stKnDone')) $('stKnDone').textContent = b.done;
    if ($('stKnTotal')) $('stKnTotal').textContent = b.total;
    if ($('stKnBar')) $('stKnBar').style.width = (b.total ? Math.round((b.done / b.total) * 100) : 0) + '%';
    const box = $('stBlocks');
    if (!box) return;
    box.innerHTML = b.items.map((i) => (
      '<button class="kn-setup-row ' + (i.done ? 'is-done' : '') + '" type="button" data-knto="' + esc(i.tab) + '" data-knkey="' + esc(i.key) + '">' +
        '<span class="kn-circle" aria-hidden="true">' + (i.done ? '✓' : '') + '</span>' +
        '<span class="kn-setup-label">' + esc(i.label) + '</span>' +
      '</button>'
    )).join('');
  }

  /** 语言：先是一排 chip，空的时候显示 No languages */
  function renderLangs(c) {
    const { $ } = SCA();
    const box = $('knLangList');
    if (!box) return;
    const langs = (c.languages || []).filter(Boolean);
    box.innerHTML = langs.length
      ? langs.map((l) => '<span class="lang-chip">' + esc(l) + '<button class="lang-x" type="button" data-lang="' + esc(l) + '" aria-label="移除 ' + esc(l) + '">✕</button></span>').join('')
      : '<span class="kn-empty">No languages</span>';
  }

  /** Target audiences：卡片列表（名字 + 说明 + 画像 + 目标/痛点） */
  function renderAudiences(c) {
    const { $ } = SCA();
    const box = $('audienceList');
    if (!box) return;
    const list = c.audiences || [];
    if (!list.length) {
      box.innerHTML = '<div class="kn-empty-block">还没有目标受众。点右上角「Add target audience」，按角色、行业、公司规模建一条 —— 助手判断"这段话写给谁"靠的就是它。</div>';
      return;
    }
    const tags = (arr) => (arr || []).map((x) => '<span class="tag">' + esc(x) + '</span>').join('');
    box.innerHTML = list.map((a) => {
      const meta = [];
      if ((a.industries || []).length) meta.push('<div class="entry-line"><span class="entry-k">Industries</span>' + tags(a.industries) + '</div>');
      if ((a.jobTitles || []).length) meta.push('<div class="entry-line"><span class="entry-k">Job titles</span>' + tags(a.jobTitles) + '</div>');
      if (a.companySize) meta.push('<div class="entry-line"><span class="entry-k">Company size</span><span class="tag">' + esc(a.companySize) + '</span></div>');
      if ((a.goals || []).length) meta.push('<div class="entry-line"><span class="entry-k">Goals</span>' + (a.goals || []).map((x) => '<span class="tag tag-ok">' + esc(x) + '</span>').join('') + '</div>');
      if ((a.painPoints || []).length) meta.push('<div class="entry-line"><span class="entry-k">Pain points</span>' + (a.painPoints || []).map((x) => '<span class="tag tag-bad">' + esc(x) + '</span>').join('') + '</div>');
      return '<div class="entry-card" data-aid="' + esc(a.id) + '">' +
        '<div class="entry-main">' +
          '<div class="entry-head"><strong>' + esc(a.name) + '</strong></div>' +
          '<p class="entry-desc' + (a.description ? '' : ' muted') + '">' + esc(a.description || '还没写说明') + '</p>' +
          (meta.length ? '<div class="entry-meta">' + meta.join('') + '</div>' : '') +
        '</div>' +
        '<div class="entry-act">' +
          '<button class="btn btn-small" type="button" data-aact="edit" data-aid="' + esc(a.id) + '">编辑</button>' +
          '<button class="btn btn-small btn-quiet" type="button" data-aact="del" data-aid="' + esc(a.id) + '">删除</button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  /** Content pillars：卡片列表（名字 + 说明 + 绑定的受众 + 搜索问题/主题/核心信息） */
  function renderPillars(c) {
    const { $ } = SCA();
    const box = $('pillarList');
    if (!box) return;
    const list = c.contentPillars || [];
    if (!list.length) {
      box.innerHTML = '<div class="kn-empty-block">还没有内容支柱。点右上角「Add content pillar」，把长期反复讲的主题建一条 —— 内容审计会拿它比对真实搜索词。</div>';
      return;
    }
    const byId = {};
    (c.audiences || []).forEach((a) => { byId[a.id] = a.name; });
    const tags = (arr, tone) => (arr || []).map((x) => '<span class="tag' + (tone ? ' tag-' + tone : '') + '">' + esc(x) + '</span>').join('');
    box.innerHTML = list.map((x) => {
      const meta = [];
      const auds = (x.audienceIds || []).map((id) => byId[id]).filter(Boolean);
      if (auds.length) meta.push('<div class="entry-line"><span class="entry-k">Audiences</span>' + tags(auds) + '</div>');
      if ((x.searchQuestions || []).length) meta.push('<div class="entry-line"><span class="entry-k">Search questions</span>' + tags(x.searchQuestions) + '</div>');
      if ((x.topicsInclude || []).length) meta.push('<div class="entry-line"><span class="entry-k">Topics to include</span>' + tags(x.topicsInclude, 'ok') + '</div>');
      if ((x.topicsAvoid || []).length) meta.push('<div class="entry-line"><span class="entry-k">Topics to avoid</span>' + tags(x.topicsAvoid, 'bad') + '</div>');
      if ((x.coreMessages || []).length) meta.push('<div class="entry-line"><span class="entry-k">Core messages</span>' + tags(x.coreMessages) + '</div>');
      return '<div class="entry-card" data-pid="' + esc(x.id) + '">' +
        '<div class="entry-main">' +
          '<div class="entry-head"><strong>' + esc(x.name) + '</strong></div>' +
          '<p class="entry-desc' + (x.description ? '' : ' muted') + '">' + esc(x.description || '还没写说明') + '</p>' +
          (meta.length ? '<div class="entry-meta">' + meta.join('') + '</div>' : '') +
        '</div>' +
        '<div class="entry-act">' +
          '<button class="btn btn-small" type="button" data-pact="edit" data-pid="' + esc(x.id) + '">编辑</button>' +
          '<button class="btn btn-small btn-quiet" type="button" data-pact="del" data-pid="' + esc(x.id) + '">删除</button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  /** Visual styles：卡片列表（名字 + Guidelines + 配色 + 参考图 / Logo 缩略） */
  function renderVisualStyles(c) {
    const { $ } = SCA();
    const box = $('visualList');
    if (!box) return;
    const list = (c.visualStyles || []).filter((v) => String(v.name || '').trim());
    if (!list.length) {
      box.innerHTML = '<div class="kn-empty-block">还没有视觉风格。点右上角「Add visual style」建一条 —— 配色、参考图、Logo 定下来，生成配图和封面时才不会跑偏。</div>';
      return;
    }
    const imgById = {};
    ((D.dash && D.dash.knowledge.images) || []).forEach((i) => { imgById[i.id] = i; });
    const swatch = (hex, label) => (hex
      ? '<span class="swatch"><i style="background:' + esc(hex) + '"></i>' + esc(label + ' ' + hex) + '</span>'
      : '');
    const thumbs = (ids) => {
      const u = (ids || []).map((id) => imgById[id]).filter(Boolean);
      return u.length ? '<span class="mini-thumbs">' + u.map((i) => '<img src="' + esc(i.url) + '" alt="' + esc(i.name) + '">').join('') + '</span>' : '';
    };
    box.innerHTML = list.map((v) => {
      const meta = [];
      const colors = [swatch(v.primaryColor, 'Primary'), swatch(v.secondaryColor, 'Secondary')].filter(Boolean).join('');
      if (colors) meta.push('<div class="entry-line"><span class="entry-k">Colors</span>' + colors + '</div>');
      const refs = thumbs(v.referenceIds);
      const logos = thumbs(v.logoIds);
      if (refs) meta.push('<div class="entry-line"><span class="entry-k">References</span>' + refs + '<span class="tag">' + (v.referenceIds || []).length + ' 张</span></div>');
      if (logos) meta.push('<div class="entry-line"><span class="entry-k">Logos</span>' + logos + '<span class="tag">' + (v.logoIds || []).length + ' 个</span></div>');
      return '<div class="entry-card" data-vsid="' + esc(v.id) + '">' +
        '<div class="entry-main">' +
          '<div class="entry-head"><strong>' + esc(v.name) + '</strong></div>' +
          (v.guidelines
            ? '<p class="entry-desc">' + esc(v.guidelines.length > 220 ? v.guidelines.slice(0, 220) + '…' : v.guidelines) + '</p>'
            : '<p class="entry-desc muted">还没写 Guidelines</p>') +
          (meta.length ? '<div class="entry-meta">' + meta.join('') + '</div>' : '') +
        '</div>' +
        '<div class="entry-act">' +
          '<button class="btn btn-small" type="button" data-vsact="edit" data-vsid="' + esc(v.id) + '">编辑</button>' +
          '<button class="btn btn-small btn-quiet" type="button" data-vsact="del" data-vsid="' + esc(v.id) + '">删除</button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  /** Writing styles：卡片列表（名字 + 开着的规则 + 备注） */
  function renderWritingStyles(c) {
    const { $ } = SCA();
    const box = $('writingList');
    if (!box) return;
    const list = (c.writingStyles || []).filter((w) => String(w.name || '').trim());
    if (!list.length) {
      box.innerHTML = '<div class="kn-empty-block">还没有写作规范。点右上角「Add writing style」建一条 —— 用开关定句式、标点和大小写，比写一段散文好使。</div>';
      return;
    }
    const groups = (D.dash && D.dash.knowledge && D.dash.knowledge.writingRules) || [];
    // 开着的规则 → 卡片上的短标签（下拉只在不选 No preference 时出现）
    const pillsFor = (w) => {
      const out = [];
      groups.forEach((g) => (g.rules || []).forEach((r) => {
        if (r.type === 'switch') {
          if (w[r.key]) out.push({ text: r.short || r.label, on: true });
          return;
        }
        const opt = (r.options || []).find((o) => o.id === w[r.key]);
        if (opt && opt.id !== 'none') out.push({ text: opt.label, on: true });
      }));
      return out;
    };
    box.innerHTML = list.map((w) => {
      const pills = pillsFor(w);
      const meta = [];
      if (pills.length) meta.push('<div class="entry-line"><span class="entry-k">Rules</span>' + pills.map((x) => '<span class="tag tag-ok">' + esc(x.text) + '</span>').join('') + '</div>');
      if (String(w.notes || '').trim()) meta.push('<div class="entry-line"><span class="entry-k">Notes</span><span class="entry-note">' + esc(w.notes) + '</span></div>');
      return '<div class="entry-card" data-wid="' + esc(w.id) + '">' +
        '<div class="entry-main">' +
          '<div class="entry-head"><strong>' + esc(w.name) + '</strong>' +
            '<span class="pill pill-neutral">' + pills.length + ' 条规则</span></div>' +
          (meta.length ? '<div class="entry-meta">' + meta.join('') + '</div>'
            : '<p class="entry-desc muted">还没开任何规则</p>') +
        '</div>' +
        '<div class="entry-act">' +
          '<button class="btn btn-small" type="button" data-wact="edit" data-wid="' + esc(w.id) + '">编辑</button>' +
          '<button class="btn btn-small btn-quiet" type="button" data-wact="del" data-wid="' + esc(w.id) + '">删除</button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  /** Brand voices：卡片列表（名字 + 用途 + 说明 + 片段数 + 编辑/删除） */
  function renderVoices(c) {
    const { $ } = SCA();
    const box = $('voiceList');
    if (!box) return;
    const vs = (c.brandVoices || []).filter((v) => String(v.name || '').trim());
    if (!vs.length) {
      box.innerHTML = '<div class="kn-empty-block">还没有 brand voice。点右上角「Add brand voice」加一条 —— 比如「直接、具体、不吹」。</div>';
      return;
    }
    box.innerHTML = vs.map((v) => (
      '<div class="voice-card" data-vid="' + esc(v.id) + '">' +
        '<div class="voice-main">' +
          '<div class="voice-head"><strong>' + esc(v.name) + '</strong>' +
            '<span class="pill pill-neutral">' + esc(VOICE_USE[v.useCase] || v.useCase || 'General') + '</span>' +
            (v.excerpts && v.excerpts.length ? '<span class="pill pill-neutral">' + v.excerpts.length + ' 个示例</span>' : '') +
          '</div>' +
          (v.description ? '<p class="voice-desc">' + esc(v.description) + '</p>' : '<p class="voice-desc muted">还没写说明</p>') +
        '</div>' +
        '<div class="voice-act">' +
          '<button class="btn btn-small" type="button" data-vact="edit" data-vid="' + esc(v.id) + '">编辑</button>' +
          '<button class="btn btn-small btn-quiet" type="button" data-vact="del" data-vid="' + esc(v.id) + '">删除</button>' +
        '</div>' +
      '</div>'
    )).join('');
  }

  /** 打开某个 tab（Overview / General / …） */
  function setKnTab(name) {
    const tab = KN_TABS.includes(name) ? name : 'overview';
    KN.tab = tab;
    document.querySelectorAll('.kn-tab').forEach((b) => b.classList.toggle('is-on', b.dataset.kntab === tab));
    document.querySelectorAll('.kn-pane').forEach((pn) => pn.classList.toggle('hidden', pn.dataset.knpane !== tab));
  }

  function renderKnowledge(d) {
    const { $ } = SCA();
    const c = d.knowledge.company;
    $('knName').value = c.name || '';
    $('knWebsite').value = c.website || '';
    $('knDescription').value = c.description || '';
    $('knCustom').value = c.customInstructions || '';
    $('knCompetitors').value = (c.competitors || []).join('\n');
    $('knProof').value = (c.proofPoints || []).join('\n');

    renderSetup(d);
    renderLangs(c);
    renderVoices(c);
    renderAudiences(c);
    renderPillars(c);
    renderVisualStyles(c);
    renderWritingStyles(c);
    renderKnFiles(d);
    setKnTab(KN.tab);

    // General 里的 GSC 那一块：状态跟 Content audit 同一个来源
    const st = d.gscStatus || {};
    const g = d.knowledge.gsc || {};
    if ($('knGscState')) {
      const label = g.connected ? '已接入' + (st.site ? ' ' + st.site : '') : st.authorized ? '已授权 · 待同步' : st.configured ? '凭据已存' : '未接入';
      $('knGscState').textContent = label;
      $('knGscState').className = 'pill ' + (g.connected ? 'pill-ok' : st.configured ? 'pill-warn' : 'pill-neutral');
    }
    if ($('btnKnGsc')) $('btnKnGsc').textContent = g.connected ? 'Manage Google Search Console' : 'Connect Google Search Console';
    if ($('btnKnGsc')) $('btnKnGsc').onclick = () => {
      // 只做"带你去正确的地方"：GSC 的实现在 Content audit 里，这里不复制第二套
      const go = () => {
        SCA().setNav('strategy');
        const t = document.querySelector('.st-item[data-st="audit"]');
        if (t) t.click();
        setTimeout(() => { const b = document.getElementById('stGscSetup'); if (b) b.click(); }, 420);
      };
      go();
      toast(g.connected ? 'Search Console 已经连着，可以在这里同步或断开' : '在 Content audit 里完成授权，回来后这里会显示状态');
    };

    const p7 = progress7(d);
    $('knProgress').textContent = `${p7.done} of ${p7.total} complete`;
    $('btnStartSetup').textContent = p7.done === 0 ? 'Start setup' : p7.done >= p7.total ? 'Review' : 'Continue setup';

    const cp = d.knowledge.completeness;
    const pct = $('knPct');
    pct.textContent = cp.pct + '%';
    pct.className = 'pill ' + (cp.pct === 100 ? 'pill-ok' : cp.pct >= 50 ? 'pill-warn' : 'pill-bad');
    $('knMissing').textContent = cp.missing.length ? '还缺：' + cp.missing.join('、') : '资料齐了。';
    if (D.panel === 'company') setPanelPill(`<span class="pill ${cp.pct === 100 ? 'pill-ok' : 'pill-neutral'}">${p7.done} of ${p7.total} complete</span>`);
  }

  /* ---- 2. Search Console ---- */
  function renderGsc(d) {
    const { $ } = SCA();
    const g = d.knowledge.gsc;
    const st = d.gscStatus || {};
    $('gscSite').value = g.site || st.site || '';
    $('gscNote').value = g.note || '';
    const pill = $('gscPill');
    const label = g.connected
      ? '已接入 ' + (st.site || g.site || '')
      : st.authorized ? '已授权 · 待同步'
        : st.configured ? '凭据已存 · 未授权' : '未接入';
    pill.textContent = label;
    pill.className = 'pill ' + (g.connected ? 'pill-ok' : st.configured ? 'pill-warn' : 'pill-neutral');
    $('btnSetupGsc').classList.toggle('hidden', !!st.configured);
    $('btnAuthorizeGsc').classList.toggle('hidden', !st.configured || !!st.authorized);
    $('btnSyncGsc').classList.toggle('hidden', !st.authorized);
    $('btnDisconnectGsc').disabled = !st.configured && !st.authorized;
    if ($('gscHint')) {
      $('gscHint').textContent = st.authorized
        ? '已授权，点「同步最近 28 天」把真实搜索词拉下来；机会清单在 Strategy → Content audit。'
        : st.configured
          ? '凭据已存，下一步用 Google 账号授权（跳 accounts.google.com，只读权限）。'
          : '用你自己的 Google Cloud 凭据授权（只读 scope），数据和账号都在你手里。三步引导和回调地址在 Strategy → Content audit。';
    }
    const card = $('btnConnectGscCard');
    card.textContent = g.connected ? 'Connected' : 'Connect';
    card.className = 'btn btn-small' + (g.connected ? '' : ' btn-primary');
    if (D.panel === 'gsc') setPanelPill(`<span class="pill ${g.connected ? 'pill-ok' : 'pill-neutral'}">${g.connected ? '已接入 ' + esc(g.site || '') : '未接入'}</span>`);
  }

  /* ---- 3. 插件（应用目录） ---- */
  function appLogo(t, size) {
    const px = size || 36;
    return `<span class="app-logo" style="background:${t.tint || '#e2e8f0'};color:${t.color || '#334155'}" aria-hidden="true">
      <svg viewBox="0 0 32 32" width="${px}" height="${px}"><text x="16" y="21" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor" font-family="Inter,system-ui,sans-serif">${esc(t.mono || t.name.slice(0, 2))}</text></svg>
    </span>`;
  }
  window.SCA_APP_LOGO = appLogo;

  function renderTools(d) {
    const { $ } = SCA();
    const list = d.knowledge.tools;
    const n = list.filter((t) => t.connected).length;
    $('toolsPill').textContent = n + ' 个已授权';
    $('toolsPill').className = 'pill ' + (n ? 'pill-ok' : 'pill-neutral');
    $('toolsMeta').textContent = n ? `${n} of ${list.length} connected` : `${list.length} available`;
    $('toolList').innerHTML = list
      .map((t) => {
        const act = !t.installed
          ? '<button class="btn btn-small" data-act="install" data-tid="' + t.id + '">安装</button>'
          : !t.connected
            // 装完还没授权时，自定义应用要能直接删掉（否则只能授权，卡死）
            ? '<button class="btn btn-small btn-primary" data-act="authorize" data-tid="' + t.id + '">授权</button>'
              + (t.custom ? '<button class="btn btn-small btn-quiet" data-act="uninstall" data-tid="' + t.id + '">移除</button>' : '')
            : '<button class="btn btn-small" data-act="manage" data-tid="' + t.id + '">管理</button>';
        const meta = t.connected
          ? `<div class="app-meta"><span class="pill pill-ok">已授权</span>${t.account ? `<span class="muted small">${esc(t.account)}</span>` : ''}${t.hasData ? `<span class="muted small">已贴 ${t.dataChars} 字</span>` : ''}</div>`
          : `<div class="app-meta">${t.installed ? '<span class="pill pill-warn">已安装 · 待授权</span>' : '<span class="muted small">未安装</span>'}</div>`;
        return `<div class="app-cell" data-tid="${t.id}">
          <div class="app-card ${t.installed ? 'is-on' : ''}">
            ${appLogo(t, 36)}
            <div class="app-main">
              <div class="app-name">${esc(t.name)}${t.custom ? '<em class="app-tag">自定义</em>' : ''}</div>
              <div class="app-desc">${esc(t.desc || t.url || '—')}</div>
              ${meta}
            </div>
            <div class="app-act">${act}</div>
          </div>
          <div class="app-drawer hidden" data-drawer="${t.id}">
            <textarea rows="3" data-input="${t.id}" placeholder="把导出的 CSV / 关键指标贴进来，agent 会读（例如：广告花费、线索数、渠道转化）">${t.hasData ? '' : ''}</textarea>
            <div class="row wrap">
              <button class="btn btn-small btn-primary" data-act="savedata" data-tid="${t.id}">保存数据</button>
              <button class="btn btn-small btn-quiet" data-act="disconnect" data-tid="${t.id}">撤销授权</button>
              <button class="btn btn-small btn-quiet" data-act="uninstall" data-tid="${t.id}">${t.custom ? '移除' : '卸载'}</button>
            </div>
          </div>
        </div>`;
      })
      .join('');
    if (D.panel === 'tools') setPanelPill(`<span class="pill ${n ? 'pill-ok' : 'pill-neutral'}">${n} / ${list.length} 已授权</span>`);
  }

  /** 只刷新应用列表（不动公司知识的输入框，避免把正在打字的字冲掉） */
  async function refreshTools() {
    try {
      const d = await api('/api/dashboard');
      D.dash = d;
      renderTools(d);
      if (window.refreshStrategyTools) window.refreshStrategyTools();
    } catch (e) { toast(e.message, true); }
  }

  /* ---- 授权弹窗 ---- */
  let toolEditing = null;
  function openToolModal(t) {
    const { $ } = SCA();
    toolEditing = t;
    $('toolModalLogo').outerHTML = appLogo(t, 40).replace('class="app-logo"', 'class="app-logo" id="toolModalLogo"');
    $('toolModalName').textContent = t.name;
    $('toolModalDesc').textContent = [t.category, t.desc].filter(Boolean).join(' · ');
    $('toolModalWhy').textContent = `${t.name} 没有开放给第三方直接登录（要它自己的开发者应用 + 审核），所以这里让你把凭据存在本机：授权后 agent 做判断时会读这些数据，不会上传到任何地方。`;
    $('toolAccount').value = t.account || '';
    $('toolToken').value = '';
    $('toolToken').placeholder = t.hasToken ? '已存 ' + t.keyHint + '（留空 = 不改）' : '粘贴后不回显';
    $('toolData').value = '';
    $('toolSkipToken').checked = false;
    $('toolErr').textContent = '';
    $('toolToken').disabled = false;
    $('toolModal').classList.remove('hidden');
    setTimeout(() => $('toolAccount').focus(), 30);
  }
  function closeToolModal() { SCA().$('toolModal').classList.add('hidden'); toolEditing = null; }
  window.SCA_CLOSE_TOOL_MODAL = closeToolModal;

  /* ---- 4. 知识文件 ---- */
  function renderFiles(d) {
    const { $ } = SCA();
    const files = d.knowledge.files;
    $('filesPill').textContent = files.length + ' 个文件';
    $('filesPill').className = 'pill ' + (files.length ? 'pill-ok' : 'pill-neutral');
    $('filesMeta').textContent = files.length ? `${files.length} file${files.length > 1 ? 's' : ''}` : '0 files';
    $('fileList').innerHTML = files.length
      ? files
          .map((f) => `<div class="file-row" data-fid="${f.id}">
            <span class="file-name" title="${esc(f.name)}">${esc(f.name)}</span>
            <span class="muted small">${f.chars} 字</span>
            <button class="btn btn-icon btn-quiet" data-act="delfile" data-fid="${f.id}" aria-label="删除">✕</button>
          </div>`)
          .join('')
      : '<p class="muted small">还没有文件。产品介绍、定价页、白皮书都可以，纯文本类即可。</p>';
    if (D.panel === 'files') setPanelPill(`<span class="pill ${files.length ? 'pill-ok' : 'pill-neutral'}">${files.length} 个文件</span>`);
  }

  /* ---- Knowledge files（公司知识里的独立文件页） ---- */
  function renderKnFiles(d) {
    const { $ } = SCA();
    const box = $('knFileList');
    if (!box) return;
    const files = d.knowledge.files || [];
    const empty = $('knFilesEmpty');
    const meta = $('knFilesMeta');
    if (meta) meta.textContent = files.length ? files.length + ' file' + (files.length > 1 ? 's' : '') : '0 files';
    if (empty) empty.classList.toggle('hidden', files.length > 0);
    box.innerHTML = files.map((f) => '<div class="kn-file-row" data-kfid="' + esc(f.id) + '">' +
        '<div class="kn-file-main">' +
          '<span class="kn-file-name" title="' + esc(f.name) + '">' + esc(f.name) + '</span>' +
          '<span class="kn-file-meta">' + f.chars + ' 字 · ' + esc(String(f.uploadedAt || '').slice(0, 10)) + '</span>' +
        '</div>' +
        '<div class="kn-file-act">' +
          '<button class="btn btn-small btn-quiet" type="button" data-act="viewfile" data-fid="' + esc(f.id) + '">查看</button>' +
          '<button class="btn btn-small btn-quiet" type="button" data-act="delfile" data-fid="' + esc(f.id) + '">删除</button>' +
        '</div>' +
      '</div>').join('');
    // 搜索状态要跟着重画走：搜索框有内容就重新搜一次
    const q = $('knFileSearch') ? $('knFileSearch').value.trim() : '';
    if (q) runFileSearch(q);
  }

  let fileSearchTimer = null;
  async function runFileSearch(q) {
    const { $ } = SCA();
    const hitsBox = $('knFileHits');
    const listBox = $('knFileList');
    const empty = $('knFilesEmpty');
    if (!hitsBox) return;
    if (!q) {
      hitsBox.classList.add('hidden');
      hitsBox.innerHTML = '';
      if (listBox) listBox.classList.remove('hidden');
      if (empty && !(D.dash && D.dash.knowledge.files.length)) empty.classList.remove('hidden');
      return;
    }
    try {
      const r = await api('/api/knowledge/files/search?q=' + encodeURIComponent(q));
      if (listBox) listBox.classList.add('hidden');
      if (empty) empty.classList.add('hidden');
      hitsBox.classList.remove('hidden');
      hitsBox.innerHTML = (r.hits || []).length
        ? (r.hits || []).map((h) => '<div class="kn-file-row" data-kfid="' + esc(h.id) + '">' +
            '<div class="kn-file-main">' +
              '<span class="kn-file-name">' + esc(h.name) + '</span>' +
              '<span class="kn-file-hit">' + esc(h.snippet || '（只在文件名里命中）') + '</span>' +
            '</div>' +
            '<div class="kn-file-act"><button class="btn btn-small btn-quiet" type="button" data-act="viewfile" data-fid="' + esc(h.id) + '">查看</button></div>' +
          '</div>').join('')
        : '<div class="kn-empty-block">没有文件命中「' + esc(q) + '」。试试更短的关键词。</div>';
    } catch (e) {
      hitsBox.classList.remove('hidden');
      hitsBox.innerHTML = '<div class="kn-empty-block">' + esc(e.message) + '</div>';
    }
  }

  /* ---- 快捷指令 ---- */
  function renderQuick() {
    const { $ } = SCA();
    $('chatQuick').innerHTML = QUICK
      .map(([label, prompt]) => `<button class="quick" data-q="${esc(prompt)}">${esc(label)}</button>`)
      .join('');
  }

  /* ---- 详情面板 ---- */
  function openPanel(key, silent) {
    const { $ } = SCA();
    if (!PANELS[key]) return;
    D.panel = key;
    $('setupCards').classList.add('hidden');
    const panel = $('setupPanel');
    panel.classList.remove('hidden');
    // 这一块的表单可能被 Strategy 借走了（同一份 DOM），先拿回来
    if (window.SCA.mountSection) window.SCA.mountSection(key, '#spBody');
    $('spTitle').textContent = PANELS[key].title;
    $('spSub').textContent = PANELS[key].sub;
    panel.querySelectorAll('[data-section]').forEach((el) => el.classList.toggle('hidden', el.dataset.section !== key));
    if (D.dash) {
      if (key === 'company') renderKnowledge(D.dash);
      if (key === 'gsc') renderGsc(D.dash);
      if (key === 'tools') renderTools(D.dash);
      if (key === 'files') renderFiles(D.dash);
    }
    if (!silent) panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function closePanel() {
    const { $ } = SCA();
    D.panel = null;
    $('setupPanel').classList.add('hidden');
    $('setupCards').classList.remove('hidden');
  }

  function setPanelPill(html) {
    const el = SCA().$('spPill');
    if (el) el.outerHTML = html.replace(/^<span class="pill/, '<span id="spPill" class="pill');
  }

  /* ---- 对话 ---- */
  async function loadChat() {
    const { api, $ } = SCA();
    if (!D.chatId) {
      D.chat = null;
      $('chatMessages').innerHTML = '';
      return;
    }
    try {
      const r = await api('/api/chats/' + D.chatId);
      D.chat = r.chat;
    } catch (_) {
      D.chatId = null;
      D.chat = null;
      $('chatMessages').innerHTML = '';
      return;
    }
    const box = $('chatMessages');
    box.innerHTML = window.ChatUI.messagesHtml(D.chat);
    box.scrollTop = box.scrollHeight;
  }

  function renderChatList(d) {
    const { $ } = SCA();
    $('chatList').innerHTML = d.chats.length
      ? d.chats
          .map((c) => `<div class="chat-row ${c.id === D.chatId ? 'is-active' : ''}" data-cid="${c.id}" role="button" tabindex="0">
            <div class="chat-row-main">
              <span class="chat-title">${esc(c.title)}</span>
              <span class="chat-meta muted small">${c.messages} 条 · ${String(c.updatedAt || '').slice(5, 10)}</span>
            </div>
            <button class="btn btn-icon btn-quiet" data-act="delchat" data-cid="${c.id}" aria-label="删除对话">✕</button>
          </div>`)
          .join('')
      : '<p class="muted small">还没有历史对话。</p>';
  }

  /* ==================== 动作 ==================== */

  async function sendChat(text) {
    const { api, $, toast, loadState } = SCA();
    const t = String(text || '').trim();
    if (!t || D.sending) return;
    D.sending = true;
    const btn = $('btnSendChat');
    btn.disabled = true;
    $('chatText').value = '';
    autosize();
    try {
      const r = await api('/api/agent/chat', { method: 'POST', body: { chatId: D.chatId, text: t } });
      D.chatId = r.chatId;
      if (r.executed && r.executed.some((a) => a.ok)) await loadState(true);
      await renderDashboard();
      const okN = (r.executed || []).filter((a) => a.ok).length;
      if (okN) toast(`已完成 ${okN} 个动作`);
      else if (r.degraded) toast('未接模型，已用离线模板：' + String(r.degraded).slice(0, 60), true);
    } catch (e) {
      toast('发送失败：' + e.message, true);
    } finally {
      D.sending = false;
      btn.disabled = false;
    }
  }

  async function newChat() {
    const { api, $ } = SCA();
    const r = await api('/api/chats', { method: 'POST', body: {} });
    D.chatId = r.chat.id;
    await renderDashboard();
    $('chatText').focus();
  }

  function autosize() {
    const el = SCA().$('chatText');
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 180) + 'px';
  }

  /* ==================== 事件 ==================== */

  function bindDashboard() {
    const { api, $, toast, loadState } = SCA();

    /* --- 四张卡 → 详情（点整张卡也能进，和参考图一致） --- */
    document.querySelectorAll('#setupCards .setup-card').forEach((c) => {
      c.addEventListener('click', (e) => {
        if (e.target.closest('.btn')) return;   // 按钮自己有处理
        openPanel(c.dataset.panel);
      });
    });
    document.querySelectorAll('[data-open]').forEach((b) => {
      b.addEventListener('click', (e) => {
        const k = b.dataset.open;
        if (k === 'files') { e.preventDefault(); $('fileInput').click(); }
        openPanel(k);
      });
    });
    $('btnBackSetup').onclick = () => closePanel();

    /* --- provider 弹窗 --- */
    $('btnProviders').onclick = () => {
      $('providerModal').classList.remove('hidden');
      renderDashboard().catch(() => {});
    };
    $('btnCloseProviders').onclick = () => {
      $('providerModal').classList.add('hidden');
      D.providerOpen = false;
      $('providerForm').classList.add('hidden');
    };

    function syncModelSelect() {
      const list = $('pvModels').value.split('\n').map((s) => s.trim()).filter(Boolean);
      const cur = $('pvModel').value;
      $('pvModel').innerHTML = list.length
        ? list.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join('')
        : '<option value="">（先填模型名）</option>';
      if (list.includes(cur)) $('pvModel').value = cur;
    }

    $('btnAddProvider').onclick = () => {
      D.providerOpen = !D.providerOpen;
      $('providerForm').classList.toggle('hidden', !D.providerOpen);
      if (D.providerOpen) {
        $('pvErr').textContent = '';
        $('pvName').value = '';
        $('pvBase').value = '';
        $('pvKey').value = '';
        $('pvModels').value = '';
        const kinds = (D.dash && D.dash.providers.kinds) || [{ id: 'openai', label: 'OpenAI 兼容' }, { id: 'anthropic', label: 'Anthropic 兼容' }];
        $('pvKind').innerHTML = kinds.map((k) => `<option value="${k.id}">${esc(k.label)}</option>`).join('');
        syncModelSelect();
        $('pvName').focus();
      }
    };
    $('btnCancelProvider').onclick = () => {
      D.providerOpen = false;
      $('providerForm').classList.add('hidden');
    };
    $('pvModels').oninput = syncModelSelect;

    $('providerForm').onsubmit = async (e) => {
      e.preventDefault();
      const models = $('pvModels').value.split('\n').map((s) => s.trim()).filter(Boolean);
      const body = {
        name: $('pvName').value.trim() || '未命名 provider',
        kind: $('pvKind').value,
        baseUrl: $('pvBase').value.trim(),
        apiKey: $('pvKey').value.trim(),
        models,
        model: $('pvModel').value || models[0] || ''
      };
      if (!body.baseUrl) { $('pvErr').textContent = 'Base URL 不能为空'; return; }
      try {
        await api('/api/providers', { method: 'POST', body });
        D.providerOpen = false;
        $('providerForm').classList.add('hidden');
        await renderDashboard();
        toast('已接入 ' + body.name);
      } catch (err) {
        $('pvErr').textContent = err.message;
      }
    };

    $('providerList').addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const id = btn.dataset.pid;
      const act = btn.dataset.act;
      try {
        if (act === 'use') {
          await api('/api/providers/active', { method: 'POST', body: { id } });
          await renderDashboard();
          toast('已设为默认模型');
        } else if (act === 'test') {
          btn.disabled = true;
          btn.textContent = '测试中…';
          const r = await api(`/api/providers/${id}/test`, { method: 'POST' });
          await renderDashboard();
          toast(r.test.ok ? `连通，${r.test.ms}ms` : '不通：' + String(r.test.error || '').slice(0, 90), !r.test.ok);
        } else if (act === 'models') {
          btn.disabled = true;
          const r = await api(`/api/providers/${id}/models`, { method: 'POST' });
          await renderDashboard();
          toast(r.error ? '拉取失败：' + String(r.error).slice(0, 90) : `拉到 ${r.fetched} 个模型`, !!r.error);
        } else if (act === 'del') {
          if (!confirm('删除这个 provider？key 也会一起删掉。')) return;
          await api('/api/providers/' + id, { method: 'DELETE' });
          await renderDashboard();
          toast('已删除');
        }
      } catch (err) {
        toast(err.message, true);
      }
    });

    $('providerList').addEventListener('change', async (e) => {
      const sel = e.target.closest('[data-act="model"]');
      if (!sel) return;
      try {
        await api('/api/providers/' + sel.dataset.pid, { method: 'PATCH', body: { model: sel.value } });
        await renderDashboard();
        toast('默认模型：' + sel.value);
      } catch (err) {
        toast(err.message, true);
      }
    });

    /* --- 公司知识 --- */
    $('btnSaveKnowledge').onclick = async () => {
      const body = {
        company: {
          name: $('knName').value.trim(),
          website: $('knWebsite').value.trim(),
          description: $('knDescription').value,
          customInstructions: $('knCustom').value,
          competitors: $('knCompetitors').value,
          proofPoints: $('knProof').value
        }
      };
      try {
        await api('/api/knowledge', { method: 'POST', body });
        await renderDashboard();
        if (window.refreshStrategyKnowledge) window.refreshStrategyKnowledge();
        toast('Company knowledge 已保存');
      } catch (e) { toast(e.message, true); }
    };

    /* --- Company knowledge 的 tab 切换 --- */
    document.querySelectorAll('.kn-tab').forEach((b) => {
      b.onclick = () => setKnTab(b.dataset.kntab);
    });
    // Overview 的清单：点一项 → 跳到对应 tab 并聚焦那个输入框
    if ($('stBlocks')) {
      $('stBlocks').addEventListener('click', (e) => {
        const row = e.target.closest('[data-knto]');
        if (!row) return;
        setKnTab(row.dataset.knto);
        const KEY_INPUT = {
          website: 'knWebsite', description: 'knDescription', brandVoices: 'btnAddVoice',
          visualStyle: 'btnAddVisual', gsc: 'btnKnGsc', audiences: 'btnAddAudience',
          writingStyle: 'btnAddWriting', competitors: 'knCompetitors',
          contentPillars: 'btnAddPillar', files: 'btnKnUpload'
        };
        const el = $(KEY_INPUT[row.dataset.knkey]);
        if (!el) return;
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        const block = el.closest('.kn-block');
        if (block) { block.classList.add('is-flash'); setTimeout(() => block.classList.remove('is-flash'), 900); }
        if (el.focus) setTimeout(() => el.focus(), 260);
      });
    }

    /* --- Languages --- */
    const addLang = async () => {
      const v = $('knLangInput').value.trim();
      if (!v) { toast('先填一个语言', true); return; }
      const cur = ((D.dash && D.dash.knowledge.company.languages) || []).slice();
      if (cur.includes(v)) { toast('已经有这个语言了', true); return; }
      cur.push(v);
      try {
        await api('/api/knowledge', { method: 'POST', body: { company: { languages: cur } } });
        $('knLangInput').value = '';
        await renderDashboard();
        toast('已添加：' + v);
      } catch (e) { toast(e.message, true); }
    };
    if ($('btnAddLanguage')) $('btnAddLanguage').onclick = addLang;
    if ($('knLangInput')) {
      $('knLangInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addLang(); } });
    }
    if ($('knLangList')) {
      $('knLangList').addEventListener('click', async (e) => {
        const b = e.target.closest('[data-lang]');
        if (!b) return;
        const cur = ((D.dash && D.dash.knowledge.company.languages) || []).filter((x) => x !== b.dataset.lang);
        try {
          await api('/api/knowledge', { method: 'POST', body: { company: { languages: cur } } });
          await renderDashboard();
        } catch (err) { toast(err.message, true); }
      });
    }

    /* ================= 结构化条目的行编辑器（受众 / 支柱 / 语气共用） ================= */

    const ROW_ICONS = {
      industry: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2" y="5" width="12" height="9" rx="2"/><path d="M6 5V3.5h4V5"/></svg>',
      user: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="5.5" r="2.5"/><path d="M3 14c.7-2.6 2.6-4 5-4s4.3 1.4 5 4"/></svg>',
      goal: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 8.5l3 3 7-7"/></svg>',
      pain: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M8 2.5l6 11H2l6-11z"/><path d="M8 6.5v3.2M8 11.6v.6"/></svg>',
      search: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="4.2"/><path d="M10.2 10.2L14 14"/></svg>',
      include: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 8.5l3 3 7-7"/></svg>',
      avoid: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
      message: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M4 2h5l3 3v9H4z"/><path d="M9 2v3h3"/></svg>',
      quote: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 4c-2 1.2-3 3-3 5.4V12h3.4V8.6H4.6C4.6 6.8 5.2 5.6 6.4 5"/><path d="M13 4c-2 1.2-3 3-3 5.4V12h3.4V8.6h-1.8c0-1.8.6-3 1.8-3.6"/></svg>'
    };
    const ROW_SPEC = {
      industries: { icon: 'industry', ph: 'Ex. SaaS, Developer tools' },
      jobTitles: { icon: 'user', ph: 'Ex. Head of Content' },
      goals: { icon: 'goal', tone: 'ok', ph: 'Ex. Publish more consistently' },
      painPoints: { icon: 'pain', tone: 'bad', ph: 'Ex. No time to adapt one post to seven channels' },
      searchQuestions: { icon: 'search', ph: 'Ex. how to structure hreflang tags' },
      topicsInclude: { icon: 'include', tone: 'ok', ph: 'Ex. crawl budget' },
      topicsAvoid: { icon: 'avoid', tone: 'bad', ph: 'Ex. link buying' },
      coreMessages: { icon: 'message', ph: 'Ex. one source, seven channels' },
      excerpts: { icon: 'quote', ph: 'Paste 1-2 sentences that sound like this brand.' }
    };

    function addRow(boxId, kind, value) {
      const { $ } = SCA();
      const box = $(boxId);
      if (!box) return;
      const spec = ROW_SPEC[kind] || { icon: 'message', ph: '' };
      const row = document.createElement('div');
      row.className = 'row-item' + (spec.tone ? ' row-' + spec.tone : '');
      row.dataset.kind = kind;
      row.innerHTML = '<span class="row-ico">' + (ROW_ICONS[spec.icon] || ROW_ICONS.message) + '</span>' +
        '<input class="row-input" placeholder="' + esc(spec.ph) + '" />' +
        '<button class="row-x" type="button" aria-label="删除这条">✕</button>';
      row.querySelector('.row-input').value = value || '';
      row.querySelector('.row-x').onclick = () => {
        row.remove();
        if (!box.querySelector('.row-item')) addRow(boxId, kind, '');
      };
      box.appendChild(row);
      return row;
    }

    const readRows = (boxId) => {
      const { $ } = SCA();
      const box = $(boxId);
      return box ? [...box.querySelectorAll('.row-input')].map((i) => i.value.trim()).filter(Boolean) : [];
    };

    /** 回填：至少留一个空行，方便直接开始写 */
    function fillRows(boxId, kind, values) {
      const { $ } = SCA();
      const box = $(boxId);
      if (!box) return;
      box.innerHTML = '';
      const list = (values && values.length) ? values : [''];
      list.forEach((v) => addRow(boxId, kind, v));
    }

    /** 回车 = 再加一行，连着敲不用找按钮 */
    function rowsEnter(boxId, kind) {
      const { $ } = SCA();
      const box = $(boxId);
      if (!box) return;
      box.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.classList.contains('row-input')) {
          e.preventDefault();
          addRow(boxId, kind, '').querySelector('.row-input').focus();
        }
      });
    }

    ['taIndustries|industries', 'taJobTitles|jobTitles', 'taGoals|goals', 'taPains|painPoints',
      'cpQuestions|searchQuestions', 'cpTopicsIn|topicsInclude', 'cpTopicsOut|topicsAvoid',
      'cpMessages|coreMessages', 'vExcerpts|excerpts'].forEach((pair) => {
      const [box, kind] = pair.split('|');
      rowsEnter(box, kind);
    });

    /* ================= Target audiences 弹窗 ================= */

    function fillSizes(c) {
      const el = document.getElementById('companySizeList');
      if (!el) return;
      el.innerHTML = (c.companySizes || ['1-10', '11-50', '51-200', '201-500', '501-1000', '1000+'])
        .map((x) => '<option value="' + esc(x) + '"></option>').join('');
    }

    function openAudience(a0) {
      TA.editing = a0 || null;
      $('audienceModalTitle').textContent = a0 ? 'Edit Target Audience' : 'Create Target Audience';
      $('btnAudienceSave').textContent = a0 ? 'Save' : 'Create';
      $('taName').value = a0 ? a0.name : '';
      $('taDesc').value = a0 ? a0.description : '';
      $('taSize').value = (a0 && a0.companySize) || '';
      fillRows('taIndustries', 'industries', a0 && a0.industries);
      fillRows('taJobTitles', 'jobTitles', a0 && a0.jobTitles);
      fillRows('taGoals', 'goals', a0 && a0.goals);
      fillRows('taPains', 'painPoints', a0 && a0.painPoints);
      $('taErr').textContent = '';
      fillSizes(D.dash && D.dash.knowledge && D.dash.knowledge.company);
      $('audienceModal').classList.remove('hidden');
      setTimeout(() => $('taName').focus(), 60);
    }
    const closeAudience = () => $('audienceModal').classList.add('hidden');

    $('btnAddAudience').onclick = () => openAudience(null);
    $('btnCloseAudienceModal').onclick = closeAudience;
    $('btnAudienceCancel').onclick = closeAudience;
    ['btnAddIndustry|industries|taIndustries', 'btnAddJobTitle|jobTitles|taJobTitles',
      'btnAddGoal|goals|taGoals', 'btnAddPain|painPoints|taPains'].forEach((t) => {
      const [btn, kind, box] = t.split('|');
      $(btn).onclick = () => addRow(box, kind, '').querySelector('.row-input').focus();
    });
    $('btnAudienceSave').onclick = async () => {
      const name = $('taName').value.trim();
      const description = $('taDesc').value.trim();
      if (!name) { $('taErr').textContent = 'Audience name 必填，比如「Growth marketers at Series B SaaS」。'; $('taName').focus(); return; }
      if (!description) { $('taErr').textContent = 'Description 必填 —— 一句话说明这个受众，助手才知道什么时候该用它。'; $('taDesc').focus(); return; }
      const body = {
        name, description,
        companySize: $('taSize').value.trim(),
        industries: readRows('taIndustries'),
        jobTitles: readRows('taJobTitles'),
        goals: readRows('taGoals'),
        painPoints: readRows('taPains')
      };
      if (TA.editing && TA.editing.id) body.id = TA.editing.id;
      try {
        $('btnAudienceSave').disabled = true;
        await api('/api/knowledge/audience', { method: 'POST', body });
        closeAudience();
        await renderDashboard();
        if (window.refreshStrategyKnowledge) window.refreshStrategyKnowledge();
        toast((body.id ? '受众已更新：' : '受众已添加：') + name);
      } catch (e) {
        $('taErr').textContent = e.message;
      } finally {
        $('btnAudienceSave').disabled = false;
      }
    };
    $('audienceList').addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-aact]');
      if (!btn) return;
      const list = ((D.dash && D.dash.knowledge.company.audiences) || []);
      const a0 = list.find((x) => x.id === btn.dataset.aid);
      if (!a0) return;
      if (btn.dataset.aact === 'edit') { openAudience(a0); return; }
      if (!window.confirm('删除这个目标受众？内容支柱里对它的绑定也会一起解掉。')) return;
      try {
        await api('/api/knowledge/audience/' + encodeURIComponent(a0.id), { method: 'DELETE' });
        await renderDashboard();
        if (window.refreshStrategyKnowledge) window.refreshStrategyKnowledge();
        toast('已删除');
      } catch (err) { toast(err.message, true); }
    });

    /* ================= Content pillars 弹窗 ================= */

    function fillAudPicker(selected) {
      const sel = $('cpAudPick');
      const list = ((D.dash && D.dash.knowledge.company.audiences) || []);
      sel.innerHTML = '<option value="">Select audiences this pillar is for...</option>' +
        list.filter((a0) => !(selected || []).includes(a0.id))
          .map((a0) => '<option value="' + esc(a0.id) + '">' + esc(a0.name) + '</option>').join('');
    }
    function renderAudChips(ids) {
      const box = $('cpAudChips');
      const list = ((D.dash && D.dash.knowledge.company.audiences) || []);
      const picked = (ids || []).map((id) => list.find((a0) => a0.id === id)).filter(Boolean);
      box.innerHTML = picked.length
        ? picked.map((a0) => '<span class="tag">' + esc(a0.name) + '<button class="tag-x" type="button" data-aid="' + esc(a0.id) + '" aria-label="移除">✕</button></span>').join('')
        : '<span class="kn-empty">还没有绑定受众</span>';
      box.dataset.ids = JSON.stringify((ids || []));
    }
    const pillarAudIds = () => {
      try { return JSON.parse($('cpAudChips').dataset.ids || '[]'); } catch (e) { return []; }
    };

    function openPillar(x) {
      CP.editing = x || null;
      $('pillarModalTitle').textContent = x ? 'Edit Content Pillar' : 'Create Content Pillar';
      $('btnPillarSave').textContent = x ? 'Save' : 'Create';
      $('cpName').value = x ? x.name : '';
      $('cpDesc').value = x ? x.description : '';
      renderAudChips((x && x.audienceIds) || []);
      fillAudPicker((x && x.audienceIds) || []);
      fillRows('cpQuestions', 'searchQuestions', x && x.searchQuestions);
      fillRows('cpTopicsIn', 'topicsInclude', x && x.topicsInclude);
      fillRows('cpTopicsOut', 'topicsAvoid', x && x.topicsAvoid);
      fillRows('cpMessages', 'coreMessages', x && x.coreMessages);
      $('cpErr').textContent = '';
      $('pillarModal').classList.remove('hidden');
      setTimeout(() => $('cpName').focus(), 60);
    }
    const closePillar = () => $('pillarModal').classList.add('hidden');

    $('btnAddPillar').onclick = () => openPillar(null);
    $('btnClosePillarModal').onclick = closePillar;
    $('btnPillarCancel').onclick = closePillar;
    ['btnAddQuestion|searchQuestions|cpQuestions', 'btnAddTopicIn|topicsInclude|cpTopicsIn',
      'btnAddTopicOut|topicsAvoid|cpTopicsOut', 'btnAddMessage|coreMessages|cpMessages'].forEach((t) => {
      const [btn, kind, box] = t.split('|');
      $(btn).onclick = () => addRow(box, kind, '').querySelector('.row-input').focus();
    });
    $('cpAudPick').onchange = () => {
      const id = $('cpAudPick').value;
      if (!id) return;
      const ids = pillarAudIds();
      if (!ids.includes(id)) ids.push(id);
      renderAudChips(ids);
      fillAudPicker(ids);
    };
    $('cpAudChips').addEventListener('click', (e) => {
      const b0 = e.target.closest('[data-aid]');
      if (!b0) return;
      const ids = pillarAudIds().filter((x) => x !== b0.dataset.aid);
      renderAudChips(ids);
      fillAudPicker(ids);
    });
    $('btnPillarSave').onclick = async () => {
      const name = $('cpName').value.trim();
      const description = $('cpDesc').value.trim();
      if (!name) { $('cpErr').textContent = 'Pillar name 必填，比如「Technical SEO」。'; $('cpName').focus(); return; }
      if (!description) { $('cpErr').textContent = 'Description 必填 —— 一句话说明这个支柱要占住什么主题。'; $('cpDesc').focus(); return; }
      const body = {
        name, description,
        audienceIds: pillarAudIds(),
        searchQuestions: readRows('cpQuestions'),
        topicsInclude: readRows('cpTopicsIn'),
        topicsAvoid: readRows('cpTopicsOut'),
        coreMessages: readRows('cpMessages')
      };
      if (CP.editing && CP.editing.id) body.id = CP.editing.id;
      try {
        $('btnPillarSave').disabled = true;
        await api('/api/knowledge/pillar', { method: 'POST', body });
        closePillar();
        await renderDashboard();
        if (window.refreshStrategyKnowledge) window.refreshStrategyKnowledge();
        toast((body.id ? '内容支柱已更新：' : '内容支柱已添加：') + name);
      } catch (e) {
        $('cpErr').textContent = e.message;
      } finally {
        $('btnPillarSave').disabled = false;
      }
    };
    $('pillarList').addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-pact]');
      if (!btn) return;
      const list = ((D.dash && D.dash.knowledge.company.contentPillars) || []);
      const x = list.find((v) => v.id === btn.dataset.pid);
      if (!x) return;
      if (btn.dataset.pact === 'edit') { openPillar(x); return; }
      if (!window.confirm('删除这个内容支柱？')) return;
      try {
        await api('/api/knowledge/pillar/' + encodeURIComponent(x.id), { method: 'DELETE' });
        await renderDashboard();
        if (window.refreshStrategyKnowledge) window.refreshStrategyKnowledge();
        toast('已删除');
      } catch (err) { toast(err.message, true); }
    });

    /* --- Visual styles：配色 + 参考图 / Logo --- */
    const vsImages = () => ((D.dash && D.dash.knowledge.images) || []);
    const vsLeft = (n) => Math.max(0, 4 - n) + ' of 4 left';

    const renderVsThumbs = () => {
      const draw = (boxId, ids) => {
        const box = $(boxId);
        if (!box) return;
        const byId = {};
        vsImages().forEach((i) => { byId[i.id] = i; });
        const used = ids.map((id) => byId[id]).filter(Boolean);
        box.innerHTML = used.map((i) => '<div class="thumb" data-img="' + esc(i.id) + '">' +
            '<img src="' + esc(i.url) + '" alt="' + esc(i.name) + '">' +
            '<button class="thumb-x" type="button" data-imgdel="' + esc(i.id) + '" aria-label="移除 ' + esc(i.name) + '">✕</button>' +
          '</div>').join('') +
          Array.from({ length: Math.max(0, 4 - used.length) }).map(() => '<div class="thumb-slot">空</div>').join('');
      };
      draw('vsRefs', VS.refs);
      draw('vsLogos', VS.logos);
      $('vsRefsLeft').textContent = vsLeft(VS.refs.length);
      $('vsLogosLeft').textContent = vsLeft(VS.logos.length);
    };

    const renderVsLibrary = (libId, ids) => {
      const box = $(libId);
      if (!box) return;
      const avail = vsImages().filter((i) => !ids.includes(i.id));
      box.innerHTML = avail.length
        ? avail.map((i) => '<button class="up-lib-item" type="button" data-libpick="' + esc(i.id) + '">' +
            '<img src="' + esc(i.url) + '" alt=""><span>' + esc(i.name) + '</span></button>').join('')
        : '<div class="up-lib-empty">图库是空的。先用 Upload 传一张。</div>';
    };

    const openVisual = (v) => {
      VS.editing = v || null;
      VS.refs = ((v && v.referenceIds) || []).slice(0, 4);
      VS.logos = ((v && v.logoIds) || []).slice(0, 4);
      $('visualModalTitle').textContent = v ? 'Edit Visual Style' : 'Create Visual Style';
      $('btnVisualSave').textContent = v ? 'Save' : 'Create';
      $('vsName').value = v ? v.name : '';
      $('vsGuide').value = v ? (v.guidelines || '') : '';
      $('vsPrimary').value = (v && v.primaryColor) || '';
      $('vsSecondary').value = (v && v.secondaryColor) || '';
      $('vsPrimaryPick').value = (v && v.primaryColor) || '#000000';
      $('vsSecondaryPick').value = (v && v.secondaryColor) || '#000000';
      $('vsErr').textContent = '';
      $('vsRefLib').classList.add('hidden');
      $('vsLogoLib').classList.add('hidden');
      renderVsThumbs();
      $('visualModal').classList.remove('hidden');
      setTimeout(() => $('vsName').focus(), 60);
    };
    const closeVisual = () => $('visualModal').classList.add('hidden');

    $('btnAddVisual').onclick = () => openVisual(null);
    $('btnCloseVisualModal').onclick = closeVisual;
    $('btnVisualCancel').onclick = closeVisual;

    // 取色器和文本框双向同步
    const bindColor = (textId, pickId, key) => {
      $(pickId).oninput = () => {
        $(textId).value = $(pickId).value;
      };
      $(textId).oninput = () => {
        const v = $(textId).value.trim();
        if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v)) $(pickId).value = v.length === 4
          ? '#' + v.slice(1).split('').map((c) => c + c).join('')
          : v;
      };
    };
    bindColor('vsPrimary', 'vsPrimaryPick', 'primaryColor');
    bindColor('vsSecondary', 'vsSecondaryPick', 'secondaryColor');

    // 上传：先记下这次是传给 Style references 还是 Logos
    $('btnVsRefUpload').onclick = () => { VS.target = 'refs'; $('vsImgInput').click(); };
    $('btnVsLogoUpload').onclick = () => { VS.target = 'logos'; $('vsImgInput').click(); };

    $('btnVsRefLib').onclick = () => {
      const box = $('vsRefLib');
      renderVsLibrary('vsRefLib', VS.refs);
      box.classList.toggle('hidden');
      $('btnVsRefLib').setAttribute('aria-expanded', String(!box.classList.contains('hidden')));
      $('vsLogoLib').classList.add('hidden');
    };
    $('btnVsLogoLib').onclick = () => {
      const box = $('vsLogoLib');
      renderVsLibrary('vsLogoLib', VS.logos);
      box.classList.toggle('hidden');
      $('btnVsLogoLib').setAttribute('aria-expanded', String(!box.classList.contains('hidden')));
      $('vsRefLib').classList.add('hidden');
    };
    document.querySelectorAll('.up-lib').forEach((box) => {
      box.addEventListener('click', (e) => {
        const b = e.target.closest('[data-libpick]');
        if (!b) return;
        const isRefs = box.id === 'vsRefLib';
        const arr = isRefs ? VS.refs : VS.logos;
        if (arr.length >= 4) { toast('最多 4 张', true); return; }
        if (!arr.includes(b.dataset.libpick)) arr.push(b.dataset.libpick);
        box.classList.add('hidden');
        renderVsThumbs();
      });
    });

    $('vsImgInput').onchange = async (e) => {
      const file = (e.target.files || [])[0];
      e.target.value = '';
      if (!file) return;
      const arr = VS.target === 'logos' ? VS.logos : VS.refs;
      if (arr.length >= 4) { toast((VS.target === 'logos' ? 'Logo' : '参考图') + '最多 4 张', true); return; }
      if (!/\.(jpe?g|png|svg)$/i.test(file.name)) { toast('只支持 jpeg / jpg / png / svg', true); return; }
      try {
        $('vsErr').textContent = '';
        const data = await new Promise((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(String(fr.result));
          fr.onerror = () => reject(new Error('读不出这个文件'));
          fr.readAsDataURL(file);
        });
        const r = await api('/api/knowledge/image', { method: 'POST', body: { name: file.name, data } });
        arr.push(r.image.id);
        // 图库变了，重画整页拿最新的 images
        await renderDashboard();
        renderVsThumbs();
        toast('已加入' + (VS.target === 'logos' ? ' Logos' : ' Style references'));
      } catch (err) {
        $('vsErr').textContent = err.message;
      }
    };

    ['vsRefs', 'vsLogos'].forEach((boxId) => {
      $(boxId).addEventListener('click', (e) => {
        const b = e.target.closest('[data-imgdel]');
        if (!b) return;
        const id = b.dataset.imgdel;
        if (boxId === 'vsRefs') VS.refs = VS.refs.filter((x) => x !== id);
        else VS.logos = VS.logos.filter((x) => x !== id);
        renderVsThumbs();
      });
    });

    const badColor = (v) => String(v || '').trim() && !/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(String(v).trim());

    $('btnVisualSave').onclick = async () => {
      const name = $('vsName').value.trim();
      if (!name) { $('vsErr').textContent = 'Name 必填，比如「Social visuals」。'; $('vsName').focus(); return; }
      if (badColor($('vsPrimary').value) || badColor($('vsSecondary').value)) {
        $('vsErr').textContent = '色值要写成 #RGB 或 #RRGGBB，比如 #2f4bff。';
        return;
      }
      const body = {
        name,
        guidelines: $('vsGuide').value.trim(),
        primaryColor: $('vsPrimary').value.trim(),
        secondaryColor: $('vsSecondary').value.trim(),
        referenceIds: VS.refs,
        logoIds: VS.logos
      };
      if (VS.editing && VS.editing.id) body.id = VS.editing.id;
      try {
        $('btnVisualSave').disabled = true;
        await api('/api/knowledge/visual-style', { method: 'POST', body });
        closeVisual();
        await renderDashboard();
        if (window.refreshStrategyKnowledge) window.refreshStrategyKnowledge();
        toast((body.id ? '视觉风格已更新：' : '视觉风格已添加：') + name);
      } catch (e) {
        $('vsErr').textContent = e.message;
      } finally {
        $('btnVisualSave').disabled = false;
      }
    };

    $('visualList').addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-vsact]');
      if (!btn) return;
      const list = ((D.dash && D.dash.knowledge.company.visualStyles) || []);
      const v = list.find((x) => x.id === btn.dataset.vsid);
      if (!v) return;
      if (btn.dataset.vsact === 'edit') { openVisual(v); return; }
      if (!window.confirm('删除这条视觉风格？图片还留在图库里，可以给别的条目用。')) return;
      try {
        await api('/api/knowledge/visual-style/' + encodeURIComponent(v.id), { method: 'DELETE' });
        await renderDashboard();
        if (window.refreshStrategyKnowledge) window.refreshStrategyKnowledge();
        toast('已删除');
      } catch (err) { toast(err.message, true); }
    });

    /* --- Knowledge files：上传 / 查看 / 删除 / 检索 --- */
    $('btnKnUpload').onclick = () => $('knFileInput').click();
    $('knFileInput').onchange = async (e) => {
      const list = [...(e.target.files || [])];
      if (!list.length) return;
      let okN = 0;
      const fails = [];
      for (const f of list) {
        try {
          const text = await f.text();
          await api('/api/knowledge/files', { method: 'POST', body: { name: f.name, text } });
          okN++;
        } catch (err) { fails.push(f.name + '：' + err.message); }
      }
      e.target.value = '';
      await renderDashboard();
      if (okN) toast('已上传 ' + okN + ' 个文件');
      if (fails.length) toast(fails.join('；'), true);
    };

    const fileBox = (sel) => $(sel);
    const handleFileAction = async (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const id = btn.dataset.fid;
      if (btn.dataset.act === 'viewfile') {
        try {
          const r = await api('/api/knowledge/files/' + encodeURIComponent(id));
          $('fileViewTitle').textContent = r.name;
          $('fileViewMeta').textContent = r.chars + ' 字（预览前 20000 字）';
          $('fileViewText').textContent = r.text;
          $('fileView').classList.remove('hidden');
        } catch (err) { toast(err.message, true); }
        return;
      }
      if (btn.dataset.act === 'delfile') {
        if (!window.confirm('删除这个文件？agent 之后就读不到它了。')) return;
        try {
          await api('/api/knowledge/files/' + encodeURIComponent(id), { method: 'DELETE' });
          await renderDashboard();
          toast('已删除');
        } catch (err) { toast(err.message, true); }
      }
    };
    fileBox('knFileList').addEventListener('click', handleFileAction);
    fileBox('knFileHits').addEventListener('click', handleFileAction);
    $('btnCloseFileView').onclick = () => $('fileView').classList.add('hidden');
    $('btnFileViewClose').onclick = () => $('fileView').classList.add('hidden');

    $('knFileSearch').addEventListener('input', () => {
      const q = $('knFileSearch').value.trim();
      clearTimeout(fileSearchTimer);
      fileSearchTimer = setTimeout(() => runFileSearch(q), 250);
    });

    /* --- Writing styles：开关 / 下拉按 knowledge 的规则表渲染 --- */
    const wsRules = () => ((D.dash && D.dash.knowledge && D.dash.knowledge.writingRules) || []);

    /** 把规则表渲染成「分组标题 + 一行一条」 */
    function buildWritingForm() {
      $('wsBody').innerHTML = wsRules().map((g) => {
        const rows = (g.rules || []).map((r) => {
          const text = '<span class="kn-row-text"><span class="kn-row-label">' + esc(r.label) + '</span>' +
            '<span class="kn-row-desc">' + esc(r.desc) + '</span></span>';
          if (r.type === 'select') {
            return '<div class="kn-row">' + text +
              '<select class="kn-select" data-wskey="' + esc(r.key) + '" aria-label="' + esc(r.label) + '">' +
              (r.options || []).map((o) => '<option value="' + esc(o.id) + '">' + esc(o.label) + '</option>').join('') +
              '</select></div>';
          }
          return '<div class="kn-row">' + text +
            '<button class="kn-switch" type="button" role="switch" aria-checked="false" data-wskey="' + esc(r.key) + '" aria-label="' + esc(r.label) + '"><span class="kn-switch-knob"></span></button></div>';
        }).join('');
        return '<div class="kn-group-title">' + esc(g.title) + '</div>' + rows;
      }).join('');
    }

    const readWritingForm = () => {
      const out = {};
      $('wsBody').querySelectorAll('[data-wskey]').forEach((el) => {
        const k = el.dataset.wskey;
        out[k] = el.classList.contains('kn-switch')
          ? el.getAttribute('aria-checked') === 'true'
          : el.value;
      });
      return out;
    };

    const fillWritingForm = (w) => {
      $('wsBody').querySelectorAll('[data-wskey]').forEach((el) => {
        const k = el.dataset.wskey;
        if (el.classList.contains('kn-switch')) {
          el.setAttribute('aria-checked', w && w[k] ? 'true' : 'false');
        } else {
          el.value = (w && w[k]) || 'none';
        }
      });
    };

    // 开关点击（button + role=switch：键盘 Enter/Space 也会触发 click）
    $('wsBody').addEventListener('click', (e) => {
      const sw = e.target.closest('.kn-switch');
      if (!sw) return;
      sw.setAttribute('aria-checked', sw.getAttribute('aria-checked') === 'true' ? 'false' : 'true');
    });

    const openWriting = (w) => {
      WS.editing = w || null;
      $('writingModalTitle').textContent = w ? 'Edit Writing Style' : 'Create Writing Style';
      $('btnWritingSave').textContent = w ? 'Save' : 'Create';
      $('wsName').value = w ? w.name : '';
      $('wsNotes').value = w ? (w.notes || '') : '';
      buildWritingForm();
      fillWritingForm(w);
      $('wsErr').textContent = '';
      $('writingModal').classList.remove('hidden');
      setTimeout(() => $('wsName').focus(), 60);
    };
    const closeWriting = () => $('writingModal').classList.add('hidden');

    $('btnAddWriting').onclick = () => openWriting(null);
    $('btnCloseWritingModal').onclick = closeWriting;
    $('btnWritingCancel').onclick = closeWriting;

    $('btnWritingSave').onclick = async () => {
      const name = $('wsName').value.trim();
      if (!name) { $('wsErr').textContent = 'Name 必填，比如「Blog articles」。'; $('wsName').focus(); return; }
      const body = { name, notes: $('wsNotes').value.trim(), ...readWritingForm() };
      if (WS.editing && WS.editing.id) body.id = WS.editing.id;
      try {
        $('btnWritingSave').disabled = true;
        await api('/api/knowledge/writing-style', { method: 'POST', body });
        closeWriting();
        await renderDashboard();
        if (window.refreshStrategyKnowledge) window.refreshStrategyKnowledge();
        toast((body.id ? '写作规范已更新：' : '写作规范已添加：') + name);
      } catch (e) {
        $('wsErr').textContent = e.message;
      } finally {
        $('btnWritingSave').disabled = false;
      }
    };

    $('writingList').addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-wact]');
      if (!btn) return;
      const list = ((D.dash && D.dash.knowledge.company.writingStyles) || []);
      const w = list.find((v) => v.id === btn.dataset.wid);
      if (!w) return;
      if (btn.dataset.wact === 'edit') { openWriting(w); return; }
      if (!window.confirm('删除这条写作规范？')) return;
      try {
        await api('/api/knowledge/writing-style/' + encodeURIComponent(w.id), { method: 'DELETE' });
        await renderDashboard();
        if (window.refreshStrategyKnowledge) window.refreshStrategyKnowledge();
        toast('已删除');
      } catch (err) { toast(err.message, true); }
    });

    /* --- Brand voices --- */
    const openVoice = (v) => {
      KN.voice = v || null;
      $('voiceModalTitle').textContent = v ? 'Edit Brand Voice' : 'Create Brand Voice';
      $('btnVoiceSave').textContent = v ? 'Save' : 'Create';
      $('vName').value = v ? v.name : '';
      $('vDesc').value = v ? v.description : '';
      $('vUse').value = (v && v.useCase) || 'general';
      $('vErr').textContent = '';
      fillRows('vExcerpts', 'excerpts', v && v.excerpts);
      $('voiceModal').classList.remove('hidden');
      setTimeout(() => $('vName').focus(), 60);
    };
    const closeVoice = () => $('voiceModal').classList.add('hidden');
    $('btnAddVoice').onclick = () => openVoice(null);
    $('btnCloseVoiceModal').onclick = closeVoice;
    $('btnVoiceCancel').onclick = closeVoice;
    $('btnAddExcerpt').onclick = () => addRow('vExcerpts', 'excerpts', '').querySelector('.row-input').focus();
    $('btnVoiceSave').onclick = async () => {
      const name = $('vName').value.trim();
      if (!name) { $('vErr').textContent = 'Name 必填，比如「直接、具体、不吹」。'; $('vName').focus(); return; }
      const excerpts = readRows('vExcerpts');
      const body = { name, description: $('vDesc').value, useCase: $('vUse').value, excerpts };
      if (KN.voice && KN.voice.id) body.id = KN.voice.id;
      try {
        $('btnVoiceSave').disabled = true;
        await api('/api/knowledge/voice', { method: 'POST', body });
        closeVoice();
        await renderDashboard();
        if (window.refreshStrategyKnowledge) window.refreshStrategyKnowledge();
        toast(body.id ? 'Brand voice 已更新' : 'Brand voice 已添加：' + name);
      } catch (e) {
        $('vErr').textContent = e.message;
      } finally {
        $('btnVoiceSave').disabled = false;
      }
    };
    if ($('voiceList')) {
      $('voiceList').addEventListener('click', async (e) => {
        const b1 = e.target.closest('[data-vact]');
        if (!b1) return;
        const v = ((D.dash && D.dash.knowledge.company.brandVoices) || []).find((x) => x.id === b1.dataset.vid);
        if (!v) return;
        if (b1.dataset.vact === 'edit') { openVoice(v); return; }
        if (!window.confirm('删除这条 brand voice？')) return;
        try {
          await api('/api/knowledge/voice/' + encodeURIComponent(v.id), { method: 'DELETE' });
          await renderDashboard();
          if (window.refreshStrategyKnowledge) window.refreshStrategyKnowledge();
          toast('已删除');
        } catch (err) { toast(err.message, true); }
      });
    }

    /* --- Overview：Complete with AI --- */
    if ($('btnFreshStart')) {
      $('btnFreshStart').onclick = async () => {
        const prompt = '请读我的公司知识，指出还缺哪几项、每一项建议怎么写（给具体草稿，不要空话），并把能确定的字段直接写回 Company knowledge。';
        SCA().setNav('strategy');
        const tab = document.querySelector('.st-item[data-st="chat"]');
        if (tab) tab.click();
        setTimeout(() => {
          const box = document.getElementById('stChatText');
          if (box) { box.value = prompt; box.focus(); }
        }, 500);
        toast('已把提示放进对话框 —— 发送前请确认顶部已接入模型');
      };
    }

    /* --- Search Console（真 OAuth，不是"标记绑定"） --- */
    const toAudit = () => {
      SCA().setNav('strategy');
      const tab = document.querySelector('.st-item[data-st="audit"]');
      if (tab) tab.click();
      setTimeout(() => { const b = document.getElementById('stGscSetup'); if (b) b.click(); }, 500);
    };
    $('btnSetupGsc').onclick = () => {
      const st = (D.dash && D.dash.gscStatus) || {};
      if (!st.configured) { toAudit(); toast('先在 Content audit 里填 Client ID / Secret（三步引导在那边）'); return; }
      window.location.href = '/api/gsc/authorize';
    };
    $('btnAuthorizeGsc').onclick = () => { window.location.href = '/api/gsc/authorize'; };
    $('btnSyncGsc').onclick = async () => {
      const st = (D.dash && D.dash.gscStatus) || {};
      const site = $('gscSite').value.trim() || st.site;
      if (!site) { toast('先填站点', true); return; }
      $('btnSyncGsc').disabled = true;
      $('btnSyncGsc').textContent = '同步中…';
      try {
        await api('/api/gsc/site', { method: 'POST', body: { site } });
        const r = await api('/api/gsc/sync', { method: 'POST', body: { days: 28 } });
        if (r.error) { toast(r.error, true); } else { toast('同步完成：' + r.rows + ' 行查询'); }
        await renderDashboard();
      } catch (e) {
        toast('同步失败：' + e.message, true);
      } finally {
        $('btnSyncGsc').disabled = false;
        $('btnSyncGsc').textContent = '同步最近 28 天';
      }
    };
    $('btnDisconnectGsc').onclick = async () => {
      try {
        await api('/api/gsc/disconnect', { method: 'POST', body: {} });
        await renderDashboard();
        toast('已断开，凭据已删除');
      } catch (e) { toast(e.message, true); }
    };
    $('gscNote').addEventListener('change', () => {
      api('/api/knowledge', { method: 'POST', body: { gsc: { note: $('gscNote').value.trim(), site: $('gscSite').value.trim() } } }).catch(() => {});
    });
    // 同一份 GSC 数据，分析在 Strategy → Content audit
    $('btnGoAudit').onclick = () => {
      SCA().setNav('strategy');
      const tab = document.querySelector('.st-item[data-st="audit"]');
      if (tab) tab.click();
    };

    /* --- 工具 --- */
    $('toolList').addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const id = btn.dataset.tid;
      const act = btn.dataset.act;
      const cell = btn.closest('.app-cell');
      const app = (D.dash && D.dash.knowledge.tools.find((x) => x.id === id)) || { id, name: id };
      try {
        if (act === 'install') {
          await api('/api/tools', { method: 'POST', body: { action: 'install', id } });
          await refreshTools();
          toast('已安装，点「授权」把凭据放进来');
        } else if (act === 'authorize') {
          openToolModal(app);
        } else if (act === 'manage') {
          const box = cell && cell.querySelector('[data-drawer]');
          if (box) box.classList.toggle('hidden');
        } else if (act === 'savedata') {
          const data = cell.querySelector('[data-input]').value;
          await api('/api/tools', { method: 'POST', body: { action: 'data', id, data } });
          await refreshTools();
          toast('数据已保存，agent 会读');
        } else if (act === 'disconnect') {
          await api('/api/tools', { method: 'POST', body: { action: 'disconnect', id } });
          await refreshTools();
          toast('已撤销授权');
        } else if (act === 'uninstall') {
          if (!confirm(app.custom ? '移除这个自定义应用？' : '卸载 ' + app.name + '？凭据和贴的数据都会删掉。')) return;
          await api('/api/tools', { method: 'POST', body: { action: 'uninstall', id } });
          await refreshTools();
          toast('已卸载');
        }
      } catch (err) { toast(err.message, true); }
    });

    if ($('btnAddApp')) {
      $('btnAddApp').onclick = () => $('plForm').classList.remove('hidden');
      $('btnAddAppCancel').onclick = () => $('plForm').classList.add('hidden');
      $('plForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          await api('/api/tools', {
            method: 'POST',
            body: { action: 'add', name: $('plName').value.trim(), url: $('plUrl').value.trim(), desc: $('plDesc').value.trim() }
          });
          $('plName').value = ''; $('plUrl').value = ''; $('plDesc').value = '';
          $('plForm').classList.add('hidden');
          await refreshTools();
          toast('已添加，接着点「授权」');
        } catch (err) { toast(err.message, true); }
      });
    }

    /* 授权弹窗 */
    if ($('btnToolSave')) {
      $('btnToolSave').onclick = async () => {
        if (!toolEditing) return;
        const token = $('toolToken').value.trim();
        const skip = $('toolSkipToken').checked;
        if (!token && !skip && !toolEditing.hasToken) {
          $('toolErr').textContent = '填个 API key / 令牌，或勾上「先只登记账号」。';
          return;
        }
        $('btnToolSave').disabled = true;
        try {
          await api('/api/tools', {
            method: 'POST',
            body: {
              action: 'authorize',
              id: toolEditing.id,
              account: $('toolAccount').value.trim(),
              token,
              skipToken: skip && !token,
              data: $('toolData').value
            }
          });
          closeToolModal();
          await refreshTools();
          toast('已授权，agent 现在能读到它');
        } catch (err) {
          $('toolErr').textContent = err.message;
        } finally {
          $('btnToolSave').disabled = false;
        }
      };
      $('btnToolCancel').onclick = closeToolModal;
      $('btnCloseToolModal').onclick = closeToolModal;
      $('toolModal').addEventListener('click', (e) => { if (e.target.id === 'toolModal') closeToolModal(); });
      $('toolSkipToken').onchange = () => { $('toolToken').disabled = $('toolSkipToken').checked; };
    }

    /* --- 文件 --- */
    $('fileInput').onchange = async (e) => {
      const files = [...(e.target.files || [])];
      if (!files.length) return;
      $('fileHint').textContent = '上传中…';
      let okN = 0;
      const fails = [];
      for (const f of files) {
        try {
          const text = await f.text();
          await api('/api/knowledge/files', { method: 'POST', body: { name: f.name, text } });
          okN++;
        } catch (err) {
          fails.push(f.name + '：' + err.message);
        }
      }
      $('fileHint').textContent = '';
      e.target.value = '';
      await renderDashboard();
      if (okN) toast(`已上传 ${okN} 个文件`);
      if (fails.length) toast(fails.join('；'), true);
    };

    $('fileList').addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act="delfile"]');
      if (!btn) return;
      if (!confirm('删除这个文件？agent 之后就读不到它了。')) return;
      try {
        await api('/api/knowledge/files/' + btn.dataset.fid, { method: 'DELETE' });
        await renderDashboard();
        toast('已删除');
      } catch (err) { toast(err.message, true); }
    });

    /* --- 对话 --- */
    $('btnSendChat').onclick = () => sendChat($('chatText').value);
    $('chatText').addEventListener('input', autosize);
    $('chatText').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        sendChat($('chatText').value);
      }
    });
    $('chatQuick').addEventListener('click', (e) => {
      const b = e.target.closest('.quick');
      if (!b) return;
      $('chatText').value = b.dataset.q;
      autosize();
      sendChat(b.dataset.q);
    });
    $('btnNewChat').onclick = () => newChat().catch((err) => toast(err.message, true));

    $('chatList').addEventListener('click', async (e) => {
      const del = e.target.closest('[data-act="delchat"]');
      if (del) {
        e.stopPropagation();
        if (!confirm('删除这条对话记录？')) return;
        try {
          await api('/api/chats/' + del.dataset.cid, { method: 'DELETE' });
          if (D.chatId === del.dataset.cid) { D.chatId = null; D.chat = null; }
          await renderDashboard();
          toast('对话已删除');
        } catch (err) { toast(err.message, true); }
        return;
      }
      const row = e.target.closest('.chat-row');
      if (row) {
        D.chatId = row.dataset.cid;
        renderChatList(D.dash);
        await loadChat();
      }
    });
  }

  bindDashboard();
  window.renderDashboard = renderDashboard;

  window.renderReport = function renderReport() {
    const d = D.dash;
    if (!d) return;
    const s = d.stats;
    const cards = [
      ['Campaign', s.campaigns],
      ['资产', s.assets],
      ['已批准', s.approved],
      ['有硬伤', s.mustFail],
      ['未排期', s.unscheduled],
      ['7 天内要发', s.upcomingWeek],
      ['AI 调用', s.calls],
      ['对话', s.chats]
    ];
    SCA().$('reportStats').innerHTML = cards
      .map(([k, v]) => `<div class="stat-card"><span class="stat-num">${v}</span><span class="stat-label muted small">${esc(k)}</span></div>`)
      .join('');
  };
})();
