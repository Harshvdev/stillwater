import * as THREE from 'three';
import { PALETTE } from './palette';

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
let waterTex: THREE.DataTexture | null = null;

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

/**
 * WATER - the surface every water block carries.
 *
 * Minecraft's water texture is horizontal streaks: a few lighter ripples running
 * across the block and a darker field between them. The noise here is sampled
 * with its x compressed and its y stretched, so the features come out running
 * the width of the block rather than sitting in blobs, and the result is
 * quantised to four flat tones so it stays pixel art.
 *
 * Unlike the ground, the ground's rule does not apply here. The ground texture
 * is pushed well down because a terrain face is the largest area on screen and
 * the eye reads a strong pattern there as a printed-on design. Water is a large
 * area too, but it is a surface that is *meant* to have ripples on it, and it
 * is nearly flat and nearly featureless everywhere else - so the texture is
 * what stops the sea reading as a sheet of coloured glass. It is kept
 * deliberately shallow in contrast for the same reason the ground's is: enough
 * to catch the light, not enough to look like a pattern.
 */
function makeWater(): THREE.DataTexture {
  return build((x, y) => {
    // The long streaks. The noise is sampled with its x compressed and its y
    // stretched, so a feature is several texels wide and one tall: a ripple
    // running across the block, not a blob in it.
    const streak = value(x / 8, y / 1.2, 97);
    // A second, finer set of streaks at a different scale, so the surface has
    // two sizes of ripple rather than one.
    const ripple = value(x / 3.4, y / 0.8, 103);
    const field = streak * 0.62 + ripple * 0.38;
    // Four flat tones, split around the field's own middle. The thresholds are
    // close together on purpose: this is a surface ripple, and a wide spread
    // here would put half the sea in shadow.
    return levels(field, [0.42, 0.48, 0.54]) / 3;
  }, 0.5, 1.0);
}

export function blockTexture(kind: 'ground' | 'bark' | 'leaf' | 'water'): THREE.DataTexture {
  if (kind === 'bark') return (barkTex ??= makeBark());
  if (kind === 'leaf') return (leafTex ??= makeLeaf());
  if (kind === 'water') return (waterTex ??= makeWater());
  return (groundTex ??= makeGround());
}

// ------------------------------------------------------- tall grass masks
//
// These are not multipliers like the three above: they are alpha masks, and that
// difference is the whole reason tall grass is shaped the way it is.
//
// The block textures modulate a cube face, because a cube is solid and all it
// needs is surface variation. Tall grass is not solid - Minecraft draws it as a
// pair of crossed, alpha-cutout planes - so what it needs is a SHAPE. Tapered
// blades rising out of the bottom of the texture, cut out of an opaque
// background, which is what turns a rectangle into a tuft.
//
// Only alpha is authored here. RGB is left white and the green comes from the
// material and its per-instance colour, so palette.ts stays the thing that
// decides what colour grass is.
//
// THREE masks, not one, because a meadow of identical tufts is the same mistake
// as a forest of identical trees. The three are genuinely different silhouettes
// rather than one shape at three heights: a low dense clump, a tall leaning fan,
// and a sparse upright spike. They differ in blade count, blade width and how
// hard each blade leans, which is what the eye reads as "different plant" rather
// than "same plant, further away".

export type GrassKind = 'sprout' | 'tuft' | 'cluster';

const BLADE_SIZE = 16;

/**
 * Handcrafted 16x16 pixel-art grass blade designs.
 *
 * Each design is authored with distinct silhouette, solid base anchoring,
 * and 2-tone depth:
 *   '.' = transparent
 *   '#' = bright sunlit blade highlight (100% brightness)
 *   'x' = shaded blade contour / depth tone (78% brightness)
 *
 * This eliminates the sub-texel speckling that broken mathematical procedural formulas cause.
 */
const BLADE_PATTERNS: Record<GrassKind, readonly string[]> = {
  // Blade 1: "sprout" - graceful curved primary blade with an angled side shoot
  sprout: [
    '................',
    '.......#x.......',
    '......##xx......',
    '......##xx......',
    '.......##xx.....',
    '.......##xx.....',
    '........##xx....',
    '........##xx....',
    '....#x..##xx....',
    '...##xx..##xx...',
    '...##xx..##xx...',
    '...##xx..##xx...',
    '...####xxxxxx...',
    '...####xxxxxx...',
    '....###xxxxx....',
    '.....##xxxx.....',
  ],

  // Blade 2: "tuft" - classic splayed double blade with clean V-shape
  tuft: [
    '................',
    '..#x........#x..',
    '.##xx......##xx.',
    '.##xx......##xx.',
    '..##xx....##xx..',
    '..##xx....##xx..',
    '...##xx..##xx...',
    '...##xx..##xx...',
    '...####xxxxxx...',
    '....###xxxxx....',
    '....###xxxxx....',
    '....###xxxxx....',
    '...####xxxxxx...',
    '...####xxxxxx...',
    '....###xxxxx....',
    '.....##xxxx.....',
  ],

  // Blade 3: "cluster" - lush three-blade meadow crown
  cluster: [
    '................',
    '.......#x.......',
    '......##xx......',
    '......##xx......',
    '..#x..##xx..#x..',
    '.##xx.##xx.##xx.',
    '.##xx.##xx.##xx.',
    '..##xx##xx##xx..',
    '..##xxxxxxxxx...',
    '...####xxxxxx...',
    '...####xxxxxx...',
    '....###xxxxx....',
    '....###xxxxx....',
    '....###xxxxx....',
    '.....##xxxx.....',
    '......xxxx......',
  ],
};

function makeBladeMask(rows: readonly string[]): THREE.DataTexture {
  const data = new Uint8Array(BLADE_SIZE * BLADE_SIZE * 4);
  for (let y = 0; y < BLADE_SIZE; y++) {
    // Row 0 in array is top of blade (v = 1.0), row 15 is root at ground level (v = 0.0)
    const rowStr = rows[BLADE_SIZE - 1 - y];
    for (let x = 0; x < BLADE_SIZE; x++) {
      const ch = rowStr[x];
      const i = (y * BLADE_SIZE + x) * 4;
      if (ch === '#') {
        data[i] = 255;
        data[i + 1] = 255;
        data[i + 2] = 255;
        data[i + 3] = 255;
      } else if (ch === 'x' || ch === 'X') {
        data[i] = 198;
        data[i + 1] = 198;
        data[i + 2] = 198;
        data[i + 3] = 255;
      } else {
        data[i] = 0;
        data[i + 1] = 0;
        data[i + 2] = 0;
        data[i + 3] = 0;
      }
    }
  }
  const tex = new THREE.DataTexture(data, BLADE_SIZE, BLADE_SIZE, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

const grassMasks: Partial<Record<GrassKind, THREE.DataTexture>> = {};

export function grassMask(kind: GrassKind): THREE.DataTexture {
  return (grassMasks[kind] ??= makeBladeMask(BLADE_PATTERNS[kind]));
}

// ------------------------------------------------------- algae silhouettes
//
// The underwater plants are the same kind of object as the tall grass - a
// card with a cut-out silhouette - but they are not the same shape, and the
// difference is the point.
//
// A blade of grass is a blade: one tapering line, narrow, upright, and it
// differs from its neighbours only in how tall it is. The three designs above
// are all variations on that one silhouette, which is right for a meadow -
// a meadow is one thing repeated.
//
// Underwater there are three genuinely different organisms, and a meadow of
// one shape at the bottom of the sea would read as seaweed pasted onto a
// slope. So the silhouettes here are three different plants:
//
//   KELP  a frond: one stalk running up the card with alternating lobes
//         hanging off it, leaning as it rises. Tall, narrow, and the only one
//         of the three that wants to be somewhere deeper than the shore.
//   FAN   a sea fan: a broad ribbed fan on a stem, the shape a gorgonian
//         makes when it spreads itself across the current.
//   TUFT  a low clump of separate blades out of one root - the short one,
//         the one that fills the gaps between the other two.
//
// The same two-tone convention as the grass: '#' is the lit face of the plant
// and 'x' the shaded one, so a single card carries its own light and shade
// rather than relying on the sun to find a form in a flat silhouette.

export type AlgaeKind = 'kelp' | 'fan' | 'tuft';

const ALGAE_PATTERNS: Record<AlgaeKind, readonly string[]> = {
  // KELP - a frond with lobes alternating along a leaning stalk.
  kelp: [
    '.........##.....',
    '........#xx#....',
    '.......#xxxx#...',
    '.......#xx#.....',
    '......#xx#......',
    '.....#xxxx#.....',
    '.....#xx#.......',
    '....#xx#........',
    '...#xxxx#.......',
    '...#xx#.........',
    '..#xxxx#........',
    '..#xx#..........',
    '.#xxxx#.........',
    '.#xx#...........',
    '#xxxx#..........',
    '####............',
  ],

  // FAN - a ribbed sea fan on a stem.
  fan: [
    '..#..#..#..#....',
    '.#x#.#x#.#x#....',
    '.#xx##xx##xx#...',
    '..#xx#xx#xx#....',
    '..#xx#xx#xx#....',
    '...#x#xx#xx#....',
    '...#xx#xx#x#....',
    '....#xx#xx#.....',
    '....#xx#x#......',
    '.....#xxx#......',
    '.....#xx#.......',
    '......#x#.......',
    '......#x#.......',
    '.......#........',
    '.......#........',
    '.......#........',
  ],

  // TUFT - separate blades fanning out of one root.
  tuft: [
    '..#.....#....#..',
    '.#x#...#x#...#x#',
    '.#x#..#xx#..#x#.',
    '..#x#.#xx#.#x#..',
    '..#xx##xx##xx#..',
    '..#xx#xx#xx#x#..',
    '...#x#xx#xx#x#..',
    '...#xx#xx#xx#...',
    '....#xx#xx#x#...',
    '....#x#xx#x#....',
    '.....#xx#x#.....',
    '.....#xx#x#.....',
    '......#xx#......',
    '......#xx#......',
    '.......##.......',
    '.......##.......',
  ],
};

const algaeMasks: Partial<Record<AlgaeKind, THREE.DataTexture>> = {};

export function algaeMask(kind: AlgaeKind): THREE.DataTexture {
  return (algaeMasks[kind] ??= makeBladeMask(ALGAE_PATTERNS[kind]));
}

// --------------------------------------------------------- campfire flame
//
// The one thing in the scene that is drawn as a sprite rather than as voxels,
// and that is not a shortcut: Minecraft's campfire flame is exactly this, two
// crossed alpha-cutout planes carrying an animated 16x16 fire texture. Building
// it out of cubes instead would give a lumpy orange lump, because a flame's
// whole character is its silhouette and a cube has no silhouette to speak of.
//
// Only the SILHOUETTE is drawn by hand. The colour inside it is solved, pixel by
// pixel, from where that pixel sits in the fire:
//
//   - the fuel end is hot and the tips are cold, because that is the direction
//     heat flows in a flame; a fire that is brightest at its tips is the single
//     most common way a pixel fire reads as wrong,
//   - a hot core sits low and a touch off centre, where the flame is thickest,
//   - anything on the outline drops more than a tone, which draws the dark red
//     rim that gives the fire its edge against the sky,
//   - a little deterministic noise breaks up the bands, so the gradient does not
//     read as concentric rings.
//
// The split matters because a flame is mostly silhouette: get the outline right
// and almost any sane gradient inside it reads as fire. Six hand-drawn outlines
// with solved colour is therefore both less work and more controllable than
// hand-picking 256 pixels six times over.
//
// The silhouettes are lopsided on purpose, and their widths do NOT rise evenly
// from tip to base. A symmetric teardrop is what a fire looks like in a diagram,
// not in a fireplace: a real one leans, bulges at the shoulder, pinches, forks,
// and throws the odd detached tongue off its side. A silhouette whose row widths
// step up by one every row is a cone with a flame's colour on it, and that is
// exactly what the first pass of this sprite looked like. So each frame below
// was drawn as a left edge and a right edge that move independently, and each
// one has at least one row that is narrower than the row above it.
//
// A full 32-frame seamless cycle matching Minecraft's 32-frame animation.
// Rather than a short 6-frame loop that visibly repeats in under a second,
// 32 continuously morphing frames give the flame an organic, living convection
// cycle: rising tongues that sway, split into forks, pinch off detached sparks,
// and loop seamlessly.

const FLAME_FRAMES: readonly (readonly string[])[] = [
  // Frame 0
  [
    '................',
    '................',
    '................',
    '.....##....###..',
    '.....#######....',
    '.....######.....',
    '..#########.....',
    '..#########.....',
    '.############...',
    '.##############.',
    '.##############.',
    '.##############.',
    '.##############.',
    '.#############..',
    '.###############',
    '.##############.',
  ],
  // Frame 1
  [
    '................',
    '................',
    '................',
    '.....##.........',
    '.....#####......',
    '..########......',
    '..#########.....',
    '.############...',
    '.##############.',
    '.##############.',
    '.##############.',
    '.##############.',
    '.##.##########..',
    '.##############.',
    '.##############.',
    '.###############',
  ],
  // Frame 2
  [
    '................',
    '................',
    '................',
    '......####......',
    '....######......',
    '..########......',
    '..##########....',
    '.#############..',
    '..#############.',
    '.##############.',
    '.##############.',
    '.##.#########...',
    '.##############.',
    '.##############.',
    '.###############',
    '################',
  ],
  // Frame 3
  [
    '................',
    '................',
    '................',
    '.....#####......',
    '...#######......',
    '..##########....',
    '..############..',
    '..#############.',
    '.##############.',
    '.#############..',
    '.##.#########...',
    '.##############.',
    '.##############.',
    '.###############',
    '###############.',
    '##############..',
  ],
  // Frame 4
  [
    '................',
    '................',
    '......###.......',
    '.....####.......',
    '.....######.....',
    '..###########...',
    '..############..',
    '..############..',
    '..############..',
    '.....#######....',
    '..############..',
    '.##############.',
    '.###############',
    '.##############.',
    '.#############..',
    '################',
  ],
  // Frame 5
  [
    '................',
    '................',
    '......###.......',
    '......####......',
    '.....#######....',
    '...###########..',
    '..############..',
    '..############..',
    '.....#######....',
    '..############..',
    '.#############..',
    '.###############',
    '.##############.',
    '.#############..',
    '################',
    '###############.',
  ],
  // Frame 6
  [
    '................',
    '................',
    '........#.......',
    '......######....',
    '....##########..',
    '...###########..',
    '.....########...',
    '.....#######....',
    '..##..########..',
    '.####.########..',
    '..#############.',
    '.##############.',
    '.#############..',
    '###############.',
    '###############.',
    '###############.',
  ],
  // Frame 7
  [
    '................',
    '................',
    '........###.....',
    '.....########...',
    '....#########...',
    '......######....',
    '......######....',
    '...#..#######...',
    '..###.########..',
    '..#############.',
    '.##############.',
    '.#############..',
    '###############.',
    '###############.',
    '###############.',
    '#########.######',
  ],
  // Frame 8
  [
    '................',
    '................',
    '.......#####....',
    '......#######...',
    '......#####.....',
    '......#####.....',
    '......#######...',
    '..##..#######...',
    '..#######.####..',
    '.#############..',
    '.#############..',
    '##############..',
    '##############..',
    '###############.',
    '#########.######',
    '################',
  ],
  // Frame 9
  [
    '................',
    '.........#......',
    '.......####.....',
    '......#####.....',
    '......#####.....',
    '......######....',
    '.......######...',
    '...######..###..',
    '..############..',
    '..###########...',
    '##############..',
    '##############..',
    '##############..',
    '#########.######',
    '###########.###.',
    '################',
  ],
  // Frame 10
  [
    '................',
    '........##......',
    '.......###......',
    '......#####.....',
    '.......####.....',
    '.......###......',
    '.....###...##...',
    '...##########...',
    '..###########...',
    '.############...',
    '##############..',
    '##############..',
    '.######....#####',
    '##########..###.',
    '###############.',
    '###############.',
  ],
  // Frame 11
  [
    '................',
    '.......##.......',
    '.......###......',
    '.......###......',
    '.......##.......',
    '......##........',
    '....#######.....',
    '...##########...',
    '..###########...',
    '#############...',
    '.############...',
    '.######....#####',
    '##########..###.',
    '###############.',
    '.##############.',
    '################',
  ],
  // Frame 12
  [
    '................',
    '.......###......',
    '.......###......',
    '................',
    '................',
    '......#.........',
    '...########.....',
    '...##########...',
    '.############...',
    '.#######..##....',
    '.######......##.',
    '#######..#...##.',
    '##############..',
    '.##############.',
    '################',
    '.###############',
  ],
  // Frame 13
  [
    '................',
    '........#.......',
    '................',
    '................',
    '................',
    '....######......',
    '...#########....',
    '.###########....',
    '.#######...#....',
    '.######......#..',
    '.#####.......##.',
    '.######.#####...',
    '.##############.',
    '################',
    '.###############',
    '.###############',
  ],
  // Frame 14
  [
    '................',
    '................',
    '................',
    '................',
    '....#####.......',
    '...#######.#....',
    '...######..#....',
    '.#######........',
    '.#####..........',
    '.#####..........',
    '.#####..##.##...',
    '.##############.',
    '################',
    '.###############',
    '.###############',
    '################',
  ],
  // Frame 15
  [
    '................',
    '................',
    '................',
    '.....###........',
    '....#####.......',
    '....#####.......',
    '..######........',
    '..####..........',
    '..####..........',
    '..####..........',
    '.########..###..',
    '.###############',
    '.###############',
    '.###############',
    '################',
    '################',
  ],
  // Frame 16
  [
    '................',
    '................',
    '................',
    '....####........',
    '....####........',
    '..#####.........',
    '..####..........',
    '..####..........',
    '..####..........',
    '..###.###...##..',
    '.##############.',
    '.###############',
    '.###############',
    '################',
    '################',
    '################',
  ],
  // Frame 17
  [
    '................',
    '................',
    '.....###........',
    '.....###........',
    '...####.........',
    '..####..........',
    '..####..........',
    '...##...........',
    '..#...###....#..',
    '.##############.',
    '.###############',
    '.###############',
    '.###############',
    '################',
    '################',
    '.###############',
  ],
  // Frame 18
  [
    '................',
    '................',
    '.....##.........',
    '...##...........',
    '...##...........',
    '...##...........',
    '...#............',
    '.......#........',
    '..##..########..',
    '.###############',
    '..##############',
    '.###############',
    '################',
    '################',
    '.###############',
    '.###############',
  ],
  // Frame 19
  [
    '................',
    '................',
    '................',
    '...##...........',
    '...##...........',
    '................',
    '.......#........',
    '..#...#######...',
    '..#############.',
    '..##############',
    '.###############',
    '################',
    '.###############',
    '.###############',
    '.###############',
    '################',
  ],
  // Frame 20
  [
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '.......##.......',
    '..####.########.',
    '..#############.',
    '.###############',
    '###############.',
    '.###############',
    '.###############',
    '.###############',
    '################',
    '################',
  ],
  // Frame 21
  [
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '.......###......',
    '...#.##########.',
    '..#############.',
    '.##############.',
    '.###############',
    '.###############',
    '.##############.',
    '################',
    '################',
    '.###############',
  ],
  // Frame 22
  [
    '................',
    '................',
    '................',
    '................',
    '................',
    '........#.......',
    '......#########.',
    '.....##########.',
    '.##############.',
    '.#########.####.',
    '.###############',
    '.##############.',
    '.###############',
    '.###############',
    '.##############.',
    '###############.',
  ],
  // Frame 23
  [
    '................',
    '................',
    '................',
    '................',
    '................',
    '......########..',
    '.....##########.',
    '.##############.',
    '.#########.####.',
    '.##############.',
    '..#############.',
    '.###############',
    '.###############',
    '.##############.',
    '###############.',
    '################',
  ],
  // Frame 24
  [
    '................',
    '................',
    '................',
    '................',
    '................',
    '......##..#####.',
    '..########.####.',
    '..########..###.',
    '.##############.',
    '..#############.',
    '.##############.',
    '.############.#.',
    '..#############.',
    '.##############.',
    '################',
    '################',
  ],
  // Frame 25
  [
    '................',
    '................',
    '................',
    '................',
    '...........###..',
    '...######...##..',
    '..#######...###.',
    '..#######.#####.',
    '..#############.',
    '.#############..',
    '.############.#.',
    '..#############.',
    '.##############.',
    '################',
    '################',
    '################',
  ],
  // Frame 26
  [
    '................',
    '................',
    '................',
    '................',
    '...#..###...##..',
    '..#######...##..',
    '..#######.#####.',
    '..############..',
    '.#############..',
    '.###########....',
    '..#############.',
    '.##############.',
    '###############.',
    '################',
    '################',
    '################',
  ],
  // Frame 27
  [
    '................',
    '................',
    '................',
    '.......#........',
    '...#####.....#..',
    '...#####...###..',
    '...###########..',
    '..####..#####...',
    '.###########....',
    '..############..',
    '.##############.',
    '###############.',
    '.###############',
    '###############.',
    '################',
    '################',
  ],
  // Frame 28
  [
    '................',
    '................',
    '................',
    '......##........',
    '....####....##..',
    '....###..####...',
    '........#####...',
    '..##########....',
    '..##########....',
    '.#############..',
    '.##############.',
    '.###############',
    '###############.',
    '################',
    '################',
    '################',
  ],
  // Frame 29
  [
    '................',
    '................',
    '................',
    '.....##.........',
    '.....##...###...',
    '.........###....',
    '...#########....',
    '...########.....',
    '..############..',
    '.##############.',
    '.##############.',
    '###############.',
    '###############.',
    '################',
    '################',
    '################',
  ],
  // Frame 30
  [
    '................',
    '................',
    '................',
    '................',
    '.........###....',
    '.....#..###.....',
    '...#######......',
    '...###########..',
    '.##############.',
    '.##############.',
    '###############.',
    '###############.',
    '.###############',
    '.###############',
    '################',
    '################',
  ],
  // Frame 31
  [
    '................',
    '................',
    '................',
    '............#...',
    '.....##...##....',
    '.....###.###....',
    '....########....',
    '..##########....',
    '..###########...',
    '.#############..',
    '.##############.',
    '.###############',
    '.###############',
    '################',
    '################',
    '################',
  ],
];

// The five flame tones, coldest first. `rank` is a continuous 0..4 temperature
// that gets rounded into this table, so the gradient inside the silhouette is
// solved rather than authored.
const FLAME_RAMP: readonly number[] = [
  PALETTE.flame.ember,
  PALETTE.flame.low,
  PALETTE.flame.mid,
  PALETTE.flame.hot,
  PALETTE.flame.core,
];

/**
 * True if (x, y) is a solid pixel with a transparent 4-neighbour.
 *
 * Only the four cardinal neighbours count. Diagonal-only contact still reads as
 * the outline of the shape, and including diagonals would darken the inside of
 * every one-pixel tip twice over.
 */
function onFlameEdge(rows: readonly string[], x: number, y: number): boolean {
  const solid = (px: number, py: number): boolean =>
    py >= 0 && py < rows.length && px >= 0 && px < rows.length && rows[py][px] === '#';
  return !solid(x - 1, y) || !solid(x + 1, y) || !solid(x, y - 1) || !solid(x, y + 1);
}

const flameCache: THREE.DataTexture[] = [];

/**
 * The campfire's animation frames, built once and shared.
 *
 * Row 0 of the authored array is the top of the flame and row 15 the base, but a
 * DataTexture's first row is v=0, which is the bottom of a plane - so the rows
 * are written in reverse, the same flip the grass masks make.
 */
export function flameFrames(): THREE.DataTexture[] {
  if (flameCache.length > 0) return flameCache;

  FLAME_FRAMES.forEach((rows, frame) => {
    const size = rows.length;
    const data = new Uint8Array(size * size * 4);

    for (let y = 0; y < size; y++) {
      // `row` is the authored row, counting down from the tip to the fuel
      const row = size - 1 - y;
      const line = rows[row];

      for (let x = 0; x < size; x++) {
        if (line[x] !== '#') continue;

        // 1. temperature rises toward the fuel. 1.5 at the tip, 3.0 at the base,
        //    before any of the terms below push it either way. That is a narrow
        //    band on purpose: most of the flame should land on orange-to-yellow,
        //    because that is what a fire actually is - a big orange body with a
        //    small white heart and a thin red edge. A wide ramp spends half the
        //    sprite on white and the fire reads as a lamp.
        let rank = 1.5 + (row / (size - 1)) * 1.5;

        // 2. the hot core: a small ellipse low in the fire, a touch right of
        //    centre, where the fuel is. This is the white-yellow heart, and it
        //    is deliberately narrow - three texels across at most. A wide core
        //    is what turns a pixel flame into a white blob once bloom gets it.
        const dx = (x - 7.6) / 1.6;
        const dy = (row - 13.2) / 1.6;
        rank += Math.max(0, 1 - (dx * dx + dy * dy)) * 0.8;

        // 3. the rim cools, by more than a tone. This is the dark red outline,
        //    and it does the job a stroke would do in a drawing: it separates
        //    fire from background. It has to be this hard a step - a gentle one
        //    just softens the edge, and a soft edge is not what pixel art is.
        if (onFlameEdge(rows, x, row)) rank -= 1.2;

        // 4. noise, so the bands are not clean contours. Seeded by the frame, so
        //    the grain travels with the shape instead of sitting still under it.
        rank += (hash2(x, row, 17 + frame) - 0.5) * 0.6;

        const tone = FLAME_RAMP[Math.max(0, Math.min(4, Math.round(rank)))];
        const i = (y * size + x) * 4;
        data[i] = (tone >> 16) & 0xff;
        data[i + 1] = (tone >> 8) & 0xff;
        data[i + 2] = tone & 0xff;
        data[i + 3] = 255;
      }
    }

    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    flameCache.push(tex);
  });

  return flameCache;
}

// --------------------------------------------------------- splash ring
//
// The ring a splash leaves on the surface of the water.
//
// A thin crest rather than a filled disc, because a disc reads as a bright
// patch of paint sitting on the sea and a crest reads as a disturbance in
// it. It is drawn in the same chunky 16x16 idiom as everything else here, so
// magnified out to a metre across it stays pixel art - a smooth ring would
// be the one thing in the scene that is not.
//
// White with an alpha hole in the middle: the ring pixels are opaque and
// everything inside them is not, so the middle of the quad shows the water
// through it.

const SPLASH_RING: readonly string[] = [
  '................',
  '................',
  '.....######.....',
  '...##......##...',
  '..#..........#..',
  '..#..........#..',
  '.#............#.',
  '.#............#.',
  '.#............#.',
  '.#............#.',
  '.#............#.',
  '.#............#.',
  '..#..........#..',
  '..#..........#..',
  '...##......##...',
  '.....######.....',
];

let splashRingTex: THREE.DataTexture | null = null;

export function splashRing(): THREE.DataTexture {
  if (splashRingTex) return splashRingTex;
  const data = new Uint8Array(SPLASH_RING.length * SPLASH_RING.length * 4);
  for (let y = 0; y < SPLASH_RING.length; y++) {
    const row = SPLASH_RING[y];
    for (let x = 0; x < row.length; x++) {
      const i = (y * row.length + x) * 4;
      const on = row[x] !== '.';
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = on ? 255 : 0;
    }
  }
  const tex = new THREE.DataTexture(data, SPLASH_RING.length, SPLASH_RING.length, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  splashRingTex = tex;
  return tex;
}
