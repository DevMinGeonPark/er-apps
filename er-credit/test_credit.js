// 신용평가 로직 자체검증. 실행: node test_credit.js
const assert = require('assert');
const { evaluate, MODEL, GRADES, zero, norm, clamp01 } = require('./server');

const CHAR = { id: 7, key: 'Jackie', name: '재키' };

// play판 동안 avgPlace/winRate/avgDamage/avgDeaths 가 주어진 값이 되도록 total을 만든다
function ent({ play, avgPlace, winRate = 0, avgDamage = 10000, avgDeaths = 1, seasons = 1, modes = ['rank'] }) {
  const t = zero();
  t.play = play;
  t.place = avgPlace * play;
  t.win = Math.round(winRate / 100 * play);
  t.top3 = Math.round(play * 0.3);
  t.damageToPlayer = avgDamage * play;
  t.playerDeaths = avgDeaths * play;
  const perSeason = Math.max(1, Math.round(play / seasons));
  return {
    total: t,
    totalSeasons: seasons,
    modes: new Set(modes),
    seasons: Array.from({ length: seasons }, (_, i) => ({
      seasonId: 30 - i, seasonName: `시즌${30 - i}`, play: perSeason,
      avgPlace, baseAvgPlace: avgPlace, avgDamage,
    })),
  };
}
// 본인 전체 평균(baseline)
function base({ play = 500, avgPlace = 5, winRate = 10, avgDamage = 10000, avgDeaths = 1 }) {
  const o = zero();
  o.play = play; o.place = avgPlace * play;
  o.win = Math.round(winRate / 100 * play);
  o.damageToPlayer = avgDamage * play;
  o.playerDeaths = avgDeaths * play;
  return o;
}
const BASE = base({});

// 1) Thin File — 판수 부족은 낮은 점수가 아니라 '평가 불가'
const thin = evaluate(ent({ play: MODEL.thinFilePlay - 1, avgPlace: 3 }), BASE, CHAR);
assert.strictEqual(thin.thinFile, true, 'thin file 판정 실패');
assert.strictEqual(thin.score, null, 'thin file은 점수가 없어야 함');
assert.strictEqual(thin.grade, null);

// 경계값: 최소 기준 딱 맞으면 평가된다
const atEdge = evaluate(ent({ play: MODEL.thinFilePlay, avgPlace: 3 }), BASE, CHAR);
assert.strictEqual(atEdge.thinFile, false, '최소 기준 충족 시 평가되어야 함');
assert.ok(atEdge.score > 0);

// 2) 본인 평균보다 잘하는 픽 > 못하는 픽 (같은 판수)
const good = evaluate(ent({ play: 200, avgPlace: 3, winRate: 20, avgDamage: 14000, avgDeaths: 0.7 }), BASE, CHAR);
const bad = evaluate(ent({ play: 200, avgPlace: 7, winRate: 2, avgDamage: 6000, avgDeaths: 1.4 }), BASE, CHAR);
assert.ok(good.score > bad.score, `좋은 픽이 더 높아야 함 (${good.score} vs ${bad.score})`);
assert.ok(good.grade < bad.grade, '등급은 숫자가 작을수록 우량');
assert.ok(good.factors.repayment > bad.factors.repayment, '상환이력이 갈려야 함');
assert.ok(good.factors.debt > bad.factors.debt, '부채수준이 갈려야 함');

// 3) 거래기간 — 조건이 같으면 판수 많은 쪽이 높다
const few = evaluate(ent({ play: 20, avgPlace: 4, winRate: 15 }), BASE, CHAR);
const many = evaluate(ent({ play: 400, avgPlace: 4, winRate: 15 }), BASE, CHAR);
assert.ok(many.factors.term > few.factors.term, '판수 많은 쪽 거래기간이 높아야 함');
assert.ok(many.score > few.score, `판수 많은 쪽 총점이 높아야 함 (${many.score} vs ${few.score})`);

// 4) 연체 — 본인 평균보다 확연히 못한 시즌이 잡힌다
const e = ent({ play: 100, avgPlace: 6, seasons: 3 });
e.seasons[0].avgPlace = 8.0; e.seasons[0].baseAvgPlace = 5.0;  // delta 3.0 → 90일 이상
e.seasons[1].avgPlace = 6.4; e.seasons[1].baseAvgPlace = 5.0;  // delta 1.4 → 30일 이상
e.seasons[2].avgPlace = 4.0; e.seasons[2].baseAvgPlace = 5.0;  // 정상
const dq = evaluate(e, BASE, CHAR);
assert.strictEqual(dq.delinquencies.length, 2, `연체 2건이어야 함 (실제 ${dq.delinquencies.length})`);
assert.strictEqual(dq.delinquencies[0].severity, 'severe');
assert.strictEqual(dq.delinquencies[1].severity, 'major');
// 본인 평균보다 잘한 시즌만 있으면 연체 없음
const clean = evaluate(ent({ play: 100, avgPlace: 3, seasons: 2 }), BASE, CHAR);
assert.strictEqual(clean.delinquencies.length, 0, '연체가 없어야 함');

// 5) 신규 개설 — 최근 한 시즌에 몰린 픽은 감점
const spread = evaluate(ent({ play: 120, avgPlace: 4, winRate: 12, seasons: 4 }), BASE, CHAR);
const burst = evaluate(ent({ play: 120, avgPlace: 4, winRate: 12, seasons: 1 }), BASE, CHAR);
assert.ok(spread.factors.fresh > burst.factors.fresh, '여러 시즌에 걸친 쪽이 신규위험 낮아야 함');
assert.strictEqual(burst.latestShare, 100, '한 시즌뿐이면 최근 집중도 100%');

// 6) 점수→등급 경계
for (const [min, grade] of GRADES) {
  const found = GRADES.find(([m]) => min >= m);
  assert.strictEqual(found[1], grade, `경계 ${min}점은 ${grade}등급`);
}
assert.strictEqual(GRADES.find(([m]) => 1000 >= m)[1], 1);
assert.strictEqual(GRADES.find(([m]) => 0 >= m)[1], 10);

// 7) 점수는 항상 0..1000, 등급은 1..10
for (const p of [5, 50, 500, 3000]) {
  for (const pl of [1, 3, 5, 8, 12]) {
    for (const w of [0, 5, 30]) {
      const r = evaluate(ent({ play: p, avgPlace: pl, winRate: w }), BASE, CHAR);
      if (r.thinFile) continue;
      assert.ok(r.score >= 0 && r.score <= 1000, `점수 범위 이탈: ${r.score}`);
      assert.ok(r.grade >= 1 && r.grade <= 10, `등급 범위 이탈: ${r.grade}`);
      assert.ok(r.limit, '등급별 한도 문구가 있어야 함');
    }
  }
}

// 8) 가중치 합 = 1 (안 맞으면 점수 척도가 조용히 깨진다)
const wsum = Object.values(MODEL.weights).reduce((a, b) => a + b, 0);
assert.ok(Math.abs(wsum - 1) < 1e-9, `가중치 합이 1이 아님: ${wsum}`);

// 9) norm/clamp01
assert.strictEqual(clamp01(-1), 0); assert.strictEqual(clamp01(2), 1);
assert.strictEqual(norm(0, 1.5), 0.5);
assert.strictEqual(norm(1.5, 1.5), 1);
assert.strictEqual(norm(-1.5, 1.5), 0);
assert.strictEqual(norm(-99, 1.5), 0, '범위 밖은 잘려야 함');

// 10) baseline이 비어도(전체 판수 0) 터지지 않는다
const empty = evaluate(ent({ play: 50, avgPlace: 4 }), zero(), CHAR);
assert.ok(Number.isFinite(empty.score), 'baseline 0에서도 점수가 유한해야 함');

console.log('모든 검증 통과');
