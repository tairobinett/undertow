// Monster decision-making. Deterministic given state (randomness comes from state.rng).
// Strong attacks are declared as intents one or more turns before they resolve.

import type { MonsterAbility, MonsterDef } from '../content/monsters.ts';
import type { Shape } from '../content/spec.ts';
import { chebyshev } from '../core/geom.ts';
import { dijkstraMap, stepDownhill, UNREACHABLE } from '../core/dijkstra.ts';
import { actorAt, actorById, canStand, idx, inBounds, isDeep, isWater, setPos } from '../core/floor.ts';
import { dealDamage, onEnterTile, seen } from '../core/effects.ts';
import { applySpec, shapeTiles } from '../core/resolve.ts';
import {
  breathes, capName, defOf, emit, enemies, hasStatus, isPlayer, log, moveModeOf, nameOf, relicMods, speedOf,
} from '../core/state.ts';
import { GAS, SURF, T, TERRAIN } from '../core/terrain.ts';
import type { Actor, GameState, MoveMode } from '../core/types.ts';
import { hasLos } from '../core/fov.ts';
import { blocksSight } from '../core/floor.ts';
import { int } from '../core/rng.ts';
import { onMonsterMoved } from '../core/player.ts';
import { elementReach } from '../core/elements.ts';

// ---------------------------------------------------------------------------
// Perception

export function canPerceive(state: GameState, m: Actor, t: Actor): boolean {
  if (t.dead) return false;
  const f = state.floor;
  const d = chebyshev(m.x, m.y, t.x, t.y);
  if (isPlayer(state, t)) {
    if (hasStatus(t, 'hidden')) return false;
    if (d <= 1) return true;
    let range = defOf(m).sight;
    const sr = relicMods(state).stealthRange;
    if (sr) range = Math.min(range, sr);
    if (d > range) return false;
    return f.los[idx(f, m.x, m.y)] === 1;
  }
  if (d <= 1) return true;
  if (d > defOf(m).sight) return false;
  return hasLos(m.x, m.y, t.x, t.y, (x, y) => !inBounds(f, x, y) || blocksSight(f, idx(f, x, y)));
}

function potentialTargets(state: GameState, m: Actor): Actor[] {
  return state.floor.actors.filter((a) => !a.dead && a.id !== m.id && enemies(state, m, a));
}

function nearestPerceived(state: GameState, m: Actor): Actor | undefined {
  let best: Actor | undefined;
  let bestD = Infinity;
  for (const t of potentialTargets(state, m)) {
    if (!canPerceive(state, m, t)) continue;
    const d = chebyshev(m.x, m.y, t.x, t.y);
    if (d < bestD || (d === bestD && best && t.id < best.id)) {
      best = t;
      bestD = d;
    }
  }
  return best;
}

/** Updates awareness. Returns true if the monster spent this action noticing. */
function perceive(state: GameState, m: Actor): boolean {
  const ai = m.ai;
  if (!ai) return false;
  const t = nearestPerceived(state, m);
  if (ai.mode === 'asleep') {
    if (t && chebyshev(m.x, m.y, t.x, t.y) <= 1) {
      ai.mode = 'alert';
      ai.alertTurn = state.turn;
      remember(state, m, t);
      announceNotice(state, m, t);
      return true;
    }
    return true; // still asleep: no action
  }
  if (!t) {
    // Lost sight of you while still reacting (smoke, hiding): go and look.
    if (ai.mode === 'alert') ai.mode = 'search';
    if (ai.mode === 'hunt' && state.turn - (ai.lastSeenTurn ?? state.turn) > 10) ai.mode = 'search';
    return false;
  }
  if (ai.mode === 'wander' || ai.mode === 'search' || ai.mode === 'guard') {
    // Too hurt to fight: it runs again the moment it sees you, instead of re-engaging.
    const d = defOf(m);
    if (d.flee && m.hp <= m.maxHp * d.flee) {
      ai.mode = 'flee';
      remember(state, m, t);
      return false;
    }
    ai.mode = 'alert';
    ai.alertTurn = state.turn;
    remember(state, m, t);
    announceNotice(state, m, t);
    return true;
  }
  remember(state, m, t);
  if (ai.mode === 'alert') {
    // Noticing takes the rest of the tick, even for fast creatures: you get a turn first.
    if (state.turn <= (ai.alertTurn ?? -1)) return true;
    ai.mode = 'hunt';
  }
  return false;
}

function remember(state: GameState, m: Actor, t: Actor): void {
  if (!m.ai) return;
  m.ai.targetId = t.id;
  m.ai.lastX = t.x;
  m.ai.lastY = t.y;
  m.ai.lastSeenTurn = state.turn;
}

function announceNotice(state: GameState, m: Actor, t: Actor): void {
  emit(state, { t: 'telegraph', id: m.id });
  if (seen(state, m) && isPlayer(state, t)) log(state, `${capName(state, m)} notices you!`, 'warn');
}

// ---------------------------------------------------------------------------
// Movement

function pathCost(state: GameState, m: Actor, mode: MoveMode): (i: number) => number {
  const f = state.floor;
  const breather = breathes(m);
  return (i: number): number => {
    const t = f.terrain[i] as number;
    const td = TERRAIN[t];
    if (!td) return Infinity;
    if (mode === 'phase') return t === T.VOID ? Infinity : td.solid ? 2 : 1;
    if (!td.walk) return Infinity;
    if (mode === 'swim') return isWater(f, i) ? 1 : Infinity;
    let c = 1;
    if (mode !== 'fly') {
      if (isDeep(f, i) && mode !== 'amphibious') c += breather ? 16 : 1;
      if ((f.fire[i] as number) > 0) c += 12;
      if ((f.surface[i] as number) === SURF.ICE) c += 1;
    }
    const g = f.gas[i] as number;
    if ((f.gasAmt[i] as number) >= 10) {
      if (g === GAS.MIASMA && breather) c += 6;
      if (g === GAS.STEAM) c += 6;
    }
    return c;
  };
}

/**
 * Whether `m` could make its way to (x, y) by its own pathing (the same costs and reach it
 * moves by). With `known`, only over tiles marked there (what the player has seen).
 */
export function canReach(state: GameState, m: Actor, x: number, y: number, known?: Uint8Array): boolean {
  if (hasStatus(m, 'rooted')) return chebyshev(m.x, m.y, x, y) <= 1;
  const f = state.floor;
  const cost = pathCost(state, m, moveModeOf(m));
  const dist = dijkstraMap(f.w, f.h, [idx(f, x, y)], known ? (i) => (known[i] ? cost(i) : Infinity) : cost, 60);
  return (dist[idx(f, m.x, m.y)] as number) < UNREACHABLE;
}

function standable(state: GameState, m: Actor, i: number): boolean {
  const f = state.floor;
  const mode = moveModeOf(m);
  if ((f.occ[i] as number) !== 0) return false;
  if (mode === 'swim') return canStand(f, i, 'swim');
  return canStand(f, i, mode);
}

/** Moves one step toward (gx, gy). Returns true if moved. */
export function stepToward(state: GameState, m: Actor, gx: number, gy: number): boolean {
  if (hasStatus(m, 'rooted')) return false;
  const f = state.floor;
  if (!inBounds(f, gx, gy)) return false;
  const mode = moveModeOf(m);
  const dist = dijkstraMap(f.w, f.h, [idx(f, gx, gy)], pathCost(state, m, mode), 60);
  const from = idx(f, m.x, m.y);
  if ((dist[from] as number) >= UNREACHABLE) return false;
  const next = stepDownhill(f.w, f.h, dist, from, (j) => standable(state, m, j), m.ai?.tie ?? 0);
  if (next < 0) return false;
  moveMonster(state, m, next % f.w, Math.floor(next / f.w));
  return true;
}

/** Moves one step to increase distance from (fx, fy). */
function stepAway(state: GameState, m: Actor, fx: number, fy: number): boolean {
  if (hasStatus(m, 'rooted')) return false;
  const f = state.floor;
  let best = -1;
  let bestScore = chebyshev(m.x, m.y, fx, fy) * 10;
  const tie = m.ai?.tie ?? 0;
  for (let kk = 0; kk < 8; kk++) {
    const k = (kk + tie) & 7;
    const dx = [0, 1, 1, 1, 0, -1, -1, -1][k] as number;
    const dy = [-1, -1, 0, 1, 1, 1, 0, -1][k] as number;
    const nx = m.x + dx;
    const ny = m.y + dy;
    if (!inBounds(f, nx, ny)) continue;
    const j = idx(f, nx, ny);
    if (!standable(state, m, j)) continue;
    if ((f.fire[j] as number) > 0 && moveModeOf(m) !== 'fly') continue;
    if (isDeep(f, j) && breathes(m) && moveModeOf(m) === 'walk') continue;
    const score = chebyshev(nx, ny, fx, fy) * 10 + (Math.abs(nx - fx) + Math.abs(ny - fy));
    if (score > bestScore) {
      bestScore = score;
      best = j;
    }
  }
  if (best < 0) return false;
  moveMonster(state, m, best % f.w, Math.floor(best / f.w));
  return true;
}

export function moveMonster(state: GameState, m: Actor, x: number, y: number): void {
  const f = state.floor;
  const fx = m.x;
  const fy = m.y;
  setPos(f, m, x, y);
  emit(state, { t: 'move', id: m.id, fx, fy, tx: x, ty: y, how: 'step' });
  onEnterTile(state, m);
  // Ice: slide one more tile in the same direction.
  const i = idx(f, x, y);
  if (!m.dead && moveModeOf(m) !== 'fly' && (f.surface[i] as number) === SURF.ICE) {
    const nx = x + Math.sign(x - fx);
    const ny = y + Math.sign(y - fy);
    if (inBounds(f, nx, ny) && standable(state, m, idx(f, nx, ny))) {
      setPos(f, m, nx, ny);
      emit(state, { t: 'move', id: m.id, fx: x, fy: y, tx: nx, ty: ny, how: 'slide' });
      onEnterTile(state, m);
    }
  }
  if (m.submerged && !isWater(f, idx(f, m.x, m.y))) m.submerged = false;
  onMonsterMoved(state, m);
}

function wanderStep(state: GameState, m: Actor): void {
  const ai = m.ai;
  if (!ai) return;
  const f = state.floor;
  const reached = ai.wanderX === undefined || (ai.wanderX === m.x && ai.wanderY === m.y);
  if (reached || int(state.rng, 12) === 0) {
    // Pick a new goal near home.
    const hx = ai.homeX ?? m.x;
    const hy = ai.homeY ?? m.y;
    for (let tries = 0; tries < 12; tries++) {
      const x = hx + int(state.rng, 17) - 8;
      const y = hy + int(state.rng, 17) - 8;
      if (!inBounds(f, x, y)) continue;
      const i = idx(f, x, y);
      if (!standable(state, m, i) && !(x === m.x && y === m.y)) continue;
      if (moveModeOf(m) === 'walk' && isDeep(f, i) && breathes(m)) continue;
      ai.wanderX = x;
      ai.wanderY = y;
      break;
    }
  }
  if (ai.wanderX !== undefined && ai.wanderY !== undefined) {
    if (!stepToward(state, m, ai.wanderX, ai.wanderY)) {
      delete ai.wanderX;
      delete ai.wanderY;
    }
  }
}

// ---------------------------------------------------------------------------
// Abilities

export function shapeRange(shape: Shape): number {
  switch (shape.k) {
    case 'self': return 99;
    case 'melee': return 1;
    case 'bolt':
    case 'ray':
    case 'beam':
    case 'cone':
    case 'lob':
    case 'tile':
      return shape.range;
    case 'burst': return Math.floor(shape.radius);
    case 'wave': return shape.length;
  }
}

function abilityReady(m: Actor, ab: MonsterAbility): boolean {
  return (m.ai?.cd[ab.key] ?? 0) <= 0;
}

function conditionMet(state: GameState, m: Actor, ab: MonsterAbility, t: Actor | undefined): boolean {
  const f = state.floor;
  switch (ab.when) {
    case 'adjacent':
      return !!t && chebyshev(m.x, m.y, t.x, t.y) <= 1;
    case 'inRange': {
      if (!t) return false;
      const d = chebyshev(m.x, m.y, t.x, t.y);
      if (d > shapeRange(ab.shape) || d < (ab.minRange ?? 1)) return false;
      if (!canPerceive(state, m, t)) return false;
      if (ab.shape.k === 'ray' || ab.shape.k === 'bolt' || ab.shape.k === 'beam') {
        const res = shapeTiles(state, m, ab.shape, t.x, t.y, true);
        if (!(res.path ?? res.tiles).includes(idx(f, t.x, t.y))) return false;
      }
      return true;
    }
    case 'waterNear': {
      const r = ab.shape.k === 'burst' ? ab.shape.radius : 2;
      return f.actors.some((a) => !a.dead && a.id !== m.id && a.def !== m.def && moveModeOf(a) !== 'fly'
        && Math.hypot(a.x - m.x, a.y - m.y) <= r && isWater(f, idx(f, a.x, a.y)));
    }
    case 'hurt':
      return m.hp < m.maxHp / 2;
    case 'hunting':
      return m.ai?.mode === 'hunt' && !!t;
  }
}

/** Declares (windup) or executes the first usable ability. Returns true if it acted. */
function tryAbilities(state: GameState, m: Actor, t: Actor | undefined, filter?: (ab: MonsterAbility) => boolean): boolean {
  const d = defOf(m);
  if (!d.abilities || !m.ai) return false;
  for (const ab of d.abilities) {
    if (filter && !filter(ab)) continue;
    if (!abilityReady(m, ab)) continue;
    if (!conditionMet(state, m, ab, t)) continue;
    const ax = t?.x ?? m.x;
    const ay = t?.y ?? m.y;
    if (ab.windup > 0) {
      const res = shapeTiles(state, m, ab.shape, ax, ay, true);
      let tiles = ab.shape.k === 'self' ? [idx(state.floor, m.x, m.y)] : res.tiles;
      // Honest telegraphs: show where the fire will spread through oil, or lightning through water.
      const el = ab.effect.element ?? (ab.effect.dtype === 'fire' ? 'fire' : ab.effect.dtype === 'lightning' ? 'lightning' : undefined);
      if (el === 'fire' || el === 'lightning') tiles = elementReach(state, tiles, el, ab.effect.power ?? 4);
      const resolveTurn = Math.max(state.turn + 1, actionTick(state, m, ab.windup));
      m.ai.intent = { ability: ab.key, tiles, aimX: ax, aimY: ay, label: ab.name, turns: resolveTurn - state.turn, resolveTurn };
      if (t) m.ai.intent.targetId = t.id;
      m.ai.cd[ab.key] = ab.cooldown + ab.windup;
      m.submerged = false;
      if (seen(state, m)) log(state, `${capName(state, m)} ${ab.telegraph}!`, 'warn');
      else if (tiles.some((i) => state.floor.vis[i] === 1)) log(state, `Something you can't see readies ${ab.name}!`, 'warn');
      emit(state, { t: 'telegraph', id: m.id });
      return true;
    }
    executeAbility(state, m, ab, ax, ay);
    m.ai.cd[ab.key] = ab.cooldown;
    return true;
  }
  return false;
}

function executeAbility(state: GameState, m: Actor, ab: MonsterAbility, x: number, y: number): void {
  const f = state.floor;
  m.submerged = false;
  if (ab.shape.k === 'melee') {
    const target = actorAt(f, x, y);
    if (!target || !enemies(state, m, target)) {
      if (seen(state, m)) log(state, `${capName(state, m)}'s ${ab.name.toLowerCase()} finds only empty air.`, 'good');
      return;
    }
    emit(state, { t: 'melee', id: m.id, tx: x, ty: y });
  }
  if (seen(state, m)) log(state, `${capName(state, m)} ${ab.verb}!`, 'warn');
  applySpec(state, m, ab.shape, ab.effect, x, y, { name: nameOf(state, m), cause: ab.name.toLowerCase(), noise: 5 });
}

/** The world tick of this monster's k-th action from now (its current action already paid for). */
function actionTick(state: GameState, m: Actor, k: number): number {
  const speed = Math.max(1, speedOf(state, m));
  let energy = m.energy;
  let tick = state.turn;
  let n = 0;
  for (let guard = 0; guard < 64; guard++) {
    while (energy >= 100) {
      energy -= 100;
      if (++n >= k) return tick;
    }
    tick += 1;
    energy += speed;
  }
  return tick;
}

function resolveIntent(state: GameState, m: Actor): void {
  const ai = m.ai;
  if (!ai?.intent) return;
  // Still winding up: hold this action. (Saves from before resolveTurn existed resolve now.)
  if (state.turn < (ai.intent.resolveTurn ?? state.turn)) return;
  const intent = ai.intent;
  delete ai.intent;
  const ab = defOf(m).abilities?.find((a) => a.key === intent.ability);
  if (!ab) return;
  if (ab.needsSight) {
    const t = intent.targetId === undefined ? undefined : actorById(state.floor, intent.targetId);
    if (!t || !canPerceive(state, m, t)) {
      if (seen(state, m)) log(state, `${capName(state, m)}'s ${ab.name.toLowerCase()} falters — the line is broken.`, 'good');
      return;
    }
  }
  // Did you step out of the marked tiles before it landed? (Checked before it lands: a push
  // can carry you out of the area after you've been hit.)
  const you = actorById(state.floor, state.playerId);
  const hurts = !!(ab.effect.dmg || ab.effect.status || ab.effect.pull || ab.effect.push || ab.effect.element);
  const dodged = hurts && ab.shape.k !== 'melee' && ab.shape.k !== 'self' && intent.targetId === state.playerId && !!you && !intent.tiles.includes(idx(state.floor, you.x, you.y));
  executeAbility(state, m, ab, intent.aimX ?? m.x, intent.aimY ?? m.y);
  if (dodged && you && !you.dead) log(state, `You dodge the ${ab.name.toLowerCase()}.`, 'good');
}

function meleeAttack(state: GameState, m: Actor, t: Actor): void {
  const d = defOf(m);
  if (d.dmg <= 0) return;
  m.submerged = false;
  emit(state, { t: 'melee', id: m.id, tx: t.x, ty: t.y });
  const dmg = d.dmg + (hasStatus(m, 'enraged') ? 2 : 0);
  // The same rule as yours: a walker floundering in deep water strikes at half strength.
  const floundering = moveModeOf(m) === 'walk' && isDeep(state.floor, idx(state.floor, m.x, m.y));
  dealDamage(state, t, dmg, 'physical', { actor: m, name: nameOf(state, m), cause: 'melee', verbs: ['hit', attackVerb(d)] }, floundering ? { mult: 0.5 } : {});
}

function attackVerb(d: MonsterDef): string {
  if (d.tags.includes('beast')) return d.glyph === 'c' || d.glyph === 'K' ? 'pinches' : 'bites';
  if (d.tags.includes('undead')) return 'claws';
  if (d.tags.includes('construct')) return 'strikes';
  return 'hits';
}

// ---------------------------------------------------------------------------
// Brains

function currentTarget(state: GameState, m: Actor): Actor | undefined {
  const t = actorById(state.floor, m.ai?.targetId);
  if (t && canPerceive(state, m, t)) return t;
  return undefined;
}

function adjacent(a: Actor, b: Actor): boolean {
  return chebyshev(a.x, a.y, b.x, b.y) <= 1;
}

/** Pursue the last known position, then give up and search/wander. */
function pursue(state: GameState, m: Actor): void {
  const ai = m.ai;
  if (!ai) return;
  if (ai.lastX !== undefined && ai.lastY !== undefined) {
    if (m.x === ai.lastX && m.y === ai.lastY) {
      ai.mode = 'wander';
      delete ai.lastX;
      delete ai.lastY;
      return;
    }
    if (!stepToward(state, m, ai.lastX, ai.lastY)) {
      ai.mode = 'wander';
    }
    return;
  }
  ai.mode = 'wander';
}

function idle(state: GameState, m: Actor): void {
  const ai = m.ai;
  if (!ai) return;
  if (ai.mode === 'search' || (ai.mode === 'hunt' && ai.lastX !== undefined)) {
    pursue(state, m);
    return;
  }
  if (ai.mode === 'wander') wanderStep(state, m);
  // 'guard' stands still.
}

function fleeFrom(state: GameState, m: Actor): boolean {
  const t = actorById(state.floor, m.ai?.targetId);
  if (!t) return false;
  return stepAway(state, m, t.x, t.y);
}

function brainMelee(state: GameState, m: Actor): void {
  const d = defOf(m);
  const t = currentTarget(state, m);
  if (!t) return idle(state, m);
  if (tryAbilities(state, m, t)) return;
  if (adjacent(m, t) && d.dmg > 0) return meleeAttack(state, m, t);
  if (!stepToward(state, m, t.x, t.y)) {
    // Blocked: wait for an opening.
  }
}

/** Nothing left to throw or fire until a cooldown ends: it holds its ground (the window to close in). */
function reloading(m: Actor): boolean {
  const abs = defOf(m).abilities ?? [];
  return abs.length > 0 && abs.every((ab) => (m.ai?.cd[ab.key] ?? 0) > 0);
}

function brainRanged(state: GameState, m: Actor): void {
  const d = defOf(m);
  const t = currentTarget(state, m);
  if (!t) return idle(state, m);
  const dist = chebyshev(m.x, m.y, t.x, t.y);
  const busy = reloading(m);
  if (dist <= 1) {
    if (!busy && stepAway(state, m, t.x, t.y)) return;
    if (tryAbilities(state, m, t)) return;
    if (d.dmg > 0) return meleeAttack(state, m, t);
    return;
  }
  if (tryAbilities(state, m, t)) return;
  const maxR = Math.max(...(d.abilities ?? []).map((a) => shapeRange(a.shape)), 3);
  if (dist <= 2) {
    if (!busy) stepAway(state, m, t.x, t.y);
    return;
  }
  if (dist > Math.min(maxR - 1, 6)) stepToward(state, m, t.x, t.y);
}

function brainTurret(state: GameState, m: Actor): void {
  const t = currentTarget(state, m);
  if (!t) return;
  tryAbilities(state, m, t);
}

/** Dives under the surface — only possible in water. */
function submerge(state: GameState, m: Actor): void {
  if (defOf(m).submerge && isWater(state.floor, idx(state.floor, m.x, m.y))) m.submerged = true;
}

function brainAquatic(state: GameState, m: Actor): void {
  const d = defOf(m);
  const t = currentTarget(state, m);
  if (!t) {
    submerge(state, m);
    if (m.ai?.mode === 'wander') wanderStep(state, m);
    return;
  }
  if (adjacent(m, t) && d.dmg > 0) {
    if (tryAbilities(state, m, t, (ab) => ab.when === 'adjacent')) return;
    return meleeAttack(state, m, t);
  }
  if (tryAbilities(state, m, t)) return;
  // Approach through the water; if the target is on land, wait at the nearest edge.
  if (!stepToward(state, m, t.x, t.y) || !adjacent(m, t)) submerge(state, m);
}

function brainDrifter(state: GameState, m: Actor): void {
  if (tryAbilities(state, m, currentTarget(state, m))) return;
  const t = currentTarget(state, m);
  if (t) stepToward(state, m, t.x, t.y);
  else if (m.ai?.mode === 'wander' && int(state.rng, 2) === 0) wanderStep(state, m);
}

function brainBomber(state: GameState, m: Actor): void {
  const t = currentTarget(state, m);
  if (!t) return idle(state, m);
  if (tryAbilities(state, m, t)) return;
  stepToward(state, m, t.x, t.y);
}

/**
 * Keeps its distance and throws. After each throw it fumbles for the next one (until its
 * ability is ready again) and doesn't back off: that is the window to close in.
 */
function brainSkirmisher(state: GameState, m: Actor): void {
  const d = defOf(m);
  const t = currentTarget(state, m);
  if (!t) return idle(state, m);
  const dist = chebyshev(m.x, m.y, t.x, t.y);
  const fumbling = reloading(m);
  if (dist <= 1) {
    if (!fumbling && stepAway(state, m, t.x, t.y)) return;
    if (d.dmg > 0) return meleeAttack(state, m, t);
    return;
  }
  if (tryAbilities(state, m, t)) return;
  if (dist <= 2 && !fumbling) stepAway(state, m, t.x, t.y);
  else if (dist > 5) stepToward(state, m, t.x, t.y);
}

function brainThief(state: GameState, m: Actor): void {
  const ai = m.ai;
  if (!ai) return;
  if (ai.memo?.stolen !== undefined) {
    ai.mode = 'flee';
    const p = actorById(state.floor, state.playerId);
    if (p) stepAway(state, m, p.x, p.y);
    return;
  }
  const t = currentTarget(state, m);
  if (!t) return idle(state, m);
  if (adjacent(m, t)) {
    if (tryAbilities(state, m, t)) return;
    return meleeAttack(state, m, t);
  }
  stepToward(state, m, t.x, t.y);
}

function brainSiren(state: GameState, m: Actor): void {
  const t = currentTarget(state, m);
  if (!t) return idle(state, m);
  if (adjacent(m, t)) return meleeAttack(state, m, t);
  if (tryAbilities(state, m, t)) return;
  const dist = chebyshev(m.x, m.y, t.x, t.y);
  if (dist > 6) stepToward(state, m, t.x, t.y);
}

/** Bosses reuse the generic pieces with phase tweaks. */
function brainAbbot(state: GameState, m: Actor): void {
  const t = currentTarget(state, m);
  if (!t) return idle(state, m);
  const ai = m.ai;
  if (ai && (ai.phase ?? 0) === 0 && m.hp <= m.maxHp / 2) {
    ai.phase = 1;
    if (seen(state, m)) log(state, 'The Abbot staggers back toward the flooded nave, chanting louder!', 'warn');
    for (const ab of defOf(m).abilities ?? []) if (ab.key === 'raise') ai.cd[ab.key] = 0;
  }
  if (tryAbilities(state, m, t)) return;
  if (adjacent(m, t)) return meleeAttack(state, m, t);
  const dist = chebyshev(m.x, m.y, t.x, t.y);
  if ((ai?.phase ?? 0) === 1 && dist <= 3) {
    stepAway(state, m, t.x, t.y);
    return;
  }
  stepToward(state, m, t.x, t.y);
}

function brainLeviathan(state: GameState, m: Actor): void {
  const t = currentTarget(state, m);
  if (!t) {
    const p = actorById(state.floor, state.playerId);
    if (p) stepToward(state, m, p.x, p.y);
    return;
  }
  if (tryAbilities(state, m, t)) return;
  if (adjacent(m, t)) return meleeAttack(state, m, t);
  stepToward(state, m, t.x, t.y);
}

// ---------------------------------------------------------------------------
// Entry point

export function monsterAct(state: GameState, m: Actor): void {
  if (m.dead || !m.ai) return;
  // Charmed creatures fight for the player (they still use their brain).
  const ai = m.ai;
  const d = defOf(m);

  if (ai.intent) {
    resolveIntent(state, m);
    return;
  }
  if (perceive(state, m)) return;
  if (ai.mode === 'asleep' || ai.mode === 'alert') return;

  if (d.flee && m.hp <= m.maxHp * d.flee && ai.mode !== 'flee') {
    ai.mode = 'flee';
    if (seen(state, m)) log(state, `${capName(state, m)} turns to flee!`, 'good');
  }
  if (ai.mode === 'flee') {
    const t = currentTarget(state, m);
    if (t && adjacent(m, t) && !fleeFrom(state, m)) {
      meleeAttack(state, m, t);
      return;
    }
    if (d.brain !== 'thief') {
      fleeFrom(state, m);
      // Regain courage once out of reach.
      if (!t) ai.mode = 'wander';
      return;
    }
  }

  switch (d.brain) {
    case 'melee': return brainMelee(state, m);
    case 'ranged': return brainRanged(state, m);
    case 'turret': return brainTurret(state, m);
    case 'aquatic': return brainAquatic(state, m);
    case 'drifter': return brainDrifter(state, m);
    case 'bomber': return brainBomber(state, m);
    case 'skirmisher': return brainSkirmisher(state, m);
    case 'thief': return brainThief(state, m);
    case 'siren': return brainSiren(state, m);
    case 'summoner': return brainMelee(state, m);
    case 'abbot': return brainAbbot(state, m);
    case 'leviathan': return brainLeviathan(state, m);
  }
}
