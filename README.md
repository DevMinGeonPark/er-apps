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

Mac mini + PM2 + cloudflared 터널. **호스팅을 옮기지 않는 이유**: dak.gg API가
데이터센터 IP(Vercel/AWS, Cloudflare Workers 대역)를 차단할 가능성이 높다.
한국 가정용 IP가 이 프로젝트군의 전제 조건이다.

```bash
pm2 start <dir>/server.js --name <name> --cwd ~/er-apps/<dir>
pm2 save
# cloudflared: ~/.cloudflared/config.yml 에 hostname → localhost:<port> 추가
```

## 구조 메모

- 서버는 전부 무의존성 Node (`node server.js` + `public/` 정적), 경로는 `__dirname` 기준
- dak.gg 클라이언트 코드가 사이트마다 복붙돼 있음 → `lib/dakgg.js`로 통합 예정
- 폰트(`gowun-batang.woff` 1.7MB)가 er-cert/er-death/er-fault에 3중 중복 → 공용화 예정
