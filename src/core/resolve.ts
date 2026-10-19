// Shape resolution and effect application, shared by player abilities, thrown items and
// monster abilities. The same function drives telegraphs, previews and resolution.

import type { EffectSpec, Shape } from '../content/spec.ts';
import { MONSTERS } from '../content/monsters.ts';
import { CONSUMABLES } from '../content/consumables.ts';
import { cone as coneTiles, disc, line, ray } from './geom.ts';
import { actorAt, blocksShot, canStand, idx, inBounds, isWater, nearestTile } from './floor.ts';
import {
  addStatus, cleanse, dealDamage, heal, kill, makeNoise, pullToward, push, refillBreath, seen, teleport,
} from './effects.ts';
import type { DmgSource } from './effects.ts';
import { applyElement } from './elements.ts';
import type { ElementCtx } from './elements.ts';
import { capName, emit, enemies, isPlayer, log, nameOf } from './state.ts';
import { TERRAIN } from './terrain.ts';
import type { Actor, AIMode, FloorState, FxKind, GameState } from './types.ts';
import { int } from './rng.ts';
import type { RngState } from './rng.ts';

export interface ShapeResult {
  /** Tiles the effect lands on. */
  tiles: number[];
  /** Where a projectile stops (bolt/ray) or the centre of a lob. */
  impact?: { x: number; y: number };
  /** Full telegraph path for rays/beams (ignores creatures). */
  path?: number[];
  /** Direction used for pushes (wave/cone). */
  dir?: { x: number; y: number };
}

function solid(state: GameState, i: number): boolean {
  return TERRAIN[state.floor.terrain[i] as number]?.solid ?? true;
}

/** Areas reach open tiles, and a creature inside the rock (a wraith passing through a wall). */
function reaches(state: GameState, i: number): boolean {
  const f = state.floor;
  return !solid(state, i) || !!actorAt(f, i % f.w, Math.floor(i / f.w));
}

/** A creature standing in a tile that stops a shot (inside a wall): the shot still finds it. */
function lodged(state: GameState, i: number, user: Actor): boolean {
  const f = state.floor;
  const a = actorAt(f, i % f.w, Math.floor(i / f.w));
  return !!a && a.id !== user.id && !a.submerged;
}

/**
 * Resolves a shape from the user toward (tx, ty).
 * `forTelegraph`: rays extend through creatures (the shot hits whatever is in the line
 * when it resolves), so the whole lane is shown.
 */
export function shapeTiles(state: GameState, user: Actor, shape: Shape, tx: number, ty: number, forTelegraph = false): ShapeResult {
  const f = state.floor;
  const ux = user.x;
  const uy = user.y;
  switch (shape.k) {
    case 'self':
      return { tiles: [idx(f, ux, uy)] };
    case 'melee':
      if (!inBounds(f, tx, ty)) return { tiles: [] };
      return { tiles: [idx(f, tx, ty)], impact: { x: tx, y: ty } };
    case 'bolt': {
      const pts = line(ux, uy, tx, ty).slice(1, shape.range + 1);
      let impact = { x: ux, y: uy };
      const path: number[] = [];
      for (const p of pts) {
        if (!inBounds(f, p.x, p.y)) break;
        const i = idx(f, p.x, p.y);
        if (blocksShot(f, i) && !lodged(state, i, user)) break;
        impact = p;
        path.push(i);
        const a = actorAt(f, p.x, p.y);
        if ((a && a.id !== user.id && !a.submerged) || blocksShot(f, i)) break;
      }
      if (impact.x === ux && impact.y === uy) return { tiles: [], path };
      const r = shape.radius ?? 0;
      const tiles = r > 0 ? disc(impact.x, impact.y, r).filter((p) => inBounds(f, p.x, p.y) && reaches(state, idx(f, p.x, p.y))).map((p) => idx(f, p.x, p.y)) : [idx(f, impact.x, impact.y)];
      return { tiles, impact, path };
    }
    case 'ray':
    case 'beam': {
      const pts = ray(ux, uy, tx, ty, shape.range);
      const path: number[] = [];
      let impact: { x: number; y: number } | undefined;
      const hits: number[] = [];
      for (const p of pts) {
        if (!inBounds(f, p.x, p.y)) break;
        const i = idx(f, p.x, p.y);
        const wall = blocksShot(f, i);
        if (wall && !lodged(state, i, user)) break;
        path.push(i);
        const a = actorAt(f, p.x, p.y);
        if (shape.k === 'beam') {
          hits.push(i);
        } else if (a && a.id !== user.id && !a.submerged && !impact) {
          impact = p;
          if (!forTelegraph) break;
        }
        if (wall) break;
      }
      if (shape.k === 'beam') return { tiles: hits, path };
      if (forTelegraph) return { tiles: path, path, ...(impact ? { impact } : {}) };
      if (!impact) {
        const last = path[path.length - 1];
        if (last === undefined) return { tiles: [], path };
        return { tiles: [], path, impact: { x: last % f.w, y: Math.floor(last / f.w) } };
      }
      return { tiles: [idx(f, impact.x, impact.y)], impact, path };
    }
    case 'cone': {
      const dir = { x: Math.sign(tx - ux), y: Math.sign(ty - uy) };
      if (dir.x === 0 && dir.y === 0) return { tiles: [] };
      const tiles: number[] = [];
      for (const p of coneTiles(ux, uy, dir, shape.range)) {
        if (!inBounds(f, p.x, p.y)) continue;
        const i = idx(f, p.x, p.y);
        if (!reaches(state, i)) continue;
        // Must have a clear straight line from the user.
        const ln = line(ux, uy, p.x, p.y).slice(1, -1);
        if (ln.some((q) => blocksShot(f, idx(f, q.x, q.y)))) continue;
        tiles.push(i);
      }
      return { tiles, dir };
    }
    case 'lob': {
      if (!inBounds(f, tx, ty)) return { tiles: [] };
      const tiles = disc(tx, ty, shape.radius)
        .filter((p) => inBounds(f, p.x, p.y) && reaches(state, idx(f, p.x, p.y)))
        .map((p) => idx(f, p.x, p.y));
      return { tiles, impact: { x: tx, y: ty } };
    }
    case 'burst': {
      const tiles = disc(ux, uy, shape.radius)
        .filter((p) => inBounds(f, p.x, p.y) && reaches(state, idx(f, p.x, p.y)))
        .filter((p) => shape.includeSelf || p.x !== ux || p.y !== uy)
        .filter((p) => !line(ux, uy, p.x, p.y).slice(1, -1).some((q) => blocksShot(f, idx(f, q.x, q.y))))
        .map((p) => idx(f, p.x, p.y));
      return { tiles, impact: { x: ux, y: uy } };
    }
    case 'wave': {
      const dir = { x: Math.sign(tx - ux), y: Math.sign(ty - uy) };
      if (dir.x === 0 && dir.y === 0) return { tiles: [] };
      const lanes: { x: number; y: number }[] = [];
      if (dir.x === 0 || dir.y === 0) {
        const perp = { x: dir.y, y: dir.x };
        lanes.push({ x: 0, y: 0 }, perp, { x: -perp.x, y: -perp.y });
      } else {
        lanes.push({ x: 0, y: 0 }, { x: -dir.x, y: 0 }, { x: 0, y: -dir.y });
      }
      const tiles: number[] = [];
      for (const lane of lanes) {
        for (let s = 1; s <= shape.length; s++) {
          const x = ux + dir.x * s + lane.x;
          const y = uy + dir.y * s + lane.y;
          if (x === ux && y === uy) continue;
          if (!inBounds(f, x, y)) break;
          const i = idx(f, x, y);
          if (solid(state, i)) {
            if (reaches(state, i) && !tiles.includes(i)) tiles.push(i);
            break;
          }
          if (!tiles.includes(i)) tiles.push(i);
        }
      }
      return { tiles, dir };
    }
    case 'tile': {
      if (!inBounds(f, tx, ty)) return { tiles: [] };
      return { tiles: [idx(f, tx, ty)], impact: { x: tx, y: ty } };
    }
  }
}

export interface ApplyOpts {
  name: string;
  verbs?: [string, string];
  cause: string;
  /** Extra damage added to the spec (e.g. relics). */
  bonus?: number;
  fx?: FxKind;
  noise?: number;
}

export interface ApplyResult {
  hit: Actor[];
  impact?: { x: number; y: number };
}

function fxForSpec(spec: EffectSpec): FxKind {
  if (spec.element === 'fire' || spec.dtype === 'fire') return 'fire';
  if (spec.element === 'cold' || spec.dtype === 'cold') return 'frost';
  if (spec.element === 'lightning' || spec.dtype === 'lightning') return 'shock';
  if (spec.element === 'water') return 'water';
  if (spec.element === 'oil') return 'oil';
  if (spec.element === 'smoke') return 'smoke';
  if (spec.element === 'poison') return 'poison';
  if (spec.heal) return 'heal';
  return 'hit';
}

/** Applies an effect spec over a resolved shape. */
export function applySpec(state: GameState, user: Actor, shape: Shape, spec: EffectSpec, tx: number, ty: number, opts: ApplyOpts): ApplyResult {
  const f = state.floor;
  const res = shapeTiles(state, user, shape, tx, ty);
  const fx = opts.fx ?? fxForSpec(spec);
  const src: DmgSource = { actor: user, name: isPlayer(state, user) ? 'you' : nameOf(state, user), cause: opts.cause };
  if (opts.verbs) src.verbs = opts.verbs;
  const hitActors: Actor[] = [];
  const hitIds = new Set<number>();

  // Visuals.
  if ((shape.k === 'bolt' || shape.k === 'ray') && res.impact) {
    emit(state, { t: 'shot', fx: user.x, fy: user.y, tx: res.impact.x, ty: res.impact.y, kind: fx });
  } else if (shape.k === 'lob' && res.impact) {
    emit(state, { t: 'shot', fx: user.x, fy: user.y, tx: res.impact.x, ty: res.impact.y, kind: fx });
  }
  if (res.tiles.length && shape.k !== 'self' && shape.k !== 'tile') emit(state, { t: 'fx', tiles: res.tiles, kind: fx });

  // Special pre-steps. A firepot splashes burning oil: the ground is oiled (so it keeps
  // burning, even on water), but creatures only take the listed fire damage up front.
  if (spec.special === 'firepot') {
    for (const i of res.tiles) applyElement(state, i, 'oil', 0, { src, hit: hitIds, tilesOnly: true });
  }

  // Creatures in the area.
  const dmg = (spec.dmg ?? 0) + (spec.dmg ? (opts.bonus ?? 0) : 0);
  const originX = shape.k === 'lob' || shape.k === 'bolt' ? (res.impact?.x ?? user.x) : user.x;
  const originY = shape.k === 'lob' || shape.k === 'bolt' ? (res.impact?.y ?? user.y) : user.y;
  const targets: Actor[] = [];
  for (const i of res.tiles) {
    const a = actorAt(f, i % f.w, Math.floor(i / f.w));
    if (!a || a.dead) continue;
    if (a.id === user.id && shape.k !== 'self' && !(shape.k === 'burst' && shape.includeSelf) && shape.k !== 'lob') continue;
    if (spec.selective && !enemies(state, user, a) && a.id !== user.id) continue;
    targets.push(a);
  }
  for (const a of targets) {
    if (a.dead) continue;
    hitActors.push(a);
    hitIds.add(a.id);
    if (dmg > 0 && spec.dtype) dealDamage(state, a, dmg, spec.dtype, src);
    if (a.dead) continue;
    if (spec.status) addStatus(state, a, spec.status.id, spec.status.turns, spec.status.power, user.id);
    if (spec.heal) heal(state, a, spec.heal);
    if (spec.cleanse) cleanse(state, a);
  }
  // Elements on tiles, before anything is shoved out of the area (a wave soaks what it moves).
  if (spec.element) {
    const ctx: ElementCtx = { src, hit: hitIds };
    if (dmg > 0) ctx.dmg = dmg;
    for (const i of res.tiles) {
      if (spec.element === 'lightning') {
        // Conduct once from the impact tile if it's water, otherwise from each water tile hit.
        continue;
      }
      applyElement(state, i, spec.element, spec.power ?? 40, ctx);
    }
    if (spec.element === 'lightning') {
      const waterTiles = res.tiles.filter((i) => isWater(f, i));
      for (const i of waterTiles) applyElement(state, i, 'lightning', spec.power ?? 4, ctx);
    }
  }

  // Forced movement after damage (so pushes into hazards apply).
  if (spec.push) {
    const ordered = [...targets].filter((a) => !a.dead && a.id !== user.id);
    // Push the farthest first so creatures don't block each other.
    ordered.sort((a, b) => Math.max(Math.abs(b.x - originX), Math.abs(b.y - originY)) - Math.max(Math.abs(a.x - originX), Math.abs(a.y - originY)));
    for (const a of ordered) {
      const d = res.dir ?? { x: Math.sign(a.x - originX), y: Math.sign(a.y - originY) };
      if (d.x === 0 && d.y === 0) continue;
      push(state, a, d.x, d.y, spec.push, src, 2);
    }
  }
  if (spec.pull) {
    for (const a of targets) {
      if (a.dead || a.id === user.id) continue;
      pullToward(state, a, user.x, user.y, spec.pull);
    }
  }

  // Specials.
  if (spec.special) runSpecial(state, user, spec.special, res, tx, ty);

  if (opts.noise) makeNoise(state, res.impact?.x ?? user.x, res.impact?.y ?? user.y, opts.noise, isPlayer(state, user));
  const out: ApplyResult = { hit: hitActors };
  if (res.impact) out.impact = res.impact;
  return out;
}

// ---------------------------------------------------------------------------
// Special effects

function runSpecial(state: GameState, user: Actor, special: string, res: ShapeResult, tx: number, ty: number): void {
  const f = state.floor;
  switch (special) {
    case 'blink': {
      const i = idx(f, tx, ty);
      if (!inBounds(f, tx, ty) || actorAt(f, tx, ty) || !canStand(f, i, 'walk')) return;
      teleport(state, user, tx, ty);
      if (isPlayer(state, user)) log(state, 'You step through the dark.', 'info');
      break;
    }
    case 'stillwater':
      f.tidePaused = Math.max(f.tidePaused, 12);
      log(state, 'The sea holds its breath. The tide will not rise for 12 turns.', 'good');
      break;
    case 'tide_glass':
      f.tidePaused = Math.max(f.tidePaused, 15);
      log(state, 'You turn the glass. The tide stills for 15 turns.', 'good');
      break;
    case 'refill_breath':
      refillBreath(state, user);
      break;
    case 'self_destruct':
      if (!user.dead) kill(state, user, { actor: user, name: nameOf(state, user), cause: 'burst' });
      break;
    case 'raise_drowned':
      raiseDrowned(state, user);
      break;
    case 'snatch':
      snatch(state, user, tx, ty);
      break;
    case 'song':
      break;
    case 'call_deep':
      callDeep(state, user);
      break;
    case 'firepot':
      break;
    default:
      break;
  }
}

/** The Abbot raises drowned monks from water tiles near him. */
function raiseDrowned(state: GameState, user: Actor): void {
  const f = state.floor;
  const spots: number[] = [];
  for (let dy = -6; dy <= 6; dy++) {
    for (let dx = -6; dx <= 6; dx++) {
      const x = user.x + dx;
      const y = user.y + dy;
      if (!inBounds(f, x, y)) continue;
      const i = idx(f, x, y);
      if (isWater(f, i) && !actorAt(f, x, y) && canStand(f, i, 'walk')) spots.push(i);
    }
  }
  const living = f.actors.filter((a) => !a.dead && a.summoner === user.id).length;
  const perCast = (user.ai?.phase ?? 0) >= 1 ? 2 : 1;
  const cap = (user.ai?.phase ?? 0) >= 1 ? 3 : 2;
  const n = Math.min(perCast, spots.length, Math.max(0, cap - living));
  if (n <= 0) {
    if (seen(state, user)) log(state, `${capName(state, user)} calls to the water, but nothing answers.`, 'good');
    return;
  }
  for (let k = 0; k < n; k++) {
    const pickI = int(state.rng, spots.length);
    const i = spots.splice(pickI, 1)[0] as number;
    const m = spawnMonster(state, 'faithful', i % f.w, Math.floor(i / f.w));
    if (m) {
      m.summoner = user.id;
      if (m.ai) m.ai.mode = 'hunt';
    }
  }
  if (seen(state, user)) log(state, n > 1 ? 'The drowned faithful rise from the water at the Abbot\'s call!' : 'One of the drowned faithful rises from the water at the Abbot\'s call!', 'warn');
}

/** The Leviathan calls morays into nearby water. */
function callDeep(state: GameState, user: Actor): void {
  const f = state.floor;
  const spots: number[] = [];
  for (let dy = -7; dy <= 7; dy++) {
    for (let dx = -7; dx <= 7; dx++) {
      const x = user.x + dx;
      const y = user.y + dy;
      if (!inBounds(f, x, y)) continue;
      const i = idx(f, x, y);
      if (isWater(f, i) && !actorAt(f, x, y)) spots.push(i);
    }
  }
  const living = f.actors.filter((a) => !a.dead && a.summoner === user.id).length;
  const n = Math.min(2, spots.length, Math.max(0, 4 - living));
  for (let k = 0; k < n; k++) {
    const i = spots.splice(int(state.rng, spots.length), 1)[0] as number;
    const m = spawnMonster(state, 'moray', i % f.w, Math.floor(i / f.w));
    if (m) {
      m.summoner = user.id;
      if (m.ai) m.ai.mode = 'hunt';
    }
  }
  if (n > 0) log(state, 'The sea churns — something answers the Leviathan\'s call.', 'warn');
}

/** The skua steals a belt item and flees. */
function snatch(state: GameState, user: Actor, tx: number, ty: number): void {
  const f = state.floor;
  const target = actorAt(f, tx, ty);
  if (!target || !isPlayer(state, target)) return;
  const slots = state.build.belt.map((s, i) => (s ? i : -1)).filter((i) => i >= 0);
  if (slots.length === 0) {
    log(state, `${capName(state, user)} finds nothing worth stealing.`, 'info');
    return;
  }
  const si = slots[int(state.rng, slots.length)] as number;
  const slot = state.build.belt[si];
  if (!slot) return;
  const keys = Object.keys(CONSUMABLES);
  if (!user.ai) return;
  user.ai.memo = user.ai.memo ?? {};
  user.ai.memo.stolen = keys.indexOf(slot.def);
  user.ai.memo.stolenCount = 1;
  slot.count -= 1;
  if (slot.count <= 0) state.build.belt[si] = null;
  user.ai.mode = 'flee';
  log(state, `${capName(state, user)} snatches your ${CONSUMABLES[slot.def]?.name ?? slot.def} and flaps away!`, 'bad');
}

// ---------------------------------------------------------------------------
// Spawning (used by procgen and summons)

export function spawnMonster(
  state: GameState,
  key: string,
  x: number,
  y: number,
  opts: { asleep?: boolean; rng?: RngState; mode?: AIMode; floor?: FloorState } = {},
): Actor | undefined {
  const f = opts.floor ?? state.floor;
  const rng = opts.rng ?? state.rng;
  const d = MONSTERS[key];
  if (!d) throw new Error(`unknown monster ${key}`);
  const i = nearestTile(f, x, y, (j) => {
    const px = j % f.w;
    const py = Math.floor(j / f.w);
    if (actorAt(f, px, py)) return false;
    if (d.move === 'swim') return canStand(f, j, 'swim');
    return canStand(f, j, d.move === 'phase' ? 'walk' : d.move);
  }, 6);
  if (i < 0) return undefined;
  const a: Actor = {
    id: state.nextId++,
    def: key,
    x: i % f.w,
    y: Math.floor(i / f.w),
    hp: d.hp,
    maxHp: d.hp,
    energy: 0,
    team: 'monster',
    statuses: [],
    breath: 4,
    ai: { mode: opts.asleep ? 'asleep' : (opts.mode ?? 'wander'), cd: {}, tie: int(rng, 8), homeX: i % f.w, homeY: Math.floor(i / f.w) },
  };
  if (d.submerge) a.submerged = true;
  f.actors.push(a);
  f.occ[i] = a.id;
  return a;
}

/** Used by spells that need a straight-line target check. */
export function straightPathClear(state: GameState, ax: number, ay: number, bx: number, by: number): boolean {
  const f = state.floor;
  const pts = line(ax, ay, bx, by).slice(1, -1);
  return pts.every((p) => !blocksShot(f, idx(f, p.x, p.y)) && !actorAt(f, p.x, p.y));
}
