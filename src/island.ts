import * as THREE from 'three';
import { COAST_RADII, COAST_SAMPLES } from './coast';
import { PALETTE, pick } from './palette';

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
// instance colour stays the side colour. Face light itself comes from the
// scene's lights, which is constant per cube face and so stays perfectly flat.
//
// A column is a cap cube over one stretched base box, so a cliff is a single
// tall quad. Painted flat, the cap and the base beneath it come out the same
// colour and the whole stack reads as one slab with no edge in it anywhere.
// With `bands`, aBandTop gives the world Y that row 0 of each instance sits at,
// and the shader darkens one hard step per VOXEL row below it, so every layer of
// every face is separately legible. The step is floor'd, not smooth: one flat
// value per voxel row, which is what keeps the GBA look. Top faces are left
// alone - vTopMix is 1 there - so only the sides get banded.
//
// The cap passes its own top, so its single row is 0. The base passes one voxel
// lower, which puts its topmost row at 1 and guarantees the cap/base seam is a
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

export function voxelMaterial(opts: { bands?: boolean; outline?: boolean } = {}): THREE.MeshLambertMaterial {
  const bands = opts.bands === true;
  const outline = opts.outline === true;
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  // every variant compiles from one onBeforeCompile source, so the cache key has
  // to name exactly which combination this material is
  mat.customProgramCacheKey = () => `voxel:${bands ? 'bands' : 'flat'}:${outline ? 'outline' : 'plain'}`;
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec3 aTop;
varying vec3 vTopColor;
varying float vTopMix;
${bands ? 'attribute float aBandTop;\nvarying float vBandTop;\nvarying float vWorldY;' : ''}
${outline ? 'attribute vec2 aExpose;\nvarying vec2 vExpose;\nvarying vec3 vLocal;' : ''}`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vTopColor = aTop;
vTopMix = step(0.5, normal.y);
${bands ? 'vBandTop = aBandTop;\nvWorldY = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).y;' : ''}
${outline ? 'vExpose = aExpose;\nvLocal = position;' : ''}`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vTopColor;
varying float vTopMix;
${bands ? `varying float vBandTop;
varying float vWorldY;
const float VOXEL_F = ${VOXEL.toFixed(1)};
const float ROW_SHADE = 0.08;
// deepest row the banding keeps stepping for. The island now spans 14 voxels
// (y=6 down to y=-8), so the clamp has to cover the whole column or the lower
// cliff would flatten out into one shade instead of staying layered.
const float ROW_CLAMP = ${(LEVEL_GRASS_HI - MIN_LEVEL).toFixed(1)};` : ''}
${outline ? `varying vec2 vExpose;
varying vec3 vLocal;
const float EDGE_HALF = ${EDGE_HALF.toFixed(4)};
const vec3 EDGE_COL = ${EDGE_COL_GLSL};
const float EDGE_VOXEL = ${VOXEL.toFixed(1)};` : ''}`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
diffuseColor.rgb = mix(diffuseColor.rgb, vTopColor, vTopMix);
${bands ? `float row = clamp(floor((vBandTop - vWorldY) / VOXEL_F), 0.0, ROW_CLAMP);
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
diffuseColor.rgb = mix(diffuseColor.rgb, EDGE_COL, max(lineX, lineZ) * vTopMix);` : ''}`
      );
  };
  return mat;
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
  const mat = voxelMaterial({ bands: true, outline: true });
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
      // two smooth octaves so colour drifts form soft patches; the small hash
      // term only dithers band edges, it must not make every cell differ
      const r = vn(i * 0.13, j * 0.13, 5) * 0.68 + vn(i * 0.38, j * 0.38, 9) * 0.32 +
        (hs(i, j, 5) - 0.5) * 0.12;
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

      // a cap hemmed in by taller neighbours loses a little light
      let ao = 0;
      for (let d = 0; d < 4; d++) {
        const ni = i + (d === 0 ? 1 : d === 1 ? -1 : 0);
        const nj = j + (d === 2 ? 1 : d === 3 ? -1 : 0);
        if (ni < 0 || nj < 0 || ni >= GRID || nj >= GRID) continue;
        if (levels[nj * GRID + ni] > level) ao += 1;
      }
      const aoK = 1 - ao * 0.07;

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
// Flower cubes speckled over the grass in drifts, the way the original's
// flower hash clustered them, rather than an even sprinkle over every cell.
export function createFlowers(): THREE.InstancedMesh {
  // 4x the cells means 4x the candidates, so the cap and the bloom offset both
  // scale with the finer grid. 0.3 cube was 15% of a 2-unit voxel; keep that
  // ratio against the 1-unit voxel.
  const max = 12288;
  const size = VOXEL * 0.15;
  const geo = new THREE.BoxGeometry(size, size, size);
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0xffffff }), max);
  mesh.frustumCulled = false;
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  let n = 0;

  for (let j = 0; j < GRID && n < max; j++) {
    for (let i = 0; i < GRID && n < max; i++) {
      // grass rim and up; LEVEL_BEACH is the old hardcoded 2
      if (levels[j * GRID + i] < LEVEL_GRASS) continue;
      // a low-frequency mask decides where flowers are allowed to grow at all.
      // The noise is sampled per cell, so the frequency is halved to keep each
      // drift the same physical size now that cells are half as wide.
      //
      // There is no second coin-flip gate here. There are 4x as many cells as
      // before, so keeping the same per-cell probability would thin the flowers
      // to a quarter of their old density; the drift mask alone already lands
      // near the original count, and it keeps them clustered the way the
      // original's flower hash did.
      if (vn(i * 0.045, j * 0.045, 61) < 0.62) continue;
      const topY = levels[j * GRID + i] * VOXEL;
      const rx = hs(i, j, 41);
      const rz = hs(i, j, 43);
      const x = cellX(i) + (rx - 0.5) * VOXEL * 0.7;
      const z = cellZ(j) + (rz - 0.5) * VOXEL * 0.7;
      const kind = hs(i, j, 47);
      c.setHex(
        kind > 0.82 ? PALETTE.flowerPink : kind > 0.38 ? PALETTE.flowerYellow : PALETTE.flowerWhite,
        THREE.SRGBColorSpace
      );
      m.setPosition(x, topY + size / 2, z);
      mesh.setMatrixAt(n, m);
      mesh.setColorAt(n, c);
      n++;
    }
  }

  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor!.needsUpdate = true;
  return mesh;
}