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
uniform float u_day, u_dusk;
uniform vec3 u_seas;

void main(){
 vec4 base = texture2D(uSampler, vTextureCoord);
 vec3 col = base.rgb;
 col = mix(col * vec3(0.22, 0.30, 0.54), col, u_day);
 col = mix(col, col * vec3(1.34, 0.88, 0.66), u_dusk * 0.6);
 col *= u_seas;
 gl_FragColor = vec4(col, base.a);
}`;
function createGroundFilter() {
  return new PIXI.Filter(null, GROUND_FRAG, {
    u_day: 1,
    u_dusk: 0,
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
  soft(x, cx, cy, rx, ry, 'rgba(10,18,14,0.34)');
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

function dRuin(x) {
  shd(x, 8, 14, 6, 2.4);
  x.fillStyle = 'rgb(166,166,176)';
  x.fillRect(3, 3, 10, 11);
  x.fillStyle = 'rgb(136,136,150)';
  x.fillRect(3, 3, 10, 3);
  x.strokeStyle = 'rgba(84,84,102,.7)';
  x.lineWidth = 1;
  x.beginPath();
  x.moveTo(7, 3);
  x.lineTo(9, 8);
  x.lineTo(6, 14);
  x.stroke();
  soft(x, 4, 12, 2, 1.6, 'rgba(106,156,86,.6)');
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
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const dx = (x - C) / (GRID * 0.46);
      const dy = (y - C) / (GRID * 0.46);
      const d = Math.sqrt(dx * dx + dy * dy);
      let e = fbm(x * 0.045 + 7.3, y * 0.045 + 3.1) * 0.75 + (1 - d) * 0.64 - 0.18 + (h2(x, y) - 0.5) * 0.06;
      let t;
      if (e < 0.40) t = TL.WATER;
      else if (e < 0.47) t = TL.SAND;
      else t = TL.GRASS;
      if (t === TL.GRASS && fbm(x * 0.08 + 40, y * 0.08 + 17) > 0.63) t = TL.DIRT;
      tiles[gi(x, y)] = t;
    }
  }
  entities = [];
  for (let y = 1; y < GRID - 1; y++) {
    for (let x = 1; x < GRID - 1; x++) {
      const t = tiles[gi(x, y)], r = h2(x * 3.7 + 11, y * 3.7 + 5);
      if (t === TL.GRASS) {
        const tr = fbm(x * 0.09 + 77, y * 0.09 + 31);
        if (tr > 0.66 && r < 0.72) entities.push({ t: ET.TREE, x: x + 0.5, y: y + 0.5, ly: 4, data: { v: (r * 4) | 0 } });
        else if (r > 0.972) entities.push({ t: ET.GLOW, x: x + 0.5, y: y + 0.5, ly: 0, data: {} });
        else if (r > 0.956) entities.push({ t: ET.FLOWER, x: x + 0.5, y: y + 0.5, ly: 0, data: { c: (h2(x + 9, y + 3) * 5) | 0, moist: 1 } });
        else if (r > 0.92) entities.push({ t: ET.STONE, x: x + 0.5, y: y + 0.5, ly: 4, data: {} });
        else if (r > 0.905) entities.push({ t: ET.MUSH, x: x + 0.5, y: y + 0.5, ly: 0, data: { v: (r * 2) | 0 } });
      } else if (t === TL.SAND) {
        let w = false;
        for (let oy = -1; oy <= 1 && !w; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            if (inB(x + ox, y + oy) && tiles[gi(x + ox, y + oy)] === TL.WATER) {
              w = true;
              break;
            }
          }
        }
        if (w && r > 0.85) entities.push({ t: ET.REED, x: x + 0.5, y: y + 0.5, ly: 0, data: {} });
      }
    }
  }

  for (let y = C - 4; y <= C + 4; y++) {
    for (let x = C - 4; x <= C + 4; x++) {
      if ((x - C) * (x - C) + (y - C) * (y - C) <= 18) {
        tiles[gi(x, y)] = TL.GRASS;
        entities = entities.filter((e) => !(Math.floor(e.x) === x && Math.floor(e.y) === y));
      }
    }
  }

  [[C - 3, C - 2], [C + 3, C - 1], [C - 1, C + 3], [C + 2, C - 3]].forEach((p) =>
    entities.push({ t: ET.RUIN, x: p[0] + 0.5, y: p[1] + 0.5, ly: 4, data: {} })
  );
  entities.push({ t: ET.STONE, x: C + 1.5, y: C + 1.5, ly: 4, data: {} });
  entities.push({ t: ET.STONE, x: C - 2.5, y: C + 0.5, ly: 4, data: {} });
  entities.push({ t: ET.FLOWER, x: C + 2.5, y: C + 2.5, ly: 0, data: { c: 0, moist: 1 } });
  entities.push({ t: ET.FLOWER, x: C - 2.5, y: C - 2.5, ly: 0, data: { c: 2, moist: 1 } });
  entities.push({ t: ET.GLOW, x: C + 3.5, y: C - 1.5, ly: 0, data: {} });
  entities.push({ t: ET.GLOW, x: C - 3.5, y: C + 2.5, ly: 0, data: {} });
  entities.push({ t: ET.FOX, x: C + 6.5, y: C - 5.5, ly: 6, data: { trust: 0, state: 'wary', home: [C + 6.5, C - 5.5], wt: 0, dir: 0 } });
  entities.push({ t: ET.RABBIT, x: C - 6.5, y: C + 4.5, ly: 6, data: { wt: 0, dir: Math.random() * Math.PI * 2, mv: 0 } });
  entities.push({ t: ET.RABBIT, x: C + 5.5, y: C + 6.5, ly: 6, data: { wt: 0, dir: Math.random() * Math.PI * 2, mv: 0 } });
  player = { t: ET.PLAYER, x: C + 0.5, y: C + 0.5, ly: 7, data: { vx: 0, vy: 0, walk: 0, flip: 0 } };
  entities.push(player);
}
const mapCv = document.createElement('canvas');

function diamond(ctx, cx, cy, col) {
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.moveTo(cx, cy - ISO.HH);
  ctx.lineTo(cx + ISO.HW, cy);
  ctx.lineTo(cx, cy + ISO.HH);
  ctx.lineTo(cx - ISO.HW, cy);
  ctx.closePath();
  ctx.fill();
}
function paintGround() {
  mapCv.width = ISO.CANW;
  mapCv.height = ISO.CANH;
  const mctx = mapCv.getContext('2d');
  mctx.fillStyle = rgb(mix3(PAL[0][0], PAL[0][1], 0.5));
  mctx.fillRect(0, 0, ISO.CANW, ISO.CANH);
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const t = tiles[gi(x, y)], p = iso(x + 0.5, y + 0.5), hh = h2(x * 1.3 + 0.7, y * 1.3 + 0.3);
      diamond(mctx, p.x, p.y, rgb(mix3(PAL[t][0], PAL[t][1], hh)));
      mctx.save();
      mctx.beginPath();
      mctx.moveTo(p.x, p.y - ISO.HH);
      mctx.lineTo(p.x + ISO.HW, p.y);
      mctx.lineTo(p.x, p.y + ISO.HH);
      mctx.lineTo(p.x - ISO.HW, p.y);
      mctx.closePath();
      mctx.clip();
      if (t === TL.GRASS) {
        mctx.fillStyle = 'rgba(52,94,44,0.16)';
        for (let i = 0; i < 5; i++) {
          const a = h2(x * 7.1 + i, y * 7.7 + i * 3);
          mctx.fillRect(p.x - ISO.HW + ((a * 2 * ISO.HW) | 0), p.y - ISO.HH + ((h2(x + i * 3.3, y + i) * 2 * ISO.HH) | 0), 1, 2);
        }
        mctx.fillStyle = 'rgba(150,200,120,0.10)';
        for (let i = 0; i < 3; i++) {
          mctx.fillRect(p.x - ISO.HW + ((h2(x * 2.1 + i, y * 2.7) * 2 * ISO.HW) | 0), p.y - ISO.HH + ((h2(x * 3.1 + i, y * 1.7) * 2 * ISO.HH) | 0), 1, 1);
        }
      } else if (t === TL.SAND) {
        mctx.fillStyle = 'rgba(156,136,90,0.22)';
        for (let i = 0; i < 4; i++) {
          const a = h2(x * 4.1 + i * 7, y * 5.7 + i);
          mctx.fillRect(p.x - ISO.HW + ((a * 2 * ISO.HW) | 0), p.y - ISO.HH + ((h2(x + i * 2.9, y + i * 1.7) * 2 * ISO.HH) | 0), 1, 1);
        }
      } else if (t === TL.WATER) {
        const dp = fbm(x * 0.3 + 5, y * 0.3 + 2);
        mctx.fillStyle = rgba(mix3([18, 70, 96], [40, 120, 140], dp), 0.35);
        mctx.fillRect(p.x - ISO.HW, p.y - ISO.HH, 2 * ISO.HW, 2 * ISO.HH);
        mctx.fillStyle = 'rgba(150,210,225,0.10)';
        for (let i = 0; i < 3; i++) {
          const a = h2(x * 5.1 + i, y * 6.3 + i * 2);
          if (a > 0.7) mctx.fillRect(p.x - ISO.HW + ((a * 2 * ISO.HW) | 0), p.y - ISO.HH + ((h2(x + i, y * 2 + i) * 2 * ISO.HH) | 0), 1, 1);
        }
      }
      mctx.restore();
    }
  }

  /* foam rim on shore water */
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      if (tiles[gi(x, y)] !== TL.WATER) continue;
      let land = 0;
      for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (inB(x + d[0], y + d[1]) && tiles[gi(x + d[0], y + d[1])] > 0) land++;
      }
      if (land > 0) {
        const p = iso(x + 0.5, y + 0.5);
        mctx.save();
        mctx.globalAlpha = 0.5;
        mctx.strokeStyle = 'rgba(225,238,240,0.7)';
        mctx.lineWidth = Math.max(1, ISO.HH * 0.18);
        mctx.beginPath();
        mctx.moveTo(p.x, p.y - ISO.HH * 0.7);
        mctx.lineTo(p.x + ISO.HW * 0.7, p.y);
        mctx.lineTo(p.x, p.y + ISO.HH * 0.7);
        mctx.lineTo(p.x - ISO.HW * 0.7, p.y);
        mctx.closePath();
        mctx.stroke();
        mctx.restore();
      }
    }
  }
}
function walkable(x, y) {
  const r = 0.28, pts = [[x - r, y - r], [x + r, y - r], [x - r, y + r], [x + r, y + r]];
  for (const p of pts) {
    const tx = Math.floor(p[0]), ty = Math.floor(p[1]);
    if (!inB(tx, ty)) return false;
    if (tiles[gi(tx, ty)] === TL.WATER) return false;
  }
  for (const e of entities) {
    if ((e.t === ET.STONE || e.t === ET.RUIN) && Math.hypot(e.x - x, e.y - y) < 0.7) return false;
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
      'sw.v6',
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
    const r = localStorage.getItem('sw.v6');
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
  if (e.t === ET.TREE) {
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
  lightC = new PIXI.Container();
  entC = new PIXI.Container();
  entC.sortableChildren = true;
  fxC = new PIXI.Container();

  world.addChild(lightC, entC, fxC);
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
  S.worldDay += dt / 210;
  const phase = S.worldDay % 1, sun = Math.sin(phase * TAU);
  state.daylight = sm(-0.12, 0.25, sun);
  state.nightF = 1 - sm(-0.28, 0.02, sun);
  state.dusk = Math.max(0, 1 - Math.abs(sun) * 6);
  state.sTint = SEAS_TINT[seasonOf(S.worldDay)];

  const ns = seasonOf(S.worldDay);
  if (ns !== state.curSeason) {
    state.curSeason = ns;
    entities.forEach((e) => {
      if (e.t === ET.TREE) retex(e);
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
        if (!entities.some((en) => Math.floor(en.x) === x && Math.floor(en.y) === y && (en.t === ET.TREE || en.t === ET.FLOWER || en.t === ET.STONE || en.t === ET.MUSH || en.t === ET.GLOW))) {
          addEntity({ t: r.t, x: x + 0.5, y: y + 0.5, ly: r.t === ET.FLOWER || r.t === ET.MUSH || r.t === ET.GLOW ? 0 : 4, data: r.d || {} });
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

  const dayT = tintInt(lerp(0.34, 1, state.daylight), lerp(0.42, 1, state.daylight), lerp(0.64, 1, state.daylight));
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
      e.sprite.texture = e.data.walk > 0 ? TEX.playerW : TEX.player;
      e._bs = WH[14] / e.sprite.texture.orig.height;
      e.sprite.scale.set((e.data.flip ? -1 : 1) * e._bs, e._bs);
      e.sprite.tint = 0xffffff;
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
  pHalo.alpha = 0.22 * state.nightF * (0.85 + 0.15 * Math.sin(state.gt * 1.7));

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
