'use strict';
/** 对话记录：dashboard 中间的 agent 聊天 + 右侧 Recent chats */
const crypto = require('crypto');
const store = require('./store');

const FILE = 'chats.json';
const MAX_CHATS = 60;
const MAX_MESSAGES = 80;

function load() {
  const j = store.readJson(FILE, null);
  if (!j || !Array.isArray(j.chats)) return { version: 1, chats: [] };
  return j;
}

function save(db) {
  db.chats = db.chats.slice(0, MAX_CHATS);
  return store.writeJson(FILE, db);
}

const uid = (p) => p + '_' + crypto.randomBytes(5).toString('hex');

function create(db, title) {
  const chat = {
    id: uid('ch'),
    title: (title || '新对话').slice(0, 60),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: []
  };
  db.chats.unshift(chat);
  return chat;
}

function addMessage(chat, msg) {
  const m = {
    id: uid('msg'),
    role: msg.role === 'assistant' ? 'assistant' : 'user',
    content: String(msg.content || ''),
    at: new Date().toISOString(),
    ...(msg.actions && msg.actions.length ? { actions: msg.actions } : {}),
    ...(msg.error ? { error: String(msg.error).slice(0, 400) } : {}),
    // 这条回复是按哪个技能跑的（对话里会显示 @技能名）
    ...(msg.skill ? { skill: String(msg.skill).slice(0, 60) } : {})
  };
  chat.messages.push(m);
  if (chat.messages.length > MAX_MESSAGES) chat.messages = chat.messages.slice(-MAX_MESSAGES);
  chat.updatedAt = m.at;
  // 首条用户消息拿来当标题
  if (chat.title === '新对话') {
    const firstUser = chat.messages.find((x) => x.role === 'user');
    if (firstUser) chat.title = firstUser.content.replace(/\s+/g, ' ').slice(0, 40) || '新对话';
  }
  return m;
}

function list(db) {
  return (db || load()).chats.map((c) => ({
    id: c.id,
    title: c.title,
    updatedAt: c.updatedAt,
    messages: c.messages.length,
    preview: (c.messages.filter((m) => m.role === 'user').pop() || {}).content || ''
  }));
}

function get(db, id) {
  return (db || load()).chats.find((c) => c.id === id) || null;
}

function remove(db, id) {
  const before = db.chats.length;
  db.chats = db.chats.filter((c) => c.id !== id);
  return db.chats.length < before;
}

module.exports = { load, save, create, addMessage, list, get, remove };
