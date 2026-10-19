// The effects engine: damage, healing, statuses, forced movement, noise and death.
// Every HP change flows through here with an attributed source, so the log, the death
// recap and previews are all views of the same events.

import { STATUSES } from '../content/statuses.ts';
import { MONSTERS } from '../content/monsters.ts';
import { CONSUMABLES } from '../content/consumables.ts';
import { ABILITIES } from '../content/abilities.ts';
import { actorAt, canStand, featureAt, idx, inBounds, isDeep, isWater, nearestTile, setPos, clearOcc, itemAt } from './floor.ts';
import {
  armorOf, capName, chronicle, emit, getStatus, hasHook, hasStatus, hasUpgrade, isImmuneToStatus,
  isPlayer, log, mdef, moveModeOf, nameOf, player, playerMaxBreath, relicMods, removeStatus, resistOf, verb,
} from './state.ts';
import type { Actor, DamageType, GameState, StatusId } from './types.ts';
import { SURF, TERRAIN, T } from './terrain.ts';
import { chebyshev } from './geom.ts';

export interface DmgSource {
  actor?: Actor;
  /** Display name of the source, e.g. "the wrecker gunner" or "burning". */
  name: string;
  /** Short cause, e.g. "musket", "melee", "burning", "drowning". */
  cause: string;
  /** Verb for the hit message ("bites", "shoots"). If absent, a generic message is used. */
  verbs?: [string, string];
}

export interface DmgOpts {
  armorPierce?: number;
  /** Damage over time or from the ground: the victim wakes, but learns nothing about the source. */
  indirect?: boolean;
  /** Suppress the standard hit message (caller prints its own). */
  quiet?: boolean;
  /** Physical multiplier applied before armor (sneak attacks etc.). */
  mult?: number;
}

/** True if the player can currently see this actor (for message filtering). */
export function seen(state: GameState, a: Actor): boolean {
  if (isPlayer(state, a)) return true;
  const f = state.floor;
  if (a.submerged) return false;
  return inBounds(f, a.x, a.y) && f.vis[a.y * f.w + a.x] === 1;
}

/** Computes the damage an attack would deal after all modifiers (no side effects). */
export function computeDamage(state: GameState, target: Actor, base: number, dtype: DamageType, src: DmgSource, opts: DmgOpts = {}): number {
  if (base <= 0) return 0;
  let mult = resistOf(state, target, dtype);
  if (mult === 0) return 0;
  mult *= opts.mult ?? 1;
  if (dtype === 'fire') {
    if (hasStatus(target, 'wet')) mult *= 0.5;
    if (hasStatus(target, 'oiled')) mult *= 2;
  }
  if (dtype === 'lightning' && hasStatus(target, 'wet')) mult *= 2;
  if (dtype === 'physical' && hasStatus(target, 'frozen')) {
    mult *= src.actor && isPlayer(state, src.actor) && hasHook(state, 'heart_of_winter') ? 3 : 2;
  }
  let amt = base * mult;
  if (dtype === 'physical') amt -= Math.max(0, armorOf(state, target) - (opts.armorPierce ?? 0));
  let out = Math.floor(amt);
  if (out < 1) out = 1;
  return out;
}

/**
 * Deals damage to target. Returns the amount dealt.
 * Handles resistances, wet/oiled/frozen interactions, armor, logging, death.
 */
export function dealDamage(state: GameState, target: Actor, base: number, dtype: DamageType, src: DmgSource, opts: DmgOpts = {}): number {
  if (target.dead || base <= 0) return 0;
  const resist = resistOf(state, target, dtype);
  if (resist === 0) {
    if (seen(state, target) && !opts.quiet) log(state, `${capName(state, target)} ${verb(state, target, 'are', 'is')} unharmed by ${dtypeWord(dtype)}.`, 'info');
    return 0;
  }
  const amt = computeDamage(state, target, base, dtype, src, opts);
  const wasFrozen = hasStatus(target, 'frozen');
  target.hp -= amt;
  emit(state, { t: 'dmg', id: target.id, x: target.x, y: target.y, amount: amt, dtype });

  // Message.
  if (!opts.quiet && (seen(state, target) || (src.actor && seen(state, src.actor)))) {
    const tn = nameOf(state, target);
    if (src.actor && src.verbs) {
      const v = isPlayer(state, src.actor) ? src.verbs[0] : src.verbs[1];
      log(state, `${capName(state, src.actor)} ${v} ${tn} for ${amt}.`, isPlayer(state, target) ? 'dmg' : 'info');
    } else {
      log(state, `${capName(state, target)} ${verb(state, target, 'take', 'takes')} ${amt} ${dtypeWord(dtype)} damage (${src.cause}).`, isPlayer(state, target) ? 'dmg' : 'info');
    }
  }

  // Bookkeeping.
  if (isPlayer(state, target)) {
    state.stats.damageTaken += amt;
    if (!state.preview) {
      state.dmgLog.push({ turn: state.turn, amount: amt, dtype, source: src.name, cause: src.cause, hpAfter: Math.max(0, target.hp) });
      if (state.dmgLog.length > 40) state.dmgLog.splice(0, state.dmgLog.length - 40);
    }
  } else if (src.actor && isPlayer(state, src.actor)) {
    state.stats.damageDealt += amt;
  }

  // Elemental aftermath.
  if (dtype === 'fire') {
    if (wasFrozen) removeStatus(target, 'frozen');
    if (hasStatus(target, 'wet')) removeStatus(target, 'wet');
    if (hasStatus(target, 'oiled')) {
      removeStatus(target, 'oiled');
      addStatus(state, target, 'burning', 3, undefined, src.actor?.id);
    }
  } else if (dtype === 'cold') {
    if (hasStatus(target, 'burning')) removeStatus(target, 'burning');
    if (hasStatus(target, 'wet') || isWater(state.floor, idx(state.floor, target.x, target.y))) {
      if (addStatus(state, target, 'frozen', 2)) removeStatus(target, 'wet');
    } else {
      addStatus(state, target, 'chilled', 2);
    }
  } else if (dtype === 'physical' && wasFrozen && amt > 0) {
    removeStatus(target, 'frozen');
    if (seen(state, target)) log(state, `The ice around ${nameOf(state, target)} shatters!`, 'info');
    emit(state, { t: 'fx', tiles: [idx(state.floor, target.x, target.y)], kind: 'frost' });
  }

  // Being hurt wakes you up and gets your attention.
  if (target.ai && !target.dead) {
    if (target.ai.mode === 'asleep' || target.ai.mode === 'wander' || target.ai.mode === 'search') {
      target.ai.mode = 'hunt';
      if (src.actor && !opts.indirect) {
        target.ai.targetId = src.actor.id;
        target.ai.lastX = src.actor.x;
        target.ai.lastY = src.actor.y;
        target.ai.lastSeenTurn = state.turn;
      }
    }
  }

  // Eelskin: shock anything that strikes you from an adjacent tile while you are wet.
  const struckInMelee = !!src.actor && src.actor !== target && dtype === 'physical' && chebyshev(src.actor.x, src.actor.y, target.x, target.y) <= 1;
  if (isPlayer(state, target) && struckInMelee && src.actor && !src.actor.dead && hasHook(state, 'eelskin') && hasStatus(target, 'wet')) {
    dealDamage(state, src.actor, 3, 'lightning', { actor: target, name: 'eelskin', cause: 'eelskin', verbs: ['shock', 'shocks'] });
  }

  if (target.hp <= 0) kill(state, target, src, dtype);
  return amt;
}

function dtypeWord(dt: DamageType): string {
  switch (dt) {
    case 'physical': return 'physical';
    case 'fire': return 'fire';
    case 'cold': return 'cold';
    case 'lightning': return 'lightning';
    case 'poison': return 'poison';
    case 'drown': return 'drowning';
    case 'pure': return '';
  }
}

export function heal(state: GameState, a: Actor, amount: number, quiet = false): number {
  if (a.dead || amount <= 0) return 0;
  const before = a.hp;
  a.hp = Math.min(a.maxHp, a.hp + amount);
  const got = a.hp - before;
  if (got > 0) {
    emit(state, { t: 'heal', id: a.id, x: a.x, y: a.y, amount: got });
    if (!quiet && seen(state, a)) log(state, `${capName(state, a)} ${verb(state, a, 'recover', 'recovers')} ${got} HP.`, isPlayer(state, a) ? 'good' : 'info');
  }
  return got;
}

// ---------------------------------------------------------------------------
// Death

export function kill(state: GameState, a: Actor, src: DmgSource, dtype?: DamageType): void {
  if (a.dead) return;
  a.dead = true;
  a.hp = Math.min(a.hp, 0);
  clearOcc(state.floor, a);
  emit(state, { t: 'die', id: a.id, x: a.x, y: a.y, def: a.def });

  if (isPlayer(state, a)) {
    onPlayerDeath(state, src);
    return;
  }

  const d = mdef(a);
  if (seen(state, a)) {
    const how = d?.tags.includes('undead') || d?.tags.includes('construct') ? 'is destroyed' : 'dies';
    log(state, `${capName(state, a)} ${how}.`, 'good');
  }
  const killer = src.actor;
  const byPlayer = !!killer && isPlayer(state, killer);
  if (byPlayer) {
    state.stats.kills += 1;
    state.stats.killsByDef[a.def] = (state.stats.killsByDef[a.def] ?? 0) + 1;
  }
  if (d?.boss && !state.preview) {
    chronicle(state, `Defeated ${d.name}.`);
    (state.stats.bossesSlain ??= []).push(a.def);
  }

  // Player on-kill hooks.
  if (byPlayer && !state.preview) {
    const p = player(state);
    if (hasHook(state, 'leech')) heal(state, p, 2);
    if (hasUpgrade(state, 'knife_ghost')) addStatus(state, p, 'hidden', 3);
  }

  // Drops.
  if (d?.pearls && !a.summoner) dropPearls(state, a.x, a.y, d.pearls);
  if (d?.onDeath === 'burst_miasma') {
    if (dtype === 'fire' || hasStatus(a, 'burning')) {
      // Burning gas ignites: the bloat explodes instead of spilling miasma.
      if (seen(state, a)) log(state, 'The bloat\'s gas ignites — it explodes!', 'warn');
      const tiles: number[] = [];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = a.x + dx;
          const y = a.y + dy;
          if (!inBounds(state.floor, x, y)) continue;
          tiles.push(idx(state.floor, x, y));
          const victim = actorAt(state.floor, x, y);
          if (victim && !victim.dead) dealDamage(state, victim, 5, 'fire', { ...(src.actor ? { actor: src.actor } : {}), name: 'an exploding bloat', cause: 'explosion' });
        }
      }
      emit(state, { t: 'fx', tiles, kind: 'boom' });
      makeNoise(state, a.x, a.y, 8, false);
    } else {
      burstGas(state, a.x, a.y, 'poison', 70, 1.5);
      if (seen(state, a)) log(state, 'It bursts in a cloud of foul miasma!', 'warn');
    }
  }
  if (d?.onDeath === 'drop_stolen') {
    const stolen = a.ai?.memo?.stolen;
    const count = a.ai?.memo?.stolenCount ?? 1;
    if (stolen !== undefined) {
      const key = Object.keys(CONSUMABLES)[stolen];
      if (key) dropItem(state, a.x, a.y, { kind: 'consumable', def: key, count });
    }
  }
}

function onPlayerDeath(state: GameState, src: DmgSource): void {
  state.status = 'dead';
  const b = state.build;
  const outs: string[] = [];
  for (const s of b.belt) if (s) outs.push(`${CONSUMABLES[s.def]?.name ?? s.def}${s.count > 1 ? ` ×${s.count}` : ''}`);
  for (const ab of b.abilities) if (ab.charges > 0) outs.push(`${ABILITIES[ab.def]?.name ?? ab.def} (${ab.charges} charge${ab.charges > 1 ? 's' : ''})`);
  const cause = deathCause(src);
  state.death = {
    cause,
    killer: src.name,
    floor: state.floor.index,
    turn: state.turn,
    recap: state.dmgLog.slice(-8),
    unusedOuts: outs,
  };
  log(state, `You die. ${cause}.`, 'bad');
  chronicle(state, cause + '.');
}

function deathCause(src: DmgSource): string {
  switch (src.cause) {
    case 'drowning': return 'Drowned';
    case 'burning': return 'Burned to death';
    case 'poison': return 'Succumbed to poison';
    case 'steam': return 'Scalded by steam';
    case 'miasma': return 'Choked on miasma';
    case 'fire': return 'Burned alive';
    case 'slam': return `Dashed against the rocks by ${src.name}`;
    default: {
      const mk = Object.values(MONSTERS).find((m) => `the ${m.name.toLowerCase()}` === src.name || m.name === src.name);
      if (mk) return `Killed by ${mk.boss ? mk.name : 'a ' + mk.name.toLowerCase()} (${src.cause})`;
      return `Killed by ${src.name} (${src.cause})`;
    }
  }
}

// ---------------------------------------------------------------------------
// Items dropped into the world

export function dropItem(state: GameState, x: number, y: number, item: { kind: 'weapon' | 'relic' | 'consumable' | 'pearls'; def: string; count: number; upgrades?: string[] }): void {
  const f = state.floor;
  const i = nearestTile(f, x, y, (j) => {
    const p = { x: j % f.w, y: Math.floor(j / f.w) };
    return (TERRAIN[f.terrain[j] as number]?.walk ?? false) && !itemAt(f, p.x, p.y) && !featureAt(f, p.x, p.y);
  }, 6);
  if (i < 0) return;
  f.items.push({ id: state.nextId++, x: i % f.w, y: Math.floor(i / f.w), item: { ...item } });
}

export function dropPearls(state: GameState, x: number, y: number, n: number): void {
  if (n <= 0) return;
  const f = state.floor;
  const here = itemAt(f, x, y);
  if (here && here.item.kind === 'pearls') {
    here.item.count += n;
    return;
  }
  dropItem(state, x, y, { kind: 'pearls', def: 'pearls', count: n });
}

// ---------------------------------------------------------------------------
// Statuses

/** Applies a status, respecting immunities and elemental exclusions. Returns true if applied. */
/**
 * The tick a new status first counts from. Statuses count down at the end of each world tick,
 * so one applied during the player's action counts that same tick (Brace 4 covers four enemy
 * turns), while one applied during the world tick waits for the next (a stun from a monster
 * still costs you your next turn). Either way, damage over time ticks exactly `turns` times.
 */
function statusStart(state: GameState): number {
  return state.ticking ? state.turn : state.turn - 1;
}

export function addStatus(state: GameState, a: Actor, id: StatusId, turns: number, power?: number, source?: number): boolean {
  if (a.dead || turns <= 0) return false;
  if (isImmuneToStatus(state, a, id)) return false;
  const f = state.floor;
  const here = idx(f, a.x, a.y);
  if (id === 'burning' && (hasStatus(a, 'wet') || isWater(f, here))) return false;
  if (id === 'oiled' && hasStatus(a, 'wet')) return false;
  if (id === 'wet') {
    removeStatus(a, 'oiled');
    if (removeStatus(a, 'burning') && seen(state, a)) log(state, `The flames on ${nameOf(state, a)} hiss out.`, 'info');
  }
  if (id === 'frozen') {
    removeStatus(a, 'burning');
    removeStatus(a, 'chilled');
    interrupt(state, a);
  }
  if (id === 'stunned') interrupt(state, a);

  // Ember Heart: creatures you set Burning burn for 3 extra turns.
  if (id === 'burning' && source === state.playerId && a.id !== state.playerId && hasHook(state, 'ember_heart')) turns += 3;

  const existing = a.statuses.find((s) => s.id === id);
  const isNew = !existing;
  if (existing) {
    if (id === 'poisoned') existing.turns += turns;
    else existing.turns = Math.max(existing.turns, turns);
    if (power !== undefined) existing.power = Math.max(existing.power ?? 0, power);
    if (source !== undefined) existing.source = source;
    existing.t0 = statusStart(state);
  } else {
    const st: { id: StatusId; turns: number; power?: number; source?: number; t0: number } = { id, turns, t0: statusStart(state) };
    if (power !== undefined) st.power = power;
    if (source !== undefined) st.source = source;
    a.statuses.push(st);
  }
  if (isNew && seen(state, a) && id !== 'wet') {
    const nm = STATUSES[id].name.toLowerCase();
    const msgs: Partial<Record<StatusId, string>> = {
      burning: verb(state, a, 'catch fire!', 'catches fire!'),
      frozen: verb(state, a, 'are frozen solid!', 'is frozen solid!'),
      oiled: verb(state, a, 'are drenched in oil.', 'is drenched in oil.'),
      stunned: verb(state, a, 'are stunned!', 'is stunned!'),
      rooted: verb(state, a, 'are held fast!', 'is held fast!'),
      hidden: verb(state, a, 'melt into the shadows.', 'vanishes.'),
      gills: verb(state, a, 'breathe from the air bladder: no breath lost while swimming.', 'breathes from an air bladder.'),
    };
    const text = msgs[id] ?? `${verb(state, a, 'are', 'is')} ${nm}.`;
    log(state, `${capName(state, a)} ${text}`, isPlayer(state, a) && STATUSES[id].harmful ? 'warn' : 'info');
  }
  return true;
}

export function cleanse(state: GameState, a: Actor): void {
  a.statuses = a.statuses.filter((s) => !STATUSES[s.id].harmful);
  if (seen(state, a)) log(state, `${capName(state, a)} ${verb(state, a, 'shake', 'shakes')} off ${verb(state, a, 'your', 'its')} afflictions.`, 'good');
}

/** Cancels a monster's wind-up (knockback, stun and freeze interrupt attacks). */
export function interrupt(state: GameState, a: Actor): void {
  if (a.ai?.intent) {
    delete a.ai.intent;
    if (seen(state, a)) log(state, `${capName(state, a)}'s attack is interrupted!`, 'good');
  }
}

// ---------------------------------------------------------------------------
// Tile entry: the same rules for walking, being pushed, pulled or teleported.

export function onEnterTile(state: GameState, a: Actor): void {
  const f = state.floor;
  const i = idx(f, a.x, a.y);
  // Shoved or dragged out of the water, a diver is in plain sight.
  if (a.submerged && !isWater(f, i)) a.submerged = false;
  if (moveModeOf(a) === 'fly' || moveModeOf(a) === 'phase') {
    // Fliers skim over water and fire; phasers drift through.
    if ((f.fire[i] as number) > 0 && moveModeOf(a) === 'phase') return;
  }
  // Rime anklet: the player's footing freezes before the water can soak them.
  if (isPlayer(state, a) && hasHook(state, 'rime_step') && isWater(f, i)) freezeTile(state, i, true);
  const grounded = moveModeOf(a) !== 'fly';
  if (grounded && isWater(f, i)) {
    addStatus(state, a, 'wet', 3);
    if (isDeep(f, i)) removeStatus(a, 'oiled');
  }
  if (grounded && (f.surface[i] as number) === SURF.OIL && !isWater(f, i) && (f.fire[i] as number) === 0) addStatus(state, a, 'oiled', 8);
  if ((f.fire[i] as number) > 0 && moveModeOf(a) !== 'fly' && !isDeep(f, i)) addStatus(state, a, 'burning', 2, undefined, f.fireBy?.[i]);
  // Closed doors open when entered.
  if ((f.terrain[i] as number) === T.DOOR) f.terrain[i] = T.DOOR_OPEN;
}

export function freezeTile(state: GameState, i: number, quiet = false): void {
  const f = state.floor;
  if (!isWater(f, i)) return;
  if ((f.surface[i] as number) === SURF.OIL) f.surface[i] = SURF.NONE;
  f.surface[i] = SURF.ICE;
  f.surfaceT[i] = 16;
  f.fire[i] = 0;
  if (!quiet) emit(state, { t: 'fx', tiles: [i], kind: 'frost' });
}

// ---------------------------------------------------------------------------
// Forced movement

export function immovable(state: GameState, a: Actor): boolean {
  if (isPlayer(state, a)) return hasHook(state, 'anchor');
  const d = mdef(a);
  return !!d && (d.boss === true || d.tags.includes('rooted'));
}

/**
 * A creature rooted to the rock can't be moved, but a shove still jolts it: like a slam into
 * a wall, it breaks a wind-up. Bosses are unstoppable and shrug it off.
 */
function jolt(state: GameState, a: Actor): void {
  if (!isPlayer(state, a) && !mdef(a)?.boss) interrupt(state, a);
}

/**
 * Pushes `a` up to `dist` tiles in direction (dx, dy). Collisions deal `slam` damage to the
 * pushed creature and to any creature it hits. Returns tiles actually moved.
 */
export function push(state: GameState, a: Actor, dx: number, dy: number, dist: number, src: DmgSource, slam = 2): number {
  if (a.dead || dist <= 0 || (dx === 0 && dy === 0)) return 0;
  if (immovable(state, a)) {
    if (isPlayer(state, a) && !state.preview) log(state, 'You hold fast (Anchor Charm).', 'good');
    jolt(state, a);
    return 0;
  }
  const f = state.floor;
  const mode = moveModeOf(a);
  let moved = 0;
  let slammed = false;
  const fx = a.x;
  const fy = a.y;
  for (let s = 0; s < dist; s++) {
    const nx = a.x + dx;
    const ny = a.y + dy;
    const blockedByTerrain = !inBounds(f, nx, ny) || !canStand(f, idx(f, nx, ny), mode === 'swim' ? 'amphibious' : mode);
    const other = actorAt(f, nx, ny);
    if (blockedByTerrain || other) {
      if (slam > 0) {
        slammed = true;
        if (seen(state, a)) log(state, `${capName(state, a)} ${verb(state, a, 'slam', 'slams')} into ${other ? nameOf(state, other) : 'the wall'}!`, 'info');
        dealDamage(state, a, slam, 'physical', { actor: src.actor, name: src.name, cause: 'slam' }, { quiet: false });
        if (other && !other.dead) dealDamage(state, other, slam, 'physical', { actor: src.actor, name: src.name, cause: 'slam' });
      }
      break;
    }
    setPos(f, a, nx, ny);
    moved++;
    onEnterTile(state, a);
    if (a.dead) break;
  }
  if (moved > 0) emit(state, { t: 'move', id: a.id, fx, fy, tx: a.x, ty: a.y, how: 'push' });
  // Knocked back or slammed against something: either way, the wind-up is broken.
  if (moved > 0 || slammed) interrupt(state, a);
  return moved;
}

/** Pulls `a` toward (tx, ty) until adjacent or blocked. Returns tiles moved. */
export function pullToward(state: GameState, a: Actor, tx: number, ty: number, dist: number): number {
  if (a.dead || dist <= 0) return 0;
  if (immovable(state, a)) {
    if (isPlayer(state, a) && !state.preview) log(state, 'You hold fast (Anchor Charm).', 'good');
    jolt(state, a);
    return 0;
  }
  const f = state.floor;
  const mode = moveModeOf(a);
  let moved = 0;
  const fx = a.x;
  const fy = a.y;
  for (let s = 0; s < dist; s++) {
    if (Math.max(Math.abs(a.x - tx), Math.abs(a.y - ty)) <= 1) break;
    const dx = Math.sign(tx - a.x);
    const dy = Math.sign(ty - a.y);
    const nx = a.x + dx;
    const ny = a.y + dy;
    if (!inBounds(f, nx, ny) || actorAt(f, nx, ny)) break;
    if (!canStand(f, idx(f, nx, ny), mode === 'swim' ? 'amphibious' : mode)) break;
    setPos(f, a, nx, ny);
    moved++;
    onEnterTile(state, a);
    if (a.dead) break;
  }
  if (moved > 0) {
    emit(state, { t: 'move', id: a.id, fx, fy, tx: a.x, ty: a.y, how: 'pull' });
    interrupt(state, a);
  }
  return moved;
}

export function teleport(state: GameState, a: Actor, x: number, y: number): void {
  const fx = a.x;
  const fy = a.y;
  setPos(state.floor, a, x, y);
  emit(state, { t: 'move', id: a.id, fx, fy, tx: x, ty: y, how: 'blink' });
  onEnterTile(state, a);
}

// ---------------------------------------------------------------------------
// Noise

/** Wakes and alerts monsters within `radius` of (x, y). */
export function makeNoise(state: GameState, x: number, y: number, radius: number, byPlayer: boolean): void {
  if (state.preview) return;
  let r = radius;
  if (byPlayer) r *= relicMods(state).noise;
  if (r <= 0) return;
  const r2 = r * r;
  for (const m of state.floor.actors) {
    if (m.dead || !m.ai || isPlayer(state, m)) continue;
    const dx = m.x - x;
    const dy = m.y - y;
    if (dx * dx + dy * dy > r2) continue;
    if (m.ai.mode === 'asleep' || m.ai.mode === 'wander') {
      m.ai.mode = 'search';
      m.ai.lastX = x;
      m.ai.lastY = y;
      m.ai.lastSeenTurn = state.turn;
    } else if (m.ai.mode === 'search') {
      m.ai.lastX = x;
      m.ai.lastY = y;
    }
  }
}

// ---------------------------------------------------------------------------
// Gas helper used by several effects

export function burstGas(state: GameState, cx: number, cy: number, element: 'poison' | 'smoke' | 'steam', amount: number, radius: number): void {
  const f = state.floor;
  const gas = element === 'poison' ? 3 : element === 'smoke' ? 2 : 1;
  const tiles: number[] = [];
  const ri = Math.ceil(radius);
  for (let y = cy - ri; y <= cy + ri; y++) {
    for (let x = cx - ri; x <= cx + ri; x++) {
      if (!inBounds(f, x, y)) continue;
      if ((x - cx) ** 2 + (y - cy) ** 2 > radius * radius + 0.01) continue;
      const i = idx(f, x, y);
      if (TERRAIN[f.terrain[i] as number]?.solid) continue;
      if ((f.gas[i] as number) !== gas) {
        f.gas[i] = gas;
        f.gasAmt[i] = 0;
      }
      f.gasAmt[i] = Math.min(255, (f.gasAmt[i] as number) + amount);
      tiles.push(i);
    }
  }
  emit(state, { t: 'fx', tiles, kind: element === 'poison' ? 'poison' : element });
}

/** Restores the player's breath to maximum. */
export function refillBreath(state: GameState, a: Actor): void {
  if (isPlayer(state, a)) a.breath = playerMaxBreath(state);
}
