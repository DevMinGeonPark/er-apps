// 루미아섬 원수 관측소 — dak.gg(er.dakgg.io) 데이터 기반, 의존성 없음 (Node 18+)
// "그놈은 어떻게 됐을까"
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3622;
const DAK = 'https://er.dakgg.io/api/v1';
const HEADERS = {
  'Accept': 'application/json',
  'Referer': 'https://dak.gg/',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
};

// ---------- 캐시 ----------
const cache = new Map();
function cacheGet(key) {
  const e = cache.get(key);
  if (!e) return null;
  if (Date.now() - e.at > e.ttl) { cache.delete(key); return null; }
  return e.value;
}
function cacheSet(key, value, ttl) {
  cache.set(key, { at: Date.now(), ttl, value });
  if (cache.size > 800) {
    const now = Date.now();
    for (const [k, e] of cache) if (now - e.at > e.ttl) cache.delete(k);
  }
}

async function dakJson(pathname, ttl) {
  const key = 'dak:' + pathname;
  const hit = cacheGet(key);
  if (hit) return hit;
  const res = await fetch(DAK + pathname, { headers: HEADERS });
  if (!res.ok) {
    const err = new Error(`dak.gg ${res.status} for ${pathname}`);
    err.status = res.status;
    throw err;
  }
  const json = await res.json();
  cacheSet(key, json, ttl);
  return json;
}

// ---------- 메타데이터 ----------
const META_TTL = 6 * 3600 * 1000;
async function getMeta() {
  const hit = cacheGet('meta:all');
  if (hit) return hit;
  const [chars, areas, masteries, monsters] = await Promise.all([
    dakJson('/data/characters?hl=ko', META_TTL),
    dakJson('/data/areas?hl=ko', META_TTL),
    dakJson('/data/masteries?hl=ko', META_TTL),
    dakJson('/data/monsters?hl=ko', META_TTL),
  ]);
  const meta = {
    charById: new Map(), charByKey: new Map(),
    areaById: new Map(), masteryByKey: new Map(), monsterByKey: new Map(),
  };
  for (const c of chars.characters) {
    const info = { id: c.id, key: c.key, name: c.name, imageUrl: 'https:' + c.imageUrl };
    meta.charById.set(c.id, info);
    meta.charByKey.set(c.key.toLowerCase(), info);
  }
  for (const a of areas.areas) meta.areaById.set(a.id, a.name);
  for (const m of masteries.masteries) meta.masteryByKey.set(m.key.toLowerCase(), m.name);
  for (const m of monsters.monsters) meta.monsterByKey.set(m.key.toLowerCase(), m.name);
  cacheSet('meta:all', meta, META_TTL);
  return meta;
}

// ---------- 전적 조회 ----------
const MATCH_TTL = 5 * 60 * 1000;
// mode: 'RANK'(기본) — 관측소는 MMR이 걸린 랭크만 다룬다. null이면 전체 모드.
async function getMatchesPage(nick, page, mode = 'RANK') {
  const enc = encodeURIComponent(nick);
  const d = await dakJson(`/players/${enc}/matches?page=${page}${mode ? `&matchingMode=${mode}` : ''}`, MATCH_TTL);
  return d.matches || [];
}
async function getMatches(nick, pages, mode = 'RANK') {
  const out = [];
  for (let p = 1; p <= pages; p++) {
    const ms = await getMatchesPage(nick, p, mode);
    out.push(...ms);
    if (ms.length < 20) break;
  }
  return out;
}
async function findGameRecord(nick, gameId, pages = 5) {
  for (let p = 1; p <= pages; p++) {
    let ms;
    try { ms = await getMatchesPage(nick, p); } catch (e) { return null; }
    const m = ms.find(x => x.gameId === gameId);
    if (m) return m;
    if (!ms.length || ms.length < 20) break;
    // 페이지가 이미 대상 게임보다 과거로 내려갔으면 중단
    if (ms[ms.length - 1].gameId < gameId) break;
  }
  return null;
}

function describeCause(cause) {
  if (!cause) return null;
  if (/^basicAttack$/i.test(cause)) return '기본 공격';
  return cause;
}

// 사망 정보 추출 — killer/killer2/killer3 (부활 포함), 마지막이 최종 사망
function extractDeaths(m, meta) {
  const out = [];
  for (const suf of ['', '2', '3']) {
    const killer = m['killer' + suf];
    const detail = m['killDetail' + suf];
    if (!killer && !detail) continue;
    const charKey = (m['killerCharacter' + suf] || '').toLowerCase();
    const killerChar = meta.charByKey.get(charKey) || null;
    const placeId = parseInt(m['placeOfDeath' + suf], 10);
    out.push({
      kind: killer,
      byNickname: killer === 'player' ? detail : null,
      byCharName: killer === 'player'
        ? (killerChar ? killerChar.name : (m['killerCharacter' + suf] || '불상'))
        : (killer === 'wildAnimal' || killer === 'monster')
          ? (meta.monsterByKey.get((detail || '').toLowerCase()) || detail || '야생동물')
          : (detail || '금지구역'),
      byCharKey: killer === 'player' && killerChar ? killerChar.key : null,
      cause: describeCause(m['causeOfDeath' + suf] || ''),
      placeName: meta.areaById.get(placeId) || null,
    });
  }
  return out;
}

const MODE_NAMES = { 2: '일반', 3: '랭크', 6: '코발트' };

function fmtElapsed(sec) {
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return m > 0 ? `${m}분 ${s}초` : `${s}초`;
}

// ---------- 복수의 사슬 ----------
async function buildChain(startNick, gameId, meta, myPlayTime) {
  const steps = [];
  let nick = startNick;
  let prevTime = myPlayTime || 0;
  for (let depth = 0; depth < 8; depth++) {
    const m = await findGameRecord(nick, gameId);
    if (!m) {
      steps.push({ nickname: nick, missing: true });
      break;
    }
    const c = meta.charById.get(m.characterNum);
    const deaths = extractDeaths(m, meta);
    const final = deaths.length ? deaths[deaths.length - 1] : null;
    const step = {
      nickname: m.nickname || nick,
      characterName: c ? c.name : '?',
      characterKey: c ? c.key : null,
      gameRank: m.gameRank,
      playTime: m.playTime,
      deltaSec: Math.max(0, (m.playTime || 0) - prevTime),
      playerKill: m.playerKill,
      death: null,
      won: m.gameRank === 1,
    };
    if (m.gameRank !== 1 && final) step.death = final;
    steps.push(step);
    if (m.gameRank === 1 || !final) break;             // 우승 또는 생존 기록
    if (final.kind !== 'player' || !final.byNickname) break; // 야생동물·금지구역이 종결
    prevTime = m.playTime || prevTime;
    nick = final.byNickname;
  }
  return steps;
}

function chainVerdict(steps, myDeath) {
  if (!steps.length || steps[0].missing) return { tone: 'unknown', text: '관측 실패 — 대상의 기록에 접근할 수 없습니다.' };
  const first = steps[0];
  if (first.won) {
    return { tone: 'humiliation', text: '굴욕 판정 — 당신의 원수는 그 판의 최종 우승자입니다. 좋은 발판이 되셨군요.' };
  }
  const d = first.death;
  const t = fmtElapsed(first.deltaSec);
  if (d && d.kind !== 'player') {
    const executor = d.byCharName;
    return { tone: 'karma', text: `인과응보 성립 — 당신의 복수는 ${t} 후 ${executor}${d.kind === 'zone' || d.kind === 'battleZone' ? '이' : '가'} 대신 집행했습니다.` };
  }
  if (first.deltaSec <= 90) {
    return { tone: 'karma', text: `즉각 응징 — 당신이 쓰러진 지 ${t} 만에 ${d ? d.byNickname : '누군가'}가 처형을 집행했습니다.` };
  }
  return { tone: 'karma', text: `인과응보 성립 — ${t} 후, ${d ? `${d.placeName || '불상의 장소'}에서 ${d.byNickname}` : '불상의 인물'}가 대신 처형했습니다.` };
}

// ---------- 근황 판정 ----------
function fateReport(afterGames, lastSeenMs) {
  const n = afterGames.length;
  if (!n) return { tone: 'silent', text: '그날 이후 실험 참가 기록이 없습니다 — 죄책감으로 추정됩니다.', total: 0 };
  const total = afterGames.reduce((s, g) => s + (g.mmrGain || 0), 0);
  const bad = afterGames.filter(g => g.gameRank >= 7).length;
  let worstStreak = 0, cur = 0;
  for (const g of afterGames) {
    if ((g.mmrGain || 0) < 0) { cur++; worstStreak = Math.max(worstStreak, cur); } else cur = 0;
  }
  let tone, text;
  if (total <= -80) { tone = 'karma'; text = `천벌 집행 완료 — 이후 ${n}판 동안 MMR ${total}. 하늘은 보고 있었습니다.`; }
  else if (total < 0) { tone = 'karma'; text = `천벌 진행 중 — 이후 ${n}판 누적 MMR ${total}. 심판은 계속됩니다.`; }
  else if (total <= 40) { tone = 'hold', text = `심판 보류 — 이후 ${n}판 누적 MMR +${total}. 하늘이 간을 보는 중입니다.`; }
  else { tone = 'thriving'; text = `하늘도 무심하시지 — 이후 ${n}판 누적 MMR +${total}. 원수는 승승장구 중입니다.`; }
  const notes = [];
  if (worstStreak >= 3) notes.push(`최대 ${worstStreak}연속 하락`);
  if (bad > 0) notes.push(`7위 이하 광탈 ${bad}회`);
  if (lastSeenMs) {
    const h = Math.floor((Date.now() - lastSeenMs) / 3600000);
    notes.push(h < 1 ? '마지막 관측: 1시간 이내 (현재 활동 중 추정)' : h < 24 ? `마지막 관측: ${h}시간 전` : `마지막 관측: ${Math.floor(h / 24)}일 전`);
  }
  return { tone, text, total, notes };
}

// ---------- API ----------
// 내 킬러 집계
async function buildKillers(name) {
  const meta = await getMeta();
  const enc = encodeURIComponent(name);
  const profile = await dakJson(`/players/${enc}/profile`, 10 * 60 * 1000); // 닉네임 검증
  const matches = await getMatches(name, 3);
  const byNick = new Map();
  let beastDeaths = 0, zoneDeaths = 0;
  for (const m of matches) {
    const c = meta.charById.get(m.characterNum);
    for (const d of extractDeaths(m, meta)) {
      if (d.kind === 'player' && d.byNickname) {
        let e = byNick.get(d.byNickname);
        if (!e) { e = { nickname: d.byNickname, count: 0, last: null }; byNick.set(d.byNickname, e); }
        e.count++;
        if (!e.last || m.gameId > e.last.gameId) {
          e.last = {
            gameId: m.gameId, startDtm: m.startDtm,
            myCharacterName: c ? c.name : '?',
            byCharName: d.byCharName, byCharKey: d.byCharKey,
            cause: d.cause, placeName: d.placeName,
            modeName: MODE_NAMES[m.matchingMode] || '기타',
          };
        }
      } else if (d.kind === 'wildAnimal' || d.kind === 'monster') beastDeaths++;
      else zoneDeaths++;
    }
  }
  const killers = [...byNick.values()]
    .sort((a, b) => b.count - a.count || b.last.gameId - a.last.gameId)
    .slice(0, 12);
  if (!killers.length) {
    const e = new Error(matches.length
      ? `'${profile.player.name}'님의 최근 랭크 ${matches.length}판에서 플레이어에게 처형당한 기록이 없습니다.`
      : `'${profile.player.name}'님의 이번 시즌 랭크 기록이 없습니다. 원수는 랭크에서만 생깁니다.`);
    e.status = 404;
    throw e;
  }
  return { me: profile.player.name, scanned: matches.length, killers, beastDeaths, zoneDeaths };
}

// 관측
async function buildObservation(enemy, me, gameId) {
  const meta = await getMeta();
  const enc = encodeURIComponent(enemy);
  const profile = await dakJson(`/players/${enc}/profile`, 10 * 60 * 1000);
  const bucket = (profile.playerSeasonOverviews || []).find(o => o.matchingModeId === 0 && o.teamModeId === 0) || {};
  const matches = (await getMatches(enemy, 2)).sort((a, b) => a.gameId - b.gameId);

  // 대상 프로필 카드
  const lastMatch = matches[matches.length - 1];
  const lastChar = lastMatch ? meta.charById.get(lastMatch.characterNum) : null;
  const target = {
    nickname: profile.player.name,
    accountLevel: profile.player.accountLevel,
    characterKey: lastChar ? lastChar.key : null,
    characterName: lastChar ? lastChar.name : null,
    mmr: bucket.mmr || null,
    seasonPlays: bucket.play || 0,
    seasonKills: bucket.playerKill || 0,
  };

  // 복수의 사슬 (내 사망 판이 지정된 경우)
  let chain = null, myDeath = null, verdict = null;
  if (gameId && me) {
    const myRec = await findGameRecord(me, gameId);
    if (myRec) {
      const myDeaths = extractDeaths(myRec, meta);
      const final = myDeaths.length ? myDeaths[myDeaths.length - 1] : null;
      const myChar = meta.charById.get(myRec.characterNum);
      myDeath = final ? {
        me, characterName: myChar ? myChar.name : '?',
        characterKey: myChar ? myChar.key : null,
        gameRank: myRec.gameRank, playTime: myRec.playTime,
        startDtm: myRec.startDtm,
        cause: final.cause, placeName: final.placeName, byNickname: final.byNickname,
      } : null;
      chain = await buildChain(enemy, gameId, meta, myRec.playTime || 0);
      verdict = chainVerdict(chain, myDeath);
    }
  }

  // 근황: 기준 게임 이후 랭크 기록 (기준 없으면 최근 12판)
  const pool = gameId ? matches.filter(m => m.gameId > gameId) : matches.slice(-12);
  let cum = 0;
  const afterGames = pool.slice(0, 20).map(m => {
    cum += m.mmrGain || 0;
    const c = meta.charById.get(m.characterNum);
    return {
      gameId: m.gameId, startDtm: m.startDtm, gameRank: m.gameRank,
      mmrGain: m.mmrGain || 0, cum,
      characterName: c ? c.name : '?',
      modeName: MODE_NAMES[m.matchingMode] || '기타',
      died: extractDeaths(m, meta).length > 0 && m.gameRank !== 1,
    };
  });
  const lastSeenMs = lastMatch ? new Date(lastMatch.startDtm).getTime() + (lastMatch.duration || 0) * 1000 : null;
  const fate = fateReport(afterGames, lastSeenMs);
  // 그날 이후 랭크 기록이 없으면, 다른 모드로 도피했는지까지 확인
  if (!afterGames.length && gameId) {
    try {
      const others = (await getMatchesPage(enemy, 1, null)).filter(m => m.gameId > gameId && m.matchingMode !== 3);
      if (others.length) {
        fate.tone = 'hiding';
        fate.text = `MMR 변동 관측 불가 — 그날 이후 랭크 참가 기록이 없습니다. 일반·코발트로 도피 중인 것으로 확인됐습니다 (${others.length}판 목격).`;
      }
    } catch (e) { /* 확인 실패 시 기본 잠적 판정 유지 */ }
  }

  return { target, myDeath, chain, verdict, afterGames, fate, baseline: gameId || null };
}

// ---------- 이미지 프록시 ----------
async function proxyImage(url, res) {
  const key = 'img:' + url;
  let buf = cacheGet(key);
  if (!buf) {
    const r = await fetch(url, { headers: { Referer: 'https://dak.gg/' } });
    if (!r.ok) { res.writeHead(502); res.end('image fetch failed'); return; }
    buf = Buffer.from(await r.arrayBuffer());
    cacheSet(key, buf, META_TTL);
  }
  res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
  res.end(buf);
}

// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2' };

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (url.pathname === '/api/killers') {
      const name = (url.searchParams.get('name') || '').trim();
      if (!name) return sendJson(res, 400, { error: '닉네임을 입력하세요.' });
      return sendJson(res, 200, await buildKillers(name));
    }
    if (url.pathname === '/api/observe') {
      const enemy = (url.searchParams.get('enemy') || '').trim();
      const me = (url.searchParams.get('me') || '').trim() || null;
      const gameId = parseInt(url.searchParams.get('gameId'), 10) || null;
      if (!enemy) return sendJson(res, 400, { error: '원수의 닉네임을 입력하세요.' });
      return sendJson(res, 200, await buildObservation(enemy, me, gameId));
    }
    if (url.pathname.startsWith('/img/char/')) {
      const key = url.pathname.split('/').pop().replace(/[^A-Za-z0-9]/g, '');
      const meta = await getMeta();
      const c = meta.charByKey.get(key.toLowerCase());
      if (!c) { res.writeHead(404); return res.end('not found'); }
      return await proxyImage(c.imageUrl, res);
    }
    // 정적 파일
    let file = url.pathname === '/' ? '/index.html' : url.pathname;
    file = path.normalize(file).replace(/^(\.\.[/\\])+/, '');
    const full = path.join(__dirname, 'public', file);
    if (full.startsWith(path.join(__dirname, 'public')) && fs.existsSync(full) && fs.statSync(full).isFile()) {
      const ext = path.extname(full);
      const cacheControl = ['.woff', '.woff2', '.png', '.svg'].includes(ext)
        ? 'public, max-age=604800' : 'no-cache';
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': cacheControl });
      return res.end(fs.readFileSync(full));
    }
    res.writeHead(404); res.end('not found');
  } catch (e) {
    const code = e.status === 404 ? 404 : (e.status === 400 ? 400 : 502);
    const msg = e.status === 404
      ? (String(e.message).includes('기록') ? e.message : '플레이어를 찾을 수 없습니다. 닉네임을 확인해주세요.')
      : String(e.message || e);
    sendJson(res, code, { error: msg });
  }
});

server.listen(PORT, () => console.log(`er-enemy listening on http://localhost:${PORT}`));
