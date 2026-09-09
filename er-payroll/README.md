# 루미아 노동청

랭크 획득 RP를 지급액, 공식 입장 비용을 공제로 표시하는 재미용 급여명세서.
실제 RP 증감과 지급·공제의 차이는 기타 조정으로 표시하며, RP 시급은 실제 플레이 시간만으로 계산한다.

- 공개 경로: `/payroll/`
- 닉네임 링크: `/payroll/?name=Nicholas&count=20`
- 범위: 공식 최근 90일 이내 최대 100경기 중 최신 랭크 10·20·30판
- 화면: 실수령액·지급/공제·RP 시급·인사 평가·경기별 기록부
- 저장: PNG 다운로드. 공유 링크는 접속 시점의 최신 전적으로 다시 계산한다.
- RP 또는 플레이 시간이 없으면 합계 또는 시급 산정을 보류한다. 예시는 가상 기록임을 화면과 PNG에 표기한다.

API 키는 기존 `er-ps` 서버에만 두며 공용 `/api/v1/series/matches`를 사용한다.

```sh
node --test er-payroll/test/*.test.cjs
./build.sh
node --env-file=.env scripts/check-payroll.mjs
```
