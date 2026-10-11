import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { createIsland, createFlowers, levelAtWorld, VOXEL, SEA_Y } from './island';
import { createWater, updateWater } from './water';
import { createTrees, updateTreeFade } from './trees';
import { createPlayer, updatePlayer } from './player';
import { createSandDeform } from './sandDeform';
import { initInput } from './input';
import { createCamera, updateCamera, resizeCamera, setRenderSize } from './camera';
import { PALETTE } from './palette';

// The scene renders into a small buffer and CSS scales the canvas up with
// nearest-neighbour, so smooth world motion lands on pixel steps - the GBA look.
// ?pixel=N overrides the chunk size (default 3).
const PIXEL = new URLSearchParams(window.location.search).get('pixel');
const SCALE = PIXEL ? Math.max(1, Math.min(8, parseFloat(PIXEL) || 3)) : 3;

function main(): void {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.sky);
  scene.fog = new THREE.Fog(PALETTE.fog, 150, 330);

  const camera = createCamera();
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setPixelRatio(1);
  // Shadow maps. PCF rather than the default Basic, so a shadow edge is a
  // couple of pixels of softening instead of a hard stair-step; at this render
  // resolution a Basic edge aliases badly as the camera pans.
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
  //
  // Tone mapping stays OFF and there is no OutputPass, deliberately. The
  // composer would otherwise apply a filmic curve that no colour in the
  // palette was authored against, which shifts every hue and crushes the flat
  // GBA ramps. The pass chain here is render -> bloom -> straight to screen,
  // so the only thing that changed on screen is the added glow.
  const composerTarget = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    // the bloom blurs, so the target must not be nearest-filtered
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });
  const composer = new EffectComposer(renderer, composerTarget);
  composer.addPass(new RenderPass(scene, camera));

  // Threshold sits above every static surface in the palette - sunlit sand
  // peaks near 0.70 linear - so the glow is confined to the water's sun glints,
  // which are driven past 1.0 in water.ts. Nothing else in the scene should
  // reach it.
  //
  // Strength and radius are both modest. At a third of screen resolution a
  // wide kernel spreads a single glint across a large part of the frame and
  // the whole image goes hazy, which reads as washed out rather than glowing.
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.45, 0.25, 0.85);
  composer.addPass(bloom);

  const resizeComposer = (): void => {
    const w = Math.max(1, Math.floor(window.innerWidth / SCALE));
    const h = Math.max(1, Math.floor(window.innerHeight / SCALE));
    composer.setSize(w, h);
    bloom.setSize(w, h);
  };
  resizeComposer();

  // Lighting budget. FACE_SHADE multiplies whatever the lights produce, and
  // its six values average about 0.8, so leaving the lights at their old level
  // and adding the baked term on top costs roughly a fifth of the whole image.
  // These intensities are therefore deliberately HIGHER than they were before
  // face shading: the baked term is the thing that darkens faces now, so the
  // lights have to overshoot to land on the same overall brightness.
  //
  // The hemisphere carries most of the level and lights every face regardless
  // of which way it points, so nothing facing away from the sun goes black. The
  // directional light adds the sun-facing lift and carries the shadow - it is
  // the only term a shadow can remove, which is what keeps a shadowed top face
  // at roughly 70% of a lit one instead of dropping to nothing.
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8fa4c4, 1.55));
  const sun = new THREE.DirectionalLight(0xfff4e0, 1.05);
  sun.position.set(60, 80, 40);
  sun.castShadow = true;

  // Tight shadow bounds around the player. The island is 172 voxels across and
  // the shadow camera is orthographic, so anything wider would spread the
  // limited shadow resolution over empty sea and make every shadow edge
  // crawl. The camera follows the player, so the bounds follow too.
  const SHADOW_HALF = 34;
  sun.shadow.camera.left = -SHADOW_HALF;
  sun.shadow.camera.right = SHADOW_HALF;
  sun.shadow.camera.top = SHADOW_HALF;
  sun.shadow.camera.bottom = -SHADOW_HALF;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 260;
  sun.shadow.mapSize.set(1024, 1024);
  // A voxel face lit at a grazing angle self-shadows badly without a bias;
  // normalBias handles the scale and keeps contact shadows attached to the
  // block that casts them, where a flat depth bias would detach them.
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.5;
  scene.add(sun);
  scene.add(sun.target);

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