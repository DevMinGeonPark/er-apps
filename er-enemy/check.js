// public/dakgg.js 셀프체크 — 브라우저 모듈을 Node에서 그대로 돌린다.
// 구 server.js가 localhost:3623에 떠 있으면 산출물을 1:1 비교(골든 테스트)한다.
//   node check.js [닉네임]
const fs = require('fs');
const path = require('path');
const assert = require('assert');

global.window = global; // 브라우저처럼 window === globalThis 로 맞춘다
for (const f of ['dakgg-core.js', 'dakgg.js'])
  new Function(fs.readFileSync(path.join(__dirname, 'public', f), 'utf8'))();
const DAK = global.DAK;

const NAME = process.argv[2] || 'Nicholas';
const PORT = 3623;

async function golden(pathname) {
  try {
    const r = await fetch(`http://localhost:${PORT}${pathname}`);
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

async function main() {
  const k = await DAK.killers(NAME);
  assert(k.killers.length > 0, '원수 목록이 비어 있음');
  assert(DAK.charImgUrl(k.killers[0].last.byCharKey || 'Jackie').startsWith('https://'), 'charImgUrl 해석 실패');
  console.log(`색출 OK — ${k.me} / 스캔 ${k.scanned}판 / 원수 ${k.killers.length}명`);

  const top = k.killers[0];
  const o = await DAK.observe(top.nickname, k.me, top.last.gameId);
  assert(o.target && o.target.nickname, '관측 대상 없음');
  console.log(`관측 OK — ${o.target.nickname} / ${o.fate.tone} / 사슬 ${o.chain ? o.chain.length : 0}단계`);

  const gk = await golden(`/api/killers?name=${encodeURIComponent(NAME)}`);
  if (!gk) return console.log(`구 서버(:${PORT}) 미기동 — 골든 비교 생략`);
  assert.deepStrictEqual(k, gk, '구 server.js의 /api/killers 와 불일치');
  const go = await golden(`/api/observe?enemy=${encodeURIComponent(top.nickname)}&me=${encodeURIComponent(k.me)}&gameId=${top.last.gameId}`);
  // fate.notes 의 "마지막 관측: N시간 전"은 호출 시각에 따라 달라져 비교에서 제외
  const strip = (d) => ({ ...d, fate: { ...d.fate, notes: undefined } });
  assert.deepStrictEqual(strip(o), strip(go), '구 server.js의 /api/observe 와 불일치');
  console.log('골든 비교 OK — 구 server.js와 산출물 동일');
}

main().catch(e => { console.error('실패:', e.message); process.exit(1); });
