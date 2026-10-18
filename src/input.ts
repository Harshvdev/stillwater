const keys = new Set<string>();

export function initInput(): void {
  window.addEventListener('keydown', (e) => {
    // Space scrolls the page, and this page is one full-window canvas with
    // nothing to scroll - so without this the browser would treat half of every
    // jump as a scroll attempt.
    //
    // Prevented on every keydown including the auto-repeats, which matters
    // more now that holding Space is the normal way to jump: the repeats are
    // exactly what is being held down, and each one is another chance for the
    // page to jump.
    if (e.code === 'Space') e.preventDefault();
    keys.add(e.code);
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  // Clearing the set drops Space too, so a jump held when the window loses
  // focus is not still being held on the first frame after the user comes back
  // - which would read as the game hopping the player on its own.
  window.addEventListener('blur', () => keys.clear());
}

/**
 * Whether Space is currently held down.
 *
 * A held state rather than a one-shot press, so holding the key bounces the
 * player: player.ts jumps on every frame it finds the player back on the
 * ground, which lands the next hop the instant the previous one finishes. That
 * is why this is not an edge trigger any more - the earlier one-shot version
 * needed a `repeat` guard to stop the browser's auto-repeat firing dozens of
 * jumps a second, and that guard is exactly what made holding the key do
 * nothing after the first hop. Reading the live key state needs no such guard,
 * because the rate is bounded by the landing, not by the keyboard.
 */
export function isJumpHeld(): boolean {
  return keys.has('Space');
}

// returns movement intent in screen space: x right, y up
export function getMoveInput(): { x: number; y: number } {
  let x = 0;
  let y = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) y += 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) y -= 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
  const len = Math.hypot(x, y);
  if (len > 0) { x /= len; y /= len; }
  return { x, y };
}
