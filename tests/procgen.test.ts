import { describe, expect, it } from 'vitest';
import { newGame } from '../src/core/game.ts';
import { generateFloor } from '../src/procgen/index.ts';
import { dijkstraMap, UNREACHABLE } from '../src/core/dijkstra.ts';
import { isDeep } from '../src/core/floor.ts';
import { TERRAIN } from '../src/core/terrain.ts';
import type { FloorState } from '../src/core/types.ts';

function reach(f: FloorState, swim: boolean): Float64Array {
  return dijkstraMap(f.w, f.h, [f.entryY * f.w + f.entryX], (i) => {
    if (!TERRAIN[f.terrain[i] as number]?.walk) return Infinity;
    if (!swim && isDeep(f, i)) return Infinity;
    return 1;
  });
}

describe('procgen invariants', () => {
  const SEEDS = Array.from({ length: 16 }, (_, i) => 1000 + i * 7);
  for (let index = 0; index < 10; index++) {
    it(`floor ${index} is valid across seeds`, () => {
      for (const seed of SEEDS) {
        const state = newGame(seed);
        const f = index === 0 ? state.floor : generateFloor(state, index, []);
        const dry = reach(f, false);
        const wet = reach(f, true);
        const exits = f.features.filter((x) => x.kind === 'exit');
        if (index < 9) {
          expect(exits.length).toBeGreaterThanOrEqual(1);
          const stair = exits.find((e) => e.route === 'stair')!;
          expect(dry[stair.y * f.w + stair.x]).toBeLessThan(UNREACHABLE);
          for (const e of exits) expect(wet[e.y * f.w + e.x]).toBeLessThan(UNREACHABLE);
        } else {
          const beacon = f.features.find((x) => x.kind === 'beacon')!;
          expect(beacon).toBeDefined();
          expect(f.actors.some((a) => a.def === 'leviathan')).toBe(true);
        }
        for (const it of f.items) expect(wet[it.y * f.w + it.x], `item ${it.item.def} reachable`).toBeLessThan(UNREACHABLE);
        for (const a of f.actors) {
          if (a.def === 'player') continue;
          expect(Math.hypot(a.x - f.entryX, a.y - f.entryY), `${a.def} not on arrival`).toBeGreaterThanOrEqual(5);
        }
        if (index === 5) expect(f.actors.some((a) => a.def === 'abbot')).toBe(true);
        // No two actors share a tile.
        const pos = new Set(f.actors.filter((a) => !a.dead).map((a) => `${a.x},${a.y}`));
        expect(pos.size).toBe(f.actors.filter((a) => !a.dead).length);
      }
    });
  }
  it('floor variants and rifts still produce valid floors', () => {
    for (const mod of ['flooded', 'overgrown', 'luminous', 'restless', 'hushed', 'gloom', 'rift']) {
      for (const seed of [11, 22, 33, 44]) {
        for (const index of [1, 3, 4, 6, 8]) {
          const state = newGame(seed);
          const f = generateFloor(state, index, [mod]);
          const dry = reach(f, false);
          const stair = f.features.find((e) => e.kind === 'exit' && e.route === 'stair')!;
          expect(dry[stair.y * f.w + stair.x], `${mod} seed ${seed} floor ${index}`).toBeLessThan(UNREACHABLE);
        }
      }
    }
  });
  it('the Rift always leads to a relic vault, as its omen promises', () => {
    const cases: [number, number][] = [[11, 8], [23, 7], [93, 1], [95, 6], [110, 7]];
    for (let seed = 1; seed <= 12; seed++) for (const index of [1, 2, 4, 6, 7, 8]) cases.push([seed, index]);
    for (const [seed, index] of cases) {
      const f = generateFloor(newGame(seed), index, ['rift']);
      const vault = f.items.filter((it) => it.vault !== undefined && it.item.kind === 'relic');
      expect(vault.length, `seed ${seed} floor ${index}`).toBe(3);
    }
  });
  it('is deterministic for a seed', () => {
    const a = newGame(31337);
    const b = newGame(31337);
    expect(Buffer.from(a.floor.terrain).equals(Buffer.from(b.floor.terrain))).toBe(true);
    const fa = generateFloor(a, 4, []);
    const fb = generateFloor(b, 4, []);
    expect(Buffer.from(fa.terrain).equals(Buffer.from(fb.terrain))).toBe(true);
    expect(Buffer.from(fa.elev.buffer).equals(Buffer.from(fb.elev.buffer))).toBe(true);
    expect(fa.actors.map((x) => `${x.def}@${x.x},${x.y}`)).toEqual(fb.actors.map((x) => `${x.def}@${x.x},${x.y}`));
  });
  it('generates quickly', () => {
    const state = newGame(5);
    const t0 = performance.now();
    for (let i = 1; i < 10; i++) generateFloor(state, i, []);
    expect(performance.now() - t0).toBeLessThan(3000);
  });
});
