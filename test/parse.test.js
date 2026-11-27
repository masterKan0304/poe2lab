import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMod, itemStats, stripMarkup, hasModTemplate } from '../src/trade/parse.js';

test('마크업 제거', () => {
  assert.equal(stripMarkup('+35% to [Resistances|Fire Resistance]'), '+35% to Fire Resistance');
  assert.equal(stripMarkup('+20 to [Spirit]'), '+20 to Spirit');
});

test('저항/생명력/이속 옵션 파싱', () => {
  assert.deepEqual(parseMod('+12% to all [ElementalResistance|Elemental Resistances]'), [['fireRes', 12], ['coldRes', 12], ['lightRes', 12]]);
  assert.deepEqual(parseMod('+20% to Fire and Cold Resistances'), [['fireRes', 20], ['coldRes', 20]]);
  assert.deepEqual(parseMod('+15% to [Resistances|Chaos Resistance]'), [['chaosRes', 15]]);
  assert.deepEqual(parseMod('-10% to Cold Resistance'), [['coldRes', -10]]);
  assert.deepEqual(parseMod('+88 to maximum [Life|Life]'), [['life', 88]]);
  assert.deepEqual(parseMod('30% increased [MovementSpeed|Movement Speed]'), [['moveSpeed', 30]]);
  assert.deepEqual(parseMod('+3 to Level of all Spell Skills'), []);
});

test('방어구의 로컬 ES 옵션은 속성 수치로만 계산 (이중 계산 방지)', () => {
  const helm = { properties: [{ name: '[EnergyShield|Energy Shield]', values: [['250', 1]] }], explicitMods: ['+40 to maximum Energy Shield', '+50 to maximum Life'] };
  const s = itemStats(helm);
  assert.equal(s.es, 250);
  assert.equal(s.life, 50);
  const amulet = { properties: [], explicitMods: ['+40 to maximum Energy Shield'] };
  assert.equal(itemStats(amulet).es, 40);
});

test('룬/균열/임플리싯 옵션도 합산', () => {
  const s = itemStats({ implicitMods: ['+10% to Fire Resistance'], runeMods: ['+12% to Fire Resistance'], fracturedMods: ['+30 to maximum Life'] });
  assert.equal(s.fireRes, 22);
  assert.equal(s.life, 30);
});

test('옵션 템플릿 비교', () => {
  assert.ok(hasModTemplate({ explicitMods: ['+3 to Level of all Spell Skills'] }, '+# to Level of all Spell Skills'));
  assert.ok(!hasModTemplate({ explicitMods: ['+3 to Level of all Melee Skills'] }, '+# to Level of all Spell Skills'));
});
