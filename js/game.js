import { GRID, C, TL, ET, SEAS_TINT, seasonOf, WH, gi, inB } from './constants.js';
import { TAU, clamp, lerp, sm, iso, tintInt, initIsoBounds, h2, ISO } from './math.js';
import { tiles, entities, player, walkable, entityAt, mapCv, paintGround } from './world.js';
import { TEX, texFor, buildSprites, buildTextures } from './sprites.js';
import { createGroundFilter } from './shaders.js';
import { state, view, regrow, ripples, mouse, S, getMinZoom } from './game-state.js';
import { whisper, mem, AMB, memSet } from './whisper.js';
import { save } from './storage.js';
import { keys, touchVec } from './input.js';
import { screenToGrid } from './actions.js';
import { updatePlayerCharacter } from './player.js';

export let app = null;
export let groundFilter = null;
export let world = null;
export let shdC = null;
export let shdG = null;
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
  pHalo.tint = 0xffc866;
  pHalo.scale.set(3.5);
  pHalo.alpha = 0.35;
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
  if (e.t === ET.TREE || e.t === ET.HERO_TREE) {
    const scaleVar = 0.9 + h2(e.x * 6.3 + 2.1, e.y * 5.7 + 1.9) * 0.22;
    const flip = h2(e.x * 3.1 + 8.4, e.y * 4.3 + 2.7) > 0.5 ? -1 : 1;
    t.scale.set(bs * scaleVar * flip, bs * scaleVar);
  } else {
    t.scale.set(bs);
  }
  e.sprite = t;
  entC.addChild(t);
  return t;
}

export function retex(e) {
  if (!e.sprite) return;
  e.sprite.texture = texFor(e, state.curSeason);
  e._bs = WH[e.t] / e.sprite.texture.orig.height;
  if (e.t === ET.TREE || e.t === ET.HERO_TREE) {
    const scaleVar = 0.9 + h2(e.x * 6.3 + 2.1, e.y * 5.7 + 1.9) * 0.22;
    const flip = h2(e.x * 3.1 + 8.4, e.y * 4.3 + 2.7) > 0.5 ? -1 : 1;
    e.sprite.scale.set(e._bs * scaleVar * flip, e._bs * scaleVar);
  } else {
    e.sprite.scale.set(e._bs);
  }
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

  const isLampLit = state.nightF > 0.01 || state.dusk > 0.01;
  const lanternPower = isLampLit ? Math.max(state.nightF, state.dusk * 0.85) : 0.0;

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

    const playerScreenX = world.x + (pp.x + 3) * view.z;
    const playerScreenY = world.y + pp.y * view.z;

    gu.u_lanternPos = [playerScreenX, playerScreenY];
    gu.u_lanternPower = lanternPower;
    gu.u_zoom = view.z;
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
