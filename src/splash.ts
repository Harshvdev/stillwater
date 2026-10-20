import * as THREE from 'three';
import { SEA_Y, waterDepthAt } from './island';
import { PALETTE } from './palette';
import { splashRing } from './textures';
import { playerEvents, playerIsSwimming } from './player';

/**
 * Splashing.
 *
 * Two things happen when something disturbs the water: a burst of droplets
 * thrown up out of it, and a ring that spreads across its surface. The first
 * is the splash and the second is the disturbance, and they are separate
 * because they answer different questions - the droplets say something hit
 * the water, and the ring says the water is still moving afterwards.
 *
 * THE DROPLETS ARE CUBES
 *
 * Not sprites, not billboards: little white blocks, the way Minecraft throws
 * water particles, and for the same reasons. A cube catches the light on
 * three faces at once, so a splash reads as a solid thing in the air rather
 * than as a decal, and the scene already draws everything else as blocks, so
 * a splash made of blocks belongs to it. It is also free - no sorting, no
 * alpha, and the depth buffer handles the overlap between droplets for free.
 *
 * THE RINGS ARE PIXEL ART
 *
 * A thin crest rather than a filled disc. A disc reads as a bright patch of
 * paint lying on the sea; a crest reads as a disturbance IN it. The ring is
 * drawn in the same chunky 16x16 idiom as the rest of the scene, so magnified
 * out to a metre across it stays pixel art.
 *
 * WHERE THEY ARE DRAWN
 *
 * Both live in the transparent queue, after the water, and the water itself
 * does not write depth.
 *
 * That is not a detail. The sea is one flat sheet of coplanar quads, so it
 * has no self-overlap and nothing is lost by it not writing depth - but it
 * does mean that a splash on the far side of a water cell would otherwise be
 * drawn BEFORE the water in front of it and then blended away by it, which
 * is the one thing a splash must not do. With the water not writing depth,
 * and the splash drawn after it, a splash is always crisp.
 *
 * The water not writing depth also means the splash can be drawn on top of
 * the sea without the sea's own quads fighting over the depth buffer, which
 * is what a flat sheet of transparent quads would otherwise do.
 */

// How many droplets can be in the air at once.
//
// The pool is fixed and the oldest droplet is reused when it is full, so a
// burst of a hundred splashes cannot make this allocate.
const MAX_DROPS = 240;

// How many rings can be spreading at once.
const MAX_RIPPLES = 28;

// Gravity on a droplet.
//
// Heavy, because a splash is water thrown up by a heavy thing: the droplets
// go up fast and come back down fast, and a slow one drifts around like a
// balloon.
const DROP_GRAVITY = 20;

// The highest a droplet gets, and how long it has to get there and fall
// back.
const DROP_LIFE = 1.1;

// How long a ring takes to spread out and fade.
const RIPPLE_LIFE = 0.9;

// The smallest and largest a ring gets, before the strength scales it.
//
// The large end is set by what the render can actually show: the game draws
// into a buffer a third of the window's size, so a ring a unit and a half
// across is about eight pixels of buffer - small, but a clear bright ring
// rather than a smear. Any bigger and it stops being a disturbance in the
// water and becomes a white circle lying on top of it.
const RIPPLE_MIN = 0.3;
const RIPPLE_MAX = 1.9;

interface Drop {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  size: number;
  age: number;
  live: boolean;
}

interface Ripple {
  x: number; z: number;
  age: number;
  strength: number;
  live: boolean;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

/**
 * The ripple material.
 *
 * A plain map for the ring image, plus a per-instance alpha, because every
 * ring fades out on its own clock and there is no other way to say that with
 * one shared material.
 *
 * The alpha is a real blend rather than the ordered dither the tree fade
 * uses. The dither is for deciding whether a fragment survives, which has to
 * be stable in screen space or it crawls; this is a smooth fade of a
 * deliberate, short-lived effect, and it wants the real thing.
 */
function rippleMaterial(tex: THREE.Texture): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    // The colour of the water, not white. The ring is disturbed water, and
    // disturbed water is the colour of the water it was disturbed out of.
    color: PALETTE.splash,
    map: tex,
    transparent: true,
    depthWrite: false,
    // A ring on the surface has no meaningful front, and the camera can see
    // it from either side of the waterline.
    side: THREE.DoubleSide,
    roughness: 0.45,
    metalness: 0,
  });
  mat.customProgramCacheKey = () => 'splash:ripple';
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float aAlpha;
varying float vAlpha;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vAlpha = aAlpha;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying float vAlpha;`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
diffuseColor.a *= vAlpha;`
      );
  };
  return mat;
}

export interface SplashSystem {
  group: THREE.Group;
  /** Throw droplets out of the water at a point, and leave a ring there. */
  splash(x: number, z: number, strength: number): void;
  /** Leave a ring on the water with no droplets at all. */
  ripple(x: number, z: number, strength: number): void;
  /** Advance the effects and react to the player. */
  update(dt: number, player: THREE.Group): void;
}

export function createSplash(): SplashSystem {
  const group = new THREE.Group();

  // The drops.
  const dropGeo = new THREE.BoxGeometry(1, 1, 1);
  const dropMat = new THREE.MeshStandardMaterial({
    color: PALETTE.splash,
    // In the transparent queue so they are drawn after the sea, and so a
    // splash is never blended away by the water in front of it. The alpha is
    // 1, so this is the same drawing an opaque material would do, only in a
    // different place in the frame.
    transparent: true,
    depthWrite: true,
    roughness: 0.35,
    metalness: 0,
  });
  const dropMesh = new THREE.InstancedMesh(dropGeo, dropMat, MAX_DROPS);
  dropMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_DROPS * 3), 3);
  dropMesh.frustumCulled = false;
  group.add(dropMesh);

  // The rings.
  const ringGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const ringAlpha = new THREE.InstancedBufferAttribute(new Float32Array(MAX_RIPPLES), 1);
  ringAlpha.setUsage(THREE.DynamicDrawUsage);
  ringGeo.setAttribute('aAlpha', ringAlpha);
  const ringMesh = new THREE.InstancedMesh(ringGeo, rippleMaterial(splashRing()), MAX_RIPPLES);
  ringMesh.frustumCulled = false;
  group.add(ringMesh);

  // Both are drawn after the sea. Three sorts the transparent queue by
  // renderOrder first, so this puts the whole splash in front of the water
  // rather than relying on where the two objects happen to sort.
  dropMesh.renderOrder = 1;
  ringMesh.renderOrder = 1;

  const drops: Drop[] = [];
  for (let i = 0; i < MAX_DROPS; i++) {
    drops.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, size: 0, age: 0, live: false });
  }
  const ripples: Ripple[] = [];
  for (let i = 0; i < MAX_RIPPLES; i++) {
    ripples.push({ x: 0, z: 0, age: 0, strength: 0, live: false });
  }

  // A cheap counter for the deterministic per-droplet jitter, so a burst does
  // not come out as one repeated pattern.
  let seed = 0;
  const rnd = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  const takeDrop = (): Drop => {
    for (let i = 0; i < drops.length; i++) {
      if (!drops[i].live) return drops[i];
    }
    // The pool is full: reuse the oldest, which is the one closest to falling
    // back in anyway.
    let oldest = drops[0];
    for (const d of drops) if (d.age > oldest.age) oldest = d;
    return oldest;
  };

  const takeRipple = (): Ripple => {
    for (let i = 0; i < ripples.length; i++) {
      if (!ripples[i].live) return ripples[i];
    }
    let oldest = ripples[0];
    for (const r of ripples) if (r.age > oldest.age) oldest = r;
    return oldest;
  };

  const system: SplashSystem = {
    group,

    splash(x, z, strength) {
      const s = Math.max(0, strength);

      // How many droplets.
      //
      // Few, and small. A splash that throws a hundred pieces of water reads
      // as an explosion, and one that throws three big cubes reads as a
      // snowball. What reads as water is a handful of small bright specks
      // thrown up and spread out.
      const count = Math.round(3 + 6 * s);
      for (let i = 0; i < count; i++) {
        const d = takeDrop();
        // The droplets come out of the water in every direction, but mostly
        // up: a splash is a cone, not a fountain.
        const ang = rnd() * Math.PI * 2;
        const rad = rnd() * 0.28 * (0.6 + s * 0.5);
        d.x = x + Math.cos(ang) * rad;
        d.z = z + Math.sin(ang) * rad;
        d.y = SEA_Y + 0.02;
        const up = 1.6 + 2.2 * s * (0.55 + rnd() * 0.65);
        const out = 0.4 + 1.1 * s * (0.3 + rnd() * 0.9);
        d.vx = Math.cos(ang) * out;
        d.vz = Math.sin(ang) * out;
        d.vy = up;
        // Small. A droplet is a fifteenth of the player's height, not a
        // tenth of it: at the resolution this game draws at, a tenth of a
        // block is a visible lump rather than a speck of spray.
        d.size = (0.09 + rnd() * 0.06) * (0.85 + s * 0.25);
        d.age = 0;
        d.live = true;
      }

      system.ripple(x, z, s);
    },

    ripple(x, z, strength) {
      const r = takeRipple();
      r.x = x;
      r.z = z;
      r.age = 0;
      r.strength = Math.max(0, strength);
      r.live = true;
    },

    update(dt, player) {
      // ------------------------------------------------------------ droplets
      let n = 0;
      for (const d of drops) {
        if (!d.live) continue;
        d.age += dt;
        d.vy -= DROP_GRAVITY * dt;
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        d.z += d.vz * dt;
        // A droplet that goes back into the water is gone. It is not a thing
        // that sinks and keeps sinking - it hits the surface and that is the
        // end of it.
        if (d.y <= SEA_Y - 0.02 || d.age > DROP_LIFE) {
          d.live = false;
          continue;
        }
        _p.set(d.x, d.y, d.z);
        _s.set(d.size, d.size, d.size);
        _m.compose(_p, _q, _s);
        dropMesh.setMatrixAt(n, _m);
        // The droplets are the same water as the sea, but the ones still
        // climbing are brighter than the ones on the way down - which is the
        // light catching them, not a colour of their own.
        const k = Math.max(0, Math.min(1, d.vy / 3.2));
        _c.setHex(PALETTE.splash, THREE.SRGBColorSpace).multiplyScalar(0.9 + k * 0.35);
        _c.toArray(dropMesh.instanceColor!.array, n * 3);
        n++;
      }
      dropMesh.count = n;
      dropMesh.instanceMatrix.needsUpdate = true;
      dropMesh.instanceColor!.needsUpdate = true;

      // --------------------------------------------------------------- rings
      let m = 0;
      for (const r of ripples) {
        if (!r.live) continue;
        r.age += dt;
        const t = r.age / RIPPLE_LIFE;
        if (t >= 1) {
          r.live = false;
          continue;
        }
        // The ring grows fast at first and then slows, the way a real one
        // does: the crest is fastest when it is new and it loses the energy
        // as it spreads.
        const grow = 1 - (1 - t) * (1 - t);
        const size = (RIPPLE_MIN + (RIPPLE_MAX - RIPPLE_MIN) * grow) * (0.55 + r.strength * 0.6);
        _p.set(r.x, SEA_Y + 0.012, r.z);
        _s.set(size, 1, size);
        _m.compose(_p, _q, _s);
        ringMesh.setMatrixAt(m, _m);
        // The fade is steeper than the growth, so the ring is gone before it
        // has finished spreading - a ring that fades slowly reads as a
        // circle of paint rather than as a disturbance.
        //
        // And it never gets bright. The ring is the water itself, disturbed:
        // a crest of broken water catching the light, not a line of white
        // paint. A ring at full white is the single loudest thing in the
        // frame, and it is meant to be the quietest.
        ringAlpha.setX(m, Math.max(0, r.strength) * 0.7 * Math.pow(1 - t, 1.7));
        m++;
      }
      ringMesh.count = m;
      ringMesh.instanceMatrix.needsUpdate = true;
      ringAlpha.needsUpdate = true;

      // -------------------------------------------------------------- player
      // The player is the only thing in the scene that disturbs the water on
      // purpose, and the three ways they do it are all here.
      const px = player.position.x;
      const pz = player.position.z;
      // How much water is over the player's feet. This is the cell they are
      // standing in - the shelf they wade through is a single block deep, so
      // there is only ever one of them.
      const depth = waterDepthAt(px, pz);
      const inWater = depth > 0.05 && player.position.y < SEA_Y - 0.05;

      if (inWater && !state.inWater) {
        // Crossing the surface, and how hard.
        //
        // The splash is sized by the speed of arrival, which is the whole
        // difference between a foot going into a puddle and a body hitting
        // the water. Someone who walks in arrives at walking speed and
        // barely disturbs the sea; someone who jumps in arrives at whatever
        // the fall was, and throws it about.
        //
        // A fixed size here was wrong in a way that was obvious once seen:
        // walking in produced a big splash and jumping in a small one,
        // which is the exact opposite of what either of them should do.
        const impact = Math.min(1.9, 0.3 + Math.abs(Math.min(0, playerEvents.vy)) * 0.11);
        system.splash(px, pz, impact);
        // The first footstep waits for the entry to have been and gone, so
        // the two do not land on the same frame.
        state.stepTimer = 0.3;
      } else if (!inWater && state.inWater) {
        // Stepping out. Smaller still, and mostly a ring: a foot leaving the
        // water disturbs it far less than a foot going into it.
        system.ripple(px, pz, 0.4);
      }
      state.inWater = inWater;

      // Wading to swimming. The water closes over them and the surface
      // breaks around them, which is a moment of its own - the same water
      // they were already standing in, but a foot deeper.
      //
      // Small, because the entry splash has already been and gone by the
      // time anyone reaches water this deep, and a walk in is a walk in
      // however deep it gets.
      const nowSwimming = playerIsSwimming();
      if (nowSwimming && !state.wasSwimming) {
        system.splash(px, pz, 0.45);
      }
      state.wasSwimming = nowSwimming;

      // Landing on the seabed.
      //
      // Small, and only near the surface. This is the disturbance of hitting
      // a floor under the water, not of hitting the water itself - the big
      // splash belongs to the surface, and it has already happened by the
      // time anyone reaches the bottom. A landing three blocks down is not
      // a splash at the surface three blocks above it.
      if (inWater && playerEvents.landed) {
        const near = player.position.y > SEA_Y - 1.4;
        if (near && playerEvents.landSpeed > 3.5) {
          system.splash(px, pz, Math.min(0.9, 0.3 + playerEvents.landSpeed * 0.08));
        }
      }

      // Wading. Every so often while they are moving through it, a little
      // disturbance at their feet, scaled by how fast they are going.
      //
      // Barely there. A foot going into the water is an event; a foot moving
      // through it is not, and a spray of water at every step turns a walk
      // along the shore into a fountain.
      const moved = Math.hypot(px - state.lastX, pz - state.lastZ);
      state.lastX = px;
      state.lastZ = pz;
      if (inWater && moved > 0.004) {
        state.stepTimer -= dt;
        if (state.stepTimer <= 0) {
          state.stepTimer = 0.32;
          system.splash(px, pz, 0.12 + Math.min(0.14, moved * 1.4));
        }
      } else {
        state.stepTimer = 0;
      }
    },
  };

  // The player's water state, kept between frames.
  const state = {
    inWater: false,
    wasSwimming: false,
    lastX: 0,
    lastZ: 0,
    stepTimer: 0,
  };

  return system;
}
