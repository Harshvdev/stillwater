import { TAU, clamp } from './math.js';
import { WH, ET } from './constants.js';
import { state } from './game-state.js';
import { player } from './world.js';
import { TEX } from './sprites.js';

export let playerCanvas = null;
export let playerCtx = null;
export let playerTexture = null;

// Player Character Animation & Eye State
const pState = {
  // Facing & Movement
  faceX: 0,
  faceY: 0,
  targetFaceX: 0,
  targetFaceY: 0,
  lastFacingX: 0,
  lastFacingY: 1.5, // Default gentle forward facing

  // Looking around (Idle & wandering glances)
  gazeTimer: 2.0,
  gazeX: 0,
  gazeY: 0,
  targetGazeX: 0,
  targetGazeY: 0,

  // Blinking logic
  blinkTimer: 2.8,
  isBlinking: false,
  blinkProgress: 0,
  blinkDuration: 0.14,
  doubleBlinkPending: false,

  // Motion & Expression
  walkTimer: 0,
  idleTimer: 0,
  bounceY: 0,
  squashX: 1,
  squashY: 1
};

export function initPlayerCharacter() {
  playerCanvas = document.createElement('canvas');
  playerCanvas.width = 64;
  playerCanvas.height = 64;
  playerCtx = playerCanvas.getContext('2d');

  playerTexture = PIXI.Texture.from(playerCanvas, {
    scaleMode: PIXI.SCALE_MODES.LINEAR,
    resolution: 1
  });

  TEX.player = playerTexture;
  TEX.playerW = playerTexture;

  drawPlayerCanvas();
}

export function updatePlayerCharacter(dt) {
  if (!player) return;

  const vx = player.data ? player.data.vx || 0 : 0;
  const vy = player.data ? player.data.vy || 0 : 0;
  const sp = Math.hypot(vx, vy);

  // 1. Facing Direction based on movement direction (NO mouse tracking)
  // Convert grid movement (vx, vy) to isometric screen direction:
  // Screen X: vx - vy
  // Screen Y: (vx + vy) * 0.5
  if (sp > 0.15) {
    const screenDx = vx - vy;
    const screenDy = (vx + vy) * 0.5;
    const len = Math.hypot(screenDx, screenDy) || 1;

    // Shift eyes on sphere (max shift: ~5.5px horizontally, ~3.5px vertically)
    pState.targetFaceX = (screenDx / len) * 5.5;
    pState.targetFaceY = (screenDy / len) * 3.5;
    pState.lastFacingX = pState.targetFaceX;
    pState.lastFacingY = pState.targetFaceY;
  } else {
    // When stationary, keep last walked facing direction
    pState.targetFaceX = pState.lastFacingX;
    pState.targetFaceY = pState.lastFacingY;
  }

  // Smooth lerp facing direction
  pState.faceX += (pState.targetFaceX - pState.faceX) * Math.min(1, dt * 10);
  pState.faceY += (pState.targetFaceY - pState.faceY) * Math.min(1, dt * 10);

  // 2. Looking around ("look here and there sometimes")
  pState.gazeTimer -= dt;
  if (pState.gazeTimer <= 0) {
    pState.gazeTimer = 1.6 + Math.random() * 2.8;

    // Random glance offset relative to facing direction
    if (Math.random() < 0.35) {
      pState.targetGazeX = 0;
      pState.targetGazeY = 0;
    } else {
      pState.targetGazeX = (Math.random() - 0.5) * 3.6;
      pState.targetGazeY = (Math.random() - 0.5) * 2.4;
    }
  }

  // Smooth lerp glance
  pState.gazeX += (pState.targetGazeX - pState.gazeX) * Math.min(1, dt * 8);
  pState.gazeY += (pState.targetGazeY - pState.gazeY) * Math.min(1, dt * 8);

  // 3. Blinking logic
  if (pState.isBlinking) {
    pState.blinkProgress += dt / pState.blinkDuration;
    if (pState.blinkProgress >= 1) {
      pState.blinkProgress = 0;
      pState.isBlinking = false;

      if (pState.doubleBlinkPending) {
        pState.doubleBlinkPending = false;
        pState.blinkTimer = 0.08; // Quick second blink
      } else {
        pState.blinkTimer = 2.2 + Math.random() * 3.8;
      }
    }
  } else {
    pState.blinkTimer -= dt;
    if (pState.blinkTimer <= 0) {
      pState.isBlinking = true;
      pState.blinkProgress = 0;
      pState.blinkDuration = 0.12 + Math.random() * 0.04;
      pState.doubleBlinkPending = Math.random() < 0.25;
    }
  }

  // 4. Motion / Walk / Idle Animations
  if (sp > 0.2) {
    pState.walkTimer += dt * sp * 4.5;
    pState.bounceY = Math.abs(Math.sin(pState.walkTimer)) * -2.2;
    pState.squashX = 1 + Math.sin(pState.walkTimer * 2) * 0.04;
    pState.squashY = 1 - Math.sin(pState.walkTimer * 2) * 0.04;
  } else {
    pState.idleTimer += dt * 2.0;
    pState.bounceY = Math.sin(pState.idleTimer) * 0.7;
    pState.squashX = 1;
    pState.squashY = 1;
  }

  drawPlayerCanvas();
  if (playerTexture) {
    playerTexture.update();
  }
}

export function drawPlayerCanvas() {
  if (!playerCtx) return;
  const ctx = playerCtx;
  ctx.clearRect(0, 0, 64, 64);

  const cx = 32;
  const cy = 40 + pState.bounceY;
  const radius = 16;

  // --- 1. Soft Ground Shadow ---
  ctx.save();
  ctx.fillStyle = 'rgba(12, 20, 16, 0.28)';
  ctx.beginPath();
  ctx.ellipse(32, 57, 14 * pState.squashX, 4.5 * pState.squashY, 0, 0, TAU);
  ctx.fill();
  ctx.restore();

  // --- 2. Cute Warm Body Sphere (Soft Butter-Cream / Warm Honey-Ivory) ---
  ctx.save();

  // Apply squash & stretch around sphere center
  ctx.translate(cx, cy);
  ctx.scale(pState.squashX, pState.squashY);
  ctx.translate(-cx, -cy);

  // Radial gradient for warm, adorable cozy body
  const grad = ctx.createRadialGradient(
    cx - radius * 0.35,
    cy - radius * 0.35,
    1,
    cx,
    cy,
    radius
  );
  grad.addColorStop(0, '#fffaf0');    // Soft warm highlight
  grad.addColorStop(0.40, '#f9edd6');  // Cute butter-cream main body
  grad.addColorStop(0.78, '#e6d0a7');  // Warm soft shadow transition
  grad.addColorStop(1.0, '#cfb383');   // Soft ambient rim shadow

  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, TAU);
  ctx.fill();

  // Soft warm inner rim definition
  ctx.strokeStyle = 'rgba(180, 150, 110, 0.22)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // --- 3. Eyes Rendering (Solid, Thick, Simple Vertical Rectangles, No Sclera Illusion) ---
  const totalOffsetX = clamp(pState.faceX + pState.gazeX, -9, 9);
  const totalOffsetY = clamp(pState.faceY + pState.gazeY, -6, 5);

  // 3D sphere back-facing check:
  // When character moves/faces upward (totalOffsetY < -0.8), face turns to the back of the sphere
  let faceAlpha = 1.0;
  if (totalOffsetY < -0.8) {
    faceAlpha = clamp(1.0 - (-0.8 - totalOffsetY) / 1.4, 0, 1);
  }

  if (faceAlpha <= 0.01) {
    ctx.restore();
    return;
  }

  ctx.globalAlpha = faceAlpha;

  const isSinging = typeof state !== 'undefined' && state && (state.gt - state.lastSing < 1.8);

  const baseEyeDist = 5.8; // Distance apart
  const baseEyeW = 3.8;   // Thick solid vertical rectangle
  const baseEyeH = 7.0;   // Vertically elongated
  const cornerRadius = 1.2; // Slightly rounded rectangle

  // Blinking factor (1 -> 0 -> 1)
  let eyeHFactor = 1;
  if (pState.isBlinking) {
    const b = Math.sin(pState.blinkProgress * Math.PI);
    eyeHFactor = Math.max(0.08, 1 - b);
  }

  const faceCenterY = cy + 0.5 + totalOffsetY; // Cute low eye placement

  // Solid, clean dark charcoal color with zero shadow blur (no sclera illusion!)
  ctx.fillStyle = '#1a1715';
  ctx.strokeStyle = '#1a1715';

  for (let side of [-1, 1]) {
    const eyeRelX = totalOffsetX + side * baseEyeDist;
    const eyeX = cx + eyeRelX;
    const eyeY = faceCenterY;

    // 3D Sphere foreshortening factor z
    const normX = eyeRelX / radius;
    const z = Math.sqrt(Math.max(0, 1 - normX * normX));

    if (z < 0.15) continue; // Hidden behind sphere curvature

    const eyeW = Math.max(1.4, baseEyeW * z);

    if (isSinging) {
      // Singing expression: Happy squints ^ ^
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      const arcR = 3.0 * z;
      ctx.arc(eyeX, eyeY + 1, arcR, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
    } else if (eyeHFactor < 0.28) {
      // Closed / Blinking eye (solid line)
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(eyeX - eyeW * 0.6, eyeY);
      ctx.lineTo(eyeX + eyeW * 0.6, eyeY);
      ctx.stroke();
    } else {
      // Solid, thick, vertical, rectangular eyes (no shadow blur, clean edges)
      const currentEyeH = baseEyeH * eyeHFactor;
      const rx = eyeW * 0.5;
      const ry = currentEyeH * 0.5;
      const r = Math.min(cornerRadius, rx, ry);

      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(eyeX - rx, eyeY - ry, eyeW, currentEyeH, [r]);
      } else {
        ctx.save();
        ctx.translate(eyeX, eyeY);
        ctx.scale(rx, ry);
        ctx.arc(0, 0, 1, 0, TAU);
        ctx.restore();
      }
      ctx.fill();
    }
  }

  ctx.restore();
}

export function getPlayerTexture() {
  return playerTexture;
}
