// Element reactions on tiles: one table-like function per element, used by everything
// (player abilities, thrown items, monster attacks, hazards). Same rules for everyone.

import { actorAt, actorById, idx, inBounds, isWater, rawDepth, xy } from './floor.ts';
import { addStatus, dealDamage, freezeTile, makeNoise } from './effects.ts';
import type { DmgSource } from './effects.ts';
import { emit, hasHook, isPlayer, log, moveModeOf } from './state.ts';
import { GAS, SURF, T, TERRAIN } from './terrain.ts';
import type { Actor, Element, FloorState, GameState } from './types.ts';
import { NX, NY } from './dijkstra.ts';

export interface ElementCtx {
  src: DmgSource;
  /** Damage to deal via conduction (lightning). */
  dmg?: number;
  /** Actor ids already hit by the primary effect (not hit again by conduction). */
  hit: Set<number>;
  /** Affect the ground only, not the creatures standing on it. */
  tilesOnly?: boolean;
}

/** Applies an element to tile i. `power` means: conduction radius (lightning), gas amount (gases). */
export function applyElement(state: GameState, i: number, el: Element, power: number, ctx: ElementCtx): void {
  const f = state.floor;
  if (i < 0 || i >= f.w * f.h) return;
  const t = f.terrain[i] as number;
  const td = TERRAIN[t];
  if (!td) return;
  switch (el) {
    case 'fire':
      igniteTile(state, i, ctx);
      break;
    case 'cold': {
      if ((f.fire[i] as number) > 0) {
        f.fire[i] = 0;
        f.heat[i] = 0;
      }
      if ((f.gas[i] as number) === GAS.STEAM) {
        f.gas[i] = GAS.NONE;
        f.gasAmt[i] = 0;
      }
      if (isWater(f, i)) {
        freezeTile(state, i);
        const a = actorAt(f, i % f.w, Math.floor(i / f.w));
        if (a && moveModeOf(a) !== 'fly') addStatus(state, a, 'frozen', 3);
      }
      break;
    }
    case 'lightning': {
      if (isWater(f, i)) conduct(state, i, power, ctx);
      break;
    }
    case 'water': {
      if ((f.fire[i] as number) > 0 && (f.surface[i] as number) !== SURF.OIL) {
        f.fire[i] = 0;
        f.heat[i] = 0;
      }
      const a = actorAt(f, i % f.w, Math.floor(i / f.w));
      if (a && moveModeOf(a) !== 'fly') addStatus(state, a, 'wet', 4);
      break;
    }
    case 'oil': {
      if (td.solid || !td.walk) break;
      // Ice over water stays ice (oil just slides off); stray ice on dry ground is replaced.
      if ((f.surface[i] as number) === SURF.ICE && rawDepth(f, i) <= 0) f.surface[i] = SURF.NONE;
      if ((f.surface[i] as number) !== SURF.ICE) f.surface[i] = SURF.OIL;
      const a = ctx.tilesOnly ? undefined : actorAt(f, i % f.w, Math.floor(i / f.w));
      if (a && moveModeOf(a) !== 'fly') addStatus(state, a, 'oiled', 8);
      if ((f.fire[i] as number) > 0) igniteTile(state, i, ctx);
      break;
    }
    case 'poison':
      addGas(state, i, GAS.MIASMA, power);
      break;
    case 'steam':
      addGas(state, i, GAS.STEAM, power);
      break;
    case 'smoke':
      addGas(state, i, GAS.SMOKE, power);
      break;
  }
}

export function addGas(state: GameState, i: number, gas: number, amount: number): void {
  const f = state.floor;
  const td = TERRAIN[f.terrain[i] as number];
  if (!td || td.solid) return;
  if ((f.gas[i] as number) !== gas) {
    // A stronger incoming gas displaces the old one.
    if ((f.gasAmt[i] as number) > amount && (f.gas[i] as number) !== GAS.NONE) return;
    f.gas[i] = gas;
    f.gasAmt[i] = 0;
  }
  f.gasAmt[i] = Math.min(255, (f.gasAmt[i] as number) + amount);
}

/** Records who set tile i alight (for kill credit), or forgets it. */
export function markFire(f: FloorState, i: number, by: number | undefined): void {
  if (by === undefined) {
    if (f.fireBy) delete f.fireBy[i];
    return;
  }
  (f.fireBy ??= {})[i] = by;
}

/** The creature that set tile i alight, if it is still around. */
export function fireSource(state: GameState, i: number): Actor | undefined {
  const by = state.floor.fireBy?.[i];
  return by === undefined ? undefined : actorById(state.floor, by);
}

/** Sets fire to a tile if anything there can burn. Returns true if a fire started. */
export function igniteTile(state: GameState, i: number, ctx?: ElementCtx): boolean {
  const f = state.floor;
  const t = f.terrain[i] as number;
  const td = TERRAIN[t];
  if (!td) return false;
  const surf = f.surface[i] as number;

  if (surf === SURF.ICE) {
    f.surface[i] = SURF.NONE;
    f.surfaceT[i] = 0;
    addGas(state, i, GAS.STEAM, 30);
    emit(state, { t: 'fx', tiles: [i], kind: 'steam' });
    return false;
  }
  if (surf === SURF.OIL) {
    igniteOilSlick(state, i, ctx?.src.actor?.id);
    return true;
  }
  if (isWater(f, i)) {
    addGas(state, i, GAS.STEAM, 45);
    emit(state, { t: 'fx', tiles: [i], kind: 'steam' });
    return false;
  }
  if (t === T.BARREL) {
    explodeBarrel(state, i, ctx?.src);
    return true;
  }
  if (td.fuel > 0 && (f.fire[i] as number) === 0) {
    f.fire[i] = td.fuel;
    f.heat[i] = 0;
    markFire(f, i, ctx?.src.actor?.id);
    return true;
  }
  return false;
}

/** Flood-fills a connected oil slick and sets all of it alight at once. */
function igniteOilSlick(state: GameState, start: number, by?: number): void {
  const f = state.floor;
  const q = [start];
  const seenT = new Set<number>([start]);
  const tiles: number[] = [];
  while (q.length) {
    const i = q.pop() as number;
    // Tiles already burning keep their own timer (so slicks burn out instead of refreshing forever).
    if ((f.fire[i] as number) > 0 && i !== start) continue;
    tiles.push(i);
    if ((f.fire[i] as number) === 0) {
      f.fire[i] = 3;
      markFire(f, i, by);
    }
    const x = i % f.w;
    const y = (i - x) / f.w;
    for (let k = 0; k < 8; k++) {
      const nx = x + (NX[k] as number);
      const ny = y + (NY[k] as number);
      if (!inBounds(f, nx, ny)) continue;
      const j = idx(f, nx, ny);
      if (seenT.has(j)) continue;
      if ((f.surface[j] as number) === SURF.OIL && (f.fire[j] as number) === 0) {
        seenT.add(j);
        q.push(j);
      } else if ((f.terrain[j] as number) === T.BARREL) {
        seenT.add(j);
        // Barrels next to burning oil go up next.
        f.heat[j] = Math.max(f.heat[j] as number, 1);
      }
    }
  }
  emit(state, { t: 'fx', tiles, kind: 'fire' });
  if (tiles.length > 2 && tiles.some((j) => f.vis[j]) && f.lastOilMsg !== state.turn) {
    f.lastOilMsg = state.turn;
    log(state, 'The oil goes up in a sheet of flame!', 'warn');
  }
  makeNoise(state, start % f.w, Math.floor(start / f.w), 6, false);
}

export function explodeBarrel(state: GameState, i: number, src?: DmgSource): void {
  const f = state.floor;
  if ((f.terrain[i] as number) !== T.BARREL) return;
  f.terrain[i] = T.RUBBLE;
  const { x, y } = xy(f, i);
  // Named for the barrel, credited to whoever set it off.
  const s: DmgSource = { ...(src?.actor ? { actor: src.actor } : {}), name: 'an exploding barrel', cause: 'explosion' };
  const tiles: number[] = [];
  const ctx: ElementCtx = { src: s, hit: new Set() };
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(f, nx, ny)) continue;
      const j = idx(f, nx, ny);
      tiles.push(j);
      const td = TERRAIN[f.terrain[j] as number];
      if (td && !td.solid) {
        if ((f.surface[j] as number) !== SURF.ICE) f.surface[j] = SURF.OIL;
      }
      const a = actorAt(f, nx, ny);
      if (a) dealDamage(state, a, 5, 'fire', s);
    }
  }
  log(state, 'An oil barrel bursts into flame!', 'warn');
  emit(state, { t: 'fx', tiles, kind: 'boom' });
  for (const j of tiles) {
    if ((f.surface[j] as number) === SURF.OIL) {
      f.fire[j] = Math.max(f.fire[j] as number, 3);
      markFire(f, j, s.actor?.id);
    } else igniteTile(state, j, ctx);
  }
  makeNoise(state, x, y, 8, false);
}

/** Smashing a barrel (melee) spills oil without igniting it. */
export function smashBarrel(state: GameState, i: number): void {
  const f = state.floor;
  f.terrain[i] = T.RUBBLE;
  const { x, y } = xy(f, i);
  const tiles: number[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(f, nx, ny)) continue;
      const j = idx(f, nx, ny);
      const td = TERRAIN[f.terrain[j] as number];
      if (!td || td.solid) continue;
      if ((f.surface[j] as number) !== SURF.ICE) f.surface[j] = SURF.OIL;
      tiles.push(j);
      const a = actorAt(f, nx, ny);
      if (a && moveModeOf(a) !== 'fly') addStatus(state, a, 'oiled', 8);
      if ((f.fire[j] as number) > 0) igniteTile(state, j);
    }
  }
  emit(state, { t: 'fx', tiles, kind: 'oil' });
  log(state, 'The barrel splits, spilling lamp oil everywhere.', 'info');
}

/**
 * The full reach of an element applied to `tiles`: fire also reaches every oil tile connected
 * to the area (the slick will go up); lightning reaches connected water within `radius`.
 * Used to draw honest telegraphs and targeting previews.
 */
export function elementReach(state: GameState, tiles: number[], el: string | undefined, radius = 4): number[] {
  const f = state.floor;
  const out = new Set<number>(tiles);
  if (el === 'fire') {
    const q = tiles.filter((i) => (f.surface[i] as number) === SURF.OIL);
    // Fire landing next to a slick also sets it off.
    for (const i of tiles) {
      const x = i % f.w;
      const y = (i - x) / f.w;
      for (let k = 0; k < 8; k++) {
        const nx = x + (NX[k] as number);
        const ny = y + (NY[k] as number);
        if (!inBounds(f, nx, ny)) continue;
        const j = idx(f, nx, ny);
        if ((f.surface[j] as number) === SURF.OIL && !out.has(j)) {
          out.add(j);
          q.push(j);
        }
      }
    }
    while (q.length) {
      const i = q.pop() as number;
      const x = i % f.w;
      const y = (i - x) / f.w;
      for (let k = 0; k < 8; k++) {
        const nx = x + (NX[k] as number);
        const ny = y + (NY[k] as number);
        if (!inBounds(f, nx, ny)) continue;
        const j = idx(f, nx, ny);
        if (out.has(j) || (f.surface[j] as number) !== SURF.OIL) continue;
        out.add(j);
        q.push(j);
      }
    }
  } else if (el === 'lightning') {
    const dist = new Map<number, number>();
    const q: number[] = [];
    for (const i of tiles) if (isWater(f, i)) {
      dist.set(i, 0);
      q.push(i);
    }
    let head = 0;
    while (head < q.length) {
      const i = q[head++] as number;
      const d = dist.get(i) as number;
      if (d >= radius) continue;
      const x = i % f.w;
      const y = (i - x) / f.w;
      for (let k = 0; k < 8; k++) {
        const nx = x + (NX[k] as number);
        const ny = y + (NY[k] as number);
        if (!inBounds(f, nx, ny)) continue;
        const j = idx(f, nx, ny);
        if (dist.has(j) || !isWater(f, j)) continue;
        dist.set(j, d + 1);
        q.push(j);
        out.add(j);
      }
    }
  }
  return [...out];
}

/** How far lightning from `user` arcs through water (the Stormglass doubles yours). */
export function arcRadius(state: GameState, user: Actor | undefined, power: number): number {
  return user && isPlayer(state, user) && hasHook(state, 'stormglass') ? power * 2 : power;
}

/** Lightning spreads through connected water within `radius` steps of the strike. */
export function conduct(state: GameState, start: number, radius: number, ctx: ElementCtx): void {
  const f = state.floor;
  const r = arcRadius(state, ctx.src.actor, radius);
  const dist = new Map<number, number>([[start, 0]]);
  const q = [start];
  let head = 0;
  while (head < q.length) {
    const i = q[head++] as number;
    const d = dist.get(i) as number;
    if (d >= r) continue;
    const x = i % f.w;
    const y = (i - x) / f.w;
    for (let k = 0; k < 8; k++) {
      const nx = x + (NX[k] as number);
      const ny = y + (NY[k] as number);
      if (!inBounds(f, nx, ny)) continue;
      const j = idx(f, nx, ny);
      if (dist.has(j) || !isWater(f, j)) continue;
      dist.set(j, d + 1);
      q.push(j);
    }
  }
  const tiles = [...dist.keys()];
  emit(state, { t: 'fx', tiles, kind: 'shock' });
  const dmg = ctx.dmg ?? 4;
  let hits = 0;
  for (const j of tiles) {
    const a = actorAt(f, j % f.w, Math.floor(j / f.w));
    if (!a || ctx.hit.has(a.id) || moveModeOf(a) === 'fly') continue;
    ctx.hit.add(a.id);
    hits++;
    dealDamage(state, a, dmg, 'lightning', { ...ctx.src, cause: 'lightning through water', verbs: undefined });
  }
  if (hits > 0 && tiles.some((j) => f.vis[j])) log(state, 'Lightning arcs through the water!', 'warn');
}
