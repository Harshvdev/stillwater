import * as THREE from 'three';

/**
 * Global Wind System.
 *
 * Coordinates wind across:
 * 1. Vegetation sway (tall grass cards, flower stems and heads, tree canopies).
 * 2. Particle drift (falling tree leaves, pollen/spores).
 *
 * Driving all elements from a single coherent vector field ensures that vegetation
 * bends in the same direction leaves are blown.
 *
 * The cloud deck (clouds.ts) has its own heading, CLOUD_DRIFT_AZ, because the
 * isometric projection squashes world north-east onto the horizontal axis. See
 * the note on that constant for why the two deliberately differ.
 */

// Base prevailing wind direction: due NORTH-EAST.
//
// In this world +X is east and +Z is south (the camera looks along +X/+Y/+Z from
// the north-west, so north is toward -Z). North-east is therefore equal parts
// -Z and +X, which is a 45 degree azimuth measured from the +X axis.
//
// This is the single direction the whole scene agrees on: trees sway, leaves
// fall and cloud shadows drift along it, so changing this one constant changes
// where the weather is going everywhere at once.
const BASE_WIND_AZ = -Math.PI / 4; // 45 deg toward -Z / +X = north-east

/**
 * Direction the CLOUD DECK drifts, in radians, measured in the XZ plane from +X.
 *
 * Deliberately NOT the same as BASE_WIND_AZ, and this needs explaining.
 *
 * The camera is orthographic with a fixed (-1,-1,-1) view direction, so world
 * directions do not appear on screen at their world angles. Projecting the
 * camera's own screen axes through the rig gives:
 *
 *     world north  (-Z)   ->  30 degrees up-and-right   <- looks north-east
 *     world east   (+X)   ->  30 degrees down-and-right
 *     world north-east    ->  exactly 0 degrees, dead horizontal
 *
 * A world north-east vector (+X, -Z) lies precisely along the camera's screen-right
 * axis, so its north component is annihilated by the projection and the shadows
 * slid across the screen perfectly flat. That is not a bug, it is what an
 * isometric camera does to that particular diagonal - but it does not read as
 * "travelling north-east" to anyone watching it.
 *
 * So the deck drifts along world NORTH, which projects to up-and-right and
 * genuinely LOOKS like it is travelling north-east on screen. The clouds and the
 * trees no longer share a heading; that is a conscious trade for legibility, and
 * it is why this constant is separate rather than reusing the wind vector.
 *
 * If the camera is ever changed to a different rig, this needs re-deriving.
 */
export const CLOUD_DRIFT_AZ = -Math.PI / 2; // -Z, world north -> reads as north-east on screen

export const windUniforms = {
  uWindTime: { value: 0 },
  uWindDir: { value: new THREE.Vector2(Math.cos(BASE_WIND_AZ), Math.sin(BASE_WIND_AZ)) },
  uWindStrength: { value: 1.0 },
};

export interface WindSample {
  vx: number;
  vy: number;
  vz: number;
  gust: number;
}

const _sample: WindSample = { vx: 0, vy: 0, vz: 0, gust: 1 };

/**
 * Sample wind velocity vector at a specific world coordinate and time.
 * Used for CPU physics (e.g. falling leaves and particles).
 */
export function getWindAt(x: number, z: number, y: number, t: number): WindSample {
  const dir = windUniforms.uWindDir.value;
  // Large rolling wind waves across the island
  const wave1 = Math.sin(x * 0.18 + z * 0.15 - t * 2.2);
  const wave2 = Math.cos(x * 0.35 - z * 0.28 - t * 3.4) * 0.5;
  // Natural gusting modulation
  const gust = 0.65 + 0.35 * Math.sin(t * 0.85 + x * 0.04) + 0.15 * Math.sin(t * 1.7 - z * 0.03);

  const total = (wave1 + wave2) * gust * windUniforms.uWindStrength.value;

  // Primary drift along wind direction + subtle crosswind turbulence
  const crossX = -dir.y;
  const crossZ = dir.x;
  const cross = Math.sin(x * 0.25 + z * 0.25 + t * 2.0) * 0.25;

  _sample.vx = (dir.x * (1.2 + total * 0.8) + crossX * cross);
  _sample.vz = (dir.y * (1.2 + total * 0.8) + crossZ * cross);
  // Slight updraft / downdraft turbulence
  _sample.vy = Math.sin(x * 0.3 - z * 0.2 + t * 2.5) * 0.15;
  _sample.gust = Math.max(0.2, gust);

  return _sample;
}

/**
 * Step the wind simulation forward.
 */
export function updateWind(dt: number, elapsedTime: number): void {
  windUniforms.uWindTime.value = elapsedTime;

  // Direction is FIXED at BASE_WIND_AZ.
  //
  // This used to breathe by +-0.2 rad (+-11 degrees) on a slow sine, which was
  // fine when the only consumer was a tree sway that nobody tracked. It is not
  // fine now: the cloud deck drifts along this same vector, and a direction that
  // wanders makes the shadows visibly change course, which reads as the clouds
  // steering rather than as weather passing over. A steady wind is also what
  // makes the drift legible - you can see where it is going.
  windUniforms.uWindDir.value.set(Math.cos(BASE_WIND_AZ), Math.sin(BASE_WIND_AZ));

  // Global wind strength with occasional stronger gusts
  const globalGust = 0.85 + 0.3 * Math.sin(elapsedTime * 0.5) * Math.cos(elapsedTime * 0.3);
  windUniforms.uWindStrength.value = globalGust;
}
