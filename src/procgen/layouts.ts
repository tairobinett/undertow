// Zone layouts. Each returns the carved canvas plus anchor points (entry low, exit high).

import { int, range, chance, float } from '../core/rng.ts';
import { T } from '../core/terrain.ts';
import { accrete, addLoops, at, carveDisc, inside, isOpen, randomShape, set, smooth, walk } from './carve.ts';
import type { Canvas, P, Placed } from './carve.ts';
import { floodDistances } from './analyze.ts';

export interface Layout {
  entry: P;
  exit: P;
  rooms: Placed[];
  /** Special marked areas (e.g. boss arena, lighthouse). */
  marks: Record<string, P>;
}

/** Picks entry/exit anchors on opposite ends along a random axis. */
function anchors(c: Canvas): { entry: P; exit: P; horizontal: boolean } {
  const horizontal = c.w >= c.h ? chance(c.rng, 0.8) : chance(c.rng, 0.2);
  const flip = chance(c.rng, 0.5);
  if (horizontal) {
    const ey = range(c.rng, 5, c.h - 6);
    const xy = range(c.rng, 5, c.h - 6);
    const a = { x: 4, y: ey };
    const b = { x: c.w - 5, y: xy };
    return flip ? { entry: b, exit: a, horizontal } : { entry: a, exit: b, horizontal };
  }
  const ex = range(c.rng, 5, c.w - 6);
  const xx = range(c.rng, 5, c.w - 6);
  const a = { x: ex, y: 4 };
  const b = { x: xx, y: c.h - 5 };
  return flip ? { entry: b, exit: a, horizontal } : { entry: a, exit: b, horizontal };
}

function waypoint(c: Canvas, a: P, b: P, t: number, spread: number): P {
  const x = Math.round(a.x + (b.x - a.x) * t + (float(c.rng) * 2 - 1) * spread);
  const y = Math.round(a.y + (b.y - a.y) * t + (float(c.rng) * 2 - 1) * spread);
  return { x: Math.max(3, Math.min(c.w - 4, x)), y: Math.max(3, Math.min(c.h - 4, y)) };
}

// ---------------------------------------------------------------------------
// The Deep: winding tunnels between chambers, pools in the low places.

export function layoutCaves(c: Canvas, opts: { bias: number; width: number; chambers: number; sideRooms: number; kinds: string[] }): Layout {
  const { entry, exit } = anchors(c);
  const pts: P[] = [entry];
  const n = 2 + int(c.rng, 2);
  for (let k = 1; k <= n; k++) pts.push(waypoint(c, entry, exit, k / (n + 1), Math.min(c.w, c.h) * 0.3));
  pts.push(exit);
  // Main tunnel.
  for (let k = 0; k < pts.length - 1; k++) walk(c, pts[k] as P, pts[k + 1] as P, opts.bias, opts.width);
  // Chambers along the way (low-bias blobs).
  for (let k = 0; k < opts.chambers; k++) {
    const base = pts[int(c.rng, pts.length)] as P;
    const target = waypoint(c, base, base, 0, Math.min(c.w, c.h) * 0.45);
    walk(c, base, target, 0.15, 1, 140 + int(c.rng, 120));
  }
  carveDisc(c, entry.x, entry.y, 2.5);
  carveDisc(c, exit.x, exit.y, 2.5);
  smooth(c, 1);
  // Side rooms and grottos accreted onto the cave.
  const rooms: Placed[] = [];
  for (let k = 0; k < opts.sideRooms; k++) {
    const shape = randomShape(c.rng, opts.kinds, range(c.rng, 4, 7));
    const placed = accrete(c, shape, 40, 0, 3);
    if (placed) rooms.push(placed);
  }
  return { entry, exit, rooms, marks: {} };
}

// ---------------------------------------------------------------------------
// The Sunken Cloister: accreted halls, chapels, libraries; some collapse into caves.

export function layoutCloister(c: Canvas, opts: { rooms: number; boss?: boolean }): Layout {
  const { entry } = anchors(c);
  // Start with an entry chapel.
  const startShape = randomShape(c.rng, ['rect', 'octagon', 'circle'], 6);
  for (const t of startShape.tiles) {
    const x = entry.x + t.x - 2;
    const y = entry.y + t.y - 2;
    if (inside(c, x, y, 2)) set(c, x, y, T.FLOOR);
  }
  carveDisc(c, entry.x, entry.y, 1.5);
  const rooms: Placed[] = [];
  const kinds = ['rect', 'rect', 'hall', 'hall', 'octagon', 'cross', 'circle', 'ring'];
  let guard = 0;
  while (rooms.length < opts.rooms && guard++ < opts.rooms * 4) {
    const shape = randomShape(c.rng, kinds, range(c.rng, 5, 9));
    const placed = accrete(c, shape, 50, 0, int(c.rng, 3) === 0 ? 4 : 1);
    if (placed) rooms.push(placed);
  }
  // Collapsed sections: short cave walks off random rooms.
  for (let k = 0; k < 2; k++) {
    const r = rooms[int(c.rng, Math.max(1, rooms.length))];
    if (!r) break;
    walk(c, r.center, waypoint(c, r.center, r.center, 0, 10), 0.2, 1, 60);
  }
  // The exit: the open tile farthest from the entry.
  const dist = floodDistances(c, entry);
  let exit = entry;
  let best = -1;
  for (let i = 0; i < c.w * c.h; i++) {
    const d = dist[i] as number;
    if (d > best && d < 1e8) {
      best = d;
      exit = { x: i % c.w, y: Math.floor(i / c.w) };
    }
  }
  addLoops(c, (x, y) => dist[y * c.w + x] as number, 12, 4);
  // Pillars inside halls.
  for (const r of rooms) for (const p of r.pillars) set(c, p.x, p.y, T.PILLAR);
  const marks: Record<string, P> = {};
  if (opts.boss) {
    // Carve a great nave near the exit for the Abbot.
    carveDisc(c, exit.x, exit.y, 5.5);
    for (let dy = -4; dy <= 4; dy += 4) {
      for (let dx = -4; dx <= 4; dx += 4) {
        if ((dx || dy) && inside(c, exit.x + dx, exit.y + dy, 2) && chance(c.rng, 0.7)) set(c, exit.x + dx, exit.y + dy, T.PILLAR);
      }
    }
    marks.arena = { ...exit };
  }
  return { entry, exit, rooms, marks };
}

// ---------------------------------------------------------------------------
// The Wreckers' Caves: wide blobby caves, beaches, and smugglers' camps.

export function layoutWreck(c: Canvas): Layout {
  const lay = layoutCaves(c, { bias: 0.3, width: 1.6, chambers: 6, sideRooms: 3, kinds: ['rect', 'blob', 'circle'] });
  return lay;
}

// ---------------------------------------------------------------------------
// The Surface: an open clifftop above the sea, with a lighthouse at the high end.

export function layoutSurface(c: Canvas): Layout {
  // Open clifftop grass.
  for (let y = 1; y < c.h - 1; y++) for (let x = 1; x < c.w - 1; x++) set(c, x, y, T.GRASS);
  // Rocky ridges: chains of outcrops, like broken cliff lines running inland.
  const ridges = 4 + int(c.rng, 3);
  for (let k = 0; k < ridges; k++) {
    let x = range(c.rng, 12, c.w - 14);
    let y = range(c.rng, 3, c.h - 4);
    const len = range(c.rng, 4, 9);
    const dx = chance(c.rng, 0.5) ? 1 : -1;
    const dy = chance(c.rng, 0.5) ? 1 : 0;
    for (let s = 0; s < len; s++) {
      const r = 0.8 + float(c.rng) * 1.4;
      const ri = Math.ceil(r);
      for (let oy = -ri; oy <= ri; oy++) for (let ox = -ri; ox <= ri; ox++) if (ox * ox + oy * oy <= r * r && inside(c, x + ox, y + oy, 1)) set(c, x + ox, y + oy, T.WALL);
      x += dx * range(c.rng, 1, 2);
      y += dy * range(c.rng, 0, 1) + (chance(c.rng, 0.3) ? range(c.rng, -1, 1) : 0);
    }
  }
  // The sea is along the left edge; the lighthouse on the right.
  const entry = { x: 9, y: Math.floor(c.h / 2) + range(c.rng, -4, 4) };
  const exit = { x: c.w - 7, y: Math.floor(c.h / 2) + range(c.rng, -5, 5) };
  // A worn footpath from the beach up to the lighthouse.
  const path = walk(c, entry, { x: exit.x - 5, y: exit.y }, 0.72, 0, 400);
  for (const p of path) if (inside(c, p.x, p.y, 1)) set(c, p.x, p.y, T.FLOOR);
  // A ruined chapel on the way.
  const rx = range(c.rng, 20, c.w - 22);
  const ry = range(c.rng, 5, c.h - 12);
  for (let y = ry; y < ry + 6; y++) {
    for (let x = rx; x < rx + 8; x++) {
      const edge = y === ry || y === ry + 5 || x === rx || x === rx + 7;
      if (!inside(c, x, y, 2)) continue;
      if (edge) {
        if (chance(c.rng, 0.72)) set(c, x, y, T.WALL);
      } else set(c, x, y, T.FLOOR);
    }
  }
  // A smugglers' wreck washed up on the beach: planks and barrels.
  const wy = range(c.rng, 4, c.h - 6);
  for (let y = wy; y < wy + 3; y++) for (let x = 6; x < 11; x++) if (inside(c, x, y, 1)) set(c, x, y, T.PLANKS);
  set(c, 7, wy + 1, T.BARREL);
  set(c, 9, wy, T.BARREL);
  // Lighthouse: a round tower with a door facing west.
  const r = 3;
  for (let dy = -r - 1; dy <= r + 1; dy++) {
    for (let dx = -r - 1; dx <= r + 1; dx++) {
      const d2 = dx * dx + dy * dy;
      const x = exit.x + dx;
      const y = exit.y + dy;
      if (!inside(c, x, y, 1)) continue;
      if (d2 <= (r - 0.5) * (r - 0.5)) set(c, x, y, T.FLOOR);
      else if (d2 <= (r + 0.7) * (r + 0.7)) set(c, x, y, T.WALL);
    }
  }
  set(c, exit.x - r, exit.y, T.DOOR);
  set(c, exit.x - r - 1, exit.y, T.GRASS);
  carveDisc(c, entry.x, entry.y, 2.5, T.GRASS);
  return { entry, exit, rooms: [], marks: { lighthouse: { ...exit } } };
}

export { at, isOpen };
