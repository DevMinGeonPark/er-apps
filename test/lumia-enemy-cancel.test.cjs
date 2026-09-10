const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const source = readFileSync(require('node:path').join(__dirname, '../er-enemy/public/api.js'), 'utf8');
const metadata = { characters: [], areas: [], masteries: [], monsters: [] };
function api(core) {
  const context = { ERCore: { META_TTL: 1000, cacheGet: () => null, cacheSet() {}, ...core } };
  context.window = context; vm.runInNewContext(source, context); return context.ER;
}
for (const method of ['killers', 'observe']) test(`canceling ${method} while metadata waits prevents follow-up queries`, async () => {
  let finish, calls = 0;
  const client = api({ metadata: () => new Promise(resolve => { finish = resolve; }), getProfile: async () => { calls++; return {}; }, getMatches: async () => { calls++; return []; } });
  const controller = new AbortController();
  const request = method === 'killers' ? client.killers('합성취소', { signal: controller.signal }) : client.observe('합성취소', null, null, { signal: controller.signal });
  controller.abort(); finish(metadata);
  await assert.rejects(request, error => error.name === 'AbortError');
  assert.equal(calls, 0);
});
test('canceling observation during profile prevents matches and chain requests', async () => {
  let finish, started, calls = 0;
  const ready = new Promise(resolve => { started = resolve; });
  const client = api({ metadata: async () => metadata, getProfile: () => { started(); return new Promise(resolve => { finish = resolve; }); }, getMatches: async () => { calls++; return []; }, findGameRecord: async () => { calls++; return null; } });
  const controller = new AbortController();
  const request = client.observe('합성상대', '합성본인', 1, { signal: controller.signal });
  await ready; controller.abort(); finish({ nickname: '합성상대' });
  await assert.rejects(request, error => error.name === 'AbortError'); assert.equal(calls, 0);
});
