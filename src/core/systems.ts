// Per-turn environment: statuses, terrain effects on creatures, fire, gas, surfaces, tide.
// Deterministic: iterates tiles in index order and actors in id order.

import { actorById, idx, inBounds, isDeep, isWater, rawDepth } from './floor.ts';
import { addStatus, dealDamage, heal, kill, seen } from './effects.ts';
import { explodeBarrel, fireSource, igniteTile, markFire } from './elements.ts';
import {
  breathes, capName, emit, hasHook, hasStatus, isPlayer, log, moveModeOf, player, playerMaxBreath, relicMods, MONSTER_BREATH,
} from './state.ts';
import { GAS, GASES, SURF, T, TERRAIN } from './terrain.ts';
import type { Actor, GameState } from './types.ts';
import type { ElementCtx } from './elements.ts';
import { NX, NY } from './dijkstra.ts';

/** Statuses that are consumed by losing actions rather than by time. */
const ACTION_STATUSES = new Set(['stunned', 'frozen']);

export function environmentTick(state: GameState): void {
  tickStatuses(state);
  if (state.status !== 'playing') return;
  terrainEffects(state);
  if (state.status !== 'playing') return;
  updateFire(state);
  updateGas(state);
  updateSurfaces(state);
  updateTide(state);
  tickCooldowns(state);
  cleanupDead(state);
}

function sortedLiving(state: GameState): Actor[] {
  return state.floor.actors.filter((a) => !a.dead).sort((a, b) => a.id - b.id);
}

// ---------------------------------------------------------------------------
// Statuses

function tickStatuses(state: GameState): void {
  for (const a of sortedLiving(state)) {
    if (a.dead) continue;
    // Damage-over-time first.
    // (A status applied during this tick waits for the next one.)
    const burning = a.statuses.find((s) => s.id === 'burning' && s.turns > 0 && s.t0 !== state.turn);
    if (burning) {
      const i = idx(state.floor, a.x, a.y);
      if (isWater(state.floor, i) && moveModeOf(a) !== 'fly') {
        a.statuses = a.statuses.filter((s) => s.id !== 'burning');
      } else {
        const src = actorById(state.floor, burning.source);
        const bsrc = { ...(src ? { actor: src } : {}), name: 'burning', cause: 'burning' };
        dealDamage(state, a, 2, 'fire', bsrc, { quiet: !isPlayer(state, a), indirect: true });
        if (!a.dead && moveModeOf(a) !== 'fly') igniteTile(state, i, { src: bsrc, hit: new Set() });
      }
    }
    if (a.dead) continue;
    const poison = a.statuses.find((s) => s.id === 'poisoned' && s.turns > 0 && s.t0 !== state.turn);
    if (poison) {
      const src = actorById(state.floor, poison.source);
      dealDamage(state, a, 1, 'poison', { ...(src ? { actor: src } : {}), name: 'poison', cause: 'poison' }, { quiet: true, indirect: true });
    }
    if (a.dead) continue;
    // Durations.
    for (const s of a.statuses) {
      if (ACTION_STATUSES.has(s.id)) continue;
      if (s.t0 === state.turn) continue;
      s.turns -= 1;
    }
    const before = a.statuses.length;
    const expired = a.statuses.filter((s) => s.turns <= 0).map((s) => s.id);
    a.statuses = a.statuses.filter((s) => s.turns > 0);
    if (a.statuses.length !== before && isPlayer(state, a)) {
      for (const id of expired) {
        if (id === 'hidden') log(state, 'You step out of the shadows.', 'info');
        if (id === 'gills') log(state, 'The air bladder is spent.', 'warn');
      }
    }
  }
}

/** Called when an actor loses an action to stun/freeze. */
export function consumeActionStatus(a: Actor): void {
  for (const s of a.statuses) {
    if (s.id === 'stunned' || s.id === 'frozen') s.turns -= 1;
  }
  a.statuses = a.statuses.filter((s) => s.turns > 0);
}

// ---------------------------------------------------------------------------
// Terrain acting on creatures

function terrainEffects(state: GameState): void {
  const f = state.floor;
  for (const a of sortedLiving(state)) {
    if (a.dead) continue;
    const i = idx(f, a.x, a.y);
    const mode = moveModeOf(a);
    const grounded = mode !== 'fly';

    // Summons expire.
    if (a.expires !== undefined && a.expires <= state.turn) {
      kill(state, a, { name: 'time', cause: 'expired' });
      continue;
    }

    // Nothing stays hidden under water it's no longer in (pushed or pulled ashore).
    if (a.submerged && !isWater(f, i)) a.submerged = false;

    // Beached: swimmers stranded on dry land flop helplessly.
    if (mode === 'swim' && !isWater(f, i)) {
      if (seen(state, a)) log(state, `${capName(state, a)} flops helplessly on dry land.`, 'good');
      dealDamage(state, a, 2, 'pure', { name: 'dry land', cause: 'beached' }, { quiet: true });
      if (a.dead) continue;
    }

    // Water.
    if (grounded && isWater(f, i)) {
      addStatus(state, a, 'wet', 3);
      if (isDeep(f, i)) a.statuses = a.statuses.filter((s) => s.id !== 'oiled');
    }
    if (f.raining && grounded) addStatus(state, a, 'wet', 2);

    // Fire on the tile (swimmers dive under surface fires).
    if ((f.fire[i] as number) > 0 && grounded && !isDeep(f, i)) {
      const lit = fireSource(state, i);
      dealDamage(state, a, 2, 'fire', { ...(lit ? { actor: lit } : {}), name: 'flames', cause: 'fire' }, { quiet: !isPlayer(state, a), indirect: true });
      if (!a.dead) addStatus(state, a, 'burning', 2, undefined, lit?.id);
    }
    if (a.dead) continue;

    // Oil underfoot (burning oil is being consumed, it doesn't coat you).
    if (grounded && (f.surface[i] as number) === SURF.OIL && !isWater(f, i) && (f.fire[i] as number) === 0) addStatus(state, a, 'oiled', 8);

    // Gases.
    const g = f.gas[i] as number;
    const amt = f.gasAmt[i] as number;
    if (g === GAS.STEAM && amt >= 10) {
      dealDamage(state, a, 2, 'fire', { name: 'steam', cause: 'steam' }, { quiet: !isPlayer(state, a) });
    } else if (g === GAS.MIASMA && amt >= 10 && breathes(a)) {
      if (isPlayer(state, a) && hasHook(state, 'brine_blood')) heal(state, a, 1, true);
      else addStatus(state, a, 'poisoned', 2);
    }
    if (a.dead) continue;

    // Breath and drowning.
    if (breathes(a) && grounded && isDeep(f, i) && !hasStatus(a, 'gills')) {
      a.breath -= 1;
      if (a.breath < 0) {
        const dmg = 1 + -a.breath;
        if (isPlayer(state, a)) log(state, 'You are drowning!', 'bad');
        else if (seen(state, a)) log(state, `${capName(state, a)} is drowning.`, 'info');
        dealDamage(state, a, dmg, 'drown', { name: 'the sea', cause: 'drowning' }, { quiet: true });
      } else if (isPlayer(state, a) && a.breath <= 2) {
        log(state, `Your lungs burn — ${a.breath} breath left.`, 'warn');
      }
    } else {
      const max = isPlayer(state, a) ? playerMaxBreath(state) : MONSTER_BREATH;
      a.breath = max;
    }
  }
}

// ---------------------------------------------------------------------------
// Fire

function updateFire(state: GameState): void {
  const f = state.floor;
  const n = f.w * f.h;
  const touched = new Uint8Array(n);
  // Who the spreading fire belongs to (the first burning neighbour with an igniter).
  const spreadBy = new Map<number, number>();
  const oilToIgnite: number[] = [];
  const burnouts: number[] = [];
  for (let i = 0; i < n; i++) {
    const fire = f.fire[i] as number;
    if (fire <= 0) continue;
    const onOil = (f.surface[i] as number) === SURF.OIL;
    if (isWater(f, i) && !onOil) {
      f.fire[i] = 0;
      continue;
    }
    // Spread.
    if (!f.raining || onOil) {
      const by = f.fireBy?.[i];
      const x = i % f.w;
      const y = (i - x) / f.w;
      for (let k = 0; k < 8; k++) {
        const nx = x + (NX[k] as number);
        const ny = y + (NY[k] as number);
        if (!inBounds(f, nx, ny)) continue;
        const j = ny * f.w + nx;
        if ((f.fire[j] as number) > 0) continue;
        if (by !== undefined && !spreadBy.has(j)) spreadBy.set(j, by);
        if ((f.surface[j] as number) === SURF.OIL) {
          oilToIgnite.push(j);
          continue;
        }
        const td = TERRAIN[f.terrain[j] as number];
        if (!td || td.fuel <= 0) continue;
        if (isWater(f, j)) continue;
        touched[j] = 1;
      }
    }
    // Burn down.
    const next = fire - (f.raining ? 2 : 1);
    f.fire[i] = Math.max(0, next);
    if ((f.fire[i] as number) === 0) burnouts.push(i);
  }
  for (const i of burnouts) {
    const t = f.terrain[i] as number;
    const td = TERRAIN[t];
    if ((f.surface[i] as number) === SURF.OIL) f.surface[i] = SURF.NONE;
    if (td && td.fuel > 0 && t !== T.BARREL) {
      const wasBridge = !!td.bridge;
      f.terrain[i] = td.burnsTo;
      if (wasBridge && rawDepth(f, i) > 0 && f.vis[i]) log(state, 'A burning bridge collapses into the water!', 'warn');
    }
  }
  const spreadCtx = (j: number): ElementCtx | undefined => {
    const by = spreadBy.get(j);
    const src = by === undefined ? undefined : actorById(f, by);
    return src ? { src: { actor: src, name: 'flames', cause: 'fire' }, hit: new Set<number>() } : undefined;
  };
  for (const j of oilToIgnite) {
    if ((f.fire[j] as number) === 0 && (f.surface[j] as number) === SURF.OIL) igniteTile(state, j, spreadCtx(j));
  }
  for (let j = 0; j < n; j++) {
    if (!touched[j]) {
      if ((f.heat[j] as number) > 0 && (f.fire[j] as number) === 0) f.heat[j] = 0;
      continue;
    }
    const td = TERRAIN[f.terrain[j] as number];
    if (!td) continue;
    f.heat[j] = Math.min(255, (f.heat[j] as number) + 1);
    if ((f.heat[j] as number) >= td.delay) {
      if ((f.terrain[j] as number) === T.BARREL) explodeBarrel(state, j, spreadCtx(j)?.src);
      else {
        f.fire[j] = td.fuel;
        f.heat[j] = 0;
        markFire(f, j, spreadBy.get(j));
      }
    }
  }
  // Forget igniters of fires that have gone out.
  if (f.fireBy) for (const k of Object.keys(f.fireBy)) if (!f.fire[Number(k)]) delete f.fireBy[Number(k)];
}

// ---------------------------------------------------------------------------
// Gas: mass-conserving diffusion between open tiles of the same gas, then decay.

function updateGas(state: GameState): void {
  const f = state.floor;
  const n = f.w * f.h;
  let any = false;
  for (let i = 0; i < n; i++) {
    if ((f.gasAmt[i] as number) > 0) {
      any = true;
      break;
    }
  }
  if (!any) return;
  const amt = new Float32Array(n);
  const type = new Uint8Array(f.gas);
  for (let i = 0; i < n; i++) amt[i] = f.gasAmt[i] as number;
  const out = new Float32Array(amt);
  for (let i = 0; i < n; i++) {
    const a = amt[i] as number;
    if (a < 2) continue;
    const g = type[i] as number;
    const x = i % f.w;
    const y = (i - x) / f.w;
    const nbrs: number[] = [];
    for (let k = 0; k < 8; k += 2) {
      const nx = x + (NX[k] as number);
      const ny = y + (NY[k] as number);
      if (!inBounds(f, nx, ny)) continue;
      const j = ny * f.w + nx;
      const td = TERRAIN[f.terrain[j] as number];
      if (!td || td.solid || (f.terrain[j] as number) === T.DOOR) continue;
      const tj = type[j] as number;
      if (tj !== GAS.NONE && tj !== g) continue;
      if ((amt[j] as number) >= a) continue;
      nbrs.push(j);
    }
    if (nbrs.length === 0) continue;
    const share = (a * 0.4) / (nbrs.length + 1);
    for (const j of nbrs) {
      out[j] = (out[j] as number) + share;
      out[i] = (out[i] as number) - share;
      if (type[j] === GAS.NONE) type[j] = g;
    }
  }
  for (let i = 0; i < n; i++) {
    const g = type[i] as number;
    if (g === GAS.NONE) {
      f.gas[i] = 0;
      f.gasAmt[i] = 0;
      continue;
    }
    const decay = GASES[g]?.decay ?? 0.1;
    let v = (out[i] as number) * (1 - decay);
    if (v < 3) v = 0;
    f.gasAmt[i] = Math.min(255, Math.round(v));
    f.gas[i] = v > 0 ? g : GAS.NONE;
  }
}

// ---------------------------------------------------------------------------
// Surfaces: ice melts back to water.

function updateSurfaces(state: GameState): void {
  const f = state.floor;
  for (let i = 0; i < f.w * f.h; i++) {
    if ((f.surface[i] as number) !== SURF.ICE) continue;
    const t = f.surfaceT[i] as number;
    if (t <= 1) {
      f.surface[i] = SURF.NONE;
      f.surfaceT[i] = 0;
    } else f.surfaceT[i] = t - 1;
  }
}

// ---------------------------------------------------------------------------
// The tide

export function effectiveTideInterval(state: GameState): number {
  return Math.max(6, Math.round(state.floor.tideInterval * relicMods(state).tideMult));
}

function updateTide(state: GameState): void {
  const f = state.floor;
  if (f.tidePaused > 0) {
    f.tidePaused -= 1;
    if (f.tidePaused === 0) log(state, 'The sea stirs again.', 'warn');
    return;
  }
  f.tideTimer -= 1;
  if (f.tideTimer === 3) log(state, 'The water is rising — the tide turns in 3.', 'warn');
  if (f.tideTimer <= 0) {
    f.waterLevel += 1;
    f.tideTimer = effectiveTideInterval(state);
    emit(state, { t: 'tide', level: f.waterLevel });
    log(state, 'The tide rises!', 'bad');
    const p = player(state);
    const pi = idx(f, p.x, p.y);
    if (isDeep(f, pi)) log(state, 'The water closes over your head. Swim!', 'bad');
    else if (isWater(f, pi)) log(state, 'Water swirls around your ankles.', 'warn');
  }
}

function tickCooldowns(state: GameState): void {
  for (const a of state.floor.actors) {
    if (!a.ai) continue;
    for (const k of Object.keys(a.ai.cd)) {
      const v = (a.ai.cd[k] as number) - 1;
      if (v <= 0) delete a.ai.cd[k];
      else a.ai.cd[k] = v;
    }
  }
}

function cleanupDead(state: GameState): void {
  const f = state.floor;
  if (f.actors.some((a) => a.dead && a.id !== state.playerId)) {
    f.actors = f.actors.filter((a) => !a.dead || a.id === state.playerId);
  }
}

/** Tiles that will change at the next tide rise (for the forecast overlay). */
export function tideForecast(state: GameState): number[] {
  const f = state.floor;
  const out: number[] = [];
  const next = f.waterLevel + 1;
  for (let i = 0; i < f.w * f.h; i++) {
    const td = TERRAIN[f.terrain[i] as number];
    if (!td || !td.flood) continue;
    const d = next - (f.elev[i] as number);
    if (d === 1 || d === 2) out.push(i);
  }
  return out;
}
