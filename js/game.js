import { GRID, C, TL, ET, SEAS_TINT, seasonOf, WH, gi, inB } from './constants.js';
import { TAU, clamp, lerp, sm, iso, tintInt, initIsoBounds } from './math.js';
import { tiles, entities, player, walkable, entityAt, mapCv, paintGround } from './world.js';
import { TEX, texFor, buildSprites, buildTextures } from './sprites.js';
import { createGroundFilter } from './shaders.js';
import { state, view, regrow, ripples, mouse, S } from './game-state.js';
import { whisper, mem, AMB, memSet } from './whisper.js';
import { save } from './storage.js';
import { keys, touchVec } from './input.js';
import { screenToGrid } from './actions.js';

export let app = null;
export let groundFilter = null;
export let world = null;
export let lightC = null;
export let entC = null;
export let fxC = null;
export let ripplesG = null;
export let hoverG = null;
export let pHalo = null;
export const flies = [];
export const POOL = [];
export const parts = [];

export function initApp() {
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

export function burst(wx, wy, col, n) {
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

export function makeSprite(e) {
  const t = new PIXI.Sprite(texFor(e, state.curSeason));
  t.anchor.set(0.5, 1);
  const bs = WH[e.t] / t.texture.orig.height;
  e._bs = bs;
  t.scale.set(bs);
  e.sprite = t;
  entC.addChild(t);
  return t;
}

export function retex(e) {
  if (!e.sprite) return;
  e.sprite.texture = texFor(e, state.curSeason);
  e._bs = WH[e.t] / e.sprite.texture.orig.height;
  e.sprite.scale.set(e._bs);
}

export function makeHalo(e) {
  const h = new PIXI.Sprite(TEX.dot);
  h.anchor.set(0.5);
  h.blendMode = PIXI.BLEND_MODES.ADD;
  h.tint = 0x9fc8ff;
  h.scale.set(2.4);
  lightC.addChild(h);
  e.halo = h;
}

export function addEntity(e) {
  entities.push(e);
  makeSprite(e);
  if (e.t === ET.GLOW) makeHalo(e);
  return e;
}

export function remEntity(e) {
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

export function buildAllSprites() {
  entities.forEach((e) => {
    makeSprite(e);
    if (e.t === ET.GLOW) makeHalo(e);
  });
}

let regrowTick = 5, spreadTick = 16, ambT = 24, saveT = 0;

export function update(dt, spreadFlowerFn) {
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
  view.z += (view.zt - view.z) * Math.min(1, dt * 6);

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
