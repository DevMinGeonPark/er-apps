// 루미아 손해보험 — 과실비율 산정 프론트엔드
const $ = (s) => document.querySelector(s);
const fmt = (n) => (n ?? 0).toLocaleString('ko-KR');
const PCOLORS = ['#3a62a8', '#b4691f', '#2e8f5e']; // 검증된 식별 색 (종이 배경)
const BODY_FONT = `GowunBatang, AppleMyungjo, Batang, serif`;
const TITLE_FONT = `SongMyung, GowunBatang, AppleMyungjo, serif`;

let lastResult = null;

// ---------- 초기화 ----------
async function loadSeasons() {
  const seasons = await DAK.seasons();
  $('#season').innerHTML = '<option value="auto">자동 (최근 기록 있는 시즌)</option>'
    + seasons.map(s => `<option value="${s.key}">${s.name}</option>`).join('');
}
function updateBtn() { $('#go').disabled = !($('#me').value.trim() && $('#mate1').value.trim()); }
['me', 'mate1', 'mate2'].forEach(id => $('#' + id).addEventListener('input', updateBtn));

const LOADING_MSGS = [
  '사고 접수 중…',
  '양측 매치 기록 대조 중… (블랙박스 확보)',
  '사고 현장 감식 중…',
  '약관 조항 대조 중…',
  '분쟁심의위원회 심의 중…',
];
let loadingTimer = null;

async function run() {
  const me = $('#me').value.trim();
  const mates = [$('#mate1').value.trim(), $('#mate2').value.trim()].filter(Boolean);
  const q = new URLSearchParams({
    me, mates: mates.join(','), season: $('#season').value,
    mode: $('#mode').value, pages: $('#pages').value,
  });
  const demo = new URLSearchParams(location.search).get('demo');
  if (demo) q.set('demo', demo);
  $('#form-section').hidden = true;
  $('#result-section').hidden = true;
  $('#loading-section').hidden = false;
  let i = 0;
  $('#loading-msg').textContent = LOADING_MSGS[0];
  loadingTimer = setInterval(() => { $('#loading-msg').textContent = LOADING_MSGS[++i % LOADING_MSGS.length]; }, 1500);
  try {
    const data = await DAK.assessRequest({ ...Object.fromEntries(q), mates });
    lastResult = data;
    await renderPaper(data);
    renderDetail(data);
    $('#result-section').hidden = false;
    history.replaceState(null, '', '?' + q.toString());
  } catch (e) {
    $('#form-section').hidden = false;
    $('#form-error').textContent = e.message;
    $('#form-error').hidden = false;
  } finally {
    clearInterval(loadingTimer);
    $('#loading-section').hidden = true;
  }
}

// ---------- 산정서 SVG ----------
const imgToDataUri = (url) => DAK.imgToDataUri(url);
function esc(s) { return String(s).replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c])); }

async function renderPaper(d) {
  const ink = '#232323', navy = '#24425f', gold = '#a8862d', red = '#b8382a', paper = '#fdfcf8';
  const issued = new Date(d.issuedAt);
  const dateStr = `${issued.getFullYear()}년 ${String(issued.getMonth() + 1).padStart(2, '0')}월 ${String(issued.getDate()).padStart(2, '0')}일`;
  const n = d.names.length;

  // 무사고: 확인서 발급
  if (d.noAccident) {
    $('#paper').innerHTML = `
<svg id="paper-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 707" font-family="${BODY_FONT}">
  <rect width="1000" height="707" fill="${paper}"/>
  <rect x="20" y="20" width="960" height="667" fill="none" stroke="${navy}" stroke-width="3.4"/>
  <rect x="30" y="30" width="940" height="647" fill="none" stroke="${gold}" stroke-width="1"/>
  <text x="500" y="86" text-anchor="middle" font-size="15" letter-spacing="5" fill="#666" font-family="${TITLE_FONT}">루미아 손해보험(주)</text>
  <text x="500" y="180" text-anchor="middle" font-size="46" letter-spacing="18" fill="${ink}" font-family="${TITLE_FONT}">무사고 확인서</text>
  <text x="500" y="300" text-anchor="middle" font-size="19" fill="${ink}">${d.names.map(esc).join(' · ')}</text>
  <text x="500" y="352" text-anchor="middle" font-size="15.5" fill="${ink}">위 피보험자 일동은 조회 기간 내 함께한 ${d.sharedGames}판에서 심의 대상 사고가 발견되지 않았음을 확인함.</text>
  <text x="500" y="384" text-anchor="middle" font-size="15.5" fill="${ink}">호흡이 완벽한 팀입니다. 보험료 할인 등급(1Z) 적용 대상.</text>
  <g transform="translate(500,470) rotate(-8)">
    <rect x="-92" y="-34" width="184" height="68" rx="8" fill="none" stroke="#1f7a4d" stroke-width="3"/>
    <text y="10" text-anchor="middle" font-size="34" font-weight="bold" fill="#1f7a4d" letter-spacing="8">무 사 고</text>
  </g>
  <text x="500" y="600" text-anchor="middle" font-size="16" fill="${ink}">${dateStr}</text>
  <text x="500" y="634" text-anchor="middle" font-size="20" letter-spacing="6" fill="${ink}" font-family="${TITLE_FONT}">루미아 손해사정법인</text>
  <text x="500" y="688" text-anchor="middle" font-size="10" fill="#999">data: dak.gg · 재미로 발급된 문서로 효력이 없음</text>
</svg>`;
    return;
  }

  const culprit = d.culpritIdx;
  const photo = d.mainChar[culprit].key ? await imgToDataUri(DAK.charImgUrl(d.mainChar[culprit].key)) : null;

  // 과실 스택바
  const barX = 90, barW = 820, barY = 236, barH = 46;
  let x = barX;
  const segs = d.fault.map((f, i) => {
    const w = barW * f / 100;
    const cx = x + w / 2;
    const s = `
      <rect x="${x}" y="${barY}" width="${Math.max(w - 2, 2)}" height="${barH}" fill="${PCOLORS[i]}"/>
      ${w > 90 ? `<text x="${cx}" y="${barY + 29}" text-anchor="middle" font-size="15" font-weight="bold" fill="#fff">${esc(d.names[i])} ${d.fault[i]}%</text>`
                : `<text x="${cx}" y="${barY + barH + 20}" text-anchor="middle" font-size="12.5" fill="${ink}">${esc(d.names[i])} ${d.fault[i]}%</text>`}`;
    x += w;
    return s;
  }).join('');

  // 주과실자 근거 (최대 3줄, 고정 레이아웃)
  const reasons = (d.reasons[culprit] || []).slice(0, 3).map((r, i) => `
    <text x="392" y="${466 + i * 28}" font-size="13.5" fill="#777">${esc(r.clause)}</text>
    <text x="472" y="${466 + i * 28}" font-size="14.5" fill="${ink}">${esc(r.label)}</text>
    <text x="910" y="${466 + i * 28}" text-anchor="end" font-size="13.5" fill="#777">×${r.count} · 벌점 ${Math.round(r.pts)}</text>`).join('');

  const others = d.names.map((nm, i) => i).filter(i => i !== culprit);
  const ratioText = d.fault.join(' : ');

  const svg = `
<svg id="paper-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 707" font-family="${BODY_FONT}">
  <rect width="1000" height="707" fill="${paper}"/>
  <rect x="20" y="20" width="960" height="667" fill="none" stroke="${navy}" stroke-width="3.4"/>
  <rect x="30" y="30" width="940" height="647" fill="none" stroke="${gold}" stroke-width="1"/>

  <text x="90" y="70" font-size="14" letter-spacing="4" fill="#666" font-family="${TITLE_FONT}">루미아 손해보험(주)</text>
  <text x="910" y="70" text-anchor="end" font-size="13" fill="#777">문서번호 ${d.docNo}</text>

  <text x="500" y="136" text-anchor="middle" font-size="42" letter-spacing="16" fill="${ink}" font-family="${TITLE_FONT}">과실비율 산정서</text>
  <text x="500" y="164" text-anchor="middle" font-size="11.5" letter-spacing="3" fill="#999">LUMIA MUTUAL · FAULT RATIO ASSESSMENT REPORT</text>

  <text x="90" y="205" font-size="14.5" fill="${ink}">사건 개요 : 함께한 ${d.sharedGames}판 중 사고 <tspan font-weight="bold">${d.accidentCount}건</tspan> (사고율 ${d.accidentRate}%) · 할인할증등급 <tspan font-weight="bold">${d.grade}Z</tspan></text>

  ${segs}
  <rect x="${barX}" y="${barY}" width="${barW}" height="${barH}" fill="none" stroke="${navy}" stroke-width="1"/>

  <text x="500" y="352" text-anchor="middle" font-size="46" font-weight="bold" fill="${ink}" font-family="${TITLE_FONT}" letter-spacing="4">${ratioText}</text>
  <line x1="90" y1="384" x2="910" y2="384" stroke="${gold}" stroke-width="0.9"/>

  <!-- 주과실자 -->
  <rect x="90" y="412" width="180" height="180" fill="#fff" stroke="${navy}" stroke-width="1.6"/>
  ${photo ? `<image href="${photo}" x="103" y="425" width="154" height="154" preserveAspectRatio="xMidYMid meet"/>` : ''}
  <g transform="translate(228,430) rotate(-11)">
    <rect x="-58" y="-20" width="116" height="40" rx="6" fill="${paper}" opacity="0.15"/>
    <rect x="-58" y="-20" width="116" height="40" rx="6" fill="none" stroke="${red}" stroke-width="2.6"/>
    <text y="9" text-anchor="middle" font-size="22" font-weight="bold" fill="${red}" letter-spacing="5">주과실자</text>
  </g>
  <text x="180" y="618" text-anchor="middle" font-size="17" font-weight="bold" fill="${ink}">${esc(d.names[culprit])}</text>
  <text x="180" y="640" text-anchor="middle" font-size="12.5" fill="#777">주 사용: ${esc(d.mainChar[culprit].name)}${d.mainChar[culprit].role ? `(${d.mainChar[culprit].role})` : ''} · 구상권 청구 대상</text>

  <!-- 산정 근거 -->
  <text x="392" y="432" font-size="13" letter-spacing="3" fill="#777">주요 산정 근거 (주과실자)</text>
  ${reasons}
  <text x="392" y="556" font-size="12.5" fill="#777">공동 피보험자 : ${others.map(i => `${esc(d.names[i])} ${d.fault[i]}%`).join(' · ')} — 과실 경합 인정</text>

  <line x1="392" y1="572" x2="910" y2="572" stroke="${gold}" stroke-width="0.7" opacity="0.6"/>
  <text x="392" y="598" font-size="14.5" fill="${ink}">판정 : 위 ${d.accidentCount}건의 사고에 대한 종합 심의 결과, 주 과실은</text>
  <text x="392" y="622" font-size="14.5" fill="${ink}"><tspan font-weight="bold">${esc(d.names[culprit])}(${d.fault[culprit]}%)</tspan>에게 있음을 판정함. 보험료 ${Math.min(d.grade * 3, 60)}% 할증.</text>

  <text x="392" y="660" font-size="14" fill="${ink}">${dateStr} · <tspan font-family="${TITLE_FONT}" letter-spacing="3">루미아 손해사정법인</tspan></text>
  <g transform="translate(846,644)">
    <circle r="30" fill="none" stroke="${red}" stroke-width="2.2" opacity="0.85"/>
    <circle r="24" fill="none" stroke="${red}" stroke-width="1" opacity="0.85"/>
    <text y="-3" text-anchor="middle" font-size="13" font-weight="bold" fill="${red}" opacity="0.85">손해</text>
    <text y="12" text-anchor="middle" font-size="13" font-weight="bold" fill="${red}" opacity="0.85">사정</text>
  </g>
  <text x="500" y="701" text-anchor="middle" font-size="9" fill="#aaa">data: dak.gg · 재미로 발급된 문서로 실제 보험·법률 효력이 없음 · 팀워크 보호를 위해 용법·용량을 지켜 사용하세요</text>
</svg>`;
  $('#paper').innerHTML = svg;
}

// ---------- 상세 ----------
function renderDetail(d) {
  if (d.noAccident) { $('#detail').innerHTML = `<h3>상세 내역</h3><p style="color:#b7c5da;font-size:13.5px">사고가 없어 상세 내역이 없습니다. 이 팀은 보존하세요.</p>`; return; }
  const roleOf = i => i === d.culpritIdx ? '주과실자 · 구상권 청구 대상' : (d.fault[i] >= 25 ? '공동 과실' : '과실 경미 · 위로금 지급 대상');
  const members = d.names.map((nm, i) => `
    <div class="member ${i === d.culpritIdx ? 'culprit' : ''}">
      <div class="head">
        ${d.mainChar[i].key ? `<img src="${DAK.charImgUrl(d.mainChar[i].key)}" crossorigin="anonymous" alt="">` : ''}
        <div><div class="nm">${esc(nm)}</div><div class="role">${d.mainChar[i].role ? d.mainChar[i].role + ' · ' : ''}${roleOf(i)}</div></div>
        <div class="pct" style="color:${PCOLORS[i]}">${d.fault[i]}%</div>
      </div>
      <ul>${(d.reasons[i] || []).map(r => `<li><span class="cl">${esc(r.clause)}</span><span>${esc(r.label)}</span><span class="ct">×${r.count}</span></li>`).join('') || '<li><span>벌점 항목 없음 — 성실 교전</span></li>'}</ul>
    </div>`).join('');

  const mmss = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const rows = d.accidents.map((a, ai) => {
    const t = a.startDtm ? a.startDtm.slice(5, 16).replace('T', ' ') : '—';
    const sev = a.severity === '전손' ? 's3' : (a.severity === '중대' ? 's2' : 's1');
    const mini = a.fault.map((f, i) => `<i style="width:${f}%;background:${PCOLORS[i]}"></i>`).join('');
    const rp = (a.rpDelta === null || a.rpDelta === undefined) ? '—'
      : `<span style="color:${a.rpDelta < 0 ? '#ff8d7d' : '#7fd8a8'}">${a.rpDelta > 0 ? '+' : ''}${a.rpDelta}</span>`;
    // 판별 상세: 팀원별 스탯 + 벌점/감경 조항
    const detailCards = a.players.map((p, i) => {
      const its = (a.items && a.items[i]) || [];
      const list = its.length
        ? its.map(it => `<li class="${it.pts > 0 ? 'pen' : 'mit'}"><span class="cl">${esc(it.clause)}</span><span>${esc(it.desc)}</span><span class="pt">${it.pts > 0 ? '+' : ''}${it.pts}</span></li>`).join('')
        : '<li class="none">벌점·감경 없음 — 균등 과실만 배분</li>';
      return `
      <div class="game-member ${i === a.culprit ? 'culprit' : ''}">
        <div class="gm-head">
          ${p.charKey ? `<img src="${DAK.charImgUrl(p.charKey)}" crossorigin="anonymous" alt="">` : ''}
          <div>
            <b style="color:${PCOLORS[i]}">${esc(p.name)}</b> <span class="gm-fault">${a.fault[i]}%</span>${i === a.culprit ? ' <span class="culprit-chip">이 판의 범인</span>' : ''}
            <div class="gm-stat">${esc(p.character)}${p.role ? ` · ${p.role}` : ''} — 딜 ${fmt(p.damage)} · ${p.kill}/${p.assist}/${p.deaths} · 생존 ${mmss(p.playTime)}${p.giveUp ? ' · <b style="color:#ff8d7d">기권</b>' : ''}</div>
          </div>
        </div>
        <ul>${list}</ul>
      </div>`;
    }).join('');
    return `<tr class="acc-row" data-i="${ai}" title="클릭하면 판별 상세가 열립니다">
      <td><span class="caret">▸</span> ${t}</td><td>${a.mode}</td><td class="num">${a.rank}위</td>
      <td class="num">${rp}</td>
      <td><span class="sev ${sev}">${a.severity}</span></td>
      <td><div class="mini">${mini}</div></td>
      <td><span class="culprit-chip">${esc(a.players[a.culprit].name)}</span></td>
    </tr>
    <tr class="acc-detail" data-for="${ai}" hidden><td colspan="7"><div class="game-grid">${detailCards}</div></td></tr>`;
  }).join('');

  $('#detail').innerHTML = `
    <h3>피보험자별 과실 내역</h3>
    <div class="member-grid">${members}</div>
    <h3>사고 일지 (최근 ${d.accidents.length}건) <span class="hint-inline">— 행을 클릭하면 그 판의 상세 과실이 열립니다</span></h3>
    <div class="table-scroll"><table class="acc-table">
      <tr><th>일시</th><th>유형</th><th>순위</th><th>RP</th><th>등급</th><th>과실 배분</th><th>이 판의 범인</th></tr>
      ${rows}
    </table></div>`;

  document.querySelectorAll('.acc-row').forEach(tr => {
    tr.addEventListener('click', () => {
      const det = document.querySelector(`.acc-detail[data-for="${tr.dataset.i}"]`);
      det.hidden = !det.hidden;
      tr.querySelector('.caret').textContent = det.hidden ? '▸' : '▾';
    });
  });
}

// ---------- PNG 저장 ----------
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
  const btn = $('#png');
  btn.disabled = true; btn.textContent = '이미지 생성 중…';
  try {
    const svg = $('#paper-svg').cloneNode(true);
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.textContent = await getEmbeddedFontCss();
    svg.insertBefore(style, svg.firstChild);
    const xml = new XMLSerializer().serializeToString(svg);
    const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const canvas = document.createElement('canvas');
    canvas.width = 2000; canvas.height = 1414;
    canvas.getContext('2d').drawImage(img, 0, 0, 2000, 1414);
    URL.revokeObjectURL(url);
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `과실비율산정서_${lastResult.names.join('_')}.png`;
    a.click();
  } finally {
    btn.disabled = false; btn.textContent = '산정서 PNG 저장';
  }
}

// ---------- 이벤트 ----------
$('#go').addEventListener('click', run);
$('#png').addEventListener('click', downloadPng);
$('#link').addEventListener('click', async () => {
  await navigator.clipboard.writeText(location.href);
  $('#link').textContent = '복사 완료!';
  setTimeout(() => { $('#link').textContent = '조회 링크 복사'; }, 1500);
});
$('#again').addEventListener('click', () => {
  $('#result-section').hidden = true;
  $('#form-section').hidden = false;
  $('#form-error').hidden = true;
  window.scrollTo({ top: 0 });
});

(async function init() {
  await loadSeasons();
  const p = new URLSearchParams(location.search);
  if (p.get('me')) $('#me').value = p.get('me');
  const mates = (p.get('mates') || '').split(',').filter(Boolean);
  if (mates[0]) $('#mate1').value = mates[0];
  if (mates[1]) $('#mate2').value = mates[1];
  if (p.get('season')) $('#season').value = p.get('season');
  if (p.get('mode')) $('#mode').value = p.get('mode');
  if (p.get('pages')) $('#pages').value = p.get('pages');
  updateBtn();
  if (p.get('me') && mates.length) run();
})();
