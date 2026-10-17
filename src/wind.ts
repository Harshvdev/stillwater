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
 */

// Base prevailing wind direction: blowing north-east / east-north-east
const BASE_WIND_AZ = 0.65; // ~37 degrees

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

let windAngleTimer = 0;

/**
 * Step the wind simulation forward.
 */
export function updateWind(dt: number, elapsedTime: number): void {
  windUniforms.uWindTime.value = elapsedTime;

  // Slowly drift the wind direction angle slightly (+-12 degrees) so it breathes
  windAngleTimer += dt * 0.15;
  const currentAz = BASE_WIND_AZ + Math.sin(windAngleTimer) * 0.2;
  windUniforms.uWindDir.value.set(Math.cos(currentAz), Math.sin(currentAz));

  // Global wind strength with occasional stronger gusts
  const globalGust = 0.85 + 0.3 * Math.sin(elapsedTime * 0.5) * Math.cos(elapsedTime * 0.3);
  windUniforms.uWindStrength.value = globalGust;
}
