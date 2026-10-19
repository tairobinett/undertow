// State accessors, derived stats and logging. Everything here is a pure function of state.

import { MONSTERS, monsterDef } from '../content/monsters.ts';
import type { MonsterDef } from '../content/monsters.ts';
import { RELICS } from '../content/relics.ts';
import type { RelicMods } from '../content/relics.ts';
import { WEAPONS } from '../content/weapons.ts';
import type { WeaponDef } from '../content/weapons.ts';
import { dijkstraMap, stepDownhill, UNREACHABLE } from './dijkstra.ts';
import { isDeep, isWater } from './floor.ts';
import { TERRAIN } from './terrain.ts';
import type { Actor, DamageType, FloorState, GameEvent, GameState, StatusId, StatusInst, Tone } from './types.ts';

export const PLAYER_BASE_HP = 30;
export const PLAYER_BASE_BREATH = 6;
export const MONSTER_BREATH = 4;
export const LOG_CAP = 250;

export function player(state: GameState): Actor {
  const p = state.floor.actors.find((a) => a.id === state.playerId);
  if (!p) throw new Error('player actor missing');
  return p;
}

export function isPlayer(state: GameState, a: Actor | undefined): boolean {
  return !!a && a.id === state.playerId;
}

export function mdef(a: Actor): MonsterDef | undefined {
  if (a.def === 'player') return undefined;
  return MONSTERS[a.def];
}

export function defOf(a: Actor): MonsterDef {
  return monsterDef(a.def);
}

// ---------------------------------------------------------------------------
// Logging and events

export function log(state: GameState, text: string, tone: Tone = 'info'): void {
  if (state.preview) return;
  // Identical messages merge ("×2"): within a turn always, across turns only if they carry no
  // numbers — a hit on each of two turns must never read like a double hit, but "You slide
  // across the ice" thirteen times is just noise.
  const last = state.log[state.log.length - 1];
  if (last && last.text === text && (last.turn === state.turn || (!/\d/.test(text) && last.turn >= state.turn - 1))) {
    last.n = (last.n ?? 1) + 1;
    last.turn = state.turn;
    return;
  }
  state.log.push({ turn: state.turn, text, tone });
  if (state.log.length > LOG_CAP) state.log.splice(0, state.log.length - LOG_CAP);
}

export function emit(state: GameState, ev: GameEvent): void {
  state.events.push(ev);
}

export function chronicle(state: GameState, text: string): void {
  if (state.preview) return;
  state.chronicle.push({ turn: state.turn, floor: state.floor.index, text });
}

// ---------------------------------------------------------------------------
// Names

export function nameOf(state: GameState, a: Actor): string {
  if (isPlayer(state, a)) return 'you';
  const d = MONSTERS[a.def];
  if (!d) return 'something';
  return d.boss ? d.name : `the ${d.name.toLowerCase()}`;
}

export function capName(state: GameState, a: Actor): string {
  const n = nameOf(state, a);
  return n.charAt(0).toUpperCase() + n.slice(1);
}

/** Picks "you <verb>" vs "the X <verbs>". */
export function verb(state: GameState, a: Actor, youForm: string, theyForm: string): string {
  return isPlayer(state, a) ? youForm : theyForm;
}

// ---------------------------------------------------------------------------
// Statuses

export function hasStatus(a: Actor, id: StatusId): boolean {
  return a.statuses.some((s) => s.id === id && s.turns > 0);
}

export function getStatus(a: Actor, id: StatusId): StatusInst | undefined {
  return a.statuses.find((s) => s.id === id && s.turns > 0);
}

export function removeStatus(a: Actor, id: StatusId): boolean {
  const before = a.statuses.length;
  a.statuses = a.statuses.filter((s) => s.id !== id);
  return a.statuses.length !== before;
}

// ---------------------------------------------------------------------------
// Relics and player build

export function relicMods(state: GameState): Required<Pick<RelicMods, 'maxHp' | 'armor' | 'breath' | 'lantern' | 'damage' | 'tideMult' | 'pearlMult' | 'abilityCharges' | 'abilityDamage' | 'noise'>> & {
  resist: Partial<Record<DamageType, number>>;
  immune: StatusId[];
  stealthRange: number;
} {
  const out = {
    maxHp: 0,
    armor: 0,
    breath: 0,
    lantern: 0,
    damage: 0,
    tideMult: 1,
    pearlMult: 1,
    abilityCharges: 0,
    abilityDamage: 0,
    noise: 1,
    resist: {} as Partial<Record<DamageType, number>>,
    immune: [] as StatusId[],
    stealthRange: 0,
  };
  for (const key of state.build.relics) {
    const m = RELICS[key]?.mods;
    if (!m) continue;
    out.maxHp += m.maxHp ?? 0;
    out.armor += m.armor ?? 0;
    out.breath += m.breath ?? 0;
    out.lantern += m.lantern ?? 0;
    out.damage += m.damage ?? 0;
    out.tideMult *= m.tideMult ?? 1;
    out.pearlMult *= m.pearlMult ?? 1;
    out.abilityCharges += m.abilityCharges ?? 0;
    out.abilityDamage += m.abilityDamage ?? 0;
    out.noise *= m.noise ?? 1;
    if (m.resist) {
      for (const [k, v] of Object.entries(m.resist)) {
        const dt = k as DamageType;
        out.resist[dt] = (out.resist[dt] ?? 1) * (v as number);
      }
    }
    if (m.immune) out.immune.push(...m.immune);
    if (m.stealthRange) out.stealthRange = out.stealthRange ? Math.min(out.stealthRange, m.stealthRange) : m.stealthRange;
  }
  return out;
}

export function hasHook(state: GameState, hook: string): boolean {
  for (const key of state.build.relics) if (RELICS[key]?.hooks?.includes(hook)) return true;
  return false;
}

export function weaponDef(state: GameState): WeaponDef {
  const w = WEAPONS[state.build.weapon.def];
  if (!w) throw new Error(`unknown weapon ${state.build.weapon.def}`);
  return w;
}

export function upgradeCount(state: GameState, key: string): number {
  return state.build.weapon.upgrades.filter((u) => u === key).length;
}

export function hasUpgrade(state: GameState, key: string): boolean {
  return state.build.weapon.upgrades.includes(key);
}

export function playerMaxHp(state: GameState): number {
  return Math.max(5, PLAYER_BASE_HP + state.build.maxHpBonus + relicMods(state).maxHp);
}

export function playerMaxBreath(state: GameState): number {
  return Math.max(1, state.build.maxBreath + relicMods(state).breath);
}

export function playerLantern(state: GameState): number {
  const gloom = state.floor?.mods.includes('gloom') ? 2 : 0;
  return Math.max(1, state.build.lantern + relicMods(state).lantern - gloom);
}

/** Base weapon damage before situational modifiers. */
export function playerBaseDamage(state: GameState): number {
  return weaponDef(state).dmg + upgradeCount(state, 'honed') + state.build.bonusDamage + relicMods(state).damage;
}

export function abilityMaxCharges(state: GameState, base: number): number {
  let n = base + relicMods(state).abilityCharges;
  if (state.build.weapon.def === 'staff') n += 1 + upgradeCount(state, 'staff_well');
  return n;
}

// ---------------------------------------------------------------------------
// Derived actor stats (same rules for monsters and the player where possible)

export function armorOf(state: GameState, a: Actor): number {
  let armor = 0;
  if (isPlayer(state, a)) armor = state.build.armor + relicMods(state).armor;
  else armor = mdef(a)?.armor ?? 0;
  const sh = getStatus(a, 'shielded');
  if (sh) armor += sh.power ?? 3;
  return armor;
}

export function resistOf(state: GameState, a: Actor, dt: DamageType): number {
  if (dt === 'pure' || dt === 'drown') return 1;
  if (isPlayer(state, a)) return relicMods(state).resist[dt] ?? 1;
  return mdef(a)?.resist?.[dt] ?? 1;
}

export function isImmuneToStatus(state: GameState, a: Actor, id: StatusId): boolean {
  if (isPlayer(state, a)) {
    const mods = relicMods(state);
    if (mods.immune.includes(id)) return true;
    if (id === 'burning' && (mods.resist.fire ?? 1) === 0) return true;
    if ((id === 'chilled' || id === 'frozen') && (mods.resist.cold ?? 1) === 0) return true;
    return false;
  }
  const d = mdef(a);
  if (!d) return false;
  if (id === 'poisoned' && (d.resist?.poison ?? 1) === 0) return true;
  if (id === 'poisoned' && (d.tags.includes('undead') || d.tags.includes('construct'))) return true;
  if (id === 'burning' && (d.resist?.fire ?? 1) === 0) return true;
  if ((id === 'chilled' || id === 'frozen') && (d.resist?.cold ?? 1) === 0) return true;
  if (d.boss && (id === 'rooted' || id === 'frozen' || id === 'stunned' || id === 'charmed')) return true;
  if (id === 'rooted' && d.tags.includes('rooted')) return true;
  return false;
}

export function moveModeOf(a: Actor): 'walk' | 'swim' | 'amphibious' | 'fly' | 'phase' {
  if (a.def === 'player') return 'walk';
  return mdef(a)?.move ?? 'walk';
}

/** Creatures that drown in deep water. */
export function breathes(a: Actor): boolean {
  if (a.def === 'player') return true;
  const d = mdef(a);
  if (!d) return true;
  if (d.breathes === false) return false;
  return d.move === 'walk' || d.move === 'phase';
}

export function speedOf(state: GameState, a: Actor): number {
  let s = isPlayer(state, a) ? 100 : (mdef(a)?.speed ?? 100);
  if (isPlayer(state, a) && hasHook(state, 'riptide') && isWater(state.floor, a.y * state.floor.w + a.x)) s *= 2;
  if (hasStatus(a, 'hasted')) s *= 2;
  if (hasStatus(a, 'chilled') || hasStatus(a, 'slowed')) s = Math.floor(s / 2);
  return Math.max(25, s);
}

export function canAct(a: Actor): boolean {
  return !a.dead && !hasStatus(a, 'frozen') && !hasStatus(a, 'stunned');
}

export function inDeepWater(state: GameState, a: Actor): boolean {
  const f = state.floor;
  if (moveModeOf(a) === 'fly') return false;
  return isDeep(f, a.y * f.w + a.x);
}

export function inWater(state: GameState, a: Actor): boolean {
  const f = state.floor;
  if (moveModeOf(a) === 'fly') return false;
  return isWater(f, a.y * f.w + a.x);
}

/** What the fresh-air compass reads. */
export interface FreshAir {
  arrow: string;
  word: string;
  /** Steps along the air's route to the way up. */
  dist: number;
  /** Tiles of deep water on that route (0 when a dry way exists). */
  deep: number;
  /** The longest unbroken swim on that route (breath refills on any tile that isn't deep). */
  longestSwim: number;
}

/** Deep water costs this many dry steps when the air picks its route. */
const AIR_SWIM_COST = 8;

/**
 * "Fresh air" flows down from the way up (or the beacon) through open passages. It takes the
 * best walkable route, dry where it can be, across deep water only where it must, and the
 * compass shows which way that route heads over the next few steps. So following the air
 * leads somewhere even through unexplored ground, without revealing the map itself.
 */
/** How far the fresh air has to travel from the way up to each tile (the flow the compass follows). */
export function airFlow(state: GameState): Float64Array {
  const f = state.floor;
  const targets = f.features.filter((ft) => ft.kind === 'exit' || ft.kind === 'beacon');
  const cost = (i: number): number => {
    const td = TERRAIN[f.terrain[i] as number];
    if (!td?.walk) return Infinity;
    return isDeep(f, i) ? AIR_SWIM_COST : 1;
  };
  return dijkstraMap(f.w, f.h, targets.map((t) => t.y * f.w + t.x), cost);
}

/**
 * The walkable route from `start` to any goal whose longest unbroken swim is at most `maxSwim`
 * (breadth-first over tile + current swim length), or undefined if there is none.
 */
function routeWithin(f: FloorState, start: number, goals: Set<number>, maxSwim: number): number[] | undefined {
  const n = f.w * f.h;
  const R = maxSwim + 1;
  const parent = new Int32Array(n * R).fill(-2);
  const run0 = isDeep(f, start) ? 1 : 0;
  if (run0 > maxSwim) return undefined;
  const s0 = start * R + run0;
  parent[s0] = -1;
  const queue = [s0];
  for (let head = 0; head < queue.length; head++) {
    const st = queue[head] as number;
    const i = Math.floor(st / R);
    const run = st - i * R;
    if (goals.has(i)) {
      const path: number[] = [];
      for (let c = st; c >= 0; c = parent[c] as number) path.push(Math.floor(c / R));
      return path.reverse();
    }
    const x = i % f.w;
    const y = (i - x) / f.w;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= f.w || ny >= f.h) continue;
        const j = ny * f.w + nx;
        if (!TERRAIN[f.terrain[j] as number]?.walk) continue;
        const nrun = isDeep(f, j) ? run + 1 : 0;
        if (nrun > maxSwim) continue;
        const ns = j * R + nrun;
        if (parent[ns] !== -2) continue;
        parent[ns] = st;
        queue.push(ns);
      }
    }
  }
  return undefined;
}

/**
 * The route the fresh air takes from you to the way up (or the beacon): the walkable way with
 * the shortest longest-swim, then the shortest such way. Includes your tile. Undefined if none.
 */
export function freshAirRoute(state: GameState): number[] | undefined {
  const f = state.floor;
  const p = player(state);
  const targets = f.features.filter((ft) => ft.kind === 'exit' || ft.kind === 'beacon');
  if (!targets.length) return undefined;
  const here = p.y * f.w + p.x;
  const goals = new Set(targets.map((t) => t.y * f.w + t.x));
  const CAP = 40;
  let route = routeWithin(f, here, goals, CAP);
  if (!route) return undefined;
  let lo = 0;
  let hi = CAP;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const r = routeWithin(f, here, goals, mid);
    if (r) {
      hi = mid;
      route = r;
    } else lo = mid + 1;
  }
  return route;
}

export function freshAir(state: GameState): FreshAir | undefined {
  const f = state.floor;
  const p = player(state);
  const targets = f.features.filter((ft) => ft.kind === 'exit' || ft.kind === 'beacon');
  if (!targets.length) return undefined;
  if (targets.some((t) => t.x === p.x && t.y === p.y)) return { arrow: '•', word: 'here', dist: 0, deep: 0, longestSwim: 0 };
  // The air takes the way with the shortest longest-swim (then the shortest such way).
  const route = freshAirRoute(state);
  let aimX = p.x;
  let aimY = p.y;
  let steps = 0;
  let deep = 0;
  let longestSwim = 0;
  if (!route) {
    // No walkable route at all (shouldn't happen): point straight at the nearest one.
    const t = [...targets].sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0] as { x: number; y: number };
    aimX = t.x;
    aimY = t.y;
    steps = Math.round(Math.hypot(t.x - p.x, t.y - p.y));
  } else {
    let run = 0;
    for (const i of route) {
      if (isDeep(f, i)) {
        deep++;
        longestSwim = Math.max(longestSwim, ++run);
      } else run = 0;
    }
    steps = route.length - 1;
    const aim = route[Math.min(5, route.length - 1)] as number;
    aimX = aim % f.w;
    aimY = (aim - aimX) / f.w;
  }
  const ang = Math.atan2(aimY - p.y, aimX - p.x);
  const sector = ((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8;
  const arrows = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'];
  const words = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
  return { arrow: arrows[sector] as string, word: words[sector] as string, dist: steps, deep, longestSwim };
}

/**
 * While swimming: the nearest place to breathe (any walkable tile that isn't deep water), as a
 * heading and a swim length. Undefined when you're not in deep water.
 */
/** Swim distance from every tile to the nearest breathable one (walkable and not deep). */
export function breathMap(state: GameState): Float64Array {
  const f = state.floor;
  const air: number[] = [];
  for (let i = 0; i < f.w * f.h; i++) if (TERRAIN[f.terrain[i] as number]?.walk && !isDeep(f, i)) air.push(i);
  return dijkstraMap(f.w, f.h, air, (i) => (TERRAIN[f.terrain[i] as number]?.walk ? 1 : Infinity), 60);
}

export function nearestAir(state: GameState): { arrow: string; word: string; dist: number } | undefined {
  const f = state.floor;
  const p = player(state);
  const here = p.y * f.w + p.x;
  if (!isDeep(f, here)) return undefined;
  const dist = breathMap(state);
  const d = dist[here] as number;
  if (d >= UNREACHABLE) return undefined;
  let cur = here;
  for (let k = 0; k < d; k++) {
    const next = stepDownhill(f.w, f.h, dist, cur, () => true);
    if (next < 0) break;
    cur = next;
  }
  const ax = cur % f.w;
  const ay = (cur - ax) / f.w;
  const sector = ((Math.round(Math.atan2(ay - p.y, ax - p.x) / (Math.PI / 4)) % 8) + 8) % 8;
  const arrows = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'];
  const words = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
  return { arrow: arrows[sector] as string, word: words[sector] as string, dist: d };
}

export function enemies(state: GameState, a: Actor, b: Actor): boolean {
  const ta = hasStatus(a, 'charmed') ? (a.team === 'player' ? 'monster' : 'player') : a.team;
  const tb = hasStatus(b, 'charmed') ? (b.team === 'player' ? 'monster' : 'player') : b.team;
  return ta !== tb;
}
