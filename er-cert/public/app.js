// ER 실험체 자격증 발급 프론트엔드
const $ = (s) => document.querySelector(s);
const fmt = (n) => (n ?? 0).toLocaleString('ko-KR');

let characters = [];
let selectedChar = null;
let selectedSkin = null; // { id, name, grade, imageName }
let selectedStyle = 'aglaia'; // 'aglaia' | 'classic'
let lastCert = null;

const GRADE_LABEL = { 1: '기본', 2: '레어', 3: '에픽', 4: '레전더리', 5: '이터니티' };

const WEAPON_KO = {
  Arcana: '아르카나', AssaultRifle: '돌격 소총', Axe: '도끼', Bat: '방망이', Bow: '활',
  Camera: '카메라', CrossBow: '석궁', DirectFire: '암기', DualSword: '쌍검', Glove: '글러브',
  Guitar: '기타', Hammer: '망치', HighAngleFire: '투척', Nunchaku: '쌍절곤', OneHandSword: '단검',
  Pistol: '권총', Rapier: '레이피어', SniperRifle: '저격 소총', Spear: '창', Tonfa: '톤파',
  TwoHandSword: '양손검', VFArm: 'VF 의수', Whip: '채찍',
};
const ARCHETYPE_KO = {
  Assasin: '암살 특화', Warrior: '근접 전투 특화', Tanker: '방어 · 교전 유지 특화',
  Mage: '스킬 운용 특화', Marksman: '원거리 사격 특화', Supporter: '지원 · 통제 특화',
};

// 전적 기반 연구소장 소견 자동 생성
function buildOpinion(d) {
  const c = d.charStats;
  const parts = [];
  const at = (d.character.archeTypes || []).map(a => ARCHETYPE_KO[a]).filter(Boolean);
  if (at.length) parts.push(`${at[0]} 실험체`);
  parts.push(`관측 표본 ${fmt(c.play)}회`);
  const flags = [];
  if (c.winRate >= 15) flags.push('우승 빈도 우수');
  if (c.top3Rate >= 40) flags.push('생존 능력 우수');
  if (c.avgDamage >= 15000) flags.push('화력 특화 경향');
  if (c.play >= 1000) flags.push('표본 신뢰도 매우 높음');
  else if (c.play >= 300) flags.push('표본 신뢰도 양호');
  if (!flags.length) flags.push('지속 관측 요망');
  parts.push(...flags.slice(0, 2));
  return parts.join(' · ');
}

// ---------- 캐릭터 그리드 ----------
async function loadCharacters() {
  characters = await DAK.getCharacters();
  characters.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  renderGrid('');
}

function renderGrid(filter) {
  const grid = $('#char-grid');
  grid.innerHTML = '';
  const list = characters.filter(c => !filter || c.name.includes(filter) || c.key.toLowerCase().includes(filter.toLowerCase()));
  if (!list.length) { grid.innerHTML = '<div class="grid-loading">검색 결과 없음</div>'; return; }
  for (const c of list) {
    const cell = document.createElement('div');
    cell.className = 'char-cell' + (selectedChar?.id === c.id ? ' selected' : '');
    cell.innerHTML = `<img src="${DAK.charImgUrl(c.key)}" crossorigin="anonymous" loading="lazy" alt="${c.name}"><div class="nm">${c.name}</div>`;
    cell.onclick = () => selectCharacter(c, cell);
    grid.appendChild(cell);
  }
}

function selectCharacter(c, cell) {
  selectedChar = c;
  $('#picked-label').textContent = `— ${c.name}`;
  document.querySelectorAll('.char-cell.selected').forEach(el => el.classList.remove('selected'));
  if (cell) cell.classList.add('selected');
  selectedSkin = c.skins[0] || { imageName: `${c.key}_S000`, name: c.name, grade: 1 };
  renderSkinRow();
  updateIssueBtn();
}

// ---------- 스킨 선택 ----------
function renderSkinRow() {
  const field = $('#skin-field');
  const row = $('#skin-row');
  if (!selectedChar || !selectedChar.skins.length) { field.classList.remove('visible'); return; }
  field.classList.add('visible');
  $('#skin-label').textContent = `— ${selectedSkin.name}`;
  row.innerHTML = '';
  for (const s of selectedChar.skins) {
    const cell = document.createElement('div');
    cell.className = 'skin-cell' + (selectedSkin?.imageName === s.imageName ? ' selected' : '');
    cell.innerHTML = `<img src="${DAK.skinImgUrl(s.imageName)}" crossorigin="anonymous" loading="lazy" alt="${s.name}">
      <div class="nm">${s.name}</div><div class="gd">${GRADE_LABEL[s.grade] || ''}</div>`;
    cell.onclick = () => {
      selectedSkin = s;
      $('#skin-label').textContent = `— ${s.name}`;
      row.querySelectorAll('.skin-cell.selected').forEach(el => el.classList.remove('selected'));
      cell.classList.add('selected');
      if (lastCert && !$('#cert-section').hidden) rerenderCert();
    };
    row.appendChild(cell);
  }
}

async function rerenderCert() {
  await renderCertificate(lastCert);
  syncUrl();
}

function updateIssueBtn() {
  $('#issue-btn').disabled = !($('#nickname').value.trim() && selectedChar);
}

function syncUrl(push) {
  if (!lastCert) return;
  const q = new URLSearchParams({ name: lastCert.player.name, char: lastCert.character.id });
  if (selectedSkin && selectedSkin.imageName !== `${lastCert.character.key}_S000`) q.set('skin', selectedSkin.imageName);
  if (selectedStyle !== 'aglaia') q.set('style', selectedStyle);
  const url = '?' + q.toString();
  // 발급 순간에만 히스토리를 쌓아 뒤로가기로 메인에 돌아올 수 있게 한다
  if (push && location.search !== url) history.pushState({ view: 'cert' }, '', url);
  else history.replaceState({ view: 'cert' }, '', url);
}

function showForm() {
  $('#cert-section').hidden = true;
  $('#loading-section').hidden = true;
  $('#form-section').hidden = false;
  $('#form-error').hidden = true;
  window.scrollTo({ top: 0 });
}

window.addEventListener('popstate', () => {
  const p = new URLSearchParams(location.search);
  if (p.get('name') && p.get('char') && lastCert) {
    $('#form-section').hidden = true;
    $('#cert-section').hidden = false;
  } else {
    showForm();
  }
});

// ---------- 발급 ----------
const LOADING_MSGS = [
  '아글라이아 중앙 서버 접속 중…',
  '루미아 섬 실험 로그 수집 중… (오프닝 → 미들게임 → 엔드게임)',
  '전 시즌 VF 잔류 반응 측정 중… (랭크 · 일반 · 코발트 프로토콜)',
  'Dr. 안젤리카 검토 의견 수신 중…',
  '연구소장 에녹 하그리브스 결재 대기 중…',
];
let loadingTimer = null;

async function issue(name, charId) {
  $('#form-section').hidden = true;
  $('#cert-section').hidden = true;
  $('#loading-section').hidden = false;
  let i = 0;
  $('#loading-msg').textContent = LOADING_MSGS[0];
  loadingTimer = setInterval(() => { $('#loading-msg').textContent = LOADING_MSGS[++i % LOADING_MSGS.length]; }, 1400);

  try {
    const data = await DAK.issueCertificate(name, charId);
    lastCert = data;
    await renderCertificate(data);
    renderSeasonTable(data);
    $('#cert-section').hidden = false;
    syncUrl(true);
  } catch (e) {
    $('#form-section').hidden = false;
    const err = $('#form-error');
    err.textContent = e.message;
    err.hidden = false;
  } finally {
    clearInterval(loadingTimer);
    $('#loading-section').hidden = true;
  }
}

// ---------- 자격증 SVG ----------
async function imgToDataUri(url) {
  const blob = await (await fetch(url)).blob();
  return await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
}

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[ch]));
}

const BODY_FONT = `GowunBatang, AppleMyungjo, Batang, serif`;
const TITLE_FONT = `SongMyung, GowunBatang, AppleMyungjo, serif`;

async function renderCertificate(d) {
  const skinImage = selectedSkin ? DAK.skinImgUrl(selectedSkin.imageName) : DAK.charImgUrl(d.character.key);
  const photo = await imgToDataUri(skinImage);
  const issued = new Date(d.issuedAt);
  const ctx = {
    d,
    photo,
    dateStr: `${issued.getFullYear()}년 ${String(issued.getMonth() + 1).padStart(2, '0')}월 ${String(issued.getDate()).padStart(2, '0')}일`,
    isDefaultSkin: !selectedSkin || selectedSkin.imageName === `${d.character.key}_S000`,
    skinName: selectedSkin ? selectedSkin.name : '',
    subjects: (d.character.masteries || []).map(w => WEAPON_KO[w] || w).join(' · ') || '—',
    statRows: [
      ['총 출전', `${fmt(d.charStats.play)} 판`, '우승', `${fmt(d.charStats.win)} 회 (${d.charStats.winRate}%)`],
      ['TOP 3', `${fmt(d.charStats.top3)} 회 (${d.charStats.top3Rate}%)`, '평균 순위', `${d.charStats.avgPlace} 위`],
      ['평균 킬 / 어시', `${d.charStats.avgKill} / ${d.charStats.avgAssist}`, '평균 대미지', fmt(d.charStats.avgDamage)],
      ['누적 생존 시간', `${fmt(Math.round(d.charStats.playHours))} 시간`, '최고 MMR', d.bestMmr ? `${fmt(d.bestMmr.mmr)} (${d.bestMmr.season})` : '—'],
    ],
  };
  $('#cert-wrap').innerHTML = selectedStyle === 'classic' ? classicSvg(ctx) : aglaiaSvg(ctx);
}

// ===== 검정원 표준 양식 (클래식 종이 증서) =====
function classicSvg({ d, photo, dateStr, isDefaultSkin, skinName, statRows }) {
  const body = BODY_FONT, title = TITLE_FONT;
  const navy = '#1c3a5e', gold = '#a8862d', ink = '#2b2b2b';
  const certNo = d.certNo.replace(/^AGL/, 'ER');
  const statSvg = statRows.map(([k1, v1, k2, v2], i) => {
    const y = 390 + i * 34;
    return `
      <text x="356" y="${y}" font-size="15" fill="#6d6d6d" font-family="${body}">${k1}</text>
      <text x="470" y="${y}" font-size="16" fill="${ink}" font-family="${body}" font-weight="bold">${v1}</text>
      <text x="652" y="${y}" font-size="15" fill="#6d6d6d" font-family="${body}">${k2}</text>
      <text x="768" y="${y}" font-size="16" fill="${ink}" font-family="${body}" font-weight="bold">${v2}</text>`;
  }).join('');

  return `
<svg id="cert-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 707" font-family="${body}">
  <rect width="1000" height="707" fill="#f7f2e2"/>
  <g opacity="0.05" stroke="${navy}" fill="none">
    ${Array.from({ length: 14 }, (_, i) => `<circle cx="500" cy="353" r="${60 + i * 34}"/>`).join('')}
  </g>
  <rect x="18" y="18" width="964" height="671" fill="none" stroke="${navy}" stroke-width="5"/>
  <rect x="28" y="28" width="944" height="651" fill="none" stroke="${gold}" stroke-width="1.6"/>
  <rect x="33" y="33" width="934" height="641" fill="none" stroke="${navy}" stroke-width="0.8" opacity="0.5"/>
  ${[[38, 38, 1, 1], [962, 38, -1, 1], [38, 669, 1, -1], [962, 669, -1, -1]].map(([x, y, sx, sy]) =>
    `<path d="M ${x} ${y + sy * 26} L ${x} ${y} L ${x + sx * 26} ${y}" fill="none" stroke="${gold}" stroke-width="2.4"/>`).join('')}

  <text x="90" y="84" font-size="16" fill="${ink}">제 ${certNo} 호</text>
  <g transform="translate(500,88)">
    <circle r="22" fill="none" stroke="${gold}" stroke-width="1.6"/>
    <circle r="17" fill="none" stroke="${navy}" stroke-width="0.8"/>
    <text y="7" text-anchor="middle" font-size="19" fill="${navy}">✦</text>
  </g>
  <text x="500" y="140" text-anchor="middle" font-size="15" letter-spacing="5" fill="#5a5a5a" font-family="${title}">루미아섬 실험체 자격 검정원</text>
  <text x="500" y="198" text-anchor="middle" font-size="43" letter-spacing="13" fill="${ink}" font-family="${title}">실험체 운용 자격증</text>
  <text x="500" y="226" text-anchor="middle" font-size="12" letter-spacing="3" fill="#8a8a8a">CERTIFICATE OF LUMIA ISLAND TEST SUBJECT OPERATION</text>

  <rect x="90" y="266" width="210" height="210" fill="#fff" stroke="${navy}" stroke-width="2"/>
  <image href="${photo}" x="106" y="282" width="178" height="178" preserveAspectRatio="xMidYMid meet"/>
  <rect x="90" y="266" width="210" height="210" fill="none" stroke="${gold}" stroke-width="0.8"/>
  <text x="195" y="502" text-anchor="middle" font-size="17" fill="${ink}">실험체 : ${d.character.name} (${d.character.key})</text>
  ${isDefaultSkin ? '' : `<text x="195" y="526" text-anchor="middle" font-size="12.5" fill="#8a7340">지정 스킨 : ${escapeXml(skinName)}</text>`}

  <text x="356" y="288" font-size="18" fill="#6d6d6d">성 명</text>
  <text x="470" y="288" font-size="22" font-weight="bold" fill="${ink}">${escapeXml(d.player.name)}</text>
  <text x="910" y="288" text-anchor="end" font-size="14" fill="#8a8a8a">계정 Lv. ${d.player.accountLevel} · 활동 ${d.seasonsPlayed}개 시즌</text>

  <text x="356" y="332" font-size="18" fill="#6d6d6d">자격 등급</text>
  <text x="470" y="335" font-size="27" font-weight="bold" fill="#8c1f1f">${d.character.name} 운용 ${d.grade}</text>
  <text x="356" y="358" font-size="11" letter-spacing="2" fill="#9a9a9a">${d.gradeEn} · 검정 점수 ${d.score}/100</text>

  <line x1="356" y1="370" x2="910" y2="370" stroke="${gold}" stroke-width="0.8"/>
  ${statSvg}
  <line x1="356" y1="526" x2="910" y2="526" stroke="${gold}" stroke-width="0.8"/>

  <text x="500" y="568" text-anchor="middle" font-size="15.5" fill="${ink}">위 사람은 루미아 섬에서 실시한 실험체 운용 능력 검정에서 전 시즌 · 전 게임 모드에 걸쳐</text>
  <text x="500" y="592" text-anchor="middle" font-size="15.5" fill="${ink}">위와 같은 기록을 달성하였으므로 「실험체 자격 검정 규칙」에 따라 이 증서를 수여함.</text>
  <text x="500" y="628" text-anchor="middle" font-size="17" fill="${ink}">${dateStr}</text>
  <text x="500" y="660" text-anchor="middle" font-size="22" letter-spacing="7" fill="${ink}" font-family="${title}">루미아섬 실험체 자격 검정원장</text>
  <g transform="translate(792,636)">
    <rect x="-30" y="-30" width="60" height="60" rx="7" fill="none" stroke="#c0392b" stroke-width="2.6" opacity="0.85"/>
    <text y="-6" text-anchor="middle" font-size="19" font-weight="bold" fill="#c0392b" opacity="0.85">검정</text>
    <text y="18" text-anchor="middle" font-size="19" font-weight="bold" fill="#c0392b" opacity="0.85">원장</text>
  </g>
  <text x="500" y="702" text-anchor="middle" font-size="10" fill="#a0a0a0">랭크/일반/코발트 통합 · 재미로 발급된 증서로 법적 효력이 없음</text>
</svg>`;
}

// ===== 아글라이아 양식 (다크 기밀 연구 문서) =====
function aglaiaSvg({ d, photo, dateStr, isDefaultSkin, skinName, subjects, statRows }) {
  const body = BODY_FONT, title = TITLE_FONT;
  const teal = '#3fd8c7', line = '#24434f', txt = '#e6f2f0', mut = '#8fa9a6', dim = '#5f7d7a', red = '#e0554a', gold = '#d4b46a';

  // 육각형 꼭짓점 좌표 (pointy-top)
  const hex = (cx, cy, r) => Array.from({ length: 6 }, (_, i) => {
    const a = Math.PI / 180 * (60 * i - 90);
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
  }).join(' ');

  // 배경 장식: 격자 + 동심 육각형
  const grid = [
    ...Array.from({ length: 19 }, (_, i) => `M ${50 + i * 50} 16 V 691`),
    ...Array.from({ length: 13 }, (_, i) => `M 16 ${50 + i * 50} H 984`),
  ].join(' ');
  const hexRings = Array.from({ length: 8 }, (_, i) =>
    `<polygon points="${hex(500, 353, 90 + i * 52)}" fill="none"/>`).join('');

  // 관리 바코드: 증서번호 문자로 막대 폭 결정
  let bx = 90;
  const barcode = d.certNo.split('').flatMap((ch) => {
    const w = (ch.charCodeAt(0) % 3) + 1;
    const bar = `<rect x="${bx}" y="640" width="${w}" height="20" fill="${mut}" opacity="0.8"/>`;
    bx += w + 2.5;
    return [bar];
  }).join('');

  const statSvg = statRows.map(([k1, v1, k2, v2], i) => {
    const y = 390 + i * 34;
    return `
      <text x="356" y="${y}" font-size="14.5" fill="${mut}" font-family="${body}">${k1}</text>
      <text x="470" y="${y}" font-size="16" fill="${txt}" font-family="${body}" font-weight="bold">${v1}</text>
      <text x="652" y="${y}" font-size="14.5" fill="${mut}" font-family="${body}">${k2}</text>
      <text x="768" y="${y}" font-size="16" fill="${txt}" font-family="${body}" font-weight="bold">${v2}</text>`;
  }).join('');

  // 사진 프레임 모서리 틱
  const ticks = [[88, 264, 1, 1], [304, 264, -1, 1], [88, 480, 1, -1], [304, 480, -1, -1]].map(([x, y, sx, sy]) =>
    `<path d="M ${x} ${y + sy * 14} L ${x} ${y} L ${x + sx * 14} ${y}" fill="none" stroke="${teal}" stroke-width="2"/>`).join('');

  return `
<svg id="cert-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 707" font-family="${body}">
  <defs>
    <linearGradient id="agbg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0c1a26"/><stop offset="1" stop-color="#0a2028"/>
    </linearGradient>
  </defs>
  <rect width="1000" height="707" fill="url(#agbg)"/>
  <path d="${grid}" stroke="${teal}" stroke-width="0.5" opacity="0.045" fill="none"/>
  <g stroke="${teal}" opacity="0.05">${hexRings}</g>

  <!-- 프레임 -->
  <rect x="16" y="16" width="968" height="675" fill="none" stroke="${line}" stroke-width="1.4"/>
  <rect x="24" y="24" width="952" height="659" fill="none" stroke="${line}" stroke-width="0.6" opacity="0.7"/>
  ${[[30, 30, 1, 1], [970, 30, -1, 1], [30, 677, 1, -1], [970, 677, -1, -1]].map(([x, y, sx, sy]) =>
    `<path d="M ${x} ${y + sy * 28} L ${x} ${y} L ${x + sx * 28} ${y}" fill="none" stroke="${teal}" stroke-width="2.2" opacity="0.9"/>`).join('')}

  <!-- 문서 번호 -->
  <text x="90" y="62" font-size="9" letter-spacing="2" fill="${dim}">AGLAIA DOCUMENT NO.</text>
  <text x="90" y="84" font-size="17" fill="${txt}">${d.certNo}</text>

  <!-- 대외비 -->
  <g transform="translate(880,76) rotate(-7)">
    <rect x="-62" y="-20" width="124" height="40" rx="4" fill="none" stroke="${red}" stroke-width="2" opacity="0.9"/>
    <text y="-1" text-anchor="middle" font-size="17" font-weight="bold" fill="${red}" opacity="0.9">대 외 비</text>
    <text y="13" text-anchor="middle" font-size="7.5" letter-spacing="1" fill="${red}" opacity="0.9">CONFIDENTIAL · CLEARANCE LV.3</text>
  </g>

  <!-- 표장 -->
  <g transform="translate(500,86)">
    <polygon points="${hex(0, 0, 26)}" fill="none" stroke="${teal}" stroke-width="1.6" opacity="0.9"/>
    <polygon points="${hex(0, 0, 20)}" fill="none" stroke="${line}" stroke-width="0.8"/>
    <ellipse rx="13" ry="5.5" fill="none" stroke="${teal}" stroke-width="0.9" transform="rotate(30)" opacity="0.9"/>
    <ellipse rx="13" ry="5.5" fill="none" stroke="${teal}" stroke-width="0.9" transform="rotate(-30)" opacity="0.9"/>
    <circle r="2.6" fill="${teal}"/>
  </g>
  <text x="500" y="140" text-anchor="middle" font-size="14.5" letter-spacing="5" fill="#9fc4bf" font-family="${title}">아글라이아 연구소 실험체 관리부</text>

  <text x="500" y="198" text-anchor="middle" font-size="43" letter-spacing="13" fill="${txt}" font-family="${title}">실험체 운용 자격증</text>
  <line x1="330" y1="212" x2="670" y2="212" stroke="${teal}" stroke-width="0.8" opacity="0.55"/>
  <text x="500" y="230" text-anchor="middle" font-size="11.5" letter-spacing="3" fill="${dim}">AGLAIA · CERTIFICATE OF TEST SUBJECT OPERATION</text>

  <!-- 증명사진 -->
  <rect x="88" y="264" width="216" height="216" fill="#10222e" stroke="${line}" stroke-width="1.2"/>
  <image href="${photo}" x="106" y="282" width="180" height="180" preserveAspectRatio="xMidYMid meet"/>
  ${ticks}
  <text x="196" y="502" text-anchor="middle" font-size="17" fill="${txt}">실험체 : ${d.character.name} (${d.character.key})</text>
  <text x="196" y="525" text-anchor="middle" font-size="12.5" fill="${mut}">검정 과목 : ${subjects}</text>
  ${isDefaultSkin ? '' : `<text x="196" y="545" text-anchor="middle" font-size="12" fill="${gold}">지정 스킨 : ${escapeXml(skinName)}</text>`}

  <!-- 인적 사항 -->
  <text x="356" y="288" font-size="17" fill="${mut}">성 명</text>
  <text x="470" y="288" font-size="22" font-weight="bold" fill="${txt}">${escapeXml(d.player.name)}</text>
  <text x="910" y="288" text-anchor="end" font-size="13.5" fill="${dim}">계정 Lv. ${d.player.accountLevel} · 활동 ${d.seasonsPlayed}개 시즌</text>

  <text x="356" y="332" font-size="17" fill="${mut}">자격 등급</text>
  <text x="470" y="335" font-size="27" font-weight="bold" fill="${teal}">${d.character.name} 운용 ${d.grade}</text>
  <text x="356" y="358" font-size="11" letter-spacing="2" fill="${dim}">${d.gradeEn} · 검정 점수 ${d.score}/100</text>

  <line x1="356" y1="370" x2="910" y2="370" stroke="${line}" stroke-width="1"/>
  ${statSvg}
  <line x1="356" y1="526" x2="910" y2="526" stroke="${line}" stroke-width="1"/>
  <text x="910" y="545" text-anchor="end" font-size="12" fill="${teal}" opacity="0.9">본 검정 과정에서 회수된 VF 크레딧 : ${fmt(d.charStats.totalGainVFCredit)} VF</text>

  <text x="500" y="570" text-anchor="middle" font-size="15" fill="#cfe0dd">위 사람은 본 연구소가 루미아 섬에서 실시한 실험체 운용 능력 검정(전 시즌 · 랭크/일반/코발트 프로토콜)에서</text>
  <text x="500" y="593" text-anchor="middle" font-size="15" fill="#cfe0dd">오프닝부터 엔드게임까지 전 단계의 관측 기록을 인정하여 「실험체 관리 규정」 제7조에 따라 이 증서를 수여함.</text>
  <text x="500" y="615" text-anchor="middle" font-size="12.5" fill="${mut}">〔 소견 : ${buildOpinion(d)} 〕</text>

  <text x="500" y="638" text-anchor="middle" font-size="15.5" fill="${txt}">${dateStr}</text>
  <text x="500" y="666" text-anchor="middle" font-size="22" letter-spacing="6" fill="${txt}" font-family="${title}">아글라이아 연구소장 에녹 하그리브스</text>
  <g transform="translate(806,646)">
    <rect x="-28" y="-28" width="56" height="56" rx="7" fill="none" stroke="${red}" stroke-width="2.4" opacity="0.9"/>
    <text y="-5" text-anchor="middle" font-size="17" font-weight="bold" fill="${red}" opacity="0.9">연구</text>
    <text y="17" text-anchor="middle" font-size="17" font-weight="bold" fill="${red}" opacity="0.9">소장</text>
  </g>

  <!-- 관리 바코드 -->
  ${barcode}
  <text x="90" y="674" font-size="8" letter-spacing="1.5" fill="${dim}">${d.certNo} · SPECIMEN CONTROL DIV.</text>

  <text x="500" y="702" text-anchor="middle" font-size="9.5" fill="${dim}">AGLAIA RESEARCH DIVISION · 랭크/일반/코발트 프로토콜 통합 · 재미로 발급된 증서로 법적 효력이 없음</text>
</svg>`;
}

// ---------- 시즌별 상세 ----------
function renderSeasonTable(d) {
  const MODE_INFO = [
    ['rank', '랭크', ''],
    ['normal', '일반', ''],
    ['cobalt', '코발트 프로토콜', 'cobalt'],
  ];
  const modeCards = (d.modeStats ? MODE_INFO : []).map(([key, label, cls]) => {
    const m = d.modeStats[key];
    return `
    <div class="mode-card ${cls}">
      <div class="mk">${label}</div>
      <div class="mv">${fmt(m.play)} 판</div>
      <div class="ms">${m.play ? `${fmt(m.win)}승 (${m.winRate}%) · 평균 대미지 ${fmt(m.avgDamage)}` : '기록 없음'}</div>
    </div>`;
  }).join('');

  const rows = d.perSeason.map(s => `
    <tr><td>${s.seasonName}</td><td>${fmt(s.play)}</td><td>${fmt(s.win)}</td>
    <td>${s.play ? (s.win / s.play * 100).toFixed(1) : 0}%</td><td>${fmt(s.top3)}</td>
    <td>${s.play ? Math.round(s.damageToPlayer / s.play).toLocaleString('ko-KR') : 0}</td></tr>`).join('');
  $('#season-detail').innerHTML = `
    <h3>${d.character.name} 모드별 관측 기록</h3>
    <div class="mode-cards">${modeCards}</div>
    <h3>${d.character.name} 시즌별 관측 기록${d.failedSeasons ? ` (일부 시즌 ${d.failedSeasons}건 조회 실패)` : ''}</h3>
    <div class="table-scroll"><table class="season-table">
      <tr><th>시즌</th><th>판수</th><th>우승</th><th>승률</th><th>TOP3</th><th>평균 대미지</th></tr>
      ${rows}
    </table></div>`;
}

// ---------- PNG 저장 (폰트 임베드) ----------
let fontCssPromise = null;
async function getEmbeddedFontCss() {
  if (!fontCssPromise) {
    fontCssPromise = (async () => {
      const fonts = [
        ['GowunBatang', 400, '/fonts/gowun-batang.woff'],
        ['GowunBatang', 700, '/fonts/gowun-batang-bold.woff'],
        ['SongMyung', 400, '/fonts/song-myung.woff'],
      ];
      const faces = await Promise.all(fonts.map(async ([fam, wt, url]) => {
        const uri = await imgToDataUri(url);
        return `@font-face{font-family:'${fam}';font-weight:${wt};src:url(${uri}) format('woff')}`;
      }));
      return faces.join('\n');
    })();
  }
  return fontCssPromise;
}

async function downloadPng() {
  const btn = $('#download-btn');
  btn.disabled = true; btn.textContent = '이미지 생성 중…';
  try {
    const svg = $('#cert-svg').cloneNode(true);
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.textContent = await getEmbeddedFontCss();
    svg.insertBefore(style, svg.firstChild);
    const xml = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = 1000 * scale; canvas.height = 707 * scale;
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `ER자격증_${lastCert.player.name}_${lastCert.character.name}.png`;
    a.click();
  } finally {
    btn.disabled = false; btn.textContent = 'PNG로 저장';
  }
}

// ---------- 이벤트 ----------
document.querySelectorAll('.style-cell').forEach(cell => {
  cell.addEventListener('click', () => {
    selectedStyle = cell.dataset.style;
    document.querySelectorAll('.style-cell.selected').forEach(el => el.classList.remove('selected'));
    cell.classList.add('selected');
    if (lastCert && !$('#cert-section').hidden) rerenderCert();
  });
});
$('#nickname').addEventListener('input', updateIssueBtn);
$('#char-search').addEventListener('input', e => renderGrid(e.target.value.trim()));
$('#issue-btn').addEventListener('click', () => issue($('#nickname').value.trim(), selectedChar.id));
$('#download-btn').addEventListener('click', downloadPng);
$('#copy-link-btn').addEventListener('click', async () => {
  await navigator.clipboard.writeText(location.href);
  $('#copy-link-btn').textContent = '복사 완료!';
  setTimeout(() => { $('#copy-link-btn').textContent = '발급 링크 복사'; }, 1500);
});
$('#again-btn').addEventListener('click', () => {
  history.pushState({ view: 'form' }, '', location.pathname);
  showForm();
});

// ---------- 초기화 ----------
(async function init() {
  await loadCharacters();
  const p = new URLSearchParams(location.search);
  const name = p.get('name'), charId = parseInt(p.get('char'), 10), skinName = p.get('skin');
  if (p.get('style') === 'classic') {
    selectedStyle = 'classic';
    document.querySelectorAll('.style-cell').forEach(el =>
      el.classList.toggle('selected', el.dataset.style === 'classic'));
  }
  if (name) $('#nickname').value = name;
  if (charId) {
    const c = characters.find(x => x.id === charId);
    if (c) {
      selectCharacter(c, null);
      renderGrid('');
      if (skinName) {
        const s = c.skins.find(x => x.imageName === skinName);
        if (s) { selectedSkin = s; renderSkinRow(); }
      }
    }
  }
  updateIssueBtn();
  if (name && selectedChar) issue(name, selectedChar.id);
})();
