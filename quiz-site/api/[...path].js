// Vercel 서버리스 진입점: /api/* 전부 server.js 의 핸들러로 전달
module.exports = (req, res) => require('../server').handler(req, res);
