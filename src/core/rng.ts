// Deterministic, serialisable randomness.
//
// All gameplay randomness flows through an RngState stored in GameState, so a run is
// fully reproducible from its seed plus the command log. State is plain data (four
// uint32 words) so it survives JSON and structuredClone.
//
// Generator: sfc32 (Chris Doty-Humphrey's Small Fast Counting generator).

export interface RngState {
  a: number;
  b: number;
  c: number;
  d: number;
}

/** splitmix32 step — used to expand a single seed into generator state. */
function splitmix32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
}

export function seedRng(seed: number): RngState {
  const sm = splitmix32(seed);
  const r: RngState = { a: sm(), b: sm(), c: sm(), d: sm() };
  for (let i = 0; i < 12; i++) nextU32(r);
  return r;
}

export function cloneRng(r: RngState): RngState {
  return { a: r.a, b: r.b, c: r.c, d: r.d };
}

/** Next raw 32-bit unsigned integer. Mutates r. */
export function nextU32(r: RngState): number {
  const t = (((r.a + r.b) >>> 0) + r.d) >>> 0;
  r.d = (r.d + 1) >>> 0;
  r.a = r.b ^ (r.b >>> 9);
  r.b = (r.c + (r.c << 3)) >>> 0;
  r.c = ((r.c << 21) | (r.c >>> 11)) >>> 0;
  r.c = (r.c + t) >>> 0;
  return t;
}

/** Float in [0, 1). */
export function float(r: RngState): number {
  return nextU32(r) / 4294967296;
}

/** Integer in [0, n). n must be >= 1. */
export function int(r: RngState, n: number): number {
  if (n <= 1) return 0;
  return Math.floor(float(r) * n);
}

/** Integer in [lo, hi] inclusive. */
export function range(r: RngState, lo: number, hi: number): number {
  if (hi <= lo) return lo;
  return lo + int(r, hi - lo + 1);
}

export function chance(r: RngState, p: number): boolean {
  if (p <= 0) return false;
  if (p >= 1) return true;
  return float(r) < p;
}

export function pick<T>(r: RngState, arr: readonly T[]): T {
  if (arr.length === 0) throw new Error('pick() on empty array');
  return arr[int(r, arr.length)] as T;
}

/** Returns a new shuffled array (Fisher–Yates). */
export function shuffled<T>(r: RngState, arr: readonly T[]): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = int(r, i + 1);
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}

export function weighted<T>(r: RngState, entries: readonly (readonly [T, number])[]): T {
  let total = 0;
  for (const [, w] of entries) total += Math.max(0, w);
  if (total <= 0) throw new Error('weighted() with no positive weights');
  let roll = float(r) * total;
  for (const [v, w] of entries) {
    if (w <= 0) continue;
    roll -= w;
    if (roll < 0) return v;
  }
  // Floating point fallthrough: return the last positive entry.
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e && e[1] > 0) return e[0];
  }
  throw new Error('unreachable');
}

/** Picks k distinct elements (order random). */
export function sample<T>(r: RngState, arr: readonly T[], k: number): T[] {
  return shuffled(r, arr).slice(0, Math.max(0, Math.min(k, arr.length)));
}

// ---------------------------------------------------------------------------
// Seed hashing: derive independent sub-seeds (e.g. per floor) from the run seed.

export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Mixes any number of numeric/string parts into a well-distributed 32-bit seed. */
export function hashSeed(...parts: (number | string)[]): number {
  let h = 0x9e3779b9;
  for (const p of parts) {
    const v = typeof p === 'number' ? p >>> 0 : hashString(p);
    h ^= v + 0x9e3779b9 + ((h << 6) >>> 0) + (h >>> 2);
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
    h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
    h = (h ^ (h >>> 15)) >>> 0;
  }
  return h >>> 0;
}

/** Human-friendly seed from arbitrary text (used for "enter a seed"). */
export function seedFromText(text: string): number {
  const t = text.trim();
  if (/^\d+$/.test(t)) return Number(t) >>> 0;
  return hashString(t.toLowerCase());
}
