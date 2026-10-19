// Regression tests for rules that once disagreed with what the game tells the player.

import { describe, expect, it } from 'vitest';
import { newGame, previewCommand, submit } from '../src/core/game.ts';
import { BRIDGE_DECK, idx, isDeep, isWater, rebuildOcc } from '../src/core/floor.ts';
import { addStatus, dealDamage, freezeTile } from '../src/core/effects.ts';
import { applyElement, markFire } from '../src/core/elements.ts';
import { attackProblem } from '../src/core/player.ts';
import { spawnMonster } from '../src/core/resolve.ts';
import { hasStatus, player, playerMaxHp } from '../src/core/state.ts';
import { effectiveTideInterval } from '../src/core/systems.ts';
import { GAS, SURF, T } from '../src/core/terrain.ts';
import type { Actor, GameState } from '../src/core/types.ts';
import { refreshVision } from '../src/core/vision.ts';
import { hunt, testState } from './helpers.ts';

const wait = (s: GameState, n = 1): void => {
  for (let i = 0; i < n; i++) submit(s, { t: 'wait' });
};

/** Climbs the first exit of the current floor. */
function climb(s: GameState): void {
  const p = player(s);
  const exit = s.floor.features.find((x) => x.kind === 'exit')!;
  p.x = exit.x;
  p.y = exit.y;
  rebuildOcc(s.floor);
  expect(submit(s, { t: 'ascend' }).ok).toBe(true);
}

describe('health and relics', () => {
  it('swapping relics in and out never refills health', () => {
    const { state } = testState(['#####', '#@..#', '#####']);
    const p = player(state);
    state.build.relics = ['coral_heart', 'tidewatch', 'silent_soles'];
    state.build.hpGranted = ['coral_heart'];
    p.maxHp = playerMaxHp(state);
    p.hp = 5;
    state.floor.items.push({ id: 900, x: p.x, y: p.y, item: { kind: 'relic', def: 'glass_heart', count: 1 } });
    for (let k = 0; k < 6; k++) expect(submit(state, { t: 'pickup', replace: 0 }).ok).toBe(true);
    expect(p.hp).toBe(5);
  });
  it('a relic that raises max HP brings that health the first time only', () => {
    const { state } = testState(['#####', '#@..#', '#####']);
    const p = player(state);
    p.hp = 20;
    state.floor.items.push({ id: 900, x: p.x, y: p.y, item: { kind: 'relic', def: 'coral_heart', count: 1 } });
    submit(state, { t: 'pickup' });
    expect(p.maxHp).toBe(42);
    expect(p.hp).toBe(32);
  });
});

describe('weapons', () => {
  it('Ghost Blade: a kill leaves you Hidden', () => {
    const { state, mons } = testState(['#####', '#@z.#', '#####'], { z: 'ossuary_rat' }, { weapon: 'knife' });
    state.build.weapon.upgrades = ['knife_ghost'];
    mons[0]!.hp = 1;
    submit(state, { t: 'move', dx: 1, dy: 0 });
    expect(mons[0]!.dead).toBe(true);
    expect(hasStatus(player(state), 'hidden')).toBe(true);
  });
  it('a spear cannot reach past an oil barrel, and trying does not smash it', () => {
    const { state } = testState(['######', '#@0z.#', '######'], { z: 'drowned' }, { weapon: 'spear' });
    expect(attackProblem(state, 3, 1)).toBe('path blocked');
    expect(submit(state, { t: 'attack', x: 3, y: 1 }).ok).toBe(false);
    expect(state.floor.terrain[idx(state.floor, 2, 1)]).toBe(T.BARREL);
  });
  it('a step is one tile', () => {
    const { state } = testState(['#########', '#@......#', '#########']);
    expect(submit(state, { t: 'move', dx: 5, dy: 0 }).ok).toBe(false);
    expect(player(state).x).toBe(1);
  });
  it('a knockback that slams into a wall still breaks a wind-up', () => {
    const { state, mons } = testState(['####', '#@Z#', '####'], { Z: 'drowned_diver' }, { weapon: 'maul' });
    const z = mons[0]!;
    z.ai!.mode = 'hunt';
    z.ai!.intent = { ability: 'harpoon', tiles: [], label: 'Harpoon', turns: 1, resolveTurn: state.turn + 1 };
    submit(state, { t: 'move', dx: 1, dy: 0 });
    expect(z.ai!.intent).toBeUndefined();
  });
});

describe('items and elements', () => {
  it('a firepot deals its listed damage (Ember Heart adds 2)', () => {
    const { state, mons } = testState(['#########', '#@....z.#', '#########'], { z: 'drowned' });
    const z = mons[0]!;
    state.build.belt[0] = { def: 'firepot', count: 1 };
    const hit = (): number => {
      const ch = previewCommand(state, { t: 'use', slot: 0, x: z.x, y: z.y }).changes.find((c) => c.id === z.id)!;
      return ch.before - ch.after;
    };
    expect(hit()).toBe(4);
    state.build.relics = ['ember_heart'];
    expect(hit()).toBe(6);
  });
  it('burning deals damage exactly as many times as its duration', () => {
    const { state, mons } = testState(['#####', '#@.z#', '#####'], { z: 'drowned_diver' });
    const z = mons[0]!;
    const hp0 = z.hp;
    addStatus(state, z, 'burning', 2, undefined, state.playerId);
    wait(state, 4);
    expect(hp0 - z.hp).toBe(4);
  });
  it('oil does not melt ice over water', () => {
    const { state } = testState(['#####', '#@≈.#', '#####']);
    const i = idx(state.floor, 2, 1);
    freezeTile(state, i);
    applyElement(state, i, 'oil', 0, { src: { name: 'test', cause: 'test' }, hit: new Set() });
    expect(state.floor.surface[i]).toBe(SURF.ICE);
  });
  it('the Rime Anklet keeps you dry', () => {
    const { state } = testState(['#####', '#@~.#', '#####']);
    state.build.relics = ['rime_anklet'];
    submit(state, { t: 'move', dx: 1, dy: 0 });
    expect(state.floor.surface[idx(state.floor, 2, 1)]).toBe(SURF.ICE);
    expect(hasStatus(player(state), 'wet')).toBe(false);
  });
  it('a frost flask dropped at your own feet freezes the water you are swimming in', () => {
    const { state } = testState(['#####', '#.@.#', '#####']);
    const f = state.floor;
    f.elev[idx(f, 2, 1)] = -3; // you are out in deep water
    refreshVision(state);
    expect(isDeep(f, idx(f, 2, 1))).toBe(true);
    state.build.belt[0] = { def: 'frost_flask', count: 1 };
    expect(submit(state, { t: 'use', slot: 0, x: 2, y: 1 }).ok).toBe(true);
    expect(f.surface[idx(f, 2, 1)]).toBe(SURF.ICE);
    expect(isDeep(f, idx(f, 2, 1))).toBe(false);
  });
  it('Surge soaks what it shoves', () => {
    const { state, mons } = testState(['#########', '#@z.....#', '#########'], { z: 'drowned_diver' });
    state.build.abilities = [{ def: 'surge', charges: 1, max: 1 }];
    expect(submit(state, { t: 'ability', slot: 0, x: 3, y: 1 }).ok).toBe(true);
    expect(mons[0]!.x).toBeGreaterThan(2);
    expect(hasStatus(mons[0]!, 'wet')).toBe(true);
  });
  it('fire you start is yours: its kills count', () => {
    const { state, mons } = testState(['######', '#@..z#', '######'], { z: 'drowned' });
    const f = state.floor;
    const z = mons[0]!;
    z.hp = 2;
    const i = idx(f, z.x, z.y);
    f.terrain[i] = T.GRASS;
    f.fire[i] = 3;
    markFire(f, i, state.playerId);
    wait(state);
    expect(z.dead).toBe(true);
    expect(state.stats.kills).toBe(1);
  });
});

describe('telegraphs and timing', () => {
  it('a fast creature winding up still gives you a turn', () => {
    const { state, mons } = testState(['#####', '#@v.#', '#####'], { v: 'skua' });
    hunt(state, mons);
    expect(state.build.belt[0]).not.toBeNull();
    wait(state);
    expect(mons[0]!.ai!.intent?.ability).toBe('snatch');
    expect(mons[0]!.ai!.intent?.turns).toBe(1);
    expect(state.build.belt[0]).not.toBeNull();
    wait(state);
    expect(state.build.belt[0]).toBeNull();
  });
  it('a fast creature that notices you spends the rest of the turn doing so', () => {
    const { state, mons } = testState(['#########', '#@.....r#', '#########'], { r: 'ossuary_rat' });
    const r = mons[0]!;
    wait(state);
    expect(r.ai!.mode).toBe('alert');
    expect(r.x).toBe(7);
    wait(state);
    expect(r.x).toBeLessThan(7);
  });
  it("a slow creature's wind-up lands exactly when its countdown says", () => {
    const { state, mons } = testState(['#######', '#@.G..#', '#######'], { G: 'warden' });
    const g = mons[0]!;
    hunt(state, mons);
    let shown = 0;
    for (let k = 0; k < 10 && !shown; k++) {
      wait(state);
      shown = g.ai!.intent?.turns ?? 0;
    }
    expect(shown).toBe(4);
    const hp0 = player(state).hp;
    for (let k = 0; k < shown; k++) {
      expect(player(state).hp).toBe(hp0);
      wait(state);
    }
    expect(player(state).hp).toBeLessThan(hp0);
  });
  it('a creature that loses you while still reacting goes looking', () => {
    const { state, mons } = testState(['##########', '#@......Z#', '##########'], { Z: 'drowned_diver' });
    const z = mons[0]!;
    for (let k = 0; k < 4 && z.ai!.mode !== 'alert'; k++) wait(state);
    expect(z.ai!.mode).toBe('alert');
    addStatus(state, player(state), 'hidden', 5);
    wait(state, 2);
    expect(z.ai!.mode).toBe('search');
  });
  it("smoke between you and the siren breaks her song", () => {
    const { state, mons } = testState(['##########', '#@....≈≈≈#', '##########'], {}, { place: [['siren', 7, 1]] });
    const s = mons[0]!;
    s.submerged = false;
    hunt(state, mons);
    for (let k = 0; k < 4 && !s.ai!.intent; k++) wait(state);
    expect(s.ai!.intent?.ability).toBe('song');
    const f = state.floor;
    for (const x of [3, 4]) {
      f.gas[idx(f, x, 1)] = GAS.SMOKE;
      f.gasAmt[idx(f, x, 1)] = 250;
    }
    refreshVision(state);
    wait(state);
    expect(player(state).x).toBe(1);
  });
  it('walkers floundering in deep water hit at half strength', () => {
    const damageFrom = (map: string[]): number => {
      const { state, mons } = testState(map, {}, { place: [['ossuary_rat', 2, 1]] });
      hunt(state, mons);
      const hp0 = player(state).hp;
      wait(state);
      return hp0 - player(state).hp;
    };
    const dry = damageFrom(['#####', '#@..#', '#####']);
    const deep = damageFrom(['#####', '#@≈.#', '#####']);
    expect(dry).toBe(4);
    expect(deep).toBe(2);
  });
});

describe('floors and victory', () => {
  it('bridges keep you dry until the sea has risen over the highest ground', () => {
    const { state } = testState(['#####', '#@=.#', '#####']);
    const f = state.floor;
    const i = idx(f, 2, 1);
    f.waterLevel = 5;
    expect(isWater(f, i)).toBe(false);
    f.waterLevel = BRIDGE_DECK;
    expect(isDeep(f, i)).toBe(true);
  });
  it('the Tide Chart shows each new floor, exits included', () => {
    const s = newGame(7);
    submit(s, { t: 'choose', index: 0 });
    s.build.relics = ['tide_chart'];
    climb(s);
    const f = s.floor;
    for (const e of f.features.filter((x) => x.kind === 'exit')) expect(f.seen[idx(f, e.x, e.y)]).toBe(1);
  });
  it('tide relics already govern the first rise of a floor', () => {
    const s = newGame(7);
    submit(s, { t: 'choose', index: 0 });
    s.build.relics = ['tidewatch'];
    climb(s);
    expect(s.floor.tideTimer).toBe(effectiveTideInterval(s));
    expect(s.floor.tideTimer).toBeGreaterThan(s.floor.tideInterval);
  });
  it('the Leviathan dying any way at all wins the run', () => {
    const { state } = testState(['##########', '#@...≈≈≈≈#', '##########']);
    state.floor.index = 9;
    const lev = spawnMonster(state, 'leviathan', 7, 1, { mode: 'guard' }) as Actor;
    dealDamage(state, lev, 9999, 'fire', { name: 'steam', cause: 'steam' });
    expect(lev.dead).toBe(true);
    wait(state);
    expect(state.status).toBe('won');
    expect(state.chronicle.at(-1)?.text).toMatch(/escaped/);
  });
});
