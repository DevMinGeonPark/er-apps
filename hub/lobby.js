(function () {
  'use strict';

  const root = document.getElementById('lam');
  const q = selector => root.querySelector(selector);
  const documents = globalThis.LumiaDocuments;
  const context = globalThis.LumiaContext;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const activeAnimations = new Set();
  const defaultState = { version: 1, view: 'home', selected: null, category: '전체', query: '', page: 0, depth: 0, focus: null };
  let state;
  let dialogueTimer;
  let navigationPending = false;

  function normalizeState(value) {
    const result = { ...defaultState, ...(value?.version === 1 ? value : {}) };
    if (!['home', 'catalog', 'detail'].includes(result.view)) result.view = 'home';
    if (!documents.some(item => item.id === result.selected)) {
      result.selected = null;
      if (result.view === 'detail') result.view = 'home';
    }
    if (result.category !== '전체' && !documents.some(item => item.category === result.category)) result.category = '전체';
    result.query = typeof result.query === 'string' ? result.query : '';
    result.page = Number.isFinite(result.page) ? Math.max(0, Math.floor(result.page)) : 0;
    result.depth = Number.isFinite(result.depth) ? Math.max(0, Math.floor(result.depth)) : 0;
    return result;
  }

  function saveHistory(push = false) {
    const record = { ...history.state, lumiaLobby: { ...state } };
    try { history[push ? 'pushState' : 'replaceState'](record, '', location.href); }
    catch (_) { /* Restricted history still leaves in-page navigation usable. */ }
  }

  function cancelAnimations() {
    activeAnimations.forEach(animation => animation.cancel());
    activeAnimations.clear();
  }

  function animate(element, frames, options = {}) {
    if (reduced.matches || !element.animate) return;
    const animation = element.animate(frames, {
      duration: 320, easing: 'cubic-bezier(.22,.7,.2,1)', ...options,
    });
    activeAnimations.add(animation);
    animation.finished.then(() => activeAnimations.delete(animation), () => activeAnimations.delete(animation));
  }

  function say(text, aside) {
    clearTimeout(dialogueTimer);
    q('#am-aside').textContent = aside;
    q('#am-dialogue-live').textContent = text;
    if (reduced.matches) { q('#am-quote').textContent = text; return; }
    const chars = Array.from(text);
    let position = 0;
    q('#am-quote').textContent = '';
    function tick() {
      position = Math.min(chars.length, position + 2);
      q('#am-quote').textContent = chars.slice(0, position).join('');
      if (position < chars.length) dialogueTimer = setTimeout(tick, 25);
    }
    tick();
  }

  function focusToken(element) {
    if (element?.dataset.document) return { document: element.dataset.document };
    return element?.id ? { id: element.id } : null;
  }

  function moveFocus(token, fallback) {
    const panel = q('#am-' + state.view);
    const target = token?.document
      ? [...panel.querySelectorAll('[data-document]')].find(element => element.dataset.document === token.document)
      : token?.id ? document.getElementById(token.id) : null;
    const element = target && panel.contains(target) && !target.disabled ? target : fallback;
    element?.focus({ preventScroll: true });
    // Keep a strip of the character visible when a long mobile lobby opens a form.
    if (matchMedia('(max-width: 720px)').matches && state.view !== 'home') {
      const top = Math.max(0, scrollY + q('.am-panel').getBoundingClientRect().top - 170);
      if (element && (element.getBoundingClientRect().top > innerHeight - 80 || element.getBoundingClientRect().top < 0)) {
        scrollTo({ top, behavior: reduced.matches ? 'instant' : 'smooth' });
      }
    }
  }

  function makeRow(item, catalog = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'am-row';
    button.dataset.document = item.id;
    const number = document.createElement('span');
    number.className = 'am-num';
    number.textContent = String(documents.findIndex(doc => doc.id === item.id) + 1).padStart(2, '0');
    number.setAttribute('aria-hidden', 'true');
    const content = document.createElement('span');
    const title = document.createElement('strong');
    title.textContent = item.name;
    content.append(title);
    if (catalog || item.status !== 'active') {
      const detail = document.createElement('small');
      detail.textContent = item.status === 'active' ? item.short : (item.disabledReason || '현재 접수할 수 없는 문서입니다.');
      if (item.status !== 'active') detail.className = 'am-unavailable';
      content.append(detail);
    }
    const arrow = document.createElement('span');
    arrow.className = 'am-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '↗';
    button.append(number, content, arrow);
    button.disabled = item.status !== 'active';
    button.addEventListener('click', () => choose(item.id, button));
    return button;
  }

  function renderRecent() {
    const featured = documents.filter(item => item.featured && item.status === 'active');
    q('#am-featured').hidden = !featured.length;
    q('#am-featured').replaceChildren(...featured.map(item => {
      const row = makeRow(item, true);
      row.querySelector('.am-num').textContent = 'NEW';
      return row;
    }));
    const recent = context.getRecent();
    const ids = recent.length ? recent : ['autopsy', 'liability', 'payroll'].filter(id => documents.some(item => item.id === id));
    q('#am-recent-label').textContent = recent.length ? '최근 선택한 서류' : '바로 찾기';
    q('#am-home-note').textContent = recent.length ? '최근 선택한 문서 최대 3개를 이 브라우저에 기억합니다.' : '문서를 선택하면 이곳에 최근 목록이 남습니다.';
    q('#am-total').textContent = documents.length + '종';
    q('#am-recent').replaceChildren(...ids.slice(0, 3).map(id => makeRow(documents.find(item => item.id === id))));
  }

  function renderFilters() {
    const categories = ['전체', ...new Set(documents.map(item => item.category))];
    const existing = [...q('#am-filters').children].map(button => button.dataset.category);
    if (JSON.stringify(existing) !== JSON.stringify(categories)) {
      q('#am-filters').replaceChildren(...categories.map(category => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'am-filter';
        button.dataset.category = category;
        button.textContent = category;
        button.addEventListener('click', () => {
          state.category = category;
          state.page = 0;
          renderCatalog(true);
          saveHistory();
        });
        return button;
      }));
    }
    [...q('#am-filters').children].forEach(button => button.setAttribute('aria-pressed', String(button.dataset.category === state.category)));
  }

  function renderCatalog(motion = false) {
    if (state.category !== '전체' && !documents.some(item => item.category === state.category)) state.category = '전체';
    const result = globalThis.LumiaCatalog.selectPage(documents, state.category, state.query, state.page);
    state.page = result.page;
    renderFilters();
    q('#am-query').value = state.query;
    q('#am-results').replaceChildren(...result.items.map(item => makeRow(item, true)));
    q('#am-empty').hidden = result.count !== 0;
    q('#am-result-count').textContent = result.count + '개 문서';
    q('#am-page-number').textContent = (result.page + 1) + ' / ' + result.pages;
    q('#am-prev').disabled = result.page === 0;
    q('#am-next').disabled = result.page === result.pages - 1;
    q('#am-page-buttons').hidden = result.pages <= 1;
    q('#am-clear').hidden = !state.query;
    if (motion) q('#am-results').querySelectorAll('.am-row').forEach((row, index) => animate(row,
      [{ transform: 'translateX(12px)', opacity: 0.1 }, { transform: 'translateX(0)', opacity: 1 }],
      { delay: index * 28, duration: 240 }));
  }

  function renderDetail() {
    const item = documents.find(doc => doc.id === state.selected);
    q('#am-kind').textContent = item.category;
    q('#am-document-title').textContent = item.name;
    q('#am-description').textContent = item.description;
    q('#am-target').textContent = item.target;
    q('#am-form-hint').textContent = item.inputHint || '접수대에서 필요한 정보를 입력한 뒤 신청합니다.';
    q('#am-nickname').value = context.getNickname();
    q('#am-nickname').removeAttribute('aria-invalid');
    q('#am-error').hidden = item.status === 'active';
    q('#am-error').textContent = item.status === 'active' ? '' : (item.disabledReason || '현재 접수할 수 없는 문서입니다.');
    q('#am-submit').disabled = item.status !== 'active';
    q('#am-submit-label').textContent = item.id === 'playstyle' ? '유형 검사 열기' : '접수대 열기';
    q('#am-form').removeAttribute('aria-busy');
  }

  function render({ focus = true, restore = false, motion = true } = {}) {
    cancelAnimations();
    navigationPending = false;
    root.dataset.view = state.view;
    ['home', 'catalog', 'detail'].forEach(view => { q('#am-' + view).hidden = view !== state.view; });
    q('#am-open').setAttribute('aria-expanded', String(state.view === 'catalog'));
    if (state.view === 'home') {
      renderRecent();
      say('하… 또 왔네.\n이번엔 무슨 서류인데?', '필요한 것만 골라. 오래 걸리니까.');
    } else if (state.view === 'catalog') {
      renderCatalog(motion);
      say('…그거 말고?\n목록 줄 테니까 직접 찾아.', '고르면 말해.');
    } else {
      renderDetail();
      const item = documents.find(doc => doc.id === state.selected);
      say(item.dialogue.quote, item.dialogue.aside);
    }
    document.title = (state.view === 'detail' ? documents.find(item => item.id === state.selected).name : state.view === 'catalog' ? '전체 서류' : '야간 접수') + ' — 루미아 문서국';
    if (motion) animate(q('#am-' + state.view), [{ transform: 'translateX(18px)', opacity: 0.1 }, { transform: 'translateX(0)', opacity: 1 }]);
    if (focus) moveFocus(restore ? state.focus : null, q(state.view === 'detail' ? '#am-document-title' : state.view === 'catalog' ? '#am-query' : '#am-open'));
  }

  function navigate(view, trigger, selected = null) {
    state.focus = focusToken(trigger);
    saveHistory();
    state = { ...state, view, selected, depth: state.depth + 1, focus: null };
    saveHistory(true);
    render();
  }

  function choose(id, trigger) {
    const item = documents.find(doc => doc.id === id);
    if (!item || item.status !== 'active') return;
    context.remember(id);
    navigate('detail', trigger, id);
  }

  function back() {
    if (navigationPending) return;
    if (state.depth > 0 && history.state?.lumiaLobby) {
      navigationPending = true;
      history.back();
    } else {
      state = { ...state, view: 'home', selected: null, depth: 0 };
      saveHistory();
      render();
    }
  }

  q('#am-open').addEventListener('click', event => navigate('catalog', event.currentTarget));
  q('#am-catalog-back').addEventListener('click', back);
  q('#am-detail-back').addEventListener('click', back);
  q('#am-query').addEventListener('input', event => {
    state.query = event.target.value;
    state.page = 0;
    renderCatalog();
    saveHistory();
  });
  q('#am-clear').addEventListener('click', () => {
    state.query = '';
    state.page = 0;
    renderCatalog(true);
    saveHistory();
    q('#am-query').focus({ preventScroll: true });
  });
  ['prev', 'next'].forEach(direction => q('#am-' + direction).addEventListener('click', () => {
    state.page += direction === 'prev' ? -1 : 1;
    renderCatalog(true);
    saveHistory();
    // The clicked page control can become disabled on a boundary page.
    moveFocus(null, q('#am-results .am-row') || q('#am-catalog-title'));
  }));
  q('#am-nickname').addEventListener('input', event => {
    context.setNickname(event.target.value);
    q('#am-error').hidden = true;
    event.target.removeAttribute('aria-invalid');
  });
  q('#am-form').addEventListener('submit', event => {
    event.preventDefault();
    if (navigationPending) return;
    const item = documents.find(doc => doc.id === state.selected);
    if (!item || item.status !== 'active') return;
    const nickname = q('#am-nickname').value.trim();
    if (nickname.length > 100) {
      q('#am-error').textContent = '닉네임은 100자 이내로 입력해주세요.';
      q('#am-error').hidden = false;
      q('#am-nickname').setAttribute('aria-invalid', 'true');
      q('#am-nickname').focus();
      return;
    }
    const destination = new URL(item.href, location.origin);
    if (destination.origin !== location.origin) return;
    context.setNickname(nickname);
    context.remember(item.id);
    state.focus = { id: 'am-submit' };
    saveHistory();
    navigationPending = true;
    q('#am-submit').disabled = true;
    q('#am-submit-label').textContent = '접수대 여는 중';
    q('#am-form').setAttribute('aria-busy', 'true');
    location.assign(destination.href);
  });
  root.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.isComposing || state.view === 'home') return;
    event.preventDefault();
    back();
  });
  addEventListener('popstate', event => {
    state = normalizeState(event.state?.lumiaLobby);
    render({ restore: true });
    saveHistory();
  });
  addEventListener('pageshow', event => {
    if (!event.persisted) return;
    context.refresh();
    state = normalizeState(history.state?.lumiaLobby);
    render({ restore: true, motion: false });
  });
  addEventListener('pagehide', () => { clearTimeout(dialogueTimer); cancelAnimations(); });
  addEventListener('lumia:documentschange', () => {
    state = normalizeState(state);
    render({ focus: false, motion: false });
    saveHistory();
  });
  reduced.addEventListener('change', () => {
    if (!reduced.matches) return;
    clearTimeout(dialogueTimer);
    q('#am-quote').textContent = q('#am-dialogue-live').textContent;
    cancelAnimations();
    scrollTo({ top: scrollY, behavior: 'instant' });
  });

  state = normalizeState(history.state?.lumiaLobby);
  saveHistory();
  render({ focus: false, motion: false });
})();
