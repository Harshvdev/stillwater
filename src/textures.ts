import * as THREE from 'three';

// Block textures.
//
// The thing that separates this from a colour ramp is that these are *images*.
// Each block face samples one texel per cell of a small authored grid, and the
// block repeats it - which is how a Minecraft grass, leaf or log block works,
// and why a Minecraft field still reads as textured even though every block in
// it is the same colour underneath.
//
// What is stored is a brightness multiplier, not a colour. The palette in
// palette.ts still decides what grass, sand and leaves actually *are*, and these
// only modulate it. That keeps the palette as the single place art direction
// lives, and it means one texture can serve several materials - the ground
// texture reads as grass tufts on a grass cap, as dirt grain on the same block's
// sides, and as fine speckle on the beach, without three separate images.
//
// 16x16 is not an arbitrary size. It is what Minecraft uses, and it is also the
// largest grid that still survives this renderer: the scene draws at about a
// third of the window, so one voxel face is roughly three screen pixels at the
// default zoom and a 16-texel texture is mip-filtered down to a flat average
// there. The texture is there for when you zoom in, and averages away cleanly
// when you do not - which is exactly what a texture at that distance should do.

export const TEX_SIZE = 16;

// Deterministic per-texel noise, so a texture is identical every run and every
// reload. Nothing here is seeded from Math.random.
function hash2(x: number, y: number, seed: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

// Smooth value noise over the texture grid. Bilinear, so the result clumps into
// soft patches the way a hand-painted 16x16 does rather than sitting as isolated
// single texels.
function value(x: number, y: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  let fx = x - xi, fy = y - yi;
  fx *= fx * (3 - 2 * fx);
  fy *= fy * (3 - 2 * fy);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

// Turns a 0..1 field into a small number of flat levels. Minecraft's textures are
// not gradients, they are a handful of distinct tones, and quantising is what
// makes the result read as pixel art instead of as a smooth blur.
function levels(v: number, steps: number[]): number {
  for (let i = steps.length - 1; i >= 0; i--) {
    if (v >= steps[i]) return i;
  }
  return 0;
}

/**
 * Pack a 0..1 field into a texture, mapping it across a range of tones around
 * white so that the texture multiplies the palette's colour rather than replacing
 * it. `mid` is the level most of the texture sits at, so `spread` is a range
 * around it rather than a range from black.
 */
function build(field: (x: number, y: number) => number, mid: number, spread: number): THREE.DataTexture {
  const data = new Uint8Array(TEX_SIZE * TEX_SIZE * 4);
  for (let y = 0; y < TEX_SIZE; y++) {
    for (let x = 0; x < TEX_SIZE; x++) {
      const k = Math.max(0, Math.min(1, 0.5 + (field(x, y) - mid) * spread));
      const b = Math.round(255 * k);
      const i = (y * TEX_SIZE + x) * 4;
      data[i] = b;
      data[i + 1] = b;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, TEX_SIZE, TEX_SIZE, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;   // pixel art: never blur it when magnified
  tex.minFilter = THREE.LinearMipmapLinearFilter; // ...but average it away when minified
  tex.generateMipmaps = true;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;    // a multiplier, not a colour
  tex.needsUpdate = true;
  return tex;
}

/**
 * The three block textures. Built once, lazily, and shared: they are tiny (16x16
 * RGBA is 1 KB each) and every material that wants one shares the same upload.
 */
let groundTex: THREE.DataTexture | null = null;
let barkTex: THREE.DataTexture | null = null;
let leafTex: THREE.DataTexture | null = null;

/**
 * GROUND - grass, dirt, sand and rock all share this one.
 *
 * Minecraft's grass_top is a clump of short blades: mostly flat, with darker
 * tufts and a few lighter tips. The coarse pass gives the tufts a body and the
 * fine pass breaks their edges up, and both are quantised to a handful of tones
 * so the result stays chunky. Kept deliberately low in contrast - this is a grain
 * the eye reads as surface, not as a pattern printed on the ground.
 */
function makeGround(): THREE.DataTexture {
  return build((x, y) => {
    const coarse = value(x / 3, y / 3, 11);
    const fine = value(x / 1.5, y / 1.5, 23);
    // quantise to four flat tones: the two commonest, a darker tuft, a lighter tip
    return levels(coarse * 0.65 + fine * 0.35, [0.34, 0.47, 0.62]) / 3;
  }, 0.5, 1.35);
}

/**
 * BARK - an oak log.
 *
 * Vertical streaks, which is the whole character of a log: the noise is sampled
 * with the texture's x compressed and its y stretched, so features run the full
 * height of the block, and two of them are pulled down into deeper grooves.
 */
function makeBark(): THREE.DataTexture {
  return build((x, y) => {
    const streak = value(x / 1.6, y / 9, 31);
    const grain = value(x / 0.9, y / 4, 47);
    const groove = value(x / 2.2, y / 14, 53) > 0.66 ? 0.18 : 0;
    return Math.max(0, Math.min(1, streak * 0.62 + grain * 0.24 + 0.2 - groove));
  }, 0.46, 1.5);
}

/**
 * LEAF - the noisiest block in the game.
 *
 * Dense mottling at two scales with a few genuinely dark gaps between clumps.
 * The gaps are the only part of any of these textures that goes below the
 * palette colour, and they are kept shallow: a canopy is a thin shell you can
 * see through, so nothing here may open a hole between two blocks.
 */
function makeLeaf(): THREE.DataTexture {
  return build((x, y) => {
    const clump = value(x / 2.2, y / 2.2, 67);
    const fine = value(x / 1.1, y / 1.1, 71);
    const gap = value(x / 3, y / 3, 83) > 0.74 ? 0.16 : 0;
    return Math.max(0, Math.min(1, clump * 0.6 + fine * 0.3 + 0.2 - gap));
  }, 0.45, 1.75);
}

export function blockTexture(kind: 'ground' | 'bark' | 'leaf'): THREE.DataTexture {
  if (kind === 'bark') return (barkTex ??= makeBark());
  if (kind === 'leaf') return (leafTex ??= makeLeaf());
  return (groundTex ??= makeGround());
}