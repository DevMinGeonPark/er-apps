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

function setStatus(msg, isError) {
  if (!msg) { statusEl.hidden = true; return; }
  statusEl.hidden = false;
  statusEl.className = 'status' + (isError ? ' error' : '');
  statusEl.textContent = msg;
}

async function api(path) {
  const res = await fetch(path);
  const json = await res.json().catch(() => ({ error: '응답을 해석할 수 없습니다.' }));
  if (!res.ok) throw new Error(json.error || `조회 실패 (${res.status})`);
  return json;
}

// ---------- 등급표 ----------
function renderTable(d) {
  current = d;
  syncUrl({ name: d.player.name });
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

  const rows = d.rows.map(r => `
    <tr class="row-link ${r.thinFile ? 'thin-row' : ''}" data-cid="${r.characterId}">
      <td>${esc(r.name)}</td>
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
        <h2>신용등급표</h2>
        <div class="meta">LUMIA CREDIT BUREAU · 실험체별 신용평가 결과</div>
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
      <table>
        <thead><tr>
          <th>실험체</th><th>신용등급</th><th class="num">평점</th><th class="num">거래건수</th>
          <th class="num hide-sm">승률</th><th class="num hide-sm">평균순위</th><th class="num hide-sm">피조회</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="doc-foot">
        행을 선택하면 해당 실험체의 신용조사서가 발급됩니다.
        조사서 발급 시 대상자의 조회 이력에 기록됩니다.
        ${d.failedSeasons ? `<br>일부 시즌(${d.failedSeasons}개) 자료를 가져오지 못해 평가에서 제외했습니다.` : ''}
      </div>
    </div>`;

  tableView.querySelectorAll('.row-link').forEach(tr => {
    tr.addEventListener('click', () => openReport(d.player.name, tr.dataset.cid));
  });
  tableView.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- 신용조사서 ----------
function renderReport(d) {
  syncUrl({ name: d.player.name, c: d.characterId });
  tableView.hidden = true;
  reportView.hidden = false;

  const issued = new Date(d.issuedAt);
  const dateStr = `${issued.getFullYear()}. ${issued.getMonth() + 1}. ${issued.getDate()}.`;

  let body;
  if (d.thinFile) {
    body = `
      <div class="verdict">
        <img class="portrait" src="/img/char/${esc(d.character.key)}" alt="${esc(d.character.name)}">
        <div class="verdict-main">
          <div class="who"><b>${esc(d.player.name)}</b> 님 · ${esc(d.character.name)}</div>
          <div class="big-grade">평가불가<small>NO SCORE</small></div>
          <div class="gauge"><i style="width:0"></i></div>
        </div>
        <dl class="limit-box">
          <dt>여신 판정</dt><dd>보류</dd>
          <dt>비고</dt><dd>보증인 필요</dd>
        </dl>
      </div>
      <div class="callout warn"><b>${esc(d.headline)}</b><br>${esc(d.note)}</div>
      <h3 class="sec">거래 현황</h3>
      ${statTable(d)}`;
  } else {
    const color = getComputedStyle(document.documentElement).getPropertyValue(
      d.grade <= 2 ? '--g-good' : d.grade <= 4 ? '--g-fair' : d.grade <= 6 ? '--g-mid' : d.grade <= 8 ? '--g-warn' : '--g-bad');
    body = `
      <div class="verdict">
        <img class="portrait" src="/img/char/${esc(d.character.key)}" alt="${esc(d.character.name)}">
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
        <table>
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
        </table>
        <div class="doc-foot" style="margin-top:12px;padding-top:10px">연체 이력은 5년간 보존됩니다.</div>
      ` : `<div class="callout">해당 실험체의 연체 기록이 없습니다. 전 시즌 본인 평균 이상의 성과를 유지했습니다.</div>`}

      <h3 class="sec">거래 현황</h3>
      ${statTable(d)}

      <h3 class="sec">조회 이력</h3>
      <div class="callout${d.inquiries >= 5 && d.grade >= 7 ? ' warn' : ''}">
        최근 30일간 <b>${d.inquiries}건</b> 조회되었습니다.
        ${d.inquiries >= 5 && d.grade >= 7
          ? '조회 건수 대비 등급이 낮습니다. 듀오 심사 반복 탈락이 추정됩니다.'
          : d.inquiries >= 5 ? '조회 빈도가 높습니다. 거래 수요가 많은 실험체입니다.' : ''}
      </div>`;
  }

  reportView.innerHTML = `
    <button class="btn-back" id="back">← 등급표로</button>
    <div class="doc">
      <div class="doc-head">
        <h2>신용조사서</h2>
        <div class="meta">보고서번호 ${esc(d.reportNo)} · 발급일 ${dateStr} · 루미아 신용정보원</div>
      </div>
      ${body}
      <div class="doc-foot">
        본 조사서는 dak.gg 공개 전적 ${num(d.seasonsPlayed)}개 시즌 자료를 근거로 산정되었습니다.
        평가 기준선은 조회 대상 본인의 전체 평균이며, 타 이용자와의 절대 비교가 아닙니다.
        본 기관은 실존하지 않으며 평가 결과는 오락 목적입니다.
      </div>
    </div>`;
  $('#back').addEventListener('click', () => {
    reportView.hidden = true; tableView.hidden = false;
    if (current) syncUrl({ name: current.player.name });
    tableView.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  reportView.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
  return `<table>
    <thead><tr><th>항목</th><th class="num">${esc(d.character.name)}</th><th class="num">본인 전체 평균</th></tr></thead>
    <tbody>${rows.map(r => `<tr><td>${r[0]}</td><td class="num">${r[1]}</td><td class="num">${r[2]}</td></tr>`).join('')}</tbody>
  </table>`;
}

// ---------- 흐름 ----------
async function openReport(name, cid) {
  setStatus('신용조사서 발급 중…');
  try {
    renderReport(await api(`/api/credit?name=${encodeURIComponent(name)}&characterId=${cid}`));
    setStatus('');
  } catch (e) { setStatus(e.message, true); }
}

function syncUrl(params) {
  const q = new URLSearchParams();
  q.set('name', params.name);
  if (params.c) q.set('c', params.c);
  history.replaceState(null, '', '?' + q);
}

async function lookup(name, cid) {
  btn.disabled = true;
  tableView.hidden = true; reportView.hidden = true;
  setStatus('전 시즌 거래 이력을 조회하고 있습니다. 시즌 수에 따라 10초 이상 걸릴 수 있습니다…');
  try {
    const d = await api(`/api/report?name=${encodeURIComponent(name)}`);
    renderTable(d);
    setStatus('');
    if (cid) await openReport(d.player.name, cid);
  } catch (e) { setStatus(e.message, true); }
  btn.disabled = false;
}

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
});
