import { GRID, ET } from './constants.js';
import { tiles, entities, player, setTiles, setEntities, setPlayer } from './world.js';
import { S } from './game-state.js';
import { memSet, setMemSet } from './whisper.js';

export function enc(u) {
  let s = '';
  for (let i = 0; i < u.length; i += 8192) {
    s += String.fromCharCode.apply(null, u.subarray(i, i + 8192));
  }
  return btoa(s);
}

export function dec(s) {
  const b = atob(s), u = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
  return u;
}

export function save() {
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

export function load() {
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
