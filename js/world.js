import { GRID, C, TL, ET, gi, inB, PAL } from './constants.js';
import { fbm, h2, mix3, rgb, rgba, ISO, iso } from './math.js';

export let tiles = new Uint8Array(GRID * GRID);
export let entities = [];
export let player = null;

export function setTiles(newTiles) {
  tiles = newTiles;
}

export function setEntities(newEnts) {
  entities = newEnts;
}

export function setPlayer(p) {
  player = p;
}

export function genWorld() {
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

export const mapCv = document.createElement('canvas');

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

export function paintGround() {
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

export function walkable(x, y) {
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

export function entityAt(gx, gy) {
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
