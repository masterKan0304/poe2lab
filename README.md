# poe2lab

Path of Exile 2 관련 유틸리티 모음. 첫 번째 기능은 **장비 설계**입니다.

## 장비 설계 (프로토타입)

직업 + 주력 스킬 3종 + 목표 능력치를 넣으면, 공식 거래소(trade2) 매물 중에서 **모든 목표를 만족하면서 총 가격이 가장 싼 장비 세트**를 최대 3개 추천합니다.
추천 세트 하나는 15칸 전부를 포함합니다: 투구, 갑옷, 장갑, 장화, 무기 1/2, 허리띠, 반지 1/2, 목걸이, 호신부 1~3, 생명력/마나 플라스크.

각 장비마다 가격(엑잘 환산 포함), 판매자 계정/캐릭터명, **은신처 순간이동**, 귓속말 복사, 거래소 링크를 보여줍니다.

### 실행

Node.js 20 이상이 필요하고, 외부 패키지는 쓰지 않습니다.

```bash
cp .env.example .env     # POE2LAB_CONTACT, POESESSID 입력 (선택)
npm start                # http://localhost:3000
```

```bash
npm run start:mock       # 거래소 접속 없이 가짜 매물로 동작 확인 (Windows 에서도 동작)
npm run simulate         # 연결 진단 + 데모 매물로 전 직업 x 목표치 시뮬레이션
npm run simulate -- --live   # + 실제 trade2 로 1회 전체 검색
npm test
npm run verify           # 실서버 스탯 id / 카테고리가 코드의 가정과 맞는지 점검
npm run i18n             # poe2db.tw 에서 전직/스킬 한글명 + 아이콘 다시 받기 (data/i18n/ko.json, public/icons)
```

**"찾기가 안 돼요" 일 때** — `npm run simulate` 를 먼저 돌리세요. trade2 연결(403 = IP/VPN 차단, 429 = 레이트 리밋), 환율, 스탯 매칭을 단계별로 점검하고 원인을 알려줍니다.

> GGG trade API 는 클라우드/데이터센터 IP 를 403 으로 막습니다. **반드시 본인 PC 에서 실행하세요.**
> 서버는 `127.0.0.1` 에만 열립니다 (POESESSID 를 쓰기 때문).

### 동작 방식

1. **빌드 매칭** — 직업 + 스킬 3종과 가장 많이 겹치는 빌드 프로필을 고릅니다.
   - 입력은 한글/영문 모두 됩니다. 자동완성 드롭다운이 뜨고, 초성 검색(예: `ㄷㄷㅇ` → 데드아이)도 됩니다. 이름 번역은 poe2db.tw에서 받았습니다.
   - 샘플 프로필이 없는 전직은 **일반 프로필**로 검색합니다. 기본 직업에 맞는 무기만 정하고, 필수 장비나 핵심 옵션 없이 목표 능력치만 씁니다.
   - 프로필에서 **90% 이상**이 착용한 유니크는 가격과 상관없이 해당 슬롯에 고정합니다.
   - 50% 이상이 챙기는 옵션(예: 활의 `+# to Level of all Projectile Skills`)은 그 슬롯의 요구 옵션이 됩니다.
2. **목표치 계산** — 입력은 "장비에서 얻는 합계" 기준입니다.
   - 저항은 최대 75%입니다. 기본 원소 저항 페널티(-60%)와 캠페인 보너스(+20%), 트리 등 기타 저항을 빼서 장비에서 필요한 양을 계산합니다. 예를 들어 75%를 맞추려면 장비에서 115%가 필요합니다. 이 값들은 UI의 "저항 계산 설정"에서 바꿀 수 있습니다.
   - 비운 칸은 (옵션을 켜면) 그 빌드 유저들의 일반적인 수치로 채웁니다.
3. **매물 검색** — 슬롯마다 trade2 **가중치(weight) 검색**을 합니다. 가중치는 각 능력치의 "슬롯당 공정 몫"으로 정규화하고, 저가순과 능력치순을 함께 가져옵니다. 저항·생명력은 pseudo 합계 스탯을 씁니다.
   - **타협**: 비싼 옵션(premium)은 넣은 경우와 뺀 경우의 최저가를 비교합니다. N배(기본 3배) 이상 비싸면 그 옵션을 빼고, 그 사실을 카드에 표시합니다.
4. **세트 최적화** — 슬롯별 후보 중 하나씩 골라 모든 목표를 만족하는 최저가 조합을 찾습니다. 지배 후보 제거 → 도달 가능성 가지치기 → 빔 서치 순서로 진행합니다.
   - 가중치는 "쓸모 있는 옵션 몇 줄짜리인가"로 정규화합니다. 등급별(1.5 / 2.5 / 3.5줄) 최저가와 최고 성능 매물을 함께 가져옵니다.
   - **개선 라운드**: 1차 결과에서 비싼 슬롯마다 "그 이상 성능인데 더 싼" 매물을 다시 찾아 재최적화합니다.
   - 목표에 못 미치면 부족한 능력치만 집중 검색해서 보강한 뒤 다시 시도합니다(최대 2회).
   - 그래도 불가능하면 결과 없이 이유를 보여줍니다.
     - 한 능력치 자체가 부족할 때: "생명력: 2500 필요 / 찾은 매물로 최대 1879"
     - 각각은 되지만 동시에 안 될 때: "생명력: 다른 목표를 지키면 약 1133 까지 가능" 
5. **가격 환산** — poe.ninja 공개 경제 API의 환율로 모든 가격을 엑잘티드로 환산합니다.

**예산**은 엑잘티드와 디바인 칸에 각각 넣으면 합산합니다. 디바인은 poe.ninja 현재 환율로 엑잘티드로 환산합니다.

### 데이터 소스 & 제약

| 소스 | 사용 | 비고 |
|---|---|---|
| pathofexile.com trade2 | 매물 검색/조회, 은신처 이동 | 응답 헤더의 레이트 리밋을 그대로 따르고, 버킷의 1/6은 사용자 몫으로 남깁니다. 실시간 검색은 1~5분 걸립니다. |
| poe.ninja 경제 API | 화폐 환율 | 공개 API |
| poe2db.tw | 전직/스킬 한글명, 아이콘 | `npm run i18n`으로 받아 `data/i18n/ko.json`과 `public/icons/`에 저장합니다(앱 실행 중에는 접속하지 않음). 아이콘 저작권은 Grinding Gear Games에 있습니다. |
| poe.ninja 빌드 | **사용 안 함** | 빌드/캐릭터 API는 poe.ninja가 "내부용, 서드파티 사용 불가"로 명시했습니다. 지금은 `data/builds/sample-profiles.json`(**예시 수치**)를 씁니다. 같은 스키마의 JSON을 UI에서 업로드하면 교체됩니다. |

**은신처 순간이동**: trade2 사이트의 "Travel to Hideout" 버튼과 같은 요청(`POST /api/trade2/whisper`, 매물의 `hideout_token`)을 본인 `POESESSID`로 보냅니다. 즉시 구매(securable) 매물에만 있고, 게임에 접속해 있어야 합니다. 이 엔드포인트 형식은 아직 실서버로 확인하지 못했습니다.

### 빌드 프로필 JSON 스키마

```jsonc
{
  "id": "my-deadeye",
  "class": "Deadeye",
  "skills": ["Lightning Arrow", "Tornado Shot", "Gas Arrow"],
  "sampleSize": 1840,
  "typicalTargets": { "life": 1200, "fireRes": 75, "coldRes": 75, "lightRes": 75, "chaosRes": 20, "moveSpeed": 30 },
  "slots": {
    "weapon1": { "category": "weapon.bow", "keyMods": [{ "text": "+# to Level of all Projectile Skills", "min": 3, "usage": 0.82, "premium": true }] },
    "weapon2": { "category": "armour.quiver", "offhand": true },          // 양손 무기면 { "twoHanded": true }
    "body":    { "uniques": [{ "name": "Kaom's Heart", "baseType": "Glorious Plate", "usage": 0.91 }] },  // usage ≥ 0.9 → 필수
    "charm1":  { "baseType": "Thawing Charm" },
    "flaskLife": { "baseType": "Ultimate Life Flask" }
  }
}
```

### 아직 검증 못 한 것 (로컬에서 `npm run verify`)

- 개발 환경에서 trade2가 403이라, 실서버 응답 대신 mock과 가짜 fetch로만 테스트했습니다.
- 다음 가정은 실서버에서 확인해야 합니다: pseudo 스탯 문구(`src/trade/query.js`), 카테고리 값(특히 호신부 `azmeri.charm`, `src/slots.js`), 룬 수호(Runic Ward) 옵션 문구, whisper 엔드포인트.

### 구조

```
server.js                 로컬 HTTP 서버 (UI + /api/plan NDJSON 스트리밍, /api/hideout, /api/profiles)
src/planner.js            파이프라인 (빌드 매칭 → 목표치 → 검색/타협 → 최적화 → 보강)
src/optimizer.js          세트 최적화 (빔 서치)
src/trade/live.js         trade2 클라이언트 · ratelimit.js 레이트 리밋 · query.js 쿼리 변환 · parse.js 아이템 파싱
src/trade/mock.js         오프라인용 가짜 거래소 (실서버와 같은 응답 형식)
src/ninja/currency.js     poe.ninja 환율
src/builds/profiles.js    빌드 프로필 로드/매칭/90% 필수 판정, 일반 프로필
src/i18n.js               한글<->영문 이름 (data/i18n/ko.json)
scripts/simulate.js       연결 진단 + 시뮬레이션
public/                   UI
```
