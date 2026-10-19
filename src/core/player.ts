// Player commands. Each returns a CmdResult; the turn engine (game.ts) advances time by `cost`.

import { ABILITIES } from '../content/abilities.ts';
import { CONSUMABLES, MAX_STACK } from '../content/consumables.ts';
import { RELICS } from '../content/relics.ts';
import { WEAPONS } from '../content/weapons.ts';
import type { EffectSpec, Shape } from '../content/spec.ts';
import { chebyshev, isStraightLine, sign } from './geom.ts';
import { actorAt, blocksShot, canStand, featureAt, idx, inBounds, isDeep, isWater, itemAt, setPos } from './floor.ts';
import {
  addStatus, dealDamage, dropItem, heal, makeNoise, onEnterTile, pullToward, push, seen,
} from './effects.ts';
import { smashBarrel } from './elements.ts';
import { applySpec, shapeTiles, spawnMonster } from './resolve.ts';
import { int } from './rng.ts';
import {
  abilityMaxCharges, capName, chronicle, emit, enemies, hasHook, hasStatus, hasUpgrade, isPlayer, log, nameOf, player,
  playerBaseDamage, playerMaxBreath, playerMaxHp, relicMods, removeStatus, weaponDef,
} from './state.ts';
import { SURF, T, TERRAIN } from './terrain.ts';
import type { Actor, Command, FloorItem, GameState } from './types.ts';

export interface CmdResult {
  ok: boolean;
  /** Energy cost; 0 means no time passes. */
  cost: number;
  /** The UI must ask the player something before this can proceed. */
  needs?: 'belt' | 'relic';
  reason?: string;
}

const FAIL = (reason?: string): CmdResult => ({ ok: false, cost: 0, ...(reason ? { reason } : {}) });
const DONE: CmdResult = { ok: true, cost: 100 };
const FREE: CmdResult = { ok: true, cost: 0 };

// ---------------------------------------------------------------------------
// Attack math

/** True while resolving a blow begun from hiding: it still lands as a sneak attack. */
let ambush = false;

/** Is the target unaware of the player (sneak-attack eligible)? */
export function isUnaware(state: GameState, target: Actor): boolean {
  const p = player(state);
  if (ambush || hasStatus(p, 'hidden')) return true;
  const ai = target.ai;
  if (!ai) return false;
  if (ai.mode === 'asleep' || ai.mode === 'wander' || ai.mode === 'guard' || ai.mode === 'search') return true;
  return false;
}

export interface StrikeCalc {
  base: number;
  mult: number;
  sneak: boolean;
  armorPierce: number;
}

export function strikeCalc(state: GameState, target: Actor, extra = 0): StrikeCalc {
  const p = player(state);
  const f = state.floor;
  let base = playerBaseDamage(state) + extra;
  if (hasStatus(p, 'enraged')) base += 2;
  if (hasHook(state, 'tide_pearl') && isWater(f, idx(f, p.x, p.y))) base += 2;
  if (state.build.weapon.def === 'trident' && isWater(f, idx(f, target.x, target.y))) base += hasUpgrade(state, 'trident_tide') ? 4 : 2;
  let mult = 1;
  const sneak = isUnaware(state, target);
  if (sneak) {
    if (state.build.weapon.def === 'knife') mult = hasUpgrade(state, 'knife_assassin') ? 4 : 3;
    else mult = 2;
  }
  if (isDeep(f, idx(f, p.x, p.y)) && !hasHook(state, 'gillcharm')) mult *= 0.5;
  const armorPierce = hasUpgrade(state, 'axe_sunder') ? 2 : 0;
  return { base, mult, sneak, armorPierce };
}

/** One weapon blow against one target (no verb extras). */
function strike(state: GameState, target: Actor, extra = 0): void {
  if (target.dead) return;
  const p = player(state);
  const c = strikeCalc(state, target, extra);
  if (c.sneak && seen(state, target)) {
    const how = target.ai?.mode === 'asleep' ? 'sleeping' : 'unaware';
    log(state, `You strike the ${how} ${nameOf(state, target).replace(/^the /, '')}! (sneak attack ×${c.mult >= 1 ? c.mult : 1})`, 'good');
  }
  emit(state, { t: 'melee', id: p.id, tx: target.x, ty: target.y });
  if (isDeep(state.floor, idx(state.floor, p.x, p.y)) && !hasHook(state, 'gillcharm') && seen(state, target)) log(state, 'Swimming, your blow lands at half strength.', 'warn');
  dealDamage(state, target, c.base, 'physical', { actor: p, name: 'you', cause: 'melee', verbs: ['hit', 'hits'] }, { mult: c.mult, armorPierce: c.armorPierce });
  if (target.dead) return;
  // Relic on-hit effects.
  if (hasHook(state, 'frostbite')) {
    // Wet targets freeze solid; anything that can't freeze (or isn't wet) is chilled.
    const froze = hasStatus(target, 'wet') && addStatus(state, target, 'frozen', 2);
    if (froze) removeStatus(target, 'wet');
    else addStatus(state, target, 'chilled', 2);
  }
  if (hasHook(state, 'oil_gloves')) addStatus(state, target, 'oiled', 5);
  if (hasUpgrade(state, 'trident_tide')) addStatus(state, target, 'wet', 3);
}

function rot(d: { x: number; y: number }, steps: number): { x: number; y: number } {
  const dirs = [
    { x: 0, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 0 }, { x: 1, y: 1 },
    { x: 0, y: 1 }, { x: -1, y: 1 }, { x: -1, y: 0 }, { x: -1, y: -1 },
  ];
  const i = dirs.findIndex((q) => q.x === d.x && q.y === d.y);
  return dirs[(((i + steps) % 8) + 8) % 8] as { x: number; y: number };
}

/** A full weapon attack on an adjacent target, including the weapon's verb. */
export function weaponAttack(state: GameState, target: Actor, extra = 0): void {
  fromHiding(state, () => weaponBlows(state, target, extra));
}

/**
 * Attacking gives you away, so Hidden ends as the blow begins (a Ghost Blade kill can hide
 * you again). Blows struck from hiding still land as sneak attacks.
 */
function fromHiding(state: GameState, act: () => void): void {
  ambush = removeStatus(player(state), 'hidden');
  try {
    act();
  } finally {
    ambush = false;
  }
  const p = player(state);
  makeNoise(state, p.x, p.y, 4, true);
}

function weaponBlows(state: GameState, target: Actor, extra: number): void {
  const p = player(state);
  const f = state.floor;
  const w = weaponDef(state);
  const d = { x: sign(target.x - p.x), y: sign(target.y - p.y) };
  const tx = target.x;
  const ty = target.y;
  strike(state, target, extra);

  if (w.verb === 'cleave') {
    const extraTiles = hasUpgrade(state, 'axe_whirl')
      ? [0, 1, 2, 3, 4, 5, 6, 7].map((k) => rot({ x: 0, y: -1 }, k))
      : [rot(d, 1), rot(d, -1)];
    for (const e of extraTiles) {
      const x = p.x + e.x;
      const y = p.y + e.y;
      if (x === tx && y === ty) continue;
      const other = actorAt(f, x, y);
      if (other && enemies(state, p, other) && !other.submerged) strike(state, other, extra);
    }
  } else if (w.verb === 'pierce') {
    const depth = hasUpgrade(state, 'trident_fork') ? 2 : 1;
    for (let s = 1; s <= depth; s++) {
      const x = tx + d.x * s;
      const y = ty + d.y * s;
      if (!inBounds(f, x, y) || blocksShot(f, idx(f, x, y))) break;
      const other = actorAt(f, x, y);
      if (other && enemies(state, p, other)) strike(state, other, extra);
    }
  } else if (w.verb === 'knockback' && !target.dead) {
    const dist = hasUpgrade(state, 'maul_heavy') ? 2 : 1;
    push(state, target, d.x, d.y, dist, { actor: p, name: 'you', cause: 'slam' }, 3);
    if (!target.dead && hasUpgrade(state, 'maul_quake')) addStatus(state, target, 'stunned', 1);
  }
}

// ---------------------------------------------------------------------------
// Movement

function movePlayerTo(state: GameState, x: number, y: number, how: 'step' | 'lunge' = 'step'): void {
  const f = state.floor;
  const p = player(state);
  const fx = p.x;
  const fy = p.y;
  const wasDeep = isDeep(f, idx(f, fx, fy));
  state.build.movedTurn = state.turn;
  setPos(f, p, x, y);
  emit(state, { t: 'move', id: p.id, fx, fy, tx: x, ty: y, how });
  onEnterTile(state, p);
  const i = idx(f, x, y);
  // Ice: slide one more tile (unless the rime anklet keeps your footing).
  if ((f.surface[i] as number) === SURF.ICE && !hasHook(state, 'rime_step')) {
    const nx = x + sign(x - fx);
    const ny = y + sign(y - fy);
    if (inBounds(f, nx, ny) && canStand(f, idx(f, nx, ny), 'walk') && !actorAt(f, nx, ny)) {
      setPos(f, p, nx, ny);
      emit(state, { t: 'move', id: p.id, fx: x, fy: y, tx: nx, ty: ny, how: 'slide' });
      onEnterTile(state, p);
      log(state, 'You slide across the ice.', 'info');
    }
  }
  const j = idx(f, p.x, p.y);
  if (!wasDeep && isDeep(f, j) && !(f.surface[j] === SURF.ICE)) {
    log(state, `You plunge into deep water. (breath ${p.breath}/${playerMaxBreath(state)})`, 'warn');
    state.stats.swims += 1;
  }
  autoPickup(state);
  describeHere(state);
}

function autoPickup(state: GameState): void {
  const f = state.floor;
  const p = player(state);
  const it = itemAt(f, p.x, p.y);
  if (!it || it.price !== undefined || it.vault !== undefined) return;
  if (it.item.kind === 'pearls') {
    const n = Math.max(1, Math.round(it.item.count * relicMods(state).pearlMult));
    state.build.pearls += n;
    state.stats.pearlsFound += n;
    f.items = f.items.filter((x) => x.id !== it.id);
    log(state, `You gather ${n} pearl${n > 1 ? 's' : ''}.`, 'good');
    return;
  }
  if (it.item.kind === 'consumable') {
    const slot = beltSlotFor(state, it.item.def);
    if (slot >= 0) {
      addToBelt(state, slot, it.item.def, it.item.count);
      f.items = f.items.filter((x) => x.id !== it.id);
      log(state, `You pick up ${itemLabel(it)}.`, 'good');
    }
  }
}

function describeHere(state: GameState): void {
  const f = state.floor;
  const p = player(state);
  const it = itemAt(f, p.x, p.y);
  if (it) {
    if (it.price !== undefined) log(state, `${capFirst(itemLabel(it))} — ${it.price} pearls. [g] to buy.`, 'info');
    else if (it.vault !== undefined) log(state, `An offering: ${itemLabel(it)}. [g] to take it — the others will sink.`, 'info');
    else if (it.item.kind === 'consumable') log(state, `${capFirst(itemLabel(it))} lies here, but your belt is full. [g] to swap.`, 'info');
    else log(state, `${capFirst(itemLabel(it))} lies here. [g] to take it.`, 'info');
  }
  const ft = featureAt(f, p.x, p.y);
  if (ft?.kind === 'exit') log(state, `A way up (${ft.route === 'rift' ? 'the Rift' : 'the Stair'}). [<] to climb.`, 'info');
  if (ft?.kind === 'shrine' && !ft.used) log(state, 'A tide shrine. [g] to make an offering.', 'info');
  if (ft?.kind === 'spring' && !ft.used) log(state, 'A freshwater spring. [g] to drink.', 'info');
}

export function capFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function itemLabel(it: FloorItem | { item: FloorItem['item'] }): string {
  const item = it.item;
  switch (item.kind) {
    case 'pearls': return `${item.count} pearl${item.count > 1 ? 's' : ''}`;
    case 'consumable': {
      const d = CONSUMABLES[item.def];
      return `${item.count > 1 ? item.count + ' ' : 'a '}${d?.name ?? item.def}${item.count > 1 ? 's' : ''}`;
    }
    case 'weapon': return `the ${WEAPONS[item.def]?.name ?? item.def}`;
    case 'relic': return `the ${RELICS[item.def]?.name ?? item.def}`;
  }
}

/** Handles a directional move: attack, lunge, reach, open, smash, or step. */
function cmdMove(state: GameState, dx: number, dy: number): CmdResult {
  const f = state.floor;
  const p = player(state);
  if ((dx === 0 && dy === 0) || Math.abs(dx) > 1 || Math.abs(dy) > 1) return FAIL('not a step');
  const tx = p.x + dx;
  const ty = p.y + dy;
  if (!inBounds(f, tx, ty)) return FAIL('the edge of the map');
  const w = weaponDef(state);

  // Bump attack.
  const occ = actorAt(f, tx, ty);
  if (occ) {
    if (enemies(state, p, occ)) {
      if (occ.submerged) {
        occ.submerged = false;
        log(state, `Something lunges up from the water — ${nameOf(state, occ)}!`, 'warn');
      }
      weaponAttack(state, occ);
      return DONE;
    }
    // Swap places with an ally.
    if (!hasStatus(p, 'rooted')) {
      setPos(f, occ, p.x, p.y);
      movePlayerTo(state, tx, ty);
      return DONE;
    }
    return FAIL();
  }

  const i = idx(f, tx, ty);
  const t = f.terrain[i] as number;
  if (t === T.BARREL) {
    smashBarrel(state, i);
    makeNoise(state, tx, ty, 4, true);
    return DONE;
  }

  // Reach: attack an enemy two (or three) tiles away without moving.
  if (w.verb === 'reach' && !blocksShot(f, i)) {
    const maxR = hasUpgrade(state, 'spear_long') ? 3 : 2;
    for (let r = 2; r <= maxR; r++) {
      const x = p.x + dx * r;
      const y = p.y + dy * r;
      if (!inBounds(f, x, y)) break;
      const mid = actorAt(f, p.x + dx * (r - 1), p.y + dy * (r - 1));
      if (mid) break;
      if (blocksShot(f, idx(f, x, y))) break;
      const target = actorAt(f, x, y);
      if (target && enemies(state, p, target) && !target.submerged && f.vis[idx(f, x, y)]) {
        weaponAttack(state, target);
        return DONE;
      }
    }
  }

  if (!canStand(f, i, 'walk')) return FAIL(`the ${TERRAIN[t]?.name ?? 'way'} is in the way`);
  if (hasStatus(p, 'rooted')) {
    log(state, 'You are held fast and cannot move!', 'warn');
    return FAIL('rooted');
  }

  // Lunge: step toward an enemy two (or three) tiles away and strike it.
  if (w.verb === 'lunge') {
    const maxR = hasUpgrade(state, 'cutlass_long') ? 3 : 2;
    for (let r = 2; r <= maxR; r++) {
      const x = p.x + dx * r;
      const y = p.y + dy * r;
      if (!inBounds(f, x, y)) break;
      // Every tile before the target must be free and standable.
      let clear = true;
      for (let s = 1; s < r; s++) {
        const cx = p.x + dx * s;
        const cy = p.y + dy * s;
        if (actorAt(f, cx, cy) || !canStand(f, idx(f, cx, cy), 'walk')) clear = false;
      }
      if (!clear) break;
      const target = actorAt(f, x, y);
      if (target && enemies(state, p, target) && !target.submerged && f.vis[idx(f, x, y)]) {
        lunge(state, target, dx, dy);
        return DONE;
      }
    }
  }

  movePlayerTo(state, tx, ty);
  return DONE;
}

/** Cutlass lunge: step up to the target along (dx, dy) and strike it for +2. */
function lunge(state: GameState, target: Actor, dx: number, dy: number): void {
  const f = state.floor;
  const p = player(state);
  movePlayerTo(state, target.x - dx, target.y - dy, 'lunge');
  if (target.dead) return;
  log(state, 'You lunge!', 'good');
  weaponAttack(state, target, 2);
  if (hasUpgrade(state, 'cutlass_flourish')) {
    for (const a of [...f.actors]) {
      if (a.dead || a.id === target.id || !enemies(state, p, a) || a.submerged) continue;
      if (chebyshev(a.x, a.y, p.x, p.y) <= 1) weaponAttack(state, a, 0);
    }
  }
}

/** How far the weapon's targeted attack reaches (1 = adjacent only). */
export function weaponRange(state: GameState): number {
  const w = weaponDef(state);
  if (w.verb === 'pull') return hasUpgrade(state, 'harpoon_line') ? 6 : 4;
  if (w.verb === 'reach') return hasUpgrade(state, 'spear_long') ? 3 : 2;
  if (w.verb === 'lunge') return hasUpgrade(state, 'cutlass_long') ? 3 : 2;
  return 1;
}

/**
 * Why a weapon attack on (x, y) is impossible, or undefined if it can be made. Shared by the
 * command and the UI, so what the targeting cursor promises is what happens.
 */
export function attackProblem(state: GameState, x: number, y: number): string | undefined {
  const f = state.floor;
  const p = player(state);
  if (!inBounds(f, x, y)) return 'no visible target';
  const target = actorAt(f, x, y);
  if (!target || target.dead || !enemies(state, p, target) || !f.vis[idx(f, x, y)] || target.submerged) return 'no visible target';
  const d = chebyshev(p.x, p.y, x, y);
  if (d <= 1) return undefined;
  const w = weaponDef(state);
  if (w.verb !== 'pull' && w.verb !== 'reach' && w.verb !== 'lunge') return 'out of reach';
  if (!isStraightLine(x - p.x, y - p.y)) return 'not in a straight line';
  if (d > weaponRange(state)) return 'out of reach';
  if (w.verb === 'lunge' && hasStatus(p, 'rooted')) return 'you are held fast';
  const sx = sign(x - p.x);
  const sy = sign(y - p.y);
  for (let s = 1; s < d; s++) {
    const cx = p.x + sx * s;
    const cy = p.y + sy * s;
    const j = idx(f, cx, cy);
    if (actorAt(f, cx, cy)) return 'path blocked';
    if (w.verb === 'lunge' ? !canStand(f, j, 'walk') : blocksShot(f, j)) return 'path blocked';
  }
  return undefined;
}

/** Targeted attack: harpoon pull, spear reach or cutlass lunge chosen by clicking. */
function cmdAttack(state: GameState, x: number, y: number): CmdResult {
  const f = state.floor;
  const p = player(state);
  const problem = attackProblem(state, x, y);
  if (problem) return FAIL(problem);
  const target = actorAt(f, x, y) as Actor;
  const d = chebyshev(p.x, p.y, x, y);
  if (d <= 1) {
    weaponAttack(state, target);
    return DONE;
  }
  const sx = sign(x - p.x);
  const sy = sign(y - p.y);
  switch (weaponDef(state).verb) {
    case 'pull':
      emit(state, { t: 'shot', fx: p.x, fy: p.y, tx: x, ty: y, kind: 'hit' });
      log(state, `Your harpoon bites into ${nameOf(state, target)}!`, 'good');
      pullToward(state, target, p.x, p.y, d);
      if (!target.dead && chebyshev(target.x, target.y, p.x, p.y) <= 1) {
        if (hasUpgrade(state, 'harpoon_barb')) addStatus(state, target, 'rooted', 2);
        weaponAttack(state, target);
      } else if (!target.dead) {
        // Couldn't be moved (too heavy): the harpoon still strikes.
        fromHiding(state, () => strike(state, target));
      }
      return DONE;
    case 'reach':
      weaponAttack(state, target);
      return DONE;
    case 'lunge':
      lunge(state, target, sx, sy);
      return DONE;
    default:
      return FAIL('out of reach');
  }
}

// ---------------------------------------------------------------------------
// Belt

export function beltSlotFor(state: GameState, def: string): number {
  const belt = state.build.belt;
  for (let i = 0; i < belt.length; i++) {
    const s = belt[i];
    if (s && s.def === def && s.count < MAX_STACK) return i;
  }
  for (let i = 0; i < belt.length; i++) if (!belt[i]) return i;
  return -1;
}

function addToBelt(state: GameState, slot: number, def: string, count: number): number {
  const belt = state.build.belt;
  const s = belt[slot];
  if (!s) {
    const n = Math.min(MAX_STACK, count);
    belt[slot] = { def, count: n };
    return count - n;
  }
  const room = MAX_STACK - s.count;
  const n = Math.min(room, count);
  s.count += n;
  return count - n;
}

/** Why a shape can't be aimed at (x, y), or undefined if it can. Shared by the UI's cursor. */
export function targetProblem(state: GameState, shape: Shape, x: number | undefined, y: number | undefined): string | undefined {
  const f = state.floor;
  const p = player(state);
  if (shape.k === 'self' || shape.k === 'burst') return undefined;
  if (x === undefined || y === undefined || !inBounds(f, x, y)) return 'choose a tile on the map';
  // A flask can be dropped at your own feet (it catches you too); aimed shapes need a direction.
  if (x === p.x && y === p.y && shape.k !== 'lob') return 'aim away from yourself';
  const d = chebyshev(p.x, p.y, x, y);
  switch (shape.k) {
    case 'melee':
      return d <= 1 ? undefined : 'it only reaches an adjacent tile';
    case 'lob':
      if (d > shape.range) return `out of range (${shape.range} tiles)`;
      return f.vis[idx(f, x, y)] === 1 ? undefined : 'you cannot see that tile';
    case 'tile':
      if (d > shape.range) return `out of range (${shape.range} tiles)`;
      if (f.vis[idx(f, x, y)] !== 1) return 'you cannot see that tile';
      if (!canStand(f, idx(f, x, y), 'walk')) return 'you cannot stand there';
      return actorAt(f, x, y) ? 'something is standing there' : undefined;
    default:
      return undefined;
  }
}

export function abilityBonus(state: GameState, effect: EffectSpec): number {
  let bonus = relicMods(state).abilityDamage + elementBonus(state, effect);
  if (hasUpgrade(state, 'staff_echo')) bonus += 2;
  return bonus;
}

/** Ember Heart and Stormglass add to all your fire and lightning (abilities and thrown items). */
export function elementBonus(state: GameState, effect: EffectSpec): number {
  if (effect.dtype === 'fire' && hasHook(state, 'ember_heart')) return 2;
  if (effect.dtype === 'lightning' && hasHook(state, 'stormglass')) return 2;
  return 0;
}

function cmdAbility(state: GameState, slot: number, x?: number, y?: number): CmdResult {
  const p = player(state);
  const ab = state.build.abilities[slot];
  if (!ab) return FAIL('no ability');
  const d = ABILITIES[ab.def];
  if (!d) return FAIL('unknown ability');
  if (ab.charges <= 0) {
    log(state, `${d.name} is spent until you climb higher.`, 'warn');
    return FAIL('no charges');
  }
  const aimProblem = targetProblem(state, d.shape, x, y);
  if (aimProblem) return FAIL(aimProblem);
  const tx = x ?? p.x;
  const ty = y ?? p.y;
  ab.charges -= 1;
  state.stats.abilitiesUsed += 1;
  log(state, `You cast ${d.name}.`, 'info');
  // Casting gives you away (before it resolves, so a Ghost Blade kill can hide you again).
  removeStatus(p, 'hidden');
  applySpec(state, p, d.shape, d.effect, tx, ty, {
    name: 'you', cause: d.name.toLowerCase(), bonus: abilityBonus(state, d.effect), noise: d.school === 'shadow' ? 2 : 5,
  });
  return DONE;
}

function cmdUse(state: GameState, slot: number, x?: number, y?: number): CmdResult {
  const p = player(state);
  const s = state.build.belt[slot];
  if (!s) return FAIL('empty slot');
  const d = CONSUMABLES[s.def];
  if (!d) return FAIL('unknown item');
  if (d.use === 'drink' && d.effect.heal && p.hp >= p.maxHp && !d.effect.cleanse) {
    log(state, 'You are already at full health.', 'info');
    return FAIL('full health');
  }
  const aimProblem = targetProblem(state, d.shape, x, y);
  if (aimProblem) return FAIL(aimProblem);
  const tx = x ?? p.x;
  const ty = y ?? p.y;
  s.count -= 1;
  if (s.count <= 0) state.build.belt[slot] = null;
  state.stats.itemsUsed += 1;
  const verbWord = d.use === 'drink' ? 'drink' : d.use === 'throw' ? 'throw' : 'use';
  log(state, `You ${verbWord} the ${d.name}.`, 'info');
  applySpec(state, p, d.shape, d.effect, tx, ty, { name: 'you', cause: d.name.toLowerCase(), bonus: elementBonus(state, d.effect), noise: d.use === 'throw' ? 4 : 1 });
  return DONE;
}

// ---------------------------------------------------------------------------
// Picking things up

/**
 * Recomputes max HP after the build changes. A newly taken relic's max-HP bonus comes with
 * matching health, but only the first time that relic is taken, so swapping relics in and
 * out can never refill health.
 */
function syncMaxHp(state: GameState, gainedRelic?: string): void {
  const p = player(state);
  const b = state.build;
  const max = playerMaxHp(state);
  const bonus = gainedRelic ? (RELICS[gainedRelic]?.mods?.maxHp ?? 0) : 0;
  if (gainedRelic && bonus > 0 && !(b.hpGranted ?? []).includes(gainedRelic)) {
    (b.hpGranted ??= []).push(gainedRelic);
    p.hp += bonus;
  }
  p.maxHp = max;
  if (p.hp > max) p.hp = max;
  if (p.breath > playerMaxBreath(state)) p.breath = playerMaxBreath(state);
}

export function refreshAbilityMax(state: GameState): void {
  for (const ab of state.build.abilities) {
    const d = ABILITIES[ab.def];
    if (!d) continue;
    const bonus = state.build.boons.filter((b) => b === `charge:${ab.def}`).length;
    ab.max = abilityMaxCharges(state, d.charges + bonus);
    if (ab.charges > ab.max) ab.charges = ab.max;
  }
}

function sinkVault(state: GameState, group: number, keepId: number): void {
  const f = state.floor;
  const sunk = f.items.filter((it) => it.vault === group && it.id !== keepId);
  if (sunk.length === 0) return;
  f.items = f.items.filter((it) => !(it.vault === group && it.id !== keepId));
  emit(state, { t: 'fx', tiles: sunk.map((it) => idx(f, it.x, it.y)), kind: 'water' });
  log(state, 'The other offerings sink out of reach.', 'info');
}

function cmdPickup(state: GameState, replace?: number): CmdResult {
  const f = state.floor;
  const p = player(state);
  const it = itemAt(f, p.x, p.y);
  const ft = featureAt(f, p.x, p.y);
  if (!it) {
    if (ft?.kind === 'spring' && !ft.used) return drinkSpring(state, ft);
    if (ft?.kind === 'shrine' && !ft.used) return FAIL('shrine');
    return FAIL('nothing here');
  }
  if (it.price !== undefined && state.build.pearls < it.price) {
    log(state, `You need ${it.price} pearls for that (you have ${state.build.pearls}).`, 'warn');
    return FAIL('too expensive');
  }
  const item = it.item;
  switch (item.kind) {
    case 'pearls':
      autoPickup(state);
      return FREE;
    case 'consumable': {
      const slot = beltSlotFor(state, item.def);
      if (slot < 0) {
        if (replace === undefined || replace < 0 || replace >= state.build.belt.length) return { ok: false, cost: 0, needs: 'belt' };
        const old = state.build.belt[replace];
        state.build.belt[replace] = null;
        // Swap: the new item leaves the floor and the old stack takes its place.
        f.items = f.items.filter((x) => x.id !== it.id);
        if (old) f.items.push({ id: state.nextId++, x: p.x, y: p.y, item: { kind: 'consumable', def: old.def, count: old.count } });
        addToBelt(state, replace, item.def, item.count);
        break;
      }
      const left = addToBelt(state, slot, item.def, item.count);
      if (left > 0) item.count = left;
      else f.items = f.items.filter((x) => x.id !== it.id);
      break;
    }
    case 'weapon': {
      const old = state.build.weapon;
      state.build.weapon = { def: item.def, upgrades: item.upgrades ? [...item.upgrades] : [] };
      f.items = f.items.filter((x) => x.id !== it.id);
      dropItem(state, p.x, p.y, { kind: 'weapon', def: old.def, count: 1, upgrades: old.upgrades });
      refreshAbilityMax(state);
      log(state, `You take up the ${WEAPONS[item.def]?.name}. ${WEAPONS[item.def]?.rule ?? ''}`, 'good');
      break;
    }
    case 'relic': {
      const b = state.build;
      if (b.relics.length >= b.relicSlots) {
        if (replace === undefined || replace < 0 || replace >= b.relics.length) return { ok: false, cost: 0, needs: 'relic' };
        const old = b.relics[replace] as string;
        b.relics.splice(replace, 1);
        f.items = f.items.filter((x) => x.id !== it.id);
        dropItem(state, p.x, p.y, { kind: 'relic', def: old, count: 1 });
        log(state, `You set down the ${RELICS[old]?.name}.`, 'info');
      } else {
        f.items = f.items.filter((x) => x.id !== it.id);
      }
      b.relics.push(item.def);
      syncMaxHp(state, item.def);
      refreshAbilityMax(state);
      log(state, `You take the ${RELICS[item.def]?.name}. ${RELICS[item.def]?.desc ?? ''}`, 'good');
      break;
    }
  }
  if (it.price !== undefined) {
    state.build.pearls -= it.price;
    log(state, `Paid ${it.price} pearls.`, 'info');
    delete it.price;
  }
  if (it.vault !== undefined) sinkVault(state, it.vault, it.id);
  if (item.kind === 'consumable') log(state, `You take ${itemLabel({ item: { ...item } })}.`, 'good');
  return DONE;
}

function drinkSpring(state: GameState, ft: { used?: boolean; x: number; y: number }): CmdResult {
  const f = state.floor;
  const p = player(state);
  if (isDeep(f, idx(f, ft.x, ft.y))) {
    log(state, 'The spring is drowned beneath salt water.', 'warn');
    return FAIL('flooded');
  }
  ft.used = true;
  log(state, 'You drink deep from the cold spring.', 'good');
  heal(state, p, 12);
  p.statuses = p.statuses.filter((s) => s.id !== 'poisoned');
  return DONE;
}

function cmdDrop(state: GameState, slot: number): CmdResult {
  const f = state.floor;
  const p = player(state);
  const s = state.build.belt[slot];
  if (!s) return FAIL('empty slot');
  if (itemAt(f, p.x, p.y)) {
    log(state, 'There is no room to drop that here.', 'info');
    return FAIL('occupied');
  }
  state.build.belt[slot] = null;
  f.items.push({ id: state.nextId++, x: p.x, y: p.y, item: { kind: 'consumable', def: s.def, count: s.count } });
  log(state, `You drop the ${CONSUMABLES[s.def]?.name}.`, 'info');
  return FREE;
}

// ---------------------------------------------------------------------------
// Shrines and the beacon

/**
 * The first light in the lamp draws the storm: two wisps gather around you, where they can
 * see you (and, glowing, be seen): in your line of sight 3–7 tiles off if there's room, then
 * anywhere in sight at least 2 off, then anywhere around the lighthouse.
 */
function callTheStorm(state: GameState, bx: number, by: number): void {
  const f = state.floor;
  const p = player(state);
  const near: number[] = [];
  const inSight: number[] = [];
  const around: number[] = [];
  for (let dy = -8; dy <= 8; dy++) {
    for (let dx = -8; dx <= 8; dx++) {
      const x = p.x + dx;
      const y = p.y + dy;
      if (!inBounds(f, x, y) || actorAt(f, x, y)) continue;
      const i = idx(f, x, y);
      if (!canStand(f, i, 'fly')) continue;
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      const fromLamp = Math.max(Math.abs(x - bx), Math.abs(y - by));
      if (f.los[i] === 1 && d >= 3 && d <= 7) near.push(i);
      else if (f.los[i] === 1 && d >= 2) inSight.push(i);
      else if (fromLamp >= 4 && fromLamp <= 7) around.push(i);
    }
  }
  let n = 0;
  for (let k = 0; k < 2; k++) {
    const pool = near.length ? near : inSight.length ? inSight : around;
    if (!pool.length) break;
    const i = pool.splice(int(state.rng, pool.length), 1)[0] as number;
    const w = spawnMonster(state, 'storm_wisp', i % f.w, Math.floor(i / f.w));
    if (w?.ai) {
      w.ai.mode = 'hunt';
      w.ai.targetId = state.playerId;
      n++;
    }
  }
  if (n) log(state, 'The light calls the storm down: storm wisps gather around you!', 'warn');
}

export const SHRINE_OPTIONS = [
  { cost: 12, name: 'Mercy', desc: 'Heal half your max HP.' },
  { cost: 18, name: 'Renewal', desc: 'Restore all ability charges.' },
  { cost: 30, name: 'Blessing', desc: '+5 max HP.' },
];

function cmdShrine(state: GameState, option: number): CmdResult {
  const f = state.floor;
  const p = player(state);
  const ft = f.features.find((x) => x.kind === 'shrine' && chebyshev(x.x, x.y, p.x, p.y) <= 1);
  if (!ft || ft.used) return FAIL('no shrine');
  const opt = SHRINE_OPTIONS[option];
  if (!opt) return FAIL('bad option');
  if (state.build.pearls < opt.cost) {
    log(state, `The shrine asks ${opt.cost} pearls. You have ${state.build.pearls}.`, 'warn');
    return FAIL('too expensive');
  }
  state.build.pearls -= opt.cost;
  ft.used = true;
  if (option === 0) heal(state, p, Math.ceil(p.maxHp / 2));
  if (option === 1) {
    for (const ab of state.build.abilities) ab.charges = ab.max;
    log(state, 'Your abilities are renewed.', 'good');
  }
  if (option === 2) {
    state.build.maxHpBonus += 5;
    p.hp += 5;
    syncMaxHp(state);
    log(state, 'You feel sturdier.', 'good');
  }
  emit(state, { t: 'fx', tiles: [idx(f, ft.x, ft.y)], kind: 'heal' });
  return DONE;
}

function cmdInteract(state: GameState): CmdResult {
  const f = state.floor;
  const p = player(state);
  const beacon = f.features.find((x) => x.kind === 'beacon' && chebyshev(x.x, x.y, p.x, p.y) <= 1);
  if (beacon) {
    const b = state.build;
    const continuing = b.beaconTurn !== undefined && b.beaconTurn >= state.turn - 1;
    beacon.progress = continuing ? (beacon.progress ?? 0) + 1 : 1;
    b.beaconTurn = state.turn;
    if ((beacon.progress ?? 0) >= 3) {
      state.status = 'won';
      log(state, 'The beacon roars into light. Far out on the black water, a ship turns toward the shore.', 'good');
      chronicle(state, 'Lit the lighthouse beacon. A ship turned toward the shore.');
      return DONE;
    }
    log(state, `You feed the beacon's wick… (${beacon.progress}/3 — keep at it)`, 'good');
    if (!beacon.called) {
      beacon.called = true;
      callTheStorm(state, beacon.x, beacon.y);
    }
    return DONE;
  }
  const ft = featureAt(f, p.x, p.y) ?? f.features.find((x) => chebyshev(x.x, x.y, p.x, p.y) <= 1 && (x.kind === 'spring' || x.kind === 'shrine'));
  if (ft?.kind === 'spring' && !ft.used) return drinkSpring(state, ft);
  return FAIL('nothing to interact with');
}

// ---------------------------------------------------------------------------

export function performPlayerCommand(state: GameState, cmd: Command): CmdResult {
  switch (cmd.t) {
    case 'move': return cmdMove(state, cmd.dx, cmd.dy);
    case 'attack': return cmdAttack(state, cmd.x, cmd.y);
    case 'wait': return DONE;
    case 'ability': return cmdAbility(state, cmd.slot, cmd.x, cmd.y);
    case 'use': return cmdUse(state, cmd.slot, cmd.x, cmd.y);
    case 'pickup': return cmdPickup(state, cmd.replace);
    case 'drop': return cmdDrop(state, cmd.slot);
    case 'shrine': return cmdShrine(state, cmd.option);
    case 'interact': return cmdInteract(state);
    case 'ascend':
    case 'choose':
      return FAIL('handled by game');
  }
}

/** Spear: strike an enemy that just stepped adjacent (once per turn). */
export function onMonsterMoved(state: GameState, m: Actor): void {
  if (m.dead || state.build.weapon.def !== 'spear' || !hasUpgrade(state, 'spear_brace')) return;
  if (state.build.braceTurn === state.turn) return;
  // A set spear needs you standing firm: not on a turn you stepped.
  if (state.build.movedTurn === state.turn) return;
  const p = player(state);
  if (p.dead || !enemies(state, p, m) || m.submerged) return;
  if (chebyshev(p.x, p.y, m.x, m.y) !== 1) return;
  state.build.braceTurn = state.turn;
  log(state, `You catch ${nameOf(state, m)} on your spear as it closes in!`, 'good');
  weaponAttack(state, m);
}
