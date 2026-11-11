'use strict';
const app = document.getElementById('app');
let timer = null; // 화면 전환 시 정리할 폴링 타이머

// ---------- 헬퍼 ----------
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (sel, root = app) => root.querySelector(sel);
const fmtTime = ms => { const s = Math.round(ms / 1000); return s >= 60 ? `${Math.floor(s / 60)}분 ${s % 60}초` : `${s}초`; };
const medal = r => (r === 1 ? '🥇' : r === 2 ? '🥈' : r === 3 ? '🥉' : r);
async function api(path, opts = {}) {
  const r = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = r.headers.get('content-type')?.includes('json') ? await r.json() : null;
  if (!r.ok) throw new Error(data?.error || '오류가 발생했습니다');
  return data;
}
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* 저장 불가 환경 */ } },
};
function go(path) { history.pushState(null, '', path); route(); }
document.addEventListener('click', e => {
  const a = e.target.closest('a[data-link]');
  if (a) { e.preventDefault(); go(a.getAttribute('href')); }
});
window.addEventListener('popstate', route);

function route() {
  clearInterval(timer); timer = null;
  const p = location.pathname;
  let m;
  if ((m = p.match(/^\/q\/(\w+)$/))) return studentView(m[1]);
  if ((m = p.match(/^\/r\/(\w+)$/))) return resultsView(m[1], false);
  if ((m = p.match(/^\/host\/(\w+)$/))) return hostView(m[1]);
  return homeView();
}

// ---------- 홈: 퀴즈 만들기 ----------
function homeView() {
  const mine = store.get('myQuizzes', []);
  app.innerHTML = `
    <div class="card">
      <h1>퀴즈 · 설문 만들기</h1>
      <p class="mute">만들면 QR 코드가 생겨요. 학생들이 QR을 찍어 참여하면 순위가 바로 나옵니다.</p>
      <div class="tabs">
        <button type="button" id="t-quiz">🏆 퀴즈 (순위)</button>
        <button type="button" id="t-survey" class="sec">📊 설문조사</button>
      </div>
      <label for="title">제목</label>
      <input id="title" maxlength="80" placeholder="예) 3단원 확인 퀴즈">
      <div id="qs"></div>
      <div class="row"><button type="button" class="sec" id="add">+ 질문 추가</button></div>
      <p class="err" id="err" role="alert"></p>
      <button type="button" id="make" class="grow" style="width:100%">QR 코드 만들기</button>
    </div>
    ${mine.length ? `<div class="card"><h2>내가 만든 목록 <span class="mute" style="font-weight:400;font-size:.85rem">(이 기기)</span></h2>
      ${mine.map(q => `<div class="row" style="margin:6px 0"><a data-link class="grow" href="/host/${q.id}?key=${q.key}">${esc(q.title)}</a><span class="pill">${q.type === 'quiz' ? '퀴즈' : '설문'}</span></div>`).join('')}</div>` : ''}`;

  let type = 'quiz';
  const qsEl = $('#qs');
  function addQuestion(prefill) {
    const n = qsEl.children.length + 1;
    const div = document.createElement('div');
    div.className = 'q-edit';
    div.innerHTML = `<label>질문 ${n}</label>
      <input class="qtext" maxlength="200" placeholder="질문을 입력하세요">
      <div class="opts"></div>
      <div class="row"><button type="button" class="sec add-opt">+ 보기</button><button type="button" class="sec del-q">질문 삭제</button></div>`;
    qsEl.appendChild(div);
    const opts = $('.opts', div);
    const gname = 'g' + Date.now() + Math.random().toString(36).slice(2); // 질문별 라디오 그룹
    const add = () => {
      if (opts.children.length >= 6) return;
      const r = document.createElement('div'); r.className = 'opt-row';
      r.innerHTML = `<input type="radio" name="${gname}" title="정답" ${type === 'quiz' ? '' : 'hidden'}>
        <input class="otext" maxlength="100" placeholder="보기 ${opts.children.length + 1}">`;
      opts.appendChild(r);
    };
    add(); add();
    $('.add-opt', div).onclick = add;
    $('.del-q', div).onclick = () => { if (qsEl.children.length > 1) { div.remove(); renumber(); } };
    if (prefill) $('.qtext', div).focus();
  }
  const renumber = () => [...qsEl.children].forEach((d, i) => ($('label', d).textContent = `질문 ${i + 1}`));
  function setType(t) {
    type = t;
    $('#t-quiz').className = t === 'quiz' ? '' : 'sec';
    $('#t-survey').className = t === 'survey' ? '' : 'sec';
    qsEl.querySelectorAll('input[type=radio]').forEach(r => (r.hidden = t !== 'quiz'));
    $('#title').placeholder = t === 'quiz' ? '예) 3단원 확인 퀴즈' : '예) 급식 만족도 설문';
  }
  $('#t-quiz').onclick = () => setType('quiz');
  $('#t-survey').onclick = () => setType('survey');
  $('#add').onclick = () => { addQuestion(true); };
  addQuestion();

  $('#make').onclick = async () => {
    const err = $('#err'); err.textContent = '';
    const questions = [...qsEl.children].map(d => {
      const optEls = [...d.querySelectorAll('.opt-row')];
      const answer = optEls.findIndex(r => r.querySelector('input[type=radio]').checked);
      return { text: $('.qtext', d).value, options: optEls.map(r => $('.otext', r).value), answer };
    });
    if (type === 'quiz') {
      const bad = questions.findIndex(q => q.answer < 0);
      if (bad >= 0) { err.textContent = `${bad + 1}번 질문의 정답(왼쪽 동그라미)을 선택하세요`; return; }
    }
    try {
      $('#make').disabled = true;
      const r = await api('/quizzes', { method: 'POST', body: { type, title: $('#title').value, questions } });
      const list = store.get('myQuizzes', []);
      list.unshift({ id: r.id, key: r.hostKey, title: $('#title').value.trim().slice(0, 80), type });
      store.set('myQuizzes', list.slice(0, 30));
      go(`/host/${r.id}?key=${r.hostKey}`);
    } catch (e) { err.textContent = e.message; $('#make').disabled = false; }
  };
}

// ---------- 출제자 화면: QR + 실시간 결과 ----------
async function hostView(id) {
  const key = new URLSearchParams(location.search).get('key') || '';
  let quiz;
  try { quiz = await api(`/quizzes/${id}`); } catch (e) { return notFound(e.message); }
  const joinUrl = `${location.origin}/q/${id}`;
  app.innerHTML = `
    <div class="card center">
      <h1>${esc(quiz.title)}</h1>
      <p class="mute">학생들이 QR을 찍고 닉네임을 정해 입장하면 대기실에 모여요 · <span class="pill" id="state"></span></p>
      <div class="qr"><img alt="참여 QR 코드" width="280" height="280" style="width:100%;height:auto" src="/api/qr?text=${encodeURIComponent(joinUrl)}"></div>
      <div class="link">${esc(joinUrl)}</div>
      <p class="mute" id="lanwarn" hidden>⚠️ 지금 주소가 <b>localhost</b>예요. 학생 폰에서는 열리지 않으니, 서버 터미널에 나온 "같은 와이파이 학생용 주소"나 배포된 주소로 이 화면을 다시 여세요.</p>
      <div class="row print-hide" style="justify-content:center;margin-top:12px">
        <button id="main" type="button"></button>
        <button id="copy" type="button" class="sec">링크 복사</button>
        <button id="print" type="button" class="sec">QR 인쇄</button>
      </div>
    </div>
    <div id="live"></div>
    <div class="card print-hide"><h2>관리</h2><div class="row">
      <button id="reset" class="sec" type="button">처음 상태로 초기화</button>
      <button id="del" class="danger" type="button">삭제</button></div></div>`;
  if (/^(localhost|127\.|\[::1\])/.test(location.hostname)) $('#lanwarn').hidden = false;
  let status = quiz.status, count = quiz.count;
  const LABEL = { lobby: '대기실 · 입장 받는 중', running: '진행 중', closed: '마감됨' };
  const paint = () => {
    $('#state').textContent = LABEL[status]; $('#state').classList.toggle('on', status !== 'closed');
    const b = $('#main');
    b.textContent = status === 'lobby' ? `▶ 시작하기 (${count}명 대기)` : status === 'running' ? '■ 마감하기' : '다시 열기';
    b.disabled = status === 'lobby' && count === 0;
  };
  const setStatus = async st => { try { status = (await api(`/quizzes/${id}/status?key=${key}`, { method: 'POST', body: { status: st } })).status; paint(); refresh(); } catch (e) { alert(e.message); } };
  $('#main').onclick = () => setStatus(status === 'running' ? 'closed' : 'running');
  $('#copy').onclick = async () => { try { await navigator.clipboard.writeText(joinUrl); $('#copy').textContent = '복사됨!'; } catch (_) { prompt('링크를 복사하세요', joinUrl); } };
  $('#print').onclick = () => window.print();
  $('#reset').onclick = async () => { if (confirm('참여 기록을 모두 지우고 대기실로 되돌릴까요?')) { try { await api(`/quizzes/${id}/reset?key=${key}`, { method: 'POST', body: {} }); status = 'lobby'; refresh(); } catch (e) { alert(e.message); } } };
  $('#del').onclick = async () => {
    if (!confirm('이 퀴즈를 완전히 삭제할까요?')) return;
    try {
      await api(`/quizzes/${id}?key=${key}`, { method: 'DELETE' });
      store.set('myQuizzes', store.get('myQuizzes', []).filter(q => q.id !== id));
      go('/');
    } catch (e) { alert(e.message); }
  };
  const live = $('#live');
  const refresh = async () => {
    try {
      const r = await api(`/quizzes/${id}/results`);
      status = r.status; count = r.type === 'quiz' ? r.participants : r.responses + r.waiting.length;
      paint(); renderResults(live, r, null, true);
    } catch (_) { /* 일시적 오류 무시 */ }
  };
  paint(); refresh(); timer = setInterval(refresh, 1500);
}

// ---------- 결과 / 순위 ----------
function chips(names) { return names.map(n => `<span class="pill" style="margin:3px">${esc(n)}</span>`).join(''); }
function renderResults(el, r, myName, showTotal) {
  if (r.status === 'lobby') {
    el.innerHTML = `<div class="card center"><h2>👥 대기실 · ${r.waiting.length}명 입장</h2>
      ${r.waiting.length ? chips(r.waiting) : '<p class="mute">아직 아무도 없어요. QR 코드를 찍어 입장하세요!</p>'}</div>`;
    return;
  }
  const pending = r.waiting.length ? `<p class="mute" style="font-size:.85rem">✍️ 푸는 중 (${r.waiting.length}명): ${chips(r.waiting)}</p>` : '';
  if (r.type === 'survey') {
    el.innerHTML = `<div class="card"><h2>📊 설문 결과 · ${r.responses}명 응답</h2>
      ${r.questions.map((q, i) => {
        const max = Math.max(1, ...q.counts);
        return `<div style="margin:14px 0"><b>${i + 1}. ${esc(q.text)}</b>${q.options.map((o, k) => `
          <div class="res-bar"><span class="lbl">${esc(o)}</span><span class="track"><i style="width:${q.counts[k] / max * 100}%"></i></span><span class="num">${q.counts[k]}</span></div>`).join('')}</div>`;
      }).join('')}${pending}</div>`;
    return;
  }
  const top = r.rows.slice(0, 3);
  el.innerHTML = `<div class="card"><h2>🏆 실시간 순위 <span class="mute" style="font-weight:400;font-size:.85rem">${r.rows.length}명 완료${showTotal ? ` / 입장 ${r.participants}명` : ''}</span></h2>
    ${r.rows.length ? `
    ${top.length ? `<div class="podium">${top.map(t => `<div class="p${t.rank > 3 ? 3 : t.rank}"><b>${medal(t.rank)}</b><span>${esc(t.name)}</span><span class="mute">${t.score}/${t.total}</span></div>`).join('')}</div>` : ''}
    <table><thead><tr><th>순위</th><th>이름</th><th class="n">점수</th><th class="n">시간</th></tr></thead><tbody>
    ${r.rows.map(x => `<tr class="${x.name === myName ? 'me' : ''}"><td class="rank r${x.rank}">${medal(x.rank)}</td><td>${esc(x.name)}</td><td class="n">${x.score}/${x.total}</td><td class="n">${fmtTime(x.ms)}</td></tr>`).join('')}
    </tbody></table>
    <p class="mute" style="font-size:.85rem;margin-bottom:0">점수가 같으면 더 빨리 푼 사람이 위에 있어요.</p>`
    : '<p class="mute center">아직 완료한 학생이 없어요. 곧 순위가 나타납니다!</p>'}${pending}</div>`;
}

async function resultsView(id, _host) {
  let r;
  try { r = await api(`/quizzes/${id}/results`); } catch (e) { return notFound(e.message); }
  app.innerHTML = `<h1 class="center">${esc(r.title)}</h1><div id="live"></div>
    <p class="center"><a class="btn sec" data-link href="/q/${id}">나도 참여하기</a></p>`;
  const live = $('#live');
  const myName = store.get('name:' + id, null);
  const refresh = async () => { try { renderResults(live, await api(`/quizzes/${id}/results`), myName); } catch (_) {} };
  refresh(); timer = setInterval(refresh, 3000);
}

// ---------- 학생 화면 ----------
async function studentView(id) {
  let quiz;
  try { quiz = await api(`/quizzes/${id}`); } catch (e) { return notFound(e.message); }
  if (quiz.status === 'lobby') { // 출제자가 초기화한 경우 이전 기록 폐기
    const stale = store.get('token:' + id, null);
    if (stale && !quiz.names.includes(store.get('name:' + id, ''))) ['done:', 'token:', 'name:'].forEach(k => { try { localStorage.removeItem(k + id); } catch (_) {} });
  }
  const saved = store.get('done:' + id, null); // 이미 제출한 경우
  if (saved && quiz.status !== 'lobby') return finishView(id, quiz, saved);
  const token = store.get('token:' + id, null), joined = store.get('name:' + id, null);
  if (token && joined) return lobbyView(id, joined, token);   // 새로고침해도 대기실로 복귀

  app.innerHTML = `<div class="card center">
    <h1>${esc(quiz.title)}</h1>
    <p class="mute">${quiz.type === 'quiz' ? `퀴즈 · 문제 ${quiz.questionCount}개 · 점수가 같으면 빠른 사람이 높은 순위` : `설문조사 · 질문 ${quiz.questionCount}개`}</p>
    ${quiz.status !== 'closed' ? `<label for="name" style="display:block;text-align:left">닉네임</label>
      <input id="name" maxlength="20" autocomplete="off" placeholder="예) 3학년 2반 김민수">
      <p class="err" id="err" role="alert"></p>
      <button id="go" type="button" style="width:100%">대기실 입장</button>`
      : '<p class="err">참여가 마감되었습니다.</p><a class="btn sec" data-link href="/r/' + id + '">결과 보기</a>'}
  </div>`;
  if (quiz.status === 'closed') return;
  const nameEl = $('#name'); nameEl.value = store.get('lastName', '');
  const join = async () => {
    const name = nameEl.value.trim();
    if (!name) { $('#err').textContent = '닉네임을 입력하세요'; return; }
    $('#go').disabled = true;
    try {
      const r = await api(`/quizzes/${id}/join`, { method: 'POST', body: { name } });
      store.set('lastName', name); store.set('name:' + id, name); store.set('token:' + id, r.token);
      lobbyView(id, name, r.token);
    } catch (e) { $('#err').textContent = e.message; $('#go').disabled = false; }
  };
  $('#go').onclick = join;
  nameEl.onkeydown = e => { if (e.key === 'Enter') join(); };
}

// 대기실: 출제자가 시작하면 자동으로 문제 화면으로 이동
function lobbyView(id, name, token) {
  app.innerHTML = '<div class="card center"><h1>⏳ 잠시만 기다려 주세요</h1><p>선생님이 시작하면 바로 퀴즈가 열려요.</p><p class="score" style="font-size:1.6rem" id="me"></p><div id="who"></div></div>';
  $('#me').textContent = name;
  const tick = async () => {
    try {
      const q = await api(`/quizzes/${id}`);
      if (q.status === 'running') { clearInterval(timer); return playView(id, q, name, token); }
      if (q.status === 'closed') { clearInterval(timer); return notFound('참여가 마감되었어요.'); }
      $('#who').innerHTML = `<p class="mute">${q.count}명 대기 중</p>` + chips(q.names || []);
    } catch (e) { /* 재시도 */ }
  };
  tick(); timer = setInterval(tick, 1200);
}

function playView(id, quiz, name, token) {
  const answers = []; let i = 0;
  const show = () => {
    const q = quiz.questions[i];
    app.innerHTML = `<div class="bar"><i style="width:${i / quiz.questions.length * 100}%"></i></div>
      <div class="card"><div class="mute">${i + 1} / ${quiz.questions.length}</div>
      <h2 style="font-size:1.3rem;margin-top:.3em">${esc(q.text)}</h2>
      <div class="choices">${q.options.map((o, k) => `<button type="button" class="choice" data-k="${k}">${esc(o)}</button>`).join('')}</div>
      <p class="err" id="err" role="alert"></p></div>`;
    app.querySelectorAll('.choice').forEach(b => (b.onclick = async () => {
      app.querySelectorAll('.choice').forEach(x => (x.disabled = true));
      b.classList.add('sel');
      answers[i] = Number(b.dataset.k);
      if (++i < quiz.questions.length) return setTimeout(show, 180);
      try {
        const res = await api(`/quizzes/${id}/submit`, { method: 'POST', body: { token, answers } });
        store.set('done:' + id, { name, result: res });
        finishView(id, quiz, { name, result: res });
      } catch (e) {
        i--; $('#err').textContent = e.message + ' — 다시 눌러 제출하세요';
        app.querySelectorAll('.choice').forEach(x => (x.disabled = false));
      }
    }));
  };
  show();
}

function finishView(id, quiz, { name, result }) {
  if (quiz.type === 'survey') {
    app.innerHTML = `<div class="card center"><h1>참여해 주셔서 감사합니다 🙌</h1><p class="mute">${esc(name)}님의 응답이 제출되었어요.</p></div>`;
    return;
  }
  app.innerHTML = `<div class="card center">
      <div class="mute">${esc(name)}님의 결과</div>
      <div class="score">${result.score} / ${result.total}</div>
      <p style="font-size:1.2rem;margin:.3em 0">현재 <b>${result.rank}위</b> ${medal(result.rank)} <span class="mute">(${result.participants}명 중)</span></p>
      <p class="mute">걸린 시간 ${fmtTime(result.ms)}</p>
    </div>
    <div class="card"><h2>정답 확인</h2>${quiz.questions.map((q, i) => {
      const rv = result.review[i]; const ok = rv.yours === rv.answer;
      return `<div style="margin:10px 0"><b>${i + 1}. ${esc(q.text)}</b>
        <div>${ok ? '⭕' : '❌'} 내 답: ${rv.yours >= 0 ? esc(q.options[rv.yours]) : '(무응답)'}${ok ? '' : ` · <span style="color:var(--ok)">정답: ${esc(q.options[rv.answer])}</span>`}</div></div>`;
    }).join('')}</div>
    <div id="live"></div>`;
  const live = $('#live');
  const refresh = async () => { try { renderResults(live, await api(`/quizzes/${id}/results`), name); } catch (_) {} };
  refresh(); timer = setInterval(refresh, 3000);
}

function notFound(msg) {
  app.innerHTML = `<div class="card center"><h1>앗!</h1><p>${esc(msg)}</p><a class="btn" data-link href="/">처음으로</a></div>`;
}

route();
