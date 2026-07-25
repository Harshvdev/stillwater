import { TAU, h2, soft, disc, rgb, rgba } from './math.js';
import { FC, WH, ET } from './constants.js';
import { state } from './game-state.js';

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

export const CV = {};
export const TEX = {};

export function buildSprites() {
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

export function buildTextures() {
  for (const k in CV) {
    TEX[k] = PIXI.Texture.from(CV[k], { scaleMode: PIXI.SCALE_MODES.LINEAR, resolution: 1 });
  }
}

export function texFor(e, curSeasonIdx = state.curSeason) {
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
