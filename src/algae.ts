import * as THREE from 'three';
import { VOXEL, GRID, cellX, cellZ, levelAtWorld, waterDepthAt } from './island';
import { PALETTE } from './palette';
import { algaeMask, type AlgaeKind } from './textures';

/**
 * Algae, on the seabed under the water.
 *
 * Three shapes, and the same kind of object as the tall grass: a card with a
 * cut-out silhouette, crossed with two others, standing on the floor. What
 * differs is where it stands, how tall it is allowed to be, and what moves it.
 *
 * WHERE
 *
 * The shelf. The seabed is voxel terrain like everything else and it steps
 * down one block at a time from the waterline, so there is a ring of it around
 * the island where the water above is one, two or three blocks deep. That
 * ring is the only part of the seabed anybody can see: past three blocks the
 * water is opaque (see depthAlpha in water.ts) and everything under it is
 * hidden. So this is where the algae grow, and no deeper - planting in the
 * deep would be planting in the dark.
 *
 * The depth also decides how tall a plant may be, because the water surface
 * is flat: a frond on a one-block shelf has one block of water to live in and
 * is one block tall, and the same frond on the two-block shelf opens out to
 * nearly twice that. The height is also taken against the NEIGHBOURING cells,
 * so a plant at the edge of a shelf does not leave a tip hanging in the air
 * over the shallower water beside it.
 *
 * HOW IT MOVES
 *
 * With the current, not with the wind. The wind is air: it is a different
 * vector at a different speed, and a kelp frond bending to the same gust as
 * the tree above it reads as a plant that has been dragged out of the sea.
 * The current is slower, smoother, and its own direction.
 *
 * WHAT IT LOOKS LIKE
 *
 * Three genuinely different organisms, not one shape at three sizes. A blade
 * of grass differs from its neighbours only in height, which is right for a
 * meadow - a meadow is one thing repeated - and wrong for a seabed, where a
 * kelp, a sea fan and a low clump are three different things entirely. The
 * silhouettes are in textures.ts, hand drawn for the same reason the grass
 * ones are: procedural speckle at this size is noise.
 *
 * It casts shadows, like the grass does. A frond on a sand floor throws a
 * shape on the sand, and on a floor that is mostly flat and mostly lit that
 * shape is most of what gives the seabed any depth at all.
 *
 * It does not collide. Player collision reads the terrain level and the
 * trunk cells, neither of which knows anything about this, and the player
 * cannot walk out past the first block of water anyway.
 */

// Same hash as the terrain, the trees and the flowers, so a plant's cell and
// its per-card shading agree with everything else on the grid.
const hs = (i: number, j: number, s = 0): number => {
  const x = Math.sin(i * 127.1 + j * 311.7 + s * 74.7) * 43758.5453;
  return x - Math.floor(x);
};

// smooth value noise, for the drift masks
const vn = (x: number, y: number, s = 0): number => {
  const i = Math.floor(x), j = Math.floor(y);
  let fx = x - i, fy = y - j;
  fx *= fx * (3 - 2 * fx);
  fy *= fy * (3 - 2 * fy);
  const a = hs(i, j, s), b = hs(i + 1, j, s), c = hs(i, j + 1, s), d = hs(i + 1, j + 1, s);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
};

// ---------------------------------------------------------------- the current
//
// Shared by every algae material, so the whole bed moves as one body of
// water rather than as a field of independently wobbling plants.
export const currentUniforms = {
  uCurrentTime: { value: 0 },
  // The current runs roughly east along the shelf. Not the wind's heading
  // (north-east) - the wind is air, and a current that blew the same way
  // would be a different name for the same vector.
  uCurrentDir: { value: new THREE.Vector2(1, 0.28).normalize() },
  uCurrentStrength: { value: 1 },
};

/**
 * The surge cycle, in seconds.
 *
 * A current is not one speed. Water comes in swells - a stronger push, then
 * a slack, then another - and weed in a bed moves with the swell rather than
 * at a constant rate. This is the period of that, slow enough that a player
 * watching for a minute sees the bed breathe once or twice and never catches
 * it at a constant amplitude.
 */
const SURGE_PERIOD = 27;

/** Advance the current clock. Called once a frame from the main loop. */
export function updateAlgae(t: number): void {
  currentUniforms.uCurrentTime.value = t;
  // The surge, eased over the whole cycle rather than switched, so the bed
  // never snaps from one strength to another. It never stops completely
  // either: there is always some water moving over a shelf.
  const surge = 0.62 + 0.38 * Math.sin((t / SURGE_PERIOD) * Math.PI * 2);
  currentUniforms.uCurrentStrength.value = surge;
}

// ------------------------------------------------------------------- kinds
//
// One spec per silhouette: how wide its card is, how tall it wants to be
// before the water above it says otherwise, how far it leans out, and how
// deep the water has to be before it will grow there at all.
//
// The kelp is the only one with a depth requirement, and it is the only one
// that is not a shore plant. It is also the only one whose card is much
// taller than it is wide, which stretches its mask into a long ribbon - the
// one shape in this scene that is drawn narrow and drawn tall.
interface AlgaeSpec {
  cards: number;
  cardW: number;
  cardH: number;
  splay: number;
  minDepth: number;
}

const KINDS: readonly (readonly [AlgaeKind, AlgaeSpec])[] = [
  ['kelp', { cards: 3, cardW: 0.55, cardH: 2.00, splay: 0.12, minDepth: 2 }],
  ['fan', { cards: 3, cardW: 0.85, cardH: 1.05, splay: 0.26, minDepth: 1 }],
  ['tuft', { cards: 3, cardW: 0.70, cardH: 0.70, splay: 0.20, minDepth: 1 }],
];

// The deepest water a plant is planted in.
//
// Three blocks is where the water is still see-through (0.65 at three, and
// the plant under it shows at 35% - dim, but there). Past that the water is
// opaque and the planting would be invisible.
const MAX_DEPTH = 3;

// How densely the shelf is planted.
//
// Low, and clustered rather than evenly sprinkled: algae comes in beds, and
// a uniform sprinkle over a ring of seabed reads as a carpet of identical
// tufts. The drift mask lets whole patches of the shelf grow and whole
// patches stay bare sand.
//
// The peak is high because a bed only reads as a bed when the plants in it
// touch. Scattered singly, a plant on a wide seabed is a speck, and a speck
// of a shape nobody can make out is not worth the instance.
const BASE_DENSITY = 0.08;
const DRIFT_DENSITY = 0.44;

// Upper bound on plants, sized against the worst case the gates can produce.
// The shelf ring is a few thousand cells, so this is a bound and not a
// density control.
const MAX_ALGAE = 2400;

// The albedo of the plants is a single ramp, so a plant is one flat colour
// and the shape has to do the rest. The mask carries the light and shade.
function algaeCardMaterial(mask: THREE.Texture): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: mask,
    // The mask is an alpha shape, and alphaTest is what consumes it - the
    // same rule as the grass cards, and for the same reason: alpha blending
    // would put the mesh in three's transparent queue, where whole objects
    // are sorted by distance instead of by fragment, and a bed of blended
    // cards would sort against the water it is standing under.
    alphaTest: 0.5,
    // A card has no meaningful front, and the current bends it back and
    // forth. Without this the back of each cross is invisible and the plant
    // vanishes as the camera pans.
    side: THREE.DoubleSide,
    roughness: 1,
    metalness: 0,
  });
  mat.customProgramCacheKey = () => `algaeCard:${mask.id}`;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uCurrentTime = currentUniforms.uCurrentTime;
    shader.uniforms.uCurrentDir = currentUniforms.uCurrentDir;
    shader.uniforms.uCurrentStrength = currentUniforms.uCurrentStrength;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uCurrentTime;
uniform vec2 uCurrentDir;
uniform float uCurrentStrength;`
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
// How much of this card is above its root: 0 at the seabed, 1 at the tip.
float h = clamp(position.y, 0.0, 1.0);
float bend = h * h;
// The bend is quadratic, so the root stays planted on the floor and the tip
// does all the moving. A plant that slides along the seabed looks like it is
// being dragged.
//
// How long this plant is, in world units. The sway scales with it, because a
// long frond in a current sweeps much further than a short one - the tip of a
// two-block kelp travels several times as far as the tip of a tuft, and that
// difference in reach is most of what tells the three kinds apart in motion.
#ifdef USE_INSTANCING
float cardH = length(instanceMatrix[1].xyz);
#else
float cardH = 1.0;
#endif
vec3 wPos = (modelMatrix * mvPosition).xyz;

// The phase is taken from the plant's own world position, so a bed of them
// does not move as one block - the fronds nearest each other are out of step
// with each other, which is what a bed of weeds in a current looks like.
float phase = wPos.x * 0.55 + wPos.z * 0.4;

// THE LAG.
//
// The phase of the wave is shifted by how high up the plant the fragment is.
// The base of a frond feels the water first and the tip feels it last, so the
// tip is always trailing behind the base by a fraction of a cycle.
//
// This is the whole difference between a plant in water and a board being
// waved. Without it every point on the frond moves in step, the card swings
// as a rigid sheet, and the eye reads a flag in the wind rather than a frond
// in a current.
//
// It is a big lag - more than a third of a cycle from root to tip - because
// a kelp frond is a long flexible thing and the water takes a moment to carry
// the push all the way up it. That is the whip: the top of the frond is
// always somewhere behind where the bottom of it was a moment ago.
float lag = h * 2.2;

// Two motions, not one.
//
// The SURGE is the slow one: the long swell that a bed of weed moves with,
// several seconds apart, and which the whole shelf shares the timing of. The
// FLUTTER is the fast one, local to each plant and out of step with its
// neighbours.
//
// Both are slow. Nothing in water moves at the speed of a gust - a flutter
// in a current is a couple of seconds from peak to peak, not a fifth of one.
float surge = sin(uCurrentTime * 0.52 - phase * 0.14 + lag * 0.30);
float flutter = sin(uCurrentTime * 1.15 - phase + lag * 1.45);
float wave = surge * 0.62 + flutter * 0.38;

// THE LEAN.
//
// A flow is a steady push, not a symmetric oscillation, so a plant in a
// current does not swing evenly about upright - it rests bent downstream and
// oscillates around that. Without the lean the weed sways like a metronome
// and looks like it is standing in wind.
float lean = 0.34 + 0.22 * surge;

// The direction each plant leans is not quite the same as the current's.
// Water does not flow evenly around a rocky bottom; it finds its way, and
// each frond ends up pointing a little differently. Twenty degrees either
// way is enough to break the bed up without looking random.
vec2 cross2 = vec2(-uCurrentDir.y, uCurrentDir.x);
float drift = sin(wPos.x * 2.7 + wPos.z * 3.3) * 0.36;
vec2 dir = normalize(uCurrentDir + cross2 * drift);

// How far the tip travels, as a fraction of the plant's own length.
//
// It scales with the plant because the reach of a frond in a current is a
// property of its length: a two-block kelp sweeps through a wide arc and a
// tuft barely stirs, and that difference is most of what tells the three
// kinds apart in motion.
//
// At 0.28 a two-block kelp's tip travels about 0.75 of a unit - roughly a
// quarter of the plant's own length, which is what weed in a moving current
// actually does. It was a fifth of that, which is not enough to read as
// anything but a twitch.
float sway = (wave * 0.5 + lean) * uCurrentStrength * bend * cardH * 0.28;
mvPosition.x += dir.x * sway;
mvPosition.z += dir.y * sway;
// The surge lifts the bed as it passes, the way a swell lifts weed on a
// shallow floor. Small, but it is the difference between weed that is being
// pushed sideways and weed that is being moved BY something.
mvPosition.y += surge * uCurrentStrength * bend * cardH * 0.04;
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`
      );
  };
  return mat;
}

interface Built {
  mesh: THREE.InstancedMesh;
  spec: AlgaeSpec;
  kind: AlgaeKind;
  n: number;
}

export function createAlgae(): THREE.Group {
  const group = new THREE.Group();

  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  const quat = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const scale = new THREE.Vector3();
  const pos = new THREE.Vector3();

  // One mesh per kind. Each carries its own alpha mask.
  const built: Built[] = KINDS.map(([kind, spec]) => {
    const geo = new THREE.PlaneGeometry(spec.cardW, 1).translate(0, 0.5, 0);
    const mesh = new THREE.InstancedMesh(
      geo,
      algaeCardMaterial(algaeMask(kind)),
      MAX_ALGAE * spec.cards
    );
    mesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(MAX_ALGAE * spec.cards * 3), 3
    );
    mesh.frustumCulled = false;
    group.add(mesh);
    return { mesh, spec, kind, n: 0 };
  });

  // The deepest water standing over a cell and the four cells around it.
  //
  // The surface is flat, so a plant's own cell is what limits its height -
  // but the cards are wider than they are tall in two of the three kinds, so
  // a tip can hang over a neighbour that is shallower than the plant's own
  // cell. Taking the minimum keeps every frond under water.
  const clearanceAt = (x: number, z: number): number =>
    Math.min(
      waterDepthAt(x, z),
      waterDepthAt(x + VOXEL, z),
      waterDepthAt(x - VOXEL, z),
      waterDepthAt(x, z + VOXEL),
      waterDepthAt(x, z - VOXEL)
    );

  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const x = cellX(i);
      const z = cellZ(j);
      const depth = waterDepthAt(x, z);
      if (depth < 1 || depth > MAX_DEPTH) continue;

      // Beds, not a sprinkle: a low-frequency mask that admits whole patches
      // of the shelf and leaves whole patches as bare sand.
      const drift = vn(x * 0.07, z * 0.07, 311);
      const chance = BASE_DENSITY + drift * DRIFT_DENSITY;
      if (hs(i, j, 313) > chance) continue;

      // Which kind, and whether it will even grow here.
      //
      // The kelp needs two blocks of water over it, so on the one-block shelf
      // the roll is taken against a different pair of thresholds and the kelp
      // never comes up. That keeps the bed the same kind of bed at every
      // depth instead of thinning one kind out where it cannot live.
      const roll = hs(i, j, 317);
      let kind: AlgaeKind;
      if (depth >= 2) {
        kind = roll < 0.34 ? 'kelp' : roll < 0.72 ? 'fan' : 'tuft';
      } else {
        kind = roll < 0.62 ? 'fan' : 'tuft';
      }
      const slot = built.find((b) => b.kind === kind)!;
      if (depth < slot.spec.minDepth) continue;

      // The jitter, well under half a cell, so a plant always reads as
      // belonging to one block rather than straddling two.
      const jx = (hs(i, j, 41) - 0.5) * 0.6 * VOXEL;
      const jz = (hs(i, j, 43) - 0.5) * 0.6 * VOXEL;
      const px = x + jx;
      const pz = z + jz;

      // The floor this plant stands on. The jitter may have carried it onto a
      // neighbouring cell, so the level is read where it actually is.
      const level = levelAtWorld(px, pz);
      if (level >= 0) continue;
      const baseY = level * VOXEL;

      // How much room it has: the water over the plant's own cell and over
      // the cells around it. The 0.9 leaves a plant a finger's width of water
      // above its tip, so nothing breaks the surface.
      const room = clearanceAt(px, pz) * 0.9;
      const height = Math.min(slot.spec.cardH * (0.82 + hs(i, j, 149) * 0.36), room);
      if (height < 0.22) continue;

      // Three cards, yawed 45 degrees off the world axes and 60 degrees apart.
      //
      // The yaw is the same trick the grass uses and for the same reason:
      // this camera only ever looks from (+1,+1,+1), and a card whose normal
      // runs along a world axis sits 55 degrees off the view, where one at
      // 45 degrees sits 35. Three rather than two because two crossed cards
      // leave one of them exactly edge-on to the only viewpoint that exists.
      const baseYaw = Math.PI / 4 + hs(i, j, 163) * (Math.PI * 2);
      for (let k = 0; k < slot.spec.cards; k++) {
        if (slot.n >= MAX_ALGAE * slot.spec.cards) break;
        const cardH = height * (0.88 + hs(i + k, j - k, 151 + k) * 0.2);
        const yaw = baseYaw + (k * Math.PI) / slot.spec.cards;
        // Each card leans a different way, and the lean alternates, so the
        // plant opens out instead of being a bundle of parallel sheets.
        const splay = slot.spec.splay * (0.7 + hs(i + k * 3, j + k * 5, 167 + k) * 0.6);
        const lean = k % 2 === 0 ? splay : -splay;

        euler.set(lean, yaw, 0, 'YXZ');
        quat.setFromEuler(euler);
        scale.set(1, cardH, 1);
        pos.set(px, baseY, pz);
        m.compose(pos, quat, scale);
        slot.mesh.setMatrixAt(slot.n, m);

        // Three tones, one per card, so a single plant is not one flat
        // colour even where the mask's own two tones are in shadow.
        const tone = hs(i + k * 2, j + k * 7, 157 + k);
        const idx = tone < 0.34 ? 0 : tone < 0.74 ? 1 : 2;
        c.setHex(PALETTE.algae[idx], THREE.SRGBColorSpace);
        c.toArray(slot.mesh.instanceColor!.array, slot.n * 3);
        slot.n++;
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
