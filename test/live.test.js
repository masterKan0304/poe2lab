// 실서버 없이 LiveTradeClient 의 요청 형식/레이트 리밋 처리를 검증
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LiveTradeClient } from '../src/trade/live.js';
import { buildTradeQuery, StatIndex } from '../src/trade/query.js';
import { RateLimiter } from '../src/trade/ratelimit.js';

const STATS = { result: [
  { label: 'Pseudo', entries: [{ id: 'pseudo.pseudo_total_life', text: '+# total maximum Life', type: 'pseudo' }, { id: 'pseudo.pseudo_total_fire_resistance', text: '+#% total to Fire Resistance', type: 'pseudo' }] },
  { label: 'Explicit', entries: [{ id: 'explicit.stat_1', text: '+# to Level of all Spell Skills', type: 'explicit' }, { id: 'explicit.stat_2', text: '#% increased Movement Speed', type: 'explicit' }] },
] };

test('추상 쿼리 -> trade2 JSON', () => {
  const idx = new StatIndex(STATS);
  const { body, unresolved } = buildTradeQuery({ category: 'armour.boots', weights: { life: 0.01, fireRes: 0.05, ward: 1 }, weightMin: 1, keyMods: [{ text: '+3 to Level of all Spell Skills', min: 3 }], statMins: { moveSpeed: 25 }, sort: 'weight', maxPriceEx: 100 }, idx);
  assert.equal(body.query.filters.type_filters.filters.category.option, 'armour.boots');
  assert.equal(body.query.stats[0].type, 'weight');
  assert.deepEqual(body.query.stats[0].filters.map((f) => f.id), ['pseudo.pseudo_total_life', 'pseudo.pseudo_total_fire_resistance']);
  assert.deepEqual(body.query.stats[1].filters.map((f) => f.id), ['explicit.stat_2', 'explicit.stat_1']);
  assert.deepEqual(body.sort, { 'statgroup.0': 'desc' });
  assert.equal(body.query.filters.trade_filters.filters.price.max, 100);
  assert.deepEqual(unresolved, ['ward']);
});

test('LiveTradeClient: search -> fetch, UA/쿠키 헤더, trade URL', async () => {
  const calls = [];
  const headers = new Map([['x-rate-limit-rules', 'Ip'], ['x-rate-limit-ip', '100:10:60'], ['x-rate-limit-ip-state', '1:10:0']]);
  const fakeFetch = async (url, init) => {
    calls.push({ url, init });
    const body = url.includes('/data/stats') ? STATS : url.includes('/search/') ? { id: 'Q1', total: 2, result: ['h1', 'h2'] } : { result: [{ id: 'h1', listing: { price: { amount: 5, currency: 'exalted' } }, item: {} }, { id: 'h2', listing: { price: { amount: 1, currency: 'divine' } }, item: {} }] };
    return { ok: true, status: 200, headers: { get: (k) => headers.get(k) }, text: async () => JSON.stringify(body) };
  };
  const client = new LiveTradeClient({ fetchImpl: fakeFetch, poesessid: 'abc' });
  const r = await client.searchListings('Runes of Aldur', { category: 'accessory.ring', weights: { life: 1 } });
  assert.equal(r.results.length, 2);
  assert.match(r.tradeUrl, /trade2\/search\/poe2\/Runes%20of%20Aldur\/Q1$/);
  const search = calls.find((c) => c.url.includes('/search/'));
  assert.equal(search.init.method, 'POST');
  assert.match(search.init.headers['User-Agent'], /^poe2lab\//);
  assert.equal(search.init.headers.Cookie, 'POESESSID=abc');
  assert.match(calls.at(-1).url, /\/api\/trade2\/fetch\/h1,h2\?query=Q1&realm=poe2$/);
});

test('RateLimiter: 서버 규칙의 5/6 까지만 사용', () => {
  let t = 0;
  const rl = new RateLimiter('x', { now: () => t });
  rl.update({ 'x-rate-limit-rules': 'Ip', 'x-rate-limit-ip': '6:10:60', 'x-rate-limit-ip-state': '0:10:0' });
  for (let i = 0; i < 5; i++) { assert.equal(rl.waitMs(), 0); rl.history.push(t); t += 100; }
  assert.ok(rl.waitMs() > 0); // 6번째는 대기
});

test('RateLimiter: 페널티 상태면 차단 시간만큼 대기', () => {
  const rl = new RateLimiter('x', { now: () => 0 });
  rl.update({ 'x-rate-limit-rules': 'Ip', 'x-rate-limit-ip': '5:10:60', 'x-rate-limit-ip-state': '6:10:60' });
  assert.ok(rl.waitMs() >= 60000);
});
