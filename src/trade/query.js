// 추상 슬롯 쿼리 -> trade2 검색 JSON 변환
// 추상 쿼리: { category, baseType, uniqueName, rarity, statMins:{stat:min}, weights:{stat:w}, weightMin,
//            esMin, keyMods:[{text,min}], sort:'price'|'weight', maxPriceEx, status }

// 능력치 -> trade 통계 문구 후보 (앞에서부터 우선). pseudo 는 여러 옵션 합산이라 우선 사용.
export const STAT_TEXTS = {
  life: [['pseudo', '+# total maximum Life'], ['explicit', '+# to maximum Life']],
  mana: [['pseudo', '+# total maximum Mana'], ['explicit', '+# to maximum Mana']],
  es: [['pseudo', '+# total maximum Energy Shield'], ['explicit', '+# to maximum Energy Shield']],
  ward: [['pseudo', '+# total maximum Runic Ward'], ['explicit', '+# to maximum Runic Ward']],
  fireRes: [['pseudo', '+#% total to Fire Resistance'], ['explicit', '+#% to Fire Resistance']],
  coldRes: [['pseudo', '+#% total to Cold Resistance'], ['explicit', '+#% to Cold Resistance']],
  lightRes: [['pseudo', '+#% total to Lightning Resistance'], ['explicit', '+#% to Lightning Resistance']],
  chaosRes: [['pseudo', '+#% total to Chaos Resistance'], ['explicit', '+#% to Chaos Resistance']],
  moveSpeed: [['pseudo', '#% increased Movement Speed'], ['explicit', '#% increased Movement Speed']],
};

const normText = (t) => String(t).replace(/\s+/g, ' ').trim().toLowerCase();

/** /api/trade2/data/stats 응답으로 문구 -> id 색인 */
export class StatIndex {
  constructor(statsResponse) {
    this.byKey = new Map();
    for (const group of statsResponse?.result || []) {
      for (const e of group.entries || []) {
        const type = e.type || String(e.id).split('.')[0];
        const key = `${type}|${normText(e.text)}`;
        if (!this.byKey.has(key)) this.byKey.set(key, e.id);
      }
    }
  }
  find(type, text) {
    return this.byKey.get(`${type}|${normText(text)}`) || null;
  }
  /** 내부 능력치 id -> trade stat id */
  statId(stat) {
    for (const [type, text] of STAT_TEXTS[stat] || []) {
      const id = this.find(type, text);
      if (id) return id;
    }
    return null;
  }
  /** 옵션 문구(# 템플릿) -> explicit/implicit/rune 중 첫 매치 */
  modId(text) {
    const t = String(text).replace(/[+-]?\d+(?:\.\d+)?/g, (m) => (m.startsWith('+') ? '+#' : '#'));
    for (const type of ['explicit', 'pseudo', 'implicit', 'rune', 'fractured']) {
      const id = this.find(type, t);
      if (id) return id;
    }
    return null;
  }
}

export function buildTradeQuery(q, index) {
  const unresolved = [];
  const filters = {};
  if (q.category) filters.type_filters = { filters: { category: { option: q.category } } };
  if (q.rarity) {
    filters.type_filters = filters.type_filters || { filters: {} };
    filters.type_filters.filters.rarity = { option: q.rarity };
  }
  if (q.maxPriceEx) filters.trade_filters = { filters: { price: { max: Math.round(q.maxPriceEx), option: 'exalted' } } };
  if (q.esMin) filters.equipment_filters = { filters: { es: { min: Math.round(q.esMin) } } };

  const stats = [];
  const weightFilters = [];
  for (const [stat, w] of Object.entries(q.weights || {})) {
    if (!(w > 0)) continue;
    const id = index.statId(stat);
    if (id) weightFilters.push({ id, value: { weight: Math.round(w * 100) / 100 } });
    else unresolved.push(stat);
  }
  let weightGroupIndex = -1;
  if (weightFilters.length) {
    weightGroupIndex = stats.length;
    stats.push({ type: 'weight', value: q.weightMin ? { min: Math.round(q.weightMin * 100) / 100 } : {}, filters: weightFilters });
  }
  const andFilters = [];
  for (const [stat, min] of Object.entries(q.statMins || {})) {
    const id = index.statId(stat);
    if (id) andFilters.push({ id, value: { min } });
    else unresolved.push(stat);
  }
  for (const m of q.keyMods || []) {
    const id = index.modId(m.text);
    if (id) andFilters.push({ id, value: m.min != null ? { min: m.min } : {} });
    else unresolved.push(m.text);
  }
  if (andFilters.length) stats.push({ type: 'and', filters: andFilters });
  if (!stats.length) stats.push({ type: 'and', filters: [] });

  const query = { status: { option: q.status || 'securable' }, stats, filters };
  if (q.uniqueName) query.name = q.uniqueName;
  if (q.baseType) query.type = q.baseType;

  const sort = q.sort === 'weight' && weightGroupIndex >= 0 ? { [`statgroup.${weightGroupIndex}`]: 'desc' } : { price: 'asc' };
  return { body: { query, sort }, unresolved };
}
