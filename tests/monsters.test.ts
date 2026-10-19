// Every monster must do what its description says. One scenario per special behaviour.

import { describe, expect, it } from 'vitest';
import { submit } from '../src/core/game.ts';
import { idx, setPos } from '../src/core/floor.ts';
import { shapeTiles } from '../src/core/resolve.ts';
import { hasStatus, player } from '../src/core/state.ts';
import { dealDamage } from '../src/core/effects.ts';
import { GAS, SURF } from '../src/core/terrain.ts';
import { MONSTERS } from '../src/content/monsters.ts';
import { hunt, testState } from './helpers.ts';

const wait = (s: Parameters<typeof submit>[0], n = 1): void => {
  for (let i = 0; i < n; i++) submit(s, { t: 'wait' });
};

describe('the Deep', () => {
  it('moray hides underwater and bites from its pool, but cannot leave it', () => {
    const { state, mons } = testState(['#######', '#≈≈≈..#', '#≈≈≈@.#', '#≈≈≈..#', '#######'], {}, { place: [['moray', 3, 2]] });
    const m = mons[0]!;
    expect(m.submerged).toBe(true);
    hunt(state, mons);
    wait(state);
    expect(player(state).hp).toBe(30 - 4);
    expect(m.submerged).toBe(false);
    // Step away from the water's edge: it can't follow.
    submit(state, { t: 'move', dx: 1, dy: 0 });
    wait(state, 3);
    expect(state.floor.elev[idx(state.floor, m.x, m.y)]).toBeLessThan(0);
    expect(player(state).hp).toBe(26);
  });
  it('a harpooned moray dragged onto land flops and dies', () => {
    const { state, mons } = testState(['########', '#≈≈....#', '#≈≈...@#', '#≈≈....#', '########'], {}, { weapon: 'harpoon', place: [['moray', 2, 2]] });
    const m = mons[0]!;
    m.submerged = false;
    hunt(state, mons);
    submit(state, { t: 'attack', x: 2, y: 2 });
    expect(m.x).toBe(5);
    const hp = m.hp;
    wait(state);
    expect(m.hp < hp || m.dead).toBe(true);
  });
  it('bloom jelly glows, then electrifies the water it is in', () => {
    const { state, mons } = testState(['#######', '#~~~~.#', '#~~~~@#', '#~~~~.#', '#######'], {}, { place: [['bloom', 2, 2]] });
    hunt(state, mons);
    submit(state, { t: 'move', dx: -1, dy: 0 }); // wade in
    const m = mons[0]!;
    // The jelly is slow; give it time to wind up and discharge.
    let saw = false;
    for (let i = 0; i < 4; i++) {
      if (m.ai?.intent) saw = true;
      wait(state);
    }
    expect(saw).toBe(true);
    expect(player(state).hp).toBeLessThanOrEqual(30 - 8);
  });
  it('angler coils, then lunges down a line', () => {
    const { state, mons } = testState(['########', '#≈≈....#', '#≈≈..@.#', '#≈≈....#', '########'], {}, { place: [['angler', 2, 2]] });
    hunt(state, mons);
    wait(state);
    expect(mons[0]!.ai!.intent?.ability).toBe('lunge');
    wait(state);
    expect(player(state).hp).toBe(30 - 8);
  });
  it('spine urchin aims a line, then fires down it; knockback cannot move it but breaks its aim', () => {
    // Stepping out of the line dodges the volley.
    {
      const { state, mons } = testState(['#########', '#.......#', '#@....u.#', '#.......#', '#########'], { u: 'urchin' });
      hunt(state, mons);
      wait(state);
      const u = mons[0]!;
      expect(u.ai?.intent?.tiles).toContain(idx(state.floor, 1, 2));
      submit(state, { t: 'move', dx: 0, dy: -1 });
      expect(player(state).hp).toBe(30);
      expect(state.log.some((l) => /dodge/.test(l.text))).toBe(true);
    }
    // Standing in it hurts.
    {
      const { state, mons } = testState(['#########', '#@....u.#', '#########'], { u: 'urchin' });
      hunt(state, mons);
      wait(state, 2);
      expect(player(state).hp).toBe(30 - 4);
    }
    // A maul blow can't shift it, but the jolt breaks the wind-up.
    {
      const { state, mons } = testState(['#######', '#.@u..#', '#######'], { u: 'urchin' }, { weapon: 'maul' });
      hunt(state, mons);
      wait(state);
      const u = mons[0]!;
      expect(u.ai?.intent).toBeDefined();
      submit(state, { t: 'attack', x: 3, y: 1 });
      expect(u.x).toBe(3);
      expect(u.ai?.intent).toBeUndefined();
      expect(player(state).hp).toBe(30);
    }
  });
  it('drowned diver harpoons you to its side', () => {
    const { state, mons } = testState(['#########', '#.......#', '#.z...@.#', '#.......#', '#########'], { z: 'drowned_diver' });
    hunt(state, mons);
    wait(state);
    expect(mons[0]!.ai!.intent?.ability).toBe('harpoon');
    wait(state);
    const p = player(state);
    expect(Math.max(Math.abs(p.x - mons[0]!.x), Math.abs(p.y - mons[0]!.y))).toBe(1);
  });
});

describe('the Cloister', () => {
  it('lamplighter splashes oil, then throws a torch', () => {
    const { state, mons } = testState(['#########', '#.......#', '#.l...@.#', '#.......#', '#########'], { l: 'lamplighter' });
    hunt(state, mons);
    wait(state);
    expect(mons[0]!.ai!.intent?.ability).toBe('douse');
    wait(state);
    const f = state.floor;
    const p = player(state);
    expect(f.surface[idx(f, p.x, p.y)]).toBe(SURF.OIL);
    expect(hasStatus(p, 'oiled')).toBe(true);
  });
  it('bloat swells beside you and bursts into miasma', () => {
    const { state, mons } = testState(['#######', '#.....#', '#..b@.#', '#.....#', '#######'], { b: 'bloat' });
    hunt(state, mons);
    for (let i = 0; i < 4 && !mons[0]!.dead; i++) wait(state);
    expect(mons[0]!.dead).toBe(true);
    const f = state.floor;
    const p = player(state);
    expect(f.gas[idx(f, p.x, p.y)]).toBe(GAS.MIASMA);
  });
  it('bloat killed by fire explodes instead', () => {
    const { state, mons } = testState(['#######', '#.....#', '#..b@.#', '#.....#', '#######'], { b: 'bloat' });
    const b = mons[0]!;
    dealDamage(state, b, 10, 'fire', { actor: player(state), name: 'you', cause: 'test' });
    expect(b.dead).toBe(true);
    const f = state.floor;
    expect(f.gas[idx(f, 3, 2)]).toBe(GAS.NONE);
    expect(player(state).hp).toBeLessThan(30);
  });
  it('choir wraith shrugs off half of physical damage', () => {
    const { state, mons } = testState(['######', '#.@W.#', '######'], { W: 'wraith' });
    const w = mons[0]!;
    hunt(state, mons);
    submit(state, { t: 'move', dx: 1, dy: 0 });
    expect(w.hp).toBe(MONSTERS.wraith!.hp - 1);
  });
  it('choir wraith inside a wall is still caught by blasts and shots', () => {
    // It passes through walls and claws you from inside one: whatever would hit it in the open hits it there.
    const { state, mons } = testState(['#####', '#.@.#', '#####'], {}, { place: [['wraith', 1, 1]] });
    const w = mons[0]!;
    setPos(state.floor, w, 2, 0);
    state.build.abilities = [{ def: 'thunderclap', charges: 1, max: 1 }];
    const hp = w.hp;
    submit(state, { t: 'ability', slot: 0 });
    expect(w.hp).toBeLessThan(hp);
    expect(shapeTiles(state, player(state), { k: 'bolt', range: 5 }, 2, 0).impact).toEqual({ x: 2, y: 0 });
  });
  it('bell warden lifts its bell for two actions before the toll', () => {
    const { state, mons } = testState(['#########', '#.......#', '#..G.@..#', '#.......#', '#########'], { G: 'warden' });
    hunt(state, mons);
    let turnsWithIntent = 0;
    for (let i = 0; i < 8; i++) {
      wait(state);
      if (mons[0]!.ai!.intent) turnsWithIntent++;
    }
    expect(turnsWithIntent).toBeGreaterThanOrEqual(2);
    expect(player(state).hp).toBeLessThan(30);
  });
});

describe('the Abbot', () => {
  it('raises faithful from nearby water, never more than two at a time (three below half health)', () => {
    const { state, mons } = testState([
      '############',
      '#~~~~~~~~~~#',
      '#~~~~~~~~~~#',
      '#....P.....#',
      '#..........#',
      '#.........@#',
      '############',
    ], { P: 'abbot' });
    const p = player(state);
    p.hp = p.maxHp = 500;
    const abbot = mons[0]!;
    hunt(state, mons);
    const faithful = () => state.floor.actors.filter((a) => a.def === 'faithful' && !a.dead).length;
    let most = 0;
    for (let k = 0; k < 20; k++) {
      abbot.ai!.cd.raise = 0;
      wait(state);
      most = Math.max(most, faithful());
    }
    expect(most).toBe(2);
    abbot.hp = Math.floor(abbot.maxHp / 2) - 1;
    for (let k = 0; k < 20; k++) {
      abbot.ai!.cd.raise = 0;
      wait(state);
      most = Math.max(most, faithful());
    }
    expect(most).toBe(3);
  });
});

describe('the Wreckers', () => {
  it('gunner aims, then its shot hits the first creature in the line', () => {
    const { state, mons } = testState(['############', '#..........#', '#.g..h...@.#', '#..........#', '############'], { g: 'gunner', h: 'cutthroat' });
    const [gunner, cut] = mons as [typeof mons[0], typeof mons[0]];
    hunt(state, [gunner]);
    cut.ai!.mode = 'asleep';
    wait(state);
    expect(gunner.ai!.intent?.ability).toBe('musket');
    wait(state);
    expect(cut.hp).toBeLessThan(MONSTERS.cutthroat!.hp);
    expect(player(state).hp).toBe(30);
  });
  it('gunner holds its ground while it reloads, as its tip says', () => {
    const { state, mons } = testState(['############', '#..........#', '#.@.....g..#', '#..........#', '############'], { g: 'gunner' });
    const g = mons[0]!;
    hunt(state, mons);
    wait(state);
    expect(g.ai!.intent?.ability).toBe('musket');
    submit(state, { t: 'move', dx: 1, dy: -1 }); // out of the line; the shot goes off
    expect(g.ai!.intent).toBeUndefined();
    const x0 = g.x;
    for (let k = 0; k < 3; k++) submit(state, { t: 'move', dx: 1, dy: 0 });
    expect(g.x).toBe(x0);
  });
  it('skua snatches from your belt and drops it when killed', () => {
    const { state, mons } = testState(['#######', '#.....#', '#..v@.#', '#.....#', '#######'], { v: 'skua' });
    state.build.belt = [{ def: 'tonic', count: 1 }, null, null, null];
    hunt(state, mons);
    for (let i = 0; i < 3; i++) wait(state);
    expect(state.build.belt[0]).toBeNull();
    const s = mons[0]!;
    dealDamage(state, s, 50, 'physical', { actor: player(state), name: 'you', cause: 'test' });
    expect(state.floor.items.some((i) => i.item.def === 'tonic')).toBe(true);
  });
  it('king crab opens its claw, then crushes and holds', () => {
    const { state, mons } = testState(['######', '#.@K.#', '######'], { K: 'king_crab' });
    hunt(state, mons);
    wait(state);
    expect(mons[0]!.ai!.intent?.ability).toBe('crush');
    wait(state);
    expect(player(state).hp).toBe(30 - 10);
    expect(hasStatus(player(state), 'rooted')).toBe(true);
  });
  it('powder monkey lobs a bomb, then fumbles for the next fuse and lets you close in', () => {
    const { state, mons } = testState(['############', '#..........#', '#..@....p..#', '#..........#', '############'], { p: 'powder_monkey' });
    const m = mons[0]!;
    hunt(state, mons);
    wait(state);
    expect(m.ai!.intent?.ability).toBe('bomb');
    // A diagonal step clears the plus-shaped blast.
    submit(state, { t: 'move', dx: 1, dy: -1 });
    expect(player(state).hp).toBe(30);
    expect(state.log.some((l) => l.text === 'You dodge the powder bomb.')).toBe(true);
    // While it fumbles, it doesn't back away as you approach.
    const x0 = m.x;
    submit(state, { t: 'move', dx: 1, dy: 1 });
    submit(state, { t: 'move', dx: 1, dy: 0 });
    expect(m.x).toBe(x0);
  });
  it('siren song drags you toward the water', () => {
    const { state, mons } = testState(['###########', '#≈≈≈......#', '#≈≈≈.....@#', '#≈≈≈......#', '###########'], {}, { place: [['siren', 2, 2]] });
    hunt(state, mons);
    const x0 = player(state).x;
    wait(state, 2);
    expect(player(state).x).toBeLessThan(x0);
  });
});

describe('the Surface', () => {
  it('storm wisp marks a tile, then lightning falls on it', () => {
    const { state, mons } = testState(['##########', '#........#', '#.w....@.#', '#........#', '##########'], { w: 'storm_wisp' });
    hunt(state, mons);
    wait(state);
    expect(mons[0]!.ai!.intent?.ability).toBe('strike');
    wait(state);
    expect(player(state).hp).toBeLessThan(30);
  });
  it('the Leviathan rears back for two turns before its maw', () => {
    const { state, mons } = testState(['############', '#≈≈≈.......#', '#≈≈≈....@..#', '#≈≈≈.......#', '############'], {}, { place: [['leviathan', 2, 2]] });
    hunt(state, mons);
    wait(state);
    expect(mons[0]!.ai!.intent).toBeDefined();
    const before = player(state).hp;
    wait(state);
    expect(player(state).hp).toBe(before);
    wait(state);
    expect(player(state).hp).toBeLessThan(before);
  });
});

describe('descriptions', () => {
  it('every monster has a description and a tip', () => {
    for (const m of Object.values(MONSTERS)) {
      expect(m.desc.length, m.key).toBeGreaterThan(5);
      expect(m.tip.length, m.key).toBeGreaterThan(5);
    }
  });
});
