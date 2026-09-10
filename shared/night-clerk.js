// Shared document desk. No requests are made by this shell.
(() => {
  const body = document.body;
  const doc = globalThis.LumiaDocuments?.find(item => item.id === body.dataset.lumiaDocument);
  if (!doc) return;
  const context = globalThis.LumiaContext;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const work = el('div', 'lc-work');
  for (const node of [...body.children]) {
    if (['SCRIPT', 'STYLE', 'LINK'].includes(node.tagName)) continue;
    if (node.tagName === 'HEADER') node.hidden = true;
    work.append(node);
  }
  const header = el('header', 'lc-header');
  const home = el('a', 'lc-brand', '루미아 문서국'); home.href = '/';
  home.append(el('small', '', 'LUMIA ARCHIVES'));
  const nav = el('nav', 'lc-nav'); nav.setAttribute('aria-label', '문서 이동');
  const back = el('a', 'lc-home', '문서국으로'); back.href = '/';
  const label = el('label', 'lc-sr', '문서 선택'); label.htmlFor = 'lc-document-select';
  const select = el('select'); select.id = 'lc-document-select';
  for (const item of globalThis.LumiaDocuments) {
    const option = el('option', '', item.name); option.value = item.id;
    option.disabled = item.status !== 'active'; option.selected = item.id === doc.id;
    select.append(option);
  }
  select.addEventListener('change', () => {
    const item = globalThis.LumiaDocuments.find(item => item.id === select.value);
    if (item?.status === 'active') location.assign(item.href);
  });
  nav.append(back, label, select); header.append(home, nav);
  const layout = el('div', 'lc-layout');
  const clerk = el('aside', 'lc-clerk'); clerk.setAttribute('aria-label', '야간 기록관');
  const art = el('img', 'lc-art'); art.src = '/assets/lumia-art.jpg'; art.alt = ''; art.setAttribute('fetchpriority', 'high');
  const dialogue = el('div', 'lc-dialogue');
  const quote = el('p', 'lc-quote'); quote.setAttribute('aria-hidden', 'true');
  const live = el('p', 'lc-sr'); live.setAttribute('aria-live', 'polite'); live.setAttribute('aria-atomic', 'true');
  const aside = el('p', 'lc-aside');
  dialogue.append(el('span', 'lc-speaker', '야간 기록관'), quote, aside, live); clerk.append(art, dialogue);
  const title = el('div', 'lc-title');
  const heading = el('h1', '', doc.name); heading.tabIndex = -1;
  title.append(el('p', 'lc-category', doc.category), heading);
  const stateLabel = el('p', 'lc-state'); stateLabel.setAttribute('role', 'status'); stateLabel.setAttribute('aria-atomic', 'true');
  title.append(stateLabel); work.prepend(title);
  layout.append(clerk, work); body.prepend(header, layout);
  const skip = el('a', 'lc-skip', '문서 접수대로 건너뛰기'); skip.href = '#lc-desk'; work.id = 'lc-desk'; work.tabIndex = -1; body.prepend(skip);
  let timer, phrase = '', state = '';
  const sayings = {
    intake: [doc.dialogue?.quote || '필요한 것만 적어.', doc.dialogue?.aside || '기록은 여기서 확인해.'],
    loading: ['…이름 확인했어.\n거기 앉아 있어.', '끝나면 부를게.'],
    result: ['다 됐어.\n두고 가지 말고.', '필요하면 문서를 저장해.'],
    error: ['기록이 안 와.\n잠깐 뒤에 다시 해.', '입력값은 그대로 뒀어.']
  };
  function say(next) {
    clearTimeout(timer); phrase = next[0]; live.textContent = phrase; aside.textContent = next[1];
    if (reduced.matches) { quote.textContent = phrase; return; }
    const chars = Array.from(phrase); let index = 0; quote.textContent = '';
    function tick() { index += 2; quote.textContent = chars.slice(0, index).join(''); if (index < chars.length) timer = setTimeout(tick, 25); }
    tick();
  }
  function setState(next, message) {
    if (!sayings[next]) return;
    const changed = state !== next;
    state = next; body.dataset.lumiaState = next;
    stateLabel.textContent = message || ({ intake: '접수', loading: '기록 확인 중', result: '문서 열람', error: '조회 안내' })[next];
    if (changed) say(sayings[next]);
  }
  const bound = new WeakSet();
  function bindNickname(input) {
    if (!input || bound.has(input)) return;
    bound.add(input);
    if (!input.value) input.value = context?.getNickname() || '';
    const save = () => context?.setNickname(input.value.trim());
    input.addEventListener('input', save); input.addEventListener('change', save);
    input.form?.addEventListener('submit', save, { capture: true });
  }
  reduced.addEventListener('change', () => { if (reduced.matches) { clearTimeout(timer); quote.textContent = phrase; document.getAnimations().forEach(animation => animation.cancel()); } });
  body.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !event.defaultPrevented && !event.target.closest('[role="dialog"], dialog')) {
      const cancellation = new CustomEvent('lumia:cancel', { cancelable: true });
      if (document.dispatchEvent(cancellation)) {
        setState('intake'); heading.focus({ preventScroll: true });
      }
    }
  });
  window.addEventListener('pagehide', () => { clearTimeout(timer); document.dispatchEvent(new CustomEvent('lumia:cancel')); });
  window.addEventListener('pageshow', event => {
    select.value = doc.id;
    if (event.persisted) {
      context?.refresh?.();
      clearTimeout(timer); quote.textContent = phrase;
    }
  });
  context?.remember(doc.id);
  globalThis.LumiaClerk = { setState, bindNickname };
  setState('intake');
})();
