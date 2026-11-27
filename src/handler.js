// API 라우트. 로컬 서버(server.js)와 Vercel 서버리스 함수(api/*.js)가 같이 쓴다.
import { config } from './config.js';
import { SLOTS, STATS } from './slots.js';
import { loadProfiles, saveUserProfiles, validateProfile } from './builds/profiles.js';
import { LiveTradeClient } from './trade/live.js';
import { mockForProfiles } from './trade/mock.js';
import { getExaltedRates, getLeagues } from './ninja/currency.js';
import { planGear, DEFAULT_RES_SETTINGS } from './planner.js';
import { I18N } from './i18n.js';

let profiles = loadProfiles();
const clients = { live: new LiveTradeClient(), mock: mockForProfiles(profiles) };
const clientFor = (mode) => clients[mode === 'mock' ? 'mock' : mode === 'live' ? 'live' : config.tradeMode];

export async function readBody(req, max = 2_000_000) {
  // Vercel 은 JSON 본문을 미리 파싱해 req.body 로 넣어줌
  if (config.isVercel && req.body !== undefined) {
    const b = req.body;
    if (b == null || b === '') return {};
    if (typeof b === 'string') return JSON.parse(b);
    if (Buffer.isBuffer(b)) return b.length ? JSON.parse(b.toString('utf8')) : {};
    return b;
  }
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

export const sendJson = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

/** 브라우저가 보낸(업로드해서 localStorage 에 둔) 프로필 중 유효한 것만 */
function clientProfiles(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 50).filter((p) => validateProfile(p).length === 0).map((p) => ({ ...p, source: 'user' }));
}

/** /api/* 처리. 처리했으면 true */
export async function handleApi(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const route = url.pathname.replace(/\/+$/, '');
  try {
    if (req.method === 'GET' && route === '/api/meta') {
      const leagues = await getLeagues();
      sendJson(res, 200, {
        defaultMode: config.tradeMode,
        hosted: config.isVercel,
        canTeleport: { live: clients.live.canTeleport, mock: true },
        leagues,
        slots: SLOTS.map(({ id, label }) => ({ id, label })),
        stats: STATS,
        resSettings: DEFAULT_RES_SETTINGS,
        i18n: { classes: I18N.classes, skills: I18N.skills, source: I18N.source, generated: I18N.generated },
        profiles: profiles.map((p) => ({ id: p.id, class: p.class, skills: p.skills, sampleSize: p.sampleSize, source: p.source, typicalTargets: p.typicalTargets })),
      });
      return true;
    }

    if (req.method === 'GET' && route === '/api/rates') {
      const rates = await getExaltedRates(url.searchParams.get('league') || 'Standard');
      sendJson(res, 200, { divine: rates.divine, chaos: rates.chaos, fallback: rates._fallback || null });
      return true;
    }

    if (req.method === 'POST' && route === '/api/plan') {
      const input = await readBody(req);
      const extra = clientProfiles(input.profiles);
      const allProfiles = [...profiles.filter((p) => !extra.some((e) => e.id === p.id)), ...extra];
      const trade = input.mode === 'mock' && extra.length ? mockForProfiles(allProfiles) : clientFor(input.mode);
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' });
      const write = (obj) => res.write(JSON.stringify(obj) + '\n');
      try {
        const rates = await getExaltedRates(input.league || 'Standard');
        write({ type: 'progress', step: 'rates', fallback: rates._fallback || null });
        const result = await planGear(input, { trade, profiles: allProfiles, rates, onProgress: (p) => write({ type: 'progress', ...p }) });
        write({ type: 'result', result: { ...result, ratesFallback: rates._fallback || null, divineEx: rates.divine } });
      } catch (err) {
        const hint = err.status === 403 && config.isVercel ? ' — 호스팅 서버(데이터센터 IP)는 GGG 가 차단합니다. 실시간 검색은 본인 PC 에서 npm start 로 실행하세요.' : '';
        write({ type: 'error', message: (err.message || String(err)) + hint });
      }
      res.end();
      return true;
    }

    if (req.method === 'POST' && route === '/api/hideout') {
      const { token, mode } = await readBody(req);
      if (!token) return sendJson(res, 400, { ok: false, error: 'token 없음' }), true;
      try {
        sendJson(res, 200, { ok: true, result: await clientFor(mode).travelToHideout(token) });
      } catch (err) {
        sendJson(res, err.status || 500, { ok: false, error: err.message });
      }
      return true;
    }

    if (req.method === 'POST' && route === '/api/profiles') {
      // 검증 + (로컬이면) 디스크 저장. 브라우저도 localStorage 에 보관해 검색 때 같이 보낸다.
      const body = await readBody(req);
      const { results, saved } = saveUserProfiles(body, { persist: !config.isVercel });
      if (saved) {
        profiles = loadProfiles();
        clients.mock = mockForProfiles(profiles);
      }
      sendJson(res, 200, { ok: results.every((r) => !r.errors.length), results, saved });
      return true;
    }
  } catch (err) {
    if (!res.headersSent) sendJson(res, err.status || 500, { error: err.message });
    else res.end();
    return true;
  }
  if (route.startsWith('/api/')) {
    sendJson(res, 404, { error: 'not found' });
    return true;
  }
  return false;
}

/** Vercel 함수 기본 export 용 */
export default async function vercelHandler(req, res) {
  await handleApi(req, res);
}
