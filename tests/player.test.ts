import { describe, expect, it } from 'vitest';
import { submit, newGame, previewCommand } from '../src/core/game.ts';
import { T } from '../src/core/terrain.ts';
import { player, hasStatus } from '../src/core/state.ts';
import { idx } from '../src/core/floor.ts';
import { testState } from './helpers.ts';
import { refreshVision } from '../src/core/vision.ts';

describe('weapon verbs', () => {
  it('spear reaches two tiles', () => {
    const { state, mons } = testState(['#######', '#@.z..#', '#######'], { z: 'drowned' }, { weapon: 'spear' });
    const z = mons[0]!;
    const p = player(state);
    submit(state, { t: 'move', dx: 1, dy: 0 });
    expect(p.x).toBe(1);
    expect(z.hp).toBeLessThan(9);
  });
  it('cutlass lunges and strikes for +2', () => {
    const { state, mons } = testState(['#######', '#@.z..#', '#######'], { z: 'drowned' }, { weapon: 'cutlass' });
    const z = mons[0]!;
    z.ai!.mode = 'hunt';
    const p = player(state);
    submit(state, { t: 'move', dx: 1, dy: 0 });
    expect(p.x).toBe(2);
    expect(z.hp).toBe(9 - 6);
  });
  it('axe cleaves the tiles beside the target', () => {
    const { state, mons } = testState(['#####', '#aza#', '#.@.#', '#####'], { z: 'drowned', a: 'drowned' }, { weapon: 'axe' });
    for (const m of mons) m.ai!.mode = 'hunt';
    submit(state, { t: 'move', dx: 0, dy: -1 });
    for (const m of mons) expect(m.hp).toBe(9 - 4);
  });
  it('trident pierces the tile behind', () => {
    const { state, mons } = testState(['######', '#@zz.#', '######'], { z: 'drowned' }, { weapon: 'trident' });
    for (const m of mons) m.ai!.mode = 'hunt';
    submit(state, { t: 'move', dx: 1, dy: 0 });
    for (const m of mons) expect(m.hp).toBe(9 - 4);
  });
  it('maul knocks back and slams into walls', () => {
    const { state, mons } = testState(['#####', '#@z.#', '#####'], { z: 'drowned' }, { weapon: 'maul' });
    const z = mons[0]!;
    z.ai!.mode = 'hunt';
    submit(state, { t: 'move', dx: 1, dy: 0 });
    expect(z.x).toBe(3);
    // Push into (3,1) succeeded; no slam yet.
    expect(z.hp).toBe(9 - 5);
    submit(state, { t: 'move', dx: 1, dy: 0 });
  });
  it('a set spear strikes an enemy that closes in, but only if you hold your ground', () => {
    const run = (step: boolean): number => {
      // It is two tiles away and closes in this turn. Either you stand firm, or you step
      // sideways (staying within its reach) as it comes.
      const { state, mons } = testState(['#######', '#.....#', '#.@.z.#', '#.....#', '#######'], { z: 'drowned_diver' }, { weapon: 'spear' });
      state.build.weapon.upgrades = ['spear_brace'];
      const z = mons[0]!;
      z.ai!.mode = 'hunt';
      z.ai!.targetId = state.playerId;
      z.ai!.cd.harpoon = 99; // just walk in
      const hp0 = z.hp;
      submit(state, step ? { t: 'move', dx: 0, dy: -1 } : { t: 'wait' });
      expect(Math.max(Math.abs(z.x - player(state).x), Math.abs(z.y - player(state).y))).toBe(1);
      return hp0 - z.hp;
    };
    expect(run(false)).toBeGreaterThan(0);
    expect(run(true)).toBe(0);
  });
  it('harpoon drags a distant enemy adjacent', () => {
    const { state, mons } = testState(['########', '#@...z.#', '########'], { z: 'drowned' }, { weapon: 'harpoon' });
    const z = mons[0]!;
    const res = submit(state, { t: 'attack', x: 5, y: 1 });
    expect(res.ok).toBe(true);
    expect(z.x).toBeLessThanOrEqual(3);
  });
  it('knife sneak attacks deal triple damage to sleepers', () => {
    const { state, mons } = testState(['#####', '#@z.#', '#####'], { z: 'drowned_diver' }, { weapon: 'knife' });
    const z = mons[0]!;
    z.ai!.mode = 'asleep';
    submit(state, { t: 'move', dx: 1, dy: 0 });
    expect(z.hp).toBe(14 - 9);
  });
});

describe('belt and pickups', () => {
  it('stacks consumables and refuses when full without a replacement', () => {
    const { state } = testState(['#####', '#@..#', '#####']);
    state.build.belt = [{ def: 'tonic', count: 3 }, { def: 'firepot', count: 1 }, { def: 'oil_flask', count: 1 }, { def: 'smoke_pot', count: 1 }];
    const f = state.floor;
    f.items.push({ id: 900, x: 2, y: 1, item: { kind: 'consumable', def: 'shock_jar', count: 1 } });
    submit(state, { t: 'move', dx: 1, dy: 0 });
    expect(f.items.some((i) => i.id === 900)).toBe(true);
    const res = submit(state, { t: 'pickup' });
    expect(res.needs).toBe('belt');
    const res2 = submit(state, { t: 'pickup', replace: 3 });
    expect(res2.ok).toBe(true);
    expect(state.build.belt[3]?.def).toBe('shock_jar');
    expect(f.items.some((i) => i.item.def === 'smoke_pot')).toBe(true);
  });
  it('taking a vault relic sinks the others', () => {
    const { state } = testState(['######', '#@...#', '######']);
    const f = state.floor;
    f.items.push({ id: 901, x: 2, y: 1, item: { kind: 'relic', def: 'gillcharm', count: 1 }, vault: 5 });
    f.items.push({ id: 902, x: 3, y: 1, item: { kind: 'relic', def: 'coral_heart', count: 1 }, vault: 5 });
    submit(state, { t: 'move', dx: 1, dy: 0 });
    submit(state, { t: 'pickup' });
    expect(state.build.relics).toContain('gillcharm');
    expect(f.items.some((i) => i.id === 902)).toBe(false);
  });
});

describe('abilities', () => {
  it('spend charges and do their thing', () => {
    const { state, mons } = testState(['#########', '#@....z.#', '#########'], { z: 'drowned' });
    state.build.abilities = [{ def: 'flare', charges: 2, max: 2 }];
    const z = mons[0]!;
    const res = submit(state, { t: 'ability', slot: 0, x: z.x, y: z.y });
    expect(res.ok).toBe(true);
    expect(state.build.abilities[0]!.charges).toBe(1);
    expect(z.hp).toBeLessThan(9);
  });
  it('frost breath freezes water into ice', () => {
    const { state } = testState(['#######', '#@≈≈≈.#', '#######']);
    state.build.abilities = [{ def: 'frost_breath', charges: 2, max: 2 }];
    submit(state, { t: 'ability', slot: 0, x: 3, y: 1 });
    const f = state.floor;
    expect(f.surface[idx(f, 2, 1)]).toBe(2);
  });
});

describe('run flow', () => {
  it('starts with a weapon choice, then plays', () => {
    const state = newGame(5);
    expect(state.pending?.kind).toBe('weapon');
    expect(submit(state, { t: 'move', dx: 1, dy: 0 }).ok).toBe(false);
    expect(submit(state, { t: 'choose', index: 1 }).ok).toBe(true);
    expect(state.pending).toBeNull();
  });
  it('climbing refills charges, heals and offers boons', () => {
    const state = newGame(9);
    submit(state, { t: 'choose', index: 0 });
    const p = player(state);
    p.hp = 10;
    state.build.abilities = [{ def: 'blink', charges: 0, max: 2 }];
    const exit = state.floor.features.find((f) => f.kind === 'exit')!;
    p.x = exit.x;
    p.y = exit.y;
    expect(submit(state, { t: 'ascend' }).ok).toBe(true);
    expect(state.floor.index).toBe(1);
    expect(state.build.abilities[0]!.charges).toBe(2);
    expect(p.hp).toBeGreaterThan(10);
    expect(state.pending?.kind).toBe('boon');
    expect(state.pending!.options.length).toBe(3);
    expect(submit(state, { t: 'choose', index: 0 }).ok).toBe(true);
  });
  it('rooted players cannot walk but time does not pass', () => {
    const { state } = testState(['#####', '#@..#', '#####']);
    const p = player(state);
    p.statuses.push({ id: 'rooted', turns: 2 });
    const turn = state.turn;
    expect(submit(state, { t: 'move', dx: 1, dy: 0 }).ok).toBe(false);
    expect(state.turn).toBe(turn);
    expect(hasStatus(p, 'rooted')).toBe(true);
  });
});

describe('previews', () => {
  it('warn when fire you start can spread back to where you stand', () => {
    const { state } = testState(['##########', '#.@""""".#', '##########']);
    const f = state.floor;
    const p = player(state);
    state.build.abilities = [{ def: 'flare', charges: 2, max: 2 }];
    f.terrain[idx(f, p.x, p.y)] = T.GRASS;
    expect(previewCommand(state, { t: 'ability', slot: 0, x: 7, y: 1 }).warning).toMatch(/spread through the grass to where you stand/);
    f.terrain[idx(f, p.x, p.y)] = T.FLOOR; // on stone, the fire can't come back to you
    expect(previewCommand(state, { t: 'ability', slot: 0, x: 7, y: 1 }).warning).toBeUndefined();
  });
});

describe('the beacon', () => {
  it('the first flame calls two hunting storm wisps; three feeds running light it', () => {
    const row = '#' + '.'.repeat(17) + '#';
    const { state } = testState(['#'.repeat(19), ...Array.from({ length: 15 }, (_, y) => (y === 7 ? '#' + '.'.repeat(8) + '@' + '.'.repeat(8) + '#' : row)), '#'.repeat(19)]);
    const p = player(state);
    p.hp = p.maxHp = 60;
    state.floor.features.push({ id: 999, kind: 'beacon', x: p.x + 1, y: p.y });
    const wisps = () => state.floor.actors.filter((a) => a.def === 'storm_wisp' && !a.dead);
    expect(submit(state, { t: 'interact' }).ok).toBe(true);
    expect(wisps().length).toBe(2);
    for (const w of wisps()) {
      expect(w.ai?.mode).toBe('hunt');
      expect(Math.max(Math.abs(w.x - (p.x + 1)), Math.abs(w.y - p.y))).toBeGreaterThanOrEqual(3);
    }
    submit(state, { t: 'interact' });
    expect(state.floor.actors.filter((a) => a.def === 'storm_wisp').length).toBe(2);
    submit(state, { t: 'interact' });
    expect(state.status).toBe('won');
  });
  it('the storm finds you even in a walled lamp room: it arrives in sight and strikes before the third feed', () => {
    const { state } = testState([
      '###########',
      '#.........#',
      '#..#####..#',
      '#..#...#..#',
      '#..#.@.#..#',
      '#..#...#..#',
      '#..##.##..#',
      '#.........#',
      '#.........#',
      '###########',
    ], {}, { ambient: 0 });
    state.build.lantern = 1; // a stormy night: you see little beyond the lamp room
    refreshVision(state);
    const p = player(state);
    p.hp = p.maxHp = 60;
    state.floor.features.push({ id: 999, kind: 'beacon', x: 6, y: 4 });
    const before = state.nextId;
    submit(state, { t: 'interact' });
    const wisps = state.floor.actors.filter((a) => a.def === 'storm_wisp' && a.id >= before);
    expect(wisps.length).toBe(2);
    for (const w of wisps) expect(state.floor.vis[w.y * state.floor.w + w.x]).toBe(1);
    submit(state, { t: 'interact' });
    submit(state, { t: 'interact' });
    expect(state.status).toBe('won');
    expect(p.hp).toBeLessThan(60);
  });
});
