// RP는 공식 기록 그대로 정산한다. 처치·어시스트 등에 임의의 RP를 붙이지 않는다.
(function (global) {
  const number = value => typeof value === 'number' && Number.isFinite(value);
  const signed = value => (value > 0 ? '+' : value < 0 ? '−' : '') + Math.abs(value).toLocaleString('ko-KR', { maximumFractionDigits: 1 });

  function settlement(match) {
    let net = number(match.mmrGain) ? match.mmrGain : null;
    if (net === null && number(match.mmrBefore) && number(match.mmrAfter)) net = match.mmrAfter - match.mmrBefore;
    const gross = number(match.mmrGainInGame) ? match.mmrGainInGame : null;
    // 공식 mmrLossEntryCost는 이미 부호가 있는 값이다. 다시 음수로 바꾸지 않는다.
    const entry = number(match.mmrLossEntryCost) ? match.mmrLossEntryCost : null;
    if (net === null && gross !== null && entry !== null) net = gross + entry;
    return { net, gross, entry, adjustment: net !== null && gross !== null && entry !== null ? net - gross - entry : null };
  }

  function calculate(matches, count = 20) {
    if (![10, 20, 30].includes(count)) throw new Error('정산할 경기 수를 확인해주세요.');
    const unique = [...new Map(matches.map(m => [String(m.gameId), m])).values()];
    const ranked = unique.filter(m => m.matchingMode === 3).sort((a, b) => Date.parse(b.startDtm) - Date.parse(a.startDtm));
    const selected = ranked.slice(0, count);
    if (!selected.length) throw new Error('조회한 최근 100경기 안에 랭크 근무 기록이 없습니다. 일반전은 RP 급여에서 제외됩니다.');
    const rows = selected.map(match => ({ ...match, ...settlement(match) }));
    const missing = rows.filter(m => m.net === null).length;
    const complete = missing === 0;
    const breakdownComplete = rows.every(m => m.gross !== null && m.entry !== null && m.adjustment !== null);
    const sum = field => rows.reduce((total, m) => total + m[field], 0);
    const seconds = rows.every(m => number(m.playTime) && m.playTime > 0) ? sum('playTime') : null;
    const net = complete ? sum('net') : null;
    const hourly = net !== null && seconds !== null ? Math.round(net / seconds * 3600 * 10) / 10 : null;
    const best = [...rows].filter(m => m.net !== null).sort((a, b) => b.net - a.net)[0];
    return { nickname: rows[0].nickname, count: rows.length, requested: count, available: ranked.length,
      rows, missing, complete, breakdownComplete, net, seconds, hourly,
      gross: breakdownComplete ? sum('gross') : null, entry: breakdownComplete ? sum('entry') : null,
      adjustment: breakdownComplete ? sum('adjustment') : null,
      wins: rows.filter(m => m.gameRank === 1).length, best,
      start: rows.at(-1).startDtm, end: rows[0].startDtm,
      verdict: net === null ? '급여 자료 보완 요청' : net < 0 ? '귀하는 회사에 돈을 내고 일했습니다.' : net === 0 ? '열심히 일한 당신, 원점으로 돌아왔습니다.' : hourly >= 100 ? '우수 근로자. 퇴근은 다음 승리 후입니다.' : '흑자 근무 인정. 한 판만 더는 별도 심사입니다.',
      stamp: net === null ? '확인 필요' : net < 0 ? '열정 납부' : net === 0 ? '무급 봉사' : '급여 지급' };
  }

  function demo() {
    const earnings = [22, 91, 17, 55, 6, 38, 72, 19, 45, 14];
    return calculate(earnings.map((gross, i) => ({ gameId: `sample-${i}`, nickname: '루미아직장인', matchingMode: 3,
      startDtm: new Date(Date.UTC(2026, 8, 9, 13, 30 - i * 22)).toISOString(), playTime: 780 + i * 40,
      gameRank: [6, 1, 7, 3, 8, 5, 2, 7, 4, 8][i], playerKill: [2, 9, 1, 5, 0, 3, 7, 1, 4, 1][i],
      playerAssistant: 3, playerDeaths: 2, mmrGainInGame: gross, mmrLossEntryCost: -42, mmrGain: gross - 42 })), 10);
  }

  global.Payroll = { settlement, calculate, signed, demo };
})(typeof window !== 'undefined' ? window : globalThis);
