// Automation must never kill you: auto-explore and travel (even with consent to swim) stop
// before anything they do could be fatal. They never leave you drowning, and never stop out in
// the water with air beyond your breath when you set out on your feet. Fuzzed over whole runs mixing
// bot play and travel.

import { describe, expect, it } from 'vitest';
import { heuristicCommand } from '../src/bot/bot.ts';
import { idx, isDeep } from '../src/core/floor.ts';
import { newGame, submit } from '../src/core/game.ts';
import { float, seedRng } from '../src/core/rng.ts';
import { breathMap, player } from '../src/core/state.ts';
import type { GameState } from '../src/core/types.ts';
import { breathBudget, startTravel, travelNext } from '../src/ui/travel.ts';

/** Out in deep water with the nearest air (on the true map) farther than your breath will carry you. */
function stranded(s: GameState): boolean {
  const p = player(s);
  const here = idx(s.floor, p.x, p.y);
  return s.status === 'playing' && isDeep(s.floor, here) && (breathMap(s)[here] as number) - 1 > breathBudget(s);
}

describe('automation', () => {
  it('auto-explore and travel never walk you to your death, or leave you drowning', () => {
    const problems: string[] = [];
    let steps = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const s = newGame(seed);
      const rng = seedRng(seed * 31 + 7);
      for (let n = 0; n < 2500 && s.status === 'playing'; n++) {
        if (s.pending || float(rng) < 0.7) {
          if (!submit(s, heuristicCommand(s, rng, { knowMap: true })).ok) submit(s, { t: 'wait' });
          continue;
        }
        const t = startTravel(s, float(rng) < 0.5 ? 'explore' : 'exit');
        t.swim = float(rng) < 0.7;
        const p0 = player(s);
        const safeStart = !isDeep(s.floor, idx(s.floor, p0.x, p0.y));
        let moved = false;
        for (let k = 0; k < 150 && s.status === 'playing'; k++) {
          const next = travelNext(s, t);
          if ('stop' in next) {
            if (moved && safeStart && stranded(s)) problems.push(`seed ${seed} t${s.turn}: stranded (${next.stop})`);
            break;
          }
          submit(s, next.cmd);
          steps++;
          moved = true;
          if ((s.status as string) === 'dead') problems.push(`seed ${seed} t${s.turn}: ${s.death?.cause}`);
          else if (player(s).breath < 0) problems.push(`seed ${seed} t${s.turn}: drowning`);
        }
      }
    }
    expect(steps).toBeGreaterThan(1000);
    expect(problems).toEqual([]);
  }, 120000);
});
