// Floor queries and mutation helpers. Every position change goes through setPos() so the
// occupancy grid stays consistent.

import type { Actor, FloorState, FloorItem, Feature, MoveMode, ZoneId } from './types.ts';
import { GAS, GASES, SURF, T, TERRAIN } from './terrain.ts';

export function idx(f: FloorState, x: number, y: number): number {
  return y * f.w + x;
}

export function inBounds(f: FloorState, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < f.w && y < f.h;
}

export function xy(f: FloorState, i: number): { x: number; y: number } {
  const x = i % f.w;
  return { x, y: (i - x) / f.w };
}

export function createFloor(index: number, zone: ZoneId, w: number, h: number, seed: number): FloorState {
  const n = w * h;
  return {
    index,
    zone,
    name: '',
    w,
    h,
    seed,
    terrain: new Uint8Array(n).fill(T.WALL),
    elev: new Int8Array(n),
    surface: new Uint8Array(n),
    surfaceT: new Uint8Array(n),
    fire: new Uint8Array(n),
    heat: new Uint8Array(n),
    gas: new Uint8Array(n),
    gasAmt: new Uint8Array(n),
    seen: new Uint8Array(n),
    vis: new Uint8Array(n),
    light: new Uint8Array(n),
    occ: new Int32Array(n),
    los: new Uint8Array(n),
    waterLevel: 0,
    tideInterval: 24,
    tideTimer: 24,
    tidePaused: 0,
    ambient: 0,
    mods: [],
    actors: [],
    items: [],
    features: [],
    entryX: 0,
    entryY: 0,
    turnArrived: 0,
    raining: false,
  };
}

// ---------------------------------------------------------------------------
// Water

/** Water depth at tile (0 = dry). Ignores ice/bridges; use the predicates below for gameplay. */
export function rawDepth(f: FloorState, i: number): number {
  const d = TERRAIN[f.terrain[i] as number];
  if (!d || !d.flood) return 0;
  const depth = f.waterLevel - (f.elev[i] as number);
  return depth > 0 ? depth : 0;
}

/**
 * Bridge decks stay dry until the sea has risen over the highest ground (walkable ground
 * reaches about 11); then they go under too, and nowhere on the floor is dry.
 */
export const BRIDGE_DECK = 12;

/** Tile holds open water (not iced over, not a bridge above the water). */
export function isWater(f: FloorState, i: number): boolean {
  if (rawDepth(f, i) <= 0) return false;
  if (f.surface[i] === SURF.ICE) return false;
  const t = f.terrain[i] as number;
  return !TERRAIN[t]?.bridge || f.waterLevel >= BRIDGE_DECK;
}

/** Deep water: creatures here are swimming. */
export function isDeep(f: FloorState, i: number): boolean {
  return isWater(f, i) && rawDepth(f, i) >= 2;
}

export function isShallow(f: FloorState, i: number): boolean {
  return isWater(f, i) && rawDepth(f, i) === 1;
}

// ---------------------------------------------------------------------------
// Movement and sight

export function terrainWalkable(f: FloorState, i: number): boolean {
  return TERRAIN[f.terrain[i] as number]?.walk ?? false;
}

/** Whether a creature with this movement mode may occupy tile i (ignores other actors). */
export function canStand(f: FloorState, i: number, mode: MoveMode): boolean {
  const t = f.terrain[i] as number;
  const d = TERRAIN[t];
  if (!d) return false;
  switch (mode) {
    case 'walk':
      return d.walk;
    case 'swim':
      return d.walk && isWater(f, i);
    case 'amphibious':
      return d.walk;
    case 'fly':
      return d.walk;
    case 'phase':
      return t !== T.VOID;
  }
}

export function blocksSight(f: FloorState, i: number): boolean {
  const t = f.terrain[i] as number;
  if (TERRAIN[t]?.opaque) return true;
  const g = f.gas[i] as number;
  if (g !== GAS.NONE && (f.gasAmt[i] as number) >= (GASES[g]?.opaqueAt ?? 999)) return true;
  return false;
}

/** Projectiles and rays stop at these tiles. */
export function blocksShot(f: FloorState, i: number): boolean {
  const t = f.terrain[i] as number;
  const d = TERRAIN[t];
  if (!d) return true;
  return d.solid || t === T.DOOR || t === T.TREE || t === T.BARREL;
}

export function blocksGas(f: FloorState, i: number): boolean {
  const t = f.terrain[i] as number;
  return (TERRAIN[t]?.solid ?? true) || t === T.DOOR;
}

// ---------------------------------------------------------------------------
// Actors, items, features

export function actorAt(f: FloorState, x: number, y: number): Actor | undefined {
  if (!inBounds(f, x, y)) return undefined;
  const id = f.occ[y * f.w + x] as number;
  if (id === 0) return undefined;
  return f.actors.find((a) => a.id === id && !a.dead);
}

export function actorById(f: FloorState, id: number | undefined): Actor | undefined {
  if (id === undefined) return undefined;
  return f.actors.find((a) => a.id === id && !a.dead);
}

export function rebuildOcc(f: FloorState): void {
  f.occ.fill(0);
  for (const a of f.actors) {
    if (a.dead) continue;
    if (inBounds(f, a.x, a.y)) f.occ[a.y * f.w + a.x] = a.id;
  }
}

/** Moves (or places) an actor, keeping the occupancy grid consistent. */
export function setPos(f: FloorState, a: Actor, x: number, y: number): void {
  if (inBounds(f, a.x, a.y) && f.occ[a.y * f.w + a.x] === a.id) f.occ[a.y * f.w + a.x] = 0;
  a.x = x;
  a.y = y;
  if (!a.dead && inBounds(f, x, y)) f.occ[y * f.w + x] = a.id;
}

export function clearOcc(f: FloorState, a: Actor): void {
  if (inBounds(f, a.x, a.y) && f.occ[a.y * f.w + a.x] === a.id) f.occ[a.y * f.w + a.x] = 0;
}

export function itemAt(f: FloorState, x: number, y: number): FloorItem | undefined {
  return f.items.find((it) => it.x === x && it.y === y);
}

export function featureAt(f: FloorState, x: number, y: number): Feature | undefined {
  return f.features.find((ft) => ft.x === x && ft.y === y);
}

export function liveActors(f: FloorState): Actor[] {
  return f.actors.filter((a) => !a.dead);
}

/** Finds the nearest tile (by ring search) satisfying pred, starting at (x, y). */
export function nearestTile(
  f: FloorState,
  x: number,
  y: number,
  pred: (i: number) => boolean,
  maxR = 12,
): number {
  if (inBounds(f, x, y) && pred(y * f.w + x)) return y * f.w + x;
  for (let r = 1; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (!inBounds(f, nx, ny)) continue;
        const i = ny * f.w + nx;
        if (pred(i)) return i;
      }
    }
  }
  return -1;
}
