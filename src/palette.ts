import * as THREE from 'three';

// One limited palette for the whole game, GBA-style: nothing outside this set
// is used for the terrain, the water or the player, so the scene reads as a
// single piece of pixel art. Every ramp is ordered light -> dark.
export const PALETTE = {
  // sky / background (matches the 3d original)
  sky: 0x2f8fd0,
  fog: 0x8fd0e8,

  // grass cap tops - kept close together so neighbouring voxels read as a
  // meadow rather than a checkerboard
  grass: [0x8ed35c, 0x85cd56, 0x7cc450, 0x74bb4b],
  // rare speckles on grass (ported from the 3d original's flower rule)
  flowerWhite: 0xf6f4e8,
  flowerYellow: 0xe8b028,
  flowerPink: 0xe87aa0,

  // tree bark - a grey-brown, cooler than the earth ramp, so a trunk reads as
  // wood rather than as a slice of the cliff it stands on
  bark: [0x8a6a48, 0x77593b, 0x63482f],

  // Leaves. Lifted and warmed toward Minecraft's oak green, which sits around
  // 1.35x the luminance of the previous near-black green.
  //
  // Still clearly darker than the grass cap, and that constraint is what caps
  // how light this can go: against the darkest grass entry (0x74bb4b) this
  // ramp's lightest cube holds 1.39:1 contrast, while pushing further toward
  // Minecraft's yellow-green drops to 1.05:1 and the canopy disappears into
  // the meadow at the default zoom. Hue is nudged off the grass ramp's too,
  // so the two separate on more than just brightness.
  //
  // THE SPREAD IS THE WHOLE CONSTRAINT, and it is a spread *rule*, not just a
  // colour list. Every cube in a canopy is picked from this ramp independently,
  // so the ramp's internal contrast is the contrast between two cubes that
  // share an edge. This one used to run 1.90:1 (0x5c9e42 / 0x4e8c39 / 0x41762f)
  // - far wider than any other ramp here - and at dawn the canopies dissolved:
  // a 1.9x step between neighbouring cubes reads as a hole in the canopy rather
  // than as texture, because a canopy is the one surface in this scene that is
  // a thin shell you can see *through*. Bark at 2.16:1 and sand at 1.62:1 are
  // both fine at the same spreads, because a trunk is a solid column and the
  // beach is a continuous field - neither has anything behind it showing
  // through a dark cube.
  //
  // It only showed up once the day/night cycle landed, and only at the dark end
  // of it. At noon the key light pushes the brightest leaves up against the
  // tone curve, which rolls their highlights off and closes the gap. Before
  // sunrise the sun contributes almost nothing to a horizontal leaf face, so
  // the hemisphere fill is the whole story and the raw albedo ratio survives
  // intact - the exact case the rest of the palette is already tuned for.
  //
  // So the fix is to bring this ramp in line with the grass ramp (1.34:1),
  // which has four entries and reads solid at every hour. The lightest entry
  // is unchanged, so the canopy's brightness against the meadow is untouched;
  // only the dark end is lifted.
  leaf: [0x5c9e42, 0x518f3c, 0x4c8738],

  // sand cap tops
  sand: [0xf7e8bd, 0xf2ddab, 0xe6c98f, 0xd8b878],

  // wet sand at the waterline
  wetSand: [0xdcc79a, 0xcbb085, 0xb89a72],

  // the earth under the grass cap and under the sand cap
  dirt: [0x9a6b45, 0x8b5f3c, 0x7d5334],

  // the thin line drawn along the two upper edges of every top face. Darker
  // than any dirt above: a voxel is only a dozen rendered pixels across at the
  // default zoom, so the outline has to read at very little size.
  edgeLine: 0x5c4028,

  // seabed / cliff body - warm silt, not dead grey
  rock: [0xb0a084, 0xa08f72, 0x8e7e63, 0x7a6b54],

  // water body, deep -> shallow, then foam
  water: [0x0b4f9e, 0x1176c4, 0x1aa8cc, 0x5fd6cc, 0xccebb8],
  foam: 0xf4fffb,

  // player
  shirt: [0xe8564a, 0xcf4a3f, 0xb03c34],
  pants: [0x3a4a7a, 0x2f3c66, 0x26304f],
  skin: [0xf2c9a0, 0xe0b088],
  hair: [0x4a3324, 0x35241a],
  cap: [0xe8564a, 0xf2f0e6],
  eye: 0x2a1e14,
} as const;

// The baked face-shade table is gone. It used to multiply every face in the
// shader, giving the scene its whole sense of form at zero light cost - but a
// flat per-direction multiply is exactly what a real light rig does better, and
// having both meant the lights had to be dialled back to near-nothing to stop
// the two adding up (see the lighting notes in main.ts). Face shading is now the
// directional light's N.L plus the sky fill, so top / +x / +z read bright and
// -x / -z / bottom read dark purely from which way they point.

const scratch = new THREE.Color();

// multiply a hex palette entry toward black, keeping the palette's hue
export function shade(hex: number, k: number): number {
  scratch.setHex(hex, THREE.SRGBColorSpace);
  scratch.multiplyScalar(k);
  return scratch.getHex(THREE.SRGBColorSpace);
}

// pick from a ramp (light -> dark) with a 0..1 random value
export function pick(ramp: readonly number[], r: number): number {
  const i = Math.min(ramp.length - 1, Math.max(0, Math.floor(r * ramp.length)));
  return ramp[i];
}