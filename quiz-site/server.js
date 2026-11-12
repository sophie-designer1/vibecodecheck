'use strict';
// 학생 퀴즈 / 설문 사이트 서버 (QR 코드로 접속)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { createStore } = require('./store');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY = 200 * 1024;
const MAX_QUESTIONS = 50;
const MAX_PARTICIPANTS = 500;

const store = createStore();
const newId = () => crypto.randomBytes(4).toString('hex'); // 8자리
const newKey = () => crypto.randomBytes(12).toString('hex');
const safeEq = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// ---------- 유틸 ----------
function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}
function readJson(req) {
  if (req.body !== undefined && req.body !== null && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return Promise.resolve(req.body); // Vercel이 미리 파싱한 경우
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject({ code: 413, msg: '요청이 너무 큽니다' }); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); }
      catch (_) { reject({ code: 400, msg: '잘못된 JSON' }); }
    });
  });
}
const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);

// status: lobby(대기실) → running(진행 중) → closed(마감)
function publicQuiz(q, entries) {
  return {
    id: q.id, title: q.title, type: q.type, status: q.status,
    count: entries.length,
    names: q.status === 'lobby' ? entries.map(e => e.name) : undefined,
    // 시작 전에는 문제를 보내지 않음 (미리 보기 방지). 정답은 항상 보내지 않음
    questionCount: q.questions.length,
    questions: q.status === 'lobby' ? [] : q.questions.map(x => ({ text: x.text, options: x.options })),
  };
}

function leaderboard(q, entries) {
  const total = q.questions.length;
  const rows = entries.filter(e => e.done).map(e => ({ name: e.name, score: e.score, total, ms: e.ms }));
  rows.sort((a, b) => b.score - a.score || a.ms - b.ms || a.name.localeCompare(b.name));
  let rank = 0, prev = null;
  rows.forEach((r, i) => {
    const key = r.score + ':' + r.ms;
    if (key !== prev) { rank = i + 1; prev = key; }
    r.rank = rank;
  });
  return rows;
}

function surveyResults(q, entries) {
  const done = entries.filter(e => e.done);
  return {
    responses: done.length,
    questions: q.questions.map((qu, qi) => {
      const counts = qu.options.map(() => 0);
      done.forEach(e => { if (counts[e.answers[qi]] !== undefined) counts[e.answers[qi]]++; });
      return { text: qu.text, options: qu.options, counts };
    }),
  };
}

function validateCreate(b) {
  const type = b.type === 'survey' ? 'survey' : 'quiz';
  const title = clean(b.title, 80);
  if (!title) throw { code: 400, msg: '제목을 입력하세요' };
  if (!Array.isArray(b.questions) || !b.questions.length) throw { code: 400, msg: '질문을 1개 이상 추가하세요' };
  if (b.questions.length > MAX_QUESTIONS) throw { code: 400, msg: `질문은 최대 ${MAX_QUESTIONS}개입니다` };
  const questions = b.questions.map((x, i) => {
    const text = clean(x.text, 200);
    const options = (Array.isArray(x.options) ? x.options : []).map(o => clean(o, 100)).filter(Boolean);
    if (!text) throw { code: 400, msg: `${i + 1}번 질문 내용이 비어 있습니다` };
    if (options.length < 2 || options.length > 6) throw { code: 400, msg: `${i + 1}번 질문은 보기가 2~6개여야 합니다` };
    const out = { text, options };
    if (type === 'quiz') {
      const raw = Array.isArray(x.options) ? x.options.map(o => clean(o, 100)) : [];
      // 빈 보기를 걸러낸 뒤의 인덱스로 정답 보정
      const idx = raw.slice(0, Number(x.answer) + 1).filter(Boolean).length - 1;
      if (!Number.isInteger(Number(x.answer)) || !raw[Number(x.answer)] || idx < 0)
        throw { code: 400, msg: `${i + 1}번 질문의 정답을 선택하세요` };
      out.answer = idx;
    }
    return out;
  });
  return { type, title, questions };
}

// ---------- API ----------
async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1); // 'api' 제거
  const m = req.method;

  if (m === 'GET' && parts[0] === 'qr') {
    const text = url.searchParams.get('text') || '';
    if (!/^https?:\/\//.test(text) || text.length > 500) return send(res, 400, { error: '잘못된 주소' });
    const svg = await QRCode.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    return send(res, 200, svg, 'image/svg+xml');
  }

  if (parts[0] !== 'quizzes') return send(res, 404, { error: '없는 API' });

  if (m === 'POST' && parts.length === 1) {
    const v = validateCreate(await readJson(req));
    if ((await store.count()) > 5000) return send(res, 507, { error: '저장 공간이 가득 찼습니다' });
    const q = { id: newId(), hostKey: newKey(), ...v, status: 'lobby', createdAt: Date.now() };
    await store.createQuiz(q);
    return send(res, 201, { id: q.id, hostKey: q.hostKey });
  }

  const id = /^\w{1,32}$/.test(parts[1] || '') ? parts[1] : '';
  const q = id && await store.getQuiz(id);
  if (!q) return send(res, 404, { error: '퀴즈를 찾을 수 없습니다' });
  const sub = parts[2];

  if (m === 'GET' && !sub) return send(res, 200, publicQuiz(q, await store.listEntries(id)));

  if (m === 'GET' && sub === 'results') {
    const entries = await store.listEntries(id);
    const waiting = entries.filter(e => !e.done).map(e => e.name);
    return send(res, 200, q.type === 'quiz'
      ? { type: 'quiz', status: q.status, waiting, title: q.title, total: q.questions.length, participants: entries.length, rows: leaderboard(q, entries) }
      : { type: 'survey', status: q.status, waiting, title: q.title, ...surveyResults(q, entries) });
  }

  if (m === 'POST' && sub === 'join') {
    const b = await readJson(req);
    const name = clean(b.name, 20);
    if (q.status === 'closed') return send(res, 403, { error: '참여가 마감되었습니다' });
    if (!name) return send(res, 400, { error: '이름을 입력하세요' });
    if ((await store.listEntries(id)).length >= MAX_PARTICIPANTS) return send(res, 403, { error: '참여 인원이 가득 찼습니다' });
    const entry = { name, token: newKey(), startedAt: q.status === 'running' ? Date.now() : null, done: false, answers: [], score: 0, ms: 0 };
    try { await store.addEntry(id, entry); }
    catch (e) { if (e.conflict) return send(res, 409, { error: '이미 사용 중인 이름입니다. 다른 이름을 입력하세요' }); throw e; }
    return send(res, 200, { token: entry.token });
  }

  if (m === 'POST' && sub === 'submit') {
    const b = await readJson(req);
    const e = await store.getEntryByToken(id, String(b.token ?? ''));
    if (!e) return send(res, 403, { error: '참여 정보를 찾을 수 없습니다' });
    if (e.done) return send(res, 409, { error: '이미 제출했습니다' });
    if (q.status !== 'running') return send(res, 403, { error: q.status === 'lobby' ? '아직 시작 전입니다' : '참여가 마감되었습니다' });
    const ans = Array.isArray(b.answers) ? b.answers : [];
    e.answers = q.questions.map((qu, i) => {
      const a = Number(ans[i]);
      return Number.isInteger(a) && a >= 0 && a < qu.options.length ? a : -1;
    });
    e.ms = Date.now() - e.startedAt;
    e.done = true;
    if (q.type === 'quiz') e.score = e.answers.filter((a, i) => a === q.questions[i].answer).length;
    await store.saveEntry(id, e);
    if (q.type === 'survey') return send(res, 200, { ok: true });
    const board = leaderboard(q, await store.listEntries(id));
    const me = board.find(r => r.name === e.name);
    return send(res, 200, {
      score: e.score, total: q.questions.length, ms: e.ms, rank: me.rank, participants: board.length,
      review: q.questions.map((qu, i) => ({ yours: e.answers[i], answer: qu.answer })),
    });
  }

  // 이하 출제자 전용
  const key = url.searchParams.get('key') || '';
  if (!safeEq(key, q.hostKey)) return send(res, 403, { error: '출제자 권한이 없습니다' });

  if (m === 'POST' && sub === 'status') {
    const b = await readJson(req);
    if (!['running', 'closed'].includes(b.status)) return send(res, 400, { error: '잘못된 상태' });
    if (b.status === 'running' && q.status === 'lobby') await store.start(id, Date.now()); // 모두 같은 시각에 시작 → 공정한 시간 측정
    else await store.setStatus(id, b.status);
    return send(res, 200, { status: b.status });
  }
  if (m === 'POST' && sub === 'reset') {
    await store.reset(id);
    return send(res, 200, { ok: true });
  }
  if (m === 'DELETE' && !sub) {
    await store.deleteQuiz(id);
    return send(res, 200, { ok: true });
  }
  return send(res, 404, { error: '없는 API' });
}

// ---------- 정적 파일 ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
function serveStatic(res, pathname) {
  let file = path.join(PUBLIC_DIR, pathname);
  if (!file.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(PUBLIC_DIR, 'index.html'); // SPA 라우팅
  }
  send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)] || 'application/octet-stream');
}

async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (req.method !== 'GET') return send(res, 405, { error: '허용되지 않는 요청' });
    serveStatic(res, decodeURIComponent(url.pathname));
  } catch (err) {
    if (err && err.code && err.msg) return send(res, err.code, { error: err.msg });
    console.error(err);
    send(res, 500, { error: '서버 오류' });
  }
}
const server = http.createServer(handler);

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`퀴즈 사이트 실행 중: http://localhost:${PORT}`);
    const nets = require('os').networkInterfaces();
    for (const list of Object.values(nets)) for (const n of list)
      if (n.family === 'IPv4' && !n.internal) console.log(`같은 와이파이 학생용 주소: http://${n.address}:${PORT}`);
  });
}
module.exports = server;
module.exports.handler = handler;
