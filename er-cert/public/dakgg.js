// ER 자격증 집계 — 구 er-cert/server.js 의 buildCertificate 를 브라우저로 옮긴 것.
// fetch/캐시/메타/이미지URL은 dakgg-core.js(DAKCore)가 담당한다.
// app.js 와 같은 전역 렉시컬 스코프를 쓰면 이름이 충돌한다
// (fmt·fmtElapsed·observe·imgToDataUri 등이 실제로 겹쳤다). IIFE로 가둔다.
(function () {
  const { dakJson, getCharacters, charImgUrl, skinImgUrl } = DAKCore;

  async function getSeasons() {
    const d = await dakJson('/data/seasons?hl=ko', DAKCore.META_TTL);
    return d.seasons;
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

  // 기존 /api/certificate 라우트가 하던 검증까지 포함한 진입점.
  async function issueCertificate(name, characterId) {
    if (!name || !characterId) { const e = new Error('닉네임과 캐릭터를 지정하세요.'); e.status = 400; throw e; }
    let cert;
    try {
      cert = await buildCertificate(name, characterId);
    } catch (e) {
      if (e.status === 404) throw new Error('플레이어를 찾을 수 없습니다. 닉네임을 확인해주세요.');
      throw e;
    }
    if (!cert.charStats.play) {
      const error = new Error(cert.failedSeasons
        ? `일부 시즌 ${cert.failedSeasons}건을 불러오지 못했으며, 확인된 자료에 ${cert.character.name} 플레이 기록이 없습니다.`
        : `'${name}'님의 ${cert.character.name} 플레이 기록이 없습니다.`);
      error.code = cert.failedSeasons ? 'INCOMPLETE_RECORDS' : 'NO_RECORDS';
      throw error;
    }
    return cert;
  }

  window.DAK = { getCharacters, issueCertificate, charImgUrl, skinImgUrl };

})();
