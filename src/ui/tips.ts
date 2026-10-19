// First-time contextual tips. Each fires once per browser (remembered in prefs).

import { idx, isDeep, isWater } from '../core/floor.ts';
import { hasStatus, player } from '../core/state.ts';
import { SURF } from '../core/terrain.ts';
import type { GameState } from '../core/types.ts';
import { loadPrefs, savePrefs } from './storage.ts';

interface Tip {
  id: string;
  text: string;
  when: (s: GameState) => boolean;
}

const TIPS: Tip[] = [
  {
    id: 'move',
    text: 'Move with the arrow keys, numpad or hjklyubn — or click a tile to walk there. Hover anything to inspect it.',
    when: (s) => s.turn >= 1,
  },
  {
    id: 'telegraph',
    text: 'Red tiles mean an attack is winding up. It lands next turn — step out of the red, or break its line of sight.',
    when: (s) => s.floor.actors.some((a) => !a.dead && a.ai?.intent && s.floor.vis[idx(s.floor, a.x, a.y)]),
  },
  {
    id: 'tide',
    text: 'The tide is about to rise. The blue-outlined tiles will flood. Head uphill — follow the fresh air in the sidebar.',
    when: (s) => s.floor.tideTimer <= 3 && s.floor.tidePaused === 0,
  },
  {
    id: 'noticed',
    text: 'A creature noticed you (the yellow !). It spends the rest of this turn raising the alarm, so you get one move first — but it is aware of you now: no more sneak attacks. Sleeping and unaware creatures take double damage.',
    when: (s) => s.floor.actors.some((a) => !a.dead && a.ai?.mode === 'alert' && s.floor.vis[idx(s.floor, a.x, a.y)]),
  },
  {
    id: 'water',
    text: 'Wading makes you Wet: fire hurts half as much, lightning twice as much — and lightning travels through the water.',
    when: (s) => {
      const p = player(s);
      return isWater(s.floor, idx(s.floor, p.x, p.y)) && !isDeep(s.floor, idx(s.floor, p.x, p.y));
    },
  },
  {
    id: 'oil',
    text: 'You are coated in oil: fire damage is doubled and will set you ablaze. Wade into water to wash it off.',
    when: (s) => hasStatus(player(s), 'oiled'),
  },
  {
    id: 'burning',
    text: 'You are burning! Step into water, or away from anything flammable. Grass and brush will catch around you.',
    when: (s) => hasStatus(player(s), 'burning'),
  },
  {
    id: 'hurt',
    text: 'Health does not regenerate. Tonics, freshwater springs, tide shrines and climbing (20%) restore it.',
    when: (s) => player(s).hp < player(s).maxHp * 0.5,
  },
  {
    id: 'exit',
    text: 'You found a way up (<). Stand on it and press < to climb. Climbing heals a little, refills abilities, and offers a boon.',
    when: (s) => s.floor.features.some((f) => f.kind === 'exit' && s.floor.vis[idx(s.floor, f.x, f.y)]),
  },
  {
    id: 'rift',
    text: 'A purple way up («) is a Rift: the next floor is harder, but a relic vault is certain.',
    when: (s) => s.floor.features.some((f) => f.kind === 'exit' && f.route === 'rift' && s.floor.vis[idx(s.floor, f.x, f.y)]),
  },
  {
    id: 'vault',
    text: 'Three relics on an altar (♦). You may take one — the rest sink the moment you do.',
    when: (s) => s.floor.items.some((it) => it.vault !== undefined && s.floor.vis[idx(s.floor, it.x, it.y)]),
  },
  {
    id: 'swim',
    text: 'You are swimming: you lose a breath each turn (watch the Breath bar) and your blows land at half strength. Any tile that isn\'t deep water refills your breath.',
    when: (s) => {
      const p = player(s);
      return isDeep(s.floor, idx(s.floor, p.x, p.y));
    },
  },
  {
    id: 'hermit',
    text: 'The hermit (&) trades in pearls. Step onto something he sells and press g to buy it.',
    when: (s) => s.floor.features.some((f) => f.kind === 'merchant' && s.floor.vis[idx(s.floor, f.x, f.y)]),
  },
  {
    id: 'ripple',
    text: 'Ripples: something is lurking under the water. It can bite anything standing next to its pool.',
    when: (s) => s.floor.actors.some((a) => !a.dead && a.submerged && s.floor.vis[idx(s.floor, a.x, a.y)]),
  },
  {
    id: 'ice',
    text: 'Ice is walkable — but you slide one extra tile when you step onto it.',
    when: (s) => {
      const f = s.floor;
      for (let i = 0; i < f.w * f.h; i++) if (f.surface[i] === SURF.ICE && f.vis[i]) return true;
      return false;
    },
  },
  {
    id: 'shrine',
    text: 'A tide shrine (∩). Stand beside it and press g to trade pearls for healing, renewed abilities, or vigor.',
    when: (s) => s.floor.features.some((f) => f.kind === 'shrine' && !f.used && s.floor.vis[idx(s.floor, f.x, f.y)]),
  },
];

export function checkTips(state: GameState): string[] {
  const prefs = loadPrefs();
  const shown = new Set(prefs.tips ?? []);
  const fired: string[] = [];
  for (const t of TIPS) {
    if (shown.has(t.id)) continue;
    let ok = false;
    try {
      ok = t.when(state);
    } catch {
      ok = false;
    }
    if (!ok) continue;
    shown.add(t.id);
    fired.push(t.text);
    if (fired.length >= 1) break;
  }
  if (fired.length) {
    prefs.tips = [...shown];
    savePrefs(prefs);
  }
  return fired;
}

export function resetTips(): void {
  const prefs = loadPrefs();
  prefs.tips = [];
  savePrefs(prefs);
}
