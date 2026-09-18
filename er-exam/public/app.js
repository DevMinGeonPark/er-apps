// 운영방법론 모의고사 화면. 채점 규칙은 exam-model.js에만 있다.
(() => {
  'use strict';
  const model = globalThis.LumiaExam;
  const q = selector => document.querySelector(selector);
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const WEIGHT_LABEL = { 1: '기본 지식', 2: '응용', 3: '상황 판단' };
  const domainTitle = id => model.domains.find(domain => domain.id === id).title;
  const total = model.questions.length;
  let answers = {};
  let current = 0;

  const sourceText = `${model.SOURCE.tier} · ${model.SOURCE.author}`;
  q('#exam-source').textContent = sourceText;
  q('#exam-source-foot').textContent = sourceText;
  q('#exam-nickname').value = globalThis.LumiaContext?.getNickname() || '';
  q('#exam-progress-bar').max = total;

  function show(stage, focus) {
    for (const id of ['intro', 'quiz', 'result']) q(`#exam-${id}`).hidden = id !== stage;
    document.body.dataset.examStage = stage;
    q(focus).focus({ preventScroll: true });
    scrollTo({ top: 0 });
  }

  function renderQuestion() {
    const question = model.questions[current];
    q('#exam-progress').textContent = `문항 ${current + 1} / ${total}`;
    q('#exam-meta').textContent = `${domainTitle(question.domain)} · ${WEIGHT_LABEL[question.weight]} ${question.weight}점`;
    q('#exam-progress-bar').value = Object.keys(answers).length;
    q('#exam-question-title').textContent = question.prompt;
    q('#exam-choices').replaceChildren(...question.choices.map((choice, index) => {
      const label = el('label', 'exam-choice');
      const input = el('input');
      input.type = 'radio'; input.name = 'exam-choice'; input.value = index;
      input.checked = answers[question.id] === index;
      input.addEventListener('change', () => { answers[question.id] = index; q('#exam-next').disabled = false; });
      label.append(input, el('span', '', choice.text));
      return label;
    }));
    q('#exam-prev').disabled = current === 0;
    q('#exam-next').disabled = answers[question.id] === undefined;
    q('#exam-next').firstChild.textContent = current === total - 1 ? '채점하기 ' : '다음 문항 ';
  }

  function renderResult() {
    const result = model.score(answers);
    const nickname = q('#exam-nickname').value.trim();
    q('#exam-person').textContent = nickname ? `응시자 ${nickname}` : '';
    q('#exam-result-title').textContent = result.label;
    q('#exam-result-title').style.setProperty('--tier', result.tier.color);
    q('#exam-score').textContent = `가중 득점 ${result.earned} / ${result.max}점 · ${result.percent}%`;
    q('#exam-comment').textContent = result.tier.comment;
    q('#exam-next-tier').textContent = result.next
      ? `${result.next.name}까지 ${Math.ceil((result.next.min / 100 * result.max - result.earned) * 2) / 2}점`
      : '이 시험의 최고 티어입니다. 그 위는 순위로 증명하세요.';
    q('#exam-ladder').replaceChildren(...model.tiers.map(tier => {
      const step = el('span', tier.id === result.tier.id ? 'is-current' : '', tier.name);
      step.style.setProperty('--tier', tier.color);
      return step;
    }));
    q('#exam-domains').replaceChildren(...result.domains.map(domain => {
      const row = el('div', 'exam-domain');
      const meter = el('meter'); meter.min = 0; meter.max = domain.max; meter.value = domain.earned;
      meter.setAttribute('aria-label', `${domain.title} ${domain.percent}%`);
      row.append(el('span', '', domain.title), meter, el('b', '', `${domain.earned}/${domain.max}`));
      return row;
    }));
    q('#exam-advice-title').textContent = result.percent === 100 ? '만점' : `먼저 볼 영역 · ${result.weakest.title}`;
    q('#exam-advice').textContent = result.percent === 100 ? '고칠 곳이 없습니다.' : result.weakest.advice;
    q('#exam-review').replaceChildren(...model.questions.map((question, index) => {
      const graded = result.review[index];
      const item = el('li', graded.credit === 1 ? 'is-right' : graded.credit ? 'is-partial' : 'is-wrong');
      const mark = graded.credit === 1 ? '정답' : graded.credit ? '부분 점수' : '오답';
      item.append(el('p', 'exam-review-head', `${mark} · ${domainTitle(question.domain)} · ${question.weight}점`), el('p', 'exam-review-prompt', question.prompt));
      if (graded.credit !== 1) item.append(el('p', 'exam-review-mine', `내 답: ${question.choices[graded.picked].text}`));
      item.append(el('p', 'exam-review-key', `정답: ${question.choices[graded.correct].text}`), el('blockquote', '', question.source));
      return item;
    }));
    q('#exam-status').textContent = '';
    q('#exam-copy').onclick = async () => {
      const text = `[운영방법론 모의고사] ${nickname ? nickname + ' · ' : ''}${result.label} (${result.percent}%)\n`
        + result.domains.map(domain => `${domain.title} ${domain.earned}/${domain.max}`).join(' · ')
        + `\n${location.origin}${location.pathname}`;
      try { await navigator.clipboard.writeText(text); q('#exam-status').textContent = '결과를 복사했습니다.'; }
      catch (_) { q('#exam-status').textContent = text; }
    };
  }

  q('#exam-start').addEventListener('click', () => {
    const nickname = q('#exam-nickname').value.trim();
    if (nickname) globalThis.LumiaContext?.setNickname(nickname);
    globalThis.LumiaContext?.remember('exam');
    answers = {}; current = 0;
    renderQuestion();
    show('quiz', '#exam-question-title');
  });
  q('#exam-prev').addEventListener('click', () => { current--; renderQuestion(); q('#exam-question-title').focus(); });
  q('#exam-quiz').addEventListener('submit', event => {
    event.preventDefault();
    if (answers[model.questions[current].id] === undefined) return;
    if (current < total - 1) { current++; renderQuestion(); q('#exam-question-title').focus(); return; }
    renderResult();
    show('result', '#exam-result-title');
  });
  q('#exam-restart').addEventListener('click', () => show('intro', '#exam-intro-title'));
})();
