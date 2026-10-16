import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createIsland, createFlowers, levelAtWorld, VOXEL, SEA_Y } from './island';
import { createWater, updateWater } from './water';
import { createTrees, updateTreeFade } from './trees';
import { createPlayer, updatePlayer } from './player';
import { createSandDeform } from './sandDeform';
import { initInput } from './input';
import { createCamera, updateCamera, resizeCamera, setRenderSize } from './camera';
import { createSky, horizonColor } from './sky';

// The scene renders into a small buffer and CSS scales the canvas up with
// nearest-neighbour, so smooth world motion lands on pixel steps - the GBA look.
// ?pixel=N overrides the chunk size (default 3).
const PIXEL = new URLSearchParams(window.location.search).get('pixel');
const SCALE = PIXEL ? Math.max(1, Math.min(8, parseFloat(PIXEL) || 3)) : 3;

function main(): void {
  const scene = new THREE.Scene();
  // No scene.background: the sky is a real dome now (sky.ts), so that the
  // gradient, the sun and the fog can all be made to agree with each other.
  // The fog is keyed to the dome's own horizon colour rather than to a
  // separately chosen palette entry, which is what used to leave a visible
  // seam where the far ocean met the background.
  scene.fog = new THREE.Fog(horizonColor().getHex(), 120, 300);

  const camera = createCamera();
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setPixelRatio(1);
  // Tone mapping happens once, at the very end, in OutputPass. three forces
  // NoToneMapping on any material that renders into a render target, so
  // setting this here does not double-apply it to the scene pass - it only
  // tells OutputPass which curve to run.
  //
  // Neutral (Khronos PBR Neutral) rather than ACES: ACES deliberately trades
  // saturation for highlight rolloff, which visibly drags the greens and
  // cyans in this palette toward grey. Neutral rolls off just as hard but
  // holds hue, which is what a limited hand-picked ramp needs.
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  // Shadow maps. PCF, which is the filtered one. Note that
  // THREE.PCFSoftShadowMap still exists as an export in r186 but the renderer
  // no longer implements it: WebGLShadowMap silently rewrites it to
  // PCFShadowMap and logs "PCFSoftShadowMap has been removed". Asking for soft
  // here would therefore be a no-op that looks like it worked.
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const fit = (): void => {
    const w = Math.max(1, Math.floor(window.innerWidth / SCALE));
    const h = Math.max(1, Math.floor(window.innerHeight / SCALE));
    renderer.setSize(w, h, false);
    setRenderSize(w, h);
  };
  fit();
  renderer.domElement.id = 'game';
  document.body.appendChild(renderer.domElement);

  // ---------------------------------------------------------------- bloom
  // A composer chain, rendered into a half-float target so bright pixels carry
  // values above 1.0 into the bloom's high-pass. Without HDR there is nothing
  // for a threshold to separate, and the glow either covers everything or
  // nothing at all.
  const composerTarget = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    // the bloom blurs, so the target must not be nearest-filtered
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });
  const composer = new EffectComposer(renderer, composerTarget);
  composer.addPass(new RenderPass(scene, camera));

  // Runs in linear HDR, before OutputPass tone maps. The threshold is above 1.0
  // on purpose: sunlit sand lands around 1.18 linear (see the light budget
  // above), so anything at or below 1.0 would be ordinary ground and would
  // glow. Above that threshold only three things qualify - the sun disc, the
  // water's sun glints and white foam - because those are the only surfaces
  // authored past white.
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.3, 1.22);
  composer.addPass(bloom);

  // Last in the chain, and the reason the pass order above is safe. Everything
  // upstream works in linear HDR; OutputPass applies the tone curve and the
  // sRGB encode in one go, at the only point where both are wanted. Leaving it
  // off (as this did before) is why the scene previously looked flat: bright
  // pixels clipped at 1.0 with no rolloff, and no highlight could ever bloom
  // through to white.
  composer.addPass(new OutputPass());

  const resizeComposer = (): void => {
    const w = Math.max(1, Math.floor(window.innerWidth / SCALE));
    const h = Math.max(1, Math.floor(window.innerHeight / SCALE));
    composer.setSize(w, h);
    bloom.setSize(w, h);
  };
  resizeComposer();

  // ---------------------------------------------------------------- lights
  // Budget, now that the baked FACE_SHADE table is gone.
  //
  // Previously the hemisphere ran at 1.55 and the sun at 1.05, because a baked
  // per-face multiply was also being applied and the two had to be kept low
  // enough that their sum did not blow the palette out. That baked term is gone,
  // so these are now chosen on their own terms - and the split has moved a long
  // way the other way.
  //
  // The directional light does almost all the work. It is the only light that
  // casts, so it is also the only one a shadow can remove: anything the
  // hemisphere contributes is shadow-proof, and every unit of ambient spent
  // here is a unit of contrast a cast shadow cannot recover. At the old 1.55
  // the ambient was brighter than the sun and shadows were all but invisible.
  //
  // The hemisphere is now a sky fill, not a second key. It still lights every
  // face regardless of which way it points, so nothing facing away from the sun
  // goes black, and its ground colour is the warm sand bounce that keeps
  // undersides from reading as cold holes.
  //
  // The two numbers are chosen together, against one target: the brightest lit
  // surface in the palette - sunlit sand, albedo ~0.93 linear, top face at
  // N.L = 0.74 - should land at about 1.0 in linear space. Landing there is
  // what keeps the bloom threshold meaningful, because a value above 1.0 is
  // then reserved for actual highlights instead of for ordinary sunlit ground.
  //
  // Overexpose and the whole beach climbs past the threshold and glows.
  scene.add(new THREE.HemisphereLight(0xdcefff, 0xb08a5e, 0.42));
  const sun = new THREE.DirectionalLight(0xfff2dc, 1.35);
  sun.position.set(60, 80, 40);
  sun.castShadow = true;

  // Tight shadow bounds around the player. The island is 172 voxels across and
  // the shadow camera is orthographic, so anything wider would spread the
  // limited shadow resolution over empty sea and make every shadow edge
  // crawl. The camera follows the player, so the bounds follow too.
  const SHADOW_HALF = 46;
  sun.shadow.camera.left = -SHADOW_HALF;
  sun.shadow.camera.right = SHADOW_HALF;
  sun.shadow.camera.top = SHADOW_HALF;
  sun.shadow.camera.bottom = -SHADOW_HALF;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 320;
  // 2048 over a 92-unit box is ~22 texels per voxel. That is the difference
  // between a tree's shadow reading as the tree's shape and reading as a
  // featureless smudge. It is affordable because the shadow pass is depth-only
  // and the whole scene is 4 instanced draw calls.
  sun.shadow.mapSize.set(2048, 2048);
  // A voxel face lit at a grazing angle self-shadows badly without a bias.
  // normalBias handles the scale and keeps contact shadows attached to the
  // block that casts them, where a flat depth bias would detach them.
  //
  // This was 0.5, which was enormous next to a 1-unit voxel: it pushed every
  // shadow lookup half a block up the surface normal, which is enough to slide
  // a canopy's shadow clear off the ground it should be sitting on. A tenth of
  // a block is enough to kill the acne and small enough that the shadow still
  // touches its caster.
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.05;
  scene.add(sun);
  scene.add(sun.target);

  scene.add(createSky());

  const island = createIsland();
  const trees = createTrees();
  scene.add(island);
  scene.add(trees);
  scene.add(createFlowers());

  const { mesh: water, ocean } = createWater();
  scene.add(water);
  scene.add(ocean);

  // Everything solid casts onto everything solid. The ocean plane is excluded:
  // it is a single huge quad at sea level, so letting it receive would put a
  // hard shadow edge across open water.
  island.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  trees.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  water.receiveShadow = true;

  const player = createPlayer();
  // drop the player onto the island rather than at a fixed height
  player.position.set(0, levelAtWorld(0, 0) * VOXEL, 0);
  // The player casts now. There used to be a hand-placed translucent quad for
  // this because nothing else in the scene cast; with the sun's shadow map
  // doing real work, a real shadow is both cheaper to maintain and correctly
  // shaped - it stretches and rotates with the sun instead of sitting flat and
  // square under the figure whichever way the light comes from.
  player.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
  });
  scene.add(player);

  const sand = createSandDeform();

  initInput();

  window.addEventListener('resize', () => {
    fit();
    resizeComposer();
    resizeCamera(camera);
  });

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    updatePlayer(player, dt);
    sand.update(dt, player.position);
    updateWater(t);
    updateCamera(camera, player.position);
    // fade anything standing between the camera and the player, after the
    // camera has settled on its new position
    updateTreeFade(player.position);
    // The shadow camera is orthographic and only covers SHADOW_HALF around its
    // target, so it has to travel with the player or shadows simply stop being
    // drawn once they leave that box. The light keeps its fixed world position
    // and only the target moves, which leaves the sun angle unchanged.
    sun.target.position.set(player.position.x, 0, player.position.z);
    sun.target.updateMatrixWorld();
    sun.position.set(player.position.x + 60, 80, player.position.z + 40);
    sun.updateMatrixWorld();
    // through the composer, not straight to the screen, so bloom is applied
    composer.render();
  });

  // debug hooks, mirroring the original's
  Object.assign(window as unknown as Record<string, unknown>, {
    __seaY: SEA_Y,
    __groundHeight: (x: number, z: number) => levelAtWorld(x, z) * VOXEL,
    __three: { renderer, scene, camera },
    __updateWater: updateWater,
    __player: player,
    // one simulation step with no render, so movement can be driven and
    // inspected in environments where rAF is throttled
    __step: (dt = 1 / 60, t = 0): void => {
      updatePlayer(player, dt);
      sand.update(dt, player.position);
      updateWater(t);
      updateTreeFade(player.position);
    },
    // average ms per render call, bypassing rAF throttling in headless browsers
    __renderMs: (n = 20): number => {
      const t0 = performance.now();
      for (let i = 0; i < n; i++) renderer.render(scene, camera);
      return (performance.now() - t0) / n;
    },
  });
}

main();