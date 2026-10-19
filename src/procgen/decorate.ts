// Zone decoration: coral and glowmoss in the Deep, pews and libraries in the Cloister,
// kelp and smugglers' camps in the caves, gorse and trees on the Surface.

import { fbm } from '../core/noise.ts';
import type { Noise2 } from '../core/noise.ts';
import { chance, int, range } from '../core/rng.ts';
import type { RngState } from '../core/rng.ts';
import { isWater } from '../core/floor.ts';
import { T, TERRAIN } from '../core/terrain.ts';
import type { FloorState } from '../core/types.ts';
import type { P, Placed } from './carve.ts';

function openNeighbours(f: FloorState, x: number, y: number): number {
  let n = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= f.w || ny >= f.h) continue;
      if (TERRAIN[f.terrain[ny * f.w + nx] as number]?.walk) n++;
    }
  }
  return n;
}

function isFloorish(t: number): boolean {
  return t === T.FLOOR || t === T.SAND || t === T.GRASS || t === T.GLOWMOSS;
}

/** Noise-patch vegetation: groves, not salt-and-pepper. */
function patches(f: FloorState, noise: Noise2, rng: RngState, scale: number, threshold: number, fill: number, v: number, pred: (i: number) => boolean): void {
  for (let i = 0; i < f.w * f.h; i++) {
    if (!pred(i)) continue;
    const x = i % f.w;
    const y = (i - x) / f.w;
    if (fbm(noise, x * scale + 91.7, y * scale - 13.3, 2) > threshold && chance(rng, fill)) f.terrain[i] = v;
  }
}

export function decorateDeep(f: FloorState, noise: Noise2, rng: RngState, protect: Set<number>): void {
  // Coral on cave walls.
  for (let i = 0; i < f.w * f.h; i++) {
    if ((f.terrain[i] as number) !== T.WALL) continue;
    const x = i % f.w;
    const y = (i - x) / f.w;
    if (openNeighbours(f, x, y) === 0) continue;
    if (fbm(noise, x * 0.18 + 40, y * 0.18, 2) > 0.1 && chance(rng, 0.75)) f.terrain[i] = T.CORAL;
  }
  // Silt in the low places.
  for (let i = 0; i < f.w * f.h; i++) if ((f.terrain[i] as number) === T.FLOOR && (f.elev[i] as number) <= 1) f.terrain[i] = T.SAND;
  patches(f, noise, rng, 0.2, 0.2, 0.55, T.GLOWMOSS, (i) => isFloorish(f.terrain[i] as number) && !isWater(f, i) && !protect.has(i));
  patches(f, noise, rng, 0.16, 0.35, 0.6, T.BRUSH, (i) => isFloorish(f.terrain[i] as number) && !protect.has(i));
}

export function decorateCloister(f: FloorState, noise: Noise2, rng: RngState, rooms: Placed[], protect: Set<number>): void {
  for (const r of rooms) {
    const style = r.kind === 'hall' ? 'nave' : r.kind === 'rect' ? (['library', 'crypt', 'store', 'plain'][int(rng, 4)] as string) : r.kind === 'octagon' || r.kind === 'circle' ? 'chapel' : 'plain';
    const inner = r.tiles.filter((p) => {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (TERRAIN[f.terrain[(p.y + dy) * f.w + p.x + dx] as number]?.walk || (f.terrain[(p.y + dy) * f.w + p.x + dx] as number) === T.PILLAR) n++;
      return n === 9;
    });
    const edge = r.tiles.filter((p) => !inner.includes(p));
    const safe = (p: P): boolean => !protect.has(p.y * f.w + p.x) && Math.abs(p.x - r.door.x) + Math.abs(p.y - r.door.y) > 2;
    if (style === 'nave') {
      // Rows of pews with an aisle.
      const ys = [...new Set(inner.map((p) => p.y))].sort((a, b) => a - b);
      const xs = inner.map((p) => p.x);
      const mid = Math.round((Math.min(...xs) + Math.max(...xs)) / 2);
      for (const y of ys) {
        if (y % 2 !== 0) continue;
        for (const p of inner) if (p.y === y && Math.abs(p.x - mid) > 1 && safe(p) && (f.terrain[p.y * f.w + p.x] as number) === T.FLOOR) f.terrain[p.y * f.w + p.x] = T.PEW;
      }
    } else if (style === 'library') {
      for (const p of edge) if (safe(p) && chance(rng, 0.55)) f.terrain[p.y * f.w + p.x] = T.BOOKSHELF;
    } else if (style === 'crypt') {
      for (const p of inner) if (safe(p) && p.x % 3 === 0 && p.y % 2 === 0) f.terrain[p.y * f.w + p.x] = T.TOMB;
    } else if (style === 'store') {
      for (const p of edge) if (safe(p) && chance(rng, 0.25)) f.terrain[p.y * f.w + p.x] = T.BARREL;
    } else if (style === 'chapel') {
      const c = r.center;
      if (safe(c) && TERRAIN[f.terrain[c.y * f.w + c.x] as number]?.walk) f.terrain[c.y * f.w + c.x] = chance(rng, 0.5) ? T.STATUE : T.BRAZIER;
    }
    // Some doorways get doors.
    if (chance(rng, 0.55) && !protect.has(r.door.y * f.w + r.door.x)) f.terrain[r.door.y * f.w + r.door.x] = T.DOOR;
  }
  // Wall lamps.
  for (let i = 0; i < f.w * f.h; i++) {
    if ((f.terrain[i] as number) !== T.WALL) continue;
    const x = i % f.w;
    const y = (i - x) / f.w;
    if (openNeighbours(f, x, y) >= 3 && chance(rng, 0.035)) f.terrain[i] = T.WALL_LAMP;
  }
  // Overgrowth where the cloister has collapsed.
  patches(f, noise, rng, 0.14, 0.38, 0.6, T.GRASS, (i) => (f.terrain[i] as number) === T.FLOOR && !protect.has(i));
  patches(f, noise, rng, 0.14, 0.5, 0.5, T.BRUSH, (i) => (f.terrain[i] as number) === T.GRASS && !protect.has(i));
}

export function decorateWreck(f: FloorState, noise: Noise2, rng: RngState, rooms: Placed[], protect: Set<number>): void {
  for (let i = 0; i < f.w * f.h; i++) if ((f.terrain[i] as number) === T.FLOOR && (f.elev[i] as number) <= 3) f.terrain[i] = T.SAND;
  // Smugglers' camps: planking, barrels and a brazier.
  for (const r of rooms) {
    if (!chance(rng, 0.7)) continue;
    for (const p of r.tiles) {
      const i = p.y * f.w + p.x;
      if (isFloorish(f.terrain[i] as number)) f.terrain[i] = T.PLANKS;
    }
    const edge = r.tiles.filter((p) => !protect.has(p.y * f.w + p.x) && Math.abs(p.x - r.door.x) + Math.abs(p.y - r.door.y) > 2);
    for (let k = 0; k < range(rng, 1, 3) && edge.length; k++) {
      const p = edge.splice(int(rng, edge.length), 1)[0] as P;
      f.terrain[p.y * f.w + p.x] = T.BARREL;
    }
    const c = r.center;
    if (!protect.has(c.y * f.w + c.x) && (f.terrain[c.y * f.w + c.x] as number) === T.PLANKS) f.terrain[c.y * f.w + c.x] = T.BRAZIER;
  }
  patches(f, noise, rng, 0.17, 0.25, 0.65, T.BRUSH, (i) => isFloorish(f.terrain[i] as number) && (f.elev[i] as number) <= 5 && !protect.has(i));
  patches(f, noise, rng, 0.2, 0.3, 0.6, T.GRASS, (i) => (f.terrain[i] as number) === T.FLOOR && !protect.has(i));
  for (let i = 0; i < f.w * f.h; i++) {
    if ((f.terrain[i] as number) !== T.WALL) continue;
    const x = i % f.w;
    const y = (i - x) / f.w;
    if (openNeighbours(f, x, y) >= 3 && chance(rng, 0.02)) f.terrain[i] = T.WALL_LAMP;
  }
}

export function decorateSurface(f: FloorState, noise: Noise2, rng: RngState, protect: Set<number>): void {
  patches(f, noise, rng, 0.15, 0.3, 0.6, T.BRUSH, (i) => (f.terrain[i] as number) === T.GRASS && !protect.has(i) && (f.elev[i] as number) >= 1);
  for (let i = 0; i < f.w * f.h; i++) {
    if ((f.terrain[i] as number) !== T.GRASS || protect.has(i)) continue;
    const x = i % f.w;
    if (x < 10) continue;
    if (chance(rng, 0.025)) f.terrain[i] = T.TREE;
  }
  // Wet rock at the waterline.
  for (let i = 0; i < f.w * f.h; i++) if ((f.terrain[i] as number) === T.GRASS && (f.elev[i] as number) <= 0) f.terrain[i] = T.SAND;
}
