import { describe, expect, it } from 'vitest';
import { heuristicCommand, chaosCommand, runBot } from '../src/bot/bot.ts';
import { newGame, submit } from '../src/core/game.ts';
import { seedRng } from '../src/core/rng.ts';
import { deserialize, replay, serialize, stateHash } from '../src/core/save.ts';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

describe('determinism', () => {
  it('replaying the command log reproduces the exact state', () => {
    const state = newGame(2024);
    const rng = seedRng(7);
    for (let i = 0; i < 400 && state.status === 'playing'; i++) submit(state, heuristicCommand(state, rng));
    const again = replay(2024, state.commands);
    expect(stateHash(again)).toBe(stateHash(state));
  });
  it('save → load → continue matches continuing without saving', () => {
    const a = newGame(99);
    const rng = seedRng(3);
    for (let i = 0; i < 150 && a.status === 'playing'; i++) submit(a, heuristicCommand(a, rng));
    const b = deserialize(serialize(a));
    expect(stateHash(b)).toBe(stateHash(a));
    const r1 = seedRng(11);
    const r2 = seedRng(11);
    for (let i = 0; i < 150 && a.status === 'playing'; i++) {
      submit(a, heuristicCommand(a, r1));
      submit(b, heuristicCommand(b, r2));
    }
    expect(stateHash(b)).toBe(stateHash(a));
  });
  it('core code never uses Math.random or Date', () => {
    const dirs = ['src/core', 'src/ai', 'src/procgen', 'src/content'];
    for (const d of dirs) {
      for (const file of readdirSync(d)) {
        if (!file.endsWith('.ts')) continue;
        const text = readFileSync(join(d, file), 'utf8');
        expect(text.includes('Math.random'), `${d}/${file}`).toBe(false);
        expect(/\bDate\.now\b|new Date\(/.test(text), `${d}/${file}`).toBe(false);
      }
    }
  });
});

describe('bots survive the engine', () => {
  it('chaos bot runs without errors', () => {
    for (let s = 1; s <= 25; s++) {
      const r = runBot(s, 'chaos', 3000);
      expect(r.error, `seed ${s}`).toBeUndefined();
    }
  });
  it('heuristic bot runs without errors', () => {
    for (let s = 1; s <= 12; s++) {
      const r = runBot(s, 'heuristic', 6000);
      expect(r.error, `seed ${s}`).toBeUndefined();
    }
  });
  it('chaos from deep floors runs without errors', () => {
    for (let s = 1; s <= 10; s++) {
      const state = newGame(s * 13);
      submit(state, { t: 'choose', index: 0 });
      // Warp up a few floors.
      const target = 1 + (s % 9);
      for (let k = 0; k < target && state.status === 'playing'; k++) {
        const p = state.floor.actors.find((a) => a.id === state.playerId)!;
        const exit = state.floor.features.find((f) => f.kind === 'exit');
        if (!exit) break;
        state.floor.occ[p.y * state.floor.w + p.x] = 0;
        p.x = exit.x;
        p.y = exit.y;
        submit(state, { t: 'ascend' });
        submit(state, { t: 'choose', index: s % 3 });
      }
      const rng = seedRng(s);
      for (let i = 0; i < 800 && state.status === 'playing'; i++) submit(state, chaosCommand(state, rng));
    }
  });
});
