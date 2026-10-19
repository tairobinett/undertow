// Cosmetic animations driven by game events. The game state is already final when these
// play; they only decorate it (numbers, projectiles, bursts, bumps).

import { MONSTERS } from '../content/monsters.ts';
import type { FxKind, GameEvent, GameState } from '../core/types.ts';
import type { RGB } from './color.ts';
import { hex } from './color.ts';

export type Fx =
  | { k: 'num'; x: number; y: number; text: string; color: RGB; t0: number; dur: number }
  | { k: 'shot'; fx: number; fy: number; tx: number; ty: number; color: RGB; glyph: string; t0: number; dur: number }
  | { k: 'burst'; tiles: number[]; color: RGB; t0: number; dur: number }
  | { k: 'bump'; id: number; dx: number; dy: number; t0: number; dur: number }
  | { k: 'ghost'; x: number; y: number; glyph: string; color: RGB; t0: number; dur: number }
  | { k: 'mark'; id: number; t0: number; dur: number }
  | { k: 'flash'; color: RGB; t0: number; dur: number };

export const FX_COLOR: Record<FxKind, RGB> = {
  fire: [255, 130, 40],
  frost: [170, 225, 255],
  shock: [255, 240, 110],
  steam: [230, 235, 240],
  oil: [210, 160, 60],
  smoke: [150, 150, 160],
  poison: [150, 210, 80],
  water: [70, 160, 255],
  blink: [200, 160, 255],
  heal: [120, 255, 150],
  boom: [255, 170, 60],
  tide: [60, 140, 230],
  hit: [255, 255, 255],
};

const DMG_COLOR: Record<string, RGB> = {
  physical: [255, 255, 255],
  fire: [255, 140, 60],
  cold: [160, 220, 255],
  lightning: [255, 235, 100],
  poison: [150, 220, 80],
  drown: [90, 170, 255],
  pure: [220, 220, 220],
};

const REDUCED = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export class Anims {
  list: Fx[] = [];
  /** Speed multiplier (auto-travel plays faster). */
  speed = 1;

  add(fx: Fx): void {
    if (REDUCED && (fx.k === 'flash' || fx.k === 'bump')) return;
    this.list.push(fx);
    if (this.list.length > 200) this.list.splice(0, this.list.length - 200);
  }

  ingest(events: GameEvent[], state: GameState, now: number): void {
    const s = this.speed;
    let delay = 0;
    for (const ev of events) {
      switch (ev.t) {
        case 'dmg': {
          const isP = ev.id === state.playerId;
          this.add({ k: 'num', x: ev.x, y: ev.y, text: `-${ev.amount}`, color: isP ? [255, 90, 90] : (DMG_COLOR[ev.dtype] ?? [255, 255, 255]), t0: now + delay, dur: 900 * s });
          this.add({ k: 'mark', id: ev.id, t0: now + delay, dur: 160 * s });
          break;
        }
        case 'heal':
          this.add({ k: 'num', x: ev.x, y: ev.y, text: `+${ev.amount}`, color: [120, 255, 150], t0: now + delay, dur: 900 * s });
          break;
        case 'shot': {
          const dist = Math.max(Math.abs(ev.tx - ev.fx), Math.abs(ev.ty - ev.fy));
          const dur = Math.min(260, 40 + dist * 28) * s;
          this.add({ k: 'shot', fx: ev.fx, fy: ev.fy, tx: ev.tx, ty: ev.ty, color: FX_COLOR[ev.kind], glyph: ev.kind === 'hit' ? '•' : '*', t0: now + delay, dur });
          delay += dur * 0.8;
          break;
        }
        case 'fx':
          if (ev.tiles.length) this.add({ k: 'burst', tiles: ev.tiles, color: FX_COLOR[ev.kind], t0: now + delay, dur: 420 * s });
          if (ev.kind === 'shock' && state.floor.raining) this.add({ k: 'flash', color: [230, 240, 255], t0: now + delay, dur: 260 * s });
          if (ev.kind === 'boom') this.add({ k: 'flash', color: [255, 150, 60], t0: now + delay, dur: 220 * s });
          break;
        case 'melee': {
          const a = state.floor.actors.find((x) => x.id === ev.id);
          if (a) this.add({ k: 'bump', id: ev.id, dx: Math.sign(ev.tx - a.x), dy: Math.sign(ev.ty - a.y), t0: now + delay, dur: 130 * s });
          break;
        }
        case 'die': {
          const d = MONSTERS[ev.def];
          if (d) this.add({ k: 'ghost', x: ev.x, y: ev.y, glyph: d.glyph, color: hex(d.color), t0: now + delay, dur: 500 * s });
          break;
        }
        case 'tide':
          this.add({ k: 'flash', color: [40, 110, 220], t0: now + delay, dur: 700 * s });
          break;
        case 'telegraph':
          this.add({ k: 'mark', id: ev.id, t0: now + delay, dur: 400 * s });
          break;
        default:
          break;
      }
    }
  }

  prune(now: number): void {
    this.list = this.list.filter((f) => now < f.t0 + f.dur);
  }

  busy(now: number): boolean {
    return this.list.some((f) => (f.k === 'shot' || f.k === 'bump') && now < f.t0 + f.dur);
  }
}
