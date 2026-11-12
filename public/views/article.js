'use strict';
/**
 * Article 编辑器（v12）
 * Write / Settings / Audience 三个 Tab + 右侧常驻 GEO & SEO 面板。
 * 内容仍然是 Content 列表里的那一条（item.article 存元信息，正文存资产当前版本）。
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const SCA = () => window.SCA || {};
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const api = (url, opts) => SCA().api(url, opts);
  const toast = (msg, bad) => SCA().toast(msg, bad);

  const A = {
    id: '',
    tab: 'write',
    sub: 'details',            // settings 的二级菜单
    cat: 'websites',           // audience 的渠道分类
    data: null,                // GET /api/article/:id 的 payload
    meta: null,                // /api/article/meta
    editingSocial: '',         // 正在内联编辑的社媒帖 assetId
    dirty: false,
    saveTimer: 0
  };
  window.AR = A;

  /* ------------------------------ 小工具 ------------------------------ */

  const pctText = (v) => (v === null || v === undefined ? '—' : v + '%');
  const tone = (v, good, ok) => (v === null || v === undefined ? 'mute' : v >= good ? 'good' : v >= ok ? 'warn' : 'bad');

  function ring(pct, size, colorClass) {
    const v = pct === null || pct === undefined ? 0 : Math.max(0, Math.min(100, pct));
    const r = (size || 44) / 2 - 4;
    const c = 2 * Math.PI * r;
    const off = c * (1 - v / 100);
    return `<svg class="ar-ring ${colorClass || ''}" viewBox="0 0 ${size || 44} ${size || 44}" width="${size || 44}" height="${size || 44}" aria-hidden="true">
      <circle cx="${(size || 44) / 2}" cy="${(size || 44) / 2}" r="${r}" class="ar-ring-track"></circle>
      <circle cx="${(size || 44) / 2}" cy="${(size || 44) / 2}" r="${r}" class="ar-ring-bar" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"></circle>
      <text x="${(size || 44) / 2}" y="${(size || 44) / 2 + 4}" class="ar-ring-text">${pct === null || pct === undefined ? '—' : v + '%'}</text>
    </svg>`;
  }

  /** 极简 markdown 渲染（预览用；不引第三方库，够看就行） */
  function md(src) {
    const lines = String(src || '').split(/\r?\n/);
    let out = [];
    let inCode = false;
    let list = '';
    const inline = (t) => esc(t)
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (m, alt, url) => `<img src="${esc(url)}" alt="${esc(alt)}">`)
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, txt, url) => `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(txt)}</a>`)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
    const closeList = () => { if (list) { out.push(`</${list}>`); list = ''; } };
    lines.forEach((ln) => {
      if (/^```/.test(ln)) {
        closeList();
        out.push(inCode ? '</code></pre>' : '<pre><code>');
        inCode = !inCode;
        return;
      }
      if (inCode) { out.push(esc(ln)); return; }
      if (/^\s*$/.test(ln)) { closeList(); return; }
      if (/^###\s+/.test(ln)) { closeList(); out.push(`<h3>${inline(ln.replace(/^###\s+/, ''))}</h3>`); return; }
      if (/^##\s+/.test(ln)) { closeList(); out.push(`<h2>${inline(ln.replace(/^##\s+/, ''))}</h2>`); return; }
      if (/^#\s+/.test(ln)) { closeList(); out.push(`<h1>${inline(ln.replace(/^#\s+/, ''))}</h1>`); return; }
      if (/^>\s?/.test(ln)) { closeList(); out.push(`<blockquote>${inline(ln.replace(/^>\s?/, ''))}</blockquote>`); return; }
      if (/^\s*[-*]\s+/.test(ln)) {
        if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
        out.push(`<li>${inline(ln.replace(/^\s*[-*]\s+/, ''))}</li>`);
        return;
      }
      if (/^\s*\d+\.\s+/.test(ln)) {
        if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; }
        out.push(`<li>${inline(ln.replace(/^\s*\d+\.\s+/, ''))}</li>`);
        return;
      }
      closeList();
      out.push(`<p>${inline(ln)}</p>`);
    });
    closeList();
    if (inCode) out.push('</code></pre>');
    return out.join('\n');
  }

  /* ------------------------------ 打开 / 关闭 ------------------------------ */

  async function open(itemId) {
    try {
      if (!A.meta) A.meta = await api('/api/article/meta');
      const d = await api('/api/article/' + encodeURIComponent(itemId));
      A.id = itemId;
      A.data = d;
      A.tab = 'write';
      A.editingSocial = '';
      document.body.classList.add('ar-open');
      $('view-article').classList.remove('hidden');
      A.render();
      // 打开时把正文滚到顶，标题框不自动抢焦点（避免一进来就弹键盘）
      const ta = $('arBody');
      if (ta) ta.scrollTop = 0;
    } catch (e) {
      toast('打不开这篇文章：' + e.message, true);
    }
  }

  function close() {
    document.body.classList.remove('ar-open');
    $('view-article').classList.add('hidden');
    A.id = '';
    A.data = null;
    // 回列表的时候要重新拉一次：标题 / 状态 / 标签可能刚改过
    if (window.CL) {
      if (window.CL.open) window.CL.open();
      if (window.CL.load) window.CL.load().catch(() => {});
    }
  }

  async function reload() {
    if (!A.id) return;
    A.data = await api('/api/article/' + encodeURIComponent(A.id));
    A.render();
  }

  /* ------------------------------ 渲染 ------------------------------ */

  A.render = function render() {
    const d = A.data;
    if (!d) return;
    const titleEl = $('arTitleBtn');
    if (titleEl) titleEl.textContent = d.item.title || 'Untitled article';
    const pill = $('arStatusPill');
    if (pill) {
      pill.textContent = d.item.status === 'draft' ? 'Draft'
        : d.item.status === 'pending' ? 'Pending approval'
          : d.item.status === 'scheduled' ? 'Scheduled' : 'Published';
      pill.className = 'cl-pill cl-pill-' + d.item.status;
    }

    const rep = d.report;
    paintMetric('arMSeo', rep.seo.pct, `GEO & SEO`);
    paintMetric('arMRead', rep.readability.pct, 'Readability');
    paintMetric('arMGap', rep.gap.available ? rep.gap.pct : null, 'Content Gap');

    document.querySelectorAll('.ar-tab').forEach((b) => b.classList.toggle('is-on', b.dataset.artab === A.tab));
    if (A.tab === 'write') renderWrite();
    if (A.tab === 'settings') renderSettings();
    if (A.tab === 'audience') renderAudience();
    renderRail();
  };

  function paintMetric(id, value, label) {
    const el = $(id);
    if (!el) return;
    const t = tone(value, 70, 40);
    el.className = 'ar-metric is-' + t;
    el.innerHTML = `<i class="ar-dot"></i>${esc(label)}<b>${pctText(value)}</b>`;
    el.title = t === 'good' ? `${label} 达标` : t === 'mute' ? `${label} 还没有数据` : `${label} 需要改`;
  }

  /* ---------- Tab 1：Write ---------- */

  function renderWrite() {
    const d = A.data;
    const empty = !String(d.body || '').trim();
    $('arMain').innerHTML = `
      <div class="ar-write">
        <input id="arH1" class="ar-h1" placeholder="Title" value="${esc(d.item.title === '(未命名)' ? '' : d.item.title)}" spellcheck="false">
        <div class="ar-hint ${empty ? '' : 'hidden'}" id="arHint">Press Enter to continue with an empty page, or pick a template (↑↓ to select)</div>
        <div class="ar-starters ${empty ? '' : 'hidden'}" id="arStarters">
          <button class="ar-start" data-start="scratch">
            <span class="ar-start-ico">▢</span>
            <span class="ar-start-body"><b>Start from scratch</b><i>空白页，自己写</i></span>
          </button>
          <button class="ar-start" data-start="ai">
            <span class="ar-start-ico">✦</span>
            <span class="ar-start-body"><b>Write article with AI</b><i>读 Company Knowledge 的受众 / 写作规范 / 品牌语气</i></span>
          </button>
        </div>
        <div class="ar-toolbar" id="arToolbar">
          <button class="ar-tool" data-md="bold" title="加粗"><b>B</b></button>
          <button class="ar-tool" data-md="italic" title="斜体"><i>I</i></button>
          <span class="ar-tool-sep"></span>
          <button class="ar-tool" data-md="h2" title="小标题">H2</button>
          <button class="ar-tool" data-md="ul" title="无序列表">•</button>
          <button class="ar-tool" data-md="ol" title="有序列表">1.</button>
          <button class="ar-tool" data-md="quote" title="引用">❝</button>
          <button class="ar-tool" data-md="code" title="代码块">&lt;/&gt;</button>
          <span class="ar-tool-sep"></span>
          <button class="ar-tool" data-md="link" title="链接">🔗</button>
          <button class="ar-tool" data-md="image" title="图片">🖼</button>
          <span class="ar-tool-grow"></span>
          <button class="ar-tool is-plain" id="arPreviewBtn">Preview</button>
        </div>
        <textarea id="arBody" class="ar-body-input" spellcheck="false" placeholder="Start writing…">${esc(d.body || '')}</textarea>
        <div id="arPreview" class="ar-preview hidden"></div>
        <div class="ar-write-foot">
          <span id="arWords">${d.report.words} words · ${d.report.readingMin} min read</span>
          <span id="arSaved" class="ar-saved"></span>
        </div>
      </div>`;
    bindWrite();
  }

  function bindWrite() {
    const ta = $('arBody');
    const h1 = $('arH1');
    if (ta) {
      ta.addEventListener('input', () => {
        A.dirty = true;
        markSaved('未保存');
        clearTimeout(A.saveTimer);
        A.saveTimer = setTimeout(saveBody, 900);
        updateWords();
        const empty = !ta.value.trim();
        $('arHint').classList.toggle('hidden', !empty);
        $('arStarters').classList.toggle('hidden', !empty);
      });
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          // 「Press Enter to continue with an empty page」：空正文按回车 = 收起起始选项继续写
          const empty = !ta.value.trim();
          if (empty) {
            e.preventDefault();
            $('arStarters').classList.add('hidden');
            $('arHint').classList.add('hidden');
          }
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
          e.preventDefault();
          saveBody().then(() => toast('已保存'));
        }
      });
    }
    if (h1) {
      h1.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); if (ta) ta.focus(); }
      });
      h1.addEventListener('blur', () => patchTitle(h1.value));
    }
    $('arToolbar').addEventListener('click', (e) => {
      const b = e.target.closest('[data-md]');
      if (b) applyMd(b.dataset.md);
    });
    $('arPreviewBtn').onclick = togglePreview;
    $('arStarters').addEventListener('click', (e) => {
      const b = e.target.closest('[data-start]');
      if (!b) return;
      if (b.dataset.start === 'scratch') {
        $('arStarters').classList.add('hidden');
        $('arHint').classList.add('hidden');
        $('arBody').focus();
      } else {
        generateArticle(b);
      }
    });
  }

  function updateWords() {
    const ta = $('arBody');
    if (!ta) return;
    const t = ta.value.trim();
    const cjk = (t.match(/[\u4e00-\u9fa5]/g) || []).length;
    const latin = t.replace(/[\u4e00-\u9fa5]/g, ' ').split(/\s+/).filter(Boolean).length;
    const n = cjk + latin;
    $('arWords').textContent = `${n} words · ${Math.max(1, Math.round(n / 220))} min read`;
  }

  function markSaved(text) {
    const el = $('arSaved');
    if (el) el.textContent = text;
  }

  async function saveBody() {
    const ta = $('arBody');
    if (!ta || !A.id) return;
    try {
      const r = await api('/api/article/' + encodeURIComponent(A.id) + '/body', {
        method: 'POST',
        body: { body: ta.value }
      });
      A.dirty = false;
      markSaved('已保存');
      if (r.report) {
        A.data.report = r.report;
        A.data.body = ta.value;
        const rep = r.report;
        paintMetric('arMSeo', rep.seo.pct, 'GEO & SEO');
        paintMetric('arMRead', rep.readability.pct, 'Readability');
        paintMetric('arMGap', rep.gap.available ? rep.gap.pct : null, 'Content Gap');
        renderRail();
      }
    } catch (e) {
      markSaved('保存失败：' + e.message);
      toast('保存失败：' + e.message, true);
    }
  }

  async function patchTitle(value) {
    const v = String(value || '').trim();
    if (!A.data || v === A.data.item.title) return;
    try {
      const r = await api('/api/article/' + encodeURIComponent(A.id), { method: 'PATCH', body: { title: v || 'Untitled article' } });
      A.data = r.payload;
      A.render();
    } catch (e) { toast('改标题失败：' + e.message, true); }
  }

  function applyMd(kind) {
    const ta = $('arBody');
    if (!ta) return;
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const sel = ta.value.slice(s, e);
    const map = {
      bold: ['**', '**', '加粗文字'],
      italic: ['_', '_', '斜体文字'],
      h2: ['\n## ', '\n', '小标题'],
      ul: ['\n- ', '\n', '列表项'],
      ol: ['\n1. ', '\n', '列表项'],
      quote: ['\n> ', '\n', '引用'],
      code: ['\n```\n', '\n```\n', '代码'],
      link: ['[', '](https://)', '链接文字'],
      image: ['![', '](https://)', '图片说明']
    };
    const m = map[kind];
    if (!m) return;
    const text = sel || m[2];
    const next = ta.value.slice(0, s) + m[0] + text + m[1] + ta.value.slice(e);
    ta.value = next;
    ta.focus();
    const pos = s + m[0].length + text.length;
    ta.setSelectionRange(kind === 'link' || kind === 'image' ? pos + 3 : pos, kind === 'link' || kind === 'image' ? pos + 3 : pos);
    ta.dispatchEvent(new Event('input'));
  }

  function togglePreview() {
    const p = $('arPreview');
    const ta = $('arBody');
    const on = p.classList.contains('hidden');
    p.classList.toggle('hidden', !on);
    ta.classList.toggle('hidden', on);
    $('arPreviewBtn').classList.toggle('is-on', on);
    if (on) p.innerHTML = md(ta.value) || '<p class="muted small">还没有内容</p>';
  }

  async function generateArticle(btn) {
    btn.disabled = true;
    btn.classList.add('is-busy');
    btn.querySelector('b').textContent = '正在生成…';
    try {
      const r = await api('/api/article/' + encodeURIComponent(A.id) + '/generate', { method: 'POST', body: { target: 'article' } });
      A.data = r.payload;
      A.render();
      toast(r.degraded ? '模型没接入，用离线模板生成了一版' : '生成完成', !!r.degraded);
    } catch (e) {
      toast('生成失败：' + e.message, true);
      btn.disabled = false;
      btn.classList.remove('is-busy');
      btn.querySelector('b').textContent = 'Write article with AI';
    }
  }

  /* ---------- Tab 2：Settings ---------- */

  const SUB_TABS = [
    { id: 'details', label: 'Article details' },
    { id: 'seo', label: 'SEO settings' },
    { id: 'custom', label: 'Custom fields' }
  ];

  function renderSettings() {
    const d = A.data;
    const m = d.article;
    const kn = d.knowledge;
    const subs = SUB_TABS.map((t) => `<button class="ar-sub ${t.id === A.sub ? 'is-on' : ''}" data-arsub="${t.id}">${esc(t.label)}</button>`).join('');
    $('arMain').innerHTML = `
      <div class="ar-settings">
        <aside class="ar-subnav">${subs}</aside>
        <div class="ar-form" id="arForm">${settingsForm(A.sub)}</div>
      </div>`;
    $('arMain').querySelector('.ar-subnav').addEventListener('click', (e) => {
      const b = e.target.closest('[data-arsub]');
      if (!b) return;
      A.sub = b.dataset.arsub;
      renderSettings();
    });
    bindSettings();
  }

  function settingsForm(sub) {
    const d = A.data;
    const m = d.article;
    const kn = d.knowledge;
    const languages = (A.meta && A.meta.locales) || [];
    if (sub === 'details') {
      return `
        <div class="ar-field">
          <label>Cover image</label>
          <div class="ar-cover">
            <div class="ar-cover-box">${m.coverImage ? `<img src="${esc(m.coverImage)}" alt="cover">` : '<span>1200 × 650</span>'}</div>
            <div class="ar-cover-acts">
              <button class="btn btn-small" id="arCoverUpload">Upload</button>
              <button class="btn btn-small" id="arCoverGen">Generate</button>
              <button class="btn btn-small" id="arCoverLib">Library</button>
              <p class="ar-hintline">理想尺寸 1200×650，宽高比 1.85:1</p>
            </div>
          </div>
        </div>
        <div class="ar-field">
          <label for="arExcerpt">Excerpt</label>
          <textarea id="arExcerpt" class="ar-input ar-area" rows="3" placeholder="一句话摘要，会出现在列表和社媒分享里">${esc(m.excerpt)}</textarea>
          <div class="ar-field-acts">
            <button class="ar-mini" data-fill="excerpt" data-mode="ai">✦ 用 AI 写</button>
            <button class="ar-mini" data-fill="excerpt" data-mode="rule">Auto-fill</button>
          </div>
        </div>
        <div class="ar-row2">
          <div class="ar-field">
            <label for="arAuthor">Author</label>
            <input id="arAuthor" class="ar-input" value="${esc(d.item.author || '')}" placeholder="Aiden">
            <button class="ar-link" data-manage="authors">Manage authors</button>
          </div>
          <div class="ar-field">
            <label for="arCategory">Category</label>
            <input id="arCategory" class="ar-input" value="${esc(d.item.category || '')}" placeholder="Article">
            <button class="ar-link" data-manage="categories">Manage categories</button>
          </div>
        </div>
        <div class="ar-field">
          <label for="arTags">Tags</label>
          <input id="arTags" class="ar-input" value="${esc((d.item.tags || []).join(', '))}" placeholder="用逗号分隔，最多 8 个">
          <button class="ar-link" data-manage="tags">Manage tags</button>
        </div>
        <div class="ar-row2">
          <div class="ar-field">
            <label for="arLanguage">Language</label>
            <select id="arLanguage" class="ar-input">
              ${languages.map((l) => `<option value="${esc(l.id)}" ${l.id === d.item.language ? 'selected' : ''}>${esc(l.label)}</option>`).join('')}
            </select>
            <button class="ar-link" data-manage="languages">Manage languages</button>
          </div>
          <div class="ar-field">
            <label for="arDue">Due date (internal use)</label>
            <input id="arDue" type="date" class="ar-input" value="${esc(d.item.dueDate || '')}">
          </div>
        </div>`;
    }
    if (sub === 'seo') {
      const title = m.seoTitle || d.item.title;
      const url = `${(kn.website || 'https://your-site.com').replace(/\/$/, '')}/${m.slug || 'your-article-slug'}`;
      return `
        <div class="ar-field">
          <label>Search-engine result preview</label>
          <div class="ar-serp">
            <div class="ar-serp-url">${esc(url)}</div>
            <div class="ar-serp-title">${esc(title)}</div>
            <div class="ar-serp-desc">${esc(m.metaDescription || '还没有 meta description，搜索引擎会自己截一段正文。')}</div>
          </div>
        </div>
        <div class="ar-field">
          <label for="arSeoTitle">SEO title <span class="ar-count" id="arSeoTitleCount">${m.seoTitle.length} / ${A.meta.thresholds.seoTitle[1]}</span></label>
          <input id="arSeoTitle" class="ar-input" value="${esc(m.seoTitle)}" placeholder="${esc(d.item.title)}">
          <div class="ar-field-acts">
            <button class="ar-mini" data-fill="seoTitle" data-mode="ai">✦ 用 AI 写</button>
            <button class="ar-mini" data-fill="seoTitle" data-mode="rule">Auto-fill</button>
          </div>
        </div>
        <div class="ar-field">
          <label for="arSlug">Slug</label>
          <input id="arSlug" class="ar-input" value="${esc(m.slug)}" placeholder="auto-from-title">
          <p class="ar-hintline">只用小写字母、数字和连字符；留空会自动按标题生成</p>
        </div>
        <div class="ar-field">
          <label for="arMeta">Meta description <span class="ar-count" id="arMetaCount">${m.metaDescription.length} / ${A.meta.thresholds.meta[1]}</span></label>
          <textarea id="arMeta" class="ar-input ar-area" rows="3">${esc(m.metaDescription)}</textarea>
          <div class="ar-field-acts">
            <button class="ar-mini" data-fill="metaDescription" data-mode="ai">✦ 用 AI 写</button>
            <button class="ar-mini" data-fill="metaDescription" data-mode="rule">Auto-fill</button>
          </div>
        </div>`;
    }
    const icpOpts = (kn.audiences || []).map((a) => `<option value="${esc(a.name)}" ${a.name === m.custom.icp ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
    return `
      <p class="ar-note">自定义字段是给内部流转用的，不进文章正文。全局字段模板（后台配）还没做，这里是 3 个示例字段。</p>
      <div class="ar-field">
        <label for="arIcp">ICP（理想客户画像）</label>
        <select id="arIcp" class="ar-input">
          <option value="">未指定</option>
          ${icpOpts || '<option value="">Company Knowledge 里还没有受众</option>'}
        </select>
      </div>
      <div class="ar-field">
        <label for="arKpi">KPI</label>
        <input id="arKpi" class="ar-input" value="${esc(m.custom.kpi)}" placeholder="这条内容要推动什么指标，例如 50 个注册">
      </div>
      <div class="ar-field">
        <label for="arFooter">底部链接</label>
        <input id="arFooter" class="ar-input" value="${esc(m.custom.footerLink)}" placeholder="https://">
      </div>
      <button class="ar-link" data-manage="fields">Manage custom fields</button>`;
  }

  function bindSettings() {
    const form = $('arForm');
    if (!form) return;

    const saveField = (key, value) => patchArticle({ [key]: value });
    const saveItem = (key, value) => patchItem({ [key]: value });

    const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
    on('arExcerpt', 'change', (e) => saveField('excerpt', e.target.value));
    on('arSeoTitle', 'input', (e) => { const c = $('arSeoTitleCount'); if (c) c.textContent = `${e.target.value.length} / ${A.meta.thresholds.seoTitle[1]}`; });
    on('arSeoTitle', 'change', (e) => saveField('seoTitle', e.target.value));
    on('arMeta', 'input', (e) => { const c = $('arMetaCount'); if (c) c.textContent = `${e.target.value.length} / ${A.meta.thresholds.meta[1]}`; });
    on('arMeta', 'change', (e) => saveField('metaDescription', e.target.value));
    on('arSlug', 'change', (e) => saveField('slug', e.target.value));
    on('arKpi', 'change', (e) => saveField('custom.kpi', e.target.value));
    on('arFooter', 'change', (e) => saveField('custom.footerLink', e.target.value));
    on('arIcp', 'change', (e) => saveField('custom.icp', e.target.value));
    on('arAuthor', 'change', (e) => saveItem('author', e.target.value));
    on('arCategory', 'change', (e) => saveItem('category', e.target.value));
    on('arLanguage', 'change', (e) => saveItem('language', e.target.value));
    on('arDue', 'change', (e) => saveItem('dueDate', e.target.value));
    on('arTags', 'change', (e) => saveItem('tags', e.target.value.split(',').map((s) => s.trim()).filter(Boolean)));

    form.addEventListener('click', (e) => {
      const fill = e.target.closest('[data-fill]');
      if (fill) return autofill(fill.dataset.fill, fill.dataset.mode);
      const mg = e.target.closest('[data-manage]');
      if (mg) return toast('全局管理页还没做：' + mg.dataset.manage + ' 目前只在 Company Knowledge 里维护', false);
      const t = e.target.closest('#arCoverUpload');
      if (t) return pickCover();
      const g = e.target.closest('#arCoverGen');
      if (g) return toast('还没接图像模型，生图这里做不了；可以先用 Library 里的图', true);
      const lib = e.target.closest('#arCoverLib');
      if (lib) return pickCover(true);
    });
  }

  async function patchItem(patch) {
    try {
      const r = await api('/api/article/' + encodeURIComponent(A.id), { method: 'PATCH', body: patch });
      A.data = r.payload;
      A.render();
      toast('已保存');
    } catch (e) { toast('保存失败：' + e.message, true); }
  }

  async function patchArticle(patch) {
    const body = { article: {} };
    Object.keys(patch).forEach((k) => {
      if (k.startsWith('custom.')) {
        body.article.custom = body.article.custom || {};
        body.article.custom[k.slice(7)] = patch[k];
      } else {
        body.article[k] = patch[k];
      }
    });
    try {
      const r = await api('/api/article/' + encodeURIComponent(A.id), { method: 'PATCH', body });
      A.data = r.payload;
      A.render();
      markSaved('已保存');
    } catch (e) { toast('保存失败：' + e.message, true); }
  }

  async function autofill(field, mode) {
    try {
      const r = await api('/api/article/' + encodeURIComponent(A.id) + '/autofill', {
        method: 'POST',
        body: { field, mode, apply: true, body: A.data.body }
      });
      A.data = await api('/api/article/' + encodeURIComponent(A.id));
      A.render();
      toast(r.degraded ? `${field} 用规则填好了（模型没接入）` : `${field} 已自动填好`, !!r.degraded);
    } catch (e) { toast('自动填充失败：' + e.message, true); }
  }

  /* 封面：Library 直接从 Company Knowledge 的图库里挑，Upload 走本地上传 */
  async function pickCover(fromLibrary) {
    try {
      const kn = await api('/api/knowledge');
      const imgs = kn.images || [];
      if (!imgs.length) {
        toast(fromLibrary ? '素材库里还没有图，去 Company Knowledge → Visual style 上传' : '还没上传过图片', true);
        return;
      }
      const pick = imgs[0];
      if (fromLibrary && imgs.length > 1) {
        const list = imgs.slice(0, 6).map((i, n) => `${n + 1}. ${i.name}`).join('\n');
        const ans = window.prompt('选一张（输入序号）：\n' + list, '1');
        const idx = Math.max(1, Math.min(imgs.length, parseInt(ans, 10) || 1)) - 1;
        return patchArticle({ coverImage: imgs[idx].url });
      }
      return patchArticle({ coverImage: pick.url });
    } catch (e) { toast('选图失败：' + e.message, true); }
  }

  /* ---------- Tab 3：Audience ---------- */

  function renderAudience() {
    const d = A.data;
    const cats = d.audience || [];
    const cur = cats.find((c) => c.id === A.cat) || cats[0];
    const list = cats.map((c) => {
      const bound = (c.apps || []).filter((a) => a.state === 'bound').length;
      const cls = [c.id === A.cat ? 'is-on' : '', c.supported === false ? 'is-off' : ''].join(' ').trim();
      return `<button class="ar-cat ${cls}" data-cat="${c.id}">
        <span class="ar-cat-name">${esc(c.label)}</span>
        <span class="ar-cat-meta">${bound ? bound + ' 个已绑定' : c.supported === false ? '未接入' : '未绑定'}</span>
      </button>`;
    }).join('');

    $('arMain').innerHTML = `
      <div class="ar-audience">
        <aside class="ar-cats">${list}</aside>
        <div class="ar-cat-body">${categoryBody(cur)}</div>
      </div>`;
    $('arMain').querySelector('.ar-cats').addEventListener('click', (e) => {
      const b = e.target.closest('[data-cat]');
      if (!b) return;
      A.cat = b.dataset.cat;
      renderAudience();
      renderRail();
    });
    $('arMain').querySelector('.ar-cat-body').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'plugins') {
        close();
        window.SCA().setNav('strategy');
        setTimeout(() => {
          const it = document.querySelector('.st-item[data-st="plugins"]');
          if (it) it.click();
        }, 300);
        return;
      }
      if (b.dataset.act === 'create') return createSocial();
      if (b.dataset.act === 'ai') return createSocialWithAI();
    });
  }

  function categoryBody(c) {
    if (!c) return '';
    const apps = c.apps || [];
    const bound = apps.filter((a) => a.state === 'bound');
    const pending = apps.filter((a) => a.state === 'pending');
    const appCards = apps.map((a) => `
      <div class="ar-app is-${a.state}">
        <span class="ar-app-name">${esc(a.name)}</span>
        <span class="ar-app-state">${a.state === 'bound' ? '已绑定' + (a.account ? ' · ' + esc(a.account) : '') : a.state === 'pending' ? '装了未授权' : '未安装'}</span>
      </div>`).join('');

    const chCards = (c.channels || []).map((ch) => `
      <div class="ar-app is-bound">
        <span class="ar-app-name">${esc(ch.labelZh || ch.label)}</span>
        <span class="ar-app-state">${ch.rules} 条渠道规则</span>
      </div>`).join('');

    const head = `
      <div class="ar-cat-head">
        <h2>${esc(c.label)}</h2>
        <p>${esc(c.blurb)}</p>
        ${c.note ? `<p class="ar-note">${esc(c.note)}</p>` : ''}
      </div>`;

    if (c.supported === false) {
      return `${head}
        <div class="ar-empty">
          <div class="ar-empty-ico">◌</div>
          <p>这个分类还没接入。</p>
          <button class="btn" data-act="plugins">去 Plugins &amp; skills 看看现有应用</button>
        </div>`;
    }

    if (c.id === 'social') {
      return `${head}
        <div class="ar-platforms">
          ${(A.data.platforms || []).map((pl) => `
            <div class="ar-platform ${pl.supported ? 'is-on' : 'is-off'}">
              <span class="ar-platform-name">${esc(pl.label)}</span>
              ${pl.supported
    ? `<span class="ar-platform-meta">${pl.posts} 条 · ${esc((A.data.channels || []).length ? '' : '')}<button class="ar-mini" data-act="ai">Create with AI</button></span>`
    : `<span class="ar-platform-why">${esc(pl.why || '')}</span>`}
            </div>`).join('')}
        </div>
        <p class="ar-note">社媒帖是这篇文章的子资产：单独改文案、单独定时，改它们不会动到母文章。右侧面板里管理。</p>`;
    }

    if (!apps.length && !(c.channels || []).length) {
      return `${head}
        <div class="ar-empty">
          <div class="ar-empty-ico">◌</div>
          <p>还没有绑定任何账号。</p>
          <button class="btn btn-primary" data-act="plugins">${esc(c.addLabel)}</button>
        </div>`;
    }

    if (!bound.length && !(c.channels || []).length) {
      return `${head}
        <div class="ar-empty">
          <div class="ar-empty-ico">◌</div>
          <p>目录里有 ${apps.length} 个应用，一个都还没授权。</p>
          <button class="btn btn-primary" data-act="plugins">${esc(c.addLabel)}</button>
        </div>
        ${appCards}`;
    }

    return `${head}
      <div class="ar-apps">${appCards}${chCards}</div>
      ${pending.length ? `<p class="ar-note">${pending.length} 个应用装了但没授权，去 Plugins &amp; skills 补一下凭据。</p>` : ''}
      <button class="btn" data-act="plugins">${esc(c.addLabel)}</button>`;
  }

  async function createSocial() {
    try {
      const r = await api('/api/article/' + encodeURIComponent(A.id) + '/socials', { method: 'POST', body: { channel: 'x_post' } });
      A.data = r.payload;
      A.editingSocial = r.assetId;
      renderAudience();
      renderRail();
      toast('建好了一条 X 帖，右侧可以直接写');
    } catch (e) { toast('建帖失败：' + e.message, true); }
  }

  async function createSocialWithAI() {
    try {
      const r = await api('/api/article/' + encodeURIComponent(A.id) + '/generate', { method: 'POST', body: { target: 'social', channel: 'x_post' } });
      A.data = r.payload;
      renderAudience();
      renderRail();
      toast(r.degraded ? '模型没接入，用离线模板生成了一版社媒帖' : '社媒帖已生成', !!r.degraded);
    } catch (e) { toast('生成失败：' + e.message, true); }
  }

  /* ---------- 右侧面板：GEO & SEO / Socials ---------- */

  function renderRail() {
    const rail = $('arRail');
    if (!rail) return;
    if (A.tab === 'audience' && A.cat === 'social') rail.innerHTML = railSocials();
    else rail.innerHTML = railSeo();
    bindRailInputs();
  }

  /** 右侧面板的点击只挂一次（统一在这里分发），否则每次重绘都会叠加监听 */
  function onRailClick(e) {
    const show = e.target.closest('[data-show]');
    if (show) return jumpTo(show.dataset.target, show.dataset.field);
    if (!(A.tab === 'audience' && A.cat === 'social')) return;
    return socialRailClick(e);
  }

  function railSeo() {
    const d = A.data;
    const m = d.article;
    const rep = d.report;
    const cards = [
      { key: 'gap', label: 'Content gap insights', v: rep.gap.available ? rep.gap.pct : null, note: rep.gap.note },
      { key: 'seo', label: 'GEO & SEO basics', v: rep.seo.pct, note: `${rep.seo.passed}/${rep.seo.total} 项通过` },
      { key: 'read', label: 'Readability & structure', v: rep.readability.pct, note: `句均 ${rep.readability.avgWords} 词 · 长词 ${rep.readability.longPct}%` },
      { key: 'plag', label: 'Plagiarism check', v: null, note: rep.plagiarism.note },
      { key: 'words', label: 'Word count', v: null, note: `${rep.words} words · ${rep.readingMin} min` }
    ];
    const cardHtml = cards.map((c) => `
      <div class="ar-card" data-card="${c.key}">
        ${c.key === 'words' ? `<div class="ar-ring ar-ring-text-only"><b>${rep.words}</b><i>words</i></div>` : ring(c.v, 44, tone(c.v, 70, 40))}
        <div class="ar-card-body">
          <b>${esc(c.label)}</b>
          <span>${esc(c.note || '')}</span>
        </div>
      </div>`).join('');

    const alerts = rep.alerts.length
      ? rep.alerts.map((a) => `
        <li class="ar-alert ${a.critical ? 'is-bad' : 'is-soft'}">
          <i class="ar-alert-dot"></i>
          <span class="ar-alert-label">${esc(a.label)}</span>
          <span class="ar-alert-hint">${esc(a.hint)}</span>
          <button class="ar-show" data-show="${esc(a.key)}" data-target="${esc(a.target)}" data-field="${esc(a.field)}">show</button>
        </li>`).join('')
      : '<li class="ar-alert is-ok"><i class="ar-alert-dot"></i><span class="ar-alert-label">全部通过</span><span class="ar-alert-hint">这 12 项都满足了</span></li>';

    const regions = ((A.meta && A.meta.regions) || []);
    const curRegion = regions.find((r) => r.id === m.searchRegion) || { id: m.searchRegion, label: m.searchRegion, locale: m.searchLocale };

    return `
      <div class="ar-rail-head">
        <h3>Optimize for GEO &amp; SEO</h3>
        <p class="ar-rail-note">分数是本地规则算的，不是排名预测</p>
      </div>
      <div class="ar-kw">
        <label for="arKeyword">Focus keyword</label>
        <input id="arKeyword" class="ar-input" value="${esc(m.focusKeyword)}" placeholder="例如 ai content workflow">
        <div class="ar-loc">
          <select id="arRegion" class="ar-input ar-input-small">
            ${regions.map((r) => `<option value="${esc(r.id)}" ${r.id === curRegion.id ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}
          </select>
          <select id="arLocale" class="ar-input ar-input-small">
            ${((A.meta && A.meta.locales) || []).map((l) => `<option value="${esc(l.id)}" ${l.id === m.searchLocale ? 'selected' : ''}>${esc(l.label)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="ar-cards">${cardHtml}</div>
      <ul class="ar-alerts">${alerts}</ul>`;
  }

  function bindRailInputs() {
    const kw = $('arKeyword');
    if (kw) {
      let t = 0;
      kw.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => patchArticle({ focusKeyword: kw.value.trim() }), 700);
      });
    }
    const rg = $('arRegion');
    if (rg) rg.addEventListener('change', () => patchArticle({ searchRegion: rg.value }));
    const lc = $('arLocale');
    if (lc) lc.addEventListener('change', () => patchArticle({ searchLocale: lc.value }));

  }

  /** 点「show」：切到对应 Tab 并把目标字段滚到眼前、聚焦 */
  function jumpTo(target, field) {
    if (target === 'settings') {
      A.tab = 'settings';
      A.sub = field === 'metaDescription' || field === 'seoTitle' || field === 'slug' ? 'seo' : 'details';
      A.render();
      const id = { language: 'arLanguage', metaDescription: 'arMeta', seoTitle: 'arSeoTitle', slug: 'arSlug' }[field];
      setTimeout(() => {
        const el = id && $(id);
        if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.focus(); }
      }, 60);
      return;
    }
    if (target === 'seo-panel') {
      A.tab = 'write';
      A.render();
      setTimeout(() => { if ($('arKeyword')) $('arKeyword').focus(); }, 60);
      return;
    }
    A.tab = 'write';
    A.render();
    setTimeout(() => {
      if (field === 'title' && $('arH1')) $('arH1').focus();
      else if ($('arBody')) $('arBody').focus();
    }, 60);
  }

  function railSocials() {
    const d = A.data;
    const socials = d.socials || [];
    const items = socials.map((sp) => {
      const editing = A.editingSocial === sp.assetId;
      if (editing) {
        return `
        <div class="ar-social is-editing" data-as="${esc(sp.assetId)}">
          <div class="ar-social-head">
            <span class="ar-social-ch">${esc(sp.channelLabel)}</span>
            <span class="cl-pill cl-pill-${esc(sp.status)}">${sp.status === 'draft' ? 'Draft' : sp.status}</span>
          </div>
          <textarea class="ar-input ar-area ar-social-body" rows="5">${esc(sp.body)}</textarea>
          <div class="ar-social-row">
            <input type="date" class="ar-input ar-input-small" value="${esc(sp.scheduledAt || '')}" data-soc-date>
            <button class="btn btn-small btn-primary" data-soc-save>保存</button>
            <button class="btn btn-small btn-quiet" data-soc-cancel>取消</button>
            <button class="btn btn-small btn-quiet" data-soc-del>删除</button>
          </div>
        </div>`;
      }
      return `
        <div class="ar-social" data-as="${esc(sp.assetId)}">
          <div class="ar-social-head">
            <span class="ar-social-ch">${esc(sp.channelLabel)}</span>
            <span class="cl-pill cl-pill-${esc(sp.status)}">${sp.status === 'draft' ? 'Draft' : sp.status}</span>
            ${sp.scheduledAt ? `<span class="ar-social-date">${esc(sp.scheduledAt)}</span>` : ''}
          </div>
          <p class="ar-social-text">${esc((sp.body || '（还没有内容）').slice(0, 140))}</p>
          <div class="ar-social-row">
            <button class="btn btn-small" data-soc-edit>编辑</button>
            <button class="btn btn-small btn-quiet" data-soc-del>删除</button>
          </div>
        </div>`;
    }).join('');

    return `
      <div class="ar-rail-head">
        <h3>Socials</h3>
        <p class="ar-rail-note">这篇母文章派生出来的社媒子资产</p>
      </div>
      <div class="ar-social-acts">
        <button class="btn btn-small" data-soc-new>Create social post</button>
        <button class="btn btn-small btn-primary" data-soc-ai>Create with AI</button>
      </div>
      ${socials.length ? `<div class="ar-socials">${items}</div>` : '<p class="ar-social-empty">No social posts found for this article.</p>'}`;
  }

  async function socialRailClick(e) {
      const t = e.target;
      if (t.closest('[data-soc-new]')) return createSocial();
      if (t.closest('[data-soc-ai]')) return createSocialWithAI();
      const card = t.closest('[data-as]');
      if (!card) return;
      const assetId = card.dataset.as;
      if (t.closest('[data-soc-edit]')) {
        A.editingSocial = assetId;
        renderRail();
        return;
      }
      if (t.closest('[data-soc-cancel]')) {
        A.editingSocial = '';
        renderRail();
        return;
      }
      if (t.closest('[data-soc-del]')) {
        try {
          const r = await api('/api/article/' + encodeURIComponent(A.id) + '/socials/' + encodeURIComponent(assetId), { method: 'DELETE' });
          A.data = r.payload;
          A.editingSocial = '';
          renderRail();
          renderAudience();
          toast('已删除');
        } catch (err) { toast('删除失败：' + err.message, true); }
        return;
      }
      if (t.closest('[data-soc-save]')) {
        const body = card.querySelector('.ar-social-body').value;
        const date = card.querySelector('[data-soc-date]').value;
        try {
          const r = await api('/api/article/' + encodeURIComponent(A.id) + '/socials/' + encodeURIComponent(assetId), {
            method: 'POST', body: { body, scheduledAt: date }
          });
          A.data = r.payload;
          A.editingSocial = '';
          renderRail();
          toast('社媒帖已保存');
        } catch (err) { toast('保存失败：' + err.message, true); }
      }
  }

  /* ------------------------------ 顶部操作 ------------------------------ */

  function statusMenu() {
    const items = [
      { id: 'draft', label: 'Draft' },
      { id: 'pending', label: 'Pending approval' },
      { id: 'scheduled', label: 'Scheduled' },
      { id: 'published', label: 'Published' }
    ];
    const html = items.map((s) => `<button class="cl-menu-item" data-status="${s.id}"><span class="cl-menu-ico">${s.id === A.data.item.status ? '✓' : ''}</span><span>${esc(s.label)}</span></button>`).join('');
    showPop($('arStatusBtn'), `<div class="cl-menu-head">状态</div>${html}`, (e) => {
      const b = e.target.closest('[data-status]');
      if (b) patchItem({ status: b.dataset.status });
    });
  }

  function publishMenu() {
    const html = `
      <button class="cl-menu-item" data-pub="now"><span class="cl-menu-ico">↗</span><span>立即发布<small>只记状态，平台直发交给你的脚本</small></span></button>
      <button class="cl-menu-item" data-pub="schedule"><span class="cl-menu-ico">🗓</span><span>定时发布<small>排到日历上</small></span></button>
      <button class="cl-menu-item" data-pub="review"><span class="cl-menu-ico">✓</span><span>提交审核<small>变成 Pending approval</small></span></button>`;
    showPop($('arPublish'), html, async (e) => {
      const b = e.target.closest('[data-pub]');
      if (!b) return;
      const mode = b.dataset.pub;
      let date = '';
      if (mode === 'schedule') {
        const ans = window.prompt('哪天发？（YYYY-MM-DD）', new Date(Date.now() + 86400000).toISOString().slice(0, 10));
        if (!ans) return;
        date = ans.trim();
      }
      try {
        const r = await api('/api/article/' + encodeURIComponent(A.id) + '/publish', { method: 'POST', body: { mode, date } });
        A.data = r.payload;
        A.render();
        toast(r.warning || r.note || '已更新状态', !!r.warning);
      } catch (err) { toast('发布失败：' + err.message, true); }
    });
  }

  function moreMenu() {
    const html = `
      <button class="cl-menu-item" data-more="dup"><span class="cl-menu-ico">⧉</span><span>复制这篇</span></button>
      <button class="cl-menu-item" data-more="md"><span class="cl-menu-ico">↓</span><span>导出 Markdown</span></button>
      <button class="cl-menu-item" data-more="del"><span class="cl-menu-ico">✕</span><span>删除这篇</span></button>`;
    showPop($('arMore'), html, async (e) => {
      const b = e.target.closest('[data-more]');
      if (!b) return;
      if (b.dataset.more === 'md') {
        const blob = new Blob([A.data.body || ''], { type: 'text/markdown' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = (A.data.item.title || 'article') + '.md';
        a.click();
        URL.revokeObjectURL(a.href);
        return;
      }
      if (b.dataset.more === 'dup') {
        try {
          const r = await api('/api/content/' + encodeURIComponent(A.id) + '/duplicate', { method: 'POST', body: {} });
          toast('复制好了');
          if (r.item && r.item.id) open(r.item.id);
        } catch (err) { toast('复制失败：' + err.message, true); }
        return;
      }
      if (b.dataset.more === 'del') {
        if (!window.confirm(`删除「${A.data.item.title}」？文章和它的版本会一起删掉；已经派生的社媒帖会保留（它们是独立资产，在 Socials 面板里各自删）。`)) return;
        try {
          await api('/api/content/' + encodeURIComponent(A.id), { method: 'DELETE' });
          toast('已删除');
          close();
        } catch (err) { toast('删除失败：' + err.message, true); }
      }
    });
  }

  /** 简易气泡菜单：点外面就收 */
  let popEl = null;
  function showPop(anchor, html, onClick) {
    closePop();
    const r = anchor.getBoundingClientRect();
    const el = document.createElement('div');
    el.className = 'cl-menu ar-pop';
    el.innerHTML = html;
    el.style.position = 'fixed';
    el.style.top = Math.round(r.bottom + 6) + 'px';
    el.style.left = Math.round(Math.min(r.left, window.innerWidth - 300)) + 'px';
    el.style.zIndex = '90';
    document.body.appendChild(el);
    popEl = el;
    el.addEventListener('click', (e) => {
      const hit = onClick(e);
      closePop();
      return hit;
    });
    setTimeout(() => {
      document.addEventListener('pointerdown', onDocDown, true);
    }, 0);
  }

  function onDocDown(e) {
    if (popEl && !popEl.contains(e.target)) closePop();
  }

  function closePop() {
    if (popEl) { popEl.remove(); popEl = null; }
    document.removeEventListener('pointerdown', onDocDown, true);
  }

  /* ------------------------------ 初始化 ------------------------------ */

  A.init = function init() {
    $('arClose').onclick = close;
    $('arTitleBtn').onclick = () => {
      A.tab = 'write';
      A.render();
      setTimeout(() => { if ($('arH1')) $('arH1').focus(); }, 40);
    };
    $('arStatusBtn').onclick = (e) => { e.stopPropagation(); statusMenu(); };
    $('arPublish').onclick = (e) => { e.stopPropagation(); publishMenu(); };
    $('arMore').onclick = (e) => { e.stopPropagation(); moreMenu(); };
    $('arTabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-artab]');
      if (!b) return;
      A.tab = b.dataset.artab;
      A.render();
    });
    if ($('arRail')) $('arRail').addEventListener('click', onRailClick);
    $('arChat').onclick = () => {
      close();
      window.SCA().setNav('dashboard');
      toast('对话在 Dashboard 里；这篇文章的上下文已经带上 campaign 和关键词');
    };
    $('arComments').onclick = () => toast('评论还没做：本地单用户工作区，没有协作线程', true);
    $('arCollab').onclick = () => toast('协作成员还没做：本地单用户工作区', true);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !$('view-article').classList.contains('hidden')) {
        if (popEl) { closePop(); return; }
        if (A.dirty && $('arBody')) { saveBody(); return; }
        close();
      }
    });
  };

  A.open = open;
  A.close = close;
  A.isOpen = () => !$('view-article').classList.contains('hidden');

  // 脚本在 body 末尾，DOM 已经就绪；万一被挪到 head 里也能等到 DOMContentLoaded
  if (document.getElementById('arTabs')) A.init();
  else document.addEventListener('DOMContentLoaded', () => A.init());
}());
