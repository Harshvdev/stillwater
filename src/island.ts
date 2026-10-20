import * as THREE from 'three';
import { COAST_RADII, COAST_SAMPLES } from './coast';
import { PALETTE, pick } from './palette';
import { blockTexture, grassMask } from './textures';
import { applyCloudShadows } from './clouds';
import { windUniforms } from './wind';

// ---------------------------------------------------------------- coast port
// Verbatim from the 3d original, so the island silhouette is identical.
export function coastRadius(theta: number): number {
  let t = theta / (Math.PI * 2);
  while (t < 0) t += 1;
  while (t >= 1) t -= 1;
  const f = t * COAST_SAMPLES;
  const i0 = Math.floor(f) % COAST_SAMPLES;
  const i1 = (i0 + 1) % COAST_SAMPLES;
  const frac = f - Math.floor(f);
  return COAST_RADII[i0] * (1 - frac) + COAST_RADII[i1] * frac;
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// The island is squashed on z before its radius is measured, so it is wider
// than it is deep. Exported because the trees measure their distance from the
// centre on the same basis, to stay consistent with groundHeight.
export const WIDTH_SCALE = 1.3;

// continuous island + seabed height, ported from the original
export function groundHeight(x: number, z: number): number {
  const sz = z / WIDTH_SCALE;
  const r = Math.hypot(x, sz);
  const theta = Math.atan2(sz, x);
  const d = r / coastRadius(theta);

  const topLeft = Math.max(0, Math.cos(theta - Math.PI));
  const dStart = 0.86 + 0.05 * Math.sin(theta * 3 + 1.7) + 0.03 * Math.sin(theta * 7 + 0.4) + 0.09 * topLeft * topLeft;

  const grass = 2.6 - 0.9 * smooth(0.0, dStart * 0.75, d);
  const sand = 1.7 - 1.35 * smooth(dStart, 1.0, d);
  const seabed = 0.35 - 7.5 * smooth(1.0, 1.8, d);

  if (d < dStart * 0.75) return grass;
  if (d < 1.0) return sand;
  return seabed;
}

export function isUnderwater(x: number, z: number): boolean {
  return groundHeight(x, z) < 0;
}

// The sand band footprints are stamped into: dry beach between SAND_H and
// GRASS_H, matching the band the builder paints.
export function isSand(x: number, z: number): boolean {
  const h = groundHeight(x, z);
  return h > 0.15 && h <= 1.15;
}

const hs = (i: number, j: number, s = 0): number => {
  const x = Math.sin(i * 127.1 + j * 311.7 + s * 74.7) * 43758.5453;
  return x - Math.floor(x);
};

// smooth value noise on the voxel lattice, so colour drifts form patches
// instead of per-cell static
const vn = (x: number, y: number, s = 0): number => {
  const i = Math.floor(x), j = Math.floor(y);
  let fx = x - i, fy = y - j;
  fx *= fx * (3 - 2 * fx);
  fy *= fy * (3 - 2 * fy);
  const a = hs(i, j, s), b = hs(i + 1, j, s), c = hs(i, j + 1, s), d = hs(i + 1, j + 1, s);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
};

// ------------------------------------------------------------- voxel layout
// One cube is VOXEL x VOXEL world units on the XZ plane and VOXEL tall.
// Heights snap to integer levels; a column's top surface sits at level * VOXEL.
//
// VOXEL is 1 so a block reads as clearly smaller than the ~1.8 unit tall
// player. Every level below is a world-space height, so they are all even
// numbers: halving VOXEL doubles the level count needed to reach the same
// physical height, which keeps the island's silhouette identical while the
// blocks get finer. See LEVEL_* and MIN_LEVEL.
export const VOXEL = 1;
export const SEA_Y = 0;
export const MIN_LEVEL = -6;
export const REGION_HALF = 86; // land + shelf are voxelised out to here
export const GRID = (REGION_HALF * 2) / VOXEL; // 172 columns per side

const MIN_Y = MIN_LEVEL * VOXEL;

// surface kinds, driving which palette ramp a cell uses
const GRASS = 0;
const SAND = 1;
const WET = 2;
const ROCK = 3;

// Band edges. GRASS_H is deliberately below the top of the sand ramp (1.7):
// groundHeight ramps sand from 0.35 up to 1.7 on its way out to the grass, and
// cutting in at 1.15 means the top ~40% of that ramp is already grass. That is
// what keeps the beach a narrow ring instead of a flood plain - it is the
// original cutoff, unchanged, and it does not depend on VOXEL. Only the level
// numbers below are new.
const SAND_H = 0.15; // above this it is dry beach, below it the wet shelf
const SHELF_H = -0.6; // a narrow waterline strip before the seabed drops a voxel
const GRASS_H = 1.15; // sand gives way to grass
const GRASS_HI = 2.2; // the interior rises one voxel above the grass rim

// Level numbers, not heights: the top of a column sits at level * VOXEL.
// Each surface band is exactly one level, so consecutive terraces differ by a
// single block - which is also all the player can step up (MAX_STEP = VOXEL).
// The seabed then steps down one level per block from the waterline to
// MIN_LEVEL via levelOf's floor, so the whole cliff face is uniformly stepped.
const LEVEL_SHELF = 0; // wet shelf, top flush with the waterline
const LEVEL_BEACH = 1; // beach
export const LEVEL_GRASS = 2; // grass rim
export const LEVEL_GRASS_HI = 3; // grass interior plateau

function levelOf(h: number): number {
  if (h > GRASS_HI) return LEVEL_GRASS_HI; // grass interior plateau
  if (h > GRASS_H) return LEVEL_GRASS; // grass rim
  if (h > SAND_H) return LEVEL_BEACH; // beach
  if (h > SHELF_H) return LEVEL_SHELF; // wet shelf, top flush with the waterline
  return Math.max(MIN_LEVEL, Math.floor(h / VOXEL));
}

// Underwater bands, one level each. The shelf is level 0 (flush with the
// waterline), so the first submerged level is -1: wet sand, then rock below.
const WET_LEVEL = LEVEL_SHELF - VOXEL;
const WET_SAND_LEVEL = WET_LEVEL - VOXEL;

function kindOf(h: number, level: number): number {
  if (h > GRASS_H) return GRASS;
  if (h > SAND_H) return SAND;
  if (level >= WET_LEVEL) return WET;
  if (level === WET_SAND_LEVEL) return SAND;
  return ROCK;
}

const cellX = (i: number) => (i - GRID / 2 + 0.5) * VOXEL;
const cellZ = (j: number) => (j - GRID / 2 + 0.5) * VOXEL;



// column lookup used by player collision and the sand deform
const levels = new Int8Array(GRID * GRID);
let levelsReady = false;

// How dark a fully walled-in top face goes, as a fraction of its lit value.
// A corner-AO sum of 3 per corner (every neighbour up) is the maximum, so the
// darkest possible top face keeps 1 - 3*AO_STRENGTH of its brightness. Kept low
// deliberately: a top face is already darkened on its sides by the per-row
// `bands` term, and too much here reads as dirty blotches rather than as depth.
const AO_STRENGTH = 0.07;

/** 1 if the column at (ni, nj) stands taller than `level`, else 0. Off-grid counts as open air. */
function taller(ni: number, nj: number, level: number): number {
  if (ni < 0 || nj < 0 || ni >= GRID || nj >= GRID) return 0;
  return levels[nj * GRID + ni] > level ? 1 : 0;
}

function colIndex(x: number, z: number): number {
  const i = Math.floor((x + REGION_HALF) / VOXEL);
  const j = Math.floor((z + REGION_HALF) / VOXEL);
  if (i < 0 || j < 0 || i >= GRID || j >= GRID) return -1;
  return j * GRID + i;
}

// integer level of the surface under a world point; MIN_LEVEL outside the grid
export function levelAtWorld(x: number, z: number): number {
  const k = colIndex(x, z);
  if (k < 0) return MIN_LEVEL;
  return levels[k];
}

// ----------------------------------------------------------------- material
// Instanced cubes share one geometry, so a per-face split (green top, earth
// sides) has to come from the shader: aTop carries the top colour and the
// instance colour stays the side colour. This is the Minecraft grass-block
// rule - a block whose top and sides are different materials - and it is a
// per-face *albedo* split only. Shading is left entirely to the scene lights.
//
// This used to bake a flat per-face shade (FACE_SHADE) and draw a dark line
// along the two far edges of every top face. The baked table is gone: real
// lights plus shadows now produce the face-to-face variation it used to fake.
// The outline later came back as an opt-in `outline` term - not as a shading
// substitute but as a pixel-art legibility cue, which is a different job. What
// survives by default is `bands`, which is an occlusion term - see below.
//
// A column is a cap cube over one stretched base box, so a cliff is a single
// tall quad whose normal is the same on every row. Lit by a directional light
// that means one even N.L over the whole face, i.e. a dead flat slab, because
// real per-voxel lighting never reaches down into a shaft. `bands` restores
// exactly that missing term: aBandTop gives the world Y that row 0 of each
// instance sits at, and the shader darkens one hard step per VOXEL row below
// it, so light falls off with depth into the cliff the way Minecraft's own
// light propagation dims a deep wall. The step is floor'd, not smooth: one
// flat value per voxel row. Top faces are left alone - vTopMix is 1 there - so
// only the sides darken.
//
// The cap passes its own top, so its single row is 0. The base passes the same
// top, which puts its topmost row at 1 and guarantees the cap/base seam is a
// visible step rather than two matching rows.
//
// `outline` draws a thin dark line along the two upper edges of every top face.
// Which edges those are depends on the fixed iso view: the camera sits at
// (+x, +y, +z), so on the top-face diamond screen-up points towards (-x, -z).
// That makes the upper-left edge the x = -half side and the upper-right edge the
// z = -half side - the two far edges, which meet at the top corner and read as a
// chevron. The near edges (+x, +z) stay bare so the line never doubles up where
// two cubes meet. The line is measured in world units from the cube's local
// position and widened by fwidth, so it never thins below a rendered pixel and
// shimmers as the camera pans.
// half thickness of the line, as a fraction of a voxel so it stays visually
// the same weight now that a block is half as wide as it was
const EDGE_HALF = VOXEL * 0.085;

const edgeColor = new THREE.Color().setHex(PALETTE.edgeLine, THREE.SRGBColorSpace);
const EDGE_COL_GLSL = `vec3(${edgeColor.r.toFixed(4)}, ${edgeColor.g.toFixed(4)}, ${edgeColor.b.toFixed(4)})`;

export function voxelMaterial(opts: {
  bands?: boolean; outline?: boolean; fade?: boolean; tex?: 'ground' | 'bark' | 'leaf' | 'water';
  rough?: number; metal?: number; wind?: boolean; instAlpha?: boolean;
} = {}): THREE.MeshStandardMaterial {
  const bands = opts.bands === true;

  const outline = opts.outline === true;
  const fade = opts.fade === true;
  const wind = opts.wind === true;
  // `instAlpha` reads a per-instance aAlpha and multiplies it into the
  // fragment's alpha.
  //
  // This is what the sea's transparency is built on: one material and one draw
  // call for every water block, with each block's opacity decided by how deep
  // its floor is. The shallows are see-through and the deep water is not, and
  // the seabed shows through the first while the second stays a solid sheet.
  //
  // It is a per-instance term rather than a per-material one because opacity
  // that varies across the sea has to vary WITH the sea. A single material
  // alpha would make every block of water equally clear, which is the one
  // thing a depth-graded sea cannot be.
  const instAlpha = opts.instAlpha === true;
  // `tex` picks the block texture this material draws on every face - the grass
  // block's tufted noise, a log's vertical grain, a leaf block's mottling - and it
  // is the one shading term that needs the fragment's world position, because
  // each of those patterns is a function of where on the voxel lattice the
  // fragment lands rather than of anything per-instance. A trunk is a single
  // stretched box and every leaf cube is a flat facet, so neither can carry a
  // texture any other way.
  const tex = opts.tex;
  // `fade` reads a per-instance aFade (1 = solid, lower = see-through) and
  // punches a screen-door dither of holes rather than blending with alpha.
  //
  // It is deliberately NOT transparent:true. Real alpha moves the mesh into
  // three's transparent queue, which sorts whole objects by distance instead
  // of by fragment: a see-through tree then draws over the player while the
  // player's shadow - a separate transparent object - sorts differently, so the
  // body vanishes and only the shadow shows through. Keeping the material
  // opaque and discarding a fraction of fragments leaves depth writes, sorting
  // and the player's own draw order completely untouched. It also suits the
  // GBA look, where transparency was done with a stipple anyway.
  //
  // Matte by default: this is grass, dirt, sand and rock, none of which
  // specularly reflect. A little roughness rather than exactly 1.0 keeps the
  // sun from reading as a flat wash on the lit faces.
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: opts.rough ?? 0.88,
    metalness: opts.metal ?? 0,
    // Only the water is transparent, and it is the only surface in the scene
    // with something behind it worth seeing - the seabed under the shallows.
    //
    // depthWrite stays on. The water writes its own depth, so the sea surface
    // occludes what is behind it rather than blending with it, and the only
    // transparent object in the scene is the sea itself - there is nothing for
    // it to be sorted against.
    transparent: instAlpha,
  });
  // every variant compiles from one onBeforeCompile source, so the cache key has
  // to name exactly which combination this material is
  mat.customProgramCacheKey = () =>
    `voxel:${bands ? 'bands' : 'flat'}:${outline ? 'outline' : 'plain'}:${fade ? 'fade' : 'solid'}:${tex ?? 'none'}:${wind ? 'wind' : 'still'}:${instAlpha ? 'alpha' : 'opaque'}`;
  mat.onBeforeCompile = (shader) => {
    if (tex) shader.uniforms.uBlockTex = { value: blockTexture(tex) };
    if (wind) {
      shader.uniforms.uWindTime = windUniforms.uWindTime;
      shader.uniforms.uWindDir = windUniforms.uWindDir;
      shader.uniforms.uWindStrength = windUniforms.uWindStrength;
    }
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec3 aTop;
varying vec3 vTopColor;
varying float vTopMix;
${bands ? 'attribute float aBandTop;\nvarying float vBandTop;\nvarying float vWorldY;' : ''}
${outline ? 'attribute vec2 aExpose;\nvarying vec2 vExpose;\nvarying vec3 vLocal;' : ''}
${fade ? 'attribute float aFade;\nvarying float vFade;' : ''}
${instAlpha ? 'attribute float aAlpha;\nvarying float vAlpha;' : ''}
${tex ? 'varying vec3 vWorldPos;\nvarying vec3 vTexNormal;' : ''}
${wind ? 'uniform float uWindTime;\nuniform vec2 uWindDir;\nuniform float uWindStrength;\nattribute vec4 aTree;' : ''}`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vTopColor = aTop;
vTopMix = step(0.5, normal.y);
${bands ? 'vBandTop = aBandTop;\nvWorldY = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).y;' : ''}
${outline ? 'vExpose = aExpose;\nvLocal = position;' : ''}
${fade ? 'vFade = aFade;' : ''}
${instAlpha ? 'vAlpha = aAlpha;' : ''}
${
  tex
    ? `vWorldPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
// The instance matrices here are scale-and-translate with no rotation, and a
// box's normals are axis-aligned to begin with, so the raw attribute is already
// the direction the face points in world space. Only its sign is ever tested.
vTexNormal = normal;`
    : ''
}`
      );
    if (wind) {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <project_vertex>',
        `vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
  vec3 wPos = (modelMatrix * mvPosition).xyz;

  // A tree sways as ONE rigid body, driven by its own axis rather than by each
  // cube's own position. Deriving the wave from wPos gave every cube in a canopy
  // a different displacement, so the canopy writhed instead of swaying - and
  // because layers 1 and 2 leave the trunk's own cell empty, the cubes ringing
  // the trunk slid away from a trunk that has no wind shader at all and never
  // moved. That opened a gap which showed the bare log through the leaves, and
  // it grew with zoom: at the closest zoom the gap is several pixels.
  //
  // aTree is (trunkX, groundY, trunkZ, bareTrunkHeight), identical for every
  // cube of one tree, so the whole tree receives the same displacement.
  float treeWave = sin(aTree.x * 0.4 + aTree.z * 0.4 - uWindTime * 2.5) * 0.7
                 + sin(aTree.x * 0.9 - aTree.z * 0.8 - uWindTime * 4.0) * 0.3;
  float treeGust = 0.7 + 0.3 * sin(uWindTime * 0.85 + aTree.x * 0.05);

  // Ramp the sway in with height so the trunk bends instead of sliding: the
  // base stays planted on the ground and the top reaches full displacement,
  // which is exactly where the canopy sits. Without this the whole trunk would
  // skate sideways and tear a sliver of ground open at its foot.
  float treeBend = clamp((wPos.y - aTree.y) / max(aTree.w, 0.0001), 0.0, 1.0);
  treeBend = treeBend * treeBend * (3.0 - 2.0 * treeBend);

  vec2 treeShift = uWindDir * (treeWave * treeGust * uWindStrength * 0.08 * treeBend);
  mvPosition.x += treeShift.x;
  mvPosition.z += treeShift.y;
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`
      );
    }
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vTopColor;
varying float vTopMix;
${bands ? `varying float vBandTop;
varying float vWorldY;
const float VOXEL_F = ${VOXEL.toFixed(1)};
const float ROW_SHADE = 0.07;
// deepest row the banding keeps stepping for. The island now spans 14 voxels
// (y=6 down to y=-8), so the clamp has to cover the whole column or the lower
// cliff would flatten out into one shade instead of staying layered.
const float ROW_CLAMP = ${(LEVEL_GRASS_HI - MIN_LEVEL).toFixed(1)};` : ''}
${outline ? `varying vec2 vExpose;
varying vec3 vLocal;
const float EDGE_HALF = ${EDGE_HALF.toFixed(4)};
const vec3 EDGE_COL = ${EDGE_COL_GLSL};
const float EDGE_VOXEL = ${VOXEL.toFixed(1)};` : ''}
${tex ? `varying vec3 vWorldPos;
varying vec3 vTexNormal;
uniform sampler2D uBlockTex;

// Where on this face's texture a fragment sits.
//
// fract() of the world position is the position *within* the voxel, so the
// texture is locked to the block: it cannot drift, cannot crawl as the camera
// pans, and every block shows the same image the way a Minecraft block does. A
// trunk, which is one stretched box rather than a stack of boxes, gets this for
// free: each of its unit rows samples the full texture once, so it reads as the
// stack of blocks it is.
//
// The two axes come from the face normal rather than being assumed, so a texture
// reads the same on a block's top as on its side instead of being smeared along
// whichever axis happened to be picked.
vec2 faceUV(vec3 worldPos, vec3 nrm) {
  vec3 f = fract(worldPos);
  return abs(nrm.y) > 0.5 ? f.xz : (abs(nrm.x) > 0.5 ? f.zy : f.xy);
}

// The block texture, sampled. It stores a brightness multiplier rather than a
// colour, so the palette in palette.ts stays the thing that decides what grass,
// sand and leaves actually are - see textures.ts.
float blockTex(vec3 worldPos, vec3 nrm) {
  return texture2D(uBlockTex, faceUV(worldPos, nrm)).r;
}` : ''}
${fade ? `varying float vFade;
// 4x4 ordered dither, 0..15, as a pure function of screen position. Declared
// here rather than inline in main(), where GLSL will not accept a definition.
float bayer4(vec2 c) {
  ivec2 p = ivec2(mod(c, 4.0));
  int x = p.x, y = p.y;
  int v = 0;
  v += ((x ^ y) & 1) * 8;
  v += ((y) & 1) * 4;
  v += (((x & 2) >> 1) ^ ((y & 2) >> 1)) * 2;
  v += ((y & 2) >> 1);
  return float(v) / 16.0;
}` : ''}
${instAlpha ? 'varying float vAlpha;' : ''}`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
// The grass-block split: top face takes aTop, everything else keeps the
// instance colour. Albedo only - the lights do all the shading from here.
diffuseColor.rgb = mix(diffuseColor.rgb, vTopColor, vTopMix);
${tex === 'ground' ? `// GROUND: the grass block's texture.
//
// One image serves every terrain face, and that is a deliberate consequence of
// the multiplier approach rather than a shortcut. A grass block's sides are dirt,
// so the same grain reads as dirt texture there; on the beach and the cliffs it
// reads as fine speckle. The alternative - a texture only grass has - would
// leave every other surface in the scene as bare colour, which is the thing this
// whole change exists to stop.
//
// Pushed well down from its sampled value on purpose. The texture carries real
// contrast, but a terrain face is the largest area on screen and the eye reads a
// strong pattern there as a printed-on design; at this strength it reads as a
// surface.
diffuseColor.rgb *= 1.0 + (blockTex(vWorldPos, vTexNormal) - 1.0) * 0.42;` : ''}
${tex === 'bark' ? `// BARK: the log block's texture.
//
// A trunk is one stretched box, so every instance carries a single bark colour
// and the column came out as one flat brown rectangle no matter how wide the bark
// ramp is. The ramp's range was only ever being used *between* trunks. The
// texture is what finally puts it to work *within* one, and at full strength -
// bark is small on screen, so unlike the ground it can afford its full contrast.
diffuseColor.rgb *= blockTex(vWorldPos, vTexNormal);` : ''}
${tex === 'leaf' ? `// LEAF: the leaf block's texture.
//
// A canopy is Minecraft's noisiest block, and here every cube in it was one flat
// facet, so a canopy lit from above came out as a stack of smooth plastic chips.
//
// At full strength, which is the opposite of the rule the ground texture runs
// under, and for the same reason the ramp is narrow instead: both of those are
// about keeping a *large area* from reading as a pattern. This is the reverse -
// each face is small, so it can carry the noise at full contrast and look like a
// clump of leaves.
//
// It cannot reopen the dawn hole. What made canopies look transparent was a large
// brightness step between two whole *cubes* - you could see the meadow through
// the gap. This varies within a face, which averages out across the block and so
// cannot open a gap between two of them. The two constraints stay separate on
// purpose: PALETTE.leaf stays narrow between cubes, this does the work inside
// them.
diffuseColor.rgb *= blockTex(vWorldPos, vTexNormal);` : ''}
${tex === 'water' ? `// WATER: the surface texture every water block carries.
//
// The sea is the one surface in the scene that is nearly flat, nearly
// featureless and very large, so it is the surface that most needs something
// on it: without this the whole ocean is a sheet of coloured glass.
//
// The texture is centred on its own mid level rather than on white, which is
// what the other three do. Those are multipliers that darken a face on
// average - the ground's runs about a fifth dark - and on terrain that reads
// as grain. Water is bright and it is the top of the frame, so it is centred
// instead: the ripples push a little above and a little below the block's own
// colour and the mean brightness of the sea is left exactly where it was.
//
// The contrast is shallow on purpose. The sea is a large area, and the eye
// reads a strong pattern across a large area as a printed-on design.
diffuseColor.rgb *= 1.0 + (blockTex(vWorldPos, vTexNormal) - 0.5) * 0.42;` : ''}
${instAlpha ? `// Per-instance opacity. aAlpha is 1 for the opaque deep water and
// well under half for the shallows, so the seabed reads through the water
// where the bottom is close and is swallowed by it where the bottom is far.
//
// This is a plain alpha multiply rather than the ordered dither the tree fade
// uses, and deliberately so: the fade is a per-pixel decision about whether a
// fragment survives, which has to be stable in screen space or it crawls. The
// water's alpha is a smooth property of the block, so it wants the real thing
// - a continuous blend against what is behind it.
diffuseColor.a *= vAlpha;` : ''}
${bands ? `// Sky occlusion down a shaft. This is a light-attenuation term, not a
// face shade: the cliff's normal is constant over every row of the stretched
// base box, so without this a lit cliff is one dead-even slab. One flat step
// per voxel row, matching how Minecraft's own light propagation dims a wall
// the further it sits below the surface.
float row = clamp(floor((vBandTop - vWorldY) / VOXEL_F), 0.0, ROW_CLAMP);
diffuseColor.rgb *= mix(1.0, 1.0 - row * ROW_SHADE, 1.0 - vTopMix);` : ''}
${outline ? `// Each of the two far edges is outlined only where this cap is actually
// exposed - where the top layer ends against a lower neighbour. On a flat
// plateau every edge is flush, so nothing is drawn and the grid stays invisible;
// the line appears only along real terrace rims and drops.
float edgeX = (vLocal.x + 0.5) * EDGE_VOXEL;
float edgeZ = (vLocal.z + 0.5) * EDGE_VOXEL;
float wx = fwidth(edgeX);
float wz = fwidth(edgeZ);
float hx = max(EDGE_HALF, wx * 0.75);
float hz = max(EDGE_HALF, wz * 0.75);
float lineX = (1.0 - smoothstep(hx - wx, hx + wx, edgeX)) * vExpose.x;
float lineZ = (1.0 - smoothstep(hz - wz, hz + wz, edgeZ)) * vExpose.y;
diffuseColor.rgb = mix(diffuseColor.rgb, EDGE_COL, max(lineX, lineZ) * vTopMix);` : ''}
${fade ? `// Per-instance occlusion fade, as an ordered screen-door dither rather
// than alpha blending. aFade is 1 for a solid tree and drops toward FADE_MIN
// for one standing between the camera and the player.
//
// The 4x4 Bayer threshold is a fixed function of gl_FragCoord, so the pattern
// is stable in screen space: it does not crawl when the camera pans, and it
// quantises cleanly onto the low-resolution render buffer this game draws at.
// aFade >= 1 keeps every fragment, so an unoccluded tree is untouched.
if (vFade < bayer4(gl_FragCoord.xy)) discard;` : ''}`
      );
  };

  // Cloud shadows on every voxel surface. Applied here rather than at each call
  // site because this is the single material factory for the terrain, trees,
  // grass and the water voxels - one call covers all of them, and a new surface
  // added later cannot forget. See clouds.ts.
  return applyCloudShadows(mat);
}

export interface SandColumn {
  capId: number;
  x: number;
  z: number;
  topY: number;
}

let caps: THREE.InstancedMesh | null = null;
let sandColumns: SandColumn[] = [];

export function getSandColumns(): SandColumn[] {
  return sandColumns;
}

function faceColor(hex: number, c: THREE.Color): void {
  c.setHex(hex, THREE.SRGBColorSpace);
}

// the cap is the top VOXEL of a column; the base fills everything under it.
// Splitting them means the sand deform only has to move a cap.
export function createIsland(): THREE.Group {
  const group = new THREE.Group();
  const mat = voxelMaterial({ bands: true, outline: true, tex: 'ground' });
  const max = GRID * GRID;

  // The cap and the base each index their own instance space: the cap counts
  // every cell (0..GRID*GRID), the base only the cells that actually have one
  // (0..nBase). They therefore cannot share an instanced attribute buffer - if
  // they did, every base write would land on whichever cap owned that index and
  // overwrite its top colour with the base's side colour. Each gets its own
  // geometry and its own buffer; only the material (and so the shader) is shared.
  const capGeo = new THREE.BoxGeometry(1, 1, 1);
  const baseGeo = new THREE.BoxGeometry(1, 1, 1);

  const topAttr = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
  topAttr.setUsage(THREE.DynamicDrawUsage);
  const baseTopAttr = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
  baseTopAttr.setUsage(THREE.DynamicDrawUsage);
  // world Y of each instance's top, read by the per-row banding in the shader
  const bandTopAttr = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
  bandTopAttr.setUsage(THREE.DynamicDrawUsage);
  const baseBandTopAttr = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
  baseBandTopAttr.setUsage(THREE.DynamicDrawUsage);
  // per-instance exposure of the two outlined edges (x, z): 1 where this cap's
  // top layer ends against something lower, 0 where it is flush with a
  // neighbour. Only the caps read it; the base is a side-face box, so its copy
  // stays all zero and the outline term multiplies out.
  const exposeAttr = new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2);
  const baseExposeAttr = new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2);

  const capMesh = new THREE.InstancedMesh(capGeo, mat, max);
  const baseMesh = new THREE.InstancedMesh(baseGeo, mat, max);
  capMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
  baseMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
  capGeo.setAttribute('aTop', topAttr);
  capGeo.setAttribute('aBandTop', bandTopAttr);
  capGeo.setAttribute('aExpose', exposeAttr);
  baseGeo.setAttribute('aTop', baseTopAttr);
  baseGeo.setAttribute('aBandTop', baseBandTopAttr);
  baseGeo.setAttribute('aExpose', baseExposeAttr);
  capMesh.frustumCulled = false;
  baseMesh.frustumCulled = false;

  const m = new THREE.Matrix4();
  const side = new THREE.Color();
  const top = new THREE.Color();

  sandColumns = [];
  let nCap = 0;
  let nBase = 0;

  // levels first: the ambient-occlusion pass below reads all four neighbours,
  // including the ones this sweep has not reached yet
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      levels[j * GRID + i] = levelOf(groundHeight(cellX(i), cellZ(j)));
    }
  }

  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const k = j * GRID + i;
      const x = cellX(i);
      const z = cellZ(j);
      const h = groundHeight(x, z);
      const level = levels[k];

      const kind = kindOf(h, level);
      // Two smooth octaves so colour drifts form soft patches, plus a per-cell
      // hash.
      //
      // The hash used to be +-0.06, which is a *quarter of one ramp step* (a
      // step is a quarter of the range). Neighbouring cells therefore almost
      // always landed on the same palette entry, and the meadow read as one flat
      // sheet of plastic at every hour. The grass ramp is only 1.34:1 end to end,
      // so per-cell variation is the only thing that can give it texture at all -
      // and a quarter of a step cannot.
      //
      // It is now +-0.14, over half a step, so two adjacent cells differ about
      // as often as not while the octaves above still hold the result together
      // into patches. Every term still varies on the cell grid, so the pattern is
      // locked to the voxels and cannot crawl as the camera pans.
      const r = vn(i * 0.13, j * 0.13, 5) * 0.66 + vn(i * 0.38, j * 0.38, 9) * 0.26 +
        (hs(i, j, 5) - 0.5) * 0.28;
      const r2 = hs(i, j, 19);

      // surface colour of the top cube
      let topHex: number;
      let sideHex: number;
      if (kind === GRASS) {
        topHex = pick(PALETTE.grass, r);
        sideHex = pick(PALETTE.dirt, r2);
      } else if (kind === SAND) {
        // the beach is the brightest surface here, so keep the ramp in its
        // upper half; picking straight off r put most cells on the dark end
        topHex = pick(PALETTE.sand, 0.35 + r * 0.65);
        sideHex = PALETTE.sand[2];
      } else if (kind === WET) {
        topHex = pick(PALETTE.wetSand, 0.35 + r * 0.65);
        sideHex = PALETTE.wetSand[2];
      } else {
        topHex = pick(PALETTE.rock, r);
        sideHex = PALETTE.rock[3];
      }

      // Corner ambient occlusion on the top face, Minecraft's own rule.
      //
      // For each of the four diagonals around this column, take the two edge
      // neighbours it sits between and the corner cell itself. If both edges
      // are taller the corner is fully walled in and gets nothing; otherwise
      // it loses one step per occluding neighbour. Averaging the four corners
      // gives one value for the face.
      //
      // This replaces a flat count of the four side neighbours, which could not
      // tell a square pit (all four sides up, dark) from an open terrace with
      // one raised edge (equally "one occluder", but hardly any real occlusion
      // at all). The saturating rule is what makes a corner read as a corner.
      let aoSum = 0;
      for (let dj = -1; dj <= 1; dj += 2) {
        for (let di = -1; di <= 1; di += 2) {
          const s1 = taller(i + di, j, level);
          const s2 = taller(i, j + dj, level);
          const cr = taller(i + di, j + dj, level);
          aoSum += s1 && s2 ? 0 : 3 - (s1 + s2 + cr);
        }
      }
      const aoK = 1 - (aoSum / 4) * AO_STRENGTH;

      const topY = level * VOXEL;

      // --- cap ---
      m.makeScale(VOXEL, VOXEL, VOXEL);
      m.setPosition(x, topY - VOXEL / 2, z);
      capMesh.setMatrixAt(nCap, m);
      faceColor(sideHex, side);
      side.multiplyScalar(aoK);
      capMesh.setColorAt(nCap, side);
      faceColor(topHex, top);
      top.multiplyScalar(aoK);
      topAttr.setXYZ(nCap, top.r, top.g, top.b);
      // the cap is row 0: its one voxel of side sits at full value
      bandTopAttr.setX(nCap, topY);

      // Outline exposure for the two far edges. The upper-left edge is the -x
      // side and the upper-right edge is the -z side, so each is drawn only
      // where the neighbour in that direction sits lower than this cap. Off the
      // grid counts as open air, so the island border stays outlined.
      const lowerX = i - 1 < 0 || levels[j * GRID + (i - 1)] < level ? 1 : 0;
      const lowerZ = j - 1 < 0 || levels[(j - 1) * GRID + i] < level ? 1 : 0;
      exposeAttr.setXY(nCap, lowerX, lowerZ);
      if (kind === SAND) sandColumns.push({ capId: nCap, x, z, topY });
      nCap++;

      // --- base: everything from the void floor up to the cap ---
      const baseH = topY - VOXEL - MIN_Y;
      if (baseH > 0) {
        m.makeScale(VOXEL, baseH, VOXEL);
        m.setPosition(x, MIN_Y + baseH / 2, z);
        baseMesh.setMatrixAt(nBase, m);
        baseMesh.setColorAt(nBase, side);
        // the base's own buffer, indexed by nBase - sharing the cap's here is
        // what painted grass tops brown
        baseTopAttr.setXYZ(nBase, side.r, side.g, side.b);
        // the same top the cap uses, so rows run continuously down the whole column:
        // the cap is row 0, the voxel of base right under it is row 1, the next
        // is row 2. The cap/base seam is therefore always a visible step and
        // never two coincidentally matching rows.
        baseBandTopAttr.setX(nBase, topY);
        nBase++;
      }
    }
  }

  capMesh.count = nCap;
  baseMesh.count = nBase;
  capMesh.instanceMatrix.needsUpdate = true;
  baseMesh.instanceMatrix.needsUpdate = true;
  capMesh.instanceColor!.needsUpdate = true;
  baseMesh.instanceColor!.needsUpdate = true;
  topAttr.needsUpdate = true;
  bandTopAttr.needsUpdate = true;
  exposeAttr.needsUpdate = true;
  baseTopAttr.needsUpdate = true;
  baseBandTopAttr.needsUpdate = true;
  baseExposeAttr.needsUpdate = true;

  levelsReady = true;
  caps = capMesh;
  group.add(baseMesh, capMesh);
  return group;
}

export function getTerrainMesh(): THREE.InstancedMesh {
  if (!caps || !levelsReady) throw new Error('createIsland() has not been called');
  return caps;
}

// --------------------------------------------------------------- flora
//
// The plus a bloom's four petals sit in, and how many flowers the island grows.
const PETAL_PLUS: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// Upper bound on flowers, which is what the sub-meshes are sized against - a
// flower is six instances, so this is a bound on parts too. Set far above what
// FLOWER_CHANCE actually produces, which is a few hundred, so the cap can never
// be what limits the island.
const MAX_FLOWERS = 1024;

// Of the cells a drift mask admits, the fraction that actually grows a flower.
//
// FLOWER_CHANCE * (the drift mask's own pass rate) lands at about one flower per
// thirty grass cells. See the note at the gate in createFlowers for why the old
// density is not just lower but unusable at this size.
//
// The first pass at this was 0.09 and came out at one in fifty-four, not thirty:
// the drift mask is smooth value noise, so it does not pass a flat 38% of cells
// the way a coin flip would - it passes whole regions of the meadow and none of
// the others, and the product comes out lower than either factor suggests.
const FLOWER_CHANCE = 0.16;

// Tall grass: the three kinds of tuft, and the island's cap on them.
//
// MAX_FLOWERS is shared because a tuft and a flower are the same order of
// magnitude - a few hundred of each on a few thousand grass cells - and sizing
// both off one bound keeps the two from drifting apart as their densities are
// tuned separately.
//
// Each kind gets its own bound, sized as if EVERY tuft were that kind, which
// cannot happen. That is deliberate: a shared pool across kinds would mean one
// kind could silently starve another, and which kind lost would depend on hash
// order rather than on anything you can see. The unused capacity is dead weight
// in a vertex buffer and nothing else.
//
// Three cards for the clump and the fan, two for the spike. This camera only ever
// looks from (+1,+1,+1), and from there two crossed planes both sit about 55
// degrees off normal, so a two-card cross thins to a sliver from the only
// viewpoint that exists. The spike is the exception: it is sparse and upright by
// design, and a third card would fill in the gaps that make it read as a spike.
const GRASS_KINDS: readonly (readonly [
  import('./textures').GrassKind,
  { cards: number; cardW: number; cardH: number; splayMin: number; splayMax: number },
])[] = [
  ['sprout', { cards: 2, cardW: 0.44, cardH: 0.54, splayMin: 0.04, splayMax: 0.14 }],
  ['tuft', { cards: 2, cardW: 0.48, cardH: 0.62, splayMin: 0.06, splayMax: 0.18 }],
  ['cluster', { cards: 2, cardW: 0.52, cardH: 0.68, splayMin: 0.05, splayMax: 0.16 }],
];

const MAX_TALL_GRASS = 6500;

// Of the cells the tuft mask admits, the fraction that grows one. Tuned to land
// at roughly one tuft per ten grass cells: dense enough that the meadow reads as
// covered, sparse enough that it is still grass with tufts in it rather than a
// lawn of spikes.
//
// Two things about this number that are not obvious from it:
//
// It is not a coin flip, so it does not do what it says. Smooth value noise
// admits whole regions of the meadow and none of the others, not a flat fraction
// of cells, so the product of the two gates lands well below what either number
// suggests. This was measured at 0.34 -> 1057 tufts, which is one in four, and
// scaled back from there rather than guessed.
//
// And the cap it is measured against has to not bind. MAX_TALL_GRASS is a bound,
// not a density control; the mesh is sized off it in blades and the gate is tuned
// for a few hundred tufts. An earlier pass had the bound at half this, the blade
// counter standing in for the tuft counter, and the two together pinned the
// meadow at a quarter of the density being asked for while the constant sat in
// the file looking adjustable.
const TALL_GRASS_CHANCE = 0.15;

// Plants are fully matte. A petal or a blade has no specular lobe, and at the
// fifteen pixels a flower or a tuft occupies at the default zoom, any highlight
// would only read as noise.
function mattePlant(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0 });
}

function flowerStemMaterial(color: number): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0 });
  mat.customProgramCacheKey = () => `flowerStem:${color}`;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = windUniforms.uWindTime;
    shader.uniforms.uWindDir = windUniforms.uWindDir;
    shader.uniforms.uWindStrength = windUniforms.uWindStrength;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uWindTime;
uniform vec2 uWindDir;
uniform float uWindStrength;`
      )
      .replace(
        '#include <project_vertex>',
        `vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
float h = clamp(position.y + 0.5, 0.0, 1.0);
float bend = h * h;
vec3 wPos = (modelMatrix * mvPosition).xyz;
float wave = sin(wPos.x * 0.3 + wPos.z * 0.3 - uWindTime * 2.8) * 0.7
           + sin(wPos.x * 0.7 - wPos.z * 0.6 - uWindTime * 4.2) * 0.3;
float gust = 0.7 + 0.3 * sin(uWindTime * 0.8 + wPos.x * 0.05);
float displacement = wave * gust * uWindStrength * bend * 0.16;
mvPosition.x += uWindDir.x * displacement;
mvPosition.z += uWindDir.y * displacement;
mvPosition.y -= abs(displacement) * 0.12;
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`
      );
  };
  return mat;
}

function flowerHeadMaterial(color: number): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0 });
  mat.customProgramCacheKey = () => `flowerHead:${color}`;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = windUniforms.uWindTime;
    shader.uniforms.uWindDir = windUniforms.uWindDir;
    shader.uniforms.uWindStrength = windUniforms.uWindStrength;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uWindTime;
uniform vec2 uWindDir;
uniform float uWindStrength;`
      )
      .replace(
        '#include <project_vertex>',
        `vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
vec3 wPos = (modelMatrix * mvPosition).xyz;
float wave = sin(wPos.x * 0.3 + wPos.z * 0.3 - uWindTime * 2.8) * 0.7
           + sin(wPos.x * 0.7 - wPos.z * 0.6 - uWindTime * 4.2) * 0.3;
float gust = 0.7 + 0.3 * sin(uWindTime * 0.8 + wPos.x * 0.05);
float displacement = wave * gust * uWindStrength * 0.16;
mvPosition.x += uWindDir.x * displacement;
mvPosition.z += uWindDir.y * displacement;
mvPosition.y -= abs(displacement) * 0.12;
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`
      );
  };
  return mat;
}

// The material one grass card is made of. Three of these, one per kind, each
// carrying its own mask.
function grassCardMaterial(mask: THREE.Texture): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: mask,
    // The mask is an alpha shape, and alphaTest is what consumes it.
    //
    // This is NOT transparent:true, deliberately, and the reason is the same as
    // the tree dither's: alpha blending moves a mesh into three's transparent
    // queue, which sorts whole objects by distance rather than by fragment. A
    // meadow of blended cards would sort against each other and against the
    // terrain, and the ones in front would punch through what is behind them.
    // alphaTest discards the fragments outside the shape and keeps the material
    // fully opaque, so there is no sort order to get wrong.
    //
    // Just under half, so a minified card keeps enough coverage to survive the
    // downsample at the default zoom rather than eroding into speckle.
    alphaTest: 0.5,
    // A card has no meaningful front. Without this the back of each cross is
    // invisible and the tuft vanishes as the camera pans.
    side: THREE.DoubleSide,
    roughness: 1,
    metalness: 0,
  });
  mat.customProgramCacheKey = () => `grassCard:${mask.id}`;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = windUniforms.uWindTime;
    shader.uniforms.uWindDir = windUniforms.uWindDir;
    shader.uniforms.uWindStrength = windUniforms.uWindStrength;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uWindTime;
uniform vec2 uWindDir;
uniform float uWindStrength;`
      )
      .replace(
        '#include <project_vertex>',
        `vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
// Wind sway: local position.y is 0 at base, 1 at tip
float h = clamp(position.y, 0.0, 1.0);
float bend = h * h;
vec3 wPos = (modelMatrix * mvPosition).xyz;
float wave = sin(wPos.x * 0.3 + wPos.z * 0.3 - uWindTime * 2.8) * 0.7
           + sin(wPos.x * 0.7 - wPos.z * 0.6 - uWindTime * 4.2) * 0.3;
float gust = 0.7 + 0.3 * sin(uWindTime * 0.8 + wPos.x * 0.05);
float displacement = wave * gust * uWindStrength * bend * 0.22;
mvPosition.x += uWindDir.x * displacement;
mvPosition.z += uWindDir.y * displacement;
mvPosition.y -= abs(displacement) * 0.15;
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`
      );
  };
  return mat;
}
// Flowers on the grass, in drifts, the way the original's flower hash clustered
// them rather than an even sprinkle over every cell.
//
// A flower OCCUPIES ONE BLOCK. It used to be a single 0.15-unit cube sitting on
// the surface, which was 0.2% of the frame at the default zoom - a speck of
// paint that only registered as colour. A flower is now built from six small
// cubes inside its cell: a stem, a plus of four petals and a contrasting centre.
// At the default zoom that is about fifteen pixels tall, which is enough for a
// stem and a bloom to be separately visible.
//
// The cell is the unit of placement and of ownership: a flower is centred on
// its cell (never straddling two) and its total height stays under one VOXEL, so
// it can never poke into the cell above and break the block grid.
//
// Six sub-cubes per flower means six instances, which is why the sub-meshes are
// built to the number of flowers rather than to a cell count.
export function createFlowers(): THREE.Group {
  const group = new THREE.Group();

  // Proportions, all relative to the 1-unit voxel.
  //
  // The bloom is a plus of four petals around a centre: at ~15px of screen per
  // flower a five-cube head is the most that still reads as a flower rather than
  // as a smudge, and a flat single cube is what this replaced.
  //
  // The first pass had a 0.74-wide head over a 0.62-tall stem, and a head wider
  // than the stem is tall is the proportion that reads as a mushroom. Slimming
  // the stem and the petals fixes that; the head is now narrower than the flower
  // is tall, which is what a flower looks like from a distance.
  const STEM_W = 0.16;
  const STEM_H = 0.62;
  const PETAL = 0.2;
  const PETAL_H = 0.17;
  const CENTRE = 0.19;
  // Taller than the petals on purpose. The centre shares a y with them, so the
  // extra height is what pushes its top face clear of the petal ring - without
  // that the core sits down inside the bloom and the head is one flat lump.
  const CENTRE_H = 0.28;
  // Petal centres sit far enough out to touch the centre cube and each other, so
  // the bloom is one connected shape and not four loose cubes near a dot.
  const BLOOM_OFF = (CENTRE + PETAL) / 2;

  const stemMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(STEM_W, 1, STEM_W),
    flowerStemMaterial(PALETTE.flowerStem),
    MAX_FLOWERS
  );
  // The petals and the centres carry an instance colour each: one mesh holds all
  // three bloom kinds rather than three meshes holding one kind apiece.
  const petalMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(PETAL, PETAL_H, PETAL),
    flowerHeadMaterial(0xffffff),
    MAX_FLOWERS * 4
  );
  petalMesh.instanceColor = new THREE.InstancedBufferAttribute(
    new Float32Array(MAX_FLOWERS * 4 * 3), 3
  );
  const centreMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(CENTRE, CENTRE_H, CENTRE),
    flowerHeadMaterial(0xffffff),
    MAX_FLOWERS
  );
  centreMesh.instanceColor = new THREE.InstancedBufferAttribute(
    new Float32Array(MAX_FLOWERS * 3), 3
  );
  for (const mesh of [stemMesh, petalMesh, centreMesh]) {
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  let nStem = 0;
  let nPetal = 0;
  let nCentre = 0;

  for (let j = 0; j < GRID && nStem < MAX_FLOWERS; j++) {
    for (let i = 0; i < GRID && nStem < MAX_FLOWERS; i++) {
      // grass rim and up; LEVEL_BEACH is the old hardcoded 2
      if (levels[j * GRID + i] < LEVEL_GRASS) continue;

      // WHERE flowers are allowed to grow: a low-frequency mask, sampled per
      // cell, so they clump into drifts instead of dusting the whole meadow.
      // This part is unchanged from the speck version and worth keeping exactly
      // as it is - the drift shape is good.
      if (vn(i * 0.045, j * 0.045, 61) < 0.62) continue;

      // HOW MANY of those cells actually grow one. This is new, and it is the
      // whole reason the meadow still looks like a meadow.
      //
      // The old version put a flower on every cell the drift mask let through -
      // about one in five grass cells, which was tuned for specks, where density
      // is the only thing making a flower visible at all. A flower now covers a
      // good fraction of its cell and stands a block tall, so that same rate
      // carpets roughly a fifth of the island in flower and there is no meadow
      // left to be pretty. A flower is legible at about a tenth the density of a
      // speck, so the gate cuts by roughly that much again on top.
      if (hs(i, j, 59) > FLOWER_CHANCE) continue;

      const topY = levels[j * GRID + i] * VOXEL;
      // Centred on its own cell, with a jitter well under half a cell so the
      // flower always reads as belonging to one block rather than straddling two.
      const x = cellX(i) + (hs(i, j, 41) - 0.5) * VOXEL * 0.2;
      const z = cellZ(j) + (hs(i, j, 43) - 0.5) * VOXEL * 0.2;

      // Stem height varies a little per flower. A field of identical posts reads
      // as a fence; this keeps a drift looking grown rather than placed, and it
      // costs one hash and a scale.
      //
      // The top of that range is bounded by the one-block budget. The tallest
      // flower is STEM_H * 1.08 + CENTRE_H = 0.95, and it has to stay under
      // VOXEL: a flower poking into the cell above breaks the block grid, and a
      // jittered stem can push it sideways into its neighbour's cell at the same
      // time. This is the number to lower first if the flower ever grows.
      const stemH = STEM_H * (0.88 + hs(i, j, 71) * 0.2);
      m.makeScale(1, stemH, 1);
      m.setPosition(x, topY + stemH / 2, z);
      stemMesh.setMatrixAt(nStem, m);

      const kind = hs(i, j, 47);
      const warm = kind > 0.38 && kind <= 0.82;   // the yellow blooms
      c.setHex(
        kind > 0.82 ? PALETTE.flowerPink : warm ? PALETTE.flowerYellow : PALETTE.flowerWhite,
        THREE.SRGBColorSpace
      );
      c.toArray(petalMesh.instanceColor!.array, nPetal * 3);
      c.setHex(warm ? PALETTE.flowerCentreWarm : PALETTE.flowerCentre, THREE.SRGBColorSpace);
      c.toArray(centreMesh.instanceColor!.array, nCentre * 3);

      // The centre sits on top of the stem, slightly proud of the petals: it is
      // the one part of the bloom that should catch the light rather than sit
      // flat inside the head.
      m.makeScale(1, 1, 1);
      m.setPosition(x, topY + stemH + CENTRE_H / 2, z);
      centreMesh.setMatrixAt(nCentre, m);

      // The plus of four petals around it.
      for (const [dx, dz] of PETAL_PLUS) {
        m.setPosition(x + dx * BLOOM_OFF, topY + stemH + CENTRE_H / 2, z + dz * BLOOM_OFF);
        petalMesh.setMatrixAt(nPetal, m);
        c.toArray(petalMesh.instanceColor!.array, nPetal * 3);
        nPetal++;
      }

      nCentre++;
      nStem++;
    }
  }

  stemMesh.count = nStem;
  petalMesh.count = nPetal;
  centreMesh.count = nCentre;
  stemMesh.instanceMatrix.needsUpdate = true;
  petalMesh.instanceMatrix.needsUpdate = true;
  centreMesh.instanceMatrix.needsUpdate = true;
  petalMesh.instanceColor!.needsUpdate = true;
  centreMesh.instanceColor!.needsUpdate = true;
  return group;
}

// Tall grass: a tuft of four blades in a plus, filling the meadow between the
// flower drifts.
//
// This is the ground cover the meadow was missing once the flowers went from one
// in five grass cells to one in thirty-three. Without it there is a lot of bare
// textured green between the drifts, and the flowers sit on a lawn rather than in
// a meadow. Everything it shares with the flowers - the per-cell level grid, the
// cell-to-world mapping, the jitter, the one-block budget - is deliberately the
// same machinery, so the two read as one system of ground cover rather than two
// unrelated scatter passes.
//
// The shape is Minecraft's: crossed, alpha-cutout planes, each carrying a blade
// mask. The first attempt at this used four thin BOXES in a plus, and that was
// wrong in a way that only showed up on screen - a box has thickness, so a
// stand-in for a blade renders as a solid upright pole, and four of them in a
// plus is a picket fence. A plane has no thickness and a mask gives it a blade
// shape, which is the difference between a tuft of grass and four green sticks.
//
// Three planes per tuft rather than Minecraft's two, because two planes read as
// one flat card from any single viewpoint and this camera only ever looks from
// (+1,+1,+1) - from there two crossed planes both face roughly 55 degrees off
// normal, so the tuft goes thin and papery. Three at different yaws, each leaning
// outward, hold up from that one direction and every other.
//
// The planes are yawed 45 degrees off the world axes rather than aligned to them.
// That is a deliberate departure from Minecraft, and it is because this camera is
// fixed: a plane whose normal runs along (1,0,1) sits about 35 degrees off the
// view axis, where an axis-aligned one sits at 55. For a flat card you can only
// ever see at an angle, that is the difference between a legible blade and a
// sliver.
//
// It does not CAST shadows, which is the one thing it does differently from the
// flowers. A blade is thin and about half a block tall: cast at the default sun
// its shadow is a few pixels, and cast at dawn or dusk, when the sun is four
// degrees up, it is a thirteen-unit-long hair. A meadow of those is noise, not
// shadow. It still RECEIVES, so tufts sitting in a tree's shadow darken with the
// grass around them.
//
// Like the flowers it does not collide - player collision reads the terrain
// level and the trunk cells, neither of which knows anything about either of
// them, so walking through a meadow is free.
export function createTallGrass(treeLocs: readonly { x: number; z: number }[] = []): THREE.Group {
  const group = new THREE.Group();

  // Card width, height and splay all live in GRASS_KINDS above, one set per kind:
  // a clump is short and barely leans, a fan is tall and leans hard, a spike is
  // upright and sparse. What they share is this: the mask's blades fill a card
  // edge to edge, so the card is the tuft's footprint and nothing is wasted
  // around them.
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  const quat = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const scale = new THREE.Vector3();
  const pos = new THREE.Vector3();

  // One mesh per kind. Each carries its own alpha mask
  interface Built {
    mesh: THREE.InstancedMesh;
    spec: (typeof GRASS_KINDS)[number][1];
    kind: import('./textures').GrassKind;
    n: number;
  }
  const built: Built[] = GRASS_KINDS.map(([kind, spec]) => {
    const geo = new THREE.PlaneGeometry(spec.cardW, 1).translate(0, 0.5, 0);
    const mesh = new THREE.InstancedMesh(geo, grassCardMaterial(grassMask(kind)), MAX_TALL_GRASS * spec.cards);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(MAX_TALL_GRASS * spec.cards * 3), 3
    );
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return { mesh, spec, kind, n: 0 };
  });

  // Strict non-sand check with perimeter margin to guarantee blade card never overhangs sand:
  const isStrictGrass = (px: number, pz: number, rMargin = 0.28): boolean => {
    if (levelAtWorld(px, pz) < LEVEL_GRASS) return false;
    if (groundHeight(px, pz) <= 1.18) return false;
    if (isSand(px, pz) || isUnderwater(px, pz)) return false;
    if (groundHeight(px + rMargin, pz) <= 1.15 || levelAtWorld(px + rMargin, pz) < LEVEL_GRASS) return false;
    if (groundHeight(px - rMargin, pz) <= 1.15 || levelAtWorld(px - rMargin, pz) < LEVEL_GRASS) return false;
    if (groundHeight(px, pz + rMargin) <= 1.15 || levelAtWorld(px, pz + rMargin) < LEVEL_GRASS) return false;
    if (groundHeight(px, pz - rMargin) <= 1.15 || levelAtWorld(px, pz - rMargin) < LEVEL_GRASS) return false;
    return true;
  };

  // Helper to emit a complete crossed-card tuft at a specified world position
  const emitTuft = (
    slot: Built,
    tx: number,
    ty: number,
    tz: number,
    baseH: number,
    baseYaw: number,
    seed: number
  ): boolean => {
    const spec = slot.spec;
    if (slot.n + spec.cards > MAX_TALL_GRASS * spec.cards) return false;
    for (let k = 0; k < spec.cards; k++) {
      const cardH = baseH * (0.86 + hs(seed + k, seed - k, 151 + k) * 0.24);
      const yaw = baseYaw + (k * Math.PI) / spec.cards;
      const splay = spec.splayMin + hs(seed + k * 3, seed + k * 5, 167 + k) * (spec.splayMax - spec.splayMin);
      const lean = k % 2 === 0 ? splay : -splay;

      euler.set(lean, yaw, 0, 'YXZ');
      quat.setFromEuler(euler);
      scale.set(1, cardH, 1);
      pos.set(tx, ty, tz);
      m.compose(pos, quat, scale);
      slot.mesh.setMatrixAt(slot.n, m);

      // Color variation across the 3 tones in PALETTE.tallGrass
      const toneChoice = hs(seed + k * 2, seed + k * 7, 157 + k);
      const toneIdx = toneChoice < 0.35 ? 0 : toneChoice < 0.75 ? 1 : 2;
      c.setHex(PALETTE.tallGrass[toneIdx] ?? PALETTE.tallGrass[0], THREE.SRGBColorSpace);
      c.toArray(slot.mesh.instanceColor!.array, slot.n * 3);
      slot.n++;
    }
    return true;
  };

  // Iterate across all columns without early loop termination so every area is fully covered
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const baseX = cellX(i);
      const baseZ = cellZ(j);
      const cellLevel = levels[j * GRID + i];

      // Must be on grass surface, NEVER on sand or water!
      if (cellLevel < LEVEL_GRASS || groundHeight(baseX, baseZ) <= GRASS_H) continue;

      // Tree proximity bonus
      let nearTree = false;
      for (let t = 0; t < treeLocs.length; t++) {
        const tr = treeLocs[t];
        const dx = baseX - tr.x;
        const dz = baseZ - tr.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < 3.2 * 3.2 && d2 > 0.6 * 0.6) {
          nearTree = true;
          break;
        }
      }

      // Step/terrace edge bonus
      const isEdge =
        levels[j * GRID + Math.min(GRID - 1, i + 1)] !== cellLevel ||
        levels[j * GRID + Math.max(0, i - 1)] !== cellLevel ||
        levels[Math.min(GRID - 1, j + 1) * GRID + i] !== cellLevel ||
        levels[Math.max(0, j - 1) * GRID + i] !== cellLevel;

      // Natural meadow drift pattern (low-frequency smooth variation)
      const drift = vn(baseX * 0.055, baseZ * 0.055, 73);
      let spawnChance = 0.09 + drift * 0.12; // 0.10 to 0.20
      if (nearTree) spawnChance += 0.08;
      if (isEdge) spawnChance += 0.05;

      // Deterministic per-cell gate
      if (hs(i, j, 101) > spawnChance) continue;

      // Continuous organic jitter breaking the voxel grid
      const jx = (hs(i, j, 41) - 0.5) * 0.72 * VOXEL;
      const jz = (hs(i, j, 43) - 0.5) * 0.72 * VOXEL;
      const cx = baseX + jx;
      const cz = baseZ + jz;

      // Strictly verify cluster center is safe on grass
      if (!isStrictGrass(cx, cz)) continue;
      const cy = cellLevel * VOXEL;

      const seed = i * 439 + j * 1063;
      const archRoll = hs(i, j, 131);

      if (archRoll < 0.20) {
        // Archetype 1: Lush Trio Bouquet (Main + 2 companions) - 20%
        const mainSlot = hs(i, j, 173) < 0.55 ? built[2] : built[1]; // cluster or tuft
        const mainH = mainSlot.spec.cardH * (0.95 + hs(i, j, 149) * 0.30);
        const mainYaw = hs(i, j, 163) * Math.PI * 2;
        emitTuft(mainSlot, cx, cy, cz, mainH, mainYaw, seed);

        // Companion 1
        const ang1 = hs(i, j, 211) * Math.PI * 2;
        const dist1 = 0.20 + hs(i, j, 223) * 0.14;
        const c1x = cx + Math.cos(ang1) * dist1;
        const c1z = cz + Math.sin(ang1) * dist1;
        if (isStrictGrass(c1x, c1z) && levelAtWorld(c1x, c1z) === cellLevel) {
          const comp1Slot = built[0]; // sprout
          const comp1H = mainH * (0.68 + hs(i, j, 229) * 0.18);
          const comp1Yaw = ang1 + 0.4;
          emitTuft(comp1Slot, c1x, cy, c1z, comp1H, comp1Yaw, seed + 101);
        }

        // Companion 2
        const ang2 = ang1 + 2.1 + (hs(i, j, 241) - 0.5) * 0.6;
        const dist2 = 0.22 + hs(i, j, 251) * 0.14;
        const c2x = cx + Math.cos(ang2) * dist2;
        const c2z = cz + Math.sin(ang2) * dist2;
        if (isStrictGrass(c2x, c2z) && levelAtWorld(c2x, c2z) === cellLevel) {
          const comp2Slot = hs(i, j, 263) < 0.6 ? built[0] : built[1];
          const comp2H = mainH * (0.62 + hs(i, j, 271) * 0.20);
          const comp2Yaw = ang2 + 0.3;
          emitTuft(comp2Slot, c2x, cy, c2z, comp2H, comp2Yaw, seed + 203);
        }
      } else if (archRoll < 0.60) {
        // Archetype 2: Natural Twin Pair (Main + 1 companion) - 40%
        const mainSlot = hs(i, j, 173) < 0.45 ? built[0] : built[1]; // sprout or tuft
        const mainH = mainSlot.spec.cardH * (0.88 + hs(i, j, 149) * 0.28);
        const mainYaw = hs(i, j, 163) * Math.PI * 2;
        emitTuft(mainSlot, cx, cy, cz, mainH, mainYaw, seed);

        // Companion
        const ang = hs(i, j, 211) * Math.PI * 2;
        const dist = 0.22 + hs(i, j, 223) * 0.15;
        const cx2 = cx + Math.cos(ang) * dist;
        const cz2 = cz + Math.sin(ang) * dist;
        if (isStrictGrass(cx2, cz2) && levelAtWorld(cx2, cz2) === cellLevel) {
          const compSlot = built[0]; // sprout
          const compH = mainH * (0.72 + hs(i, j, 229) * 0.20);
          const compYaw = ang + 0.5;
          emitTuft(compSlot, cx2, cy, cz2, compH, compYaw, seed + 307);
        }
      } else {
        // Archetype 3: Lone Accent - 40%
        const pick = hs(i, j, 173);
        const slot = pick < 0.35 ? built[0] : pick < 0.70 ? built[1] : built[2];
        const h = slot.spec.cardH * (0.85 + hs(i, j, 149) * 0.30);
        const yaw = hs(i, j, 163) * Math.PI * 2;
        emitTuft(slot, cx, cy, cz, h, yaw, seed);
      }
    }
  }

  for (const slot of built) {
    slot.mesh.count = slot.n;
    slot.mesh.instanceMatrix.needsUpdate = true;
    slot.mesh.instanceColor!.needsUpdate = true;
  }
  return group;
}