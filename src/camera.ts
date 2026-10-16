import * as THREE from 'three';

let frustum = 44;
const MIN_FRUSTUM = 12;
const MAX_FRUSTUM = 60;
let targetFrustum = 44;

// rendered buffer size, so the camera can snap to whole output pixels
let renderW = 1;
let renderH = 1;

// camera basis for the fixed (30, 30, 30) iso offset: screen right and
// screen "up the screen", used to snap position in screen space
const RIGHT = new THREE.Vector3(1, 0, -1).normalize();
const BACK = new THREE.Vector3(1, 0, 1).normalize();

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
  const aspect = window.innerWidth / window.innerHeight;
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
  const aspect = window.innerWidth / window.innerHeight;
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

  // snap the offset from the follow target to whole rendered pixels in screen
  // space; the iso view direction is fixed, so this is a pure translation and
  // the pixel grid never shimmers as the camera pans
  const wpp = frustum / renderH;
  const rel = cam.position.clone().sub(anchor);
  const u = Math.round(rel.dot(RIGHT) / wpp) * wpp;
  const v = Math.round(rel.dot(BACK) / wpp) * wpp;
  cam.position.copy(anchor).addScaledVector(RIGHT, u).addScaledVector(BACK, v);
  // RIGHT and BACK are both horizontal, so the snap can only correct x and z.
  // `copy(anchor)` has just overwritten y with the aim height though, which
  // silently drops the vertical ISO_OFFSET that `desired` put there - the camera
  // ends up level with the player and the iso view collapses to a top-down
  // angle. The vertical offset is exact and never needed snapping to the pixel
  // grid, so it is simply added back.
  cam.position.y += ISO_OFFSET;

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