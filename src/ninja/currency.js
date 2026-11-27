// poe.ninja 공개 경제 API 로 화폐 환율(엑잘티드 기준)을 가져옴.
// 빌드/캐릭터 API 는 poe.ninja 가 '내부용'으로 명시하므로 사용하지 않음.
import { config } from '../config.js';

// 네트워크 실패 시 대략적인 기본값 (엑잘 환산)
const FALLBACK = { exalted: 1, divine: 400, chaos: 14, alch: 0.1, regal: 0.5, vaal: 1, annul: 5, mirror: 500000 };

const cache = new Map();

export async function getExaltedRates(league, { fetchImpl = fetch } = {}) {
  const hit = cache.get(league);
  if (hit && Date.now() - hit.at < config.cacheTtlMs) return hit.rates;
  try {
    const url = `${config.ninjaBase}/poe2/api/economy/exchange/current/overview?league=${encodeURIComponent(league)}&type=Currency`;
    const res = await fetchImpl(url, { headers: { 'User-Agent': config.userAgent, Accept: 'application/json' } });
    if (!res.ok) throw new Error(`poe.ninja ${res.status}`);
    const data = await res.json();
    const rates = ratesFromOverview(data);
    cache.set(league, { at: Date.now(), rates });
    return rates;
  } catch (err) {
    return { ...FALLBACK, _fallback: String(err.message || err) };
  }
}

/** overview 응답 -> { currencyId: 엑잘티드 환산값 } */
export function ratesFromOverview(data) {
  const primary = {}; // primaryValue = 기준화폐(divine) 단위 가격
  for (const line of data.lines || []) primary[line.id] = line.primaryValue;
  const primaryId = data.core?.primary || 'divine';
  primary[primaryId] = 1;
  const exPrimary = primary.exalted || (data.core?.rates?.exalted ? 1 / data.core.rates.exalted : null);
  if (!exPrimary) return { ...FALLBACK };
  const rates = { ...FALLBACK };
  for (const [id, v] of Object.entries(primary)) if (v > 0) rates[id] = v / exPrimary;
  rates.exalted = 1;
  return rates;
}

export async function getLeagues({ fetchImpl = fetch } = {}) {
  try {
    const res = await fetchImpl(`${config.ninjaBase}/poe2/api/economy/leagues`, { headers: { 'User-Agent': config.userAgent } });
    if (!res.ok) throw new Error(String(res.status));
    const list = await res.json();
    return list.map((l) => l.id || l.name);
  } catch {
    return ['Standard'];
  }
}
