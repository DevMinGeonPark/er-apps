'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../er-exam/public/exam-model.js');

const pick = credit => Object.fromEntries(model.questions.map(question => [question.id, question.choices.findIndex(choice => choice.credit === credit)]));

test('every question is gradable: one full-credit key, a source quote, a known domain', () => {
  const domainIds = new Set(model.domains.map(domain => domain.id));
  assert.equal(new Set(model.questions.map(question => question.id)).size, model.questions.length);
  for (const question of model.questions) {
    assert.ok(domainIds.has(question.domain), question.id);
    assert.ok([1, 2, 3].includes(question.weight), question.id);
    assert.ok(question.source.trim(), question.id);
    assert.equal(question.choices.length, 4, question.id);
    assert.equal(question.choices.filter(choice => choice.credit === 1).length, 1, question.id);
    assert.ok(question.choices.every(choice => [0, 0.5, 1].includes(choice.credit)), question.id);
  }
  for (const domain of model.domains) assert.ok(model.questions.filter(question => question.domain === domain.id).length >= 2, domain.id);
});

test('answer key position is not guessable from a fixed slot', () => {
  const counts = [0, 0, 0, 0];
  for (const question of model.questions) counts[question.choices.findIndex(choice => choice.credit === 1)]++;
  assert.ok(counts.every(count => count >= 5), counts.join(','));
});

test('tiers ascend from 아이언 to the 미스릴 ceiling and map score bands', () => {
  assert.deepEqual(model.tiers.map(tier => tier.name), ['아이언', '브론즈', '실버', '골드', '플래티넘', '다이아몬드', '메테오라이트', '미스릴']);
  model.tiers.slice(1).forEach((tier, index) => assert.ok(tier.min > model.tiers[index].min));
  assert.equal(model.tierFor(0).label, '아이언 IV');
  assert.equal(model.tierFor(19.9).label, '아이언 I');
  assert.equal(model.tierFor(20).label, '브론즈 IV');
  assert.equal(model.tierFor(25).tier.name, '브론즈'); // 4지선다 무작위 응답 기대치
  assert.equal(model.tierFor(73.9).label, '플래티넘 I');
  assert.equal(model.tierFor(84).label, '메테오라이트');
  assert.equal(model.tierFor(100).label, '미스릴');
  assert.equal(model.tierFor(100).next, null);
});

test('score: full key is 미스릴, blank or all-wrong is 아이언, partial credit counts half', () => {
  const full = model.score(pick(1));
  assert.equal(full.percent, 100);
  assert.equal(full.tier.id, 'mithril');
  assert.ok(full.domains.every(domain => domain.percent === 100));

  for (const answers of [pick(0), {}, null, { e01: 99, e02: 'x' }]) {
    const result = model.score(answers);
    assert.equal(result.earned, 0);
    assert.equal(result.label, '아이언 IV');
  }

  const half = model.score({ ...pick(1), e03: model.questions.find(question => question.id === 'e03').choices.findIndex(choice => choice.credit === 0.5) });
  assert.equal(half.earned, full.max - 0.5);
  assert.equal(half.weakest.id, 'join');
  assert.equal(half.review.find(item => item.id === 'e03').credit, 0.5);
});

test('one missed 상황 판단 question keeps 미스릴, two do not', () => {
  const hard = model.questions.filter(question => question.weight === 3).map(question => question.id);
  const miss = ids => model.score({ ...pick(1), ...Object.fromEntries(ids.map(id => [id, pick(0)[id]])) });
  assert.equal(miss(hard.slice(0, 1)).tier.id, 'mithril');
  assert.equal(miss(hard.slice(0, 2)).tier.id, 'meteorite');
});
