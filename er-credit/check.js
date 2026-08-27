// public/dakgg.js 셀프체크 — 브라우저 모듈을 Node에서 그대로 돌린다.
// 구 server.js가 localhost:3625에 떠 있으면 산출물을 1:1 비교(골든 테스트)한다.
// 조회 이력(inquiries)은 저장소가 서버 파일 -> localStorage 로 바뀌었으므로 비교에서 제외한다.
//   node check.js [닉네임]
const fs = require('fs');
const path = require('path');
const assert = require('assert');

global.window = global; // 브라우저처럼 window === globalThis 로 맞춘다
const store = new Map();
global.localStorage = { // Node에는 없으므로 최소 구현
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
};
for (const f of ['dakgg-core.js', 'dakgg.js'])
  new Function(fs.readFileSync(path.join(__dirname, 'public', f), 'utf8'))();
const DAK = global.DAK;

const NAME = process.argv[2] || '하늘';
const PORT = 3625;

// inquiries/issuedAt 은 저장소·호출시각 의존이라 제외
// summary.best/worst 가 rows 원소를 그대로 참조하므로 키 제거는 재귀로 해야 한다
const drop = (o, keys) => JSON.parse(JSON.stringify(o, (k, v) => (keys.includes(k) ? undefined : v)));
const stripRows = (d) => drop(d, ['inquiries']);
const stripCredit = (d) => drop(d, ['inquiries', 'issuedAt']);

async function main() {
  const rep = await DAK.report(NAME);
  assert(rep.rows.length > 0, '등급표가 비어 있음');
  assert(rep.seasonsPlayed > 0, '시즌 집계 실패');
  const top = rep.rows.find(r => !r.thinFile) || rep.rows[0];
  console.log(`등급표 OK — ${rep.player.name} / 실험체 ${rep.rows.length}종 / 평가 ${rep.summary.evaluated}종`);

  const c = await DAK.credit(NAME, top.characterId);
  assert(c.reportNo && c.grade, '신용조사서 산정 실패');
  assert.strictEqual(c.inquiries, 1, 'localStorage 조회 이력이 기록되지 않음');
  assert.strictEqual((await DAK.credit(NAME, top.characterId)).inquiries, 2, '조회 이력이 누적되지 않음');
  assert(DAK.charImgUrl(top.key).startsWith('https://'), 'charImgUrl 해석 실패');
  console.log(`신용조사서 OK — ${c.character.name} / ${c.grade}등급 / ${c.score}점`);

  let g;
  try {
    const r = await fetch(`http://localhost:${PORT}/api/report?name=${encodeURIComponent(NAME)}`);
    if (r.ok) g = await r.json();
  } catch { /* 서버 내려가 있으면 건너뜀 */ }
  if (!g) return console.log(`구 서버(:${PORT}) 미기동 — 골든 비교 생략`);
  assert.deepStrictEqual(stripRows(rep), stripRows(g), '구 server.js의 /api/report 와 불일치');
  const gc = await (await fetch(`http://localhost:${PORT}/api/credit?name=${encodeURIComponent(NAME)}&characterId=${top.characterId}`)).json();
  assert.deepStrictEqual(stripCredit(c), stripCredit(gc), '구 server.js의 /api/credit 과 불일치');
  console.log('골든 비교 OK — 구 server.js와 산출물 동일');
}

main().catch(e => { console.error('실패:', e.message); process.exit(1); });
