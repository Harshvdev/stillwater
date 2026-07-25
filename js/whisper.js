function $(s) { return document.querySelector(s); }

export const AMB = [
  'the water keeps your name.',
  'somewhere, a seed dreams of you.',
  'time moves differently when you are not watching.',
  'what you tend here tends you.',
  'the wind was asking about you.',
  'even the stones are patient.',
  'this world breathes because you do.',
  'somewhere behind you, a flower opened.',
  'the sea forgets nothing, and forgives everything.'
];

export const GATH = [
  'the tree rests now, a while.',
  'taken gently, given back in time.',
  'a small kindness to the ground.',
  'it lets go without a sound.'
];

export const MEM = {
  tree: 'something patient begins.',
  flower: 'color is a kind of memory.',
  song: 'the world leans in to listen.',
  night: 'stay. the dark here is soft.',
  rain: 'even skies need to let go.',
  ruin: 'even broken things give shelter.',
  bond: 'something wary chose to stay.'
};

export const memSet = {};

let wQ = [];
let wBusy = false;

function pump() {
  const wEl = $('#whisper');
  if (!wEl || wBusy || !wQ.length) return;
  wBusy = true;
  wEl.textContent = wQ.shift();
  wEl.classList.add('show');
  setTimeout(() => {
    wEl.classList.remove('show');
    setTimeout(() => {
      wBusy = false;
      pump();
    }, 1100);
  }, 4800);
}

export function whisper(t) {
  wQ.push(t);
  pump();
}

export function mem(id) {
  if (memSet[id]) return;
  memSet[id] = 1;
  if (MEM[id]) whisper(MEM[id]);
}

export function setMemSet(loadedMem) {
  if (loadedMem) {
    Object.assign(memSet, loadedMem);
  }
}
