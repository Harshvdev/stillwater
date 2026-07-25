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
      tiles[gi(x, y)] = t;
    }
  }

  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const idx = gi(x, y);
      if (tiles[idx] === TL.GRASS) {
        const p1 = Math.abs(fbm(x * 0.055 + 14.2, y * 0.055 + 83.1) - 0.5);
        const p2 = Math.abs(fbm(x * 0.04 + 31.7, y * 0.04 + 19.4) - 0.5);
        if ((p1 < 0.024 || p2 < 0.02) && h2(x * 3.3, y * 2.7) < 0.75) {
          tiles[idx] = TL.DIRT;
        }
      }
    }
  }

  entities = [];
  for (let y = 1; y < GRID - 1; y++) {
    for (let x = 1; x < GRID - 1; x++) {
      const t = tiles[gi(x, y)], r = h2(x * 3.7 + 11, y * 3.7 + 5);
      if (t === TL.GRASS || t === TL.DIRT) {
        const tr = fbm(x * 0.09 + 77, y * 0.09 + 31);
        if (tr > 0.66 && r < 0.72) {
          entities.push({ t: ET.TREE, x: x + 0.5, y: y + 0.5, ly: 4, data: { v: (r * 4) | 0 } });
          if (h2(x * 4.1, y * 5.3) < 0.7) tiles[gi(x, y)] = TL.DIRT;
        } else if (r > 0.972) {
          entities.push({ t: ET.GLOW, x: x + 0.5, y: y + 0.5, ly: 0, data: {} });
        } else if (r > 0.956) {
          entities.push({ t: ET.FLOWER, x: x + 0.5, y: y + 0.5, ly: 0, data: { c: (h2(x + 9, y + 3) * 5) | 0, moist: 1 } });
        } else if (r > 0.92) {
          entities.push({ t: ET.STONE, x: x + 0.5, y: y + 0.5, ly: 4, data: {} });
          if (h2(x * 2.9, y * 1.7) < 0.6) tiles[gi(x, y)] = TL.DIRT;
        } else if (r > 0.905) {
          entities.push({ t: ET.MUSH, x: x + 0.5, y: y + 0.5, ly: 0, data: { v: (r * 2) | 0 } });
        }
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

  for (let y = C - 3; y <= C + 3; y++) {
    for (let x = C - 3; x <= C + 3; x++) {
      if ((x - C) * (x - C) + (y - C) * (y - C) <= 12) {
        entities = entities.filter((e) => !(Math.floor(e.x) === x && Math.floor(e.y) === y));
      }
    }
  }

  [[C - 3, C - 2], [C + 3, C - 1], [C - 1, C + 3], [C + 2, C - 3]].forEach((p) => {
    entities.push({ t: ET.RUIN, x: p[0] + 0.5, y: p[1] + 0.5, ly: 4, data: {} });
    tiles[gi(p[0], p[1])] = TL.DIRT;
  });
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

export function paintGround() {
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
