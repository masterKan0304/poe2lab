import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classToEn, skillToEn } from '../src/i18n.js';
import { parseAscendancies, parseGems } from '../scripts/build-i18n.js';
import { planGear } from '../src/planner.js';
import { loadProfiles } from '../src/builds/profiles.js';
import { mockForProfiles } from '../src/trade/mock.js';

test('한글/영문 이름 정규화', () => {
  assert.equal(classToEn('데드아이'), 'Deadeye');
  assert.equal(classToEn('deadeye'), 'Deadeye');
  assert.equal(skillToEn('번개 화살'), 'Lightning Arrow');
  assert.equal(skillToEn('번개화살'), 'Lightning Arrow');
  assert.equal(skillToEn('없는 스킬'), '없는 스킬');
});

test('poe2db HTML 파싱', () => {
  const asc = parseAscendancies('<figcaption><a class="Ranger" data-hover="https://x/kr/Poe_Data_Ascendancy_hover/ab" href="/kr/Deadeye">데드아이</a></figcaption>');
  assert.deepEqual(asc.get('Deadeye'), { base: 'Ranger', name: '데드아이' });
  const gems = parseGems('<a class="gemitem" data-hover="?s=x" href="/us/Tempest_Flurry">Tempest Flurry\n</a><a class="gem_blue" href="/kr/Spark">전기불꽃</a>');
  assert.equal(gems.get('Tempest_Flurry'), 'Tempest Flurry');
  assert.equal(gems.get('Spark'), '전기불꽃');
});

const RATES = { exalted: 1, divine: 400 };

test('한글 입력으로 샘플 프로필 매칭', async () => {
  const profiles = loadProfiles();
  const r = await planGear({ league: 'T', className: '데드아이', skills: ['번개 화살'], targets: { life: 800 } }, { trade: mockForProfiles(profiles), profiles, rates: RATES });
  assert.equal(r.profile.id, 'sample-deadeye-la');
  assert.ok(r.feasible);
});

test('샘플이 없는 전직은 일반 프로필로 검색', async () => {
  const profiles = loadProfiles();
  const r = await planGear({ league: 'T', className: '패스파인더', skills: [], targets: { life: 800, fireRes: 75 } }, { trade: mockForProfiles(profiles), profiles, rates: RATES });
  assert.equal(r.profile.source, 'generic');
  assert.ok(r.feasible);
  assert.ok(r.sets[0].items.weapon1.name);
});

test('예산: 엑잘 + 디바인 환산', async () => {
  const profiles = loadProfiles();
  const r = await planGear({ league: 'T', className: 'Deadeye', skills: ['Lightning Arrow'], targets: { life: 500 }, budget: { ex: 10, div: 0.5 } }, { trade: mockForProfiles(profiles), profiles, rates: RATES });
  assert.equal(r.budgetEx, 210);
  for (const s of r.sets) assert.ok(s.totalEx <= 210);
});

test('동시에 만족 불가한 목표는 낮출 값을 제안', async () => {
  const profiles = loadProfiles();
  const r = await planGear({ league: 'T', className: 'Titan', skills: ['x'], targets: { life: 1400, fireRes: 75, coldRes: 75, lightRes: 75, chaosRes: 40, moveSpeed: 30 } }, { trade: mockForProfiles(profiles), profiles: [], rates: RATES });
  assert.equal(r.reason, 'targets-conflict');
  const [k, v] = Object.entries(r.conflict)[0];
  const retry = await planGear({ league: 'T', className: 'Titan', skills: ['x'], targets: { life: 1400, fireRes: 75, coldRes: 75, lightRes: 75, chaosRes: 40, moveSpeed: 30, [k]: v.maxWithOthers } }, { trade: mockForProfiles(profiles), profiles: [], rates: RATES });
  assert.ok(retry.feasible);
});
