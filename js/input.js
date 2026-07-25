import { clamp } from './math.js';
import { view, mouse } from './game-state.js';
import { sing, actAt } from './actions.js';

export const keys = {};
export const ptrs = new Map();
export let touchAnchor = null;
export let touchVec = null;
export let pinch = null;

export function setupInput(appView) {
  window.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    if (e.code === 'Space') {
      e.preventDefault();
      sing();
    }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
      e.preventDefault();
    }
  });

  window.addEventListener('keyup', (e) => {
    keys[e.code] = false;
  });

  appView.addEventListener('contextmenu', (e) => e.preventDefault());

  appView.addEventListener('pointerdown', (e) => {
    appView.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (ptrs.size === 2) {
      const p = [...ptrs.values()];
      pinch = { d0: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y), s0: view.zt };
      touchAnchor = null;
      return;
    }

    if (e.pointerType === 'touch') {
      touchAnchor = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
      touchVec = null;
    } else {
      actAt(e.clientX, e.clientY);
    }
  });

  appView.addEventListener('pointermove', (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;

    if (ptrs.has(e.pointerId)) {
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    if (pinch && ptrs.size >= 2) {
      const p = [...ptrs.values()];
      const d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
      if (pinch.d0 > 0) view.zt = clamp((pinch.s0 * pinch.d0) / Math.max(d, 20), 0.6, 2.0);
      return;
    }

    if (touchAnchor) {
      const dx = e.clientX - touchAnchor.x;
      const dy = e.clientY - touchAnchor.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 12) {
        touchAnchor.moved = true;
        const m = Math.min(1, dist / 60);
        touchVec = { x: (dx / dist) * m, y: (dy / dist) * m };
      }
    }
  });

  function pend(e) {
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) pinch = null;
    if (touchAnchor) {
      if (!touchAnchor.moved && performance.now() - touchAnchor.t < 320) {
        actAt(e.clientX, e.clientY);
      }
      touchAnchor = null;
      touchVec = null;
    }
  }

  appView.addEventListener('pointerup', pend);
  appView.addEventListener('pointercancel', pend);

  appView.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      view.zt = clamp(view.zt * Math.exp(-e.deltaY * 0.0013), 0.6, 2.0);
    },
    { passive: false }
  );
}
