import * as THREE from 'three';
import { dayState } from './daynight';

// Sky dome. Replaces the flat `scene.background` colour with an actual
// gradient, because the previous single-colour background was doing a lot of
// work that a shaded look needs done properly: with a flat clear colour there
// was nothing for the fog to fade into, so the far ocean ended in a hard line
// and the horizon read as a seam rather than as distance.
//
// The dome is a BackSide sphere rather than scene.background for two reasons.
// A gradient cannot be expressed as a Color at all; and putting it on a real
// mesh means it takes part in tone mapping on exactly the same terms as the
// terrain, so sky and ground roll off their highlights together instead of
// the sky being the one surface that ignores the curve.
//
// Colour is authored in sRGB and handed to the shader already converted to
// linear, which is the working space everything is composited in before
// OutputPass tone maps it.
//
// Since daynight.ts landed, none of the colours or directions here are authored
// in this file: every uniform is bound straight to a live object in `dayState`
// and this module only decides *how* those values are drawn. Adding a time of
// day therefore means adding a keyframe, never a new uniform wiring path.

const R = 460; // must stay inside the camera's far plane (600)

// ------------------------------------------------------------------- the sun
// How far along its own direction the light in main.ts is parked from its
// target. Only the shadow camera's near/far planes and the scene scale care
// about this number - a directional light's shading does not - but it has to be
// far enough out that the whole shadow volume sits between the shadow camera's
// near and far planes.
export const SUN_DISTANCE = 110;

const vertexShader = /* glsl */ `
varying vec3 vDir;
void main() {
  // Local position, not world: the dome sits at the origin and only ever spins,
  // so its own local direction is the view direction out to the sky. Using the
  // model matrix would drag the gradient along with the camera's iso pan.
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunTint;
uniform vec3 uSunDir;
uniform float uHaloK;
uniform float uHorizonGlow;
uniform vec3 uSunDisc;
uniform float uSunDiscAmt;
uniform vec3 uMoonDir;
uniform vec3 uMoonTint;
uniform float uMoonHaloK;
uniform vec3 uMoonDisc;
uniform float uMoonDiscAmt;
uniform float uStars;
varying vec3 vDir;

// Largest y at which the gradient is still the horizon colour, and the point
// where it has fully reached the zenith. Between them a smoothstep ramps.
const float ZENITH_START = 0.42;

// Warm haze pooled around a light source, and its disc. Written once for both
// the sun and the moon because they are the same two effects at different
// strengths and different temperatures, and duplicating the maths for the
// moonlet is how the two would drift apart.
vec3 bodyLight(vec3 col, vec3 dir, vec3 tint, float haloK, vec3 disc, float discAmt) {
  // The dot product is the angle to the light, so a power of it gives a tight
  // core inside a wide glow - the disc is the sharp step, the glow is the long
  // tail.
  float sd = clamp(dot(normalize(vDir), dir), 0.0, 1.0);

  // wide, soft halo, then a tighter warm bloom around the body itself
  col = mix(col, tint, pow(sd, 18.0) * 0.42 * haloK);
  col = mix(col, tint, pow(sd, 220.0) * 0.55 * haloK);

  // The disc, pushed well past white.
  //
  // This is the one place in the scene where HDR is physically justified: the
  // sun is orders of magnitude brighter than anything it lands on, so its disc
  // should blow out and roll off through the tone curve rather than sit at 1.0.
  // It also has to exceed the bloom pass's threshold (main.ts) or the brightest
  // object in the sky is the one thing that never glows.
  //
  // Hard-edged on purpose: this is a low-resolution buffer scaled up with
  // nearest-neighbour, so a soft edge would land on whole pixel steps and look
  // like a dithered ring rather than a blurred one. The moon takes the same
  // step at a much lower value, which is what makes it read as the same kind of
  // object that happens to be faint.
  return mix(col, disc, step(0.99965, sd) * discAmt);
}

float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

// Stars. One candidate per cell of a grid laid over the unit direction sphere,
// kept only where the cell's hash clears a threshold, and pushed off the cell
// centre so the field does not read as a lattice.
//
// The hard disc is not an accident: at this render resolution a soft star would
// land on two or three whole pixels and smear into a blob, which is worse than
// a clean one-pixel dot. Only the size is smoothed, and only by the width of a
// pixel's worth of falloff.
float starField(vec3 d) {
  vec3 p = d * 42.0;
  vec3 cell = floor(p);
  vec3 f = fract(p) - 0.5;
  float h = hash13(cell);
  if (h < 0.972) return 0.0;
  f -= (vec3(hash13(cell + 1.7), hash13(cell + 3.1), hash13(cell + 5.3)) - 0.5) * 0.55;
  // how bright this one is, from the same hash that decided it exists
  float mag = (h - 0.972) / 0.028;
  return (1.0 - smoothstep(0.06, 0.115, length(f))) * (0.28 + 0.72 * mag);
}

void main() {
  float y = clamp(vDir.y, -1.0, 1.0);

  // Below the horizon the dome must not fade to the zenith blue - the ocean
  // plane does not quite reach the dome's edge, and a strip of deep blue under
  // the sea would read as a hole. Below the horizon the dome holds the horizon
  // colour and lets fog do the rest.
  float up = clamp(y / ZENITH_START, 0.0, 1.0);
  float ramp = smoothstep(0.0, 1.0, up);
  vec3 col = mix(uHorizon, uZenith, ramp);

  // Below y = 0, ease back down to the horizon colour so the underside of the
  // dome matches the sea it sits behind.
  col = mix(col, uHorizon, smoothstep(0.0, -0.12, y));

  // Stars go in before the haze, so dawn light washes over them rather than
  // being pasted on top of them. They fade out at the horizon, where the sky is
  // brightest and where a star would sit in the seam between sea and sky.
  if (uStars > 0.0) {
    float vis = smoothstep(0.0, 0.28, y) * uStars;
    col += vec3(0.9, 0.93, 1.0) * starField(normalize(vDir)) * vis;
  }

  // The warm band a sunrise lays along the horizon on its own side of the dome.
  // It is the difference between "the sun is somewhere below" and "it is
  // coming up over there", and it is why the dawn and dusk stops need a colour
  // of their own rather than just a dimmed sun.
  if (uHorizonGlow > 0.0) {
    float flat2 = length(vDir.xz);
    if (flat2 > 1e-4) {
      vec2 here = vDir.xz / flat2;
      vec2 sunFlat = normalize(uSunDir.xz + vec2(1e-5, 1e-5));
      float toward = max(dot(here, sunFlat), 0.0);
      float band = 1.0 - smoothstep(0.0, 0.30, abs(y));
      col = mix(col, uSunTint, band * toward * toward * uHorizonGlow);
    }
  }

  col = bodyLight(col, uSunDir, uSunTint, uHaloK, uSunDisc, uSunDiscAmt);
  col = bodyLight(col, uMoonDir, uMoonTint, uMoonHaloK, uMoonDisc, uMoonDiscAmt);

  // Linear out, deliberately. The dome renders into the composer's half-float
  // target, where three forces tone mapping off for every material, and
  // OutputPass is what tone maps and encodes the finished frame. Converting to
  // sRGB here would encode the sky a second time and leave it visibly paler
  // than the terrain it is supposed to sit behind.
  gl_FragColor = vec4(col, 1.0);
}
`;

export interface SkyDome {
  mesh: THREE.Mesh;
  /**
   * three only re-uploads a ShaderMaterial's uniforms when asked to, so this has
   * to be called every frame the dome is drawn. The uniform *values* are the
   * live objects in `dayState`, so there is nothing to copy - only the flag.
   */
  sync(): void;
}

/**
 * Build the sky dome. Add it to the scene before everything else; it is drawn
 * first and, being a BackSide sphere with depth writes off, everything else
 * lands on top of it.
 */
export function createSky(): SkyDome {
  const mat = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      // bound to the live state objects rather than to copies: daynight.ts
      // mutates these in place, so the dome tracks the cycle with no per-frame
      // copying at all
      uZenith: { value: dayState.zenith },
      uHorizon: { value: dayState.horizon },
      uSunTint: { value: dayState.sunTint },
      uSunDir: { value: dayState.sunDir },
      uHaloK: { value: dayState.haloK },
      uHorizonGlow: { value: dayState.horizonGlow },
      uSunDisc: { value: dayState.sunDisc },
      uSunDiscAmt: { value: dayState.sunDiscAmt },
      uMoonDir: { value: dayState.moonDir },
      // the moon's haze is a quarter of the sun's at its best, and cooler: a
      // bright pool of light around the moon would compete with the disc
      uMoonTint: { value: new THREE.Color(0.9, 0.94, 1.05) },
      uMoonHaloK: { value: 0.25 },
      uMoonDisc: { value: dayState.moonDisc },
      uMoonDiscAmt: { value: dayState.moonDiscAmt },
      uStars: { value: dayState.stars },
    },
    side: THREE.BackSide,
    depthWrite: false,
    // the dome must not be fogged - it IS the far field that everything else
    // fades into, so fogging it would double the fade at the horizon
    fog: false,
  });

  const dome = new THREE.Mesh(new THREE.SphereGeometry(R, 32, 20), mat);
  dome.name = 'sky';
  dome.renderOrder = -1;
  // it is scenery, not a shadow caster or receiver: a dome the size of the
  // world would swallow the entire shadow frustum
  dome.castShadow = false;
  dome.receiveShadow = false;
  dome.frustumCulled = false;

  return {
    mesh: dome,
    sync: () => {
      // the scalars are plain numbers in dayState, so they have to be pushed
      // across by hand; the colours and vectors are the uniform values already
      mat.uniforms.uHaloK.value = dayState.haloK;
      mat.uniforms.uHorizonGlow.value = dayState.horizonGlow;
      mat.uniforms.uSunDiscAmt.value = dayState.sunDiscAmt;
      mat.uniforms.uMoonDiscAmt.value = dayState.moonDiscAmt;
      mat.uniforms.uStars.value = dayState.stars;
      mat.uniformsNeedUpdate = true;
    },
  };
}