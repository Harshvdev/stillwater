import * as THREE from 'three';
import { VOXEL, levelAtWorld, voxelMaterial } from './island';
import { PALETTE, pick } from './palette';
import { flameFrames } from './textures';
import { dayState } from './daynight';
import { CAMPFIRE_X, CAMPFIRE_Z } from './constants';

// The campfire in the middle of the island.
//
// The shape is Minecraft's campfire block, taken from its own block model rather
// than from a glance at a screenshot. That model is authored on a 16-unit grid
// where 16 units is one block, and this game's VOXEL is one block too - so the
// conversion is a straight divide by 16 and every proportion lands where it
// lands in Minecraft: a 1-block footprint, logs a quarter of a block thick, and
// a flame that stands a full block tall over them. That is why a campfire here
// is the same height as the player's knees and not, say, a bonfire: it is the
// same object at the same scale as the thing it is copied from.
//
// The model, element by element (x, z centred on the block, y up from its base):
//
//   A  x 1..5,  y 0..4,  z 0..16   a log lying along Z
//   B  x 0..16, y 3..7,  z 11..15  a log lying along X, resting on top of A and C
//   C  x 11..15,y 0..4,  z 0..16   a log lying along Z
//   D  x 0..16, y 3..7,  z 1..5    a log lying along X
//   E  x 5..11, y 0..1,  z 0..16   the charcoal bed, filling the gap between A and C
//
// So the base is a deck of two bottom logs with a thin charred plank between
// them, and the two top logs lie across it at right angles. What you read from
// above is a square pile of wood with a cross of seams in it, which is exactly
// what a Minecraft campfire looks like from this camera.

// One Minecraft model unit, in world units.
const U = VOXEL / 16;

// Model coordinates to world. X and Z are measured from the middle of the block
// (model 8), Y from its base.
// X and Z share one mapping - the model is square about the middle of its block.
const mc = (v: number): number => (v - 8) * U;
const my = (v: number): number => v * U;

// How much of the footprint the player collides with. A little wider than the
// logs themselves, so a body sliding along one does not clip a corner.
const SOLID_HALF = 0.52 * VOXEL;

// ------------------------------------------------------------------- lighting
//
// A campfire is a light source, and the whole point of putting one on the island
// is that it keeps working after the sun goes down.
//
// The light is a point source in the fire. Fire throws light in every direction,
// so a point light is the right shape - the logs are lit from inside the pile,
// the player is lit on whichever side they stand, and the shadow they cast points
// away from the fire rather than away from the sun.
//
// It casts shadows, which is the part that makes the fire real. A light without
// a shadow makes everything it touches look pasted on: the ground under the pile
// is as bright as the ground beside it, and the player glides through the pool
// without casting anything. With the shadow on, the player's shadow swings
// around them as they walk past.
//
// A point light's shadow map is a cube - six passes - but the shadow camera is
// parked nine units out, so frustum culling keeps it to the meadow around the
// fire. See the note in constants.ts.
//
// ONE shadow-casting key plus three shadowless samples of the flame's volume.
//
// A flame is not a point. It is a column of burning gas half a block tall, and
// the softness of a fire's shadows is the whole reason a real one reads as a
// volume rather than as a bulb. A single point light cannot produce that: PCF's
// kernel is a few texels wide, so at this scale its shadows have a penumbra a
// couple of centimetres across, i.e. a cut-out. Raising the radius far enough
// to blur them makes PCF band instead.
//
// So the flame is sampled the way an area light has to be sampled: the key sits
// in the hot core and casts; the fills sit a few centimetres apart inside the
// same flame, do not cast, and their light leaks into the key's shadow. Where
// all four overlap the shadow is dark, at its edge only the key is blocked and
// it lightens, and because the fills are at different heights the player's
// shadow is darker at the feet than at the head. That is a three-sample
// approximation of a volume emitter - the same sum-of-point-lights an offline
// renderer would use, cut to what this frame can afford.
//
// The numbers are solved the way the sun's are in main.ts - outgoing radiance is
// albedo/pi * I/d^2 - with the four split so they add up to the one intensity
// the old single light had. Decay 2 with a nine-unit cutoff means the pool fades
// out over four or five blocks instead of ending at a hard ring.
const FIRE_INTENSITY = 4.2;
const FIRE_KEY = 3.2;
const FIRE_FILL = (FIRE_INTENSITY - FIRE_KEY) / 3;
const LIGHT_DISTANCE = 9;

// The flame's own brightness. Above 1.0 on purpose: the composer renders in
// linear HDR and OutputPass tone maps at the end, so anything over the bloom
// threshold (1.4, see main.ts) glows. Only the white core of the sprite is meant
// to clear that bar - a flame is a small hot thing, and blooming its orange
// skirt as well would just smear the whole fire into a blob.
const FLAME_GAIN = 2.0;

// Animation: Minecraft's 32-frame campfire loop played at 12 fps (~2.67s cycle),
// giving an organic, continuous convection cycle rather than a rapid repeat.
const FRAME_FPS = 12;

export interface Campfire {
  group: THREE.Group;
  /** The fire's own light, exposed so the day/night code can read it if it ever wants to. */
  light: THREE.PointLight;
  update(dt: number, t: number): void;
}

/**
 * True if a body of the given radius at (x, z) would stand inside the campfire.
 *
 * The same box-distance test trees.ts uses for a trunk, because the reason is
 * the same: a point test alone lets a body tunnel into the box between frames.
 */
export function campfireBlocks(x: number, z: number, radius: number): boolean {
  const dx = Math.abs(x - CAMPFIRE_X) - SOLID_HALF;
  const dz = Math.abs(z - CAMPFIRE_Z) - SOLID_HALF;
  const ox = Math.max(0, dx);
  const oz = Math.max(0, dz);
  return ox * ox + oz * oz <= radius * radius;
}

// A cheap deterministic hash, so the charring is identical every run.
function hash(i: number): number {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export function createCampfire(): Campfire {
  const group = new THREE.Group();
  group.position.set(CAMPFIRE_X, levelAtWorld(CAMPFIRE_X, CAMPFIRE_Z) * VOXEL, CAMPFIRE_Z);

  // ------------------------------------------------------------------- wood
  //
  // Five elements, one instanced mesh, one draw call. The wood is the terrain's
  // own bark texture on a charred ramp rather than a fresh material: it is the
  // same oak log the trees are made of, and a campfire's logs are just that log
  // after it has been in a fire.
  const woodGeo = new THREE.BoxGeometry(1, 1, 1);
  const woodTop = new THREE.InstancedBufferAttribute(new Float32Array(5 * 3), 3);
  woodGeo.setAttribute('aTop', woodTop);
  const woodMat = voxelMaterial({ tex: 'bark' });
  const wood = new THREE.InstancedMesh(woodGeo, woodMat, 5);
  wood.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(5 * 3), 3);
  wood.frustumCulled = false;

  const m = new THREE.Matrix4();
  const c = new THREE.Color();

  // from/to in model units, then the instance is that box.
  //
  // `hex` is the bark on the log's sides; `top` is what its upward face shows.
  // They differ because the top of a log lying in a fire is scorched while its
  // outside is still oak. That is also what stops the pile reading as one dark
  // lozenge - the lit top and the shaded sides are different materials, so the
  // block has a corner instead of a silhouette.
  const putLog = (
    n: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
    hex: number, top: number
  ): void => {
    const w = (x1 - x0) * U;
    const h = (y1 - y0) * U;
    const d = (z1 - z0) * U;
    m.makeScale(w, h, d);
    m.setPosition(mc((x0 + x1) / 2), my((y0 + y1) / 2), mc((z0 + z1) / 2));
    wood.setMatrixAt(n, m);
    c.setHex(hex, THREE.SRGBColorSpace);
    wood.setColorAt(n, c);
    // the shader reads aTop for a face pointing up and the instance colour for
    // everything else, so this is the per-face split described above
    const tc = new THREE.Color().setHex(top, THREE.SRGBColorSpace);
    woodTop.setXYZ(n, tc.r, tc.g, tc.b);
  };

  // The bottom two, then the top two, then the bed. Each picks its own entry off
  // the burnt ramps, so no two logs are the same shade - which is what stops
  // the pile reading as one extruded brown shape.
  const barkOf = (i: number): number => pick(PALETTE.campfireLog, hash(i));
  const topOf = (i: number): number => pick(PALETTE.campfireTop, hash(i + 4));
  const charOf = (i: number): number => pick(PALETTE.campfireChar, hash(i + 9));
  putLog(0, 1, 0, 0, 5, 4, 16, barkOf(1), topOf(1));
  putLog(1, 0, 3, 11, 16, 7, 15, barkOf(2), topOf(2));
  putLog(2, 11, 0, 0, 15, 4, 16, barkOf(3), topOf(3));
  putLog(3, 0, 3, 1, 16, 7, 5, barkOf(4), topOf(4));
  // the charcoal bed sits lower and much darker - it is burnt through
  putLog(4, 5, 0, 0, 11, 1, 16, charOf(1), charOf(2));

  wood.instanceMatrix.needsUpdate = true;
  wood.instanceColor!.needsUpdate = true;
  woodTop.needsUpdate = true;
  // The logs cast for the SUN, but not for the fire. A flame burns above the
  // wood, so its light comes over the pile from every side; letting the pile
  // shadow a point light inside itself cut a hard rectangular wedge out of the
  // pool that no real fire has.
  //
  // There is no per-light cast flag in three, so this uses the shadow hook. A
  // point light's shadow pass renders with a MeshDistanceMaterial and a
  // directional light's with a MeshDepthMaterial, so the material type says
  // which light is being drawn: for the distance material, write no depth at
  // all, which leaves that cube face empty and the fire's light unblocked. The
  // sun's pass gets a MeshDepthMaterial and is untouched.
  wood.castShadow = true;
  wood.receiveShadow = true;
  wood.onBeforeShadow = (_renderer, _object, _camera, _shadowCamera, _geometry, depthMaterial): void => {
    if ((depthMaterial as THREE.MeshDistanceMaterial).isMeshDistanceMaterial) depthMaterial.depthWrite = false;
  };
  wood.onAfterShadow = (_renderer, _object, _camera, _shadowCamera, _geometry, depthMaterial): void => {
    if ((depthMaterial as THREE.MeshDistanceMaterial).isMeshDistanceMaterial) depthMaterial.depthWrite = true;
  };
  group.add(wood);

  // ------------------------------------------------------------------- coals
  //
  // The embers in the seams. Minecraft's lit campfire log texture has glowing
  // cracks running along the inside faces of the pile; a texture cannot do that
  // here, because the block textures in textures.ts are brightness multipliers
  // and an orange crack is not a brightness. So the glow is real geometry: a
  // handful of small cubes down in the gaps, unlit and bright enough to bloom.
  //
  // They are deliberately small and mostly hidden. What should read is a line of
  // hot colour in the seams between the logs, not a lamp sitting in a woodpile.
  const coalGeo = new THREE.BoxGeometry(1, 1, 1);
  const coalMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(PALETTE.flame.low).multiplyScalar(1.9),
  });
  const coalSpots: readonly [number, number, number, number, number, number][] = [
    // x, y, z (model), then width, height, depth in model units
    [4.4, 3.4, 2.0, 1.6, 1.2, 3.0],
    [11.6, 3.4, 6.0, 1.6, 1.2, 3.0],
    [6.0, 2.6, 13.6, 3.0, 1.0, 1.6],
    [9.0, 2.6, 2.4, 3.0, 1.0, 1.6],
    [8.0, 1.3, 4.5, 2.4, 0.8, 2.4],
    [8.0, 1.3, 11.5, 2.4, 0.8, 2.4],
  ];
  const coals = new THREE.InstancedMesh(coalGeo, coalMat, coalSpots.length);
  coalSpots.forEach(([x, y, z, w, h, d], n) => {
    m.makeScale(w * U, h * U, d * U);
    m.setPosition(mc(x), my(y), mc(z));
    coals.setMatrixAt(n, m);
  });
  coals.instanceMatrix.needsUpdate = true;
  coals.frustumCulled = false;
  coals.castShadow = false;
  coals.receiveShadow = false;
  group.add(coals);

  // ------------------------------------------------------------------ flame
  //
  // Two crossed planes, 45 degrees off the block axes, carrying a pixel fire -
  // Minecraft's own construction. From this camera the near plane sits almost
  // square to the view, so the flame reads as a flat sprite with a second one
  // cutting through it, which is what gives it a body from every angle.
  //
  // Alpha cutout rather than blended: the flame writes depth, so the two planes
  // occlude each other where they cross instead of adding up into a bright X,
  // and it needs no sorting against the rest of the scene.
  const frames = flameFrames();
  const flameMat = new THREE.MeshBasicMaterial({
    map: frames[0],
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    // linear HDR, see FLAME_GAIN
    color: new THREE.Color(1, 1, 1).multiplyScalar(FLAME_GAIN),
    // The sprite is drawn at a dozen screen pixels; nearest sampling is what
    // keeps it a pixel flame instead of a smudge, the same choice the grass and
    // algae cards make.
    toneMapped: true,
  });

  // The model's fire elements are 14.4 wide and 16 tall, from y=1 to y=17, and
  // each is rotated 45 degrees about the block's vertical axis.
  const FLAME_W = 14.4 * U;
  const FLAME_H = 16 * U;
  const FLAME_Y = my((1 + 17) / 2);
  const flameGeo = new THREE.PlaneGeometry(FLAME_W, FLAME_H);
  const flame = new THREE.Group();
  for (const yaw of [Math.PI / 4, -Math.PI / 4]) {
    const plane = new THREE.Mesh(flameGeo, flameMat);
    plane.rotation.y = yaw;
    plane.position.y = FLAME_Y;
    // the flame is a light, not an occluder
    plane.castShadow = false;
    plane.receiveShadow = false;
    // ... and it is not an occluder in the AO buffer either.
    //
    // The screen-space AO pass builds its own depth and normal buffer by
    // rendering the scene a second time through a single override material.
    // That material knows nothing about alpha test, so every cut-out card in the
    // scene - including this flame - is stamped into the buffer as a solid
    // rectangle. A solid one-unit wall standing in the middle of the fire would
    // then paint a rectangular dark patch onto the logs and the grass around
    // them: a fake shadow, and exactly the sort that makes a fire look pasted on
    // rather than lit.
    //
    // onBeforeRender is handed the material that will actually be drawn, so the
    // test is simply whether it is still the flame's own. Zeroing the draw range
    // for that one pass is enough - onAfterRender puts it back before anything
    // else is drawn.
    plane.onBeforeRender = (_r, _s, _c, geometry, material): void => {
      if (material !== flameMat) geometry.setDrawRange(0, 0);
    };
    plane.onAfterRender = (_r, _s, _c, geometry): void => {
      geometry.setDrawRange(0, Infinity);
    };
    flame.add(plane);
  }
  group.add(flame);

  // ------------------------------------------------------------------ embers
  //
  // A few specks of the fire that have come off it. Minecraft's campfire throws
  // the odd ember particle and they are most of what makes the fire feel alive
  // from a distance, where the sprite itself is eight pixels tall.
  //
  // Deterministic per ember: phase and speed come from the index, so the same
  // ones rise in the same order every run and nothing flickers differently
  // between reloads.
  const EMBERS = 9;
  const emberGeo = new THREE.BoxGeometry(0.045, 0.045, 0.045);
  const emberMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(PALETTE.flame.hot).multiplyScalar(2.4),
  });
  const embers = new THREE.InstancedMesh(emberGeo, emberMat, EMBERS);
  embers.frustumCulled = false;
  embers.castShadow = false;
  embers.receiveShadow = false;
  embers.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(EMBERS * 3), 3);
  const emberPhase = new Float32Array(EMBERS);
  const emberSpeed = new Float32Array(EMBERS);
  const emberDrift = new Float32Array(EMBERS);
  for (let i = 0; i < EMBERS; i++) {
    emberPhase[i] = hash(i * 7 + 1);
    emberSpeed[i] = 0.55 + hash(i * 7 + 2) * 0.5;
    emberDrift[i] = hash(i * 7 + 3) * Math.PI * 2;
  }
  group.add(embers);

  // ------------------------------------------------------------------ light
  //
  // In the flame's hot core, which is above the logs rather than between them.
  // That is not a detail: a fire's light comes off the flame, and the flame is
  // taller than the wood. Put the source below the log tops (as this first did,
  // at my(8)) and the logs carve the pool into four hard wedges - light leaking
  // out of the corners of a box. Put it where the fire actually is and the wood
  // only blocks the short cone beneath itself, which is the dark ring a real
  // fire has around its base.
  const light = new THREE.PointLight(0xffa552, FIRE_KEY, LIGHT_DISTANCE, 2);
  light.position.set(0, my(13), 0);
  light.castShadow = true;
  // 512 over a nine-unit cube is ~57 texels per unit, far denser than the sun's
  // 2048 over 120. A cube map means six faces, which is why it is not larger.
  light.shadow.mapSize.set(512, 512);
  // The near plane has to be tighter than the logs' distance from the light, or
  // the pile that casts the shadow is clipped out of its own shadow map.
  light.shadow.camera.near = 0.05;
  light.shadow.camera.far = LIGHT_DISTANCE;
  // A voxel face lit from half a block away self-shadows badly without a bias;
  // the same reasoning as the sun's in main.ts, at a smaller scale.
  light.shadow.bias = -0.0015;
  light.shadow.normalBias = 0.03;
  // PCF's kernel, in texels. A tight radius avoids interleaved gradient noise
  // screen-space stippling across the penumbra around the player's feet;
  // the volume fills below provide the natural penumbra softening.
  light.shadow.radius = 2;
  group.add(light);

  // The other three samples of the flame. Same colour, same falloff, no shadow,
  // spread through the volume of the fire so their light reaches into the key's
  // shadow from slightly different directions. See the note above.
  const fills: THREE.PointLight[] = [];
  const fillOffsets: readonly [number, number, number][] = [
    [0.07, 3, 0.03],   // upper flame, a little right
    [-0.08, -3, 0.02], // lower flame, a little left
    [0.01, 0, -0.09],  // back of the flame
  ];
  for (const [ox, oy, oz] of fillOffsets) {
    const fill = new THREE.PointLight(0xffa552, FIRE_FILL, LIGHT_DISTANCE, 2);
    fill.position.set(ox, my(13 + oy), oz);
    fill.castShadow = false;
    group.add(fill);
    fills.push(fill);
  }

  let lastFrame = -1;
  const emberMatrix = new THREE.Matrix4();
  const emberColor = new THREE.Color();
  const base = new THREE.Color(PALETTE.flame.hot).multiplyScalar(2.4);

  return {
    group,
    light,
    update(_dt: number, t: number): void {
      // --- flame frames ---
      const frame = Math.floor(t * FRAME_FPS) % frames.length;
      if (frame !== lastFrame) {
        lastFrame = frame;
        flameMat.map = frames[frame];
      }

      // --- flicker ---
      //
      // Three incommensurate sines, so the light never settles into a beat. Kept
      // shallow - about 12% - because a fire that visibly pulses reads as a
      // failing bulb; what the eye should catch is that the light is not quite
      // steady.
      const flicker =
        0.94 +
        0.05 * Math.sin(t * 11.3) +
        0.03 * Math.sin(t * 7.1 + 1.7) +
        0.02 * Math.sin(t * 23.7 + 0.4);
      // How much of the fire's light survives the sky. A campfire is a few
      // hundred watts of mostly-infrared; the noon sun is a hundred thousand
      // lux, which is why you cannot see a fire's light in daylight. This rig
      // cannot represent that ratio - the sun is authored at 3.78, not at
      // 100,000 - so the fire is scaled down against the sun instead, which is
      // the same thing seen from the other end. It still reads warm at dusk and
      // it is the only light at night.
      const day = Math.min(1, Math.max(0, dayState.sunIntensity / 3.78));
      const sky = 1 - 0.88 * day;
      light.intensity = FIRE_KEY * flicker * sky;
      for (let i = 0; i < fills.length; i++) fills[i].intensity = FIRE_FILL * flicker * sky;
      // and the flame itself breathes with it, a little
      flameMat.color.setScalar(FLAME_GAIN * (0.97 + (flicker - 0.94) * 0.5));
      // the light wanders inside the fire, so its shadows move the way a fire's do
      light.position.x = Math.sin(t * 1.7) * 0.02;
      light.position.z = Math.cos(t * 1.3 + 0.9) * 0.02;
      // the volume samples drift on their own phases, so the penumbra breathes
      // instead of the whole shadow sliding as one piece
      for (let i = 0; i < fills.length; i++) {
        fills[i].position.x = fillOffsets[i][0] + Math.sin(t * (1.3 + i * 0.4) + i * 2.1) * 0.03;
        fills[i].position.z = fillOffsets[i][2] + Math.cos(t * (1.1 + i * 0.5) + i * 1.7) * 0.03;
      }

      // --- embers ---
      //
      // Each one rides a looping 0..1 cycle: born at the top of the pile, rising
      // about a block, drifting sideways, and fading out before it resets. The
      // reset is hidden by the fade, so nothing pops.
      for (let i = 0; i < EMBERS; i++) {
        const cycle = (t * emberSpeed[i] * 0.55 + emberPhase[i]) % 1;
        const rise = cycle * 1.15;
        const drift = emberDrift[i] + t * 0.6;
        const x = Math.cos(drift) * (0.06 + cycle * 0.16);
        const z = Math.sin(drift) * (0.06 + cycle * 0.16);
        // fade in fast, out slow, and never quite to zero at the start
        const fade = Math.min(1, cycle * 6) * (1 - cycle) * (1 - cycle);
        emberMatrix.makeScale(fade, fade, fade);
        emberMatrix.setPosition(x, my(12) + rise, z);
        embers.setMatrixAt(i, emberMatrix);
        emberColor.copy(base).multiplyScalar(0.35 + fade * 0.65);
        embers.setColorAt(i, emberColor);
      }
      embers.instanceMatrix.needsUpdate = true;
      embers.instanceColor!.needsUpdate = true;
    },
  };
}
