# ER 시리즈 공식 API 전환

2026-09-09 진행 기록. API 키는 저장소 루트 `.env`의 `API_KEY` 또는 `ER_API_KEY`로 읽는다.
브라우저는 `er-ps`의 `/api/v1/series/*`를 사용하며 키와 임시 사용자 토큰을 받지 않는다.

## 범위와 데이터 근거

| 대상 | 전환 작업 | 남는 외부 의존 |
|---|---|---|
| 사망진단서 | 공식 개인 전적·경기 상세·게임 메타 연결, Chrome 발급/PNG 확인 완료 | 공식 홈페이지 게임 DB의 공개 인물 이미지(서버 캐시) |
| 과실비율 | 공식 전적·직군·시즌 연결, 실제 팀원 두 명 조인/문서 렌더 확인 완료 | 없음 |
| 원수 관측소 | 공식 개인 전적·시즌 통계·경기 상세 연결, Chrome 원수/사슬 확인 완료 | 공식 홈페이지 게임 DB의 공개 인물 이미지(서버 캐시) |
| 루미아 노동청(신규) | 공식 랭크 RP 지급·입장 공제·실수령액·시급 정산, PNG 저장·공유 | 없음 |
| 자격증·신용평가 | 공식 실험체 이름·직군 연결, 전 시즌 발급·등급표·보고서 Chrome 확인 | 전 시즌·실험체 상세 누적, 스킨 이미지 및 ID 대응 검증 |
| ER Agent 템 추천 | 800개 아이템의 공식 수치·제작 재료 연결, 실제 현우 추천 확인 | 전체 유저 빌드 픽률·표본, 고유 효과 설명·이미지, ID 대응 검증 |
| 지도 | 지역 21곳·동물 7종의 공식 메타와 갱신 도구 반영 | 지도 이미지·캠프 좌표·크레딧·낮/밤 길이. 구 er-map은 이미 외부 전적 API 호출 없음 |
| 루미아 거래소(별도 저장소) | 기본 공급자를 공식 RP·경기·시즌으로 전환, Java 실응답 검증 완료 | 티어/디비전. 공식 RP·시즌·닉네임 일치 시에만 결합, 불일치 시 갱신 보류 |
| 루미아섬 CCTV | 이미 공식 API 공급자를 사용 | 없음(DAK 어댑터는 비교용) |

공식 문서: <https://developer.eternalreturn.io/static/media/OpenAPI_KR_20260724.html>

실제 키로 확인한 내용:

- 개인 전적 `/v1/user/games/uid/{uid}`는 10건과 숫자 `next`를 반환한다. 페이지 길이 대신 `next`로 계속 읽는다.
- 경기 상세 `/v1/games/{gameId}`는 24명의 닉네임·팀 번호·경기 결과를 반환했다.
- 시즌 41과 39의 `/v2/user/stats/uid/{uid}/{season}/3`은 성공했다. `characterStats`는 각각 상위 3개 실험체만 반환했다. 실험체별 전체 딜량·플레이 시간·데스 누적은 없었다.
- 시즌 `averageKills`는 반올림된 평균이다. 이를 판수와 곱해 정확한 총 킬로 표시하지 않는다.
- `healAmount`는 자연 재생을 제외한 총 회복량, `teamRecover`가 타인에게 제공한 회복량이다. 과실 산정은 `teamRecover`를 사용한다.
- 사망 원인의 `killer`/`killDetail` 등은 실응답에 있지만 문서는 해석을 더 이상 보장하지 않는 레거시 필드로 설명한다. 누락 시 상세 기록 없음으로 표시한다.
- 전적 범위는 최근 90일이며 닉네임 변경 이전 기록은 제외된다. 이 범위를 전 시즌으로 표시하지 않는다.
- Naver 게임 DB의 공개 초상화는 CORS 헤더가 없어 서버의 허용된 이미지 경로로 받아 전달한다. 이미지 요청에는 공식 API 키를 보내지 않는다.

## 검증

```sh
node --test er-ps/test/series.test.js
./build.sh
node --env-file=.env scripts/check-official-series.mjs
```

브라우저 실검증 결과는 `.cache/er-series-migration/browser/report.json`과 PNG 5장에 저장된다.
사망진단서·과실비율·원수 관측소는 DAK.GG 네트워크 요청 0건을 확인한다. 자격증·신용평가의 보조 DAK 요청은 별도로 집계한다. 5개 앱의 조회·발급·보고서와 허브·구 지도까지 검사한다.

추가 검증 명령:

```sh
node --env-file=.env scripts/check-official-items.mjs
node --env-file=.env scripts/check-official-exchange.mjs
(cd er-agent/agent && npm test && npm run check && npm run build)
(cd er-agent/map && npm test && npm run build)
(cd lumia-exchange/backend && mvn test)
```

아이템 실검증: `.cache/er-series-migration/items-validation.json`. 거래소 실검증: `lumia-exchange/backend/target/surefire-reports/*OfficialMarketDataProviderLiveTest*`. 공식 RP 4699·최근 랭크 3판을 Java 어댑터로 확인했다.

## 운영 반영 순서

1. `er-ps` 서버 변경을 먼저 반영하고 기존 `er-ps-api` 프로세스를 재시작한다. `/api/v1/series/metadata`의 `provider=official`을 확인한다.
2. `./build.sh`와 정적 Pages 배포를 수행한다. `./smoke.sh https://er.dev-heptivision.com`으로 배포본을 검증한다.
3. Agent는 새 코드를 빌드·재시작하고, 별도 거래소 저장소도 새 어댑터를 빌드·재기동한다. 공식 키는 공용 서버 한 곳에서만 관리한다.

## 2026-09-10 운영 반영

- 기존 `er-ps-api`를 갱신해 공용 시리즈 API를 운영에 반영했다. 공개 origin에서 공식 메타 91개 실험체와 개인 전적 100경기 응답 및 CORS를 확인했다.
- 커밋 `e04568d`의 [GitHub Pages 배포](https://github.com/DevMinGeonPark/er-apps/actions/runs/34418602393)가 성공했다. 기존 문서 앱의 공식 API 전환 화면과 신규 [루미아 노동청](https://er.dev-heptivision.com/payroll/)을 함께 게시했다.
- 급여 계산 단위 테스트 5개와 공용 API 테스트 9개 통과. 실제 Nicholas의 최근 랭크 10판은 지급 673 RP, 공제 −414 RP, 실수령 +259 RP이며 플레이 시간 10,190초 기준 시급 +91.5 RP다.
- 급여명세서 브라우저 검증 기록: `.cache/er-payroll/local/report.json`, `.cache/er-payroll/live/report.json`. 로컬과 공개 주소 모두 데스크톱·390px 모바일, 실제 PNG 다운로드, 공유 링크 재조회, API 오류 안내 검사를 통과했다.
- `./smoke.sh https://er.dev-heptivision.com`도 통과했다. 기존 5개 앱의 실제 조회·발급·보고서와 허브·지도를 확인했으며 사망진단서·과실비율·원수 관측소의 DAK 요청과 브라우저 오류는 0건이었다.
- Agent·별도 거래소의 프로세스 재기동과 배포는 이 Pages 배포에 포함하지 않았다.
