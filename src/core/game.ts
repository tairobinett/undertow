// The game loop: new runs, command submission, the world tick, floor transitions, previews.
// The UI only ever calls newGame(), submit() and previewCommand().

import { WEAPONS } from '../content/weapons.ts';
import { ABILITIES } from '../content/abilities.ts';
import { VARIANTS } from '../content/variants.ts';
import { ZONES, zoneForFloor } from '../content/zones.ts';
import { monsterAct } from '../ai/brain.ts';
import { generateFloor } from '../procgen/index.ts';
import { featureAt, isWater, rebuildOcc } from './floor.ts';
import { heal } from './effects.ts';
import { performPlayerCommand, refreshAbilityMax } from './player.ts';
import type { CmdResult } from './player.ts';
import { applyBoon, rollBoons } from './progression.ts';
import { sample, seedRng } from './rng.ts';
import {
  canAct, chronicle, emit, hasHook, log, player, playerMaxBreath, playerMaxHp, speedOf, PLAYER_BASE_BREATH,
} from './state.ts';
import { consumeActionStatus, effectiveTideInterval, environmentTick } from './systems.ts';
import { SURF, TERRAIN } from './terrain.ts';
import type { Actor, Command, Feature, GameState, PlayerBuild } from './types.ts';
import { refreshVision } from './vision.ts';

export const SAVE_VERSION = 1;

/** Arts that can be offered alongside the starting weapons. */
export const STARTER_ABILITIES = ['flare', 'frost_breath', 'spark', 'surge', 'blink', 'smoke_veil', 'brace', 'kindle', 'thunderclap'];

export function newGame(seed: number): GameState {
  const build: PlayerBuild = {
    weapon: { def: 'knife', upgrades: [] },
    relics: [],
    relicSlots: 3,
    abilities: [],
    abilitySlots: 4,
    belt: [{ def: 'tonic', count: 1 }, null, null, null],
    pearls: 0,
    armor: 0,
    maxHpBonus: 0,
    maxBreath: PLAYER_BASE_BREATH,
    lantern: 5,
    boons: [],
    bonusDamage: 0,
  };
  const state: GameState = {
    v: SAVE_VERSION,
    seed: seed >>> 0,
    rng: seedRng(seed >>> 0),
    turn: 0,
    // Placeholder floor; replaced immediately below.
    floor: undefined as unknown as GameState['floor'],
    build,
    playerId: 1,
    nextId: 2,
    status: 'playing',
    pending: null,
    log: [],
    events: [],
    stats: {
      kills: 0, killsByDef: {}, damageDealt: 0, damageTaken: 0, pearlsFound: 0, itemsUsed: 0,
      abilitiesUsed: 0, floorTurns: [], deepest: 0, swims: 0,
    },
    dmgLog: [],
    chronicle: [],
    commands: [],
  };
  const p: Actor = {
    id: 1, def: 'player', x: 0, y: 0, hp: 30, maxHp: 30, energy: 100, team: 'player', statuses: [], breath: PLAYER_BASE_BREATH,
  };
  enterFloor(state, 0, [], p);
  // The first commitment: one of three weapons, each paired with a different starting art.
  const weapons = sample(state.rng, Object.keys(WEAPONS), 3);
  const arts = sample(state.rng, STARTER_ABILITIES, 3);
  state.pending = { kind: 'weapon', options: weapons.map((w, i) => `${w}|${arts[i]}`) };
  log(state, 'You broke the seal at the bottom of the Drowned Deep. The Tidestone is yours — and the sea is coming for it.', 'lore');
  log(state, 'Climb. Every floor floods from below.', 'lore');
  chronicle(state, 'Broke the seal of the Reliquary and took the Tidestone.');
  return state;
}

/** Generates floor `index` and places the player at its entry. */
function enterFloor(state: GameState, index: number, mods: string[], p: Actor): void {
  const f = generateFloor(state, index, mods);
  p.x = f.entryX;
  p.y = f.entryY;
  p.energy = 100;
  // Remove anything standing on the entry (generation keeps it clear, but be safe).
  f.actors = f.actors.filter((a) => !(a.x === p.x && a.y === p.y));
  f.actors.unshift(p);
  f.turnArrived = state.turn;
  state.floor = f;
  (state.usedNames ??= []).push(f.name);
  // The first rise already follows tide relics (Tidewatch, the Drowned Idol).
  f.tideTimer = effectiveTideInterval(state);
  if (hasHook(state, 'cartographer')) revealLayout(state);
  rebuildOcc(f);
  refreshVision(state);
  state.stats.deepest = Math.max(state.stats.deepest, index);
  const zone = zoneForFloor(index);
  const firstOfZone = zone.floors[0] === index;
  emit(state, { t: 'floor', index });
  if (firstOfZone) {
    log(state, `— ${zone.name} —`, 'system');
    log(state, zone.intro, 'lore');
  }
  log(state, `${index >= 9 ? 'The Surface' : `Depth ${10 - index}`}: ${f.name}.${mods.includes('rift') ? ' (Rift)' : ''}`, 'system');
  for (const m of mods) if (VARIANTS[m]) log(state, `${VARIANTS[m]?.name}: ${VARIANTS[m]?.desc}`, 'warn');
  if (index === 9) log(state, 'The lighthouse stands at the top of the cliffs. Light its beacon (the first flame calls the storm down on you), or drive the Leviathan back into the deep.', 'lore');
  if (f.items.some((it) => it.vault !== undefined)) log(state, 'Somewhere on this floor, relics wait on an altar (♦).', 'lore');
  if (f.features.some((x) => x.kind === 'shrine')) log(state, 'Somewhere on this floor, a tide shrine (∩) takes offerings of pearls.', 'lore');
  if (f.features.some((x) => x.kind === 'merchant')) log(state, 'Somewhere on this floor, the hermit (&) has set out his wares.', 'lore');
}

/** The Tide Chart: every walkable tile (and the walls around it) is known on arrival. */
function revealLayout(state: GameState): void {
  const f = state.floor;
  for (let y = 0; y < f.h; y++) {
    for (let x = 0; x < f.w; x++) {
      if (!TERRAIN[f.terrain[y * f.w + x] as number]?.walk) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < f.w && ny < f.h) f.seen[ny * f.w + nx] = 1;
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Submitting commands

export interface SubmitResult {
  ok: boolean;
  needs?: 'belt' | 'relic';
  reason?: string;
}

export function submit(state: GameState, cmd: Command): SubmitResult {
  state.events = [];
  if (state.status !== 'playing') return { ok: false, reason: 'game over' };
  if (state.pending) {
    if (cmd.t !== 'choose') return { ok: false, reason: 'choice pending' };
    const ok = resolveChoice(state, cmd.index);
    if (ok) state.commands.push(cmd);
    return { ok };
  }
  if (cmd.t === 'choose') return { ok: false, reason: 'nothing to choose' };
  if (cmd.t === 'ascend') {
    const ok = ascend(state);
    if (ok) state.commands.push(cmd);
    return { ok };
  }
  const res: CmdResult = performPlayerCommand(state, cmd);
  if (!res.ok) {
    const out: SubmitResult = { ok: false };
    if (res.needs) out.needs = res.needs;
    if (res.reason) out.reason = res.reason;
    return out;
  }
  state.commands.push(cmd);
  if (res.cost > 0) advance(state, res.cost);
  else refreshVision(state);
  checkVictory(state);
  return { ok: true };
}

/** Runs after every accepted command; the beacon win is set by the interact command itself. */
function checkVictory(state: GameState): void {
  if (state.status === 'playing' && state.floor.index === 9 && state.stats.bossesSlain?.includes('leviathan')) {
    state.status = 'won';
    log(state, 'The Leviathan sinks back into the black water and does not rise again. You walk up to the lighthouse in the rain, alone and alive.', 'good');
    chronicle(state, 'Drove the Leviathan back into the deep.');
  }
  if (state.status === 'won') chronicle(state, 'Reached the surface and escaped the Drowned Deep.');
}

/** Spends the player's energy and runs the world until the player can act again. */
function advance(state: GameState, cost: number): void {
  const p = player(state);
  p.energy -= cost;
  refreshVision(state);
  let guard = 0;
  while (state.status === 'playing' && !state.pending) {
    if (p.energy >= 100) {
      if (canAct(p)) break;
      consumeActionStatus(p);
      p.energy -= 100;
      log(state, 'You are unable to act!', 'bad');
      continue;
    }
    worldTick(state);
    p.energy += speedOf(state, p);
    refreshVision(state);
    if (++guard > 400) break;
  }
}

function worldTick(state: GameState): void {
  state.ticking = true;
  try {
    worldTickInner(state);
  } finally {
    state.ticking = false;
  }
}

function worldTickInner(state: GameState): void {
  const f = state.floor;
  const order = f.actors.filter((a) => !a.dead && a.id !== state.playerId).sort((a, b) => a.id - b.id);
  for (const m of order) {
    if (m.dead || state.status !== 'playing') continue;
    m.energy += speedOf(state, m);
    let actions = 0;
    while (m.energy >= 100 && !m.dead && state.status === 'playing' && actions < 4) {
      m.energy -= 100;
      actions++;
      if (!canAct(m)) {
        consumeActionStatus(m);
        continue;
      }
      monsterAct(state, m);
    }
  }
  if (state.status !== 'playing') return;
  environmentTick(state);
  state.turn += 1;
  // Wind-up countdowns as the player sees them at their next decision.
  for (const a of f.actors) {
    const it = a.ai?.intent;
    if (it) it.turns = Math.max(1, (it.resolveTurn ?? state.turn) - state.turn + 1);
  }
}

// ---------------------------------------------------------------------------
// Choices and floor transitions

function resolveChoice(state: GameState, index: number): boolean {
  const pend = state.pending;
  if (!pend) return false;
  const opt = pend.options[index];
  if (opt === undefined) return false;
  if (pend.kind === 'weapon') {
    const [wkey, art] = opt.split('|') as [string, string | undefined];
    state.build.weapon = { def: wkey, upgrades: [] };
    if (art && ABILITIES[art]) state.build.abilities = [{ def: art, charges: 0, max: 0 }];
    refreshAbilityMax(state);
    for (const ab of state.build.abilities) ab.charges = ab.max;
    log(state, `You take up the ${WEAPONS[wkey]?.name}. ${WEAPONS[wkey]?.rule}`, 'good');
    if (art && ABILITIES[art]) log(state, `You know one art: ${ABILITIES[art]?.name}. ${ABILITIES[art]?.desc}`, 'good');
    chronicle(state, `Chose the ${WEAPONS[wkey]?.name}${art && ABILITIES[art] ? ` and the art of ${ABILITIES[art]?.name}` : ''}.`);
  } else {
    applyBoon(state, opt);
  }
  state.pending = null;
  refreshVision(state);
  return true;
}

export function exitHere(state: GameState): Feature | undefined {
  const p = player(state);
  const ft = featureAt(state.floor, p.x, p.y);
  return ft?.kind === 'exit' ? ft : undefined;
}

function ascend(state: GameState): boolean {
  const exit = exitHere(state);
  if (!exit) {
    log(state, 'There is no way up here.', 'info');
    return false;
  }
  const p = player(state);
  const from = state.floor;
  state.stats.floorTurns.push(state.turn - from.turnArrived);
  const next = from.index + 1;
  chronicle(state, `Climbed out of ${from.name} by the ${exit.route === 'rift' ? 'Rift' : 'Stair'} (turn ${state.turn - from.turnArrived} on the floor).`);
  // Arrival: statuses clear, abilities refill, a little health returns.
  p.statuses = [];
  enterFloor(state, next, exit.nextMods ?? [], p);
  p.maxHp = playerMaxHp(state);
  heal(state, p, Math.ceil(p.maxHp * 0.2), true);
  p.breath = playerMaxBreath(state);
  refreshAbilityMax(state);
  for (const ab of state.build.abilities) ab.charges = ab.max;
  state.pending = { kind: 'boon', options: rollBoons(state) };
  return true;
}

// ---------------------------------------------------------------------------
// Previews: run a command on a clone and report what would happen (no world turn).

export interface PreviewResult {
  ok: boolean;
  /** Why the command couldn't be made, when it couldn't. */
  reason?: string;
  /** Something the HP numbers don't show: fire it starts can spread back to where you stand. */
  warning?: string;
  changes: { id: number; before: number; after: number; died: boolean; moved?: { x: number; y: number } }[];
  events: GameState['events'];
}

export function previewCommand(state: GameState, cmd: Command): PreviewResult {
  const clone = structuredClone(state);
  clone.preview = true;
  clone.events = [];
  if (cmd.t === 'ascend' || cmd.t === 'choose' || clone.pending) return { ok: false, changes: [], events: [] };
  const res = performPlayerCommand(clone, cmd);
  const changes: PreviewResult['changes'] = [];
  for (const a of state.floor.actors) {
    const b = clone.floor.actors.find((x) => x.id === a.id);
    if (!b) continue;
    const died = !!b.dead && !a.dead;
    const moved = a.x !== b.x || a.y !== b.y ? { x: b.x, y: b.y } : undefined;
    if (a.hp !== b.hp || died || moved) {
      const ch: PreviewResult['changes'][number] = { id: a.id, before: a.hp, after: Math.max(0, b.hp), died };
      if (moved) ch.moved = moved;
      changes.push(ch);
    }
  }
  const warning = res.ok ? fireComesBack(state, clone) : undefined;
  return { ok: res.ok, changes, events: clone.events, ...(res.reason ? { reason: res.reason } : {}), ...(warning ? { warning } : {}) };
}

/**
 * Fire this command starts that can reach the tile you stand on: through connected grass,
 * brush, wood or oil it spreads a step or so a turn, and you'd be standing in it.
 */
function fireComesBack(before: GameState, after: GameState): string | undefined {
  const f = after.floor;
  const p = player(after);
  if (p.dead) return undefined;
  const w = f.w;
  const here = p.y * w + p.x;
  if ((f.fire[here] as number) > 0 && (before.floor.fire[here] as number) === 0) return 'You would be standing in the flames.';
  const fuel = (i: number): boolean => (((TERRAIN[f.terrain[i] as number]?.fuel ?? 0) > 0 && !isWater(f, i)) || (f.surface[i] as number) === SURF.OIL);
  if (!fuel(here)) return undefined;
  const seen = new Uint8Array(w * f.h);
  const queue: number[] = [];
  for (let i = 0; i < w * f.h; i++) {
    if ((f.fire[i] as number) > 0 && (before.floor.fire[i] as number) === 0) {
      seen[i] = 1;
      queue.push(i);
    }
  }
  for (let head = 0; head < queue.length && queue.length < 400; head++) {
    const i = queue[head] as number;
    const x = i % w;
    const y = (i - x) / w;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= w || ny >= f.h) continue;
        const j = ny * w + nx;
        if (seen[j] || !fuel(j)) continue;
        if (j === here) return `The fire can spread through the ${TERRAIN[f.terrain[here] as number]?.name ?? 'ground'} to where you stand.`;
        seen[j] = 1;
        queue.push(j);
      }
    }
  }
  return undefined;
}

export { ZONES };
