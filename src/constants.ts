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
