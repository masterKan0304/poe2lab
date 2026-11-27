import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeNeeds, planGear } from '../src/planner.js';
import { loadProfiles, matchProfile, slotRequirements } from '../src/builds/profiles.js';
import { mockForProfiles } from '../src/trade/mock.js';
import { SLOTS } from '../src/slots.js';

const RATES = { exalted: 1, divine: 400, chaos: 14 };

test('저항 필요량: 기본 페널티 반영, 75% 상한', () => {
  const { needs } = computeNeeds({ fireRes: 90, chaosRes: 30, life: 1000 }, { elementalPenalty: -60, campaignBonus: 20 });
  assert.equal(needs.fireRes, 115); // 75 - (-40)
  assert.equal(needs.chaosRes, 30);
  assert.equal(needs.life, 1000);
});

test('90% 이상 착용 유니크는 필수 장비로 고정', () => {
  const profiles = loadProfiles();
  const { profile } = matchProfile(profiles, 'Titan', ['Sunder']);
  const req = slotRequirements(profile);
  assert.equal(req.body.mustHave.name, "Kaom's Heart");
});

test('직업/스킬 매칭: 스킬이 하나도 안 겹치면 null', () => {
  const profiles = loadProfiles();
  assert.equal(matchProfile(profiles, 'Deadeye', ['Nonexistent Skill']), null);
  assert.equal(matchProfile(profiles, 'Deadeye', ['Tornado Shot']).profile.class, 'Deadeye');
});

test('mock 거래소로 전체 파이프라인: 모든 슬롯 채움 + 목표 충족', async () => {
  const trade = mockForProfiles(loadProfiles());
  const r = await planGear(
    { league: 'Test', className: 'Titan', skills: ['Rolling Slam', 'Sunder', 'Leap Slam'], targets: { life: 1500, fireRes: 75, coldRes: 75, lightRes: 75, chaosRes: 20, moveSpeed: 25 } },
    { trade, profiles: loadProfiles(), rates: RATES },
  );
  assert.ok(r.ok);
  assert.ok(r.feasible, JSON.stringify(r.shortfall));
  const set = r.sets[0];
  for (const s of SLOTS) assert.ok(set.items[s.id], `슬롯 ${s.id} 비어있음`);
  assert.equal(set.items.body.name.includes("Kaom's Heart"), true);
  assert.ok(set.totals.life >= 1500);
  for (const k of ['fireRes', 'coldRes', 'lightRes']) assert.ok(set.finalRes[k].raw >= 75);
  assert.ok(set.items.helmet.seller && set.items.helmet.hideoutToken && set.items.helmet.whisper);
});

test('양손 무기 빌드는 무기 2 를 비움', async () => {
  const r = await planGear(
    { league: 'Test', className: 'Gemling Legionnaire', skills: ['Ice Strike'], targets: { life: 800, fireRes: 75, coldRes: 75, lightRes: 75 } },
    { trade: mockForProfiles(loadProfiles()), profiles: loadProfiles(), rates: RATES },
  );
  assert.ok(r.feasible);
  assert.equal(r.sets[0].items.weapon2, null);
  assert.match(r.sets[0].items.belt.name, /Ingenuity/);
});

test('과한 목표는 결과 없음', async () => {
  const r = await planGear(
    { league: 'Test', className: 'Deadeye', skills: ['Lightning Arrow'], targets: { life: 20000 } },
    { trade: mockForProfiles(loadProfiles()), profiles: loadProfiles(), rates: RATES },
  );
  assert.equal(r.feasible, false);
  assert.equal(r.reason, 'targets-unreachable');
  assert.equal(r.sets.length, 0);
});
