// 장비 슬롯 정의. 추천 세트 하나 = 아래 슬롯 전부.
// category 는 trade2 의 type_filters.category 옵션 값. (npm run verify 로 실서버 값과 대조 가능)
export const SLOTS = [
  { id: 'helmet', label: '투구', category: 'armour.helmet', kind: 'armour' },
  { id: 'body', label: '갑옷', category: 'armour.chest', kind: 'armour' },
  { id: 'gloves', label: '장갑', category: 'armour.gloves', kind: 'armour' },
  { id: 'boots', label: '장화', category: 'armour.boots', kind: 'armour' },
  { id: 'weapon1', label: '무기 1', category: null, kind: 'weapon' }, // 빌드 프로필이 결정
  { id: 'weapon2', label: '무기 2 / 보조', category: null, kind: 'weapon' },
  { id: 'belt', label: '허리띠', category: 'accessory.belt', kind: 'jewellery' },
  { id: 'ring1', label: '반지 1', category: 'accessory.ring', kind: 'jewellery', pool: 'ring' },
  { id: 'ring2', label: '반지 2', category: 'accessory.ring', kind: 'jewellery', pool: 'ring' },
  { id: 'amulet', label: '목걸이', category: 'accessory.amulet', kind: 'jewellery' },
  { id: 'charm1', label: '호신부 1', category: 'azmeri.charm', kind: 'charm', pool: 'charm' },
  { id: 'charm2', label: '호신부 2', category: 'azmeri.charm', kind: 'charm', pool: 'charm' },
  { id: 'charm3', label: '호신부 3', category: 'azmeri.charm', kind: 'charm', pool: 'charm' },
  { id: 'flaskLife', label: '생명력 플라스크', category: 'flask.life', kind: 'flask' },
  { id: 'flaskMana', label: '마나 플라스크', category: 'flask.mana', kind: 'flask' },
];

// 목표로 설정 가능한 능력치
export const STATS = [
  { id: 'life', label: '생명력' },
  { id: 'es', label: '에너지 보호막' },
  { id: 'ward', label: '룬 수호' },
  { id: 'mana', label: '마나' },
  { id: 'fireRes', label: '화염 저항', res: true },
  { id: 'coldRes', label: '냉기 저항', res: true },
  { id: 'lightRes', label: '번개 저항', res: true },
  { id: 'chaosRes', label: '카오스 저항', res: true },
  { id: 'moveSpeed', label: '이동 속도 %' },
];
export const STAT_IDS = STATS.map((s) => s.id);

// 슬롯 종류별로 해당 능력치가 붙을 수 있는지 (쿼리 가중치/mock 생성에 사용)
export const SLOT_STATS = {
  armour: ['life', 'es', 'ward', 'mana', 'fireRes', 'coldRes', 'lightRes', 'chaosRes'],
  jewellery: ['life', 'es', 'ward', 'mana', 'fireRes', 'coldRes', 'lightRes', 'chaosRes'],
  weapon: [],
  offhand: ['life', 'es', 'mana', 'fireRes', 'coldRes', 'lightRes', 'chaosRes'],
  charm: [],
  flask: [],
};

export function slotStats(slot) {
  const kind = slot.kind === 'weapon' && slot.offhand ? 'offhand' : slot.kind;
  let list = SLOT_STATS[kind] || [];
  if (slot.id === 'boots') list = [...list, 'moveSpeed'];
  if (slot.id === 'gloves' || slot.id === 'body') list = list.filter((s) => s !== 'mana');
  if (slot.id === 'belt' || slot.id.startsWith('ring')) list = list.filter((s) => s !== 'es');
  return list;
}
