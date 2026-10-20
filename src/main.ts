import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createIsland, createFlowers, createTallGrass, levelAtWorld, VOXEL, SEA_Y } from './island';
import { createWater, updateWater } from './water';
import { createTrees, updateTreeFade, treeLocations } from './trees';
import { createPlayer, updatePlayer } from './player';
import { createSandDeform } from './sandDeform';
import { initInput } from './input';
import { createCamera, updateCamera, resizeCamera, setRenderSize, snapToPixelGrid } from './camera';
import { SUN_DISTANCE } from './constants';
import {
  dayState, advanceDayNight, getHour, setHour, isRunning, setRunning,
  getCycleLength, setCycleLength,
} from './daynight';
// TEMPORARY: the shared debug sidebar hosting the day/night and cloud controls.
// Delete sidebar.ts, daySlider.ts and cloudSlider.ts, plus the three imports
// below and the init/sync calls in main(), to remove all of it; nothing else
// reads from any of them.
import { initSidebar } from './sidebar';
import { initDaySlider, syncDaySlider } from './daySlider';
import { initCloudSlider, syncCloudSlider } from './cloudSlider';
import { updateWind } from './wind';
import { updateClouds, cloudUniforms } from './clouds';
import { initCoordinates, syncCoordinates } from './coordinates';
import { createFallingLeaves, updateFallingLeaves } from './fallingLeaves';

// The scene renders into a small buffer and CSS scales the canvas up with
// nearest-neighbour, so smooth world motion lands on pixel steps - the GBA look.
// ?pixel=N overrides the chunk size (default 3).
const PIXEL = new URLSearchParams(window.location.search).get('pixel');
const SCALE = PIXEL ? Math.max(1, Math.min(8, parseFloat(PIXEL) || 3)) : 3;

function main(): void {
  const scene = new THREE.Scene();
  // No sky, no background and no fog, all on purpose.
  //
  // The camera is orthographic and locked to a (-1,-1,-1) view direction, so the
  // projection never puts a horizon on screen: the top of the frame is always
  // sea, whatever the zoom. That was verified rather than assumed - a sky dome
  // at radius 460 and scene.fog(120, 300) were both A/B'd against the rendered
  // framebuffer across every hour and every reachable zoom, and both changed
  // exactly zero pixels (the deepest visible point is ~102 units, short of the
  // fog's near plane).
  //
  // So there is nothing here for a sky to fill and nothing for fog to fade.
  // Removing both is not a downgrade - it is the same image with 241 lines of
  // shader and a dead uniform hook taken out.
  //
  // The consequence worth naming: with no horizon there is no aerial
  // perspective either, so the scene has no distance cue at all. Far grass is
  // exactly as saturated as near grass. That is inherent to the projection, and
  // it means every cue for depth has to come from geometry and cast shadow -
  // which is why the flat interior is the thing worth fixing next.

  // The buffer size has to be known BEFORE the camera is built, not after: the
  // ortho frustum's horizontal extent is derived from it, and camera.ts snaps
  // the rig using a single world-per-pixel that is only valid when the buffer's
  // pixels are square. Constructing the camera first left it at aspect 1/1 -
  // so a buffer 441x184 was being stretched to a 44x44-unit square, making every
  // pixel 0.0998 units wide against 0.2391 tall. Non-square pixels are exactly
  // the shimmer this is meant to prevent, so the order matters.
  setRenderSize(
    Math.max(1, Math.floor(window.innerWidth / SCALE)),
    Math.max(1, Math.floor(window.innerHeight / SCALE))
  );

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

  // The backing store is the window divided by SCALE, floored. That floor is
  // what makes the upscale non-integer: a 1324px window at SCALE 3 gives 441
  // texels, and the browser then stretches those 441 to 1324 CSS px - a factor
  // of 3.0023. Under `image-rendering: pixelated` that factor is uneven, so
  // alternate source pixels land on 3 and 4 device pixels and the grid itself
  // beats against itself, independently of anything the renderer does.
  //
  // So the canvas is sized in whole SCALE blocks explicitly (updateStyle false,
  // then our own width/height) rather than left to fill the window. The cost is
  // up to SCALE-1 unused px on each axis, which is invisible, and the gain is
  // that every rendered texel covers exactly SCALE device pixels - which is
  // also the assumption camera.ts's world-per-pixel snap is built on.
  const fit = (): void => {
    const w = Math.max(1, Math.floor(window.innerWidth / SCALE));
    const h = Math.max(1, Math.floor(window.innerHeight / SCALE));
    renderer.setSize(w, h, false);
    const el = renderer.domElement;
    el.style.width = `${w * SCALE}px`;
    el.style.height = `${h * SCALE}px`;
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

  // Runs in linear HDR, before OutputPass tone maps, so this threshold is
  // chosen against measured linear values rather than against what anything
  // looks like on screen. With the light budget above, the scene separates
  // cleanly:
  //
  //     sunlit sand (brightest ordinary surface)   1.00
  //     water glint, at the top of a twinkle      ~2.2
  //     the sun's disc on the sky dome             4.0
  //
  // 1.4 sits above everything that is merely bright and below the sparkle,
  // and that gap is the whole point: it lets the glints and the sun glow while
  // leaving every ordinary surface crisp. This was tried at 1.05, just under
  // the old foam, and every wave crest bloomed - the thin white lines got
  // smeared by the blur into soft clouds that read as fog lying on the sea.
  // Bloom is a highlight effect, and anything covering a large area must never
  // qualify for it.
  //
  // The foam is gone now, which leaves the gap wider rather than changing the
  // threshold: sunlit sand still tops out at 1.0, so 1.4 is still the line
  // between a lit surface and a highlight.
  //
  // Strength is up from 0.5 to make up for far fewer pixels clearing the bar,
  // and the radius is tightened so the sparkle stays a sparkle.
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.75, 0.25, 1.4);
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
  // Budget, against one hard target: the brightest lit surface in the palette -
  // sunlit sand - should land at 1.0 linear, so that anything above 1.0 is a
  // real highlight and the bloom threshold below stays meaningful.
  //
  // THE 1/pi THAT WAS MISSING. The previous numbers here were chosen by
  // reasoning about irradiance and never divided by pi, which three's
  // BRDF_Lambert does on both the direct and the indirect term. Outgoing
  // radiance is therefore
  //
  //     albedo / pi  *  (NdotL * sunIntensity * L(sun)  +  fill)
  //
  // and with the old 1.35 / 0.42 that put sunlit sand at ~0.33 linear, not the
  // ~1.0 the comment claimed. Everything downstream inherited the error:
  //
  //   - the whole scene rendered at ~0.43x its authored albedo, which is why
  //     #f7e8bd sand came out as #88774e mud and #8ed35c grass as #427110 moss;
  //   - the bloom threshold of 1.22 was 3.7x above anything in the scene, so
  //     the bloom pass only ever fired on the sun disc and the hand-authored
  //     water glints. Terrain had never bloomed, and could not.
  //
  // Solving the same target properly, with the sun elevation from daynight.ts (N.L
  // 0.66 on a top face) and these light colours:
  //
  //     L(sun 0xfff2dc) = 0.899      L(hemi sky 0xdcefff) = 0.939
  //     L(sand 0xf7e8bd) = 0.812 (relative luminance, not the red channel)
  //
  //     1.0 = 0.812/pi * (0.66 * 0.899 * I_sun + 0.939 * I_hemi)
  //         = 0.2585 * (0.5933 * I_sun + 0.939 * I_hemi)
  //
  // The one free parameter is how deep a shadow goes, i.e. the fill-to-key
  // ratio. This was tried at 24% first and that is too far: a shadow that dark
  // stops reading as shade and starts reading as a hole cut in the meadow, and
  // because the albedo is a saturated green the deep shadow just becomes a
  // darker *green*, which looks like paint rather than like absence of light.
  // 42% is the compromise - unmistakably a shadow, unmistakably still lit
  // ground. So F/(F+K) = 0.42, which with K + F = 3.869 gives:
  //
  //     I_hemi = 1.73                   ->  1.625      (fill, 42%)
  //     I_sun  = 2.244 / 0.5933 = 3.78  ->  2.244      (key,  58%)
  //     --------------------------------------------
  //     sunlit sand top face            =  1.000
  //     same face, in cast shadow       =  0.420
  //     +z side face, lit               =  0.88
  //     +x side face, facing away       =  0.31
  //
  // Those four numbers are the scene's entire sense of form at noon. The 1.0 /
  // 0.42 pair is what the baked FACE_SHADE table used to fake between top and
  // side; the 1.0 / 0.31 pair is what keeps each block reading as a solid with
  // a lit corner and a shaded one, rather than as a flat coloured lozenge.
  //
  // daynight.ts moves all three of these numbers over the course of a day, and
  // noon is the stop they are pinned to, so the frame above is the reference
  // every other hour is interpolated away from.
  const hemi = new THREE.HemisphereLight(0xdcefff, 0xc9a87e, 1.73);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff2dc, 3.78);
  sun.castShadow = true;

  // The moon's key. A second directional light rather than one light that
  // changes its mind, because at dusk there is a real moment where both are up
  // and the scene has to be lit by their sum - and because a light that snapped
  // from one direction to its opposite would drag every shadow in the frame
  // across the island in a single frame.
  //
  // Only one of the two ever casts: each turns its shadow map off the moment
  // its intensity reaches nothing (see updateLights), so the night costs the
  // same shadow pass as the day rather than twice it.
  const moon = new THREE.DirectionalLight(0xa8bdf0, 0);
  moon.castShadow = false;

  // ---------------------------------------------------------------- shadows
  // Tight shadow bounds around the player. The island is 172 voxels across and
  // the shadow camera is orthographic, so anything wider would spread the
  // limited shadow resolution over empty sea and make every shadow edge crawl.
  // The camera follows the player, so the bounds follow too.
  //
  // This had to grow from 46 when the sun moved. The old sun at 53 degrees threw
  // a shadow only 0.75x the caster's height, which stays well inside its own
  // footprint; the new sun at 41.3 degrees throws 1.14x, so a 5-unit tree now
  // reaches ~5.7 units out and a cliff terrace casts several blocks. At 46 the
  // cast shadow of anything near the edge of the box fell outside it and was
  // simply clipped, which is far more distracting than a slightly softer shadow.
  const SHADOW_HALF = 60;
  sun.shadow.camera.left = -SHADOW_HALF;
  sun.shadow.camera.right = SHADOW_HALF;
  sun.shadow.camera.top = SHADOW_HALF;
  sun.shadow.camera.bottom = -SHADOW_HALF;
  // The light sits SUN_DISTANCE (110) from its target and the box half-width is
  // 60, so nothing within the box is nearer than ~110 - 85 = 25 units to the
  // light, and nothing further than ~110 + 85 = 195. Pulling the near plane in
  // from 1 to 25 buys real depth precision for free, which matters now that the
  // shadows are actually the scene's main form-giving element.
  sun.shadow.camera.near = 25;
  sun.shadow.camera.far = 250;
  // 2048 over a 120-unit box is ~17 texels per voxel. That is deliberately not
  // more than before: a voxel face is only ~12-17 screen pixels across at the
  // default zoom, so matching the shadow map to roughly the screen's own
  // density is the point - going finer (3072 was tried) buys nothing you can
  // see and costs 2.25x the depth-pass fill. What the wider box did buy is
  // coverage, which is the thing that was actually broken: shadows used to be
  // clipped at a 46-unit radius, well inside the 58-unit half-width the default
  // framing shows, so a hard shadow boundary was cutting across open ground.
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

  // The moon casts from the other side of the sky, so it needs its own shadow
  // camera with the same bounds, bias and resolution - otherwise the two would
  // disagree about how far a shadow reaches and the whole island would change
  // shape the moment the sun went down.
  //
  // Both maps stay allocated for the whole cycle on purpose. Disposing the
  // out-of-use one would save ~16 MB of depth texture, but it would also mean
  // reallocating one every sunrise and every sunset, and a 2048x2048 depth
  // allocation is exactly the kind of thing that shows up as a hitch.
  moon.shadow.camera.left = -SHADOW_HALF;
  moon.shadow.camera.right = SHADOW_HALF;
  moon.shadow.camera.top = SHADOW_HALF;
  moon.shadow.camera.bottom = -SHADOW_HALF;
  moon.shadow.camera.near = 25;
  moon.shadow.camera.far = 250;
  moon.shadow.mapSize.set(2048, 2048);
  moon.shadow.bias = -0.0004;
  moon.shadow.normalBias = 0.05;
  scene.add(moon);
  scene.add(moon.target);

  const island = createIsland();
  const trees = createTrees();
  const flowers = createFlowers();
  const tallGrass = createTallGrass(treeLocations);
  scene.add(island);
  scene.add(trees);
  scene.add(flowers);
  scene.add(tallGrass);

  const { mesh: water, ocean } = createWater();
  scene.add(water);
  scene.add(ocean);

  const fallingLeaves = createFallingLeaves();
  scene.add(fallingLeaves);

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
  // The flowers are in this list now, and that is a consequence of them becoming
  // solid rather than being a separate decision. A 0.15-unit speck with
  // receiveShadow off was invisible inside a tree's shadow, because there was
  // nothing there to notice. A flower is a block tall and casts and receives
  // like anything else: excluded, it would stay bright while the grass around it
  // darkened and read as pasted on top of the meadow.
  flowers.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  // Tall grass casts and receives. Casting was deliberately off for a while - at
  // the default sun a blade's shadow is a few pixels, and at dawn it is a
  // thirteen-unit hair, which is noise - but the cards are alpha-cutout planes
  // rather than solid boxes now, so what they throw is a blade-shaped shadow and
  // not a rectangle. That was checked rather than assumed: three copies a
  // material's map and alphaTest onto its shadow depth material, so the mask is
  // respected in the shadow pass. Without that, every card would be stamping a
  // solid dark rectangle onto the meadow.
  tallGrass.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
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

  // The player hangs off a holder group at the origin, so the pixel-grid snap
  // can be applied as a RENDER offset on the holder while `player` itself
  // keeps its exact sub-pixel gameplay position. Writing the snapped value into
  // player.position instead would feed the snap's own error back into the next
  // frame's movement and collision tests, and the player would drift.
  const playerHolder = new THREE.Group();
  playerHolder.add(player);
  scene.add(playerHolder);

  const sand = createSandDeform();

  initInput();
  // TEMPORARY: builds the debug sidebar. See the imports at the top.
  const sb = initSidebar();
  initDaySlider(sb.sections.day);
  initCloudSlider(sb.sections.cloud);
  initCoordinates();

  /**
   * Push the solved time of day onto the lights and the fog.
   *
   * Both keys are parked SUN_DISTANCE out along their own direction from a
   * target that tracks the player: the shadow camera is orthographic and only
   * covers SHADOW_HALF around that target, so it has to travel with the player
   * or shadows simply stop being drawn once they leave the box.
   */
  const updateLights = (): void => {
    sun.color.copy(dayState.sunColor);
    sun.intensity = dayState.sunIntensity;
    moon.color.copy(dayState.moonColor);
    moon.intensity = dayState.moonIntensity;
    hemi.color.copy(dayState.hemiSky);
    hemi.groundColor.copy(dayState.hemiGround);
    hemi.intensity = dayState.hemiIntensity;

    // A key light with nothing left to give stops casting, which is also what
    // stops three spending a shadow pass on it. The two keys are cross-faded
    // rather than swapped, so for the few minutes either side of sunrise and
    // sunset both are briefly lit and both do cast - which is the one moment the
    // scene is legitimately lit from two directions, and a couple of seconds of
    // two shadow maps at 1/24th of a ten-minute day is a price worth paying for
    // a sunrise that does not blink.
    sun.castShadow = sun.intensity > 0.02;
    moon.castShadow = moon.intensity > 0.02;

    for (const [light, dir] of [[sun, dayState.sunDir], [moon, dayState.moonDir]] as const) {
      light.target.position.set(player.position.x, 0, player.position.z);
      light.target.updateMatrixWorld();
      light.position.copy(dir).multiplyScalar(SUN_DISTANCE).add(light.target.position);
      light.updateMatrixWorld();
    }
  };

  updateLights();

  window.addEventListener('resize', () => {
    fit();
    resizeComposer();
    resizeCamera(camera);
  });

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    advanceDayNight(dt);
    updateLights();
    updateWind(dt, t);
    // After updateLights and updateWind: the deck samples the key direction
    // that updateLights just resolved, and drifts along the wind vector
    // updateWind just rotated.
    updateClouds(dt, t, Math.max(sun.intensity, moon.intensity));
    updateFallingLeaves(dt, t);
    // TEMPORARY: keeps the debug sidebar reading live state. See the imports
    // above.
    syncDaySlider();
    syncCloudSlider();
    updatePlayer(player, dt);
    // after the player has moved, so the readout is this frame's position
    syncCoordinates(player.position);
    sand.update(dt, player.position);
    updateWater(t);
    updateCamera(camera, player.position);
    // after the camera has settled, so the player is snapped to the same grid
    // the camera just landed on and steps with the world instead of against it
    snapToPixelGrid(camera, playerHolder, player.position);
    // fade anything standing between the camera and the player, after the
    // camera has settled on its new position
    updateTreeFade(player.position);
    // through the composer, not straight to the screen, so bloom is applied
    composer.render();
  });

  // debug hooks, mirroring the original's
  Object.assign(window as unknown as Record<string, unknown>, {
    __seaY: SEA_Y,
    __groundHeight: (x: number, z: number) => levelAtWorld(x, z) * VOXEL,
    __three: { renderer, scene, camera, composer, bloom, sun, moon, hemi },
    __clouds: cloudUniforms,
    __updateWater: updateWater,
    __player: player,
    // one camera step against the live player, so the on-screen follow path can
    // be measured exactly without depending on rAF timing
    __updateCamera: (): void => {
      updateCamera(camera, player.position);
      snapToPixelGrid(camera, playerHolder, player.position);
    },
    // jump the clock without waiting for it: park the cycle, set an hour
    __setHour: (h: number): void => {
      setRunning(false);
      setHour(h);
    },
    __getHour: getHour,
    __setRunning: setRunning,
    __setCycleLength: setCycleLength,
    __getCycleLength: getCycleLength,
    __isRunning: isRunning,
    __day: dayState,
    // one simulation step with no render, so movement can be driven and
    // inspected in environments where rAF is throttled
    __step: (dt = 1 / 60, t = 0): void => {
      advanceDayNight(dt);
      updateLights();
      updateWind(dt, t);
      updateClouds(dt, t, Math.max(sun.intensity, moon.intensity));
      updateFallingLeaves(dt, t);
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