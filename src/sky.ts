import * as THREE from 'three';

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

const R = 460; // must stay inside the camera's far plane (600)

const c = (hex: number): THREE.Color => new THREE.Color().setHex(hex, THREE.SRGBColorSpace);

// Zenith is a deeper blue than the old PALETTE.sky, and the horizon is much
// paler. That is the Minecraft sky shape: saturated overhead, washed out where
// it meets the ground, with most of the visible dome near the horizon because
// an isometric camera looks down at it.
const ZENITH = c(0x2f6fc4);
const HORIZON = c(0xbfdcea);

// Warm haze pooled around the sun. Without it the sun is a hard dot in a cold
// gradient, which reads as a decal rather than as a light source.
const SUN_TINT = c(0xffe6b4);

// ------------------------------------------------------------------- the sun
// The one place the sun's direction is defined. main.ts builds the directional
// light from this, so the dome's sun disc and the light that actually shades the
// island cannot drift apart.
//
// The old value was (60, 80, 40), i.e. the same (+x, +y, +z) quadrant the camera
// sits in. That is the worst possible choice for an isometric view, and it is
// why shadows were invisible: the camera looks along (-1,-1,-1), so a shadow
// thrown directly away from the sun is thrown directly *away from the camera*,
// landing behind its own caster and being occluded by it. Every shadow in the
// scene was correctly rendered and correctly hidden.
//
// The fix is to put the sun's horizontal azimuth perpendicular to the view
// axis. Decomposing the ground plane into the camera's own basis (see the
// RIGHT / BACK vectors in camera.ts):
//
//   screen-right  = ( 1, 0, -1) / sqrt2
//   screen-away   = ( 1, 0,  1) / sqrt2
//
// For the shadow's ground direction to sweep across the frame rather than up
// it, the sun's horizontal direction wants zero component along `screen-away`
// and a full one along `screen-right`. That puts the azimuth at 135 degrees,
// i.e. sun horizontal = (-1, 0, +1) / sqrt2, and shadows fall toward
// (+1, 0, -1) - dead screen-left, neither toward nor away from the viewer, so
// nothing ever occludes them.
//
// The elevation is a separate knob, and it is the one number that has to serve
// two masters at once. A high sun barely self-shades (a voxel top face reads
// flat) but throws a short shadow that stays near its base, which reads as
// clutter. A low sun throws a long, graphic shadow but flattens the top faces
// and doubles the size of the tree blobs on screen.
//
// 0.66 is sin(41.3 degrees) and is the compromise: top faces keep an N.L of
// 0.66, and a 5-unit tree throws a shadow 5.7 units long - long enough to read
// as a shape, short enough that a canopy does not become an amorphous stain
// twice its own size. The old sun was 53 degrees up, which threw almost
// nothing at all.
//
// Unit length to three decimals: 0.531^2 * 2 + 0.66^2 = 0.9994.
export const SUN_DIR = new THREE.Vector3(-0.531, 0.66, 0.531).normalize();

// How far along SUN_DIR the light itself is parked from its target. Only the
// shadow camera's near/far planes and the scene scale care about this number -
// a directional light's shading does not - but it has to be far enough out that
// the whole shadow volume sits between the shadow camera's near and far planes.
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
varying vec3 vDir;

// Largest y at which the gradient is still the horizon colour, and the point
// where it has fully reached the zenith. Between them a smoothstep ramps.
const float ZENITH_START = 0.42;

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

  // Sun, and the haze around it. The dot product is the angle to the sun, so a
  // power of it gives a tight core inside a wide glow - the disc is the sharp
  // step, the glow is the long tail.
  float sd = clamp(dot(normalize(vDir), uSunDir), -1.0, 1.0);
  float above = clamp(sd, 0.0, 1.0);

  // wide, soft halo
  col = mix(col, uSunTint, pow(above, 18.0) * 0.42);
  // tighter warm bloom around the sun's own position
  col = mix(col, uSunTint, pow(above, 220.0) * 0.55);

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
  // like a dithered ring rather than a blurred one.
  col = mix(col, vec3(4.0, 3.9, 3.5), step(0.99965, sd));

  // Linear out, deliberately. The dome renders into the composer's half-float
  // target, where three forces tone mapping off for every material, and
  // OutputPass is what tone maps and encodes the finished frame. Converting to
  // sRGB here would encode the sky a second time and leave it visibly paler
  // than the terrain it is supposed to sit behind.
  gl_FragColor = vec4(col, 1.0);
}
`;

/**
 * Build the sky dome. Add it to the scene before everything else; it is drawn
 * first and, being a BackSide sphere with depth writes off, everything else
 * lands on top of it.
 */
export function createSky(): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uZenith: { value: ZENITH },
      uHorizon: { value: HORIZON },
      uSunTint: { value: SUN_TINT },
      uSunDir: { value: SUN_DIR },
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
  return dome;
}

// Exposed so main.ts can drive the scene fog from the same horizon colour the
// dome fades to. A fog whose colour does not match the sky's horizon is what
// produced the visible seam between the far sea and the background.
export function horizonColor(): THREE.Color {
  return HORIZON;
}
