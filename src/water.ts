import * as THREE from 'three';
import { VOXEL, SEA_Y, voxelMaterial, levelAtWorld, REGION_HALF } from './island';
import { PALETTE } from './palette';
import { blockTexture } from './textures';
import { applyCloudShadows } from './clouds';
import { dayState } from './daynight';

// voxel sea: one flat sheet per water cell, lying on the waterline, with the
// depth carried by colour and by opacity rather than by a column of water.
// The seabed underneath is voxel terrain like everything else, so the terraced
// depth steps are still there to be seen through the shallows. Colours come
// from a quantised port of the original TSL shader - the depth ramp and the
// sun sparkles - all snapped to whole cells and to a 10 fps clock so the
// animation moves on GBA frames instead of sliding smoothly.
//
// There is no foam. The original shader drew rings of white surf travelling
// in from every direction, and it is not here any more: with the water
// translucent, a flat white sheet lying on top of a window is the one thing
// that cannot read as water.
const HALF = 110; // water grid half-extent, past the island and out to the fog
const N = (HALF * 2) / VOXEL;
// must track the island's MIN_LEVEL: the water floor has to sit at the same
// world depth as the seabed it covers, or the shallows come out wrong.
const MIN_LEVEL = -6;

const hs = (i: number, j: number, s = 0): number => {
  const x = Math.sin(i * 127.1 + j * 311.7 + s * 74.7) * 43758.5453;
  return x - Math.floor(x);
};
const vn = (x: number, y: number, s = 0): number => {
  const i = Math.floor(x), j = Math.floor(y);
  let fx = x - i, fy = y - j;
  fx *= fx * (3 - 2 * fx);
  fy *= fy * (3 - 2 * fy);
  const a = hs(i, j, s), b = hs(i + 1, j, s), c = hs(i, j + 1, s), d = hs(i + 1, j + 1, s);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
};

const RAMP = PALETTE.water.map((h) => new THREE.Color().setHex(h, THREE.SRGBColorSpace));

// Sun glint. A pale sea-green rather than a pure white: glinting water is not
// the same as surf, and tinting it keeps the sparkle from reading as a
// blown-out highlight when the bloom pass picks it up.
const GLINT = new THREE.Color().setHex(0xd8f2ea, THREE.SRGBColorSpace);
// How hard a glint pushes past its own colour at the top of its twinkle. This
// is what gives the bloom pass something to separate.
//
// It is far higher than it looks like it should be, and it used to be 0.5. That
// was tuned when the scene had no tone mapping and every other surface sat well
// under 1.0, so water was the only HDR source in the frame and a small push was
// enough to clear the threshold. Now that the whole scene is lit properly and
// tone mapped, water's own albedo is dark - the deep end of the ramp is around
// 0.05 linear - so the glint has to be driven several times brighter than its
// own colour before it reaches the bloom's high-pass at all.
//
// Driving it that far is safe now for the same reason: the highlight rolls off
// through the tone curve instead of clipping at 1.0. Under the old pipeline a
// push this size produced flat white discs.
// Peak emission lands the glint's brightest channel around 1.3 linear, which is
// just over the bloom threshold in main.ts. Sitting below it is worse than
// either extreme: the band still reads as a bright patch on screen, but without
// the glow that makes it legible as a reflection of the sun rather than as a
// flat white hole in the sea.
const GLINT_EMIT = 1.7;
// Fraction of the way toward GLINT at the peak of a twinkle.
const GLINT_MIX = 0.62;

// The glitter path's axis on the water plane.
//
// A specular highlight is not scattered sparkle - it is a band of light
// running from the viewer out toward the sun's mirror image, because that is
// the only stretch of water where a wave crest can line up and bounce light
// straight back. The previous version sprinkled glints uniformly over the sea
// with a noise threshold, which is why it read as random patches changing
// colour instead of as a reflection.
//
// This is H = normalize(V + S) projected onto y=0, where V is the direction
// from the water to the camera and S the direction to the sun.
//
// It used to be a hardcoded literal, (0.75, 0.661), derived by hand for a sun
// at (60, 80, 40) - with a comment warning that moving the sun would silently
// leave the reflection in the wrong place. The sun then moved to a cross-axis
// azimuth so its shadows would fall across the view instead of hiding behind
// their own casters, which invalidated the literal.
//
// Now that the sun travels, no fixed value can be right: the axis is re-solved
// from the current key light every update. S is `dayState.keyDir`, which is
// whichever of the sun and the moon is currently the brighter key, so the
// band follows the light that is actually making the sparkle rather than
// following the sun after it has gone down.
//
// V is the direction from the water up to the camera. The rig is a fixed
// (+1, +1, +1) offset, and only the direction matters for a reflection, so the
// ISO_OFFSET magnitude is irrelevant here.
const GLITTER_AXIS = { x: 0, z: 1 };
// Unit vector across the path, so distance from the band is measured
// perpendicular to it rather than along world axes.
const GLITTER_ACROSS = { x: 0, z: 1 };

// How far from the path's centreline a cell can be and still glint at all.
// The falloff past this is smooth, so the band has soft edges like a real
// reflection instead of a hard-edged stripe.
const GLINT_BAND = 30;
// How sharply the band concentrates on its centreline. The falloff is raised
// to a power rather than left linear: linear leaves the outer half of the band
// nearly as bright as the middle, which flattens the reflection into a broad
// wash instead of a bright path with dimmer shoulders.
const GLINT_FALLOFF = 2.2;

// The band is offset out into open water rather than running through the world
// origin.
//
// The island sits at the origin, so a band through (0,0) puts its brightest core
// underneath the land where no water is visible at all, and leaves the open sea -
// the only place the reflection can actually be seen - out at the band's dim
// edges. Offsetting the core gets it onto water the camera actually looks across.
// Measured before the original move, mean brightness was flat at ~0.14 in every
// band from 0-8 out to 40-48 units, i.e. no centre peak at all.
//
// How far out into open water the band's centreline sits, measured
// perpendicular to GLITTER_AXIS. Written as a distance along GLITTER_ACROSS
// rather than as a hand-picked (x, z), because that is the coordinate the
// shader actually measures in - see `across` in updateWater.
//
// Only `GLINT_ORIGIN . GLITTER_ACROSS` reaches the shader; the component along
// the axis is irrelevant to where the line falls. So the point is built by
// walking GLINT_BAND_DIST straight out along GLITTER_ACROSS, which keeps the
// band's distance from the island independent of the axis direction. A
// hardcoded (x, z) here is what silently breaks whenever the sun moves.
//
// 9 units was carried over from the old hand-tuned literal, where it put the
// core just clear of the island's south-east shore.
const GLINT_BAND_DIST = 9;
const GLINT_ORIGIN = { x: 0, z: 0 };

const _v = new THREE.Vector3();
const _h = new THREE.Vector3();

// ---------------------------------------------------------------- opacity
//
// How see-through a water block is, decided by how deep its floor is.
//
// This is the whole of the sea's transparency, and it is per block rather than
// per material because that is the only way a depth-graded sea can exist in a
// single draw call: the shallow water over the shelf is a window onto the
// sand, and the deep water six blocks down is not.
//
// The numbers are read off the shelf rather than picked. The seabed steps down
// one block at a time from the waterline, so a block's depth IS how many
// voxels of water sit between it and the sand - one block of water over the
// first step, six over the last. At the shallowest the water is a little over
// four tenths opaque and the sand under it reads clearly; by the time the
// floor is three blocks down the water is two thirds opaque and the bottom is
// only a shape under it; at six it is solid.
//
// The last step is the important one. Deep water being fully opaque is what
// stops the sea from turning into a window onto the rock six units down, and
// it is also what hides the seam where the seabed stops existing - past the
// island's own grid there is no floor to see, only the far ocean plane.
//
// The step is 0.116 for exactly that reason: it lands the deepest water on
// 1.0 exactly rather than 0.995, because 0.5% of the far side of that seam
// showing through is 0.5% of a hard edge that should not exist.
const ALPHA_SHALLOW = 0.42;
const ALPHA_PER_BLOCK = 0.116;

function depthAlpha(depth: number): number {
  return THREE.MathUtils.clamp(
    ALPHA_SHALLOW + (depth - 1) * ALPHA_PER_BLOCK,
    ALPHA_SHALLOW,
    1
  );
}

/**
 * Re-solve the reflection geometry for the light that is currently the key.
 *
 * Degenerate only when the light is exactly opposite the camera's azimuth, in
 * which case there is no specular path on the water at all and the fallback
 * axis keeps the band pointing somewhere harmless.
 */
function aimGlitter(): void {
  _v.set(1, 1, 1).normalize();
  _h.copy(_v).add(dayState.keyDir);
  _h.y = 0;
  if (_h.lengthSq() < 1e-6) {
    GLITTER_AXIS.x = 0;
    GLITTER_AXIS.z = 1;
  } else {
    _h.normalize();
    GLITTER_AXIS.x = _h.x;
    GLITTER_AXIS.z = _h.z;
  }
  GLITTER_ACROSS.x = -GLITTER_AXIS.z;
  GLITTER_ACROSS.z = GLITTER_AXIS.x;
  GLINT_ORIGIN.x = GLITTER_ACROSS.x * GLINT_BAND_DIST;
  GLINT_ORIGIN.z = GLITTER_ACROSS.z * GLINT_BAND_DIST;
}

interface WaterCell {
  x: number;
  z: number;
  depth: number;
  w: number;
  i: number;
  j: number;
}

let mesh: THREE.InstancedMesh;
let cells: WaterCell[] = [];
let lastFrame = -1;

/**
 * The far ocean: a square frame of water with the island's own grid cut out
 * of the middle.
 *
 * The hole is REGION_HALF, the edge of the voxelised terrain, so the frame
 * begins exactly where the seabed stops existing. Inside the hole the real
 * seabed is what you see through the translucent water; outside it, the frame
 * is the flat deep ocean that keeps the world from ending in a void.
 *
 * The UVs of a ShapeGeometry are the shape's own coordinates, which here are
 * world units. The ripple texture therefore tiles once per world unit on its
 * own, with no repeat set - the same scale as the water blocks.
 *
 * The shape is left in its own XY plane and laid flat by the mesh's rotation,
 * the same way the plane it replaced was.
 */
function oceanGeometry(): THREE.BufferGeometry {
  const OUTER = 350;
  const shape = new THREE.Shape();
  shape.moveTo(-OUTER, -OUTER);
  shape.lineTo(OUTER, -OUTER);
  shape.lineTo(OUTER, OUTER);
  shape.lineTo(-OUTER, OUTER);
  shape.closePath();

  const hole = new THREE.Path();
  const h = REGION_HALF;
  hole.moveTo(-h, -h);
  hole.lineTo(-h, h);
  hole.lineTo(h, h);
  hole.lineTo(h, -h);
  hole.closePath();
  shape.holes.push(hole);

  return new THREE.ShapeGeometry(shape);
}

/**
 * The far ocean's material.
 *
 * The ripple texture cannot be handed to three as a plain `map`: a map
 * multiplies the colour by the texel, and this texture is a brightness
 * MULTIPLIER centred on its mid level rather than a colour, so a plain map
 * would halve the ocean's brightness. It is sampled here instead and centred
 * the same way the water blocks centre it, so the far sea and the near sea
 * are the same surface at the same brightness.
 */
function oceanMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: PALETTE.water[0],
    roughness: 0.2,
    metalness: 0,
    // The map slot is what binds the texture and declares the UV varying; the
    // chunk that would normally read it is replaced below.
    map: blockTexture('water'),
  });
  mat.customProgramCacheKey = () => 'ocean:ripple';
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `// The same ripple the water blocks carry, centred on its mid level rather
// than used as three's plain map multiply. A map multiplies the colour by the
// texel, and this texture is a brightness MULTIPLIER centred on its mid level
// rather than a colour, so a plain map would halve the ocean's brightness.
//
// The UVs are world units, so this tiles once per unit with no repeat to set.
diffuseColor.rgb *= 1.0 + (texture2D(map, vMapUv).r - 0.5) * 0.42;`
    );
  };
  return mat;
}

export function createWater(): { mesh: THREE.InstancedMesh; ocean: THREE.Mesh } {
  const max = N * N;
  // A flat sheet, one quad per water cell, lying on the waterline.
  //
  // It used to be a box per cell, stretched from the seabed up to the
  // waterline, so that the depth steps read as terraced blocks of water. That
  // was never actually visible: the far ocean plane sat half a voxel under the
  // waterline across the whole world, so everything below the waterline was
  // hidden and all you could see of each column was a sliver of its side.
  //
  // With the water transparent that stops working anyway. A volume of water
  // seen through a transparent surface shows its own internal walls - every
  // terrace step becomes a vertical pane of glass under the surface, and from
  // an isometric camera those panes cross the sea as diagonal bands that read
  // as artefacts rather than as depth.
  //
  // A sheet has none of that, and it does not need the volume: the terracing
  // is the SEABED's, and the seabed is already built out of voxel terraces
  // one block apart. Through clear water you can see them, which is what the
  // depth steps were always trying to say.
  //
  // It is also six times less geometry - two triangles a cell instead of
  // twelve - and every one of those triangles is now blended rather than
  // depth-tested away.
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  // Smooth and barely rough. Water is the one surface here that is genuinely
  // specular, and this is what gives the sea a real sun highlight instead of a
  // painted-on one: the directional light's reflection lobe lands as a band
  // across the whole plane of water, which is the same place the hand-placed
  // glint band in updateWater already draws. The two reinforce each other
  // rather than replacing one another - one is the physical highlight, the
  // other is the per-cell twinkle on top of it.
  //
  // `tex: 'water'` is what puts a surface on the sea: every water block
  // carries the same ripple texture the land blocks carry their own, tiled
  // once per voxel, so a block of water reads as a block of water rather than
  // as a coloured pane.
  //
  // `instAlpha` is what makes the sea a sea over a floor: each block's
  // opacity comes from its own depth, so the shallows are see-through and the
  // deep water is not.
  const mat = voxelMaterial({ rough: 0.14, tex: 'water', instAlpha: true });
  const topAttr = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
  topAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aTop', topAttr);
  // per-block opacity. Its own buffer, indexed by instance, like aTop.
  const alphaAttr = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
  alphaAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aAlpha', alphaAttr);
  mesh = new THREE.InstancedMesh(geo, mat, max);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
  mesh.frustumCulled = false;

  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  cells = [];
  let n = 0;

  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = (i - N / 2 + 0.5) * VOXEL;
      const z = (j - N / 2 + 0.5) * VOXEL;
      const level = levelAtWorld(x, z);
      const bottom = Math.max(MIN_LEVEL, level) * VOXEL;
      const depth = SEA_Y - bottom;
      if (depth <= 0) continue;

      cells.push({
        x, z, depth,
        // the shelf is now 6 blocks deep at most, not 7 world units of an
        // 8-unit seabed, so the ramp is scaled to the current floor
        w: THREE.MathUtils.clamp(1 - depth / 6, 0, 1),
        i, j,
      });

      // the sheet lies flat on the waterline. The depth of this cell is
      // carried by its colour and its opacity, not by a column of water.
      m.makeScale(VOXEL, 1, VOXEL);
      m.setPosition(x, SEA_Y, z);
      mesh.setMatrixAt(n, m);
      c.copy(RAMP[0]);
      mesh.setColorAt(n, c);
      topAttr.setXYZ(n, c.r, c.g, c.b);
      alphaAttr.setX(n, depthAlpha(depth));
      n++;
    }
  }
  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor!.needsUpdate = true;
  topAttr.needsUpdate = true;
  alphaAttr.needsUpdate = true;

  // flat deep ocean past the voxel grid so the horizon never shows a void.
  //
  // Lit, not Basic. This quad is most of the visible sea, and as a
  // MeshBasicMaterial it was one dead flat colour - a big untextured hole in an
  // otherwise shaded scene. Giving it a Standard material with water's
  // roughness lets the sun lay a specular band across the open sea and lets
  // the sky fill grade it, so it recedes into the fog the way the shallows do.
  //
  // IT HAS A HOLE IN IT, and that is the whole reason the seabed is visible
  // at all.
  //
  // It used to be a single 700x700 plane centred on the island, which meant it
  // sat UNDER THE ENTIRE ISLAND as well as under the open sea - a lid on the
  // world at y = -0.05, half a voxel below the waterline. Everything below it
  // was hidden: the seabed, the terraced steps under the shallows, the whole
  // underwater half of the scene. It did not show, because the water on top of
  // it was opaque, and the water was opaque because the floor was never
  // visible through it in the first place. The two facts propped each other
  // up.
  //
  // The hole is cut to the island's own grid - REGION_HALF, the edge of the
  // voxelised terrain - so that inside it the real seabed is what you see
  // through the water, and outside it the plane carries on as the flat deep
  // ocean it was always meant to be. The two meet at a point where the water
  // is fully opaque (see depthAlpha), so the seam cannot show.
  const ocean = new THREE.Mesh(
    oceanGeometry(),
    // Cloud shadows reach the open sea too. Without this the near water is
    // shaded by passing clouds and the far ocean past the voxel grid is not,
    // and the boundary between them is exactly where the pattern appears to
    // stop - which reads as the edge of the effect rather than as the edge of
    // the water.
    applyCloudShadows(oceanMaterial())
  );
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.y = SEA_Y - 0.05;

  lastFrame = -1;
  return { mesh, ocean };
}

const shadeColor = new THREE.Color();

export function updateWater(t: number): void {
  const frame = Math.floor(t * 10);
  if (frame === lastFrame) return;
  lastFrame = frame;
  const tf = frame / 10;

  const topAttr = mesh.geometry.getAttribute('aTop') as THREE.InstancedBufferAttribute;
  const alphaAttr = mesh.geometry.getAttribute('aAlpha') as THREE.InstancedBufferAttribute;

  // The reflection follows the key light, which moves with the day.
  aimGlitter();
  // How bright the sea is allowed to sparkle at all. Drawn from the cycle rather
  // than from the light rig, because the standard material's own specular lobe
  // already dims with the light: without this the hand-drawn glints would keep
  // burning at their authored brightness on a moonless sea, which is the one
  // thing a night frame must not do.
  const glint = dayState.glint;

  for (let k = 0; k < cells.length; k++) {
    const cell = cells[k];
    const w = cell.w;

    // hard-stepped depth ramp: no gradient anywhere, one flat colour per band
    let idx: number;
    if (w < 0.3) idx = 0;
    else if (w < 0.55) idx = 1;
    else if (w < 0.82) idx = 2;
    else if (w < 0.9) idx = 3;
    else idx = 4;
    shadeColor.copy(RAMP[idx]);

    // per-cell checker shade plus a slow shimmer, so still water has life
    const shade = ((cell.i + cell.j) % 2 ? 1.0 : 0.93) *
      (0.96 + 0.04 * hs(cell.i, cell.j, Math.floor(tf * 0.5)));
    shadeColor.multiplyScalar(shade);

    // NO FOAM.
    //
    // The surf is gone. There used to be two white effects here: rings of foam
    // travelling inward from every direction (the TSL wave phase, laced so it
    // broke into chunky cells) and a swash that brightened the crest right at
    // the waterline. Both painted the cell flat white, and with the water now
    // translucent they were the one thing in the sea that could not be
    // anything but a solid shape - a flat white sheet lying on top of a
    // window, which is the one combination that does not read as water.
    //
    // What the sea has instead is the depth ramp, the ripple texture and the
    // glint, and the sand under the shallows. The shore still reads: the water
    // gets paler as the bottom comes up, and the sand comes through it.

    // How opaque this block is: purely a function of the depth under it.
    alphaAttr.setX(k, depthAlpha(cell.depth));

    // Sun glint, drawn over the top of whatever the cell already is.
    //
    // Position in the band is measured along and across the glitter axis, so
    // the highlight forms a coherent band running out toward the sun rather
    // than a uniform sprinkle. Within the band, the crest noise is sampled
    // anisotropically - stretched ALONG the path - so the lit cells form
    // elongated streaks parallel to it. Round blobs scattered at random are
    // what made this read as patches rather than as a reflection.
    const along = cell.x * GLITTER_AXIS.x + cell.z * GLITTER_AXIS.z;
    const across = (cell.x - GLINT_ORIGIN.x) * GLITTER_ACROSS.x
                 + (cell.z - GLINT_ORIGIN.z) * GLITTER_ACROSS.z;
    const off = Math.abs(across) / GLINT_BAND;

    if (off < 1) {
      // smoothstep falloff, then a power on top so the band actually peaks on
      // its centreline instead of staying roughly flat across its whole width
      const bandT = 1 - off;
      const bandW = Math.pow(bandT * bandT * (3 - 2 * bandT), GLINT_FALLOFF);

      // crest mask, squashed along the path so lit cells streak out from it
      const crest = vn(along * 0.09, across * 0.34, 211);
      if (crest > 0.66) {
        // how hard this particular crest throws, before the twinkle
        const crestW = Math.min(1, (crest - 0.66) / 0.34);

        // per-cell phase, so adjacent glints never pulse together
        const phase = hs(cell.i, cell.j, 223);
        const tw = Math.abs(((tf * 1.6 + phase) % 1) * 2 - 1);

        const amt = bandW * crestW * tw * GLINT_MIX * glint;
        shadeColor.lerp(GLINT, amt);
        // only the brightest cores are driven past 1.0, and only a little
        shadeColor.multiplyScalar(1 + amt * GLINT_EMIT);
      }
    }
    mesh.setColorAt(k, shadeColor);
    topAttr.setXYZ(k, shadeColor.r, shadeColor.g, shadeColor.b);
  }
  mesh.instanceColor!.needsUpdate = true;
  topAttr.needsUpdate = true;
  alphaAttr.needsUpdate = true;
}