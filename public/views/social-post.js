/**
 * Social post composer —— 对标 StoryChief 的 /content/segments/social-post
 * =====================================================================
 * 连接模型照 StoryChief：**不逐个平台 Connect**，先连 Buffer，再把 Buffer 里
 * 已经绑定的渠道拉下来勾选；发布由 Buffer 执行（本地工具不直连任何平台）。
 *
 * 三条诚实底线：
 *   1. 没连 Buffer → 左侧栏是状态 A，右侧编辑器整块置灰（就是规格里的锁态），
 *      **不会**拿假渠道填满列表。
 *   2. 渠道只来自 Buffer。规格里那 12 行是「排序依据」，Buffer 里没连的平台
 *      不会凭空出现 —— 编一行出来点一下才报错，比不显示更糟。
 *   3. 图片/视频必须是 Buffer 能抓到的公网地址。上传到本地后如果拿不到公网 URL，
 *      这里会明确说「Buffer 抓不到这张图」，不假装能发。
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const SCA = () => window.SCA || {};
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const EMPTY = {
    channelIds: [], mainContent: '', perChannel: {}, mediaUrl: '', mediaName: '',
    mediaKind: 'image', scheduleAt: null, mode: 'now', customize: false
  };

  const A = {
    id: null,
    data: null,
    state: Object.assign({}, EMPTY),
    buf: null,          // /api/buffer/status
    channels: [],
    filter: '',
    opened: false,
    loaded: false,
    saving: false,
    savedAt: null,
    saveTimer: null,
    tick: null,
    bus: null,          // 渠道拉取失败原因
    feedback: null,     // {kind:'ok'|'bad', html}
    attach: '',         // 'article' | 'link' | 'media' | 'pdf' | ''
    pop: ''             // 'emoji' | 'article' | ''
  };

  const api = (p, o) => SCA().api(p, o);
  /**
   * Buffer 那几个接口的 ok:false 是**正常业务状态**（未连接 / 授权失效 / 部分渠道失败），
   * 而 SCA().api 会把 ok:false 直接抛成异常（那是给「真错误」用的）。
   * 所以这里单独一个不抛的版本：只有网络层/500 才算失败。
   */
  async function rawJson(p, o) {
    const res = await fetch(p, Object.assign({ headers: { 'content-type': 'application/json' } }, o || {}, {
      body: o && o.body ? JSON.stringify(o.body) : undefined
    }));
    const data = await res.json().catch(() => ({}));
    if (res.status >= 500) throw new Error((data && (data.error || data.why)) || res.status + ' ' + res.statusText);
    return data;
  }
  const toast = (m, bad) => (SCA().toast ? SCA().toast(m, bad) : null);
  const brand = () => window.BRAND || { forChannel: () => ({ html: '', color: '#6b7280' }), rank: () => 99 };

  /* ---------------- 载入 ---------------- */

  async function loadBuffer(force) {
    try {
      A.buf = await rawJson('/api/buffer/status');
    } catch (e) {
      A.buf = { ok: false, connected: false, why: '取不到 Buffer 状态：' + e.message };
    }
    if (!A.buf.connected) {
      A.channels = [];
      A.bus = '';
      return;
    }
    try {
      const r = await rawJson('/api/buffer/channels' + (force ? '?refresh=1' : ''));
      A.channels = r.channels || [];
      A.bus = r.ok ? '' : (r.why || '渠道列表拉不下来');
      if (r.status) A.buf = r.status;
    } catch (e) {
      A.channels = [];
      A.bus = '渠道列表拉不下来：' + e.message;
    }
    // 勾了但 Buffer 里已经不存在的渠道：去掉，并且说清楚
    const live = new Set(A.channels.map((c) => c.id));
    const gone = A.state.channelIds.filter((id) => !live.has(id));
    if (gone.length) {
      A.state.channelIds = A.state.channelIds.filter((id) => live.has(id));
      toast(gone.length + ' 个已勾选的渠道在 Buffer 里没了（可能被解绑），已自动取消勾选', true);
      scheduleSave();
    }
  }

  async function loadDraft() {
    if (!A.id) return;
    const r = await api('/api/draft/social-post?id=' + encodeURIComponent(A.id));
    A.data = r;
    A.state = Object.assign({}, EMPTY, r.state || {});
    A.savedAt = null;
    if (A.state.mode === 'schedule' && A.state.scheduleAt) A.state.mode = 'schedule';
  }

  async function open(id) {
    A.id = id;
    A.opened = true;
    A.loaded = false;
    A.feedback = null;
    A.attach = '';
    A.pop = '';
    const v = $('view-social-post');
    if (v) v.classList.remove('hidden');
    paint();
    try {
      await loadDraft();
      await loadBuffer(false);
    } catch (e) {
      A.feedback = { kind: 'bad', html: '草稿打不开：' + esc(e.message) };
    }
    A.loaded = true;
    paint();
    renderChannels();
    renderPerChannel();
    renderFeedback();
    if (A.tick) clearInterval(A.tick);
    A.tick = setInterval(paintSaved, 1000);
  }

  function close() {
    if (A.saveTimer) { clearTimeout(A.saveTimer); A.saveTimer = null; saveNow(); }
    if (A.tick) { clearInterval(A.tick); A.tick = null; }
    A.opened = false;
    const v = $('view-social-post');
    if (v) v.classList.add('hidden');
    if (window.CL && window.CL.open) { window.CL.open(); if (window.CL.load) window.CL.load(); }
  }

  /* ---------------- 自动保存（防抖 2s） ---------------- */

  function scheduleSave() {
    if (A.saveTimer) clearTimeout(A.saveTimer);
    A.saveTimer = setTimeout(saveNow, 2000);
  }

  async function saveNow() {
    A.saveTimer = null;
    if (!A.id || A.saving) return;
    A.saving = true;
    try {
      await api('/api/draft/social-post', { method: 'POST', body: { id: A.id, state: A.state } });
      A.savedAt = Date.now();
      paintSaved();
    } catch (e) {
      toast('草稿没存上：' + e.message, true);
    } finally {
      A.saving = false;
    }
  }

  function paintSaved() {
    const el = $('spSaved');
    if (!el) return;
    if (!A.savedAt) { el.textContent = A.saving ? 'Saving…' : 'Not saved yet'; return; }
    const s = Math.max(0, Math.round((Date.now() - A.savedAt) / 1000));
    el.textContent = s < 2 ? 'Saved just now' : 'Saved ' + s + ' sec ago';
  }

  /* ---------------- 绘制 ---------------- */

  function paint() {
    const v = $('view-social-post');
    if (v && !A.opened) v.classList.add('hidden');
    const title = $('spTitle');
    if (title) title.textContent = (A.data && A.data.title) || 'Social post';

    const pill = $('spStatus');
    if (pill) {
      const st = (A.data && A.data.status) || 'draft';
      pill.textContent = st.charAt(0).toUpperCase() + st.slice(1);
    }
    paintSaved();

    // 未连 Buffer：编辑器锁死（规格里的锁态）
    const locked = !(A.buf && A.buf.connected);
    const card = $('spCard');
    if (card) card.classList.toggle('is-locked', locked);
    const lock = $('spLock');
    if (lock) lock.classList.toggle('hidden', !locked);

    const ta = $('spText');
    if (ta && document.activeElement !== ta && ta.value !== A.state.mainContent) ta.value = A.state.mainContent;

    document.querySelectorAll('.sp-tab').forEach((b) => {
      b.classList.toggle('is-on', b.dataset.sptab === A.state.mode);
    });
    const sch = $('spSchedule');
    if (sch) sch.classList.toggle('hidden', A.state.mode !== 'schedule');
    const when = $('spWhen');
    if (when && document.activeElement !== when) when.value = toLocalInput(A.state.scheduleAt);

    const cz = $('spCustomize');
    if (cz) cz.checked = !!A.state.customize;

    const pub = $('spPublish');
    if (pub) {
      const blocked = locked || !A.state.channelIds.length || !String(A.state.mainContent || '').trim();
      pub.disabled = blocked;
      pub.title = locked
        ? '先连 Buffer'
        : !A.state.channelIds.length
          ? '至少勾一个渠道'
          : !String(A.state.mainContent || '').trim()
            ? '文案还是空的'
            : '提交给 Buffer';
      pub.textContent = A.state.mode === 'schedule' ? 'Schedule' : 'Publish';
    }
    paintMedia();
  }

  function toLocalInput(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const p = (n) => String(n).padStart(2, '0');
    return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) + 'T' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());
  }

  function fromLocalInput(v) {
    if (!v) return null;
    const d = new Date(v + ':00Z');   // 输入就是 UTC，所以直接加 Z
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  function renderChannels() {
    const box = $('spChannels');
    if (!box) return;
    const connected = !!(A.buf && A.buf.connected);
    const search = $('spSearchWrap');
    if (search) search.classList.toggle('hidden', !connected);
    // 连上之后不再留一个按钮占位：连接入口只在没连的时候出现
    const connect = $('spConnect');
    if (connect) connect.classList.toggle('hidden', connected);
    const links = $('spSideLinks');
    if (links) links.classList.toggle('hidden', !connected);

    const top = $('spExpired');
    if (top) {
      const expired = !!(A.buf && A.buf.connected && A.buf.expired);
      top.classList.toggle('hidden', !expired);
    }
    if (A.bus) {
      box.innerHTML = '<p class="sp-side-err">' + esc(A.bus) + '</p>';
      return;
    }
    if (!connected) {
      // 状态 A：未连接。上面已经有标题+说明+Connect Buffer 按钮了，
      // 这里再写一遍就是同一句话说三遍 —— 留空。
      box.innerHTML = '';
      return;
    }
    const f = A.filter.trim().toLowerCase();
    const list = A.channels
      .slice()
      .sort((a, b) => {
        const ka = (brand().forChannel(a).key) || '';
        const kb = (brand().forChannel(b).key) || '';
        const ra = brand().rank(ka);
        const rb = brand().rank(kb);
        if (ra !== rb) return ra - rb;
        return String(a.displayName || a.name || '').localeCompare(String(b.displayName || b.name || ''));
      })
      .filter((c) => !f || String(c.displayName || c.name || '').toLowerCase().includes(f));

    if (!list.length) {
      box.innerHTML = '<div class="sp-empty"><p>'
        + (f ? '没有匹配「' + esc(f) + '」的渠道' : 'Buffer 里这个组织下还没有绑定社媒渠道。去 Buffer 后台加一个，再点 Refresh channels。')
        + '</p></div>';
      return;
    }
    box.innerHTML = list.map((c) => {
      const ic = brand().forChannel(c);
      const on = A.state.channelIds.includes(c.id);
      return [
        '<label class="sp-ch' + (on ? ' is-on' : '') + '" data-ch="' + esc(c.id) + '" style="--sp-brand:' + esc(ic.color) + '">',
        '  <input type="checkbox" ' + (on ? 'checked' : '') + ' data-spcheck="' + esc(c.id) + '">',
        '  <span class="sp-ch-ic">' + ic.html + '</span>',
        '  <span class="sp-ch-name">' + esc(c.displayName || c.name) + '</span>',
        c.isQueuePaused ? '  <span class="sp-ch-pause" title="Buffer 队列被暂停">paused</span>' : '',
        '</label>'
      ].join('');
    }).join('');
  }

  function renderPerChannel() {
    const box = $('spPerChannel');
    if (!box) return;
    const on = A.state.customize && A.state.channelIds.length;
    box.classList.toggle('hidden', !on);
    if (!on) { box.innerHTML = ''; return; }
    box.innerHTML = A.state.channelIds.map((id) => {
      const c = A.channels.find((x) => x.id === id) || { id, displayName: id };
      const ic = brand().forChannel(c);
      const own = A.state.perChannel[id] || {};
      return [
        '<div class="sp-pc">',
        '  <div class="sp-pc-head"><span class="sp-ch-ic">' + ic.html + '</span><span>' + esc(c.displayName || c.name || id) + '</span>',
        '    <span class="sp-pc-hint">' + (String(own.content || '').trim() ? '用这份专属文案' : '没填就用主文案') + '</span></div>',
        '  <textarea class="sp-pc-text" data-pc="' + esc(id) + '" placeholder="只给这个渠道的文案（留空 = 用主文案）">' + esc(own.content || '') + '</textarea>',
        '</div>'
      ].join('');
    }).join('');
  }

  function paintMedia() {
    const box = $('spMediaBox');
    if (!box) return;
    if (!A.state.mediaUrl) { box.classList.add('hidden'); box.innerHTML = ''; return; }
    box.classList.remove('hidden');
    const isImg = A.state.mediaKind !== 'document' && !/\.(mp4|mov|webm)(\?|$)/i.test(A.state.mediaUrl);
    box.innerHTML = [
      '<div class="sp-media-card">',
      isImg ? '  <img class="sp-media-thumb" src="' + esc(A.state.mediaUrl) + '" alt="">' : '  <span class="sp-media-file">' + esc(A.state.mediaName || 'file') + '</span>',
      '  <div class="sp-media-meta"><b>' + esc(A.state.mediaName || '') + '</b>',
      '    <a href="' + esc(A.state.mediaUrl) + '" target="_blank" rel="noopener">' + esc(A.state.mediaUrl) + '</a>',
      '  </div>',
      '  <button class="sp-x" data-sp="rmmedia" title="移除">×</button>',
      '</div>',
      publicWarn()
    ].join('');
  }

  function publicWarn() {
    if (!A.state.mediaUrl) return '';
    const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])/i.test(A.state.mediaUrl);
    if (!isLocal) return '';
    return '<p class="sp-warn">⚠️ 这个地址是本机的（127.0.0.1），Buffer 服务器抓不到，发布时会失败。要真带图，把 SCA_PUBLIC_BASE 配成公网地址，或先把文件传到 R2/S3 再把公网 URL 填进来。</p>';
  }

  function renderFeedback() {
    const el = $('spFeedback');
    if (!el) return;
    if (!A.feedback) { el.className = 'sp-feedback hidden'; el.innerHTML = ''; return; }
    el.className = 'sp-feedback ' + (A.feedback.kind === 'ok' ? 'is-ok' : 'is-bad');
    el.innerHTML = A.feedback.html;
  }

  function fb(kind, html) { A.feedback = { kind, html }; renderFeedback(); }

  /* ---------------- 渠道勾选 ---------------- */

  function toggleChannel(id, on) {
    const has = A.state.channelIds.includes(id);
    if (on && !has) A.state.channelIds.push(id);
    if (!on && has) A.state.channelIds = A.state.channelIds.filter((x) => x !== id);
    if (!A.state.channelIds.includes(id) && A.state.perChannel[id]) delete A.state.perChannel[id];
    scheduleSave();
    renderChannels();
    renderPerChannel();
    paint();
  }

  /* ---------------- 连接 Buffer ---------------- */

  async function connectBuffer() {
    if (A.buf && A.buf.connected) { await refreshChannels(); return; }
    try {
      const r = await rawJson('/api/buffer/auth-url');
      if (r && r.ok && r.url) {
        const w = window.open(r.url, 'buffer_oauth', 'width=560,height=760');
        if (!w) toast('浏览器拦了弹窗：允许弹窗后再点一次，或者直接把授权链接复制到新标签页', true);
        fb('bad', '<b>等你完成 Buffer 授权</b><br>授权完成后这一页会自动刷新渠道列表。没反应的话点左侧的 Refresh channels。');
        return;
      }
      // 没配 OAuth client → 降级到粘 API Key（这就是「两种都做、自动降级」）
      showKeyPrompt(r && r.why ? r.why : '');
    } catch (e) {
      toast('连不上 Buffer：' + e.message, true);
    }
  }

  function showKeyPrompt(why) {
    fb('bad', [
      '<b>OAuth 这条路现在用不了</b><br>',
      '<span>' + esc(why || '') + '</span>',
      '<div class="sp-key">',
      '  <input id="spKeyInput" placeholder="粘一个 Buffer Personal API Key（publish.buffer.com/settings/api）" autocomplete="off">',
      '  <button class="sp-primary" data-sp="savekey">Connect</button>',
      '</div>',
      '<span class="sp-sub">只想自己用的话，API Key 这条更省事：不用注册 OAuth app、不用回调域名。</span>'
    ].join(''));
    const i = $('spKeyInput');
    if (i) i.focus();
  }

  async function saveKey() {
    const i = $('spKeyInput');
    const key = i ? i.value.trim() : '';
    if (!key) { toast('先把 key 粘进来', true); return; }
    try {
      const r = await api('/api/buffer/api-key', { method: 'POST', body: { key } });
      A.buf = r.status || A.buf;
      await loadBuffer(true);
      A.feedback = null;
      paint(); renderChannels(); renderPerChannel(); renderFeedback();
      toast('Buffer 已连接：' + (A.channels.length ? A.channels.length + ' 个渠道' : '但没拉到渠道'));
    } catch (e) {
      toast(e.message, true);
      fb('bad', 'API key 没通过：' + esc(e.message));
    }
  }

  async function refreshChannels() {
    await loadBuffer(true);
    renderChannels(); renderPerChannel(); paint();
    toast(A.bus ? A.bus : '渠道已刷新：' + A.channels.length + ' 个', !!A.bus);
  }

  async function disconnect() {
    if (!window.confirm('断开 Buffer？已勾选的渠道会保留在草稿里，但没法再发布。')) return;
    await api('/api/buffer/disconnect', { method: 'POST', body: {} });
    A.state.channelIds = [];
    await loadBuffer(true);
    paint(); renderChannels(); renderPerChannel();
  }

  /* ---------------- 发布 ---------------- */

  async function publish() {
    const st = A.state;
    if (!A.buf || !A.buf.connected) { toast('先连 Buffer', true); return; }
    if (!st.channelIds.length) { toast('至少勾一个渠道', true); return; }
    if (!String(st.mainContent || '').trim()) { toast('文案还是空的', true); return; }
    if (st.mode === 'schedule' && !st.scheduleAt) { toast('选一个 UTC 时间，或者切回 Publish now', true); return; }
    const btn = $('spPublish');
    if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
    try {
      const r = await rawJson('/api/buffer/create-post', {
        method: 'POST',
        body: {
          channelIds: st.channelIds,
          mainContent: st.mainContent,
          channelCustomContent: st.perChannel,
          mediaUrl: st.mediaUrl,
          mediaKind: st.mediaKind,
          scheduleAt: st.mode === 'schedule' ? st.scheduleAt : null,
          contentId: A.id
        }
      });
      const rows = (r.results || []).map((x) => {
        const c = A.channels.find((y) => y.id === x.channelId);
        const nm = (c && (c.displayName || c.name)) || x.channelId;
        return x.ok
          ? '<li class="ok">✓ ' + esc(nm) + (x.postId ? ' · <code>' + esc(x.postId) + '</code>' : '') + '</li>'
          : '<li class="bad">✗ ' + esc(nm) + '：' + esc(x.error || '未知错误') + '</li>';
      }).join('');
      if (r.ok) {
        fb('ok', [
          '<b>已提交给 Buffer（' + r.okCount + '/' + r.total + ' 个渠道）</b>',
          '<ul class="sp-res">' + rows + '</ul>',
          '<span class="sp-sub">' + esc(r.note || '') + ' · <a href="https://publish.buffer.com/queue" target="_blank" rel="noopener">去 Buffer 看这个任务</a></span>'
        ].join(''));
        A.savedAt = Date.now();
      } else {
        fb('bad', [
          '<b>有 ' + r.failCount + ' 个渠道没发出去</b>',
          '<ul class="sp-res">' + rows + '</ul>',
          '<span class="sp-sub">' + esc(r.note || '') + '</span>'
        ].join(''));
      }
      toast(r.ok ? 'Buffer 已接单' : '部分渠道失败，看下方红条', !r.ok);
    } catch (e) {
      fb('bad', '<b>发布失败</b><br>' + esc(e.message));
      toast('发布失败：' + e.message, true);
    } finally {
      if (btn) paint();
    }
  }

  /* ---------------- 附件 ---------------- */

  function pickFile(kind) {
    const input = $('spFile');
    if (!input) return;
    input.setAttribute('accept', kind === 'pdf' ? 'application/pdf' : 'image/png,image/jpeg,image/gif,image/webp,video/mp4,video/quicktime,video/webm');
    input.dataset.kind = kind;
    input.value = '';
    input.click();
  }

  async function uploadFile(file, kind) {
    if (!file) return;
    const max = 8 * 1024 * 1024;
    if (file.size > max) { toast('文件超过 8 MB', true); return; }
    const dataUrl = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result || ''));
      fr.onerror = () => reject(new Error('读文件失败'));
      fr.readAsDataURL(file);
    });
    try {
      const r = await api('/api/social-post/media', { method: 'POST', body: { filename: file.name, dataUrl } });
      A.state.mediaUrl = r.url;
      A.state.mediaName = r.name;
      A.state.mediaKind = kind === 'pdf' ? 'document' : 'image';
      scheduleSave();
      paint();
      if (r.why) toast(r.why, true);
    } catch (e) {
      toast('上传失败：' + e.message, true);
    }
  }

  async function pickArticle() {
    A.pop = A.pop === 'article' ? '' : 'article';
    const pop = $('spPop');
    if (!pop) return;
    if (!A.pop) { pop.classList.add('hidden'); return; }
    pop.classList.remove('hidden');
    pop.innerHTML = '<div class="sp-pop-h">插入一篇文章</div><div class="sp-pop-body">载入中…</div>';
    try {
      const r = await api('/api/content?group=articles&size=8');
      const items = (r.items || []).slice(0, 8);
      pop.innerHTML = [
        '<div class="sp-pop-h">插入一篇文章</div>',
        '<div class="sp-pop-body">',
        items.length
          ? items.map((it) => '<button class="sp-pop-item" data-art="' + esc(it.id) + '"><b>' + esc(it.title) + '</b><span>' + esc(it.status) + '</span></button>').join('')
          : '<p class="sp-side-err">还没有文章</p>',
        '</div>'
      ].join('');
    } catch (e) {
      pop.innerHTML = '<div class="sp-pop-h">插入一篇文章</div><div class="sp-pop-body sp-side-err">' + esc(e.message) + '</div>';
    }
  }

  function insertAtCursor(text) {
    const ta = $('spText');
    if (!ta) { A.state.mainContent += text; scheduleSave(); return; }
    const start = ta.selectionStart || 0;
    const end = ta.selectionEnd || 0;
    ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
    ta.selectionStart = ta.selectionEnd = start + text.length;
    A.state.mainContent = ta.value;
    scheduleSave();
    paint();
    ta.focus();
  }

  function toggleEmoji() {
    A.pop = A.pop === 'emoji' ? '' : 'emoji';
    const pop = $('spPop');
    if (!pop) return;
    if (!A.pop) { pop.classList.add('hidden'); return; }
    const EMO = ['😀', '😅', '🙌', '🔥', '💡', '✅', '⚠️', '🚀', '📌', '👉', '🎯', '📈', '🧠', '⚡️', '❤️', '👀', '🛠', '📣', '🎉', '☕️', '🧵', '🔗', '💬', '🙏'];
    pop.classList.remove('hidden');
    pop.innerHTML = '<div class="sp-pop-h">Emoji</div><div class="sp-pop-emoji">' + EMO.map((e) => '<button data-emo="' + e + '">' + e + '</button>').join('') + '</div>';
  }

  async function aiDraft() {
    const idea = window.prompt('用一句话说清你想表达什么（AI 据此写一版）：', A.state.mainContent ? A.state.mainContent.slice(0, 80) : '');
    if (idea == null) return;
    if (!String(idea).trim()) { toast('先写一句 idea', true); return; }
    const first = A.state.channelIds[0] ? (A.channels.find((c) => c.id === A.state.channelIds[0]) || {}) : {};
    const svc = String(first.service || 'x').toLowerCase();
    const map = { twitter: 'x_post', x: 'x_post', facebook: 'x_post', instagram: 'x_post', linkedin: 'x_post', threads: 'x_post', bluesky: 'x_post', tiktok: 'tiktok_script', youtube: 'youtube_script', pinterest: 'x_post', googlebusiness: 'x_post', slack: 'x_post' };
    try {
      const r = await api('/api/social-post/generate', { method: 'POST', body: { idea, channel: map[svc] || 'x_post' } });
      const ta = $('spText');
      A.state.mainContent = r.text || '';
      if (ta) ta.value = A.state.mainContent;
      scheduleSave();
      paint();
      toast(r.degraded ? '没有可用模型，用的是离线模板：' + r.degraded : 'AI 写好了，可以直接改');
    } catch (e) {
      toast('AI 生成失败：' + e.message, true);
    }
  }

  /* ---------------- 更多菜单 ---------------- */

  const MORE = [
    { id: 'updates', label: 'Updates' },
    { id: 'fields', label: 'Custom fields' },
    { id: 'versions', label: 'Version History' },
    { id: 'campaigns', label: 'Manage campaigns' },
    { id: 'dup', label: 'Duplicate' },
    { id: 'dupto', label: 'Duplicate to' },
    { id: 'del', label: 'Delete', danger: true },
    { id: 'help', label: 'Visit Help center' }
  ];

  function toggleMore() {
    const m = $('spMoreMenu');
    if (!m) return;
    const open = m.classList.contains('hidden');
    m.classList.toggle('hidden', !open);
    if (open) {
      m.innerHTML = MORE.map((x) => '<button class="sp-mi' + (x.danger ? ' is-danger' : '') + '" data-spmore="' + x.id + '">' + esc(x.label) + '</button>').join('');
    }
  }

  async function onMore(id) {
    const m = $('spMoreMenu');
    if (m) m.classList.add('hidden');
    if (id === 'dup') {
      try {
        const r = await api('/api/draft/social-post/duplicate', { method: 'POST', body: { id: A.id } });
        toast('已复制成新草稿：' + r.item.title);
        if (window.CL && window.CL.load) window.CL.load();
      } catch (e) { toast('复制失败：' + e.message, true); }
      return;
    }
    if (id === 'dupto') {
      toast('Duplicate to = 同时复制到另一个 campaign。这个工具里一个草稿只属于一个 campaign，先用 Duplicate 复制再改归属。');
      return;
    }
    if (id === 'del') {
      if (!window.confirm('删除这条社媒草稿？')) return;
      try {
        await api('/api/content/' + encodeURIComponent(A.id), { method: 'DELETE' });
        toast('已删除');
        close();
      } catch (e) { toast('删除失败：' + e.message, true); }
      return;
    }
    if (id === 'help') {
      window.open('https://support.buffer.com/', '_blank', 'noopener');
      return;
    }
    if (id === 'versions') {
      toast('版本历史：社媒草稿只有一个自动保存版本，每 2 秒存一次，覆盖上一条');
      return;
    }
    if (id === 'campaigns') {
      toast('这个草稿的 campaign 就在 Content 列表里那一行；要换归属，在列表里重新排期');
      return;
    }
    if (id === 'fields') {
      toast('Custom fields 是 StoryChief 的自定义字段；本地工具没做，不想给你一个假的输入框');
      return;
    }
    toast('Updates：没有新消息（这一屏是本地草稿，没有协作通知）');
  }

  /* ---------------- 事件绑定（只绑一次） ---------------- */

  function bind() {
    const root = $('view-social-post');
    if (!root || root.dataset.bound === '1') return;
    root.dataset.bound = '1';

    $('spBack').onclick = close;
    $('spConnect').onclick = connectBuffer;
    $('spPublish').onclick = publish;
    $('spMore').onclick = (e) => { e.stopPropagation(); toggleMore(); };
    $('spChat').onclick = () => toast('Chat / Collaborate 是 StoryChief 的团队功能；本地工具是单人工作区，不假装有别人在线');
    $('spCollab').onclick = () => toast('协作：本地单人工作区，没有邀请成员这件事');
    $('spSaved').onclick = () => { if (A.id) saveNow().then(() => toast('已保存')); };

    root.addEventListener('click', async (e) => {
      const t = e.target;
      if (t.closest('#spMoreMenu')) {
        const mi = t.closest('[data-spmore]');
        if (mi) await onMore(mi.dataset.spmore);
        return;
      }
      if (!t.closest('#spMore') && !t.closest('#spMoreMenu')) {
        const m = $('spMoreMenu');
        if (m && !m.classList.contains('hidden')) m.classList.add('hidden');
      }
      const act = t.closest('[data-sp]');
      if (act) {
        const a = act.dataset.sp;
        if (a === 'connect') return connectBuffer();
        if (a === 'savekey') return saveKey();
        if (a === 'rmmedia') { A.state.mediaUrl = ''; A.state.mediaName = ''; scheduleSave(); paint(); return; }
        if (a === 'disconnect') return disconnect();
        if (a === 'refresh') return refreshChannels();
      }
      const tab = t.closest('.sp-tab');
      if (tab) {
        A.state.mode = tab.dataset.sptab;
        if (A.state.mode === 'schedule' && !A.state.scheduleAt) {
          const d = new Date(Date.now() + 60 * 60 * 1000);
          A.state.scheduleAt = d.toISOString();
        }
        scheduleSave(); paint();
        return;
      }
      const chk = t.closest('[data-spcheck]');
      if (chk) { toggleChannel(chk.dataset.spcheck, chk.checked); return; }
      const ch = t.closest('.sp-ch');
      if (ch && !chk) {
        const id = ch.dataset.ch;
        toggleChannel(id, !A.state.channelIds.includes(id));
        return;
      }
      if (t.closest('[data-spattach]')) {
        const kind = t.closest('[data-spattach]').dataset.spattach;
        if (kind === 'media') return pickFile('media');
        if (kind === 'pdf') return pickFile('pdf');
        if (kind === 'article') return pickArticle();
        if (kind === 'link') {
          const u = window.prompt('粘贴要放进帖子的链接（https://…）：', '');
          if (u == null) return;
          const url = String(u).trim();
          if (!/^https?:\/\/\S+$/i.test(url)) { toast('这不像一个 http(s) 链接', true); return; }
          insertAtCursor((A.state.mainContent ? '\n' : '') + url);
          return;
        }
      }
      const emo = t.closest('[data-emo]');
      if (emo) { insertAtCursor(emo.dataset.emo); A.pop = ''; const p = $('spPop'); if (p) p.classList.add('hidden'); return; }
      const art = t.closest('[data-art]');
      if (art) {
        const id = art.dataset.art;
        A.pop = '';
        const p = $('spPop'); if (p) p.classList.add('hidden');
        insertAtCursor('\n' + (art.querySelector('b') || {}).textContent);
        toast('已插入标题。本地工具不发站，所以没有公开链接可以插 —— 要链接得先有线上地址');
        return;
      }
      if (t.closest('#spEmoji')) return toggleEmoji();
      if (t.closest('#spAI')) return aiDraft();
      const pop = $('spPop');
      if (pop && !t.closest('#spPop')) pop.classList.add('hidden');
    });

    $('spText').addEventListener('input', (e) => {
      A.state.mainContent = e.target.value;
      scheduleSave();
      const pub = $('spPublish');
      if (pub) {
        const locked = !(A.buf && A.buf.connected);
        pub.disabled = locked || !A.state.channelIds.length || !A.state.mainContent.trim();
      }
    });

    $('spText').addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveNow().then(() => toast('已保存'));
      }
    });

    $('spSearch').addEventListener('input', (e) => { A.filter = e.target.value || ''; renderChannels(); });

    $('spWhen').addEventListener('change', (e) => {
      A.state.scheduleAt = fromLocalInput(e.target.value);
      scheduleSave();
      paint();
    });

    $('spCustomize').addEventListener('change', (e) => {
      A.state.customize = e.target.checked;
      scheduleSave(); renderPerChannel(); paint();
    });

    root.addEventListener('input', (e) => {
      const pc = e.target.closest('[data-pc]');
      if (!pc) return;
      const id = pc.dataset.pc;
      A.state.perChannel[id] = Object.assign({}, A.state.perChannel[id] || {}, { content: pc.value });
      scheduleSave();
    });

    $('spFile').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      const kind = e.target.dataset.kind || 'media';
      if (f) uploadFile(f, kind);
    });
  }

  /* ---------------- 对外 ---------------- */

  const SP = {
    id: () => A.id,
    state: () => A.state,
    data: () => A.data,
    buffer: () => A.buf,
    channels: () => A.channels,
    open,
    close,
    isOpen: () => A.opened,
    reload: async () => { if (A.id) { await loadDraft(); await loadBuffer(true); paint(); renderChannels(); renderPerChannel(); } },
    refreshChannels,
    _A: A
  };
  window.SP = SP;

  function init() {
    bind();
    // OAuth 回调带着 ?buffer=connected 回来：先弹个提示，再进这一屏
    try {
      const q = new URLSearchParams(location.search);
      const flag = q.get('buffer');
      if (flag === 'connected') {
        toast('Buffer 已连接');
        history.replaceState(null, '', location.pathname + '#content');
      } else if (flag === 'error') {
        toast('Buffer 授权失败：' + (q.get('reason') || '未知原因'), true);
        history.replaceState(null, '', location.pathname + '#content');
      }
    } catch (e) { /* file:// 下忽略 */ }
  }

  if (document.getElementById('view-social-post')) init();
  else document.addEventListener('DOMContentLoaded', init);
})();
