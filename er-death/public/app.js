// 루미아섬 사망진단서 — 프론트엔드
const $ = (s) => document.querySelector(s);
const form = $('#issueForm');
const nickInput = $('#nick');
const issueBtn = $('#issueBtn');
const hint = $('#hint');
const picker = $('#picker');
const pickerList = $('#pickerList');
const certRoot = $('#certRoot');
const actions = $('#actions');

let currentName = null;
let currentGameId = null;
let operation = 0;
let pending = false;
const clerkState = (state, message) => window.LumiaClerk?.setState(state, message);
const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
window.LumiaClerk?.bindNickname(nickInput);

function clearResult() {
  certRoot.hidden = true;
  picker.hidden = true;
  actions.hidden = true;
  $('#resultSummary').hidden = true;
  currentName = null;
}

function cancelIssue() {
  operation++;
  pending = false;
  issueBtn.disabled = false;
  $('#cancelIssue').hidden = true;
  form.removeAttribute('aria-busy');
  clearResult();
  hint.classList.remove('error');
  hint.textContent = '입력한 닉네임을 확인한 뒤 다시 신청할 수 있습니다.';
  clerkState('intake');
}
$('#cancelIssue').addEventListener('click', () => { cancelIssue(); nickInput.focus(); });
window.addEventListener('pagehide', cancelIssue);
document.addEventListener('lumia:cancel', cancelIssue);
nickInput.addEventListener('input', () => {
  nickInput.removeAttribute('aria-invalid');
  $('#nickError').hidden = true;
  if (pending || currentName) cancelIssue();
});

// 촬영 모드 (?shot=1) — 서버 PNG 렌더링용
const SHOT = new URLSearchParams(location.search).get('shot') === '1';
if (SHOT) document.documentElement.classList.add('shot');

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function fmt(n) { return Number(n || 0).toLocaleString('ko-KR'); }

async function issue(name, gameId) {
  if (pending) return;
  const request = ++operation;
  pending = true;
  clearResult();
  window.LumiaContext?.setNickname(name);
  issueBtn.disabled = true;
  $('#cancelIssue').hidden = false;
  form.setAttribute('aria-busy', 'true');
  clerkState('loading');
  hint.classList.remove('error');
  hint.textContent = '기록 확인 중입니다. 최근 사망 기록을 조회하고 있습니다.';
  let timeout;
  try {
    const data = await Promise.race([
      ER.deathCert(name, gameId),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('기록 조회 시간이 초과되었습니다. 잠시 후 다시 신청해 주세요.')), 180000); }),
    ]);
    if (request !== operation) return;
    if (!data?.death || !data?.victim || !data?.killer || !Array.isArray(data.causeChain)) {
      throw new Error('진단서에 필요한 일부 기록을 받지 못했습니다. 잠시 후 다시 신청해 주세요.');
    }
    currentName = name;
    currentGameId = data.death.gameId;
    renderPicker(data);
    renderCert(data);
    clerkState('result');
    window.LumiaContext?.remember('autopsy');
    hint.textContent = '발급 완료. 다른 사망 기록을 선택하면 재발급됩니다.';
    $('#resultSummary').textContent = `${data.victim.nickname} · 경기 #${data.death.gameId} · ${data.death.gameRank}위 · ${data.causeChain[0]?.text || '사인은 진단서를 확인하세요.'}`;
    $('#resultSummary').hidden = false;
    if (!SHOT) {
      certRoot.querySelector('h1').focus({ preventScroll: true });
      certRoot.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    }
  } catch (e) {
    if (request !== operation) return;
    const empty = /사망.*기록이 없/.test(e.message);
    hint.classList.toggle('error', !empty);
    hint.textContent = empty ? `조회 범위에 사망 기록이 없습니다. ${e.message}` : e.message;
    clearResult();
    clerkState(empty ? 'intake' : 'error', hint.textContent);
  } finally {
    clearTimeout(timeout);
    if (request === operation) {
      pending = false;
      issueBtn.disabled = false;
      $('#cancelIssue').hidden = true;
      form.removeAttribute('aria-busy');
    }
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = nickInput.value.trim();
  if (!name) {
    nickInput.setAttribute('aria-invalid', 'true');
    $('#nickError').textContent = '게임 닉네임을 입력해 주세요.';
    $('#nickError').hidden = false;
    nickInput.focus();
    return;
  }
  issue(name);
});

$('#printBtn').addEventListener('click', () => window.print());

const pngBtn = $('#pngBtn');
pngBtn.addEventListener('click', async () => {
  if (!currentName || pending || certRoot.hidden) return;
  pngBtn.disabled = true;
  const orig = pngBtn.textContent;
  pngBtn.textContent = '촬영 중…';
  try {
    await document.fonts?.ready;
    await Promise.all([...certRoot.querySelectorAll('img')].map(img => img.decode?.().catch(() => {})));
    // 구 server.js는 헤드리스 Chrome으로 페이지를 촬영했다. 정적 배포에는 서버가
    // 없으므로 브라우저에서 직접 래스터화한다.
    const canvas = await html2canvas(certRoot, {
      scale: 2,
      useCORS: true,                                  // 공용 서버가 CORS를 제공하는 초상화
      backgroundColor: '#fbfaf6',
    });
    const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
    if (!blob) throw new Error('PNG 생성에 실패했습니다.');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `사망진단서_${currentName}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  } catch (e) {
    hint.classList.add('error');
    hint.textContent = e.message;
  } finally {
    pngBtn.disabled = false;
    pngBtn.textContent = orig;
  }
});

// URL로 바로 발급: /?name=닉네임
const urlName = new URLSearchParams(location.search).get('name');
if (urlName) {
  nickInput.value = urlName;
  issue(urlName);
}

function renderPicker(data) {
  const deaths = data.recentDeaths || [];
  picker.hidden = deaths.length < 2;
  pickerList.innerHTML = '';
  for (const d of deaths) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'picker-item' + (d.gameId === data.death.gameId ? ' active' : '');
    btn.setAttribute('aria-pressed', String(d.gameId === data.death.gameId));
    const when = new Date(d.startDtm);
    btn.innerHTML = `
      <span class="d">${when.getMonth() + 1}/${when.getDate()} ${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}</span>
      <span>${esc(d.characterName)}</span>
      <span class="k">☠ ${esc(d.killerLabel)}</span>
      <span class="rank">${d.gameRank}위</span>`;
    btn.addEventListener('click', () => issue(currentName, d.gameId));
    pickerList.appendChild(btn);
  }
}

const MANNER_LABELS = [
  ['homicide', '외인사 — 타살'],
  ['wildAnimal', '야생동물'],
  ['zone', '금지구역'],
];

function renderCert(data) {
  const v = data.victim, d = data.death, k = data.killer;

  const checks = MANNER_LABELS.map(([key, label]) =>
    key === d.manner
      ? `<span class="on"><span class="box">☑</span> ${label}</span>`
      : `<span>□ ${label}</span>`
  ).join('\n');
  const mannerNote = d.manner === 'homicide' ? '※ 24인 배틀로얄 특성상 정상 참작'
    : d.manner === 'wildAnimal' ? '※ 자연의 섭리로 판정'
    : '※ 안내 방송을 무시한 정황 확인';

  const chainRows = data.causeChain.map(c => `
    <tr>
      <td>${esc(c.label)}</td>
      <td class="v">${esc(c.text)}</td>
      <td class="dur">${esc(c.dur)}</td>
    </tr>`).join('');

  const prior = d.priorDeaths > 0
    ? `<tr>
        <th scope="row">기왕력</th>
        <td class="v" colspan="3">동일 실험 내 사망 ${d.priorDeaths}회
          <small>— ${d.priorDeathsDetail.map(p => `${p.nth}차: ${esc(p.by)}${p.placeName ? ` (${esc(p.placeName)})` : ''}`).join(' · ')} · 부활 처치 후 재발</small></td>
      </tr>`
    : '';

  const killerSection = k.kind === 'player' ? `
    <div class="killer-box">
      <div class="killer-head">
        <b>처형자 신원조회 결과</b>
        <span class="tag">${k.record?.averageKills != null ? `당 시즌 랭크 평균 ${esc(k.record.averageKills)}킬` : '전과 조회 불가'}</span>
      </div>
      <div class="killer-body">
        <div class="mugshot">
          <div class="frame">${k.mugshot ? `<img src="${esc(k.mugshot)}" crossorigin="anonymous" alt="${esc(k.characterName)} 머그샷">` : ''}</div>
          <span>관전 카메라 채증</span>
        </div>
        <table>
          <tr><th scope="row">닉네임</th><td class="v">${esc(k.nickname)}</td></tr>
          <tr><th scope="row">실험체</th><td class="v">${esc(k.characterName)} ${k.weaponName ? `<small>(${esc(k.weaponName)})</small>` : ''}</td></tr>
          <tr><th scope="row">처형 도구</th><td class="v">${k.cause ? esc(k.cause) : '불상'}</td></tr>
          ${k.record?.seasonPlays != null ? `<tr><th scope="row">활동 이력</th><td class="v">당 시즌 랭크 ${fmt(k.record.seasonPlays)}회 실험 참가 <small>— 상습성 인정</small></td></tr>` : ''}
          <tr><th scope="row">범행 동기</th><td class="v"><small>${esc(k.motive)}</small></td></tr>
        </table>
      </div>
    </div>` : `
    <div class="killer-box">
      <div class="killer-head">
        <b>가해 ${k.kind === 'zone' ? '기관' : '동물'} 조회 결과</b>
        <span class="tag">${k.kind === 'zone' ? '아글라이아' : '자연사 아님'}</span>
      </div>
      <div class="killer-body">
        <table>
          <tr><th scope="row">가해자</th><td class="v">${esc(k.characterName)}</td></tr>
          <tr><th scope="row">수단</th><td class="v">${k.cause ? esc(k.cause) : '불상'}</td></tr>
          <tr><th scope="row">범행 동기</th><td class="v"><small>${esc(k.motive)}</small></td></tr>
        </table>
      </div>
    </div>`;

  const opinions = (data.opinions || []).map(o => `<li>${esc(o)}</li>`).join('') || '<li>검시관 소견이 제공되지 않았습니다.</li>';

  certRoot.innerHTML = `
  <div class="paper">
    <div class="form-no">
      <span>■ 아글라이아 실험관리규칙 [별지 제72호서식]</span>
      <span>발급번호 ${esc(data.certNo)}</span>
    </div>

    <h1 tabindex="-1">사망진단서</h1>
    <p class="subtitle">(<span class="strike">시체검안서</span> · 리플레이 검안서) — 이 진단서는 실험 종료 후 관전 데이터에 근거하여 작성되었습니다.</p>

    <div class="sec">
      <div class="sec-title">① 피검안자(고인)의 인적사항</div>
      <div class="victim-layout">
        <div class="portrait-cell">
          <div class="portrait-frame">
            ${v.portrait ? `<img src="${esc(v.portrait)}" crossorigin="anonymous" alt="고인 영정사진">` : ''}
            <div class="ribbon"></div>
          </div>
          <span class="cap">영정사진</span>
        </div>
        <table class="formtable">
          <tr>
            <th scope="row">닉네임</th>
            <td class="v">${esc(v.nickname)}</td>
            <th scope="row">계정 레벨</th>
            <td class="v">${esc(v.accountLevel ?? '불상')}</td>
          </tr>
          <tr>
            <th scope="row">실험체</th>
            <td class="v">${esc(v.characterName)} <small>(Lv.${esc(v.characterLevel)})</small></td>
            <th scope="row">숙련 무기</th>
            <td class="v">${v.weaponName ? `${esc(v.weaponName)} <small>(숙련 ${esc(v.weaponLevel)})</small>` : '—'}</td>
          </tr>
          <tr>
            <th scope="row">사망 일시</th>
            <td class="v" colspan="3">${esc(d.dateTime)} <small>— ${esc(d.elapsed)}</small></td>
          </tr>
          <tr>
            <th scope="row">사망 장소</th>
            <td class="v" colspan="3">루미아섬 ${esc(d.placeName)}</td>
          </tr>
          <tr>
            <th scope="row">최종 순위</th>
            <td class="v" colspan="3">${esc(d.gameRank)}위${v.mmrGain ? ` <small>— 유족(본인) 앞 MMR ${v.mmrGain > 0 ? '+' : ''}${esc(v.mmrGain)} 상속</small>` : ''}</td>
          </tr>
          ${prior}
        </table>
      </div>
    </div>

    <div class="sec">
      <div class="sec-title">② 사망의 원인 <span class="q">※ (나)(다)(라)에는 (가)와 직접 의학적 인과관계가 명확한 것만을 적습니다.</span></div>
      <p class="cause-direction">직접 사인 (가) ← 선행 사인 (나) ← (다) ← (라)</p>
      <table class="formtable chain">${chainRows}</table>
    </div>

    <div class="sec">
      <div class="sec-title">③ 사망의 종류</div>
      <div class="checks">
        <span>□ 병사</span>
        ${checks}
        <span class="note">${mannerNote}</span>
      </div>
    </div>

    <div class="sec">
      <div class="sec-title">④ 처형자 인적사항 <span class="q">— 누가 이 유저를 죽였는가</span></div>
      ${killerSection}
    </div>

    <div class="sec">
      <div class="sec-title">⑤ 검시관 소견 (생전 행적)</div>
      <div class="opinion"><ul>${opinions}</ul></div>
    </div>

    <div class="attest">
      위와 같이 진단(검안)함.<br>
      <span class="date">${esc(data.issuedAt)}</span>
    </div>
    <div class="issuer">
      루미아섬 보건의료원장 <span class="sig">(직인)</span>
    </div>

    <div class="stamp" aria-hidden="true">
      <span>루</span><span>미</span><span>보</span><span>건</span>
    </div>

    <div class="barcode">
      <div class="meta">
        ER-OPEN-API · GAME #${esc(d.gameId)}<br>
        killDetail · killerCharacter · causeOfDeath · placeOfDeath
      </div>
      <div class="bars" aria-hidden="true"></div>
    </div>
    <p class="document-disclaimer">전적·게임 정보: 이터널 리턴 공식 Open API · 최근 90일 이내 조회 기록 기준 · 닉네임 변경 이전 기록 제외<br>본 문서는 팬메이드 유머 콘텐츠이며 법적 효력이 없습니다.</p>
  </div>`;

  certRoot.hidden = false;
  actions.hidden = false;
}
