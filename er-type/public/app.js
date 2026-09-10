/* Twelve local choices. Shared results never replace personal quiz progress. */
(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const model = globalThis.LumiaType;
  const STORAGE_KEY = 'lumia.type.v1';
  const VERSION = 1;
  const COUNT = 12;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const setText = (selector, value) => { $(selector).textContent = value ?? ''; };
  const say = message => setText('#type-status', message);
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const emptyProgress = () => ({ version: VERSION, answers: Array(COUNT).fill(null), index: 0, completed: false });
  let progress = emptyProgress();
  let currentProfile = null;
  let currentSource = null;
  let currentScored = null;
  let cardRevision = 0;
  let stage = 'intro';
  let exporting = false;

  globalThis.LumiaClerk?.bindNickname($('#type-nickname'));
  if (!model || !Array.isArray(model.questions) || model.questions.length !== COUNT) {
    $('#type-start').disabled = true;
    say('검사 문항을 불러오지 못했습니다. 페이지를 새로고침해 주세요.');
    return;
  }

  function readProgress() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (!saved || saved.version !== VERSION || !Array.isArray(saved.answers) || saved.answers.length !== COUNT
        || !saved.answers.every(answer => answer === null || answer === 0 || answer === 1)
        || !Number.isInteger(saved.index) || saved.index < 0 || saved.index >= COUNT || typeof saved.completed !== 'boolean') return;
      progress = { version: VERSION, answers: [...saved.answers], index: saved.index, completed: saved.completed && saved.answers.every(answer => answer !== null) };
    } catch { /* Storage may be denied or contain an older, damaged record. */ }
  }
  function saveProgress() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(progress)); }
    catch {
      $('#type-storage-note').hidden = false;
      setText('#type-storage-note', '현재 브라우저에서는 진행 상황을 저장할 수 없습니다. 이 페이지를 열어 둔 동안에는 계속 검사할 수 있습니다.');
    }
  }
  function focusHeading(selector) {
    const target = $(selector);
    target.focus({ preventScroll: true });
    target.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
  }
  function setStage(next) {
    stage = next;
    document.body.dataset.typeStage = next;
    $('#type-intro').hidden = next !== 'intro';
    $('#type-quiz').hidden = next !== 'question';
    $('#type-result').hidden = next !== 'result';
    $('#type-catalog').hidden = next === 'question';
    if (next !== 'result') { cardRevision++; document.querySelector('.type-print-sheet')?.remove(); delete document.body.dataset.typePrint; }
    globalThis.LumiaClerk?.setState(next === 'result' ? 'result' : 'intake', next === 'question' ? '문항 응답 중' : undefined);
  }
  function clearSharedHash() {
    if (location.hash) history.replaceState(history.state, '', location.pathname + location.search);
  }
  function showIntro(message = '', focus = true) {
    setStage('intro');
    const answered = progress.answers.filter(answer => answer !== null).length;
    const label = progress.completed ? '내 검사 결과 다시 보기' : answered ? '이어서 검사하기' : '내 플레이 성향 알아보기';
    $('#type-start').innerHTML = `${label} <span aria-hidden="true">↗</span>`;
    $('#type-resume-note').hidden = answered === 0;
    $('#type-reset-progress').hidden = answered === 0;
    setText('#type-resume-note', progress.completed ? '이 브라우저에 내 검사 결과가 남아 있습니다.' : `${COUNT}문항 중 ${answered}문항에 답했습니다. 마지막으로 보던 질문에서 이어집니다.`);
    say(message);
    if (focus) focusHeading('#type-intro-title');
  }
  function renderQuestion(focus = true) {
    const question = model.questions[progress.index];
    setStage('question');
    setText('#type-progress', `질문 ${progress.index + 1} / ${COUNT}`);
    $('#type-progress-bar').value = progress.answers.filter(answer => answer !== null).length;
    setText('#type-question-title', question.prompt);
    $('#type-question-context').hidden = !question.context;
    setText('#type-question-context', question.context);
    $('#type-choices').innerHTML = question.choices.map((choice, index) => `<label class="type-choice" for="type-answer-${index}"><input id="type-answer-${index}" name="type-answer" type="radio" value="${index}"${progress.answers[progress.index] === index ? ' checked' : ''}><span>${esc(choice.text)}</span></label>`).join('');
    $('#type-prev').disabled = progress.index === 0;
    $('#type-next').disabled = progress.answers[progress.index] === null;
    $('#type-next').innerHTML = progress.index === COUNT - 1 ? '내 유형 확인하기 <span aria-hidden="true">↗</span>' : '다음 질문 <span aria-hidden="true">→</span>';
    setText('#type-answer-note', progress.answers[progress.index] === null ? '더 가까운 답을 하나 고르면 다음으로 넘어갈 수 있습니다.' : '선택한 답변은 이전 질문으로 돌아가 바꿀 수 있습니다.');
    say('');
    if (focus) focusHeading('#type-question-title');
  }
  function startPersonal() {
    clearSharedHash();
    if (progress.completed) {
      const result = model.score(progress.answers);
      if (result) { showResult(result.code, 'own', result); return; }
    }
    renderQuestion();
  }
  function resultLink(code) {
    const url = new URL('/type/', location.origin);
    url.hash = 'type=' + code;
    return url.href;
  }
  function typeNumber(code) {
    return String(model.types.findIndex(type => type.code === code) + 1).padStart(2, '0') + ' / ' + model.types.length;
  }
  function showResult(code, source, scored = null) {
    const profile = model.getType(code);
    if (!profile) { showIntro('유형을 확인할 수 없습니다. 아래에서 내 검사를 시작해 주세요.'); return; }
    currentProfile = profile;
    currentSource = source;
    currentScored = source === 'own' ? scored : null;
    setStage('result');
    $('#type-profile').dataset.code = code;
    setText('#type-code', typeNumber(code));
    setText('#type-result-source', source === 'own' ? '12개의 선택으로 읽은 나의 플레이' : source === 'shared' ? '친구가 공유한 플레이 유형' : '플레이 유형 미리 보기');
    setText('#type-person-name', source === 'own' ? ($('#type-nickname').value.trim() || '이름 없는 실험체') + '의 관찰 기록' : source === 'shared' ? '공유된 유형 · 문항별 답변은 포함되지 않았습니다.' : '유형 소개 · 내 검사 결과와는 별개입니다.');
    setText('#type-result-title', profile.name);
    setText('#type-tagline', profile.tagline);
    setText('#type-description', profile.description);
    $('#type-portrait').src = `/type/art/${code}.png`;
    $('#type-portrait').alt = profile.name + '의 플레이 모습을 그린 귀여운 만화 캐릭터';
    setText('#type-self-view', profile.selfView);
    setText('#type-team-view', profile.teamView);
    setText('#type-tip', profile.tip);
    $('#type-strengths').innerHTML = profile.strengths.map(item => `<li>${esc(item)}</li>`).join('');
    $('#type-pitfalls').innerHTML = profile.pitfalls.map(item => `<li>${esc(item)}</li>`).join('');
    $('#type-axis-list').innerHTML = model.axes.map((axis, index) => {
      const counted = source === 'own' ? scored?.axes[index] : null;
      const pole = counted ? counted.pole : Number(code[index]);
      const counts = counted?.counts;
      const caption = axis.descriptions?.[pole] || axis.poles[pole];
      const total = counts ? counts[0] + counts[1] : 0;
      const share = counts ? counts[pole] / total * 100 : null;
      const graphLabel = counts ? `${axis.poles[0]} ${counts[0]}회, ${axis.poles[1]} ${counts[1]}회` : `${axis.poles[pole]} 성향. 문항별 응답 비율은 공유되지 않았습니다.`;
      const arc = counts ? `<circle class="type-axis-value" cx="60" cy="60" r="49" pathLength="100" stroke-dasharray="${share} 100" transform="rotate(-90 60 60)"></circle>` : '';
      const legend = axis.poles.map((name, side) => `<span><i class="type-axis-key${side === pole ? ' is-dominant' : ''}" aria-hidden="true"></i>${esc(name)}${counts ? ` ${counts[side]}회` : ''}</span>`).join('');
      return `<div class="type-axis"${counts ? ` data-count-left="${counts[0]}" data-count-right="${counts[1]}"` : ''}><div class="type-axis-heading">${esc(axis.title || axis.poles.join(' · '))}</div><div class="type-axis-chart${counts ? '' : ' is-unmeasured'}" role="img" aria-label="${esc(graphLabel)}"><svg viewBox="0 0 120 120" aria-hidden="true" focusable="false"><circle class="type-axis-track" cx="60" cy="60" r="49"></circle>${arc}</svg><div class="type-axis-center" aria-hidden="true"><strong>${esc(axis.poles[pole])}</strong><small>${counts ? `${counts[pole]} / ${total} 선택` : '유형 성향'}</small></div></div><div class="type-axis-detail">${legend}</div><p class="type-axis-caption">${esc(caption)}</p></div>`;
    }).join('');
    $('#type-compatibility-list').innerHTML = [['best', '호흡을 맞추기 쉬운 유형'], ['spicy', '한 번 더 대화하면 좋은 유형']].map(([key, label]) => {
      const partner = model.getType(profile[key]);
      return partner ? `<div><span class="type-pair-label">${label}</span><button type="button" class="type-pair-button" data-type="${esc(partner.code)}">${esc(partner.name)} <span aria-hidden="true">↗</span></button><p class="type-pair-note">${esc(partner.tagline)}</p></div>` : '';
    }).join('');
    $('#type-team-result').hidden = true;
    $('#type-team-result').replaceChildren();
    $('#type-share-fallback').hidden = true;
    $('#type-share-link').value = resultLink(code);
    $('#type-personal').hidden = source === 'own';
    $('#type-team-submit').disabled = !$('#type-friend-one').value;
    say(source === 'own' ? '12문항을 모두 확인했습니다. 결과를 읽어 보세요.' : '공유된 유형과 내 검사 기록은 별도로 유지됩니다.');
    focusHeading('#type-result-title');
    prepareCards();
  }

  function resultNickname() { return currentSource === 'own' ? $('#type-nickname').value.trim() : ''; }
  function prepareCards() {
    const revision = ++cardRevision;
    const profile = currentProfile;
    const nickname = resultNickname();
    const scored = currentScored;
    $('#type-share').disabled = true;
    $('#type-pdf').disabled = true;
    setText('#type-share', '카드 준비 중…');
    document.querySelector('.type-print-sheet')?.remove();
    delete document.body.dataset.typePrint;
    globalThis.LumiaTypeShare?.prepare(profile, nickname, scored).then(() => {
      if (revision !== cardRevision) return;
      $('#type-share').disabled = false;
      setText('#type-share', '카드 공유하기');
    });
    globalThis.LumiaTypeExport.render(profile, nickname, scored).then(async canvas => {
      const img = new Image();
      img.className = 'type-print-image';
      img.alt = profile.name + ' 결과 카드 — 유형 그림과 네 가지 성향 그래프';
      img.src = canvas.toDataURL('image/png');
      await img.decode();
      if (revision !== cardRevision) return;
      const sheet = document.createElement('div');
      sheet.className = 'type-print-sheet';
      sheet.append(img);
      document.body.append(sheet);
      $('#type-pdf').disabled = false;
    }).catch(() => {
      if (revision !== cardRevision) return;
      $('#type-pdf').disabled = false;
    });
  }

  function readHash(focus = true) {
    if (!location.hash) { showIntro('', focus); return; }
    const parameters = new URLSearchParams(location.hash.slice(1));
    const code = parameters.get('type');
    if (/^[01]{4}$/.test(code || '') && model.getType(code)) showResult(code, 'shared');
    else showIntro('공유 링크의 유형을 확인할 수 없습니다. 아래에서 내 검사를 시작하거나 저장된 검사를 이어갈 수 있습니다.', focus);
  }
  function buildTypeLists() {
    const options = model.types.map(type => `<option value="${esc(type.code)}">${esc(type.name)}</option>`).join('');
    $('#type-friend-one').innerHTML = '<option value="">유형 선택</option>' + options;
    $('#type-friend-two').innerHTML = '<option value="">둘이서 볼게요</option>' + options;
    $('#type-catalog-list').innerHTML = model.types.map(type => `<button type="button" class="type-catalog-item" data-type="${esc(type.code)}"><img class="type-catalog-thumb" src="/type/art/${type.code}.png" alt="" width="52" height="52" loading="lazy"><span>${esc(type.name)}</span><small>${esc(typeNumber(type.code).split(' / ')[0])}</small></button>`).join('');
  }
  function previewType(event) {
    const button = event.target.closest('button[data-type]');
    if (!button) return;
    clearSharedHash();
    showResult(button.dataset.type, 'catalog');
  }

  $('#type-start').addEventListener('click', startPersonal);
  $('#type-pause').addEventListener('click', () => { saveProgress(); showIntro('진행 상황을 남겨 두었습니다. 준비되면 이어서 검사하세요.'); });
  $('#type-choices').addEventListener('change', event => {
    if (event.target.name !== 'type-answer') return;
    progress.answers[progress.index] = Number(event.target.value);
    progress.completed = false;
    $('#type-next').disabled = false;
    $('#type-progress-bar').value = progress.answers.filter(answer => answer !== null).length;
    setText('#type-answer-note', '선택한 답변은 이전 질문으로 돌아가 바꿀 수 있습니다.');
    saveProgress();
  });
  $('#type-prev').addEventListener('click', () => {
    if (progress.index === 0) return;
    progress.index--;
    saveProgress();
    renderQuestion();
  });
  $('#type-quiz').addEventListener('submit', event => {
    event.preventDefault();
    if (progress.answers[progress.index] === null) return;
    if (progress.index < COUNT - 1) {
      progress.index++;
      saveProgress();
      renderQuestion();
      return;
    }
    const scored = model.score(progress.answers);
    if (!scored) {
      progress.index = Math.max(0, progress.answers.indexOf(null));
      renderQuestion();
      say('아직 답하지 않은 질문이 있습니다. 한 가지를 선택해 주세요.');
      return;
    }
    progress.completed = true;
    saveProgress();
    globalThis.LumiaContext?.remember('playstyle');
    showResult(scored.code, 'own', scored);
  });
  function restartPersonal() {
    clearSharedHash();
    progress = emptyProgress();
    saveProgress();
    renderQuestion();
  }
  $('#type-restart').addEventListener('click', restartPersonal);
  $('#type-reset-progress').addEventListener('click', restartPersonal);
  $('#type-personal').addEventListener('click', () => { clearSharedHash(); showIntro(); });
  $('#type-catalog-list').addEventListener('click', previewType);
  $('#type-compatibility-list').addEventListener('click', previewType);
  $('#type-friend-one').addEventListener('change', () => {
    $('#type-friend-one').removeAttribute('aria-invalid');
    $('#type-friend-error').hidden = true;
    $('#type-team-submit').disabled = !$('#type-friend-one').value;
    $('#type-team-result').hidden = true;
  });
  $('#type-friend-two').addEventListener('change', () => { $('#type-team-result').hidden = true; });
  $('#type-team-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!currentProfile) return;
    const first = $('#type-friend-one').value;
    if (!model.getType(first)) {
      $('#type-friend-one').setAttribute('aria-invalid', 'true');
      $('#type-friend-error').hidden = false;
      setText('#type-friend-error', '팀원 1의 유형을 선택해 주세요.');
      $('#type-friend-one').focus();
      return;
    }
    const codes = [currentProfile.code, first];
    if ($('#type-friend-two').value) codes.push($('#type-friend-two').value);
    const manual = model.teamManual(codes);
    if (!manual) { say('선택한 팀 유형을 확인하지 못했습니다. 다시 선택해 주세요.'); return; }
    $('#type-team-result').innerHTML = `<h4>${esc(manual.headline)}</h4><p>${esc(manual.summary)}</p>${manual.roles.map((role, index) => `<section class="type-team-role"><h5>${index === 0 ? (currentSource === 'own' ? '나' : '기준 유형') : '팀원 ' + index} · ${esc(role.name)}</h5><p>${esc(role.role)}</p><small>${esc(role.tip)}</small></section>`).join('')}<ol class="type-team-agreements">${manual.agreements.map(agreement => `<li>${esc(agreement)}</li>`).join('')}</ol><p class="type-team-warning">${esc(manual.warning)}</p>`;
    $('#type-team-result').hidden = false;
    say(`${codes.length}명의 팀 사용 설명서를 만들었습니다.`);
    focusHeading('#type-team-result');
  });
  $('#type-copy').addEventListener('click', async () => {
    if (!currentProfile) return;
    const link = resultLink(currentProfile.code);
    $('#type-share-link').value = link;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(link);
      $('#type-share-fallback').hidden = true;
      say('유형 링크를 복사했습니다. 닉네임과 문항별 답변은 포함되지 않습니다.');
    } catch {
      $('#type-share-fallback').hidden = false;
      $('#type-share-link').focus();
      $('#type-share-link').select();
      say('자동 복사를 사용할 수 없습니다. 아래 링크를 직접 복사해 주세요.');
    }
  });
  $('#type-png').addEventListener('click', async () => {
    if (!currentProfile || exporting) return;
    const profile = currentProfile;
    const nickname = currentSource === 'own' ? $('#type-nickname').value.trim() : '';
    exporting = true;
    $('#type-png').disabled = true;
    setText('#type-png', '결과 카드 저장 중…');
    try {
      if (!globalThis.LumiaTypeExport?.save) throw new Error('이미지 저장 기능을 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.');
      await globalThis.LumiaTypeExport.save(profile, nickname, currentScored);
      say('결과 카드를 PNG로 저장했습니다.');
    } catch (error) { say(error.message || '이미지를 저장하지 못했습니다. 다시 시도해 주세요.'); }
    finally { exporting = false; $('#type-png').disabled = false; setText('#type-png', '결과 카드 PNG 저장'); }
  });
  $('#type-share').addEventListener('click', async () => {
    if (!currentProfile) return;
    const revision = cardRevision;
    const result = await globalThis.LumiaTypeShare.share(currentProfile, resultNickname(), currentScored);
    if (revision !== cardRevision) return;
    if (result.status === 'shared') say(result.mode === 'file' ? '공유창을 열었습니다. 카카오톡 등 원하는 앱을 선택하세요.' : '유형 링크 공유창을 열었습니다.');
    else if (result.status === 'cancelled') say('공유를 취소했습니다. 결과 카드는 그대로 있어요.');
    else {
      $('#type-share-fallback').hidden = false;
      $('#type-share-link').value = resultLink(currentProfile.code);
      $('#type-share-link').focus();
      $('#type-share-link').select();
      say('이 환경에서는 공유창을 열 수 없어요. PNG를 저장해 카카오톡에 첨부하거나 아래 링크를 복사해 주세요.');
    }
  });
  $('#type-pdf').addEventListener('click', () => {
    if (!document.querySelector('.type-print-image')) {
      prepareCards();
      say('유형 그림과 PDF 카드를 다시 준비하고 있어요. 잠시 뒤 PDF로 저장을 눌러주세요.');
      return;
    }
    document.body.dataset.typePrint = 'card';
    say('인쇄 창의 저장 대상에서 PDF로 저장을 선택하세요.');
    window.print();
  });
  window.addEventListener('beforeprint', () => {
    if (stage === 'result' && document.querySelector('.type-print-image')) document.body.dataset.typePrint = 'card';
  });
  window.addEventListener('afterprint', () => { delete document.body.dataset.typePrint; });
  document.addEventListener('lumia:cancel', event => {
    if (!event.cancelable) return;
    event.preventDefault();
    if (stage === 'question') saveProgress();
    clearSharedHash();
    showIntro();
  });
  window.addEventListener('hashchange', () => readHash());
  readProgress();
  buildTypeLists();
  readHash(false);
})();
