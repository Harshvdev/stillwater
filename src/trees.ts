import * as THREE from 'three';
import {
  VOXEL, GRID, REGION_HALF, LEVEL_GRASS, levelAtWorld, voxelMaterial, coastRadius, WIDTH_SCALE,
} from './island';
import { PALETTE, pick } from './palette';

// Trees, Minecraft style: a bare square log column with a solid cube canopy
// sitting on top, the way an oak reads at a glance. Everything is built from
// whole voxels - the trunk is one voxel square, the canopy is a stack of
// three leaf-cube layers - so a tree lands on the same lattice as the terrain
// and reads as chunky pixel art rather than a smooth plant.
//
// Two instanced meshes, 2 draw calls for the whole forest: one for trunks,
// one for every leaf cube.

// Same hash as the terrain and the flowers, so a tree's cell and its
// per-cube leaf shading agree with everything else on the grid.
const hs = (i: number, j: number, s = 0): number => {
  const x = Math.sin(i * 127.1 + j * 311.7 + s * 74.7) * 43758.5453;
  return x - Math.floor(x);
};

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// Normalised radius: 0 at the island's centre, 1 at the shoreline. Uses the
// same squashed z basis as groundHeight, so the number matches the terrain's
// own d and the grass band really does span roughly 0.07 to 0.97.
function normRadius(x: number, z: number): number {
  const sz = z / WIDTH_SCALE;
  return Math.hypot(x, sz) / coastRadius(Math.atan2(sz, x));
}

// Placement density. Scattered singly - each grass cell is decided on its own
// hash, never clustered - and thinning toward the middle of the island so the
// centre stays open meadow.
//
// These are deliberately tiny. A Minecraft canopy is 5 voxels across on a
// 1-voxel grid - it covers 25 cells of ground - so even a low per-cell rate
// closes into a wall of leaves. At 0.05 the trees still filled 51% of the
// frame with canopy. At 0.012 they are landmarks in a meadow, which is what
// the brief asked for: fewer trees, not a forest.
const BASE_DENSITY = 0.012;
const CENTER_DENSITY = 0.25;

// The player's height, measured from its own geometry at runtime rather than
// restated here, so the trunk cannot drift out of step with the model if the
// player is ever resized. The bare trunk below the leaves is this plus two
// voxels, so the tree stands a clear two blocks over the figure standing in it.
const PLAYER_H = 1.83;
const TRUNK_VISIBLE = PLAYER_H + 2 * VOXEL;

// Trunk width: one voxel square, the Minecraft log.
const TRUNK_W = VOXEL;

// Canopy, bottom to top - three layers, each one voxel deep:
//
//   1. a complete slab surrounding the trunk
//   2. a plus sign, the cross of cubes around the trunk's axis
//   3. a single cube crowning the very top of the trunk
//
// The trunk runs all the way up through layers 1 and 2 and ends flush with the
// underside of layer 3, so the trunk's tip pokes into the canopy instead of
// stopping short of it.
const LEAF_W = 5; // layer 1 is a full LEAF_W square, trunk cell left open
const LEAF_H = VOXEL;

// layer 1: the full square minus the trunk's own cell
const L1 = LEAF_W * LEAF_W - 1;
// layer 2: a plus, which on a 3-wide footprint is the centre plus four arms.
// The centre is the trunk's cell, so only the four arms are leaf.
const L2 = 4;
// layer 3: one cube
const L3 = 1;
const LEAF_PER_TREE = L1 + L2 + L3;

// Upper bound on instances. A tree costs 1 trunk + LEAF_PER_TREE leaves.
const MAX_TREES = 400;
const MAX_LEAVES = MAX_TREES * LEAF_PER_TREE;

// Trunk occupancy, keyed by grid cell -> trunk height above that cell's
// surface. The player's collision reads this. Only the TRUNK blocks: the
// canopy sits above head height, so the player walks under the leaves
// unimpeded and only has to go around the log.
const trunkCells = new Map<number, number>();

export interface TreeLocation {
  x: number;
  z: number;
  groundY: number;
  canopyY: number;
}

export const treeLocations: TreeLocation[] = [];

// ---------------------------------------------------------------- occlusion
// A tree standing between the camera and the player fades out, so the player
// is never lost behind a trunk. The camera is a fixed orthographic iso offset
// of (+1,+1,+1), so "between" is a projection onto that one axis rather than a
// real ray cast: a tree occludes when it is nearer the camera than the player
// is AND its screen footprint overlaps the player's.
//
// FADE_MIN is the floor a fully-occluded tree fades to. Not lower: at this
// zoom a tree is a dozen pixels across, and dropping much past this turns it
// into a smear rather than a see-through tree.
const FADE_MIN = 0.28;

// How wide the player reads on screen, in the same units as `off` below. The
// player is ~0.6 wide and ~1.8 tall; measured across the iso projection its
// diagonal footprint is about 1.0, and half of that is the radius from their
// centre to the edge that a tree has to reach.
const PLAYER_SCREEN_R = 0.9;
// Half the canopy's diagonal: a 5-voxel-wide, 3-layer canopy spans 5 voxels,
// so its silhouette is a ~3.5-unit circle in the same projected units.
const TREE_SCREEN_R = 2.5;

// Narrow. See the note at the test below: this is an on/off with a short
// ease, not a ramp across the whole overlap distance.
const EDGE_FEATHER = 0.35;

// A tree counts as occluding once it is genuinely in front of the player along
// the view axis. This is a fixed threshold, not a fade: crossing it flips the
// tree between solid and dithered, which is the intended behaviour.
const DEPTH_MIN = 0.25;

const VIEW_DIR = new THREE.Vector3(1, 1, 1).normalize();

/** Per-tree fade, 1 = solid. Parallel to the trunk/leaf instance order. */
let fades: Float32Array = new Float32Array(0);
let treeCount = 0;
let trunkMesh: THREE.InstancedMesh | null = null;
let leafMesh: THREE.InstancedMesh | null = null;
let fadeAttr: THREE.InstancedBufferAttribute | null = null;
let leafFadeAttr: THREE.InstancedBufferAttribute | null = null;

const _rel = new THREE.Vector3();
const _perp = new THREE.Vector3();

/**
 * Fade any tree standing between the camera and the player.
 *
 * `playerPos` is the player's world position; its Y is ignored for the overlap
 * test because the camera looks down at 45 degrees, so what matters is where
 * the two sit on the ground plane.
 */
export function updateTreeFade(playerPos: THREE.Vector3): void {
  if (!trunkMesh || !leafMesh || !fadeAttr || !leafFadeAttr || treeCount === 0) return;

  for (let k = 0; k < treeCount; k++) {
    // the trunk's base, which is where the tree's footprint sits
    const m = trunkMesh.instanceMatrix.array;
    const tx = m[k * 16 + 12];
    const tz = m[k * 16 + 14];

    _rel.set(tx - playerPos.x, 0, tz - playerPos.z);
    // positive when the tree is nearer the camera than the player
    const depth = _rel.dot(VIEW_DIR);
    if (depth < DEPTH_MIN) {
      fades[k] = 1;
      continue;
    }

    // Distance off the view axis. This is a SCREEN-space distance: the camera
    // is orthographic with a fixed direction, so moving along VIEW_DIR only
    // changes depth and leaves this untouched. That matters, because fading on
    // anything depth-dependent made a tree change opacity as the player walked
    // toward or away from it while staying behind it.
    _perp.copy(_rel).addScaledVector(VIEW_DIR, -depth);
    const off = _perp.length();

    // A tree is occluding when the player's own footprint overlaps the tree's
    // canopy, not merely when they are near it. Both radii are in the same
    // screen-space units, so the test is a straight sum: the player is
    // PLAYER_SCREEN_R wide on screen, the canopy is LEAF_W across, and they
    // have to touch for one to hide the other.
    //
    // EDGE_FEATHER is deliberately narrow. A wide feather makes the fade a
    // gradient over distance - the tree is half-transparent when its edge is
    // near the player and fully transparent when centred, which reads as the
    // opacity changing for no reason. A narrow one keeps it effectively on or
    // off, easing only over the last fraction so it does not pop.
    const reach = PLAYER_SCREEN_R + TREE_SCREEN_R;
    let f = 1;
    if (off < reach + EDGE_FEATHER) {
      const t = 1 - Math.max(0, Math.min(1, (off - reach + EDGE_FEATHER) / (EDGE_FEATHER * 2)));
      f = 1 - (1 - FADE_MIN) * t;
    }
    fades[k] = f;
  }

  for (let k = 0; k < treeCount; k++) {
    fadeAttr.setX(k, fades[k]);
    // a tree is one trunk plus LEAF_PER_TREE cubes; they all fade together
    const base = k * LEAF_PER_TREE;
    for (let s = 0; s < LEAF_PER_TREE; s++) leafFadeAttr.setX(base + s, fades[k]);
  }
  fadeAttr.needsUpdate = true;
  leafFadeAttr.needsUpdate = true;
}

/**
 * True if a world point is inside a tree trunk, or close enough to one that a
 * body of the given radius would clip it.
 *
 * A trunk is a one-voxel square on the lattice, so "inside" means the point
 * falls in the same grid cell. `radius` widens the test to the nearest cell
 * too, which is what turns a point test into something a body can slide
 * against instead of tunnelling into.
 */
export function treeBlocks(x: number, z: number, radius: number): boolean {
  const i0 = Math.floor((x + REGION_HALF) / VOXEL);
  const j0 = Math.floor((z + REGION_HALF) / VOXEL);
  // only the 3x3 of cells around the point can be within `radius` of it
  for (let dj = -1; dj <= 1; dj++) {
    for (let di = -1; di <= 1; di++) {
      const i = i0 + di;
      const j = j0 + dj;
      if (i < 0 || j < 0 || i >= GRID || j >= GRID) continue;
      if (!trunkCells.has(j * GRID + i)) continue;
      // distance from the point to that cell's centre, in world units
      const cx = (i - GRID / 2 + 0.5) * VOXEL;
      const cz = (j - GRID / 2 + 0.5) * VOXEL;
      const dx = Math.abs(x - cx) - VOXEL / 2;
      const dz = Math.abs(z - cz) - VOXEL / 2;
      // squared distance to the cell's box, <= 0 when inside it
      const ox = Math.max(0, dx);
      const oz = Math.max(0, dz);
      if (ox * ox + oz * oz <= radius * radius) return true;
    }
  }
  return false;
}

export function createTrees(): THREE.Group {
  const group = new THREE.Group();

  // plain material, not the terrain's banded one: a tree is a solid object, so
  // the per-voxel-row depth falloff would only fight the silhouette. `fade` adds
  // the per-instance occlusion dither.
  // Two materials, not one. A trunk and a leaf cube are both unit boxes fed
  // from the same instance buffers, but they want opposite textures: the trunk
  // needs vertical grain and the canopy needs a fine dapple, and each is worth
  // its own program rather than a blend of the two. Still 2 draw calls - the
  // instanced meshes were always separate.
  //
  // Both carry `fade` for the per-instance occlusion dither.
  const barkMat = voxelMaterial({ fade: true, tex: 'bark' });
  const leafMat = voxelMaterial({ fade: true, tex: 'leaf', wind: true });

  const trunk = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), barkMat, MAX_TREES);
  const leaves = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), leafMat, MAX_LEAVES);
  trunk.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_TREES * 3), 3);
  leaves.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_LEAVES * 3), 3);
  // a trunk or leaf is one solid colour on every face, so its top-colour
  // buffer just repeats the instance colour. The shader still needs aTop, and
  // each mesh needs its own buffer because the two index independently.
  const trunkTop = new THREE.InstancedBufferAttribute(new Float32Array(MAX_TREES * 3), 3);
  const leavesTop = new THREE.InstancedBufferAttribute(new Float32Array(MAX_LEAVES * 3), 3);
  // per-instance occlusion value, one per trunk and one per leaf cube:
  // 1 = solid, lower = dithered away
  const trunkFade = new THREE.InstancedBufferAttribute(new Float32Array(MAX_TREES).fill(1), 1);
  const leafFade = new THREE.InstancedBufferAttribute(new Float32Array(MAX_LEAVES).fill(1), 1);
  trunkFade.setUsage(THREE.DynamicDrawUsage);
  leafFade.setUsage(THREE.DynamicDrawUsage);
  trunk.geometry.setAttribute('aTop', trunkTop);
  leaves.geometry.setAttribute('aTop', leavesTop);
  trunk.geometry.setAttribute('aFade', trunkFade);
  leaves.geometry.setAttribute('aFade', leafFade);
  trunk.frustumCulled = false;
  leaves.frustumCulled = false;

  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  let n = 0;
  let nLeaf = 0;

  // Rebuild the trunk occupancy and tree locations from scratch every call,
  // so a second createTrees() cannot inherit the previous one's trees.
  trunkCells.clear();
  treeLocations.length = 0;

  for (let j = 0; j < GRID && n < MAX_TREES; j++) {
    for (let i = 0; i < GRID && n < MAX_TREES; i++) {
      const x = (i - GRID / 2 + 0.5) * VOXEL;
      const z = (j - GRID / 2 + 0.5) * VOXEL;

      // grass and up only: no trees on the beach or in the shallows
      if (levelAtWorld(x, z) < LEVEL_GRASS) continue;

      // scattered singly, thinner toward the middle
      const rad = normRadius(x, z);
      const edge = smoothstep(0.3, 0.85, rad);
      const p = (CENTER_DENSITY + (1 - CENTER_DENSITY) * edge) * BASE_DENSITY;
      if (hs(i, j, 137) > p) continue;

      // keep the spawn clear so the player never starts inside a trunk
      if (Math.abs(x) < VOXEL * 2.5 && Math.abs(z) < VOXEL * 2.5) continue;

      const groundY = levelAtWorld(x, z) * VOXEL;

      // The trunk's bare section is two voxels taller than the player, then it
      // carries on up through the first two canopy layers. It stops flush
      // under the crowning cube, so the tip of the log is hidden inside the
      // leaves and the canopy sits on the trunk rather than floating above it.
      const trunkH = TRUNK_VISIBLE + 2 * LEAF_H;

      const bark = pick(PALETTE.bark, hs(i, j, 167));
      const leaf = pick(PALETTE.leaf, hs(i, j, 173));

      // where the canopy starts, and the underside of each layer
      const canopyY = groundY + TRUNK_VISIBLE;
      const half = Math.floor(LEAF_W / 2);

      // per-cube leaf shade, so a canopy breaks up like Minecraft's leaf
      // texture instead of reading as one flat green box
      const leafAt = (di: number, dj: number): number =>
        pick(PALETTE.leaf, hs(i + di, j + dj, 181) * 0.5 + hs(i, j, 173) * 0.5);

      const putLeaf = (lx: number, ly: number, lz: number, hex: number): void => {
        if (nLeaf >= MAX_LEAVES) return;
        m.makeScale(VOXEL, LEAF_H, VOXEL);
        m.setPosition(lx, ly + LEAF_H / 2, lz);
        leaves.setMatrixAt(nLeaf, m);
        c.setHex(hex, THREE.SRGBColorSpace);
        leaves.setColorAt(nLeaf, c);
        leavesTop.setXYZ(nLeaf, c.r, c.g, c.b);
        nLeaf++;
      };

      // --- trunk: a one-voxel log, running the full height of the tree ---
      m.makeScale(TRUNK_W, trunkH, TRUNK_W);
      m.setPosition(x, groundY + trunkH / 2, z);
      trunk.setMatrixAt(n, m);
      c.setHex(bark, THREE.SRGBColorSpace);
      trunk.setColorAt(n, c);
      trunkTop.setXYZ(n, c.r, c.g, c.b);

      // record the trunk's footprint for the player's collision
      trunkCells.set(j * GRID + i, trunkH);

      // --- layer 1: a complete slab surrounding the trunk ---
      // Every cell of the square except the trunk's own, so from the side this
      // reads as a solid shelf of leaves with the log passing through it.
      for (let dz = -half; dz <= half; dz++) {
        for (let dx = -half; dx <= half; dx++) {
          if (dx === 0 && dz === 0) continue; // the trunk's cell
          putLeaf(x + dx * VOXEL, canopyY, z + dz * VOXEL, leafAt(dx, dz));
        }
      }

      // --- layer 2: a plus, the four arms around the trunk's axis ---
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        putLeaf(x + dx * VOXEL, canopyY + LEAF_H, z + dz * VOXEL, leafAt(dx, dz));
      }

      // --- layer 3: a single cube at the very top of the trunk ---
      putLeaf(x, canopyY + 2 * LEAF_H, z, leaf);

      // record the tree canopy location for falling leaves
      treeLocations.push({ x, z, groundY, canopyY });

      n++;
    }
  }

  trunk.count = n;
  leaves.count = nLeaf;
  trunk.instanceMatrix.needsUpdate = true;
  leaves.instanceMatrix.needsUpdate = true;
  trunk.instanceColor!.needsUpdate = true;
  leaves.instanceColor!.needsUpdate = true;
  trunkTop.needsUpdate = true;
  leavesTop.needsUpdate = true;

  // hand the meshes to the fade pass
  trunkMesh = trunk;
  leafMesh = leaves;
  fadeAttr = trunkFade;
  leafFadeAttr = leafFade;
  treeCount = n;
  fades = new Float32Array(Math.max(1, n)).fill(1);

  group.add(trunk, leaves);
  return group;
}
