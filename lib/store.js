'use strict';
/**
 * JSON 持久化。
 *
 * 教训来源（AGENTS.md 五点六）：并发写 JSON 会互相覆盖。
 * 这里的做法：进程内串行化 + 先写临时文件再 rename + 留一份 .bak。
 * 单进程使用足够；不要在多进程里同时写同一个文件。
 */
const fs = require('fs');
const path = require('path');

// 测试可以指到别的目录（SCA_DATA_DIR），避免跑测试把真数据/真凭据搅了
const DATA_DIR = process.env.SCA_DATA_DIR
  ? path.resolve(process.env.SCA_DATA_DIR)
  : path.join(__dirname, '..', 'data');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function filePath(name) {
  ensureDir();
  return path.join(DATA_DIR, name);
}

function readJson(name, fallback) {
  const p = filePath(name);
  if (!fs.existsSync(p)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    // 坏文件不静默吃掉：留证据，返回 fallback
    try { fs.copyFileSync(p, p + '.corrupt-' + Date.now()); } catch (_) {}
    console.error(`[store] ${name} 解析失败，已另存副本：${e.message}`);
    return fallback;
  }
}

function writeJsonUnsafe(name, data) {
  const p = filePath(name);
  const tmp = p + '.tmp';
  const text = JSON.stringify(data, null, 2);
  fs.writeFileSync(tmp, text, 'utf8');
  if (fs.existsSync(p)) {
    try { fs.copyFileSync(p, p + '.bak'); } catch (_) {}
  }
  fs.renameSync(tmp, p);
  return p;
}

// 写队列：保证同一时刻只有一个写在跑
let chain = Promise.resolve();
function writeJson(name, data) {
  chain = chain.then(() => writeJsonUnsafe(name, data)).catch((e) => {
    console.error('[store] 写入失败', e.message);
  });
  return chain;
}

module.exports = { DATA_DIR, readJson, writeJson, ensureDir };
