import { test } from 'node:test';
import assert from 'node:assert/strict';
import { optimize, pruneDominated } from '../src/optimizer.js';

const c = (uid, priceEx, stats) => ({ uid, priceEx, stats });

test('모든 목표를 만족하는 최저가 조합을 찾는다', () => {
  const slots = [
    { id: 'a', candidates: [c('a1', 1, { life: 50 }), c('a2', 10, { life: 100, fireRes: 30 }), c('a3', 3, { fireRes: 40 })] },
    { id: 'b', candidates: [c('b1', 1, { life: 60 }), c('b2', 5, { life: 100 }), c('b3', 2, { fireRes: 35 })] },
  ];
  const r = optimize(slots, { life: 100, fireRes: 30 });
  assert.ok(r.feasible);
  // 정답: a2(10)+b1(1)=11 vs a3(3)+b2(5)=8 -> 8
  assert.equal(r.sets[0].totalEx, 8);
  assert.equal(r.sets[0].picks.a.uid, 'a3');
  assert.equal(r.sets[0].picks.b.uid, 'b2');
});

test('목표가 과하면 결과 없음 + 부족분 보고', () => {
  const slots = [{ id: 'a', candidates: [c('a1', 1, { life: 50 })] }, { id: 'b', candidates: [c('b1', 1, { life: 60 })] }];
  const r = optimize(slots, { life: 500 });
  assert.equal(r.feasible, false);
  assert.equal(r.reason, 'targets-unreachable');
  assert.deepEqual(r.shortfall.life, { need: 500, maxPossible: 110 });
});

test('공유 풀(반지 2개)은 같은 매물을 두 번 고르지 않는다', () => {
  const ring = [c('r1', 1, { life: 100 }), c('r2', 50, { life: 100 })];
  const r = optimize([{ id: 'ring1', pool: 'ring', candidates: ring }, { id: 'ring2', pool: 'ring', candidates: ring }], { life: 200 });
  assert.ok(r.feasible);
  assert.notEqual(r.sets[0].picks.ring1.uid, r.sets[0].picks.ring2.uid);
  assert.equal(r.sets[0].totalEx, 51);
});

test('예산 초과면 over-budget', () => {
  const r = optimize([{ id: 'a', candidates: [c('a1', 100, { life: 100 })] }], { life: 100 }, { budgetEx: 50 });
  assert.equal(r.feasible, false);
  assert.equal(r.reason, 'over-budget');
});

test('지배되는 후보 제거', () => {
  const kept = pruneDominated([c('x', 5, { life: 50 }), c('y', 3, { life: 60 }), c('z', 10, { life: 200 })], ['life']);
  assert.deepEqual(kept.map((k) => k.uid), ['y', 'z']);
});

test('여러 선택지는 서로 다른 조합', () => {
  const slots = ['a', 'b', 'c'].map((id) => ({ id, candidates: [1, 2, 3, 4].map((p) => c(`${id}${p}`, p, { life: 10 * p })) }));
  const r = optimize(slots, { life: 60 });
  assert.equal(r.sets.length, 3);
  const sigs = new Set(r.sets.map((s) => Object.values(s.picks).map((p) => p.uid).join()));
  assert.equal(sigs.size, 3);
  assert.ok(r.sets[0].totalEx <= r.sets[1].totalEx);
});
