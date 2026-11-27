// 빌드 프로필 = "같은 직업·스킬을 쓰는 유저들이 슬롯별로 무엇을 착용하는가" 의 집계 결과.
// 지금은 샘플 JSON + 사용자가 업로드한 JSON 을 사용한다. (poe.ninja 빌드 API 는 내부용이라 직접 호출하지 않음)
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from '../config.js';
import { SLOTS, STAT_IDS } from '../slots.js';

export const MUST_HAVE_USAGE = 0.9; // 90% 이상이 착용 -> 가격 무관 필수 장비
export const KEY_MOD_USAGE = 0.5; // 50% 이상이 챙기는 옵션 -> 해당 슬롯 기본 요구 옵션

const BUILD_DIR = path.join(ROOT, 'data', 'builds');
const USER_DIR = path.join(BUILD_DIR, 'user');

const norm = (s) => String(s || '').trim().toLowerCase();

export function validateProfile(p) {
  const errors = [];
  if (!p || typeof p !== 'object') return ['프로필이 객체가 아닙니다'];
  if (!p.id) errors.push('id 누락');
  if (!p.class) errors.push('class 누락');
  if (!Array.isArray(p.skills) || p.skills.length === 0) errors.push('skills 배열 누락');
  const slotIds = new Set(SLOTS.map((s) => s.id));
  for (const k of Object.keys(p.slots || {})) if (!slotIds.has(k)) errors.push(`알 수 없는 슬롯: ${k}`);
  for (const k of Object.keys(p.typicalTargets || {})) if (!STAT_IDS.includes(k)) errors.push(`알 수 없는 능력치: ${k}`);
  return errors;
}

function loadFile(file, source) {
  const json = JSON.parse(readFileSync(file, 'utf8'));
  const list = Array.isArray(json) ? json : json.profiles || [json];
  return list.filter((p) => validateProfile(p).length === 0).map((p) => ({ ...p, source: p.source || source }));
}

export function loadProfiles() {
  const out = [];
  for (const f of readdirSync(BUILD_DIR).filter((f) => f.endsWith('.json'))) out.push(...loadFile(path.join(BUILD_DIR, f), 'sample'));
  if (existsSync(USER_DIR)) {
    for (const f of readdirSync(USER_DIR).filter((f) => f.endsWith('.json'))) out.push(...loadFile(path.join(USER_DIR, f), 'user'));
  }
  return out;
}

export function saveUserProfiles(json) {
  const list = Array.isArray(json) ? json : json.profiles || [json];
  const results = list.map((p) => ({ id: p?.id, errors: validateProfile(p) }));
  const ok = list.filter((_, i) => results[i].errors.length === 0);
  if (ok.length) {
    mkdirSync(USER_DIR, { recursive: true });
    for (const p of ok) writeFileSync(path.join(USER_DIR, `${String(p.id).replace(/[^\w-]/g, '_')}.json`), JSON.stringify({ ...p, source: 'user' }, null, 2));
  }
  return results;
}

/** 직업 + 스킬 3종과 가장 많이 겹치는 프로필 */
export function matchProfile(profiles, className, skills) {
  const want = new Set((skills || []).map(norm).filter(Boolean));
  let best = null;
  for (const p of profiles) {
    if (className && norm(p.class) !== norm(className)) continue;
    const overlap = p.skills.filter((s) => want.has(norm(s))).length;
    const score = overlap * 1e6 + (p.sampleSize || 0);
    if (!best || score > best.score) best = { profile: p, overlap, score };
  }
  if (!best || (want.size > 0 && best.overlap === 0)) return null;
  return { profile: best.profile, overlap: best.overlap };
}

/** 프로필 -> 슬롯별 요구사항 (필수 유니크, 핵심 옵션, 카테고리) */
export function slotRequirements(profile) {
  const req = {};
  for (const slot of SLOTS) {
    const spec = profile?.slots?.[slot.id] || {};
    const mustHave = (spec.uniques || []).filter((u) => u.usage >= MUST_HAVE_USAGE).sort((a, b) => b.usage - a.usage)[0] || null;
    req[slot.id] = {
      category: spec.category || slot.category,
      baseType: spec.baseType || null,
      offhand: !!spec.offhand,
      twoHanded: !!spec.twoHanded,
      mustHave,
      popularUniques: (spec.uniques || []).filter((u) => u !== mustHave),
      keyMods: (spec.keyMods || []).filter((m) => (m.usage ?? 1) >= KEY_MOD_USAGE),
    };
  }
  return req;
}
