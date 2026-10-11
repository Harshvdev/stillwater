import * as THREE from 'three';
import { VOXEL, SEA_Y, levelAtWorld } from './island';
import { getMoveInput } from './input';
import { PALETTE } from './palette';

const SPEED = 6;
// a voxel of water is wadeable, two is not - the same "stop at the waterline"
// rule the original had, restated on the voxel grid
const STOP_DEPTH = VOXEL + 0.5;
const MAX_STEP = VOXEL;
const FOOT_R = 0.6;

// forward/right directions in world space for the isometric camera
const FORWARD = new THREE.Vector3(-1, 0, -1).normalize();
const RIGHT = new THREE.Vector3(1, 0, -1).normalize();

const TURN = Math.PI / 2;
const BASE_FACING = Math.PI / 4; // the four readable iso facings

// the highest surface under the player's footprint, in whole voxels
function surfaceLevel(x: number, z: number): number {
  let lv = levelAtWorld(x, z);
  lv = Math.max(lv, levelAtWorld(x + FOOT_R, z));
  lv = Math.max(lv, levelAtWorld(x - FOOT_R, z));
  lv = Math.max(lv, levelAtWorld(x, z + FOOT_R));
  lv = Math.max(lv, levelAtWorld(x, z - FOOT_R));
  return lv;
}

function part(w: number, h: number, d: number, color: number, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshLambertMaterial({ color, flatShading: true })
  );
  m.position.set(x, y, z);
  return m;
}

// limb pivoting at the top (hip / shoulder) so rotation.x swings it
function limb(w: number, h: number, d: number, color: number, x: number, y: number): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, 0);
  g.add(part(w, h, d, color, 0, -h / 2, 0));
  return g;
}

// Four-frame walk cycle held on 8 fps frames: apart, together, apart, together.
const SWING = [0.62, 0, -0.62, 0];
const BOB = [0.07, 0, 0.07, 0];

let walkTime = 0;
let walkFrame = 0;

export function createPlayer(): THREE.Group {
  const g = new THREE.Group();
  const skin = PALETTE.skin[0];
  const shirt = PALETTE.shirt[0];
  const pants = PALETTE.pants[0];

  const legL = limb(0.22, 0.55, 0.26, pants, -0.14, 0.55);
  const legR = limb(0.22, 0.55, 0.26, pants, 0.14, 0.55);
  const armL = limb(0.18, 0.5, 0.22, shirt, -0.4, 1.1);
  const armR = limb(0.18, 0.5, 0.22, shirt, 0.4, 1.1);

  const body = part(0.62, 0.6, 0.4, shirt, 0, 0.85, 0);
  const head = part(0.55, 0.5, 0.5, skin, 0, 1.4, 0);
  // red cap over a white brim, plus a dark hair band at the back
  const capTop = part(0.62, 0.18, 0.62, PALETTE.cap[0], 0, 1.72, 0);
  const capBrim = part(0.62, 0.08, 0.18, PALETTE.cap[1], 0, 1.62, 0.3);
  const hairBack = part(0.58, 0.3, 0.12, PALETTE.hair[0], 0, 1.46, -0.22);
  const eyeL = part(0.08, 0.1, 0.04, PALETTE.eye, -0.12, 1.42, 0.26);
  const eyeR = part(0.08, 0.1, 0.04, PALETTE.eye, 0.12, 1.42, 0.26);

  g.add(legL, legR, armL, armR, body, head, capTop, capBrim, hairBack, eyeL, eyeR);

  const shadow = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.04, 0.9),
    new THREE.MeshBasicMaterial({ color: PALETTE.shadow, transparent: true, opacity: 0.5 })
  );
  g.add(shadow);

  g.userData = { legL, legR, armL, armR, shadow };
  return g;
}

const move = new THREE.Vector3();

export function updatePlayer(player: THREE.Group, dt: number): void {
  const input = getMoveInput();
  const moving = input.x !== 0 || input.y !== 0;
  const ud = player.userData as {
    legL: THREE.Group; legR: THREE.Group; armL: THREE.Group; armR: THREE.Group;
    shadow: THREE.Mesh;
  };

  if (moving) {
    move.set(0, 0, 0);
    move.addScaledVector(RIGHT, input.x);
    move.addScaledVector(FORWARD, input.y);
    move.normalize().multiplyScalar(SPEED * dt);

    const nx = player.position.x + move.x;
    const nz = player.position.z + move.z;
    const fromY = player.position.y;

    const canOccupy = (x: number, z: number, y: number): boolean => {
      const targetY = surfaceLevel(x, z) * VOXEL;
      if (SEA_Y - targetY > STOP_DEPTH) return false; // too deep to wade
      return targetY - y <= MAX_STEP; // too tall a step to climb
    };

    if (canOccupy(nx, nz, fromY)) {
      player.position.x = nx;
      player.position.z = nz;
    } else {
      // slide along each axis independently so walls guide instead of stop
      if (canOccupy(player.position.x + move.x, player.position.z, fromY)) {
        player.position.x += move.x;
      }
      if (canOccupy(player.position.x, player.position.z + move.z, fromY)) {
        player.position.z += move.z;
      }
    }

    // snap the facing to one of four iso directions instead of free rotation
    const raw = Math.atan2(move.x, move.z);
    const snapped = BASE_FACING + Math.round((raw - BASE_FACING) / TURN) * TURN;
    player.rotation.y = snapped;

    walkTime += dt;
    walkFrame = Math.floor(walkTime * 8) % 4;
  } else {
    // settle back to a neutral stance
    const ease = Math.max(0, 1 - dt * 14);
    ud.legL.rotation.x *= ease;
    ud.legR.rotation.x *= ease;
    ud.armL.rotation.x *= ease;
    ud.armR.rotation.x *= ease;
    walkFrame = 0;
  }

  const swing = moving ? SWING[walkFrame] : 0;
  const bob = moving ? BOB[walkFrame] : 0;
  ud.legL.rotation.x = swing;
  ud.legR.rotation.x = -swing;
  ud.armL.rotation.x = -swing * 0.8;
  ud.armR.rotation.x = swing * 0.8;

  // stand exactly on the voxel surface; feet never land between cubes
  const groundY = surfaceLevel(player.position.x, player.position.z) * VOXEL;
  player.position.y += (groundY - player.position.y) * Math.min(1, dt * 18);
  if (Math.abs(groundY - player.position.y) < 0.02) player.position.y = groundY;

  // the shadow stays on the ground while the body bobs
  ud.shadow.position.y = groundY + 0.02 - player.position.y;
  ud.shadow.rotation.y = -player.rotation.y;
}