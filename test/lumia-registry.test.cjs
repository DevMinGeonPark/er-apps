const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../shared/lumia-documents.js'), 'utf8');
const key = 'lumia.context.v1';
function storage(initial) {
  const values = new Map(initial ? [[key, initial]] : []);
  return { getItem: name => values.get(name) ?? null, setItem: (name, value) => values.set(name, value), removeItem: name => values.delete(name) };
}
function load(options = {}) {
  const listeners = {};
  const scope = { localStorage: storage(), sessionStorage: storage(), addEventListener: (event, listener) => { listeners[event] = listener; }, ...options };
  vm.runInNewContext(source, scope);
  return { ...scope, listeners };
}
const plain = value => JSON.parse(JSON.stringify(value));

test('six stable document routes retain their input contracts', () => {
  const { LumiaDocuments: docs } = load();
  assert.deepEqual(plain(docs.map(item => [item.id, item.href])), [
    ['license', '/cert/'], ['autopsy', '/death/'], ['liability', '/fault/'],
    ['tracking', '/enemy/'], ['credit', '/credit/'], ['payroll', '/payroll/'],
  ]);
  for (const item of docs) {
    assert.equal(item.status, 'active');
    assert.ok(item.inputSchema.length);
    assert.ok(item.dialogue.quote && item.dialogue.aside);
  }
  assert.deepEqual(plain(docs.find(item => item.id === 'license').inputSchema.map(field => field.name)), ['nickname', 'character', 'skin', 'style']);
  assert.deepEqual(plain(docs.find(item => item.id === 'liability').inputSchema.find(field => field.name === 'mode').options), ['all', 'squad', 'cobalt']);
  assert.deepEqual(plain(docs.find(item => item.id === 'payroll').inputSchema.find(field => field.name === 'count').options), [10, 20, 30]);
});

test('catalog scales through 6, 7, 30, 60, and 100 registrations and clamps deleted pages', () => {
  const { LumiaCatalog: catalog } = load();
  for (const count of [6, 7, 30, 60, 100]) {
    const items = Array.from({ length: count }, (_, index) => ({ id: 'document-' + index, name: '서류 ' + index, category: index % 2 ? '정산' : '경기 분석', short: '검색 가능', description: '경기 기록' }));
    const first = catalog.selectPage(items, '전체', '', 0);
    assert.equal(first.items.length, Math.min(count, 6));
    assert.equal(first.pages, Math.ceil(count / 6));
    assert.equal(first.count, count);
    const last = catalog.selectPage(items, '전체', '', 999);
    assert.equal(last.page, Math.ceil(count / 6) - 1);
    assert.equal(last.items.at(-1).id, 'document-' + (count - 1));
    const shrunk = catalog.selectPage(items.slice(0, 3), '전체', '', last.page);
    assert.equal(shrunk.page, 0);
    assert.equal(shrunk.items.length, 3);
  }
});

test('catalog searches whitespace-insensitively, combines categories, and handles an empty result', () => {
  const { LumiaCatalog: catalog, LumiaDocuments: docs } = load();
  assert.equal(catalog.selectPage(docs, '전체', '사 망 진 단 서').items[0].id, 'autopsy');
  assert.equal(catalog.selectPage(docs, '경기 분석', '누 적 전 적').count, 0);
  assert.equal(catalog.selectPage(docs, '전체', '전 시 즌 누 적').items[0].id, 'license');
  const result = catalog.selectPage(docs, '전체', '없는 문서', 10);
  assert.equal(result.page, 0);
  assert.equal(result.pages, 1);
  assert.equal(result.count, 0);
  assert.equal(catalog.selectPage(docs, '전체', '', NaN, 0).page, 0);
});

test('recent history contains only real selections, is deduplicated, and has at most three IDs', () => {
  const { LumiaContext: context, LumiaDocuments: docs } = load();
  assert.deepEqual(plain(context.getRecent()), []);
  context.remember('license');
  assert.deepEqual(plain(context.getRecent()), ['license']);
  for (const id of ['autopsy', 'liability', 'payroll', 'autopsy', 'removed']) context.remember(id);
  assert.deepEqual(plain(context.getRecent()), ['autopsy', 'payroll', 'liability']);
  const copy = context.getRecent();
  copy.push('license');
  assert.equal(context.getRecent().length, 3);
  docs.splice(docs.findIndex(item => item.id === 'payroll'), 1);
  assert.deepEqual(plain(context.getRecent()), ['autopsy', 'liability']);
  docs.find(item => item.id === 'license').status = 'disabled';
  context.remember('license');
  assert.deepEqual(plain(context.getRecent()), ['autopsy', 'liability']);
});

test('nickname and recent IDs survive a new document context without executing a lookup', () => {
  const localStorage = storage();
  const first = load({ localStorage });
  first.LumiaContext.setNickname('  <img src=x onerror=alert(1)>  ');
  first.LumiaContext.remember('payroll');
  const second = load({ localStorage });
  assert.equal(second.LumiaContext.getNickname(), '<img src=x onerror=alert(1)>');
  assert.deepEqual(plain(second.LumiaContext.getRecent()), ['payroll']);
  assert.equal(JSON.parse(localStorage.getItem(key)).version, 1);
  assert.equal(second.LumiaContext.setNickname('가'.repeat(150)).length, 100);
});

test('corrupt, old-version, and malformed stored values cannot break initialization', () => {
  for (const initial of ['{broken', '{"version":2,"nickname":"old"}', '{"version":1,"nickname":12,"recent":"bad"}']) {
    const context = load({ localStorage: storage(initial) }).LumiaContext;
    assert.equal(context.getNickname(), '');
    assert.deepEqual(plain(context.getRecent()), []);
  }
  const context = load({ localStorage: storage(JSON.stringify({ version: 1, nickname: '닉네임', recent: ['removed', 'license', 'license', null, 'credit'] })) }).LumiaContext;
  assert.deepEqual(plain(context.getRecent()), ['license', 'credit']);
});

test('storage denial falls back to session storage or safe memory and refresh supports BFCache', () => {
  const denied = { getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); } };
  const sessionStorage = storage();
  const first = load({ localStorage: denied, sessionStorage });
  first.LumiaContext.setNickname('세션 기억');
  assert.equal(load({ localStorage: denied, sessionStorage }).LumiaContext.getNickname(), '세션 기억');
  const readOnly = { getItem() { return JSON.stringify({ version: 1, nickname: '오래된 값', recent: [] }); }, setItem() { throw Error('read only'); } };
  const fallback = load({ localStorage: readOnly, sessionStorage: storage() });
  fallback.LumiaContext.setNickname('최신 세션 값');
  assert.equal(load({ localStorage: readOnly, sessionStorage: fallback.sessionStorage }).LumiaContext.getNickname(), '최신 세션 값');
  const memory = load({ localStorage: denied, sessionStorage: denied }).LumiaContext;
  memory.setNickname('메모리 기억');
  memory.remember('autopsy');
  memory.refresh();
  assert.equal(memory.getNickname(), '메모리 기억');
  assert.deepEqual(plain(memory.getRecent()), ['autopsy']);
  const localStorage = storage();
  const suspended = load({ localStorage }).LumiaContext;
  const active = load({ localStorage }).LumiaContext;
  active.setNickname('다른 접수대');
  active.remember('credit');
  suspended.refresh();
  assert.equal(suspended.getNickname(), '다른 접수대');
  assert.deepEqual(plain(suspended.getRecent()), ['credit']);
});

test('cross-tab storage deletion resets context safely', () => {
  const { LumiaContext: context, listeners } = load();
  context.setNickname('이름');
  context.remember('license');
  listeners.storage({ key, newValue: null });
  assert.equal(context.getNickname(), '');
  assert.deepEqual(plain(context.getRecent()), []);
});
