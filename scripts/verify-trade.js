// 실서버 trade2 데이터와 이 앱의 가정(스탯 문구, 카테고리)을 대조한다. 로컬 PC 에서 실행하세요.
//   npm run verify
import { LiveTradeClient } from '../src/trade/live.js';
import { STAT_TEXTS } from '../src/trade/query.js';
import { SLOTS } from '../src/slots.js';
import { loadProfiles } from '../src/builds/profiles.js';

const client = new LiveTradeClient();
let problems = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { problems++; console.log(`  ✗ ${m}`); };

try {
  console.log('1) 능력치 -> trade 스탯 id');
  const idx = await client.getStatIndex();
  for (const stat of Object.keys(STAT_TEXTS)) {
    const id = idx.statId(stat);
    id ? ok(`${stat} = ${id}`) : bad(`${stat}: ${STAT_TEXTS[stat].map((x) => x.join(' ')).join(' / ')} 를 찾지 못함`);
  }

  console.log('2) 빌드 프로필 핵심 옵션');
  const seen = new Set();
  for (const p of loadProfiles()) for (const spec of Object.values(p.slots || {})) for (const m of spec.keyMods || []) {
    if (seen.has(m.text)) continue;
    seen.add(m.text);
    const id = idx.modId(m.text);
    id ? ok(`"${m.text}" = ${id}`) : bad(`"${m.text}" 를 찾지 못함 (문구 확인 필요)`);
  }

  console.log('3) 아이템 카테고리');
  const filters = await client.getDataFilters();
  const options = new Set();
  for (const g of filters.result || []) for (const f of g.filters || []) if (f.id === 'category') for (const o of f.option?.options || []) if (o.id) options.add(o.id);
  const cats = new Set([...SLOTS.map((s) => s.category), ...loadProfiles().flatMap((p) => Object.values(p.slots || {}).map((s) => s.category))].filter(Boolean));
  for (const c of cats) options.has(c) ? ok(c) : bad(`${c} 없음. 가능한 값: ${[...options].filter((o) => o.split('.')[0] === c.split('.')[0]).join(', ') || [...options].join(', ')}`);
} catch (err) {
  bad(`trade2 접속 실패: ${err.message}`);
}
console.log(problems ? `\n문제 ${problems}건 — src/trade/query.js(STAT_TEXTS), src/slots.js(category), 프로필 JSON 을 수정하세요.` : '\n모두 일치합니다.');
process.exit(problems ? 1 : 0);
