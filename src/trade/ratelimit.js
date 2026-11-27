// GGG trade API 레이트 리밋 준수용 limiter.
// 응답 헤더 X-Rate-Limit-Rules / X-Rate-Limit-<rule> ("hits:period:penalty,...") 를 읽어 그대로 따른다.
// 각 버킷의 1/6 은 사용자의 브라우저 검색용으로 남겨둔다.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class RateLimiter {
  constructor(name, { initialIntervalMs = 4000, now = () => Date.now(), sleepFn = sleep } = {}) {
    this.name = name;
    this.rules = null; // [{hits, periodMs}]
    this.history = []; // 요청 시각
    this.blockedUntil = 0;
    this.initialIntervalMs = initialIntervalMs;
    this.now = now;
    this.sleep = sleepFn;
    this.queue = Promise.resolve();
  }

  /** 다음 요청까지 기다려야 하는 ms */
  waitMs() {
    const t = this.now();
    let wait = Math.max(0, this.blockedUntil - t);
    if (!this.rules) {
      const last = this.history[this.history.length - 1];
      if (last) wait = Math.max(wait, last + this.initialIntervalMs - t);
      return wait;
    }
    for (const { hits, periodMs } of this.rules) {
      const allowed = Math.max(1, Math.floor((hits * 5) / 6));
      const recent = this.history.filter((h) => h > t - periodMs);
      if (recent.length >= allowed) wait = Math.max(wait, recent[recent.length - allowed] + periodMs - t + 50);
    }
    return wait;
  }

  /** 요청을 직렬화하고 필요한 만큼 대기 후 실행 */
  schedule(fn) {
    const run = async () => {
      let w;
      while ((w = this.waitMs()) > 0) await this.sleep(w);
      this.history.push(this.now());
      const maxPeriod = Math.max(60000, ...(this.rules || []).map((r) => r.periodMs));
      this.history = this.history.filter((h) => h > this.now() - maxPeriod);
      return fn();
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  /** 응답 헤더로 규칙/상태 갱신 */
  update(headers) {
    const get = (k) => (typeof headers.get === 'function' ? headers.get(k) : headers[k.toLowerCase()]);
    const ruleNames = (get('x-rate-limit-rules') || '').split(',').map((s) => s.trim()).filter(Boolean);
    const rules = [];
    for (const r of ruleNames) {
      const spec = get(`x-rate-limit-${r}`);
      const state = get(`x-rate-limit-${r}-state`);
      if (!spec) continue;
      const specs = spec.split(',').map((x) => x.split(':').map(Number));
      const states = (state || '').split(',').map((x) => x.split(':').map(Number));
      specs.forEach(([hits, period], i) => {
        rules.push({ hits, periodMs: period * 1000 });
        const st = states[i];
        if (st && st[2] > 0) this.blockedUntil = Math.max(this.blockedUntil, this.now() + st[2] * 1000);
        // 서버가 집계한 사용량이 내가 아는 것보다 많으면(브라우저 사용 등) 그만큼 채워 넣음
        if (st && st[0] > 0) {
          const recent = this.history.filter((h) => h > this.now() - period * 1000).length;
          for (let k = recent; k < st[0]; k++) this.history.unshift(this.now() - 1);
        }
      });
    }
    this.history.sort((a, b) => a - b);
    if (rules.length) this.rules = rules;
    const retry = Number(get('retry-after'));
    if (retry > 0) this.blockedUntil = Math.max(this.blockedUntil, this.now() + retry * 1000);
  }
}
