const assert = require("assert");
const { LUMIA } = require("./lumia-areas.js");
const { GAME_CYCLE, HOP_SECONDS } = require("./data.js");
const { AREAS, neighbours, ringOf, reachable, phaseAt } = require("./graph.js");

// geometry: 21 closed rings, each enclosing real area, each label anchor inside its own ring
function inside([px, py], ring) {
  let hit = false;
  for (let i = 0, j = ring.length - 2; i < ring.length - 1; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}
assert.strictEqual(AREAS.length, 21);
for (const area of AREAS) {
  const ring = ringOf(area.key);
  assert.ok(ring.length >= 8, `${area.name} ring too coarse`);
  assert.deepStrictEqual(ring[0], ring[ring.length - 1], `${area.name} ring is not closed`);
  const twice = ring.slice(1).reduce((s, p, i) => s + (ring[i][0] * p[1] - p[0] * ring[i][1]), 0);
  assert.ok(Math.abs(twice) / 2 > 1, `${area.name} encloses nothing`);
  const [ax, ay] = [area.center[0] / 0.05, -area.center[1] / 0.05];
  assert.ok(inside([ax, ay], ring), `${area.name} label anchor sits outside its own area`);
}

// adjacency is symmetric and the island is one connected piece
for (const [key, ns] of neighbours) {
  assert.ok(ns.size > 0, `${key} borders nothing`);
  for (const n of ns) assert.ok(neighbours.get(n).has(key), `${key}-${n} is one-way`);
}
assert.strictEqual(reachable("Laboratory", Infinity, 1).size, 21, "island is split");

// time budget gates the spread
assert.deepStrictEqual([...reachable("Laboratory", 0, HOP_SECONDS).keys()], ["Laboratory"]);
const oneHop = reachable("Laboratory", HOP_SECONDS, HOP_SECONDS);
assert.deepStrictEqual(
  new Set([...oneHop.keys()].filter((k) => k !== "Laboratory")),
  neighbours.get("Laboratory"),
);

// a restricted zone walls off what sits behind it
const open = reachable("Barge", Infinity, HOP_SECONDS);
const shut = reachable("Barge", Infinity, HOP_SECONDS, new Set(["Harbor"]));
assert.ok(open.size > shut.size, "banning 항구 should cut the barge off");
assert.ok(!shut.has("Harbor"));

// day/night schedule lines up with the flips that respawn wildlife
assert.deepStrictEqual([phaseAt(0).day, phaseAt(0).type, phaseAt(0).remaining], [1, "day", 140]);
assert.strictEqual(phaseAt(139).remaining, 1);
assert.deepStrictEqual([phaseAt(140).day, phaseAt(140).type], [1, "night"]);
assert.deepStrictEqual([phaseAt(250).day, phaseAt(250).type], [2, "day"]);
const total = GAME_CYCLE.reduce((s, p) => s + p.duration, 0);
assert.ok(phaseAt(total).over && !phaseAt(total - 1).over, "game should end at the last flip");

console.log("ok — 21 traced areas, %d borders, connected",
  [...neighbours.values()].reduce((s, n) => s + n.size, 0) / 2);
console.log("ok — %d phases, %d초 full game", GAME_CYCLE.length, total);
