// Web Share and canvas are stubs. No browser dialog, network, or Kakao message is sent.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const { File, Blob } = require('node:buffer');
const model = require('../er-type/public/quiz-model.js');
const source = readFileSync(resolve(__dirname, '../er-type/public/share.js'), 'utf8');
const profile = model.getType('0000');
const other = model.getType('1111');
const pngBytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
const canvas = () => ({ toBlob(done, type) { assert.equal(type, 'image/png'); done(new Blob([pngBytes], { type })); } });
const deferred = () => { let resolve, reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; };
const flush = () => new Promise(done => setImmediate(done));
function fixture(overrides = {}) {
  const renderCalls = [], shareCalls = [], capabilityCalls = [];
  const root = {
    module: { exports: {} }, File, Blob, URL, setTimeout, clearTimeout,
    location: { href: 'https://example.test/type/?nickname=PRIVATE&answers=PRIVATE#old', origin: 'https://example.test' },
    LumiaType: model,
    LumiaTypeExport: { render: async (...args) => { renderCalls.push(args); return canvas(); } },
    navigator: {
      canShare: payload => { capabilityCalls.push(payload); return true; },
      share: payload => { shareCalls.push(payload); return Promise.resolve(); },
    },
    ...overrides,
  };
  vm.createContext(root);
  vm.runInContext(source, root);
  return { api: root.LumiaTypeShare, root, renderCalls, shareCalls, capabilityCalls };
}
const plain = value => JSON.parse(JSON.stringify(value));
const scored = (left = 3) => ({ code: '0000', axes: model.axes.map(axis => ({ ...axis, counts: [left, 3 - left], pole: 0 })) });

test('UMD has no auto binding, rendering or sharing on load', () => {
  const f = fixture();
  assert.equal(f.api, f.root.module.exports);
  assert.deepEqual(Object.keys(f.api).sort(), ['getState', 'prepare', 'share']);
  assert.equal(f.shareCalls.length, 0);
  assert.equal(f.renderCalls.length, 0);
  assert.deepEqual(plain(f.api.getState(profile, '닉네임')), { ready: false, preparing: false });
});

test('preparation deduplicates, stores a local PNG File and does not call native sharing', async () => {
  const f = fixture();
  const first = f.api.prepare(profile, '  닉네임  ');
  const second = f.api.prepare(profile, '닉네임');
  assert.equal(first, second);
  assert.deepEqual(plain(f.api.getState(profile, '닉네임')), { ready: false, preparing: true });
  assert.deepEqual(plain(await first), { ready: true, preparing: false });
  await f.api.prepare(profile, '닉네임');
  assert.equal(f.renderCalls.length, 1);
  assert.equal(f.renderCalls[0][1], '닉네임');
  assert.equal(f.shareCalls.length, 0);
});

test('prepared file sharing invokes navigator.share immediately and keeps nickname out of link/text', async () => {
  const f = fixture();
  await f.api.prepare({ ...profile, name: 'PRIVATE 닉네임' }, 'PRIVATE 닉네임');
  const outcome = f.api.share(profile, 'PRIVATE 닉네임');
  assert.equal(f.shareCalls.length, 1, 'native share must run before the returned promise settles');
  const payload = f.shareCalls[0];
  assert.deepEqual(plain(await outcome), { status: 'shared', mode: 'file' });
  assert.equal(payload.files.length, 1);
  assert(payload.files[0] instanceof File);
  assert.equal(payload.files[0].type, 'image/png');
  assert.equal(payload.files[0].name, 'lumia-type-0000.png');
  assert.deepEqual([...new Uint8Array(await payload.files[0].arrayBuffer())], [...pngBytes]);
  assert.equal(payload.url, 'https://example.test/type/#type=0000');
  assert.equal(payload.title, profile.name + ' · 이리 팀원 유형 검사');
  assert.equal(payload.text, profile.name + ' · ' + profile.tagline);
  assert.doesNotMatch(payload.url + payload.title + payload.text, /PRIVATE|닉네임|answers/);
  assert.equal(f.capabilityCalls[0].files[0], payload.files[0]);
});

test('unprepared results share only the canonical type link without rendering in the gesture', async () => {
  const f = fixture();
  const outcome = f.api.share(other, '아직준비안됨', scored(2));
  assert.equal(f.shareCalls.length, 1);
  assert.equal(f.renderCalls.length, 0);
  assert.deepEqual(plain(await outcome), { status: 'shared', mode: 'link' });
  assert.equal(f.shareCalls[0].url, 'https://example.test/type/#type=1111');
  assert.equal('files' in f.shareCalls[0], false);
});

for (const behavior of ['unsupported files', 'throwing capability check']) {
  test(`${behavior} falls back to link sharing`, async () => {
    const f = fixture();
    f.root.navigator.canShare = () => { if (behavior.startsWith('throwing')) throw new TypeError('unsupported'); return false; };
    await f.api.prepare(profile, '유저');
    const outcome = f.api.share(profile, '유저');
    assert.equal(f.shareCalls.length, 1);
    assert.deepEqual(plain(await outcome), { status: 'shared', mode: 'link' });
    assert.equal('files' in f.shareCalls[0], false);
    assert.equal(f.api.getState(profile, '유저').ready, true);
  });
}

test('absent Web Share returns unsupported without any native call or export', async () => {
  const f = fixture({ navigator: {} });
  const result = await f.api.share(profile, '닉');
  assert.equal(result.status, 'unsupported');
  assert.equal(result.mode, 'link');
  assert.match(result.message, /링크 복사/);
  assert.equal(f.renderCalls.length, 0);
});

test('user cancellation is separate from errors, leaves prepared file intact, and permits retry', async () => {
  const f = fixture();
  await f.api.prepare(profile, '닉');
  f.root.navigator.share = () => Promise.reject(Object.assign(new Error('Dismissed'), { name: 'AbortError' }));
  const cancellation = await f.api.share(profile, '닉');
  assert.equal(cancellation.status, 'cancelled');
  assert.equal(cancellation.mode, 'file');
  assert.equal(f.api.getState(profile, '닉').ready, true);
  f.root.navigator.share = () => Promise.reject(Object.assign(new Error('No activation'), { name: 'NotAllowedError' }));
  const failure = await f.api.share(profile, '닉');
  assert.equal(failure.status, 'error');
  assert.equal(f.api.getState(profile, '닉').ready, true);
  f.root.navigator.share = () => Promise.resolve();
  assert.equal((await f.api.share(profile, '닉')).status, 'shared');
});

test('synchronous unsupported-file mismatch falls back immediately within the original click', async () => {
  const f = fixture();
  await f.api.prepare(profile);
  const attempts = [];
  f.root.navigator.share = payload => {
    attempts.push(payload);
    if (payload.files) throw Object.assign(new Error('File type unavailable'), { name: 'NotSupportedError' });
    return Promise.resolve();
  };
  const result = f.api.share(profile);
  assert.equal(attempts.length, 2);
  assert.equal('files' in attempts[1], false);
  assert.deepEqual(plain(await result), { status: 'shared', mode: 'link' });
});

test('duplicate clicks reuse one native share, and a different result waits for that dialog to close', async () => {
  const pending = deferred();
  const f = fixture();
  f.root.navigator.share = payload => { f.shareCalls.push(payload); return pending.promise; };
  const first = f.api.share(profile, '닉');
  const duplicate = f.api.share(profile, '닉');
  assert.equal(first, duplicate);
  assert.equal(f.shareCalls.length, 1);
  assert.equal((await f.api.share(other, '닉')).status, 'error');
  assert.equal(f.shareCalls.length, 1);
  pending.resolve();
  assert.equal((await first).status, 'shared');
  await f.api.share(other, '닉');
  assert.equal(f.shareCalls.length, 2);
});

test('late preparation cannot replace the current profile image', async () => {
  const a = deferred(), b = deferred();
  const f = fixture();
  f.root.LumiaTypeExport.render = type => type.code === profile.code ? a.promise : b.promise;
  const first = f.api.prepare(profile, '이전');
  const last = f.api.prepare(other, '현재');
  await flush();
  b.resolve(canvas());
  assert.equal((await last).ready, true);
  a.resolve(canvas());
  assert.equal((await first).ready, false);
  assert.equal(f.api.getState(profile, '이전').ready, false);
  assert.equal(f.api.getState(other, '현재').ready, true);
  assert.equal((await f.api.share(other, '현재')).mode, 'file');
  assert.equal(f.shareCalls[0].files[0].name, 'lumia-type-1111.png');
  assert.equal((await f.api.share(profile, '이전')).mode, 'link');
});

test('same type with different answer ratios or nickname has a different cache key; score input is snapshotted', async () => {
  const f = fixture();
  const firstScore = scored(3);
  const first = f.api.prepare(profile, '닉', firstScore);
  firstScore.axes[0].counts[0] = 99;
  await first;
  assert.deepEqual(plain(f.renderCalls[0][2].axes[0].counts), [3, 0]);
  assert.equal(f.api.getState(profile, '닉', scored(3)).ready, true);
  assert.equal(f.api.getState(profile, '닉', scored(2)).ready, false);
  assert.equal(f.api.getState(profile, '다른닉', scored(3)).ready, false);
  await f.api.prepare(profile, '닉', scored(2));
  assert.equal(f.renderCalls.length, 2);
  assert.equal(f.api.getState(profile, '닉', scored(3)).ready, false);
  assert.equal(f.api.getState(profile, '닉', scored(2)).ready, true);
});

test('render failure and missing PNG both settle safely and can be retried', async () => {
  const f = fixture();
  f.root.LumiaTypeExport.render = async () => { throw new Error('로컬 이미지 준비 실패'); };
  const failed = await f.api.prepare(profile);
  assert.equal(failed.ready, false);
  assert.equal(failed.preparing, false);
  assert.match(failed.message, /이미지 준비 실패/);
  assert.equal((await f.api.share(profile)).mode, 'link');
  f.root.LumiaTypeExport.render = async () => ({ toBlob(done) { done(null); } });
  assert.match((await f.api.prepare(profile)).message, /PNG/);
  f.root.LumiaTypeExport.render = async () => canvas();
  assert.equal((await f.api.prepare(profile)).ready, true);
});

test('preparation timeout unlocks UI and ignores its eventual completion', async () => {
  const stalled = deferred();
  const timers = [];
  const f = fixture({ setTimeout(callback, delay) { timers.push({ callback, delay }); return timers.length; }, clearTimeout() {} });
  f.root.LumiaTypeExport.render = () => stalled.promise;
  const pending = f.api.prepare(profile);
  await flush();
  assert.equal(timers[0].delay, 20000);
  timers[0].callback();
  const result = await pending;
  assert.equal(result.preparing, false);
  assert.equal(result.ready, false);
  assert.match(result.message, /시간이 초과/);
  stalled.resolve(canvas());
  await flush();
  assert.equal(f.api.getState(profile).ready, false);
});

test('invalid profile/score and absent File fail safely without native sharing', async () => {
  const f = fixture();
  assert.equal((await f.api.share({ code: 'bad', name: 'bad' })).status, 'error');
  assert.equal((await f.api.prepare(profile, '닉', { axes: [] })).ready, false);
  assert.equal(f.shareCalls.length, 0);
  assert.equal(f.renderCalls.length, 0);
  const absentFile = fixture({ File: undefined });
  assert.equal((await absentFile.api.prepare(profile)).ready, false);
  assert.equal(absentFile.renderCalls.length, 0);
  assert.equal((await absentFile.api.share(profile)).mode, 'link');
});
