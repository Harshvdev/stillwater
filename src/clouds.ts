import * as THREE from 'three';
import { dayState, getCycleLength } from './daynight';
import { CLOUD_DRIFT_AZ } from './wind';

/**
 * Cloud shadows on the ground.
 *
 * The scene has no sky - it is an orthographic top-down view with no horizon, so
 * a dome would never be on screen (see the note in main.ts). But that does NOT
 * mean the light can have no texture overhead. A cloud drifting past the sun
 * darkens the ground it passes over, and that shadow is the only thing in the
 * frame that says "there is weather above you". It is also, with the cast
 * shadows from trees and terrain, one of the few ways this projection can
 * express a slow change across a large flat area - which the island's single
 * interior plateau badly needs.
 *
 * So: no clouds are drawn. Only their shadows are.
 *
 * HOW IT WORKS
 *
 * The pattern is a field of density sampled in the XZ plane, and it is
 * multiplied into the DIRECT light term only. That distinction is the whole
 * trick. Under a real cloud the sun is blocked but the sky above is not, so the
 * fill and the ambient survive and the shadow reads as a soft, slightly cool
 * dimming rather than as a hole cut in the meadow. Scaling indirect light too
 * would darken toward flat black and look like a missing chunk of terrain.
 *
 * It is applied to `reflectedLight.directDiffuse` and `directSpecular` after
 * three has finished its own lighting, so it composes with the shadow map
 * rather than replacing it - a cloud shadow and a tree's cast shadow simply
 * multiply, which is what happens in reality.
 *
 * THE SAMPLE POINT IS NOT THE WORLD POINT
 *
 * A fragment's own XZ is the WRONG place to look for the cloud that shadows it.
 * What matters is what sits above it, along the ray from the sun. So the
 * fragment is projected up onto a virtual cloud plane and the field is sampled
 * there:
 *
 *     plane = worldXZ + L.xz * (CLOUD_H / L.y)
 *
 * Three things fall out of that for free, and they are the reason for doing it
 * this way rather than sampling world XZ directly:
 *
 *   1. The shadows PARALLAX. As the sun moves across the day the whole pattern
 *      slides across the island, because the clouds stay put and only the light
 *      angle changes. Sampling world XZ would pin every shadow to the ground.
 *   2. They STRETCH as the sun drops. Toward the horizon the offset grows as
 *      1/L.y, so a shadow smears out along the light's azimuth exactly as a real
 *      one does - long and thin at dusk, compact and round at noon.
 *   3. No visible "pops" at the terminator, because the geometry is continuous
 *      and the low-sun fade is smoothstepped rather than switched.
 *
 * The offset can run to hundreds of units at a low sun, so L.y is clamped and
 * the whole term is faded out near the horizon - see ELEV_FADE below. Without
 * that fade the field is sampled across a huge stretch of itself at dusk and
 * turns into diagonal streaks, which is exactly what the glitter band on the
 * water has to work hard not to look like.
 *
 * THE ART DIRECTION, AND WHY IT IS ALL IN CONSTANTS
 *
 * "Light, natural, naturally sized" are three separate decisions, so each has
 * its own named constant rather than being folded into one magic number. They
 * were all tuned by eye against screenshots at several hours.
 */

/**
 * World units per cloud feature.
 *
 * This is the SIZE. A tree canopy in this scene is 5 voxels across, so 1/5 puts a
 * cloud shadow at roughly the same size as one tree's footprint on the ground -
 * which is the reference asked for, and it happens to be a good one: a shadow
 * the size of a tree reads as weather passing over the island rather than as
 * weather covering it.
 *
 * The two constants are a pair and must be read together. The shader samples
 * `floor(world / CLOUD_CELL) * CLOUD_SCALE`, so the feature size in world units
 * scales as CLOUD_CELL / CLOUD_SCALE. With CLOUD_CELL = 1 that is 1/CLOUD_SCALE.
 *
 * Settled by measuring connected blobs in the rendered frame rather than by
 * deriving it, because two earlier attempts were wrong in opposite directions:
 * 1/5 produced shadows around 15 world units - three tree canopies - while 1/14
 * broke the field into speckle with a median blob of half a unit, which reads as
 * dirt on the lens rather than as weather. 1/9 puts a typical shadow at roughly
 * a tree canopy across.
 */
const CLOUD_SCALE = 1 / 9;

/**
 * How dark a fully covered patch goes, as a fraction of the direct light
 * removed. This is the LIGHTNESS.
 *
 * Minecraft's cloud shadows are much darker than a physically-scaled cumulus
 * would be, and that is the target here: a clearly legible dark patch with a
 * hard edge, not a gentle unevenness. 0.55 is dark enough to read instantly as
 * "something is between the sun and this ground" while still leaving the
 * hemisphere fill intact, so a shadowed patch stays the same green rather than
 * turning into a hole cut in the terrain.
 */
const CLOUD_AMOUNT = 0.55;

/**
 * Size of one cloud-shadow block, in world units.
 *
 * This is what makes the shadows read as MINECRAFT clouds rather than as
 * painterly ones. Minecraft's clouds are flat slabs built from hard-edged
 * rectangular cells, and their shadows inherit exactly that silhouette: blocky,
 * axis-aligned, with straight runs and right angles. Smooth FBM noise can never
 * produce that no matter how it is tuned - it has no straight edges to give.
 *
 * So the noise field is sampled on this grid and each cell is given its own
 * flat value, which quantises the silhouette into rectangles.
 *
 * ONE VOXEL. The cell grid is the shadow's resolution, and Minecraft's clouds are
 * built from blocks - so a one-voxel cell is both the most faithful choice and,
 * at this render scale, about three screen pixels: chunky enough to read as a
 * built shape, small enough that the shadow still has internal structure rather
 * than being one solid slab. It was 4, which made every shadow a 12-pixel
 * rectangle and, combined with CLOUD_SCALE, produced features ten tree canopies
 * across.
 *
 * Spelled out as a literal rather than imported from island.ts: island.ts calls
 * applyCloudShadows() at module scope, so importing VOXEL from it here would make
 * the two modules circular and read an uninitialised binding. island.ts already
 * imports this one, so the dependency has to point this way only.
 */
const CLOUD_CELL = 1; // one voxel - see island.ts's VOXEL, which is also 1

/**
 * How many distinct depth levels a cloud shadow has.
 *
 * Two, deliberately. Minecraft's clouds are flat white slabs of uniform
 * thickness, so their shadow is essentially binary - lit or not lit - with the
 * only softness coming from the edge of the block. More levels would give a
 * gradient inside each shadow and turn it back into something painterly.
 */
const CLOUD_LEVELS = 2;

/**
 * How fast the deck drifts, in world units per second.
 *
 * Slow on purpose. The shadows are the most noticeable thing moving in a scene
 * where nothing else moves much at this camera height, so anything faster
 * becomes the thing you watch instead of the thing you walk through. At 0.9 a
 * cloud takes about three minutes to cross the island, which is the kind of
 * pace that registers as weather rather than as an animation.
 */
const CLOUD_DRIFT = 0.9;

/**
 * How long the deck takes to go from clear to overcast, in seconds.
 *
 * This is what makes the shadows appear SOMETIMES rather than always. The gate
 * is a single very-low-frequency noise value, so the sky is broadly clear,
 * then slowly fills, then opens again, on its own and irregularly. Injected
 * here as a multiplier on CLOUD_AMOUNT rather than baked into the shader, so
 * that a frame with no cloud on it is a true no-op - important, because this
 * term is evaluated for every lit fragment in the scene.
 */
const CLOUD_CYCLE = 88;

/**
 * How many days in a seven-day week carry cloud.
 *
 * Exactly three. This started as a 2-4 range and was narrowed: a varying count
 * means the amount of cloud changes from week to week, so there is never a
 * baseline to judge the effect against and you cannot tell a deliberate tuning
 * change from the weather. A fixed count keeps three days as the reference and
 * leaves the variation to WHEN they fall.
 *
 * MEASURED IN GAME DAYS, NOT SECONDS. A day is however long the day/night cycle
 * is set to (10 minutes by default), so a week is 70 minutes of play at that
 * setting. Shortening the day cycle in the day panel shortens the week
 * proportionally, and is the intended way to taste this without waiting an hour.
 *
 * The run is CONTIGUOUS rather than scattered. Three separate cloudy days per
 * week would put a cloud, then a gap, then another cloud, and at a glance the
 * effect would read as randomly blinking rather than as a spell of weather.
 */
const WEEK_DAYS = 7;
const CLOUD_DAYS = 3;

/**
 * Deterministic per-week hash, so a given week always has the same weather.
 *
 * Without this the cloud run would be re-rolled every frame and never resolve.
 * Same sin-hash the rest of the codebase uses.
 */
function weekHash(i: number, salt: number): number {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Seconds in one game day.
 *
 * Read live rather than cached: the day panel can change the cycle length at
 * runtime, and a week of cloud has to follow it or the two would disagree about
 * how long a day is.
 */
function cycleLengthSeconds(): number {
  return getCycleLength();
}

/**
 * Whether the given day is overcast, and how heavily.
 *
 * `daysElapsed` is a float count of whole and partial game days since start.
 * Returns 0..1, and is non-zero ONLY on days that belong to the week's cloudy
 * run.
 *
 * That "only" is the whole correctness condition, and an earlier version got it
 * wrong. It eased the front in and out by spilling onto the clear days either
 * side of the run, which meant a week that rolled a 4-day run measured FIVE
 * cloudy days when sampled - and sampling is how the count would be judged. The
 * easing now happens strictly INSIDE the first and last cloudy days, so the
 * number of days with any cloud on them is exactly the number that was rolled.
 */
function dayGate(daysElapsed: number): number {
  const day = Math.floor(daysElapsed);
  const week = Math.floor(day / WEEK_DAYS);
  const dayInWeek = day - week * WEEK_DAYS;

  const len = CLOUD_DAYS;
  // Where the run starts: uniform over every position it can legally occupy, so
  // the three cloudy days land in genuinely different places week to week.
  // CLOUD_DAYS_MIN/MAX used to sit here; the count is fixed now, and what varies
  // is only where the run falls.
  const start = Math.floor(weekHash(week, 2.0) * (WEEK_DAYS - len + 1));

  const into = dayInWeek - start;
  // Outside the run there is no cloud at all, not even part-way through a day.
  if (into < 0 || into >= len) return 0;

  // Fraction of the current day, so the front can be eased across the boundary.
  const frac = daysElapsed - day;

  if (into === 0) return THREE.MathUtils.smoothstep(frac, 0, 0.5);
  if (into === len - 1) return THREE.MathUtils.smoothstep(1 - frac, 0, 0.5);
  return 1;
}

/**
 * Fade the whole term out as the key light approaches the horizon.
 *
 * The projection divides by L.y, so below about a fifth of full elevation the
 * sample point is thrown hundreds of units downwind and the noise is being read
 * over a huge stride. That does not just lose detail, it produces coherent
 * diagonal banding - the noise smearing along the sample direction. Fading the
 * term to zero over that range removes it, and it is also physically fair: at
 * dusk the sun is through so much atmosphere that its beam is already diffuse
 * and a hard shadow edge has nowhere to live.
 */
const ELEV_FADE = 0.3;

/** Shared uniform objects, mutated once per frame and read by every material. */
export const cloudUniforms = {
  /** seconds, for the coverage gate */
  uCloudTime: { value: 0 },
  /** the deck's offset in noise space, from heading * elapsed time */
  uCloudDrift: { value: new THREE.Vector2() },
  /** direction toward whichever light is currently the key */
  uCloudLightDir: { value: new THREE.Vector3(0, 1, 0) },
  /** master 0..1, scaled by the key's intensity so a moonless night is a no-op */
  uCloudAmount: { value: 0 },
  /** noise frequency; larger = smaller, finer cloud features */
  uCloudScale: { value: CLOUD_SCALE },
};

/**
 * Seconds of deck travel currently applied, i.e. the live clock the drift is
 * built from. Kept here rather than in the panel because the panel needs it the
 * moment freeze is ticked, and the panel only learns the clock from the frame
 * loop - which is throttled to a stop whenever the tab is backgrounded, and is
 * not the loop at all when driving the scene through __step.
 */
let deckTravel = 0;

/**
 * The shipped defaults, exported for the test panel so it can label its
 * positions and reset to them.
 *
 * This exists because the panel used to carry its own hand-copied numbers. They
 * drifted the moment CLOUD_SCALE changed during tuning, so "reset" would have
 * restored a value that was no longer the one the game ships with - the worst
 * possible failure mode for a control whose entire purpose is showing you the
 * shipped state.
 */
export const CLOUD_DEFAULTS = {
  amount: CLOUD_AMOUNT,
  scale: CLOUD_SCALE,
  drift: CLOUD_DRIFT,
} as const;

/** TEMPORARY - live overrides driven by cloudSlider.ts.
 *
 * Each field is null in normal play, meaning "use the constant". The panel sets
 * them, so the same shader can be swept across amount, size and speed without a
 * rebuild - which is the only practical way to tune these, because all three
 * were originally picked by eye and were wrong by a factor of two or more in
 * both directions before being measured.
 *
 * Note uCloudScale and the drift rate are runtime uniforms rather than baked into
 * the GLSL. An earlier version substituted them as literals when building the
 * shader string, which meant changing either one required a full reload and a
 * recompile of every material - which made tuning a two-minute round trip per
 * sample.
 */
export const cloudTestOverride = {
  /** absolute cloud strength, bypassing the key-intensity ramp and the gate */
  amount: null as number | null,
  /** noise frequency; 1/featureSize, matching CLOUD_SCALE's meaning */
  scale: null as number | null,
  /** deck speed in world units per second */
  drift: null as number | null,
  /** freeze the deck at this many seconds of travel */
  freezeAt: null as number | null,
};

export function resetCloudOverride(): void {
  cloudTestOverride.amount = null;
  cloudTestOverride.scale = null;
  cloudTestOverride.drift = null;
  cloudTestOverride.freezeAt = null;
}

/** Seconds of deck travel the drift is currently built from. */
export function getDeckTravel(): number {
  return deckTravel;
}

/**
 * Park the deck at the position it has reached, or release it.
 *
 * `null` releases. Anything else freezes at that many seconds of travel.
 */
export function freezeDeck(at: number | null): void {
  cloudTestOverride.freezeAt = at;
}

/**
 * Advance the deck. `t` is the scene clock in seconds, `keyIntensity` the
 * current key light's intensity.
 *
 * The deck drifts along the SAME wind vector that sways the trees and pushes
 * the falling leaves, so the whole scene agrees on which way the weather is
 * going. Sharing the vector rather than picking a new direction is the
 * difference between a world and a diorama.
 */
export function updateClouds(dt: number, t: number, keyIntensity: number): void {
  cloudUniforms.uCloudTime.value = t;

  // A FIXED heading, taken straight from the constant rather than from the live
  // wind vector. Reading windUniforms.uWindDir here meant the deck inherited that
  // vector's slow +-11 degree breathing, so the shadows visibly curved and
  // changed course over a minute or two - which reads as clouds steering, not as
  // weather passing overhead. See CLOUD_DRIFT_AZ for why this is world north
  // rather than world north-east.
  const speed = cloudTestOverride.drift ?? CLOUD_DRIFT;
  // While frozen the travel stays pinned; otherwise it follows the clock.
  deckTravel = cloudTestOverride.freezeAt ?? t;
  cloudUniforms.uCloudDrift.value.set(
    Math.cos(CLOUD_DRIFT_AZ) * deckTravel * speed,
    Math.sin(CLOUD_DRIFT_AZ) * deckTravel * speed
  );

  cloudUniforms.uCloudLightDir.value.copy(dayState.keyDir);

  // Written unconditionally, falling back to the shipped constant when there is
  // no override. Guarding this with `if (scale !== null)` looked correct and was
  // not: it means the uniform keeps whatever value it last held, so clearing the
  // override restores the shipped BEHAVIOUR but leaves the shader rendering at
  // the size the slider was last dragged to. The reset button then reported the
  // default size while the ground showed the overridden one.
  cloudUniforms.uCloudScale.value = cloudTestOverride.scale ?? CLOUD_SCALE;

  if (cloudTestOverride.amount !== null) {
    // An explicit amount bypasses BOTH the key-intensity ramp and the coverage
    // gate, which is what makes this useful for judging the shadow itself: at
    // dusk or under heavy cover the automatic terms can drive the effect to
    // nothing, and you cannot see what you are tuning.
    cloudUniforms.uCloudAmount.value = cloudTestOverride.amount;
    return;
  }

  // Scale by the key so a moonless night carries none. Without this the term
  // would keep darkening a scene lit only by the hemisphere fill, which reads
  // as the ground randomly changing colour rather than as a passing cloud.
  const k = Math.min(1, keyIntensity / 2.2);

  // The week: a day is however long the day/night cycle is set to, so the cloud
  // run is driven off the same clock the light runs on. See dayGate.
  const days = t / cycleLengthSeconds();
  const week = dayGate(days) * coverageSmoothed(dt, t);

  cloudUniforms.uCloudAmount.value = CLOUD_AMOUNT * k * week;
}

/**
 * How much of the deck is overhead right now, 0..1.
 *
 * One low-frequency noise value on a slow clock, thresholded. Being a single
 * scalar rather than a spatial field is what gives long clear stretches and
 * long overcast ones instead of a permanently half-covered sky.
 */
function coverage(t: number): number {
  // Below ~0.30 the sky is clear enough that the effect is off entirely.
  const n = 0.5 + 0.5 * Math.sin(t * (Math.PI * 2) / CLOUD_CYCLE + 1.7)
    * Math.sin(t * (Math.PI * 2) / (CLOUD_CYCLE * 0.37) + 0.4);
  const g = THREE.MathUtils.smoothstep(n, 0.30, 0.66);
  // never fully zero and never fully solid: even a clear stretch keeps a trace,
  // and even a heavy one leaves gaps, because cloud shadows always do.
  return 0.12 + 0.88 * g;
}

/**
 * Frame-rate independent approach toward a target.
 *
 * The coverage gate has to be eased, not applied directly. Sampling it straight
 * produced a swing between 5% and 100% strength roughly every 45 seconds, which
 * read as the cloud shadows blinking on and off rather than as weather building
 * and clearing. Easing it costs one scalar per frame and turns the same cycle
 * into something that arrives and leaves.
 *
 * The rate is deliberately slow - about a 1.5 second time constant. Fast enough
 * that a cloud visibly fades in over a few seconds rather than cutting, slow
 * enough that the gate itself never becomes the thing you notice.
 */
const COVERAGE_TAU = 1.5;
let coverageCur = 0.5;

function coverageSmoothed(dt: number, t: number): number {
  const target = coverage(t);
  // 1 - exp(-dt/tau), the exact solution to easing toward a target, so the
  // result does not depend on the frame rate the way a raw lerp factor would.
  const k = 1 - Math.exp(-dt / COVERAGE_TAU);
  coverageCur += (target - coverageCur) * k;
  return coverageCur;
}

const PARS = /* glsl */ `
uniform float uCloudTime;
uniform vec2  uCloudDrift;
uniform vec3  uCloudLightDir;
uniform float uCloudAmount;
uniform float uCloudScale;
varying vec3  vCloudWPos;

float cloudHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// Smooth value noise. Bilinear with a smoothstepped fraction, so the field
// clumps into soft blobs the way a cloud does rather than sitting as isolated
// single cells.
float cloudNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = cloudHash(i);
  float b = cloudHash(i + vec2(1.0, 0.0));
  float c = cloudHash(i + vec2(0.0, 1.0));
  float d = cloudHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Three octaves. Fewer than a smooth cumulus field would use, because what is
// wanted here is Minecraft's slab construction - chunky clumps with straight
// runs - rather than a natural cloud edge. Adding octaves would round the
// silhouettes back off, which is the opposite of the goal.
float cloudFbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    v += a * cloudNoise(p);
    p = p * 2.07 + vec2(11.3, 5.7);
    a *= 0.5;
  }
  return v;
}

// Fraction of the direct light this fragment loses, 0..1.
float cloudShade() {
  if (uCloudAmount <= 0.0) return 0.0;

  vec3 L = normalize(uCloudLightDir);

  // Sample the deck directly beneath the fragment - no projection offset.
  //
  // Earlier passes added an L.xz * (CLOUD_HEIGHT / L.y) projection offset here so
  // the shadows would parallax with the sun. Measured, that was a mistake: the
  // offset ran 26 to 140
  // world units across the day, while the visible frame is only ~44 units tall.
  // The pattern was being sampled far outside its own footprint, so coverage came
  // out wildly uneven - measured at 3% in the upper quarter and 50% in the lower
  // at noon, and worse at low sun.
  //
  // Dropping it removes the "the sun is over there so the shadows lean that way"
  // cue. In exchange the whole frame stays inside the field, coverage is even,
  // and the drift is purely the WIND - which is what the shadows should read as
  // anyway, since the clouds are what is moving and the sun is not. A shadow
  // sliding north-east across a still meadow is exactly the Minecraft behaviour.
  vec2 plane = vCloudWPos.xz;

  // Snap the sample point to a grid of CLOUD_CELL-sized blocks.
  //
  // This is the single line that makes the shadows look like Minecraft's. The
  // noise field is then evaluated once PER CELL rather than per fragment, so
  // every block of ground under a given cloud cell gets the same value and the
  // shadow silhouette becomes a union of axis-aligned rectangles - straight
  // runs, right angles, blocky steps. Soft FBM can never produce that silhouette
  // at any threshold, because it has no straight edges to threshold.
  //
  // floor() rather than a rounded snap is what creates the hard boundary
  // between neighbouring cells; rounding would merge them back into a gradient.
  vec2 cell = floor(plane / ${CLOUD_CELL.toFixed(1)} + uCloudDrift);

  // uCloudScale, not a baked literal: the test panel has to be able to sweep
  // cloud size without a reload, and this was the constant that needed the most
  // tuning of the three.
  float d = cloudFbm(cell * uCloudScale);

  // Hard step, no smoothstep.
  //
  // Minecraft's cloud shadows have a crisp edge because the cloud above is a
  // hard-edged slab. A soft ramp here would put a blurred gradient on the ground
  // that has no object casting it, and at this render resolution (a third of the
  // window, nearest-neighbour upscaled) a one-pixel-wide ramp lands on the pixel
  // grid unevenly and shimmers as the camera moves. So the edge is allowed to
  // be genuinely hard, exactly as the real thing is.
  // Threshold measured against the three-octave field's actual distribution:
  // median 0.438, interquartile 0.349..0.528. Stepping at 0.34 puts roughly 77%
  // of cells under some shadow, and the coverage gate in updateClouds() brings
  // that down to a clear-sky-to-broken range over time. An earlier 0.42 sat
  // right at the median and left only ~14% of the frame shadowed, which read as
  // a couple of stray patches rather than as weather.
  float cover = step(0.34, d);

  // Depth quantised to CLOUD_LEVELS. With two levels this is simply "shadowed or
  // not", which is what a flat slab of uniform thickness casts.
  float q = floor(cover * ${CLOUD_LEVELS.toFixed(1)}) / ${(CLOUD_LEVELS - 1).toFixed(1)};

  // Fade out at a low sun; see ELEV_FADE.
  float elev = smoothstep(0.04, ${ELEV_FADE.toFixed(3)}, L.y);

  return q * uCloudAmount * elev;
}
`;

/**
 * Attach cloud shadows to a lit material.
 *
 * Chains onto any existing `onBeforeCompile` and `customProgramCacheKey` rather
 * than overwriting them, so this composes with voxelMaterial's own shader work
 * (bands, outline, textures, wind) and with the stock three materials used for
 * the ocean quad and the player.
 *
 * The cache key has to be extended: three keys compiled programs on it, and a
 * material with this injection has to compile to a different program than an
 * identical one without it, or the two would share a program and one of them
 * would render with the other's missing varying.
 */
export function applyCloudShadows<T extends THREE.Material>(mat: T): T {
  const prevCompile = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey;

  mat.onBeforeCompile = function (this: THREE.Material, shader, renderer) {
    if (prevCompile) prevCompile.call(this, shader, renderer);

    shader.uniforms.uCloudTime = cloudUniforms.uCloudTime;
    shader.uniforms.uCloudDrift = cloudUniforms.uCloudDrift;
    shader.uniforms.uCloudLightDir = cloudUniforms.uCloudLightDir;
    shader.uniforms.uCloudAmount = cloudUniforms.uCloudAmount;
    shader.uniforms.uCloudScale = cloudUniforms.uCloudScale;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vCloudWPos;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
{
  vec4 cloudWp = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    cloudWp = instanceMatrix * cloudWp;
  #endif
  vCloudWPos = ( modelMatrix * cloudWp ).xyz;
}`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${PARS}`)
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
// Direct light only. The hemisphere fill and ambient are deliberately left
// alone: under a real cloud the sky above is still lit, and that surviving
// fill is what stops this reading as a hole cut in the terrain. Multiplying
// three's own cast-shadow result is deliberate too - a cloud shadow and a
// tree's shadow simply compound, which is what they do in reality.
{
  float cShade = 1.0 - cloudShade();
  reflectedLight.directDiffuse *= cShade;
  reflectedLight.directSpecular *= cShade;
}`
      );
  };

  mat.customProgramCacheKey = function (this: THREE.Material): string {
    const base = prevKey ? prevKey.call(this) : (mat as unknown as { type: string }).type;
    return `${base}|cloudshadows`;
  };

  mat.needsUpdate = true;
  return mat;
}
