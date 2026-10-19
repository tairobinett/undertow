// Layout analysis: distances, elevation (the tide's shape), bridges, and region tags that
// drive encounter and loot placement.

import { dijkstraMap, NX, NY, pathFromMap, UNREACHABLE } from '../core/dijkstra.ts';
import { isDeep, isWater } from '../core/floor.ts';
import { fbm } from '../core/noise.ts';
import type { Noise2 } from '../core/noise.ts';
import { float, int, range } from '../core/rng.ts';
import type { RngState } from '../core/rng.ts';
import { T, TERRAIN } from '../core/terrain.ts';
import type { FloorState } from '../core/types.ts';
import { isOpen } from './carve.ts';
import type { Canvas, P } from './carve.ts';

export function walkable(f: FloorState, i: number): boolean {
  return TERRAIN[f.terrain[i] as number]?.walk ?? false;
}

/** BFS distances over open canvas tiles (8-connected). */
export function floodDistances(c: Canvas, from: P): Float64Array {
  return dijkstraMap(c.w, c.h, [from.y * c.w + from.x], (i) => (isOpen(c.t[i] as number) && (TERRAIN[c.t[i] as number]?.walk ?? false) ? 1 : Infinity));
}

export function floorDistances(f: FloorState, from: P[], passable: (i: number) => boolean): Float64Array {
  return dijkstraMap(f.w, f.h, from.map((p) => p.y * f.w + p.x), (i) => (passable(i) ? 1 : Infinity));
}

export interface ElevationOpts {
  maxE: number;
  amp: number;
  basins: number;
  basinDepth: number;
  basinRadius: [number, number];
}

/** Elevation rises from the entry (low) to the exit (high), with noise and carved basins. */
export function computeElevation(f: FloorState, rng: RngState, noise: Noise2, entry: P, exit: P, o: ElevationOpts): void {
  const pass = (i: number): boolean => walkable(f, i) || (f.terrain[i] as number) === T.PILLAR || (f.terrain[i] as number) === T.STATUE || (f.terrain[i] as number) === T.PEW || (f.terrain[i] as number) === T.TOMB || (f.terrain[i] as number) === T.TREE || (f.terrain[i] as number) === T.BARREL;
  const dE = floorDistances(f, [entry], pass);
  const dX = floorDistances(f, [exit], pass);
  const n = f.w * f.h;
  for (let i = 0; i < n; i++) {
    if (!(TERRAIN[f.terrain[i] as number]?.flood ?? false)) {
      f.elev[i] = 20;
      continue;
    }
    const a = dE[i] as number;
    const b = dX[i] as number;
    let t = 0.5;
    if (a < UNREACHABLE && b < UNREACHABLE && a + b > 0) t = a / (a + b);
    const x = i % f.w;
    const y = (i - x) / f.w;
    const nz = fbm(noise, x * 0.11, y * 0.11, 3);
    // Ease so the middle of the floor is a long, gentle climb.
    const eased = t * t * (3 - 2 * t) * 0.35 + t * 0.65;
    let e = Math.round(o.maxE * eased + nz * o.amp);
    const de = Math.hypot(x - entry.x, y - entry.y);
    const dx = Math.hypot(x - exit.x, y - exit.y);
    if (de <= 3) e = Math.max(0, Math.min(e, 1));
    if (de <= 1.5) e = 1;
    if (dx <= 3) e = Math.max(e, o.maxE);
    f.elev[i] = Math.max(-6, Math.min(14, e));
  }
  // Basins (pools) in side areas.
  const cands: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!walkable(f, i)) continue;
    const x = i % f.w;
    const y = (i - x) / f.w;
    if (Math.hypot(x - entry.x, y - entry.y) < 7 || Math.hypot(x - exit.x, y - exit.y) < 7) continue;
    cands.push(i);
  }
  for (let k = 0; k < o.basins && cands.length > 0; k++) {
    const c = cands[int(rng, cands.length)] as number;
    const cx = c % f.w;
    const cy = (c - cx) / f.w;
    const r = o.basinRadius[0] + float(rng) * (o.basinRadius[1] - o.basinRadius[0]);
    const depth = o.basinDepth + range(rng, 0, 2);
    const ri = Math.ceil(r);
    for (let y = cy - ri; y <= cy + ri; y++) {
      for (let x = cx - ri; x <= cx + ri; x++) {
        if (x < 0 || y < 0 || x >= f.w || y >= f.h) continue;
        const i = y * f.w + x;
        if (!(TERRAIN[f.terrain[i] as number]?.flood ?? false)) continue;
        const d = Math.hypot(x - cx, y - cy);
        if (d > r) continue;
        const drop = Math.round(depth * (1 - (d / (r + 0.5)) ** 2));
        const target = Math.min(f.elev[i] as number, -drop + 1);
        f.elev[i] = Math.max(-6, Math.min(f.elev[i] as number, target));
      }
    }
  }
}

/**
 * Ensures a dry walking route from entry to exit at the starting water level by laying
 * bridges over any deep water the cheapest route has to cross. Returns the main path.
 */
export function layMainPath(f: FloorState, entry: P, exit: P): number[] {
  const cost = (i: number): number => {
    if (!walkable(f, i)) return Infinity;
    if (isDeep(f, i)) return 40;
    if (isWater(f, i)) return 2;
    return 1;
  };
  const dist = dijkstraMap(f.w, f.h, [exit.y * f.w + exit.x], cost);
  const start = entry.y * f.w + entry.x;
  if ((dist[start] as number) >= UNREACHABLE) return [];
  const path = [start, ...pathFromMap(f.w, f.h, dist, start, 2000)];
  for (const i of path) {
    if (isDeep(f, i)) f.terrain[i] = T.BRIDGE;
  }
  return path;
}

export interface Regions {
  main: Set<number>;
  distMain: Float64Array;
  distEntry: Float64Array;
  deadEnds: number[];
  chokepoints: number[];
  grottos: number[];
  high: number[];
  water: number[];
  deepWater: number[];
  shore: number[];
  land: number[];
}

export function tagRegions(f: FloorState, entry: P, mainPath: number[]): Regions {
  const n = f.w * f.h;
  const passDry = (i: number): boolean => walkable(f, i);
  const main = new Set(mainPath);
  const distMain = dijkstraMap(f.w, f.h, mainPath, (i) => (passDry(i) ? 1 : Infinity));
  const distEntry = floorDistances(f, [entry], passDry);
  const deadEnds: number[] = [];
  const chokepoints: number[] = [];
  const grottos: number[] = [];
  const high: number[] = [];
  const water: number[] = [];
  const deepWater: number[] = [];
  const shore: number[] = [];
  const land: number[] = [];
  let maxE = -99;
  for (let i = 0; i < n; i++) if (walkable(f, i)) maxE = Math.max(maxE, f.elev[i] as number);
  for (let i = 0; i < n; i++) {
    if (!walkable(f, i)) continue;
    const x = i % f.w;
    const y = (i - x) / f.w;
    const wet = isWater(f, i);
    if (wet) {
      water.push(i);
      if (isDeep(f, i)) deepWater.push(i);
      continue;
    }
    land.push(i);
    let openN = 0;
    let wetN = 0;
    for (let k = 0; k < 8; k++) {
      const nx = x + (NX[k] as number);
      const ny = y + (NY[k] as number);
      if (nx < 0 || ny < 0 || nx >= f.w || ny >= f.h) continue;
      const j = ny * f.w + nx;
      if (walkable(f, j)) openN++;
      if (isWater(f, j)) wetN++;
    }
    if (wetN > 0) shore.push(i);
    const dm = distMain[i] as number;
    if (dm < UNREACHABLE && dm >= 3 && openN <= 3) deadEnds.push(i);
    const nOpen = (dx: number, dy: number): boolean => {
      const nx = x + dx;
      const ny = y + dy;
      return nx >= 0 && ny >= 0 && nx < f.w && ny < f.h && walkable(f, ny * f.w + nx);
    };
    const ns = nOpen(0, -1) && nOpen(0, 1) && !nOpen(-1, 0) && !nOpen(1, 0);
    const ew = nOpen(-1, 0) && nOpen(1, 0) && !nOpen(0, -1) && !nOpen(0, 1);
    if ((ns || ew) && openN <= 4) chokepoints.push(i);
    const e = f.elev[i] as number;
    if (e <= 2 && !main.has(i)) grottos.push(i);
    if (e >= maxE - 3) high.push(i);
  }
  return { main, distMain, distEntry, deadEnds, chokepoints, grottos, high, water, deepWater, shore, land };
}
