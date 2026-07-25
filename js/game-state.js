import { SEAS_TINT } from './constants.js';

export const INITZ = window.innerWidth < 760 ? 0.85 : 1.2;

export const S = {
  seed: (Math.random() * 1e9) | 0,
  worldDay: 0.22
};

export const view = {
  z: INITZ,
  zt: INITZ,
  cx: 0,
  cy: 0,
  tx: 0,
  ty: 0
};

export const state = {
  gt: 0,
  daylight: 1,
  nightF: 0,
  dusk: 0,
  sTint: SEAS_TINT[0],
  curSeason: 0,
  rainAmt: 0,
  windAmt: 0.5,
  rainState: 0,
  rainT: 0,
  rainCd: 80 + Math.random() * 80,
  storm: 0,
  prevNight: 0,
  loaded: false,
  hoverEnt: null,
  lastSing: -9
};

export const regrow = {};
export const ripples = [];
export const mouse = { x: -999, y: -999 };
