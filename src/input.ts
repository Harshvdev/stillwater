const keys = new Set<string>();

// Whether the movement keys are suspended.
//
// The backpack is a menu, and a menu takes the keyboard. With the backpack
// open, W would walk the player into the sea while they are trying to look
// at their collection - so the keys that move the player are read as
// released while it is up.
//
// This is a flag rather than a check at each use because the keys are read in
// three places - the movement input, the jump and the dive - and a menu that
// only swallowed one of them would be worse than none.
let suspended = false;

/** Suspend or resume the movement keys. */
export function setInputSuspended(on: boolean): void {
  suspended = on;
}

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
  return !suspended && keys.has('Space');
}

/**
 * Whether Shift is currently held down.
 *
 * Shift is the dive key: in water it takes the player down. The same key is
 * what Minecraft uses to sneak, and the same key is what a player will try
 * when they want to go under - so it is the obvious one to use, and it is the
 * one that does nothing anywhere else in this game.
 *
 * A held state, for the same reason Space is: the dive is continuous rather
 * than a press.
 */
export function isDiveHeld(): boolean {
  return !suspended && (keys.has('ShiftLeft') || keys.has('ShiftRight'));
}

// returns movement intent in screen space: x right, y up
export function getMoveInput(): { x: number; y: number } {
  if (suspended) return { x: 0, y: 0 };
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
