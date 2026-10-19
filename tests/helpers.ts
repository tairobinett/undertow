// Test helpers: build small hand-made floors from ASCII.
//   #  wall        .  floor      "  grass      ♣  brush
//   ~  shallow water (elev -1)   ≈  deep water (elev -3)
//   0  oil barrel  =  bridge     +  door       @  player
//   any key in `monsters` → that monster on floor

import { createFloor, rebuildOcc } from '../src/core/floor.ts';
import { newGame } from '../src/core/game.ts';
import { spawnMonster } from '../src/core/resolve.ts';
import { T } from '../src/core/terrain.ts';
import type { Actor, GameState } from '../src/core/types.ts';
import { refreshVision } from '../src/core/vision.ts';

export function testState(
  map: string[],
  monsters: Record<string, string> = {},
  opts: { weapon?: string; ambient?: number; place?: [string, number, number][] } = {},
): { state: GameState; mons: Actor[] } {
  const state = newGame(42);
  state.pending = null;
  state.build.weapon = { def: opts.weapon ?? 'knife', upgrades: [] };
  const h = map.length;
  const w = Math.max(...map.map((r) => [...r].length));
  const f = createFloor(0, 'deep', w, h, 1);
  f.ambient = opts.ambient ?? 1;
  f.tideInterval = 1000;
  f.tideTimer = 1000;
  const p = state.floor.actors.find((a) => a.id === state.playerId) as Actor;
  f.actors = [p];
  const monsterSpots: [string, number, number][] = [];
  map.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const i = y * w + x;
      f.elev[i] = 3;
      switch (ch) {
        case '#': f.terrain[i] = T.WALL; break;
        case '"': f.terrain[i] = T.GRASS; break;
        case '♣': f.terrain[i] = T.BRUSH; break;
        case '~': f.terrain[i] = T.FLOOR; f.elev[i] = -1; break;
        case '≈': f.terrain[i] = T.FLOOR; f.elev[i] = -3; break;
        case '0': f.terrain[i] = T.BARREL; break;
        case '=': f.terrain[i] = T.BRIDGE; f.elev[i] = -3; break;
        case '+': f.terrain[i] = T.DOOR; break;
        default: f.terrain[i] = T.FLOOR;
      }
      if (ch === '@') {
        p.x = x;
        p.y = y;
      } else if (monsters[ch]) {
        monsterSpots.push([monsters[ch] as string, x, y]);
      }
    });
  });
  f.waterLevel = 0;
  state.floor = f;
  rebuildOcc(f);
  const mons: Actor[] = [];
  for (const [key, x, y] of [...monsterSpots, ...(opts.place ?? [])]) {
    const m = spawnMonster(state, key, x, y, { mode: 'guard' });
    if (m) mons.push(m);
  }
  p.hp = p.maxHp = 30;
  refreshVision(state);
  return { state, mons };
}

/** Makes monsters hunt the player immediately (skips the noticing turn). */
export function hunt(state: GameState, mons: Actor[]): void {
  for (const m of mons) {
    if (!m.ai) continue;
    m.ai.mode = 'hunt';
    m.ai.targetId = state.playerId;
  }
}
