// 오프라인/테스트용 가짜 trade 백엔드.
// 실서버 fetch 응답과 같은 형식(listing + item)의 매물을 결정적(seed 고정)으로 생성하고,
// 추상 쿼리의 조건(최소치, 가중치 합, 가격 상한, 정렬)을 그대로 적용한다.
import { itemStats, hasModTemplate, itemModTexts, modTemplate } from './parse.js';
import { STAT_IDS, SLOTS } from '../slots.js';

function rng(seedStr) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353), (h = (h << 13) | (h >>> 19));
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}
const ri = (r, a, b) => Math.floor(a + r() * (b - a + 1));
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

const BASES = {
  'armour.helmet': { str: 'Warrior Greathelm', dex: 'Trapper Hood', int: 'Kamasan Tiara', ward: 'Runeforged Visage' },
  'armour.chest': { str: 'Glorious Plate', dex: 'Slipstrike Vest', int: 'Vile Robe', ward: 'Runeforged Hauberk' },
  'armour.gloves': { str: 'Ancient Gauntlets', dex: 'Barbed Bracers', int: 'Vaal Gloves', ward: 'Runeforged Grips' },
  'armour.boots': { str: 'Vaal Greaves', dex: 'Dragonscale Boots', int: 'Sandsworn Sandals', ward: 'Runeforged Treads' },
  'armour.shield': { str: 'Vaal Tower Shield' }, 'armour.focus': { int: 'Hallowed Focus' }, 'armour.quiver': { dex: 'Primed Quiver' },
  'accessory.belt': 'Utility Belt', 'accessory.ring': ['Sapphire Ring', 'Ruby Ring', 'Topaz Ring', 'Amethyst Ring', 'Gold Ring'],
  'accessory.amulet': ['Stellar Amulet', 'Gold Amulet', 'Azure Amulet', 'Amber Amulet'],
  'weapon.bow': 'Gemini Bow', 'weapon.spear': 'Flying Spear', 'weapon.crossbow': 'Siege Crossbow', 'weapon.talisman': 'Fury Talisman', 'weapon.twomace': 'Ironwood Greathammer', 'armour.buckler': 'Ornate Buckler', 'weapon.wand': 'Wrath Wand', 'weapon.onemace': 'Marauding Mace', 'weapon.warstaff': 'Striking Quarterstaff', 'weapon.sceptre': 'Omen Sceptre',
};
const DEF_RANGE = { 'armour.chest': [300, 900], 'armour.helmet': [120, 400], 'armour.gloves': [80, 300], 'armour.boots': [80, 300], 'armour.focus': [80, 300], 'armour.shield': [0, 0], 'armour.quiver': [0, 0] };

const MOCK_UNIQUES = {
  "Kaom's Heart": { base: 'Glorious Plate', mods: ['+520 to maximum [Life|Life]', '+20% to [Resistances|Fire Resistance]'], props: [['Armour', 900]], price: 700 },
  Ingenuity: { base: 'Utility Belt', mods: ['+40% to all [ElementalResistance|Elemental Resistances]', '+60 to maximum Life'], props: [], price: 950 },
  Astramentis: { base: 'Stellar Amulet', mods: ['+100 to all Attributes'], props: [], price: 260 },
  Bramblejack: { base: 'Garment', mods: ['+90 to maximum Life', 'Reflects 250 Physical Damage to Melee Attackers'], props: [['Evasion Rating', 700]], price: 4 },
};

// 슬롯 카테고리별 붙을 수 있는 능력치와 롤 범위
function rollStats(r, category, defType) {
  const lines = [];
  const add = (p, f) => r() < p && lines.push(f());
  const isArmour = category.startsWith('armour.');
  const isJewel = category.startsWith('accessory.');
  if (!isArmour && !isJewel) return lines;
  add(isArmour && defType === 'int' ? 0.35 : 0.65, () => `+${ri(r, 40, category === 'armour.chest' ? 220 : 170)} to maximum [Life|Life]`);
  if (category === 'armour.boots') add(0.75, () => `${pick(r, [10, 15, 20, 25, 30, 35])}% increased [MovementSpeed|Movement Speed]`);
  if (category === 'accessory.amulet') add(0.35, () => `+${ri(r, 30, 90)} to maximum [EnergyShield|Energy Shield]`);
  if (category === 'accessory.ring') add(0.12, () => `+${ri(r, 37, 49)} to maximum Runic Ward`);
  if (['accessory.ring', 'accessory.amulet', 'armour.helmet'].includes(category)) add(0.4, () => `+${ri(r, 30, 140)} to maximum [Mana|Mana]`);
  if (isJewel) add(0.25, () => `+${ri(r, 8, 16)}% to all [ElementalResistance|Elemental Resistances]`);
  for (const el of ['Fire', 'Cold', 'Lightning']) add(0.4, () => `+${ri(r, 10, 45)}% to [Resistances|${el} Resistance]`);
  add(0.22, () => `+${ri(r, 7, 27)}% to [Resistances|Chaos Resistance]`);
  return lines;
}

const SELLER_A = ['Mist', 'Frost', 'Ember', 'Grim', 'Sly', 'Iron', 'Rune', 'Vaal', 'Ash', 'Storm', 'Dusk', 'Hollow'];
const SELLER_B = ['walker', 'fang', 'smith', 'trader', 'hunter', 'mancer', 'blade', 'seer', 'fox', 'knight'];

export class MockTradeClient {
  constructor({ extraModsByCategory = {} } = {}) {
    this.mode = 'mock';
    this.extraMods = extraModsByCategory; // { category: [{text,min,premium}] } — 빌드 프로필의 핵심 옵션
    this.pools = new Map();
    this.counter = 0;
    this.searches = 0;
  }

  get canTeleport() {
    return true;
  }

  pool(category, baseType) {
    const key = `${category}|${baseType || ''}`;
    if (this.pools.has(key)) return this.pools.get(key);
    const r = rng(key);
    const items = [];
    const n = category.startsWith('flask') || category.includes('charm') ? 40 : 260;
    for (let i = 0; i < n; i++) items.push(this.makeItem(r, category, baseType, `${key}#${i}`));
    this.pools.set(key, items);
    return items;
  }

  makeItem(r, category, baseType, id) {
    const bases = BASES[category];
    let defType = null;
    let typeLine = baseType;
    if (!typeLine) {
      if (bases && typeof bases === 'object' && !Array.isArray(bases)) {
        const types = Object.keys(bases);
        defType = r() < 0.1 && types.includes('ward') ? 'ward' : pick(r, types.filter((t) => t !== 'ward'));
        typeLine = bases[defType];
      } else typeLine = Array.isArray(bases) ? pick(r, bases) : bases || category;
    }
    const props = [];
    const range = DEF_RANGE[category];
    if (range && defType === 'int' && range[1] > 0) props.push({ name: '[EnergyShield|Energy Shield]', values: [[String(ri(r, range[0], range[1])), 1]], displayMode: 0, type: 18 });
    if (range && defType === 'ward' && range[1] > 0) props.push({ name: 'Runic Ward', values: [[String(ri(r, Math.round(range[0] * 0.4), Math.round(range[1] * 0.4))), 1]], displayMode: 0 });
    if (range && (defType === 'str' || defType === 'dex') && range[1] > 0) props.push({ name: defType === 'str' ? '[Armour|Armour]' : '[Evasion|Evasion Rating]', values: [[String(ri(r, range[0] * 2, range[1] * 2)), 1]], displayMode: 0 });

    const explicitMods = rollStats(r, category, defType);
    let premiumMult = 1;
    for (const m of this.extraMods[category] || []) {
      if (r() < 0.3) {
        const v = Math.max(1, Math.round((m.min || 1) * (0.7 + r() * 0.6)));
        explicitMods.push(m.text.replace('#', String(v)));
        if (m.premium && v >= (m.min || 1)) premiumMult *= 8 + r() * 12;
        else premiumMult *= 1.3;
      }
    }
    const item = { id, rarity: 'Rare', name: `${pick(r, ['Doom', 'Gloom', 'Vortex', 'Rapture'])} ${pick(r, ['Shell', 'Loop', 'Ward', 'Grasp'])}`, typeLine, baseType: typeLine, ilvl: ri(r, 70, 82), properties: props, explicitMods, identified: true };
    if (category.startsWith('flask') || category.includes('charm')) {
      item.rarity = 'Magic';
      item.name = '';
      item.explicitMods = [];
    }
    return this.withListing(r, item, this.priceFor(r, item, premiumMult));
  }

  priceFor(r, item, premiumMult) {
    if (item.rarity === 'Magic') return 1 + Math.floor(r() * 3);
    const baseMult = item.properties.length || item.explicitMods.some((m) => /Life|Resistance|Mana|Energy|Ward|Movement/.test(m)) ? 0.6 : 3;
    const s = itemStats(item);
    const score = s.life / 60 + s.es / 150 + s.ward / 30 + s.mana / 120 + (s.fireRes + s.coldRes + s.lightRes) / 30 + s.chaosRes / 12 + s.moveSpeed / 12;
    const noise = Math.exp((r() - 0.5) * 1.2);
    return Math.max(1, Math.round(baseMult * Math.exp(score * 0.55) * premiumMult * noise));
  }

  withListing(r, item, priceEx) {
    const seller = `${pick(r, SELLER_A)}${pick(r, SELLER_B)}${ri(r, 1, 99)}`;
    const divine = priceEx >= 400;
    const price = divine ? { type: '~price', amount: Math.round((priceEx / 400) * 10) / 10, currency: 'divine' } : { type: '~price', amount: priceEx, currency: 'exalted' };
    const name = [item.name, item.typeLine].filter(Boolean).join(' ');
    return {
      id: `mock-${item.id}`,
      listing: {
        method: 'psapi',
        indexed: new Date(Date.UTC(2026, 10, 20) + Math.floor(r() * 6 * 864e5)).toISOString(),
        account: { name: `${seller}#${ri(r, 1000, 9999)}`, lastCharacterName: `${seller}_${pick(r, ['LA', 'Spark', 'Slam', 'Monk'])}`, online: { league: 'Mock' } },
        price,
        whisper: `@${seller} Hi, I would like to buy your ${name} listed for ${price.amount} ${price.currency}`,
        hideout_token: `mock-token-${item.id}`,
      },
      item,
    };
  }

  uniqueListings(name, baseType) {
    const key = `unique|${name}`;
    if (this.pools.has(key)) return this.pools.get(key);
    const r = rng(key);
    const def = MOCK_UNIQUES[name] || { base: baseType || 'Unknown', mods: ['+40 to maximum Life'], props: [], price: 50 };
    const list = [];
    for (let i = 0; i < 6; i++) {
      const item = { id: `${key}#${i}`, rarity: 'Unique', name, typeLine: def.base, baseType: def.base, ilvl: 80, properties: def.props.map(([n, v]) => ({ name: n, values: [[String(v), 1]] })), explicitMods: def.mods, identified: true };
      list.push(this.withListing(r, item, Math.round(def.price * (0.9 + r() * 0.5))));
    }
    this.pools.set(key, list);
    return list;
  }

  async searchListings(league, q, { limit = 10 } = {}) {
    this.searches++;
    let list = q.uniqueName ? this.uniqueListings(q.uniqueName, q.baseType) : this.pool(q.category, q.baseType);
    const toEx = (l) => (l.listing.price.currency === 'divine' ? l.listing.price.amount * 400 : l.listing.price.amount);
    const weightOf = (s) => Object.entries(q.weights || {}).reduce((a, [k, w]) => a + (s[k] || 0) * w, 0);
    const rows = [];
    for (const l of list) {
      const s = itemStats(l.item);
      if (q.rarity === 'nonunique' && l.item.rarity === 'Unique') continue;
      if (q.maxPriceEx && toEx(l) > q.maxPriceEx) continue;
      if (q.esMin && s.es < q.esMin) continue;
      if (Object.entries(q.statMins || {}).some(([k, v]) => (s[k] || 0) < v)) continue;
      if (q.weightMin && weightOf(s) < q.weightMin) continue;
      if ((q.keyMods || []).some((m) => !keyModOk(l.item, m))) continue;
      rows.push({ l, w: weightOf(s), p: toEx(l) });
    }
    rows.sort((a, b) => (q.sort === 'weight' ? b.w - a.w || a.p - b.p : a.p - b.p));
    return { queryId: `mock${this.searches}`, total: rows.length, tradeUrl: null, unresolved: [], results: rows.slice(0, limit).map((x) => x.l) };
  }

  async travelToHideout(token) {
    return { mock: true, token };
  }
}

function keyModOk(item, m) {
  if (!hasModTemplate(item, m.text)) return false;
  if (m.min == null) return true;
  const want = modTemplate(m.text);
  const line = itemModTexts(item).find((t) => modTemplate(t) === want);
  const v = parseFloat((line.match(/\d+(?:\.\d+)?/) || [0])[0]);
  return v >= m.min;
}

/** 빌드 프로필의 핵심 옵션들이 매물에 등장하도록 구성한 mock 클라이언트 */
export function mockForProfiles(profiles) {
  const extra = {};
  for (const p of profiles) {
    for (const [slotId, spec] of Object.entries(p.slots || {})) {
      const cat = spec.category || SLOTS.find((s) => s.id === slotId)?.category;
      if (!cat) continue;
      for (const m of spec.keyMods || []) {
        extra[cat] = extra[cat] || [];
        if (!extra[cat].some((x) => x.text === m.text)) extra[cat].push(m);
      }
    }
  }
  return new MockTradeClient({ extraModsByCategory: extra });
}

export { STAT_IDS };
