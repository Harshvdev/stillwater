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
  const desired = new THREE.Vector3(target.x + 30, 30, target.z + 30);
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
  const anchor = new THREE.Vector3(target.x, 30, target.z);
  const rel = cam.position.clone().sub(anchor);
  const u = Math.round(rel.dot(RIGHT) / wpp) * wpp;
  const v = Math.round(rel.dot(BACK) / wpp) * wpp;
  cam.position.copy(anchor).addScaledVector(RIGHT, u).addScaledVector(BACK, v);

  cam.lookAt(cam.position.x - 30, 0, cam.position.z - 30);
}

export function resizeCamera(cam: THREE.OrthographicCamera): void {
  applyFrustum(cam);
}