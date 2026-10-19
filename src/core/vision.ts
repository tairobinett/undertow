// Light and visibility. The player sees lit tiles in line of sight (and adjacent tiles in
// the dark). Monsters use the symmetric LOS set from the player's position.

import { computeFov } from './fov.ts';
import { blocksSight, idx, inBounds } from './floor.ts';
import { MONSTERS } from '../content/monsters.ts';
import { hasStatus, player, playerLantern } from './state.ts';
import { TERRAIN } from './terrain.ts';
import type { GameState } from './types.ts';

export const LIGHT_VISIBLE = 30;
export const MAX_SIGHT = 18;

export function computeLight(state: GameState): void {
  const f = state.floor;
  const light = f.light;
  const base = Math.round(f.ambient * 255);
  light.fill(base);
  const blocks = (x: number, y: number): boolean => !inBounds(f, x, y) || blocksSight(f, idx(f, x, y));

  const addSource = (sx: number, sy: number, r: number, strength = 255): void => {
    if (r <= 0) return;
    computeFov(sx, sy, r, blocks, (x, y) => {
      if (!inBounds(f, x, y)) return;
      const d = Math.hypot(x - sx, y - sy);
      const v = Math.round(strength * Math.max(0, 1 - d / (r + 1)));
      const i = y * f.w + x;
      if (v > (light[i] as number)) light[i] = v;
    });
  };

  // Terrain emitters and fires.
  for (let i = 0; i < f.w * f.h; i++) {
    const t = TERRAIN[f.terrain[i] as number];
    const fire = f.fire[i] as number;
    const x = i % f.w;
    const y = (i - x) / f.w;
    if (fire > 0) addSource(x, y, 3);
    else if (t && t.light > 0) addSource(x, y, t.light, t.light >= 4 ? 255 : 190);
  }
  // The ways up glow with daylight from above.
  for (const ft of f.features) if (ft.kind === 'exit' || ft.kind === 'beacon') addSource(ft.x, ft.y, 3, 230);
  // Creatures that glow, or burn.
  for (const a of f.actors) {
    if (a.dead) continue;
    const d = MONSTERS[a.def];
    if (d?.light) addSource(a.x, a.y, d.light, 200);
    if (hasStatus(a, 'burning')) addSource(a.x, a.y, 2, 220);
  }
  // The player's lantern.
  const p = player(state);
  addSource(p.x, p.y, playerLantern(state));
}

/** Recomputes the player's visible set, map memory, and the LOS set used by monsters. */
export function computeVision(state: GameState): void {
  const f = state.floor;
  const p = player(state);
  f.vis.fill(0);
  f.los.fill(0);
  const blocks = (x: number, y: number): boolean => !inBounds(f, x, y) || blocksSight(f, idx(f, x, y));
  const blind = hasStatus(p, 'blind');
  const radius = blind ? 1.5 : MAX_SIGHT;
  computeFov(p.x, p.y, radius, blocks, (x, y) => {
    if (!inBounds(f, x, y)) return;
    const i = y * f.w + x;
    f.los[i] = 1;
    const near = Math.max(Math.abs(x - p.x), Math.abs(y - p.y)) <= 1;
    if (near || (f.light[i] as number) >= LIGHT_VISIBLE) {
      f.vis[i] = 1;
      f.seen[i] = 1;
    }
  });
}

export function refreshVision(state: GameState): void {
  computeLight(state);
  computeVision(state);
}

/** True if tile i is currently visible to the player. */
export function tileVisible(state: GameState, x: number, y: number): boolean {
  const f = state.floor;
  return inBounds(f, x, y) && f.vis[idx(f, x, y)] === 1;
}
