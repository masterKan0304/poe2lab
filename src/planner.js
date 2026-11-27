// 장비 설계 파이프라인: 빌드 매칭 -> 목표치 계산 -> 슬롯별 매물 검색(타협 포함) -> 세트 최적화
import { SLOTS, STATS, STAT_IDS, slotStats } from './slots.js';
import { matchProfile, slotRequirements, genericProfile } from './builds/profiles.js';
import { classToEn, skillToEn, classInfo } from './i18n.js';
import { itemStats, emptyStats, stripMarkup } from './trade/parse.js';
import { optimize } from './optimizer.js';

export const RES_MAX = 75;
export const DEFAULT_RES_SETTINGS = {
  elementalPenalty: -60, // 엔드게임 원소 저항 페널티 (PoE2 위키 기준, 패치마다 확인 필요)
  campaignBonus: 20, // 캠페인 보상(저항 보너스) 전부 획득 시 +20%
  chaosBase: 0, // 카오스 저항은 페널티 없음
  other: { fireRes: 0, coldRes: 0, lightRes: 0, chaosRes: 0 }, // 패시브 트리 등 장비 외 저항
};

/** 장비에서 채워야 하는 양 계산 */
// 옵션 한 줄의 일반적인 수치. 가중치를 "쓸모 있는 옵션 몇 줄짜리인가" 로 맞추는 데 사용
// (필요량이 작은 능력치 — 예: 카오스 20% — 가 가중치를 독차지하지 않도록)
const TYPICAL_ROLL = { life: 90, es: 150, ward: 40, mana: 70, fireRes: 30, coldRes: 30, lightRes: 30, chaosRes: 18, moveSpeed: 20 };

export function slotWeights(statsOfSlot, needs, rollers) {
  const w = {};
  for (const k of statsOfSlot) if (needs[k]) w[k] = 1 / Math.max(needs[k] / rollers[k], TYPICAL_ROLL[k] || 1);
  return w;
}

export function computeNeeds(targets, resSettings = DEFAULT_RES_SETTINGS) {
  const rs = { ...DEFAULT_RES_SETTINGS, ...resSettings, other: { ...DEFAULT_RES_SETTINGS.other, ...(resSettings?.other || {}) } };
  const needs = {};
  const base = {};
  for (const { id, res } of STATS) {
    let t = Number(targets?.[id] || 0);
    if (!(t > 0)) continue;
    if (res) {
      t = Math.min(t, RES_MAX);
      base[id] = (id === 'chaosRes' ? rs.chaosBase : rs.elementalPenalty + rs.campaignBonus) + (rs.other[id] || 0);
      needs[id] = Math.max(0, t - base[id]);
    } else needs[id] = t;
  }
  for (const k of Object.keys(needs)) if (needs[k] <= 0) delete needs[k];
  return { needs, base, resSettings: rs };
}

export function toExalted(price, rates) {
  if (!price || price.amount == null) return null;
  const r = rates[price.currency];
  return r ? price.amount * r : null;
}

function summarizeListing(result, priceEx, tradeUrl) {
  const { listing, item } = result;
  const mods = ['implicitMods', 'runeMods', 'enchantMods', 'explicitMods', 'fracturedMods', 'desecratedMods', 'craftedMods'].flatMap((f) => (item[f] || []).map((m) => ({ kind: f.replace('Mods', ''), text: stripMarkup(m) })));
  return {
    id: result.id,
    name: [item.name, item.typeLine].filter(Boolean).join(' ').trim() || item.baseType,
    baseType: item.baseType,
    rarity: item.rarity,
    ilvl: item.ilvl,
    icon: item.icon || null,
    properties: (item.properties || []).map((p) => ({ name: stripMarkup(p.name), value: p.values?.[0]?.[0] })),
    mods,
    price: listing.price,
    priceEx: Math.round(priceEx * 100) / 100,
    seller: listing.account?.name,
    character: listing.account?.lastCharacterName,
    online: !!listing.account?.online,
    indexed: listing.indexed,
    whisper: listing.whisper || null,
    hideoutToken: listing.hideout_token || null,
    tradeUrl,
  };
}

export async function planGear(input, { trade, profiles, rates, onProgress = () => {} }) {
  const notes = [];
  // 한글로 입력해도 영문으로 정규화
  const className = classToEn(input.className);
  const skills = (input.skills || []).filter(Boolean).map(skillToEn);
  if (!className) return { ok: false, error: '직업(전직)을 입력하세요.' };
  let match = matchProfile(profiles, className, skills);
  if (!match) {
    const info = classInfo(className);
    const sameClass = profiles.filter((p) => p.class.toLowerCase() === className.toLowerCase());
    match = { profile: genericProfile(className, info?.base, skills), overlap: 0 };
    notes.push(sameClass.length
      ? `입력한 스킬과 겹치는 ${className} 빌드 프로필이 없어 일반 프로필로 검색합니다 (필수 장비·핵심 옵션 없이 목표 능력치만 사용)`
      : `${className} 빌드 프로필이 없어 일반 프로필로 검색합니다 (필수 장비·핵심 옵션 없이 목표 능력치만 사용)`);
  }
  const profile = match.profile;
  if (profile.source !== 'generic' && match.overlap < skills.length) notes.push(`스킬 ${match.overlap}/${skills.length}개 일치하는 프로필 "${profile.id}" 사용`);

  // 목표치: 사용자가 비운 항목은 (자동 모드면) 프로필의 일반적인 수치로 채움
  const targets = {};
  for (const id of STAT_IDS) {
    const v = Number(input.targets?.[id]);
    if (v > 0) targets[id] = v;
    else if (input.autoTargets && profile.typicalTargets?.[id] > 0) targets[id] = profile.typicalTargets[id];
  }
  const { needs, base, resSettings } = computeNeeds(targets, input.resSettings);
  const req = slotRequirements(profile);
  const league = input.league;
  const status = input.status || 'securable';
  // 예산: 엑잘 + 디바인(현재 환율로 엑잘 환산)
  const budgetRaw = (Number(input.budget?.ex) || 0) + (Number(input.budget?.div) || 0) * (rates.divine || 0) + (Number(input.budgetEx) || 0);
  const budgetEx = budgetRaw > 0 ? budgetRaw : null;
  const compromise = { enabled: input.compromise?.enabled !== false, ratio: Number(input.compromise?.ratio) || 3, minDiffEx: 10 };
  const depth = input.depth === 'quick' ? 1 : 2;

  // 각 능력치를 굴릴 수 있는 슬롯 수 -> 슬롯당 "공정 몫" 가중치
  const activeSlots = SLOTS.filter((s) => !req[s.id].mustHave && !req[s.id].twoHanded).map((s) => ({ ...s, offhand: req[s.id].offhand }));
  const rollers = Object.fromEntries(Object.keys(needs).map((k) => [k, activeSlots.filter((s) => slotStats(s).includes(k)).length || 1]));

  const searchCache = new Map();
  let searches = 0;
  const search = async (q, limit = 10) => {
    const key = JSON.stringify(q) + limit;
    if (!searchCache.has(key)) {
      searches++;
      searchCache.set(key, trade.searchListings(league, { status, ...q }, { limit }));
    }
    return searchCache.get(key);
  };

  const collect = async (si, queries, meta) => {
    const seen = new Set(si.candidates.map((c) => c.uid));
    for (const { q, limit } of queries) {
      let res;
      try {
        res = await search(q, limit);
      } catch (err) {
        meta.notes.push(`검색 실패: ${err.message}`);
        if (err.status === 403 || err.status === 429) throw err;
        continue;
      }
      if (res.tradeUrl && !meta.tradeUrls.includes(res.tradeUrl)) meta.tradeUrls.push(res.tradeUrl);
      if (res.unresolved?.length) {
        const msg = `trade 에서 못 찾은 옵션(무시됨): ${res.unresolved.join(', ')}`;
        if (!meta.notes.includes(msg)) meta.notes.push(msg);
      }
      for (const result of res.results) {
        if (!result?.listing || seen.has(result.id)) continue;
        const priceEx = toExalted(result.listing.price, rates);
        if (priceEx == null) continue;
        seen.add(result.id);
        si.candidates.push({ uid: result.id, priceEx, stats: itemStats(result.item), result, tradeUrl: res.tradeUrl });
      }
    }
  };

  const slotInputs = [];
  const slotMeta = {};
  const total = SLOTS.length;
  let i = 0;
  for (const slot of SLOTS) {
    i++;
    const r = req[slot.id];
    const meta = (slotMeta[slot.id] = { label: slot.label, notes: [], tradeUrls: [] });
    onProgress({ step: 'search', slot: slot.id, label: slot.label, done: i - 1, total });

    if (r.twoHanded) {
      meta.notes.push('양손 무기 사용 — 비워둠');
      slotInputs.push({ id: slot.id, candidates: [{ uid: `none-${slot.id}`, priceEx: 0, stats: emptyStats(), none: true }] });
      continue;
    }

    const queries = [];
    if (r.mustHave) {
      meta.notes.push(`필수 장비: ${r.mustHave.name} (${Math.round(r.mustHave.usage * 100)}% 착용 — 가격 무관)`);
      queries.push({ q: { uniqueName: r.mustHave.name, baseType: r.mustHave.baseType }, limit: 5 });
    } else if (slot.kind === 'flask' || slot.kind === 'charm') {
      queries.push({ q: { category: r.category, baseType: r.baseType || undefined }, limit: 5 });
    } else {
      // 핵심 옵션 + 타협
      let keyMods = r.keyMods.map((m) => ({ text: m.text, min: m.min }));
      const premium = r.keyMods.filter((m) => m.premium && (m.usage ?? 0) < 0.9);
      if (compromise.enabled && premium.length) {
        const withAll = await search({ category: r.category, keyMods, rarity: 'nonunique' }, 1).catch(() => null);
        const nonPremium = keyMods.filter((m) => !premium.some((p) => p.text === m.text));
        const without = await search({ category: r.category, keyMods: nonPremium, rarity: 'nonunique' }, 1).catch(() => null);
        const pw = withAll?.results?.[0] ? toExalted(withAll.results[0].listing.price, rates) : null;
        const po = without?.results?.[0] ? toExalted(without.results[0].listing.price, rates) : null;
        if (po != null && (pw == null || (pw > po * compromise.ratio && pw - po > compromise.minDiffEx))) {
          keyMods = nonPremium;
          meta.notes.push(`타협: ${premium.map((p) => p.text).join(', ')} 제외 (${pw == null ? '매물 없음' : `최저 ${Math.round(pw)}ex vs ${Math.round(po)}ex, ${(pw / po).toFixed(1)}배`})`);
        }
      }
      meta.keyMods = keyMods;
      if (keyMods.length) meta.notes.push(`요구 옵션: ${keyMods.map((m) => m.text.replace('#', `${m.min}+`)).join(' / ')}`);

      const slotWithOffhand = { ...slot, offhand: r.offhand };
      const weights = slotWeights(slotStats(slotWithOffhand), needs, rollers);
      meta.weights = weights;
      const baseQ = { category: r.category, keyMods, rarity: 'nonunique' };
      if (Object.keys(weights).length) {
        // 가중치 합 = 대략 "쓸모 있는 옵션 줄 수". 등급별로 가장 싼 매물을 가져온다.
        for (const tier of depth > 1 ? [1.5, 2.5, 3.5] : [2]) queries.push({ q: { ...baseQ, weights, weightMin: tier, sort: 'price' }, limit: 10 });
        if (depth > 1) queries.push({ q: { ...baseQ, weights, sort: 'weight', maxPriceEx: budgetEx || undefined }, limit: 10 });
        if (depth > 1 && needs.es && slot.kind === 'armour') queries.push({ q: { ...baseQ, esMin: Math.round((needs.es / rollers.es) * 1.2), sort: 'price' }, limit: 10 });
        queries.push({ q: { ...baseQ, sort: 'price' }, limit: 5 }); // 아무 능력치 없는 최저가 (다른 슬롯이 채울 때)
      } else queries.push({ q: { ...baseQ, sort: 'price' }, limit: 5 });
    }

    slotInputs.push({ id: slot.id, pool: slot.pool === 'ring' ? 'ring' : undefined, candidates: [], weights: meta.weights, baseQ: r.mustHave || slot.kind === 'flask' || slot.kind === 'charm' ? null : { category: r.category, keyMods: meta.keyMods, rarity: 'nonunique' }, slotDef: { ...slot, offhand: r.offhand } });
    await collect(slotInputs[slotInputs.length - 1], queries, meta);
    if (r.mustHave && !slotInputs[slotInputs.length - 1].candidates.length) meta.notes.push(`필수 장비 ${r.mustHave.name} 매물을 찾지 못함`);
  }

  // 1차 최적화. 목표 미달이면 부족한 능력치만 집중 검색(가중치=해당 능력치, 높은 순)해서 후보를 보강 후 재시도
  onProgress({ step: 'optimize', done: total, total });
  let opt = optimize(slotInputs, needs, { budgetEx, maxSets: 3 });
  for (let round = 0; round < 2 && !opt.feasible && opt.reason !== 'no-candidates' && opt.reason !== 'over-budget'; round++) {
    const focus = opt.shortfall ? Object.keys(opt.shortfall) : opt.conflict ? Object.keys(opt.conflict) : Object.keys(needs);
    onProgress({ step: 'refine', stats: focus, round: round + 1 });
    for (const si of slotInputs) {
      if (!si.baseQ) continue;
      const rollable = slotStats(si.slotDef).filter((k) => focus.includes(k));
      for (const k of rollable) {
        const q = k === 'es' && si.slotDef.kind === 'armour' ? { ...si.baseQ, esMin: Math.round(needs.es / rollers.es) * (round + 1), sort: 'price' } : { ...si.baseQ, weights: { [k]: 1 }, weightMin: round ? Math.round((needs[k] / rollers[k]) * 1.3) : undefined, sort: round ? 'price' : 'weight' };
        await collect(si, [{ q, limit: 10 }], slotMeta[si.id]);
      }
    }
    opt = optimize(slotInputs, needs, { budgetEx, maxSets: 3 });
  }

  // 개선 라운드: 1차 결과에서 비싼 슬롯마다 "그 매물 이상 성능인데 더 싼" 매물을 추가로 찾아 재최적화.
  // (처음 검색은 가중치 기준이라 한두 능력치에 몰린 싼 매물을 놓칠 수 있음)
  const improveRounds = depth > 1 ? 2 : 1;
  for (let round = 0; round < improveRounds && opt.feasible; round++) {
    const before = opt.sets[0].totalEx;
    const picks = opt.sets[0].picks;
    const targetsToImprove = slotInputs
      .filter((si) => si.baseQ && picks[si.id] && picks[si.id].priceEx > 3 && si.weights && Object.keys(si.weights).length)
      .sort((a, b) => picks[b.id].priceEx - picks[a.id].priceEx)
      .slice(0, depth > 1 ? 5 : 3);
    if (!targetsToImprove.length) break;
    onProgress({ step: 'improve', round: round + 1, slots: targetsToImprove.map((si) => slotMeta[si.id].label) });
    for (const si of targetsToImprove) {
      const pick = picks[si.id];
      const contrib = Object.entries(si.weights).map(([k, w]) => [k, (pick.stats[k] || 0) * w]).sort((a, b) => b[1] - a[1]);
      const value = contrib.reduce((a, [, v]) => a + v, 0);
      const queries = [{ q: { ...si.baseQ, weights: si.weights, weightMin: Math.round(value * 0.85 * 100) / 100, sort: 'price' }, limit: 10 }];
      const [topStat] = contrib[0] || [];
      if (depth > 1 && topStat && pick.stats[topStat] > 0) queries.push({ q: { ...si.baseQ, weights: { [topStat]: 1 }, weightMin: Math.round(pick.stats[topStat] * 0.9), sort: 'price' }, limit: 10 });
      await collect(si, queries, slotMeta[si.id]);
    }
    opt = optimize(slotInputs, needs, { budgetEx, maxSets: 3 });
    if (!opt.feasible || opt.sets[0].totalEx >= before - 0.5) break;
  }
  const response = {
    ok: true,
    mode: trade.mode,
    league,
    profile: { id: profile.id, class: profile.class, skills: profile.skills, sampleSize: profile.sampleSize, source: profile.source, overlap: match.overlap },
    targets,
    needs,
    resBase: base,
    resSettings,
    budgetEx,
    notes,
    slotMeta,
    searches,
    feasible: opt.feasible,
    sets: [],
  };
  if (input.debug) response.debugSlots = slotInputs.map(({ id, pool, candidates }) => ({ id, pool, candidates: candidates.map(({ uid, priceEx, stats }) => ({ uid, priceEx, stats })) }));
  if (!opt.feasible) {
    response.reason = opt.reason;
    response.shortfall = opt.shortfall;
    response.conflict = opt.conflict;
    response.emptySlots = opt.emptySlots;
    return response;
  }
  response.sets = opt.sets.map((set, idx) => {
    const totals = emptyStats();
    const items = {};
    for (const slot of SLOTS) {
      const pick = set.picks[slot.id];
      if (!pick || pick.none) {
        items[slot.id] = null;
        continue;
      }
      for (const k of STAT_IDS) totals[k] += pick.stats[k] || 0;
      items[slot.id] = { ...summarizeListing(pick.result, pick.priceEx, pick.tradeUrl), stats: pick.stats };
    }
    const finalRes = {};
    for (const k of ['fireRes', 'coldRes', 'lightRes', 'chaosRes']) {
      const b = base[k] ?? (k === 'chaosRes' ? resSettings.chaosBase : resSettings.elementalPenalty + resSettings.campaignBonus) + (resSettings.other[k] || 0);
      finalRes[k] = { raw: b + totals[k], capped: Math.min(RES_MAX, b + totals[k]) };
    }
    return { rank: idx + 1, totalEx: Math.round(set.totalEx * 100) / 100, totals, finalRes, items };
  });
  return response;
}
