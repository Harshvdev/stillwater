import {
  setHour, getHour, isRunning, setRunning, getCycleLength, setCycleLength,
} from './daynight';

// TEMPORARY - day/night test controls.
//
// This whole file is scaffolding for looking at the cycle, not part of the
// game. To remove it: delete this file plus src/cloudSlider.ts and
// src/sidebar.ts, and the lines in main.ts that name them. Nothing else reads
// from here, and the cycle runs off its own clock either way.
//
// It now renders INTO the shared sidebar rather than making its own floating
// panel - see sidebar.ts. The CSS moved there too; this file only builds markup.

// The slider works in minutes so a stop is one step of the track and the
// readout can show a real clock time; daynight.ts thinks in hours.
const MAX_MIN = 1440;

let hourInput: HTMLInputElement;
let lengthInput: HTMLInputElement;
let phaseText: HTMLElement;
let clockText: HTMLElement;
let runningBox: HTMLInputElement;
let speedText: HTMLElement;

const hhmm = (h: number): string => {
  const m = Math.round(h * 60) % MAX_MIN;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

// Names for the phases, so the readout says "sunset" instead of making you work
// out from the clock what the light is doing. The hours line up with the stops in
// daynight.ts.
function phaseName(h: number): string {
  if (h < 4.5) return 'deep night';
  if (h < 5.6) return 'first light';
  if (h < 6.6) return 'sunrise';
  if (h < 8) return 'early morning';
  if (h < 11) return 'morning';
  if (h < 13) return 'noon';
  if (h < 16.5) return 'afternoon';
  if (h < 17.8) return 'golden';
  if (h < 18.6) return 'sunset';
  if (h < 20) return 'dusk';
  if (h < 21.5) return 'night';
  return 'deep night';
}

const speedLabel = (s: number): string => `${Math.round(s / 60)} min/day`;

export function initDaySlider(panel: HTMLElement): void {
  panel.innerHTML = `
    <div class="head"><span>time of day</span><span class="big"></span></div>
    <div class="phase"></div>
    <div class="row"><input type="range" min="0" max="${MAX_MIN}" step="1" value="660"></div>
    <div class="row">
      <input type="checkbox"><label>run cycle</label>
      <span style="flex:1"></span><span class="dim"></span>
    </div>
    <div class="row"><input type="range" min="30" max="1200" step="10" value="${getCycleLength()}"></div>
  `;

  clockText = panel.querySelector('.big') as HTMLElement;
  phaseText = panel.querySelector('.phase') as HTMLElement;
  const inputs = panel.querySelectorAll('input[type=range]');
  hourInput = inputs[0] as HTMLInputElement;
  lengthInput = inputs[1] as HTMLInputElement;
  runningBox = panel.querySelector('input[type=checkbox]') as HTMLInputElement;
  speedText = panel.querySelector('.dim') as HTMLElement;

  hourInput.value = String(Math.round(getHour() * 60));

  // Dragging parks the clock. Leaving the cycle running under a slider the user
  // is holding still would make the handle fight them, and "sit on exactly 18:00
  // until I have looked at it" is the entire point of this panel.
  hourInput.addEventListener('input', () => {
    setRunning(false);
    setHour(Number(hourInput.value) / 60);
  });

  runningBox.addEventListener('change', () => setRunning(runningBox.checked));

  lengthInput.addEventListener('input', () => setCycleLength(Number(lengthInput.value)));
}

/**
 * Mirror the live state onto the panel. Called from the frame loop, so the
 * slider tracks the cycle while it runs and the clock and phase name update as
 * the light changes.
 */
export function syncDaySlider(): void {
  if (!hourInput) return;
  const h = getHour();
  // Written unconditionally, including while the handle is being dragged.
  //
  // This used to be skipped whenever the slider had focus, to stop the handle
  // fighting the user mid-drag - and that made the whole panel look broken in
  // any browser that does not move focus off a range input when a checkbox is
  // clicked (Safari does not). Drag the time slider, tick "run cycle", and the
  // clock would carry on running while the handle stayed parked where you left
  // it, with no way to see the day advancing.
  //
  // There is no need for the guard: the input handler writes the dragged value
  // straight into dayState.hour and pauses the cycle in the same event, so the
  // value written back here is the value already under the thumb. Dragging is
  // the only time the handle and the clock can disagree, and dragging is
  // exactly when they cannot.
  hourInput.value = String(Math.round(h * 60) % MAX_MIN);

  const clock = hhmm(h);
  if (clockText.textContent !== clock) clockText.textContent = clock;
  const phase = phaseName(h);
  if (phaseText.textContent !== phase) phaseText.textContent = phase;
  if (runningBox.checked !== isRunning()) runningBox.checked = isRunning();
  const speed = speedLabel(getCycleLength());
  if (speedText.textContent !== speed) speedText.textContent = speed;
}