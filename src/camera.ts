import * as THREE from 'three';

let frustum = 44;
const MIN_FRUSTUM = 12;
const MAX_FRUSTUM = 60;
let targetFrustum = 44;

// rendered buffer size, so the camera can snap to whole output pixels
let renderW = 1;
let renderH = 1;

// The rig's own basis in world space. The camera sits at +30,+30,+30 relative
// to its target and looks back along (-1,-1,-1), so these are exactly three's
// camera axes:
//
//   screen right  = ( 1, 0,-1) / sqrt(2)
//   screen up     = (-1, 2,-1) / sqrt(6)
//   camera +z     = ( 1, 1, 1) / sqrt(3)
//
// The snap has to be done in THIS basis. It used to be done along two
// horizontal world axes, RIGHT (1,0,-1) and BACK (1,0,1), on the assumption
// those were the screen axes. The first one is; the second is not - the real
// screen-up axis is (-1,2,-1)/sqrt(6), which carries a Y component that no
// horizontal direction can reach. So the old snap constrained x and z only and
// let the vertical screen position ride through untouched.
//
// Worse, it snapped the offset from the *target*, which is near-constant once
// the lerp has settled. Quantising a constant to a constant cancels nothing,
// so the camera still slid a fraction of a pixel per frame and every edge in
// the frame crawled while walking. Standing still hid it, because a stationary
// image cannot shimmer.
const SR = new THREE.Vector3(1, 0, -1).normalize();
const SU = new THREE.Vector3(-1, 2, -1).normalize();
// The third axis. Depth along it is the one component an orthographic camera
// cannot show - sliding the rig along it moves nothing on screen - so it is
// left unsnapped on purpose, which keeps the rig at its intended distance.
const SD = new THREE.Vector3(1, 1, 1).normalize();

// The iso rig is this fixed offset on all three axes, and it rides the target's
// height as well as its ground position.
//
// The height is the whole point. The rig used to be pinned at y=30 and aimed at
// a hardcoded y=0, which left the player's own height sitting as a fixed offset
// above the aim point. That offset is constant in world units, but the visible
// height is not - it is `frustum`. So the further you zoomed in, the further up
// the frame the player drifted, ending up near the top edge on a full zoom. A
// constant world offset only stays constant on screen if the frame never
// changes size, and the frame is exactly what zooming changes.
//
// Aiming at the target fixes it at every zoom level. The rig rises with the
// player rather than tilting to track them, which is what keeps the view
// direction exactly (-1, -1, -1): aiming at a moving height from a fixed-height
// camera would instead swing the iso angle by several degrees every time the
// player walked over a hill, and the projection would visibly wobble.
const ISO_OFFSET = 30;

// The player's origin is at the feet, and that is the point the camera frames.
// The figure is about 1.8 tall, so it reads as standing in the middle of the
// frame with its boots on the centre line - the feet are the anchor because
// they are what the terrain is measured against, and because a fixed lift here
// would only re-introduce a zoom-dependent offset of exactly the kind this rig
// exists to avoid. Keep it at 0.
const AIM_UP = 0;

export function setRenderSize(w: number, h: number): void {
  renderW = Math.max(1, w);
  renderH = Math.max(1, h);
}

export function createCamera(): THREE.OrthographicCamera {
  // the buffer's aspect, not the window's: the two differ whenever the window
  // size is not an exact multiple of SCALE, and using the window's here would
  // stretch the projection to fit a buffer that is a fraction of a pixel
  // narrower than the window, which desynchronises the pixel grid below
  const aspect = renderW / renderH;
  const cam = new THREE.OrthographicCamera(
    (-frustum * aspect) / 2, (frustum * aspect) / 2, frustum / 2, -frustum / 2, 0.1, 600
  );
  cam.position.set(30, 30, 30);
  cam.lookAt(0, 0, 0);
  (window as unknown as { __setFrustum?: (v: number) => void }).__setFrustum = (v: number) => {
    targetFrustum = v;
  };
  window.addEventListener('wheel', (e) => {
    targetFrustum = THREE.MathUtils.clamp(
      targetFrustum * (1 + Math.sign(e.deltaY) * 0.1), MIN_FRUSTUM, MAX_FRUSTUM
    );
  }, { passive: true });
  return cam;
}

function applyFrustum(cam: THREE.OrthographicCamera): void {
  const aspect = renderW / renderH;
  cam.left = (-frustum * aspect) / 2;
  cam.right = (frustum * aspect) / 2;
  cam.top = frustum / 2;
  cam.bottom = -frustum / 2;
  cam.updateProjectionMatrix();
}

export function updateCamera(cam: THREE.OrthographicCamera, target: THREE.Vector3): void {
  // the point the camera is built around: the target, lifted by AIM_UP (which
  // is 0, so this is the player's feet). Both the desired position and the snap
  // anchor derive from it, so the aim point cannot drift from what it aims at.
  const anchor = new THREE.Vector3(target.x, target.y + AIM_UP, target.z);
  const desired = anchor.clone().addScalar(ISO_OFFSET);
  cam.position.lerp(desired, 0.08);

  // quantise zoom so world-per-pixel only changes on a deliberate step,
  // otherwise panning would rescale every pixel mid-scroll
  frustum += (targetFrustum - frustum) * 0.12;
  frustum = Math.round(frustum * 4) / 4;
  applyFrustum(cam);

  // Snap the rig to whole rendered pixels IN SCREEN SPACE, and snap the camera
  // position itself rather than its offset from the target. Snapping the offset
  // was the original bug: the offset settles to a constant, so quantising it
  // does nothing and the player-driven translation underneath it stays
  // sub-pixel.
  //
  // One wpp covers both axes. It has to: the horizontal extent is
  // frustum*aspect over renderW pixels and the vertical is frustum over
  // renderH, and with aspect = renderW/renderH both reduce to frustum/renderH.
  // Using the window's aspect here (as this used to) made the two differ, so a
  // single wpp could not have been correct on both axes at once.
  const wpp = frustum / renderH;

  // Decompose the settled position into the rig's screen basis...
  //
  // Snapped against the WORLD, not against the follow target. The world is
  // static, so pinning the camera to the world's pixel grid is what holds every
  // terrain edge rock still; anchoring the grid to the moving target instead
  // would let the whole scene creep a fraction of a pixel per frame, which is
  // the original shimmer all over again.
  //
  // The player's own pixel snap (snapToPixelGrid) uses this same world grid,
  // which is what keeps the two consistent - see the note there.
  const u = Math.round(cam.position.dot(SR) / wpp) * wpp;
  const v = Math.round(cam.position.dot(SU) / wpp) * wpp;
  // ...and leave depth alone: orthographic projection cannot show it, so
  // snapping it would only add jitter to the rig's distance for no gain.
  const depth = cam.position.dot(SD);

  // Rebuild from the snapped pair. SR/SU/SD are orthonormal, so this is an exact
  // round trip on the unsnapped position and a pure translation once snapped.
  cam.position
    .set(0, 0, 0)
    .addScaledVector(SR, u)
    .addScaledVector(SU, v)
    .addScaledVector(SD, depth);

  // Derived from the snapped position rather than aimed at the target directly.
  // Both give the target at frame centre, but this one keeps the view
  // direction a pure translation of the rig, which is what lets the pixel snap
  // above stay a snap. Looking straight at the target would instead rotate the
  // camera by the rounding error, breaking the pixel grid it exists to protect.
  cam.lookAt(
    cam.position.x - ISO_OFFSET,
    cam.position.y - ISO_OFFSET,
    cam.position.z - ISO_OFFSET
  );
}

export function resizeCamera(cam: THREE.OrthographicCamera): void {
  applyFrustum(cam);
}
