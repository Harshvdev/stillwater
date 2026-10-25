// Scene-wide constants that outlive any one module.
//
// This file exists because SUN_DISTANCE used to live in sky.ts, and sky.ts was
// removed - not because the constant was wrong, but because it was never about
// the sky. It is the distance the key lights are parked from their target, and
// its only real job is to sit the shadow frustum comfortably between the shadow
// camera's near and far planes (see the shadow notes in main.ts).

// ------------------------------------------------------------------- the sun
// How far along its own direction the light in main.ts is parked from its
// target. Only the shadow camera's near/far planes and the scene scale care
// about this number - a directional light's shading does not - but it has to be
// far enough out that the whole shadow volume sits between the shadow camera's
// near and far planes.
export const SUN_DISTANCE = 110;

// -------------------------------------------------------------- the campfire
// Where the fire sits, and how much ground around it belongs to it.
//
// These live here rather than in campfire.ts because four other modules have to
// agree on them and none of them should be importing the fire's geometry to find
// out where it is: island.ts keeps the meadow clear of flowers and tall grass
// within CLEARING, trees.ts keeps trunks out of the same circle, player.ts
// collides against the footprint, and main.ts drops the player beside it instead
// of on top of it.
//
// (0, 0) is the island's own centre - groundHeight's radius is measured from it,
// and it is the middle of the grass plateau, which is flat for roughly 26 units
// in every direction. So the fire stands on level ground with open meadow around
// it, which is the one place on the island a campfire wants to be.
export const CAMPFIRE_X = 0;
export const CAMPFIRE_Z = 0;

/** Radius of the clearing: no flowers or tall grass inside this. */
export const CAMPFIRE_CLEARING = 1.9;

/**
 * Radius kept clear of tree trunks, measured from the fire to the trunk's cell.
 *
 * Wider than the clearing because a canopy is five voxels across and overhangs
 * the ground its trunk does not stand on - a trunk at 3 units would drop leaves
 * into the fire.
 */
export const CAMPFIRE_TREE_CLEARING = 3.6;

// ------------------------------------------------------- the fire's shadows
//
// The fire's shadow map is a point light's cube: six passes over the scene. Its
// camera is parked nine units out, so frustum culling keeps it to the meadow
// around the fire rather than the whole island.
//
// The fire's own logs are deliberately not allowed to cast into it. A flame
// burns above the wood, so the light comes over the pile from every side;
// making a point source inside the pile shadow the ground cut a hard wedge out
// of the pool that no real fire has. They still cast for the sun - see the
// shadow hook in campfire.ts.
