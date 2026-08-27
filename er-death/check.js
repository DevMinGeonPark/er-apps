// public/dakgg.js 셀프체크 — 브라우저 모듈을 Node에서 그대로 돌린다.
// 구 server.js가 localhost:3621에 떠 있으면 산출물을 1:1 비교(골든 테스트)한다.
// PNG(구 /api/png = 헤드리스 Chrome 촬영)는 html2canvas로 대체돼 브라우저에서만 검증된다.
//   node check.js [닉네임]
const fs = require('fs');
const path = require('path');
const assert = require('assert');

global.window = global; // 브라우저처럼 window === globalThis 로 맞춘다
for (const f of ['dakgg-core.js', 'dakgg.js'])
  new Function(fs.readFileSync(path.join(__dirname, 'public', f), 'utf8'))();
const DAK = global.DAK;

const NAME = process.argv[2] || 'Nicholas';
const PORT = 3621;

async function main() {
  const c = await DAK.deathCert(NAME);
  assert(c.victim && c.death, '진단서 구조가 비정상');
  assert(c.death.gameId, 'gameId 없음');
  assert(!c.victim.portrait || c.victim.portrait.startsWith('https://'), '영정사진 URL이 프록시 경로로 남아 있음');
  assert(!c.killer || !c.killer.mugshot || c.killer.mugshot.startsWith('https://'), '머그샷 URL이 프록시 경로로 남아 있음');
  console.log(`진단서 OK — ${c.victim.nickname} / ${c.victim.characterName} / ${c.death.manner} / 사인체인 ${c.causeChain.length}단계`);

  let g;
  try {
    const r = await fetch(`http://localhost:${PORT}/api/deathcert?name=${encodeURIComponent(NAME)}&gameId=${c.death.gameId}`);
    if (r.ok) g = await r.json();
  } catch { /* 서버 내려가 있으면 건너뜀 */ }
  if (!g) return console.log(`구 서버(:${PORT}) 미기동 — 골든 비교 생략`);
  // 이미지 URL은 프록시 경로 -> cdn 직결로 바뀐 것이 의도된 차이라 비교에서 제외
  const drop = (o) => JSON.parse(JSON.stringify(o, (k, v) =>
    (['portrait', 'mugshot', 'issuedAt'].includes(k) ? undefined : v)));
  assert.deepStrictEqual(drop(c), drop(g), '구 server.js와 산출물 불일치');
  console.log('골든 비교 OK — 구 server.js와 산출물 동일 (이미지 URL 제외)');
}

main().catch(e => { console.error('실패:', e.message); process.exit(1); });
