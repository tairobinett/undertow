// Colour helpers for the renderer (cosmetic only).

export type RGB = [number, number, number];

const cache = new Map<string, RGB>();

export function hex(h: string): RGB {
  const c = cache.get(h);
  if (c) return c;
  const s = h.startsWith('#') ? h.slice(1) : h;
  const full = s.length === 3 ? s.split('').map((ch) => ch + ch).join('') : s;
  const v: RGB = [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
  cache.set(h, v);
  return v;
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function scale(a: RGB, k: number): RGB {
  return [a[0] * k, a[1] * k, a[2] * k];
}

export function mul(a: RGB, l: RGB): RGB {
  return [(a[0] * l[0]) / 255, (a[1] * l[1]) / 255, (a[2] * l[2]) / 255];
}

export function css(c: RGB, alpha = 1): string {
  const r = Math.max(0, Math.min(255, Math.round(c[0])));
  const g = Math.max(0, Math.min(255, Math.round(c[1])));
  const b = Math.max(0, Math.min(255, Math.round(c[2])));
  return alpha >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
}

export function lum(c: RGB): number {
  return (c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114) / 255;
}

/** Deterministic per-tile hash in [0,1) for cosmetic variation. */
export function tileHash(x: number, y: number, salt = 0): number {
  let h = (x * 374761393 + y * 668265263 + salt * 2147483647) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
