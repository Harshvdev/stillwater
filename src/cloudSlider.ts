import {
  cloudUniforms, cloudTestOverride, resetCloudOverride, getDeckTravel, freezeDeck, CLOUD_DEFAULTS,
} from './clouds';

// TEMPORARY - cloud test controls.
//
// This whole file is scaffolding for looking at the cloud shadows, not part of
// the game. To remove it: delete this file plus src/daySlider.ts and
// src/sidebar.ts, and the lines in main.ts that name them. Nothing else reads
// from here.
//
// It renders INTO the shared sidebar rather than making its own floating panel -
// see sidebar.ts. The CSS moved there too; this file only builds markup.
//
// It exists because the three numbers that matter - how dark, how big, how fast -
// were all badly wrong before they were measured, twice in opposite directions
// each. Sliders that change nothing until a rebuild are useless for that, so
// CLOUD_SCALE in particular became a runtime uniform rather than a constant
// baked into the shader string.
//
// Three sliders map to the three decisions:
//   strength  - how much direct light a shadow removes
//   size      - cloud feature size, in world units across
//   speed     - how fast the deck travels
//
// Plus a freeze, because "watch it drift" is a much weaker way to judge a
// pattern than stepping it to a position and looking. And an auto/manual toggle,
// because the shipped behaviour is amount = f(key intensity, coverage gate), and
// there is otherwise no way to see the raw shadow without parking the sun at noon
// first.

// The panel works in FEATURE SIZE rather than in the 1/size frequency the shader
// wants, because "9 world units across" is the thing worth judging and "0.111" is
// not. Converted here, once.
const MIN_SIZE = 2;
const MAX_SIZE = 40;
const SIZE_STEP = 0.5;

// Panel positions, read from the shipped constants rather than restated here.
//
// This used to be a set of hand-copied literals. They went stale the moment
// CLOUD_SCALE was retuned during development, so the panel opened showing one
// size while the game rendered another, and the reset button would have
// restored a value the game no longer used. CLOUD_DEFAULTS is the single source
// of truth, so the panel cannot disagree with the thing it is testing.
//
// SIZE is inverted here once: the shader works in frequency (1/units) while the
// slider is in world units across, because "9 units across" is the thing worth
// judging and "0.111" is not.
const DEFAULT_AMOUNT = CLOUD_DEFAULTS.amount;
const DEFAULT_SIZE = 1 / CLOUD_DEFAULTS.scale;
const DEFAULT_SPEED = CLOUD_DEFAULTS.drift;

let amountInput: HTMLInputElement;
let sizeInput: HTMLInputElement;
let speedInput: HTMLInputElement;
let freezeBox: HTMLInputElement;
let autoBox: HTMLInputElement;
let statText: HTMLElement;

export function initCloudSlider(panel: HTMLElement): void {
  panel.innerHTML = `
    <div class="head"><span>clouds</span><span class="stat"></span></div>
    <div class="row"><label>str</label><input type="range" min="0" max="100" step="1" value="${Math.round(DEFAULT_AMOUNT * 100)}"><span class="dim"></span></div>
    <div class="row"><label>size</label><input type="range" min="${MIN_SIZE}" max="${MAX_SIZE}" step="${SIZE_STEP}" value="${DEFAULT_SIZE}"><span class="dim"></span></div>
    <div class="row"><label>speed</label><input type="range" min="0" max="400" step="5" value="${Math.round(DEFAULT_SPEED * 100)}"><span class="dim"></span></div>
    <div class="row">
      <input type="checkbox" checked><label>auto</label>
      <span style="flex:1"></span><span class="dim">on</span>
    </div>
    <div class="row">
      <input type="checkbox"><label>freeze deck</label>
      <span style="flex:1"></span><span class="dim"></span>
    </div>
    <div class="row"><button class="reset">reset to default</button></div>
  `;

  statText = panel.querySelector('.stat') as HTMLElement;
  const ranges = panel.querySelectorAll('input[type=range]');
  amountInput = ranges[0] as HTMLInputElement;
  sizeInput = ranges[1] as HTMLInputElement;
  speedInput = ranges[2] as HTMLInputElement;
  const boxes = panel.querySelectorAll('input[type=checkbox]');
  autoBox = boxes[0] as HTMLInputElement;
  freezeBox = boxes[1] as HTMLInputElement;
  const dims = panel.querySelectorAll('.dim');
  const amountText = dims[0] as HTMLElement;
  const sizeText = dims[1] as HTMLElement;
  const speedText = dims[2] as HTMLElement;
  const autoModeText = dims[3] as HTMLElement;
  const freezeText = dims[4] as HTMLElement;

  const setAmountText = () => {
    const s = `${amountInput.value}%`;
    if (amountText.textContent !== s) amountText.textContent = s;
  };
  const setSizeText = () => {
    const s = `${sizeInput.value}u`;
    if (sizeText.textContent !== s) sizeText.textContent = s;
  };
  const setSpeedText = () => {
    const s = `${(Number(speedInput.value) / 100).toFixed(2)}`;
    if (speedText.textContent !== s) speedText.textContent = s;
  };

  // Dragging any slider implies you want to SEE that exact value, so it takes the
  // panel out of auto. Same reasoning as the day panel parking the clock on drag.
  amountInput.addEventListener('input', () => {
    autoBox.checked = false;
    cloudTestOverride.amount = Number(amountInput.value) / 100;
    setAmountText();
  });

  sizeInput.addEventListener('input', () => {
    // The slider is in world units across; the shader wants 1/units.
    cloudTestOverride.scale = 1 / Math.max(0.5, Number(sizeInput.value));
    setSizeText();
  });

  speedInput.addEventListener('input', () => {
    cloudTestOverride.drift = Number(speedInput.value) / 100;
    setSpeedText();
  });

  autoBox.addEventListener('change', () => {
    if (autoBox.checked) {
      // Back to shipped behaviour: amount comes from the key light and the
      // coverage gate again, and nothing else is pinned.
      resetCloudOverride();
      cloudTestOverride.scale = 1 / Math.max(0.5, Number(sizeInput.value));
      cloudTestOverride.drift = Number(speedInput.value) / 100;
      freezeBox.checked = false;
      cloudTestOverride.freezeAt = null;
    } else {
      cloudTestOverride.amount = Number(amountInput.value) / 100;
    }
  });

  freezeBox.addEventListener('change', () => {
    // Park the deck wherever it has actually reached, rather than at zero -
    // freezing at t=0 would show the same frame every time the box is ticked.
    //
    // The travel is read from clouds.ts rather than from a value cached in this
    // file. An earlier version cached the clock here from syncCloudSlider(), and
    // that was wrong twice over: the cache is only ever written by the frame
    // loop, which is throttled to a halt in a backgrounded tab, and is not the
    // loop at all when the scene is driven through __step. Either way the freeze
    // handler read a stale zero and snapped the deck back to the start.
    freezeDeck(freezeBox.checked ? getDeckTravel() : null);
  });

  setAmountText();
  setSizeText();
  setSpeedText();
  // Open in auto, matching how the game actually runs.
  void autoModeText;
  void freezeText;

  // Reset: drop every override AND put the handles back where the shipped
  // constants are.
  //
  // Both halves are needed. Clearing the override alone would leave the sliders
  // showing whatever was last dragged, so the panel would claim one size while
  // the game rendered another - and the whole point of a "reset to default"
  // button is that you can trust what it says. The handle positions are read
  // from CLOUD_DEFAULTS, so this cannot drift from the game again.
  const resetButton = panel.querySelector('.reset') as HTMLButtonElement;
  resetButton.addEventListener('click', () => {
    resetCloudOverride();
    autoBox.checked = true;
    freezeBox.checked = false;
    amountInput.value = String(Math.round(DEFAULT_AMOUNT * 100));
    sizeInput.value = String(DEFAULT_SIZE);
    speedInput.value = String(Math.round(DEFAULT_SPEED * 100));
    setAmountText();
    setSizeText();
    setSpeedText();
  });
}

/**
 * Mirror live state onto the panel. Called from the frame loop.
 *
 * Only the live readout is written. The handles are NOT mirrored back from the
 * uniform values, because with `auto` ticked the amount is driven by the day
 * cycle and the coverage gate - echoing it into the strength slider would make
 * that handle crawl on its own and fight anyone trying to grab it.
 */
export function syncCloudSlider(): void {
  if (!amountInput) return;

  const live = cloudUniforms.uCloudAmount.value;
  const auto = autoBox.checked;

  // Invert uCloudScale back into a feature size for the readout.
  const scale = cloudUniforms.uCloudScale.value;
  const sizeUnits = scale > 0 ? 1 / scale : 0;

  const stat = auto
    ? `auto ${live.toFixed(2)}`
    : `${live.toFixed(2)} ${sizeUnits.toFixed(1)}u`;
  if (statText.textContent !== stat) statText.textContent = stat;

  void freezeBox;
}
