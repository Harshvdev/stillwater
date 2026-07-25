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

function dLumpyCanopy(x, trunkInfo, lobes, seasonIdx) {
  // 1. Trunk (drawn FIRST so lowest lobe swallows the top half of the trunk!)
  x.fillStyle = trunkInfo.barkColor || 'rgb(78,52,36)';
  x.beginPath();
  x.moveTo(trunkInfo.leftRootX, trunkInfo.baseY);
  x.lineTo(trunkInfo.topX - trunkInfo.topW * 0.5, trunkInfo.topY);
  x.lineTo(trunkInfo.topX + trunkInfo.topW * 0.5, trunkInfo.topY);
  x.lineTo(trunkInfo.rightRootX, trunkInfo.baseY);
  x.closePath();
  x.fill();

  // Bark shading
  x.fillStyle = 'rgba(28,16,10,0.5)';
  x.beginPath();
  x.moveTo(trunkInfo.topX, trunkInfo.topY);
  x.lineTo(trunkInfo.topX + trunkInfo.topW * 0.5, trunkInfo.topY);
  x.lineTo(trunkInfo.rightRootX, trunkInfo.baseY);
  x.lineTo(trunkInfo.topX, trunkInfo.baseY);
  x.closePath();
  x.fill();

  // Season palette config (NEVER ASH GREY!)
  let baseCol, coolUndersideCol, warmSunCol, accentType;

  if (seasonIdx === 0) { // Spring (blossom / pale living green)
    baseCol = 'rgb(76,156,98)';
    coolUndersideCol = 'rgba(18,52,36,0.72)';
    warmSunCol = 'rgb(172,220,128)';
    accentType = 'blossom';
  } else if (seasonIdx === 1) { // Summer (warm living green in sun)
    baseCol = 'rgb(66,148,74)';
    coolUndersideCol = 'rgba(14,48,30,0.76)';
    warmSunCol = 'rgb(160,215,102)';
    accentType = 'sun';
  } else if (seasonIdx === 2) { // Autumn (ember in autumn)
    baseCol = 'rgb(192,86,36)';
    coolUndersideCol = 'rgba(60,20,14,0.76)';
    warmSunCol = 'rgb(240,165,52)';
    accentType = 'autumn';
  } else { // Winter (frosted pine green, NEVER ASH)
    baseCol = 'rgb(44,92,78)';
    coolUndersideCol = 'rgba(12,40,34,0.80)';
    warmSunCol = 'rgb(86,146,130)';
    accentType = 'snow';
  }

  // 2. Overlapping Lobes (3 to 5 lobes)
  lobes.forEach((lb) => {
    const cx = lb.cx, cy = lb.cy, rx = lb.rx, ry = lb.ry;

    // A) Darker cool underside shadow
    soft(x, cx + 0.6, cy + ry * 0.35, rx * 0.95, ry * 0.65, coolUndersideCol);

    // B) Main living foliage body
    soft(x, cx, cy, rx, ry, baseCol);

    // C) Warm sun-kissed top highlight
    soft(x, cx - rx * 0.25, cy - ry * 0.30, rx * 0.72, ry * 0.52, warmSunCol);
  });

  // 3. Seasonal detailing overlays
  if (accentType === 'blossom') {
    lobes.forEach((lb, i) => {
      const petals = 3 + (i % 3);
      for (let p = 0; p < petals; p++) {
        const a = (p / petals) * TAU + i * 0.8;
        const px = lb.cx + Math.cos(a) * (lb.rx * 0.6);
        const py = lb.cy + Math.sin(a) * (lb.ry * 0.6) - 1;
        soft(x, px, py, 1.6, 1.4, 'rgba(255,214,228,0.88)');
        soft(x, px - 0.4, py - 0.4, 0.9, 0.8, 'rgba(255,245,248,0.95)');
      }
    });
  } else if (accentType === 'autumn') {
    lobes.forEach((lb, i) => {
      const embers = 2 + (i % 3);
      for (let e = 0; e < embers; e++) {
        const a = (e / embers) * TAU + i * 1.1;
        const ex = lb.cx + Math.cos(a) * (lb.rx * 0.5);
        const ey = lb.cy + Math.sin(a) * (lb.ry * 0.5);
        soft(x, ex, ey, 1.8, 1.5, 'rgba(255,120,38,0.82)');
      }
    });
  } else if (accentType === 'snow') {
    lobes.forEach((lb) => {
      if (lb.cy < trunkInfo.baseY - 12) {
        soft(x, lb.cx, lb.cy - lb.ry * 0.4, lb.rx * 0.8, lb.ry * 0.38, 'rgba(235,245,248,0.92)');
      }
    });
  }
}

function dTree(x, seasonIdx = 1, varIdx = 0) {
  const trunkInfo = {
    topX: 18,
    topY: 22,
    topW: 3.6,
    baseY: 36,
    leftRootX: 15.5,
    rightRootX: 20.5,
    barkColor: 'rgb(78,52,36)'
  };

  let lobes;
  if (varIdx === 1) { // Taller, leaning right
    lobes = [
      { cx: 17, cy: 26, rx: 11.5, ry: 9 },  // Lowest lobe swallows trunk top (y=22..32)
      { cx: 11, cy: 20, rx: 8, ry: 7 },
      { cx: 25, cy: 18, rx: 9.5, ry: 8.5 },
      { cx: 21, cy: 11, rx: 9, ry: 8 },
      { cx: 14, cy: 11, rx: 6, ry: 5 }
    ];
  } else if (varIdx === 2) { // Broad & sweeping
    lobes = [
      { cx: 18, cy: 24, rx: 14, ry: 10 },   // Lowest lobe swallows trunk top (y=22..32)
      { cx: 9, cy: 21, rx: 8.5, ry: 7 },
      { cx: 27, cy: 22, rx: 8.5, ry: 7 },
      { cx: 18, cy: 14, rx: 10, ry: 8.5 },
      { cx: 17, cy: 8.5, rx: 6.5, ry: 5.5 }
    ];
  } else if (varIdx === 3) { // Asymmetrical twin-crown
    lobes = [
      { cx: 19, cy: 25, rx: 12, ry: 9 },    // Lowest lobe swallows trunk top
      { cx: 12, cy: 18, rx: 9.5, ry: 8 },
      { cx: 24, cy: 22, rx: 7.5, ry: 6.5 },
      { cx: 14, cy: 11, rx: 8, ry: 7 },
      { cx: 23, cy: 12, rx: 7.5, ry: 6.5 }
    ];
  } else { // Variant 0 (Default cozy lumpy tree)
    lobes = [
      { cx: 18, cy: 25, rx: 12.5, ry: 9.5 }, // Lowest lobe swallows trunk top
      { cx: 12, cy: 19, rx: 8.5, ry: 7.5 },
      { cx: 24, cy: 20, rx: 9, ry: 8 },
      { cx: 17, cy: 13, rx: 9.5, ry: 8.5 },
      { cx: 20, cy: 9, rx: 6.5, ry: 5.5 }
    ];
  }

  dLumpyCanopy(x, trunkInfo, lobes, seasonIdx);
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
  const b = walk ? Math.sin(walk * 11) * 0.8 : 0;
  const isLampLit = typeof state !== 'undefined' && state && (state.nightF > 0.02 || state.dusk > 0.05);

  // Deep indigo-slate cloak body & hood
  soft(x, 7, 9 + b, 4.8, 5.8, 'rgb(38,48,64)');
  soft(x, 7, 10 + b, 3.4, 4.2, 'rgb(26,34,46)');

  // Hood top peak
  disc(x, 7, 5 + b, 2.6, 'rgb(38,48,64)');

  // Deep hood interior shadow
  disc(x, 7, 5.5 + b, 1.8, 'rgb(18,22,30)');

  // Implied face: SOFT WARM SMUDGE
  soft(x, 7, 5.5 + b, 1.2, 1.1, 'rgba(255, 225, 160, 0.85)');

  // Lantern (only at dusk / night!)
  if (isLampLit) {
    soft(x, 10.5, 9.5 + b, 2.4, 2.4, 'rgba(255, 190, 70, 0.85)');
    disc(x, 10.5, 9.5 + b, 1.4, 'rgb(45,34,24)');
    soft(x, 10.5, 9.5 + b, 0.9, 0.9, 'rgb(255,255,230)');
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

function dHeroTree(x, seasonIdx = 1, varIdx = 0) {
  const trunkInfo = {
    topX: 24,
    topY: 28,
    topW: 5.5,
    baseY: 52,
    leftRootX: 19,
    rightRootX: 29,
    barkColor: 'rgb(72,48,32)'
  };

  let lobes;
  if (varIdx === 1) {
    lobes = [
      { cx: 24, cy: 35, rx: 17, ry: 12.5 },  // Swallow trunk top (y=28..45)
      { cx: 13, cy: 28, rx: 11.5, ry: 9.5 },
      { cx: 35, cy: 27, rx: 13, ry: 10.5 },
      { cx: 22, cy: 19, rx: 14, ry: 11.5 },
      { cx: 16, cy: 12, rx: 9.5, ry: 8 },
      { cx: 31, cy: 13, rx: 10, ry: 8.5 }
    ];
  } else if (varIdx === 2) {
    lobes = [
      { cx: 24, cy: 33, rx: 18.5, ry: 13.5 },
      { cx: 12, cy: 26, rx: 12.5, ry: 10 },
      { cx: 36, cy: 29, rx: 11.5, ry: 9.5 },
      { cx: 25, cy: 21, rx: 15, ry: 12 },
      { cx: 19, cy: 12, rx: 10.5, ry: 9 },
      { cx: 29, cy: 11, rx: 9, ry: 7.5 }
    ];
  } else {
    lobes = [
      { cx: 24, cy: 34, rx: 17.5, ry: 13 },  // Swallow trunk top (y=28..44)
      { cx: 14, cy: 27, rx: 12, ry: 10 },
      { cx: 34, cy: 28, rx: 12.5, ry: 10.5 },
      { cx: 24, cy: 20, rx: 14.5, ry: 12 },
      { cx: 18, cy: 13, rx: 10, ry: 8.5 },
      { cx: 30, cy: 12, rx: 9.5, ry: 8 }
    ];
  }

  dLumpyCanopy(x, trunkInfo, lobes, seasonIdx);
}

function dDot(x) {
  soft(x, 4, 4, 3.6, 3.6, 'rgb(255,255,255)');
}

export const CV = {};
export const TEX = {};

export function buildSprites() {
  for (let s = 0; s < 4; s++) {
    for (let v = 0; v < 4; v++) {
      CV['tree_' + s + '_' + v] = paintSprite(36, 40, (x) => dTree(x, s, v));
      CV['heroTree_' + s + '_' + v] = paintSprite(48, 56, (x) => dHeroTree(x, s, v));
    }
    CV['tree' + s] = CV['tree_' + s + '_0'];
    CV['heroTree' + s] = CV['heroTree_' + s + '_0'];
  }
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

export function buildTextures() {
  for (const k in CV) {
    TEX[k] = PIXI.Texture.from(CV[k], { scaleMode: PIXI.SCALE_MODES.LINEAR, resolution: 1 });
  }
}

export function texFor(e, curSeasonIdx = state.curSeason) {
  switch (e.t) {
    case ET.TREE: {
      const v = (e.data && e.data.v !== undefined) ? (e.data.v % 4) : 0;
      return TEX['tree_' + curSeasonIdx + '_' + v] || TEX['tree' + curSeasonIdx];
    }
    case ET.HERO_TREE: {
      const v = (e.data && e.data.v !== undefined) ? (e.data.v % 4) : 0;
      return TEX['heroTree_' + curSeasonIdx + '_' + v] || TEX['heroTree' + curSeasonIdx];
    }
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
