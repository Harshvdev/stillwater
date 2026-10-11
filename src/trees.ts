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

  // plain material, not the terrain's banded/outlined one: a tree is a solid
  // object, so the per-voxel-row banding and the terrace outline would only
  // fight the silhouette
  const mat = voxelMaterial();

  const trunk = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, MAX_TREES);
  const leaves = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, MAX_LEAVES);
  trunk.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_TREES * 3), 3);
  leaves.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_LEAVES * 3), 3);
  // a trunk or leaf is one solid colour on every face, so its top-colour
  // buffer just repeats the instance colour. The shader still needs aTop, and
  // each mesh needs its own buffer because the two index independently.
  const trunkTop = new THREE.InstancedBufferAttribute(new Float32Array(MAX_TREES * 3), 3);
  const leavesTop = new THREE.InstancedBufferAttribute(new Float32Array(MAX_LEAVES * 3), 3);
  trunk.geometry.setAttribute('aTop', trunkTop);
  leaves.geometry.setAttribute('aTop', leavesTop);
  trunk.frustumCulled = false;
  leaves.frustumCulled = false;

  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  let n = 0;
  let nLeaf = 0;

  // Rebuild the trunk occupancy from scratch every call, so a second
  // createTrees() cannot inherit the previous one's trees.
  trunkCells.clear();

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

      // The trunk's bare section is one voxel taller than the player, then it
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

  group.add(trunk, leaves);
  return group;
}
