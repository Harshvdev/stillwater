import * as THREE from 'three';

let frustum = 44;
const MIN_FRUSTUM = 12;
const MAX_FRUSTUM = 60;
let targetFrustum = 44;

// rendered buffer size, so the camera can snap to whole output pixels
let renderW = 1;
let renderH = 1;

// The camera rig uses a fixed offset on all three axes (+30, +30, +30) and looks
// back along (-1, -1, -1) to form an isometric projection.
// It rides the target's height as well as its ground position.

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
  const anchor = new THREE.Vector3(target.x, target.y + AIM_UP, target.z);
  const desired = anchor.clone().addScalar(ISO_OFFSET);
  cam.position.lerp(desired, 0.12);

  frustum += (targetFrustum - frustum) * 0.12;
  frustum = Math.round(frustum * 4) / 4;
  applyFrustum(cam);

  cam.lookAt(
    cam.position.x - ISO_OFFSET,
    cam.position.y - ISO_OFFSET,
    cam.position.z - ISO_OFFSET
  );
}

export function resizeCamera(cam: THREE.OrthographicCamera): void {
  applyFrustum(cam);
}

export function snapToPixelGrid(
  _cam: THREE.OrthographicCamera, object: THREE.Object3D, _worldPos: THREE.Vector3
): void {
  object.position.set(0, 0, 0);
}
