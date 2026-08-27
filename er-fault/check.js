// public/dakgg.js 셀프체크 — 브라우저 모듈을 Node에서 그대로 돌린다.
// 구 server.js가 localhost:3622에 떠 있으면 산출물을 1:1 비교(골든 테스트)한다.
// 팀원 2명이 실제로 같이 한 판을 찾기 어려워, 서버가 원래 갖고 있던 demo 모드
// (한 사람의 전적을 세 슬롯에 복제)로 조인 경로를 태운다.
//   node check.js [닉네임]
const fs = require('fs');
const path = require('path');
const assert = require('assert');

global.window = global; // 브라우저처럼 window === globalThis 로 맞춘다
for (const f of ['dakgg-core.js', 'dakgg.js'])
  new Function(fs.readFileSync(path.join(__dirname, 'public', f), 'utf8'))();
const DAK = global.DAK;

const NAME = process.argv[2] || 'Nicholas';
const PORT = 3622;
const REQ = { me: NAME, mates: [NAME], season: 'auto', pages: '3', mode: 'all', demo: NAME };

async function main() {
  const ss = await DAK.seasons();
  assert(ss.length > 0 && ss[0].key, '시즌 목록이 비어 있음');

  const r = await DAK.assessRequest(REQ);
  assert(r.sharedGames > 0, '공유 게임 조인 실패');
  assert(DAK.charImgUrl('Jackie').startsWith('https://'), 'charImgUrl 해석 실패');
  console.log(`산정 OK — 공유 ${r.sharedGames}판 / 사고 ${r.accidentCount || 0}건 / 과실 ${JSON.stringify(r.fault)}`);

  const q = new URLSearchParams({ me: NAME, mates: NAME, season: 'auto', pages: '3', mode: 'all', demo: NAME });
  let golden;
  try {
    const res = await fetch(`http://localhost:${PORT}/api/assess?${q}`);
    if (res.ok) golden = await res.json();
  } catch { /* 서버 내려가 있으면 건너뜀 */ }
  if (!golden) return console.log(`구 서버(:${PORT}) 미기동 — 골든 비교 생략`);
  // issuedAt은 호출 시각이라 비교에서 제외
  const strip = (o) => { const c = { ...o }; delete c.issuedAt; return c; };
  assert.deepStrictEqual(strip(r), strip(golden), '구 server.js와 산출물 불일치');
  console.log('골든 비교 OK — 구 server.js와 산출물 동일');
}

main().catch(e => { console.error('실패:', e.message); process.exit(1); });
