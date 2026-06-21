/**
 * ろくそう日程調整 — Node.js サーバー (Express)
 * GitHub → Railway などにデプロイして使います。Googleの灰色帯は出ません。
 *
 * データ保存: JSON ファイル（DATA_FILE 環境変数。既定 ./data.json）。
 *   Railway では「Volume」を作って /data にマウントし、
 *   環境変数 DATA_FILE=/data/db.json を設定すると再デプロイ後もデータが残ります。
 * 管理者パスワード: 初回アクセス時に画面から設定（ハッシュではなく簡易保存）。
 */
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');

function loadDB() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch (e) { return { adminPw: null, events: {}, responses: {} }; }
}
function saveDB(db) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}
let db = loadDB();

function uid() { return Math.random().toString(36).slice(2, 10); }
function requireAdmin(pw) {
  if (!db.adminPw || String(pw) !== String(db.adminPw)) {
    throw new Error('管理者認証が必要です。再ログインしてください。');
  }
}

/* ---- API (クライアントの call() から呼ばれる) ---- */
const api = {
  api_isAdminSet() { return !!db.adminPw; },
  api_setupAdmin(pw) {
    if (db.adminPw) throw new Error('すでに管理者パスワードが設定されています。');
    pw = String(pw || '').trim();
    if (!pw) throw new Error('パスワードを入力してください。');
    db.adminPw = pw; saveDB(db); return { ok: true };
  },
  api_checkAdmin(pw) { return !!db.adminPw && String(pw) === String(db.adminPw); },

  api_adminListEvents(pw) {
    requireAdmin(pw);
    return Object.values(db.events)
      .sort((a, b) => b.created - a.created)
      .map(e => ({
        id: e.id, name: e.name, dateCount: (e.dates || []).length,
        respCount: (db.responses[e.id] || []).length, deadline: e.deadline, created: e.created
      }));
  },
  api_createEvent(pw, data) {
    requireAdmin(pw);
    const id = uid();
    db.events[id] = {
      id, name: data.name, desc: data.desc || '', dates: data.dates || [],
      tri: !!data.tri, deadline: data.deadline || '', created: Date.now()
    };
    db.responses[id] = db.responses[id] || [];
    saveDB(db); return { ok: true, id };
  },
  api_updateEvent(pw, id, data) {
    requireAdmin(pw);
    const ev = db.events[id];
    if (!ev) throw new Error('イベントが見つかりません。');
    ev.name = data.name; ev.desc = data.desc || ''; ev.dates = data.dates || [];
    ev.tri = !!data.tri; ev.deadline = data.deadline || '';
    if (!ev.tri) {
      (db.responses[id] || []).forEach(r => {
        for (const k in r.marks) { if (r.marks[k] === '△') delete r.marks[k]; }
      });
    }
    saveDB(db); return { ok: true };
  },
  api_deleteEvent(pw, id) {
    requireAdmin(pw);
    delete db.events[id]; delete db.responses[id]; saveDB(db); return { ok: true };
  },

  api_getEvent(id) {
    const ev = db.events[id];
    if (!ev) return null;
    return Object.assign({}, ev, { responses: db.responses[id] || [] });
  },
  api_submitResponse(id, name, marks, pw) {
    const ev = db.events[id];
    if (!ev) throw new Error('イベントが見つかりません。');
    const admin = !!db.adminPw && String(pw) === String(db.adminPw);
    if (ev.deadline) {
      const t = new Date(ev.deadline).getTime();
      if (!isNaN(t) && t < Date.now() && !admin) throw new Error('回答の受付は終了しました。');
    }
    name = String(name || '').trim();
    if (!name) throw new Error('お名前を入力してください。');
    const list = db.responses[id] || (db.responses[id] = []);
    const ex = list.find(r => r.name === name);
    if (ex) { ex.marks = marks || {}; saveDB(db); return { ok: true, updated: true }; }
    list.push({ name, marks: marks || {} }); saveDB(db); return { ok: true, updated: false };
  }
};

/* ---- RPC エンドポイント ---- */
app.post('/api/call', (req, res) => {
  const { fn, args } = req.body || {};
  if (!api[fn]) return res.status(400).json({ error: 'unknown function: ' + fn });
  try {
    const result = api[fn].apply(null, args || []);
    res.json({ result });
  } catch (e) {
    res.json({ error: e.message || String(e) });
  }
});

/* ?e=ID で来ても index.html を返す（SPA的に処理） */
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('ろくそう日程調整 listening on ' + PORT));
