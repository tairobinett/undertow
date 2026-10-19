// Headless auto-players for fuzzing and balance statistics.
// - heuristicCommand: plays like a careful but unimaginative human: dodges telegraphs, uses
//   items and abilities, avoids deep water, grabs nearby loot, heads for the way up.
// - chaosCommand: random commands to exercise as many code paths as possible.

import { ABILITIES } from '../content/abilities.ts';
import { CONSUMABLES } from '../content/consumables.ts';
import { chebyshev, DIRS8 } from '../core/geom.ts';
import { dijkstraMap, stepDownhill, UNREACHABLE } from '../core/dijkstra.ts';
import { actorAt, idx, inBounds, isDeep, itemAt } from '../core/floor.ts';
import { newGame, submit } from '../core/game.ts';
import { describeBoon } from '../core/progression.ts';
import { float, int, seedRng } from '../core/rng.ts';
import type { RngState } from '../core/rng.ts';
import { airFlow, breathMap, enemies, player } from '../core/state.ts';
import { TERRAIN } from '../core/terrain.ts';
import type { Actor, Command, GameState } from '../core/types.ts';

export interface BotResult {
  seed: number;
  status: GameState['status'];
  floor: number;
  turn: number;
  cause?: string;
  kills: number;
  commands: number;
  floorTurns: number[];
  hpOnArrival: number[];
  error?: string;
}

function dangerTiles(state: GameState): Set<number> {
  const s = new Set<number>();
  for (const a of state.floor.actors) {
    if (a.dead || !a.ai?.intent) continue;
    for (const t of a.ai.intent.tiles) s.add(t);
  }
  return s;
}

function visibleEnemies(state: GameState): Actor[] {
  const f = state.floor;
  const p = player(state);
  return f.actors.filter((a) => !a.dead && !a.submerged && enemies(state, p, a) && f.vis[idx(f, a.x, a.y)] === 1);
}

function safeStep(state: GameState, danger: Set<number>): Command | undefined {
  const f = state.floor;
  const p = player(state);
  let best: { d: { x: number; y: number }; score: number } | undefined;
  for (const d of DIRS8) {
    const x = p.x + d.x;
    const y = p.y + d.y;
    if (!inBounds(f, x, y)) continue;
    const j = idx(f, x, y);
    if (danger.has(j) || !TERRAIN[f.terrain[j] as number]?.walk || actorAt(f, x, y) || isDeep(f, j) || (f.fire[j] as number) > 0) continue;
    // Prefer tiles with fewer adjacent enemies.
    let score = 0;
    for (const e of visibleEnemies(state)) if (chebyshev(e.x, e.y, x, y) <= 1) score -= 1;
    if (!best || score > best.score) best = { d, score };
  }
  return best ? { t: 'move', dx: best.d.x, dy: best.d.y } : undefined;
}

export function chooseBoon(state: GameState): number {
  const opts = state.pending?.options ?? [];
  const p = player(state);
  let bestI = 0;
  let bestScore = -1;
  opts.forEach((id, i) => {
    const v = describeBoon(state, id);
    let score = 1;
    if (id === 'mend') score = p.hp < p.maxHp * 0.6 ? 10 : 0.5;
    else if (id === 'vigor') score = 6;
    else if (id.startsWith('up:')) score = 5;
    else if (id.startsWith('learn:')) score = 4.5;
    else if (id.startsWith('charge:')) score = 3;
    else if (v.group === 'vital') score = 3;
    if (score > bestScore) {
      bestScore = score;
      bestI = i;
    }
  });
  return bestI;
}

/** A careful bot. */
export interface BotOpts {
  /** Knows the map layout and exit positions (a good navigator). */
  knowMap?: boolean;
}

export function heuristicCommand(state: GameState, rng: RngState, opts: BotOpts = {}): Command {
  const f = state.floor;
  const p = player(state);
  if (state.pending) {
    if (state.pending.kind === 'weapon') return { t: 'choose', index: int(rng, state.pending.options.length) };
    return { t: 'choose', index: chooseBoon(state) };
  }
  const pi = idx(f, p.x, p.y);
  const danger = dangerTiles(state);
  const foes = visibleEnemies(state);
  const adjacentFoes = foes.filter((a) => chebyshev(a.x, a.y, p.x, p.y) === 1);

  // Drowning: drink an air bladder or head for the nearest breathable tile.
  if (isDeep(f, pi) && p.breath <= 2) {
    const slot = state.build.belt.findIndex((b) => b?.def === 'air_bladder');
    if (slot >= 0 && p.breath <= 1) return { t: 'use', slot };
    // Follow "Nearest air", as the sidebar shows a player.
    const d = breathMap(state);
    const next = stepDownhill(f.w, f.h, d, pi, (j) => !actorAt(f, j % f.w, Math.floor(j / f.w)));
    if (next >= 0) return { t: 'move', dx: (next % f.w) - p.x, dy: Math.floor(next / f.w) - p.y };
  }
  const here = f.features.find((x) => x.kind === 'exit' && x.x === p.x && x.y === p.y);
  if (here && (foes.length === 0 || p.hp < p.maxHp * 0.5 || f.tideTimer < 5)) return { t: 'ascend' };

  // Step out of telegraphed tiles and flames first.
  if (danger.has(pi) || (f.fire[pi] as number) > 0) {
    const step = safeStep(state, danger);
    if (step) return step;
  }
  // Heal when low.
  if (p.hp < p.maxHp * 0.4) {
    const slot = state.build.belt.findIndex((b) => b && (b.def === 'draught' || b.def === 'tonic'));
    if (slot >= 0) return { t: 'use', slot };
    const sw = state.build.abilities.findIndex((a) => a.def === 'second_wind' && a.charges > 0);
    if (sw >= 0) return { t: 'ability', slot: sw };
  }
  // Burning: find water.
  if (p.statuses.some((s) => s.id === 'burning')) {
    for (const d of DIRS8) {
      const x = p.x + d.x;
      const y = p.y + d.y;
      if (!inBounds(f, x, y) || actorAt(f, x, y)) continue;
      const j = idx(f, x, y);
      const depth = f.waterLevel - (f.elev[j] as number);
      if (TERRAIN[f.terrain[j] as number]?.walk && depth >= 1 && !isDeep(f, j)) return { t: 'move', dx: d.x, dy: d.y };
    }
  }

  // Hurt and the way up is close: run for it (bosses guard stairs; running is a legitimate out).
  if (foes.length > 0 && p.hp < p.maxHp * 0.5) {
    const exits = f.features.filter((x) => x.kind === 'exit' && f.seen[idx(f, x.x, x.y)]);
    if (exits.length) {
      const d = dijkstraMap(f.w, f.h, exits.map((x) => idx(f, x.x, x.y)), (i) => (TERRAIN[f.terrain[i] as number]?.walk ? (isDeep(f, i) ? 6 : 1) : Infinity), 14);
      if ((d[pi] as number) <= 10) {
        const next = stepDownhill(f.w, f.h, d, pi, (j) => !actorAt(f, j % f.w, Math.floor(j / f.w)));
        if (next >= 0) return { t: 'move', dx: (next % f.w) - p.x, dy: Math.floor(next / f.w) - p.y };
      }
    }
  }

  // Offensive abilities and throwables against strong or grouped foes.
  if (foes.length > 0) {
    const target = [...foes].sort((a, b) => chebyshev(a.x, a.y, p.x, p.y) - chebyshev(b.x, b.y, p.x, p.y))[0] as Actor;
    const dist = chebyshev(target.x, target.y, p.x, p.y);
    const threat = foes.length >= 2 || target.maxHp >= 12;
    if (threat && float(rng) < 0.5) {
      const ab = state.build.abilities.findIndex((a) => a.charges > 0 && ABILITIES[a.def]?.effect.dmg && ABILITIES[a.def]?.shape.k !== 'self');
      if (ab >= 0) {
        const d = ABILITIES[state.build.abilities[ab]!.def]!;
        const range = d.shape.k === 'burst' ? 1 : 'range' in d.shape ? d.shape.range : d.shape.k === 'wave' ? d.shape.length : 1;
        if (dist <= range) return { t: 'ability', slot: ab, x: target.x, y: target.y };
      }
      const th = state.build.belt.findIndex((b) => b && CONSUMABLES[b.def]?.use === 'throw' && CONSUMABLES[b.def]?.effect.dmg);
      if (th >= 0 && dist >= 2 && dist <= 6) return { t: 'use', slot: th, x: target.x, y: target.y };
    }
    // Fight adjacent foes (prefer ones with intents).
    if (adjacentFoes.length > 0) {
      const t = adjacentFoes.find((a) => a.ai?.intent) ?? adjacentFoes[0] as Actor;
      return { t: 'move', dx: t.x - p.x, dy: t.y - p.y };
    }
  }

  // Beacon.
  const beacon = f.features.find((x) => x.kind === 'beacon');
  if (beacon && chebyshev(beacon.x, beacon.y, p.x, p.y) <= 1) return { t: 'interact' };

  // Pick up what we're standing on.
  const it = itemAt(f, p.x, p.y);
  if (it && it.item.kind !== 'pearls') {
    if (it.price === undefined || state.build.pearls >= it.price) {
      if (it.item.kind === 'relic') return { t: 'pickup', replace: 0 };
      if (it.item.kind === 'consumable') return { t: 'pickup', replace: int(rng, state.build.belt.length) };
    }
  }
  const spring = f.features.find((x) => x.kind === 'spring' && !x.used && x.x === p.x && x.y === p.y);
  if (spring && p.hp < p.maxHp) return { t: 'pickup' };

  // Goals: nearby loot while the tide allows, otherwise the way up (once found), otherwise explore.
  const goals: number[] = [];
  let exits = f.features.filter((x) => (x.kind === 'exit' || x.kind === 'beacon') && (opts.knowMap || f.seen[idx(f, x.x, x.y)])).map((x) => idx(f, x.x, x.y));
  if (exits.length === 0) {
    // Follow the fresh air: prefer reachable frontier tiles toward the way up.
    const reach = dijkstraMap(f.w, f.h, [pi], (i) => (TERRAIN[f.terrain[i] as number]?.walk && f.seen[i] ? (isDeep(f, i) ? 12 : 1) : Infinity));
    const fr = frontier(state).filter((i) => (reach[i] as number) < 12 * Math.max(2, p.breath) + 60);
    // Follow the fresh air (as a player reading the compass would), and prefer high ground.
    const flow = airFlow(state);
    const score = (i: number): number => (flow[i] as number) - (f.elev[i] as number) * 2.5;
    const best = Math.min(...fr.map(score));
    exits = fr.filter((i) => score(i) <= best + 5);
  }
  const myGround = f.elev[pi] as number;
  const timePressure = f.waterLevel >= myGround - 2 || f.waterLevel >= 4 || state.turn - f.turnArrived > 140;
  if (!timePressure) {
    for (const item of f.items) {
      if ((!opts.knowMap && !f.seen[idx(f, item.x, item.y)]) || isDeep(f, idx(f, item.x, item.y))) continue;
      if (item.price !== undefined && state.build.pearls < item.price) continue;
      // Relic vaults are worth a detour; other loot only if it's close.
      if (chebyshev(item.x, item.y, p.x, p.y) > 12 && !(item.vault !== undefined && state.build.relics.length < state.build.relicSlots)) continue;
      if (item.item.kind === 'consumable' && state.build.belt.every((b) => b && (b.def !== item.item.def || b.count >= 3))) continue;
      goals.push(idx(f, item.x, item.y));
    }
    for (const sp of f.features) if (sp.kind === 'spring' && !sp.used && p.hp < p.maxHp * 0.8 && f.seen[idx(f, sp.x, sp.y)]) goals.push(idx(f, sp.x, sp.y));
  }
  const targetGoals = goals.length ? goals : exits;
  if (targetGoals.length === 0) return { t: 'wait' };
  const dist = dijkstraMap(f.w, f.h, targetGoals, (i) => {
    const t = TERRAIN[f.terrain[i] as number];
    if (!t?.walk || (!opts.knowMap && !f.seen[i])) return Infinity;
    let c = 1;
    if (isDeep(f, i)) c += 11;
    if (danger.has(i)) c += 20;
    if ((f.fire[i] as number) > 0) c += 30;
    return c;
  });
  if ((dist[pi] as number) >= UNREACHABLE) return goals.length ? { t: 'wait' } : { t: 'wait' };
  const next = stepDownhill(f.w, f.h, dist, pi, (j) => {
    const a = actorAt(f, j % f.w, Math.floor(j / f.w));
    return !a || (enemies(state, p, a) && !a.submerged);
  });
  if (next < 0) return { t: 'wait' };
  return { t: 'move', dx: (next % f.w) - p.x, dy: Math.floor(next / f.w) - p.y };
}

/** Known walkable tiles next to unexplored ones. */
function frontier(state: GameState): number[] {
  const f = state.floor;
  const out: number[] = [];
  for (let i = 0; i < f.w * f.h; i++) {
    if (!f.seen[i] || !TERRAIN[f.terrain[i] as number]?.walk || isDeep(f, i)) continue;
    const x = i % f.w;
    const y = (i - x) / f.w;
    let edge = false;
    for (const d of DIRS8) {
      const nx = x + d.x;
      const ny = y + d.y;
      if (inBounds(f, nx, ny) && !f.seen[ny * f.w + nx]) {
        edge = true;
        break;
      }
    }
    if (edge) out.push(i);
  }
  return out;
}

/** Random commands (valid or not) to fuzz the engine. */
export function chaosCommand(state: GameState, rng: RngState): Command {
  const p = player(state);
  if (state.pending) return { t: 'choose', index: int(rng, 3) };
  const r = float(rng);
  const tx = p.x + int(rng, 13) - 6;
  const ty = p.y + int(rng, 13) - 6;
  if (r < 0.55) {
    const d = DIRS8[int(rng, 8)] as { x: number; y: number };
    return { t: 'move', dx: d.x, dy: d.y };
  }
  if (r < 0.62) return { t: 'wait' };
  if (r < 0.72) return { t: 'ability', slot: int(rng, 4), x: tx, y: ty };
  if (r < 0.8) return { t: 'use', slot: int(rng, 4), x: tx, y: ty };
  if (r < 0.84) return { t: 'pickup', replace: int(rng, 4) };
  if (r < 0.86) return { t: 'drop', slot: int(rng, 4) };
  if (r < 0.9) return { t: 'attack', x: tx, y: ty };
  if (r < 0.93) return { t: 'shrine', option: int(rng, 3) };
  if (r < 0.95) return { t: 'interact' };
  return { t: 'ascend' };
}

export function runBot(seed: number, kind: 'heuristic' | 'chaos', maxCommands = 8000, onStep?: (s: GameState) => void, opts: BotOpts = {}): BotResult {
  const state = newGame(seed);
  const rng = seedRng(seed ^ 0x5bd1e995);
  let error: string | undefined;
  let n = 0;
  const hpOnArrival: number[] = [];
  let lastFloor = 0;
  try {
    for (; n < maxCommands && state.status === 'playing'; n++) {
      const cmd = kind === 'heuristic' ? heuristicCommand(state, rng, opts) : chaosCommand(state, rng);
      const res = submit(state, cmd);
      if (!res.ok && kind === 'heuristic') submit(state, { t: 'wait' });
      if (state.floor.index !== lastFloor) {
        lastFloor = state.floor.index;
        const p = player(state);
        hpOnArrival.push(Math.round((p.hp / p.maxHp) * 100));
      }
      onStep?.(state);
    }
  } catch (e) {
    error = e instanceof Error ? `${e.message}\n${e.stack}` : String(e);
  }
  const out: BotResult = {
    seed,
    status: state.status,
    floor: state.floor.index,
    turn: state.turn,
    kills: state.stats.kills,
    commands: n,
    floorTurns: state.stats.floorTurns,
    hpOnArrival,
  };
  if (state.death) out.cause = state.death.cause;
  if (error) out.error = error;
  return out;
}
