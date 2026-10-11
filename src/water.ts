import * as THREE from 'three';
import { VOXEL, SEA_Y, voxelMaterial, levelAtWorld } from './island';
import { PALETTE } from './palette';

// voxel sea: one column per water cell, stretched from the seabed up to the
// waterline so the depth steps read as terraced blocks. Colours come from a
// quantised port of the original TSL shader - depth ramp, marching foam rings,
// shore swash and sparkles - all snapped to whole cells and to a 10 fps clock
// so the animation moves on GBA frames instead of sliding smoothly.
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
const WHITE = new THREE.Color().setHex(PALETTE.foam, THREE.SRGBColorSpace);

// Sun glint. A pale sea-green rather than the pure foam white: glinting water
// is not the same as surf, and tinting it keeps the sparkle from reading as a
// blown-out highlight when the bloom pass picks it up.
const GLINT = new THREE.Color().setHex(0xd8f2ea, THREE.SRGBColorSpace);
// How hard a glint pushes past its own colour at the top of its twinkle. This
// is what gives the bloom pass something to separate, and it is small on
// purpose: the scene is otherwise entirely LDR, so without a deliberate
// overdrive the bloom has no highlights at all. At 1.6+ the brightest glints
// clipped to flat white discs.
const GLINT_EMIT = 0.5;
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
// from the water to the camera and S the direction to the sun. With the camera
// fixed at a (+1,+1,+1) iso offset and the sun at (60,80,40) that works out to
// roughly (0.75, 0, 0.66). That value is written out here rather than computed,
// so moving the sun or the camera does NOT move the reflection automatically -
// re-derive it and update this literal if either moves.
const GLITTER_AXIS = { x: 0.75, z: 0.661 };
// Unit vector across the path, so distance from the band is measured
// perpendicular to it rather than along world axes.
const GLITTER_ACROSS = { x: -GLITTER_AXIS.z, z: GLITTER_AXIS.x };

// How far from the path's centreline a cell can be and still glint at all.
// The falloff past this is smooth, so the band has soft edges like a real
// reflection instead of a hard-edged stripe.
const GLINT_BAND = 30;
// How sharply the band concentrates on its centreline. The falloff is raised
// to a power rather than left linear: linear leaves the outer half of the band
// nearly as bright as the middle, which flattens the reflection into a broad
// wash instead of a bright path with dimmer shoulders.
const GLINT_FALLOFF = 2.2;

// The band is centred here rather than on the world origin.
//
// The island sits at the origin, so a band through (0,0) puts its brightest
// core underneath the land where no water is visible at all, and leaves the
// open sea - the only place the reflection can actually be seen - out at the
// band's dim edges. This offset moves the core out into the water off the
// island's south-east side, which is the stretch of sea the camera looks
// across. Measured before the move, mean brightness was flat at ~0.14 in every
// band from 0-8 out to 40-48 units, i.e. no centre peak at all.
const GLINT_ORIGIN = { x: 34, z: 18 };

interface WaterCell {
  x: number;
  z: number;
  depth: number;
  w: number;
  r: number;
  nx: number;
  nz: number;
  i: number;
  j: number;
}

let mesh: THREE.InstancedMesh;
let cells: WaterCell[] = [];
let lastFrame = -1;

export function createWater(): { mesh: THREE.InstancedMesh; ocean: THREE.Mesh } {
  const max = N * N;
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = voxelMaterial();
  const topAttr = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
  topAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aTop', topAttr);
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

      const r = Math.hypot(x, z) + 0.001;
      cells.push({
        x, z, depth,
        // the shelf is now 6 blocks deep at most, not 7 world units of an
        // 8-unit seabed, so the ramp is scaled to the current floor
        w: THREE.MathUtils.clamp(1 - depth / 6, 0, 1),
        r,
        nx: x / r,
        nz: z / r,
        i, j,
      });

      m.makeScale(VOXEL, depth, VOXEL);
      m.setPosition(x, bottom + depth / 2, z);
      mesh.setMatrixAt(n, m);
      c.copy(RAMP[0]);
      mesh.setColorAt(n, c);
      topAttr.setXYZ(n, c.r, c.g, c.b);
      n++;
    }
  }
  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor!.needsUpdate = true;
  topAttr.needsUpdate = true;

  // flat deep ocean past the voxel grid so the horizon never shows a void
  const ocean = new THREE.Mesh(
    new THREE.PlaneGeometry(700, 700),
    new THREE.MeshBasicMaterial({ color: PALETTE.water[0] })
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

    // foam: rings travelling inward from all directions (the TSL wave phase)
    const wph = cell.r * 0.24 - tf * 1.15 + cell.nx * 2.0 + cell.nz * 1.2;
    const p = wph / 6.2831;
    const fi = p - Math.floor(p);
    const band = fi >= 0.05 && fi <= 0.28;
    // kept to the shallows: open water stays clean, so the rings read as surf
    const on = w > 0.45 && w < 0.94;
    // lace at roughly two wave widths, so foam breaks into chunky cells
    const lace = vn(cell.x * 0.085, cell.z * 0.085, 3) > 0.38;
    const foam = band && on && lace;

    // swash: crest brightening right at the waterline
    const swash = Math.sin(wph) > 0.8 && cell.depth < 1.8;

    if (foam || swash) {
      shadeColor.copy(WHITE);
    }

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

        const amt = bandW * crestW * tw * GLINT_MIX;
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
}