# er-apps

이터널리턴(Eternal Return) 전적 데이터를 다른 제도의 언어로 번역하는 사이트 모음.
같은 dak.gg 데이터를 자격증·진단서·과실비율·주가·페르소나로 재해석한다.

## 포트 / 도메인 레지스트리

새 사이트 추가 시 **반드시 여기 먼저 등록**하고 포트를 배정할 것. (과거 er-enemy가
er-fault와 같은 3622를 기본값으로 써서 충돌한 이력 있음)

| 포트 | PM2 | 디렉토리 | 도메인 | 비고 |
|---|---|---|---|---|
| 3620 | `er-cert` | `er-cert/` | er-cert.dev-heptivision.com | 실험체 자격증 |
| 3621 | `er-death` | `er-death/` | er-death.dev-heptivision.com | 사망진단서 |
| 3622 | `er-fault` | `er-fault/` | er-fault.dev-heptivision.com | 과실비율 산정서 |
| 3623 | `er-enemy` | `er-enemy/` | er-enemy.dev-heptivision.com | **`PORT=3623` 환경변수 필수** (코드 기본값 3622 충돌) |
| 3624 | — | `lumia-exchange/` | lumia.dev-heptivision.com | 증권거래소, 터널만 예약 · 미기동 |
| 3625 | `er-credit` | `er-credit/` | (터널 미연결) | **루미아 신용정보원** — (유저 × 실험체) 신용평가 |
| 8793 | `markov-fantasy` | `fantasy/sites/markov-fantasy/` | — | `pm2 serve <dir> 8793 --spa` |
| 3626 | — | — | — | **다음 배정분** |

서버 없는 것: `er-map/` (정적 · 빌드 산출물), `martial/wuxia-forge/` ·
`fantasy/arcane-forge/` (Python 생성기 — 산출물을 `~/move/<slug>`,
`fantasy/sites/<slug>`로 배포)

### 헤드리스 Chrome 스크린샷

`--use-mock-keychain --password-store=basic` 을 붙이지 않으면 키체인 접근에서
무한 대기한다. (er-cert 때 겪은 것과 같은 증상)

## 배포

**현재**: Mac mini + PM2 + cloudflared 터널.
**이전 중(2026-08-27~)**: GitHub Pages 정적 호스팅.

과거에 "dak.gg API가 데이터센터 IP를 차단할 가능성"을 근거로 이전을 미뤘으나
**재검증 결과 사실이 아니었다**:

- `er.dakgg.io` 는 Referer 헤더 없이도 200, 데이터센터 IP에서도 동일하게 200
- CORS를 **오리진 반사**로 열어둠 (임의 도메인 허용 · 브라우저에서 실제 동작 확인)
- `cdn.dak.gg` 이미지는 `access-control-allow-origin: *` → 캔버스 오염 없음
- 앞단은 Cloudflare가 아니라 CloudFront

따라서 브라우저가 dak.gg를 직접 호출할 수 있고, `server.js` 5개(프록시+집계)는
전부 클라이언트로 흡수된다. `/img/char/`·`/img/skin/` 프록시 라우트도 불필요.
Cloudflare Workers 무료는 subrequest 50/요청·CPU 10ms/호출 한도에 er-cert
(시즌 43개 순회)가 걸려 부적합했다.

남은 서버 의존: `er-death /api/png`(헤드리스 Chrome 스크린샷 → 클라이언트 canvas로
교체 필요), `lumia-exchange`(진짜 백엔드 · 이전 대상 아님).

```bash
# 구 방식 (이전 완료 전까지 유지)
pm2 start <dir>/server.js --name <name> --cwd ~/er-apps/<dir>
pm2 save
```

## 정적 사이트 구조

```
hub/index.html          허브(문서국 첫 화면)
shared/dakgg-core.js    dak.gg 클라이언트 코어 — 각 앱 public/ 에 심볼릭 링크
<app>/public/
  dakgg-core.js         -> ../../shared/dakgg-core.js (심링크)
  dakgg.js              그 앱의 집계 로직 (구 server.js 에서 옮겨온 것, IIFE로 격리)
  app.js                렌더링
<app>/check.js          셀프체크 + 구 server.js 골든 비교
build.sh                dist/ 조립
smoke.sh                dist/ 를 띄우고 헤드리스 Chrome으로 전 페이지 렌더 확인
```

**`<app>/public/dakgg.js` 는 반드시 IIFE 안에 둘 것.** `app.js` 와 같은 전역
렉시컬 스코프를 공유해서 `fmt`·`fmtElapsed`·`observe`·`imgToDataUri` 가 실제로
충돌했다 (`const` 는 SyntaxError, `function` 은 조용히 덮어써서 더 위험).

배포 URL 경로:

| 경로 | 디렉토리 |
|---|---|
| `/` | `hub/` |
| `/cert/` `/death/` `/fault/` `/enemy/` `/credit/` | 각 앱 `public/` |
| `/map/` | `er-map/dist.html` |

```bash
./build.sh   # dist/ 조립
./smoke.sh   # 브라우저 렌더 검증 (dist/ 필요)
node er-cert/check.js   # 앱별 골든 비교 (구 server.js가 떠 있으면 1:1 대조)
```

`main` 에 push하면 `.github/workflows/pages.yml` 이 `build.sh` 를 돌려 GitHub
Pages로 배포한다.

**`server.js` 5개는 남겨둔다** — 이제 서비스용이 아니라 `check.js` 의 골든 기준이다.

## 구조 메모

- 서버는 전부 무의존성 Node (`node server.js` + `public/` 정적), 경로는 `__dirname` 기준
- dak.gg 클라이언트 코드가 사이트마다 복붙돼 있음 → `lib/dakgg.js`로 통합 예정
- 폰트(`gowun-batang.woff` 1.7MB)가 er-cert/er-death/er-fault에 3중 중복 → 공용화 예정
