// 공식 trade2 API 클라이언트 (https://www.pathofexile.com/trade2)
import { config } from '../config.js';
import { RateLimiter } from './ratelimit.js';
import { StatIndex, buildTradeQuery } from './query.js';

export class TradeError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export class LiveTradeClient {
  constructor({ fetchImpl = fetch, poesessid = config.poesessid } = {}) {
    this.mode = 'live';
    this.fetch = fetchImpl;
    this.poesessid = poesessid;
    this.limiters = { search: new RateLimiter('search'), fetch: new RateLimiter('fetch', { initialIntervalMs: 1500 }), whisper: new RateLimiter('whisper', { initialIntervalMs: 1000 }), data: new RateLimiter('data', { initialIntervalMs: 500 }) };
    this.cache = new Map();
    this.statIndex = null;
  }

  get canTeleport() {
    return !!this.poesessid;
  }

  headers(extra = {}) {
    const h = { 'User-Agent': config.userAgent, Accept: 'application/json', ...extra };
    if (this.poesessid) h.Cookie = `POESESSID=${this.poesessid}`;
    return h;
  }

  async request(limiterName, url, init = {}) {
    const limiter = this.limiters[limiterName];
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await limiter.schedule(() => this.fetch(url, { ...init, headers: this.headers(init.headers) }));
      limiter.update(res.headers);
      if (res.status === 429) continue; // limiter 가 Retry-After 만큼 대기
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* not json */ }
      if (!res.ok) {
        const msg = json?.error?.message || text.slice(0, 200);
        throw new TradeError(`trade2 ${res.status}: ${msg}${res.status === 403 ? ' (IP 차단/UA 문제일 수 있음. 로컬 PC 에서 실행하세요)' : ''}`, res.status);
      }
      return json;
    }
    throw new TradeError('trade2 레이트 리밋 초과', 429);
  }

  async getStatIndex() {
    if (!this.statIndex) {
      const data = await this.request('data', `${config.tradeBase}/api/trade2/data/stats`);
      this.statIndex = new StatIndex(data);
    }
    return this.statIndex;
  }

  /** 추상 쿼리로 검색 후 상위 limit 개 매물을 가져옴 */
  async searchListings(league, abstractQuery, { limit = 10 } = {}) {
    const index = await this.getStatIndex();
    const { body, unresolved } = buildTradeQuery(abstractQuery, index);
    const key = `${league}|${JSON.stringify(body)}|${limit}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < config.cacheTtlMs) return hit.value;

    const search = await this.request('search', `${config.tradeBase}/api/trade2/search/poe2/${encodeURIComponent(league)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const ids = (search.result || []).slice(0, limit);
    const results = [];
    for (let i = 0; i < ids.length; i += 10) {
      const chunk = ids.slice(i, i + 10).join(',');
      const data = await this.request('fetch', `${config.tradeBase}/api/trade2/fetch/${chunk}?query=${search.id}&realm=poe2`);
      results.push(...(data.result || []).filter(Boolean));
    }
    const value = {
      queryId: search.id,
      total: search.total ?? ids.length,
      tradeUrl: `${config.tradeBase}/trade2/search/poe2/${encodeURIComponent(league)}/${search.id}`,
      unresolved,
      results,
    };
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }

  /** 즉시 구매 매물 판매자 은신처로 이동 (trade2 사이트의 "Travel to Hideout" 과 동일한 요청) */
  async travelToHideout(token) {
    if (!this.poesessid) throw new TradeError('POESESSID 가 설정되지 않았습니다 (.env)', 401);
    return this.request('whisper', `${config.tradeBase}/api/trade2/whisper`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', Origin: config.tradeBase, Referer: `${config.tradeBase}/trade2` },
      body: JSON.stringify({ token }),
    });
  }

  async getDataFilters() {
    return this.request('data', `${config.tradeBase}/api/trade2/data/filters`);
  }
}
