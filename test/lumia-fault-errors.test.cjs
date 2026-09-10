// Real fault adapter, synthetic ERCore only. No network or API credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync(require('node:path').resolve(__dirname, '../er-fault/public/api.js'), 'utf8');
function adapter(getMatches) {
  const context = { window: {}, ERCore: { META_TTL: 1, charImgUrl: () => '', imgToDataUri: () => '', getCharacters: async () => [], getMatches } };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.window.ER;
}
const query = { me: '가상본인', mates: ['가상팀원'], season: 'TEST', pages: 3, mode: 'all' };
const match = { gameId: 990001, teamNumber: 1, matchingMode: 3, gameRank: 1, startDtm: '2026-09-10T00:00:00Z', mmrGain: 10, characterNum: 1 };

test('actual teammate 404 identifies nickname and preserves HTTP status and cause', async () => {
  const original = Object.assign(new Error('upstream missing'), { status: 404 });
  const calls = [];
  const er = adapter(async (name, options) => {
    calls.push({ name, ...options });
    if (name === query.mates[0]) throw original;
    return [match];
  });
  await assert.rejects(er.assessRequest(query), error => {
    assert.match(error.message, /팀원 '가상팀원'.*찾을 수 없습니다/);
    assert.equal(error.participant, '가상팀원');
    assert.equal(error.status, 404);
    assert.equal(error.cause.message, 'upstream missing');
    assert.equal(error.cause.cause, original);
    return true;
  });
  assert.deepEqual(calls.map(call => call.name), ['가상본인', '가상팀원']);
  assert(calls.every(call => call.pages === 6 && call.season === 'TEST'));
});

test('self lookup failure remains distinguishable from teammate failure', async () => {
  const er = adapter(async () => { throw Object.assign(new Error('missing'), { status: 404 }); });
  await assert.rejects(er.assessRequest(query), error => {
    assert.match(error.message, /본인 '가상본인'/);
    assert.equal(error.status, 404);
    return true;
  });
});

test('non-404 service error preserves original message/status and marks failing participant', async () => {
  const er = adapter(async name => {
    if (name === query.mates[0]) throw Object.assign(new Error('요청 제한: 잠시 후 재시도'), { status: 429 });
    return [match];
  });
  await assert.rejects(er.assessRequest(query), error => {
    assert.equal(error.message, '요청 제한: 잠시 후 재시도');
    assert.equal(error.status, 429);
    assert.equal(error.participant, '가상팀원');
    return true;
  });
});

test('normal nicknames, no-shared-match and no-accident outcomes preserve the existing contract', async () => {
  const er = adapter(async () => [match]);
  const result = await er.assessRequest(query);
  assert.deepEqual(Array.from(result.names), ['가상본인', '가상팀원']);
  assert.equal(result.sharedGames, 1);
  assert.equal(result.noAccident, true);
  assert.equal(result.accidentCount, 0);
  const empty = adapter(async () => []);
  await assert.rejects(empty.assessRequest(query), /함께한 게임을 찾지 못했습니다/);
});
