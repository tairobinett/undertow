// Floor generation orchestrator: layout → elevation → bridges → decoration → validation →
// regions → population. Every attempt is seeded from (run seed, floor index, attempt), so a
// floor never depends on gameplay randomness. Failed validations reroll with a sub-seed.

import { TIDE_INTERVAL, zoneForFloor } from '../content/zones.ts';
import { createFloor, isWater, rebuildOcc } from '../core/floor.ts';
import { makeNoise, fbm } from '../core/noise.ts';
import { hashSeed, pick, seedRng } from '../core/rng.ts';
import { T, TERRAIN } from '../core/terrain.ts';
import type { FloorState, GameState } from '../core/types.ts';
import { UNREACHABLE } from '../core/dijkstra.ts';
import type { Canvas, P } from './carve.ts';
import { layoutCaves, layoutCloister, layoutSurface, layoutWreck } from './layouts.ts';
import type { Layout } from './layouts.ts';
import { computeElevation, floorDistances, layMainPath, tagRegions, walkable } from './analyze.ts';
import type { ElevationOpts } from './analyze.ts';
import { decorateCloister, decorateDeep, decorateSurface, decorateWreck } from './decorate.ts';
import { populate } from './populate.ts';

export interface GenReport {
  attempts: number;
  mainPathLength: number;
  reason?: string;
}

const ELEV: Record<string, ElevationOpts> = {
  caves: { maxE: 9, amp: 1.5, basins: 4, basinDepth: 3, basinRadius: [2.5, 4.5] },
  cloister: { maxE: 9, amp: 0.8, basins: 2, basinDepth: 2, basinRadius: [2, 3.5] },
  wreck: { maxE: 10, amp: 1.8, basins: 5, basinDepth: 3, basinRadius: [3, 5.5] },
  surface: { maxE: 10, amp: 1, basins: 0, basinDepth: 0, basinRadius: [0, 0] },
};

export let lastReport: GenReport = { attempts: 0, mainPathLength: 0 };

export function generateFloor(state: GameState, index: number, mods: string[]): FloorState {
  let reason = '';
  for (let attempt = 0; attempt < 40; attempt++) {
    const seed = hashSeed(state.seed, 'floor', index, attempt);
    const nextIdBefore = state.nextId;
    const res = tryGenerate(state, index, mods, seed);
    if (typeof res !== 'string') {
      lastReport = { attempts: attempt + 1, mainPathLength: res.len };
      return res.f;
    }
    reason = res;
    state.nextId = nextIdBefore;
  }
  throw new Error(`floor ${index} generation failed: ${reason}`);
}

/** Removes open pockets that can't be reached from the entry (walking or swimming). */
function prunePockets(f: FloorState, entry: P): void {
  const pass = (i: number): boolean => walkable(f, i) || (f.terrain[i] as number) === T.PILLAR || (f.terrain[i] as number) === T.STATUE;
  const d = floorDistances(f, [entry], pass);
  for (let i = 0; i < f.w * f.h; i++) {
    if ((d[i] as number) >= UNREACHABLE && (TERRAIN[f.terrain[i] as number]?.walk ?? false)) f.terrain[i] = T.WALL;
  }
}

function surfaceElevation(f: FloorState, noise: ReturnType<typeof makeNoise>, entry: P, exit: P): void {
  for (let i = 0; i < f.w * f.h; i++) {
    const x = i % f.w;
    const y = (i - x) / f.w;
    if (!(TERRAIN[f.terrain[i] as number]?.flood ?? false)) {
      f.elev[i] = 20;
      continue;
    }
    if (x <= 3) {
      f.elev[i] = -4;
      continue;
    }
    const t = (x - 4) / Math.max(1, exit.x - 4);
    let e = Math.round(10 * Math.min(1, t) + fbm(noise, x * 0.1, y * 0.1, 2) * 1.2);
    if (Math.hypot(x - entry.x, y - entry.y) <= 2.5) e = 1;
    f.elev[i] = Math.max(-4, Math.min(12, e));
  }
  // The sea eats into the shore in a few coves.
  for (let y = 0; y < f.h; y++) {
    const reach = 4 + Math.round((fbm(noise, 3.3, y * 0.15, 2) + 1) * 2);
    for (let x = 1; x < reach; x++) {
      const i = y * f.w + x;
      if (TERRAIN[f.terrain[i] as number]?.flood) f.elev[i] = Math.min(f.elev[i] as number, -3);
    }
  }
}

function tryGenerate(state: GameState, index: number, mods: string[], seed: number): { f: FloorState; len: number } | string {
  const zone = zoneForFloor(index);
  const rng = seedRng(seed);
  const noise = makeNoise(hashSeed(seed, 'noise'));
  const [w, h] = zone.size;
  const f = createFloor(index, zone.id, w, h, seed);
  const c: Canvas = { w, h, t: f.terrain, rng };

  let lay: Layout;
  switch (zone.gen) {
    case 'caves':
      lay = layoutCaves(c, { bias: 0.42, width: 1.1, chambers: 4, sideRooms: 4, kinds: ['blob', 'circle', 'blob', 'ring'] });
      break;
    case 'cloister':
      lay = layoutCloister(c, { rooms: 13, boss: index === 5 });
      break;
    case 'wreck':
      lay = layoutWreck(c);
      break;
    case 'surface':
      lay = layoutSurface(c);
      break;
  }
  const { entry, exit } = lay;
  if (!walkable(f, entry.y * w + entry.x) || !walkable(f, exit.y * w + exit.x)) return 'anchors not open';
  prunePockets(f, entry);
  if (!walkable(f, exit.y * w + exit.x)) return 'exit pruned';

  // Elevation and the starting sea level.
  if (zone.gen === 'surface') surfaceElevation(f, noise, entry, exit);
  else computeElevation(f, rng, noise, entry, exit, ELEV[zone.gen] as ElevationOpts);
  if (index === 5 && lay.marks.arena) {
    // The Abbot's nave: a flooded aisle he can raise the faithful from.
    const a = lay.marks.arena;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const x = a.x + dx;
        const y = a.y + dy + 3;
        if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) continue;
        const i = y * w + x;
        if (TERRAIN[f.terrain[i] as number]?.flood) f.elev[i] = Math.min(f.elev[i] as number, -1);
      }
    }
  }
  f.waterLevel = mods.includes('flooded') ? 1 : 0;

  // A dry route must exist at the start: lay bridges over deep water on the cheapest path.
  const main = layMainPath(f, entry, exit);
  if (main.length === 0) return 'no main path';
  if (main.length < 20 && zone.gen !== 'surface') return 'main path too short';

  const protect = new Set<number>(main);
  for (const p of [entry, exit]) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) protect.add((p.y + dy) * w + p.x + dx);
  // The Abbot keeps his nave swept: no overgrowth in the arena for his censer to set alight.
  const arena = lay.marks.arena;
  if (arena) for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) if (dx * dx + dy * dy <= 36) protect.add((arena.y + dy) * w + arena.x + dx);
  switch (zone.gen) {
    case 'caves': decorateDeep(f, noise, rng, protect); break;
    case 'cloister': decorateCloister(f, noise, rng, lay.rooms, protect); break;
    case 'wreck': decorateWreck(f, noise, rng, lay.rooms, protect); break;
    case 'surface': decorateSurface(f, noise, rng, protect); break;
  }
  if (mods.includes('overgrown')) {
    for (let i = 0; i < w * h; i++) {
      const t = f.terrain[i] as number;
      if ((t === T.FLOOR || t === T.SAND || t === T.ASH) && !protect.has(i)) {
        const x = i % w;
        const y = (i - x) / w;
        const n = fbm(noise, x * 0.18 + 7, y * 0.18 - 3, 2);
        if (n > 0.15) f.terrain[i] = T.BRUSH;
        else if (n > -0.2) f.terrain[i] = zone.id === 'deep' ? T.GLOWMOSS : T.GRASS;
      }
    }
  }
  if (mods.includes('luminous')) {
    for (let i = 0; i < w * h; i++) if ((f.terrain[i] as number) === T.WALL && (i + index) % 3 === 0) f.terrain[i] = T.CORAL;
  }
  if (index === 0) {
    // The broken reliquary seal where the run begins.
    f.terrain[entry.y * w + entry.x] = T.FLOOR;
  }

  // Validate: the exit is reachable on foot (dry or shallow) at the start.
  const dryPass = (i: number): boolean => walkable(f, i) && !(isWater(f, i) && (f.waterLevel - (f.elev[i] as number)) >= 2);
  const dEntry = floorDistances(f, [entry], dryPass);
  const exitD = dEntry[exit.y * w + exit.x] as number;
  if (exitD >= UNREACHABLE) return 'exit unreachable after decoration';
  // Every walkable tile must be reachable when swimming is allowed (no sealed loot).
  prunePockets(f, entry);

  const reg = tagRegions(f, entry, main);
  const names = zone.floorNames.length > 1 ? zone.floorNames.slice(1) : zone.floorNames;
  // Don't reuse a name this run (the pick still takes one draw, so the layout is unaffected).
  const unused = names.filter((n) => !(state.usedNames ?? []).includes(n));
  f.name = index === 0 ? 'The Reliquary Floor' : pick(rng, unused.length ? unused : names);
  if (index === 5) f.name = 'The Abbot\'s Nave';
  if (index === 9) f.name = 'The Lighthouse Cliffs';
  f.entryX = entry.x;
  f.entryY = entry.y;
  f.tideInterval = Math.max(10, (TIDE_INTERVAL[index] ?? 20) - (mods.includes('rift') ? 2 : 0));
  f.tideTimer = f.tideInterval;
  f.ambient = zone.ambient + (mods.includes('luminous') ? 0.2 : 0);
  f.mods = [...mods];
  f.raining = zone.id === 'surface';
  rebuildOcc(f);
  populate(state, f, rng, reg, entry, exit, index, mods, lay.marks);
  rebuildOcc(f);
  return { f, len: exitD };
}
