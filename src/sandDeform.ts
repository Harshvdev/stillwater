import * as THREE from 'three';
import {
  VOXEL, GRID, REGION_HALF, isSand, getSandColumns, getTerrainMesh, type SandColumn,
} from './island';

// A worn path rather than crisp prints: a soft trough with a low rim of sand
// pushed to the sides, healing away over LIFE seconds. The original's field
// constants are kept, but the field now lives on the voxel grid - one entry per
// sand column - and is quantised to QUANT before it reaches the geometry, so the
// sand dips in chunky pixel steps instead of sliding smoothly.
const LIFE = 10.0; // seconds until the sand is flat again
const HOLD = 0.25; // fraction of LIFE the mark keeps full depth
// DEPTH and SIGMA are world-space lengths tuned against the old 2-unit voxel;
// halving them keeps the footprint the same number of cells wide now that
// VOXEL is 1. QUANT derives from VOXEL so "quarter-voxel" keeps meaning that.
const DEPTH = 0.17; // trough depth
const SIGMA = 0.34; // trough radius
const BERM = 0.5; // rim height as a fraction of DEPTH
const BERM_R = 1.5; // rim radius in sigmas
const BERM_W = 0.55; // rim width in sigmas
const SPACING = 0.07; // distance between stamps
const MAX_DEPTH = DEPTH * 1.25;
const MAX_BERM = DEPTH * BERM;
const REBUILD_HZ = 30; // healing is slow, so the field is rebuilt at 30 Hz
const QUANT = VOXEL / 4; // sand moves in quarter-voxel increments

const REACH = SIGMA * (BERM_R + BERM_W * 2);

interface Stamp { x: number; z: number; age: number }

function envelope(age: number): number {
  const t = (age / LIFE - HOLD) / (1 - HOLD);
  if (t <= 0) return 1;
  if (t >= 1) return 0;
  return 1 - t * t * (3 - 2 * t);
}

const colOf = (world: number) => Math.floor((world + REGION_HALF) / VOXEL);

export function createSandDeform(): { update: (dt: number, pos: THREE.Vector3) => void } {
  const cols: SandColumn[] = getSandColumns();
  // cols is a compact list, so map grid cell -> index into it
  const sandAt = new Int32Array(GRID * GRID).fill(-1);
  for (let s = 0; s < cols.length; s++) {
    sandAt[colOf(cols[s].z) * GRID + colOf(cols[s].x)] = s;
  }
  // displacement per voxel column, plus a compact list of what is non-zero so
  // clearing and re-writing only touches the trail
  const field = new Float32Array(GRID * GRID);
  const touched: number[] = [];

  const stamps: Stamp[] = [];
  let acc = 0;
  let dirty = false;
  let anyField = false;

  const matrix = new THREE.Matrix4();

  function writeColumn(col: SandColumn, d: number): void {
    const mesh = getTerrainMesh();
    // the cap keeps its base and gives up the depth it was pressed by
    const h = VOXEL + d;
    matrix.makeScale(VOXEL, h, VOXEL);
    matrix.setPosition(col.x, col.topY - VOXEL / 2 + d / 2, col.z);
    mesh.setMatrixAt(col.capId, matrix);
  }

  function clear(): void {
    if (!anyField) return;
    for (const k of touched) {
      if (field[k] === 0) continue;
      field[k] = 0;
      const col = cols[sandAt[k]];
      if (col) writeColumn(col, 0);
    }
    touched.length = 0;
    anyField = false;
  }

  function accumulate(): void {
    for (const s of stamps) {
      const amp = envelope(s.age);
      if (amp <= 0) continue;
      const ci = colOf(s.x);
      const cj = colOf(s.z);
      for (let j = cj - 1; j <= cj + 1; j++) {
        if (j < 0 || j >= GRID) continue;
        for (let i = ci - 1; i <= ci + 1; i++) {
          if (i < 0 || i >= GRID) continue;
          const k = j * GRID + i;
          const si = sandAt[k];
          if (si < 0) continue; // not a sand column
          const col = cols[si];
          const vx = (i - GRID / 2 + 0.5) * VOXEL;
          const vz = (j - GRID / 2 + 0.5) * VOXEL;
          const t = Math.hypot(vx - s.x, vz - s.z) / SIGMA;
          if (t > BERM_R + BERM_W * 2.5) continue;
          const trough = -DEPTH * Math.exp(-t * t);
          const br = (t - BERM_R) / BERM_W;
          const berm = MAX_BERM * Math.exp(-br * br);
          if (field[k] === 0) touched.push(k);
          field[k] += (trough + berm) * amp;
          if (field[k] < -MAX_DEPTH) field[k] = -MAX_DEPTH;
          else if (field[k] > MAX_BERM) field[k] = MAX_BERM;
          anyField = true;
        }
      }
    }
  }

  function write(): void {
    const mesh = getTerrainMesh();
    for (const k of touched) {
      const col = cols[sandAt[k]];
      if (!col) continue;
      const d = Math.max(-MAX_DEPTH, Math.min(MAX_BERM, Math.round(field[k] / QUANT) * QUANT));
      writeColumn(col, d);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  function update(dt: number, pos: THREE.Vector3): void {
    for (const s of stamps) s.age += dt;
    while (stamps.length > 0 && stamps[0].age > LIFE) stamps.shift();

    const last = stamps[stamps.length - 1];
    const moved = !last || Math.hypot(pos.x - last.x, pos.z - last.z) > SPACING;
    if (moved && isSand(pos.x, pos.z)) {
      stamps.push({ x: pos.x, z: pos.z, age: 0 });
      if (stamps.length > 900) stamps.shift();
      dirty = true;
    }

    acc += dt;
    if (acc < 1 / REBUILD_HZ) return;
    acc = 0;

    if (stamps.length === 0) {
      if (dirty || anyField) clear();
      dirty = false;
      return;
    }

    clear();
    accumulate();
    write();
    dirty = false;
  }

  return { update };
}