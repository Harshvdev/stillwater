import { seasonOf } from './constants.js';
import { iso } from './math.js';
import { S, state, view } from './game-state.js';
import { tiles, player, genWorld, mapCv, paintGround } from './world.js';
import { buildSprites, buildTextures } from './sprites.js';
import { whisper } from './whisper.js';
import { load, save } from './storage.js';
import { setupInput } from './input.js';
import {
  app,
  initApp,
  groundFilter,
  world,
  buildAllSprites,
  update
} from './game.js';
import { spreadFlower } from './actions.js';

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
