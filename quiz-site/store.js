'use strict';
// 저장소 계층: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY 가 있으면 Supabase, 없으면 로컬 JSON 파일.
// 두 구현은 같은 비동기 인터페이스를 가진다. (시간은 모두 epoch ms)
const fs = require('fs');
const path = require('path');

const conflict = () => Object.assign(new Error('conflict'), { conflict: true });

// ---------- 로컬 파일 ----------
function fileStore(file) {
  let db = { quizzes: {} };
  try { db = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { /* 처음 실행 */ }
  let timer = null;
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file + '.tmp', JSON.stringify(db));
      fs.renameSync(file + '.tmp', file);
    }, 200);
  };
  const meta = q => q && { id: q.id, hostKey: q.hostKey, type: q.type, title: q.title, status: q.status, startedAt: q.startedAt ?? null, questions: q.questions };
  return {
    kind: 'file',
    async count() { return Object.keys(db.quizzes).length; },
    async createQuiz(q) { db.quizzes[q.id] = { ...q, startedAt: null, entries: [] }; save(); },
    async getQuiz(id) { return meta(db.quizzes[id]) || null; },
    async listEntries(id) { return db.quizzes[id] ? db.quizzes[id].entries.map(e => ({ ...e })) : []; },
    async addEntry(id, e) {
      const q = db.quizzes[id];
      if (q.entries.some(x => x.name.toLowerCase() === e.name.toLowerCase())) throw conflict();
      q.entries.push({ ...e }); save();
    },
    async getEntryByToken(id, token) { const e = db.quizzes[id].entries.find(x => x.token === token); return e ? { ...e } : null; },
    async saveEntry(id, e) {
      const q = db.quizzes[id]; const i = q.entries.findIndex(x => x.token === e.token);
      if (i >= 0) { q.entries[i] = { ...e }; save(); }
    },
    async start(id, now) { const q = db.quizzes[id]; q.status = 'running'; q.startedAt = now; q.entries.forEach(e => (e.startedAt = now)); save(); },
    async setStatus(id, status) { db.quizzes[id].status = status; save(); },
    async reset(id) { const q = db.quizzes[id]; q.entries = []; q.status = 'lobby'; q.startedAt = null; save(); },
    async deleteQuiz(id) { delete db.quizzes[id]; save(); },
  };
}

// ---------- Supabase (PostgREST, 의존성 없이 fetch 사용) ----------
function supabaseStore(url, key) {
  const base = url.replace(/\/+$/, '') + '/rest/v1';
  const H = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
  async function rest(method, pathq, body, extra = {}) {
    const r = await fetch(base + pathq, { method, headers: { ...H, ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (r.status === 409) throw conflict();
    if (!r.ok) throw new Error(`Supabase ${method} ${pathq.split('?')[0]} → ${r.status} ${(await r.text()).slice(0, 200)}`);
    return r;
  }
  const q = s => encodeURIComponent(s);
  const toQuiz = r => r && { id: r.id, hostKey: r.host_key, type: r.type, title: r.title, status: r.status, startedAt: r.started_at, questions: r.questions };
  const toEntry = r => ({ name: r.name, token: r.token, startedAt: r.started_at, done: r.done, answers: r.answers || [], score: r.score, ms: r.ms });
  return {
    kind: 'supabase',
    async count() {
      const r = await rest('GET', '/quizzes?select=id', undefined, { Prefer: 'count=exact', Range: '0-0' });
      return Number((r.headers.get('content-range') || '').split('/')[1]) || 0;
    },
    async createQuiz(x) {
      await rest('POST', '/quizzes', { id: x.id, host_key: x.hostKey, type: x.type, title: x.title, status: x.status, questions: x.questions, created_at: x.createdAt }, { Prefer: 'return=minimal' });
    },
    async getQuiz(id) { return toQuiz((await (await rest('GET', `/quizzes?id=eq.${q(id)}&select=*`)).json())[0]) || null; },
    async listEntries(id) { return (await (await rest('GET', `/entries?quiz_id=eq.${q(id)}&select=*&order=created_at.asc`)).json()).map(toEntry); },
    async addEntry(id, e) {
      await rest('POST', '/entries', { token: e.token, quiz_id: id, name: e.name, name_key: e.name.toLowerCase(), started_at: e.startedAt, done: false, answers: [], score: 0, ms: 0, created_at: Date.now() }, { Prefer: 'return=minimal' });
    },
    async getEntryByToken(id, token) { const rows = await (await rest('GET', `/entries?quiz_id=eq.${q(id)}&token=eq.${q(token)}&select=*`)).json(); return rows[0] ? toEntry(rows[0]) : null; },
    async saveEntry(id, e) {
      await rest('PATCH', `/entries?quiz_id=eq.${q(id)}&token=eq.${q(e.token)}`, { done: e.done, answers: e.answers, score: e.score, ms: e.ms }, { Prefer: 'return=minimal' });
    },
    async start(id, now) {
      await rest('PATCH', `/quizzes?id=eq.${q(id)}`, { status: 'running', started_at: now }, { Prefer: 'return=minimal' });
      await rest('PATCH', `/entries?quiz_id=eq.${q(id)}`, { started_at: now }, { Prefer: 'return=minimal' });
    },
    async setStatus(id, status) { await rest('PATCH', `/quizzes?id=eq.${q(id)}`, { status }, { Prefer: 'return=minimal' }); },
    async reset(id) {
      await rest('DELETE', `/entries?quiz_id=eq.${q(id)}`, undefined, { Prefer: 'return=minimal' });
      await rest('PATCH', `/quizzes?id=eq.${q(id)}`, { status: 'lobby', started_at: null }, { Prefer: 'return=minimal' });
    },
    async deleteQuiz(id) { await rest('DELETE', `/quizzes?id=eq.${q(id)}`, undefined, { Prefer: 'return=minimal' }); },
  };
}

function createStore() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) return supabaseStore(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  if (process.env.VERCEL) { // 서버리스에는 영구 파일 저장이 없으므로 설정 누락을 명확히 알림
    const fail = () => Promise.reject({ code: 503, msg: '서버 설정이 끝나지 않았어요: Supabase 환경변수(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)를 Vercel에 등록해 주세요' });
    return new Proxy({ kind: 'unconfigured' }, { get: (t, k) => (k in t ? t[k] : fail) });
  }
  return fileStore(process.env.DATA_FILE || path.join(__dirname, 'data', 'quizzes.json'));
}
module.exports = { createStore, fileStore, supabaseStore };
