'use strict';
/* ==================== 对话渲染（Dashboard / Strategy 共用） ====================
 * 两个页面读的是同一份 data/chats.json，所以消息的 HTML 只在这里生成一次，
 * 否则两边的样式和行为会慢慢漂移。
 */
(function () {
  'use strict';

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  /** 极简 markdown：**粗体**、`代码`、## 标题、- 列表、段落换行 */
  function mdHtml(s) {
    let h = esc(String(s || ''));
    h = h.replace(/```[\s\S]*?```/g, (m) => `<pre class="code">${m.replace(/```/g, '').trim()}</pre>`);
    h = h.replace(/^#{2,4}\s+(.*)$/gm, '<strong class="md-h">$1</strong>');
    h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
    h = h.replace(/(?:^|\n)((?:[-*] .*(?:\n|$))+)/g, (m, block) => {
      const items = block.trim().split('\n').map((l) => `<li>${l.replace(/^[-*]\s+/, '')}</li>`).join('');
      return `\n<ul class="md-ul">${items}</ul>`;
    });
    return h.replace(/\n/g, '<br/>').replace(/<\/ul><br\/>/g, '</ul>');
  }

  const timeOf = (iso) => (iso ? String(iso).slice(11, 16) : '');

  function messageHtml(m) {
    if (m.role === 'user') {
      return `<div class="msg msg-user"><div class="msg-bubble">${esc(m.content)}</div><div class="msg-meta">${timeOf(m.at)}</div></div>`;
    }
    const acts = (m.actions || [])
      .map((a) => `<span class="act ${a.ok ? 'ok' : 'bad'}">${a.ok ? '✓' : '✕'} ${esc(a.summary || a.type)}</span>`)
      .join('');
    const err = m.error ? `<div class="msg-err">降级原因：${esc(m.error)}</div>` : '';
    const skill = m.skill ? esc('@' + m.skill) : '';
    return `<div class="msg msg-assistant">
      <div class="msg-bubble">${mdHtml(m.content)}</div>
      ${acts ? `<div class="msg-actions">${acts}</div>` : ''}
      ${err}
      <div class="msg-meta">${timeOf(m.at)}${skill ? ' · ' + skill : ''}</div>
    </div>`;
  }

  /** 一整段对话 → HTML；空对话返回空串（CSS 用 :empty 收掉留白） */
  function messagesHtml(chat) {
    if (!chat || !Array.isArray(chat.messages) || !chat.messages.length) return '';
    return chat.messages.map(messageHtml).join('');
  }

  function scrollBottom(el) {
    if (el) el.scrollTop = el.scrollHeight;
  }

  window.ChatUI = { mdHtml, messagesHtml, messageHtml, timeOf, scrollBottom, esc };
})();
