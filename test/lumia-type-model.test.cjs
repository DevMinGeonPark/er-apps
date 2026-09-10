'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const model = require('../er-type/public/quiz-model.js');

test('model exports the versioned UMD contract without browser or network dependencies', () => {
  assert.equal(model.VERSION, 1);
  const sandbox = {};
  vm.runInNewContext(readFileSync(require.resolve('../er-type/public/quiz-model.js'), 'utf8'), sandbox);
  assert.equal(sandbox.LumiaType.VERSION, 1);
  assert.equal(sandbox.LumiaType.types.length, 16);
  assert.equal(typeof sandbox.LumiaType.score, 'function');
  assert.equal(typeof sandbox.LumiaType.getType, 'function');
  assert.equal(typeof sandbox.LumiaType.teamManual, 'function');
});

test('four ordered axes receive three unique questions each with mixed choice polarity', () => {
  assert.deepEqual(model.axes.map(axis => axis.poles), [['교전', '운영'], ['주도', '호응'], ['안정', '모험'], ['고정', '적응']]);
  assert.equal(new Set(model.axes.map(axis => axis.id)).size, 4);
  assert.equal(model.questions.length, 12);
  assert.equal(new Set(model.questions.map(question => question.id)).size, 12);
  for (let axis = 0; axis < 4; axis++) {
    const questions = model.questions.filter(question => question.axis === axis);
    assert.equal(questions.length, 3);
    assert.equal(new Set(questions.map(question => question.choices[0].pole)).size, 2);
    for (const question of questions) {
      assert(question.prompt.trim());
      assert.equal(question.choices.length, 2);
      assert.deepEqual(question.choices.map(choice => choice.pole).sort(), [0, 1]);
      assert(question.choices.every(choice => typeof choice.text === 'string' && choice.text.trim()));
    }
  }
});

test('all sixteen profiles are complete and their suggested partners resolve', () => {
  assert.equal(model.types.length, 16);
  assert.equal(new Set(model.types.map(type => type.code)).size, 16);
  assert.equal(new Set(model.types.map(type => type.name)).size, 16);
  for (let index = 0; index < 16; index++) {
    const code = index.toString(2).padStart(4, '0');
    const profile = model.getType(code);
    assert(profile, code);
    for (const field of ['name', 'tagline', 'description', 'selfView', 'teamView', 'tip']) assert(profile[field].trim(), `${code}.${field}`);
    assert.equal(profile.strengths.length, 3);
    assert.equal(profile.pitfalls.length, 2);
    assert(profile.strengths.concat(profile.pitfalls).every(text => typeof text === 'string' && text.trim()));
    assert(model.getType(profile.best)); assert(model.getType(profile.spicy));
    assert.notEqual(profile.best, code); assert.notEqual(profile.spicy, code);
    assert.notEqual(profile.best, profile.spicy);
  }
  assert.match(model.getType('0010').name, /낭만형 돌격대장/);
  assert.match(model.getType('1000').name, /RP 적금형 생존주의자/);
  assert.match(model.getType('0111').name, /교전 냄새 맡는 청소부/);
  assert.match(model.getType('0110').name, /외길 낭만 장인/);
  assert.match(model.getType('0100').name, /전담 수호령/);
});

test('approved punchlines and guardian pairing are preserved in compact result copy', () => {
  const approved = {
    '0010': '들어간다? 들어간다? 이미 들어갔다.',
    '1000': '우승은 한 팀만 하지만, 점수는 여러 팀이 먹는다.',
    '0111': '먼저 싸워. 난 끝날 때 갈게.',
    '0110': '조합이 이상한 게 아니라, 나를 중심으로 짜면 돼.',
  };
  for (const [code, tagline] of Object.entries(approved)) assert.equal(model.getType(code).tagline, tagline);
  assert.equal(model.getType('0010').best, '0100');
  for (const profile of model.types) {
    assert.notEqual(profile.selfView, profile.teamView);
    assert(Array.from(profile.selfView).length <= 75, profile.code + ' selfView exceeds card budget');
    assert(Array.from(profile.teamView).length <= 75, profile.code + ' teamView exceeds card budget');
  }
});

test('score reaches every type using question polarity rather than answer position', () => {
  for (const profile of model.types) {
    const answers = model.questions.map(question => question.choices.findIndex(choice => choice.pole === Number(profile.code[question.axis])));
    const original = [...answers];
    const result = model.score(answers);
    assert.equal(result.code, profile.code);
    assert.equal(result.type, profile);
    assert.deepEqual(answers, original);
    result.axes.forEach((axis, index) => {
      assert.equal(axis.id, model.axes[index].id);
      assert.equal(axis.pole, Number(profile.code[index]));
      assert.equal(axis.counts[axis.pole], 3);
      assert.equal(axis.counts[1 - axis.pole], 0);
    });
  }
  assert.notEqual(model.score(Array(12).fill(0)).code, '0000');
  assert.notEqual(model.score(Array(12).fill(1)).code, '1111');
});

test('every one of 4096 complete answers has four correct three-vote majorities', () => {
  const reached = new Set();
  for (let mask = 0; mask < 4096; mask++) {
    const answers = Array.from({ length: 12 }, (_, index) => (mask >> index) & 1);
    const result = model.score(answers);
    assert(result);
    reached.add(result.code);
    const expected = model.axes.map((_, axisIndex) => {
      const chosenPoles = model.questions.flatMap((question, index) => question.axis === axisIndex ? [question.choices[answers[index]].pole] : []);
      const rightCount = chosenPoles.filter(pole => pole === 1).length;
      assert.deepEqual(result.axes[axisIndex].counts, [3 - rightCount, rightCount]);
      return rightCount >= 2 ? '1' : '0';
    }).join('');
    assert.equal(result.code, expected);
    assert.equal(result.type.code, expected);
  }
  assert.equal(reached.size, 16);
});

test('incomplete, sparse, and invalid answers return null without coercing values', () => {
  for (const invalid of [undefined, null, {}, '000000000000', [], Array(11).fill(0), Array(13).fill(0), Array(12)]) assert.equal(model.score(invalid), null);
  for (const value of [-1, 2, 0.5, '0', '1', true, false, null, undefined, NaN, Infinity, {}, []]) {
    const answers = Array(12).fill(0); answers[5] = value;
    assert.equal(model.score(answers), null, `invalid answer ${String(value)}`);
  }
  const sparse = Array(12).fill(0); delete sparse[3];
  assert.equal(model.score(sparse), null);
  for (const code of [undefined, null, 0, 1111, '', '000', '00000', '0002', ' 0000', '0000\n', {}, ['0000']]) assert.equal(model.getType(code), null);
});

test('team manual rejects invalid teams while allowing two or three repeated types', () => {
  for (const input of [undefined, null, {}, '0000', [], ['0000'], Array(4).fill('0000'), ['0000', 'xxxx'], ['0000', 1111], Array(2)]) assert.equal(model.teamManual(input), null);
  const sparse = ['0000', '0001']; delete sparse[0];
  assert.equal(model.teamManual(sparse), null);
  for (const size of [2, 3]) {
    const codes = Array(size).fill('0000');
    const before = [...codes];
    const manual = model.teamManual(codes);
    assert(manual);
    assert.equal(manual.roles.length, size);
    assert.equal(manual.agreements.length, 3);
    assert(manual.roles.every(role => role.code === '0000'));
    assert.notEqual(manual.roles[0].role, manual.roles[1].role);
    assert.deepEqual(codes, before);
  }
});

test('team advice changes with each axis and reflects actual member composition', () => {
  const baseline = model.teamManual(['0000', '0000']);
  for (const code of ['1000', '0100', '0010', '0001']) {
    const changed = model.teamManual(['0000', code]);
    assert.notDeepEqual(changed.agreements, baseline.agreements, `axis change ${code}`);
    assert.notEqual(changed.summary, baseline.summary, `summary change ${code}`);
  }
  assert.match(model.teamManual(['0100', '1100']).agreements[0], /첫 제안/);
  assert.match(model.teamManual(['0000', '1000']).agreements[0], /최종 결정자/);
  assert.match(model.teamManual(['0011', '1111']).agreements[2], /멈출 위치나 시간/);
  assert.match(model.teamManual(['0000', '1101']).headline, /싸울 이유와 다음 동선/);
  assert.match(model.teamManual(['0000', '0001']).headline, /교전의 시작과 끝/);
  assert.match(model.teamManual(['1000', '1101']).headline, /준비한 다음 장면/);
});

test('all ordered pairs and triples yield complete manuals without invented compatibility scores', () => {
  const codes = model.types.map(type => type.code);
  function verify(team) {
    const result = model.teamManual(team);
    assert(result.headline.trim()); assert(result.summary.trim()); assert(result.warning.trim());
    assert.equal(result.agreements.length, 3);
    assert(result.agreements.every(text => text.trim()));
    assert.equal(result.roles.length, team.length);
    result.roles.forEach((role, index) => {
      assert.equal(role.code, team[index]);
      assert.equal(role.name, model.getType(team[index]).name);
      assert(role.role.trim()); assert(role.tip.trim());
    });
    assert.doesNotMatch(JSON.stringify(result), /\d\s*%|NaN|undefined|과학적으로 검증/);
  }
  for (const first of codes) for (const second of codes) {
    verify([first, second]);
    for (const third of codes) verify([first, second, third]);
  }
});

test('shared profile data stays immutable and scoring outputs do not leak mutable counts', () => {
  assert(Object.isFrozen(model)); assert(Object.isFrozen(model.questions));
  assert(Object.isFrozen(model.types[0].strengths));
  assert.throws(() => { model.questions[0].choices[0].pole = 1; }, TypeError);
  const first = model.score(Array(12).fill(0));
  first.axes[0].counts[0] = 999;
  assert.notEqual(model.score(Array(12).fill(0)).axes[0].counts[0], 999);
});
