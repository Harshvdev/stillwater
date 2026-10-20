import * as THREE from 'three';
import { PALETTE } from './palette';
import { grassMask, algaeMask, type GrassKind, type AlgaeKind } from './textures';
import { FLOWER_WHITE, FLOWER_YELLOW, FLOWER_PINK } from './island';
import { setInputSuspended } from './input';

/**
 * The inventory.
 *
 * A hotbar down the left of the screen and a backpack that opens on E.
 *
 * THERE IS NOTHING IN IT YET
 *
 * This world has no items. Nothing lies on the ground to be picked up and
 * nothing can be broken open, so there is no way to fill a slot and the
 * slots are empty. That is the state of the game, not a gap in the
 * interface: the panel is here, the slots are here, and the way a stack
 * moves between them is the way a stack moves in Minecraft.
 *
 * There is no collecting. Walking past a flower does not put it in your
 * hands, because there is no such mechanic in this world and inventing one
 * would be the interface claiming something the game does not do.
 *
 * THE ICONS ARE THE PLANTS
 *
 * The grass and the algae icons are the very masks the plants are drawn with,
 * so a silhouette in a slot is the silhouette in the world. The oak and the
 * flower have no mask - they are built out of cubes - so those two are
 * hand-drawn here in the same 16x16 idiom.
 *
 * IT LOOKS LIKE THE GAME, NOT LIKE A WEB PAGE
 *
 * The whole panel is built out of the game's own palette and drawn the way
 * the game is drawn: hard edges, no gradients, no rounded corners, no text.
 * The slots are recessed wells with a shadow on the inside of the top-left
 * and a highlight on the inside of the bottom-right, the panel is bevelled
 * the same way, and every edge is a whole number of pixels so nothing
 * softens at the window's own resolution.
 *
 * There is no lettering anywhere in it. The icons carry the meaning: a
 * picture of a plant is a plant, and a label under it would only be a
 * smaller version of the same thing.
 *
 * BUT THE MECHANIC IS MINECRAFT'S
 *
 * The look is this game's. The handling is not. Every rule about how an
 * item moves is Minecraft's, exactly, because that is the set of rules a
 * player already has in their hands:
 *
 * - THE CURSOR. A stack is not held in a slot while it is being moved. It
 *   is held on the CURSOR - the mouse pointer - and it rides there until it
 *   is put down. A left click picks a stack up, a left click puts it down,
 *   and in between it sits on the pointer. Nothing is copied and nothing is
 *   lost: a stack lives in exactly one place at a time.
 *
 * - STACKING. Two piles of the same thing merge into one, up to sixty-four,
 *   which is Minecraft's limit. A slot that is already full takes nothing
 *   more.
 *
 * - SPLITTING. A right click on a pile takes half of it onto the cursor and
 *   leaves the other half in the slot. When the pile is odd the SMALLER half
 *   is what stays: a pile of seven gives four to the cursor and keeps three.
 *   This is how two piles of the same thing come to exist, and so how they
 *   can be merged back into one.
 *
 * - ONE AT A TIME. A right click with a stack on the cursor puts a single
 *   item down, and a right click onto a slot holding the same thing adds a
 *   single item to it.
 *
 * - SWAPPING. A stack put down on a slot holding something else swaps
 *   places with it.
 *
 * - QUICK MOVE. Shift and a click sends a stack to the other half of the
 *   inventory - hotbar to backpack or backpack to hotbar - merging it into a
 *   pile of the same thing where one is, and putting what is left in the
 *   first free slot.
 *
 * - GATHERING. A double click takes every pile of that thing out of the
 *   whole inventory and onto the cursor, up to a full stack.
 *
 * - DRAGGING. Holding the button down and dragging spreads the stack over
 *   the slots the pointer crosses: the left button divides it evenly, the
 *   right button drops one into each.
 *
 * - DROPPING. The drop key throws a stack away, and clicking outside the
 *   window does the same. This game has nothing lying on the ground, so a
 *   dropped stack simply leaves the inventory.
 */

// The kinds of thing the world holds, and so the kinds of thing a stack can
// be. The order is the order they appear in the grid, so it is a reading
// order rather than a priority: flowers first because they are everywhere,
// then grass, then the tree, then the algae, which are at the bottom of the
// sea.
export type SpecimenKind =
  | 'flowerWhite'
  | 'flowerYellow'
  | 'flowerPink'
  | 'grassSprout'
  | 'grassTuft'
  | 'grassCluster'
  | 'oak'
  | 'algaeKelp'
  | 'algaeFan'
  | 'algaeTuft';

interface Specimen {
  kind: SpecimenKind;
  name: string;
  /** The icon, as a data URL. */
  icon: string;
}

// ------------------------------------------------------------------- icons

// A 16x16 oak, hand drawn. The leaves are a chunky blob rather than a
// circle, because this game draws its trees out of cubes and the icon
// should look like the thing it stands for.
const OAK_ICON: readonly string[] = [
  '................',
  '................',
  '.....LLLLLL.....',
  '...LLLLLLLLLL...',
  '..LLLLLLLLLLLL..',
  '.LLLLLLLLLLLLLL.',
  '.LLLLLLLLLLLLLL.',
  '..LLLLLLLLLLLL..',
  '..LLLLLLLLLLLL..',
  '...LLLLLLLLLL...',
  '.....LLLLLL.....',
  '......TTTT......',
  '......TTTT......',
  '......TTTT......',
  '......TTTT......',
  '......TTTT......',
];

// A flower: a bloom on a stem. The petals take the flower's own colour and
// the centre takes the palette's centre colour, exactly as the flower in the
// world does.
const FLOWER_ICON: readonly string[] = [
  '................',
  '................',
  '.....PPPPPPP....',
  '....P.......P...',
  '....P..CCC..P...',
  '....P..CCC..P...',
  '....P.......P...',
  '.....PPPPPPP....',
  '.......SS.......',
  '.......SS.......',
  '.......SS.......',
  '.......SS.......',
  '.......SS.......',
  '.......SS.......',
  '................',
  '................',
];

/**
 * Draw a hand-drawn pattern into a canvas and hand back a data URL.
 *
 * The characters pick the colours: 'L' the leaf, 'T' the trunk, 'P' the
 * petal, 'C' the centre, 'S' the stem. Anything else is transparent.
 */
function iconFromPattern(
  rows: readonly string[],
  colours: Record<string, number>,
  size = 16
): string {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y];
    for (let x = 0; x < row.length; x++) {
      const hex = colours[row[x]];
      if (hex === undefined) continue;
      const c = new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
      const i = (y * size + x) * 4;
      img.data[i] = c.r * 255;
      img.data[i + 1] = c.g * 255;
      img.data[i + 2] = c.b * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL();
}

/**
 * Draw one of the alpha masks into a canvas and hand back a data URL.
 *
 * The mask is a brightness multiplier with an alpha hole in it, so the shape
 * comes from the alpha and the shading from the texel's own value - which is
 * how the bright and shaded tones of the grass survive into the icon.
 */
function iconFromMask(mask: THREE.DataTexture, tint: number): string {
  const size = mask.image.width;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const img = ctx.createImageData(size, size);
  const data = mask.image.data as Uint8Array;
  const tintC = new THREE.Color().setHex(tint, THREE.SRGBColorSpace);
  for (let i = 0; i < size * size; i++) {
    const alpha = data[i * 4 + 3];
    if (!alpha) continue;
    const k = data[i * 4] / 255;
    img.data[i * 4] = tintC.r * 255 * k;
    img.data[i * 4 + 1] = tintC.g * 255 * k;
    img.data[i * 4 + 2] = tintC.b * 255 * k;
    img.data[i * 4 + 3] = alpha;
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL();
}

// The slots in the hotbar.
const HOTBAR_SLOTS = 9;
// The grid in the backpack: three rows of nine, like Minecraft's.
const GRID_SLOTS = 27;

// How many of a thing a slot holds.
//
// Sixty-four, which is Minecraft's number. It matters because it is what
// makes splitting a pile mean something: a pile of a hundred sprouts is two
// slots of sixty-four and a bit, and the bit is a pile of its own that can
// be dragged somewhere else and merged again.
const MAX_STACK = 64;

// The colours, taken from the game's own palette so the interface belongs to
// the world rather than sitting on top of it.
const STONE = 0x8e7e63;
const STONE_LIGHT = 0xb0a084;
const STONE_DARK = 0x5c4028;
const OUTLINE = 0x3a2c1e;
const WELL = 0x6f6152;
const WELL_DARK = 0x4d4133;
const SELECT = 0xffd98a;

const CSS = `
  #inv-root {
    position: fixed; inset: 0; z-index: 8;
    pointer-events: none;
    font: 11px/1.5 ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    color: #cfe0ea;
    user-select: none;
  }

  /* The hotbar: a column down the left of the screen. */
  #inv-hotbar {
    position: absolute; left: 8px; top: 50%; transform: translateY(-50%);
    display: flex; flex-direction: column; gap: 4px;
    padding: 4px;
    background: #${STONE.toString(16).padStart(6, '0')};
    box-shadow:
      inset 3px 3px 0 #${STONE_LIGHT.toString(16).padStart(6, '0')},
      inset -3px -3px 0 #${STONE_DARK.toString(16).padStart(6, '0')},
      0 0 0 3px #${OUTLINE.toString(16).padStart(6, '0')};
    pointer-events: auto;
  }

  /* The backpack window. */
  #inv-panel {
    position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
    padding: 10px;
    background: #${STONE.toString(16).padStart(6, '0')};
    box-shadow:
      inset 4px 4px 0 #${STONE_LIGHT.toString(16).padStart(6, '0')},
      inset -4px -4px 0 #${STONE_DARK.toString(16).padStart(6, '0')},
      0 0 0 4px #${OUTLINE.toString(16).padStart(6, '0')};
    pointer-events: auto;
    display: none;
  }
  #inv-panel.open { display: block; }

  #inv-panel .grid { display: grid; grid-template-columns: repeat(9, 40px); gap: 4px; }

  /* A slot: a recessed well, drawn the way the game draws everything - with
     a hard shadow inside the top-left and a hard highlight inside the
     bottom-right, and a hard drop shadow outside. No gradients, no blur, no
     rounding: every edge is a whole number of pixels. */
  #inv-root .slot {
    position: relative;
    width: 40px; height: 40px;
    background: #${WELL.toString(16).padStart(6, '0')};
    box-shadow:
      inset 3px 3px 0 #${WELL_DARK.toString(16).padStart(6, '0')},
      inset -3px -3px 0 #${STONE_LIGHT.toString(16).padStart(6, '0')},
      2px 2px 0 #${OUTLINE.toString(16).padStart(6, '0')};
    cursor: pointer;
  }
  #inv-root .slot:hover { background: #7d6e5d; }
  #inv-root .slot .icon {
    position: absolute; inset: 4px;
    background-repeat: no-repeat;
    background-position: center;
    background-size: contain;
    image-rendering: pixelated;
  }

  /* The count, in the corner of the well.
     It is drawn with a hard one-pixel shadow rather than a blurred one,
     because a blurred shadow is the one thing in this interface that would
     not survive being scaled up by three. */
  #inv-root .count {
    position: absolute; right: 1px; bottom: 0;
    font: 10px/1 ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    color: #f4fffb;
    text-shadow: 1px 1px 0 #241a12;
    pointer-events: none;
  }

  /* The selected slot is picked out with a bright frame that overhangs the
     well, which is what Minecraft does and what the eye reads as "this
     one". */
  #inv-root .slot.sel {
    box-shadow:
      inset 3px 3px 0 #${WELL_DARK.toString(16).padStart(6, '0')},
      inset -3px -3px 0 #${STONE_LIGHT.toString(16).padStart(6, '0')},
      0 0 0 3px #${SELECT.toString(16).padStart(6, '0')},
      0 0 0 5px #${OUTLINE.toString(16).padStart(6, '0')};
  }

  /* The slot the pointer is over. */
  #inv-root .slot.over {
    box-shadow:
      inset 3px 3px 0 #${WELL_DARK.toString(16).padStart(6, '0')},
      inset -3px -3px 0 #${STONE_LIGHT.toString(16).padStart(6, '0')},
      0 0 0 3px #f4fffb,
      0 0 0 5px #${OUTLINE.toString(16).padStart(6, '0')};
  }

  /* The item in the air: the cursor. It follows the pointer and is not
     hit-testable, so the slot under it can still be found.
     It is smaller than a slot on purpose: at the slot's own size it would
     cover the slot it is being dropped on, and the frame that says "this
     one" is the frame around the slot. */
  #inv-root .ghost {
    position: fixed; left: 0; top: 0;
    width: 30px; height: 30px;
    pointer-events: none;
    background-repeat: no-repeat;
    background-position: center;
    background-size: contain;
    image-rendering: pixelated;
    z-index: 20;
  }
  #inv-root .ghost .icon {
    position: absolute; inset: 0;
    background-repeat: no-repeat;
    background-position: center;
    background-size: contain;
    image-rendering: pixelated;
  }
  #inv-root .ghost .count { right: 0; bottom: 0; }
`;

interface Slot {
  el: HTMLElement;
  icon: HTMLElement;
  /** The count, in the corner of the well. */
  count: HTMLElement;
  /** What is in the slot. A slot holds a stack, not a specimen. */
  stack: Stack | null;
}

/**
 * A stack of one kind of thing.
 *
 * The count is how many of that kind the stack holds. A stack holds at most
 * MAX_STACK of them, so a kind with more than that in it takes more than one
 * slot, and how many of that kind there are is the sum of the counts of its
 * stacks.
 */
interface Stack {
  kind: SpecimenKind;
  count: number;
}

/**
 * A drag in progress.
 *
 * Minecraft spreads a stack over the slots the pointer is dragged across:
 * the left button divides it evenly, the right button drops one into each.
 * This is the state of that.
 */
interface Drag {
  /** Which button is down: 0 for the left, 2 for the right. */
  button: number;
  /** The kind of thing being spread. */
  kind: SpecimenKind;
  /** How many there were when the drag began: the pool it divides. */
  total: number;
  /** The slots the pointer has crossed. */
  slots: Slot[];
  /** What each of those slots held before the drag touched it. */
  before: Map<Slot, number>;
}

export interface InventorySystem {
  /** Open or close the backpack. */
  toggle(): void;
  /** The currently selected specimen, if any. */
  selected(): Specimen | null;
}

let specimens: Specimen[] = [];
let selectedIndex = 0;

const hotbarSlots: Slot[] = [];
const gridSlots: Slot[] = [];
let panelEl: HTMLElement | null = null;
let isOpen = false;

/**
 * The stack on the mouse.
 *
 * The one piece of state that makes this Minecraft's inventory rather than a
 * grid with a drag on it. A stack being moved is not in a slot and not in a
 * slot it came from: it is here, on the pointer, until it is put down.
 */
let cursor: Stack | null = null;

/** Where the pointer is, so the cursor can ride on it. */
let pointerX = 0;
let pointerY = 0;

/** The drag in progress, if a button is down and the pointer is moving. */
let drag: Drag | null = null;

/** The element the cursor is drawn in. */
let ghostEl: HTMLElement | null = null;
let ghostIcon: HTMLElement | null = null;
let ghostCount: HTMLElement | null = null;

function buildSpecimens(): Specimen[] {
  const grass: SpecimenKind[] = ['grassSprout', 'grassTuft', 'grassCluster'];
  const algae: SpecimenKind[] = ['algaeKelp', 'algaeFan', 'algaeTuft'];
  const grassKinds: GrassKind[] = ['sprout', 'tuft', 'cluster'];
  const algaeKinds: AlgaeKind[] = ['kelp', 'fan', 'tuft'];

  const flowerColour = (kind: number): number =>
    kind === FLOWER_PINK
      ? PALETTE.flowerPink
      : kind === FLOWER_YELLOW
        ? PALETTE.flowerYellow
        : PALETTE.flowerWhite;

  const list: Specimen[] = [];

  // The flowers.
  for (const [index, kind] of [FLOWER_WHITE, FLOWER_YELLOW, FLOWER_PINK].entries()) {
    list.push({
      kind: (['flowerWhite', 'flowerYellow', 'flowerPink'] as const)[index],
      name: kind === FLOWER_PINK ? 'Pink bloom' : kind === FLOWER_YELLOW ? 'Yellow bloom' : 'White bloom',
      icon: iconFromPattern(FLOWER_ICON, {
        P: flowerColour(kind),
        C: PALETTE.flowerCentre,
        S: PALETTE.tallGrass[1],
      }),
    });
  }

  // The tall grass.
  for (const [index, kind] of grassKinds.entries()) {
    list.push({
      kind: grass[index],
      name: kind === 'sprout' ? 'Sprout' : kind === 'tuft' ? 'Grass tuft' : 'Grass cluster',
      icon: iconFromMask(grassMask(kind), PALETTE.tallGrass[1]),
    });
  }

  // The oak.
  list.push({
    kind: 'oak',
    name: 'Oak',
    icon: iconFromPattern(OAK_ICON, { L: PALETTE.leaf[1], T: PALETTE.bark[1] }),
  });

  // The algae.
  for (const [index, kind] of algaeKinds.entries()) {
    list.push({
      kind: algae[index],
      name: kind === 'kelp' ? 'Kelp' : kind === 'fan' ? 'Sea fan' : 'Algae tuft',
      icon: iconFromMask(algaeMask(kind), PALETTE.algae[1]),
    });
  }

  return list;
}

/**
 * Every slot, hotbar first.
 *
 * The order matters because it is the order Minecraft keeps its inventory in:
 * the nine the player carries are the first nine of the thirty-six, and
 * everything that reaches across the whole inventory - a double click - goes
 * looking down this list.
 */
function allSlots(): Slot[] {
  return [...hotbarSlots, ...gridSlots];
}

/** Draw a slot's contents. */
function paint(slot: Slot): void {
  if (!slot.stack) {
    slot.icon.style.backgroundImage = '';
    slot.count.textContent = '';
    slot.count.style.display = 'none';
    return;
  }
  const spec = specimens.find((s) => s.kind === slot.stack!.kind);
  slot.icon.style.backgroundImage = spec ? `url(${spec.icon})` : '';
  // The count sits in the corner of the well, and only a slot with something
  // in it has one.
  slot.count.textContent = String(slot.stack.count);
  slot.count.style.display = 'block';
}

/**
 * Draw the cursor, the thing on the mouse.
 *
 * It is drawn even when the backpack is closed, because the hotbar is always
 * on the screen and a stack can be picked up out of it.
 */
function paintCursor(): void {
  if (!ghostEl || !ghostIcon || !ghostCount) return;
  if (!cursor || cursor.count <= 0) {
    ghostEl.style.display = 'none';
    return;
  }
  const spec = specimens.find((s) => s.kind === cursor!.kind);
  ghostIcon.style.backgroundImage = spec ? `url(${spec.icon})` : '';
  ghostCount.textContent = String(cursor.count);
  ghostEl.style.display = 'block';
  moveCursor();
}

/** Move the cursor onto the pointer. */
function moveCursor(): void {
  if (!ghostEl) return;
  ghostEl.style.left = `${pointerX - 15}px`;
  ghostEl.style.top = `${pointerY - 15}px`;
}

/** Rebuild every slot, the cursor and the selection from the state. */
function sync(): void {
  for (const slot of hotbarSlots) {
    paint(slot);
    slot.el.classList.toggle('sel', hotbarSlots.indexOf(slot) === selectedIndex);
  }
  for (const slot of gridSlots) paint(slot);
  paintCursor();
}

/**
 * The stack on the mouse, if there is one.
 *
 * A stack being spread by a drag can be down to nothing on the mouse while
 * the drag is still going - the items are in the slots it has crossed - and
 * an empty stack on the mouse is not a stack.
 */
function held(): Stack | null {
  return cursor && cursor.count > 0 ? cursor : null;
}

/**
 * The left button.
 *
 * Minecraft's plain click: pick the stack up, put it down, merge it into a
 * pile of the same thing, or swap with what is already there.
 */
function leftClick(slot: Slot): void {
  const c = held();
  if (!c) {
    // Nothing on the mouse: take what is in the slot.
    if (!slot.stack) return;
    cursor = slot.stack;
    slot.stack = null;
    return;
  }
  if (!slot.stack) {
    // An empty slot: put the whole stack down.
    slot.stack = c;
    cursor = null;
    return;
  }
  if (slot.stack.kind === c.kind) {
    // The same thing: the piles merge, up to the limit. What will not fit
    // stays on the mouse.
    const room = MAX_STACK - slot.stack.count;
    if (room <= 0) return;
    const moved = Math.min(room, c.count);
    slot.stack.count += moved;
    c.count -= moved;
    if (c.count <= 0) cursor = null;
    return;
  }
  // Something else: the two swap places.
  const swapped = slot.stack;
  slot.stack = c;
  cursor = swapped;
}

/**
 * The right button.
 *
 * With nothing on the mouse it takes half a pile; with something on the
 * mouse it puts down a single item.
 */
function rightClick(slot: Slot): void {
  const c = held();
  if (!c) {
    if (!slot.stack) return;
    // Take half the pile, and leave the smaller half behind when the pile
    // is odd: a pile of seven gives four to the mouse and keeps three.
    const take = Math.ceil(slot.stack.count / 2);
    cursor = { kind: slot.stack.kind, count: take };
    slot.stack.count -= take;
    if (slot.stack.count <= 0) slot.stack = null;
    return;
  }
  if (!slot.stack) {
    // An empty slot: one item goes down and the rest stays on the mouse.
    slot.stack = { kind: c.kind, count: 1 };
    c.count--;
  } else if (slot.stack.kind === c.kind) {
    // The same thing: one more item goes on top, if there is room.
    if (slot.stack.count >= MAX_STACK) return;
    slot.stack.count++;
    c.count--;
  } else {
    // Something else: the two swap places.
    const swapped = slot.stack;
    slot.stack = c;
    cursor = swapped;
    return;
  }
  if (c.count <= 0) cursor = null;
}

/**
 * A double click.
 *
 * Minecraft grabs up to a full stack of that thing from everywhere in the
 * inventory: every pile of the same kind, wherever it is, is emptied onto
 * the mouse until the mouse holds a full stack. It is the quickest way to
 * gather a kind and put it somewhere else, and it is the one move in
 * Minecraft that reaches across the whole inventory at once.
 */
function doubleClick(slot: Slot): void {
  if (!slot.stack) return;
  const kind = slot.stack.kind;
  // Only for the same thing: the mouse must be empty or already holding it.
  if (cursor && cursor.kind !== kind) return;
  let count = cursor ? cursor.count : 0;
  for (const s of allSlots()) {
    if (count >= MAX_STACK) break;
    if (!s.stack || s.stack.kind !== kind) continue;
    const taken = Math.min(MAX_STACK - count, s.stack.count);
    s.stack.count -= taken;
    count += taken;
    if (s.stack.count <= 0) s.stack = null;
  }
  cursor = { kind, count };
}

/**
 * Shift and a click: send the stack to the other half of the inventory.
 *
 * The hotbar to the backpack or the backpack to the hotbar. It merges into
 * a pile of the same thing where there is one, and what is left goes in the
 * first free slot. If the other half has no room the stack stays where it
 * is, which is what Minecraft does.
 */
function quickMove(slot: Slot): void {
  const stack = slot.stack;
  if (!stack) return;
  const fromHotbar = hotbarSlots.includes(slot);
  const target = fromHotbar ? gridSlots : hotbarSlots;
  let left = stack.count;
  // Onto a pile of the same thing first, left to right and top to bottom.
  for (const t of target) {
    if (left <= 0) break;
    if (t.stack && t.stack.kind === stack.kind && t.stack.count < MAX_STACK) {
      const moved = Math.min(MAX_STACK - t.stack.count, left);
      t.stack.count += moved;
      left -= moved;
    }
  }
  // Then into the first free slot.
  if (left > 0) {
    for (const t of target) {
      if (left <= 0) break;
      if (!t.stack) {
        t.stack = { kind: stack.kind, count: left };
        left = 0;
      }
    }
  }
  // If it would not all fit, it stays where it was.
  if (left <= 0) slot.stack = null;
}

/**
 * The stack on the mouse spread over the slots the pointer crosses.
 *
 * The left button divides the stack evenly - drag over four slots and
 * sixty-four become four piles of sixteen - and the right button drops one
 * into each slot as it is crossed. Only empty slots and slots holding the
 * same thing can take a share.
 *
 * The left button takes the stack apart as the pointer moves: the first
 * slot crossed takes all of it, and every slot crossed after that takes a
 * share off the ones already filled. That is why the stack being spread is
 * remembered in the DRAG and not only on the mouse - the mouse's share of
 * it is often nothing at all while the drag is still going.
 */
function dragOver(slot: Slot): boolean {
  if (!drag) return false;
  if (drag.slots.includes(slot)) return false;
  // Only an empty slot or one holding the same thing can take a share.
  if (slot.stack && slot.stack.kind !== drag.kind) return false;
  drag.slots.push(slot);
  // What the slot held before the drag touched it, so the share can be
  // taken back if the stack is divided again over more slots.
  if (!drag.before.has(slot)) drag.before.set(slot, slot.stack ? slot.stack.count : 0);

  if (drag.button === 2) {
    // The right button: one item into this slot.
    const c = held();
    if (!c) return false;
    if (slot.stack) {
      if (slot.stack.kind !== c.kind) return false;
      if (slot.stack.count >= MAX_STACK) return false;
      slot.stack.count++;
    } else {
      slot.stack = { kind: c.kind, count: 1 };
    }
    c.count--;
    if (c.count <= 0) cursor = null;
    return true;
  }

  // The left button: divide the whole stack evenly over every slot the
  // pointer has crossed. When the pointer crosses another slot the earlier
  // ones give their share back, so the stack ends up spread evenly.
  const share = Math.floor(drag.total / drag.slots.length);
  let placed = 0;
  for (const s of drag.slots) {
    const before = drag.before.get(s) ?? 0;
    const room = Math.max(0, MAX_STACK - before);
    const want = Math.min(share, room);
    if (want > 0) {
      if (!s.stack) s.stack = { kind: drag.kind, count: before + want };
      else s.stack.count = before + want;
    } else if (s.stack) {
      s.stack.count = before;
      if (s.stack.count <= 0) s.stack = null;
    }
    placed += want;
  }
  // What does not fit in the slots stays on the mouse. It is often nothing
  // at all - the stack is in the slots by then - but the drag still needs
  // it, because the next slot crossed takes a share back off the others.
  if (cursor) cursor.count = Math.max(0, drag.total - placed);
  return true;
}

/**
 * Throw a stack away.
 *
 * Minecraft drops the item on the ground, where it can be picked up again.
 * This world has nothing on the ground and no way to pick anything up, so a
 * dropped stack simply leaves the inventory. When the world grows things
 * that lie about, this is where they would go - and it is the one place in
 * this file that would have to change with them.
 */
function dropToWorld(_stack: Stack): void {
  // Nothing to put it down on.
}

/** The slot under the pointer, if there is one. */
function slotAt(x: number, y: number): Slot | null {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  const host = (el as HTMLElement).closest('[data-inv]') as HTMLElement | null;
  if (!host) return null;
  const which = host.dataset.inv as 'grid' | 'hotbar';
  const index = Number(host.dataset.index);
  const list = which === 'grid' ? gridSlots : hotbarSlots;
  return list[index] ?? null;
}

/** Rebuild both slot rows from the state. */
function makeSlot(which: 'grid' | 'hotbar', index: number): Slot {
  const el = document.createElement('div');
  el.className = 'slot';
  // Where this slot is, so a click can find out what it landed on without
  // keeping a map of every element.
  el.dataset.inv = which;
  el.dataset.index = String(index);
  const icon = document.createElement('div');
  icon.className = 'icon';
  el.appendChild(icon);
  // The count, in the corner of the well. It is hidden when the slot is
  // empty and shown whenever the slot holds something.
  const count = document.createElement('div');
  count.className = 'count';
  count.style.display = 'none';
  el.appendChild(count);
  return { el, icon, count, stack: null };
}

/** Open or close the backpack. */
function toggle(): void {
  if (!panelEl) return;
  isOpen = !isOpen;
  panelEl.classList.toggle('open', isOpen);
  // Closing the window with a stack on the mouse throws it away, which is
  // what Minecraft does with the thing on your cursor.
  if (!isOpen) {
    const c = held();
    if (c) {
      dropToWorld(c);
      cursor = null;
    }
  }
  // While the backpack is up, the movement keys belong to the interface and
  // not to the player: W would walk them into the sea while they are trying
  // to look at their collection.
  setInputSuspended(isOpen);
  sync();
}

/**
 * Build the hotbar and the backpack and return the system's controls.
 *
 * The panel is DOM rather than drawn in the scene, for the same reason the
 * debug sidebar is: it is UI, it wants crisp edges at the window's own
 * resolution, and the canvas is drawing a world at a third of it.
 */
export function initInventory(): InventorySystem {
  specimens = buildSpecimens();

  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'inv-root';

  const hotbarEl = document.createElement('div');
  hotbarEl.id = 'inv-hotbar';
  for (let i = 0; i < HOTBAR_SLOTS; i++) {
    const slot = makeSlot('hotbar', i);
    hotbarSlots.push(slot);
    hotbarEl.appendChild(slot.el);
  }

  const panel = document.createElement('div');
  panel.id = 'inv-panel';
  panelEl = panel;
  const grid = document.createElement('div');
  grid.className = 'grid';
  for (let i = 0; i < GRID_SLOTS; i++) {
    const slot = makeSlot('grid', i);
    gridSlots.push(slot);
    grid.appendChild(slot.el);
  }
  panel.appendChild(grid);

  // The cursor: the stack on the mouse. It is always in the DOM and only
  // shown when there is something on it.
  const ghost = document.createElement('div');
  ghost.className = 'ghost';
  ghost.style.display = 'none';
  const ghostIconEl = document.createElement('div');
  ghostIconEl.className = 'icon';
  const ghostCountEl = document.createElement('div');
  ghostCountEl.className = 'count';
  ghost.append(ghostIconEl, ghostCountEl);
  ghostEl = ghost;
  ghostIcon = ghostIconEl;
  ghostCount = ghostCountEl;

  root.append(panel, hotbarEl, ghost);
  document.body.appendChild(root);

  // The click.
  //
  // Pointer events rather than HTML5's drag and drop, because the cursor has
  // to be a pixel-art icon that follows the pointer exactly and the slot
  // under it has to be found by hit-testing, and neither is what the
  // browser's own drag machinery gives you.
  //
  // The click happens on the PRESS, not on the release, which is what
  // Minecraft does: a stack is on the mouse the moment the button goes
  // down, and it is put down by the NEXT press.
  const onDown = (ev: PointerEvent) => {
    const host = (ev.target as HTMLElement | null)?.closest('[data-inv]') as HTMLElement | null;
    if (!host) return;
    const which = host.dataset.inv as 'grid' | 'hotbar';
    const index = Number(host.dataset.index);
    const list = which === 'grid' ? gridSlots : hotbarSlots;
    const slot = list[index];
    if (!slot) return;
    ev.preventDefault();
    pointerX = ev.clientX;
    pointerY = ev.clientY;

    // Shift and a click sends the stack to the other half of the inventory.
    if (ev.shiftKey) {
      quickMove(slot);
      sync();
      return;
    }

    // The middle button does nothing, as it does in survival.
    if (ev.button !== 0 && ev.button !== 2) return;

    if (ev.button === 2) rightClick(slot);
    else leftClick(slot);

    // A drag begins if there is a stack on the mouse to spread. The slot the
    // pointer pressed on is not one of them: it is where the stack came
    // from, and spreading it back over itself would undo the click.
    if (held()) {
      drag = {
        button: ev.button,
        kind: cursor!.kind,
        total: cursor!.count,
        slots: [],
        before: new Map(),
      };
    } else {
      drag = null;
    }
    sync();
  };

  hotbarSlots.forEach((slot) => slot.el.addEventListener('pointerdown', onDown));
  gridSlots.forEach((slot) => slot.el.addEventListener('pointerdown', onDown));
  // A double click gathers a full stack of that thing from everywhere.
  hotbarSlots.forEach((slot) => slot.el.addEventListener('dblclick', () => {
    doubleClick(slot);
    sync();
  }));
  gridSlots.forEach((slot) => slot.el.addEventListener('dblclick', () => {
    doubleClick(slot);
    sync();
  }));
  // The right button is a split, not a menu.
  root.addEventListener('contextmenu', (e) => e.preventDefault());

  window.addEventListener('pointermove', (e) => {
    pointerX = e.clientX;
    pointerY = e.clientY;
    moveCursor();
    if (!drag) return;
    const over = slotAt(e.clientX, e.clientY);
    if (over && dragOver(over)) sync();
  });

  // The button coming up ends the drag. Whatever is left on the mouse stays
  // there, because in Minecraft the stack on the cursor survives the press
  // that put it there.
  window.addEventListener('pointerup', () => {
    drag = null;
    if (cursor && cursor.count <= 0) cursor = null;
    sync();
  });
  // A pointer that leaves the window, or a drag that the browser decides to
  // take over (a long press on a touch screen), ends the drag too.
  window.addEventListener('pointercancel', () => {
    drag = null;
    if (cursor && cursor.count <= 0) cursor = null;
    sync();
  });
  window.addEventListener('blur', () => {
    drag = null;
  });

  // Clicking outside the window throws the stack on the mouse away, which is
  // how Minecraft gets rid of the thing on your cursor.
  window.addEventListener('pointerdown', (e) => {
    const target = e.target as HTMLElement | null;
    // A slot is the panel's own business, and so is the panel and the
    // hotbar: in Minecraft the hotbar is part of the window, and the world
    // is the only place outside it.
    if (target?.closest('[data-inv]')) return;
    if (target?.closest('#inv-panel')) return;
    if (target?.closest('#inv-hotbar')) return;
    const c = held();
    if (!c) return;
    dropToWorld(c);
    cursor = null;
    drag = null;
    sync();
  });

  // E opens and closes the backpack. The capture phase gets it ahead of the
  // game's own input, and the keys are checked against the target so a
  // keypress typed into a control is not swallowed.
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyE') return;
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    e.preventDefault();
    toggle();
  }, true);

  // The number keys pick a hotbar slot, the way they do in Minecraft.
  window.addEventListener('keydown', (e) => {
    if (!e.code.startsWith('Digit')) return;
    const n = Number(e.code.slice(5));
    if (!(n >= 1 && n <= HOTBAR_SLOTS)) return;
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    selectedIndex = n - 1;
    sync();
  }, true);

  // The drop key throws a stack away.
  //
  // Over a slot it throws one item out of it, and holding control throws the
  // whole pile. With nothing under the pointer it throws away whatever is on
  // the mouse.
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyQ') return;
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    e.preventDefault();
    const whole = e.ctrlKey || e.metaKey;
    const over = slotAt(pointerX, pointerY);
    if (over && over.stack) {
      const stack = over.stack;
      if (whole) {
        over.stack = null;
        dropToWorld(stack);
      } else {
        stack.count--;
        if (stack.count <= 0) over.stack = null;
        dropToWorld({ kind: stack.kind, count: 1 });
      }
    } else {
      const c = held();
      if (c) {
        dropToWorld(c);
        cursor = null;
      }
    }
    sync();
  }, true);

  sync();

  return {
    toggle,
    selected() {
      const stack = hotbarSlots[selectedIndex]?.stack;
      return stack ? specimens.find((s) => s.kind === stack.kind) ?? null : null;
    },
  };
}

/** Whether the backpack is open, so the game can pause around it. */
export function inventoryIsOpen(): boolean {
  return isOpen;
}
