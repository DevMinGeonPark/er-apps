// 루미아 신용정보원 평가 — 구 er-credit/server.js 를 브라우저로 옮긴 것.
// fetch/캐시/캐릭터 메타는 dakgg-core.js(DAKCore)가 담당한다.
// app.js 와 같은 전역 렉시컬 스코프를 쓰면 이름이 충돌한다
// (fmt·fmtElapsed·observe·imgToDataUri 등이 실제로 겹쳤다). IIFE로 가둔다.
(function () {
  const { dakJson, charImgUrl } = DAKCore;
  const META_TTL = DAKCore.META_TTL;

  const getSeasons = async () => (await dakJson('/data/seasons?hl=ko', META_TTL)).seasons;
  // 구 server.js와 동일한 축소 형태로 맞춘다 — 산출물의 character 필드가 그대로 커지지 않게
  const getCharacters = async () => (await DAKCore.getCharacters())
    .map(c => ({ id: c.id, key: c.key, name: c.name, imageUrl: c.imageUrl }));

  // ---------- 조회 이력 ----------
  // 구 server.js는 data/inquiries.json 에 전체 방문자의 조회를 누적했다. 정적 배포에는
  // 공유 저장소가 없어 localStorage(브라우저별)로 격하된다 — "남이 나를 조회한 횟수"가
  // 아니라 "이 브라우저에서 조회한 횟수"가 된다.
  // ponytail: 공유 카운터가 필요해지면 Workers KV 같은 걸 붙인다.
  const INQ_KEY = 'er-credit:inquiries';
  const INQ_WINDOW = 30 * 86400 * 1000;
  function loadInq() {
    try { return JSON.parse(localStorage.getItem(INQ_KEY)) || {}; } catch { return {}; }
  }
  function saveInq(o) {
    try { localStorage.setItem(INQ_KEY, JSON.stringify(o)); } catch { /* 사생활 보호 모드 등 */ }
  }
  function recordInquiry(name, characterId) {
    const key = `${name.toLowerCase()}|${characterId}`;
    const now = Date.now();
    const all = loadInq();
    const list = (all[key] || []).filter(t => now - t < INQ_WINDOW);
    list.push(now);
    if (list.length > 200) list.splice(0, list.length - 200);
    all[key] = list;
    saveInq(all);
    return list.length;
  }
  function readInquiry(name, characterId) {
    const key = `${name.toLowerCase()}|${characterId}`;
    const now = Date.now();
    return (loadInq()[key] || []).filter(t => now - t < INQ_WINDOW).length;
  }

  // ---------- 집계 ----------
  const STAT_FIELDS = [
    'play', 'win', 'top2', 'top3', 'place', 'playerKill', 'playerAssistant',
    'teamKill', 'monsterKill', 'damageToPlayer', 'damageToMonster',
    'playTime', 'playerDeaths', 'mmrGain',
  ];
  const zero = () => Object.fromEntries(STAT_FIELDS.map(f => [f, 0]));
  const MODE_BUCKETS = { rank: 3, normal: 2, cobalt: 6 };

  function pickAllBucket(overviews) {
    return (overviews || []).find(o => o.matchingModeId === 0 && o.teamModeId === 0) || null;
  }

  // 플레이어의 전 시즌 프로필을 모아 (실험체별 누적 + 시즌별 기록 + 전체 평균)을 만든다.
  async function buildDossier(name) {
    const enc = encodeURIComponent(name);
    const [seasons, characters, profile] = await Promise.all([
      getSeasons(), getCharacters(), dakJson(`/players/${enc}/profile`, 10 * 60 * 1000),
    ]);
    const seasonById = new Map(seasons.map(s => [s.id, s]));
    const charById = new Map(characters.map(c => [c.id, c]));
    const playedIds = (profile.playerSeasons || []).map(s => s.seasonId).filter(id => seasonById.has(id));

    const currentSeasonKey = profile.meta && profile.meta.season;
    const results = [];
    const queue = [...playedIds];
    async function worker() {
      while (queue.length) {
        const id = queue.shift();
        const key = seasonById.get(id).key;
        try {
          const p = (key === currentSeasonKey) ? profile
            : await dakJson(`/players/${enc}/profile?season=${key}`, 10 * 60 * 1000);
          results.push({ seasonId: id, profile: p });
        } catch (e) { results.push({ seasonId: id, error: String(e) }); }
      }
    }
    await Promise.all([worker(), worker(), worker(), worker()]);
    results.sort((a, b) => b.seasonId - a.seasonId);

    const overall = zero();
    const chars = new Map(); // characterId -> { total, seasons[], modes:Set }
    let bestMmr = null;

    for (const r of results) {
      if (r.error) continue;
      const season = seasonById.get(r.seasonId);
      const bucket = pickAllBucket(r.profile.playerSeasonOverviews);
      if (!bucket) continue;
      for (const f of STAT_FIELDS) overall[f] += bucket[f] || 0;
      if (bucket.mmr && (!bestMmr || bucket.mmr > bestMmr.mmr)) bestMmr = { mmr: bucket.mmr, season: season.name };

      const seasonPlay = bucket.play || 0;
      const seasonAvgPlace = seasonPlay ? bucket.place / seasonPlay : null;

      for (const cs of (bucket.characterStats || [])) {
        if (!charById.has(cs.key)) continue;
        let ent = chars.get(cs.key);
        if (!ent) { ent = { total: zero(), seasons: [], modes: new Set() }; chars.set(cs.key, ent); }
        for (const f of STAT_FIELDS) ent.total[f] += cs[f] || 0;
        ent.seasons.push({
          seasonId: r.seasonId,
          seasonName: season.name,
          play: cs.play || 0,
          win: cs.win || 0,
          avgPlace: cs.play ? +(cs.place / cs.play).toFixed(2) : null,
          baseAvgPlace: seasonAvgPlace ? +seasonAvgPlace.toFixed(2) : null,
          avgDamage: cs.play ? Math.round((cs.damageToPlayer || 0) / cs.play) : 0,
        });
      }
      for (const [mk, mid] of Object.entries(MODE_BUCKETS)) {
        const mb = (r.profile.playerSeasonOverviews || [])
          .find(o => o.matchingModeId === mid && (mid === 6 || o.teamModeId === 0));
        for (const cs of ((mb && mb.characterStats) || [])) {
          const ent = chars.get(cs.key);
          if (ent && (cs.play || 0) > 0) ent.modes.add(mk);
        }
      }
    }

    return {
      player: {
        name: profile.player.name,
        accountLevel: profile.player.accountLevel,
        syncedAt: profile.player.syncedAt,
      },
      bestMmr,
      seasonsPlayed: results.filter(r => !r.error).length,
      overall,
      chars,
      charById,
      failedSeasons: results.filter(r => r.error).length,
    };
  }

  // ---------- 신용평가 ----------
  // ponytail: 가중치·기준선 전부 여기 상수로. 실측 돌려보면 반드시 튜닝 들어감.
  const MODEL = {
    weights: { repayment: 0.35, debt: 0.25, term: 0.20, form: 0.10, fresh: 0.10 },
    thinFilePlay: 10,         // 이 판수 미만이면 평가 불가 (Thin File)
    placeSpread: 1.5,         // 본인 평균 대비 순위 차 ±이만큼을 만점/빵점으로
    winSpread: 5,             // 승률 차(%p) 정규화 폭
    fullTermPlay: 200,        // 이 판수에서 거래기간 만점
    ratioClamp: 0.5,          // 딜/데스 비율 정규화 폭 (1±0.5)
    freshSafeShare: 0.4,      // 최근 시즌 집중도가 이하이면 신규위험 없음
    delinquency: [            // 본인 평균보다 순위가 이만큼 나쁜 시즌 = 연체
      [2.0, '90일 이상 연체', 'severe'],
      [1.2, '30일 이상 연체', 'major'],
      [0.5, '단기 연체', 'minor'],
    ],
  };
  const GRADES = [
    [900, 1], [830, 2], [760, 3], [690, 4], [620, 5],
    [540, 6], [450, 7], [350, 8], [240, 9], [0, 10],
  ];
  const LIMITS = {
    1: ['제한 없음', '3인팟 자동 승인 · 보증인 불요'],
    2: ['제한 없음', '3인팟 자동 승인 · 보증인 불요'],
    3: ['우량', '듀오·3인팟 승인'],
    4: ['우량', '듀오 승인 · 3인팟 조건부'],
    5: ['보통', '듀오 승인 · 3인팟 심사 필요'],
    6: ['보통', '듀오 한도 축소 · 3인팟 부결'],
    7: ['주의', '듀오 편입 시 보증인 1인 필요'],
    8: ['주의', '듀오 편입 시 보증인 1인 필요 · 랭크 거래 제한'],
    9: ['위험', '신규 거래 부결 · 기존 듀오만 유지'],
    10: ['위험', '신규 거래 전면 부결 · 채무불이행 우려'],
  };

  const clamp01 = x => Math.max(0, Math.min(1, x));
  const norm = (delta, spread) => clamp01((delta / spread + 1) / 2); // -spread..+spread → 0..1

  function evaluate(ent, overall, character) {
    const t = ent.total;
    const play = t.play || 0;
    const oPlay = overall.play || 0;

    const charAvgPlace = play ? t.place / play : 0;
    const charWinRate = play ? t.win / play * 100 : 0;
    const charAvgDamage = play ? t.damageToPlayer / play : 0;
    const charDeaths = play ? t.playerDeaths / play : 0;
    const baseAvgPlace = oPlay ? overall.place / oPlay : 0;
    const baseWinRate = oPlay ? overall.win / oPlay * 100 : 0;
    const baseAvgDamage = oPlay ? overall.damageToPlayer / oPlay : 0;
    const baseDeaths = oPlay ? overall.playerDeaths / oPlay : 0;

    const stats = {
      play, win: t.win || 0,
      winRate: +charWinRate.toFixed(1),
      top3Rate: play ? +(t.top3 / play * 100).toFixed(1) : 0,
      avgPlace: +charAvgPlace.toFixed(2),
      avgKill: play ? +(t.playerKill / play).toFixed(2) : 0,
      avgAssist: play ? +(t.playerAssistant / play).toFixed(2) : 0,
      avgDamage: Math.round(charAvgDamage),
      avgDeaths: +charDeaths.toFixed(2),
      mmrGain: t.mmrGain || 0,
      playHours: +((t.playTime || 0) / 3600).toFixed(1),
    };
    const baseline = {
      avgPlace: +baseAvgPlace.toFixed(2),
      winRate: +baseWinRate.toFixed(1),
      avgDamage: Math.round(baseAvgDamage),
      avgDeaths: +baseDeaths.toFixed(2),
      play: oPlay,
    };

    // Thin File — 거래 이력 부족은 나쁜 게 아니라 '평가 불가'다
    if (play < MODEL.thinFilePlay) {
      return {
        characterId: character.id, character, thinFile: true, score: null, grade: null,
        stats, baseline,
        headline: '신용정보 부족 (Thin File)',
        note: `거래 이력 ${play}건으로 평가에 필요한 최소 기준(${MODEL.thinFilePlay}건) 미달. 신규 거래 시 보증인 필요.`,
      };
    }

    // 1) 상환이력 — 픽했으면 값을 하는가 (본인 평균 대비)
    const placePart = norm(baseAvgPlace - charAvgPlace, MODEL.placeSpread); // 순위는 낮을수록 좋음
    const winPart = norm(charWinRate - baseWinRate, MODEL.winSpread);
    const repayment = 0.6 * placePart + 0.4 * winPart;

    // 2) 부채수준 — 팀 자원 대비 기여 (딜 지분 / 사망)
    const dmgRatio = baseAvgDamage ? charAvgDamage / baseAvgDamage : 1;
    const deathRatio = baseDeaths ? charDeaths / baseDeaths : 1;
    const dmgPart = norm(dmgRatio - 1, MODEL.ratioClamp);
    const deathPart = 1 - norm(deathRatio - 1, MODEL.ratioClamp);
    const debt = 0.6 * dmgPart + 0.4 * deathPart;

    // 3) 신용거래기간 — 이 실험체와 얼마나 오래 거래했나
    const term = clamp01(Math.log10(play + 1) / Math.log10(MODEL.fullTermPlay + 1));

    // 4) 신용형태 — 거래 지속성 + 모드 다양성
    const seasonsWith = ent.seasons.filter(s => s.play > 0).length;
    const seasonRatio = ent.totalSeasons ? seasonsWith / ent.totalSeasons : 0;
    const form = 0.6 * clamp01(seasonRatio) + 0.4 * (ent.modes.size / 3);

    // 5) 신규 개설 — 최근에 갑자기 늘린 픽은 위험 신호
    const sorted = [...ent.seasons].sort((a, b) => b.seasonId - a.seasonId);
    const latestShare = play ? (sorted[0] ? sorted[0].play : 0) / play : 0;
    const fresh = 1 - clamp01((latestShare - MODEL.freshSafeShare) / (1 - MODEL.freshSafeShare));

    const factors = { repayment, debt, term, form, fresh };
    const score = Math.round(
      Object.entries(MODEL.weights).reduce((s, [k, w]) => s + w * factors[k], 0) * 1000
    );
    const [, grade] = GRADES.find(([min]) => score >= min);

    // 연체 기록 — 본인 평균보다 확연히 못한 시즌
    const delinquencies = [];
    for (const s of sorted) {
      if (!s.play || s.avgPlace == null || s.baseAvgPlace == null) continue;
      const delta = s.avgPlace - s.baseAvgPlace;
      const hit = MODEL.delinquency.find(([d]) => delta >= d);
      if (hit) delinquencies.push({
        seasonName: s.seasonName, play: s.play, avgPlace: s.avgPlace,
        baseAvgPlace: s.baseAvgPlace, delta: +delta.toFixed(2),
        label: hit[1], severity: hit[2],
      });
    }
    const defaulted = grade >= 9 && delinquencies.filter(d => d.severity !== 'minor').length >= 3;

    return {
      characterId: character.id, character, thinFile: false,
      score, grade,
      limit: LIMITS[grade],
      factors: Object.fromEntries(Object.entries(factors).map(([k, v]) => [k, +(v * 100).toFixed(0)])),
      weights: MODEL.weights,
      stats, baseline,
      seasons: sorted,
      seasonsWith, modes: [...ent.modes],
      delinquencies, defaulted,
      latestShare: +(latestShare * 100).toFixed(0),
    };
  }

  function reportNo(name, characterId) {
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.codePointAt(0)) % 1000000;
    const d = new Date();
    const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    return `LCB-${ymd}-${String(characterId).padStart(3, '0')}-${String(h).padStart(6, '0')}`;
  }

  // 구 /api/report · /api/credit 라우트를 그대로 옮긴 진입점.
  function rethrow(e) {
    if (e.status === 404) throw new Error('조회 대상을 찾을 수 없습니다. 닉네임을 확인해주세요.');
    throw e;
  }

  async function report(name) {
    name = (name || '').trim();
    if (!name) throw new Error('닉네임을 입력하세요.');
    let d;
    try { d = await buildDossier(name); } catch (e) { rethrow(e); }
    if (!d.seasonsPlayed || !(d.overall.play > 0)) {
      const error = new Error(d.failedSeasons
        ? `${d.failedSeasons}개 시즌을 불러오지 못했으며 확인된 거래 이력이 없습니다. 잠시 후 다시 조회해주세요.`
        : `'${d.player.name}'님의 거래 이력이 없습니다. 전적이 있는 닉네임으로 조회하십시오.`);
      error.code = d.failedSeasons ? 'INCOMPLETE_RECORDS' : 'NO_RECORDS';
      throw error;
    }
    const totalSeasons = d.seasonsPlayed;
    const rows = [];
    for (const [id, ent] of d.chars) {
      if (!ent.total.play) continue;
      ent.totalSeasons = totalSeasons;
      const ev = evaluate(ent, d.overall, d.charById.get(id));
      rows.push({
        characterId: id, name: ev.character.name, key: ev.character.key,
        play: ev.stats.play, winRate: ev.stats.winRate, avgPlace: ev.stats.avgPlace,
        score: ev.score, grade: ev.grade, thinFile: ev.thinFile,
        inquiries: readInquiry(name, id),
      });
    }
    // 평가된 것 먼저(점수순), Thin File은 뒤로
    rows.sort((a, b) => (a.thinFile - b.thinFile) || (b.score - a.score) || (b.play - a.play));
    const scored = rows.filter(r => !r.thinFile);
    const oPlay = d.overall.play || 0;
    return {
      player: d.player, bestMmr: d.bestMmr, seasonsPlayed: d.seasonsPlayed,
      overall: {
        play: oPlay,
        winRate: oPlay ? +(d.overall.win / oPlay * 100).toFixed(1) : 0,
        avgPlace: oPlay ? +(d.overall.place / oPlay).toFixed(2) : 0,
        avgDamage: oPlay ? Math.round(d.overall.damageToPlayer / oPlay) : 0,
      },
      rows,
      summary: {
        evaluated: scored.length,
        thinFile: rows.length - scored.length,
        best: scored[0] || null,
        worst: scored[scored.length - 1] || null,
        spread: scored.length >= 2 ? scored[scored.length - 1].grade - scored[0].grade : 0, // 등급은 숫자가 작을수록 우량
      },
      failedSeasons: d.failedSeasons,
    };
  }

  async function credit(name, characterId) {
    name = (name || '').trim();
    characterId = parseInt(characterId, 10);
    if (!name || !characterId) throw new Error('닉네임과 실험체를 지정하세요.');
    let d;
    try { d = await buildDossier(name); } catch (e) { rethrow(e); }
    const ent = d.chars.get(characterId);
    const character = d.charById.get(characterId);
    if (!character) throw new Error('알 수 없는 실험체입니다.');
    if (!ent || !ent.total.play) throw new Error(`'${d.player.name}'님의 ${character.name} 거래 이력이 없습니다.`);
    ent.totalSeasons = d.seasonsPlayed;
    const ev = evaluate(ent, d.overall, character);
    const inquiries = recordInquiry(name, characterId);
    return {
      player: d.player, bestMmr: d.bestMmr, seasonsPlayed: d.seasonsPlayed,
      failedSeasons: d.failedSeasons,
      reportNo: reportNo(name, characterId), issuedAt: Date.now(),
      inquiries, ...ev,
    };
  }

  window.DAK = { getCharacters, charImgUrl, report, credit };

})();
