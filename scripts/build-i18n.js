// poe2db.tw 에서 전직 클래스 / 스킬 젬의 영문-한글 이름을 가져와 data/i18n/ko.json 생성
//   npm run i18n
// 같은 항목은 언어가 달라도 같은 URL slug / data-hover 키를 쓰므로 그것으로 짝을 맞춘다.
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT, config } from '../src/config.js';

const BASE = 'https://poe2db.tw';
const decode = (s) => s.replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim();

async function get(p) {
  const res = await fetch(`${BASE}${p}`, { headers: { 'User-Agent': config.userAgent } });
  if (!res.ok) throw new Error(`${p}: ${res.status}`);
  return res.text();
}

/** 전직 페이지: <figcaption><a class="Ranger" data-hover="...Ascendancy..." href="/us/Deadeye">Deadeye</a>  (slug 로 짝맞춤) */
export function parseAscendancies(html) {
  const out = new Map();
  const re = /<figcaption><a class="([^"]+)" data-hover="[^"]*Ascendancy[^"]*" href="\/(?:us|kr)\/([^"]+)">([^<]+)<\/a>/g;
  let m;
  while ((m = re.exec(html))) if (!out.has(m[2])) out.set(m[2], { base: m[1], name: decode(m[3]) });
  return out;
}

/** 스킬 젬 목록: <a class="gem_blue" ... href="/kr/Lightning_Arrow">번개 화살</a> */
export function parseGems(html) {
  const out = new Map();
  const re = /<a class="(?:gem_(?:red|green|blue|white)|gemitem)"[^>]*href="\/(?:us|kr)\/([^"]+)">\s*([^<]+?)\s*</g;
  let m;
  while ((m = re.exec(html))) if (!out.has(m[1])) out.set(m[1], decode(m[2]));
  return out;
}

/** <a ... href="/us/Slug"><img ... src="https://cdn.poe2db.tw/...webp"  -> slug 별 첫 아이콘 (4k 버전 제외) */
export function parseIcons(html) {
  const out = new Map();
  const re = /href="\/(?:us|kr)\/([^"]+)"><img[^>]*?src="(https:\/\/cdn\.poe2db\.tw\/[^"]+\.(?:webp|png))"/g;
  let m;
  while ((m = re.exec(html))) if (!out.has(m[1]) && !/\/4k\//i.test(m[2])) out.set(m[1], m[2]);
  return out;
}

// 아이콘은 public/icons 에 내려받아 로컬에서 서빙 (실행 중 poe2db CDN 에 의존하지 않도록)
async function downloadIcons(jobs) {
  let done = 0, failed = 0;
  const queue = [...jobs];
  const worker = async () => {
    for (let job; (job = queue.shift()); ) {
      const file = path.join(ROOT, 'public', job.rel);
      if (existsSync(file)) { done++; continue; }
      try {
        const res = await fetch(job.url, { headers: { 'User-Agent': config.userAgent } });
        if (!res.ok) throw new Error(String(res.status));
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, Buffer.from(await res.arrayBuffer()));
        done++;
      } catch {
        failed++;
        job.onFail();
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return { done, failed };
}

async function main() {
  const [ascUs, ascKr, gemUs, gemKr, clsKr] = await Promise.all([
    get('/us/Ascendancy_class'), get('/kr/Ascendancy_class'), get('/us/Skill_Gems'), get('/kr/Skill_Gems'), get('/kr/Character_class').catch(() => ''),
  ]);
  const aUs = parseAscendancies(ascUs);
  const ascIcons = parseIcons(ascUs);
  const gemIcons = parseIcons(gemUs);
  const aKr = parseAscendancies(ascKr);
  // 기본 직업 한글명: 캐릭터 클래스 페이지의 <a href="/kr/Ranger">레인저</a>
  const baseKo = {};
  for (const m of clsKr.matchAll(/href="\/kr\/([A-Z][a-z]+)">([^<]+)<\/a>/g)) baseKo[m[1]] ??= decode(m[2]);

  const iconPath = (dir, slug, url) => (url ? `icons/${dir}/${slug.replace(/[^\w-]/g, '_')}${path.extname(url)}` : null);
  const classes = [...aUs].map(([key, { base, name }]) => ({ en: name, ko: aKr.get(key)?.name || name, base, baseKo: baseKo[base] || base, icon: iconPath('classes', key, ascIcons.get(key)), _url: ascIcons.get(key) }))
    .filter((c) => !/^\d|Ascendancy/.test(c.en));
  const gUs = parseGems(gemUs);
  const gKr = parseGems(gemKr);
  const skills = [...gUs].filter(([, en]) => !/^\[|Support$/.test(en)).map(([slug, en]) => ({ en, ko: gKr.get(slug) || en, icon: iconPath('skills', slug, gemIcons.get(slug)), _url: gemIcons.get(slug) })).sort((a, b) => a.en.localeCompare(b.en));

  const jobs = [...classes, ...skills].filter((x) => x.icon).map((x) => ({ url: x._url, rel: x.icon, onFail: () => { x.icon = null; } }));
  const dl = await downloadIcons(jobs);
  for (const x of [...classes, ...skills]) delete x._url;
  console.log(`아이콘 ${dl.done}개 저장, 실패 ${dl.failed}개`);

  const file = path.join(ROOT, 'data', 'i18n', 'ko.json');
  writeFileSync(file, JSON.stringify({ source: 'poe2db.tw', generated: new Date().toISOString().slice(0, 10), classes, skills }, null, 1) + '\n');
  console.log(`전직 ${classes.length}개, 스킬 ${skills.length}개 -> ${path.relative(ROOT, file)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e.message); process.exit(1); });
