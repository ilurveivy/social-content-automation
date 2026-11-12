'use strict';
/* ============================================================
   Content 列表（StoryChief 式）
   左侧：分组 × 状态的导航树；右侧：筛选条 + 表格 + 分页。
   一行 = 一条内容资产；点标题进编辑器（生成/版本/质检/排期都在那儿）。
   ============================================================ */
(function () {
  const $ = (id) => document.getElementById(id);
  const SCA = () => window.SCA || {};
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = (n) => (n == null || n === '' ? '—' : Number(n).toLocaleString('en-US'));

  const STORE_COLS = 'sca.content.columns';
  const STORE_OPEN = 'sca.content.open';

  const CL = {
    meta: null,
    data: null,
    loaded: false,
    state: { group: 'content', status: '', q: '', sort: 'effectiveDate', dir: 'desc', page: 1, size: 20, media: 'files' },
    hidden: new Set(),
    sel: new Set(),
    open: new Set(['content', 'articles', 'social', 'broadcast', 'media']),
    current: null,        // 当前打开的内容条目
    media: null
  };

  /* ---------- 小工具 ---------- */

  const STATUS_LABEL = { draft: 'Draft', pending: 'Pending approval', scheduled: 'Scheduled', published: 'Published' };
  const APPROVAL_LABEL = { pending: 'Pending', approved: 'Approved' };

  const SUBS = [
    { id: '', label: 'All' },
    { id: 'assigned', label: 'Assigned to me' },
    { id: 'draft', label: 'Drafts' },
    { id: 'pending', label: 'Pending approval' },
    { id: 'scheduled', label: 'Scheduled' },
    { id: 'published', label: 'Published' }
  ];

  function readHidden() {
    try {
      const raw = localStorage.getItem(STORE_COLS);
      if (raw) (JSON.parse(raw) || []).forEach((k) => CL.hidden.add(k));
    } catch (e) { /* 存不进就算了，不影响用 */ }
  }
  function saveHidden() {
    try { localStorage.setItem(STORE_COLS, JSON.stringify([...CL.hidden])); } catch (e) {}
  }
  function readOpen() {
    try {
      const raw = localStorage.getItem(STORE_OPEN);
      if (raw) CL.open = new Set(JSON.parse(raw) || []);
    } catch (e) {}
  }
  function saveOpen() {
    try { localStorage.setItem(STORE_OPEN, JSON.stringify([...CL.open])); } catch (e) {}
  }

  function visibleCols() {
    const cols = (CL.meta && CL.meta.columns) || [];
    const on = cols.filter((c) => !CL.hidden.has(c.key));
    return on.length ? on : cols.filter((c) => c.key === 'title');
  }

  const groupMeta = () => (CL.meta.groups || []).find((g) => g.id === CL.state.group) || { id: 'content', label: 'Content', all: 'All content' };

  function emptyLabel() {
    const g = groupMeta();
    if (g.id === 'content') return 'Create content';
    if (g.id === 'media') return 'Upload files';
    const noun = { articles: 'article', social: 'social post', broadcast: 'broadcast' }[g.id] || 'content';
    return 'Create ' + noun;
  }

  /* ---------- 加载 ---------- */

  async function loadMeta() {
    if (CL.meta) return CL.meta;
    const m = await SCA().api('/api/content/meta');
    CL.meta = m;
    readHidden();
    readOpen();
    return m;
  }

  async function load() {
    await loadMeta();
    if (CL.state.group === 'media') return renderMedia();
    const qs = new URLSearchParams({
      group: CL.state.group, status: CL.state.status, q: CL.state.q,
      sort: CL.state.sort, dir: CL.state.dir, page: String(CL.state.page), size: String(CL.state.size)
    });
    const d = await SCA().api('/api/content?' + qs.toString());
    CL.data = d;
    renderCreateMenu();
    renderChips();
    renderNav();
    renderTable();
    renderFoot();
  }

  /* ---------- 左栏导航树 ---------- */

  function renderNav() {
    const counts = (CL.data && CL.data.counts) || {};
    const box = $('clNavTree');
    if (!box) return;
    const html = (CL.meta.groups || []).map((g) => {
      const c = counts[g.id] || {};
      const open = CL.open.has(g.id);
      const active = CL.state.group === g.id;
      if (g.id === 'media') {
        const subs = CL.meta.mediaSubs || [];
        return `<div class="cl-group ${open ? '' : 'is-closed'}">
          <button class="cl-group-head ${active && !CL.state.media ? 'is-on' : ''}" data-gtoggle="${g.id}" aria-expanded="${open}">
            <span class="cl-caret">${open ? '▾' : '▸'}</span><span class="cl-group-label">${esc(g.label)}</span>
          </button>
          <div class="cl-subs">
            ${subs.map((s) => `<button class="cl-sub ${active && CL.state.media === s.id ? 'is-active' : ''}" data-media="${s.id}">${esc(s.label)}</button>`).join('')}
          </div>
        </div>`;
      }
      return `<div class="cl-group ${open ? '' : 'is-closed'}">
        <button class="cl-group-head ${active && !CL.state.status ? 'is-on' : ''}" data-gtoggle="${g.id}" aria-expanded="${open}">
          <span class="cl-caret">${open ? '▾' : '▸'}</span><span class="cl-group-label">${esc(g.label)}</span>
        </button>
        <div class="cl-subs">
          <button class="cl-sub ${active && !CL.state.status ? 'is-active' : ''}" data-group="${g.id}" data-status="">
            <span>${esc(g.all)}</span><span class="cl-count">${c.all || 0}</span>
          </button>
          ${SUBS.slice(1).map((s) => `<button class="cl-sub ${active && CL.state.status === s.id ? 'is-active' : ''}" data-group="${g.id}" data-status="${s.id}">
            <span>${esc(s.label)}</span><span class="cl-count">${c[s.id] || 0}</span>
          </button>`).join('')}
        </div>
      </div>`;
    }).join('');
    box.innerHTML = html;

    box.querySelectorAll('[data-gtoggle]').forEach((b) => {
      b.onclick = () => {
        const id = b.dataset.gtoggle;
        if (CL.open.has(id)) CL.open.delete(id); else CL.open.add(id);
        saveOpen();
        renderNav();
      };
    });
    box.querySelectorAll('[data-group]').forEach((b) => {
      b.onclick = () => {
        CL.state.group = b.dataset.group;
        CL.state.status = b.dataset.status || '';
        CL.state.page = 1;
        CL.sel.clear();
        load().catch((e) => SCA().toast('加载失败：' + e.message, true));
      };
    });
    box.querySelectorAll('[data-media]').forEach((b) => {
      b.onclick = () => {
        CL.state.group = 'media';
        CL.state.media = b.dataset.media;
        CL.state.page = 1;
        load().catch((e) => SCA().toast('加载失败：' + e.message, true));
      };
    });
  }

  /* ---------- 工具条 ---------- */

  function renderChips() {
    const box = $('clChips');
    if (!box) return;
    const chips = [];
    if (CL.state.status) {
      const s = SUBS.find((x) => x.id === CL.state.status);
      chips.push(`<button class="cl-chip" data-drop="status">${esc(s ? s.label : CL.state.status)}<span aria-hidden="true">✕</span></button>`);
    }
    if (CL.state.q) {
      chips.push(`<button class="cl-chip" data-drop="q">“${esc(CL.state.q)}”<span aria-hidden="true">✕</span></button>`);
    }
    box.innerHTML = chips.join('');
    box.querySelectorAll('[data-drop]').forEach((b) => {
      b.onclick = () => {
        if (b.dataset.drop === 'q') { CL.state.q = ''; $('clSearch').value = ''; } else CL.state.status = '';
        CL.state.page = 1;
        load().catch(() => {});
      };
    });
  }

  function renderCreateMenu() {
    const box = $('clCreateMenu');
    if (!box || !CL.meta) return;
    box.innerHTML = (CL.meta.types || []).map((t) => `<button class="cl-menu-item" role="menuitem" data-new="${t.id}">
      <span class="cl-menu-ico" aria-hidden="true">${esc(t.icon)}</span><span>${esc(t.label)}</span>
    </button>`).join('');
    box.querySelectorAll('[data-new]').forEach((b) => {
      b.onclick = () => create(b.dataset.new);
    });
  }

  function renderColumnsPanel() {
    const box = $('clColumnsPanel');
    if (!box || !CL.meta) return;
    box.innerHTML = `<div class="cl-menu-head">Columns</div>` + (CL.meta.columns || []).map((c) => {
      const on = !CL.hidden.has(c.key);
      return `<label class="cl-menu-check"><input type="checkbox" data-col="${c.key}" ${on ? 'checked' : ''} ${c.key === 'title' ? 'disabled' : ''} /><span>${esc(c.label)}</span></label>`;
    }).join('');
    box.querySelectorAll('[data-col]').forEach((el) => {
      el.onchange = () => {
        const k = el.dataset.col;
        if (el.checked) CL.hidden.delete(k); else CL.hidden.add(k);
        if (!visibleCols().length) { CL.hidden.delete('title'); }
        saveHidden();
        renderColumnsPanel();
        renderTable();
      };
    });
  }

  function renderFilterMenu() {
    const box = $('clFilterMenu');
    if (!box) return;
    const rows = SUBS.map((s) => `<button class="cl-menu-item" role="menuitem" data-fstatus="${s.id}">
      <span>${esc(s.id ? s.label : 'All statuses')}</span>${CL.state.status === s.id ? '<span class="cl-menu-on">✓</span>' : ''}</button>`);
    box.innerHTML = `<div class="cl-menu-head">Filter</div>` + rows.join('');
    box.querySelectorAll('[data-fstatus]').forEach((b) => {
      b.onclick = () => {
        CL.state.status = b.dataset.fstatus;
        CL.state.page = 1;
        closeMenus();
        load().catch(() => {});
      };
    });
  }

  /* ---------- 表格 ---------- */

  function cell(item, col) {
    if (col.key === 'status') {
      const s = item.status || 'draft';
      return `<span class="cl-pill cl-pill-${esc(s)}">${esc(STATUS_LABEL[s] || s)}</span>`;
    }
    if (col.key === 'approval') {
      const a = item.approval;
      if (!a) return '<span class="cl-dim">—</span>';
      return `<span class="cl-pill cl-pill-appr-${esc(a)}">${esc(APPROVAL_LABEL[a] || a)}</span>`;
    }
    if (col.key === 'impressions' || col.key === 'reads') {
      // 没有站内分析 / GSC 之外的来源，恒为 —（不写 0）
      return `<span class="${item[col.key] == null ? 'cl-dim' : 'cl-num'}">${nf(item[col.key])}</span>`;
    }
    if (col.key === 'geo' || col.key === 'gap') {
      // 这两列对 article 是真算出来的（本地规则完成度 / 支柱覆盖），其它类型没有数据源就留 —
      if (item[col.key] == null) return '<span class="cl-dim">—</span>';
      const tip = col.key === 'geo'
        ? '文章 12 项检查的通过率（本地规则，不是排名预测）'
        : '正文对内容支柱的覆盖率';
      return `<span class="cl-num" title="${esc(tip)}">${nf(item[col.key])}%</span>`;
    }
    if (col.key === 'tags' || col.key === 'keywords') {
      const v = item[col.key] || [];
      return v.length ? esc(v.join(', ')) : '<span class="cl-dim">—</span>';
    }
    if (col.key === 'effectiveDate' || col.key === 'dueDate') {
      return item[col.key] ? esc(item[col.key]) : '<span class="cl-dim">—</span>';
    }
    const v = item[col.key];
    return v ? esc(v) : '<span class="cl-dim">—</span>';
  }

  function renderTable() {
    const cols = visibleCols();
    const items = (CL.data && CL.data.items) || [];
    const head = $('clThead');
    const body = $('clTbody');
    if (!head || !body) return;

    head.innerHTML = `<tr>${cols.map((c) => {
      const sorted = CL.state.sort === c.key;
      const arrow = sorted ? (CL.state.dir === 'asc' ? '↑' : '↓') : '';
      if (c.key === 'title') {
        const all = items.length > 0 && items.every((it) => CL.sel.has(it.id));
        return `<th class="cl-th cl-th-title" ${c.sort ? 'data-sort="' + c.key + '"' : ''}>
          <label class="cl-check-wrap"><input type="checkbox" id="clCheckAll" ${all ? 'checked' : ''} aria-label="全选" /></label>
          <span class="cl-th-label">Title <span class="cl-arrow">${arrow}</span></span></th>`;
      }
      return `<th class="cl-th" ${c.sort ? 'data-sort="' + c.key + '"' : ''}><span class="cl-th-label">${esc(c.label)} <span class="cl-arrow">${arrow}</span></span></th>`;
    }).join('')}<th class="cl-th cl-th-act" aria-label="操作"></th></tr>`;

    body.innerHTML = items.map((it) => `<tr class="cl-row" data-id="${esc(it.id)}">
      ${cols.map((c) => (c.key === 'title'
        ? `<td class="cl-td cl-td-title">
             <label class="cl-check-wrap"><input type="checkbox" class="cl-check" data-check="${esc(it.id)}" ${CL.sel.has(it.id) ? 'checked' : ''} aria-label="选择 ${esc(it.title)}" /></label>
             <button class="cl-title" data-act="edit" data-id="${esc(it.id)}" title="打开编辑器">${esc(it.title)}</button>
             <span class="cl-row-actions">
               <button class="cl-row-act" data-act="edit" data-id="${esc(it.id)}" title="编辑" aria-label="编辑">✎</button>
               <button class="cl-row-act" data-act="duplicate" data-id="${esc(it.id)}" title="复制" aria-label="复制">⧉</button>
               <button class="cl-row-act" data-act="schedule" data-id="${esc(it.id)}" title="排期" aria-label="排期">🗓</button>
               <button class="cl-row-act cl-row-del" data-act="delete" data-id="${esc(it.id)}" title="删除" aria-label="删除">🗑</button>
             </span>
           </td>`
        : `<td class="cl-td">${cell(it, c)}</td>`)).join('')}
      <td class="cl-td cl-td-act"></td>
    </tr>`).join('');

    const empty = !items.length;
    $('clEmpty').classList.toggle('hidden', !empty || CL.state.group === 'media');
    $('clTableWrap').classList.toggle('hidden', empty);
    $('clMedia').classList.add('hidden');
    if (empty) {
      $('clEmpty').querySelector('.cl-empty-text').textContent = 'You don\'t have any content that meets the selected criteria.';
      $('btnClEmptyCreate').textContent = emptyLabel();
    }

    head.querySelectorAll('[data-sort]').forEach((th) => {
      th.onclick = () => {
        const k = th.dataset.sort;
        if (CL.state.sort === k) CL.state.dir = CL.state.dir === 'asc' ? 'desc' : 'asc';
        else { CL.state.sort = k; CL.state.dir = 'asc'; }
        load().catch(() => {});
      };
    });
    const all = $('clCheckAll');
    if (all) all.onchange = () => {
      if (all.checked) items.forEach((it) => CL.sel.add(it.id));
      else items.forEach((it) => CL.sel.delete(it.id));
      renderTable();
      renderFoot();
    };
    body.querySelectorAll('[data-check]').forEach((el) => {
      el.onchange = () => {
        const id = el.dataset.check;
        if (el.checked) CL.sel.add(id); else CL.sel.delete(id);
        renderTable();
        renderFoot();
      };
    });
    body.querySelectorAll('[data-act]').forEach((el) => {
      el.onclick = (e) => {
        e.stopPropagation();
        const id = el.dataset.id;
        const act = el.dataset.act;
        if (act === 'edit') return openEditorById(id);
        if (act === 'duplicate') return duplicate(id);
        if (act === 'delete') return removeItem(id);
        if (act === 'schedule') return schedule(id);
      };
    });
  }

  function renderFoot() {
    const d = CL.data || { total: 0, from: 0, to: 0, pages: 1, page: 1 };
    const range = $('clRange');
    if (range) range.textContent = `${d.from}-${d.to} of ${d.total}`;
    const prev = $('btnClPrev');
    const next = $('btnClNext');
    if (prev) prev.disabled = d.page <= 1;
    if (next) next.disabled = d.page >= d.pages;
    const info = $('clSelInfo');
    if (info) {
      info.innerHTML = CL.sel.size
        ? `${CL.sel.size} selected
           <button class="btn btn-small" data-bulk="approve">Approve</button>
           <button class="btn btn-small" data-bulk="pending">Request approval</button>
           <button class="btn btn-small" data-bulk="delete">Delete</button>`
        : '';
      info.querySelectorAll('[data-bulk]').forEach((b) => {
        b.onclick = () => bulk(b.dataset.bulk);
      });
    }
    if (prev) prev.onclick = () => { if (d.page > 1) { CL.state.page = d.page - 1; load().catch(() => {}); } };
    if (next) next.onclick = () => { if (d.page < d.pages) { CL.state.page = d.page + 1; load().catch(() => {}); } };
  }

  /* ---------- Media 分组 ---------- */

  async function renderMedia() {
    const box = $('clMedia');
    if (!box) return;
    renderNav();
    $('clEmpty').classList.add('hidden');
    $('clTableWrap').classList.add('hidden');
    box.classList.remove('hidden');
    const sub = CL.state.media || 'files';

    if (sub === 'files') {
      box.innerHTML = '<p class="cl-media-loading">加载中…</p>';
      let kn = null;
      try { kn = await SCA().api('/api/knowledge'); } catch (e) { kn = null; }
      const imgs = (kn && kn.images) || [];
      const files = (kn && kn.files) || [];
      const cards = imgs.length
        ? imgs.map((im) => `<figure class="cl-media-item"><img src="${esc(im.url)}" alt="${esc(im.name)}" loading="lazy" /><figcaption>${esc(im.name)}</figcaption></figure>`).join('')
        : '';
      box.innerHTML = `<div class="cl-media-head">
          <h3 class="cl-media-title">Workspace files</h3>
          <p class="cl-media-sub">图片放在这里，可以直接被 Visual style 的 Style references 和 Logos 引用；文本文档在 Company Knowledge 的 Knowledge files 里。</p>
        </div>
        ${cards ? `<div class="cl-media-grid">${cards}</div>` : `<p class="cl-media-empty">还没有图片。到 Company Knowledge → Visual style 里 Upload 就会出现在这里。</p>`}
        <p class="cl-media-note">文本类知识文件：${files.length} 个（在 Company Knowledge 里管理）</p>`;
      return;
    }

    const label = (CL.meta.mediaSubs.find((s) => s.id === sub) || {}).label || sub;
    box.innerHTML = `<div class="cl-media-head"><h3 class="cl-media-title">${esc(label)}</h3>
      <p class="cl-media-sub">这个来源还没接入 —— 接 ${esc(label)} 需要它的 API key，本地工具默认不联网。</p>
      <p class="cl-media-note">可以直接在 Visual style 里 Upload 本地图片，效果一样。</p></div>`;
  }

  /* ---------- 动作 ---------- */

  function titleFor(type) {
    const t = (CL.meta.types || []).find((x) => x.id === type) || { label: 'content' };
    return 'Untitled ' + t.label;
  }

  async function create(type) {
    closeMenus();
    try {
      const r = await SCA().api('/api/content', { method: 'POST', body: { type, title: titleFor(type) } });
      SCA().toast('已创建：' + (r.item ? r.item.title : ''));
      await load();
      if (r.item) await openEditorById(r.item.id);
    } catch (e) { SCA().toast('创建失败：' + e.message, true); }
  }

  async function duplicate(id) {
    try {
      const r = await SCA().api('/api/content/' + id + '/duplicate', { method: 'POST' });
      SCA().toast('已复制：' + r.item.title);
      await load();
    } catch (e) { SCA().toast('复制失败：' + e.message, true); }
  }

  async function removeItem(id) {
    const it = ((CL.data && CL.data.items) || []).find((x) => x.id === id);
    const okDel = await confirmBox(`删除「${it ? it.title : '这条内容'}」？<br /><span class="muted small">会一起删掉它背后的渠道资产和版本。</span>`);
    if (!okDel) return;
    try {
      await SCA().api('/api/content/' + id, { method: 'DELETE' });
      CL.sel.delete(id);
      SCA().toast('已删除');
      await load();
    } catch (e) { SCA().toast('删除失败：' + e.message, true); }
  }

  async function schedule(id) {
    const it = ((CL.data && CL.data.items) || []).find((x) => x.id === id);
    const d = await promptBox('排期日期（YYYY-MM-DD，留空表示取消排期）', (it && it.effectiveDate) || '');
    if (d === null) return;
    try {
      await SCA().api('/api/content/' + id, { method: 'PATCH', body: { effectiveDate: d } });
      SCA().toast(d ? '已排期：' + d : '已取消排期');
      await load();
    } catch (e) { SCA().toast('排期失败：' + e.message, true); }
  }

  async function bulk(act) {
    const ids = [...CL.sel];
    if (!ids.length) return;
    if (act === 'delete') {
      const okDel = await confirmBox(`删除选中的 ${ids.length} 条内容？`);
      if (!okDel) return;
      for (const id of ids) await SCA().api('/api/content/' + id, { method: 'DELETE' }).catch(() => {});
      CL.sel.clear();
      SCA().toast('已删除 ' + ids.length + ' 条');
      return load();
    }
    for (const id of ids) {
      await SCA().api('/api/content/' + id + '/status', { method: 'POST', body: { approval: act } }).catch(() => {});
    }
    CL.sel.clear();
    SCA().toast(act === 'approve' ? '已批准' : '已提交审核');
    await load();
  }

  /* 简易弹窗（不引第三方的 confirm/prompt，样式跟界面一致） */
  function modal(html) {
    let m = $('clModal');
    if (!m) {
      m = document.createElement('div');
      m.id = 'clModal';
      m.className = 'modal hidden';
      m.innerHTML = '<div class="cl-dialog" role="dialog" aria-modal="true"></div>';
      document.body.appendChild(m);
    }
    m.querySelector('.cl-dialog').innerHTML = html;
    m.classList.remove('hidden');
    return m;
  }
  function closeModal() {
    const m = $('clModal');
    if (m) m.classList.add('hidden');
  }
  function confirmBox(text) {
    return new Promise((resolve) => {
      const m = modal(`<p class="cl-dialog-text">${text}</p>
        <div class="cl-dialog-acts"><button class="btn btn-small" data-x="0">Cancel</button>
        <button class="btn btn-primary btn-small" data-x="1">Delete</button></div>`);
      m.querySelectorAll('[data-x]').forEach((b) => {
        b.onclick = () => { closeModal(); resolve(b.dataset.x === '1'); };
      });
    });
  }
  function promptBox(label, value) {
    return new Promise((resolve) => {
      const m = modal(`<label class="cl-dialog-label">${esc(label)}<input id="clPromptInput" class="cl-dialog-input" type="date" value="${esc(value || '')}" /></label>
        <div class="cl-dialog-acts"><button class="btn btn-small" data-x="cancel">Cancel</button>
        <button class="btn btn-primary btn-small" data-x="ok">Save</button></div>`);
      const input = m.querySelector('#clPromptInput');
      m.querySelectorAll('[data-x]').forEach((b) => {
        b.onclick = () => {
          const v = input.value;
          closeModal();
          resolve(b.dataset.x === 'ok' ? v : null);
        };
      });
    });
  }

  function closeMenus() {
    ['clCreateMenu', 'clColumnsPanel', 'clFilterMenu'].forEach((id) => {
      const el = $(id);
      if (el) el.classList.add('hidden');
    });
    ['btnClCreate', 'btnClColumns', 'btnClFilter'].forEach((id) => {
      const el = $(id);
      if (el) el.setAttribute('aria-expanded', 'false');
    });
  }

  function toggleMenu(btnId, menuId) {
    const btn = $(btnId);
    const menu = $(menuId);
    if (!btn || !menu) return;
    const open = menu.classList.contains('hidden');
    closeMenus();
    menu.classList.toggle('hidden', !open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  /* ---------- 进 / 出编辑器 ---------- */

  async function openEditorById(id) {
    try {
      const r = await SCA().api('/api/content/' + id);
      const it = r.item;
      // 文章走 v12 的三 Tab 编辑器（Write / Settings / Audience）；其它类型还是老编辑器
      if (it && it.type === 'article' && window.AR && window.AR.open) {
        window.AR.open(id);
        return;
      }
      // v13：社媒类型的条目走「Buffer 渠道 + 发帖」那一屏（/content/segments/social-post）
      if (it && it.type === 'social' && window.SP && window.SP.open) {
        window.SP.open(id);
        return;
      }
      CL.current = it;
      const S = SCA().S;
      if (!it.campaignId || !it.assetId) {
        SCA().toast('这条内容没有可编辑的资产（可能是副本或原资产已删除）', true);
        return;
      }
      S.campaignId = it.campaignId;
      S.assetId = it.assetId;
      // 先刷新 state：新建的内容背后的 campaign 还不在 S.details 里，
      // 不刷新的话编辑器会渲染成上一个 campaign
      await SCA().loadState(true);
      showEditor();
      SCA().renderList();
      SCA().renderWorkspace();
      const stage = $('editor');
      if (stage) stage.scrollTop = 0;
    } catch (e) { SCA().toast('打不开：' + e.message, true); }
  }

  /** 只把界面切到编辑器（外部已经设好 S.campaignId / S.assetId 时用） */
  function showEditor() {
    const list = $('contentList');
    const ed = $('contentEditor');
    if (list) list.classList.add('hidden');
    if (ed) ed.classList.remove('hidden');
  }

  function backToList() {
    $('contentEditor').classList.add('hidden');
    $('contentList').classList.remove('hidden');
    CL.current = null;
    CL.sel.clear();
    load().catch(() => {});
  }

  /** 编辑器是否正开着（app.js 里的 setNav('content') 靠它决定要不要把列表盖上来） */
  function isEditing() {
    const el = $('contentEditor');
    return !!el && !el.classList.contains('hidden');
  }

  function open() {
    // 已经在编辑器里就别把列表盖上来（保存/生成之后会走到这里）
    if (isEditing()) return;
    $('contentEditor').classList.add('hidden');
    $('contentList').classList.remove('hidden');
    load().catch((e) => SCA().toast('加载失败：' + e.message, true));
  }

  /* ---------- 事件绑定 ---------- */

  let searchTimer = null;
  let navTimer = null;

  function init() {
    if (CL.loaded) return;
    CL.loaded = true;
    readHidden();
    readOpen();

    $('btnClCreate').onclick = () => toggleMenu('btnClCreate', 'clCreateMenu');
    $('btnClColumns').onclick = () => { renderColumnsPanel(); toggleMenu('btnClColumns', 'clColumnsPanel'); };
    $('btnClFilter').onclick = () => { renderFilterMenu(); toggleMenu('btnClFilter', 'clFilterMenu'); };
    $('btnClEmptyCreate').onclick = () => {
      const g = groupMeta();
      if (g.id === 'media') return;
      const t = g.id === 'articles' ? 'article' : g.id === 'social' ? 'social' : g.id === 'broadcast' ? 'newsletter' : 'article';
      create(t);
    };
    $('btnBackToList').onclick = backToList;

    $('clSearch').addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        CL.state.q = $('clSearch').value.trim();
        CL.state.page = 1;
        renderChips();
        load().catch(() => {});
      }, 250);
    });
    $('clNavSearch').addEventListener('input', () => {
      clearTimeout(navTimer);
      navTimer = setTimeout(() => {
        const v = $('clNavSearch').value.trim();
        // 左树搜索和 Quick search 是同一个条件：一边清空，另一边也跟着清
        CL.state.q = v;
        $('clSearch').value = v;
        CL.state.page = 1;
        renderChips();
        load().catch(() => {});
      }, 250);
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.cl-pop-wrap') && !e.target.closest('.cl-filter-wrap')) closeMenus();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeMenus();
    });
  }

  window.CL = {
    state: CL.state, data: () => CL.data, meta: () => CL.meta,
    init, open, isEditing, showEditor, load, renderNav, renderCreateMenu, backToList,
    openEditorById, current: () => CL.current,
    _toggle: toggleMenu
  };
})();
