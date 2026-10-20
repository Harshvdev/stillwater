import * as THREE from 'three';
import { VOXEL, SEA_Y, levelAtWorld } from './island';
import { getMoveInput, isJumpHeld, isDiveHeld } from './input';
import { treeBlocks } from './trees';
import { PALETTE } from './palette';
import { applyCloudShadows } from './clouds';

const SPEED = 6;
const MAX_STEP = VOXEL;
const FOOT_R = 0.3; // was tuned against the old, twice-as-wide voxel

// ------------------------------------------------------------------- swimming
//
// The water is deep enough to swim in now, and the player swims in it.
//
// THE LINE BETWEEN WADING AND SWIMMING
//
// One block of water is a puddle. The player walks in it, stands in it, and
// their head is well clear of the surface - and Shift does nothing there,
// because there is nowhere to dive to. Below that, past SWIM_DEPTH, the water
// is deep enough that the player floats.
//
// SWIM_DEPTH is a little over one block so that the shelf - which is exactly
// one block deep all the way round the island - is unambiguously a place to
// wade, and the first step past it is unambiguously a place to swim. The
// terrain steps a whole block at a time, so the two cases never blur into
// each other.
//
// HOW A SWIMMER IS HELD
//
// By a spring, not by gravity. A swimmer does not fall to the bottom of the
// sea and stay there: they float, and the float is a line their body is
// pulled towards. Without the spring, walking off a cliff into deep water
// would drop the player to the seabed and leave them there, which is a fall
// into a pit and not a swim.
//
// The spring is what makes the entry read as a swim as well: the player hits
// the water, the drag kills most of their speed, and they bob up to the
// surface.
//
// THE FLOAT LINE
//
// The feet this far under the surface, so the waterline crosses the player at
// the chest. They are standing in the sea, not lying on it - the figure is
// built upright and this game has one camera and no swim pose, so the
// swimmer stands.
//
// DIVING
//
// Shift. The target becomes the seabed instead of the float line, so the
// same spring carries them down, and letting go brings them back up. The
// dive is a hold rather than a toggle because it is a continuous thing to do
// and because letting go should undo it immediately.
const SWIM_DEPTH = 1.2;
const FLOAT_DEPTH = 0.85;
const SWIM_SPRING = 26;
const SWIM_DRAG = 5.5;
// Swimming is slower than walking. It is the same player.
const SWIM_SPEED = 3.4;
// How fast a swimmer climbs out onto a bank that is above them.
const RISE_SPEED = 3.5;

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
    // Cloud shadows reach the figure too. This is the one place it really
    // matters: the player is the only thing in the frame that is definitely
    // "right now", so having a cloud shadow pass over them and the ground
    // under them at the same moment is what ties the two together.
    applyCloudShadows(new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0 }))
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

// Whether the player is off the floor at the moment.
//
// This is not the same question as `grounded`, which is about the jump: a
// player who walks off a ledge is `grounded` - nothing has set it false - and
// is falling, and they must still land.
//
// It exists because "the player is at the floor" and "the player has just
// ARRIVED at the floor" are different questions, and only the second one is
// worth a splash. Testing the position alone reports a landing on every
// frame of simply standing there.
let airborne = false;

// Whether the player is in water deep enough to swim in, as opposed to
// wading in it or standing on dry land. Module level because the splash
// reads it, and because it is a fact about the player rather than about one
// frame of them.
let swimming = false;

/**
 * What the player did this frame, for anything else in the scene that needs
 * to react to it.
 *
 * The splash is the only reader at the moment, and it needs to know the
 * difference between a player who stepped into the water and one who fell
 * into it - which is the speed at the moment of landing, and there is no way
 * to get that out of the position afterwards.
 *
 * Reset at the top of every update, so a reader that runs after
 * updatePlayer sees one frame's worth and nothing stale.
 */
export const playerEvents = {
  /** The player touched down this frame. */
  landed: false,
  /** How fast they were going down when they did, in world units a second. */
  landSpeed: 0,
  /**
   * Their vertical speed right now: negative going down, positive going up.
   *
   * The splash reads this to size the splash of someone arriving at the
   * water. A foot going into a puddle arrives at walking speed and barely
   * disturbs it; a body hitting the water arrives at whatever the fall was.
   *
   * It is written after the integration and before the landing resets the
   * velocity, so it is the speed of the impact rather than the speed of
   * having stopped.
   */
  vy: 0,
};

/**
 * Whether the player is swimming, as opposed to wading or walking.
 *
 * The splash reads this because the moment a wader becomes a swimmer is a
 * moment worth marking: the water closes over them and the surface breaks
 * around them.
 */
export function playerIsSwimming(): boolean {
  return swimming;
}

export function updatePlayer(player: THREE.Group, dt: number): void {
  const input = getMoveInput();
  const moving = input.x !== 0 || input.y !== 0;
  playerEvents.landed = false;
  playerEvents.landSpeed = 0;
  const ud = player.userData as {
    legL: THREE.Group; legR: THREE.Group; armL: THREE.Group; armR: THREE.Group;
  };

  // The floor under the player, and the water over it.
  //
  // Both are worked out before anything moves, because how fast the player
  // moves and how they are held up in the world both depend on which of the
  // two they are in - and the horizontal move has to know before it resolves.
  const groundY = surfaceLevel(player.position.x, player.position.z) * VOXEL;
  const waterDepth = SEA_Y - groundY;
  // Swimming needs two things: water deep enough to swim in, and the player
  // actually in it.
  //
  // The second half matters more than it looks. Buoyancy that acts on a
  // player who is still ABOVE the water catches them on the way down and
  // sets them down on the surface like a leaf - so someone who jumped into
  // deep water arrived at it slowly and barely splashed, which is the exact
  // opposite of what jumping into deep water should do.
  //
  // So the buoyancy only reaches the player once they are at or below the
  // surface. Above it they are falling, and they fall at full speed right up
  // to the moment they hit the water.
  swimming = waterDepth > SWIM_DEPTH && player.position.y <= SEA_Y;

  if (moving) {
    move.set(0, 0, 0);
    move.addScaledVector(RIGHT, input.x);
    move.addScaledVector(FORWARD, input.y);
    move.normalize().multiplyScalar((swimming ? SWIM_SPEED : SPEED) * dt);

    const nx = player.position.x + move.x;
    const nz = player.position.z + move.z;
    const fromY = player.position.y;

    const canOccupy = (x: number, z: number, y: number): boolean => {
      // a tree trunk is solid. Tested before the terrain so the player cannot
      // slide into a trunk on the way to a legal step. The canopy is well
      // above head height and does not block.
      if (treeBlocks(x, z, FOOT_R)) return false;
      const targetY = surfaceLevel(x, z) * VOXEL;
      // Too tall a step to climb, measured against the CURRENT height rather
      // than the ground - so being part-way up a jump counts. This is what
      // makes a jump worth having: at the 1.15-block apex the gap to a 2-block
      // ledge is under MAX_STEP, so a jump carries the player up onto one,
      // and the same test is what stops them walking off a 3-block cliff face
      // into the air. Note the ordering in updatePlayer: the horizontal move
      // is resolved BEFORE gravity runs, using last frame's height, which is
      // one frame of lag on the climb and is well under a pixel of it.
      //
      // There is no depth limit here any more. The player can walk into any
      // water, and whether they end up wading in it or swimming in it is
      // decided by how deep it is - see the swimming notes above. What the
      // old limit actually did was refuse entry, which is what a swimmer does
      // not need: the way into deep water is to walk in and float.
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

  // A swimmer does not walk.
  //
  // The walk cycle is a stride, and a stride in the sea reads as the player
  // running along the bottom. What a swimmer standing in the water does is
  // scissor their legs, slowly and without travelling, so the swim has its
  // own motion: a quarter of the amplitude and a third of the rate.
  if (swimming) {
    const scissor = moving ? Math.sin(walkTime * 2.1) * 0.22 : 0;
    ud.legL.rotation.x = scissor;
    ud.legR.rotation.x = -scissor;
    ud.armL.rotation.x = -scissor * 0.7;
    ud.armR.rotation.x = scissor * 0.7;
  }

  // ------------------------------------------------------------------ vertical
  // Real gravity, replacing the old "lerp toward the ground" that pulled the
  // feet down onto the surface every frame. That was fine while y could only
  // ever be the ground height, but it cannot express a jump: it would have
  // dragged the player straight back down the instant they left the floor. With
  // an actual velocity, walking off a ledge is a fall and a jump is an arc,
  // both for free.
  //
  // In water deep enough to swim in, gravity is replaced by a spring toward a
  // target line. A swimmer floats; they do not fall to the bottom of the sea
  // and stay there. The spring is what makes the entry read as a swim too:
  // the drag kills most of the speed of a player who hits the water, and the
  // spring then brings them up to the surface.
  if (swimming) {
    // The target is the float line, or the seabed if they are diving. A diver
    // is pulled down by the same spring that pulls a swimmer up, which is
    // why letting go of Shift brings them back up on its own.
    const diving = isDiveHeld();
    const targetY = diving ? groundY : SEA_Y - FLOAT_DEPTH;

    // Space still jumps. A swimmer at the surface hops out of the water the
    // same way a walker hops off the ground, and the spring brings them back
    // down to the float line afterwards.
    //
    // Only at the surface, and only when they are not already going up, so
    // that holding the key does not fire a jump on every frame of the hop -
    // the same rule the land jump follows, for the same reason.
    //
    // The impulse is three quarters of a land jump because there is no
    // gravity out here to cap the arc. The spring is the only thing pulling
    // them back down and it is a gentle one, so a full jump impulse would
    // throw them two and a half blocks out of the water - which for a hop
    // out of a puddle is a catapult.
    const atSurface =
      !diving &&
      player.position.y > SEA_Y - FLOAT_DEPTH - 0.25 &&
      vy < 1.0;
    if (isJumpHeld() && atSurface) {
      vy = JUMP_SPEED * 0.75;
    }

    vy += (targetY - player.position.y) * SWIM_SPRING * dt;
    // The drag. Water is thick, and this is what makes it feel like water: a
    // player who hits the sea at speed loses most of it in a moment rather
    // than sinking to the bottom.
    vy *= Math.exp(-SWIM_DRAG * dt);
    player.position.y += vy * dt;
    playerEvents.vy = vy;

    if (player.position.y <= groundY) {
      // Down to the floor. They are standing on it, and that is the end of
      // the dive.
      if (airborne) {
        playerEvents.landed = true;
        playerEvents.landSpeed = -vy;
      }
      airborne = false;
      player.position.y = groundY;
      vy = 0;
      grounded = true;
    } else {
      airborne = true;
      grounded = false;
    }
  } else {
    // Whether the player is already BELOW the floor, measured BEFORE the
    // integration runs.
    //
    // This has to be measured first, and it is the whole reason the rise case
    // exists at all. The integration puts a standing player a fraction of a
    // unit below the floor on every frame - gravity pulls them down and the
    // landing snaps them back - so reading "below the floor" after the
    // integration would say yes to a player who is standing on it. The
    // player would climb instead of stand, and because that branch does not
    // set `grounded`, they would never be able to jump again.
    //
    // The threshold is a twentieth of a block: comfortably more than the
    // integration's dip, and comfortably less than the half-block a swimmer
    // has to climb to get out of the water.
    const belowFloor = player.position.y < groundY - 0.05;

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
    playerEvents.vy = vy;

    if (belowFloor) {
      // BELOW the floor, which happens for one thing only: a swimmer whose
      // water ran out from under them while they were floating, so the
      // bank is now above their head and they have to come up out of it.
      //
      // Eased, not snapped. The snap is the obvious thing to do and it is
      // wrong: the player is most of a block below the surface when this
      // starts, so snapping puts them a block into the air in one frame.
      player.position.y = Math.min(groundY, player.position.y + RISE_SPEED * dt);
      vy = 0;
      airborne = false;
      grounded = false;
    } else if (player.position.y <= groundY) {
      // Landed. Snapped exactly onto the surface rather than left wherever the
      // integration happened to overshoot, so the feet never come to rest a
      // fraction inside a block - which would show up as the coordinate readout
      // sitting one lower than the block visibly underfoot.
      //
      // The speed at the moment of landing is reported, because how hard
      // something lands is not something its position can tell you afterwards.
      //
      // Only when they have just ARRIVED, though: a player standing on the
      // floor is at the floor on every frame, and reporting that as a landing
      // every frame would splash them continuously.
      if (airborne) {
        playerEvents.landed = true;
        playerEvents.landSpeed = -vy;
      }
      airborne = false;
      player.position.y = groundY;
      vy = 0;
      grounded = true;
    } else {
      airborne = true;
    }
  }
}