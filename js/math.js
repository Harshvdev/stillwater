import { GRID } from './constants.js';

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export const lerp = (a, b, t) => a + (b - a) * t;
export const sm = (a, b, x) => {
  x = clamp((x - a) / (b - a), 0, 1);
  return x * x * (3 - 2 * x);
};

export function h2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const a = h2(xi, yi), b = h2(xi + 1, yi), c = h2(xi, yi + 1), d = h2(xi + 1, yi + 1);
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function fbm(x, y) {
  let v = 0, a = 0.5, f = 1;
  for (let i = 0; i < 4; i++) {
    v += a * vnoise(x * f, y * f);
    f *= 2.03;
    a *= 0.5;
  }
  return v;
}

export function soft(x, cx, cy, rx, ry, col) {
  x.save();
  x.translate(cx, cy);
  x.scale(rx, ry);
  const g = x.createRadialGradient(0, 0, 0, 0, 0, 1);
  g.addColorStop(0, col);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g;
  x.beginPath();
  x.arc(0, 0, 1, 0, TAU);
  x.fill();
  x.restore();
}

export function disc(x, cx, cy, r, col) {
  x.fillStyle = col;
  x.beginPath();
  x.arc(cx, cy, r, 0, TAU);
  x.fill();
}

export const mix3 = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t
];

export const rgb = (c) => 'rgb(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ')';
export const rgba = (c, a) => 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + a + ')';

export function tintInt(r, g, b) {
  return ((clamp(r, 0, 1) * 255 | 0) << 16) | ((clamp(g, 0, 1) * 255 | 0) << 8) | (clamp(b, 0, 1) * 255 | 0);
}

/* Isometric bounds state */
export const ISO = {
  HW: 12,
  HH: 6,
  CANW: 1728,
  CANH: 960,
  OFFX: 864,
  OFFY: 60
};

export function initIsoBounds(glctx) {
  const MAXTEX = (glctx && glctx.getParameter) ? glctx.getParameter(glctx.MAX_TEXTURE_SIZE) : 2048;
  const SAFE = Math.min(MAXTEX || 2048, 2048);
  let hw = clamp(Math.floor((SAFE - 48) / (2 * GRID)), 6, 16);
  if (hw % 2) hw--;
  hw = Math.max(6, hw);
  let hh = Math.max(3, Math.round(hw / 2));
  
  ISO.HW = hw;
  ISO.HH = hh;
  ISO.CANW = 2 * GRID * hw;
  ISO.CANH = 2 * GRID * hh + hh * 16;
  ISO.OFFX = ISO.CANW / 2;
  ISO.OFFY = hh * 10;
}

export function iso(gx, gy) {
  return {
    x: (gx - gy) * ISO.HW + ISO.OFFX,
    y: (gx + gy) * ISO.HH + ISO.OFFY
  };
}
