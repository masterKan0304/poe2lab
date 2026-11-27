// 로컬 실행용 서버: npm start (실시간 거래소) / npm run start:mock (데모)
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { config, ROOT } from './src/config.js';
import { handleApi, sendJson } from './src/handler.js';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png' };
const PUBLIC = path.join(ROOT, 'public');

const server = http.createServer(async (req, res) => {
  if (await handleApi(req, res)) return;
  if (req.method !== 'GET') return sendJson(res, 404, { error: 'not found' });
  const url = new URL(req.url, 'http://localhost');
  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
  const file = path.join(PUBLIC, path.normalize(rel));
  if (!file.startsWith(PUBLIC)) return sendJson(res, 403, { error: 'forbidden' });
  const data = await readFile(file).catch(() => null);
  if (!data) return sendJson(res, 404, { error: 'not found' });
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  res.end(data);
});

// 로컬 전용 (POESESSID 를 쓰는 서버이므로 외부에 노출하지 않음)
server.listen(config.port, '127.0.0.1', () => {
  console.log(`poe2lab 장비 설계 → http://localhost:${config.port}  (trade 모드 기본값: ${config.tradeMode}, 은신처 이동: ${config.poesessid ? 'ON' : 'POESESSID 없음'})`);
});
