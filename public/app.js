const $ = (s, el = document) => el.querySelector(s);
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
};
const fmt = (n) => (Math.round(n * 10) / 10).toLocaleString('ko-KR');
function toast(msg) {
  const t = h('div', { class: 'toast' }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 2600);
}

let META = null;
let RESULT = null;
let activeSet = 0;

const STAT_UI = [
  { id: 'life', label: '생명력' },
  { id: 'es', label: '에너지 보호막' },
  { id: 'ward', label: '룬 수호' },
  { id: 'mana', label: '마나' },
  { id: 'eleRes', label: '원소 저항 (화/냉/번 각각, 최대 75)', max: 75 },
  { id: 'chaosRes', label: '카오스 저항 (최대 75)', max: 75 },
  { id: 'moveSpeed', label: '이동 속도 %' },
];

async function init() {
  META = await fetch('/api/meta').then((r) => r.json());
  $('#league').append(...META.leagues.map((l) => h('option', { value: l }, l)));
  $('#mode').value = META.defaultMode;
  updateBadge();
  $('#mode').addEventListener('change', updateBadge);
  refreshProfileLists();
  $('#targets').append(...STAT_UI.map((s) => h('label', {}, s.label, h('input', { type: 'number', min: 0, max: s.max, name: `t_${s.id}`, placeholder: '자동' }))));
  $('#className').addEventListener('change', suggestSkills);
  $('#form').addEventListener('input', updateResHint);
  $('#form').addEventListener('submit', run);
  $('#profileFile').addEventListener('change', uploadProfile);
  updateResHint();
}

function updateBadge() {
  const mode = $('#mode').value;
  const b = $('#modeBadge');
  b.textContent = mode === 'mock' ? '데모 데이터 — 실제 매물 아님' : `실시간 trade2 · 은신처 이동 ${META.canTeleport.live ? 'ON' : 'OFF (POESESSID 없음)'}`;
  b.className = `badge ${mode}`;
}

function refreshProfileLists() {
  const classes = [...new Set(META.profiles.map((p) => p.class))];
  $('#classList').replaceChildren(...classes.map((c) => h('option', { value: c })));
  const skills = [...new Set(META.profiles.flatMap((p) => p.skills))];
  $('#skillList').replaceChildren(...skills.map((s) => h('option', { value: s })));
}

function suggestSkills() {
  const p = META.profiles.find((x) => x.class.toLowerCase() === $('#className').value.trim().toLowerCase());
  if (!p) return;
  const f = $('#form');
  p.skills.forEach((s, i) => { if (!f[`skill${i}`].value) f[`skill${i}`].value = s; });
}

function updateResHint() {
  const f = $('#form');
  const pen = Number(f.elementalPenalty.value || 0) + Number(f.campaignBonus.value || 0);
  const target = Math.min(75, Number(f.t_eleRes?.value || 75));
  $('#resHint').textContent = `기본 원소 저항 ${pen}% → ${target}% 를 맞추려면 장비(+트리)에서 각 ${target - pen}% 필요`;
}

function readForm() {
  const f = $('#form');
  const num = (n) => (f[n].value === '' ? undefined : Number(f[n].value));
  const ele = num('t_eleRes');
  return {
    mode: f.mode.value,
    league: f.league.value,
    status: f.status.value,
    className: f.className.value.trim(),
    skills: [f.skill0.value, f.skill1.value, f.skill2.value].map((s) => s.trim()).filter(Boolean),
    autoTargets: f.autoTargets.checked,
    targets: { life: num('t_life'), es: num('t_es'), ward: num('t_ward'), mana: num('t_mana'), fireRes: ele, coldRes: ele, lightRes: ele, chaosRes: num('t_chaosRes'), moveSpeed: num('t_moveSpeed') },
    resSettings: {
      elementalPenalty: Number(f.elementalPenalty.value || 0),
      campaignBonus: Number(f.campaignBonus.value || 0),
      other: { fireRes: Number(f.otherFire.value || 0), coldRes: Number(f.otherCold.value || 0), lightRes: Number(f.otherLight.value || 0), chaosRes: Number(f.otherChaos.value || 0) },
    },
    budgetEx: num('budgetEx'),
    compromise: { enabled: f.compromise.checked, ratio: Number(f.ratio.value || 3) },
    depth: f.depth.value,
  };
}

async function run(ev) {
  ev.preventDefault();
  const input = readForm();
  const out = $('#out');
  const label = h('div', {}, '준비 중…');
  const bar = h('i', { style: 'width:0%' });
  out.replaceChildren(h('div', { class: 'progress' }, label, h('div', { class: 'bar' }, bar)));
  $('#go').disabled = true;
  try {
    const res = await fetch('/api/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        const msg = JSON.parse(line);
        if (msg.type === 'progress') {
          if (msg.step === 'search') label.textContent = `매물 검색 중: ${msg.label} (${msg.done + 1}/${msg.total})`;
          else if (msg.step === 'optimize') label.textContent = '세트 조합 최적화 중…';
          else if (msg.step === 'refine') label.textContent = `목표 미달 능력치 보강 검색 (${msg.round}차): ${msg.stats.join(', ')}`;
          else if (msg.step === 'rates') label.textContent = msg.fallback ? '환율 조회 실패 — 기본 환율 사용' : '환율 조회 완료';
          if (msg.total) bar.style.width = `${Math.round((msg.done / msg.total) * 100)}%`;
        } else if (msg.type === 'result') {
          RESULT = msg.result;
          activeSet = 0;
          render();
        } else if (msg.type === 'error') {
          out.replaceChildren(h('div', { class: 'fail' }, h('b', {}, '오류: '), msg.message));
        }
      }
    }
  } catch (err) {
    out.replaceChildren(h('div', { class: 'fail' }, `요청 실패: ${err.message}`));
  } finally {
    $('#go').disabled = false;
  }
}

const STAT_LABEL = Object.fromEntries([...(META?.stats || []), { id: 'life', label: '생명력' }, { id: 'es', label: '에너지 보호막' }, { id: 'ward', label: '룬 수호' }, { id: 'mana', label: '마나' }, { id: 'fireRes', label: '화염 저항' }, { id: 'coldRes', label: '냉기 저항' }, { id: 'lightRes', label: '번개 저항' }, { id: 'chaosRes', label: '카오스 저항' }, { id: 'moveSpeed', label: '이동 속도' }].map((s) => [s.id, s.label]));

function render() {
  const r = RESULT;
  const out = $('#out');
  if (!r.ok) return out.replaceChildren(h('div', { class: 'fail' }, r.error));
  const p = r.profile;
  const head = h('div', { class: 'summary' },
    h('div', { class: 'profile' }, `빌드 프로필: ${p.class} · ${p.skills.join(' / ')} (${p.source === 'sample' ? '샘플' : '업로드'} · 표본 ${p.sampleSize ?? '?'}명 · 스킬 ${p.overlap}개 일치) · ${r.mode === 'mock' ? '데모 매물' : '실시간 매물'} · 검색 ${r.searches}회`),
    r.notes.length ? h('div', { class: 'notes-global' }, r.notes.join(' · ')) : null,
    r.ratesFallback ? h('div', { class: 'notes-global' }, '※ poe.ninja 환율 조회 실패 — 기본 환율로 계산') : null);

  if (!r.feasible) {
    const items = [];
    if (r.reason === 'targets-unreachable') for (const [k, v] of Object.entries(r.shortfall)) items.push(h('li', {}, `${STAT_LABEL[k]}: 장비에서 ${fmt(v.need)} 필요 / 찾은 매물로 최대 ${fmt(v.maxPossible)}`));
    if (r.reason === 'no-candidates') items.push(h('li', {}, `매물을 하나도 못 찾은 슬롯: ${r.emptySlots.map((s) => r.slotMeta[s]?.label || s).join(', ')}`));
    if (r.reason === 'over-budget') items.push(h('li', {}, '예산 안에서 목표를 모두 만족하는 조합이 없습니다.'));
    if (r.reason === 'search-failed') items.push(h('li', {}, '조합 탐색에 실패했습니다. 목표치를 조금 낮춰보세요.'));
    return out.replaceChildren(head, h('div', { class: 'fail' }, h('b', {}, '조건을 만족하는 장비 세트가 없습니다'), h('ul', {}, items)));
  }

  const set = r.sets[activeSet];
  const tabs = h('div', { class: 'tabs' }, r.sets.map((s, i) => h('button', { type: 'button', class: i === activeSet ? 'active' : '', onclick: () => { activeSet = i; render(); } }, `선택지 ${i + 1} · ${fmt(s.totalEx)} ex${r.divineEx ? ` (≈${fmt(s.totalEx / r.divineEx)} div)` : ''}`)));

  const statCards = [];
  for (const k of ['life', 'es', 'ward', 'mana', 'moveSpeed']) {
    const need = r.needs[k];
    if (!need && !set.totals[k]) continue;
    statCards.push(h('div', { class: `stat ${need ? (set.totals[k] >= need ? 'ok' : 'bad') : ''}` }, STAT_LABEL[k], h('b', {}, fmt(set.totals[k])), need ? h('small', {}, `목표 ${fmt(need)}`) : null));
  }
  for (const k of ['fireRes', 'coldRes', 'lightRes', 'chaosRes']) {
    const fr = set.finalRes[k];
    const tgt = r.targets[k];
    statCards.push(h('div', { class: `stat ${tgt ? (fr.raw >= tgt ? 'ok' : 'bad') : ''}` }, STAT_LABEL[k], h('b', {}, `${fmt(fr.capped)}%`), h('small', {}, `장비 +${fmt(set.totals[k])} · 초과 ${fmt(fr.raw)}%${tgt ? ` · 목표 ${tgt}%` : ''}`)));
  }

  const slots = h('div', { class: 'slots' }, META.slots.map((s) => slotCard(s, set.items[s.id], r)));
  out.replaceChildren(head, tabs, h('div', { class: 'summary' }, h('div', { class: 'stats' }, statCards)), slots);
}

function slotCard(slot, item, r) {
  const el = $('#slotTpl').content.firstElementChild.cloneNode(true);
  const meta = r.slotMeta[slot.id] || { notes: [] };
  $('.slotname', el).textContent = slot.label;
  $('.notes', el).textContent = meta.notes.join(' · ');
  if (!item) {
    el.classList.add('none');
    $('.itemname', el).textContent = '—';
    return el;
  }
  const cur = item.price.currency === 'exalted' ? 'ex' : item.price.currency;
  $('.price', el).textContent = `${item.price.amount} ${cur}${item.price.currency !== 'exalted' ? ` (≈${fmt(item.priceEx)} ex)` : ''}`;
  const nm = $('.itemname', el);
  nm.textContent = item.name;
  nm.classList.add(item.rarity || '');
  const mods = $('.mods', el);
  for (const p of item.properties.filter((p) => /Energy Shield|Armour|Evasion|Runic Ward/i.test(p.name))) mods.append(h('li', { class: 'prop' }, `${p.name}: ${p.value}`));
  for (const m of item.mods) mods.append(h('li', { class: m.kind }, m.text));
  $('.seller', el).textContent = `판매자 ${item.seller || '?'}${item.character ? ` (${item.character})` : ''}`;
  const actions = $('.actions', el);
  if (item.hideoutToken) actions.append(h('button', { type: 'button', class: 'tp', onclick: () => teleport(item, r.mode) }, '은신처 순간이동'));
  if (item.whisper) actions.append(h('button', { type: 'button', onclick: () => navigator.clipboard.writeText(item.whisper).then(() => toast('귓속말 복사됨'), () => toast(item.whisper)) }, '귓속말 복사'));
  if (item.tradeUrl) actions.append(h('a', { href: item.tradeUrl, target: '_blank', rel: 'noopener' }, '거래소에서 보기'));
  return el;
}

async function teleport(item, mode) {
  if (mode === 'live' && !META.canTeleport.live) return toast('.env 에 POESESSID 를 설정해야 순간이동이 가능합니다');
  const res = await fetch('/api/hideout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: item.hideoutToken, mode }) }).then((r) => r.json());
  toast(res.ok ? (res.result?.mock ? `(데모) ${item.seller} 은신처로 이동 요청됨` : `${item.seller} 은신처로 이동 요청됨 — 게임을 확인하세요`) : `실패: ${res.error}`);
}

async function uploadProfile(ev) {
  const file = ev.target.files[0];
  if (!file) return;
  try {
    const json = JSON.parse(await file.text());
    const res = await fetch('/api/profiles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(json) }).then((r) => r.json());
    const bad = res.results.filter((x) => x.errors.length);
    toast(bad.length ? `일부 실패: ${bad.map((b) => `${b.id}: ${b.errors.join(', ')}`).join(' / ')}` : `프로필 ${res.results.length}개 추가됨`);
    META = await fetch('/api/meta').then((r) => r.json());
    refreshProfileLists();
  } catch (err) {
    toast(`JSON 읽기 실패: ${err.message}`);
  }
}

init();
