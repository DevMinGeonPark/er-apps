// 루미아섬 원수 관측소 집계 — 구 er-enemy/server.js 를 브라우저로 옮긴 것.
// 공식 전적과 메타는 er-core.js(ERCore)와 er-ps 서버가 담당한다.
// app.js 와 같은 전역 렉시컬 스코프를 쓰면 이름이 충돌한다
// (fmt·fmtElapsed·observe·imgToDataUri 등이 실제로 겹쳤다). IIFE로 가둔다.
(function () {
  const { getCharacters, charImgUrl } = ERCore;
  const META_TTL = ERCore.META_TTL;
  const { cacheGet, cacheSet } = ERCore;

  // ---------- 메타데이터 ----------
  async function getMeta() {
    const hit = cacheGet('meta:all');
    if (hit) return hit;
    const { characters: chars, areas, masteries, monsters } = await ERCore.metadata();
    const meta = {
      charById: new Map(), charByKey: new Map(),
      areaById: new Map(), masteryByKey: new Map(), monsterByKey: new Map(),
    };
    for (const c of chars) {
      const info = { id: c.id, key: c.key, name: c.name, imageUrl: c.imageUrl };
      meta.charById.set(c.id, info);
      meta.charByKey.set(c.key.toLowerCase(), info);
    }
    for (const a of areas) meta.areaById.set(a.id, a.name);
    for (const m of masteries) meta.masteryByKey.set(m.key.toLowerCase(), m.name);
    for (const m of monsters) meta.monsterByKey.set(m.key.toLowerCase(), m.name);
    cacheSet('meta:all', meta, META_TTL);
    return meta;
  }

  // ---------- 전적 조회 ----------
  const MATCH_TTL = 5 * 60 * 1000;
  // mode: 'RANK'(기본) — 관측소는 MMR이 걸린 랭크만 다룬다. null이면 전체 모드.
  async function getMatchesPage(nick, page, mode = 'RANK') {
    const rows = await ERCore.getMatches(nick, { pages: page * 2 });
    return rows.slice((page - 1) * 20, page * 20).filter(row => !mode || row.matchingMode === 3);
  }
  async function getMatches(nick, pages, mode = 'RANK') {
    return ERCore.getMatches(nick, { pages: pages * 2, mode: mode ? 3 : null });
  }
  async function findGameRecord(nick, gameId, pages = 5) {
    try { return await ERCore.findGameRecord(nick, gameId); } catch { return null; }
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
    const visited = new Set();
    let nick = startNick;
    let prevTime = myPlayTime || 0;
    for (let depth = 0; depth < 8; depth++) {
      if (visited.has(nick)) {
        steps.push({ nickname: nick, missing: true, reason: '부활로 기록이 순환하여 추적을 마칩니다.' });
        break;
      }
      visited.add(nick);
      const m = await findGameRecord(nick, gameId);
      if (!m) {
        steps.push({ nickname: nick, missing: true });
        break;
      }
      if (!Number.isFinite(m.playTime) || m.playTime < prevTime) {
        steps.push({ nickname: nick, missing: true, reason: '부활 기록으로 사망 순서를 확정할 수 없어 추적을 마칩니다.' });
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
    if (!n) return { tone: 'silent', text: '조회 범위에서 이후 랭크 기록을 찾지 못했습니다 — 잠적 여부는 관측 불가입니다.', total: null };
    if (afterGames.some(g => g.mmrGain == null)) return { tone: 'hold', text: '일부 경기의 RP 증감이 제공되지 않아 누적 손익 판정을 보류합니다.', total: null };
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
        ? `'${name}'님의 조회한 랭크 ${matches.length}판에서 플레이어에게 처형당한 상세 기록이 없습니다.`
        : `'${name}'님의 조회 범위에서 랭크 기록을 찾지 못했습니다.`);
      e.status = 404;
      throw e;
    }
    return { me: matches[0]?.nickname || name, scanned: matches.length, killers, beastDeaths, zoneDeaths };
  }

  // 관측
  async function buildObservation(enemy, me, gameId) {
    const meta = await getMeta();
    const profile = await ERCore.getProfile(enemy);
    const matches = (await getMatches(enemy, 2)).sort((a, b) => a.gameId - b.gameId);

    // 대상 프로필 카드
    const lastMatch = matches[matches.length - 1];
    const lastChar = lastMatch ? meta.charById.get(lastMatch.characterNum) : null;
    const target = {
      nickname: profile.nickname,
      accountLevel: profile.accountLevel,
      characterKey: lastChar ? lastChar.key : null,
      characterName: lastChar ? lastChar.name : null,
      mmr: profile.mmr,
      seasonPlays: profile.seasonPlays,
      averageKills: profile.averageKills,
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
      const delta = typeof m.mmrGain === 'number' ? m.mmrGain : null;
      cum = cum == null || delta == null ? null : cum + delta;
      const c = meta.charById.get(m.characterNum);
      return {
        gameId: m.gameId, startDtm: m.startDtm, gameRank: m.gameRank,
        mmrGain: delta, cum,
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

  // 구 /api/killers · /api/observe 라우트의 검증·에러 문구까지 포함한 진입점.
  function rethrow(e) {
    if (e.status === 404) {
      throw new Error(String(e.message).includes('기록') ? e.message : '플레이어를 찾을 수 없습니다. 닉네임을 확인해주세요.');
    }
    throw e;
  }
  async function killers(name) {
    name = (name || '').trim();
    if (!name) throw new Error('닉네임을 입력하세요.');
    try { return await buildKillers(name); } catch (e) { rethrow(e); }
  }
  async function observe(enemy, me, gameId) {
    enemy = (enemy || '').trim();
    if (!enemy) throw new Error('원수의 닉네임을 입력하세요.');
    try { return await buildObservation(enemy, (me || '').trim() || null, gameId || null); } catch (e) { rethrow(e); }
  }

  window.ER = { getCharacters, charImgUrl, killers, observe };

})();
