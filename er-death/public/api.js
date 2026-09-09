// 사망진단서 생성 — 구 er-death/server.js 를 브라우저로 옮긴 것.
// 공식 전적 조회는 er-core.js(ERCore)와 er-ps 서버가 담당한다.
// app.js 와 같은 전역 렉시컬 스코프를 쓰면 이름이 충돌한다
// (fmt·fmtElapsed·observe·imgToDataUri 등이 실제로 겹쳤다). IIFE로 가둔다.
(function () {
  const META_TTL = ERCore.META_TTL;
  const { cacheGet, cacheSet } = ERCore;

  // ---------- 메타데이터 ----------
  async function getMeta() {
    const hit = cacheGet('meta:all');
    if (hit) return hit;
    const { characters: chars, areas, masteries, monsters } = await ERCore.metadata();
    const meta = {
      charById: new Map(), charByKey: new Map(),
      areaById: new Map(),
      masteryById: new Map(), masteryByKey: new Map(),
      monsterByKey: new Map(),
    };
    for (const c of chars) {
      const info = {
        id: c.id, key: c.key, name: c.name, imageUrl: c.imageUrl,
        skins: c.skins.map(s => ({ code: s.id, imageName: s.imageName, profileUrl: s.profileUrl })),
      };
      meta.charById.set(c.id, info);
      meta.charByKey.set(c.key.toLowerCase(), info);
    }
    for (const a of areas) meta.areaById.set(a.id, a.name);
    for (const m of masteries) {
      meta.masteryById.set(m.id, m.name);
      meta.masteryByKey.set(m.key.toLowerCase(), m.name);
    }
    for (const m of monsters) meta.monsterByKey.set(m.key.toLowerCase(), m.name);
    cacheSet('meta:all', meta, META_TTL);
    return meta;
  }

  // ---------- 유틸 ----------
  function hashStr(s) {
    let h = 0;
    for (const ch of String(s)) h = (h * 31 + ch.codePointAt(0)) % 1000000007;
    return h;
  }
  function pick(arr, seed) { return arr[seed % arr.length]; }
  function fmt(n) { return Number(n || 0).toLocaleString('ko-KR'); }
  function pad(n, w) { return String(n).padStart(w, '0'); }

  function fmtDateTime(d) {
    return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${pad(d.getHours(), 2)}시 ${pad(d.getMinutes(), 2)}분`;
  }
  function fmtDate(d) {
    return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
  }

  // 무기별 손상 명칭 (검안서 용어)
  const WEAPON_INJURY = {
    Glove: '둔력 손상', Tonfa: '다발성 좌상', Bat: '두부 둔기 손상', Whip: '열창',
    HighAngleFire: '폭발 손상', DirectFire: '폭발 손상', Bow: '자창', CrossBow: '관통상',
    Pistol: '총창', AssaultRifle: '다발성 총창', SniperRifle: '원거리 총창', Shotgun: '산탄 총창',
    OneHandSword: '절창', TwoHandSword: '심부 절창', Axe: '파열창', DualSword: '다발성 절창',
    Spear: '관통 자창', Hammer: '분쇄 손상', Rapier: '심자창', Guitar: '음파 및 둔기 복합 손상',
    Camera: '섬광 손상', Arcana: '마력 손상', VFArm: 'VF 과부하 손상', Nunchaku: '연타 좌상',
    Throw: '투척물 손상', Shuriken: '자창', Trap: '함정 손상',
  };

  function describeCause(cause) {
    if (!cause) return null;
    if (/^basicAttack$/i.test(cause)) return '기본 공격';
    if (/기본\s*공격|기본공격/.test(cause)) return cause;
    return `「${cause}」`;
  }

  // 사망 1건 추출 (suffix: '', '2', '3')
  function extractDeath(m, suf, meta) {
    const killer = m['killer' + suf];
    const detail = m['killDetail' + suf];
    if (!killer && !detail) return null;
    const charKey = (m['killerCharacter' + suf] || '').toLowerCase();
    const weaponKey = (m['killerWeapon' + suf] || '');
    const cause = m['causeOfDeath' + suf] || '';
    const placeId = parseInt(m['placeOfDeath' + suf], 10);
    const killerChar = meta.charByKey.get(charKey) || null;

    const d = {
      kind: killer, // player | wildAnimal | monster | zone 등
      killerNickname: null,
      killerCharName: null,
      killerCharKey: null,
      weaponName: null,
      injury: null,
      cause: describeCause(cause),
      placeName: meta.areaById.get(placeId) || null,
    };
    if (killer === 'player') {
      d.killerNickname = detail;
      d.killerCharName = killerChar ? killerChar.name : (m['killerCharacter' + suf] || '불상');
      d.killerCharKey = killerChar ? killerChar.key : null;
      d.weaponName = meta.masteryByKey.get(weaponKey.toLowerCase()) || null;
      d.injury = WEAPON_INJURY[weaponKey] || '다발성 손상';
    } else if (killer === 'wildAnimal' || killer === 'monster') {
      d.killerNickname = null;
      d.killerCharName = meta.monsterByKey.get((detail || '').toLowerCase()) || detail || '야생동물';
      d.injury = '교상(咬傷)';
    } else {
      // 금지구역 등 — killDetail이 지역명 문자열로 옴
      d.killerCharName = detail || '금지구역';
      d.injury = '아글라이아 프로토콜 집행';
    }
    return d;
  }

  function extractDeaths(m, meta) {
    const out = [];
    for (const suf of ['', '2', '3']) {
      const d = extractDeath(m, suf, meta);
      if (d) out.push(d);
    }
    return out;
  }

  // ---------- 소견 생성 ----------
  function buildCauseChain(m, finalDeath, seed) {
    const chain = [];
    // (가) 직접 사인
    let ga;
    if (finalDeath.kind === 'player') {
      const by = finalDeath.cause ? `${finalDeath.cause} 적중` : '공격';
      ga = `${finalDeath.killerCharName}의 ${by}에 의한 ${finalDeath.injury}`;
    } else if (finalDeath.kind === 'wildAnimal' || finalDeath.kind === 'monster') {
      ga = `야생 ${finalDeath.killerCharName}의 습격에 의한 ${finalDeath.injury}`;
    } else {
      ga = `금지구역 체류에 따른 ${finalDeath.injury}`;
    }
    chain.push({ label: '(가) 직접 사인', text: ga, dur: '약 1.2초' });

    // (나) — 전적 조건 기반
    const na = [];
    if (m.maxHp > 0 && (m.damageFromPlayer || 0) > m.maxHp * 2.5)
      na.push({ text: `감당 범위(체력 ${fmt(m.maxHp)})의 ${(m.damageFromPlayer / m.maxHp).toFixed(1)}배에 달하는 피해 축적`, dur: '약 14초' });
    if ((m.useEmoticonCount || 0) >= 8)
      na.push({ text: `과도한 감정표현(${m.useEmoticonCount}회)으로 인한 주의력 분산`, dur: '경기 내내' });
    if ((m.monsterKill || 0) >= 45)
      na.push({ text: `야생동물 ${m.monsterKill}마리 사냥에 따른 만성 피로`, dur: '누적' });
    na.push({ text: '체력 상황에 대한 낙관적 전망 하의 교전 개시 판단', dur: '약 14초' });
    chain.push({ label: '(나) (가)의 원인', ...pick(na, seed) });

    // (다) — 고정 유머 풀
    const da = [
      '"이길 수 있을 것 같은 느낌"',
      '"상대도 체력이 없을 것"이라는 근거 없는 추측',
      '"여기서 물러나면 팀에게 미안하다"는 부채 의식',
      '"한 번만 더 싸우면 무기 숙련도가 오른다"는 믿음',
      '"저건 내 사냥감"이라는 소유 의식',
    ];
    chain.push({ label: '(다) (나)의 원인', text: pick(da, seed >> 3), dur: '만성' });

    // (라) — 근본 원인
    const ra = [];
    if ((m.mmrGain || 0) < 0) ra.push(`MMR ${m.mmrGain} 손실에 대한 만회 심리`);
    ra.push('티어 승급에 대한 조급함');
    ra.push('"한 판만 더"의 무한 반복');
    chain.push({ label: '(라) (다)의 원인', text: pick(ra, seed >> 6), dur: '시즌 내내' });
    return chain;
  }

  function buildOpinions(m, deaths, victimChar, seed) {
    const ops = [];
    if ((m.fishingCount || 0) > 0)
      ops.push(`고인은 생전 낚시를 ${m.fishingCount}회 즐기는 등 여유로운 실험 생활을 영위함.`);
    if ((m.monsterKill || 0) > 0)
      ops.push(`야생동물 ${m.monsterKill}마리를 사냥하며 성실히 파밍하였으나, 정작 사람과의 싸움은 준비가 부족했던 것으로 사료됨.`);
    if ((m.playerKill || 0) === 0 && (m.playerAssistant || 0) > 0)
      ops.push(`킬 0 · 어시스트 ${m.playerAssistant} — 고인은 손에 피를 묻히지 않는 평화주의자였던 것으로 확인됨.`);
    else if ((m.playerKill || 0) >= 3)
      ops.push(`고인은 ${m.playerKill}명을 먼저 보낸 후 사망하여, 최소한 혼자 가지는 않은 것으로 확인됨.`);
    if ((m.useEmoticonCount || 0) >= 5)
      ops.push(`경기 중 감정표현 ${m.useEmoticonCount}회 사용 — 검시관은 이 중 일부가 사인(死因)에 기여했을 가능성을 배제하지 않음.`);
    if (m.tacticalSkillUseCount === 0)
      ops.push('전술 스킬을 한 번도 사용하지 않은 채 사망함. 아껴서 남 주게 됨.');
    if ((m.mmrGain || 0) < 0)
      ops.push(`유족(본인)에게 MMR ${m.mmrGain}이 상속됨.`);
    else if ((m.mmrGain || 0) > 0)
      ops.push(`고인은 사망하고도 MMR ${m.mmrGain}을 남김 — 보험을 잘 들어둔 것으로 보임.`);
    if ((m.gameRank || 99) <= 3)
      ops.push(`최종 ${m.gameRank}위 — 우승을 목전에 두고 있었기에 주위를 더욱 안타깝게 함.`);
    if (deaths.length >= 2)
      ops.push(`기왕력: 동일 실험 내 사망 ${deaths.length - 1}회 전력(부활 처치 후 재발). 금회 사망으로 최종 판정함.`);
    if ((m.damageToPlayer || 0) > 0 && (m.teamKill || 0) > 0)
      ops.push(`고인이 플레이어에게 가한 피해 ${fmt(m.damageToPlayer)} — 유의미한 저항의 흔적으로 기록함.`);
    // 4개 선별 (조건 충족 순서 유지, seed로 시작점 회전)
    if (ops.length <= 4) return ops;
    const start = seed % ops.length;
    const out = [];
    for (let i = 0; i < ops.length && out.length < 4; i++) out.push(ops[(start + i) % ops.length]);
    return out;
  }

  function killerMotive(m, seed) {
    if ((m.useEmoticonCount || 0) >= 3)
      return `추정 불가 — 다만 고인이 경기 중 감정표현을 ${m.useEmoticonCount}회 사용한 사실이 확인됨`;
    const pool = [
      '원한 관계 없음 — 통상적 실험 절차로 판단됨',
      '고인의 가방(영웅 등급 재료 포함)을 노린 계획 범행으로 추정',
      '단순 조우 — 루미아섬에서는 흔한 일',
    ];
    return pick(pool, seed);
  }

  // ---------- 처형자 신원조회 (best-effort) ----------
  async function lookupKiller(nickname) {
    try {
      const p = await ERCore.getProfile(nickname);
      return {
        accountLevel: p.accountLevel,
        averageKills: p.averageKills,
        seasonPlays: p.seasonPlays,
        mmr: p.mmr,
      };
    } catch (e) {
      return null;
    }
  }

  // ---------- 진단서 생성 ----------
  async function buildDeathCert(name, gameId) {
    const [meta, matches] = await Promise.all([
      getMeta(),
      ERCore.getMatches(name, { pages: 2 }),
    ]);
    if (gameId && !matches.some(row => row.gameId === gameId)) {
      const record = await ERCore.findGameRecord(name, gameId);
      if (!record) throw new Error('해당 경기에서 이 닉네임의 기록을 찾을 수 없습니다.');
      matches.unshift(record);
    }

    // 사망 기록이 있는 매치만
    const deathMatches = matches.filter(m => extractDeaths(m, meta).length > 0);
    if (!deathMatches.length) {
      const e = new Error(`'${name}'님은 조회한 최근 ${matches.length}판 내 사망 상세 기록이 없습니다.`);
      e.status = 404;
      throw e;
    }

    const m = gameId ? deathMatches.find(x => x.gameId === gameId) : deathMatches[0];
    if (!m) throw new Error('지정한 경기에 사망 상세 기록이 없습니다.');
    const deaths = extractDeaths(m, meta);
    const finalDeath = deaths[deaths.length - 1];
    const seed = hashStr(name + ':' + m.gameId);

    const victimChar = meta.charById.get(m.characterNum) || null;
    const skin = victimChar && (victimChar.skins.find(s => s.code === m.skinCode) || victimChar.skins[0]);

    const start = new Date(m.startDtm);
    const deathAt = new Date(start.getTime() + (m.playTime || 0) * 1000);
    const elapsedMin = Math.floor((m.playTime || 0) / 60);
    const elapsedSec = (m.playTime || 0) % 60;

    // 처형자 전과 조회 (플레이어에게 죽은 경우만)
    const killerRecord = finalDeath.kind === 'player' && finalDeath.killerNickname
      ? await lookupKiller(finalDeath.killerNickname)
      : null;

    // 사망의 종류 체크박스
    const manner = finalDeath.kind === 'player' ? 'homicide'
      : (finalDeath.kind === 'wildAnimal' || finalDeath.kind === 'monster') ? 'wildAnimal'
      : 'zone';

    // 발급 가능한 다른 사망 기록 (선택 UI용)
    const recentDeaths = deathMatches.slice(0, 10).map(x => {
      const ds = extractDeaths(x, meta);
      const fd = ds[ds.length - 1];
      const c = meta.charById.get(x.characterNum);
      return {
        gameId: x.gameId,
        startDtm: x.startDtm,
        characterName: c ? c.name : '?',
        gameRank: x.gameRank,
        killerLabel: fd.kind === 'player'
          ? `${fd.killerNickname} (${fd.killerCharName})`
          : fd.killerCharName,
      };
    });

    const certNo = `AGL-${deathAt.getFullYear()}-${pad(m.gameId % 100000, 5)}-${pad(seed % 1000, 3)}`;

    return {
      certNo,
      issuedAt: fmtDate(new Date()),
      victim: {
        nickname: m.nickname,
        accountLevel: m.accountLevel ?? null,
        characterName: victimChar ? victimChar.name : '불상',
        characterKey: victimChar ? victimChar.key : null,
        characterLevel: m.characterLevel,
        weaponName: meta.masteryById.get(m.bestWeapon) || null,
        weaponLevel: m.bestWeaponLevel,
        portrait: skin ? ERCore.skinImgUrl(skin.imageName) : (victimChar ? ERCore.charImgUrl(victimChar.key) : null),
        mmrBefore: m.mmrBefore ?? null,
        mmrGain: m.mmrGain ?? null,
      },
      death: {
        gameId: m.gameId,
        dateTime: fmtDateTime(deathAt),
        elapsed: `입섬 ${elapsedMin}분 ${elapsedSec}초 경과 시점`,
        placeName: finalDeath.placeName || '불상',
        gameRank: m.gameRank,
        manner,
        priorDeaths: deaths.length - 1,
        priorDeathsDetail: deaths.slice(0, -1).map((d, i) => ({
          nth: i + 1,
          by: d.kind === 'player' ? `${d.killerNickname} (${d.killerCharName})` : d.killerCharName,
          placeName: d.placeName,
        })),
      },
      causeChain: buildCauseChain(m, finalDeath, seed),
      killer: {
        kind: finalDeath.kind,
        nickname: finalDeath.killerNickname,
        characterName: finalDeath.killerCharName,
        mugshot: finalDeath.killerCharKey ? ERCore.charImgUrl(finalDeath.killerCharKey) : null,
        weaponName: finalDeath.weaponName,
        cause: finalDeath.cause,
        motive: killerMotive(m, seed),
        record: killerRecord,
      },
      opinions: buildOpinions(m, deaths, victimChar, seed),
      stats: {
        playerKill: m.playerKill, playerAssistant: m.playerAssistant,
        monsterKill: m.monsterKill, damageToPlayer: m.damageToPlayer,
        fishingCount: m.fishingCount, useEmoticonCount: m.useEmoticonCount,
      },
      recentDeaths,
    };
  }

  // 구 /api/deathcert 라우트의 검증·에러 문구까지 포함한 진입점.
  async function deathCert(name, gameId) {
    name = (name || '').trim();
    if (!name) throw new Error('닉네임을 입력하세요.');
    try {
      return await buildDeathCert(name, parseInt(gameId, 10) || null);
    } catch (e) {
      if (e.status === 404 && !String(e.message).includes('기록')) {
        throw new Error('플레이어를 찾을 수 없습니다. 닉네임을 확인해주세요.');
      }
      throw e;
    }
  }

  window.ER = { deathCert };

})();
