import * as THREE from 'three';

// Day / night cycle.
//
// Everything time-of-day lives here and everything else reads it from
// `dayState`:
//   sky.ts   - dome colours, sun/moon direction and discs, stars
//   main.ts  - the key + fill lights, and the fog colour
//   water.ts - the glitter path's axis and how hard the sea sparkles
//
// The module is deliberately the only place in the game that knows what time it
// is. Everything downstream treats the cycle as a set of already-solved values,
// which is why none of them has to re-derive anything about the sun.
//
// Two halves, and they are different kinds of number:
//
//   GEOMETRY is analytic. The sun and the moon each ride a fixed arc whose
//   elevation and azimuth are closed-form functions of the hour, so the dome's
//   disc, the light that shades the island and the glitter band on the sea are
//   all driven from one direction vector and cannot drift apart.
//
//   COLOUR AND INTENSITY are keyframed. A full stop table would hide the
//   numbers that matter, so the two stops that carry the authored look - noon
//   and deep night - are spelled out in the same terms as the light budget in
//   main.ts, and the rest are interpolated between them.

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

const wrap24 = (h: number): number => ((h % 24) + 24) % 24;

// ---------------------------------------------------------------- the arcs
//
// ELEVATION.
//
// The noon elevation is not a free choice: it is the 41.3 degrees the sun sat at
// before the cycle existed (sin = 0.66), and main.ts's whole light budget is
// solved against the 0.66 N.L that puts on a voxel's top face. Moving noon and
// re-tuning the intensities would have thrown away a carefully balanced rig for
// no gain, so the arc pivots on the authored sun and the rest of the day falls
// out of it.
//
// The moon rides its own arc half a turn out of phase, so it is highest at
// midnight - which is the whole reason it is here rather than the sun simply
// dimming.

const SUN_NOON_ELEV = Math.asin(0.66); // 41.3 deg, the authored sun
const MOON_ELEV = 0.62; // 35.5 deg at midnight: a little lower, it reads as further away

// AZIMUTH.
//
// Noon keeps the authored 135 degrees, i.e. sun horizontal (-1, 0, +1) / sqrt2.
// That is not a taste decision - sky.ts explains why: it is the azimuth whose
// shadows sweep across an isometric frame instead of hiding behind their own
// casters.
//
// The sweep is what makes it a cycle rather than a slider. At 6am and 6pm the
// elevation crosses zero, and to get there the azimuth has to rotate through
// the day. 75 degrees is a compromise: it is wide enough that the sun visibly
// travels and the glitter path swings across the sea with it, but it stops well
// short of a full 180, which would put sunrise and sunset on the view axis -
// the exact direction whose shadows a (+1,+1,+1) camera cannot see, so the
// island would go flat twice a day. The sun therefore stays off-axis at every
// hour of the cycle, at the cost of the two extremes of the arc being
// compressed rather than being the due-east / due-west of a real horizon.
const SUN_NOON_AZ = 135 * DEG;
const SUN_AZ_SWEEP = 75 * DEG;
const MOON_AZ_SWEEP = 55 * DEG;

// Elevation and azimuth of a body at a given hour.
//
// `a` is the hour angle: 0 at noon for the sun, 0 at midnight for the moon, and
// +-pi at the opposite pole. cos() gives elevation, sin() gives the swing
// through the eastern and western horizon, so one expression covers the whole
// day including the night, when the elevation simply goes negative.
function arc(a: number, maxElev: number, az0: number, sweep: number, out: THREE.Vector3): void {
  const elev = maxElev * Math.cos(a);
  const az = az0 + sweep * Math.sin(a);
  const flat = Math.cos(elev);
  out.set(flat * Math.cos(az), Math.sin(elev), flat * Math.sin(az));
}

const sunAngle = (h: number): number => TAU * (h / 24 - 0.5); // 0 at noon
const moonAngle = (h: number): number => TAU * (h / 24); // 0 at midnight

// ------------------------------------------------------------- the keyframes
//
// Every ramp the cycle drives, sampled at the hours where it actually turns.
//
// The noon row is the shipped scene: the same zenith, horizon and sun tint as
// the old sky.ts constants, and the same 3.78 / 1.73 light intensities and
// 0xfff2dc / 0xdcefff / 0xc9a87e colours that main.ts's budget was solved
// against. Anything that reaches it by interpolation lands on the scene as it
// was.
//
// Intensities are not a curve - they are per-stop numbers. The sun's own N.L
// already dims the key as it drops, so the intensities only have to describe
// what the geometry cannot: how fast the light goes once it is close to the
// horizon, and how the colour warms on the way down.

interface Stop {
  h: number;
  zenith: number;
  horizon: number;
  sunTint: number;
  /** warm haze around the sun: 1 is the noon haze, 0 is none */
  haloK: number;
  /** warm band along the horizon on the sun's side of the dome */
  horizonGlow: number;
  /** 0 = daylight, 1 = full starfield */
  stars: number;
  sunCol: number;
  sunI: number;
  moonCol: number;
  moonI: number;
  hemiSky: number;
  hemiGround: number;
  hemiI: number;
  /** how hard the sea glitters: 0 in moonless night, 1 at noon */
  glint: number;
}

// The fields that interpolate as plain numbers. The rest are colours and go
// through mixHex, because lerping a hex int would interpolate the *encoding*
// rather than the colour.
type ScalarKey = 'haloK' | 'horizonGlow' | 'stars' | 'sunI' | 'moonI' | 'hemiI' | 'glint';

// Ordered by hour, and it has to cover the whole 24: the last row is hour 24,
// which is hour 0 again, so the wrap needs no special case. Hours are placed
// where the look turns rather than on a tidy grid - the sun is on the horizon
// at 6 and 18 exactly, so that is where the sunrise and sunset rows sit.
const STOPS: readonly Stop[] = [
  {
    // deep night. The zenith is not black: pure black against bloom's threshold
    // has no headroom, and a hint of blue is what keeps it reading as night sky
    // rather than as a hole in the render.
    h: 0,
    zenith: 0x04081a, horizon: 0x0b1228, sunTint: 0x2b3a63,
    haloK: 0.1, horizonGlow: 0, stars: 1,
    sunCol: 0xffd9a8, sunI: 0,
    moonCol: 0x8aa4dc, moonI: 0.55,
    hemiSky: 0x2f5590, hemiGround: 0x0a0f1e, hemiI: 1.3,
    glint: 0.15,
  },
  {
    // last of the dark, moon still up
    h: 4.5,
    zenith: 0x071029, horizon: 0x1b2445, sunTint: 0x3a4a76,
    haloK: 0.1, horizonGlow: 0, stars: 1,
    sunCol: 0xffd9a8, sunI: 0,
    moonCol: 0x8aa4dc, moonI: 0.5,
    hemiSky: 0x2f5590, hemiGround: 0x0a0f1e, hemiI: 1.25,
    glint: 0.15,
  },
  {
    // first light: the sun is still ~5 deg under the horizon, so this is all
    // sky. The warmth is the horizon glow, not the key.
    h: 5.6,
    zenith: 0x14245c, horizon: 0x7a5570, sunTint: 0xff9a60,
    haloK: 0.2, horizonGlow: 0.45, stars: 0.5,
    sunCol: 0xff8a4a, sunI: 0.12,
    moonCol: 0x8aa4dc, moonI: 0.25,
    hemiSky: 0x3a58a0, hemiGround: 0x1a1626, hemiI: 1.15,
    glint: 0.2,
  },
  {
    // sunrise proper: the disc is on the horizon, the key is barely on
    h: 6.4,
    zenith: 0x2b4a9c, horizon: 0xe09a63, sunTint: 0xffb070,
    haloK: 0.55, horizonGlow: 0.55, stars: 0.12,
    sunCol: 0xff9c56, sunI: 1.0,
    moonCol: 0x8aa4dc, moonI: 0.1,
    hemiSky: 0x9fc0ec, hemiGround: 0xb8926e, hemiI: 1.35,
    glint: 0.55,
  },
  {
    h: 8,
    zenith: 0x2f6fc4, horizon: 0xc9ddec, sunTint: 0xffe9c0,
    haloK: 0.45, horizonGlow: 0.12, stars: 0,
    sunCol: 0xfff0cc, sunI: 3.0,
    moonCol: 0x8aa4dc, moonI: 0,
    hemiSky: 0xd8ecff, hemiGround: 0xc9a87e, hemiI: 1.7,
    glint: 0.95,
  },
  {
    // noon. The shipped look, exactly. See the budget in main.ts: sunlit sand
    // lands on 1.0 linear and a cast shadow on 0.42.
    h: 12,
    zenith: 0x2f6fc4, horizon: 0xbfdcea, sunTint: 0xffe6b4,
    haloK: 0.42, horizonGlow: 0, stars: 0,
    sunCol: 0xfff2dc, sunI: 3.78,
    moonCol: 0x8aa4dc, moonI: 0,
    hemiSky: 0xdcefff, hemiGround: 0xc9a87e, hemiI: 1.73,
    glint: 1,
  },
  {
    // the same height as 8am, so nearly the same row, a little warmer
    h: 16,
    zenith: 0x2e6bc0, horizon: 0xcbdceb, sunTint: 0xffe4b4,
    haloK: 0.45, horizonGlow: 0.14, stars: 0,
    sunCol: 0xfff0c8, sunI: 3.1,
    moonCol: 0x8aa4dc, moonI: 0,
    hemiSky: 0xd6e8fb, hemiGround: 0xc9a87e, hemiI: 1.7,
    glint: 0.95,
  },
  {
    // golden: the sun is about 7 deg up, so the key is mostly grazing and the
    // whole scene has to be carried by the fill
    h: 17.6,
    zenith: 0x2a5aa8, horizon: 0xe8c79a, sunTint: 0xffcf8c,
    haloK: 0.8, horizonGlow: 0.35, stars: 0,
    sunCol: 0xffd9a0, sunI: 2.2,
    moonCol: 0x8aa4dc, moonI: 0,
    hemiSky: 0xbcd6f2, hemiGround: 0xbfa07c, hemiI: 1.5,
    glint: 0.85,
  },
  {
    // the disc is on the horizon again, now going down
    h: 18.3,
    zenith: 0x22459c, horizon: 0xe08a55, sunTint: 0xffa25c,
    haloK: 0.9, horizonGlow: 0.6, stars: 0.05,
    sunCol: 0xff9a52, sunI: 0.7,
    moonCol: 0x8aa4dc, moonI: 0.12,
    hemiSky: 0xa8c4e8, hemiGround: 0xb08e70, hemiI: 1.2,
    glint: 0.35,
  },
  {
    h: 19.6,
    zenith: 0x12245c, horizon: 0x8a5a6e, sunTint: 0xd4704a,
    haloK: 0.4, horizonGlow: 0.25, stars: 0.45,
    sunCol: 0xff8a4a, sunI: 0,
    moonCol: 0x8aa4dc, moonI: 0.2,
    hemiSky: 0x2f4a86, hemiGround: 0x141220, hemiI: 1.05,
    glint: 0.15,
  },
  {
    h: 21,
    zenith: 0x060c22, horizon: 0x121a34, sunTint: 0x3a4a76,
    haloK: 0.12, horizonGlow: 0, stars: 0.95,
    sunCol: 0xffd9a8, sunI: 0,
    moonCol: 0x8aa4dc, moonI: 0.45,
    hemiSky: 0x2f5590, hemiGround: 0x0b1020, hemiI: 1.2,
    glint: 0.15,
  },
  {
    // hour 24 == hour 0, so the wrap is one straight interpolation
    h: 24,
    zenith: 0x04081a, horizon: 0x0b1228, sunTint: 0x2b3a63,
    haloK: 0.1, horizonGlow: 0, stars: 1,
    sunCol: 0xffd9a8, sunI: 0,
    moonCol: 0x8aa4dc, moonI: 0.55,
    hemiSky: 0x2f5590, hemiGround: 0x0a0f1e, hemiI: 1.3,
    glint: 0.15,
  },
];

// ------------------------------------------------------------------- state

/**
 * The solved time of day. Colours are live objects, mutated in place, so the
 * sky material can bind its uniforms to them once and never be told again.
 */
export const dayState = {
  /** time of day in hours, 0..24 */
  hour: 11,
  /** direction to the sun. Below the horizon at night; the disc is hidden but
   *  the vector stays valid, because the glitter axis is derived from it. */
  sunDir: new THREE.Vector3(),
  moonDir: new THREE.Vector3(),
  /** whichever of the two is currently the brighter key - this is the direction
   *  the sea's glitter path is computed from, so the reflection is under the
   *  light that is actually making it */
  keyDir: new THREE.Vector3(),

  zenith: new THREE.Color(),
  horizon: new THREE.Color(),
  sunTint: new THREE.Color(),

  /** warm haze around the sun's disc, 1 = the authored noon haze */
  haloK: 1,
  /** warm band along the horizon toward the sun's azimuth */
  horizonGlow: 0,
  stars: 0,

  sunColor: new THREE.Color(),
  sunIntensity: 0,
  moonColor: new THREE.Color(),
  moonIntensity: 0,

  hemiSky: new THREE.Color(),
  hemiGround: new THREE.Color(),
  hemiIntensity: 0,

  /** 0..1: how much the sea glitters */
  glint: 1,

  /** HDR disc colours, and how much of each is above the horizon */
  sunDisc: new THREE.Color(),
  sunDiscAmt: 0,
  moonDisc: new THREE.Color(),
  moonDiscAmt: 0,
};

// Two full turns of the disc: the sun's white at noon (4.0, 3.9, 3.5 - the
// original sky.ts value, kept above the bloom threshold) down to a deep
// horizon orange, and the moon's much cooler and slightly dimmer disc.
const DISC_HIGH = [4.0, 3.9, 3.5];
const DISC_LOW = [3.2, 1.5, 0.6];
const MOON_DISC = [2.1, 2.3, 2.7];

// A disc is drawn from a little under the horizon to a little over it, so it
// does not pop on the frame where the arc crosses zero.
const amt = (y: number): number => THREE.MathUtils.smoothstep(y, -0.02, 0.04);

const _c = new THREE.Color();

function mixHex(out: THREE.Color, a: number, b: number, t: number): void {
  out.setHex(a, THREE.SRGBColorSpace).lerp(_c.setHex(b, THREE.SRGBColorSpace), t);
}

/** Re-solve every value in `dayState` from the current hour. */
function solve(): void {
  const h = wrap24(dayState.hour);

  arc(sunAngle(h), SUN_NOON_ELEV, SUN_NOON_AZ, SUN_AZ_SWEEP, dayState.sunDir);
  arc(moonAngle(h), MOON_ELEV, SUN_NOON_AZ + 180 * DEG, MOON_AZ_SWEEP, dayState.moonDir);

  // the two stops either side of this hour. STOPS covers 0..24 inclusive, so a
  // lookup that misses both ends cannot happen.
  let i = 0;
  while (i < STOPS.length - 2 && STOPS[i + 1].h < h) i++;
  const a = STOPS[i];
  const b = STOPS[i + 1];
  const t = (h - a.h) / (b.h - a.h);
  const n = (k: ScalarKey): number => THREE.MathUtils.lerp(a[k], b[k], t);

  mixHex(dayState.zenith, a.zenith, b.zenith, t);
  mixHex(dayState.horizon, a.horizon, b.horizon, t);
  mixHex(dayState.sunTint, a.sunTint, b.sunTint, t);
  mixHex(dayState.sunColor, a.sunCol, b.sunCol, t);
  mixHex(dayState.moonColor, a.moonCol, b.moonCol, t);
  mixHex(dayState.hemiSky, a.hemiSky, b.hemiSky, t);
  mixHex(dayState.hemiGround, a.hemiGround, b.hemiGround, t);

  dayState.haloK = n('haloK');
  dayState.horizonGlow = n('horizonGlow');
  dayState.stars = n('stars');
  dayState.sunIntensity = n('sunI');
  dayState.moonIntensity = n('moonI');
  dayState.hemiIntensity = n('hemiI');
  dayState.glint = n('glint');

  // The disc's own colour is a function of how high the body is, not a
  // keyframe: extinction reddens the sun long before it dims it, and the
  // interpolation between "white at noon" and "orange at the horizon" is much
  // easier to trust when it is driven by the same elevation the light uses.
  const up = THREE.MathUtils.smoothstep(dayState.sunDir.y, 0.0, 0.3);
  dayState.sunDisc.setRGB(
    THREE.MathUtils.lerp(DISC_LOW[0], DISC_HIGH[0], up),
    THREE.MathUtils.lerp(DISC_LOW[1], DISC_HIGH[1], up),
    THREE.MathUtils.lerp(DISC_LOW[2], DISC_HIGH[2], up)
  );
  dayState.sunDiscAmt = amt(dayState.sunDir.y);
  dayState.moonDisc.setRGB(MOON_DISC[0], MOON_DISC[1], MOON_DISC[2], THREE.LinearSRGBColorSpace);
  dayState.moonDiscAmt = amt(dayState.moonDir.y);

  // Whichever light is brighter owns the specular path on the water. Compared
  // on intensity, not on elevation, because that is what decides how bright the
  // sea is.
  dayState.keyDir
    .copy(dayState.sunIntensity >= dayState.moonIntensity ? dayState.sunDir : dayState.moonDir);
}

// ------------------------------------------------------------------ driving

let running = true;

// A full 24-hour cycle in 10 minutes, so the sun crosses the horizon every five.
// Long enough that the light has visibly changed by the time you look up from a
// walk across the island, short enough to sit through a whole sunrise without
// losing the thread.
//
// A `let` rather than a `const` only so a console can push the cycle faster
// while testing a transition - nothing in the game changes it.
let cycleLength = 600;

export function advanceDayNight(dt: number): void {
  if (running) {
    dayState.hour = wrap24(dayState.hour + (dt * 24) / cycleLength);
  }
  solve();
}

/** Re-solve without advancing. Call after setting the hour by hand. */
export function refreshDayNight(): void {
  solve();
}

export function getHour(): number {
  return dayState.hour;
}

export function setHour(h: number): void {
  dayState.hour = wrap24(h);
  solve();
}

export function isRunning(): boolean {
  return running;
}

export function setRunning(on: boolean): void {
  running = on;
}

export function getCycleLength(): number {
  return cycleLength;
}

export function setCycleLength(seconds: number): void {
  cycleLength = Math.max(10, seconds);
}

solve();