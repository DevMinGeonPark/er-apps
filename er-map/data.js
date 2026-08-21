// Lumia Island as a diamond lattice.
// cells are [sx, sy] with (sx + sy) even; neighbours differ by (+-1, +-1).
// Derived by fitting the lattice to region anchors on the current in-game minimap
// (season with 바지선). Large edge regions occupy two cells.
var ER_AREAS = [
  { key: "Alley",         id:  70, name: "골목길",      cells: [[ 0,-4]] },
  { key: "Archery",       id: 140, name: "양궁장",      cells: [[-3,-3]] },
  { key: "GasStation",    id:  80, name: "주유소",      cells: [[-1,-3]] },
  { key: "PoliceStation", id: 100, name: "경찰서",      cells: [[ 1,-3]] },
  { key: "Temple",        id: 130, name: "절",          cells: [[ 3,-3],[ 2,-2]] },
  { key: "School",        id: 190, name: "학교",        cells: [[-2,-2]] },
  { key: "FireStation",   id: 110, name: "소방서",      cells: [[ 0,-2]] },
  { key: "Hotel",         id:  90, name: "호텔",        cells: [[-3,-1],[-2, 0]] },
  { key: "Pond",          id:  30, name: "연못",        cells: [[ 1,-1]] },
  { key: "Stream",        id:  40, name: "개울",        cells: [[ 3,-1],[ 2, 0]] },
  { key: "Laboratory",    id:1000, name: "연구소",      cells: [[ 0, 0],[-1,-1]] },
  { key: "SandyBeach",    id:  50, name: "모래사장",    cells: [[-3, 1]] },
  { key: "Forest",        id: 160, name: "숲",          cells: [[-1, 1]] },
  { key: "Cemetery",      id: 150, name: "묘지",        cells: [[ 1, 1]] },
  { key: "Hospital",      id: 120, name: "병원",        cells: [[ 3, 1]] },
  { key: "Uptown",        id:  60, name: "고급 주택가", cells: [[-2, 2]] },
  { key: "Church",        id: 180, name: "성당",        cells: [[ 0, 2]] },
  { key: "Factory",       id: 170, name: "공장",        cells: [[ 3, 3],[ 2, 2]] },
  { key: "Warehouse",     id:  20, name: "창고",        cells: [[-1, 3]] },
  { key: "Harbor",        id:  10, name: "항구",        cells: [[ 0, 4],[ 1, 3]] },
  { key: "Barge",         id: 200, name: "바지선",      cells: [[ 1, 5]] },
];

// ponytail: uniform hop cost. Real traversal differs per border (hyperloop, water,
// walls) — measure in game and put a per-edge table here if the estimates feel wrong.
var HOP_SECONDS = 7;

// Day/night schedule. Wildlife respawns on every phase flip, so the countdown to the
// next flip is the whole timer. Durations in seconds, verified against jyaniee/er-wildmap.
var GAME_CYCLE = [
  { day: 1, type: "day", duration: 140 }, { day: 1, type: "night", duration: 110 },
  { day: 2, type: "day", duration: 140 }, { day: 2, type: "night", duration: 130 },
  { day: 3, type: "day", duration: 130 }, { day: 3, type: "night", duration: 110 },
  { day: 4, type: "day", duration: 100 }, { day: 4, type: "night", duration: 110 },
  { day: 5, type: "day", duration:  80 }, { day: 5, type: "night", duration:  80 },
  { day: 6, type: "day", duration:  70 }, { day: 6, type: "night", duration:  50 },
  { day: 7, type: "day", duration: 200 }, { day: 7, type: "night", duration:  60 },
  { day: 8, type: "day", duration: 150 },
];

if (typeof module !== "undefined")
  module.exports = { ER_AREAS, HOP_SECONDS, GAME_CYCLE };
