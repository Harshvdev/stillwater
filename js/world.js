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
    if (
      (e.t === ET.STONE || e.t === ET.RUIN || e.t === ET.HERO_TREE) &&
      Math.hypot(e.x - x, e.y - y) < (e.t === ET.HERO_TREE ? 0.9 : 0.7)
    ) {
      return false;
    }
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
