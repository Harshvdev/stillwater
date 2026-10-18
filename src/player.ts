import * as THREE from 'three';
import { VOXEL, SEA_Y, levelAtWorld } from './island';
import { getMoveInput, isJumpHeld } from './input';
import { treeBlocks } from './trees';
import { PALETTE } from './palette';

const SPEED = 6;
// a voxel of water is wadeable, two is not - the same "stop at the waterline"
// rule the original had, restated on the voxel grid. VOXEL is 1 now, so this is
// "one voxel deep is fine, two is not".
const STOP_DEPTH = VOXEL + 0.5;
const MAX_STEP = VOXEL;
const FOOT_R = 0.3; // was tuned against the old, twice-as-wide voxel

// forward/right directions in world space for the isometric camera
const FORWARD = new THREE.Vector3(-1, 0, -1).normalize();
const RIGHT = new THREE.Vector3(1, 0, -1).normalize();

// Eight facings, 45 degrees apart, so the diagonals (W+D and friends) get
// their own facing instead of borrowing the nearest cardinal one. The base
// offset is unchanged at 45 degrees, which keeps the original four cardinal
// facings exactly where they were and just slots the four in-between.
const TURN = Math.PI / 4;
const BASE_FACING = Math.PI / 4;

// ------------------------------------------------------------------- vertical
// Gravity and the jump impulse, in world units (a voxel is 1, so these are also
// blocks and blocks per second).
//
// GRAVITY is high on purpose. A real 9.8 would put the jump's rise and fall
// somewhere around half a second, which at a 1.3-block apex reads as a wobble
// rather than a hop, and would make the figure spend longer in the air than on
// the ground - the walk cycle would keep animating while the player was visibly
// suspended. 30 puts a full hop in about 0.55s.
//
// JUMP_SPEED is then whatever clears MAX_STEP comfortably with a little to
// spare: the apex is v^2/2g = 8.3^2/60 = 1.15 blocks, against a 1-block step.
// So a jump is not strictly required to clear an ordinary step - it is what it
// takes to get back up onto one you have walked off, and it is comfortably
// enough to reach a 2-block ledge (see the note on canOccupy below).
const GRAVITY = 30;
const JUMP_SPEED = 8.3;

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
  // Standard rather than Lambert so the figure sits in the same lighting rig as
  // the terrain. BoxGeometry already carries per-face normals, so flatShading
  // is redundant here; roughness 1 keeps skin and cloth from picking up a
  // specular dot that the matte terrain never has.
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0 })
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

  // No blob shadow any more. There used to be a flat semi-transparent box pinned
  // to the ground under the figure, which was the only way to read the player's
  // footing while the scene had no working shadows. Now that the sun casts real
  // ones (main.ts sets player.castShadow) that quad would double up: a hard dark
  // rectangle with a correctly-shaped shadow floating beside it, and the pair
  // would drift apart every time the body bobbed.

  g.userData = { legL, legR, armL, armR };
  return g;
}

const move = new THREE.Vector3();

// Vertical state, kept beside walkTime and walkFrame for the same reason: there
// is exactly one player and nothing else needs to read these.
//
// `grounded` is tracked rather than inferred from the current height, because
// "is standing on the floor right now" and "was on the floor at the start of
// this frame" are different questions and the jump needs the second one.
let vy = 0;
let grounded = true;

export function updatePlayer(player: THREE.Group, dt: number): void {
  const input = getMoveInput();
  const moving = input.x !== 0 || input.y !== 0;
  const ud = player.userData as {
    legL: THREE.Group; legR: THREE.Group; armL: THREE.Group; armR: THREE.Group;
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
      // a tree trunk is solid. Tested before the terrain so the player cannot
      // slide into a trunk on the way to a legal step. The canopy is well
      // above head height and does not block.
      if (treeBlocks(x, z, FOOT_R)) return false;
      const targetY = surfaceLevel(x, z) * VOXEL;
      if (SEA_Y - targetY > STOP_DEPTH) return false; // too deep to wade
      // Too tall a step to climb, measured against the CURRENT height rather
      // than the ground - so being part-way up a jump counts. This is what
      // makes a jump worth having: at the 1.15-block apex the gap to a 2-block
      // ledge is under MAX_STEP, so a jump carries the player up onto one,
      // and the same test is what stops them walking off a 3-block cliff face
      // into the air. Note the ordering in updatePlayer: the horizontal move
      // is resolved BEFORE gravity runs, using last frame's height, which is
      // one frame of lag on the climb and is well under a pixel of it.
      return targetY - y <= MAX_STEP;
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

  // ------------------------------------------------------------------ vertical
  // Real gravity, replacing the old "lerp toward the ground" that pulled the
  // feet down onto the surface every frame. That was fine while y could only
  // ever be the ground height, but it cannot express a jump: it would have
  // dragged the player straight back down the instant they left the floor. With
  // an actual velocity, walking off a ledge is a fall and a jump is an arc,
  // both for free.
  const groundY = surfaceLevel(player.position.x, player.position.z) * VOXEL;

  // Jump while the key is held, gated only on being back on the ground. Read
  // as a level rather than an edge, so holding Space bounces the player: the
  // hop goes up, the landing sets `grounded`, and the very next frame starts
  // the next one. There is no cooldown and no minimum gap between hops, which
  // is safe precisely because the gate is `grounded` - the fastest this can
  // repeat is one jump per landing, which is the 0.55s arc, and not the
  // keyboard's auto-repeat rate.
  if (isJumpHeld() && grounded) {
    vy = JUMP_SPEED;
    grounded = false;
  }

  vy -= GRAVITY * dt;
  player.position.y += vy * dt;

  if (player.position.y <= groundY) {
    // Landed. Snapped exactly onto the surface rather than left wherever the
    // integration happened to overshoot, so the feet never come to rest a
    // fraction inside a block - which would show up as the coordinate readout
    // sitting one lower than the block visibly underfoot.
    player.position.y = groundY;
    vy = 0;
    grounded = true;
  }
}