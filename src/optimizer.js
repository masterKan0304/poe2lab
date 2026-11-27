// 슬롯마다 후보 매물 하나씩 골라, 모든 목표 능력치를 만족하면서 총 가격이 최소인 세트를 찾는다.
// 다차원 배낭 문제라 정확해는 비싸므로 가지치기 + 빔 서치로 근사한다.
//
// slots: [{ id, pool?, candidates: [{ uid, priceEx, stats:{...} }] }]
// needs: { stat: 필요량 }  (0/없음 = 제약 없음)

const statKeys = (needs) => Object.keys(needs).filter((k) => needs[k] > 0);

/** 지배되는 후보 제거: 더 싸고 모든 필요 능력치가 같거나 높은 후보가 k개 이상이면 제거 */
export function pruneDominated(cands, keys, k = 1, cap = 40) {
  const sorted = [...cands].sort((a, b) => a.priceEx - b.priceEx);
  const kept = [];
  for (const c of sorted) {
    let dominatedBy = 0;
    for (const o of kept) {
      if (o.priceEx <= c.priceEx && keys.every((s) => (o.stats[s] || 0) >= (c.stats[s] || 0))) dominatedBy++;
      if (dominatedBy >= k) break;
    }
    if (dominatedBy < k) kept.push(c);
  }
  return kept.slice(0, cap);
}

export function maxAchievable(slots, keys) {
  const out = Object.fromEntries(keys.map((k) => [k, 0]));
  const poolUse = {};
  for (const slot of slots) {
    for (const k of keys) {
      // 공유 풀(반지 2개 등)은 서로 다른 매물이어야 하므로 n번째로 높은 값을 더함
      const vals = slot.candidates.map((c) => c.stats[k] || 0).sort((a, b) => b - a);
      const idx = slot.pool ? (poolUse[`${slot.pool}|${k}`] = (poolUse[`${slot.pool}|${k}`] ?? -1) + 1) : 0;
      out[k] += vals[idx] ?? 0;
    }
  }
  return out;
}

export function optimize(slots, needs, { beamWidth = 3000, maxSets = 3, budgetEx = null } = {}) {
  const keys = statKeys(needs);
  const empty = slots.filter((s) => s.candidates.length === 0).map((s) => s.id);
  if (empty.length) return { feasible: false, reason: 'no-candidates', emptySlots: empty, sets: [] };

  const prepared = slots.map((s) => {
    const k = s.pool ? slots.filter((o) => o.pool === s.pool).length : 1;
    return { ...s, candidates: pruneDominated(s.candidates, keys, k) };
  });

  const best = maxAchievable(prepared, keys);
  const short = keys.filter((k) => best[k] + 1e-9 < needs[k]);
  if (short.length) {
    return { feasible: false, reason: 'targets-unreachable', shortfall: Object.fromEntries(short.map((k) => [k, { need: needs[k], maxPossible: Math.floor(best[k]) }])), sets: [] };
  }

  // 순서: 후보가 1개(고정)인 슬롯 먼저, 그 다음 능력치 기여 편차가 큰 슬롯
  const spread = (s) => keys.reduce((a, k) => a + (Math.max(...s.candidates.map((c) => c.stats[k] || 0)) / needs[k]), 0);
  const order = prepared.map((s, i) => i).sort((a, b) => (prepared[a].candidates.length === 1 ? -1 : 0) - (prepared[b].candidates.length === 1 ? -1 : 0) || spread(prepared[b]) - spread(prepared[a]));
  const ordered = order.map((i) => prepared[i]);

  // 남은 슬롯에서 얻을 수 있는 최대치 (가지치기용, 낙관적)
  const maxRem = Array.from({ length: ordered.length + 1 }, () => Object.fromEntries(keys.map((k) => [k, 0])));
  for (let i = ordered.length - 1; i >= 0; i--) {
    for (const k of keys) maxRem[i][k] = maxRem[i + 1][k] + Math.max(0, ...ordered[i].candidates.map((c) => c.stats[k] || 0));
  }
  const minRemCost = Array(ordered.length + 1).fill(0);
  for (let i = ordered.length - 1; i >= 0; i--) minRemCost[i] = minRemCost[i + 1] + Math.min(...ordered[i].candidates.map((c) => c.priceEx));

  // K = "목표치 100% 만큼의 능력치" 를 사는 데 드는 대략적 비용 (부족분 페널티 환산용)
  const ratios = [];
  for (const s of ordered) for (const c of s.candidates) {
    const v = keys.reduce((a, k) => a + (c.stats[k] || 0) / needs[k], 0);
    if (v > 0.01) ratios.push(c.priceEx / v);
  }
  ratios.sort((a, b) => a - b);
  const K = ratios.length ? ratios[Math.floor(ratios.length / 2)] : 1;

  const deficitScore = (acc) => keys.reduce((a, k) => a + Math.max(0, needs[k] - acc[k]) / needs[k], 0);

  let beam = [{ cost: 0, acc: Object.fromEntries(keys.map((k) => [k, 0])), picks: [], used: new Set() }];
  for (let i = 0; i < ordered.length; i++) {
    const slot = ordered[i];
    const next = [];
    for (const st of beam) {
      for (const c of slot.candidates) {
        if (st.used.has(c.uid)) continue;
        const cost = st.cost + c.priceEx;
        if (budgetEx != null && cost + minRemCost[i + 1] > budgetEx) continue;
        const acc = { ...st.acc };
        let ok = true;
        for (const k of keys) {
          acc[k] += c.stats[k] || 0;
          if (acc[k] + maxRem[i + 1][k] + 1e-9 < needs[k]) { ok = false; break; }
        }
        if (!ok) continue;
        next.push({ cost, acc, picks: [...st.picks, c], used: c.uid ? new Set([...st.used, c.uid]) : st.used, rank: cost + K * deficitScore(acc) });
      }
    }
    if (!next.length) break;
    next.sort((a, b) => a.rank - b.rank);
    // 동일 조합 중복 제거 + 빔 폭 제한
    const seen = new Set();
    beam = [];
    for (const st of next) {
      const sig = st.picks.map((p) => p.uid).sort().join(',');
      if (seen.has(sig)) continue;
      seen.add(sig);
      beam.push(st);
      if (beam.length >= beamWidth) break;
    }
    if (i === ordered.length - 1) beam = beam.filter((st) => st.picks.length === ordered.length);
  }

  const done = beam.filter((st) => st.picks.length === ordered.length && keys.every((k) => st.acc[k] + 1e-9 >= needs[k])).sort((a, b) => a.cost - b.cost);
  if (!done.length) {
    return { feasible: false, reason: budgetEx != null ? 'over-budget' : 'search-failed', budgetEx, sets: [] };
  }

  // 서로 2개 이상 슬롯이 다른 세트를 우선 골라 선택지를 다양하게
  const sets = [];
  for (const minDiff of [2, 1]) {
    for (const st of done) {
      if (sets.length >= maxSets) break;
      if (sets.includes(st)) continue;
      const diffOk = sets.every((o) => st.picks.filter((p, j) => p.uid !== o.picks[j].uid).length >= minDiff);
      if (diffOk) sets.push(st);
    }
  }
  sets.sort((a, b) => a.cost - b.cost);
  return {
    feasible: true,
    sets: sets.map((st) => ({
      totalEx: st.cost,
      totals: st.acc,
      picks: Object.fromEntries(st.picks.map((p, j) => [ordered[j].id, p])),
    })),
  };
}
