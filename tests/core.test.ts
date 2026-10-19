import { describe, expect, it } from 'vitest';
import { float, hashSeed, int, seedRng, weighted } from '../src/core/rng.ts';
import { computeFov } from '../src/core/fov.ts';
import { dealDamage, addStatus, computeDamage } from '../src/core/effects.ts';
import { applyElement } from '../src/core/elements.ts';
import { environmentTick } from '../src/core/systems.ts';
import { idx, isDeep, isWater } from '../src/core/floor.ts';
import { hasStatus, player } from '../src/core/state.ts';
import { submit } from '../src/core/game.ts';
import { SURF, T } from '../src/core/terrain.ts';
import { testState } from './helpers.ts';

describe('rng', () => {
  it('is deterministic and in range', () => {
    const a = seedRng(123);
    const b = seedRng(123);
    for (let i = 0; i < 100; i++) expect(float(a)).toBe(float(b));
    const r = seedRng(9);
    for (let i = 0; i < 1000; i++) {
      const v = int(r, 7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(7);
    }
  });
  it('weighted respects zero weights', () => {
    const r = seedRng(1);
    for (let i = 0; i < 200; i++) expect(weighted(r, [['a', 0], ['b', 1]])).toBe('b');
  });
  it('hashSeed is stable and sensitive', () => {
    expect(hashSeed(1, 'floor', 2)).toBe(hashSeed(1, 'floor', 2));
    expect(hashSeed(1, 'floor', 2)).not.toBe(hashSeed(1, 'floor', 3));
  });
});

describe('fov', () => {
  it('is symmetric on random maps', () => {
    const r = seedRng(77);
    for (let trial = 0; trial < 20; trial++) {
      const w = 24;
      const h = 18;
      const walls = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) walls[i] = float(r) < 0.28 ? 1 : 0;
      const blocks = (x: number, y: number): boolean => x < 0 || y < 0 || x >= w || y >= h || walls[y * w + x] === 1;
      const vis = (ox: number, oy: number): Set<number> => {
        const s = new Set<number>();
        computeFov(ox, oy, 30, blocks, (x, y) => {
          if (x >= 0 && y >= 0 && x < w && y < h) s.add(y * w + x);
        });
        return s;
      };
      const pts: [number, number][] = [];
      for (let i = 0; i < w * h; i++) if (!walls[i]) pts.push([i % w, Math.floor(i / w)]);
      for (let k = 0; k < 15; k++) {
        const a = pts[int(r, pts.length)] as [number, number];
        const b = pts[int(r, pts.length)] as [number, number];
        const va = vis(a[0], a[1]).has(b[1] * w + b[0]);
        const vb = vis(b[0], b[1]).has(a[1] * w + a[0]);
        expect(va).toBe(vb);
      }
    }
  });
  it('walls block sight', () => {
    const w = 7;
    const blocks = (x: number, y: number): boolean => x === 3 || x < 0 || x >= w || y < 0 || y >= 3;
    const seen = new Set<number>();
    computeFov(1, 1, 10, blocks, (x, y) => seen.add(y * w + x));
    expect(seen.has(1 * w + 5)).toBe(false);
    expect(seen.has(1 * w + 3)).toBe(true);
  });
});

describe('damage', () => {
  it('is deterministic with armor and a minimum of 1', () => {
    const { state, mons } = testState(['#####', '#@.c#', '#####'], { c: 'scuttler' });
    const crab = mons[0]!;
    const p = player(state);
    expect(computeDamage(state, crab, 3, 'physical', { actor: p, name: 'you', cause: 'test' })).toBe(2);
    expect(computeDamage(state, crab, 1, 'physical', { actor: p, name: 'you', cause: 'test' })).toBe(1);
    const before = crab.hp;
    dealDamage(state, crab, 3, 'physical', { actor: p, name: 'you', cause: 'test' });
    expect(crab.hp).toBe(before - 2);
  });
  it('wet doubles lightning, oil doubles fire and ignites', () => {
    const { state, mons } = testState(['######', '#@.zz#', '######'], { z: 'drowned' });
    const [a, b] = mons as [typeof mons[0], typeof mons[0]];
    addStatus(state, a, 'wet', 3);
    const src = { name: 'test', cause: 'test' };
    dealDamage(state, a, 3, 'lightning', src);
    expect(a.hp).toBe(9 - 6);
    addStatus(state, b, 'oiled', 5);
    dealDamage(state, b, 2, 'fire', src);
    expect(b.hp).toBe(9 - 4);
    expect(hasStatus(b, 'burning')).toBe(true);
    expect(hasStatus(b, 'oiled')).toBe(false);
  });
  it('frozen targets take double physical and thaw', () => {
    const { state, mons } = testState(['#####', '#@z.#', '#####'], { z: 'drowned' });
    const z = mons[0]!;
    addStatus(state, z, 'wet', 3);
    dealDamage(state, z, 1, 'cold', { name: 'test', cause: 'test' });
    expect(hasStatus(z, 'frozen')).toBe(true);
    const hp = z.hp;
    dealDamage(state, z, 3, 'physical', { name: 'test', cause: 'test' });
    expect(z.hp).toBe(hp - 6);
    expect(hasStatus(z, 'frozen')).toBe(false);
  });
});

describe('elements', () => {
  it('fire spreads to adjacent grass the next turn and burns out to ash', () => {
    const { state } = testState(['#######', '#@"""".#', '#######']);
    const f = state.floor;
    applyElement(state, idx(f, 2, 1), 'fire', 1, { src: { name: 't', cause: 't' }, hit: new Set() });
    expect(f.fire[idx(f, 2, 1)]).toBeGreaterThan(0);
    expect(f.fire[idx(f, 3, 1)]).toBe(0);
    environmentTick(state);
    expect(f.fire[idx(f, 3, 1)]).toBeGreaterThan(0);
    for (let k = 0; k < 8; k++) environmentTick(state);
    expect(f.terrain[idx(f, 2, 1)]).toBe(T.ASH);
  });
  it('an oil slick ignites all at once, even over water', () => {
    const { state } = testState(['########', '#@..~~.#', '########']);
    const f = state.floor;
    const src = { src: { name: 't', cause: 't' }, hit: new Set<number>() };
    for (const x of [2, 3, 4, 5]) applyElement(state, idx(f, x, 1), 'oil', 0, src);
    applyElement(state, idx(f, 2, 1), 'fire', 1, src);
    for (const x of [2, 3, 4, 5]) expect(f.fire[idx(f, x, 1)]).toBeGreaterThan(0);
  });
  it('fire on water makes steam; cold turns water to walkable ice', () => {
    const { state } = testState(['######', '#@~≈.#', '######']);
    const f = state.floor;
    const src = { src: { name: 't', cause: 't' }, hit: new Set<number>() };
    applyElement(state, idx(f, 2, 1), 'fire', 1, src);
    expect(f.fire[idx(f, 2, 1)]).toBe(0);
    expect(f.gasAmt[idx(f, 2, 1)]).toBeGreaterThan(0);
    applyElement(state, idx(f, 3, 1), 'cold', 1, src);
    expect(f.surface[idx(f, 3, 1)]).toBe(SURF.ICE);
    expect(isDeep(f, idx(f, 3, 1))).toBe(false);
  });
  it('lightning conducts through connected water and hits each creature once', () => {
    const { state, mons } = testState(['#########', '#@~~z~~z#', '#########'], { z: 'drowned' });
    const f = state.floor;
    for (const m of mons) f.elev[idx(f, m.x, m.y)] = -1;
    applyElement(state, idx(f, 2, 1), 'lightning', 8, { src: { name: 't', cause: 't' }, hit: new Set(), dmg: 2 });
    for (const m of mons) expect(m.hp).toBe(9 - 2);
    const p = player(state);
    expect(p.hp).toBe(30);
  });
  it('barrels explode when ignited', () => {
    const { state } = testState(['######', '#@.0.#', '######']);
    const f = state.floor;
    applyElement(state, idx(f, 3, 1), 'fire', 1, { src: { name: 't', cause: 't' }, hit: new Set() });
    expect(f.terrain[idx(f, 3, 1)]).toBe(T.RUBBLE);
    expect(f.fire[idx(f, 4, 1)]).toBeGreaterThan(0);
    const p = player(state);
    expect(p.hp).toBe(30);
  });
});

describe('tide and drowning', () => {
  it('rises on schedule and floods low ground', () => {
    const { state } = testState(['######', '#@...#', '######']);
    const f = state.floor;
    for (let i = 0; i < f.w * f.h; i++) f.elev[i] = 1;
    f.tideInterval = 6;
    f.tideTimer = 6;
    expect(isWater(f, idx(f, 2, 1))).toBe(false);
    for (let k = 0; k < 6; k++) environmentTick(state);
    expect(f.waterLevel).toBe(1);
    expect(isWater(f, idx(f, 2, 1))).toBe(false);
    for (let k = 0; k < 6; k++) environmentTick(state);
    expect(f.waterLevel).toBe(2);
    expect(isWater(f, idx(f, 2, 1))).toBe(true);
  });
  it('drowning escalates once breath runs out and breath refills on land', () => {
    const { state } = testState(['#####', '#.@.#', '#####']);
    const f = state.floor;
    const p = player(state);
    f.elev[idx(f, p.x, p.y)] = -3;
    const max = p.breath;
    for (let k = 0; k < max; k++) environmentTick(state);
    expect(p.hp).toBe(30);
    environmentTick(state);
    expect(p.hp).toBe(28);
    environmentTick(state);
    expect(p.hp).toBe(25);
    f.elev[idx(f, p.x, p.y)] = 3;
    environmentTick(state);
    expect(p.breath).toBe(max);
  });
});

describe('monsters telegraph strong attacks', () => {
  it('the urchin aims, then fires down the locked line', () => {
    const { state, mons } = testState(['#########', '#@.....u#', '#########'], { u: 'urchin' });
    const u = mons[0]!;
    u.ai!.mode = 'hunt';
    u.ai!.targetId = state.playerId;
    submit(state, { t: 'wait' });
    expect(u.ai!.intent).toBeDefined();
    const p = player(state);
    expect(p.hp).toBe(30);
    // Step out of the line: move up? Map is one row; instead stay and take the hit.
    submit(state, { t: 'wait' });
    expect(p.hp).toBe(30 - 4);
  });
  it('knockback interrupts a wind-up', () => {
    const { state, mons } = testState(['########', '#.@z...#', '########'], { z: 'monk' }, { weapon: 'maul' });
    const m = mons[0]!;
    m.ai!.mode = 'hunt';
    m.ai!.targetId = state.playerId;
    submit(state, { t: 'wait' });
    expect(m.ai!.intent?.ability).toBe('grasp');
    submit(state, { t: 'move', dx: 1, dy: 0 });
    expect(m.ai!.intent).toBeUndefined();
  });
});
