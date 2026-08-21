// ER 자격증 발급 서버 — dak.gg(er.dakgg.io) 데이터 기반, 의존성 없음 (Node 18+)
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3620;
const DAK = 'https://er.dakgg.io/api/v1';
const HEADERS = {
  'Accept': 'application/json',
  'Referer': 'https://dak.gg/',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
};

// ---------- 캐시 ----------
const cache = new Map(); // key -> { at, ttl, value }
function cacheGet(key) {
  const e = cache.get(key);
  if (!e) return null;
  if (Date.now() - e.at > e.ttl) { cache.delete(key); return null; }
  return e.value;
}
function cacheSet(key, value, ttl) {
  cache.set(key, { at: Date.now(), ttl, value });
  if (cache.size > 500) { // 오래된 항목 정리
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
async function getSeasons() {
  const d = await dakJson('/data/seasons?hl=ko', META_TTL);
  return d.seasons;
}
async function getCharacters() {
  const d = await dakJson('/data/characters?hl=ko', META_TTL);
  return d.characters.map(c => ({
    id: c.id, key: c.key, name: c.name, imageUrl: 'https:' + c.imageUrl,
    masteries: c.masteries || [],
    archeTypes: (c.charArcheTypes || []).filter(a => a && a !== 'None'),
    skins: (c.skins || []).map(s => ({
      id: s.id, name: s.name, grade: s.grade, imageName: s.imageName,
      // CharResult(전신) URL을 CharProfile(초상)로 바꿔 증명사진용으로 사용
      profileUrl: ('https:' + s.imageUrl).replace('CharResult_', 'CharProfile_'),
    })),
  }));
}

// ---------- 집계 ----------
const STAT_FIELDS = [
  'play', 'win', 'top2', 'top3', 'place', 'playerKill', 'playerAssistant',
  'teamKill', 'monsterKill', 'damageToPlayer', 'damageToMonster',
  'playTime', 'playerDeaths', 'mmrGain', 'totalGainVFCredit',
];

function pickAllBucket(overviews) {
  // matchingModeId 0 + teamModeId 0 = 랭크·일반·코발트 전부 합산 버킷
  return (overviews || []).find(o => o.matchingModeId === 0 && o.teamModeId === 0) || null;
}

async function buildCertificate(name, characterId) {
  const enc = encodeURIComponent(name);
  const [seasons, characters, profile] = await Promise.all([
    getSeasons(),
    getCharacters(),
    dakJson(`/players/${enc}/profile`, 10 * 60 * 1000),
  ]);
  const character = characters.find(c => c.id === characterId);
  if (!character) { const e = new Error('unknown character'); e.status = 400; throw e; }

  const seasonById = new Map(seasons.map(s => [s.id, s]));
  const playedIds = (profile.playerSeasons || []).map(s => s.seasonId)
    .filter(id => seasonById.has(id));

  // 시즌별 프로필을 병렬(4개씩)로 수집
  const results = [];
  const queue = [...playedIds];
  const currentSeasonKey = profile.meta && profile.meta.season;
  async function worker() {
    while (queue.length) {
      const id = queue.shift();
      const key = seasonById.get(id).key;
      try {
        const p = (key === currentSeasonKey)
          ? profile
          : await dakJson(`/players/${enc}/profile?season=${key}`, 10 * 60 * 1000);
        results.push({ seasonId: id, profile: p });
      } catch (e) {
        results.push({ seasonId: id, error: String(e) });
      }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);

  // 캐릭터 스탯 + 전체 스탯 합산
  const zero = () => Object.fromEntries(STAT_FIELDS.map(f => [f, 0]));
  const charTotal = zero();
  const overallTotal = zero();
  const perSeason = [];
  let bestMmr = null;
  // 모드별(랭크/일반/코발트) 캐릭터 스탯 — teamModeId 0 = 팀 규모 통합, 코발트는 (6,4)만 존재
  const MODE_BUCKETS = { rank: 3, normal: 2, cobalt: 6 };
  const modeTotals = { rank: zero(), normal: zero(), cobalt: zero() };

  for (const r of results) {
    if (r.error) continue;
    const season = seasonById.get(r.seasonId);
    const bucket = pickAllBucket(r.profile.playerSeasonOverviews);
    if (!bucket) continue;
    for (const f of STAT_FIELDS) overallTotal[f] += bucket[f] || 0;
    if (bucket.mmr && (!bestMmr || bucket.mmr > bestMmr.mmr)) bestMmr = { mmr: bucket.mmr, season: season.name };

    for (const [mk, mid] of Object.entries(MODE_BUCKETS)) {
      const mb = (r.profile.playerSeasonOverviews || []).find(o =>
        o.matchingModeId === mid && (mid === 6 || o.teamModeId === 0));
      const mcs = mb && (mb.characterStats || []).find(c => c.key === characterId);
      if (!mcs) continue;
      for (const f of STAT_FIELDS) modeTotals[mk][f] += mcs[f] || 0;
    }

    const cs = (bucket.characterStats || []).find(c => c.key === characterId);
    if (!cs) continue;
    for (const f of STAT_FIELDS) charTotal[f] += cs[f] || 0;
    perSeason.push({
      seasonId: r.seasonId,
      seasonName: season.name,
      play: cs.play || 0,
      win: cs.win || 0,
      top3: cs.top3 || 0,
      damageToPlayer: cs.damageToPlayer || 0,
      playerKill: cs.playerKill || 0,
    });
  }
  perSeason.sort((a, b) => b.seasonId - a.seasonId);

  const derive = (t) => {
    const play = t.play || 0;
    return {
      ...t,
      winRate: play ? +(t.win / play * 100).toFixed(1) : 0,
      top3Rate: play ? +(t.top3 / play * 100).toFixed(1) : 0,
      avgKill: play ? +(t.playerKill / play).toFixed(2) : 0,
      avgAssist: play ? +(t.playerAssistant / play).toFixed(2) : 0,
      avgDamage: play ? Math.round(t.damageToPlayer / play) : 0,
      avgPlace: play ? +(t.place / play).toFixed(1) : 0,
      playHours: +(t.playTime / 3600).toFixed(1),
    };
  };
  const charStats = derive(charTotal);
  const overallStats = derive(overallTotal);
  const modeStats = {
    rank: derive(modeTotals.rank),
    normal: derive(modeTotals.normal),
    cobalt: derive(modeTotals.cobalt),
  };

  // ---------- 등급 산정 (재미용) ----------
  const score = Math.round(
    Math.min(charStats.play, 2000) / 2000 * 60 +
    Math.min(charStats.winRate, 25) / 25 * 25 +
    Math.min(charStats.top3Rate, 60) / 60 * 15
  );
  const GRADES = [
    [95, '명장', 'MASTER ARTISAN'],
    [85, '기능장', 'MASTER CRAFTSMAN'],
    [70, '기사 1급', 'ENGINEER · CLASS 1'],
    [55, '기사 2급', 'ENGINEER · CLASS 2'],
    [40, '산업기사', 'INDUSTRIAL ENGINEER'],
    [20, '기능사', 'CRAFTSMAN'],
    [0, '수습 실험체', 'TRAINEE'],
  ];
  const [, grade, gradeEn] = GRADES.find(([min]) => score >= min);

  // 자격증 번호: 발급 연도 + 캐릭터ID + 닉네임 해시
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)) % 100000;
  const certNo = `AGL-${new Date().getFullYear()}-${String(characterId).padStart(3, '0')}-${String(h).padStart(5, '0')}`;

  return {
    player: {
      name: profile.player.name,
      accountLevel: profile.player.accountLevel,
      syncedAt: profile.player.syncedAt,
    },
    character,
    grade, gradeEn, score, certNo,
    issuedAt: Date.now(),
    seasonsPlayed: perSeason.length,
    seasonsTotal: playedIds.length,
    bestMmr,
    charStats, overallStats, modeStats, perSeason,
    failedSeasons: results.filter(r => r.error).length,
  };
}

// ---------- 이미지 프록시 (캔버스 오염 방지용 same-origin) ----------
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
    if (url.pathname === '/api/characters') {
      const chars = await getCharacters();
      return sendJson(res, 200, chars.map(c => ({
        id: c.id, key: c.key, name: c.name,
        skins: c.skins.map(s => ({ id: s.id, name: s.name, grade: s.grade, imageName: s.imageName })),
      })));
    }
    if (url.pathname === '/api/certificate') {
      const name = (url.searchParams.get('name') || '').trim();
      const characterId = parseInt(url.searchParams.get('characterId'), 10);
      if (!name || !characterId) return sendJson(res, 400, { error: '닉네임과 캐릭터를 지정하세요.' });
      const cert = await buildCertificate(name, characterId);
      if (!cert.charStats.play) return sendJson(res, 404, { error: `'${name}'님의 ${cert.character.name} 플레이 기록이 없습니다.`, character: cert.character.name });
      return sendJson(res, 200, cert);
    }
    if (url.pathname.startsWith('/img/skin/')) {
      const imageName = url.pathname.split('/').pop().replace(/[^A-Za-z0-9_]/g, '');
      const chars = await getCharacters();
      let skin = null;
      for (const c of chars) { skin = c.skins.find(s => s.imageName === imageName); if (skin) break; }
      if (!skin) { res.writeHead(404); return res.end('not found'); }
      return await proxyImage(skin.profileUrl, res);
    }
    if (url.pathname.startsWith('/img/char/')) {
      const key = url.pathname.split('/').pop().replace(/[^A-Za-z0-9]/g, '');
      const chars = await getCharacters();
      const c = chars.find(x => x.key === key);
      if (!c) { res.writeHead(404); return res.end('not found'); }
      return await proxyImage(c.imageUrl, res);
    }
    // 정적 파일
    let file = url.pathname === '/' ? '/index.html' : url.pathname;
    file = path.normalize(file).replace(/^(\.\.[/\\])+/, '');
    const full = path.join(__dirname, 'public', file);
    if (full.startsWith(path.join(__dirname, 'public')) && fs.existsSync(full) && fs.statSync(full).isFile()) {
      const ext = path.extname(full);
      // html/js/css는 CDN 캐시 금지(버전 쿼리로 갱신), 폰트·이미지는 장기 캐시
      const cacheControl = ['.woff', '.woff2', '.png', '.svg'].includes(ext)
        ? 'public, max-age=604800' : 'no-cache';
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': cacheControl });
      return res.end(fs.readFileSync(full));
    }
    res.writeHead(404); res.end('not found');
  } catch (e) {
    const code = e.status === 404 ? 404 : (e.status === 400 ? 400 : 500); // CF가 origin 502를 HTML로 대체
    const msg = e.status === 404 ? '플레이어를 찾을 수 없습니다. 닉네임을 확인해주세요.' : String(e.message || e);
    sendJson(res, code, { error: msg });
  }
});

server.listen(PORT, () => console.log(`er-cert listening on http://localhost:${PORT}`));
