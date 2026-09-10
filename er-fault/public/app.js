// 루미아 손해보험 — 기존 계산 결과를 그대로 사용하는 접수·문서 화면
const $ = (s) => document.querySelector(s);
const fmt = (n) => n == null ? '—' : Number(n).toLocaleString('ko-KR');
const PCOLORS = ['#536e66', '#796951', '#596777'];
const BODY_FONT = `GowunBatang, AppleMyungjo, Batang, serif`;
const TITLE_FONT = `SongMyung, GowunBatang, AppleMyungjo, serif`;
let lastResult = null;
let selectedMatch = -1;
let operation = 0;
let pending = false;
let resultQuery = '';
const clerkState = (state, message) => window.LumiaClerk?.setState(state, message);
window.LumiaClerk?.bindNickname($('#me'));
let selfEditing = !$('#me').value.trim();
function syncSelfSummary() {
  const name = $('#me').value.trim();
  const compact = !!name && !selfEditing;
  $('#self-nickname').textContent = name;
  $('#self-summary').hidden = !compact;
  $('#me').hidden = compact;
}
function editSelf(focus = true) {
  selfEditing = true;
  syncSelfSummary();
  if (focus) $('#me').focus();
}
$('#edit-self').addEventListener('click', () => editSelf());

async function loadSeasons() {
  const seasons = await ER.seasons();
  $('#season').innerHTML = '<option value="auto">자동 (최근 기록 있는 시즌)</option>'
    + seasons.map(s => `<option value="${esc(s.key)}">${esc(s.name)}</option>`).join('');
  updateConditions();
}
function updateConditions() {
  $('#conditions-summary').textContent = ['season', 'mode', 'pages'].map(id => {
    const field = $('#' + id);
    return field.selectedOptions[0]?.textContent || '자동';
  }).join(' · ');
}
['season', 'mode', 'pages'].forEach(id => $('#' + id).addEventListener('change', updateConditions));
function updateBtn() {
  const ready = !!($('#me').value.trim() && $('#mate1').value.trim());
  $('#go').disabled = pending || !ready;
  $('#submit-hint').textContent = ready ? '입력한 닉네임과 조회 조건으로 산정합니다.' : '본인과 팀원 1의 닉네임이 필요합니다.';
}
function setFieldError(id, message) {
  $('#' + id).setAttribute('aria-invalid', String(!!message));
  $('#' + id + '-error').textContent = message;
  $('#' + id + '-error').hidden = !message;
  if (id === 'me' && message) editSelf(false);
}
['me', 'mate1', 'mate2'].forEach(id => $('#' + id).addEventListener('input', () => { setFieldError(id, ''); if (id === 'me') syncSelfSummary(); updateBtn(); }));
function returnToIntake(focus = true) {
  operation++;
  pending = false;
  $('#result-section').hidden = true;
  $('#loading-section').hidden = true;
  $('#form-section').hidden = false;
  $('#form-section').removeAttribute('aria-busy');
  $('#form-error').hidden = true;
  clerkState('intake');
  updateBtn();
  editSelf(false);
  if (focus) $('#me').focus();
}
window.addEventListener('pagehide', () => returnToIntake(false));
document.addEventListener('lumia:cancel', () => returnToIntake(false));

async function run() {
  if (pending) return;
  const ids = ['me', 'mate1', 'mate2'];
  const names = ids.map(id => $('#' + id).value.trim());
  let invalid = null;
  ids.forEach((id, i) => {
    const message = i < 2 && !names[i] ? '닉네임을 입력해 주세요.'
      : names[i] && names.findIndex(n => n.toLowerCase() === names[i].toLowerCase()) !== i ? '다른 참가자와 같은 닉네임입니다.' : '';
    setFieldError(id, message);
    if (message && !invalid) invalid = id;
  });
  if (invalid) { $('#' + invalid).focus(); return; }
  const me = names[0], mates = names.slice(1).filter(Boolean);
  const q = new URLSearchParams({ me, mates: mates.join(','), season: $('#season').value, mode: $('#mode').value, pages: $('#pages').value });
  const demo = new URLSearchParams(location.search).get('demo');
  if (demo) q.set('demo', demo);
  const request = ++operation;
  pending = true;
  updateBtn();
  window.LumiaContext?.setNickname(me);
  $('#form-section').hidden = true;
  $('#form-section').setAttribute('aria-busy', 'true');
  $('#form-error').hidden = true;
  $('#result-section').hidden = true;
  $('#loading-section').hidden = false;
  $('#loading-msg').textContent = '기록 확인 중입니다. 함께한 경기를 대조하고 있습니다.';
  clerkState('loading');
  let timeout;
  try {
    const data = await Promise.race([
      ER.assessRequest({ ...Object.fromEntries(q), mates }),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('기록 조회 시간이 초과되었습니다. 잠시 후 다시 신청해 주세요.')), 180000); }),
    ]);
    if (request !== operation) return;
    if (!Array.isArray(data?.names) || !data.names.length || !Array.isArray(data.accidents) || (!data.noAccident && (!Array.isArray(data.fault) || data.fault.length !== data.names.length))) {
      throw new Error('산정에 필요한 일부 기록을 받지 못했습니다. 다시 조회해 주세요.');
    }
    lastResult = data;
    selectedMatch = -1;
    resultQuery = q.toString();
    renderMatchOptions(data);
    renderPaper(data);
    renderDetail(data);
    $('#result-section').hidden = false;
    $('#result-status').textContent = data.noAccident ? '함께한 경기 중 심의 대상 패배 사고가 없습니다.' : '산정이 완료되었습니다. 경기별 판정과 근거를 확인할 수 있습니다.';
    history.replaceState(null, '', '?' + resultQuery);
    clerkState('result');
    window.LumiaContext?.remember('liability');
    $('#assessment-title').focus({ preventScroll: true });
    $('#result-section').scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  } catch (e) {
    if (request !== operation) return;
    $('#form-section').hidden = false;
    const participant = e.participant && e.status !== 404 ? `${e.participant === me ? '본인' : '팀원'} '${e.participant}' 기록 조회 실패: ` : '';
    $('#form-error').textContent = participant + (e.message || '기록을 불러오지 못했습니다. 다시 조회해 주세요.');
    $('#form-error').hidden = false;
    clerkState('error', $('#form-error').textContent);
  } finally {
    clearTimeout(timeout);
    if (request === operation) {
      pending = false;
      $('#loading-section').hidden = true;
      $('#form-section').removeAttribute('aria-busy');
      updateBtn();
    }
  }
}

const imgToDataUri = (url) => ER.imgToDataUri(url);
function esc(s) { return String(s ?? '').replace(/[<>&'"\\]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;', '\\': '&#92;' }[c])); }
const mmss = s => s == null ? '—' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
function matchLabel(a) { return `${a.startDtm ? new Date(a.startDtm).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '일시 미제공'} · ${a.mode} · ${a.rank}위 · 경기 #${a.gameId}`; }
function renderMatchOptions(d) {
  $('#match-choice').innerHTML = `<option value="-1">전체 사고 종합 · ${d.sharedGames}판 확인 / ${d.accidentCount}건</option>`
    + d.accidents.map((a, i) => `<option value="${i}">${esc(matchLabel(a))}</option>`).join('');
  $('.match-select').hidden = d.noAccident;
}
function selectedView(d) {
  const a = selectedMatch >= 0 ? d.accidents[selectedMatch] : null;
  return { a, names: a ? a.players.map(p => p.name) : d.names, fault: a ? a.fault : d.fault, culprit: a ? a.culprit : d.culpritIdx,
    scope: a ? matchLabel(a) : `함께한 ${d.sharedGames}판 · 사고 ${d.accidentCount}건 · 사고율 ${d.accidentRate}% · 할인할증등급 ${d.grade}Z` };
}
function renderPaper(d) {
  const { a, names, fault, culprit, scope } = selectedView(d);
  const issued = new Date(d.issuedAt).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
  const labels = names.map((name, i) => `${name} ${fault?.[i] ?? '—'}%`);
  const ratio = d.noAccident ? '' : `<div class="fault-bar" role="img" aria-label="${esc(labels.join(', '))}">${fault.map((f, i) => `<span style="flex:${f};background:${PCOLORS[i]}" title="${esc(labels[i])}">${f >= 18 ? `<span>${esc(names[i])}<b>${f}%</b></span>` : ''}</span>`).join('')}</div><ul class="fault-legend">${labels.map((label, i) => `<li><i style="background:${PCOLORS[i]}" aria-hidden="true"></i>${esc(label)}</li>`).join('')}</ul>`;
  const selectedStats = a ? `<div class="selected-context">${esc(a.mode)} · ${a.rank}위 · ${esc(a.severity)} 사고 · RP ${a.rpDelta == null ? '미제공' : (a.rpDelta > 0 ? '+' : '') + a.rpDelta}</div><div class="table-scroll"><table class="selected-stats"><thead><tr><th>참가자 · 실험체</th><th>피해량</th><th>K / A / D</th><th>생존</th><th>기권</th></tr></thead><tbody>${a.players.map(p => `<tr><th scope="row">${esc(p.name)}<small>${esc(p.character)}${p.role ? ' · ' + esc(p.role) : ''}</small></th><td>${fmt(p.damage)}</td><td>${p.kill ?? '—'} / ${p.assist ?? '—'} / ${p.deaths ?? '—'}</td><td>${mmss(p.playTime)}</td><td>${p.giveUp ? '기권' : '없음'}</td></tr>`).join('')}</tbody></table></div>` : '';
  const evidence = d.noAccident ? '' : `<details class="judgement-evidence" open><summary>판정 근거 · 적용 약관</summary>${names.map((name, i) => {
    const items = a ? (a.items?.[i] || []).map(it => `${it.clause} · ${it.desc} · ${it.pts > 0 ? '+' : ''}${it.pts}점`) : (d.reasons?.[i] || []).map(r => `${r.clause} · ${r.label} · ${r.count}회 · 벌점 ${Math.round(r.pts)}점`);
    return `<section><h3>${esc(name)} · ${fault[i]}%</h3><ul>${items.map(item => `<li>${esc(item)}</li>`).join('') || '<li>벌점·감경 항목이 없습니다.</li>'}</ul></section>`;
  }).join('')}<a href="/fault/terms.html">실험체 운용 배상책임 약관 전문</a></details>`;
  $('#assessment').innerHTML = `<div class="assessment-meta"><span>루미아 손해보험 · 동일 경기 확인</span><span>문서번호 ${esc(d.docNo)}</span></div><h2 id="assessment-title" tabindex="-1">${d.noAccident ? '무사고 확인서' : '과실비율 산정서'}</h2><p class="assessment-scope">${esc(scope)}</p>${d.noAccident ? `<p class="no-accident"><strong>조회 범위에 심의 대상 패배 사고가 없습니다.</strong><br>${d.names.map(esc).join(' · ')}<br>함께한 ${d.sharedGames}판을 확인했습니다. 할인할증등급 ${d.grade}Z.</p>` : ratio + selectedStats + `<p class="verdict">최대 과실 · <strong>${esc(names[culprit])} ${fault[culprit]}%</strong>${a ? '' : ` <span>보험료 ${Math.min(d.grade * 3, 60)}% 할증</span>`}</p><p class="rounding-note">${a ? '경기별 비율은 기존 산정값을 정수로 반올림하여 합계가 100%와 다를 수 있습니다.' : '전체 과실은 사고별 원값의 평균을 반올림한 뒤 합계 100%로 보정합니다.'}</p>`}${evidence}<div class="assessment-foot"><span>${esc(issued)} · 루미아 손해사정법인</span><span class="document-seal">심의<br>완료</span></div><p class="document-disclaimer">재미용 문서로 실제 보험·법률 효력이 없습니다. 팀워크가 상하지 않을 만큼만 웃고 넘어가세요.<br>전적·게임 정보: 이터널 리턴 공식 Open API · 최근 90일 이내 조회 기록 기준 · 닉네임 변경 이전 기록 제외</p>`;
  renderExportSvg(d);
}

// SVG is generated from the selected server result so PNG includes its scope and full evidence.
function renderExportSvg(d) {
  const { a, names, fault, culprit, scope } = selectedView(d);
  let y = 54;
  const parts = [];
  const split = (value, max) => {
    const lines = []; let line = '', width = 0;
    for (const char of String(value ?? '—')) {
      const size = /[\u0000-\u007f]/.test(char) ? .55 : 1;
      if (char === '\n' || width + size > max) { lines.push(line); line = ''; width = 0; if (char === '\n') continue; }
      line += char; width += size;
    }
    lines.push(line); return lines;
  };
  const textLine = (value, size = 19, color = '#354039', bold = false) => {
    split(value, 890 / size).forEach(line => { parts.push(`<text x="55" y="${y}" font-size="${size}" fill="${color}"${bold ? ' font-weight="bold"' : ''}>${esc(line)}</text>`); y += size * 1.65; });
  };
  const rule = () => { y += 8; parts.push(`<line x1="55" y1="${y}" x2="945" y2="${y}" stroke="#bcc4b8"/>`); y += 28; };
  textLine(`루미아 손해보험 · 문서번호 ${d.docNo}`, 16, '#596757');
  y += 17;
  textLine(d.noAccident ? '무사고 확인서' : '과실비율 산정서', 36, '#293429', true);
  rule(); textLine(scope, 18);
  if (d.noAccident) {
    textLine('조회 범위에 심의 대상 패배 사고가 없습니다.', 24, '#354039', true);
    textLine(names.join(' · '));
  } else {
    y += 12;
    const total = fault.reduce((sum, value) => sum + value, 0) || 100;
    let x = 55;
    fault.forEach((f, i) => { const width = 890 * f / total; parts.push(`<rect x="${x}" y="${y}" width="${width}" height="46" fill="${PCOLORS[i]}"/>`); x += width; });
    y += 79;
    names.forEach((name, i) => textLine(`${name} · ${fault[i]}%`, 23, PCOLORS[i], true));
    textLine(`최대 과실: ${names[culprit]} ${fault[culprit]}%`, 21);
    if (a) textLine(`${a.mode} · ${a.rank}위 · ${a.severity} · RP ${a.rpDelta == null ? '미제공' : (a.rpDelta > 0 ? '+' : '') + a.rpDelta}`, 18);
    else textLine(`보험료 ${Math.min(d.grade * 3, 60)}% 할증`, 18);
    textLine(a ? '경기별 반올림값이므로 표시 합계는 100%와 다를 수 있습니다.' : '사고별 원값의 평균을 반올림하고 합계 100%로 보정합니다.', 16, '#596757');
    rule(); textLine('판정 근거', 24, '#293429', true);
    names.forEach((name, i) => {
      y += 12;
      textLine(`${name} · ${fault[i]}%`, 22, '#293429', true);
      if (a) {
        const p = a.players[i];
        textLine(`${p.character}${p.role ? ' · ' + p.role : ''} · 피해량 ${fmt(p.damage)} · K/A/D ${p.kill ?? '—'}/${p.assist ?? '—'}/${p.deaths ?? '—'} · 생존 ${mmss(p.playTime)} · 기권 ${p.giveUp ? '있음' : '없음'}`, 17);
      } else {
        const c = d.mainChar?.[i];
        if (c) textLine(`주 사용 실험체: ${c.name}${c.role ? ' · ' + c.role : ''}`, 17);
      }
      const reasons = a ? (a.items?.[i] || []).map(it => `${it.clause} · ${it.desc} · ${it.pts > 0 ? '+' : ''}${it.pts}점`) : (d.reasons?.[i] || []).map(r => `${r.clause} · ${r.label} · ${r.count}회 · 벌점 ${Math.round(r.pts)}점`);
      (reasons.length ? reasons : ['벌점·감경 항목 없음']).forEach(reason => textLine(reason, 17));
    });
  }
  rule();
  textLine(`${new Date(d.issuedAt).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })} · 루미아 손해사정법인`, 18);
  textLine('재미용 문서로 실제 보험·법률 효력이 없습니다. 팀워크가 상하지 않을 만큼만 웃고 넘어가세요.', 15, '#596757');
  textLine('전적·게임 정보: 이터널 리턴 공식 Open API · 최근 90일 이내 조회 기록 기준 · 닉네임 변경 이전 기록 제외', 15, '#596757');
  const height = Math.ceil(y + 30);
  $('#paper').innerHTML = `<svg id="paper-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 ${height}" font-family="${BODY_FONT}"><rect width="1000" height="${height}" fill="#fdfcf8"/>${parts.join('')}</svg>`;
}

// ---------- 상세 ----------
function renderDetail(d) {
  if (d.noAccident) { $('#detail').innerHTML = `<h3>상세 내역</h3><p style="color:#b7c5da;font-size:13.5px">사고가 없어 상세 내역이 없습니다. 이 팀은 보존하세요.</p>`; return; }
  const roleOf = i => i === d.culpritIdx ? '주과실자 · 구상권 청구 대상' : (d.fault[i] >= 25 ? '공동 과실' : '과실 경미 · 위로금 지급 대상');
  const members = d.names.map((nm, i) => `
    <div class="member ${i === d.culpritIdx ? 'culprit' : ''}">
      <div class="head">
        ${d.mainChar[i].key ? `<img src="${ER.charImgUrl(d.mainChar[i].key)}" crossorigin="anonymous" alt="">` : ''}
        <div><div class="nm">${esc(nm)}</div><div class="role">${d.mainChar[i].role ? d.mainChar[i].role + ' · ' : ''}${roleOf(i)}</div></div>
        <div class="pct" style="color:${PCOLORS[i]}">${d.fault[i]}%</div>
      </div>
      <ul>${(d.reasons[i] || []).map(r => `<li><span class="cl">${esc(r.clause)}</span><span>${esc(r.label)}</span><span class="ct">×${r.count} · ${Math.round(r.pts)}점</span></li>`).join('') || '<li><span>벌점 항목 없음 — 성실 교전</span></li>'}</ul>
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
          ${p.charKey ? `<img src="${ER.charImgUrl(p.charKey)}" crossorigin="anonymous" alt="">` : ''}
          <div>
            <b style="color:${PCOLORS[i]}">${esc(p.name)}</b> <span class="gm-fault">${a.fault[i]}%</span>${i === a.culprit ? ' <span class="culprit-chip">이 판의 범인</span>' : ''}
            <div class="gm-stat">${esc(p.character)}${p.role ? ` · ${p.role}` : ''} — 딜 ${fmt(p.damage)} · ${p.kill}/${p.assist}/${p.deaths} · 생존 ${mmss(p.playTime)}${p.giveUp ? ' · <b style="color:#ff8d7d">기권</b>' : ''}</div>
          </div>
        </div>
        <ul>${list}</ul>
      </div>`;
    }).join('');
    return `<tr class="acc-row" data-i="${ai}">
      <td><button type="button" class="acc-toggle" aria-expanded="false" aria-controls="acc-detail-${ai}"><span class="caret" aria-hidden="true">▸</span> ${esc(t)}<span class="visually-hidden"> 경기 #${esc(a.gameId)} 상세</span></button></td><td>${esc(a.mode)}</td><td class="num">${a.rank}위</td>
      <td class="num">${rp}</td>
      <td><span class="sev ${sev}">${a.severity}</span></td>
      <td><div class="mini" aria-hidden="true">${mini}</div><span class="mini-label">${a.fault.map((f,i) => `${esc(a.players[i].name)} ${f}%`).join(' · ')}</span></td>
      <td><span class="culprit-chip">${esc(a.players[a.culprit].name)}</span></td>
    </tr>
    <tr class="acc-detail" id="acc-detail-${ai}" data-for="${ai}" hidden><td colspan="7"><div class="game-grid">${detailCards}</div></td></tr>`;
  }).join('');

  $('#detail').innerHTML = `
    <details><summary>피보험자별 종합 과실 내역</summary>
    <h3>피보험자별 과실 내역</h3>
    <div class="member-grid">${members}</div>
    </details>
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
      tr.querySelector('.acc-toggle').setAttribute('aria-expanded', String(!det.hidden));
    });
  });
}

// ---------- PNG 저장 ----------
let fontCssPromise = null;
async function getEmbeddedFontCss() {
  if (!fontCssPromise) {
    fontCssPromise = (async () => {
      const fonts = [
        ['GowunBatang', 400, 'fonts/gowun-batang.woff'],
        ['GowunBatang', 700, 'fonts/gowun-batang-bold.woff'],
        ['SongMyung', 400, 'fonts/song-myung.woff'],
      ];
      const faces = await Promise.all(fonts.map(async ([fam, wt, url]) => {
        const uri = await imgToDataUri(url);
        return `@font-face{font-family:'${fam}';font-weight:${wt};src:url(${uri}) format('woff')}`;
      }));
      return faces.join('\n');
    })().catch(error => { fontCssPromise = null; throw error; });
  }
  return fontCssPromise;
}
async function downloadPng() {
  if (!lastResult || $('#result-section').hidden || $('#png').disabled) return;
  const btn = $('#png');
  const filename = `과실비율산정서_${lastResult.names.join('_')}${selectedMatch >= 0 ? '_경기' + lastResult.accidents[selectedMatch].gameId : ''}.png`;
  let url;
  btn.disabled = true; btn.textContent = '이미지 생성 중…';
  try {
    const svg = $('#paper-svg').cloneNode(true);
    await document.fonts?.ready;
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.textContent = await getEmbeddedFontCss();
    svg.insertBefore(style, svg.firstChild);
    const xml = new XMLSerializer().serializeToString(svg);
    url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('문서 이미지를 만들지 못했습니다. 다시 저장해 주세요.')); img.src = url; });
    const canvas = document.createElement('canvas');
    const [, , width, height] = svg.getAttribute('viewBox').split(' ').map(Number);
    canvas.width = width * 2; canvas.height = height * 2;
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = filename;
    a.click();
    $('#result-status').textContent = '선택한 판정 범위와 근거를 PNG로 저장했습니다.';
  } catch (error) {
    $('#result-status').textContent = error.message || 'PNG 저장에 실패했습니다. 다시 시도해 주세요.';
  } finally {
    if (url) URL.revokeObjectURL(url);
    btn.disabled = false; btn.textContent = '산정서 PNG 저장';
  }
}

// ---------- 이벤트 ----------
$('#form-section').addEventListener('submit', event => { event.preventDefault(); run(); });
$('#cancel').addEventListener('click', () => returnToIntake());
$('#match-choice').addEventListener('change', () => {
  selectedMatch = Number($('#match-choice').value);
  renderPaper(lastResult);
  $('#result-status').textContent = selectedMatch < 0 ? '전체 사고 종합 판정을 표시합니다.' : '선택한 경기의 판정과 근거를 표시합니다. PNG에도 같은 경기가 저장됩니다.';
});
$('#png').addEventListener('click', downloadPng);
$('#link').addEventListener('click', async () => {
  try {
    const url = new URL(location.pathname, location.origin);
    url.search = resultQuery;
    await navigator.clipboard.writeText(url.href);
    $('#result-status').textContent = '조회 링크를 복사했습니다. 링크를 열면 같은 조건으로 전체 결과를 다시 조회합니다.';
  } catch (error) {
    $('#result-status').textContent = '조회 링크를 복사하지 못했습니다. 주소 표시줄의 링크를 복사해 주세요.';
  }
});
$('#again').addEventListener('click', () => returnToIntake());

(async function init() {
  const p = new URLSearchParams(location.search);
  if (p.get('me')) { $('#me').value = p.get('me'); selfEditing = false; }
  const mates = (p.get('mates') || '').split(',').filter(Boolean);
  if (mates[0]) $('#mate1').value = mates[0];
  if (mates[1]) $('#mate2').value = mates[1];
  syncSelfSummary();
  if (['all', 'squad', 'cobalt'].includes(p.get('mode'))) $('#mode').value = p.get('mode');
  if (['2', '3', '5'].includes(p.get('pages'))) $('#pages').value = p.get('pages');
  updateConditions();
  updateBtn();
  try { await loadSeasons(); } catch (error) {
    $('#form-error').textContent = '시즌 목록을 불러오지 못했습니다. 자동 시즌으로 다시 조회할 수 있습니다.';
    $('#form-error').hidden = false;
  }
  if ([...$('#season').options].some(option => option.value === p.get('season'))) $('#season').value = p.get('season');
  updateConditions();
  if (p.get('me') && mates.length) run();
})().catch(error => {
  $('#form-error').textContent = error.message;
  $('#form-error').hidden = false;
});
