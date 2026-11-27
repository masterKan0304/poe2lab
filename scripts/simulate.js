// "최적 장비 세트 찾기"가 되는지 점검하는 시뮬레이션
//   npm run simulate              # 1) 실서버 연결 진단  2) 데모 매물로 전 직업 x 목표치 조합 실행
//   npm run simulate -- --live    # 3) 실제 trade2 로 1회 전체 검색까지 (1~5분)
import { performance } from 'node:perf_hooks';
import { config } from '../src/config.js';
import { loadProfiles } from '../src/builds/profiles.js';
import { mockForProfiles } from '../src/trade/mock.js';
import { LiveTradeClient } from '../src/trade/live.js';
import { getExaltedRates, getLeagues } from '../src/ninja/currency.js';
import { planGear } from '../src/planner.js';
import { I18N } from '../src/i18n.js';

const args = process.argv.slice(2);
const profiles = loadProfiles();
const pad = (s, n) => String(s).padEnd(n);
const line = (n = 78) => console.log('-'.repeat(n));

async function diagnose() {
  console.log('\n[1] 연결 진단');
  line();
  console.log(`User-Agent: ${config.userAgent}${config.userAgent.includes('contact') ? '' : '   ← .env 의 POE2LAB_CONTACT 를 채우는 걸 권장'}`);
  console.log(`POESESSID: ${config.poesessid ? '설정됨 (은신처 이동 가능)' : '없음 (은신처 이동 불가, 검색은 가능)'}`);
  const leagues = await getLeagues();
  console.log(`poe.ninja 리그: ${leagues.join(', ')}`);
  const league = args.find((a) => a.startsWith('--league='))?.slice(9) || leagues.find((l) => !/HC|Hardcore|Standard/.test(l)) || 'Standard';
  const rates = await getExaltedRates(league);
  console.log(rates._fallback ? `✗ poe.ninja 환율 실패 (${rates._fallback}) → 기본 환율 사용` : `✓ poe.ninja 환율 (${league}): 1 divine ≈ ${rates.divine.toFixed(1)} ex`);

  const live = new LiveTradeClient();
  let tradeOk = false;
  try {
    const idx = await live.getStatIndex();
    console.log(`✓ trade2 스탯 목록 수신 (${idx.byKey.size}개)`);
    const missing = ['life', 'fireRes', 'coldRes', 'lightRes', 'chaosRes', 'moveSpeed', 'es', 'mana'].filter((k) => !idx.statId(k));
    console.log(missing.length ? `✗ 스탯 id 를 못 찾음: ${missing.join(', ')} (npm run verify 로 상세 확인)` : '✓ 주요 능력치 스탯 id 모두 매칭');
    const r = await live.searchListings(league, { category: 'accessory.ring', weights: { life: 1 }, sort: 'price', status: 'securable' }, { limit: 2 });
    console.log(`✓ trade2 검색/조회 성공: 반지 매물 ${r.total}건, 예) ${r.results[0]?.listing?.price?.amount} ${r.results[0]?.listing?.price?.currency}`);
    tradeOk = true;
  } catch (err) {
    console.log(`✗ trade2 실패: ${err.message}`);
    if (err.status === 403) console.log('   → 클라우드/VPN IP 는 GGG 가 차단합니다. 집 PC 에서 실행하고, VPN 을 끄고, POE2LAB_CONTACT 를 채워보세요.');
    else if (err.status === 429) console.log('   → 레이트 리밋. 몇 분 뒤 다시 시도하세요 (브라우저에서 거래소를 같이 쓰면 더 빨리 걸립니다).');
    else if (err.status === 400 || err.status === 404) console.log(`   → 리그 이름(${league})이나 쿼리 형식 문제. --league="리그명" 으로 바꿔보세요.`);
    else console.log('   → 네트워크 문제 (방화벽/프록시/인터넷 연결 확인).');
  }
  return { league, rates, tradeOk, live };
}

async function mockMatrix(rates) {
  console.log('\n[2] 데모 매물 시뮬레이션 (전 직업 x 목표치)');
  line();
  const trade = mockForProfiles(profiles);
  const levels = {
    '낮음': { life: 600, fireRes: 75, coldRes: 75, lightRes: 75 },
    '보통': { life: 1100, fireRes: 75, coldRes: 75, lightRes: 75, chaosRes: 20, moveSpeed: 25 },
    '높음': { life: 1400, fireRes: 75, coldRes: 75, lightRes: 75, chaosRes: 40, moveSpeed: 30 },
    '과함': { life: 6000, fireRes: 75, coldRes: 75, lightRes: 75, chaosRes: 75 },
  };
  const classes = I18N.classes.length ? I18N.classes : [...new Set(profiles.map((p) => ({ en: p.class, ko: p.class })))];
  console.log(`${pad('전직', 22)}${pad('프로필', 10)}${Object.keys(levels).map((l) => pad(l, 16)).join('')}`);
  const tally = { ok: 0, fail: 0, expectedFail: 0, tooHigh: 0 };
  for (const c of classes) {
    const p = profiles.find((x) => x.class === c.en);
    const cells = [];
    let kind = '';
    for (const [lvl, targets] of Object.entries(levels)) {
      const t0 = performance.now();
      const r = await planGear({ league: 'Sim', className: c.ko, skills: p ? p.skills.slice(0, 3) : [], targets }, { trade, profiles, rates });
      const ms = Math.round(performance.now() - t0);
      kind = r.profile?.source === 'generic' ? '일반' : r.profile ? '샘플' : '-';
      if (r.feasible) { cells.push(`${Math.round(r.sets[0].totalEx)}ex`); lvl === '과함' ? tally.fail++ : tally.ok++; }
      else {
        cells.push(r.reason === 'targets-conflict' ? `동시불가(${Object.keys(r.conflict).join(',')})`.slice(0, 22) : r.reason === 'targets-unreachable' ? `없음(${Object.entries(r.shortfall).map(([k, v]) => `${k}≤${v.maxPossible}`).join(',')})`.slice(0, 22) : r.reason || r.error?.slice(0, 8));
        if (lvl === '과함') tally.expectedFail++;
        else if (r.reason === 'targets-conflict' || r.reason === 'targets-unreachable') tally.tooHigh++;
        else tally.fail++;
      }
      if (ms > 5000) cells[cells.length - 1] += `(${ms}ms)`;
    }
    console.log(`${pad(`${c.ko}`, 22)}${pad(kind, 10)}${cells.map((x) => pad(x, 16)).join('')}`);
  }
  line();
  console.log(`세트 추천 ${tally.ok}건 · 목표가 매물 한계를 넘어 '결과 없음'(이유 안내) ${tally.tooHigh + tally.expectedFail}건 · 오류 ${tally.fail}건`);
  return tally;
}

async function livePlan(diag) {
  console.log('\n[3] 실제 trade2 로 1회 전체 검색 (Deadeye, 보통 목표)');
  line();
  const t0 = performance.now();
  const r = await planGear(
    { league: diag.league, className: '데드아이', skills: ['번개 화살'], targets: { life: 1000, fireRes: 75, coldRes: 75, lightRes: 75 }, depth: 'quick' },
    { trade: diag.live, profiles, rates: diag.rates, onProgress: (p) => p.step === 'search' && process.stdout.write(`\r검색 중: ${p.label} (${p.done + 1}/${p.total})      `) },
  );
  console.log(`\n소요 ${Math.round((performance.now() - t0) / 1000)}초, 검색 ${r.searches}회`);
  if (r.feasible) {
    const s = r.sets[0];
    console.log(`✓ 세트 ${r.sets.length}개. 1번: ${Math.round(s.totalEx)} ex`);
    for (const [slot, it] of Object.entries(s.items)) if (it) console.log(`   ${pad(r.slotMeta[slot].label, 14)} ${pad(it.name, 36)} ${it.price.amount} ${it.price.currency}  ${it.seller}`);
  } else console.log(`✗ 결과 없음: ${r.reason || r.error} ${JSON.stringify(r.shortfall || r.emptySlots || '')}`);
  for (const [slot, m] of Object.entries(r.slotMeta || {})) if (m.notes.some((n) => /실패|못 찾은/.test(n))) console.log(`   ! ${m.label}: ${m.notes.join(' | ')}`);
}

const diag = await diagnose();
const tally = await mockMatrix(diag.rates);
if (args.includes('--live')) {
  if (diag.tradeOk) await livePlan(diag);
  else console.log('\n[3] trade2 연결 실패로 실서버 전체 검색은 건너뜀');
} else console.log('\n실서버 전체 검색까지 해보려면: npm run simulate -- --live');
process.exit(tally.fail ? 1 : 0);
