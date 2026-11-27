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
  mergeLocalProfiles();
  $('#league').append(...META.leagues.map((l) => h('option', { value: l }, l)));
  $('#mode').value = META.defaultMode;
  updateBadge();
  $('#mode').addEventListener('change', updateBadge);
  refreshProfileLists();
  setupCombos();
  $('#league').addEventListener('change', loadRates);
  loadRates();
  $('#targets').append(...STAT_UI.map((s) => h('label', {}, s.label, h('input', { type: 'number', min: 0, max: s.max, name: `t_${s.id}`, placeholder: '자동' }))));
  $('#form').addEventListener('input', updateResHint);
  $('#form').addEventListener('input', updateBudgetHint);
  $('#form').addEventListener('submit', run);
  $('#profileFile').addEventListener('change', uploadProfile);
  updateResHint();
}

function updateBadge() {
  const mode = $('#mode').value;
  const b = $('#modeBadge');
  b.textContent = mode === 'mock' ? '데모 데이터 — 실제 매물 아님' : META.hosted ? '실시간 trade2 — 호스팅 서버에서는 차단될 수 있음' : `실시간 trade2 · 은신처 이동 ${META.canTeleport.live ? 'ON' : 'OFF (POESESSID 없음)'}`;
  b.className = `badge ${mode}`;
}

// ---------- 한글/영문 이름 ----------
let KO = { cls: new Map(), skill: new Map() };
function refreshProfileLists() {
  KO = { cls: new Map(META.i18n.classes.map((c) => [c.en, c])), skill: new Map(META.i18n.skills.map((s) => [s.en, s])) };
  // 프로필에는 있는데 번역 목록에 없는 이름도 후보에 포함
  for (const p of META.profiles) {
    if (!KO.cls.has(p.class)) KO.cls.set(p.class, { en: p.class, ko: p.class, base: '', baseKo: '' });
    for (const sk of p.skills) if (!KO.skill.has(sk)) KO.skill.set(sk, { en: sk, ko: sk });
  }
}
const koClass = (en) => KO.cls.get(en)?.ko || en;
const koSkill = (en) => KO.skill.get(en)?.ko || en;

// ---------- 초성 검색 ----------
const CHO = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const chosung = (s) => [...s].map((ch) => { const c = ch.charCodeAt(0) - 0xac00; return c >= 0 && c < 11172 ? CHO[Math.floor(c / 588)] : ch; }).join('');
const squash = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();
const isChoQuery = (q) => /^[ㄱ-ㅎ]+$/.test(q);

/** 검색어와 항목의 일치 점수 (낮을수록 우선, -1 = 불일치) */
function matchScore(item, q) {
  if (!q) return 0;
  const ko = squash(item.ko), en = squash(item.en);
  if (isChoQuery(q)) { const i = chosung(ko).indexOf(q); return i < 0 ? -1 : i === 0 ? 1 : 3; }
  for (const [txt, base] of [[ko, 0], [en, 0]]) { const i = txt.indexOf(q); if (i === 0) return base; if (i > 0) return base + 2; }
  return -1;
}

function highlight(text, q) {
  if (!q || isChoQuery(q)) return [text];
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) return [text];
  return [text.slice(0, i), h('mark', {}, text.slice(i, i + q.length)), text.slice(i + q.length)];
}

function combobox(input, getItems, { onPick } = {}) {
  const list = h('ul', { role: 'listbox', hidden: true });
  input.after(list);
  // 선택된 항목 아이콘 (입력칸 왼쪽)
  const sel = h('img', { class: 'sel-icon', alt: '', hidden: true });
  input.before(sel);
  const showIcon = (src) => { sel.hidden = !src; if (src) sel.src = src; input.classList.toggle('has-icon', !!src); };
  input.setIcon = showIcon;
  input.setAttribute('role', 'combobox');
  let items = [];
  let active = -1;
  const close = () => { list.hidden = true; active = -1; };
  const pick = (it) => { input.value = it.ko; input.dataset.en = it.en; showIcon(it.icon); close(); onPick?.(it); input.dispatchEvent(new Event('input', { bubbles: true })); };
  const render = () => {
    const q = squash(input.value);
    items = getItems()
      .map((it) => ({ it, s: matchScore(it, q) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => (b.it.featured ? 1 : 0) - (a.it.featured ? 1 : 0) || a.s - b.s || a.it.ko.localeCompare(b.it.ko, 'ko'))
      .slice(0, 40).map((x) => x.it);
    active = items.length ? 0 : -1;
    list.replaceChildren(...(items.length ? items.map((it, i) => h('li', { role: 'option', class: i === active ? 'active' : '', onmousedown: (e) => { e.preventDefault(); pick(it); } },
      h('span', { class: 'opt' }, it.icon ? h('img', { src: it.icon, alt: '', loading: 'lazy' }) : h('i', { class: 'noicon' }), h('span', {}, ...highlight(it.ko, input.value.trim().toLowerCase())), it.featured ? h('span', { class: 'tag' }, it.featured) : null),
      h('small', {}, it.sub || it.en))) : [h('li', { class: 'empty' }, '일치하는 항목 없음 (그대로 검색 가능)')]));
    list.hidden = false;
  };
  const move = (d) => {
    if (!items.length) return;
    active = (active + d + items.length) % items.length;
    [...list.children].forEach((li, i) => li.classList.toggle('active', i === active));
    list.children[active]?.scrollIntoView({ block: 'nearest' });
  };
  input.addEventListener('input', (e) => { if (e.isTrusted) { delete input.dataset.en; showIcon(null); } render(); });
  input.addEventListener('focus', render);
  input.addEventListener('blur', () => setTimeout(close, 100));
  input.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); list.hidden ? render() : move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter' && !list.hidden && active >= 0) { e.preventDefault(); pick(items[active]); }
    else if (e.key === 'Escape') close();
  });
}

function selectedClassEn() {
  const inp = $('#form').className;
  return inp.dataset.en || [...KO.cls.values()].find((c) => squash(c.ko) === squash(inp.value) || squash(c.en) === squash(inp.value))?.en || inp.value.trim();
}

function setupCombos() {
  const f = $('#form');
  const withProfile = new Set(META.profiles.map((p) => p.class));
  combobox(f.className, () => [...KO.cls.values()].map((c) => ({ ...c, sub: `${c.en}${c.baseKo ? ` · ${c.baseKo}` : ''}`, featured: withProfile.has(c.en) ? '샘플 빌드' : null })), {
    onPick: (c) => {
      // 그 직업의 샘플 빌드 스킬로 빈 칸 채우기
      const p = META.profiles.find((x) => x.class === c.en);
      if (!p) return;
      p.skills.forEach((en, i) => { const inp = f[`skill${i}`]; if (inp && !inp.value) { inp.value = koSkill(en); inp.dataset.en = en; inp.setIcon?.(KO.skill.get(en)?.icon); } });
    },
  });
  for (const i of [0, 1, 2]) {
    combobox(f[`skill${i}`], () => {
      const cls = selectedClassEn();
      const used = new Set(META.profiles.filter((p) => p.class === cls).flatMap((p) => p.skills));
      const taken = new Set([0, 1, 2].filter((j) => j !== i).map((j) => f[`skill${j}`].dataset.en).filter(Boolean));
      return [...KO.skill.values()].filter((s) => !taken.has(s.en)).map((s) => ({ ...s, featured: used.has(s.en) ? '샘플 빌드' : null }));
    });
  }
}

// ---------- 환율 / 예산 ----------
let DIVINE = null;
async function loadRates() {
  try {
    const r = await fetch(`/api/rates?league=${encodeURIComponent($('#league').value)}`).then((x) => x.json());
    DIVINE = r.divine;
  } catch { DIVINE = null; }
  updateBudgetHint();
}
function updateBudgetHint() {
  const f = $('#form');
  const ex = Number(f.budgetEx.value || 0), div = Number(f.budgetDiv.value || 0);
  const rate = DIVINE ? `1 div ≈ ${fmt(DIVINE)} ex` : '환율 조회 중';
  $('#budgetHint').textContent = ex || div ? `총 ≈ ${fmt(ex + div * (DIVINE || 0))} ex (${rate})` : `무제한 · ${rate}`;
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
    profiles: localProfiles(),
    league: f.league.value,
    status: f.status.value,
    className: f.className.dataset.en || f.className.value.trim(),
    skills: [f.skill0, f.skill1, f.skill2].map((el) => el.dataset.en || el.value.trim()).filter(Boolean),
    autoTargets: f.autoTargets.checked,
    targets: { life: num('t_life'), es: num('t_es'), ward: num('t_ward'), mana: num('t_mana'), fireRes: ele, coldRes: ele, lightRes: ele, chaosRes: num('t_chaosRes'), moveSpeed: num('t_moveSpeed') },
    resSettings: {
      elementalPenalty: Number(f.elementalPenalty.value || 0),
      campaignBonus: Number(f.campaignBonus.value || 0),
      other: { fireRes: Number(f.otherFire.value || 0), coldRes: Number(f.otherCold.value || 0), lightRes: Number(f.otherLight.value || 0), chaosRes: Number(f.otherChaos.value || 0) },
    },
    budget: { ex: num('budgetEx'), div: num('budgetDiv') },
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
          else if (msg.step === 'improve') label.textContent = `더 싼 대안 탐색 (${msg.round}차): ${msg.slots.join(', ')}`;
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
    h('div', { class: 'build-icons' }, [KO.cls.get(p.class)?.icon, ...p.skills.map((sk) => KO.skill.get(sk)?.icon)].filter(Boolean).map((src) => h('img', { src, alt: '' }))),
    h('div', { class: 'profile' }, `빌드 프로필: ${koClass(p.class)} · ${p.skills.map(koSkill).join(' / ') || '-'} (${{ sample: '샘플', user: '업로드', generic: '일반 프로필' }[p.source] || p.source}${p.source === 'generic' ? '' : ` · 표본 ${p.sampleSize ?? '?'}명 · 스킬 ${p.overlap}개 일치`})${r.budgetEx ? ` · 예산 ${fmt(r.budgetEx)} ex` : ''} · ${r.mode === 'mock' ? '데모 매물' : '실시간 매물'} · 검색 ${r.searches}회`),
    r.notes.length ? h('div', { class: 'notes-global' }, r.notes.join(' · ')) : null,
    r.ratesFallback ? h('div', { class: 'notes-global' }, '※ poe.ninja 환율 조회 실패 — 기본 환율로 계산') : null);

  if (!r.feasible) {
    const items = [];
    if (r.reason === 'targets-unreachable') for (const [k, v] of Object.entries(r.shortfall)) items.push(h('li', {}, `${STAT_LABEL[k]}: 장비에서 ${fmt(v.need)} 필요 / 찾은 매물로 최대 ${fmt(v.maxPossible)}`));
    if (r.reason === 'no-candidates') items.push(h('li', {}, `매물을 하나도 못 찾은 슬롯: ${r.emptySlots.map((s) => r.slotMeta[s]?.label || s).join(', ')}`));
    if (r.reason === 'over-budget') items.push(h('li', {}, '예산 안에서 목표를 모두 만족하는 조합이 없습니다.'));
    if (r.reason === 'targets-conflict') {
      items.push(h('li', {}, '능력치 하나하나는 가능하지만, 모든 목표를 동시에 만족하는 조합이 없습니다. 아래 중 하나를 낮춰보세요:'));
      for (const [k, v] of Object.entries(r.conflict || {})) items.push(h('li', {}, `${STAT_LABEL[k]}: 장비에서 ${fmt(v.need)} 필요 → 다른 목표를 지키면 약 ${fmt(v.maxWithOthers)} 까지 가능`));
    }
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

// 업로드한 프로필은 이 브라우저(localStorage)에 보관하고 검색할 때 같이 보낸다 (호스팅 환경에서도 동작)
const LS_KEY = 'poe2lab.profiles';
function localProfiles() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { return []; }
}
function mergeLocalProfiles() {
  const local = localProfiles();
  META.profiles = [...META.profiles.filter((p) => !local.some((l) => l.id === p.id)), ...local.map((p) => ({ ...p, source: 'user' }))];
}

async function uploadProfile(ev) {
  const file = ev.target.files[0];
  if (!file) return;
  try {
    const json = JSON.parse(await file.text());
    const list = Array.isArray(json) ? json : json.profiles || [json];
    const res = await fetch('/api/profiles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(list) }).then((r) => r.json());
    const okIds = new Set(res.results.filter((x) => !x.errors.length).map((x) => x.id));
    const keep = [...localProfiles().filter((p) => !okIds.has(p.id)), ...list.filter((p) => okIds.has(p.id))];
    try { localStorage.setItem(LS_KEY, JSON.stringify(keep)); } catch { /* 저장 불가 */ }
    const bad = res.results.filter((x) => x.errors.length);
    toast(bad.length ? `일부 실패: ${bad.map((b) => `${b.id}: ${b.errors.join(', ')}`).join(' / ')}` : `프로필 ${okIds.size}개 추가됨`);
    META = await fetch('/api/meta').then((r) => r.json());
    mergeLocalProfiles();
    refreshProfileLists();
  } catch (err) {
    toast(`JSON 읽기 실패: ${err.message}`);
  }
}

init();
