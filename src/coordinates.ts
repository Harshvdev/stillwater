import { VOXEL } from './island';

// Minecraft-style block coordinates, top left.
//
// VOXEL is 1, so a world unit already IS a block and the conversion below is a
// divide that happens to be a no-op today. It is written anyway so the readout
// cannot silently start lying if VOXEL ever goes back to being finer than a
// block - the numbers are always the block you are standing in, not the raw
// float position.
//
// Y is the one to look at first: the player group is anchored at the feet
// (player.ts builds the body upward from y=0 and drops the group onto the
// surface), so floor(y) is the block being stood in, exactly as Minecraft's F3
// reports it - not the head height.
//
// Read off the live player group, not the render holder: playerHolder carries a
// sub-pixel snap offset applied for the pixel grid (main.ts), and reading that
// would make the numbers jitter against the grid the rest of the world sits on.
let elX: HTMLElement | null = null;
let elY: HTMLElement | null = null;
let elZ: HTMLElement | null = null;

export function initCoordinates(): void {
  const style = document.createElement('style');
  style.textContent = `
    #coords {
      position: fixed; left: 10px; top: 10px; z-index: 10;
      /* block, not flex: the values are inline-blocks separated by commas, and
         a flex gap would space every comma as far apart as every number */
      display: block;
      /* dark, see-through, no border and no rounding: a HUD that sits on top of
         the game rather than a panel drawn next to it */
      background: rgba(0, 0, 0, 0.35);
      color: #fff;
      font: 600 13px/1.4 ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
      padding: 5px 9px;
      user-select: none;
      pointer-events: none;
      /* The black outline, done as a stroke painted UNDER the fill rather than as
         a text-shadow: a shadow only darkens the pixels behind the glyph and
         leaves the counter (the hole in a 0) open, so it smears at this size.
         The stroke closes the outline all the way round, which is what makes it
         legible over both the bright beach and the night sea.

         2px, not 3: at 13px a 3px stroke is 23% of the em, which eats the
         counter out of a digit and leaves the numbers reading as grey ghosts.
         2px closes the outline and leaves the fill intact. */
      -webkit-text-stroke: 2px #000;
      paint-order: stroke fill;
      text-shadow: none;
      /* hard edges on the glyphs, matching the nearest-neighbour canvas:
         otherwise the browser antialiases the numbers into smooth grey while
         every block in the scene stays crisp, and the readout reads as a
         different layer pasted over the game */
      -webkit-font-smoothing: none;
    }
    /* values right-aligned on a fixed column so the digits stop shuffling
       sideways as they change - which is what an unaligned readout does, and it
       reads as flicker. The commas sit outside the fixed-width boxes, so the
       gap after a one-digit value does not change as the numbers grow. */
    #coords .v { display: inline-block; min-width: 4ch; text-align: right; }
    #coords .sep { margin: 0 4px; }
  `;
  document.head.appendChild(style);

  const panel = document.createElement('div');
  panel.id = 'coords';
  // Numbers only, X then Y then Z, comma separated - the F3 position line with
  // the axis names dropped, since on a fixed isometric camera the order is
  // always the same and never has to be named.
  panel.innerHTML = `
    <span class="v" data-a="x"></span><span class="sep">,</span><span class="v" data-a="y"></span><span class="sep">,</span><span class="v" data-a="z"></span>
  `;
  document.body.appendChild(panel);

  elX = panel.querySelector('[data-a=x]') as HTMLElement;
  elY = panel.querySelector('[data-a=y]') as HTMLElement;
  elZ = panel.querySelector('[data-a=z]') as HTMLElement;
}

const write = (el: HTMLElement | null, v: number): void => {
  const s = String(v);
  if (el && el.textContent !== s) el.textContent = s;
};

/**
 * Mirror the player's block position onto the readout. Called from the frame
 * loop.
 *
 * Each axis is written only when it actually changes. Three textContent writes
 * a frame is not free - it dirties layout for the whole document every frame
 * even when the text is identical - and standing still is the common case.
 */
export function syncCoordinates(pos: { x: number; y: number; z: number }): void {
  if (!elX) return;
  write(elX, Math.floor(pos.x / VOXEL));
  write(elY, Math.floor(pos.y / VOXEL));
  write(elZ, Math.floor(pos.z / VOXEL));
}