(function(){
"use strict";

/* --- constants.js --- */
const GRID = 72;
const C = GRID / 2;
const TL = {
  WATER: 0,
  SAND: 1,
  GRASS: 2,
  DIRT: 3
};
const gi = (x, y) => y * GRID + x;
const inB = (x, y) => x >= 0 && y >= 0 && x < GRID && y < GRID;
const ET = {
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
const SEAS_TINT = [
  [1.02, 1.08, 0.97],
  [1.07, 1.04, 0.90],
  [1.15, 0.92, 0.72],
  [0.88, 0.95, 1.12]
];
const seasonOf = (d) => Math.floor(d / 2.4) % 4;
const PAL = [
  [[34, 102, 130], [26, 88, 116]],
  [[220, 206, 160], [210, 196, 150]],
  [[118, 162, 98], [110, 154, 92]],
  [[160, 125, 86], [152, 117, 78]]
];
const FC = [
  'rgb(228,108,158)',
  'rgb(236,214,176)',
  'rgb(110,150,222)',
  'rgb(238,176,72)',
  'rgb(174,122,232)'
];

/* world-unit heights (proportionate to tiles regardless of HW) */
const WH = {
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


/* --- math.js --- */
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const sm = (a, b, x) => {
  x = clamp((x - a) / (b - a), 0, 1);
  return x * x * (3 - 2 * x);
};
function h2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const a = h2(xi, yi), b = h2(xi + 1, yi), c = h2(xi, yi + 1), d = h2(xi + 1, yi + 1);
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y) {
  let v = 0, a = 0.5, f = 1;
  for (let i = 0; i < 4; i++) {
    v += a * vnoise(x * f, y * f);
    f *= 2.03;
    a *= 0.5;
  }
  return v;
}
function soft(x, cx, cy, rx, ry, col) {
  x.save();
  x.translate(cx, cy);
  x.scale(rx, ry);
  const g = x.createRadialGradient(0, 0, 0, 0, 0, 1);
  g.addColorStop(0, col);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g;
  x.beginPath();
  x.arc(0, 0, 1, 0, TAU);
  x.fill();
  x.restore();
}
function disc(x, cx, cy, r, col) {
  x.fillStyle = col;
  x.beginPath();
  x.arc(cx, cy, r, 0, TAU);
  x.fill();
}
const mix3 = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t
];
const rgb = (c) => 'rgb(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ')';
const rgba = (c, a) => 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + a + ')';
function tintInt(r, g, b) {
  return ((clamp(r, 0, 1) * 255 | 0) << 16) | ((clamp(g, 0, 1) * 255 | 0) << 8) | (clamp(b, 0, 1) * 255 | 0);
}

/* Isometric bounds state */
const ISO = {
  HW: 12,
  HH: 6,
  CANW: 1728,
  CANH: 960,
  OFFX: 864,
  OFFY: 60
};
function initIsoBounds(glctx) {
  const MAXTEX = (glctx && glctx.getParameter) ? glctx.getParameter(glctx.MAX_TEXTURE_SIZE) : 2048;
  const SAFE = Math.min(MAXTEX || 2048, 2048);
  let hw = clamp(Math.floor((SAFE - 48) / (2 * GRID)), 6, 16);
  if (hw % 2) hw--;
  hw = Math.max(6, hw);
  let hh = Math.max(3, Math.round(hw / 2));
  
  ISO.HW = hw;
  ISO.HH = hh;
  ISO.CANW = 2 * GRID * hw;
  ISO.CANH = 2 * GRID * hh + hh * 16;
  ISO.OFFX = ISO.CANW / 2;
  ISO.OFFY = hh * 10;
}
function iso(gx, gy) {
  return {
    x: (gx - gy) * ISO.HW + ISO.OFFX,
    y: (gx + gy) * ISO.HH + ISO.OFFY
  };
}


/* --- game-state.js --- */
function getMinZoom() {
  const reqW = window.innerWidth / (ISO.CANW || 1728);
  const reqH = window.innerHeight / (ISO.CANH || 960);
  return Math.max(1.05, Math.max(reqW, reqH) * 1.08);
}
const INITZ = Math.max(getMinZoom(), window.innerWidth < 760 ? 1.1 : 1.35);
const S = {
  seed: (Math.random() * 1e9) | 0,
  worldDay: 0.22
};
const view = {
  z: INITZ,
  zt: INITZ,
  cx: 0,
  cy: 0,
  tx: 0,
  ty: 0
};
const state = {
  gt: 0,
  daylight: 1,
  nightF: 0,
  dusk: 0,
  sTint: SEAS_TINT[0],
  curSeason: 0,
  rainAmt: 0,
  windAmt: 0.5,
  rainState: 0,
  rainT: 0,
  rainCd: 80 + Math.random() * 80,
  storm: 0,
  prevNight: 0,
  loaded: false,
  hoverEnt: null,
  lastSing: -9
};
const regrow = {};
const ripples = [];
const mouse = { x: -999, y: -999 };


/* --- shaders.js --- */
const GROUND_FRAG = `
precision highp float;
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform float u_day, u_dusk, u_golden;
uniform vec3 u_seas;

void main(){
 vec4 base = texture2D(uSampler, vTextureCoord);
 vec3 col = base.rgb;
 vec3 nightCol = col * vec3(0.24, 0.35, 0.62);
 col = mix(nightCol, col * vec3(1.04, 1.03, 0.96), u_day);
 vec3 goldenCol = col * vec3(1.42, 0.95, 0.62);
 col = mix(col, goldenCol, u_golden * 0.85);
 col = mix(col, col * vec3(1.28, 0.82, 0.68), u_dusk * 0.45);
 col *= u_seas;
 gl_FragColor = vec4(col, base.a);
}`;
function createGroundFilter() {
  return new PIXI.Filter(null, GROUND_FRAG, {
    u_day: 1,
    u_dusk: 0,
    u_golden: 0,
    u_seas: [1, 1, 1]
  });
}



/* --- whisper.js --- */
function $(s) { return document.querySelector(s); }
const AMB = [
  'the water keeps your name.',
  'somewhere, a seed dreams of you.',
  'time moves differently when you are not watching.',
  'what you tend here tends you.',
  'the wind was asking about you.',
  'even the stones are patient.',
  'this world breathes because you do.',
  'somewhere behind you, a flower opened.',
  'the sea forgets nothing, and forgives everything.'
];
const GATH = [
  'the tree rests now, a while.',
  'taken gently, given back in time.',
  'a small kindness to the ground.',
  'it lets go without a sound.'
];
const MEM = {
  tree: 'something patient begins.',
  flower: 'color is a kind of memory.',
  song: 'the world leans in to listen.',
  night: 'stay. the dark here is soft.',
  rain: 'even skies need to let go.',
  ruin: 'even broken things give shelter.',
  bond: 'something wary chose to stay.'
};
const memSet = {};

let wQ = [];
let wBusy = false;

function pump() {
  const wEl = $('#whisper');
  if (!wEl || wBusy || !wQ.length) return;
  wBusy = true;
  wEl.textContent = wQ.shift();
  wEl.classList.add('show');
  setTimeout(() => {
    wEl.classList.remove('show');
    setTimeout(() => {
      wBusy = false;
      pump();
    }, 1100);
  }, 4800);
}
function whisper(t) {
  wQ.push(t);
  pump();
}
function mem(id) {
  if (memSet[id]) return;
  memSet[id] = 1;
  if (MEM[id]) whisper(MEM[id]);
}
function setMemSet(loadedMem) {
  if (loadedMem) {
    Object.assign(memSet, loadedMem);
  }
}


/* --- sprites.js --- */




function paintSprite(nw, nh, fn) {
  const c = document.createElement('canvas');
  c.width = nw;
  c.height = nh;
  fn(c.getContext('2d'));
  return c;
}

function shd(x, cx, cy, rx, ry) {
  /* Static shadow removed - rendered dynamically by sun projection system */
}

function dFlower(x, col) {
  shd(x, 7, 12, 4.6, 2);
  x.strokeStyle = 'rgba(50,88,44,.92)';
  x.lineWidth = 1;
  x.beginPath();
  x.moveTo(7, 12);
  x.lineTo(7, 7);
  x.stroke();
  for (let p = 0; p < 5; p++) {
    const a = (p / 5) * TAU;
    soft(x, 7 + Math.cos(a) * 2.5, 6.5 + Math.sin(a) * 2.5, 1.9, 1.9, col);
  }
  disc(x, 7, 6.5, 1.1, 'rgb(210,172,88)');
}

function dGlow(x) {
  shd(x, 7, 12, 4.6, 2);
  x.strokeStyle = 'rgba(70,96,92,.8)';
  x.lineWidth = 1;
  x.beginPath();
  x.moveTo(7, 12);
  x.lineTo(7, 7);
  x.stroke();
  for (let p = 0; p < 6; p++) {
    const a = (p / 6) * TAU;
    soft(x, 7 + Math.cos(a) * 2.6, 6.5 + Math.sin(a) * 2.6, 2.1, 2.1, 'rgba(150,200,235,0.5)');
  }
  soft(x, 7, 6.5, 2, 2, 'rgba(220,240,255,0.55)');
}

function dTree(x, fol, hi, extra) {
  shd(x, 14, 28, 8.5, 3.6);
  x.fillStyle = 'rgb(88,60,40)';
  x.fillRect(12.4, 18, 3.2, 10);
  soft(x, 14, 12, 9.5, 8.5, rgb(fol));
  soft(x, 10, 8.5, 5.2, 4.8, rgb(hi));
  soft(x, 18.5, 15, 5, 4.6, rgba([12, 40, 22, 0.45], 1));
  soft(x, 13, 5, 3, 2.6, rgba([255, 255, 255, 0.16], 1));

  if (extra === 'blossom') {
    for (let i = 0; i < 7; i++) {
      const a = i * 1.7, hh = h2(i * 3.1, i * 1.3);
      soft(x, 9 + Math.cos(a) * 5 + hh * 2, 9 + Math.sin(a) * 4, 1.5, 1.5, 'rgba(255,210,226,0.85)');
    }
  } else if (extra === 'snow') {
    soft(x, 12, 6, 7, 3, 'rgba(244,248,255,0.92)');
    soft(x, 16, 9, 4, 2, 'rgba(244,248,255,0.8)');
  } else if (extra === 'autumn') {
    for (let i = 0; i < 5; i++) {
      const a = i * 2.1;
      soft(x, 11 + Math.cos(a) * 5, 11 + Math.sin(a) * 4, 1.4, 1.4, 'rgba(214,96,52,0.7)');
    }
  }
}

function dStump(x) {
  shd(x, 7, 12, 4.6, 2.2);
  disc(x, 7, 10, 3.6, 'rgb(124,90,60)');
  x.strokeStyle = 'rgb(156,120,82)';
  x.lineWidth = 1;
  x.beginPath();
  x.arc(7, 10, 2.2, 0, TAU);
  x.stroke();
}

function dStone(x) {
  shd(x, 8, 13, 6, 2.6);
  soft(x, 8, 9, 5.8, 4.8, 'rgb(150,156,164)');
  soft(x, 6, 7, 3.4, 3, 'rgb(182,188,195)');
  soft(x, 10, 11, 1.8, 1.4, 'rgba(78,86,96,.5)');
}

function dPebble(x) {
  shd(x, 7, 11, 3.4, 1.6);
  soft(x, 7, 9, 2.9, 2.3, 'rgb(166,172,178)');
}

function dMush(x, cap) {
  shd(x, 7, 12, 3.6, 1.7);
  disc(x, 7, 10, 1.8, 'rgb(228,218,198)');
  soft(x, 7, 7, 3.4, 2.9, rgb(cap));
  disc(x, 5.8, 6, 0.7, 'rgba(255,245,230,.85)');
  disc(x, 8.2, 7.4, 0.6, 'rgba(255,245,230,.85)');
}

function dReed(x) {
  shd(x, 7, 12, 3.6, 1.5);
  x.strokeStyle = 'rgb(86,128,71)';
  x.lineWidth = 1.1;
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU;
    x.beginPath();
    x.moveTo(7, 10);
    x.lineTo(7 + Math.cos(a) * 4, 6.5 + Math.sin(a) * 3.2);
    x.stroke();
  }
  soft(x, 7, 7, 1.5, 1.5, 'rgb(140,180,108)');
}

function dRuin(ctx) {
  shd(ctx, 8, 14, 6.5, 2.6);

  // Left Face (dark shade)
  ctx.fillStyle = 'rgb(108,114,124)';
  ctx.beginPath();
  ctx.moveTo(8, 4);
  ctx.lineTo(3, 7);
  ctx.lineTo(3, 13);
  ctx.lineTo(8, 15);
  ctx.closePath();
  ctx.fill();

  // Right Face (medium shade)
  ctx.fillStyle = 'rgb(140,146,158)';
  ctx.beginPath();
  ctx.moveTo(8, 4);
  ctx.lineTo(13, 7);
  ctx.lineTo(13, 13);
  ctx.lineTo(8, 15);
  ctx.closePath();
  ctx.fill();

  // Top Face (sunlit top facet)
  ctx.fillStyle = 'rgb(182,188,198)';
  ctx.beginPath();
  ctx.moveTo(8, 1);
  ctx.lineTo(13, 4);
  ctx.lineTo(8, 7);
  ctx.lineTo(3, 4);
  ctx.closePath();
  ctx.fill();

  // Edge crease & ancient crack detail
  ctx.strokeStyle = 'rgba(54,58,66,0.75)';
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(8, 4);
  ctx.lineTo(8, 15);
  ctx.moveTo(8, 4);
  ctx.lineTo(6, 8);
  ctx.lineTo(9, 12);
  ctx.stroke();

  // Moss accretion at base
  soft(ctx, 5, 13, 2.4, 1.5, 'rgba(92,148,76,0.7)');
  soft(ctx, 11, 13.5, 2.0, 1.3, 'rgba(80,134,66,0.6)');
}

function dPlayer(x, walk, gt = 0) {
  shd(x, 7, 15, 4.8, 2.3);
  const b = walk ? Math.sin(walk * 11) * 0.9 : Math.sin(gt * 1.4) * 0.25;
  soft(x, 7, 10 + b, 4.8, 5.8, 'rgb(74,86,118)');
  soft(x, 7, 11 + b, 3.3, 3.9, 'rgb(100,114,146)');
  soft(x, 7, 5 + b, 3.1, 3.1, 'rgb(226,208,184)');
  soft(x, 6.3, 4.4 + b, 1.5, 1.5, 'rgb(66,50,38)');
  if (walk) {
    const lo = Math.sin(walk * 11) * 1.4;
    disc(x, 5.6, 14 + lo, 1, 'rgb(50,42,36)');
    disc(x, 8.4, 14 - lo, 1, 'rgb(50,42,36)');
  }
}

function dFox(x, walk) {
  shd(x, 11, 14, 8, 2.6);
  const B = 'rgb(198,108,62)', L = 'rgb(234,202,170)', D = 'rgb(62,36,24)';
  soft(x, 11, 9, 6.8, 4.3, B);
  soft(x, 12, 10, 4, 2.5, L);
  soft(x, 17, 7, 3.6, 3.3, B);
  x.fillStyle = B;
  x.beginPath();
  x.moveTo(15.4, 3.6);
  x.lineTo(17, 7);
  x.lineTo(18.6, 3.6);
  x.fill();
  x.beginPath();
  x.moveTo(18, 3.6);
  x.lineTo(19.6, 7);
  x.lineTo(21.2, 3.6);
  x.fill();
  soft(x, 3.6, 8, 3.6, 2.1, B);
  soft(x, 2, 8, 1.6, 1.4, 'rgb(234,222,202)');
  disc(x, 18, 6.3, 0.9, D);
  if (walk) {
    const lo = Math.sin(walk * 9) * 1.2;
    disc(x, 8, 13 + lo, 1, D);
    disc(x, 14, 13 - lo, 1, D);
  } else {
    disc(x, 8, 13, 1, D);
    disc(x, 14, 13, 1, D);
  }
}

function dRabbit(x) {
  shd(x, 8, 12, 4.8, 1.9);
  soft(x, 8, 8, 3.9, 3.3, 'rgb(198,188,174)');
  soft(x, 12, 7, 2.5, 2.3, 'rgb(214,206,194)');
  x.fillStyle = 'rgb(198,188,174)';
  x.fillRect(6, 1.6, 1.6, 4.2);
  x.fillRect(8.6, 1.6, 1.6, 4.2);
  disc(x, 3.8, 9, 1.6, 'rgb(222,214,202)');
  disc(x, 12.4, 6.6, 0.75, 'rgb(66,46,36)');
}

function dDriftwood(x) {
  shd(x, 10, 12, 7.5, 2.2);
  soft(x, 10, 9.5, 7.2, 2.8, 'rgb(148,132,112)');
  soft(x, 9, 8.5, 5.5, 2.0, 'rgb(178,162,140)');
  soft(x, 14, 9, 2.2, 1.6, 'rgb(120,105,88)');
  x.strokeStyle = 'rgba(88,72,56,0.6)';
  x.lineWidth = 1;
  x.beginPath();
  x.moveTo(4, 9.5);
  x.lineTo(15, 9);
  x.moveTo(6, 8.2);
  x.lineTo(12, 8.0);
  x.stroke();
  disc(x, 11, 8.8, 0.8, 'rgb(95,80,64)');
}

function dHeroTree(x, fol, hi, extra) {
  // Single, solid, majestic trunk
  x.fillStyle = 'rgb(76,52,34)';
  x.beginPath();
  x.moveTo(13, 42); // left root flare
  x.lineTo(15.5, 20); // left top near canopy
  x.lineTo(20.5, 20); // right top near canopy
  x.lineTo(23, 42); // right root flare
  x.closePath();
  x.fill();

  // Root flares & bark texture shading
  soft(x, 13.5, 41.5, 3.2, 1.8, 'rgb(58,38,22)');
  soft(x, 22.5, 41.5, 3.2, 1.8, 'rgb(58,38,22)');
  soft(x, 17, 30, 2.2, 9, 'rgb(98,72,48)');

  // Main grand canopy layers
  soft(x, 18, 17, 15.5, 13.5, rgb(fol));
  soft(x, 12, 13, 8.5, 7.8, rgb(hi));
  soft(x, 24, 14, 8, 7.5, rgb(hi));
  soft(x, 18, 8.5, 7.5, 6.5, rgba([255, 255, 255, 0.22], 1));
  soft(x, 23, 22, 7.5, 6.8, rgba([10, 36, 18, 0.5], 1));

  if (extra === 'blossom') {
    for (let i = 0; i < 11; i++) {
      const a = i * 1.5, hh = h2(i * 4.1, i * 2.3);
      soft(x, 12 + Math.cos(a) * 8 + hh * 3, 13 + Math.sin(a) * 6, 2.0, 2.0, 'rgba(255,215,230,0.9)');
    }
  } else if (extra === 'snow') {
    soft(x, 16, 8, 10, 4.2, 'rgba(244,248,255,0.95)');
    soft(x, 22, 12, 6, 3, 'rgba(244,248,255,0.85)');
  } else if (extra === 'autumn') {
    for (let i = 0; i < 9; i++) {
      const a = i * 1.9;
      soft(x, 15 + Math.cos(a) * 8, 15 + Math.sin(a) * 6, 2.1, 2.1, 'rgba(224,106,58,0.75)');
    }
  }
}

function dDot(x) {
  soft(x, 4, 4, 3.6, 3.6, 'rgb(255,255,255)');
}
const CV = {};
const TEX = {};
function buildSprites() {
  CV.tree0 = paintSprite(28, 32, (x) => dTree(x, [82, 140, 92], [150, 200, 140], 'blossom'));
  CV.tree1 = paintSprite(28, 32, (x) => dTree(x, [78, 146, 82], [150, 206, 138], null));
  CV.tree2 = paintSprite(28, 32, (x) => dTree(x, [186, 128, 64], [224, 176, 110], 'autumn'));
  CV.tree3 = paintSprite(28, 32, (x) => dTree(x, [120, 134, 142], [176, 188, 196], 'snow'));
  CV.heroTree0 = paintSprite(36, 44, (x) => dHeroTree(x, [82, 140, 92], [150, 200, 140], 'blossom'));
  CV.heroTree1 = paintSprite(36, 44, (x) => dHeroTree(x, [78, 146, 82], [150, 206, 138], null));
  CV.heroTree2 = paintSprite(36, 44, (x) => dHeroTree(x, [186, 128, 64], [224, 176, 110], 'autumn'));
  CV.heroTree3 = paintSprite(36, 44, (x) => dHeroTree(x, [120, 134, 142], [176, 188, 196], 'snow'));
  CV.driftwood = paintSprite(20, 14, dDriftwood);
  for (let c = 0; c < 5; c++) CV['flower' + c] = paintSprite(14, 14, (x) => dFlower(x, FC[c]));
  CV.glow = paintSprite(14, 14, dGlow);
  CV.stump = paintSprite(14, 14, dStump);
  CV.stone = paintSprite(16, 16, dStone);
  CV.pebble = paintSprite(14, 14, dPebble);
  CV.mush0 = paintSprite(14, 14, (x) => dMush(x, [209, 109, 84]));
  CV.mush1 = paintSprite(14, 14, (x) => dMush(x, [113, 176, 160]));
  CV.reed = paintSprite(14, 14, dReed);
  CV.ruin = paintSprite(16, 16, dRuin);
  CV.player = paintSprite(14, 16, (x) => dPlayer(x, 0));
  CV.playerW = paintSprite(14, 16, (x) => dPlayer(x, 1));
  CV.fox = paintSprite(22, 16, (x) => dFox(x, 0));
  CV.foxW = paintSprite(22, 16, (x) => dFox(x, 1));
  CV.rabbit = paintSprite(16, 14, dRabbit);
  CV.dot = paintSprite(8, 8, dDot);
}
function buildTextures() {
  for (const k in CV) {
    TEX[k] = PIXI.Texture.from(CV[k], { scaleMode: PIXI.SCALE_MODES.LINEAR, resolution: 1 });
  }
}
function texFor(e, curSeasonIdx = state.curSeason) {
  switch (e.t) {
    case ET.TREE:
      return TEX['tree' + curSeasonIdx];
    case ET.HERO_TREE:
      return TEX['heroTree' + curSeasonIdx];
    case ET.DRIFTWOOD:
      return TEX.driftwood;
    case ET.FLOWER:
      return TEX['flower' + ((e.data.c || 0) % 5)];
    case ET.GLOW:
      return TEX.glow;
    case ET.STUMP:
      return TEX.stump;
    case ET.STONE:
      return TEX.stone;
    case ET.PEBBLE:
      return TEX.pebble;
    case ET.MUSH:
      return TEX['mush' + ((e.data.v || 0) % 2)];
    case ET.REED:
      return TEX.reed;
    case ET.RUIN:
      return TEX.ruin;
    case ET.FOX:
      return TEX.fox;
    case ET.RABBIT:
      return TEX.rabbit;
    case ET.PLAYER:
      return TEX.player;
  }
  return TEX.dot;
}


/* --- player.js --- */
let playerCanvas = null;
let playerCtx = null;
let playerTexture = null;

// Player Character Animation & Eye State
const pState = {
  // Facing & Movement
  faceX: 0,
  faceY: 0,
  targetFaceX: 0,
  targetFaceY: 0,
  lastFacingX: 0,
  lastFacingY: 1.5, // Default gentle forward facing

  // Looking around (Idle & wandering glances)
  gazeTimer: 2.0,
  gazeX: 0,
  gazeY: 0,
  targetGazeX: 0,
  targetGazeY: 0,

  // Blinking logic
  blinkTimer: 2.8,
  isBlinking: false,
  blinkProgress: 0,
  blinkDuration: 0.14,
  doubleBlinkPending: false,

  // Motion & Expression
  walkTimer: 0,
  idleTimer: 0,
  bounceY: 0,
  squashX: 1,
  squashY: 1
};
function initPlayerCharacter() {
  playerCanvas = document.createElement('canvas');
  playerCanvas.width = 64;
  playerCanvas.height = 64;
  playerCtx = playerCanvas.getContext('2d');

  playerTexture = PIXI.Texture.from(playerCanvas, {
    scaleMode: PIXI.SCALE_MODES.LINEAR,
    resolution: 1
  });

  TEX.player = playerTexture;
  TEX.playerW = playerTexture;

  drawPlayerCanvas();
}
function updatePlayerCharacter(dt) {
  if (!player) return;

  const vx = player.data ? player.data.vx || 0 : 0;
  const vy = player.data ? player.data.vy || 0 : 0;
  const sp = Math.hypot(vx, vy);

  // 1. Facing Direction based on movement direction (NO mouse tracking)
  // Convert grid movement (vx, vy) to isometric screen direction:
  // Screen X: vx - vy
  // Screen Y: (vx + vy) * 0.5
  if (sp > 0.15) {
    const screenDx = vx - vy;
    const screenDy = (vx + vy) * 0.5;
    const len = Math.hypot(screenDx, screenDy) || 1;

    // Shift eyes on sphere (max shift: ~5.5px horizontally, ~3.5px vertically)
    pState.targetFaceX = (screenDx / len) * 5.5;
    pState.targetFaceY = (screenDy / len) * 3.5;
    pState.lastFacingX = pState.targetFaceX;
    pState.lastFacingY = pState.targetFaceY;
  } else {
    // When stationary, keep last walked facing direction
    pState.targetFaceX = pState.lastFacingX;
    pState.targetFaceY = pState.lastFacingY;
  }

  // Smooth lerp facing direction
  pState.faceX += (pState.targetFaceX - pState.faceX) * Math.min(1, dt * 10);
  pState.faceY += (pState.targetFaceY - pState.faceY) * Math.min(1, dt * 10);

  // 2. Looking around ("look here and there sometimes")
  pState.gazeTimer -= dt;
  if (pState.gazeTimer <= 0) {
    pState.gazeTimer = 1.6 + Math.random() * 2.8;

    // Random glance offset relative to facing direction
    if (Math.random() < 0.35) {
      pState.targetGazeX = 0;
      pState.targetGazeY = 0;
    } else {
      pState.targetGazeX = (Math.random() - 0.5) * 3.6;
      pState.targetGazeY = (Math.random() - 0.5) * 2.4;
    }
  }

  // Smooth lerp glance
  pState.gazeX += (pState.targetGazeX - pState.gazeX) * Math.min(1, dt * 8);
  pState.gazeY += (pState.targetGazeY - pState.gazeY) * Math.min(1, dt * 8);

  // 3. Blinking logic
  if (pState.isBlinking) {
    pState.blinkProgress += dt / pState.blinkDuration;
    if (pState.blinkProgress >= 1) {
      pState.blinkProgress = 0;
      pState.isBlinking = false;

      if (pState.doubleBlinkPending) {
        pState.doubleBlinkPending = false;
        pState.blinkTimer = 0.08; // Quick second blink
      } else {
        pState.blinkTimer = 2.2 + Math.random() * 3.8;
      }
    }
  } else {
    pState.blinkTimer -= dt;
    if (pState.blinkTimer <= 0) {
      pState.isBlinking = true;
      pState.blinkProgress = 0;
      pState.blinkDuration = 0.12 + Math.random() * 0.04;
      pState.doubleBlinkPending = Math.random() < 0.25;
    }
  }

  // 4. Motion / Walk / Idle Animations
  if (sp > 0.2) {
    pState.walkTimer += dt * sp * 4.5;
    pState.bounceY = Math.abs(Math.sin(pState.walkTimer)) * -2.2;
    pState.squashX = 1 + Math.sin(pState.walkTimer * 2) * 0.04;
    pState.squashY = 1 - Math.sin(pState.walkTimer * 2) * 0.04;
  } else {
    pState.idleTimer += dt * 2.0;
    pState.bounceY = Math.sin(pState.idleTimer) * 0.7;
    pState.squashX = 1;
    pState.squashY = 1;
  }

  drawPlayerCanvas();
  if (playerTexture) {
    playerTexture.update();
  }
}
function drawPlayerCanvas() {
  if (!playerCtx) return;
  const ctx = playerCtx;
  ctx.clearRect(0, 0, 64, 64);

  const cx = 32;
  const cy = 40 + pState.bounceY;
  const radius = 16;

  // --- 1. Soft Ground Shadow ---
  ctx.save();
  ctx.fillStyle = 'rgba(12, 20, 16, 0.28)';
  ctx.beginPath();
  ctx.ellipse(32, 57, 14 * pState.squashX, 4.5 * pState.squashY, 0, 0, TAU);
  ctx.fill();
  ctx.restore();

  // --- 2. Cute Warm Body Sphere (Soft Butter-Cream / Warm Honey-Ivory) ---
  ctx.save();

  // Apply squash & stretch around sphere center
  ctx.translate(cx, cy);
  ctx.scale(pState.squashX, pState.squashY);
  ctx.translate(-cx, -cy);

  // Radial gradient for warm, adorable cozy body
  const grad = ctx.createRadialGradient(
    cx - radius * 0.35,
    cy - radius * 0.35,
    1,
    cx,
    cy,
    radius
  );
  grad.addColorStop(0, '#fffaf0');    // Soft warm highlight
  grad.addColorStop(0.40, '#f9edd6');  // Cute butter-cream main body
  grad.addColorStop(0.78, '#e6d0a7');  // Warm soft shadow transition
  grad.addColorStop(1.0, '#cfb383');   // Soft ambient rim shadow

  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, TAU);
  ctx.fill();

  // Soft warm inner rim definition
  ctx.strokeStyle = 'rgba(180, 150, 110, 0.22)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // --- 3. Eyes Rendering (Solid, Thick, Simple Vertical Rectangles, No Sclera Illusion) ---
  const totalOffsetX = clamp(pState.faceX + pState.gazeX, -9, 9);
  const totalOffsetY = clamp(pState.faceY + pState.gazeY, -6, 5);

  // 3D sphere back-facing check:
  // When character moves/faces upward (totalOffsetY < -0.8), face turns to the back of the sphere
  let faceAlpha = 1.0;
  if (totalOffsetY < -0.8) {
    faceAlpha = clamp(1.0 - (-0.8 - totalOffsetY) / 1.4, 0, 1);
  }

  if (faceAlpha <= 0.01) {
    ctx.restore();
    return;
  }

  ctx.globalAlpha = faceAlpha;

  const isSinging = typeof state !== 'undefined' && state && (state.gt - state.lastSing < 1.8);

  const baseEyeDist = 5.8; // Distance apart
  const baseEyeW = 3.8;   // Thick solid vertical rectangle
  const baseEyeH = 7.0;   // Vertically elongated
  const cornerRadius = 1.2; // Slightly rounded rectangle

  // Blinking factor (1 -> 0 -> 1)
  let eyeHFactor = 1;
  if (pState.isBlinking) {
    const b = Math.sin(pState.blinkProgress * Math.PI);
    eyeHFactor = Math.max(0.08, 1 - b);
  }

  const faceCenterY = cy + 0.5 + totalOffsetY; // Cute low eye placement

  // Solid, clean dark charcoal color with zero shadow blur (no sclera illusion!)
  ctx.fillStyle = '#1a1715';
  ctx.strokeStyle = '#1a1715';

  for (let side of [-1, 1]) {
    const eyeRelX = totalOffsetX + side * baseEyeDist;
    const eyeX = cx + eyeRelX;
    const eyeY = faceCenterY;

    // 3D Sphere foreshortening factor z
    const normX = eyeRelX / radius;
    const z = Math.sqrt(Math.max(0, 1 - normX * normX));

    if (z < 0.15) continue; // Hidden behind sphere curvature

    const eyeW = Math.max(1.4, baseEyeW * z);

    if (isSinging) {
      // Singing expression: Happy squints ^ ^
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      const arcR = 3.0 * z;
      ctx.arc(eyeX, eyeY + 1, arcR, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
    } else if (eyeHFactor < 0.28) {
      // Closed / Blinking eye (solid line)
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(eyeX - eyeW * 0.6, eyeY);
      ctx.lineTo(eyeX + eyeW * 0.6, eyeY);
      ctx.stroke();
    } else {
      // Solid, thick, vertical, rectangular eyes (no shadow blur, clean edges)
      const currentEyeH = baseEyeH * eyeHFactor;
      const rx = eyeW * 0.5;
      const ry = currentEyeH * 0.5;
      const r = Math.min(cornerRadius, rx, ry);

      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(eyeX - rx, eyeY - ry, eyeW, currentEyeH, [r]);
      } else {
        ctx.save();
        ctx.translate(eyeX, eyeY);
        ctx.scale(rx, ry);
        ctx.arc(0, 0, 1, 0, TAU);
        ctx.restore();
      }
      ctx.fill();
    }
  }

  ctx.restore();
}
function getPlayerTexture() {
  return playerTexture;
}


/* --- world.js --- */
let tiles = new Uint8Array(GRID * GRID);
let entities = [];
let player = null;
function setTiles(newTiles) {
  tiles = newTiles;
}
function setEntities(newEnts) {
  entities = newEnts;
}
function setPlayer(p) {
  player = p;
}
function genWorld() {
  // 1. Terrain Pass (Landmass, Shoreline Notch for East Glint, Inland Pond)
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const dx = (x - C) / (GRID * 0.46);
      const dy = (y - C) / (GRID * 0.46);
      const dist = Math.sqrt(dx * dx + dy * dy);

      // East shore notch: brings shoreline close to C on UP-RIGHT screen (increasing x, decreasing y)
      const eastShoreDist = Math.hypot((x - (C + 14)) / 5, (y - (C - 6)) / 8);
      const eastShoreNotch = Math.exp(-eastShoreDist * eastShoreDist) * 0.36;

      let e = fbm(x * 0.045 + 7.3, y * 0.045 + 3.1) * 0.65 + (1 - dist) * 0.65 - eastShoreNotch - 0.16;

      // Inland Serene Pond at NW (x = C - 14, y = C - 14)
      const pdx = (x - (C - 14)) / 4.0;
      const pdy = (y - (C - 14)) / 3.0;
      const pondDist = Math.sqrt(pdx * pdx + pdy * pdy);
      if (pondDist < 1.0) {
        e = 0.32; // Inland water
      } else if (pondDist < 1.4) {
        e = 0.44; // Pond beach sand
      }

      let t;
      if (e < 0.40) t = TL.WATER;
      else if (e < 0.47) t = TL.SAND;
      else t = TL.GRASS;
      tiles[gi(x, y)] = t;
    }
  }

  // Ensure coastal sand transition along water edges
  for (let y = 1; y < GRID - 1; y++) {
    for (let x = 1; x < GRID - 1; x++) {
      const idx = gi(x, y);
      if (tiles[idx] === TL.GRASS) {
        let hasWater = false;
        for (let oy = -1; oy <= 1 && !hasWater; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            if (tiles[gi(x + ox, y + oy)] === TL.WATER) hasWater = true;
          }
        }
        if (hasWater) tiles[idx] = TL.SAND;
      }
    }
  }

  // Force Spawn Clearing (radius 7 around C, C) to be 100% pure GRASS
  for (let y = C - 7; y <= C + 7; y++) {
    for (let x = C - 7; x <= C + 7; x++) {
      if (inB(x, y) && Math.hypot(x - C, y - C) <= 7.5) {
        tiles[gi(x, y)] = TL.GRASS;
      }
    }
  }

  // 2. Authored Feature Dirt Floor Masks
  // Thicket centers (with dark dirt under canopy)
  const thickets = [
    { cx: C - 9, cy: C + 6, r: 7 },   // Down-Left Framing Grove
    { cx: C + 16, cy: C + 12, r: 8 }, // Down-Right Deep Forest
    { cx: C - 15, cy: C - 10, r: 8 }  // Up-Left Woods
  ];

  // Rocky Outcrop centers
  const rocks = [
    { cx: C + 8, cy: C - 16, r: 6 },  // Up-Right Ridge
    { cx: C - 18, cy: C + 2, r: 6 }   // Far West Crag
  ];

  // Flower Meadow center (hard edge, placed down-right distantly)
  const meadow = { cx: C + 12, cy: C + 14, r: 6.5 };

  for (let y = 1; y < GRID - 1; y++) {
    for (let x = 1; x < GRID - 1; x++) {
      const idx = gi(x, y);
      if (tiles[idx] !== TL.GRASS) continue;

      // Keep spawn clearing clean
      if (Math.hypot(x - C, y - C) <= 7.5) continue;

      // Thicket dirt interior
      for (const th of thickets) {
        const d = Math.hypot(x - th.cx, y - th.cy);
        if (d < th.r * 0.65 && h2(x * 2.7, y * 3.1) < 0.85) {
          tiles[idx] = TL.DIRT;
        }
      }
      // Rocky outcrop dirt paths
      for (const rk of rocks) {
        const d = Math.hypot(x - rk.cx, y - rk.cy);
        if (d < rk.r && h2(x * 1.9, y * 2.3) < 0.7) {
          tiles[idx] = TL.DIRT;
        }
      }
    }
  }

  entities = [];

  const placed = new Set();
  const canPlace = (tx, ty) => {
    if (!inB(tx, ty)) return false;
    const k = tx + ',' + ty;
    if (placed.has(k)) return false;
    // Strictly keep spawn clearing (radius 6 around C, C) empty for breathing room
    if (Math.hypot(tx - C, ty - C) < 6.2) return false;
    return true;
  };
  const put = (e) => {
    const tx = Math.floor(e.x), ty = Math.floor(e.y);
    placed.add(tx + ',' + ty);
    entities.push(e);
  };

  // 3. Populate Authored Feature Clusters

  // A. Forest Thickets (Trees, Shaded Dirt, Mushrooms inside)
  for (let y = 1; y < GRID - 1; y++) {
    for (let x = 1; x < GRID - 1; x++) {
      if (!canPlace(x, y)) continue;
      const t = tiles[gi(x, y)];
      if (t !== TL.GRASS && t !== TL.DIRT) continue;

      for (const th of thickets) {
        const d = Math.hypot(x - th.cx, y - th.cy);
        if (d < th.r) {
          const edgeF = 1 - d / th.r;
          const rnd = h2(x * 4.1 + 13, y * 3.9 + 7);
          if (rnd < edgeF * 0.88) {
            put({ t: ET.TREE, x: x + 0.5, y: y + 0.5, ly: 4, data: { v: (rnd * 4) | 0 } });
          } else if (rnd > 0.85 && d < th.r * 0.65) {
            put({ t: ET.MUSH, x: x + 0.5, y: y + 0.5, ly: 0, data: { v: (rnd * 2) | 0 } });
          }
        }
      }
    }
  }

  // B. Flower Meadow (Dense multi-colored flowers with sharp, hard edge)
  for (let y = 1; y < GRID - 1; y++) {
    for (let x = 1; x < GRID - 1; x++) {
      if (!canPlace(x, y)) continue;
      if (tiles[gi(x, y)] !== TL.GRASS) continue;

      const d = Math.hypot(x - meadow.cx, y - meadow.cy);
      if (d <= meadow.r) {
        const rnd = h2(x * 5.3 + 9, y * 4.7 + 11);
        if (rnd < 0.70) {
          const col = ((h2(x + 17, y + 23) * 5) | 0);
          put({ t: ET.FLOWER, x: x + 0.5, y: y + 0.5, ly: 0, data: { c: col, moist: 1 } });
        }
      }
    }
  }

  // C. Rocky Outcrops
  for (const rk of rocks) {
    for (let y = Math.floor(rk.cy - rk.r); y <= Math.ceil(rk.cy + rk.r); y++) {
      for (let x = Math.floor(rk.cx - rk.r); x <= Math.ceil(rk.cx + rk.r); x++) {
        if (!canPlace(x, y)) continue;
        const t = tiles[gi(x, y)];
        if (t !== TL.GRASS && t !== TL.DIRT) continue;
        const d = Math.hypot(x - rk.cx, y - rk.cy);
        if (d <= rk.r) {
          const rnd = h2(x * 3.3 + 2.1, y * 3.3 + 5.7);
          if (rnd > 0.70) {
            put({ t: ET.STONE, x: x + 0.5, y: y + 0.5, ly: 4, data: {} });
          } else if (rnd < 0.14 && d < 3.5) {
            put({ t: ET.RUIN, x: x + 0.5, y: y + 0.5, ly: 4, data: {} });
          }
        }
      }
    }
  }

  // D. Beach with Driftwood & Reeds
  for (let y = 1; y < GRID - 1; y++) {
    for (let x = 1; x < GRID - 1; x++) {
      if (!canPlace(x, y)) continue;
      const t = tiles[gi(x, y)];
      if (t === TL.SAND) {
        let nearWater = false;
        for (let oy = -1; oy <= 1 && !nearWater; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            if (inB(x + ox, y + oy) && tiles[gi(x + ox, y + oy)] === TL.WATER) {
              nearWater = true;
            }
          }
        }
        const rnd = h2(x * 2.9 + 17, y * 3.1 + 3);
        if (nearWater && rnd > 0.75) {
          put({ t: ET.REED, x: x + 0.5, y: y + 0.5, ly: 0, data: {} });
        } else if (rnd > 0.93) {
          put({ t: ET.DRIFTWOOD, x: x + 0.5, y: y + 0.5, ly: 0, data: {} });
        }
      }
    }
  }

  // 4. Composed Starting View Postcard Setup around Spawn (C, C)
  // Ensure strict radius 5.5 is clear of any entities
  entities = entities.filter((e) => Math.hypot(e.x - C, e.y - C) > 5.5);

  // A. Hero Tree framing top-left of spawn clearing
  put({ t: ET.HERO_TREE, x: C - 4.5, y: C - 3.5, ly: 4, data: {} });

  // B. Knot of Glow-Flowers waiting for night framing bottom-left of hero tree
  put({ t: ET.GLOW, x: C - 4.5, y: C + 3.5, ly: 0, data: {} });
  put({ t: ET.GLOW, x: C - 3.5, y: C + 4.2, ly: 0, data: {} });
  put({ t: ET.GLOW, x: C - 5.5, y: C + 3.8, ly: 0, data: {} });

  // C. Subtle accent flower & stone at clearing margins
  put({ t: ET.FLOWER, x: C + 4.5, y: C + 4.5, ly: 0, data: { c: 0, moist: 1 } });
  put({ t: ET.STONE, x: C + 5.5, y: C - 4.5, ly: 4, data: {} });

  // D. Fauna framing the scene
  put({ t: ET.FOX, x: C - 7.5, y: C + 3.5, ly: 6, data: { trust: 0, state: 'wary', home: [C - 7.5, C + 3.5], wt: 0, dir: 0 } });
  put({ t: ET.RABBIT, x: C + 4.5, y: C - 2.5, ly: 6, data: { wt: 0, dir: Math.random() * Math.PI * 2, mv: 0 } });
  put({ t: ET.RABBIT, x: C - 2.5, y: C + 5.5, ly: 6, data: { wt: 0, dir: Math.random() * Math.PI * 2, mv: 0 } });

  // E. Player placed cleanly at center spawn clearing
  player = { t: ET.PLAYER, x: C + 0.5, y: C + 0.5, ly: 7, data: { vx: 0, vy: 0, walk: 0, flip: 0 } };
  put(player);
}
const mapCv = document.createElement('canvas');
function paintGround() {
  mapCv.width = ISO.CANW;
  mapCv.height = ISO.CANH;
  const mctx = mapCv.getContext('2d');
  const w = ISO.CANW;
  const h = ISO.CANH;
  const imgData = mctx.createImageData(w, h);
  const data = imgData.data;

  const deepOcean = [16, 42, 64];
  const getT = (tx, ty) => (inB(tx, ty) ? tiles[gi(tx, ty)] : TL.WATER);

  for (let py = 0; py < h; py++) {
    const dy = (py - ISO.OFFY) / ISO.HH;
    for (let px = 0; px < w; px++) {
      const dx = (px - ISO.OFFX) / ISO.HW;
      const gx = (dy + dx) * 0.5;
      const gy = (dy - dx) * 0.5;

      const pIdx = (py * w + px) * 4;

      const cdx = (gx - C) / (GRID * 0.48);
      const cdy = (gy - C) / (GRID * 0.48);
      const distFromC = Math.sqrt(cdx * cdx + cdy * cdy);

      if (gx < -2 || gy < -2 || gx > GRID + 2 || gy > GRID + 2 || distFromC > 1.25) {
        data[pIdx] = deepOcean[0];
        data[pIdx + 1] = deepOcean[1];
        data[pIdx + 2] = deepOcean[2];
        data[pIdx + 3] = 255;
        continue;
      }

      const n1 = vnoise(gx * 0.16 + 7.1, gy * 0.16 + 2.3);
      const n2 = vnoise(gx * 0.16 + 3.8, gy * 0.16 + 8.4);
      const wx = gx + (n1 - 0.5) * 1.6;
      const wy = gy + (n2 - 0.5) * 1.6;

      const x0 = Math.floor(wx);
      const y0 = Math.floor(wy);
      const x1 = x0 + 1;
      const y1 = y0 + 1;

      const fx = wx - x0;
      const fy = wy - y0;

      const u = fx * fx * (3 - 2 * fx);
      const v = fy * fy * (3 - 2 * fy);

      const t00 = getT(x0, y0);
      const t10 = getT(x1, y0);
      const t01 = getT(x0, y1);
      const t11 = getT(x1, y1);

      const w00 = (1 - u) * (1 - v);
      const w10 = u * (1 - v);
      const w01 = (1 - u) * v;
      const w11 = u * v;

      let rAcc = 0, gAcc = 0, bAcc = 0;
      let waterWeight = 0;

      const corners = [
        { t: t00, x: x0, y: y0, w: w00 },
        { t: t10, x: x1, y: y0, w: w10 },
        { t: t01, x: x0, y: y1, w: w01 },
        { t: t11, x: x1, y: y1, w: w11 }
      ];

      for (let i = 0; i < 4; i++) {
        const c = corners[i];
        if (c.w <= 0) continue;
        const hh = h2(c.x * 1.3 + 0.7, c.y * 1.3 + 0.3);
        let col = mix3(PAL[c.t][0], PAL[c.t][1], hh);

        if (c.t === TL.GRASS) {
          const varN = fbm(wx * 0.4 + 1.2, wy * 0.4 + 9.5);
          col = [col[0] + (varN - 0.5) * 14, col[1] + (varN - 0.5) * 18, col[2] + (varN - 0.5) * 12];
        } else if (c.t === TL.DIRT) {
          const varN = fbm(wx * 0.5 + 3.4, wy * 0.5 + 4.1);
          col = [col[0] + (varN - 0.5) * 12, col[1] + (varN - 0.5) * 10, col[2] + (varN - 0.5) * 8];
        } else if (c.t === TL.SAND) {
          const varN = fbm(wx * 0.6, wy * 0.6);
          col = [col[0] + (varN - 0.5) * 10, col[1] + (varN - 0.5) * 10, col[2] + (varN - 0.5) * 8];
        } else if (c.t === TL.WATER) {
          waterWeight += c.w;
          const varN = fbm(wx * 0.2 + 5.0, wy * 0.2 + 2.0);
          col = mix3([22, 78, 106], [38, 114, 136], varN);
        }

        rAcc += col[0] * c.w;
        gAcc += col[1] * c.w;
        bAcc += col[2] * c.w;
      }

      if (waterWeight > 0.15 && waterWeight < 0.85) {
        const foamN = fbm(wx * 1.2, wy * 1.2);
        if (foamN > 0.48) {
          const foamF = (1 - Math.abs(waterWeight - 0.5) * 2) * 0.35;
          rAcc = rAcc * (1 - foamF) + 225 * foamF;
          gAcc = gAcc * (1 - foamF) + 238 * foamF;
          bAcc = bAcc * (1 - foamF) + 242 * foamF;
        }
      }

      if (distFromC > 0.85) {
        const fade = Math.min(1, (distFromC - 0.85) / 0.35);
        rAcc = rAcc * (1 - fade) + deepOcean[0] * fade;
        gAcc = gAcc * (1 - fade) + deepOcean[1] * fade;
        bAcc = bAcc * (1 - fade) + deepOcean[2] * fade;
      }

      data[pIdx] = Math.max(0, Math.min(255, rAcc | 0));
      data[pIdx + 1] = Math.max(0, Math.min(255, gAcc | 0));
      data[pIdx + 2] = Math.max(0, Math.min(255, bAcc | 0));
      data[pIdx + 3] = 255;
    }
  }

  mctx.putImageData(imgData, 0, 0);
}
function walkable(x, y) {
  const r = 0.28, pts = [[x - r, y - r], [x + r, y - r], [x - r, y + r], [x + r, y + r]];
  for (const p of pts) {
    const tx = Math.floor(p[0]), ty = Math.floor(p[1]);
    if (!inB(tx, ty)) return false;
    if (tiles[gi(tx, ty)] === TL.WATER) return false;
  }
  for (const e of entities) {
    if (
      (e.t === ET.STONE || e.t === ET.RUIN || e.t === ET.HERO_TREE) &&
      Math.hypot(e.x - x, e.y - y) < (e.t === ET.HERO_TREE ? 0.9 : 0.7)
    ) {
      return false;
    }
  }
  return true;
}
function entityAt(gx, gy) {
  return entities.find(
    (e) =>
      e !== player &&
      Math.abs(e.x - gx) < 0.5 &&
      Math.abs(e.y - gy) < 0.5 &&
      (e.t === ET.TREE ||
        e.t === ET.HERO_TREE ||
        e.t === ET.DRIFTWOOD ||
        e.t === ET.STONE ||
        e.t === ET.FLOWER ||
        e.t === ET.MUSH ||
        e.t === ET.RUIN ||
        e.t === ET.REED ||
        e.t === ET.GLOW)
  );
}


/* --- storage.js --- */
function enc(u) {
  let s = '';
  for (let i = 0; i < u.length; i += 8192) {
    s += String.fromCharCode.apply(null, u.subarray(i, i + 8192));
  }
  return btoa(s);
}
function dec(s) {
  const b = atob(s), u = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
  return u;
}
function save() {
  try {
    localStorage.setItem(
      'sw.v7',
      JSON.stringify({
        seed: S.seed,
        wd: S.worldDay,
        px: player.x,
        py: player.y,
        tiles: enc(tiles),
        ents: entities
          .filter((e) => e !== player)
          .map((e) => [e.t, +e.x.toFixed(2), +e.y.toFixed(2), e.ly, e.data]),
        mem: memSet
      })
    );
  } catch (e) {}
}
function load() {
  try {
    const r = localStorage.getItem('sw.v7');
    if (!r) return false;
    const o = JSON.parse(r);
    const t = dec(o.tiles);
    if (t.length !== GRID * GRID) return false;

    setTiles(t);
    S.seed = o.seed;
    S.worldDay = o.wd || 0.22;
    setMemSet(o.mem || {});

    const newEnts = [];
    o.ents.forEach((e) => newEnts.push({ t: e[0], x: e[1], y: e[2], ly: e[3], data: e[4] || {} }));

    const newPlayer = { t: ET.PLAYER, x: o.px, y: o.py, ly: 7, data: { vx: 0, vy: 0, walk: 0, flip: 0 } };
    newEnts.push(newPlayer);

    if (!newEnts.some((e) => e.t === ET.FOX)) {
      newEnts.push({
        t: ET.FOX,
        x: newPlayer.x + 5,
        y: newPlayer.y - 4,
        ly: 6,
        data: { trust: 0, state: 'wary', home: [newPlayer.x + 5, newPlayer.y - 4], wt: 0, dir: 0 }
      });
    }

    setEntities(newEnts);
    setPlayer(newPlayer);
    return true;
  } catch (e) {
    return false;
  }
}


/* --- actions.js --- */
function scheduleRegrow(x, y, t, d, sec) {
  regrow[x + ',' + y] = { t, d, at: Date.now() + sec * 1000 };
}
function gather(e, wx, wy) {
  if (e.t === ET.HERO_TREE) {
    burst(wx, wy, [140, 195, 110], 8);
    whisper('this ancient tree has sheltered many quiet moments.');
    return;
  } else if (e.t === ET.DRIFTWOOD) {
    burst(wx, wy, [160, 140, 110], 7);
    scheduleRegrow(Math.floor(wx), Math.floor(wy), ET.DRIFTWOOD, {}, 180 + Math.random() * 60);
    remEntity(e);
    whisper('smoothed by salt and time.');
    return;
  } else if (e.t === ET.TREE) {
    e.t = ET.STUMP;
    e.ly = 4;
    retex(e);
    burst(wx, wy, [120, 172, 92], 10);
    scheduleRegrow(Math.floor(wx), Math.floor(wy), ET.TREE, { v: (Math.random() * 4) | 0 }, 170 + Math.random() * 60);
  } else if (e.t === ET.STONE) {
    e.t = ET.PEBBLE;
    e.ly = 0;
    retex(e);
    burst(wx, wy, [180, 186, 193], 7);
    scheduleRegrow(Math.floor(wx), Math.floor(wy), ET.STONE, {}, 230);
  } else if (e.t === ET.RUIN) {
    e.t = ET.PEBBLE;
    e.ly = 0;
    retex(e);
    burst(wx, wy, [180, 186, 193], 7);
    mem('ruin');
  } else if (e.t === ET.FLOWER || e.t === ET.GLOW) {
    burst(wx, wy, [240, 200, 220], 8);
    scheduleRegrow(Math.floor(wx), Math.floor(wy), ET.FLOWER, { c: (Math.random() * 5) | 0, moist: 1 }, 80 + Math.random() * 60);
    remEntity(e);
    return;
  } else if (e.t === ET.MUSH) {
    burst(wx, wy, [210, 150, 120], 6);
    if (Math.random() < 0.5) scheduleRegrow(Math.floor(wx), Math.floor(wy), ET.MUSH, { v: (Math.random() * 2) | 0 }, 200);
    remEntity(e);
    return;
  } else if (e.t === ET.REED) {
    burst(wx, wy, [140, 180, 108], 6);
    remEntity(e);
    return;
  }
  if (Math.random() < 0.5) whisper(GATH[(Math.random() * GATH.length) | 0]);
}
function newFlowerAt(x, y) {
  const e = { t: ET.FLOWER, x: x + 0.5, y: y + 0.5, ly: 0, data: { c: (Math.random() * 5) | 0, moist: 1 } };
  entities.push(e);
  makeSprite(e);
}
function spreadFlower() {
  for (let tr = 0; tr < 6; tr++) {
    const e = entities.find((en) => en.t === ET.FLOWER && Math.random() < 0.3);
    if (!e) continue;
    const d = [[1, 0], [-1, 0], [0, 1], [0, -1]][(Math.random() * 4) | 0];
    const nx = Math.floor(e.x) + d[0];
    const ny = Math.floor(e.y) + d[1];
    if (
      inB(nx, ny) &&
      tiles[gi(nx, ny)] === TL.GRASS &&
      !entities.some((en) => Math.floor(en.x) === nx && Math.floor(en.y) === ny && (en.t === ET.FLOWER || en.t === ET.TREE || en.t === ET.GLOW))
    ) {
      newFlowerAt(nx, ny);
      return;
    }
  }
}
function sing() {
  if (state.gt - state.lastSing < 2.2) return;
  state.lastSing = state.gt;
  ripples.push({ x: player.x, y: player.y, t0: state.gt });
  const px = Math.floor(player.x), py = Math.floor(player.y);
  for (let oy = -2; oy <= 2; oy++) {
    for (let ox = -2; ox <= 2; ox++) {
      const x = px + ox, y = py + oy;
      if (!inB(x, y)) continue;
      if (tiles[gi(x, y)] === TL.GRASS && !entities.some((e) => Math.floor(e.x) === x && Math.floor(e.y) === y && e.t !== ET.PLAYER) && Math.random() < 0.32) {
        newFlowerAt(x, y);
      }
    }
  }
  for (let i = 0; i < 12; i++) {
    const a = Math.random() * TAU, r = 0.5 + Math.random() * 1.6;
    burst(player.x + Math.cos(a) * r * 0.3, player.y + Math.sin(a) * r * 0.3, [255, 240, 200], 1);
  }
  mem('song');
}
function screenToGrid(sx, sy) {
  const wx = (sx - world.x) / view.z;
  const wy = (sy - world.y) / view.z;
  const a = (wx - ISO.OFFX) / ISO.HW;
  const b = (wy - ISO.OFFY) / ISO.HH;
  return [(a + b) / 2, (b - a) / 2];
}
function actAt(sx, sy) {
  const g = screenToGrid(sx, sy);
  if (Math.hypot(g[0] - player.x, g[1] - player.y) > 2.8) {
    ripples.push({ x: g[0], y: g[1], t0: state.gt });
    return;
  }
  const e = entityAt(g[0], g[1]);
  if (e) gather(e, g[0], g[1]);
  else ripples.push({ x: g[0], y: g[1], t0: state.gt });
}


/* --- input.js --- */
const keys = {};
const ptrs = new Map();
let touchAnchor = null;
let touchVec = null;
let pinch = null;
function setupInput(appView) {
  window.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    if (e.code === 'Space') {
      e.preventDefault();
      sing();
    }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
      e.preventDefault();
    }
  });

  window.addEventListener('keyup', (e) => {
    keys[e.code] = false;
  });

  appView.addEventListener('contextmenu', (e) => e.preventDefault());

  appView.addEventListener('pointerdown', (e) => {
    appView.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (ptrs.size === 2) {
      const p = [...ptrs.values()];
      pinch = { d0: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y), s0: view.zt };
      touchAnchor = null;
      return;
    }

    if (e.pointerType === 'touch') {
      touchAnchor = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
      touchVec = null;
    } else {
      actAt(e.clientX, e.clientY);
    }
  });

  appView.addEventListener('pointermove', (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;

    if (ptrs.has(e.pointerId)) {
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    if (pinch && ptrs.size >= 2) {
      const p = [...ptrs.values()];
      const d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
      if (pinch.d0 > 0) view.zt = clamp((pinch.s0 * pinch.d0) / Math.max(d, 20), getMinZoom(), 2.4);
      return;
    }

    if (touchAnchor) {
      const dx = e.clientX - touchAnchor.x;
      const dy = e.clientY - touchAnchor.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 12) {
        touchAnchor.moved = true;
        const m = Math.min(1, dist / 60);
        touchVec = { x: (dx / dist) * m, y: (dy / dist) * m };
      }
    }
  });

  function pend(e) {
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) pinch = null;
    if (touchAnchor) {
      if (!touchAnchor.moved && performance.now() - touchAnchor.t < 320) {
        actAt(e.clientX, e.clientY);
      }
      touchAnchor = null;
      touchVec = null;
    }
  }

  appView.addEventListener('pointerup', pend);
  appView.addEventListener('pointercancel', pend);

  appView.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      view.zt = clamp(view.zt * Math.exp(-e.deltaY * 0.0013), getMinZoom(), 2.4);
    },
    { passive: false }
  );
}


/* --- game.js --- */
let app = null;
let groundFilter = null;
let world = null;
let shdC = null;
let shdG = null;
let lightC = null;
let entC = null;
let fxC = null;
let ripplesG = null;
let hoverG = null;
let pHalo = null;
const flies = [];
const POOL = [];
const parts = [];
function initApp() {
  app = new PIXI.Application({
    resizeTo: window,
    backgroundAlpha: 1,
    backgroundColor: 0x0c2436,
    antialias: true,
    resolution: Math.min(devicePixelRatio || 1, 2),
    autoDensity: true
  });

  app.view.style.cssText =
    'position:fixed;inset:0;width:100%;height:100%;display:block;touch-action:none;cursor:crosshair;z-index:1';
  document.body.appendChild(app.view);

  const glctx = app.renderer.gl;
  initIsoBounds(glctx);

  groundFilter = createGroundFilter();

  world = new PIXI.Container();
  shdC = new PIXI.Container();
  shdG = new PIXI.Graphics();
  shdC.addChild(shdG);
  lightC = new PIXI.Container();
  entC = new PIXI.Container();
  entC.sortableChildren = true;
  fxC = new PIXI.Container();

  world.addChild(shdC, lightC, entC, fxC);
  app.stage.addChild(world);

  ripplesG = new PIXI.Graphics();
  fxC.addChild(ripplesG);
  hoverG = new PIXI.Graphics();
  hoverG.blendMode = PIXI.BLEND_MODES.ADD;
  fxC.addChild(hoverG);

  /* particle pool */
  for (let i = 0; i < 90; i++) {
    const s = new PIXI.Sprite(TEX.dot);
    s.anchor.set(0.5);
    s.blendMode = PIXI.BLEND_MODES.ADD;
    s.alpha = 0;
    s.visible = false;
    fxC.addChild(s);
    POOL.push(s);
  }

  /* fireflies + player halo */
  for (let i = 0; i < 26; i++) {
    const s = new PIXI.Sprite(TEX.dot);
    s.anchor.set(0.5);
    s.blendMode = PIXI.BLEND_MODES.ADD;
    s.tint = 0xccff77;
    s.alpha = 0;
    s.scale.set(0.5);
    const gx = C + (Math.random() - 0.5) * 58;
    const gy = C + (Math.random() - 0.5) * 58;
    const p = iso(gx, gy);
    s.x = p.x;
    s.y = p.y - 12 - Math.random() * 30;
    lightC.addChild(s);
    flies.push({ sp: s, bx: p.x, by: p.y - 12 - Math.random() * 30, ph: Math.random() * TAU, sp2: 0.3 + Math.random() * 0.5 });
  }

  pHalo = new PIXI.Sprite(TEX.dot);
  pHalo.anchor.set(0.5);
  pHalo.blendMode = PIXI.BLEND_MODES.ADD;
  pHalo.tint = 0xcfe0ff;
  pHalo.scale.set(2.2);
  pHalo.alpha = 0;
  lightC.addChild(pHalo);

  return app;
}
function burst(wx, wy, col, n) {
  for (let i = 0; i < n; i++) {
    let sp = null;
    for (const s of POOL) {
      if (!s.visible) {
        sp = s;
        break;
      }
    }
    if (!sp) break;
    const a = Math.random() * TAU, sp2 = 0.5 + Math.random() * 1.3;
    sp.visible = true;
    sp.tint = PIXI.utils.rgb2hex([col[0] / 255, col[1] / 255, col[2] / 255]);
    parts.push({ sp, x: wx, y: wy, vx: Math.cos(a) * sp2, vy: Math.sin(a) * sp2 - 0.5, life: 1, sz: 1.6 + Math.random() * 2.2 });
  }
}
function makeSprite(e) {
  const t = new PIXI.Sprite(texFor(e, state.curSeason));
  t.anchor.set(0.5, 1);
  const bs = WH[e.t] / t.texture.orig.height;
  e._bs = bs;
  t.scale.set(bs);
  e.sprite = t;
  entC.addChild(t);
  return t;
}
function retex(e) {
  if (!e.sprite) return;
  e.sprite.texture = texFor(e, state.curSeason);
  e._bs = WH[e.t] / e.sprite.texture.orig.height;
  e.sprite.scale.set(e._bs);
}
function makeHalo(e) {
  const h = new PIXI.Sprite(TEX.dot);
  h.anchor.set(0.5);
  h.blendMode = PIXI.BLEND_MODES.ADD;
  h.tint = 0x9fc8ff;
  h.scale.set(2.4);
  lightC.addChild(h);
  e.halo = h;
}
function addEntity(e) {
  entities.push(e);
  makeSprite(e);
  if (e.t === ET.GLOW) makeHalo(e);
  return e;
}
function remEntity(e) {
  if (e.halo) {
    lightC.removeChild(e.halo);
    e.halo.destroy();
    e.halo = null;
  }
  if (e.sprite) {
    entC.removeChild(e.sprite);
    e.sprite.destroy();
    e.sprite = null;
  }
  const i = entities.indexOf(e);
  if (i >= 0) entities.splice(i, 1);
}
function buildAllSprites() {
  entities.forEach((e) => {
    makeSprite(e);
    if (e.t === ET.GLOW) makeHalo(e);
  });
}

let regrowTick = 5, spreadTick = 16, ambT = 24, saveT = 0;
function update(dt, spreadFlowerFn) {
  state.gt += dt;
  S.worldDay += dt / 140;
  const phase = S.worldDay % 1, sun = Math.sin(phase * TAU);
  state.daylight = sm(-0.12, 0.25, sun);
  state.nightF = 1 - sm(-0.28, 0.02, sun);
  state.dusk = Math.max(0, 1 - Math.abs(sun) * 6);
  state.sTint = SEAS_TINT[seasonOf(S.worldDay)];

  const ns = seasonOf(S.worldDay);
  if (ns !== state.curSeason) {
    state.curSeason = ns;
    entities.forEach((e) => {
      if (e.t === ET.TREE || e.t === ET.HERO_TREE) retex(e);
    });
  }

  if (state.prevNight < 0.5 && state.nightF >= 0.5) mem('night');
  if (state.prevNight >= 0.5 && state.nightF < 0.5 && Math.random() < 0.3) {
    whisper('the sun returns to see what you have made.');
  }
  state.prevNight = state.nightF;

  if (state.rainState === 0) {
    state.rainCd -= dt;
    if (state.rainCd <= 0) {
      state.rainState = 1;
      state.rainT = 22 + Math.random() * 22;
      state.storm = Math.random() < 0.22 ? 1 : 0;
      mem('rain');
    }
  } else {
    state.rainT -= dt;
    if (state.rainT <= 0) {
      state.rainState = 0;
      state.rainCd = 90 + Math.random() * 130;
      state.storm = 0;
      for (let i = 0; i < 4; i++) if (spreadFlowerFn) spreadFlowerFn();
      if (Math.random() < 0.4) whisper('the rain left small gifts.');
    }
  }

  state.rainAmt += ((state.rainState ? 1 : 0) - state.rainAmt) * Math.min(1, dt * 0.5);
  state.windAmt = lerp(
    state.windAmt,
    (state.rainState ? 0.9 : 0.42) + (state.storm ? 0.45 : 0) + 0.12 * Math.sin(state.gt * 0.3),
    Math.min(1, dt * 0.6)
  );

  let sx = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
  let sy = (keys.KeyS || keys.ArrowDown ? 1 : 0) - (keys.KeyW || keys.ArrowUp ? 1 : 0);
  if (touchVec) {
    sx += touchVec.x;
    sy += touchVec.y;
  }
  const sl = Math.hypot(sx, sy);
  if (sl > 1) {
    sx /= sl;
    sy /= sl;
  }

  const gdx = sx + sy, gdy = sy - sx, accel = 7, fric = Math.exp(-dt * 7);
  player.data.vx += gdx * accel * dt;
  player.data.vy += gdy * accel * dt;
  player.data.vx *= fric;
  player.data.vy *= fric;

  const sp = Math.hypot(player.data.vx, player.data.vy);
  if (sp > 3.4) {
    player.data.vx *= 3.4 / sp;
    player.data.vy *= 3.4 / sp;
  }

  const nx = player.x + player.data.vx * dt;
  const ny = player.y + player.data.vy * dt;

  if (walkable(nx, player.y)) player.x = clamp(nx, 1, GRID - 1);
  else player.data.vx = 0;

  if (walkable(player.x, ny)) player.y = clamp(ny, 1, GRID - 1);
  else player.data.vy = 0;

  const svx = player.data.vx - player.data.vy;
  if (sp > 0.35) {
    player.data.walk += dt;
    if (Math.abs(svx) > 0.2) player.data.flip = svx < 0 ? 1 : 0;
  } else {
    player.data.walk = 0;
  }

  updatePlayerCharacter(dt);

  const pp = iso(player.x, player.y);
  view.tx = pp.x;
  view.ty = pp.y;
  view.cx += (view.tx - view.cx) * Math.min(1, dt * 2.4);
  view.cy += (view.ty - view.cy) * Math.min(1, dt * 2.4);
  const minZ = getMinZoom();
  view.zt = clamp(view.zt, minZ, 2.4);
  view.z += (view.zt - view.z) * Math.min(1, dt * 6);
  view.z = Math.max(minZ, view.z);

  world.scale.set(view.z);
  world.x = app.screen.width / 2 - view.cx * view.z;
  world.y = app.screen.height / 2 - view.cy * view.z;

  regrowTick -= dt;
  if (regrowTick <= 0) {
    regrowTick = 5;
    for (const k in regrow) {
      const r = regrow[k];
      if (r.at <= Date.now()) {
        const p = k.split(','), x = +p[0], y = +p[1];
        if (!entities.some((en) => Math.floor(en.x) === x && Math.floor(en.y) === y && (en.t === ET.TREE || en.t === ET.HERO_TREE || en.t === ET.FLOWER || en.t === ET.STONE || en.t === ET.MUSH || en.t === ET.GLOW))) {
          addEntity({ t: r.t, x: x + 0.5, y: y + 0.5, ly: r.t === ET.FLOWER || r.t === ET.MUSH || r.t === ET.GLOW || r.t === ET.DRIFTWOOD ? 0 : 4, data: r.d || {} });
        }
        delete regrow[k];
      }
    }
    spreadTick -= 5;
    if (spreadTick <= 0) {
      spreadTick = 16;
      if (Math.random() < 0.6 && spreadFlowerFn) spreadFlowerFn();
    }
    for (const e of entities) {
      if (e.t === ET.FLOWER) e.data.moist = Math.max(0, e.data.moist - dt * 0.02 * (state.curSeason === 1 ? 1.6 : 1));
    }
  }

  for (const e of entities) {
    if (e.t === ET.RABBIT) {
      const d = e.data;
      d.wt -= dt;
      if (d.wt <= 0) {
        d.wt = 1 + Math.random() * 3;
        d.dir = Math.random() * TAU;
        d.mv = Math.random() < 0.5 ? 1 : 0;
      }
      if (d.mv) {
        const nx2 = e.x + Math.cos(d.dir) * 1.2 * dt;
        const ny2 = e.y + Math.sin(d.dir) * 1.2 * dt;
        if (inB(Math.floor(nx2), Math.floor(ny2)) && tiles[gi(Math.floor(nx2), Math.floor(ny2))] !== TL.WATER) {
          e.x = nx2;
          e.y = ny2;
        } else {
          d.dir += Math.PI;
        }
      }
    }

    if (e.t === ET.FOX) {
      const d = e.data;
      const distP = Math.hypot(e.x - player.x, e.y - player.y);
      const still = Math.hypot(player.data.vx, player.data.vy) < 0.3;
      if (distP < 7) {
        if (!still && distP < 3.5) d.trust = Math.max(0, d.trust - dt * 1.5);
        else if (still && distP < 4) d.trust += dt * 0.5;
      }
      const bonded = d.trust >= 6;
      d.state = d.trust < 1 ? 'wary' : d.trust < 3 ? 'curious' : d.trust < 6 ? 'trusting' : 'bonded';
      if (bonded) {
        const want = 2.6, dx = player.x - e.x, dy = player.y - e.y, L = Math.hypot(dx, dy) || 1;
        if (L > want + 0.5) {
          e.x += (dx / L) * 1.6 * dt;
          e.y += (dy / L) * 1.6 * dt;
        }
        if (!memSet.bond) {
          mem('bond');
          whisper('the fox stays near, now.');
        }
      } else if (d.state === 'wary') {
        if (distP < 5) {
          const dx = e.x - player.x, dy = e.y - player.y, L = Math.hypot(dx, dy) || 1;
          e.x += (dx / L) * 2.2 * dt;
          e.y += (dy / L) * 2.2 * dt;
        } else {
          d.wt -= dt;
          if (d.wt <= 0) {
            d.wt = 2 + Math.random() * 3;
            d.dir = Math.atan2(d.home[1] - e.y, d.home[0] - e.x) + (Math.random() - 0.5);
          }
          e.x += Math.cos(d.dir) * 0.6 * dt;
          e.y += Math.sin(d.dir) * 0.6 * dt;
        }
      } else {
        const want = d.state === 'curious' ? 4.5 : 3.0, dx = player.x - e.x, dy = player.y - e.y, L = Math.hypot(dx, dy) || 1;
        if (L > want + 1) {
          e.x += (dx / L) * 1.2 * dt;
          e.y += (dy / L) * 1.2 * dt;
        } else if (L < want - 1) {
          e.x -= (dx / L) * 0.8 * dt;
          e.y -= (dy / L) * 0.8 * dt;
        }
        d.wt -= dt;
        if (d.wt <= 0) {
          d.wt = 1.5 + Math.random() * 2;
          e.x += (Math.random() - 0.5) * 0.4;
          e.y += (Math.random() - 0.5) * 0.4;
        }
      }
    }
  }

  const sunElevation = Math.sin(phase * Math.PI);
  const isDay = sunElevation > 0;

  const sunAzimuth = phase * TAU;
  const shadowAngle = sunAzimuth + Math.PI;

  const golden = Math.pow(Math.max(0, 1 - Math.abs(sunElevation - 0.16) * 3.6), 1.6);
  state.golden = golden;

  const L = isDay
    ? clamp(0.35 / Math.max(0.12, sunElevation), 0.35, 3.2)
    : 1.4;

  const baseAlpha = isDay
    ? (0.30 + 0.18 * (1 - Math.abs(sunElevation))) * Math.min(1, sunElevation * 3)
    : state.nightF * 0.22;

  const shadowCol = isDay ? 0x0a1610 : 0x081228;

  if (shdG) {
    shdG.clear();
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      const base = iso(e.x, e.y);

      // Height of entity in screen units
      const H = WH[e.t] || 12;

      // Shadow projection vector on isometric ground plane
      const len = H * L * 0.32;
      const tipX = base.x + Math.cos(shadowAngle) * len;
      const tipY = base.y + Math.sin(shadowAngle) * len * 0.5;

      if (e.t === ET.TREE || e.t === ET.HERO_TREE) {
        const isHero = e.t === ET.HERO_TREE;
        const trunkW = isHero ? 4.5 : 2.5;

        const rX = Math.max(7, (isHero ? 18 : 12) * clamp(L * 0.42, 0.7, 1.8));
        const rY = Math.max(4, (isHero ? 10 : 6.5) * clamp(L * 0.42, 0.7, 1.8));

        // 1. Solid Ground Contact Shadow directly at base of trunk
        shdG.beginFill(shadowCol, baseAlpha * 0.80);
        shdG.drawEllipse(base.x, base.y, trunkW * 1.8, trunkW * 0.9);
        shdG.endFill();

        // 2. Trunk shadow trapezoid connecting trunk base to canopy shadow tip
        shdG.beginFill(shadowCol, baseAlpha * 0.65);
        shdG.drawPolygon([
          base.x - trunkW, base.y,
          base.x + trunkW, base.y,
          tipX + trunkW * 0.6, tipY,
          tipX - trunkW * 0.6, tipY
        ]);
        shdG.endFill();

        // 3. Soft Outer Canopy Shadow
        shdG.beginFill(shadowCol, baseAlpha * 0.35);
        shdG.drawEllipse(tipX, tipY, rX * 1.2, rY * 1.2);
        shdG.endFill();

        // 4. Inner Dark Canopy Shadow Core
        shdG.beginFill(shadowCol, baseAlpha * 0.65);
        shdG.drawEllipse(tipX, tipY, rX, rY);
        shdG.endFill();
      } else if (e.t === ET.PLAYER || e.t === ET.FOX || e.t === ET.RABBIT) {
        const rad = (e.t === ET.PLAYER ? 5.5 : e.t === ET.FOX ? 6.5 : 3.5);

        // Ground contact shadow at feet
        shdG.beginFill(shadowCol, baseAlpha * 0.85);
        shdG.drawEllipse(base.x, base.y, rad * 1.2, rad * 0.6);
        shdG.endFill();

        // Cast body shadow
        shdG.beginFill(shadowCol, baseAlpha * 0.55);
        shdG.drawPolygon([
          base.x - rad * 0.8, base.y,
          base.x + rad * 0.8, base.y,
          tipX + rad * 0.6, tipY,
          tipX - rad * 0.6, tipY
        ]);
        shdG.drawEllipse(tipX, tipY, rad * 0.9, rad * 0.45);
        shdG.endFill();
      } else if (e.t === ET.STONE || e.t === ET.RUIN || e.t === ET.STUMP || e.t === ET.DRIFTWOOD) {
        const w = e.t === ET.RUIN ? 9 : e.t === ET.STONE ? 6.5 : e.t === ET.DRIFTWOOD ? 6 : 4.5;

        // Ground contact shadow
        shdG.beginFill(shadowCol, baseAlpha * 0.85);
        shdG.drawEllipse(base.x, base.y, w * 1.2, w * 0.6);
        shdG.endFill();

        // Cast shadow
        shdG.beginFill(shadowCol, baseAlpha * 0.50);
        shdG.drawPolygon([
          base.x - w, base.y,
          base.x + w, base.y,
          tipX + w * 0.75, tipY,
          tipX - w * 0.75, tipY
        ]);
        shdG.drawEllipse(tipX, tipY, w * 0.85, w * 0.42);
        shdG.endFill();
      } else {
        // Small items (flowers, mushrooms, reeds, glow)
        shdG.beginFill(shadowCol, baseAlpha * 0.45);
        shdG.drawEllipse(base.x, base.y, 4.0, 2.0);
        shdG.endFill();
      }
    }
  }

  const dayR = lerp(0.32, lerp(1.0, 1.36, golden), state.daylight);
  const dayG = lerp(0.42, lerp(1.0, 0.94, golden), state.daylight);
  const dayB = lerp(0.66, lerp(1.0, 0.68, golden), state.daylight);
  const dayT = tintInt(dayR, dayG, dayB);
  state.hoverEnt = null;

  if (mouse.x > -99) {
    const hg = screenToGrid(mouse.x, mouse.y);
    if (Math.hypot(hg[0] - player.x, hg[1] - player.y) <= 2.8) {
      state.hoverEnt = entityAt(hg[0], hg[1]);
    }
  }

  for (const e of entities) {
    if (!e.sprite) continue;
    const p = iso(e.x, e.y);
    let swayX = 0;
    if (e.t === ET.FLOWER || e.t === ET.REED || e.t === ET.GLOW) {
      swayX = Math.sin(state.gt * 1.7 + e.x * 0.6 + e.y * 0.5) * (e.t === ET.REED ? 2.4 : 1.6) * (0.5 + state.windAmt);
    }
    e.sprite.x = p.x + swayX;
    e.sprite.y = p.y;
    e.sprite.zIndex = Math.round(e.x + e.y) * 10 + e.ly;

    if (e.t === ET.PLAYER) {
      e.sprite.texture = TEX.player;
      e._bs = WH[14] / e.sprite.texture.orig.height;
      e.sprite.scale.set(e._bs, e._bs);
      e.sprite.tint = dayT;
    } else if (e.t === ET.FOX) {
      const wk = Math.sin(state.gt * 4 + e.x) > 0.3;
      e.sprite.texture = wk ? TEX.foxW : TEX.fox;
      e._bs = WH[12] / e.sprite.texture.orig.height;
      e.sprite.scale.set((player.x < e.x ? -1 : 1) * e._bs, e._bs);
      e.sprite.tint = dayT;
    } else if (e.t === ET.RABBIT) {
      e._bs = WH[13] / e.sprite.texture.orig.height;
      e.sprite.scale.set((Math.cos(e.data.dir || 0) < 0 ? -1 : 1) * e._bs, e._bs);
      e.sprite.tint = dayT;
    } else if (e.t === ET.GLOW) {
      e.sprite.tint = tintInt(0.9, 0.95, 1.05);
      if (e.halo) {
        e.halo.x = p.x;
        e.halo.y = p.y - 12;
        e.halo.alpha = (0.12 + 0.5 * state.nightF) * (0.7 + 0.3 * Math.sin(state.gt * 1.6 + e.x));
      }
    } else {
      e.sprite.tint = dayT;
    }

    if (e === state.hoverEnt) {
      const g = 0.18 + 0.12 * Math.sin(state.gt * 4);
      const r0 = (e.sprite.tint >> 16) & 255, g0 = (e.sprite.tint >> 8) & 255, b0 = e.sprite.tint & 255;
      e.sprite.tint = tintInt(r0 / 255 + g, g0 / 255 + g, b0 / 255 + g);
    }
  }

  pHalo.x = pp.x;
  pHalo.y = pp.y - 12;
  pHalo.alpha = 0;

  for (const f of flies) {
    f.ph += dt * f.sp2;
    f.sp.x = f.bx + Math.sin(f.ph) * 16;
    f.sp.y = f.by + Math.cos(f.ph * 0.7) * 10;
    f.sp.alpha = state.nightF * Math.pow(0.5 + 0.5 * Math.sin(state.gt * 2.2 + f.ph * 3), 2) * 0.9;
  }

  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.life -= dt * 0.9;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += dt * 1.6;
    const s = iso(p.x, p.y);
    p.sp.x = s.x;
    p.sp.y = s.y - p.sz * 1.2;
    p.sp.alpha = clamp(p.life, 0, 1);
    p.sp.scale.set(p.sz * 0.4);
    if (p.life <= 0) {
      p.sp.visible = false;
      p.sp.alpha = 0;
      parts.splice(i, 1);
    }
  }

  ripplesG.clear();
  for (let i = ripples.length - 1; i >= 0; i--) {
    const r = ripples[i], age = state.gt - r.t0;
    if (age > 1.6) {
      ripples.splice(i, 1);
      continue;
    }
    const c = iso(r.x, r.y), rad = age * 6 * 1.4, al = 1 - age / 1.6;
    ripplesG.lineStyle(Math.max(0.6, 6 * 0.12), 0xcfeaff, al * 0.5);
    ripplesG.drawEllipse(c.x, c.y, rad, rad * 0.5);
  }

  hoverG.clear();
  if (state.hoverEnt) {
    const c = iso(state.hoverEnt.x, state.hoverEnt.y), a = 0.35 + 0.25 * Math.sin(state.gt * 3);
    hoverG.lineStyle(Math.max(0.6, 6 * 0.14), 0xffee9c, a);
    hoverG.drawEllipse(c.x, c.y, 12 * 0.7, 6 * 0.7);
    hoverG.lineStyle(Math.max(0.5, 6 * 0.1), 0xffee9c, a * 0.4);
    hoverG.drawEllipse(c.x, c.y, 12 * 0.92, 6 * 0.92);
  }

  if (groundFilter && groundFilter.uniforms) {
    const gu = groundFilter.uniforms;
    gu.u_day = state.daylight;
    gu.u_dusk = state.dusk;
    gu.u_golden = golden;
    gu.u_seas = state.sTint;
  }

  ambT -= dt;
  saveT += dt;
  if (ambT <= 0) {
    ambT = 46 + Math.random() * 46;
    whisper(AMB[(Math.random() * AMB.length) | 0]);
  }
  if (saveT > 15) {
    saveT = 0;
    save();
  }
}


/* --- main.js --- */












function $(s) {
  return document.querySelector(s);
}

window.addEventListener('load', () => {
  if (typeof PIXI === 'undefined') {
    const errEl = $('#err');
    if (errEl) errEl.style.display = 'flex';
    return;
  }

  try {
    const isLoaded = load();
    if (!isLoaded) {
      genWorld();
    }

    buildSprites();
    buildTextures();
    initPlayerCharacter();
    paintGround();

    initApp();

    const groundTex = PIXI.Texture.from(mapCv, {
      scaleMode: PIXI.SCALE_MODES.LINEAR,
      resolution: 1
    });

    const ground = new PIXI.Sprite(groundTex);
    ground.filters = [groundFilter];
    world.addChildAt(ground, 0);

    state.curSeason = seasonOf(S.worldDay);
    buildAllSprites();

    const pi = iso(player.x, player.y);
    view.tx = pi.x;
    view.ty = pi.y;
    view.cx = pi.x;
    view.cy = pi.y;

    try {
      app.renderer.render(app.stage);
    } catch (e) {}

    setupInput(app.view);

    app.ticker.add(() => {
      const dt = Math.min(0.05, app.ticker.deltaMS / 1000);
      update(dt, spreadFlower);
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) save();
    });

    window.addEventListener('pagehide', save);

    setTimeout(() => {
      $('#fade').style.opacity = 0;
      $('#title').classList.add('gone');
      $('#hint').classList.add('gone');
      $('#sig').classList.add('gone');
    }, 350);

    setTimeout(() => whisper('you are here. that is enough.'), 2600);

  } catch (err) {
    console.error(err);
    const errEl = $('#err');
    if (errEl) errEl.style.display = 'flex';
  }
});


})();
