import * as THREE from 'three';
import { treeLocations } from './trees';
import { VOXEL, SEA_Y, levelAtWorld } from './island';
import { PALETTE } from './palette';
import { getWindAt } from './wind';

/**
 * Falling tree leaves.
 *
 * Drops strictly from the underside of tree canopies, falling down directly
 * within the tree's canopy footprint onto the ground below. Leaves never spawn
 * above the tree or drift outside the canopy bounds.
 */

const MAX_LEAVES = 90;
const LEAF_W = 0.22;
const LEAF_H = 0.04;

// The tree canopy is 5x5 voxels, so half-width is 2.5 voxels from the trunk center.
// Clamping to 2.3 ensures leaves stay strictly within the vertical cylinder below the leaves.
const MAX_CANOPY_RADIUS = 2.3;

interface LeafParticle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rotX: number;
  rotY: number;
  rotZ: number;
  rotVx: number;
  rotVy: number;
  rotVz: number;
  phase: number;
  scale: number;
  treeIdx: number;
  state: 'falling' | 'resting' | 'floating';
  timer: number;
}

const particles: LeafParticle[] = [];
let leafMesh: THREE.InstancedMesh | null = null;

const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _scale = new THREE.Vector3();
const _mat = new THREE.Matrix4();
const _col = new THREE.Color();

// Color options from palette: light leaf, medium leaf, dark leaf, plus warm golden meadow green
const LEAF_COLORS = [
  PALETTE.leaf[0],
  PALETTE.leaf[1],
  PALETTE.leaf[2],
  0x7cc450, // touch of golden sunlit green
];

function respawnLeaf(p: LeafParticle, initialProgress = false): void {
  if (treeLocations.length === 0) return;

  p.treeIdx = Math.floor(Math.random() * treeLocations.length);
  const tree = treeLocations[p.treeIdx];

  // Spawn strictly within the 5x5 canopy area around the trunk
  const rx = (Math.random() - 0.5) * (MAX_CANOPY_RADIUS * 1.9);
  const rz = (Math.random() - 0.5) * (MAX_CANOPY_RADIUS * 1.9);
  p.x = tree.x + rx;
  p.z = tree.z + rz;

  // Detach strictly from the underside of the canopy (canopyY), NEVER from above the tree!
  const spawnY = tree.canopyY - 0.05 - Math.random() * 0.15;
  const groundY = levelAtWorld(p.x, p.z) * VOXEL;
  const surfaceY = Math.max(groundY, SEA_Y);

  if (initialProgress) {
    // On load, distribute particles mid-fall strictly between canopy underside and ground
    const fallSpan = Math.max(0.1, spawnY - surfaceY);
    p.y = spawnY - Math.random() * fallSpan;
  } else {
    p.y = spawnY;
  }

  p.vx = (Math.random() - 0.5) * 0.1;
  p.vy = -(0.75 + Math.random() * 0.45); // downward fall speed
  p.vz = (Math.random() - 0.5) * 0.1;

  p.rotX = Math.random() * Math.PI * 2;
  p.rotY = Math.random() * Math.PI * 2;
  p.rotZ = Math.random() * Math.PI * 2;

  // Tumbling angular velocities
  p.rotVx = (Math.random() - 0.5) * 2.8;
  p.rotVy = (Math.random() - 0.5) * 1.5;
  p.rotVz = (Math.random() - 0.5) * 2.8;

  p.phase = Math.random() * Math.PI * 2;
  p.scale = 0.85 + Math.random() * 0.3;
  p.state = 'falling';
  p.timer = 0;
}

export function createFallingLeaves(): THREE.InstancedMesh {
  const geo = new THREE.BoxGeometry(LEAF_W, LEAF_H, LEAF_W);
  const mat = new THREE.MeshStandardMaterial({
    roughness: 0.9,
    metalness: 0,
  });

  const mesh = new THREE.InstancedMesh(geo, mat, MAX_LEAVES);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_LEAVES * 3), 3);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;

  particles.length = 0;
  for (let i = 0; i < MAX_LEAVES; i++) {
    const p: LeafParticle = {
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      rotX: 0,
      rotY: 0,
      rotZ: 0,
      rotVx: 0,
      rotVy: 0,
      rotVz: 0,
      phase: 0,
      scale: 1,
      treeIdx: 0,
      state: 'falling',
      timer: 0,
    };
    respawnLeaf(p, true);
    particles.push(p);

    const hex = LEAF_COLORS[Math.floor(Math.random() * LEAF_COLORS.length)];
    _col.setHex(hex, THREE.SRGBColorSpace);
    mesh.setColorAt(i, _col);

    _pos.set(p.x, p.y, p.z);
    _euler.set(p.rotX, p.rotY, p.rotZ);
    _quat.setFromEuler(_euler);
    _scale.set(p.scale, p.scale, p.scale);
    _mat.compose(_pos, _quat, _scale);
    mesh.setMatrixAt(i, _mat);
  }

  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  leafMesh = mesh;
  return mesh;
}

export function updateFallingLeaves(dt: number, elapsedTime: number): void {
  if (!leafMesh || particles.length === 0 || treeLocations.length === 0) return;

  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    const tree = treeLocations[p.treeIdx] ?? treeLocations[0];

    if (p.state === 'falling') {
      const wind = getWindAt(p.x, p.z, p.y, elapsedTime);

      // Gentle local flutter that keeps the leaf moving organically
      const flutter = Math.sin(elapsedTime * 3.5 + p.phase) * 0.28;
      const flutterCross = Math.cos(elapsedTime * 3.0 + p.phase) * 0.28;

      // Localized drift within canopy column rather than blowing far across island
      p.x += (p.vx + wind.vx * 0.18 + flutterCross) * dt;
      p.z += (p.vz + wind.vz * 0.18 + flutter) * dt;
      p.y += p.vy * dt;

      // Strictly clamp leaf position to within the tree canopy footprint
      const dx = p.x - tree.x;
      const dz = p.z - tree.z;
      const distSq = dx * dx + dz * dz;
      if (distSq > MAX_CANOPY_RADIUS * MAX_CANOPY_RADIUS) {
        const dist = Math.sqrt(distSq);
        p.x = tree.x + (dx / dist) * MAX_CANOPY_RADIUS;
        p.z = tree.z + (dz / dist) * MAX_CANOPY_RADIUS;
      }

      p.rotX += p.rotVx * dt;
      p.rotY += p.rotVy * dt;
      p.rotZ += p.rotVz * dt;

      // Ground or water landing check
      const groundY = levelAtWorld(p.x, p.z) * VOXEL;
      const isWater = groundY < SEA_Y;
      const surfaceY = isWater ? SEA_Y : groundY;

      if (p.y <= surfaceY + LEAF_H / 2) {
        p.y = surfaceY + LEAF_H / 2;
        p.rotX = (Math.random() - 0.5) * 0.12;
        p.rotZ = (Math.random() - 0.5) * 0.12;
        p.state = isWater ? 'floating' : 'resting';
        p.timer = 1.8 + Math.random() * 2.2; // rest for 1.8 - 4 seconds
      }
    } else if (p.state === 'floating') {
      p.x += Math.sin(elapsedTime * 0.8 + p.phase) * 0.08 * dt;
      p.z += Math.cos(elapsedTime * 0.8 + p.phase) * 0.08 * dt;
      p.y = SEA_Y + LEAF_H / 2 + Math.sin(elapsedTime * 2.0 + p.phase) * 0.01;
      p.timer -= dt;
      if (p.timer <= 0) {
        respawnLeaf(p);
      }
    } else if (p.state === 'resting') {
      p.timer -= dt;
      if (p.timer <= 0) {
        respawnLeaf(p);
      }
    }

    // Shrink during final 0.4s of rest/floating to fade out cleanly before respawning
    let s = p.scale;
    if (p.state !== 'falling' && p.timer < 0.4) {
      s *= Math.max(0, p.timer / 0.4);
    }

    _pos.set(p.x, p.y, p.z);
    _euler.set(p.rotX, p.rotY, p.rotZ);
    _quat.setFromEuler(_euler);
    _scale.set(s, s, s);
    _mat.compose(_pos, _quat, _scale);
    leafMesh.setMatrixAt(i, _mat);
  }

  leafMesh.instanceMatrix.needsUpdate = true;
}
