// Everything derived from the traced areas: who borders whom, and where someone could be.
(function (root, factory) {
  const data = root.LUMIA ? root : require("./lumia-areas.js");
  const cycle = root.GAME_CYCLE ? root : require("./data.js");
  const api = factory(data.LUMIA, cycle.GAME_CYCLE);
  if (typeof module !== "undefined") module.exports = api;
  else Object.assign(root, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function (LUMIA, GAME_CYCLE) {
  const AREAS = LUMIA.features.map((f) => f.properties);
  const byKey = new Map(AREAS.map((a) => [a.key, a]));
  const neighbours = new Map(AREAS.map((a) => [a.key, new Set(a.neighbours)]));

  /** Polygon ring in lattice units, y down — ready to drop into an SVG path. */
  const UNIT = 0.05;
  const ringOf = (key) =>
    LUMIA.features.find((f) => f.properties.key === key)
      .geometry.coordinates[0].map(([lon, lat]) => [lon / UNIT, -lat / UNIT]);
  const anchorOf = (key) => {
    const [lon, lat] = byKey.get(key).center;
    return [lon / UNIT, -lat / UNIT];
  };

  // Dijkstra from `from`, stopping at `budget` seconds. Banned areas are unreachable
  // and cannot be passed through — a restricted zone walls off everything behind it.
  function reachable(from, budget, hopSeconds, banned = new Set()) {
    if (banned.has(from) || !neighbours.has(from)) return new Map();
    const dist = new Map([[from, 0]]);
    const queue = [[0, from]];
    while (queue.length) {
      queue.sort((a, b) => a[0] - b[0]);
      const [d, cur] = queue.shift();
      if (d > dist.get(cur)) continue;
      for (const next of neighbours.get(cur)) {
        if (banned.has(next)) continue;
        const nd = d + hopSeconds;
        if (nd <= budget && nd < (dist.get(next) ?? Infinity)) {
          dist.set(next, nd);
          queue.push([nd, next]);
        }
      }
    }
    return dist;
  }

  // Which day/night phase is the game in, and how long until it flips?
  function phaseAt(elapsed) {
    let left = Math.max(0, elapsed);
    for (let i = 0; i < GAME_CYCLE.length; i++) {
      const p = GAME_CYCLE[i];
      if (left < p.duration) return { ...p, index: i, remaining: p.duration - left, over: false };
      left -= p.duration;
    }
    const last = GAME_CYCLE[GAME_CYCLE.length - 1];
    return { ...last, index: GAME_CYCLE.length - 1, remaining: 0, over: true };
  }

  return { AREAS, byKey, neighbours, ringOf, anchorOf, reachable, phaseAt, UNIT };
});
