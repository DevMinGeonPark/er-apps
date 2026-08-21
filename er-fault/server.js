// 루미아 손해보험 — "누가 범인인가!" 과실비율 산정 서버
// dak.gg 매치 목록을 팀원 닉네임끼리 gameId로 조인해 패배(사고)의 과실을 산정한다.
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
  if (cache.size > 400) {
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

const META_TTL = 6 * 3600 * 1000;
async function getCharacters() {
  const d = await dakJson('/data/characters?hl=ko', META_TTL);
  return d.characters.map(c => ({
    id: c.id, key: c.key, name: c.name, imageUrl: 'https:' + c.imageUrl,
    archeTypes: (c.charArcheTypes || []).filter(a => a && a !== 'None'),
  }));
}
const ROLE_KO = { Tanker: '탱커', Supporter: '서포터', Assasin: '암살자', Warrior: '전사', Mage: '스킬러', Marksman: '사수' };
async function getSeasons() {
  const d = await dakJson('/data/seasons?hl=ko', META_TTL);
  return d.seasons;
}

// ---------- 매치 수집 ----------
async function fetchMatches(name, seasonKey, pages) {
  const enc = encodeURIComponent(name);
  const all = [];
  for (let p = 1; p <= pages; p++) {
    const d = await dakJson(`/players/${enc}/matches?season=${seasonKey}&page=${p}`, 10 * 60 * 1000);
    const ms = d.matches || [];
    all.push(...ms);
    if (ms.length < 20) break; // 마지막 페이지
  }
  return all;
}

// ---------- 과실 산정 ----------
// 순 RP 증감 = 게임 내 획득 RP + 입장료(음수)
function netRp(m) {
  if (typeof m.mmrGainInGame !== 'number' || typeof m.mmrLossEntryCost !== 'number') return null;
  return m.mmrGainInGame + m.mmrLossEntryCost;
}
// 사고 판정 (개정): 랭크는 팀원 중 1명이라도 음전이면 사고(전원 양전 = 무사고),
// 일반은 4위 이하, 코발트는 패배(2위)
function isAccident(rows) {
  const m = rows[0];
  if (m.matchingMode === 6) return m.gameRank >= 2;
  if (m.matchingMode === 3) {
    const nets = rows.map(netRp);
    if (nets.every(v => v !== null)) return nets.some(v => v < 0);
  }
  return m.gameRank >= 4;
}
function severity(m) {
  if (m.matchingMode === 6) return '패배';
  if (m.gameRank >= 8) return '전손';
  if (m.gameRank >= 6) return '중대';
  return '경미';
}

// 한 사고(게임)에서 팀원별 과실 항목 산출. rows = 같은 팀 팀원들의 각자 매치 레코드.
// roles[i] = 해당 판 캐릭터의 주 직군 (Tanker/Supporter/… , 없으면 null)
function assessGame(rows, roles) {
  roles = roles || rows.map(() => null);
  const n = rows.length;
  const items = rows.map(() => []);
  const add = (i, pts, clause, desc) => items[i].push({ pts, clause, desc });

  const dmg = rows.map(r => r.damageToPlayer || 0);
  const dmgSum = dmg.reduce((a, b) => a + b, 0) || 1;
  const dmgTaken = rows.map(r => r.damageFromPlayer || 0);
  const support = rows.map(r => (r.healAmount || 0) + (r.protectAbsorb || 0));
  const play = rows.map(r => r.playTime || 0);
  const maxPlay = Math.max(...play);
  const deaths = rows.map(r => r.playerDeaths || 0);
  const maxDeaths = Math.max(...deaths);
  const teamKill = Math.max(rows[0].teamKill || 0, 1);
  const revived = rows.map(r => r.creditRevivedOthersCount || 0);

  rows.forEach((r, i) => {
    const isTank = roles[i] === 'Tanker';
    const isSup = roles[i] === 'Supporter';
    const isMark = roles[i] === 'Marksman';

    // 제3조 — 조기 이탈(선사망): 팀 최장 생존 대비 20% 이상 일찍 사망
    // 통념 반영: 탱커의 선사망은 이니시에이팅의 일부(참작), 사수는 후방 포지션이라 가중
    if (maxPlay > 0 && play[i] < maxPlay * 0.8 && play[i] === Math.min(...play)) {
      const gapPct = Math.round((1 - play[i] / maxPlay) * 100);
      if (isTank) add(i, 13, '제3조 1항', `선(先)사망 — ${gapPct}% 조기 이탈 (탱커 이니시 참작 −9)`);
      else if (isMark) add(i, 26, '제3조 1항', `선(先)사망 — ${gapPct}% 조기 이탈 (사수 후방 포지션 가중 +4)`);
      else add(i, 22, '제3조 1항', `선(先)사망 — 팀 최장 생존 대비 ${gapPct}% 조기 이탈`);
    }
    // 제3조 2항 — 1페이즈 사망
    if ((r.deathsPhaseOne || 0) > 0) add(i, 14, '제3조 2항', `1페이즈 사망 — ${r.deathsPhaseOne}회 무리한 초반 교전`);
    // 제4조 — 화력 의무: 딜 지분 미달. 탱커·서포터는 통념상 기준 완화(지분 기준 절반·벌점 절반)
    const share = dmg[i] / dmgSum;
    const fair = 1 / n;
    const dmgExempt = isTank || isSup;
    const threshold = dmgExempt ? fair * 0.35 : fair * 0.67;
    if (share < threshold) {
      const pts = Math.min(dmgExempt ? 12 : 24, Math.round((fair - share) * 100 * (dmgExempt ? 0.65 : 1.3)));
      add(i, pts, '제4조 1항',
        `화력 의무 위반 — 대미지 지분 ${Math.round(share * 100)}%${dmgExempt ? ` (${ROLE_KO[roles[i]]} 직군 참작)` : ` (기준 ${Math.round(fair * 100)}%)`}`);
    }
    // 제4조 2항 — 킬 관여율 저조 (서포터는 기준 완화)
    const kp = ((r.playerKill || 0) + (r.playerAssistant || 0)) / teamKill;
    if (kp < (isSup ? 0.22 : 0.34) && teamKill >= 3) add(i, 9, '제4조 2항', `킬 관여 저조 — 관여율 ${Math.round(kp * 100)}%`);
    // 제4조 3항 — 직군 의무: 탱커는 몸받기, 서포터는 힐·보호막
    if (isTank) {
      const takenSum = dmgTaken.reduce((a, b) => a + b, 0) || 1;
      const tShare = dmgTaken[i] / takenSum;
      if (dmgTaken[i] === Math.max(...dmgTaken) && n > 1 && dmgTaken[i] > 0) {
        add(i, -8, '감경 4호', '성실 탱킹 — 팀 내 최다 피해 흡수');
      } else if (tShare < fair * 0.6) {
        add(i, 10, '제4조 3항', `탱킹 의무 위반 — 받은 피해 지분 ${Math.round(tShare * 100)}% (몸을 아낌)`);
      }
    }
    if (isSup) {
      if (support[i] > 0 && support[i] === Math.max(...support)) {
        add(i, -8, '감경 5호', `지원 성실 — 힐·보호막 ${support[i].toLocaleString('ko-KR')}`);
      } else if (support[i] < 1500) {
        add(i, 10, '제4조 4항', '지원 의무 위반 — 힐·보호막 실적 미미');
      }
    }
    // CC 기여 감경 (직군 무관, 팀 1위 & 유의미)
    const cc = rows.map(x => x.ccTimeToPlayer || 0);
    if ((r.ccTimeToPlayer || 0) > 0 && r.ccTimeToPlayer === Math.max(...cc) && r.ccTimeToPlayer >= 8 && n > 1) {
      add(i, -5, '감경 6호', `군중 제어 기여 — CC ${Math.round(r.ccTimeToPlayer)}초`);
    }
    // 제5조 — 반복 다운
    if (deaths[i] === maxDeaths && deaths[i] >= 2 && rows.some((_, j) => j !== i && deaths[j] < deaths[i])) {
      add(i, 10, '제5조', `반복 다운 — 팀 내 최다 ${deaths[i]}회`);
    }
    // 제6조 — 구호 의무: 남은 살렸는데 본인은 0회
    if (revived[i] === 0 && revived.some(v => v > 0)) add(i, 8, '제6조', '구호 의무 소홀 — 팀원 부활 0회');
    // 제7조 — 현장 이탈(뺑소니)
    if (r.giveUp) add(i, 35, '제7조 1항', '기권 — 사고 현장 이탈(뺑소니)');
    if (r.isLeavingBeforeCreditRevivalTerminate || r.IsLeavingBeforeCreditRevivalTerminate) {
      add(i, 35, '제7조 2항', '부활 가능 시간 내 탈주');
    }
    // 제11조 — 티어별 주의 의무 (랭크 한정): 팀 평균 RP 대비 격차로 책임 가중·참작
    if (r.matchingMode === 3) {
      const rps = rows.map(x => x.rankPoint || 0);
      if (rps.every(v => v > 0) && n > 1) {
        const avg = rps.reduce((a, b) => a + b, 0) / n;
        const diff = Math.round(rps[i] - avg);
        if (diff >= 150) add(i, Math.min(10, Math.round(diff / 60)), '제11조', `고티어 주의 의무 — 팀 평균 대비 RP +${diff}`);
        else if (diff <= -150) add(i, -Math.min(8, Math.round(-diff / 70)), '감경 7호', `저티어 정상 참작 — 팀 평균 대비 RP ${diff}`);
      }
    }
    // 제12조 — 시야 의무: 감시 장비(감시·망원 카메라) 설치 0대 (스쿼드 한정)
    if (r.matchingMode !== 6 && ((r.addSurveillanceCamera || 0) + (r.addTelephotoCamera || 0)) === 0) {
      add(i, 6, '제12조', '시야 의무 위반 — 감시 장비 설치 0대');
    }
    // 제13조 — 태도 조항: 이모티콘 과다 (15회 이상 & 팀 내 최다)
    const emos = rows.map(x => x.useEmoticonCount || 0);
    if ((r.useEmoticonCount || 0) >= 15 && r.useEmoticonCount === Math.max(...emos) && n > 1) {
      add(i, 3, '제13조', `이모티콘 과다 사용 ${r.useEmoticonCount}회 — 반성 태도 불량`);
    }
    // 감경 사유
    if (dmg[i] === Math.max(...dmg) && n > 1) add(i, -10, '감경 1호', '팀 내 최대 화력 — 성실 교전 인정');
    if (revived[i] > 0) add(i, -8, '감경 2호', `팀원 구호 ${revived[i]}회 — 구호 조치 인정`);
    if ((r.clutchCount || 0) > 0) add(i, -6, '감경 3호', `클러치 ${r.clutchCount}회`);
  });

  // 점수 → 100% 정규화 (기본 균등 배분에서 벌점/감점으로 이동)
  const base = 100 / n;
  let scores = rows.map((_, i) => base + items[i].reduce((a, b) => a + b.pts, 0));
  scores = scores.map(s => Math.max(s, 3));
  const sum = scores.reduce((a, b) => a + b, 0);
  const fault = scores.map(s => s / sum * 100);
  return { fault, items };
}

async function assess(names, seasonKey, pages, modeFilter, demo) {
  const characters = await getCharacters();
  const charById = new Map(characters.map(c => [c.id, c]));

  const lists = [];
  if (demo) {
    // 데모: 실제 매치 목록 하나를 복제해 파이프라인·렌더 검증용으로 사용
    const base = await fetchMatches(demo, seasonKey, pages);
    for (let i = 0; i < names.length; i++) lists.push(base);
  } else {
    for (const name of names) lists.push(await fetchMatches(name, seasonKey, pages));
  }

  // gameId → 각자 레코드 조인 (같은 팀만)
  const byGame = new Map();
  lists.forEach((ms, pi) => {
    for (const m of ms) {
      if (!byGame.has(m.gameId)) byGame.set(m.gameId, []);
      byGame.get(m.gameId)[pi] = m;
    }
  });

  const shared = [];
  for (const [gameId, sparse] of byGame) {
    // 희소 배열 주의: some/every는 빈 슬롯을 건너뛰므로 인덱스로 직접 검사
    const rows = Array.from({ length: names.length }, (_, i) => sparse[i]);
    if (rows.some(r => !r)) continue;
    const team = rows[0].teamNumber;
    if (!rows.every(r => r.teamNumber === team)) continue; // 같은 게임이라도 다른 팀이면 제외
    const m = rows[0];
    if (modeFilter === 'squad' && m.matchingMode === 6) continue;
    if (modeFilter === 'cobalt' && m.matchingMode !== 6) continue;
    shared.push({ gameId, rows });
  }
  shared.sort((a, b) => (b.rows[0].startDtm || '').localeCompare(a.rows[0].startDtm || ''));

  const accidents = [];
  const totalFault = names.map(() => 0);
  const clauseTally = names.map(() => new Map());

  for (const g of shared) {
    if (!isAccident(g.rows)) continue;
    const roles = g.rows.map(r => charById.get(r.characterNum)?.archeTypes?.[0] || null);
    const { fault, items } = assessGame(g.rows, roles);
    fault.forEach((f, i) => totalFault[i] += f);
    items.forEach((its, i) => its.forEach(it => {
      if (it.pts <= 0) return;
      const k = it.clause + '|' + it.desc.split(' — ')[0];
      const cur = clauseTally[i].get(k) || { clause: it.clause, label: it.desc.split(' — ')[0], count: 0, pts: 0 };
      cur.count++; cur.pts += it.pts;
      clauseTally[i].set(k, cur);
    }));
    const m0 = g.rows[0];
    accidents.push({
      gameId: g.gameId,
      startDtm: m0.startDtm,
      mode: m0.matchingMode === 6 ? '코발트' : (m0.matchingMode === 3 ? '랭크' : '일반'),
      rank: m0.gameRank,
      rpDelta: netRp(m0),
      severity: severity(m0),
      fault: fault.map(f => Math.round(f)),
      culprit: fault.indexOf(Math.max(...fault)),
      players: g.rows.map((r, i) => ({
        name: names[i],
        character: charById.get(r.characterNum)?.name || '?',
        charKey: charById.get(r.characterNum)?.key || null,
        role: ROLE_KO[roles[i]] || null,
        damage: r.damageToPlayer || 0,
        kill: r.playerKill || 0,
        assist: r.playerAssistant || 0,
        deaths: r.playerDeaths || 0,
        playTime: r.playTime || 0,
        giveUp: !!r.giveUp,
      })),
      items, // 벌점(+)과 감경(−) 전부 — 판별 상세 화면용
    });
  }

  const nAcc = accidents.length;
  const finalFault = nAcc ? totalFault.map(f => f / nAcc) : names.map(() => 100 / names.length);
  // 반올림 후 합계 100 보정
  let rounded = finalFault.map(f => Math.round(f));
  const diff = 100 - rounded.reduce((a, b) => a + b, 0);
  rounded[rounded.indexOf(Math.max(...rounded))] += diff;

  const culpritIdx = rounded.indexOf(Math.max(...rounded));
  const accidentRate = shared.length ? nAcc / shared.length : 0;
  // 할인할증 등급 패러디 (사고율 기반, 1Z=최우량 ~ 29Z=최악)
  const grade = Math.min(29, Math.max(1, Math.round(accidentRate * 28) + 1));

  // 플레이어별 대표 캐릭터 (사고 게임 기준 최빈)
  const mainChar = names.map((_, i) => {
    const cnt = new Map();
    for (const a of accidents) {
      const c = a.players[i];
      cnt.set(c.charKey, (cnt.get(c.charKey) || 0) + 1);
    }
    let best = null, bn = 0;
    for (const [k, v] of cnt) if (v > bn) { best = k; bn = v; }
    const found = characters.find(c => c.key === best);
    return { key: best, name: found?.name || '—', role: ROLE_KO[found?.archeTypes?.[0]] || null };
  });

  return {
    names,
    seasonKey,
    sharedGames: shared.length,
    accidents: accidents.slice(0, 30),
    accidentCount: nAcc,
    accidentRate: +(accidentRate * 100).toFixed(1),
    fault: rounded,
    culpritIdx,
    grade,
    mainChar,
    reasons: clauseTally.map(m => [...m.values()].sort((a, b) => b.pts - a.pts).slice(0, 4)),
    docNo: `LMI-${new Date().getFullYear()}-${String(Math.abs(hashCode(names.join('|'))) % 100000).padStart(5, '0')}`,
    issuedAt: Date.now(),
  };
}
function hashCode(s) { let h = 0; for (const c of s) h = (h * 31 + c.codePointAt(0)) | 0; return h; }

// ---------- 이미지 프록시 ----------
async function proxyImage(url, res) {
  const key = 'img:' + url;
  let buf = cacheGet(key);
  if (!buf) {
    const r = await fetch(url, { headers: { Referer: 'https://dak.gg/' } });
    if (!r.ok) { res.writeHead(502); return res.end('image fetch failed'); }
    buf = Buffer.from(await r.arrayBuffer());
    cacheSet(key, buf, META_TTL);
  }
  res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
  res.end(buf);
}

// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff': 'font/woff' };
function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (url.pathname === '/api/seasons') {
      const seasons = await getSeasons();
      return sendJson(res, 200, seasons.filter(s => s.id >= 18 || s.id === 0).map(s => ({ key: s.key, name: s.name })).reverse());
    }
    if (url.pathname === '/api/assess') {
      const me = (url.searchParams.get('me') || '').trim();
      const mates = (url.searchParams.get('mates') || '').split(',').map(s => s.trim()).filter(Boolean);
      const season = url.searchParams.get('season') || 'auto';
      const pages = Math.min(parseInt(url.searchParams.get('pages'), 10) || 3, 5);
      const mode = url.searchParams.get('mode') || 'all';
      const demo = (url.searchParams.get('demo') || '').trim() || null;
      if (!me || !mates.length) return sendJson(res, 400, { error: '본인과 팀원 닉네임을 입력하세요.' });
      const names = [me, ...mates].slice(0, 3);
      if (!demo && new Set(names.map(n => n.toLowerCase())).size !== names.length) {
        return sendJson(res, 400, { error: '같은 닉네임이 중복 입력되었습니다.' });
      }
      let result;
      if (season === 'auto') {
        // 최근 시즌부터 함께한 기록이 있는 시즌을 자동 탐색
        const seasons = await getSeasons();
        const candidates = seasons.filter(s => s.id >= 18).sort((a, b) => b.id - a.id).slice(0, 4).map(s => s.key);
        for (const key of candidates) {
          result = await assess(names, key, pages, mode, demo);
          if (result.sharedGames > 0) break;
        }
      } else {
        result = await assess(names, season, pages, mode, demo);
      }
      if (!result || !result.sharedGames) return sendJson(res, 404, { error: '최근 시즌에서 함께한 게임을 찾지 못했습니다. 닉네임을 확인하거나 시즌을 직접 선택해보세요.' });
      if (!result.accidentCount) return sendJson(res, 200, { ...result, noAccident: true });
      return sendJson(res, 200, result);
    }
    if (url.pathname.startsWith('/img/char/')) {
      const key = url.pathname.split('/').pop().replace(/[^A-Za-z0-9]/g, '');
      const chars = await getCharacters();
      const c = chars.find(x => x.key === key);
      if (!c) { res.writeHead(404); return res.end('not found'); }
      return await proxyImage(c.imageUrl, res);
    }
    let file = url.pathname === '/' ? '/index.html' : url.pathname;
    file = path.normalize(file).replace(/^(\.\.[/\\])+/, '');
    const full = path.join(__dirname, 'public', file);
    if (full.startsWith(path.join(__dirname, 'public')) && fs.existsSync(full) && fs.statSync(full).isFile()) {
      const ext = path.extname(full);
      const cacheControl = ['.woff', '.png', '.svg'].includes(ext) ? 'public, max-age=604800' : 'no-cache';
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': cacheControl });
      return res.end(fs.readFileSync(full));
    }
    res.writeHead(404); res.end('not found');
  } catch (e) {
    // 502/504는 Cloudflare가 자체 HTML 에러 페이지로 대체하므로 500 사용
    const code = e.status === 404 ? 404 : 500;
    const msg = e.status === 404 ? '플레이어를 찾을 수 없습니다. 닉네임을 확인해주세요.' : String(e.message || e);
    sendJson(res, code, { error: msg });
  }
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`er-fault listening on http://localhost:${PORT}`));
}
module.exports = { assessGame }; // 단위 테스트용
