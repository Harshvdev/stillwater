import * as THREE from 'three';
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

  const fit = (): void => {
    const w = Math.max(1, Math.floor(window.innerWidth / SCALE));
    const h = Math.max(1, Math.floor(window.innerHeight / SCALE));
    renderer.setSize(w, h, false);
    setRenderSize(w, h);
  };
  fit();
  renderer.domElement.id = 'game';
  document.body.appendChild(renderer.domElement);

  // Constant per face on an axis-aligned cube, so lighting stays perfectly
  // flat; hemisphere alone would leave +x and -x identical.
  scene.add(new THREE.HemisphereLight(0xffffff, 0x6f7a9a, 1.35));
  const sun = new THREE.DirectionalLight(0xfff4e0, 1.15);
  sun.position.set(60, 80, 40);
  scene.add(sun);

  scene.add(createIsland());
  scene.add(createTrees());
  scene.add(createFlowers());

  const { mesh: water, ocean } = createWater();
  scene.add(water);
  scene.add(ocean);

  const player = createPlayer();
  // drop the player onto the island rather than at a fixed height
  player.position.set(0, levelAtWorld(0, 0) * VOXEL, 0);
  scene.add(player);

  const sand = createSandDeform();

  initInput();

  window.addEventListener('resize', () => {
    fit();
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
    renderer.render(scene, camera);
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