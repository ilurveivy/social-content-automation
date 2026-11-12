'use strict';
/**
 * 验收脚本的公共收尾：把 company 还原成快照的样子。
 *
 * 为什么不能只 POST /api/knowledge：那个接口只认文本/列表字段，
 * 受众、内容支柱、brand voices 各自走增删改接口 —— 不显式还原就会在测试库里留下垃圾数据。
 */
async function restoreCompany(baseUrl, snap) {
  if (!snap) return;
  const post = (path, body) => fetch(baseUrl + path, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  const del = (path) => fetch(baseUrl + path, { method: 'DELETE' });

  // 1) 文本 / 列表字段
  await post('/api/knowledge', { company: snap });

  // 2) 三类结构化条数：先删多的，再补少的
  const live = (await (await fetch(baseUrl + '/api/knowledge')).json()).company || {};
  const KINDS = [
    ['voice', 'brandVoices'],
    ['audience', 'audiences'],
    ['pillar', 'contentPillars']
  ];
  for (const [kind, key] of KINDS) {
    const want = Array.isArray(snap[key]) ? snap[key] : [];
    const have = Array.isArray(live[key]) ? live[key] : [];
    for (const x of have) {
      if (!want.some((w) => w && w.id === x.id)) await del('/api/knowledge/' + kind + '/' + encodeURIComponent(x.id));
    }
  }
  // 重新读一次再补，避免刚删完就用旧视图判断
  const live2 = (await (await fetch(baseUrl + '/api/knowledge')).json()).company || {};
  for (const [kind, key] of KINDS) {
    const want = Array.isArray(snap[key]) ? snap[key] : [];
    const have = Array.isArray(live2[key]) ? live2[key] : [];
    for (const w of want) {
      if (!w || !w.id) continue;
      const same = have.find((x) => x.id === w.id);
      if (same) { await post('/api/knowledge/' + kind, w); continue; }
      // 同 id 已经不在了（多半是被测试删掉）：先按名字找，避免越跑越多同名条目
      const byName = have.find((x) => String(x.name || '') === String(w.name || ''));
      if (byName) continue;
      const { id, ...rest } = w;
      await post('/api/knowledge/' + kind, rest);
    }
  }
}

module.exports = { restoreCompany };
