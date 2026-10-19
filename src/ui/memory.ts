// Where creatures were last seen. Pure UI memory (not game state): when a creature slips out
// of view, a dim marker stays where you last saw it until you look there again, it dies, or
// it has been a while.

import { idx } from '../core/floor.ts';
import type { GameState } from '../core/types.ts';
import { visibleEnemies } from './travel.ts';

export interface Sighting {
  id: number;
  def: string;
  x: number;
  y: number;
  turn: number;
}

/** Turns a last-seen marker lasts. */
const FORGET_AFTER = 25;

export class SightMemory {
  floor = -1;
  seen = new Map<number, Sighting>();

  /** Updates the memory from the current view. Call after every change of state. */
  update(s: GameState): void {
    const f = s.floor;
    if (f.index !== this.floor) {
      this.floor = f.index;
      this.seen.clear();
    }
    const visible = new Set<number>();
    for (const a of visibleEnemies(s)) {
      visible.add(a.id);
      this.seen.set(a.id, { id: a.id, def: a.def, x: a.x, y: a.y, turn: s.turn });
    }
    for (const [id, m] of this.seen) {
      if (visible.has(id)) continue;
      const a = f.actors.find((x) => x.id === id);
      // Gone, forgotten, or you can see the spot and it isn't there.
      if (!a || a.dead || s.turn - m.turn > FORGET_AFTER || f.vis[idx(f, m.x, m.y)] === 1) this.seen.delete(id);
    }
  }

  /** Creatures out of sight whose last position is remembered. */
  ghosts(s: GameState): Sighting[] {
    const f = s.floor;
    const visible = new Set(visibleEnemies(s).map((a) => a.id));
    return [...this.seen.values()].filter((m) => !visible.has(m.id) && f.vis[idx(f, m.x, m.y)] !== 1);
  }
}
