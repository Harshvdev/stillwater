export const GRID = 72;
export const C = GRID / 2;

export const TL = {
  WATER: 0,
  SAND: 1,
  GRASS: 2,
  DIRT: 3
};

export const gi = (x, y) => y * GRID + x;
export const inB = (x, y) => x >= 0 && y >= 0 && x < GRID && y < GRID;

export const ET = {
  TREE: 1,
  STUMP: 2,
  FLOWER: 3,
  STONE: 4,
  MUSH: 5,
  PEBBLE: 6,
  RUIN: 7,
  REED: 8,
  GLOW: 9,
  DRIFTWOOD: 10,
  HERO_TREE: 11,
  FOX: 12,
  RABBIT: 13,
  PLAYER: 14
};

export const SEAS_TINT = [
  [1.02, 1.08, 0.97],
  [1.07, 1.04, 0.90],
  [1.15, 0.92, 0.72],
  [0.88, 0.95, 1.12]
];

export const seasonOf = (d) => Math.floor(d / 2.4) % 4;

export const PAL = [
  [[34, 102, 130], [26, 88, 116]],
  [[220, 206, 160], [210, 196, 150]],
  [[118, 162, 98], [110, 154, 92]],
  [[160, 125, 86], [152, 117, 78]]
];

export const FC = [
  'rgb(228,108,158)',
  'rgb(236,214,176)',
  'rgb(110,150,222)',
  'rgb(238,176,72)',
  'rgb(174,122,232)'
];

/* world-unit heights (proportionate to tiles regardless of HW) */
export const WH = {
  1: 34,
  2: 11,
  3: 11,
  4: 15,
  5: 10,
  6: 9,
  7: 17,
  8: 13,
  9: 11,
  10: 12,
  11: 46,
  12: 13,
  13: 10,
  14: 17
};
