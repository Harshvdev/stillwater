import { GRID, TL, ET, inB, gi } from './constants.js';
import { TAU, ISO } from './math.js';
import { tiles, entities, player, entityAt } from './world.js';
import { whisper, mem, GATH } from './whisper.js';
import { regrow, ripples, state, view } from './game-state.js';
import { burst, world, makeSprite, retex, remEntity } from './game.js';

export function scheduleRegrow(x, y, t, d, sec) {
  regrow[x + ',' + y] = { t, d, at: Date.now() + sec * 1000 };
}

export function gather(e, wx, wy) {
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

export function newFlowerAt(x, y) {
  const e = { t: ET.FLOWER, x: x + 0.5, y: y + 0.5, ly: 0, data: { c: (Math.random() * 5) | 0, moist: 1 } };
  entities.push(e);
  makeSprite(e);
}

export function spreadFlower() {
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

export function sing() {
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

export function screenToGrid(sx, sy) {
  const wx = (sx - world.x) / view.z;
  const wy = (sy - world.y) / view.z;
  const a = (wx - ISO.OFFX) / ISO.HW;
  const b = (wy - ISO.OFFY) / ISO.HH;
  return [(a + b) / 2, (b - a) / 2];
}

export function actAt(sx, sy) {
  const g = screenToGrid(sx, sy);
  if (Math.hypot(g[0] - player.x, g[1] - player.y) > 2.8) {
    ripples.push({ x: g[0], y: g[1], t0: state.gt });
    return;
  }
  const e = entityAt(g[0], g[1]);
  if (e) gather(e, g[0], g[1]);
  else ripples.push({ x: g[0], y: g[1], t0: state.gt });
}
