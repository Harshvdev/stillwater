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
  const cy = 38 + pState.bounceY;

  // Check if lantern should be lit/visible (Dusk or Night ONLY, disappears in daytime!)
  const isLampLit = typeof state !== 'undefined' && state && (state.nightF > 0.02 || state.dusk > 0.05);

  // --- 1. Soft Ground Shadow ---
  ctx.save();
  ctx.fillStyle = 'rgba(12, 18, 24, 0.32)';
  ctx.beginPath();
  ctx.ellipse(32, 57, 13 * pState.squashX, 4.2 * pState.squashY, 0, 0, TAU);
  ctx.fill();
  ctx.restore();

  // --- 2. Cloaked Traveler Silhouette (Cozy, Dark Slate-Indigo Cloak) ---
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(pState.squashX, pState.squashY);
  ctx.translate(-cx, -cy);

  // Main Cloak Silhouette Body (A-line trailing cloak from hood to ground)
  const cloakGrad = ctx.createLinearGradient(cx, cy - 22, cx, cy + 16);
  cloakGrad.addColorStop(0, '#2e3848');   // Top of hood / cowl
  cloakGrad.addColorStop(0.5, '#222b38'); // Mid cloak body
  cloakGrad.addColorStop(1, '#171e28');   // Lower cloak hem

  ctx.fillStyle = cloakGrad;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 22);
  ctx.bezierCurveTo(cx + 8, cy - 20, cx + 13, cy - 12, cx + 13, cy);
  ctx.bezierCurveTo(cx + 14, cy + 10, cx + 12, cy + 16, cx + 7, cy + 16);
  ctx.lineTo(cx - 7, cy + 16);
  ctx.bezierCurveTo(cx - 12, cy + 16, cx - 14, cy + 10, cx - 13, cy);
  ctx.bezierCurveTo(cx - 13, cy - 12, cx - 8, cy - 20, cx, cy - 22);
  ctx.closePath();
  ctx.fill();

  // Soft rim highlight on sunlit top of hood
  ctx.strokeStyle = 'rgba(165, 190, 215, 0.26)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Dark inner cloak fold shading
  ctx.fillStyle = 'rgba(14, 18, 25, 0.55)';
  ctx.beginPath();
  ctx.moveTo(cx - 2, cy - 6);
  ctx.lineTo(cx - 4, cy + 16);
  ctx.lineTo(cx + 1, cy + 16);
  ctx.lineTo(cx + 2, cy - 6);
  ctx.closePath();
  ctx.fill();

  // --- 3. Hood Recess & Tender Implied Face Smudge ---
  const faceCenterX = cx + pState.faceX * 0.6;
  const faceCenterY = cy - 12 + pState.faceY * 0.45;

  ctx.fillStyle = '#141822';
  ctx.beginPath();
  ctx.ellipse(faceCenterX, faceCenterY, 5.2, 5.8, 0, 0, TAU);
  ctx.fill();

  // Soft warm face smudge
  const faceSmudge = ctx.createRadialGradient(
    faceCenterX, faceCenterY, 0.4,
    faceCenterX, faceCenterY, 4.8
  );
  faceSmudge.addColorStop(0, 'rgba(255, 238, 190, 0.90)');
  faceSmudge.addColorStop(0.45, 'rgba(255, 195, 120, 0.55)');
  faceSmudge.addColorStop(1, 'rgba(220, 150, 70, 0)');

  ctx.fillStyle = faceSmudge;
  ctx.beginPath();
  ctx.ellipse(faceCenterX, faceCenterY, 4.8, 4.5, 0, 0, TAU);
  ctx.fill();

  // --- 4. Lantern (Disappears completely in Daytime!) ---
  if (isLampLit) {
    const lanternX = cx + 11 + pState.faceX * 0.3;
    const lanternY = cy + 2 + pState.bounceY * 0.4;

    // Soft warm golden light illuminated on traveler's cloak facing lantern
    const cloakLight = ctx.createRadialGradient(
      lanternX - 2, lanternY - 2, 2,
      cx + 4, cy + 2, 14
    );
    cloakLight.addColorStop(0, 'rgba(255, 205, 105, 0.52)');
    cloakLight.addColorStop(0.5, 'rgba(255, 160, 50, 0.25)');
    cloakLight.addColorStop(1, 'rgba(255, 120, 20, 0)');
    ctx.fillStyle = cloakLight;
    ctx.beginPath();
    ctx.ellipse(cx + 6, cy + 2, 6, 9, 0, 0, TAU);
    ctx.fill();

    // Fine chain connecting lantern to traveler's arm
    ctx.strokeStyle = '#3a2e22';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx + 7, cy - 2);
    ctx.lineTo(lanternX, lanternY - 4);
    ctx.stroke();

    // Dark antique brass frame base
    ctx.fillStyle = '#241c14';
    ctx.fillRect(lanternX - 2.5, lanternY - 3.5, 5, 7);

    // Glowing warm glass chamber
    ctx.fillStyle = '#ffd166';
    ctx.fillRect(lanternX - 1.8, lanternY - 2.8, 3.6, 5.6);

    // Flame core INSIDE the glass
    ctx.fillStyle = '#fff0a5';
    ctx.beginPath();
    ctx.ellipse(lanternX, lanternY - 0.2, 1.3, 2.0, 0, 0, TAU);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(lanternX, lanternY - 0.2, 0.7, 1.2, 0, 0, TAU);
    ctx.fill();

    // Antique brass cap
    ctx.fillStyle = '#32251a';
    ctx.beginPath();
    ctx.arc(lanternX, lanternY - 3.5, 2.5, Math.PI, TAU);
    ctx.fill();

    // Natural, tight glowing aura around the lantern glass
    const lampGlow = ctx.createRadialGradient(
      lanternX, lanternY - 0.2, 0.8,
      lanternX, lanternY - 0.2, 9.5
    );
    lampGlow.addColorStop(0, 'rgba(255, 255, 240, 0.95)');
    lampGlow.addColorStop(0.3, 'rgba(255, 210, 100, 0.68)');
    lampGlow.addColorStop(0.7, 'rgba(255, 150, 40, 0.28)');
    lampGlow.addColorStop(1, 'rgba(255, 100, 0, 0)');

    ctx.fillStyle = lampGlow;
    ctx.beginPath();
    ctx.arc(lanternX, lanternY - 0.2, 9.5, 0, TAU);
    ctx.fill();
  }

  ctx.restore();
}

export function getPlayerTexture() {
  return playerTexture;
}
