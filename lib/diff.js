'use strict';
/** 行级 diff（LCS）。够用、无依赖；超过 400 行就退化成"整段替换"，避免卡死。 */
function diffLines(a, b) {
  const A = (a || '').split('\n');
  const B = (b || '').split('\n');
  if (A.length > 400 || B.length > 400) {
    return [
      ...A.map((line) => ({ type: 'del', line })),
      ...B.map((line) => ({ type: 'add', line }))
    ];
  }
  const m = A.length, n = B.length;
  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (A[i] === B[j]) { out.push({ type: 'same', line: A[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: 'del', line: A[i++] }); }
    else { out.push({ type: 'add', line: B[j++] }); }
  }
  while (i < m) out.push({ type: 'del', line: A[i++] });
  while (j < n) out.push({ type: 'add', line: B[j++] });
  return out;
}

function summarize(d) {
  return {
    added: d.filter((x) => x.type === 'add').length,
    removed: d.filter((x) => x.type === 'del').length
  };
}

module.exports = { diffLines, summarize };
