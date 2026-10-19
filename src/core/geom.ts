// Grid geometry helpers. Coordinates are integer tiles; arrays are row-major (i = y * w + x).

export interface Pt {
  x: number;
  y: number;
}

/** 8 directions, clockwise from north. Order matters for deterministic tie-breaking. */
export const DIRS8: readonly Pt[] = [
  { x: 0, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: 0 },
  { x: -1, y: -1 },
];

export const DIRS4: readonly Pt[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

export function sign(n: number): number {
  return n > 0 ? 1 : n < 0 ? -1 : 0;
}

export function chebyshev(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

export function manhattan(ax: number, ay: number, bx: number, by: number): number {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

export function euclid(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Unit step (-1..1 on each axis) pointing from a toward b. */
export function dirToward(ax: number, ay: number, bx: number, by: number): Pt {
  return { x: sign(bx - ax), y: sign(by - ay) };
}

/** True if (dx, dy) is a straight or diagonal line (so a ray can follow it exactly). */
export function isStraightLine(dx: number, dy: number): boolean {
  return dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy);
}

export function dirIndex(d: Pt): number {
  for (let i = 0; i < 8; i++) {
    const e = DIRS8[i] as Pt;
    if (e.x === d.x && e.y === d.y) return i;
  }
  return -1;
}

/** Bresenham line from (x0,y0) to (x1,y1) inclusive of both ends. */
export function line(x0: number, y0: number, x1: number, y1: number): Pt[] {
  const pts: Pt[] = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    pts.push({ x, y });
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return pts;
}

/**
 * Ray from origin toward target, extended to maxLen steps (excluding the origin).
 * Used for projectiles and aimed attacks: the aim is locked as a direction, so the
 * shot continues past the original target square.
 */
export function ray(ox: number, oy: number, tx: number, ty: number, maxLen: number): Pt[] {
  if (ox === tx && oy === ty) return [];
  // Extend the target far along the same vector, then walk Bresenham and truncate.
  const dx = tx - ox;
  const dy = ty - oy;
  const scale = Math.ceil((maxLen + 2) / Math.max(Math.abs(dx), Math.abs(dy)));
  const pts = line(ox, oy, ox + dx * scale, oy + dy * scale);
  return pts.slice(1, maxLen + 1);
}

/** Tiles within Euclidean radius r (r may be fractional), including the centre. */
export function disc(cx: number, cy: number, r: number): Pt[] {
  const out: Pt[] = [];
  const ri = Math.ceil(r);
  const r2 = r * r + 0.01;
  for (let y = cy - ri; y <= cy + ri; y++) {
    for (let x = cx - ri; x <= cx + ri; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) out.push({ x, y });
    }
  }
  return out;
}

/** Tiles in a square of Chebyshev radius r around the centre. */
export function square(cx: number, cy: number, r: number): Pt[] {
  const out: Pt[] = [];
  for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) out.push({ x, y });
  return out;
}

/**
 * A 90-degree cone of the given range projecting from origin in 8-way direction dir.
 * The origin itself is excluded.
 */
export function cone(ox: number, oy: number, dir: Pt, range: number): Pt[] {
  const out: Pt[] = [];
  const len = Math.hypot(dir.x, dir.y) || 1;
  const fx = dir.x / len;
  const fy = dir.y / len;
  for (let y = oy - range; y <= oy + range; y++) {
    for (let x = ox - range; x <= ox + range; x++) {
      if (x === ox && y === oy) continue;
      const dx = x - ox;
      const dy = y - oy;
      const d = Math.hypot(dx, dy);
      if (d > range + 0.5) continue;
      const cos = (dx * fx + dy * fy) / d;
      if (cos >= Math.cos(Math.PI / 4) - 1e-9) out.push({ x, y });
    }
  }
  return out;
}

export function ptEq(a: Pt, b: Pt): boolean {
  return a.x === b.x && a.y === b.y;
}
