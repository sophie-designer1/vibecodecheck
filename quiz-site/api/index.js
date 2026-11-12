// Vercel 서버리스 진입점. vercel.json 의 rewrite 가 /api/<경로> 를 /api/index?__p=<경로> 로 넘겨주면
// 원래 경로로 복원해서 server.js 핸들러에 전달한다.
module.exports = (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.searchParams.get('__p');
  if (p !== null) {
    u.searchParams.delete('__p');
    req.url = '/api/' + p + u.search;
  }
  return require('../server').handler(req, res);
};
