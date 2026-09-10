(() => {
  const $ = id => document.getElementById(id);
  const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const date = (value, time = false) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', ...(time ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}) }).format(new Date(value));
  const duration = seconds => seconds === null ? '기록 미제공' : `${Math.floor(seconds / 3600)}시간 ${Math.floor(seconds % 3600 / 60)}분`;
  const rp = value => value === null ? '미제공' : `${Payroll.signed(value)} RP`;
  const tone = value => value === null || value === 0 ? '' : value < 0 ? 'negative' : 'positive';
  let current = null, isSample = true, requestId = 0, loadingTimer;
  LumiaClerk.bindNickname($('nickname'));
  document.addEventListener('lumia:cancel', event => {
    requestId++; clearInterval(loadingTimer);
    $('loading').hidden = true; $('results').hidden = event.cancelable || !current;
    for (const id of ['submit', 'demo', 'nickname', 'count']) $(id).disabled = false;
    $('save').disabled = !current; $('share').disabled = !current || isSample;
    buttonBusy('submit', false, '급여 정산하기');
    $('results').setAttribute('aria-busy', 'false');
    $('status').textContent = '접수 내용을 확인한 뒤 다시 정산할 수 있습니다.';
    if (!event.cancelable) LumiaClerk.setState(current ? 'result' : 'intake');
  });

  function buttonBusy(id, busy, label) {
    $(id).setAttribute('aria-busy', String(busy));
    $(id + '-label').textContent = label;
  }

  function startLoading(nickname) {
    const started = performance.now();
    $('loading-title').textContent = `${nickname} 님의 공식 전적을 조회하고 있어요.`;
    $('loading-detail').textContent = '출퇴근 기록을 한 장씩 확인하고 있습니다. 조회가 끝나면 급여명세서를 보여드릴게요.';
    $('loading-elapsed').textContent = '0초 경과';
    $('loading').hidden = false;
    $('results').hidden = true;
    buttonBusy('submit', true, '정산 중…');
    let delayed = false;
    return setInterval(() => {
      const seconds = Math.floor((performance.now() - started) / 1000);
      $('loading-elapsed').textContent = `${seconds}초 경과`;
      if (seconds >= 15 && !delayed) {
        delayed = true;
        const message = '공식 전적 응답을 기다리고 있어요. 기록이 많거나 조회가 몰리면 시간이 조금 더 걸릴 수 있습니다.';
        $('loading-detail').textContent = message;
        $('status').textContent = message;
      }
    }, 1000);
  }

  function render(report, sample = false) {
    current = report; isSample = sample;
    $('results').hidden = false;
    LumiaClerk.setState('result', sample ? '가상 기록 예시 · 실제 전적이 아닙니다' : '급여명세서 열람');
    const stampDate = date(Date.now());
    const line = (label, detail, value, extra = '') => `<div class="slip-line ${extra}"><dt>${label}<small>${detail}</small></dt><dd class="${tone(value)}">${rp(value)}</dd></div>`;
    $('payslip').innerHTML = `<div class="slip-top"><span>루미아 노동청 · 급여 정산과</span><span class="${sample ? 'sample-label' : ''}">${sample ? 'SAMPLE / 가상 예시' : `LL-${escape(report.rows[0].gameId)}`}</span></div>
      <div class="slip-title"><h3>급여명세서</h3><p>RANKED LABOR · PAY STATEMENT</p></div>
      <div class="employee"><div><span>근로자</span><strong>${escape(report.nickname)} 님</strong></div><div><span>소속 사업장</span><strong>루미아섬 · 랭크 사업부</strong></div><div><span>정산 기간 · 한국 시간</span><strong class="dates">${date(report.start)} ~ ${date(report.end)}</strong></div><div><span>인정 근무</span><strong>${report.count}판 / ${duration(report.seconds)}</strong></div></div>
      <div class="net-box"><span>이번 정산 실수령액</span><div class="net-amount ${tone(report.net)}">${report.net === null ? '정산 보류' : Payroll.signed(report.net)}<small>${report.net === null ? '' : 'RP'}</small></div><p>${report.net === null ? `${report.missing}판의 RP 기록이 없어 합계 산정을 보류합니다.` : report.net < 0 ? '납부 안내: 이번 근무는 본인 부담으로 처리되었습니다.' : '안내: RP는 현금으로 환급되지 않습니다.'}</p></div>
      <dl class="slip-lines">${line('지급 합계', '공식 경기 내 획득 RP', report.gross)}${line('입장 공제', '공식 랭크 입장 비용', report.entry)}${line('기타 조정', '실제 RP 증감과 지급·공제 합계의 차이', report.adjustment)}${line('실수령 합계', `${report.count}판의 실제 RP 증감 합계`, report.net, 'total')}</dl>
      <div class="slip-bottom"><div class="issuer"><p>루미아 노동청장</p><small>${stampDate} 발급 · ${sample ? '가상 기록 예시' : '공식 전적 확인'}</small></div><div class="stamp">${report.stamp}</div></div>
      <p class="slip-source">${sample ? '발급 화면을 보여주기 위한 가상 기록입니다. 실제 플레이어의 전적이 아닙니다.' : '이터널리턴 공식 Open API · 최근 90일 이내 최대 100경기 중 랭크 기록 기준.'}<br>RP를 급여에 빗댄 재미용 문서입니다. 실제 임금·현금 가치·법적 효력이 없습니다.</p>`;
    $('hourly').innerHTML = report.hourly === null ? '산정 보류' : `${Payroll.signed(report.hourly)} <small>RP / 시간</small>`;
    $('verdict').textContent = report.verdict;
    const stats = [['실제 근무 시간', duration(report.seconds)], ['출근 도장', `${report.count}판`], ['우승 성과', `${report.wins}회`], ['최고 일당', report.best ? rp(report.best.net) : '미제공']];
    $('stats').innerHTML = stats.map(([label, value]) => `<div class="stat"><dt>${label}</dt><dd>${escape(value)}</dd></div>`).join('');
    $('result-tag').textContent = sample ? '가상 기록으로 만든 예시' : `${report.count}판 · 공식 전적 발급`;
    $('ledger-count').textContent = `${report.count}판${sample ? ' · 가상 예시' : ''}`;
    $('ledger-body').innerHTML = report.rows.map(m => `<tr><td>${date(m.startDtm, true)}<br><small>${sample ? '가상 경기' : '#' + escape(m.gameId)}</small></td><td>${Number.isFinite(m.gameRank) ? m.gameRank + '위' : '미제공'}</td><td>${Number.isFinite(m.playTime) && m.playTime > 0 ? Math.floor(m.playTime / 60) + '분 ' + m.playTime % 60 + '초' : '미제공'}</td><td>${rp(m.gross)}</td><td>${rp(m.entry)}</td><td>${rp(m.adjustment)}</td><td class="${tone(m.net)}"><strong>${rp(m.net)}</strong></td></tr>`).join('');
    $('share').disabled = sample;
    $('save').disabled = false;
    $('share').title = sample ? '닉네임으로 실제 명세서를 발급하면 공유할 수 있습니다.' : '';
    $('action-status').textContent = sample ? '예시 명세서입니다. 위에서 내 닉네임으로 발급해보세요.' : report.count < report.requested ? `조회 범위에 랭크 기록이 ${report.count}판 있어 해당 경기만 정산했습니다.` : '공유 링크는 접속 시점의 최신 전적으로 다시 정산됩니다.';
    const heading = $('results').querySelector('h2'); heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }

  async function issue() {
    if ($('submit').disabled) return;
    const nickname = $('nickname').value.trim();
    $('nickname').setAttribute('aria-invalid', String(!nickname));
    $('nickname-error').hidden = !!nickname;
    if (!nickname) { $('nickname').focus(); return; }
    const operation = ++requestId;
    LumiaContext.setNickname(nickname);
    LumiaClerk.setState('loading');
    const count = Number($('count').value);
    $('submit').disabled = true; $('demo').disabled = true; $('nickname').disabled = true; $('count').disabled = true;
    $('save').disabled = true; $('share').disabled = true;
    $('results').setAttribute('aria-busy', 'true');
    $('status').className = ''; $('status').textContent = '공식 출퇴근 기록을 확인하고 있습니다. 최대 100경기를 조회해요…';
    loadingTimer = startLoading(nickname);
    try {
      const matches = await ERCore.getMatches(nickname, { pages: 10, mode: 3 });
      if (operation !== requestId) return;
      const report = Payroll.calculate(matches, count);
      render(report);
      $('nickname').value = report.nickname;
      const url = new URL(location.href); url.search = new URLSearchParams({ name: report.nickname, count }); url.hash = '';
      history.replaceState(null, '', url);
      $('status').textContent = `${report.nickname} 님의 랭크 ${report.count}판 정산 완료.${report.count < count ? ' 조회 범위에서 확인된 경기만 정산했습니다.' : ''}`;
    } catch (error) {
      if (operation !== requestId) return;
      LumiaClerk.setState('error');
      $('status').className = 'error';
      $('status').textContent = (error.name === 'TimeoutError' ? '공식 전적 조회가 지연되고 있습니다. 잠시 후 다시 정산해주세요.' : error.message || '전적 조회에 실패했습니다.') + (current ? ' 아래 명세서는 이전 결과입니다.' : ' 입력값을 확인한 뒤 다시 시도해 주세요.');
      $('status').tabIndex = -1; $('status').focus({ preventScroll: true });
    } finally {
      if (operation !== requestId) return;
      clearInterval(loadingTimer);
      $('loading').hidden = true;
      $('results').hidden = !current;
      buttonBusy('submit', false, '급여 정산하기');
      for (const id of ['submit', 'demo', 'nickname', 'count']) $(id).disabled = false;
      $('save').disabled = !current;
      $('share').disabled = !current || isSample;
      $('results').setAttribute('aria-busy', 'false');
    }
  }

  $('payroll-form').addEventListener('submit', event => { event.preventDefault(); issue(); });
  $('nickname').addEventListener('invalid', () => { $('nickname-error').hidden = false; $('nickname').setAttribute('aria-invalid', 'true'); });
  $('nickname').addEventListener('input', () => { $('nickname-error').hidden = true; $('nickname').removeAttribute('aria-invalid'); });
  $('demo').addEventListener('click', () => {
    requestId++;
    render(Payroll.demo(), true);
    history.replaceState(null, '', location.pathname);
    $('status').className = ''; $('status').textContent = '가상 기록의 발급 예시입니다. 닉네임을 입력하면 실제 전적으로 정산합니다.';
  });
  $('save').addEventListener('click', async () => {
    $('save').disabled = true;
    buttonBusy('save', true, 'PNG 만드는 중…');
    $('action-status').textContent = '급여명세서 이미지를 만들고 있습니다…';
    try {
      await document.fonts.ready;
      const canvas = await html2canvas($('payslip'), { scale: 2, backgroundColor: '#fffef9', useCORS: true,
        onclone(doc) { const slip = doc.getElementById('payslip'); slip.style.boxShadow = 'none'; } });
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('이미지를 만들지 못했습니다. 다시 시도해주세요.');
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.download = `루미아_급여명세서_${isSample ? '예시' : current.nickname.replace(/[\\/:*?"<>|]/g, '_')}.png`;
      link.href = url; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
      $('action-status').textContent = '급여명세서 PNG를 저장했습니다.';
    } catch (error) { $('action-status').textContent = error.message || '이미지를 저장하지 못했습니다.'; }
    finally { $('save').disabled = false; buttonBusy('save', false, '명세서 PNG 저장'); }
  });
  $('share').addEventListener('click', async () => {
    if (isSample) return;
    try { await navigator.clipboard.writeText(location.href); $('action-status').textContent = '공유 링크를 복사했습니다. 접속 시점의 최신 전적으로 다시 정산됩니다.'; }
    catch {
      $('action-status').replaceChildren();
      const input = document.createElement('input'); input.value = location.href; input.readOnly = true; input.setAttribute('aria-label', '복사할 급여명세서 링크');
      $('action-status').append('공유 링크를 직접 복사해주세요.', input); input.focus(); input.select();
    }
  });

  $('save').disabled = true; $('share').disabled = true;
  const params = new URLSearchParams(location.search), name = params.get('name');
  if (name) { $('nickname').value = name.slice(0, 100); if ([10, 20, 30].includes(Number(params.get('count')))) $('count').value = params.get('count'); issue(); }
})();
