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
  // A flower is a stem and a bloom now, not one cube, so the palette needs the
  // two parts the old single colour had no room for.
  //
  // The stem sits a clear step below the grass ramp's darkest entry on purpose.
  // A stem as light as the grass it grows out of vanishes into the meadow at the
  // default zoom, where a whole flower is about fifteen pixels tall - and a
  // flower with no visible stem reads as a floating cube, which is the exact
  // thing this replaced.
  flowerStem: 0x4a8c3c,
  // The bloom's centre. A contrasting core is most of what makes a flower read
  // as a flower rather than as a coloured lump, and it is the smallest part of
  // the bloom, so the contrast is doing real work at very little size.
  flowerCentre: 0xf0c020,     // against the white and pink blooms
  // A yellow bloom cannot also have a yellow centre, or the two merge and the
  // flower goes back to being one flat shape.
  flowerCentreWarm: 0xd4682a,
  // Tall grass: the meadow's ground cover, filling the ground between the flower
  // drifts. Two tones, mixed across the blades of a single tuft, because one flat
  // green reads as a solid object while two reads as a plant.
  //
  // Both sit below the grass ramp's darkest entry (0x74bb4b) on purpose. A blade
  // the same value as the ground it grows out of is invisible, and tall grass
  // that you cannot see is not worth the instances.
  //
  // But only just below. The first pass at this was a step darker still, and a
  // tuft read as a dark hole punched in the meadow rather than as grass standing
  // up out of it - the blades are thin enough that most of what you see of one is
  // its shadowed side, so a dark albedo lands darker on screen than it looks on
  // paper. These hold about 1.35:1 against the darkest grass, which is the most
  // separation that still reads as cover rather than as damage.
  tallGrass: [0x70b248, 0x5ea03e, 0x4d8a34],

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

  // water body, deep -> shallow
  water: [0x0b4f9e, 0x1176c4, 0x1aa8cc, 0x5fd6cc, 0xccebb8],

  // Splashing water.
  //
  // The colour of the SEA, not white. A splash is the same water as the water
  // it came out of, and it only looks white because it is broken up and
  // catching the light everywhere at once. A white cube thrown out of a
  // teal sea reads as snow.
  //
  // But pale, because a droplet is a tiny lens of water and a lens shows the
  // sky. It is the shallow-water teal brightened almost to white - bright
  // enough to stand out against the sea it was thrown out of, and still
  // obviously the same water. Every splash in this scene happens over the
  // shallows, which are already pale, so a droplet the same value as the
  // water around it would be invisible.
  splash: 0xd2f4ec,

  // Underwater plants.
  //
  // Cooler and darker than the land greens, and that is not a mood choice: an
  // underwater plant is only ever seen through the water's own blue, and a
  // warm land green under a blue filter comes out as mud. These are pushed
  // towards teal for the same reason the sea is, and the darkest entry is a
  // long way below the lightest - a plant in deep shade on a sand floor is
  // most of what you see of it.
  algae: [0x5aa06d, 0x468257, 0x366545],

  // player
  shirt: [0xe8564a, 0xcf4a3f, 0xb03c34],
  pants: [0x3a4a7a, 0x2f3c66, 0x26304f],
  skin: [0xf2c9a0, 0xe0b088],
  hair: [0x4a3324, 0x35241a],
  cap: [0xe8564a, 0xf2f0e6],
  eye: 0x2a1e14,

  // The campfire.
  //
  // Its logs are the trees' own oak, burnt: the bark ramp pulled down and
  // desaturated, because charred wood loses the warm brown it started with
  // before it loses its shape. Kept as a ramp rather than one colour for the
  // same reason as the bark - a pile of four logs of identical shade reads as a
  // single extruded block.
  campfireLog: [0x8a6746, 0x76563a, 0x64462e],
  // The upward face of a log. In Minecraft's campfire the logs lie on their
  // sides, so the face you look down on is still bark - scorched, a shade darker
  // than the outside, but wood and not charcoal. That matters more than it
  // sounds: from this camera the tops are most of the pile, and tops painted
  // with the char ramp turned the whole campfire into a black square sitting on
  // the grass. The char belongs in the seams, which is where it is.
  campfireTop: [0x745538, 0x62462e, 0x513926],
  // The bed between the bottom logs, burnt all the way through.
  campfireChar: [0x3a2a1e, 0x2e2117, 0x241a12],

  // The flame. Five tones, hot to cold, which is all a 16x16 fire needs: the
  // whole sprite is a silhouette plus a temperature gradient, and every extra
  // tone past this just greys the gradient out.
  //
  // The core is deliberately not white-white. Neutral white under the tone curve
  // is a dead pixel at the centre of the fire; the faintest yellow keeps it
  // reading as the hottest part of a flame rather than as a hole.
  flame: {
    core: 0xfff8e0,
    hot: 0xffd257,
    mid: 0xf59327,
    low: 0xd2521c,
    ember: 0x8f2a10,
  },
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