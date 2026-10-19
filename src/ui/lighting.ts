// Coloured light for rendering. Gameplay visibility uses core/vision.ts; this only decides
// what colour the visible world is tinted.

import { MONSTERS } from '../content/monsters.ts';
import { computeFov } from '../core/fov.ts';
import { blocksSight, idx, inBounds } from '../core/floor.ts';
import { hasStatus, player, playerLantern } from '../core/state.ts';
import { T } from '../core/terrain.ts';
import type { GameState } from '../core/types.ts';
import type { RGB } from './color.ts';
import { hex } from './color.ts';

const ZONE_AMBIENT: Record<string, RGB> = {
  deep: [28, 44, 70],
  cloister: [70, 62, 52],
  caves: [70, 66, 56],
  surface: [120, 132, 140],
};

const TERRAIN_LIGHT: Record<number, RGB> = {
  [T.CORAL]: [235, 120, 190],
  [T.GLOWMOSS]: [80, 220, 200],
  [T.BRAZIER]: [255, 180, 100],
  [T.WALL_LAMP]: [255, 190, 110],
};

const FIRE: RGB = [255, 140, 50];
const LANTERN: RGB = [255, 222, 175];

export function computeColorLight(state: GameState): Float32Array {
  const f = state.floor;
  const n = f.w * f.h;
  const out = new Float32Array(n * 3);
  const amb = ZONE_AMBIENT[f.zone] ?? [60, 60, 60];
  const a = f.ambient;
  // Ambient: dark zones still get a faint cold floor so remembered shapes read.
  const base: RGB = [amb[0] * (0.35 + a), amb[1] * (0.35 + a), amb[2] * (0.35 + a)];
  for (let i = 0; i < n; i++) {
    out[i * 3] = base[0];
    out[i * 3 + 1] = base[1];
    out[i * 3 + 2] = base[2];
  }
  const blocks = (x: number, y: number): boolean => !inBounds(f, x, y) || blocksSight(f, idx(f, x, y));
  const add = (sx: number, sy: number, r: number, c: RGB, strength = 1): void => {
    computeFov(sx, sy, r, blocks, (x, y) => {
      if (!inBounds(f, x, y)) return;
      const d = Math.hypot(x - sx, y - sy);
      const k = strength * Math.max(0, 1 - d / (r + 1.5)) ** 1.1;
      const i = (y * f.w + x) * 3;
      out[i] = (out[i] as number) + c[0] * k;
      out[i + 1] = (out[i + 1] as number) + c[1] * k;
      out[i + 2] = (out[i + 2] as number) + c[2] * k;
    });
  };
  for (let i = 0; i < n; i++) {
    const x = i % f.w;
    const y = (i - x) / f.w;
    if ((f.fire[i] as number) > 0) add(x, y, 3.5, FIRE, 1.1);
    const tl = TERRAIN_LIGHT[f.terrain[i] as number];
    if (tl) {
      const t = f.terrain[i] as number;
      const r = t === T.BRAZIER || t === T.WALL_LAMP ? 5 : t === T.CORAL ? 2.5 : 1.5;
      add(x, y, r, tl, t === T.GLOWMOSS ? 0.45 : 0.8);
    }
  }
  for (const ft of f.features) {
    if (ft.kind === 'exit') add(ft.x, ft.y, 3.5, ft.route === 'rift' ? [200, 150, 255] : [255, 225, 150], 0.9);
    if (ft.kind === 'beacon') add(ft.x, ft.y, 4, [255, 220, 140], 0.9);
  }
  for (const act of f.actors) {
    if (act.dead) continue;
    const d = MONSTERS[act.def];
    if (d?.light) add(act.x, act.y, d.light + 0.5, hex(d.color), 0.9);
    if (hasStatus(act, 'burning')) add(act.x, act.y, 2.5, FIRE, 0.9);
  }
  const p = player(state);
  add(p.x, p.y, playerLantern(state) + 0.5, LANTERN, 1);
  return out;
}
