// 루미아섬 원수 관측소 — 프론트엔드
const $ = (s) => document.querySelector(s);
const hint = $('#hint');
const meForm = $('#meForm');
const meInput = $('#meInput');
const meBtn = $('#meBtn');
const directToggle = $('#directToggle');
const directForm = $('#directForm');
const enemyInput = $('#enemyInput');
const killersSec = $('#killersSec');
const killersNote = $('#killersNote');
const killerGrid = $('#killerGrid');
const obsSec = $('#obsSec');
const obsRoot = $('#obsRoot');
const backBtn = $('#backBtn');

let myName = null;
let hadKillers = false;
let operationId = 0, busy = false, lookupController;
LumiaClerk.bindNickname(meInput);
function setBusy(value) {
  busy = value;
  meBtn.disabled = value;
  directForm.querySelector('button').disabled = value;
  document.querySelector('#searchConsole').setAttribute('aria-busy', String(value));
}
function cancelLookup() { lookupController?.abort(); operationId++; setBusy(false); stopScan('접수 내용을 확인한 뒤 다시 조회할 수 있습니다.'); }
document.addEventListener('lumia:cancel', event => {
  cancelLookup();
  if (event.cancelable) {
    if (!obsSec.hidden && hadKillers) {
      event.preventDefault(); obsSec.hidden = true; killersSec.hidden = false;
      LumiaClerk.setState('result', '원수 후보 명단'); killerGrid.querySelector('button')?.focus();
    } else { obsSec.hidden = true; killersSec.hidden = true; }
  } else LumiaClerk.setState(!obsSec.hidden || !killersSec.hidden ? 'result' : 'intake');
});

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function fmtSigned(n) { return (n > 0 ? '+' : '') + n; }
function fmtElapsed(sec) {
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return m > 0 ? `${m}분 ${s}초` : `${s}초`;
}
function fmtDate(iso) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

let scanTimer = null;
function startScan() {
  clearInterval(scanTimer);
  hint.classList.remove('error');
  hint.textContent = '공개 경기 기록을 확인하고 있습니다.';
  LumiaClerk.setState('loading');
}
function stopScan(msg, isError) {
  clearInterval(scanTimer);
  hint.classList.toggle('error', !!isError);
  hint.textContent = msg;
}

directToggle.addEventListener('click', () => {
  cancelLookup();
  directForm.hidden = !directForm.hidden;
  meForm.hidden = !directForm.hidden;
  directToggle.setAttribute('aria-expanded', String(!directForm.hidden));
  directToggle.textContent = directForm.hidden ? '상대 이름을 알고 있어요' : '내 닉네임으로 후보 찾기';
  (directForm.hidden ? meInput : enemyInput).focus();
  LumiaClerk.setState('intake');
});
for (const input of [meInput, enemyInput]) {
  input.addEventListener('invalid', () => { input.setAttribute('aria-invalid', 'true'); stopScan('닉네임을 입력해 주세요.', true); });
  input.addEventListener('input', () => input.removeAttribute('aria-invalid'));
}

meForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (busy) return;
  const name = meInput.value.trim();
  if (!name) { meInput.setAttribute('aria-invalid', 'true'); stopScan('내 닉네임을 입력해 주세요.', true); meInput.focus(); return; }
  const operation = ++operationId;
  lookupController = new AbortController();
  LumiaContext.setNickname(name);
  setBusy(true);
  killersSec.hidden = true; obsSec.hidden = true;
  startScan();
  try {
    const data = await ER.killers(name, { signal: lookupController.signal });
    if (operation !== operationId) return;
    myName = data.me;
    hadKillers = true;
    renderKillers(data);
    LumiaClerk.setState('result', '원수 후보 명단');
    stopScan(`색출 완료 — 최근 랭크 ${data.scanned}판에서 원수 ${data.killers.length}명을 특정했습니다.`);
  } catch (err) {
    if (operation !== operationId) return;
    LumiaClerk.setState('error');
    stopScan(err.message, true);
    killersSec.hidden = true;
    obsSec.hidden = true;
  } finally {
    if (operation === operationId) setBusy(false);
  }
});

directForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const enemy = enemyInput.value.trim();
  if (!enemy) { enemyInput.setAttribute('aria-invalid', 'true'); stopScan('상대 닉네임을 입력해 주세요.', true); enemyInput.focus(); return; }
  observe({ enemy });
});

backBtn.addEventListener('click', () => {
  cancelLookup();
  obsSec.hidden = true;
  if (hadKillers) killersSec.hidden = false;
  LumiaClerk.setState(hadKillers ? 'result' : 'intake', hadKillers ? '원수 후보 명단' : '접수');
  (hadKillers ? killerGrid.querySelector('button') : (directForm.hidden ? meInput : enemyInput))?.focus();
  window.scrollTo({ top: 0 });
});

function renderKillers(data) {
  obsSec.hidden = true;
  killersSec.hidden = false;
  const extra = [];
  if (data.beastDeaths) extra.push(`야생동물에게 ${data.beastDeaths}회`);
  if (data.zoneDeaths) extra.push(`금지구역에서 ${data.zoneDeaths}회`);
  killersNote.textContent = extra.length ? `그 외 ${extra.join(', ')} 사망 — 자연은 관측 대상이 아닙니다.` : '';
  killerGrid.innerHTML = '';
  for (const k of data.killers) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'killer-card';
    btn.innerHTML = `
      ${k.last.byCharKey ? `<img src="${ER.charImgUrl(k.last.byCharKey)}" crossorigin="anonymous" alt="">` : '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="">'}
      <span class="info">
        <span class="nick">${esc(k.nickname)}</span><br>
        <span class="meta">${esc(k.last.byCharName)} · ${esc(k.last.placeName || '불상')} · ${esc(k.last.modeName)} · ${fmtDate(k.last.startDtm)}</span>
      </span>
      <span class="count">☠ ×${k.count}</span>`;
    btn.addEventListener('click', () => observe({ enemy: k.nickname, me: myName, gameId: k.last.gameId }));
    killerGrid.appendChild(btn);
  }
  killersSec.tabIndex = -1; killersSec.focus({ preventScroll: true });
  killersSec.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
}

async function observe({ enemy, me, gameId }) {
  if (busy) return;
  const operation = ++operationId;
  lookupController = new AbortController();
  setBusy(true);
  obsSec.hidden = true;
  startScan();
  try {
    const data = await ER.observe(enemy, me, gameId, { signal: lookupController.signal });
    if (operation !== operationId) return;
    renderObservation(data);
    LumiaClerk.setState('result', '공개 경기 관측 기록');
    stopScan('관측 완료.');
  } catch (err) {
    if (operation !== operationId) return;
    LumiaClerk.setState('error');
    stopScan(err.message, true);
  } finally {
    if (operation === operationId) setBusy(false);
  }
}

function chainItem(cls, node, when, who, whoSmall, how) {
  return `
    <li class="${cls}">
      <span class="node">${node}</span>
      ${when ? `<div class="when">${when}</div>` : ''}
      <div class="who">${who}${whoSmall ? ` <small>${whoSmall}</small>` : ''}</div>
      ${how ? `<div class="how">${how}</div>` : ''}
    </li>`;
}

function cumulativeChart(games) {
  const known = games.filter(game => Number.isFinite(game.cum));
  if (!known.length) return '';
  const low = Math.min(0, ...known.map(game => game.cum));
  const high = Math.max(0, ...known.map(game => game.cum));
  const range = high - low || 1;
  const y = value => 110 - (value - low) / range * 90;
  let points = [], segments = [];
  games.forEach((game, index) => {
    if (!Number.isFinite(game.cum)) { if (points.length) segments.push(points.join(' ')); points = []; return; }
    points.push(`${20 + index / Math.max(1, games.length - 1) * 460},${y(game.cum)}`);
  });
  if (points.length) segments.push(points.join(' '));
  return `<figure class="cumulative-chart"><figcaption>이후 경기 누적 MMR 추이</figcaption><svg viewBox="0 0 500 140" role="img" aria-label="확인된 ${known.length}경기의 누적 MMR: ${known.map(game => fmtSigned(game.cum)).join(', ')}. 일부 누락 기록은 연결하지 않습니다."><line x1="20" y1="${y(0)}" x2="480" y2="${y(0)}" stroke="#536970" stroke-dasharray="3 4"/>${segments.map(segment => `<polyline points="${segment}" fill="none" stroke="#b7ccc5" stroke-width="2"/>`).join('')}<text x="20" y="134" fill="#a6babc" font-size="11">첫 경기</text><text x="480" y="134" text-anchor="end" fill="#a6babc" font-size="11">최근 경기</text></svg></figure>`;
}

function renderObservation(data) {
  const t = data.target;
  killersSec.hidden = true;
  obsSec.hidden = false;

  // ----- 표적 배너 -----
  let html = `
  <div class="target-banner">
    <div class="crosshair">
      ${t.characterKey ? `<img src="${ER.charImgUrl(t.characterKey)}" crossorigin="anonymous" alt="">` : ''}
    </div>
    <div class="who">
      <div class="label">관측 대상 · 공개 경기 기록</div>
      <div class="nick">${esc(t.nickname)}</div>
      <div class="charline">최근 목격 실험체: ${esc(t.characterName || '불상')}</div>
    </div>
    <div class="target-stats">
      <span>계정 레벨 <b>${esc(t.accountLevel ?? '—')}</b></span>
      <span>시즌 랭크 참가 <b>${esc(t.seasonPlays ?? '—')}</b></span>
      <span>시즌 평균 킬 <b>${t.averageKills == null ? '—' : esc(t.averageKills)}</b></span>
      <span>현재 MMR <b>${t.mmr != null ? t.mmr.toLocaleString('ko-KR') : '—'}</b></span>
    </div>
  </div>`;

  // ----- 복수의 사슬 -----
  if (data.myDeath && data.chain) {
    const md = data.myDeath;
    let items = chainItem(
      'me', '⚰', fmtDate(md.startDtm) + ' · 생존 ' + fmtElapsed(md.playTime),
      esc(md.me), esc(md.characterName) + ' · 최종 ' + md.gameRank + '위',
      `${esc(md.placeName || '불상의 장소')}에서 <em>${esc(md.byNickname || '?')}</em>의 ${esc(md.cause || '공격')}에 처형당함`
    );
    for (const s of data.chain) {
      if (s.missing) {
        items += chainItem('', '?', null, esc(s.nickname), null, esc(s.reason || '기록 접근 불가 — 관측이 여기서 끊겼습니다.'));
        continue;
      }
      if (s.won) {
        items += chainItem('crown', '👑', null, esc(s.nickname), esc(s.characterName),
          `그 판의 최종 우승자 (${s.playerKill}킬)`);
        continue;
      }
      const d = s.death;
      const cls = d && d.kind !== 'player' ? 'beast' : '';
      const executor = d
        ? (d.kind === 'player'
          ? `<em>${esc(d.byNickname)}</em>(${esc(d.byCharName)})의 ${esc(d.cause || '공격')}`
          : d.kind === 'wildAnimal' || d.kind === 'monster'
            ? `야생 <em>${esc(d.byCharName)}</em>의 습격`
            : `<em>${esc(d.byCharName)}</em> — 금지구역 프로토콜`)
        : '불명의 원인';
      items += chainItem(cls, cls === 'beast' ? '🐻' : '⚰',
        `+${fmtElapsed(s.deltaSec)} 후`,
        esc(s.nickname), esc(s.characterName) + ' · 최종 ' + s.gameRank + '위',
        `${esc((d && d.placeName) || '불상의 장소')}에서 ${executor}에 처형됨`);
    }
    html += `
    <div class="obs-sec">
      <h2>그 판의 전말</h2>
      <p class="desc">당신의 죽음에서 시작된 사슬 — 죽인 자는 반드시 죽는가.</p>
      <ul class="chain">${items}</ul>
      ${data.verdict ? `<div class="verdict ${esc(data.verdict.tone)}">${esc(data.verdict.text)}</div>` : ''}
    </div>`;
  }

  // ----- 근황 -----
  const f = data.fate;
  const total = f.total;
  const dirCls = total > 0 ? 'up' : total < 0 ? 'down' : 'flat';
  const maxAbs = Math.max(1, ...data.afterGames.map(g => Math.abs(g.mmrGain)));
  const rows = data.afterGames.map(g => {
    const pct = Math.abs(g.mmrGain) / maxAbs * 50;
    const cls = g.mmrGain > 0 ? 'up' : g.mmrGain < 0 ? 'down' : 'flat';
    return `
    <div class="mmr-row">
      <span>${fmtDate(g.startDtm)}</span>
      <span class="rank ${g.died ? 'dead' : ''}">${g.gameRank}위</span>
      <span class="bar-track">${g.mmrGain != null && g.mmrGain !== 0 ? `<span class="bar ${cls}" style="width:${pct}%"></span>` : ''}</span>
      <span class="val ${cls}">${g.mmrGain == null ? '—' : g.mmrGain === 0 ? '·' : fmtSigned(g.mmrGain)}</span>
    </div>`;
  }).join('');
  html += `
  <div class="obs-sec">
    <h2>그 후의 행적</h2>
    <p class="desc">${data.baseline ? '당신을 죽인 그 판 이후의 궤적입니다.' : '최근 궤적입니다.'}</p>
    <div class="fate-hero">
      <span class="num ${dirCls}">${data.afterGames.length && total != null ? fmtSigned(total) : '—'}</span>
      <span class="cap">누적 MMR (${data.afterGames.length}판)</span>
    </div>
    ${f.notes && f.notes.length ? `<div class="fate-notes">${f.notes.map(esc).join(' · ')}</div>` : ''}
    <div class="verdict ${esc(f.tone)}">${esc(f.text)}</div>
    ${cumulativeChart(data.afterGames)}
    ${data.afterGames.length ? `
      <div class="mmr-rows">${rows}</div>
      <div class="chart-legend">
        <span class="up"><i></i>MMR 획득</span>
        <span class="down"><i></i>MMR 손실</span>
      </div>` : ''}
  </div>`;

  obsRoot.innerHTML = html;
  const checked = document.createElement('p'); checked.className = 'hint';
  checked.textContent = '조회 확인: ' + new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' }).format(new Date()) + ' (한국 시간) · 공개된 경기 기록 기준';
  obsRoot.prepend(checked);
  obsSec.tabIndex = -1; obsSec.focus({ preventScroll: true });
  obsSec.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
}

// URL로 바로: /?me=닉 (색출) · /?enemy=닉 (근황) · /?enemy=닉&me=닉&gameId=ID (사슬 포함 관측)
const params = new URLSearchParams(location.search);
if (params.get('enemy')) {
  enemyInput.value = params.get('enemy');
  directForm.hidden = false; meForm.hidden = true;
  directToggle.textContent = '내 닉네임으로 후보 찾기'; directToggle.setAttribute('aria-expanded', 'true');
  observe({
    enemy: params.get('enemy'),
    me: params.get('me') || undefined,
    gameId: parseInt(params.get('gameId'), 10) || undefined,
  });
} else if (params.get('me')) {
  meInput.value = params.get('me');
  meForm.requestSubmit();
}
