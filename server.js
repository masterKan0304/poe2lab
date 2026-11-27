import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { config, ROOT } from './src/config.js';
import { SLOTS, STATS } from './src/slots.js';
import { loadProfiles, saveUserProfiles } from './src/builds/profiles.js';
import { LiveTradeClient } from './src/trade/live.js';
import { mockForProfiles } from './src/trade/mock.js';
import { getExaltedRates, getLeagues } from './src/ninja/currency.js';
import { planGear, DEFAULT_RES_SETTINGS } from './src/planner.js';

let profiles = loadProfiles();

const clients = { live: new LiveTradeClient(), mock: mockForProfiles(profiles) };
const clientFor = (mode) => clients[mode === 'mock' ? 'mock' : mode === 'live' ? 'live' : config.tradeMode];

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

async function readBody(req, max = 2_000_000) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > max) throw Object.assign(new Error('요청이 너무 큽니다'), { status: 413 });
    chunks.push(c);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

const sendJson = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname === '/api/meta') {
      const leagues = await getLeagues();
      return sendJson(res, 200, {
        defaultMode: config.tradeMode,
        canTeleport: { live: clients.live.canTeleport, mock: true },
        leagues,
        slots: SLOTS.map(({ id, label }) => ({ id, label })),
        stats: STATS,
        resSettings: DEFAULT_RES_SETTINGS,
        profiles: profiles.map((p) => ({ id: p.id, class: p.class, skills: p.skills, sampleSize: p.sampleSize, source: p.source, typicalTargets: p.typicalTargets })),
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/plan') {
      const input = await readBody(req);
      const trade = clientFor(input.mode);
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache' });
      const write = (obj) => res.write(JSON.stringify(obj) + '\n');
      try {
        const rates = await getExaltedRates(input.league || 'Standard');
        write({ type: 'progress', step: 'rates', fallback: rates._fallback || null });
        const result = await planGear(input, { trade, profiles, rates, onProgress: (p) => write({ type: 'progress', ...p }) });
        write({ type: 'result', result: { ...result, ratesFallback: rates._fallback || null, divineEx: rates.divine } });
      } catch (err) {
        write({ type: 'error', message: err.message || String(err) });
      }
      return res.end();
    }

    if (req.method === 'POST' && url.pathname === '/api/hideout') {
      const { token, mode } = await readBody(req);
      if (!token) return sendJson(res, 400, { ok: false, error: 'token 없음' });
      try {
        const r = await clientFor(mode).travelToHideout(token);
        return sendJson(res, 200, { ok: true, result: r });
      } catch (err) {
        return sendJson(res, err.status || 500, { ok: false, error: err.message });
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/profiles') {
      const body = await readBody(req);
      const results = saveUserProfiles(body);
      profiles = loadProfiles();
      clients.mock = mockForProfiles(profiles);
      return sendJson(res, 200, { ok: results.every((r) => !r.errors.length), results });
    }

    if (req.method === 'GET') {
      const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      const file = path.join(ROOT, 'public', path.normalize(rel));
      if (!file.startsWith(path.join(ROOT, 'public'))) return sendJson(res, 403, { error: 'forbidden' });
      const data = await readFile(file).catch(() => null);
      if (!data) return sendJson(res, 404, { error: 'not found' });
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      return res.end(data);
    }
    sendJson(res, 404, { error: 'not found' });
  } catch (err) {
    if (!res.headersSent) sendJson(res, err.status || 500, { error: err.message });
    else res.end();
  }
});

// 로컬 전용 (POESESSID 를 쓰는 서버이므로 외부에 노출하지 않음)
server.listen(config.port, '127.0.0.1', () => {
  console.log(`poe2lab 장비 설계 → http://localhost:${config.port}  (trade 모드 기본값: ${config.tradeMode}, 은신처 이동: ${clients.live.canTeleport ? 'ON' : 'POESESSID 없음'})`);
});
