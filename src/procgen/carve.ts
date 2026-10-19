// Layout carving toolkit: target-biased drunkard walks, a room-shape library, door-aligned
// accretion, and cellular-automata blobs. Operates on a terrain array with its own RNG.

import { int, float, range, chance } from '../core/rng.ts';
import type { RngState } from '../core/rng.ts';
import { T } from '../core/terrain.ts';

export interface Canvas {
  w: number;
  h: number;
  t: Uint8Array;
  rng: RngState;
}

export interface P {
  x: number;
  y: number;
}

const MARGIN = 1;

export function inside(c: Canvas, x: number, y: number, margin = MARGIN): boolean {
  return x >= margin && y >= margin && x < c.w - margin && y < c.h - margin;
}

export function at(c: Canvas, x: number, y: number): number {
  return c.t[y * c.w + x] as number;
}

export function set(c: Canvas, x: number, y: number, v: number): void {
  if (x < 0 || y < 0 || x >= c.w || y >= c.h) return;
  c.t[y * c.w + x] = v;
}

export function isOpen(v: number): boolean {
  return v !== T.WALL && v !== T.VOID;
}

/** Carves a disc of floor. */
export function carveDisc(c: Canvas, cx: number, cy: number, r: number, v: number = T.FLOOR): void {
  const ri = Math.ceil(r);
  for (let y = cy - ri; y <= cy + ri; y++) {
    for (let x = cx - ri; x <= cx + ri; x++) {
      if (!inside(c, x, y)) continue;
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r + 0.3) set(c, x, y, v);
    }
  }
}

/**
 * Target-biased drunkard walk from a to b. With probability `bias` each step heads toward
 * the target, otherwise it wanders. Low bias = blobby meadows; high bias = rivers/tunnels.
 * Returns the visited path.
 */
export function walk(c: Canvas, a: P, b: P, bias: number, radius: number, maxSteps = 3000): P[] {
  let x = a.x;
  let y = a.y;
  const path: P[] = [];
  for (let s = 0; s < maxSteps; s++) {
    carveDisc(c, x, y, radius);
    path.push({ x, y });
    if (x === b.x && y === b.y) break;
    if (float(c.rng) < bias) {
      const dx = b.x - x;
      const dy = b.y - y;
      if (Math.abs(dx) > Math.abs(dy) || (Math.abs(dx) === Math.abs(dy) && chance(c.rng, 0.5))) x += Math.sign(dx);
      else y += Math.sign(dy);
    } else {
      const k = int(c.rng, 4);
      x += k === 0 ? 1 : k === 1 ? -1 : 0;
      y += k === 2 ? 1 : k === 3 ? -1 : 0;
    }
    x = Math.max(2, Math.min(c.w - 3, x));
    y = Math.max(2, Math.min(c.h - 3, y));
  }
  return path;
}

// ---------------------------------------------------------------------------
// Shape library. Each shape is a list of relative open tiles (plus optional features).

export interface Shape {
  tiles: P[];
  /** Relative positions of pillars (solid) inside the room. */
  pillars?: P[];
  kind: string;
}

export function shapeRect(rng: RngState, minS: number, maxS: number): Shape {
  const w = range(rng, minS, maxS);
  const h = range(rng, minS, Math.max(minS, maxS - 1));
  const tiles: P[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) tiles.push({ x, y });
  return { tiles, kind: 'rect' };
}

export function shapeCircle(rng: RngState, minR: number, maxR: number): Shape {
  const r = range(rng, minR, maxR) + 0.4;
  const tiles: P[] = [];
  const ri = Math.ceil(r);
  for (let y = -ri; y <= ri; y++) for (let x = -ri; x <= ri; x++) if (x * x + y * y <= r * r) tiles.push({ x, y });
  return { tiles, kind: 'circle' };
}

/** A ring around a solid core — good for kiting loops. */
export function shapeRing(rng: RngState, minR: number, maxR: number): Shape {
  const r = range(rng, Math.max(3, minR), Math.max(3, maxR)) + 0.4;
  const inner = Math.max(1, r - range(rng, 2, 3));
  const tiles: P[] = [];
  const ri = Math.ceil(r);
  for (let y = -ri; y <= ri; y++) {
    for (let x = -ri; x <= ri; x++) {
      const d2 = x * x + y * y;
      if (d2 <= r * r && d2 > inner * inner) tiles.push({ x, y });
    }
  }
  return { tiles, kind: 'ring' };
}

export function shapeCross(rng: RngState, minS: number, maxS: number): Shape {
  const len = range(rng, minS, maxS);
  const arm = range(rng, 1, 2);
  const tiles: P[] = [];
  for (let y = -len; y <= len; y++) for (let x = -arm; x <= arm; x++) tiles.push({ x, y });
  for (let x = -len; x <= len; x++) for (let y = -arm; y <= arm; y++) if (!tiles.some((q) => q.x === x && q.y === y)) tiles.push({ x, y });
  return { tiles, kind: 'cross' };
}

/** Rectangular hall with a grid of pillars. */
export function shapePillarHall(rng: RngState, minS: number, maxS: number): Shape {
  const w = range(rng, Math.max(7, minS), Math.max(8, maxS + 2));
  const h = range(rng, Math.max(5, minS), Math.max(6, maxS));
  const tiles: P[] = [];
  const pillars: P[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      tiles.push({ x, y });
      if (x > 0 && y > 0 && x < w - 1 && y < h - 1 && x % 2 === 1 && y % 2 === 1 && x > 1 && y > 1 && x < w - 2 && y < h - 2) pillars.push({ x, y });
    }
  }
  return { tiles, pillars, kind: 'hall' };
}

export function shapeOctagon(rng: RngState, minR: number, maxR: number): Shape {
  const r = range(rng, minR, maxR);
  const cut = Math.max(1, Math.floor(r / 2));
  const tiles: P[] = [];
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      if (Math.abs(x) + Math.abs(y) <= 2 * r - cut) tiles.push({ x, y });
    }
  }
  return { tiles, kind: 'octagon' };
}

/** Cellular-automata blob: organic cave chamber. */
export function shapeBlob(rng: RngState, w: number, h: number): Shape {
  let g = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = float(rng) < 0.55 ? 1 : 0;
  for (let it = 0; it < 4; it++) {
    const n = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let c = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            c += g[ny * w + nx] as number;
          }
        }
        const alive = g[y * w + x] === 1;
        n[y * w + x] = alive ? (c >= 3 ? 1 : 0) : c >= 5 ? 1 : 0;
      }
    }
    g = n;
  }
  // Keep the largest component.
  const comp = new Int32Array(w * h).fill(-1);
  let best = -1;
  let bestSize = 0;
  let id = 0;
  for (let i = 0; i < w * h; i++) {
    if (g[i] !== 1 || comp[i] !== -1) continue;
    const q = [i];
    comp[i] = id;
    let size = 0;
    while (q.length) {
      const j = q.pop() as number;
      size++;
      const x = j % w;
      const y = (j - x) / w;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const k = ny * w + nx;
        if (g[k] === 1 && comp[k] === -1) {
          comp[k] = id;
          q.push(k);
        }
      }
    }
    if (size > bestSize) {
      bestSize = size;
      best = id;
    }
    id++;
  }
  const tiles: P[] = [];
  for (let i = 0; i < w * h; i++) if (comp[i] === best) tiles.push({ x: i % w, y: Math.floor(i / w) });
  if (tiles.length < 6) return shapeCircle(rng, 2, 3);
  return { tiles, kind: 'blob' };
}

export function randomShape(rng: RngState, kinds: string[], size: number): Shape {
  const k = kinds[int(rng, kinds.length)] as string;
  switch (k) {
    case 'rect': return shapeRect(rng, Math.max(3, size - 2), size + 2);
    case 'circle': return shapeCircle(rng, Math.max(2, Math.floor(size / 2) - 1), Math.floor(size / 2) + 1);
    case 'ring': return shapeRing(rng, Math.floor(size / 2), Math.floor(size / 2) + 2);
    case 'cross': return shapeCross(rng, Math.max(2, Math.floor(size / 2)), Math.floor(size / 2) + 2);
    case 'hall': return shapePillarHall(rng, size, size + 3);
    case 'octagon': return shapeOctagon(rng, Math.max(2, Math.floor(size / 2)), Math.floor(size / 2) + 1);
    default: return shapeBlob(rng, size + 4, size + 2);
  }
}

// ---------------------------------------------------------------------------
// Accretion: attach a shape to the existing layout through a doorway.

export interface Placed {
  tiles: P[];
  door: P;
  kind: string;
  center: P;
  pillars: P[];
}

const CARDS: P[] = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];

/**
 * Tries to attach `shape` to the open area through a new doorway. The doorway sits on a wall
 * tile adjacent to existing open floor; the shape must not touch any existing open tile.
 */
export function accrete(c: Canvas, shape: Shape, attempts = 60, hallMin = 0, hallMax = 0): Placed | undefined {
  // Candidate door sites: wall tiles with open floor on exactly one cardinal side.
  const sites: { x: number; y: number; d: P }[] = [];
  for (let y = 2; y < c.h - 2; y++) {
    for (let x = 2; x < c.w - 2; x++) {
      if (isOpen(at(c, x, y))) continue;
      for (const d of CARDS) {
        const bx = x - d.x;
        const by = y - d.y;
        if (!isOpen(at(c, bx, by))) continue;
        const fx = x + d.x;
        const fy = y + d.y;
        if (!inside(c, fx, fy, 2) || isOpen(at(c, fx, fy))) continue;
        // Side walls around the door must be solid so doorways look like doorways.
        const s1 = at(c, x + d.y, y + d.x);
        const s2 = at(c, x - d.y, y - d.x);
        if (isOpen(s1) || isOpen(s2)) continue;
        sites.push({ x, y, d });
      }
    }
  }
  if (sites.length === 0) return undefined;
  for (let a = 0; a < attempts; a++) {
    const site = sites[int(c.rng, sites.length)] as { x: number; y: number; d: P };
    const d = site.d;
    const hall = hallMax > 0 ? range(c.rng, hallMin, hallMax) : 0;
    // Anchor: the shape tile most toward -d, i.e. nearest the door (median among ties).
    let best = Infinity;
    for (const t of shape.tiles) best = Math.min(best, t.x * d.x + t.y * d.y);
    const edge = shape.tiles.filter((t) => t.x * d.x + t.y * d.y === best);
    edge.sort((p, q) => p.x * d.y + p.y * d.x - (q.x * d.y + q.y * d.x));
    const anchor = edge[Math.floor(edge.length / 2)] as P;
    const ox = site.x + d.x * (1 + hall) - anchor.x;
    const oy = site.y + d.y * (1 + hall) - anchor.y;
    // Check space: every tile and its neighbours must be solid and inside.
    let ok = true;
    const occupied = new Set<number>();
    for (const t of shape.tiles) occupied.add((t.y + oy) * c.w + (t.x + ox));
    for (const t of shape.tiles) {
      const x = t.x + ox;
      const y = t.y + oy;
      if (!inside(c, x, y, 2)) {
        ok = false;
        break;
      }
      for (let dy = -1; dy <= 1 && ok; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (isOpen(at(c, nx, ny))) {
            ok = false;
            break;
          }
        }
      }
      if (!ok) break;
    }
    // The hallway tiles must be clear too.
    const hallTiles: P[] = [];
    for (let s = 1; s <= hall && ok; s++) {
      const hx = site.x + d.x * s;
      const hy = site.y + d.y * s;
      if (!inside(c, hx, hy, 2)) ok = false;
      hallTiles.push({ x: hx, y: hy });
    }
    if (!ok) continue;
    const placed: P[] = [];
    for (const t of shape.tiles) {
      set(c, t.x + ox, t.y + oy, T.FLOOR);
      placed.push({ x: t.x + ox, y: t.y + oy });
    }
    for (const h of hallTiles) set(c, h.x, h.y, T.FLOOR);
    set(c, site.x, site.y, T.FLOOR);
    let cx = 0;
    let cy = 0;
    for (const p of placed) {
      cx += p.x;
      cy += p.y;
    }
    const pillars = (shape.pillars ?? []).map((p) => ({ x: p.x + ox, y: p.y + oy }));
    return {
      tiles: [...placed, ...hallTiles],
      door: { x: site.x, y: site.y },
      kind: shape.kind,
      center: { x: Math.round(cx / placed.length), y: Math.round(cy / placed.length) },
      pillars,
    };
  }
  return undefined;
}

/** Punches extra doorways between separate open areas that share a thin wall (adds loops). */
export function addLoops(c: Canvas, dist: (x: number, y: number) => number, minGain: number, max: number): P[] {
  const out: P[] = [];
  const candidates: { x: number; y: number; gain: number }[] = [];
  for (let y = 2; y < c.h - 2; y++) {
    for (let x = 2; x < c.w - 2; x++) {
      if (isOpen(at(c, x, y))) continue;
      for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
        const a = at(c, x - dx, y - dy);
        const b = at(c, x + dx, y + dy);
        if (!isOpen(a) || !isOpen(b)) continue;
        const s1 = at(c, x + dy, y + dx);
        const s2 = at(c, x - dy, y - dx);
        if (isOpen(s1) || isOpen(s2)) continue;
        const da = dist(x - dx, y - dy);
        const db = dist(x + dx, y + dy);
        if (!Number.isFinite(da) || !Number.isFinite(db)) continue;
        const gain = Math.abs(da - db);
        if (gain >= minGain) candidates.push({ x, y, gain });
      }
    }
  }
  candidates.sort((p, q) => q.gain - p.gain || p.y - q.y || p.x - q.x);
  for (const cand of candidates) {
    if (out.length >= max) break;
    if (out.some((o) => Math.abs(o.x - cand.x) + Math.abs(o.y - cand.y) < 6)) continue;
    set(c, cand.x, cand.y, T.FLOOR);
    out.push({ x: cand.x, y: cand.y });
  }
  return out;
}

/** One smoothing pass: fills tiny wall specks and opens pinched single-tile gaps. */
export function smooth(c: Canvas, passes = 1): void {
  for (let p = 0; p < passes; p++) {
    const copy = new Uint8Array(c.t);
    for (let y = 1; y < c.h - 1; y++) {
      for (let x = 1; x < c.w - 1; x++) {
        let open = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && isOpen(copy[(y + dy) * c.w + x + dx] as number)) open++;
        const v = copy[y * c.w + x] as number;
        if (!isOpen(v) && open >= 6 && inside(c, x, y, 2)) c.t[y * c.w + x] = T.FLOOR;
        else if (isOpen(v) && open <= 1) c.t[y * c.w + x] = T.WALL;
      }
    }
  }
}
