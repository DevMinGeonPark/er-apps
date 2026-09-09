const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../public/payroll.js');
const { settlement, calculate } = globalThis.Payroll;
const match = (extra = {}) => ({ gameId: 100, nickname: '근로자', matchingMode: 3, startDtm: '2026-09-09T13:00:00Z',
  playTime: 1800, mmrGainInGame: 27, mmrLossEntryCost: -42, mmrGain: -15, gameRank: 6, ...extra });

test('official entry fee keeps its sign and the net determines hourly wage', () => {
  const r = calculate([match()], 10);
  assert.equal(r.gross, 27); assert.equal(r.entry, -42); assert.equal(r.net, -15);
  assert.equal(r.adjustment, 0); assert.equal(r.hourly, -30); assert.equal(r.stamp, '열정 납부');
});
test('adjustments reconcile official net without hiding RP gains or losses', () => {
  const r = calculate([match({ mmrGain: -5 })], 10);
  assert.equal(r.adjustment, 10); assert.equal(r.gross + r.entry + r.adjustment, r.net);
  assert.equal(settlement(match({ mmrGain: 0 })).net, 0);
  assert.equal(settlement(match({ mmrGain: undefined, mmrBefore: 5000, mmrAfter: 5008 })).net, 8);
  assert.equal(settlement(match({ mmrGain: undefined })).net, -15);
});
test('missing RP holds the complete total, missing time holds only the hourly rate', () => {
  const r = calculate([match(), match({ gameId: 101, mmrGain: null, mmrGainInGame: null })], 10);
  assert.equal(r.net, null); assert.equal(r.hourly, null); assert.equal(r.missing, 1);
  assert.equal(calculate([match({ playTime: 0 })], 10).hourly, null);
  const noBreakdown = calculate([match({ mmrGainInGame: undefined })], 10);
  assert.equal(noBreakdown.net, -15); assert.equal(noBreakdown.gross, null);
});
test('recent ranked window is ordered, deduplicated and excludes normal games', () => {
  const rows = Array.from({ length: 14 }, (_, i) => match({ gameId: i + 1, startDtm: new Date(Date.UTC(2026, 8, i + 1)).toISOString() }));
  const r = calculate([match({ gameId: 999, matchingMode: 2 }), rows[0], ...rows], 10);
  assert.equal(r.count, 10); assert.equal(r.available, 14); assert.equal(r.rows[0].gameId, 14); assert.equal(r.rows.at(-1).gameId, 5);
  assert.equal(r.net, -150); assert.equal(r.seconds, 18000);
});
test('empty ranked history has an explicit error and does not produce a zero payslip', () => {
  assert.throws(() => calculate([match({ matchingMode: 2 })]), /랭크 근무 기록/);
  assert.throws(() => calculate([match()], 999), /경기 수/);
});
