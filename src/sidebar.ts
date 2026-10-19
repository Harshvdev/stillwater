// TEMPORARY - the shared debug sidebar.
//
// This is the one panel that hosts the day/night controls, the cloud controls
// and a hide toggle. It replaces two separate floating panels (one bottom-left,
// one bottom-right), which is worse than crowding: with two of them the day
// controls and the cloud controls sit at opposite corners of the screen, so
// changing the time and seeing the cloud light change are as far apart as the
// window is wide. Anything being compared against anything else belongs on the
// same surface.
//
// To remove all the debug UI: delete this file plus src/daySlider.ts and
// src/cloudSlider.ts, and the six lines in main.ts that name them (the three
// imports, `initSidebar()`, `syncDaySlider()` and `syncCloudSlider()`). Nothing
// else reads from any of it - the day/night cycle and the cloud deck both run off
// their own clocks either way.

let bodyEl: HTMLElement | null = null;
let toggleEl: HTMLButtonElement | null = null;
let hidden = false;

/**
 * Build the sidebar shell and return the three containers the sub-panels fill.
 *
 * Sections are returned rather than queried by id so the sub-panels do not have
 * to know how the shell is laid out, and so `hideSidebar` can hide the body while
 * leaving the toggle reachable - the one thing that must stay on screen when the
 * panel is hidden, since it is the only way back.
 */
export function initSidebar(): {
  root: HTMLElement;
  sections: { day: HTMLElement; cloud: HTMLElement };
  toggle: HTMLButtonElement;
} {
  const style = document.createElement('style');
  style.textContent = `
    #sidebar {
      position: fixed; right: 10px; bottom: 10px; z-index: 10;
      width: 248px;
      background: rgba(8, 12, 20, 0.78);
      border: 2px solid #2f4a63;
      color: #cfe0ea;
      font: 11px/1.5 ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
      padding: 8px 10px 9px;
      user-select: none;
    }
    /* Hidden: the body goes, the toggle stays. Display:none rather than
       opacity/visibility so the controls cannot be tabbed to while hidden. */
    #sidebar .body { display: block; }
    #sidebar.hidden .body { display: none; }
    #sidebar.hidden { padding-bottom: 8px; }

    #sidebar .toggle {
      width: 100%; text-align: left;
      background: #1b2c3e; color: #7fa8c4;
      border: 1px solid #3a5670; border-radius: 2px;
      font: inherit; letter-spacing: 0.08em; text-transform: uppercase;
      padding: 3px 6px; cursor: pointer;
    }
    #sidebar .toggle:hover { background: #24394f; color: #cfe0ea; }
    #sidebar .toggle .hint { float: right; text-transform: none; letter-spacing: 0; color: #4f6f88; }

    /* A rule between sections, so the eye separates "time" from "clouds"
       without a heading competing for space. */
    #sidebar .sect + .sect { margin-top: 9px; padding-top: 8px; border-top: 1px solid #1e3247; }

    #sidebar .row { display: flex; align-items: center; gap: 6px; margin-top: 3px; }
    #sidebar .head {
      display: flex; justify-content: space-between; gap: 10px;
      color: #7fa8c4; letter-spacing: 0.08em; text-transform: uppercase;
    }
    #sidebar .big { color: #ffd98a; font-size: 13px; }
    #sidebar .stat { color: #9fd8e8; font-size: 12px; }
    #sidebar .phase { color: #8fd0c8; margin-bottom: 2px; }
    #sidebar .dim { color: #7fa8c4; min-width: 54px; text-align: right; }
    #sidebar label { white-space: nowrap; }
    #sidebar input[type=range] {
      -webkit-appearance: none; appearance: none;
      flex: 1; height: 14px; background: transparent; margin: 0; cursor: ew-resize;
    }
    #sidebar input[type=range]::-webkit-slider-runnable-track {
      height: 4px; background: #1b2c3e; border: 1px solid #3a5670;
    }
    #sidebar input[type=range]::-moz-range-track {
      height: 4px; background: #1b2c3e; border: 1px solid #3a5670;
    }
    #sidebar input[type=range]::-webkit-slider-thumb {
      -webkit-appearance: none; appearance: none;
      width: 9px; height: 14px; margin-top: -6px;
      background: #ffd98a; border: 1px solid #6b4f16;
    }
    #sidebar input[type=range]::-moz-range-thumb {
      width: 9px; height: 14px; border-radius: 0;
      background: #ffd98a; border: 1px solid #6b4f16;
    }
    #sidebar input[type=checkbox] { accent-color: #ffd98a; margin: 0; }
    #sidebar .reset {
      margin-top: 5px; width: 100%;
      background: #1b2c3e; color: #9fd8e8;
      border: 1px solid #3a5670; border-radius: 2px;
      font: inherit; padding: 3px 6px; cursor: pointer;
    }
    #sidebar .reset:hover { background: #24394f; border-color: #4d708c; }
    #sidebar .reset:active { background: #16232f; }
    #sidebar .note { color: #4f6f88; margin-top: 4px; }
  `;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'sidebar';
  root.innerHTML = `
    <button class="toggle" type="button"><span class="label">debug</span><span class="hint">H</span></button>
    <div class="body">
      <div class="sect day"></div>
      <div class="sect cloud"></div>
      <div class="note">temp debug ui</div>
    </div>
  `;
  document.body.appendChild(root);

  toggleEl = root.querySelector('.toggle') as HTMLButtonElement;
  bodyEl = root.querySelector('.body') as HTMLElement;

  const setHidden = (on: boolean): void => {
    hidden = on;
    root.classList.toggle('hidden', on);
    const label = root.querySelector('.label') as HTMLElement;
    label.textContent = on ? 'debug (hidden)' : 'debug';
  };

  toggleEl.addEventListener('click', () => setHidden(!hidden));

  // H hides it. The panel is temp scaffolding that gets in the way of looking at
  // the game, and the key has to work while the canvas has focus - which is
  // always, since the canvas fills the window - so this is on window rather than
  // on the panel, and it listens in the capture phase to get ahead of the game's
  // own input (input.ts binds H to nothing today, but that is not guaranteed to
  // stay true).
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'h' && e.key !== 'H') return;
    // Ignore it while a control has focus, or the keypress is swallowed typing
    // into something and the panel flickers.
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    setHidden(!hidden);
  }, true);

  return {
    root,
    sections: {
      day: root.querySelector('.sect.day') as HTMLElement,
      cloud: root.querySelector('.sect.cloud') as HTMLElement,
    },
    toggle: toggleEl,
  };
}

/** Show or hide the panel body, leaving the toggle reachable. */
export function hideSidebar(on: boolean): void {
  if (!bodyEl || !toggleEl) return;
  hidden = on;
  const root = bodyEl.parentElement as HTMLElement;
  root.classList.toggle('hidden', on);
  const label = root.querySelector('.label') as HTMLElement;
  label.textContent = on ? 'debug (hidden)' : 'debug';
}
