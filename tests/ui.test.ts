import { describe, expect, it } from 'vitest';
import { depthName, describeMonster, describeTile, floodTimes, modeText, recapLines, wayUpDeadline } from '../src/ui/inspect.ts';
import type { DamageRecord } from '../src/core/types.ts';
import { SightMemory } from '../src/ui/memory.ts';
import { idx } from '../src/core/floor.ts';
import { refreshVision } from '../src/core/vision.ts';
import { testState } from './helpers.ts';

describe('ui text', () => {
  it('merges runs of identical damage ticks in the death recap', () => {
    const tick = (turn: number, hpAfter: number): DamageRecord => ({ turn, amount: 1, dtype: 'poison', source: 'poison', cause: 'poison', hpAfter });
    const recap: DamageRecord[] = [
      { turn: 10, amount: 6, dtype: 'physical', source: 'the wrecker cutthroat', cause: 'slash', hpAfter: 4 },
      tick(11, 3), tick(12, 2), tick(13, 1), tick(14, 0),
    ];
    expect(recapLines(recap)).toEqual([
      'turn 10: 6 damage from the wrecker cutthroat (slash) → 4 HP',
      'turns 11–14: 4 poison damage from poison, 4 hits → 0 HP',
    ]);
  });
  it('names depths the same way everywhere', () => {
    expect(depthName(0)).toBe('Depth 10');
    expect(depthName(8)).toBe('Depth 2');
    expect(depthName(9, true)).toBe('The Surface');
  });
  it('remembers where a creature was last seen until you look there again', () => {
    const { state, mons } = testState(['#########', '#@...+..#', '#########'], { z: 'drowned' }, { place: [['drowned', 4, 1]] });
    const z = mons[0]!;
    const mem = new SightMemory();
    mem.update(state);
    expect(mem.ghosts(state)).toEqual([]);
    // It steps behind the door: out of sight, remembered where it was.
    state.floor.occ[idx(state.floor, z.x, z.y)] = 0;
    z.x = 7;
    state.floor.occ[idx(state.floor, 7, 1)] = z.id;
    refreshVision(state);
    const f = state.floor;
    f.vis[idx(f, 4, 1)] = 0; // pretend the old spot is now out of view too
    mem.update(state);
    expect(mem.ghosts(state).map((g) => [g.x, g.y])).toEqual([[4, 1]]);
    // Seeing the old spot empty forgets it.
    f.vis[idx(f, 4, 1)] = 1;
    mem.update(state);
    expect(mem.ghosts(state)).toEqual([]);
  });
  it("shows what a creature's blow would do to you", () => {
    const { state, mons } = testState(['######', '#@.m.#', '######'], { m: 'monk' });
    expect(describeMonster(state, mons[0]!).lines[0]).toMatch(/hits for 4 ·|hits for 4$/);
    state.build.relics = ['anchor_charm'];
    expect(describeMonster(state, mons[0]!).lines[0]).toMatch(/hits for 4 \(3 to you\)/);
  });
  it('says how long the way up stays open before it needs more than a breath of swimming', () => {
    // An 8-tile channel of shallows between you and the way up: one rise makes it deep.
    const { state } = testState(['##############', '#@.~~~~~~~~..#', '##############']);
    state.floor.features.push({ id: 999, kind: 'exit', x: 12, y: 1, route: 'stair' });
    state.floor.tideTimer = 20;
    expect(wayUpDeadline(state)).toBe(20);
    expect(state.floor.waterLevel).toBe(0); // looked ahead without changing anything
    state.floor.waterLevel = 1;
    expect(wayUpDeadline(state)).toBe(0);
  });
  it('forecasts a straight trade of blows', () => {
    const { state, mons } = testState(['######', '#@.Z.#', '######'], { Z: 'drowned_diver' }, { weapon: 'axe' });
    const z = mons[0]!;
    z.ai!.mode = 'hunt'; // aware: no sneak attack
    // 14 HP against 4 per blow: 4 blows; its 4-damage hits land 3 times meanwhile.
    expect(describeMonster(state, z).lines[1]).toBe('Trading blows: it falls in 4 of yours; meanwhile it deals you about 12.');
    z.ai!.mode = 'asleep'; // the first blow is a sneak attack (x2): 8, then 4 + 4
    expect(describeMonster(state, z).lines[1]).toMatch(/it falls in 3 of yours; meanwhile it deals you about 8\./);
  });
  it('a rope bridge stays dry until the water reaches its deck', () => {
    const { state } = testState(['#####', '#@=.#', '#####']);
    const f = state.floor;
    f.waterLevel = 2;
    f.tideTimer = 6;
    const ft = floodTimes(state, idx(f, 2, 1));
    expect(ft.bridge).toBe(true);
    expect(ft.deep).toBe(ft.wade);
    expect(ft.deep).toBeGreaterThan(6);
    expect(describeTile(state, 2, 1).flatMap((b) => b.lines).join(' ')).toMatch(/deck stays dry until the water reaches 12/);
  });
  it('warns when a fire wind-up lands on something that burns', () => {
    const { state, mons } = testState(['########', '#@"""".#', '########'], {}, { place: [['abbot', 6, 1]] });
    const a = mons[0]!;
    const f = state.floor;
    a.ai!.intent = { ability: 'censer', tiles: [idx(f, 2, 1), idx(f, 3, 1)], aimX: 2, aimY: 1, label: 'Censer Swing', turns: 1, resolveTurn: state.turn + 1 };
    expect(modeText(a, state)).toBe('⚠ Censer Swing — next turn (2 fire, burning oil); the grass there will catch, and the fire will spread');
    a.ai!.intent.tiles = [idx(f, 6, 1)]; // bare stone
    expect(modeText(a, state)).toBe('⚠ Censer Swing — next turn (2 fire, burning oil)');
  });
  it('says what a wind-up does when it lands, so a pull does not read like a blow', () => {
    const { state, mons } = testState(['########', '#@...≈≈#', '########'], {}, { place: [['siren', 6, 1]] });
    const sir = mons[0]!;
    sir.ai!.intent = { ability: 'song', tiles: [idx(state.floor, 1, 1)], aimX: 1, aimY: 1, label: 'Drowning Song', turns: 1, resolveTurn: state.turn + 1 };
    expect(modeText(sir, state)).toBe('⚠ Drowning Song — next turn (drags you 2 closer, no damage)');
  });
  it('counts the others already on you into the forecast', () => {
    const { state, mons } = testState(['######', '#Z@D.#', '######'], { Z: 'drowned_diver', D: 'drowned' }, { weapon: 'axe' });
    for (const m of mons) m.ai!.mode = 'hunt';
    const [z, d] = mons as [typeof mons[0], typeof mons[0]];
    // Four blows against the diver; the (slow) sailor lands its 3 every other turn meanwhile.
    expect(describeMonster(state, z!).lines[1]).toBe('Trading blows: it falls in 4 of yours; meanwhile it deals you about 12, and the other one on you about 6 more.');
    d!.ai!.mode = 'asleep';
    expect(describeMonster(state, z!).lines[1]).toBe('Trading blows: it falls in 4 of yours; meanwhile it deals you about 12.');
  });
});
