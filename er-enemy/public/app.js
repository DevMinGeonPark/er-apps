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

const SCAN_MSGS = ['위성 위치 조정 중…', '관전 기록 입수 중…', '원한 데이터 대조 중…', '표적 프로필 복원 중…'];
let scanTimer = null;
function startScan() {
  let i = 0;
  hint.classList.remove('error');
  hint.textContent = SCAN_MSGS[0];
  scanTimer = setInterval(() => { hint.textContent = SCAN_MSGS[++i % SCAN_MSGS.length]; }, 1100);
}
function stopScan(msg, isError) {
  clearInterval(scanTimer);
  hint.classList.toggle('error', !!isError);
  hint.textContent = msg;
}

directToggle.addEventListener('click', () => {
  directForm.hidden = !directForm.hidden;
  if (!directForm.hidden) enemyInput.focus();
});

meForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = meInput.value.trim();
  if (!name) return;
  meBtn.disabled = true;
  startScan();
  try {
    const data = await ER.killers(name);
    myName = data.me;
    hadKillers = true;
    renderKillers(data);
    stopScan(`색출 완료 — 최근 랭크 ${data.scanned}판에서 원수 ${data.killers.length}명을 특정했습니다.`);
  } catch (err) {
    stopScan(err.message, true);
    killersSec.hidden = true;
    obsSec.hidden = true;
  } finally {
    meBtn.disabled = false;
  }
});

directForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const enemy = enemyInput.value.trim();
  if (!enemy) return;
  observe({ enemy });
});

backBtn.addEventListener('click', () => {
  obsSec.hidden = true;
  if (hadKillers) killersSec.hidden = false;
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
  killersSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function observe({ enemy, me, gameId }) {
  startScan();
  try {
    const data = await ER.observe(enemy, me, gameId);
    renderObservation(data);
    stopScan('관측 완료.');
  } catch (err) {
    stopScan(err.message, true);
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
      <div class="label">TARGET — 요주의 인물</div>
      <div class="nick">${esc(t.nickname)}</div>
      <div class="charline">최근 목격 실험체: ${esc(t.characterName || '불상')}</div>
    </div>
    <div class="target-stats">
      <span>계정 레벨 <b>${esc(t.accountLevel ?? '—')}</b></span>
      <span>시즌 랭크 참가 <b>${esc(t.seasonPlays ?? '—')}</b></span>
      <span>시즌 평균 킬 <b>${t.averageKills == null ? '—' : esc(t.averageKills)}</b></span>
      <span>현재 MMR <b>${t.mmr ? t.mmr.toLocaleString('ko-KR') : '—'}</b></span>
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
    ${data.afterGames.length ? `
      <div class="mmr-rows">${rows}</div>
      <div class="chart-legend">
        <span class="up"><i></i>MMR 획득</span>
        <span class="down"><i></i>MMR 손실</span>
      </div>` : ''}
  </div>`;

  obsRoot.innerHTML = html;
  obsSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// URL로 바로: /?me=닉 (색출) · /?enemy=닉 (근황) · /?enemy=닉&me=닉&gameId=ID (사슬 포함 관측)
const params = new URLSearchParams(location.search);
if (params.get('enemy')) {
  observe({
    enemy: params.get('enemy'),
    me: params.get('me') || undefined,
    gameId: parseInt(params.get('gameId'), 10) || undefined,
  });
} else if (params.get('me')) {
  meInput.value = params.get('me');
  meForm.requestSubmit();
}
