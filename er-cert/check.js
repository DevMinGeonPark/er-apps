// public/dakgg.js 셀프체크 — 브라우저용 모듈을 window 셰이딩해서 Node에서 그대로 돌린다.
// 구 server.js가 localhost:3620에 떠 있으면 산출물을 1:1 비교(골든 테스트)까지 한다.
//   node check.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');

global.window = global; // 브라우저처럼 window === globalThis 로 맞춘다
for (const f of ['dakgg-core.js', 'dakgg.js'])
  new Function(fs.readFileSync(path.join(__dirname, 'public', f), 'utf8'))();
const DAK = global.DAK;

const NAME = '하늘';        // 39개 시즌 보유 — 시즌 순회 경로를 최대로 태운다
const CHARACTER_ID = 44;

// issuedAt은 호출 시각이라 비교에서 제외
const strip = (o) => { const c = { ...o }; delete c.issuedAt; return c; };

async function main() {
  const chars = await DAK.getCharacters();
  assert(chars.length > 50, `캐릭터 목록이 비정상: ${chars.length}`);

  // 프록시 라우트를 대체한 이미지 URL 해석
  const jackie = chars.find(c => c.key === 'Jackie');
  assert(DAK.charImgUrl('Jackie').startsWith('https://'), 'charImgUrl 해석 실패');
  assert(DAK.skinImgUrl(jackie.skins[0].imageName).startsWith('https://'), 'skinImgUrl 해석 실패');
  assert.strictEqual(DAK.skinImgUrl('Jackie_S000'), DAK.charImgUrl('Jackie'),
    '스킨 미등록 시 기본 캐릭터 이미지로 떨어져야 함');

  const cert = await DAK.issueCertificate(NAME, CHARACTER_ID);
  assert(cert.charStats.play > 0, '플레이 기록이 0이면 발급되면 안 됨');
  assert(cert.seasonsTotal >= 30, `시즌 순회가 덜 됨: ${cert.seasonsTotal}`);
  assert.strictEqual(cert.failedSeasons, 0, `시즌 프로필 수집 실패 ${cert.failedSeasons}건`);
  assert(cert.grade && cert.certNo.startsWith('AGL-'), '등급/자격증번호 산정 실패');
  console.log(`정적 경로 OK — ${cert.player.name} / ${cert.character.name} / ${cert.grade} ` +
    `(${cert.charStats.play}판, 승률 ${cert.charStats.winRate}%, 시즌 ${cert.seasonsPlayed}/${cert.seasonsTotal})`);

  // 구 서버가 떠 있으면 골든 비교
  const url = `http://localhost:3620/api/certificate?name=${encodeURIComponent(NAME)}&characterId=${CHARACTER_ID}`;
  let golden;
  try {
    const r = await fetch(url);
    if (r.ok) golden = await r.json();
  } catch { /* 서버 내려가 있으면 건너뜀 */ }
  if (!golden) return console.log('구 서버(:3620) 미기동 — 골든 비교 생략');
  assert.deepStrictEqual(strip(cert), strip(golden), '구 server.js 산출물과 불일치');
  console.log('골든 비교 OK — 구 server.js와 산출물 동일');
}

main().catch(e => { console.error('실패:', e.message); process.exit(1); });
