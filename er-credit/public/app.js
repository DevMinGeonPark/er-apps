'use strict';
const $ = s => document.querySelector(s);
const form = $('#form'), nameInput = $('#name'), btn = form.querySelector('button');
const statusEl = $('#status'), tableView = $('#table-view'), reportView = $('#report-view');

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = n => (n == null ? '-' : n.toLocaleString('ko-KR'));
const gradeClass = g => 'g' + g;
const GRADE_WORD = { 1: '최우량', 2: '우량', 3: '우량', 4: '양호', 5: '보통', 6: '보통', 7: '주의', 8: '주의', 9: '위험', 10: '위험' };

const FACTORS = [
  ['repayment', '상환이력', '픽했으면 값을 하는가'],
  ['debt', '부채수준', '팀 자원 대비 기여'],
  ['term', '신용거래기간', '이 실험체와의 거래 이력'],
  ['form', '신용형태', '거래 지속성·모드 다양성'],
  ['fresh', '신규 개설', '최근 급증 픽 위험'],
];

let current = null; // 마지막 조회 결과(등급표)
let operationId = 0;
let busy = false;
let sortOrder = 'grade';
let lastRequest = null;
let currentReport = null;
const reports = new Map();
const clerkState = (state, message) => window.LumiaClerk?.setState(state, message);
const focusResult = element => {
  const heading = element.querySelector('h2');
  if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
  element.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
};

function setBusy(value) {
  busy = value;
  btn.disabled = value;
  form.setAttribute('aria-busy', String(value));
  tableView.querySelectorAll('button').forEach(button => { button.disabled = value; });
  $('#request-actions').hidden = !value;
  $('#cancel').hidden = !value;
  $('#retry').hidden = true;
}

function withTimeout(promise) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('조회 시간이 초과되었습니다. 같은 조건으로 다시 시도해주세요.')), 90000);
  })]).finally(() => clearTimeout(timer));
}

function requestError(error) {
  const message = error.code === 'NO_RECORDS' ? `자료 부족 · ${error.message}` : error.message;
  setStatus(message, true);
  if (/닉네임을 확인|닉네임을 입력/.test(message)) {
    nameInput.setAttribute('aria-invalid', 'true');
    $('#name-error').textContent = message;
    $('#name-error').hidden = false;
  }
  $('#request-actions').hidden = false;
  $('#retry').hidden = false;
  $('#cancel').hidden = true;
  clerkState('error', error.code === 'NO_RECORDS' ? '확인된 거래 이력이 없습니다.' : undefined);
}

function setStatus(msg, isError) {
  if (!msg) { statusEl.hidden = true; return; }
  statusEl.hidden = false;
  statusEl.className = 'status' + (isError ? ' error' : '');
  statusEl.setAttribute('role', isError ? 'alert' : 'status');
  statusEl.textContent = msg;
}


// ---------- 등급표 ----------
function renderTable(d, options = {}) {
  current = d;
  if (options.sync !== false) syncUrl({ name: d.player.name }, options.push !== false);
  reportView.hidden = true;
  tableView.hidden = false;

  const s = d.summary;
  let head = '';
  if (s.evaluated === 0) {
    head = `<div class="callout warn">평가 가능한 실험체가 없습니다. 모든 실험체가 거래 이력 부족(Thin File) 상태입니다.</div>`;
  } else if (s.spread >= 4) {
    head = `<div class="callout"><b>등급 편차 ${s.spread}단계.</b> 같은 사람이지만
      <b>${esc(s.best.name)} ${s.best.grade}등급</b>과
      <b>${esc(s.worst.name)} ${s.worst.grade}등급</b> 사이에 신용도 차이가 큽니다.
      실험체를 보고 듀오를 결정하십시오.</div>`;
  } else {
    head = `<div class="callout">평가 대상 ${s.evaluated}종. 최고 등급은
      <b>${esc(s.best.name)} ${s.best.grade}등급</b>입니다.</div>`;
  }

  const ordered = [...d.rows].sort(sortOrder === 'name'
    ? (a, b) => a.name.localeCompare(b.name, 'ko')
    : (a, b) => Number(a.thinFile) - Number(b.thinFile) || (a.grade ?? Infinity) - (b.grade ?? Infinity) || (b.score ?? -1) - (a.score ?? -1) || b.play - a.play);
  const rows = ordered.map(r => `
    <tr class="row-link ${r.thinFile ? 'thin-row' : ''}" data-cid="${r.characterId}">
      <td><div class="ledger-character"><img src="${esc(DAK.charImgUrl(r.key))}" alt="" loading="lazy"><div><button type="button" data-report="${r.characterId}" aria-label="${esc(r.name)} 신용조사서 열기">${esc(r.name)}</button><small class="sample-note">${r.thinFile ? '표본 부족 · Thin File' : '평가 가능'}</small></div></div></td>
      <td>${r.thinFile
        ? '<span class="grade-badge g-thin">평가불가</span>'
        : `<span class="grade-badge ${gradeClass(r.grade)}">${r.grade}등급</span>`}</td>
      <td class="num">${r.thinFile ? '-' : r.score}</td>
      <td class="num">${num(r.play)}</td>
      <td class="num hide-sm">${r.winRate}%</td>
      <td class="num hide-sm">${r.avgPlace}위</td>
      <td class="num hide-sm">${r.inquiries ? r.inquiries + '건' : '-'}</td>
    </tr>`).join('');

  tableView.innerHTML = `
    <div class="doc">
      <div class="doc-head">
        <h2>실험체별 신용대장</h2>
        <div class="meta">전 시즌 · 실험체별 신용평가 결과</div>
      </div>
      <div class="subject-bar">
        <div><span>대상</span> <b>${esc(d.player.name)}</b></div>
        <div><span>계정 레벨</span> <b>${num(d.player.accountLevel)}</b></div>
        <div><span>거래 시즌</span> <b>${d.seasonsPlayed}개</b></div>
        <div><span>총 거래</span> <b>${num(d.overall.play)}건</b></div>
        <div><span>본인 평균 순위</span> <b>${d.overall.avgPlace}위</b></div>
        ${d.bestMmr ? `<div><span>최고 MMR</span> <b>${num(d.bestMmr.mmr)}</b></div>` : ''}
      </div>
      ${head}
      <div class="ledger-tools"><span role="status">${d.rows.length}종 · 평가 가능 ${s.evaluated}종 · 자료 부족 ${s.thinFile}종</span><div aria-label="신용대장 정렬"><button type="button" data-sort="grade" aria-pressed="${sortOrder === 'grade'}">등급순</button> <button type="button" data-sort="name" aria-pressed="${sortOrder === 'name'}">실험체순</button></div></div>
      <div class="table-scroll" tabindex="0" role="region" aria-label="실험체 신용대장, 가로 스크롤"><table class="ledger-table">
        <thead><tr>
          <th>실험체</th><th>신용등급</th><th class="num">평점</th><th class="num">거래건수</th>
          <th class="num hide-sm">승률</th><th class="num hide-sm">평균순위</th><th class="num hide-sm">피조회</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <div class="doc-foot">
        행을 선택하면 해당 실험체의 신용조사서가 발급됩니다.
        조사서 발급 횟수는 이 브라우저의 최근 30일 조회 이력에만 기록됩니다.
        ${d.failedSeasons ? `<br>일부 시즌(${d.failedSeasons}개) 자료를 가져오지 못해 평가에서 제외했습니다.` : ''}
      </div>
    </div>`;

  tableView.querySelectorAll('.row-link').forEach(tr => {
    tr.addEventListener('click', () => { if (!busy) openReport(d.player.name, tr.dataset.cid); });
  });
  tableView.querySelectorAll('[data-sort]').forEach(button => button.addEventListener('click', () => {
    sortOrder = button.dataset.sort;
    renderTable(d, { sync: false, focus: false });
    tableView.querySelector(`[data-sort="${sortOrder}"]`).focus();
  }));
  if (options.focus !== false) focusResult(tableView);
}

// ---------- 신용조사서 ----------
function renderReport(d, options = {}) {
  currentReport = d;
  reports.set(`${d.player.name}|${d.characterId}`, d);
  if (options.sync !== false) syncUrl({ name: d.player.name, c: d.characterId }, options.push !== false);
  tableView.hidden = true;
  reportView.hidden = false;

  const issued = new Date(d.issuedAt);
  const dateStr = `${issued.getFullYear()}. ${issued.getMonth() + 1}. ${issued.getDate()}.`;

  let body;
  if (d.thinFile) {
    body = `
      <div class="verdict">
        <img class="portrait" crossorigin="anonymous" src="${DAK.charImgUrl(d.character.key)}" alt="${esc(d.character.name)}">
        <div class="verdict-main">
          <div class="who"><b>${esc(d.player.name)}</b> 님 · ${esc(d.character.name)}</div>
          <div class="big-grade">평가불가<small>Thin File · 자료 부족으로 점수를 산정하지 않습니다.</small></div>
        </div>
        <dl class="limit-box">
          <dt>여신 판정</dt><dd>보류</dd>
          <dt>비고</dt><dd>보증인 필요</dd>
        </dl>
      </div>
      <div class="callout warn"><b>${esc(d.headline)}</b><br>${esc(d.note)}</div>
      <h3 class="sec">거래 현황</h3>
      ${statTable(d)}
      <h3 class="sec">조회 이력</h3><div class="callout">이 브라우저에서 최근 30일간 <b>${num(d.inquiries)}건</b> 조회되었습니다.</div>`;
  } else {
    const color = getComputedStyle(reportView).getPropertyValue(
      d.grade <= 2 ? '--g-good' : d.grade <= 4 ? '--g-fair' : d.grade <= 6 ? '--g-mid' : d.grade <= 8 ? '--g-warn' : '--g-bad');
    body = `
      <div class="verdict">
        <img class="portrait" crossorigin="anonymous" src="${DAK.charImgUrl(d.character.key)}" alt="${esc(d.character.name)}">
        <div class="verdict-main">
          <div class="who"><b>${esc(d.player.name)}</b> 님 · ${esc(d.character.name)}</div>
          <div class="big-grade" style="color:${color}">${d.grade}등급<small>${d.score}점 / 1000점 · ${GRADE_WORD[d.grade]}</small></div>
          <div class="gauge"><i style="width:${d.score / 10}%;background:${color}"></i></div>
        </div>
        <dl class="limit-box">
          <dt>여신 판정</dt><dd style="color:${color}">${esc(d.limit[0])}</dd>
          <dt>거래 조건</dt><dd>${esc(d.limit[1])}</dd>
        </dl>
      </div>

      ${d.defaulted ? `<div class="stamp">채무불이행자 명부 등재</div>` : ''}

      <details class="evidence" open><summary>평가 근거 · 항목별 점수와 연체 기록</summary>
      <h3 class="sec">평가 항목</h3>
      ${FACTORS.map(([k, label, desc]) => `
        <div class="factor">
          <div class="lab">${label}<small>${desc}</small></div>
          <div class="bar"><i style="width:${d.factors[k]}%"></i></div>
          <div class="pct">${d.factors[k]}</div>
          <div class="w">${Math.round(d.weights[k] * 100)}%</div>
        </div>`).join('')}

      <h3 class="sec">연체 기록</h3>
      ${d.delinquencies.length ? `
        <div class="table-scroll" tabindex="0" role="region" aria-label="연체 시즌 비교"><table>
          <thead><tr><th>시즌</th><th>구분</th><th class="num">거래</th><th class="num">평균순위</th><th class="num">본인평균</th><th class="num">차이</th></tr></thead>
          <tbody>${d.delinquencies.map(x => `
            <tr>
              <td>${esc(x.seasonName)}</td>
              <td class="sev-${x.severity}">${esc(x.label)}</td>
              <td class="num">${num(x.play)}</td>
              <td class="num">${x.avgPlace}위</td>
              <td class="num">${x.baseAvgPlace}위</td>
              <td class="num sev-${x.severity}">+${x.delta}</td>
            </tr>`).join('')}</tbody>
        </table></div>
        <div class="doc-foot" style="margin-top:12px;padding-top:10px">연체 표현은 공개 시즌 기록을 비교한 오락용 판정입니다. 기록을 별도로 5년간 보관하는 서비스는 제공하지 않습니다.</div>
      ` : `<div class="callout">해당 실험체의 연체 기록이 없습니다. 전 시즌 본인 평균 이상의 성과를 유지했습니다.</div>`}

      </details><details class="evidence"><summary>거래 현황 · 본인 전체 평균 비교</summary><h3 class="sec">거래 현황</h3>
      ${statTable(d)}
      </details>

      <h3 class="sec">조회 이력</h3>
      <div class="callout${d.inquiries >= 5 && d.grade >= 7 ? ' warn' : ''}">
        이 브라우저에서 최근 30일간 <b>${d.inquiries}건</b> 조회되었습니다.
        ${d.inquiries >= 5 && d.grade >= 7
          ? '조회 건수 대비 등급이 낮습니다. 다른 이용자의 조회나 실제 듀오 심사 여부는 확인할 수 없습니다.'
          : d.inquiries >= 5 ? '이 브라우저에서 조회 빈도가 높습니다.' : ''}
      </div>`;
  }

  reportView.innerHTML = `
    <button class="btn-back" id="back">← 신용대장으로</button>
    <div class="doc">
      <div class="doc-head">
        <h2>신용조사서</h2>
        <div class="meta">보고서번호 ${esc(d.reportNo)} · 발급일 ${dateStr} · 루미아 신용정보원</div>
      </div>
      ${body}
      <div class="doc-foot">
        본 조사서는 공개 전적 ${num(d.seasonsPlayed)}개 시즌 자료를 근거로 산정되었습니다.
        평가 기준선은 조회 대상 본인의 전체 평균이며, 타 이용자와의 절대 비교가 아닙니다.
        본 기관은 실존하지 않으며 평가 결과는 오락 목적입니다.
        ${d.failedSeasons ? `<br>일부 시즌 ${num(d.failedSeasons)}개 자료가 누락되어 확인된 기록만 평가했습니다.` : ''}
      </div>
    </div><div class="report-actions"><button type="button" id="print-report">평가서 인쇄 / PDF 저장</button><button type="button" id="share-report">조회 링크 복사</button></div><p id="report-action-status" role="status" class="notice"></p>`;
  $('#back').addEventListener('click', returnToTable);
  $('#print-report').addEventListener('click', printReport);
  $('#share-report').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(location.href); $('#report-action-status').textContent = '개별 평가서 조회 링크를 복사했습니다.'; }
    catch { $('#report-action-status').textContent = '링크를 복사하지 못했습니다. 주소 표시줄의 링크를 복사해주세요.'; }
  });
  focusResult(reportView);
}

function statTable(d) {
  const s = d.stats, b = d.baseline;
  const rows = [
    ['거래건수', num(s.play) + '건', num(b.play) + '건'],
    ['승률', s.winRate + '%', b.winRate + '%'],
    ['평균 순위', s.avgPlace + '위', b.avgPlace + '위'],
    ['평균 딜량', num(s.avgDamage), num(b.avgDamage)],
    ['평균 사망', s.avgDeaths + '회', b.avgDeaths + '회'],
    ['TOP3 비율', s.top3Rate + '%', '-'],
    ['평균 킬 / 어시', s.avgKill + ' / ' + s.avgAssist, '-'],
    ['누적 플레이', s.playHours + '시간', '-'],
  ];
  return `<div class="table-scroll" tabindex="0" role="region" aria-label="실험체와 본인 전체 평균 비교"><table>
    <thead><tr><th>항목</th><th class="num">${esc(d.character.name)}</th><th class="num">본인 전체 평균</th></tr></thead>
    <tbody>${rows.map(r => `<tr><td>${r[0]}</td><td class="num">${r[1]}</td><td class="num">${r[2]}</td></tr>`).join('')}</tbody>
  </table></div>`;
}

// ---------- 흐름 ----------
async function openReport(name, cid) {
  if (busy) return;
  const requestId = ++operationId;
  lastRequest = { kind: 'report', name, cid };
  setBusy(true);
  clerkState('loading');
  setStatus('선택한 실험체의 신용조사서를 확인하고 있습니다…');
  try {
    const result = await withTimeout(DAK.credit(name, cid));
    if (requestId !== operationId) return;
    setBusy(false);
    renderReport(result);
    setStatus('');
    clerkState('result', result.thinFile ? '자료 부족 · 여신 판정 보류' : undefined);
  } catch (error) {
    if (requestId !== operationId) return;
    setBusy(false);
    requestError(error);
  }
}

function syncUrl(params, push = false) {
  const q = new URLSearchParams();
  q.set('name', params.name);
  if (params.c) q.set('c', params.c);
  const previous = new URLSearchParams(location.search);
  const state = { lumiaCredit: { from: previous.get('name') && !previous.get('c') ? 'table' : 'intake' } };
  const url = '?' + q;
  if (push && location.search !== url) history.pushState(state, '', url);
  else history.replaceState(state, '', url);
}

async function lookup(name, cid) {
  if (busy) return;
  const requestId = ++operationId;
  lastRequest = { kind: 'lookup', name, cid };
  window.LumiaContext?.setNickname(name);
  window.LumiaContext?.remember('credit');
  nameInput.removeAttribute('aria-invalid');
  $('#name-error').hidden = true;
  setBusy(true);
  clerkState('loading');
  tableView.hidden = true; reportView.hidden = true;
  setStatus('전 시즌 거래 이력을 조회하고 있습니다. 시즌 수에 따라 10초 이상 걸릴 수 있습니다…');
  try {
    const d = await withTimeout(DAK.report(name));
    if (requestId !== operationId) return;
    setBusy(false);
    renderTable(d, { sync: !cid });
    setStatus('');
    clerkState('result');
    if (cid) await openReport(d.player.name, cid);
  } catch (error) {
    if (requestId !== operationId) return;
    setBusy(false);
    requestError(error);
  }
}

function showIntake(updateUrl = true) {
  operationId++;
  setBusy(false);
  tableView.hidden = true;
  reportView.hidden = true;
  setStatus('');
  if (updateUrl) history.pushState(null, '', location.pathname);
  clerkState('intake');
  nameInput.focus({ preventScroll: true });
}

function returnToTable() {
  operationId++;
  setBusy(false);
  setStatus('');
  if (!current) { showIntake(); return; }
  if (history.state?.lumiaCredit?.from === 'table') { history.back(); return; }
  renderTable(current, { push: false });
  clerkState('result');
  tableView.querySelector(`[data-report="${currentReport?.characterId}"]`)?.focus({ preventScroll: true });
}

async function printReport() {
  const button = $('#print-report');
  button.disabled = true;
  $('#report-action-status').textContent = '평가서의 글꼴과 이미지를 준비하고 있습니다…';
  try {
    await document.fonts.ready;
    await Promise.all([...reportView.querySelectorAll('img')].map(image => image.decode().catch(() => {})));
    $('#report-action-status').textContent = '인쇄 창에서 PDF로 저장할 수 있습니다.';
    window.print();
  } catch {
    $('#report-action-status').textContent = '인쇄 창을 열지 못했습니다. 브라우저의 인쇄 기능을 사용해주세요.';
  } finally { button.disabled = false; }
}

let printDetails = [];
window.addEventListener('beforeprint', () => {
  printDetails = [...reportView.querySelectorAll('details')].map(element => [element, element.open]);
  printDetails.forEach(([element]) => { element.open = true; });
});
window.addEventListener('afterprint', () => { printDetails.forEach(([element, open]) => { element.open = open; }); printDetails = []; });
window.addEventListener('popstate', () => {
  operationId++;
  setBusy(false);
  setStatus('');
  const params = new URLSearchParams(location.search);
  const name = params.get('name'), cid = params.get('c');
  const cached = reports.get(`${name}|${cid}`);
  if (cid && cached) { renderReport(cached, { sync: false }); clerkState('result'); }
  else if (name && !cid && name === current?.player.name) {
    renderTable(current, { sync: false }); clerkState('result');
    tableView.querySelector(`[data-report="${currentReport?.characterId}"]`)?.focus({ preventScroll: true });
  } else { if (name) nameInput.value = name; showIntake(false); }
});
$('#retry').addEventListener('click', () => {
  if (!lastRequest || busy) return;
  const { kind, name, cid } = lastRequest;
  if (kind === 'report') openReport(name, cid); else lookup(name, cid);
});
$('#cancel').addEventListener('click', () => showIntake());
document.addEventListener('lumia:cancel', event => {
  operationId++;
  setBusy(false);
  if (!event.cancelable) return;
  event.preventDefault();
  if (!reportView.hidden && current) returnToTable(); else showIntake();
});
window.addEventListener('pagehide', () => { operationId++; setBusy(false); });
window.LumiaClerk?.bindNickname(nameInput);

// 공유 링크로 들어온 경우 바로 조회
const boot = new URLSearchParams(location.search);
if (boot.get('name')) {
  nameInput.value = boot.get('name');
  lookup(boot.get('name').trim(), boot.get('c'));
}

form.addEventListener('submit', async ev => {
  ev.preventDefault();
  const name = nameInput.value.trim();
  if (name) await lookup(name);
  else {
    nameInput.setAttribute('aria-invalid', 'true');
    $('#name-error').textContent = '조회 대상 닉네임을 입력해주세요.';
    $('#name-error').hidden = false;
    nameInput.focus();
  }
});
nameInput.addEventListener('input', () => { nameInput.removeAttribute('aria-invalid'); $('#name-error').hidden = true; });
