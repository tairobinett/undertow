// Debug helpers: ASCII dumps of floors (used by tests, scripts and bug reports).

import { MONSTERS } from '../content/monsters.ts';
import { isDeep, isWater } from './floor.ts';
import { GAS, SURF, TERRAIN } from './terrain.ts';
import type { FloorState, GameState } from './types.ts';

export function asciiFloor(f: FloorState, opts: { showActors?: boolean; showItems?: boolean; state?: GameState } = {}): string {
  const rows: string[] = [];
  for (let y = 0; y < f.h; y++) {
    let row = '';
    for (let x = 0; x < f.w; x++) {
      const i = y * f.w + x;
      let ch = TERRAIN[f.terrain[i] as number]?.glyph ?? '?';
      if (ch === ' ') ch = ' ';
      if (isDeep(f, i)) ch = '≈';
      else if (isWater(f, i)) ch = '~';
      if ((f.surface[i] as number) === SURF.ICE) ch = '_';
      if ((f.surface[i] as number) === SURF.OIL) ch = 'o';
      if ((f.fire[i] as number) > 0) ch = '^';
      if ((f.gas[i] as number) !== GAS.NONE && (f.gasAmt[i] as number) > 20) ch = ':';
      row += ch;
    }
    rows.push(row);
  }
  const put = (x: number, y: number, ch: string): void => {
    const r = rows[y];
    if (r === undefined) return;
    rows[y] = r.slice(0, x) + ch + r.slice(x + 1);
  };
  for (const ft of f.features) {
    const ch = ft.kind === 'exit' ? (ft.route === 'rift' ? '%' : '<') : ft.kind === 'entry' ? '>' : ft.kind === 'shrine' ? '&' : ft.kind === 'spring' ? '*' : ft.kind === 'merchant' ? '$' : ft.kind === 'beacon' ? 'B' : ft.kind === 'altar' ? 'π' : '?';
    put(ft.x, ft.y, ch);
  }
  if (opts.showItems !== false) {
    for (const it of f.items) {
      const ch = it.item.kind === 'pearls' ? '·' : it.item.kind === 'consumable' ? '!' : it.item.kind === 'weapon' ? ')' : '"';
      put(it.x, it.y, ch);
    }
  }
  if (opts.showActors !== false) {
    for (const a of f.actors) {
      if (a.dead) continue;
      put(a.x, a.y, a.def === 'player' ? '@' : (MONSTERS[a.def]?.glyph ?? 'M'));
    }
  }
  return rows.join('\n');
}
