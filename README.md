# er-apps

이터널리턴(Eternal Return) 전적 데이터를 다른 제도의 언어로 번역하는 사이트 모음.
공식 Open API의 전적을 진단서·과실비율·원수 관측·급여명세서·주가로 재해석한다. 자격증·신용평가는 공식 실험체 메타와 DAK.GG의 전 시즌 상세 누적을 함께 사용한다.

새 시리즈 **[루미아 노동청](https://er.dev-heptivision.com/payroll/)**: 실제 랭크 RP로 지급·공제·실수령액과 RP 시급을 정산한다. PNG 저장과 링크 공유를 지원한다.

2026-09-09 공식 API 전환 범위·제약·검증은 [전환 기록](docs/official-api-migration.md)에 정리했다.

새 전적 서비스 [루미아섬 CCTV](er-ps/README.md)는 `er-ps/`에서 개발한다.
공식 Open API 공급자 어댑터와 PostgreSQL 수집·집계 기반을 갖추고, API 키는 서버 설정에서만 읽는다.
카카오에서 닉네임으로 바로 전적을 조회해 간단 목록 또는 큰 이미지로 보여준다. 웹은 후속 단계이며 기존 정적 배포와 별도로 실행한다.

## 배포 주소

정적 화면은 **https://er.dev-heptivision.com** 한 곳으로 통합됐다 (GitHub Pages).
공식 조회는 별도 `er-ps` 서버의 `https://erps.dev-heptivision.com/api/v1/series/`에서 처리한다. 2026-09-10 새 급여명세서와 기존 문서 앱의 공식 API 전환 화면을 운영에 반영했다.
서버의 API 키와 임시 사용자 조회 토큰은 브라우저로 전달하지 않는다.

| 경로 | 디렉토리 | 비고 |
|---|---|---|
| `/` | `hub/` | 루미아 문서국 (허브) |
| `/cert/` | `er-cert/public/` | 실험체 자격증 |
| `/death/` | `er-death/public/` | 사망진단서 |
| `/fault/` | `er-fault/public/` | 과실비율 산정서 |
| `/enemy/` | `er-enemy/public/` | 원수 관측소 |
| `/credit/` | `er-credit/public/` | 루미아 신용정보원 |
| `/payroll/` | `er-payroll/public/` | 루미아 노동청 · RP 급여명세서 |
| `/map/` | `er-map/dist.html` | 루미아섬 상황판 (개발중) |

**구 주소(`er-cert.dev-heptivision.com` 등 4개)는 2026-08-28에 제거했다** — PM2 프로세스,
cloudflared ingress, Cloudflare DNS 레코드 전부. 포트 레지스트리도 더 이상 필요 없다
(로컬에서 `server.js`를 골든 기준으로 띄울 때만 3620~3625를 쓴다).

별도 서버가 필요한 것: `er-ps/`(:3630, 공식 조회·CCTV), `lumia-exchange/`(:3624 예약, 미기동 · 거래소 백엔드),
`fantasy/sites/markov-fantasy/`(PM2 `markov-fantasy`, :8793).

### 헤드리스 Chrome 스크린샷

`--use-mock-keychain --password-store=basic` 을 붙이지 않으면 키체인 접근에서
무한 대기한다. (er-cert 때 겪은 것과 같은 증상)

## 실행과 배포

공식 API 서버는 기존 CCTV와 같은 `er-ps` 프로세스다. 새 정적 화면을 배포하기 전에 서버 코드를 먼저 반영한다.

```bash
cd er-ps
npm ci
npm start  # ../.env와 .env를 읽는다. 기본 포트 3630
```

별도 터미널에서 정적 화면을 조립한다. 서버 주소에는 공개 origin만 지정하며 API 키를 넣지 않는다.

```bash
ER_PUBLIC_API_BASE=http://127.0.0.1:3630 ./build.sh
python3 -m http.server 8099 --directory dist
```

`./build.sh`만 실행하면 공개 서버 주소를 사용한다. `main` push 시 Pages workflow가 정적 화면을 배포한다.
서버 변경은 별도로 기존 `er-ps-api` 프로세스를 재시작해 반영한다. 단위 테스트와 로컬 브라우저 검증은 운영 프로세스를 변경하지 않는다.

### 검증

Node 24와 Chrome, 브라우저 검증용 `er-agent/map`의 `puppeteer-core`가 필요하다.

```bash
(cd er-ps && npm test)
./build.sh
./smoke.sh                          # 로컬 공식 서버를 임시 기동해 7페이지·조회·PNG 검증
./smoke.sh https://er.dev-heptivision.com  # 실제 배포본 검증
node --test er-payroll/test/*.test.cjs
node scripts/check-payroll.mjs https://er.dev-heptivision.com  # 급여명세서 모바일·PNG·공유 검증
node --env-file=.env scripts/check-official-items.mjs
node --env-file=.env scripts/check-official-exchange.mjs  # 별도 거래소 저장소 + Maven 필요
node --env-file=.env scripts/sync-official-map.mjs        # 공식 지역·야생동물 메타 갱신
```

앱별 `node er-death/check.js`, `node er-enemy/check.js`, `node er-fault/check.js`는 공식 경로를 검증한다.
`ER_API_BASE_URL=http://127.0.0.1:3630`으로 검사 대상 서버를 지정할 수 있다.
자격증·신용평가 검사도 공식 메타를 읽으며, 전 시즌 누적은 DAK.GG로 유지한다.

## 클라이언트 구조

```text
hub/index.html           루미아 문서국
shared/er-config.js      공개 API 서버 주소(빌드 시 덮어쓸 수 있음)
shared/er-core.js        공식 전적·메타·이미지 클라이언트
shared/dakgg-core.js     자격증·신용평가의 전 시즌/스킨 보조 데이터
<app>/public/
  er-config.js           -> ../../shared/er-config.js
  er-core.js             -> ../../shared/er-core.js
  api.js                 사망진단서·과실비율·원수 관측의 계산
  dakgg.js               자격증·신용평가의 전 시즌 집계
  app.js                 화면 렌더링
build.sh                 dist/ 조립
smoke.sh                 Chrome으로 전체 흐름 검증
```

계산 모듈은 IIFE로 격리한다. `app.js`와 같은 전역 스코프에 선언하면 이름이 충돌한다.
`server.js` 5개는 이전 DAK 구현의 보존본이며 신규 화면의 API 서버가 아니다.
`er-map/dist.html`은 이미 외부 전적 API를 호출하지 않는 정적 지도다.

## 구조 메모

- 이전 문서 앱의 보존용 서버는 무의존성 Node (`node server.js` + `public/` 정적), 경로는 `__dirname` 기준
- 공식 API 인증·HTTP 제한은 `er-ps/src/providers/`, 시리즈 공용 조회는 `er-ps/src/services/series*.js`에서 관리
- 폰트(`gowun-batang.woff` 1.7MB)가 er-cert/er-death/er-fault에 3중 중복 → 공용화 예정
