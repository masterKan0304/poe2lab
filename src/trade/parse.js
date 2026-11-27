// trade2 fetch 결과(item JSON) -> 능력치 벡터
import { STAT_IDS } from '../slots.js';

// PoE2 아이템 텍스트의 마크업 "[Resistances|Fire Resistance]" -> "Fire Resistance"
export function stripMarkup(text) {
  return String(text)
    .replace(/\[([^|\]]+)\|([^\]]+)\]/g, '$2')
    .replace(/\[([^\]]+)\]/g, '$1')
    .trim();
}

const RES = { fire: 'fireRes', cold: 'coldRes', lightning: 'lightRes', chaos: 'chaosRes' };

/** 단일 옵션 문구 -> [[statId, value], ...] */
export function parseMod(rawText, { localDefences = false } = {}) {
  const t = stripMarkup(rawText);
  const out = [];
  let m;
  if ((m = t.match(/^([+-]?\d+(?:\.\d+)?) to maximum Life$/i))) out.push(['life', +m[1]]);
  else if ((m = t.match(/^([+-]?\d+(?:\.\d+)?) to maximum Mana$/i))) out.push(['mana', +m[1]]);
  else if ((m = t.match(/^([+-]?\d+(?:\.\d+)?) to maximum Energy Shield$/i))) {
    // 방어구의 "+# to maximum Energy Shield" 는 로컬 옵션이라 이미 속성(Energy Shield) 수치에 반영됨
    if (!localDefences) out.push(['es', +m[1]]);
  } else if ((m = t.match(/^([+-]?\d+(?:\.\d+)?) to maximum Runic Ward$/i))) {
    if (!localDefences) out.push(['ward', +m[1]]);
  } else if ((m = t.match(/^([+-]?\d+(?:\.\d+)?)% to all Elemental Resistances$/i))) {
    out.push(['fireRes', +m[1]], ['coldRes', +m[1]], ['lightRes', +m[1]]);
  } else if ((m = t.match(/^([+-]?\d+(?:\.\d+)?)% to (Fire|Cold|Lightning|Chaos)(?: and (Fire|Cold|Lightning|Chaos))? Resistances?$/i))) {
    out.push([RES[m[2].toLowerCase()], +m[1]]);
    if (m[3]) out.push([RES[m[3].toLowerCase()], +m[1]]);
  } else if ((m = t.match(/^(\d+(?:\.\d+)?)% increased Movement Speed$/i))) out.push(['moveSpeed', +m[1]]);
  else if ((m = t.match(/^(\d+(?:\.\d+)?)% reduced Movement Speed$/i))) out.push(['moveSpeed', -m[1]]);
  return out;
}

const MOD_FIELDS = ['implicitMods', 'explicitMods', 'fracturedMods', 'craftedMods', 'enchantMods', 'runeMods', 'desecratedMods'];

function propertyValue(item, names) {
  for (const p of item.properties || []) {
    const name = stripMarkup(p.name || '');
    if (names.some((n) => n.toLowerCase() === name.toLowerCase())) {
      const v = p.values?.[0]?.[0];
      const n = parseFloat(String(v).replace(/[^\d.]/g, ''));
      if (!Number.isNaN(n)) return n;
    }
  }
  return 0;
}

export function emptyStats() {
  return Object.fromEntries(STAT_IDS.map((s) => [s, 0]));
}

/** 아이템 전체 능력치 합계 */
export function itemStats(item) {
  const stats = emptyStats();
  const esProp = propertyValue(item, ['Energy Shield']);
  const wardProp = propertyValue(item, ['Runic Ward']);
  const localDefences = esProp > 0 || wardProp > 0 || propertyValue(item, ['Armour', 'Evasion Rating']) > 0;
  stats.es += esProp;
  stats.ward += wardProp;
  for (const f of MOD_FIELDS) {
    for (const mod of item[f] || []) {
      for (const [k, v] of parseMod(mod, { localDefences })) stats[k] += v;
    }
  }
  return stats;
}

/** 아이템이 가진 모든 옵션 문구 (마크업 제거) */
export function itemModTexts(item) {
  return MOD_FIELDS.flatMap((f) => (item[f] || []).map(stripMarkup));
}

/** "+3 to Level of all Spell Skills" 와 "+# to Level of all Spell Skills" 비교용 */
export function modTemplate(text) {
  return stripMarkup(text).replace(/[+-]?(?:\d+(?:\.\d+)?|#)/g, '#').toLowerCase();
}

export function hasModTemplate(item, template) {
  const want = modTemplate(template);
  return itemModTexts(item).some((t) => modTemplate(t) === want);
}
